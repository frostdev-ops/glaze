// Agent apps' live refresh in a real Chromium (lib/mcp/tabs.js, lib/mcp/tab.js), headless, in a staged copy of the extension
// whose worker carries the wiring handed to lib/background.js (test/helpers/mcp-tabs.cjs WIRING) and a hook for the check
// (the copy's worker is a new file, the checkout's is untouched). Synthetic Canvas and Ultra schools under invented origins,
// every other request aborted and DNS resolving nowhere; Glaze's own page features are off, so every planner and gradebook
// request is the agent read's. Checks: the planner read afresh in the Canvas and the Ultra tab and kept through the page's
// publish path, Insights read afresh while it is on, an assignment read in the tab (its text, files and rubric, through the
// libraries the page loads on demand, and no submission), Canvas's planner mark with the page's CSRF token, no tab for
// another account, a quiz page or no tab at all.
//   NODE_PATH=<playwright> nice -n 10 node scripts/mcp-refresh-check.js [evidence folder]   (EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('./check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const { wired } = require(path.join(root, 'test/helpers/mcp-tabs.cjs'));
const G = require(path.join(root, 'defaults.js'));
const I = require(path.join(root, 'lib/insights.js'));
const CANVAS = 'https://school.instructure.com', ULTRA = 'https://bb.school.test';
const A = `${CANVAS}/5`, UL = `${ULTRA}/_900_1`;
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures', n), 'utf8'));
// The worker's refresh, for the check to call.
const SHIM = `
globalThis.refreshCheck = (account, group) => { if (typeof GZ_MCP_TABS === 'undefined') mcpFiles(); return mcpRefresh(account, group, {}); };
globalThis.tabRun = (account, op, args) => { if (typeof GZ_MCP_TABS === 'undefined') mcpFiles(); return mcpTabs().run(account, op, args, {}); };
globalThis.glazeIn = async (url) => {
  const [t] = (await chrome.tabs.query({})).filter((x) => x.url === url);
  if (!t) return { on: false, why: 'no tab', tabs: (await chrome.tabs.query({})).map((x) => x.url) };
  const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id, frameIds: [0] }, func: () => ({ on: !!globalThis.GZ_CTX?.on(), ctx: typeof globalThis.GZ_CTX }) });
  return r?.result;
};
`;
const now = Date.now(), DAY = 864e5;
const planner = (id, title, days) => ({ plannable_type: 'assignment', plannable_id: id, course_id: 25, context_name: 'BIO 1100', plannable_date: new Date(now + days * DAY).toISOString(),
  html_url: `${CANVAS}/courses/25/assignments/${id}`, plannable: { title }, submissions: { submitted: false, excused: false, graded: false, late: false, missing: false, redo_request: false }, planner_override: null });
