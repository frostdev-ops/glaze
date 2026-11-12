// Real unpacked extension on Blackboard's Activity page (cards shaped as stream-colors-check's, from the owner's site
// 2026-11-07: the course's link in .context, the item's name with no link). The planner answer comes the way the card tasks
// get it on Ultra (courses/ultra.js page.due): Blackboard's memberships, calendar and the course's gradebook, in the
// fixtures' shapes (test/fixtures/ultra-memberships.json, ultra-calendar-items.json, ultra-grades-status.json). Each card
// naming an assignment says where it stands, in the card tasks' words and chip; the rest say nothing; stream.status off
// takes them away and on brings them back.
// NODE_PATH=<playwright node_modules> node checks/courses/stream-status-check.js [evidence-directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ext = require('../../tools/dev/check-env.js').staged(path.join(__dirname, '../../extension'), ['https://bb.school.test/*']), G = require(path.join(ext, 'content/defaults.js'));
const site = 'https://bb.school.test', out = process.argv[2], lock = require('../../tools/dev/check-env.js').lockPath();
const fixture = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../test/fixtures', f), 'utf8'));
const DAY = 864e5, now = Date.now();
// code: the course line as the owner's cards have it (2026-11-11), the course ID with no link, and the name "Past due: <title>".
const card = (id, course, name, code = false) => `<li id="${id}" class="stream-item-container"><div class="stream-item"><div class="stream-item-contents"><div class="element-card stream-panel-activity-card"><div class="element-image stream-panel-activity-icon"></div><div class="element-details${course ? ' course-color-3' : ''}"><div class="timestamp"><div><div class="js-split-datetime"><span class="date">Nov 10</span></div></div></div><div class="context">${code ? 'FA26-BIO1100-01' : course ? `<a href="${site}/ultra/courses/${course}/outline"><span>BIO 1100: Biology I</span></a>` : 'School notice'}</div><div class="name"><ng-switch><span>${name}</span></ng-switch></div></div></div></div></div></li>`;
const page = `<!doctype html><html lang="en-US"><head><meta charset="utf-8"><base href="https://cdn.school.test/ultra/"><style>body{font:16px system-ui;padding:24px}.element-card{display:flex;padding:20px;border:1px solid}.stream-item-container{margin-bottom:28px;list-style:none}</style></head><body><div id="site-wrap"><section class="js-base-stream-container route-view-container"><h1>Activity Stream</h1><div id="activity-stream" class="activity-stream"><div class="activity-group"><h2 class="activity-group-title">Upcoming</h2><ul class="activity-feed">${
  card('graded', '_101_1', 'Essay 1')}${card('late', '_101_1', 'Essay 2')}${card('missing', '_101_1', 'Past due: Essay 3', true)}${card('open', '_101_1', 'Essay 4')}${card('notice', '_101_1', 'Welcome to Biology')}${card('nocourse', '', 'Essay 1')}</ul></div></div></section></div></body></html>`;
