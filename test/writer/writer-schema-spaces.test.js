// writer/writer-schema.js parse: only the white space CSS collapses (space, tab, line break, form feed) collapses, with
// no-break spaces as Quill's clipboard keeps them; an ideographic indent and typographic spaces stay as written.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');

test('CJK ideographic spaces and typographic spaces are text, in every schema', () => {
  for (const schema of [S.compose, S.paper, S.canvas]) {
    assert.equal(S.parse(schema, '<p>　　第一段</p>').textContent, '　　第一段');
    for (const c of [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　'])
      assert.equal(S.parse(schema, `<p>a${c}${c}b ${c}</p>`).textContent, `a${c}${c}b ${c}`, `U+${c.charCodeAt(0).toString(16)}`);
    assert.equal(S.parse(schema, '<p>a  b\n\tc </p>').textContent, 'a b c', 'ASCII white space still collapses');
    assert.equal(S.parse(schema, '<p>a  b</p>').textContent, 'a  b', 'no-break spaces as before');
    assert.match(S.serialize(schema, S.parse(schema, '<p>　　第一段</p>')), /　　第一段/);
  }
});
