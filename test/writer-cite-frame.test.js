const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../lib/writer-sources.js'), C = require('../lib/writer-cite.js');
const W = require('../lib/writer-schema.js'), PM = globalThis.GZ_PM;
const source = (title) => ({ id: title.toLowerCase(), type: 'book', title });
const context = (item) => ({ school: 'https://school.edu', user: { id: 'u' }, course: { id: 'c' }, item });
const frame = (extra = {}, html = '<p>Body</p>') => {
  const events = {}, writes = [];
  const element = () => ({ append() {}, setAttribute() {}, addEventListener() {}, removeAttribute() {} });
  const view = { state: PM.state.EditorState.create({ doc: W.parse(W.compose, html) }), dispatch(tr) { this.state = this.state.apply(tr); } };
  const scope = vm.createContext({ console, setTimeout: () => 0, clearTimeout() {}, ResizeObserver: class { observe() {} }, addEventListener() {}, document: { createElement: element, body: element(), getElementById: () => null, addEventListener() {} },
    GZ_PM: PM, GZ_WRITER_CITE: { ...C }, GZ_WRITER_LOOKUP: {}, GZ_WRITER_SOURCES: { ...S, save: async (key, list) => { writes.push([key, list]); }, ...extra },
    GZ_WRITER_FRAME: { on: (name, fn) => { events[name] = fn; }, slot: () => null, editor: () => ({ view }), mode: () => 'compose', t: (s) => s } });
  vm.runInContext(fs.readFileSync(require.resolve('../writer-cite.js'), 'utf8'), scope);
  return { cite: scope.GZ_WRITER_CITE, events, writes, view };
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
