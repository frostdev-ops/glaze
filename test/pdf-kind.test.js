// The PDF kind on the Documents page (pdf-kind.js, papers.html): loaded after papers.js and packaged, importing only with
// Settings → Writer → PDFs on (writer.pdf) while a PDF already kept opens either way, its one storage seam (the bytes as a base64 `file` field in the paper record
// until the worker's blob store takes them), and which files it refuses. The viewer itself is scripts/pdf-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('papers.html loads the kind registry first and pdf-kind.js after papers.js; both package lists ship it', () => {
  const html = read('papers.html');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  assert.ok(at('lib/doc-kinds.js') > 0 && at('lib/doc-kinds.js') < at('papers.js'), 'the registry before papers.js');
  assert.ok(at('pdf-kind.js') > at('papers.js'), 'pdf-kind.js after papers.js');
  assert.ok(at('lib/pdf-doc.js') > 0 && at('lib/pdf-doc.js') < at('pdf-kind.js'), 'lib/pdf-doc.js (open, save, thumbnail) before pdf-kind.js');
  const pkg = read('package.sh').split('\n').filter((l) => / papers\.js /.test(l));
  assert.equal(pkg.length, 2, 'chmod and zip');
  for (const line of pkg) for (const f of ['pdf-kind.js', 'pdf-kind.css']) assert.ok(line.includes(` ${f} `), `${f} in: ${line.slice(0, 40)}…`);
});

// pdf-kind.js in a context of its own: the registry, a storage.sync answering writer.pdf, and need() as a no-op (the
// registry is already in).
const load = (writer) => {
  delete require.cache[require.resolve('../lib/doc-kinds.js')];
  delete globalThis.GZ_DOC_KINDS;
  const DK = require('../lib/doc-kinds.js');
  const ctx = vm.createContext({ GZ_DOC_KINDS: DK, GZ_WRITER_PAPER: { need: async () => {} }, console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, RangeError, Error, Promise, Object, Array, String, Number, Math, JSON, Map, Set, btoa, atob,
    chrome: { storage: { sync: { get: async () => (writer === undefined ? {} : { writer }) } }, runtime: { getURL: (f) => `chrome-extension://x/${f}` } } });
  ctx.globalThis = ctx;
  vm.runInContext(read('pdf-kind.js'), ctx);
  return { DK, ctx };
};

test('off (the default), Documents imports Word files only, and a PDF it already keeps still opens', async () => {
  for (const writer of [undefined, { pdf: false }, { pdf: 'yes' }, { full: true }]) {
    const { DK } = load(writer);
    await DK.settled();
    const k = DK.get('pdf');
    assert.equal(k.importFile, undefined, JSON.stringify(writer));
    assert.equal(DK.opens('Worksheet.pdf'), null);
    assert.ok(!DK.accept().includes('pdf'));
    for (const f of ['edit', 'thumb', 'exportFile', 'measure', 'file', 'text']) assert.equal(typeof k[f], 'function', `${f} with ${JSON.stringify(writer)}`);
  }
});

test('on, the PDF kind also imports', async () => {
  const { DK } = load({ pdf: true });
  await DK.settled();
  const k = DK.get('pdf');
  for (const f of ['edit', 'thumb', 'exportFile', 'importFile', 'measure', 'file', 'text']) assert.equal(typeof k[f], 'function', f);
  assert.equal(DK.opens('Worksheet.pdf'), 'pdf');
  assert.equal(k.label, 'PDF');
});

test('the storage seam: bytes in, the same bytes out, nothing past the record cap', async () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7919) % 256);
  const fields = S.put(bytes);
  assert.equal(typeof fields.file, 'string');
  assert.equal(fields.size, bytes.length);
  assert.deepEqual([...S.get(fields)], [...bytes]);
  assert.ok(fields.file.length <= 4e6);
  // The paper record's 4 MB: base64 of at most 3 MB of PDF (the blob store lifts this to the kind's 50 MB).
  assert.equal(S.max, 3e6);
  assert.throws(() => S.put(new Uint8Array(S.max + 1)), RangeError);
  assert.equal(S.get({}), null, 'a record without a file');
});

test('pure XFA is refused; a hybrid form (XFA with AcroForm fields) opens', async () => {
  const { ctx } = load({ pdf: true });
  const { pureXfa } = ctx.GZ_PDF_KIND;
  assert.equal(pureXfa({ IsXFAPresent: true }, null), true);
  assert.equal(pureXfa({ IsXFAPresent: true }, {}), true);
  assert.equal(pureXfa({ IsXFAPresent: true }, { name: [{}] }), false);
  assert.equal(pureXfa({ IsXFAPresent: false }, null), false);
  assert.equal(pureXfa({}, null), false);
});
