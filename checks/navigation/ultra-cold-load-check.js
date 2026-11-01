// A cold load of Blackboard Ultra shows one calm state (navigation/page/feedback.js boot, enhance.feedback) with the real
// unpacked extension, on the synthetic Ultra booting as live (test/fixtures/ultra-feel.html with Ultra's boot screen first in
// its body: the grey cover and its spinner, nothing of the app for a while, its Institution page first, then the address's
// page through its spinners), on a school's own host (in a fresh tab Glaze's sheets come after its first paint; once Glaze
// themed it in the tab they block it, as on Blackboard's own hosts) and on a Blackboard host. Every frame from the document's
// first until the page's view is shown says which loading indicators show (Ultra's boot screen, its spinners, Glaze's
// skeletons, a course tab's stand-in), whether a grey or near-white box is painted over the main area, whether Ultra's first
// view of another page shows, and whether the instant copy and Ultra's own view show at once. Grades cold in a fresh tab,
// Grades again (its copy), a course's Content, a course tab's frame booting cold, Grades on a Blackboard host, and the switch
// off (Ultra as it is).
// Waits on state, never on a pause. No real LMS.
// [EXT=<extension dir>] [COLD_REPORT=1] node checks/navigation/ultra-cold-load-check.js <evidence dir>
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const env = require('../../tools/dev/check-env.js');
const source = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const out = process.argv[2];
const D = require(path.join(source, 'content/defaults.js'));
const ORIGIN = 'https://ultra.cold.test', BUILT_IN = 'https://cold.blackboard.com', COURSE = '_101_1';
const extensionId = (dir) => [...crypto.createHash('sha256').update(dir).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
// Ultra's boot screen as live has it (glaze-plans/release-4.0.1/cold-load/inventory.md): absolute over the window, z-index
// 999999, rgb(38, 38, 38), its spinner fixed at the centre and drawn on ::after; .fade-out fades it before it goes.
const BOOT_SCREEN = '<div id="initial-load-area" class="mode-light"><style>#initial-load-area { position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 999999; background: rgb(38, 38, 38); transition: opacity .4s; } #initial-load-area.fade-out { opacity: 0; } #initial-load-area div.spinner { position: fixed; top: 50%; left: 50%; width: 0; height: 0; margin: 0; border: 0; } #initial-load-area div.spinner::after { content: ""; position: absolute; width: 44px; height: 44px; margin: -22px; box-sizing: border-box; border: 3px solid #ddd; border-top-color: transparent; border-radius: 50%; }</style><div class="spinner scale-bounce-in bb-secondary-color-2"></div></div>';
const FIXTURE = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-feel.html'), 'utf8').replace('<body>', `<body>${BOOT_SCREEN}`);
const MARK = { grades: 'bb-base-grades-student .base-grades-course-tile', outline: '.course-outline-content-list .content-list-item' };

// In each document's world from its first script (frames too): every frame until the view is shown.
function probe() {
  if (!/^\/ultra/.test(location.pathname)) return;
  const R = window.__cold = { frames: [], done: false };
  const opacity = (e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none') return 0; o *= +s.opacity; } return o; };
  const shows = (e) => !!e && e.isConnected && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible' && opacity(e) > 0.05;
  const rgba = (c) => { const v = (c.match(/[\d.]+/g) || []).map(Number); return v.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 1] : null; };
  // What paints at a point over the main area: the topmost element hit with a background colour of its own (a Glaze
  // surface, the Look's own background image or anything Ultra paints), and whether it is grey or near white.
  const painted = (x, y) => {
    for (const e of document.elementsFromPoint(x, y)) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none' && e !== document.body && e !== document.documentElement) return null;
      const c = rgba(s.backgroundColor);
      if (!c || c[3] * opacity(e) < 0.3) { if (e === document.documentElement || e === document.body) return null; continue; }
      const [r, g, b] = c, grey = Math.max(r, g, b) - Math.min(r, g, b) <= 12;
      return grey ? `${e.id ? `#${e.id}` : e.localName}${typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/)[0]}` : ''} ${s.backgroundColor}` : null;
    }
    return null;
  };
  const frame = () => {
    if (R.done) return;
    const kinds = [];
    const ila = document.getElementById('initial-load-area');
    if (shows(ila)) kinds.push('ultra boot screen');
    if ([...document.querySelectorAll('div.spinner')].some((e) => !e.closest('#initial-load-area') && shows(e))) kinds.push('ultra spinners');
    if (shows(document.getElementById('gz-skel'))) kinds.push('glaze skeleton');
    if (shows(document.getElementById('gz-boot'))) kinds.push('glaze boot skeleton');
    if ([...document.querySelectorAll('.gz-ctabs-pic')].some(shows)) kinds.push('course tab stand-in');
    const copy = document.getElementById('gz-instant'), copyShown = shows(copy);
    const mark = window.__coldMark && [...document.querySelectorAll(window.__coldMark)].some((e) => !e.closest('#gz-instant') && shows(e));
    const live = [...document.querySelectorAll('main .route-view-container, main .course-tool-content > *')].some((e) => !e.closest('#gz-instant') && !e.id?.startsWith('gz-') && shows(e) && e.textContent.trim());
    // Another page's view on top at a point over the main area (Ultra keeps its base page under a course's panel).
    const top = (x, y) => document.elementsFromPoint(x, y).find((e) => !e.closest('#initial-load-area') && opacity(e) > 0.05);
    const wrong = !/institution-page/.test(location.pathname) && [0.3, 0.45, 0.6].some((fx) => [0.35, 0.55, 0.75].some((fy) => !!top(innerWidth * fx, innerHeight * fy)?.closest('section.institution-page-container')));
    const grey = [], loaded = mark && !document.documentElement.hasAttribute('data-gz-boot') && !copyShown;
    if (!loaded) for (const fx of [0.3, 0.45, 0.6]) for (const fy of [0.35, 0.55, 0.75]) { const p = painted(innerWidth * fx, innerHeight * fy); if (p) grey.push(p); }
    const sheet = [...document.querySelectorAll('link[href$="content/extras.css"]')].some((l) => /-extension:$/.test(new URL(l.href).protocol) && !!l.sheet);
    R.frames.push({ t: Math.round(performance.now()), sheet, kinds, copy: copyShown, live, both: copyShown && live, wrong, grey, mark: !!mark, boot: document.documentElement.hasAttribute('data-gz-boot') });
    if (mark && !document.documentElement.hasAttribute('data-gz-boot') && !copyShown && !ila) R.after = (R.after || 0) + 1;
    if (R.after > 10 || R.frames.length > 1500) R.done = true;
  };
  // Sampled just before each paint: a ResizeObserver on a sentinel resized in every frame runs after the page's own
  // animation-frame callbacks and its layout, so each sample is what that frame paints.
  const sentinel = document.createElement('gz-cold-probe');
  sentinel.style.cssText = 'position: fixed; top: 0; left: 0; height: 1px; visibility: hidden; pointer-events: none';
  new ResizeObserver(() => frame()).observe(sentinel);
  let w = 1;
  const tick = () => {
    if (R.done) return;
    if (!sentinel.isConnected) document.documentElement?.append(sentinel);
    sentinel.style.width = `${w = 3 - w}px`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

let checks = 0;
const evidence = { checks: [], loads: {} };
// COLD_REPORT=1: every load and check reported, none stopping the run (a build's before-and-after), exit 1 on any failure.
const report = process.env.COLD_REPORT === '1';
let failed = 0;
const check = (ok, message, data) => {
  evidence.checks.push({ ok: !!ok, message, data });
  if (!ok && !report) throw Error(`${message} ${data ? JSON.stringify(data) : ''}`);
  if (ok) checks++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}${ok ? '' : ` ${JSON.stringify(data ?? '')}`}`);
};
// Polled from Node: waitForFunction resolves at once on an async predicate.
const until = async (f, what, timeout = 20000) => {
  for (const end = Date.now() + timeout; ; await new Promise((r) => setTimeout(r, 25))) {
    const v = await Promise.resolve().then(f).catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw Error(`timed out: ${what}`);
  }
};
// A load's frames, summed: the most indicators at once, and the frames with a grey box, the wrong page or the copy beside
// Ultra's view.
const sum = (frames) => ({
  frames: frames.length, ms: frames.length ? frames.at(-1).t - frames[0].t : 0,
  maxKinds: Math.max(0, ...frames.map((f) => f.kinds.length)), kinds: [...new Set(frames.flatMap((f) => f.kinds))],
  bootScreenWithSheet: frames.filter((f) => f.sheet && f.kinds.includes('ultra boot screen')).length,
  bootScreenFrames: frames.filter((f) => f.kinds.includes('ultra boot screen')).length, firstSheet: frames.find((f) => f.sheet)?.t ?? null,
  atOnce: frames.filter((f) => f.kinds.length > 1).map((f) => `${f.t}: ${f.kinds.join(' + ')}`).slice(0, 5),
  grey: frames.filter((f) => f.grey.length).map((f) => `${f.t}: ${f.grey[0]}`).slice(0, 5), greyFrames: frames.filter((f) => f.grey.length).length,
  wrongFrames: frames.filter((f) => f.wrong).length, bothFrames: frames.filter((f) => f.both).length, copyFrames: frames.filter((f) => f.copy).length,
  bootFrames: frames.filter((f) => f.boot).length, shown: frames.some((f) => f.mark && !f.boot),
  // Once Glaze's state shows (a skeleton or the copy), a frame of neither it nor Ultra's view: a blink.
  blank: (() => { const i = frames.findIndex((f) => f.copy || f.kinds.some((k) => k.startsWith('glaze'))); return i < 0 ? 0 : frames.slice(i).filter((f) => !f.copy && !f.live && !f.kinds.length).length; })(),
});

(async () => {
  let context, held = false;
  const lock = require('../../tools/dev/check-env.js').lockPath(), scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-cold-')));
  if (out) fs.mkdirSync(out, { recursive: true });
  try {
    fs.mkdirSync(lock); held = true;
    const ext = env.staged(source, [`${ORIGIN}/*`, `${BUILT_IN}/*`]);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(20000);
    env.noFirstRun(context);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin !== ORIGIN && u.origin !== BUILT_IN) return r.abort();
      if (/^\/ultra(\/|$)/.test(u.pathname)) return r.fulfill({ contentType: 'text/html', body: FIXTURE });
      if (u.pathname === '/learn/api/v1/users/me') return r.fulfill({ json: { id: '_900_1', userName: 'student', givenName: 'Sam', familyName: 'Student' } });
      if (u.pathname.startsWith('/learn/api/')) return r.fulfill({ json: { results: [], paging: {} } });
      return r.abort();
    });
    const opts = await context.newPage();
    await opts.goto(`chrome-extension://${extensionId(ext)}/options.html`);
    await env.installed(opts);
    await opts.evaluate(async (defaults) => { await chrome.storage.sync.set(defaults); await chrome.storage.local.set({ ultra: ['https://ultra.cold.test'] }); }, D.GZ_DEFAULTS);
    await env.ultraReady(opts);
    const set = (feedback) => opts.evaluate(async (on) => { const { enhance } = await chrome.storage.sync.get('enhance'); await chrome.storage.sync.set({ enhance: { ...enhance, feedback: on } }); }, feedback);

    // One cold load in a fresh tab (or a reload of `page`), followed in `where` (the page, or a frame by name) until its
    // view shows; a picture while it boots.
    const load = async (name, at, mark, { page = null, frame = '', origin = ORIGIN } = {}) => {
      const p = page || await context.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      if (!page) await p.addInitScript(probe);
      await p.addInitScript((m) => { window.__coldMark = m; }, mark);
      if (frame) {
        await p.goto(`${origin}/ultra/course`);
        await until(() => p.evaluate(() => !window.__loading), 'the page around');
        await p.evaluate(({ name, src }) => { const f = document.createElement('iframe'); f.name = name; f.src = src; f.style.cssText = 'position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; z-index: 2147483647'; document.body.append(f); }, { name: frame, src: origin + at });
      } else if (page && page.url() === origin + at) await p.reload();
      else await p.goto(origin + at);
      const where = () => (frame ? p.frames().find((f) => f.name() === frame) : p.mainFrame());
      await until(() => where()?.evaluate(() => !!window.__cold), `${name}: its probe`);
      if (out) {
        const booting = await until(() => where().evaluate(() => (document.documentElement.hasAttribute('data-gz-boot') || window.__cold.frames.some((f) => f.mark) ? 'in' : '')), `${name}: booting`, 15000).catch(() => '');
        if (booting) await p.screenshot({ path: path.join(out, `${name}-booting.png`) });
      }
      await until(() => where().evaluate(() => window.__cold.done), `${name}: its view shown`, 30000).catch(async (e) => {
        if (out) await p.screenshot({ path: path.join(out, `${name}-fail.png`) });
        throw Error(`${e.message} ${JSON.stringify(await where()?.evaluate(() => window.__cold.frames.at(-1)).catch(() => null))}`);
      });
      if (out) await p.screenshot({ path: path.join(out, `${name}-shown.png`) });
      const frames = await where().evaluate(() => window.__cold.frames);
      const s = { ...sum(frames), errors };
      evidence.loads[name] = { ...s, frames };
      console.log(`${name.padEnd(22)} ${s.frames} frames ${s.ms} ms; most indicators at once ${s.maxKinds} [${s.kinds.join(', ')}]; Ultra's boot screen ${s.bootScreenFrames} (with Glaze's sheet in ${s.bootScreenWithSheet}, sheet from ${s.firstSheet} ms); grey ${s.greyFrames}; wrong page ${s.wrongFrames}; copy beside Ultra ${s.bothFrames}; blank ${s.blank}; copy ${s.copyFrames}; boot ${s.bootFrames}`);
      return { page: p, s };
    };
    // fresh: a fresh tab on a school's own host, where Ultra's boot screen paints until Glaze's sheet is in (and only then).
    const calm = (name, s, fresh = false) => {
      check(s.maxKinds <= 1, `${name}: at most one loading indicator in any frame`, { atOnce: s.atOnce, kinds: s.kinds });
      check(!s.kinds.includes('ultra spinners'), `${name}: none of Ultra's spinners`, s.kinds);
      if (fresh) check(s.bootScreenWithSheet === 0, `${name}: Ultra's boot screen gone the frame Glaze's sheet is in`, { frames: s.bootScreenFrames, sheetAt: s.firstSheet });
      else check(s.bootScreenFrames === 0, `${name}: Ultra's boot screen never paints`, { frames: s.bootScreenFrames, sheetAt: s.firstSheet });
      const grey = fresh ? evidence.loads[name].frames.filter((f) => f.sheet && f.grey.length).length : s.greyFrames;
      check(grey === 0, `${name}: no grey or near-white box over the main area${fresh ? ' once Glaze\'s sheet is in' : ''}`, s.grey);
      check(s.wrongFrames === 0, `${name}: Ultra's first view of another page never shows`, s.wrongFrames);
      check(s.bothFrames === 0, `${name}: never the copy and Ultra's view at once`, s.bothFrames);
      check(s.blank === 0, `${name}: no blank frame between Glaze's state and the page`, s.blank);
      check(s.shown, `${name}: the page's view shown`);
      check(s.errors.length === 0, `${name}: no page errors`, s.errors);
    };

    const grades = await load('grades-cold', '/ultra/grades', MARK.grades);
    calm('grades-cold', grades.s, true);
    check(grades.s.kinds.includes('glaze boot skeleton') && grades.s.bootFrames > 0, 'grades-cold: Glaze\'s skeleton while it boots', grades.s.kinds);
    // The copy kept as that page went: the next load paints it.
    const again = await load('grades-copy', '/ultra/grades', MARK.grades, { page: grades.page });
    calm('grades-copy', again.s);
    check(again.s.copyFrames > 0, 'grades-copy: the instant copy shows while it boots', again.s.copyFrames);
    const outline = await load('outline-cold', `/ultra/courses/${COURSE}/outline`, MARK.outline, { page: again.page });
    calm('outline-cold', outline.s);
    await outline.page.close();
    const tab = await load('course-tab-frame-cold', `/ultra/courses/${COURSE}/outline`, MARK.outline, { frame: `gz-ctab:${COURSE}` });
    calm('course-tab-frame-cold', tab.s);
    await tab.page.close();
    const bb = await load('grades-blackboard-host', '/ultra/grades', MARK.grades, { origin: BUILT_IN });
    calm('grades-blackboard-host', bb.s);
    await bb.page.close();
    // The switch off: Ultra's boot screen and spinners as they are without Glaze's.
    await set(false);
    const off = await load('grades-switch-off', '/ultra/grades', MARK.grades);
    check(off.s.kinds.includes('ultra boot screen') && off.s.bootFrames === 0 && !off.s.kinds.includes('glaze boot skeleton'), 'switch off: Ultra\'s boot screen as before, no boot of Glaze\'s', off.s.kinds);
    await off.page.close();
    await set(true);
    console.log(`${checks} cold-load checks passed${failed ? `, ${failed} failed` : ''}`);
    if (failed) process.exitCode = 1;
  } catch (e) {
    evidence.error = String(e?.stack || e);
    throw e;
  } finally {
    if (out) fs.writeFileSync(path.join(out, 'ultra-cold-load.json'), JSON.stringify(evidence, null, 2));
    if (context) await context.close();
    fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmdirSync(lock);
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
