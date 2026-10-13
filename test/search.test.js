const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/search.js');

const hit = (q, body, head = '') => F.matches(head, body, F.parse(q));

test('every word must appear, in any case', () => {
  assert.ok(hit('Dark DOC', 'Extras Dark documents PDFs and file previews'));
  assert.ok(!hit('dark grain', 'Extras Dark documents'));
  assert.deepEqual(F.parse('   '), []);
});

test('synonyms: dark finds palettes, font finds text size, either spelling of colour', () => {
  assert.ok(hit('dark', 'Frost Midnight', 'Palette'));
  assert.ok(!hit('dark', 'Command palette'), 'heading-only synonym');
  assert.ok(hit('fonts', 'Look Text size'));
  assert.ok(hit('color', 'Motion Colour and border transitions'));
  assert.ok(hit('colour', 'Tone course colors'));
  assert.ok(!hit('dark', 'Motion Level'));
});

test('spans mark every alternative that appears', () => {
  assert.deepEqual(F.spans('Dark palette, dark', F.parse('dark')), [[0, 4], [14, 18]]);
  assert.deepEqual(F.spans('Palette', F.parse('dark'), true), [[0, 7]]);
  assert.deepEqual(F.spans('nothing', F.parse('dark')), []);
});
