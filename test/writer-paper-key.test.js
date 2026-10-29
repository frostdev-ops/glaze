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
// Open from Documents' pick, with the format change and the restore its Undo runs ('' in a source without it).
const PICK = source.includes('    // ---- Open from Documents') ? cut('    // ---- Open from Documents', '    let docsSheet') : '';
const BLOCKS = `${cut('    // ---- saving', '    const setFormat = async')}\n${cut('    // ---- what the page says', '    const api = {')}\n${cut('    const setFormat = async', '    // ---- toolbar actions')}\n${cut('    const restore = async', '    const open2 =')}\n${PICK}`;

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
// extra: names over the sandbox's (a standalone document's host, own, titleIn and location).
const frame = async ({ local, ss, context = { recovery: RECOVERY }, changed = [], timers = [], windowEvents = {}, extra = {} }) => {
  let onContext = null;
  const view = { state: E.state({ mode: 'paper' }), props: { editable: () => true }, updateState(s) { this.state = s; }, dispatch(tr) { this.state = this.state.apply(tr); }, setProps(p) { Object.assign(this.props, p); }, focus() {} };
  const sandbox = vm.createContext({
    recoveryMessages: [], toast: (m) => sandbox.recoveryMessages.push(m),
    console, crypto, TextEncoder, Uint8Array, JSON, Date, Number, Object, Promise, Map, Set, Error, RangeError, structuredClone,
    setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    addEventListener: (type, fn) => { windowEvents[type] = fn; }, document: { addEventListener: () => {}, documentElement: { lang: 'en' } },
    sessionStorage: ss, Intl, importing: false, chrome: { storage: { onChanged: { addListener: (fn) => changed.push(fn) } } },
    S, ST, F, PA, PM: S.PM || globalThis.GZ_PM, view, ed: { words: () => E.words(S.text(view.state.doc).text) },
    store: PA.open(local, () => (clock += 1000), { versions: async () => 40 }),
    host: { context: () => context, onContext: (fn) => { onContext = fn; } }, ctx: context, prefs: {},
    format: ST.FORMATS.mla9, paper: null, keep: false, presets: [], zoom: 'fit', formatIssues: [], picked: null,
    t: (k) => k, state: { textContent: '' }, title: {}, due: {},
    restyleCSS() {}, counts() {}, setZoom() {}, PG: { relayout() {} }, runChecks() {}, runChecksSoon() {}, outlineDraw() {}, outlineAI: { stop() {} }, sourcesPanel: null,
    own: false, titleIn: null, URLSearchParams, location: { search: '' }, ...extra,
  });
  vm.runInContext(`${BLOCKS}\nglobalThis.__ = { load, changed, save, restore, key: () => key, keep: () => keep, edits: () => edits, format: () => format, dirty: () => dirty, fromDocs: typeof fromDocs === 'function' ? fromDocs : null };`, sandbox);
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

test('recovery keeps unsaved text even when another tab deleted its saved pictures', async () => {
  const local = memory(), ss = session();
  await seed(local, { doc: pictured('Before the chart.') });
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.type(' After it.');
  await PA.open(local, () => (clock += 1000)).remove(KEY);
  await seed(local, { doc: docOf('Another tab removed the chart.') });
  const next = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.ok(next.shown().includes('Before the chart.') && next.shown().endsWith(' After it.'), 'unsaved text returns');
  assert.equal(pictureOf(next.view), null, 'missing picture gets a text placeholder');
  const store = PA.open(local);
  const versions = await Promise.all((await store.versions(KEY)).map((v) => store.version(KEY, v.id)));
  assert.ok(versions.some((v) => textOf(v.doc) === 'Another tab removed the chart.'));
  assert.deepEqual(next.sandbox.recoveryMessages, ['Some pictures, objects or equations were left out.']);
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

test('a failed autosave tries again by itself, and leaving the page meanwhile asks first', async () => {
  const local = memory(), ss = session(), timers = [], windowEvents = {};
  await seed(local);
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS }, timers, windowEvents });
  const set = local.set;
  local.set = async () => { local.set = set; throw new Error('QUOTA_BYTES quota exceeded'); };
  f.type(' Typed while storage refused.');
  assert.equal(await f.$.save(), null);
  let asked = false;
  windowEvents.beforeunload({ preventDefault: () => { asked = true; } });
  assert.ok(asked, 'leaving with unsaved typing that failed to save asks first');
  const retry = timers.filter((x) => x.fn).at(-1);
  assert.ok(retry && retry.ms >= 1000, 'a retry is scheduled');
  await retry.fn();
  assert.equal(textOf((await stored(local)).paper.doc), 'Two thousand words of my essay. Typed while storage refused.');
});

