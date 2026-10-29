// The AI harness in the real worker (lib/background.js in a vm, test/helpers/worker-env.cjs): who may open the 'glaze:ai' port
// and who may keep connections, where the key is kept (the worker's own IndexedDB: not storage.local, which any page's script
// can read, nor sync), that neither a Back up file nor a shared Look carries AI's settings or a key, and that the writer
// frame is judged by the frame it sits in and its tab's page, with an Ultra attempt open to the writer's features only once
// it is known to be an assignment.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const worker = require('./helpers/worker-env.cjs');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

const CANVAS = 'https://school.instructure.com', EXT = 'chrome-extension://x';
const KEY = 'sk-proj-WORKERKEY0123456789';
const lms = (p = '/courses/1', extra = {}) => ({ id: 'glaze', frameId: 0, url: `${CANVAS}${p}`, origin: CANVAS, tab: { id: 4, url: `${CANVAS}${p}` }, ...extra });
const editor = (extra = {}) => ({ id: 'glaze', frameId: 0, url: `${EXT}/options.html`, origin: EXT, tab: { id: 9, url: `${EXT}/options.html` }, ...extra });
const make = (fetch) => worker({ globals: fakeIDB(), fetch, grants: new Set(['https://api.example.com/*']),
  store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ai: { on: true, model: { use: 'main', model: 'gpt-x' }, features: { syllabus: true } } }, session: {} } });
const live = (w, sender) => {
  w.context.chrome.tabs.get = async () => sender.tab;
  w.context.chrome.scripting.executeScript = async () => [{ result: { href: sender.url, origin: sender.origin, ancestors: sender.frameId > 0 ? [sender.tab.url] : [] } }];
};
const status = async (w, sender) => {
  live(w, sender);
  const { port, say } = w.connect('glaze:ai', sender);
  say({ id: 1, op: 'status', feature: 'syllabus' });
  await w.settle();
  return { port, reply: port.posted[0] && JSON.parse(JSON.stringify(port.posted[0])) };
};

test('Glaze in a page of a site it runs on, and Glaze\'s own pages, may open the AI port; a quiz, a tool, another site may not', async () => {
  const w = make();
  for (const sender of [lms(), lms('/courses/1/assignments/syllabus'), editor(), lms('/courses/1', { frameId: 2, tab: { id: 4, url: `${CANVAS}/courses/1` } })]) {
    const { port, reply } = await status(w, sender);
    assert.equal(port.hungUp, false, sender.url);
    assert.equal(reply.type, 'status', sender.url);
  }
  for (const sender of [lms('/courses/1/quizzes/3'), lms('/courses/1/external_tools/9'), lms('/courses/1/assignments/2/lti'),
    { ...lms(), url: 'https://evil.example.com/', origin: 'https://evil.example.com', tab: { id: 4, url: 'https://evil.example.com/' } },
    { ...lms(), id: 'another-extension' }]) {
    const { port, reply } = await status(w, sender);
    assert.equal(port.hungUp, true, sender.url);
    assert.equal(reply, undefined, `${sender.url}: nothing read, nothing said`);
  }
});

test('a document opened from the Documents page (papers.html, its tab\'s top frame) asks for the writer\'s features; it has no LMS account, so no visual cache authority', async () => {
  const w = make();
  const page = `${EXT}/papers.html?paper=doc%3A00000000-0000-4000-8000-000000000000`;
  const home = { id: 'glaze', frameId: 0, documentId: 'papers-doc', url: page, origin: EXT, tab: { id: 6, url: page } };
  let read = 0;
  w.context.chrome.scripting.executeScript = async () => { read++; return []; };
  for (const feature of ['completion', 'writing']) {
    const { port, say } = w.connect('glaze:ai', home);
    say({ id: 1, op: 'status', feature });
    await w.settle();
    assert.equal(port.hungUp, false, feature);
    assert.equal(port.posted[0]?.type, 'status', feature);
  }
  assert.equal(await require('node:vm').runInContext('aiSender', w.context)(home, { op: 'run', feature: 'writing' }), true);
  assert.equal(await require('node:vm').runInContext('aiVisualScope', w.context)(home), null);
  assert.equal(read, 0, 'nothing is read from a page: there is no LMS page behind it');
  for (const extra of [{ frameId: 2 }, { origin: 'https://evil.example.com' }, { id: 'another-extension' },
    { url: 'https://school.instructure.com/papers.html', origin: CANVAS }, { url: 'chrome-extension://x.evil/papers.html' }]) {
    const { port, say } = w.connect('glaze:ai', { ...home, ...extra });
    say({ id: 1, op: 'status', feature: 'writing' }); await w.settle();
    assert.equal(port.hungUp, true, JSON.stringify(extra)); assert.equal(port.posted.length, 0);
  }
});

