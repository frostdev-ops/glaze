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
    // As Chrome's storage: a key written with the value it already holds is no change, and nothing hears of it.
    set: async (o) => { const c = {}; for (const [k, v] of Object.entries(o)) { if (!m.has(k) || ST.canon(m.get(k)) !== ST.canon(v)) c[k] = { oldValue: m.get(k), newValue: structuredClone(v) }; m.set(k, structuredClone(v)); } await tell(c); },
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
const N = require('../../extension/planner/notes.js');
const notesDb = () => {
  const stores = { bodies: new Map(), files: new Map(), blobs: new Map() };
  const pick = (s, prefix) => [...stores[s]].filter(([k]) => !prefix || k.startsWith(prefix));
  return {
    stores,
    get: async (s, k) => structuredClone(stores[s].get(k)), put: async (s, k, v) => { stores[s].set(k, structuredClone(v)); },
    del: async (s, keys) => { for (const k of keys) stores[s].delete(k); },
    scan: async (s, prefix) => pick(s, prefix).map(([k, v]) => [k, structuredClone(v)]), keys: async (s, prefix) => pick(s, prefix).map(([k]) => k),
    estimate: async () => ({ quota: 1e12, usage: 0 }),
  };
};
const device = (drive, { account = 'student@school.edu', clock = { t: Date.parse('2026-10-30T12:00:00Z') }, snapshots = false } = {}) => {
  const heard = [], local = area('local', heard), sync = area('sync', heard), now = () => clock.t, who = { account };
  const papers = P.open(local, now, { versions: () => 40, files: { own: async () => ({ missing: [] }) } });
  let dropped = 0;
  const log = { sleep: [], drop: [] };
  let snaps = 0;
  // The worker's Notes database in memory, and Notes' own run over it, one change at a time as the worker's queue runs them.
  const db = notesDb();
  let q = Promise.resolve();
  // As the worker's broker area: a write says whether it worked.
  const brokered = { get: (k) => local.get(k), set: async (o) => { await local.set(o); return true; } };
  const turn = (f) => { const p = q.then(f); q = p.catch(() => {}); return p; };
  const run = (m, onChange) => N.run(m, { local: brokered, onChange }, db, now());
  const notes = ST.notesArea({ local, db, run, turn });
  const store = ST.create({
    area: (n) => (n === 'sync' ? sync : n === 'notes' ? notes : local), store: local, hash: async (s) => sha(s), now,
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
  const notesOp = async (m) => { const r = await turn(() => run(m)); await settle(); return r; };
  return { db, notes, notesOp, local: heardAfter(local), settings: heardAfter(sync), papers, sync: sync2, store, who, log, clock, on, run: async (o) => { await settle(); const r = await sync2.run(o); await settle(); return r; } };
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
// The time a device holds for a record's last change: its stamp while one is pending, else what its record says was agreed.
const timeOf = async (d, area, key) => {
  const stamp = ((await d.local.get(ST.STAMPS))[ST.STAMPS] || {})[`${area}:${key}`], rec = (await d.local.get(ST.REC + sha(`${area}\n${key}`).slice(0, 32)))[ST.REC + sha(`${area}\n${key}`).slice(0, 32)];
  return stamp ?? rec?.at;
};
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
    ai: { keys: 'secret' }, aiConnections: { x: 1 }, agentLink: { pair: 'p' }, canvas: { cache: 1 }, google: { email: 'x' },
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
  for (const k of ['ai', 'aiConnections', 'agentLink', 'canvas', 'google', 'driveSync']) assert.equal(recFile(drive, 'local', k), undefined, `${k} never leaves`);
  assert.ok(!ST.CATS.some((c) => !['local', 'sync', 'notes'].includes(c.area) || /share/i.test(c.cat)), 'share keys have no category: they stay in the worker\'s sharing database');
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
  assert.equal(await timeOf(b, 'local', TODO), body(recFile(drive, 'local', TODO)).at, 'B\'s time for A\'s tasks is A\'s, not when B took them');
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

// ---- Gradescope and Notes
const GS = require('../../extension/planner/gradescope.js');
const ACCT = 'notesIdx:https://school.instructure.com/42';
const nid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const noteOf = async (d, id) => { const r = await d.notesOp({ key: ACCT, op: 'load', id }); return r.ok ? r.html : null; };
const idxOf = async (d) => N.clean((await d.local.get(ACCT))[ACCT]);

test('Gradescope: the student\'s placings and answers sync; what was read from Gradescope stays on its device', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const acct = { id: 'a'.repeat(24), name: 'Sam' };
  const gs = (to, rows) => GS.clean({ acct, map: { 111: { to, name: 'Bio 101' } }, courses: { 111: { at: 5, bad: 0, rows } }, hide: false, bind: {} });
  await a.local.set({ gradescope: gs('canvas:https://school.instructure.com/7', [{ id: '9', title: 'Lab 1' }]) });
  await a.on();
  const f = recFile(drive, 'local', 'gradescope');
  assert.ok(f && body(f).value.map['111'].to === 'canvas:https://school.instructure.com/7', 'the placing goes up');
  assert.equal(body(f).value.courses, undefined, 'what was read does not');
  await b.local.set({ gradescope: gs('', [{ id: '8', title: 'B read this' }]) });
  await b.on();
  // First meeting with no join rule: B keeps its own and sends it up; A then takes it, keeping A's own reading.
  clock.t += 1000; await b.local.set({ gradescope: { ...(await b.local.get('gradescope')).gradescope, hide: true } });
  assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  const here = (await a.local.get('gradescope')).gradescope;
  assert.equal(here.hide, true, 'B\'s answer reached A');
  assert.deepEqual(here.courses, {}, 'B cleared the course placing, so A must drop its cached rows');
  // A reads Gradescope again: no upload, since nothing the student chose changed.
  const n = drive.log.filter((x) => x.upload).length;
  clock.t += 1000; await a.local.set({ gradescope: { ...here, courses: { 111: { at: 9, bad: 0, rows: [{ id: '10', title: 'Lab 2' }] } } } });
  assert.ok((await a.run()).ok);
  assert.equal(drive.log.filter((x) => x.upload).length, n, 'a fresh reading sends nothing');
});

test('Gradescope downloads invalidate cached rows when their account or course placing changes', async () => {
  for (const change of ['account', 'placing', 'compatible']) {
    const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
    const acct = { id: 'a'.repeat(24), name: 'Sam' }, to = 'canvas:https://school.instructure.com/7';
    const original = GS.clean({ acct, map: { 111: { to, name: 'Biology' } }, courses: { 111: { at: 5, rows: [{ id: '9', title: 'Private assignment' }] } } });
    await a.local.set({ gradescope: original });
    await a.on(); await b.on();
    await b.local.set({ gradescope: original });
    clock.t += 1000;
    await a.local.set({ gradescope: GS.clean({ ...original, courses: {}, ...(change === 'account' ? { acct: { id: 'b'.repeat(24), name: 'Alex' } } : change === 'placing' ? { map: { 111: { to: 'canvas:https://school.instructure.com/8', name: 'Other class' } } } : { hide: true }) }) });
    assert.ok((await a.run()).ok); assert.ok((await b.run()).ok);
    assert.deepEqual((await b.local.get('gradescope')).gradescope.courses, change === 'compatible' ? original.courses : {}, `${change}: keep rows only for the same account and course placing`);
  }
});

test('Notes re-download an immutable picture after local cleanup when a later remote edit uses it again', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const id = nid(1), picture = nid(500), fileKey = `https://school.instructure.com/42/${picture}`;
  await a.notesOp({ key: ACCT, op: 'file', id: picture, kind: 'image', name: 'cell.png', data: PNG.toString('base64'), note: id });
  await a.notesOp({ key: ACCT, op: 'save', id, base: 0, sid: 'a1', html: `<p>Picture</p><img data-gz-file="${picture}">` });
  await a.on(); await b.on();
  // Remove the picture from B's text, then let Notes' own cleanup collect the unused bytes after a day.
  clock.t += 1000;
  await b.notesOp({ key: ACCT, op: 'save', id, base: (await idxOf(b)).notes[id].rev, sid: 'b1', html: '<p>Picture removed</p>' });
  clock.t += 86400001;
  assert.ok((await b.notesOp({ key: ACCT, op: 'tidy' })).ok);
  assert.equal(b.db.stores.blobs.get(fileKey), undefined, 'cleanup collected the unused picture');
  clock.t += 1000;
  await a.notesOp({ key: ACCT, op: 'save', id, base: (await idxOf(a)).notes[id].rev, sid: 'a2', html: `<p>Picture again</p><img data-gz-file="${picture}">` });
  assert.ok((await a.run()).ok); assert.ok((await b.run()).ok);
  assert.deepEqual(Buffer.from(b.db.stores.blobs.get(fileKey) || []), PNG, 'the existing Drive picture is restored');
});

test('Notes: folders, notes and their pictures reach another device; edits interleave; the later edit wins; deletes and Trash follow', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const folder = nid(900);
  await a.notesOp({ key: ACCT, op: 'folder', id: folder, name: 'Biology' });
  assert.ok((await a.notesOp({ key: ACCT, op: 'file', id: nid(500), kind: 'image', name: 'cell.png', data: PNG.toString('base64'), note: nid(1) })).ok);
  assert.ok((await a.notesOp({ key: ACCT, op: 'save', id: nid(1), base: 0, sid: 's1', html: `<p>Cells</p><img data-gz-file="${nid(500)}">`, title: 'Cells', folder })).ok);
  assert.ok((await a.notesOp({ key: ACCT, op: 'save', id: nid(2), base: 0, sid: 's2', html: '<p>Second</p>', title: 'Second' })).ok);
  assert.ok((await a.on()).ok);
  assert.ok((await b.on()).ok);
  assert.match(await noteOf(b, nid(1)), /Cells/, 'B has the note\'s text');
  assert.equal((await idxOf(b)).notes[nid(1)].folder, folder, 'in its folder');
  assert.equal((await idxOf(b)).folders[folder].name, 'Biology');
  assert.deepEqual(Buffer.from(b.db.stores.blobs.get(`https://school.instructure.com/42/${nid(500)}`)), PNG, 'and its picture');
  // Interleaved: A edits one note, B the other.
  clock.t += 1000; await a.notesOp({ key: ACCT, op: 'save', id: nid(1), base: (await idxOf(a)).notes[nid(1)].rev, sid: 's3', html: '<p>Cells, by A</p>' });
  clock.t += 1000; await b.notesOp({ key: ACCT, op: 'save', id: nid(2), base: (await idxOf(b)).notes[nid(2)].rev, sid: 's4', html: '<p>Second, by B</p>' });
  assert.ok((await a.run()).ok); assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  assert.match(await noteOf(b, nid(1)), /by A/); assert.match(await noteOf(a, nid(2)), /by B/);
  assert.equal(await timeOf(b, 'notes', `${ACCT}|${nid(1)}`), body(recFile(drive, 'notes', `${ACCT}|${nid(1)}`)).at, 'B keeps A\'s time for A\'s edit, not when B took it');
  // A picture added in a later edit goes up with the note.
  clock.t += 1000;
  const GIF = Buffer.from('474946383961010001000000002c00000000010001000002', 'hex');
  assert.ok((await a.notesOp({ key: ACCT, op: 'file', id: nid(501), kind: 'image', name: 'dot.gif', data: GIF.toString('base64'), note: nid(1) })).ok);
  await a.notesOp({ key: ACCT, op: 'save', id: nid(1), base: (await idxOf(a)).notes[nid(1)].rev, sid: 's3b', html: `<p>Cells, by A</p><img data-gz-file="${nid(501)}">` });
  assert.ok((await a.run({ push: true })).ok); assert.ok((await b.run()).ok);
  assert.deepEqual(Buffer.from(b.db.stores.blobs.get(`https://school.instructure.com/42/${nid(501)}`)), GIF, 'the later picture reached B');
  // Both edit one note: the later edit wins on both.
  clock.t += 1000; await a.notesOp({ key: ACCT, op: 'save', id: nid(2), base: (await idxOf(a)).notes[nid(2)].rev, sid: 's5', html: '<p>A early</p>' });
  assert.ok((await a.run()).ok);
  clock.t += 1000; await b.notesOp({ key: ACCT, op: 'save', id: nid(2), base: (await idxOf(b)).notes[nid(2)].rev, sid: 's6', html: '<p>B later</p>' });
  assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  assert.match(await noteOf(a, nid(2)), /B later/); assert.match(await noteOf(b, nid(2)), /B later/);
  // Trash on A: in Trash on B. Deleted for good on B: gone on A, a tombstone in Drive.
  clock.t += 1000; await a.notesOp({ key: ACCT, op: 'trash', ids: [nid(2)] });
  assert.ok((await a.run()).ok); assert.ok((await b.run()).ok);
  assert.ok((await idxOf(b)).notes[nid(2)].del, 'in B\'s Trash');
  clock.t += 1000; await b.notesOp({ key: ACCT, op: 'purge', ids: [nid(2)] });
  assert.ok((await b.run()).ok); assert.ok((await a.run()).ok);
  assert.equal((await idxOf(a)).notes[nid(2)], undefined, 'gone on A');
  assert.ok((await idxOf(a)).gone[nid(2)], 'with Notes\' own tombstone');
  assert.equal(body(recFile(drive, 'notes', `${ACCT}|${nid(2)}`)).deleted, true, 'Drive keeps a tombstone file');
  // Settled: nothing more goes up.
  const n = drive.log.filter((x) => x.upload).length;
  await a.run(); await b.run();
  assert.equal(drive.log.filter((x) => x.upload).length, n, 'no echo of Notes\' own writes');
  noDeletes(drive);
});

