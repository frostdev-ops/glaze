// Synthetic Ultra only, with the real unpacked extension. Run under nice -n 15 with Playwright on NODE_PATH.
// EXT selects a checkout; PERF_REPS defaults to 3. Every profile and instrumented extension copy is temporary.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const source = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-ultra-perf.json'));
const chromeLaunch = require('../../tools/dev/check-env.js').chromeLaunch();
const origin = 'https://ultra.fixture.test';
const reps = Number(process.env.PERF_REPS || 3);
const D = require(path.join(source, 'content/defaults.js'));
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// PERF_SPEED=1: what a student waits for, Glaze off (enabled: false) against on: styled-at, paints, long tasks, long
// animation frames and layout shift per stage, an idle window, glaze:load round trips and a cold course-tab open.
// PERF_DEVICE=neo: a MacBook Neo (A18 Pro, 2P+4E cores, 8 GB): 6 cores, the CPU throttled to its Chrome speed, its screen.
const speed = process.env.PERF_SPEED === '1';
const neo = process.env.PERF_DEVICE === 'neo';
// Speedometer 3.1 in Chrome on the MacBook Neo, from HotHardware's review (Safari: 50.4).
const NEO_CHROME_SPEEDOMETER = 41.4;
const NEO_CHROME_SOURCE = 'HotHardware, "Apple MacBook Neo Long-Term Review", hothardware.com/reviews/apple-macbook-neo-review?page=2 (read 2026-10-30)';
// The runner's Speedometer 3.1 score (checks/courses/neo-calibrate.js, headless Chromium, 6 cores) ÷ NEO_CHROME_SPEEDOMETER.
// null until calibrated: PERF_CPU_RATE stands in.
const RUNNER_SPEEDOMETER = null;
const NEO_CPU_RATE = null;
const NEO_MEMORY_MB = 8192;
// The Neo's panel is 2408×1506; macOS draws it at 2× by default. Sources disagree on the default "looks like" size, so a
// 1280×800 window's viewport stands in for it.
const NEO_VIEWPORT = { width: 1280, height: 800 }, NEO_SCALE = 2;
// Pins this process to 6 cores, so the browsers it launches inherit them; null where taskset is missing (macOS).
const pinCores = () => { try { execFileSync('taskset', ['-a', '-cp', '0-5', String(process.pid)], { stdio: 'ignore' }); return '0-5'; } catch { return null; } };
module.exports = { NEO_CHROME_SPEEDOMETER, NEO_CHROME_SOURCE, pinCores, stageSpeed: (...a) => stageSpeed(...a), summarize: (...a) => summarize(...a) };

// This runs FIRST in the extension's isolated world, never as a page script. It is added only to a temporary copy.
function instrument(timed) {
  const metrics = { observers: [], selectors: {}, styleReads: 0, storage: [], loads: [], glDraws: 0 };
  if (timed) metrics.loadMs = [];
  const site = () => new Error().stack.split('\n').find((s) => /chrome-extension:/.test(s) && !/perf-shim/.test(s))?.trim();
  const MO = MutationObserver;
  globalThis.MutationObserver = class extends MO {
    constructor(fn) {
      const m = { site: site(), calls: 0, records: 0, ms: 0, max: 0 };
      metrics.observers.push(m);
      super(function (records, observer) {
        const start = performance.now();
        m.calls++; m.records += records.length;
        try { return fn.call(this, records, observer); }
        finally { const took = performance.now() - start; m.ms += took; m.max = Math.max(m.max, took); }
      });
    }
  };
  for (const prototype of [Document.prototype, Element.prototype]) {
    const query = prototype.querySelectorAll;
    prototype.querySelectorAll = function (selector) {
      const key = `${this === document ? 'document' : this.tagName || 'node'}:${selector}`;
      metrics.selectors[key] = (metrics.selectors[key] || 0) + 1;
      return query.call(this, selector);
    };
  }
  const computed = getComputedStyle;
  globalThis.getComputedStyle = (...args) => { metrics.styleReads++; return computed.apply(globalThis, args); };
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) for (const method of ['drawArrays', 'drawElements']) {
    const prototype = globalThis[name]?.prototype, draw = prototype?.[method];
    if (draw) prototype[method] = function (...args) { metrics.glDraws++; return draw.apply(this, args); };
  }
  for (const area of ['local', 'sync']) {
    const get = chrome.storage[area].get.bind(chrome.storage[area]);
    chrome.storage[area].get = (...args) => { metrics.storage.push({ area, keys: args[0] }); return get(...args); };
  }
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (...args) => {
    if (args[0]?.type !== 'glaze:load') return send(...args);
    metrics.loads.push(args[0].files);
    if (!timed) return send(...args);
    // Round trip: the ask until the worker's reply, which comes once the files have run in this frame.
    const start = performance.now(), reply = send(...args);
    const done = (ok) => metrics.loadMs.push({ files: args[0].files, ms: performance.now() - start, ok });
    reply?.then?.((r) => done(r?.ok !== false), () => done(false));
    return reply;
  };
  document.addEventListener('gz-perf-read', () => {
    document.documentElement.setAttribute('data-gz-perf', JSON.stringify({ ...metrics, runtime: !!chrome.runtime?.id, contextOn: globalThis.GZ_CTX?.on() }));
  });
}

