// Ask Rime's own tools as the student sees them (docs/ai-harness.md "Rime's own tools"), in a real Chromium, headless, the
// extension staged with a stub model under the worker's real broker, tasks, checks, Rime's tools and Glaze's approval window
// (as checks/ai/ask-check.js does). On Canvas and on the synthetic Ultra (test/fixtures/ultra-course.html): a run_js card with
// its value; a place opened and words marked on the page it opens; a reminder waiting on Glaze's window; a reminder that
// fired, shown as a card on the next school page, and its Ask Rime asking about it. 1280 and 320 px, light and dark;
// screenshots rime-<site>-<scene>-<width>-<look>.png, and the approval window's.
//   glaze-remote -e TZ=UTC -o <evidence dir> -- node checks/ai/rime-panel-check.js /out
//   (Mac: NODE_PATH=<playwright> nice -n 10 node checks/ai/rime-panel-check.js [evidence dir]; EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const G = require(path.join(root, 'content/defaults.js'));
const CANVAS = 'https://school.instructure.com', A = `${CANVAS}/5`, ULTRA = 'https://bb.school.test';
const ULTRA_HTML = fs.readFileSync(path.join(__dirname, '../../test/fixtures/ultra-course.html'), 'utf8');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const SHIM = `
globalThis.askCheck = { script: {}, seen: [] };
ai();
if (!GZ_AI_SETTINGS.PROVIDERS.includes('stub')) GZ_AI_SETTINGS.PROVIDERS.push('stub');
GZ_AI_PROVIDERS.add({ id: 'stub', config: (raw) => (raw && typeof raw === 'object' ? { ...raw } : null), caps: () => ({ text: true, json: true }), status: async () => ({ state: 'ready' }),
  run: async (req) => {
    const task = req.task?.id, next = (askCheck.script[task] || []).shift();
    const text = req.messages.map((m) => [].concat(m.content).map((c) => (typeof c === 'string' ? c : c.text || '')).join('')).join('\\n');
    const mark = /\\[result \\d+ todo_mark_done[^\\]]*\\]\\n<<<(DATA-[0-9a-f]+)\\n([\\s\\S]*?)\\n>>>\\1/.exec(text);
    askCheck.seen.push({ task, steps: (text.match(/\\[result \\d+ /g) || []).length, ...(mark && { mark: JSON.parse(mark[2]) }), ...(/\\nthis week \\d{4}-\\d{2}-\\d{2} to /.test(text) && { windows: true }) });
    askCheck.last = text;
    if (!next) throw Object.assign(new Error('script'), { category: 'invalid-response' });
    // { wait, out }: the answer after wait ms (a run caught mid-way for its screenshot).
    if (next.wait) await new Promise((r) => setTimeout(r, next.wait));
    let out = next.wait ? next.out : next;
    // { mark: title }: mark the to-do of that title done, by the type and id the last to-do list gave.
    if (next.mark) {
      const lists = [...text.matchAll(/\\[result \\d+ todo_list[^\\]]*\\]\\n<<<(DATA-[0-9a-f]+)\\n([\\s\\S]*?)\\n>>>\\1/g)];
      const item = lists.length ? JSON.parse(lists.at(-1)[2]).items?.find((i) => String(i.title).includes(next.mark)) : null;
      out = { call: { name: 'todo_mark_done', arguments: item ? { type: item.type, id: String(item.id) } : {} }, answer: null };
    }
    return { text: JSON.stringify(out), model: 'stub', finish: 'stop' };
  } });
globalThis.glazeIn = async (url) => {
  const [t] = (await chrome.tabs.query({})).filter((x) => x.url === url);
  if (!t) return { on: false };
  const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id, frameIds: [0] }, func: () => ({ on: !!globalThis.GZ_CTX?.on() }) });
  return r?.result;
};
`;
const now = Date.now(), DAY = 864e5;
const planner = (id, title, days) => ({ plannable_type: 'assignment', plannable_id: id, course_id: 25, context_name: 'BIO 1100', plannable_date: new Date(now + days * DAY).toISOString(),
  html_url: `${CANVAS}/courses/25/assignments/${id}`, plannable: { title }, submissions: { submitted: false, excused: false, graded: false, late: false, missing: false, redo_request: false }, planner_override: null });
