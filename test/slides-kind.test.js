// Slides on the Documents page (slides-kind.js, papers.html): loaded after papers.js and packaged, available for viewing with
// Settings → Writer → Slides off; importing needs writer.slides on, its one storage seam (the deck's bytes in the worker's file store,
// lib/doc-files.js, a record from before it holding them as base64), what it keeps for search and a copy, and the files it refuses. The
// viewer itself is scripts/slides-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('papers.html loads the kind registry first and slides-kind.js after papers.js; both package lists ship it', () => {
  const html = read('papers.html');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  assert.ok(at('lib/doc-kinds.js') > 0 && at('lib/doc-kinds.js') < at('papers.js'), 'the registry before papers.js');
  assert.ok(at('slides-kind.js') > at('papers.js'), 'slides-kind.js after papers.js');
  assert.ok(html.includes('<link rel="stylesheet" href="slides-kind.css">'));
  assert.match(html, /img-src 'self' data: blob:;/, 'pictures from blob: URLs');
  const pkg = read('package.sh').split('\n').filter((l) => / papers\.js /.test(l));
  assert.equal(pkg.length, 2, 'chmod and zip');
  for (const line of pkg) for (const f of ['slides-kind.js', 'slides-kind.css']) assert.ok(line.includes(` ${f} `), `${f} in: ${line.slice(0, 40)}…`);
});

