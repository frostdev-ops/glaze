// Theme codes: a palette, look, background and course cards as one line of text to paste into someone else's Glaze.
// "glaze1:" + base64url(deflate-raw(JSON)). No server: the code is the settings. A Look with Look parts (lib/lookparts.js)
// is "glaze2:", the same keys plus `x` (the parts) and `m` (the mods it works with), with higher limits; a Look without
// them is still glaze1, readable by every Glaze. Classic script after defaults.js and lib/lookparts.js; module.exports
// for node.
const GZ_SHARE = (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_COLORS, GZ_SPEC, GZ_SANITIZE } : require('../defaults.js');
  const K = typeof GZ_CARDS !== 'undefined' ? GZ_CARDS : require('./cards.js');
  const X = typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js');
  const PREFIX = 'glaze1:';
  const PREFIX2 = 'glaze2:';
  // Look minus tooltips and hints: those are how Glaze behaves, not how a theme looks.
  const LOOK = Object.keys(G.GZ_SPEC.look).filter((k) => !['tooltips', 'hints'].includes(k));
  const SURFACES = LOOK.filter((k) => /^(surface|shadow)/.test(k));
  const BG = Object.keys(G.GZ_SPEC.bg);
  const NAV = ['k', 'c', 'd', 'a', 'u', 'o', 'f', 'ink'];
  const MAX_CODE = 4000;
  const MAX_JSON = 8192;
  const MAX_CODE2 = 20000;
  const { MAX_JSON: MAX_JSON2, b64, unb64, deflate, inflate } = X;
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

  // Course cards, when they are more than the defaults: how they look (k), and a set of card styles (d) that
  // takes turns on the cards of whoever uses the code. `cards` is the cards sync item (lib/cards.js): its theme set,
  // or else the styles given to courses, linked pictures only. A picture kept on this computer never leaves it.
  const cardSet = (cards = {}) => (cards['*'] || Object.entries(cards).filter(([k]) => k !== '*').map(([, v]) => v)).filter((v) => v && !v.i).slice(0, K.SET_MAX);
  // `parts` is { x, m } as lib/lookparts.js cleans them (or none): the code is glaze2 when there are any.
  const encode = async (s, cards, parts) => {
    const raw = { c: G.GZ_COLORS.map(([v]) => s.colors[v].slice(1)).join(''), l: pick(s.look, LOOK.filter((k) => !SURFACES.includes(k) || s.look[k] !== G.GZ_SPEC.look[k][0])), b: pick(s.bg, BG) };
    const def = K.settings();
    const k = s.card ? Object.fromEntries(K.LOOK.filter((x) => s.card[x] !== def[x]).map((x) => [x, s.card[x]])) : {};
    if (Object.keys(k).length) raw.k = k;
    const d = cardSet(K.styles(cards));
    if (d.length) raw.d = d;
    const nav = G.GZ_SANITIZE(s).nav;
    if (nav.i || (nav.k === 'image' && !nav.u)) Object.assign(nav, { k: 'default', u: '' });
    const n = Object.fromEntries(NAV.filter((k) => nav[k] !== G.GZ_SPEC.nav[k][0]).map((k) => [k, nav[k]]));
    if (nav.k !== 'default') raw.n = n;
    // A shader goes into a code without its comments and indentation; the editor keeps the author's text.
    let extra = parts?.x || parts?.m ? { ...(parts.x && { x: X.compact(parts.x) }), ...(parts.m && { m: parts.m }) } : null;
    if (extra) {
      const clean = X.bundle(extra);
      if (!clean || !X.same(clean, extra)) fail("This theme has extras Glaze can't put in a code.");
      // Inactive background drafts stay in storage; a code carries only what this Look uses.
      if (clean.x?.bg) {
        for (const key of ['shader', 'layers', 'media']) if (s.bg.kind !== key) delete clean.x.bg[key];
        if (!Object.keys(clean.x.bg).length) delete clean.x.bg;
        if (!Object.keys(clean.x).length) delete clean.x;
      }
      extra = Object.keys(clean).length ? clean : null;
      Object.assign(raw, extra);
    }
    const json = JSON.stringify(raw);
    const bytes = new TextEncoder().encode(json);
    const code = (extra ? PREFIX2 : PREFIX) + b64(await deflate(bytes));
    // What decode would refuse is refused here, so a copied code always works where it is pasted.
    if (extra ? bytes.length > MAX_JSON2 || code.length > MAX_CODE2 : bytes.length > MAX_JSON || code.length > MAX_CODE) {
      fail(extra ? 'This theme is too long for a code. Shorten its shader, or take out some of its extras.' : 'This theme is too long for a code: its card pictures have long links. Shorten them, or remove some card styles.');
    }
    return code;
  };

  // The code is untrusted: every key must be one Glaze knows and every value must come through
  // GZ_SANITIZE unchanged, or the whole code is refused. Returns { colors, look, bg, nav, card, cards, parts }; parts is
  // { x, m } for a glaze2 code that has them, else null.
  // why is English with {placeholders}; the editor shows it translated (lib/i18n.js).
  const fail = (why, vars = {}) => { throw Object.assign(new Error(why.replace(/\{(\w+)\}/g, (_, k) => vars[k])), { why, vars }); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const decode = async (code) => {
    if (typeof code !== 'string' || code.length > 4 * MAX_CODE2) fail('That theme code is damaged.');
    const text = code.replace(/\s+/g, '');
    const v2 = text.startsWith(PREFIX2);
    if (!v2 && !text.startsWith(PREFIX)) fail("That isn't a Glaze theme code. Codes start with glaze1:");
    const body = text.slice((v2 ? PREFIX2 : PREFIX).length);
    if (text.length > (v2 ? MAX_CODE2 : MAX_CODE) || !/^[\w-]+$/.test(body)) fail('That theme code is damaged.');
    let raw;
    try {
      raw = JSON.parse(new TextDecoder().decode(await inflate(unb64(body), v2 ? MAX_JSON2 : MAX_JSON)));
    } catch { fail('That theme code is damaged or cut short.'); }
    const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
    // An older Glaze reads only the six keys, so a glaze1 code with more is not one it could have made.
    if (!isObj(raw) || !Object.keys(raw).every((k) => ['c', 'l', 'b', 'k', 'd', 'n', ...(v2 ? ['x', 'm'] : [])].includes(k))) fail('That theme code is from a newer Glaze, or damaged.');
    if (typeof raw.c !== 'string' || !/^[0-9a-f]{84}$/i.test(raw.c)) fail('That theme code has a broken palette.');
    // A group that is there must be an object: anything else would be dropped, not checked.
    if (['l', 'b', 'k', 'n'].some((k) => k in raw && !isObj(raw[k])) || ('d' in raw && (!Array.isArray(raw.d) || raw.d.length > K.SET_MAX))) fail('That theme code is damaged.');
    const card = raw.k || {};
    const cardClean = K.settings(card);
    for (const k of Object.keys(card)) if (!K.LOOK.includes(k) || !same(cardClean[k], card[k])) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: `card.${k}` });
    // Each card style exactly as Glaze keeps it, and never a picture from someone's computer.
    const set = (raw.d || []).map((v) => { const x = K.style(v); if (!x || x.i || !same(x, v)) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: 'card style' }); return x; });
    // Look parts and mod references: each exactly as lib/lookparts.js keeps them. The part that fails is named.
    let parts = null;
    for (const [k, rule] of [['x', X.clean], ['m', X.mods]]) {
      if (!(k in raw)) continue;
      const got = rule(raw[k]);
      if (!got || !X.same(got, raw[k])) {
        const bad = k === 'x' && isObj(raw.x) ? Object.keys(raw.x).find((p) => { const c = X.clean({ [p]: raw.x[p] }); return !c || !X.same(c[p], raw.x[p]); }) : null;
        fail("That theme code has a setting Glaze can't use ({setting}).", { setting: bad ? `x.${String(bad).slice(0, 20)}` : k });
      }
      (parts ||= {})[k] = got;
    }
    const look = raw.l || {};
    const bg = raw.b || {};
    const colors = Object.fromEntries(G.GZ_COLORS.map(([v], i) => [v, `#${raw.c.slice(i * 6, i * 6 + 6).toLowerCase()}`]));
    const nav = raw.n || {};
    const clean = G.GZ_SANITIZE({ version: 2, colors, look, bg, nav });
    if (nav.k === 'image' && !nav.u) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: 'nav.u' });
    for (const [group, given, keys] of [['look', look, LOOK], ['bg', bg, BG], ['nav', nav, NAV]]) {
      for (const k of Object.keys(given)) {
        if (!keys.includes(k) || !same(clean[group][k], given[k])) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: `${group}.${k}` });

      }
    }
    return { colors: clean.colors, look: pick(clean.look, [...new Set([...Object.keys(look), ...SURFACES])]), bg: pick(clean.bg, Object.keys(bg)), nav: pick(clean.nav, Object.keys(nav)), card: pick(cardClean, Object.keys(card)), cards: set, parts };
  };

  const nav = (current, patch) => ({ ...current, ...patch, ...(('k' in patch || 'u' in patch) && { i: '' }) });
  return { PREFIX, PREFIX2, MAX_CODE2, encode, decode, nav };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHARE;
