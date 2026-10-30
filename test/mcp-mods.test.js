// Mods' code tools for agent apps (C14): an agent app's call to a mod's code tool, routed by the worker (lib/mcp/modroute.js)
// to Glaze's content script in a tab of the account's school (features/mods.js, 'glaze:modtool'), handed to the mod's Worker
// as a 'tool.call' event and answered by its glaze.tools.handle (mods/host.js), and the answer back through the broker's
// 'tools.result' (lib/modbroker.js) to the one call waiting for it. First with stand-in tabs; then the real page side, mods
// host, glaze client and broker over real MessagePorts; then the real worker (lib/background.js) with C14's wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const R = require('../lib/mcp/modroute.js');
const B = require('../lib/modbroker.js');
const worker = require('./helpers/worker-env.cjs');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
// Values from the VMs carry their own realm's prototypes: compared as data.
const plain = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const SCHOOL = 'https://school.instructure.com', ACCOUNT = `${SCHOOL}/5`;
const MOD = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567';
const CTX = { account: ACCOUNT };
const TEXT = {
  chrome: "This mod's agent tools run only in Chrome.",
  open: "Open school.instructure.com, signed in as this account; this mod's tool runs there.",
  stopped: 'The mod stopped before it answered.',
  timeout: "The mod's tool didn't answer within 15 seconds.",
};
const fail = (error) => ({ ok: false, error });

// ---- the router, with stand-in tabs ---------------------------------------------------------------------------------------
// chrome.tabs as the router uses it: the tabs open (url only where Glaze holds the host), and each message to a tab's top
// frame, answered by `answer(tab, message)`.
const tabsOf = (list, answer = () => fail('mod')) => {
  const sent = [];
  return { sent, query: async () => structuredClone(list), sendMessage: async (id, m, o) => { sent.push([id, structuredClone(m), o]); return answer(id, m, o); } };
};
const TAB = (id, over = {}) => ({ id, url: `${SCHOOL}/courses/1`, active: false, lastAccessed: 0, ...over });
// The sender the worker sees for a message from Glaze's content script in a tab's top frame.
const from = (tab, over = {}) => ({ id: 'glaze', tab: { id: tab, url: `${SCHOOL}/courses/1` }, frameId: 0, url: `${SCHOOL}/courses/1`, origin: SCHOOL, documentId: 'doc-1', ...over });
const never = { setTimeout: () => 0, clearTimeout() {} };

test('outside Chrome a code tool is refused at once, and no tab is asked', async () => {
  for (const browser of ['firefox', 'safari', undefined]) {
    const tabs = tabsOf([TAB(1)], () => ({ ok: true }));
    assert.deepEqual(await R.create({ tabs, browser }).code(MOD, 'echo', {}, CTX), fail(TEXT.chrome), String(browser));
    assert.deepEqual(tabs.sent, []);
  }
});

test('with no tab of that school open where mods run, the app is told to open it', async () => {
  const quiet = (p) => /\/quizzes\//.test(p);
  const tabs = tabsOf([TAB(1, { url: 'https://other.instructure.com/courses/1' }), TAB(2, { discarded: true }), TAB(3, { url: 'http://school.instructure.com/courses/1' }),
    TAB(4, { url: `${SCHOOL}/courses/1/quizzes/2` }), { id: 5 }, TAB(-1), TAB(6, { url: 'not an address' }), TAB(1.5)]);
  assert.deepEqual(await R.create({ tabs, browser: 'chrome', quiet }).code(MOD, 'echo', {}, CTX), fail(TEXT.open));
  assert.deepEqual(tabs.sent, []);
  // Open, but not running the mod, signed in as someone else, or with no Glaze there to answer: the same.
  const none = tabsOf([TAB(1), TAB(2), TAB(3), TAB(4)], (id) => {
    if (id === 3) throw new Error('Could not establish connection. Receiving end does not exist.');
    return id === 4 ? undefined : fail(id === 1 ? 'mod' : 'account');
  });
  assert.deepEqual(await R.create({ tabs: none, browser: 'chrome' }).code(MOD, 'echo', {}, CTX), fail(TEXT.open));
  assert.deepEqual(none.sent.map(([id, m]) => [id, m.op]), [[1, 'call'], [2, 'call'], [3, 'call'], [4, 'call']]);
});

