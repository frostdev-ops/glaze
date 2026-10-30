// Settings → Agents against the real worker, in a copy of the extension that holds nativeMessaging from install (a headless
// browser can't answer the grant's prompt): the switch's permission request, through a stand-in that records whether the
// click's user activation is still live when it is called, then off before the permission goes; the link's states from real
// helpers in the profile's NativeMessagingHosts (none, one that doesn't list this copy, one that exits at once, the real
// glaze-mcp host under a scratch HOME) and every other state lib/agent-link.js reports as the page shows it; an app's card,
// the activity list, 320px and search. Each state is shot in light and dark, each scheme in a browser of its own. No network.
// NODE_PATH=<playwright> nice -n 10 node scripts/settings-agents-check.js [shots folder]
// AGENTS_CASE selects one check, AGENTS_SCHEME one scheme ('light' or 'dark'); EXT selects the checkout under test.
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const env = require('./check-env.js');
const lock = require('./check-env.js').lockPath();
const shots = process.argv[2] ? path.resolve(process.argv[2]) : '';
const HOST = 'io.frostdev.glaze_mcp';
const A = 'aaaaaaaaaaaaaaaa', C = 'cccccccccccccccc', MOD = 'bbbbbbbbbbbbbbbb';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let context, scratch, held = false, total = 0, failed = 0, page;
const check = async (name, test) => {
  if (process.env.AGENTS_CASE && process.env.AGENTS_CASE !== name) return;
  total++;
  try { await test(); console.log(`ok ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); if (shots) await page?.screenshot({ path: path.join(shots, `failed-${name}.png`), fullPage: true }).catch(() => {}); }
};
(async () => {
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nsettings-agents-check\n`);
    for (const scheme of process.env.AGENTS_SCHEME ? [process.env.AGENTS_SCHEME] : ['light', 'dark']) await pass(scheme);
  } finally {
    await context?.close();
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} Settings → Agents browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });

// The page's stand-ins: permissions.request records { asked, active } and says yes (the copy holds the permission
// already); remove records too, as Chrome refuses to remove a permission a manifest requires. Each config op is logged in
// the order sent.
const stand = () => {
  if (!globalThis.chrome?.permissions || location.protocol !== 'chrome-extension:') return;
  const log = (globalThis.agentsLog = []);
  chrome.permissions.request = (p) => { log.push({ asked: p.permissions.join(','), active: navigator.userActivation.isActive }); return Promise.resolve(true); };
  chrome.permissions.remove = (p) => { log.push({ removed: p.permissions.join(',') }); return Promise.resolve(true); };
  const send = chrome.runtime.sendMessage.bind(chrome.runtime);
  chrome.runtime.sendMessage = (m, ...rest) => { if (m?.type === 'glaze:mcp-config') log.push({ sent: m.op, on: m.on }); return send(m, ...rest); };
};

