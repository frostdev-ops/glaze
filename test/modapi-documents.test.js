// Mods on the Documents page (papers.html): the documents and documents.read permissions, the cleaners for what a mod
// hands the page (lib/modapi.js), the broker's documents calls and where each call runs (lib/modbroker.js), the worker's
// sender check for the page (lib/background.js fromDocuments), install-time permission rules (lib/modbundle.js) and the
// install prompt's words (lib/editor-mods.js). The page side is scripts/documents-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const A = require('../lib/modapi.js');
const B = require('../lib/modbroker.js');
const M = require('../lib/modbundle.js');
const E = require('../lib/editor-mods.js');

const ID = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567', SITE = 'https://school.instructure.com';
const flush = () => new Promise(setImmediate);
const rec = (perms = ['documents', 'documents.read'], over = {}) => ({
  id: ID, enabled: true, hash: 'h1', key: 'k1', version: '1.0.0', source: 'file', installedAt: 1, dev: false,
  manifest: { glaze: 1, name: 'Doc Tools', hooks: 'hooks.js', permissions: perms.map((id) => ({ id, why: 'w' })) },
  grants: Object.fromEntries(perms.map((p) => [p, true])), files: { 'hooks.js': Buffer.from('glaze.ready').toString('base64') }, ...over,
});
const area = (data = {}) => ({
  data,
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await flush(); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await flush(); for (const x of [].concat(k)) delete data[x]; return true; },
});
const env = ({ site = 'documents', record = rec(), local = {} } = {}) => {
  const l = area({ [`mod:${ID}`]: record, mods: [ID], ...local });
  let turn = Promise.resolve();
  return { site, local: l, sync: area({}), fetch: async () => { throw new Error('no fetch'); }, reach: async () => true, queue: (f) => (turn = turn.then(f, f)),
    keys: async () => Object.keys(l.data), record: async (id) => (await l.get(`mod:${id}`))[`mod:${id}`], blocklist: async () => null, account: async () => null };
};
const call = (e, name, args = [], via = 'worker') => B.handle({ mod: ID, call: name, args, via }, e);

test('cleaners: items in the two slots, a key\'s shape, a format, the --gd-* hooks in range', () => {
  assert.deepEqual(A.docItem('documents.toolbar', { id: 'count', label: 'Count words' }), { slot: 'documents.toolbar', id: 'count', label: 'Count words' });
  assert.deepEqual(A.docItem('documents.card', { id: 'peek', label: '  Peek‮ ' }), { slot: 'documents.card', id: 'peek', label: 'Peek' });
  for (const [slot, item] of [['documents.nav', { id: 'a', label: 'A' }], ['toolbar', { id: 'a', label: 'A' }], ['documents.card', { id: 'A', label: 'A' }], ['documents.card', { id: 'a', label: '' }],
    ['documents.card', { id: 'a', label: 'x'.repeat(41) }], ['documents.card', { id: 'a', label: 'A', run: 1 }], ['documents.card', { label: 'A' }], ['documents.card', null]]) assert.equal(A.docItem(slot, item), null, `${slot} ${JSON.stringify(item)}`);
  assert.deepEqual(A.docSlot('documents.card', 'peek'), { slot: 'documents.card', id: 'peek' });
  assert.equal(A.docSlot('documents.card', 'Peek'), null);
  for (const k of ['doc:4b6f7d1e-3a51-4a5e-9a51-0e3c0c6f5f10', 'bb.school.test|_900_1|_101_1|_7_1']) assert.equal(A.docKey(k), k);
  for (const k of ['', ' doc:x', 'a\nb', 'x'.repeat(321), 7, null, {}]) assert.equal(A.docKey(k), null, String(k));
  assert.deepEqual(A.docCreate({}), { format: 'plain' });
  assert.deepEqual(A.docCreate({ format: 'apa7' }), { format: 'apa7' });
  for (const v of [{ format: 'ieee' }, { format: 'apa7', title: 'x' }, null, []]) assert.equal(A.docCreate(v), null, JSON.stringify(v));
  assert.deepEqual(A.DOC_FORMATS.slice().sort(), require('../lib/writer-styles.js').IDS.slice().sort(), 'the formats are Writer\'s');
  assert.deepEqual(A.docStyle({ radius: 24, column: 300 }), { radius: 24, column: 300 });
  assert.deepEqual(A.docStyle({ glass: 0, thumb: 1.6 }), { glass: 0, thumb: 1.6 });
  for (const v of [{}, { radius: 33 }, { radius: '24px' }, { thumb: 0.5 }, { column: 159 }, { glass: -1 }, { opacity: 50 }, null]) assert.equal(A.docStyle(v), null, JSON.stringify(v));
});

