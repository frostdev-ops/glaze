// Glaze's lit toolbar icon, headless, with the real unpacked extension: the three declarativeContent rules the worker installs
// on install (lib/background.js LIT), and whether each fires on its LMS's page and on no other. A browser shows no extension's
// icon to a check, so beside each rule the check installs a twin with the same conditions whose action marks the page
// (RequestContentScript: Playwright's Chromium has it, stable Chrome doesn't; the twins exist only here). Synthetic pages
// (test/fixtures; the Ultra page wears the off-canvas wrap real Ultra has), no outside network. Also: the attention icon
// drawn at 16 and 32 (saved enlarged, and its dot's pixels read), and the per-tab normal icon's path loads.
// NODE_PATH=<installed playwright> nice node scripts/lit-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const HOSTS = { canvas: 'https://canvas.school.test', moodle: 'https://moodle.school.test', ultra: 'https://bb.school.test', plain: 'https://www.school.test' };
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), Object.values(HOSTS).map((h) => `${h}/*`));
// The twins' marks: new files in the staged copy (its own files are links to the checkout's and are never written).
for (const name of ['canvas', 'moodle', 'ultra']) fs.writeFileSync(path.join(ext, `twin-${name}.js`), `document.documentElement.setAttribute('data-twin-${name}', '');\n`);
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-lit-'));
const out = process.argv[2] || path.join(tmp, 'shots');
fs.mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };

