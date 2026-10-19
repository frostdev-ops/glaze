// Real CSS on a synthetic Ultra panel, using the native gutter/close-button structure observed on Blackboard.
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/ultra-panel-background-check.js [receipt folder]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = process.env.EXT || path.resolve(__dirname, '..');
const out = process.argv[2];
const chrome = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const fixture = `<!doctype html><html><head><style>
  html { --gz-surface-2: #102030; --gz-bg-grad: linear-gradient(#102030, #102030); --gz-bg-dim: 0%;
    --gz-bg-image: linear-gradient(#102030, #102030); --gz-bg-1: #102030; --gz-bg-2: #102030; --gz-bg-3: #102030; }
  body { margin: 0; }
  #site-wrap { position: relative; height: 100vh; overflow: clip; }
  .underneath { position: absolute; inset: 0; background: repeating-linear-gradient(red 0 12px, #ff9900 12px 24px); }
  .bb-offcanvas-panel { position: absolute; inset: 0 0 0 36px; z-index: 10; }
  [dir=rtl] .bb-offcanvas-panel { inset: 0 36px 0 0; }
  .bb-offcanvas-panel-wrap { height: 100%; }
  .panel-wrap { position: absolute; inset: 0; overflow: auto; }
  .bb-close-offset { position: absolute; top: 30px; inset-inline-start: 0; }
  .bb-close { position: absolute; inset-inline-start: -24px; width: 40px; height: 40px; border: 0; background: #fff; color: #000; }
  .below-header .panel-wrap { top: 94px; }
  header { position: relative; height: 94px; background: #00cc00; }
  .scroll-content { height: 1400px; }
  .peek-panel__content-wrapper { position: absolute; inset: 0 0 0 60%; z-index: 30; }
</style></head><body><div id="site-wrap"><div class="underneath"></div>
<div class="bb-offcanvas-panel full"><div class="bb-offcanvas-panel-wrap">
  <header hidden>Course header</header><div class="panel-wrap"><div class="scroll-content"></div></div>
  <div class="bb-close-offset"><button class="bb-close" aria-label="Close">×</button></div>
</div></div></div></body></html>`;

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-panel-background-'));
  let context;
  const failures = []; let checks = 0;
  const check = (value, message) => { checks++; if (!value) failures.push(message); };
  try {
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, { executablePath: chrome, headless: true, viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage(), decoder = await context.newPage();
    // Decode screenshot pixels in a separate blank document, without another image dependency.
    const pixels = async (points) => decoder.evaluate(async ({ png, points }) => {
      const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
      return points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
    }, { png: (await page.screenshot()).toString('base64'), points });
    for (const width of [1280, 375]) for (const dir of ['ltr', 'rtl']) for (const kind of ['gradient', 'image', 'aurora', 'scene', 'solid']) {
      await page.setViewportSize({ width, height: 800 });
      await page.setContent(fixture);
      for (const sheet of ['theme.css', 'motion.css', 'extras.css']) await page.addStyleTag({ path: path.join(root, sheet) });
      await page.evaluate(({ dir, kind }) => {
        document.documentElement.dir = dir; document.documentElement.dataset.gzBg = kind;
        document.documentElement.style.setProperty('--gz-bg-blur', '6px');
        document.querySelector('button').onclick = () => document.body.dataset.closed = 'yes';
        if (kind === 'scene') {
          const canvas = document.createElement('canvas'); canvas.id = 'gz-scene';
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#184080'; ctx.fillRect(0, 0, canvas.width, canvas.height);
          document.querySelector('.panel-wrap').append(canvas);
        }
      }, { dir, kind });
      const label = `${width} ${dir} ${kind}`;
      const x = dir === 'ltr' ? 20 : width - 20;
      const clickable = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') === 'Close', [x, 50]);
      check(clickable, `${label}: the protruding close button must be hit-testable`);
      await page.mouse.click(x, 50);
      check(await page.locator('body').getAttribute('data-closed') === 'yes', `${label}: the gutter click must activate Close`);
      if (kind !== 'solid') {
        const [gutter, inside] = await pixels([[x, 200], [width / 2, 200]]);
        check(gutter[0] < 100, `${label}: covered navigation must not show through the gutter (${gutter})`);
        if (kind === 'scene') check(gutter.every((v, i) => Math.abs(v - inside[i]) < 3), `${label}: the scene must continue across the gutter (${gutter} vs ${inside})`);
      }
      if (out && width === 1280 && dir === 'ltr' && kind === 'scene') {
        fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'announcement-gutter.png') });
      }
      // A discussion's inner scroller starts below the header: its fixed background must stay below it.
      await page.evaluate(() => { document.querySelector('.bb-offcanvas-panel').classList.add('below-header'); document.querySelector('header').hidden = false; document.querySelector('.panel-wrap').scrollTop = 200; });
      const [header] = await pixels([[width / 2, 15]]);
      check(header[1] > 150 && header[0] < 40, `${label}: the scrolled background must not cover the course header (${header})`);
      if (kind === 'scene') {
        const [aboveGutter, gutter, inside] = await pixels([[x, 15], [x, 200], [dir === 'ltr' ? 60 : width - 60, 200]]);
        check(gutter.every((v, i) => Math.abs(v - inside[i]) < 3), `${label}: the scrolled scene must continue across the gutter (${gutter} vs ${inside})`);
        check(aboveGutter[2] < 70 && gutter[2] > 100, `${label}: the scene must stay below the header in the gutter (${aboveGutter} vs ${gutter})`);
      }
    }
    // Peek/Fabric side sheets and their descendants never acquire full-page backgrounds or clipping.
    for (const selector of ['bb-offcanvas-panel peek', 'peek-panel__content-wrapper', 'ms-Panel-main']) {
      await page.setContent(`<!doctype html><html data-gz-bg="gradient"><body><div class="${selector}"><div class="bb-offcanvas-panel"><div class="panel-wrap"></div></div></div></body></html>`);
      await page.addStyleTag({ path: path.join(root, 'extras.css') });
      const styles = await page.locator('body div').evaluateAll((els) => els.map((e) => ({ cls: e.className, clip: getComputedStyle(e).clipPath, before: getComputedStyle(e, '::before').content })));
      check(styles.every((s) => s.clip === 'none' && s.before === 'none'), `${selector}: partial-width sheets must keep their own background and clipping (${JSON.stringify(styles)})`);
    }
  } finally { await context?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
  console.log(`${checks - failures.length}/${checks} Ultra panel background checks passed`);
  assert.deepEqual(failures, []);
})().catch((e) => { console.error(e); process.exitCode = 1; });