test('the documents calls need documents (or documents.read for text and files), in a Worker, on the Documents page', async () => {
  const e = env();
  assert.deepEqual(await call(e, 'documents.list'), { ok: true, value: true }, 'the page fills in the list');
  assert.deepEqual(await call(e, 'documents.open', ['doc:4b6f7d1e-3a51-4a5e-9a51-0e3c0c6f5f10']), { ok: true, value: { key: 'doc:4b6f7d1e-3a51-4a5e-9a51-0e3c0c6f5f10' } });
  assert.deepEqual(await call(e, 'documents.create', [{ format: 'mla9' }]), { ok: true, value: { format: 'mla9' } });
  assert.deepEqual(await call(e, 'documents.create'), { ok: true, value: { format: 'plain' } });
  assert.deepEqual(await call(e, 'documents.read', ['doc:x']), { ok: true, value: { key: 'doc:x' } });
  assert.deepEqual(await call(e, 'documents.export', ['doc:x']), { ok: true, value: { key: 'doc:x' } });
  assert.deepEqual(await call(e, 'documents.add', ['documents.card', { id: 'peek', label: 'Peek' }]), { ok: true, value: { slot: 'documents.card', id: 'peek', label: 'Peek' } });
  assert.deepEqual(await call(e, 'documents.remove', ['documents.card', 'peek']), { ok: true, value: { slot: 'documents.card', id: 'peek' } });
  assert.deepEqual(await call(e, 'documents.style', [{ radius: 20 }]), { ok: true, value: { radius: 20 } });
  assert.deepEqual(await call(e, 'documents.style', [null]), { ok: true, value: null });
  for (const [name, args] of [['documents.open', ['a b']], ['documents.create', [{ format: 'ieee' }]], ['documents.add', ['documents.nav', { id: 'a', label: 'A' }]], ['documents.remove', ['documents.card', 'A']], ['documents.style', [{ radius: 99 }]], ['documents.read', [7]]]) {
    assert.deepEqual(await call(e, name, args), { ok: false, error: 'args' }, name);
  }
  assert.equal(e.local.data[`modPrivate:${ID}`], true, 'a documents mod is marked as holding personal data');
  // Text and files need documents.read; nothing needs less than documents; and only a Worker gets any of it.
  const listOnly = env({ record: rec(['documents']) });
  assert.deepEqual(await call(listOnly, 'documents.read', ['doc:x']), { ok: false, error: 'permission' });
  assert.deepEqual(await call(listOnly, 'documents.export', ['doc:x']), { ok: false, error: 'permission' });
  assert.equal((await call(listOnly, 'documents.list')).ok, true);
  const declaredOnly = env({ record: rec(['documents', 'documents.read'], { grants: { documents: true, 'documents.read': false } }) });
  assert.deepEqual(await call(declaredOnly, 'documents.export', ['doc:x']), { ok: false, error: 'permission' }, 'declared but not granted');
  for (const name of ['documents.list', 'documents.add']) assert.deepEqual(await call(e, name, name === 'documents.add' ? ['documents.card', { id: 'a', label: 'A' }] : [], 'frame:tile:a'), { ok: false, error: 'permission' }, `${name} from a frame`);
});

