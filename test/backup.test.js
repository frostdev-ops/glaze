// One backup file (lib/backup.js): made on one device, read, checked and restored on another, category by category.
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/backup.js');
const N = require('../lib/notes.js');
const Z = require('../lib/zip.js');
const S = require('../lib/sessions.js');
const W = require('../lib/widgets.js');
const C = require('../lib/classes.js');
const G = require('../lib/gpa.js');
const T = require('../lib/todo.js');
const D = require('../defaults.js');
const SHARE = require('../lib/sharing.js');
const SHARE_KEY = SHARE.exportKeys(SHARE.create('collection'));
const SR = require('../lib/writer-sources.js');
const SOURCES = SR.key({ school: 'https://bb.school.test', user: '_900_1', course: '_101_1', item: '_7_1' });
const source = (title, id) => SR.normalize({ id, type: 'book', title, author: [{ family: 'Doe', given: 'Jane' }], issued: { 'date-parts': [[2020]] } });

const SITE = 'https://school.instructure.com';
const ACCOUNT = `notesIdx:${SITE}/5`;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.now() - 60000;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

// A device: storage.local, the Notes database, and the worker's Notes and key operations (lib/sessions.js).
const device = (seed = {}) => {
  const store = structuredClone(seed), db = { bodies: new Map(), files: new Map(), blobs: new Map() }, keys = [], sent = [];
  const local = {
    get: async (k) => structuredClone(k === null ? store : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, store[x]]))),
    set: async (o) => { Object.assign(store, structuredClone(o)); return true; },
    remove: async (ks) => { for (const k of [].concat(ks)) delete store[k]; return true; },
  };
  const idb = {
    get: async (s, k) => db[s].get(k), put: async (s, k, v) => { db[s].set(k, v); }, del: async (s, ks) => { for (const k of ks) db[s].delete(k); },
    scan: async (s, p) => [...db[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...db[s].keys()].filter((k) => k.startsWith(p)),
    estimate: async () => ({ usage: 1e6, quota: 1e9 }),
  };
  const worker = S.make({ local, sync: local, notes: idb, db: { all: async () => [] }, enqueue: async (f) => f() });
  const send = async (op, rest = {}) => {
    sent.push(op);
    const r = op === 'importKeys' ? (keys.push(...rest.keys), { ok: true }) : op === 'exportKeys' ? { ok: true, keys: structuredClone(keys) }
      : op === 'backupNotes' ? { ok: true, data: await worker.backupNotes(rest.key) } : await worker.handle({ op, ...rest });
    if (!r?.ok) throw new Error(r?.error || 'bad');
    return r;
  };
  const notes = (m, at = NOW) => N.run({ key: ACCOUNT, ...m }, { local }, idb, at);
  return { store, local, idb, keys, sent, send, notes, settings: [], stop: () => worker.stop() };
};

const SETTINGS = { ...D.GZ_SANITIZE(), cards: {}, links: {}, folders: {} };
// Every category on device `a`, with a marker each.
const seeded = async () => {
  const a = device({
    [`notes:${SITE}/5`]: { text: 'MARK-DASHBOARD-NOTE', at: NOW },
    [`gpaTerms:${SITE}:5`]: { t: [{ id: 'termone', n: 'MARK-PAST-TERM', c: [], at: NOW }] },
    [`classes:${SITE}/5`]: { tz: 'America/New_York', courses: [{ id: '25', name: 'MARK-SCHEDULE', at: NOW, periods: [{ days: [1], start: 540, end: 600, loc: 'Room', from: '', to: '', skip: [] }] }] },
    widgetLayout: { music: 'https://open.spotify.com/playlist/MARKplaylist0000000000', boards: {}, tiles: [] },
    lookFavorites: [{ code: 'mark-code', name: 'MARK-FAVORITE', at: NOW }],
    [`todo:${SITE}/5`]: T.clean({ tasks: [{ id: 'k1', title: 'MARK-TASK', at: NOW }] }),
    [ACCOUNT]: N.clean({}),
    writerWords: ['Glazeword', 'MARK-WORD'],
    [SOURCES]: { sources: [source('MARK-SOURCE', 's-mark-1')], at: NOW },
  });
  await a.send('notesFile', { key: ACCOUNT, file: { id: id(9), note: id(1), kind: 'image', name: 'pic.png', data: N.b64(PNG) } });
  assert.equal((await a.notes({ op: 'save', id: id(1), base: 0, sid: 'a', title: 'MARK-NOTE', html: `<p>MARK-NOTE-BODY</p><p><img data-gz-file="${id(9)}" alt=""></p>` })).ok, true);
  await require('../lib/writer-papers.js').open(a.local, () => NOW).save('bb.school.test|_900_1|_101_1|_7_1', { title: 'MARK-PAPER', format: 'mla9', doc: require('../lib/writer-schema.js').parse(require('../lib/writer-schema.js').paper, '<p>MARK-PAPER-BODY</p>').toJSON() });
  a.keys.push(SHARE_KEY);
  return a;
};
// Back up… as options.js does it: the settings and tasks it gathers, then everything else here.
const backUp = async (dev, settings = SETTINGS) => {
  const local = await dev.local.get(null);
  const notes = [];
  for (const account of Object.keys(local).filter((k) => B.ACCOUNT.test(k))) notes.push({ account, entries: await B.notesOut(account, dev.send) });
  const tasks = { tasks: Object.fromEntries(Object.entries(local).filter(([k]) => T.STORE_KEY.test(k))), pets: {} };
  const entries = B.pack({ settings: { ...settings, favorites: local.lookFavorites }, tasks, local, notes, keys: (await dev.send('exportKeys')).keys, version: '9.9.9' });
  return zipFile(entries);
};
const zipFile = async (entries, name = 'glaze-backup-2026-10-25.zip') => {
  const bytes = new Uint8Array(await new Blob(Z.zip(entries)).arrayBuffer());
  return { name, size: bytes.length, type: 'application/zip', arrayBuffer: async () => bytes.slice().buffer, bytes };
};
const jsonFile = (raw, name = 'glaze-settings.json') => {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return { name, size: text.length, type: 'application/json', text: async () => text };
};
// Replay the production staging/commit boundary with the real store and Notes import implementations.
const ioFor = (dev, refuseSettings = false) => {
  const steps = [], shared = new Map();
  const shares = { get: async (s, k) => shared.get(k), keys: async () => [...shared.keys()],
    put: async (s, k, v) => { shared.set(k, v); dev.keys.splice(0, dev.keys.length, ...[...shared.values()].map((r) => SHARE.exportKeys(r.st))); },
    del: async (s, ks) => { for (const k of ks) shared.delete(k); dev.keys.splice(0, dev.keys.length, ...[...shared.values()].map((r) => SHARE.exportKeys(r.st))); } };
  const sync = { get: async () => dev.settings.at(-1) || {}, set: async (v) => { dev.settings.push(structuredClone(v)); return true; }, remove: async () => true };
  return {
    begin: async () => {}, abort: async () => {},
    own: async (value) => { dev.own = (dev.own || 0) + 1; steps.push({ action: 'own', value }); return { ok: true }; },
    settings: async (value) => { steps.push({ action: 'settings', value }); return { ok: true }; },
    send: async (op, rest) => { dev.sent.push(op); steps.push({ action: 'send', value: { op, ...rest } }); return { ok: true, done: 0, skipped: 0 }; },
    finish: () => B.atomic(steps, { local: dev.local, sync, notes: dev.idb, shares, sessions: (env) => S.make(env),
      settings: (v, area) => refuseSettings ? { ok: false } : T.restore(v.tasks || {}, v, area.local, area.sync) }),
  };
};
// Restore… with `ticked` (default: everything the file has), as options.js does it.
const restore = async (dev, file, ticked, account) => {
  const plan = await B.read(file);
  return { plan, out: await B.restore(plan, new Set(ticked || Object.keys(plan.cats)), ioFor(dev), account) };
};
const reasonOf = (p) => p.then(() => 'read', (e) => e.why);