async function pass(scheme) {
  try {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-agents-'));
    const ext = env.staged(root, [], scratch);
    // nativeMessaging from install, so the worker started with the browser has connectNative.
    const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
    m.permissions = [...new Set([...m.permissions, 'nativeMessaging'])];
    m.optional_permissions = (m.optional_permissions || []).filter((p) => p !== 'nativeMessaging');
    fs.rmSync(path.join(ext, 'manifest.json'));
    fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m, null, 2));
    const profile = path.join(scratch, 'profile'), hosts = path.join(profile, 'NativeMessagingHosts'), bin = path.join(scratch, 'bin'), home = path.join(scratch, 'home');
    for (const d of [hosts, bin, home]) fs.mkdirSync(d, { recursive: true });
    fs.chmodSync(home, 0o700);
    const launcher = (name, body) => { const f = path.join(bin, `${name}.sh`); fs.writeFileSync(f, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); return f; };
    const quits = launcher('quits', 'exit 0');
    const real = launcher('glaze-mcp', `HOME='${home}' exec '${process.execPath}' '${path.join(root, 'mcp/bin/glaze-mcp.js')}' host "$@"`);
    const helper = (file, origins) => {
      const f = path.join(hosts, `${HOST}.json`);
      if (!file) return fs.rmSync(f, { force: true });
      fs.writeFileSync(f, JSON.stringify({ name: HOST, description: 'Glaze settings-agents-check', path: file, type: 'stdio', allowed_origins: origins.map((id) => `chrome-extension://${id}/`) }, null, 2));
    };
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(profile, {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 1800 }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: scheme,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking',
        '--proxy-server=http://127.0.0.1:0', '--proxy-bypass-list=<-loopback>', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    env.noFirstRun(context);
    await context.route('**/*', (r) => (new URL(r.request().url()).protocol === 'chrome-extension:' ? r.continue() : r.abort()));
    await context.addInitScript(stand);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host, base = `chrome-extension://${id}`;
    page = await context.newPage();
    // The runner's load can hold a page's load event for seconds: navigation gets longer, and the page counts once its
    // switch is in place.
    page.setDefaultTimeout(8000);
    page.setDefaultNavigationTimeout(30000);
    const errors = [];
    page.on('pageerror', (e) => { errors.push(e.message); console.error(`[page error] ${e.message}`); });
    const open = async () => {
      await page.goto('about:blank');
      await page.goto(`${base}/options.html#ai/agents`, { waitUntil: 'domcontentloaded' });
      await page.locator('#agents-on').waitFor({ state: 'attached', timeout: 30000 });
      await pause(400);
    };
    const line = () => page.locator('#agents-line').innerText();
    const saying = async (words, timeout = 15000) => {
      for (const end = Date.now() + timeout; ;) {
        const now = await page.locator('#agents-state').isVisible() ? await line() : '';
        if (words instanceof RegExp ? words.test(now) : now === words) return now;
        if (Date.now() > end) throw new Error(`the line says ${JSON.stringify(now)}, not ${words}`);
        await pause(100);
      }
    };
    const log = () => page.evaluate(() => globalThis.agentsLog);
    const link = () => page.evaluate(async () => (await chrome.storage.session.get('mcpLink')).mcpLink);
    const ensure = () => page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:mcp-config', op: 'set', on: true }));
    const shoot = async (name, target = '#agents') => {
      if (!shots) return;
      fs.mkdirSync(shots, { recursive: true });
      await pause(200);
      await page.locator(target).screenshot({ path: path.join(shots, `agents-${name}-${scheme}.png`) });
    };
    const now = Date.now();

    await check('seed', async () => {
      await open();
      // The Look follows the system's light or dark (Paper and Frost), so each state is shot in both.
      await page.evaluate(async () => chrome.storage.sync.set({ auto: { ...GZ_SANITIZE().auto, on: true, mode: 'device' } }));
      // Two apps as lib/mcp/grants.js keeps them (the worker's own database), one declined; a mod with agent tools; activity.
      await page.evaluate(async ({ A, C, MOD, now }) => {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('glaze-mcp', 1); r.onupgradeneeded = () => r.result.createObjectStore('apps'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        await new Promise((res, rej) => {
          const t = db.transaction('apps', 'readwrite'), s = t.objectStore('apps');
          s.put({ id: A, name: 'Claude Code', exe: '/usr/local/bin/claude', verified: true, at: now - 864e5 * 3, used: now - 6e4, grants: { courses: true, [`mod:${MOD}`]: true }, declined: {} }, A);
          s.put({ id: C, name: 'Cursor', exe: '/Applications/Cursor.app/Contents/MacOS/Cursor', verified: true, at: now - 864e5, used: now - 864e5, grants: {}, declined: { pair: now - 864e5 } }, C);
          t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        await chrome.storage.local.set({
          mods: [MOD], [`mod:${MOD}`]: { id: MOD, manifest: { glaze: 1, name: 'Due Soon', version: '1.0.0', author: { name: 'Synthetic author' }, permissions: [{ id: 'agents', why: 'Lists what is due.' }, { id: 'todo', why: 'Reads your to-dos.' }], tools: [{ name: 'due_soon', title: 'Due soon', description: 'To-dos due this week.', from: 'todo' }] },
            files: {}, hash: 'h', key: 'k', version: '1.0.0', grants: { agents: true, todo: true }, source: 'file', installedAt: now, enabled: false },
          mcpCalls: [
            { at: now - 3e5, app: A, tool: 'courses_list', group: 'courses', kind: 'read', outcome: 'ok', ms: 40 },
            { at: now - 2e5, app: A, tool: 'todo_mark_done', group: 'courses', kind: 'write', outcome: 'declined', ms: 9000 },
            { at: now - 1e5, app: A, tool: 'grades_list', group: 'grades', kind: 'read', outcome: 'refused', ms: 2 },
          ],
        });
      }, { A, C, MOD, now });
      await open();
      assert.equal(await page.locator('#agents-on').isChecked(), false, 'off by default');
      assert.equal(await page.locator('#agents-state').isVisible(), false);
      await page.locator('#agents-apps .ag-app').nth(1).waitFor();
      assert.deepEqual(await page.locator('#agents-calls li span').allInnerTexts(), ['grades_list · Claude Code', 'todo_mark_done · Claude Code', 'courses_list · Claude Code']);
      const card = page.locator('#agents-apps .ag-app', { hasText: 'Claude Code' });
      assert.deepEqual(await card.locator('.ag-grant span').allInnerTexts(), ['Courses, to-dos and schedule', 'Grades', 'Writer documents', 'Assignments and rubrics', 'The mod Due Soon']);
      await shoot('off');
    });

    await check('on', async () => {
      helper(null);
      await page.locator('#agents-on').click();
      // The real worker, nativeMessaging held and no helper anywhere: Chromium's "not found".
      await saying('In Claude Desktop, add the Glaze extension. For other apps, run npx glaze-mcp setup');
      const got = await log();
      assert.deepEqual(got.filter((x) => x.asked), [{ asked: 'nativeMessaging', active: true }], 'asked inside the click, with its activation live');
      const asked = got.findIndex((x) => x.asked), set = got.findIndex((x) => x.sent === 'set');
      assert.ok(asked >= 0 && set > asked, JSON.stringify(got));
      assert.equal((await page.evaluate(async () => (await chrome.storage.local.get('mcp')).mcp)).on, true);
      assert.equal((await link()).state, 'not-installed');
      assert.equal(await page.locator('#agents-state').getAttribute('data-tone'), 'bad');
      await shoot('not-installed');
    });

    await check('forbidden', async () => {
      helper(quits, ['a'.repeat(32)]);
      await ensure();
      await saying(`npx glaze-mcp setup --extension-id ${id}`);
      assert.equal((await link()).state, 'forbidden');
      await page.locator('#agents-copy').click();
      await shoot('forbidden');
    });

    await check('exited', async () => {
      helper(quits, [id]);
      await ensure();
      await saying('The helper stopped; Glaze is retrying. npx glaze-mcp doctor says why.');
      assert.equal((await link()).state, 'exited');
      await shoot('exited');
    });

    await check('ready', async () => {
      // The real helper: the worker's next retry starts it, with no click.
      helper(real, [id]);
      await saying('Ready', 20000);
      assert.equal((await link()).state, 'connected');
      assert.equal(await page.locator('#agents-state').getAttribute('data-tone'), 'ok');
      await shoot('ready');
    });

    await check('off', async () => {
      const before = (await log()).length;
      await page.locator('#agents-on').click();
      for (const end = Date.now() + 8000; (await link())?.state !== 'off';) { if (Date.now() > end) throw new Error(`link ${JSON.stringify(await link())}`); await pause(100); }
      await page.waitForFunction((start) => globalThis.agentsLog.slice(start).some((x) => x.removed === 'nativeMessaging'), before);
      const got = (await log()).slice(before);
      assert.deepEqual(got.filter((x) => x.asked), [], 'turning off asks for nothing');
      const set = got.findIndex((x) => x.sent === 'set' && x.on === false), removed = got.findIndex((x) => x.removed === 'nativeMessaging');
      assert.ok(set >= 0 && removed > set, JSON.stringify(got));
      assert.equal(await page.locator('#agents-state').isVisible(), false);
      assert.equal(await page.locator('#agents-on').isChecked(), false);
      assert.equal((await page.evaluate(() => chrome.runtime.sendMessage({ type: 'glaze:mcp-config', op: 'state' }))).on, false, 'the worker holds off');
    });

    await check('states', async () => {
      helper(null);
      await page.locator('#agents-on').click();
      await saying(/^In Claude Desktop/);
      assert.equal((await log()).filter((x) => x.asked && x.active).length, 2);
      // The rest as the worker would write them: the link stays not-installed until a trigger, so nothing writes over these.
      for (const [state, words, extra] of [
        ['restart', 'Starting…'], ['connecting', 'Starting…'], ['old-helper', 'Update the helper: npx glaze-mcp@latest setup', { error: 'version' }],
        ['needs-permission', 'Allow Glaze to start the helper'], ['no-node', 'Install Node.js 18+ for browsers to start the helper'],
      ]) {
        await page.evaluate(async (v) => chrome.storage.session.set({ mcpLink: v }), { state, at: Date.now(), ...extra });
        await saying(words);
        assert.equal(await page.locator('#agents-allow').isVisible(), state === 'needs-permission', `${state}: Allow`);
        assert.equal(await page.locator('#agents-copy').isVisible(), state === 'old-helper', `${state}: Copy`);
        await shoot(state);
      }
      await page.evaluate(async () => chrome.storage.session.set({ mcpLink: { state: 'not-installed', at: Date.now() } }));
    });

    await check('apps', async () => {
      const card = page.locator('#agents-apps .ag-app', { hasText: 'Claude Code' });
      await card.locator('.ag-grant', { hasText: 'Grades' }).locator('input').click();
      const grants = () => page.evaluate(async (A) => {
        const db = await new Promise((res, rej) => { const r = indexedDB.open('glaze-mcp', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
        const rec = await new Promise((res) => { const r = db.transaction('apps').objectStore('apps').get(A); r.onsuccess = () => res(r.result); });
        db.close();
        return rec.grants;
      }, A);
      for (const end = Date.now() + 5000; !(await grants()).grades;) { if (Date.now() > end) throw new Error(JSON.stringify(await grants())); await pause(100); }
      assert.equal(await card.locator('.ag-grant', { hasText: 'Grades' }).locator('input').isChecked(), true);
      assert.equal(await page.evaluate(() => document.activeElement?.closest('.ag-grant')?.innerText), 'Grades', 'the switch keeps the focus');
      await shoot('apps', '#agents-apps-box');
      const declined = page.locator('#agents-apps .ag-app', { hasText: 'Cursor' });
      await declined.getByRole('button', { name: 'Forget' }).click();
      await declined.waitFor({ state: 'detached' });
      assert.equal(await page.locator('#agents-apps .ag-app').count(), 1);
    });

    await check('narrow', async () => {
      await page.setViewportSize({ width: 320, height: 1400 });
      await page.locator('#agents').scrollIntoViewIfNeeded();
      await pause(200);
      const m = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('#agents :is(input, button, a, code)')) {
          if (!el.checkVisibility()) continue;
          const r = el.getBoundingClientRect();
          if (r.left < -1 || r.right > innerWidth + 1) out.push(`${el.id || el.textContent.slice(0, 30)} ${Math.round(r.left)}..${Math.round(r.right)}`);
        }
        return { scroll: document.documentElement.scrollWidth, out };
      });
      assert.ok(m.scroll <= 320, `the page is ${m.scroll}px wide`);
      assert.deepEqual(m.out, []);
      await shoot('narrow');
      await page.setViewportSize({ width: 1280, height: 1800 });
    });

    await check('search', async () => {
      for (const [words, sel] of [['agents', '#agents'], ['forget all apps', '#agents-forget']]) {
        await page.locator('#find').fill(words);
        await pause(150);
        assert.ok(await page.locator(sel).isVisible(), `${words} finds ${sel}`);
      }
      await page.locator('#find').fill('');
    });

    await check('no-errors', async () => { assert.deepEqual(errors, []); });
  } finally {
    await context?.close();
    context = null;
    fs.rmSync(scratch, { recursive: true, force: true });
    scratch = '';
  }
}