test('where a call runs: documents calls only on the Documents page, school-page calls only on a school page', async () => {
  const lms = env({ site: SITE, record: rec(['documents', 'documents.read', 'todo', 'courses']) });
  for (const name of ['documents.list', 'documents.open', 'documents.add', 'documents.style']) assert.deepEqual(await call(lms, name, ['x']), { ok: false, error: 'call' }, `${name} on a school page`);
  assert.equal((await call(lms, 'todo')).ok, true, 'todo still works on a school page');
  const docs = env({ record: rec(['documents', 'todo', 'courses', 'nav.items']) });
  for (const name of ['todo', 'courses', 'grades', 'schedule', 'fetch', 'ui.render', 'cards.set', 'nav.add', 'nav.model', 'palette.set', 'rules.set', 'look.override', 'effects.play']) {
    assert.deepEqual(await call(docs, name, []), { ok: false, error: 'call' }, `${name} on the Documents page`);
  }
  for (const name of ['theme', 'settings', 'storage.get']) assert.equal((await call(docs, name)).ok, true, `${name} on the Documents page`);
  assert.equal((await call(docs, 'broadcast', [1])).ok, true);
  // A mod without the documents grant has nothing on the Documents page, not even its storage.
  const ungranted = env({ record: rec(['documents'], { grants: { documents: false } }) });
  assert.deepEqual(await call(ungranted, 'theme'), { ok: false, error: 'permission' });
  assert.deepEqual(await call(ungranted, 'storage.get'), { ok: false, error: 'permission' });
});

test('the Documents page starts only the Workers of mods granted documents, with no slots, and asks for nothing else', async () => {
  const other = rec(['todo'], { id: OTHER, manifest: { glaze: 1, name: 'Tile', hooks: 'hooks.js', permissions: [{ id: 'todo', why: 'w' }], ui: { tiles: [{ id: 't', name: 'T', sizes: ['s'] }] } } });
  const withTile = rec(['documents'], { manifest: { glaze: 1, name: 'Doc Tools', hooks: 'hooks.js', permissions: [{ id: 'documents', why: 'w' }], ui: { tiles: [{ id: 't', name: 'T', sizes: ['s'] }], rail: [{ id: 'r', name: 'R' }], nav: {} } }, replaces: undefined });
  const e = env({ record: withTile, local: { mods: [ID, OTHER], [`mod:${OTHER}`]: other, [`modReplace:${ID}`]: { nav: true } } });
  const got = await B.page({ op: 'list' }, e);
  assert.equal(got.ok, true);
  assert.deepEqual(got.mods.map((m) => m.id), [ID], 'a mod without documents doesn\'t start here');
  assert.deepEqual(got.mods[0].slots, [], 'no tiles, rail or nav on the Documents page');
  assert.deepEqual(got.mods[0].on, []);
  assert.equal(got.mods[0].worker, 'glaze.ready');
  assert.deepEqual(got.mods[0].events, ['documents']);
  assert.deepEqual(got.plain, []);
  // A documents mod without code has nothing to run here.
  const noCode = env({ record: rec(['documents'], { manifest: { glaze: 1, name: 'Doc Tools', permissions: [{ id: 'documents', why: 'w' }] }, files: {} }) });
  assert.deepEqual((await B.page({ op: 'list' }, noCode)).mods, []);
  for (const op of ['parts', 'widget', 'asset', 'packs', 'sticker', 'media']) assert.deepEqual(await B.page({ op, mod: ID, slot: 'x', path: 'a.png', id: 'x', src: 'mod:x/a' }, e), { ok: false, error: 'sender' }, op);
  assert.equal((await B.page({ op: 'stopped', mod: ID, why: 'hung' }, e)).ok, true);
  assert.equal((await B.page({ op: 'runtime', ok: true }, e)).ok, true);
  // On a school page the same mod keeps its slots.
  const lms = await B.page({ op: 'list' }, { ...env({ site: SITE, record: withTile }) });
  assert.deepEqual(lms.mods[0].slots.map((s) => s.key), ['tile:t', 'rail:r', 'nav']);
});

