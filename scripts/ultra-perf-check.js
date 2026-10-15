// Synthetic Ultra only, with the real unpacked extension. Run under nice -n 15 with Playwright on NODE_PATH.
// EXT selects a checkout; PERF_REPS defaults to 3. Every profile and instrumented extension copy is temporary.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const source = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const output = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-ultra-perf.json'));
const chrome = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const origin = 'https://ultra.fixture.test';
const reps = Number(process.env.PERF_REPS || 3);
const D = require(path.join(source, 'defaults.js'));
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

// This runs FIRST in the extension's isolated world, never as a page script. It is added only to a temporary copy.
function instrument() {
  const metrics = { observers: [], selectors: {}, styleReads: 0, storage: [], loads: [] };
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
  for (const area of ['local', 'sync']) {
    const get = chrome.storage[area].get.bind(chrome.storage[area]);
    chrome.storage[area].get = (...args) => { metrics.storage.push({ area, keys: args[0] }); return get(...args); };
  }
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (...args) => {
    if (args[0]?.type === 'glaze:load') metrics.loads.push(args[0].files);
    return send(...args);
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
    return { elapsed: performance.now() - start, lastMutation: last - start, changes, held, stillHeld: !!document.querySelector('[data-gz-loading]'), longTasks: window.perfLongTasks, nodes: document.body.querySelectorAll('*').length, rows: document.querySelectorAll('.native-row, .content-list-item, .course-element-card').length };
  }, { change, body: routeBody(change) });
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

(async () => {
  assert.ok(Number.isInteger(reps) && reps > 0 && reps <= 5, 'PERF_REPS must be 1..5');
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-perf-')));
  const results = [];
  let context;
  try {
    for (const instrumented of [false, true]) {
      let ext = source;
      if (instrumented) {
        ext = path.join(scratch, 'extension'); fs.mkdirSync(ext);
        const files = execFileSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean);
        for (const file of files) {
          const to = path.join(ext, file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(source, file), to);
        }
        fs.writeFileSync(path.join(ext, 'perf-shim.js'), `(${instrument.toString()})();`);
        const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
        m.content_scripts.find((c) => c.matches.includes('https://*/ultra')).js.unshift('perf-shim.js');
        fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
      }
      context = await chromium.launchPersistentContext(path.join(scratch, instrumented ? 'instrumented-profile' : 'plain-profile'), {
        executablePath: chrome, headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce',
        args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--renderer-process-limit=1', '--disable-background-networking'],
      });
      context.setDefaultTimeout(10000);
      let requests = [], blocked = [];
      await context.route('**/*', (r) => {
        const u = new URL(r.request().url());
        if (u.protocol === 'chrome-extension:') return r.continue();
        if (u.origin !== origin) { blocked.push(u.href); return r.abort(); }
        if (u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
        requests.push(u.pathname + u.search);
        if (u.pathname === '/learn/api/v1/users/me') return r.fulfill({ json: { id: '_900_1' } });
        if (u.pathname.includes('/memberships') && !u.pathname.includes('/exceptions')) return r.fulfill({ json: { results: [{ id: '_800_1', courseId: '_101_1', userId: '_900_1', dueDateExceptionType: 'Normal', course: { id: '_101_1', name: 'Sample course', color: { primaryColor: '#336699' }, availability: { available: 'Yes' } } }] } });
        if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: { results: [] } });
        blocked.push(u.href); return r.abort();
      });
      const opts = await context.newPage(); await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
      await opts.evaluate(async (defaults) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(defaults); }, D.GZ_DEFAULTS);
      for (let rep = 0; rep < reps; rep++) {
        if (rep) await opts.evaluate(async (defaults) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(defaults); }, D.GZ_DEFAULTS);
        const page = await context.newPage(); const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.addInitScript(() => {
          window.perfLongTasks = [];
          new PerformanceObserver((list) => window.perfLongTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true });
        });
        requests = []; blocked = [];
        const start = Date.now(); await page.goto(origin + '/ultra/stream');
        await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-font'));
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
        let lifecycle = null;
        if (process.env.PERF_CYCLES && rep === 0) {
          const cdp = await context.newCDPSession(page);
          const before = await listeners(cdp), beforeSnapshot = await snapshot(page, instrumented);
          for (let cycle = 0; cycle < 3; cycle++) { await settle(page, 'outline'); await settle(page, 'grades'); }
          lifecycle = { routes: 6, before, after: await listeners(cdp), beforeSnapshot, afterSnapshot: await snapshot(page, instrumented) };
          await cdp.detach();
        }
        let scene = null;
        if (process.env.PERF_SCENE && rep === 0) {
          await page.emulateMedia({ reducedMotion: 'no-preference' });
          await opts.evaluate(async ({ bg, motion }) => chrome.storage.sync.set({ bg: { ...bg, kind: 'scene', scene: 'pumpkins' }, motion: { ...motion, followSystem: false } }), D.GZ_DEFAULTS);
          await page.waitForTimeout(500);
          const cdp = await context.newCDPSession(page);
          await cdp.send('Performance.enable');
          const before = (await cdp.send('Performance.getMetrics')).metrics;
          await page.waitForTimeout(2000);
          const after = (await cdp.send('Performance.getMetrics')).metrics;
          const value = (list, name) => list.find((m) => m.name === name)?.value || 0;
          scene = { canvas: await page.locator('#gz-scene').count(), duration: 2000, taskMs: 1000 * (value(after, 'TaskDuration') - value(before, 'TaskDuration')), snapshot: await snapshot(page, instrumented) };
          await cdp.detach();
          await opts.evaluate(async ({ bg, motion }) => chrome.storage.sync.set({ bg, motion }), D.GZ_DEFAULTS);
        }
        let reload = null;
        if (process.env.PERF_RELOAD && instrumented && rep === reps - 1) {
          await opts.evaluate(() => chrome.runtime.reload()).catch(() => {});
          await page.waitForTimeout(300);
          const beforeMutation = await snapshot(page, instrumented);
          await page.evaluate(() => document.getElementById('main-content-inner').append(document.createElement('p')));
          await page.waitForTimeout(300);
          reload = { beforeMutation, afterMutation: await snapshot(page, instrumented) };
          assert.equal(beforeMutation.runtime, false, 'the extension was actually reloaded');
          assert.equal(beforeMutation.contextOn, false, 'context checks stop before the next core mutation');
          assert.equal(reload.afterMutation.contextOn, false);
        }
        const paints = await page.evaluate(() => performance.getEntriesByType('paint').map((e) => ({ name: e.name, ms: e.startTime })));
        results.push({ instrumented, rep, initialElapsed, initial, courses, outline, lateProbe, grades, own, lifecycle, scene, reload, requests, blocked, paints, errors });
        console.log(JSON.stringify({ instrumented, rep, initialElapsed, initial: initial.elapsed, courses: courses.elapsed, outline: outline.elapsed, grades: grades.elapsed, own: own.elapsed, requests: requests.length, errors }));
        await page.close();
      }
      await context.close(); context = null;
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ source, revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim(), results }, null, 2));
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
