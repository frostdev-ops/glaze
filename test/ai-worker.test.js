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
  store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ai: { on: true, use: 'main', features: { syllabus: true } } }, session: {} } });
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

test('only Settings\' own top frame keeps connections, and the key never leaves the worker\'s own store', async () => {
  const w = make();
  const set = { type: 'glaze:ai-config', op: 'set', id: 'main', cfg: { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: KEY } };
  for (const sender of [lms(), editor({ frameId: 3 }), { ...editor(), url: `${EXT}/popup.html` }, { ...editor(), origin: 'https://evil.example.com' }]) {
    assert.deepEqual(await w.send(set, sender), { ok: false, error: 'sender' }, sender.url);
  }
  assert.deepEqual(await w.send(set, editor()), { ok: true, origin: 'https://api.example.com/*' });
  const got = await w.send({ type: 'glaze:ai-config', op: 'get' }, editor());
  assert.deepEqual(JSON.parse(JSON.stringify(got.connections.main)), { provider: 'openai', base: 'https://api.example.com/v1', model: 'gpt-x', key: 'sk-p••••6789', origin: 'https://api.example.com/*' });
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
    store: { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ai: { on: true, use: 'main', features: { syllabus: true, completion: true, writing: true } } }, session: {} } });
  return live2(w);
};
// The tab's page is w.page, read live; w.frames[frameId] = { href, ancestors } is what each LMS frame of the tab holds now
// (frame 0: the tab's page). Glaze's writer frame is never scripted itself.
const live2 = (w) => {
  w.frames = {};
  w.context.chrome.tabs.get = async (id) => ({ id, url: w.page });
  w.context.chrome.scripting.executeScript = async ({ target }) => {
    const id = target.frameIds?.[0] ?? (target.documentIds?.[0] === 'top-doc' ? 0 : Number(String(target.documentIds?.[0]).replace('doc-', '')));
    if (id === 3) throw new Error('an extension frame is never scripted');
    const f = id === 0 ? { href: w.page, ancestors: [] } : w.frames[id];
    return f ? [{ result: { href: f.href, origin: new URL(f.href).origin, ancestors: f.ancestors } }] : [];
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
  assert.deepEqual(await report(w, 'assignment', top(OTHER)), { ok: true });
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
