// lib/pm.js, ProseMirror for the writer frame (scripts/vendor-prosemirror.sh): the script installs exact, integrity-pinned
// versions with install scripts off and checks them before esbuild runs; the checked-in files are the recorded build; and
// the bundle is a classic script that sets GZ_PM to working packages. These tests never run the script (it installs from
// the network).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const script = read('scripts/vendor-prosemirror.sh');
const code = script.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const variable = (name) => script.match(new RegExp(`^${name}=(\\S+)\\s*$`, 'm'))?.[1];
const packages = () => script.match(/^packages="([^"]*)"/m)[1].split(/\s+/).filter(Boolean);
const pins = () => new Map((script.match(/<<'EOF'\n([\s\S]*?)\nEOF/)?.[1] ?? '').split('\n').filter((l) => l.trim()).map((l) => l.trim().split(/\s+/)));
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex');
const NAMES = ['model', 'state', 'view', 'transform', 'commands', 'keymap', 'history', 'inputrules', 'schemaList', 'tables', 'dropcursor', 'gapcursor'];

test('the install is exact, ignores install scripts, uses the public registry, and every package is pinned', () => {
  const install = code.replace(/\\\n\s*/g, ' ').match(/npm install[^\n]*/)?.[0] ?? '';
  assert.match(install, /--ignore-scripts/);
  assert.match(install, /\$packages "esbuild@\$esbuild_version"/);
  assert.match(install, /--registry https:\/\/registry\.npmjs\.org\//);
  assert.doesNotMatch(code, /\bnpx\b|@latest|\^\d|~\d/);
  const pinned = pins();
  for (const p of packages()) {
    assert.match(p, /^prosemirror-[a-z-]+@\d+\.\d+\.\d+$/, p);
    assert.match(pinned.get(p) ?? '', /^sha512-[A-Za-z0-9+/]{86}==$/, `${p} has a pinned integrity`);
  }
  for (const dep of ['orderedmap', 'rope-sequence', 'w3c-keyname', 'esbuild']) assert.ok([...pinned.keys()].some((id) => id.startsWith(`${dep}@`)), dep);
  assert.equal(packages().length, NAMES.length, 'one package per GZ_PM name');
});

test('the integrity check runs on the installed tree before esbuild does, and the build must match the recorded hashes', () => {
  const check = code.indexOf('npm-integrity.js'), run = code.indexOf('.bin/esbuild');
  assert.ok(check > 0 && run > check, 'verify first, then execute');
  for (const [name, file] of [['file_sha256', 'lib/pm.js'], ['css_sha256', 'lib/pm.css']]) {
    assert.match(variable(name), /^[0-9a-f]{64}$/, name);
    assert.equal(sha256(file), variable(name), `rebuild ${file} with scripts/vendor-prosemirror.sh and record the new hash, rather than editing it by hand`);
  }
  assert.match(read('lib/pm.js').split('\n')[0], /^\/\/ ProseMirror \(MIT, lib\/pm\.LICENSE\): prosemirror-model@/);
  const license = read('lib/pm.LICENSE');
  for (const p of packages()) assert.ok(license.includes(`==== ${p.replace('@', ' ')} ====`), `${p}'s license ships`);
});

test('lib/pm.js is a readable classic script: no modules, no code made from text, not minified', () => {
  const src = read('lib/pm.js');
  assert.match(src, /^var GZ_PM = globalThis\.GZ_PM \|\| \(\(\) => \{$/m);
  assert.match(src.trimEnd(), /\nGZ_PM;$/);
  assert.doesNotMatch(src, /^\s*(import|export)\s/m);
  assert.doesNotMatch(src, /\bimport\(|\beval\(|new Function\b|\bFunction\(|\b(un)?escape\(/);
  const lines = src.split('\n');
  assert.ok(lines.length > 10000 && Math.max(...lines.map((l) => l.length)) < 1000, 'not minified: lines as the sources have them');
});

const load = () => {
  const ctx = vm.createContext({ console });
  vm.runInContext(read('lib/pm.js'), ctx, { filename: 'lib/pm.js' });
  return ctx;
};

test('GZ_PM names every package, and loading it twice keeps the first copy', () => {
  const ctx = load();
  const pm = ctx.GZ_PM;
  for (const name of NAMES) assert.equal(typeof pm[name], 'object', name);
  assert.equal(typeof pm.model.Schema, 'function');
  assert.equal(typeof pm.view.EditorView, 'function');
  assert.equal(typeof pm.tables.tableEditing, 'function');
  vm.runInContext(read('lib/pm.js'), ctx);
  assert.equal(ctx.GZ_PM, pm);
});

test('a schema with lists, a state with history and a keymap: typing and undo round-trip', () => {
  const { model, state, history, keymap, schemaList, commands } = load().GZ_PM;
  const base = new model.Schema({
    nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*', toDOM: () => ['p', 0] }, text: {} },
    marks: { strong: { toDOM: () => ['strong', 0] } },
  });
  const schema = new model.Schema({ nodes: schemaList.addListNodes(base.spec.nodes, 'paragraph block*', 'block'), marks: base.spec.marks });
  assert.ok(schema.nodes.bullet_list && schema.nodes.ordered_list && schema.nodes.list_item);
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('The river')])]);
  let s = state.EditorState.create({ doc, plugins: [history.history(), keymap.keymap({ 'Mod-z': history.undo }), keymap.keymap(commands.baseKeymap)] });
  s = s.apply(s.tr.insertText(' keeps', s.doc.content.size - 1));
  assert.equal(s.doc.textContent, 'The river keeps');
  let undone = null;
  assert.equal(history.undo(s, (tr) => { undone = s.apply(tr); }), true);
  assert.equal(undone.doc.textContent, 'The river');
  assert.equal(history.redoDepth(undone), 1);
  assert.equal(model.Node.fromJSON(schema, s.doc.toJSON()).eq(s.doc), true, 'a document survives JSON');
});
