// Settings search: each query word, or one of its synonyms, must appear in the text. Classic
// script; module.exports for node.
const GZ_FIND = (() => {
  // Query word -> other words that count for it. 'h:' ones count only in a section or group heading,
  // so 'dark' finds the Palette section without every "palette" in the text.
  const SYN = {
    dark: ['h:palette'], light: ['h:palette'], theme: ['h:palette'], night: ['dark', 'h:palette'],
    color: ['colour'], colour: ['color'],
    font: ['text size', 'line height'], typeface: ['font'], typography: ['font', 'text size', 'line height'],
    animation: ['h:motion', 'animated'], animate: ['h:motion', 'animated'],
    wallpaper: ['h:background'], backup: ['back up', 'export'], restore: ['import'],
    shortcut: ['keyboard', 'ctrl'], hotkey: ['keyboard', 'ctrl'],
    zoom: ['text size'], spacing: ['density', 'line height'], shadow: ['depth'], rounded: ['corner'],
    transparent: ['glass'], accessibility: ['readable', 'dyslexic', 'reduced motion', 'contrast', 'text size'],
  };
  // One list of alternatives per word ('fonts' also tries 'font').
  const parse = (q) => q.toLowerCase().split(/\s+/).filter(Boolean).map((w) => [w, ...(SYN[w] || SYN[w.replace(/s$/, '')] || [])]);
  const has = (head, body, a) => (a.startsWith('h:') ? head.includes(a.slice(2)) : head.includes(a) || body.includes(a));
  const matches = (head, body, words) => {
    const h = head.toLowerCase(), b = body.toLowerCase();
    return words.every((alts) => alts.some((a) => has(h, b, a)));
  };
  // [start, end] of every alternative in the text, for highlighting; heading-only ones in headings.
  const spans = (text, words, heading = false) => {
    const t = text.toLowerCase();
    const out = [];
    for (let a of words.flat()) {
      if (a.startsWith('h:')) { if (!heading) continue; a = a.slice(2); }
      for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + a.length)) out.push([i, i + a.length]);
    }
    return out;
  };
  return { SYN, parse, matches, spans };
})();

if (typeof module !== 'undefined') module.exports = GZ_FIND;
