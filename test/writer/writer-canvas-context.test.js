// What a Canvas box answers (writer/writer-canvas.js contextOf), read off the captured Canvas pages (test/fixtures/
// canvas-writer-*.html, local Canvas 1c9f0bb8): an assignment's title, due date and description (its instructions), a reply's
// topic and the one entry it answers, nothing for the Inbox, and never anything on a quiz. Then the same context through
// the AI's own reader (ai/tasks/writer-context.js, writer-feedback.js input), and page/writer.js handing it to the frame
// with the targets the prompt states (writer/writer-target.js), which the compose bar's ring shows.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const C = require('../../extension/writer/writer-canvas.js');
const W = require('../../extension/ai/tasks/writer-context.js');
const T = require('../../extension/writer/writer-target.js');
const compose = require('../../extension/writer/frame/writer-compose.js');
const page = require('../helpers/writer-canvas-page.cjs');
const plain = (v) => JSON.parse(JSON.stringify(v)); // out of the page's VM realm

const raw = (f) => fs.readFileSync(path.join(__dirname, '../fixtures', f), 'utf8');
const load = (f) => { const doc = { activeElement: null }; doc.root = new El('html', doc); doc.body = parse(raw(`canvas-writer-${f}.html`), doc); return doc.body; };
const drawn = (root) => { for (const f of root.querySelectorAll('iframe')) if (/_ifr$/.test(f.id)) { const body = new El('body', root.doc); body.append(new El('p', root.doc)); f.contentDocument = { body }; } return root; };
const AT = {
  assignment: '/courses/34/assignments/238', a2: '/courses/36/assignments/253', discussion: '/courses/34/discussion_topics/80',
  thread: '/courses/34/discussion_topics/80', announcement: '/courses/34/discussion_topics/78', inbox: '/conversations', quiz: '/courses/36/quizzes/56/take',
};
const boxOf = (f, body = drawn(load(f))) => C.boxes(body, { path: AT[f] })[0];
const TOPIC = 'Weekly discussion: counterarguments\nReply with a short post, then respond to two classmates.';
const text = (body, sel, value) => { const e = body.querySelector(sel); e.replaceChildren(value); return e; };

test('a classic assignment: its title, due date and description from the page, as Ultra\'s assignment context carries them', () => {
  assert.deepEqual(boxOf('assignment').context, {
    kind: 'assignment', course: { id: '34', name: 'ENG 1100' },
    assignment: { title: 'Reading response 5', due: '2026-11-11T04:59:00.000Z', instructions: 'Instructions for Reading response 5. Follow the rubric in the syllabus.', description: '', rubric: null, files: [] },
  });
});

test('Assignments 2: the same, from its own header and description', () => {
  assert.deepEqual(boxOf('a2').context, {
    kind: 'assignment', course: { id: '36', name: 'HIST 2010' },
    assignment: { title: 'Museum visit reflection', due: '2026-11-19T04:59:00.000Z', instructions: 'Instructions for Museum visit reflection. Follow the rubric in the syllabus.', description: '', rubric: null, files: [] },
  });
});

test('a reply to the topic: the topic\'s title and message are its prompt; no thread, no entry', () => {
  assert.deepEqual(boxOf('discussion').context, { kind: 'reply', course: { id: '34', name: 'ENG 1100' }, prompt: { text: TOPIC }, requirements: null, thread: [], replyTo: null });
});

test('a reply to an entry: the topic, and that one entry with its author, never the rest of the thread', () => {
  const body = drawn(load('thread'));
  text(body, '[data-resource-type="discussion_topic.reply"][data-resource-id="101"]', 'Another classmate\'s whole post.');
  text(body, '[data-resource-type="discussion_topic.reply"][data-resource-id="100"]', 'A third post, not answered.');
  const { context } = boxOf('thread', body);
  assert.deepEqual(context, {
    kind: 'reply', course: { id: '34', name: 'ENG 1100' }, prompt: { text: TOPIC }, requirements: null, thread: [],
    replyTo: { id: '102', author: 'Casey Morgan', text: 'Here\'s my take on weekly discussion: counterarguments: it depends on the context.' },
  });
  assert.ok(!/Another classmate|A third post/.test(JSON.stringify(context)));
});

