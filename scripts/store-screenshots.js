// Capture the store screenshots (1280x800) from the packaged extension and its sample course, and
// render the promo tiles from store/promo.html. Runs the real extension in a throwaway Chromium
// profile; no Blackboard account or real coursework. Animated backgrounds hold still (reduced motion).
//   NODE_PATH=/path/to/node_modules node scripts/store-screenshots.js     (needs playwright + its chromium)
//   CHROME=/path/to/chrome runs that browser instead (a Chrome for Testing build, say).
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
const shots = [
  ['1-blackboard-frost', 'preview.html', { preset: 'Frost', enhance }],
  ['4-halloween-pumpkin-patch', 'preview.html', { lookName: 'Pumpkin Patch', enhance }],
  ['5-backgrounds-editor', 'options.html#background', { preset: 'Frost', bg: { kind: 'gradient', style: 'mesh', colors: lagoon, dim: 45 }, enhance }],
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
    ...(process.env.CHROME ? { executablePath: process.env.CHROME } : { channel: 'chromium' }), headless: true, viewport: size, deviceScaleFactor: 1,
    colorScheme: 'dark', reducedMotion: 'reduce',
    // SwiftShader: WebGL for the animated backgrounds in headless mode.
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  await context.clock.setFixedTime(clock);
  const page = context.pages()[0] || await context.newPage();
  fs.mkdirSync(out, { recursive: true });

  // Saved settings are the real extension storage, written through the extension's own sanitizer.
  const apply = (opts) => page.evaluate(async ({ preset, lookName, ...rest }) => {
    const theme = lookName ? GZ_LOOK_APPLY(GZ_DEFAULTS, GZ_LOOKS.find((look) => look.name === lookName))
      : { preset, colors: { ...GZ_PRESETS.find(([name]) => name === preset)[1] } };
    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(GZ_SANITIZE({ ...theme, ...rest }));
  }, opts);
  // Long enough for three.js to load and draw when a scene is on.
  const settle = () => page.evaluate(() => document.fonts.ready).then(() => page.waitForTimeout(1500));

  for (const [name, target, opts] of shots) {
    await page.goto(`${base}/options.html`);
    await apply(opts);
    const file = path.join(out, `${name}.jpg`);
    await page.goto(`${base}/${target}`);
    await settle();
    await page.screenshot({ path: file, type: 'jpeg', quality: 92 });
    console.log(`wrote ${path.relative(root, file)}`);
  }

  // The same local Canvas seed and real extension as the Canvas QA harness; fake student only.
  const canvas = path.join(tmp, 'canvas');
  execFileSync(process.execPath, [path.join(__dirname, 'canvas-shots.js'), '--look', 'Frost',
    '--out', canvas, '--width', '1280', '--height', '800', '--course-menu', '/courses/{bio}/modules', '/'], { cwd: root, stdio: 'inherit' });
  for (const [source, name] of [['frost-courses-bio-modules.png', '2-canvas-modules'], ['frost-dashboard.png', '3-canvas-dashboard']]) {
    await page.goto(`file://${path.join(canvas, source)}`);
    const file = path.join(out, `${name}.jpg`);
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
  for (const name of ['1-course-frost', '2-backgrounds-editor', '3-extras-paper', '4-horizon-midnight', '5-popup-ember']) {
    fs.rmSync(path.join(out, `${name}.jpg`), { force: true });
  }
  await context.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
