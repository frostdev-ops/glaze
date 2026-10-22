// The sidebar with course tabs on real Canvas at localhost:3000 (local test logins only): a course page loaded directly,
// the Dashboard hosted in the tabs' page frame, course frames; one working dock at a time (the document on screen), a
// placement made in a frame kept through switching and a refresh, rapid switching and Back/Forward, and no sidebar work in
// hidden documents (their Glaze sidebar nodes watched from the page for any change). Uses a temporary localhost-enabled
// extension and profile, removed on exit. Never opens, answers or submits a quiz.
// Hold $GLAZE_LOCK (default glaze-heavy.lock in the OS temp directory) and run under nice (as for the full test suite).
// NODE_PATH=/path/to/node_modules nice -n 15 node scripts/sidebar-tabs-check.js [screenshots directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const G = require('../defaults.js');
const I = require('../lib/i18n.js');
const W = require('../lib/widgets.js');
for (const lang of I.CODES) require(`../i18n/${lang}.js`);
const text = async (root, key) => I.t(key, {}, await root.locator('html').getAttribute('lang'));
const src = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'glaze-sidebar-tabs-evidence'));
const chromeLaunch = require('./check-env.js').chromeLaunch();
const local = 'http://localhost:3000';
const credentialsFile = process.env.CANVAS_CREDENTIALS || path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env');
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const settings = () => G.GZ_SANITIZE({ enabled: true, navbar: { on: false }, motion: { level: 'off' },
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), sidebar: true, tabs: true, todo: true, widgets: true, notes: true } });
let checks = 0, ctx, opts, page, tmp, ext;
const errors = [], failures = [];
const ok = (v, label) => { if (!v) throw Error(label); console.log(`ok   ${label}`); checks++; };
const probe = (v, label) => { if (v) ok(v, label); else { failures.push(label); console.error(`FAIL ${label}`); } };
const wait = async (read, accepts, label, ms = 20000) => { let v; const end = Date.now() + ms; do { v = await read(); if (accepts(v)) return v; await page.waitForTimeout(150); } while (Date.now() < end); throw Error(`${label} (last: ${JSON.stringify(v)})`); };
const shot = (name) => page.screenshot({ path: path.join(out, `${name}.png`) });

// Every document of this tab: the page and each course-tab frame, whether it is on screen, and whether its dock shows.
const docs = () => page.evaluate(() => {
  const vis = (d, e) => !!e && e.getClientRects().length > 0 && d.defaultView.getComputedStyle(e).visibility !== 'hidden' && d.defaultView.getComputedStyle(e).display !== 'none';
  const one = (d, name, onScreen) => {
    const host = d.querySelector('[data-gz-sidebar-host]');
    return { name, path: d.location.pathname, onScreen, dock: onScreen && vis(d, host) && !!host.querySelector('#gz-sb-widgets'), mode: d.documentElement.dataset.gzSidebar || null,
      hidden: d.documentElement.hasAttribute('data-gz-ctab-framed'), tiles: [...d.querySelectorAll('.gz-sb-dock > .gz-w')].map((t) => t.dataset.tile) };
  };
  const box = document.getElementById('gz-ctabs-frames');
  const frames = [...document.querySelectorAll('#gz-ctabs-frames > iframe')].map((f) => {
    let d = null; try { d = f.contentDocument; } catch { /* another origin */ }
    const onScreen = !!box?.hasAttribute('data-on') && f.style.visibility !== 'hidden' && f.style.display !== 'none' && !f.inert;
    return d?.documentElement ? one(d, f.name, onScreen) : { name: f.name, onScreen, dock: false };
  });
  return [one(document, 'top', !document.documentElement.hasAttribute('data-gz-ctab-framed')), ...frames];
});
const onScreen = async () => (await docs()).filter((d) => d.onScreen);
const settled = (name) => wait(async () => { const d = await docs(); return { live: d.filter((x) => x.dock).map((x) => x.name), shown: d.filter((x) => x.onScreen).map((x) => x.name), pic: await page.evaluate(() => !!document.querySelector('#gz-ctabs-frames .gz-ctabs-pic')) }; },
  (s) => s.live.length === 1 && s.shown.length === 1 && s.live[0] === s.shown[0] && !s.pic && (!name || s.shown[0] === name), `one dock, on the document on screen${name ? ` (${name})` : ''}`);
