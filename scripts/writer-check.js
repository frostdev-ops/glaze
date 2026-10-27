// Glaze Writer in the real unpacked extension, on the synthetic Ultra boxes (test/fixtures/ultra-writer-*), each running the
// real Quill 1.3.7 (fetched, pinned by SHA-256) with Ultra's enabled-state and word count reproduced around it, so sync is
// tested against a real Quill. GETs only; no account or outside network from the browser.
// NODE_PATH=<playwright> nice -n 10 node scripts/writer-check.js [evidence directory]
// WRITER_SHOTS names where the screenshots go (default /tmp/gz-writer-shots).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('./check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '..'));
const site = 'https://bb.school.test';
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const ROUTES = {
  '/ultra/courses/_101_1/discussion/_9_1': 'ultra-writer-discussion.html', '/ultra/messages/create': 'ultra-writer-messages.html',
  '/ultra/courses/_101_1/assessment/_7_1/attempt/create': 'ultra-writer-attempt.html', '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1': 'ultra-writer-test.html',
};
const out = process.argv[2], shots = process.env.WRITER_SHOTS || '/tmp/gz-writer-shots', lock = require('./check-env.js').lockPath();
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const checks = [], requests = [], errors = []; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };

// In the page's world: a real Quill on each writable box, and Ultra's behaviour around it as the probe saw it: Post, Reply
// and Save Draft, an attempt's Save and Close and Submit (and here Send) disabled while the box is empty, the status bar's word count. Every button click counted.
const HARNESS = `(() => {
  window.__clicks = [];
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) __clicks.push(b.textContent.trim()); }, true);
  for (const c of document.querySelectorAll('.ql-container:not(.is-read-only)')) {
    const old = c.querySelector('.ql-editor'), html = old.innerHTML, id = old.id, role = old.getAttribute('role'), placeholder = old.getAttribute('data-placeholder');
    c.innerHTML = '';
    const q = new Quill(c, { placeholder });
    if (id) q.root.id = id;
    if (role) q.root.setAttribute('role', role);
    if (/[^\\s]/.test(html.replace(/<[^>]*>/g, ''))) q.setContents(q.clipboard.convert(html), 'silent');
    const form = c.closest('form'), panel = c.closest('.message-reply-container');
    const attempt = c.closest('bb-assignment-attempt-authoring-panel, bb-attempt-canvas');
    const buttons = attempt ? [...document.querySelectorAll('[data-analytics-id*="footer"], [analytics-id*="footer"]')] : [...(form ? form.querySelectorAll('.js-text-editor-save, .draft-button') : []), ...(panel ? panel.querySelectorAll('.send') : [])];
    const status = c.closest('.bb-editor-root')?.querySelector('.status-bar');
    const sync = () => { const t = q.getText().trim(); for (const b of buttons) b.disabled = !t; if (status) status.textContent = 'Word count: ' + (t ? t.split(/\\s+/).length : 0); };
    q.on('text-change', sync);
    sync();
  }
  window.__quill = (sel) => document.querySelector(sel).closest('.ql-container').__quill;
})();`;

