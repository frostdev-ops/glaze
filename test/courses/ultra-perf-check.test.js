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

test('the still-aside requirement catches Details growth during sidebar adoption', () => {
  const notes = 'aside.outline-actions > #gz-nt-block', dock = 'aside.outline-actions > #gz-sb-widgets';
  assert.throws(() => requireStillAside([
    { t: 200, host: null, details: 66, [notes]: 206 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600 },
  ]), /blocks moved/, 'adoption must not excuse the native Details growth as well as the new header');
  assert.doesNotThrow(() => requireStillAside([
    { t: 200, host: null, details: 231, [notes]: 371 },
    { t: 500, host: 'native', details: 231, [notes]: 421, [dock]: 600 },
  ]), 'inserting only the sidebar header remains an allowed adoption');
});
