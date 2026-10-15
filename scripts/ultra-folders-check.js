// B9: actual extension, synthetic Ultra only; all external requests are blocked. Run headless with Playwright.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const D = require('../defaults.js');
const ext = process.env.EXT || path.join(__dirname, '..');
const out = process.argv[2] || path.join(ext, 'scratch/b9/shots');
const fixture = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-folders.html'), 'utf8');
const chromePath = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-b9-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), { executablePath: chromePath, headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', hasTouch: true, isMobile: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--renderer-process-limit=1'] });
    context.setDefaultTimeout(8000);
    let requests = 0;
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.hostname === 'bb.school.test' && /^\/ultra\/courses\//.test(u.pathname)) return r.fulfill({ contentType: 'text/html', body: fixture });
      requests++;
      if (u.hostname === 'bb.school.test' && u.pathname === '/learn/api/v1/users/me') return r.fulfill({ contentType: 'application/json', body: '{"id":"_900_1"}' });
      if (u.hostname === 'bb.school.test' && u.pathname.includes('/memberships')) return r.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      return r.abort();
    });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    const settings = { ...D.GZ_DEFAULTS, enhance: Object.fromEntries(Object.keys(D.GZ_DEFAULTS.enhance).map((k) => [k, k === 'hideFolders'])) };
    await opts.evaluate(async (s) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(s); }, settings);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('https://bb.school.test/ultra/courses/_800_1/outline');
    await page.waitForFunction(() => document.querySelectorAll('.gz-folder-eye:not(:disabled)').length === 3);
    assert.equal(await page.locator('.gz-folder-eye').count(), 3);
    assert.deepEqual(await page.locator('.gz-folder-eye').evaluateAll((es) => es.map((e) => getComputedStyle(e).opacity)), ['1', '1', '1'], 'all touch controls are always visible');
    await page.waitForTimeout(400);
    const requestBefore = requests;
    const eye = (title) => page.getByRole('button', { name: title, exact: true });
    await eye('Hide folder: Optional reading').focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('[data-content-id="_102_1"]').getAttribute('data-gz-folder-hidden') === 'hide');
    await eye('Hide folder: Week one: getting started').focus(); await page.keyboard.press('Space');
    await eye('Show hidden folders (2)').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-gz-folder-hidden="show"]').length === 2);
    assert.equal(await page.evaluate(() => window.rowClicks), 0, 'hide and toggle never reach native row clicks');
    await eye('Unhide folder: Week one: getting started').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-gz-folder-hidden="show"]').length === 1);
    assert.equal(await page.locator('[data-gz-folder-hidden="show"]').count(), 1, 'child remains independently hidden');
    // Ultra replaces native markup when a folder is unfolded, with no Glaze attributes or listeners.
    await page.evaluate(() => {
      const row = document.querySelector('[data-content-id="_102_1"]'), next = row.cloneNode(true);
      next.querySelector('.gz-folder-eye').remove(); next.removeAttribute('data-gz-folder-hidden'); row.replaceWith(next);
    });
    await page.waitForFunction(() => document.querySelector('[data-content-id="_102_1"]').getAttribute('data-gz-folder-hidden') === 'show');
    await eye('Show hidden folders (1)').click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-content-id="_102_1"]')).display === 'none');
    assert.equal(requests, requestBefore, 'visibility operations issue no requests');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-content-id="_102_1"]').getAttribute('data-gz-folder-hidden') === 'hide');
    await eye('Show hidden folders (1)').click();
    // Keep hidden rows dimmed for the four review screenshots.
    for (const width of [1280, 375]) for (const preset of ['Paper', 'Frost']) {
      const entry = D.GZ_PRESETS.find(([n]) => n === preset) || D.GZ_PRESETS[width === 1280 ? 0 : 1];
      await opts.evaluate(async ({ colors, preset }) => chrome.storage.sync.set({ colors, preset }), { colors: entry[1], preset: entry[0] });
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(250);
      await page.locator('.gz-folder-eye').first().focus();
      assert.equal(await page.locator('.gz-folder-eye').first().evaluate((e) => getComputedStyle(e).opacity), '1');
      await page.screenshot({ path: path.join(out, `${preset.toLowerCase()}-${width}.png`), fullPage: true });
    }
    // Shared worker operations merge with another tab's edits; storage events update both tabs.
    const other = await context.newPage(); await other.goto(page.url());
    await other.waitForFunction(() => document.querySelectorAll('.gz-folder-eye:not(:disabled)').length === 3);
    await other.getByRole('button', { name: 'Hide folder: Week two: learning module', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#gz-folders-toggle').textContent === 'Show hidden folders (2)');
    await eye('Unhide folder: Optional reading').click();
    await other.waitForFunction(() => document.querySelector('#gz-folders-toggle').textContent === 'Show hidden folders (1)');
    // Settings/master/site switches restore the original rows and remove controls.
    for (const patch of [{ enhance: { ...settings.enhance, hideFolders: false } }, { enabled: false }]) {
      await opts.evaluate(async (p) => chrome.storage.sync.set(p), patch);
      await page.waitForFunction(() => !document.querySelector('.gz-folder-eye, [data-gz-folder-hidden], #gz-folders-toggle'));
      await opts.evaluate(async (s) => chrome.storage.sync.set(s), settings);
      await page.waitForFunction(() => document.querySelector('.gz-folder-eye:not(:disabled)'));
    }
    assert.deepEqual(errors, []);
    // A fresh identity cache from course recording has no account ID of its own: B9 must stay absent.
    await opts.evaluate(async () => chrome.storage.local.set({ seenCoursesAt: Date.now() }));
    await page.reload();
    await page.waitForTimeout(650);
    assert.equal(await page.locator('.gz-folder-eye, [data-gz-folder-hidden]').count(), 0, 'unknown user never sees another account record');
    const unknownAt = requests;
    await page.waitForTimeout(200);
    assert.equal(requests, unknownAt, 'unknown identity never triggers a profile request');
    await other.close();
    const results = { ok: true, controls: 3, screenshots: 4, touch: true, requestBefore, requests, errors };
    fs.writeFileSync(path.join(out, 'assertions.json'), JSON.stringify(results, null, 2) + '\n');
    console.log(JSON.stringify(results));
  } finally { if (context) await context.close(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
