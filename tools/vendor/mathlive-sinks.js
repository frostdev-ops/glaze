// Firefox Add-ons' linter warns on every innerHTML assignment, and a release needs zero warnings. Rewrites
// each `<target>.innerHTML = <markup>;` in the vendored MathLive runtime to `__gzHTML(<target>, <markup>);`, which parses
// the markup in an inert DOMParser document (an explicit body keeps leading whitespace; SVG targets parse as SVG) and
// moves its nodes in, a template's into its content. Run by tools/vendor/vendor-mathlive.sh; refuses a file with a sink left.
//   node tools/vendor/mathlive-sinks.js extension/vendor/mathlive/mathlive.mjs
const fs = require('node:fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const HELPER = `// tools/vendor/mathlive-sinks.js: markup parsed in an inert document instead of an innerHTML assignment.
function __gzHTML(target, html) {
  const svg = target.namespaceURI === "http://www.w3.org/2000/svg";
  const parsed = new globalThis.DOMParser().parseFromString(svg ? '<svg xmlns="http://www.w3.org/2000/svg">' + html + "</svg>" : "<body>" + html, svg ? "image/svg+xml" : "text/html");
  (target.localName === "template" ? target.content : target).replaceChildren(...(svg ? parsed.documentElement : parsed.body).childNodes);
}
`;
// The end of an assignment's value: the first `;` outside brackets, strings, template literals and comments.
const end = (s, at) => {
  const stack = [];
  for (let i = at; i < s.length; i++) {
    const c = s[i], top = stack[stack.length - 1];
    if (top === '`') {
      if (c === '\\') { i++; continue; }
      if (c === '`') stack.pop();
      else if (c === '$' && s[i + 1] === '{') { stack.push('${'); i++; }
      continue;
    }
    if (c === '"' || c === "'") { for (i++; s[i] !== c; i++) if (s[i] === '\\') i++; continue; }
    if (c === '`') { stack.push('`'); continue; }
    if (c === '/' && s[i + 1] === '/') { i = s.indexOf('\n', i); continue; }
    if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i) + 1; continue; }
    if ('([{'.includes(c)) { stack.push(c); continue; }
    if (')]}'.includes(c)) { stack.pop(); continue; }
    if (c === ';' && !stack.length) return i;
  }
  throw new Error(`mathlive-sinks: no end for the assignment at ${at}`);
};
const SINK = /((?:this|[A-Za-z_$][\w$]*)(?:\.[A-Za-z_$][\w$]*)*)\.innerHTML\s*=(?!=)\s*/g;
let out = '', last = 0, count = 0;
for (let m; (m = SINK.exec(src));) {
  const valueAt = m.index + m[0].length, stop = end(src, valueAt);
  out += src.slice(last, m.index) + `__gzHTML(${m[1]}, ${src.slice(valueAt, stop)})`;
  last = stop; SINK.lastIndex = stop; count++;
}
src = out + src.slice(last);
if (count && !src.includes('function __gzHTML(')) {
  // After the module's leading comment block, before its first statement.
  const at = src.search(/^(?!\/\/|\/\*| \*|\s*$)/m);
  src = src.slice(0, at) + HELPER + src.slice(at);
}
if (/\.(?:inner|outer)HTML\s*=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/.test(src)) throw new Error('mathlive-sinks: an HTML sink is left; review the rewrite');
fs.writeFileSync(file, src);
console.log(`mathlive-sinks: rewrote ${count} innerHTML assignment${count === 1 ? '' : 's'}`);