test('the school\'s tabs are asked in turn, the one shown first, then the latest used, asleep last; the first that runs the mod for that account takes the call', async () => {
  let route;
  const tabs = tabsOf([TAB(1, { lastAccessed: 10 }), TAB(2, { active: true }), TAB(3, { lastAccessed: 50 }), TAB(4, { lastAccessed: 90, frozen: true })], (id, m) => {
    if (m.op === 'call') return id === 1 ? { ok: true } : fail(id === 2 ? 'account' : 'mod');
    // The page waits for the mod's answer, which reaches the worker through the broker first.
    assert.equal(route.settle(from(1), MOD, m.call, { value: { said: 'hi' } }), true);
    return { ok: true };
  });
  route = R.create({ tabs, browser: 'chrome', id: () => 'call-1' });
  assert.deepEqual(await route.code(MOD, 'echo', { text: 'hi' }, CTX), { said: 'hi' });
  assert.deepEqual(tabs.sent.map(([id, m]) => [id, m.op]), [[2, 'call'], [3, 'call'], [1, 'call'], [1, 'wait']]);
  assert.deepEqual(tabs.sent[2], [1, { type: 'glaze:modtool', op: 'call', mod: MOD, call: 'call-1', name: 'echo', args: { text: 'hi' }, account: ACCOUNT }, { frameId: 0 }]);
  assert.deepEqual(tabs.sent[3], [1, { type: 'glaze:modtool', op: 'wait', call: 'call-1' }, { frameId: 0 }]);
  // Calls have ids of their own by default.
  const ids = new Set();
  const own = R.create({ tabs: tabsOf([TAB(1)], (t, m) => { ids.add(m.call); return m.op === 'call' ? { ok: true } : fail('stopped'); }), browser: 'chrome' });
  await Promise.all([own.code(MOD, 'echo', {}, CTX), own.code(MOD, 'echo', {}, CTX)]);
  assert.equal(ids.size, 2);
  for (const id of ids) assert.match(id, /^[\w-]{16,64}$/);
});

test('an answer is taken only for the call waiting for it: from that mod, that tab\'s top frame on that school\'s site, once', async () => {
  let route, id;
  const tabs = tabsOf([TAB(7)], (t, m) => {
    if (m.op === 'call') { id = m.call; return { ok: true }; }
    const no = [[from(7), OTHER, id, { value: 1 }], [from(8), MOD, id, { value: 1 }], [from(7, { frameId: 1 }), MOD, id, { value: 1 }],
      [from(7, { url: 'https://other.instructure.com/courses/1', origin: 'https://other.instructure.com' }), MOD, id, { value: 1 }],
      [from(7), MOD, 'nope', { value: 1 }], [from(7), MOD, id, null], [{}, MOD, id, { value: 1 }], [undefined, MOD, id, { value: 1 }], [from(7), MOD, undefined, { value: 1 }]];
    for (const a of no) assert.equal(route.settle(...a), false, JSON.stringify(a));
    assert.equal(route.settle(from(7), MOD, id, { value: [1, 2] }), true);
    assert.equal(route.settle(from(7), MOD, id, { value: 3 }), false, 'once');
    return { ok: true };
  });
  route = R.create({ tabs, browser: 'chrome' });
  assert.deepEqual(await route.code(MOD, 'echo', {}, CTX), [1, 2]);
  assert.equal(route.settle(from(7), MOD, id, { value: 3 }), false, 'nor after');
});

test('the mod\'s error is the call\'s failure, in its words after Glaze\'s; no value is null', async () => {
  const run = (out) => {
    let route;
    const tabs = tabsOf([TAB(7)], (t, m) => { if (m.op === 'wait') route.settle(from(7), MOD, m.call, out); return { ok: true }; });
    route = R.create({ tabs, browser: 'chrome' });
    return route.code(MOD, 'echo', {}, CTX);
  };
  assert.deepEqual(await run({ error: 'boom' }), fail("The mod's tool failed: boom"));
  assert.equal(await run({ value: null }), null);
  assert.equal(await run({}), null);
});