// defaults.js's GZ_SANITIZE with writer.slides defaulting to `on`, as a page has it.
const sanitizer = (on) => {
  const src = read('defaults.js'), flipped = src.replace(/slides: \[(?:true|false), 'bool'\]/, `slides: [${on}, 'bool']`);
  assert.notEqual(flipped, on ? src.replace(/slides: \[true/, 'x') : src.replace(/slides: \[false/, 'x'), 'writer.slides in defaults.js');
  const c = vm.createContext({ require: require('node:module').createRequire(path.join(__dirname, '..', 'defaults.js')), TextEncoder, Intl });
  vm.runInContext(`${flipped}\nthis.GZ_SANITIZE = GZ_SANITIZE;`, c);
  return c.GZ_SANITIZE;
};
const { GZ_SANITIZE, GZ_DEFAULTS } = require('../defaults.js');
const F = require('../lib/doc-files.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');
// The worker's file store over a fake IndexedDB, reached through ports that carry JSON as Chrome's do.
const worker = (idb) => {
  const { indexedDB, IDBKeyRange } = fakeIDB(), st = F.store(idb || F.idb(indexedDB, 'glaze-docs', IDBKeyRange));
  return () => {
    const end = () => ({ on: [], off: [], dead: false, onMessage: {}, onDisconnect: {} });
    const a = end(), b = end();
    for (const [x, y] of [[a, b], [b, a]]) {
      x.onMessage.addListener = (f) => x.on.push(f); x.onDisconnect.addListener = (f) => x.off.push(f);
      x.postMessage = (m) => { const j = JSON.stringify(m); setImmediate(() => { if (!y.dead) for (const f of y.on) f(JSON.parse(j)); }); };
      x.disconnect = () => { x.dead = true; setImmediate(() => { if (!y.dead) { y.dead = true; for (const f of y.off) f(); } }); };
    }
    F.serve(b, st);
    return a;
  };
};
// slides-kind.js in a context of its own: the registry, defaults.js's sanitizer, a storage.sync answering writer.slides, and
// need() as a no-op.
const load = (writer, overrides = {}) => {
  delete require.cache[require.resolve('../lib/doc-kinds.js')];
  delete globalThis.GZ_DOC_KINDS;
  const DK = require('../lib/doc-kinds.js');
  let ctx;
  const need = async (files) => { if (files.includes('lib/doc-files.js') && !ctx.GZ_DOC_FILES) vm.runInContext(read('lib/doc-files.js'), ctx); };
  ctx = vm.createContext({ GZ_DOC_KINDS: DK, GZ_SANITIZE, GZ_WRITER_PAPER: { need }, console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, RangeError, Error, Promise, Object, Array, String, Number, Math, JSON, Map, Set, btoa, atob, ...overrides,
    chrome: { storage: { sync: { get: async () => (writer === undefined ? {} : { writer }) } }, runtime: { getURL: (f) => `chrome-extension://x/${f}`, connect: overrides.connect || worker() } } });
  ctx.globalThis = ctx;
  if (ctx.GZ_SANITIZE === undefined) delete ctx.GZ_SANITIZE;
  vm.runInContext(read('slides-kind.js'), ctx);
  return { DK, ctx };
};
const imports = async (DK) => {
  await DK.settled();
  for (const f of ['edit', 'thumb', 'file', 'exportFile', 'copy', 'text']) assert.equal(typeof DK.get('slides')[f], 'function', f);
  const on = typeof DK.get('slides').importFile === 'function';
  assert.equal(DK.opens('Week 3.pptx'), on ? 'slides' : null);
  assert.equal(/pptx/.test(DK.accept()), on);
  return on;
};

test('off, slides still view and export while Documents imports Word files only', async () => {
  for (const writer of [{ slides: false }, { slides: false, full: true }]) {
    for (const def of [false, true]) assert.equal(await imports(load(writer, { GZ_SANITIZE: sanitizer(def) }).DK), false, `${JSON.stringify(writer)}, default ${def}`);
  }
});

test('with no choice stored, import follows writer.slides\'s default in defaults.js', async () => {
  for (const writer of [undefined, { slides: 'yes' }, { full: true }, { pdf: true }]) {
    for (const def of [false, true]) assert.equal(await imports(load(writer, { GZ_SANITIZE: sanitizer(def) }).DK), def, `${JSON.stringify(writer)}, default ${def}`);
    assert.equal(await imports(load(writer).DK), GZ_DEFAULTS.writer.slides, `${JSON.stringify(writer)}, defaults.js as it is`);
  }
});

test('defaults.js loads through need() only where the page lacks it', async () => {
  assert.ok(!read('papers.html').includes('src="defaults.js"'), 'papers.html loads it on demand');
  assert.ok(read('writer.html').includes('<script src="defaults.js"></script>'), 'writer.html has it');
  const asked = [];
  let ctx;
  const need = async (files) => { asked.push(...files); if (files.includes('defaults.js')) ctx.GZ_SANITIZE = sanitizer(true); };
  ({ ctx } = load(undefined, { GZ_SANITIZE: undefined, GZ_WRITER_PAPER: { need } }));
  assert.equal(await imports(ctx.GZ_DOC_KINDS), true);
  assert.deepEqual(asked, ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js'], 'what defaults.js uses at load, first');
  asked.length = 0;
  ({ ctx } = load(undefined, { GZ_SANITIZE: sanitizer(true), GZ_WRITER_PAPER: { need } }));
  assert.equal(await imports(ctx.GZ_DOC_KINDS), true);
  assert.deepEqual(asked, [], 'writer.html has defaults.js already');
});

test('on, the slides kind registers its page code', async () => {
  const { DK } = load({ slides: true });
  await DK.settled();
  const k = DK.get('slides');
  for (const f of ['edit', 'thumb', 'exportFile', 'importFile', 'measure', 'file', 'text', 'copy']) assert.equal(typeof k[f], 'function', f);
  assert.equal(DK.opens('Week 3.pptx'), 'slides');
  assert.equal(DK.opens('Week 3.ppsx'), 'slides');
  assert.equal(k.label, 'Slides');
  assert.equal(k.exportLabel, 'Export .pptx');
});

test('the storage seam: bytes in, kept in the worker\'s store, the same bytes out, up to the kind\'s 50 MB', async () => {
  const { ctx } = load({ slides: true });
  const S = ctx.GZ_SLIDES_KIND.STORE;
  const bytes = new Uint8Array(4e6).map((_, i) => (i * 7919) % 256);
  const fields = await S.put(bytes, '.ppsx');
  assert.deepEqual(Object.keys(fields).sort(), ['ext', 'file', 'size']);
  assert.ok(F.ref(fields.file));
  assert.equal(fields.file.type, F.TYPES['.ppsx']);
  assert.equal(fields.size, bytes.length);
  assert.equal(fields.ext, '.ppsx');
  assert.equal((await S.put(bytes, '.PPTX')).ext, '.pptx');
  assert.equal((await S.put(bytes, '.exe')).ext, '.pptx', 'only the two extensions');
  assert.deepEqual(Buffer.from(await S.get(fields)), Buffer.from(bytes));
  assert.equal(S.max, 50e6);
  await assert.rejects(S.put(new Uint8Array(S.max + 1), '.pptx'), RangeError);
  assert.equal(await S.get({}), null, 'a record without a file');
  assert.equal(await S.get({ file: 42 }), null);
  // A deck from before the store reads as before; one the store lost says so.
  assert.deepEqual([...await S.get({ file: 'UEsDBA==' })], [80, 75, 3, 4]);
  await assert.rejects(S.get({ file: { hash: 'a'.repeat(64), size: 9, type: F.TYPES['.pptx'] } }), (e) => e.why === 'missing' && e.message === 'This file is missing.');
});

test('the store unavailable: a deck up to 3 MB is kept in its record as before; a larger one says why', async () => {
  const { ctx } = load({ slides: true }, { connect: worker(F.idb({ open: () => { throw new Error('private window'); } }, 'glaze-docs', fakeIDB().IDBKeyRange)) });
  const S = ctx.GZ_SLIDES_KIND.STORE;
  const fields = await S.put(new Uint8Array(1000).fill(3), '.pptx');
  assert.equal(typeof fields.file, 'string');
  await assert.rejects(S.put(new Uint8Array(3e6 + 1), '.pptx'), (e) => e.why === 'unavailable' && e.message === "This browser can't keep files larger than 3 MB right now.");
});

test('a copy keeps the deck, its count, its search text and its picture; the text is what search and measure read', async () => {
  const { DK } = load({ slides: true });
  await DK.settled();
  const k = DK.get('slides');
  const rec = { kind: 'slides', title: 'Week 3', file: 'UEsDBA==', size: 4, ext: '.pptx', slides: 9, text: 'Cell Biology\nMembrane transport', thumb: 'data:image/jpeg;base64,AA==', school: 'bb.school.test', submitted: 5 };
  assert.deepEqual({ ...k.copy(rec) }, { file: 'UEsDBA==', size: 4, ext: '.pptx', slides: 9, text: 'Cell Biology\nMembrane transport', thumb: 'data:image/jpeg;base64,AA==' });
  assert.deepEqual({ ...k.copy({ kind: 'slides' }) }, {});
  assert.equal(k.text(rec), 'Cell Biology\nMembrane transport');
  assert.equal(k.text({}), '');
  assert.deepEqual({ ...k.measure(rec) }, { slides: 9, chars: 31, words: 4 }); // spread: an object of this realm
});

test('files over the record cap are refused in the student\'s words before anything is read', async () => {
  const { DK } = load({ slides: true });
  await DK.settled();
  const k = DK.get('slides');
  const big = { name: 'Huge.pptx', size: 50e6 + 1, arrayBuffer: () => { throw new Error('read'); } };
  await assert.rejects(k.importFile(big), (e) => e instanceof RangeError && e.message === k.says.size);
  assert.deepEqual({ ...k.says }, { size: 'Choose a PowerPoint file smaller than 50 MB.', read: 'That file could not be read as a PowerPoint presentation.', ...DK.SAYS });
});


test('stored decks are bounded before base64 decoding', async () => {
  let decoded = 0;
  const { ctx } = load({ slides: true }, { atob: (s) => { decoded++; return atob(s); } });
  const S = ctx.GZ_SLIDES_KIND.STORE;
  assert.ok(await S.get({ file: 'A'.repeat(4e6 + 4), size: 3e6 + 3 }) === null, 'oversized stored deck is refused');
  assert.equal(decoded, 0, 'oversized stored input never reaches atob');
  assert.equal(await S.get({ file: '' }), null);
});


test('export blob URLs are revoked when the page closes', async () => {
  const listeners = new Map(), revoked = [];
  const { DK } = load({ slides: true }, {
    addEventListener: (name, cb) => listeners.set(name, cb), Blob,
    URL: { createObjectURL: () => 'blob:export', revokeObjectURL: (url) => revoked.push(url) },
    GZ_WRITER_PAPERS: { open: () => ({ get: async () => ({ file: 'UEsDBA==', title: 'Deck' }) }) },
    document: { createElement: () => ({ click() {}, remove() {} }), body: { append() {} } },
  });
  await DK.settled();
  await DK.get('slides').exportFile('doc:test');
  listeners.get('pagehide')({ persisted: true });
  assert.deepEqual(revoked, [], 'back-forward cached documents retain their URLs');
  listeners.get('pagehide')({ persisted: false });
  assert.deepEqual(revoked, ['blob:export']);
});


test('uncached card thumbnails do not retain blob URLs and read only listed media', async () => {
  let painted, created = 0;
  const done = new Promise((r) => { painted = r; }), reads = [];
  const slide = { shapes: [{ media: { path: 'ppt/media/a.png' } }, { media: { path: 'ppt/private.xml' } }] };
  const { DK } = load({ slides: true }, {
    Blob, URL: { createObjectURL: () => { created++; return 'blob:card'; } },
    document: { createElement: () => ({ replaceChildren() {} }) },
    GZ_PPTX: {
      read: async () => ({ size: { w: 1 }, slides: [slide], media: [{ path: 'ppt/media/a.png', mime: 'image/png' }] }),
      media: async (_, p) => { reads.push(p); return new Uint8Array([1]); },
    },
    GZ_SLIDES_RENDER: { px: (w) => w, stage: (_, __, o) => { painted(o.media); return {}; } },
  });
  await DK.settled();
  DK.get('slides').thumb({ file: 'UEsDBA==' });
  const media = await done;
  assert.deepEqual(reads, ['ppt/media/a.png']);
  assert.equal(created, 0, 'discardable card thumbnails do not allocate page-lifetime blobs');
  assert.equal(media.get('ppt/media/a.png'), 'data:image/png;base64,AQ==');
});
