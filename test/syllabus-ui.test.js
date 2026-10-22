// Syllabus import as it runs: the background worker's writes ('glaze:syllabus', 'glaze:gpascale') arriving in any
// order, and features/syllabus.js on a small stand-in page while the code it waits for is held.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.instructure.com';
const ID = 'glaze-test-id';

// A storage area whose reads answer on a later turn, as Chrome's do.
const area = (data = {}) => ({
  data,
  get: async (k) => { await null; return Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])); },
  set: async (p) => { await null; Object.assign(data, structuredClone(p)); },
  remove: async (k) => { for (const x of [].concat(k)) delete data[x]; },
});
// lib/background.js on those areas; send(m) answers as the worker would to a Canvas tab on ORIGIN.
const worker = () => {
  const listeners = [];
  const local = area(), sync = area();
  const none = { addListener() {} };
  const ctx = vm.createContext({
    URL, console, setTimeout, clearTimeout, TextEncoder, crypto: require('node:crypto').webcrypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(path.join('lib', f)), ctx); },
    chrome: {
      runtime: { id: ID, getURL: (p = '') => `chrome-extension://${ID}/${p}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: none, onStartup: none, onConnect: none },
      storage: { local, sync, onChanged: none },
      scripting: { executeScript: () => Promise.resolve([]) },
    },
  });
  vm.runInContext(read('lib/background.js'), ctx);
  const sender = { id: ID, tab: { id: 1 }, frameId: 0, url: `${ORIGIN}/courses/25` };
  const send = (m) => new Promise((resolve) => { for (const f of listeners) f(m, sender, (r) => resolve(JSON.parse(JSON.stringify(r ?? null)))); });
  return { send, local: local.data, sync: sync.data };
};

test('the worker keeps syllabus saves in the order they were made, and a save from before a delete stays deleted', async () => {
  const w = worker();
  const key = `syllabus:${ORIGIN}/3/25`;
  const save = (name, at) => w.send({ type: 'glaze:syllabus', key, rec: { prof: { name } }, at });
  assert.equal((await save('Newer', 200)).ok, true);
  assert.deepEqual(await save('Older', 100), { ok: false, error: 'stale' });
  assert.equal(w.local[key].prof.name, 'Newer');
  assert.equal((await w.send({ type: 'glaze:syllabus', key, rec: null, at: 300 })).ok, true);
  assert.deepEqual(await save('Late', 250), { ok: false, error: 'stale' });
  assert.deepEqual(w.local[key], { deleted: 300 }, 'still deleted');
  assert.equal((await save('Again', 400)).ok, true);
  assert.equal(w.local[key].prof.name, 'Again');
});

test('two courses\' scales saved at once both reach the GPA', async () => {
  const w = worker();
  w.sync.gpaCourses = { [`canvas:${ORIGIN}/27`]: { c: 4 } };
  const scale = (cid, s) => w.send({ type: 'glaze:gpa', key: `canvas:${ORIGIN}/${cid}`, patch: { s } });
  const [a, b] = await Promise.all([scale('25', 'A 93, B 83, C 73'), scale('26', 'A 90, B 80, C 70')]);
  assert.deepEqual([a.ok, b.ok], [true, true]);
  assert.deepEqual(w.sync.gpaCourses, {
    [`canvas:${ORIGIN}/27`]: { c: 4 },
    [`canvas:${ORIGIN}/25`]: { s: 'A 93, B 83, C 73' },
    [`canvas:${ORIGIN}/26`]: { s: 'A 90, B 80, C 70' },
  });
  assert.deepEqual(await scale('25', 'not a scale'), { ok: false, error: 'bad' });
  assert.deepEqual(await w.send({ type: 'glaze:gpa', key: 'canvas:https://other.instructure.com/25', patch: { s: 'A 90' } }), { ok: false, error: 'sender' });
  assert.equal((await scale('25', null)).ok, true);
  assert.equal(w.sync.gpaCourses[`canvas:${ORIGIN}/25`], undefined, 'taken away');
});

test('a GPA change that would push another course out of the full synced item is refused, never truncated', async () => {
  // Codex's witness: the synced item close to its 8 KB cap, then one course given a long scale.
  const C = require('../lib/gradecalc.js');
  const raw = {};
  for (let i = 0; i < 100; i++) {
    const k = `canvas:${ORIGIN}/${10000 + i}`;
    raw[k] = i ? { c: 4, l: 0.5, x: 1, s: 'A 90, B 80, C 70' } : { c: 4 };
    if (new TextEncoder().encode(`gpaCourses${JSON.stringify(raw)}`).length > 7965) { delete raw[k]; break; }
  }
  const keys = Object.keys(raw);
  const long = 'A+ 97.55, A 93.25, A- 90.75, B+ 87.25, B 83.55, B- 80.25, C+ 77.55, C 73.25, C- 70.55, D+ 67.25, D 63.55, D- 60.25, F 0.5';
  const r = C.patchGpa(raw, keys[0], { s: long });
  assert.deepEqual([r.ok, r.error], [false, 'full']);
  assert.deepEqual(Object.keys(r.prefs), keys, 'every course still there');
  const w = worker();
  w.sync.gpaCourses = structuredClone(raw);
  assert.deepEqual(await w.send({ type: 'glaze:gpa', key: keys[0], patch: { s: long } }), { ok: false, error: 'full' });
  assert.deepEqual(w.sync.gpaCourses, raw, 'nothing written');
  assert.equal((await w.send({ type: 'glaze:gpa', key: keys[0], patch: { c: 5 } })).ok, true, 'a change that fits still goes through');
  assert.equal(Object.keys(w.sync.gpaCourses).length, keys.length);
});

test('the GPA table and syllabus import share that one writer: a credits change and a scale for the same course both stay', async () => {
  const w = worker();
  const key = `canvas:${ORIGIN}/25`;
  const [a, b] = await Promise.all([w.send({ type: 'glaze:gpa', key, patch: { c: 4 } }), w.send({ type: 'glaze:gpa', key, patch: { s: 'A 93, B 83' } })]);
  assert.deepEqual([a.ok, b.ok], [true, true]);
  assert.deepEqual(w.sync.gpaCourses, { [key]: { c: 4, s: 'A 93, B 83' } });
  assert.equal((await w.send({ type: 'glaze:gpa', key, patch: { c: 3, l: 0 } })).ok, true, 'defaults take a choice away');
  assert.deepEqual(w.sync.gpaCourses, { [key]: { s: 'A 93, B 83' } });
  assert.deepEqual(await w.send({ type: 'glaze:gpa', key, patch: { c: 99 } }), { ok: false, error: 'bad' });
  // features/grades.js writes no whole gpaCourses of its own any more.
  assert.doesNotMatch(read('features/grades.js'), /storage\.sync\.set\(\{\s*gpaCourses/);
  assert.doesNotMatch(read('features/syllabus.js'), /gpaCourses:/);
});

// ---- features/syllabus.js on a stand-in page ----
class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, style: {}, open: false, parentNode: null, on: {}, files: [], text: '' }); }
  append(...k) { for (const c of k) if (c && typeof c === 'object') { c.parentNode = this; this.children.push(c); } }
  prepend(...k) { this.append(...k); }
  before() {}
  replaceChildren(...k) { this.children = []; this.append(...k); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); this.parentNode = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
  fire(type, isTrusted = true) { for (const f of this.on[type] || []) f({ type, isTrusted, preventDefault() {} }); }
  get all() { return [this, ...this.children.flatMap((c) => c.all)]; }
  focus() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  contains() { return false; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  get textContent() { return this.text; }
  set textContent(v) { this.text = String(v); }
}
// extra: more of the page's globals (a stand-in features/import.js, say).
const page = (extra = {}) => {
  const body = new El('body');
  const state = { settings: { enabled: true, enhance: { syllabus: true } }, on: true, cid: '25' };
  const held = [];
  const open = { now: false };
  const ctx = vm.createContext({
    Intl, Date, JSON, Promise, Math, Number, String, Object, Array, Error, File, AbortController,
    document: { body, activeElement: null, createElement: (t) => new El(t), getElementById: () => null, querySelector: () => null },
    location: { origin: ORIGIN, pathname: '/courses/25/modules' },
    chrome: undefined,
    GZ_I18N: require('../lib/i18n.js'),
    GZ_CTX: {
      t: (k) => k, locale: () => 'en', settings: () => state.settings, on: () => state.on, canvasCourseId: () => state.cid,
      profile: () => Promise.resolve({ id: 3 }), canvasCourses: () => Promise.resolve([{ id: '25' }]),
      // The code asked for arrives when the test lets it.
      need: (file, ready) => {
        if (ready()) return Promise.resolve();
        const load = (res) => { vm.runInContext(read(file), ctx); res(); };
        return new Promise((res) => (open.now ? load(res) : held.push(() => load(res))));
      },
    },
    ...extra,
  });
  vm.runInContext(read('features/syllabus.js'), ctx);
  // Lets what's held through, and everything asked for after it.
  return { UI: ctx.GZ_SYL_UI, body, state, ctx, release: () => { open.now = true; while (held.length) held.shift()(); } };
};

test('the dialog doesn\'t open when the feature was turned off while its code was on its way', async () => {
  for (const change of [(s) => { s.settings = { enabled: true, enhance: { syllabus: false } }; }, (s) => { s.on = false; }, (s) => { s.cid = '26'; }]) {
    const p = page();
    const opening = p.UI.open();
    await settle();
    change(p.state);
    p.release();
    await opening;
    await settle();
    assert.equal(p.body.children.length, 0, 'no dialog');
  }
  // And with nothing changed, it opens.
  const p = page();
  const opening = p.UI.open();
  await settle();
  p.release();
  await opening;
  assert.equal(p.body.children[0]?.tagName, 'DIALOG');
  assert.equal(p.body.children[0].open, true);
});

test('a second Read it calls the first read off, Stop reading calls off the newest, and only a read still wanted is reviewed', async () => {
  // features/import.js held: each read waits until the test answers it.
  const reads = [];
  const p = page({ GZ_IMPORT: { read: (file, opts) => new Promise((resolve) => reads.push({ opts, resolve })), note: () => '', doubt: () => false } });
  const opening = p.UI.open();
  await settle();
  p.release();
  await opening;
  await settle();
  let reviewed = 0;
  const extract = p.ctx.GZ_SYLLABUS.extract;
  p.ctx.GZ_SYLLABUS.extract = (...a) => { reviewed++; return extract(...a); };
  const dlg = p.body.children[0];
  const button = (text) => dlg.all.find((e) => e.tagName === 'BUTTON' && e.text === text);
  dlg.all.find((e) => e.id === 'gz-syl-file').files = [{ name: 'syllabus.pdf' }];
  button('Read it').fire('click');
  await settle();
  button('Read it').fire('click');
  await settle();
  assert.equal(reads.length, 2);
  assert.equal(reads[0].opts.signal.aborted, true, 'the first read stops when the second starts');
  button('Stop reading').fire('click');
  assert.equal(reads[1].opts.signal.aborted, true, 'Stop reading stops the newest');
  for (const r of reads) r.resolve({ text: 'Instructor: Dr. Amara Okafor', ocr: null });
  await settle();
  assert.equal(reviewed, 0, 'neither read that was called off reaches the review');
  button('Read it').fire('click');
  await settle();
  reads[2].resolve({ text: 'Instructor: Dr. Amara Okafor', ocr: null });
  await settle();
  assert.equal(reviewed, 1, 'a read left alone does');
});

test('a file is read only on the student\'s own click of Read it, never a script\'s', async () => {
  const reads = [];
  const p = page({ GZ_IMPORT: { read: (file, opts) => { reads.push(opts); return new Promise(() => {}); }, note: () => '', doubt: () => false } });
  const opening = p.UI.open();
  await settle();
  p.release();
  await opening;
  await settle();
  const dlg = p.body.children[0];
  const button = (text) => dlg.all.find((e) => e.tagName === 'BUTTON' && e.text === text);
  dlg.all.find((e) => e.id === 'gz-syl-file').files = [{ name: 'made-by-the-page.pdf' }];
  button('Read it').fire('click', false);
  await settle();
  assert.equal(reads.length, 0, 'a script\'s click reads nothing');
  button('Read it').fire('click');
  await settle();
  assert.equal(reads.length, 1, 'the student\'s click reads it');
});

// ACA-7: the date reader is told a term start only when the course has one; "now" is not a start (lib/syllabus.js extract).
test('a course with no term dates gives the date reader no start, one with a term gives its start', async () => {
  const startsFor = async (course) => {
    const p = page({ GZ_IMPORT: { read: async () => ({ text: 'Exam 1: September 1', ocr: null }), note: () => '', doubt: () => false } });
    p.ctx.GZ_CTX.canvasCourses = () => Promise.resolve([course]);
    const opening = p.UI.open();
    await settle();
    p.release();
    await opening;
    await settle();
    const seen = [];
    const extract = p.ctx.GZ_SYLLABUS.extract;
    p.ctx.GZ_SYLLABUS.extract = (text, opts) => { seen.push(opts); return extract(text, opts); };
    const dlg = p.body.children[0];
    dlg.all.find((e) => e.id === 'gz-syl-file').files = [{ name: 'syllabus.pdf' }];
    dlg.all.find((e) => e.tagName === 'BUTTON' && e.text === 'Read it').fire('click');
    await settle();
    assert.equal(seen.length, 1);
    return seen[0].start;
  };
  assert.equal(await startsFor({ id: '25' }), undefined, 'no term: no start');
  assert.equal(await startsFor({ id: '25', term: { name: 'Default Term', start_at: null } }), undefined, 'a term without dates: no start');
  assert.equal(await startsFor({ id: '25', term: { start_at: '2026-08-24T00:00:00Z' } }), Date.UTC(2026, 7, 24), 'the term\'s start');
  assert.equal(await startsFor({ id: '25', start_at: '2026-01-19T00:00:00Z', term: { start_at: null } }), Date.UTC(2026, 0, 19), 'the course\'s own start');
});
