// A synthetic Blackboard Ultra for practising with Glaze Writer (scripts/writer-practice.js): a discussion to post and reply
// in and an assignment attempt to submit, in the probed shapes (test/fixtures/ultra-practice-discussion.html,
// ultra-practice-attempt.html), the GETs Glaze reads answered from the writer fixtures, and Ultra's own side of each Quill box
// as the probe and the live audit saw it (glaze-plans/writer/probe/notes.md, glaze-plans/writer/audit/progress.md): the
// new post collapsed until its click, Post and Save Draft enabled only through Ultra's model, a reply opened by Reply, the
// attempt's file area and footer. Posting, uploading and submitting are the mock's own POSTs: each is kept, shown back on
// the page and written to the received folder. Never probed live, so approximated: those requests' paths and bodies, the
// upload, non-empty attempt enablement, Ultra's submit confirmation and its receipt. Synthetic data only.
// Quill 1.3.7 is a stand-in for Ultra's 1.x fork; Angular/React callbacks are modelled here, not loaded from Blackboard.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const DT = require('../lib/doctext.js');

const SITE = 'https://bb.school.test';
const COURSE = '_101_1', FORUM = '_1101_1';
const ROUTES = { discussion: `/ultra/courses/${COURSE}/discussion/_9_1`, attempt: `/ultra/courses/${COURSE}/assessment/_7_1/attempt/create` };
const BOARD = `/learn/api/v1/courses/${COURSE}/discussionboards/default/forums/${FORUM}/messages`;
// Stand-ins: Ultra's own upload and submit requests weren't probed (an upload and a submission are writes).
const UPLOAD = '/learn/api/v1/practice/uploads', ATTEMPT = `/learn/api/v1/courses/${COURSE}/contents/_7_1/attempts`;
const QUILL = { url: 'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js', sha256: 'c675f57388d3598637c4e0f9fe154bd61dfb1c2086271f944a0bb2b9b059b074' };
const ME = { id: '_900_1', userName: 'practice', givenName: 'Alex', familyName: 'Rivera' };
const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fixture = (f) => fs.readFileSync(path.join(__dirname, '../test/fixtures', f), 'utf8');
const json = (f) => JSON.parse(fixture(f));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Quill 1.3.7, pinned, kept in `dir` after the first fetch.
const quill = async (dir, signal) => {
  const f = path.join(dir, 'quill-1.3.7.min.js');
  const b = fs.existsSync(f) ? fs.readFileSync(f) : Buffer.from(await (await fetch(QUILL.url, { signal })).arrayBuffer());
  if (sha(b) !== QUILL.sha256) throw Error(`Quill 1.3.7 hash mismatch: ${sha(b)}`);
  if (!fs.existsSync(f)) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(f, b); }
  return b;
};

// What Glaze reads, from the writer fixtures: the student, their courses (the practice course named as the paper fixtures
// name it), the gradebook (the assignment, a test, and the discussion's column, as scripts/writer-compose-check.js adds
// it), the assignment's rubric column, the discussions list, the thread and its replies.
const seed = () => {
  const grades = json('ultra-writer-gradebook.json'), row = grades.results[0];
  grades.results.push({ ...row, columnId: '_820_1', id: '_9820_1', column: { ...row.column, id: '_820_1', contentId: '_9_1', columnName: 'Week 6: Memory and Place', scoreProviderHandle: 'resource/x-bb-forumlink' } });
  const members = json('ultra-memberships.json');
  members.results = members.results.map((m) => (m.courseId === COURSE ? { ...m, course: { ...m.course, name: 'ENGL 2110: American Literature II', displayName: 'ENGL 2110: American Literature II' } } : m));
  const rubric = json('ultra-rubric-numeric.json').column;
  const column = { ...rubric, id: '_810_1', contentId: '_7_1', rubricAssociations: rubric.rubricAssociations.map((a) => ({ ...a, entityId: '_810_1' })) };
  const posts = [...json('ultra-writer-thread.json').results, ...json('ultra-writer-thread-2.json').results];
  return { grades, members, column, discussions: json('ultra-writer-thread-discussions.json'), posts, replies: json('ultra-writer-thread-replies.json').results };
};

