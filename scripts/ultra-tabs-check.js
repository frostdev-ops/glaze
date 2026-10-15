// Ultra's course tabs, headless (B8): the real extension on a synthetic Ultra (test/fixtures/ultra-course.html, built from
// parity/spikes/B8.md: the sticky two-row course bar, course panels, items opened over them, an SPA router), served under a
// made-up school's address. Nothing leaves the machine: every other request is aborted and DNS is mapped to nowhere.
// It opens courses, then checks: tabs open, switch, close (×, middle click, Delete), pin, move (keyboard, drag) and cap;
// a switch shows the course's copy at once and fades to the live page, back where the tab was (page and scroll), and never
// into an assessment; the strip above, between and below the bar's rows, on an item panel and above a page, never over
// Ultra's own controls; the copies are dropped when the tabs are switched off and when another account signs in; and no
// request is made for any of it. Screenshots: each placement, Frost (dark) and Paper (light), 1280 and 375 px wide.
//   NODE_PATH=/path/to/node_modules node scripts/ultra-tabs-check.js [out dir for screenshots]   (needs playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const G = require('../defaults.js');
require('../lib/coursetabs.js');

const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-tabs-'));
const CHROME = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const PAGE = fs.readFileSync(path.join(__dirname, '..', 'test/fixtures/ultra-course.html'), 'utf8');
const SITE = 'https://bb.school.test';
const CSS_URL = 'https://cdn.school.test/ultra/uiv4001.0.0-rel.37_abc/app.css';
const COURSES = [['_101_1', 'Computer Science I', 'FA26-CS101-01', 1], ['_102_1', 'Spanish 110', 'FA26-SPAN110-02', 2], ['_103_1', 'Calculus II', 'FA26-MATH201-01', 4],
  ['_104_1', 'World History', 'FA26-HIST150-01', 6], ['_105_1', 'Biology Lab', 'FA26-BIO120-01', 8]];
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b8-'));
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
    executablePath: CHROME, headless: true, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
  });
  let user = '_42_1';
  let phase = 'first-load', switchCount = 0;
  const requestDetails = [];
  const requests = []; // everything the page asked for besides Glaze's own extension files
  try {
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      requests.push(`${u.host}${u.pathname}`);
      requestDetails.push({ phase, method: route.request().method(), origin: u.origin, path: u.pathname, search: u.search, page: route.request().frame().url(), type: route.request().resourceType() });
      if (u.origin === SITE && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: PAGE });
      if (u.href === CSS_URL) return route.fulfill({ contentType: 'text/css', body: '.course-content-container{min-height:100vh}\n.panel-wrap{overscroll-behavior:contain}', headers: { 'cache-control': 'no-store' } });
      if (['/fixture/image.png', '/fixture/background.png'].includes(u.pathname) && [SITE, 'https://cdn.school.test'].includes(u.origin)) return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5FQAAAAASUVORK5CYII=', 'base64'), headers: { 'cache-control': 'no-store' } });
      if (u.origin === SITE && u.pathname === '/learn/api/v1/users/me') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: user }) });
      if (u.origin === SITE && /^\/learn\/api\/v1\/users\/_\d+_1\/memberships/.test(u.pathname)) {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: COURSES.map(([id, name, code, i]) => ({ courseId: id, courseCardColorIndex: i, userHasHidden: false, role: 'S', course: { id, courseId: code, displayId: code, name, isOrganization: false } })) }) });
      }
      if (u.origin === SITE && /^\/learn\/api\/v1\/courses\/_\d+_1\/gradebook\/grades$/.test(u.pathname)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: [
        { columnId: '_8140_1', status: 'NotAttempted', column: { id: '_8140_1', contentId: '_8120_1', assessmentSubtype: 'Assignment', name: 'Writing overview' } },
        { columnId: '_8141_1', status: 'NotAttempted', column: { id: '_8141_1', contentId: '_8121_1', assessmentSubtype: 'Test', name: 'Test overview' } },
      ] }) });
      if (u.origin === SITE && u.pathname.startsWith('/learn/api/')) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return route.abort();
    });
    const opts = await ctx.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    const settings = (o = {}) => opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); },
      { ...G.GZ_DEFAULTS, colors: G.GZ_PRESETS.find(([n]) => n === (o.preset || 'Frost'))[1], preset: o.preset || 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, ...o.enhance }, tabs: { ...G.GZ_SANITIZE({}).tabs, ...o.tabs }, nav: { ...G.GZ_DEFAULTS.nav, ...o.nav } });
    const session = () => opts.evaluate(() => chrome.storage.session.get(null));
    let cdp, world;
    const worlds = [];
    const isolated = async (func) => {
      if (!cdp) {
        cdp = await ctx.newCDPSession(page);
        cdp.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
        cdp.on('Runtime.executionContextDestroyed', ({ executionContextId }) => { if (world === executionContextId) world = null; });
        cdp.on('Runtime.executionContextsCleared', () => { world = null; worlds.length = 0; });
        await cdp.send('Runtime.enable');
      }
      if (!world) {
        for (const candidate of worlds.filter((x) => !x.auxData?.isDefault)) {
          const result = await cdp.send('Runtime.evaluate', { expression: 'typeof GZ_CTABS', contextId: candidate.id }).catch(() => null);
          if (result?.result.value === 'object') world = candidate.id;
        }
        if (!world) throw new Error('Glaze isolated content world missing');
      }
      const result = await cdp.send('Runtime.evaluate', { expression: `(${String(func)})()`, contextId: world, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    await settings(process.env.GZ_B8_REQUEST_PROBE ? { enhance: { newcontent: false } } : {});
    const page = await ctx.newPage();
    page.on('pageerror', (error) => console.error(`page error: ${error.stack || error.message}`));
    const strip = () => page.evaluate(() => {
      const s = document.getElementById('gz-ctabs');
      return s && { at: s.dataset.at, tabs: [...s.querySelectorAll('[role="tab"]')].map((e) => ({ cid: e.dataset.courseId, sel: e.getAttribute('aria-selected') === 'true', pin: e.hasAttribute('data-pin'), label: e.getAttribute('aria-label') })), note: s.querySelector('.gz-ctabs-note')?.textContent || '' };
    });
    const order = async () => (await strip())?.tabs.map((x) => x.cid).join(' ');
    const settled = (cid) => page.waitForFunction(({ cid, name }) => !document.getElementById('gz-ctabs-snap') && !document.querySelector('.spinner, [data-gz-loading]')
      && document.querySelector(`#gz-ctabs [role="tab"][data-course-id="${cid}"][aria-selected="true"]`)
      && ([...document.querySelectorAll('div.bb-course-navigation a[href]')].some((a) => a.getAttribute('href').startsWith(`/ultra/courses/${cid}/`))
        || document.querySelector('.routed-page.bb-offcanvas-container h1')?.textContent.includes(name)), { cid, name: COURSES.find((c) => c[0] === cid)?.[1] }, { timeout: 10000 });
    const open = async (cid) => {
      const previous = phase; phase = `native-open:${cid}`;
      try {
        await page.click('[data-analytics-id="course.header.home"]').catch(() => {});
        await page.waitForSelector(`a[href="/ultra/courses/${cid}/outline"]`);
        await page.click(`a[href="/ultra/courses/${cid}/outline"]`);
        await settled(cid);
      } finally { phase = previous; }
    };
    const switchTab = async (cid) => {
      const previous = phase; phase = `tab-switch:${++switchCount}:${cid}`;
      try { await page.click(`#gz-ctabs [data-course-id="${cid}"]`); await settled(cid); } finally { phase = previous; }
    };
    const scroller = () => page.evaluate(() => document.querySelector('.course-content-container > .panel-wrap')?.scrollTop);

    // ---- opening courses; the strip outside a course ----
    await page.goto(`${SITE}/ultra/course`);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
    await page.click('a[href="/ultra/courses/_101_1/outline"]');
    await settled('_101_1');
    const routedChecks = async () => {
      // All reads below are native feature reads or fixture navigation; RESTORE labels only the active inert copy.
      await open('_101_1');
      await isolated(async () => {
        if (!globalThis.__b8bNet) {
          globalThis.__b8bNet = [];
          const original = fetch;
          globalThis.fetch = (...args) => { __b8bNet.push({ url: String(args[0]), method: args[1]?.method || 'GET', active: GZ_CTABS.showing(), page: location.href, at: performance.now(), stack: new Error().stack }); return original(...args); };
        }
        const until = performance.now() + 3000;
        while (!GZ_SITE_ULTRA.assignment('_101_1', '_8120_1') && performance.now() < until) await new Promise((r) => setTimeout(r, 25));
        if (!GZ_SITE_ULTRA.assignment('_101_1', '_8120_1')) throw new Error('native gradebook did not establish the cached Assignment');
        return true;
      });
      await open('_102_1'); await switchTab('_101_1');
      const native = async (cls) => {
        phase = `B8b:NATIVE:${cls}`;
        await page.click(cls); await settled('_101_1');
        ok((await strip())?.at === 'routed', `strip remains on ${cls}`);
        ok(await page.evaluate(() => !document.querySelector('div.bb-course-navigation, .panel-wrap, #main-content, #main-content-inner')), `${cls} uses the full routed structure`);
      };
      const position = (top) => page.evaluate((n) => {
        const main = document.querySelector('main[class*="contentGridArea"]');
        let sc = main;
        while (sc !== document.body && !/auto|scroll|overlay/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
        (sc === document.body ? document.scrollingElement : sc).scrollTop = n;
      }, top);
      const saved = (route, top) => opts.waitForFunction(async ({ route, top }) => {
        const all = await chrome.storage.local.get(null);
        return Object.values(all).some((v) => v?.tabs?.some((t) => t.cid === '_101_1' && t.path === route && t.top === top));
      }, { route, top });
      const restore = async (route, top, label) => {
        await switchTab('_102_1');
        phase = `B8b:RESTORE:${label}`;
        const start = requestDetails.length;
        await page.click('#gz-ctabs [data-course-id="_101_1"]');
        await page.waitForSelector('#gz-ctabs-snap', { timeout: 500 });
        ok(await isolated(() => GZ_CTABS.showing()), `${label} displays its inert copy immediately`);
        await isolated(async () => {
          const until = performance.now() + 10000;
          while (GZ_CTABS.showing() && performance.now() < until) await new Promise((r) => setTimeout(r, 5));
          if (GZ_CTABS.showing()) throw new Error('cached view did not release');
          return true;
        });
        phase = `B8b:LIVE:${label}`;
        ok(requestDetails.length === start, `${label} restoration starts no requests (${JSON.stringify(requestDetails.slice(start))})`);
        await settled('_101_1');
        await page.waitForFunction((n) => {
          const main = document.querySelector('main[class*="contentGridArea"]'); let sc = main;
          while (sc !== document.body && !/auto|scroll|overlay/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
          return Math.abs((sc === document.body ? document.scrollingElement : sc).scrollTop - n) < 2;
        }, top);
        ok(await page.evaluate(() => location.pathname + location.search) === route, `${label} keeps its exact route/query`);
        ok((await strip())?.at === 'routed', `${label} keeps the strip after settlement`);
      };
      await page.click('.b8b-folder');
      await opts.waitForFunction(async () => (await chrome.storage.local.get('coursePlace')).coursePlace?._101_1?.open?.includes('_8130_1'));
      await native('a.b8b-document');
      const doc = '/ultra/courses/_101_1/document/_8110_1?view=content&state=view&parentId=_8130_1';
      phase = 'B8b:NATIVE:history'; await page.goBack(); await settled('_101_1');
      ok(await page.evaluate(() => location.pathname.endsWith('/outline')), 'Back from a routed document restores the native outline');
      await page.waitForSelector('.b8b-folder[aria-expanded="true"]');
      ok(true, 'the existing Your place path restores the open folder after the routed document');
      await page.goForward(); await settled('_101_1');
      ok(await page.evaluate(() => location.pathname + location.search) === doc && (await strip())?.at === 'routed', 'Forward restores the routed document with its strip and query');
      for (const at of ['above', 'between', 'below']) {
        await opts.evaluate(async (at) => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, at } }); }, at);
        await page.waitForFunction((a) => {
          const strip = document.getElementById('gz-ctabs'), hd = document.querySelector('[class*="panelHeaderContainerRoot"]');
          return strip?.dataset.at === 'routed' && (a === 'above' ? strip.nextElementSibling === hd : strip.previousElementSibling === hd);
        }, at);
        ok(true, `routed header placement ${at}`);
      }
      await position(470); await saved(doc, 470); await restore(doc, 470, 'document-nested-scroll');
      phase = 'B8b:NATIVE:document-close'; await page.click('.routed-page a'); await settled('_101_1');
      await native('a.b8b-document-self');
      const self = '/ultra/courses/_101_1/document/_8112_1?view=content&state=view';
      await position(430); await saved(self, 430); await restore(self, 430, 'document-main-scroll');
      phase = 'B8b:NATIVE:document-close'; await page.click('.routed-page a'); await settled('_101_1');
      await native('a.b8b-document-fallback');
      const fallback = '/ultra/courses/_101_1/document/_8111_1?view=content&state=view';
      await position(520); await saved(fallback, 520); await restore(fallback, 520, 'document-page-scroll');
      phase = 'B8b:NATIVE:document-close'; await page.click('.routed-page a'); await settled('_101_1');
      await native('a.b8b-assignment');
      const overview = '/ultra/courses/_101_1/assessment/_8120_1/overview?courseId=_101_1';
      await position(390); await saved(overview, 390); await restore(overview, 390, 'cached-assignment-overview');
      await isolated(() => { globalThis.__b8bClassifier = GZ_SITE_ULTRA.assignment; GZ_SITE_ULTRA.assignment = () => false; return true; });
      await switchTab('_102_1'); await switchTab('_101_1');
      ok(await page.evaluate(() => location.pathname.endsWith('/outline')), 'a stored overview cannot authorize a target after its positive cache check is lost');
      await isolated(() => { GZ_SITE_ULTRA.assignment = __b8bClassifier; return true; });
      for (const cls of ['a.b8b-test', 'a.b8b-unknown']) {
        if (await page.locator('.routed-page a').count()) { phase = 'B8b:NATIVE:overview-close'; await page.click('.routed-page a'); await settled('_101_1'); }
        await native(cls); await switchTab('_102_1'); await switchTab('_101_1');
        ok(await page.evaluate(() => location.pathname.endsWith('/outline')), `${cls} returns quietly to the outline`);
      }
      ok(await page.evaluate(() => window.__attempts === 0), 'no routed overview starts or resumes an attempt');
      const nativeNet = await isolated(() => __b8bNet);
      ok(!nativeNet.some((r) => r.active), `routed snapshot callbacks initiate no fetch (${JSON.stringify(nativeNet.filter((r) => r.active))})`);
      const report = requestDetails.filter((r) => r.phase.startsWith('B8b:'));
      fs.writeFileSync(path.join(out, 'B8b-requests.json'), JSON.stringify(report, null, 2));
      fs.writeFileSync(path.join(out, 'B8b-fetch-starts.json'), JSON.stringify(nativeNet, null, 2));
      phase = 'B8b:complete';
    };
    if (process.env.GZ_B8B_FOCUSED) {
      await routedChecks(); console.log(`${fails ? 'FAILED' : 'passed'} routed document/Assignment controls`); process.exitCode = fails ? 1 : 0; return;
    }
    if (process.env.GZ_B8_REQUEST_PROBE) await isolated(() => {
      globalThis.__b8Net = []; globalThis.__b8SeenWrites = [];
      const stored = chrome.storage.local.set;
      chrome.storage.local.set = (...args) => { if (args[0]?.seenContent) __b8SeenWrites.push({ at: performance.now(), active: GZ_CTABS.showing?.(), page: location.href, native: document.querySelector('div.bb-course-navigation a.js-course-outline-tool')?.getAttribute('href'), value: args[0].seenContent }); return stored.apply(chrome.storage.local, args); };
      globalThis.__b8Pending = 0; globalThis.__b8Settled = performance.now();
      const original = fetch;
      globalThis.fetch = async (...args) => {
        const over = document.getElementById('gz-ctabs-snap');
        __b8Net.push({ url: String(args[0]), at: performance.now(), page: location.href, active: GZ_CTABS.showing?.(), overlay: !!over, opacity: over?.style.opacity,
          spinner: !!document.querySelector('.spinner'), native: document.querySelector('div.bb-course-navigation a.js-course-outline-tool')?.getAttribute('href'), stack: new Error().stack });
        __b8Pending++;
        try { return await original(...args); } finally { __b8Pending--; __b8Settled = performance.now(); }
      };
      return true;
    });
    let s = await strip();
    ok(s.tabs.length === 1 && s.tabs[0].sel && s.tabs[0].label === 'Computer Science I', `a course opened gets a tab, named and selected (${JSON.stringify(s.tabs)})`);
    ok(s.at === 'above', `above the course's bar by default (${s.at})`);
    phase = 'native-navigation';
    // Gradebook, scrolled: the place the tab keeps.
    await page.click('a.js-course-grades-tool');
    await page.waitForFunction(() => location.pathname.endsWith('/grades') && !document.querySelector('.spinner'));
    await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 600; });
    await page.waitForTimeout(800);
    // Synthetic content that must not run or fetch again when cloned or replayed.
    await page.evaluate(async () => {
      window.__snapshotConstructors = 0;
      customElements.define('b8-snapshot-probe', class extends HTMLElement { constructor() { super(); window.__snapshotConstructors++; } });
      const root = document.querySelector('.course-content-container section.course');
      root.append(document.createElement('b8-snapshot-probe'));
      root.append(document.createElement('b8-late-snapshot-probe'));
      window.__snapshotBuiltinConstructors = 0;
      customElements.define('b8-snapshot-button', class extends HTMLButtonElement { constructor() { super(); window.__snapshotBuiltinConstructors++; } }, { extends: 'button' });
      root.append(document.createElement('button', { is: 'b8-snapshot-button' }));
      root.append(document.createElement('button', { is: 'b8-late-snapshot-button' }));
      const box = document.createElement('div'); box.dataset.token = 'invented-secret'; box.style.backgroundImage = 'url(https://cdn.school.test/fixture/background.png)'; root.append(box);
      for (const origin of [location.origin, 'https://cdn.school.test']) {
        const img = new Image(); img.src = origin + '/fixture/image.png'; root.append(img); await img.decode();
      }
    });
    await page.click('[data-analytics-id="course.header.home"]');
    await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'page');
    ok(true, 'outside a course, the strip shows above the page');
    await page.click('a[href="/ultra/courses/_102_1/outline"]');
    await settled('_102_1');
    await open('_103_1');
    await page.evaluate(() => { window.__lateSnapshotConstructors = 0; customElements.define('b8-late-snapshot-probe', class extends HTMLElement { constructor() { super(); window.__lateSnapshotConstructors++; } }); window.__lateBuiltinConstructors = 0; customElements.define('b8-late-snapshot-button', class extends HTMLButtonElement { constructor() { super(); window.__lateBuiltinConstructors++; } }, { extends: 'button' }); });
    ok(await order() === '_101_1 _102_1 _103_1', `each course opened gets a tab, in order (${await order()})`);

    console.log('isolated platform: ' + JSON.stringify(await isolated(() => ({ nullRegistry: customElements === null, styleIterator: typeof document.documentElement.style[Symbol.iterator] }))));

    // ---- a switch: the copy at once, then the live page, back where the tab was ----
    const before = requests.length;
    phase = 'snapshot-switch';
    await page.click('#gz-ctabs [data-course-id="_101_1"]');
    const snapAt = await page.waitForSelector('#gz-ctabs-snap', { timeout: 300 }).then(() => true, () => false);
    ok(snapAt, 'a click on a tab shows its course\'s copy at once');
    ok((await strip()).tabs.find((x) => x.cid === '_101_1')?.sel, 'the selected tab updates as soon as its snapshot appears');
    await page.screenshot({ path: path.join(out, 'switch-copy-frost-1280.png') });
    ok(await page.evaluate(() => !!document.querySelector('.spinner')), 'while Ultra is still building the live page (its spinner is under the copy)');
    await settled('_101_1');
    ok(await page.evaluate(() => location.pathname) === '/ultra/courses/_101_1/grades', 'the live page is the tab\'s own place (Gradebook)');
    await page.waitForTimeout(500);
    ok(Math.abs((await scroller()) - 600) <= 2, `and its scroll (${await scroller()})`);
    ok(requests.length === before, `no request for the switch (${requests.slice(before).join(', ') || 'none'})`);
    ok(await page.evaluate(() => window.__lateSnapshotConstructors === 0), 'a tag registered after capture runs no constructor when replay connects');
    ok(await page.evaluate(() => window.__snapshotConstructors === 1), 'capturing/replaying a defined custom element runs no constructor');
    const builtinCounts = await page.evaluate(() => ({ defined: __snapshotBuiltinConstructors, late: __lateBuiltinConstructors }));
    ok(builtinCounts.defined === 1 && builtinCounts.late === 0, `customized built-ins run no capture or replay constructors (${JSON.stringify(builtinCounts)})`);
    const copies = Object.values(await session()).filter((v) => v?.layers).map((v) => JSON.stringify(v));
    ok(!copies.some((x) => x.includes('invented-secret')), 'snapshots discard arbitrary data attributes and credentials');
    if (process.env.GZ_B8_REQUEST_PROBE) {
      // A real SPA can leave the previous outline's rows in place under the restored URL while its next view loads.
      await page.click('a.js-course-outline-tool');
      await page.waitForFunction(() => !document.querySelector('.spinner') && document.querySelector('.content-list-item'));
      await opts.evaluate(async () => { const { enhance } = await chrome.storage.sync.get('enhance'); await chrome.storage.sync.set({ enhance: { ...enhance, newcontent: true } }); });
      const quiet = () => isolated(async () => {
        const start = performance.now();
        while (performance.now() - start < 3000) {
          if (!__b8Pending && performance.now() - __b8Settled > 500) return { pending: __b8Pending, quietFor: performance.now() - __b8Settled, timeOrigin: performance.timeOrigin, page: location.href };
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('fixture reads did not become quiescent');
      });
      await isolated(async () => { const start = performance.now(); while (!GZ_CTX.settings().enhance.newcontent && performance.now() - start < 3000) await new Promise((r) => setTimeout(r, 25)); if (!GZ_CTX.settings().enhance.newcontent) throw new Error('newcontent did not activate'); return true; });
      console.log('before restore quiescence: ' + JSON.stringify(await quiet()));
      const seen = await isolated(() => __b8Net.length);
      await page.evaluate(() => addEventListener('popstate', (e) => {
        e.stopImmediatePropagation();
        document.querySelector('section.course').append(document.createElement('div'));
        setTimeout(() => dispatchEvent(new PopStateEvent('popstate')), 900);
      }, { capture: true, once: true }));
      await switchTab('_102_1');
      console.log('after restore quiescence: ' + JSON.stringify(await quiet()));
      const trace = await isolated(() => __b8Net);
      fs.writeFileSync(path.join(out, 'fetch-starts.json'), JSON.stringify(trace, null, 2));
      console.log('restore fetch starts: ' + JSON.stringify(trace.slice(seen)));
      const writes = await isolated(() => __b8SeenWrites);
      fs.writeFileSync(path.join(out, 'seen-writes.json'), JSON.stringify(writes, null, 2));
      console.log('seenContent writes: ' + JSON.stringify(writes));
      ok(!trace.slice(seen).some((r) => r.active && r.url.includes('/contents')), 'no automatic contents read starts while the cached view is active');
      ok(trace.slice(seen).some((r) => !r.active && !r.spinner && r.native === '/ultra/courses/_102_1/outline' && r.url.includes('/_102_1/contents')), 'newcontent still reads the genuine live target after the copy is released');
      process.exitCode = fails ? 1 : 0;
      return;
    }
    if (process.env.GZ_B8_FOCUSED) {
      phase = 'account-boundary';
      user = '_43_1';
      const other = await ctx.newPage();
      await other.goto(`${SITE}/ultra/courses/_103_1/outline`);
      await other.waitForSelector('#gz-ctabs [role="tab"]');
      await other.waitForFunction(() => !document.querySelector('.spinner, [data-gz-loading]') && [...document.querySelectorAll('div.bb-course-navigation a[href]')].some((a) => a.getAttribute('href') === '/ultra/courses/_103_1/outline'));
      console.log('new account settled: ' + JSON.stringify(await other.evaluate(() => ({ timeOrigin: performance.timeOrigin, spinner: !!document.querySelector('.spinner'), loading: !!document.querySelector('[data-gz-loading]') }))));
      await page.waitForTimeout(300);
      ok(await page.locator('#gz-ctabs').count() === 0 && await isolated(() => GZ_CTABS.snapshots()) === 0, 'another document changing account clears the old in-page copies and strip');
      ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctabs') && !sessionStorage.getItem('gz-ctabs')), 'account revocation leaves no page reservation or phantom strip gap');
      await isolated(() => { GZ_CTABS.sync(true); return true; });
      await page.waitForTimeout(100);
      ok(await page.locator('#gz-ctabs').count() === 0, 'an older document cannot reenable its cached account');
      ok((await session())[`snapwho:${SITE}`]?.uid === '_43_1', 'the newer document retains account ownership');
      await other.click('[data-analytics-id="course.header.home"]');
      await other.click('a[href="/ultra/courses/_102_1/outline"]');
      await other.waitForFunction(() => !document.querySelector('.spinner') && document.querySelector('#gz-ctabs [data-course-id="_102_1"][aria-selected="true"]'));
      await page.waitForTimeout(200);
      ok(Object.keys(await session()).some((k) => k.startsWith('snap:')), 'the newer account still captures viewed courses');
      const epochBefore = (await session())[`snapwho:${SITE}`]?.epoch || 0;
      phase = 'rapid-toggle';
      await opts.evaluate(async () => {
        const { enhance } = await chrome.storage.sync.get('enhance');
        await chrome.storage.sync.set({ enhance: { ...enhance, tabs: false } });
        await chrome.storage.sync.set({ enhance: { ...enhance, tabs: true } });
      });
      await page.waitForTimeout(350);
      const state = await session();
      ok(!Object.keys(state).some((k) => k.startsWith('snap:')) && state[`snapwho:${SITE}`]?.epoch > epochBefore, 'rapid off/on clears the observed cache generation');
      await other.waitForSelector('#gz-ctabs [role="tab"]');
      ok(await other.locator('#gz-ctabs').count() === 1 && await page.locator('#gz-ctabs').count() === 0, 'rapid off/on keeps one current-account strip and cannot revive the old account');
      await other.close();
      console.log(`${fails ? 'FAILED' : 'passed'} focused snapshot/account/toggle controls`);
      process.exitCode = fails ? 1 : 0;
      return;
    }
    phase = 'interactions';

    // ---- never back into an assessment ----
    await page.click('a.js-course-outline-tool');
    await page.waitForFunction(() => location.pathname.endsWith('/outline') && document.querySelector('a[href*="/assessment/"]'));
    await page.click('a[href*="/assessment/"]');
    await page.waitForFunction(() => location.pathname.includes('/assessment/'));
    const views = await page.evaluate(() => window.__assessmentViews);
    await switchTab('_102_1');
    await switchTab('_101_1');
    ok(await page.evaluate(() => location.pathname) === '/ultra/courses/_101_1/outline', `a tab left in an assessment goes back to the course's tool (${await page.evaluate(() => location.pathname)})`);
    ok(await page.evaluate(() => [window.__assessmentViews, window.__attempts]).then(([v, a]) => v === views && a === 0), 'the assessment wasn\'t opened again, nor an attempt started');

    // ---- an item opened over the course: the strip at its panel ----
    await page.click('a[href*="/document/"]');
    await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'nested');
    const nested = await page.evaluate(() => { const r = document.getElementById('gz-ctabs').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return !!e?.closest('#gz-ctabs'); });
    ok(nested, 'on a document opened over the course, the strip is on top, at its panel');
    await page.screenshot({ path: path.join(out, 'nested-frost-1280.png') });
    await page.click('.panel-header a');
    await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'above');

    // ---- pin, move, close ----
    await page.hover('#gz-ctabs [data-course-id="_103_1"]');
    await page.click('#gz-ctabs [data-course-id="_103_1"] .gz-ctab-pin');
    s = await strip();
    ok(s.tabs[0].cid === '_103_1' && s.tabs[0].pin && /pinned/.test(s.tabs[0].label), `a pinned tab goes first and says so (${await order()})`);
    await page.focus('#gz-ctabs [data-course-id="_101_1"]');
    await page.keyboard.press('Shift+ArrowRight');
    ok(await order() === '_103_1 _102_1 _101_1', `Shift+→ moves a tab (${await order()})`);
    ok(await page.evaluate(() => document.activeElement?.dataset.courseId) === '_101_1', 'and it keeps the focus');
    await page.keyboard.press('ArrowLeft');
    ok(await page.evaluate(() => document.activeElement?.dataset.courseId) === '_102_1', '← moves the focus');
    await page.keyboard.press('Delete');
    ok(await order() === '_103_1 _101_1', `Delete closes the focused tab (${await order()})`);
    await open('_104_1');
    await switchTab('_101_1');
    await page.click('#gz-ctabs [data-course-id="_104_1"]', { button: 'middle' });
    ok(await order() === '_103_1 _101_1', `a middle click closes a tab (${await order()})`);
    await page.waitForTimeout(200);
    ok(!Object.keys(await session()).some((k) => k.endsWith('|_104_1')), 'closing a tab also drops its worker snapshot');
    // Dragging: the last unpinned tab to the first unpinned place.
    await open('_104_1');
    const box = async (cid) => page.locator(`#gz-ctabs [data-course-id="${cid}"]`).boundingBox();
    const from = await box('_104_1');
    const to = await box('_101_1');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x + 10) - (from.x + from.width / 2)) * i / 8, from.y + from.height / 2);
    await page.mouse.up();
    ok(await order() === '_103_1 _104_1 _101_1', `a tab drags into place, within its group (${await order()})`);
    await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
    const rtlFrom = await box('_101_1'), rtlTo = await box('_104_1');
    await page.mouse.move(rtlFrom.x + rtlFrom.width / 2, rtlFrom.y + rtlFrom.height / 2);
    await page.mouse.down();
    await page.mouse.move(rtlTo.x + rtlTo.width * .75, rtlTo.y + rtlTo.height / 2, { steps: 8 });
    await page.mouse.up();
    ok(await order() === '_103_1 _101_1 _104_1', `drag follows the rendered right-to-left order (${await order()})`);
    await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
    // The cap: past it, the least recently used unpinned tab closes, with a word.
    await settings({ tabs: { cap: 3 } });
    await page.waitForTimeout(400);
    await open('_105_1');
    s = await strip();
    ok(s.tabs.length === 3 && !s.tabs.some((x) => x.cid === '_101_1') && s.tabs.some((x) => x.cid === '_103_1'), `past the cap, the oldest unpinned tab closes (${await order()})`);
    ok(/Closed Computer Science I/.test(s.note), `and the strip says which ("${s.note}")`);
    await page.setViewportSize({ width: 375, height: 860 });
    await page.screenshot({ path: path.join(out, 'cap-word-frost-375.png') });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForFunction(() => !document.querySelector('#gz-ctabs .gz-ctabs-note')?.textContent, null, { timeout: 8000 });

    // ---- placements, light and dark, wide and narrow ----
    await settings({ tabs: { cap: 8 } });
    for (const preset of ['Frost', 'Paper']) {
      for (const at of ['above', 'between', 'below']) {
        for (const width of [1280, 375]) {
          await settings({ preset, tabs: { at, cap: 8, color: at === 'between' ? 'tint' : at === 'below' ? 'theme' : 'off', mark: at === 'below' ? 'icon' : 'dot', shape: at === 'between' ? 'pill' : 'tab' } });
          await page.setViewportSize({ width, height: 860 });
          await page.waitForFunction((a) => document.getElementById('gz-ctabs')?.dataset.at === a && !document.querySelector('[data-gz-loading], [data-gz-reveal]'), at);
          await page.mouse.move(5, 850);
          await page.waitForTimeout(300);
          const g = await page.evaluate(() => {
            const r = (e) => e.getBoundingClientRect();
            const st = document.getElementById('gz-ctabs');
            const one = document.querySelector('course-page-header');
            const two = document.querySelector('.js-course-navigation');
            const hit = (e) => { const b = r(e); const x = document.elementFromPoint(b.left + Math.min(60, b.width / 2), b.top + b.height / 2); return !!x && e.contains(x); };
            return { s: r(st).toJSON(), one: r(one).toJSON(), two: r(two).toJSON(), free: hit(one) && hit(two) && hit(st), wide: document.documentElement.scrollWidth - innerWidth };
          });
          const tag = `${at} ${preset} ${width}px`;
          const where = { above: g.s.bottom <= g.one.top + 1, between: g.one.bottom <= g.s.top + 1 && g.s.bottom <= g.two.top + 1, below: g.two.bottom <= g.s.top + 1 }[at];
          ok(where, `${tag}: the strip is ${at === 'between' ? 'between the rows' : `${at} the bar`} (strip ${Math.round(g.s.top)}–${Math.round(g.s.bottom)}, rows ${Math.round(g.one.top)}, ${Math.round(g.two.top)}–${Math.round(g.two.bottom)})`);
          ok(g.free, `${tag}: it covers none of the bar, and nothing covers it`);
          ok(g.wide <= 0, `${tag}: no sideways scroll`);
          await page.screenshot({ path: path.join(out, `${at}-${preset.toLowerCase()}-${width}.png`) });
        }
      }
      // Scrolled: the strip stays with the sticky bar.
      await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 900; });
      await page.waitForTimeout(150);
      ok(await page.evaluate(() => { const r = document.getElementById('gz-ctabs').getBoundingClientRect(); return r.top >= -1 && r.bottom < 200; }), `${preset}: scrolled, the strip stays at the top with the bar`);
      await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 0; });
      // An item panel and a page outside a course, in this palette.
      await settings({ preset });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.click('a.js-course-outline-tool').catch(() => {});
      await page.waitForSelector('a[href*="/document/"]');
      await page.click('a[href*="/document/"]');
      await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'nested');
      for (const at of ['above', 'between', 'below']) {
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: 860 });
          await settings({ preset, tabs: { at } });
          await page.waitForTimeout(150);
          const g = await page.evaluate(() => {
            const strip = document.getElementById('gz-ctabs'), header = strip.parentElement.querySelector('.panel-header');
            const a = strip.getBoundingClientRect(), b = header.getBoundingClientRect();
            const hit = document.elementFromPoint(a.left + Math.min(40, a.width / 2), a.top + a.height / 2);
            return { strip: a.toJSON(), header: b.toJSON(), hit: !!hit?.closest('#gz-ctabs'), at: strip.dataset.at };
          });
          const clear = at === 'above' ? g.strip.bottom <= g.header.top + 1 : g.header.bottom <= g.strip.top + 1;
          ok(g.at === 'nested' && clear && g.hit && g.strip.right <= width + 1, `nested panel ${at}/${preset}/${width}px: strip and native header stay clear and reachable`);
          await page.screenshot({ path: path.join(out, `nested-${at}-${preset.toLowerCase()}-${width}.png`) });
        }
      }
      await page.click('.panel-header a');
      await page.click('[data-analytics-id="course.header.home"]');
      await page.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'page');
      await page.screenshot({ path: path.join(out, `page-${preset.toLowerCase()}-1280.png`) });
      await page.click('a[href="/ultra/courses/_105_1/outline"]');
      await settled('_105_1');
    }

    // B7b's real global float consumes B8's keep-clear marker; B7c's nav sizes must leave both on-screen.
    phase = 'cross-feature-layout';
    await opts.evaluate(() => chrome.storage.local.set({ widgetLayout: { boards: { pages: [{ id: 'timer', on: true, size: 's', x: 0, y: 0 }] } } }));
    const crossLayout = [];
    for (const size of ['small', 'medium', 'large']) {
      for (const at of ['above', 'between', 'below']) {
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: 860 });
          await settings({ enhance: { widgets: true }, tabs: { at }, nav: { size } });
          await page.waitForSelector('#gz-float section.gz-w[data-tile="timer"]');
          await page.waitForTimeout(150);
          const g = await page.evaluate(() => {
            const r = (sel) => document.querySelector(sel).getBoundingClientRect().toJSON();
            return { timer: r('#gz-float section.gz-w[data-tile="timer"]'), strip: r('#gz-ctabs'), bar: r('div.bb-course-navigation'), nav: r('.MuiDrawer-paper'), copies: document.querySelectorAll('section.gz-w[data-tile="timer"]').length, marker: document.getElementById('gz-ctabs').hasAttribute('data-gz-keep-clear'), width: innerWidth };
          });
          const left = Math.max(0, g.nav.right), top = Math.max(g.bar.bottom, g.strip.bottom);
          ok(g.marker && g.copies === 1 && g.timer.left >= left - 1 && g.timer.top >= top - 1 && g.timer.right <= width + 1, `B7b float/B8 ${at}/B7c ${size}/${width}px: one timer stays clear and on screen`);
          crossLayout.push({ size, at, width, ...g });
        }
      }
    }
    fs.writeFileSync(path.join(out, 'cross-layout.json'), JSON.stringify(crossLayout, null, 2));
    await settings();
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.waitForTimeout(250);
    phase = 'interactions';
    await routedChecks();

    // ---- the copies: in the worker's memory only, dropped on switch-off and on another account ----
    let kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(kept.length >= 1 && kept.every((k) => k.startsWith(`snap:${SITE}|_`)), `copies are kept in storage.session, for this site (${kept.length})`);
    await settings({ enhance: { tabs: false } });
    await page.waitForFunction(() => !document.getElementById('gz-ctabs'));
    await page.waitForTimeout(300);
    kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(!kept.length, `switched off: the strip goes, and every copy (${kept.length} left)`);
    ok(await page.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctabs') && !sessionStorage.getItem('gz-ctabs')), 'switching off clears the page reservation too');
    await settings();
    await page.waitForSelector('#gz-ctabs [role="tab"]');
    await switchTab('_103_1');
    await page.waitForTimeout(300);
    ok(Object.keys(await session()).some((k) => k.startsWith('snap:')), 'on again, a switch keeps a copy again');
    user = '_43_1';
    phase = 'account-reload';
    await page.reload();
    await page.waitForSelector('#gz-ctabs [role="tab"]');
    await page.waitForTimeout(500);
    kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(!kept.length && ((await session())[`snapwho:${SITE}`]?.uid || (await session())[`snapwho:${SITE}`]) === '_43_1', `another account on the site: the last one's copies go (${kept.length} left)`);
    ok(await order() === '_103_1', `and it starts its own list (${await order()})`);
    // Native documents/stylesheet loads are separate from resource-free snapshot replay. Other enabled Glaze features
    // can read their own course endpoints; every request, destination, method and current page is recorded.
    const asked = requestDetails.filter((r) => r.type === 'document' && r.origin === SITE);
    ok(asked.length === 2, `the only page loads so far are the student's own (${asked.length})`);
    ok(requestDetails.every((r) => r.method === 'GET'), 'all measured fixture traffic is GET');
    ok(!requestDetails.some((r) => r.phase === 'snapshot-switch'), 'the snapshot switch made no network request with no-store resources');

    // A router that removes its header and then stalls still reaches the bounded full-load fallback.
    phase = 'fallback-preparation';
    await page.click('a.js-course-grades-tool');
    await page.waitForFunction(() => location.pathname.endsWith('/grades') && !document.querySelector('.spinner'));
    await page.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 410; });
    await page.waitForTimeout(800);
    await open('_104_1');
    await page.evaluate(() => {
      window.__b8StopRoute = (e) => { document.querySelector('div.bb-course-navigation')?.remove(); e.stopImmediatePropagation(); };
      window.addEventListener('popstate', window.__b8StopRoute, true);
    });
    phase = 'fallback-reload';
    const fallbackAt = Date.now();
    const oldDocument = await page.evaluate(() => performance.timeOrigin);
    const reloaded = page.waitForRequest((r) => r.isNavigationRequest() && r.resourceType() === 'document' && r.url().startsWith(SITE + '/ultra/courses/_103_1/'), { timeout: 6000 }).then(() => true, () => false);
    await page.click('#gz-ctabs [data-course-id="_103_1"]');
    const fellBack = await reloaded;
    if (fellBack) await page.waitForFunction((old) => performance.timeOrigin !== old, oldDocument, { timeout: 5000 });
    ok(fellBack && Date.now() - fallbackAt < 5000, `missing header triggers the 2.5s reload fallback (${Date.now() - fallbackAt}ms; loaded=${fellBack})`);
    if (!fellBack) {
      phase = 'probe-recovery-reload';
      await page.evaluate(() => window.removeEventListener('popstate', window.__b8StopRoute, true));
      await page.reload();
    }
    await settled('_103_1');
    ok(await page.evaluate(() => location.pathname.endsWith('/courses/_103_1/grades')), 'the fallback arrives at the selected course tool');
    await page.waitForTimeout(400);
    ok(Math.abs((await scroller()) - 410) <= 2, `the full-load fallback restores remembered scroll (${await scroller()})`);

    // Quiet state and repeated route redraws: own DOM writes must settle, with one strip and no listener growth.
    phase = 'redraw-probes';
    await isolated(() => {
      globalThis.__b8 = { syncs: 0, helds: 0, adds: 0, removes: 0, storeAdds: 0, storeRemoves: 0, runtimeAdds: 0, runtimeRemoves: 0, timeouts: new Set() };
      const sync = GZ_CTABS.sync, held = GZ_CTABS.held;
      GZ_CTABS.sync = (...a) => { __b8.syncs++; return sync(...a); };
      GZ_CTABS.held = (...a) => { __b8.helds++; return held(...a); };
      for (const name of ['addEventListener', 'removeEventListener']) {
        const native = EventTarget.prototype[name];
        EventTarget.prototype[name] = function(...args) { if (String(new Error().stack).includes('features/coursetabs.js')) __b8[name === 'addEventListener' ? 'adds' : 'removes']++; return native.apply(this, args); };
      }
      for (const name of ['addListener', 'removeListener']) {
        const native = chrome.storage.onChanged[name];
        chrome.storage.onChanged[name] = (...args) => { if (String(new Error().stack).includes('features/coursetabs.js')) __b8[name === 'addListener' ? 'storeAdds' : 'storeRemoves']++; return native.apply(chrome.storage.onChanged, args); };
      }
      for (const name of ['addListener', 'removeListener']) {
        const native = chrome.runtime.onMessage[name];
        chrome.runtime.onMessage[name] = (...args) => { if (String(new Error().stack).includes('features/coursetabs.js')) __b8[name === 'addListener' ? 'runtimeAdds' : 'runtimeRemoves']++; return native.apply(chrome.runtime.onMessage, args); };
      }
      const schedule = setTimeout, cancel = clearTimeout;
      globalThis.setTimeout = (f, ms, ...a) => {
        const own = String(new Error().stack).includes('features/coursetabs.js');
        let id; id = schedule(() => { __b8.timeouts.delete(id); f(...a); }, ms);
        if (own) __b8.timeouts.add(id); return id;
      };
      globalThis.clearTimeout = (id) => { __b8.timeouts.delete(id); return cancel(id); };
      return true;
    });
    for (let i = 0; i < 12; i++) {
      await page.evaluate((i) => { history.pushState(null, '', location.origin + '/ultra/courses/_103_1/' + (i % 2 ? 'outline' : 'grades')); dispatchEvent(new PopStateEvent('popstate')); }, i);
      await settled('_103_1');
    }
    await page.goBack(); await settled('_103_1');
    await page.goForward(); await settled('_103_1');
    for (let i = 0; i < 4; i++) { await settings({ enhance: { tabs: false } }); await page.waitForTimeout(100); await settings(); await page.waitForSelector('#gz-ctabs'); }
    await page.waitForTimeout(2000);
    const quietBefore = await isolated(() => ({ syncs: __b8.syncs, helds: __b8.helds }));
    await page.waitForTimeout(1200);
    const quietAfter = await isolated(() => ({ syncs: __b8.syncs, helds: __b8.helds, netListeners: __b8.adds - __b8.removes, netStoreListeners: __b8.storeAdds - __b8.storeRemoves, netRuntimeListeners: __b8.runtimeAdds - __b8.runtimeRemoves, timers: __b8.timeouts.size }));
    ok(quietAfter.syncs - quietBefore.syncs <= 2, `quiet after redraws: ${quietAfter.syncs - quietBefore.syncs} sync calls in 1.2s`);
    ok(quietAfter.netListeners === 0, `toggle cycles retain no extra listeners (${quietAfter.netListeners})`);
    ok(quietAfter.netStoreListeners === 0, `toggle cycles retain no extra storage listeners (${quietAfter.netStoreListeners})`);
    ok(quietAfter.netRuntimeListeners === 0, `routes/toggles retain no extra runtime listeners (${quietAfter.netRuntimeListeners})`);
    ok(await page.locator('#gz-ctabs').count() === 1, 'redraws, Back and Forward keep exactly one strip');
    fs.writeFileSync(path.join(out, 'redraw-metrics.json'), JSON.stringify({ quietBefore, quietAfter }, null, 2));

    // A full all-pinned list must stay bounded and quiet without hiding the native course.
    await opts.evaluate(async () => {
      const tabs = Array.from({ length: 40 }, (_, i) => ({ cid: `_${i + 1}_1`, name: `Pinned ${i + 1}`, code: '', pin: true, at: i, path: `/ultra/courses/_${i + 1}_1/outline`, top: 0 }));
      await chrome.storage.local.set({ 'ctabs:https://bb.school.test:_43_1': { tabs } });
    });
    await page.waitForTimeout(800);
    const fullBefore = await isolated(() => __b8.syncs);
    await page.waitForTimeout(1200);
    ok(await page.locator('#gz-ctabs [role="tab"]').count() === 40, '40 pinned courses keep the hard bound without evicting one');
    ok((await strip()).note.includes('Close or unpin'), 'a full list explains how to add another tab');
    ok(await isolated(() => __b8.syncs) - fullBefore <= 2, 'a full pinned list does not cause a redraw loop');
    ok(await page.locator('div.bb-course-navigation .js-course-navigation').count() === 1, 'the native course tools remain available at the hard tab bound');

    // Sign-out must stay cleared through delayed capture, pagehide and later core passes.
    phase = 'signout';
    await page.click('.MuiDrawer-paper a[href="#"]');
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(2000);
    await isolated(() => { GZ_CTABS.sync(true); return true; });
    ok(!Object.keys(await session()).some((k) => k.startsWith('snap:')), 'sign-out followed by pagehide and delayed capture keeps the worker empty');
    ok(await isolated(() => GZ_CTABS.snapshots()) === 0 && await page.locator('#gz-ctabs').count() === 0, 'sign-out leaves no local snapshots or strip, including a later sync');
    fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(requestDetails, null, 2));


    // ---- the editor: its section, and the strip on the preview's Ultra mock, live ----
    await settings({ tabs: { at: 'between', color: 'tint', shape: 'pill' } });
    await opts.setViewportSize({ width: 1280, height: 900 });
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html#tabs`);
    const pv = opts.frameLocator('#preview');
    await pv.locator('#gz-ctabs[data-at="between"] [role="tab"]').first().waitFor({ timeout: 8000 });
    ok(await pv.locator('#gz-ctabs [role="tab"]').count() === 3, 'the editor\'s preview shows the strip, between the mock bar\'s rows');
    await opts.locator('label:has(> input[name="tabs.at"][value="below"])').click();
    await pv.locator('#gz-ctabs[data-at="below"]').waitFor({ timeout: 4000 }).then(() => ok(true, 'and follows an edit before it is saved'), () => ok(false, 'and follows an edit before it is saved'));
    await opts.locator('#tabs').scrollIntoViewIfNeeded();
    await opts.screenshot({ path: path.join(out, 'editor-frost-1280.png') });
  } finally {
    fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(requestDetails, null, 2));
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${fails ? 'FAILED' : 'passed'}; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})();
