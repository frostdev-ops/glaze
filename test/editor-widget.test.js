// The editor's widget builder (lib/editor-widget.js): the form's blocks as the cleaner takes them, the manifest it makes (asking
// for exactly the permissions its blocks use, with reasons), versions that go up, and the prompt's words for a widget with no
// code (lib/editor-mods.js). The page itself, with real clicks, is scripts/widgets-builder-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WE = require('../lib/editor-widget.js');
const E = require('../lib/editor-mods.js');
const W = require('../lib/modwidget.js');
const M = require('../lib/modbundle.js');

const t = (k, vars = {}) => k.replace(/\{(\w+)\}/g, (s, n) => (n in vars ? String(vars[n]) : s));
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const state = (over = {}) => ({ name: 'Due Soon', author: 'Kai', tile: true, size: 'm', rail: false, why: {}, version: '1.0.0', blocks: [WE.blank('text', t), WE.blank('countdown', t)], ...over });

test('a blank block of each kind is ready to use, except a picture that is not chosen yet', () => {
  for (const type of WE.TYPES) {
    const b = WE.blank(type, t);
    assert.equal(b.type, type);
    const got = W.blocks([WE.norm(b)]);
    if (type === 'image') assert.equal(got, null, 'a picture needs a file');
    else assert.ok(got, type);
  }
  assert.ok(W.blocks([WE.norm({ ...WE.blank('image', t), src: 'img/a.png', alt: 'A' })]));
});

test('norm leaves out what the form did not fill in, and nothing that is a value', () => {
  assert.deepEqual(WE.norm({ type: 'text', text: 'x', size: '', weight: '', muted: false, color: undefined, extra: null, n: NaN }), { type: 'text', text: 'x' });
  assert.deepEqual(WE.norm({ type: 'number', value: 0, digits: 0, label: '' }), { type: 'number', value: 0, digits: 0 }, 'zero is a value');
  assert.deepEqual(WE.norm({ type: 'text', text: 'x', muted: true }), { type: 'text', text: 'x', muted: true });
});

test('the manifest asks for the permissions the blocks use, each with a reason, and nothing else', () => {
  const none = WE.manifestOf(state({ blocks: [{ type: 'text', text: 'Hello' }] }), t);
  assert.equal(none.manifest.permissions, undefined);
  const both = WE.manifestOf(state({ blocks: [{ type: 'number', value: 'grades.gpa' }, { type: 'text', text: 'Left: {todo.count}' }], why: { todo: '  Counts   what is left. ' } }), t);
  assert.deepEqual(plain(both.manifest.permissions), [{ id: 'grades', why: 'Shows your grades in this widget.' }, { id: 'todo', why: 'Counts what is left.' }]);
  assert.deepEqual(WE.need(W.blocks([{ type: 'text', text: '{{todo.count}}' }])), []);
  // The default reasons are in the student's language, and a reason too long is refused.
  assert.equal(WE.manifestOf(state({ blocks: [{ type: 'number', value: 'todo.count' }], why: { todo: 'x'.repeat(281) } }), t).problem, 'reason');
  assert.deepEqual(plain(WE.manifestOf(state({ blocks: [{ type: 'number', value: 'todo.count' }], why: { todo: '' } }), t)), { problem: 'reason', id: 'todo' }, 'an empty reason is not the default');
  assert.deepEqual(plain(WE.manifestOf(state({ blocks: [{ type: 'number', value: 'todo.count' }], why: { todo: '   ' } }), t)), { problem: 'reason', id: 'todo' }, 'a reason cleared on purpose is asked for again');
  assert.equal(WE.manifestOf(state({ blocks: [{ type: 'number', value: 'todo.count' }] }), t).manifest.permissions[0].why, 'Shows your to-dos and due dates in this widget.', 'untouched, the default');
});

test('a tile, a rail widget or both; one size; the same blocks in each', () => {
  const m = (over) => WE.manifestOf(state(over), t).manifest;
  assert.deepEqual(plain(Object.keys(m({}).ui)), ['tiles']);
  assert.deepEqual(m({}).ui.tiles[0].sizes, ['m']);
  assert.deepEqual(m({ size: 'l' }).ui.tiles[0].sizes, ['l']);
  assert.deepEqual(m({ size: 'xl' }).ui.tiles[0].sizes, ['m'], 'a size that does not exist is a medium one');
  assert.deepEqual(Object.keys(m({ tile: false, rail: true }).ui), ['rail']);
  const both = m({ rail: true });
  assert.deepEqual(Object.keys(both.ui), ['tiles', 'rail']);
  assert.deepEqual(both.ui.tiles[0].blocks, both.ui.rail[0].blocks);
  assert.deepEqual([both.ui.tiles[0].id, both.ui.rail[0].id], ['main', 'side']);
});

