const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

// Exercise the page probe and the runner's measurement code without loading Playwright or launching a browser.
const source = fs.readFileSync(require.resolve('../../checks/courses/ultra-perf-check.js'), 'utf8');
const probeSource = source.slice(source.indexOf('function speedProbe()'), source.indexOf('\nconst sum = '));

test('the Ultra idle measurement stops heading sampling before collecting CPU and layout totals', async () => {
  let now = 3000, styleReads = 0, nextFrame = 0;
  const frames = new Map();
  const heading = { nodeType: 1, tagName: 'H1', id: '', classList: [], parentElement: null,
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 100, height: 40 }) };
  const c = vm.createContext({
    document: { documentElement: { hasAttribute: () => false }, querySelectorAll: () => [heading] },
    performance: { now: () => now },
    MutationObserver: class { observe() {} }, PerformanceObserver: class { observe() {} },
    requestAnimationFrame: (fn) => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: (id) => frames.delete(id),
    getComputedStyle: () => { styleReads++; return { visibility: 'visible', opacity: '1', display: 'block', fontWeight: '400', fontSize: '32px', fontFamily: 'sans-serif', contentVisibility: 'visible' }; },
  });
  c.window = c;
  vm.runInContext(`${probeSource}\nspeedProbe();`, c);
  const tick = () => {
    const callbacks = [...frames.values()]; frames.clear();
    for (const fn of callbacks) fn();
  };
  tick();
  assert.equal(styleReads, 1, 'the attribution sampler is running during route measurements');
  const page = {
    evaluate: (fn) => vm.runInContext(`(${fn.toString()})()`, c),
    waitForTimeout: async (ms) => { const end = now + ms; while (now < end) { now = Math.min(end, now + 16); tick(); } },
  };
  const cdp = { send: async (method) => method === 'Performance.getMetrics' ? { metrics: [{ name: 'TaskDuration', value: styleReads / 1000 }] } : {} };
  const start = source.indexOf('          // Idle: 5 s'), end = source.indexOf('          await cdp.detach();', start);
  const idle = await vm.runInNewContext(`(async () => { ${source.slice(start, end)}; return idle; })()`, {
    page, context: { newCDPSession: async () => cdp }, rss: () => null, profile: 'node-fixture',
  });
  assert.equal(idle.taskMs, 0, 'idle CPU must not include the probe itself');
  assert.equal(styleReads, 1, 'idle layout must not be forced by diagnostic reads');
  assert.equal(frames.size, 0, 'no diagnostic animation remains scheduled');
});

test('title paint measures the load from navigation and routes from insertion, independent of diagnostic delivery', () => {
  const stages = { initial: { window: [0, 900] }, courses: { window: [1000, 1900] }, outline: { window: [2000, 2900] } };
  const probe = { lcp: [], fonts: [],
    titles: [{ text: 'stream', renderTime: 80 }, { text: 'course', renderTime: 1040 }, { text: 'outline', renderTime: 2040 }],
    // The observer runs after insertion work; its bounded log may omit a later heading entirely.
    h1: [{ kind: 'insert', text: 'stream', into: 'div#main-content-inner', t: 30 },
      { kind: 'insert', text: 'course', into: 'div#main-content-inner', t: 1010 }],
  };
  const start = source.indexOf('          const stageOf = '), end = source.indexOf('          speedResult = ', start);
  const titlePaint = vm.runInNewContext(`${source.slice(start, end)}; titlePaint;`, { probe, stages, courses: stages.courses });
  assert.equal(titlePaint.stream, 80, 'the load includes time before the heading is parsed');
  assert.equal(titlePaint.course, 40, 'synchronous insertion and observer delivery time belong to the route');
  assert.equal(titlePaint.outline, 40, 'the measurement survives a capped attribution log');
});

