// Ultra sidebar geometry and live widget continuity on synthetic pages, without an LMS or external requests.
// NODE_PATH=<installed playwright> nice -n 15 node scripts/sidebar-ultra-check.js
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-ultra-'));
let checks = 0, fails = 0;
const check = (ok, text) => { checks++; fails += !ok; console.log(`${ok ? 'ok' : 'FAIL'} ${text}`); };
(async () => {
  let browser;
  try {
    await require('./wait-for-browser.js')();
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), args: ['--host-resolver-rules=MAP * ~NOTFOUND'], chromiumSandbox: false });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const shot = async (name) => { if (out) { fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, `${name}.png`) }); } };
    await page.route('**/*', (r) => r.request().url().startsWith('https://bb.school.test/ultra/') ? r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }) : r.abort());
    const setup = async (family) => {
      await page.goto(`https://bb.school.test/ultra/${family === 'courses' ? 'course' : 'courses/_101_1/outline'}`);
      await page.setContent(`<style>
        * { box-sizing: border-box; } body { margin: 0; } #main-content-inner { margin-left: 200px; }
        .base-courses-content, .course-outline-content { display: flex; gap: 16px; }
        .courses-panel, .outline-column { flex: 1; min-width: 0; } .todo-panel, .outline-actions { width: 300px; flex: none; }
        .bb-course-navigation { height: 60px; } .course-content-container > .panel-wrap { position: relative; z-index: 20; }
        .layer-details { position: fixed; inset: 0; z-index: 2000; background: white; }
      </style><div id="site-wrap"><div id="main-content-inner">${family === 'courses'
        ? '<div class="base-courses-content"><div class="courses-panel"><button id="main-end" style="float:right">Last course</button></div><div class="todo-panel"><bb-todo>Native To Do</bb-todo></div></div>'
        : '<div class="course-content-container"><div class="panel-wrap"><div class="bb-course-navigation">Course navigation</div><section class="course-outline-content"><div class="outline-column"><button id="main-end" style="float:right">Last item</button></div><aside class="outline-actions"><button>Faculty</button></aside></section></div></div>'}</div></div>`);
      for (const file of ['features/apps.css', 'features/sidebar.css']) await page.addStyleTag({ path: path.join(root, file) });
      for (const file of ['lib/widgets.js', 'lib/sidebar.js']) await page.addScriptTag({ path: path.join(root, file) });
      await page.evaluate(() => {
        const rec = GZ_SIDEBAR.clean({ mig: 1, dock: [{ id: 'notes' }], dest: { notes: 'dock' } });
        window.chrome = { storage: { local: { get: (key, cb) => cb({ [key]: rec }) }, onChanged: { addListener() {}, removeListener() {} } }, runtime: {} };
        window.GZ_CTX = { site: 'ultra', t: (s) => s, need: async () => {}, account: async () => '_42_1', courseId: () => '_101_1', settings: () => ({ enhance: { sidebar: true, notes: true, todo: true } }) };
      });
      await page.addScriptTag({ path: path.join(root, 'features/sidebar.js') });
      await page.evaluate(async () => { GZ_SIDEBAR_UI.sync(true); await GZ_SIDEBAR_UI.ready(); });
      await page.waitForSelector('[data-gz-sidebar-host]');
    };
    for (const family of ['courses', 'outline']) {
      await setup(family);
      const clear = () => page.evaluate(() => document.querySelector('#main-end').getBoundingClientRect().right + 16 <= document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left);
      check(await clear(), `${family}: expanded content keeps the sidebar width and gap`);
      await shot(`${family}-expanded`);
      if (family === 'courses') {
        await page.evaluate(() => {
          const room = document.createElement('div'); room.id = 'gz-room';
          room.innerHTML = '<section class="gz-w" style="position:absolute;right:0;width:288px;height:100px">Course card</section>';
          document.querySelector('#main-content-inner').prepend(room);
        });
        check(await page.evaluate(() => document.querySelector('#gz-room .gz-w').getBoundingClientRect().right + 16 <= document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left), 'course cards at the board edge keep clear of the dock too');
      }
      await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar', 'collapsed'));
      check(await clear(), `${family}: collapsed content keeps the sidebar width and gap`);
      await page.evaluate(() => GZ_SIDEBAR_UI.sync(false));
      check(await page.locator('[data-gz-sidebar-host]').count() === 0 && await page.locator('#main-end').isVisible(), `${family}: teardown restores native flow`);
    }
    await setup('outline');
    await page.evaluate(() => { document.querySelector('aside.outline-actions').remove(); GZ_SIDEBAR_UI.sync(true); });
    await page.waitForSelector('#gz-sidebar');
    check(await page.evaluate(() => Math.abs(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left - document.querySelector('#main-end').getBoundingClientRect().right - 16) < 1), 'missing native host reserves the width once, without a second blank column');
    await page.evaluate(() => {
      const inner = document.querySelector('#main-content-inner'); inner.removeAttribute('id');
      inner.className = 'routed-page bb-offcanvas-container';
      document.querySelector('.course-content-container').className = '';
      GZ_SIDEBAR_UI.sync(true);
    });
    await page.waitForTimeout(100);
    check(await page.evaluate(() => Math.abs(document.querySelector('[data-gz-sidebar-host]').getBoundingClientRect().left - document.querySelector('#main-end').getBoundingClientRect().right - 16) < 1), 'a routed page without main-content-inner also reserves room');
    await setup('outline');
    await page.evaluate(() => {
      window.loads = 0;
      const frame = document.createElement('iframe'); frame.id = 'media';
      frame.srcdoc = '<textarea>retained draft</textarea><script>window.birth=Math.random();parent.loads++;</script>';
      document.querySelector('.gz-sb-dock').append(frame);
    });
    await page.waitForFunction(() => window.loads === 1);
    const birth = await page.frames().find((f) => f.parentFrame()).evaluate(() => window.birth);
    await page.evaluate(() => { const b = document.createElement('button'); b.textContent = 'Late schedule'; document.querySelector('aside.outline-actions').append(b); });
    await page.waitForTimeout(150);
    check(await page.evaluate(() => window.loads === 1), 'late native blocks preserve the live iframe document');
    check(await page.evaluate(() => document.querySelector('#gz-sb-widgets').getBoundingClientRect().top >= [...document.querySelector('aside.outline-actions').children].find((e) => e.textContent === 'Late schedule').getBoundingClientRect().bottom), 'late blocks remain visually above the dock');
    await page.evaluate(() => { const layer = document.createElement('div'); layer.className = 'layer-details'; layer.textContent = 'Participation'; document.body.append(layer); GZ_SIDEBAR_UI.sync(true); });
    await page.waitForFunction(() => document.documentElement.dataset.gzSidebar === 'drawer');
    await page.locator('#gz-sb-launch').click();
    check(await page.evaluate(() => { const host = document.querySelector('[data-gz-sidebar-host]'), r = host.getBoundingClientRect(); return host.contains(document.elementFromPoint(r.left + 15, r.top + 15)); }), 'details drawer is reachable above Ultra layers and ancestor stacking contexts');
    await shot('details-drawer');
    check(await page.evaluate(() => document.elementFromPoint(600, 400)?.classList.contains('gz-sb-backdrop')), 'the backdrop intercepts clicks above Ultra details');
    await page.locator('.gz-sb-more').click();
    check(await page.locator('#gz-sb-menu').isVisible(), 'drawer customization stays in the same top layer');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { document.querySelector('.layer-details').remove(); GZ_SIDEBAR_UI.sync(true); });
    await page.waitForFunction(() => document.documentElement.dataset.gzSidebar === 'expanded');
    check(await page.evaluate(() => window.loads === 1) && await page.frames().find((f) => f.parentFrame()).evaluate((b) => window.birth === b && document.querySelector('textarea').value === 'retained draft', birth), 'opening and closing details preserves media and drafts');
    check(await page.locator('[data-gz-sidebar-host][popover]').count() === 0, 'closing the drawer restores native host attributes');
    await setup('courses');
    await page.evaluate(() => document.documentElement.setAttribute('data-gz-sidebar-todo', ''));
    check(await page.locator('bb-todo').isHidden(), 'screen hides native To Do after replacement');
    await page.emulateMedia({ media: 'print' });
    check(await page.locator('bb-todo').isVisible(), 'printing restores native Ultra To Do');
    console.log(JSON.stringify({ checks, fails }));
    process.exitCode = fails ? 1 : 0;
  } finally { await browser?.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