test('a call that ends on the page without an answer says how: the mod stopped or the page went, too slow, or its answer refused', async () => {
  const run = (wait) => R.create({ tabs: tabsOf([TAB(7)], (t, m) => (m.op === 'call' ? { ok: true } : wait())), browser: 'chrome' }).code(MOD, 'echo', {}, CTX);
  assert.deepEqual(await run(() => fail('stopped')), fail(TEXT.stopped));
  assert.deepEqual(await run(() => { throw new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'); }), fail(TEXT.stopped));
  assert.deepEqual(await run(() => ({ ok: true })), fail(TEXT.stopped), 'an answer that never reached the worker');
  assert.deepEqual(await run(() => undefined), fail(TEXT.stopped));
  assert.deepEqual(await run(() => fail('timeout')), fail(TEXT.timeout));
  assert.deepEqual(await run(() => fail('size')), fail("Glaze refused the mod's answer (size)."));
  assert.deepEqual(await run(() => fail('<b>odd</b>')), fail(TEXT.stopped), 'only a code of the broker\'s is named');
});

test('15 seconds from the call, it ends; an answer after that is not taken', async () => {
  const timers = [];
  const fake = { setTimeout: (f, ms) => timers.push({ f, ms }), clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].cleared = true; } };
  let id;
  const route = R.create({ tabs: tabsOf([TAB(7)], (t, m) => { if (m.op === 'call') { id = m.call; return { ok: true }; } return new Promise(() => {}); }), browser: 'chrome', timers: fake });
  const pending = route.code(MOD, 'slow', {}, CTX);
  await settle();
  assert.deepEqual(timers.map((t) => t.ms), [15000]);
  timers[0].f();
  assert.deepEqual(await pending, fail(TEXT.timeout));
  assert.equal(route.settle(from(7), MOD, id, { value: 1 }), false);
  // An answer in time clears it.
  const fast = R.create({ tabs: tabsOf([TAB(7)], (t, m) => { if (m.op === 'wait') fast.settle(from(7), MOD, m.call, { value: 2 }); return { ok: true }; }), browser: 'chrome', timers: fake });
  assert.equal(await fast.code(MOD, 'echo', {}, CTX), 2);
  assert.equal(timers[1].cleared, true);
});

test('arguments too large, too many calls waiting, a call cancelled before it went, or no account to route by: refused before any tab is asked', async () => {
  const tabs = tabsOf([TAB(7)], (t, m) => (m.op === 'call' ? { ok: true } : new Promise(() => {})));
  const route = R.create({ tabs, browser: 'chrome', timers: never });
  assert.deepEqual(await route.code(MOD, 'echo', { text: 'x'.repeat(R.LIMIT.args) }, CTX), fail("The arguments are too large for this mod's tool."));
  const ac = new AbortController();
  ac.abort();
  assert.deepEqual(await route.code(MOD, 'echo', {}, { ...CTX, signal: ac.signal }), { cancelled: true });
  for (const account of [undefined, null, 'school', `${SCHOOL}/x`, `${SCHOOL}/`, 5]) {
    assert.deepEqual(await route.code(MOD, 'echo', {}, { account }), fail("Glaze couldn't tell which school account this call is for."), String(account));
  }
  assert.deepEqual(tabs.sent, []);
  for (let i = 0; i < R.LIMIT.pending; i++) route.code(MOD, 'echo', {}, CTX);
  await settle();
  assert.deepEqual(await route.code(MOD, 'echo', {}, CTX), fail("Too many calls to this mod's tools are waiting; try again once they are answered."));
  assert.equal(tabs.sent.filter(([, m]) => m.op === 'call').length, R.LIMIT.pending, 'another mod\'s calls wait on their own');
  route.code(OTHER, 'echo', {}, CTX);
  await settle();
  assert.equal(tabs.sent.filter(([, m]) => m.op === 'call').length, R.LIMIT.pending + 1);
});

// ---- the chain: the page side, the mods host and the mod's Worker, real; the broker real -------------------------------------
// Every channel made here is closed at the end, so node can exit.
const channels = [];
class Channel extends MessageChannel { constructor() { super(); channels.push(this); } }
test.after(() => { for (const c of channels) { c.port1.close(); c.port2.close(); } });
const NONCE = 'u'.repeat(72);
const CLIENT = read('mods/host.js').match(/function glazeClient\(port\) \{[\s\S]*?\n {4}return glaze;\n {2}\}/)[0];

// mods/host.js in its frame: the sandbox page, with a Worker that runs the host's glaze client and the mod's code as a real
// one would (its own global scope, what it posts cloned).
const hostVM = () => {
  const listeners = new Set(), workers = [];
  const parent = { name: 'the school tab' };
  class Worker {
    constructor() {
      const heard = [];
      this.terminated = false;
      const self = { addEventListener: (t, f) => { if (t === 'message') heard.push(f); }, start() {},
        postMessage: (m) => { const data = structuredClone(m); if (!this.terminated) setImmediate(() => this.onmessage?.({ data })); } };
      this.scope = vm.createContext({ setTimeout, clearTimeout, performance, console });
      this.scope.globalThis = this.scope;
      vm.runInContext(`(${CLIENT})`, this.scope)(self);
      this.postMessage = (m) => { const data = structuredClone(m); if (!this.terminated) setImmediate(() => { for (const f of heard) f({ data }); }); };
      workers.push(this);
    }
    terminate() { this.terminated = true; }
  }
  const ctx = vm.createContext({ performance, location: { hash: `#${NONCE}`, href: `chrome-extension://glaze/mods/host.html#${NONCE}` }, parent, self: { origin: 'null' },
    Blob, Worker, MessageChannel: Channel, TextEncoder, setTimeout, ImageBitmap: class {},
    addEventListener: (t, f) => t === 'message' && listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) });
  ctx.URL = class extends URL { static createObjectURL() { return 'blob:null/1'; } };
  ctx.globalThis = ctx;
  vm.runInContext(read('mods/host.js'), ctx);
  return { workers, post: (data, ports) => { for (const f of [...listeners]) f({ source: parent, data, ports }); } };
};