test('title paint keeps navigation as the load origin when settle records its later sampling start', () => {
  const stages = { initial: { window: [0, 900], inserted: 700 }, courses: { window: [1000, 1900], inserted: 1000 },
    outline: { window: [2000, 2900], inserted: 2140 } };
  const probe = { lcp: [], fonts: [], titles: [{ text: 'stream', renderTime: 80 }, { text: 'course', renderTime: 1040 },
    { text: 'outline', renderTime: 2180 }] };
  const start = source.indexOf('          const stageOf = '), end = source.indexOf('          speedResult = ', start);
  const titlePaint = vm.runInNewContext(`${source.slice(start, end)}; titlePaint;`, { probe, stages, courses: stages.courses });
  assert.equal(titlePaint.stream, 80, 'initial settle starts after paint; its timestamp is not the navigation origin');
  assert.equal(titlePaint.course, 40);
  assert.equal(titlePaint.outline, 40, 'a delayed route still measures from its actual insertion');
});

const requireStillAside = (frames) => {
  const start = source.indexOf('    if (stillAside) {'), end = source.indexOf('    if (process.env.PERF_REQUIRE_QUIET_OWN)', start);
  vm.runInNewContext(`const results = JSON.parse(resultsJson);\n${source.slice(start, end)}`, {
    stillAside: true, WIDTH: 1600, reps: 2, assert, console: { log() {} },
    resultsJson: JSON.stringify([{ rep: 1, instrumented: false, outline: { aside: { frames, shifts: [] } } }]) });
};

test('the aside sampler records the visible column position before Glaze blocks arrive', () => {
  let sample, visible = false, now = 200;
  const column = { checkVisibility: () => visible, getAttribute: () => null,
    getBoundingClientRect: () => ({ left: 1376, top: 100, width: 330, height: 26 }) };
  const details = { parentElement: column, getBoundingClientRect: () => ({ height: 26 }) };
  const start = source.indexOf('function asideWatch()'), end = source.indexOf('\nasync function settle(', start);
  const stop = vm.runInNewContext(`${source.slice(start, end)}\nasideWatch();`, {
    document: { querySelector: (s) => s.endsWith('.js-details-and-actions') ? details : null,
      documentElement: { style: { getPropertyValue: () => '' }, hasAttribute: () => false } },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { sample = fn; return 1; }, cancelAnimationFrame() {},
    PerformanceObserver: class { observe() {} takeRecords() { return []; } disconnect() {} },
  });
  sample();
  visible = true; now = 300;
  sample();
  const frames = JSON.parse(JSON.stringify(stop().frames));
  assert.equal(frames[0].top, undefined, 'a hidden column has no visible position');
  assert.equal(frames[1].left, 1376);
  assert.equal(frames[1].top, 100, 'its vertical position counts before Course notes and the dock exist');
});

test('the still-aside requirement catches Details growth during sidebar adoption', () => {
  const notes = 'aside.outline-actions > #gz-nt-block', dock = 'aside.outline-actions > #gz-sb-widgets';
  assert.throws(() => requireStillAside([
    { t: 200, host: null, details: 66, [notes]: 206 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600 },
  ]), /blocks moved/, 'adoption must not excuse the native Details growth as well as the new header');
  assert.throws(() => requireStillAside([
    { t: 200, host: null, details: 231, [notes]: 371 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600 },
  ]), /blocks moved/, 'the sidebar putting its header in above them is a move too');
});

test('the still-aside requirement catches the column moving sideways when the sidebar takes it', () => {
  const notes = 'aside.outline-actions > #gz-nt-block', dock = 'aside.outline-actions > #gz-sb-widgets';
  assert.throws(() => requireStillAside([
    { t: 200, host: null, details: 26, left: 1028 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600, left: 1328 },
  ]), /moved sideways/);
  assert.doesNotThrow(() => requireStillAside([
    { t: 200, host: 'native', details: 231, [notes]: 421, [dock]: 600, left: 1376 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600, left: 1376 },
  ]));
});