const oneDock = async (label, name) => {
  const s = await settled(name).catch((e) => ({ error: e.message }));
  probe(!s.error, `${label}: exactly one visible dock, the one on screen${s.error ? ` (${s.error})` : ` (${s.live[0]})`}`);
  return s;
};

// Watches every hidden document's Glaze sidebar nodes from the page itself (the main world): any change there counts.
const watchHidden = () => page.evaluate(() => {
  const all = [document, ...[...document.querySelectorAll('#gz-ctabs-frames > iframe')].map((f) => { try { return f.contentDocument; } catch { return null; } }).filter(Boolean)];
  globalThis.__gzSbWatch?.forEach((o) => o.disconnect());
  globalThis.__gzSbWatch = [];
  const counts = {};
  for (const d of all) {
    const name = d === document ? 'top' : d.defaultView.name;
    counts[name] = { hidden: d.documentElement.hasAttribute('data-gz-ctab-framed'), n: 0, what: [] };
    // Glaze's sidebar parts only: the LMS's own column content, and other features' marks on it, are not sidebar work.
    const ours = (n) => { const e = n?.nodeType === 1 ? n : n?.parentElement; return !!e?.closest?.('.gz-sb-head, .gz-sb-pagehead, .gz-sb-resize, #gz-sb-widgets, #gz-sidebar, .gz-sb-edge, .gz-sb-launch, .gz-sb-backdrop, .gz-sb-menu'); };
    const o = new d.defaultView.MutationObserver((rs) => {
      for (const r of rs) {
        const mine = r.type === 'attributes' && (r.target === d.documentElement || r.target.hasAttribute?.('data-gz-sidebar-host')) ? /^(data-gz-(sidebar|sb)|role|aria-)/.test(r.attributeName) : ours(r.target) || [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && (n.matches?.('#gz-sidebar, .gz-sb-head, #gz-sb-widgets, .gz-w') || ours(n)));
        if (mine) { counts[name].n++; if (counts[name].what.length < 5) counts[name].what.push(`${r.type}:${r.attributeName || ''}:${r.target.id || r.target.className || r.target.nodeName}`); }
      }
    });
    o.observe(d.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    globalThis.__gzSbWatch.push(o);
  }
  globalThis.__gzSbCounts = counts;
});
const hiddenCounts = () => page.evaluate(() => globalThis.__gzSbCounts);

(async () => {
  fs.mkdirSync(out, { recursive: true });
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sidebar-tabs-run-'))); ext = path.join(tmp, 'extension'); fs.mkdirSync(ext);
  try {
    for (const e of fs.readdirSync(src, { withFileTypes: true })) if (/\.(js|css|html)$/.test(e.name) || ['lib', 'features', 'i18n', '_locales', 'assets', 'fonts', 'icons', 'mods', 'sharing'].includes(e.name)) fs.cpSync(path.join(src, e.name), path.join(ext, e.name), { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json')));
    m.host_permissions.push('http://localhost/*');
    m.content_scripts.find((s) => s.matches.includes('https://*.instructure.com/*')).matches.push('http://localhost/*');
    for (const w of m.web_accessible_resources) w.matches.push('http://localhost/*');
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));
    await require('./wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...chromeLaunch, headless: true, viewport: { width: 1600, height: 1000 }, locale: 'en-US', reducedMotion: 'reduce', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    opts = await ctx.newPage(); await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    page = await ctx.newPage(); page.on('pageerror', (e) => errors.push(String(e))); page.setDefaultNavigationTimeout(30000);
    const localGet = (k) => opts.evaluate((k) => chrome.storage.local.get(k), k);
    await opts.evaluate(async ([s, lay]) => { await chrome.storage.sync.set(s); await chrome.storage.local.clear(); await chrome.storage.local.set({ widgetLayout: lay }); }, [settings(), W.layout()]);
    const credentials = Object.fromEntries(fs.readFileSync(credentialsFile, 'utf8').split(/\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, '')]; }));
    console.log('local login: student');
    await page.goto(local + '/login/canvas');
    await page.locator('#pseudonym_session_unique_id').fill(credentials.STUDENT_EMAIL);
    await page.locator('#pseudonym_session_password').fill(credentials.STUDENT_PASSWORD || credentials.PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.locator('button[type="submit"], input[type="submit"]').first().click()]);
    const api = (p) => page.evaluate((p) => fetch(p, { headers: { accept: 'application/json' } }).then((r) => r.text()).then((t) => JSON.parse(t.replace(/^while\(1\);/, ''))), p);
    const me = await api('/api/v1/users/self/profile');
    const courses = (await api('/api/v1/courses')).slice(0, 3);
    ok(courses.length >= 2, 'local student has at least two courses');
    const [A, B] = courses.map((c) => String(c.id));
    const recordKey = `sidebar:canvas:${local}/${me.id}`;
    const record = async () => (await localGet(recordKey))[recordKey];
    // A tab, in the strip of the document on screen (a frame over the page has its own).
    const tab = (cid) => ({
      count: () => page.locator(`#gz-ctabs .gz-ctab[data-course-id="${cid}"]`).count(),
      click: async () => {
        const end = Date.now() + 20000;
        let pressed = false;
        while (!pressed && Date.now() < end) {
          const on = (await onScreen())[0];
          if (!on) { await page.waitForTimeout(100); continue; }
          const root = on.name !== 'top' ? page.frameLocator(`#gz-ctabs-frames > iframe[name="${on.name}"]`) : page;
          try { await root.locator(`#gz-ctabs .gz-ctab[data-course-id="${cid}"]`).first().click({ timeout: 1000 }); pressed = true; }
          catch (e) { if ((await onScreen())[0]?.name === on.name) throw e; }
        }
        if (!pressed) throw Error('the document on screen did not settle for a tab press');
        const topCourse = await page.evaluate(() => location.pathname.match(/^\/courses\/(\d+)/)?.[1]);
        const name = topCourse === cid ? 'top' : `gz-ctab:${cid}`;
        await wait(onScreen, (ds) => ds.length === 1 && ds[0].name === name, `the tab pick shows ${name}`);
      },
    });

    // A course page loaded directly: the page's own dock.
    await page.goto(`${local}/courses/${A}`);
    await oneDock('direct course page', 'top');
    await wait(record, (r) => r?.mig === 1, 'the record migrated');
    await shot('direct-course');
    // The Dashboard, from Canvas's own navigation: in the tabs' page frame over this page.
    await page.locator('#global_nav_dashboard_link').click();
    const hosted = await oneDock('hosted Dashboard', 'gz-ctab:page');
    probe(hosted.live?.[0] === 'gz-ctab:page', 'the hosted Dashboard\'s frame has the dock; the page under it has none showing');
    await shot('hosted-dashboard');
    // Another course: its own frame.
    await page.goto(`${local}/courses/${B}`);
    await oneDock('direct second course', 'top');
    await wait(() => tab(A).count(), (n) => n > 0, 'a tab for the first course');
    await tab(A).click();
    await oneDock('course frame', `gz-ctab:${A}`);
    await shot('course-frame');

    // A placement made in the frame: Add widgets, then the Focus timer. It goes through the page around the frame.
    const frameOf = (cid) => page.frameLocator(`#gz-ctabs-frames > iframe[name="gz-ctab:${cid}"]`);
    const f = frameOf(A);
    const before = await record();
    await f.locator('.gz-sb-add').click();
    await f.locator('#gz-sb-adding .gz-sb-row', { hasText: await text(f, 'Focus timer') }).locator('button').click({ timeout: 10000 }).catch(async (e) => {
      console.error('Add widgets state', await f.locator('#gz-sb-adding').evaluate((el) => ({ hidden: el.hidden, rows: [...el.querySelectorAll('.gz-sb-row')].map((r) => r.textContent) })), await record());
      throw e;
    });
    const after = await wait(record, (r) => r?.dest?.timer === 'dock', 'the frame\'s change stored');
    ok(after.rev > before.rev, 'the frame\'s placement committed through the page around it');
    await wait(async () => (await docs()).find((d) => d.name === `gz-ctab:${A}`)?.tiles || [], (t) => t.includes('timer'), 'the timer in the frame\'s dock');
    // Switch to the page itself and back: the placement is there in each.
    await tab(B).click();
    await oneDock('switch to the page\'s own course', 'top');
    probe((await docs()).find((d) => d.name === 'top').tiles.includes('timer'), 'the page\'s dock shows the frame\'s placement');
    await tab(A).click();
    await oneDock('switch back to the frame', `gz-ctab:${A}`);
    // Refresh: the record, and the tab on screen, come back.
    await page.reload();
    const again = await oneDock('after a refresh');
    probe((await docs()).find((d) => d.name === again.live?.[0])?.tiles.includes('timer'), 'the placement survives a refresh');
    ok((await record()).dest.timer === 'dock', 'stored placement unchanged by the refresh');

    // No sidebar work in hidden documents: start the timer where it shows, then go elsewhere and watch the hidden ones.
    await page.goto(`${local}/courses/${B}`);
    await settled();
    // Revisiting the surrounding page's current URL restores its selected frame, as a refresh should. Pick its own
    // course explicitly before checking that document's sidebar.
    await tab(B).click();
    await oneDock('page again', 'top');
    await tab(A).click();
    await oneDock('frame again', `gz-ctab:${A}`);
    await f.locator('[data-tile="timer"] .gz-w-main').click();
    await page.waitForTimeout(1200);
    await tab(B).click();
    await oneDock('timer frame hidden', 'top');
    await page.waitForTimeout(800);
    await watchHidden();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(2500);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(1500);
    const quiet = await hiddenCounts();
    for (const [name, c] of Object.entries(quiet)) if (c.hidden) probe(c.n === 0, `hidden ${name}: no sidebar or dock changes through two resizes and a running timer (${c.n}${c.what.length ? ': ' + c.what.join(', ') : ''})`);
    probe(Object.values(quiet).some((c) => !c.hidden && c.n > 0), 'the document on screen did lay out (the watch works)');
    // Covered top too: while a frame shows, the page under it does nothing.
    await tab(A).click();
    await oneDock('frame over the page', `gz-ctab:${A}`);
    await page.waitForTimeout(800);
    await watchHidden();
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForTimeout(2000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(1200);
    const covered = (await hiddenCounts()).top;
    probe(covered.hidden && covered.n === 0, `the covered page: no sidebar changes (${covered.n}${covered.what.length ? ': ' + covered.what.join(', ') : ''})`);
    await f.locator('[data-tile="timer"] button', { hasText: await text(f, 'Reset') }).click();

    // Rapid switching: several picks before anything settles.
    for (let i = 0; i < 3; i++) { await tab(B).click(); await tab(A).click(); }
    await oneDock('rapid switching', `gz-ctab:${A}`);
    await tab(B).click(); await tab(A).click(); await tab(B).click();
    await oneDock('rapid switching ending on the page', 'top');
    // Back and Forward through the tabs' history.
    for (const [go, label] of [['back', 'Back'], ['back', 'Back again'], ['forward', 'Forward'], ['forward', 'Forward again']]) {
      await (go === 'back' ? page.goBack() : page.goForward()).catch(() => {});
      await page.waitForTimeout(400);
      await oneDock(label);
    }
    await shot('after-history');
    probe((await onScreen()).length === 1, 'one document on screen at the end');
    ok(!errors.length, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    console.log(`${failures.length ? 'FAILED' : 'passed'}; ${checks} checks, ${failures.length} failures; screenshots in ${out}`);
    if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  } finally {
    try { await ctx?.close(); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
