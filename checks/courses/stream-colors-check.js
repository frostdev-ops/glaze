// Real unpacked extension on Activity cards shaped like the owner's site (2026-11-07): Ultra marks only a card's text
// column with its course's slot (.element-details.course-color-N), beside the icon. Each card's icon, icon tile, divider
// and outline follow its course: by slot, by a course's own color when two share a slot, and raw when not harmonised.
// NODE_PATH=<playwright node_modules> node checks/courses/stream-colors-check.js [evidence-directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('../../tools/dev/check-env.js');
const ext = env.staged(path.join(__dirname, '../../extension'), ['https://bb.school.test/*']), G = require(path.join(ext, 'content/defaults.js'));
const site = 'https://bb.school.test', out = process.argv[2], lock = env.lockPath();
const card = (id, slot, course, name) => `<li id="${id}" class="stream-item-container"><div class="stream-item"><div class="stream-item-contents"><div class="element-card stream-panel-activity-card"><ng-switch><div class="element-image stream-panel-activity-icon"><ng-switch><bb-ui-content-icon><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 3h14v18H5z" fill="none" stroke="currentColor" stroke-width="2"></path></svg></bb-ui-content-icon></ng-switch></div></ng-switch><div class="element-details${slot ? ` course-color-${slot}` : ''}"><div class="timestamp"><div><div class="js-split-datetime"><span class="date">Oct 20</span></div></div></div><div class="context">${course ? `<a href="${site}/ultra/courses/${course}/outline"><span>Sample course ${course}</span></a>` : 'School notice'}</div><div class="name"><ng-switch><span>${name}</span></ng-switch></div></div></div></div></div></li>`;
const fixture = `<!doctype html><html lang="en-US"><head><base href="https://cdn.school.test/ultra/"><style>body{font:16px system-ui;padding:24px}.element-card{display:flex;padding:20px;border:1px solid}.element-details{border-left:2px solid}.stream-item-container{margin-bottom:28px;list-style:none}</style></head><body><div id="site-wrap"><section class="js-base-stream-container route-view-container"><h1>Activity Stream</h1><div id="activity-stream" class="activity-stream"><div class="activity-group"><h2 class="activity-group-title">Upcoming</h2><ul class="activity-feed">${card('own', 3, '_200_1', 'Practice essay')}${card('shared', 3, '_101_1', 'Practice quiz')}${card('other', 10, '_300_1', 'Discussion')}${card('none', 0, '', 'Library hours')}</ul></div></div></section></div></body></html>`;
// Two courses in slot 3: the newer (_200_1) keeps it, the older takes the first slot no course holds (1).
const seenCourses = { _200_1: { name: 'A', slot: '3', site }, _101_1: { name: 'B', slot: '3', site }, _300_1: { name: 'C', slot: '10', site } };
let checks = 0;
const check = (ok, message) => { if (!ok) throw Error(message); checks++; console.log(`ok ${message}`); };
(async () => {
  let context, tmp, held = false;
  const errors = [];
  try {
    fs.mkdirSync(lock); held = true; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stream-colors-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      headless: true, ...env.chromeLaunch(), viewport: { width: 1200, height: 800 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(12000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: fixture });
      if (u.origin === site && u.pathname.endsWith('/users/me')) return r.fulfill({ contentType: 'application/json', body: '{"id":"_42_1"}' });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return r.fulfill({ contentType: 'application/json', body: '{"results":[]}' });
      return r.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false });
    await worker.evaluate(async ({ settings, site, seenCourses }) => {
      await chrome.storage.sync.set(settings);
      await chrome.storage.local.set({ ultra: [site], seenCourses, [`seenCoursesAt ${site}`]: Date.now() });
    }, { settings, site, seenCourses });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/popup.html`);
    await worker.evaluate(() => queue);
    await env.ultraReady(page);
    await page.goto(`${site}/ultra/stream`);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#own .element-details')).getPropertyValue('--gz-course-raw').trim() === '#ffe12b');
    // Glaze's own resolution of a course's color, on a probe: the slot's class, plus a course's own color on top.
    const expected = (slot, vars = '') => page.evaluate(([slot, vars]) => {
      const p = document.createElement('i');
      p.className = `course-color-${slot}`;
      p.style.cssText = `${vars};position:absolute;color:var(--gz-course) !important;background:color-mix(in oklab, var(--gz-course) 20%, var(--gz-surface-2)) !important`;
      document.querySelector('#site-wrap').append(p);
      const s = getComputedStyle(p), r = { color: s.color, tile: s.backgroundColor };
      p.remove();
      return r;
    }, [slot, vars]);
    const seen = (row) => page.evaluate((row) => {
      const c = document.querySelector(`#${row} .stream-panel-activity-card`), cs = getComputedStyle(c);
      const icon = getComputedStyle(c.querySelector('.element-image')), svg = getComputedStyle(c.querySelector('.element-image svg'));
      return { icon: svg.color, tile: icon.backgroundColor, divider: getComputedStyle(c.querySelector('.element-details')).borderLeftColor, outline: cs.borderTopColor };
    }, row);
    // content-ultra.js paints a course's own color on its slot elements once the course list is read.
    await page.waitForFunction(() => document.querySelector('#shared .element-details')?.style.getPropertyValue('--gz-course-raw'));
    const accent = await page.evaluate(() => { const p = document.createElement('i'); p.style.setProperty('color', 'var(--gz-accent)', 'important'); document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    // A card of no course: the outline every other card has.
    const plain = await page.evaluate(() => { const p = document.createElement('div'); p.className = 'element-card'; p.style.border = '1px solid'; document.querySelector('#site-wrap').append(p); const c = getComputedStyle(p).borderTopColor; p.remove(); return c; });
    const own = await expected(3), shared = await expected(3, '--gz-pick: initial; --gz-course-raw: #c473d4'), other = await expected(10);
    check(new Set([own.color, shared.color, other.color, accent]).size === 4, `the three courses and the accent are four colors (${own.color}, ${shared.color}, ${other.color}, ${accent})`);
    for (const [row, want] of [['own', own], ['shared', shared], ['other', other]]) {
      const got = await seen(row);
      check(got.icon === want.color, `${row}: the icon is its course's color (${got.icon}, want ${want.color})`);
      check(got.tile === want.tile, `${row}: the icon tile is its course's tint (${got.tile}, want ${want.tile})`);
      check(got.divider === want.color, `${row}: the divider is its course's color (${got.divider})`);
      check(got.outline !== plain, `${row}: the outline leans to its course's color (${got.outline}, plain ${plain})`);
    }
    check(await page.evaluate(() => document.querySelector('#shared .stream-panel-activity-card').style.getPropertyValue('--gz-course-raw') === '#c473d4'), 'a course sharing a slot carries its own color on its card');
    // A card of no course looks as every card did before: the accent's icon and tile, the plain divider and outline.
    const none = await seen('none'), soft = await page.evaluate(() => { const p = document.createElement('i'); p.style.setProperty('color', 'var(--gz-accent-soft)', 'important'); document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
    check(none.icon === accent && none.tile === soft, `a card of no course keeps the accent's icon and tile (${none.icon}, ${none.tile})`);
    check(none.divider === plain && none.outline.replace(/\s/g, '') !== '' && !(await page.evaluate(() => document.querySelector('#none .stream-panel-activity-card').hasAttribute('data-gz-course-slot'))), `a card of no course keeps the plain divider and has no slot (${none.divider}, ${none.outline})`);
    if (out) { fs.mkdirSync(out, { recursive: true }); await page.locator('#activity-stream').screenshot({ path: path.join(out, 'stream-colors-dark.png') }); }
    // Not harmonised: Ultra's own slot colors.
    await worker.evaluate(async (s) => chrome.storage.sync.set({ courses: { ...s.courses, harmonize: false } }), settings);
    await page.waitForFunction(() => document.documentElement.hasAttribute('data-gz-raw-courses'));
    check((await seen('own')).icon === 'rgb(255, 225, 43)', 'unharmonised, the icon is Ultra\'s own slot color');
    check((await seen('shared')).icon === 'rgb(196, 115, 212)', 'unharmonised, a course sharing a slot keeps its own raw color');
    if (out) await page.locator('#activity-stream').screenshot({ path: path.join(out, 'stream-colors-raw.png') });
    await worker.evaluate(async () => chrome.storage.sync.set({ enabled: false }));
    await page.waitForFunction(() => !document.querySelector('[data-gz-course-slot]'));
    check(true, 'turning Glaze off takes the slot off the cards');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    console.log(`${checks} Activity course color checks passed`);
  } finally {
    try { if (context) await context.close(); } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); if (held) fs.rmdirSync(lock); }
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
