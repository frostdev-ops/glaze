// Writer's document tools for agent apps (lib/mcp/writer.js, writer-mcp.js): the student's documents under opaque keys,
// read from Writer's own store in the broker's turn, and the three tools that need the document open in a Writer page,
// through the page's port. Papers are made by lib/writer-papers.js's own save and sources by lib/writer-sources.js's, as
// the editor writes them; the page is the real writer-mcp.js over a ProseMirror state with GZ_WRITER_ISSUES's plugin, and
// the worker is the real lib/background.js with the step's wiring (test/helpers/mcp-writer-wiring.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/mcp/writer.js');
const T = require('../lib/ai/tools.js');
const R = require('../lib/mcp/registry.js');
const CALLS = require('../lib/mcp/calls.js');
const G = require('../lib/mcp/grants.js');
const PA = require('../lib/writer-papers.js');
const SRC = require('../lib/writer-sources.js');
const DH = require('../lib/doc-home.js');
const CITE = require('../lib/writer-cite.js');
const SCHEMA = require('../lib/writer-schema.js');
const ISSUES = require('../lib/writer-issues.js');
const PM = globalThis.GZ_PM;
const worker = require('./helpers/worker-env.cjs');
const { fakeIDB } = require('./helpers/fake-idb.cjs');
const { wired } = require('./helpers/mcp-writer-wiring.cjs');

const root = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-29T15:00:00Z');
const ESSAY = 'bb.school.test|_900_1|_101_1|_7_1', NOTES = 'doc:2f1d3c4b-5a69-4788-9a0b-1c2d3e4f5a6b', OLD = 'doc:0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const TRASH = 'doc:9e8d7c6b-5a49-4382-8170-6f5e4d3c2b1a', SHEET = 'doc:1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e', RECOVERY = 'recovery:5c4b3a29-1807-4f6e-9d8c-7b6a5f4e3d2c';
const PEER = { name: 'node', exe: '/Applications/Claude.app/Contents/MacOS/Claude', ppid: 4242, verified: false };
const until = async (fn, what, ms = 4000) => {
  for (const end = Date.now() + ms; ;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};

// ---- the store, as the editor's saves leave it --------------------------------------------------------------------------
const area = () => {
  const s = {};
  return { s, get: async (k) => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); }, remove: async (k) => { for (const x of [].concat(k)) delete s[x]; } };
};
const paperDoc = (html) => SCHEMA.parse(SCHEMA.paper, html).toJSON();
const ESSAY_HTML = '<p>Alex Rivera</p><p>Dr. Okafor</p><p>ENGL 2110</p><p>12 October 2026</p><h1>Memory in Beloved</h1><p>Sethe remembers the house, and she is definately not alone.</p><h2>The tree</h2><p>Scars like a chokecherry tree.<br>Second line.</p>';
const seed = async () => {
  const a = area();
  let t = NOW - 10 * 3600e3;
  const store = PA.open(a, () => t, { versions: () => 40 });
  const at = async (h, fn) => { t = NOW - h * 3600e3; await fn(); };
  // Each as writer-paper.js saves it: an assignment's paper with its parts, Documents' own, one in Trash, a later kind, and a
  // stand-in for a paper whose key never came.
  await at(9, () => store.save(OLD, { kind: 'paper', doc: paperDoc('<p>An older draft.</p>'), format: 'plain', keep: false, named: false, title: 'An older draft' }));
  await at(8, () => store.save(TRASH, { kind: 'paper', doc: paperDoc('<p>Gone.</p>'), format: 'plain', named: true, title: 'Thrown away' }));
  await at(7.5, () => store.trash(TRASH));
  await at(7, () => store.save(SHEET, { kind: 'sheet', doc: { type: 'doc', content: [] }, named: true, title: 'Budget' }));
  await at(6, () => store.save(RECOVERY, { kind: 'paper', doc: paperDoc('<p>Saved before the key came.</p>'), format: 'mla9', named: false, title: 'Response paper' }));
  await at(3, () => store.save(NOTES, { kind: 'paper', doc: paperDoc('<p>Chapter one, the house on Bluestone Road.</p>'), format: { id: 'custom:wide', base: 'plain', label: 'Wide margins' }, named: true, title: 'Reading notes' }));
  await at(1, () => store.save(ESSAY, { kind: 'paper', doc: paperDoc(ESSAY_HTML), format: 'mla9', keep: false, named: false, title: 'Essay 2: Memory in Beloved',
    due: '2026-11-02T03:59:00.000Z', url: 'https://bb.school.test/ultra/courses/_101_1/cl/outline', courseName: 'ENGL 2110', school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' }));
  const turns = [];
  let last = Promise.resolve();
  const queue = (f) => { const run = last.then(f); last = run.catch(() => {}); return run; };
  return { a, store, turns, queue, papers: (f) => { turns.push(f); return queue(() => f(store)); } };
};
const sessionArea = () => area();
// One registry with the writer tools over a seeded store, a session's salt, and a bridge (default: no page open).
const make = async ({ bridge = async (k, op) => (k === null && op === 'open' ? [] : null), session = sessionArea(), s } = {}) => {
  s ||= await seed();
  const reg = T.registry();
  M.register(reg, { papers: s.papers, bridge, session });
  const run = async (name, args = {}, ctx = {}) => {
    const t = reg.get(name), { document, ...rest } = args;
    return t.run(rest, { local: s.a, now: () => NOW, signal: new AbortController().signal, ...(document !== undefined && { document }), ...ctx });
  };
  return { ...s, reg, run, session };
};
const keyOf = async (env, title) => (await env.run('documents_list')).items.find((i) => i.title === title).key;

// ---- the documents, from storage ----------------------------------------------------------------------------------------
test('the read follows Documents\' flat text, with each heading\'s level, words and offset into it', () => {
  const docs = [ESSAY_HTML, '<h1>Intro</h1><p>One <b>two</b><br>three</p><ul><li>a</li><li>b</li></ul><blockquote><h2>Q</h2><p>quote</p></blockquote><table><tr><td><h3>In a cell</h3></td></tr></table><p></p><p>end</p>',
    '<p></p>', '<h2>Head<br>two lines</h2><p>x</p>', `<h1>${'Long '.repeat(40)}</h1>`];
  for (const html of docs) {
    const doc = paperDoc(html), r = M.read(doc);
    assert.equal(r.text, DH.flat(doc), html);
    for (const h of r.outline) assert.ok(r.text.slice(h.offset).replace(/\n/g, ' ').startsWith(h.text.replace(/…$/, '')), `${h.text} at ${h.offset}`);
  }
  assert.deepEqual(M.read(paperDoc(docs[1])).outline, [{ level: 1, text: 'Intro', offset: 0 }, { level: 2, text: 'Q', offset: 24 }, { level: 3, text: 'In a cell', offset: 32 }]);
  assert.deepEqual(M.read(paperDoc(docs[3])).outline, [{ level: 2, text: 'Head two lines', offset: 0 }]);
  const long = M.read(paperDoc(docs[4])).outline[0].text;
  assert.equal(long.length, M.LIMIT.outline);
  assert.ok(long.endsWith('…'));
  assert.deepEqual(M.read(null), { text: '', outline: [] });
});

test('a list part fits the answer\'s room and says where the next starts; the first item always goes', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ i, pad: 'x'.repeat(90) }));
  const a = M.fit(items, 0, 1000);
  assert.ok(JSON.stringify(a.items).length <= 1000);
  assert.equal(a.total, 50);
  assert.equal(a.next, a.items.length);
  const b = M.fit(items, a.next, 1000);
  assert.equal(b.items[0].i, a.next);
  assert.deepEqual(M.fit(items, 45, 100000), { items: items.slice(45), total: 50, next: null });
  assert.equal(M.fit([{ big: 'y'.repeat(2000) }], 0, 100).items.length, 1);
  assert.deepEqual(M.fit(items, 99, 1000), { items: [], total: 50, next: null });
});