test('only Settings\' own top frame keeps connections, and the key never leaves the worker\'s own store', async () => {
  const w = make();
  const set = { type: 'glaze:ai-config', op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } };
  for (const sender of [lms(), editor({ frameId: 3 }), { ...editor(), url: `${EXT}/popup.html` }, { ...editor(), origin: 'https://evil.example.com' }]) {
    assert.deepEqual(await w.send(set, sender), { ok: false, error: 'sender' }, sender.url);
  }
  assert.deepEqual(await w.send(set, editor()), { ok: true, origin: 'https://api.example.com/*' });
  const got = await w.send({ type: 'glaze:ai-config', op: 'get' }, editor());
  assert.deepEqual(JSON.parse(JSON.stringify(got.connections.main)), { provider: 'openai', base: 'https://api.example.com/v1', key: 'sk-p••••6789', origin: 'https://api.example.com/*' });
  const kept = JSON.stringify([w.store.local, w.store.sync, w.store.session, got]);
  assert.ok(!kept.includes(KEY), 'not in storage.local, sync or session, nor read back');
  // The page asks; the worker answers with what it may know: the host the text would go to (the import dialog says it),
  // never the address's path, the model or the key.
  const { reply } = await status(w, lms());
  assert.deepEqual(reply, { id: 1, type: 'status', on: true, allowed: true, ready: true, provider: 'openai', caps: { text: true, json: true, stream: true }, to: 'api.example.com' });
  assert.ok(!/\/v1|gpt|sk-/.test(JSON.stringify(reply)));
});

test('a run from a page reaches only the connection\'s server, with the key, and the page gets the checked output', async () => {
  const calls = [];
  const w = make(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"ok"}' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  });
  await w.send({ type: 'glaze:ai-config', op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } }, editor());
  live(w, lms());
  const { port, say } = w.connect('glaze:ai', lms());
  await w.settle();
  // A task the worker would import with the harness (lib/background.js aiFiles); here added in its realm.
  require('node:vm').runInContext(`GZ_AI_TASKS.add({ id: 'example.echo', version: 1, input: (r) => r, check: (o) => o,
    build: (i, { text }) => text.request({ system: 'Echo.', data: [{ label: 'text', text: i.text }] }),
    output: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } })`, w.context);
  say({ id: 2, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hi' } });
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(port.posted.at(-1).output)), { text: 'ok' });
  assert.deepEqual(calls.map((c) => c.url), ['https://api.example.com/v1/models', 'https://api.example.com/v1/chat/completions']);
  assert.equal(calls[1].init.headers.authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(port.posted).includes(KEY));
  // The run's row: metadata only, in storage.local aiCalls.
  assert.equal(w.store.local.aiCalls.length, 1);
  assert.ok(!JSON.stringify(w.store.local.aiCalls).includes(KEY) && !JSON.stringify(w.store.local.aiCalls).includes('api.example.com'));
  // The host taken back: refused before anything is sent.
  w.grants.delete('https://api.example.com/*');
  say({ id: 3, op: 'run', feature: 'syllabus', task: 'example.echo', input: { text: 'hi' } });
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(port.posted.at(-1))), { id: 3, type: 'error', error: 'permission' });
  assert.equal(calls.length, 2);
});

test('AI is off by default: a fresh worker has no settings for it, and a page is told it may not ask', async () => {
  const w = worker({ globals: fakeIDB() });
  const { reply } = await status(w, lms());
  assert.deepEqual(reply, { id: 1, type: 'status', on: false, allowed: false });
  assert.equal(w.store.local.ai, undefined);
});

test('a Back up file and a shared Look carry none of AI\'s settings, its connections or a key', async () => {
  const G = require('../defaults.js');
  const BK = require('../lib/backup.js');
  const SH = require('../lib/share.js');
  const local = { ai: { on: true, use: 'main', features: { syllabus: true } }, aiCalls: [{ id: 'r', task: 't', state: 'completed' }], connections: { main: { key: KEY } }, aiKey: KEY };
  const settings = G.GZ_SANITIZE({ ...G.GZ_DEFAULTS, ai: { on: true }, aiKey: KEY });
  assert.equal(settings.ai, undefined, 'not a synced setting');
  const entries = BK.pack({ settings, tasks: { tasks: {} }, local });
  const text = entries.map((e) => Buffer.from(e.data).toString()).join('\n');
  assert.ok(!text.includes(KEY));
  assert.ok(!/"ai"\s*:|aiCalls/.test(text), 'storage.local ai and the call record are not in the file');
  const code = await SH.encode({ ...settings, ai: { on: true }, aiKey: KEY }, {}, null);
  const look = JSON.stringify(await SH.decode(code));
  assert.match(look, /"colors"/, 'a Look, read back');
  assert.ok(!code.includes(KEY) && !look.includes(KEY) && !/"ai"/.test(look));
});

