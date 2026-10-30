// An assignment's attached PDF, deck or spreadsheet opened in Glaze (lib/writer-context-assignment.js): only a .pdf, .pptx,
// .ppsx, .xlsx, .csv or .tsv attachment whose kind's Settings → Writer switch is on is offered; its bytes come by the same bounded GET Feedback's
// reader uses, with the session, and go to the paper's frame as import:file { open: true } (writer-import.js then opens
// it in Glaze: the paper kept as a version first); a file past the bound, a failed read or a file not the box's says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/writer-context-assignment.js');
const L = require('../lib/writer-submit.js');

const FILES = [
  { url: 'https://bb.school.test/bbcswebdav/pid-1-dt-asiobject-rid-11_1/xid-11_1', name: 'Field trip form.pdf', image: false, id: 'attachment-1' },
  { url: 'https://bb.school.test/bbcswebdav/pid-1-dt-asiobject-rid-12_1/xid-12_1', name: 'Week 3.pptx', image: false, id: 'attachment-2' },
  { url: 'https://bb.school.test/bbcswebdav/pid-1-dt-asiobject-rid-13_1/xid-13_1', name: 'Essay 2 prompt.docx', image: false, id: 'attachment-3' },
  { url: 'https://bb.school.test/bbcswebdav/pid-1-dt-asiobject-rid-14_1/xid-14_1', name: 'explore3.png', image: true, id: 'attachment-4' },
  { url: 'https://bb.school.test/bbcswebdav/pid-1-dt-asiobject-rid-15_1/xid-15_1', name: 'Lab data.csv', image: false, id: 'attachment-5' },
];

test('openable: a PDF, deck or spreadsheet attachment only while its kind\'s switch is on; never a Word file or a picture', () => {
  const names = (w) => C.openable(FILES, w, L).map((f) => f.name);
  assert.deepEqual(names({}), [], 'switches off: nothing added');
  assert.deepEqual(names({ pdf: true }), ['Field trip form.pdf']);
  assert.deepEqual(names({ slides: true }), ['Week 3.pptx']);
  assert.deepEqual(names({ sheets: true }), ['Lab data.csv']);
  assert.deepEqual(names({ pdf: true, slides: true, sheets: true }), ['Field trip form.pdf', 'Week 3.pptx', 'Lab data.csv']);
  for (const name of ['Budget.xlsx', 'Scores.tsv']) assert.deepEqual(C.openable([{ ...FILES[4], name }], { sheets: true }, L).map((f) => f.name), [name]);
  assert.deepEqual(C.openable(null, { pdf: true }, L), []);
  assert.deepEqual(C.openable([{ ...FILES[0], image: true }], { pdf: true }, L), [], 'a file read as a picture is not opened as a PDF');
});

const page = (bodies, { max } = {}) => {
  const fetched = [], port = { sent: [], postMessage(m, transfer) { this.sent.push({ m, transfer }); } };
  globalThis.GZ_LMSQ = { run: (task) => task() };
  globalThis.fetch = async (url, init) => { fetched.push([url, init]); const b = bodies[url]; return b ? new Response(b, { status: 200, headers: max ? { 'content-length': String(max) } : {} }) : new Response(null, { status: 404 }); };
  const X = { need: async () => {}, on: () => true, settings: () => ({ writer: { pdf: true, slides: true } }) };
  const box = { kind: 'assignment', mode: 'paper', context: { kind: 'assignment' }, files: FILES, port };
  return { X, box, port, fetched };
};

test('open: the attachment\'s bytes by the bounded GET with the session, to the frame as import:file { open }', async () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
  const p = page({ [FILES[0].url]: pdf });
  assert.equal(await C.open(p.X, p.box, 'attachment-1', L), true);
  assert.deepEqual(p.fetched.map(([u, i]) => [u, i.credentials]), [[FILES[0].url, 'same-origin']]);
  assert.equal(p.port.sent.length, 1);
  const { m, transfer } = p.port.sent[0];
  assert.deepEqual({ type: m.type, name: m.name, mime: m.mime, open: m.open }, { type: 'import:file', name: 'Field trip form.pdf', mime: 'application/pdf', open: true });
  assert.deepEqual([...new Uint8Array(m.bytes)], [...pdf]);
  assert.deepEqual(transfer, [m.bytes], 'the bytes are moved, not copied');
});

test('open refuses what isn\'t the box\'s or is switched off, and says when the file can\'t be read', async () => {
  const p = page({});
  assert.equal(await C.open(p.X, p.box, 'attachment-3', L), false, 'a Word attachment');
  assert.equal(await C.open(p.X, p.box, 'attachment-9', L), false, 'not this box\'s');
  assert.equal(await C.open({ ...p.X, settings: () => ({ writer: {} }) }, p.box, 'attachment-1', L), false, 'PDFs off');
  assert.equal(p.fetched.length, 0, 'nothing fetched for any of them');
  assert.equal(await C.open(p.X, { ...p.box, kind: 'test' }, 'attachment-1', L), false, 'a test is never read');
  assert.equal(await C.open(p.X, p.box, 'attachment-1', L), false, 'a 404');
  assert.deepEqual(p.port.sent.map(({ m }) => m.type), ['import:failed']);
  const big = page({ [FILES[1].url]: new Uint8Array(8) }, { max: C.ATTACH.file + 1 });
  assert.equal(await C.open(big.X, big.box, 'attachment-2', L), false, 'past the bound by its length');
  assert.deepEqual(big.port.sent.map(({ m }) => [m.type, m.name]), [['import:failed', 'Week 3.pptx']]);
});

