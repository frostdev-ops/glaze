// Real unpacked extension: background loader, native Stream mutations, closed-root keyboard focus and editor preview.
// NODE_PATH=<playwright node_modules> node scripts/stream-runtime-check.js [evidence-directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ext = require('./check-env.js').staged(path.join(__dirname, '..'), ['https://bb.school.test/*']), G = require(path.join(ext, 'defaults.js'));
const site = 'https://bb.school.test', out = process.argv[2], lock = require('./check-env.js').lockPath();
const fixture = `<!doctype html><html lang="en-US"><head><base href="https://cdn.school.test/ultra/"><style>body{font:16px system-ui;padding:24px}.element-card{padding:20px}.stream-item-container{margin-bottom:28px;list-style:none}</style></head><body><div id="site-wrap"><section class="js-base-stream-container route-view-container"><h1>Activity Stream</h1><div id="activity-stream" class="activity-stream"><div class="activity-group"><h2>Upcoming</h2><ul class="activity-feed"><li id="deadline" class="stream-item-container"><div class="stream-item"><div class="element-card"><div class="element-details" analytics-context='{"streamType":"GB:DUE"}'><div class="timestamp"><div><span class="date">Sep 16, 2026</span><span class="time">9:30 AM</span></div></div><div class="name">Due: Chapter 4 assignment</div><div class="content"><span class="due-date"><bb-translate translate-values='{"datetime":"10/25/26, 11:59 PM","timezone":"EDT"}'>Due Date: 10/25/26, 11:59 PM (EDT)</bb-translate></span></div></div></div></div></li></ul></div></div></section></div><div id="notification-settings"><form><div id="panel-stream"><h2>Stream Notifications</h2><label><input id="native" type="checkbox" checked>New grades</label></div></form></div></body></html>`;
let checks = 0;
const check = (ok, message) => { if (!ok) throw Error(message); checks++; console.log(`ok ${message}`); };
const findNode = (node, match) => match(node) ? node : [...(node.children || []), ...(node.shadowRoots || []), ...(node.contentDocument ? [node.contentDocument] : [])].map((n) => findNode(n, match)).find(Boolean);
(async () => {
  let context, tmp, held = false;
  const errors = [];
  try {
    fs.mkdirSync(lock); held = true; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stream-runtime-'));
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      headless: true, ...require('./check-env.js').chromeLaunch(), viewport: { width: 1400, height: 1000 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(12000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return r.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return r.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      return r.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['keys', 'palette'].includes(k)])) });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${site}/ultra/stream`);
    await page.waitForSelector('#gz-stream-settings');
    await page.waitForFunction(() => document.querySelector('#deadline .gz-stream-date .date')?.textContent === 'Due Oct 25');
    check(true, 'the actual content script and background loader start Stream without direct script injection');
    await page.evaluate(() => document.querySelector('#deadline [translate-values]').setAttribute('translate-values', '{"datetime":"10/28/26, 11:59 PM","timezone":"EDT"}'));
    await page.waitForFunction(() => document.querySelector('#deadline .gz-stream-date .date')?.textContent === 'Due Oct 28');
    check(true, 'the actual extension refreshes a metadata-only deadline change');
    const cdp = await context.newCDPSession(page);
    const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const host = findNode(doc.root, (n) => n.attributes?.includes('gz-stream-settings'));
    const select = findNode(host, (n) => n.nodeName === 'SELECT');
    await cdp.send('DOM.focus', { nodeId: select.nodeId });
    for (const key of ['g', 'c', '/', '?', 'Control+k']) await page.keyboard.press(key);
    await page.waitForTimeout(180);
    check(page.url() === `${site}/ultra/stream` && await page.locator('#gz-keys,#gz-cmd').count() === 0, 'shortcuts do not navigate or open tools while a closed-root control is focused');
    check(await page.evaluate(() => document.activeElement?.id === 'gz-stream-settings'), 'shortcut keys preserve focus inside Stream settings');
    const labels = await page.locator('#deadline .gz-stream-date').ariaSnapshot();
    check(labels.includes('11:59 PM (EDT)') && labels.includes('9:30 AM'), 'the real extension exposes full due and posted times in the accessibility tree');
    await worker.evaluate(async () => chrome.storage.sync.set({ stream: { dates: 'posted', relative: false, compact: false, encouragement: true } }));
    await page.waitForSelector('#deadline .gz-stream-date', { state: 'detached' });
    check(await page.locator('#deadline .timestamp > div').isVisible(), 'real storage notifications switch back to native posted dates');
    await worker.evaluate(async () => chrome.storage.sync.set({ enabled: false }));
    await page.waitForSelector('#gz-stream-settings', { state: 'detached' });
    check(true, 'turning Glaze off tears down the actual Stream feature');
    // The settings section must select a real Stream preview and immediately reflect all four preferences.
    await worker.evaluate(async () => chrome.storage.sync.set({ enabled: true, stream: { dates: 'smart', relative: false, compact: false, encouragement: true } }));
    const options = await context.newPage(); options.on('pageerror', (e) => errors.push(e.message));
    await options.goto(`chrome-extension://${id}/options.html#blackboard/stream`);
    await options.waitForFunction(() => document.getElementById('preview')?.contentDocument?.documentElement.dataset.previewReady === 'true');
    await options.locator('#enabled').check();
    const preview = options.frames().find((f) => f.url().includes('/preview.html') && !f.url().includes('backdrop'));
    await preview.waitForFunction(() => document.documentElement.dataset.previewPage === 'stream');
    check(await options.locator('#preview-page').inputValue() === 'stream' && await preview.locator('[data-preview-view=stream]').isVisible(), 'Glaze settings open the Activity Stream preview');
    await preview.waitForSelector('.gz-stream-date');
    check(true, 'an enabled cold-start Stream settings link activates the preview without a cached load failure');
    await options.locator('[data-key="stream.dates"]').selectOption('smart');
    await preview.waitForSelector('.gz-stream-date');
    const absolute = await preview.locator('.gz-stream-date .date').first().textContent();
    await options.locator('[data-key="stream.relative"]').check();
    await preview.waitForFunction((before) => document.querySelector('.gz-stream-date .date')?.textContent !== before, absolute);
    check(true, 'relative due dates update the live preview');
    await options.locator('[data-key="stream.dates"]').selectOption('both');
    await preview.waitForSelector('.gz-stream-posted:not([hidden])');
    check(true, 'the preview shows due and posted dates together');
    await options.locator('[data-key="stream.compact"]').check();
    await preview.waitForFunction(() => document.documentElement.hasAttribute('data-gz-stream-compact'));
    check(true, 'compact cards update the live preview');
    await options.locator('[data-key="stream.encouragement"]').uncheck();
    await preview.waitForSelector('[data-gz-stream-hidden]', { state: 'attached' });
    check(await preview.locator('[data-gz-stream-hidden]').isHidden(), 'encouragement visibility updates the live preview');
    await options.locator('[data-key="stream.dates"]').selectOption('posted');
    await preview.waitForSelector('.gz-stream-date', { state: 'detached' });
    check(await options.locator('[data-key="stream.relative"]').isDisabled(), 'posted mode disables relative dates in Glaze settings');
    if (out) { fs.mkdirSync(out, { recursive: true }); await options.screenshot({ path: path.join(out, 'stream-settings-preview.png') }); }
    check(errors.length === 0, `runtime and preview report no page errors (${errors.join('; ')})`);
    console.log(`${checks} Stream runtime checks passed`);
  } finally {
    try { if (context) await context.close(); } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); if (held) fs.rmdirSync(lock); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
