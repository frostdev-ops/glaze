// Writer's document tools for agent apps in a real Chromium (lib/mcp/writer.js, writer-mcp.js), headless, in a staged copy
// of the extension whose worker carries the step's wiring (test/helpers/mcp-writer-wiring.cjs) and a stubbed agent link:
// the check hands MCP lines to the worker's own connection code (mcpOpen, mcpLine) and reads what it sends back, as
// lib/agent-link.js would carry them (the copy's worker is a new file, the checkout's is untouched). A fixture paper, made
// by lib/writer-papers.js's own save, opens in papers.html; with agent access on, its Writer page connects. An app pairs
// in Glaze's approval window, lists the documents (opaque keys), reads the text, lists the issues Harper finds in the open
// editor, and asks for a fix and a citation: each waits in the approval window, worded by Glaze; Don't allow changes
// nothing, Allow changes the editor and the saved paper. Every request outside the extension is aborted.
// Shots: list-pair.png, fix-action.png, fixed.png.
//   NODE_PATH=<playwright> nice -n 10 node scripts/mcp-writer-check.js [shots folder]   (EXT selects the checkout)
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), assert = require('node:assert/strict');
const root = fs.realpathSync(process.env.EXT || path.join(__dirname, '..'));
const { wired } = require(path.join(root, 'test/helpers/mcp-writer-wiring.cjs'));
const PA = require(path.join(root, 'lib/writer-papers.js'));
const SRC = require(path.join(root, 'lib/writer-sources.js'));
const SCHEMA = require(path.join(root, 'lib/writer-schema.js'));

const KEY = 'doc:6f1e2d3c-4b5a-4968-8776-655443322110';
const PEER = { name: 'node', exe: '/usr/local/bin/claude', ppid: 4242, verified: false };
const CLIENT = { name: 'Claude Code', version: '2.1.0' };
const BOOK = { id: 's-morrison', type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }], issued: { 'date-parts': [[1987]] }, publisher: 'Knopf' };
const HTML = '<h1>Memory in Beloved</h1><p>Sethe remembers the house on Bluestone Road, and she is definately not alone there.</p><p>The tree on her back stays.</p>';
// The worker's connection code, for the check to speak MCP through; the agent link is a stub that keeps what it is sent.
const SHIM = `
globalThis.writerCheck = {
  out: [],
  on: async () => { await mcpConsent(true); await chrome.storage.local.set({ mcp: { on: true } }); },
  open: (c, peer) => mcpOpen(c, peer),
  line: (c, m) => mcpLine(c, JSON.stringify(m)),
  pages: () => (mcpWriterHub ? mcpWriterHub.size() : 0),
};
mcpLink = { send: (c, line) => { writerCheck.out.push([c, line]); }, close: () => {}, stop: async () => null, ensure: async () => ({ state: 'connected', at: null }), status: () => ({ state: 'connected', at: null }) };
`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const POLL = { polling: 50 };
const until = async (fn, label, ms = 15000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(80); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
let total = 0, failed = 0;
const check = async (name, test) => {
  total++;
  try { await test(); console.log(`ok ${name}`); } catch (e) { failed++; console.error(`FAIL ${name}: ${e.stack}`); }
};
// The paper and its source as the editor saves them.
const records = async () => {
  const s = {};
  const local = { get: async (k) => structuredClone(Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))), set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; } };
  await PA.open(local, () => Date.now() - 600e3, { versions: () => 40 }).save(KEY, { kind: 'paper', doc: SCHEMA.parse(SCHEMA.paper, HTML).toJSON(), format: 'mla9', keep: false, named: true, title: 'Memory in Beloved' });
  await SRC.save(SRC.keyOf({ school: 'local', user: { id: 'local' }, course: { id: 'papers' }, item: { id: KEY } }), [BOOK], local);
  return s;
};