test('the tab\'s unsaved copy follows the paper, not the page address it was typed on', async () => {
  const local = memory(), ss = session();
  await seed(local);
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.type(' Typed before Ultra numbered the attempt.');
  const next = await frame({ local, ss, context: { recovery: RECOVERY.replace('/attempt/create', '/attempt/_31_1'), paper: PARTS } });
  assert.equal(next.shown(), 'Two thousand words of my essay. Typed before Ultra numbered the attempt.');
});

test('a tab\'s unsaved copy brought back over another tab\'s newer save keeps that save as a version', async () => {
  const local = memory(), ss = session();
  await seed(local);
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.type(' Typed here, never saved.');
  await seed(local, { doc: docOf('Saved meanwhile in another tab.') });
  const next = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.equal(next.shown(), 'Two thousand words of my essay. Typed here, never saved.');
  const store = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const all = await Promise.all((await store.versions(KEY)).map((v) => store.version(KEY, v.id)));
  assert.ok(all.some((v) => textOf(v.doc) === 'Saved meanwhile in another tab.'), `the other tab's save is kept (${all.map((v) => v.reason).join(', ')})`);
});

test('a new paper opened before the page named its student and assignment fills its heading when it does', async () => {
  const local = memory(), ss = session();
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  await f.context({ paper: PARTS, user: { name: 'Alex Rivera' }, course: { name: 'ENGL 2110' }, assignment: { title: 'Essay 2' } });
  assert.ok(f.shown().startsWith('Alex Rivera'), f.shown());
  assert.ok(f.shown().includes('ENGL 2110') && f.shown().includes('Essay 2'));
  assert.ok(textOf((await stored(local)).paper.doc).startsWith('Alex Rivera'), 'and saves it');
});

test('a new paper the student already wrote in keeps what they wrote when the page names them', async () => {
  const local = memory(), ss = session();
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  f.type('My first sentence.');
  await f.context({ paper: PARTS, user: { name: 'Alex Rivera' }, assignment: { title: 'Essay 2' } });
  assert.ok(f.shown().includes('My first sentence.'));
});

test('storage telling a paper of its own save, before the save answers, never reloads the paper', async () => {
  const local = memory(), ss = session(), changed = [];
  await seed(local);
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS }, changed });
  const set = local.set;
  local.set = async (o) => { await set(o); for (const fn of changed) fn(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { newValue: structuredClone(v) }])), 'local'); for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
  const before = f.view.state.doc;
  assert.ok(await f.$.save('sending'), 'a version saved with nothing typed');
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  assert.equal(f.view.state.doc, before, 'the same document: a submit sheet open on it carries on');
});


test('typing while another tab is being read keeps that tab’s draft as a conflict version', async () => {
  const local = memory(), ss = session(), changed = [];
  await seed(local);
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS }, changed });
  await seed(local, { doc: docOf('Other tab’s newer draft.') });
  const get = local.get;
  let release;
  local.get = async (k) => {
    const result = await get(k);
    if (k === PA.KEYS.PAPER + KEY) { local.get = get; await new Promise((r) => { release = r; }); }
    return result;
  };
  const adopting = changed[0]({ [PA.KEYS.PAPER + KEY]: { newValue: local.data[PA.KEYS.PAPER + KEY] } }, 'local');
  for (let i = 0; i < 10 && !release; i++) await new Promise(setImmediate);
  assert.ok(release);
  f.type(' Unsaved while reading.');
  release(); await adopting;
  await f.$.save();
  const store = PA.open(local);
  const versions = await Promise.all((await store.versions(KEY)).map((v) => store.version(KEY, v.id)));
  assert.ok(versions.some((v) => v.reason === 'conflict' && textOf(v.doc) === 'Other tab’s newer draft.'));
});

