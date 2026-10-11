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

  return { parse, brightness, saturated, luminance, contrast, hex, same };
})();

if (typeof module !== 'undefined') module.exports = GZ_COLOR;
