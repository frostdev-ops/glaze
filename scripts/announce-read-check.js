// Regression checks against synthetic Ultra markup/pagination. No school requests, server or persistent profile.
// NODE_PATH=/path/to/node_modules node scripts/announce-read-check.js [evidence directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), O = 'https://bb.school.test';
const out = path.resolve(process.argv[2] || '/tmp/glaze-announce-read-check');
const env = require('./check-env.js');
const lock = require('./check-env.js').lockPath();
const results = [];
let server, browser, held = false;
const check = (value, label) => { assert.ok(value, label); results.push(label); console.log(`ok ${label}`); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  try {
    fs.mkdirSync(lock); held = true;
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nannounce-read-check\n`);
    await require('./wait-for-browser.js')();
    server = await chromium.launchServer({ ...env.chromeLaunch(), headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND'] });
    console.log(`Owned Chromium PID ${server.process().pid}`);
    browser = await chromium.connect(server.wsEndpoint());
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    const page = await context.newPage(), requests = [], errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let badPaging = false, reads = [];
    await context.route('**/*', async (r) => {
      const u = new URL(r.request().url());
      requests.push(`${r.request().method()} ${u.pathname}`);
      if (u.origin !== O) return r.abort();
      if (u.pathname.startsWith('/ultra/')) return r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(root, 'test/fixtures/announce-read-ultra.html'), 'utf8') });
      if (u.pathname === '/learn/api/v1/courses/_101_1/announcements') {
        const records = await page.evaluate(() => records), offset = +(u.searchParams.get('offset') || 0);
        reads.push(offset);
        return r.fulfill({ json: { results: records.slice(offset, offset + 10), paging: { count: records.length,
          nextPage: badPaging ? 'https://other.test/learn/api/v1/courses/_101_1/announcements?offset=10' : offset + 10 < records.length ? `${u.pathname}?offset=${offset + 10}` : '' } } });
      }
      return r.abort();
    });
    const setup = async () => {
      await page.goto(`${O}/ultra/courses/_101_1/announcements`);
      await page.addStyleTag({ path: path.join(root, 'theme.css') });
      await page.evaluate(() => {
        window.GZ_CTX = { site: 'ultra', on: () => true, t: (k) => k, need: async () => {} };
        window.GZ_LMSQ = { fetch: (...a) => fetch(...a) };
        window.chrome = Object.assign(window.chrome || {}, { storage: { onChanged: { addListener: (f) => { window.storageChanged = f; } } } });
      });
      for (const f of ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/ultra.js', 'features/announce-read.js']) await page.addScriptTag({ path: path.join(root, f) });
      assert.deepEqual(errors, [], 'fixture loads the same library prerequisites as the extension');
      await page.evaluate(() => { GZ_ANNOUNCE_READ.sync(); window.sweep = setInterval(() => GZ_ANNOUNCE_READ.sync(), 100); });
      reads = [];
    };
    const button = () => page.getByRole('button', { name: 'Mark all as read', exact: true });
    const toggle = (id) => page.locator(`#list-item-title-${id}`).locator('..').getByRole('checkbox');
    const scrollTop = () => page.locator('.panel-wrap').evaluate((e) => e.scrollTop);
    await setup();
    await page.evaluate(() => { loaded = 25; render(); document.querySelector('.panel-wrap').scrollTop = 2200; });
    const before = await scrollTop();
    await toggle('_7023_1').click();
    await page.waitForFunction(() => records[22].readStatus.isRead && loaded === 25 && Math.abs(document.querySelector('.panel-wrap').scrollTop - 2200) < 2);
    await page.waitForTimeout(1100);
    check(Math.abs(await scrollTop() - before) < 2, 'single read survives the first-page reset and restores deep scroll');
    check(await toggle('_7023_1').evaluate((e) => e === document.activeElement), 'focus follows the replaced checkbox without scrolling');
    await toggle('_7023_1').press('Space');
    await page.waitForFunction(() => !records[22].readStatus.isRead && loaded === 25 && Math.abs(document.querySelector('.panel-wrap').scrollTop - 2200) < 2);
    check(true, 'keyboard unread preserves the same position');
    await page.evaluate(() => { GZ_ANNOUNCE_READ.off(); clearInterval(sweep); });

    await setup();
    await button().click();
    await page.waitForFunction(() => document.querySelector('.gz-ann-read-status').textContent === 'All announcements marked as read', null, { timeout: 25000 }).catch(async (e) => {
      console.error(await page.evaluate(() => ({ marks, loaded, status: document.querySelector('.gz-ann-read-status')?.textContent, top: document.querySelector('.panel-wrap').scrollTop })), reads, errors);
      throw e;
    });
    await page.waitForTimeout(1100);
    check(await page.evaluate(() => records.every((r) => r.readStatus.isRead)), 'bulk reaches unread announcements on every native page');
    assert.deepEqual(await page.evaluate(() => marks), ['_7002_1', '_7014_1', '_7023_1']);
    assert.deepEqual(reads, [0, 10, 20]);
    check(true, 'bulk snapshots all API pages and activates only unread native controls once');
    check(await scrollTop() === 0, 'bulk restores the starting position');
    check(await button().evaluate((e) => e === document.activeElement && !e.disabled), 'bulk returns focus and enables its button');
    check(requests.every((s) => s.startsWith('GET ')), 'Glaze itself only makes reads; Blackboard owns the marks');
    await page.screenshot({ path: path.join(out, 'desktop.png') });
    check(await button().evaluate((e) => e.nextElementSibling?.matches('.header-actions-menu__item')), 'the button sits before Ultra\'s search, which stays last');
    // Switched off, content.js makes no more passes: the storage change alone takes the button away.
    await page.evaluate(() => { clearInterval(sweep); storageChanged({ enabled: { newValue: false } }, 'sync'); });
    check(await page.locator('.gz-ann-read-all').count() === 0, 'switching Glaze off removes the button');

    badPaging = true;
    await setup();
    await button().click();
    await page.waitForFunction(() => document.querySelector('.gz-ann-read-status').textContent.startsWith('Could not'));
    check(await page.evaluate(() => marks.length === 0), 'incomplete or foreign pagination changes nothing and reports failure');
    badPaging = false;

    await setup();
    await page.evaluate(() => { failId = '_7002_1'; });
    await button().click();
    await page.waitForFunction(() => document.querySelector('.gz-ann-read-status').textContent.startsWith('Could not'), null, { timeout: 15000 });
    check(await page.evaluate(() => marks.length === 1 && !records[1].readStatus.isRead && !records[13].readStatus.isRead), 'failed native update stops the batch without claiming success');

    await setup();
    await page.evaluate(() => { delay = 800; });
    await button().click();
    await page.waitForFunction(() => marks.length === 1);
    await page.mouse.wheel(0, 350);
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => marks.length === 1 && !document.querySelector('.gz-ann-read-status').textContent), 'user scrolling cancels further marks and suppresses success');
    await button().waitFor();

    await setup();
    await page.evaluate(() => { loaded = 25; render(); delay = 700; document.querySelector('.panel-wrap').scrollTop = 2200; });
    await toggle('_7023_1').click();
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(1600);
    check(await scrollTop() !== 2200, 'single-checkbox recovery yields to subsequent user scrolling');
    await page.evaluate(() => { history.pushState(null, '', '/ultra/courses/_101_1/grades'); GZ_ANNOUNCE_READ.sync(); });
    check(await page.locator('.gz-ann-read-all').count() === 0, 'leaving announcements removes the control');

    await setup();
    await page.setViewportSize({ width: 320, height: 700 });
    await page.evaluate(() => { GZ_CTX.t = (k) => k === 'Mark all as read' ? 'Alle als gelesen markieren' : k; GZ_ANNOUNCE_READ.sync(); });
    check(await page.locator('.gz-ann-read-all').evaluate((e) => e.getBoundingClientRect().right <= innerWidth && e.scrollWidth <= e.clientWidth), 'German bulk button fits at 320 pixels');
    await page.screenshot({ path: path.join(out, 'phone-de.png') });
    await page.evaluate(() => document.documentElement.dir = 'rtl');
    check(await page.locator('.gz-ann-read-all').evaluate((e) => e.getBoundingClientRect().left >= 0 && e.getBoundingClientRect().right <= innerWidth), 'bulk button fits in RTL');
    check(errors.length === 0, `no page errors: ${errors.join('; ')}`);
    await context.close();
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results.length, results }, null, 2));
    console.log(`${results.length} checks passed`);
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