test('what is missing is named: the name, the author, a place, a block, a reason', () => {
  const p = (over) => plain(WE.manifestOf(state(over), t));
  assert.deepEqual(p({ name: '  ' }), { problem: 'name' });
  assert.deepEqual(p({ name: 'x'.repeat(41) }), { problem: 'name' });
  assert.deepEqual(p({ author: '' }), { problem: 'author' });
  assert.deepEqual(p({ tile: false, rail: false }), { problem: 'place' });
  assert.deepEqual(p({ blocks: [] }), { problem: 'blocks', at: -1 });
  assert.deepEqual(p({ blocks: [{ type: 'text', text: 'ok' }, { type: 'text', text: '' }, { type: 'number', value: 'next.title' }] }), { problem: 'blocks', at: 1 });
  assert.deepEqual(p({ blocks: [{ type: 'image', src: '', alt: '' }] }), { problem: 'blocks', at: 0 });
  // Markup and addresses are only text or nothing: the cleaner is the one the worker uses.
  assert.equal(WE.manifestOf(state({ blocks: [{ type: 'button', label: 'Go', action: 'https://example.com' }] }), t).problem, 'blocks');
  assert.equal(WE.manifestOf(state({ blocks: [{ type: 'text', text: '{nope.path}' }] }), t).problem, 'blocks');
  // Names and reasons are one line.
  assert.equal(WE.manifestOf(state({ name: 'A‮  B\nC' }), t).manifest.name, 'A B C');
});

test('a made manifest packs, signs and installs as the worker would read it', async () => {
  const key = await M.makeKey();
  const made = WE.manifestOf(state({ rail: true, blocks: [{ type: 'text', text: 'GPA {grades.gpa}', size: 'l' }, { type: 'image', src: 'img/picture-1.png', alt: 'Leaf', w: 40 }, { type: 'button', label: 'Go', action: 'grades', tone: 'primary' }] }), t);
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const got = await M.pack({ 'img/picture-1.png': PNG }, made.manifest, key);
  assert.equal(got.signed, true);
  assert.deepEqual(M.caps(got.manifest), ['grades']);
  assert.ok(E.plain(got.prompt) && !E.hasCode(got.prompt), 'no code, so none of the code mod warnings');
  assert.deepEqual(plain(W.slots(got.manifest).map((s) => s.key)), ['tile:main', 'rail:side']);
  assert.deepEqual(E.warnings(got.prompt, { t, and: (a) => a.join(', '), signed: true, source: 'builder', runs: false }).map((w) => w.kind), ['review'], 'only that nobody reviewed it');
});

test('versions go up from the highest the editor has seen, pre-releases too', () => {
  assert.equal(WE.bump(), '1.0.0');
  assert.equal(WE.bump(undefined, undefined), '1.0.0');
  assert.equal(WE.bump('1.0.0'), '1.0.1');
  assert.equal(WE.bump('1.0.0', '1.0.4'), '1.0.5');
  assert.equal(WE.bump('2.3.9', '2.3.10'), '2.3.11');
  assert.equal(WE.bump('1.2.3-beta.1'), '1.2.4');
  assert.equal(WE.bump(null, '0.9.0'), '0.9.1');
});

test('the Mods tab says a widget with no code stays on this device, and offers its builder only for the student\'s own', () => {
  const view = (more) => ({ glaze: 1, name: 'W', version: '1.0.0', author: { name: 'K', key: 'k'.repeat(43) }, permissions: [{ id: 'todo', why: 'Counts.' }, { id: 'grades', why: 'GPA.' }, { id: 'courses', why: 'Names.' }],
    ui: { tiles: [{ id: 'a', name: 'A', sizes: ['m'], blocks: [{ type: 'text', text: 'x' }] }] }, ...more });
  assert.deepEqual(E.lines(view(), t).map((l) => l.text), ['To Do — shows your to-dos and due dates, on this device only.', 'Grades — shows your grades and GPA, on this device only.', 'Courses — shows the names of your courses, on this device only.']);
  // With code, the words stay the ones that say it reads them.
  const code = view({ hooks: 'hooks.js' });
  assert.deepEqual(E.lines(code, t).map((l) => l.text.split(' — ')[1].split(' ')[0]), ['reads', 'reads', 'reads']);
  assert.equal(E.plain(code), false);
  assert.equal(E.plain(view({ ui: { tiles: [{ id: 'a', name: 'A', sizes: ['m'], file: 'a.html' }] } })), false);
  assert.equal(E.plain(view({ ui: {} })), false);
  assert.equal(E.sourceText('builder', t), 'Made in the widget builder');
  assert.equal(E.sourceText('somewhere', t), '');
  // The builder is on the card for a plain widget the student made, and the editor passes the callback in.
  assert.match(read('lib/editor-mods.js'), /mine && a\.canEdit\?\.\(rec\.manifest\) && a\.edit \?/);
  assert.match(read('options.js'), /edit: widgets\.edit/);
});

