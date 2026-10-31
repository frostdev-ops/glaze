// Glaze's bar on Ultra at first paint (perf step 1b), with the real extension on the synthetic Ultra (test/fixtures/ultra-course.html)
// under a made-up school's address. A first load has no bar drawn before navigation/page/navbar.js is in; the second load in the
// tab stages what the first kept, hidden until the current account is verified, and the bar takes that copy over: one
// host, the same reserved room, no layout shift. A route change in the app moves the marks on the same item nodes.
// EXT=<checkout>/extension NODE_PATH=<playwright> nice node checks/navigation/ultra-navbar-first-paint-check.js <out dir>
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const ext = env.staged(process.env.EXT || path.join(__dirname, '../../extension'), ['https://bb.school.test/*']);
const G = require(path.join(ext, 'content/defaults.js'));
const site = 'https://bb.school.test', uid = '_42_1';
const out = path.resolve(process.argv[2] || 'ultra-navbar-first-paint-evidence');
const fixture = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-course.html'), 'utf8');
const id = [...crypto.createHash('sha256').update(ext).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const results = [];
const check = (v, label, actual) => { results.push({ pass: !!v, label, actual }); console.log(`${v ? 'ok  ' : 'FAIL'} ${label}${actual === undefined ? '' : ' ' + JSON.stringify(actual)}`); };
const until = async (page, fn, arg, label, timeout = 20000) => {
  for (const end = Date.now() + timeout; ; await new Promise((r) => setTimeout(r, 50))) {
    const v = await page.evaluate(fn, arg).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out: ${label}`);
  }
};

// In the page's world before anything else: what the bar is at the first frame (the first paint), every layout shift, and how
// many bar hosts the page ever had at once.
const watch = () => {
  const bar = () => document.getElementById('gz-navbar');
  const rail = (h) => [...(h?.shadowRoot?.querySelectorAll('.rail .list [data-id]') || [])];
  window.__shifts = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__shifts.push({ value: e.value, recent: e.hadRecentInput, sources: (e.sources || []).map((s) => s.node?.nodeName || '') }); }).observe({ type: 'layout-shift', buffered: true });
  window.__hosts = 0;
  new MutationObserver(() => { window.__hosts = Math.max(window.__hosts, document.querySelectorAll('#gz-navbar').length); }).observe(document, { childList: true, subtree: true });
  requestAnimationFrame(() => {
    const h = bar(), items = rail(h);
    window.__firstHost = h;
    window.__first = { host: !!h, copy: !!h?.hasAttribute('data-first'), shown: !!h && !h.hidden && getComputedStyle(h).display !== 'none', inert: !!h?.inert,
      room: ['--gz-navbar-left', '--gz-navbar-top'].map((k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim()),
      items: items.map((e) => e.dataset.id), current: items.filter((e) => e.getAttribute('aria-current') === 'page').map((e) => e.dataset.id),
      tops: Object.fromEntries(items.map((e) => [e.dataset.id, Math.round(e.getBoundingClientRect().top)])) };
  });
};
// The live bar, drawn (taken over from the copy, or mounted) and shown.
const live = () => {
  const h = document.getElementById('gz-navbar');
  return !!h && !h.hasAttribute('data-first') && !h.hidden && (h.shadowRoot?.querySelectorAll('.rail .list [data-id]').length || 0) >= 4;
};
const now = () => {
  const h = document.getElementById('gz-navbar'), items = [...h.shadowRoot.querySelectorAll('.rail .list [data-id]')];
  return { same: h === window.__firstHost, inert: h.inert, hosts: document.querySelectorAll('#gz-navbar').length, items: items.map((e) => e.dataset.id),
    room: ['--gz-navbar-left', '--gz-navbar-top'].map((k) => getComputedStyle(document.documentElement).getPropertyValue(k).trim()),
    current: items.filter((e) => e.getAttribute('aria-current') === 'page').map((e) => e.dataset.id), tops: Object.fromEntries(items.map((e) => [e.dataset.id, Math.round(e.getBoundingClientRect().top)])),
    kept: sessionStorage.getItem('gz-navbar') !== null };
};

(async () => {
  let ctx;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-navbar-first-'));
  fs.mkdirSync(out, { recursive: true });
  const errors = [];
  let meServed = 0, accountGate;
  try {
    await require('../../tools/dev/wait-for-browser.js')();
    ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking', '--renderer-process-limit=1'] });
    await ctx.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.protocol === 'chrome-extension:') return route.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return route.fulfill({ contentType: 'text/html', body: fixture });
      if (u.origin === site && u.pathname.endsWith('/users/me')) { await accountGate; meServed++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: uid }) }); }
      if (u.origin === site && u.pathname.includes('/learn/api/')) return route.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      if (u.hostname === 'cdn.school.test') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${id}/options.html`);
    await env.installed(opts);
    const base = G.GZ_DEFAULTS;
    await opts.evaluate(async ({ settings, site }) => {
      await chrome.storage.sync.clear(); await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site] });
      await chrome.storage.sync.set({ navbarItems: { glaze: [] } });
    }, { settings: { ...base, navbar: { ...base.navbar, on: true, place: 'rail', rail: 'auto', style: 'float' }, motion: { ...base.motion, level: 'off' }, enhance: { ...base.enhance, tabs: false } }, site });
    await env.ultraReady(opts);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(watch);

    // ---- a first load: nothing kept yet ----
    await page.goto(`${site}/ultra/course`);
    await until(page, live, null, 'the bar on the first load');
    const first = await page.evaluate(() => window.__first);
    check(first.items.length === 0, 'first load: no bar drawn at first paint before the bar is in (nothing kept yet)', first);
    // The account is known (the bar keeps nothing for an unknown one) before the page is left.
    for (const end = Date.now() + 20000; !meServed && Date.now() < end;) await new Promise((r) => setTimeout(r, 50));
    check(meServed > 0, 'the account was asked for');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));

    // ---- the second load: no private cached labels before account verification ----
    let releaseAccount;
    accountGate = new Promise((resolve) => { releaseAccount = resolve; });
    await page.goto(`${site}/ultra/calendar`);
    const at = await until(page, () => window.__first, null, 'the first frame of the second load');
    check(at.copy && !at.shown, 'second load: the cached bar stays hidden while the account is unknown', at);
    check(at.items.length >= 5 && ['institution-page', 'stream', 'course', 'calendar', 'grades'].every((i) => at.items.includes(i)), 'second load: it has Ultra\'s items at first paint', at.items);
    check(JSON.stringify(at.current) === '["calendar"]', 'second load: where the student is now is marked, not where they were', at.current);
    check(at.inert, 'second load: the copy takes no focus or clicks');
    await page.screenshot({ path: path.join(out, 'second-load.png') });
    releaseAccount(); accountGate = null;
    await until(page, live, null, 'the bar taking over');
    const taken = await page.evaluate(now);
    check(taken.same && !taken.inert, 'the bar takes over the copy: the same host, in use', { same: taken.same, inert: taken.inert });
    check(taken.hosts === 1 && (await page.evaluate(() => window.__hosts)) <= 1, 'one bar host at all times (no duplicate focus targets)', { now: taken.hosts, max: await page.evaluate(() => window.__hosts) });
    check(JSON.stringify(taken.items) === JSON.stringify(at.items), 'the same items as the copy, in the same order', { copy: at.items, live: taken.items });
    check(JSON.stringify(taken.room) === JSON.stringify(at.room), 'the reserved room is unchanged at takeover', { copy: at.room, live: taken.room });
    check(!taken.kept, 'what was kept is used once');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const shifts = await page.evaluate(() => window.__shifts);
    const cls = shifts.filter((s) => !s.recent).reduce((n, s) => n + s.value, 0);
    check(cls === 0, 'no layout shift on the second load', shifts);

    // ---- a route change in the app: the same item nodes, the mark moved ----
    await page.evaluate(() => { window.__nodes = [...document.getElementById('gz-navbar').shadowRoot.querySelectorAll('.rail .list [data-id]')]; });
    await page.evaluate(() => document.getElementById('gz-navbar').shadowRoot.querySelector('.rail .list [data-id="grades"]').click());
    await until(page, () => location.pathname === '/ultra/grades' && document.getElementById('gz-navbar').shadowRoot.querySelector('.rail .list [data-id="grades"]').getAttribute('aria-current') === 'page', null, 'the route change marked');
    const routed = await page.evaluate(() => {
      const items = [...document.getElementById('gz-navbar').shadowRoot.querySelectorAll('.rail .list [data-id]')];
      return { same: items.length === window.__nodes.length && items.every((e, i) => e === window.__nodes[i]), connected: window.__nodes.every((e) => e.isConnected),
        current: items.filter((e) => e.getAttribute('aria-current') === 'page').map((e) => e.dataset.id), parts: items.map((e) => e.getAttribute('part')) };
    });
    check(routed.same && routed.connected, 'a route change keeps the same item nodes', routed);
    check(JSON.stringify(routed.current) === '["grades"]' && routed.parts.filter((p) => / active$/.test(p)).length === 1, 'and moves the mark to the new page', routed);
    await page.screenshot({ path: path.join(out, 'routed.png') });
    check(errors.length === 0, 'no page errors', errors);
  } catch (e) {
    check(false, `the check ran to the end: ${e.message}`);
  } finally {
    await ctx?.close(); fs.rmSync(tmp, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(`${results.length - failed} ok, ${failed} failed`); process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