// A school's tab: Glaze's content script with the mods runtime (features/mods.js) and its host, on a stand-in DOM and clock.
// toWorker(message) answers what the page sends the worker; deliver(message, sender) is a message to the page's top frame,
// as tabs.sendMessage gives it (a reply, or a rejection when nothing there answers or the page goes); leave() is the page going.
const school = ({ path = '/courses/1', origin = SCHOOL, uid = '5', toWorker }) => {
  let clock = 1000, left = false;
  const timers = new Set(), heard = [], sent = [], frames = [], open = new Set();
  const host = hostVM();
  const chrome = { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, onMessage: { addListener: (f) => heard.push(f) },
    sendMessage: async (m) => { sent.push(plain(m)); return plain(await toWorker(plain(m))); } },
  storage: { onChanged: { addListener: (f) => { chrome.changed = f; } } } };
  const el = (tag) => {
    const e = { tag, isConnected: false, listeners: {}, style: {}, setAttribute() {}, replaceChildren() {}, append(c) { c.isConnected = true; }, remove() { this.isConnected = false; },
      addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }, attachShadow() { return e; } };
    if (tag === 'iframe') { frames.push(e); e.contentWindow = { postMessage: (data, o, ports) => host.post(data, ports) }; }
    return e;
  };
  const document = { hidden: false, createElement: el, documentElement: { append: (m) => { m.isConnected = true; }, getAttribute: () => null }, getElementById: () => null,
    querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} };
  const ctx = vm.createContext({ chrome, document, location: { pathname: path, href: `${origin}${path}`, origin }, crypto: { randomUUID: () => 'u'.repeat(36) }, MessageChannel: Channel,
    CustomEvent: class { constructor(type) { this.type = type; } }, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1, addEventListener() {},
    performance: { now: () => clock }, setTimeout: (f, ms) => { const t = { at: clock + ms, f }; timers.add(t); return t; }, clearTimeout: (t) => timers.delete(t),
    GZ_CTX: { site: 'canvas', account: async () => uid, need: async () => {} } });
  ctx.globalThis = ctx;
  vm.runInContext(read('features/mods.js'), ctx);
  const deliver = (m, sender = { id: 'glaze' }) => new Promise((resolve, reject) => {
    if (left) return reject(new Error('Could not establish connection. Receiving end does not exist.'));
    let kept = false, done = false;
    const channel = { reject };
    const reply = (r) => { if (!done) { done = true; open.delete(channel); resolve(plain(r)); } };
    for (const f of heard) if (f(plain(m), sender, reply) === true) kept = true;
    if (kept && !done) open.add(channel);
    else if (!done) reject(new Error('Could not establish connection. Receiving end does not exist.'));
  });
  const tick = async (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.delete(due);
      clock = due.at;
      due.f();
      await settle();
    }
    clock = end;
    await settle();
  };
  // The mods the worker lists for this page, started, with the host loaded.
  const start = async () => {
    const r = await toWorker({ type: 'glaze:modpage', op: 'list' });
    ctx.GZ_MODS.start(plain(r.mods));
    for (const f of frames.at(-1)?.listeners.load || []) f();
    await settle();
  };
  const leave = () => {
    left = true;
    for (const c of open) c.reject(new Error('A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received'));
    open.clear();
  };
  return { G: ctx.GZ_MODS, ctx, chrome, sent, host, heard, deliver, start, tick, leave };
};