// Blackboard's answers: the essays due around now, each joined to its gradebook row by its column. The rows are the
// fixture's (Essay 2 handed in after its due date, Essay 3 unopened past it), and Essay 4 is Essay 3's row due next week.
const shape = fixture('ultra-calendar-items.json').results.find((i) => /\.GradableItem$/.test(i.itemSourceType) && !/forumlink/.test(i.dynamicCalendarItemProps?.handle || ''));
const calendar = [['_611_1', 'Essay 1', -2], ['_612_1', 'Essay 2', -1], ['_613_1', 'Essay 3', -1], ['_614_1', 'Essay 4', 7]].map(([itemSourceId, title, d]) => ({ ...shape, itemSourceId, calendarId: '_101_1', title, startDate: new Date(now + d * DAY).toISOString(), endDate: new Date(now + d * DAY).toISOString() }));
const api = (p) => {
  if (p.endsWith('/users/me')) return { id: '_900_1', userName: 'student' };
  if (/\/users\/_900_1\/memberships$/.test(p)) return fixture('ultra-memberships.json');
  if (/calendars\/calendarItems$/.test(p)) return { results: calendar, paging: { nextPage: '' } };
  if (/courses\/_101_1\/gradebook\/grades$/.test(p)) {
    const g = fixture('ultra-grades-status.json'), three = g.results.find((r) => r.columnId === '_613_1');
    g.results.push({ ...three, columnId: '_614_1', column: { ...three.column, contentId: '_714_1', columnName: 'Essay 4', dueDate: new Date(now + 7 * DAY).toISOString() } });
    return g;
  }
  return { results: [] };
};
let checks = 0;
const check = (ok, message) => { if (!ok) throw Error(message); checks++; console.log(`ok ${message}`); };
(async () => {
  let context, tmp, held = false;
  const errors = [];
  try {
    fs.mkdirSync(lock); held = true; tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-stream-status-'));
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
      headless: true, ...require('../../tools/dev/check-env.js').chromeLaunch(), viewport: { width: 1200, height: 900 },
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'],
    });
    context.setDefaultTimeout(15000);
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      if (u.origin === site && u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: page });
      if (u.origin === site && u.pathname.includes('/learn/api/')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(api(u.pathname)) });
      return r.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false });
    // The course list as content-ultra.js keeps it from Blackboard's memberships (its course ID as code).
    const seenCourses = { _101_1: { name: 'BIO 1100: Biology I', code: 'FA26-BIO1100-01', site, slot: '3' } };
    await worker.evaluate(async ({ settings, site, seenCourses }) => { await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site], seenCourses, [`seenCoursesAt ${site}`]: Date.now() }); }, { settings, site, seenCourses });
    const tab = await context.newPage(); tab.on('pageerror', (e) => errors.push(e.message));
    await tab.goto(`chrome-extension://${id}/popup.html`);
    await require('../../tools/dev/check-env.js').ultraReady(tab);
    await tab.goto(`${site}/ultra/stream`);
    const words = () => tab.evaluate(() => Object.fromEntries([...document.querySelectorAll('.stream-item-container')].map((row) => {
      const s = row.querySelector('.element-details > .name + .gz-stream-status .gz-todo-chip');
      return [row.id, s ? [s.textContent, s.dataset.tone || ''] : null];
    })));
    const want = { graded: ['Graded', 'ok'], late: ['Submitted late', 'warn'], missing: ['Missing', 'err'], open: ['Not submitted', ''], notice: null, nocourse: null };
    const until = async (fn, label, ms = 20000) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw Error(`${label} timed out: ${JSON.stringify(await words())}`); await new Promise((r) => setTimeout(r, 150)); } };
    await until(async () => JSON.stringify(await words()) === JSON.stringify(want), 'the statuses');
    check(true, `each assignment's card says where it stands, in the card tasks' words and tones: ${JSON.stringify(await words())}`);
    check(true, 'an announcement and a card with no course say nothing');
    const look = await tab.evaluate(() => { const c = getComputedStyle(document.querySelector('#graded .gz-todo-chip')); return { radius: parseFloat(c.borderRadius), bg: c.backgroundColor, weight: c.fontWeight }; });
    check(look.radius > 4 && look.bg !== 'rgba(0, 0, 0, 0)' && +look.weight >= 600, `the chip is the card tasks' pill: ${JSON.stringify(look)}`);
    if (out) await tab.locator('#activity-stream').screenshot({ path: path.join(out, 'stream-status.png') });
    await worker.evaluate(async () => { const { stream } = await chrome.storage.sync.get('stream'); await chrome.storage.sync.set({ stream: { ...stream, status: false } }); });
    await until(async () => !(await tab.evaluate(() => document.querySelector('.gz-stream-status'))), 'Submission status off');
    check(true, 'Submission status off: no card says anything');
    await worker.evaluate(async () => { const { stream } = await chrome.storage.sync.get('stream'); await chrome.storage.sync.set({ stream: { ...stream, status: true } }); });
    await until(async () => JSON.stringify(await words()) === JSON.stringify(want), 'Submission status on again');
    check(true, 'on again: the same words');
    await tab.evaluate(() => { for (const e of document.querySelectorAll('.gz-stream-status')) e.gzKept = true; document.querySelector('#activity-stream h2').append(' '); });
    await new Promise((r) => setTimeout(r, 600));
    check(await tab.evaluate(() => { const l = [...document.querySelectorAll('.gz-stream-status')]; return l.length === 4 && l.every((e) => e.gzKept); }), 'a pass over unchanged cards draws nothing again');
    // Another Ultra page first keeps a fresh planner answer (under two minutes old); Activity opened after it, in the app
    // and by a full load, still says where each assignment stands.
    await worker.evaluate(() => chrome.storage.local.remove('todoCache'));
    await tab.goto(`${site}/ultra/course`);
    await until(() => worker.evaluate(async () => !!(await chrome.storage.local.get('todoCache')).todoCache), 'the Courses page keeping its answer');
    await tab.evaluate(() => { history.pushState({}, '', `${location.origin}/ultra/stream`); document.querySelector('#activity-stream h2').append(' '); });
    await until(async () => JSON.stringify(await words()) === JSON.stringify(want), 'Activity in the app after the Courses page');
    check(true, 'Activity opened in the app after another Ultra page: the same words');
    await tab.goto(`${site}/ultra/course`);
    await tab.goto(`${site}/ultra/stream`);
    await until(async () => JSON.stringify(await words()) === JSON.stringify(want), 'Activity loaded after the Courses page');
    check(true, 'Activity loaded after another Ultra page: the same words');
    check(!errors.length, `no page errors ${JSON.stringify(errors)}`);
    console.log(`${checks} checks passed`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
})();
