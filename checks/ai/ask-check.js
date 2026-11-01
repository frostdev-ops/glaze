// Ask Rime in a real Chromium (ai/page/ask.js, ai/ask.js), headless, in a staged copy of the extension whose worker carries a
// stub engine: a provider registered under the id 'stub' that answers each task from the check's script, so the real broker,
// the real tasks' checks, the step loop, agents/calls.js with Agents' real tools and Glaze's approval window all run (the
// copy's worker is a new file, the checkout's is untouched). A synthetic Canvas school under an invented origin, every
// other request aborted and DNS resolving nowhere. Flows: with Ask off the palette has no Ask Rime; turned on, the palette
// opens the panel; a tutoring reply; an agent read of the to-do list; marking a to-do done with Allow, and with Don't allow;
// Ask turned off closes the panel and takes the palette's row away. Shots: the panel at 1280 and 320 px, light and dark.
//   glaze-remote -e TZ=UTC -o <evidence dir> -- node checks/ai/ask-check.js /out
//   (Mac: NODE_PATH=<playwright> nice -n 10 node checks/ai/ask-check.js [evidence dir]; EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const env = require('../../tools/dev/check-env.js');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '../../extension'));
const G = require(path.join(root, 'content/defaults.js'));
const CANVAS = 'https://school.instructure.com', A = `${CANVAS}/5`;
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
// The stub engine, and a way to see Glaze's content script in a tab.
const SHIM = `
globalThis.askCheck = { script: {}, seen: [] };
ai();
if (!GZ_AI_SETTINGS.PROVIDERS.includes('stub')) GZ_AI_SETTINGS.PROVIDERS.push('stub');
GZ_AI_PROVIDERS.add({ id: 'stub', config: (raw) => (raw && typeof raw === 'object' ? { ...raw } : null), caps: () => ({ text: true, json: true }), status: async () => ({ state: 'ready' }),
  run: async (req) => {
    const task = req.task?.id, next = (askCheck.script[task] || []).shift();
    const text = req.messages.map((m) => [].concat(m.content).map((c) => (typeof c === 'string' ? c : c.text || '')).join('')).join('\\n');
    const mark = /\\[result \\d+ todo_mark_done[^\\]]*\\]\\n<<<(DATA-[0-9a-f]+)\\n([\\s\\S]*?)\\n>>>\\1/.exec(text);
    askCheck.seen.push({ task, steps: (text.match(/\\[result \\d+ /g) || []).length, ...(mark && { mark: JSON.parse(mark[2]) }) });
    if (!next) throw Object.assign(new Error('script'), { category: 'invalid-response' });
    let out = next;
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
const PLANNER = [planner(1, 'Lab report', 2), planner(2, 'Reading response', 5)];
const DASH = '<!doctype html><html lang="en"><head><title>Dashboard</title><link rel="stylesheet" href="/dist/brandable_css/check.css"></head><body><div id="application" class="ic-app"><main id="content"><h1>Dashboard</h1><p>Biology, history and the week ahead.</p></main></div></body></html>';
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
const settingsFor = (preset) => G.GZ_SANITIZE({ preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, navbar: { on: false }, footer: false,
  enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), palette: true } });
const AI = (ask) => ({ on: true, model: { use: 'custom-1', model: 'stub' }, features: { ask } });

(async () => {
  const lock = require('../../tools/dev/check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-ask-'));
  const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-ask'));
  fs.mkdirSync(out, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nask-check\n`);
    const ext = env.staged(root, [], scratch);
    // The staged files are hard links to the checkout: replace the worker's, never write through it.
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
    const asked = [], marks = [], errors = [];
    const CSRF = 'check+token/=';
    await context.addCookies([{ name: '_csrf_token', value: encodeURIComponent(CSRF), domain: 'school.instructure.com', path: '/', secure: true }]);
    await context.route('**/*', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      const json = (b, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
      if (u.origin === CANVAS && req.method() === 'POST' && u.pathname === '/api/v1/planner/overrides') {
        marks.push(req.postDataJSON());
        return json({ id: 901, plannable_id: req.postDataJSON().plannable_id, marked_complete: req.postDataJSON().marked_complete, dismissed: false });
      }
      if (u.origin !== CANVAS || req.method() !== 'GET') { asked.push(`refused ${req.method()} ${u.href}`); return r.abort(); }
      asked.push(u.pathname);
      if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return json({ id: '5', time_zone: 'UTC' });
      if (u.pathname === '/api/v1/planner/items') return json(PLANNER);
      if (u.pathname.startsWith('/api/v1/')) return json([]);
      if (u.pathname.endsWith('.css')) return r.fulfill({ contentType: 'text/css', body: '' });
      return r.fulfill({ contentType: 'text/html', body: DASH });
    });
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/background/background.js')) || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, APPROVE = `${base}/agents/approve.html`;
    const stale = { todoCache: { key: `todo:${A}`, at: now - 36e5, start: new Date(now - 8 * DAY).toISOString(), end: new Date(now + 8 * DAY).toISOString(), teach: true, progress: true,
      items: [{ type: 'assignment', id: '9', cid: '25', course: 'BIO 1100', title: 'Old', at: now }], grading: [], sums: {} } };
    await worker.evaluate(async ({ settings, local }) => {
      await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set(local);
      await GZ_AI_BROKER.vault().set('connections', { 'custom-1': { provider: 'stub', model: 'stub', generation: 'g-1' } });
    }, { settings: settingsFor('Paper'), local: { ultra: [], ai: AI(false), ...stale } });
    const script = (s) => worker.evaluate((x) => { askCheck.script = x; askCheck.seen = []; }, s);
    const seen = () => worker.evaluate(() => askCheck.seen);
    const setAi = (ai) => worker.evaluate((v) => chrome.storage.local.set({ ai: v }), ai);

    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
    await page.goto(`${CANVAS}/`);
    await until(() => worker.evaluate((u) => glazeIn(u), page.url().split('#')[0]).then((r) => r?.on), 'Glaze on the page');
    // The command palette's rows for a search, once its commands have loaded, as the student sees them: the Ask Rime rows.
    const palette = async (query) => {
      await page.bringToFront();
      await page.keyboard.press(`${MOD}+k`);
      const input = page.locator('#gz-cmd input');
      await input.waitFor({ state: 'visible' });
      await input.fill(query);
      await until(() => page.evaluate(() => { const l = [...document.querySelectorAll('#gz-cmd li')]; return l.length > 0 && !l.some((x) => x.classList.contains('gz-cmd-empty') && /Loading/.test(x.textContent)); }), 'the palette\'s rows');
      return page.locator('#gz-cmd li[role="option"]').filter({ has: page.locator('span', { hasText: /^Ask Rime$/ }) });
    };
    const closePalette = async () => { if (await page.locator('#gz-cmd input').isVisible().catch(() => false)) await page.keyboard.press('Escape'); };
    const answers = () => page.locator('#gz-ask .gz-ask-a');
    const ask = async (question) => {
      const n = await answers().count();
      await page.fill('#gz-ask-q', question);
      await page.press('#gz-ask-q', 'Enter');
      return n;
    };
    const answered = async (n, label) => {
      await until(async () => (await answers().count()) > n, label, 20000);
      return (await answers().nth(n).textContent()).trim();
    };
    const approval = async () => {
      const p = await until(() => context.pages().find((x) => x.url() === APPROVE && !x.isClosed()), 'Glaze\'s approval window');
      await p.waitForFunction(() => document.getElementById('title').textContent.trim() && !document.getElementById('ask').hidden, null, { polling: 50 });
      await p.bringToFront();
      await p.waitForFunction(() => document.hasFocus() && document.getElementById('yes').getAttribute('aria-disabled') === 'false', null, { polling: 50 });
      return p;
    };

    await check('with Ask off, the palette offers no Ask Rime', async () => {
      const rows = await palette('Ask Rime');
      const count = await rows.count();
      await closePalette();
      assert.equal(count, 0);
      assert.equal(await page.locator('#gz-ask').count(), 0);
      return { rows: count };
    });

    await setAi(AI(true));
    await check('turned on, the palette\'s Ask Rime opens the panel, its question focused', async () => {
      const rows = await until(async () => { const r = await palette('Ask Rime'); if (await r.count()) return r; await closePalette(); return null; }, 'the Ask Rime row');
      await rows.first().click();
      await page.locator('#gz-ask[open]').waitFor();
      await until(() => page.evaluate(() => document.activeElement?.id === 'gz-ask-q'), 'focus in the question');
      const name = await page.evaluate(() => document.getElementById(document.getElementById('gz-ask').getAttribute('aria-labelledby'))?.textContent);
      assert.equal(name, 'Ask Rime');
      return { name };
    });

    await check('a tutoring question gets study help: a hint, never the answer', async () => {
      await script({ 'study.help': [{ kind: 'hint', step: null, reply: 'Look at the + 5 on the left. What could you do to both sides to remove it?', followUp: null }] });
      const n = await ask('How do I solve 3x + 5 = 20?');
      const text = await answered(n, 'the tutoring reply');
      assert.equal(text, 'Look at the + 5 on the left. What could you do to both sides to remove it?');
      assert.deepEqual((await seen()).map((s) => s.task), ['study.help']);
      return { text };
    });

    await check('a question about the student\'s own to-dos reads the to-do list through Agents\' tools and answers from it', async () => {
      await script({ 'agent.tools': [{ call: { name: 'todo_list', arguments: {} }, answer: null }, { call: null, answer: { text: 'Lab report is due this week.', quotes: ['Lab report'] } }] });
      const n = await ask('What is due this week?');
      const text = await answered(n, 'the agent answer');
      assert.equal(text, 'Lab report is due this week.');
      const s = await seen();
      assert.deepEqual(s.map((x) => [x.task, x.steps]), [['agent.tools', 0], ['agent.tools', 1]]);
      return { text, runs: s };
    });

    await check('marking a to-do done waits in Glaze\'s window; Allow marks it (Glaze\'s own mark, Canvas sync being off), and the answer follows', async () => {
      await script({ 'agent.tools': [{ call: { name: 'todo_list', arguments: {} }, answer: null }, { mark: 'Lab report' }, { call: null, answer: { text: 'Marked Lab report done.', quotes: ['Lab report'] } }] });
      const n = await ask('Mark Lab report as done');
      const win = await approval();
      const title = await win.evaluate(() => document.getElementById('title').textContent);
      assert.match(title, /Lab report/, 'Glaze\'s own sentence for the change');
      assert.equal(await page.locator('#gz-ask .gz-ask-say').textContent(), 'Waiting for your answer in Glaze’s window');
      await win.click('#yes');
      const text = await answered(n, 'the answer after Allow');
      assert.equal(text, 'Marked Lab report done.');
      const mark = (await seen()).at(-1).mark;
      assert.equal(mark?.where, 'glaze', JSON.stringify(mark));
      assert.equal(mark.item.title, 'Lab report');
      assert.equal(mark.item.marked, true, 'marked done on this device');
      assert.deepEqual(marks, [], 'nothing written to Canvas');
      return { title, text, mark };
    });

    await check('Don\'t allow changes nothing and asks the model nothing more', async () => {
      await script({ 'agent.tools': [{ call: { name: 'todo_list', arguments: {} }, answer: null }, { mark: 'Reading response' }, { call: null, answer: { text: 'Marked it done.', quotes: [] } }] });
      const n = await ask('Mark Reading response as done');
      const win = await approval();
      await win.click('#no');
      const text = await answered(n, 'the answer after Don\'t allow');
      assert.equal(text, 'Nothing was changed.');
      assert.equal((await seen()).length, 2, 'no run after the decline');
      const kept = await worker.evaluate(() => chrome.storage.local.get(null).then((all) => JSON.stringify(all)));
      assert.ok(!/Reading response[^}]*"done":true/.test(kept), 'nothing marked');
      return { text };
    });

    // The panel with its conversation: 1280 and 320 px wide, light (Paper) and dark (Midnight).
    const shots = [];
    for (const [preset, look] of [['Paper', 'light'], ['Midnight', 'dark']]) {
      await check(`screenshots, ${look}`, async () => {
        const was = await page.evaluate(() => getComputedStyle(document.getElementById('gz-ask')).backgroundColor);
        await worker.evaluate((s) => chrome.storage.sync.set(s), settingsFor(preset));
        if (look === 'dark') await until(() => page.evaluate((w) => getComputedStyle(document.getElementById('gz-ask')).backgroundColor !== w, was), 'the dark palette');
        for (const [w, h] of [[1280, 860], [320, 640]]) {
          await page.setViewportSize({ width: w, height: h });
          await until(() => page.evaluate((x) => { const r = document.getElementById('gz-ask').getBoundingClientRect(); return r.width > 0 && r.right <= x + 0.5 && r.left >= -0.5; }, w), `the panel fits ${w} px`);
          const file = path.join(out, `ask-${w}-${look}.png`);
          await page.screenshot({ path: file });
          shots.push(file);
        }
        await page.setViewportSize({ width: 1280, height: 860 });
        const fit = await page.evaluate(() => { const d = document.getElementById('gz-ask'); return { width: d.getBoundingClientRect().width, overflow: d.scrollWidth > d.clientWidth + 1 }; });
        assert.equal(fit.overflow, false);
        return { shots: shots.slice(-2), fit };
      });
    }

    await check('Ask turned off closes the panel and takes the palette\'s row away', async () => {
      await setAi(AI(false));
      await until(async () => (await page.locator('#gz-ask').count()) === 0, 'the panel closes');
      const rows = await palette('Ask Rime');
      const count = await rows.count();
      await closePalette();
      assert.equal(count, 0);
      return { rows: count };
    });

    await check('no request left the school\'s own site, and the page threw nothing', async () => {
      assert.deepEqual(asked.filter((x) => x.startsWith('refused')), []);
      assert.deepEqual(errors, []);
      return { requests: [...new Set(asked)] };
    });
  } catch (e) {
    failed++;
    results.push({ name: 'setup', ok: false, error: e.stack });
    console.error(e);
  } finally {
    await context?.close().catch(() => {});
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
    fs.writeFileSync(path.join(out, 'ask-check.json'), JSON.stringify({ total, failed, results }, null, 2));
    console.log(`${total - failed}/${total} passed; evidence in ${out}`);
    process.exitCode = failed ? 1 : 0;
  }
})();
