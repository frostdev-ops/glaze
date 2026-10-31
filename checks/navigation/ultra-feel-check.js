// A click on Ultra answering within its frame (navigation/page/feedback.js, enhance.feedback) with the real unpacked extension,
// on a synthetic Ultra that routes in place (test/fixtures/ultra-feel.html: the live pages' shapes, invented text; Ultra's
// spinners 35 ms after a route change, its view later). Each click is a real press and release; every frame from the press
// until the page is ready says whether the clicked item looks different and whether the main area does (a skeleton, Ultra's
// spinners, the old view gone or the new one in), and whether a view transition holds what's painted. Measured with Glaze
// on, with Glaze off (enabled: false) and with the switch off: press → item, click → first painted change in the main area
// (within two frames of Glaze off for a course's tab and the main menu), the skeleton never beside a visible spinner and gone
// with the page ready, layout shift, and the skeleton giving way to an instant copy at once. Waits on state, never on a
// pause. No real LMS.
// node checks/navigation/ultra-feel-check.js <evidence dir>
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const source = fs.realpathSync(path.join(__dirname, '../../extension'));
const out = process.argv[2];
const D = require(path.join(source, 'content/defaults.js'));
const ORIGIN = 'https://ultra.feel.test', COURSE = '_101_1';
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const FIXTURE = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-feel.html'), 'utf8');

