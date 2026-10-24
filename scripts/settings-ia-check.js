// Settings IA regressions against the unpacked extension. External requests are blocked; no school or user profile.
// NODE_PATH=<playwright> nice -n 15 node scripts/settings-ia-check.js
// IA_CASE selects one regression; EXT selects the checkout under test.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js'), lock = env.lockPath();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let context, scratch, held = false, total = 0, failed = 0;
const check = async (name, test) => {
  if (process.env.IA_CASE && process.env.IA_CASE !== name) return;
  total++;
  try { await test(); console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
};
(async () => {
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsettings-ia-check\n`);
    await require('./wait-for-browser.js')();
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-ia-check-'));
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...env.chromeLaunch(), headless: true, viewport: { width: 1440, height: 1000 },
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking'],
    });
    env.noFirstRun(context);
    await context.route('**/*', (r) => new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    const open = async (hash = 'look/palette') => {
      await page.goto(`${base}/options.html#${hash}`);
      await page.waitForFunction(() => document.querySelector('#looks button'));
    };

    await check('escape', async () => {
      const host = await context.newPage();
      try {
        await host.goto(`${base}/popup.html`);
        await host.evaluate(() => {
          document.body.replaceChildren();
          const f = document.createElement('iframe');
          f.src = 'options.html#study/todo'; f.style = 'width:100%;height:800px'; document.body.append(f);
          window.closedSettings = 0;
          addEventListener('message', (e) => { if (e.data?.gzSettings === 'close') closedSettings++; });
        });
        await host.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#looks button'));
        const frame = host.frames().find((f) => f.url().includes('options.html'));
        // The worker correctly refuses a frame without a navigation ticket. Reveal only its UI to exercise local keys.
        await frame.evaluate(() => document.documentElement.setAttribute('data-embed-ok', ''));
        const button = frame.locator('#todo button.info').first();
        await button.click(); await frame.locator('.info-pop:popover-open.placed').waitFor();
        await host.keyboard.press('Escape');
        await pause(80);
        assert.equal(await host.evaluate(() => closedSettings), 0, 'Escape must leave Settings open');
        assert.equal(await frame.locator(':popover-open').count(), 0, 'Escape closes the description');
        assert.equal(await button.evaluate((b) => document.activeElement === b), true, 'focus returns to the question button');
        await host.keyboard.press('Escape');
        await host.waitForFunction(() => closedSettings === 1);
        for (const panel of ['sharing', 'mods', 'backup']) {
          assert.equal(await frame.locator(`[data-editor-panel="${panel}"]`).getAttribute('data-gated'), '');
        }
      } finally { await host.close(); }
    });
    await check('search-site-navigation', async () => {
      await open('navigation/bar');
      const toggle = page.locator('[data-key="navbar.on"]');
      if (await toggle.isChecked()) await toggle.uncheck();
      assert.equal(await page.locator('#bb-navigation').evaluate((e) => e.open), false);
      for (const [query, key] of [['Logo size', 'nav.logoSize'], ['Expand on hover', 'nav.expandOnHover']]) {
        await page.fill('#find', query);
        assert.equal(await page.locator(`[data-key="${key}"]`).isVisible(), true, `${query} reveals its control`);
        assert.equal(await page.locator('[data-key="nav.width"]').isVisible(), false, 'unrelated controls are filtered');
        assert.equal(await page.locator('#find-status').textContent(), '1 setting');
      }
      await page.fill('#find', '');
      assert.equal(await page.locator('#bb-navigation').evaluate((e) => e.open), false, 'clearing search restores More options');
    });
    await check('side-list-accessibility', async () => {
      await open('look/palette');
      assert.equal(await page.locator('[data-editor-jump][href="#look/palette"]').getAttribute('aria-current'), 'location', 'the current section has a valid ARIA token');
    });
    await check('rtl-tabs', async () => {
      await open('look/palette');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
      const nav = page.locator('[data-editor-tab="navigation"]');
      await nav.click(); await nav.focus(); await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.editorTab), 'look', 'Right follows the RTL visual order');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.editorTab), 'navigation');
      await page.keyboard.press('End');
      const rect = await page.locator('[data-editor-tab="about"]').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= 390, 'the selected RTL category scrolls into view');
      await page.evaluate(() => { document.documentElement.dir = 'ltr'; });
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
    await check('glass-parity', async () => {
      await open();
      await page.evaluate(async () => {
        const s = GZ_SANITIZE();
        await chrome.storage.sync.set({ look: { ...s.look, glass: 18 }, bg: { ...s.bg, kind: 'gradient' } });
      });
      await open();
      for (const selector of ['#palette', '.editor-nav', '.preview']) {
        assert.match(await page.locator(selector).evaluate((e) => getComputedStyle(e).backdropFilter), /blur\(15px\)/, `${selector} keeps the Look's glass`);
      }
      await page.evaluate(async () => { const { bg } = await chrome.storage.sync.get('bg'); await chrome.storage.sync.set({ bg: { ...bg, kind: 'solid' } }); });
      await open();
      assert.equal(await page.locator('#palette').evaluate((e) => getComputedStyle(e).backdropFilter), 'none', 'no invisible blur over solid colors');
    });
  } finally {
    await context?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} settings IA browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
