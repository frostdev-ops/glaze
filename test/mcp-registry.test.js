// The MCP view (lib/mcp/registry.js): Glaze's grouped tools and the usable mods' tools as MCP Tool descriptors, the same for
// every connection; annotations from the kind, scoped arguments, the legacy era's object-only outputSchema, mod tools wired
// to the data path, and no mod tool in a Glaze tool's name.
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/mcp/registry.js');
const TL = require('../lib/ai/tools.js');
const S = require('../lib/ai/schema.js');
const W = require('../lib/mcp/wire.js');

const ID = 'abcdefghijklmnop', OTHER = 'zyxwvutsrqponm23';
const NS = 'io.frostdev.glaze/';
const DAY = 864e5, NOW = 1_800_000_000_000;
const ACCOUNT = 'https://school.instructure.com/5';
const P = (...ids) => ids.map((id) => ({ id, why: 'Answers the app.' }));
const DUE = { name: 'due_soon', title: 'Due soon', description: 'Open to-dos, soonest first.', from: 'todo',
  where: [{ field: 'done', eq: false }], sort: { field: 'due', order: 'asc' }, input: { course: true, days: true } };
const ASK = { name: 'ask', title: 'Ask', description: 'What the Worker says.', code: true,
  input: { type: 'object', properties: { q: { type: 'string', maxLength: 200 } }, required: ['q'], additionalProperties: false } };
// An installed mod as the worker reads it (lib/background.js modRead, with name and tools).
const rec = (id, over = {}) => ({ id, enabled: true, dev: false, hash: `hash-${id}`, key: `key-${id}`, grants: { agents: true, todo: true },
  manifest: { name: id === ID ? 'Due Soon' : 'Other', permissions: P('agents', 'todo'), tools: [DUE, ASK] }, ...over });
const glaze = () => {
  const r = TL.registry();
  r.add({ name: 'courses_list', kind: 'read', title: 'Courses', group: 'courses', scope: 'account', description: "The student's courses.",
    parameters: S.obj({}), run: async () => ({ items: [] }) });
  r.add({ name: 'todo_mark_done', kind: 'write', title: 'Mark a to-do done', group: 'courses', scope: 'account', description: 'Marks a to-do done.',
    parameters: S.obj({ id: S.str('The to-do.') }, ['id']), hints: { idempotent: true }, run: async () => ({ ok: true }), summarize: () => 'Mark it done.' });
  r.add({ name: 'citation_insert', kind: 'confirm', group: 'writer', scope: 'document', needs: 'writer', description: 'Inserts a citation.',
    parameters: S.obj({ source: S.str('Which source.') }, ['source']), run: async () => ({}) });
  r.add({ name: 'outline_draft', kind: 'read', description: "The AI harness's only: no group.", parameters: S.obj({}), run: async () => ({}) });
  return r;
};
const state = (over = {}) => ({ tools: glaze(), mods: [rec(ID), rec(OTHER)], browser: 'chrome', runtime: { ok: true }, dev: false, now: () => NOW, ...over });
const names = (s, era) => V.list(s, era).map((t) => t.name);
const of = (s, name, era) => V.list(s, era).find((t) => t.name === name);
const run = async () => ({});
const MODS = [`mod_${ID}_ask`, `mod_${ID}_due_soon`, `mod_${OTHER}_ask`, `mod_${OTHER}_due_soon`];

