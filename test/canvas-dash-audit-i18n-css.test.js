// Scoped language and first-paint CSS contracts. Dynamic label tables are included, not just literal t() calls.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
require('../lib/i18n.js');
const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const sources = ['content-canvas.js', 'features/folders.js', 'features/widgets.js', 'features/coursecards.js', 'features/coursemenu.js'].map(read);

// Follow test/i18n.test.js: scan only the first argument, including conditional literal keys.
const literalKeys = (js) => {
  const out = [];
  for (const m of js.matchAll(/\bt\s*\(/g)) {
    const start = m.index + m[0].length; let i = start, depth = 0, q = null;
    for (; i < js.length; i++) {
      const c = js[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
      if (c === "'" || c === '"' || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && depth-- === 0) break;
      else if (c === ',' && depth === 0) break;
    }
    const arg = js.slice(start, i);
    for (const s of arg.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (s[2] && !s[2].includes('${') && !/[=!]==\s*$/.test(arg.slice(0, s.index))) out.push(s[2].replace(/\\(.)/g, '$1'));
    }
  }
  return out;
};
const table = (source, name, scope = {}) => {
  const start = source.indexOf(`const ${name} = `); assert.ok(start >= 0, `missing ${name}`);
  const from = start + `const ${name} = `.length, to = source.indexOf(';', from);
  return vm.runInNewContext(`(${source.slice(from, to)})`, scope);
};
const widgets = read('features/widgets.js'), folders = read('features/folders.js');
const keys = new Set([
  ...sources.flatMap(literalKeys),
  ...Object.values(table(widgets, 'NAMES')), ...Object.values(table(widgets, 'EXTRA')),
  ...table(widgets, 'QUOTES').map(([, text]) => text), ...table(widgets, 'CHEERS'), ...table(widgets, 'HUB').map(([name]) => name),
  ...Object.values(table(folders, 'WORDS', { canvas: true })),
  ...table(read('features/coursemenu.js'), 'TONES'),
  'Breathe in', 'Hold', 'Breathe out', 'Course progress: {done} of {n} items complete',
]);
const vars = (s) => [...new Set([...s.matchAll(/\{(\w+)(?:\|lower)?\}/g)].map((m) => m[1]))].sort();

for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) test(`Canvas dashboard, menus and hidden modules: ${lang} has every scoped key and placeholder`, () => {
  const cat = globalThis.GZ_LANGS[lang]; assert.ok(cat); assert.ok(keys.size > 150, 'include the dynamic tables as well as direct calls');
  for (const key of keys) {
    assert.ok(Object.hasOwn(cat, key), `${lang} is missing "${key}"`);
    const forms = typeof cat[key] === 'string' ? [cat[key]] : Object.values(cat[key]);
    assert.ok(forms.length, `${lang}: ${key} has no plural forms`);
    for (const value of forms) { assert.equal(typeof value, 'string', `${lang}: ${key}`); assert.ok(value.trim(), `${lang}: ${key} is empty`); assert.deepEqual(vars(value), vars(key), `${lang}: ${key} placeholders`); }
  }
});

const css = read('canvas.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);

test('first-paint strip reservation has its size sheet before the lazy feature starts', () => {
  const core = read('content.js'), sizes = read('features/coursetabs.css');
  assert.match(core, /const SHEETS = [^\n]*'features\/coursetabs\.css'/);
  for (const [size, height] of [['small', 34], ['large', 48]]) assert.ok(sizes.includes(`html[data-gz-ctabs~="${size}"] { --gz-ctabs-h: ${height}px; }`));
  assert.ok(rules.some(([sel, body]) => sel.includes(':not(:has(> #gz-ctabs))::before') && /flex:\s*0 0 100%/.test(body) && /height:\s*var\(--gz-ctabs-h, 40px\)/.test(body)));
});

test('grade hover changes opacity and keeps the separate keyboard grade link out of flow', () => {
  assert.ok(rules.some(([sel, body]) => sel.includes('data-gz-enhance-gradeHover') && sel.includes('[data-gz-grade]::after') && /opacity:\s*0/.test(body) && !/display:\s*none/.test(body)));
  assert.ok(rules.some(([sel, body]) => sel === '#application .gz-card-grade' && /position:\s*absolute/.test(body) && /clip-path:\s*inset\(50%\)/.test(body)));
  assert.ok(rules.some(([sel, body]) => sel === '#application .gz-card-grade:focus-visible' && /clip-path:\s*none/.test(body)));
});

test('native card-menu focus remains visible after the proxy menu closes', () => {
  assert.ok(rules.some(([sel, body]) => sel.includes('.ic-DashboardCard__header-button:is([aria-expanded="true"], :focus)') && /visibility:\s*visible/.test(body)));
  assert.ok(rules.some(([sel, body]) => sel.includes(':has(.ic-DashboardCard__header-button:is([aria-expanded="true"], :focus)) > .gz-cm-btn') && /visibility:\s*hidden/.test(body)));
});
