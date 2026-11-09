// Glaze Writer on Canvas in the real unpacked extension, on the captured Canvas pages (test/fixtures/canvas-writer-*.html,
// local Canvas 1c9f0bb8) served at a Canvas host, each RCE redrawn by real TinyMCE 5.10.9 (pinned as
// checks/writer/writer-main-canvas-check.js pins it) with a small stand-in for what Canvas does around it: RCEWrapper's
// onInit (data-rich_text), wrapInitCb's change, tinymce-react's state, Canvas's Insert tools as commands, and the Text
// Entry form's submit, which reads the editor as getFormData's get_code does, refuses an empty one (#body_errors, the RCE
// focused) and is recorded instead of sent. Asserts, on the classic assignment: Writer takes the box (Canvas's wrapper
// hidden, its errors line kept), ⋯ says Canvas editor and offers Insert from Canvas; typing and pressing Submit at once
// submits exactly Writer's text (the flush hold); Canvas's empty-text check focuses Writer, not its hidden editor; a press
// Canvas's editor won't take is held with the reason shown; Canvas editor gives the box back with the text and the focus;
// Insert runs Canvas's tool at the end of the box; a box Writer can't keep stays Canvas's. Drafts: what Writer holds is kept
// and offered back in Writer when the box opens empty again (Restore, Dismiss), not once it was submitted; Canvas redrawing
// its editor within 10 s gets Writer's unsynced text; a dead frame leaves its text to copy. A classic quiz's essays: each
// RCE Canvas has drawn is Writer's as a test (no AI there), the one drawn later too; Canvas's answer backup (its change →
// get_code of every essay) carries Writer's text, and Submit Quiz, pressed at once after typing, submits every essay's last
// words. Assignments 2: Writer opens on the draft Canvas loaded; its Submit, pressed after typing, and pressed while the
// last words' draft is still to be saved (an earlier one just landed), sends exactly Writer's text, once Canvas's draft (createSubmissionDraft) holds
// it; a draft Canvas couldn't save holds the press with the reason shown. Every non-GET is aborted, but the Assignments 2
// stand-in's draft saves, answered here.
// glaze-remote -o <evidence directory> -- node checks/writer/writer-canvas-check.js /out (CLAUDE.md)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const env = require('../../tools/dev/check-env.js'), root = path.resolve(process.env.EXT || path.join(__dirname, '../../extension'));
const site = 'https://glaze-check.instructure.com';
const CDN = 'https://cdn.jsdelivr.net/npm/tinymce@5.10.9/';
const FILES = {
  'tinymce.min.js': '3c3041cb95a1c979ee2205901cf1c670a36c192ef089e6f63b94beabef386c30',
  'themes/silver/theme.min.js': '05f5cf013cd5b6c793f9d5f745350088d3c5686ba001197b7ce2e1cb8c961f99',
  'icons/default/icons.min.js': '6c5a69c090aa1418082e7ad5e707bbe6c531269607e080821a7089a16e0f2b61',
  'plugins/lists/plugin.min.js': '2e7d9385c8fd8248220ff2c5f34b30ad92a6bf34e65f05b611f24c9fd820a2a2',
};
const fixture = (f) => fs.readFileSync(path.join(__dirname, '../../test/fixtures', f), 'utf8');
const out = process.argv[2], lock = require('../../tools/dev/check-env.js').lockPath();
const checks = [], requests = [], errors = []; let passed = false;
let draftSave = { ms: 150, ok: true }; // how the Assignments 2 stand-in's draft saves are answered
let submitted = null; // the assignment's submission as Canvas's API answers it, once "submitted" (drafts: a posted copy)
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, label, ms = 10000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await pause(60); }
  throw Error(`${label} timed out${last ? `: ${last.message}` : ''}`);
};
const check = (v, label) => { assert.ok(v, label); checks.push(label); console.log(`ok ${label}`); };
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// The captured page, its RCE as Canvas mounts one before TinyMCE draws it (a textarea in the wrapper), its captured scripts
// and frames gone; the brandable_css links stay (they are how Glaze knows Canvas).
const ASSIGNMENT = (() => {
  const raw = fixture('canvas-writer-assignment.html'), from = raw.indexOf('<div id="tinymce-parent-of-submission_body"'), to = raw.indexOf('<div id="body_errors">');
  assert.ok(from > 0 && to > from, 'the assignment fixture has its RCE and errors line');
  const wrap = '<div id="tinymce-parent-of-submission_body" class="ic-RichContentEditor"><div class="canvas-rce__skins--root rce-wrapper" style="margin-bottom: 0.5rem;"><div style="display: block;"><textarea id="submission_body" style="height: 400px; resize: none;" name="submission[body]"></textarea></div><span id="submission_body_statusbar" data-testid="RCEStatusBar">0 words</span></div></div>\n          ';
  return (raw.slice(0, from) + wrap + raw.slice(to)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace('</body>', '<script src="/tinymce/tinymce.min.js"></script><script src="/gz-check/canvas.js"></script></body>');
})();
// The discussion topic's reply box, opened, its RCE remounted as Canvas mounts one (DiscussionEdit's own controls kept:
// Attach, Cancel, Reply), and the same stand-in for what Canvas does around it.
const DISCUSSION = (() => {
  const raw = fixture('canvas-writer-discussion.html'), c = raw.indexOf('<div data-testid="DiscussionEdit-container"'), from = raw.indexOf('<div class="canvas-rce__skins--root rce-wrapper"', c);
  const to = raw.indexOf('</span><div><span dir="ltr" direction="row" wrap="no-wrap"', from);
  assert.ok(c > 0 && from > c && to > from, 'the discussion fixture has its reply box');
  const wrap = '<div class="canvas-rce__skins--root rce-wrapper" style="margin-bottom: 0.5rem;"><div style="display: block;"><textarea id="message-body-root" data-testid="message-body" style="height: 300px;"></textarea></div></div>';
  return (raw.slice(0, from) + wrap + raw.slice(to)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace('</body>', '<script src="/tinymce/tinymce.min.js"></script><script src="/gz-check/discussion.js"></script></body>');
})();
// DiscussionEdit around its RCE (ui/features/discussion_topics_post/react/components/DiscussionEdit): tinymce-react's state
// on 'change keyup setcontent', Reply sending that state (createDiscussionEntry, recorded here), Cancel unmounting the box,
// and the RCE focused 1000 ms after it is up, its caret marked by an empty span.post_mention (PositionCursorHook.jsx).
const REPLY = `(() => {
  window.__entries = []; window.__state = '';
  tinymce.init({ selector: '#message-body-root', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists', height: 300,
    init_instance_callback: (ed) => {
      ed.getElement().dataset.rich_text = true;
      ed.on('change keyup setcontent', () => { __state = ed.getContent(); });
      // DiscussionEdit's onInit: a second later, focus and positionCursor's caret marker in the first paragraph.
      setTimeout(() => { ed.focus(); const p = ed.dom.select('p')[0]; p.innerHTML += '<span class="post_mention"></span>'; ed.selection.setCursorLocation(ed.dom.select('span.post_mention')[0], 0); }, 1000);
    } });
  const box = document.querySelector('[data-testid="DiscussionEdit-container"]');
  box.querySelector('[data-testid="DiscussionEdit-submit"]').addEventListener('click', () => __entries.push(__state));
  box.querySelector('[data-testid="DiscussionEdit-cancel"]').addEventListener('click', () => { tinymce.get('message-body-root').remove(); box.remove(); });
})();`;
// The Inbox's compose dialog as captured, with React's part played here (MessageBody, ui/features/inbox): the body's
// value tracked as React's inputValueTracking does, its state following onChange, Send sending that state (recorded here),
// the signature appended to the state once it has loaded (1.5 s) and the field disabled while translating (__translate).
// A course, a recipient and a subject are filled in, so the Inbox's own draft backup has a destination.
const INBOX = fixture('canvas-writer-inbox.html').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
  .replace('</body>', '<script src="/gz-check/inbox.js"></script></body>');
const MESSAGE = `(() => {
  document.documentElement.style.cssText = ''; // captured with the dialog open, the page held fixed; without Canvas's CSS it scrolls
  window.__sends = []; window.__body = '';
  const ta = document.querySelector('#compose-message-modal textarea[data-testid="message-body"]');
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  let tracked = '';
  Object.defineProperty(ta, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { tracked = String(v); desc.set.call(this, v); } });
  ta.addEventListener('input', () => { const now = desc.get.call(ta); if (now !== tracked) { tracked = now; __body = now; } });
  const render = (v) => { __body = v; ta.value = v; }; // setBody, then React writes the value
  setTimeout(() => render(__body + '\\n\\n---\\nSam Taylor'), 1500);
  window.__translate = (on) => { ta.disabled = on; ta.className = on ? 'css-1nh1ze9-textArea' : 'css-4y58qe-textArea'; }; // InstUI restyles it
  document.querySelector('[data-testid="send-button"]').addEventListener('click', () => __sends.push(__body));
  const set = (sel, v) => { const i = document.querySelector(sel); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, v); };
  set('input[data-testid="course-select-modal"]', 'ENG 1100');
  set('input[data-testid="subject-input"]', 'Lab question');
  const tag = document.createElement('span'); tag.setAttribute('data-testid', 'address-book-tag'); tag.id = 'address-book-label-2-user'; tag.textContent = 'Jordan Lee';
  document.querySelector('input[data-testid="compose-modal-header-address-book-input"]').before(tag);
})();`;
// The quiz take page (practice quiz 56) with its essays' RCEs as Canvas mounts them, a textarea in a wrapper, and what
// take_quiz does around them (ui/features/take_quiz/jquery/index.js): an essay's change backs up the whole form, each RCE's
// text read with get_code (getFormData); Submit Quiz sets the form's action and submits it, its essays' editors saved
// into their textareas, recorded instead of sent. Canvas draws only maxInitRenderedRCEs editors at first: the last essay
// here waits for __drawLast(), as one past the fifth waits to scroll into view.
const QUIZ = (() => {
  const raw = fixture('canvas-writer-quiz.html');
  assert.ok(raw.includes('id="submit_quiz_form"') && (raw.match(/class="form-control textarea-question-holder"/g) || []).length === 3, 'the quiz fixture has its form and three essays');
  return raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace('</body>', '<script src="/tinymce/tinymce.min.js"></script><script src="/gz-check/quiz.js"></script></body>');
})();
const TAKE = `(() => {
  window.__backups = []; window.__submits = [];
  const form = document.getElementById('submit_quiz_form');
  [...form.querySelectorAll('.textarea-question-holder')].forEach((h, n) => {
    h.innerHTML = '<div class="ic-RichContentEditor"><div class="canvas-rce__skins--root rce-wrapper" style="margin-bottom: 0.5rem;"><div style="display: block;"><textarea id="question_input_' + n + '" class="question_input" name="' + h.closest('.question').id + '" style="height: 300px; resize: none;"></textarea></div></div></div>';
  });
  const essays = [...form.querySelectorAll('textarea.question_input')];
  const answers = () => Object.fromEntries(essays.map((ta) => [ta.name, ta.dataset.rich_text ? tinymce.get(ta.id).getContent() : ta.value]));
  const init = (ta) => tinymce.init({ target: ta, base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists', height: 300,
    init_instance_callback: (ed) => { ta.dataset.rich_text = true; ed.on('change', () => ta.dispatchEvent(new Event('change', { bubbles: true }))); } });
  form.addEventListener('change', (e) => { if (e.target.matches('textarea.question_input')) __backups.push(answers()); });
  essays.slice(0, -1).forEach(init);
  window.__drawLast = () => init(essays.at(-1));
  document.getElementById('submit_quiz_button').addEventListener('click', (e) => { form.action = e.currentTarget.dataset.action; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    tinymce.triggerSave();
    __submits.push({ action: form.getAttribute('action'), answers: Object.fromEntries(essays.map((ta) => [ta.name, ta.value])) });
  });
})();`;
// Assignments 2 (assignment 253, the flag on for HIST 2010): the captured page, its RCE as Canvas mounts one, and what
// Canvas does around it (ui/features/assignments_show_student: TextEntry.jsx, SubmissionManager.jsx). The RCE opens on the
// draft Canvas loaded (?draft=), set in RCEWrapper's onInit right after data-rich_text; each change of tinymce-react's
// state marks the draft saving (Submit disabled) and saves it a second after the last one, through fetch, as Apollo does
// (CreateSubmissionDraft, answered by the check); Submit sends the draft as React last drew it, never the box. React 18
// draws a change from outside its own events a task later.
const ASSIGNMENT2 = (() => {
  const raw = fixture('canvas-writer-a2.html'), at = raw.indexOf('data-testid="text-editor"'), from = raw.indexOf('<div class="canvas-rce__skins--root rce-wrapper"', at);
  assert.ok(at > 0 && from > at && raw.includes('data-testid="submit-button"'), 'the Assignments 2 fixture has its RCE and Submit');
  let depth = 0, to = from;
  for (const m of raw.slice(from).matchAll(/<(\/?)div\b[^>]*>/g)) { depth += m[1] ? -1 : 1; if (!depth) { to = from + m.index + m[0].length; break; } }
  const wrap = '<div class="canvas-rce__skins--root rce-wrapper"><div style="display: block;"><textarea id="textentry_text" style="height: 300px; resize: none;"></textarea></div></div>';
  return (raw.slice(0, from) + wrap + raw.slice(to)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace('</body>', '<script src="/tinymce/tinymce.min.js"></script><script src="/gz-check/a2.js"></script></body>');
})();
const A2 = `(() => {
  window.__submits = []; window.__drafts = [];
  const ta = document.getElementById('textentry_text'), button = document.querySelector('[data-testid="submit-button"]');
  const loaded = new URLSearchParams(location.search).get('draft');
  let draft = loaded === null ? null : { body: loaded, meetsTextEntryCriteria: !!loaded }, status = null, drawn = { draft };
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { drawn = { draft }; button.disabled = status === 'saving'; };
  const render = () => ch.port2.postMessage(0);
  let last = null, timer = null, initted = false;
  const save = (body) => fetch('/api/graphql', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operationName: 'CreateSubmissionDraft',
    variables: { id: 'U3VibWlzc2lvbi0xMjYx', activeSubmissionType: 'online_text_entry', attempt: 1, body }, query: 'mutation CreateSubmissionDraft($id: ID!, $activeSubmissionType: DraftableSubmissionType!, $attempt: Int!, $body: String) { createSubmissionDraft(input: {submissionId: $id, activeSubmissionType: $activeSubmissionType, attempt: $attempt, body: $body}) { submissionDraft { body meetsTextEntryCriteria } errors { message } } }' }) })
    .then((r) => r.json()).then((j) => { const d = j.data.createSubmissionDraft; if (d.errors) throw Error('refused'); draft = d.submissionDraft; status = 'saved'; __drafts.push(body); render(); })
    .catch(() => { status = 'error'; render(); });
  const changed = (c) => {
    if (!initted || (draft === null && c === '') || c === last) return;
    last = c; status = 'saving'; render();
    clearTimeout(timer); timer = setTimeout(() => save(c), 1000);
  };
  tinymce.init({ selector: '#textentry_text', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists', height: 300,
    init_instance_callback: (ed) => {
      ta.dataset.rich_text = true;
      ed.setContent(draft?.body || ''); last = ed.getContent(); initted = true;
      let state = last;
      ed.on('change keyup setcontent', () => { const c = ed.getContent(); if (c !== state) { state = c; changed(c); } });
    } });
  button.addEventListener('click', () => { const d = drawn.draft; __submits.push(d?.meetsTextEntryCriteria ? { body: d.body } : { empty: true }); });
})();`;
// What Canvas does around an RCE, in the page (packages/canvas-rce RCEWrapper onInit, wrapInitCb, tinymce-react; the Text
// Entry form's submit, ui/features/submit_assignment/jquery/index.jsx). ?html= puts that in the box first.
const CANVAS = `(() => {
  window.__log = []; window.__submits = []; window.__commands = [];
  const ta = document.getElementById('submission_body');
  ta.value = new URLSearchParams(location.search).get('html') || '';
  tinymce.init({ selector: '#submission_body', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists', height: 400,
    setup: (ed) => {
      for (const c of ['mceInstructureImage', 'instructureRecord', 'mceInstructureDocuments', 'instructureEquation', 'instructureTrayForCourseLinks'])
        ed.addCommand(c, () => __commands.push({ c, collapsed: ed.selection.getRng().collapsed, atEnd: ed.selection.getRng().endOffset === ed.selection.getNode().childNodes.length || ed.selection.getRng().endContainer.nodeType === 3 && ed.selection.getRng().endOffset === ed.selection.getRng().endContainer.length, text: ed.getBody().textContent }));
    },
    init_instance_callback: (ed) => {
      const ta = ed.getElement();
      ta.dataset.rich_text = true;
      ed.on('change', () => ta.dispatchEvent(new Event('change', { bubbles: true })));
      ed.on('change keyup setcontent', () => __log.push('react ' + ed.getContent()));
    } });
  const form = document.getElementById('submit_online_text_entry_form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = tinymce.get('submission_body').getContent(), doc = new DOMParser().parseFromString(body, 'text/html');
    const empty = doc.querySelectorAll('*:not(p):not(html):not(head):not(body)').length === 0 && ![...doc.querySelectorAll('p')].some((p) => p.children.length > 0 || p.textContent.trim());
    if (empty) {
      document.getElementById('body_errors').textContent = 'Text entry must not be empty';
      document.getElementById('submission_body_ifr').contentWindow.document.body.focus();
      __submits.push({ empty: true });
      return;
    }
    __submits.push({ body, text: doc.body.textContent });
  });
})();`;

(async () => {
  let context, held = false, tmp, ext;
  try {
    for (let i = 0; ; i++) {
      try { fs.mkdirSync(lock); held = true; fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\nwriter-canvas-check\n`); break; }
      catch (e) { if (e.code !== 'EEXIST' || i >= 240) throw e; if (i % 12 === 0) console.error('[writer-canvas-check] waiting for heavy lock'); await pause(5000); }
    }
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-writer-canvas-'));
    const bytes = {};
    for (const [f, sha] of Object.entries(FILES)) {
      const b = Buffer.from(await (await fetch(CDN + f)).arrayBuffer());
      const got = crypto.createHash('sha256').update(b).digest('hex');
      if (got !== sha) throw Error(`TinyMCE 5.10.9 ${f} hash mismatch: ${got}`);
      bytes[f] = b;
    }
    check(true, 'real TinyMCE 5.10.9 fetched and pinned');

    ext = env.staged(root, [`${site}/*`]);
    await require('../../tools/dev/wait-for-browser.js')();
    context = await chromium.launchPersistentContext(path.join(tmp, 'profile'), { ...require('../../tools/dev/check-env.js').chromeLaunch(), headless: true, viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-background-networking'] });
    env.noFirstRun(context); context.setDefaultTimeout(10000);
    await context.route('**/*', async (r) => {
      const req = r.request(), u = new URL(req.url());
      if (u.protocol === 'chrome-extension:') return r.continue();
      requests.push({ method: req.method(), origin: u.origin, path: u.pathname });
      if (req.method() === 'POST' && u.origin === site && u.pathname === '/api/graphql' && JSON.parse(req.postData() || '{}').operationName === 'CreateSubmissionDraft') {
        const { ms, ok } = draftSave, body = JSON.parse(req.postData()).variables.body;
        requests.at(-1).answered = true;
        await pause(ms);
        return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { createSubmissionDraft: ok ? { submissionDraft: { body, meetsTextEntryCriteria: !!body }, errors: null } : { submissionDraft: null, errors: [{ message: 'not saved' }] } } }) }).catch(() => {});
      }
      if (req.method() !== 'GET' || u.origin !== site) return r.abort();
      const f = u.pathname.slice('/tinymce/'.length);
      if (u.pathname.startsWith('/tinymce/') && bytes[f]) return r.fulfill({ contentType: 'text/javascript', body: bytes[f] });
      if (u.pathname === '/gz-check/canvas.js') return r.fulfill({ contentType: 'text/javascript', body: CANVAS });
      if (u.pathname === '/gz-check/discussion.js') return r.fulfill({ contentType: 'text/javascript', body: REPLY });
      if (u.pathname === '/gz-check/inbox.js') return r.fulfill({ contentType: 'text/javascript', body: MESSAGE });
      if (u.pathname === '/gz-check/quiz.js') return r.fulfill({ contentType: 'text/javascript', body: TAKE });
      if (u.pathname === '/gz-check/a2.js') return r.fulfill({ contentType: 'text/javascript', body: A2 });
      if (req.isNavigationRequest() && u.pathname === '/courses/36/assignments/253') return r.fulfill({ contentType: 'text/html', body: ASSIGNMENT2 });
      if (req.isNavigationRequest() && u.pathname === '/courses/36/quizzes/56/take') return r.fulfill({ contentType: 'text/html', body: QUIZ });
      if (req.isNavigationRequest() && u.pathname === '/conversations') return r.fulfill({ contentType: 'text/html', body: INBOX });
      if (u.pathname === '/api/v1/courses') return r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 34, name: 'ENG 1100', course_code: 'ENG 1100', enrollments: [{ type: 'student', user_id: 3 }] }]) });
      if (req.isNavigationRequest() && u.pathname === '/courses/34/discussion_topics/80') return r.fulfill({ contentType: 'text/html', body: DISCUSSION });
      if (req.isNavigationRequest() && u.pathname === '/courses/34/assignments/238') return r.fulfill({ contentType: 'text/html', body: ASSIGNMENT });
      if (req.isNavigationRequest()) return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Blank</title>' });
      if (u.pathname === '/api/v1/courses/34/assignments/238/submissions/self') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(submitted || { body: null, workflow_state: 'unsubmitted' }) });
      if (u.pathname === '/api/v1/users/self/profile' || u.pathname === '/api/v1/users/self') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 3, name: 'Sam Taylor' }) });
      if (u.pathname.startsWith('/api/v1/')) return r.fulfill({ contentType: 'application/json', body: '[]' });
      return r.fulfill({ status: 404, body: '' });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const G = require(path.join(root, 'content/defaults.js'));
    const settings = G.GZ_SANITIZE({ navbar: { on: false }, footer: false, preset: 'Frost', enhance: { ...Object.fromEntries(Object.keys(G.GZ_DEFAULTS.enhance).map((k) => [k, false])), writer: true, drafts: true } });
    await worker.evaluate(async (settings) => { await chrome.storage.sync.clear(); await chrome.storage.local.clear(); await chrome.storage.sync.set(settings); }, settings);

    const open = async (url) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`page: ${e.message}`));
      p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
      await p.bringToFront();
      await p.goto(`${site}${url}`);
      await p.waitForFunction(() => document.documentElement.hasAttribute('data-gz-motion'));
      return p;
    };
    const box = async (p, kind) => {
      const el = await until(async () => { const h = await p.$(`iframe.gz-writer[data-gz-writer-frame="${kind}"]`); return h && await h.evaluate((f) => !f.style.opacity && f.offsetHeight > 100) && h; }, `${kind} frame shown`);
      const fr = await until(() => el.contentFrame(), `${kind} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `${kind} editor in its frame`);
      return { el, fr };
    };
    // The editor's text as Canvas submits it (getContent puts a line between blocks; the body's textContent runs them together).
    const tiny = (p) => p.evaluate(() => { const html = tinymce.get('submission_body').getContent(); return { html, text: new DOMParser().parseFromString(html, 'text/html').body.textContent }; });
    const writerText = (fr) => fr.evaluate(() => GZ_WRITER_FRAME.editor().text());
    const menu = async (fr, pick) => {
      const shown = () => fr.evaluate(() => !document.getElementById('menu').hidden);
      await until(async () => { if (!await shown()) await fr.click('#more'); await pause(200); return shown(); }, 'the ⋯ menu open');
      return pick ? fr.click(pick) : fr.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"], #menu [data-insert-head]')].map((b) => b.textContent));
    };
    const A = '/courses/34/assignments/238';
    // Submit pressed as the page's own click: the frame above it can still change height as its later parts load, and a
    // pointer click then lands on Writer (checks/writer/writer-canvas-live-check.js presses it with the pointer, live).
    const submit = (p) => p.evaluate(() => document.querySelector('#submit_online_text_entry_form button[type="submit"]').click());
        // Typing goes where the caret is: at the end of Writer's text, once its editor has the focus (placed there, not clicked:
    // a click can land while the frame is still settling its height).
    const typeIn = async (p, b, text) => {
      await until(async () => {
        await b.el.evaluate((f) => f.focus());
        return b.fr.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.Selection.atEnd(v.state.doc))); return !!document.activeElement?.closest('.ProseMirror'); });
      }, 'the caret in Writer');
      await p.keyboard.type(text, { delay: 0 });
    };

    // ---- Writer takes the Text Entry box ----
    let p = await open(A);
    let a = await box(p, 'assignment');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('.rce-wrapper')).display === 'none' && document.querySelector('iframe.gz-writer').nextElementSibling === document.querySelector('.rce-wrapper')), 'Writer stands in for the whole RCE, in its place; Canvas\'s wrapper is hidden');
    check(await p.evaluate(() => { const e = document.getElementById('body_errors'); return e.isConnected && getComputedStyle(e).display !== 'none' && !document.querySelector('.rce-wrapper').contains(e); }), '#body_errors stays outside the hidden wrapper, shown');
    check(await a.fr.evaluate(() => document.documentElement.dataset.site === 'canvas' && document.documentElement.dataset.dialect === 'canvas'), 'the frame writes Canvas\'s dialect');
    const items = await menu(a.fr);
    check(items[0] === 'Canvas editor' && JSON.stringify(items.slice(-6)) === JSON.stringify(['Insert from Canvas', 'Image', 'Media', 'Document', 'Equation', 'Course link']), `⋯: Canvas editor first, Insert from Canvas's five tools last (${items.join(', ')})`);
    await p.keyboard.press('Escape');
    // The menu shut, and the frame back to its own height (a menu opened below grows it), before anything else is clicked.
    let h0 = -1;
    await until(async () => { const h = await a.el.evaluate((f) => f.offsetHeight); const settled = h === h0 && await a.fr.evaluate(() => document.getElementById('menu').hidden); h0 = h; return settled; }, 'the menu shut and the frame settled');

    // ---- Canvas's empty-text check: the focus comes back to Writer ----
    await submit(p);
    await until(() => p.evaluate(() => __submits.length === 1), 'the empty submit checked');
    check(await p.evaluate(() => __submits[0].empty && document.getElementById('body_errors').textContent === 'Text entry must not be empty'), 'an empty box: Canvas\'s own check refuses it, its error shown below Writer');
    await until(() => p.evaluate(() => document.activeElement?.matches('iframe.gz-writer')), 'focus back in Writer');
    check(true, 'Canvas focusing its hidden editor puts the focus in Writer');
    await p.evaluate(() => { __submits.length = 0; });

    // ---- typing, then Submit at once: exactly Writer's text goes ----
    await typeIn(p, a, 'Reading response: the river is the archive.');
    await p.keyboard.press('Enter');
    await p.keyboard.type('- First point **kept** and the last words', { delay: 0 });
    await submit(p);
    await until(() => p.evaluate(() => __submits.length >= 1), 'the submit recorded');
    await pause(300); // a second submit, if the hold let two through, would be recorded by now
    const subs = await p.evaluate(() => __submits.slice());
    const typed = await writerText(a.fr);
    check(subs.length === 1, `one press, one submit (${subs.length})`);
    check(squash(subs[0].text) === squash(typed) && /the last words$/.test(squash(subs[0].text)), `Submit sends Writer's text, its last words included (${squash(subs[0].text)})`);
    check(/<ul>\s*<li>First point <strong>kept<\/strong> and the last words<\/li>\s*<\/ul>/.test(subs[0].body), `in Canvas's dialect (${subs[0].body.replace(/\n/g, '')})`);
    await p.evaluate(() => { __submits.length = 0; });

    // ---- a press Canvas's editor won't take is held, and says so ----
    await p.evaluate(() => { window.__get = tinymce.get; tinymce.get = () => null; });
    await typeIn(p, a, ' More.');
    await submit(p);
    const note = await until(() => a.fr.evaluate(() => { const n = document.getElementById('note'); return !n.hidden && n.textContent; }), 'the held note');
    check(note === 'Not sent: Canvas didn’t take your text. Try again.' && await p.evaluate(() => __submits.length === 0), `a write Canvas's editor refused holds the press, nothing submitted, and the bar says why ("${note}")`);
    await p.evaluate(() => { tinymce.get = window.__get; });
    await p.keyboard.type('!', { delay: 0 });
    await until(() => a.fr.evaluate(() => document.getElementById('note').hidden), 'the note gone');
    await until(async () => squash((await tiny(p)).text) === squash(await writerText(a.fr)), 'Canvas\'s editor in step again');
    check(true, 'the next edit clears the note and syncs again');

    // ---- ⋯ → Canvas editor: the box back, with the text and the focus ----
    await menu(a.fr);
    const before = await writerText(a.fr); // as it stands once the caret has left the text (autocorrect may finish a word then)
    await a.fr.click('#menu [data-do="native"]');
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer') && getComputedStyle(document.querySelector('.rce-wrapper')).display !== 'none'), 'the RCE back');
    const back = squash((await tiny(p)).text);
    check(back === squash(before), `Canvas editor gives the box back holding Writer's text (${back} | ${squash(before)})`);
    check(await until(() => p.evaluate(() => document.activeElement?.id === 'submission_body_ifr'), 'focus in the RCE'), 'and puts the caret in Canvas\'s editor');
    await p.close();

    // ---- ⋯ → Insert from Canvas → Image: Canvas's tool, at the end of the box ----
    p = await open(A);
    a = await box(p, 'assignment');
    await typeIn(p, a, 'An image goes after this');
    await until(async () => (await writerText(a.fr)) === 'An image goes after this', 'typed in Writer');
    await menu(a.fr, '#menu [data-insert="image"]');
    await until(() => p.evaluate(() => __commands.length === 1), 'Canvas\'s image tool run');
    const ran = await p.evaluate(() => __commands[0]);
    check(ran.c === 'mceInstructureImage' && ran.collapsed && ran.atEnd && ran.text === 'An image goes after this', `Insert → Image runs Canvas's own image tool, the caret at the end of Writer's text (${JSON.stringify(ran)})`);
    check(await p.evaluate(() => !document.querySelector('iframe.gz-writer') && getComputedStyle(document.querySelector('.rce-wrapper')).display !== 'none'), 'the box is Canvas\'s again for the picture');
    await p.close();

    // ---- what Writer can't keep stays Canvas's ----
    const refused = '<ul><li><p>a</p><p>b</p></li></ul>';
    p = await open(`${A}?html=${encodeURIComponent(refused)}`);
    await until(() => p.evaluate(() => document.documentElement.hasAttribute('data-gz-writer-main-canvas') && !document.querySelector('iframe.gz-writer')), 'the frame refused the box');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('.rce-wrapper')).display !== 'none' && !document.querySelector('[data-gz-writer]')), 'a box holding blocks inside a list item stays Canvas\'s, shown, unmarked');
    const kept = await tiny(p), wrote = await p.evaluate(() => __log.slice());
    check(kept.html.replace(/\s+/g, '') === refused && wrote.length === 0, `and nothing was written into it (${kept.html.replace(/\s+/g, '')}; ${wrote.join(' | ')})`);
    await p.close();

    // ---- drafts: kept, offered back in Writer, restored, dismissed; not once submitted ----
    const KEY = 'draft:canvas-rce:https://glaze-check.instructure.com/3/courses/34/assignments/238#submission_body';
    const stored = () => worker.evaluate(async (k) => { const all = await chrome.storage.local.get(null); return Object.entries(all).filter(([x]) => x === k || x.startsWith(`draft:pending:${encodeURIComponent(k)}`)).map(([, v]) => v.put?.text ?? v.text).filter(Boolean); }, KEY);
    const offerOf = (fr) => fr.evaluate(() => { const o = document.querySelector('.gw-offer'); return o && !o.hidden && { text: o.querySelector('span').textContent, buttons: [...o.querySelectorAll('button')].map((b) => b.textContent) }; });
    const KEPT = 'A paragraph Writer keeps while Canvas reloads, long enough to keep.';
    // What the pages above typed was kept too (and would be offered): this part starts with nothing kept.
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('draft:'))); });
    p = await open(A);
    a = await box(p, 'assignment');
    check(!await offerOf(a.fr), 'nothing to offer on a first visit');
    await typeIn(p, a, KEPT);
    await until(async () => (await stored()).includes(KEPT), 'Writer\'s copy kept', 15000);
    check(true, 'what Writer holds is kept a second after typing stops, under the box\'s own key');
    await p.close();
    p = await open(A);
    a = await box(p, 'assignment');
    const offer = await until(() => offerOf(a.fr), 'the offer in Writer');
    check(/^Glaze kept a copy of what you wrote here \(.+\)\.$/.test(offer.text) && offer.buttons.join() === 'Restore,Dismiss', `an empty box offers the copy back in Writer ("${offer.text}" ${offer.buttons.join(' ')})`);
    await a.fr.evaluate(() => document.querySelector('.gw-offer button:first-of-type').click());
    await until(async () => squash(await writerText(a.fr)) === KEPT && squash((await tiny(p)).text) === KEPT, 'restored into Writer and Canvas');
    check(!await offerOf(a.fr), 'Restore puts the copy in Writer and in Canvas\'s editor, and the offer goes');
    await p.close();
    p = await open(A);
    a = await box(p, 'assignment');
    await until(() => offerOf(a.fr), 'offered again on the next visit');
    await a.fr.evaluate(() => document.querySelector('.gw-offer button:last-of-type').click());
    check(!await offerOf(a.fr) && !squash(await writerText(a.fr)), 'Dismiss takes the offer away, the box left empty');
    await p.close();
    p = await open(A);
    a = await box(p, 'assignment');
    check(!await offerOf(a.fr), 'a dismissed copy isn\'t offered again');
    await typeIn(p, a, KEPT);
    await until(async () => (await stored()).includes(KEPT), 'kept again', 15000);
    await p.close();
    submitted = { body: `<p>${KEPT}</p>`, workflow_state: 'submitted', submitted_at: new Date().toISOString() };
    p = await open(A);
    a = await box(p, 'assignment');
    check(!await offerOf(a.fr), 'a copy whose text Canvas already has as the submission isn\'t offered');
    await until(async () => !(await stored()).length, 'the submitted copy gone');
    check(true, 'and it goes');
    submitted = null;

    // ---- Canvas redrawing its editor: Writer's unsynced words go into the new one ----
    await p.evaluate(() => { window.__get = tinymce.get; tinymce.get = () => null; });
    await typeIn(p, a, 'Words Canvas never took.');
    await until(() => a.fr.evaluate(() => GZ_WRITER_FRAME.editor().text() === 'Words Canvas never took.'), 'typed');
    await p.evaluate(() => {
      tinymce.get = window.__get;
      const ed = tinymce.get('submission_body'), wrap = ed.getElement().closest('.rce-wrapper').parentElement;
      ed.remove();
      wrap.innerHTML = '<div class="canvas-rce__skins--root rce-wrapper"><div style="display: block;"><textarea id="submission_body" name="submission[body]"></textarea></div></div>';
      tinymce.init({ selector: '#submission_body', base_url: '/tinymce', suffix: '.min', skin: false, content_css: false, menubar: false, statusbar: false, plugins: 'lists', height: 400,
        init_instance_callback: (e) => { e.getElement().dataset.rich_text = true; } });
    });
    a = await box(p, 'assignment');
    await until(async () => squash((await tiny(p)).text) === 'Words Canvas never took.' && squash(await writerText(a.fr)) === 'Words Canvas never took.', 'carried into the new editor');
    check(true, 'Canvas redrawing its editor within 10 s: Writer opens on it with its unsynced words and puts them in');

    // ---- a frame that keeps dying: its text left to copy, Canvas's editor holding what was synced ----
    for (let i = 0; i < 3; i++) {
      const f = await until(async () => { const h = await p.$('iframe.gz-writer'); return h && await h.evaluate((x) => !x.style.opacity) && h; }, `frame ${i + 1} up`);
      await f.evaluate((x) => { x.src = 'about:blank'; });
      await until(async () => !await f.evaluate((x) => x.isConnected), `frame ${i + 1} gone`);
    }
    const field = await until(() => p.evaluate(() => document.querySelector('textarea[data-gz-writer-recovery]')?.value), 'the recovery field');
    check(squash(field) === 'Words Canvas never took.' && squash((await tiny(p)).text) === 'Words Canvas never took.', `a dead frame: its text in a field to copy (${field}), Canvas's editor holding it too`);
    await p.close();

    // ---- a discussion reply: Writer in the topic's reply box; Ctrl/Cmd+Enter and Reply send exactly its text, once ----
    p = await open('/courses/34/discussion_topics/80');
    let r = await box(p, 'reply');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="DiscussionEdit-container"] .rce-wrapper')).display === 'none'
      && ['DiscussionEdit-cancel', 'DiscussionEdit-submit', 'attach-btn'].every((t) => document.querySelector(`[data-testid="${t}"]`).offsetHeight > 0)), 'Writer stands in for the reply\'s RCE; Attach, Cancel and Reply stay Canvas\'s, shown');
    await until(() => p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="reply"]')), 'the reply box focused', 5000);
    await pause(1300); // Canvas focuses its RCE 1000 ms after it is up: the focus must still be Writer's after that
    check(await p.evaluate(() => document.activeElement?.matches('iframe.gz-writer[data-gz-writer-frame="reply"]')), 'the reply box opens with the caret in Writer, and Canvas\'s focus a second later leaves it there');
    await r.fr.click('.ProseMirror');
    await until(() => r.fr.evaluate(() => !!document.activeElement?.closest('.ProseMirror')), 'the caret in Writer');
    await p.keyboard.type('I agree, and the river is also a ledger.', { delay: 0 });
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await until(() => p.evaluate(() => __entries.length >= 1), 'the reply sent');
    check(JSON.stringify(await p.evaluate(() => __entries)) === JSON.stringify(['<p>I agree, and the river is also a ledger.</p>']), `Ctrl/Cmd+Enter replies once, with exactly Writer's text (${await p.evaluate(() => JSON.stringify(__entries))})`);
    await p.evaluate(() => { __entries.length = 0; });
    await typeIn(p, r, ' More.');
    await p.evaluate(() => document.querySelector('[data-testid="DiscussionEdit-submit"]').click());
    await until(() => p.evaluate(() => __entries.length >= 1), 'Reply pressed');
    check(JSON.stringify(await p.evaluate(() => __entries)) === JSON.stringify(['<p>I agree, and the river is also a ledger. More.</p>']), 'Reply waits for Writer\'s last words, then sends them once');
    await p.evaluate(() => document.querySelector('[data-testid="DiscussionEdit-cancel"]').click());
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer') && !document.querySelector('[data-gz-writer]')), 'Writer gone with the box');
    check(true, 'Cancel: the box and Writer\'s frame go together, nothing left behind');
    await p.close();

    // ---- the Inbox: plain text in, Canvas's signature followed, Send and Ctrl/Cmd+Enter send Writer's lines ----
    await worker.evaluate(async () => { const all = await chrome.storage.local.get(null); await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('draft:'))); });
    p = await open('/conversations');
    let m = await box(p, 'message');
    check(await p.evaluate(() => { const ta = document.querySelector('#compose-message-modal textarea[data-testid="message-body"]'), field = ta.parentElement;
      return getComputedStyle(field).display === 'none' && getComputedStyle(field.closest('label[data-cid="TextArea"]')).display !== 'none'; }), 'Writer stands in for the Inbox\'s field, inside its label, which stays shown for Canvas\'s messages');
    check(await m.fr.evaluate(() => document.documentElement.dataset.dialect === 'plain' && ![...document.querySelectorAll('#menu [data-insert]')].length), 'plain text: no Insert from Canvas');
    await until(async () => (await writerText(m.fr)).includes('Sam Taylor'), 'the signature in Writer');
    check(true, 'Canvas\'s signature, added once loaded, shows in Writer');
    await until(async () => {
      await m.el.evaluate((f) => f.focus());
      return m.fr.evaluate(() => { const v = GZ_WRITER_FRAME.editor().view; v.focus(); v.dispatch(v.state.tr.setSelection(GZ_PM.state.Selection.atStart(v.state.doc))); return !!document.activeElement?.closest('.ProseMirror'); });
    }, 'the caret at the start');
    await p.keyboard.type('Hello Jordan,', { delay: 0 });
    await p.keyboard.press('Enter');
    await p.keyboard.type('**not bold** and "curled"', { delay: 0 });
    await p.evaluate(() => document.querySelector('[data-testid="send-button"]').click());
    await until(() => p.evaluate(() => __sends.length >= 1), 'Send pressed');
    const lines = await p.evaluate(() => __sends.slice());
    check(JSON.stringify(lines) === JSON.stringify(['Hello Jordan,\n**not bold** and “curled”\n\n---\nSam Taylor']), `Send sends Writer's lines as plain text, the signature kept, through React's own state (${JSON.stringify(lines)})`);
    await p.evaluate(() => { __sends.length = 0; });
    // A send already made waits for an edit before the keys send again (a held-down key sends once).
    await m.fr.evaluate(() => GZ_WRITER_FRAME.editor().focus());
    await p.keyboard.type(' Thanks.', { delay: 0 });
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await until(() => p.evaluate(() => __sends.length >= 1), 'sent with the keys');
    const keyed = await p.evaluate(() => __sends.slice());
    check(keyed.length === 1 && keyed[0].startsWith('Hello Jordan,\n**not bold** and “curled” Thanks.'), `Ctrl/Cmd+Enter sends once, with the last edit (${JSON.stringify(keyed)})`);
    // Translating: Canvas disables the field; the box is Canvas's until it is enabled again.
    await p.evaluate(() => __translate(true));
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer[data-gz-writer-frame="message"]')), 'Writer away while translating');
    check(await p.evaluate(() => document.querySelector('#compose-message-modal textarea[data-testid="message-body"]').value.startsWith('Hello Jordan,')), 'a disabled field (translating) is Canvas\'s, holding Writer\'s text');
    await p.evaluate(() => __translate(false));
    m = await box(p, 'message');
    check((await writerText(m.fr)).startsWith('Hello Jordan,'), 'enabled again: Writer back with the text');
    // ⋯ → Canvas editor: the field back; its own draft backup keeps what is typed there.
    await menu(m.fr);
    await m.fr.click('#menu [data-do="native"]');
    await until(() => p.evaluate(() => !document.querySelector('iframe.gz-writer') && getComputedStyle(document.querySelector('#compose-message-modal textarea[data-testid="message-body"]').parentElement).display !== 'none'), 'the field back');
    await p.focus('#compose-message-modal textarea[data-testid="message-body"]');
    await p.keyboard.press('End');
    await p.keyboard.type(' Typed in Canvas\'s own field, kept by the draft backup.', { delay: 0 });
    const inboxKey = await until(() => worker.evaluate(async () => { const all = await chrome.storage.local.get(null); return Object.entries(all).find(([k, v]) => (k.startsWith('draft:canvas:') || k.startsWith('draft:pending:draft%3Acanvas%3A')) && /kept by the draft backup/.test(v.put?.text ?? v.text ?? ''))?.[0]; }), 'the Inbox draft kept', 15000);
    check(true, `after Canvas editor, the Inbox's own draft backup keeps the field (${inboxKey.slice(0, 60)}…)`);
    await p.close();

    // ---- a classic quiz's essays: Writer's as tests, AI off; Canvas's backup and Submit Quiz carry each essay's words ----
    p = await open('/courses/36/quizzes/56/take');
    const essay = async (n) => {
      const el = await until(async () => {
        const f = (await p.evaluateHandle((i) => document.getElementById(`question_input_${i}`)?.closest('.textarea-question-holder')?.querySelector('iframe.gz-writer[data-gz-writer-frame="test"]'), n)).asElement();
        return f && await f.evaluate((x) => !x.style.opacity && x.offsetHeight > 60) && f;
      }, `essay ${n + 1} in Writer`);
      const fr = await until(() => el.contentFrame(), `essay ${n + 1} frame document`);
      await until(() => fr.evaluate(() => !!document.querySelector('.ProseMirror')), `essay ${n + 1} editor`);
      return { el, fr };
    };
    const essays = [await essay(0), await essay(1)];
    check(await p.evaluate(() => [...document.querySelectorAll('#submit_quiz_form .rce-wrapper')].slice(0, 2).every((w) => getComputedStyle(w).display === 'none' && w.previousElementSibling?.matches('iframe.gz-writer[data-gz-writer-frame="test"]'))), 'each essay Canvas has drawn: Writer stands in for its RCE, as a test');
    check(await p.evaluate(() => !document.getElementById('question_input_2').dataset.rich_text && !document.querySelectorAll('.textarea-question-holder')[2].querySelector('iframe.gz-writer')), 'an essay whose RCE Canvas hasn\'t drawn yet is left alone');
    const aiItem = (fr) => fr.evaluate(() => [...document.querySelectorAll('#menu [role="menuitem"]')].some((b) => b.textContent.startsWith('Check with AI')));
    check(items.some((t) => t.startsWith('Check with AI')) && !await aiItem(essays[0].fr) && await essays[0].fr.evaluate(() => GZ_WRITER_FRAME.kind() === 'test' && !GZ_WRITER_AI.allowed('writing') && !GZ_WRITER_AI.allowed('completion') && !GZ_WRITER_AI.outlineInfo().available),
      'AI off on a quiz essay: the assignment\'s ⋯ has Check with AI, the essay\'s hasn\'t, and no AI feature is allowed there');
    await typeIn(p, essays[0], 'First essay: the river keeps the town\'s accounts.');
    const backedUp = await until(async () => { const t = await writerText(essays[0].fr), b = await p.evaluate(() => __backups.at(-1)?.question_442); return b && squash(await p.evaluate((h) => new DOMParser().parseFromString(h, 'text/html').body.textContent, b)) === squash(t) && t.endsWith('accounts.') && b; }, 'the backup holds essay 1');
    check(/<p>First essay: the river keeps the town(’|'|&rsquo;)s accounts\.<\/p>/.test(backedUp), `Canvas's answer backup (its change, get_code) carries Writer's text (${backedUp})`);
    await p.evaluate(() => __drawLast());
    essays.push(await essay(2));
    check(true, 'the essay Canvas draws later (past maxInitRenderedRCEs) is Writer\'s once drawn');
    await typeIn(p, essays[1], 'Second essay, its last words typed and submitted at once');
    await typeIn(p, essays[2], 'Third essay, last words too');
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await pause(300);
    check(await p.evaluate(() => __submits.length === 0), 'Ctrl/Cmd+Enter never submits a quiz');
    await typeIn(p, essays[2], '!');
    await p.evaluate(() => document.getElementById('submit_quiz_button').click());
    await until(() => p.evaluate(() => __submits.length >= 1), 'Submit Quiz recorded');
    await pause(300);
    const quizSubs = await p.evaluate(() => __submits.slice()), inWriter = await Promise.all(essays.map((e) => writerText(e.fr)));
    const asText = (h) => p.evaluate((x) => new DOMParser().parseFromString(x, 'text/html').body.textContent, h);
    const got = await Promise.all(['question_442', 'question_446', 'question_447'].map(async (k) => squash(await asText(quizSubs[0].answers[k]))));
    check(quizSubs.length === 1 && quizSubs[0].action === '/courses/36/quizzes/56/submissions?user_id=3', `one press, one Submit Quiz (${quizSubs.length}, ${quizSubs[0].action})`);
    check(JSON.stringify(got) === JSON.stringify(inWriter.map(squash)) && got[2].endsWith('last words too!'), `Submit Quiz submits every essay's text as Writer holds it, last words included (${JSON.stringify(got)})`);
    await p.close();

    // ---- Assignments 2: Submit sends Canvas's saved draft, so it waits for that draft to hold Writer's text ----
    const draftOf = (q) => `/courses/36/assignments/253?draft=${encodeURIComponent(q)}`;
    // Pressed as a student can: as soon as Canvas has Submit on (it is off while a draft saves).
    const a2Submit = (p) => until(() => p.evaluate(() => { const b = document.querySelector('[data-testid="submit-button"]'); if (b.disabled) return false; b.click(); return true; }), 'Submit pressed', 10000);
    const a2Text = (p, h) => p.evaluate((x) => new DOMParser().parseFromString(x, 'text/html').body.textContent, h);
    p = await open(draftOf('<p>A saved draft.</p>'));
    let a2 = await box(p, 'assignment');
    check(await p.evaluate(() => getComputedStyle(document.querySelector('[data-testid="text-editor"] .rce-wrapper')).display === 'none' && document.querySelector('iframe.gz-writer').nextElementSibling?.matches('.rce-wrapper')), 'Assignments 2: Writer stands in for the Text Entry RCE');
    check(squash(await writerText(a2.fr)) === 'A saved draft.', `Writer opens on the draft Canvas loaded into its editor as it came up (${await writerText(a2.fr)})`);
    await typeIn(p, a2, ' And the last words, then Submit.');
    await a2Submit(p);
    await until(() => p.evaluate(() => __submits.length >= 1), 'Assignments 2 submitted', 15000);
    await pause(300);
    let a2Subs = await p.evaluate(() => __submits.slice()), a2Drafts = await p.evaluate(() => __drafts.slice()), inA2 = squash(await writerText(a2.fr));
    check(a2Subs.length === 1 && a2Subs[0].body && squash(await a2Text(p, a2Subs[0].body)) === inA2 && inA2.endsWith('then Submit.'), `Submit sends exactly Writer's text, once Canvas's draft holds it (${JSON.stringify(a2Subs)})`);
    check(a2Drafts.at(-1) === a2Subs[0].body, `the draft Canvas saved (createSubmissionDraft) is Writer's text (${a2Drafts.at(-1)})`);
    await p.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await pause(1500);
    check(await p.evaluate(() => __submits.length === 1), 'Ctrl/Cmd+Enter never submits an assignment');
    await p.close();

    // An earlier draft still on its way when the next words go in: Submit, on again once that earlier one lands, waits for
    // the draft of the last words.
    draftSave = { ms: 1500, ok: true };
    p = await open(draftOf('<p>Start.</p>'));
    a2 = await box(p, 'assignment');
    const posts = () => requests.filter((r) => r.answered).length, savesBefore = posts();
    await typeIn(p, a2, ' First words.');
    await until(() => posts() > savesBefore, 'the first draft save on its way', 5000);
    await typeIn(p, a2, ' Then the last ones.');
    await until(() => p.evaluate(() => !document.querySelector('[data-testid="submit-button"]').disabled && __drafts.length === 1), 'the earlier draft saved, Submit on', 10000);
    await a2Submit(p);
    await until(() => p.evaluate(() => __submits.length >= 1), 'submitted', 15000);
    a2Subs = await p.evaluate(() => __submits.slice());
    check(a2Subs.length === 1 && squash(await a2Text(p, a2Subs[0].body)) === 'Start. First words. Then the last ones.', `pressed while the last words' draft was still to be saved: Submit waits for it and sends them (${JSON.stringify(a2Subs)})`);
    await p.close();

    // A draft Canvas can't save: nothing is submitted, and Writer says so; once it saves, Submit goes.
    draftSave = { ms: 150, ok: false };
    p = await open(draftOf('<p>Kept here.</p>'));
    a2 = await box(p, 'assignment');
    await typeIn(p, a2, ' Not saved yet.');
    await until(() => p.evaluate(() => !document.querySelector('[data-testid="submit-button"]').disabled), 'Canvas\'s failed save turns Submit back on', 10000);
    await a2Submit(p);
    const heldNote = await until(() => a2.fr.evaluate(() => { const n = document.getElementById('note'); return n && !n.hidden && n.textContent; }), 'the held note', 20000);
    check(heldNote === 'Not sent: Canvas didn’t take your text. Try again.' && await p.evaluate(() => __submits.length === 0), `a draft Canvas couldn't save holds the press, nothing submitted, and the bar says why ("${heldNote}")`);
    draftSave = { ms: 150, ok: true };
    await typeIn(p, a2, ' Saved now.');
    await until(() => p.evaluate(() => __drafts.length === 1 && !document.querySelector('[data-testid="submit-button"]').disabled), 'saved', 10000);
    await a2Submit(p);
    await until(() => p.evaluate(() => __submits.length >= 1), 'submitted', 15000);
    a2Subs = await p.evaluate(() => __submits.slice());
    check(a2Subs.length === 1 && squash(await a2Text(p, a2Subs[0].body)) === 'Kept here. Not saved yet. Saved now.', `once Canvas saves it, Submit sends Writer's text (${JSON.stringify(a2Subs)})`);
    await p.close();

    const sent = requests.filter((r) => r.method !== 'GET' && !r.answered);
    check(sent.length === 0, `nothing but GETs and the stand-in's draft saves, answered here, left the page (${sent.map((r) => `${r.method} ${r.path}`).join(', ')})`);
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    passed = true;
  } finally {
    await context?.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    if (held) fs.rmSync(lock, { recursive: true, force: true });
    if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed, checks, errors }, null, 2) + '\n'); }
  }
})().catch((e) => { console.error(e); if (out) { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'failure.txt'), e.stack + '\n'); } process.exitCode = 1; });
