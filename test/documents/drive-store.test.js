// Sync to Google Drive beyond Documents (extension/background/drive-store.js, run by extension/documents/drive-sync.js) against a
// stand-in Drive that keeps state across requests (test/helpers/drive-standin.cjs): every category Back up… covers, two
// devices with interleaved edits per category, a fresh device restored from the folder without losing its own, deletes on
// both sides as tombstones (no file ever deleted), a token that expires and an account switch, Drive's rate limit and a full
// Drive, what never syncs, and the daily snapshot with the newest five kept.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const D = require('../../extension/documents/drive.js');
const P = require('../../extension/writer/writer-papers.js');
const S = require('../../extension/documents/drive-sync.js');
const ST = require('../../extension/background/drive-store.js');
const { standin } = require('../helpers/drive-standin.cjs');
const { ERRORS } = require('../fixtures/drive/v3.js');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// A storage area in memory that tells its listeners what changed, as chrome.storage.onChanged does.
const area = (name, heard) => {
  const m = new Map();
  // Delivered after the write returns, as the browser's onChanged is.
  const tell = async (changes) => { if (Object.keys(changes).length) setTimeout(async () => { for (const f of heard) await f(changes, name); }, 0); };
  const api = {
    m,
    get: async (k) => { const ks = k == null ? [...m.keys()] : Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])); },
    set: async (o) => { const c = {}; for (const [k, v] of Object.entries(o)) { c[k] = { oldValue: m.get(k), newValue: structuredClone(v) }; m.set(k, structuredClone(v)); } await tell(c); },
    remove: async (k) => { const c = {}; for (const x of [].concat(k)) if (m.has(x)) { c[x] = { oldValue: m.get(x) }; m.delete(x); } await tell(c); },
    keys: async () => [...m.keys()],
  };
  api.replace = async (key, expected, value) => {
    if (ST.canon(m.get(key)) !== ST.canon(expected)) return false;
    if (value === undefined) await api.remove(key); else await api.set({ [key]: value });
    return true;
  };
  return api;
};
const device = (drive, { account = 'student@school.edu', clock = { t: Date.parse('2026-10-30T12:00:00Z') }, snapshots = false } = {}) => {
  const heard = [], local = area('local', heard), sync = area('sync', heard), now = () => clock.t, who = { account };
  const papers = P.open(local, now, { versions: () => 40, files: { own: async () => ({ missing: [] }) } });
  let dropped = 0;
  const log = { sleep: [], drop: [] };
  let snaps = 0;
  const store = ST.create({
    area: (n) => (n === 'sync' ? sync : local), store: local, hash: async (s) => sha(s), now,
    snapshot: snapshots ? async () => ({ name: `glaze-backup-2026-10-${String(30 + snaps).padStart(2, '0')}-${++snaps}.zip`, bytes: new TextEncoder().encode(`PK snapshot ${snaps}`) }) : null,
  });
  heard.push((c, a) => (who.on ? store.stamp(c, a) : null));
  const sync2 = S.create({
    drive: () => D.create({ fetch: drive.fetch, token: async () => ['tok-1', 'tok-2', 'tok-3'][Math.min(dropped, 2)], drop: async (t) => { log.drop.push(t); dropped++; }, account: async () => who.account, interactive: false }),
    account: async () => who.account, store: local,
    papers: { get: papers.get, list: papers.list, save: papers.save, trash: papers.trash, untrash: papers.untrash, keep: papers.keep },
    parts: async () => ({}), files: { has: async () => false, put: async () => { throw new Error('no files here'); } },
    exportOf: async (key, rec) => ({ name: `${rec.title || 'Untitled'}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: new TextEncoder().encode(JSON.stringify(rec.doc)) }),
    pack: async () => '', hash: async (s) => sha(s), copyName: (t) => `${t} (Drive copy)`, now, sleep: async (ms) => { log.sleep.push(ms); }, random: () => 0, locks: null,
    timer: () => () => {}, more: store,
  });
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const on = async () => { who.on = true; await settle(); const r = await sync2.set(true); await settle(); return r; };
  // The test's own writes, each heard (stamped) before the clock moves on.
  const heardAfter = (x) => ({ ...x, set: async (o) => { await x.set(o); await settle(); }, remove: async (k) => { await x.remove(k); await settle(); } });
  return { local: heardAfter(local), settings: heardAfter(sync), papers, sync: sync2, store, who, log, clock, on, run: async (o) => { await settle(); const r = await sync2.run(o); await settle(); return r; } };
};
const TODO = 'todo:https://school.instructure.com/42', NOTE = 'notes:https://school.instructure.com/42', CLASSES = 'classes:https://school.instructure.com/42';
const T = require('../../extension/planner/todo.js');
const C = require('../../extension/planner/classes.js');
const D0 = require('../../extension/content/defaults.js').GZ_SANITIZE({});
const accent = (c) => ({ ...D0.colors, '--gz-accent': c });
const lookOf = (density) => ({ ...D0.look, density });
const todo = (...titles) => T.clean({ tasks: titles.map((t, i) => ({ id: `t${t}`, title: t, done: false, at: 1000 + i })), items: {} });
const recFile = (drive, area, key) => [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'rec' && f.meta.appProperties.key === sha(`${area}\n${key}`).slice(0, 32));
const body = (f) => JSON.parse(f.bytes.toString('utf8'));
const noDeletes = (drive) => assert.equal(drive.log.filter((x) => x.method === 'DELETE').length, 0, 'nothing deleted for good');

test('a local change syncs when its timestamp equals or precedes the last agreed stamp', async () => {
  const drive = standin(), a = device(drive);
  await a.local.set({ writerWords: ['First'] });
  assert.ok((await a.on()).ok);
  // Storage events can share a millisecond; a clock can also move backwards after a remote value was taken.
  for (const [dt, word] of [[0, 'Same millisecond'], [-60000, 'Clock moved back']]) {
    a.clock.t += dt;
    await a.local.set({ writerWords: [word] });
    assert.ok((await a.run({ push: true })).ok);
    assert.deepEqual(body(recFile(drive, 'local', 'writerWords')).value, [word]);
  }
});

test('a failed record download stops the run without consuming its change', async () => {
  const drive = standin(), a = device(drive), b = device(drive);
  await a.local.set({ writerWords: ['Original'] });
  await a.on(); await b.on();
  a.clock.t += 1000;
  await a.local.set({ writerWords: ['Remote update'] });
  assert.ok((await a.run({ push: true })).ok);
  const token = (await b.local.get(S.STATE))[S.STATE].token;
  drive.offline((x) => x.query.alt === 'media');
  assert.deepEqual(await b.run(), { ok: false, why: 'network' });
  const st = (await b.local.get(S.STATE))[S.STATE];
  assert.equal(st.token, token);
  b.clock.t = st.wait + 1;
  assert.ok((await b.run()).ok);
  assert.deepEqual((await b.local.get('writerWords')).writerWords, ['Remote update']);
});

test('a local edit arriving during a record download survives and syncs on retry', async () => {
  const drive = standin(), a = device(drive), b = device(drive);
  await a.local.set({ [NOTE]: { text: 'Original', at: 1 } });
  await a.on(); await b.on();
  a.clock.t += 1000;
  await a.local.set({ [NOTE]: { text: 'Remote edit', at: 2 } });
  assert.ok((await a.run({ push: true })).ok);
  const fetch = drive.fetch;
  let edited = false;
  drive.fetch = async (url, init) => {
    const r = await fetch(url, init);
    if (!edited && new URL(url).searchParams.get('alt') === 'media') {
      edited = true; b.clock.t += 2000;
      await b.local.set({ [NOTE]: { text: 'New local edit', at: 3 } });
    }
    return r;
  };
  const r = await b.run();
  assert.equal((await b.local.get(NOTE))[NOTE].text, 'New local edit');
  if (!r.ok) b.clock.t = (await b.local.get(S.STATE))[S.STATE].wait + 1;
  assert.ok((await b.run()).ok);
  assert.equal(body(recFile(drive, 'local', NOTE)).value.text, 'New local edit');
});

test('every category Back up… covers goes up, one file a record, in Glaze/Data; what never syncs stays here', async () => {
  const drive = standin(), a = device(drive);
  const keys = {
    [TODO]: todo('Read ch. 4'), 'pet:https://school.instructure.com/42': { hist: [] }, [NOTE]: { text: 'Bring the lab book', at: 5 },
    [CLASSES]: C.clean({ courses: [{ id: '100', name: 'Art', at: 5, periods: [{ days: [3], start: 60, end: 120 }] }] }), 'gpaTerms:https://school.instructure.com:42': { t: [] }, widgetLayout: { tiles: [] }, lookFavorites: [{ code: 'abc', name: 'Dusk' }],
    lookHistory: [{ theme: { colors: {} }, at: 3 }], writerWords: ['Glaze'], 'writer:sources:school|_1_1|_2_1|_3_1': { sources: [{ id: 's1' }], at: 4 },
    // never
    ai: { keys: 'secret' }, aiConnections: { x: 1 }, agentLink: { pair: 'p' }, gradescope: { a: 1 }, canvas: { cache: 1 }, google: { email: 'x' },
  };
  await a.local.set(keys);
  await a.settings.set({ colors: accent('#ff0000'), look: lookOf('compact') });
  assert.ok((await a.on()).ok);
  const folder = [...drive.files.values()].find((f) => f.meta.name === 'Glaze' && f.meta.mimeType === drive.FOLDER);
  const data = [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'data');
  assert.ok(data && data.meta.name === 'Data' && data.meta.parents[0] === folder.meta.id, 'a Data folder inside Glaze');
  for (const k of [TODO, NOTE, CLASSES, 'widgetLayout', 'lookFavorites', 'lookHistory', 'writerWords', 'writer:sources:school|_1_1|_2_1|_3_1', 'pet:https://school.instructure.com/42', 'gpaTerms:https://school.instructure.com:42']) {
    const f = recFile(drive, 'local', k);
    assert.ok(f && f.meta.parents[0] === data.meta.id, `${k} has its file`);
    assert.deepEqual(body(f).value, keys[k], `${k} as stored`);
  }
  assert.deepEqual(body(recFile(drive, 'sync', 'colors')).value, accent('#ff0000'), 'a Settings key');
  for (const k of ['ai', 'aiConnections', 'agentLink', 'gradescope', 'canvas', 'google', 'driveSync']) assert.equal(recFile(drive, 'local', k), undefined, `${k} never leaves`);
  noDeletes(drive);
});

test('two devices, interleaved edits in each category: each side\'s change reaches the other; the later of two wins', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  await a.local.set({ [TODO]: todo('One'), [NOTE]: { text: 'A note', at: 1 } });
  await a.settings.set({ colors: accent('#111111') });
  await a.on(); await b.on();
  assert.deepEqual((await b.local.get(TODO))[TODO], todo('One'), 'B has A\'s tasks');
  assert.deepEqual((await b.settings.get('colors')).colors, accent('#111111'), 'and its Settings');
  // Interleaved: A edits tasks, B edits Settings and the note.
  clock.t += 1000; await a.local.set({ [TODO]: todo('One', 'Two') });
  clock.t += 1000; await b.settings.set({ colors: accent('#222222') });
  clock.t += 1000; await b.local.set({ [NOTE]: { text: 'B\'s note', at: 9 } });
  assert.ok((await a.run()).ok); assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  assert.deepEqual((await b.local.get(TODO))[TODO], todo('One', 'Two'));
  assert.deepEqual((await a.settings.get('colors')).colors, accent('#222222'));
  assert.equal((await a.local.get(NOTE))[NOTE].text, 'B\'s note');
  // Both change one Settings key: the later change wins on both.
  clock.t += 1000; await a.settings.set({ look: lookOf('compact') });
  clock.t += 1000; await b.settings.set({ look: lookOf('roomy') });
  assert.ok((await a.run()).ok); assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  assert.equal((await a.settings.get('look')).look.density, 'roomy');
  assert.equal((await b.settings.get('look')).look.density, 'roomy');
  // Linked on both now: each changes it again, B later, and B's wins on both.
  clock.t += 1000; await a.settings.set({ look: lookOf('compact') });
  assert.ok((await a.run()).ok);
  clock.t += 1000; await b.settings.set({ look: lookOf('cozy') });
  clock.t += 1000; await a.settings.set({ look: lookOf('roomy') });
  assert.ok((await b.run()).ok);
  assert.equal((await b.settings.get('look')).look.density, 'cozy', 'B keeps its own when A\'s change in Drive is older than B\'s');
  assert.ok((await a.run()).ok); assert.ok((await b.run()).ok);
  assert.equal((await a.settings.get('look')).look.density, 'roomy', 'A\'s later change wins');
  assert.equal((await b.settings.get('look')).look.density, 'roomy');
  // A value taken from Drive keeps the time it changed on the device that wrote it.
  const stamps = (await b.local.get(ST.STAMPS))[ST.STAMPS];
  assert.equal(stamps['local:' + TODO], body(recFile(drive, 'local', TODO)).at, 'B\'s stamp for A\'s tasks is A\'s time, not when B took them');
  // Settled: nothing more goes up.
  const n = drive.log.filter((x) => x.upload).length;
  await a.run(); await b.run();
  assert.equal(drive.log.filter((x) => x.upload).length, n, 'no echo of each other\'s writes');
});

test('two devices that each make the same key before hearing of the other keep one file for it', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  await a.on(); await b.on();
  clock.t += 1000; await a.local.set({ writerWords: ['Alpha'] });
  assert.ok((await a.run({ push: true })).ok);
  clock.t += 1000; await b.local.set({ writerWords: ['Beta'] });
  assert.ok((await b.run({ push: true })).ok);
  const files = [...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'rec' && f.meta.appProperties.key === sha('local\nwriterWords').slice(0, 32));
  assert.equal(files.length, 1, 'one file');
  assert.ok((await a.run()).ok);
  assert.deepEqual((await a.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Beta']);
  assert.deepEqual((await b.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Beta']);
});

test('a fresh device restores everything from the folder, and keeps its own', async () => {
  const drive = standin(), a = device(drive), c = device(drive);
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Essay text' }] }] };
  await a.papers.save('doc:00000000-0000-4000-8000-00000000d001', { doc, title: 'Essay', named: true });
  await a.local.set({ [TODO]: todo('From A'), lookFavorites: [{ code: 'a', name: 'A' }], writerWords: ['Alpha'], [CLASSES]: C.clean({ courses: [{ id: '101', name: 'Bio', at: 10, periods: [{ days: [1], start: 540, end: 600 }] }], gone: {} }) });
  await a.settings.set({ colors: accent('#abcdef') });
  await a.on();
  // The new device already has some of its own.
  const OWN = 'todo:https://other.instructure.com/7';
  await c.local.set({ [OWN]: todo('Mine'), lookFavorites: [{ code: 'c', name: 'C' }], writerWords: ['Gamma'], [CLASSES]: C.clean({ courses: [{ id: '102', name: 'Chem', at: 20, periods: [{ days: [2], start: 600, end: 660 }] }], gone: {} }) });
  assert.ok((await c.on()).ok);
  assert.equal((await c.papers.list()).find((x) => x.key === 'doc:00000000-0000-4000-8000-00000000d001')?.title, 'Essay', 'documents');
  assert.deepEqual((await c.local.get(TODO))[TODO], todo('From A'), 'tasks');
  assert.deepEqual((await c.settings.get('colors')).colors, accent('#abcdef'), 'Settings');
  assert.deepEqual((await c.local.get(OWN))[OWN], todo('Mine'), 'its own tasks kept');
  assert.deepEqual((await c.local.get('lookFavorites')).lookFavorites.map((f) => f.code).sort(), ['a', 'c'], 'favorites joined, not replaced');
  assert.deepEqual((await c.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Gamma'], 'the dictionary joined');
  assert.deepEqual((await c.local.get(CLASSES))[CLASSES].courses.map((x) => x.id).sort(), ['101', '102'], 'class schedules joined');
  // And A gets C's back.
  assert.ok((await a.run()).ok);
  assert.deepEqual((await a.local.get(OWN))[OWN], todo('Mine'));
  assert.deepEqual((await a.local.get('lookFavorites')).lookFavorites.map((f) => f.code).sort(), ['a', 'c']);
});

test('deletes on each side travel as tombstones; a tombstone never wipes a record met for the first time', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  await a.local.set({ [NOTE]: { text: 'Gone soon', at: 1 }, [TODO]: todo('Keep') });
  await a.on(); await b.on();
  clock.t += 1000; await a.local.remove(NOTE);
  assert.ok((await a.run()).ok);
  const f = recFile(drive, 'local', NOTE);
  assert.ok(f && body(f).deleted === true && !f.meta.explicitlyTrashed, 'the file stays, a tombstone');
  assert.ok((await b.run()).ok);
  assert.equal((await b.local.get(NOTE))[NOTE], undefined, 'deleted on B');
  clock.t += 1000; await b.local.remove(TODO);
  assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  assert.equal((await a.local.get(TODO))[TODO], undefined, 'and from B to A');
  // A third device holding the note meets the tombstone first time: its note stays, and goes up.
  const c = device(drive, { clock });
  await c.local.set({ [NOTE]: { text: 'Mine still', at: 2 } });
  assert.ok((await c.on()).ok);
  assert.equal((await c.local.get(NOTE))[NOTE].text, 'Mine still');
  assert.equal(body(recFile(drive, 'local', NOTE)).value.text, 'Mine still');
  noDeletes(drive);
});

test('a token that expires mid-sync is replaced once; an account switch forgets this account\'s records', async () => {
  const drive = standin(), a = device(drive);
  await a.local.set({ [TODO]: todo('x'), writerWords: ['y'] });
  let n = 0;
  drive.fail(401, ERRORS[401], (x) => x.path.startsWith('/upload/') && ++n === 2);
  assert.ok((await a.on()).ok);
  assert.deepEqual(a.log.drop, ['tok-1']);
  assert.ok(recFile(drive, 'local', TODO) && recFile(drive, 'local', 'writerWords'));
  const before = drive.log.length;
  a.who.account = 'other@school.edu';
  await a.local.set({ [TODO]: todo('x', 'z') });
  assert.deepEqual(await a.run(), { ok: false, why: 'account' });
  assert.equal(drive.log.length, before, 'nothing sent to the other account');
  assert.deepEqual((await a.local.keys()).filter((k) => k.startsWith(ST.REC) || k === ST.STAMPS), [], 'this account\'s records forgotten');
  assert.deepEqual((await a.local.get(TODO))[TODO], todo('x', 'z'), 'the tasks themselves untouched');
});

test('Drive\'s rate limit is waited out record by record; a full Drive stops with its own problem', async () => {
  const drive = standin(), a = device(drive);
  await a.local.set({ [TODO]: todo('x') });
  drive.fail(403, ERRORS.userRateLimitExceeded, (x) => x.path.startsWith('/upload/'), 3);
  assert.ok((await a.on()).ok);
  assert.deepEqual(a.log.sleep, [1000, 2000, 4000]);
  await a.local.set({ [TODO]: todo('x', 'y') });
  drive.fail(403, ERRORS.storageQuotaExceeded, (x) => x.path.startsWith('/upload/'));
  assert.deepEqual(await a.run(), { ok: false, why: 'quota' });
});

test('a daily snapshot of Back up…\'s zip in Glaze/Backups, the newest five kept, the older in Drive\'s trash', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock, snapshots: true });
  await a.local.set({ [TODO]: todo('x') });
  await a.on();
  const snaps = () => [...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'snapshot');
  assert.equal(snaps().length, 1);
  const folder = [...drive.files.values()].find((f) => f.meta.appProperties.glaze === 'backups');
  assert.ok(folder && folder.meta.name === 'Backups' && snaps()[0].meta.parents[0] === folder.meta.id && snaps()[0].meta.mimeType === 'application/zip');
  await a.run();
  assert.equal(snaps().length, 1, 'once a day');
  for (let i = 0; i < 6; i++) { clock.t += ST.SNAP.every + 1; assert.ok((await a.run()).ok); }
  assert.equal(snaps().length, 7);
  assert.equal(snaps().filter((f) => !f.meta.explicitlyTrashed).length, 5, 'five kept');
  assert.deepEqual(snaps().filter((f) => f.meta.explicitlyTrashed).map((f) => f.meta.name).sort(), snaps().map((f) => f.meta.name).sort().slice(0, 2), 'the oldest two in Drive\'s trash');
  noDeletes(drive);
});
