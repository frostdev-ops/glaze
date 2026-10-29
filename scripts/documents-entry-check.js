// The ways to Writer's Documents page (papers.html) against the unpacked extension, offline: the popup's header pill (right
// of "Glaze", its one word, the popup still inside Chrome's 600px, gone with Writer off, kept with the theme off, a real
// click only; tabs.create stubbed, then real), Settings → Writer → Papers' link, Settings → Navigation's opt-in item,
// Glaze's bar with it on (Settings' preview, and a Canvas page through the worker) and Canvas's command palette. Shots: the
// popup at its natural size and the papers heading, each in a dark and a light Look, and the Glaze items.
// NODE_PATH=<playwright> nice -n 10 node scripts/documents-entry-check.js [shots folder] (default: a temporary folder).
// EXT selects the checkout.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const D = require(path.join(root, 'defaults.js'));
const CANVAS = 'https://canvas.school.test';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const fixture = (f) => fs.readFileSync(path.join(root, 'test/fixtures', f), 'utf8');
let total = 0, failed = 0;
const check = async (name, test) => {
  total++;
  try { await test(); console.log(`ok ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
};

(async () => {
  const lock = require('./check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-documents-entry-'));
  const shots = path.resolve(process.argv[2] || path.join(scratch, 'shots'));
  fs.mkdirSync(shots, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\ndocuments-entry-check\n`);
    const ext = require('./check-env.js').staged(root, [`${CANVAS}/*`], scratch);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    require('./check-env.js').noFirstRun(context);
    context.setDefaultTimeout(10000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin === CANVAS && u.pathname === '/api/v1/users/self') return r.fulfill({ json: { id: '1', name: 'Alex Example', time_zone: 'America/New_York' } });
      if (u.origin === CANVAS && u.pathname.startsWith('/api/')) return r.fulfill({ json: [] });
      if (u.origin === CANVAS && u.pathname.startsWith('/courses')) return r.fulfill({ contentType: 'text/html', body: fixture('canvas-course-home.html') });
      return r.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const PAPERS = `${base}/papers.html`;
    const errors = [];
    const watch = (p, name) => p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    const store = (patch) => worker.evaluate(async (p) => { await chrome.storage.sync.clear(); await chrome.storage.sync.set(p); }, patch);
    // A tab of its own at papers.html, from what act does; closed after.
    const opensPapers = async (act) => {
      const before = new Set(context.pages());
      await act();
      const tab = await until(() => context.pages().find((p) => !before.has(p) && p.url().split(/[?#]/)[0] === PAPERS), 'papers.html in a new tab');
      await tab.close();
    };
    const dark = D.GZ_SANITIZE({});
    const light = D.GZ_SANITIZE({ ...D.GZ_DEFAULTS, ...D.GZ_LOOK_APPLY(D.GZ_DEFAULTS, D.GZ_LOOKS.find((L) => L.name === 'Library')) });

    // ---- the popup, as a page 360px wide (its body's width); popup.html?real keeps the browser's tabs.create
    const popup = await context.newPage();
    watch(popup, 'popup');
    await popup.addInitScript(() => {
      if (location.pathname !== '/popup.html' || location.search === '?real') return;
      globalThis.__created = [];
      chrome.tabs.create = (o) => { globalThis.__created.push(o); return Promise.resolve({ id: 1 }); };
    });
    const openPopup = async (query = '') => {
      await popup.setViewportSize({ width: 360, height: 900 });
      await popup.goto(`${base}/popup.html${query}`);
      await until(() => popup.evaluate(() => !!document.querySelector('#look-name').textContent && !!document.querySelector('#motion-name').textContent), 'popup drawn');
      await pause(250);
    };
    const pill = () => popup.getByRole('button', { name: 'Documents', exact: true });
    // The popup's natural height: its body's, as the browser sizes the popup to it.
    const natural = () => popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height));

    await store(dark);
    await openPopup();
    await check('popup-pill', async () => {
      assert.equal(await pill().count(), 1, 'one Documents button');
      assert.equal(await pill().evaluate((e) => e.parentElement.matches('header.top') && e.previousElementSibling?.textContent), 'Glaze', 'in the header, after its name');
      const [b, h, top] = [await pill().boundingBox(), await popup.locator('header.top h1').boundingBox(), await popup.locator('header.top').boundingBox()];
      assert.ok(b.x > h.x + h.width && Math.abs(b.x + b.width - (top.x + top.width)) < 0.5, `right of "Glaze", at the header's end (${JSON.stringify([b, h, top])})`);
      assert.equal((await pill().innerText()).trim(), 'Documents', 'its one word');
      assert.equal(await pill().locator('small').count(), 0, 'no line under it');
      await pill().evaluate((e) => e.click());
      assert.deepEqual(await popup.evaluate(() => globalThis.__created), [], 'a scripted click opens nothing');
      await pill().click();
      assert.deepEqual(await popup.evaluate(() => globalThis.__created), [{ url: PAPERS }]);
    });
    await check('popup-fits', async () => {
      assert.ok(await pill().isVisible(), 'with the pill');
      const h = await natural();
      console.log(`popup height with the pill: ${h}px`);
      assert.ok(h <= 600, `inside Chrome's 600px popup (${h}px)`);
    });
    for (const [name, s] of [['dark', dark], ['light', light]]) {
      await store(s);
      await openPopup();
      const h = await natural();
      console.log(`${name} popup: 360 × ${h}px`);
      await popup.setViewportSize({ width: 360, height: h });
      await pause(200);
      await popup.screenshot({ path: path.join(shots, `entry-popup-${name}.png`) });
    }
    await check('popup-theme-off', async () => {
      await store({ ...dark, enabled: false });
      await openPopup();
      assert.equal(await pill().evaluate((e) => e.inert || !!e.closest('[inert]')), false, 'not inert with the theme off');
      assert.equal(await pill().evaluate((e) => getComputedStyle(e).opacity), '1');
      await pill().click();
      assert.deepEqual(await popup.evaluate(() => globalThis.__created), [{ url: PAPERS }]);
    });
    await check('popup-writer-off', async () => {
      await store(D.GZ_SANITIZE({ enhance: { writer: false } }));
      await openPopup();
      assert.equal(await pill().count(), 0, 'no Documents button');
      assert.equal(await popup.locator('#documents').isVisible(), false);
      console.log(`popup height without the pill: ${await natural()}px`);
    });
    await check('popup-real-tab', async () => {
      await store(dark);
      await openPopup('?real');
      await opensPapers(() => pill().click());
    });
    await check('popup-keyboard', async () => {
      await openPopup();
      await popup.keyboard.press('Tab');
      assert.equal(await pill().evaluate((e) => e === document.activeElement && e.matches(':focus-visible') && getComputedStyle(e).outlineStyle === 'solid' && parseFloat(getComputedStyle(e).outlineWidth) >= 2), true, 'first Tab reaches the named pill with a focus ring');
      await popup.keyboard.press('Enter');
      assert.deepEqual(await popup.evaluate(() => globalThis.__created), [{ url: PAPERS }], 'Enter opens it once');
    });

    // ---- Settings → Writer → Papers
    const opts = await context.newPage();
    watch(opts, 'options');
    await opts.setViewportSize({ width: 1280, height: 1400 });
    await check('settings-link', async () => {
      await opts.goto(`${base}/options.html#writer/papers`);
      await opts.locator('#writer-papers').waitFor({ state: 'visible' });
      const link = opts.locator('#writer-papers').getByRole('link', { name: 'Documents', exact: true });
      assert.equal(await link.count(), 1);
      assert.deepEqual(await link.evaluate((a) => [a.href, a.target, a.rel, a.className, a.closest('.wr-sub')?.querySelector('h3')?.textContent]), [PAPERS, '_blank', 'noopener', 'button', 'Saved papers']);
      await opensPapers(() => link.click());
      await opts.keyboard.press('Tab');
      await link.focus();
      assert.equal(await link.evaluate((e) => e.tabIndex === 0 && e === document.activeElement && e.matches(':focus-visible') && getComputedStyle(e).outlineStyle === 'solid' && parseFloat(getComputedStyle(e).outlineWidth) >= 2), true, 'the named link has keyboard focus and a focus ring');
      await opensPapers(() => link.press('Enter'));
    });
    for (const [name, s] of [['dark', dark], ['light', light]]) {
      await store(s);
      await opts.goto('about:blank');
      await opts.goto(`${base}/options.html#writer/papers`);
      await opts.locator('#writer-papers').waitFor({ state: 'visible' });
      await pause(400);
      await opts.locator('#writer-papers .wr-sub').first().screenshot({ path: path.join(shots, `entry-settings-${name}.png`) });
    }

    // ---- Settings → Navigation's Glaze items: Documents opt-in, off by default
    await check('settings-navigation-item', async () => {
      await store(dark);
      await opts.goto('about:blank');
      await opts.goto(`${base}/options.html#navigation/items`);
      const box = opts.locator('#nbar-glaze label').filter({ hasText: /^Documents$/ }).locator('input[type="checkbox"]');
      await box.waitFor();
      assert.equal(await box.isChecked(), false, 'off until turned on');
      await box.click();
      await until(async () => (await worker.evaluate(() => chrome.storage.sync.get('navbarItems'))).navbarItems?.glaze?.includes('documents'), 'saved on');
      await opts.locator('#nbar-glaze').screenshot({ path: path.join(shots, 'entry-navigation-items.png') });
    });

    // ---- Glaze's bar in Settings' preview (an extension page: the worker takes 'papers' from Glaze's own pages)
    await check('preview-bar-item', async () => {
      const prev = await context.newPage();
      watch(prev, 'preview');
      await prev.goto(`${base}/preview.html?site=canvas`);
      const item = prev.locator('#gz-navbar [data-id="glaze:documents"]').first();
      await item.waitFor({ state: 'visible' });
      assert.equal((await item.getAttribute('aria-label')) || (await item.innerText()).trim(), 'Documents');
      await opensPapers(() => item.click());
      await prev.close();
    });

    await check('bar-icon-looks-and-sizes', async () => {
      const prev = await context.newPage();
      watch(prev, 'preview layouts');
      try {
        for (const L of D.GZ_LOOKS) {
          for (const [mode, width, navbar] of [['rail', 1440, { rail: 'open' }], ['icons', 1024, { rail: 'icons' }], ['top', 1280, { place: 'top' }], ['phone', 390, {}]]) {
            const s = D.GZ_SANITIZE({ ...D.GZ_DEFAULTS, ...D.GZ_LOOK_APPLY(D.GZ_DEFAULTS, L) });
            await store({ ...s, navbar: { ...s.navbar, ...navbar }, navbarItems: { glaze: ['documents'], tabs: ['glaze:documents'] } });
            await prev.setViewportSize({ width, height: 900 });
            await prev.goto(`${base}/preview.html?site=canvas`);
            const item = prev.locator('#gz-navbar [data-id="glaze:documents"]:visible').first();
            await item.waitFor();
            const svg = item.locator('svg');
            const b = await svg.boundingBox();
            assert.ok(b?.width > 0 && b?.height > 0, `${L.name} ${mode}: icon has room`);
            assert.equal(await svg.locator('path').getAttribute('d'), require('../lib/navbar.js').ICONS.documents, `${L.name} ${mode}: Documents drawing`);
            assert.equal(await svg.evaluate((e) => getComputedStyle(e).stroke), await item.evaluate((e) => getComputedStyle(e).color), `${L.name} ${mode}: inherits the item's ink`);
          }
        }
        console.log(`${D.GZ_LOOKS.length} Looks × 4 bar layouts checked`);
      } finally { await prev.close(); }
      await store({ ...dark, navbarItems: { glaze: ['documents'] } });
    });

    // ---- a Canvas page: the bar's item and the command palette, each through the worker
    await worker.evaluate((site) => chrome.storage.local.set({ canvas: [site] }), `${CANVAS}/*`);
    await until(() => worker.evaluate(async (host) => (await chrome.scripting.getRegisteredContentScripts()).some((s) => s.matches?.some((m) => m.includes(host))), CANVAS), 'Canvas scripts registered', 15000);
    const lms = await context.newPage();
    watch(lms, 'canvas');
    await lms.goto(`${CANVAS}/courses/25`);
    await until(() => lms.evaluate(() => document.documentElement.hasAttribute('data-gz-bg')), 'Glaze on the Canvas page', 15000);
    await check('canvas-bar-item', async () => {
      const item = lms.locator('#gz-navbar [data-id="glaze:documents"]').first();
      await item.waitFor({ state: 'visible' });
      await opensPapers(() => item.click());
    });
    await check('canvas-palette', async () => {
      await lms.locator('body').click({ position: { x: 640, y: 600 } }).catch(() => {});
      await lms.keyboard.press('ControlOrMeta+k');
      await lms.locator('#gz-cmd input').fill('Documents');
      const row = lms.locator('#gz-cmd-list li').filter({ hasText: /^DocumentsGlaze$/ });
      await row.waitFor();
      assert.ok(!await lms.locator('#gz-cmd-list li').filter({ hasText: /^Papers/ }).count(), 'not under its old name');
      await opensPapers(() => row.click());
    });
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await context?.close().catch(() => {});
    fs.rmSync(path.join(scratch, 'profile'), { recursive: true, force: true });
    if (!process.argv[2]) console.log(`shots: ${shots}`); else fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} Documents entry browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