test('the tools as agent apps see them: the writer group, a document to name, and an open editor for three', async () => {
  const env = await make();
  const list = R.list({ tools: env.reg });
  assert.deepEqual(list.map((t) => t.name), ['citation_insert', 'document_assignment', 'document_issues', 'document_read', 'document_sources', 'documents_list', 'fix_apply']);
  for (const t of list) {
    assert.equal(t._meta['io.frostdev.glaze/group'], 'writer');
    assert.ok(t.title && t.description.length <= T.LIMIT.description, t.name);
    assert.equal(Object.hasOwn(t.inputSchema.properties, 'reason'), false);
    const scoped = t.name !== 'documents_list';
    assert.equal(Object.hasOwn(t.inputSchema.properties, 'document'), scoped, t.name);
    assert.equal((t.inputSchema.required || []).includes('document'), scoped, t.name);
  }
  const by = Object.fromEntries(list.map((t) => [t.name, t]));
  assert.deepEqual(['document_issues', 'citation_insert', 'fix_apply'].map((n) => by[n]._meta['io.frostdev.glaze/needs']), ['writer', 'writer', 'writer']);
  assert.equal(by.document_read._meta['io.frostdev.glaze/needs'], undefined);
  for (const n of ['citation_insert', 'fix_apply']) {
    assert.equal(by[n]._meta['io.frostdev.glaze/approval'], 'student');
    assert.deepEqual([by[n].annotations.readOnlyHint, by[n].annotations.idempotentHint], [false, false]);
    assert.equal(typeof env.reg.get(n).summarize, 'function');
  }
  for (const n of ['documents_list', 'document_read', 'document_sources', 'document_assignment', 'document_issues']) assert.equal(by[n].annotations.readOnlyHint, true, n);
  // lib/writer-tools.js's own arguments, which the student's approval names.
  assert.deepEqual(by.fix_apply.inputSchema.required.sort(), ['document', 'issueId', 'suggestion']);
  assert.deepEqual(by.citation_insert.inputSchema.required.sort(), ['document', 'sourceId']);
  assert.throws(() => M.tools({ papers: env.papers }), /papers and bridge/);
});

test('documents_list: the documents out of Trash that Writer reads, the last edited first, under keys that say nothing of the school or student', async () => {
  const env = await make({ bridge: async (k, op) => (k === null && op === 'open' ? [NOTES] : null) });
  const r = await env.run('documents_list');
  assert.deepEqual(r.items.map((i) => i.title), ['Essay 2: Memory in Beloved', 'Reading notes', 'Response paper', 'An older draft']);
  assert.equal(r.at, NOW - 3600e3);
  assert.deepEqual([r.total, r.next], [4, null]);
  const essay = r.items[0];
  assert.deepEqual({ ...essay, key: '' }, { key: '', kind: 'paper', title: 'Essay 2: Memory in Beloved', format: 'mla9', words: essay.words, updated: NOW - 3600e3, course: 'ENGL 2110', assignment: true, submitted: null, open: false });
  assert.ok(essay.words > 10);
  assert.deepEqual(r.items.map((i) => [i.format, i.assignment, i.open]), [['mla9', true, false], ['Wide margins', false, true], ['mla9', false, false], ['plain', false, false]]);
  const text = JSON.stringify(r);
  for (const leak of ['bb.school.test', '_900_1', '_101_1', '_7_1', NOTES, 'doc:', 'recovery:']) assert.ok(!text.includes(leak), leak);
  for (const i of r.items) assert.match(i.key, /^document:[0-9a-f]{32}$/);
  assert.equal(new Set(r.items.map((i) => i.key)).size, 4);
  // Every read of Writer's store went through the papers turn.
  assert.ok(env.turns.length >= 1);
  // The same keys while the session lasts, for a worker started again over it; others in a new session.
  const again = await make({ session: env.session, s: env });
  assert.deepEqual((await again.run('documents_list')).items.map((i) => i.key), r.items.map((i) => i.key));
  assert.match(env.session.s.mcpDocSalt, /^[0-9a-f]{64}$/);
  const fresh = await make({ s: env });
  const other = (await fresh.run('documents_list')).items.map((i) => i.key);
  assert.equal(other.filter((k) => r.items.some((i) => i.key === k)).length, 0);
  // A key from another session names nothing here.
  assert.deepEqual(await fresh.run('document_read', { document: essay.key }), { ok: false, error: 'Glaze has no document by that key on this device. documents_list gives the keys.' });
});

test('documents_list goes a part at a time when the documents don\'t fit one answer', async () => {
  const s = await seed();
  for (let i = 0; i < 120; i++) await s.store.save(`doc:${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`, { kind: 'paper', doc: paperDoc(`<p>Draft ${i}</p>`), format: 'plain', named: true, title: `Draft ${i} ${'of a long title '.repeat(3)}` });
  const env = await make({ s });
  const seen = [];
  let from = 0, parts = 0;
  do {
    const r = await env.run('documents_list', from ? { from } : {});
    assert.ok(JSON.stringify(r).length <= M.LIMIT.answer, `part ${parts}`);
    assert.equal(r.total, 124);
    seen.push(...r.items.map((i) => i.key));
    from = r.next;
    parts++;
  } while (from !== null && parts < 20);
  assert.ok(parts > 1);
  assert.equal(new Set(seen).size, 124);
});