const PLANNER = [planner(1, 'Lab report', 2), planner(2, 'Reading response', 5),
  { ...planner(70, 'Lab moved to Room 204', -1), plannable_type: 'announcement', html_url: `${CANVAS}/courses/25/discussion_topics/70`, submissions: false, plannable: { title: 'Lab moved to Room 204', read_state: 'unread' } }];
// The announcement as Canvas's topic and Ultra's public announcement answer (the fields Glaze's pop-up reads).
const TOPIC = { id: 70, title: 'Lab moved to Room 204', author: { display_name: 'Dr. Rivera' }, posted_at: new Date(now - DAY).toISOString(), message: '<p>This week the lab meets in <b>Room 204</b>. Bring goggles.</p>', attachments: [], read_state: 'unread' };
const ULTRA_NEWS = [{ id: '_801_1', title: 'Lab moved to Room 204', body: '<p>This week the lab meets in Room 204. Bring goggles.</p>', availability: { duration: { type: 'Permanent' } } }];
const DASH = '<!doctype html><html lang="en"><head><title>Dashboard</title><link rel="stylesheet" href="/dist/brandable_css/check.css"></head><body><div id="application" class="ic-app"><main id="content"><h1>Dashboard</h1><p>Biology, history and the week ahead.</p></main></div></body></html>';
const ASSIGNMENTS = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Assignments</title><link rel="stylesheet" href="/dist/brandable_css/check.css"></head><body><div id="application" class="ic-app"><main id="content"><h1>Assignments: BIO 1100</h1>'
  + '<ul class="ig-list"><li><a href="/courses/25/assignments/1">Lab report</a><p>Due in 2 days · 20 pts</p></li><li><a href="/courses/25/assignments/2">Reading response</a><p>Due in 5 days · 10 pts</p></li>'
  + '<li><a href="/courses/25/assignments/3">Cell diagram</a><p>Due next week · 15 pts</p></li></ul></main></div></body></html>';
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
const settingsFor = (preset, bg = 'solid') => G.GZ_SANITIZE({ preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, navbar: { on: false }, footer: false, bg: { kind: bg },
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), palette: true } });
const AI = { on: true, model: { use: 'custom-1', model: 'stub' }, features: { ask: true } };
// Tomorrow at 21:00 in UTC (the check's zone), as the student's clock shows it.
const tomorrow = new Date(now + DAY).toISOString().slice(0, 10);

