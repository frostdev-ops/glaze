// Store artwork from the current extension, its real settings and invented preview courses.
// No LMS account, outside requests or installed browser profile. The optional output directory
// lets the Linux runner collect everything: glaze-remote -o <evidence> -- node tools/release/store-screenshots.js /out
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../dev/check-env.js');
const root = path.join(__dirname, '../..'), extension = path.join(root, 'extension');
const art = path.resolve(process.argv[2] || path.join(root, 'store/art'));
const out = path.join(art, 'screenshots');
const shots = [
  ['1-settings-look', 'options.html#look/palette'],
  ['2-blackboard-course', 'preview.html'],
  ['3-canvas-course', 'preview.html?site=canvas'],
  ['4-writer-paper', 'options.html#writer/papers'],
  ['5-backgrounds', 'options.html#look/background'],
];
const promos = [['marquee', 1400, 560], ['small-tile', 440, 280]];
let context;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-store-art-'));

(async () => {
  try {
    fs.mkdirSync(out, { recursive: true });
    await require('../dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1,
      colorScheme: 'dark', reducedMotion: 'reduce', locale: 'en-US',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND'],
    });
    await context.route('**/*', route => new URL(route.request().url()).protocol === 'chrome-extension:' ? route.continue() : route.abort());
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-10-11T12:00:00-04:00'));
    await page.goto(`${base}/options.html#look/palette`);
    await page.waitForFunction(() => document.querySelector('#looks button'));
    await env.installed(page);
    for (const other of context.pages()) if (other !== page) await other.close();
    await page.evaluate(async () => {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(GZ_SANITIZE(GZ_DEFAULTS));
    });
    const results = [];
    for (const [name, target] of shots) {
      if (name === '5-backgrounds') await page.evaluate(async () => {
        const s = await GZ_UI.load();
        await chrome.storage.sync.set(GZ_SANITIZE({ ...s, bg: { kind: 'gradient', style: 'mesh', colors: ['#22d3ee', '#6366f1', '#34d399'], dim: 45 } }));
      });
      await page.goto(`${base}/${target}`);
      if (target.startsWith('preview')) await page.waitForFunction(() => document.documentElement.dataset.previewReady === 'true');
      else await page.waitForFunction(route => editor.route() === route, target.split('#')[1]);
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(out, name + '.jpg');
      await page.screenshot({ path: file, type: 'jpeg', quality: 94 });
      results.push({ file: path.relative(art, file), width: 1280, height: 800, page: target });
      console.log(`wrote ${file}`);
    }

    // The synthetic origin serves only repository files and the just-captured product image.
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
    await context.route('https://promo.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      const file = name.startsWith('/store/art/') ? path.join(art, name.slice('/store/art/'.length)) : path.join(root, name);
      return route.fulfill({ status: 200, contentType: types[path.extname(file)], body: fs.readFileSync(file) });
    });
    for (const [name, width, height] of promos) {
      await page.setViewportSize({ width, height });
      await page.goto(`https://promo.test/store/promo.html?size=${name === 'marquee' ? 'marquee' : 'tile'}`);
      await page.waitForSelector('body[data-ready]');
      const copy = await page.locator('.copy').innerText();
      assert.doesNotMatch(copy, /\b(free|forever|premium|recommended|new)\b|#1/i);
      assert.equal(await page.locator('h1').innerText(), 'Glaze');
      assert.ok(await page.locator('.copy').evaluate(el => { const r = el.getBoundingClientRect(); return r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), 'promo copy fits its canvas');
      const file = path.join(art, name + '.png');
      await page.screenshot({ path: file });
      results.push({ file: path.relative(art, file), width, height, copy });
      console.log(`wrote ${file}`);
    }
    fs.copyFileSync(path.join(extension, 'icons/icon128.png'), path.join(art, 'icon128.png'));
    fs.writeFileSync(path.join(art, 'capture.json'), JSON.stringify({ version: require('../../extension/manifest.json').version, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), results }, null, 2) + '\n');
  } finally {
    await context?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
