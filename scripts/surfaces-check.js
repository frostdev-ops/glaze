// Real unpacked extension, synthetic preview only. All external requests are blocked.
// EXT=/path/to/checkout NODE_PATH=/path/to/playwright node scripts/surfaces-check.js /path/to/receipts
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const ext = process.env.EXT || path.resolve(__dirname, '..'), G = require(path.join(ext, 'defaults.js'));
const output = process.argv[2]; if (!output) throw Error('Choose a receipt folder.');
const chromePath = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const until = async (fn, check) => { const end = Date.now() + 10000; while (Date.now() < end) { const value = await fn(); if (check(value)) return value; await new Promise((r) => setTimeout(r, 30)); } throw Error('Preview did not settle.'); };
(async () => {
  fs.mkdirSync(output, { recursive: true }); const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-surfaces-'));
  let context; const results = [], errors = [], external = [];
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(scratch, { executablePath: chromePath, headless: true, viewport: { width: 1280, height: 850 }, locale: 'en-US', reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-webgl', '--host-resolver-rules=MAP * ~NOTFOUND'] });
    await context.route('**/*', (route) => { if (route.request().url().startsWith('chrome-extension:')) return route.continue(); external.push(route.request().url()); return route.abort(); });
    for (const site of ['ultra', 'canvas', 'moodle']) {
      const page = await context.newPage(); page.on('pageerror', (e) => errors.push(`${site}: ${e}`));
      await page.goto(`chrome-extension://${id}/preview.html?site=${site}`);
      await until(() => page.evaluate(() => document.documentElement.dataset.previewSite), (x) => x === site);
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      for (const look of G.GZ_LOOKS) for (const mode of ['light', 'dark']) for (const view of ['outline', 'dashboard']) {
        const settings = G.GZ_SANITIZE({ ...G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, look), colors: G.GZ_PRESET(mode === 'light' ? 'Paper' : 'Frost'), motion: { level: 'off' }, enhance: { widgets: true, notes: true, todo: true } });
        await page.evaluate(({ settings, site, view }) => {
          window.postMessage({ gzPreview: settings }, location.origin);
          window.postMessage({ gzPreviewContext: { site, page: view, viewport: 'desktop' } }, location.origin);
        }, { settings, site, view });
        await until(() => page.evaluate(() => ({ radius: document.documentElement.style.getPropertyValue('--gz-radius'), view: document.documentElement.dataset.previewPage, ink: document.documentElement.style.getPropertyValue('--gz-ink') })), (v) => v.radius === `${settings.look.radius}px` && v.view === view && v.ink === settings.colors['--gz-ink']);
        await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(80);
        const name = `${site}-${look.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${mode}-${view}`;
        const surfaces = await page.evaluate(() => [...document.querySelectorAll('.element-card,.MuiPaper-root,.content-list-item .itemContainer,.outline-action-block,.ig-row,.ic-DashboardCard,.card,.gz-w')].filter((e) => e.getClientRects().length).map((e) => { const s = getComputedStyle(e); return { tag: e.tagName, class: e.className, fill: s.backgroundColor, image: s.backgroundImage, radius: s.borderRadius, shadow: s.boxShadow, blur: s.backdropFilter }; }));
        await page.screenshot({ path: path.join(output, `${name}.png`) }); results.push({ name, surfaces });
      }
      await page.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ source: ext, results, errors, external: [...new Set(external)] }, null, 2));
    if (errors.length) throw Error(errors.join('\n'));
    console.log(`${results.length} static Look/site/mode/page receipts; no page errors.`);
  } finally { await context?.close(); fs.rmSync(scratch, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
