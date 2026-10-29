// Agent apps' grants (lib/mcp/grants.js): the mcp setting off unless it says on, an app's id from its program and its name,
// the apps in the worker's own IndexedDB (glaze-mcp, apps) with their grants and remembered declines, and the activity
// list that keeps metadata only.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const G = require('../lib/mcp/grants.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

const CLAUDE = { exe: '/Applications/Claude.app/Contents/MacOS/Claude', verified: true, ppid: 41 };
const CODE = { exe: '/usr/local/bin/code', verified: false };
// RFC 4648 base32, lowercase, from node's own sha256: the id is worked out here independently of grants.js.
const b32 = (buf) => { let bits = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); let out = ''; for (let i = 0; i + 5 <= bits.length; i += 5) out += 'abcdefghijklmnopqrstuvwxyz234567'[parseInt(bits.slice(i, i + 5), 2)]; return out; };
const expected = (exe, name) => b32(crypto.createHash('sha256').update(JSON.stringify([exe, name])).digest()).slice(0, 16);
const clock = (t = 1000) => { const now = () => t; now.tick = (ms = 1000) => { t += ms; }; return now; };
const area = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (o) => { Object.assign(data, structuredClone(o)); } };
};

test('the mcp setting is off unless it says on', () => {
  for (const raw of [undefined, null, {}, [], 'on', { on: 'true' }, { on: 1 }, { on: false }]) assert.deepEqual(G.clean(raw), { on: false }, JSON.stringify(raw));
  assert.deepEqual(G.clean({ on: true }), { on: true });
  assert.deepEqual(G.clean({ on: true, apps: ['x'], token: 'y' }), { on: true });
  assert.equal(G.KEY, 'mcp');
});

test("an app's id is stable: base32 of sha256 over [exe, client name], 16 characters", async () => {
  const id = await G.appId(CLAUDE, 'claude-ai');
  assert.equal(id, 'q2yhd4emtekyo2kc');
  assert.equal(id, expected(CLAUDE.exe, 'claude-ai'));
  assert.equal(await G.appId({ ...CLAUDE, ppid: 99, verified: false }, 'claude-ai'), id, 'only exe and the name count');
  assert.equal(await G.appId({}, ''), 'ioiih44jk25fd3hj');
  assert.equal(await G.appId(undefined, undefined), await G.appId({ exe: '' }, ''));
  assert.equal(await G.appId({ exe: 7 }, { name: 'x' }), await G.appId({}, ''), 'only strings count');
  assert.match(await G.appId(CODE, 'Visual Studio Code'), /^[a-z2-7]{16}$/);
});

test('the same program under another client name is another app, and so is another program under the same name', async () => {
  const a = await G.appId(CLAUDE, 'claude-ai'), b = await G.appId(CLAUDE, 'claude-code'), c = await G.appId(CODE, 'claude-ai');
  assert.equal(new Set([a, b, c]).size, 3);
  assert.notEqual(await G.appId({ exe: 'a' }, 'bc'), await G.appId({ exe: 'ab' }, 'c'), 'the parts never run together');
});