const b64 = (s) => Buffer.from(s).toString('base64');
// A storage area like the worker's brokerArea: get gives a copy, set and remove say whether they worked.
const area = (data = {}) => ({
  data,
  async get(k) { await new Promise(setImmediate); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await new Promise(setImmediate); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await new Promise(setImmediate); for (const x of [].concat(k)) delete data[x]; return true; },
});
const TOOL = (name) => ({ name, title: `The ${name} tool`, description: `Answers with ${name}.`, code: true });
// The mod's Worker: its handlers, and what it heard.
const HOOKS = `
var heardCalls = [];
glaze.on('tool.call', (d) => heardCalls.push(d.name));
glaze.tools.handle('echo', (args) => ({ said: args.text }));
glaze.tools.handle('nothing', () => undefined);
glaze.tools.handle('slow', () => new Promise(() => {}));
glaze.tools.handle('boom', async () => { throw new Error('boom'); });
glaze.tools.handle('odd', () => { const o = {}; o.o = o; return o; });
glaze.tools.handle('keep', async (args) => { await glaze.storage.set('kept', args.text); return { kept: await glaze.storage.get('kept') }; });
`;
const modRec = (over = {}) => ({
  id: MOD, enabled: true, hash: 'h', key: 'k', version: '1.0.0', dev: false, grants: { agents: true },
  manifest: { glaze: 1, name: 'Echo', version: '1.0.0', permissions: [{ id: 'agents', why: 'Answers agent apps you connect.' }], hooks: 'hooks.js',
    tools: ['echo', 'nothing', 'slow', 'boom', 'odd', 'keep', 'unhandled'].map(TOOL) },
  files: { 'hooks.js': b64(HOOKS) }, ...over,
});
// A frame-only mod that declares a code tool it has no Worker to answer.
const frameRec = () => ({ id: OTHER, enabled: true, hash: 'h2', key: 'k', version: '1.0.0', dev: false, grants: { agents: true },
  manifest: { glaze: 1, name: 'Frame', version: '1.0.0', permissions: [{ id: 'agents', why: 'Answers agent apps you connect.' }], ui: { tiles: [{ id: 'x', name: 'X', file: 'x.html' }] }, tools: [TOOL('echo')] },
  files: { 'x.html': b64('<p>x</p>') } });

// The worker's side for the chain: its broker on its own storage, which hands a code tool's answer to `route`.
const chain = async ({ page = {}, local = {}, timers = never } = {}) => {
  const l = area({ mods: [MOD, OTHER], [`mod:${MOD}`]: modRec(), [`mod:${OTHER}`]: frameRec(), ...local });
  let turn = Promise.resolve(), route;
  const sender = from(7);
  const env = { site: SCHOOL, local: l, sync: area({}), fetch: async () => { throw new Error('no network'); }, reach: async () => true, queue: (f) => (turn = turn.then(f, f)),
    keys: async () => Object.keys(l.data), record: async (id) => (await l.get(`mod:${id}`))[`mod:${id}`], blocklist: async () => null, account: async () => '5' };
  const toWorker = (m) => (m.type === 'glaze:mod' ? B.handle(m, { ...env, tool: (call, out) => route.settle(sender, m.mod, call, out) }) : B.page(m, env));
  const s = school({ ...page, toWorker });
  route = R.create({ tabs: { query: async () => [TAB(7, { active: true, url: `${SCHOOL}${page.path || '/courses/1'}` })], sendMessage: (id, m, o) => (id === 7 && o?.frameId === 0 ? s.deliver(m) : Promise.reject(new Error('no such frame'))) },
    browser: 'chrome', timers });
  await s.start();
  return { ...s, route, local: l, worker: () => s.host.workers[0] };
};