test('Papers, their JSON documents, versions and presets survive a backup restore', async () => {
  const PA = require('../lib/writer-papers.js'), key = 'bb.school.test|_900_1|_101_1|_7_1';
  const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { first: 0 }, content: [{ type: 'text', text: 'Paper before backup.' }] }] };
  const a = device(), P = PA.open(a.local);
  await P.save(key, { doc, format: 'mla9', title: 'Kept paper' });
  await P.savePreset('bb.school.test|_900_1', { id: 'custom:one', label: 'One', base: 'mla9' });
  const b = device(), file = await backUp(a), result = await restore(b, file, ['papers']);
  assert.ok(result.plan.cats.papers, 'the backup must include papers');
  assert.deepEqual(result.out.failed, []);
  const Q = PA.open(b.local);
  assert.equal((await Q.get(key)).title, 'Kept paper');
  assert.equal((await Q.get(key)).doc.content[0].attrs.first, 0);
  assert.ok((await Q.versions(key)).length);
  assert.equal((await Q.list())[0].title, 'Kept paper');
  assert.equal((await Q.presets('bb.school.test|_900_1'))[0].label, 'One');
  a.stop(); b.stop();
});

test('a paper with page setup and a paste preference survives a backup restore', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js'), ST = require('../lib/writer-styles.js');
  const key = 'bb.school.test|_900_1|_101_1|_7_1', a = device(), b = device();
  try {
    const node = SC.parse(SC.paper, '<p>Imported paper.</p>');
    const doc = node.type.create({ setup: ST.pageSetup(ST.FORMATS.mla9, { page: ST.PAGES.a4 }), paste: 'match' }, node.content).toJSON();
    await PA.open(a.local).save(key, { doc, format: 'mla9', keep: true });
    const result = await restore(b, await backUp(a), ['papers']);
    assert.deepEqual(result.out.failed, []);
    assert.deepEqual((await PA.open(b.local).get(key)).doc, JSON.parse(JSON.stringify(doc)));
  } finally { a.stop(); b.stop(); }
});

test('a doc: paper backs up and restores', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js');
  const key = PA.newKey(), a = device(), b = device();
  try {
    let clock = NOW;
    const P = PA.open(a.local, () => ++clock);
    await P.save(key, { doc: SC.parse(SC.paper, '<p>MARK-LOCAL-DOC</p>').toJSON(), title: 'My notes', named: true, format: 'mla9' });
    await P.save(key, { doc: SC.parse(SC.paper, '<p>MARK-LOCAL-DOC, more.</p>').toJSON() }, { reason: 'import' });
    const file = await backUp(a), plan = await B.read(file);
    assert.deepEqual(Object.keys(plan.cats.papers).sort(), [`writerPaper:${key}`, `writerVersions:${key}`]);
    const result = await restore(b, file, ['papers']);
    assert.deepEqual(result.out.failed, []);
    const Q = PA.open(b.local), p = await Q.get(key);
    assert.deepEqual([p.title, p.named, p.kind], ['My notes', true, 'paper']);
    assert.equal(SC.text(SC.paper.nodeFromJSON(p.doc)).text, 'MARK-LOCAL-DOC, more.');
    assert.deepEqual((await Q.list()).map((r) => [r.key, r.kind]), [[key, 'paper']]);
    assert.ok((await Q.versions(key)).some((v) => v.reason === 'import'));
  } finally { a.stop(); b.stop(); }
});

test('a document in Trash backs up and restores still in Trash, with when it was trashed and its versions', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js');
  const key = PA.newKey(), kept = PA.newKey(), a = device(), b = device();
  try {
    let clock = NOW;
    const P = PA.open(a.local, () => ++clock);
    await P.save(key, { doc: SC.parse(SC.paper, '<p>MARK-TRASHED-DOC</p>').toJSON(), title: 'Old notes', named: true, format: 'plain' });
    await P.save(kept, { doc: SC.parse(SC.paper, '<p>MARK-KEPT-DOC</p>').toJSON(), title: 'Notes', named: true, format: 'plain' });
    const { trashed } = await P.trash(key);
    const file = await backUp(a), result = await restore(b, file, ['papers']);
    assert.deepEqual(result.out.failed, []);
    const Q = PA.open(b.local), p = await Q.get(key), rows = await Q.list();
    assert.equal(p.trashed, trashed, 'the record keeps its flag');
    assert.equal(rows.find((r) => r.key === key).trashed, trashed, 'and its row, so it restores into Trash');
    assert.equal(PA.trashed(rows.find((r) => r.key === kept)), false, 'what was not trashed is not');
    assert.ok((await Q.versions(key)).length, 'its versions came with it');
  } finally { a.stop(); b.stop(); }
});

test('a record of an unknown kind is skipped on restore', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js');
  const paper = 'bb.school.test|_900_1|_101_1|_7_1', sheet = PA.newKey(), later = PA.newKey(), a = device(), b = device();
  try {
    const P = PA.open(a.local, () => NOW);
    await P.save(paper, { doc: SC.parse(SC.paper, '<p>MARK-PAPER</p>').toJSON(), title: 'Kept paper' });
    // A later build's kinds: their documents are no paper's.
    a.store[`writerPaper:${sheet}`] = { key: sheet, kind: 'board', title: 'Budget', updated: NOW, doc: { cells: [['a', 1]] } };
    a.store[`writerVersions:${sheet}`] = [{ id: 'v1', at: NOW, reason: 'start', doc: { cells: [] } }];
    a.store[`writerPaper:${later}`] = { key: later, kind: 'poster', updated: NOW, doc: { slides: [] } };
    const file = await backUp(a), plan = await B.read(file);
    assert.deepEqual(Object.keys(plan.cats.papers).sort(), [`writerPaper:${paper}`, `writerVersions:${paper}`]);
    const result = await restore(b, file, ['papers']);
    assert.deepEqual(result.out.failed, []);
    assert.equal((await PA.open(b.local).get(paper)).title, 'Kept paper');
    assert.deepEqual([b.store[`writerPaper:${sheet}`], b.store[`writerVersions:${sheet}`], b.store[`writerPaper:${later}`]], [undefined, undefined, undefined]);
    assert.deepEqual(await B.apply({ papers: { [`writerPaper:${sheet}`]: a.store[`writerPaper:${sheet}`] } }, { local: b.local }), { ok: true }, 'the worker omits it too');
    assert.equal(b.store[`writerPaper:${sheet}`], undefined);
  } finally { a.stop(); b.stop(); }
});