test('document_read: a page of the saved text, its outline, its title and when it was saved; nothing for a key Writer can\'t read', async () => {
  const env = await make();
  const key = await keyOf(env, 'Essay 2: Memory in Beloved');
  const r = await env.run('document_read', { document: key });
  const want = M.read(paperDoc(ESSAY_HTML));
  assert.deepEqual(r, { at: NOW - 3600e3, title: 'Essay 2: Memory in Beloved', page: 1, pages: 1, text: want.text, outlineCut: false, outline: want.outline });
  assert.ok(r.text.includes('definately not alone'));
  assert.deepEqual(r.outline.map((o) => o.text), ['Memory in Beloved', 'The tree']);
  // A long document a page at a time.
  const s = await seed();
  const long = Array.from({ length: 40 }, (_, i) => `<h2>Part ${i}</h2><p>${`Sentence ${i} of a long essay. `.repeat(12)}</p>`).join('');
  await s.store.save(NOTES, { doc: paperDoc(long) });
  const env2 = await make({ s });
  const k2 = await keyOf(env2, 'Reading notes');
  const p1 = await env2.run('document_read', { document: k2 }), p2 = await env2.run('document_read', { document: k2, page: 2 });
  assert.ok(p1.pages > 3);
  assert.ok(p1.text.length <= 3000 && p2.text.length <= 3000);
  assert.equal(p2.page, 2);
  assert.ok(JSON.stringify(p1).length <= M.LIMIT.answer);
  assert.equal((await env2.run('document_read', { document: k2, page: 999 })).page, p1.pages);
  // Unknown, malformed, trashed and kinds Writer can't read: no document.
  const none = { ok: false, error: 'Glaze has no document by that key on this device. documents_list gives the keys.' };
  for (const bad of ['document:00000000000000000000000000000000', 'nope', ESSAY, undefined]) assert.deepEqual(await env.run('document_read', { document: bad }), none, String(bad));
  await env.store.trash(ESSAY);
  assert.deepEqual(await env.run('document_read', { document: key }), none, 'in Trash');
  await env.store.untrash(ESSAY);
  assert.equal((await env.run('document_read', { document: key })).title, 'Essay 2: Memory in Beloved');
  await env.a.set({ [`writerPaper:${ESSAY}`]: { ...(await env.store.get(ESSAY)), kind: 'sheet' } });
  assert.deepEqual(await env.run('document_read', { document: key }), none, 'a kind the record now names');
});

test('a long outline is cut to fit, and the answer says so', async () => {
  const s = await seed();
  await s.store.save(NOTES, { doc: paperDoc(Array.from({ length: 200 }, (_, i) => `<h3>${`Section heading number ${i} `.repeat(4)}</h3>`).join('')) });
  const env = await make({ s });
  const r = await env.run('document_read', { document: await keyOf(env, 'Reading notes') });
  assert.equal(r.outlineCut, true);
  assert.ok(r.outline.length > 10 && r.outline.length < 200);
  assert.ok(JSON.stringify(r).length <= M.LIMIT.answer);
});

test('document_sources: the sources Cite keeps for the document, under the key its editor uses', async () => {
  const env = await make();
  const book = { id: 's-morrison', type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }], issued: { 'date-parts': [[1987]] }, publisher: 'Knopf' };
  const web = { id: 's-site', type: 'webpage', title: 'Toni Morrison', URL: 'https://example.org/morrison' };
  // writer-cite.js saves an assignment paper's under its paper's parts, Documents' own under this device's.
  const essayKey = SRC.key({ school: 'bb.school.test', user: '_900_1', course: '_101_1', item: '_7_1' });
  assert.equal(essayKey, SRC.keyOf({ paper: { school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' } }));
  await SRC.save(essayKey, [book, web, { ...book }], env.a);
  await SRC.save(SRC.keyOf({ school: 'local', user: { id: 'local' }, course: { id: 'papers' }, item: { id: NOTES } }), [web], env.a);
  const r = await env.run('document_sources', { document: await keyOf(env, 'Essay 2: Memory in Beloved') });
  assert.deepEqual(r.items.map((x) => x.id), ['s-morrison', 's-site']);
  assert.equal(r.items[0].author[0].family, 'Morrison');
  assert.equal(r.at, env.a.s[essayKey].at);
  assert.deepEqual([r.total, r.next], [2, null]);
  assert.deepEqual((await env.run('document_sources', { document: await keyOf(env, 'Reading notes') })).items.map((x) => x.id), ['s-site']);
  const none = await env.run('document_sources', { document: await keyOf(env, 'Response paper') });
  assert.deepEqual([none.items, none.at], [[], NOW - 6 * 3600e3]);
});

test('document_assignment: what Glaze keeps of an assignment with its paper; null for the student\'s own', async () => {
  const env = await make();
  const r = await env.run('document_assignment', { document: await keyOf(env, 'Essay 2: Memory in Beloved') });
  assert.deepEqual(r, { at: NOW - 3600e3, assignment: { title: 'Essay 2: Memory in Beloved', due: Date.parse('2026-11-02T03:59:00.000Z'), course: 'ENGL 2110', submitted: null } });
  assert.deepEqual((await env.run('document_assignment', { document: await keyOf(env, 'Reading notes') })).assignment, null);
  // Renamed by the student, the paper's title is no longer the assignment's.
  await env.store.save(ESSAY, { named: true, title: 'My essay' }, { rename: true });
  assert.equal((await env.run('document_assignment', { document: await keyOf(env, 'My essay') })).assignment.title, '');
});

// ---- the page --------------------------------------------------------------------------------------------------------
// A port pair as the browser gives one: what one side posts reaches the other's listeners a turn later; a disconnect
// reaches only the other side.
const portPair = (name, sender) => {
  const ends = [0, 1].map(() => ({ heard: [], gone: [], posted: [], closed: false }));
  const side = (me, them) => ({
    name, sender, posted: me.posted,
    postMessage(m) { if (me.closed) throw new Error('Attempting to use a disconnected port object'); const copy = structuredClone(m); me.posted.push(copy); setImmediate(() => { if (!them.closed) for (const f of them.heard) f(structuredClone(copy)); }); },
    disconnect() { if (me.closed) return; me.closed = them.closed = true; setImmediate(() => { for (const f of them.gone) f(); }); },
    onMessage: { addListener: (f) => me.heard.push(f) }, onDisconnect: { addListener: (f) => me.gone.push(f) },
  });
  return { page: side(ends[0], ends[1]), worker: side(ends[1], ends[0]), open: () => !ends[0].closed };
};
// writer-mcp.js in a page of its own: a paper (its key once mounted), its issues in GZ_WRITER_ISSUES's plugin state,
// Cite's sources and style, storage.local mcp, and the worker it connects to (link(name) → the page's end).
const PAGE = fs.readFileSync(path.join(root, 'writer-mcp.js'), 'utf8');
const writerPage = ({ key = ESSAY, html = ESSAY_HTML, kind = 'paper', mode = 'paper', context = {}, on = true, sources = [], style = 'mla9', view: shown = 'full', link } = {}) => {
  const hooks = { ready: [], context: [] }, events = {}, changes = [], messages = [], ports = [];
  const pm = { state: PM.state.EditorState.create({ doc: SCHEMA.paper.nodeFromJSON(paperDoc(html)), plugins: [ISSUES.plugin()] }), editable: true, dispatch(tr) { this.state = this.state.apply(tr); } };
  const issues = ISSUES.bind(pm);
  const editor = { view: pm, run: (cmd, html2) => { if (cmd !== 'footnote') return false; const at = pm.state.selection.to; pm.dispatch(pm.state.tr.insert(at, SCHEMA.paper.nodes.footnote_ref.create({ content: html2 }))); return true; } };
  const page = { mounted: true, focus: false, kind, mode, context, sources, style, on };
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, structuredClone, Date, GZ_PM: PM, GZ_WRITER_ISSUES: issues,
    GZ_WRITER_CITE: { ...CITE, sources: () => page.sources.slice(), style: () => page.style },
    GZ_WRITER_PAPER: { current: () => (page.mounted ? { key: () => key } : null) },
    GZ_WRITER_FRAME: { kind: () => page.kind, mode: () => page.mode, context: () => page.context, editor: () => editor, on: (ev, fn) => hooks[ev]?.push(fn) },
    document: { hasFocus: () => page.focus, visibilityState: 'visible', documentElement: { dataset: { view: shown } } },
    addEventListener: (ev, fn) => { events[ev] = fn; },
    chrome: {
      runtime: { id: 'glaze', connect: ({ name }) => { const p = link(name); ports.push(p); return p; }, onMessage: { addListener: (f) => messages.push(f) } },
      storage: { local: { get: async () => ({ mcp: { on: page.on } }) }, onChanged: { addListener: (f) => changes.push(f) } },
    },
  });
  vm.runInContext(PAGE, ctx, { filename: 'writer-mcp.js' });
  const set = (on) => { page.on = on; for (const f of changes) f({ mcp: { newValue: { on } } }, 'local'); };
  const wake = (id = 'glaze') => { for (const f of messages) f({ type: 'glaze:mcp-writer', op: 'wake' }, { id }); };
  return { page, pm, issues, ports, hooks, events, set, wake, ready: () => { for (const f of hooks.ready) f(editor); }, context: (c) => { page.context = c; for (const f of hooks.context) f(c); } };
};
// A worker hub (lib/mcp/writer.js pages) that the page's ports reach, every one allowed unless refused.
const hubbed = (o = {}) => {
  const hub = M.pages({ runtime: o.runtime });
  const allow = { ok: true }, pairs = [];
  const link = (name) => { const pair = portPair(name); pairs.push(pair); hub.connect(pair.worker, async () => allow.ok); return pair.page; };
  return { hub, allow, link, pairs };
};
const harper = (pm, word, suggestions) => {
  let from = null;
  pm.state.doc.descendants((n, pos) => { if (from === null && n.isText && n.text.includes(word)) from = pos + n.text.indexOf(word); });
  return { from, to: from + word.length, kind: 'spelling', message: `Did you mean to spell \`${word}\` this way?`, suggestions, sure: false };
};