test('Notes on a fresh device: its own notes stay; the folder\'s come in; one on both keeps the newer text', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), c = device(drive, { clock });
  await a.notesOp({ key: ACCT, op: 'save', id: nid(1), base: 0, sid: 'a1', html: '<p>From A</p>', title: 'A' });
  await a.notesOp({ key: ACCT, op: 'save', id: nid(3), base: 0, sid: 'a3', html: '<p>Shared, old</p>', title: 'Shared' });
  await a.on();
  clock.t += 5000;
  await c.notesOp({ key: ACCT, op: 'save', id: nid(2), base: 0, sid: 'c2', html: '<p>Mine</p>', title: 'C' });
  await c.notesOp({ key: ACCT, op: 'save', id: nid(3), base: 0, sid: 'c3', html: '<p>Shared, newer</p>', title: 'Shared' });
  assert.ok((await c.on()).ok);
  assert.match(await noteOf(c, nid(1)), /From A/);
  assert.match(await noteOf(c, nid(2)), /Mine/, 'its own kept');
  assert.match(await noteOf(c, nid(3)), /newer/, 'the newer of the two');
  assert.ok((await a.run()).ok);
  assert.match(await noteOf(a, nid(2)), /Mine/);
  assert.match(await noteOf(a, nid(3)), /newer/);
});

