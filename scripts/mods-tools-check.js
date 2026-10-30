// Mods' code tools for agent apps (C14) in a real Chromium, headless: the real unpacked extension, staged, its worker with
// C14's wiring while lib/background.js still holds the stub (test/helpers/modcode-wiring.cjs; the checkout's file is
// untouched) and a hook for the check to run a tool as the registry lists it, as lib/mcp/calls.js runs one. A Canvas course
// page Playwright serves for https://school.instructure.com (account 5); every other request is aborted and DNS resolves
// nowhere. A fixture mod's Worker answers its code tools there, in the real sandboxed mods host, through the content script
// (features/mods.js), and its answers come back through the broker. It checks: the tool is listed once the sandbox ran; an
// answer that reads the page and the student's plan; a mod's error; another account or no tab of the school says to open it;
// a mod turned off mid-call and a page navigated away mid-call end the call at once; and 15 s without an answer.
//   NODE_PATH=<playwright> nice -n 10 node scripts/mods-tools-check.js [evidence folder]   (EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const { wired } = require(path.join(root, 'test/helpers/modcode-wiring.cjs'));
const SCHOOL = 'https://school.instructure.com', ACCOUNT = `${SCHOOL}/5`, ID = 'abcdefghijklmnop', TOOL = (n) => `mod_${ID}_${n}`;
const TEXT = {
  open: "Open school.instructure.com, signed in as this account; this mod's tool runs there.",
  stopped: 'The mod stopped before it answered.',
  timeout: "The mod's tool didn't answer within 15 seconds.",
};
// The check's way in: a tool as the registry lists it, run as lib/mcp/calls.js runs one; and the listed names.
const SHIM = `
globalThis.toolsCheck = {
  run: async (name, args, account) => {
    if (typeof GZ_MCP_REGISTRY === 'undefined') mcpFiles();
    const t = GZ_MCP_REGISTRY.get(name, await mcpRead());
    return t ? t.run(args, { account }) : 'not listed';
  },
  names: async () => { if (typeof GZ_MCP_REGISTRY === 'undefined') mcpFiles(); return GZ_MCP_REGISTRY.list(await mcpRead()).map((t) => t.name); },
};
`;
// Runs as the mod's Worker, never as extension code.
const HOOKS = `
let page = null;
glaze.on('page', (d) => { page = d.kind; });
glaze.tools.handle('echo', async (args) => ({ said: args.text, page, due: (await glaze.todo()).map((i) => i.title) }));
glaze.tools.handle('slow', () => new Promise(() => {}));
glaze.tools.handle('boom', () => { throw new Error('boom'); });
`;
const tool = (name, input) => ({ name, title: `The ${name} tool`, description: `Answers with ${name}.`, code: true, ...(input && { input }) });
const RECORD = { id: ID, enabled: true, hash: 'h-tools', key: 'fixture-key', version: '1.0.0', dev: false, grants: { agents: true, todo: true },
  manifest: { glaze: 1, name: 'Tools', version: '1.0.0', permissions: [{ id: 'agents', why: 'Answers the agent apps you connect.' }, { id: 'todo', why: 'Reads your plan for them.' }], hooks: 'hooks.js',
    tools: [tool('echo', { type: 'object', properties: { text: { type: 'string', maxLength: 40 } }, additionalProperties: false }), tool('slow'), tool('boom')] },
  files: { 'hooks.js': Buffer.from(HOOKS).toString('base64') } };
const strip = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
const COURSE = strip(fs.readFileSync(path.join(root, 'test/fixtures/canvas-course-home.html'), 'utf8'));
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
  const at = Date.now();
  try { const note = await test(); results.push({ name, ok: true, ms: Date.now() - at, note }); console.log(`ok ${name}`); } catch (e) { failed++; results.push({ name, ok: false, ms: Date.now() - at, error: e.stack }); console.error(`FAIL ${name}: ${e.stack}`); }
};

