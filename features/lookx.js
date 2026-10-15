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
  const quiz = () => /\/quizzes\/\d+\/(take|history)(\/|$)|\/external_tools\/|\/assessment\//.test(location.pathname) || !!document.getElementById('tool_content');
  const sheet = () => {
    if (!document.getElementById('gz-lookx-css')) (document.head || html).append(make('link', { id: 'gz-lookx-css', rel: 'stylesheet', href: url('features/lookx.css') }));
  };

  // ---- the pointer: CSS cursor on the page (features/lookx.css), the system's I-beam kept on text ----------------
  const cursor = async () => {
    const c = ctx.on() ? X().cursor : 'off';
    let d = '', p = '';
    if (c === 'own') {
      const { cursorImg: img } = await get('cursorImg');
      if (typeof img === 'string' && GZ_LX.DATA.test(img)) d = p = `url("${img}") 0 0`;
    } else if (GZ_LX.CURSORS[c]) [d, p] = ['default', 'pointer'].map((k) => `url("${url(`assets/art/cursors/${c}/${k}.png`)}") ${GZ_LX.CURSORS[c][k].join(' ')}`);
    if (c !== (ctx.on() ? X().cursor : 'off')) return; // changed while reading
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
  let clock = 0;
  const arm = async () => {
    clearTimeout(clock);
    clock = 0;
    const x = X();
    if (!top || !ctx.on() || x.rotate === 'off') return;
    const { rotateState: st } = await get('rotateState');
    const next = st?.mode === `${x.rotate} ${x.at}` ? GZ_LX.nextTurn(x.rotate, x.at, st.at) : null;
    const wait = next === null ? 0 : next - Date.now();
    // Due (or never started): the worker checks again and writes rotateState, which arms every tab anew.
    if (wait <= 0) send({ type: 'glaze:rotate' });
    clock = setTimeout(arm, wait > 0 ? Math.min(wait, 6e5) : 6e5);
  };

  // ---- stickers ----------------------------------------------------------------------------------------------------
  let key = '', list = [], layer = null, els = [], editing = false, panel = null, pack = 'study', saving = 0;
  const own = {}; // id -> data URL, of the student's pictures read so far
  const shown = () => top && ctx.on() && X().stickers && !quiz();
  const ownId = (s) => (s.startsWith('own:') ? s.slice(4) : null);
  const src = (s) => (ownId(s) ? own[ownId(s)] || '' : url(GZ_LX.file(s)));
  const nameOf = (s) => (ownId(s) ? t('Your picture') : t(GZ_LX.BUNDLED.get(s)));
  const readOwn = async (ids) => {
    const want = ids.filter((id) => !(id in own)).map((id) => `stkImg:${id}`);
    if (want.length) for (const [k, v] of Object.entries(await get(want))) if (typeof v === 'string' && GZ_LX.DATA.test(v)) own[k.slice(7)] = v;
  };
  const stickers = async () => {
    if (!shown()) {
      if (editing) stopEdit();
      layer?.remove();
      layer = null;
      key = '';
      return;
    }
    const k = GZ_LX.pageKey(location.origin, location.pathname);
    if (k !== key) {
      key = k;
      list = GZ_LX.clean((await get(k))[k]);
      if (key !== k) return;
    }
    await readOwn(list.map((p) => ownId(p.s)).filter(Boolean));
    draw();
  };
  const save = () => {
    clearTimeout(saving);
    const k = key, l = list.map((p) => ({ ...p }));
    saving = setTimeout(() => { saving = 0; send({ type: 'glaze:stickers', key: k, list: l }); }, 300);
  };
  const pos = (el, p) => {
    el.style.left = `${p.x}%`;
    el.style.top = `${p.y}px`;
    el.style.width = `${p.w}px`;
    el.style.rotate = `${p.r}deg`;
  };
  const draw = () => {
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
    save();
  };
  const remove = (i) => {
    const [p] = list.splice(i, 1);
    save();
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
    const r = layer.getBoundingClientRect();
    const p = GZ_LX.placement({ s, x: ((innerWidth / 2 - r.left) / (r.width || 1)) * 100, y: innerHeight / 2 - r.top - 60 + (list.length % 5) * 16, w: 120, r: 0 });
    if (!p) return;
    list.push(p);
    save();
    draw();
    els.at(-1)?.focus({ preventScroll: true });
    say(t('{name} placed.', { name: nameOf(s) }));
  };

  // ---- sticker mode: the panel ------------------------------------------------------------------------------------
  let status = null, grid = null, onPage = null;
  const say = (text) => { if (status) status.textContent = text; };
  const showPack = async () => {
    if (pack === 'own') {
      const { stkImgs } = await get('stkImgs');
      const ids = Object.keys(stkImgs && typeof stkImgs === 'object' ? stkImgs : {});
      await readOwn(ids);
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
    const r = await send({ type: 'glaze:stickers', img: d });
    if (!r?.ok) return say(t(r?.error === 'cap' ? 'That picture is too big to keep. Try a smaller one, or delete one of your pictures.' : 'Not saved. Try again in a moment.'));
    own[r.id] = d;
    await showPack();
    place(`own:${r.id}`);
  };
  const dropOwn = async (id) => {
    if (!(await send({ type: 'glaze:stickers', drop: id }))?.ok) return say(t('Not saved. Try again in a moment.'));
    delete own[id];
    // Off this page too; on other pages it is skipped when they are next shown.
    if (list.some((p) => p.s === `own:${id}`)) { list = list.filter((p) => p.s !== `own:${id}`); save(); draw(); }
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
    if (!X().stickers) try { chrome.storage.sync.set({ version: 2, extras: { ...X(), stickers: true } }); } catch { /* extension reloaded */ }
    editing = true;
    await stickers();
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
    if (key && c[key] && !editing && !saving) { key = ''; stickers(); }
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) arm(); });
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
