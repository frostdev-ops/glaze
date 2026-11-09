const test = require('node:test'), assert = require('node:assert/strict');
const C = require('../../extension/settings/choices.js'), D = require('../../extension/content/defaults.js');

test('the settings shortcut leaves editable fields, composing text and handled keys alone', () => {
  const event = (extra = {}) => ({ key: '/', target: { closest: () => null }, ...extra });
  assert.equal(C.shortcut(event()), true);
  for (const flag of ['defaultPrevented', 'isComposing', 'ctrlKey', 'metaKey', 'altKey']) assert.equal(C.shortcut(event({ [flag]: true })), false, flag);
  assert.equal(C.shortcut(event({ key: 'a' })), false);
  let selector;
  assert.equal(C.shortcut(event({ target: { closest: (s) => { selector = s; return {}; } } })), false);
  assert.match(selector, /\binput\b/); assert.match(selector, /textarea/); assert.match(selector, /contenteditable/);
});

test('Frost restores the default theme while preserving personal preferences and unrelated data', () => {
  const s = D.GZ_SANITIZE({ auto: { on: true }, look: { tooltips: false, hints: false }, bg: { image: 'https://example.invalid/own.jpg' }, enhance: { notes: false } }, true);
  const changed = { ...s, ...D.GZ_LOOK_APPLY(s, D.GZ_LOOKS.find((L) => L.name === 'Synthwave')), auto: s.auto };
  const restored = { ...changed, ...C.theme(changed, C.OWN) };
  assert.equal(restored.look.font, D.GZ_DEFAULTS.look.font);
  assert.equal(restored.bg.kind, D.GZ_DEFAULTS.bg.kind);
  assert.equal(restored.look.tooltips, false); assert.equal(restored.look.hints, false);
  assert.equal(restored.bg.image, s.bg.image); assert.deepEqual(restored.auto, s.auto);
  assert.deepEqual(restored.enhance, s.enhance); assert.equal('auto' in C.theme(changed, C.OWN), false);
});

test('a disabled parent preserves a dependent preference for when it is enabled again', () => {
  const s = D.GZ_SANITIZE({ enhance: { palette: false, search: true, writer: false } });
  assert.equal(C.blocked(s, 'enhance.search'), true); assert.equal(C.blocked(s, 'writer.format'), true);
  assert.equal(s.enhance.search, true); assert.equal(s.writer.format, D.GZ_DEFAULTS.writer.format);
  s.enhance.palette = true; assert.equal(C.blocked(s, 'enhance.search'), false);
  assert.equal(C.blocked(s, 'enhance.notes'), false);
});

test('the settings shortcut still opens search from a switch, a choice or a button, but never from a field that takes text', () => {
  const at = (tagName, type) => C.shortcut({ key: '/', target: { closest: () => ({ tagName, type }) } });
  for (const type of ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'reset', 'file', 'image']) assert.equal(at('INPUT', type), true, type);
  for (const type of ['text', 'password', 'search', 'url', 'email', 'number', 'tel', 'date']) assert.equal(at('INPUT', type), false, type);
  for (const tag of ['TEXTAREA', 'SELECT', 'DIV']) assert.equal(at(tag), false, tag);
});
