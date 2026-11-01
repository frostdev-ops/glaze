// The engine keeps one sequence on the GPU across requests (ai/local/engine.js load: extend, common, reserve; the
// session's mark, rewind and grow): a request feeds only what the model doesn't already hold, rewinding to the latest light
// mark inside the shared prefix; the session grows its caches with the sequence kept; a feed can go in small steps with a
// pause between. On the recording WebGPU double; checks/ai/local-engine-check.js small holds the logits to a fresh run.
const test = require('node:test');
const assert = require('node:assert/strict');
const { model, host } = require('../fixtures/local-engine.js');

const CHUNK = 4;
// The token ids each forward step wrote, in order (the session's ids buffer is chunk words).
const fedLog = (h, chunk = CHUNK) => {
  const log = [], write = h.device.queue.writeBuffer;
  h.device.queue.writeBuffer = function (b, off, data, ...rest) {
    if (b.size === chunk * 4 && ArrayBuffer.isView(data) && data.constructor.name === 'Uint32Array') log.push(...data);
    return write.call(this, b, off, data, ...rest);
  };
  return log;
};
const greedy = { sampler: { temperature: 0 } };
// The engine runs in its own realm: compare plain values.
const same = (a, b) => assert.deepEqual(JSON.parse(JSON.stringify(a)), b);
const KINDS = ['conv', 'full', 'swa'];

test('a request sharing the held prefix feeds only the rest; the same request again feeds nothing', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK }), fed = fedLog(h);
  same(await m.extend([1, 2, 3, 4, 5]), { reused: 0, fed: 5 });
  assert.deepEqual(fed.splice(0), [1, 2, 3, 4, 5]);
  same(await m.extend([1, 2, 3, 4, 5, 6, 7]), { reused: 5, fed: 2 });
  assert.deepEqual(fed.splice(0), [6, 7]);
  assert.equal(m.common([1, 2, 3, 4, 5, 6, 7, 1]), 7);
  same(await m.extend([1, 2, 3, 4, 5, 6, 7]), { reused: 7, fed: 0 });
  assert.deepEqual(fed, []);
  await m.decode(greedy);
  m.release();
});

test('a request that differs inside the held sequence rewinds to the latest mark before the difference', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK }), fed = fedLog(h);
  await m.extend([1, 2, 3, 4, 5, 6, 7, 1, 2], { at: [3, 6] });
  fed.length = 0;
  // Differs at position 7: the mark at 6 is the latest inside the shared seven.
  same(await m.extend([1, 2, 3, 4, 5, 6, 7, 3, 3, 3]), { reused: 6, fed: 4 });
  assert.deepEqual(fed.splice(0), [7, 3, 3, 3]);
  // Differs at position 4: back to the mark at 3; the marks past 3 went with the old tokens.
  same(await m.extend([1, 2, 3, 4, 2]), { reused: 3, fed: 2 });
  assert.deepEqual(fed.splice(0), [4, 2]);
  same(await m.extend([1, 2, 3, 4, 5, 6, 7]), { reused: 3, fed: 4 });
  // Nothing shared: from the start.
  same(await m.extend([5, 5]), { reused: 0, fed: 2 });
  assert.deepEqual(fed.slice(-2), [5, 5]);
  m.release();
});

test('a rewind copies the conv states and the sliding window back from the mark', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK });
  await m.extend([1, 2, 3, 4, 5, 6], { at: [4] });
  const copies = [];
  const enc = h.device.createCommandEncoder;
  h.device.createCommandEncoder = () => { const e = enc(); const copy = e.copyBufferToBuffer; e.copyBufferToBuffer = (...a) => { copies.push(a); return copy(...a); }; return e; };
  await m.extend([1, 2, 3, 4, 1]);
  // conv state (2 rows × 256 f32), and the ring's last window (5 positions) of keys and of values.
  const back = copies.filter(([, , dst]) => !dst.usage || !(dst.usage & 8));
  assert.ok(back.some(([, , , , size]) => size === 2 * 256 * 4), 'the conv state comes back');
  assert.ok(back.filter(([, , , , size]) => size > 0 && size <= 5 * 128 * 4).length >= 2, 'the ring\'s window comes back');
  m.release();
});

test('the token decode chose is fed once when the next request continues with it', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK }), fed = fedLog(h);
  await m.extend([1, 2, 3]);
  const id = await m.decode(greedy);
  fed.length = 0;
  same(await m.extend([1, 2, 3, id, 6]), { reused: 3, fed: 2 });
  assert.deepEqual(fed, [id, 6]);
  fed.length = 0;
  const id2 = await m.decode(greedy);
  same(await m.extend([1, 2, 3, id, 6, id2]), { reused: 5, fed: 1 });
  assert.deepEqual(fed, [id2]);
  // A request that drops the decoded token: it is never fed.
  const id3 = await m.decode(greedy);
  fed.length = 0;
  await m.extend([1, 2, 3, id, 6, id2, (id3 + 1) % 8]);
  assert.deepEqual(fed, [(id3 + 1) % 8]);
  m.release();
});

