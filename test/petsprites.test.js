const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../lib/petsprites.js'), P = require('../lib/pet.js');

test('both ChatGPT layouts validate without trusting metadata paths or versions', () => {
  assert.equal(S.meta({ name: '<img onerror=x>', spritesheet: 'https://bad.test/x' }, 1536, 1872).spriteVersionNumber, 1);
  assert.equal(S.meta({}, 1536, 2288).spriteVersionNumber, 2);
  assert.deepEqual(Object.keys(S.meta({ url: 'https://bad.test', script: 'bad' }, 1536, 2288)).sort(), ['description', 'name', 'spriteVersionNumber']);
  for (const args of [[{}, 1536, 208], [{ spriteVersionNumber: 3 }, 1536, 2288], [{ spriteVersionNumber: 1 }, 1536, 2288], [{}, 100000, 100000]]) assert.throws(() => S.meta(...args));
});
test('frame addressing respects each state count and clockwise gaze order', () => {
  for (const [row, state] of S.STATES.entries()) {
    assert.deepEqual(S.frame(state, 0), { x: 0, y: row * 208, width: 192, height: 208 });
    assert.equal(S.frame(state, S.COUNTS[row] * 125).x, 0);
    assert.equal(S.frame(state, (S.COUNTS[row] - 1) * 125).x, (S.COUNTS[row] - 1) * 192);
  }
  assert.deepEqual([S.direction(0, -1), S.direction(1, 0), S.direction(0, 1), S.direction(-1, 0)], [0, 4, 8, 12]);
  assert.equal(S.frame('look', 8).y, 2080); assert.equal(S.frame('look', 8, 1).y, 0);
});
test('every required frame must have pixels, unused cells must stay transparent', () => {
  const rgba = new Uint8ClampedArray(1536 * 2288 * 4);
  for (let row = 0; row < 11; row++) for (let frame = 0; frame < S.COUNTS[row]; frame++) rgba[((row * 208 + 10) * 1536 + frame * 192 + 10) * 4 + 3] = 255;
  assert.equal(S.pixels(rgba, 2), true);
  rgba[(10 * 1536 + 7 * 192 + 10) * 4 + 3] = 255;
  assert.throws(() => S.pixels(rgba, 2));
  rgba[(10 * 1536 + 7 * 192 + 10) * 4 + 3] = 0; rgba[(10 * 1536 + 10) * 4 + 3] = 0;
  assert.throws(() => S.pixels(rgba, 2));
});
test('imports refuse executable formats, enormous dimensions and capacity failures before changing storage', async () => {
  for (const data of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://bad.test/x', 'data:image/png;base64,@@@@', 'x'.repeat(S.MAX_IMAGE + 1)]) assert.throws(() => S.dataBytes(data));
  let writes = 0;
  const local = { get: async () => { throw Error('read failed'); }, set: async () => { writes++; return true; } };
  await assert.rejects(S.change({ op: 'delete', id: 'own:00000000-0000-0000-0000-000000000000' }, { local })); assert.equal(writes, 0);
  assert.throws(() => S.clean(null)); assert.throws(() => S.clean(Array(9).fill({})));
  await assert.rejects(S.normalize(new TextEncoder().encode('<svg onload="bad"/>')));
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); new DataView(png.buffer).setUint32(16, 100000); new DataView(png.buffer).setUint32(20, 100000);
  await assert.rejects(S.normalize(png), /layout/);
});
test('adding a pet selection preserves XP, rewards, provider clocks and habitat', () => {
  const before = { earned: { 'work:assignment:7': 20 }, seen: { 'assignment:7': 42 }, sub: { 'assignment:7': 40 }, days: [1, 2], decor: { books: 3 }, wear: 'plain' };
  const after = P.view({ ...before, sprite: 'ember' });
  assert.equal(after.sprite, 'ember'); assert.equal(after.work, 20); assert.deepEqual(after.decor, before.decor); assert.deepEqual(after.sub, before.sub);
  assert.equal(P.clean({ ...before, sprite: '../../bad.js' }).sprite, '');
});
