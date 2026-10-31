// Instant copies of Ultra's Grades, Courses list and Activity (S, courses/page/instant.js) with the real unpacked extension, on
// a synthetic Ultra whose main area stays empty until the check puts Ultra's view in (test/fixtures/ultra-instant-*.html,
// the real pages' shapes, synthetic text). Checks: a second visit shows the copy before Ultra's view, and how soon after
// Glaze's first paint; Ultra's view replaces it with layout shift <= 0.01; another student never sees it; the switch off
// shows and keeps nothing and drops what's kept; signing out drops it. No real LMS requests.
// glaze-remote -o <evidence dir> -- node checks/courses/ultra-instant-check.js /out
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const source = fs.realpathSync(path.join(__dirname, '../../extension'));
const out = process.argv[2];
const D = require(path.join(source, 'content/defaults.js'));
const ORIGIN = 'https://ultra.instant.test';
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const PAGES = { grades: ['/ultra/grades', 'ultra-instant-grades.html'], courses: ['/ultra/course', 'ultra-instant-courses.html'], stream: ['/ultra/stream', 'ultra-instant-stream.html'] };
const liveOf = (f) => /<main[^>]*>([\s\S]*)<\/main>/.exec(fs.readFileSync(path.join(__dirname, '../../test/fixtures', f), 'utf8'))[1];
// Ultra's shell: its CDN base, its menu with the sign-out link, an empty main area; fill() puts the page's view in.
const shell = (kind) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><title>Ultra</title>
<style>body{margin:0;font:14px sans-serif}#base_tools{position:fixed;left:0;top:0;width:200px}main{margin-left:200px;padding:16px;min-height:600px}.element-card,.base-grades-course-tile{display:block;margin:8px 0;padding:12px;border:1px solid #ccc}</style></head>
<body><div id="site-wrap"><nav id="base_tools" class="MuiDrawer-paper"><a href="/ultra/course">Courses</a><a href="#" id="signout">Sign out</a></nav><main class="bb-offcanvas-container" id="main-content"></main></div>
<script>window.fill = () => { window.filledAt = performance.now(); document.querySelector('main').innerHTML = ${JSON.stringify(liveOf(PAGES[kind][1]))}; };</script></body></html>`;
// In the page's world from its first script: when Glaze styles the page, when the copy shows and goes, layout shifts.
function probe() {
  const s = window.probe = { styledAt: null, copyAt: null, goneAt: null, shifts: [] };
  new MutationObserver(() => {
    if (s.styledAt == null && document.documentElement.hasAttribute('data-gz-font')) s.styledAt = performance.now();
    const c = document.getElementById('gz-instant');
    if (c && s.copyAt == null) s.copyAt = performance.now();
    if (!c && s.copyAt != null && s.goneAt == null) s.goneAt = performance.now();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-gz-font'] });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) s.shifts.push({ at: e.startTime, value: e.value }); }).observe({ type: 'layout-shift', buffered: true });
}
let checks = 0;
const evidence = { checks: [], visits: [] };
const check = (ok, message, data) => { evidence.checks.push({ ok: !!ok, message, data }); if (!ok) throw Error(`${message} ${data ? JSON.stringify(data) : ''}`); checks++; console.log(`ok ${message}`); };
// Polled from Node: waitForFunction resolves at once on an async predicate.
const until = async (f, what, timeout = 15000) => {
  for (const end = Date.now() + timeout; ; await new Promise((r) => setTimeout(r, 50))) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out: ${what}`);
  }
};