(async () => {
  let ctx;
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    require('./check-env.js').noFirstRun(ctx);
    const pages = {
      [`${HOSTS.canvas}/courses/25`]: fixture('canvas-course-home.html'),
      [`${HOSTS.moodle}/my/`]: fixture('moodle-dashboard.html'),
      [`${HOSTS.ultra}/ultra/courses/_101_1/outline`]: fixture('ultra-course.html').replace('<div id="site-wrap">', '<div id="site-wrap" class="off-canvas-wrap">'),
      // The same Ultra page off /ultra, and a school's main website.
      [`${HOSTS.ultra}/webapps/portal/frameset.jsp`]: fixture('ultra-course.html').replace('<div id="site-wrap">', '<div id="site-wrap" class="off-canvas-wrap">'),
      [`${HOSTS.plain}/`]: '<!doctype html><html><head><title>School</title></head><body><div id="application"><h1>Welcome</h1></div></body></html>',
    };
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      const body = pages[`${u.origin}${u.pathname}`];
      if (body) return route.fulfill({ contentType: 'text/html', body });
      if (u.hostname.endsWith('.school.test')) return route.fulfill({ status: 404, contentType: 'text/plain', body: '' });
      return route.abort();
    });
    const sw = ctx.serviceWorkers().find((w) => w.url().startsWith(`chrome-extension://${id}/`)) || await ctx.waitForEvent('serviceworker', { predicate: (w) => w.url().startsWith(`chrome-extension://${id}/`) });
    const rules = async () => sw.evaluate(() => new Promise((done) => chrome.declarativeContent.onPageChanged.getRules(done)));
    let installed = [];
    for (let i = 0; i < 50 && installed.length < 3; i++) { installed = await rules(); if (installed.length < 3) await pause(100); }
    const want = await sw.evaluate(() => LIT);
    check(installed.length === 3, `the worker installed three rules on install (${installed.length})`);
    const shape = (c) => JSON.stringify({ css: c.css, pageUrl: c.pageUrl });
    check(JSON.stringify(installed.map((r) => r.conditions.map(shape))) === JSON.stringify(want.map((c) => [shape(c)])), 'with Canvas\'s, Moodle\'s and Ultra\'s conditions');
    check(installed.every((r) => r.actions.length === 1 && r.actions[0].instanceType === 'declarativeContent.SetIcon'), 'each lighting the icon');

    await sw.evaluate(() => new Promise((done) => chrome.declarativeContent.onPageChanged.addRules(LIT.map((c, i) => ({
      id: `twin-${i}`, conditions: [new chrome.declarativeContent.PageStateMatcher(c)],
      actions: [new chrome.declarativeContent.RequestContentScript({ js: [`twin-${['canvas', 'moodle', 'ultra'][i]}.js`] })],
    })), done)));
    const page = await ctx.newPage();
    const fired = async (url) => {
      await page.goto(url);
      await page.waitForLoadState('load');
      await pause(1500);
      return page.evaluate(() => ['canvas', 'moodle', 'ultra'].filter((n) => document.documentElement.hasAttribute(`data-twin-${n}`)));
    };
    for (const [url, expect] of [[`${HOSTS.canvas}/courses/25`, ['canvas']], [`${HOSTS.moodle}/my/`, ['moodle']], [`${HOSTS.ultra}/ultra/courses/_101_1/outline`, ['ultra']],
      [`${HOSTS.ultra}/webapps/portal/frameset.jsp`, []], [`${HOSTS.plain}/`, []]]) {
      const got = await fired(url);
      check(JSON.stringify(got) === JSON.stringify(expect), `${new URL(url).host}${new URL(url).pathname}: ${expect.length ? `${expect[0]}'s rule fires, no other` : 'no rule fires'} (${got.join(', ') || 'none'})`);
    }

    // The attention icon, as the worker draws it, enlarged without smoothing and at its own size.
    const icon = await sw.evaluate(async () => {
      const d = await litIcon();
      return Object.fromEntries(Object.entries(d).map(([n, im]) => [n, { w: im.width, h: im.height, data: Array.from(im.data) }]));
    });
    const px = (n, x, y) => icon[n].data.slice((y * icon[n].w + x) * 4, (y * icon[n].w + x) * 4 + 4);
    const near = (p, hex, tol = 40) => [0, 1, 2].every((i) => Math.abs(p[i] - parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16)) <= tol) && p[3] > 200;
    check(icon[16].w === 16 && icon[32].w === 32, 'the icon is drawn at 16 and 32');
    check(near(px(16, 12, 3), '#a6efff') && near(px(32, 25, 7), '#a6efff'), `its dot is bright at the top right (${px(16, 12, 3)} / ${px(32, 25, 7)})`);
    check(near(px(16, 9, 3), '#03131e', 30) && near(px(32, 18, 7), '#03131e', 30), `in a dark ring (${px(16, 9, 3)} / ${px(32, 18, 7)})`);
    const plainIcon = await sw.evaluate(async () => {
      const g = new OffscreenCanvas(16, 16).getContext('2d');
      g.drawImage(await createImageBitmap(await (await fetch(chrome.runtime.getURL('icons/icon16.png'))).blob()), 0, 0);
      return Array.from(g.getImageData(0, 0, 16, 16).data);
    });
    const changed = (n) => { let c = 0; for (let i = 0; i < 16 * 16; i++) if (icon[16].data.slice(i * 4, i * 4 + 4).some((v, k) => v !== plainIcon[i * 4 + k])) c++; return c; };
    check(changed() > 0 && changed() < 70, `the rest is Glaze's icon (${changed()} of 256 pixels changed at 16)`);
    const shot = await ctx.newPage();
    await shot.setContent('<body style="margin:0"><div id="icons" style="display:inline-flex;gap:28px;padding:28px;align-items:end;background:#202124"></div></body>');
    await shot.evaluate((ic) => {
      const add = (n, scale, bg) => {
        const c = document.createElement('canvas');
        c.width = n; c.height = n;
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(ic[n].data), n, n), 0, 0);
        Object.assign(c.style, { width: `${n * scale}px`, height: `${n * scale}px`, imageRendering: 'pixelated', background: bg, padding: '6px', borderRadius: '6px' });
        document.querySelector('#icons').append(c);
      };
      for (const bg of ['#202124', '#f1f3f4']) { add(16, 1, bg); add(32, 1, bg); add(16, 8, bg); add(32, 4, bg); }
    }, icon);
    await shot.locator('#icons').screenshot({ path: path.join(out, 'attention-icon.png') });
    check(fs.existsSync(path.join(out, 'attention-icon.png')), `the icon's screenshot is saved (${path.join(out, 'attention-icon.png')})`);
    await shot.close();

    // Glaze's own icon for a tab: the path the worker sets loads (setIcon rejects a path it can't load).
    const tab = await sw.evaluate(async () => (await chrome.tabs.query({})).find((t) => /^https:/.test(t.url))?.id);
    const set = await sw.evaluate((t) => chrome.action.setIcon({ tabId: t, path: ownIcon() }).then(() => 'set', (e) => String(e)), tab);
    check(set === 'set', `Glaze's own icon loads for a tab (${set})`);
    console.log(`${results.length} ok, icon in ${out}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await ctx?.close().catch(() => {});
    fs.rmSync(path.join(tmp, 'profile'), { recursive: true, force: true });
  }
})();
