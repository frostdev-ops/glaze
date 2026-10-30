// The PDF kind on the Documents page (pdf-kind.js, papers.html): loaded after papers.js and packaged, importing only with
// Settings → Writer → PDFs on (writer.pdf) while a PDF already kept opens either way, its one storage seam (the bytes in the worker's file store,
// lib/doc-files.js, a record from before it holding them as base64), and which files it refuses. The viewer itself is scripts/pdf-check.js.
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
const F = require('../lib/doc-files.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');
// The worker's end: its file store over a fake IndexedDB, reached through ports that carry JSON as Chrome's do.
const worker = (o = {}) => {
  const { indexedDB, IDBKeyRange } = fakeIDB();
  const st = F.store(o.idb || F.idb(indexedDB, 'glaze-docs', IDBKeyRange));
  const connect = () => {
    const end = () => ({ on: [], off: [], dead: false, onMessage: { addListener: null }, onDisconnect: { addListener: null } });
    const a = end(), b = end();
    for (const [x, y] of [[a, b], [b, a]]) {
      x.onMessage.addListener = (f) => x.on.push(f); x.onDisconnect.addListener = (f) => x.off.push(f);
      x.postMessage = (m) => { const j = JSON.stringify(m); setImmediate(() => { if (!y.dead) for (const f of y.on) f(JSON.parse(j)); }); };
      x.disconnect = () => { x.dead = true; setImmediate(() => { if (!y.dead) { y.dead = true; for (const f of y.off) f(); } }); };
    }
    F.serve(b, st);
    return a;
  };
  return { st, connect };
};
const load = (writer, { defaults = true, files = worker() } = {}) => {
  delete require.cache[require.resolve('../lib/doc-kinds.js')];
  delete globalThis.GZ_DOC_KINDS;
  const DK = require('../lib/doc-kinds.js');
  const needed = [];
  const ctx = vm.createContext({ GZ_DOC_KINDS: DK, console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, RangeError, Error, Promise, Object, Array, String, Number, Math, JSON, Map, Set, btoa, atob,
    chrome: { storage: { sync: { get: async () => (writer === undefined ? {} : { writer }) } }, runtime: { getURL: (f) => `chrome-extension://x/${f}`, connect: files.connect } } });
  // need() runs each file in turn, as the page does; defaults.js reads GZ_COLOR, GZ_SURFACES and GZ_FONTS as it loads.
  const ran = new Set();
  ctx.GZ_WRITER_PAPER = { need: async (files) => { for (const f of files) {
    needed.push(f);
    if (f === 'defaults.js') { assert.ok(['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js'].every((x) => ran.has(x)), `defaults.js after what it reads (${needed})`); ctx.GZ_SANITIZE = G.GZ_SANITIZE; }
    if (f === 'lib/doc-files.js' && !ran.has(f)) vm.runInContext(read(f), ctx);
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

test('the storage seam: bytes in, kept in the worker\'s store, the same bytes out, up to the kind\'s 50 MB', async () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  const bytes = new Uint8Array(5e6).map((_, i) => (i * 7919) % 256);
  const fields = await S.put(bytes);
  assert.ok(F.ref(fields.file), 'the record points at the file');
  assert.equal(fields.file.type, 'application/pdf');
  assert.equal(fields.size, bytes.length);
  assert.ok(JSON.stringify(fields).length < 300, 'no bytes in the record');
  assert.deepEqual(Buffer.from(await S.get(fields)), Buffer.from(bytes));
  assert.equal(S.max, 50e6);
  await assert.rejects(S.put(new Uint8Array(S.max + 1)), (e) => e instanceof RangeError && e.message === 'Choose a PDF smaller than 50 MB.');
  assert.equal(await S.get({}), null, 'a record without a file');
});

test('a record from before the store (base64) still reads; a file the store lost says so', async () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
  assert.deepEqual([...await S.get({ file: Buffer.from(bytes).toString('base64'), size: 6 })], [...bytes]);
  await assert.rejects(S.get({ file: { hash: 'a'.repeat(64), size: 10, type: 'application/pdf' } }), (e) => e instanceof RangeError && e.why === 'missing' && e.message === 'This file is missing.');
});

test('the store unavailable: a PDF up to 3 MB is kept in its record as before; a larger one says why', async () => {
  const broken = worker({ idb: F.idb({ open: () => { throw new Error('private window'); } }, 'glaze-docs', fakeIDB().IDBKeyRange) });
  const { ctx } = load({ pdf: true }, { files: broken });
  const S = ctx.GZ_PDF_KIND.STORE;
  const small = new Uint8Array(2e6).fill(1);
  const fields = await S.put(small);
  assert.equal(typeof fields.file, 'string');
  assert.equal((await S.get(fields)).length, small.length);
  await assert.rejects(S.put(new Uint8Array(3e6 + 1).fill(2)), (e) => e.why === 'unavailable' && e.message === "This browser can't keep files larger than 3 MB right now.");
});

test('quota exceeded: the put says there isn\'t room', async () => {
  const { indexedDB, IDBKeyRange } = fakeIDB(), db = F.idb(indexedDB, 'glaze-docs', IDBKeyRange);
  const full = worker({ idb: { ...db, write: async (puts, dels) => { if (puts.some(([k]) => k.startsWith('c:'))) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); return db.write(puts, dels); } } });
  const { ctx, DK } = load({ pdf: true }, { files: full });
  await DK.settled();
  await assert.rejects(ctx.GZ_PDF_KIND.STORE.put(new Uint8Array(1000)), (e) => e.why === 'quota' && e.message === "There isn't enough room in this browser for this file.");
  assert.ok(Object.values(DK.get('pdf').says).includes(DK.SAYS.quota), 'Documents says the store\'s reason as it is (papers.js says)');
});

test('stored PDFs are bounded before decoding, including dishonest size fields', async () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  let decoded = 0;
  ctx.atob = () => { decoded++; return ''; };
  assert.ok(await S.get({ file: 'A'.repeat(4 * Math.ceil(3e6 / 3) + 4), size: 1 }) === null, 'oversized encoded bytes are refused');
  assert.equal(decoded, 0, 'reject the encoded allocation before decoding');
  assert.equal(await S.get({ file: 'AAAA', size: 3e6 + 1 }), null);
  assert.equal(decoded, 0, 'reject an oversized declared file before decoding');
});

test('malformed stored PDFs return no bytes instead of aborting the viewer', async () => {
  const { ctx } = load({ pdf: true });
  const S = ctx.GZ_PDF_KIND.STORE;
  assert.equal(await S.get({ file: 'not base64!' }), null);
  assert.equal(await S.get({ file: 'YQ==', size: 2 }), null, 'declared and decoded sizes agree');
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