const rows = (kind, n) => Array.from({ length: n }, (_, i) => kind === 'outline'
  ? `<div class="content-list-item" data-content-id="_${1000 + i}_1"><h3><button id="folder-title-_${1000 + i}_1" aria-expanded="false">Folder ${i}</button></h3><span>Due: October 20, 2026</span></div>`
  : `<div class="native-row"><span>Sample ${i}</span><button>Open</button><div>Course information</div></div>`).join('');
const routeBody = (kind) => `<section class="route-view-container ${kind === 'outline' ? 'course' : ''}"><h1>${kind}</h1>${kind === 'course'
  ? `<div class="courses-panel"><div class="course-org-list">${Array.from({ length: 24 }, (_, i) => `<article class="element-card course-element-card" data-course-id="_${101 + i}_1"><div class="course-banner"></div><div class="element-details"><h4 class="course-title"><span class="js-course-title-element">Course ${i}</span></h4><div class="course-status">Open</div></div></article>`).join('')}</div></div>`
  : rows(kind, kind === 'outline' ? 240 : 30)}</section>`;
const fixture = `<!doctype html><html lang="en"><head><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><meta charset="utf-8"><title>Ultra performance fixture</title><style>body{margin:0;font:14px sans-serif}nav{position:fixed;width:200px}main{margin-left:200px}.native-row,.content-list-item{padding:4px;border-bottom:1px solid #ddd}</style></head><body><div id="site-wrap"><nav id="base_tools"><a href="/ultra/institution-page"><span>Institution Page</span></a><a href="/ultra/course">Courses</a></nav><main id="main-content"><div id="main-content-inner">${routeBody('stream')}</div></main></div><aside id="gz-perf-own"></aside></body></html>`;

async function settle(page, change) {
  return page.evaluate(async ({ change, body }) => {
    const start = performance.now();
    let last = start, changes = 0, held = 0;
    const mo = new MutationObserver((rs) => { last = performance.now(); changes += rs.length; });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true });
    if (['outline', 'grades', 'course'].includes(change)) {
      history.pushState({}, '', location.origin + (change === 'course' ? '/ultra/course' : `/ultra/courses/_101_1/${change}`));
      document.getElementById('main-content-inner').innerHTML = body;
    } else if (change === 'own') {
      const own = document.getElementById('gz-perf-own');
      for (let i = 0; i < 30; i++) { own.textContent = `Widget ${i}`; await new Promise((r) => setTimeout(r, 20)); }
    }
    while (performance.now() - start < 4000) {
      await new Promise((r) => setTimeout(r, 50));
      if (document.querySelector('[data-gz-loading]')) held = performance.now() - start;
      if (performance.now() - start >= 500 && performance.now() - last >= 300) break;
    }
    mo.disconnect();
    return { elapsed: performance.now() - start, lastMutation: last - start, changes, held, stillHeld: !!document.querySelector('[data-gz-loading]'), longTasks: window.perfLongTasks, nodes: document.body.querySelectorAll('*').length, rows: document.querySelectorAll('.native-row, .content-list-item, .course-element-card').length,
      ...(window.perfSpeed && { window: [change ? start : 0, performance.now()] }) };
  }, { change, body: routeBody(change) });
}

