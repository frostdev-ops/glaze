const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
globalThis.GZ_WRITER_OBJECTS_DOCX = require('../lib/writer-objects-docx.js');

const trip = async (html) => S.paper.nodeFromJSON((await X.importDocx(X.exportDocx(S.parse(S.paper, html)).bytes)).doc);

test('the first item of a restarted list keeps its number through Word', async () => {
  const d = await trip('<ol><li data-start="4">Four</li><li>Five</li></ol><p>Gap</p><ol><li data-start="9">Nine</li></ol>');
  assert.equal(d.child(0).firstChild.attrs.start, 4);
  assert.equal(d.child(2).firstChild.attrs.start, 9);
  assert.equal(d.textContent, 'FourFiveGapNine');
});

test('horizontal rules round-trip in the body, quotes and table cells', async () => {
  const d = await trip('<p>Before</p><hr class="gz-rule"><blockquote><p>Quote</p><hr class="gz-rule"></blockquote><table><tr><td><p>Cell</p><hr class="gz-rule"><p>After</p></td></tr></table>');
  let count = 0;
  d.descendants((n) => { if (n.type.name === 'horizontal_rule') count++; });
  assert.equal(count, 3);
  assert.equal(d.child(1).type.name, 'horizontal_rule');
  assert.equal(d.lastChild.firstChild.firstChild.child(1).type.name, 'horizontal_rule');
  assert.equal(d.textContent, 'BeforeQuoteCellAfter');
});