test('Notes first meeting keeps newer metadata and Trash when the other device has newer text', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock }), id = nid(1);
  await a.notesOp({ key: ACCT, op: 'save', id, base: 0, sid: 'a1', title: 'Original', html: '<p>Original</p>' });
  await b.notesOp({ key: ACCT, op: 'save', id, base: 0, sid: 'b1', title: 'Original', html: '<p>Original</p>' });
  clock.t += 1000;
  await a.notesOp({ key: ACCT, op: 'save', id, base: 1, sid: 'a2', html: '<p>Newer text</p>' });
  await a.on();
  clock.t += 1000;
  await b.notesOp({ key: ACCT, op: 'meta', id, title: 'Newer title' });
  await b.notesOp({ key: ACCT, op: 'trash', ids: [id] });
  assert.ok((await b.on()).ok);
  assert.match(await noteOf(b, id), /Newer text/, 'the newer text is joined');
  assert.equal((await idxOf(b)).notes[id].title, 'Newer title', 'the newer title survives');
  assert.ok((await idxOf(b)).notes[id].del, 'joining newer text does not restore the note from Trash');
});

test('Notes first meeting joins newer folder fields instead of overwriting them with an old local copy', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock }), id = nid(900);
  await a.notesOp({ key: ACCT, op: 'folder', id, name: 'Original' });
  await b.notesOp({ key: ACCT, op: 'folder', id, name: 'Original' });
  await a.on();
  clock.t += 1000;
  await a.notesOp({ key: ACCT, op: 'folder', id, name: 'Renamed on A' });
  assert.ok((await a.run()).ok);
  assert.ok((await b.on()).ok);
  assert.equal((await idxOf(b)).folders[id].name, 'Renamed on A', 'the newer name is joined on first meeting');
  assert.ok((await a.run()).ok);
  assert.equal((await idxOf(a)).folders[id].name, 'Renamed on A');
});

