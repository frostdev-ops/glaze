const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

// Model tasks, fonts and simple blocks. No animation frame is provided: hidden tabs and reduced motion must still
// finish their slices. Each uncached block costs 13 ms, forcing a yield without depending on the test machine's speed.
const editor = ({ loading = false } = {}) => {
  let now = 0, seq = 0, pluginView;
  const micro = [], tasks = [], timers = new Map(), layouts = [];
  const empty = { find: () => [], remove() { return this; } };
  const nodes = Array.from({ length: 8 }, () => ({ isTextblock: true, type: { name: 'paragraph' }, attrs: {}, nodeSize: 3, forEach() {} }));
  const docOf = (all) => ({ content: { size: all.length * 3 }, forEach: (fn) => all.forEach((n, i) => fn(n, i * 3, i)), descendants() {} });
  const dom = { isConnected: true, getBoundingClientRect: () => ({ width: 100 }), addEventListener() {} };
  const stateOf = (doc, gaps = empty) => ({ doc, gaps, get tr() { return { gaps, setMeta(k, v) { if (typeof k !== 'string') this.gaps = v; return this; } }; } });
  const view = { dom, state: stateOf(docOf(nodes)), nodeDOM: () => null, dispatch(tr) { const prev = this.state; this.state = stateOf(prev.doc, tr.gaps); pluginView.update(this, prev); } };
  const fonts = { status: loading ? 'loading' : 'loaded', ready: new Promise(() => {}), addEventListener() {}, removeEventListener() {}, load: () => Promise.resolve() };
  const ctx = vm.createContext({
    document: { fonts, hidden: true }, getComputedStyle: () => ({ width: '100' }), matchMedia: () => ({ matches: true }),
    performance: { now: () => now }, queueMicrotask: (fn) => micro.push(fn),
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearTimeout: (id) => timers.delete(id),
    MessageChannel: class { constructor() { this.port1 = { close() {}, onmessage: null }; this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage?.()), close() {} }; } },
    GZ_WRITER_STYLES: { listAt: () => null, blockBox: () => { now += 13; return { line: 40, after: 0 }; }, geometry: () => ({ body: 100, height: 150 }), lineHeight: () => 20, stack: () => 'serif' },
    GZ_PM: { state: { Plugin: class { constructor(spec) { this.spec = spec; } }, PluginKey: class { getState(s) { return s.gaps; } } }, view: {
      Decoration: { widget: (from, _dom, spec) => ({ from, spec }) },
      DecorationSet: { empty, create: (_doc, ds) => ({ find: (_a, _b, fn) => ds.filter((d) => !fn || fn(d.spec)), remove: () => empty }) },
    } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/writer-paginate.js'), 'utf8'), ctx);
  pluginView = ctx.GZ_WRITER_PAGINATE.plugin({ format: () => ({ notes: { size: 10, line: 1 } }), onLayout: (l) => layouts.push(l) }).spec.view(view);
  const flush = async () => { await new Promise(setImmediate); for (let n = 0; micro.length; n++) { assert.ok(n < 100); micro.shift()(); } };
  const finish = async () => { await flush(); for (let n = 0; tasks.length; n++) { assert.ok(n < 100); tasks.shift()(); await flush(); } };
  return { view, layouts, nodes, timers, flush, finish, destroy: () => pluginView.destroy(), advance: (ms) => { now += ms; },
    edit: () => { const prev = view.state; view.state = stateOf(docOf([{}, ...nodes.slice(1)].map((n) => n.isTextblock ? n : { ...nodes[0] })), prev.gaps); pluginView.update(view, prev); } };
};

test('pagination slices finish without animation frames in a hidden tab with reduced motion', async () => {
  const e = editor(); await e.flush();
  assert.equal(e.view.dom.gzLaying, true);
  assert.equal(e.layouts[0].partial, true);
  await e.finish();
  assert.equal(e.view.dom.gzLaying, false);
  assert.equal(e.view.dom.gzLaid, e.view.state.doc);
  assert.equal(e.view.dom.gzMeasured, e.nodes.length);
  e.edit(); await e.finish();
  assert.equal(e.view.dom.gzMeasured, e.nodes.length + 1, 'unchanged blocks keep their measurements');
  e.destroy();
});

test('a font that never loads releases the gate after three seconds', async () => {
  const e = editor({ loading: true }); await e.flush();
  assert.equal(e.layouts.length, 0);
  assert.equal(e.view.dom.gzMeasured, undefined);
  e.advance(3001);
  for (const [id, t] of e.timers) { e.timers.delete(id); t.fn(); }
  await e.finish();
  assert.equal(e.view.dom.gzLaid, e.view.state.doc);
  assert.equal(e.view.dom.gzMeasured, e.nodes.length);
  e.destroy();
});

test('destroy cancels a pending pagination slice', async () => {
  const e = editor(); await e.flush();
  const measured = e.view.dom.gzMeasured;
  e.destroy(); await e.finish();
  assert.equal(e.view.dom.gzMeasured, measured);
  assert.equal(e.view.dom.gzLaying, false);
});
