const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../lib/writer-sources.js'), C = require('../lib/writer-cite.js');
const W = require('../lib/writer-schema.js'), PM = globalThis.GZ_PM;
const source = (title) => ({ id: title.toLowerCase(), type: 'book', title });
const context = (item) => ({ school: 'https://school.edu', user: { id: 'u' }, course: { id: 'c' }, item });
const frame = (extra = {}, html = '<p>Body</p>', storage) => {
  const events = {}, writes = [], nodes = [], life = {};
  const element = () => { const n = { append() {}, setAttribute(k) { if (k === 'hidden') this.hidden = true; }, addEventListener() {}, removeAttribute() {} }; nodes.push(n); return n; };
  const view = { state: PM.state.EditorState.create({ doc: W.parse(W.compose, html) }), dispatch(tr) { this.state = this.state.apply(tr); } };
  const scope = vm.createContext({ console, setTimeout: () => 0, clearTimeout() {}, ResizeObserver: class { observe() {} }, addEventListener: (name, fn) => { const before = life[name]; life[name] = (event) => { before?.(event); fn(event); }; }, chrome: { storage }, document: { createElement: element, body: element(), getElementById: () => null, addEventListener() {} },
    GZ_PM: PM, GZ_WRITER_CITE: { ...C }, GZ_WRITER_LOOKUP: {}, GZ_WRITER_SOURCES: { ...S, save: async (key, list) => { writes.push([key, list]); }, ...extra },
    GZ_WRITER_FRAME: { on: (name, fn) => { events[name] = fn; }, slot: () => null, editor: () => ({ view }), mode: () => 'compose', t: (s) => s } });
  vm.runInContext(fs.readFileSync(process.env.WRITER_CITE_SOURCE || require.resolve('../writer-cite.js'), 'utf8'), scope);
  return { cite: scope.GZ_WRITER_CITE, events, writes, view, nodes, life };
};

test('review: an older source load cannot replace the new document or leak into an unscoped box', async () => {
  const pending = [];
  const f = frame({ load: (key) => new Promise((resolve) => pending.push({ key, resolve })) });
  const a = f.events.context(context('a')), b = f.events.context(context('b'));
  pending[1].resolve([source('Bravo')]); await b;
  pending[0].resolve([source('Alpha')]); await a;
  assert.equal(f.cite.sources()[0].title, 'Bravo');
  await f.events.context({});
  assert.equal(f.cite.sources().length, 0);
});

test('review: Add references preserves authored headings and prose and replaces only its own unchanged suffix', () => {
  const f = frame({}, '<p>Body</p><p>References</p><p>My own conclusion.</p>');
  f.cite.setSources([source('Book')]);
  f.cite.references();
  assert.equal(f.view.state.doc.textContent, 'BodyReferencesMy own conclusion.Works CitedBook.');
  f.cite.references();
  assert.equal(f.view.state.doc.textContent, 'BodyReferencesMy own conclusion.Works CitedBook.');
  f.view.dispatch(f.view.state.tr.insertText('More body', f.view.state.doc.content.size - 1));
  f.cite.references();
  assert.ok(f.view.state.doc.textContent.includes('More body'));
});

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const shared = () => {
  const data = {}, listeners = new Set();
  const publish = (key, value) => { for (const fn of listeners) fn({ [key]: { newValue: structuredClone(value) } }, 'local'); };
  const local = { get: async (k) => ({ [k]: structuredClone(data[k]) }),
    set: async (v) => { Object.assign(data, structuredClone(v)); for (const k of Object.keys(v)) queueMicrotask(() => publish(k, data[k])); },
    remove: async (k) => { delete data[k]; queueMicrotask(() => publish(k)); } };
  const storage = { local, onChanged: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } };
  const io = { load: (k, _, opts) => S.load(k, local, opts), save: (k, v, _, meta) => S.save(k, v, local, meta) };
  return { data, listeners, storage, io, publish };
};