// In the page's world from its first script: per click, each frame from the press until the page is ready.
function probe() {
  const P = window.__feel = { shifts: [], longs: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) P.shifts.push({ at: e.startTime, value: e.value }); }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) P.longs.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true });
  const shows = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && getComputedStyle(e).opacity !== '0';
  const bar = () => document.getElementById('gz-navbar')?.shadowRoot;
  // The element pressed and the one that should look current, by name: a course's tab, Glaze's bar's item, Ultra's own
  // nav's link, a course card.
  const FIND = {
    tool: (id) => { const a = document.querySelector(`.js-course-navigation a.js-course-${id}-tool`); return { hit: a, item: a }; },
    bar: (id) => {
      const r = bar();
      const a = [...(r?.querySelectorAll(`[data-id="${id}"]`) || [])].find((e) => { if (!shows(e)) return false; const b = e.getBoundingClientRect(); return r.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('[data-id]') === e; });
      return { hit: a, item: a };
    },
    drawer: (href) => { const a = document.querySelector(`.MuiDrawer-paper a[href="${href}"]`); return { hit: a, item: a }; },
    card: (cid) => { const card = document.getElementById(`course-list-course-${cid}`); return { hit: card?.querySelector('.js-course-title-element'), item: card }; },
  };
  const look = (e) => { const s = getComputedStyle(e), a = getComputedStyle(e, '::after'); return [s.color, s.backgroundColor, s.boxShadow, s.outlineStyle, s.outlineColor, s.borderBottomColor, s.borderBottomWidth, s.fontWeight, a.content, a.backgroundColor, a.opacity].join('|'); };
  let run = null;
  P.arm = ({ find, arg, anchor, dest }) => {
    const { hit, item } = FIND[find](arg);
    if (!hit) return null;
    hit.scrollIntoView({ block: 'nearest' });
    const b = hit.getBoundingClientRect();
    const at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    // What's already there of the destination (a list under a course's panel) isn't it coming in.
    run = { hit, item, anchor: [...document.querySelectorAll(anchor)].find(shows) || null, dest, stale: new Set(document.querySelectorAll(dest)), from: location.href, frames: [], transitions: 0, downAt: null, clickAt: null, done: false, base: '', covered: at && !hit.contains(at) && !(at.shadowRoot && at.shadowRoot.contains(hit)) ? at.outerHTML.slice(0, 160) : '' };
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  // The item is what the pointer would hit at its centre: no transition holding the page, nothing over it.
  P.hits = () => {
    const b = run.hit.getBoundingClientRect(), x = b.x + b.width / 2, y = b.y + b.height / 2, r = run.hit.getRootNode();
    const at = r !== document && r.elementFromPoint ? r.elementFromPoint(x, y) : document.elementFromPoint(x, y);
    return !!at && run.hit.contains(at) && { x, y };
  };
  // The item has stopped moving under the pointer (a card's hover lift or tilt): the same box as at the last call.
  let was = '';
  P.still = () => { const b = run.hit.getBoundingClientRect(), now = [b.x, b.y, b.width, b.height].join(); const same = now === was; was = now; return same && !!P.hits(); };
  // Glaze answers a press there: a pointerdown of the page's own (not the measured one) marks the item, and its cancel unmarks it.
  P.armed = () => {
    const o = { bubbles: true, composed: true, isPrimary: true, pointerId: 99 };
    run.hit.dispatchEvent(new PointerEvent('pointerdown', o));
    const ok = run.item.hasAttribute('data-gz-press');
    run.hit.dispatchEvent(new PointerEvent('pointercancel', o));
    return ok && !run.item.hasAttribute('data-gz-press');
  };
  P.base = () => { run.base = look(run.item); return run.base; };
  // A view transition holds what's painted until its update is done: a frame then shows the old page, whatever the DOM says.
  const vts = new WeakMap();
  const vtHeld = () => {
    const vt = document.activeViewTransition;
    if (!vt) return false;
    if (!vts.has(vt)) { vts.set(vt, true); if (run) run.transitions++; vt.ready.then(() => vts.set(vt, false), () => vts.set(vt, false)); }
    return vts.get(vt);
  };
  const frame = () => {
    if (!run || run.done) return;
    const skel = document.getElementById('gz-skel');
    const spin = [...document.querySelectorAll('div.spinner')].some(shows);
    const fresh = [...document.querySelectorAll(run.dest)].filter((e) => !run.stale.has(e));
    const dest = fresh.some(shows), destIn = fresh.length > 0;
    const f = { t: performance.now(), held: vtHeld(), item: run.item.isConnected && look(run.item) !== run.base, skel: shows(skel), spin, dest, destIn, anchorGone: !!run.anchor && !shows(run.anchor),
      press: !!document.querySelector('[data-gz-press]') || !!bar()?.querySelector('[data-gz-press]') };
    f.main = f.skel || f.spin || f.dest || f.anchorGone;
    run.frames.push(f);
    if ((run.clickAt != null && location.href !== run.from && f.dest && !f.skel && !f.held && !window.__loading) || run.frames.length > 1800) { run.done = true; return; }
    requestAnimationFrame(frame);
  };
  addEventListener('pointerdown', (e) => { if (e.isTrusted && run && run.downAt == null) { run.downAt = e.timeStamp; requestAnimationFrame(frame); } }, true);
  addEventListener('click', (e) => { if (e.isTrusted && run && run.clickAt == null) { run.clickAt = e.timeStamp; run.target = e.composedPath()[0]?.outerHTML?.slice(0, 160); setTimeout(vtHeld); } }, true);
  P.frames = () => run?.frames.length || 0;
  // Where a click stands, for a check that times out.
  P.state = () => ({ href: location.href, loading: window.__loading, skel: !!document.getElementById('gz-skel'), skelAttr: document.documentElement.getAttribute('data-gz-skel'),
    host: document.querySelector('[data-gz-skel-host]')?.className || null, dest: run && document.querySelectorAll(run.dest).length, frames: run?.frames.length, downAt: run?.downAt, clickAt: run?.clickAt, last: run?.frames.at(-1),
    everPress: run?.frames.some((f) => f.press), everSkel: run?.frames.some((f) => f.skel), covered: run?.covered, target: run?.target,
    html: [...document.documentElement.attributes].filter((a) => a.name !== 'style').map((a) => `${a.name}=${a.value}`).join(' '), frames: [...document.querySelectorAll('iframe')].map((f) => `${f.name}:${getComputedStyle(f).visibility}`) });
  P.done = () => !!run?.done;
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  // The first painted frame from `from` with `key` set (one a view transition holds shows the old page): its index among
  // those frames (1: the first after it) and its time.
  P.result = () => {
    const first = (key, from) => { const i = run.frames.findIndex((f) => f.t >= from && f[key] && !f.held); return i < 0 ? null : { frame: run.frames.filter((f) => f.t >= from).indexOf(run.frames[i]) + 1, ms: +(run.frames[i].t - from).toFixed(1) }; };
    const last = run.frames.at(-1), lastSkel = run.frames.findLastIndex((f) => f.skel), firstIn = run.frames.findIndex((f) => f.destIn);
    return {
      downToItem: first('item', run.downAt), clickToItem: first('item', run.clickAt), clickToMain: first('main', run.clickAt), downToMain: first('main', run.downAt),
      clickToSkel: first('skel', run.clickAt), clickToSpin: first('spin', run.clickAt), clickToReady: first('dest', run.clickAt),
      pressMs: +(run.clickAt - run.downAt).toFixed(1), frames: run.frames.length, transitions: run.transitions, heldFrames: run.frames.filter((f) => f.held).length,
      frameMs: +median(run.frames.slice(1).map((f, i) => f.t - run.frames[i].t)).toFixed(1),
      skelBesideSpin: run.frames.filter((f) => f.skel && f.spin).length, everSkel: run.frames.some((f) => f.skel), everPress: run.frames.some((f) => f.press), everSpin: run.frames.some((f) => f.spin),
      // Frames between Ultra's view coming in (hidden under the skeleton) and the skeleton going.
      skelAfterIn: firstIn < 0 ? null : Math.max(0, lastSkel - firstIn + 1),
      readyShown: !!last?.dest && !last.skel,
      shift: +P.shifts.filter((s) => s.at >= run.downAt).reduce((n, s) => n + s.value, 0).toFixed(4),
      longTaskMs: +P.longs.filter((x) => x.at >= run.downAt && x.at <= last.t).reduce((n, x) => n + x.ms, 0).toFixed(1),
    };
  };
}