test('an agent app\'s call reaches the mod\'s Worker in the school\'s tab, and its answer comes back through the broker\'s checks', async () => {
  const c = await chain();
  assert.equal(c.host.workers.length, 1, 'the Workers\' host runs only the mod with a Worker');
  assert.deepEqual(plain(await c.route.code(MOD, 'echo', { text: 'hi' }, CTX)), { said: 'hi' });
  assert.equal(await c.route.code(MOD, 'nothing', {}, CTX), null);
  const results = c.sent.filter((m) => m.call === 'tools.result');
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], { type: 'glaze:mod', mod: MOD, via: 'worker', call: 'tools.result', args: [results[0].args[0], { said: 'hi' }] });
  assert.deepEqual(results[1].args.slice(1), [null]);
  // The mod's own listeners hear the call too, as with every event the client answers.
  assert.deepEqual(plain(c.worker().scope.heardCalls), ['echo', 'nothing']);
});

test('a handler that throws, answers with what JSON can\'t carry, or isn\'t there answers with an error the app reads', async () => {
  const c = await chain();
  assert.deepEqual(await c.route.code(MOD, 'boom', {}, CTX), fail("The mod's tool failed: boom"));
  assert.deepEqual(await c.route.code(MOD, 'odd', {}, CTX), fail("The mod's tool failed: The answer is not JSON."));
  assert.deepEqual(await c.route.code(MOD, 'unhandled', {}, CTX), fail("The mod's tool failed: No handler for unhandled."));
});

test('the page hands a call only to a running mod\'s Worker with that tool, on that school\'s page signed in as that account, from the worker', async () => {
  const c = await chain();
  const ask = (m = {}, sender) => c.deliver({ type: 'glaze:modtool', op: 'call', mod: MOD, call: `c-${Math.random()}`, name: 'slow', args: {}, account: ACCOUNT, ...m }, sender);
  assert.deepEqual(await ask({ account: `${SCHOOL}/6` }), fail('account'));
  assert.deepEqual(await ask({ account: 'https://other.instructure.com/5' }), fail('account'));
  assert.deepEqual(await ask({ account: 'nonsense' }), fail('account'));
  assert.deepEqual(await ask({ mod: OTHER, name: 'echo' }), fail('mod'), 'a frame-only mod has no Worker to answer');
  assert.deepEqual(await ask({ mod: 'zzzzzzzzzzzzzzzz' }), fail('mod'));
  assert.deepEqual(await ask({ name: 'nope' }), fail('mod'), 'only a code tool mod.json declares');
  for (const sender of [{ id: 'glaze', tab: { id: 3 } }, { id: 'other' }, {}]) await assert.rejects(ask({}, sender), /Receiving end/, JSON.stringify(sender));
  for (const bad of [{ op: 'run' }, { call: 5 }, { mod: 5 }, { name: null }, { account: 5 }, { call: 'x'.repeat(65) }]) await assert.rejects(ask(bad), /Receiving end/, JSON.stringify(bad));
  assert.deepEqual(await ask({ call: 'same' }), { ok: true });
  assert.deepEqual(await ask({ call: 'same' }), fail('busy'), 'one id, one call');
  const w = c.worker().scope;
  await settle();
  assert.equal(w.heardCalls.length, 1, 'the refused ones never reached the Worker');
  // A quiz page runs no mods.
  const q = await chain({ page: { path: '/courses/1/quizzes/2' } });
  assert.equal(q.host.workers.length, 0);
  assert.deepEqual(await q.deliver({ type: 'glaze:modtool', op: 'call', mod: MOD, call: 'q', name: 'echo', args: {}, account: ACCOUNT }), fail('mod'));
  assert.deepEqual(await q.route.code(MOD, 'echo', {}, CTX), fail(TEXT.open));
});

