// Ultra's course tabs, headless (B8): the real extension on a synthetic Ultra (test/fixtures/ultra-course.html, built from
// the B8 spike: the sticky two-row course bar, course panels, items opened over them, an SPA router), served under a
// made-up school's address. Nothing leaves the machine: every other request is aborted and DNS is mapped to nowhere.
// It opens courses, then checks: tabs open, switch, close (×, middle click, Delete), pin, move (keyboard, drag) and cap;
// a first switch loads the saved course in a live frame; later switches keep that document, route, scroll and edits;
// an assessment is never reopened or started by a warm switch; the strip above, between and below the bar's rows, on an item panel and above a page, never over
// Ultra's own controls; the pictures and frames are dropped when the tabs are switched off and when another account signs in; and no
// warm return reloads its document or resources. Screenshots: each placement, Frost (dark) and Paper (light), 1280 and 375 px wide.
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
const chromeLaunch = require('./check-env.js').chromeLaunch();
let PAGE = fs.readFileSync(path.join(__dirname, '..', 'test/fixtures/ultra-course.html'), 'utf8');
const SITE = 'https://bb.school.test';
const CSS_URL = 'https://cdn.school.test/ultra/uiv4001.0.0-rel.37_abc/app.css';
const COURSES = [['_101_1', 'Computer Science I', 'FA26-CS101-01', 1], ['_102_1', 'Spanish 110', 'FA26-SPAN110-02', 2], ['_103_1', 'Calculus II', 'FA26-MATH201-01', 4],
  ['_104_1', 'World History', 'FA26-HIST150-01', 6], ['_105_1', 'Biology Lab', 'FA26-BIO120-01', 8]];
