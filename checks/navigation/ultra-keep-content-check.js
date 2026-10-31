// Ultra's Course Content kept ready (tabs.keep; navigation/page/coursetabs.js): an item opened from the outline opens over it
// in an item frame; Back shows the same outline element at the same scroll; a fresh outline then takes its place at that
// scroll with no layout shift; Ultra's link back to Course Content and Forward work; an attempt link is Ultra's; switched
// off, Ultra opens items in the outline's place as before. On this page's own course and in a course tab's frame.
// The synthetic Ultra (test/fixtures/ultra-course.html) can't run Ultra's Angular: its own small router, which re-renders on
// popstate and builds a full routed item in the outline's place, stands in for Ultra's. Real unpacked extension, headless
// Chrome, no account or outside network.
// NODE_PATH=<installed playwright> node checks/navigation/ultra-keep-content-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = require('../../tools/dev/check-env.js').staged(process.env.EXT || path.join(__dirname, '../../extension'), ['https://bb.school.test/*']);
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const G = require(path.join(ext, 'content/defaults.js'));
require(path.join(ext, 'navigation/coursetabs.js')); // GZ_SPEC.tabs, for GZ_SANITIZE
const html = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-keep-'));
const out = process.argv[2];
const COURSES = [101, 102, 103].map((n) => [`_${n}_1`, `Synthetic course ${n - 100}`]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = 'condition') => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(50); }
  throw new Error(`${what} timed out`);
};
const results = [], errors = [], evidence = {};
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
// In a document: Course Content's scroller (Ultra's panel-wrap), its outline element, and what sits at the middle of the view.
const OUTLINE = () => {
  const o = document.querySelector('.course-outline-content'), sc = document.querySelector('.course-content-container > .panel-wrap');
  return { o, sc, at: document.elementFromPoint(700, 430)?.closest('.content-list-item')?.dataset.contentId || '' };
};
(async () => {
  let ctx;
  const docs = [];
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', async (route) => {
      const r = route.request(), u = new URL(r.url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) { if (r.resourceType() === 'document') docs.push(u.pathname); return route.fulfill({ contentType: 'text/html', body: html }); }
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && /\/users\/_\d+_1\/memberships/.test(u.pathname)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: COURSES.map(([cid, name]) => ({ courseId: cid, course: { id: cid, courseId: cid, name } })) }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const settings = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, enhance: { ...G.GZ_DEFAULTS.enhance, sidebar: false }, tabs: G.GZ_SANITIZE({}).tabs };
    check(settings.tabs.keep === true, 'Course Content is kept ready by default');
    await opts.evaluate(async ({ settings, key, site, courses }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] });
      await chrome.storage.local.set({ [key]: { tabs: courses.map(([cid, name], i) => ({ cid, name, path: `/ultra/courses/${cid}/outline`, top: 0, at: i, pin: false })) } });
    }, { settings, key, site, courses: COURSES });
    await require('../../tools/dev/check-env.js').ultraReady(opts);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    if (out) fs.mkdirSync(out, { recursive: true });
    const shot = (name) => out && page.screenshot({ path: path.join(out, `${name}.png`) });
    // The frame of course `cid` on screen (several may carry its name: its outline kept under an item).
    const onScreen = async (cid) => {
      const h = await page.evaluateHandle((cid) => [...document.querySelectorAll(`iframe[name="gz-ctab:${cid}"]`)].find((f) => !f.inert && getComputedStyle(f).visibility === 'visible' && document.querySelector('#gz-ctabs-frames[data-on]')) || null, cid);
      return h.asElement() ? h.asElement().contentFrame() : null;
    };
    const named = (cid) => page.evaluate((cid) => document.querySelectorAll(`iframe[name="gz-ctab:${cid}"]`).length, cid);
    const outlineDrawn = (w) => until(() => w.evaluate(() => !!document.querySelector('.course-outline-content') && !document.querySelector('.spinner')), 15000, 'the outline drawn');
    // The item frame showing `title`, drawn and told it shows (its outline, visible under it until then, carries the same name).
    const itemDrawn = (cid, title) => until(async () => {
      for (const h of await page.$$(`iframe[name="gz-ctab:${cid}"]`)) {
        const f = await h.contentFrame();
        if (f && await h.evaluate((e) => !e.inert && getComputedStyle(e).visibility === 'visible') && await f.evaluate((t) => !document.querySelector('.spinner')
          && !document.documentElement.hasAttribute('data-gz-ctab-framed') && !!document.querySelector('.routed-page h1')?.textContent.startsWith(t), title)) return f;
      }
      return null;
    }, 15000, `${title} drawn`);
    // An item link in the outline row in view: a click there scrolls nothing (Playwright brings a link out of view into it).
    const linkInView = (w, href) => w.evaluate((href) => {
      const row = document.elementFromPoint(700, 430)?.closest('.content-list-item');
      document.getElementById('gz-in-view')?.remove();
      row.querySelector('h3').append(Object.assign(document.createElement('a'), { id: 'gz-in-view', href, textContent: ' (open)' }));
    }, href);
    const cls = (w) => w.evaluate(() => { window.gzCLS = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.gzCLS += e.value; }).observe({ type: 'layout-shift' }); });

    // ---- this page's own course ----
    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await outlineDrawn(page);
    await page.evaluate(`(() => { const x = (${OUTLINE})(); window.gzOutline = x.o; x.sc.scrollTop = 900; })()`);
    const before = await page.evaluate(`(${OUTLINE})().at`);
    let mark = docs.length;
    await linkInView(page, '/ultra/courses/_101_1/document/_8110_1?view=content&state=view');
    await page.click('#gz-in-view');
    let item = await itemDrawn('_101_1', 'Routed reading');
    await shot('page-item');
    const kept = await page.evaluate(() => ({ same: window.gzOutline.isConnected, path: location.pathname, top: document.querySelector('.course-content-container > .panel-wrap')?.scrollTop }));
    check(kept.same && kept.path === '/ultra/courses/_101_1/outline' && kept.top === 900, `an item from this page's Course Content opens over it; the outline stays, scrolled as it was (${JSON.stringify(kept)})`);
    await cls(page);
    await page.evaluate(() => history.back());
    await until(() => page.evaluate(() => !document.querySelector('#gz-ctabs-frames[data-on]')), 5000, 'Back to the outline');
    const back = await page.evaluate(`(() => { const x = (${OUTLINE})(); return { same: x.o === window.gzOutline, top: x.sc.scrollTop, at: x.at }; })()`);
    check(back.same && back.top === 900 && back.at === before, `Back shows the same outline element at once, at the same scroll (${JSON.stringify(back)})`);
    // The fresh outline: the freed item frame, routed there hidden, swapped in once still.
    const fresh = await until(async () => { const f = await onScreen('_101_1'); return f && await f.evaluate(() => location.pathname.endsWith('/outline') && !!document.querySelector('.course-outline-content')) && f; }, 20000, 'the fresh outline swapped in');
    await cls(fresh);
    await pause(1500); // a settled window for shifts after the swap
    const swapped = await fresh.evaluate(`(() => { const x = (${OUTLINE})(); return { top: x.sc.scrollTop, at: x.at, cls: window.gzCLS }; })()`);
    const pageCls = await page.evaluate(() => window.gzCLS);
    evidence.pageSwap = { ...swapped, pageCls };
    check(swapped.top === 900 && swapped.at === before && swapped.cls <= 0.01 && pageCls <= 0.01, `a fresh outline takes its place at the same scroll, the same item under the same point, CLS ≤ 0.01 (${JSON.stringify(evidence.pageSwap)})`);
    check(!docs.slice(mark).some((d) => d === '/ultra/courses/_101_1/outline'), 'with no outline loaded afresh as a page');
    await shot('page-fresh');

    // ---- an attempt link is Ultra's ----
    await fresh.evaluate(() => { const a = Object.assign(document.createElement('a'), { id: 'gz-attempt', href: '/ultra/courses/_101_1/assessment/_8120_1/attempt/create', textContent: 'Start' }); document.querySelector('.outline-header').append(a); });
    const n = await named('_101_1');
    await fresh.click('#gz-attempt');
    await until(() => fresh.evaluate(() => location.pathname.endsWith('/attempt/create')), 5000, 'Ultra routes the attempt itself');
    check(await named('_101_1') === n, 'an attempt link is not taken: no item frame, Ultra routes it as before');

    // ---- a course tab's frame ----
    await fresh.click('#gz-ctabs [data-course-id="_102_1"]');
    let base = await until(() => onScreen('_102_1'), 15000, '_102_1 on screen');
    await outlineDrawn(base);
    await base.evaluate(() => { window.gzOutline = document.querySelector('.course-outline-content'); document.querySelector('.course-content-container > .panel-wrap').scrollTop = 700; });
    await linkInView(base, '/ultra/courses/_102_1/assessment/_8120_1/overview?courseId=_102_1');
    await base.click('#gz-in-view');
    item = await itemDrawn('_102_1', 'Writing overview');
    const under = await base.evaluate(() => ({ same: window.gzOutline.isConnected, top: document.querySelector('.course-content-container > .panel-wrap').scrollTop, path: location.pathname }));
    check(under.same && under.top === 700 && under.path.endsWith('/outline') && await named('_102_1') === 2, `in a tab's frame, the item opens in an item frame over its kept outline (${JSON.stringify(under)})`);
    // Ultra's link back to Course Content, in the item.
    await item.click('.routed-page a[href$="/outline"]');
    await until(async () => (await onScreen('_102_1')) === base, 5000, 'the kept outline on screen');
    const linked = await base.evaluate(() => ({ same: window.gzOutline.isConnected && window.gzOutline === document.querySelector('.course-outline-content'), top: document.querySelector('.course-content-container > .panel-wrap').scrollTop }));
    check(linked.same && linked.top === 700, `Ultra's link back to Course Content shows the kept outline at its scroll (${JSON.stringify(linked)})`);
    // Forward: the item again; Back: the outline again.
    await page.evaluate(() => history.forward());
    await itemDrawn('_102_1', 'Writing overview');
    check(true, 'Forward opens the item again');
    await page.evaluate(() => history.back());
    await until(async () => { const f = await onScreen('_102_1'); return f && await f.evaluate(() => location.pathname.endsWith('/outline') && document.querySelector('.course-content-container > .panel-wrap')?.scrollTop === 700); }, 5000, 'Back to the outline at its scroll');
    check(true, 'and Back the kept outline, at its scroll');
    base = await until(async () => { const f = await onScreen('_102_1'); return f && f !== base && await f.evaluate(() => location.pathname.endsWith('/outline')) && f; }, 20000, 'the tab\'s fresh outline swapped in');
    evidence.frameSwap = await base.evaluate(() => ({ top: document.querySelector('.course-content-container > .panel-wrap').scrollTop }));
    check(evidence.frameSwap.top === 700, `the tab's fresh outline swaps in at the same scroll (${JSON.stringify(evidence.frameSwap)})`);
    await shot('frame-fresh');

    // ---- switched off: Ultra opens the item in the outline's place, as before ----
    await opts.evaluate(async () => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, keep: false } }); });
    await pause(300);
    await base.evaluate(() => { window.gzOutline = document.querySelector('.course-outline-content'); });
    const m = await named('_102_1');
    await base.click('a.b8b-document');
    await until(() => base.evaluate(() => location.pathname.includes('/document/')), 5000, 'Ultra routes the item itself');
    const off = await base.evaluate(() => ({ gone: !window.gzOutline.isConnected }));
    check(off.gone && await named('_102_1') === m, `switched off, no item frame: Ultra builds the item in the outline's place as before (${JSON.stringify(off)})`);

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    console.log(JSON.stringify(evidence));
    if (out) fs.writeFileSync(path.join(out, 'ultra-keep-content.json'), JSON.stringify({ results, ...evidence, docs }, null, 2));
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