test('overlapping frame saves never mistake an earlier own save for another editor', async () => {
  const local = memory(), ss = session(); await seed(local);
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  f.type(' First.'); const a = f.$.save();
  f.type(' Second.'); const b = f.$.save();
  await Promise.all([a, b]);
  assert.ok(!(await stored(local)).versions.includes('conflict'));
  assert.ok(textOf((await stored(local)).paper.doc).endsWith(' First. Second.'));
});

test('recovery never swaps distinct pictures with the same length and trailing bytes', async () => {
  const local = memory(), ss = session();
  const a = `data:image/png;base64,AAAA${'A'.repeat(100)}AAAAAElFTkSuQmCC`;
  const b = `data:image/png;base64,BBBB${'A'.repeat(100)}AAAAAElFTkSuQmCC`;
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two figures.' },
    { type: 'image', attrs: { src: a, alt: 'A' } }, { type: 'image', attrs: { src: b, alt: 'B' } }] }] };
  await seed(local, { doc });
  const first = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  first.type(' Unsaved caption.');
  const next = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  const sources = []; next.view.state.doc.descendants((n) => { if (n.type.name === 'image') sources.push(n.attrs.src); });
  assert.deepEqual(sources, [a, b]);
});

test('legacy image references are not resolved to a different picture in a newer draft', async () => {
  const local = memory(), ss = session();
  const a = `data:image/png;base64,AAAA${'A'.repeat(100)}AAAAAElFTkSuQmCC`;
  const b = `data:image/png;base64,BBBB${'A'.repeat(100)}AAAAAElFTkSuQmCC`;
  const imageDoc = (src) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Caption.' }, { type: 'image', attrs: { src, alt: 'Figure' } }] }] });
  const first = await seed(local, { doc: imageDoc(a) });
  await PA.open(local).save(KEY, { doc: imageDoc(b) }, { reason: 'import' });
  const pending = imageDoc(`gz-saved:${a.length}:${a.slice(-64)}`);
  pending.content[0].content.push({ type: 'text', text: ' Unsaved.' });
  ss.setItem(`gz-paper-pending:${KEY}`, JSON.stringify({ key: KEY, base: first.paper.revision, record: { doc: pending, format: 'mla9' } }));
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS } });
  assert.equal(pictureOf(f.view), null, 'an ambiguous legacy reference gets a placeholder, never the wrong picture');
  assert.ok(f.shown().endsWith(' Unsaved.'));
});

// ---- a standalone document (doc: key, papers.html): made by the Documents home, titled in the editor
const DOC = 'doc:0f8e2b1a-3c4d-4e5f-8a9b-0c1d2e3f4a5b';
const titleField = () => { const on = {}; return { on, value: '', placeholder: '', size: 0, readOnly: true, addEventListener: (type, fn) => { on[type] = fn; } }; };
const standalone = (search, titleIn = titleField()) => ({ titleIn, extra: { own: true, titleIn, location: { search }, host: { standalone: true, key: DOC, context: () => ({}) } } });
const run = async (timers) => { for (const x of timers.splice(0)) if (x.fn) await x.fn(); };
const record = (local) => local.data[PA.KEYS.PAPER + DOC];

