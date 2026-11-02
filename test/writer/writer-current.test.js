const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = () => fs.readFileSync(require('node:path').join(__dirname, '../../extension/writer/frame/writer-current.js'), 'utf8');
const setup = (kind = 'assignment') => {
  const events = {}, messages = [], parent = [], hooks = {}, listeners = {};
  let text = 'Draft body', selected = 'Draft', key = 'school.test|_2_1|_7_1|_21_1';
  const editor = { view: { state: { doc: { textContent: text, textBetween: () => selected }, selection: { from: 0, to: 5 } } } };
  const port = { onMessage: { addListener: (f) => { port.answer = f; } }, onDisconnect: { addListener() {} }, postMessage: (m) => messages.push(m), disconnect() {} };
  const context = vm.createContext({ crypto: require('node:crypto').webcrypto, document: { visibilityState: 'visible', hasFocus: () => true, addEventListener: (e, f) => { listeners[e] = f; } },
    addEventListener: (e, f) => { events[e] = f; },
    chrome: { runtime: { connect: () => port, onMessage: { addListener() {} }, id: 'glaze' } },
    GZ_WRITER_FRAME: { on: (e, f) => { hooks[e] = f; }, say: (m) => parent.push(m), kind: () => kind, mode: () => 'paper', context: () => ({ kind, paper: { course: '_7_1' } }), editor: () => editor },
    GZ_WRITER_PAPER: { current: () => ({ key: () => key, kind: () => 'paper', paper: () => ({ title: 'Title' }) }) } });
  vm.runInContext(source(), context);
  hooks.ready();
  return { port, parent, messages, events, hooks, editor, listeners, setKey: (v) => { key = v; }, update: () => { editor.view.state.doc = { textContent: 'Changed body', textBetween: () => selected }; hooks.change(); } };
};
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
