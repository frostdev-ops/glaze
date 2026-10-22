// Synthetic live-course regression: real unpacked extension, headless Chrome, no account or outside network.
// NODE_PATH=<installed playwright> node scripts/ultra-live-frames-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const G = require(path.join(ext, 'defaults.js')); require(path.join(ext, 'lib/coursetabs.js'));
const html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-course.html'), 'utf8')
  .replace("{ id: '_105_1', name: 'Biology Lab', code: 'FA26-BIO120-01', color: 9 },", "{ id: '_105_1', name: 'Biology Lab', code: 'FA26-BIO120-01', color: 9 },\n{ id: '_106_1', name: 'Synthetic Sixth Course', code: 'CS106', color: 1 },");
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-live-frames-'));
const out = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
// Await actual values: installed Playwright does not await an async waitForFunction predicate.
const until = async (fn, ms = 12000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn(); if (value) return value; await pause(80); }
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
    let uid = '_42_1', stallFirstCourse = true, stalledCourse = null;
    const stalledSixth = [];
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      requests.push({ method: route.request().method(), origin: u.origin, path: u.pathname, ...(u.pathname.endsWith('/users/me') && { fixtureUid: uid }) });
      if (u.origin === site && u.pathname.startsWith('/ultra')) {
        if (stallFirstCourse && u.pathname === '/ultra/courses/_102_1/outline' && route.request().isNavigationRequest()) {
          stallFirstCourse = false; stalledCourse = route; return;
        }
        if (u.pathname === '/ultra/courses/_106_1/outline' && route.request().isNavigationRequest() && stalledSixth.length < 2) {
          stalledSixth.push(route); return;
        }
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }), headers: { 'cache-control': 'no-store' } });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const settings = { ...G.GZ_DEFAULTS, navbar: { ...G.GZ_DEFAULTS.navbar, on: false }, enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place'].includes(k)])), tabs: G.GZ_SANITIZE({}).tabs };
    await opts.evaluate(async ({ settings, key }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ [key]: { tabs: Array.from({ length: 6 }, (_, i) => ({ cid: `_${101 + i}_1`, name: `Synthetic course ${i + 1}`, path: `/ultra/courses/_${101 + i}_1/outline`, top: 0, at: i, pin: false })) } });
    }, { settings, key });
    const saved = () => opts.evaluate(async (key) => (await chrome.storage.local.get(key))[key]?.tabs, key);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    const tab = (f, cid) => f.locator(`#gz-ctabs [data-course-id="${cid}"]`);
    const frame = (cid) => page.frames().find((f) => f.name() === `gz-ctab:${cid}`);
    const ready = async (cid) => {
      const f = await until(() => Promise.resolve(frame(cid)));
      await f.waitForSelector('#gz-ctabs');
      await until(() => f.evaluate(() => !document.querySelector('.spinner, [data-gz-placing]')));
      await until(() => f.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctab-framed')));
      return f;
    };
    await page.goto(`${site}/ultra/courses/_101_1/outline`); await tab(page, '_102_1').waitFor(); await pause(800);
    // Do not wait for the child navigation: its deliberately held request is the state under test.
    await tab(page, '_102_1').click({ noWaitAfter: true });
    await until(async () => stalledCourse && await page.locator('iframe[name="gz-ctab:_102_1"]').count());
    const blank = await page.evaluate(() => { const d = document.querySelector('iframe[name="gz-ctab:_102_1"]').contentDocument; return { url: d?.location.href, children: d?.body?.childElementCount }; });
    check(blank.url === 'about:blank' && blank.children === 0, `a held document request reproduces the empty course frame (${JSON.stringify(blank)})`);
    let f2 = await ready('_102_1');
    check(requests.filter((r) => r.path === '/ultra/courses/_102_1/outline').length === 2, 'the blank frame recovers with one bounded document retry');
    await stalledCourse.abort().catch(() => {});
    check(page.url().endsWith('/_101_1/outline'), 'picking a live course keeps the surrounding address and native page');
    check(await f2.evaluate(() => document.querySelectorAll('#gz-ctabs').length === 1 && !document.querySelector('#gz-footer')), 'one strip and no duplicate footer inside a live frame');
    await tab(f2, '_106_1').click({ noWaitAfter: true });
    await until(async () => stalledSixth.length && await page.locator('iframe[name="gz-ctab:_106_1"]').count());
    // Let both bounded attempts time out while another tab is selected.
    await tab(page, '_101_1').focus(); await page.keyboard.press('Enter');
    await until(() => Promise.resolve(stalledSixth.length === 2));
    await pause(8200);
    await tab(page, '_106_1').click({ noWaitAfter: true });
    const retry = page.locator('.gz-ctabs-retry').getByRole('button', { name: 'Retry', exact: true });
    await retry.waitFor({ state: 'visible' });
    check(await retry.evaluate((e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === e; }), 'a tab that stalled while hidden exposes a clickable foreground Retry control');
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'stalled-course.png') }); }
    await retry.click({ noWaitAfter: true });
    const f6 = await ready('_106_1');
    check(!await page.locator('.gz-ctabs-retry').count() && requests.filter((r) => r.path === '/ultra/courses/_106_1/outline').length === 3, 'manual Retry replaces only the stalled clean frame and restores course content');
    for (const held of stalledSixth) await held.abort().catch(() => {});
    await tab(f6, '_102_1').click(); f2 = await ready('_102_1');
    const birth = await f2.evaluate(() => performance.timeOrigin);
    await f2.evaluate(() => { const t = document.createElement('textarea'); t.id = 'live-draft'; t.setAttribute('aria-label', 'Synthetic draft'); document.body.append(t); });
    await f2.locator('#live-draft').fill('unsaved synthetic work');
    await f2.locator('.b8b-document').click(); await f2.waitForSelector('.routed-scroll main');
    await f2.evaluate(() => { document.querySelector('.routed-scroll').scrollTop = 330; });
    await until(async () => (await saved()).find((x) => x.cid === '_102_1')?.path.includes('/document/_8110_1?view=content&state=view&parentId=_8130_1'));
    check(true, 'a live frame reports its exact routed document and query to the owning list');
    await tab(f2, '_103_1').click(); let f3 = await ready('_103_1');
    await until(() => f2.evaluate(() => document.documentElement.hasAttribute('data-gz-ctab-framed')));
    check(true, 'hidden frame uses the existing still-scene switch');
    const beforeReturn = requests.length;
    await tab(f3, '_102_1').click(); f2 = await ready('_102_1');
    check(await f2.locator('#live-draft').inputValue() === 'unsaved synthetic work' && await f2.evaluate(() => performance.timeOrigin) === birth, 'switching back retains the same edited document');
    check(requests.length === beforeReturn, 'switching to an existing live document makes no requests in this fixture');
    await tab(f2, '_102_1').focus();
    // Keyboard belongs to Page; focus inside the frame selects its strip handler.
    await page.keyboard.press('p');
    await until(async () => (await saved()).find((x) => x.cid === '_102_1')?.pin === true);
    check(true, 'pinning the frame’s own tab persists through the top owner');
    await page.keyboard.press('p'); await until(async () => (await saved()).find((x) => x.cid === '_102_1')?.pin === false);
    await page.keyboard.press('Shift+ArrowRight');
    await until(async () => (await saved()).findIndex((x) => x.cid === '_102_1') === 1);
    check(true, 'keyboard reorder inside a frame persists through the owner');
    await tab(f2, '_103_1').click(); f3 = await ready('_103_1');
    await opts.evaluate(async (key) => { const r = await chrome.storage.local.get(key); r[key].tabs = r[key].tabs.filter((x) => x.cid !== '_103_1'); await chrome.storage.local.set(r); }, key);
    await until(() => Promise.resolve(!frame('_103_1')));
    await until(() => page.evaluate(() => !document.querySelector('#gz-ctabs-frames[data-on]')));
    check(true, 'closing a saved active tab destroys its frame and uncovers the native page');
    // Restore the closed entry; give four live pages trusted edits, then request a fifth frame.
    await opts.evaluate(async (key) => { const r = await chrome.storage.local.get(key); r[key].tabs.push({ cid: '_103_1', name: 'Synthetic course 3', path: '/ultra/courses/_103_1/outline', top: 0, at: 0 }); await chrome.storage.local.set(r); }, key);
    let current = page;
    for (const cid of ['_102_1', '_103_1', '_104_1', '_105_1']) {
      await tab(current, cid).click(); current = await ready(cid);
      await current.evaluate(() => { if (!document.getElementById('protected-draft')) { const t = document.createElement('textarea'); t.id = 'protected-draft'; t.setAttribute('aria-label', 'Protected synthetic draft'); document.body.append(t); } });
      await current.locator('#protected-draft').fill('retain ' + cid);
    }
    await tab(current, '_106_1').click(); await pause(500);
    check(!frame('_106_1') && page.frames().length === 5, 'four edited frames refuse a fifth without exceeding the hard cap');
    check((await current.locator('.gz-ctabs-note').textContent()).includes('unsaved work'), 'the visible frame announces why another page cannot open');
    for (const cid of ['_102_1', '_103_1', '_104_1', '_105_1']) check(await frame(cid).locator('#protected-draft').inputValue() === 'retain ' + cid, `edited state retained in ${cid}`);
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      for (const preset of ['Frost', 'Paper']) for (const width of [1280, 375]) {
        await opts.evaluate(async ({ colors, preset }) => chrome.storage.sync.set({ colors, preset }), { colors: G.GZ_PRESETS.find(([name]) => name === preset)[1], preset });
        await page.setViewportSize({ width, height: 860 }); await pause(300);
        await page.screenshot({ path: path.join(out, `${preset}-${width}.png`) });
      }
    }
    await tab(current, '_105_1').locator('.gz-ctab-x').click(); await until(() => Promise.resolve(!frame('_105_1')));
    check(true, 'explicit close releases a protected document');
    // Reloading preserves the selected course’s URL; native form state is intentionally not promised across reload.
    await page.reload(); await until(() => Promise.resolve(page.frames().some((f) => f.name().startsWith('gz-ctab:'))));
    check(true, 'reload reopens the selected saved live course');
    await opts.evaluate(() => chrome.storage.sync.set({ enhance: { tabs: false } }));
    await until(() => Promise.resolve(page.frames().length === 1));
    check(true, 'disabling course tabs removes every live frame');
    await opts.evaluate(() => chrome.storage.sync.set({ enhance: { tabs: true } }));
    await page.goto(`${site}/ultra/courses/_101_1/outline`); await tab(page, '_106_1').waitFor(); await pause(800);
    await page.evaluate(() => { window.__bridge = []; addEventListener('message', (e) => { if (e.data?.gzCtab) window.__bridge.push(e.data); }); });
    await tab(page, '_106_1').waitFor(); uid = '_43_1'; await tab(page, '_106_1').focus(); await page.keyboard.press('Enter');
    try { await until(() => page.evaluate(() => !document.querySelector('#gz-ctabs') && !document.querySelector('#gz-ctabs-frames'))); } catch (e) { console.log('account diagnostic', await page.evaluate(() => window.__bridge), requests.slice(-12), await Promise.all(page.frames().map(async f => ({name:f.name(),url:f.url(),info:await f.evaluate(() => ({strip:!!document.querySelector('#gz-ctabs'),html:document.documentElement.outerHTML.slice(0,250)})).catch(()=>null)})))); throw e; }
    check(true, 'a different account in a new frame revokes and removes old-account tab UI');
    check(errors.length === 0, 'no page errors');
    check(requests.every((r) => r.method === 'GET' && [site, 'https://cdn.school.test'].includes(r.origin)), 'all observed network requests are routed synthetic GETs');
    console.log(JSON.stringify({ checks: results.length, requests: requests.length, errors }, null, 2));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results, requests, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