(async () => {
  const lock = require('./check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mods-tools-'));
  const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(scratch, 'out');
  fs.mkdirSync(out, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmods-tools-check\n`);
    const ext = require('./check-env.js').staged(root, [], scratch);
    // The staged files are hard links to the checkout: replace the worker's, never write through it.
    const worker0 = fs.readFileSync(path.join(ext, 'lib/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'lib/background.js'));
    fs.writeFileSync(path.join(ext, 'lib/background.js'), wired(worker0) + SHIM);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 860 }, locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    require('./check-env.js').noFirstRun(context);
    context.setDefaultTimeout(15000);
    const external = [], errors = [];
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      if (['chrome-extension:', 'data:', 'blob:'].includes(u.protocol)) return r.continue();
      if (u.origin === SCHOOL && /^\/courses\/\d+$/.test(u.pathname)) return r.fulfill({ contentType: 'text/html', body: COURSE });
      if (u.origin === SCHOOL && u.pathname === '/api/v1/users/self/profile') return r.fulfill({ contentType: 'application/json', body: '{"id":"5","name":"Student"}' });
      if (u.origin === SCHOOL && u.pathname.startsWith('/api/v1/')) return r.fulfill({ contentType: 'application/json', body: '[]' });
      external.push(r.request().url());
      return r.abort();
    });
    const sw = context.serviceWorkers().find((w) => w.url().endsWith('/lib/background.js')) || await context.waitForEvent('serviceworker');
    await until(() => sw.evaluate(() => typeof globalThis.toolsCheck?.run === 'function'), 'the worker loads the check\'s hook');
    const run = (name, args = {}, account = ACCOUNT) => sw.evaluate(([n, a, acc]) => toolsCheck.run(n, a, acc), [name, args, account]);
    await sw.evaluate(async ({ record, ID, SCHOOL }) => {
      await chrome.storage.sync.set({ enabled: true });
      await chrome.storage.local.set({ mods: [ID], [`mod:${ID}`]: record,
        todoCache: { key: `todo:${SCHOOL}/5`, at: Date.now(), items: [{ type: 'assignment', id: '1', cid: '25', course: 'Chem', title: 'Lab report', at: Date.now() + 864e5, url: '/courses/25/assignments/1' }] } });
    }, { record: RECORD, ID, SCHOOL });
    const watch = (p) => {
      p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`console: ${m.text()}`); });
    };
    // In Glaze's own world on the page: the mods runtime's state.
    const stats = (page) => sw.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
      if (!tab) return null;
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.GZ_MODS?.stats() || null }).catch(() => [{ result: null }]);
      return r.result;
    }, page.url());
    // Its host up (a newer one than `hosts` on this page) with the sandbox found working; a call waits there for the Worker.
    const running = (page, hosts = 0) => until(async () => { const s = await stats(page); return s?.running && s.runtime === true && s.hosts > hosts && !s.gone?.[ID] && s; }, 'the mod running on the page');
    const open = async (url = `${SCHOOL}/courses/25`) => { const p = await context.newPage(); watch(p); await p.goto(url); await running(p); return p; };
    // A call left running in the worker while the check acts on the page; → its answer and how long it took.
    const started = (name) => sw.evaluate(([n, acc]) => {
      const box = (globalThis.checkCalls ||= {})[n] = { v: null, at: Date.now(), ms: null };
      toolsCheck.run(n, {}, acc).then((v) => { box.v = v; box.ms = Date.now() - box.at; }, (e) => { box.v = `threw ${e.message}`; box.ms = Date.now() - box.at; });
    }, [name, ACCOUNT]);
    const ended = (name, ms = 20000) => until(() => sw.evaluate((n) => (globalThis.checkCalls?.[n]?.ms !== null ? globalThis.checkCalls[n] : null), name), `${name} to end`, ms);

    let page = await open();

    await check('the code tool is listed once a page found the mods sandbox working', async () => {
      const names = await sw.evaluate(() => toolsCheck.names());
      for (const n of ['echo', 'slow', 'boom']) assert.ok(names.includes(TOOL(n)), `${TOOL(n)} in ${names.join(' ')}`);
      return { modRuntime: await sw.evaluate(() => chrome.storage.local.get('modRuntime').then((r) => r.modRuntime)) };
    });
    await check('an agent app\'s call reaches the mod\'s Worker on the school\'s page, and its answer comes back through the broker', async () => {
      const r = await run(TOOL('echo'), { text: 'hi' });
      assert.deepEqual(r, { said: 'hi', page: 'course', due: ['Lab report'] });
      return r;
    });
    await check('a handler that throws answers with its error', async () => {
      assert.deepEqual(await run(TOOL('boom')), { ok: false, error: "The mod's tool failed: boom" });
    });
    await check('another account, or another school, is told to open its site', async () => {
      assert.deepEqual(await run(TOOL('echo'), { text: 'x' }, `${SCHOOL}/6`), { ok: false, error: TEXT.open });
      assert.deepEqual(await run(TOOL('echo'), { text: 'x' }, 'https://other.instructure.com/5'), { ok: false, error: TEXT.open.replace('school.instructure.com', 'other.instructure.com') });
    });
    await check('the mod turned off mid-call ends the call at once', async () => {
      await started(TOOL('slow'));
      await pause(1000);
      const { hosts } = await stats(page);
      await sw.evaluate(async ({ record, ID }) => chrome.storage.local.set({ [`mod:${ID}`]: { ...record, enabled: false } }), { record: RECORD, ID });
      const r = await ended(TOOL('slow'), 8000);
      assert.deepEqual(r.v, { ok: false, error: TEXT.stopped });
      assert.ok(r.ms < 5000, `${r.ms} ms`);
      await sw.evaluate(async ({ record, ID }) => chrome.storage.local.set({ [`mod:${ID}`]: record }), { record: RECORD, ID });
      await running(page, hosts);
      return { ms: r.ms };
    });
    await check('the page navigated away mid-call ends the call at once', async () => {
      await started(TOOL('slow'));
      await pause(1000);
      await page.goto(`${SCHOOL}/courses/26`);
      const r = await ended(TOOL('slow'), 8000);
      assert.deepEqual(r.v, { ok: false, error: TEXT.stopped });
      assert.ok(r.ms < 5000, `${r.ms} ms`);
      await running(page);
      return { ms: r.ms };
    });
    await check('a tool that never answers ends after 15 seconds', async () => {
      await started(TOOL('slow'));
      const r = await ended(TOOL('slow'), 25000);
      assert.deepEqual(r.v, { ok: false, error: TEXT.timeout });
      assert.ok(r.ms >= 14500 && r.ms < 18000, `${r.ms} ms`);
      // The page stays usable: the next call is answered.
      assert.deepEqual((await run(TOOL('echo'), { text: 'again' })).said, 'again');
      return { ms: r.ms };
    });
    await check('with the school\'s tab closed, the app is told to open it', async () => {
      await page.close();
      page = null;
      assert.deepEqual(await run(TOOL('echo'), { text: 'x' }), { ok: false, error: TEXT.open });
    });
    await check('no page errors, and nothing left the browser', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(external.filter((u) => !/\.(png|svg|woff2?|css|ico)(\?|$)/.test(u)), []);
    });
  } finally {
    await context?.close().catch(() => {});
    fs.writeFileSync(path.join(out, 'mods-tools-check.json'), JSON.stringify({ total, failed, results }, null, 2));
    fs.rmSync(path.join(scratch, 'profile'), { recursive: true, force: true });
    if (process.argv[2]) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} mod code tool browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