test('an unrelated post cannot impersonate the topic, entry or author using Canvas-permitted data attributes', () => {
  const body = drawn(load('thread'));
  const other = body.querySelector('[data-resource-type="discussion_topic.reply"][data-resource-id="101"]');
  // CanvasSanitize permits arbitrary data-* attributes in authored HTML. Put the unrelated post before the real
  // topic and entry, as it can be in the thread view or split screen; its descendants are still authored content.
  const forged = new El('div', body.doc), author = new El('span', body.doc), entry = new El('span', body.doc), topic = new El('span', body.doc);
  forged.setAttribute('data-entry-id', '102');
  author.setAttribute('data-testid', 'author_name'); author.append('Unrelated author');
  entry.setAttribute('data-resource-type', 'discussion_topic.reply'); entry.setAttribute('data-resource-id', '102'); entry.append('Another student\'s unrelated post.');
  topic.setAttribute('data-resource-type', 'discussion_topic.body'); topic.setAttribute('data-resource-id', '80'); topic.append('Another student\'s false prompt.');
  forged.append(author, entry, topic); other.replaceChildren(forged); body.prepend(other);
  const { context } = boxOf('thread', body);
  assert.equal(context.prompt.text, TOPIC);
  assert.deepEqual(context.replyTo, { id: '102', author: 'Casey Morgan', text: 'Here\'s my take on weekly discussion: counterarguments: it depends on the context.' });
  assert.deepEqual(context.thread, []);
  assert.ok(!/Another student|Unrelated author/.test(JSON.stringify(context)));
});

test('an announcement\'s reply: the announcement is the prompt, and the context still says it is one', () => {
  assert.deepEqual(boxOf('announcement').context, {
    kind: 'reply', course: { id: '34', name: 'ENG 1100' }, prompt: { text: 'Welcome to College Writing\nWelcome to College Writing. Details are on the course page.' },
    requirements: null, thread: [], replyTo: null, announcement: true,
  });
});

test('the Inbox: a private message gets no context', () => {
  assert.deepEqual(boxOf('inbox').context, {});
});

test('a quiz page never builds a context, whatever the box is taken for', () => {
  const body = drawn(load('quiz'));
  const boxes = C.boxes(body, { path: AT.quiz });
  assert.ok(boxes.length >= 2 && boxes.every((b) => b.kind === 'test'));
  for (const b of boxes) assert.deepEqual(b.context, {});
  // Even the topic or assignment parts of a page under a quiz's route are never read.
  const reply = drawn(load('discussion')).querySelector('#message-body-root'), essay = body.querySelector('textarea.question_input');
  for (const kind of C.KINDS) for (const at of [AT.quiz, '/courses/36/quizzes/56/take/questions/7']) {
    assert.deepEqual(C.contextOf(essay, kind, { path: at }), {}, `${kind} ${at}`);
    assert.deepEqual(C.contextOf(reply, kind, { path: at }), {}, `${kind} ${at}`);
  }
  assert.deepEqual(C.contextOf(essay, 'test', { path: AT.assignment }), {}, 'a test\'s box, wherever it is');
});

test('teacher- and student-written text stays text: markup-like words are kept as words, hidden parts and scripts left out', () => {
  const body = drawn(load('assignment'));
  const d = body.querySelector('#assignment_show .description.user_content');
  const p = new El('p', body.doc), s = new El('script', body.doc), sr = new El('span', body.doc), b = new El('button', body.doc);
  p.append('Write <img src=x onerror=alert(1)> as text.');
  s.append('steal()');
  sr.className = 'screenreader-only'; sr.append('Links to an external site.');
  b.append('Preview');
  d.replaceChildren(p, s, sr, b);
  const a = boxOf('assignment', body).context.assignment;
  assert.equal(a.instructions, 'Write <img src=x onerror=alert(1)> as text.');
  for (const v of Object.values(boxOf('assignment', body).context.assignment)) assert.ok(v === null || typeof v === 'string' || Array.isArray(v), 'strings only');
});

test('size bounds as Ultra\'s page reads have them: 20,000 characters of instructions or prompt, 4,000 of an entry, 120 of a name, 300 of a title', () => {
  let body = drawn(load('assignment'));
  text(body, '#assignment_show .description.user_content', 'word '.repeat(6000));
  text(body, '#assignment_show h1.title', 'T'.repeat(500));
  let a = boxOf('assignment', body).context.assignment;
  assert.equal(a.instructions.length, 20000);
  assert.equal(a.title.length, 300);
  assert.equal(a.incomplete, true, 'what was cut is said to be incomplete');

  body = drawn(load('thread'));
  text(body, '[data-resource-type="discussion_topic.body"][data-resource-id="80"]', 'p '.repeat(15000));
  text(body, '[data-resource-type="discussion_topic.reply"][data-resource-id="102"]', 'e '.repeat(3000));
  text(body, '[data-entry-id="102"] [data-testid="author_name"]', 'N'.repeat(300));
  const c = boxOf('thread', body).context;
  assert.equal(c.prompt.text.length, 20000);
  assert.equal(c.replyTo.text.length, 4000);
  assert.equal(c.replyTo.author.length, 120);
});