// PERF_SPEED: what the page observes in its own world from its first script: when Glaze's look lands on <html>
// (content/content.js applySettings sets data-gz-font), paints, layout shifts and long animation frames with their scripts.
function speedProbe() {
  const s = window.perfSpeed = { styledAt: null, lcp: [], shifts: [], loafs: [], drawn: [] };
  const styled = () => { if (s.styledAt == null && document.documentElement?.hasAttribute('data-gz-font')) s.styledAt = performance.now(); };
  styled();
  new MutationObserver(styled).observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-font'] });
  const watch = (type, fn) => { try { new PerformanceObserver((list) => list.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch { s[`no-${type}`] = true; } };
  watch('largest-contentful-paint', (e) => s.lcp.push({ ms: e.startTime, size: e.size, el: e.element?.tagName || null }));
  watch('layout-shift', (e) => { if (!e.hadRecentInput) s.shifts.push({ start: e.startTime, value: e.value }); });
  watch('long-animation-frame', (e) => s.loafs.push({ start: e.startTime, ms: e.duration, blocking: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0,
    scripts: e.scripts.map((x) => ({ src: x.sourceURL, fn: x.sourceFunctionName, invoker: x.invoker, type: x.invokerType, ms: x.duration, layout: x.forcedStyleAndLayoutDuration })) }));
}

const sum = (list, f = (x) => x) => list.reduce((n, x) => n + f(x), 0);
// One stage's share of the page's entries, by start time.
function stageSpeed(page, [from, to]) {
  const within = (e) => e.start >= from && e.start < to;
  const longTasks = page.longTasks.filter(within), loafs = page.loafs.filter(within);
  const scripts = new Map();
  for (const script of loafs.flatMap((l) => l.scripts)) {
    const key = `${script.src || '(no source)'} ${script.fn || ''} ${script.invoker || ''}`.trim();
    const row = scripts.get(key) || { key, from: /^chrome-extension:/.test(script.src) ? 'extension' : 'page', ms: 0, layout: 0, count: 0 };
    row.ms += script.ms; row.layout += script.layout || 0; row.count++;
    scripts.set(key, row);
  }
  const rows = [...scripts.values()].sort((a, b) => b.ms - a.ms);
  return { from, to, longTaskMs: sum(longTasks, (e) => e.ms), longTasks: longTasks.length, cls: sum(page.shifts.filter(within), (e) => e.value),
    loaf: { count: loafs.length, ms: sum(loafs, (e) => e.ms), blockingMs: sum(loafs, (e) => e.blocking), extensionScriptMs: sum(rows.filter((r) => r.from === 'extension'), (r) => r.ms),
      pageScriptMs: sum(rows.filter((r) => r.from === 'page'), (r) => r.ms), top: rows.slice(0, 8) } };
}
const median = (list) => { const l = list.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b); return l.length ? (l.length % 2 ? l[l.length >> 1] : (l[l.length / 2 - 1] + l[l.length / 2]) / 2) : null; };
const quantile = (list, q) => { const l = list.filter(Number.isFinite).sort((a, b) => a - b); return l.length ? l[Math.min(l.length - 1, Math.ceil(q * l.length) - 1)] : null; };
// RSS of this profile's processes from ps (Linux, where Chrome's children carry --user-data-dir), in MB: all of them, and
// the renderers that are not extension processes.
function rss(profile) {
  try {
    const lines = execFileSync('ps', ['-ax', '-o', 'rss=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter((l) => l.includes(profile));
    const kb = (list) => sum(list, (l) => Number(/^\s*(\d+)/.exec(l)?.[1] || 0));
    const renderers = lines.filter((l) => l.includes('--type=renderer') && !l.includes('--extension-process'));
    return lines.length ? { totalMB: kb(lines) / 1024, rendererMB: renderers.length ? kb(renderers) / 1024 : null, processes: lines.length, renderers: renderers.length } : null;
  } catch { return null; }
}
// The cores the browser may run on, read from one of this profile's processes (Linux).
function browserCores(profile) {
  try {
    const line = execFileSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').find((l) => l.includes(profile) && !l.includes(' ps '));
    return /Cpus_allowed_list:\s*(\S+)/.exec(fs.readFileSync(`/proc/${/^\s*(\d+)/.exec(line)[1]}/status`, 'utf8'))?.[1] || null;
  } catch { return null; }
}

// PERF_SPEED, Glaze on: a cold course-tab open on the synthetic Ultra course (test/fixtures/ultra-course.html), set up as
// checks/navigation/ultra-tabs-check.js does: two courses opened natively, then the other course's tab in Glaze's strip
// (navigation/page/coursetabs.js) pressed while it has no frame yet. → ms from the press to the frame's 'drawn' message
// and to the frame being on screen (visible, not inert, the stand-in gone).
const TABS = 'https://bb.school.test', TABS_CSS = 'https://cdn.school.test/ultra/uiv4001.0.0-rel.37_abc/app.css';
const TABS_PAGE = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-course.html'), 'utf8');
const TAB_COURSES = [['_101_1', 'Computer Science I', 'FA26-CS101-01', 1], ['_102_1', 'Spanish 110', 'FA26-SPAN110-02', 2]];
function tabsRoute(r, u) {
  if (u.origin === TABS && u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: TABS_PAGE });
  if (u.href === TABS_CSS) return r.fulfill({ contentType: 'text/css', body: '.course-content-container{min-height:100vh}\n.panel-wrap{overscroll-behavior:contain}' });
  if (u.pathname === '/fixture/image.png' || u.pathname === '/fixture/background.png') return r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5FQAAAAASUVORK5CYII=', 'base64') });
  if (u.origin !== TABS) return null;
  if (u.pathname === '/learn/api/v1/users/me') return r.fulfill({ json: { id: '_42_1' } });
  if (/^\/learn\/api\/v1\/users\/_\d+_1\/memberships/.test(u.pathname)) return r.fulfill({ json: { results: TAB_COURSES.map(([id, name, code, i]) => ({ courseId: id, courseCardColorIndex: i, userHasHidden: false, role: 'S', course: { id, courseId: code, displayId: code, name, isOrganization: false } })) } });
  if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ status: 404, json: {} });
  return null;
}
async function courseTabOpen(context, opts, prepare) {
  await opts.evaluate(async (s) => { await chrome.storage.session.clear(); await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); await chrome.storage.local.set({ ultra: ['https://bb.school.test'] }); },
    { ...D.GZ_DEFAULTS, navbar: { ...D.GZ_DEFAULTS.navbar, on: false }, enhance: { ...D.GZ_DEFAULTS.enhance, sidebar: false }, tabs: D.GZ_SANITIZE({}).tabs });
  await require('../../tools/dev/check-env.js').ultraReady(opts);
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await prepare(page);
    const settled = (cid) => page.waitForFunction(({ cid, name }) => !document.querySelector('.spinner, [data-gz-loading], [data-gz-placing]')
      && document.querySelector(`#gz-ctabs [role="tab"][data-course-id="${cid}"][aria-selected="true"]`)
      && ([...document.querySelectorAll('div.bb-course-navigation a[href]')].some((a) => a.getAttribute('href').startsWith(`/ultra/courses/${cid}/`))
        || document.querySelector('.routed-page.bb-offcanvas-container h1')?.textContent.includes(name)), { cid, name: TAB_COURSES.find((c) => c[0] === cid)[1] }, { timeout: 15000 });
    const open = async (cid) => {
      if (await page.locator('.routed-page a').count()) await page.click('.routed-page a');
      await page.locator('[data-analytics-id="course.header.home"]').first().evaluate((e) => e.click());
      await page.click(`a[href="/ultra/courses/${cid}/outline"]`);
      await settled(cid);
    };
    await page.goto(`${TABS}/ultra/course`);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
    await page.click('a[href="/ultra/courses/_101_1/outline"]');
    await settled('_101_1');
    await open('_102_1');
    await open('_101_1');
    const cold = await page.evaluate(() => !document.querySelector('iframe[name="gz-ctab:_102_1"]'));
    // Timed in the page: from the press, the frame's 'drawn' (posted to the top, which this world hears too) and the first
    // animation frame that shows it.
    await page.evaluate(() => {
      const t = window.perfTab = { press: null, drawn: null, visible: null };
      document.addEventListener('pointerdown', (e) => {
        if (t.press != null || !e.target.closest?.('#gz-ctabs [data-course-id="_102_1"]')) return;
        t.press = performance.now();
        const look = () => {
          const f = document.querySelector('iframe[name="gz-ctab:_102_1"]');
          if (f && !f.inert && getComputedStyle(f).visibility === 'visible' && !document.querySelector('.gz-ctabs-pic')) t.visible = performance.now();
          else requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }, true);
      addEventListener('message', (e) => {
        const f = document.querySelector('iframe[name="gz-ctab:_102_1"]');
        if (t.press != null && t.drawn == null && e.data?.gzCtab === 'drawn' && f && e.source === f.contentWindow) t.drawn = performance.now();
      });
    });
    await page.click('#gz-ctabs [data-course-id="_102_1"]');
    await page.waitForFunction(() => window.perfTab.visible != null && window.perfTab.drawn != null, null, { timeout: 20000 }).catch(() => {});
    const t = await page.evaluate(() => window.perfTab);
    return { cold, drawnMs: t.drawn == null ? null : t.drawn - t.press, visibleMs: t.visible == null ? null : t.visible - t.press, errors };
  } finally { await page.close(); }
}

