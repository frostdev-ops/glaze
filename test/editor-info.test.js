// The "?" popover's placement (lib/editor-info.js): beside its button, on screen, never over it.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/editor-info.js');

const at = (top, bottom, left = 40) => ({ getBoundingClientRect: () => ({ top, bottom, left, right: left + 18 }) });
const pop = (w, h) => ({ offsetWidth: w, offsetHeight: h, style: {} });
const place = (button, p, vw = 390, vh = 844) => { Object.assign(globalThis, { innerWidth: vw, innerHeight: vh }); I.place(button, p); return p.style; };

test('below its "?" where there is room, above where only that has room', () => {
  assert.deepEqual(place(at(250, 268), pop(300, 200)), { left: '28px', top: '274px', maxHeight: '' });
  assert.deepEqual(place(at(700, 718), pop(300, 200)), { left: '28px', top: '494px', maxHeight: '' });
});

test('where neither side has room it takes the roomier one and scrolls within, never covering the "?"', () => {
  const s = place(at(300, 318), pop(300, 700));
  assert.equal(s.top, '324px'); assert.equal(s.maxHeight, `${844 - 8 - 318 - 6}px`);
  const t = place(at(600, 618), pop(300, 700));
  assert.equal(t.maxHeight, `${600 - 6 - 8}px`); assert.equal(t.top, '8px');
  assert.ok(parseFloat(t.top) + parseFloat(t.maxHeight) <= 600 - 6);
});

test('it never runs past the window\'s sides', () => {
  assert.equal(place(at(250, 268, 360), pop(352, 100)).left, `${390 - 352 - 8}px`);
  assert.equal(place(at(250, 268, 2), pop(200, 100)).left, '8px');
});