(async () => {
  let context, held = false;
  const lock = require('../../tools/dev/check-env.js').lockPath(), scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-instant-')));
  try {
    fs.mkdirSync(lock); held = true;
    const ext = require('../../tools/dev/check-env.js').staged(source, [`${ORIGIN}/*`]);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    env.noFirstRun(context);
    let who = '_900_1';
    const meAsked = [];
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin !== ORIGIN) return r.abort();
      const kind = Object.keys(PAGES).find((k) => PAGES[k][0] === u.pathname);
      if (kind) return r.fulfill({ contentType: 'text/html', body: shell(kind) });
      if (u.pathname === '/learn/api/v1/users/me') { meAsked.push(who); return r.fulfill({ json: { id: who } }); }
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: { results: [], paging: {} } });
      return r.abort();
    });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    await env.installed(opts);
    await opts.evaluate(async (defaults) => { await chrome.storage.sync.set(defaults); await chrome.storage.local.set({ ultra: ['https://ultra.instant.test'] }); }, D.GZ_DEFAULTS);
    await env.ultraReady(opts);
    const copies = () => opts.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('ultraCopy:')).map(([k, v]) => [k, v.at]));
    const kept = async (key, after = 0) => (await copies()).some(([k, at]) => k === key && at > after);
    const key = (uid, kind) => `ultraCopy:${ORIGIN}/${uid}/${kind}`;

    // A visit: Glaze styles the page; with a copy expected, it shows before Ultra's view; then Ultra's view goes in.
    const visit = async (kind, { expect }) => {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(probe);
      await page.goto(ORIGIN + PAGES[kind][0]);
      await page.waitForFunction(() => window.probe.styledAt != null);
      if (expect) await page.waitForSelector('#gz-instant', { state: 'attached' });
      else {
        // The student is confirmed here (ultra.js keeps who was confirmed), and two frames go by for a copy to paint.
        await until(() => opts.evaluate(async (o) => (await chrome.storage.local.get(`ultraMe:${o}`))[`ultraMe:${o}`]?.uid, ORIGIN).then((u) => u === who), 'the student confirmed');
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      }
      const before = await page.evaluate(() => {
        const c = document.getElementById('gz-instant');
        return { copy: !!c, text: c?.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) || '', inert: c?.inert, hidden: c?.getAttribute('aria-hidden'),
          liveHidden: !!c && [...document.querySelector('main').children].filter((e) => e !== c).every((e) => getComputedStyle(e).visibility === 'hidden'),
          pointer: c && getComputedStyle(c).pointerEvents, html: document.documentElement.getAttribute('data-gz-instant') };
      });
      if (out && expect) await page.screenshot({ path: path.join(out, `instant-${kind}-copy.png`) });
      const saved = (await copies()).find(([k]) => k === key(who, kind))?.[1] || 0;
      await page.evaluate(() => window.fill());
      if (before.copy) await page.waitForSelector('#gz-instant', { state: 'detached' });
      const after = await page.evaluate(() => ({ ...window.probe, filledAt: window.filledAt, html: document.documentElement.getAttribute('data-gz-instant') }));
      if (out && expect) await page.screenshot({ path: path.join(out, `instant-${kind}-live.png`) });
      const shift = after.shifts.filter((s) => s.at >= after.filledAt).reduce((n, s) => n + s.value, 0);
      const v = { kind, who, expect, before, copyAfterStyledMs: after.copyAt != null ? after.copyAt - after.styledAt : null, styledAt: after.styledAt, copyAt: after.copyAt, filledAt: after.filledAt, goneAt: after.goneAt, swapShift: shift, totalShift: after.shifts.reduce((n, s) => n + s.value, 0), errors };
      evidence.visits.push(v);
      return { page, v, saved };
    };

    // ---- a first visit keeps each page; the second shows it, before Ultra's view, and swaps it out without a shift ----
    for (const kind of Object.keys(PAGES)) {
      const first = await visit(kind, { expect: false });
      check(!first.v.before.copy && first.v.copyAt == null, `${kind}: a first visit shows no copy`);
      await until(() => kept(key(who, kind)), `${kind} kept`);
      check(true, `${kind}: kept once Ultra's view is ready`);
      await first.page.close();
      const second = await visit(kind, { expect: true });
      const b = second.v.before;
      check(b.copy && b.text.length > 0 && b.inert === true && b.hidden === 'true' && b.pointer === 'none', `${kind}: a second visit shows the copy, inert`, b);
      check(b.liveHidden && b.html === kind, `${kind}: Ultra's own view waits hidden beneath it`, b);
      check(second.v.copyAt < second.v.filledAt, `${kind}: the copy is there before Ultra's view`, { copyAt: second.v.copyAt, filledAt: second.v.filledAt });
      check(second.v.goneAt != null && second.v.html == null, `${kind}: Ultra's view replaces it`);
      check(second.v.swapShift <= 0.01, `${kind}: layout shift from the swap <= 0.01`, { swapShift: second.v.swapShift });
      check(second.v.errors.length === 0, `${kind}: no page errors`, second.v.errors);
      await until(() => kept(key(who, kind), second.saved), `${kind} kept again`);
      await second.page.close();
    }

    // ---- another student on the same site never sees it ----
    who = '_800_1';
    const other = await visit('grades', { expect: false });
    check(!other.v.before.copy && other.v.copyAt == null, 'another student never sees the copy');
    await until(() => kept(key('_800_1', 'grades')), 'kept for the other student');
    check((await copies()).some(([k]) => k === key('_900_1', 'grades')), 'and the first student\'s stays theirs');
    await other.page.close();
    who = '_900_1';

    // ---- the switch off: what's kept goes, nothing shows or is kept ----
    await opts.evaluate(async () => { const { enhance } = await chrome.storage.sync.get('enhance'); await chrome.storage.sync.set({ enhance: { ...enhance, instant: false } }); });
    await until(async () => (await copies()).length === 0, 'copies dropped with the switch off');
    check(true, 'the switch off drops every copy');
    const off = await visit('grades', { expect: false });
    await off.page.evaluate(() => new Promise((r) => requestIdleCallback(() => requestIdleCallback(r))));
    check(!off.v.before.copy && off.v.copyAt == null && (await copies()).length === 0, 'the switch off shows and keeps nothing');
    await off.page.close();
    await opts.evaluate(async () => { const { enhance } = await chrome.storage.sync.get('enhance'); await chrome.storage.sync.set({ enhance: { ...enhance, instant: true } }); });

    // ---- signing out drops this site's copies ----
    const again = await visit('courses', { expect: false });
    await until(() => kept(key(who, 'courses')), 'kept before signing out');
    await again.page.evaluate(() => document.getElementById('signout').click());
    await until(async () => (await copies()).length === 0, 'copies dropped on sign-out');
    check(true, 'signing out drops this site\'s copies');
    await again.page.close();
    evidence.meAsked = meAsked.length;
    console.log(`${checks} instant copy checks passed`);
  } catch (e) {
    evidence.error = String(e?.stack || e);
    throw e;
  } finally {
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'ultra-instant.json'), JSON.stringify(evidence, null, 2)); }
    if (context) await context.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmdirSync(lock);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
