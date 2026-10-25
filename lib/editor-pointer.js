// The student's pointer, under Look › Pointer: whether Glaze draws one at all, which they see with every Look, and whether
// its animation plays (settings extras.pointerOn, extras.pointer and extras.pointerAnim, defaults.js). It is theirs, not the
// Look's: never written into a Look's parts or a theme code, and it stays when they change Looks. A picture of their own is
// kept on this computer (storage.local cursorImg, lib/lookx.js). The page wears it through features/lookx.js
// (GZ_LX.pointerOf), the editor's preview too. The switch is a data-key control options.js fills and saves; switched off,
// the cards and the animation switch are hidden, and the choice is kept for when it is back on.
// One card per pointer in a radio group, as the editor's other pickers are: each shows its arrow and hand on a stage half
// light and half dark, as pages are, and hovering one wears its hand. Their own picture's card, before there is one, is a
// button that asks for one. Under This Look's pointer, the Look's own set (x.pointer) and the cursor effect around it
// (x.cursor), written to the Look's parts through A.write as the other Look builders do. Extension settings page only; the
// tile list and what each tile shows have module.exports for node.
var GZ_EDITOR_POINTER = globalThis.GZ_EDITOR_POINTER || (() => {
  const X = typeof GZ_EDITOR_X !== 'undefined' ? GZ_EDITOR_X : require('./editor-x.js');
  const LX = () => (typeof GZ_LX !== 'undefined' ? GZ_LX : require('./lookx.js'));
  const MX = () => (typeof GZ_MX !== 'undefined' ? GZ_MX : require('./motionx.js'));
  const XM = () => (typeof GZ_EDITOR_XMOTION !== 'undefined' ? GZ_EDITOR_XMOTION : require('./editor-xmotion.js'));
  // The cards, in order: the Look's, every bundled set, the student's own picture. The same list as the
  // setting takes (defaults.js GZ_SPEC.extras.pointer).
  const TILES = () => ['look', ...Object.keys(LX().CURSORS), 'own'];
  const NAMES = { look: "The Look's pointer", own: 'Your own picture' };
  const nameOf = (v) => NAMES[v] || XM().POINTERS[v] || v;
  // What a card shows: a set ('aqua'), the system's ('off') or the student's picture ('own'). The Look's card shows what the
  // Look wears, which may be none: the system's.
  const shows = (v, look) => (v === 'look' ? (look && look !== 'look' ? look : 'off') : v);
  // A set's arrow and hand, as the extension's files.
  const files = (set) => { const c = LX().CURSORS[set]; return c ? ['default', 'pointer'].map((k) => `assets/art/cursors/${set}/${k}.${c.svg ? 'svg' : 'png'}`) : null; };
  // The cursor a card wears while the pointer is over it: its hand, else the system's.
  const hover = (what, own = '', url = (f) => f) => (LX().CURSORS[what] ? `${LX().cursorCss(what, 'pointer', url)}, pointer` : what === 'own' && own ? `url("${own}") 0 0, pointer` : '');

  // ---- the page ---------------------------------------------------------------------------------------------------------
  let A = null, box = null, cards = [], own = '', shown = '', taking = 0, reading = 0, look = null, drawn = '';
  const { el, tr } = X;
  const local = () => chrome.storage.local;
  const x = () => A.s.parts?.x || {};
  const sig = () => JSON.stringify([x().pointer, A.s.extras.pointer, A.s.extras.pointerOn, x().cursor?.kind, own]);
  const lookSig = () => JSON.stringify([x().pointer, x().cursor]);
  // The system's arrow and hand, drawn: black with a white edge, as most systems draw them.
  const SYSTEM = ['M5 2.5V24l5.2-4.7 3.6 7.9 3.6-1.6-3.5-7.7h6.9z',
    'M12 3.2c1.1 0 2 .9 2 2v8.3l.4-.1c1.1-.3 2.2.3 2.5 1.4l.1.3.4-.1c1.1-.3 2.2.3 2.5 1.4l.1.4h.3c1.1-.1 2.1.7 2.2 1.8l.4 4c.2 2.4-.4 4.8-1.8 6.7l-.9 1.1h-7.6l-5-6.6-2.2-3.3c-.6-.9-.4-2.1.5-2.8.9-.6 2.1-.5 2.8.3l1.3 1.6V5.2c0-1.1.9-2 2-2z'];
  const arrow = (d) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    const p = document.createElementNS(s.namespaceURI, 'path');
    for (const [k, v] of Object.entries({ d, fill: '#000', stroke: '#fff', 'stroke-width': '1.5', 'stroke-linejoin': 'round' })) p.setAttribute(k, v);
    s.append(p);
    return s;
  };
  const pictures = (what) => {
    if (what === 'own') return own ? [own, own].map((src) => el('img', { src, alt: '', width: 32, height: 32 })) : [el('span', { class: 'pt-none' }, '+')];
    const f = files(what);
    return f ? f.map((src) => el('img', { src, alt: '', width: 32, height: 32 })) : SYSTEM.map(arrow);
  };
  // The Look's card says what the Look wears; the student's picture's card, before there is one, what it does.
  const note = (v) => {
    if (v === 'look') { const p = x().pointer; return tr(p ? nameOf(p) : 'System pointer'); }
    return v === 'own' && !own ? tr('Choose a picture…') : '';
  };

  const choose = (v) => {
    taking++;
    if (A.s.extras.pointer === v) return;
    A.s.extras.pointer = v;
    A.preview();
    A.save(['extras']);
    paint();
  };
  const card = (v) => {
    const input = el('input', { type: 'radio', name: 'extras.pointer', value: v, 'data-local': true, onchange: () => { if (input.checked) choose(v); } });
    const stage = el('span', { class: 'pt-stage', 'aria-hidden': 'true' });
    const sub = el('span', { class: 'desc' });
    const parts = [stage, el('b', {}, tr(nameOf(v))), sub];
    // Their own picture, before there is one: a button out of the arrow keys' way that opens the file chooser.
    const ask = v === 'own' && el('button', { type: 'button', 'data-pointer': v, onclick: () => document.getElementById('pointer-file').click() });
    return { v, input, stage, sub, parts, ask, label: el('label', { 'data-pointer': v }, input, ...parts), what: null, asking: false };
  };
  // Puts every card in line with the state: which is chosen, what the Look's card and the picture's card show.
  const paint = () => {
    const look = x().pointer, chosen = A.s.extras.pointer;
    document.getElementById('pointer-body').hidden = A.s.extras.pointerOn === false;
    for (const c of cards) {
      c.input.checked = c.v === chosen;
      if (c.ask && c.asking !== (!own && chosen !== 'own')) {
        const had = document.activeElement && [c.ask, c.input].includes(document.activeElement);
        c.asking = !c.asking;
        if (c.asking) c.ask.replaceChildren(...c.parts); else c.label.replaceChildren(c.input, ...c.parts);
        box.replaceChildren(...cards.map((d) => (d.asking ? d.ask : d.label)));
        if (had) (c.asking ? c.ask : c.input).focus();
      }
      const what = shows(c.v, look), key = what === 'own' ? `own ${own}` : what;
      if (c.what !== key) { c.what = key; c.stage.replaceChildren(...pictures(what)); c.label.style.cursor = hover(what, own); }
      const said = note(c.v);
      if (c.sub.textContent !== said) c.sub.textContent = said;
      c.sub.hidden = !said;
    }
    document.getElementById('pointer-own').hidden = !own;
    const anim = x().cursor?.kind;
    document.getElementById('pointer-anim-look').textContent = anim ? tr("This Look's: {name}", { name: tr(X.tokenName(anim)) }) : tr('This Look has no pointer animation.');
    shown = sig();
  };

  // Read and scaled here, kept as PNG: SVG and anything else the browser can't draw as a bitmap is refused. A new picture is
  // the pointer from then on.
  const take = async (f) => {
    const g = ++taking;
    if (!['image/png', 'image/jpeg'].includes(f.type)) return A.hint(tr("This browser can't open that picture. Save it as PNG or JPEG and choose that."), true);
    if (f.size > 5 * 1024 * 1024) return A.hint(tr('That file is too big for this kind (the most is {max}).', { max: '5 MiB' }), true);
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { return A.hint(tr("That file isn't a picture Glaze can read."), true); }
    if (g !== taking) { bmp.close(); return; }
    const [w, h] = LX().fit(bmp.width, bmp.height, 32);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const data = c.toDataURL('image/png');
    local().set({ cursorImg: data }, () => {
      const err = chrome.runtime.lastError;
      if (g !== taking) return;
      if (err) return A.hint(tr('Not saved: {error}', { error: err.message }), true);
      reading++; own = data;
      if (A.s.extras.pointer === 'own') { paint(); A.preview(); } else choose('own');
    });
  };
  // Removing the picture that is the pointer gives the Look's back; focus goes to the card that asks for another.
  const drop = () => { taking++; local().remove('cursorImg', () => {
    if (chrome.runtime.lastError) return A.hint(tr('Not saved: {error}', { error: chrome.runtime.lastError.message }), true);
    reading++; own = '';
    if (A.s.extras.pointer === 'own') choose('look'); else paint();
    cards.find((c) => c.ask)?.ask.focus();
  }); };

  // ---- This Look's pointer: the Look's set and the cursor effect around it (the Look's parts) ---------------------------------
  const unit = (u) => (v) => `${v}${u}`;
  const write = (key, value, soon = false) => { A.write(key, value && X.prune(value), soon); drawn = lookSig(); };
  // Redraws the group, then puts focus back on the control that asked (data-focus), so the keyboard keeps its place.
  const redraw = (focus) => { drawLook(); if (focus) look.querySelector(`[data-focus="${CSS.escape(focus)}"]`)?.focus(); };
  // The Look's pointer: one of the sets, or the system's. The student's own picture is offered only to a Look that wears it
  // already: a picture is the student's choice, in the cards above.
  const pointerUI = () => {
    const v = x().pointer || '';
    const pick = X.select({ label: tr('Pointer'), value: v, options: [['', tr('Standard')], ...MX().POINTERS.filter((k) => k !== 'own' || v === 'own').map((k) => [k, tr(XM().POINTERS[k] || X.tokenName(k))])],
      on: (next) => { A.write('pointer', next || null); drawn = lookSig(); redraw('pointer'); paint(); } });
    pick.querySelector('select').dataset.focus = 'pointer';
    return [pick, el('p', { class: 'desc' }, tr(v === 'own' ? 'Your own picture, kept on this computer: a theme code of this Look goes without it.'
      : 'Worn with this Look, and in a theme code of it. Drawn by your system so it never lags; text fields keep the usual text cursor.'))];
  };
  const cursorUI = () => {
    const c = x().cursor, d = c && MX().cursor(c), few = ['orbit', 'contour'].includes(c?.kind), cap = c?.kind === 'contour' ? 3 : 6; // marks that are counted, not a length
    const set = (k) => (v, soon) => write('cursor', { ...x().cursor, [k]: v }, soon);
    const kind = X.select({ label: tr('Cursor effect'), value: c?.kind || '', options: [['', tr('None')], ...MX().CURSORS.map((k) => [k, tr(X.tokenName(k))])], on: (v) => { write('cursor', v ? { ...x().cursor, kind: v } : null); redraw('cursor'); paint(); } });
    kind.querySelector('select').dataset.focus = 'cursor';
    return [kind, ...(c ? [
      X.colors({ label: tr('Colours'), list: c.c || [], max: 3, none: tr('The accent colour'), on: (v, soon) => { set('c')(v, soon); if (!soon) redraw('cursor'); } }),
      X.slider({ label: tr('Size'), min: 2, max: 48, value: d.size, fmt: unit('px'), on: set('size') }),
      ['orbit', 'drift', 'sparkle'].includes(c.kind) && X.select({ label: tr('Shape'), value: d.shape || '', options: [...(c.kind === 'sparkle' ? [['', tr('Sparks and stars')]] : []), ...MX().SHAPES.concat(MX().MARKS).map((k) => [k, tr(X.tokenName(k))])],
        on: (v) => { write('cursor', { ...x().cursor, shape: v || null }); redraw('cursor'); } }),
      !['glow', 'flicker', 'scan'].includes(c.kind) && X.slider({ label: tr(few ? 'How many' : 'Length'), min: c.kind === 'orbit' ? 1 : 2, max: few ? cap : 24, value: few ? Math.min(cap, d.len) : d.len, on: set('len') }),
      X.slider({ label: tr('Fade'), min: 100, max: 2000, step: 50, value: d.fade, fmt: unit(' ms'), on: set('fade') }),
      el('p', { class: 'desc' }, tr('Move the pointer over the preview to see it. Off on touch screens.')),
    ] : [])];
  };
  const drawLook = () => {
    drawn = lookSig();
    look.replaceChildren(...[pointerUI(), cursorUI()].flat().filter(Boolean));
  };

  const mount = (api) => {
    A = api;
    box = document.getElementById('pointer-tiles');
    if (!box) return;
    cards = TILES().map(card);
    box.replaceChildren(...cards.map((c) => c.label));
    const host = document.getElementById('x-pointer');
    look = el('div', { class: 'x-motion' });
    host.append(look, el('p', { class: 'desc', 'data-x-storage': true, role: 'status', hidden: true }));
    drawLook();
    // Reset section takes the Look's pointer and cursor effect out too (one save after the section's own).
    document.querySelector('[data-reset-section="look/pointer"]')?.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      for (const k of ['pointer', 'cursor']) write(k, null, true);
      A.save(['parts'], false, ['pointer', 'cursor']);
      drawLook();
      paint();
    });
    const file = document.getElementById('pointer-file');
    document.getElementById('pointer-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) take(f); });
    document.getElementById('pointer-remove').addEventListener('click', (e) => { if (e.isTrusted) drop(); });
    const g = reading;
    local().get('cursorImg', (r) => { if (g !== reading) return; own = (!chrome.runtime.lastError && LX().DATA.test(r?.cursorImg || '') && r.cursorImg) || ''; paint(); });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !c.cursorImg) return;
      reading++;
      own = LX().DATA.test(c.cursorImg.newValue || '') ? c.cursorImg.newValue : '';
      paint();
    });
    paint();
  };
  const render = () => {
    if (!A || !box) return;
    if (lookSig() !== drawn) drawLook();
    if (sig() !== shown) paint();
  };

  if (typeof document !== 'undefined') X.add({ mount, render });
  return { TILES, NAMES, nameOf, shows, files, hover };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR_POINTER;