(async () => {
  const lock = require('../../tools/dev/check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-rime-panel-'));
  const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-rime-panel'));
  fs.mkdirSync(out, { recursive: true });
  let context, held = false;
  const shots = [];
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nrime-panel-check\n`);
    const ext = require('../../tools/dev/check-env.js').staged(root, [`${ULTRA}/*`], scratch);
    const worker0 = fs.readFileSync(path.join(ext, 'background/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'background/background.js'));
    fs.writeFileSync(path.join(ext, 'background/background.js'), worker0 + SHIM);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    context.setDefaultTimeout(15000);
    const asked = [], errors = [];
    // The Sunday scene's planner on Canvas, so the page's own refresh keeps the scenario's items.
    let sunday = null;
    await context.route('**/*', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.origin === ULTRA && req.method() === 'GET') {
        asked.push(u.pathname);
        if (u.pathname.startsWith('/ultra')) return r.fulfill({ contentType: 'text/html', body: ULTRA_HTML });
        if (u.pathname.endsWith('/users/me')) return json({ id: '_42_1' });
        if (u.pathname === '/learn/api/public/v1/courses/_101_1/announcements') return json({ results: ULTRA_NEWS });
        if (u.pathname === '/learn/api/public/v1/courses/_101_1/announcements/_801_1') return json({ ...ULTRA_NEWS[0], created: new Date(now - DAY).toISOString() });
        return json({ results: [] });
      }
      if (u.origin === 'https://cdn.school.test' && u.pathname.endsWith('.css')) return r.fulfill({ contentType: 'text/css', body: '' });
      if (u.origin !== CANVAS || req.method() !== 'GET') { asked.push(`refused ${req.method()} ${u.href}`); return r.abort(); }
      asked.push(u.pathname);
      if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return json({ id: '5', time_zone: 'UTC' });
      if (u.pathname === '/api/v1/planner/items') return json(sunday || PLANNER);
      if (u.pathname === '/api/v1/courses/25/discussion_topics/70') return json(TOPIC);
      if (u.pathname.startsWith('/api/v1/')) return json([]);
      if (u.pathname.endsWith('.css')) return r.fulfill({ contentType: 'text/css', body: '' });
      return r.fulfill({ contentType: 'text/html', body: u.pathname === '/courses/25/assignments' ? ASSIGNMENTS : DASH });
    });
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/background/background.js')) || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, APPROVE = `${base}/agents/approve.html`;
    const plan = { todoCache: { key: `todo:${A}`, at: now - 36e5, start: new Date(now - 8 * DAY).toISOString(), end: new Date(now + 8 * DAY).toISOString(), teach: true, progress: true,
      items: [{ type: 'assignment', id: '1', cid: '25', course: 'BIO 1100', title: 'Lab report', at: now + 2 * DAY },
        { type: 'announcement', id: '70', cid: '25', course: 'BIO 1100', title: 'Lab moved to Room 204', at: now - DAY, read: false }], grading: [], sums: {} } };
    await worker.evaluate(async ({ settings, local }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set(local);
      await GZ_AI_BROKER.vault().set('connections', { 'custom-1': { provider: 'stub', model: 'stub', generation: 'g-1' } });
    }, { settings: settingsFor('Paper'), local: { ultra: [ULTRA], ai: AI, ...plan,
    } });
    // Each school's own records while its scenes run, so Glaze holds one account at a time (with two, Agents' tools want it named).
    const ULTRA_REC = { term: 't', name: 'Fall', from: now - 60 * DAY, to: now + 60 * DAY, at: now - 36e5, courses: [{ id: '_101_1', name: 'BIO 1100', q: false, more: false, items: [], trend: [[now - 7 * DAY, 88]], gp: '' }] };
    const records = (site) => worker.evaluate(({ site, plan, rec, key }) => (site === 'canvas'
      ? chrome.storage.local.remove(key).then(() => chrome.storage.local.set(plan)) : chrome.storage.local.remove('todoCache').then(() => chrome.storage.local.set({ [key]: rec }))),
    { site, plan, rec: ULTRA_REC, key: `insights:${ULTRA}/_42_1` });
    const script = (s) => worker.evaluate((x) => { askCheck.script = x; askCheck.seen = []; }, s);
    const seen = () => worker.evaluate(() => askCheck.seen);

    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    const LOOKS = { light: ['Paper', 'gradient'], dark: ['Midnight', 'gradient'] };
    const look = async (name) => {
      const [preset, bg] = LOOKS[name], ink = G.GZ_PRESETS.find(([n]) => n === preset)[1]['--gz-ink'];
      await worker.evaluate((s) => chrome.storage.sync.set(s), settingsFor(preset, bg));
      await until(() => page.evaluate(({ bg, ink }) => document.documentElement.getAttribute('data-gz-bg') === bg
        && getComputedStyle(document.documentElement).getPropertyValue('--gz-ink').trim().toLowerCase() === ink.toLowerCase(), { bg, ink }), `the ${name} look`);
    };
    const settled = () => page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.('#gz-ask, #gz-ask-fired'))
      .every((a) => a.playState !== 'running' || a.effect.getTiming().iterations === Infinity));
    // Each width and look: the shot, with the panel (or the page's own card) inside the window.
    const snap = async (site, scene, sel, lks = ['light', 'dark']) => {
      const files = [];
      for (const lk of lks) {
        await look(lk);
        for (const [w, h] of [[1280, 860], [320, 640]]) {
          await page.setViewportSize({ width: w, height: h });
          await until(() => page.evaluate(([s, x]) => { const d = document.querySelector(s), r = d?.getBoundingClientRect(); return !!r && r.width > 0 && r.right <= x + 0.5 && r.left >= -0.5; }, [sel, w]), `${sel} inside ${w} px`);
          await until(settled, 'entrances finished');
          const file = path.join(out, `rime-${site}-${scene}-${w}-${lk}.png`);
          await page.screenshot({ path: file });
          files.push(path.basename(file));
        }
      }
      await page.setViewportSize({ width: 1280, height: 860 });
      await look('light');
      shots.push(...files);
      return files;
    };
    const palette = async () => {
      await page.bringToFront();
      await page.keyboard.press(`${MOD}+k`);
      const input = page.locator('#gz-cmd input');
      await input.waitFor({ state: 'visible' });
      await input.fill('Ask Rime');
      await until(() => page.evaluate(() => { const l = [...document.querySelectorAll('#gz-cmd li')]; return l.length > 0 && !l.some((x) => x.classList.contains('gz-cmd-empty') && /Loading/.test(x.textContent)); }), 'the palette\'s rows');
      return page.locator('#gz-cmd li[role="option"]').filter({ has: page.locator('span', { hasText: /^Ask Rime$/ }) });
    };
    const openPanel = async () => {
      if (await page.locator('#gz-ask[open]').count()) return;
      const rows = await until(async () => { const r = await palette(); if (await r.count()) return r; await page.keyboard.press('Escape'); return null; }, 'the Ask Rime row');
      await rows.first().click();
      await page.locator('#gz-ask[open]').waitFor();
    };
    const answers = () => page.locator('#gz-ask .gz-ask-a');
    const ask = async (question) => {
      const n = await answers().count();
      await page.fill('#gz-ask-q', question);
      await page.press('#gz-ask-q', 'Enter');
      return n;
    };
    const answered = async (n, label) => {
      try { await until(async () => (await answers().count()) > n && !await answers().nth(n).getAttribute('data-streaming').then((v) => v !== null), label, 20000); }
      catch (e) {
        const err = await page.locator('#gz-ask .gz-ask-err p, #gz-ask .gz-ask-say').allTextContents().catch(() => []);
        const steps = await page.locator('#gz-ask .gz-ask-step').evaluateAll((l) => l.map((c) => `${c.querySelector('.gz-ask-step-label')?.textContent}:${c.dataset.state}:${c.querySelector('.gz-ask-step-detail')?.textContent || ''}`)).catch(() => []);
        throw new Error(`${e.message}; panel: ${JSON.stringify(err)}; cards: ${JSON.stringify(steps)}; model saw: ${JSON.stringify(await seen().catch(() => null))}`);
      }
      return (await answers().nth(n).locator('.gz-ask-text').allTextContents()).join('').trim();
    };
    const approval = async () => {
      const p = await until(() => context.pages().find((x) => x.url() === APPROVE && !x.isClosed()), 'Glaze\'s approval window');
      await p.waitForFunction(() => document.getElementById('title').textContent.trim() && !document.getElementById('ask').hidden, null, { polling: 50 });
      await p.waitForFunction(() => document.getElementById('yes').getAttribute('aria-disabled') === 'false', null, { polling: 50 });
      return p;
    };
    const goto = async (url) => {
      await page.goto(url);
      await until(() => worker.evaluate((u) => glazeIn(u), page.url().split('#')[0]).then((r) => r?.on), `Glaze on ${url}`, 20000);
    };

    for (const site of ['canvas', 'ultra']) {
      const HOME = site === 'canvas' ? `${CANVAS}/` : `${ULTRA}/ultra/courses/_101_1/outline`;
      if (site === 'ultra') await env.ultraReady(worker);
      await records(site);
      await goto(HOME);

      await check(`${site}: run_js's card shows the value it worked out, and the answer uses it`, async () => {
        await openPanel();
        await script({ 'agent.tools': [{ call: { name: 'run_js', arguments: { code: '(3.2 * 1.609344).toFixed(2)' } }, answer: null }, { call: null, answer: { text: '3.2 miles is 5.15 km.', quotes: ['5.15'] } }] });
        const n = await ask('Convert 3.2 miles to km');
        const text = await answered(n, 'the run_js answer');
        assert.equal(text, '3.2 miles is 5.15 km.');
        const card = page.locator('#gz-ask .gz-ask-step').last();
        assert.equal(await card.locator('.gz-ask-step-label').textContent(), 'Working it out');
        assert.equal(await card.locator('.gz-ask-step-detail').textContent(), '5.15');
        return { text, files: await snap(site, 'run-js', '#gz-ask') };
      });

      await check(`${site}: a reminder waits on Glaze's window with Glaze's own sentence, its card saying so`, async () => {
        await openPanel();
        await page.click('#gz-ask .gz-ask-new');
        await script({ 'agent.tools': [{ call: { name: 'wake_create', arguments: { at: `${tomorrow} 21:00`, say: 'Finish the lab report' } }, answer: null },
          { call: null, answer: { text: 'I will remind you tomorrow at 21:00 to finish the lab report.', quotes: ['Finish the lab report'] } }] });
        const n = await ask('Remind me tomorrow at 9 pm to finish the lab report');
        const win = await approval();
        const title = await win.evaluate(() => document.getElementById('title').textContent);
        assert.match(title, /Finish the lab report/);
        await until(() => page.locator('#gz-ask .gz-ask-step[data-state="ask"]').count(), 'the waiting card');
        await page.bringToFront();
        const files = await snap(site, 'wake-waiting', '#gz-ask');
        if (site === 'canvas') { const f = path.join(out, 'rime-approval-wake.png'); await win.screenshot({ path: f }); files.push(path.basename(f)); shots.push(path.basename(f)); }
        await win.click('#yes');
        const text = await answered(n, 'the answer after Allow');
        const kept = await worker.evaluate(() => chrome.storage.local.get('rimeWakes').then((r) => r.rimeWakes?.wakes?.map((w) => w.say)));
        assert.deepEqual(kept, ['Finish the lab report']);
        return { title, text, files };
      });

      await check(`${site}: a place opened, then the words marked on the page it opened`, async () => {
        await openPanel();
        await page.click('#gz-ask .gz-ask-new');
        const canvas = site === 'canvas';
        await script({ 'agent.tools': canvas
          ? [{ call: { name: 'places_list', arguments: {} }, answer: null }, { call: { name: 'places_list', arguments: { course: '25' } }, answer: null },
            { call: { name: 'place_open', arguments: { place: 'course:25/assignments' } }, answer: null }, { call: { name: 'page_highlight', arguments: { text: 'Lab report', note: 'Due in 2 days' } }, answer: null },
            { call: null, answer: { text: 'Here are your BIO 1100 assignments, with Lab report marked.', quotes: ['BIO 1100 assignments'] } }]
          : [{ call: { name: 'places_list', arguments: {} }, answer: null }, { call: { name: 'place_open', arguments: { place: 'grades' } }, answer: null },
            { call: { name: 'page_highlight', arguments: { text: 'Grades', note: 'Your grades' } }, answer: null }, { call: null, answer: { text: 'Your Grades page is open.', quotes: ['Grades'] } }] });
        const target = canvas ? `${CANVAS}/courses/25/assignments` : `${ULTRA}/ultra/grades`;
        await ask(canvas ? 'Take me to my BIO 1100 assignments and show Lab report' : 'Take me to my grades');
        await page.waitForURL(target, { timeout: 20000 });
        await until(() => worker.evaluate((u) => glazeIn(u), page.url().split('#')[0]).then((r) => r?.on), 'Glaze on the opened page', 20000);
        await until(() => page.locator('mark.gz-ask-spot').count(), 'the marked words', 20000);
        const marked = await page.locator('mark.gz-ask-spot').first().textContent();
        assert.equal(marked.toLowerCase(), canvas ? 'lab report' : 'grades');
        return { url: page.url(), marked, files: await snap(site, 'navigate-highlight', canvas ? 'mark.gz-ask-spot' : 'p mark.gz-ask-spot') };
      });

      await check(`${site}: a question about the student's announcements reads them with the tools first, card by card, then answers from them`, async () => {
        await openPanel();
        await page.click('#gz-ask .gz-ask-new');
        const canvas = site === 'canvas';
        await script({ 'agent.tools': canvas
          ? [{ call: { name: 'announcements_list', arguments: {} }, answer: null }, { call: { name: 'announcement_read', arguments: { course: '25', id: '70' } }, answer: null },
            { call: null, answer: { text: 'Your newest BIO 1100 announcement, from Dr. Rivera: the lab meets in Room 204 this week. Bring goggles.', quotes: ['Lab moved to Room 204', 'Dr. Rivera'] } }]
          : [{ call: { name: 'courses_list', arguments: {} }, answer: null }, { call: { name: 'announcements_list', arguments: { course: '_101_1' } }, answer: null },
            { call: { name: 'announcement_read', arguments: { course: '_101_1', id: '_801_1' } }, answer: null },
            { call: null, answer: { text: 'BIO 1100\'s newest announcement, “Lab moved to Room 204”: the lab meets in Room 204 this week. Bring goggles.', quotes: ['Lab moved to Room 204'] } }] });
        const n = await ask('Any new announcements in BIO 1100?');
        const text = await answered(n, 'the tool-first answer');
        const labels = await page.locator('#gz-ask .gz-ask-steps').last().locator('.gz-ask-step-label').allTextContents();
        const states = await page.locator('#gz-ask .gz-ask-steps').last().locator('.gz-ask-step').evaluateAll((l) => l.map((c) => c.dataset.state));
        assert.deepEqual(labels, canvas ? ['Reading announcements', 'Reading an announcement'] : ['Reading your courses', 'Reading announcements', 'Reading an announcement']);
        assert.ok(states.every((x) => x === 'done'), JSON.stringify(states));
        const runs = await seen();
        assert.ok(runs.length === labels.length + 1 && runs.every((r) => r.task === 'agent.tools'));
        assert.match(text, /Room 204/);
        return { text, labels, files: await snap(site, 'tool-first', '#gz-ask') };
      });

      for (const scene of ['sunday', 'fallback']) await check(scene === 'sunday' ? `${site}: the owner's Sunday — what's due this week reads the week from today, and the answer is a markdown list with friendly dates`
        : `${site}: an answer that fails its check twice becomes Glaze's own list from what was read`, async () => {
        await openPanel();
        await page.click('#gz-ask .gz-ask-new');
        const canvas = site === 'canvas', acct = canvas ? A : `${ULTRA}/_42_1`, cid = canvas ? '25' : '_101_1';
        const done = now - 2 * DAY, monday = now + DAY;
        const items = [['11', 'Reflection Week 10', done, true], ['21', 'Reflection Week 11', monday, false], ['22', 'Behavior Change Project Step 5', monday, false], ['23', 'Lab 8 worksheet', monday, false]]
          .map(([id, title, at, submitted]) => ({ type: 'assignment', id: canvas ? id : `_${id}_1`, cid, course: 'BIO 1100', title, at, sub: { submitted, graded: false, late: false, missing: false } }));
        if (canvas) sunday = items.map((i) => ({ plannable_type: 'assignment', plannable_id: Number(i.id), course_id: 25, context_name: 'BIO 1100', plannable_date: new Date(i.at).toISOString(),
          html_url: `${CANVAS}/courses/25/assignments/${i.id}`, plannable: { title: i.title }, submissions: { submitted: i.sub.submitted, excused: false, graded: false, late: false, missing: false, redo_request: false } }));
        await worker.evaluate(({ acct, items, now, DAY }) => chrome.storage.local.set({ todoCache: { key: `todo:${acct}`, at: now - 36e5, start: new Date(now - 8 * DAY).toISOString(), end: new Date(now + 8 * DAY).toISOString(), teach: false, progress: null, items, grading: [], sums: {} } }), { acct, items, now, DAY });
        const AT = require('../../extension/ai/tasks/agent-tools.js');
        const due = JSON.parse(AT.readable({ due: monday }, 'UTC', { locale: 'en', now })).due;
        const from = new Date(now).toISOString().slice(0, 10), to = new Date(now + 7 * DAY).toISOString().slice(0, 10);
        const titles = ['Reflection Week 11', 'Behavior Change Project Step 5', 'Lab 8 worksheet'];
        // bad: the model's answer fails its check twice (ungrounded prose both times), so Glaze's own list shows.
        const bad = process.env.RIME_SUNDAY_BAD === '1' || scene === 'fallback';
        await script({ 'agent.tools': bad ? [{ call: { name: 'schedule_list', arguments: { from, to } }, answer: null },
          { call: null, answer: { text: 'You have a few assignments coming up this week.', quotes: [] } }, { call: null, answer: { text: 'Three of them are due soon.', quotes: [] } }]
          : [{ call: { name: 'schedule_list', arguments: { from, to } }, answer: null },
          { call: null, answer: { text: ['You have three things due soon, none handed in yet:', ...titles.map((t) => `- **${t}** (BIO 1100): ${due}, not submitted`)].join('\n'), quotes: [...titles, due] } }] });
        try {
          const n = await ask("What's due this week?");
          const text = await answered(n, 'the Sunday answer').catch(async (e) => { throw new Error(`${e.message}; last request: ${(await worker.evaluate(() => askCheck.last)).slice(-1500)}`); });
          const bold = await answers().nth(n).locator('.gz-ask-md ul li strong').allTextContents();
          assert.deepEqual(bold.filter((b) => titles.includes(b)), titles, 'a bulleted list with bold titles');
          assert.ok(text.includes(due), `the friendly date ${due}`);
          const runs = await seen();
          assert.ok(runs.some((r) => r.windows), 'the model saw the resolved windows');
          if (scene === 'fallback') assert.equal((await seen()).filter((r) => r.task === 'agent.tools').length, 3, 'the call, the answer, the corrected answer');
          return { text, due, files: await snap(site, scene, '#gz-ask') };
        } finally { sunday = null; await records(site); }
      });

      await check(`${site}: a reminder that fired shows as a card on the next school page; its Ask Rime asks about it`, async () => {
        const at = Date.now() - 60e3;
        await worker.evaluate((w) => chrome.storage.local.set({ rimeWakes: { wakes: [w], monitors: [], fired: [] } }), { id: site === 'canvas' ? 'w-firedcnv' : 'w-firedult', at, say: 'Finish the lab report', made: at - DAY });
        await goto(HOME);
        await until(() => page.locator('#gz-ask-fired .gz-ask-fired-card').count(), 'the fired card', 20000);
        assert.equal(await page.locator('#gz-ask-fired .gz-ask-fired-say').first().textContent(), 'Finish the lab report');
        const files = await snap(site, 'fired', '#gz-ask-fired');
        // On Ultra Glaze has read no to-do list yet: the answer says so, as the tool-first rule asks, and guesses nothing.
        await script({ 'agent.tools': [{ call: { name: 'todo_list', arguments: {} }, answer: null }, { call: null, answer: site === 'canvas'
          ? { text: 'Your reminder: finish the lab report. Lab report is due soon.', quotes: ['Lab report'] }
          : { text: 'Your reminder: finish the lab report. Glaze has not read your Blackboard to-do list yet, so open Courses once and ask again.', quotes: [] } }] });
        await page.click('#gz-ask-fired .gz-ask-fired-go');
        await page.locator('#gz-ask[open]').waitFor();
        const text = await answered(0, 'the fired reminder\'s answer');
        const runs = await seen();
        assert.equal(runs[0].task, 'agent.tools');
        assert.equal(await page.locator('#gz-ask-fired').count(), 0, 'the card is gone once asked');
        await page.keyboard.press('Escape');
        return { text, files };
      });
    }

    await check('no request left the schools\' own sites, and the pages threw nothing', async () => {
      assert.deepEqual(asked.filter((x) => x.startsWith('refused')), []);
      assert.deepEqual(errors, []);
      return { shots: shots.length };
    });
  } catch (e) {
    failed++;
    results.push({ name: 'setup', ok: false, error: e.stack });
    console.error(e);
  } finally {
    await context?.close().catch(() => {});
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'rime-panel-check.json'), JSON.stringify({ total, failed, shots, results }, null, 2));
    console.log(`${total - failed}/${total} passed; ${shots.length} screenshots; evidence in ${out}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