test('a new standalone document opens in ?format= and is saved only once written in or titled', async () => {
  for (const [search, id] of [['?paper=x&format=plain', 'plain'], ['?format=apa7', 'apa7'], ['?format=ieee', 'mla9'], ['', 'mla9']]) {
    const local = memory(), timers = [], { extra } = standalone(search);
    const f = await frame({ local, ss: session(), context: {}, timers, extra });
    assert.equal(f.$.format().id, id, search);
    await run(timers);
    assert.deepEqual(Object.keys(local.data), [], `${search}: an untouched document leaves nothing behind`);
  }
  const local = memory(), timers = [], { extra, titleIn } = standalone('?format=plain');
  const f = await frame({ local, ss: session(), context: {}, timers, extra });
  assert.equal(titleIn.readOnly, false);
  assert.equal(titleIn.placeholder, 'Untitled document');
  f.type('Shopping list');
  assert.equal(titleIn.placeholder, 'Shopping list', 'its first line in the title field');
  await run(timers);
  assert.deepEqual([record(local).kind, record(local).named, record(local).title, record(local).format], ['paper', false, 'Shopping list', 'plain']);
  titleIn.value = '  Field   notes '; titleIn.on.input();
  await run(timers);
  assert.deepEqual([record(local).named, record(local).title], [true, 'Field notes'], 'a typed title, saved as an edit is');
  titleIn.value = ''; titleIn.on.input();
  await run(timers);
  assert.deepEqual([record(local).named, record(local).title], [false, 'Shopping list'], 'emptied: its first line again');

  const local2 = memory(), timers2 = [], s2 = standalone('?format=plain');
  await frame({ local: local2, ss: session(), context: {}, timers: timers2, extra: s2.extra });
  s2.titleIn.value = 'Named first'; s2.titleIn.on.input();
  await run(timers2);
  assert.deepEqual([record(local2).named, record(local2).title, record(local2).doc?.type], [true, 'Named first', 'doc'], 'a title alone saves the document');
});

test('an assignment paper is still saved when it opens, titled by Ultra', async () => {
  const local = memory();
  await frame({ local, ss: session(), context: { recovery: RECOVERY, paper: PARTS, assignment: { title: 'Essay 2' } } });
  const { paper } = await stored(local);
  assert.deepEqual([paper.kind, paper.named, paper.title], ['paper', false, 'Essay 2']);
});

