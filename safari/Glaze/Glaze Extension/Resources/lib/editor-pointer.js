// The student's pointer, under Look › Pointer: which pointer they see with every Look, and whether its animation plays
// (settings extras.pointer and extras.pointerAnim, defaults.js). It is theirs, not the Look's: never written into a Look's
// parts or a theme code, and it stays when they change Looks. A picture of their own is kept on this computer (storage.local
// cursorImg, lib/lookx.js). The page wears it through features/lookx.js (GZ_LX.pointerOf), the editor's preview too.
// One card per pointer in a radio group, as the editor's other pickers are: each shows its arrow and hand on a stage half
// light and half dark, as pages are, and hovering one wears its hand. Extension settings page only; the tile list and
// what each tile shows have module.exports for node.
var GZ_EDITOR_POINTER = globalThis.GZ_EDITOR_POINTER || (() => {
  const X = typeof GZ_EDITOR_X !== 'undefined' ? GZ_EDITOR_X : require('./editor-x.js');
  const LX = () => (typeof GZ_LX !== 'undefined' ? GZ_LX : require('./lookx.js'));
  const XM = () => (typeof GZ_EDITOR_XMOTION !== 'undefined' ? GZ_EDITOR_XMOTION : require('./editor-xmotion.js'));
  // The cards, in order: the Look's, the system's, every bundled set, the student's own picture. The same list as the
  // setting takes (defaults.js GZ_SPEC.extras.pointer).
  const TILES = () => ['look', 'off', ...Object.keys(LX().CURSORS), 'own'];
  const NAMES = { look: "The Look's pointer", off: 'System pointer', own: 'Your own picture' };
  const nameOf = (v) => NAMES[v] || XM().POINTERS[v] || v;
  // What a card shows: a set ('aqua'), the system's ('off') or the student's picture ('own'). The Look's card shows what the
  // Look wears, which may be none: the system's.
  const shows = (v, look) => (v === 'look' ? (look && look !== 'look' ? look : 'off') : v);
  // A set's arrow and hand, as the extension's files.
  const files = (set) => { const c = LX().CURSORS[set]; return c ? ['default', 'pointer'].map((k) => `assets/art/cursors/${set}/${k}.${c.svg ? 'svg' : 'png'}`) : null; };
  // The cursor a card wears while the pointer is over it: its hand, else the system's.
  const hover = (what, own = '', url = (f) => f) => (LX().CURSORS[what] ? `${LX().cursorCss(what, 'pointer', url)}, pointer` : what === 'own' && own ? `url("${own}") 0 0, pointer` : '');

  // ---- the page ---------------------------------------------------------------------------------------------------------
  let A = null, box = null, cards = [], own = '', shown = '';
  const { el, tr } = X;
  const local = () => chrome.storage.local;
  const x = () => A.s.parts?.x || {};
  const sig = () => JSON.stringify([x().pointer, A.s.extras.pointer, x().cursor?.kind, own]);
  // The system's arrow and hand, drawn: black with a white edge, as most systems draw them.
  const SYSTEM = ['M5 2.5V24l5.2-4.7 3.6 7.9 3.6-1.6-3.5-7.7h6.9z',
    'M12 3.2c1.1 0 2 .9 2 2v8.3l.4-.1c1.1-.3 2.2.3 2.5 1.4l.1.3.4-.1c1.1-.3 2.2.3 2.5 1.4l.1.4h.3c1.1-.1 2.1.7 2.2 1.8l.4 4c.2 2.4-.4 4.8-1.8 6.7l-.9 1.1h-7.6l-5-6.6-2.2-3.3c-.6-.9-.4-2.1.5-2.8.9-.6 2.1-.5 2.8.3l1.3 1.6V5.2c0-1.1.9-2 2-2z'];
  const drawn = (d) => {
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
    return f ? f.map((src) => el('img', { src, alt: '', width: 32, height: 32 })) : SYSTEM.map(drawn);
  };
  // The Look's card says what the Look wears; the student's picture's card says when there is none yet.
  const note = (v) => {
    if (v === 'look') { const p = x().pointer; return tr(p ? nameOf(p) : 'System pointer'); }
    return v === 'own' && !own ? tr('No picture yet') : '';
  };

  const choose = (v) => {
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
    return { v, input, stage, sub, label: el('label', { 'data-pointer': v }, input, stage, el('b', {}, tr(nameOf(v))), sub), what: null };
  };
  // Puts every card in line with the state: which is chosen, what the Look's card and the picture's card show.
  const paint = () => {
    const look = x().pointer, chosen = A.s.extras.pointer;
    for (const c of cards) {
      c.input.checked = c.v === chosen;
      if (c.v === 'own') c.input.disabled = !own && chosen !== 'own';
      const what = shows(c.v, look), key = what === 'own' ? `own ${own}` : what;
      if (c.what !== key) { c.what = key; c.stage.replaceChildren(...pictures(what)); c.label.style.cursor = hover(what, own); }
      const said = note(c.v);
      if (c.sub.textContent !== said) c.sub.textContent = said;
      c.sub.hidden = !said;
    }
    const pick = document.getElementById('pointer-pick');
    pick.textContent = tr(own ? 'Replace picture…' : 'Choose a picture…');
    document.getElementById('pointer-remove').hidden = !own;
    const anim = x().cursor?.kind;
    document.getElementById('pointer-anim-look').textContent = anim ? tr("This Look's: {name}", { name: tr(X.tokenName(anim)) }) : tr('This Look has no pointer animation.');
    shown = sig();
  };

  // Read and scaled here, kept as PNG: SVG and anything else the browser can't draw as a bitmap is refused. A new picture is
  // the pointer from then on.
  const take = async (f) => {
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { return A.hint(tr("That file isn't a picture Glaze can read."), true); }
    const [w, h] = LX().fit(bmp.width, bmp.height, 32);
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const data = c.toDataURL('image/png');
    local().set({ cursorImg: data }, () => {
      const err = chrome.runtime.lastError;
      if (err) return A.hint(tr('Not saved: {error}', { error: err.message }), true);
      own = data;
      if (A.s.extras.pointer === 'own') { paint(); A.preview(); } else choose('own');
    });
  };
  // Removing the picture that is the pointer gives the Look's back.
  const drop = () => local().remove('cursorImg', () => {
    if (chrome.runtime.lastError) return A.hint(tr('Not saved: {error}', { error: chrome.runtime.lastError.message }), true);
    own = '';
    if (A.s.extras.pointer === 'own') choose('look'); else paint();
    document.getElementById('pointer-pick').focus();
  });

  const mount = (api) => {
    A = api;
    box = document.getElementById('pointer-tiles');
    if (!box) return;
    cards = TILES().map(card);
    box.replaceChildren(...cards.map((c) => c.label));
    const file = document.getElementById('pointer-file');
    document.getElementById('pointer-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) take(f); });
    document.getElementById('pointer-remove').addEventListener('click', (e) => { if (e.isTrusted) drop(); });
    local().get('cursorImg', (r) => { own = (!chrome.runtime.lastError && LX().DATA.test(r?.cursorImg || '') && r.cursorImg) || ''; paint(); });
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !c.cursorImg) return;
      own = LX().DATA.test(c.cursorImg.newValue || '') ? c.cursorImg.newValue : '';
      paint();
    });
    paint();
  };
  const render = () => {
    if (!A || !box) return;
    if (sig() !== shown) paint();
  };

  if (typeof document !== 'undefined') X.add({ mount, render });
  return { TILES, NAMES, nameOf, shows, files, hover };
})();
if (typeof module !== 'undefined') module.exports = GZ_EDITOR_POINTER;
