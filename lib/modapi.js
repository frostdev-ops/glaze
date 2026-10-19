// Code mods' API v1: the cleaners for what a mod hands Glaze to show or to act on. The worker's broker (lib/modbroker.js)
// runs every one before it answers a call, and the page (features/mods.js) applies only what that answer carries: a UI
// slot's component tree, a card's decoration, palette commands, a played effect, the student's settings record for a
// mod and the values its settings schema gives. Everything here arrives from a mod's code, so a cleaner refuses (null)
// on an unknown key, a wrong type, a list or string over its limit; nothing is truncated. Rules, a nav layout and Look
// overrides are Look parts: GZ_XPARTS cleans them (lib/lookparts.js), not this. Classic script; module.exports for node.
var GZ_MODAPI = globalThis.GZ_MODAPI || (() => {
  const G = typeof GZ_COLORS !== 'undefined' ? { GZ_COLORS } : require('../defaults.js');
  const MX = () => (typeof GZ_MX !== 'undefined' ? GZ_MX : require('./motionx.js'));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;
  const own = (o, k) => Object.hasOwn(o, k);
  const TOKENS = G.GZ_COLORS.map(([v]) => v.slice(5));
  // A palette token (what the page wears, `accent`) or #rrggbb.
  const color = (v) => (typeof v !== 'string' ? null : TOKENS.includes(v) ? v : /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);
  // Text without control or direction-changing characters; `lines` keeps line breaks (a text block), else one line.
  // Counted in code points; an over-long string refuses.
  const str = (max, { lines = false, empty = true } = {}) => (v) => {
    if (typeof v !== 'string' || v.length > max * 4) return null;
    const one = (l) => l.replace(/[\p{Cc}\p{Bidi_Control}]/gu, ' ').replace(/\s+/g, ' ').trim();
    const s = lines ? v.split(/\r\n?|\n/).map(one).join('\n').trim() : one(v);
    return (s || empty) && [...s].length <= max ? s : null;
  };
  const num = (lo, hi, int = false) => (v) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi && (!int || Number.isInteger(v)) ? v + 0 : null);
  const bool = (v) => (typeof v === 'boolean' ? v : null);
  const oneOf = (names) => (v) => (typeof v === 'string' && names.includes(v) ? v : null);
  const ID = /^[a-z][a-z0-9-]{0,31}$/;
  const id = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
  // spec: key → rule; `req` keys must be there. Keys come out in the spec's order.
  const shape = (spec, req = []) => (v) => {
    if (!isObj(v) || Object.keys(v).some((k) => !own(spec, k)) || req.some((k) => !own(v, k))) return null;
    const out = {};
    for (const k of Object.keys(spec)) {
      if (!own(v, k)) continue;
      const c = spec[k](v[k]);
      if (c === null) return null;
      out[k] = c;
    }
    return out;
  };
  const list = (rule, max) => (v) => {
    if (!Array.isArray(v) || v.length > max) return null;
    const out = [];
    for (const e of v) { const c = rule(e); if (c === null) return null; out.push(c); }
    return out;
  };

  // ---- the component tree ----------------------------------------------------------------------------------------------
  // What glaze.ui.render(slot, tree) may draw. A node is { type, ...its keys }; stack, row and list hold children. At most
  // DEPTH levels and NODES nodes in all, one canvas per tree. An image names one of the mod's own files (the broker checks
  // the bundle has it, as a picture). Ids name a button or an input in the events sent back (ui: { slot, id, kind, value }).
  const LIMIT = { depth: 8, nodes: 200, children: 50, text: 500, label: 80, options: 32 };
  const PATH = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(png|jpe?g|gif|webp|avif)$/i;
  const label = str(LIMIT.label);
  const COMMON = { label };
  const SIZE = oneOf(['xs', 's', 'm', 'l', 'xl']);
  const LEAF = {
    text: [{ text: str(LIMIT.text, { lines: true }), size: SIZE, weight: oneOf(['normal', 'bold']), color, muted: bool }, ['text']],
    number: [{ value: num(-1e15, 1e15), label, unit: str(12), digits: num(0, 4, true), size: SIZE, color }, ['value']],
    ring: [{ value: num(-1e15, 1e15), max: num(1e-9, 1e15), label, color }, ['value']],
    progress: [{ value: num(-1e15, 1e15), max: num(1e-9, 1e15), label, color }, ['value']],
    // to: when it ends, ms since 1970. done: what it says after.
    countdown: [{ to: num(0, 1e13, true), label, done: str(80) }, ['to']],
    image: [{ src: (v) => (typeof v === 'string' && v.length <= 200 && PATH.test(v) && v.split('/').length <= 8 ? v : null), alt: str(200), w: num(1, 2000, true), h: num(1, 2000, true), fit: oneOf(['contain', 'cover']) }, ['src', 'alt']],
    button: [{ id, label: str(60, { empty: false }), tone: oneOf(['primary', 'plain']), disabled: bool }, ['id', 'label']],
    // The Worker's OffscreenCanvas for this slot (glaze.ui.canvas(slot)), h CSS pixels tall; its width is the slot's.
    canvas: [{ h: num(24, 800, true), label }, []],
  };
  const KINDS = ['text', 'number', 'toggle', 'select'];
  const input = (v) => {
    const kind = isObj(v) && oneOf(KINDS)(v.kind);
    if (!kind) return null;
    const more = {
      text: { value: str(LIMIT.text), maxLength: num(1, LIMIT.text, true), placeholder: str(80) },
      number: { value: num(-1e15, 1e15), min: num(-1e15, 1e15), max: num(-1e15, 1e15), step: num(1e-9, 1e15) },
      toggle: { value: bool },
      select: { value: str(60), options: (o) => { const l = list(str(60, { empty: false }), LIMIT.options)(o); return l && l.length && new Set(l).size === l.length ? l : null; } },
    }[kind];
    const c = shape({ type: oneOf(['input']), id, kind: oneOf([kind]), label: str(60, { empty: false }), disabled: bool, ...more }, ['type', 'id', 'kind', 'label', ...(kind === 'select' ? ['options'] : [])])(v);
    if (!c) return null;
    if (kind === 'number' && ((own(c, 'min') && own(c, 'max') && c.min > c.max) || (own(c, 'value') && ((own(c, 'min') && c.value < c.min) || (own(c, 'max') && c.value > c.max))))) return null;
    if (kind === 'select' && own(c, 'value') && !c.options.includes(c.value)) return null;
    if (kind === 'text' && own(c, 'value') && [...c.value].length > (c.maxLength ?? LIMIT.text)) return null;
    return c;
  };
  // → the cleaned tree, or null. Ids may repeat only across nodes of different kinds (a button and an input share none).
  const tree = (raw) => {
    let nodes = 0, canvases = 0;
    const ids = new Set();
    const node = (v, depth) => {
      if (!isObj(v) || typeof v.type !== 'string' || depth > LIMIT.depth || ++nodes > LIMIT.nodes) return null;
      let c;
      if (['stack', 'row', 'list'].includes(v.type)) {
        const spec = { type: oneOf([v.type]), children: (k) => list((e) => node(e, depth + 1), LIMIT.children)(k), ...COMMON,
          ...(v.type === 'list' ? { ordered: bool } : { gap: num(0, 6, true), align: oneOf(['start', 'center', 'end', 'stretch']), ...(v.type === 'row' && { wrap: bool }) }) };
        c = shape(spec, ['type', 'children'])(v);
      } else if (v.type === 'input') c = input(v);
      else if (own(LEAF, v.type)) { const [spec, req] = LEAF[v.type]; c = shape({ type: oneOf([v.type]), ...spec }, ['type', ...req])(v); }
      if (!c) return null;
      if (c.type === 'canvas' && ++canvases > 1) return null;
      if (c.id !== undefined) { if (ids.has(c.id)) return null; ids.add(c.id); }
      return c;
    };
    return node(raw, 1);
  };
  // Every image path a tree names.
  const images = (t, out = []) => { if (t?.type === 'image') out.push(t.src); for (const c of t?.children || []) images(c, out); return out; };

  // ---- transforms ------------------------------------------------------------------------------------------------------
  // glaze.cards.decorate(fn) → { courseId: { badge ≤ 12, accent, note ≤ 120 } }: at least one of the three per course.
  const COURSE = /^[\w.:-]{1,64}$/;
  const decoration = (v) => { const c = shape({ badge: str(12, { empty: false }), accent: color, note: str(120, { empty: false }) })(v); return c && Object.keys(c).length ? c : null; };
  const decorations = (v) => {
    if (!isObj(v) || Object.keys(v).length > 200) return null;
    const out = [];
    for (const k of Object.keys(v).sort()) { const d = COURSE.test(k) && decoration(v[k]); if (!d) return null; out.push([k, d]); }
    return Object.fromEntries(out);
  };
  // glaze.palette.commands([...]) → [{ id, title, hint? }], at most 16, each id once (the function stays in the mod).
  const commands = (v) => { const l = list(shape({ id, title: str(60, { empty: false }), hint: str(40) }, ['id', 'title']), 16)(v); return l && new Set(l.map((c) => c.id)).size === l.length ? l : null; };
  // glaze.effects.play(kind, opts): one of the Look effects' kinds and its fields (lib/motionx.js), and where, as fractions
  // of the window (the middle third by default). → { fx, x, y }, fx in GZ_MX.fx's form.
  const effect = (kind, opts = {}) => {
    const M = MX();
    if (!M.KINDS.includes(kind)) return null;
    const o = shape({ count: num(1, 60, true), shapes: list(oneOf(M.SHAPES), 4), c: list(color, 6), spread: num(0, 360), gravity: num(-2, 2), life: num(200, 2500, true), size: num(2, 48), x: num(0, 1), y: num(0, 1) })(opts);
    if (!o) return null;
    const { x = 0.5, y = 1 / 3, ...rest } = o || {};
    return { fx: M.fx({ kind, ...rest }), x, y };
  };

  // ---- the navigation bar's items (nav.items) ----------------------------------------------------------------------------
  // glaze.nav.add({ id, label, icon, href | action, badge, group | slot }) → the item cleaned, for features/navbar.js to draw as
  // the mod's own. An icon is one of the bar's (lib/navbar.js PICKS; anything else gets the link icon); an href is a page of
  // the LMS site the mod runs on (origin), never another site's; action: true asks for a 'nav.action' event instead. partial:
  // glaze.nav.update's patch, where nothing is required (the page merges it over the item and checks the result again).
  const NAV_ICONS = ['home', 'book', 'calendar', 'inbox', 'grades', 'tools', 'help', 'activity', 'organization', 'groups', 'history', 'admin', 'account', 'signout', 'glaze', 'notes', 'todo', 'search', 'settings', 'link', 'video', 'chat', 'doc', 'folder', 'code', 'star', 'globe', 'bell', 'layers', 'pencil', 'megaphone', 'quiz', 'people', 'timer', 'gear'];
  const navHref = (origin) => (v) => {
    if (typeof v !== 'string' || !v || v.length > 512 || typeof origin !== 'string') return null;
    try { const u = new URL(v, `${origin}/`); return u.origin === origin && /^https?:$/.test(u.protocol) && !u.username && !u.password && u.href.length <= 512 ? u.href : null; } catch { return null; }
  };
  const navItem = (v, origin, partial = false) => {
    const c = shape({ id, label: str(40, { empty: false }), icon: (x) => (typeof x === 'string' ? (NAV_ICONS.includes(x) ? x : 'link') : null), href: navHref(origin), action: (x) => (x === true ? true : null),
      badge: (x) => (typeof x === 'number' ? num(0, 9999, true)(x) : str(4)(x)), group: (x) => (typeof x === 'number' ? num(0, 7, true)(x) : str(24, { empty: false })(x)), slot: oneOf(['top', 'bottom']) }, partial ? [] : ['id', 'label'])(v);
    if (!c || (own(c, 'href') && own(c, 'action')) || (own(c, 'group') && own(c, 'slot')) || (partial ? own(c, 'id') : !own(c, 'href') && !own(c, 'action'))) return null;
    return c;
  };

  // ---- the student's records for a mod ---------------------------------------------------------------------------------
  // Written by the editor's Mods section, read by the worker. storage.local modOrder = [id]: the student's order, which
  // decides who has a slot two mods claim and the order transforms run in. modSettings:<id> = { setting id: value }, the
  // mod's settings schema's values. modReplace:<id> = { key: boolean }, key one of the mod's manifest `replaces` (bg, nav,
  // effect:<moment>, tile:<built-in>): a replacement takes effect only while its key is true here, and is off by default.
  const keysOf = (m) => (Array.isArray(m?.replaces) ? m.replaces.filter((k) => typeof k === 'string') : []);
  // The editor's modReplace write, checked against this mod's manifest: null on a key it doesn't declare or a non-boolean.
  const replace = (raw, manifest) => {
    const keys = keysOf(manifest);
    if (!isObj(raw) || !Object.entries(raw).every(([k, v]) => keys.includes(k) && typeof v === 'boolean')) return null;
    return Object.fromEntries(Object.keys(raw).sort().map((k) => [k, raw[k]]));
  };
  // What is on now, from whatever is stored (a manifest updated since may declare less): the keys still declared and true.
  const enabled = (stored, manifest) => { const keys = keysOf(manifest); return isObj(stored) ? Object.keys(stored).filter((k) => stored[k] === true && keys.includes(k)).sort() : []; };
  // A background, nav or tile replacement needs its matching UI slot; effects have no slot.
  const claims = (stored, manifest) => enabled(stored, manifest).filter((k) => k === 'bg' ? isObj(manifest.ui?.background)
    : k === 'nav' ? isObj(manifest.ui?.nav) : k.startsWith('tile:') ? manifest.ui?.tiles?.some((s) => s.id === k.slice(5)) : true);
  const SETTING = {
    toggle: () => bool,
    choice: (s) => oneOf(Array.isArray(s.options) ? s.options : []),
    number: (s) => (v) => { const n = num(s.min, s.max)(v); return n !== null && (!s.step || Math.abs((n - s.min) / s.step - Math.round((n - s.min) / s.step)) < 1e-6) ? n : null; },
    text: (s) => str(s.max ?? 500),
    color: () => (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v) ? v : null),
  };
  const fallback = (s) => (own(s, 'default') ? s.default : { toggle: false, choice: s.options?.[0], number: s.min, text: '', color: '#000000' }[s.type]);
  const schema = (m) => (Array.isArray(m?.settings) ? m.settings.filter((s) => isObj(s) && own(SETTING, s.type) && typeof s.id === 'string') : []);
  // glaze.settings(): every setting the schema has, the stored value (modSettings) where it still fits, else its default.
  const values = (stored, manifest) => Object.fromEntries(schema(manifest).map((s) => {
    const v = isObj(stored) && own(stored, s.id) ? SETTING[s.type](s)(stored[s.id]) : null;
    return [s.id, v ?? fallback(s)];
  }));
  // Ids in the student's order (modOrder), the rest after them in the order given.
  const order = (ids, stored) => { const o = Array.isArray(stored) ? stored : []; const at = (id) => { const i = o.indexOf(id); return i < 0 ? o.length : i; }; return [...ids].sort((x, y) => at(x) - at(y)); };

  return { LIMIT, TOKENS, NAV_ICONS, navItem, color, tree, images, decoration, decorations, commands, effect, replace, enabled, claims, values, order, keysOf, isObj, str, num, bool, oneOf, shape, list };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODAPI; else GZ_MODAPI;
