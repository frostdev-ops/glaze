// Floating widgets above a live Ultra course tab, including saved order, dragging, resizing and the narrow stack.
// The unpacked extension runs against the invented course fixture. Canvas's dialog cascade is checked with the same CSS.
// glaze-remote -o <evidence dir> -- node checks/core/widgets-stacking-check.js /out
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const env = require('../../tools/dev/check-env.js');
const root = path.resolve(process.env.EXT || path.join(__dirname, '../../extension'));
const G = require(path.join(root, 'content/defaults.js')), W = require(path.join(root, 'core/widgets.js'));
const site = 'https://bb.school.test', uid = '_42_1', key = `ctabs:${site}:${uid}`;
const html = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-course.html'), 'utf8');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-widget-stacking'));
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
const until = async (fn) => {
  for (const end = Date.now() + 15000; ; await new Promise((r) => setTimeout(r, 80))) {
    if (await fn()) return;
    if (Date.now() > end) throw Error('condition timed out');
  }
};
const topmost = (el) => {
  const r = el.getBoundingClientRect();
  return el.contains(document.elementFromPoint(r.left + 20, r.top + 15));
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-widget-stacking-'));
  fs.mkdirSync(out, { recursive: true });
  let ctx;
  try {
    const ext = require('../../tools/dev/check-env.js').staged(root, [`${site}/*`], tmp);
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    env.noFirstRun(ctx);
    ctx.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
    await ctx.route('**/*', (route) => {
      const req = route.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (req.method() !== 'GET') return route.abort();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: html });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ json: { id: uid } });
      if (u.origin === site && u.pathname.startsWith('/learn/api/')) return route.fulfill({ json: { results: [] } });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const worker = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
    await env.installed(worker);
    const settings = G.GZ_SANITIZE({
      motion: { level: 'off', followSystem: false }, footer: false,
      navbar: { ...G.GZ_DEFAULTS.navbar, on: true, place: 'top', tabs: false },
      enhance: Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, ['tabs', 'place', 'widgets', 'notes'].includes(k)])),
      tabs: { ...G.GZ_SANITIZE({}).tabs, ahead: false, keep: false },
    });
    const layout = W.layout({ filled: ['dash', 'courses', 'cdash'], tiles: W.TILES.map((id) => ({ id, on: false })),
      boards: { dash: [], courses: [], cdash: [], pages: [
        { id: 'notes', on: true, x: 0.15, y: 0.25, w: 420, h: 260, z: 1 },
        { id: 'timer', on: true, x: 0.20, y: 0.32, w: 280, h: 200, z: 2 },
      ] } });
    await worker.evaluate(async ({ settings, layout, key, site }) => {
      await chrome.storage.sync.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site], widgetLayout: layout,
        [key]: { tabs: [101, 102].map((n) => ({ cid: `_${n}_1`, name: `Synthetic course ${n}`, path: `/ultra/courses/_${n}_1/outline`, top: 0, at: n, pin: false })) } });
    }, { settings, layout, key, site });
    await env.ultraReady(worker);
    const page = await ctx.newPage();
    const notes = page.locator('#gz-float [data-tile="notes"]'), timer = page.locator('#gz-float [data-tile="timer"]');
    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await notes.waitFor(); await timer.waitFor();
    await until(() => notes.evaluate((el) => !!el.style.left));
    check(await notes.evaluate(topmost), 'a floating widget receives pointer hits over the original course page');
    await page.locator('#gz-ctabs [data-course-id="_102_1"]').click();
    await until(() => page.evaluate(() => document.documentElement.hasAttribute('data-gz-ctab-framed')));
    const frame = page.frames().find((f) => f.name() === 'gz-ctab:_102_1');
    assert.ok(frame, 'course frame exists');
    await frame.waitForSelector('#gz-ctabs');
    await until(() => frame.evaluate(() => !document.documentElement.hasAttribute('data-gz-ctab-framed') && !document.querySelector('.spinner, [data-gz-placing]')));
    await page.screenshot({ path: path.join(out, 'course-tab.png') });
    check(await notes.evaluate(topmost), 'the floating widget receives pointer hits above the active course frame');
    check(await timer.evaluate(topmost), 'a second floating widget stays above the course frame too');
    const overlap = () => page.evaluate(() => {
      const a = document.querySelector('#gz-float [data-tile="notes"]').getBoundingClientRect();
      const b = document.querySelector('#gz-float [data-tile="timer"]').getBoundingClientRect();
      const left = Math.max(a.left, b.left), right = Math.min(a.right, b.right), top = Math.max(a.top, b.top), bottom = Math.min(a.bottom, b.bottom);
      return right > left && bottom > top && document.elementFromPoint((left + right) / 2, (top + bottom) / 2)?.closest('[data-tile]')?.dataset.tile;
    });
    check(await overlap() === 'timer', 'overlapping widgets keep their saved front-to-back order');
    await notes.locator('.gz-w-head').click({ position: { x: 20, y: 8 } });
    await until(async () => await overlap() === 'notes');
    check(true, 'pressing a widget heading brings that widget above the other float');
    const before = await notes.boundingBox();
    await page.mouse.move(before.x + 25, before.y + 18); await page.mouse.down();
    await page.mouse.move(before.x + 65, before.y + 50, { steps: 4 });
    check(await notes.evaluate(topmost), 'the dragged widget remains above the course frame');
    await page.mouse.up();
    await until(async () => { const r = await notes.boundingBox(); return Math.abs(r.x - before.x) > 10 || Math.abs(r.y - before.y) > 10; });
    check(await notes.evaluate(topmost), 'the widget stays above the frame after releasing a drag');
    const corner = await notes.locator('.gz-w-resize').boundingBox();
    const width = (await notes.boundingBox()).width;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down();
    await page.mouse.move(corner.x + corner.width / 2 + 48, corner.y + corner.height / 2 + 32, { steps: 4 });
    await page.mouse.up();
    await until(async () => (await notes.boundingBox()).width > width + 10);
    check(await notes.evaluate(topmost), 'the resized widget stays above the frame after releasing its corner');
    const box = await notes.boundingBox();
    check(box.width > 420, 'the floating container leaves fixed widget dimensions in viewport coordinates');
    await frame.locator('.js-course-announcement-tool').click();
    await frame.waitForSelector('announcement-list');
    check(await notes.evaluate(topmost), 'course navigation outside the widgets remains clickable beneath the floating surface');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#gz-float[data-stack]').waitFor();
    check(await notes.evaluate(topmost), 'the narrow scrolling widget stack remains above the course frame');
    check(await page.locator('#gz-float').evaluate((el) => getComputedStyle(el).position === 'fixed'), 'the narrow stack retains its fixed positioning');
    await page.screenshot({ path: path.join(out, 'narrow-stack.png') });

    // Canvas jQuery UI dialogs must lower the entire floating context, including widgets with inline saved/gesture z.
    const canvas = await ctx.newPage();
    await canvas.setContent('<html data-gz-ctab-framed><body><div id="gz-ctabs-frames" data-on></div><div id="gz-float"><section class="gz-w" style="left:40px;top:80px;width:280px;height:240px;z-index:1011">Floating widget</section></div><div class="ui-widget-overlay" style="display:none;position:fixed;inset:0;z-index:1000"></div><div class="ui-dialog" style="display:none;position:fixed;left:40px;top:80px;width:280px;height:240px;z-index:1001">Canvas dialog</div></body></html>');
    for (const file of ['core/page/apps.css', 'navigation/page/coursetabs.css', 'content/canvas.css']) await canvas.addStyleTag({ content: fs.readFileSync(path.join(root, file), 'utf8') });
    const hit = () => canvas.evaluate(() => document.elementFromPoint(80, 120)?.className);
    check(await hit() === 'gz-w', 'Canvas floating widgets also sit above the active course frame');
    for (const stack of [false, true]) {
      await canvas.evaluate((stack) => {
        const floats = document.getElementById('gz-float'); floats.toggleAttribute('data-stack', stack);
        floats.style.cssText = stack ? 'top:80px;right:auto;bottom:auto;left:40px;width:280px' : '';
        for (const el of document.querySelectorAll('.ui-dialog, .ui-widget-overlay')) el.style.display = '';
      }, stack);
      check(await hit() === 'ui-dialog', `a Canvas modal covers ${stack ? 'stacked' : 'freely placed'} floating widgets`);
      await canvas.evaluate(() => { for (const el of document.querySelectorAll('.ui-dialog, .ui-widget-overlay')) el.style.display = 'none'; });
    }
    await canvas.evaluate(() => { const el = document.getElementById('gz-float'); el.removeAttribute('data-stack'); el.removeAttribute('style'); });
    check(await hit() === 'gz-w', 'closing the Canvas dialog restores floating widget hit testing');
    check(errors.length === 0, `no page errors: ${errors.join('; ')}`);
  } finally {
    await ctx?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ checks: results, errors }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