test('Notes keeps the timestamp of a local rename that invalidates an incoming remote write', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock }), id = nid(1);
  await a.notesOp({ key: ACCT, op: 'save', id, base: 0, sid: 'a1', title: 'Original', html: '<p>Original</p>' });
  await a.on(); await b.on();
  clock.t += 1000;
  await a.notesOp({ key: ACCT, op: 'save', id, base: (await idxOf(a)).notes[id].rev, sid: 'a2', html: '<p>Remote edit</p>' });
  await a.run();
  const replace = b.notes.replace;
  b.notes.replace = async (...args) => {
    b.notes.replace = replace;
    clock.t += 1000;
    await b.notesOp({ key: ACCT, op: 'meta', id, title: 'Local rename' });
    return replace(...args);
  };
  assert.equal((await b.run()).why, 'stale');
  assert.equal((await b.local.get(ST.STAMPS))[ST.STAMPS][`notes:${ACCT}|${id}`], clock.t, 'the failed remote apply must not swallow the local event');
  clock.t = (await b.local.get(S.STATE))[S.STATE].wait + 1;
  assert.ok((await b.run()).ok);
  assert.equal((await idxOf(b)).notes[id].title, 'Local rename', 'the later local edit wins on retry');
});

test('Notes keeps a local timestamp when an edit follows a remote apply before its bookkeeping finishes', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock }), id = nid(1);
  await a.notesOp({ key: ACCT, op: 'save', id, base: 0, sid: 'a1', title: 'Original', html: '<p>Original</p>' });
  await a.on(); await b.on();
  clock.t += 1000;
  await a.notesOp({ key: ACCT, op: 'save', id, base: (await idxOf(a)).notes[id].rev, sid: 'a2', html: '<p>Remote edit</p>' });
  await a.run();
  const replace = b.notes.replace;
  b.notes.replace = async (...args) => {
    b.notes.replace = replace;
    const result = await replace(...args);
    clock.t += 1000;
    await b.notesOp({ key: ACCT, op: 'meta', id, title: 'Local rename' });
    return result;
  };
  assert.ok((await b.run()).ok);
  assert.equal((await b.local.get(ST.STAMPS))[ST.STAMPS][`notes:${ACCT}|${id}`], clock.t, 'bookkeeping must preserve the later local time');
});

