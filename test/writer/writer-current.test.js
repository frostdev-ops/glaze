const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = () => fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/frame/writer-current.js'), 'utf8');
const setup = (kind = 'assignment', options = {}) => {
  const events = {}, messages = [], parent = [], hooks = {}, listeners = {};
  let key = 'school.test|_2_1|_7_1|_21_1';
  let mode = options.mode || 'paper', frameContext = options.context || {};
  const doc = (text) => ({ textContent: text, content: { size: text.length }, textBetween: (from, to) => text.slice(from, to) });
  const editor = { view: { state: { doc: doc('Draft body'), selection: { from: 0, to: 5 } } } };
  const port = { onMessage: { addListener: (f) => { port.answer = f; } }, onDisconnect: { addListener() {} }, postMessage: (m) => messages.push(m), disconnect() {} };
  const context = vm.createContext({ crypto: require('node:crypto').webcrypto, document: { visibilityState: 'visible', hasFocus: () => true, addEventListener: (e, f) => { listeners[e] = f; } },
    addEventListener: (e, f) => { events[e] = f; },
    chrome: { runtime: { connect: ({ name }) => { assert.equal(name, 'glaze:ask-writer'); return port; }, onMessage: { addListener() {} }, id: 'glaze' } },
    GZ_WRITER_FRAME: { on: (e, f) => { hooks[e] = f; }, say: (m) => parent.push(m), kind: () => kind, mode: () => mode, context: () => frameContext, editor: () => editor },
    GZ_WRITER_PAPER: { current: () => options.noPaper ? null : ({ key: () => key, kind: () => 'paper', paper: () => ({ title: 'Title' }) }) } });
  vm.runInContext(source(), context);
  hooks.ready(editor, { askOwner: Object.hasOwn(options, 'owner') ? options.owner : 'https://school.test/_2_1' });
  return { context, port, parent, messages, events, hooks, editor, listeners, setKey: (v) => { key = v; }, setKind: (v) => { kind = v; hooks.context(); }, setMode: (v) => { mode = v; hooks.context(); }, setContext: (v) => { frameContext = v; hooks.context(); }, update: () => { editor.view.state.doc = doc('Changed body'); hooks.change(); } };
};

test('compose drafts use exact editor bindings and their original owner without a persistent document key', () => {
  for (const kind of ['post', 'reply', 'message', 'journal']) {
    const p = setup(kind, { mode: 'compose', noPaper: true });
    const b = p.parent.at(-1);
    assert.ok(b?.token, kind);
    p.port.answer({ id: 1, op: 'current', token: b.token, revision: b.revision });
    const value = p.messages.at(-1).value;
    assert.equal(value.key, null); assert.equal(value.kind, kind); assert.equal(value.mode, 'compose');
    assert.equal(value.owner, 'https://school.test/_2_1'); assert.equal(value.id, undefined);
    assert.match(value.text, /Selected text:\nDraft\n\nDraft:\nDraft body/);
    p.setContext({ askOwner: 'https://school.test/_99_1' });
    p.port.answer({ id: 2, op: 'current', token: b.token, revision: b.revision });
    assert.equal(p.messages.at(-1).value.owner, 'https://school.test/_2_1', 'context updates cannot reassign the original editor owner');
  }
});

test('missing owner, unknown kinds and test evidence exclude compose material', () => {
  for (const kind of ['test', 'unknown', 'comment', 'assignment']) {
    const p = setup(kind, { mode: 'compose', noPaper: true });
    assert.ok(!p.parent.some((m) => m.token), kind);
  }
  for (const owner of [null, '', 'invalid']) {
    const p = setup('post', { mode: 'compose', noPaper: true, owner });
    assert.ok(!p.parent.some((m) => m.token));
  }
  const p = setup('reply', { mode: 'compose', noPaper: true });
  const b = p.parent.at(-1);
  p.setContext({ kind: 'test' });
  p.port.answer({ id: 1, op: 'current', token: b.token, revision: b.revision });
  assert.equal(p.messages.at(-1).value, undefined);
});

test('compose reply targets and kind transitions revoke the earlier revision even without text changes', () => {
  const p = setup('reply', { mode: 'compose', noPaper: true, context: { post: { id: '_10_1' } } });
  const first = p.parent.at(-1);
  assert.ok(first?.token);
  p.setContext({ post: { id: '_11_1' } });
  p.port.answer({ id: 1, op: 'current', token: first.token, revision: first.revision });
  assert.equal(p.messages.at(-1).value, undefined);
  const second = p.parent.at(-1);
  p.setKind('journal');
  p.port.answer({ id: 2, op: 'current', token: second.token, revision: second.revision });
  assert.equal(p.messages.at(-1).value, undefined);
});