test('nothing of AI is in a page\'s first script, and the worker loads it only when a port opens', () => {
  const m = require('../manifest.json');
  for (const c of m.content_scripts) for (const f of c.js) assert.ok(!f.startsWith('lib/ai/'), f);
  const bg = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
  assert.ok(!/^importScripts\([^)]*ai\//m.test(bg), 'not in the worker\'s first imports');
  const w = worker();
  assert.equal(w.context.GZ_AI_BROKER, undefined);
});

test('Firefox\'s event page loads every file of the harness the worker would import, by name', () => {
  // scripts/package-firefox.sh: the files named in the worker's importScripts calls, as it reads them.
  const bg = fs.readFileSync(path.join(__dirname, '..', 'lib/background.js'), 'utf8');
  const named = new Set([...bg.matchAll(/importScripts\(([^)]*)\)/g)].flatMap(([, a]) => [...a.matchAll(/'([^']+)'/g)].map(([, f]) => `lib/${f}`)));
  const shipped = fs.readdirSync(path.join(__dirname, '..', 'lib/ai'), { recursive: true }).filter((f) => f.endsWith('.js') && f !== 'providers/mock.js').map((f) => `lib/ai/${f}`);
  assert.ok(shipped.length >= 14);
  for (const f of shipped) assert.ok(named.has(f), `${f} is named in an importScripts call`);
  assert.ok(!named.has('lib/ai/providers/mock.js'), 'the mock is for tests and the eval');
});

test('AI rejects opaque frames, foreign top pages and assessment ancestors', async () => {
  const w = make();
  for (const sender of [
    lms('/courses/1', { origin: 'null' }),
    lms('/courses/1', { frameId: 2, tab: { id: 4, url: `${CANVAS}/courses/1/quizzes/3` } }),
    lms('/courses/1', { frameId: 2, tab: { id: 4, url: 'https://evil.example.com/' } }),
    editor({ frameId: 2, tab: { id: 9, url: 'https://evil.example.com/' } }),
  ]) {
    const { port, reply } = await status(w, sender);
    assert.equal(port.hungUp, true, JSON.stringify(sender));
    assert.equal(reply, undefined);
  }
});

test('an existing AI port loses authority after SPA navigation to an assessment', async () => {
  const w = make();
  let href = `${CANVAS}/courses/1`;
  w.context.chrome.tabs.get = async () => ({ id: 4, url: href });
  w.context.chrome.scripting.executeScript = async () => [{ result: { href, origin: CANVAS, ancestors: [] } }];
  const { port, say } = w.connect('glaze:ai', lms());
  say({ id: 1, op: 'status', feature: 'syllabus' });
  await w.settle();
  assert.equal(port.posted[0].type, 'status');
  href = `${CANVAS}/courses/1/quizzes/3`;
  say({ id: 2, op: 'status', feature: 'syllabus' });
  await w.settle();
  assert.equal(port.hungUp, true);
  assert.equal(port.posted.length, 1);
});

test('AI checks every ancestor of a same-site course frame', async () => {
  const w = make(), href = `${CANVAS}/courses/1`;
  w.context.chrome.tabs.get = async () => ({ id: 4, url: href });
  w.context.chrome.scripting.executeScript = async () => [{ result: { href, origin: CANVAS, ancestors: [`${CANVAS}/courses/1/quizzes/3`, href] } }];
  const { port, say } = w.connect('glaze:ai', lms('/courses/1', { frameId: 2 }));
  say({ id: 1, op: 'status', feature: 'syllabus' });
  await w.settle();
  assert.equal(port.hungUp, true);
  assert.equal(port.posted.length, 0);
});

// ---- the writer frame: Glaze's own page inside an LMS tab, judged by the frame it sits in and the tab --------------------
const vm = require('node:vm');
const ULTRA = 'https://school.blackboard.com';
const COURSE = `${ULTRA}/ultra/courses/_101_1/outline`;
const ATTEMPT = `${ULTRA}/ultra/courses/_101_1/assessment/_7_1/attempt/create?courseId=_101_1`;
const OTHER = `${ULTRA}/ultra/courses/_101_1/assessment/_8_1/attempt/create?courseId=_101_1`;
const writerOn = (fetch) => {
  const w = worker({ globals: fakeIDB(), fetch,
    store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ai: { on: true, model: { use: 'main', model: 'gpt-x' }, features: { syllabus: true, completion: true, writing: true } } }, session: {} } });
  return live2(w);
};
// The tab's page is w.page, read live; w.frames[frameId] = { href, ancestors } is what each LMS frame of the tab holds now
// (frame 0: the tab's page). Glaze's writer frame is never scripted itself.
const live2 = (w) => {
  w.frames = {};
  w.context.chrome.tabs.get = async (id) => ({ id, url: w.page });
  w.context.chrome.scripting.executeScript = async ({ target }) => {
    const documentId = target.documentIds?.[0];
    const id = target.frameIds?.[0] ?? (documentId === (w.topDocument || 'top-doc') ? 0 : Number(Object.keys(w.frames).find((id) => (w.frames[id].documentId || `doc-${id}`) === documentId)));
    if (id === 3) throw new Error('an extension frame is never scripted');
    const f = id === 0 ? { href: w.page, ancestors: [] } : w.frames[id];
    return f ? [{ frameId: id, documentId: id === 0 ? (w.topDocument || 'top-doc') : (f.documentId || `doc-${id}`), result: { href: f.href, origin: new URL(f.href).origin, ancestors: f.ancestors } }] : [];
  };
  return w;
};
const frame = (tab, extra = {}) => ({ id: 'glaze', frameId: 3, url: `${EXT}/writer.html`, origin: EXT, tab: { id: 5, url: tab }, ...extra });
const top = (url, extra = {}) => ({ id: 'glaze', frameId: 0, documentId: 'top-doc', url, origin: new URL(url).origin, tab: { id: 5, url }, ...extra });
// The writer's claim of its pass names the frame it sits in (lib/background.js glaze:writer).
const seat = (w, writer = frame(w.page), host = top(w.page)) => vm.runInContext('aiFrameHost', w.context)(writer, host);
// Each status asked on a port of its own.
const ask = async (w, sender, feature = 'completion') => {
  const { port, say } = w.connect('glaze:ai', sender);
  say({ id: 1, op: 'status', feature });
  await w.settle();
  return port.hungUp ? 'hung up' : port.posted[0]?.allowed === true ? 'allowed' : port.posted[0]?.why;
};
const report = (w, kind, sender = top(w.page)) => w.send({ type: 'glaze:attempt-kind', kind }, sender);