// ---- the store's own limits, overlapping first syncs, first meetings

test('a daily snapshot that can\'t be made or is refused is passed over for the day; the run still succeeds', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, local = device(drive, { clock }).local;
  let made = 0, maker = async () => { made++; return null; }; // too big for one backup (background/backup.js pack 'big')
  const store = ST.create({ area: () => local, store: local, hash: async (s) => sha(s), now: () => clock.t, snapshot: () => maker() });
  const client = D.create({ fetch: drive.fetch, token: async () => 'tok-1', interactive: false });
  const folder = drive.seed({ name: 'Glaze', mimeType: drive.FOLDER, appProperties: { glaze: 'root' } }).meta.id;
  const ctx = { D: (fn) => fn(client), folder, state: async (p) => { await local.set({ driveSync: { ...(await local.get('driveSync')).driveSync, ...p } }); } };
  await store.snapshot(ctx); await store.snapshot(ctx);
  assert.equal(made, 1, 'a snapshot too big for one file is tried once a day, not on every run');
  // One the maker can't build (a spreadsheet missing a band: pack 'bad'), or one Drive refuses: no failed runs.
  clock.t += ST.SNAP.every + 1;
  maker = async () => { made++; throw Object.assign(new Error('bad'), { why: 'bad' }); };
  await store.snapshot(ctx);
  clock.t += ST.SNAP.every + 1;
  maker = async () => { made++; return { name: 'glaze-backup-2026-11-01.zip', bytes: new TextEncoder().encode('PK') }; };
  drive.fail(400, { error: { errors: [{ reason: 'badRequest' }], code: 400 } }, (x) => x.path.startsWith('/upload/'));
  await store.snapshot(ctx); await store.snapshot(ctx);
  assert.equal(made, 3);
  assert.equal([...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'snapshot').length, 0);
});

test('Notes another device has that won\'t fit here are passed over; the rest still syncs', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const picture = nid(500);
  await a.notesOp({ key: ACCT, op: 'file', id: picture, kind: 'image', name: 'cell.png', data: PNG.toString('base64'), note: nid(1) });
  await a.notesOp({ key: ACCT, op: 'save', id: nid(1), base: 0, sid: 'a1', html: `<p>Cells</p><img data-gz-file="${picture}">` });
  await a.local.set({ [TODO]: todo('FromA') });
  assert.ok((await a.on()).ok);
  // B's disk is all but full: Notes refuses the picture ('full'), as it would past its own 200 MB of files.
  b.db.estimate = async () => ({ quota: 10, usage: 0 });
  assert.deepEqual(await b.on(), { ok: true });
  assert.deepEqual((await b.local.get(TODO))[TODO], todo('FromA'));
  assert.match(await noteOf(b, nid(1)), /Cells/);
  assert.ok((await b.run()).ok, 'and the next run too');
});

test('a first meeting Restore can\'t join (more class schedules than one device keeps) is passed over, not a stuck sync', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const courses = (from) => Array.from({ length: 40 }, (_, i) => ({ id: String(from + i), name: `C${from + i}`, at: 5, periods: [{ days: [1], start: 540, end: 600 }] }));
  await a.local.set({ [CLASSES]: C.clean({ courses: courses(100) }), writerWords: ['Alpha'] });
  await b.local.set({ [CLASSES]: C.clean({ courses: courses(500) }) });
  assert.ok((await a.on()).ok);
  assert.deepEqual(await b.on(), { ok: true });
  assert.deepEqual((await b.local.get('writerWords')).writerWords, ['Alpha']);
  assert.equal((await b.local.get(CLASSES))[CLASSES].courses.length, 40, 'B keeps its own');
});

