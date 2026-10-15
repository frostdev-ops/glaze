const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const P = require('../lib/pet.js'), T = require('../lib/todo.js'), { El } = require('./stand-in-dom.js');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
const page = ({ delayed = false } = {}) => {
  const doc = { activeElement: null }, storage = [], events = [], timers = new Map(); let next = 0, release;
  const make = (tag) => new El(tag, doc);
  doc.root = make('html'); doc.head = make('head'); doc.body = make('body'); doc.root.append(doc.head, doc.body);
  Object.assign(doc, { visibilityState: 'visible', createElement: make, getElementById: (id) => doc.root.all().find((e) => e.id === id), querySelector: (sel) => doc.root.querySelector(sel),
    addEventListener: (type, f) => events.push({ type, f }), removeEventListener: (type, f) => { const i = events.findIndex((x) => x.type === type && x.f === f); if (i >= 0) events.splice(i, 1); } });
  const profile = delayed ? new Promise((res) => { release = res; }) : Promise.resolve({ uid: '3', tz: 'UTC' });
  const c = { document: doc, console, URL, Date, Intl, Map, Set, Object, Number, Math, Array, String, Promise,
    GZ_PET: P, GZ_TODO: T, GZ_CTX: { site: 'canvas', t: (k) => k, settings: () => ({ enabled: true, enhance: { pet: true } }), need: async () => {} },
    location: { origin: 'https://canvas.test' }, setTimeout: (f, ms) => { timers.set(++next, { f, ms }); return next; }, clearTimeout: (id) => timers.delete(id),
    chrome: { runtime: { getURL: (p) => `chrome-extension://x/${p}`, sendMessage: (m, cb) => cb({ ok: true, data: P.view({ earned: { 'work:assignment:1': 20 } }) }) },
      storage: { onChanged: { addListener: (f) => storage.push(f), removeListener: (f) => { const i = storage.indexOf(f); if (i >= 0) storage.splice(i, 1); } } } } };
  c.globalThis = c; vm.createContext(c);
  const ui = vm.runInContext(fs.readFileSync(require.resolve('../features/pet.js'), 'utf8'), c);
  const body = make('div'); doc.body.append(body);
  return { ui, body, doc, storage, events, timers, release: () => release({ uid: '3', tz: 'UTC' }), api: { who: () => profile } };
};
test('pet mount stops storage/visibility listeners and its clock, without leaving a stylesheet link', async () => {
  const p = page(), tile = p.ui.mount(p.body, p.api); await settle();
  assert.equal(p.storage.length, 1); assert.equal(p.events.length, 1); assert.equal(p.timers.size, 1);
  tile.stop();
  assert.equal(p.storage.length, 0); assert.equal(p.events.length, 0); assert.equal(p.timers.size, 0);
  assert.equal(p.doc.head.querySelectorAll('link').length, 0);
});
test('a pet removed before identity resolves never registers listeners or schedules a clock', async () => {
  const p = page({ delayed: true }), tile = p.ui.mount(p.body, p.api);
  tile.stop(); p.release(); await settle();
  assert.equal(p.storage.length, 0); assert.equal(p.events.length, 0); assert.equal(p.timers.size, 0);
});
