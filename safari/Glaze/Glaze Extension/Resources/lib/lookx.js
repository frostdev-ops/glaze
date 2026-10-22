// Look extras (W12): the bundled stickers and pointers, sticker placements, and when Look rotation turns next.
// Everything here stays on this device (storage.local): placements per page under `stk:<origin><path>`, the student's
// own sticker pictures under `stkImg:<id>`, their own pointer in `cursorImg`, rotation's list in
// `rotateLooks` and its turn in `rotateState`. Classic script (lib/background.js, and loaded on demand by features/lookx.js;
// a second injection keeps the first); module.exports for node.
var GZ_LX = globalThis.GZ_LX || (() => {
  const G = typeof GZ_MATCH_PRESET !== 'undefined' ? { GZ_MATCH_PRESET } : require('../defaults.js');
  // Packs in assets/art/stickers/<pack>/<file>.webp, the file being the name lowercased and hyphenated.
  const PACKS = {
    study: ['Blank sticky note', 'Checkmark', 'Closed books', 'Coffee', 'Desk lamp', 'Graduation cap', 'Hourglass', 'Notebook', 'Open book', 'Pencil', 'Reading glasses', 'Star cluster'],
    'cozy-autumn': ['Acorn', 'Candle', 'Cinnamon bun', 'Cozy sock', 'Folded blanket', 'Knitted mittens', 'Maple leaf', 'Mushroom', 'Oak leaf', 'Pumpkin', 'Scarf', 'Steaming cocoa mug'],
    'space-sky': ['Comet', 'Constellation', 'Crescent moon', 'Earthlike planet', 'Fluffy cloud', 'Full moon', 'Rainbow', 'Ringed planet', 'Rocket', 'Shooting star', 'Sun', 'Telescope'],
    critters: ['Bumblebee', 'Gentle otter', 'Lilac hedgehog', 'Little mouse', 'Mint frog', 'Penguin chick', 'Red panda', 'Round owl', 'Seal pup', 'Sitting bunny', 'Small fox', 'Study buddy', 'Study buddy happy', 'Study buddy sleepy', 'Teal turtle'],
    habitat: ['Shelf', 'Pet bed', 'Kelp', 'Sandcastle', 'Toy ball', 'Yarn ball'],
  };
  const PACK_NAMES = { study: 'Study', 'cozy-autumn': 'Cozy autumn', 'space-sky': 'Space and sky', critters: 'Critters', habitat: 'Pet habitat' };
  const slug = (name) => name.toLowerCase().replace(/\W+/g, '-');
  // 'study/coffee' -> its name, for every bundled sticker.
  const BUNDLED = new Map(Object.entries(PACKS).flatMap(([p, names]) => names.map((n) => [`${p}/${slug(n)}`, n])));
  const file = (id) => `assets/art/stickers/${id}.webp`;
  // The pointer sets (assets/art/cursors/<set>/, 32 × 32): each one's hotspot, from assets/art/README.md. A set drawn as SVG
  // (`svg`) has default.svg and pointer.svg, with PNGs at 1x and 2x (default@2x.png) made from them for a browser that
  // won't draw an SVG cursor; the first three sets are PNG only. No set has a text cursor: text keeps the system's.
  const CURSORS = {
    aqua: { default: [7, 2], pointer: [14, 2] }, lilac: { default: [7, 2], pointer: [14, 2] }, pearl: { default: [3, 2], pointer: [14, 2] },
    aurora: { default: [4, 3], pointer: [12, 3], svg: true }, quill: { default: [4, 3], pointer: [12, 3], svg: true },
    terminal: { default: [4, 3], pointer: [12, 3], svg: true }, lava: { default: [4, 3], pointer: [12, 3], svg: true },
    neon: { default: [4, 3], pointer: [12, 3], svg: true }, clear: { default: [4, 3], pointer: [12, 3], svg: true },
    lagoon: { default: [4, 3], pointer: [12, 3], svg: true }, rose: { default: [4, 3], pointer: [12, 3], svg: true },
    ghost: { default: [4, 3], pointer: [12, 3], svg: true }, pumpkin: { default: [4, 3], pointer: [12, 3], svg: true },
  };
  // One cursor of a set as CSS: the SVG, then the PNGs (2x through image-set when the browser takes it, then 1x), then the
  // system's own. A browser goes down the list until it has one it can draw. url(file) is the extension's address.
  const cursorCss = (set, kind, url, imageSet = true) => {
    const c = CURSORS[set], at = c[kind].join(' '), base = `assets/art/cursors/${set}/${kind}`;
    if (!c.svg) return `url("${url(`${base}.png`)}") ${at}`;
    return [`url("${url(`${base}.svg`)}") ${at}`, imageSet && `image-set(url("${url(`${base}.png`)}") 1x, url("${url(`${base}@2x.png`)}") 2x) ${at}`, `url("${url(`${base}.png`)}") ${at}`].filter(Boolean).join(', ');
  };

  // ---- placements -------------------------------------------------------------------------------
  // A placement is { id, s: 'pack/name' | 'own:<id>', x: % of the page's width (its centre), y: px from the top, w: px, r: degrees }.
  const MAX_ON_PAGE = 200; // ponytail: a cap so one storage item stays small, not a limit anyone will meet
  const ID = /^[\w-]{1,40}$/;
  const OWN = /^own:[\w-]{1,40}$/;
  // A sticker a mod carries (mod.json packs.stickers): the mod's id and the sticker's, both as lib/media.js and lib/modbundle.js write them.
  const MOD = /^mod:[a-z2-7]{16}\/[a-z][a-z0-9-]{0,31}$/;
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : null);
  const placement = (p) => {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID.test(p.id) || typeof p.s !== 'string' || !(BUNDLED.has(p.s) || OWN.test(p.s) || MOD.test(p.s))) return null;
    const x = num(p.x, 0, 100), y = num(p.y, 0, 1e5), w = num(p.w, 24, 480), r = num(p.r, -45, 45);
    return x === null || y === null || w === null ? null : { id: p.id, s: p.s, x, y, w, r: r || 0 };
  };
  const clean = (list) => {
    const seen = new Set();
    return (Array.isArray(list) ? list.map(placement).filter((p) => p && !seen.has(p.id) && seen.add(p.id)) : []).slice(0, MAX_ON_PAGE);
  };
  // One change to a page's stickers, applied by the worker to what is stored now, so two tabs' changes both land:
  // { op: 'add', p } | { op: 'set', id, p: { x, y, w, r } } (its sticker stays what it is) | { op: 'del', id }.
  const apply = (list, m) => {
    list = clean(list);
    if (m?.op === 'add') return list.some((p) => p.id === m.p?.id) ? list : clean([...list, m.p]);
    if (m?.op === 'set') return list.map((p) => (p.id === m.id ? placement({ ...p, ...m.p, id: p.id, s: p.s }) || p : p));
    if (m?.op === 'del') return list.filter((p) => p.id !== m.id);
    return list;
  };
  // A quiz being taken or reviewed, or a tool's page, where no sticker ever shows: Canvas (Classic Quizzes, LTI tools
  // such as New Quizzes), Ultra (assessments) and Moodle (quiz attempts, summaries and reviews, LTI activities).
  const QUIET = /\/quizzes\/\d+\/(take|history)(\/|$)|\/external_tools\/|\/assessment\/|\/ultra\/.*\/(?:attempt|lti)(\/|$)|\/mod\/quiz\/(attempt|summary|review)\.php$|\/mod\/lti\/(view|launch)\.php$/;
  const quiet = (path, doc) => QUIET.test(path) || !!doc?.getElementById('tool_content');
  // The storage key of a page's stickers: its origin and path, without a trailing slash or what follows ? and #.
  const pageKey = (origin, path) => `stk:${origin}${path.replace(/(.)\/+$/, '$1')}`;
  const PAGE_KEY = /^stk:https?:\/\/[^/\s]+(\/\S*)?$/;

  // ---- the student's own pictures ---------------------------------------------------------------
  // A sticker picture (data URL, at most 256 px a side) and the pointer (at most 32 px) are scaled down on the device.
  const DATA = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/;
  const IMG_MAX = 200000; // characters of one picture's data URL
  const IMGS_MAX = 4000000; // all sticker pictures together: storage.local holds 10 MB in all
  const fit = (w, h, side) => { const k = Math.min(1, side / Math.max(w, h)); return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))]; };
  // Whether a picture of `size` characters fits beside the others: `all` is storage.local as read (get(null)), so every
  // picture kept counts, whatever wrote it.
  const imgIds = (all) => Object.keys(all || {}).filter((k) => k.startsWith('stkImg:')).map((k) => k.slice(7));
  const roomFor = (all, size) => size <= IMG_MAX && imgIds(all).reduce((n, id) => n + String(all[`stkImg:${id}`]).length, 0) + size <= IMGS_MAX;
  // What Reset everything deletes from storage.local: stickers, own pictures and pointer, files kept for a media background, rotation's list and turn.
  const RESET = (k) => /^(stk:|stkImg:|lookMedia:)/.test(k) || ['cursorImg', 'rotateLooks', 'rotateState'].includes(k);

  // ---- Look rotation ----------------------------------------------------------------------------
  const H = 36e5;
  const EVERY = { '6h': 6 * H, '12h': 12 * H, '24h': 24 * H, week: 168 * H };
  // When the Look worn since `last` (ms) is next changed, for rotation `mode` ('daily' at local `at`, "HH:MM"); null when off.
  const nextTurn = (mode, at, last) => {
    if (!Number.isFinite(last) || !(mode in EVERY || mode === 'daily')) return null;
    if (mode !== 'daily') return last + EVERY[mode];
    // Each day's time built afresh from the chosen hour and minute: a time a clock change skips (moved later that day)
    // is that day's alone, not carried to the days after.
    const d = new Date(last);
    for (let i = 0; i < 3; i++) {
      const t = +new Date(d.getFullYear(), d.getMonth(), d.getDate() + i, +at.slice(0, 2), +at.slice(3));
      if (t > last) return t;
    }
    return null;
  };
  // What rotation turns through: theme codes (favorites) and built-in Look names, as chosen; none chosen is every built-in Look.
  // `kept`, the favorites' codes: one removed from favorites has no box to untick, so it isn't turned to either.
  const rotation = (chosen, looks, kept) => {
    const fav = (v) => !kept || kept.includes(v);
    const list = Array.isArray(chosen) ? chosen.filter((v) => typeof v === 'string' && (v.startsWith('glaze1:') ? v.length <= 4000 && fav(v) : v.startsWith('glaze2:') ? v.length <= 20000 && fav(v) : looks.includes(v))) : [];
    return list.length ? [...new Set(list)] : [...looks];
  };
  // The settings to save for wearing a decoded theme code (lib/share.js) over `s`, as "Use this theme" does (options.js), minus
  // card styles (written through the cards queue) and the code's parts (the worker writes them in the same call). Every other
  // group the code carries goes in: a code that carries none leaves the student's own as they are.
  const wearCode = (s, got) => {
    const colors = got.colors;
    const share = typeof GZ_SHARE !== 'undefined' ? GZ_SHARE : require('./share.js');
    return {
      colors, preset: G.GZ_MATCH_PRESET(colors, s.presets), auto: { ...s.auto, on: false }, look: { ...s.look, ...got.look }, bg: { ...s.bg, ...got.bg },
      nav: share.nav(s.nav, got.nav || {}), navbar: { ...s.navbar, ...got.navbar }, sidebar: { ...s.sidebar, ...got.sidebar },
    };
  };
  // Did the stored state change because the Look turned (not because the clock started or the mode changed)?
  const turned = (was, now) => now?.turned === true && Number.isInteger(now.i) && now.i >= 0 && (!was || typeof was === 'object') && (!was || now.at !== was.at || now.i !== was.i || now.mode !== was.mode);
  // One rotation turn, given the stored state (storage.local rotateState), the time, the settings and the list.
  // → { state, wear } where wear is the index to wear now, or -1 for none. A new mode or time starts the clock over;
  // `now` true ("Next Look now") turns at once.
  const turn = (state, now, x, list, force = false) => {
    const mode = `${x.rotate} ${x.at}`;
    if (x.rotate === 'off' || !list.length) return { state, wear: -1 };
    if (!force && (!state || state.mode !== mode || !Number.isFinite(state.at) || state.at > now)) return { state: { mode, at: now, i: Number.isInteger(state?.i) ? state.i : -1 }, wear: -1 };
    if (!force && now < nextTurn(x.rotate, x.at, state.at)) return { state, wear: -1 };
    const i = ((Number.isInteger(state?.i) ? state.i : -1) + 1) % list.length;
    return { state: { mode, at: now, i, turned: true }, wear: i };
  };

  return { PACKS, PACK_NAMES, BUNDLED, slug, file, CURSORS, cursorCss, MAX_ON_PAGE, ID, MOD, placement, clean, apply, quiet, pageKey, PAGE_KEY, DATA, IMG_MAX, IMGS_MAX, fit, imgIds, roomFor, RESET, EVERY, nextTurn, rotation, wearCode, turn, turned };
})();

if (typeof module !== 'undefined') module.exports = GZ_LX; else GZ_LX;
