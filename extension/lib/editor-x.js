// The editor's Look parts builders: what lib/editor-xbg.js (backgrounds) and
// lib/editor-xmotion.js (animations, event effects, the cursor) share. They edit s.parts ({ x, m }, ui.js) and save it
// through the editor's own save path, so a Look's parts are written with the Look (lib/lookparts.js write) and a theme
// code carries the active parts (glaze2). Every change goes through GZ_XPARTS.bundle first; inactive background drafts stay
// in storage for switching back. Extension settings page only; the pure helpers have module.exports for node.
var GZ_EDITOR_X = globalThis.GZ_EDITOR_X || (() => {
  const XP = () => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js'));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const empty = (v) => v == null || (Array.isArray(v) ? !v.length : isObj(v) && !Object.keys(v).length);

  // { x, m } with x[key] set to value (an empty value takes the key out), cleaned. null when nothing is left; undefined when
  // the result doesn't clean (a shader the checker refuses): the caller keeps what it had.
  const put = (parts, key, value) => {
    const x = { ...(parts?.x || {}) };
    if (empty(value)) delete x[key]; else x[key] = value;
    const next = { ...(Object.keys(x).length && { x }), ...(parts?.m && { m: parts.m }) };
    if (!Object.keys(next).length) return null;
    const got = XP().bundle(next);
    return got && XP().same(got, next) ? got : undefined;
  };
  // An object without its empty members (a moment, an effect or a layer list nobody set).
  const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !empty(v)));

  // Compile errors ([{ line, message, vars? }], lines in the author's source; 0 is the whole shader) by line, in order.
  const byLine = (errors, t = (s) => s) => {
    const out = new Map();
    for (const e of Array.isArray(errors) ? errors : []) {
      const line = Number.isInteger(e?.line) && e.line > 0 ? e.line : 0;
      if (!out.has(line)) out.set(line, []);
      out.get(line).push(t(String(e?.message ?? ''), e?.vars));
    }
    return new Map([...out].sort(([a], [b]) => a - b));
  };
  // Where line n (1-based) starts in src, for moving the caret to an error.
  const lineStart = (src, n) => { let at = 0; for (let i = 1; i < n; i++) { const j = src.indexOf('\n', at); if (j < 0) break; at = j + 1; } return at; };

  // ---- the page: shared controls ------------------------------------------------------------------------------------------
  let api = null;
  const builders = [];
  const add = (b) => { builders.push(b); if (api) b.mount(api); };
  // From options.js once its state, save() and preview() exist. api: { s, save, preview, t, frame }.
  const mount = (a) => {
    api = { ...a, write: (key, value, soon = false) => write(key, value, soon) };
    for (const b of builders) b.mount(api);
    // The storage status options.js keeps in look/palette ("Extras on this device only"), repeated beside the builders.
    const source = document.getElementById('look-parts-storage');
    const mirror = () => { for (const p of document.querySelectorAll('[data-x-storage]')) { p.textContent = source.textContent; p.hidden = source.hidden; } };
    if (source) { new MutationObserver(mirror).observe(source, { attributes: true, childList: true, characterData: true, subtree: true }); mirror(); }
  };
  const render = (force = false) => { if (api) for (const b of builders) b.render(force); };
  // Sets x[key], shows it in the preview and saves it (soon: while a slider moves). → whether it cleaned.
  const write = (key, value, soon) => {
    const next = put(api.s.parts, key, value);
    if (next === undefined) return false;
    api.s.parts = next;
    api.preview();
    // Only this part: the worker merges it into the stored parts, so the other builders' parts survive.
    api.save(['parts'], soon, [key]);
    return true;
  };

  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role' || k === 'for') n.setAttribute(k, v === true ? '' : v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n[k] = v;
    }
    n.append(...kids.flat().filter((k) => k != null && k !== false));
    return n;
  };
  const tr = (s, vars) => api.t(s, vars);
  // A slider in the page's .field layout. fmt shows the value; on(v, soon) hears it move (soon) and rest.
  const slider = ({ label, min, max, step = 1, value, fmt = String, on }) => {
    const out = el('output', {}, fmt(value));
    const input = el('input', { type: 'range', min, max, step, value });
    input.addEventListener('input', () => { out.textContent = fmt(+input.value); on(+input.value, true); });
    input.addEventListener('change', () => on(+input.value, false));
    return el('label', { class: 'field' }, el('span', {}, label), input, out);
  };
  const select = ({ label, value, options, on, wide = true }) => {
    const s = el('select', { onchange: () => on(s.value) }, options.map(([v, text]) => new Option(text, v, false, v === value)));
    return el('label', { class: wide ? 'field wide' : 'row' }, el('span', {}, label), s);
  };
  const button = (text, on, props = {}) => el('button', { type: 'button', onclick: on, ...props }, text);
  // A palette token's name as a person reads it: "accent-hi" is "Accent hi".
  const tokenName = (k) => k[0].toUpperCase() + k.slice(1).replace(/-/g, ' ');
  // A list of colours, each a palette token or a custom #rrggbb. min 0 means it may be left out (empty: `none` says what then
  // shows). on(list, soon).
  const colors = ({ label, list = [], min = 0, max, none, on }) => {
    const tokens = GZ_COLORS.map(([v, label]) => [v.slice(5), label]);
    const box = el('div', { class: 'x-colors', role: 'group', 'aria-label': label });
    const rows = list.map((c, i) => {
      const custom = c.startsWith('#');
      const pick = el('input', { type: 'color', value: custom ? c : '#888888', hidden: !custom, 'aria-label': tr('Custom colour {n}', { n: i + 1 }) });
      const which = el('select', { 'aria-label': tr('Colour {n}', { n: i + 1 }) }, ...tokens.map(([k, label]) => new Option(tr(label), k, false, k === c)), new Option(tr('Custom colour'), '#', false, custom));
      const set = (v, soon) => on(list.map((x, j) => (j === i ? v : x)), soon);
      which.addEventListener('change', () => { pick.hidden = which.value !== '#'; set(which.value === '#' ? pick.value : which.value, false); });
      pick.addEventListener('input', () => set(pick.value, true));
      pick.addEventListener('change', () => set(pick.value, false));
      return el('span', { class: 'row' }, which, pick, list.length > min && button(tr('Remove'), () => on(list.filter((_, j) => j !== i), false), { 'aria-label': tr('Remove colour {n}', { n: i + 1 }) }));
    });
    box.append(...rows);
    if (!list.length && none) box.append(el('span', { class: 'desc' }, none));
    if (list.length < max) box.append(button(tr('Add a colour'), () => on([...list, list.length ? 'accent-hi' : 'accent'], false)));
    return el('div', { class: 'field wide' }, el('span', {}, label), box);
  };
  // A polite status line: read out when it changes, after typing or a move rests.
  const status = (props = {}) => el('p', { class: 'desc', role: 'status', 'aria-live': 'polite', ...props });

  // Messages from the preview frame (lib/scene.js tell): fn(data) for those that come from it.
  const fromPreview = (fn) => addEventListener('message', (e) => { if (api && e.origin === location.origin && e.source === api.frame.contentWindow) fn(e.data || {}); });
  // Asks the preview to replay its entrances ('enter') or fire an event moment (lib/editor-preview.js).
  const play = (moment) => api.frame.contentWindow?.postMessage({ gzPreviewMoment: moment }, location.origin);
  // What the preview can't show right now, in words, or ''.
  const motionNote = () => {
    const s = api.s, off = s.motion.level === 'off' || (s.motion.followSystem && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (off) return tr('Motion is off, so the preview holds still. Turn it on under Level to see these.');
    return '';
  };

  return { put, prune, byLine, lineStart, add, mount, render, el, slider, select, button, colors, status, tokenName, fromPreview, play, motionNote, tr };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR_X;