const PLANNER = [planner(1, 'Lab report', 2), planner(2, 'Reading response', 5)];
// This term's courses as a student, as Insights reads them (lib/insights.js term), with the local Canvas's gradebooks.
const TERM = { id: 5, name: 'Fall', start_at: new Date(now - 60 * DAY).toISOString(), end_at: new Date(now + 60 * DAY).toISOString() };
const GRADES = fixture('canvas-grades.json').courses;
const COURSES = GRADES.map(({ course }) => ({ ...course, name: course.course_code, term: TERM, enrollments: [{ type: 'student', ...course.enrollment }] }));
// Content.js knows Canvas by its brandable stylesheet.
const DASH = '<!doctype html><html><head><title>Dashboard</title><link rel="stylesheet" href="/dist/brandable_css/check.css"></head><body><div id="application" class="ic-app"><main id="content"><h1>Dashboard</h1></main></div></body></html>';
const QUIZ = '<!doctype html><html><head><title>Quiz</title><link rel="stylesheet" href="/dist/brandable_css/check.css"></head><body><div id="application" class="ic-app"><main id="content"><h1>Quiz</h1></main></div></body></html>';
const ULTRA_PAGE = '<!doctype html><html lang="en"><head><base href="/ultra/"><title>Courses</title></head><body><div id="site-wrap"><main><h1>Courses</h1></main></div></body></html>';
const ultraApi = (u) => {
  const p = u.pathname;
  if (p.endsWith('/users/me')) return { id: '_900_1', userName: 'student' };
  if (/\/memberships$/.test(p)) return fixture('ultra-memberships.json');
  if (/calendars\/todo\/studentItems/.test(p)) return fixture('ultra-todo.json');
  if (/calendars\/calendarItems/.test(p)) return fixture('ultra-calendar-items.json');
  if (/gradebook\/grades$/.test(p)) return fixture('ultra-grades-status.json');
  return { results: [] };
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(100); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
let total = 0, failed = 0;
const results = [];
const check = async (name, test) => {
  total++;
  try { const evidence = await test(); results.push({ name, ok: true, evidence }); console.log(`ok ${name}`); }
  catch (e) { failed++; results.push({ name, ok: false, error: e.stack }); console.error(`FAIL ${name}: ${e.stack}`); }
};

(async () => {
  const lock = require('./check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-refresh-'));
  const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-mcp-refresh'));
  fs.mkdirSync(out, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmcp-refresh-check\n`);
    const ext = require('./check-env.js').staged(root, [`${ULTRA}/*`], scratch);
    // The staged files are hard links to the checkout: replace the worker's, never write through it.
    const worker0 = fs.readFileSync(path.join(ext, 'lib/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'lib/background.js'));
    fs.writeFileSync(path.join(ext, 'lib/background.js'), wired(worker0) + SHIM);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    context.setDefaultTimeout(15000);
    const asked = [], marks = [];
    let uid = '5';
    const CSRF = 'check+token/=';
    await context.addCookies([{ name: '_csrf_token', value: encodeURIComponent(CSRF), domain: 'school.instructure.com', path: '/', secure: true }]);
    await context.route('**/*', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.origin === CANVAS && req.method() === 'POST' && u.pathname === '/api/v1/planner/overrides') {
        marks.push({ headers: req.headers(), body: req.postDataJSON() });
        return json({ id: 901, plannable_id: req.postDataJSON().plannable_id, marked_complete: req.postDataJSON().marked_complete, dismissed: false });
      }
      if (![CANVAS, ULTRA].includes(u.origin) || req.method() !== 'GET') { asked.push(`refused ${req.method()} ${u.href}`); return r.abort(); }
      asked.push(`${u.origin === CANVAS ? 'canvas' : 'ultra'} ${u.pathname}`);
      if (u.origin === ULTRA) return u.pathname.startsWith('/learn/api/') ? json(ultraApi(u)) : r.fulfill({ contentType: 'text/html', body: ULTRA_PAGE });
      if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return json({ id: uid, time_zone: 'UTC' });
      if (u.pathname === '/api/v1/courses') return json(COURSES);
      if (u.pathname === '/api/v1/planner/items') return json(PLANNER);
      if (u.pathname === '/api/v1/courses/25/assignments/171') return json(fixture('canvas-assignment-api.json'));
      const groups = /^\/api\/v1\/courses\/(\d+)\/assignment_groups$/.exec(u.pathname);
      if (groups) return json(GRADES.find((x) => String(x.course.id) === groups[1])?.groups || []);
      if (u.pathname.startsWith('/api/v1/')) return json([]);
      if (u.pathname.endsWith('.css')) return r.fulfill({ contentType: 'text/css', body: '' });
      return r.fulfill({ contentType: 'text/html', body: /\/quizzes\//.test(u.pathname) ? QUIZ : DASH });
    });
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/lib/background.js')) || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), insights: true } });
    // An hour-old planner and a day-old Insights record for the Canvas account, as the page's features kept them.
    const old = now - DAY;
    const record = { [`insights:${A}`]: { ...I.clean({ term: '5', name: 'Fall', from: Date.parse(TERM.start_at), to: Date.parse(TERM.end_at), at: old, courses: [{ id: '27', name: 'MATH 1350', items: [], trend: [] }] }), at: old, cl: 0 } };
    const stale = { todoCache: { key: `todo:${A}`, at: now - 36e5, start: new Date(now - 8 * DAY).toISOString(), end: new Date(now + 8 * DAY).toISOString(), teach: true, progress: true, items: [{ type: 'assignment', id: '9', cid: '25', course: 'BIO 1100', title: 'Old', at: now }], grading: [], sums: {} } };
    await worker.evaluate(async ({ settings, local }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set(local); },
      { settings, local: { ultra: [ULTRA], ...record, ...stale } });
    const opts = await context.newPage();
    await opts.goto(`${base}/popup.html`);
    await env.ultraReady(opts);
    const local = (k) => worker.evaluate((k) => chrome.storage.local.get(k).then((r) => r[k] ?? null), k);
    const refresh = (account, group) => worker.evaluate(([a, g]) => refreshCheck(a, g), [account, group]);
    // Glaze's content script on the page, in its own world.
    let seen = null;
    const ready = async (p) => { await until(async () => (seen = await worker.evaluate((u) => glazeIn(u), p.url().split('#')[0]))?.on, `Glaze on ${p.url()}`).catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(seen)}`); }); };
    const count = (what) => asked.filter((x) => x === what).length;

    const canvas = await context.newPage();
    await canvas.goto(`${CANVAS}/`);
    await ready(canvas);
    await check('Canvas: the planner is read afresh in the account\'s tab and kept through the page\'s publish path', async () => {
      const before = count('canvas /api/v1/planner/items');
      const r = await refresh(A, 'courses');
      assert.deepEqual(r, { ok: true, source: 'tab' });
      const c = await local('todoCache');
      assert.equal(c.key, `todo:${A}`);
      assert.ok(c.at > stale.todoCache.at);
      assert.deepEqual(c.items.map((i) => i.title), ['Lab report', 'Reading response']);
      assert.equal(count('canvas /api/v1/planner/items'), before + 1, 'one planner read, the agent\'s');
      return { refresh: r, at: c.at, titles: c.items.map((i) => i.title) };
    });
    await check('Canvas: Insights is read afresh while it is on, every course of the term', async () => {
      const r = await refresh(A, 'grades');
      assert.deepEqual(r, { ok: true, source: 'tab' });
      const rec = await local(`insights:${A}`);
      assert.ok(rec.at > old);
      assert.deepEqual(rec.courses.map((c) => c.name).sort(), ['BIO 1100', 'ENG 1100', 'HIST 2010', 'MATH 1350']);
      return { refresh: r, at: rec.at, courses: rec.courses.length };
    });
    await check('Canvas: Insights off reads nothing', async () => {
      await worker.evaluate((s) => chrome.storage.sync.set(s), { enhance: { ...settings.enhance, insights: false } });
      await canvas.reload();
      await ready(canvas);
      const n = asked.filter((x) => x.includes('/assignment_groups')).length;
      assert.deepEqual(await refresh(A, 'grades'), { ok: false, source: 'tab' });
      assert.equal(asked.filter((x) => x.includes('/assignment_groups')).length, n);
    });
    await check('Canvas: an assignment read in the tab, its text, its files\' names and its rubric, no submission', async () => {
      const n = asked.length;
      const r = await worker.evaluate(([a]) => tabRun(a, 'assignment', { course: '25', assignment: '171' }), [A]);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.title, 'Lab report 2: Enzyme activity');
      assert.deepEqual(r.files, ['Lab manual.pdf', 'Data sheet.xlsx']);
      assert.deepEqual(r.rubric.criteria.map((c) => c.label), ['Method', 'Analysis']);
      const mine = asked.slice(n).filter((x) => x.startsWith('canvas /api/'));
      assert.deepEqual(mine, ['canvas /api/v1/courses/25/assignments/171']);
      return { title: r.title, files: r.files, criteria: r.rubric.criteria.length, loaded: asked.slice(n).filter((x) => !x.startsWith('canvas /api/')) };
    });
    await check('Canvas: the planner mark goes through the tab with the page\'s CSRF token', async () => {
      const r = await worker.evaluate(([a]) => tabRun(a, 'mark', { type: 'assignment', id: '1', aid: '', ov: '' }), [A]);
      assert.deepEqual(r, { ok: true, ov: { id: '901', done: true, dismissed: false } });
      assert.equal(marks.length, 1);
      assert.deepEqual(marks[0].body, { plannable_id: '1', plannable_type: 'assignment', user_id: '5', marked_complete: true });
      assert.equal(marks[0].headers['x-csrf-token'], CSRF);
      assert.equal(marks[0].headers['x-requested-with'], 'XMLHttpRequest');
      return { answer: r, body: marks[0].body };
    });
    await check('another account\'s tab, or a quiz page, is no tab', async () => {
      uid = '6';
      await canvas.reload();
      await ready(canvas);
      assert.equal(await refresh(A, 'courses'), null, 'signed in as someone else');
      uid = '5';
      await canvas.goto(`${CANVAS}/courses/25/quizzes/3`);
      await pause(500);
      assert.equal(await refresh(A, 'courses'), null, 'a quiz page');
    });
    await canvas.close();
    await check('no tab open: null, and nothing asked of the school', async () => {
      const n = asked.length;
      assert.equal(await refresh(A, 'courses'), null);
      assert.equal(asked.length, n);
    });
    await check('Ultra: the planner is read afresh through lib/ultra.js in the account\'s tab', async () => {
      const ultra = await context.newPage();
      await ultra.goto(`${ULTRA}/ultra/course`);
      await ready(ultra);
      const r = await until(() => refresh(UL, 'courses'), 'the Ultra tab to answer', 15000);
      assert.deepEqual(r, { ok: true, source: 'tab' });
      const c = await local('todoCache');
      assert.equal(c.key, `todo:${UL}`);
      assert.ok(c.items.length > 0);
      await ultra.close();
      return { refresh: r, items: c.items.length };
    });
    assert.deepEqual(asked.filter((x) => x.startsWith('refused')), [], 'nothing else asked');
  } catch (e) {
    failed++; total++;
    console.error(`FAIL setup: ${e.stack}`);
    results.push({ name: 'setup', ok: false, error: e.stack });
  } finally {
    fs.writeFileSync(path.join(out, 'mcp-refresh-check.json'), JSON.stringify({ total, failed, results }, null, 2));
    await context?.close().catch(() => {});
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} checks passed`);
  process.exit(failed ? 1 : 0);
})();