test('two devices whose first syncs overlap keep one record file and see each other\'s later edits', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') };
  // A's record uploads wait until B has listed Data: both find no file for writerWords, and each makes one.
  let listed;
  const held = new Promise((r) => { listed = r; });
  const text = (b) => (typeof b === 'string' ? b : Buffer.from(b || []).toString('latin1'));
  const gateA = { ...drive, fetch: async (u, i = {}) => { if (u.includes('/upload/') && i.method === 'POST' && text(i.body).includes('"glaze":"rec"')) await held; return drive.fetch(u, i); } };
  const gateB = { ...drive, fetch: async (u, i) => { const r = await drive.fetch(u, i); if (u.includes('/drive/v3/files?') && decodeURIComponent(u).includes("value='rec'")) listed(); return r; } };
  const a = device(gateA, { clock }), b = device(gateB, { clock });
  await a.local.set({ writerWords: ['Alpha'] });
  await b.local.set({ writerWords: ['Beta'] });
  const first = a.on();
  await new Promise((r) => setTimeout(r, 50));
  await Promise.all([first, b.on()]);
  for (let i = 0; i < 2; i++) { assert.ok((await a.run()).ok); assert.ok((await b.run()).ok); }
  assert.deepEqual((await a.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Beta']);
  assert.deepEqual((await b.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Beta']);
  clock.t += 5000; await a.local.set({ writerWords: ['Alpha', 'Beta', 'Later'] });
  assert.ok((await a.run({ push: true })).ok); assert.ok((await b.run()).ok);
  assert.deepEqual((await b.local.get('writerWords')).writerWords, ['Alpha', 'Beta', 'Later'], 'A\'s later edit reaches B');
  clock.t += 5000; await b.local.set({ writerWords: ['Beta', 'Later'] });
  assert.ok((await b.run({ push: true })).ok); assert.ok((await a.run()).ok);
  assert.deepEqual((await a.local.get('writerWords')).writerWords, ['Beta', 'Later'], 'and B\'s reaches A');
  noDeletes(drive);
});

test('a second device joining keeps its own Better To Do tasks for the same account beside the folder\'s', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  await a.local.set({ [TODO]: todo('Reading') });
  assert.ok((await a.on()).ok);
  await b.local.set({ [TODO]: T.clean({ tasks: [{ id: 'tLab', title: 'Lab report', done: false, at: 2000 }], items: { 'task:tLab': { subs: [{ id: 's1', title: 'Graphs', done: true }] } } }) });
  assert.ok((await b.on()).ok);
  const titles = async (d) => (await d.local.get(TODO))[TODO].tasks.map((x) => x.title).sort();
  assert.deepEqual(await titles(b), ['Lab report', 'Reading'], 'nothing of B\'s wiped');
  assert.deepEqual((await b.local.get(TODO))[TODO].items['task:tLab'].subs[0].title, 'Graphs', 'with its steps');
  assert.ok((await a.run()).ok);
  assert.deepEqual(await titles(a), ['Lab report', 'Reading'], 'and A gets B\'s');
});

test('two devices\' snapshots of one day are one file, so the five kept are five days', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') };
  const client = D.create({ fetch: drive.fetch, token: async () => 'tok-1', interactive: false });
  const folder = drive.seed({ name: 'Glaze', mimeType: drive.FOLDER, appProperties: { glaze: 'root' } }).meta.id;
  const day = () => new Date(clock.t).toISOString().slice(0, 10);
  const devices = ['A', 'B'].map((who) => {
    const local = device(drive, { clock }).local;
    const store = ST.create({ area: () => local, store: local, hash: async (s) => sha(s), now: () => clock.t,
      snapshot: async () => ({ name: `glaze-backup-${day()}.zip`, bytes: new TextEncoder().encode(`PK ${who} ${day()}`) }) });
    return { store, ctx: { D: (fn) => fn(client), folder, state: async (p) => { await local.set({ driveSync: { ...(await local.get('driveSync')).driveSync, ...p } }); } } };
  });
  for (let i = 0; i < 7; i++) {
    for (const d of devices) await d.store.snapshot(d.ctx);
    clock.t += ST.SNAP.every + 1;
  }
  const live = [...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'snapshot' && !f.meta.explicitlyTrashed);
  assert.deepEqual(live.map((f) => f.meta.name).sort(), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'].map((d) => `glaze-backup-${d}.zip`));
  assert.ok(live.every((f) => f.bytes.toString().startsWith('PK B')), 'the day\'s later one');
  noDeletes(drive);
});

test('a push after one note\'s edit reads that note, not every note ever synced', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock });
  assert.ok((await a.on()).ok);
  for (let i = 1; i <= 30; i++) { clock.t += 1000; assert.ok((await a.notesOp({ key: ACCT, op: 'save', id: nid(i), base: 0, sid: `s${i}`, html: `<p>Note ${i}</p>` })).ok); }
  assert.ok((await a.run({ push: true })).ok); assert.ok((await a.run({ push: true })).ok);
  let reads = 0;
  const get = a.db.get;
  a.db.get = async (s, k) => { if (s === 'bodies') reads++; return get(s, k); };
  clock.t += 1000;
  assert.ok((await a.notesOp({ key: ACCT, op: 'save', id: nid(7), base: (await idxOf(a)).notes[nid(7)].rev, sid: 's7b', html: '<p>Note 7, again</p>' })).ok);
  reads = 0;
  assert.ok((await a.run({ push: true })).ok);
  assert.ok(reads <= 3, `${reads} note bodies read`);
  assert.equal(body(recFile(drive, 'notes', `${ACCT}|${nid(7)}`)).value.html, '<p>Note 7, again</p>');
});