// A whole mixed set onto a device with documents of its own: an assignment's paper, a document edited on both, one in
// Trash and a later build's kind. What restores is the backup's, what the device alone holds stays, the index lists every
// record it should and no other, and the 30 days of the restored Trash run from when it was trashed.
test('a mixed set restores onto a device that has documents of its own', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js'), DAY = 864e5;
  const p = (text) => SC.parse(SC.paper, `<p>${text}</p>`).toJSON(), text = (r) => SC.text(SC.paper.nodeFromJSON(r.doc)).text;
  const paper = 'bb.school.test|_900_1|_101_1|_7_1', both = PA.newKey(), binned = PA.newKey(), sheet = PA.newKey(), mine = PA.newKey(), slides = PA.newKey();
  const a = device(), b = device();
  try {
    let at = NOW - 20 * DAY;
    const A = PA.open(a.local, () => at), Bs = PA.open(b.local, () => at);
    await Bs.save(both, { doc: p('MARK-BOTH-OLD'), title: 'Notes', named: true, format: 'plain' });
    await Bs.save(mine, { doc: p('MARK-MINE'), title: 'Mine', named: true, format: 'plain' });
    at += DAY;
    await A.save(paper, { doc: p('MARK-PAPER'), title: 'Essay 2', courseName: 'ENGL 2110' });
    await A.save(both, { doc: p('MARK-BOTH-NEW'), title: 'Notes', named: true, format: 'plain' });
    await A.save(binned, { doc: p('MARK-BINNED'), title: 'Old draft', named: true, format: 'plain' });
    const { trashed } = await A.trash(binned);
    // Later builds' kinds, on each device: theirs, never this build's to restore or to touch.
    a.store[`writerPaper:${sheet}`] = { key: sheet, kind: 'board', title: 'Budget', updated: at, doc: { cells: [] } };
    b.store[`writerPaper:${slides}`] = { key: slides, kind: 'poster', title: 'Talk', updated: at, doc: { slides: [] } };
    b.store.writerPapers = [{ key: slides, kind: 'poster', title: 'Talk', updated: at }, ...b.store.writerPapers];
    const result = await restore(b, await backUp(a), ['papers']);
    assert.deepEqual(result.out.failed, []);
    const rows = await Bs.list(), keys = rows.map((r) => r.key).sort();
    assert.deepEqual(keys, [paper, both, binned, mine, slides].sort(), 'every record listed once, the later kind\'s own row kept');
    for (const k of keys) assert.ok(b.store[`writerPaper:${k}`], `${k}: its record`);
    assert.equal(b.store[`writerPaper:${sheet}`], undefined, 'the backup\'s later kind left out');
    assert.deepEqual(b.store[`writerPaper:${slides}`].doc, { slides: [] }, 'the device\'s later kind untouched');
    assert.equal(text(await Bs.get(paper)), 'MARK-PAPER');
    assert.equal(text(await Bs.get(both)), 'MARK-BOTH-NEW', 'the newer edit wins');
    assert.ok((await Bs.versions(both)).some((v) => v.reason === 'restore'), 'the device\'s older text kept as a version');
    assert.equal(text(await Bs.get(mine)), 'MARK-MINE');
    assert.equal((await Bs.get(binned)).trashed, trashed);
    assert.deepEqual(rows.filter((r) => PA.trashed(r)).map((r) => r.key), [binned], 'in Trash: only what was');
    at = trashed + 31 * DAY;
    assert.deepEqual(await Bs.purge(), [binned], '30 days from when it was trashed, not from the restore');
    assert.deepEqual((await Bs.list()).map((r) => r.key).sort(), [paper, both, mine, slides].sort());
  } finally { a.stop(); b.stop(); }
});

test('backups accept the maximum selectable version count', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js');
  const key = 'bb.school.test|_900_1|_101_1|_7_1', a = device(), b = device();
  try {
    let clock = NOW;
    const P = PA.open(a.local, () => ++clock, { versions: () => 100 });
    for (let i = 0; i < 100; i++) await P.save(key, { doc: SC.parse(SC.paper, `<p>Version ${i}.</p>`).toJSON() }, { reason: 'submit' });
    const file = await backUp(a), plan = await B.read(file);
    assert.equal(plan.cats.papers[`writerVersions:${key}`].length, 100);
    const result = await restore(b, file, ['papers']);
    assert.deepEqual(result.out.failed, []);
    assert.ok((await PA.open(b.local).versions(key)).length);
  } finally { a.stop(); b.stop(); }
});

test('backups retain papers with several individually bounded pictures', async () => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js');
  const key = 'bb.school.test|_900_1|_101_1|_7_1', a = device(), b = device();
  try {
    const image = () => SC.paper.node('image', { src: `data:image/png;base64,${Buffer.alloc(900000).toString('base64')}`, width: 24 });
    const doc = SC.paper.node('doc', null, [SC.paper.node('paragraph', null, [image(), image()])]).toJSON();
    await PA.open(a.local).save(key, { doc });
    const result = await restore(b, await backUp(a), ['papers']);
    assert.deepEqual(result.out.failed, []);
    assert.deepEqual((await PA.open(b.local).get(key)).doc, JSON.parse(JSON.stringify(doc)));
  } finally { a.stop(); b.stop(); }
});

test('the writer\'s dictionary and saved sources join what is here, and a damaged one refuses the file', async () => {
  const a = await seeded(), file = await backUp(a);
  const b = device({ writerWords: ['Local', 'glazeword'], [SOURCES]: { sources: [source('Local source', 's-local-1')], at: NOW + 5 } });
  try {
    const { plan, out } = await restore(b, file, ['writerWords', 'sources']);
    assert.deepEqual(plan.cats.writerWords, ['Glazeword', 'MARK-WORD']);
    assert.deepEqual(out.failed, []);
    // A word this device has in another case stays as it is; the backup's others go ahead of this device's own.
    assert.deepEqual(b.store.writerWords, ['MARK-WORD', 'Local', 'glazeword']);
    assert.deepEqual(b.store[SOURCES].sources.map((x) => x.title), ['Local source', 'MARK-SOURCE']);
    assert.equal(b.store[SOURCES].at, NOW + 5);
    const before = structuredClone(b.store);
    await restore(b, file, ['writerWords', 'sources']);
    assert.deepEqual(b.store, before, 'restoring again changes nothing');
    // The same work saved on both devices is kept once, with this device's id.
    const c = device({ [SOURCES]: { sources: [source('MARK-SOURCE', 's-other-1')], at: NOW } });
    await restore(c, file, ['sources']);
    assert.deepEqual(c.store[SOURCES].sources.map((x) => x.id), ['s-other-1']);
    c.stop();
  } finally { a.stop(); b.stop(); }
  for (const [what, local] of [
    ['', { writerWords: ['ok'] }],
    ['a word that is no string', { writerWords: ['ok', 5] }],
    ['a word too long for the dictionary', { writerWords: ['x'.repeat(61)] }],
    ['a source key no box has', { 'writer:sources:nope': { sources: [], at: NOW } }],
    ['a source that is no source', { [SOURCES]: { sources: [{ id: 's-bad-1', type: 'book' }], at: NOW } }],
    ['a source list without its time', { [SOURCES]: { sources: [source('T', 's-bad-2')] } }],
  ]) {
    const entries = B.pack({ settings: SETTINGS, tasks: { tasks: {}, pets: {} }, local: {}, version: '9.9.9' });
    const manifest = JSON.parse(new TextDecoder().decode(entries[0].data));
    if (local.writerWords) manifest.writerWords = local.writerWords; else manifest.sources = local;
    entries[0].data = new TextEncoder().encode(JSON.stringify(manifest));
    assert.equal(await reasonOf(B.read(await zipFile(entries))), what ? 'bad' : 'read', what);
  }
});

test('a backup of every category comes back whole on a new device', async () => {
  const a = await seeded(), b = device();
  try {
    const file = await backUp(a);
    const { plan, out } = await restore(b, file);
    assert.equal(plan.kind, 'backup');
    assert.deepEqual(B.CATS.filter((k) => k in plan.cats), B.CATS, 'the restore list offers every category');
    assert.deepEqual(plan.cats.notes.map((n) => [n.account, n.count]), [[ACCOUNT, 1]]);
    assert.deepEqual(out.failed, []);
    assert.equal(b.store[`notes:${SITE}/5`].text, 'MARK-DASHBOARD-NOTE');
    assert.equal(b.store[`gpaTerms:${SITE}:5`].t[0].n, 'MARK-PAST-TERM');
    const course = b.store[`classes:${SITE}/5`].courses[0];
    assert.equal(course.name, 'MARK-SCHEDULE');
    assert.equal(course.periods[0].tz, 'America/New_York', 'a period keeps the zone it was saved in');
    assert.equal(b.store.widgetLayout.music, 'https://open.spotify.com/playlist/MARKplaylist0000000000');
    assert.equal(b.store.lookFavorites[0].name, 'MARK-FAVORITE');
    assert.deepEqual(b.keys, [SHARE_KEY]);
    // The settings go to the settings restore, with their tasks; favorites are this device's own record.
    assert.equal(b.settings.length, 1);
    assert.equal(b.settings[0].favorites, undefined);
    assert.equal(b.settings[0].tasks[`todo:${SITE}/5`].tasks[0].title, 'MARK-TASK');
    // Notes: the note, its body and its picture.
    const idx = N.clean(b.store[ACCOUNT]);
    assert.equal(idx.notes[id(1)].title, 'MARK-NOTE');
    assert.match((await b.notes({ op: 'load', id: id(1) })).html, /MARK-NOTE-BODY/);
    const pic = await b.notes({ op: 'getFile', id: id(9) });
    assert.deepEqual(N.unb64(pic.data), PNG);
    // Only these categories: nothing Glaze read from the school.
    const raw = JSON.parse(await (await unzipped(file)).text(B.MANIFEST));
    assert.deepEqual(Object.keys(raw).sort(), ['classes', 'dashNotes', 'format', 'glaze', 'gpa', 'made', 'notes', 'papers', 'settings', 'sources', 'tasks', 'version', 'widgets', 'writerWords']);
  } finally { a.stop(); b.stop(); }
});
const unzipped = async (file) => require('../lib/doctext.js').unzip(file.bytes);

