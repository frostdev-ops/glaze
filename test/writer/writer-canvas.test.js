// Glaze Writer's Canvas adapter (writer/writer-canvas.js) over the captured Canvas pages (test/fixtures/canvas-writer-*.html,
// local Canvas 1c9f0bb8; the quiz and Assignments 2 pages are local captures too, made with the owner's OK): which box is
// what, its send button, what stays Canvas's, the quick look at an RCE's content, and reading, writing and watching a box.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const C = require('../../extension/writer/writer-canvas.js');

const raw = (f) => fs.readFileSync(path.join(__dirname, '../fixtures', f), 'utf8');
const page = (f) => { const doc = { activeElement: null }; doc.root = new El('html', doc); doc.body = parse(raw(`canvas-writer-${f}.html`), doc); return doc.body; };
const AT = {
  assignment: '/courses/34/assignments/238', discussion: '/courses/34/discussion_topics/80', thread: '/courses/34/discussion_topics/80',
  announcement: '/courses/34/discussion_topics/78', inbox: '/conversations', quiz: '/courses/36/quizzes/56/take', a2: '/courses/36/assignments/253',
};
// An RCE's frame body, as TinyMCE draws it: its elements, and its HTML exactly (data-mce-* attributes too).
const bodyFrom = (html) => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc);
  const body = new El('body', doc), stack = [body];
  doc.root.append(body);
  for (const m of html.matchAll(/<(\/?)([a-z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)\/?>|([^<]+)/gi)) {
    if (m[4] !== undefined) { stack.at(-1).append(m[4]); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { const i = stack.map((e) => e.tagName.toLowerCase()).lastIndexOf(tag); if (i > 0) stack.length = i; continue; }
    const el = new El(tag, doc);
    for (const a of m[3].matchAll(/([^\s=/]+)(?:\s*=\s*"([^"]*)")?/g)) el.setAttribute(a[1].toLowerCase(), a[2] ?? '');
    stack.at(-1).append(el);
    if (!['br', 'img', 'hr'].includes(tag)) stack.push(el);
  }
  body._html = html;
  return body;
};
// Each RCE frame in a page drawn: an empty paragraph, as Canvas opens a new box.
const drawn = (root, html = '<p><br data-mce-bogus="1"></p>') => { for (const f of root.querySelectorAll('iframe')) if (/_ifr$/.test(f.id)) f.contentDocument = { body: bodyFrom(html) }; return root; };
const shape = (b) => [b.kind, b.mode, b.editor.id, b.send?.tagName, b.root === C.rootOf(b.editor), b.container === b.editor];

test('the classic assignment: Text Entry is an assignment in compose, sent by its form\'s Submit, its whole RCE the root', () => {
  const body = drawn(page('assignment'));
  const [box, ...rest] = C.boxes(body, { path: AT.assignment });
  assert.equal(rest.length, 0);
  assert.deepEqual(shape(box), ['assignment', 'compose', 'submission_body', 'BUTTON', true, true]);
  assert.ok(box.root.className.includes('rce-wrapper') && box.root.contains(box.editor) && !box.root.contains(box.send));
  assert.equal(box.send.getAttribute('type'), 'submit');
  assert.ok(box.send.closest('form#submit_online_text_entry_form'));
  assert.deepEqual(box.context, {});
  assert.equal(box.identity, 'submission_body');
  assert.equal(C.enabled(box.send), true);
  box.send.setAttribute('aria-disabled', 'true');
  assert.equal(C.enabled(box.send), false);
});

test('an RCE whose frame isn\'t drawn yet, or off its own page, stays Canvas\'s', () => {
  assert.deepEqual(C.boxes(page('assignment'), { path: AT.assignment }), [], 'no frame body yet');
  const body = drawn(page('assignment'));
  for (const p of ['/courses/34/pages/syllabus', '/courses/34/assignments/238/submissions/3', '/courses/34/discussion_topics/80', '']) assert.deepEqual(C.boxes(body, { path: p }), [], p);
  const ta = body.querySelector('#submission_body');
  assert.equal(C.kindOf(ta, { path: AT.assignment }), 'assignment');
  assert.equal(C.kindOf(body.querySelector('#submission_comment'), { path: AT.assignment }), 'unknown', 'a plain comment box');
});

test('Canvas\'s HTML views and its restore-autosave dialog keep the box Canvas\'s', () => {
  let body = drawn(page('assignment'));
  body.querySelector('#submission_body').style.display = 'block';
  assert.deepEqual(C.boxes(body, { path: AT.assignment }), [], 'the raw HTML view shows the textarea');
  body = drawn(page('assignment'));
  body.querySelector('#submission_body').parentElement.style.display = 'none';
  assert.deepEqual(C.boxes(body, { path: AT.assignment }), [], 'the pretty HTML view hides the editor');
  body = drawn(page('assignment'));
  const modal = new El('div', body.doc);
  modal.setAttribute('data-testid', 'RCE_RestoreAutoSaveModal');
  body.append(modal);
  assert.deepEqual(C.boxes(body, { path: AT.assignment }), [], 'Canvas restores first');
});

test('discussion, thread and announcement replies are replies sent by their Reply; an announcement says so', () => {
  for (const [p, id] of [['discussion', 'message-body-root'], ['thread', 'message-body-102'], ['announcement', 'message-body-root']]) {
    const body = drawn(page(p));
    const boxes = C.boxes(body, { path: AT[p] });
    assert.deepEqual(boxes.map(shape), [['reply', 'compose', id, 'BUTTON', true, true]], p);
    const [box] = boxes;
    assert.equal(box.send.getAttribute('data-testid'), 'DiscussionEdit-submit', p);
    assert.ok(box.send.closest('[data-testid="DiscussionEdit-container"]').contains(box.editor), p);
    assert.deepEqual(box.context, p === 'announcement' ? { announcement: true } : {}, p);
    assert.equal(box.identity, id);
  }
});

test('editing a discussion entry, or a reply box off a topic page, stays Canvas\'s', () => {
  const body = drawn(page('thread'));
  const ta = body.querySelector('#message-body-102');
  ta.id = 'message-body-102-edit';
  assert.equal(C.kindOf(ta, { path: AT.thread }), 'unknown');
  ta.id = 'message-body-102';
  assert.equal(C.kindOf(ta, { path: '/courses/34/discussion_topics' }), 'unknown');
  assert.equal(C.kindOf(ta, { path: '/groups/7/discussion_topics/80' }), 'reply', 'a group\'s topic');
});

test('Canvas\'s Reply button: on the testid itself (local Canvas), or inside it', () => {
  const body = drawn(page('discussion'));
  const ta = body.querySelector('#message-body-root'), b = C.sendOf(ta, 'reply');
  const wrap = new El('span', body.doc);
  wrap.setAttribute('data-testid', 'DiscussionEdit-submit');
  b.removeAttribute('data-testid');
  b.replaceWith(wrap);
  wrap.append(b);
  assert.equal(C.sendOf(ta, 'reply'), b);
});

test('the Inbox: plain mode in its compose dialog, its field the root, sent by Send; not while Canvas disables the field', () => {
  const body = page('inbox');
  const [box, ...rest] = C.boxes(body, { path: AT.inbox });
  assert.equal(rest.length, 0);
  assert.deepEqual(shape(box), ['message', 'plain', 'TextArea___0', 'BUTTON', true, true]);
  // The field itself, inside InstUI's TextArea label: the label's messages (Canvas's "insert a message body") stay shown.
  assert.equal(box.root, box.editor.parentElement);
  assert.ok(box.root.closest('label[data-cid="TextArea"]') && box.root.closest('label[data-cid="TextArea"]') !== box.root);
  assert.equal(box.send.getAttribute('data-testid'), 'send-button');
  assert.deepEqual(C.boxes(body, { path: '/courses/34' }), [], 'the dialog only on the Inbox');
  box.editor.setAttribute('disabled', '');
  assert.deepEqual(C.boxes(body, { path: AT.inbox }), [], 'translating');
});

test('a discussion box shares the Inbox textarea\'s testid but is no Inbox box', () => {
  const body = drawn(page('discussion'));
  const ta = body.querySelector('#message-body-root');
  assert.equal(ta.getAttribute('data-testid'), 'message-body');
  assert.equal(C.kindOf(ta, { path: '/conversations' }), 'unknown');
});

test('quiz essays: each drawn RCE is a test; the sixth, past maxInitRenderedRCEs, waits until Canvas draws it', () => {
  const body = drawn(page('quiz'));
  const boxes = C.boxes(body, { path: AT.quiz });
  assert.deepEqual(boxes.map(shape), [['test', 'compose', 'question_input_0', 'BUTTON', true, true], ['test', 'compose', 'question_input_4', 'BUTTON', true, true]]);
  assert.equal(boxes[0].send.id, 'submit_quiz_button');
  assert.deepEqual(C.boxes(body, { path: '/courses/36/quizzes/56' }), [], 'the quiz\'s own page is no take page');
  assert.equal(C.kindOf(body.querySelector('#question_input_0'), { path: '/courses/36/quizzes/56/take/questions/442' }), 'test', 'one question at a time');
});

test('Assignments 2: textentry_text is an assignment, sent by Submit Assignment', () => {
  const body = drawn(page('a2'));
  const boxes = C.boxes(body, { path: AT.a2 });
  assert.deepEqual(boxes.map(shape), [['assignment', 'compose', 'textentry_text', 'BUTTON', true, true]]);
  assert.equal(boxes[0].send.getAttribute('data-testid'), 'submit-button');
});

test('read-only Canvas editors stay native, including Assignments 2 observer views and the Inbox', () => {
  const body = drawn(page('a2'), '<p>Student draft</p>');
  const ta = body.querySelector('#textentry_text');
  body.querySelector('#textentry_text_ifr').contentDocument.body.setAttribute('contenteditable', 'false');
  assert.equal(C.canEdit(ta), false);
  assert.deepEqual(C.boxes(body, { path: AT.a2 }), []);
  const inbox = page('inbox'), field = inbox.querySelector('textarea[data-testid="message-body"]');
  field.setAttribute('readonly', '');
  assert.deepEqual(C.boxes(inbox, { path: AT.inbox }), []);
});

test('the quick look: what Writer writes in Canvas\'s dialect passes, with TinyMCE\'s bookkeeping', () => {
  const ok = [
    '<p><br data-mce-bogus="1"></p>',
    '<p style="text-align: center;">a <strong>b</strong> <em>c</em> <span style="text-decoration: underline;" data-mce-style="text-decoration: underline;">u</span> <span style="text-decoration: line-through;">s</span> x<sup>2</sup> <sub>i</sub></p>',
    '<p style="padding-left: 80px;" data-mce-style="padding-left: 80px;">indented</p><h3>Head</h3><h4 style="text-align: right;">Sub</h4>',
    '<ul><li>one<ul><li>two</li></ul></li><li style="list-style-type: none;"><ol><li>three</li></ol></li></ul>',
    '<blockquote><p>quoted</p></blockquote><pre>code\n  kept</pre>',
    '<p><a href="https://example.com/x" target="_blank" rel="noopener" data-mce-href="https://example.com/x">link</a> <a href="mailto:a@b.co">m</a></p>',
  ];
  for (const h of ok) assert.equal(C.editable(h), true, h);
  const no = [
    '<h2>Big</h2>', '<p><span style="color: #e03e2d;">red</span></p>', '<p><span style="font-size: 18pt;">big</span></p>',
    '<table><tbody><tr><td>x</td></tr></tbody></table>', '<p><img src="/equation_images/x" class="equation_image"></p>',
    '<p><iframe src="https://example.com/embed"></iframe></p>', '<p><span class="mceNonEditable mention" data-mention="4">@Jordan</span></p>',
    '<p><a class="instructure_file_link" href="https://example.com/files/1/download">file</a></p>', '<p style="padding-left: 30px;">odd</p>',
    '<p dir="rtl">r</p>', '<p><span>plain span</span></p>', '<p><a href="javascript:alert(1)">x</a></p>', '<div>block</div>', '<p class="x">c</p>',
    '<p style="text-align: center; color: red;">mixed</p>', "<p><a href='https://e.com' onclick='x()'>e</a></p>",
  ];
  for (const h of no) assert.equal(C.editable(h), false, h);
  const body = drawn(page('assignment'), no[1]);
  assert.deepEqual(C.boxes(body, { path: AT.assignment }), [], 'a box holding colours stays Canvas\'s');
  assert.equal(C.canEdit(body.querySelector('#submission_body')), false);
  assert.equal(C.canEdit(drawn(page('assignment'), ok[1]).querySelector('#submission_body')), true);
});

test('reading and writing an RCE go through its frame and writer-main-canvas.js', () => {
  const body = drawn(page('assignment'), '<p>Hello <strong>there</strong></p>');
  const [box] = C.boxes(body, { path: AT.assignment });
  const native = C.read(box.editor);
  assert.equal(native.text, 'Hello there');
  assert.equal(native.html, body.querySelector('#submission_body_ifr').contentDocument.body.innerHTML);
  const asked = [];
  const said = C.write({ ...box, id: 'gzw-1' }, '<p>New</p>', null, (op, m) => { asked.push([op, m]); return [{ id: m.id, ok: true, html: '<p>New</p>' }]; });
  assert.deepEqual(asked, [['canvas-set', { id: 'gzw-1', html: '<p>New</p>' }]]);
  assert.deepEqual(said, [{ id: 'gzw-1', ok: true, html: '<p>New</p>' }]);
  assert.deepEqual(C.read(page('assignment').querySelector('#submission_body')), { html: '', text: '' }, 'no frame: nothing to read');
});

test('the Inbox reads its value as paragraphs and writes its lines', () => {
  const [box] = C.boxes(page('inbox'), { path: AT.inbox });
  box.editor.value = 'Hi <you>\n\nSecond & last';
  assert.deepEqual(C.read(box.editor), { html: '<p>Hi &lt;you&gt;</p><p><br></p><p>Second &amp; last</p>', text: 'Hi <you>Second & last' });
  assert.equal(C.linesOf('<p>Hi &lt;you&gt;</p><p><br></p><p>Second &amp; last&nbsp;</p>'), 'Hi <you>\n\nSecond & last ');
  const asked = [];
  const said = C.write({ ...box, id: 'gzw-2' }, '<p>One</p><p>Two</p>', null, (op, m) => { asked.push([op, m]); return [{ id: m.id, ok: true, text: 'One\nTwo' }, { id: m.id, ok: true }, null]; });
  assert.deepEqual(asked, [['canvas-set', { id: 'gzw-2', text: 'One\nTwo' }]]);
  assert.deepEqual(said, [{ id: 'gzw-2', ok: true, text: 'One\nTwo', html: '<p>One</p><p>Two</p>' }, { ok: false }, { ok: false }]);
});

test('watching: Canvas\'s own changes to the box, said by writer-main-canvas.js for its id, and its frame body observed', () => {
  const body = drawn(page('assignment'));
  const [b] = C.boxes(body, { path: AT.assignment });
  const listeners = new Map(), observed = [];
  b.editor.ownerDocument = { addEventListener: (t, f) => listeners.set(t, f), removeEventListener: (t, f) => { if (listeners.get(t) === f) listeners.delete(t); } };
  let n = 0;
  const asked = [];
  const w = C.watch({ ...b, id: 'gzw-3' }, () => n++, (el, fn) => { observed.push(el); return { disconnect: () => observed.pop() }; }, (op, m) => { asked.push([op, m]); return []; });
  assert.deepEqual(asked, [['canvas-watch', { id: 'gzw-3' }]], 'writer-main-canvas.js is asked to say when Canvas changes the box');
  assert.deepEqual(observed, [body.querySelector('#submission_body_ifr').contentDocument.body]);
  const fire = (d) => listeners.get('gz-writer:canvas-changed')?.({ detail: d });
  fire(JSON.stringify({ id: 'gzw-3' }));
  fire(JSON.stringify({ id: 'gzw-other' }));
  fire('not json');
  assert.equal(n, 1);
  w.disconnect();
  assert.equal(listeners.size, 0);
  assert.deepEqual(observed, []);
});

test('its native editor is Canvas\'s, and it has no Ultra attempt pages', () => {
  assert.equal(C.NATIVE, 'Canvas editor');
  assert.equal(C.attemptAt('/courses/36/quizzes/56/take'), null);
  assert.deepEqual(C.KINDS, ['assignment', 'reply', 'message', 'test', 'unknown']);
});

test('the surfaces Writer opens on now: classic assignments, replies, the Inbox and quiz essays; Assignments 2 waits for its step', () => {
  const [assignment] = C.boxes(drawn(page('assignment')), { path: AT.assignment });
  const [reply] = C.boxes(drawn(page('discussion')), { path: AT.discussion });
  const [message] = C.boxes(page('inbox'), { path: AT.inbox });
  const [quiz] = C.boxes(drawn(page('quiz')), { path: AT.quiz });
  const [a2] = C.boxes(drawn(page('a2')), { path: AT.a2 });
  assert.deepEqual([assignment, reply, message, quiz, a2].map((b) => [b.kind, C.live(b)]),
    [['assignment', true], ['reply', true], ['message', true], ['test', true], ['assignment', false]]);
});

// One question at a time, Canvas's Next and Previous record the answer (record_answer) as Submit Quiz does: each holds the
// box's last words too. The Next button is copied from the local Canvas's quiz 57 (one question at a time, 2026-11-09).
const NEXT = '<button type="submit" class="Button submit_button next-question btn-secondary" data-action="/courses/36/quizzes/57/submissions/133/record_answer?next_question_path=%2Fcourses%2F36%2Fquizzes%2F57%2Ftake%2Fquestions%2F449&amp;user_id=3" aria-label="Next Question">Next</button>';
test('a quiz essay is sent by every button that records its answer: Submit Quiz, and Next or Previous one question at a time', () => {
  const raw2 = raw('canvas-writer-quiz.html').replace('<button type="submit" class="btn submit_button quiz_submit btn-secondary" id="submit_quiz_button"', `${NEXT}$&`);
  const doc = { activeElement: null }; doc.root = new El('html', doc); const body = drawn(parse(raw2, doc));
  const boxes = C.boxes(body, { path: '/courses/36/quizzes/57/take/questions/448' });
  assert.equal(boxes.length, 2);
  for (const b of boxes) assert.deepEqual(C.sends(b.editor, b.kind).map((x) => x.id || x.getAttribute('aria-label')), ['Next Question', 'submit_quiz_button']);
  const quiz = drawn(page('quiz')), [q] = C.boxes(quiz, { path: AT.quiz });
  assert.deepEqual(C.sends(q.editor, q.kind).map((x) => x.id), ['submit_quiz_button'], 'all questions on one page: Submit Quiz only (the times-up dialog\'s button records nothing)');
  const [assignment] = C.boxes(drawn(page('assignment')), { path: AT.assignment });
  assert.deepEqual(C.sends(assignment.editor, assignment.kind), [assignment.send], 'every other box: its one send');
  const [message] = C.boxes(page('inbox'), { path: AT.inbox });
  assert.deepEqual(C.sends(message.editor, message.kind), [message.send]);
});

test('a send on Canvas waits for the frame\'s last words; Insert from Canvas runs Canvas\'s own tools', () => {
  assert.equal(C.HOLD, true);
  assert.deepEqual(C.TOOLS, { image: 'mceInstructureImage', media: 'instructureRecord', document: 'mceInstructureDocuments', equation: 'instructureEquation', link: 'instructureTrayForCourseLinks' });
});

test('giving the box back focuses Canvas\'s editor: the RCE\'s frame body, or the Inbox\'s field', () => {
  const body = drawn(page('assignment'));
  const [box] = C.boxes(body, { path: AT.assignment });
  const frame = body.querySelector('#submission_body_ifr'), seen = [];
  frame.contentWindow = { focus: () => seen.push('window') };
  frame.contentDocument.body.focus = () => seen.push('body');
  C.focus(box.editor);
  assert.deepEqual(seen, ['window', 'body']);
  const [inbox] = C.boxes(page('inbox'), { path: AT.inbox });
  let focused = 0;
  inbox.editor.focus = () => focused++;
  C.focus(inbox.editor);
  assert.equal(focused, 1);
});

test('a classic assignment\'s errors line: where Canvas says an empty box won\'t submit, outside the RCE', () => {
  const body = drawn(page('assignment'));
  const [box] = C.boxes(body, { path: AT.assignment });
  const errors = C.errorsOf(box.editor);
  assert.equal(errors?.id, 'body_errors');
  assert.ok(!box.root.contains(errors));
  const [reply] = C.boxes(drawn(page('discussion')), { path: AT.discussion });
  assert.equal(C.errorsOf(reply.editor), null);
});

test('Canvas focuses a reply box once it is up (DiscussionEdit, 1000 ms after init): Writer takes the caret there; the rest wait for a click', () => {
  assert.deepEqual(C.KINDS.map((k) => [k, C.focuses(k)]), [['assignment', false], ['reply', true], ['message', false], ['test', false], ['unknown', false]]);
});

test('Canvas\'s caret marker in a reply (DiscussionEdit\'s positionCursor, a second after the box opens) is no content Writer can\'t keep', () => {
  assert.equal(C.editable('<p><br data-mce-bogus="1"><span class="post_mention"></span></p>'), true);
  assert.equal(C.editable('<p>Hi <span class="post_mention"></span></p>'), true);
  assert.equal(C.editable('<p><span class="post_mention">@Kim</span></p>'), false, 'a marker holding text is something else');
  assert.equal(C.editable('<p><span class="mceNonEditable mention" data-mention="5">@Kim</span></p>'), false, 'a mention stays Canvas\'s');
});

test('the Inbox: Canvas changing the field\'s value itself (its signature, added once loaded) is noticed without an input event', async () => {
  const [box] = C.boxes(page('inbox'), { path: AT.inbox });
  let n = 0;
  box.editor.ownerDocument = { addEventListener() {}, removeEventListener() {} };
  box.editor.addEventListener = () => {}; box.editor.removeEventListener = () => {};
  const w = C.watch({ ...box, id: 'gzw-9' }, () => n++, () => ({ disconnect() {} }), () => []);
  box.editor.value = 'Hi\n\n---\nSam Taylor';
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(n, 1);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(n, 1, 'once per change');
  w.disconnect();
  box.editor.value = 'changed after';
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(n, 1, 'not after it is let go');
});

test('the Inbox: Canvas disabling the field (translating) is noticed too, and the field is then no box Writer can edit', async () => {
  const [box] = C.boxes(page('inbox'), { path: AT.inbox });
  let n = 0;
  box.editor.ownerDocument = { addEventListener() {}, removeEventListener() {} };
  box.editor.addEventListener = () => {}; box.editor.removeEventListener = () => {};
  const w = C.watch({ ...box, id: 'gzw-8' }, () => n++, () => ({ disconnect() {} }), () => []);
  box.editor.disabled = true;
  await new Promise((r) => setTimeout(r, 700));
  w.disconnect();
  assert.equal(n, 1);
  assert.equal(C.canEdit(box.editor), false);
});