test('every id the builder looks up is on the page, once, and its scripts load before it', () => {
  const html = read('options.html'), js = read('lib/editor-widget.js');
  const used = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]).filter((id) => !id.includes('${')));
  assert.ok(used.size > 15);
  for (const id of used) assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
  const order = ['lib/modbundle.js', 'lib/modapi.js', 'lib/gradecalc.js', 'lib/modwidget.js', 'lib/modbroker.js', 'features/modui.js', 'lib/editor-mods.js', 'lib/editor-widget.js', 'options.js'].map((f) => html.indexOf(`<script src="${f}"></script>`));
  assert.ok(order.every((i) => i > 0) && order.every((i, k) => !k || i > order[k - 1]), String(order));
  assert.ok(html.includes('<a href="#mods/widget" data-editor-alias>Widget builder</a>') && html.includes('data-editor-section="mods/widget"'));
});

test('the builder writes only text: no markup reaches the page from a name, a reason or a block', () => {
  const src = read('lib/editor-widget.js').replace(/\/\/.*$/gm, '');
  for (const word of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'Function(']) assert.ok(!src.includes(word), word);
});

test('only manifests the builder can round-trip without losing slots or features are editable', () => {
  const m = WE.manifestOf(state({ rail: true }), t).manifest;
  assert.equal(WE.editable(m), true);
  const copy = () => structuredClone(m);
  for (const change of [
    (x) => x.ui.tiles.push({ ...structuredClone(x.ui.tiles[0]), id: 'extra' }),
    (x) => x.ui.rail[0].blocks = [{ type: 'text', text: 'Different' }],
    (x) => x.ui.tiles[0].sizes.push('l'),
    (x) => x.ui.tiles[0].id = 'other',
    (x) => x.ui.rail[0].name = 'Different',
    (x) => x.ui.nav = {},
    (x) => x.parts = {},
    (x) => x.settings = [],
    (x) => x.replaces = [],
  ]) { const x = copy(); change(x); assert.equal(WE.editable(x), false); }
  assert.match(read('lib/editor-mods.js'), /mine && a\.canEdit\?\.\(rec\.manifest\)/);
  assert.match(read('options.js'), /canEdit: widgets\.canEdit/);
});

test('decorative images retain an explicit empty alternative text', () => {
  const image = { type: 'image', src: 'img/leaf.png', alt: '' };
  assert.deepEqual(WE.norm(image), image);
  assert.deepEqual(WE.manifestOf(state({ blocks: [image] }), t).manifest.ui.tiles[0].blocks, [image]);
});

test('replacing or removing an image keeps files still used by another block', async () => {
  const vm = require('node:vm');
  const source = read('lib/editor-widget.js');
  const controls = source.slice(source.indexOf('    const control ='), source.indexOf('    const list ='));
  const drawing = source.slice(source.indexOf('    let invalid ='), source.indexOf('    // ---- what it needs'));
  for (const replace of [false, true]) {
    const first = { type: 'image', src: 'img/shared.png', alt: '' }, second = { ...first };
    const pictures = { 'img/shared.png': new Uint8Array([1]) }, st = { blocks: [first, second] };
    const list = { replaceChildren(...rows) { this.rows = rows; }, querySelector() {} };
    const h = (tag, props, ...kids) => ({ tag, props, kids: kids.flat() });
    const ctx = vm.createContext({ st, pictures, list, h, imageReads: new WeakMap(), t: (x) => x, touch() {}, set() {}, uid: 0, Uint8Array,
      PICTURE: { png: 'image/png' }, MAX_PICTURE: 256 << 10, GZ_DOCTEXT: { imageSize: () => ({ w: 1, h: 1 }) }, GZ_MODBROKER: { LIMIT: { picture: 4096 } }, TYPE_NAME: { image: 'Image' }, FIELDS: { image: [] }, $: () => ({ focus() {} }), say() {} });
    vm.runInContext(`${controls}\n${drawing}\nthis.control = control; this.drawBlocks = drawBlocks;`, ctx);
    if (replace) {
      const field = ctx.control(first, ['src', 'pic', 'Picture']);
      const input = field.kids[1].kids[0];
      await input.props.onchange({ target: { files: [{ name: 'new.png', size: 1, arrayBuffer: async () => new Uint8Array([2]).buffer }], value: '' } });
      assert.notEqual(first.src, 'img/shared.png');
    } else {
      ctx.drawBlocks('none');
      list.rows[0].kids[0].kids[3].props.onclick();
      assert.equal(st.blocks.length, 1);
    }
    assert.ok(pictures[second.src], 'the remaining image still has its file');
  }
});