test('the worker\'s sender check: only the Documents page in a tab of its own, top frame, with Glaze on', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
  const mine = src.slice(src.indexOf('const fromDocuments ='), src.indexOf('// Whose plans and grades'));
  const store = { enabled: true };
  const chrome = { runtime: { id: 'glaze', getURL: (p = '') => `chrome-extension://glaze/${p}` }, storage: { sync: { get: async () => ({ ...store }) } } };
  const ctx = vm.createContext({ chrome });
  vm.runInContext(`${mine}\nthis.fromDocuments = fromDocuments;`, ctx);
  const s = (url, over = {}) => ({ id: 'glaze', url, frameId: 0, tab: { id: 1, url }, ...over });
  for (const u of ['chrome-extension://glaze/papers.html', 'chrome-extension://glaze/papers.html?x=1#y']) assert.equal(await ctx.fromDocuments(s(u)), true, u);
  for (const x of [s('chrome-extension://glaze/papers.html?paper=doc:x', { id: 'another' }), s('chrome-extension://glaze/papers.html', { tab: undefined }), s('chrome-extension://glaze/papers.html', { frameId: 2 }),
    s('chrome-extension://glaze/options.html'), s('chrome-extension://other/papers.html'), s('https://school.instructure.com/papers.html'), s('chrome-extension://glaze/papers.htmlx'), { id: 'glaze', frameId: 0, tab: { id: 1 } }]) {
    assert.equal(await ctx.fromDocuments(x), false, `${x.url} ${x.id} ${x.frameId}`);
  }
  store.enabled = false;
  assert.equal(await ctx.fromDocuments(s('chrome-extension://glaze/papers.html')), false, 'Glaze off');
  assert.match(src, /site: preview \? 'editor' : await fromDocuments\(s\) \? 'documents' : await fromLms\(/);
  assert.match(src, /account: \(\) => \(who \|\|= env\.site && !preview && env\.site !== 'documents' \?/, 'the Documents page has no account to read');
});

test('install: documents and documents.read are personal data, and documents.read comes with documents', async () => {
  const u8 = (s) => new TextEncoder().encode(s);
  const key = Buffer.alloc(32, 7).toString('base64url');
  const man = (permissions, files = []) => M.bundle([['mod.json', u8(JSON.stringify({ glaze: 1, name: 'Doc Tools', version: '1.0.0', author: { name: 'Kai', key }, hooks: 'hooks.js', permissions }))], ['hooks.js', u8('glaze.ready')], ...files]);
  assert.ok(await man([{ id: 'documents', why: 'Lists them.' }, { id: 'documents.read', why: 'Counts words.' }]));
  assert.ok(await man([{ id: 'documents', why: 'Lists them.' }]));
  await assert.rejects(man([{ id: 'documents.read', why: 'Counts words.' }]), /permissions\.0\.id/);
  await assert.rejects(man([{ id: 'documents', why: 'x' }, { id: 'documents.write', why: 'x' }]), /permissions\.1\.id/);
  await assert.rejects(man([{ id: 'documents', why: 'x' }], [['tile.html', u8('<p>x</p>')]]), /\bui\b/, 'a documents mod has no page of its own');
  assert.ok(M.DATA.includes('documents') && M.DATA.includes('documents.read'));
  assert.ok(B.CALLS['documents.list'] && !B.CALLS['documents.write']);
});

test('the install prompt says what each asks for, and names documents with a network host', () => {
  const t = (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, n) => v[n]);
  const view = { name: 'Doc Tools', hooks: 'hooks.js', permissions: [{ id: 'documents', why: 'Lists them.' }, { id: 'documents.read', why: 'Counts.' }, { id: 'network:api.example.com', why: 'Sync.' }] };
  const ls = E.lines(view, t);
  assert.equal(ls.find((l) => l.id === 'documents').text, 'Documents — reads the titles, courses and word counts of your documents, opens them and adds items to the Documents page.');
  assert.equal(ls.find((l) => l.id === 'documents.read').text, 'Document text — reads what your documents say and exports them as .docx files.');
  const ws = E.warnings(view, { t, and: (a) => a.join(' and '), signed: true, source: 'gallery', runs: true });
  assert.equal(ws[0].kind, 'data');
  assert.equal(ws[0].text, 'This mod could send your documents and document text to api.example.com.');
});
