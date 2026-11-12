// Setup and Settings parity, typed credentials, previews and narrow layouts. Disposable profile; no outside requests.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../../tools/dev/check-env.js'), root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = path.resolve(process.argv[2] || '/out'), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-settings-clarity-'));
const results = [], errors = [];
let context;
const until = async (fn) => { for (const end = Date.now() + 8000; !await fn();) { if (Date.now() > end) throw Error('State did not settle'); await new Promise((r) => setTimeout(r, 40)); } };
const check = async (name, run) => { try { await run(); results.push({ name, ok: true }); console.log(`ok ${name}`); } catch (e) { results.push({ name, ok: false, error: e.message }); console.error(`FAIL ${name}: ${e.message}`); } };
(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    await context.route('**/*', (r) => new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), base = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.setDefaultTimeout(8000); page.on('pageerror', (e) => errors.push(e.stack || String(e)));
    const open = async (route) => {
      if (!page.url().startsWith(`${base}/options.html`)) await page.goto(`${base}/options.html#${route}`);
      else await page.evaluate((hash) => { location.hash = hash; }, route);
      await page.waitForFunction((r) => document.querySelector('#looks button') && editor.route() === r, route);
      if (await page.locator('#find').inputValue()) await page.locator('#find').fill('');
    };
    await open('look/palette'); await env.installed(page);
    for (const other of context.pages()) if (other !== page) await other.close();

    await check('slash stays in API keys and passphrases', async () => {
      await open('ai/setup'); await page.locator('#ai-on').check(); await page.locator('#ai-prov-openai').click();
      await page.locator('#ai-key').focus(); await page.keyboard.type('invented/key');
      assert.equal(await page.locator('#ai-key').inputValue(), 'invented/key');
      assert.equal(await page.locator('#find').inputValue(), '');
      await open('mods/dev'); await page.locator('#mod-dev').check(); await page.locator('#mod-key-pass').click(); await page.keyboard.type('invented/phrase');
      assert.equal(await page.locator('#mod-key-pass').inputValue(), 'invented/phrase');
      await page.locator('h2').first().focus().catch(() => {});
      await page.locator('.brand').click(); await page.keyboard.press('/');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'find');
      await open('look/motion'); await page.locator('input[name="motion.level"][value="subtle"]').focus(); await page.keyboard.press('/');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'find', 'from a motion choice');
    });
    await check('Frost is a complete theme and survives reopening', async () => {
      await open('look/palette'); await page.locator('#looks .look[data-look="Synthwave"]').click();
      await until(() => page.evaluate(async () => (await chrome.storage.sync.get('colors')).colors?.['--gz-accent'] === '#f472b6'));
      assert.equal(await page.locator('#looks .look[data-look="Frost"]').count(), 1);
      await page.locator('#looks .look[data-look="Frost"]').click();
      await until(() => page.evaluate(async () => { const s = await GZ_UI.load(); return s.preset === 'Frost' && s.bg.kind === GZ_DEFAULTS.bg.kind && s.look.font === GZ_DEFAULTS.look.font && !s.parts; }));
      await page.reload(); await open('look/palette'); assert.equal(await page.locator('#looks .look[data-look="Frost"]').getAttribute('aria-pressed'), 'true');
    });
    await check('dependent controls wait for their features without losing preferences', async () => {
      await open('pages/shortcuts'); await page.locator('[data-key="enhance.palette"]').uncheck();
      await until(() => page.locator('[data-key="enhance.search"]').isDisabled());
      assert.equal(await page.locator('[data-key="enhance.search"]').isChecked(), true);
      await page.locator('[data-key="enhance.palette"]').check();
      await until(async () => !await page.locator('[data-key="enhance.search"]').isDisabled());
      await open('writer/setup');
      const format = await page.locator('[data-key="writer.format"]').inputValue();
      await page.locator('[data-key="enhance.writer"]').uncheck();
      await until(() => page.locator('[data-key="writer.format"]').isDisabled());
      assert.equal(await page.locator('[data-key="writer.format"]').inputValue(), format);
      await page.locator('[data-key="enhance.writer"]').check();
      await until(async () => !await page.locator('[data-key="writer.format"]').isDisabled());
    });
    await check('themes work with arrows, Home/End and a single keyboard stop', async () => {
      await open('look/palette'); await page.locator('#looks .look[aria-pressed="true"]').focus();
      await page.keyboard.press('End');
      await until(() => page.locator('#looks .look[data-look="Hearthside"]').getAttribute('aria-pressed').then((s) => s === 'true'));
      assert.equal(await page.evaluate(() => document.activeElement.dataset.look), 'Hearthside');
      await page.keyboard.press('Home');
      await until(() => page.locator('#looks .look[data-look="Frost"]').getAttribute('aria-pressed').then((s) => s === 'true'));
      assert.equal(await page.locator('#looks .look[tabindex="0"]').count(), 1);
    });
    await check('Speed has one owner and resets without changing course-tab preferences', async () => {
      await open('pages/speed');
      const before = await page.evaluate(() => GZ_UI.load());
      for (const key of ['instant', 'prefetch', 'feedback']) {
        assert.equal(await page.locator(`[data-key="enhance.${key}"]`).count(), 1);
        assert.equal(await page.locator(`[data-key="enhance.${key}"]`).evaluate((e) => e.closest('[data-editor-section]').dataset.editorSection), 'pages/speed');
        await page.locator(`[data-key="enhance.${key}"]`).setChecked(!before.enhance[key]);
      }
      await page.locator('[data-reset-section="pages/speed"]').click();
      await until(() => page.evaluate(async () => { const s = await GZ_UI.load(), d = GZ_SANITIZE({}, true); return ['instant', 'prefetch', 'feedback'].every((k) => s.enhance[k] === d.enhance[k]); }));
      assert.deepEqual((await page.evaluate(() => GZ_UI.load())).tabs, before.tabs);
      assert.equal(await page.locator('[data-key="enhance.scores"]').evaluate((e) => e.closest('[data-editor-section]').dataset.editorSection), 'study/grades');
    });
    await check('motion demos save with native radio keys and stop when motion is off', async () => {
      await open('look/motion');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.locator('.motion-cards .lv-expressive').click();
      await until(() => page.locator('.motion-cards').evaluate((e) => e.getAnimations({ subtree: true }).some((a) => a.playState === 'running')));
      await page.locator('.motion-cards .lv-off').click();
      await until(() => page.evaluate(async () => (await GZ_UI.load()).motion.level === 'off'));
      assert.equal(await page.locator('.motion-cards .demo').count(), 3);
      assert.equal(await page.locator('.motion-cards').evaluate((e) => e.getAnimations({ subtree: true }).length), 0);
      await page.locator('[name="motion.level"][value="off"]').focus(); await page.keyboard.press('ArrowRight');
      await until(() => page.evaluate(async () => (await GZ_UI.load()).motion.level === 'subtle'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await page.locator('.motion-cards').evaluate((e) => e.getAnimations({ subtree: true }).length), 0);
    });
    await check('Writer sample follows paper settings and AI controls remain directly accessible', async () => {
      await open('writer/papers');
      await page.locator('[data-key="writer.format"]').selectOption('apa7');
      await page.locator('[data-key="writer.zoom"]').selectOption('150');
      await page.locator('[data-key="writer.ruler"]').check();
      await page.locator('[data-key="writer.lightPage"]').check();
      assert.equal(await page.locator('.sample-paper').getAttribute('data-format'), 'apa7');
      assert.equal(await page.locator('.sample-paper').getAttribute('data-light'), 'true');
      assert.equal(await page.locator('.sample-ruler').isVisible(), true);
      assert.equal(await page.locator('.sample-paper').evaluate((e) => e.style.getPropertyValue('--paper-zoom')), '1.5');
      await open('ai/setup');
      await page.evaluate(async () => { const { ai } = await chrome.storage.local.get('ai'); await chrome.storage.local.set({ ai: { ...ai, on: true, features: { ...ai.features, ask: true, completion: false } } }); });
      await until(() => page.locator('#ai-feature-ask').isChecked());
      assert.equal(await page.locator('#ai-feature-completion').isChecked(), false);
      assert.equal(await page.locator('#panel-ai .setting-demo').count(), 0);
      assert.equal(await page.locator('#ai-providers').isVisible(), true);
      assert.equal(await page.locator('.setting-demo:not(.paper-demo)').count(), 0);
    });
    await check('search indexes settings without decorative sample text', async () => {
      await open('writer/papers');
      const original = await page.locator('.sample-heading').textContent();
      try {
        await page.locator('.sample-heading').evaluate((e) => { e.textContent = 'decorativesampletoken'; });
        await page.locator('#find').fill('decorativesampletoken');
        assert.equal(await page.locator('#find-status').textContent(), 'No settings match');
        assert.equal(await page.locator('.paper-demo').isVisible(), false);
        await page.locator('#find').press('Escape');
        assert.equal(await page.locator('.paper-demo').isVisible(), true);
      } finally { await page.locator('.sample-heading').evaluate((e, text) => { e.textContent = text; }, original); }
    });
    await check('School and Setup are reachable without finding an advanced section', async () => {
      await page.locator('.settings-school').click();
      await until(() => page.evaluate(() => editor.route() === 'backup/sites' && !document.querySelector('#panel-backup').hidden));
      assert.equal(await page.locator('#site-address').isVisible(), true);
      assert.equal(await page.locator('#sites .related-settings a').count(), 3);
      const opened = context.waitForEvent('page'); await page.locator('.settings-setup').click();
      const wizard = await opened;
      await wizard.waitForURL('**/settings/welcome.html');
      await wizard.waitForFunction(() => document.querySelector('#looks .look'));
      await wizard.close();
    });
    await check('visual choices fit dark, light, narrow, RTL and larger text', async () => {
      const routes = ['look/palette', 'look/motion', 'study/widgets', 'writer/papers', 'ai/setup', 'pages/speed'];
      for (const theme of ['Frost', 'Library']) {
        await open('look/palette'); await page.locator(`#looks .look[data-look="${theme}"]`).click();
        for (const width of [1440, 768, 390, 320]) {
          await page.setViewportSize({ width, height: 1000 });
          for (const route of routes) {
            await open(route);
            const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
            assert.ok(geometry.scroll <= geometry.width, `${theme} ${width} ${route}: ${JSON.stringify(geometry)}`);
            if (width < 981 && await page.locator('.preview').isVisible()) {
              assert.equal(await page.locator('#preview-toggle').getAttribute('aria-expanded'), 'false');
              await page.locator('#preview-toggle').click();
              assert.equal(await page.locator('#preview-site').isVisible(), true);
              await page.keyboard.press('Escape');
              assert.equal(await page.locator('#preview-toggle').getAttribute('aria-expanded'), 'false');
            }
            if ([1440, 390].includes(width)) await page.screenshot({ path: path.join(out, `${theme}-${width}-${route.replace('/', '-')}.png`) });
          }
        }
      }
      await page.evaluate(() => { document.documentElement.dir = 'rtl'; document.documentElement.style.fontSize = '20px'; });
      await page.locator('.settings-school').click();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    });
    await page.screenshot({ path: path.join(out, 'settings.png') });
    await check('no page errors', async () => assert.deepEqual(errors, []));
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2));
    if (results.some((r) => !r.ok)) process.exitCode = 1;
  } finally { if (context) await context.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch((e) => { console.error(e.stack); process.exitCode = 1; });