test('a mod stopped mid-call, turned off, or the page going ends the call at once', async () => {
  // Turned off by the student: the page stops it before the worker's list says so.
  const c = await chain();
  const off = c.route.code(MOD, 'slow', {}, CTX);
  await settle();
  c.chrome.changed({ [`mod:${MOD}`]: { oldValue: modRec(), newValue: modRec({ enabled: false }) } }, 'local');
  assert.deepEqual(await off, fail(TEXT.stopped));
  // Its Worker failed: the host stops it, and the page with it.
  const d = await chain();
  const thrown = d.route.code(MOD, 'slow', {}, CTX);
  await settle();
  d.worker().onerror();
  assert.deepEqual(await thrown, fail(TEXT.stopped));
  // Glaze turned off.
  const e = await chain();
  const glaze = e.route.code(MOD, 'slow', {}, CTX);
  await settle();
  e.chrome.changed({ enabled: { oldValue: true, newValue: false } }, 'sync');
  assert.deepEqual(await glaze, fail(TEXT.stopped));
  // The page went.
  const f = await chain();
  const gone = f.route.code(MOD, 'slow', {}, CTX);
  await settle();
  f.leave();
  assert.deepEqual(await gone, fail(TEXT.stopped));
});

test('the page gives a call 15 seconds, then says so; an answer the broker refuses ends the call at once, named', async () => {
  const c = await chain();
  const slow = c.route.code(MOD, 'slow', {}, CTX);
  await settle();
  await c.tick(14000);
  assert.equal(c.worker().terminated, false, 'the heartbeat keeps a mod that is only busy');
  await c.tick(1000);
  assert.deepEqual(await slow, fail(TEXT.timeout));
  // The mod lost agents meanwhile: the broker refuses its answer, and the call ends with that.
  c.local.data[`mod:${MOD}`] = modRec({ grants: { agents: false } });
  assert.deepEqual(await c.route.code(MOD, 'echo', { text: 'x' }, CTX), fail("Glaze refused the mod's answer (permission)."));
  c.local.data[`mod:${MOD}`] = modRec();
  assert.deepEqual(plain(await c.route.code(MOD, 'echo', { text: 'y' }, CTX)), { said: 'y' }, 'and the next goes through');
});

test('glaze.tools.handle takes only the code tools mod.json declares, a function each, and only in a Worker', async () => {
  const client = (globals = {}) => {
    const ch = new Channel();
    const ctx = vm.createContext({ setTimeout, clearTimeout, ...globals });
    ctx.globalThis = ctx;
    vm.runInContext(`(${CLIENT})`, ctx)(ch.port1);
    const out = [];
    ch.port2.onmessage = (e) => out.push(e.data);
    return { ctx, port: ch.port2, out };
  };
  const w = client();
  w.port.postMessage({ run: ["var made = glaze.tools.handle('echo', () => 1); var tries = ['nope', 'Echo'].map((n) => { try { glaze.tools.handle(n, () => 1); return 'taken'; } catch (e) { return e.message; } }); try { glaze.tools.handle('echo', 'x'); } catch (e) { tries.push(e.message); }"], tools: ['echo'] });
  await settle();
  assert.deepEqual(plain(w.out), [{ ran: true }]);
  assert.equal(w.ctx.made, undefined);
  assert.deepEqual(plain(w.ctx.tries), ['nope is not a code tool in mod.json', 'Echo is not a code tool in mod.json', 'tools.handle needs a function']);
  // A call it answers; one with no id is nobody's.
  w.port.postMessage({ event: 'tool.call', data: { id: 'c1', name: 'echo', args: {} } });
  w.port.postMessage({ event: 'tool.call', data: { name: 'echo', args: {} } });
  await settle();
  assert.deepEqual(plain(w.out.slice(1)), [{ id: 1, call: 'tools.result', args: ['c1', 1] }]);
  // With no tools declared, none is taken.
  const bare = client();
  bare.port.postMessage({ run: ["try { glaze.tools.handle('echo', () => 1); } catch (e) { var said = e.message; }"] });
  await settle();
  assert.equal(bare.ctx.said, 'echo is not a code tool in mod.json');
  // A frame UI's client has the same object, which refuses.
  const f = client({ document: {} });
  f.port.postMessage({ run: ["try { glaze.tools.handle('echo', () => 1); } catch (e) { var said = e.message; }"], tools: ['echo'] });
  await settle();
  assert.equal(f.ctx.said, 'glaze.tools is for Workers');
  f.port.postMessage({ event: 'tool.call', data: { id: 'c1', name: 'echo', args: {} } });
  await settle();
  assert.deepEqual(plain(f.out), [{ ran: true }], 'a frame never answers a call');
});