test('Glaze\'s writer frame may ask from a course page it sits in; from a quiz, a tool, another site, or unseated, it may not', async () => {
  const w = writerOn();
  for (const page of [COURSE, `${CANVAS}/courses/1/discussion_topics/2`]) {
    w.page = page;
    await seat(w);
    assert.equal(await ask(w, frame(page)), 'allowed', page);
    assert.equal(await ask(w, frame(page), 'syllabus'), 'allowed', page);
  }
  for (const page of [`${CANVAS}/courses/1/quizzes/3/take`, `${CANVAS}/courses/1/external_tools/9`, `${ULTRA}/ultra/courses/_101_1/outline/lti/launch`, 'https://evil.example.com/', `${ULTRA}/ultra/courses/_101_1/assessment/_7_1/overview`]) {
    w.page = page;
    await seat(w);
    assert.equal(await ask(w, frame(page)), 'hung up', page);
  }
  w.page = COURSE;
  await seat(w);
  w.page = `${CANVAS}/courses/1/quizzes/3/take`;
  assert.equal(await ask(w, frame(COURSE)), 'hung up', 'the tab as it is now, not as the port was opened');
  w.page = COURSE;
  assert.equal(await ask(w, { ...frame(COURSE), url: `${EXT}/options.html` }), 'hung up', 'only the writer frame');
  assert.equal(await ask(w, { ...frame(COURSE), origin: 'https://evil.example.com' }), 'hung up');
  assert.equal(await ask(w, frame(COURSE, { frameId: 7 })), 'hung up', 'a writer frame no claim seated');
  assert.equal(await ask(w, frame(COURSE, { tab: { id: 6, url: COURSE } })), 'hung up', 'nor one in another tab');
});

test('a writer frame inside another frame is judged by that frame and every frame above it', async () => {
  const w = writerOn();
  w.page = COURSE;
  const inner = { ...top(COURSE), frameId: 4, documentId: 'doc-4' };
  await seat(w, frame(COURSE), inner);
  w.frames[4] = { href: `${ULTRA}/ultra/courses/_102_1/discussion/_9_1`, ancestors: [COURSE] };
  assert.equal(await ask(w, frame(COURSE)), 'allowed', 'a course tab\'s live frame on a discussion');
  w.frames[4] = { href: `${ULTRA}/ultra/courses/_102_1/assessment/_7_1/attempt/create`, ancestors: [COURSE] };
  assert.deepEqual(await report(w, 'assignment', top(COURSE)), { ok: false });
  assert.equal(await ask(w, frame(COURSE)), 'attempt', 'an attempt in a course tab: never known to be an assignment');
  assert.equal(await ask(w, frame(COURSE), 'syllabus'), 'hung up');
  w.frames[4] = { href: `${ULTRA}/ultra/courses/_102_1/discussion/_9_1`, ancestors: [`${ULTRA}/ultra/courses/_102_1/assessment/_7_1/overview`, COURSE] };
  assert.equal(await ask(w, frame(COURSE)), 'hung up', 'a quiet frame above it');
  w.frames[4] = { href: 'https://tool.example.com/embed', ancestors: [COURSE] };
  assert.equal(await ask(w, frame(COURSE)), 'hung up', 'another site');
  delete w.frames[4];
  assert.equal(await ask(w, frame(COURSE)), 'hung up', 'the frame it sat in is gone');
  w.frames[4] = { href: COURSE, ancestors: [] };
  assert.equal(await ask(w, frame(COURSE)), 'hung up', 'a frame that says it is the top is not the frame that was seated');
});

test('on an Ultra attempt the writer\'s features wait for the tab\'s Glaze to say it is an assignment; a test, or no word, is refused', async () => {
  const w = writerOn();
  w.page = ATTEMPT;
  await seat(w);
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'refused with its code, the port kept');
  assert.equal(await ask(w, frame(ATTEMPT), 'writing'), 'attempt');
  assert.deepEqual(await report(w, 'test'), { ok: true });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'a test');
  assert.deepEqual(await report(w, 'assignment'), { ok: true });
  assert.equal(await ask(w, frame(ATTEMPT)), 'allowed');
  assert.equal(await ask(w, frame(ATTEMPT), 'writing'), 'allowed');
  assert.equal(await ask(w, frame(ATTEMPT), 'syllabus'), 'hung up', 'everything else stays quiet');
  assert.deepEqual(await report(w, 'test'), { ok: true });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'the last word counts');
  assert.deepEqual(await report(w, 'assignment'), { ok: true });
  assert.deepEqual(await report(w, 'unknown'), { ok: true });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'unknown takes an assignment back');
  // A content script on the attempt itself is still never an AI sender.
  const { port, say } = w.connect('glaze:ai', top(ATTEMPT));
  say({ id: 1, op: 'status', feature: 'completion' });
  await w.settle();
  assert.equal(port.hungUp, true);
});

