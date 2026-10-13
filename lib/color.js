// Colour math shared by the content script, popup, options page and tests. No DOM.
// Classic script: the extension loads it before defaults.js; node loads it through module.exports.
const GZ_COLOR = (() => {
  // Accepts what authors write (#rgb, #rrggbb, #rrggbbaa) and what getComputedStyle returns:
  // rgb()/rgba() with 0-255 channels, or color(srgb r g b / a) with 0-1 channels (any color-mix()).
  // Returns { r, g, b, a } with r/g/b in 0-255, or null.
  const parse = (c) => {
    if (typeof c !== 'string') return null;
    c = c.trim().toLowerCase();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(c)) {
      let h = c.slice(1);
      if (h.length === 3) h = [...h].map((x) => x + x).join('');
      const n = (i) => parseInt(h.slice(i, i + 2), 16);
      return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
    }
    let m = c.match(/^rgba?\(([^)]+)\)$/);
    let scale = 1;
    if (!m) { m = c.match(/^color\(srgb\s+([^)]+)\)$/); scale = 255; }
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0] * scale, g: p[1] * scale, b: p[2] * scale, a: p[3] ?? 1 };
  };

  // Gamma-space brightness, 0-1. Cheap and what the 1.0 sweep thresholds were tuned against.
  const brightness = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  // Greys and whites only: a saturated colour is a brand colour (button, pill), never Ultra's paper.
  const saturated = ({ r, g, b }) => Math.max(r, g, b) - Math.min(r, g, b) > 60;

  // WCAG 2 relative luminance and contrast ratio.
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const contrast = (a, b) => {
    const [x, y] = [luminance(parse(a)), luminance(parse(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('');
  // Same colour once rounded: computed styles come back as rgb(), tokens are stored as hex.
  const same = (a, b) => !!a && !!b && hex(a) === hex(b);

  // OKLab (Ottosson): perceptual, so mixes keep their brightness like the gradients do. Out-of-gamut
  // results are clipped by hex().
  const lab = (c) => {
    const [r, g, b] = [c.r, c.g, c.b].map(lin);
    const [l, m, s] = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]]
      .map(([x, y, z]) => Math.cbrt(x * r + y * g + z * b));
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const fromLab = ([L, A, B]) => {
    const [l, m, s] = [L + 0.3963377774 * A + 0.2158037573 * B, L - 0.1055613458 * A - 0.0638541728 * B, L - 0.0894841775 * A - 1.291485548 * B].map((v) => v ** 3);
    const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    return hex({ r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) });
  };
  // `t` of the way from a to b, like color-mix(in oklab). Hex out.
  const mix = (a, b, t) => {
    const [x, y] = [lab(parse(a)), lab(parse(b))];
    return fromLab(x.map((v, i) => v + (y[i] - v) * t));
  };
  // a's lightness and colorfulness in b's hue; a itself when b is (near) gray and has no hue to give.
  const rehue = (a, b) => {
    const [[L, A, B], [, A2, B2]] = [lab(parse(a)), lab(parse(b))];
    const k = Math.hypot(A, B) / Math.hypot(A2, B2);
    return Math.hypot(A2, B2) < 0.02 ? hex(parse(a)) : fromLab([L, A2 * k, B2 * k]);
  };

  return { parse, brightness, saturated, luminance, contrast, hex, same, mix, rehue };
})();

if (typeof module !== 'undefined') module.exports = GZ_COLOR;