// PERF_DEVICE=neo: the MacBook Neo's window as checks/courses/ultra-perf-check.js has it (1280×800 at 2×, 6 cores).
// FEEL_MEASURE=n: no assertions; the tour n times with Glaze on and off, each click's medians to ultra-feel-measure.json.
const neo = process.env.PERF_DEVICE === 'neo', measureReps = Number(process.env.FEEL_MEASURE || 0);
const pinned = neo ? require('../courses/ultra-perf-check.js').pinCores() : null;
let checks = 0;
const evidence = { checks: [], clicks: [] };
const check = (ok, message, data) => { evidence.checks.push({ ok: !!ok, message, data }); if (!ok) throw Error(`${message} ${data ? JSON.stringify(data) : ''}`); checks++; console.log(`ok ${message}`); };
// Polled from Node: waitForFunction resolves at once on an async predicate.
const until = async (f, what, timeout = 20000) => {
  for (const end = Date.now() + timeout; ; await new Promise((r) => setTimeout(r, 25))) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out: ${what}`);
  }
};
const frames = (page, n = 2) => page.evaluate((k) => new Promise((r) => { const go = (i) => (i ? requestAnimationFrame(() => go(i - 1)) : r()); go(k); }), n);

(async () => {
  let context, held = false;
  const lock = require('../../tools/dev/check-env.js').lockPath(), scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-feel-')));
  try {
    fs.mkdirSync(lock); held = true;
    const ext = env.staged(source, [`${ORIGIN}/*`]);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: neo ? { width: 1280, height: 800 } : { width: 1280, height: 860 }, ...(neo && { deviceScaleFactor: 2 }),
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(20000);
    env.noFirstRun(context);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin !== ORIGIN) return r.abort();
      if (/^\/ultra(\/|$)/.test(u.pathname)) return r.fulfill({ contentType: 'text/html', body: FIXTURE });
      if (u.pathname === '/learn/api/v1/users/me') return r.fulfill({ json: { id: '_900_1', userName: 'student', givenName: 'Sam', familyName: 'Student' } });
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: { results: [], paging: {} } });
      return r.abort();
    });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    await env.installed(opts);
    await opts.evaluate(async (defaults) => { await chrome.storage.sync.set(defaults); await chrome.storage.local.set({ ultra: ['https://ultra.feel.test'] }); }, D.GZ_DEFAULTS);
    await env.ultraReady(opts);
    const set = (patch) => opts.evaluate(async ({ enabled, feedback }) => {
      const { enhance } = await chrome.storage.sync.get('enhance');
      await chrome.storage.sync.set({ enabled, enhance: { ...enhance, feedback } });
    }, patch);

    // A page of the synthetic Ultra, its view in, and Glaze's bar drawn where Glaze is on.
    const open = async (at, glaze) => {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(probe);
      await page.goto(ORIGIN + at);
      if (glaze) await until(() => page.evaluate(() => document.documentElement.hasAttribute('data-gz-font') && !!document.getElementById('gz-navbar')?.shadowRoot?.querySelector('[data-id="grades"]')), 'Glaze styled and its bar drawn');
      await until(() => page.evaluate(() => !window.__loading), 'the first view');
      await frames(page);
      return { page, errors };
    };
    // One click: pointed at, pressed, two frames on let go, then followed until the page is ready.
    const click = async (page, mode, what, how) => {
      // Something over the page (a crossfade's pictures) can keep the item from the pointer for a moment.
      await until(() => page.evaluate((a) => !!window.__feel.arm(a), how), `${mode} ${what}: something to click`);
      const at = await until(() => page.evaluate(() => window.__feel.hits()), `${mode} ${what}: under the pointer`);
      if (mode === 'on') await until(() => page.evaluate(() => window.__feel.armed()), `${mode} ${what}: Glaze answering presses`);
      await page.mouse.move(at.x, at.y);
      await until(async () => { await frames(page, 1); return page.evaluate(() => window.__feel.still()); }, `${mode} ${what}: still under the pointer`);
      const settled = await page.evaluate(() => window.__feel.hits());
      await page.mouse.move(settled.x, settled.y);
      await page.evaluate(() => window.__feel.base());
      await page.mouse.down();
      await until(() => page.evaluate(() => window.__feel.frames() >= 2), 'two frames after the press');
      await page.mouse.up();
      await until(() => page.evaluate(() => window.__feel.done()), `${mode} ${what}: the page ready`).catch(async (e) => {
        if (out) await page.screenshot({ path: path.join(out, `fail-${mode.replace(/\W/g, '-')}.png`) });
        throw Error(`${e.message} ${JSON.stringify(await page.evaluate(() => window.__feel.state()))}`);
      });
      const r = { mode, what, ...(await page.evaluate(() => window.__feel.result())) };
      evidence.clicks.push(r);
      console.log(`${mode.padEnd(10)} ${what.padEnd(28)} press→item ${r.downToItem ? `${r.downToItem.ms} ms (frame ${r.downToItem.frame})` : 'none'}; click→main ${r.clickToMain ? `${r.clickToMain.ms} ms (frame ${r.clickToMain.frame})` : 'none'}; click→ready ${r.clickToReady?.ms} ms; shift ${r.shift}`);
      return r;
    };
    // The same four clicks in each mode: Glaze's bar where Glaze is on, else Ultra's own nav.
    const tour = async (mode) => {
      const glaze = mode !== 'off';
      const nav = (id) => (glaze ? { find: 'bar', arg: id } : { find: 'drawer', arg: `/ultra/${id}` });
      const { page, errors } = await open(`/ultra/courses/${COURSE}/outline`, glaze);
      const runs = [
        await click(page, mode, 'course tab: Announcements', { find: 'tool', arg: 'announcement', anchor: '.content-list-item', dest: 'tr.announcement-item-row' }),
        await click(page, mode, 'course tab: Gradebook', { find: 'tool', arg: 'grades', anchor: 'tr.announcement-item-row', dest: 'course-student-grades tbody tr' }),
        await click(page, mode, 'nav: Courses', { ...nav('course'), anchor: 'course-student-grades tbody tr', dest: 'bb-base-course-card article.course-element-card' }),
        await click(page, mode, 'nav: Grades', { ...nav('grades'), anchor: 'article.course-element-card', dest: 'bb-base-grades-student .base-grades-course-tile' }),
        await click(page, mode, 'nav: Courses again', { ...nav('course'), anchor: '.base-grades-course-tile', dest: 'bb-base-course-card article.course-element-card' }),
        await click(page, mode, 'course card', { find: 'card', arg: '_102_1', anchor: 'article.course-element-card', dest: '.course-outline-content-list .content-list-item' }),
      ];
      return { page, errors, runs };
    };

    if (measureReps) {
      const runs = { on: [], off: [] };
      for (let i = 0; i < measureReps; i++) for (const mode of ['on', 'off']) {
        await set({ enabled: mode === 'on', feedback: true });
        const t = await tour(mode);
        runs[mode].push(...t.runs);
        await t.page.close();
      }
      const med = (xs) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2 : null; };
      const sumUp = (list) => ({ n: list.length, clickToPaintMs: med(list.map((r) => r.clickToMain?.ms)), clickToReadyMs: med(list.map((r) => r.clickToReady?.ms)), shift: med(list.map((r) => r.shift)), longTaskMs: med(list.map((r) => r.longTaskMs)), heldFrames: med(list.map((r) => r.heldFrames)) });
      evidence.measure = { device: neo ? { name: 'MacBook Neo', viewport: '1280x800@2', pinned } : null, reps: measureReps, byClick: {}, all: { on: sumUp(runs.on), off: sumUp(runs.off) } };
      for (const what of new Set(runs.on.map((r) => r.what))) evidence.measure.byClick[what] = { on: sumUp(runs.on.filter((r) => r.what === what)), off: sumUp(runs.off.filter((r) => r.what === what)) };
      console.log(JSON.stringify(evidence.measure, null, 1));
      if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'ultra-feel-measure.json'), JSON.stringify({ ...evidence.measure, clicks: evidence.clicks }, null, 2)); }
      return;
    }

    // ---- Glaze on ----
    const on = await tour('on');
    check(!(await on.page.evaluate(() => !!document.getElementById('gz-skel') || !!document.querySelector('[data-gz-press], [data-gz-skel-host]') || document.documentElement.hasAttribute('data-gz-skel'))), 'on: nothing left behind');
    // An instant copy coming in takes its place at once.
    await on.page.evaluate(() => { window.__delay = 5000; });
    await on.page.evaluate((a) => window.__feel.arm(a), { find: 'bar', arg: 'grades', anchor: 'article.course-element-card', dest: '#gz-instant' });
    const gp = await until(() => on.page.evaluate(() => window.__feel.hits()), 'Grades under the pointer');
    await on.page.mouse.click(gp.x, gp.y);
    await until(() => on.page.evaluate(() => !!document.getElementById('gz-skel')), 'a skeleton for Grades');
    await until(() => on.page.evaluate(() => [...document.querySelectorAll('div.spinner')].length > 0), 'Ultra\'s spinners under it');
    if (out) await on.page.screenshot({ path: path.join(out, 'feel-skeleton-tiles.png') });
    const spinHidden = await on.page.evaluate(() => [...document.querySelectorAll('div.spinner')].every((s) => getComputedStyle(s).visibility === 'hidden'));
    check(spinHidden, 'on: Ultra\'s spinners hidden while the skeleton shows');
    const yielded = await on.page.evaluate(() => new Promise((r) => {
      const c = Object.assign(document.createElement('div'), { id: 'gz-instant' });
      document.querySelector('main.bb-offcanvas-container').append(c);
      requestAnimationFrame(() => { const gone = !document.getElementById('gz-skel'); c.remove(); r(gone); });
    }));
    check(yielded, 'on: an instant copy coming in takes the skeleton\'s place by the next frame');
    await on.page.evaluate(() => { window.__delay = 600; });
    await until(() => on.page.evaluate(() => !window.__loading), 'Grades in');
    check(on.errors.length === 0, 'on: no page errors', on.errors);
    // The standby, where course tabs keep one: never a skeleton or a press there.
    const standby = on.page.frames().find((f) => f.name() === 'gz-ctab:standby');
    if (standby) check(!(await standby.evaluate(() => !!document.getElementById('gz-skel') || !!document.querySelector('[data-gz-press]'))), 'on: nothing in the standby');
    evidence.standby = !!standby;
    if (out) await on.page.screenshot({ path: path.join(out, 'feel-on-end.png') });
    await on.page.close();

    // ---- Glaze off, then the switch off: Ultra as it is ----
    await set({ enabled: false, feedback: true });
    const off = await tour('off');
    for (const r of off.runs) check(!r.everSkel && !r.everPress && r.everSpin, `off, ${r.what}: no skeleton, no press, Ultra's spinners`);
    await off.page.close();
    await set({ enabled: true, feedback: false });
    const sw = await tour('switch off');
    for (const r of sw.runs) check(!r.everSkel && !r.everPress && r.everSpin, `switch off, ${r.what}: no skeleton, no press, Ultra's spinners`);
    await sw.page.close();
    await set({ enabled: true, feedback: true });

    // ---- on against off ----
    const median = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
    const sum = (runs) => ({ pressToItemMs: median(runs.map((r) => r.downToItem?.ms)), clickToMainMs: median(runs.map((r) => r.clickToMain?.ms)), pressToMainMs: median(runs.map((r) => r.downToMain?.ms)), clickToReadyMs: median(runs.map((r) => r.clickToReady?.ms)), shift: Math.max(...runs.map((r) => r.shift)) });
    evidence.summary = { on: sum(on.runs), off: sum(off.runs), switchOff: sum(sw.runs) };
    // A course's tab and the main menu (Glaze's bar clicks Ultra's own link): the first painted change no later than two
    // frames after Ultra's own.
    for (const i of [0, 1, 2, 3]) {
      const a = on.runs[i], b = off.runs[i], slack = 2 * Math.max(a.frameMs, b.frameMs);
      check(a.clickToMain && a.clickToMain.ms <= b.clickToMain.ms + slack, `${a.what}: click → first painted change within 2 frames of Glaze off`, { on: a.clickToMain, off: b.clickToMain, slack, heldFrames: a.heldFrames });
    }
    // Each click of the tour with Glaze on, once the controls are in.
    for (const r of on.runs) {
      check(r.downToItem?.frame === 1, `on, ${r.what}: the item looks current in the first frame after the press`, r.downToItem);
      check(r.clickToSkel?.frame === 1, `on, ${r.what}: the skeleton is in the first frame after the click`, r.clickToSkel);
      check(r.skelBesideSpin === 0, `on, ${r.what}: Ultra's spinners never show beside it`, { skelBesideSpin: r.skelBesideSpin });
      check(r.readyShown && r.skelAfterIn <= 1, `on, ${r.what}: it goes with the page's view in`, { skelAfterIn: r.skelAfterIn });
      check(r.shift <= 0.01, `on, ${r.what}: layout shift <= 0.01`, { shift: r.shift });
    }
    for (const i of on.runs.keys()) check(on.runs[i].clickToMain.ms < off.runs[i].clickToMain.ms, `${on.runs[i].what}: the main area answers sooner with Glaze on`, { on: on.runs[i].clickToMain, off: off.runs[i].clickToMain });
    check(evidence.summary.on.shift <= Math.max(0.01, evidence.summary.off.shift), 'no more layout shift with Glaze on than off', evidence.summary);
    console.log(JSON.stringify(evidence.summary));
    console.log(`${checks} feel checks passed`);
  } catch (e) {
    evidence.error = String(e?.stack || e);
    throw e;
  } finally {
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'ultra-feel.json'), JSON.stringify(evidence, null, 2)); }
    if (context) await context.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmdirSync(lock);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
