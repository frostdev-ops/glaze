// Glaze Writer on the local Canvas (http://localhost:3000, ~/Projects/canvas-lms/glaze), as the seeded student, in a scratch
// copy of the extension that holds the local host. Mac only (CLAUDE.md: Canvas browser runs on the Mac, one at a time, under
// lockf). Signs in, then aborts every request that isn't a GET or a GraphQL query: nothing typed here reaches Canvas. Each
// send is pressed for real and its aborted request read back: the classic assignment's form POST (submission[body]) must
// hold exactly Writer's text. WRITER_SHOTS names where the screenshots go (a light and a dark Look each surface).
//   NODE_PATH=… PLAYWRIGHT_BROWSERS_PATH=… nice -n 10 lockf -k /private/tmp/claude-501/glaze-heavy.lock node checks/writer/writer-canvas-live-check.js [evidence directory]
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('../../tools/dev/check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '../../extension'));
const BASE = 'http://localhost:3000';
const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-canvas-live-'));
const shots = process.env.WRITER_SHOTS || path.join(out, 'shots');
const CREDS = Object.fromEntries(fs.readFileSync(path.join(os.homedir(), 'Projects/canvas-lms/glaze/credentials.env'), 'utf8').split('\n').map((l) => l.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const checks = [], errors = [], blocked = []; let passed = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 20000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(100); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
// What the page shows as text, from HTML, as Canvas's own empty check reads it (a page's DOMParser).
const textOf = (p, html) => p.evaluate((h) => new DOMParser().parseFromString(h, 'text/html').body.textContent, html);

(async () => {
  let context, tmp;
  try {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-canvas-live-'));
    // A scratch build that holds the local host, as checks/courses/canvas-boards-check.js makes one (CANVAS_LOCAL).
    const ext = env.staged(root, ['http://localhost/*']), mf = path.join(ext, 'manifest.json'), m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.content_scripts.find((s) => s.matches.includes('https://*.instructure.com/*')).matches.push('http://localhost/*');
    for (const w of m.web_accessible_resources) w.matches.push('http://localhost/*');
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...env.chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    env.noFirstRun(context); context.setDefaultTimeout(20000);
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const G = require(path.join(root, 'content/defaults.js'));
    const look = (preset) => G.GZ_SANITIZE({ navbar: { on: false }, preset, colors: { ...G.GZ_PRESETS.find(([n]) => n === preset)[1] }, enhance: { ...G.GZ_DEFAULTS.enhance, writer: true, drafts: true } });
    const wear = (preset) => worker.evaluate(async (s) => { await chrome.storage.sync.set(s); }, look(preset));
    await worker.evaluate(async () => { await chrome.storage.sync.clear(); });
    await wear('Paper');

    // ---- signed in, then nothing but GETs and GraphQL queries ----
    const page = await context.newPage();
    await page.goto(`${BASE}/login/canvas`);
    await page.fill('input[name="pseudonym_session[unique_id]"]', CREDS.STUDENT_EMAIL);
    await page.fill('input[name="pseudonym_session[password]"]', CREDS.STUDENT_PASSWORD || CREDS.PASSWORD);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.press('input[name="pseudonym_session[password]"]', 'Enter')]);
    await page.close();
    await context.route('**/*', (r) => {
      const req = r.request(), u = new URL(req.url());
      if (req.method() === 'GET' || u.protocol === 'chrome-extension:') return r.continue();
      const body = req.postData() || '';
      let query = false;
      if (u.pathname === '/api/graphql') { try { query = !/^\s*mutation\b/.test(JSON.parse(body).query || ''); } catch { query = false; } }
      if (query) return r.continue();
      blocked.push({ method: req.method(), path: u.pathname, body });
      return r.abort();
    });
    check(true, 'signed in as the student; from here every request but a GET or a GraphQL query is aborted');

    const open = async (url) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      await p.goto(`${BASE}${url}`);
      await p.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
      return p;
    };
    const box = async (p, kind) => {
      const el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 60) && h; }, `${kind} frame shown`);
      const fr = await until(() => el.contentFrame(), `${kind} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor in its frame`);
      return { el, fr };
    };
    const shot = async (p, el, name) => {
      fs.mkdirSync(shots, { recursive: true });
      await el.scrollIntoViewIfNeeded();
      const r = await el.evaluate((e) => { const b = (e.closest('form, [data-testid="DiscussionEdit-container"], #compose-message-modal [role="dialog"], #compose-message-modal') || e).getBoundingClientRect(); return { x: Math.max(0, b.left - 16), y: Math.max(0, b.top - 16), width: Math.min(innerWidth, b.width + 32), height: Math.min(innerHeight, b.height + 32) }; });
      const f = path.join(shots, name);
      await p.screenshot({ path: f, clip: r });
      return f;
    };
    const typeIn = async (p, b, text) => {
      await b.fr.click('.ProseMirror');
      await until(() => b.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'the caret in Writer');
      await p.keyboard.type(text, { delay: 2 });
      await until(async () => (await b.fr.evaluate(() => GZ_WRITER_FRAME.editor().text())).endsWith(text.split('\n').at(-1)), 'typed in Writer');
    };
    const writerText = (b) => b.fr.evaluate(() => GZ_WRITER_FRAME.editor().text());

    // ---- the classic assignment's Text Entry ----
    const A = '/courses/34/assignments/238';
    for (const [preset, dark] of [['Paper', false], ['Midnight', true]]) {
      await wear(preset);
      const p = await open(A);
      check(await p.evaluate(() => document.documentElement.hasAttribute('data-gz-dark-theme')) === dark, `${preset}: a ${dark ? 'dark' : 'light'} Look`);
      await p.click('.submit_assignment_link');
      const a = await box(p, 'assignment');
      check(await p.evaluate(() => getComputedStyle(document.querySelector('#submit_online_text_entry_form .rce-wrapper')).display === 'none'), `${preset}: Writer stands in for Canvas's Rich Content Editor on the live page`);
      const words = 'Reading response, live: the river keeps what the town forgets.\nSecond paragraph, typed and sent at once.';
      if (!dark) {
        await typeIn(p, a, words);
        const typed = await writerText(a);
        await shot(p, a.el, `assignment-${preset.toLowerCase()}.png`);
        const before = blocked.length;
        await p.click('#submit_online_text_entry_form button[type="submit"]');
        const sent = await until(() => blocked.slice(before).find((b) => b.method === 'POST' && /\/assignments\/238\/submissions$/.test(b.path)), 'the submission POST, aborted');
        const body = new URLSearchParams(sent.body).get('submission[body]');
        check(squash(await textOf(p, body)) === squash(typed), `the blocked submission's body is Writer's text (${squash(await textOf(p, body))})`);
        check(/<p>Reading response, live: the river keeps what the town forgets\.<\/p>\s*<p>Second paragraph, typed and sent at once\.<\/p>/.test(body), `in Canvas's dialect (${body.replace(/\n/g, '')})`);
      } else {
        await typeIn(p, a, 'A dark Look.');
        await shot(p, a.el, `assignment-${preset.toLowerCase()}.png`);
      }
      await p.close();
    }

    // ---- a reload: Canvas's own restore first, Writer's only into an empty box; one of them, never both ----
    {
      const p = await open(A);
      await p.click('.submit_assignment_link');
      const first = await until(() => p.evaluate(() => (document.querySelector('[data-testid="RCE_RestoreAutoSaveModal"]') ? 'canvas' : document.querySelector('iframe.gz-writer[data-gz-writer-frame="assignment"]:not([style*="opacity"])') ? 'writer' : '')), 'Canvas\'s restore dialog or Writer');
      let a;
      if (first === 'canvas') {
        check(await p.evaluate(() => !document.querySelector('iframe.gz-writer:not([style*="opacity"])')), 'Canvas\'s restore dialog comes first: Writer waits behind it');
        await p.click('[data-testid="RCE_RestoreAutoSaveModal"] button:has-text("Yes")');
        a = await box(p, 'assignment');
        check(squash(await writerText(a)).startsWith('A dark Look.') || squash(await writerText(a)).length > 0, `answered Yes: Writer opens on what Canvas restored (${squash(await writerText(a))})`);
        check(!await a.fr.evaluate(() => !!document.querySelector('.gw-offer')), 'and offers nothing of its own over it');
      } else {
        a = await box(p, 'assignment');
        const o = await until(() => a.fr.evaluate(() => document.querySelector('.gw-offer span')?.textContent), 'Writer\'s offer');
        check(/^Glaze kept a copy/.test(o), `no Canvas autosave to restore: Writer offers its own copy ("${o}")`);
        await a.fr.click('.gw-offer button:first-of-type');
        await until(async () => squash(await writerText(a)).length > 0, 'restored');
        check(true, `Restore puts it back (${squash(await writerText(a))})`);
      }
      await p.close();
    }

    // Canvas's autosave copies of what was typed here go (its RCE keeps them in this origin's localStorage for a day).
    const last = await open('/');
    const left = await last.evaluate(() => { const keys = Object.keys(localStorage).filter((k) => k.startsWith('rceautosave')); for (const k of keys) localStorage.removeItem(k); return Object.keys(localStorage).filter((k) => k.startsWith('rceautosave')).length; });
    check(left === 0, 'Canvas\'s autosave keys cleared');
    await last.close();

    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    passed = true;
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, errors, blocked: blocked.map((b) => ({ method: b.method, path: b.path, bytes: b.body.length })) }, null, 2) + '\n');
  }
})().catch((e) => { console.error(e); fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); process.exitCode = 1; });