test('files the description links to are not read: the assignment says it is incomplete (attachments stay Ultra\'s)', () => {
  // The link's shape as Canvas's API and RCE write a course file (canvas-assignment-api.json; not seen live).
  const body = drawn(load('assignment'));
  const d = body.querySelector('#assignment_show .description.user_content'), link = new El('a', body.doc);
  link.setAttribute('href', '/courses/34/files/789/download?wrap=1');
  link.setAttribute('data-api-returntype', 'File');
  link.append('Lab manual.pdf');
  d.append(link);
  const a = boxOf('assignment', body).context.assignment;
  assert.deepEqual(a.files, []);
  assert.equal(a.incomplete, true);
  assert.match(a.instructions, /Lab manual\.pdf/);
});

test('the AI reads a Canvas context as it reads Ultra\'s: course, prompt and the entry answered; an assignment\'s title and instructions', () => {
  const labels = (ctx) => W.blocks(W.clean(ctx)).map((b) => b.label);
  assert.deepEqual(labels(boxOf('thread').context), ['course', 'discussion prompt', 'post being answered']);
  assert.deepEqual(labels(boxOf('discussion').context), ['course', 'discussion prompt']);
  assert.deepEqual(labels(boxOf('assignment').context), ['course', 'assignment title', 'assignment instructions']);
  assert.deepEqual(labels(boxOf('inbox').context), []);
  const F = require('../../extension/ai/tasks/writer-feedback.js');
  const fb = F.task.input({ text: 'My draft.', mode: 'compose', kind: 'assignment', context: boxOf('a2').context });
  assert.ok(fb, 'Feedback takes a Canvas assignment');
  assert.equal(fb.context.assignment.instructions, 'Instructions for Museum visit reflection. Follow the rubric in the syllabus.');
});

test('the prompt\'s targets: a topic reply answers to the post\'s, an entry reply only to what is said of replies', () => {
  const said = 'Post at least 250 words. Each reply should be at least 100 words. Respond to two classmates.';
  for (const [f, words] of [['discussion', 250], ['thread', 100]]) {
    const body = drawn(load(f));
    text(body, '[data-resource-type="discussion_topic.body"][data-resource-id="80"]', said);
    const box = boxOf(f, body), kind = C.targetOf(box);
    const req = T.forKind(T.parse(box.context.prompt.text), kind);
    assert.equal(req.minWords, words, f);
    assert.equal(compose.tip(req), `At least ${words} words\nReply to 2 classmates`, f);
  }
  for (const f of ['assignment', 'a2', 'inbox', 'quiz']) for (const b of C.boxes(drawn(load(f)), { path: AT[f] })) assert.equal(C.targetOf(b), null, f);
});

test('page/writer.js hands the frame a reply\'s context, then its targets once writer/writer-target.js is in', async () => {
  const c = await page({ fixture: 'discussion', scripts: ['writer/writer-target.js'] });
  await new Promise(setImmediate);
  const sent = c.ports.at(-1).sent, init = sent.find((m) => m.type === 'init');
  assert.deepEqual(plain(init.context.prompt), { text: TOPIC });
  const later = sent.filter((m) => m.type === 'context').at(-1);
  assert.deepEqual(plain(later?.context.requirements ?? null), { minWords: null, maxWords: null, sources: null, replies: 2 });
  assert.deepEqual(plain(later.context.prompt), { text: TOPIC });
});

test('page/writer.js hands an assignment its context at init, and a quiz essay none', async () => {
  const a = await page({ fixture: 'assignment', scripts: ['writer/writer-target.js'] });
  await new Promise(setImmediate);
  const init = a.ports.at(-1).sent.find((m) => m.type === 'init');
  assert.equal(init.context.assignment.instructions, 'Instructions for Reading response 5. Follow the rubric in the syllabus.');
  assert.ok(!a.ports.at(-1).sent.some((m) => m.type === 'context'), 'no targets for an assignment');
  const q = await page({ fixture: 'quiz', scripts: ['writer/writer-target.js'] });
  await new Promise(setImmediate);
  const inits = q.ports.flatMap((p) => p.sent).filter((m) => m.type === 'init');
  assert.ok(inits.length >= 1);
  for (const m of inits) { assert.equal(m.kind, 'test'); assert.deepEqual(plain(m.context), {}); }
  assert.ok(!q.ports.flatMap((p) => p.sent).some((m) => m.type === 'context'));
});