test('the still-aside requirement catches the column moving vertically before its blocks appear', () => {
  const notes = 'aside.outline-actions > #gz-nt-block', dock = 'aside.outline-actions > #gz-sb-widgets';
  assert.throws(() => requireStillAside([
    { t: 200, host: null, details: 26, left: 1376, top: 100 },
    { t: 500, host: 'native', details: 231, left: 1376, top: 150, [notes]: 421, [dock]: 600 },
  ]), /column moved vertically/, 'the first visible block positions cannot reveal a prior column move');
  assert.doesNotThrow(() => requireStillAside([
    { t: 200, host: null, details: 26, left: 1376, top: 100 },
    { t: 300, host: null, details: 26 },
    { t: 500, host: 'native', details: 231, left: 1376, top: 100, [notes]: 421, [dock]: 600 },
  ]), 'a hidden frame does not invent a column move');
});

test('the still-aside requirement rejects a run where the widget dock never appears', () => {
  const notes = 'aside.outline-actions > #gz-nt-block';
  assert.throws(() => requireStillAside([
    { t: 200, host: 'native', details: 231, [notes]: 421 },
    { t: 500, host: 'native', details: 231, [notes]: 421 },
  ]), /My widgets showed/, 'an absent dock has no movements, but does not prove that both blocks stayed put');
});

test('the still-aside requirement compares each block across temporarily hidden frames', () => {
  const notes = 'aside.outline-actions > #gz-nt-block', dock = 'aside.outline-actions > #gz-sb-widgets';
  assert.throws(() => requireStillAside([
    { t: 200, host: 'native', details: 66, [notes]: 206, [dock]: 400 },
    { t: 300, host: 'native', details: 66 },
    { t: 500, host: 'native', details: 231, [notes]: 371, [dock]: 565 },
  ]), /blocks moved/, 'a missing intermediate rectangle must not discard the previous visible position');
  assert.doesNotThrow(() => requireStillAside([
    { t: 200, host: 'native', details: 231, [notes]: 421, [dock]: 600 },
    { t: 300, host: 'native', details: 231 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600 },
  ]), 'a block returning to the same position has not moved');
});

test('profile attribution preserves one-based trace lines and converts zero-based CPU lines', async () => {
  // Blink SourceLocation::WriteIntoTrace uses V8StackTrace::frames(), whose lines are already one-based.
  const url = `chrome-extension://${'a'.repeat(32)}/content/content-ultra.js`;
  const profile = { nodes: [
    { id: 1, callFrame: { url: '', functionName: '(root)', lineNumber: -1 }, children: [2] },
    { id: 2, callFrame: { url, functionName: 'gate', lineNumber: 40 }, children: [3] },
    { id: 3, callFrame: { url: '', functionName: 'querySelectorAll', lineNumber: -1 } },
  ], samples: [2, 3], timeDeltas: [1000, 2000] };
  const cdp = new (require('node:events').EventEmitter)();
  cdp.send = async (method) => {
    if (method === 'Profiler.stop') return { profile };
    if (method === 'Tracing.end') cdp.emit('Tracing.tracingComplete');
    return {};
  };
  cdp.detach = async () => {};
  const start = source.indexOf('const stopProfile = '), end = source.indexOf('\nconst snapshot = ', start);
  const stop = vm.runInNewContext(`${source.slice(start, end)}\nstopProfile;`);
  const result = await stop({ cdp, events: [
    { ph: 'X', name: 'Layout', dur: 2000, args: { beginData: { stackTrace: [{ url, functionName: 'gate', lineNumber: 41 }] } } },
    { ph: 'X', name: 'UpdateLayoutTree', dur: 1000, args: { data: { stackTrace: [{ url, functionName: 'style', lineNumber: 1 }] } } },
  ] });
  assert.equal(result.passes.Layout.forced[0][0], 'ext:content/content-ultra.js gate:41');
  assert.equal(result.passes.UpdateLayoutTree.forced[0][0], 'ext:content/content-ultra.js style:1');
  assert.equal(result.extensionMs, 3, 'native selector time stays with its script caller');
  assert.ok(result.functions.every(([key]) => key.includes('gate:41')), 'CPU call frames are zero-based');
});
