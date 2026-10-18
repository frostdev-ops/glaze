// Canvas course cards: what a card's own style and its bookmarks look like in storage, and what a style paints.
// Pure. Used by features/cards.js on the dashboard, by the editor (options.js) and by theme codes (lib/share.js).
// Classic script, loaded on demand on the dashboard (a second load keeps the first); module.exports for node.
//
// Three sync items, apart from GZ_SANITIZE's settings (so none of this weighs on the first content script):
// - `card`: the dashboard's card settings, SPEC below. The editor shows them with the rest; features/cards.js
//   paints them as --gz-card-* variables and data-gz-card-* attributes on <html> (canvas.css).
// - `cards`: { 'canvas:<origin>/<id>': style, '*': [style, ...] }. '*' is a theme's set (a theme code or a Look),
//   worn in turn by the cards that have no style of their own.
// Ultra keeps its own ucards/ulinks items and ultraCardImg pictures, so older clients cannot erase them.
// - `links`: { 'canvas:<origin>/<id>': [link, ...] }, a course's bookmarks.
// A style is { k: 'solid' | 'gradient' | 'image', c, d (#rrggbb), a (angle), u (an https picture) or i (a picture kept
// on this device: storage.local `cardImg:<i>`), o (overlay %), f (filter), x, y (focus %), z (zoom %) }. No style
// is Canvas's own color, as Canvas draws it.
var GZ_CARDS = globalThis.GZ_CARDS || (() => {
  // Colour math only for contrast(): looked up when it runs (the page has it; node requires it).
  const C = () => (typeof GZ_COLOR !== 'undefined' ? GZ_COLOR : require('./color.js'));
  const HEX = /^#[0-9a-f]{6}$/i;
  const KEY = /^(?:canvas:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d+|ultra:https:\/\/[a-z\d.-]+(?::\d+)?\/_\d+_\d+)$/i;
  const LOCAL = /^[a-z0-9]{12}$/;
  const ITEM_MAX = 8192; // what Chrome keeps in one sync item, key and JSON counted in bytes
  const SET_MAX = 8;
  const LINKS_MAX = 8;
  // A picture from this device, as a data URL: at most this many characters each, and all of them together.
  const IMG_MAX = 400000;
  const IMG_TOTAL = 4000000;
  const IMG_SIDE = 960; // the longest side it is scaled down to
  const DATA = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+=*$/;
  const FILTERS = {
    none: '', vivid: 'saturate(1.6) contrast(1.08)', mono: 'grayscale(1)', noir: 'grayscale(1) contrast(1.45) brightness(0.85)',
    warm: 'sepia(0.35) saturate(1.35) hue-rotate(-10deg)', cool: 'saturate(0.8) hue-rotate(12deg) brightness(1.05)',
    faded: 'contrast(0.78) saturate(0.7) brightness(1.12)', dreamy: 'blur(1.5px) saturate(1.25) brightness(1.08)',
  };
  // Bookmark icons: 24×24 stroke paths, drawn by Glaze. No favicons, so nothing is asked of the linked site.
  const ICONS = {
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
    video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
    chat: 'M4 5h16v11H9l-5 4z',
    doc: 'M6 3h8l4 4v14H6zM14 3v4h4M9 12h6M9 16h6',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    folder: 'M3 6h6l2 2h10v11H3z',
    code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
    star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4l-5.6 2.9 1.1-6.2L3 9.7l6.2-.9z',
    globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  };

  // Card settings, as GZ_SPEC writes them: [default, [min, max] | 'bool' | choices]. Sizes in px; -1 is the theme's own.
  const SPEC = {
    width: [262, [200, 420]], gap: [-1, [-1, 72]], radius: [-1, [-1, 32]], height: [146, [64, 260]], condensed: [false, 'bool'], overlay: [true, 'bool'],
    hover: ['lift', ['none', 'lift', 'glow', 'tilt', 'grow', 'shine']], particles: ['none', ['none', 'sparkles', 'snow', 'bubbles', 'confetti']],
    pet: ['none', ['none', 'selected', 'cat', 'bunny']], icons: [true, 'bool'], create: [false, 'bool'],
  };
  // What a theme code or a Look may carry: how cards look, not what they do.
  const LOOK = Object.keys(SPEC).filter((k) => !['icons', 'create'].includes(k));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const settings = (raw) => Object.fromEntries(Object.entries(SPEC).map(([k, [d, rule]]) => {
    const v = isObj(raw) ? raw[k] : undefined;
    const ok = rule === 'bool' ? typeof v === 'boolean' : typeof rule[0] === 'number' ? Number.isInteger(v) && v >= rule[0] && v <= rule[1] : rule.includes(v);
    return [k, ok ? v : d];
  }));
  // On <html>: sizes as variables ('initial' leaves the theme's own), choices as attributes (false: none).
  const page = (s) => ({
    vars: Object.fromEntries([['w', s.width], ['gap', s.gap], ['r', s.radius], ['h', s.height]].map(([n, v]) => [`--gz-card-${n}`, v < 0 ? 'initial' : `${v}px`])),
    attrs: { hover: s.hover, particles: s.particles, pet: s.pet, condensed: s.condensed && '', icons: s.icons && '', plain: !s.overlay && '' },
  });
  const bytes = (key, v) => new TextEncoder().encode(key + JSON.stringify(v)).length;
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  const hex = (v) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
  // href, not the raw string: the parser percent-encodes quotes and strips newlines, so it is safe inside url("…").
  const https = (v) => {
    try { const u = typeof v === 'string' && v.length <= 2048 && new URL(v); return u && u.protocol === 'https:' ? u.href : undefined; } catch { return undefined; }
  };

  // A style as stored, or null. Only what its kind uses is kept; the rest has defaults when painted.
  const style = (v) => {
    if (!isObj(v) || !['solid', 'gradient', 'image'].includes(v.k)) return null;
    const out = { k: v.k };
    const put = (k, x) => { if (x !== undefined) out[k] = x; };
    if (v.k !== 'image') {
      out.c = hex(v.c);
      if (!out.c) return null;
      if (v.k === 'gradient') {
        out.d = hex(v.d);
        if (!out.d) return null;
        put('a', int(v.a, 0, 360));
      }
      return out;
    }
    const u = https(v.u);
    if (u) out.u = u;
    else if (typeof v.i === 'string' && LOCAL.test(v.i)) out.i = v.i;
    else return null;
    put('c', hex(v.c));
    put('o', int(v.o, 0, 100));
    if (typeof v.f === 'string' && v.f !== 'none' && Object.hasOwn(FILTERS, v.f)) out.f = v.f;
    put('x', int(v.x, 0, 100));
    put('y', int(v.y, 0, 100));
    put('z', int(v.z, 100, 300));
    return out;
  };

  // The `cards` item: courses' styles, then the theme's set, kept only while the item fits in sync storage.
  const styles = (raw) => {
    const out = {};
    let set = [];
    if (isObj(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        const s = KEY.test(k) && style(v);
        if (s) out[k] = s;
      }
      if (Array.isArray(raw['*'])) set = raw['*'].map(style).filter((s) => s && !s.i).slice(0, SET_MAX);
    }
    if (set.length) out['*'] = set;
    while (bytes('cards', out) > ITEM_MAX) {
      const last = Object.keys(out).filter((k) => k !== '*').pop();
      if (last) delete out[last]; else out['*'].pop();
    }
    return out;
  };

  // A bookmark: a label, an https address or a path on the course's own site, an icon, and hidden or not.
  // A path is encoded as an address would be: no quote, space or backslash (which browsers read as a slash) left.
  const path = (v) => { try { return /^\/(?!\/)/.test(v) && v.length <= 1024 ? encodeURI(decodeURI(v)) : undefined; } catch { return undefined; } };
  const link = (v) => {
    if (!isObj(v) || typeof v.u !== 'string') return null;
    const u = v.u.startsWith('/') ? path(v.u) : https(v.u);
    if (!u) return null;
    const out = { n: typeof v.n === 'string' ? [...v.n.replace(/\s+/g, ' ').trim()].slice(0, 40).join('') : '', u, i: Object.hasOwn(ICONS, v.i) ? v.i : 'link' };
    if (v.h === true) out.h = true;
    return out;
  };
  const links = (raw) => {
    const out = {};
    for (const [k, list] of isObj(raw) ? Object.entries(raw) : []) {
      const l = KEY.test(k) && Array.isArray(list) ? list.map(link).filter(Boolean).slice(0, LINKS_MAX) : [];
      if (l.length) out[k] = l;
    }
    while (bytes('links', out) > ITEM_MAX) delete out[Object.keys(out).pop()];
    return out;
  };

  // The style card number `n` (in page order) wears: its own, or the theme set's in turn, or none.
  const pick = (cards, key, n) => cards[key] || (cards['*']?.length ? cards['*'][n % cards['*'].length] : null);

  // What a style paints: the card's attribute and its variables (canvas.css). `src` is the picture's address
  // (a data URL for one on this device); without one, a picture style paints nothing.
  const paint = (s, src, scope = 'card') => {
    if (!s || !['solid', 'gradient', 'image'].includes(s.k) || (s.k === 'image' && !src)) return null;
    const values = s.k === 'solid' ? { c: s.c } : s.k === 'gradient'
      ? { c: s.c, grad: `linear-gradient(${s.a ?? 135}deg, ${s.c}, ${s.d})` }
      : { img: `url("${src}")`, pos: `${s.x ?? 50}% ${s.y ?? 50}%`, zoom: String((s.z ?? 100) / 100),
        filter: (Object.hasOwn(FILTERS, s.f) && FILTERS[s.f]) || 'none', ov: s.c || 'var(--gz-course)', 'ov-a': String((s.o ?? 60) / 100) };
    return { kind: s.k, vars: Object.fromEntries(Object.entries(values).map(([k, v]) => [`--gz-${scope}-${k}`, v])) };
  };

  // `top` at opacity `a` over `under`, channel by channel in sRGB: how the browser paints an overlay with opacity, and
  // the midpoint of a plain linear-gradient(). Not GZ_COLOR.mix, which mixes in OKLab.
  const over = (under, top, a) => {
    const [u, t] = [C().parse(under), C().parse(top)];
    return C().hex({ r: u.r + (t.r - u.r) * a, g: u.g + (t.g - u.g) * a, b: u.b + (t.b - u.b) * a });
  };
  // How well white text reads on the card's picture area (condensed cards put the name there): the worst ratio over
  // the colors painted behind it. For a picture, `avg` is its average color as filtered (null when the browser won't
  // let it be read), `course` the color its overlay takes by default, and `overlay` false when the overlay is off
  // (card.overlay), as canvas.css then hides it. Null when it can't be told.
  const contrast = (s, { avg = null, course = '#808080', ink = '#ffffff', overlay = true } = {}) => {
    if (!s) return null;
    let behind;
    if (s.k === 'solid') behind = [s.c];
    else if (s.k === 'gradient') behind = [s.c, s.d, over(s.c, s.d, 0.5)];
    else {
      if (!avg) return null;
      behind = [overlay ? over(avg, s.c || course, (s.o ?? 60) / 100) : avg];
    }
    return Math.min(...behind.map((b) => C().contrast(ink, b)));
  };

  // A picture's size scaled down to fit IMG_SIDE, never up.
  const fit = (w, h, side = IMG_SIDE) => {
    const k = Math.min(1, side / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  };
  // Shared by the card and sidebar editors; decoding never leaves its bitmap open.
  const picture = async (file) => {
    const bmp = await createImageBitmap(file);
    try {
      const { w, h } = fit(bmp.width, bmp.height);
      const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      let url = c.toDataURL('image/webp', 0.82);
      if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', 0.85);
      if (url.length > IMG_MAX) throw new Error('cap');
      return url;
    } finally { bmp.close?.(); }
  };
  const average = (url, f) => new Promise((res) => {
    const im = new Image();
    if (!url.startsWith('data:')) im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const c = Object.assign(document.createElement('canvas'), { width: 8, height: 8 });
        const x = c.getContext('2d', { willReadFrequently: true });
        x.filter = FILTERS[f] || 'none';
        x.drawImage(im, 0, 0, 8, 8);
        const p = x.getImageData(0, 0, 8, 8).data;
        const sum = [0, 0, 0];
        for (let i = 0; i < p.length; i += 4) for (let j = 0; j < 3; j++) sum[j] += p[i + j];
        res(C().hex({ r: sum[0] / 64, g: sum[1] / 64, b: sum[2] / 64 }));
      } catch { res(null); }
    };
    im.onerror = () => res(null);
    im.src = url;
  });
  // Every picture kept on this device, { id: size }, read from storage.local's own keys (`all` is what get(null)
  // returns), so none can hide from the cap or the clean-up.
  const kept = (all) => Object.fromEntries(Object.entries(isObj(all) ? all : {}).filter(([k]) => /^cardImg:/.test(k)).map(([k, v]) => [k.slice(8), String(v).length]));
  // Whether a picture of `size` characters may be kept beside all the others ({ id: size }), the one it replaces
  // included: that goes only once the new style is saved.
  const room = (size, others = {}) => size <= IMG_MAX && Object.values(others).reduce((n, v) => n + (+v || 0), 0) + size <= IMG_TOTAL;
  // The local pictures no style uses any more (`cards` as stored): theirs to delete.
  const orphans = (cards, kept = {}) => {
    const used = new Set(Object.values(isObj(cards) ? cards : {}).map((s) => s?.i).filter(Boolean));
    return Object.keys(kept).filter((id) => !used.has(id));
  };

  // ---- writing: one change at a time, applied to what storage holds when its turn comes ----
  // Every write of `cards`, `links` and the pictures goes through change(), run by lib/background.js in queue() order:
  // the worker is one for the whole extension, so tabs on any school's site and the editor page wait for each other.
  // The picture cap is checked, the picture written, the style saved and orphans deleted in one turn.
  // `area` is { sync, local }, each { get(keys) → object, set(patch) → bool, remove(keys) → bool }.
  // op: { key, style, links, image } — a course's style (null: none), its bookmarks (when given) and a new picture's
  //     data URL, which becomes the style's own (`i`);
  //     { set: [style] } — a theme's set ([] drops it); { replace: { cards, links } } — an import; { reset: true }.
  // → { ok: true, id (the new picture's) } or { ok: false, error: 'sync' (over a sync item) | 'cap' | 'write' }.
  const queue = () => {
    let last = Promise.resolve();
    return (fn) => { const run = last.then(fn); last = run.catch(() => {}); return run; };
  };
  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const navSettings = (raw) => (typeof GZ_SANITIZE === 'function' ? GZ_SANITIZE : require('../defaults.js').GZ_SANITIZE)({ nav: raw }).nav;
  const change = async (op, area) => {
    const pics = async () => kept(await area.local.get(null));
    const r = await area.sync.get(['cards', 'links', 'nav']);
    const capacity = async () => Object.fromEntries(Object.entries(await area.local.get(null)).filter(([k]) => /^(?:cardImg|ultraCardImg|navLogo):/.test(k)).map(([k, v]) => [k, String(v).length]));
    const nav = navSettings({ ...r.nav, ...op.nav });
    if (nav.k !== 'image' || nav.u) nav.i = '';
    // Styles first: pictures go only once no saved style can point at them.
    if (op.reset) {
      if (op.nav && !await area.sync.set({ nav })) return { ok: false, error: 'write' };
      if (!await area.sync.remove(['cards', 'links'])) return { ok: false, error: 'write' };
      // The styles are gone; pictures left behind are orphans the next change (or a retried reset) removes.
      if (!await area.local.remove(orphans({ nav }, await pics()).map((i) => `cardImg:${i}`))) return { ok: false, error: 'write' };
      return { ok: true };
    }
    const was = { cards: styles(r.cards), links: links(r.links) };
    let cards = { ...was.cards }, all = { ...was.links }, id = null;
    if (op.nav && op.image) {
      if (typeof op.image !== 'string' || !DATA.test(op.image) || !room(op.image.length, await capacity())) return { ok: false, error: 'cap' };
      id = newId();
      Object.assign(nav, { k: 'image', u: '', i: id });
    }
    if (op.replace) { cards = styles(op.replace.cards); all = links(op.replace.links); }
    if (op.set) {
      const set = (Array.isArray(op.set) ? op.set : []).map(style).filter((s) => s && !s.i).slice(0, SET_MAX);
      if (set.length) cards['*'] = set; else delete cards['*'];
    }
    if (op.key) {
      if (!KEY.test(op.key)) return { ok: false, error: 'write' };
      let st = op.style ? style(op.style) : null;
      if (op.image) {
        if (typeof op.image !== 'string' || !DATA.test(op.image) || !room(op.image.length, await capacity())) return { ok: false, error: 'cap' };
        id = newId();
        st = style({ ...op.style, k: 'image', i: id, u: undefined });
      }
      if (st) cards[op.key] = st; else delete cards[op.key];
      if (Array.isArray(op.links)) {
        const l = op.links.map(link).filter(Boolean).slice(0, LINKS_MAX);
        if (l.length) all[op.key] = l; else delete all[op.key];
      }
    }
    if (bytes('cards', cards) > ITEM_MAX || bytes('links', all) > ITEM_MAX) return { ok: false, error: 'sync' };
    if (id && !await area.local.set({ [`cardImg:${id}`]: op.image })) return { ok: false, error: 'write' };
    const patch = {};
    if (op.nav) patch.nav = nav;
    if (JSON.stringify(cards) !== JSON.stringify(was.cards)) patch.cards = cards;
    if (JSON.stringify(all) !== JSON.stringify(was.links)) patch.links = all;
    if (Object.keys(patch).length && !await area.sync.set(patch)) {
      if (id) await area.local.remove([`cardImg:${id}`]);
      return { ok: false, error: 'write' };
    }
    // A picture goes only once no stored style uses it: the one just replaced, or one left behind by anything else.
    const gone = orphans({ ...cards, nav }, await pics());
    const cleanup = !gone.length || await area.local.remove(gone.map((i) => `cardImg:${i}`));
    return { ok: true, id, ...(op.nav && { nav }), ...(!cleanup && { cleanup: false }) };
  };

  // Older Glaze rewrites the Canvas items and removes cardImg orphans. Keep Ultra in separate items and picture keys.
  const ultraChange = async (op, area) => {
    if (op.nav) return { ok: false, error: 'write' };
    if (op.image) {
      const all = await area.local.get(null);
      const sizes = Object.fromEntries(Object.entries(all).filter(([k]) => /^(?:cardImg|ultraCardImg|navLogo):/.test(k)).map(([k, v]) => [k, String(v).length]));
      if (!room(op.image.length, sizes)) return { ok: false, error: 'cap' };
    }
    const key = (k) => ({ cards: 'ucards', links: 'ulinks' })[k] || k;
    const pictureKey = (k) => k.replace(/^cardImg:/, 'ultraCardImg:');
    return change(op, {
      sync: {
        get: async (keys) => { const r = await area.sync.get(keys.filter((k) => k !== 'nav').map(key)); return Object.fromEntries(keys.filter((k) => k !== 'nav' && key(k) in r).map((k) => [k, r[key(k)]])); },
        set: (patch) => { const mapped = Object.fromEntries(Object.entries(patch).map(([k, v]) => [key(k), v])); return Object.entries(mapped).some(([k, v]) => bytes(k, v) > ITEM_MAX) ? Promise.resolve(false) : area.sync.set(mapped); },
        remove: (keys) => area.sync.remove(keys.map(key)),
      },
      local: {
        get: async () => Object.fromEntries(Object.entries(await area.local.get(null)).filter(([k]) => k.startsWith('ultraCardImg:')).map(([k, v]) => [k.replace(/^ultraCardImg:/, 'cardImg:'), v])),
        set: (patch) => area.local.set(Object.fromEntries(Object.entries(patch).map(([k, v]) => [pictureKey(k), v]))),
        remove: (keys) => area.local.remove(keys.map(pictureKey)),
      },
    });
  };

  return { SPEC, LOOK, settings, page, KEY, ITEM_MAX, SET_MAX, LINKS_MAX, IMG_MAX, IMG_TOTAL, DATA, FILTERS, ICONS, bytes, style, styles, link, links, pick, paint, over, contrast, fit, picture, average, kept, room, orphans, queue, change, ultraChange };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value (lib/background.js).
if (typeof module !== 'undefined') module.exports = GZ_CARDS; else GZ_CARDS;
