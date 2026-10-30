// An assignment's paper in its compact box (writer-paper.js): the projection it writes into Ultra's box (project(): what
// Ultra's Quill can hold, as Quill ops lib/writer-main.js takes), and the page around it (features/writer-submit.js): its
// Submit and Save and Close stay Ultra's, and Ultra's file area hands Writer a Word file only. The switch, the box and
// the sync are scripts/writer-submit-check.js's compact section in a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const S = globalThis.GZ_WRITER_SCHEMA = require('../lib/writer-schema.js');
const P = require('../writer-paper.js');
const L = require('../lib/writer-submit.js');
const FX = require('./fixtures/writer-paper-fixtures.js');
const page = require('./helpers/writer-submit-page.cjs');

const N = S.paper, t = (text, marks = []) => N.text(text, marks);
const paper = () => N.node('doc', null, [
  N.node('paragraph', null, [t('Alex Rivera')]),
  N.node('paragraph', { align: 'center' }, [t('Memory in Beloved')]),
  N.node('heading', { level: 1 }, [t('Rememory')]),
  N.node('paragraph', { indent: 1 }, [t('A '), t('debt', [N.marks.bold.create()]), t(' paid'), N.node('footnote_ref', { content: 'Morrison 35.' }), t('.')]),
  N.node('blockquote', null, [N.node('paragraph', null, [t('Some things you forget.')])]),
  N.node('page_break'),
  N.node('bullet_list', null, [N.node('list_item', null, [t('one')]), N.node('list_item', null, [t('two')])]),
  N.node('paragraph', null, [t('Large', [N.marks.text_style.create({ font: 'Arial', size: 14 })]), t(' and red', [N.marks.color.create({ color: 'C00000' })])]),
  N.node('paragraph', null, [N.node('image', { src: `data:image/png;base64,${'A'.repeat(3e6)}`, alt: 'A map' })]),
]);

test('project: the paper as Ultra\'s Quill holds it, headings as its own, a quote indented; notes, breaks, pictures, fonts and colours stay out', () => {
  const p = P.project(paper());
  assert.equal(p.html, '<p>Alex Rivera</p><p class="ql-align-center">Memory in Beloved</p><h3>Rememory</h3><p class="ql-indent-1">A <strong>debt</strong> paid.</p><p class="ql-indent-1">Some things you forget.</p><ul><li>one</li><li>two</li></ul><p>Large and red</p><p><br></p>');
  assert.equal(p.text, 'Alex Rivera\nMemory in Beloved\nRememory\nA debt paid.\nSome things you forget.\none\ntwo\nLarge and red\n');
  assert.deepEqual(p.delta.slice(0, 4), [{ insert: 'Alex Rivera\nMemory in Beloved' }, { insert: '\n', attributes: { align: 'center' } }, { insert: 'Rememory' }, { insert: '\n', attributes: { header: 3 } }]);
  assert.ok(!/Morrison|data:/.test(JSON.stringify(p)), 'a note\'s text and a picture\'s bytes never reach Ultra\'s box');
  assert.deepEqual(P.project(N.node('doc', null, [N.node('paragraph')])), { html: '<p><br></p>', text: '', delta: [{ insert: '\n' }] });
});

test('project: past compose\'s input limit (50k tags or 2 MB) nothing is projected, so the compact bar says so and offers Full writer', () => {
  // Every other run bold: 22 tags a paragraph.
  const runs = (i) => Array.from({ length: 20 }, (_, j) => t(j % 2 ? ` bold ${j} ` : `plain ${i}.${j}`, j % 2 ? [N.marks.bold.create()] : []));
  const doc = (n) => N.node('doc', null, Array.from({ length: n }, (_, i) => N.node('paragraph', null, runs(i))));
  assert.ok(P.project(doc(2000)), '44k tags fit');
  assert.equal(P.project(doc(2600)), null, '57k tags don\'t');
  assert.equal(P.project(N.node('doc', null, [N.node('paragraph', null, [t('x'.repeat(S.MAX_INPUT + 1))])])), null, 'nor over 2 MB of text');
});

// lib/writer-main.js in the page's world, over a stand-in Quill: what it answers for the projection's ops.
const main = (delta) => {
  const listeners = {}, said = [];
  const root = { innerHTML: '', isConnected: true };
  const quill = { root, setContents(d) { quill.set = d; }, getText: () => '' };
  const box = { __quill: quill, querySelector: () => root };
  const doc = { documentElement: { hasAttribute: () => false, setAttribute() {} }, querySelector: () => box,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, dispatchEvent: (e) => { for (const fn of listeners[e.type] || []) fn(e); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/writer-main.js'), 'utf8'), { document: doc, JSON, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o.detail; } } });
  doc.addEventListener('gz-writer:done', (e) => said.push(JSON.parse(e.detail)));
  doc.dispatchEvent({ type: 'gz-writer:set', detail: JSON.stringify({ id: 'gzw-1', delta }) });
  return { ok: said[0]?.ok === true, set: quill.set };
};

test('project: Ultra\'s page-world helper takes its ops as they are, for a whole paper in each format', () => {
  for (const json of [FX.papers.mla9(), FX.papers.apa7(), FX.papers.chicago17(), paper().toJSON()]) {
    const p = P.project(N.nodeFromJSON(json)), r = main(p.delta);
    assert.equal(r.ok, true);
    assert.deepEqual(r.set, p.delta);
  }
  assert.equal(main(S.delta(paper())).ok, false, 'the paper\'s own ops (Heading 1) would be refused');
});

test('compact: Ultra\'s Submit and Save and Close stay Ultra\'s; the full view\'s open the sheet', () => {
  for (const full of [false, true]) {
    const p = page({ full });
    const submit = p.fire(p.button(), 'click'), save = p.fire(L.footer(p.box.editor).save, 'click');
    assert.equal(!!submit.stopped, full, `${full ? 'full' : 'compact'}: Submit`);
    assert.equal(!!save.stopped, full, `${full ? 'full' : 'compact'}: Save and Close`);
    assert.deepEqual(p.sent.map((m) => m.type), full ? ['submit:open', 'submit:save'] : []);
  }
});

test('compact: Ultra\'s file area hands Writer a Word file (Open in Writer or Submit as is) and keeps any other file', async () => {
  const p = page({ full: false, settings: { enhance: { writerUploads: true } } });
  const zone = L.dropZone(L.areaOf(p.box.editor)), drop = (f) => p.fire(zone.querySelector('p'), 'drop', { dataTransfer: { files: [f] } });
  const other = drop(new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'Rivera_Essay2.pdf', { type: 'application/pdf' }));
  assert.equal(!!other.stopped, false, 'a PDF goes to Ultra, to send with the text');
  const word = drop(new File([new Uint8Array([0x50, 0x4b, 3, 4])], 'Rivera_Essay2.docx', { type: L.MIME }));
  assert.equal(word.stopped, true);
  await p.flush();
  assert.deepEqual(p.sent.filter((m) => m.type === 'import:file').map((m) => m.name), ['Rivera_Essay2.docx']);
});