test('a rename from the Documents home stays: the title follows it, unsaved typing too, and no conflict version', async () => {
  const local = memory(), timers = [], changed = [], { extra, titleIn } = standalone('?format=plain');
  const home = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const f = await frame({ local, ss: session(), context: {}, timers, changed, extra });
  f.type('First line.');
  await run(timers);
  const tell = async () => { await changed[0]({ [PA.KEYS.PAPER + DOC]: { newValue: record(local) } }, 'local'); for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
  // Nothing unsaved: the title changes, the editor's state (text, caret, undo) is the same object.
  const before = f.view.state;
  await home.save(DOC, { title: 'Renamed', named: true });
  await tell();
  assert.equal(titleIn.value, 'Renamed');
  assert.equal(f.view.state, before, 'the document is not reloaded for a rename');
  // Unsaved typing, then a rename: both survive the next save.
  f.type(' More.');
  assert.ok(f.$.dirty());
  await home.save(DOC, { title: 'Renamed again', named: true });
  await tell();
  assert.equal(titleIn.value, 'Renamed again');
  await run(timers);
  assert.deepEqual([record(local).title, record(local).named, f.shown()], ['Renamed again', true, 'First line. More.']);
  assert.ok(!(await home.versions(DOC)).some((v) => v.reason === 'conflict'), 'the editor built on the rename');
  // Its own saves never read as a rename.
  titleIn.value = 'Mine'; titleIn.on.input();
  await run(timers);
  await tell();
  assert.deepEqual([titleIn.value, record(local).title], ['Mine', 'Mine']);
});

test('Open from Documents copies a standalone document into the assignment paper with a version and Undo', async () => {
  const local = memory(), toasts = [], app = {};
  await seed(local);
  const home = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  await home.save(DOC, { doc: docOf('Drafted at home.', 'Second paragraph.'), kind: 'paper', named: false, title: 'Drafted at home.', format: 'plain', keep: true });
  const source = structuredClone(record(local)), sourceVersions = await home.versions(DOC);
  const extra = { root: { isConnected: true, inert: false }, current: app, api: app, noteCache: new Map(), toast: (text, act) => toasts.push({ text, act }) };
  const f = await frame({ local, ss: session(), context: { recovery: RECOVERY, paper: PARTS, assignment: { title: 'Essay 2' } }, extra });
  assert.equal(typeof f.$.fromDocs, 'function', 'writer-paper.js has Open from Documents');
  const before = await f.$.fromDocs(DOC, 'Drafted at home.');
  assert.equal(f.shown(), 'Drafted at home.Second paragraph.');
  assert.deepEqual([f.$.format().id, f.$.keep(), extra.root.inert, f.view.props.editable()], ['plain', true, false, true]);
  let s = await stored(local);
  assert.deepEqual([textOf(s.paper.doc), s.paper.format, s.paper.keep, s.paper.title, s.paper.named], ['Drafted at home.Second paragraph.', 'plain', true, 'Essay 2', false], 'the assignment keeps Ultra\'s title');
  assert.deepEqual(s.versions, ['import', 'start']);
  const kept = await home.version(KEY, before.id);
  assert.deepEqual([kept.reason, textOf(kept.doc), kept.format], ['import', 'Two thousand words of my essay.', 'mla9'], 'what the paper held is a version first');
  assert.deepEqual([record(local), await home.versions(DOC)], [source, sourceVersions], 'the document stays as it was');
  assert.ok(s.index.includes(DOC) && s.index.includes(KEY));
  assert.deepEqual([toasts.length, toasts[0].text, toasts[0].act?.label], [1, 'Drafted at home.', 'Undo']);
  await toasts[0].act.run();
  assert.equal(f.shown(), 'Two thousand words of my essay.');
  assert.deepEqual([f.$.format().id, f.$.keep()], ['mla9', false]);
  s = await stored(local);
  assert.deepEqual([textOf(s.paper.doc), s.paper.format, s.versions], ['Two thousand words of my essay.', 'mla9', ['restore', 'import', 'start']]);
  assert.deepEqual(record(local), source);

  // Never into a standalone document, nor from anything but one.
  const into = await frame({ local, ss: session(), context: {}, extra: { ...standalone('').extra, ...extra } });
  assert.equal(await into.$.fromDocs(DOC, 'x'), null);
  assert.equal(await f.$.fromDocs(KEY, 'x'), null);
  assert.equal(f.shown(), 'Two thousand words of my essay.');
});

test('a recovered typed title remains visible when its first save is refused', async () => {
  const local = memory(), ss = session(), { extra, titleIn } = standalone('?format=plain');
  ss.setItem(`gz-paper-pending:${DOC}`, JSON.stringify({ key: DOC, base: 0, rename: true, record: { key: DOC, doc: docOf('Notes.'), format: 'plain', title: 'Recovered title', named: true } }));
  local.set = async () => { throw Error('QUOTA_BYTES'); };
  const f = await frame({ local, ss, context: {}, extra: { ...extra, console: { error() {} } } });
  assert.equal(f.$.dirty(), true);
  assert.equal(titleIn.value, 'Recovered title');
});

const picking = async (patch = {}, original = {}) => {
  const local = memory(), app = {}, toasts = [], ss = session();
  await seed(local, original);
  const home = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  await home.save(DOC, { doc: docOf('New document.'), format: 'plain', keep: true, ...patch });
  const f = await frame({ local, ss, context: { recovery: RECOVERY, paper: PARTS, assignment: { title: 'Essay 2' } },
    extra: { root: { isConnected: true, inert: false }, current: app, api: app, noteCache: new Map(), console: { error() {} }, toast: (text, act) => toasts.push({ text, act }) } });
  return { local, home, f, ss, toasts };
};

test('a pick and its restore each replace the editor document in one history step', async () => {
  const { f, toasts } = await picking();
  const history = (S.PM || globalThis.GZ_PM).history;
  assert.equal(history.undoDepth(f.view.state), 0);
  await f.$.fromDocs(DOC, 'New document');
  assert.equal(history.undoDepth(f.view.state), 1, 'no intermediate restyling of the old document');
  await toasts[0].act.run();
  assert.equal(history.undoDepth(f.view.state), 2, 'restore also replaces the document just once');
});

test('a pick flushes unsaved typing and pending autosave before taking its version', async () => {
  const { local, home, f } = await picking();
  f.type(' Unsaved typing.');
  const pending = f.$.save();
  const before = await f.$.fromDocs(DOC, 'New document');
  await pending;
  assert.ok(textOf((await home.version(KEY, before.id)).doc).endsWith(' Unsaved typing.'));
  assert.equal(textOf((await stored(local)).paper.doc), 'New document.');
});

test('an autosave queued during the import write cannot write the outgoing document over the pick', async () => {
  const { local, f } = await picking();
  const put = local.set;
  let release, started, held = false;
  const gate = new Promise((r) => { started = r; });
  local.set = async (o) => {
    if (!held && textOf(o[PA.KEYS.PAPER + KEY]?.doc || docOf('Other')) === 'New document.') {
      held = true;
      started(); await new Promise((r) => { release = r; });
    }
    return put(o);
  };
  const pick = f.$.fromDocs(DOC, 'New document');
  await gate;
  const auto = f.$.save();
  await new Promise(setImmediate);
  release();
  await pick; await auto;
  assert.equal(textOf((await stored(local)).paper.doc), f.shown());
  assert.equal(f.shown(), 'New document.');
});

test('a pick during an active submit does not read or write any paper', async () => {
  const { local, f } = await picking();
  const before = structuredClone(local.data);
  let reads = 0;
  f.sandbox.GZ_WRITER_SUBMIT_SHEET = { busy: () => true };
  f.sandbox.store.get = async () => { reads++; return null; };
  assert.equal(await f.$.fromDocs(DOC, 'New document'), null);
  assert.equal(reads, 0);
  assert.deepEqual(local.data, before);
});

test('deleted or invalid sources leave the assignment untouched and report failure', async () => {
  for (const invalid of [false, true]) {
    const { local, home, f, toasts } = await picking();
    if (invalid) await home.save(DOC, { doc: { type: 'unknown' } }); else await home.remove(DOC);
    const before = structuredClone(local.data[PA.KEYS.PAPER + KEY]);
    await f.$.fromDocs(DOC, 'Gone');
    assert.equal(f.shown(), 'Two thousand words of my essay.');
    assert.deepEqual(local.data[PA.KEYS.PAPER + KEY], before);
    assert.equal(toasts.at(-1).text, 'Not saved. Try again in a moment.');
    assert.equal(f.view.props.editable(), true);
  }
});

test('a pick replaces the old outline, binds the source outline, and Undo restores the old one', async () => {
  const outline = { schema: 1, scope: KEY, entries: [{ heading: 'Old outline' }] };
  for (const imported of [null, { schema: 1, scope: '', entries: [{ heading: 'New outline' }] }]) {
    const { local, f, toasts } = await picking({ outline: imported }, { outline });
    await f.$.fromDocs(DOC, 'New document');
    assert.deepEqual((await stored(local)).paper.outline, imported && { ...imported, scope: KEY });
    await toasts[0].act.run();
    assert.deepEqual((await stored(local)).paper.outline, outline);
    await f.$.save();
    assert.deepEqual((await stored(local)).paper.outline, outline, 'the next autosave keeps the restored outline');
  }
});

test('a document with a large picture stays intact in the pick and its session recovery', async () => {
  const picture = { type: 'image', attrs: { src: `data:image/png;base64,${'A'.repeat(2_100_000)}`, alt: 'Photo' } };
  const { local, f, ss } = await picking({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Photo notes.' }, picture] }] } });
  await f.$.fromDocs(DOC, 'Photo notes');
  assert.equal(f.view.state.doc.firstChild.lastChild.attrs.src, picture.attrs.src);
  f.type(' More notes.');
  assert.ok(ss.getItem(`gz-paper-pending:${KEY}`).length < 5000, 'the saved picture is a digest in sessionStorage');
  assert.equal((await stored(local)).paper.doc.content[0].content[1].attrs.src, picture.attrs.src);
});
