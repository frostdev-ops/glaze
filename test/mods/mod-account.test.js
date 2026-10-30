// Mods' reads of the student's plans and grades follow the account signed in on the page that asks, never another account
// that used the same school in this browser. The broker (lib/modbroker.js) with stand-in storage, and the worker
// (lib/background.js) end to end, which asks Glaze's own content script in the exact document for its account.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../lib/modbroker.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const SITE = 'https://school.instructure.com';
const ID = 'abcdefghijklmnop';
const A = '5', BEE = '6'; // A used this school here first; B is signed in now
const DAY = 864e5, SOON = Date.now() + DAY;
const flush = () => new Promise(setImmediate);
const settle = async () => { for (let i = 0; i < 30; i++) await flush(); };

const WIDGET = [{ type: 'text', text: '{next.title}' }, { type: 'list', items: 'grades.courses', max: 5 }];
const rec = () => ({
  id: ID, enabled: true, hash: 'h1', key: 'k1', version: '1.0.0', source: 'file', installedAt: 1, dev: false,
  manifest: { glaze: 1, name: 'Grades', hooks: 'hooks.js', permissions: [{ id: 'grades', why: 'w' }, { id: 'todo', why: 'w' }],
    ui: { tiles: [{ id: 'main', name: 'Main', sizes: ['m'], blocks: WIDGET }] } },
  grants: { grades: true, todo: true },
  files: { 'hooks.js': Buffer.from('glaze.grades()').toString('base64') },
});
const plan = (uid, title) => ({ key: `todo:${SITE}/${uid}`, at: 1, items: [{ id: `t${uid}`, type: 'assignment', cid: '42', course: 'Chem', title, at: SOON, url: '/courses/42/assignments/1' }] });
// A's records are the newer ones, and the planner cache is A's.
const cached = () => ({
  [`insights:${SITE}/${A}`]: { at: 20, courses: [{ id: '1', name: 'A secret course', trend: [[1, 55]] }] },
  [`insights:${SITE}/${BEE}`]: { at: 10, courses: [{ id: '2', name: 'B course', trend: [[1, 90]] }] },
  todoCache: plan(A, 'A secret task'),
});
const leaks = (x) => /A secret/.test(JSON.stringify(x));

// ---- the broker ------------------------------------------------------------------------------------------------------------
const area = (data = {}) => ({
  data,
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await flush(); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await flush(); for (const x of [].concat(k)) delete data[x]; return true; },
});
const env = (account, local = {}) => {
  const l = area({ [`mod:${ID}`]: rec(), mods: [ID], ...cached(), ...local });
  let turn = Promise.resolve();
  return {
    site: SITE, local: l, sync: area(), reach: async () => true, fetch: async () => { throw new Error('no fetch'); },
    queue: (f) => (turn = turn.then(f, f)), keys: async () => Object.keys(l.data),
    record: async (id) => (await l.get(`mod:${id}`))[`mod:${id}`], blocklist: async () => null, account,
  };
};
const call = async (e, name, args = [], extra = {}) => {
  const r = await B.handle({ mod: ID, call: name, args, via: 'worker', ...extra }, e);
  assert.equal(r.ok, true, `${name}: ${r.error}`);
  return r.value;
};
const range = [SOON - DAY, SOON + DAY];

test('the broker answers with the signed-in account\'s grades and plan only, never the newest account\'s', async () => {
  const e = env(async () => BEE);
  assert.deepEqual(await call(e, 'grades'), [{ courseId: '2', name: 'B course', percent: 90, at: 1 }]);
  assert.deepEqual(await call(e, 'grades', ['1']), [], 'A\'s course by its id');
  assert.deepEqual(await call(e, 'todo'), [], 'the planner cache is A\'s');
  assert.deepEqual(await call(e, 'schedule', range), []);
  e.local.data.todoCache = plan(BEE, 'B task');
  assert.deepEqual((await call(e, 'todo')).map((i) => i.title), ['B task']);
  assert.deepEqual((await call(e, 'schedule', range)).map((i) => i.title), ['B task']);
});

test('while the account is unknown the broker answers with nothing', async () => {
  for (const [why, account] of [['none', async () => null], ['signed out', async () => { throw new Error('401'); }], ['not a user id', async () => '../5'],
    ['an object', async () => ({ toString: () => A })], ['no reader', undefined]]) {
    const e = env(account, { todoCache: plan(A, 'A secret task') });
    for (const [name, args] of [['grades', []], ['todo', []], ['schedule', range]]) {
      const v = await call(e, name, args);
      assert.deepEqual(v, [], `${why}: ${name}`);
    }
  }
});