test('a change back to a value Drive sent unchanged still syncs', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  await a.local.set({ writerWords: ['One'] });
  await a.on(); await b.on();
  // Both make the same change, B first: B takes A's later one, the very value B holds.
  clock.t += 1000; await b.local.set({ writerWords: ['Two'] });
  clock.t += 1000; await a.local.set({ writerWords: ['Two'] });
  assert.ok((await a.run({ push: true })).ok); assert.ok((await b.run()).ok); assert.ok((await b.run({ push: true })).ok);
  clock.t += 1000; await b.local.set({ writerWords: ['Three'] });
  assert.ok((await b.run({ push: true })).ok); assert.ok((await b.run({ push: true })).ok);
  clock.t += 1000; await b.local.set({ writerWords: ['Two'] });
  assert.ok((await b.run({ push: true })).ok);
  assert.deepEqual(body(recFile(drive, 'local', 'writerWords')).value, ['Two'], 'B\'s change back reaches Drive');
  assert.ok((await a.run()).ok);
  assert.deepEqual((await a.local.get('writerWords')).writerWords, ['Two']);
});

// ---- round 2: first meetings that join, folders and copies that converge, a push cut short

test('a second device joining keeps its own Looks history beside the folder\'s, newest first', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const look = (c, at) => ({ theme: { colors: accent(c) }, at });
  await a.local.set({ lookHistory: [look('#aa0000', 300), look('#bb0000', 100)] });
  assert.ok((await a.on()).ok);
  await b.local.set({ lookHistory: [look('#cc0000', 200), look('#aa0000', 50)] });
  assert.ok((await b.on()).ok);
  const colors = async (d) => (await d.local.get('lookHistory')).lookHistory.map((e) => e.theme.colors['--gz-accent']);
  assert.deepEqual(await colors(b), ['#aa0000', '#cc0000', '#bb0000'], 'both devices\' Looks, once each, by when worn');
  assert.ok((await a.run()).ok);
  assert.deepEqual(await colors(a), ['#aa0000', '#cc0000', '#bb0000']);
});

test('a second device joining keeps its own Gradescope placings and answers beside the folder\'s', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  const acct = { id: 'a'.repeat(24), name: 'Sam' };
  await a.local.set({ gradescope: GS.clean({ acct, map: { 111: { to: 'canvas:https://school.instructure.com/7', name: 'Bio 101' } }, courses: {}, hide: false, bind: { 'https://school.instructure.com/42': { id: acct.id, show: true } } }) });
  assert.ok((await a.on()).ok);
  await b.local.set({ gradescope: GS.clean({ acct, map: { 222: { to: 'canvas:https://school.instructure.com/8', name: 'Chem 110' } }, courses: { 222: { at: 5, bad: 0, rows: [{ id: '3', title: 'Quiz' }] } }, hide: false, bind: {} }) });
  assert.ok((await b.on()).ok);
  const here = (await b.local.get('gradescope')).gradescope;
  assert.deepEqual(Object.keys(here.map).sort(), ['111', '222'], 'both devices\' placings');
  assert.equal(here.bind['https://school.instructure.com/42']?.show, true, 'and A\'s answer');
  assert.equal(here.courses['222']?.rows[0].title, 'Quiz', 'what B read for its own placing stays');
  assert.ok((await a.run()).ok);
  assert.deepEqual(Object.keys((await a.local.get('gradescope')).gradescope.map).sort(), ['111', '222']);
});

test('a snapshot cut short by a note saved while it was read is tried again on the next run, not tomorrow', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, local = device(drive, { clock }).local;
  let made = 0;
  const store = ST.create({ area: () => local, store: local, hash: async (s) => sha(s), now: () => clock.t,
    snapshot: async () => { if (++made === 1) throw Object.assign(new Error('changed'), { why: 'changed' }); return { name: 'glaze-backup-2026-10-30.zip', bytes: new TextEncoder().encode('PK') }; } });
  const client = D.create({ fetch: drive.fetch, token: async () => 'tok-1', interactive: false });
  const folder = drive.seed({ name: 'Glaze', mimeType: drive.FOLDER, appProperties: { glaze: 'root' } }).meta.id;
  const ctx = { D: (fn) => fn(client), folder, state: async (p) => { await local.set({ driveSync: { ...(await local.get('driveSync')).driveSync, ...p } }); } };
  await store.snapshot(ctx); await store.snapshot(ctx);
  assert.equal(made, 2);
  assert.equal([...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'snapshot').length, 1);
});

