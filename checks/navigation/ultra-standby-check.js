// Ultra course tabs opened ahead of time (tabs.ahead; navigation/page/coursetabs.js): the hidden standby Ultra frame becomes
// the frame of the next course tab picked with no live frame, routed in place, with no cold frame load; a pointer resting
// on a tab starts its frame without showing it; a standby whose route never comes falls back to the cold load; switched
// off, there is no standby and a pick loads the course cold. Times click → the frame's 'drawn' for the standby and the
// cold path, and the standby's heap cost.
// The synthetic Ultra (test/fixtures/ultra-course.html) can't run Ultra's Angular: its own small router, which re-renders
// on popstate, stands in for Ultra's in-place route. Real unpacked extension, headless Chrome, no account or outside network.
// NODE_PATH=<installed playwright> node checks/navigation/ultra-standby-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
// A copy holding the school's host, as the student's grant does (tools/dev/check-env.js staged).
const ext = require('../../tools/dev/check-env.js').staged(process.env.EXT || path.join(__dirname, '../../extension'), ['https://bb.school.test/*']);
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const G = require(path.join(ext, 'content/defaults.js'));
require(path.join(ext, 'navigation/coursetabs.js')); // GZ_SPEC.tabs, for GZ_SANITIZE
const html = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ultra-standby-'));
const out = process.argv[2];
const COURSES = [101, 102, 103, 104].map((n) => [`_${n}_1`, `Synthetic course ${n - 100}`]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000, what = 'condition') => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(50); }
  throw new Error(`${what} timed out`);
};
const results = [], errors = [], evidence = { timings: {}, memory: null };
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
(async () => {
  let ctx;
  const docs = []; // document loads: { path, frame }
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
      if (u.origin === site && u.pathname.startsWith('/ultra')) {
        if (r.resourceType() === 'document') docs.push({ path: u.pathname, frame: r.frame().name() });
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && /\/users\/_\d+_1\/memberships/.test(u.pathname)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: COURSES.map(([cid, name]) => ({ courseId: cid, course: { id: cid, courseId: cid, name } })) }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    // Glaze's bar off: the strip is on the page. Course tabs' settings as by default (ahead of time on).
    const settings = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, enhance: { ...G.GZ_DEFAULTS.enhance, sidebar: false }, tabs: G.GZ_SANITIZE({}).tabs };
    check(settings.tabs.ahead === true, 'course tabs open ahead of time by default');
    await opts.evaluate(async ({ settings, key, site, courses }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] });
      await chrome.storage.local.set({ [key]: { tabs: courses.map(([cid, name], i) => ({ cid, name, path: `/ultra/courses/${cid}/outline`, top: 0, at: i, pin: false })) } });
    }, { settings, key, site, courses: COURSES });
    await require('../../tools/dev/check-env.js').ultraReady(opts);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'JSHeapUsedSize').value; };
    const shot = (name) => out && page.screenshot({ path: path.join(out, `${name}.png`) });
    if (out) fs.mkdirSync(out, { recursive: true });

    const frameOf = async (name) => (await page.$(`iframe[name="${name}"]`))?.contentFrame();
    const ready = () => until(() => page.evaluate(() => !!document.querySelector('iframe[name="gz-ctab:standby"][data-ready]')), 30000, 'a ready standby');
    // A course's frame on screen: visible, no stand-in over it, the course drawn in it and its Glaze told it shows.
    const drawn = async (cid) => {
      await until(() => page.evaluate((cid) => { const f = document.querySelector(`iframe[name="gz-ctab:${cid}"]`); return !!f && !f.inert && getComputedStyle(f).visibility === 'visible' && !document.querySelector('.gz-ctabs-pic'); }, cid), 15000, `${cid} on screen`);
      const f = await frameOf(`gz-ctab:${cid}`);
      await until(() => f.evaluate((cid) => !document.querySelector('.spinner, [data-gz-placing]') && !document.documentElement.hasAttribute('data-gz-ctab-framed')
        && [...document.querySelectorAll('div.bb-course-navigation a[href]')].some((a) => a.getAttribute('href').startsWith(`/ultra/courses/${cid}/`))), 15000, `${cid} drawn`);
      return f;
    };
    // Timed on the page's clock: from the press on a tab (in the strip of `where`, the page or a frame) to that course's
    // frame posting 'drawn' (heard here too).
    const timed = async (cid, where, sel) => {
      await page.evaluate((cid) => {
        const t = window.gzTimed = { press: null, drawn: null };
        addEventListener('message', function on(e) {
          const f = document.querySelector(`iframe[name="gz-ctab:${cid}"]`);
          if (t.press != null && e.data?.gzCtab === 'drawn' && f && e.source === f.contentWindow) { t.drawn = performance.now(); removeEventListener('message', on); }
        });
      }, cid);
      await where.evaluate(() => document.addEventListener('pointerdown', () => { const t = top.gzTimed; if (t.press == null) t.press = top.performance.now(); }, { capture: true, once: true }));
      await where.click(sel);
      await until(() => page.evaluate(() => window.gzTimed.drawn != null), 20000, `${cid} drawn message`);
      return page.evaluate(() => window.gzTimed.drawn - window.gzTimed.press);
    };
    const coldLoads = (cid, from = 0) => docs.slice(from).filter((d) => d.path.startsWith(`/ultra/courses/${cid}/`));

    await page.goto(`${site}/ultra/course`);
    await until(() => page.evaluate(() => !!document.querySelector('#gz-ctabs [data-course-id="_104_1"]')), 15000, 'the strip');

    // ---- the standby boots at idle, hidden, outside LIVE ----
    await ready();
    const sb = await page.evaluate(() => {
      const f = document.querySelector('iframe[name="gz-ctab:standby"]');
      return { count: document.querySelectorAll('iframe[name="gz-ctab:standby"]').length, inert: f.inert, hidden: getComputedStyle(f).visibility === 'hidden', path: f.contentWindow.location.pathname, on: document.querySelector('#gz-ctabs-frames')?.hasAttribute('data-on') };
    });
    check(sb.count === 1 && sb.inert && sb.hidden && !sb.on && sb.path === '/ultra/profile', `one standby, hidden and inert, on Ultra's light page, nothing shown over the page (${JSON.stringify(sb)})`);
    check(!docs.some((d) => d.path.startsWith('/ultra/courses/')), 'no course loaded ahead');

    // ---- a resting pointer starts a course's frame (the standby taken), shown only on the click ----
    let mark = docs.length;
    await page.evaluate(() => { window.gzStandby = document.querySelector('iframe[name="gz-ctab:standby"]'); window.gzHistory = history.length; });
    await page.hover('#gz-ctabs [data-course-id="_104_1"]');
    await until(() => page.evaluate(() => document.querySelector('iframe[name="gz-ctab:_104_1"]') === window.gzStandby), 5000, 'hover adopts the standby');
    await page.mouse.move(5, 5);
    await until(async () => (await frameOf('gz-ctab:_104_1'))?.evaluate(() => location.pathname === '/ultra/courses/_104_1/outline' && !!document.querySelector('div.bb-course-navigation')), 10000, '_104_1 routed in its frame');
    const hovered = await page.evaluate(() => {
      const f = document.querySelector('iframe[name="gz-ctab:_104_1"]');
      return { inert: f.inert, hidden: getComputedStyle(f).visibility === 'hidden', on: document.querySelector('#gz-ctabs-frames').hasAttribute('data-on'), selected: [...document.querySelectorAll('#gz-ctabs [aria-selected="true"]')].map((e) => e.dataset.courseId), path: location.pathname, history: history.length - window.gzHistory };
    });
    check(hovered.inert && hovered.hidden && !hovered.on && !hovered.selected.length && hovered.path === '/ultra/course', `pointed at, never clicked: the course's frame runs hidden and the page stays as it was (${JSON.stringify(hovered)})`);
    check(coldLoads('_104_1', mark).length === 0, 'and that frame is the standby routed in place, with no cold frame load');
    check(hovered.history === 0, 'routing the standby adds no history entry');
    const inside = await (await frameOf('gz-ctab:_104_1')).evaluate(() => ({ name: window.name, href: location.href }));
    check(inside.name === 'gz-ctab:_104_1' && inside.href === `${site}/ultra/courses/_104_1/outline`, `its window is named for the course, at the course's absolute address (${JSON.stringify(inside)})`);

    // ---- a pick with no live frame: the next standby, routed in place ----
    await ready();
    check(await page.evaluate(() => document.querySelector('iframe[name="gz-ctab:standby"]') !== window.gzStandby), 'the next standby boots at the next idle');
    mark = docs.length;
    await page.evaluate(() => { window.gzStandby = document.querySelector('iframe[name="gz-ctab:standby"]'); window.gzOrigin = window.gzStandby.contentWindow.performance.timeOrigin; window.gzHistory = history.length; });
    evidence.timings.standbyMs = await timed('_102_1', page, '#gz-ctabs [data-course-id="_102_1"]');
    let f = await drawn('_102_1');
    await shot('standby-adopted');
    const same = await page.evaluate(() => { const f = document.querySelector('iframe[name="gz-ctab:_102_1"]'); return { el: f === window.gzStandby, doc: f.contentWindow.performance.timeOrigin === window.gzOrigin, history: history.length - window.gzHistory }; });
    check(same.el && same.doc && coldLoads('_102_1', mark).length === 0, `a picked tab with no live frame shows its course from the standby: the same frame and document, no cold frame load (${JSON.stringify(same)})`);
    check(same.history === 0, 'no history entry for the route itself');
    const strip = await f.evaluate(() => [...document.querySelectorAll('#gz-ctabs [aria-selected="true"]')].map((e) => e.dataset.courseId));
    check(strip.length === 1 && strip[0] === '_102_1', `Glaze in the adopted frame works as that course's frame: its own strip marks the course (${strip})`);
    console.log(`standby: click → drawn ${evidence.timings.standbyMs.toFixed(0)} ms`);

    // The warmed tab, picked from the frame's strip: shown as it is, already drawn.
    mark = docs.length;
    await f.click('#gz-ctabs [data-course-id="_104_1"]');
    await drawn('_104_1');
    check(coldLoads('_104_1', mark).length === 0, 'the tab warmed by the pointer shows on its click without loading anything');

    // ---- a standby whose route never comes: the cold load ----
    await ready();
    const stuck = await frameOf('gz-ctab:standby');
    // Its router no longer hears popstate, as an Ultra that didn't take the route.
    await stuck.evaluate(() => addEventListener('popstate', (e) => e.stopImmediatePropagation(), true));
    mark = docs.length;
    f = await frameOf('gz-ctab:_104_1');
    await page.evaluate(() => { window.gzOrigin = document.querySelector('iframe[name="gz-ctab:standby"]').contentWindow.performance.timeOrigin; });
    await f.click('#gz-ctabs [data-course-id="_103_1"]');
    f = await drawn('_103_1');
    const fell = await page.evaluate(() => ({ doc: document.querySelector('iframe[name="gz-ctab:_103_1"]').contentWindow.performance.timeOrigin !== window.gzOrigin }));
    check(fell.doc && coldLoads('_103_1', mark).length === 1, `with no route in time, the course loads cold in that frame (${JSON.stringify({ ...fell, loads: coldLoads('_103_1', mark) })})`);
    const cold = await f.evaluate(() => ({ name: window.name, strip: [...document.querySelectorAll('#gz-ctabs [aria-selected="true"]')].map((e) => e.dataset.courseId) }));
    check(cold.name === 'gz-ctab:_103_1' && cold.strip.join() === '_103_1', `and boots as that course's frame (${JSON.stringify(cold)})`);
    await shot('fallback');

    // ---- switched off: no standby; a pick loads cold ----
    await ready(); // _101_1 still has no frame
    const withStandby = await heap();
    await opts.evaluate(async () => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, ahead: false } }); });
    await until(() => page.evaluate(() => !document.querySelector('iframe[name="gz-ctab:standby"]')), 10000, 'the standby to go');
    check(true, 'switched off, the standby goes');
    const without = await heap();
    evidence.memory = { jsHeapWithStandbyMB: +(withStandby / 2 ** 20).toFixed(2), jsHeapWithoutMB: +(without / 2 ** 20).toFixed(2), standbyMB: +((withStandby - without) / 2 ** 20).toFixed(2), note: 'synthetic Ultra: Glaze and the fixture page; real Ultra adds its own app heap' };
    console.log(`standby heap: ${evidence.memory.standbyMB} MB (synthetic page)`);
    mark = docs.length;
    f = await frameOf('gz-ctab:_103_1');
    evidence.timings.coldMs = await timed('_101_1', f, '#gz-ctabs [data-course-id="_101_1"]');
    await drawn('_101_1');
    check(coldLoads('_101_1', mark).length === 1, 'switched off, a picked tab with no live frame loads cold, as before');
    console.log(`cold: click → drawn ${evidence.timings.coldMs.toFixed(0)} ms`);
    // A bounded watch: on, a standby booted within about 3 s of the page settling above.
    const t0 = Date.now(); let seen = false;
    while (Date.now() - t0 < 8000 && !seen) { seen = await page.evaluate(() => !!document.querySelector('iframe[name="gz-ctab:standby"]')); await pause(100); }
    check(!seen, 'and no standby boots while it is off');
    // A fresh page (another address: no tab is put back over it).
    await page.goto(`${site}/ultra/stream`);
    await until(() => page.evaluate(() => !!document.querySelector('#gz-ctabs [data-course-id="_104_1"]')), 15000, 'the strip on a fresh page');
    const t1 = Date.now(); seen = false;
    while (Date.now() - t1 < 8000 && !seen) { seen = await page.evaluate(() => !!document.querySelector('iframe[name="gz-ctab:standby"]')); await pause(100); }
    mark = docs.length;
    await page.hover('#gz-ctabs [data-course-id="_103_1"]'); await page.mouse.down(); await page.mouse.move(5, 5); await page.mouse.up();
    await pause(400);
    const pressed = await page.evaluate(() => document.querySelectorAll('#gz-ctabs-frames > iframe').length);
    check(!seen && pressed === 0 && coldLoads('_103_1', mark).length === 0, `off, a fresh page has no standby, and a hover or press starts no frame (${pressed} frames)`);

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    evidence.speedup = +(evidence.timings.coldMs / evidence.timings.standbyMs).toFixed(2);
    console.log(JSON.stringify(evidence));
    if (out) fs.writeFileSync(path.join(out, 'ultra-standby.json'), JSON.stringify({ results, ...evidence, docs }, null, 2));
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
