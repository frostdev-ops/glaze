// A Canvas HTML fixture (test/fixtures/canvas-*.html) as stand-in DOM elements (test/stand-in-dom.js): its <body> and
// everything in it, with ids, classes, attributes, hidden and an inline display, for the tests that run page code
// against a captured page. Scripts, styles and comments are skipped; text is kept. No tests here.
const { El } = require('./stand-in-dom.js');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title', 'template', 'noscript']);
const ATTR = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

// → the body element, attached under doc.root.
const parse = (html, doc) => {
  const at = html.search(/<body\b/i);
  const src = at < 0 ? html : html.slice(at);
  const stack = [doc.root];
  const tok = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)|</g;
  let body = null, m;
  while ((m = tok.exec(src))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[5] !== undefined) { const text = m[5].replace(/\s+/g, ' '); if (text.trim()) stack.at(-1).append(text); continue; }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const i = stack.map((e) => e.tagName.toLowerCase()).lastIndexOf(tag);
      if (i > 0) stack.length = i;
      if (tag === 'body') break;
      continue;
    }
    const el = new El(tag, doc);
    for (const a of m[3].matchAll(ATTR)) {
      const k = a[1].toLowerCase(), v = a[2] ?? a[3] ?? a[4] ?? '';
      if (k === 'hidden') el.hidden = true;
      else if (k === 'style') { const d = /(?:^|;)\s*display\s*:\s*([^;]+)/i.exec(v); if (d) el.style.display = d[1].trim(); }
      else el.setAttribute(k, v);
    }
    stack.at(-1).append(el);
    if (tag === 'body') body = el;
    if (RAW.has(tag)) { const end = src.toLowerCase().indexOf(`</${tag}`, tok.lastIndex); tok.lastIndex = end < 0 ? src.length : end; continue; }
    if (!VOID.has(tag) && !m[4]) stack.push(el);
  }
  return body;
};
module.exports = { parse };