test('the page opens its port after ready, for a paper with agent access on, never in a test\'s box; off closes it, on and the worker\'s wake open it again', async () => {
  const h = hubbed();
  // The page's latest port is open and was admitted, or it has none open.
  const live = () => { const x = h.pairs.at(-1); return !!x && x.open() && x.worker.posted.some((m) => m.type === 'hello'); };
  const shut = () => !h.pairs.length || !h.pairs.at(-1).open();
  const p = writerPage({ link: h.link });
  await new Promise(setImmediate);
  assert.equal(p.ports.length, 0, 'nothing before ready');
  p.ready();
  await until(live, 'the page admitted');
  assert.equal(p.ports.length, 1);
  p.set(false);
  await until(() => shut() && h.hub.size() === 0, 'off');
  p.set(true);
  await until(live, 'on again');
  // A worker that stopped took the port; its successor's wake opens another.
  h.pairs.at(-1).worker.disconnect();
  await until(shut, 'the worker gone');
  p.wake('evil');
  await new Promise(setImmediate);
  assert.equal(p.ports.length, 2, 'a wake from elsewhere is not the worker\'s');
  p.wake();
  await until(live, 'woken');
  assert.equal(p.ports.length, 3);
  // A wake just after it opened one keeps that one.
  p.wake();
  await new Promise(setImmediate);
  assert.equal(p.ports.length, 3);
  // A test's box, by its kind or its context, compose's box, and agent access off never open one.
  for (const o of [{ kind: 'test' }, { context: { kind: 'test' } }, { mode: 'compose' }, { on: false }]) {
    const q = writerPage({ link: h.link, ...o });
    q.ready();
    q.wake();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(q.ports.length, 0, JSON.stringify(o));
  }
  // Context turning to a test's closes it; leaving the page closes it.
  p.context({ kind: 'test' });
  await until(shut, 'a test\'s context');
  p.context({});
  await until(live, 'back');
  p.events.pagehide();
  await until(shut, 'pagehide');
  p.events.pageshow({ persisted: true });
  await until(live, 'back from the cache');
});

test('a refused page hears no hello and asks nothing again until something changes', async () => {
  const h = hubbed();
  h.allow.ok = false;
  const p = writerPage({ link: h.link });
  p.ready();
  await until(() => p.ports.length === 1 && p.ports[0].posted.length === 0 && h.hub.size() === 0, 'refused');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(p.ports.length, 1, 'no reconnect loop');
  h.allow.ok = true;
  p.wake();
  await until(() => h.hub.size() === 1, 'admitted after a wake');
});

test('the hub asks the page holding the paper, the focused one first, and the page answers from its editor', async () => {
  const h = hubbed();
  const a = writerPage({ link: h.link }), b = writerPage({ link: h.link }), other = writerPage({ link: h.link, key: NOTES });
  for (const p of [a, b, other]) p.ready();
  await until(() => h.hub.size() === 3, 'three pages');
  assert.deepEqual((await h.hub.call(null, 'open')).sort(), [ESSAY, NOTES].sort());
  a.issues.set('harper', [harper(a.pm, 'definately', ['definitely', 'defiantly'])]);
  b.issues.set('harper', [harper(b.pm, 'definately', ['definitely'])]);
  b.page.focus = true;
  const got = await h.hub.call(ESSAY, 'issues', {});
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].suggestions, ['definitely'], 'the focused page');
  assert.deepEqual({ ...got[0], id: '' }, { id: '', kind: 'spelling', source: 'harper', text: 'definately', message: 'Did you mean to spell `definately` this way?', suggestions: ['definitely'] });
  assert.equal(await h.hub.call('bb.school.test|_900_1|_101_1|_8_1', 'issues', {}), null, 'no page has it');
  assert.equal(await h.hub.call(ESSAY, 'unknown', {}), null);
  // A page whose paper is not mounted yet holds nothing.
  b.page.mounted = false;
  assert.equal((await h.hub.call(ESSAY, 'issues', {})).length, 1, 'the other page');
  a.page.mounted = false;
  assert.equal(await h.hub.call(ESSAY, 'issues', {}), null);
  // Admission is asked again for each op: a page no longer allowed goes.
  a.page.mounted = true;
  h.allow.ok = false;
  assert.equal(await h.hub.call(ESSAY, 'issues', {}), null);
  await until(() => h.hub.size() === 2, 'the refused page dropped');
});