// ---- the real worker, with C14's wiring (test/helpers/modcode-wiring.cjs) -----------------------------------------------------
const wired = () => require('./helpers/modcode-wiring.cjs').wired(read('lib/background.js'));

// The real worker with a school's tab: its content script's messages go to the worker's own listeners as that tab's top
// frame, and the worker's tabs.sendMessage to that frame reaches the page.
const wiredWorker = async () => {
  const store = { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], mods: [MOD], [`mod:${MOD}`]: modRec(), modRuntime: { ok: true, at: 1 } }, session: {} };
  const w = worker({ store, background: wired(), globals: { indexedDB: fakeIDB().indexedDB } });
  const sender = from(7);
  const s = school({ toWorker: (m) => w.send(m, sender) });
  const sent = [];
  w.context.chrome.tabs.query = async () => [TAB(7, { active: true })];
  w.context.chrome.tabs.sendMessage = (id, m, o) => { sent.push([id, plain(m), plain(o)]); return id === 7 && o?.frameId === 0 ? s.deliver(m) : Promise.reject(new Error('no such frame')); };
  await s.start();
  const inWorker = (code) => vm.runInContext(code, w.context);
  // A tool as the registry lists it, run as lib/mcp/calls.js runs it (inside the broker's turn, for a change, with `turn`).
  const run = (name, args, { turn = false } = {}) => inWorker(`(async () => {
    if (typeof GZ_MCP_REGISTRY === 'undefined') mcpFiles();
    const t = GZ_MCP_REGISTRY.get(${JSON.stringify(name)}, await mcpRead());
    if (!t) return 'not listed';
    const go = () => t.run(${JSON.stringify(args)}, { account: ${JSON.stringify(ACCOUNT)} });
    return ${turn ? '(brokerTurn ||= GZ_CARDS.queue())(go)' : 'go()'};
  })()`);
  return { w, s, sent, run, inWorker, store };
};

test('the real worker, wired: the registry\'s code tool runs in the school\'s tab, and its answer comes back through the worker\'s own route for mods\' calls', async () => {
  const { s, sent, run, inWorker } = await wiredWorker();
  assert.equal(s.host.workers.length, 1);
  assert.deepEqual(plain(await run(`mod_${MOD}_echo`, { text: 'hi' })), { said: 'hi' });
  assert.deepEqual(sent.map(([id, m, o]) => [id, m.op, o]), [[7, 'call', { frameId: 0 }], [7, 'wait', { frameId: 0 }]]);
  assert.equal(inWorker('typeof GZ_MCP_MODROUTE'), 'object', 'loaded with the agent files');
  // The Worker's answer took the worker's own route (lib/background.js glaze:mod), as the tab's top frame.
  assert.ok(s.sent.some((m) => m.call === 'tools.result'));
  assert.deepEqual(await run(`mod_${MOD}_boom`, {}), fail("The mod's tool failed: boom"));
  // An answer from no agent call, or from a frame UI, is refused there.
  assert.deepEqual(plain(await s.ctx.chrome.runtime.sendMessage({ type: 'glaze:mod', mod: MOD, via: 'worker', call: 'tools.result', args: ['nope', 1] })), fail('call'));
  assert.deepEqual(plain(await s.ctx.chrome.runtime.sendMessage({ type: 'glaze:mod', mod: MOD, via: 'frame:tile:x', call: 'tools.result', args: ['nope', 1] })), fail('permission'));
});

test('the real worker, wired: with the school\'s tab closed, the app is told to open it', async () => {
  const { w, run } = await wiredWorker();
  w.context.chrome.tabs.query = async () => [];
  assert.deepEqual(await run(`mod_${MOD}_echo`, { text: 'hi' }), fail(TEXT.open));
});

test('a code tool whose handler writes the mod\'s storage answers when it runs as a change, in the broker\'s turn', {
  todo: 'lib/mcp/calls.js runs a confirm tool inside brokerTurn, where the handler\'s glaze.storage.set waits until the call times out',
}, async () => {
  const { run, inWorker } = await wiredWorker();
  inWorker('GZ_MCP_MODROUTE.LIMIT.timeout = 500');
  assert.deepEqual(plain(await run(`mod_${MOD}_keep`, { text: 'x' }, { turn: true })), { kept: 'x' });
});