test('two open writers follow source additions, edits and removals before their next save', async () => {
  const bus = shared(), a = frame(bus.io, undefined, bus.storage), b = frame(bus.io, undefined, bus.storage);
  const paper = { school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' };
  await a.events.context({ paper });
  await b.events.context({ ...context('bb.school.test|_900_1|_101_1|_7_1'), paper });
  a.cite.setSources([source('Alpha')]); await flush();
  assert.equal(b.cite.sources()[0]?.title, 'Alpha');
  b.cite.setSources([...b.cite.sources(), source('Bravo')]); await flush();
  assert.deepEqual(a.cite.sources().map((s) => s.title), ['Alpha', 'Bravo']);
  a.cite.setSources(a.cite.sources().filter((s) => s.id !== 'alpha')); await flush();
  assert.deepEqual(b.cite.sources().map((s) => s.title), ['Bravo']);
  b.cite.setSources([{ ...b.cite.sources()[0], title: 'Reviewed' }]); await flush();
  assert.equal(a.cite.sources()[0].title, 'Reviewed');
  a.cite.setSources([]); await flush();
  assert.equal(b.cite.sources().length, 0);
  a.life.pagehide(); b.life.pagehide();
  assert.equal(bus.listeners.size, 0, 'closed frames detach their storage listeners');
  a.life.pageshow({ persisted: true }); await flush();
  assert.equal(bus.listeners.size, 1, 'a restored frame watches again');
});

test('queued saves and their storage echoes cannot replace a newer local source edit', async () => {
  const bus = shared(), pending = [];
  const f = frame({ ...bus.io, save: (...args) => new Promise((resolve) => pending.push(async () => resolve(await bus.io.save(...args)))) }, undefined, bus.storage);
  await f.events.context(context('essay'));
  f.cite.setSources([source('Alpha')]); await flush();
  f.cite.setSources([source('Bravo')]); await flush();
  assert.equal(pending.length, 1, 'one save at a time in this frame');
  await pending.shift()(); await flush();
  assert.equal(f.cite.sources()[0].title, 'Bravo', 'the earlier save echo cannot discard the later edit');
  assert.equal(pending.length, 1);
  await pending.shift()(); await flush();
  assert.equal(f.cite.sources()[0].title, 'Bravo');
  assert.equal(bus.data[S.keyOf(context('essay'))].sources[0].title, 'Bravo');
});

test('a refused source save stays in memory and reports failure until a successful retry', async () => {
  const bus = shared(); let fail = true;
  const f = frame({ ...bus.io, save: (...args) => fail ? Promise.resolve(false) : bus.io.save(...args) }, undefined, bus.storage);
  await f.events.context(context('essay'));
  f.cite.setSources([source('Alpha')]); await flush();
  const notice = f.nodes.find((n) => n.textContent === 'Sources could not be saved.');
  assert.equal(notice?.hidden, false);
  assert.equal(f.cite.sources()[0].title, 'Alpha');
  assert.equal(bus.data[S.keyOf(context('essay'))], undefined);
  fail = false; f.cite.setSources(f.cite.sources()); await flush();
  assert.equal(notice.hidden, true);
  assert.equal(bus.data[S.keyOf(context('essay'))].sources[0].title, 'Alpha');
});

test('a storage reload from an earlier paper never replaces the current sources', async () => {
  const bus = shared(), pending = [];
  const f = frame({ ...bus.io, load: (k) => new Promise((resolve) => pending.push({ k, resolve })) }, undefined, bus.storage);
  const first = f.events.context(context('a')); pending.shift().resolve([source('Alpha')]); await first;
  bus.publish(S.keyOf(context('a')), { sources: [source('Updated')] }); await flush();
  assert.equal(pending.length, 1, 'a storage change reloads this key');
  const old = pending.shift(), next = f.events.context(context('b'));
  pending.shift().resolve([source('Bravo')]); await next;
  old.resolve([source('Updated')]); await flush();
  assert.equal(f.cite.sources()[0].title, 'Bravo');
});
