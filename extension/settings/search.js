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
  // Lowercase without accents, a code point at a time, so "tamano" finds "Tamaño" and "istanbul" finds "İstanbul" (İ's lower
  // case is two code units; read as I it folds like any other dotted I).
  const lower = (s) => s.replace(/\u0130/g, 'I').toLowerCase();
  const base = (c) => (c < '\x80' ? c : String.fromCodePoint(c.normalize('NFD').codePointAt(0)));
  const fold = (s) => lower(s).replace(/[^\0-\x7f]/gu, base);
  // fold, and for each unit of it the stretch of `s` it came from: a code point can fold to another length, so a place in the
  // folded text is not a place in the text.
  const folding = (s) => {
    const from = [], to = [];
    let text = '', at = 0;
    for (const c of lower(s)) {
      const f = base(c);
      for (let k = 0; k < f.length; k++) { from.push(at); to.push(at + c.length); }
      text += f;
      at += c.length;
    }
    return { text, from, to };
  };
  // One list of alternatives per word ('fonts' also tries 'font'); a word that names an Object.prototype member has none.
  const synonyms = (w) => (Object.hasOwn(SYN, w) ? SYN[w] : Object.hasOwn(SYN, w.replace(/s$/, '')) ? SYN[w.replace(/s$/, '')] : []);
  const parse = (q) => fold(q).split(/\s+/).filter(Boolean).map((w) => [w, ...synonyms(w)]);
  const has = (head, body, a) => (a.startsWith('h:') ? head.includes(a.slice(2)) : head.includes(a) || body.includes(a));
  const matches = (head, body, words) => {
    const h = fold(head), b = fold(body);
    return words.every((alts) => alts.some((a) => has(h, b, a)));
  };
  // [start, end] of every alternative in the text as written, for highlighting; heading-only ones in headings.
  const spans = (text, words, heading = false) => {
    const { text: t, from, to } = folding(text);
    const out = [];
    for (let a of words.flat()) {
      if (a.startsWith('h:')) { if (!heading) continue; a = a.slice(2); }
      if (!a) continue;
      for (let i = t.indexOf(a); i >= 0; i = t.indexOf(a, i + a.length)) out.push([from[i], to[i + a.length - 1]]);
    }
    return out;
  };
  return { SYN, parse, matches, spans };
})();

if (typeof module !== 'undefined') module.exports = GZ_FIND;