const snapshot = (page, on) => on ? page.evaluate(() => { document.dispatchEvent(new Event('gz-perf-read')); return JSON.parse(document.documentElement.getAttribute('data-gz-perf')); }) : null;
const listeners = async (cdp) => {
  const counts = {};
  for (const target of ['document', 'window']) {
    const { result } = await cdp.send('Runtime.evaluate', { expression: target });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', { objectId: result.objectId });
    counts[target] = listeners.length;
    await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  }
  return counts;
};

// Medians over the reps, per pass: Glaze off, on, and on with the instrumented copy (its timings carry the shim's cost; it
// alone times glaze:load).
function summarize(results) {
  const out = {};
  for (const [name, list] of [['off', results.filter((r) => r.glaze === 'off')], ['on', results.filter((r) => r.glaze === 'on' && !r.instrumented)], ['onInstrumented', results.filter((r) => r.instrumented)]]) {
    const s = list.map((r) => r.speed), m = (f) => median(s.map(f));
    const stages = Object.fromEntries(Object.keys(s[0].stages).map((k) => [k, { longTaskMs: m((x) => x.stages[k].longTaskMs), loafMs: m((x) => x.stages[k].loaf.ms), loafBlockingMs: m((x) => x.stages[k].loaf.blockingMs),
      extensionScriptMs: m((x) => x.stages[k].loaf.extensionScriptMs), pageScriptMs: m((x) => x.stages[k].loaf.pageScriptMs), cls: m((x) => x.stages[k].cls) }]));
    const loads = s.flatMap((x) => x.loads || []), byList = {};
    for (const l of loads) (byList[l.files.join('+')] ||= []).push(l.ms);
    const tabs = list.map((r) => r.courseTab).filter((t) => t && 'visibleMs' in t);
    out[name] = { reps: list.length, styledAt: m((x) => x.styledAt), fcp: m((x) => x.fcp), lcp: m((x) => x.lcp), cls: m((x) => x.cls), stages,
      idle: { taskMs: m((x) => x.idle.taskMs), scriptMs: m((x) => x.idle.scriptMs), recalcStyleMs: m((x) => x.idle.recalcStyleMs), layoutMs: m((x) => x.idle.layoutMs),
        heapUsedMB: m((x) => x.idle.heapUsedMB), rssTotalMB: m((x) => x.idle.rss?.totalMB), rssRendererMB: m((x) => x.idle.rss?.rendererMB) },
      glazeLoad: loads.length ? { count: loads.length, median: median(loads.map((l) => l.ms)), p90: quantile(loads.map((l) => l.ms), 0.9), failed: loads.filter((l) => !l.ok).length,
        byList: Object.fromEntries(Object.entries(byList).map(([k, v]) => [k, { n: v.length, median: median(v), p90: quantile(v, 0.9) }])) } : null,
      courseTab: tabs.length ? { reps: tabs.length, cold: tabs.every((t) => t.cold), drawnMs: median(tabs.map((t) => t.drawnMs)), visibleMs: median(tabs.map((t) => t.visibleMs)) } : null };
  }
  return out;
}

