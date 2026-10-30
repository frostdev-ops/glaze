// An assignment's attached PDF or deck opened in Glaze (lib/writer-context-assignment.js): only a .pdf, .pptx or .ppsx
// attachment whose kind's Settings → Writer switch is on is offered; its bytes come by the same bounded GET Feedback's
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
];

test('openable: a PDF or deck attachment only while its kind\'s switch is on; never a Word file or a picture', () => {
  const names = (w) => C.openable(FILES, w, L).map((f) => f.name);
  assert.deepEqual(names({}), [], 'switches off: nothing added');
  assert.deepEqual(names({ pdf: true }), ['Field trip form.pdf']);
  assert.deepEqual(names({ slides: true }), ['Week 3.pptx']);
  assert.deepEqual(names({ pdf: true, slides: true, sheets: true }), ['Field trip form.pdf', 'Week 3.pptx']);
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
