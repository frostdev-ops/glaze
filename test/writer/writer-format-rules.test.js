// Writer's format checks (writer/writer-format.js) on ordinary papers: each test names the APA 7th ed., MLA 9th ed. or
// Chicago 17th ed. rule it holds the check to, and a correct paper is never flagged.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');
const ST = require('../../extension/writer/writer-styles.js');
const F = require('../../extension/writer/writer-format.js');
const FX = require('../fixtures/writer-paper-fixtures.js');

const P = (text) => ({ type: 'paragraph', attrs: { align: null, indent: 0, line: null, first: -0.5 }, content: [{ type: 'text', text }] });
const withEntries = (id, entries) => {
  const json = FX.papers[id](), list = ST.listAt(json);
  json.content.splice(list.from, list.to - list.from, ...entries.map(P));
  return S.paper.nodeFromJSON(json);
};
const rules = (doc, id) => F.check(doc, ST.FORMATS[id]).issues.map((i) => i.rule);

// APA 7 §9.44–9.48, MLA 9 §5.124–5.126, CMOS 17 14.66: letter by letter, A/An/The skipped, nothing precedes something.
test('a correctly ordered list page is never "Entries go in alphabetical order" (APA 9.44–9.48, MLA 5.124–5.126, CMOS 14.66)', () => {
  for (const id of ['mla9', 'apa7', 'chicago17']) {
    for (const entries of [
      ['Adams, J. (2019). One.', 'Brown, K. (2018). Two.', 'The Pew Research Center. (2020). Three.', 'Smith, A. (2017). Four.'],
      ['Brown, J. One.', 'Browning, K. Two.', 'Smith, A. Three.'],
      ['Smith, Zadie. Swing Time.', '———. White Teeth.', 'Thomas, Ann. Notes.'],
      ['Nilsen, P. One.', 'Ødegaard, M. Two.', 'Smith, A. Three.'],
    ]) assert.ok(!rules(withEntries(id, entries), id).includes('list-order'), `${id}: ${entries.join(' | ')}`);
    assert.ok(rules(withEntries(id, ['Smith, A. Four.', 'Adams, J. One.']), id).includes('list-order'), `${id}: misordered`);
  }
});