(async () => {
  const lock = require('./check-env.js').lockPath();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-writer-'));
  const shots = path.resolve(process.argv[2] || path.join(scratch, 'shots'));
  fs.mkdirSync(shots, { recursive: true });
  let context, held = false;
  try {
    while (!held) {
      try { fs.mkdirSync(lock); held = true; } catch (e) { if (e.code !== 'EEXIST') throw e; await pause(1000); }
    }
    fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nmcp-writer-check\n`);
    const ext = require('./check-env.js').staged(root, [], scratch);
    // The staged files are hard links to the checkout: replace the worker's, never write through it.
    const worker0 = fs.readFileSync(path.join(ext, 'lib/background.js'), 'utf8');
    fs.rmSync(path.join(ext, 'lib/background.js'));
    fs.writeFileSync(path.join(ext, 'lib/background.js'), wired(worker0) + SHIM);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
      ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', locale: 'en-US',
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-quic'],
    });
    require('./check-env.js').noFirstRun(context);
    context.setDefaultTimeout(20000);
    const unexpected = [];
    await context.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.protocol === 'chrome-extension:') return r.continue(); unexpected.push(u.href); return r.abort(); });
    const worker = context.serviceWorkers().find((w) => w.url().endsWith('/lib/background.js')) || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`, APPROVE = `${base}/lib/mcp/approve.html`;
    await until(() => worker.evaluate(() => typeof globalThis.writerCheck?.open === 'function'), 'the worker loads the shim');
    const errors = [];
    const watch = (p, name) => {
      p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR_/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
    };
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ preset: 'Frost', enhance: { ...G.GZ_DEFAULTS.enhance, writer: true } });
    await worker.evaluate(async ({ settings, data }) => { await chrome.storage.sync.set(settings); await chrome.storage.local.set(data); }, { settings, data: await records() });
    await worker.evaluate(() => writerCheck.on());

    // ---- MCP through the worker's own connection code
    let ids = 0;
    const replies = async (c) => (await worker.evaluate((c) => writerCheck.out.filter(([n]) => n === c).map(([, l]) => l), c)).map((l) => JSON.parse(l));
    const send = (c, m) => worker.evaluate(([c, m]) => writerCheck.line(c, m), [c, m]);
    const call = async (c, name, args) => { const id = ++ids; await send(c, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }); return id; };
    const reply = (c, id, ms) => until(async () => (await replies(c)).find((m) => m.id === id), `the answer to ${id}`, ms);
    const approvals = () => context.pages().filter((p) => p.url() === APPROVE && !p.isClosed());
    const shown = async () => {
      const p = await until(() => approvals()[0], 'the approval window');
      watch(p, 'approval');
      await p.waitForFunction(() => document.getElementById('title').textContent.trim() && !document.getElementById('ask').hidden, null, POLL);
      await p.bringToFront();
      await p.waitForFunction(() => document.hasFocus() && document.getElementById('yes').getAttribute('aria-disabled') === 'false', null, POLL);
      return p;
    };
    const decide = async (p, id) => { await p.click(id); await until(() => p.isClosed() || !approvals().includes(p), 'the window closes'); };
    const json = (r) => { assert.equal(r.result?.isError, undefined, JSON.stringify(r)); return r.result.structuredContent; };

    // ---- the paper, open in Documents' editor
    const page = await context.newPage();
    watch(page, 'papers');
    await page.goto(`${base}/papers.html?paper=${encodeURIComponent(KEY)}`);
    await until(() => page.evaluate((k) => globalThis.GZ_WRITER_PAPER?.current()?.key() === k && document.querySelectorAll('.gp-sheet').length > 0, KEY), 'the paper open');
    const text = () => page.evaluate(() => GZ_WRITER_FRAME.editor().view.state.doc.textContent);
    const caret = (after) => page.evaluate((after) => {
      const v = GZ_WRITER_FRAME.editor().view;
      let at = null;
      v.state.doc.descendants((n, pos) => { if (at === null && n.isText && n.text.includes(after)) at = pos + n.text.indexOf(after) + after.length; });
      v.dispatch(v.state.tr.setSelection(GZ_PM.state.TextSelection.create(v.state.doc, at)));
      v.focus();
    }, after);
    const saved = () => worker.evaluate((k) => chrome.storage.local.get(`writerPaper:${k}`).then((r) => JSON.stringify(r[`writerPaper:${k}`]?.doc || null)), KEY);
    let doc = null;
    // Harper's issue for the misspelling as the open editor lists it now (a later lint numbers it afresh).
    const misspelt = async () => json(await reply(1, await call(1, 'document_issues', { document: doc.key }))).items.find((i) => i.text === 'definately');

    await check('the open paper\'s Writer page connects once agent access is on, and the worker admits it', async () => {
      await until(() => worker.evaluate(() => writerCheck.pages() === 1), 'the page admitted');
    });

    await check('an app pairs in the approval window, then lists the documents under opaque keys', async () => {
      await worker.evaluate((peer) => writerCheck.open(1, peer), PEER);
      await send(1, { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT } });
      assert.equal((await reply(1, 'init')).result.serverInfo.name, 'glaze');
      await send(1, { jsonrpc: '2.0', method: 'notifications/initialized' });
      await send(1, { jsonrpc: '2.0', id: 'list', method: 'tools/list' });
      const list = (await reply(1, 'list')).result.tools.map((t) => t.name);
      for (const n of ['documents_list', 'document_read', 'document_sources', 'document_assignment', 'document_issues', 'citation_insert', 'fix_apply']) assert.ok(list.includes(n), n);
      const id = await call(1, 'documents_list', {});
      const w = await shown();
      assert.equal(await w.evaluate(() => document.getElementById('title').textContent), 'Claude Code wants to use Glaze');
      await w.screenshot({ path: path.join(shots, 'list-pair.png') });
      await decide(w, '#yes');
      const r = json(await reply(1, id));
      assert.equal(r.items.length, 1);
      doc = r.items[0];
      assert.match(doc.key, /^document:[0-9a-f]{32}$/);
      assert.deepEqual([doc.title, doc.open, doc.assignment], ['Memory in Beloved', true, false]);
      assert.ok(!JSON.stringify(r).includes(KEY), 'the paper\'s own key stays in Glaze');
    });

    await check('document_read gives the saved text and its outline', async () => {
      const r = json(await reply(1, await call(1, 'document_read', { document: doc.key })));
      assert.equal(r.title, 'Memory in Beloved');
      assert.ok(r.text.startsWith('Memory in Beloved\nSethe remembers the house'), r.text);
      assert.deepEqual(r.outline, [{ level: 1, text: 'Memory in Beloved', offset: 0 }]);
      assert.equal(r.source, 'cache');
      const s = json(await reply(1, await call(1, 'document_sources', { document: doc.key })));
      assert.deepEqual(s.items.map((x) => x.title), ['Beloved']);
    });

    await check('document_issues lists what Harper finds in the open editor', async () => {
      await caret('there.');
      await until(() => page.evaluate(() => GZ_WRITER_ISSUES.list().some((i) => i.source === 'harper' && i.text === 'definately')), 'Harper\'s spelling issue', 60000);
      const r = json(await reply(1, await call(1, 'document_issues', { document: doc.key })));
      assert.equal(r.source, 'tab');
      const issue = r.items.find((i) => i.text === 'definately');
      assert.ok(issue?.suggestions.includes('definitely'), JSON.stringify(r.items));
      assert.equal(issue.kind, 'spelling');
    });

    await check('fix_apply waits in the approval window in Glaze\'s words; Don\'t allow changes nothing', async () => {
      const before = await text();
      const id = await call(1, 'fix_apply', { document: doc.key, issueId: (await misspelt()).id, suggestion: 'definitely' });
      const w = await shown();
      assert.equal(await w.evaluate(() => document.getElementById('title').textContent), 'Change "definately" to "definitely".');
      assert.equal(await w.evaluate(() => document.getElementById('app').textContent), 'Claude Code');
      await w.screenshot({ path: path.join(shots, 'fix-action.png') });
      await decide(w, '#no');
      const r = await reply(1, id);
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, /declined/);
      assert.equal(await text(), before);
    });

    await check('Allow applies the fix in the editor, and the paper saves it', async () => {
      const id = await call(1, 'fix_apply', { document: doc.key, issueId: (await misspelt()).id, suggestion: 'definitely' });
      await decide(await shown(), '#yes');
      const r = json(await reply(1, id));
      assert.deepEqual([r.ok, r.source], [true, 'tab']);
      assert.ok((await text()).includes('she is definitely not alone there.'));
      await until(async () => (await saved()).includes('definitely not alone'), 'the saved paper');
      await page.bringToFront();
      await page.screenshot({ path: path.join(shots, 'fixed.png') });
    });

    await check('citation_insert puts the citation it named at the caret', async () => {
      await caret('alone there');
      const id = await call(1, 'citation_insert', { document: doc.key, sourceId: BOOK.id, page: '12' });
      const w = await shown();
      assert.equal(await w.evaluate(() => document.getElementById('title').textContent), 'Insert the citation (Morrison 12) for "Beloved" at the caret.');
      await decide(w, '#yes');
      json(await reply(1, id));
      assert.ok((await text()).includes('alone there (Morrison 12).'), await text());
    });

    await check('a document no Writer page holds asks for nothing and says to open it', async () => {
      await page.goto('about:blank');
      await until(() => worker.evaluate(() => writerCheck.pages() === 0), 'the page gone');
      const before = approvals().length;
      const r = await reply(1, await call(1, 'fix_apply', { document: doc.key, issueId: 'harper:1', suggestion: 'definitely' }));
      assert.equal(r.result.isError, true);
      assert.match(r.result.content[0].text, /Open this document in Glaze Writer first/);
      await pause(300);
      assert.equal(approvals().length, before);
    });

    await check('nothing outside the extension was asked for', async () => assert.deepEqual(unexpected, []));
    await check('no page errors', async () => assert.deepEqual(errors, []));
  } finally {
    await context?.close().catch(() => {});
    if (!process.argv[2]) console.log(`shots: ${shots}`);
    fs.rmSync(path.join(scratch, 'profile'), { recursive: true, force: true });
    if (process.argv[2]) fs.rmSync(scratch, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
  }
  console.log(`${total - failed}/${total} Writer agent tool browser checks passed`);
  process.exitCode = failed ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 1; });