test('the attempt\'s kind counts only from the tab\'s own top frame, on that attempt, from Glaze', async () => {
  const w = writerOn();
  w.page = ATTEMPT;
  await seat(w);
  for (const [why, sender] of [['a subframe', top(ATTEMPT, { frameId: 2 })], ['another extension', top(ATTEMPT, { id: 'other' })], ['not an attempt', top(COURSE)],
    ['another site', top('https://evil.example.com/ultra/courses/_1_1/assessment/_7_1/attempt/create')], ['Glaze\'s own page', { ...frame(ATTEMPT), frameId: 0 }]]) {
    assert.deepEqual(await report(w, 'assignment', sender), { ok: false }, why);
    assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', why);
  }
  assert.deepEqual(await report(w, 'quiz'), { ok: false }, 'a kind it doesn\'t know');
  assert.deepEqual(await report(w, 'assignment', top(ATTEMPT, { tab: { id: 6, url: ATTEMPT } })), { ok: true });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'another tab\'s word is that tab\'s');
  assert.deepEqual(await report(w, 'assignment', top(OTHER)), { ok: false });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'said of another attempt than the one the tab shows');
  w.store.sync.enabled = false;
  assert.deepEqual(await report(w, 'assignment'), { ok: false }, 'Glaze switched off');
});

test('the word goes when the tab goes anywhere else, is kept through a fragment change and a stopped worker, and goes with the tab', async () => {
  const w = writerOn();
  w.page = ATTEMPT;
  await seat(w);
  await report(w, 'assignment');
  assert.equal(await ask(w, frame(ATTEMPT)), 'allowed');
  for (const f of w.updated) f(5, { url: `${ATTEMPT}#top` });
  assert.equal(await ask(w, frame(ATTEMPT)), 'allowed', 'the same page');
  const again = live2(worker({ globals: fakeIDB(), store: w.store }));
  again.page = ATTEMPT;
  assert.equal(await ask(again, frame(ATTEMPT)), 'allowed', 'a restarted worker reads both back');
  for (const f of w.updated) f(5, { url: COURSE });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', 'back on the attempt: it must be said again');
  await report(w, 'assignment');
  w.page = OTHER;
  assert.equal(await ask(w, frame(w.page)), 'attempt', 'a page change the worker hasn\'t heard of yet');
  w.page = ATTEMPT;
  for (const f of w.removed) f(5);
  assert.equal(await ask(w, frame(ATTEMPT)), 'hung up', 'a closed tab: neither the word nor the seat');
  assert.deepEqual([w.store.session.aiAttempts, w.store.session.aiHosts], [{}, {}]);
});

// Documents as a page of an LMS tab (features/settingspage.js): each document its frame loads claims a pass the tab's page
// asked for ('glaze:papers'), and that claim seats it as Writer's claim does, judged by the page it sits in.
test("Documents' frame in a school's page asks as Writer's frame does, seated by its own document's pass, judged by the page it sits in", async () => {
  const w = writerOn();
  const docs = (page, extra = {}) => ({ id: 'glaze', frameId: 3, documentId: 'papers-1', url: `${EXT}/papers.html`, origin: EXT, tab: { id: 5, url: page }, ...extra });
  const claim = async (sender, host = top(w.page)) => {
    const pass = crypto.randomUUID();
    assert.deepEqual(await w.send({ type: 'glaze:papers', op: 'job', pass }, host), { ok: true });
    return w.send({ type: 'glaze:papers', op: 'claim', pass }, sender);
  };
  w.page = COURSE;
  assert.equal(await ask(w, docs(COURSE)), 'hung up', 'before its claim (a site framing papers.html)');
  assert.deepEqual(await claim(docs(COURSE)), { ok: true });
  assert.equal(await ask(w, docs(COURSE)), 'allowed');
  assert.equal(await ask(w, docs(COURSE), 'writing'), 'allowed');
  // A document opened in place: the frame's next document, seated by its own pass; the list it replaced is not.
  const next = docs(COURSE, { documentId: 'papers-2', url: `${EXT}/papers.html?paper=doc%3A00000000-0000-4000-8000-000000000000` });
  assert.equal(await ask(w, next), 'hung up', 'before its own claim');
  assert.deepEqual(await claim(next), { ok: true });
  assert.equal(await ask(w, next), 'allowed');
  assert.equal(await ask(w, docs(COURSE)), 'hung up', 'the document it replaced');
  assert.equal(await ask(w, { ...next, frameId: 4 }), 'hung up', 'another frame');
  assert.equal(await ask(w, { ...next, tab: { id: 6, url: COURSE } }), 'hung up', 'another tab');
  assert.equal(await ask(w, { ...next, url: `${EXT}/options.html` }), 'hung up', 'not Documents');
  // The tab's loading can be a same-document history entry. A frame that never claimed gets no seat.
  for (const f of w.updated) f(5, { status: 'loading' });
  assert.equal(await ask(w, next), 'allowed', 'after the tab\'s loading');
  assert.equal(await ask(w, docs(COURSE, { documentId: 'papers-9' })), 'hung up', 'a document of that frame that claimed nothing');
  // The page under it, read live: a quiz or a tool's page refuses it; an attempt waits for the word that it is an assignment.
  w.page = `${CANVAS}/courses/1/quizzes/3/take`;
  assert.equal(await ask(w, next), 'hung up', 'a quiz');
  w.page = ATTEMPT;
  const onAttempt = docs(ATTEMPT, { documentId: 'papers-3' });
  assert.deepEqual(await claim(onAttempt), { ok: true });
  assert.equal(await ask(w, onAttempt), 'attempt');
  assert.deepEqual(await report(w, 'assignment'), { ok: true });
  assert.equal(await ask(w, onAttempt), 'allowed');
  assert.equal(await ask(w, onAttempt, 'syllabus'), 'hung up');
  for (const f of w.removed) f(5);
  assert.equal(await ask(w, onAttempt), 'hung up', 'the tab closed');
});

