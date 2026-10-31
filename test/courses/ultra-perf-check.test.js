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
