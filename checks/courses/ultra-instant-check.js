// Instant copies of Ultra's Grades, Courses list and Activity, and of a course's Course Content, Announcements and Gradebook
// (courses/page/instant.js) with the real unpacked extension, on a synthetic Ultra whose main area stays empty (a course's:
// its bar and a spinner) until the check puts Ultra's view in (test/fixtures/ultra-instant-*.html, the real pages' shapes,
// synthetic text); its router draws the page for the address again on popstate, as Ultra routes in place. Checks: a second
// visit shows the copy before Ultra's view, and how soon after Glaze's first paint; Ultra's view replaces it with layout
// shift <= 0.01; a course's copy is that course's only; in course tabs, the frame picked shows its course's copy with no
// stand-in over it, cold or from the standby, and how soon after the click, while the standby and a frame warmed by the
// pointer paint none; another student never sees it; the switch off shows and keeps nothing and drops what's kept; signing
// out drops it. No real LMS requests.
// glaze-remote -o <evidence dir> -- node checks/courses/ultra-instant-check.js /out
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const source = fs.realpathSync(path.join(__dirname, '../../extension'));
const out = process.argv[2];
const D = require(path.join(source, 'content/defaults.js'));
require(path.join(source, 'navigation/coursetabs.js')); // GZ_SPEC.tabs, for GZ_SANITIZE
const ORIGIN = 'https://ultra.instant.test';
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const PAGES = { grades: ['/ultra/grades', 'ultra-instant-grades.html'], courses: ['/ultra/course', 'ultra-instant-courses.html'], stream: ['/ultra/stream', 'ultra-instant-stream.html'] };
// A course's pages, of _101_1 unless named: the fixtures' course is _101_1, swapped for the course routed to.
const COURSE = { outline: ['/ultra/courses/_101_1/outline', 'ultra-instant-outline.html'], announcements: ['/ultra/courses/_101_1/announcements', 'ultra-instant-announcements.html'], gradebook: ['/ultra/courses/_101_1/grades', 'ultra-instant-gradebook.html'] };
const COURSES = [['_101_1', 'Sample Course One'], ['_102_1', 'Sample Course Two'], ['_103_1', 'Sample Course Three']];
const liveOf = (f) => /<main[^>]*>([\s\S]*)<\/main>/.exec(fs.readFileSync(path.join(__dirname, '../../test/fixtures', f), 'utf8'))[1];
const VIEWS = Object.fromEntries(Object.entries({ ...PAGES, ...COURSE }).map(([k, [, f]]) => [k, liveOf(f)]));
// Ultra's shell: its CDN base, its menu with the sign-out link, an empty main area (a course's: inside its section, with its
// bar and Ultra's spinner where the tool goes); fill() puts the page's view in. The page for the address is drawn again on
// popstate (Ultra routing in place, as the standby is adopted).
const shell = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="//ultra-cdn.invalid/ultra/uiv4001.0.0-rel/"><title>Ultra</title>
<style>body{margin:0;font:14px sans-serif}#base_tools{position:fixed;left:0;top:0;width:200px}main{margin-left:200px;padding:16px;min-height:600px}.element-card,.base-grades-course-tile{display:block;margin:8px 0;padding:12px;border:1px solid #ccc}
section.course{position:fixed;inset:0 0 0 200px}.panel-wrap{position:absolute;inset:0;overflow-y:auto}main.course-main-content{margin:0}.content-list-item{display:block;margin:4px 0;padding:10px;border:1px solid #ccc}svg{width:24px;height:24px}.spinner{width:24px;height:24px;margin:24px auto;border:3px solid;border-top-color:transparent;border-radius:50%}</style></head>
<body><div id="site-wrap"></div>
<script>(() => {
  const VIEWS = ${JSON.stringify(VIEWS)};
  const ROUTES = { grades: /^\\/ultra\\/grades\\/?$/, courses: /^\\/ultra\\/course\\/?$/, stream: /^\\/ultra\\/stream\\/?$/, outline: /^\\/ultra\\/courses\\/(_\\d+_\\d+)\\/outline\\/?$/, announcements: /^\\/ultra\\/courses\\/(_\\d+_\\d+)\\/announcements\\/?$/, gradebook: /^\\/ultra\\/courses\\/(_\\d+_\\d+)\\/grades\\/?$/ };
  const route = () => { for (const [k, re] of Object.entries(ROUTES)) { const m = re.exec(location.pathname); if (m) return { kind: k, cid: m[1] || '' }; } return { kind: '', cid: '' }; };
  const view = (r) => (VIEWS[r.kind] || '').replaceAll('_101_1', r.cid || '_101_1');
  const render = () => {
    const r = route(), site = document.getElementById('site-wrap');
    window.filledAt = null;
    if (!r.cid) { site.innerHTML = '<nav id="base_tools" class="MuiDrawer-paper"><a href="/ultra/course">Courses</a><a href="#" id="signout">Sign out</a></nav><main class="bb-offcanvas-container" id="main-content"></main>'; return; }
    const v = view(r), at = v.indexOf('<div class="course-tool-content">');
    site.innerHTML = '<div class="inner-wrap"><section class="course bb-offcanvas-container route-view-container"><div class="course-content-container"><div class="panel-wrap hide-in-background modern"><main class="course-main-content">'
      + v.slice(0, at) + '<div class="course-tool-content"><div class="spinner bb-secondary-color-2" role="progressbar" aria-label="Loading"></div></div></main></div></div></section></div>';
  };
  window.fill = () => { window.filledAt = performance.now(); const r = route(); document.querySelector(r.cid ? 'main.course-main-content' : 'main').innerHTML = view(r); };
  addEventListener('popstate', render);
  render();
})();</script></body></html>`;
// In the page's world from its first script: when Glaze styles the page, when the copy shows and goes, layout shifts.
// In course tabs' frames too: their copy's time also on the shared clock (timeOrigin + now), as the page around reads it.
function probe() {
  const s = window.probe = { styledAt: null, copyAt: null, copyClock: null, goneAt: null, shifts: [], said: [] };
  // Course tabs' words between the page and its frames, for a failure's evidence.
  addEventListener('message', (e) => { if (typeof e.data?.gzCtab === 'string' && s.said.length < 200) s.said.push([Math.round(performance.now()), e.source === window.top && window.top !== window ? 'from page' : 'from frame', JSON.stringify(e.data).slice(0, 100)]); });
  new MutationObserver(() => {
    if (s.styledAt == null && document.documentElement.hasAttribute('data-gz-font')) s.styledAt = performance.now();
    const c = document.getElementById('gz-instant');
    if (c && s.copyAt == null) { s.copyAt = performance.now(); s.copyClock = performance.timeOrigin + s.copyAt; }
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
    const meAsked = [], docs = [];
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin !== ORIGIN) return r.abort();
      if (r.request().resourceType() === 'document' && u.pathname.startsWith('/ultra')) { docs.push({ path: u.pathname, frame: r.request().frame().name() }); return r.fulfill({ contentType: 'text/html', body: shell() }); }
      if (u.pathname === '/learn/api/v1/users/me') { meAsked.push(who); return r.fulfill({ json: { id: who } }); }
      if (/\/users\/_\d+_1\/memberships/.test(u.pathname)) return r.fulfill({ json: { results: COURSES.map(([cid, name]) => ({ courseId: cid, course: { id: cid, courseId: cid, name } })), paging: {} } });
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: { results: [], paging: {} } });
      return r.abort();
    });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    await env.installed(opts);
    // Glaze's bar off: the course tabs' strip is on the page. Course tabs as by default (ahead of time on).
    const settings = { ...D.GZ_DEFAULTS, navbar: { ...D.GZ_DEFAULTS.navbar, on: false }, enhance: { ...D.GZ_DEFAULTS.enhance, sidebar: false }, tabs: D.GZ_SANITIZE({}).tabs };
    await opts.evaluate(async (settings) => { await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: ['https://ultra.instant.test'] }); }, settings);
    await env.ultraReady(opts);
    // The student's course tabs: their strip is on every page (it must stay out of a copy), and the tabs section picks them.
    await opts.evaluate(async ({ k, courses }) => {
      await chrome.storage.local.set({ [k]: { tabs: courses.map(([cid, name], i) => ({ cid, name, path: `/ultra/courses/${cid}/outline`, top: 0, at: i, pin: false })) } });
    }, { k: `ctabs:${ORIGIN}:_900_1`, courses: COURSES });
    const copies = () => opts.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).filter(([k]) => k.startsWith('ultraCopy:')).map(([k, v]) => [k, v.at]));
    const kept = async (key, after = 0) => (await copies()).some(([k, at]) => k === key && at > after);
    const key = (uid, kind, cid) => `ultraCopy:${ORIGIN}/${uid}/${kind}${cid ? `/${cid}` : ''}`;

    // A visit: Glaze styles the page; with a copy expected, it shows before Ultra's view; then Ultra's view goes in.
    const visit = async (kind, { expect, cid = '' }) => {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(probe);
      await page.goto(ORIGIN + (PAGES[kind] || COURSE[kind])[0].replace('_101_1', cid || '_101_1'));
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
          liveHidden: !!c && [...c.parentElement.children].filter((e) => e !== c).every((e) => getComputedStyle(e).visibility === 'hidden'),
          main: c?.parentElement.className || '', pointer: c && getComputedStyle(c).pointerEvents, html: document.documentElement.getAttribute('data-gz-instant'),
          strip: !!document.querySelector('#gz-instant #gz-ctabs') };
      });
      if (out && expect) await page.screenshot({ path: path.join(out, `instant-${kind}-copy.png`) });
      const saved = (await copies()).find(([k]) => k === key(who, kind, COURSE[kind] && (cid || '_101_1')))?.[1] || 0;
      await page.evaluate(() => window.fill());
      if (before.copy) await page.waitForSelector('#gz-instant', { state: 'detached' });
      const after = await page.evaluate(() => ({ ...window.probe, filledAt: window.filledAt, html: document.documentElement.getAttribute('data-gz-instant') }));
      if (out && expect) await page.screenshot({ path: path.join(out, `instant-${kind}-live.png`) });
      const shift = after.shifts.filter((s) => s.at >= after.filledAt).reduce((n, s) => n + s.value, 0);
      const v = { kind, cid, who, expect, before, copyAfterStyledMs: after.copyAt != null ? after.copyAt - after.styledAt : null, styledAt: after.styledAt, copyAt: after.copyAt, filledAt: after.filledAt, goneAt: after.goneAt, swapShift: shift, totalShift: after.shifts.reduce((n, s) => n + s.value, 0), errors };
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

    // ---- a course's Course Content, Announcements and Gradebook: kept per course, shown over the course's main area ----
    for (const kind of Object.keys(COURSE)) {
      const first = await visit(kind, { expect: false });
      check(!first.v.before.copy && first.v.copyAt == null, `${kind}: a first visit shows no copy`);
      await until(() => kept(key(who, kind, '_101_1')), `${kind} kept`);
      check(true, `${kind}: kept for its course once Ultra's view is ready`);
      await first.page.close();
      const other = await visit(kind, { expect: false, cid: '_102_1' });
      check(!other.v.before.copy && other.v.copyAt == null, `${kind}: another course's page never shows it`);
      await until(() => kept(key(who, kind, '_102_1')), `${kind} kept for the other course`);
      await other.page.close();
      const second = await visit(kind, { expect: true });
      const b = second.v.before;
      check(b.copy && b.text.length > 0 && b.inert === true && b.hidden === 'true' && b.pointer === 'none' && b.main === 'course-main-content', `${kind}: a second visit shows the copy over the course's main area, inert`, b);
      check(b.liveHidden && b.html === kind && !b.strip, `${kind}: Ultra's own view waits hidden beneath it, and the strip stays in Ultra's bar`, b);
      check(second.v.copyAt < second.v.filledAt && second.v.goneAt != null && second.v.html == null, `${kind}: there before Ultra's view, which replaces it`);
      check(second.v.swapShift <= 0.01, `${kind}: layout shift from the swap <= 0.01`, { swapShift: second.v.swapShift });
      check(second.v.errors.length === 0, `${kind}: no page errors`, second.v.errors);
      await until(() => kept(key(who, kind, '_101_1'), second.saved), `${kind} kept again`);
      await second.page.close();
    }

    // ---- course tabs: the frame picked shows its course's copy; the standby and a frame warmed ahead paint none ----
    {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(probe);
      await page.goto(`${ORIGIN}/ultra/courses/_103_1/outline`);
      await page.evaluate(() => window.fill());
      await until(() => page.evaluate(() => !!document.querySelector('#gz-ctabs [data-course-id="_101_1"]')), 'the strip');
      const frameOf = async (name) => (await page.$(`iframe[name="${name}"]`))?.contentFrame();
      // The standby boots at idle on Ultra's light page: no copy there, ever.
      await until(() => page.evaluate(() => !!document.querySelector('iframe[name="gz-ctab:standby"][data-ready]')), 'a ready standby', 30000);
      const sb = await (await frameOf('gz-ctab:standby')).evaluate(() => ({ path: location.pathname, copy: !!document.getElementById('gz-instant'), html: document.documentElement.getAttribute('data-gz-instant') }));
      check(sb.path === '/ultra/profile' && !sb.copy && sb.html == null, 'the standby paints no copy', sb);
      // Picked from the strip, the course's tab opens from the standby, routed in place: its copy, on screen, at once.
      // From the strip in `where`: the page's, or the frame's on screen (it covers the page's).
      const pick = async (cid, where = page) => {
        await where.evaluate(() => document.addEventListener('pointerdown', () => { window.pressedAt = performance.timeOrigin + performance.now(); }, { capture: true, once: true }));
        await where.click(`#gz-ctabs [data-course-id="${cid}"]`);
        const pressedAt = await where.evaluate(() => window.pressedAt);
        const shown = await until(async () => {
          const f = await frameOf(`gz-ctab:${cid}`);
          const copy = f && await f.evaluate(() => (document.getElementById('gz-instant') ? { at: window.probe?.copyClock, inert: document.getElementById('gz-instant').inert, siteWrap: getComputedStyle(document.getElementById('site-wrap')).visibility, frame: document.documentElement.hasAttribute('data-gz-instant-frame') } : null)).catch(() => null);
          const top = await page.evaluate((cid) => { const el = document.querySelector(`iframe[name="gz-ctab:${cid}"]`); return { visible: !!el && getComputedStyle(el).visibility === 'visible', sketch: !!document.querySelector('.gz-ctabs-pic') }; }, cid);
          return copy && top.visible && !top.sketch ? { ...copy, ...top } : null;
        }, `${cid}'s copy on screen`).catch(async (e) => {
          const f = await frameOf(`gz-ctab:${cid}`);
          console.error('frame state', JSON.stringify({ top: await page.evaluate((cid) => { const el = document.querySelector(`iframe[name="gz-ctab:${cid}"]`); return { style: el?.getAttribute('style'), sketch: !!document.querySelector('.gz-ctabs-pic'), said: window.probe.said }; }, cid),
            frame: f && await f.evaluate(() => ({ name: window.name, path: location.pathname, html: [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`.slice(0, 60)), copy: !!document.getElementById('gz-instant'), main: !!document.querySelector('main.course-main-content'), said: window.probe?.said })).catch((x) => String(x)) }, null, 1));
          throw e;
        });
        if (out) await page.screenshot({ path: path.join(out, `instant-tab-${cid}-copy.png`) });
        return { ...shown, clickToCopyMs: shown.at != null && pressedAt != null ? +(shown.at - pressedAt).toFixed(1) : null };
      };
      let mark = docs.length;
      const adopted = await pick('_101_1');
      check(adopted.inert && adopted.siteWrap === 'visible' && adopted.frame, 'a tab picked with no live frame shows its course\'s copy from the standby, with no stand-in over it', adopted);
      check(!docs.slice(mark).some((d) => d.path.startsWith('/ultra/courses/_101_1/')), 'routed in place in the standby, with no cold load');
      evidence.tabs = { standbyClickToCopyMs: adopted.clickToCopyMs };
      // Ultra's view in: the copy goes, the frame is drawn.
      const f1 = await frameOf('gz-ctab:_101_1');
      await f1.evaluate(() => window.fill());
      await until(() => f1.evaluate(() => !document.getElementById('gz-instant') && !document.documentElement.hasAttribute('data-gz-ctab-framed')), 'the frame drawn, its copy gone');
      check(true, 'Ultra\'s view replaces the frame\'s copy');
      // A frame warmed by the pointer runs hidden: no copy in it.
      await until(() => page.evaluate(() => !!document.querySelector('iframe[name="gz-ctab:standby"][data-ready]')), 'the next standby', 30000);
      await f1.hover('#gz-ctabs [data-course-id="_102_1"]');
      await until(async () => (await frameOf('gz-ctab:_102_1'))?.evaluate(() => location.pathname === '/ultra/courses/_102_1/outline' && !!document.querySelector('div.bb-course-navigation')).catch(() => false), 'the warmed frame routed');
      await page.mouse.move(5, 400);
      await until(() => opts.evaluate(async (o) => (await chrome.storage.local.get(`ultraMe:${o}`))[`ultraMe:${o}`]?.uid, ORIGIN).then((u) => u === who), 'the student confirmed');
      const warm = await frameOf('gz-ctab:_102_1');
      await warm.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
      const hidden = await page.evaluate(() => { const el = document.querySelector('iframe[name="gz-ctab:_102_1"]'); return { hidden: getComputedStyle(el).visibility === 'hidden', inert: el.inert }; });
      const inWarm = await warm.evaluate(() => ({ copy: !!document.getElementById('gz-instant'), frame: document.documentElement.hasAttribute('data-gz-instant-frame') }));
      check(hidden.hidden && !inWarm.copy && !inWarm.frame, 'a frame warmed ahead of a click, hidden, paints no copy', { ...hidden, ...inWarm });
      // Picked, it is the frame on screen while it loads: its copy shows then.
      const warmed = await pick('_102_1', f1);
      check(warmed.inert && warmed.siteWrap === 'visible', 'picked, the warmed frame shows its copy', warmed);
      await warm.evaluate(() => window.fill());
      await until(() => warm.evaluate(() => !document.getElementById('gz-instant')), 'the warmed frame drawn');
      // Ahead of time off: a cold frame for the course, its copy as soon as its Glaze is in and the student confirmed.
      await opts.evaluate(async () => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, ahead: false } }); });
      await until(() => page.evaluate(() => !document.querySelector('iframe[name="gz-ctab:standby"]')), 'the standby gone');
      await opts.evaluate(async (k) => { const r = (await chrome.storage.local.get(k))[k]; if (r) await chrome.storage.local.set({ [k.replace('_101_1', '_103_1')]: { ...r, course: '_103_1' } }); }, key(who, 'outline', '_101_1'));
      // _103_1 is this page's own course: its tab shows this page. Go to Activity, then pick it: a frame of its own.
      await page.goto(`${ORIGIN}/ultra/stream`);
      await until(() => page.evaluate(() => !!document.querySelector('#gz-ctabs [data-course-id="_103_1"]')), 'the strip on Activity');
      mark = docs.length;
      const cold = await pick('_103_1');
      check(docs.slice(mark).some((d) => d.path.startsWith('/ultra/courses/_103_1/')), 'a cold frame load', docs.slice(mark));
      check(cold.inert && cold.siteWrap === 'visible', 'a cold course frame shows its copy, with no stand-in over it', cold);
      evidence.tabs.coldClickToCopyMs = cold.clickToCopyMs;
      const f3 = await frameOf('gz-ctab:_103_1');
      await f3.evaluate(() => window.fill());
      await until(() => f3.evaluate(() => !document.getElementById('gz-instant')), 'the cold frame drawn');
      check(errors.length === 0, 'course tabs: no page errors', errors);
      console.log(`course tabs: click → copy ${adopted.clickToCopyMs} ms (standby), ${warmed.clickToCopyMs} ms (warmed), ${cold.clickToCopyMs} ms (cold)`);
      evidence.tabs.warmedClickToCopyMs = warmed.clickToCopyMs;
      await page.close();
      await opts.evaluate(async () => { const { tabs } = await chrome.storage.sync.get('tabs'); await chrome.storage.sync.set({ tabs: { ...tabs, ahead: true } }); });
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