test('refreshed compose reply targets revoke a binding when only replyTo changes', () => {
  const { contextOf } = require('../../extension/writer/writer-context-discussion.js');
  const context = (id) => contextOf({ kind: 'reply', school: 'school.test', item: '_21_1', course: { id: '_7_1' }, replyTo: { id, text: 'The post being answered' } });
  const p = setup('reply', { mode: 'compose', noPaper: true, context: context('_10_1') });
  const b = p.parent.at(-1);
  assert.ok(b?.token);
  p.setContext(context('_11_1'));
  p.port.answer({ id: 1, op: 'current', token: b.token, revision: b.revision });
  assert.equal(p.messages.at(-1).value, undefined, 'a changed replyTo target cannot supply the earlier pinned draft');
  const fresh = p.parent.at(-1);
  assert.ok(fresh.revision > b.revision);
  p.port.answer({ id: 2, op: 'current', token: fresh.token, revision: fresh.revision });
  assert.equal(p.messages.at(-1).value.context.replyTo.id, '_11_1');
});

test('the parent captures one bounded account owner at box creation and transmits it only on private init', async () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/page/writer.js'), 'utf8');
  const start = source.indexOf('  const askOwnerOf ='), end = source.indexOf('  const paperOf =', start);
  assert.ok(start > 0 && end > start);
  let calls = 0, account = '_2_1';
  const context = vm.createContext({ X: { account: () => { calls++; return Promise.resolve(account); } }, location: { origin: 'https://school.test' }, setTimeout, clearTimeout });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.owner = askOwnerOf;', context);
  assert.equal(await context.owner(), 'https://school.test/_2_1'); assert.equal(calls, 1);
  account = 'unknown'; assert.equal(await context.owner(), null);
  assert.match(source, /askOwner: box\.askOwner/);
  assert.match(source, /box\.askOwner = await owner/);
  assert.equal((source.match(/askOwnerOf\(\)/g) || []).length, 1, 'the owner is acquired only while mounting the box');
});
test('dedicated Ask binding is read-only, independent of MCP settings, and contains bounded editor material', () => {
  const p = setup();
  const binding = p.parent.at(-1);
  assert.equal(binding.type, 'ask:binding');
  p.port.answer({ id: 1, op: 'current', token: binding.token, revision: binding.revision });
  const reply = p.messages.at(-1).value;
  assert.equal(reply.key, 'school.test|_2_1|_7_1|_21_1');
  assert.match(reply.text, /Selected text:\nDraft/); assert.match(reply.text, /Draft:\nDraft body/);
  assert.equal(reply.truncated, false);
  assert.equal(reply.title, 'Title');
  p.port.answer({ id: 2, op: 'insert', token: binding.token, revision: binding.revision });
  assert.equal(p.messages.at(-1).value, undefined);
});
test('old revision, replaced key, and test editors cannot be read by an old binding', () => {
  const p = setup(), binding = p.parent.at(-1);
  p.update();
  p.port.answer({ id: 1, op: 'current', token: binding.token, revision: binding.revision });
  assert.equal(p.messages.at(-1).value, undefined);
  const fresh = p.parent.at(-1);
  p.setKey('school.test|_2_1|_8_1|_22_1');
  p.port.answer({ id: 2, op: 'current', token: fresh.token, revision: fresh.revision });
  assert.equal(p.messages.at(-1).value, undefined);
  const restricted = setup('test');
  assert.equal(restricted.parent.length, 0);
});

test('draft and selection reads are bounded before extracting text', () => {
  const p = setup(), reads = [];
  p.editor.view.state.doc = {
    content: { size: 1000000 },
    get textContent() { assert.fail('must not materialize the whole draft'); },
    textBetween(from, to, separator) { reads.push([from, to]); assert.ok(to - from <= 3073); assert.equal(separator, '\n'); return 'x'.repeat(to - from); },
  };
  p.editor.view.state.selection = { from: 500000, to: 999999 };
  p.hooks.change();
  const b = p.parent.at(-1);
  p.port.answer({ id: 1, op: 'current', token: b.token, revision: b.revision });
  assert.ok(reads.some(([from]) => from === 500000), 'selection is read from its actual position');
  assert.ok(reads.some(([from]) => from === 0), 'draft has its own bounded read');
  assert.equal(p.messages.at(-1)?.value?.truncated, true);
  assert.ok(p.messages.at(-1).value.text.length <= 3072);
});

test('an ineligible document cannot restore an earlier revision when it becomes eligible again', () => {
  const p = setup(), b = p.parent.at(-1);
  p.setKind('test');
  assert.equal(p.parent.at(-1).token, null);
  p.setKind('assignment');
  p.port.answer({ id: 1, op: 'current', token: b.token, revision: b.revision });
  assert.equal(p.messages.at(-1).value, undefined);
  assert.ok(p.parent.at(-1).revision > b.revision);
});