test('two devices that each made a Glaze folder at once end in one: the other\'s files move in, nothing in Drive\'s trash', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') };
  // A makes its Glaze folder only once B has looked for one and found none: each makes its own.
  let looked;
  const held = new Promise((r) => { looked = r; });
  const text = (x) => (typeof x === 'string' ? x : Buffer.from(x || []).toString('latin1'));
  const gateA = { ...drive, fetch: async (u, i = {}) => { if (i.method === 'POST' && /\/drive\/v3\/files\?/.test(u) && text(i.body).includes('"glaze":"root"')) await held; return drive.fetch(u, i); } };
  const gateB = { ...drive, fetch: async (u, i) => { const r = await drive.fetch(u, i); if (u.includes('/drive/v3/files?') && decodeURIComponent(u).includes("value='root'")) looked(); return r; } };
  const a = device(gateA, { clock }), b = device(gateB, { clock });
  await a.papers.save('doc:00000000-0000-4000-8000-0000000000a1', { doc: { type: 'doc', content: [] }, title: 'From A', named: true });
  await b.papers.save('doc:00000000-0000-4000-8000-0000000000b1', { doc: { type: 'doc', content: [] }, title: 'From B', named: true });
  await a.local.set({ writerWords: ['Alpha'] });
  await b.local.set({ writerWords: ['Beta'] });
  const first = a.on();
  await new Promise((r) => setTimeout(r, 30));
  await Promise.all([first, b.on()]);
  assert.equal([...drive.files.values()].filter((f) => f.meta.appProperties.glaze === 'root').length, 2, 'two Glaze folders made');
  for (let i = 0; i < 3; i++) { assert.ok((await a.run()).ok); assert.ok((await b.run()).ok); }
  const live = (tag) => [...drive.files.values()].filter((f) => f.meta.appProperties.glaze === tag && !drive.view(f.meta.id).trashed);
  assert.equal(live('root').length, 1, 'one Glaze folder');
  const root = live('root')[0].meta.id, top = [...drive.files.values()].filter((f) => f.meta.parents.includes('0AroOt') && f.meta.mimeType === drive.FOLDER && !drive.view(f.meta.id).trashed);
  assert.deepEqual(top.map((f) => f.meta.id), [root], 'the other one is not left beside it');
  assert.equal(live('data').length, 1, 'one Data folder');
  assert.ok(live('doc').every((f) => f.meta.parents.includes(root)) && live('doc').length === 2, 'both documents\' copies in it');
  assert.deepEqual((await a.papers.list()).map((r) => r.title).sort(), ['From A', 'From B']);
  assert.deepEqual((await b.papers.list()).map((r) => r.title).sort(), ['From A', 'From B']);
  assert.deepEqual((await a.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Beta']);
  assert.deepEqual((await b.local.get('writerWords')).writerWords.sort(), ['Alpha', 'Beta']);
  assert.ok([...drive.files.values()].every((f) => !f.meta.explicitlyTrashed), 'nothing moved to Drive\'s trash');
  noDeletes(drive);
});

test('a note whose text this device can no longer find is passed over: the rest of Sync goes on, both ways', async () => {
  const drive = standin(), clock = { t: Date.parse('2026-10-30T12:00:00Z') }, a = device(drive, { clock }), b = device(drive, { clock });
  await a.notesOp({ key: ACCT, op: 'save', id: nid(1), base: 0, sid: 'a1', html: '<p>Lost here</p>', title: 'Lost' });
  await a.local.set({ writerWords: ['Alpha'] });
  assert.ok((await a.on()).ok); assert.ok((await b.on()).ok);
  // A's copy of the note's text is gone from its database (Notes itself answers 'missing' for it); B edits that note.
  for (const k of [...a.db.stores.bodies.keys()]) a.db.stores.bodies.delete(k);
  assert.equal((await a.notesOp({ key: ACCT, op: 'load', id: nid(1) })).error, 'missing');
  clock.t += 1000; await b.notesOp({ key: ACCT, op: 'save', id: nid(1), base: (await idxOf(b)).notes[nid(1)].rev, sid: 'b1', html: '<p>Edited on B</p>' });
  assert.ok((await b.run()).ok);
  // A's own change still goes up, its runs succeed, and a full pass (Sync turned on again) does too.
  clock.t += 1000; await a.local.set({ writerWords: ['Alpha', 'Beta'] });
  assert.ok((await a.run()).ok, 'a run with the note among Drive\'s changes');
  assert.ok((await a.run({ full: true })).ok, 'a full pass');
  assert.ok((await b.run()).ok);
  assert.deepEqual((await b.local.get('writerWords')).writerWords, ['Alpha', 'Beta'], 'A\'s change reached B');
  assert.match(await noteOf(b, nid(1)), /Edited on B/, 'nothing of the lost text went over B\'s');
  noDeletes(drive);
});
