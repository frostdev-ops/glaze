// Settings search (settings/search.js): a query that names an Object.prototype member, and text whose folded form is a
// different length from the text (audit 2026-11-11 A8 #3): the highlight must land on the letters that matched, inside the node.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const F = require('../../extension/settings/search.js');

test('a query word that names an Object.prototype member is just a word', () => {
  for (const q of ['constructor', 'Constructors', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', 'toLocaleString', 'propertyIsEnumerable']) {
    let words;
    assert.doesNotThrow(() => { words = F.parse(q); }, q);
    assert.deepEqual(words, [[q.toLowerCase()]], `${q} has no synonyms`);
  }
  assert.equal(F.matches('Writer', 'Settings for the constructor of papers', F.parse('constructor')), true);
  assert.equal(F.matches('Writer', 'Papers', F.parse('constructor')), false);
});

test('synonyms still count, plurals too', () => {
  assert.deepEqual(F.parse('dark'), [['dark', 'h:palette']]);
  assert.deepEqual(F.parse('Fonts'), [['fonts', 'text size', 'line height']]);
  assert.equal(F.matches('Palette', '', F.parse('night')), true);
  assert.equal(F.matches('Motion', 'Animated', F.parse('animation')), true);
});

test('a highlight is the letters that matched, in the text as written', () => {
  const at = (text, q, heading = false) => F.spans(text, F.parse(q), heading);
  // Accents fold; the offsets are the text's own.
  assert.deepEqual(at('Tamaño del texto', 'tamano'), [[0, 6]]);
  assert.deepEqual(at('Tamaño del texto', 'texto'), [[11, 16]]);
  // İ (U+0130) lower-cases to two code units; it must not move what comes after it.
  assert.deepEqual(at('İngilizce', 'ce'), [[7, 9]]);
  assert.deepEqual(at('İstanbul 101', 'istanbul'), [[0, 8]], 'İ folds to i');
  assert.deepEqual(at('Kurs İstanbul', 'İSTANBUL'), [[5, 13]], 'and a query with İ the same');
  assert.deepEqual(at('İ', 'i'), [[0, 1]]);
  assert.equal(F.matches('', 'İstanbul 101', F.parse('istanbul')), true);
  // Code points of more than one code unit, and one that folds to a shorter one (U+2F800 → U+4E3D).
  assert.deepEqual(at('\u{10400}bc', 'bc'), [[2, 4]]);
  assert.deepEqual(at('\u{10400}bc', '\u{10428}'), [[0, 2]], 'Deseret capital finds its small letter');
  assert.deepEqual(at('\u{2F800}ab', 'ab'), [[2, 4]]);
  assert.deepEqual(at('\u{2F800}ab', '丽'), [[0, 2]]);
  assert.deepEqual(at('𝒜bc', 'bc'), [[2, 4]]);
  // Heading-only synonyms mark only headings.
  assert.deepEqual(at('Palette', 'dark'), []);
  assert.deepEqual(at('Palette', 'dark', true), [[0, 7]]);
});

test('no code point moves a highlight or runs it past the text', () => {
  const words = F.parse('#'), bad = [];
  for (let cp = 0; cp < 0x110000; cp++) {
    if ((cp >= 0xd800 && cp <= 0xdfff) || cp === 0x23) continue;
    const c = String.fromCodePoint(cp), text = `${c}#${c}`, got = F.spans(text, words);
    if (got.length !== 1 || got[0][0] !== c.length || got[0][1] !== c.length + 1) bad.push(cp.toString(16));
    else if (got[0][1] > text.length) bad.push(`${cp.toString(16)} past the end`);
  }
  assert.deepEqual(bad, []);
});

test('a heading-only synonym with nothing after its h: ends instead of looping', () => {
  // A loop that never ends can't be failed from inside the process: run it in one that is stopped after 5 seconds.
  const run = (heading) => spawnSync(process.execPath, ['-e', `const F = require(${JSON.stringify(require.resolve('../../extension/settings/search.js'))}); process.stdout.write(JSON.stringify(F.spans('Palette', F.parse('h:'), ${heading})))`], { timeout: 5000, encoding: 'utf8' });
  for (const heading of [false, true]) {
    const r = run(heading);
    assert.equal(r.error, undefined, `heading ${heading}: ${r.error?.message}`);
    assert.equal(r.stdout, '[]');
  }
});
