// Glaze Writer's discussion context (lib/writer-context-discussion.js) over the probed API shapes
// (test/fixtures/ultra-writer-thread*.json): the forum behind a route, the prompt, the thread within its budget, the post a
// reply answers, and the reads through lib/ultra.js's reader. What the frame gets in a browser is
// scripts/writer-compose-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../lib/writer-context-discussion.js');
const T = require('../lib/writer-target.js');
const { read } = require('../lib/ultra.js');
const text = require('../lib/doctext.js').html;

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
const LIST = load('ultra-writer-thread-discussions.json'), PAGE1 = load('ultra-writer-thread.json'), PAGE2 = load('ultra-writer-thread-2.json'), REPLIES = load('ultra-writer-thread-replies.json');
const ALL = [...PAGE1.results, ...PAGE2.results, ...REPLIES.results];
const ME = '_42_1';
const column = (contentId, id) => ({ columnId: id, column: { id, contentId, scoreProviderHandle: 'resource/x-bb-forumlink' } });

test('every thread fixture says where its shape came from', () => {
  for (const j of [LIST, PAGE1, PAGE2, REPLIES]) assert.match(j._note, /^Glaze test fixture: Blackboard Ultra \(Learn 4001\) response shape, synthetic values\./);
  const keys = ['id', 'threadId', 'parentId', 'forumId', 'userId', 'givenName', 'familyName', 'postedName', 'postAsAnonymous', 'subject', 'body', 'bodyLength', 'lifecycle', 'createdDate', 'modifiedDate', 'postDate', 'editDate', 'groupId', 'allowGrading', 'postFirst', 'isThreadLocked', 'aiState', 'deanonymize', 'linkrefid', 'lastUpdateUserId', 'hitCount', 'isFromCartridge', 'messageStatus', 'permissions'];
  for (const m of ALL) assert.deepEqual(Object.keys(m), keys, `message ${m.id} has the probed fields, in order`);
  for (const j of [PAGE1, PAGE2, REPLIES]) assert.deepEqual(Object.keys(j.paging), ['limit', 'offset', 'count', 'previousPage', 'nextPage']);
});

test('routes: a discussion\'s course and content ids, a message composer\'s course', () => {
  assert.deepEqual(C.route('/ultra/courses/_101_1/discussion/_9_1'), { course: '_101_1', content: '_9_1' });
  assert.deepEqual(C.route('/ultra/courses/_101_1/outline/discussion/_9_1/'), { course: '_101_1', content: '_9_1' });
  assert.deepEqual(C.route('/ultra/messages/create', '?courseId=_101_1'), { course: '_101_1' });
  for (const [p, s] of [['/ultra/messages/create', ''], ['/ultra/messages/create', '?courseId=101'], ['/ultra/courses/_101_1/outline', ''], ['/ultra/courses/_101_1/discussion/9', ''], ['/ultra/courses/_101_1/discussion/_9_1/rubric-view', '']]) assert.equal(C.route(p, s), null, p + s);
});

test('the forum behind a route: by the gradebook column its content id has, else by a title only one discussion has', () => {
  const list = LIST.results;
  assert.equal(C.discussionOf(list, { content: '_9_1', rows: [column('_9_1', '_820_1'), column('_7_1', '_810_1')] }).id, '_1101_1', 'the graded discussion, by its column');
  assert.equal(C.discussionOf(list, { content: '_12_1', rows: [], titles: ['  week 7:   GHOSTS '] }).id, '_1103_1', 'an ungraded one by the page\'s title');
  assert.equal(C.discussionOf([...list, { ...list[2], id: '_1105_1' }], { content: '_12_1', titles: ['Week 7: Ghosts'] }), null, 'two with that title: unsure');
  assert.equal(C.discussionOf(list, { content: '_12_1', rows: [column('_9_1', '_820_1')], titles: ['Course content'] }), null, 'another content\'s column, no title: nothing');
  assert.equal(C.discussionOf(list, { content: '_9_1' }), null, 'never the content id itself, nor a guess');
  assert.equal(C.discussionOf(null, { content: '_9_1' }), null);
});

test('the prompt is topic.body as text, and its requirements come from lib/writer-target.js', () => {
  const p = C.promptOf(LIST.results[1], text);
  assert.equal(p.text, 'How does Morrison use the river and the clearing as places of memory? Respond in at least 250 words, cite two sources, and reply to two classmates.');
  assert.deepEqual(T.forKind(T.parse(p.text), 'reply'), { minWords: 250, maxWords: null, sources: 2, replies: 2 });
  assert.equal(C.promptOf({ topic: { body: '<p> </p>' } }, text), null);
  assert.equal(C.promptOf(null, text), null);
  assert.equal(C.promptOf({ topic: { body: `<p>${'x'.repeat(30000)}</p>` } }, text).text.length, C.LIMIT.prompt);
});