if (process.env.GZ_B8B_FOCUSED) { PAGE = PAGE.replace("name: 'Computer Science I'", "name: '209940-ZZ3456-007'"); COURSES[0][1] = '209940-ZZ3456-007'; }
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails++; };

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b8-'));
  await require('./wait-for-browser.js')();
  const ctx = await chromium.launchPersistentContext(path.join(tmp, 'p'), {
    ...chromeLaunch, headless: true, viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
  });
  let user = '_42_1', holdCourse = '', releaseCourse;
  let courseHeld = false;
  let phase = 'first-load', switchCount = 0;
  const requestDetails = [];
  const requests = []; // everything the page asked for besides Glaze's own extension files
  try {
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      requests.push(`${u.host}${u.pathname}`);
      requestDetails.push({ phase, method: route.request().method(), origin: u.origin, path: u.pathname, search: u.search, page: route.request().frame().url(), type: route.request().resourceType() });
      if (u.origin === SITE && u.pathname.startsWith('/ultra')) {
        if (u.pathname.startsWith(`/ultra/courses/${holdCourse}/`)) {
          courseHeld = true; await new Promise((r) => { releaseCourse = r; });
        }
        return route.fulfill({ contentType: 'text/html', body: PAGE });
      }
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
    let page = null;
    // A change the page crossfades (lib/motion.js swap) takes every hit until the crossfade ends: measure after it.
    const settings = async (o) => {
      await store(o);
      if (!page) return;
      await page.waitForTimeout(80);
      await page.waitForFunction(() => !document.documentElement.matches(':active-view-transition'), null, { timeout: 3000 }).catch(() => {});
    };
    const store = (o = {}) => opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(s); await chrome.storage.local.set({ ultra: ['https://bb.school.test'] }); },
      { ...G.GZ_DEFAULTS, colors: G.GZ_PRESETS.find(([n]) => n === (o.preset || 'Frost'))[1], preset: o.preset || 'Frost', navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, enhance: { ...G.GZ_DEFAULTS.enhance, sidebar: false, ...o.enhance }, tabs: { ...G.GZ_SANITIZE({}).tabs, ...o.tabs }, nav: { ...G.GZ_DEFAULTS.nav, ...o.nav } });
    const session = () => opts.evaluate(() => chrome.storage.session.get(null));
    const pictured = (cid, route) => opts.evaluate(async ({ cid, route }) => {
      const until = performance.now() + 10000;
      while (performance.now() < until) {
        if (Object.values(await chrome.storage.session.get(null)).some((v) => v?.cid === cid && v.path === route && v.shot)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`no picture captured for ${cid} at ${route}`);
    }, { cid, route });
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
        const { frameTree } = await cdp.send('Page.getFrameTree');
        for (const candidate of worlds.filter((x) => !x.auxData?.isDefault && x.auxData?.frameId === frameTree.frame.id)) {
          const result = await cdp.send('Runtime.evaluate', { expression: 'typeof GZ_CTABS', contextId: candidate.id }).catch(() => null);
          if (result?.result.value === 'object') world = candidate.id;
        }
        if (!world) throw new Error('Glaze isolated content world missing');
      }
      const result = await cdp.send('Runtime.evaluate', { expression: `(${String(func)})()`, contextId: world, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + result.exceptionDetails.exception?.description);
      return result.result.value;
    };
    await settings();
    page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    let target = page;
    page.on('pageerror', (error) => console.error(`page error: ${error.stack || error.message}`));
    const strip = () => target.evaluate(() => {
      const s = document.getElementById('gz-ctabs');
      return s && { at: s.dataset.at, tabs: [...s.querySelectorAll('[role="tab"]')].map((e) => ({ cid: e.dataset.courseId, sel: e.getAttribute('aria-selected') === 'true', pin: e.hasAttribute('data-pin'), label: e.getAttribute('aria-label') })), note: s.querySelector('.gz-ctabs-note')?.textContent || '' };
    });
    const order = async () => (await strip())?.tabs.map((x) => x.cid).join(' ');
    const settled = (cid) => target.waitForFunction(({ cid, name }) => !document.querySelector('.spinner, [data-gz-loading], [data-gz-placing]')
      && document.querySelector(`#gz-ctabs [role="tab"][data-course-id="${cid}"][aria-selected="true"]`)
      && ([...document.querySelectorAll('div.bb-course-navigation a[href]')].some((a) => a.getAttribute('href').startsWith(`/ultra/courses/${cid}/`))
        || document.querySelector('.routed-page.bb-offcanvas-container h1')?.textContent.includes(name)), { cid, name: COURSES.find((c) => c[0] === cid)?.[1] }, { timeout: 10000 });
    const open = async (cid) => {
      const previous = phase; phase = `native-open:${cid}`;
      try {
        if (await target.locator('.routed-page a').count()) await target.click('.routed-page a');
        await target.click('[data-analytics-id="course.header.home"]');
        target = page;
        await target.waitForSelector(`a[href="/ultra/courses/${cid}/outline"]`);
        await target.click(`a[href="/ultra/courses/${cid}/outline"]`);
        await settled(cid);
      } finally { phase = previous; }
    };
    const showing = async (cid) => {
      const own = await page.evaluate((cid) => location.pathname.startsWith(`/ultra/courses/${cid}/`), cid);
      if (!own) await page.locator(`iframe[name="gz-ctab:${cid}"]`).waitFor({ state: 'attached' });
      target = own ? page : page.frames().find((f) => f.name() === `gz-ctab:${cid}`);
      if (!target) throw new Error(`no live frame for ${cid}`);
      if (!own) await page.locator(`iframe[name="gz-ctab:${cid}"]`).waitFor({ state: 'visible' });
      await settled(cid);
      await page.waitForFunction((name) => {
        const f = name && document.querySelector(`iframe[name="${name}"]`);
        return name ? f && !f.inert && getComputedStyle(f).visibility === 'visible' && !document.querySelector('.gz-ctabs-pic')
          : !document.querySelector('#gz-ctabs-frames[data-on]');
      }, own ? '' : `gz-ctab:${cid}`, { timeout: 10000 });
    };
    const switchTab = async (cid) => {
      const previous = phase; phase = `tab-switch:${++switchCount}:${cid}`;
      try { await target.click(`#gz-ctabs [data-course-id="${cid}"]`); await showing(cid); } finally { phase = previous; }
    };
    const scroller = () => target.evaluate(() => document.querySelector('.course-content-container > .panel-wrap')?.scrollTop);

    // ---- opening courses; the strip outside a course ----
    await page.goto(`${SITE}/ultra/course`);
    await target.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
    await target.click('a[href="/ultra/courses/_101_1/outline"]');
    await settled('_101_1');
    const routedChecks = async () => {
      // Native navigation builds each page once; tab returns must retain that live document.
      const quietTimer = async () => {
        await opts.evaluate(async () => {
          const { widgetLayout } = await chrome.storage.local.get('widgetLayout');
          if (widgetLayout?.boards?.pages) await chrome.storage.local.set({ widgetLayout: { ...widgetLayout, boards: { ...widgetLayout.boards, pages: widgetLayout.boards.pages.map((x) => x.id === 'timer' ? { ...x, on: false } : x) } } });
        });
        await target.waitForFunction(() => !document.querySelector('#gz-float section.gz-w[data-tile="timer"]'));
      };
      await quietTimer();
      await open('_102_1');
      await open('_101_1');
      if (process.env.GZ_B8B_FOCUSED) {
        const label = await target.locator('#gz-ctabs [data-course-id="_101_1"]').evaluate((e) => ({ text: e.querySelector('.gz-ctab-name').textContent, title: e.title, aria: e.getAttribute('aria-label') }));
        ok(label.text === 'ZZ 3456' && label.title.includes('209940-ZZ3456-007') && label.aria.includes('209940-ZZ3456-007') && label.aria.includes('FA26-CS101-01'), `auto short label retains original metadata (${JSON.stringify(label)})`);
        const choice = async (label, nick = '') => {
          await opts.evaluate(async ({ label, nick }) => {
            const { tabs, courses } = await chrome.storage.sync.get(['tabs', 'courses']);
            await chrome.storage.sync.set({ tabs: { ...tabs, label }, courses: { ...courses, names: { ...courses.names, _101_1: nick } } });
          }, { label, nick });
        };
        for (const mode of ['short', 'name', 'code']) {
          await choice(mode, 'My reading');
          await target.waitForFunction(() => document.querySelector('#gz-ctabs [data-course-id="_101_1"] .gz-ctab-name')?.textContent === 'My reading');
          const metadata = await target.locator('#gz-ctabs [data-course-id="_101_1"]').getAttribute('aria-label');
          ok(metadata.includes('209940-ZZ3456-007') && metadata.includes('FA26-CS101-01'), `nickname wins in ${mode} while full metadata remains accessible`);
        }
        for (const [mode, expected] of [['name', '209940-ZZ3456-007'], ['code', 'FA26-CS101-01'], ['short', 'ZZ 3456']]) {
          await choice(mode);
          await target.waitForFunction((text) => document.querySelector('#gz-ctabs [data-course-id="_101_1"] .gz-ctab-name')?.textContent === text, expected);
          ok(true, `explicit ${mode} choice displays ${expected}`);
        }
        await open('_102_1');
        await opts.evaluate(async () => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, cap: 2 } }); });
        await open('_103_1');
        ok((await strip()).note.includes('Closed ZZ 3456'), 'the tab-cap note uses the automatic short display label');
        await opts.evaluate(async () => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, cap: 8 } }); });
        await open('_101_1');
      }
      const native = async (cls) => {
        phase = `B8b:NATIVE:${cls}`;
        await target.evaluate(() => { const sc = document.querySelector('.course-content-container > .panel-wrap'); if (sc) sc.scrollTop = 0; });
        await target.click(cls); await settled('_101_1');
        ok((await strip())?.at === 'routed', `strip remains on ${cls}`);
        ok(await target.evaluate(() => !document.querySelector('div.bb-course-navigation, .panel-wrap, #main-content, #main-content-inner')), `${cls} uses the full routed structure`);
      };
      const position = async (top) => {
        const measured = await target.evaluate((n) => {
        const main = document.querySelector('main[class*="contentGridArea"]');
        let sc = main;
        while (sc !== document.body && !/auto|scroll|overlay/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
        sc = sc === document.body ? document.scrollingElement : sc;
        const range = sc.scrollHeight - sc.clientHeight;
        sc.scrollTop = n;
        return { tag: sc.localName, cls: sc.className, client: sc.clientHeight, height: sc.scrollHeight, range, requested: n, actual: sc.scrollTop };
        }, top);
        ok(measured.range > top && measured.actual === top, `native routed scroller accepts its saved position (${JSON.stringify(measured)})`);
      };
      const saved = (route, top, cid = '_101_1') => opts.evaluate(async ({ route, top, cid }) => {
        const until = performance.now() + 4000;
        while (performance.now() < until) {
          const all = await chrome.storage.local.get(null);
          if (Object.values(all).some((v) => v?.tabs?.some((t) => t.cid === cid && t.path === route && t.top === top))) return true;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error(`tab place was not saved: ${cid} ${route} ${top}`);
      }, { route, top, cid });
      const restore = async (route, top, label, cid = '_101_1') => {
        const birth = await target.evaluate(() => performance.timeOrigin);
        await switchTab(cid === '_101_1' ? '_102_1' : '_101_1');
        phase = `B8b:RETURN:${label}`;
        const start = requestDetails.length;
        await switchTab(cid);
        ok(await target.evaluate(() => performance.timeOrigin) === birth, `${label} retains the live document`);
        ok(!requestDetails.slice(start).some((r) => r.type === 'document' || r.page === target.url()), `${label} return loads no document or resources for that course`);
        await target.waitForFunction((n) => {
          const main = document.querySelector('main[class*="contentGridArea"]'); let sc = main;
          while (sc !== document.body && !/auto|scroll|overlay/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
          return Math.abs((sc === document.body ? document.scrollingElement : sc).scrollTop - n) < 2;
        }, top);
        ok(await target.evaluate(() => location.pathname + location.search) === route, `${label} keeps its exact route/query`);
        ok((await strip())?.at === 'routed', `${label} keeps the strip after settlement`);
      };
      await target.evaluate(() => { const sc = document.querySelector('.course-content-container > .panel-wrap'); if (sc) sc.scrollTop = 0; });
      await target.click('.b8b-folder');
      await opts.evaluate(async () => {
        const until = performance.now() + 4000;
        while (performance.now() < until) {
          if ((await chrome.storage.local.get('coursePlace')).coursePlace?._101_1?.open?.includes('_8130_1')) return true;
          await new Promise((r) => setTimeout(r, 25));
        }
        throw new Error('the native folder expansion was not saved');
      });
      await native('a.b8b-document');
      const doc = '/ultra/courses/_101_1/document/_8110_1?view=content&state=view&parentId=_8130_1';
      phase = 'B8b:NATIVE:history'; await target.evaluate(() => history.back()); await target.waitForFunction(() => location.pathname.endsWith('/outline')); await settled('_101_1');
      ok(await target.evaluate(() => location.pathname.endsWith('/outline')), 'Back from a routed document restores the native outline');
      try { await target.waitForSelector('.b8b-folder[aria-expanded="true"]', { timeout: 5000 }); }
      catch (error) {
        const receipt = { native: await target.evaluate(() => ({ page: location.href, folder: document.querySelector('.b8b-folder')?.outerHTML, pagePlace: sessionStorage.getItem('gz-place:_101_1') })),
          settings: await isolated(() => ({ enabled: GZ_CTX.on(), place: GZ_CTX.settings().enhance.place, loaded: typeof GZ_PLACE, acted: GZ_CTX.acted(), asked: GZ_CTX.placeAsked() })), local: await opts.evaluate(() => chrome.storage.local.get('coursePlace')) };
        fs.writeFileSync(path.join(out, 'B8b-folder-failure.json'), JSON.stringify(receipt, null, 2)); throw error;
      }
      ok(true, 'the existing Your place path restores the open folder after the routed document');
      await target.evaluate(() => history.forward()); await target.waitForFunction(() => location.pathname.includes('/document/')); await settled('_101_1');
      ok(await target.evaluate(() => location.pathname + location.search) === doc && (await strip())?.at === 'routed', 'Forward restores the routed document with its strip and query');
      for (const at of ['above', 'between', 'below']) {
        await opts.evaluate(async (at) => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, at } }); }, at);
        await target.waitForFunction((a) => {
          const strip = document.getElementById('gz-ctabs'), hd = document.querySelector('[class*="panelHeaderContainerRoot"]');
          return strip?.dataset.at === 'routed' && (a === 'above' ? strip.nextElementSibling === hd : strip.previousElementSibling === hd);
        }, at);
        ok(true, `routed header placement ${at}`);
      }
      if (!process.env.GZ_B8B_FOCUSED || process.env.GZ_B8B_GEOMETRY) {
        const layouts = [];
        await opts.evaluate(() => chrome.storage.local.set({ widgetLayout: { boards: { pages: [{ id: 'timer', on: true, size: 's', x: 0, y: 0 }] } } }));
        for (const preset of ['Frost', 'Paper']) for (const [at, size] of [['above', 'small'], ['between', 'medium'], ['below', 'large']]) for (const width of [1280, 375]) {
          phase = `B8b:NATIVE:geometry:${preset}:${at}:${size}:${width}`;
          await settings({ preset, enhance: { widgets: true }, tabs: { at }, nav: { size } });
          await page.setViewportSize({ width, height: 860 });
          await target.waitForSelector('#gz-float section.gz-w[data-tile="timer"]');
          await page.waitForTimeout(200);
          const g = await target.evaluate(() => {
            const st = document.getElementById('gz-ctabs'), hd = document.querySelector('[class*="panelHeaderContainerRoot"]');
            const timer = document.querySelector('#gz-float section.gz-w[data-tile="timer"]');
            const a = st.getBoundingClientRect(), b = hd.getBoundingClientRect(), c = timer.getBoundingClientRect();
            const hit = document.elementFromPoint(a.left + Math.min(40, a.width / 2), a.top + a.height / 2);
            return { strip: a.toJSON(), header: b.toJSON(), timer: c.toJSON(), at: st.dataset.at, hit: !!hit?.closest('#gz-ctabs'),
              marker: st.hasAttribute('data-gz-keep-clear'), count: document.querySelectorAll('#gz-ctabs').length, wide: document.documentElement.scrollWidth - innerWidth };
          });
          const placed = at === 'above' ? g.strip.bottom <= g.header.top + 1 : g.header.bottom <= g.strip.top + 1;
          const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          const clear = !overlap(g.timer, g.strip) && !overlap(g.timer, g.header);
          const valid = g.at === 'routed' && placed && clear && g.hit && g.marker && g.count === 1 && g.wide <= 0 && g.timer.right <= width + 1;
          layouts.push({ preset, at, size, width, placed, clear, ...g });
          await page.screenshot({ path: path.join(out, `B8b-routed-${preset}-${at}-${width}.png`) });
          fs.writeFileSync(path.join(out, 'B8b-routed-layouts.json'), JSON.stringify(layouts, null, 2));
          ok(valid, `routed ${at}/${preset}/${width}px/${size}: native header and strip stay reachable and clear of the global timer (${JSON.stringify(g)})`);
          if (!valid) throw new Error('routed native-header/strip geometry failed');
        }
        await quietTimer(); await settings(); await page.setViewportSize({ width: 1280, height: 860 });
      }
      await position(470); await saved(doc, 470); await restore(doc, 470, 'document-nested-scroll');
      await switchTab('_102_1');
      phase = 'B8b:NATIVE:second-document'; await target.click('a.b8b-document'); await settled('_102_1');
      const second = '/ultra/courses/_102_1/document/_8110_1?view=content&state=view&parentId=_8130_1';
      await position(380); await saved(second, 380, '_102_1');
      await restore(second, 380, 'second-live-document', '_102_1');
      await switchTab('_101_1');
      phase = 'B8b:NATIVE:document-close'; await target.click('.routed-page a'); await settled('_101_1');
      await native('a.b8b-document-self');
      const self = '/ultra/courses/_101_1/document/_8112_1?view=content&state=view';
      await position(430); await saved(self, 430); await restore(self, 430, 'document-main-scroll');
      phase = 'B8b:NATIVE:document-close'; await target.click('.routed-page a'); await settled('_101_1');
      await native('a.b8b-document-fallback');
      const fallback = '/ultra/courses/_101_1/document/_8111_1?view=content&state=view';
      await position(520); await saved(fallback, 520); await restore(fallback, 520, 'document-page-scroll');
      phase = 'B8b:NATIVE:document-close'; await target.click('.routed-page a'); await settled('_101_1');
      await native('a.b8b-assignment');
      const overview = '/ultra/courses/_101_1/assessment/_8120_1/overview?courseId=_101_1';
      await position(390); await saved(overview, 390); await restore(overview, 390, 'assignment-overview');
      for (const cls of ['a.b8b-test', 'a.b8b-unknown']) {
        if (await target.locator('.routed-page a').count()) { phase = 'B8b:NATIVE:overview-close'; await target.click('.routed-page a'); await settled('_101_1'); }
        await native(cls); await switchTab('_102_1'); await switchTab('_101_1');
        ok(await target.evaluate(() => location.pathname.includes('/overview')), `${cls} keeps the already open overview without opening another attempt`);
      }
      ok(await target.evaluate(() => window.__attempts === 0), 'no routed overview starts or resumes an attempt');
      fs.writeFileSync(path.join(out, 'B8b-requests.json'), JSON.stringify(requestDetails.filter((r) => r.phase.startsWith('B8b:')), null, 2));
      phase = 'B8b:complete';
    };
    if (process.env.GZ_B8B_FOCUSED) {
      await routedChecks(); console.log(`${fails ? 'FAILED' : 'passed'} routed document/Assignment controls`); process.exitCode = fails ? 1 : 0; return;
    }
    let s = await strip();
    ok(s.tabs.length === 1 && s.tabs[0].sel && s.tabs[0].label === 'Computer Science I · FA26-CS101-01', `a course opened gets a tab, named and selected (${JSON.stringify(s.tabs)})`);
    ok(s.at === 'above', `above the course's bar by default (${s.at})`);
    phase = 'native-navigation';
    // Gradebook, scrolled: the place the tab keeps.
    await target.click('a.js-course-grades-tool');
    await target.waitForFunction(() => location.pathname.endsWith('/grades') && !document.querySelector('.spinner'));
    await target.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 600; });
    await pictured('_101_1', '/ultra/courses/_101_1/grades');
    await target.click('[data-analytics-id="course.header.home"]');
    await target.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'page');
    ok(true, 'outside a course, the strip shows above the page');
    await target.click('a[href="/ultra/courses/_102_1/outline"]');
    await settled('_102_1');
    await open('_103_1');
    ok(await order() === '_101_1 _102_1 _103_1', `each course opened gets a tab, in order (${await order()})`);

    // First open restores the saved tool/scroll; a warm switch retains the exact live document and edits.
    const parentPath = page.url();
    holdCourse = '_101_1';
    await target.click('#gz-ctabs [data-course-id="_101_1"]');
    try {
      await page.waitForSelector('.gz-ctabs-pic');
      ok(courseHeld, 'the first live course is still loading behind its picture');
      const axSession = await ctx.newCDPSession(page);
      const ax = await axSession.send('Accessibility.getFullAXTree');
      await axSession.detach();
      ok(ax.nodes.some((n) => n.role?.value === 'progressbar' && n.name?.value === 'Loading…'), 'the loading picture exposes its accessible spinner');
      ok(await page.locator('#gz-ctabs [data-course-id="_101_1"]').getAttribute('aria-selected') === 'true', 'the selected tab updates while its live page loads');
      ok(await page.evaluate(() => !!document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('.gz-ctabs-pic')), 'the cached course picture covers the outgoing page until its frame is built');
      await page.screenshot({ path: path.join(out, 'switch-copy-frost-1280.png') });
    } finally { holdCourse = ''; releaseCourse?.(); }
    await showing('_101_1');
    ok(page.url() === parentPath, 'a live tab leaves the surrounding native page in place');
    ok(await target.evaluate(() => location.pathname) === '/ultra/courses/_101_1/grades', 'a first live tab opens its saved Gradebook');
    await target.waitForFunction(() => Math.abs(document.querySelector('.course-content-container > .panel-wrap').scrollTop - 600) <= 2);
    ok(Math.abs((await scroller()) - 600) <= 2, `and its saved scroll (${await scroller()})`);
    const live = target, birth = await target.evaluate(() => performance.timeOrigin);
    await target.evaluate(() => { const t = document.createElement('textarea'); t.id = 'live-draft'; t.setAttribute('aria-label', 'Synthetic draft'); document.querySelector('section.course').append(t); });
    await target.locator('#live-draft').fill('unsaved synthetic work');
    await target.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 600; });
    await switchTab('_102_1');
    const before = requests.length;
    await switchTab('_101_1');
    ok(target === live && await target.evaluate(() => performance.timeOrigin) === birth, 'returning shows the same live document');
    ok(await target.locator('#live-draft').inputValue() === 'unsaved synthetic work', 'the live tab retains unsaved edits');
    ok(Math.abs((await scroller()) - 600) <= 2, 'a warm switch retains its scroll');
    // Hidden courses may finish their own API reads; a return must not reload this course's document or resources.
    ok(!requestDetails.slice(before).some((r) => r.type === 'document' || r.page === target.url()), 'a warm switch loads no document or resources for the returning course');
    await page.screenshot({ path: path.join(out, 'switch-live-frost-1280.png') });
    await open('_101_1');

    // A retained live assessment stays where the student left it; a switch never opens another attempt.
    await target.click('a[href*="/outline/assessment/"]');
    await target.waitForFunction(() => location.pathname.includes('/assessment/'));
    const views = await target.evaluate(() => window.__assessmentViews);
    await switchTab('_102_1'); await switchTab('_101_1');
    ok(await target.evaluate(() => location.pathname.includes('/assessment/')), 'the native live assessment stays in its existing document');
    ok(await target.evaluate(() => [window.__assessmentViews, window.__attempts]).then(([v, a]) => v === views && a === 0), 'the assessment was not opened again, nor an attempt started');
    await target.click('.panel-header a');

    // ---- an item opened over the course: the strip at its panel ----
    await target.click('a[href*="/outline/edit/document/"]');
    await target.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'nested');
    const nested = await target.evaluate(() => { const r = document.getElementById('gz-ctabs').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return !!e?.closest('#gz-ctabs'); });
    ok(nested, 'on a document opened over the course, the strip is on top, at its panel');
    await page.screenshot({ path: path.join(out, 'nested-frost-1280.png') });
    await target.click('.panel-header a');
    await target.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'above');

    // ---- pin, move, close ----
    await target.hover('#gz-ctabs [data-course-id="_103_1"]');
    await target.click('#gz-ctabs [data-course-id="_103_1"] .gz-ctab-pin');
    s = await strip();
    ok(s.tabs[0].cid === '_103_1' && s.tabs[0].pin && /pinned/.test(s.tabs[0].label), `a pinned tab goes first and says so (${await order()})`);
    await target.focus('#gz-ctabs [data-course-id="_101_1"]');
    await page.keyboard.press('Shift+ArrowRight');
    ok(await order() === '_103_1 _102_1 _101_1', `Shift+→ moves a tab (${await order()})`);
    ok(await target.evaluate(() => document.activeElement?.dataset.courseId) === '_101_1', 'and it keeps the focus');
    await page.keyboard.press('ArrowLeft');
    ok(await target.evaluate(() => document.activeElement?.dataset.courseId) === '_102_1', '← moves the focus');
    await page.keyboard.press('Delete');
    ok(await order() === '_103_1 _101_1', `Delete closes the focused tab (${await order()})`);
    await open('_104_1');
    await target.click('#gz-ctabs [data-course-id="_104_1"]', { button: 'middle' });
    await showing('_101_1');
    ok(await order() === '_103_1 _101_1', `a middle click closes a tab (${await order()})`);
    await page.waitForTimeout(200);
    ok(!Object.keys(await session()).some((k) => k.endsWith('|_104_1')), 'closing a tab also drops its worker picture');
    // Dragging: the last unpinned tab to the first unpinned place.
    await open('_104_1');
    const box = async (cid) => target.locator(`#gz-ctabs [data-course-id="${cid}"]`).boundingBox();
    const from = await box('_104_1');
    const to = await box('_101_1');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + from.width / 2 + ((to.x + 10) - (from.x + from.width / 2)) * i / 8, from.y + from.height / 2);
    await page.mouse.up();
    ok(await order() === '_103_1 _104_1 _101_1', `a tab drags into place, within its group (${await order()})`);
    await target.evaluate(() => { document.documentElement.dir = 'rtl'; });
    const rtlFrom = await box('_101_1'), rtlTo = await box('_104_1');
    await page.mouse.move(rtlFrom.x + rtlFrom.width / 2, rtlFrom.y + rtlFrom.height / 2);
    await page.mouse.down();
    await page.mouse.move(rtlTo.x + rtlTo.width * .75, rtlTo.y + rtlTo.height / 2, { steps: 8 });
    await page.mouse.up();
    ok(await order() === '_103_1 _101_1 _104_1', `drag follows the rendered right-to-left order (${await order()})`);
    await target.evaluate(() => { document.documentElement.dir = 'ltr'; });
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
    await target.waitForFunction(() => !document.querySelector('#gz-ctabs .gz-ctabs-note')?.textContent, null, { timeout: 8000 });

    // ---- placements, light and dark, wide and narrow ----
    await settings({ tabs: { cap: 8 } });
    for (const preset of ['Frost', 'Paper']) {
      for (const at of ['above', 'between', 'below']) {
        for (const width of [1280, 375]) {
          await settings({ preset, tabs: { at, cap: 8, color: at === 'between' ? 'tint' : at === 'below' ? 'theme' : 'off', mark: at === 'below' ? 'icon' : 'dot', shape: at === 'between' ? 'pill' : 'tab' } });
          await page.setViewportSize({ width, height: 860 });
          await target.waitForFunction((a) => document.getElementById('gz-ctabs')?.dataset.at === a && !document.querySelector('[data-gz-loading], [data-gz-reveal]'), at);
          await page.mouse.move(5, 850);
          await page.waitForTimeout(300);
          const g = await target.evaluate(() => {
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
      await target.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 900; });
      await page.waitForTimeout(150);
      ok(await target.evaluate(() => { const r = document.getElementById('gz-ctabs').getBoundingClientRect(); return r.top >= -1 && r.bottom < 200; }), `${preset}: scrolled, the strip stays at the top with the bar`);
      await target.evaluate(() => { document.querySelector('.course-content-container > .panel-wrap').scrollTop = 0; });
      // An item panel and a page outside a course, in this palette.
      await settings({ preset });
      await page.setViewportSize({ width: 1280, height: 860 });
      await target.click('a.js-course-outline-tool').catch(() => {});
      await target.waitForSelector('a[href*="/outline/edit/document/"]');
      await target.click('a[href*="/outline/edit/document/"]');
      await target.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'nested');
      for (const at of ['above', 'between', 'below']) {
        for (const width of [1280, 375]) {
          await page.setViewportSize({ width, height: 860 });
          await settings({ preset, tabs: { at } });
          await page.waitForTimeout(150);
          const g = await target.evaluate(() => {
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
      await target.click('.panel-header a');
      await target.click('[data-analytics-id="course.header.home"]');
      target = page;
      await target.waitForFunction(() => document.getElementById('gz-ctabs')?.dataset.at === 'page');
      await page.screenshot({ path: path.join(out, `page-${preset.toLowerCase()}-1280.png`) });
      await target.click('a[href="/ultra/courses/_105_1/outline"]');
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
          await target.waitForSelector('#gz-float section.gz-w[data-tile="timer"]');
          await page.waitForTimeout(150);
          const g = await target.evaluate(() => {
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
    await open('_103_1');

    // ---- pictures stay in session storage and are dropped on switch-off or another account ----
    let kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(kept.length >= 1 && kept.every((k) => k.startsWith(`snap:${SITE}|_`)), `copies are kept in storage.session, for this site (${kept.length})`);
    await settings({ enhance: { tabs: false } });
    await target.waitForFunction(() => !document.getElementById('gz-ctabs'));
    await page.waitForTimeout(300);
    kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(!kept.length, `switched off: the strip goes, and every copy (${kept.length} left)`);
    ok(await target.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctabs') && !sessionStorage.getItem('gz-ctabs') && !document.getElementById('gz-ctabs-frames')), 'switching off clears the page reservation and every live frame too');
    await settings();
    await target.waitForSelector('#gz-ctabs [role="tab"]');
    await switchTab('_104_1');
    await pictured('_104_1', '/ultra/courses/_104_1/outline');
    ok(Object.keys(await session()).some((k) => k.startsWith('snap:')), 'on again, a switch keeps a picture again');
    user = '_43_1';
    phase = 'account-reload';
    await page.reload();
    target = page;
    await target.waitForSelector('#gz-ctabs [role="tab"]');
    await page.waitForTimeout(500);
    kept = Object.keys(await session()).filter((k) => k.startsWith('snap:'));
    ok(!kept.length && ((await session())[`snapwho:${SITE}`]?.uid || (await session())[`snapwho:${SITE}`]) === '_43_1', `another account on the site: the last one's copies go (${kept.length} left)`);
    ok(await order() === '_103_1', `and it starts its own list (${await order()})`);
    ok(requestDetails.every((r) => r.method === 'GET'), 'all measured fixture traffic is GET');
    ok(requestDetails.filter((r) => r.type === 'document').every((r) => r.origin === SITE && r.path.startsWith('/ultra/')), 'live documents load only the selected synthetic course on this site');

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
      await target.evaluate((i) => { history.pushState(null, '', location.origin + '/ultra/courses/_103_1/' + (i % 2 ? 'outline' : 'grades')); dispatchEvent(new PopStateEvent('popstate')); }, i);
      await settled('_103_1');
    }
    await page.goBack(); await settled('_103_1');
    await page.goForward(); await settled('_103_1');
    for (let i = 0; i < 4; i++) { await settings({ enhance: { tabs: false } }); await page.waitForTimeout(100); await settings(); await target.waitForSelector('#gz-ctabs'); }
    await page.waitForTimeout(2000);
    const quietBefore = await isolated(() => ({ syncs: __b8.syncs, helds: __b8.helds }));
    await page.waitForTimeout(1200);
    const quietAfter = await isolated(() => ({ syncs: __b8.syncs, helds: __b8.helds, netListeners: __b8.adds - __b8.removes, netStoreListeners: __b8.storeAdds - __b8.storeRemoves, netRuntimeListeners: __b8.runtimeAdds - __b8.runtimeRemoves, timers: __b8.timeouts.size }));
    ok(quietAfter.syncs - quietBefore.syncs <= 2, `quiet after redraws: ${quietAfter.syncs - quietBefore.syncs} sync calls in 1.2s`);
    ok(quietAfter.netListeners === 0, `toggle cycles retain no extra listeners (${quietAfter.netListeners})`);
    ok(quietAfter.netStoreListeners === 0, `toggle cycles retain no extra storage listeners (${quietAfter.netStoreListeners})`);
    ok(quietAfter.netRuntimeListeners === 0, `routes/toggles retain no extra runtime listeners (${quietAfter.netRuntimeListeners})`);
    ok(await target.locator('#gz-ctabs').count() === 1, 'redraws, Back and Forward keep exactly one strip');
    fs.writeFileSync(path.join(out, 'redraw-metrics.json'), JSON.stringify({ quietBefore, quietAfter }, null, 2));

    // A full all-pinned list must stay bounded and quiet without hiding the native course.
    await opts.evaluate(async () => {
      const tabs = Array.from({ length: 40 }, (_, i) => ({ cid: `_${i + 1}_1`, name: `Pinned ${i + 1}`, code: '', pin: true, at: i, path: `/ultra/courses/_${i + 1}_1/outline`, top: 0 }));
      await chrome.storage.local.set({ 'ctabs:https://bb.school.test:_43_1': { tabs } });
    });
    await page.waitForTimeout(800);
    const fullBefore = await isolated(() => __b8.syncs);
    await page.waitForTimeout(1200);
    ok(await target.locator('#gz-ctabs [role="tab"]').count() === 40, '40 pinned courses keep the hard bound without evicting one');
    ok((await strip()).note.includes('Close or unpin'), 'a full list explains how to add another tab');
    ok(await isolated(() => __b8.syncs) - fullBefore <= 2, 'a full pinned list does not cause a redraw loop');
    ok(await target.locator('div.bb-course-navigation .js-course-navigation').count() === 1, 'the native course tools remain available at the hard tab bound');

    // Sign-out must stay cleared through delayed capture, pagehide and later core passes.
    phase = 'signout';
    await target.click('.MuiDrawer-paper a[href="#"]');
    await target.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(2000);
    await isolated(() => { GZ_CTABS.sync(true); return true; });
    ok(!Object.keys(await session()).some((k) => k.startsWith('snap:')), 'sign-out followed by pagehide and delayed capture keeps the worker empty');
    ok(await isolated(() => GZ_CTABS.snapshots()) === 0 && await target.locator('#gz-ctabs').count() === 0, 'sign-out leaves no local snapshots or strip, including a later sync');
    fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(requestDetails, null, 2));


    // ---- the editor: its section, and the strip on the preview's Ultra mock, live ----
    await settings({ tabs: { at: 'between', color: 'tint', shape: 'pill' } });
    await opts.setViewportSize({ width: 1280, height: 900 });
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html#navigation/tabs`);
    await opts.selectOption('#preview-page', 'tabs');
    const pv = opts.frameLocator('#preview');
    await pv.locator('#gz-ctabs[data-at="between"] [role="tab"]').first().waitFor({ timeout: 8000 });
    ok(await pv.locator('#gz-ctabs [role="tab"]').count() === 3, 'the editor\'s preview shows the strip, between the mock bar\'s rows');
    await opts.locator('label:has(> input[name="tabs.at"][value="below"])').click();
    await pv.locator('#gz-ctabs[data-at="below"]').waitFor({ timeout: 4000 }).then(() => ok(true, 'and follows an edit before it is saved'), () => ok(false, 'and follows an edit before it is saved'));
    await opts.locator('#tabs').scrollIntoViewIfNeeded();
    await opts.screenshot({ path: path.join(out, 'editor-frost-1280.png') });
  } finally {
    releaseCourse?.();
    fs.writeFileSync(path.join(out, 'requests.json'), JSON.stringify(requestDetails, null, 2));
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`${fails ? 'FAILED' : 'passed'}; screenshots in ${out}`);
  process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