test('the image picker rejects unreadable or oversized images before replacing the current file', async () => {
  const vm = require('node:vm'), source = read('lib/editor-widget.js');
  const controls = source.slice(source.indexOf('    const control ='), source.indexOf('    const list ='));
  for (const size of [null, { w: 4097, h: 1 }, { w: 1, h: 4097 }]) {
    const b = { type: 'image', src: 'img/old.png', alt: 'Old' }, pictures = { 'img/old.png': new Uint8Array([1]) }, said = [];
    const ctx = vm.createContext({
      st: { blocks: [b] }, pictures, imageReads: new WeakMap(), uid: 0, Uint8Array, t: (s) => s, say: (...a) => said.push(a), touch() {},
      PICTURE: { png: 'image/png' }, MAX_PICTURE: 256 << 10,
      GZ_DOCTEXT: { imageSize: () => size }, GZ_MODBROKER: { LIMIT: { picture: 4096 } },
      h: (tag, props, ...kids) => ({ tag, props, kids: kids.flat() }),
    });
    vm.runInContext(`${controls}\nthis.control = control;`, ctx);
    const field = ctx.control(b, ['src', 'pic', 'Picture']);
    await field.kids[1].kids[0].props.onchange({ target: { files: [{ name: 'new.png', size: 1, arrayBuffer: async () => new Uint8Array([2]).buffer }], value: '' } });
    assert.equal(b.src, 'img/old.png');
    assert.deepEqual(Object.keys(pictures), ['img/old.png']);
    assert.equal(said[0][1], true);
  }
});


test('saving a widget never changes a new draft opened while signing', async () => {
  const vm = require('node:vm'), source = read('lib/editor-widget.js');
  const code = source.slice(source.indexOf('    const save = async '), source.indexOf("    $('wb-save')"));
  const initial = state(), current = state({ name: 'New draft', version: '1.0.0' });
  let release;
  const held = new Promise((r) => { release = r; });
  const ctx = vm.createContext({ st: initial, saving: false, pictures: {}, t, manifestOf: WE.manifestOf, one: (s) => s, W: () => W, E: () => E,
    author: async () => { await held; return {}; }, local: { get: async () => ({}), set: async () => {} },
    B: () => ({ pack: async (files, m) => ({ id: 'a', manifest: m, prompt: m, version: m.version, bytes: new Uint8Array(), hash: 'h' }),
      plan: () => ({ action: 'update', newPermissions: [] }) }),
    bump: WE.bump, send: async (m) => m.op === 'list' ? { mods: [{ id: 'a', version: '1.0.5' }] } : { ok: true, action: 'update' },
    std: () => '', say() {} });
  vm.runInContext(`${code}\nthis.save = save;`, ctx);
  const saving = ctx.save(true);
  ctx.st = current;
  release();
  const got = await saving;
  assert.ok(got);
  assert.equal(got.version, '1.0.6');
  assert.equal(current.version, '1.0.0', 'the new draft keeps its version');
});


test('an older picture read cannot replace a newer choice or repopulate another draft', async () => {
  const vm = require('node:vm'), source = read('lib/editor-widget.js');
  const controls = source.slice(source.indexOf('    const control ='), source.indexOf('    const list ='));
  for (const nextDraft of [false, true]) {
    const b = { type: 'image', src: 'img/old.png', alt: '' }, pictures = { 'img/old.png': new Uint8Array([1]) };
    const ctx = vm.createContext({ st: { blocks: [b] }, pictures, imageReads: new WeakMap(), uid: 0, Uint8Array, t: (s) => s, say() {}, touch() {},
      PICTURE: { png: 'image/png' }, MAX_PICTURE: 256 << 10, GZ_DOCTEXT: { imageSize: () => ({ w: 1, h: 1 }) }, GZ_MODBROKER: { LIMIT: { picture: 4096 } },
      h: (tag, props, ...kids) => ({ tag, props, kids: kids.flat() }) });
    vm.runInContext(`${controls}\nthis.control = control;`, ctx);
    let release;
    const held = new Promise((r) => { release = r; });
    const pick = (control, name, bytes) => control.kids[1].kids[0].props.onchange({ target: { files: [{ name, size: 1, arrayBuffer: async () => bytes }], value: '' } });
    const old = pick(ctx.control(b, ['src', 'pic', 'Picture']), 'older.png', held);
    if (nextDraft) { ctx.st = { blocks: [] }; ctx.pictures = {}; }
    else await pick(ctx.control(b, ['src', 'pic', 'Picture']), 'newer.png', new Uint8Array([3]).buffer);
    release(new Uint8Array([2]).buffer);
    await old;
    if (nextDraft) assert.equal(Object.keys(ctx.pictures).length, 0, 'the old draft cannot add pictures to the new one');
    else assert.equal(ctx.pictures[b.src][0], 3, 'the most recent picture choice wins, even after controls redraw');
  }
});
