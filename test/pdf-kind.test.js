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

// pdf-kind.js in a context of its own: the registry, a storage.sync answering writer.pdf, and need() loading defaults.js
// (papers.html) or, with defaults: false, finding GZ_SANITIZE already there (writer.html).
const G = require('../defaults.js');
const load = (writer, { defaults = true } = {}) => {
  delete require.cache[require.resolve('../lib/doc-kinds.js')];
  delete globalThis.GZ_DOC_KINDS;
  const DK = require('../lib/doc-kinds.js');
  const needed = [];
  const ctx = vm.createContext({ GZ_DOC_KINDS: DK, console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, RangeError, Error, Promise, Object, Array, String, Number, Math, JSON, Map, Set, btoa, atob,
    chrome: { storage: { sync: { get: async () => (writer === undefined ? {} : { writer }) } }, runtime: { getURL: (f) => `chrome-extension://x/${f}` } } });
  // need() runs each file in turn, as the page does; defaults.js reads GZ_COLOR, GZ_SURFACES and GZ_FONTS as it loads.
  const ran = new Set();
  ctx.GZ_WRITER_PAPER = { need: async (files) => { for (const f of files) {
    needed.push(f);
    if (f === 'defaults.js') { assert.ok(['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js'].every((x) => ran.has(x)), `defaults.js after what it reads (${needed})`); ctx.GZ_SANITIZE = G.GZ_SANITIZE; }
    ran.add(f);
  } } };
  if (!defaults) ctx.GZ_SANITIZE = G.GZ_SANITIZE;
  ctx.globalThis = ctx;
  vm.runInContext(read('pdf-kind.js'), ctx);
  return { DK, ctx, needed };
};
const imports = async (writer, o) => {
  const { DK, needed } = load(writer, o);
  await DK.settled();
  const k = DK.get('pdf');
  for (const f of ['edit', 'thumb', 'exportFile', 'measure', 'file', 'text']) assert.equal(typeof k[f], 'function', `${f} with ${JSON.stringify(writer)}`);
  const yes = typeof k.importFile === 'function';
  assert.equal(DK.opens('Worksheet.pdf'), yes ? 'pdf' : null, JSON.stringify(writer));
  assert.equal(DK.accept().includes('pdf'), yes, JSON.stringify(writer));
  return { yes, needed };
};

test('off, Documents imports Word files only, and a PDF it already keeps still opens', async () => {
  assert.equal((await imports({ pdf: false })).yes, false);
});

test('the switch reads as Settings shows it: no stored key, or a bad value, is the default', async () => {
  for (const writer of [undefined, { pdf: 'yes' }, { full: true }]) assert.equal((await imports(writer)).yes, G.GZ_DEFAULTS.writer.pdf, JSON.stringify(writer));
  // papers.html loads defaults.js for it, after the scripts defaults.js reads; writer.html already has it, and a second
  // copy would redeclare its constants.
  assert.deepEqual((await imports(undefined)).needed, ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js']);
  assert.deepEqual((await imports(undefined, { defaults: false })).needed, []);
  assert.equal((await imports({ pdf: true }, { defaults: false })).yes, true);
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

test('stored PDFs are bounded before decoding, including dishonest size fields', () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  let decoded = 0;
  ctx.atob = () => { decoded++; return ''; };
  assert.ok(S.get({ file: 'A'.repeat(4 * Math.ceil(S.max / 3) + 4), size: 1 }) === null, 'oversized encoded bytes are refused');
  assert.equal(decoded, 0, 'reject the encoded allocation before decoding');
  assert.equal(S.get({ file: 'AAAA', size: S.max + 1 }), null);
  assert.equal(decoded, 0, 'reject an oversized declared file before decoding');
});

test('malformed stored PDFs return no bytes instead of aborting the viewer', () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  assert.equal(S.get({ file: 'not base64!' }), null);
  assert.equal(S.get({ file: 'YQ==', size: 2 }), null, 'declared and decoded sizes agree');
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
