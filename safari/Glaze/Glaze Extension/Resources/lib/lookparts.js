// Look parts: what a theme code can carry beyond palette, look and background, as data
// Glaze interprets along fixed paths: custom backgrounds, animations, event effects, a cursor effect, a nav layout and
// restyle rules. `x` holds the parts and `m` the mods a Look works with. Both arrive from other people, so every value
// is cleaned here before anything reads it, and a code whose parts don't come back unchanged is refused whole.
//
// The global is GZ_XPARTS: features/lookx.js (stickers, pointer, rotation) already owns GZ_LOOKX.
//
// - A cleaner is `clean(raw) -> part | null`; null refuses. Numbers are clamped to their range and rounded, text is made
//   one line, colours are a palette token name (`accent`, as GZ_COLORS without `--gz-`) or `#rrggbb`. An unknown key, a
//   wrong type, a list over its limit or a part with nothing in it refuses; nothing is truncated or dropped. (x.nav is
//   cleaned by lib/navlayout.js, which drops entries that don't fit; a code that loses any no longer matches, so it is
//   refused all the same.)
// - Cleaning never invents a value: a key that is absent stays absent, so cleaning is idempotent and a code stays short.
//   What an absent key means is in DEFAULTS, for whatever draws the part.
// - Other packages' tables and cleaners are used, not copied. Loaded wherever parts are cleaned: lib/motionx.js (GZ_MX:
//   the names and limits of animations, effects, the cursor and a layer's particle shapes) and lib/navlayout.js
//   (GZ_NAV_LAYOUT.clean, x.nav). Used when there: GZ_GLSL.check(src) -> { ok, errors } (shader source) and
//   GZ_PARTS.rules(list) (the LMS part registry cleans the whole rules part); without them only the shape is checked.
//
// Storage: the parts of the Look being worn are one packed string in storage.sync `lookX` when it
// fits a sync item; otherwise it is in storage.local `lookX` and sync holds { h: hash }. '' in sync means none (a Look
// clears the parts in the same write that changes the Look, so everyone sees one change).
// Classic script (page, worker, extension pages, loaded on demand); module.exports for node.
var GZ_XPARTS = globalThis.GZ_XPARTS || (() => {
  const G = typeof GZ_COLORS !== 'undefined' ? { GZ_COLORS, GZ_SPEC, GZ_SYNC_BYTES, GZ_SYNC_ITEM_MAX } : require('../defaults.js');
  // The motion package's tables (lib/motionx.js): the moments, events, kinds, shapes, easing names and the limits of a
  // stop. Its drawing code owns what they mean, so the names and ranges are asked of it, not kept here again. Needed
  // wherever animations, effects, a cursor or a layer's particles are cleaned.
  const MX = () => (typeof GZ_MX !== 'undefined' ? GZ_MX : require('./motionx.js'));
  // Asked for only when a rule names a font, so only then.
  const FONTS = () => (typeof GZ_FONTS !== 'undefined' ? GZ_FONTS : require('./fonts.js'));

  // ---- rules ------------------------------------------------------------------------------------
  const own = (o, k) => Object.hasOwn(o, k);
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  // A number in [lo, hi], to three places (or whole). -0 is 0.
  const num = (lo, hi, int = false) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, int ? Math.round(v) : Math.round(v * 1000) / 1000)) + 0 : null);
  const oneOf = (names) => (v) => (typeof v === 'string' && names.includes(v) ? v : null);
  const TOKENS = G.GZ_COLORS.map(([v]) => v.slice(5));
  const HEX = /^#[0-9a-f]{6}$/i; // as defaults.js
  const col = (v) => (typeof v !== 'string' ? null : TOKENS.includes(v) ? v : HEX.test(v) ? v.toLowerCase() : null);
  // One line of text, counted as people count it, without control or direction-changing characters.
  const text = (max) => (v) => {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    const s = v.replace(/\s+/g, ' ').replace(/[\p{Cc}\p{Bidi_Control}]/gu, '').trim();
    return s && [...s].length <= max ? s : null;
  };
  const list = (rule, min, max) => (v) => {
    if (!Array.isArray(v) || v.length < min || v.length > max) return null;
    const out = [];
    for (const e of v) { const c = rule(e); if (c === null) return null; out.push(c); }
    return out;
  };
  // Each once, in the order given.
  const once = (rule, by = (x) => x) => (v) => { const l = rule(v); return l && new Set(l.map((x) => JSON.stringify(by(x)))).size === l.length ? l : null; };
  const dedupe = (rule) => (v) => { const l = rule(v); return l && [...new Set(l)]; };
  // spec: key -> rule. Keys come out in the spec's order whatever order they came in. Unknown keys refuse, and so does
  // an object with nothing in it; `req` keys must be there. Reads only own keys, so nothing comes from a prototype.
  const shape = (spec, req = []) => (v) => {
    if (!isObj(v)) return null;
    const keys = Object.keys(v);
    if (!keys.length || keys.some((k) => !own(spec, k)) || req.some((k) => !own(v, k))) return null;
    const out = {};
    for (const k of Object.keys(spec)) {
      if (!own(v, k)) continue;
      const c = spec[k](v[k]);
      if (c === null) return null;
      out[k] = c;
    }
    return out;
  };
  // Free keys (ids), at most `max`, sorted so the same map is always the same text.
  const dict = (keyOk, rule, max) => (v) => {
    if (!isObj(v)) return null;
    const keys = Object.keys(v);
    if (!keys.length || keys.length > max || !keys.every(keyOk)) return null;
    const out = [];
    for (const k of keys.sort()) { const c = rule(v[k]); if (c === null) return null; out.push([k, c]); }
    return Object.fromEntries(out);
  };

  // ---- backgrounds ------------------------------------------------------------------------------
  const SHADER_MAX = 8192;
  const shapeName = (v) => oneOf(MX().SHAPES)(v);
  const BLENDS = ['normal', 'add', 'screen', 'multiply'];
  // GLSL ES 1.00 source: ASCII with line breaks and tabs, 8 KiB at most, and whatever lib/glsl.js says when it is loaded.
  const source = (v) => {
    if (typeof v !== 'string') return null;
    const s = v.replace(/\r\n?/g, '\n');
    if (!s.trim() || s.length > SHADER_MAX || /[^\t\n\x20-\x7e]/.test(s)) return null;
    if (typeof GZ_GLSL !== 'undefined') { try { if (!GZ_GLSL.check(s).ok) return null; } catch { return null; } }
    return s;
  };
  // What a layer's absent keys mean (the colours, absent, are the background's: the palette's accents or bg.colors).
  const layerBase = { amount: [70, num(0, 100)], speed: [100, num(0, 200)], blend: ['normal', oneOf(BLENDS)] };
  const colors = (min, max) => [null, list(col, min, max)];
  const LAYER = {
    scene: { name: [undefined, (v) => oneOf(G.GZ_SPEC.bg.scene[1])(v)], ...layerBase, c: colors(1, 3) },
    noise: { scale: [40, num(1, 100)], ...layerBase, c: colors(1, 3) },
    gradient: { style: ['linear', oneOf(['linear', 'radial', 'conic'])], angle: [135, num(0, 360)], amount: layerBase.amount, blend: layerBase.blend, c: [undefined, list(col, 2, 4)] },
    particles: { count: [60, num(1, 400, true)], shape: ['dot', shapeName], size: [6, num(1, 64)], speed: layerBase.speed, drift: [180, num(0, 360)], twinkle: [0, num(0, 100)], amount: layerBase.amount, blend: layerBase.blend, c: colors(1, 3) },
  };
  const REQUIRED = { scene: ['name'], noise: [], gradient: ['c'], particles: [] };
  const rules = (fields) => Object.fromEntries(Object.entries(fields).map(([k, [, r]]) => [k, r]));
  const layer = (v) => {
    const k = isObj(v) && typeof v.k === 'string' && own(LAYER, v.k) ? v.k : null;
    return k && shape({ k: oneOf([k]), ...rules(LAYER[k]) }, ['k', ...REQUIRED[k]])(v);
  };
  // A looping video, an animated picture or a Lottie animation (lib/scene-media.js draws it, lib/media.js reads the files).
  // src is an https address on a public host (never a device, a local network, a port or credentials), kept as the parser
  // writes it, or `file:` and a SHA-256 (base64url) naming a file kept on this computer, which a Look share or the gallery
  // brings. A mod's parts may instead name one of its bundle's files, `./<path>` (lib/modbundle.js checks the file), which
  // the worker hands the page as `mod:<id>/<path>` (lib/modbroker.js serves it). Neither is a Look's: bundle() refuses both.
  const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
  const LOCAL = /(^|\.)(localhost|local|internal|lan|home\.arpa)$/;
  const mediaUrl = (v) => {
    if (typeof v !== 'string' || v.length > 2048) return null;
    let u;
    try { u = new URL(v); } catch { return null; }
    return u.protocol === 'https:' && !u.username && !u.password && !u.port && HOST.test(u.hostname) && !LOCAL.test(u.hostname) ? u.href : null;
  };
  const MOD_FILE = /^(?:\.\/|mod:[a-z2-7]{16}\/)((?:[\w-][\w.-]*\/){0,7}[\w-][\w.-]*\.(?:webm|mp4|webp|avif|json))$/;
  const modFile = (v) => (typeof v === 'string' && v.length <= 240 && MOD_FILE.test(v) ? v : null);
  const MEDIA = { types: ['video', 'image', 'lottie'], fits: ['cover', 'contain', 'fill'], url: mediaUrl, mod: (v) => modFile(v)?.match(MOD_FILE)[1] ?? null,
    src: (v) => (typeof v === 'string' && /^file:[\w-]{43}$/.test(v) ? v : modFile(v) || mediaUrl(v)) };
  const media = shape({ type: oneOf(MEDIA.types), src: MEDIA.src, fit: oneOf(MEDIA.fits), dim: num(0, 90, true), loop: (v) => (typeof v === 'boolean' ? v : null) }, ['type', 'src']);
  const bg = shape({ shader: shape({ src: source }, ['src']), layers: list(layer, 1, 4), media });

  // ---- animations -------------------------------------------------------------------------------
  // A stop's keys, each between the limits motionx.js has for it; a key left out is the element as it is.
  const range = (k) => (v) => num(...MX().RANGE[k])(v);
  const STOP = { at: num(0, 1), ...Object.fromEntries(['x', 'y', 'sc', 'r', 'kx', 'ky', 'o', 'bl', 'br', 'sa', 'hu'].map((k) => [k, range(k)])) };
  const stops = (v) => { const l = list(shape(STOP, ['at']), 2, 8)(v); return l && l.sort((a, b) => a.at - b.at); };
  // A name motionx.js has, or a cubic-bezier's four numbers (x between 0 and 1, as CSS has it).
  const ease = (v) => (typeof v === 'string' ? oneOf(Object.keys(MX().EASES))(v)
    : Array.isArray(v) && v.length === 4 ? list((e) => e, 4, 4)(v.map((e, i) => num(i % 2 ? -3 : 0, i % 2 ? 3 : 1)(e))) : null);
  const motion = shape({ s: stops, ms: num(50, 2000, true), ease, delay: num(0, 1000, true), stagger: num(0, 200, true) }, ['s']);
  const anim = (v) => shape(Object.fromEntries(MX().MOMENTS.map((m) => [m, motion])))(v);

  // ---- event effects and the cursor -------------------------------------------------------------
  const effect = shape({ kind: (v) => oneOf(MX().KINDS)(v), count: num(1, 60, true), shapes: dedupe(list(shapeName, 1, 4)), c: list(col, 1, 6), spread: num(0, 360), gravity: num(-2, 2), life: num(200, 2500, true), size: num(2, 48) }, ['kind']);
  const fx = (v) => shape(Object.fromEntries(MX().EVENTS.map((e) => [e, effect])))(v);
  const cursor = shape({ kind: (v) => oneOf(MX().CURSORS)(v), c: list(col, 1, 3), size: num(2, 48), len: num(2, 24, true), fade: num(100, 2000, true) }, ['kind']);

  // ---- nav layout -------------------------------------------------------------------------------
  // lib/navlayout.js (package D) is the one cleaner for x.nav, and the rail's own model. It needs lib/nav.js and
  // lib/nav-items.js loaded before it, wherever parts are cleaned (the worker, the editor, the popup, the page).
  const NL = () => (typeof GZ_NAV_LAYOUT !== 'undefined' ? GZ_NAV_LAYOUT : require('./navlayout.js'));
  const nav = (v) => NL().clean(v);

  // ---- LMS rules --------------------------------------------------------------------------------
  // Parts are named by lib/parts.js (`ultra.course-card.title`); a rule never holds a selector. With the registry loaded
  // (GZ_PARTS, package E) it cleans the whole list: names, what each part can take and the style values. Without it,
  // this checks the rules' shape and the style allowlist as the registry has it (STYLE below mirrors lib/parts.js).
  const PART = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,5}$/;
  const part = (v) => (typeof v === 'string' && v.length <= 64 && PART.test(v) ? v : null);
  const font = (v) => (typeof v === 'string' && FONTS().LIST.some((f) => f.id === v) ? v : null);
  const STYLE = { bg: [undefined, col], fg: [undefined, col], bc: [undefined, col], bw: [undefined, num(0, 4, true)], r: [undefined, num(0, 32, true)], p: [undefined, num(0, 6, true)], g: [undefined, num(0, 6, true)], sh: [undefined, num(0, 3, true)], o: [undefined, num(0, 100, true)], f: [undefined, font] };
  const DO = { hide: [], show: [], move: ['to', 'at'], style: ['st'], label: ['t'] };
  const rule = (v) => {
    const r = shape({ p: part, do: oneOf(Object.keys(DO)), to: part, at: oneOf(['before', 'after']), st: shape(rules(STYLE)), t: text(60) }, ['p', 'do'])(v);
    const want = r && ['p', 'do', ...DO[r.do]];
    return want && Object.keys(r).length === want.length && want.every((k) => own(r, k)) && r.to !== r.p ? r : null;
  };
  // The registry drops what it can't clean; a code that would lose any rule is refused whole.
  const ruleList = (v) => {
    if (typeof GZ_PARTS === 'undefined' || typeof GZ_PARTS.rules !== 'function') return list(rule, 1, 64)(v);
    if (!Array.isArray(v) || v.length < 1 || v.length > 64) return null;
    try { const got = GZ_PARTS.rules(v); return Array.isArray(got) && got.length === v.length ? got : null; } catch { return null; }
  };

  // ---- the whole ---------------------------------------------------------------------------------
  const GROUPS = { bg, anim, fx, cursor, nav, rules: ruleList };
  const clean = shape(GROUPS);
  // The mods a Look works with: a 16-character base32 id, the bundle's SHA-256 (base64url) and a name.
  const mods = once(list(shape({ id: (v) => (typeof v === 'string' && /^[a-z2-7]{16}$/.test(v) ? v : null), h: (v) => (typeof v === 'string' && /^[\w-]{43}$/.test(v) ? v : null), name: text(40) }, ['id', 'h', 'name']), 1, 8), (m) => m.id);
  // { x, m }: what a code or the stored Look carries; null when there is nothing, or anything is wrong.
  const bundle = (v) => { const b = shape({ x: clean, m: mods })(v); return b && MEDIA.mod(b.x?.bg?.media?.src) ? null : b; };
  // What a key left out of a background layer means (the colours left out are the background's: its own, or the palette's
  // accents). The motion parts' defaults are motionx.js's, which draws them.
  const given = (fields) => Object.fromEntries(Object.entries(fields).filter(([, [d]]) => d !== undefined && d !== null).map(([n, [d]]) => [n, d]));
  const deepFreeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o); };
  const DEFAULTS = deepFreeze({ layer: Object.fromEntries(Object.entries(LAYER).map(([k, f]) => [k, given(f)])), media: { fit: 'cover', dim: 40, loop: true } });
  // Same value, whatever the order of an object's keys.
  const same = (a, b) => (a === b) || (isObj(a) && isObj(b) ? Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => own(b, k) && same(a[k], b[k]))
    : Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((e, i) => same(e, b[i])) : false);

  // ---- shader source in a code --------------------------------------------------------------------
  // Comments become spaces; keep token boundaries such as `a - -b` intact.
  // shortcut: preserve preprocessing, continuations and __LINE__ verbatim; use a preprocessor if these need compaction.
  const strip = (src) => {
    const s = String(src).replace(/\r\n?/g, '\n');
    if (/[#\\]|\b__LINE__\b/.test(s)) return s;
    let out = '';
    for (let i = 0; i < s.length;) {
      if (s[i] === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; } else if (s[i] === '/' && s[i + 1] === '*') {
        const end = s.indexOf('*/', i + 2);
        if (end < 0) return s;
        out += ' ';
        i = end + 2;
      } else out += s[i++];
    }
    return out.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
  };
  // x with its shader source stripped (a copy).
  const compact = (x) => (x?.bg?.shader ? { ...x, bg: { ...x.bg, shader: { src: strip(x.bg.shader.src) } } } : x);

  // ---- packing ------------------------------------------------------------------------------------
  const MAX_JSON = 48 << 10; // bytes of JSON, packed or in a code
  const pipe = async (bytes, stream, cap = Infinity) => {
    const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
    const parts = [];
    let size = 0;
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      size += r.value.length;
      // A small code that inflates to something huge is not a theme.
      if (size > cap) { reader.cancel(); throw new Error('too big'); }
      parts.push(r.value);
    }
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  };
  const b64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const unb64 = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const deflate = (bytes) => pipe(bytes, new CompressionStream('deflate-raw'));
  const inflate = (bytes, cap = MAX_JSON) => pipe(bytes, new DecompressionStream('deflate-raw'), cap);
  const TAG = 'x1:';
  // { x, m } (cleaned) as a string for storage; throws when it is over MAX_JSON.
  const pack = async (P) => {
    const bytes = new TextEncoder().encode(JSON.stringify(P));
    if (bytes.length > MAX_JSON) throw new Error('too big');
    return TAG + b64(await deflate(bytes));
  };
  // What a packed string holds, as it is written (not yet cleaned), or null for anything else.
  const parse = async (s) => {
    if (typeof s !== 'string' || !s.startsWith(TAG) || s.length > 4 * MAX_JSON || !/^[\w-]+$/.test(s.slice(TAG.length))) return null;
    try { return JSON.parse(new TextDecoder().decode(await inflate(unb64(s.slice(TAG.length))))); } catch { return null; }
  };
  // The cleaned { x, m } in a packed string, or null.
  const unpack = async (s) => bundle(await parse(s));

  // ---- storage ------------------------------------------------------------------------------------
  // A short check that local `lookX` is the one sync names (not secrecy; just that the two haven't parted).
  const hash = (str) => {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  };
  // storage.sync and storage.local as the functions below want them: get(key) -> object, set(o) and remove(k) -> boolean.
  // The worker's brokerArea is already that; this is for the extension's pages and content scripts.
  const areas = (c = globalThis.chrome) => {
    const area = (a) => ({
      get: (k) => new Promise((res) => { try { a.get(k, (r) => res(c.runtime.lastError ? {} : r || {})); } catch { res({}); } }),
      set: (o) => new Promise((res) => { try { a.set(o, () => res(!c.runtime.lastError)); } catch { res(false); } }),
      remove: (k) => new Promise((res) => { try { a.remove(k, () => res(!c.runtime.lastError)); } catch { res(false); } }),
    });
    return { sync: area(c.storage.sync), local: area(c.storage.local) };
  };
  // The packed string sync's `lookX` value stands for: itself, or local's when sync holds { h } and local has what it
  // names. '' is none; undefined is parts that were saved on another computer.
  const stored = async (v, local) => {
    if (!isObj(v)) return typeof v === 'string' ? v : '';
    const s = typeof v.h === 'string' ? (await local.get('lookX')).lookX : null;
    return typeof s === 'string' && hash(s) === v.h ? s : undefined;
  };
  // { x, m }, null for none, or undefined for parts that were saved on another computer.
  const fromStored = async (v, local) => {
    const s = await stored(v, local);
    return s === undefined ? undefined : unpack(s);
  };
  const read = async ({ sync, local }) => (await fromStored((await sync.get('lookX')).lookX, local)) ?? null;
  // Writes `patch` (settings, for sync) and the parts together: one sync write when the parts fit an item, so the page sees
  // the Look and its parts change at once. P is null to clear them. → whether it all went in.
  const write = async ({ sync, local }, P, patch = {}) => {
    const ok = async (f) => { try { return (await f()) !== false; } catch { return false; } };
    if (P == null) {
      if (!await ok(() => sync.set({ ...patch, lookX: '' }))) return false;
      await ok(() => local.remove('lookX'));
      return true;
    }
    const cleaned = bundle(P);
    if (!cleaned || !same(cleaned, P)) return false;
    const s = await pack(cleaned);
    if (G.GZ_SYNC_BYTES('lookX', s) <= G.GZ_SYNC_ITEM_MAX && await ok(() => sync.set({ ...patch, lookX: s }))) { await ok(() => local.remove('lookX')); return true; }
    const before = (await local.get('lookX')).lookX;
    if (!await ok(() => local.set({ lookX: s }))) return false;
    if (await ok(() => sync.set({ ...patch, lookX: { h: hash(s) } }))) return true;
    // Sync still names the previous Look; keep its device copy when the new Look could not be saved.
    await ok(() => before === undefined ? local.remove('lookX') : local.set({ lookX: before }));
    return false;
  };

  // Installed mods' parts over a Look's (each already cleaned): the first mod in the student's order to set a key wins it,
  // over the Look; rules add up, the Look's first, to the 64 a Look may have. null when nothing is left.
  const over = (base, overs) => {
    const all = [...overs, base].filter(isObj);
    const x = Object.assign({}, ...all.reverse());
    const rules = [base, ...overs].flatMap((p) => (Array.isArray(p?.rules) ? p.rules : [])).slice(0, 64);
    if (rules.length) x.rules = rules; else delete x.rules;
    return Object.keys(x).length ? x : null;
  };

  // ---- what a code brings, for the editor's offer -------------------------------------------------
  // Plain sentences with {placeholders}, for t(why, vars): English here, translated where they are shown. A var that is a
  // list holds Glaze's own English names (navigation items, page parts), for the offer to translate and join.
  // The account item has no name of Glaze's (its label is the student's name).
  const itemName = (id) => (id === 'profile' ? 'Your account' : NL().NAMES[id] || id);
  // A part's label (lib/parts.js, loaded wherever an offer is shown), else its name.
  const REGISTRY = () => (typeof GZ_PARTS !== 'undefined' ? GZ_PARTS : typeof require === 'function' ? require('./parts.js') : null);
  const partName = (p) => REGISTRY()?.get(p)?.label || p;
  const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  // Each part's end state as lib/parts.js folds the rules for the page: hidden (a later show undoes it), its last text, its
  // last opacity, and whether anything else restyles or moves it.
  const fold = (rules) => {
    const hide = new Set(), text = new Map(), o = new Map(), look = new Set();
    for (const r of rules) {
      if (r.do === 'hide') hide.add(r.p);
      else if (r.do === 'show') hide.delete(r.p);
      else if (r.do === 'label') text.set(r.p, r.t);
      else if (r.do === 'move') look.add(r.p);
      else if (r.do === 'style') { if (own(r.st, 'o')) o.set(r.p, r.st.o); if (Object.keys(r.st).some((k) => k !== 'o')) look.add(r.p); }
    }
    return { hide, text, fade: new Set([...o].filter(([, v]) => v < 100).map(([p]) => p)), look };
  };
  // A Look comes from someone else, so nothing it does to the navigation or the school's pages goes unsaid: each item it
  // hides, each link with the site it goes to, each part it hides, fades or restyles, and each text it writes, word for word.
  const describe = (P) => {
    const x = P?.x || {}, out = [];
    const add = (why, vars) => out.push({ why, vars });
    if (x.bg?.shader) add('Draws its background with its own shader.');
    if (x.bg?.layers) add('Layers {n} animated backgrounds.', { n: x.bg.layers.length });
    if (x.bg?.media) {
      const m = x.bg.media, host = m.src.startsWith('https:') ? new URL(m.src).hostname : ''; // a kept or carried file names no host
      if (host) add({ video: 'Plays a video behind your pages, loaded from {host}.', image: 'Plays an animated picture behind your pages, loaded from {host}.', lottie: 'Plays an animation behind your pages, loaded from {host}.' }[m.type], { host });
      else add({ video: 'Plays a video behind your pages, from a file that came with it.', image: 'Plays an animated picture behind your pages, from a file that came with it.', lottie: 'Plays an animation behind your pages, from a file that came with it.' }[m.type]);
    }
    if (x.anim) add('Changes {n} animations.', { n: Object.keys(x.anim).length });
    if (x.fx) add('Plays effects for {n} events.', { n: Object.keys(x.fx).length });
    if (x.cursor) add('Adds a cursor effect.');
    if (x.nav) {
      const n = x.nav;
      if (n.place || n.groups || n.icons) add('Rearranges the navigation.');
      if (n.hidden?.length) add('Hides {items} in the navigation.', { items: n.hidden.map(itemName) });
      for (const l of n.links || []) add('Adds a link: {name} → {host}.', { name: l.n, host: hostOf(l.u) });
    }
    if (x.rules) {
      const f = fold(x.rules), names = (set) => [...new Set([...set].map(partName))];
      const parts = (why, set) => { const list = names(set); if (list.length) add(why, { n: list.length, parts: list }); };
      parts('Hides {n} parts of your school pages: {parts}.', f.hide);
      for (const [p, text] of f.text) add('Changes the text of {part} to “{text}”.', { part: [partName(p)], text });
      parts('Makes {n} parts of your school pages see-through: {parts}.', f.fade);
      parts('Changes how {n} parts of your school pages look: {parts}.', f.look);
    }
    if (P?.m) add('Works with the mods {names}, which this does not install.', { names: P.m.map((m) => m.name).join(', ') });
    return out;
  };

  // ---- a Look from someone else -------------------------------------------------------------------
  // A code, a gallery Look or a Look share. It may not take away signing out or the student's account (x.nav hidden: on a
  // shared computer they'd be left with no way out), link to a page without https (anyone on the network can change what it
  // shows), or name a link as signing out or Glaze settings (lib/navlayout.js reserved, as for mods' items). The editor
  // refuses such a code whole, as it refuses any code it can't use, and says why; the student's own Look may do any of
  // these. -> the reasons, as describe's sentences; none when it may be offered.
  const KEEP = ['logout', 'profile'];
  const outside = (P) => {
    const nav = P?.x?.nav, out = [];
    const add = (why, vars) => out.push({ why, vars });
    const kept = (nav?.hidden || []).filter((id) => KEEP.includes(id));
    if (kept.length) add('It hides {items}, which only you can hide.', { items: kept.map(itemName) });
    const f = fold(P?.x?.rules || []);
    if (f.hide.has('canvas.global-nav.account') || f.fade.has('canvas.global-nav.account')) add('It hides {items}, which only you can hide.', { items: [partName('canvas.global-nav.account')] });
    for (const l of nav?.links || []) {
      if (!String(l.u).startsWith('https:')) add('Its link {name} goes to {host} without https.', { name: l.n, host: hostOf(l.u) });
      if (NL().reserved(l.n)) add('Its link {name} could pass for signing out or Glaze settings.', { name: l.n });
      else if (NL().mimics(l.n, nav?.hidden || [])) add('Its link {name} could pass for a navigation item it hides.', { name: l.n });
    }
    return out;
  };
  // How a background kind reads in the offer ("…, and a custom shader background").
  const KIND_WORD = { shader: 'a custom shader background', layers: 'a layered animated background', media: 'a video or animation background' };

  return { BLENDS, MEDIA, MAX_JSON, SHADER_MAX, DEFAULTS, GROUPS: Object.keys(GROUPS), RULE_DO: Object.keys(DO), clean, mods, bundle, over, same, strip, compact, pipe, b64, unb64, deflate, inflate, pack, parse, unpack, hash, areas, stored, fromStored, read, write, describe, outside, KIND_WORD };
})();

if (typeof module !== 'undefined') module.exports = GZ_XPARTS; else GZ_XPARTS;
