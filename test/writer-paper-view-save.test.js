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

// The compact bar's line and the hold, as writer-paper.js has them (from the line's element to setView), over stand-ins.
const flushCtx = ({ save, project }) => {
  const messages = [], doc = {}, view = { props: { editable: () => true }, state: { doc }, setProps(o) { Object.assign(this.props, o); } };
  const el = (cls = '') => ({ inert: false, textContent: '', title: '', dataset: {}, children: [], classList: { contains: (c) => cls.split(' ').includes(c) }, toggleAttribute(n, on) { this[n] = on; }, focus() { this.focused = (this.focused || 0) + 1; }, getClientRects: () => [1] });
  const bar = el('gw-bar'), body = el(), full = el('gp-full');
  const ctx = vm.createContext({ view, compact: true, loaded: true, holding: false, switching: null, flushing: null, projecting: false,
    root: { inert: false }, boxEl: { children: [body, bar] }, host: { say: (m) => messages.push(m) }, save, project, setView() {}, queueMicrotask,
    h: () => el(), t: (k) => k, switches: [full] });
  vm.runInContext(`${source.slice(source.indexOf('    const said = boxEl ?'), start)}\nglobalThis.begin = flush; globalThis.end = resume; globalThis.line = () => said; globalThis.soon = projectSoon;`, ctx);
  bar.children = [ctx.line(), full];
  return { ctx, messages, view, body, bar, full, line: ctx.line() };
};
const PROJECTED = { html: '<p>Last edit.</p>', text: 'Last edit.', delta: [{ insert: 'Last edit.\n' }] };

test('compact flush: the save first, however long; the box held and the bar saying Saving… until the page answers', async () => {
  for (const early of [false, true]) {
    let release;
    const saved = new Promise((r) => { release = r; });
    const { ctx, messages, view, body, full, line } = flushCtx({ save: () => saved, project: () => PROJECTED });
    const pending = ctx.begin('request', 'submit');
    assert.equal(view.props.editable(), false);
    assert.equal(ctx.root.inert, true);
    assert.equal(body.inert && full.inert, true, 'the box and the bar\'s controls take no input');
    assert.equal(line.inert, false, 'the bar\'s line stays out of the hold, so it is read out');
    assert.equal(line.textContent, 'Saving…');
    assert.equal(messages.length, 0, 'no acknowledgement before the save');
    if (early) ctx.end('request'); // the page let go first (its frame went, or the view changed)
    release({}); await pending;
    if (early) assert.equal(messages.length, 0, 'a save the page no longer waits on never sends Ultra\'s button');
    else {
      assert.equal(messages[0].ok, true);
      assert.equal(view.props.editable(), false, 'editing remains held until the parent dispatches the click');
      ctx.end('request');
    }
    assert.equal(view.props.editable(), true);
    assert.equal(ctx.root.inert, false);
    assert.equal(body.inert || full.inert, false);
    assert.equal(line.textContent, '', 'Saving… goes once Ultra\'s button has gone');
  }
});

test('compact flush: why Ultra\'s button didn\'t go stays in the bar — not saved, too long (Full writer offered and focused), or the page\'s reason', async () => {
  const notSaved = flushCtx({ save: async () => null, project: () => PROJECTED });
  await notSaved.ctx.begin('a', 'submit');
  assert.deepEqual({ ...notSaved.messages[0] }, { type: 'compact:flushed', request: 'a', ok: false, reason: 'save' });
  assert.equal(notSaved.line.textContent, 'The paper could not be saved. Nothing was submitted.');
  assert.equal(notSaved.view.props.editable(), true, 'the box is the student\'s again at once');
  const close = flushCtx({ save: async () => null, project: () => PROJECTED });
  await close.ctx.begin('b', 'save');
  assert.equal(close.line.textContent, 'Not saved. Try again in a moment.', 'Save and Close says it in its own words');
  const long = flushCtx({ save: async () => ({}), project: () => null });
  await long.ctx.begin('c', 'submit');
  assert.deepEqual({ ...long.messages[0] }, { type: 'compact:flushed', request: 'c', ok: false, reason: 'long' });
  assert.equal(long.line.textContent, 'Too long for Ultra’s text box. Use Full writer.');
  assert.equal(long.full['data-offer'], true);
  assert.equal(long.full.focused, 1);
  const page = flushCtx({ save: async () => ({}), project: () => PROJECTED });
  await page.ctx.begin('d', 'submit');
  page.ctx.end('d', 'text');
  assert.equal(page.line.textContent, 'The text didn’t go into Ultra’s text box. Nothing was submitted.');
  // The next edit that fits clears it; a paper past the limit says so as it is typed, and nothing goes to Ultra's box.
  let fits = true;
  const typing = flushCtx({ save: async () => ({}), project: () => (fits ? PROJECTED : null) });
  typing.ctx.soon(); await new Promise(setImmediate);
  assert.equal(typing.messages.at(-1).type, 'change');
  fits = false;
  typing.ctx.soon(); await new Promise(setImmediate);
  assert.equal(typing.line.textContent, 'Too long for Ultra’s text box. Use Full writer.');
  assert.equal(typing.messages.length, 1, 'no change goes to Ultra past the limit');
  fits = true;
  typing.ctx.soon(); await new Promise(setImmediate);
  assert.equal(typing.line.textContent, '');
  assert.equal(typing.full['data-offer'], false);
});

test('a view preference already stored by another frame does not leave an unmatched own-change marker', async () => {
  let patches = 0;
  const ctx = vm.createContext({ boxEl: {}, compact: true, key: 'paper', loaded: true, switching: null, flushing: null,
    view: { hasFocus: () => false }, document: { activeElement: null }, caretY: () => null, mine: [],
    SET: { now: () => ({ full: true }), patch: () => { patches++; return Promise.resolve(); } } });
  const prefix = source.slice(start, source.indexOf('      if (focus) setFocus(false);', start));
  vm.runInContext(prefix + '\n}; globalThis.run = () => setView(true, { save: true });', ctx);
  await ctx.run();
  assert.equal(patches, 0);
  assert.equal(ctx.mine.length, 0);
});
