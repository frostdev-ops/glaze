const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/fonts.js');
const G = require('../defaults.js');

test('font settings: catalog ids and typed family names, nothing that could break out of CSS', () => {
  const look = (o) => G.GZ_SANITIZE({ look: o }).look;
  assert.equal(look({ font: 'lexend' }).font, 'lexend');
  assert.equal(look({ font: '  Comic   Neue ' }).font, 'Comic Neue');
  for (const bad of ['Comic"; }', 'a'.repeat(41), 'url(x)', '', 'auto', 7, null]) assert.equal(look({ font: bad }).font, 'system', String(bad));
  assert.equal(look({ head: 'auto', mono: 'jetbrains-nf' }).mono, 'jetbrains-nf');
  assert.equal(look({ head: 'Nope;' }).head, 'auto');
});

test('every catalog font has a stack, and loaded ones are registered under a Glaze name', () => {
  for (const f of F.LIST) assert.match(F.stack(f.id), /(sans-serif|serif|monospace)$/, f.id);
  assert.equal(F.stack('lexend'), `"Glaze Lexend", ${F.SANS}`);
  assert.equal(F.stack('Comic Neue'), `"Glaze Comic Neue", "Comic Neue", ${F.SANS}`, 'a typed name falls back to one installed locally');
  assert.equal(F.stack('nonsense;'), F.stack('system'));
  assert.equal(new Set(F.LIST.map((f) => f.id)).size, F.LIST.length, 'ids are unique');
  for (const f of F.LIST.filter((x) => x.files)) for (const u of Object.values(f.files)) assert.match(u, /^https:\/\/cdn\.jsdelivr\.net\/(npm|gh)\/(@[\w-]+\/)?[^/@]+(\/[^/@]+)?@v?\d[\w.]*\//, `${f.id}: pinned jsDelivr file`);
});

test("Google's CSS: Latin faces only, normal style, https files", () => {
  const css = ['cyrillic', 'latin-ext', 'latin'].map((sub, i) => `/* ${sub} */\n@font-face {\n  font-family: 'X';\n  font-style: normal;\n  font-weight: 700;\n  src: url(https://fonts.gstatic.com/x${i}.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}`).join('\n')
    + "\n/* latin */\n@font-face { font-family: 'X'; font-style: italic; font-weight: 400; src: url(https://fonts.gstatic.com/i.woff2); }";
  assert.deepEqual(F.faces(css).map((f) => [f.subset, f.weight, f.url]), [['latin-ext', '700', 'https://fonts.gstatic.com/x1.woff2'], ['latin', '700', 'https://fonts.gstatic.com/x2.woff2']]);
  assert.equal(F.faces("@font-face { src: url(https://a/b.woff2); }").length, 1, 'no subset comments: every face');
  assert.equal(F.faces("@font-face { src: url(http://a/b.woff2); }").length, 0);
  assert.equal(F.cssUrl('Source Serif 4'), 'https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600;700&display=swap');
});