test('fix applies one of the issue\'s own suggestions as its card does, and only to the words the student saw', async () => {
  const h = hubbed();
  const p = writerPage({ link: h.link });
  p.ready();
  await until(() => h.hub.size() === 1, 'admitted');
  p.issues.set('harper', [harper(p.pm, 'definately', ['definitely', 'defiantly'])]);
  const [i] = await h.hub.call(ESSAY, 'issues', {});
  assert.deepEqual(await h.hub.call(ESSAY, 'fix', { issueId: i.id, suggestion: 'deFINITEly' }), { ok: false, error: "Not one of that issue's suggestions." });
  assert.deepEqual(await h.hub.call(ESSAY, 'fix', { issueId: i.id, suggestion: 'definitely', text: 'definitly' }), { ok: false, error: 'Nothing was done: the document changed since the student saw this.' });
  p.pm.editable = false;
  assert.deepEqual(await h.hub.call(ESSAY, 'fix', { issueId: i.id, suggestion: 'definitely', text: 'definately' }), { ok: false, error: "The document can't be changed right now." });
  p.pm.editable = true;
  assert.deepEqual(await h.hub.call(ESSAY, 'fix', { issueId: i.id, suggestion: 'defiantly', text: 'definately' }), { ok: true });
  assert.ok(p.pm.state.doc.textContent.includes('she is defiantly not alone'));
  assert.equal(p.issues.list().length, 0, 'the issue went with its words');
  assert.deepEqual(await h.hub.call(ESSAY, 'fix', { issueId: i.id, suggestion: 'defiantly' }), { ok: false, error: "Not one of that issue's suggestions." });
});

test('cite says what a citation would put at the caret and insert puts exactly that, in the document\'s style', async () => {
  const h = hubbed();
  const book = { id: 's-morrison', type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }], issued: { 'date-parts': [[1987]] }, publisher: 'Knopf' };
  const p = writerPage({ link: h.link, sources: [book] });
  p.ready();
  await until(() => h.hub.size() === 1, 'admitted');
  // The caret after "alone" (before the period).
  let at = null;
  p.pm.state.doc.descendants((n, pos) => { if (at === null && n.isText && n.text.includes('alone.')) at = pos + n.text.indexOf('alone.') + 5; });
  p.pm.dispatch(p.pm.state.tr.setSelection(PM.state.TextSelection.create(p.pm.state.doc, at)));
  const c = await h.hub.call(ESSAY, 'cite', { sourceId: 's-morrison', page: '12' });
  assert.deepEqual(c, { source: { id: 's-morrison', title: 'Beloved' }, inText: '(Morrison 12)' });
  assert.equal(c.inText, CITE.format(book, 'mla9').inText('12'));
  assert.deepEqual(await h.hub.call(ESSAY, 'cite', { sourceId: 'nope' }), { ok: false, error: 'No such source in this document.' });
  assert.deepEqual(await h.hub.call(ESSAY, 'insert', { sourceId: 's-morrison', page: '12', inText: '(Morrison 13)' }), { ok: false, error: 'Nothing was done: the document changed since the student saw this.' });
  assert.deepEqual(await h.hub.call(ESSAY, 'insert', { sourceId: 'nope', page: '12' }), { ok: false, error: 'No such source in this document.' });
  assert.deepEqual(await h.hub.call(ESSAY, 'insert', { sourceId: 's-morrison', page: '12', inText: '(Morrison 12)' }), { ok: true });
  assert.ok(p.pm.state.doc.textContent.includes('not alone (Morrison 12).'));
  // APA, and Chicago's notes in a paper: its first note full, as writer-cite.js writes them.
  p.page.style = 'apa7';
  assert.equal((await h.hub.call(ESSAY, 'cite', { sourceId: 's-morrison' })).inText, '(Morrison, 1987)');
  p.page.style = 'chicago17';
  const note = await h.hub.call(ESSAY, 'cite', { sourceId: 's-morrison', page: '12' });
  assert.match(note.inText, /^Toni Morrison, Beloved \(.*1987\), 12\.$/);
  assert.deepEqual(await h.hub.call(ESSAY, 'insert', { sourceId: 's-morrison', page: '12', inText: note.inText }), { ok: true });
  let notes = 0;
  p.pm.state.doc.descendants((n) => { if (n.type.name === 'footnote_ref') notes++; });
  assert.equal(notes, 1);
  // A paper's key the page doesn't hold is refused.
  h.pairs[0].worker.postMessage({ id: 999, op: 'cite', key: NOTES, args: { sourceId: 's-morrison' } });
  await until(() => p.ports[0].posted.find((m) => m.id === 999), 'the page\'s answer');
  assert.deepEqual(p.ports[0].posted.find((m) => m.id === 999), { id: 999, error: "This document isn't open in this Writer page any more." });
});

test('a page that never answers an op is reported, not taken for closed', async () => {
  const timers = { setTimeout: (f, ms) => setTimeout(f, ms / 100), clearTimeout };
  const hub = M.pages({ timers });
  const pair = portPair('glaze:mcp-writer');
  pair.page.onMessage.addListener((m) => { if (m.op === 'key') pair.page.postMessage({ id: m.id, value: { key: ESSAY } }); });
  hub.connect(pair.worker, async () => true);
  await until(() => hub.size() === 1, 'admitted');
  assert.deepEqual(await hub.call(ESSAY, 'fix', {}), { ok: false, error: "The Writer page didn't answer in time; check the document before asking again." });
  // Cancelled: no answer.
  const ac = new AbortController();
  ac.abort();
  assert.equal(await hub.call(ESSAY, 'fix', {}, { signal: ac.signal }), null);
  // A port gone during admission is never seated; wake tells the pages.
  const sent = [];
  const hub2 = M.pages({ runtime: { sendMessage: async (m) => { sent.push(m); } } });
  const late = portPair('glaze:mcp-writer');
  let open;
  hub2.connect(late.worker, () => new Promise((r) => { open = r; }));
  late.page.disconnect();
  await new Promise(setImmediate);
  open(true);
  await new Promise(setImmediate);
  assert.equal(hub2.size(), 0);
  assert.deepEqual(late.worker.posted, []);
  hub2.wake();
  assert.deepEqual(sent, [{ type: 'glaze:mcp-writer', op: 'wake' }]);
  assert.doesNotThrow(() => M.pages({ runtime: {} }).wake());
});

// ---- the page tools, end to end over the hub --------------------------------------------------------------------------
const opened = async (o = {}) => {
  const h = hubbed();
  const env = await make({ bridge: h.hub.call });
  const p = writerPage({ link: h.link, ...o });
  p.ready();
  await until(() => h.hub.size() === 1, 'the page admitted');
  return { ...env, h, p, key: await keyOf(env, 'Essay 2: Memory in Beloved') };
};