test('describe: the MCP Tool, with its title, schemas and Glaze _meta, and nothing of the tool\'s code', () => {
  const s = state();
  const t = of(s, 'courses_list');
  assert.deepEqual(Object.keys(t), ['name', 'title', 'description', 'inputSchema', 'annotations', '_meta']);
  assert.deepEqual([t.name, t.title, t.description], ['courses_list', 'Courses', "The student's courses."]);
  assert.equal(t.outputSchema, undefined);
  assert.deepEqual(t._meta, { [`${NS}group`]: 'courses' });
  // No title, no outputSchema: neither key is written.
  assert.deepEqual(Object.keys(of(s, 'citation_insert')), ['name', 'description', 'inputSchema', 'annotations', '_meta']);
  assert.deepEqual(of(s, 'citation_insert')._meta, { [`${NS}group`]: 'writer', [`${NS}needs`]: 'writer', [`${NS}approval`]: 'student' });
  // Plain JSON, and a copy: changing it changes no tool.
  const list = V.list(s);
  assert.deepEqual(JSON.parse(JSON.stringify(list)), list);
  list[0].inputSchema.properties.x = { type: 'string' };
  assert.equal(Object.hasOwn(s.tools.get(list[0].name).parameters.properties, 'x'), false);
});

test('annotations follow the kind; openWorld only when the tool says so', () => {
  const s = state();
  const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  assert.deepEqual(of(s, 'courses_list').annotations, READ);
  assert.deepEqual(of(s, `mod_${ID}_due_soon`).annotations, READ);
  assert.deepEqual(of(s, 'todo_mark_done').annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(of(s, 'citation_insert').annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  const base = { name: 'x_tool', group: 'courses', description: 'X.', run };
  const d = (t, era) => V.describe(TL.define({ ...base, ...t }), era);
  assert.deepEqual(d({ kind: 'write', hints: { openWorld: true } }).annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
  assert.deepEqual(d({ kind: 'confirm', hints: { idempotent: false, openWorld: false } }).annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  assert.deepEqual(d({ kind: 'read', hints: { idempotent: false, openWorld: true } }).annotations, { ...READ, openWorldHint: true });
  // A code tool of a mod granted a network host reaches the open world (lib/modtools.js defs); one without stays closed.
  assert.equal(of(s, `mod_${ID}_ask`).annotations.openWorldHint, false);
  const net = rec(ID, { grants: { agents: true, todo: true, 'network:api.example.com': true }, manifest: { ...rec(ID).manifest, permissions: P('agents', 'todo', 'network:api.example.com') } });
  assert.deepEqual(of(state({ mods: [net] }), `mod_${ID}_ask`).annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true });
  // The student approves every change: write and confirm say so; reads don't.
  for (const kind of ['write', 'confirm']) assert.equal(d({ kind })._meta[`${NS}approval`], 'student');
  assert.equal(Object.hasOwn(d({ kind: 'read' })._meta, `${NS}approval`), false);
  assert.equal(of(s, `mod_${ID}_ask`)._meta[`${NS}needs`], 'tab');
  assert.equal(of(s, `mod_${ID}_ask`)._meta[`${NS}group`], `mod:${ID}`);
});

test('scoped tools gain an optional account or a required document; the rest take their parameters as they are', () => {
  const s = state();
  const acct = of(s, 'todo_mark_done').inputSchema;
  assert.deepEqual(Object.keys(acct.properties), ['id', 'account']);
  assert.deepEqual(acct.required, ['id']);
  assert.equal(acct.properties.account.type, 'string');
  assert.ok(acct.properties.account.description.length > 20);
  const doc = of(s, 'citation_insert').inputSchema;
  assert.deepEqual(Object.keys(doc.properties), ['source', 'document']);
  assert.deepEqual(doc.required, ['source', 'document']);
  assert.equal(doc.properties.document.type, 'string');
  assert.ok(doc.properties.document.description.length > 20);
  // A mod's tools are account scoped (lib/modtools.js defs).
  assert.deepEqual(Object.keys(of(s, `mod_${ID}_due_soon`).inputSchema.properties), ['course', 'days', 'account']);
  // Unscoped: the parameters, unchanged; the tool's own parameters stay as defined.
  const plain = TL.define({ name: 'x_tool', kind: 'read', group: 'grades', description: 'X.', parameters: S.obj({ n: S.num('N.') }), run });
  assert.deepEqual(V.describe(plain).inputSchema, S.obj({ n: S.num('N.') }));
  assert.deepEqual(Object.keys(s.tools.get('todo_mark_done').parameters.properties), ['id']);
  // Every inputSchema is an object in the harness's schema subset, with no `reason`, so a call's arguments are checked with it.
  for (const t of V.list(s)) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(S.clean(t.inputSchema), t.inputSchema, t.name);
    assert.equal(Object.hasOwn(t.inputSchema.properties || {}, 'reason'), false, t.name);
  }
  assert.deepEqual(S.validate({ id: '9', account: ACCOUNT }, acct), []);
  assert.deepEqual(S.validate({ id: '9' }, acct), []);
  assert.deepEqual(S.validate({ source: 'a' }, doc), ['$: missing document']);
  assert.deepEqual(S.validate({ source: 'a', document: 'k1' }, doc), []);
});

test('only tools with a group are listed, and get answers the defined tool or null', () => {
  const s = state();
  assert.deepEqual(names(s), ['citation_insert', 'courses_list', ...MODS, 'todo_mark_done']);
  assert.equal(V.get('outline_draft', s), null);
  assert.equal(V.get('nope', s), null);
  assert.equal(V.get('courses_list', s), s.tools.get('courses_list'));
  const m = V.get(`mod_${ID}_due_soon`, s);
  assert.ok(TL.is(m) && Object.isFrozen(m));
  assert.deepEqual([m.kind, m.owner, m.group, m.scope], ['read', `mod:${ID}`, `mod:${ID}`, 'account']);
  // No registry and no mods: an empty list.
  assert.deepEqual(V.list({}), []);
  assert.deepEqual(V.list(undefined), []);
  assert.equal(V.get('courses_list', {}), null);
});

test('the list is the same on every call and whatever order the mods come in', () => {
  const s = state();
  const first = V.list(s);
  assert.deepEqual(V.list(s), first);
  assert.equal(JSON.stringify(V.list(s)), JSON.stringify(first));
  const flipped = state({ mods: [rec(OTHER), rec(ID)] });
  assert.equal(JSON.stringify(V.list(flipped)), JSON.stringify(first));
  // A fresh registry holding the same tools, added in another order.
  const tools = glaze(), again = TL.registry();
  for (const n of [...tools.list()].reverse()) again.add(tools.get(n));
  assert.equal(JSON.stringify(V.list(state({ tools: again }))), JSON.stringify(first));
  const sorted = first.map((t) => t.name);
  assert.deepEqual(sorted, [...sorted].sort());
  // The hash: a string, the same for the same list, another when the list moves.
  const h = V.hash(first);
  assert.equal(typeof h, 'string');
  assert.ok(h.length >= 8);
  assert.equal(V.hash(V.list(flipped)), h);
  assert.notEqual(V.hash(V.list(state({ mods: [rec(ID)] }))), h);
  assert.notEqual(V.hash(V.list(state({ mods: [rec(ID), rec(OTHER, { manifest: { ...rec(OTHER).manifest, name: 'Renamed' } })] }))), h);
  assert.notEqual(V.hash([]), h);
  assert.equal(V.hash([]), V.hash([]));
});

test('mods that are not usable add nothing', () => {
  const only = (r, over = {}) => names(state({ mods: [r, rec(OTHER)], ...over })).filter((n) => n.startsWith('mod_'));
  const theirs = [`mod_${OTHER}_ask`, `mod_${OTHER}_due_soon`];
  assert.deepEqual(only(rec(ID)), MODS);
  assert.deepEqual(only(rec(ID, { enabled: false })), theirs, 'off');
  assert.deepEqual(only(rec(ID, { enabled: undefined })), theirs, 'no switch');
  assert.deepEqual(only(rec(ID, { blocked: 'This mod was blocked by Glaze.' })), theirs, 'blocked');
  for (const blocklist of [{ mods: [ID] }, { bundles: [`hash-${ID}`] }, { authors: [`key-${ID}`] }]) {
    assert.deepEqual(only(rec(ID), { blocklist }), theirs, JSON.stringify(blocklist));
  }
  assert.deepEqual(only(rec(ID), { blocklist: { mods: [] } }), MODS);
  // An unsigned copy only while dev mode is on.
  assert.deepEqual(only(rec(ID, { dev: true })), theirs, 'dev copy, dev mode off');
  assert.deepEqual(only(rec(ID, { dev: true }), { dev: true }), MODS, 'dev copy, dev mode on');
  // No agents grant, or a declarative tool's data not granted.
  assert.deepEqual(only(rec(ID, { grants: { todo: true } })), theirs);
  assert.deepEqual(only(rec(ID, { grants: { agents: true } })), [`mod_${ID}_ask`, ...theirs]);
  // Not a record.
  for (const junk of [null, 'mod', 7, {}, [], rec('notamodid'), rec(ID, { manifest: null }), rec(ID, { manifest: { name: 'X' } })]) {
    assert.deepEqual(only(junk), theirs, JSON.stringify(junk));
  }
  assert.equal(V.get(`mod_${ID}_due_soon`, state({ mods: [rec(ID, { enabled: false })] })), null);
});

test('code tools only in Chrome, once a page has found the mods sandbox working', () => {
  const code = (over) => names(state(over)).filter((n) => n.endsWith('_ask'));
  assert.deepEqual(code({}), [`mod_${ID}_ask`, `mod_${OTHER}_ask`]);
  for (const over of [{ browser: 'firefox' }, { browser: 'safari' }, { browser: undefined }, { runtime: { ok: false } }, { runtime: {} }, { runtime: undefined }, { runtime: { ok: 'yes' } }]) {
    assert.deepEqual(code(over), [], JSON.stringify(over));
    // The same mods' declarative tools stay.
    assert.deepEqual(names(state(over)).filter((n) => n.endsWith('_due_soon')), [`mod_${ID}_due_soon`, `mod_${OTHER}_due_soon`]);
    assert.equal(V.get(`mod_${ID}_ask`, state(over)), null);
  }
});

test('a Worker tool waits for approval and makes no read-only or repeat-safety promise', () => {
  const s = state();
  const t = V.get(`mod_${ID}_ask`, s), shown = V.describe(t);
  // A Worker has storage.set/remove even with no network grant (modbroker CALLS); code routing cannot prove a read.
  assert.equal(t.kind, 'confirm');
  assert.equal(typeof t.summarize, 'function');
  assert.match(t.summarize({}, {}), /Due Soon \(mod\): Ask/);
  for (const era of [undefined, '2025-11-25', '2025-06-18']) {
    const d = V.describe(t, era);
    assert.deepEqual(d.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
    assert.equal(d._meta[`${NS}approval`], 'student');
  }
  assert.equal(shown._meta[`${NS}needs`], 'tab');
});

test('duplicate records for a mod contribute no ambiguous tool, whatever their order', () => {
  const first = rec(ID), second = rec(ID, { manifest: { ...rec(ID).manifest, name: 'Other version' } });
  const a = state({ mods: [first, second, rec(OTHER)] }), b = state({ mods: [second, rec(OTHER), first] });
  assert.deepEqual(names(a).filter((n) => n.startsWith(`mod_${ID}_`)), []);
  assert.deepEqual(V.list(a), V.list(b));
  assert.equal(V.hash(V.list(a)), V.hash(V.list(b)));
  assert.equal(V.get(`mod_${ID}_ask`, a), null);
  assert.equal(V.get(`mod_${ID}_due_soon`, b), null);
  assert.ok(V.get(`mod_${OTHER}_due_soon`, a));
});

test('a mod runner retains the admitted source and filters after the caller edits its record', async () => {
  const tool = { ...DUE, where: [{ field: 'done', eq: false }], select: ['id'] };
  const r = rec(ID, { manifest: { ...rec(ID).manifest, tools: [tool] } }), asked = [];
  const s = state({ mods: [r], data: async (source) => { asked.push(source); return { items: [{ id: 'one', done: false }] }; } });
  const t = V.get(`mod_${ID}_due_soon`, s);
  tool.from = 'grades';
  tool.where[0].eq = true;
  tool.select.push('percent');
  assert.deepEqual((await t.run({}, { account: ACCOUNT })).items, [{ id: 'one' }]);
  assert.deepEqual(asked, ['todo'], 'the mod has no grades grant');
});

test("a declarative mod tool answers from the data path through GZ_MODTOOLS.apply; a code tool goes to the code runner", async () => {
  const item = (id, over) => ({ id, type: 'assignment', courseId: '42', course: 'Chem', title: `Item ${id}`, due: NOW + DAY, url: '', done: false, submitted: false, graded: false, late: false, missing: false, ...over });
  const items = [item('far', { due: NOW + 10 * DAY }), item('two', { due: NOW + 2 * DAY, courseId: '43' }), item('done', { done: true }), item('one')];
  const asked = [];
  const data = async (source, account) => { asked.push([source, account]); return { at: NOW - 60e3, items }; };
  const s = state({ data });
  const t = V.get(`mod_${ID}_due_soon`, s);
  const ctx = { account: ACCOUNT };
  const got = await t.run({ days: 7 }, ctx);
  assert.deepEqual(asked, [['todo', ACCOUNT]]);
  assert.deepEqual(Object.keys(got), ['account', 'at', 'items']);
  assert.deepEqual([got.account, got.at], [ACCOUNT, NOW - 60e3]);
  assert.deepEqual(got.items.map((x) => x.id), ['one', 'two']);
  assert.deepEqual((await t.run({ days: 7, course: '43' }, ctx)).items.map((x) => x.id), ['two']);
  assert.deepEqual((await t.run({}, ctx)).items.map((x) => x.id), ['one', 'two', 'far']);
  // What the cache says is missing is passed on; a bare list has no time.
  const none = await V.get(`mod_${ID}_due_soon`, state({ data: async () => ({ at: null, items: [], missing: 'Open the Canvas to-do list.' }) })).run({}, ctx);
  assert.deepEqual(none, { account: ACCOUNT, at: null, items: [], missing: 'Open the Canvas to-do list.' });
  assert.deepEqual(await V.get(`mod_${ID}_due_soon`, state({ data: async () => [item('one')] })).run({}, ctx), { account: ACCOUNT, at: null, items: [item('one')] });
  await assert.rejects(V.get(`mod_${ID}_due_soon`, state()).run({}, ctx), /data/);
  // Each tool reads its own entry's source: of two entries with one name (a record past mod.json's checks), the first one
  // listed, grades without its grant, gives nothing, and the second answers from to-dos.
  const twin = (from) => ({ name: 'twin', title: 'Twin', description: 'Two of a name.', from });
  const twins = rec(ID, { manifest: { ...rec(ID).manifest, permissions: P('agents', 'todo', 'grades'), tools: [twin('grades'), twin('todo'), { ...twin('courses'), title: 'Third' }] } });
  asked.length = 0;
  const tw = V.get(`mod_${ID}_twin`, state({ mods: [twins], data }));
  await tw.run({}, ctx);
  assert.deepEqual(asked, [['todo', ACCOUNT]]);
  assert.equal(tw.title, 'Due Soon (mod): Twin');
  // A code tool: its mod, its own name and the arguments, to the code runner (C14 routes it to an open tab).
  const calls = [];
  const c = V.get(`mod_${ID}_ask`, state({ code: async (...a) => { calls.push(a); return { answer: 'hi' }; } }));
  assert.deepEqual(await c.run({ q: 'why' }, ctx), { answer: 'hi' });
  assert.deepEqual(calls, [[ID, 'ask', { q: 'why' }, ctx]]);
  await assert.rejects(Promise.resolve().then(() => V.get(`mod_${ID}_ask`, state()).run({ q: 'x' }, ctx)), /code/);
});

test('MCP refuses raw output schemas in both eras because the call core adds an envelope and may omit large results', () => {
  const base = { name: 'x_tool', kind: 'read', group: 'grades', description: 'X.', run };
  for (const output of [S.obj({ items: { type: 'array' } }), { type: 'array' }, { type: 'string' }, {}, { anyOf: [S.obj({}), { type: 'null' }] }]) {
    const t = TL.define({ ...base, output });
    const tools = TL.registry(); tools.add(t);
    for (const era of [undefined, '2026-07-28', 'legacy', '2025-11-25']) {
      assert.throws(() => V.describe(t, era), /output/);
      assert.deepEqual(V.list({ tools }, era), []);
      assert.equal(V.get('x_tool', { tools }), null);
    }
  }
  const tools = glaze();
  for (const era of [undefined, '2025-11-25']) assert.ok(V.list({ tools }, era).every((t) => !Object.hasOwn(t, 'outputSchema')));
});

test("a mod's tool never takes a Glaze tool's name, owner or voice", () => {
  // A record that skipped mod.json's checks (lib/modtools.js clean): a tool named as Glaze's is, names outside the rules,
  // and a mod that calls itself Glaze.
  const tool = (name) => ({ name, title: 'Courses', description: "The student's courses.", from: 'courses' });
  const forged = rec(ID, { grants: { agents: true, courses: true }, manifest: { name: 'Glaze', permissions: P('agents', 'courses'),
    tools: [tool('courses_list'), tool('Courses_List'), tool('x'.repeat(25)), tool('a-b'), tool('../courses_list'), tool(''), { ...tool('courses_list'), title: '' }] } });
  const s = state({ mods: [forged] });
  assert.deepEqual(names(s), ['citation_insert', 'courses_list', `mod_${ID}_courses_list`, 'todo_mark_done']);
  const own = V.get('courses_list', s);
  assert.equal(own, s.tools.get('courses_list'));
  assert.equal(own.owner, undefined);
  const theirs = V.get(`mod_${ID}_courses_list`, s);
  assert.deepEqual([theirs.owner, theirs.group], [`mod:${ID}`, `mod:${ID}`]);
  const shown = of(s, `mod_${ID}_courses_list`);
  assert.equal(shown.title, 'Glaze (mod): Courses');
  assert.ok(shown.description.startsWith("Written by the mod's author, not Glaze. "));
  assert.equal(shown._meta[`${NS}group`], `mod:${ID}`);
  // A mod id that isn't one names nothing.
  for (const id of ['courses_list', `mod_${ID}`, ID.toUpperCase(), `${ID}a`]) assert.deepEqual(names(state({ tools: TL.registry(), mods: [rec(id)] })), [], id);
  // A mod's tool put into Glaze's own registry isn't listed: mod tools come only from the records of mods that can run.
  const reg = glaze();
  reg.add({ name: `mod_${OTHER}_due_soon`, owner: `mod:${OTHER}`, group: `mod:${OTHER}`, kind: 'read', description: 'Due.', run });
  assert.deepEqual(names(state({ tools: reg, mods: [] })), ['citation_insert', 'courses_list', 'todo_mark_done']);
  assert.equal(V.get(`mod_${OTHER}_due_soon`, state({ tools: reg, mods: [] })), null);
  // And the registry keys (C1) refuse a mod's tool a Glaze name, or Glaze's group.
  assert.throws(() => TL.define({ name: 'courses_list', owner: `mod:${ID}`, group: `mod:${ID}`, kind: 'read', description: 'X.', run }), /: name$/);
  assert.throws(() => TL.define({ name: `mod_${ID}_x`, owner: `mod:${ID}`, group: 'courses', kind: 'read', description: 'X.', run }), /: group$/);
});
