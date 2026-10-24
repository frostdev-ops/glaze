// Settings IA regressions against the unpacked extension. External requests are blocked; no school or user profile.
// NODE_PATH=<playwright> nice -n 15 node scripts/settings-ia-check.js
// IA_CASE selects one regression; EXT selects the checkout under test.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js'), lock = require('./check-env.js').lockPath();
const chromeLaunch = require('./check-env.js').chromeLaunch();
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
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-ia-check-'));
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...chromeLaunch, headless: true, viewport: { width: 1440, height: 1000 },
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
    await check('category-selection', async () => {
      await open('navigation/bar');
      await page.locator('[data-editor-tab="study"]').hover();
      assert.deepEqual(await page.locator('[data-editor-tab][aria-selected="true"]').evaluateAll((els) => els.map((el) => el.dataset.editorTab)), ['navigation']);
      const paints = await page.locator('[data-editor-tab="navigation"], [data-editor-tab="study"]').evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      assert.notEqual(paints[0], paints[1], 'hover and selection have different fills');
      await page.mouse.move(0, 0);
    });
    await check('automatic-tabs', async () => {
      await open('navigation/tabs');
      await page.evaluate(async () => {
        const s = GZ_SANITIZE();
        await chrome.storage.sync.set({ tabs: s.tabs, enhance: s.enhance, navbar: { ...s.navbar, on: false } });
      });
      await open('navigation/tabs');
      const automatic = page.locator('[name="tabs.at"][value="auto"]'), note = page.locator('[data-tabs-nav-note]');
      const reset = page.locator('[data-reset-section="navigation/tabs"]');
      assert.equal(await automatic.isChecked(), true, 'Automatic is selected for fresh settings');
      assert.equal(await reset.isVisible(), false, 'default tabs need no reset');
      assert.equal(await note.isVisible(), false, 'Automatic needs no navigation warning');
      await page.locator('label:has([name="tabs.at"][value="nav"])').click();
      assert.equal(await note.isVisible(), true, 'Only in the navigation warns immediately with navigation off');
      assert.equal(await reset.isVisible(), true);
      await automatic.locator('..').click();
      assert.equal(await note.isVisible(), false, 'Automatic clears the warning immediately');
      await page.waitForFunction(async () => (await chrome.storage.sync.get('tabs')).tabs?.at === 'auto');
      assert.equal(await reset.isVisible(), false);
      await page.locator('label:has([name="tabs.at"][value="below"])').click();
      await reset.click();
      assert.equal(await automatic.isChecked(), true, 'Reset restores Automatic');
      await page.fill('#find', 'Automatic');
      assert.equal(await automatic.locator('..').isVisible(), true, 'search finds Automatic');
      await page.fill('#find', '');
      await open('navigation/tabs');
      assert.equal(await automatic.isChecked(), true, 'Automatic survives a reload');
    });
    await check('setting-badges', async () => {
      const gaps = [];
      for (const [route, key] of [['pages/documents', 'enhance.quizLight'], ['courses/cards', 'card.create'], ['study/todo', 'todo.teacher'], ['study/todo', 'todo.progress']]) {
        await open(route);
        await page.locator('#editor-all').check();
        const gap = await page.locator(`[data-key="${key}"]`).evaluate((input) => {
          const label = input.closest('label'), title = label.querySelector('span:not(.desc)'), badge = label.closest('.has-badge').querySelector('.site-badge');
          const range = document.createRange(); range.selectNodeContents(title.firstChild);
          return badge.getBoundingClientRect().left - range.getBoundingClientRect().right;
        });
        if (gap < 0 || gap > 16) gaps.push(`${key}: ${gap}px`);
      }
      assert.deepEqual(gaps, [], 'badges follow their setting names');
    });
    await check('translated-layout', async () => {
      for (const lang of ['de', 'fr']) for (const embedded of [false, true]) {
        const host = await context.newPage();
        try {
          await host.setViewportSize({ width: 390, height: 844 });
          await host.addInitScript((language) => { chrome.i18n.getUILanguage = () => language; }, lang);
          let editor = host;
          if (embedded) {
            await host.goto(`${base}/popup.html`);
            await host.evaluate(() => {
              document.body.replaceChildren(); document.body.style.cssText = 'margin:0;max-width:none;padding:0';
              const f = document.createElement('iframe'); f.src = 'options.html#navigation/tabs';
              f.style = 'display:block;width:100%;height:100vh;border:0'; document.body.append(f);
            });
            await host.waitForFunction(() => document.querySelector('iframe')?.contentDocument?.querySelector('#looks button'));
            editor = host.frames().find((f) => f.url().includes('options.html'));
            await editor.evaluate(() => document.documentElement.setAttribute('data-embed-ok', ''));
          } else {
            await host.goto(`${base}/options.html#navigation/tabs`);
            await host.waitForFunction(() => document.querySelector('#looks button'));
          }
          assert.equal(await editor.locator('html').getAttribute('lang'), lang, 'the requested catalogue is rendered');
          await editor.locator('#editor-all').check();
          for (const dir of ['ltr', 'rtl']) {
            await editor.evaluate((direction) => { document.documentElement.dir = direction; }, dir);
            for (const route of ['look/type', 'navigation/bar', 'navigation/tabs', 'navigation/sidebar', 'study/todo', 'pages/documents']) {
              await editor.evaluate((hash) => { location.hash = hash; }, route);
              await pause(100);
              const tag = `${lang} ${embedded ? 'embedded' : 'standalone'} ${dir} ${route}`;
              const overflow = await editor.evaluate(() => {
                const width = document.documentElement.clientWidth;
                return [...document.querySelectorAll('section:not([hidden]) :is(.field, .has-info, .has-badge, .section-heading, .seg)')].filter((el) => el.getClientRects().length).map((el) => [el, el.getBoundingClientRect()]).filter(([, r]) => r.left < -1 || r.right > width + 1).map(([el]) => el.className);
              });
              assert.deepEqual(overflow, [], `${tag}: controls fit the frame`);
              const buttons = editor.locator('section button.info:visible');
              for (let i = 0; i < await buttons.count(); i++) {
                const button = buttons.nth(i);
                await button.click();
                const pop = editor.locator('.info-pop:popover-open.placed');
                await pop.waitFor();
                const fits = await pop.evaluate((el) => { const r = el.getBoundingClientRect(); return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1 && el.scrollWidth <= el.clientWidth + 1; });
                assert.equal(fits, true, `${tag}: ${await button.getAttribute('popovertarget')} fits`);
                await editor.evaluate(() => document.querySelector(':popover-open')?.hidePopover());
              }
              if (process.env.IA_OUT && ['navigation/tabs', 'pages/documents'].includes(route)) {
                fs.mkdirSync(process.env.IA_OUT, { recursive: true });
                await editor.locator(`[data-editor-section="${route}"]`).evaluate((el) => el.scrollIntoView());
                await host.screenshot({ path: path.join(process.env.IA_OUT, `${lang}-${embedded ? 'embedded' : 'standalone'}-${dir}-${route.replace('/', '-')}.png`) });
              }
            }
          }
        } finally { await host.close(); }
      }
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
    await check('popover-scroll', async () => {
      await open('study/todo');
      await page.locator('#todo button.info').first().click();
      await page.locator('.info-pop:popover-open.placed').waitFor();
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await pause(100);
      assert.equal(await page.locator(':popover-open').count(), 0, 'a description dismisses when its button scrolls out of view');
    });
  } finally {
    await context?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} settings IA browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
