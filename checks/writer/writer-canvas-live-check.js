// Glaze Writer on the local Canvas (http://localhost:3000, ~/Projects/canvas-lms/glaze), as the seeded student, in a scratch
// copy of the extension that holds the local host. Mac only (CLAUDE.md: Canvas browser runs on the Mac, one at a time, under
// lockf). Signs in, then aborts every request that isn't a GET or a GraphQL query: nothing typed here reaches Canvas. Each
// send is pressed for real and its aborted request read back: the classic assignment's form POST (submission[body]) must
// hold exactly Writer's text, and so must each reply's createDiscussionEntry (a topic's, a thread's, an announcement's) and
// a new Inbox message's createConversation. On a classic quiz (practice quiz 56, six essays, all on one page; quiz 57, one
// question at a time), every essay Canvas draws is Writer's: Canvas's own answer backup (…/submissions/backup) and Submit Quiz's
// POST must hold exactly Writer's text for each essay, and one question at a time, so must Next's record_answer.
// WRITER_SHOTS names where the screenshots go (a light and a dark Look each surface).
//   NODE_PATH=… PLAYWRIGHT_BROWSERS_PATH=… nice -n 10 lockf -k <the heavy-job lock, CLAUDE.md> node checks/writer/writer-canvas-live-check.js [evidence directory]
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
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, locale: 'en-US', args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
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
      await p.mouse.move(1, 1); // no hover tooltip over the frame
      const r = await el.evaluate((e) => { const b = (e.closest('.question, form, [data-testid="DiscussionEdit-container"], #compose-message-modal [role="dialog"], #compose-message-modal') || e).getBoundingClientRect(); return { x: Math.max(0, b.left - 16), y: Math.max(0, b.top - 16), width: Math.min(innerWidth, b.width + 32), height: Math.min(innerHeight, b.height + 32) }; });
      const f = path.join(shots, name);
      await p.screenshot({ path: f, clip: r });
      return f;
    };
    const typeIn = async (p, b, text) => {
      await until(async () => {
        await b.el.evaluate((f) => f.focus());
        return b.fr.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.Selection.atEnd(v.state.doc))); return !!document.activeElement?.closest('.ProseMirror'); });
      }, 'the caret in Writer');
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

    // ---- replies: a topic's, a thread's, an announcement's; Reply sends exactly Writer's text (createDiscussionEntry) ----
    const entry = (from) => until(() => blocked.slice(from).find((b) => b.path === '/api/graphql' && /createDiscussionEntry/i.test(b.body)), 'createDiscussionEntry, aborted');
    for (const [label, url, opener, preset] of [
      ['topic', '/courses/34/discussion_topics/80', '[data-testid="discussion-topic-reply"]', 'Paper'],
      ['topic', '/courses/34/discussion_topics/80', '[data-testid="discussion-topic-reply"]', 'Midnight'],
      ['thread', '/courses/34/discussion_topics/80', '[data-testid="threading-toolbar-reply"]', 'Paper'],
      ['announcement', '/courses/34/discussion_topics/78', '[data-testid="discussion-topic-reply"]', 'Paper'],
    ]) {
      await wear(preset);
      const p = await open(url);
      await p.locator(opener).first().click();
      const r = await box(p, 'reply');
      await until(() => p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="reply"]')), `${label}: the caret in Writer as the box opens`);
      await pause(1300); // Canvas focuses its RCE 1000 ms after it is up
      check(await p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="reply"]')), `${label} reply (${preset}): Writer takes the box and keeps the caret past Canvas's own focus`);
      if (label === 'announcement') check(await r.fr.evaluate(() => GZ_WRITER_FRAME.context().announcement === true), 'an announcement\'s reply says so in its context');
      const words = preset === 'Midnight' ? 'A dark Look on a reply.' : `${label === 'announcement' ? 'An' : 'A'} ${label} reply, live: the clearing remembers what the town will not.`;
      await typeIn(p, r, words);
      if (label === 'topic' || label === 'thread') await shot(p, r.el, `reply-${label}-${preset.toLowerCase()}.png`);
      if (preset === 'Midnight') { await p.close(); continue; }
      const from = blocked.length;
      await p.locator('[data-testid="DiscussionEdit-container"] [data-testid="DiscussionEdit-submit"]').first().click();
      const sent = await entry(from), message = JSON.parse(sent.body).variables?.message || '';
      check(squash(await textOf(p, message)) === squash(await writerText(r)) && message.includes(words), `${label}: the blocked createDiscussionEntry's message is Writer's text (${message})`);
      if (label === 'topic') {
        await p.locator('[data-testid="DiscussionEdit-cancel"]').first().click().catch(() => {});
        await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer[data-gz-writer-frame="reply"]')), 'Writer gone with Cancel');
        check(true, 'Cancel takes the box and Writer with it');
      }
      await p.close();
    }

    // ---- the Inbox: a new message in Writer; Send's createConversation holds exactly Writer's lines ----
    for (const preset of ['Paper', 'Midnight']) {
      await wear(preset);
      const p = await open('/conversations');
      await p.click('[data-testid="compose"]');
      const m = await box(p, 'message');
      check(await m.fr.evaluate(() => document.documentElement.dataset.dialect === 'plain'), `Inbox (${preset}): a new message opens in Writer, as plain text`);
      await p.click('input[data-testid="course-select-modal"]');
      await p.locator('[role="option"]', { hasText: 'College Writing' }).first().click();
      await p.click('input[data-testid="compose-modal-header-address-book-input"]');
      await p.keyboard.type('Avery', { delay: 20 });
      await p.locator('[role="menuitem"]', { hasText: 'Avery Chen' }).first().click();
      await p.fill('input[data-testid="subject-input"]', 'Lab question');
      const words = preset === 'Midnight' ? 'A dark Look in the Inbox.' : 'Hello Avery,\nCould we go over the lab write-up on Thursday?';
      await typeIn(p, m, words);
      await shot(p, m.el, `inbox-${preset.toLowerCase()}.png`);
      if (preset === 'Paper') {
        const typed = await writerText(m), from = blocked.length;
        await p.click('[data-testid="send-button"]');
        const sent = await until(() => blocked.slice(from).find((b) => b.path === '/api/graphql' && /createConversation|addConversationMessage/i.test(b.body)), 'createConversation, aborted');
        const body = JSON.parse(sent.body).variables?.body;
        check(body === typed && body === 'Hello Avery,\nCould we go over the lab write-up on Thursday?', `the blocked createConversation's body is Writer's lines (${JSON.stringify(body)})`);
      }
      await p.close();
    }

    // ---- a classic quiz: each essay Canvas draws is Writer's; its backup and Submit Quiz carry exactly Writer's text ----
    const essay = async (p, n) => {
      const el = await until(async () => {
        const f = (await p.evaluateHandle((i) => document.getElementById(`question_input_${i}`)?.closest('.ic-RichContentEditor')?.querySelector('iframe.gz-writer[data-gz-writer-frame="test"]'), n)).asElement();
        return f && await f.evaluate((x) => !x.style.opacity && x.offsetHeight > 60) && f;
      }, `essay ${n + 1} in Writer`, 30000);
      const fr = await until(() => el.contentFrame(), `essay ${n + 1} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `essay ${n + 1} editor`);
      return { el, fr, name: await p.evaluate((i) => document.getElementById(`question_input_${i}`).name, n) };
    };
    // Each essay's field in a blocked request equals that essay's text in Writer, read before the press (a submit Canvas
    // can't send leaves the page on the browser's error page).
    const texts = (list) => Promise.all(list.map(async (e) => [e.name, squash(await writerText(e))]));
    const holds = async (sent, wrote) => {
      const form = new URLSearchParams(sent.body), got = [];
      for (const [name, text] of wrote) got.push([name, squash(await textOf(reader, form.get(name) ?? '')), text]);
      return { ok: got.every(([, a, b]) => a && a === b), got };
    };
    const reader = await context.newPage();
    const quizPage = async (url) => { const p = await open(url); p.on('dialog', (d) => d.accept().catch(() => {})); return p; };
    const Q = '/courses/36/quizzes/56/take';
    for (const [preset, dark] of [['Paper', false], ['Midnight', true]]) {
      await wear(preset);
      const p = await quizPage(Q);
      const drawn = [];
      for (let n = 0; n < 5; n++) drawn.push(await essay(p, n));
      check(await p.evaluate(() => [...document.querySelectorAll('textarea.question_input')].slice(0, 5).every((t) => getComputedStyle(t.closest('.rce-wrapper')).display === 'none')), `quiz (${preset}): Writer stands in for each of the five essays Canvas draws first`);
      check(await drawn[0].fr.evaluate(() => GZ_WRITER_FRAME.kind() === 'test' && !GZ_WRITER_AI.allowed('writing') && !GZ_WRITER_AI.allowed('completion') && ![...document.querySelectorAll('#menu [role="menuitem"]')].some((b) => b.textContent.startsWith('Check with AI'))), `quiz (${preset}): an essay is a test, with no AI in it`);
      if (dark) { await typeIn(p, drawn[0], 'A dark Look on a quiz essay.'); await shot(p, drawn[0].el, 'quiz-midnight.png'); await p.close(); continue; }
      // The sixth, past maxInitRenderedRCEs: Canvas draws it once it scrolls into view, and Writer takes it then.
      await p.evaluate(() => document.querySelectorAll('.textarea-question-holder')[5].scrollIntoView());
      const sixth = await essay(p, 5);
      check(true, 'the sixth essay, drawn by Canvas once scrolled into view, is Writer\'s too');
      const all = [...drawn, sixth];
      for (const [n, e] of all.entries()) await typeIn(p, e, `Essay ${n + 1}, live: the river keeps the town ledger${n % 2 ? ', in two clauses' : ''}.`);
      await shot(p, drawn[0].el, 'quiz-paper.png');
      // Canvas backs answers up on an essay's change, at most once a second: the next keystroke after a pause carries them all.
      await pause(1200);
      const from = blocked.length;
      await typeIn(p, sixth, '!');
      const backup = await until(() => blocked.slice(from).find((b) => /\/quizzes\/56\/submissions\/backup$/.test(b.path)), 'Canvas\'s answer backup, aborted');
      const b = await holds(backup, await texts(all));
      check(b.ok, `Canvas's answer backup holds each essay's text as Writer has it (${JSON.stringify(b.got.map(([k, a]) => [k, a]))})`);
      const subFrom = blocked.length;
      await typeIn(p, drawn[2], ' Last words.');
      const wrote = await texts(all);
      await p.click('#submit_quiz_button');
      const sub = await until(() => blocked.slice(subFrom).find((x) => x.method === 'POST' && /\/quizzes\/56\/submissions$/.test(x.path)), 'Submit Quiz\'s POST, aborted');
      const s2 = await holds(sub, wrote);
      check(s2.ok && s2.got[2][1].endsWith('Last words.'), `Submit Quiz's POST holds each essay's text, the last words typed just before it included (${JSON.stringify(s2.got.map(([k, a]) => [k, a]))})`);
      await p.close();
    }
    // One question at a time (quiz 57): Next records the answer (record_answer); the last question's Submit Quiz sends it.
    {
      await wear('Paper');
      let p = await quizPage('/courses/36/quizzes/57/take');
      let e = await essay(p, 0);
      await typeIn(p, e, 'One at a time, first essay: the bridge was the only argument in town.');
      const from = blocked.length, first = await texts([e]);
      await p.click('button.next-question');
      const next = await until(() => blocked.slice(from).find((x) => x.method === 'POST' && /\/quizzes\/57\/submissions\/\d+\/record_answer$/.test(x.path)), 'Next\'s record_answer, aborted');
      const n1 = await holds(next, first);
      check(n1.ok, `one question at a time: Next's record_answer holds the essay's text as Writer has it (${JSON.stringify(n1.got)})`);
      await p.close();
      p = await quizPage('/courses/36/quizzes/57/take/questions/449');
      e = await essay(p, 0);
      check(e.name === 'question_449', 'the second question, by its own address, is Writer\'s too');
      await typeIn(p, e, 'Second essay, sent from the last page.');
      const subFrom = blocked.length, last = await texts([e]);
      await p.click('#submit_quiz_button');
      const sub = await until(() => blocked.slice(subFrom).find((x) => x.method === 'POST' && /\/quizzes\/57\/(submissions(\/\d+\/record_answer)?)$/.test(x.path)), 'the last page\'s Submit Quiz, aborted');
      const n2 = await holds(sub, last);
      check(n2.ok, `one question at a time: Submit Quiz on the last question holds its essay's text (${sub.path}: ${JSON.stringify(n2.got)})`);
      await p.close();
      await reader.close();
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
