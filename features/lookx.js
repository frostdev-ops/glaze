// Look extras on the LMS page (W12): the pointer, Look rotation's clock, and stickers. content.js loads this (need) once
// one is in use on the page (settings.extras, or stickers kept for this page) and calls sync() from applySettings; the
// command palette loads it for its switches (cmds). The pure parts are lib/lookx.js. What it keeps stays on this
// device (storage.local), written through the worker's queue (lib/background.js 'glaze:stickers', 'glaze:rotate').
// Stickers never take a click meant for the page: they let pointers through except in sticker mode, and are never
// on a quiz being taken or a tool's page. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_LOOKX = globalThis.GZ_LOOKX || (() => {
  const ctx = globalThis.GZ_CTX;
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

  // ---- the pointer: CSS cursor on the page (features/lookx.css), the system's I-beam kept on text ----------------
  let pointer = ''; // the own pointer's blob: address
  let live = true; // false from pagehide until the page is shown again: no blob: address is made meanwhile
  const cursor = async () => {
    const c = ctx.on() ? X().cursor : 'off';
    let d = '', p = '', made = '';
    if (c === 'own') {
      const { cursorImg: img } = await get('cursorImg');
      if (!live || c !== (ctx.on() ? X().cursor : 'off')) return; // hidden or changed while reading: a newer pass draws
      made = blobOf(img);
      if (made) d = p = `url("${made}") 0 0`;
    } else if (GZ_LX.CURSORS[c]) [d, p] = ['default', 'pointer'].map((k) => `url("${url(`assets/art/cursors/${c}/${k}.png`)}") ${GZ_LX.CURSORS[c][k].join(' ')}`);
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
  // Sticker mode shows them while "Show stickers" is on its way to being saved.
  const shown = () => top && ctx.on() && (X().stickers || editing) && !quiz();
  const ownId = (s) => (s.startsWith('own:') ? s.slice(4) : null);
  const src = (s) => (ownId(s) ? own[ownId(s)] || '' : url(GZ_LX.file(s)));
  const nameOf = (s) => (ownId(s) ? t('Your picture') : t(GZ_LX.BUNDLED.get(s)));
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
      const el = make('div', { className: 'gz-stk', tabIndex: editing ? 0 : -1 }, make('img', { src: src(p.s), alt: '', draggable: false }), make('span', { className: 'gz-stk-grip' }));
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
    } else grid.replaceChildren(...GZ_LX.PACKS[pack].map((n) => pick(`${pack}/${GZ_LX.slug(n)}`)));
  };
  const pick = (s) => {
    const b = button('', nameOf(s), () => place(s));
    b.className = 'gz-stk-pick';
    b.title = nameOf(s);
    b.append(make('img', { src: src(s), alt: '' }));
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
    const sel = make('select', {}, ...[...Object.entries(GZ_LX.PACK_NAMES), ['own', 'Your pictures']].map(([v, n]) => make('option', { value: v, textContent: t(n) })));
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
    draw();
  };

  // Another tab or the worker changed what this page shows.
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.rotateState) arm();
    if (c.cursorImg && X().cursor === 'own') cursor();
    if (key && c[key] && !editing && !pending.size) { key = ''; stickers(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); });
  addEventListener('pagehide', () => {
    flush();
    live = false;
    for (const u of [...Object.values(own), pointer]) if (u) URL.revokeObjectURL(u);
    own = {};
    pointer = '';
  });
  addEventListener('pageshow', (e) => { live = true; if (e.persisted) { key = ''; sync(); } });
  // Ultra changes pages in place: its stickers are the new path's.
  globalThis.navigation?.addEventListener('navigatesuccess', () => { if (key) stickers(); });

  const sync = async () => {
    await lib();
    cursor();
    arm();
    stickers();
  };

  // The command palette's switches (features/palette.js).
  const cmds = () => {
    const x = X();
    const store = (patch) => () => { try { chrome.storage.sync.set({ version: 2, extras: { ...x, ...patch } }); } catch { /* extension reloaded */ } };
    const hint = (now) => (now ? t('Current') : 'Glaze');
    return [
      ...(top && !quiz() ? [{ label: t('Place stickers on this page'), hint: 'Glaze', group: 'Glaze', run: edit }] : []),
      { label: t(x.stickers ? 'Hide stickers' : 'Show stickers'), hint: 'Glaze', group: 'Glaze', run: store({ stickers: !x.stickers }) },
      ...[['off', 'Standard'], ['aqua', 'Aqua'], ['lilac', 'Lilac'], ['pearl', 'Pearl']].map(([c, n]) => ({ label: t('Pointer: {name}', { name: t(n) }), hint: hint(x.cursor === c), group: 'Glaze', run: store({ cursor: c }) })),
      ...[['off', 'Off'], ['6h', 'Every 6 hours'], ['12h', 'Every 12 hours'], ['24h', 'Every 24 hours'], ['week', 'Every week'], ['daily', 'Every day at a set time']]
        .map(([v, n]) => ({ label: t('Look rotation: {every}', { every: t(n) }), hint: hint(x.rotate === v), group: 'Glaze', run: store({ rotate: v }) })),
      ...(x.rotate !== 'off' ? [{ label: t('Next Look now'), hint: t('Look rotation'), group: 'Glaze', run: () => send({ type: 'glaze:rotate', now: true }) }] : []),
    ];
  };

  return { sync, cmds, edit };
})();
GZ_LOOKX;
