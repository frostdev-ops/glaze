// Theme codes: a palette, look, background and course cards as one line of text to paste into someone else's Glaze.
// "glaze1:" + base64url(deflate-raw(JSON)). No server: the code is the settings. Classic script after
// defaults.js; module.exports for node.
const GZ_SHARE = (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_COLORS, GZ_SPEC, GZ_SANITIZE } : require('../defaults.js');
  const K = typeof GZ_CARDS !== 'undefined' ? GZ_CARDS : require('./cards.js');
  const PREFIX = 'glaze1:';
  // Look minus tooltips and hints: those are how Glaze behaves, not how a theme looks.
  const LOOK = Object.keys(G.GZ_SPEC.look).filter((k) => !['tooltips', 'hints'].includes(k));
  const SURFACES = LOOK.filter((k) => /^(surface|shadow)/.test(k));
  const BG = Object.keys(G.GZ_SPEC.bg);
  const NAV = ['k', 'c', 'd', 'a', 'u', 'o', 'f', 'ink'];
  const MAX_CODE = 4000;
  const MAX_JSON = 8192;

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
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64 = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

  // Course cards, when they are more than the defaults: how they look (k), and a set of card styles (d) that
  // takes turns on the cards of whoever uses the code. `cards` is the cards sync item (lib/cards.js): its theme set,
  // or else the styles given to courses, linked pictures only. A picture kept on this computer never leaves it.
  const cardSet = (cards = {}) => (cards['*'] || Object.entries(cards).filter(([k]) => k !== '*').map(([, v]) => v)).filter((v) => v && !v.i).slice(0, K.SET_MAX);
  const encode = async (s, cards) => {
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
    const json = JSON.stringify(raw);
    const bytes = new TextEncoder().encode(json);
    const code = PREFIX + b64(await pipe(bytes, new CompressionStream('deflate-raw')));
    // What decode would refuse is refused here, so a copied code always works where it is pasted.
    if (bytes.length > MAX_JSON || code.length > MAX_CODE) fail('This theme is too long for a code: its card pictures have long links. Shorten them, or remove some card styles.');
    return code;
  };

  // The code is untrusted: every key must be one Glaze knows and every value must come through
  // GZ_SANITIZE unchanged, or the whole code is refused. Returns { colors, look, bg }.
  // why is English with {placeholders}; the editor shows it translated (lib/i18n.js).
  const fail = (why, vars = {}) => { throw Object.assign(new Error(why.replace(/\{(\w+)\}/g, (_, k) => vars[k])), { why, vars }); };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const decode = async (code) => {
    const text = String(code || '').replace(/\s+/g, '');
    if (!text.startsWith(PREFIX)) fail("That isn't a Glaze theme code. Codes start with glaze1:");
    if (text.length > MAX_CODE || !/^[\w-]+$/.test(text.slice(PREFIX.length))) fail('That theme code is damaged.');
    let raw;
    try {
      raw = JSON.parse(new TextDecoder().decode(await pipe(unb64(text.slice(PREFIX.length)), new DecompressionStream('deflate-raw'), MAX_JSON)));
    } catch { fail('That theme code is damaged or cut short.'); }
    const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
    if (!isObj(raw) || !Object.keys(raw).every((k) => ['c', 'l', 'b', 'k', 'd', 'n'].includes(k))) fail('That theme code is from a newer Glaze, or damaged.');
    if (typeof raw.c !== 'string' || !/^[0-9a-f]{84}$/i.test(raw.c)) fail('That theme code has a broken palette.');
    // A group that is there must be an object: anything else would be dropped, not checked.
    if (['l', 'b', 'k', 'n'].some((k) => k in raw && !isObj(raw[k])) || ('d' in raw && (!Array.isArray(raw.d) || raw.d.length > K.SET_MAX))) fail('That theme code is damaged.');
    const card = raw.k || {};
    const cardClean = K.settings(card);
    for (const k of Object.keys(card)) if (!K.LOOK.includes(k) || !same(cardClean[k], card[k])) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: `card.${k}` });
    // Each card style exactly as Glaze keeps it, and never a picture from someone's computer.
    const set = (raw.d || []).map((v) => { const x = K.style(v); if (!x || x.i || !same(x, v)) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: 'card style' }); return x; });
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
    return { colors: clean.colors, look: pick(clean.look, [...new Set([...Object.keys(look), ...SURFACES])]), bg: pick(clean.bg, Object.keys(bg)), nav: pick(clean.nav, Object.keys(nav)), card: pick(cardClean, Object.keys(card)), cards: set };
  };

  const nav = (current, patch) => ({ ...current, ...patch, ...(('k' in patch || 'u' in patch) && { i: '' }) });
  return { PREFIX, encode, decode, nav };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHARE;
