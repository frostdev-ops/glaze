// A paper frame's key (lib/writer-papers.js keyOf) can come after the frame opens: writer-paper.js's saving and loading
// blocks, run over the real schema, styles, format and papers store (an in-memory storage.local and sessionStorage), with
// the page's context arriving after load(), as lib/writer-context-assignment.js send() hands it over.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const ST = require('../lib/writer-styles.js');
const F = require('../lib/writer-format.js');
const PA = require('../lib/writer-papers.js');

const source = fs.readFileSync(process.env.WRITER_PAPER_SOURCE || path.join(__dirname, '../writer-paper.js'), 'utf8');
const cut = (a, b) => { const i = source.indexOf(a), j = source.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return source.slice(i, j); };
const BLOCKS = `${cut('    // ---- saving', '    const setFormat = async')}\n${cut('    // ---- what the page says', '    const api = {')}`;

const memory = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (o) => { Object.assign(data, structuredClone(o)); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const session = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const PARTS = { school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' }, KEY = PA.keyOf(PARTS);
const RECOVERY = 'https://bb.school.test/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const docOf = (...texts) => ({ type: 'doc', content: texts.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const textOf = (json) => S.paper.nodeFromJSON(json).textContent;
let clock = 1e12;

// One frame: its blocks in a sandbox, a view over a real paper state, and the page's context handed over by context(c).
const frame = async ({ local, ss, context = { recovery: RECOVERY }, changed = [] }) => {
  let onContext = null;
  const view = { state: E.state({ mode: 'paper' }), updateState(s) { this.state = s; }, dispatch(tr) { this.state = this.state.apply(tr); } };
  const sandbox = vm.createContext({
    console, crypto, JSON, Date, Number, Object, Promise, Map, Set, Error, RangeError, structuredClone,
    setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {}, document: { addEventListener: () => {}, documentElement: { lang: 'en' } },
    sessionStorage: ss, Intl, importing: false, chrome: { storage: { onChanged: { addListener: (fn) => changed.push(fn) } } },
    S, ST, F, PA, PM: S.PM || globalThis.GZ_PM, view, ed: { words: () => E.words(S.text(view.state.doc).text) },
    store: PA.open(local, () => (clock += 1000), { versions: async () => 40 }),
    host: { context: () => context, onContext: (fn) => { onContext = fn; } }, ctx: context, prefs: {},
    format: ST.FORMATS.mla9, paper: null, keep: false, presets: [], zoom: 'fit', formatIssues: [], picked: null,
    t: (k) => k, state: { textContent: '' }, title: {}, due: {},
    restyleCSS() {}, counts() {}, setZoom() {}, PG: { relayout() {} }, runChecks() {}, runChecksSoon() {}, outlineDraw() {},
  });
  vm.runInContext(`${BLOCKS}\nglobalThis.__ = { load, changed, save, key: () => key, keep: () => keep, edits: () => edits };`, sandbox);
  const $ = sandbox.__;
  await $.load();
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
  return {
    $, view, sandbox,
    shown: () => view.state.doc.textContent,
    type: (text) => { view.dispatch(view.state.tr.insertText(text, view.state.doc.content.size - 1)); $.changed(); },
    context: async (c) => { onContext({ recovery: RECOVERY, assignment: { title: 'Essay 2' }, ...c }); await settle(); },
  };
};
const stored = async (local) => {
  const store = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const paper = await store.get(KEY);
  return { paper, versions: (await store.versions(KEY)).map((v) => v.reason), index: (await store.list()).map((r) => r.key) };
};
const seed = async (local, patch) => PA.open(local, () => (clock += 1000), { versions: async () => 40 }).save(KEY, { doc: docOf('Two thousand words of my essay.'), format: 'mla9', ...patch });

test('a paper whose key comes after the frame opens opens as saved: its import choice kept, no version added', async () => {
  const local = memory(), ss = session();
  await seed(local, { keep: true });
  const f = await frame({ local, ss });
  await f.context({ paper: PARTS });
  assert.equal(f.$.key(), KEY);
  assert.equal(f.shown(), 'Two thousand words of my essay.');
  assert.equal(f.$.keep(), true, 'the paper keeps the document\'s own formatting');
  const s = await stored(local);
  assert.equal(s.paper.keep, true);
  assert.deepEqual(s.versions, ['start'], 'opening a paper is not an import');
  assert.deepEqual(s.index, [KEY], 'the stand-in is gone');
});

test('a frame lost before its key came cannot replace the saved paper in the next frame', async () => {
  const local = memory(), ss = session();
  await seed(local);
  await frame({ local, ss }); // gone before the page's context arrived
  const next = await frame({ local, ss });
  await next.context({ paper: PARTS });
  assert.equal(next.shown(), 'Two thousand words of my essay.');
  const s = await stored(local);
  assert.equal(textOf(s.paper.doc), 'Two thousand words of my essay.');
  assert.deepEqual(s.versions, ['start']);
  assert.deepEqual(s.index, [KEY]);
});

test('the tab\'s unsaved copy comes back when the next frame learns its key late', async () => {
  const local = memory(), ss = session();
  await seed(local);
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.equal(first.$.key(), KEY);
  first.type(' The last paragraph I typed.'); // the frame goes before its autosave
  const next = await frame({ local, ss });
  await next.context({ paper: PARTS });
  assert.equal(next.shown(), 'Two thousand words of my essay. The last paragraph I typed.');
  assert.equal(textOf((await stored(local)).paper.doc), 'Two thousand words of my essay. The last paragraph I typed.');
});

test('what the student typed before the key came stays theirs, and the saved paper is kept as a version', async () => {
  const local = memory(), ss = session();
  await seed(local);
  const f = await frame({ local, ss });
  f.type('Started early.');
  await f.context({ paper: PARTS });
  assert.ok(f.shown().endsWith('Started early.'));
  const store = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const all = await Promise.all((await store.versions(KEY)).map((v) => store.version(KEY, v.id)));
  assert.ok(all.some((v) => textOf(v.doc) === 'Two thousand words of my essay.'), 'the saved paper is in its history');
  assert.deepEqual((await stored(local)).index, [KEY]);
});

// A picture as the schema holds it: its bytes as data.
const PICTURE = `data:image/png;base64,${'iVBORw0KGgo'.repeat(40000)}AAAAAElFTkSuQmCC`;
const pictured = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }, { type: 'image', attrs: { src: PICTURE, alt: 'Chart' } }] }] });
const pictureOf = (view) => { let src = null; view.state.doc.descendants((n) => { if (n.type.name === 'image') src = n.attrs.src; }); return src; };
const slotOf = (ss) => [...ss.m.entries()].find(([k]) => k.startsWith('gz-paper-pending:'))?.[1] || '';