test('document_issues: the open editor\'s issues in lib/writer-tools.js\'s shape, a part at a time; a closed document says to open it', async () => {
  const env = await opened();
  const long = 'x'.repeat(400);
  env.p.issues.set('harper', [harper(env.p.pm, 'definately', ['definitely', 'defiantly'])]);
  env.p.issues.set('format', [{ ...harper(env.p.pm, 'Memory in Beloved', ['Memory in "Beloved"']), kind: 'format', message: long, id: 'title' }]);
  const r = await env.run('document_issues', { document: env.key });
  assert.equal(r.source, 'tab');
  assert.equal(r.at, NOW);
  assert.deepEqual(r.items.map((i) => [i.kind, i.source, i.text, i.suggestions]), [['format', 'format', 'Memory in Beloved', ['Memory in "Beloved"']], ['spelling', 'harper', 'definately', ['definitely', 'defiantly']]]);
  assert.equal(r.items[0].message.length, 300);
  // Many: a part at a time, within the answer's room.
  const many = [];
  env.p.pm.state.doc.descendants((n, pos) => { if (n.isText) for (let i = 0; i + 3 < n.text.length && many.length < 300; i += 4) many.push({ from: pos + i, to: pos + i + 3, kind: 'grammar', message: 'm'.repeat(200), suggestions: ['abc', 'abd', 'abe', 'abf', 'abg', 'abh'] }); });
  env.p.issues.set('ai', many);
  const first = await env.run('document_issues', { document: env.key });
  assert.ok(first.next > 0 && first.total > first.items.length);
  assert.ok(JSON.stringify(first).length <= M.LIMIT.answer);
  assert.equal(first.items[0].suggestions.length, 5);
  const second = await env.run('document_issues', { document: env.key, from: first.next });
  assert.notEqual(second.items[0].id, first.items[0].id);
  // Closed: the agent hears to open it.
  const closed = await env.run('document_issues', { document: await keyOf(env, 'Reading notes') });
  assert.deepEqual(closed, { ok: false, error: "Open this document in Glaze Writer first (from Documents, or its assignment's page): Glaze reads its issues and changes it only in an open editor." });
});

test('fix_apply: Glaze\'s summary from the open editor\'s issue, then the change only if those words are still there', async () => {
  const env = await opened();
  env.p.issues.set('harper', [harper(env.p.pm, 'definately', ['definitely', 'defiantly'])]);
  const [i] = env.p.issues.list();
  const args = { issueId: i.id, suggestion: 'definitely' }, ctx = { document: env.key, local: env.a, now: () => NOW };
  const t = env.reg.get('fix_apply');
  assert.equal(await t.summarize(args, ctx), 'Change "definately" to "definitely".');
  // A call that can't do anything fails before the student is asked.
  await assert.rejects(t.summarize({ ...args, suggestion: 'definitly' }, { ...ctx }), /Not one of that issue's suggestions/);
  await assert.rejects(t.summarize(args, { ...ctx, document: 'document:00000000000000000000000000000000' }), /no document by that key/);
  await assert.rejects(t.summarize(args, { ...ctx, document: await keyOf(env, 'Reading notes') }), /Open this document in Glaze Writer first/);
  // The words changed while the student read the summary: refused, nothing done.
  const tr = env.p.pm.state.tr;
  env.p.pm.dispatch(tr);
  env.p.issues.set('harper', [{ ...harper(env.p.pm, 'Sethe', ['definitely']), id: i.id.slice('harper:'.length) }]);
  const moved = env.p.issues.list()[0];
  assert.equal(moved.id, i.id, 'the same id now names other words');
  assert.deepEqual(await t.run(args, ctx), { ok: false, error: 'Nothing was done: the document changed since the student saw this.' });
  assert.ok(env.p.pm.state.doc.textContent.includes('Sethe remembers'));
  // As shown: applied.
  env.p.issues.set('harper', [harper(env.p.pm, 'definately', ['definitely', 'defiantly'])]);
  const [j] = env.p.issues.list(), ctx2 = { ...ctx }, args2 = { issueId: j.id, suggestion: 'definitely' };
  assert.equal(await t.summarize(args2, ctx2), 'Change "definately" to "definitely".');
  assert.deepEqual(await t.run(args2, ctx2), { source: 'tab', at: NOW, ok: true });
  assert.ok(env.p.pm.state.doc.textContent.includes('she is definitely not alone'));
  // A run without its summary has no document it can trust to name.
  assert.deepEqual(await t.run(args2, { ...ctx, document: 'document:00000000000000000000000000000000' }), { ok: false, error: 'Glaze lost track of this document. Call documents_list and try again.' });
});

test('citation_insert: the summary names what goes in; the insert refuses once that changed', async () => {
  const book = { id: 's-morrison', type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }], issued: { 'date-parts': [[1987]] }, publisher: 'Knopf' };
  const env = await opened({ sources: [book] });
  const t = env.reg.get('citation_insert'), ctx = { document: env.key, local: env.a, now: () => NOW };
  assert.equal(await t.summarize({ sourceId: 's-morrison', page: '12' }, ctx), 'Insert the citation (Morrison 12) for "Beloved" at the caret.');
  await assert.rejects(t.summarize({ sourceId: 'nope' }, { ...ctx }), /No such source in this document/);
  env.p.page.style = 'apa7';
  assert.deepEqual(await t.run({ sourceId: 's-morrison', page: '12' }, ctx), { ok: false, error: 'Nothing was done: the document changed since the student saw this.' });
  env.p.page.style = 'mla9';
  assert.deepEqual(await t.run({ sourceId: 's-morrison', page: '12' }, ctx), { source: 'tab', at: NOW, ok: true });
  assert.ok(env.p.pm.state.doc.textContent.includes('(Morrison 12)'));
});

// ---- through the call core -----------------------------------------------------------------------------------------
test('through calls.js: a change waits for the student, then runs in the broker\'s turn, whose papers turn it never waits on', async () => {
  const env = await opened();
  env.p.issues.set('harper', [harper(env.p.pm, 'definately', ['definitely'])]);
  const [i] = env.p.issues.list();
  const grants = G.open(fakeIDB().indexedDB);
  await grants.pair(PEER, 'Claude', ['writer']);
  const asked = [];
  let answer = 'yes';
  const calls = CALLS.create({
    registry: R, state: async () => ({ tools: env.reg }), grants, approve: { ask: async (kind, view) => { asked.push([kind, view]); return answer; } },
    settings: async () => ({ on: true }), enabled: async () => true, accounts: async () => [], refresh: async () => null,
    local: env.a, keys: async () => Object.keys(env.a.s), now: () => NOW, record: () => {}, turn: env.queue,
  });
  const call = (name, args) => Promise.race([calls.call({ name, args, peer: PEER, client: { name: 'Claude' } }), new Promise((_, no) => setTimeout(() => no(new Error(`${name} hung`)), 3000))]);
  const list = await call('documents_list', {});
  assert.equal(list.isError, undefined, JSON.stringify(list));
  assert.equal(list.structuredContent.source, 'cache');
  const document = list.structuredContent.items[0].key;
  const read = await call('document_read', { document });
  assert.ok(read.structuredContent.text.includes('definately'));
  assert.equal(read.structuredContent.ageSeconds, 3600);
  assert.equal((await call('document_issues', { document })).structuredContent.source, 'tab');
  answer = 'no';
  const declined = await call('fix_apply', { document, issueId: i.id, suggestion: 'definitely' });
  assert.equal(declined.isError, true);
  assert.ok(env.p.pm.state.doc.textContent.includes('definately'), 'declined: nothing changed');
  answer = 'yes';
  const r = await call('fix_apply', { document, issueId: i.id, suggestion: 'definitely' });
  assert.equal(r.isError, undefined, JSON.stringify(r));
  assert.equal(r.structuredContent.ok, true);
  assert.deepEqual(asked.filter(([k]) => k === 'action').map(([, v]) => v.summary), ['Change "definately" to "definitely".', 'Change "definately" to "definitely".']);
  assert.ok(env.p.pm.state.doc.textContent.includes('she is definitely not alone'));
  // One that would do nothing never reaches the student.
  const before = asked.length;
  const bad = await call('fix_apply', { document, issueId: i.id, suggestion: 'definitely' });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /Not one of that issue's suggestions/);
  assert.equal(asked.length, before);
});