// A message as the thread API has it, for what the practice student posts: a fixture message's shape, their values.
const message = (like, { id, parentId, html, draft }) => {
  const now = new Date().toISOString(), text = html.replace(/<[^>]*>/g, ' ');
  return {
    ...like, id, threadId: parentId || id, parentId: parentId || null, userId: ME.id, givenName: ME.givenName, familyName: ME.familyName,
    postedName: `${ME.givenName} ${ME.familyName}`, body: { rawText: html, displayText: html, webLocation: null, fileLocation: null },
    bodyLength: text.length, lifecycle: draft ? 'DRAFT' : 'PUBLISHED', createdDate: now, modifiedDate: now, postDate: draft ? null : now, editDate: null,
    messageStatus: { ...like.messageStatus, numberOfChildren: 0, numberOfChildrenNodraft: 0, numberOfReadChildren: 0, totalCount: 1, isRead: true },
  };
};
const page = (all, u) => {
  const limit = Number(u.searchParams.get('limit')) || 10, offset = Number(u.searchParams.get('offset')) || 0;
  const at = (o) => `${u.pathname}?limit=${limit}&offset=${o}`;
  return { results: all.slice(offset, offset + limit), paging: { limit, offset, count: all.length, previousPage: offset ? at(Math.max(0, offset - limit)) : '', nextPage: offset + limit < all.length ? at(offset + limit) : '' } };
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const safe = (n) => String(n || 'file').replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 120) || 'file';