test('the tab\'s unsaved copy refers to the pictures already saved, and the next frame puts them back whole', async () => {
  const local = memory(), ss = session();
  await seed(local, { doc: pictured('Before the chart.') });
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.type(' After it.');
  const slot = slotOf(ss);
  assert.ok(slot.includes('After it.'), 'the copy holds the edit');
  assert.ok(slot.length < 20000, `a keystroke copies no picture data (${slot.length} characters)`);
  const next = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.ok(next.shown().endsWith('After it.'));
  assert.equal(pictureOf(next.view), PICTURE);
  assert.equal(pictureOf({ state: { doc: S.paper.nodeFromJSON((await stored(local)).paper.doc) } }), PICTURE);
});

test('a picture not saved yet is kept whole in the tab\'s copy', async () => {
  const local = memory(), ss = session();
  await seed(local);
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.view.dispatch(first.view.state.tr.insert(first.view.state.doc.content.size - 1, S.paper.nodes.image.create({ src: PICTURE, alt: 'Chart' })));
  first.sandbox.__.changed();
  const next = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.equal(pictureOf(next.view), PICTURE);
});

test('a copy whose saved pictures are nowhere on this device any more is set aside, not opened with holes', async () => {
  const local = memory(), ss = session();
  await seed(local, { doc: pictured('Before the chart.') });
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.type(' After it.');
  await PA.open(local, () => (clock += 1000)).remove(KEY);
  await seed(local, { doc: docOf('Another tab removed the chart.') });
  const next = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.equal(next.shown(), 'Another tab removed the chart.');
});

// Two tabs on one paper: storage.local tells each what the other saved.
const tabs = async () => {
  const local = memory(), heard = [], b = [];
  await seed(local);
  const A = await frame({ local, ss: session(), context: { recovery: RECOVERY, paper: PARTS } });
  const B = await frame({ local, ss: session(), context: { recovery: RECOVERY, paper: PARTS }, changed: b });
  const tell = async () => { for (const fn of b) fn({ [`writerPaper:${KEY}`]: { newValue: structuredClone(local.data[`writerPaper:${KEY}`]) } }, 'local'); for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
  return { local, A, B, tell, heard };
};

test('a tab with nothing unsaved shows what another tab saved, and its next edit builds on it', async () => {
  const { local, A, B, tell } = await tabs();
  A.type(' Written in the other tab.');
  await A.$.save();
  await tell();
  assert.equal(B.shown(), 'Two thousand words of my essay. Written in the other tab.');
  B.type(' And here.');
  await B.$.save();
  const s = await stored(local);
  assert.equal(textOf(s.paper.doc), 'Two thousand words of my essay. Written in the other tab. And here.');
  assert.ok(!s.versions.includes('conflict'), `versions: ${s.versions.join(', ')}`);
});

test('a tab still holding unsaved typing keeps it when another tab saves', async () => {
  const { A, B, tell } = await tabs();
  B.type(' Unsaved here.');
  A.type(' Written in the other tab.');
  await A.$.save();
  await tell();
  assert.equal(B.shown(), 'Two thousand words of my essay. Unsaved here.');
});
