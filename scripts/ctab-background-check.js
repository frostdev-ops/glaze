// One background under course tabs: a course tab's frame wearing the page's background shows the page's through it, so
// the two never meet at a seam beside the rail. Real unpacked extension, headless Chrome, synthetic Ultra fixture.
// NODE_PATH=<installed playwright> node scripts/ctab-background-check.js [evidence directory]
// EXT=<another checkout> runs it against that code (a review checks what it judges, or the code before a fix).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const ext = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const G = require(path.join(ext, 'defaults.js'));
const html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ctab-bg-'));
const out = process.argv[2];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error('condition timed out');
};
const results = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: '_42_1' }), headers: { 'cache-control': 'no-store' } });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    // A scene that holds one still frame (motion off), so two screenshots of it can be compared to the pixel.
    const settings = { ...G.GZ_DEFAULTS, bg: { ...G.GZ_DEFAULTS.bg, kind: 'scene', scene: 'contours', intensity: 70 }, motion: { ...G.GZ_DEFAULTS.motion, level: 'off', followSystem: false },
      // Glaze's rail on (the frame sits beside it, where the seam was) and the strip at the top.
      navbar: { ...G.GZ_DEFAULTS.navbar, on: true, tabs: false },
      enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place'].includes(k)])), tabs: G.GZ_SANITIZE({}).tabs };
    await opts.evaluate(async ({ settings, key, site }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] }); // the student's yes to this Ultra site (lib/background.js approved)
      await chrome.storage.local.set({ [key]: { tabs: [1, 2].map((i) => ({ cid: `_10${i}_1`, name: `Synthetic course ${i}`, path: `/ultra/courses/_10${i}_1/outline`, top: 0, at: i, pin: false })) } });
    }, { settings, key, site });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').waitFor();
    await until(() => page.evaluate(() => !!document.getElementById('gz-scene')));
    await pause(800);
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    const frame = await until(() => Promise.resolve(page.frames().find((f) => f.name() === 'gz-ctab:_102_1')));
    await frame.waitForSelector('#gz-ctabs');
    await until(() => frame.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctab-framed')));
    await pause(1500);
    const state = async () => ({
      frame: await frame.evaluate(() => ({ through: document.documentElement.hasAttribute('data-gz-through'), scene: !!document.getElementById('gz-scene') })),
      page: await page.evaluate(() => {
        const f = document.querySelector('iframe[name="gz-ctab:_102_1"]'), r = f.getBoundingClientRect(), strip = document.querySelector('#site-wrap #gz-ctabs');
        return { key: document.documentElement.getAttribute('data-gz-bg-key'), marked: f.hasAttribute('data-gz-through'), scene: !!document.getElementById('gz-scene'),
          strip: strip ? getComputedStyle(strip).visibility : 'none', rect: [r.left, r.top, r.width, r.height] };
      }),
    });
    const s = await state();
    console.log(JSON.stringify(s));
    check(s.frame.through && !s.frame.scene, 'the frame wearing the page\'s background is see-through and draws no scene');
    check(s.page.scene && s.page.marked, 'the page keeps its scene and knows the frame shows over it');
    check(s.page.strip !== 'visible', 'the page\'s own strip does not show through the frame');
    // The frame's content hidden, what shows inside its box must be the page's own background, pixel for pixel: the same
    // as with the frame gone.
    const [x, y, w, h] = s.page.rect.map(Math.round);
    const clip = { x, y, width: w, height: h };
    await frame.evaluate(() => { document.body.style.visibility = 'hidden'; });
    await pause(300);
    const through = await page.screenshot({ clip });
    await page.evaluate(() => { document.getElementById('gz-ctabs-frames').style.visibility = 'hidden'; });
    await pause(300);
    const under = await page.screenshot({ clip });
    await page.evaluate(() => { document.getElementById('gz-ctabs-frames').style.visibility = ''; });
    await frame.evaluate(() => { document.body.style.visibility = ''; });
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'frame-box-through.png'), through); fs.writeFileSync(path.join(out, 'frame-box-under.png'), under);
      await pause(300); await page.screenshot({ path: path.join(out, 'course-tab.png') });
    }
    const diff = await opts.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const px = (i) => { const c = new OffscreenCanvas(i.width, i.height), g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
      const da = px(ia), db = px(ib); let sum = 0, worst = 0;
      for (let i = 0; i < da.length; i += 4) { const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3; sum += d; worst = Math.max(worst, d); }
      return { mean: sum / (da.length / 4), worst };
    }, [`data:image/png;base64,${through.toString('base64')}`, `data:image/png;base64,${under.toString('base64')}`]);
    console.log(JSON.stringify(diff));
    check(diff.mean < 1, `inside the frame's box the page's background shows unchanged (mean difference ${diff.mean.toFixed(2)} of 255, worst ${diff.worst.toFixed(0)})`);
    await frame.locator('#gz-ctabs [data-course-id="_101_1"]').click();
    await until(() => page.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctab-framed')));
    await page.locator('.b8b-document').click();
    await page.waitForSelector('.routed-scroll main');
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    await until(() => frame.evaluate(() => document.documentElement.hasAttribute('data-gz-through')));
    const routed = await page.locator('body > .routed-page.bb-offcanvas-container').evaluate((e) => getComputedStyle(e).visibility);
    check(routed === 'hidden', `the covered routed page outside site-wrap stays hidden (${routed})`);
    check(errors.length === 0, 'no page errors');
    console.log(JSON.stringify({ checks: results.length }, null, 2));
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