test('on an assignment attempt the writer frame runs a completion; a cancel passes on any attempt', async () => {
  const sent = [];
  const w = writerOn(async (url) => {
    sent.push(url);
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'gpt-x' }] }), { headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ choices: [{ message: { content: ' runs to the sea.' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } });
  });
  w.grants.add('https://api.example.com/*');
  await w.send({ type: 'glaze:ai-config', op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x' } }, editor());
  vm.runInContext(`GZ_AI_TASKS.add({ id: 'example.finish', version: 1, output: 'text', stream: true, rate: { supersede: true }, input: (r) => r, check: (t) => t,
    build: (i, { text }) => text.request({ system: 'Finish it.', data: [{ label: 'before', text: i.text }] }) })`, w.context);
  w.page = ATTEMPT;
  await seat(w);
  const { port, say } = w.connect('glaze:ai', frame(ATTEMPT));
  say({ id: 1, op: 'run', feature: 'completion', task: 'example.finish', input: { text: 'The river' } });
  say({ id: 1, op: 'cancel' });
  await w.settle();
  assert.deepEqual(JSON.parse(JSON.stringify(port.posted)), [{ id: 1, type: 'error', error: 'attempt' }]);
  assert.equal(port.hungUp, false);
  await report(w, 'assignment');
  say({ id: 2, op: 'run', feature: 'completion', task: 'example.finish', input: { text: 'The river' } });
  await w.settle();
  assert.equal(port.posted.at(-1).output, ' runs to the sea.');
  assert.deepEqual(sent, ['https://api.example.com/v1/models', 'https://api.example.com/v1/chat/completions']);
});


test('attempt reports cannot authorize a stale route or a replaced top document', async () => {
  const w = writerOn(); w.page = ATTEMPT;
  await seat(w);
  assert.deepEqual(await report(w, 'assignment', top(OTHER)), { ok: false }, 'a stale route report');
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt');
  w.topDocument = 'new-top-doc';
  assert.deepEqual(await report(w, 'assignment', top(ATTEMPT)), { ok: false }, 'a replaced document at the same URL');
  assert.equal(await ask(w, frame(ATTEMPT)), 'hung up', 'the old seat belongs to the replaced document');
});

test('same-URL reloads and navigation before session hydration discard attempt authority', async () => {
  const w = writerOn(); w.page = ATTEMPT;
  await seat(w); await report(w, 'assignment');
  w.topDocument = 'reloaded-top'; // a reload replaces the document, unlike pushState
  for (const f of w.updated) f(5, { status: 'loading' });
  assert.notEqual(await ask(w, frame(ATTEMPT)), 'allowed', 'reload requires a fresh report');
  const store = structuredClone(w.store);
  store.session.aiAttempts = { 5: { page: ATTEMPT, kind: 'assignment', documentId: 'top-doc' } };
  const again = live2(worker({ globals: fakeIDB(), store })); again.page = ATTEMPT;
  for (const f of again.updated) f(5, { url: COURSE });
  await seat(again);
  assert.equal(await ask(again, frame(ATTEMPT)), 'attempt', 'hydration must not resurrect a report cleared by navigation');
});

test('same-document loading preserves Writer seats and assignment evidence, including before session hydration', async () => {
  const w = writerOn(); w.page = ATTEMPT;
  const writer = frame(ATTEMPT, { documentId: 'writer-doc' });
  await seat(w, writer); await report(w, 'assignment');
  const store = structuredClone(w.store);
  for (const f of w.updated) f(5, { status: 'loading' });
  assert.equal(await ask(w, writer), 'allowed', 'pushState keeps an ordinary Writer frame usable');
  const again = live2(worker({ globals: fakeIDB(), store })); again.page = ATTEMPT;
  for (const f of again.updated) f(5, { status: 'loading' });
  assert.equal(await ask(again, writer), 'allowed', 'loading does not suppress the sleeping worker\'s seats');
  // Every request still reads the pinned host and its ancestry. A replacement at the same URL gets no authority.
  again.topDocument = 'replacement-top';
  assert.equal(await ask(again, writer), 'hung up', 'same URL, different host document');
  again.topDocument = 'top-doc'; again.page = `${CANVAS}/courses/1/quizzes/3`;
  assert.equal(await ask(again, writer), 'hung up', 'SPA navigation to a quiz');
  again.page = ATTEMPT;
  assert.equal(await ask(again, { ...writer, documentId: 'replacement-writer' }), 'hung up', 'same frame, different Writer document');
});