test('the thread: posts and their replies as Ultra nests them, oldest first, the student\'s own marked', () => {
  const th = C.threadOf(ALL, { me: ME, text });
  assert.deepEqual(th.map((x) => [x.id, x.parentId, x.author, x.mine]), [
    ['_201_1', null, 'Jordan Lee', false], ['_301_1', '_201_1', 'Alex Kim', false], ['_302_1', '_201_1', 'Sam Rivera', true],
    ['_202_1', null, 'Priya Shah', false], ['_203_1', null, 'Sam Rivera', true],
  ]);
  assert.equal(th[3].text, 'I read the clearing as the opposite of the river: a place the community chooses to gather, where Baby Suggs asks them to love their flesh.');
  assert.equal(th[4].text, 'Sethe\'s word "rememory" makes memory a place you can walk into, which is why the clearing feels haunted.\n(Morrison 42)', 'a line per paragraph');
  assert.deepEqual(C.threadOf([...ALL, ...ALL], { me: ME, text }).map((x) => x.id), th.map((x) => x.id), 'repeats once');
  assert.ok(C.threadOf(ALL, { text }).every((x) => !x.mine), 'nobody\'s own without users/me');
});

test('the thread keeps the newest posts within its count and character budget, and always the post a reply answers', () => {
  assert.deepEqual(C.threadOf(ALL, { me: ME, text, posts: 2 }).map((x) => x.id), ['_302_1', '_203_1'], 'the newest two');
  assert.deepEqual(C.threadOf(ALL, { me: ME, text, posts: 2, keep: ['_301_1'] }).map((x) => x.id), ['_201_1', '_301_1'], 'a kept reply brings its post');
  const chars = ALL.find((m) => m.id === '_203_1').body.rawText.length;
  const small = C.threadOf(ALL, { me: ME, text, chars });
  assert.ok(small.reduce((n, x) => n + x.text.length, 0) <= chars, 'within the budget');
  assert.ok(small.length >= 1);
  const long = { ...ALL[0], id: '_999_1', postDate: '2026-10-26T00:00:00.000Z', body: { rawText: `<p>${'word '.repeat(5000)}</p>` } };
  assert.equal(C.threadOf([long], { text })[0].text.length, C.LIMIT.post, 'a post is cut to its own limit');
  const many = Array.from({ length: 80 }, (_, i) => ({ ...ALL[1], id: `_${500 + i}_1`, postDate: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() }));
  assert.equal(C.threadOf(many, { text }).length, C.LIMIT.posts);
});

test('the thread leaves out drafts, deleted and empty posts, and the names of anonymous posters', () => {
  const draft = { ...ALL[1], id: '_401_1', lifecycle: 'DRAFT' }, gone = { ...ALL[1], id: '_402_1', lifecycle: 'DELETED' }, empty = { ...ALL[1], id: '_403_1', body: { rawText: '<p><br></p>' } };
  const anon = { ...ALL[1], id: '_404_1', postAsAnonymous: true }, myAnon = { ...ALL[2], id: '_405_1', postAsAnonymous: true };
  const th = C.threadOf([draft, gone, empty, anon, myAnon, { id: 'nope' }, null], { me: ME, text });
  assert.deepEqual(th.map((x) => [x.id, x.author]), [['_404_1', ''], ['_405_1', 'Sam Rivera']]);
});

test('the post a reply answers: from the thread, its text from the page only when the thread lacks it, its author never', () => {
  const th = C.threadOf(ALL, { me: ME, text });
  assert.deepEqual(C.replyToOf(th, '_201_1', { author: 'Label Name', text: 'page text' }), { id: '_201_1', author: 'Jordan Lee', text: th[0].text });
  assert.deepEqual(C.replyToOf([], '_201_1', { author: 'Label Name', text: ' page  text ' }), { id: '_201_1', author: '', text: 'page text' });
  assert.equal(C.replyToOf(th, '', {}), null);
  assert.equal(C.replyToOf([], '_201_1', {}), null);
});

test('the student: as users/me names them, else as their own posts do', () => {
  assert.deepEqual(C.userOf({ id: ME, userName: 'synthetic' }, ALL), { name: 'Sam Rivera', given: 'Sam', family: 'Rivera' });
  assert.deepEqual(C.userOf({ id: ME, givenName: 'Samantha', familyName: 'Rivera' }, []), { name: 'Samantha Rivera', given: 'Samantha', family: 'Rivera' });
  assert.deepEqual(C.userOf(null, ALL), { name: '', given: '', family: '' });
});