// ---- the worker, wired -------------------------------------------------------------------------------------------------
const BACKGROUND = wired(fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8'));
// Values from the worker's realm, as plain JSON (its objects' prototypes are its own).
const inWorker = (w, code) => { const v = vm.runInContext(code, w.context); return v && typeof v.then === 'function' ? v.then((x) => JSON.parse(JSON.stringify(x ?? null))) : v; };
const DOCS_PAGE = { id: 'glaze', url: `chrome-extension://x/papers.html?paper=${encodeURIComponent(ESSAY)}`, frameId: 0, origin: 'chrome-extension://x', tab: { id: 9, url: `chrome-extension://x/papers.html?paper=${encodeURIComponent(ESSAY)}` } };
const bootWorker = async ({ on = true, papers = true } = {}) => {
  const s = await seed();
  const idb = fakeIDB().indexedDB;
  if (on) idb.dbs.set('glaze-mcp-settings', new Map([['settings', new Map([['on', true]])]]));
  const store = { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [], ...(on && { mcp: { on: true } }), ...(papers && s.a.s) }, session: {} };
  const w = worker({ store, background: BACKGROUND, globals: { indexedDB: idb } });
  const woke = [];
  w.context.chrome.runtime.sendMessage = async (m) => { woke.push(m); };
  w.context.chrome.windows = { create: async () => ({ id: 1, tabs: [{ id: 2 }] }), remove: async () => {}, onRemoved: { addListener() {} } };
  return { w, store, woke, idb };
};
// writer-mcp.js's port into the wired worker, through worker-env's onConnect.
const intoWorker = (w, sender = DOCS_PAGE) => (name) => {
  const c = w.connect(name, sender), page = [], gone = [];
  let closed = false;
  c.port.postMessage = (m) => { if (closed) throw new Error('disconnected'); c.port.posted.push(m); setImmediate(() => { for (const f of page) f(structuredClone(m)); }); };
  c.port.disconnect = () => { if (closed) return; closed = true; c.port.hungUp = true; setImmediate(() => { for (const f of gone) f(); }); };
  return { name, postMessage: (m) => { if (closed) throw new Error('disconnected'); setImmediate(() => c.say(structuredClone(m))); }, disconnect: () => { if (closed) return; closed = true; c.close(); },
    onMessage: { addListener: (f) => page.push(f) }, onDisconnect: { addListener: (f) => gone.push(f) }, worker: c.port };
};

test('the wired worker: the writer tools listed, the core\'s wake, and Writer\'s store read through openPapers', async () => {
  const { w, woke } = await bootWorker();
  await until(() => inWorker(w, 'typeof GZ_MCP_CALLS') === 'object' && inWorker(w, 'mcpState.tools !== undefined'), 'the core at worker start');
  const names = JSON.parse(inWorker(w, 'JSON.stringify(GZ_MCP_REGISTRY.list(mcpState).map((t) => t.name))'));
  for (const n of ['documents_list', 'document_read', 'document_sources', 'document_assignment', 'document_issues', 'citation_insert', 'fix_apply']) assert.ok(names.includes(n), n);
  assert.ok(names.includes('todo_list'), 'beside the courses tools');
  assert.deepEqual(JSON.parse(JSON.stringify(woke)), [{ type: 'glaze:mcp-writer', op: 'wake' }]);
  // One paper store: openPapers', in the broker's turn.
  inWorker(w, "importScripts('writer-styles.js', 'writer-papers.js'); globalThis.opens = 0; const o = GZ_WRITER_PAPERS.open; GZ_WRITER_PAPERS.open = (...a) => { opens++; return o(...a); };");
  const r = await inWorker(w, "GZ_AI_TOOLS.get('documents_list').run({}, mcpCtx(null))");
  assert.deepEqual(r.items.map((i) => i.title), ['Essay 2: Memory in Beloved', 'Reading notes', 'Response paper', 'An older draft']);
  await inWorker(w, "GZ_AI_TOOLS.get('documents_list').run({}, mcpCtx(null))");
  assert.equal(inWorker(w, 'opens'), 1, 'openPapers made its one store');
  assert.equal(inWorker(w, 'paperStore !== null'), true);
});

test('the wired worker admits Writer\'s port as it does the AI\'s, only while agent access is on, and its tools reach the page', async () => {
  const { w } = await bootWorker();
  const p = writerPage({ link: intoWorker(w) });
  p.ready();
  await until(() => p.ports[0]?.worker.posted.some((m) => m.type === 'hello'), 'hello');
  p.issues.set('harper', [harper(p.pm, 'definately', ['definitely'])]);
  const key = (await inWorker(w, "GZ_AI_TOOLS.get('documents_list').run({}, mcpCtx(null))")).items[0];
  assert.equal(key.open, true);
  const got = await inWorker(w, `GZ_AI_TOOLS.get('document_issues').run({}, { ...mcpCtx(null), document: ${JSON.stringify(key.key)} })`);
  assert.deepEqual(got.items.map((i) => i.text), ['definately']);
  // Refused: another extension, a school's page as Glaze's content script would send (worker-env reads no frame), and the
  // page with agent access off.
  for (const sender of [{ ...DOCS_PAGE, id: 'other' }, { id: 'glaze', url: 'https://bb.school.test/ultra/courses/_101_1/outline', frameId: 0, tab: { id: 3, url: 'https://bb.school.test/ultra/courses/_101_1/outline' } }]) {
    const q = writerPage({ link: intoWorker(w, sender) });
    q.ready();
    await until(() => q.ports[0]?.worker.hungUp, `refused ${sender.url}`);
    assert.equal(q.ports[0].worker.posted.length, 0);
  }
  const off = await bootWorker({ on: false });
  const q = writerPage({ link: intoWorker(off.w) });
  q.page.on = true; // Settings' mirror says on; the worker's own switch says off.
  q.ready();
  await until(() => q.ports[0]?.worker.hungUp, 'refused with agent access off');
  assert.equal(q.ports[0].worker.posted.length, 0);
});

test('from paging reaches all 300 stored sources and every open issue beyond the old 200-row limit', async () => {
  const env = await opened({ html: `<p>${'word '.repeat(350)}</p>` });
  const sources = Array.from({ length: 300 }, (_, n) => ({ id: `s-source-${n}`, type: 'book', title: `Book ${n}` }));
  await SRC.save(SRC.key({ school: 'bb.school.test', user: '_900_1', course: '_101_1', item: '_7_1' }), sources, env.a);
  env.p.issues.set('ai', Array.from({ length: 300 }, (_, n) => ({ from: 1 + n * 5, to: 5 + n * 5, kind: 'grammar', message: `Issue ${n}`, suggestions: ['term'] })));
  for (const name of ['document_sources', 'document_issues']) {
    const ids = [];
    let from = 0;
    do {
      const r = await env.run(name, { document: env.key, from });
      assert.equal(r.total, 300, name);
      assert.ok(JSON.stringify(r).length <= M.LIMIT.answer);
      ids.push(...r.items.map((i) => i.id));
      assert.ok(r.next === null || r.next > from, 'paging makes progress');
      from = r.next;
    } while (from !== null);
    assert.equal(new Set(ids).size, 300, name);
  }
});