test('pairing stores the app in glaze-mcp/apps with the groups granted', async () => {
  const { indexedDB } = fakeIDB(), now = clock();
  const s = G.open(indexedDB, now);
  const rec = await s.pair(CLAUDE, 'claude-ai', ['courses', 'grades']);
  const id = await G.appId(CLAUDE, 'claude-ai');
  assert.deepEqual(rec, { id, name: 'claude-ai', exe: CLAUDE.exe, verified: true, at: 1000, used: 1000, grants: { courses: true, grades: true }, declined: {} });
  assert.deepEqual(await s.get(id), rec);
  assert.ok(indexedDB.dbs.get('glaze-mcp').has('apps'));
  assert.equal(await s.get('aaaaaaaaaaaaaaaa'), null);
  assert.ok(G.paired(rec));
  assert.ok(G.granted(rec, 'courses'));
  assert.ok(!G.granted(rec, 'writer'));
  assert.ok(!G.paired(null));
  now.tick();
  const again = await s.pair({ ...CLAUDE, verified: false }, 'claude-ai', ['writer']);
  assert.deepEqual([again.at, again.used, again.verified, again.grants], [1000, 2000, false, { writer: true }], 'a new pairing sets its groups and keeps when it was first paired');
  const code = await s.pair(CODE, 'Visual Studio Code', []);
  assert.deepEqual(code.grants, {});
  assert.ok(G.paired(code));
  assert.deepEqual((await s.list()).map((r) => r.name), ['claude-ai', 'Visual Studio Code']);
  assert.deepEqual((await G.open(indexedDB).get(id)).grants, { writer: true }, 'kept for the next worker');
  assert.equal(await s.pair(CLAUDE, 'claude-ai', ['files']), null, 'an unknown group pairs nothing');
  assert.equal(await s.pair(CLAUDE, 'claude-ai', 'courses'), null);
  assert.deepEqual((await s.get(id)).grants, { writer: true });
  const long = await s.pair({ exe: 'x'.repeat(5000) }, 'n'.repeat(500), []);
  assert.deepEqual([long.name.length, long.exe.length], [G.LIMIT.name, G.LIMIT.exe]);
});

test('grants turn on and off per group, for a known app and a known group only', async () => {
  const s = G.open(fakeIDB().indexedDB, clock());
  const { id } = await s.pair(CLAUDE, 'claude-ai', ['courses']);
  assert.deepEqual((await s.grant(id, 'assignments', true)).grants, { courses: true, assignments: true });
  assert.deepEqual((await s.grant(id, 'courses', false)).grants, { assignments: true });
  assert.deepEqual((await s.grant(id, 'mod:abcdefghijklmnop', true)).grants, { assignments: true, 'mod:abcdefghijklmnop': true });
  for (const g of ['files', 'mod:abc', 'pair', '', null]) assert.equal(await s.grant(id, g, true), null, String(g));
  assert.equal(await s.grant(id, 'grades', 'yes'), null);
  assert.equal(await s.grant('aaaaaaaaaaaaaaaa', 'grades', true), null, 'no app, nothing written');
  assert.equal(await s.get('aaaaaaaaaaaaaaaa'), null);
  assert.deepEqual((await s.get(id)).grants, { assignments: true, 'mod:abcdefghijklmnop': true });
});

test('declines are remembered, for a group and for pairing, until the student allows it', async () => {
  const { indexedDB } = fakeIDB(), now = clock();
  const s = G.open(indexedDB, now);
  const { id } = await s.pair(CLAUDE, 'claude-ai', ['courses']);
  now.tick();
  const d = await s.decline(id, 'grades');
  assert.deepEqual(d.declined, { grades: 2000 });
  assert.deepEqual(d.grants, { courses: true });
  assert.deepEqual((await G.open(indexedDB).get(id)).declined, { grades: 2000 }, 'remembered by the next worker');
  now.tick();
  assert.deepEqual((await s.decline(id, 'courses')).grants, {}, 'declining a group drops its grant');
  assert.deepEqual((await s.grant(id, 'grades', true)).declined, { courses: 3000 }, 'granting a group clears its decline');
  now.tick();
  const off = await s.decline(id, 'pair');
  assert.deepEqual([off.declined.pair, off.grants], [4000, {}], 'a declined app holds no grants');
  assert.ok(!G.paired(off));
  assert.ok(!G.granted({ ...off, grants: { grades: true } }, 'grades'), 'nothing is granted to an app that is not paired');
  const back = await s.pair(CLAUDE, 'claude-ai', ['writer']);
  assert.deepEqual(back.declined, { courses: 3000 }, 'pairing clears the declined pairing, and the declines of what it grants only');
  assert.ok(G.paired(back));
  assert.deepEqual((await s.pair(CLAUDE, 'claude-ai', ['courses'])).declined, {});
  for (const what of ['files', 'mod:abc', '', null, 'used']) assert.equal(await s.decline(id, what), null, String(what));
  assert.equal(await s.decline('aaaaaaaaaaaaaaaa', 'pair'), null);
});

