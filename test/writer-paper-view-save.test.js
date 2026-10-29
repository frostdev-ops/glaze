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
      view, root: { inert: false }, document: { activeElement: null }, caretY: () => 20, SET: { patch() { throw Error('preference changed before the save'); }, now: () => ({ full: true }) },
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
