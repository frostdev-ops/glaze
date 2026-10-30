// The command palette with an Ultra course tab on screen: Ctrl+K (⌘K) and Glaze's bar's Search open the palette of the
// tab shown, for its course, wherever the keyboard is (the tab's frame or the page around it); one still loading opens
// it once drawn. Real unpacked extension, headless Chrome, the synthetic Ultra (test/fixtures/ultra-course.html), no
// account or outside network.
// NODE_PATH=<installed playwright> node scripts/ctab-palette-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
// A copy holding the school's host, as the student's grant does (scripts/check-env.js staged).
const ext = require('./check-env.js').staged(process.env.EXT || path.join(__dirname, '..'), ['https://bb.school.test/*']);
const site = 'https://bb.school.test', key = `ctabs:${site}:_42_1`;
const G = require(path.join(ext, 'defaults.js'));
const html = fs.readFileSync(path.join(__dirname, '../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ctab-palette-'));
const out = process.argv[2];
const COURSES = [101, 102, 103, 104].map((n) => [`_${n}_1`, `Synthetic course ${n - 100}`]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => {
  const start = Date.now();
  while (Date.now() - start < ms) { const value = await fn().catch(() => false); if (value) return value; await pause(80); }
  throw new Error('condition timed out');
};
const results = [], errors = [];
const check = (value, message) => { assert.ok(value, message); results.push(message); console.log(`ok ${message}`); };
(async () => {
  let ctx;
  const holding = new Set(), held = new Map(); // course ids whose next page is held back; their releases
  try {
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      ...require('./check-env.js').chromeLaunch(),
      headless: true, viewport: { width: 1280, height: 860 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) {
        const cid = u.pathname.match(/^\/ultra\/courses\/(_\d+_1)\//)?.[1];
        if (holding.delete(cid)) await new Promise((r) => held.set(cid, r));
        return route.fulfill({ contentType: 'text/html', body: html });
      }
      if (u.origin === site && u.pathname.endsWith('/users/me')) return route.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && /\/users\/_\d+_1\/memberships/.test(u.pathname)) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ results: COURSES.map(([cid, name]) => ({ courseId: cid, course: { id: cid, courseId: cid, name } })) }) });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    // Glaze's bar on, as by default, holding the course tabs and its Search item.
    const settings = { ...G.GZ_DEFAULTS, enhance: { ...G.GZ_DEFAULTS.enhance, sidebar: false }, tabs: G.GZ_SANITIZE({}).tabs, navbarItems: { glaze: ['search'] } };
    await opts.evaluate(async ({ settings, key, site, courses }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] });
      await chrome.storage.local.set({ [key]: { tabs: courses.map(([cid, name], i) => ({ cid, name, path: `/ultra/courses/${cid}/outline`, top: 0, at: i, pin: false })) } });
    }, { settings, key, site, courses: COURSES });
    await require('./check-env.js').ultraReady(opts);
    const page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    const frame = (cid) => page.frames().find((f) => f.name() === `gz-ctab:${cid}`);
    const shown = (cid) => page.evaluate((cid) => { const f = document.querySelector(`iframe[name="gz-ctab:${cid}"]`); return !!f && !f.inert && getComputedStyle(f).visibility === 'visible' && !!document.querySelector('#gz-ctabs-frames[data-on]'); }, cid);
    const drawn = async (cid) => {
      await until(() => shown(cid));
      const f = await until(() => Promise.resolve(frame(cid)));
      await until(() => f.evaluate(() => !document.querySelector('.spinner, [data-gz-placing]') && !document.documentElement.hasAttribute('data-gz-ctab-framed') && !!document.querySelector('.bb-course-navigation')));
      return f;
    };
    // Glaze's bar, in its open shadow root: a course tab's button, its Search item. A click leaves the keyboard on it.
    const bar = (sel, click = true) => page.evaluate(({ sel, click }) => { const b = document.getElementById('gz-navbar').shadowRoot.querySelector(sel); if (click) b.click(); b.focus(); }, { sel, click });
    const palette = (w) => w.evaluate(() => {
      const box = document.getElementById('gz-cmd');
      return box && { focused: document.activeElement === box.querySelector('input') && document.hasFocus(), rows: [...box.querySelectorAll('#gz-cmd-list li')].map((li) => li.textContent) };
    });
    const where = (w) => w.evaluate(() => location.pathname);
    const press = async () => { await page.keyboard.press('ControlOrMeta+k'); await pause(600); };
    const pick = async (text) => { await page.keyboard.type(text); await pause(200); await page.keyboard.press('Enter'); };
    const shot = (name) => out && page.screenshot({ path: path.join(out, `${name}.png`) });
    if (out) fs.mkdirSync(out, { recursive: true });

    await page.goto(`${site}/ultra/courses/_101_1/outline`);
    await until(() => page.evaluate(() => !!document.getElementById('gz-navbar')?.shadowRoot?.querySelector('.ctab-go[data-cid="_102_1"]') && !!document.querySelector('.bb-course-navigation')));
    await pause(500);
    await press();
    check((await palette(page))?.focused, 'on the page itself, Ctrl+K opens its own palette');
    await page.keyboard.press('Escape');
    await until(async () => !await palette(page));

    // A course tab picked in Glaze's bar, the keyboard left on that button.
    await bar('.ctab-go[data-cid="_102_1"]');
    let f = await drawn('_102_1');
    await bar('.ctab-go[data-cid="_102_1"]', false);
    await press();
    await shot('from-page-around');
    const fromAround = await palette(f);
    check(!await palette(page) && fromAround?.focused && fromAround.rows.some((r) => r.startsWith('Announcements')), 'with the keyboard on the page around a course tab, Ctrl+K opens the palette of the tab on screen, its search box focused');
    await pick('Announcements');
    await until(async () => await where(f) === '/ultra/courses/_102_1/announcements');
    await pause(500);
    check(await where(page) === '/ultra/courses/_101_1/outline' && await shown('_102_1'), "and its This course rows go to that course's pages, inside the tab, the page under it untouched");

    // Opened in the tab, then the keyboard taken to the page around: Ctrl+K there closes it, as anywhere else.
    await f.locator('body').click({ position: { x: 700, y: 600 } });
    await press();
    check((await palette(f))?.focused, 'with the keyboard in the tab, Ctrl+K opens its palette as before');
    await bar('.ctab-go[data-cid="_102_1"]', false);
    await press();
    check(!await palette(f) && !await palette(page), 'Ctrl+K from the page around closes the open palette of the tab');

    await bar('[data-id="glaze:search"]');
    await until(() => palette(f));
    check((await palette(f)).focused && !await palette(page), "Glaze's bar's Search opens the palette of the tab on screen");

    // Back to the page itself: the tab's palette closes as the tab goes; the page's own palette is its own course's.
    await bar('.ctab-go[data-cid="_101_1"]');
    await until(async () => !await shown('_102_1'));
    await until(async () => !await palette(f));
    check(true, 'leaving the tab closes its palette');
    await page.evaluate(() => document.body.focus());
    await press();
    check((await palette(page))?.focused, 'and on the page Ctrl+K opens its own palette');
    await pick('Announcements');
    await until(async () => await where(page) === '/ultra/courses/_101_1/announcements');
    check(!await shown('_102_1'), "whose This course rows go to the page's own course");
    await until(() => page.evaluate(() => !!document.querySelector('.bb-course-navigation')));

    // A tab whose page is still loading: Ctrl+K opens its palette once it is drawn.
    holding.add('_103_1');
    await bar('.ctab-go[data-cid="_103_1"]');
    await until(() => Promise.resolve(held.has('_103_1')));
    await bar('.ctab-go[data-cid="_103_1"]', false);
    await press();
    check(!await palette(page), 'over a tab still loading, Ctrl+K opens nothing on the page under it');
    held.get('_103_1')();
    f = await drawn('_103_1');
    await until(() => palette(f));
    await shot('once-drawn');
    check((await palette(f)).focused && !await palette(page), 'and the palette of that tab once it is drawn, its search box focused');
    await page.keyboard.press('Escape');
    await until(async () => !await palette(f));

    // Pressed twice while loading: taken back, nothing opens.
    holding.add('_104_1');
    await bar('.ctab-go[data-cid="_104_1"]');
    await until(() => Promise.resolve(held.has('_104_1')));
    await bar('.ctab-go[data-cid="_104_1"]', false);
    await press();
    await press();
    held.get('_104_1')();
    f = await drawn('_104_1');
    await pause(1200);
    check(!await palette(f) && !await palette(page), 'a second Ctrl+K before the tab is drawn takes the first back');

    check(!errors.length, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
    if (out) fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ results }, null, 2));
  } finally {
    for (const r of held.values()) r();
    await ctx?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
