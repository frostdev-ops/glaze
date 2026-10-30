// Slides on the Documents page (slides-kind.js, papers.html): loaded after papers.js and packaged, available for viewing with
// Settings → Writer → Slides off; importing needs writer.slides on, its one storage seam (the deck's bytes as a base64 `file` field in the paper
// record until the worker's blob store takes them), what it keeps for search and a copy, and the files it refuses. The
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

// slides-kind.js in a context of its own: the registry, a storage.sync answering writer.slides, and need() as a no-op.
const load = (writer, overrides = {}) => {
  delete require.cache[require.resolve('../lib/doc-kinds.js')];
  delete globalThis.GZ_DOC_KINDS;
  const DK = require('../lib/doc-kinds.js');
  const ctx = vm.createContext({ GZ_DOC_KINDS: DK, GZ_WRITER_PAPER: { need: async () => {} }, console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, RangeError, Error, Promise, Object, Array, String, Number, Math, JSON, Map, Set, btoa, atob, ...overrides,
    chrome: { storage: { sync: { get: async () => (writer === undefined ? {} : { writer }) } }, runtime: { getURL: (f) => `chrome-extension://x/${f}` } } });
  ctx.globalThis = ctx;
  vm.runInContext(read('slides-kind.js'), ctx);
  return { DK, ctx };
};

test('off (the default), slides still view and export while Documents imports Word files only', async () => {
  for (const writer of [undefined, { slides: false }, { slides: 'yes' }, { full: true }, { pdf: true }]) {
    const { DK } = load(writer);
    await DK.settled();
    for (const f of ['edit', 'thumb', 'file', 'exportFile', 'copy', 'text']) assert.equal(typeof DK.get('slides')[f], 'function', `${f}: ${JSON.stringify(writer)}`);
    assert.equal(DK.get('slides').importFile, undefined);
    assert.equal(DK.opens('Week 3.pptx'), null);
    assert.ok(!/pptx/.test(DK.accept()));
  }
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

test('the storage seam: bytes in, the same bytes out, nothing past the record cap', async () => {
  const { ctx } = load({ slides: true });
  const S = ctx.GZ_SLIDES_KIND.STORE;
  const bytes = new Uint8Array(70000).map((_, i) => (i * 7919) % 256);
  const fields = S.put(bytes, '.ppsx');
  assert.deepEqual(Object.keys(fields).sort(), ['ext', 'file', 'size']);
  assert.equal(typeof fields.file, 'string');
  assert.equal(fields.size, bytes.length);
  assert.equal(fields.ext, '.ppsx');
  assert.equal(S.put(bytes, '.PPTX').ext, '.pptx');
  assert.equal(S.put(bytes, '.exe').ext, '.pptx', 'only the two extensions');
  assert.deepEqual([...S.get(fields)], [...bytes]);
  assert.ok(fields.file.length <= 4e6);
  // The paper record's 4 MB: base64 of at most 3 MB of deck (the blob store lifts this to the kind's 50 MB).
  assert.equal(S.max, 3e6);
  assert.throws(() => S.put(new Uint8Array(S.max + 1), '.pptx'), RangeError);
  assert.equal(S.get({}), null, 'a record without a file');
  assert.equal(S.get({ file: 42 }), null);
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
  const big = { name: 'Huge.pptx', size: 3e6 + 1, arrayBuffer: () => { throw new Error('read'); } };
  await assert.rejects(k.importFile(big), (e) => e instanceof RangeError && e.message === k.says.size);
  assert.deepEqual({ ...k.says }, { size: 'Choose a PowerPoint file smaller than 3 MB.', read: 'That file could not be read as a PowerPoint presentation.' });
});


test('stored decks are bounded before base64 decoding', () => {
  let decoded = 0;
  const { ctx } = load({ slides: true }, { atob: (s) => { decoded++; return atob(s); } });
  const S = ctx.GZ_SLIDES_KIND.STORE;
  assert.ok(S.get({ file: 'A'.repeat(4e6 + 4), size: 3e6 + 3 }) === null, 'oversized stored deck is refused');
  assert.equal(decoded, 0, 'oversized stored input never reaches atob');
  assert.equal(S.get({ file: '' }), null);
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
