// Look extras on the LMS page (W12): the pointer, Look rotation's clock, and stickers. content.js loads this (need)
// once one is in use on the page (the worn Look's x.pointer or the student's own choice of pointer, settings.extras, or
// stickers kept for this page) and calls sync() from applySettings and when the Look's parts change; the
// command palette loads it for its switches (cmds). The pure parts are lib/lookx.js. What it keeps stays on this
// device (storage.local), written through the worker's queue (lib/background.js 'glaze:stickers', 'glaze:rotate').
// Stickers never take a click meant for the page: they let pointers through except in sticker mode, and are never
// on a quiz being taken or a tool's page. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_LOOKX = globalThis.GZ_LOOKX || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // a frame-only injection can outlive its document
  const t = (k, v) => ctx.t(k, v);
  const html = document.documentElement;
  const top = window.top === window;
  const lib = () => ctx.need('lib/lookx.js', () => globalThis.GZ_LX);
  const get = (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const url = (f) => chrome.runtime.getURL(f);
  const X = () => ctx.settings().extras;
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null)); return e; };
  const button = (text, label, act) => { const b = make('button', { type: 'button', textContent: text }); if (label) b.setAttribute('aria-label', label); b.addEventListener('click', act); return b; };
  // lib/lookx.js quiet; before it has loaded (the palette's switches), sticker mode checks again once it has.
  const quiz = () => !!globalThis.GZ_LX?.quiet(location.pathname, document);
  // The student's own pictures reach the page as blob: addresses made from the stored bytes, not as data: URLs in its
  // DOM and CSS; each is revoked when replaced or deleted, and all of them when the page is hidden (and remade if the
  // browser brings it back).
  const blobOf = (data) => {
    if (typeof data !== 'string' || !GZ_LX.DATA.test(data)) return '';
    const [head, b64] = data.split(',');
    try { return URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: head.slice(5, head.indexOf(';')) })); } catch { return ''; }
  };
  const sheet = () => {
    if (!ctx.on()) return;
    if (!document.getElementById('gz-lookx-css')) (document.head || html).append(make('link', { id: 'gz-lookx-css', rel: 'stylesheet', href: url('features/lookx.css') }));
  };

  // ---- the pointer: a set as a CSS cursor on the page (features/lookx.css), the system's I-beam kept on text. The system
  // draws it, so it never lags; its animation is features/motionx.js's, on the canvas around it. Which one is the student's
  // choice (extras.pointer) over the Look's, including a course's assigned Look. Off on quiz/tool pages, with Glaze off and
  // with the custom pointer off (extras.pointerOn).
  let pointer = '', pointing = 0; // the own pointer's blob: address and the latest read
  let live = true; // false from pagehide until the page is shown again: no blob: address is made meanwhile
  const worn = () => (ctx.on() && ctx.partsOn(true) && !quiz() ? GZ_LX.pointerOf(X().pointer,
    ctx.courseLook?.() ? globalThis.GZ_LOOK_PARTS?.({ name: ctx.courseLook() })?.x?.pointer : ctx.parts()?.pointer, X().pointerOn !== false) : 'off');
  // Whether this browser takes image-set() in a cursor (for the 2x picture); one that doesn't gets the 1x PNG after the SVG.
  let sets;
  const imageSet = () => (sets ??= !!globalThis.CSS?.supports?.('cursor', 'image-set(url("a.png") 1x, url("b.png") 2x) 0 0, auto'));
  const cursor = async () => {
    const g = ++pointing, c = worn();
    let d = '', p = '', made = '';
    if (c === 'own') {
      const { cursorImg: img } = await get('cursorImg');
      if (!live || g !== pointing || c !== worn()) return; // hidden or superseded while reading: a newer pass draws
      made = blobOf(img);
      if (made) d = p = `url("${made}") 0 0`;
    } else if (GZ_LX.CURSORS[c]) [d, p] = ['default', 'pointer'].map((k) => GZ_LX.cursorCss(c, k, url, imageSet()));
    if (pointer) URL.revokeObjectURL(pointer);
    pointer = made;
    if (d) {
      sheet();
      html.style.setProperty('--gz-cursor', `${d}, auto`);
      html.style.setProperty('--gz-cursor-pointer', `${p}, pointer`);
      html.setAttribute('data-gz-cursor', '');
    } else {
      html.style.removeProperty('--gz-cursor');
      html.style.removeProperty('--gz-cursor-pointer');
      html.removeAttribute('data-gz-cursor');
    }
  };

  // ---- Look rotation: one timeout to the next turn (at most 10 minutes, a timer stalls while the computer sleeps) --
  // Asked again while it reads (every sync() and storage change asks), only the newest asking sets the timer.
  let clock = 0, arming = 0;
  const arm = async () => {
    const g = ++arming;
    clearTimeout(clock);
    clock = 0;
    const x = X();
    if (!top || !ctx.on() || x.rotate === 'off') return;
    const { rotateState: st } = await get('rotateState');
    if (g !== arming) return;
    const next = st?.mode === `${x.rotate} ${x.at}` ? GZ_LX.nextTurn(x.rotate, x.at, st.at) : null;
    const wait = next === null ? 0 : next - Date.now();
    // Due (or never started): the worker checks again and writes rotateState, which arms every tab anew.
    if (wait <= 0) send({ type: 'glaze:rotate' });
    clock = setTimeout(arm, wait > 0 ? Math.min(wait, 6e5) : 6e5);
  };

  // ---- stickers ----------------------------------------------------------------------------------------------------
  let key = '', list = [], layer = null, els = [], editing = false, panel = null, pack = 'study', saving = 0, drawing = 0;
  // Moves, sizes and turns not yet sent, by page and sticker: { key, id, p, at }, p holding only the fields the student
  // changed (a move x and y, a resize w, a turn r), so another tab's change to the others stands.
  const pending = new Map();
  let own = {}; // id -> blob: address, of the student's pictures read so far
  // Stickers a mod carries (mod.json packs.stickers): which mods bring packs (asked of the worker, which says only what is on and
  // not blocked), and each sticker's art once it is asked for: { kind: 'image', url, bytes, mime, animated } or { kind: 'lottie',
  // json } as the worker cleaned them, or false when it can't be had (the mod went, or the file is no longer what it was).
  let modPacks = null, modRevision = 0;
  const modArt = new Map();
  const lotties = new Set(); // the players on the page now
  let lottiePixels = 0;
  const stillNow = () => html.getAttribute('data-gz-motion') === 'off';
  // Sticker mode shows them while "Show stickers" is on its way to being saved.
  // A course tab's frame shows its own page's stickers (ctx.solo); the Look rotation stays the top page's.
  const shown = () => ctx.solo && ctx.on() && (X().stickers || editing) && !quiz();
  const ownId = (s) => (s.startsWith('own:') ? s.slice(4) : null);
  const isMod = (s) => GZ_LX.MOD.test(s);
  const src = (s) => (ownId(s) ? own[ownId(s)] || '' : url(GZ_LX.file(s)));
  const nameOf = (s) => (ownId(s) ? t('Your picture') : isMod(s) ? modPacks?.find((p) => p.mod === s.slice(4, 20))?.stickers.find((x) => x.id === s.slice(21))?.name || t('Sticker') : t(GZ_LX.BUNDLED.get(s)));
  const packsIn = async () => {
    const revision = modRevision;
    const packs = modPacks || (await send({ type: 'glaze:modpage', op: 'packs' }))?.packs || [];
    if (revision !== modRevision) return [];
    return modPacks = packs;
  };
  // A mod's stickers, read now: each from the worker, which reads the file again and hands back only a cleaned copy.
  const readMod = async (list) => {
    const revision = modRevision;
    await packsIn();
    if (revision !== modRevision) return;
    await Promise.all([...new Set(list)].filter((s) => isMod(s) && !modArt.has(s)).map(async (s) => {
      modArt.set(s, false);
      const r = await send({ type: 'glaze:modpage', op: 'sticker', mod: s.slice(4, 20), id: s.slice(21) });
      if (!live || revision !== modRevision || !r?.ok) return;
      if (r.kind === 'lottie') modArt.set(s, { kind: 'lottie', json: r.json, canvases: r.canvases });
      else if (r.kind === 'image') {
        const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0));
        modArt.set(s, { kind: 'image', bytes, mime: r.mime, animated: !!r.animated, url: URL.createObjectURL(new Blob([bytes], { type: r.mime })) });
      }
    }));
  };
  const forgetMods = () => {
    modRevision++;
    for (const a of modArt.values()) if (a?.url) URL.revokeObjectURL(a.url);
    modArt.clear();
    modPacks = null;
  };
  // The mods changed (installed, turned off, updated): what they bring is asked again, and what is on screen redrawn from it.
  const refreshMods = async () => {
    modRevision++;
    const old = [...modArt.values()];
    modArt.clear();
    modPacks = null;
    if (list.some((p) => isMod(p.s))) await readMod(list.map((p) => p.s));
    if (live && (layer || editing)) { draw(); if (panel && pack.startsWith('mod:')) showPack(); }
    for (const a of old) if (a?.url) URL.revokeObjectURL(a.url);
  };
  // The Lottie player, imported once (lib/lottie/): the first Lottie sticker asks for it.
  let lottieLoad = null, lottieAttempt = 0;
  // A redraw can retry the player without reusing a failed browser module URL.
  const lottieIn = () => (lottieLoad ||= import(chrome.runtime.getURL(`lib/lottie/lottie_light_canvas.min.js?gzStickerRetry=${lottieAttempt++}`)).then(() => {
    if (typeof globalThis.lottie?.loadAnimation !== 'function') throw new Error('lottie');
    return globalThis.lottie;
  }).catch((error) => {
    lottieLoad = null;
    throw error;
  }));
  const mute = () => { for (const a of lotties) { if (document.hidden || stillNow()) a.pause(); else a.play(); } };
  // What a sticker shows. Bundled and own pictures are images. A mod's: its picture (an animated WebP or AVIF moves by itself,
  // and with motion off is its first frame in a canvas), or its Lottie animation (frame 0 with motion off, paused while hidden).
  const art = (s, small = false) => {
    if (!isMod(s)) return make('img', { src: src(s), alt: '', draggable: false });
    const a = modArt.get(s);
    if (!a) return make('span', { className: 'gz-stk-gone' });
    if (a.kind === 'image') {
      if (!a.animated || !stillNow()) return make('img', { src: a.url, alt: '', draggable: false });
      const c = make('canvas', { width: 1, height: 1 });
      createImageBitmap(new Blob([a.bytes], { type: a.mime })).then((b) => { c.width = b.width; c.height = b.height; c.getContext('2d').drawImage(b, 0, 0); b.close(); }).catch(() => {});
      return c;
    }
    if (small) return make('span', { textContent: nameOf(s) });
    const box = make('div', { className: 'gz-stk-lottie' });
    box.style.aspectRatio = `${a.json.w} / ${a.json.h}`;
    lottieIn().then((lottie) => {
      if (!box.isConnected || !live) return;
      const dpr = Math.min(devicePixelRatio || 1, 2), w = Math.max(1, box.offsetWidth), h = Math.max(1, box.offsetHeight);
      const pixels = Math.ceil(w * dpr) * Math.ceil(h * dpr) * a.canvases;
      if (!Number.isSafeInteger(a.canvases) || a.canvases < 1 || !Number.isFinite(pixels) || lottiePixels + pixels > 6.4e7) throw new Error('budget');
      lottiePixels += pixels;
      // Freeze the measured size while the player asynchronously creates its matte buffers.
      box.style.width = `${w}px`; box.style.height = `${h}px`;
      const anim = lottie.loadAnimation({ container: box, renderer: 'canvas', loop: true, autoplay: false, animationData: JSON.parse(JSON.stringify(a.json)), rendererSettings: { preserveAspectRatio: 'xMidYMid meet', clearCanvas: true, dpr } });
      const sized = () => { box.style.width = '100%'; box.style.height = 'auto'; };
      if (anim.isLoaded) sized(); else anim.addEventListener('DOMLoaded', sized);
      anim.setSubframe?.(false);
      lotties.add(anim);
      if (document.hidden || stillNow()) anim.goToAndStop(0, true); else anim.play();
    }).catch(() => box.replaceWith(make('span', { className: 'gz-stk-gone' })));
    return box;
  };
  const dropLotties = () => { for (const a of lotties) { try { a.destroy(); } catch { /* gone */ } } lotties.clear(); lottiePixels = 0; };
  const readOwn = async (ids) => {
    const want = ids.filter((id) => !(id in own)).map((id) => `stkImg:${id}`);
    if (!want.length) return;
    const got = await get(want);
    if (live) for (const [k, v] of Object.entries(got)) if (!(k.slice(7) in own)) own[k.slice(7)] = blobOf(v) || undefined;
  };
  // Every await is followed by a check that this is still the newest pass and stickers are still shown: a read that
  // answers after Hide (or after the page changed) must not draw them back.
  const stickers = async () => {
    const g = ++drawing;
    const still = () => g === drawing && shown();
    if (!shown()) {
      flush();
      if (editing) stopEdit();
      dropLotties();
      layer?.remove();
      layer = null;
      key = '';
      return;
    }
    const k = GZ_LX.pageKey(location.origin, location.pathname);
    if (k !== key) {
      flush(); // the last page's edits go under its own key
      const r = await get(k);
      if (!still()) return;
      key = k;
      list = GZ_LX.clean(r[k]);
    }
    await readOwn(list.map((p) => ownId(p.s)).filter(Boolean));
    if (list.some((p) => isMod(p.s))) await readMod(list.map((p) => p.s));
    if (still()) draw();
  };
  // Changes go to the worker one by one (lib/lookx.js apply), each with when it was made: adding and removing at once,
  // a drag's moves together after it rests.
  const op = (m) => send({ type: 'glaze:stickers', key, at: Date.now(), ...m });
  const flush = () => {
    clearTimeout(saving);
    saving = 0;
    for (const { key: k, id, p, at } of pending.values()) send({ type: 'glaze:stickers', key: k, op: 'set', id, p, at });
    pending.clear();
  };
  const pos = (el, p) => {
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}px`;
    el.style.width = `${p.w}px`;
    el.style.rotate = `${p.r}deg`;
  };
  const draw = () => {
    dropLotties();
    if (!ctx.on()) { layer?.remove(); layer = null; return; }
    if (!list.length && !editing) { layer?.remove(); layer = null; return; }
    sheet();
    if (!layer?.isConnected) {
      layer = make('div', { id: 'gz-stickers' });
      document.body.append(layer);
    }
    layer.classList.toggle('gz-stk-edit', editing);
    // Decoration, out of the way of a screen reader, but for sticker mode's own controls.
    layer.toggleAttribute('aria-hidden', !editing);
    els = list.map((p, i) => {
      const el = make('div', { className: 'gz-stk', tabIndex: editing ? 0 : -1 }, art(p.s), make('span', { className: 'gz-stk-grip' }));
      if (editing) {
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', nameOf(p.s));
        el.setAttribute('aria-describedby', 'gz-stk-help');
        el.addEventListener('pointerdown', (e) => drag(e, i, e.target.classList.contains('gz-stk-grip')));
        el.addEventListener('keydown', (e) => key4(e, i));
      }
      pos(el, p);
      return el;
    });
    layer.replaceChildren(...els);
    if (panel) listPage();
  };
  // A change to one sticker: kept, saved, and redrawn in place (its element keeps focus).
  const change = (i, patch) => {
    const p = GZ_LX.placement({ ...list[i], ...patch });
    if (!p) return;
    list[i] = p;
    pos(els[i], p);
    const was = pending.get(`${key} ${p.id}`);
    pending.set(`${key} ${p.id}`, { key, id: p.id, p: { ...was?.p, ...Object.fromEntries(Object.keys(patch).map((f) => [f, p[f]])) }, at: Date.now() });
    clearTimeout(saving);
    saving = setTimeout(flush, 300);
  };
  const remove = (i) => {
    const [p] = list.splice(i, 1);
    pending.delete(`${key} ${p.id}`);
    op({ op: 'del', id: p.id });
    dropLotties();
    draw();
    say(t('{name} removed.', { name: nameOf(p.s) }));
    (els[Math.min(i, els.length - 1)] || panel?.querySelector('select'))?.focus();
  };
  const drag = (e, i, size) => {
    if (!editing || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    els[i].focus({ preventScroll: true });
    const o = { ...list[i] }, W = layer.getBoundingClientRect().width || 1, sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      change(i, size ? { w: o.w + Math.max(dx, dy) } : { x: o.x + (dx / W) * 100, y: o.y + dy });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  };
  // Keys on a sticker in sticker mode: arrows move it (Shift: further), + and - size it, [ and ] turn it, Delete removes.
  const key4 = (e, i) => {
    const p = list[i], step = e.shiftKey ? 40 : 8, W = layer.getBoundingClientRect().width || 1;
    const act = {
      ArrowLeft: () => change(i, { x: p.x - (step / W) * 100 }), ArrowRight: () => change(i, { x: p.x + (step / W) * 100 }),
      ArrowUp: () => change(i, { y: p.y - step }), ArrowDown: () => change(i, { y: p.y + step }),
      '+': () => change(i, { w: p.w + 8 }), '=': () => change(i, { w: p.w + 8 }), '-': () => change(i, { w: p.w - 8 }),
      '[': () => change(i, { r: p.r - 5 }), ']': () => change(i, { r: p.r + 5 }),
      Delete: () => remove(i), Backspace: () => remove(i), Escape: () => stopEdit(),
    }[e.key];
    if (!act) return;
    e.preventDefault();
    e.stopPropagation();
    act();
  };
  // A new sticker, in the middle of what's on screen (a little lower for each one placed in a row).
  const place = (s) => {
    if (!editing || !ctx.on()) return;
    if (!layer) draw();
    const r = layer.getBoundingClientRect();
    const p = GZ_LX.placement({ id: crypto.randomUUID(), s, x: ((innerWidth / 2 - r.left) / (r.width || 1)) * 100, y: innerHeight / 2 - r.top - 60 + (list.length % 5) * 16, w: 120, r: 0 });
    if (!p) return;
    list.push(p);
    op({ op: 'add', p });
    draw();
    els.at(-1)?.focus({ preventScroll: true });
    say(t('{name} placed.', { name: nameOf(s) }));
  };

  // ---- sticker mode: the panel ------------------------------------------------------------------------------------
  let status = null, grid = null, onPage = null;
  const say = (text) => { if (status) status.textContent = text; };
  const showPack = async () => {
    if (!ctx.on()) return;
    const was = panel;
    if (pack === 'own') {
      // The pictures stored (lib/lookx.js imgIds): read in sticker mode only.
      const all = await get(null);
      if (!ctx.on() || !live || panel !== was || !panel || pack !== 'own') return;
      const ids = GZ_LX.imgIds(all);
      for (const id of ids) if (!own[id]) own[id] = blobOf(all[`stkImg:${id}`]) || undefined;
      const file = make('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true });
      file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) addOwn(f); });
      grid.replaceChildren(...ids.filter((id) => own[id]).map((id) => make('span', { className: 'gz-stk-own' },
        pick(`own:${id}`), button('×', t('Delete your picture'), () => dropOwn(id)))), make('span', {}, button(t('Add a picture…'), '', () => file.click()), file));
    } else if (pack.startsWith('mod:')) {
      const asked = pack, mine = (await packsIn()).find((p) => `mod:${p.mod}` === asked);
      const ids = (mine?.stickers || []).map((x) => `mod:${mine.mod}/${x.id}`);
      await readMod(ids);
      if (!ctx.on() || !live || panel !== was || !panel || pack !== asked) return;
      grid.replaceChildren(...ids.filter((s) => modArt.get(s)).map(pick));
    } else grid.replaceChildren(...GZ_LX.PACKS[pack].map((n) => pick(`${pack}/${GZ_LX.slug(n)}`)));
  };
  const pick = (s) => {
    const b = button('', nameOf(s), () => place(s));
    b.className = 'gz-stk-pick';
    b.title = nameOf(s);
    b.append(art(s, true));
    return b;
  };
  // The student's own picture: read on this device, scaled to 256 px at most, kept as WebP (PNG where the browser can't
  // write WebP). SVG and anything else the browser can't draw as a bitmap is refused.
  const addOwn = async (f) => {
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { return say(t("That file isn't a picture Glaze can read.")); }
    const [w, h] = GZ_LX.fit(bmp.width, bmp.height, 256);
    const c = make('canvas', { width: w, height: h });
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    let d = c.toDataURL('image/webp', 0.85);
    if (!d.startsWith('data:image/webp')) d = c.toDataURL('image/png');
    const r = await send({ type: 'glaze:stickers', img: d, at: Date.now() });
    if (!editing) return;
    if (!r?.ok) return say(t(r?.error === 'cap' ? 'That picture is too big to keep. Try a smaller one, or delete one of your pictures.' : 'Not saved. Try again in a moment.'));
    own[r.id] = blobOf(d);
    await showPack();
    if (editing && layer) place(`own:${r.id}`);
  };
  const dropOwn = async (id) => {
    if (!(await send({ type: 'glaze:stickers', drop: id }))?.ok) return say(t('Not saved. Try again in a moment.'));
    if (own[id]) URL.revokeObjectURL(own[id]);
    delete own[id];
    if (!editing) return;
    // Off this page too; on other pages it is skipped when they are next shown.
    for (const p of list.filter((x) => x.s === `own:${id}`)) op({ op: 'del', id: p.id });
    if (list.some((p) => p.s === `own:${id}`)) { list = list.filter((p) => p.s !== `own:${id}`); draw(); }
    await showPack();
    say(t('Picture deleted.'));
  };
  const listPage = () => {
    onPage.replaceChildren(...(list.length ? list.map((p, i) => make('li', {}, make('span', { textContent: nameOf(p.s) }),
      button('↺', t('Turn {name} left', { name: nameOf(p.s) }), () => change(i, { r: p.r - 5 })),
      button('↻', t('Turn {name} right', { name: nameOf(p.s) }), () => change(i, { r: p.r + 5 })),
      button(t('Remove'), t('Remove {name}', { name: nameOf(p.s) }), () => remove(i)))) : [make('li', { textContent: t('No stickers on this page yet.') })]));
  };
  const edit = async () => {
    if (!top || !ctx.on() || quiz()) return;
    await lib();
    if (!top || !ctx.on() || quiz()) return;
    if (!X().stickers) try { chrome.storage.sync.set({ version: 2, extras: { ...X(), stickers: true } }); } catch { /* extension reloaded */ }
    editing = true;
    await stickers();
    if (!editing) return;
    if (!layer) draw();
    if (panel) return panel.querySelector('select').focus();
    const mods = (await packsIn()).filter((p) => p.stickers.length).map((p) => make('option', { value: `mod:${p.mod}`, textContent: p.name }));
    const sel = make('select', {}, ...[...Object.entries(GZ_LX.PACK_NAMES), ['own', 'Your pictures']].map(([v, n]) => make('option', { value: v, textContent: t(n) })), ...mods);
    if (pack.startsWith('mod:') && !mods.some((o) => o.value === pack)) pack = 'study';
    sel.value = pack;
    sel.setAttribute('aria-label', t('Sticker pack'));
    sel.addEventListener('change', () => { pack = sel.value; showPack(); });
    grid = make('div', { className: 'gz-stk-grid' });
    onPage = make('ul', { className: 'gz-stk-list' });
    onPage.setAttribute('aria-label', t('On this page'));
    status = make('p', { className: 'gz-stk-status' });
    status.setAttribute('role', 'status');
    panel = make('div', { id: 'gz-stk-panel' },
      make('div', { className: 'gz-stk-head' }, make('strong', { textContent: t('Stickers') }), button(t('Done'), '', stopEdit)),
      sel, grid,
      make('p', { id: 'gz-stk-help', className: 'gz-stk-help', textContent: t('Drag a sticker to move it, or its corner to resize it. With a sticker selected: arrow keys move it, + and − resize it, [ and ] turn it, Delete removes it. Esc when done.') }),
      make('strong', { textContent: t('On this page') }), onPage, status);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', t('Stickers'));
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); stopEdit(); } e.stopPropagation(); });
    document.body.append(panel);
    listPage();
    await showPack();
    sel.focus();
  };
  const stopEdit = () => {
    flush();
    editing = false;
    panel?.remove();
    panel = status = grid = onPage = null;
    dropLotties();
    draw();
  };

  // Another tab or the worker changed what this page shows.
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.rotateState) { arm(); if (top && globalThis.GZ_LX?.turned(c.rotateState.oldValue, c.rotateState.newValue)) ctx.moment?.('look.rotate'); }
    if (c.cursorImg && globalThis.GZ_LX && worn() === 'own') cursor();
    if (Object.keys(c).some((k) => k === 'mods' || k.startsWith('mod:') || k === 'modsBlocklist' || k === 'modDev')) refreshMods();
    if (key && c[key] && !editing && !pending.size) { key = ''; stickers(); }
  });
  // The Look changed: its pointer may have (features/lookparts.js; the event says nothing, the parts are asked again). The
  // student's choice changing is a settings change: applySettings calls sync().
  document.addEventListener('glaze:parts', () => { if (globalThis.GZ_LX) cursor(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); mute(); });
  addEventListener('pagehide', () => {
    flush();
    live = false;
    pointing++;
    for (const u of [...Object.values(own), pointer]) if (u) URL.revokeObjectURL(u);
    dropLotties();
    forgetMods();
    own = {};
    pointer = '';
  });
  addEventListener('pageshow', (e) => { live = true; if (e.persisted) { key = ''; sync(); } });
  // Ultra changes pages in place: its stickers are the new path's.
  const moved = () => { if (globalThis.GZ_LX) cursor(); if (key) stickers(); };
  globalThis.navigation?.addEventListener('navigatesuccess', moved);
  addEventListener('popstate', moved);

  const sync = async () => {
    await lib();
    if (ctx.courseLook?.()) await ctx.need('lib/lookset.js', () => globalThis.GZ_LOOK_PARTS);
    cursor();
    arm();
    stickers();
  };

  // The command palette's switches (features/palette.js). The custom pointer's switch first (extras.pointerOn); while it is
  // on, the student's pointer by name, as the editor's Look › Pointer lists them (settings extras.pointer, defaults.js), with
  // their own picture only once there is one (ready(), asked as the palette opens), and its animation's switch.
  const POINTERS = { look: "The Look's pointer", aqua: 'Aqua', lilac: 'Lilac', pearl: 'Pearl', aurora: 'Aurora', quill: 'Quill', terminal: 'Terminal',
    lava: 'Lava', neon: 'Neon', clear: 'Clear', lagoon: 'Lagoon', rose: 'Rose', ghost: 'Ghost', pumpkin: 'Pumpkin', frostdev: 'Frostdev', own: 'Your own picture' };
  let ownPic = false;
  const ready = async () => { ownPic = !!(await get('cursorImg')).cursorImg; };
  const cmds = () => {
    const x = X();
    const store = (patch) => () => { try { chrome.storage.sync.set({ version: 2, extras: { ...X(), ...patch } }); } catch { /* extension reloaded */ } };
    const hint = (now) => (now ? t('Current') : 'Glaze');
    const on = x.pointerOn !== false;
    return [
      { label: t(on ? 'Turn off {name|lower}' : 'Turn on {name|lower}', { name: t('Custom pointer') }), hint: 'Glaze', group: 'Glaze', run: store({ pointerOn: !on }) },
      ...(top && !quiz() ? [{ label: t('Place stickers on this page'), hint: 'Glaze', group: 'Glaze', run: edit }] : []),
      { label: t(x.stickers ? 'Hide stickers' : 'Show stickers'), hint: 'Glaze', group: 'Glaze', run: store({ stickers: !x.stickers }) },
      ...(on ? [...Object.entries(POINTERS).filter(([v]) => v !== 'own' || ownPic || x.pointer === 'own')
        .map(([v, n]) => ({ label: t('Pointer: {name}', { name: t(n) }), hint: hint(x.pointer === v), group: 'Glaze', run: store({ pointer: v }) })),
      { label: t(x.pointerAnim ? 'Turn off {name|lower}' : 'Turn on {name|lower}', { name: t('Pointer animation') }), hint: 'Glaze', group: 'Glaze', run: store({ pointerAnim: !x.pointerAnim }) }] : []),
      ...[['off', 'Off'], ['6h', 'Every 6 hours'], ['12h', 'Every 12 hours'], ['24h', 'Every 24 hours'], ['week', 'Every week'], ['daily', 'Every day at a set time']]
        .map(([v, n]) => ({ label: t('Look rotation: {every}', { every: t(n) }), hint: hint(x.rotate === v), group: 'Glaze', run: store({ rotate: v }) })),
      ...(x.rotate !== 'off' ? [{ label: t('Next Look now'), hint: t('Look rotation'), group: 'Glaze', run: () => send({ type: 'glaze:rotate', now: true }) }] : []),
    ];
  };

  return { sync, cmds, ready, edit };
})();
GZ_LOOKX;
