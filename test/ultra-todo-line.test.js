// Ultra's To Do column on its base pages (Courses, Organizations), div.todo-panel: no rule beside it on any Look. Empty, its
// left border drew a line down the page. As the sidebar (features/sidebar.css) it keeps the sidebar's edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../theme.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(([, s, b]) => s.split(/,(?![^(]*\))/).map((x) => [x.trim(), b]));
// [ids, classes and attributes, tags]; :not() counts as its most specific argument.
const spec = (sel) => {
  let s = sel, n = [0, 0, 0];
  for (const [, inner] of sel.matchAll(/:not\(((?:[^()]|\([^()]*\))*)\)/g)) {
    const m = inner.split(/,(?![^(]*\))/).map((x) => spec(x.trim())).sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
    n = n.map((v, i) => v + m[i]);
  }
  s = s.replace(/:not\(((?:[^()]|\([^()]*\))*)\)/g, '');
  n[0] += (s.match(/#[\w-]+/g) || []).length;
  n[1] += (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  n[2] += (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return n;
};
const beats = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

test('theme.css: a To Do column that is not the sidebar draws no left border, over every rule that gives it one', () => {
  const lines = rules.filter(([s, b]) => /(^|[\s>])(div)?\.todo-panel$/.test(s) && /border-left:\s*1px[^;]*!important/.test(b));
  assert.ok(lines.length, 'the shared side-panel rule still names the column');
  for (const sel of ['html:not([data-gz-sidebar="expanded"], [data-gz-sidebar="collapsed"]) div.todo-panel', 'html div.todo-panel:not([data-gz-sidebar-host])']) {
    const clear = rules.find(([s, b]) => s === sel && /border-left:\s*0\s*!important/.test(b));
    assert.ok(clear, sel);
    for (const [s] of lines) assert.ok(beats(spec(sel), spec(s)) > 0, `${sel} over ${s}`);
  }
});
