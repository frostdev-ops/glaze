// Glaze Writer's legible run colours, for rich paste (writer-paste.js) and .docx import (lib/writer-docx.js): a run's
// colour stays only where the paper shows it, on the highlight it gets or else the white page, at 2:1 (WCAG contrast) or
// more, so light text from a dark shading, cell or page (and text already invisible in Word) takes the paper's ink. Word's
// theme text and page colours (text1/2, background1/2, dark1/2, light1/2) untinted are the document's own: the paper's ink
// whatever their hex. Classic script, loaded by writer.html and papers.js before writer-paste.js; module.exports for node.
var GZ_WRITER_COLOR = globalThis.GZ_WRITER_COLOR || (() => {
  const C = () => (typeof GZ_COLOR !== 'undefined' ? GZ_COLOR : require('./color.js'));
  const PAGE = 'FFFFFF', MIN = 2;
  const OWN = new Set(['text1', 'text2', 'background1', 'background2', 'dark1', 'dark2', 'light1', 'light2']);
  // color: 'RRGGBB'; o: { on (the highlight's colour, #rrggbb or RRGGBB), theme (Word's theme name), tint (a theme tint or
  // shade is given) } → the colour to keep ('RRGGBB') or null.
  const legible = (color, o = {}) => {
    if (!/^[0-9a-f]{6}$/i.test(color || '')) return null;
    if (!o.tint && OWN.has(String(o.theme || '').trim().toLowerCase())) return null;
    const on = /^#?[0-9a-f]{6}$/i.test(o.on || '') ? String(o.on).replace('#', '') : PAGE;
    return C().contrast(`#${color}`, `#${on}`) >= MIN ? color.toUpperCase() : null;
  };
  return { legible, PAGE, MIN };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_COLOR;
