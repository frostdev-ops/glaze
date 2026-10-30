// A signature kept for next time (lib/pdf-sign.js): its outlines only, quantized and deflated (encode, decode), at most
// KEEP of them, newest first (keep). Signing a page is scripts/pdf-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/pdf-sign.js');

const drawn = { outlines: [[10.5, 20.25, 30, 40.125, 55.5, 41], [100, 100, 101.75, 99.5]], areContours: false, thickness: 3, width: 400, height: 150 };

test('encode then decode gives the outlines back, to an eighth of a unit', async () => {
  const s = await S.encode(drawn), d = await S.decode(s);
  assert.equal(typeof s, 'string');
  assert.match(s, /^[A-Za-z0-9+/]+=*$/);
  assert.equal(d.areContours, false);
  assert.equal(d.thickness, 3);
  assert.equal(d.width, 400);
  assert.equal(d.height, 150);
  assert.equal(d.outlines.length, 2);
  d.outlines.forEach((pts, k) => { assert.ok(pts instanceof Float32Array); assert.equal(pts.length, drawn.outlines[k].length); pts.forEach((v, i) => assert.ok(Math.abs(v - drawn.outlines[k][i]) <= 1 / 16, `${k}:${i}`)); });
  const contour = await S.decode(await S.encode({ ...drawn, areContours: true, thickness: 0 }));
  assert.equal(contour.areContours, true);
  assert.equal(contour.thickness, 0);
});

test('a long drawn signature stays small: smaller than its points as JSON, far under MAX', async () => {
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const outlines = Array.from({ length: 12 }, () => { const pts = []; let x = 50, y = 75; for (let i = 0; i < 300; i++) { x += rnd() * 4 - 2; y += rnd() * 4 - 2; pts.push(x, y); } return pts; });
  const s = await S.encode({ outlines, areContours: false, thickness: 3, width: 400, height: 150 });
  assert.ok(s.length < JSON.stringify(outlines).length / 3, `${s.length} chars`);
  assert.ok(s.length < S.MAX);
  assert.equal((await S.decode(s)).outlines.length, 12);
});

test('anything else decodes to null; bad input does not encode', async () => {
  for (const x of [null, '', 'not base64!', btoa('plain bytes'), 'A'.repeat(S.MAX + 4)]) assert.equal(await S.decode(x), null, String(x).slice(0, 20));
  const good = await S.encode(drawn), bytes = Buffer.from(good, 'base64');
  assert.equal(await S.decode(bytes.subarray(0, bytes.length - 3).toString('base64')), null, 'cut short');
  await assert.rejects(S.encode({ ...drawn, outlines: [] }), RangeError);
  await assert.rejects(S.encode({ ...drawn, outlines: [[1, 2, 3]] }), RangeError);
  await assert.rejects(S.encode({ ...drawn, width: 0 }), RangeError);
  await assert.rejects(S.encode({ ...drawn, outlines: [[1, NaN]] }), RangeError);
});

test('keep: newest first, at most five, only the outline and its name (no picture)', () => {
  let list = [];
  for (let i = 0; i < 7; i++) list = S.keep(list, { id: `s${i}`, at: i, name: `N${i}`, kind: 'draw', data: 'AAAA', bitmap: 'data:image/png;base64,xx', picture: [1] });
  assert.equal(S.KEEP, 5);
  assert.deepEqual(list.map((x) => x.id), ['s6', 's5', 's4', 's3', 's2']);
  assert.deepEqual(Object.keys(list[0]).sort(), ['at', 'data', 'id', 'kind', 'name']);
  assert.deepEqual(S.keep(list, { id: 's4', at: 9, name: 'again', kind: 'name', data: 'BBBB' }).map((x) => x.id), ['s4', 's6', 's5', 's3', 's2'], 'the same one again moves to the front');
});

const UI = require('./helpers/pdf-ui.cjs');
const signUI = (t) => {
  const document = UI.install(t);
  const originalChrome = global.chrome;
  global.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  t.after(() => { if (originalChrome === undefined) delete global.chrome; else global.chrome = originalChrome; });
  let removed = 0, inserted = 0, ended = 0;
  const editor = { remove: () => removed++, getFromImage: () => ({ newCurves: drawn.outlines, ...drawn }), addSignature: () => inserted++ };
  const manager = S.manager({ P: {}, t: (s) => s, h: UI.h, btn: UI.btn, done: () => ended++ });
  manager.getSignature({ editor });
  return { manager, dialog: document.body.children[0], counts: () => ({ removed, inserted, ended }) };
};
test('cancelling a signature clears busy and removes the empty editor before a leave flush', async (t) => {
  const { manager, dialog, counts } = signUI(t);
  // Native HTMLDialogElement queues its close event; navigation must not depend on that later event.
  dialog.close = () => { dialog.open = false; setImmediate(() => dialog.dispatchEvent(new Event('close'))); };
  manager.cancel();
  assert.equal(manager.busy(), false, 'the leave flush must be allowed immediately');
  assert.deepEqual(counts(), { removed: 1, inserted: 0, ended: 1 });
  await UI.tick();
  assert.deepEqual(counts(), { removed: 1, inserted: 0, ended: 1 }, 'the queued close is idempotent');
});
test('closing a signature releases the picture, including a decode delivered after closing', async (t) => {
  for (const late of [false, true]) {
    const { manager, dialog } = signUI(t), decoded = UI.deferred(); let closed = 0;
    const previous = global.createImageBitmap;
    global.createImageBitmap = () => decoded.promise;
    t.after(() => { if (previous === undefined) delete global.createImageBitmap; else global.createImageBitmap = previous; });
    const file = dialog.querySelector('.gq-sign-file');
    file.files = [{}]; file.value = 'signature.png';
    file.dispatchEvent(new Event('change'));
    if (!late) { decoded.resolve({ close: () => closed++ }); await UI.tick(); }
    manager.cancel();
    if (late) { decoded.resolve({ close: () => closed++ }); await UI.tick(); }
    assert.equal(closed, 1, `bitmap released (late=${late})`);
    assert.equal(file.value, '', 'no selected picture remains');
  }
});
