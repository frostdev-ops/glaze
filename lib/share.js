// Theme codes: a palette, look and background as one line of text to paste into someone else's Glaze.
// "glaze1:" + base64url(deflate-raw(JSON)). No server: the code is the settings. Classic script after
// defaults.js; module.exports for node.
const GZ_SHARE = (() => {
  const G = typeof GZ_SANITIZE !== 'undefined' ? { GZ_COLORS, GZ_SPEC, GZ_SANITIZE } : require('../defaults.js');
  const PREFIX = 'glaze1:';
  // Look minus tooltips and hints: those are how Glaze behaves, not how a theme looks.
  const LOOK = Object.keys(G.GZ_SPEC.look).filter((k) => !['tooltips', 'hints'].includes(k));
  const BG = Object.keys(G.GZ_SPEC.bg);
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

  const encode = async (s) => {
    const json = JSON.stringify({ c: G.GZ_COLORS.map(([v]) => s.colors[v].slice(1)).join(''), l: pick(s.look, LOOK), b: pick(s.bg, BG) });
    return PREFIX + b64(await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw')));
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
    if (!isObj(raw) || !Object.keys(raw).every((k) => ['c', 'l', 'b'].includes(k))) fail('That theme code is from a newer Glaze, or damaged.');
    if (typeof raw.c !== 'string' || !/^[0-9a-f]{84}$/i.test(raw.c)) fail('That theme code has a broken palette.');
    const look = isObj(raw.l) ? raw.l : {};
    const bg = isObj(raw.b) ? raw.b : {};
    const colors = Object.fromEntries(G.GZ_COLORS.map(([v], i) => [v, `#${raw.c.slice(i * 6, i * 6 + 6).toLowerCase()}`]));
    const clean = G.GZ_SANITIZE({ version: 2, colors, look, bg });
    for (const [group, given, keys] of [['look', look, LOOK], ['bg', bg, BG]]) {
      for (const k of Object.keys(given)) {
        if (!keys.includes(k) || !same(clean[group][k], given[k])) fail("That theme code has a setting Glaze can't use ({setting}).", { setting: `${group}.${k}` });

      }
    }
    return { colors: clean.colors, look: pick(clean.look, Object.keys(look)), bg: pick(clean.bg, Object.keys(bg)) };
  };

  return { PREFIX, encode, decode };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHARE;