test('touch marks when an app was last used', async () => {
  const now = clock(), s = G.open(fakeIDB().indexedDB, now);
  const { id } = await s.pair(CLAUDE, 'claude-ai', []);
  now.tick(5000);
  assert.deepEqual([(await s.touch(id)).used, (await s.get(id)).at], [6000, 1000]);
  assert.equal(await s.touch('aaaaaaaaaaaaaaaa'), null);
});

test('revoke forgets one app; forget forgets them all', async () => {
  const { indexedDB } = fakeIDB(), s = G.open(indexedDB, clock());
  const a = await s.pair(CLAUDE, 'claude-ai', ['courses']), b = await s.pair(CODE, 'Visual Studio Code', ['grades']);
  assert.equal(await s.revoke(a.id), true);
  assert.equal(await s.get(a.id), null);
  assert.deepEqual((await s.list()).map((r) => r.id), [b.id]);
  await s.pair(CLAUDE, 'claude-ai', []);
  assert.equal((await s.list()).length, 2);
  assert.equal(await s.forget(), true);
  assert.deepEqual(await s.list(), []);
  assert.deepEqual(await G.open(indexedDB).list(), []);
});

test('the activity list keeps the last 200 rows, its seven keys only, each in its own shape', async () => {
  const local = area();
  const row = { at: 1700000000000, app: 'q2yhd4emtekyo2kc', tool: 'todo_list', group: 'courses', kind: 'read', outcome: 'ok', ms: 42 };
  await G.record(local, { ...row, args: { course: 'Biology' }, result: 'Essay due Friday', error: 'Canvas said no', client: 'claude-ai' });
  assert.deepEqual(local.data.mcpCalls, [row]);
  for (const outcome of G.OUTCOMES) await G.record(local, { ...row, outcome });
  assert.deepEqual(G.OUTCOMES, ['ok', 'error', 'declined', 'timeout', 'interrupted', 'refused', 'busy']);
  assert.equal(local.data.mcpCalls.length, 8);
  for (const outcome of ['fine', 'Essay due Friday', undefined, null, 1]) await G.record(local, { ...row, outcome });
  assert.equal(local.data.mcpCalls.length, 8, 'a row without a known outcome is not kept');
  await G.record(local, { at: 'today', app: 'Claude Desktop', tool: 'Read my essay please', group: 'my essay', kind: 'run', outcome: 'error', ms: -1 });
  await G.record(local, { at: NaN, app: 'q2yhd4emtekyo2kcX', tool: 'x'.repeat(65), group: 'mod:abc', kind: { a: 1 }, outcome: 'error', ms: Infinity });
  assert.deepEqual(local.data.mcpCalls.slice(-2), [{ outcome: 'error' }, { outcome: 'error' }], 'a value outside its shape is dropped');
  await G.record(local, { ...row, group: 'mod:abcdefghijklmnop', tool: 'mod_abcdefghijklmnop_due', kind: 'confirm', ms: 0 });
  assert.deepEqual(local.data.mcpCalls.at(-1), { ...row, group: 'mod:abcdefghijklmnop', tool: 'mod_abcdefghijklmnop_due', kind: 'confirm', ms: 0 });
  await Promise.all(Array.from({ length: 250 }, (_, i) => G.record(local, { ...row, ms: i })));
  assert.equal(local.data.mcpCalls.length, 200);
  assert.deepEqual([local.data.mcpCalls[0].ms, local.data.mcpCalls.at(-1).ms], [50, 249], 'the newest 200, in the order recorded');
  local.data.mcpCalls = 'damaged';
  await G.record(local, row);
  assert.deepEqual(local.data.mcpCalls, [row]);
  await G.record({ get: async () => { throw new Error('quota'); }, set: async () => {} }, row);
  await G.record({ get: async () => ({}), set: async () => { throw new Error('quota'); } }, row);
  assert.equal(G.CALLS, 'mcpCalls');
});