test('a course\'s saved or gallery Look comes back with the settings, in its own synced item beside the built-in ones', async () => {
  const a = device(), b = device();
  try {
    const kept = 'c:0123456789abcd';
    const mine = D.GZ_SANITIZE({ courses: { looks: { _1_1: 'Library' } }, courseLooks: { _2_1: kept } });
    const { out } = await restore(b, await backUp(a, { ...SETTINGS, ...mine }));
    assert.deepEqual(out.failed, []);
    const back = D.GZ_SANITIZE(b.settings.at(-1));
    assert.deepEqual([back.courses.looks, back.courseLooks], [{ _1_1: 'Library' }, { _2_1: kept }]);
    assert.equal(D.GZ_COURSE_LOOK_ID(back, '_2_1', [{ id: kept }]), kept);
  } finally { a.stop(); b.stop(); }
});

test('restoring again is a no-op, and a newer record here stays', async () => {
  const a = await seeded(), b = device();
  try {
    const file = await backUp(a);
    await restore(b, file);
    b.store[`notes:${SITE}/5`] = { text: 'typed here later', at: NOW + 5000 };
    const before = structuredClone(b.store);
    const { out } = await restore(b, file, ['dashNotes', 'classes', 'gpa', 'notes']);
    assert.deepEqual(out.failed, []);
    assert.equal(out.skipped, 1, 'the note already here is skipped');
    assert.deepEqual(b.store, before);
  } finally { a.stop(); b.stop(); }
});

test('a Notes folder renamed after one restore is renamed by the next', async () => {
  const a = await seeded(), b = device(), folder = id(20);
  try {
    await a.notes({ op: 'folder', id: folder, name: 'Old folder' }, NOW + 10);
    await a.notes({ op: 'meta', id: id(1), folder, at: NOW + 20 }, NOW + 20);
    await restore(b, await backUp(a));
    assert.equal(b.store[ACCOUNT].folders[folder].name, 'Old folder');
    await a.notes({ op: 'folder', id: folder, name: 'Renamed folder', at: NOW + 30 }, NOW + 30);
    const { out } = await restore(b, await backUp(a));
    assert.deepEqual(out.failed, []);
    assert.equal(b.store[ACCOUNT].folders[folder].name, 'Renamed folder');
    assert.equal(b.store[ACCOUNT].notes[id(1)].folder, folder);
  } finally { a.stop(); b.stop(); }
});

test('a Notes folder added and moved first after one restore is first after the next', async () => {
  const a = await seeded(), b = device(), first = id(20), added = id(21);
  try {
    await a.notes({ op: 'folder', id: first, name: 'First' }, NOW + 10);
    await restore(b, await backUp(a));
    await a.notes({ op: 'folder', id: added, name: 'Added' }, NOW + 20);
    await a.notes({ op: 'order', ids: [added, first], at: NOW + 30 }, NOW + 30);
    const { out } = await restore(b, await backUp(a));
    assert.deepEqual(out.failed, []);
    assert.deepEqual(N.folderList(N.clean(b.store[ACCOUNT])).map(([k]) => k), [added, first]);
  } finally { a.stop(); b.stop(); }
});

test('an unticked category is left as it is', async () => {
  const a = await seeded();
  const mine = { [`notes:${SITE}/5`]: { text: 'mine', at: NOW - 9000 }, [`classes:${SITE}/5`]: { courses: [], cleared: 0, gone: {}, tz: '' }, lookFavorites: [] };
  for (const off of B.CATS) {
    const b = device(mine);
    try {
      const { out } = await restore(b, await backUp(a), B.CATS.filter((k) => k !== off));
      assert.deepEqual(out.failed, [], off);
      if (off === 'dashNotes') assert.equal(b.store[`notes:${SITE}/5`].text, 'mine');
      if (off === 'classes') assert.deepEqual(b.store[`classes:${SITE}/5`], mine[`classes:${SITE}/5`]);
      if (off === 'gpa') assert.equal(b.store[`gpaTerms:${SITE}:5`], undefined);
      if (off === 'papers') assert.equal(b.store['writerPaper:bb.school.test|_900_1|_101_1|_7_1'], undefined);
      if (off === 'writerWords') assert.equal(b.store.writerWords, undefined);
      if (off === 'sources') assert.equal(b.store[SOURCES], undefined);
      if (off === 'widgets') assert.equal(b.store.widgetLayout, undefined);
      if (off === 'settings') { assert.deepEqual(b.settings, []); assert.deepEqual(b.store.lookFavorites, []); }
      // Tasks without the settings still come back, through the worker's own record write, with nothing of the settings.
      if (off === 'settings') assert.equal(b.store[`todo:${SITE}/5`].tasks[0].title, 'MARK-TASK');
      if (off === 'tasks') assert.equal(b.settings[0].tasks, undefined);
      if (off === 'notes') { assert.equal(b.store[ACCOUNT], undefined); assert.ok(!b.sent.some((op) => op.startsWith('notes'))); }
      if (off === 'shareKeys') { assert.deepEqual(b.keys, []); assert.ok(!b.sent.includes('importKeys')); }
    } finally { b.stop(); }
  }
  a.stop();
});

test('share keys are restored only when ticked', async () => {
  const a = await seeded(), b = device();
  try {
    const file = await backUp(a);
    await restore(b, file, ['settings']);
    assert.deepEqual(b.keys, []);
    await restore(b, file, ['shareKeys']);
    assert.deepEqual(b.keys, [SHARE_KEY]);
  } finally { a.stop(); b.stop(); }
});

