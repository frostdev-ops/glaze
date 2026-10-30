// The SDK (types/glaze.d.ts, docs/mods-api.md) against what Glaze implements: every name on the `glaze` object that
// mods/host.js builds is in the type file and the docs, and every name in the type file is on the object. The events,
// the palette tokens, the effect names and the components are held to the code that sends, reads and draws them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const dts = read('types/glaze.d.ts');
const docs = read('docs/mods-api.md');
const sorted = (set) => [...set].sort();

// The `glaze` object as a mod gets it: the client mods/host.js sends as source, run here with a stand-in port.
const client = () => {
  const source = read('mods/host.js').match(/function glazeClient\(port\) \{[\s\S]*?\n    return glaze;\n  \}/)[0];
  const port = { postMessage() {}, addEventListener() {}, start() {} };
  return vm.runInContext(`(${source})`, vm.createContext({ setTimeout, performance }))(port);
};
const names = (o, prefix = '') => Object.keys(o).flatMap((k) => (typeof o[k] === 'function' ? [prefix + k] : names(o[k], `${prefix}${k}.`)));

// An interface's body, and its members: the names at its own indentation, with the interface a property names (`storage: GlazeStorage`).
const body = (name) => {
  const text = dts.match(new RegExp(`^interface ${name} \\{\\n([\\s\\S]*?)^\\}`, 'm'))?.[1];
  assert.ok(text, `interface ${name}`);
  return text;
};
const members = (name) => [...body(name).matchAll(/^ {2}(?:'([\w.]+)'|(\w+))\??(?:<[^>]*>)?(\(|: (Glaze\w+);)/gm)].map((m) => ({ name: m[1] || m[2], type: m[4] }));
const keys = (name) => [...body(name).matchAll(/^ {2}(?:'([\w.]+)'|(\w+))\??:/gm)].map((m) => m[1] || m[2]);
const walk = (name, prefix = '') => members(name).flatMap((m) => (m.type ? walk(m.type, `${prefix}${m.name}.`) : [`${prefix}${m.name}`]));
// The members of a union type alias or an interface keyed by string literals: 'a' | 'b'.
const literals = (alias) => new Set([...dts.match(new RegExp(`^type ${alias} =\\s*([^;]*);`, 'm'))[1].matchAll(/'([\w.-]+)'/g)].map((m) => m[1]));

test('every name on the glaze object is in the type file, and every name in the type file is on the object', () => {
  const real = names(client());
  assert.ok(real.length >= 20, `${real.length} names`);
  assert.deepEqual(sorted(new Set(walk('Glaze'))), sorted(new Set(real)));
});

test('the docs show every call as glaze.<name>', () => {
  for (const name of names(client())) assert.ok(docs.includes(`glaze.${name}(`), `glaze.${name} is not in docs/mods-api.md`);
});

test('the events: the type file, the docs and the code that sends them agree', () => {
  const typed = new Set(keys('GlazeEvents'));
  const page = read('features/mods.js'), host = read('mods/host.js');
  // The names sent in features/mods.js: emit(id, 'x'), emitAll('x'), tell('x'), send('x') and { event: 'x' }; a data event is
  // told by the permission it needs (NEEDS). 'palette.run' is the palette's own call back into the mod, not a mod's event.
  const sent = new Set([...page.matchAll(/(?:emit\([^,]+, |emitAll\(|tell\(|send\(|event: )'([\w.]+)'/g)].map((m) => m[1]));
  for (const k of page.match(/const NEEDS = \{([^}]*)\}/)[1].matchAll(/(\w+):/g)) sent.add(k[1]);
  sent.delete('palette.run');
  assert.deepEqual(sorted(typed), sorted(sent));
  // The client itself hears these two before the mod, and only Workers hear the canvas ones.
  for (const e of typed) assert.ok(page.includes(`'${e}'`) || host.includes(`'${e}'`), `${e} is sent nowhere`);
  for (const e of typed) assert.ok(docs.includes(`\`${e}\``), `event ${e} is not in docs/mods-api.md`);
});

test('the palette tokens, effect kinds and shapes are Glaze\'s own', () => {
  const D = require('../defaults.js'), MX = require('../lib/motionx.js');
  assert.deepEqual(sorted(literals('GlazeColor')), sorted(D.GZ_COLORS.map(([v]) => v.slice(5))));
  assert.deepEqual(sorted(literals('GlazeEffectKind')), sorted(MX.KINDS));
  assert.deepEqual(sorted(literals('GlazeShape')), sorted(MX.SHAPES));
  assert.deepEqual(sorted(literals('GlazeSlot')), ['background', 'nav']);
  for (const t of MX.KINDS) assert.ok(docs.includes(`\`${t}\``), t);
});

test('the components: the type file, the docs and the drawing code have the same twelve', () => {
  const drawn = new Set([...read('features/modui.js').matchAll(/case '(\w+)'/g)].map((m) => m[1]));
  const typed = new Set([...dts.matchAll(/^ {2}type: '(\w+)';/gm)].map((m) => m[1]));
  assert.equal(drawn.size, 12);
  assert.deepEqual(sorted(typed), sorted(drawn));
  assert.deepEqual(sorted(new Set([...dts.match(/^type GlazeNode =([^;]*);/m)[1].matchAll(/Glaze(\w+)/g)].map((m) => m[1].toLowerCase()))), sorted(drawn).concat().sort());
  for (const c of drawn) assert.ok(docs.includes(`\`${c}\``), `component ${c} is not in docs/mods-api.md`);
});

test('every example is listed in the docs', () => {
  for (const d of fs.readdirSync(path.join(__dirname, '..', 'examples', 'mods'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
    assert.ok(docs.includes(`examples/mods/${d.name}`), d.name);
  }
  assert.ok(docs.includes('examples/looks/shader-background'));
});


test('Look overrides expose every supported background kind in the SDK', () => {
  const XP = require('../lib/lookparts.js');
  assert.ok(XP.clean({ bg: { media: { type: 'video', src: 'https://media.example/loop.webm', fit: 'cover', dim: 40, loop: true } } }));
  const bg = body('GlazeLookParts');
  for (const key of ['shader', 'layers', 'media']) assert.match(bg, new RegExp(`\\b${key}\\?:`), key);
  const media = bg.match(/media\?: \{([^}]*)\}/)?.[1];
  assert.ok(media, 'the media background has its own fields');
  for (const field of ['type', 'src', 'fit', 'dim', 'loop']) assert.match(media, new RegExp(`\\b${field}\\??:`), field);
  for (const value of [...XP.MEDIA.types, ...XP.MEDIA.fits]) assert.ok(media.includes(`'${value}'`), value);
});

test('mod.json tools: the type file has each source\'s fields and each kind of tool\'s keys, and the docs name them', () => {
  const T = require('../lib/modtools.js');
  assert.deepEqual(sorted(literals('GlazeTodoField')), sorted(Object.keys(T.FIELDS.todo)));
  assert.deepEqual(Object.keys(T.FIELDS.schedule), Object.keys(T.FIELDS.todo));
  assert.deepEqual(sorted(literals('GlazeCourseField')), sorted(Object.keys(T.FIELDS.courses)));
  assert.deepEqual(sorted(literals('GlazeGradeField')), sorted(Object.keys(T.FIELDS.grades)));
  // A tool interface's keys, with those of the one it extends.
  const toolKeys = (name) => {
    const m = dts.match(new RegExp(`^interface ${name}(?: extends (\\w+))? \\{\\n([\\s\\S]*?)^\\}`, 'm'));
    assert.ok(m, `interface ${name}`);
    return [...(m[1] ? toolKeys(m[1]) : []), ...[...m[2].matchAll(/^ {2}(\w+)\??:/gm)].map((x) => x[1])];
  };
  const DATA = ['GlazeTodoTool', 'GlazeCourseTool', 'GlazeGradeTool'];
  for (const name of DATA) assert.deepEqual(sorted(toolKeys(name)), sorted(T.KEYS.data), name);
  assert.deepEqual(sorted(toolKeys('GlazeCodeTool')), sorted(T.KEYS.code));
  assert.deepEqual(sorted(new Set([...dts.match(/^type GlazeTool =([^;]*);/m)[1].matchAll(/Glaze\w+/g)].map((m) => m[0]))), sorted([...DATA, 'GlazeCodeTool']));
  const froms = DATA.flatMap((name) => [...dts.match(new RegExp(`^interface ${name}[^{]*\\{[\\s\\S]*?^ {2}from: ([^;]*);`, 'm'))[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
  assert.deepEqual(sorted(froms), sorted(T.SOURCES));
  // The docs: the field, the permission, each source and every key a tool takes.
  assert.ok(docs.includes('| `tools` |'), 'tools in the mod.json table');
  assert.ok(docs.includes('| `agents` |'), 'agents in the permissions table');
  assert.ok(docs.includes('### `tools`'));
  for (const k of new Set([...T.SOURCES, ...T.KEYS.data, ...T.KEYS.code])) assert.ok(docs.includes(`\`${k}\``), k);
});