if (require.main === module) (async () => {
  assert.ok(Number.isInteger(reps) && reps > 0 && reps <= 5, 'PERF_REPS must be 1..5');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-perf-')));
  const results = [];
  let context;
  const cpuRate = neo ? Number(process.env.PERF_CPU_RATE || NEO_CPU_RATE) : null;
  if (neo) assert.ok(cpuRate >= 1, 'PERF_DEVICE=neo needs NEO_CPU_RATE (run checks/courses/neo-calibrate.js) or PERF_CPU_RATE');
  const pinned = neo ? pinCores() : null;
  const device = (speed || neo) ? { name: neo ? 'MacBook Neo' : 'runner', cpuRate, rateSource: neo ? (process.env.PERF_CPU_RATE ? 'PERF_CPU_RATE' : 'NEO_CPU_RATE') : null, runnerSpeedometer: RUNNER_SPEEDOMETER,
    neoChromeSpeedometer: neo ? NEO_CHROME_SPEEDOMETER : null, pinned, browserCores: null, viewport: neo ? { ...NEO_VIEWPORT, scale: NEO_SCALE } : { width: 1280, height: 900, scale: 1 },
    memoryBudgetMB: neo ? NEO_MEMORY_MB : null, unthrottled: neo ? ['the extension worker', 'options.html (the driver)'] : [] } : null;
  // PERF_SPEED adds a Glaze-off control (the plain extension with enabled: false) ahead of the two usual passes.
  const passes = speed ? [{ instrumented: false, glaze: 'off' }, { instrumented: false, glaze: 'on' }, { instrumented: true, glaze: 'on' }] : [{ instrumented: false }, { instrumented: true }];
  try {
    for (const { instrumented, glaze } of passes) {
      // The fixture's host, as the student's grant holds it (tools/dev/check-env.js staged).
      let ext = instrumented ? '' : require('../../tools/dev/check-env.js').staged(source, ['https://ultra.fixture.test/*', ...(speed ? [`${TABS}/*`] : [])]);
      if (instrumented) {
        ext = path.join(scratch, 'extension'); fs.mkdirSync(ext);
        const files = execFileSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
        for (const file of files) {
          const to = path.join(ext, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(source, file), to);
        }
        fs.writeFileSync(path.join(ext, 'perf-shim.js'), `(${instrument.toString()})(${speed});`);
        const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
        m.content_scripts.find((c) => c.js.includes('content/content-ultra.js')).js.unshift('perf-shim.js');
        m.host_permissions.push('https://ultra.fixture.test/*');
        fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
      }
      await require('../../tools/dev/wait-for-browser.js')();
      const profile = path.join(scratch, instrumented ? 'instrumented-profile' : glaze === 'off' ? 'plain-off-profile' : 'plain-profile');
      context = await chromium.launchPersistentContext(profile, {
        ...chromeLaunch, headless: true, viewport: neo ? NEO_VIEWPORT : { width: 1280, height: 900 }, ...(neo && { deviceScaleFactor: NEO_SCALE }), reducedMotion: 'reduce',
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--renderer-process-limit=1', '--disable-background-networking'],
      });
      context.setDefaultTimeout(10000);
      if (device && !device.browserCores) device.browserCores = browserCores(profile);
      let requests = [], blocked = [], tabRun = null;
      await context.route('**/*', (r) => {
        const u = new URL(r.request().url());
        if (u.protocol === 'chrome-extension:') return r.continue();
        // The course-tab open has its own site; what it leaves unanswered is reported with it, never asserted.
        if (tabRun) { if (tabsRoute(r, u)) return; tabRun.blocked.push(u.href); return r.abort(); }
        if (u.origin !== origin) { blocked.push(u.href); return r.abort(); }
        if (u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
        requests.push(u.pathname + u.search);
        if (u.pathname === '/learn/api/v1/users/me') return r.fulfill({ json: { id: '_900_1' } });
        if (u.pathname.includes('/memberships') && !u.pathname.includes('/exceptions')) return r.fulfill({ json: { results: [{ id: '_800_1', courseId: '_101_1', userId: '_900_1', dueDateExceptionType: 'Normal', course: { id: '_101_1', name: 'Sample course', color: { primaryColor: '#336699' }, availability: { available: 'Yes' } } }] } });
        if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: { results: [] } });
        blocked.push(u.href); return r.abort();
      });
      const opts = await context.newPage(); await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
      const reset = () => opts.evaluate(async (defaults) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(defaults); await chrome.storage.local.set({ ultra: ['https://ultra.fixture.test'] }); }, glaze === 'off' ? { ...D.GZ_DEFAULTS, enabled: false } : D.GZ_DEFAULTS);
      // PERF_DEVICE=neo: the Neo's CPU speed on the page and on every frame in a process of its own.
      const prepare = async (page) => {
        if (!cpuRate) return;
        await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
        const done = new WeakSet();
        page.on('framenavigated', async (frame) => {
          if (frame === page.mainFrame() || done.has(frame)) return;
          done.add(frame);
          try { await (await context.newCDPSession(frame)).send('Emulation.setCPUThrottlingRate', { rate: cpuRate }); } catch { /* in the page's process: throttled with it */ }
        });
      };
      await reset();
      for (let rep = 0; rep < reps; rep++) {
        if (rep) await reset();
        // Both speed passes load once Glaze's Ultra script is registered, so the off run still pays for its scripts.
        if (speed) await require('../../tools/dev/check-env.js').ultraReady(opts);
        const page = await context.newPage(); const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(() => {
          window.perfLongTasks = [];
          new PerformanceObserver((list) => window.perfLongTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true });
        });
        if (speed) await page.addInitScript(speedProbe);
        await prepare(page);
        requests = []; blocked = [];
        const start = Date.now(); await page.goto(origin + '/ultra/stream');
        if (glaze !== 'off') await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-font'));
        const initial = await settle(page, null);
        const initialElapsed = Date.now() - start;
        initial.snapshot = await snapshot(page, instrumented);
        const courses = await settle(page, 'course');
        courses.snapshot = await snapshot(page, instrumented);
        const outline = await settle(page, 'outline');
        outline.snapshot = await snapshot(page, instrumented);
        let lateProbe = null;
        if (process.env.PERF_LATE_PASSES) {
          const gradeReads = () => requests.filter((p) => p.startsWith('/learn/api/v1/courses/_101_1/gradebook/grades?')).length;
          const before = gradeReads();
          await page.evaluate(async () => {
            const row = document.querySelector('.content-list-item');
            for (let i = 0; i < 3; i++) { row.classList.toggle('native-status-update'); await new Promise((r) => setTimeout(r, 250)); }
          });
          lateProbe = { nativeUpdates: 3, extraGradeReads: gradeReads() - before };
        }
        const grades = await settle(page, 'grades');
        grades.snapshot = await snapshot(page, instrumented);
        const own = await settle(page, 'own');
        own.snapshot = await snapshot(page, instrumented);
        let speedResult;
        if (speed) {
          // Idle: 5 s with nothing happening, after the last stage settled. The fixed window is the measurement.
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const value = (list, name) => list.find((m) => m.name === name)?.value || 0;
          const before = (await cdp.send('Performance.getMetrics')).metrics, idleFrom = await page.evaluate(() => performance.now());
          await page.waitForTimeout(5000);
          const after = (await cdp.send('Performance.getMetrics')).metrics, idleTo = await page.evaluate(() => performance.now());
          const delta = (name) => 1000 * (value(after, name) - value(before, name));
          const idle = { ms: idleTo - idleFrom, taskMs: delta('TaskDuration'), scriptMs: delta('ScriptDuration'), recalcStyleMs: delta('RecalcStyleDuration'), layoutMs: delta('LayoutDuration'),
            heapUsedMB: value(after, 'JSHeapUsedSize') / 2 ** 20, heapTotalMB: value(after, 'JSHeapTotalSize') / 2 ** 20, nodes: value(after, 'Nodes'), rss: rss(profile) };
          await cdp.detach();
          const probe = await page.evaluate(() => ({ ...window.perfSpeed, longTasks: window.perfLongTasks, fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null }));
          const stages = { initial, courses, outline, grades, own };
          speedResult = { styledAt: probe.styledAt, fcp: probe.fcp, lcp: probe.lcp.at(-1)?.ms ?? null, lcpElement: probe.lcp.at(-1)?.el ?? null,
            stages: Object.fromEntries([...Object.entries(stages).map(([k, v]) => [k, stageSpeed(probe, v.window)]), ['idle', stageSpeed(probe, [idleFrom, idleTo])]]),
            cls: Object.values(stages).reduce((n, v) => n + stageSpeed(probe, v.window).cls, 0) + stageSpeed(probe, [idleFrom, idleTo]).cls,
            idle, loads: instrumented ? own.snapshot.loadMs : null, unsupported: Object.keys(probe).filter((k) => k.startsWith('no-')) };
          if (neo && idle.rss) idle.rss.ofBudget = idle.rss.totalMB / NEO_MEMORY_MB;
        }
        let lifecycle = null;
        if (process.env.PERF_CYCLES && rep === 0) {
          const cdp = await context.newCDPSession(page);
          const before = await listeners(cdp), beforeSnapshot = await snapshot(page, instrumented);
          for (let cycle = 0; cycle < 3; cycle++) { await settle(page, 'outline'); await settle(page, 'grades'); }
          lifecycle = { routes: 6, before, after: await listeners(cdp), beforeSnapshot, afterSnapshot: await snapshot(page, instrumented) };
          assert.deepEqual(lifecycle.after, lifecycle.before, 'six route replacements do not add global listeners');
          if (instrumented) assert.equal(lifecycle.afterSnapshot.observers.length, lifecycle.beforeSnapshot.observers.length, 'six route replacements reuse observer instances');
          await cdp.detach();
        }
        let scene = null;
        const sceneReload = process.env.PERF_SCENE && process.env.PERF_RELOAD && instrumented && rep === reps - 1;
        if (process.env.PERF_SCENE && glaze !== 'off' && (rep === 0 || sceneReload)) {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await opts.evaluate(async ({ bg, motion }) => chrome.storage.sync.set({ bg: { ...bg, kind: 'scene', scene: 'pumpkins' }, motion: { ...motion, followSystem: false } }), D.GZ_DEFAULTS);
          await page.waitForTimeout(500);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const before = (await cdp.send('Performance.getMetrics')).metrics;
          const beforeDraws = (await snapshot(page, instrumented))?.glDraws;
          await page.waitForTimeout(2000);
          const after = (await cdp.send('Performance.getMetrics')).metrics;
          const value = (list, name) => list.find((m) => m.name === name)?.value || 0;
          const sceneSnapshot = await snapshot(page, instrumented);
          scene = { canvas: await page.locator('#gz-scene').count(), duration: 2000, taskMs: 1000 * (value(after, 'TaskDuration') - value(before, 'TaskDuration')), draws: instrumented ? sceneSnapshot.glDraws - beforeDraws : null, snapshot: sceneSnapshot };
          assert.equal(scene.canvas, 1, 'the bundled scene actually started');
          if (instrumented) assert.ok(scene.draws > 0, 'the bundled scene drew frames during the sample');
          await cdp.detach();
          if (!sceneReload) await opts.evaluate(async ({ bg, motion }) => chrome.storage.sync.set({ bg, motion }), D.GZ_DEFAULTS);
        }
        let reload = null;
        if (process.env.PERF_RELOAD && instrumented && rep === reps - 1) {
          await opts.evaluate(() => chrome.runtime.reload()).catch(() => {});
          await page.waitForTimeout(300);
          const beforeMutation = await snapshot(page, instrumented);
          await page.waitForTimeout(300);
          const quiet = await snapshot(page, instrumented);
          if (sceneReload) assert.equal(quiet.glDraws, beforeMutation.glDraws, 'the old scene stops drawing before the next core mutation');
          await page.evaluate(() => document.getElementById('main-content-inner').append(document.createElement('p')));
          await page.waitForTimeout(300);
          reload = { beforeMutation, quiet, afterMutation: await snapshot(page, instrumented) };
          assert.equal(beforeMutation.runtime, false, 'the extension was actually reloaded');
          assert.equal(beforeMutation.contextOn, false, 'context checks stop before the next core mutation');
          assert.equal(reload.afterMutation.contextOn, false);
          if (sceneReload) assert.equal(reload.afterMutation.glDraws, quiet.glDraws, 'native mutations do not restart the disposed scene');
        }
        const paints = await page.evaluate(() => performance.getEntriesByType('paint').map((e) => ({ name: e.name, ms: e.startTime })));
        results.push({ instrumented, rep, initialElapsed, initial, courses, outline, lateProbe, grades, own, lifecycle, scene, reload, requests, blocked, paints, errors, ...(speed && { glaze, speed: speedResult }) });
        console.log(JSON.stringify({ instrumented, rep, initialElapsed, initial: initial.elapsed, courses: courses.elapsed, outline: outline.elapsed, grades: grades.elapsed, own: own.elapsed, requests: requests.length, errors }));
        await page.close();
        if (speed) {
          const row = results.at(-1);
          if (glaze === 'off') row.courseTab = { skipped: 'Glaze off draws no course tabs' };
          else if (instrumented) row.courseTab = { skipped: 'timed in the plain pass' };
          else {
            tabRun = { blocked: [] };
            try { row.courseTab = { ...await courseTabOpen(context, opts, prepare), blocked: tabRun.blocked }; } catch (e) { row.courseTab = { error: e.message.split('\n')[0], blocked: tabRun.blocked }; } finally { tabRun = null; }
          }
        }
      }
      await context.close(); context = null;
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
    const summary = speed ? summarize(results) : undefined;
    fs.writeFileSync(output, JSON.stringify({ source, revision, ...(device && { device }), ...(summary && { summary }), results }, null, 2));
    if (summary) console.log(JSON.stringify({ revision, device, summary }, null, 2));
    console.log(output);
    for (const result of results) {
      assert.deepEqual(result.errors, [], 'the fixture run has no uncaught page/extension exception');
      assert.deepEqual(result.blocked, [], 'the fixture run attempts no unfixed network response');
    }
    if (process.env.PERF_REQUIRE_NO_HOLD) for (const result of results) for (const stage of ['courses', 'outline', 'grades']) {
      assert.equal(result[stage].held, 0, `${stage}: SPA content must remain visible`);
      assert.equal(result[stage].stillHeld, false, `${stage}: no lingering SPA hold`);
    }
    if (process.env.PERF_REQUIRE_QUIET_OWN) for (const result of results.filter((r) => r.instrumented)) {
      const key = 'document:[class*="course-color-"]';
      assert.equal(result.own.snapshot.selectors[key], result.grades.snapshot.selectors[key], 'owned widget updates must not rescan native course colors');
    }
    if (process.env.PERF_REQUIRE_LATE_CACHE) for (const result of results) assert.equal(result.lateProbe.extraGradeReads, 0, 'native due-row updates reuse the successful empty late answer');
  } finally { await context?.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