test('a damaged, partial or foreign file is refused before anything changes', async () => {
  const a = await seeded();
  const good = await backUp(a);
  const z = await unzipped(good);
  const entries = async (edit) => {
    const out = [];
    for (const name of z.names) { const e = edit(name, await z.bytes(name)); if (e) out.push(e); }
    return zipFile(out);
  };
  const files = {
    truncated: { ...good, size: 200, arrayBuffer: async () => good.bytes.slice(0, 200).buffer },
    'missing picture': await entries((name, data) => (/files\//.test(name) ? null : { name, data })),
    'wrong picture size': await entries((name, data) => ({ name, data: /files\//.test(name) ? data.slice(1) : data })),
    'foreign key': await entries((name, data) => ({ name, data: name === B.MANIFEST ? new TextEncoder().encode(new TextDecoder().decode(data).replace(`"notes:${SITE}/5"`, '"notes:javascript:1"')) : data })),
    'not a zip': { name: 'x.zip', size: 4, type: 'application/zip', arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer },
  };
  for (const [what, file] of Object.entries(files)) {
    const b = device({ [`notes:${SITE}/5`]: { text: 'mine', at: 1 } }), before = structuredClone(b.store);
    try {
      assert.equal(await reasonOf(B.read(file)), 'bad', what);
      assert.deepEqual(b.store, before);
    } finally { b.stop(); }
  }
  assert.equal(await reasonOf(B.read(jsonFile('{"colors": '))), 'json');
  assert.equal(await reasonOf(B.read(jsonFile({ hello: 1 }))), 'none');
  const newer = await zipFile([{ name: B.MANIFEST, data: new TextEncoder().encode(JSON.stringify({ format: B.FORMAT, version: B.VERSION + 1 })) }]);
  assert.equal(await reasonOf(B.read(newer)), 'newer');
  a.stop();
});

test("when the worker refuses this device's records, nothing else is applied", async () => {
  const a = await seeded(), b = device();
  try {
    const plan = await B.read(await backUp(a));
    const io = { ...ioFor(b), own: async () => ({ ok: false }), send: b.send, settings: async (raw) => { b.settings.push(raw); return { ok: true }; } };
    const out = await B.restore(plan, new Set(B.CATS), io);
    assert.equal(out.changed, false);
    assert.deepEqual(out.failed, B.CATS);
    assert.deepEqual(b.settings, []);
    assert.deepEqual(b.sent, []);
  } finally { a.stop(); b.stop(); }
});

test("the worker writes nothing when any record is not its store's", async () => {
  const b = device({ [`notes:${SITE}/5`]: { text: 'mine', at: 1 } }), before = structuredClone(b.store);
  try {
    for (const r of [
      { dashNotes: { [`notes:${SITE}/6`]: { text: 'ok', at: 2 }, 'todo:x': { text: 'no', at: 2 } } },
      { classes: { [`classes:${SITE}/5`]: 'not a record' } },
      { notes: ['notesIdx:javascript:alert(1)/5'] },
      { widgets: [] },
      { other: {} },
      null,
    ]) assert.deepEqual(await B.apply(r, { local: b.local }), { ok: false, error: 'bad' }, JSON.stringify(r));
    assert.deepEqual(b.store, before);
  } finally { b.stop(); }
});

test('keys that reach a prototype are refused, anywhere in the file', async () => {
  const settings = JSON.stringify({ ...SETTINGS, tasks: {} });
  for (const evil of [
    settings.replace('{', '{"__proto__":{"polluted":1},'),
    settings.replace('"colors":{', '"colors":{"constructor":{"prototype":{"polluted":1}},'),
  ]) assert.equal(await reasonOf(B.read(jsonFile(evil))), 'bad');
  const manifest = `{"format":"glaze-backup","version":1,"dashNotes":{"__proto__":{"text":"x","at":1}}}`;
  assert.equal(await reasonOf(B.read(await zipFile([{ name: B.MANIFEST, data: new TextEncoder().encode(manifest) }]))), 'bad');
  const keys = '[{"__proto__":{"polluted":1}}]';
  assert.equal(await reasonOf(B.read(await zipFile([{ name: B.MANIFEST, data: new TextEncoder().encode('{"format":"glaze-backup","version":1}') }, { name: B.KEYS, data: new TextEncoder().encode(keys) }]))), 'bad');
  const b = device();
  try { assert.deepEqual(await B.apply({ dashNotes: JSON.parse(`{"__proto__":{"text":"x","at":1}}`) }, { local: b.local }), { ok: false, error: 'bad' }); } finally { b.stop(); }
  assert.equal({}.polluted, undefined);
});

test('an oversized file is refused before it is read', async () => {
  const unread = (name, size, type) => ({ name, size, type, text: async () => assert.fail('read'), arrayBuffer: async () => assert.fail('read') });
  assert.equal(await reasonOf(B.read(unread('glaze-settings.json', B.LIMIT.json + 1, 'application/json'))), 'big');
  assert.equal(await reasonOf(B.read(unread('glaze-backup.zip', B.LIMIT.zip + 1, 'application/zip'))), 'big');
});

test('a settings file from Export settings still restores, showing what it holds', async () => {
  const old = { ...SETTINGS, tasks: { [`todo:${SITE}/5`]: T.clean({ tasks: [{ id: 'k1', title: 'OLD-TASK', at: NOW }] }) }, pets: {}, shareKeys: [SHARE_KEY] };
  const b = device();
  try {
    const { plan, out } = await restore(b, jsonFile(old));
    assert.equal(plan.kind, 'settings');
    assert.deepEqual(Object.keys(plan.cats), ['settings', 'tasks', 'shareKeys']);
    assert.deepEqual(out.failed, []);
    assert.equal(b.settings[0].tasks[`todo:${SITE}/5`].tasks[0].title, 'OLD-TASK');
    assert.equal(b.settings[0].colors.bg, SETTINGS.colors.bg);
    assert.deepEqual(b.keys, [SHARE_KEY]);
    assert.equal(b.own, undefined, "an old settings file needs nothing of the worker's backup write");
    // Without tasks or keys, only the settings are offered.
    assert.deepEqual(Object.keys((await B.read(jsonFile({ ...SETTINGS, tasks: {}, pets: {}, shareKeys: [] }))).cats), ['settings']);
  } finally { b.stop(); }
});

test('a Notes zip from the old Notes backup still restores, into the account picked here', async () => {
  const a = await seeded(), b = device({ [ACCOUNT]: N.clean({}) });
  try {
    const entries = await B.notesOut(ACCOUNT, a.send);
    entries.push({ name: 'share-keys.json', data: new TextEncoder().encode(JSON.stringify(a.keys)) });
    const file = await zipFile(entries, 'glaze-notes.zip');
    const { plan, out } = await restore(b, file, undefined, ACCOUNT);
    assert.equal(plan.kind, 'notes');
    assert.deepEqual(Object.keys(plan.cats), ['notes', 'shareKeys']);
    assert.equal(plan.cats.notes[0].site, SITE);
    assert.deepEqual(out.failed, []);
    assert.equal(N.clean(b.store[ACCOUNT]).notes[id(1)].title, 'MARK-NOTE');
    assert.deepEqual(b.keys, [SHARE_KEY]);
    assert.equal(b.own, undefined, "an old Notes zip needs nothing of the worker's backup write");
    // No account picked: Notes isn't restored, and says so.
    const none = await restore(device(), file, ['notes']);
    assert.deepEqual(none.out.failed, ['notes']);
  } finally { a.stop(); b.stop(); }
});

test('each store joins a backup by its own rules', async () => {
  const k = `classes:${SITE}/5`, g = `gpaTerms:${SITE}:5`;
  const period = { days: [2], start: 600, end: 660, loc: '', from: '', to: '', skip: [] };
  const b = device({
    [k]: { tz: 'Europe/Paris', cleared: 0, gone: { 30: NOW + 50 }, courses: [{ id: '10', name: 'newer here', at: NOW + 100, periods: [period] }, { id: '20', name: 'older here', at: NOW, periods: [period] }] },
    [g]: { t: [{ id: 'aa', n: 'newer here', c: [], at: NOW + 100 }, { id: 'bb', n: 'older here', c: [], at: NOW }], d: { cc: NOW + 100 } },
  });
  try {
    const r = await B.apply({
      classes: { [k]: { tz: 'Asia/Tokyo', courses: [
        { id: '10', name: 'older there', at: NOW, periods: [period] }, { id: '20', name: 'newer there', at: NOW + 10, periods: [period] },
        { id: '30', name: 'deleted here later', at: NOW + 10, periods: [period] }, { id: '40', name: 'new', at: NOW + 10, periods: [period] }] } },
      gpa: { [g]: { t: [{ id: 'aa', n: 'older there', c: [], at: NOW }, { id: 'bb', n: 'newer there', c: [], at: NOW + 10 }, { id: 'cc', n: 'removed here later', c: [], at: NOW + 10 }] } },
    }, { local: b.local });
    assert.deepEqual(r, { ok: true });
    const cls = C.clean(b.store[k]);
    assert.deepEqual(cls.courses.map((c) => [c.id, c.name]), [['10', 'newer here'], ['20', 'newer there'], ['40', 'new']]);
    assert.equal(cls.tz, 'Europe/Paris', "this device's zone stays");
    assert.equal(cls.courses.find((c) => c.id === '40').periods[0].tz, 'Asia/Tokyo', 'a restored period keeps the zone it was saved in');
    assert.equal(cls.courses.find((c) => c.id === '10').periods[0].tz, undefined, "a course kept here isn't touched");
    assert.deepEqual(G.clean(b.store[g]).t.map((t) => [t.id, t.n]), [['aa', 'newer here'], ['bb', 'newer there']]);
  } finally { b.stop(); }
});

test("the backup knows each store by the store's own key", () => {
  assert.equal(B.STORES.dashNotes.source, W.NOTES_KEY.source);
  assert.equal(B.STORES.classes.source, C.STORE_KEY.source);
  assert.equal(B.STORES.gpa.source, G.KEY.source);
  assert.equal(B.ACCOUNT.source, N.KEY.source);
  assert.equal(B.fileName(new Date(2026, 9, 5)), 'glaze-backup-2026-10-05.zip');
});

test('a note too large to restore whole is refused before any category changes', async () => {
  const b = device({ [ACCOUNT]: N.clean({}) });
  try {
    const json = JSON.stringify({ format: 'glaze-notes', version: 1, site: SITE, folders: [], files: [], notes: [{ id: id(1), title: 'Big', html: '<p>x</p>'.repeat(60000) }] });
    const file = await zipFile([{ name: 'notes.json', data: new TextEncoder().encode(json) }], 'glaze-notes.zip');
    assert.equal(await reasonOf(B.read(file)), 'bad');
    assert.deepEqual(b.sent, []);
    assert.equal(N.clean(b.store[ACCOUNT]).notes[id(1)], undefined);
  } finally { b.stop(); }
});

test('invalid share keys are refused before the restore checklist', async () => {
  assert.equal(await reasonOf(B.read(jsonFile({ ...SETTINGS, shareKeys: [{ v: 1, sid: 'broken' }] }))), 'bad');
});

test('invalid Notes entries and pictures are refused whole, not filtered out', async () => {
  for (const edit of [
    (r) => r.notes.push({ id: 'bad', html: '<p>lost</p>' }),
    (r) => r.files.push({ id: id(99), kind: 'image', size: -1, path: 'files/bad.png' }),
  ]) {
    const raw = { format: 'glaze-notes', version: 1, site: SITE, folders: [], notes: [], files: [] };
    edit(raw);
    const f = await zipFile([{ name: 'notes.json', data: new TextEncoder().encode(JSON.stringify(raw)) }]);
    assert.equal(await reasonOf(B.read(f)), 'bad');
  }
  const a = await seeded();
  try {
    const entries = await B.notesOut(ACCOUNT, a.send);
    const picture = entries.find((e) => e.name.startsWith('files/'));
    picture.data = new Uint8Array(picture.data.length);
    assert.equal(await reasonOf(B.read(await zipFile(entries))), 'bad');
  } finally { a.stop(); }
});

test('a backup cannot bind a Notes export to another school', async () => {
  const a = await seeded();
  try {
    const entries = B.pack({ settings: SETTINGS, local: {}, notes: [{ account: ACCOUNT.replace(SITE, 'https://other.test'), entries: await B.notesOut(ACCOUNT, a.send) }] });
    assert.equal(await reasonOf(B.read(await zipFile(entries))), 'bad');
  } finally { a.stop(); }
});

test('ZIP JSON has the same byte limit as a standalone JSON file', async () => {
  const data = new TextEncoder().encode(JSON.stringify({ format: B.FORMAT, version: 1, settings: SETTINGS, padding: 'x'.repeat(B.LIMIT.json) }));
  const f = await zipFile([{ name: B.MANIFEST, data }]);
  assert.equal(await reasonOf(B.read(f)), 'big');
});

test('reading a ZIP uses bounded slices, never the whole file buffer', async () => {
  const f = await zipFile(B.pack({ settings: SETTINGS, local: {} }));
  const blob = new Blob([f.bytes]);
  assert.equal((await B.read({ ...f, slice: (...args) => blob.slice(...args), arrayBuffer: async () => assert.fail('whole ZIP read') })).kind, 'backup');
});

test('a late settings refusal leaves earlier categories untouched', async () => {
  const b = device({ [`notes:${SITE}/5`]: { text: 'original', at: 1 } });
  const plan = { kind: 'backup', cats: { settings: SETTINGS, dashNotes: { [`notes:${SITE}/5`]: { text: 'imported', at: NOW } } } };
  const before = structuredClone(b.store);
  const io = ioFor(b, true);
  try {
    const out = await B.restore(plan, new Set(Object.keys(plan.cats)), io);
    assert.ok(out.failed.length);
    assert.deepEqual(b.store, before);
  } finally { b.stop(); }
});

test('a late Notes capacity refusal discards settings, records and staged note bodies', async () => {
  const a = await seeded(), b = device();
  try {
    const plan = await B.read(await backUp(a));
    const notes = {};
    for (let i = 100; i < 100 + N.LIMIT.notes; i++) notes[id(i)] = { id: id(i), title: 'kept', at: NOW, created: NOW, rev: 1 };
    b.store[ACCOUNT] = N.clean({ notes });
    const before = structuredClone(b.store), dbBefore = await b.idb.scan('bodies', '');
    const out = await B.restore(plan, new Set(B.CATS), ioFor(b));
    assert.equal(out.changed, false);
    assert.ok(out.failed.includes('notes'));
    assert.deepEqual(b.store, before);
    assert.deepEqual(await b.idb.scan('bodies', ''), dbBefore);
    assert.deepEqual(await b.idb.scan('files', ''), []);
    assert.deepEqual(b.keys, []);
    assert.deepEqual(b.settings, []);
  } finally { a.stop(); b.stop(); }
});

test('a failed final write rolls back Notes bytes, keys and all earlier storage writes', async () => {
  for (const at of ['local', 'sync', 'blobs']) {
    const a = await seeded(), b = device({ [`notes:${SITE}/5`]: { text: 'keep', at: 1 } });
    try {
      const plan = await B.read(await backUp(a)), before = structuredClone(b.store);
      const io = ioFor(b), ownSet = b.local.set, ownPut = b.idb.put;
      let failed = false;
      if (at === 'local') b.local.set = async (v) => { if (!failed) { failed = true; return false; } return ownSet(v); };
      if (at === 'blobs') b.idb.put = async (s, k, v) => { if (s === 'blobs' && !failed) { failed = true; throw new Error('disk full'); } return ownPut(s, k, v); };
      // The sync write is the last commit, after all the Notes database and local values.
      if (at === 'sync') b.settings.push = () => { if (!failed) { failed = true; throw new Error('sync quota'); } return 0; };
      const out = await B.restore(plan, new Set(B.CATS), io);
      assert.equal(failed, true, at);
      assert.equal(out.changed, false, at);
      assert.equal(out.undone, true, at);
      assert.deepEqual(b.store, before, at);
      assert.deepEqual(b.keys, [], at);
      for (const s of ['bodies', 'files', 'blobs']) assert.deepEqual(await b.idb.scan(s, ''), [], `${at}: ${s}`);
    } finally { a.stop(); b.stop(); }
  }
});

test('restoring two Notes accounts on the same school keeps their bodies separate', async () => {
  const a = await seeded(), b = device(), other = ACCOUNT.replace('/5', '/6');
  try {
    const first = await B.notesOut(ACCOUNT, a.send);
    const second = first.map((e) => e.name === 'notes.json' ? { ...e, data: new TextEncoder().encode(new TextDecoder().decode(e.data).replaceAll('MARK-NOTE', 'OTHER-NOTE')) } : e);
    const file = await zipFile(B.pack({ settings: SETTINGS, local: {}, notes: [{ account: ACCOUNT, entries: first }, { account: other, entries: second }] }));
    const { out } = await restore(b, file);
    assert.deepEqual(out.failed, []);
    assert.equal(b.store[ACCOUNT].notes[id(1)].title, 'MARK-NOTE');
    assert.equal(b.store[other].notes[id(1)].title, 'OTHER-NOTE');
    assert.match((await b.send('notesRead', { key: other, id: id(1) })).html, /OTHER-NOTE-BODY/);
  } finally { a.stop(); b.stop(); }
});

test('oversized class and GPA lists are refused without losing their last records', async () => {
  const b = device(), period = { days: [1], start: 540, end: 600 };
  const cases = [
    { classes: { [`classes:${SITE}/5`]: { courses: Array.from({ length: C.MAX.courses + 1 }, (_, i) => ({ id: String(i + 1), name: `course ${i}`, at: NOW, periods: [period] })) } } },
    { classes: { [`classes:${SITE}/5`]: { courses: [{ id: '1', name: 'course', at: NOW, periods: Array.from({ length: C.MAX.periods + 1 }, () => period) }] } } },
    { gpa: { [`gpaTerms:${SITE}:5`]: { t: Array.from({ length: 41 }, (_, i) => ({ id: `t${i}`, n: `term ${i}`, c: [], at: NOW })) } } },
  ];
  try {
    for (const r of cases) {
      assert.equal((await B.apply(r, { local: b.local })).ok, false);
      assert.deepEqual(b.store, {});
    }
  } finally { b.stop(); }
});

test('the writer refuses a backup whose manifest cannot be read back whole', () => {
  assert.throws(() => B.pack({ settings: { ...SETTINGS, padding: 'x'.repeat(B.LIMIT.json) }, local: {} }), (e) => e.why === 'big');
});

test('compressed members keep their CRC, declared-size and total-inflation limits', async () => {
  const zlib = require('node:zlib'), name = Buffer.from(B.MANIFEST);
  const raw = Buffer.from(JSON.stringify({ format: B.FORMAT, version: 1, settings: SETTINGS }));
  const data = zlib.deflateRawSync(raw), header = Buffer.alloc(30), central = Buffer.alloc(46), end = Buffer.alloc(22);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(8, 8); header.writeUInt32LE(Z.crc32(raw), 14);
  header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10); central.writeUInt32LE(Z.crc32(raw), 16);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(header.length + name.length + data.length, 16);
  const file = () => { const blob = new Blob([header, name, data, central, name, end]); return { name: 'x.zip', size: blob.size, slice: (...a) => blob.slice(...a) }; };
  assert.equal((await B.read(file())).kind, 'backup');
  central.writeUInt32LE(1, 24); header.writeUInt32LE(1, 22);
  assert.equal(await reasonOf(B.read(file())), 'bad', 'inflation stops at the declared size');
  central.writeUInt32LE(B.LIMIT.json + 1, 24); header.writeUInt32LE(B.LIMIT.json + 1, 22);
  assert.equal(await reasonOf(B.read(file())), 'big', 'oversized JSON is rejected from its directory');
});


test('a Notes backup with an undeclared attachment is refused whole', async () => {
  const raw = { format: 'glaze-notes', version: 1, site: SITE, folders: [], files: [], notes: [{ id: id(1), title: 'Picture', html: `<p><img data-gz-file="${id(9)}" alt="kept"></p>` }] };
  assert.equal(await reasonOf(B.read(await zipFile([{ name: 'notes.json', data: new TextEncoder().encode(JSON.stringify(raw)) }]))), 'bad');
});

for (const [name, extra] of [['Look parts', { parts: { x: { invalid: true } } }], ['pet records', { pets: { wrong: {} } }]]) {
  test(`invalid ${name} are rejected even before categories can be unticked`, async () => {
    assert.equal(await reasonOf(B.read(jsonFile({ ...SETTINGS, ...extra }))), 'bad');
    const settings = { ...SETTINGS, ...(extra.parts && { parts: extra.parts }) };
    const file = await zipFile(B.pack({ settings, local: {}, ...(extra.pets && { tasks: { tasks: {}, pets: extra.pets } }) }));
    assert.equal(await reasonOf(B.read(file)), 'bad');
  });
}


test('Back up carries assignment source host keys, ports and local document keys', async () => {
  const paper = { school: 'bb.school.test:8443', user: '_900_1', course: '_101_1', content: '_7_1' };
  const keys = [SR.keyOf({ paper }), SR.keyOf({ paper: { ...paper, school: 'bb.school.test' } }),
    SR.key({ school: 'local', user: 'local', course: 'papers', item: `doc:${id(1)}` }), SOURCES];
  const local = Object.fromEntries(keys.map((k, n) => [k, { sources: [source(`Source ${n}`, `source-${n}`)], at: NOW }]));
  const a = device(local), b = device();
  try {
    const { plan, out } = await restore(b, await backUp(a), ['sources']);
    assert.deepEqual(Object.keys(plan.cats.sources).sort(), keys.sort());
    assert.deepEqual(out.failed, []);
    for (const k of keys) assert.deepEqual(b.store[k], local[k]);
  } finally { a.stop(); b.stop(); }
});

test('Back up restores discussion, journal and new-message sources under each student and course', async () => {
  const C = require('../lib/writer-context-discussion.js');
  const keys = [];
  for (const uid of ['_42_1', '_43_1']) for (const cid of ['_101_1', '_102_1']) {
    for (const [kind, path] of [['reply', `/ultra/courses/${cid}/outline/discussion/_9_1`], ['journal', `/ultra/courses/${cid}/outline/journal/_12_1`], ['message', '/ultra/messages/create']]) {
      keys.push(SR.keyOf(C.contextOf({ kind, school: 'bb.school.test:8443', user: { id: uid }, course: { id: cid }, item: C.itemOf(kind, C.route(path, `?courseId=${cid}`)) })));
    }
  }
  assert.equal(new Set(keys).size, 12);
  const local = Object.fromEntries(keys.map((k, n) => [k, { sources: [source(`Compose source ${n}`, `compose-${n}`)], at: NOW }]));
  const a = device(local), b = device();
  try {
    const { plan, out } = await restore(b, await backUp(a), ['sources']);
    assert.deepEqual(plan.cats.sources, local);
    assert.deepEqual(out.failed, []);
    for (const key of keys) assert.deepEqual(b.store[key], local[key]);
  } finally { a.stop(); b.stop(); }
});


// Spreadsheets, PDFs and slide decks back up with papers: a spreadsheet's record with its bands, a PDF's or deck's with its
// file, each one's versions by kind.
const kinds = async (dev, clock = { t: NOW }) => {
  const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js'), zlib = require('node:zlib');
  const P = PA.open(dev.local, () => ++clock.t);
  const sheet = `doc:${id(81)}`, pdf = `doc:${id(82)}`, deck = `doc:${id(83)}`;
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ sheets: [{ id: 1, rows: [[0, [[0, 'n', 42]]]] }] }))).toString('base64');
  const grid = [['42', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', '']];
  await P.save(sheet, { kind: 'sheet', doc: null, book: { sheets: [{ id: 1, name: 'Lab' }], active: 0 }, grid, text: 'MARK-SHEET 42', cells: 2, sheets: 1, title: 'MARK-SHEET', named: true },
    { parts: { '1:0': { rows: [[0, [[0, 'n', 42]]]] }, '1:3': { rows: [[3000, [[1, 's', 'MARK-BAND']]]] } }, changed: true, version: { reason: 'auto', gz, cells: 2 } });
  // The PDF was an assignment's paper first: its import kept that paper as a version.
  await P.save(pdf, { doc: SC.parse(SC.paper, '<p>MARK-PAPER-BEFORE</p>').toJSON() });
  await P.save(pdf, { kind: 'pdf', doc: null, words: 0, file: 'JVBERi0xLjQK', size: 9, pages: 1, thumb: 'data:image/png;base64,iVBORw0KGgo=', title: 'MARK-PDF', named: true }, { reason: 'import' });
  await P.save(deck, { kind: 'slides', doc: null, file: 'UEsDBBQAAAAI', size: 9, ext: '.pptx', slides: 2, text: 'MARK-DECK', words: 1, title: 'MARK-DECK', named: true }, { reason: 'import' });
  // A deck brought again over it: the first one kept as a version.
  await P.save(deck, { kind: 'slides', doc: null, file: 'UEsDBBQAAAAJ', size: 9, ext: '.ppsx', slides: 3, text: 'MARK-DECK-2', words: 1 }, { reason: 'import' });
  return { P, sheet, pdf, deck };
};

test('Back up keeps spreadsheets with their bands, PDFs and decks with their files, and each one\'s versions', async () => {
  const a = device(), b = device();
  try {
    const { sheet, pdf, deck } = await kinds(a);
    const file = await backUp(a);
    const { plan, out } = await restore(b, file, ['papers']);
    assert.deepEqual(out.failed, []);
    for (const k of [sheet, pdf, deck]) {
      const { partDrops, ...rec } = a.store[`writerPaper:${k}`];
      assert.deepEqual(b.store[`writerPaper:${k}`], rec, `${k}'s record (a spreadsheet's cleanup names stay behind)`);
      assert.equal(JSON.stringify(b.store[`writerVersions:${k}`]), JSON.stringify(a.store[`writerVersions:${k}`]), `${k}'s versions`);
    }
    for (const band of ['1:0', '1:3']) assert.deepEqual(b.store[`writerSheet:${sheet}:${band}`], a.store[`writerSheet:${sheet}:${band}`], `band ${band}`);
    assert.equal(b.store[`writerSheet:${sheet}:1:3`].rows[0][1][0][2], 'MARK-BAND');
    assert.deepEqual(b.store.writerPapers.map((r) => [r.key, r.kind]).sort(), a.store.writerPapers.map((r) => [r.key, r.kind]).sort(), 'the Documents index lists them');
    assert.equal(b.store.writerPapers.find((r) => r.key === sheet).grid[0][0], '42', 'the card\'s glance');
    assert.ok(a.store[`writerVersions:${pdf}`].some((v) => v.kind === 'paper' && JSON.stringify(v.doc).includes('MARK-PAPER-BEFORE')), 'the paper the PDF replaced is a version');
    assert.ok(!Object.keys(plan.cats.papers).some((k) => k.startsWith('writerSheet:')), 'bands travel inside their spreadsheet\'s record');
    // A deck's earlier file, kept as a version, comes back as the deck.
    const first = b.store[`writerVersions:${deck}`].find((v) => v.kind === 'slides' && v.file === 'UEsDBBQAAAAI');
    assert.ok(first, 'the first deck is a version');
    const back = await require('../lib/writer-papers.js').open(b.local).restore(deck, first.id);
    assert.deepEqual([back.paper.kind, back.paper.file, back.paper.ext, back.paper.slides], ['slides', 'UEsDBBQAAAAI', '.pptx', 2]);
    // A stale band (a cleanup the worker hadn't finished) stays out.
    a.store[`writerSheet:${sheet}:1:9`] = { rows: [], rev: 1 };
    const again = await B.read(await backUp(a));
    assert.deepEqual(Object.keys(again.cats.papers[`writerPaper:${sheet}`].$parts).sort(), ['1:0', '1:3']);
  } finally { a.stop(); b.stop(); }
});

test('a spreadsheet already on this device stays as it is; its history joins the backup\'s', async () => {
  const a = device(), b = device();
  try {
    const { sheet } = await kinds(a);
    const file = await backUp(a);
    const PA = require('../lib/writer-papers.js');
    const here = PA.open(b.local, () => NOW + 1e6);
    await here.save(sheet, { kind: 'sheet', doc: null, text: 'MINE', cells: 1, sheets: 1 }, { parts: { '1:0': { rows: [[0, [[0, 's', 'MINE']]]] } }, changed: true });
    const before = structuredClone(b.store[`writerPaper:${sheet}`]);
    const { out } = await restore(b, file, ['papers']);
    assert.deepEqual(out.failed, []);
    assert.deepEqual(b.store[`writerPaper:${sheet}`], before, 'the record here is untouched');
    assert.equal(b.store[`writerSheet:${sheet}:1:0`].rows[0][1][0][2], 'MINE', 'its band is untouched');
    assert.equal(b.store[`writerSheet:${sheet}:1:3`], undefined, 'no band of the backup\'s joins it');
    assert.deepEqual(b.store[`writerVersions:${sheet}`].map((v) => v.id), a.store[`writerVersions:${sheet}`].map((v) => v.id), 'the backup\'s versions join');
  } finally { a.stop(); b.stop(); }
});

test('a newer PDF in a backup replaces the paper here, which is kept as a version', async () => {
  const a = device(), b = device();
  try {
    const { pdf } = await kinds(a, { t: NOW + 5e6 });
    const PA = require('../lib/writer-papers.js'), SC = require('../lib/writer-schema.js');
    await PA.open(b.local, () => NOW).save(pdf, { doc: SC.parse(SC.paper, '<p>MARK-HERE</p>').toJSON() });
    const { out } = await restore(b, await backUp(a), ['papers']);
    assert.deepEqual(out.failed, []);
    const rec = b.store[`writerPaper:${pdf}`];
    assert.equal(rec.kind, 'pdf');
    assert.equal(rec.file, 'JVBERi0xLjQK');
    assert.ok(b.store[`writerVersions:${pdf}`].some((v) => (v.kind || 'paper') === 'paper' && JSON.stringify(v.doc).includes('MARK-HERE')), 'what it replaced is a version');
  } finally { a.stop(); b.stop(); }
});

test('a kind this build does not know stays out, and a damaged spreadsheet or file refuses the backup', async () => {
  const later = `doc:${id(84)}`, paper = `doc:${id(85)}`;
  const SC = require('../lib/writer-schema.js'), doc = SC.parse(SC.paper, '<p>MARK-KEPT</p>').toJSON();
  const local = { [`writerPaper:${later}`]: { key: later, kind: 'board', updated: NOW, doc: null }, [`writerVersions:${later}`]: [{ id: 'v1', at: NOW, kind: 'board' }],
    [`writerPaper:${paper}`]: { key: paper, doc, updated: NOW, revision: 1 } };
  const plan = await B.read(await zipFile(B.pack({ settings: SETTINGS, tasks: {}, local })));
  assert.deepEqual(Object.keys(plan.cats.papers), [`writerPaper:${paper}`]);
  const a = device();
  try {
    const { sheet, pdf } = await kinds(a);
    const tamper = async (key, fn) => {
      const entries = B.pack({ settings: SETTINGS, tasks: {}, local: structuredClone(a.store) });
      const m = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === B.MANIFEST).data));
      const row = m.papers.find((r) => r.key === key), e = entries.find((x) => x.name === row.file);
      e.data = new TextEncoder().encode(JSON.stringify(fn(JSON.parse(new TextDecoder().decode(e.data)))));
      return reasonOf(B.read(await zipFile(entries)));
    };
    assert.equal(await tamper(`writerPaper:${sheet}`, (r) => r), 'read');
    assert.equal(await tamper(`writerPaper:${sheet}`, (r) => ({ ...r, $parts: { ...r.$parts, '1:3': { ...r.$parts['1:3'], rev: 99 } } })), 'bad', 'a band from another write');
    assert.equal(await tamper(`writerPaper:${sheet}`, (r) => { const { '1:3': _, ...rest } = r.$parts; return { ...r, $parts: rest }; }), 'bad', 'a band missing');
    assert.equal(await tamper(`writerPaper:${pdf}`, (r) => ({ ...r, file: 'not base64!' })), 'bad', 'a file that is no base64');
    assert.equal(await tamper(`writerPaper:${pdf}`, (r) => ({ ...r, thumb: 'javascript:alert(1)' })), 'bad', 'a picture that is no picture');
    assert.equal(await tamper(`writerPaper:${pdf}`, (r) => ({ ...r, $parts: {} })), 'bad', 'bands on a file kind');
  } finally { a.stop(); }
});

test('the kinds a backup keeps are the Documents home\'s', () => {
  assert.deepEqual([...B.KINDS].sort(), Object.keys(require('../lib/doc-kinds.js').KINDS).sort());
});