(async () => {
  let context, held = false, tmp, ext;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-'));
    const quill = Buffer.from(await (await fetch(QUILL.url)).arrayBuffer());
    const got = crypto.createHash('sha256').update(quill).digest('hex');
    if (got !== QUILL.sha256) throw Error(`Quill 1.3.7 hash mismatch: ${got}`);
    fs.writeFileSync(path.join(tmp, 'quill.min.js'), quill);
    check(true, `real Quill 1.3.7 fetched and pinned (sha256 ${got.slice(0, 12)}…)`);

    ext = require('./check-env.js').staged(root, [`${site}/*`]);
    await require('./wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('./check-env.js').chromeLaunch(), headless: true, viewport: { width: 1440, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(10000);
    const grades = JSON.parse(fixture('ultra-writer-gradebook.json'));
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      if (u.pathname === '/gz-check/quill.js') return r.fulfill({ contentType: 'text/javascript', body: quill });
      if (u.pathname === '/gz-check/harness.js') return r.fulfill({ contentType: 'text/javascript', body: HARNESS });
      if (req.isNavigationRequest() && ROUTES[u.pathname]) return r.fulfill({ contentType: 'text/html', body: fixture(ROUTES[u.pathname]).replace('<head>', '<head><base href="/ultra/">').replace('</body>', '<script src="/gz-check/quill.js"></script><script src="/gz-check/harness.js"></script></body>') });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      let data = { results: [] };
      if (u.pathname.endsWith('/users/me')) data = { id: '_42_1', userName: 'synthetic' };
      else if (u.pathname.includes('/gradebook/grades')) data = grades;
      return r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'), id = new URL(worker.url()).host;
    const G = require(path.join(root, 'defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async ({ settings, site }) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); await chrome.storage.local.set({ ultra: [site] }); }, { settings, site });
    const opts = await context.newPage(); await opts.goto(`chrome-extension://${id}/popup.html`); await env.ultraReady(opts); await opts.close();

    const open = async (url) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
      await p.goto(`${site}${url}`);
      await p.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
      return p;
    };
    // A box's frame, once it is shown in the box's place, and the frame's document.
    const box = async (p, kind) => {
      const el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && h; }, `${kind} frame shown`);
      const fr = await until(() => el.contentFrame(), `${kind} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor in its frame`);
      return { el, fr };
    };
    const quillText = (p, sel) => p.evaluate((s) => __quill(s).getText().replace(/\n$/, ''), sel);
    const clicks = (p) => p.evaluate(() => __clicks.slice());
    const shot = async (target, name) => { fs.mkdirSync(shots, { recursive: true }); await pause(300); const f = path.join(shots, name); await target.screenshot({ path: f }); return f; };
    const saved = {};

    // ---- a discussion: the composer and a reply ----
    let p = await open('/ultra/courses/_101_1/discussion/_9_1');
    const reply = await box(p, 'reply'), post = await box(p, 'post');
    const REPLY = '.ql-editor[data-placeholder="Type a reply"]', POST = '.ql-editor[data-placeholder="Type a post"]';
    check(await p.evaluate(() => [...document.querySelectorAll('[data-gz-writer]')].every((r) => getComputedStyle(r).display === 'none' && r.isConnected)), 'discussion: post and reply boxes mount; Ultra\'s editors stay in the page, hidden');
    check(await reply.fr.evaluate(() => document.documentElement.dataset.mode === 'compose' && document.documentElement.dataset.kind === 'reply'), 'reply box mounts in compose mode');
    check(await p.evaluate(() => !document.querySelector('.gz-draft')), 'draft backup offers nothing beside a Writer box');
    check(await p.evaluate(() => document.querySelectorAll('.form-buttons button')[2].disabled && document.querySelectorAll('.form-buttons button')[5].disabled), 'Post and Reply start disabled (empty boxes)');
    await reply.fr.click('.ProseMirror');
    const typed = 'I agree that the river works as a kind of archive, but Morrison is less interested in nostalgia than in what the town chooses to forget.';
    await p.keyboard.type(typed, { delay: 2 });
    await until(async () => (await quillText(p, REPLY)) === typed, 'reply text in the native Quill');
    check(true, 'typing in the frame updates the native Quill (getText equals)');
    check(await p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="reply"]')) && await reply.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'focus stays in the frame while Quill syncs');
    check(await p.evaluate(() => !document.querySelectorAll('.form-buttons button')[5].disabled && document.querySelectorAll('.form-buttons button')[2].disabled), 'Reply enables with content; Post stays disabled');
    check(await p.evaluate((s) => /Word count: 26/.test(document.querySelector(s).closest('.bb-editor-root').querySelector('.status-bar').textContent), REPLY), 'Ultra\'s word count follows');
    await p.keyboard.press(`${MOD}+A`); await p.keyboard.press('Backspace');
    await until(async () => (await quillText(p, REPLY)) === '', 'native Quill emptied');
    check(await p.evaluate(() => document.querySelectorAll('.form-buttons button')[5].disabled), 'emptying the frame disables Reply again');
    await p.keyboard.type(typed, { delay: 2 });
    await until(async () => (await quillText(p, REPLY)) === typed, 'reply text back');
    // The mockup's compose box, at 1440px: the post, the reply box and Ultra's own buttons.
    await p.evaluate(() => document.activeElement.blur?.());
    await reply.fr.click('.ProseMirror');
    saved.compose = await shot(await p.$('.comment-and-reply'), 'writer-compose.png');
    saved.page = path.join(shots, 'writer-compose-page.png'); await p.screenshot({ path: saved.page, fullPage: true });
    // Unsolicited native clears must not erase the live draft.
    await p.evaluate((s) => __quill(s).setContents([], 'user'), REPLY); await pause(150);
    check(await reply.fr.evaluate((t) => document.querySelector('.ProseMirror').textContent === t, typed), 'an unsolicited native clear preserves Writer text');
    // The selection toolbar and ⋯ (mockup B).
    await reply.fr.evaluate(() => { const v = document.querySelector('.ProseMirror'), t = v.firstChild.firstChild, r = document.createRange(); r.setStart(t, 2); r.setEnd(t, 40); getSelection().removeAllRanges(); getSelection().addRange(r); });
    await until(() => reply.fr.evaluate(() => !document.getElementById('tb').hidden), 'selection toolbar');
    check(true, 'a selection shows the toolbar');
    await reply.fr.click('#tb [data-run="bold"]');
    await until(async () => (await p.evaluate((s) => document.querySelector(s).innerHTML, REPLY)).includes('<strong>'), 'bold reaches Quill');
    check(true, 'toolbar Bold reaches the native Quill as <strong>');
    saved.toolbar = await shot(reply.el, 'writer-toolbar.png');
    const originalWidth = await reply.el.evaluate((f) => f.style.width);
    await reply.el.evaluate((f) => { f.style.width = '180px'; });
    await pause(150);
    check(await reply.fr.evaluate(() => { const r = document.getElementById('tb').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), 'selection toolbar stays inside a narrow editor');
    await reply.el.evaluate((f, w) => { f.style.width = w; }, originalWidth);
    await reply.fr.click('.ProseMirror');
    await p.keyboard.press('End');
    await p.keyboard.press(`${MOD}+Enter`);
    await pause(400);
    check((await clicks(p)).filter((c) => c === 'Reply').length === 1, 'Ctrl/Cmd+Enter clicks the native Reply once');
    // Ultra clears its box after a post: the frame follows.
    await p.evaluate((s) => __quill(s).setContents([], 'user'), REPLY);
    await until(() => reply.fr.evaluate(() => document.querySelector('.ProseMirror').textContent === ''), 'frame cleared with Ultra\'s editor');
    check(true, 'Ultra clearing its own editor clears the frame');
    await post.fr.click('.ProseMirror');
    await p.keyboard.press(`${MOD}+Enter`);
    await pause(400);
    check(!(await clicks(p)).includes('Post'), 'Ctrl/Cmd+Enter in an empty box clicks nothing (Post disabled)');
    // Back to Blackboard's editor, with the text.
    await reply.fr.click('.ProseMirror');
    await p.keyboard.type('Back to Blackboard.', { delay: 2 });
    await until(async () => (await quillText(p, REPLY)) === 'Back to Blackboard.', 'text before going back');
    await reply.fr.click('#more');
    await until(() => reply.fr.evaluate(() => !document.getElementById('menu').hidden), 'menu');
    saved.menu = await shot(reply.el, 'writer-menu.png');
    await reply.el.evaluate((f) => { f.style.width = '180px'; });
    await reply.fr.click('#more'); await reply.fr.click('#more');
    check(await reply.fr.evaluate(() => { const r = document.getElementById('menu').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }), 'Blackboard editor menu stays inside a narrow editor');
    saved.narrow = await shot(reply.el, 'writer-narrow-menu.png');
    await reply.el.evaluate((f, w) => { f.style.width = w; }, originalWidth);
    check(await reply.fr.evaluate(() => document.activeElement?.dataset.do === 'native'), '⋯ opens its menu with "Blackboard editor" focused');
    await p.keyboard.press('Enter');
    await until(() => p.evaluate(() => !document.querySelector('iframe[data-gz-writer-frame="reply"]')), 'reply frame gone');
    check(await p.evaluate((s) => { const r = document.querySelector(s).closest('bb-rich-text-editor'); return getComputedStyle(r).display !== 'none' && !r.hasAttribute('data-gz-writer') && document.querySelector(s).textContent === 'Back to Blackboard.'; }, REPLY), '"Blackboard editor" restores the native editor with the text');
    await p.evaluate((s) => __quill(s).insertText(0, 'x', 'user'), REPLY); await pause(800);
    check(await p.evaluate(() => !document.querySelector('iframe[data-gz-writer-frame="reply"]')), 'and it stays Ultra\'s through later passes');
    // A failed or forged sync keeps the entire draft in Writer, including on hand-back.
    await p.evaluate((s) => {
      const c = document.querySelector(s).closest('.ql-container');
      window.__savedQuill = c.__quill; delete c.__quill;
      document.addEventListener('gz-writer:set', (e) => { const m = JSON.parse(e.detail); document.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: true, html: m.html }) })); });
    }, POST);
    await post.fr.click('.ProseMirror');
    const kept = 'Every word stays in Writer when native sync fails.';
    await p.keyboard.type(kept, { delay: 2 });
    check(await post.fr.evaluate((t) => document.querySelector('.ProseMirror').textContent === t, kept), 'failed sync retains the complete draft in the live frame');
    await post.fr.click('#more'); await post.fr.click('[data-do="native"]');
    check(await post.el.isVisible() && await quillText(p, REPLY) !== kept, 'a forged success cannot hand back an unsynced draft');
    await p.evaluate((s) => { document.querySelector(s).closest('.ql-container').__quill = __savedQuill; }, POST);
    await post.fr.click('#more'); await post.fr.click('[data-do="native"]');
    await until(() => p.evaluate(() => !document.querySelector('iframe[data-gz-writer-frame="post"]')), 'hand-back after native recovery');
    check(await quillText(p, POST) === kept, 'native recovery receives every word before the frame closes');
    await p.close();

    // ---- messages ----
    p = await open('/ultra/messages/create?courseId=_101_1');
    const msg = await box(p, 'message');
    await msg.fr.click('.ProseMirror');
    await p.keyboard.type('Could you share the reading list?', { delay: 2 });
    await until(async () => (await quillText(p, '#message-reply')) === 'Could you share the reading list?', 'message in Quill');
    check(await p.evaluate(() => !document.querySelector('.send').disabled), 'message box mounts and Send enables with content');
    await p.keyboard.press(`${MOD}+Enter`); await pause(400);
    check((await clicks(p)).filter((c) => c === 'Send').length === 1, 'Ctrl/Cmd+Enter clicks Send once');
    await p.close();

    // ---- attempts ----
    await worker.evaluate(() => chrome.runtime.onMessage.addListener((m) => { if (m?.type === 'glaze:attempt-kind') (globalThis.__kinds ||= []).push(m.kind); }));
    p = await open('/ultra/courses/_101_1/assessment/_7_1/attempt/create');
    const paper = await box(p, 'assignment');
    check(await paper.fr.evaluate(() => document.documentElement.dataset.mode === 'paper' && document.querySelector('.ProseMirror').textContent === "Toni Morrison's Beloved treats memory less as a record than as a debt."), 'assignment attempt mounts in paper mode with the saved text imported');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('[class*="makeStylespreview-"]')).display !== 'none'), 'its file area stays Ultra\'s, in view');
    check(await p.evaluate(() => !document.querySelector('[data-analytics-id="assignment.attempt.authoring.footer.submit"]').disabled), 'Submit enabled with the imported text');
    await paper.fr.click('.ProseMirror'); await p.keyboard.press(`${MOD}+Enter`); await pause(400);
    check(!(await clicks(p)).includes('Submit'), 'Ctrl/Cmd+Enter never submits an attempt');
    check((await until(() => worker.evaluate(() => globalThis.__kinds?.filter((k) => k !== 'unknown')), 'attempt kind told')).join() === 'assignment', 'the top frame tells the worker the attempt is an assignment, once');
    await p.close();
    p = await open('/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1');
    const essay = await box(p, 'test');
    check(await essay.fr.evaluate(() => document.documentElement.dataset.mode === 'compose' && document.documentElement.dataset.kind === 'test'), 'test attempt\'s Additional content mounts in compose mode as a test');
    await essay.fr.click('.ProseMirror');
    await p.keyboard.type('See the attached diagram.', { delay: 2 });
    await until(async () => (await quillText(p, '.ql-editor[contenteditable="true"]')) === 'See the attached diagram.', 'test answer in Quill');
    check(await p.evaluate(() => !document.querySelector('[analytics-id="course.content.assessment.footer.buttons.submit"]').disabled), 'the test\'s Submit follows content');
    await p.keyboard.press(`${MOD}+Enter`); await pause(400);
    check(!(await clicks(p)).some((c) => c === 'Submit' || c === 'Save and Close'), 'Ctrl/Cmd+Enter never saves or submits a test');
    check((await until(() => worker.evaluate(() => globalThis.__kinds?.includes('test') && globalThis.__kinds.filter((k) => k !== 'unknown')), 'test kind told')).join() === 'assignment,test', 'and a test\'s attempt a test');
    await p.close();

    check(errors.length === 0, `no page or frame errors (${errors.join('; ')})`);
    check(requests.every((r) => r.method === 'GET' && r.origin === site), 'every LMS request is a synthetic GET');
    passed = true;
    console.log(JSON.stringify({ checks: checks.length, shots: saved }, null, 2));
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (ext) fs.rmSync(ext, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, requests, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