test('an account named by the mod is not the page\'s: the call\'s own fields and arguments are ignored', async () => {
  const e = env(async () => BEE);
  for (const extra of [{ account: A }, { uid: A }, { user: A }, { key: `insights:${SITE}/${A}` }]) {
    assert.deepEqual((await call(e, 'grades', [], extra)).map((g) => g.name), ['B course'], JSON.stringify(extra));
    assert.deepEqual(await call(e, 'todo', [], extra), [], JSON.stringify(extra));
  }
  assert.equal((await B.handle({ mod: ID, call: 'grades', args: [A], via: 'worker' }, e)).value.length, 0);
});

test('a declarative widget reads the signed-in account\'s data only, and nothing while it is unknown', async () => {
  const ask = (e) => B.page({ op: 'widget', mod: ID, slot: 'tile:main', lang: 'en', account: A }, e);
  const b = await ask(env(async () => BEE));
  assert.equal(b.ok, true);
  assert.equal(leaks(b), false, 'A\'s course and task stay out');
  assert.match(JSON.stringify(b.tree), /B course/);
  const bothB = await ask(env(async () => BEE, { todoCache: plan(BEE, 'B task') }));
  assert.match(JSON.stringify(bothB.tree), /B task/);
  for (const account of [async () => null, async () => { throw new Error('signed out'); }, undefined]) {
    const r = await ask(env(account));
    assert.equal(r.ok, true);
    assert.equal(leaks(r), false);
    assert.doesNotMatch(JSON.stringify(r.tree), /B course/);
  }
});