// The mock's server side. out: the received folder; onReset(scenario): the launcher's part of a reset (Writer's fence).
// → { handle(route) for context.route, state, received, reset(scenario), html(name) }
const create = ({ quill: quillJs, out, onReset = async () => {}, onReceived = () => {} }) => {
  let db, next;
  const state = {};
  const received = [];
  const reset = (scenario) => {
    if (!scenario || scenario === 'discussion') { db = seed(); next = 401; state.log = (state.log || []).filter((l) => l.scenario !== 'discussion'); }
    if (!scenario || scenario === 'assignment') { state.uploads = new Map(); state.draft = null; state.submission = null; state.log = (state.log || []).filter((l) => l.scenario !== 'assignment'); }
  };
  reset();
  const keep = (kind, files) => {
    const dir = fs.mkdtempSync(path.join(out, `${stamp()}-${kind}-`));
    fs.writeFileSync(path.join(dir, 'practice.json'), `${JSON.stringify({ synthetic: true, kind })}\n`);
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    const r = { kind, dir, at: Date.now() };
    received.push(r);
    onReceived(r);
    return dir;
  };
  const note = (scenario, entry) => { state.log.push({ scenario, at: new Date().toISOString(), ...entry }); };
  const thread = () => db.posts.filter((p) => p.lifecycle !== 'DRAFT').map((p) => ({ ...p, replies: db.replies.filter((r) => r.parentId === p.id && r.lifecycle !== 'DRAFT').sort((a, b) => a.postDate.localeCompare(b.postDate)) }));

  const post = (body) => {
    const parent = body.parentId ? db.posts.find((p) => p.id === body.parentId) : null;
    if (body.parentId && !parent) throw Error('no such post');
    const html = String(body.body?.rawText || '');
    const m = message(db.posts[0], { id: `_${next++}_1`, parentId: parent?.id, html, draft: !!body.draft });
    (parent ? db.replies : db.posts).push(m);
    if (parent && !body.draft) parent.messageStatus = { ...parent.messageStatus, numberOfChildren: parent.messageStatus.numberOfChildren + 1, numberOfChildrenNodraft: parent.messageStatus.numberOfChildrenNodraft + 1 };
    const kind = body.draft ? 'draft' : parent ? 'reply' : 'post';
    const dir = keep(kind, { 'message.html': `${html}\n`, 'request.json': `${JSON.stringify({ method: 'POST', path: BOARD, body }, null, 2)}\n` });
    note('discussion', { kind, method: 'POST', path: BOARD, body, saved: dir });
    return m;
  };
  const upload = (name, type, bytes) => {
    const id = crypto.randomUUID(), f = { id, name, type, size: bytes.length, sha256: sha(bytes), bytes };
    state.uploads.set(id, f);
    note('assignment', { kind: 'upload', method: 'POST', path: UPLOAD, body: { name, type, size: f.size, sha256: f.sha256 } });
    return { id, name, type, size: f.size };
  };
  const attempt = async (body) => {
    const files = (Array.isArray(body.files) ? body.files : []).map((id) => state.uploads.get(id)).filter(Boolean);
    const html = String(body.studentSubmission || '');
    const kind = body.draft ? 'saved' : 'submission';
    const meta = await Promise.all(files.map(async (f) => {
      let text = '';
      try { text = /\.docx$/i.test(f.name) ? await DT.docx(new Uint8Array(f.bytes)) : ''; } catch (e) { text = `(${e.message})`; }
      return { id: f.id, name: f.name, type: f.type, size: f.size, sha256: f.sha256, words: (text.match(/\S+/g) || []).length, text, url: `/practice/files/${f.id}/${encodeURIComponent(f.name)}` };
    }));
    const dir = keep(kind, {
      ...Object.fromEntries(files.map((f) => [safe(f.name), f.bytes])),
      'text.html': `${html}\n`,
      'submission.json': `${JSON.stringify({ method: 'POST', path: ATTEMPT, body, files: meta.map(({ text, ...m }) => m) }, null, 2)}\n`,
    });
    note('assignment', { kind, method: 'POST', path: ATTEMPT, body, saved: dir });
    const receipt = { submittedAt: new Date().toISOString(), draft: !!body.draft, html, files: meta, saved: dir };
    if (body.draft) state.draft = { html, files: files.map(({ bytes, ...f }) => f) };
    else state.submission = receipt;
    return receipt;
  };

  const page$ = (name, extra = {}) => fixture(name).replace('<head>', '<head><base href="/ultra/">')
    .replace('</body>', `<script>window.__practice = ${JSON.stringify({ ...extra, me: ME, routes: ROUTES, board: BOARD, upload: UPLOAD, attempt: ATTEMPT }).replace(/</g, '\\u003c')};</script><script src="/gz-practice/quill.js"></script><script src="/gz-practice/world.js"></script></body>`);
  const html = (u) => {
    if (u.pathname === '/' || u.pathname === '/practice') return fixture('ultra-practice-index.html');
    if (u.pathname === ROUTES.discussion) return page$('ultra-practice-discussion.html', { page: 'discussion' });
    if (u.pathname === ROUTES.attempt) return page$('ultra-practice-attempt.html', { page: 'attempt', draft: state.draft, submission: state.submission });
    return '<!doctype html><title>Not in the practice</title><body style="font:15px system-ui;padding:40px;background:#060d18;color:#e8f2fa">This page isn’t part of the practice. <a style="color:#6fdcff" href="/practice">Practice home</a></body>';
  };
  const api = (u) => {
    const p = u.pathname;
    if (p === '/learn/api/v1/users/me') return ME;
    if (p === `/learn/api/v1/users/${ME.id}/memberships`) return db.members;
    if (p === `/learn/api/v1/courses/${COURSE}/gradebook/grades`) return db.grades;
    if (p === `/learn/api/v1/courses/${COURSE}/gradebook/columns/_810_1`) return db.column;
    if (p === `/learn/api/public/v1/courses/${COURSE}/discussions`) return db.discussions;
    if (p === BOARD) return page(db.posts.filter((m) => m.lifecycle !== 'DRAFT'), u);
    const id = p.startsWith(`${BOARD}/`) && p.endsWith('/replies') ? p.slice(BOARD.length + 1, -'/replies'.length) : null;
    if (id) return page(db.replies.filter((r) => r.parentId === id && r.lifecycle !== 'DRAFT').sort((a, b) => b.postDate.localeCompare(a.postDate)), u);
    return { results: [] };
  };

  // Installed on **/*, never just SITE: no page, popup, frame or fetch may fall through to a real origin.
  const handle = async (route) => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.protocol === 'chrome-extension:') return route.continue();
    if (u.origin !== SITE) return route.abort();
    const reply = (body, type = 'application/json') => route.fulfill({ status: 200, contentType: type, headers: { 'cache-control': 'no-store' }, body: typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    try {
      if (method === 'GET' && u.pathname === '/gz-practice/quill.js') return reply(quillJs, 'text/javascript');
      if (method === 'GET' && u.pathname === '/gz-practice/world.js') return reply(`(${world})();`, 'text/javascript');
      if (method === 'GET' && u.pathname === '/favicon.ico') return route.fulfill({ status: 204, body: '' });
      if (method === 'GET' && u.pathname === '/practice/api/where') return reply({ received: out });
      if (method === 'GET' && u.pathname === '/practice/api/thread') return reply(thread());
      if (method === 'GET' && u.pathname === '/practice/api/log') return reply({ received: out, items: state.log.map(({ scenario, ...l }) => l) });
      if (method === 'POST' && u.pathname === '/practice/api/reset') { const { scenario } = JSON.parse(req.postData() || '{}'); reset(scenario); await onReset(scenario); return reply({ ok: true }); }
      const file = /^\/practice\/files\/([0-9a-f-]{36})\//.exec(u.pathname);
      if (method === 'GET' && file) {
        const f = state.uploads.get(file[1]);
        return f ? route.fulfill({ status: 200, contentType: f.type || 'application/octet-stream', headers: { 'content-disposition': `attachment; filename="${safe(f.name)}"` }, body: f.bytes }) : route.fulfill({ status: 404, body: '' });
      }
      if (method === 'POST' && u.pathname === BOARD) return reply(post(JSON.parse(req.postData() || '{}')));
      if (method === 'POST' && u.pathname === UPLOAD) return reply(upload(decodeURIComponent(req.headers()['x-file-name'] || 'file'), req.headers()['content-type'] || '', req.postDataBuffer() || Buffer.alloc(0)));
      if (method === 'POST' && u.pathname === ATTEMPT) return reply(await attempt(JSON.parse(req.postData() || '{}')));
      if (method === 'GET' && req.isNavigationRequest()) return reply(html(u), 'text/html');
      if (method === 'GET' && u.pathname.startsWith('/learn/api/')) return reply(api(u));
      if (method !== 'GET') note(/attempt|assessment/.test(u.pathname) ? 'assignment' : 'discussion', { kind: 'unexpected', method, path: u.pathname });
      return route.fulfill({ status: 404, body: '' });
    } catch (e) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: e.message }) });
    }
  };
  return { handle, state, received, reset };
};