test('a Documents claim cannot lend an AI seat to another extension page after loading', async () => {
  const w = writerOn(); w.page = COURSE;
  const docs = { ...frame(COURSE, { documentId: 'documents-doc' }), url: `${EXT}/papers.html` };
  const pass = crypto.randomUUID();
  await w.send({ type: 'glaze:papers', op: 'job', pass }, top(COURSE));
  assert.deepEqual(await w.send({ type: 'glaze:papers', op: 'claim', pass }, docs), { ok: true });
  for (const f of w.updated) f(5, { status: 'loading' });
  for (const over of [{ url: `${EXT}/options.html` }, { url: `${EXT}/writer.html`, documentId: 'new-doc' }, { frameId: 4 }, { documentId: 'new-doc' }, { tab: { id: 6, url: COURSE } }, { origin: CANVAS }, { id: 'other' }]) {
    assert.equal(await ask(w, { ...docs, ...over }), 'hung up', JSON.stringify(over));
  }
  assert.equal(await ask(w, docs), 'allowed');
});

test('navigation while an attempt report awaits admission invalidates the report', async () => {
  const w = writerOn(); w.page = ATTEMPT;
  await seat(w);
  const get = w.context.chrome.storage.sync.get;
  let release;
  w.context.chrome.storage.sync.get = (key) => key === 'enabled' ? new Promise((r) => { release = () => r({ enabled: true }); }) : get(key);
  const pending = report(w, 'assignment');
  await w.settle();
  for (const f of w.updated) f(5, { url: COURSE });
  release();
  w.context.chrome.storage.sync.get = get;
  assert.deepEqual(await pending, { ok: false });
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt');
});


test('a replaced writer document must claim its own seat, including after worker restart', async () => {
  const w = writerOn(); w.page = COURSE;
  const claimed = frame(COURSE, { documentId: 'writer-old' });
  await seat(w, claimed);
  assert.equal(await ask(w, claimed), 'allowed');
  const replaced = frame(COURSE, { documentId: 'writer-new' });
  assert.equal(await ask(w, replaced), 'hung up', 'a frame id does not identify the claimed writer document');
  const again = live2(worker({ globals: fakeIDB(), store: structuredClone(w.store) })); again.page = COURSE;
  assert.equal(await ask(again, replaced), 'hung up', 'session hydration must preserve the writer document binding');
  await seat(again, replaced);
  assert.equal(await ask(again, replaced), 'allowed', 'a fresh claim admits the replacement');
});


test('a delayed assignment report cannot overwrite a newer unknown classification', async () => {
  const w = writerOn(); w.page = ATTEMPT;
  await seat(w);
  const get = w.context.chrome.storage.sync.get;
  let release;
  w.context.chrome.storage.sync.get = (key) => {
    if (key !== 'enabled') return get(key);
    w.context.chrome.storage.sync.get = get;
    return new Promise((r) => { release = () => r({ enabled: true }); });
  };
  const old = report(w, 'assignment');
  await w.settle();
  assert.equal(typeof release, 'function');
  assert.deepEqual(await report(w, 'unknown'), { ok: true });
  release();
  assert.deepEqual(await old, { ok: false }, 'the newer refusal wins even when the older read finishes last');
  assert.equal(await ask(w, frame(ATTEMPT)), 'attempt');
  assert.equal(await ask(w, frame(ATTEMPT), 'writing'), 'attempt');
});

test('a pending test or unknown report closes completion and writing before asynchronous validation', async () => {
  for (const kind of ['test', 'unknown']) {
    const w = writerOn(); w.page = ATTEMPT;
    await seat(w); await report(w, 'assignment');
    const get = w.context.chrome.storage.sync.get;
    let release;
    w.context.chrome.storage.sync.get = (key) => {
      if (key !== 'enabled') return get(key);
      w.context.chrome.storage.sync.get = get;
      return new Promise((r) => { release = () => r({ enabled: true }); });
    };
    const pending = report(w, kind);
    await w.settle();
    try {
      assert.equal(await ask(w, frame(ATTEMPT)), 'attempt', `${kind}: completion during validation`);
      assert.equal(await ask(w, frame(ATTEMPT), 'writing'), 'attempt', `${kind}: writing during validation`);
    } finally { release(); await pending; }
  }
});

test('a classification report waking the worker preserves the Writer seat in session storage', async () => {
  const w = writerOn(); w.page = ATTEMPT;
  await seat(w); await report(w, 'assignment');
  const again = live2(worker({ globals: fakeIDB(), store: structuredClone(w.store) })); again.page = ATTEMPT;
  assert.deepEqual(await report(again, 'assignment'), { ok: true });
  assert.equal(await ask(again, frame(ATTEMPT)), 'allowed', 'a report is not a navigation and must hydrate the claimed seat');
});

// A course tab is an LMS frame with its own attempt page; the tab around it can show another course's outline.
const courseAttempt = async (w, { id = 4, href = ATTEMPT, ancestors = [COURSE], documentId = `doc-${id}`, writerId = 3 } = {}) => {
  w.page = COURSE;
  w.frames[id] = { href, ancestors, documentId };
  const host = { ...top(href), frameId: id, documentId, tab: { id: 5, url: COURSE } };
  const writer = frame(COURSE, { frameId: writerId, documentId: `writer-${writerId}` });
  await seat(w, writer, host);
  return { host, writer };
};