test('a slideshow attachment reaches the opener through the real attachment-link parser', () => {
  const item = require('./fixtures/ultra-writer-attach-content.json');
  const html = item.contentDetail['resource/x-bb-asmt-test-link'].test.assessment.instructions.rawText
    .replaceAll('Essay 2 prompt.docx', 'Week 3.ppsx').replaceAll('wordprocessingml.document', 'presentationml.slideshow');
  const files = C.attached([html], 'https://bb.school.example.edu');
  assert.deepEqual(C.openable(files, { slides: true }, L).map((f) => f.name), ['Week 3.ppsx']);
});

test('turning a kind off during its GET prevents delivery to the frame', async () => {
  const p = page({ [FILES[0].url]: new Uint8Array([37, 80, 68, 70, 45]) });
  let enabled = true;
  p.X.settings = () => ({ writer: { pdf: enabled } });
  const fetch0 = globalThis.fetch;
  globalThis.fetch = async (...args) => { const r = await fetch0(...args); enabled = false; return r; };
  assert.equal(await C.open(p.X, p.box, 'attachment-1', L), false);
  assert.deepEqual(p.port.sent, []);
});

test('attachment redirects may use Blackboard\'s observed file store, never an unrelated response origin', async () => {
  for (const [url, allowed] of [
    ['https://files.prod.files.blackboard.com/signed/form.pdf', true],
    ['https://elsewhere.test/form.pdf', false],
    ['https://files.prod.files.blackboard.com.elsewhere.test/form.pdf', false],
    ['http://files.prod.files.blackboard.com/form.pdf', false],
  ]) {
    const p = page({});
    globalThis.fetch = async () => { const r = new Response(new Uint8Array([37, 80, 68, 70, 45])); Object.defineProperty(r, 'url', { value: url }); return r; };
    assert.equal(await C.open(p.X, p.box, 'attachment-1', L), allowed, url);
    assert.equal(p.port.sent[0]?.m.type, allowed ? 'import:file' : 'import:failed');
  }
});

test('every matching link keeps a stable opener, and changed hrefs lose theirs', () => {
  const p = page({});
  const links = [FILES[0].url, FILES[0].url, 'https://other.test/bbcswebdav/not-listed'].map((href) => ({ href, isConnected: true,
    after(b) { b.previousElementSibling = this; b.isConnected = true; this.button = b; } }));
  let created = 0;
  const doc = { querySelectorAll: () => links, createElement: () => { created++; return { dataset: {}, style: { setProperty() {} }, addEventListener() {},
    remove() { this.isConnected = false; if (this.previousElementSibling?.button === this) this.previousElementSibling.button = null; } }; } };
  p.X.t = (s) => s;
  C.decorate(p.X, p.box, L, doc);
  assert.ok(links[0].button?.isConnected && links[1].button?.isConnected, 'both links get the action');
  assert.equal(links[2].button, undefined, 'a page-injected address gets none');
  C.decorate(p.X, p.box, L, doc);
  assert.equal(created, 2, 'a second pass changes no DOM');
  links[0].href = links[2].href;
  C.decorate(p.X, p.box, L, doc);
  assert.equal(links[0].button, null, 'a changed href loses its action');
  p.X.settings = () => ({ writer: {} });
  C.decorate(p.X, p.box, L, doc);
  assert.equal(p.box.openers.size, 0);
  assert.equal(links[1].button, null);
});

test('a spreadsheet attachment reaches the opener through the real attachment-link parser; Feedback never fetches it', async () => {
  const item = require('./fixtures/ultra-writer-attach-content.json');
  const html = item.contentDetail['resource/x-bb-asmt-test-link'].test.assessment.instructions.rawText
    .replaceAll('Essay 2 prompt.docx', 'Lab data.xlsx').replaceAll('wordprocessingml.document', 'spreadsheetml.sheet');
  const files = C.attached([html], 'https://bb.school.example.edu');
  assert.deepEqual(C.openable(files, { sheets: true }, L).map((f) => f.name), ['Lab data.xlsx']);
  assert.equal(files.incomplete, undefined, 'a spreadsheet is a file the box knows');
  const got = [];
  const read = await C.read(files, { get: async (url) => { got.push(url); return new Uint8Array([0x89, 0x50, 0x4e, 0x47]); }, text: async () => '', D: require('../lib/doctext.js'), images: false });
  assert.ok(!got.some((u) => files.find((f) => f.name === 'Lab data.xlsx').url === u), 'the spreadsheet is never fetched for Feedback');
  assert.equal(read.incomplete, true, 'Feedback hears a file went unread');
});

test('open: an attached spreadsheet goes to the frame as import:file { open } while Spreadsheets is on', async () => {
  const csv = new TextEncoder().encode('Time,Temp\n1,20.5\n');
  const p = page({ [FILES[4].url]: csv });
  assert.equal(await C.open(p.X, p.box, 'attachment-5', L), false, 'Spreadsheets off: refused');
  assert.equal(p.fetched.length, 0);
  p.X.settings = () => ({ writer: { sheets: true } });
  assert.equal(await C.open(p.X, p.box, 'attachment-5', L), true);
  const { m } = p.port.sent[0];
  assert.deepEqual({ type: m.type, name: m.name, mime: m.mime, open: m.open }, { type: 'import:file', name: 'Lab data.csv', mime: 'text/csv', open: true });
  assert.deepEqual([...new Uint8Array(m.bytes)], [...csv]);
});
