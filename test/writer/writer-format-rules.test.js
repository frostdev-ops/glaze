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

const withBody = (id, text) => {
  const json = FX.papers[id](), at = F.read(S.paper.nodeFromJSON(json), ST.FORMATS[id]).end;
  json.content.splice(at, 0, P(text));
  return S.paper.nodeFromJSON(json);
};
const cards = (doc, id, rule) => F.check(doc, ST.FORMATS[id]).issues.filter((i) => i.rule === rule);
// CMOS 17 14.1–14.6: notes-bibliography papers cite sources in notes; a parenthetical that points inside the paper
// (CMOS 3.9 figure and table callouts, "(see Table 2)"), a note to the reader ("(emphasis added)", CMOS 13.60) or a name
// the sentence runs on through is no citation. APA 7 §8.11 likewise.
test('Chicago: figure, table and chapter callouts and run-on names are not citations to move into notes (CMOS 14.1, 3.9, 13.60)', () => {
  for (const text of ['As shown (Figure 3), rates rose.', 'Rates rose (Table 2).', 'This is covered later (Chapter 4).', 'Rates rose (see Table 2).', 'He “never” left (emphasis added).', 'The mission (Apollo 11) landed in July.', 'Rates rose (Fig. 3).'])
    assert.deepEqual(cards(withBody('chicago17', text), 'chicago17', 'cite-note'), [], text);
  const real = cards(withBody('chicago17', 'Time swings (Smith 42).'), 'chicago17', 'cite-note');
  assert.equal(real.length, 1, 'an author and page is still a citation');
  assert.equal(real[0].fix.note, 'Smith, 42.');
});
test('APA: a label or a run-on name with a number is not a citation missing its comma (APA 8.11)', () => {
  for (const text of ['As shown (Figure 2019), rates rose.', 'The tournament (Euro 2020) drew crowds.', 'Rates rose (Table 2020).'])
    assert.deepEqual(cards(withBody('apa7', text), 'apa7', 'cite-shape'), [], text);
  assert.deepEqual(cards(withBody('apa7', 'Rates rose (Smith 2020).'), 'apa7', 'cite-shape').map((i) => i.suggestions), [['(Smith, 2020)']]);
});
