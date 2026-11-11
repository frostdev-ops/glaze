// The popup's status line is a live region that stays in the page: a screen reader says what appears in it, which it
// does not for a line that is display:none until it has text (audit 2026-11-11 A7 #10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ext = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const html = ext('popup.html');
const js = ext('settings/popup.js');

test('#hint is a polite status region and is never hidden', () => {
  const tag = html.match(/<p\b[^>]*\bid="hint"[^>]*>/)?.[0];
  assert.ok(tag, 'popup.html has #hint');
  assert.ok(/\brole="status"/.test(tag), 'role="status"');
  assert.ok(!/\bhidden\b/.test(tag), 'a region that starts display:none is not announced when it fills');
});

test('hint() sets the text and the error class, and never toggles hidden', () => {
  const line = js.match(/^const hint = .*$/m)?.[0];
  assert.ok(line, 'popup.js defines hint');
  const el = { textContent: '', classes: new Set(), classList: { toggle(c, on) { on ? el.classes.add(c) : el.classes.delete(c); } } };
  const hidden = [];
  Object.defineProperty(el, 'hidden', { get: () => false, set: (v) => hidden.push(v) });
  const hint = new Function('$', `${line}\nreturn hint;`)(() => el);
  hint('Not saved. Try again in a moment.');
  assert.equal(el.textContent, 'Not saved. Try again in a moment.');
  assert.ok(el.classes.has('err'));
  hint();
  assert.equal(el.textContent, '');
  assert.ok(!el.classes.has('err'));
  assert.deepEqual(hidden, []);
});

test('an empty status line takes no room', () => {
  assert.ok(/\.hint:empty\s*\{[^}]*margin:\s*0/.test(html), '.hint:empty { margin: 0 }');
});