// ---- the worker, end to end ---------------------------------------------------------------------------------------------
// lib/background.js in a VM. Each document is { origin, doc (content.js's __gzDoc), account (GZ_CTX.account) }; the
// worker's script runs there through chrome.scripting.executeScript, by documentId where the sender has one.
const worker = ({ eventPage = false, scheme = 'chrome-extension' } = {}) => {
  const store = { sync: { version: 2, enabled: true, enhance: {} }, local: { mods: [ID], [`mod:${ID}`]: rec(), ...cached() }, session: {} };
  const listeners = [], probes = [], docs = new Map();
  // Values as the worker's own realm makes them (lib/modapi.js checks for plain objects of its realm).
  const area = (s) => ({
    get: async (k) => vm.runInContext('JSON', context).parse(JSON.stringify(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, Intl, setTimeout, clearTimeout, crypto: globalThis.crypto,
    AbortController, AbortSignal, DOMException, atob, btoa,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `${scheme}://x/${f}`, getManifest: () => require('../manifest.json'),
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      tabs: { onRemoved: { addListener() {} } },
      permissions: { contains: async () => true },
      storage: { session: area(store.session), local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
      scripting: {
        getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {},
        executeScript: async (o) => {
          probes.push(JSON.parse(JSON.stringify(o.target)));
          const d = docs.get(o.target.documentIds?.[0] || `${o.target.tabId}:${o.target.frameIds?.[0]}`);
          if (!d) throw Error('document gone');
          const page = vm.createContext({ location: { origin: d.origin }, __gzDoc: d.doc,
            ...(d.ctx !== false && { GZ_CTX: { site: 'canvas', on: () => d.on !== false, account: d.account } }) });
          page.globalThis = page;
          d.world = page;
          return [{ result: await vm.runInContext(`(${o.func})(...${JSON.stringify(o.args || [])})`, page) }];
        },
      },
    },
  });
  if (eventPage) {
    // The Firefox package preloads these in order and replaces importScripts with a no-op.
    const files = [...read('lib/background.js').matchAll(/importScripts\(([^)]*)\)/g)]
      .flatMap(([, args]) => [...args.matchAll(/'([^']+)'/g)].map(([, f]) => f));
    for (const f of new Set(files)) context.importScripts(f);
    context.importScripts = () => {};
  }
  vm.runInContext(read('lib/background.js'), context);
  // doc: the document behind the frame now (by documentId, else by tab and frame).
  const send = (msg, sender, doc) => new Promise((res) => {
    if (doc) docs.set(sender.documentId || `${sender.tab.id}:${sender.frameId}`, doc);
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  return { store, send, probes, docs };
};
const URL1 = `${SITE}/courses/1`;
const sender = (over = {}) => ({ id: 'glaze', url: URL1, frameId: 0, tab: { id: 1, url: URL1 }, documentId: 'doc-b', ...over });
const pageOf = (account, over = {}) => ({ origin: SITE, doc: 'gz-b', account: typeof account === 'function' ? account : async () => account, ...over });
const modCall = (name, args = [], over = {}) => ({ type: 'glaze:mod', mod: ID, via: 'worker', call: name, args, doc: 'gz-b', ...over });

test('the worker reads the account from Glaze\'s content script in the document that asked, and the mod gets that account\'s data', async () => {
  const w = worker();
  const r = await w.send(modCall('grades'), sender(), pageOf(BEE));
  assert.deepEqual(r, { ok: true, value: [{ courseId: '2', name: 'B course', percent: 90, at: 1 }] });
  assert.deepEqual(w.probes, [{ tabId: 1, documentIds: ['doc-b'] }], 'that document, by its id');
  assert.deepEqual(await w.send(modCall('todo'), sender(), pageOf(BEE)), { ok: true, value: [] }, 'A\'s planner cache');
  assert.deepEqual(await w.send(modCall('schedule', range), sender(), pageOf(BEE)), { ok: true, value: [] });
  w.store.local.todoCache = plan(BEE, 'B task');
  assert.deepEqual((await w.send(modCall('todo'), sender(), pageOf(BEE))).value.map((i) => i.title), ['B task']);
  // A call that needs no account asks nothing of the page.
  w.probes.length = 0;
  assert.equal((await w.send(modCall('theme'), sender(), pageOf(BEE))).ok, true);
  assert.deepEqual(w.probes, []);
});

test('the worker refuses an account the message names: only the page\'s own counts', async () => {
  const w = worker();
  for (const forged of [{ account: A }, { uid: A }, { user: A }]) {
    const r = await w.send(modCall('grades', [], forged), sender(), pageOf(BEE));
    assert.deepEqual(r.value.map((g) => g.name), ['B course'], JSON.stringify(forged));
    const page = await w.send({ type: 'glaze:modpage', op: 'widget', mod: ID, slot: 'tile:main', doc: 'gz-b', ...forged }, sender(), pageOf(BEE));
    assert.equal(leaks(page), false, JSON.stringify(forged));
  }
});

test('the worker gives no account data while the page\'s account is unknown, slow, or the document changed', async () => {
  const w = worker();
  const cases = [
    ['signed out', sender(), pageOf(async () => { throw new Error('401'); })],
    ['no user', sender(), pageOf(null)],
    ['Glaze not started there', sender(), pageOf(BEE, { ctx: false })],
    ['another origin answering', sender(), pageOf(BEE, { origin: 'https://other.instructure.com' })],
    ['the document is gone', sender({ documentId: 'doc-old' }), null],
    ['no documentId, another document in the frame', sender({ documentId: undefined }), pageOf(A, { doc: 'gz-a' })],
    ['slow', sender(), pageOf(() => new Promise(() => {}))],
  ];
  for (const [why, s, doc] of cases) {
    for (const [name, args] of [['grades', []], ['todo', []], ['schedule', range]]) {
      const r = await w.send(modCall(name, args), s, doc);
      assert.equal(r.ok, true, `${why}: ${name}`);
      assert.deepEqual(r.value, [], `${why}: ${name}`);
    }
    const widget = await w.send({ type: 'glaze:modpage', op: 'widget', mod: ID, slot: 'tile:main', doc: 'gz-b' }, s, doc);
    assert.equal(leaks(widget), false, `${why}: widget`);
    assert.doesNotMatch(JSON.stringify(widget), /B course/, `${why}: widget`);
  }
  // Without a documentId the call must name its document; with nothing to compare, nothing is read.
  const none = await w.send(modCall('grades', [], { doc: undefined }), sender({ documentId: undefined }), pageOf(BEE));
  assert.deepEqual(none, { ok: true, value: [] });
  // The same document, found by its id where the browser gives no documentId.
  w.probes.length = 0;
  const same = await w.send(modCall('grades'), sender({ documentId: undefined }), pageOf(BEE));
  assert.deepEqual(same.value.map((g) => g.name), ['B course']);
  assert.deepEqual(w.probes, [{ tabId: 1, frameIds: [0] }]);
});

test('a declarative widget through the worker shows the signed-in account\'s data', async () => {
  const w = worker();
  w.store.local.todoCache = plan(BEE, 'B task');
  const r = await w.send({ type: 'glaze:modpage', op: 'widget', mod: ID, slot: 'tile:main', lang: 'en', doc: 'gz-b' }, sender(), pageOf(BEE));
  assert.equal(r.ok, true);
  assert.match(JSON.stringify(r.tree), /B task/);
  assert.match(JSON.stringify(r.tree), /B course/);
  assert.equal(leaks(r), false);
});

test('simultaneous account reads share only an in-flight probe for the same document', async () => {
  const w = worker();
  let resolve;
  const pending = new Promise((r) => { resolve = r; });
  const doc = pageOf(() => pending);
  const calls = Array.from({ length: 20 }, () => w.send({ type: 'glaze:modpage', op: 'widget', mod: ID, slot: 'tile:main', doc: 'gz-b' }, sender(), doc));
  await settle();
  const probes = w.probes.length;
  resolve(BEE);
  const answers = await Promise.all(calls);
  assert.equal(probes, 1, 'twenty widgets share one pending script injection');
  for (const r of answers) assert.match(JSON.stringify(r.tree), /B course/);
  // No settled identity survives to the next request or another tab/document.
  assert.match(JSON.stringify(await w.send(modCall('grades'), sender(), pageOf(A))), /A secret course/);
  assert.equal(w.probes.length, 2);
  assert.match(JSON.stringify(await w.send(modCall('grades'), sender({ tab: { id: 2, url: URL1 } }), pageOf(BEE))), /B course/);
  assert.equal(w.probes.length, 3);
});

test('an inactive content script cannot lend an account, including while its identity resolves', async () => {
  for (const documentId of ['doc-b', undefined]) {
    const w = worker(), doc = pageOf(BEE, { on: false });
    assert.deepEqual((await w.send(modCall('grades'), sender({ documentId }), doc)).value, [], 'already stopped');
    let resolve;
    doc.on = true;
    doc.account = () => new Promise((r) => { resolve = r; });
    const reply = w.send(modCall('grades'), sender({ documentId }), doc);
    await settle();
    doc.on = false;
    resolve(BEE);
    assert.deepEqual((await reply).value, [], 'stopped during the identity read');
  }
});

test('a widget marks an unresolved account for a redraw, but only for granted account data', async () => {
  const r = await B.page({ op: 'widget', mod: ID, slot: 'tile:main' }, env(async () => null));
  assert.equal(r.accountPending, true);
  const known = await B.page({ op: 'widget', mod: ID, slot: 'tile:main' }, env(async () => BEE));
  assert.notEqual(known.accountPending, true);
  const denied = env(() => { throw new Error('must not ask'); });
  denied.local.data[`mod:${ID}`].grants = {};
  assert.notEqual((await B.page({ op: 'widget', mod: ID, slot: 'tile:main' }, denied)).accountPending, true);
});

test('event pages and older frame-only senders use the same document-bound account reader', async () => {
  for (const scheme of ['moz-extension', 'safari-web-extension']) for (const documentId of ['doc-b', undefined]) {
    const w = worker({ eventPage: true, scheme });
    const r = await w.send(modCall('grades'), sender({ documentId }), pageOf(BEE));
    assert.deepEqual(r.value.map((g) => g.name), ['B course']);
    assert.deepEqual(w.probes, [documentId ? { tabId: 1, documentIds: [documentId] } : { tabId: 1, frameIds: [0] }]);
  }
});

test('document changes during an identity read and child-frame callers reveal no account data', async () => {
  for (const documentId of ['doc-b', undefined]) {
    const w = worker();
    let resolve;
    const d = pageOf(() => new Promise((r) => { resolve = r; }));
    const reply = w.send(modCall('grades'), sender({ documentId }), d);
    await settle();
    d.world.__gzDoc = 'gz-new';
    resolve(BEE);
    assert.deepEqual((await reply).value, []);
  }
  const w = worker();
  for (const url of [URL1, 'https://other.instructure.com/courses/1']) {
    const r = await w.send(modCall('grades'), sender({ frameId: 1, url }), pageOf(BEE));
    assert.deepEqual(r, { ok: false, error: 'sender' });
  }
  assert.deepEqual(w.probes, []);
});
