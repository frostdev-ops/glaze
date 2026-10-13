// Capture the store screenshots (1280x800) from the packaged extension and its sample course, and
// render the promo tiles from store/promo.html. Runs the real extension in a throwaway Chromium
// profile; no Blackboard account or real coursework. Animated backgrounds hold still (reduced motion).
//   NODE_PATH=/path/to/node_modules node scripts/store-screenshots.js     (needs playwright + its chromium)
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'assets/store/screenshots');
const version = require('../manifest.json').version;
const size = { width: 1280, height: 800 };
// The sample assignment is due 10/18/26; a fixed clock keeps its countdown the same in every capture.
const clock = new Date('2026-10-11T12:00:00-04:00');

const enhance = { urgency: true, inline: true, scores: true, progress: true };
const lagoon = ['#22d3ee', '#6366f1', '#34d399'];
const dusk = ['#f472b6', '#a78bfa', '#fb923c'];
const shots = [
  ['1-course-frost', 'preview.html', { preset: 'Frost', enhance }],
  ['2-backgrounds-editor', 'options.html#background', { preset: 'Frost', bg: { kind: 'gradient', style: 'mesh', colors: lagoon, dim: 45 }, enhance }],
  ['3-extras-paper', 'options.html#extras', { preset: 'Paper', look: { font: 'atkinson' }, enhance }],
  ['4-horizon-midnight', 'preview.html', { preset: 'Midnight', bg: { kind: 'scene', scene: 'horizon', colors: dusk, intensity: 80 }, look: { glass: 16 }, enhance }],
  ['5-popup-ember', 'popup', { preset: 'Ember', bg: { kind: 'gradient', angle: 160 }, enhance }],
];
const promos = [['marquee', { width: 1400, height: 560 }], ['small-tile', { width: 440, height: 280 }]];

// Chromium names an unpacked extension after its folder: the path's SHA-256, hex digits mapped to a-p.
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

(async () => {
  execFileSync('./package.sh', { cwd: root, stdio: 'inherit' });
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-shots-')));
  const ext = path.join(tmp, 'ext');
  execFileSync('unzip', ['-q', path.join(root, `dist/glaze-v${version}.zip`), '-d', ext]);
  const base = `chrome-extension://${extensionId(ext)}`;

  const context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
    channel: 'chromium', headless: true, viewport: size, deviceScaleFactor: 1,
    colorScheme: 'dark', reducedMotion: 'reduce',
    // SwiftShader: WebGL for the animated backgrounds in headless mode.
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await context.clock.setFixedTime(clock);
  const page = context.pages()[0] || await context.newPage();
  fs.mkdirSync(out, { recursive: true });

  // Saved settings are the real extension storage, written through the extension's own sanitizer.
  const apply = (opts) => page.evaluate(async ({ preset, ...rest }) => {
    const colors = { ...GZ_PRESETS.find(([name]) => name === preset)[1] };
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(GZ_SANITIZE({ ...rest, preset, colors }));
  }, opts);
  // Long enough for three.js to load and draw when a scene is on.
  const settle = () => page.evaluate(() => document.fonts.ready).then(() => page.waitForTimeout(1500));

  for (const [name, target, opts] of shots) {
    await page.goto(`${base}/options.html`);
    await apply(opts);
    const file = path.join(out, `${name}.jpg`);
    if (target === 'popup') {
      // The popup is a 320px page; show it over a themed course, where Chrome would open it.
      await page.goto(`${base}/preview.html`);
      await settle();
      const course = path.join(tmp, 'course.png');
      await page.screenshot({ path: course });
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`${base}/popup.html`);
      await settle();
      const popup = path.join(tmp, 'popup.png');
      await page.locator('body').screenshot({ path: popup });
      await page.setViewportSize(size);
      fs.writeFileSync(path.join(tmp, 'frame.html'), `<!doctype html><body style="margin:0;position:relative">
        <img src="course.png" style="display:block">
        <img src="popup.png" style="position:absolute;top:12px;right:16px;border-radius:12px;
          box-shadow:0 18px 48px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.08)">`);
      await page.goto(`file://${path.join(tmp, 'frame.html')}`);
      await page.waitForTimeout(200);
    } else {
      await page.goto(`${base}/${target}`);
      await settle();
    }
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    console.log(`wrote ${path.relative(root, file)}`);
  }

  // Promo tiles: store/promo.html, served from the repo under a throwaway https origin so its module
  // import works.
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  await page.route('https://promo.test/**', (r) => {
    const file = path.join(root, new URL(r.request().url()).pathname);
    r.fulfill({ status: 200, contentType: types[path.extname(file)], body: fs.readFileSync(file) });
  });
  for (const [name, box] of promos) {
    await page.setViewportSize(box);
    await page.goto(`https://promo.test/store/promo.html?size=${name === 'marquee' ? 'marquee' : 'tile'}`);
    await page.waitForSelector('body[data-ready]');
    await page.waitForTimeout(500);
    const file = path.join(root, `assets/store/${name}.png`);
    await page.screenshot({ path: file });
    console.log(`wrote ${path.relative(root, file)}`);
  }
  await context.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