test('one oversized source has an explicit omission, stays within the call cap, and does not hide later sources', async () => {
  const env = await make();
  const source = { id: 's-huge', type: 'book', title: 'Many authors', author: Array.from({ length: 60 }, () => ({ family: 'f'.repeat(120), given: 'g'.repeat(120) })) };
  await SRC.save(SRC.key({ school: 'bb.school.test', user: '_900_1', course: '_101_1', item: '_7_1' }), [source, { id: 's-next', type: 'book', title: 'Next source' }], env.a);
  const document = await keyOf(env, 'Essay 2: Memory in Beloved');
  const grants = G.open(fakeIDB().indexedDB);
  await grants.pair(PEER, 'Writer client', ['writer']);
  const calls = CALLS.create({ registry: R, state: async () => ({ tools: env.reg }), grants, approve: { ask: async () => 'no' },
    settings: async () => ({ on: true }), enabled: async () => true, accounts: async () => [], refresh: async () => null,
    local: env.a, keys: async () => Object.keys(env.a.s), now: () => NOW, record: () => {}, turn: env.queue });
  const r = await calls.call({ name: 'document_sources', args: { document }, peer: PEER, client: { name: 'Writer client' } });
  assert.equal(r.isError, undefined);
  assert.ok(r.content[0].text.length <= 12000);
  assert.equal(r.structuredContent.omitted, undefined, 'the whole answer must not become a receipt');
  assert.equal(r.structuredContent.total, 2);
  assert.deepEqual(r.structuredContent.items.map((i) => i.id), ['s-huge', 's-next']);
  assert.equal(r.structuredContent.items[0].omitted, true);
});

test('document_read pages JSON-escaped text without exceeding the cap or dropping text', async () => {
  const s = await seed(), text = '\u0001'.repeat(2999) + '😀' + '\\"'.repeat(1800);
  await s.store.save(NOTES, { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
  const env = await make({ s }), document = await keyOf(env, 'Reading notes'), out = [];
  for (let page = 1, pages = 1; page <= pages; page++) {
    const r = await env.run('document_read', { document, page });
    assert.ok(JSON.stringify(r).length <= M.LIMIT.answer, `page ${page}`);
    assert.ok(!/[\ud800-\udbff]$/.test(r.text) && !/^[\udc00-\udfff]/.test(r.text), 'no split surrogate pair');
    out.push(r.text);
    pages = r.pages;
  }
  assert.equal(out.join(''), text);
});

test('approval shows all the issue words and replacement, including the part past 120 characters', async () => {
  const text = 'a'.repeat(160) + ' old ending', suggestion = 'b'.repeat(160) + ' new ending';
  const env = await opened({ html: `<p>${text}</p>` });
  env.p.issues.set('ai', [harper(env.p.pm, text, [suggestion])]);
  const t = env.reg.get('fix_apply'), ctx = { document: env.key, local: env.a };
  const args = { issueId: env.p.issues.list()[0].id, suggestion };
  assert.equal(await t.summarize(args, ctx), `Change ${JSON.stringify(text)} to ${JSON.stringify(suggestion)}.`);
  assert.equal((await t.run(args, ctx)).ok, true);
  assert.equal(env.p.pm.state.doc.textContent, suggestion);
});

test('citation approval shows the complete Chicago note and rejects a note too long for the approval window', async () => {
  const book = { id: 's-long-title', type: 'book', title: 'A long title '.repeat(25), author: [{ family: 'Rivera', given: 'Alex' }], publisher: 'Press', issued: { 'date-parts': [[2026]] } };
  const env = await opened({ sources: [book], style: 'chicago17' });
  const t = env.reg.get('citation_insert'), ctx = { document: env.key, local: env.a };
  const c = await env.h.hub.call(ESSAY, 'cite', { sourceId: book.id });
  assert.equal(await t.summarize({ sourceId: book.id }, ctx), `Insert the citation ${c.inText} for ${JSON.stringify(book.title)} at the caret.`);
  env.p.page.sources = [{ ...book, title: 't'.repeat(600), publisher: 'p'.repeat(600), 'publisher-place': 'l'.repeat(600), edition: 'e'.repeat(600) }];
  await assert.rejects(t.summarize({ sourceId: book.id }, { ...ctx }), /too long/i);
});

test('an approved change refuses a document trashed, removed, or changed to an unknown kind while approval waited', async () => {
  const book = { id: 's-morrison', type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }] };
  for (const name of ['fix_apply', 'citation_insert']) for (const changed of ['trash', 'remove', 'kind']) {
    const env = await opened({ sources: [book] });
    env.p.issues.set('harper', [harper(env.p.pm, 'definately', ['definitely'])]);
    const t = env.reg.get(name), ctx = { document: env.key, local: env.a };
    const args = name === 'fix_apply' ? { issueId: env.p.issues.list()[0].id, suggestion: 'definitely' } : { sourceId: book.id };
    await t.summarize(args, ctx);
    if (changed === 'trash') await env.store.trash(ESSAY);
    else if (changed === 'remove') await env.store.remove(ESSAY);
    else await env.store.save(ESSAY, { kind: 'sheet' });
    const before = env.p.pm.state.doc.toJSON(), r = await env.queue(() => t.run(args, ctx));
    assert.equal(r.ok, false, `${name}: ${changed}`);
    assert.match(r.error, /no document by that key/i);
    assert.deepEqual(env.p.pm.state.doc.toJSON(), before);
  }
});

test('a change needs its own summary and cannot reuse its approved arguments for a different change', async () => {
  const env = await opened();
  env.p.issues.set('harper', [harper(env.p.pm, 'definately', ['definitely', 'defiantly'])]);
  const t = env.reg.get('fix_apply'), ctx = { document: env.key, local: env.a };
  const args = { issueId: env.p.issues.list()[0].id, suggestion: 'definitely' };
  const before = env.p.pm.state.doc.toJSON();
  assert.equal((await t.run(args, ctx)).ok, false, 'a listed handle alone is not an approval');
  await t.summarize(args, ctx);
  assert.equal((await t.run({ ...args, suggestion: 'defiantly' }, ctx)).ok, false, 'bind the replacement too');
  assert.deepEqual(env.p.pm.state.doc.toJSON(), before);
});

test('open-page discovery rechecks admission before asking for any document key', async () => {
  const h = hubbed(), p = writerPage({ link: h.link });
  p.ready();
  await until(() => h.hub.size() === 1, 'admitted');
  h.allow.ok = false;
  const before = h.pairs[0].worker.posted.length;
  assert.deepEqual(await h.hub.call(null, 'open'), []);
  assert.equal(h.pairs[0].worker.posted.length, before);
  assert.equal(h.hub.size(), 0);
});