// The page's world: Ultra's own scripts around its Quill boxes, run in the page (serialized, so self-contained).
function world() {
  const cfg = window.__practice;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const make = (s) => { const t = document.createElement('template'); t.innerHTML = s.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const banner = make('<aside style="position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;padding:3px 12px;border-radius:6px;background:#633b00;color:#fff;font:600 12px system-ui">Writer practice · Synthetic data</aside>');
  document.body.append(banner);
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const blank = (q) => !q.getText().trim();
  const words = (q) => (q.getText().match(/\S+/g) || []).length;
  const toast = (text) => { const t = make(`<div class="toast" role="status">${esc(text)}</div>`); document.body.append(t); setTimeout(() => t.remove(), 2400); };
  // The practice log at the page's foot: what the mock Blackboard has received so far.
  const log = async () => {
    const box = $('.practice-log');
    if (!box) return;
    const l = await fetch('/practice/api/log').then((r) => r.json());
    $('summary', box).textContent = `Practice: what Blackboard received (${l.items.length})`;
    $('.where', box).textContent = `Saved in ${l.received}`;
    $('pre', box).textContent = JSON.stringify(l.items, null, 2);
  };
  // Ultra's Quill on a writable box, where Glaze's main-world helper finds it (.ql-container.__quill).
  const quill = (container, html = '') => {
    const old = $('.ql-editor', container), keep = ['id', 'data-gramm', 'role', 'aria-multiline', 'aria-labelledby', 'aria-required'].map((a) => [a, old.getAttribute(a)]).filter(([, v]) => v !== null);
    const placeholder = old.getAttribute('data-placeholder') || '';
    container.innerHTML = '';
    const q = new Quill(container, { placeholder });
    q.root.classList.add('bb-editor');
    for (const [a, v] of keep) q.root.setAttribute(a, v);
    if (html) q.setContents(q.clipboard.convert(html), 'silent');
    return q;
  };
  const TOOLBAR = `<div class="bb-editor-toolbar no-select" role="toolbar" aria-label="Editor toolbar">${['Bold', 'Italic', 'Underline'].map((l) => `<div role="presentation" class="bb-editor-toolbar-button-container"><button type="button" tabindex="-1" data-analytics-id="editor.toolbar.${l.toLowerCase()}.button" aria-label="${l}">${l[0]}</button></div>`).join('')}</div>`;
  const tools = (root, q) => root.addEventListener('mousedown', (e) => {
    const b = e.target.closest('.bb-editor-toolbar button');
    if (!b) return;
    e.preventDefault();
    const f = b.getAttribute('aria-label').toLowerCase();
    q.format(f, !q.getFormat()[f], 'user');
  });

  if (cfg.page === 'discussion') {
    // One box's Ultra side: its model (what Post sends), Post and Save Draft, the word count. Ultra's change handler takes
    // text only while the editor is active (live audit: text synced into an inactive composer left Post disabled).
    const box = (form, { active, send, cancel }) => {
      const container = $('.ql-container', form), root = $('.bb-editor-root', form), controls = $('.panel-editor-controls', form);
      const q = quill(container);
      const save = $('.js-text-editor-save', form), draft = $('.draft-button', form), stop = $('[ng-click="messageControl.onCancelClick()"]', form);
      const m = { active: false, value: '' };
      const buttons = () => { save.disabled = draft.disabled = !(m.active && m.value); };
      const toolbar = (on) => { const t = $('.bb-editor-toolbar', root); if (on && !t) root.prepend(make(TOOLBAR)); if (!on && t) t.remove(); };
      const activate = (on) => {
        m.active = on;
        controls.classList.toggle('ng-hide', !on);
        controls.setAttribute('aria-hidden', String(!on));
        container.classList.toggle('is-active', on);
        m.value = on && !blank(q) ? q.root.innerHTML : '';
        buttons();
      };
      q.on('text-change', () => {
        $('.status-bar', root).textContent = `Word count: ${words(q)}`;
        if (m.active) { m.value = blank(q) ? '' : q.root.innerHTML; buttons(); }
      });
      tools(root, q);
      // Focus draws the toolbar; the click (ng-click onEditorClick) activates; an empty editor that loses focus collapses.
      q.root.addEventListener('focus', () => toolbar(true));
      $('bb-rich-text-editor', form).addEventListener('click', () => { if (!m.active) activate(true); });
      // No grace period for Writer to sync text after taking focus from an empty Post (live audit rounds 4–5).
      q.root.addEventListener('blur', () => { if (!active && blank(q)) { activate(false); toolbar(false); } });
      const clear = () => { q.setContents([], 'api'); };
      save.addEventListener('click', async () => {
        if (save.disabled) return;
        save.disabled = true;
        window.__sends = (window.__sends || 0) + 1;
        const html = m.value;
        await send(html);
        clear();
        if (!active) { activate(false); toolbar(false); }
        log();
      });
      draft.addEventListener('click', async () => {
        if (draft.disabled) return;
        await post(cfg.board, { body: { rawText: m.value }, parentId: form.dataset.parent || null, postAsAnonymous: false, draft: true });
        toast('Draft saved');
        log();
      });
      stop.addEventListener('click', () => { clear(); if (cancel) cancel(); else { activate(false); toolbar(false); } });
      if (active) { toolbar(true); activate(true); }
      return q;
    };
    const initials = (m) => `${(m.givenName || '?')[0]}${(m.familyName || '')[0] || ''}`.toUpperCase();
    const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    const body = (m) => `<form class="text-editor-form"><bb-rich-text-editor><div class="bb-editor-root"><div class="editor-content-container"><div class="bb-editor-container ql-container is-read-only"><div class="ql-editor bb-editor" id="bb-editor-textbox" contenteditable="false">${m.body.displayText}</div></div></div></div></bb-rich-text-editor></form>`;
    const head = (m) => `<div class="post-head"><div class="av">${esc(initials(m))}</div><div><div class="who">${esc(m.postedName)}</div><div class="when">${esc(when(m.postDate))}</div></div></div>`;
    const reply = (m) => make(`<div class="comment-and-reply comment-level-1"><div class="comment-entry comment-entry-container${m.id}" message-id="${m.id}" intersection-observer-target-id="message${m.id}"><bb-message message-mode="view">${head(m)}${body(m)}</bb-message></div></div>`);
    const entry = (m) => {
      const e = make(`<div class="comment-and-reply comment-level-0"><div class="comment-entry comment-entry-container${m.id}" message-id="${m.id}" intersection-observer-target-id="message${m.id}"><bb-message message-mode="view">${head(m)}${body(m)}<div class="reply-actions"><button type="button" aria-label="Reply to message from ${esc(m.postedName)}">Reply</button></div></bb-message></div><div class="replies"><div></div></div></div>`);
      for (const r of m.replies || []) $('.replies > div', e).append(reply(r));
      return e;
    };
    // A reply box, as skeleton-discussion-reply.html records it: opened by Reply under the post, active from the start.
    const REPLY = `<div class="row collapse reply-input-wrapper"><bb-message message-mode="new" editor-aria-label="Reply text editor" enable-draft="true"><div bb-load-bundle="components/directives/discussion"><div class="reply-form comments" message-id="" tabindex="-1"><div class="text-editor-container">
      <form class="text-editor-form ng-pristine ng-valid" name="editorForm"><bb-rich-text-editor name="responseEditor" heading-start="h3" editor-aria-label="Reply text editor" ng-model="messageControl.messageBody.rawText" ng-change="messageControl.onMessageChange()" on-change="messageControl.onBbRichTextEditorChange" analytics-id="components.directives.discussion.message.onEditorClick">
        <div class="bb-editor-root bb-editor-heading-h3" role="presentation"><div class="editor-content-container keyboard-tooltip-container"><div class="bb-editor-container ql-container" role="presentation"><div class="ql-editor ql-blank bb-editor" id="bb-editor-textbox" contenteditable="true" data-gramm="false" data-placeholder="Type a reply" role="textbox" aria-multiline="true" aria-required="false"><p><br></p></div></div></div><div class="status-bar">Word count: 0</div></div>
      </bb-rich-text-editor><div class="panel-editor-controls" ng-show="isEditorActive"><div class="form-buttons"><button type="button" class="button--text draft-button" ng-click="messageControl.onSaveClick(true)" disabled>Save Draft</button><button type="button" class="button--text" ng-click="messageControl.onCancelClick()">Cancel</button><button type="button" class="button js-primary-button js-text-editor-save" ng-click="messageControl.onSaveClick()" disabled>Reply</button></div></div></form>
    </div></div></div></bb-message></div>`;
    const list = $('.thread');
    fetch('/practice/api/thread').then((r) => r.json()).then((posts) => { for (const m of posts) list.append(entry(m)); window.__threadReady = true; });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('.reply-actions button');
      if (!b) return;
      const thread = b.closest('.comment-and-reply'), id = $('[message-id]', thread).getAttribute('message-id'), into = $('.replies > div', thread);
      const open = $('.reply-input-wrapper', into);
      if (open) { $('.ql-editor', open).focus(); return; }
      const w = make(REPLY);
      into.append(w);
      $('form', w).dataset.parent = id;
      const q = box($('form', w), {
        active: true,
        send: async (html) => { const r = await post(cfg.board, { body: { rawText: html }, parentId: id, postAsAnonymous: false, draft: false }); w.remove(); into.append(reply(r)); toast('Reply posted'); },
        cancel: () => w.remove(),
      });
      q.focus();
    });
    box($('form[name="editorForm"]'), {
      active: false,
      send: async (html) => { const r = await post(cfg.board, { body: { rawText: html }, parentId: null, postAsAnonymous: false, draft: false }); list.append(entry(r)); toast('Posted'); },
    });
    log();
  }

  if (cfg.page === 'attempt') {
    const panel = $('bb-assignment-attempt-authoring-panel');
    const area = $('[class*="makeStylessubmission-"]'), preview = $('[class*="makeStylespreview-"]', area), input = $('input[type=file]', preview);
    const SUBMIT = '[data-analytics-id="assignment.attempt.authoring.footer.submit"]', SAVE = '[data-analytics-id="course.content.assessment.footer.buttons.saveAndClose"]';
    const footer = { submit: $(SUBMIT), save: $(SAVE) };
    window.__clicks = []; window.__confirmations = 0;
    const style = document.createElement('style');
    style.textContent = `.Mui-disabled { pointer-events: none; }
      .practice-files { display:grid; gap:6px; margin-top:10px; } .practice-files > div { display:flex; gap:10px; align-items:center; padding:8px 12px; border:1px solid var(--gz-line, #16283f); border-radius:10px; }
      .practice-files small { color:var(--gz-ink-faint, #5c7189); } .practice-files button { margin-left:auto; font:inherit; background:none; border:0; color:inherit; cursor:pointer; }
      .practice-confirm { position:fixed; inset:0; display:grid; place-items:center; background:rgb(0 0 0 / .5); z-index:2147483000; }
      .practice-confirm > div { width:420px; padding:22px 24px; border-radius:14px; background:#0d1b2e; color:#e8f2fa; border:1px solid #24405f; }
      .practice-confirm h2 { margin:0 0 8px; font-size:18px; } .practice-confirm .row { display:flex; justify-content:flex-end; gap:10px; margin-top:18px; }
      .practice-confirm button, .receipt .links a, .receipt .links button { font:inherit; font-weight:600; padding:8px 18px; border-radius:999px; border:1px solid #24405f; background:none; color:inherit; cursor:pointer; text-decoration:none; }
      .practice-confirm button.primary { background:#17c8f4; color:#04121f; border-color:transparent; }
      .receipt { max-width:900px; margin:32px auto; padding:0 24px 48px; display:grid; gap:18px; } .receipt h1 { margin:0; font-size:22px; } .receipt h2 { margin:0 0 6px; font-size:16px; }
      .receipt section { padding:16px 18px; border:1px solid var(--gz-line, #16283f); border-radius:12px; background:var(--gz-surface, #0d1b2e); }
      .receipt .muted { color:var(--gz-ink-muted, #8fa8c0); } .receipt pre { white-space:pre-wrap; word-break:break-word; font-size:12px; max-height:420px; overflow:auto; margin:8px 0 0; }
      .receipt .text { background:#fff !important; color:#111 !important; padding:16px 20px; border-radius:8px; } .receipt .text * { color:inherit !important; } .receipt .links { display:flex; gap:10px; } .receipt a { color:var(--gz-accent-hi, #6fdcff); }`;
    document.head.append(style);
    const kb = (n) => `${Math.max(1, Math.round(n / 1024))} KB`;
    const main = $('.routed-page');
    const receipt = (r) => {
      main.innerHTML = '';
      const v = make(`<div class="receipt"><div><h1>${r.draft ? 'Saved' : 'Submitted'}</h1><div class="muted"></div></div>
        <section class="files"><h2>Files Blackboard received</h2></section>
        <section><h2>Text box</h2><div class="text"></div><details><summary class="muted">HTML</summary><pre class="raw"></pre></details></section>
        <section><h2>Requests</h2><pre class="requests"></pre></section>
        <div class="links"><a href="${cfg.routes.attempt}">Open the attempt</a><a href="/practice">Practice home</a></div></div>`);
      $('.muted', v).textContent = `${new Date(r.submittedAt).toLocaleString()} · saved in ${r.saved}`;
      const fl = $('.files', v);
      if (!r.files.length) fl.append(make('<p class="muted">No files</p>'));
      for (const f of r.files) {
        const s = make(`<div><p><a download></a> <span class="muted"></span></p><details><summary class="muted">Text Blackboard can read (${f.words} words)</summary><pre></pre></details></div>`);
        $('a', s).href = f.url; $('a', s).textContent = f.name;
        $('span', s).textContent = `${f.type || 'unknown type'} · ${kb(f.size)} · sha256 ${f.sha256.slice(0, 12)}…`;
        $('pre', s).textContent = f.text;
        fl.append(s);
      }
      $('.text', v).innerHTML = r.html || '<p class="muted">Empty</p>';
      $('.raw', v).textContent = r.html;
      fetch('/practice/api/log').then((x) => x.json()).then((l) => { $('.requests', v).textContent = JSON.stringify(l.items, null, 2); });
      main.append(v);
      main.scrollTop = 0;
      window.__receipt = r;
    };
    if (cfg.submission) { receipt(cfg.submission); return; }
    const box = $('.ql-container:not(.is-read-only)', area);
    const q = quill(box, cfg.draft?.html || '');
    const status = $('.status-bar', area);
    const files = [];
    let uploading = 0;
    const shown = $('.practice-files') || make('<div class="practice-files"></div>');
    (preview.isConnected ? preview : area).after(shown);
    const state = () => {
      status.textContent = `Word count: ${words(q)}`;
      // Non-empty/attachment-only states weren't probed live. Conservatively wait for every upload to finish.
      const on = !uploading && (!blank(q) || files.length > 0);
      for (const b of [footer.save, footer.submit]) { b.disabled = !on; b.classList.toggle('Mui-disabled', !on); b.setAttribute('aria-disabled', String(!on)); b.tabIndex = on ? 0 : -1; }
    };
    // Ultra lists a file once it's uploaded: its name in its own element, which Writer waits for before it submits.
    const row = (f) => {
      files.push(f);
      const r = make(`<div class="makeStylesfileRow-0-2-401"><span class="makeStylesfileName-0-2-402"></span><small></small><button type="button" aria-label="Remove file">✕</button></div>`);
      $('span', r).textContent = f.name;
      $('small', r).textContent = `${f.type || 'file'} · ${kb(f.size)}`;
      $('button', r).addEventListener('click', () => { files.splice(files.indexOf(f), 1); r.remove(); state(); });
      shown.append(r);
      state();
    };
    for (const f of cfg.draft?.files || []) row(f);
    const take = async (list) => {
      uploading++; state();
      try {
        for (const f of list) {
          const r = await fetch(cfg.upload, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) }, body: await f.arrayBuffer() }).then((x) => { if (!x.ok) throw Error('Practice upload failed'); return x.json(); });
          await new Promise((resolve) => setTimeout(resolve, 400));
          row(r); await log();
        }
      } finally { uploading--; state(); }
    };
    q.on('text-change', state);
    tools($('.bb-editor-root', area), q);
    state();
    panel.addEventListener('change', (e) => { if (e.target === input) { take([...input.files]); input.value = ''; } });
    panel.addEventListener('dragover', (e) => e.preventDefault());
    panel.addEventListener('drop', (e) => { if (e.target.closest('[class*="makeStylesinputContainer-"]')) { e.preventDefault(); take([...e.dataTransfer.files]); } });
    $$('[class*="makeStylesbuttonContainer-"] button', preview).forEach((b) => b.addEventListener('click', () => { if (/Upload/.test(b.textContent)) input.click(); else toast('Cloud storage isn’t part of the practice'); }));
    const body = (draft) => ({ draft, studentSubmission: blank(q) ? '' : q.root.innerHTML, files: files.map((f) => f.id) });
    // Stand-in for Ultra's confirmation (its wording wasn't probed).
    const confirm = () => {
      const d = make(`<div class="practice-confirm" role="dialog" aria-modal="true" aria-labelledby="practice-confirm-title"><div><h2 id="practice-confirm-title">Submit assignment?</h2><p>You can’t change your submission after you submit it.</p><div class="row"><button type="button">Cancel</button><button type="button" class="primary">Submit</button></div></div></div>`);
      const [no, yes] = $$('button', d);
      no.addEventListener('click', () => d.remove());
      yes.addEventListener('click', async () => { if (yes.disabled) return; yes.disabled = true; window.__confirmations++; const r = await post(cfg.attempt, body(false)); d.remove(); receipt(r); });
      document.body.append(d);
      yes.focus();
    };
    panel.addEventListener('click', async (e) => {
      const b = e.target.closest('footer button');
      if (!b) return;
      window.__clicks.push(b.getAttribute('data-analytics-id'));
      if (b.disabled) return;
      if (b === footer.submit) confirm();
      else if (b === footer.save) receipt(await post(cfg.attempt, body(true)));
    });
    log();
  }
}

module.exports = { SITE, ROUTES, BOARD, UPLOAD, ATTEMPT, ME, MIME, QUILL, quill, create, world };
