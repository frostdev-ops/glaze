// The tool keys the MCP view reads (lib/ai/tools.js define): title, group, owner, scope, needs, output and hints, each
// optional and checked; mod tools named mod_<id>_<local> in their own group, Glaze's never mod_; what aiTools sends unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const TL = require('../lib/ai/tools.js');
const S = require('../lib/ai/schema.js');

const ID = 'abcdefghijklmnop', OTHER = 'zyxwvutsrqponm23';
const base = { name: 'courses_list', kind: 'read', description: 'The student\'s courses.', parameters: S.obj({ term: S.str('Which term.') }), run: async () => [] };
const mod = { ...base, name: `mod_${ID}_due_soon`, owner: `mod:${ID}`, group: `mod:${ID}` };
const refuses = (extra, why, t = base) => assert.throws(() => TL.define({ ...t, ...extra }), (e) => e instanceof TypeError && e.message === `tool ${extra.name || t.name}: ${why}`, JSON.stringify(extra));

test('define takes the MCP keys, each optional, and keeps them on the frozen tool', () => {
  const all = { title: 'Courses', group: 'courses', owner: 'glaze', scope: 'account', needs: 'tab', output: S.obj({ items: { type: 'array' } }), hints: { idempotent: true, openWorld: false } };
  const t = TL.define({ ...base, ...all });
  for (const [k, v] of Object.entries(all)) assert.deepEqual(t[k], v, k);
  assert.ok(Object.isFrozen(t));
  for (const group of ['courses', 'grades', 'writer', 'assignments']) assert.equal(TL.define({ ...base, group }).group, group);
  assert.equal(TL.define({ ...base, scope: 'document', needs: 'writer' }).needs, 'writer');
  assert.deepEqual(TL.define({ ...base, hints: {} }).hints, {});
  assert.equal(TL.define({ ...base, title: 'x'.repeat(80) }).title.length, 80);
  const m = TL.define(mod);
  assert.equal(m.owner, `mod:${ID}`);
  assert.equal(TL.registry().add(m), m);
});

test('a tool without the new keys is defined as before, with no default written into it', () => {
  const t = TL.define(base);
  assert.deepEqual(Object.keys(t).sort(), ['description', 'kind', 'name', 'parameters', 'run']);
  assert.equal(t.owner, undefined);
});

test('mod tool titles fit the mod prefix and titles are capped at 120 characters', () => {
  const title = `${'m'.repeat(40)} (mod): ${'t'.repeat(60)}`;
  assert.equal(title.length, 108);
  assert.equal(TL.define({ ...mod, title }).title, title);
  for (const t of [base, mod]) {
    assert.equal(TL.define({ ...t, title: 'x'.repeat(120) }).title.length, 120);
    refuses({ title: 'x'.repeat(121) }, 'title', t);
  }
});

test('aiTools sends the same specs whatever MCP keys a tool carries', () => {
  const plain = [TL.define(base), TL.define({ ...base, name: 'grades_list', kind: 'confirm' })];
  const rich = [TL.define({ ...base, title: 'Courses', group: 'courses', scope: 'account', needs: 'tab', output: S.obj({}), hints: { idempotent: true } }),
    TL.define({ ...base, name: 'grades_list', kind: 'confirm', group: 'grades', owner: 'glaze' })];
  assert.deepEqual(TL.aiTools(rich), TL.aiTools(plain));
  assert.deepEqual(TL.aiTools(rich, 'read-only'), TL.aiTools(plain, 'read-only'));
  assert.deepEqual(Object.keys(TL.aiTools(rich)[0]), ['name', 'description', 'parameters']);
});

test('each MCP key refuses a value outside its rule, naming the key', () => {
  for (const title of ['', 'x'.repeat(121), 3, null]) refuses({ title }, 'title');
  for (const group of ['files', 'Courses', '', 'mod:short', `mod:${ID.toUpperCase()}`, `mod:${ID}x`, 7]) refuses({ group }, 'group');
  for (const owner of ['mod', 'someone', '', `mod:${ID.slice(1)}`, `mod:${ID}1`, `MOD:${ID}`, null]) refuses({ owner }, 'owner');
  for (const scope of ['tab', 'course', '', 1]) refuses({ scope }, 'scope');
  for (const needs of ['account', 'tabs', '', true]) refuses({ needs }, 'needs');
  for (const output of [{ type: 'object', $ref: '#/x' }, { type: 'array', items: { type: 'string' } }, { type: 'string' }, {}, 'object', null, []]) refuses({ output }, 'output');
  for (const hints of [{ readOnly: true }, { destructive: false }, { idempotent: 'yes' }, { openWorld: 1 }, [], null, 'idempotent']) refuses({ hints }, 'hints');
});

test('unknown keys are still refused', () => {
  for (const k of ['annotations', 'inputSchema', 'outputSchema', 'reason', 'tags']) refuses({ [k]: {} }, `unknown ${k}`);
});

test("Glaze's tools may not take a mod's name or group", () => {
  refuses({ name: 'mod_courses' }, 'name');
  refuses({ name: `mod_${ID}_due_soon`, owner: 'glaze' }, 'name');
  refuses({ name: `mod_${ID}_due_soon`, group: `mod:${ID}` }, 'name');
  refuses({ group: `mod:${ID}` }, 'group');
  refuses({ owner: 'glaze', group: `mod:${ID}` }, 'group');
  assert.equal(TL.define({ ...base, name: 'modules_list' }).name, 'modules_list');
});

test("a mod's tool is mod_<its id>_<local>, local [a-z][a-z0-9_]{0,23}, in the group mod:<its id>", () => {
  assert.equal(TL.define({ ...mod, name: `mod_${ID}_${'a'.repeat(24)}` }).name.length, 45);
  assert.equal(TL.define({ ...mod, name: `mod_${ID}_x` }).name, `mod_${ID}_x`);
  assert.equal(TL.define({ ...mod, name: `mod_${ID}_a1_b2` }).name, `mod_${ID}_a1_b2`);
  for (const name of ['due_soon', `mod_${OTHER}_due_soon`, `mod_${ID}_${'a'.repeat(25)}`, `mod_${ID}__x`, `mod_${ID}_1x`, `mod_${ID}_`, `mod_${ID}`, `mod_${ID}due`])
    refuses({ name }, 'name', mod);
  refuses({ group: undefined }, 'group', mod);
  refuses({ group: 'courses' }, 'group', mod);
  refuses({ group: `mod:${OTHER}` }, 'group', mod);
  refuses({ owner: `mod:${OTHER}`, group: `mod:${OTHER}` }, 'name', mod);
});

test('isGroup: the four first-party groups and mod:<id>, nothing else', () => {
  for (const g of [...TL.GROUPS, `mod:${ID}`]) assert.equal(TL.isGroup(g), true, g);
  assert.deepEqual(TL.GROUPS, ['courses', 'grades', 'writer', 'assignments']);
  for (const g of ['files', `mod:${ID}x`, 'mod:', `mod_${ID}`, '', null, undefined, 7, ['courses']]) assert.equal(TL.isGroup(g), false, String(g));
});