test('rows fed from embeds never match a later request', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK });
  const buffer = h.device.createBuffer({ size: 2 * 256 * 4, usage: 2 });
  Object.setPrototypeOf(buffer, h.context.GPUBuffer.prototype);
  await m.prefill([1, 0, 0, 2], { embeds: [{ at: 1, tokens: 2, buffer }] });
  assert.equal(m.common([1, 0, 0, 2]), 1);
  assert.equal((await m.extend([1, 0, 0, 2])).reused, 0);
  m.release();
});

test('restoring a snapshot makes its tokens the held sequence; marks past what both share are dropped', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK }), fed = fedLog(h);
  await m.extend([1, 2, 3]);
  const snap = await m.snapshot();
  await m.extend([1, 2, 3, 4, 5, 6], { at: [5] });
  await m.extend([7, 7, 7, 7, 7]);
  await m.restore(snap);
  fed.length = 0;
  same(await m.extend([1, 2, 3, 4]), { reused: 3, fed: 1 });
  assert.deepEqual(fed, [4]);
  snap.drop();
  m.release();
});

test('reserve grows the session with the sequence kept, up to the most it is allowed', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 16, chunk: CHUNK }), fed = fedLog(h);
  await m.extend([1, 2, 3, 4, 5, 6, 7, 1, 2, 3]);
  assert.equal(m.context, 16);
  assert.equal(await m.reserve(12, 100), 16);
  const grown = await m.reserve(40, 2000);
  assert.ok(grown >= 40 && grown <= 2000, `grew to ${grown}`);
  assert.equal(m.context, grown);
  await assert.rejects(m.reserve(5000, 2000), /context of 2000 positions is full/);
  // The held tokens stay held; every dispatch binds live buffers.
  fed.length = 0;
  same(await m.extend([1, 2, 3, 4, 5, 6, 7, 1, 2, 3, 4, 4]), { reused: 10, fed: 2 });
  const last = h.dispatches.slice(-40);
  for (const d of last) for (const e of d.group.entries) assert.ok(!e.resource.buffer.destroyed, 'a dispatch binds a destroyed buffer');
  await m.decode(greedy);
  m.release();
});

test('a long context costs its RoPE rows only as positions come into use', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 100000, chunk: CHUNK });
  const before = h.writes.length;
  await m.extend([1, 2, 3]);
  const rope = h.writes.slice(before).filter((w) => w.size % (128 * 4) === 0 && w.size >= 1024 * 128 * 4);
  assert.ok(rope.length >= 2, 'both tables get rows');
  for (const w of rope) assert.ok(w.size <= 1024 * 128 * 4, `a RoPE write of ${w.size} bytes`);
  m.release();
});

test('a feed in small steps pauses between them, and a cancel lands within a step', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK });
  let paces = 0;
  const before = h.submissions.length;
  await m.extend(Array.from({ length: 12 }, (_, i) => i % 8), { step: 2, pace: async () => { paces++; } });
  assert.equal(h.submissions.length - before >= 6, true);
  // After every step, the last too: the next submission starts on an idle GPU.
  assert.equal(paces, 6);
  const c = new AbortController(), why = new Error('typed');
  const at = m.pos;
  await assert.rejects(m.extend([...Array.from({ length: 12 }, (_, i) => i % 8), ...Array.from({ length: 20 }, () => 3)], { step: 2, signal: c.signal, pace: async () => { c.abort(why); } }), (e) => e === why);
  assert.equal(m.pos, at + 2, 'stopped after one step');
  m.release();
});

test('marks stay within their cap; the start is never dropped', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 64, chunk: CHUNK });
  const ids = Array.from({ length: 40 }, (_, i) => i % 8);
  await m.extend(ids, { at: Array.from({ length: 39 }, (_, i) => i + 1) });
  const live = h.buffers.filter((b) => !b.destroyed).length;
  await m.extend([...ids, 1], { at: [40] });
  assert.ok(h.buffers.filter((b) => !b.destroyed).length <= live + 1);
  same(await m.extend([6, 6]), { reused: 0, fed: 2 });
  m.release();
  assert.ok(h.buffers.every((b) => b.destroyed), 'release frees every mark');
});

test('marks over the cap thin the densest stretch: the system turn\'s end outlives two requests\' worth of block marks', async () => {
  const h = host(), m = await h.load(model({ kinds: KINDS }), { context: 256, chunk: CHUNK });
  const head = Array.from({ length: 20 }, (_, i) => i % 8);
  await m.extend(head);
  const one = [...head, ...Array.from({ length: 30 }, (_, i) => (i * 3) % 8)];
  await m.extend(one, { at: Array.from({ length: 12 }, (_, i) => 21 + 2 * i) });
  const two = [...one, ...Array.from({ length: 30 }, (_, i) => (i * 5) % 8)];
  await m.extend(two, { at: Array.from({ length: 12 }, (_, i) => 51 + 2 * i) });
  // Differs right after the system turn.
  same(await m.extend([...head, 7, 7, 7]), { reused: 20, fed: 3 });
  m.release();
});
