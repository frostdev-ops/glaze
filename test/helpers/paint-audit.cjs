// Test-only trace analyser. All comparisons use Chrome's monotonic trace clock and expected display time.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const analyse = (trace, frameId, url, redCounts) => {
  const navigation = trace.find((e) => e.name === 'navigationStart' && e.args?.frame === frameId && e.args?.data?.documentLoaderURL === url);
  const commit = navigation && trace.find((e) => e.name === 'CommitLoad' && e.ts >= navigation.ts && e.args?.data?.frame === frameId && e.args?.data?.url === url);
  const paint = navigation && trace.find((e) => e.name === 'firstPaint' && e.args?.frame === frameId && e.args?.data?.navigationId === navigation.args.data.navigationId);
  const screenshots = trace.filter((e) => e.name === 'Screenshot' && e.args?.snapshot).map((e, i) => {
    const frame = paint && commit && trace.find((f) => f.name === 'AnimationFrame' && f.pid === paint.pid && f.ts >= commit.ts && f.args?.animation_frame_timing_info?.begin_frame_id?.source_id === e.args.source_id && f.args?.animation_frame_timing_info?.begin_frame_id?.sequence_number === e.args.frame_sequence);
    return { capturedAtUs: e.ts, expectedDisplayUs: e.args.expected_display_time, sourceId: e.args.source_id, frameSequence: e.args.frame_sequence, frameAtUs: frame?.ts,
      contentHash: crypto.createHash('sha256').update(Buffer.from(e.args.snapshot, 'base64')).digest('hex'), eligible: !!frame && e.args.expected_display_time >= paint.ts, schoolRedPixels: redCounts[i] };
  });
  const eligible = screenshots.filter((f) => f.eligible);
  return { tracePaint: { navigationId: navigation?.args.data.navigationId, navigationAtUs: navigation?.ts, commitAtUs: commit?.ts, firstPaintAtUs: paint?.ts, rendererPid: paint?.pid }, traceScreenshots: screenshots,
    eligibleTraceSurfaces: new Set(eligible.map((f) => `${f.sourceId}:${f.frameSequence}:${f.contentHash}`)).size, paintCoverage: eligible.length ? 'observed' : 'inconclusive' };
};
const assertClean = (receipt) => assert.ok(receipt.traceScreenshots.filter((f) => f.eligible).every((f) => f.schoolRedPixels < 100), 'school pixels in an eligible expected-display frame');
const assertCoverage = (receipts, minimum = 1) => assert.ok(receipts.filter((r) => r.eligibleTraceSurfaces > 0).length >= minimum, `at least ${minimum} eligible page observations required`);
module.exports = { analyse, assertClean, assertCoverage };
