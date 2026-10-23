// An announcement opened in an Ultra course tab, closed: the tab stays, back where it was. Real unpacked extension,
// headless Chrome, the synthetic Ultra (test/fixtures/ultra-course.html), no account or outside network.
// NODE_PATH=<installed playwright> node scripts/ctab-panel-close-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const G = require(path.join(ext, 'defaults.js'));
const html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-panel-close-'));
const out = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(80); }
  throw new Error('condition timed out');
};
const results = [], requests = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      requests.push({ method: route.request().method(), origin: u.origin, path: u.pathname, nav: route.request().isNavigationRequest() });
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const settings = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place'].includes(k)])), tabs: G.GZ_SANITIZE({}).tabs };
    await opts.evaluate(async ({ settings, key, site }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] });
      await chrome.storage.local.set({ [key]: { tabs: [101, 102].map((n, i) => ({ cid: `_${n}_1`, name: `Synthetic course ${i + 1}`, path: `/ultra/courses/_${n}_1/outline`, top: 0, at: i, pin: false })) } });
    }, { settings, key, site });
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    const frame = () => page.frames().find((f) => f.name() === 'gz-ctab:_102_1');
    const where = (f) => f.evaluate(() => location.pathname + location.search);
    // A student reads a panel before closing it; Glaze's passes run on the page's changes, 150 ms apart at most.
    const read = () => pause(800);
    const shown = () => page.evaluate(() => { const f = document.querySelector('iframe[name="gz-ctab:_102_1"]'); return !!f && !f.inert && !!document.querySelector('#gz-ctabs-frames[data-on]'); });
    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    await until(shown);
    let f = await until(() => Promise.resolve(frame()));
    await f.waitForSelector('.js-course-announcement-tool');
    await until(() => f.evaluate(() => !document.querySelector('.spinner, [data-gz-placing]') && !document.documentElement.hasAttribute('data-gz-ctab-framed')));
    await f.click('.js-course-announcement-tool');
    await f.waitForSelector('announcement-list a.list-item-title');
    const birth = await f.evaluate(() => performance.timeOrigin);
    await f.click('announcement-list a.list-item-title');
    await f.waitForSelector('.bb-offcanvas-panel.full .js-close-announcement');
    await read();
    check(await where(f) === '/ultra/stream/announcement-detail?courseId=_102_1&announcementId=_7001_1' && await shown() && page.url() === `${site}/ultra/courses/_101_1/outline`, 'the announcement opens inside the course tab');
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'announcement.png') }); }
    const navs = requests.filter((r) => r.nav).length;
    await f.click('.js-close-announcement');
    await until(async () => await where(f) === '/ultra/courses/_102_1/announcements' && await f.locator('announcement-list a.list-item-title').count());
    await pause(800);
    check(page.url() === `${site}/ultra/courses/_101_1/outline` && await shown() && frame() === f, 'closing it keeps the window and the course tab open');
    check(await where(f) === '/ultra/courses/_102_1/announcements' && !await f.locator('.bb-offcanvas-panel.full').count(), 'the tab is back on the course\'s Announcements');
    check(await f.evaluate(() => performance.timeOrigin) === birth && requests.filter((r) => r.nav).length === navs, 'without reloading the frame');
    if (out) await page.screenshot({ path: path.join(out, 'closed.png') });
    // Back reopens the announcement in the tab; Forward returns to the Announcements, never to the stream.
    await f.evaluate(() => history.back());
    await until(async () => await where(f) === '/ultra/stream/announcement-detail?courseId=_102_1&announcementId=_7001_1');
    await pause(500);
    check(page.url() === `${site}/ultra/courses/_101_1/outline` && await shown(), 'Back reopens the announcement inside the tab');
    await f.evaluate(() => history.forward());
    await until(async () => await where(f) === '/ultra/courses/_102_1/announcements');
    await pause(500);
    check(page.url() === `${site}/ultra/courses/_101_1/outline` && await shown(), 'Forward goes back to the Announcements inside the tab');
    // A second announcement panel from the first, closed: the same.
    await f.click('announcement-list a.list-item-title');
    await f.waitForSelector('.bb-offcanvas-panel.full .js-close-announcement');
    await read();
    await f.evaluate(() => { history.pushState(null, '', location.origin + '/ultra/stream/announcement-detail?courseId=_102_1&announcementId=_7002_1'); dispatchEvent(new PopStateEvent('popstate')); });
    await read();
    await f.click('.js-close-announcement');
    await until(async () => await where(f) === '/ultra/courses/_102_1/announcements');
    await pause(500);
    check(page.url() === `${site}/ultra/courses/_101_1/outline` && await shown(), 'a second panel opened from the first closes back into the tab');
    // Ultra can replace the panel entry on close as well as push a new one.
    await f.click('announcement-list a.list-item-title');
    await f.waitForSelector('.js-close-announcement');
    await f.evaluate(() => document.querySelector('.js-close-announcement').addEventListener('click', (e) => {
      e.stopImmediatePropagation(); history.replaceState(null, '', location.origin + '/ultra/stream');
      dispatchEvent(new PopStateEvent('popstate'));
    }));
    await f.click('.js-close-announcement');
    await until(async () => await where(f) === '/ultra/courses/_102_1/announcements' && await f.locator('announcement-list a.list-item-title').count());
    check(await shown() && await f.evaluate(() => performance.timeOrigin) === birth, 'a replaceState close returns through the router without reloading');
    // A real move away still takes the window there.
    await f.click('#site-wrap a[href="/ultra/stream"]');
    await until(async () => page.url() === `${site}/ultra/stream` && !await shown());
    check(true, 'a link to the Activity Stream from the tab still takes the window there');
    check(errors.length === 0, 'no page errors');
    check(requests.every((r) => r.method === 'GET' && [site, 'https://cdn.school.test'].includes(r.origin)), 'all observed network requests are routed synthetic GETs');
    console.log(JSON.stringify({ checks: results.length, requests: requests.length, errors }, null, 2));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results, requests, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