for (const kind of ['assignment', 'test', 'unknown']) test(`a course-tab framed ${kind} has its own attempt gate for completion and writing`, async () => {
  const w = writerOn(), { host, writer } = await courseAttempt(w);
  assert.deepEqual(await report(w, kind, host), { ok: true });
  for (const feature of ['completion', 'writing']) assert.equal(await ask(w, writer, feature), kind === 'assignment' ? 'allowed' : 'attempt', feature);
  assert.equal(await ask(w, writer, 'syllabus'), 'hung up');
});

test('a course-tab sender with an initial about:blank snapshot is judged by its pinned live attempt page', async () => {
  const w = writerOn(), { host, writer } = await courseAttempt(w);
  assert.deepEqual(await w.send({ type: 'glaze:attempt-kind', kind: 'assignment', page: ATTEMPT }, { ...host, url: 'about:blank' }), { ok: true });
  assert.equal(await ask(w, writer), 'allowed');
  assert.deepEqual(await w.send({ type: 'glaze:attempt-kind', kind: 'assignment', page: OTHER }, { ...host, url: 'about:blank' }), { ok: false }, 'a claimed page cannot replace the live document check');
  assert.equal(await ask(w, writer, 'writing'), 'attempt');
});

test('a framed assignment works at any depth, but a quiet, foreign or non-LMS ancestor refuses it', async () => {
  const w = writerOn(), { host, writer } = await courseAttempt(w, { ancestors: [`${ULTRA}/ultra/courses/_102_1/outline`, COURSE] });
  assert.deepEqual(await report(w, 'assignment', host), { ok: true });
  assert.equal(await ask(w, writer), 'allowed');
  for (const parent of [OTHER, `${ULTRA}/ultra/courses/_101_1/assessment/_7_1/overview`, 'https://other.example/ultra/courses/_1_1/outline', `${ULTRA}/not-an-lms`]) {
    w.frames[4].ancestors = [parent, COURSE];
    assert.deepEqual(await report(w, 'assignment', host), { ok: false }, parent);
    for (const feature of ['completion', 'writing']) assert.notEqual(await ask(w, writer, feature), 'allowed', parent);
  }
});

test('a replaced or navigated course-tab document cannot retain assignment authority, including across worker restart', async () => {
  const w = writerOn(), { host, writer } = await courseAttempt(w);
  assert.deepEqual(await report(w, 'assignment', host), { ok: true });
  const again = live2(worker({ globals: fakeIDB(), store: structuredClone(w.store) }));
  again.page = COURSE; again.frames = structuredClone(w.frames);
  assert.equal(await ask(again, writer), 'allowed', 'the seat and its document-scoped kind survive a worker restart');
  again.frames[4].href = OTHER;
  assert.equal(await ask(again, writer), 'attempt', 'same document, a different attempt page');
  again.frames[4].href = ATTEMPT;
  assert.equal(await ask(again, writer), 'attempt', 'returning needs fresh evidence after the page mismatch');
  again.frames[4].documentId = 'replacement-doc';
  assert.deepEqual(await report(again, 'assignment', host), { ok: false }, 'the old document is gone');
  assert.equal(await ask(again, writer), 'hung up', 'a reused frame id cannot inherit the old seat');
  const replacement = { ...host, documentId: 'replacement-doc' };
  await seat(again, writer, replacement);
  assert.equal(await ask(again, writer), 'attempt', 'the new document has not reported');
  assert.deepEqual(await report(again, 'assignment', replacement), { ok: true });
  assert.equal(await ask(again, writer, 'writing'), 'allowed');
});

test('an attempt seat without a host document id cannot inherit a report through its frame id', async () => {
  const w = writerOn(), { host, writer } = await courseAttempt(w);
  await report(w, 'assignment', host);
  await seat(w, writer, { ...host, documentId: undefined });
  for (const feature of ['completion', 'writing']) assert.equal(await ask(w, writer, feature), 'attempt', feature);
});

test('course-tab reports and revocations are ordered per document and cannot affect a sibling attempt', async () => {
  const w = writerOn(), one = await courseAttempt(w), two = await courseAttempt(w, { id: 7, href: OTHER, writerId: 6 });
  assert.deepEqual(await report(w, 'assignment', one.host), { ok: true });
  assert.deepEqual(await report(w, 'assignment', two.host), { ok: true });
  const get = w.context.chrome.storage.sync.get;
  let release;
  w.context.chrome.storage.sync.get = (key) => {
    if (key !== 'enabled') return get(key);
    w.context.chrome.storage.sync.get = get;
    return new Promise((r) => { release = () => r({ enabled: true }); });
  };
  const old = report(w, 'assignment', one.host);
  await w.settle();
  try {
    assert.deepEqual(await report(w, 'unknown', one.host), { ok: true });
    assert.deepEqual(await report(w, 'assignment', two.host), { ok: true });
    for (const feature of ['completion', 'writing']) {
      assert.equal(await ask(w, one.writer, feature), 'attempt');
      assert.equal(await ask(w, two.writer, feature), 'allowed');
    }
  } finally { release(); }
  assert.deepEqual(await old, { ok: false }, 'a late assignment cannot undo the newer refusal on that document');
  assert.equal(await ask(w, one.writer), 'attempt');
});
