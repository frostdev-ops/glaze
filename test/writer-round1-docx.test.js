const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const E = require('../lib/writer-editor.js');
globalThis.GZ_WRITER_OBJECTS_DOCX = require('../lib/writer-objects-docx.js');

const trip = async (html) => S.paper.nodeFromJSON((await X.importDocx(X.exportDocx(S.parse(S.paper, html)).bytes)).doc);

test('the first item of a restarted list keeps its number through Word', async () => {
  const d = await trip('<ol><li data-start="4">Four</li><li>Five</li></ol><p>Gap</p><ol><li data-start="9">Nine</li></ol>');
  assert.equal(d.child(0).firstChild.attrs.start, 4);
  assert.equal(d.child(2).firstChild.attrs.start, 9);
  assert.equal(d.textContent, 'FourFiveGapNine');
});

const distinctLists = () => S.paper.node('doc', null, ['upper-roman', 'upper-alpha'].map((styles) => S.paper.node('ordered_list', { styles }, [S.paper.node('list_item', null, S.paper.text(styles))])));
test('adjacent paper lists retain different styles through HTML', () => {
  const d = S.parse(S.paper, S.serialize(S.paper, distinctLists()));
  assert.deepEqual(d.content.content.map((n) => n.attrs.styles), ['upper-roman', 'upper-alpha']);
});
test('editing a paper never joins lists with different styles', () => {
  let st = E.state({ mode: 'paper' });
  st = st.apply(st.tr.replaceWith(0, st.doc.content.size, distinctLists().content));
  st = st.apply(st.tr.insertText('!'));
  assert.deepEqual(st.doc.content.content.map((n) => n.attrs.styles), ['upper-roman', 'upper-alpha']);
});
test('adjacent list definitions retain their styles through Word', async () => {
  const d = S.paper.nodeFromJSON((await X.importDocx(X.exportDocx(distinctLists()).bytes)).doc);
  assert.deepEqual(d.content.content.map((n) => n.attrs.styles), ['upper-roman', 'upper-alpha']);
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

test('picture captions export at the effective paper size for imports and presets', () => {
  const ST = require('../lib/writer-styles.js');
  const image = S.paper.node('image', { src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', display: 'block', caption: 'Caption' });
  for (const [format, setup] of [
    ['mla9', ST.pageSetup(ST.FORMATS.mla9, { size: 16 })],
    [ST.custom({ id: 'custom:large', label: 'Large', base: 'apa7', size: 16 }), null],
  ]) {
    const d = S.paper.node('doc', { setup }, [S.paper.node('paragraph', null, image)]);
    const styles = X.exportDocx(d, { format }).parts['word/styles.xml'];
    assert.match(styles, /w:styleId="Caption">[\s\S]*?<w:sz w:val="28"/);
  }
});

test('imported headings keep inherited and mixed run emphasis instead of taking the format emphasis', async () => {
  const Z = require('../lib/zip.js');
  const parts = X.exportDocx(S.parse(S.paper, '<h1>Plain <strong>bold</strong></h1>')).parts;
  parts['word/styles.xml'] = parts['word/styles.xml'].replace(/(<w:style w:type="paragraph" w:styleId="Heading1">[\s\S]*?<w:rPr>)[\s\S]*?(<\/w:rPr>)/, '$1<w:b w:val="0"/><w:i/>$2');
  const file = Buffer.concat(Z.zip(Object.entries(parts).map(([name, text]) => ({ name, data: new TextEncoder().encode(text) }))));
  const d = S.paper.nodeFromJSON((await X.importDocx(file)).doc), heading = d.firstChild;
  assert.equal(heading.firstChild.marks.some((m) => m.type.name === 'italic'), true);
  assert.equal(heading.firstChild.marks.some((m) => m.type.name === 'bold'), false);
  assert.equal(heading.lastChild.marks.some((m) => m.type.name === 'bold'), true);
  assert.equal(heading.attrs.weight, 'normal');
  assert.equal(heading.attrs.slant, 'normal');
  const back = S.parse(S.paper, S.serialize(S.paper, d));
  assert.ok(back.type.create(d.attrs, back.content).eq(d), 'HTML keeps the heading overrides');
  const xml = X.exportDocx(d).parts['word/document.xml'];
  assert.match(xml, /<w:b w:val="0"\/><w:bCs w:val="0"\/><w:i\/><w:iCs\/>/);
});