test('switching to a non-paper surface and back revokes the old document pin', async () => {
  const p = setup(), api = p.context.GZ_WRITER_PAPER.current();
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/frame/writer-paper.js'), 'utf8');
  Object.assign(p.context, { api, clearTimeout, GZ_WRITER_KINDS: { mount: async () => ({ kind: () => 'pdf' }) } });
  vm.runInContext('let current = api, parked = null, saveTimer = null, key = api.key(), host = {}; GZ_WRITER_PAPER.current = () => current;\n' +
    source.slice(source.indexOf('    const kindOfRec ='), source.indexOf('    const api =')) + '\nglobalThis.hand = hand;', p.context);
  const b = p.parent.at(-1);
  await p.context.hand({ kind: 'pdf' });
  assert.equal(p.parent.at(-1).token, null, 'the paper binding is revoked as the PDF takes over');
  const unpark = /unpark: (\(\) => \{[^}]+\})/.exec(source)[1];
  vm.runInContext('(' + unpark + ')();', p.context);
  p.port.answer({ id: 1, op: 'current', token: b.token, revision: b.revision });
  assert.equal(p.messages.at(-1).value, undefined);
  assert.ok(p.parent.at(-1).revision > b.revision);
});

const parentSetup = () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/page/writer.js'), 'utf8');
  const start = source.indexOf('  let activeCurrent'), end = source.indexOf('  const declined', start);
  const hearStart = source.indexOf("    if (m.type === 'ask:binding')"), hearEnd = source.indexOf("    if (m.type === 'ready'", hearStart);
  const listeners = {}, document = { activeElement: null, addEventListener: (e, f) => { listeners[e] = f; } };
  const context = vm.createContext({ document, boxes: new Map(), sameBox: (b) => b.live });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.capture = {current,pinCurrent,hear: (box,m) => {' + source.slice(hearStart, hearEnd) + '}};', context);
  const box = { editor: {}, frame: { isConnected: true }, live: true };
  context.boxes.set(box.editor, box); document.activeElement = box.frame;
  context.capture.hear(box, { type: 'ask:binding', token: 'a'.repeat(32), revision: 1, focused: true });
  return { context, box, document, listeners, capture: context.capture };
};

test('an unready or ambiguous focused Writer never falls back to a previous document', () => {
  for (const ambiguous of [false, true]) {
    const p = parentSetup();
    assert.equal(p.capture.pinCurrent().revision, 1);
    const other = { editor: {}, frame: ambiguous ? p.box.frame : { isConnected: true }, live: true };
    p.context.boxes.set(other.editor, other);
    p.document.activeElement = other.frame;
    assert.equal(p.capture.pinCurrent(), null);
    assert.equal(p.capture.current(), null);
  }
});

test('a binding delivered before frame focus is retained when Ask takes focus', () => {
  const p = parentSetup();
  p.listeners.focusin({ isTrusted: true, target: { closest: () => null } });
  assert.equal(p.capture.pinCurrent().revision, 1, 'direct frame focus establishes a pin');
  p.document.activeElement = {};
  assert.equal(p.capture.pinCurrent()?.revision, 1, 'Ask focus retains that exact pin');
});

test('focus in an ineligible frame clears the preceding active document before Ask focus', () => {
  const p = parentSetup();
  p.capture.pinCurrent();
  const other = { editor: {}, frame: { isConnected: true }, live: true };
  p.context.boxes.set(other.editor, other); p.document.activeElement = other.frame;
  p.capture.hear(other, { type: 'ask:binding', token: null });
  p.document.activeElement = {};
  assert.equal(p.capture.pinCurrent(), null);
});

test('a recovered frame has no binding until its own document announces one', () => {
  const p = parentSetup();
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/page/writer.js'), 'utf8');
  Object.assign(p.context, { endFlush() {}, focusMode() {}, clearTimeout });
  p.box.frame.remove = () => {};
  vm.runInContext(source.slice(source.indexOf('  const retire ='), source.indexOf('  const reopen =')) + '\nglobalThis.retire = retire;', p.context);
  p.capture.pinCurrent(); p.context.retire(p.box);
  p.box.frame = { isConnected: true }; p.document.activeElement = p.box.frame;
  assert.equal(p.capture.pinCurrent(), null);
});

test('parent pins one exact frame and revision, omitting replacements and ambiguous focus', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/page/writer.js'), 'utf8');
  const start = source.indexOf('  let activeCurrent'), end = source.indexOf('  const declined', start);
  assert.ok(start > 0 && end > start);
  const listeners = {}, document = { activeElement: null, addEventListener: (e, f) => { listeners[e] = f; } };
  const context = vm.createContext({ document, boxes: new Map(), sameBox: (b) => b.live });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.capture = {current,pinCurrent};', context);
  const box = { editor: {}, frame: { isConnected: true }, live: true, askBinding: { token: 'a'.repeat(32), revision: 1 } };
  context.boxes.set(box.editor, box); document.activeElement = box.frame;
  assert.equal(context.capture.pinCurrent().revision, 1);
  document.activeElement = {}; box.askBinding.revision = 2;
  assert.equal(context.capture.current(), null, 'background changes invalidate the old pin');
  assert.equal(context.capture.pinCurrent(), null, 'Ask focus cannot rank and repin a changed document');
  document.activeElement = box.frame; context.capture.pinCurrent();
  box.frame = { isConnected: true };
  assert.equal(context.capture.current(), null, 'same box with new frame is a different binding');
  document.activeElement = box.frame; context.capture.pinCurrent();
  listeners.focusin({ isTrusted: true, target: { closest: () => null } });
  assert.equal(context.capture.current(), null, 'moving to another editor clears the active document');
});
