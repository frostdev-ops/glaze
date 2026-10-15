const test = require('node:test'), assert = require('node:assert/strict');
const { analyse, assertClean, assertCoverage } = require('../parity/bench/B7c-paint.cjs');
const url = 'https://nav.test/ultra/grades';
const start = { name: 'navigationStart', ts: 100, args: { frame: 'current', data: { documentLoaderURL: url, navigationId: 'nav' } } };
const commit = { name: 'CommitLoad', ts: 120, args: { data: { frame: 'current', url } } };
const paint = { name: 'firstPaint', ts: 200, pid: 7, args: { frame: 'current', data: { navigationId: 'nav' } } };
const frame = (sequence, ts = 180, pid = 7) => ({ name: 'AnimationFrame', ts, pid, args: { animation_frame_timing_info: { begin_frame_id: { source_id: 1, sequence_number: sequence } } } });
const shot = (sequence, pixels = 'pixels', display = 210) => ({ name: 'Screenshot', ts: 195, args: { source_id: 1, frame_sequence: sequence, expected_display_time: display, snapshot: Buffer.from(pixels).toString('base64') } });
test('an expected display after exact current firstPaint is eligible and a red witness fails', () => {
  const r = analyse([start, commit, paint, frame(2), shot(2)], 'current', url, [800]);
  assert.equal(r.eligibleTraceSurfaces, 1); assert.ok(r.traceScreenshots[0].capturedAtUs < r.tracePaint.firstPaintAtUs);
  assert.throws(() => assertClean(r), /school pixels/); assertCoverage([r]);
});
test('prior-navigation and foreign renderer screenshots are excluded without a tolerance', () => {
  const r = analyse([start, commit, paint, frame(1, 110), frame(2), frame(3, 180, 8), shot(1), shot(2), shot(3), shot(2, 'early', 199)], 'current', url, [800, 0, 800, 800]);
  assert.deepEqual(r.traceScreenshots.map((s) => s.eligible), [false, true, false, false]); assertClean(r); assertCoverage([r]);
});
test('reused frame IDs never discard differing pixels; only identical surface content is deduplicated', () => {
  const r = analyse([start, commit, paint, frame(2), shot(2, 'clean'), shot(2, 'clean'), shot(2, 'red')], 'current', url, [0, 0, 800]);
  assert.equal(r.traceScreenshots.length, 3); assert.equal(r.eligibleTraceSurfaces, 2); assert.throws(() => assertClean(r), /school pixels/);
});
test('empty, wrong-navigation and pre-paint groups remain inconclusive and cannot pass coverage', () => {
  for (const trace of [[], [start, commit, { ...paint, args: { frame: 'current', data: { navigationId: 'old' } } }, frame(2), shot(2)], [start, commit, paint, frame(2), shot(2, 'early', 199)], [start, paint, frame(2), shot(2)]]) {
    const r = analyse(trace, 'current', url, [0]); assert.equal(r.paintCoverage, 'inconclusive'); assert.throws(() => assertCoverage([r]), /eligible/);
  }
  assert.throws(() => assertCoverage([], 3), /eligible/);
});