test('the frame\'s context: a message gets its course and the student only; a reply also what it answers', () => {
  const course = { id: '_101_1', name: 'ENGL 2110' }, user = { name: 'Sam Rivera', given: 'Sam', family: 'Rivera' };
  assert.deepEqual(C.contextOf({ kind: 'message', course, user, prompt: { text: 'x' }, thread: [{}] }), { kind: 'message', course, user });
  const th = C.threadOf(ALL, { me: ME, text });
  const req = { minWords: 250, maxWords: null, sources: 2, replies: 2 };
  const reply = C.contextOf({ kind: 'reply', course, user, prompt: { text: 'p' }, requirements: req, thread: th, replyTo: C.replyToOf(th, '_201_1') });
  assert.deepEqual(Object.keys(reply), ['kind', 'course', 'user', 'prompt', 'requirements', 'thread', 'replyTo']);
  assert.equal(reply.replyTo.author, 'Jordan Lee');
  assert.ok(!('replyTo' in C.contextOf({ kind: 'post', course, user, thread: th })));
  assert.deepEqual(JSON.parse(JSON.stringify(reply)), reply, 'it crosses a MessagePort as it is');
});

// lib/ultra.js's reader over the fixtures, counting what it asks.
const site = 'https://bb.school.test';
const fake = (fail = new Set()) => {
  const asked = [];
  const f = async (url, init) => {
    const u = new URL(url);
    asked.push({ method: init.method, path: u.pathname + u.search });
    const base = '/learn/api/v1/courses/_101_1/discussionboards/default/forums/_1101_1/messages';
    let j = null;
    if (fail.has(u.pathname)) return new Response('', { status: 500 });
    if (u.pathname === '/learn/api/public/v1/courses/_101_1/discussions') j = LIST;
    else if (u.pathname === base) j = u.searchParams.get('offset') === '2' ? PAGE2 : PAGE1;
    else if (u.pathname === `${base}/_201_1/replies`) j = REPLIES;
    else if (/\/replies$/.test(u.pathname)) j = { results: [], paging: {} };
    return j ? new Response(JSON.stringify(j), { status: 200 }) : new Response('', { status: 404 });
  };
  return { asked, r: read({ origin: site, f, maxPages: C.LIMIT.pages, maxRequests: C.LIMIT.requests }) };
};

test('reads: the discussions list with its fields, the forum\'s messages page by page, the answered post\'s replies first', async () => {
  const { asked, r } = fake();
  const list = await C.discussions(r, '_101_1');
  assert.deepEqual(list.map((d) => d.id), ['_1099_1', '_1101_1', '_1103_1', '_1105_1']);
  assert.equal(asked[0].path, '/learn/api/public/v1/courses/_101_1/discussions?limit=200&fields=id%2Ctitle%2Cavailable%2Ctopic.body%2Ctopic.status%2CgradebookColumnId');
  const m = await C.messages(r, '_101_1', '_1101_1', { first: '_201_1' });
  assert.deepEqual(m.map((x) => x.id), ['_201_1', '_202_1', '_203_1', '_302_1', '_301_1']);
  assert.deepEqual(asked.slice(1).map((a) => a.path), [
    '/learn/api/v1/courses/_101_1/discussionboards/default/forums/_1101_1/messages',
    '/learn/api/v1/courses/_101_1/discussionboards/default/forums/_1101_1/messages?limit=2&offset=2',
    '/learn/api/v1/courses/_101_1/discussionboards/default/forums/_1101_1/messages/_201_1/replies?limit=10&offset=0&sort=draft(desc),postDate(desc)',
  ], 'only posts with replies are asked for theirs');
  assert.ok(asked.every((a) => a.method === 'GET'));
});

test('reads are bounded: a failed replies read leaves the rest, and the request budget stops the walk', async () => {
  const base = '/learn/api/v1/courses/_101_1/discussionboards/default/forums/_1101_1/messages';
  const { r } = fake(new Set([`${base}/_201_1/replies`]));
  assert.deepEqual((await C.messages(r, '_101_1', '_1101_1', { first: '_201_1' })).map((x) => x.id), ['_201_1', '_202_1', '_203_1']);
  // Forty posts with replies: the reader's budget (and the replies cap) end it, with what was read kept.
  const posts = Array.from({ length: 40 }, (_, i) => ({ ...PAGE1.results[0], id: `_${600 + i}_1`, bodyLength: 10 }));
  const asked = [];
  const r2 = read({ origin: site, maxPages: C.LIMIT.pages, maxRequests: C.LIMIT.requests, f: async (url) => {
    asked.push(url);
    const u = new URL(url);
    return new Response(JSON.stringify(u.pathname.endsWith('/messages') ? { results: posts, paging: {} } : { results: [], paging: {} }), { status: 200 });
  } });
  const got = await C.messages(r2, '_101_1', '_1101_1');
  assert.equal(got.length, 40);
  assert.equal(asked.length, 1 + C.LIMIT.replies);
  await assert.rejects(C.messages(fake(new Set([base])).r, '_101_1', '_1101_1'), /HTTP 500/, 'no top-level list: the caller leaves the thread empty');
});
