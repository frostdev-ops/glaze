const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Exercise the viewer's capture listener with a viewer target and a sibling control.
const source = fs.readFileSync(path.join(__dirname, '..', 'slides-kind.js'), 'utf8');
const start = source.indexOf("    addEventListener('keydown', (e) => {\n      if (e.defaultPrevented || presenting || menu || !deck) return;");
assert.ok(start >= 0);
const end = source.indexOf('}, { capture: true, signal });', start) + '}, { capture: true, signal });'.length;
const keys = () => {
  const inside = {}, outside = {}, calls = [];
  let listener;
  vm.runInNewContext(source.slice(start, end), { addEventListener: (type, fn) => { listener = fn; }, signal: undefined,
    presenting: null, menu: null, deck: {}, view: { contains: (target) => target === inside },
    q: { focus() {}, select() {} }, print: async () => { calls.push('print'); }, endPrint() {}, console });
  const press = (target, modifiers) => {
    let prevented = false;
    listener({ target, key: 'p', ...modifiers, preventDefault() { prevented = true; }, stopPropagation() {} });
    return prevented;
  };
  return { inside, outside, calls, press };
};

test('Ctrl/Cmd+P prints only while focus is inside the slides viewer', () => {
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    const k = keys();
    assert.equal(k.press(k.outside, modifiers), false, 'the page keeps its native print shortcut');
    assert.equal(k.calls.length, 0);
    assert.equal(k.press(k.inside, modifiers), true);
    assert.equal(k.calls.length, 1);
  }
});
