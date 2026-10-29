const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.env.WRITER_PAPER_SOURCE || require.resolve('../writer-paper.js'), 'utf8');
const start = source.indexOf('    const setView = async '), end = source.indexOf('    // Settings → Writer → Full writer changed', start);
const code = source.slice(start, end);

test('full → compact refuses to project when the paper or its view version cannot be saved', async () => {
  for (const fail of [1, 2]) {
    let calls = 0, projected = false;
    const view = { props: { editable: () => true }, hasFocus: () => true, setProps(o) { Object.assign(this.props, o); }, focus() {} };
    const ctx = vm.createContext({ boxEl: {}, compact: false, key: 'paper', loaded: true, switching: null, flushing: null, holding: false, dirty: true,
      view, mine: [], root: { inert: false }, document: { activeElement: null }, caretY: () => 20, SET: { patch() { throw Error('preference changed before the save'); }, now: () => ({ full: true }) },
      save: async () => { calls++; return calls === fail ? null : {}; }, projectSoon: () => { projected = true; } });
    vm.runInContext(code + '\nglobalThis.run = () => setView(false, { save: true });', ctx);
    await ctx.run();
    assert.equal(ctx.compact, false);
    assert.equal(projected, false);
    assert.equal(ctx.root.inert, false);
    assert.equal(view.props.editable(), true);
    assert.equal(calls, fail);
  }
});

test('compact flush saves before acknowledging and holds editing through the native click; a timeout ignores late saves', async () => {
  for (const timeout of [false, true]) {
    const messages = [], doc = {}, view = { props: { editable: () => true }, state: { doc }, setProps(o) { Object.assign(this.props, o); } };
    let release;
    const saved = new Promise((r) => { release = r; });
    const ctx = vm.createContext({ view, compact: true, loaded: true, holding: false, switching: null, flushing: null,
      root: { inert: false }, boxEl: { inert: false }, host: { say: (m) => messages.push(m) }, save: () => saved,
      project: () => ({ html: '<p>Last edit.</p>', text: 'Last edit.', delta: [{ insert: 'Last edit.\n' }] }), setView() {} });
    vm.runInContext(source.slice(source.indexOf('    const resume = (request)'), start) + '\nglobalThis.begin = flush; globalThis.end = resume;', ctx);
    const pending = ctx.begin('request');
    assert.equal(view.props.editable(), false);
    assert.equal(ctx.root.inert, true);
    assert.equal(messages.length, 0, 'no acknowledgement before the save');
    if (timeout) ctx.end('request');
    release({}); await pending;
    if (timeout) assert.equal(messages.length, 0, 'timed-out saves cannot trigger a native click');
    else {
      assert.equal(messages[0].ok, true);
      assert.equal(view.props.editable(), false, 'editing remains held until the parent dispatches the click');
      ctx.end('request');
    }
    assert.equal(view.props.editable(), true);
    assert.equal(ctx.root.inert, false);
    assert.equal(ctx.boxEl.inert, false);
  }
});
