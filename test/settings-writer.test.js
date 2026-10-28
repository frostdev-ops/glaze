// Settings → Writer: the `writer` settings key every Writer part reads (defaults.js GZ_SPEC.writer), its reader in the frame
// (lib/writer-settings.js) and the gate on the editor's input rules, the section in options.html, its words in the five
// catalogues, docs/features.md's lines, and the backup carrying it. Each switch in a browser is scripts/settings-writer-check.js
// (the section) and the writer-proof, writer-compose and writer-submit checks (the behaviour).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const D = require('../defaults.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// The names stream F's files read (writer-paper.js, writer-ruler.js, writer-paste.js) and the defaults the brief fixes.
test('the writer key: every name, its default, and what it takes', () => {
  assert.deepEqual(D.GZ_DEFAULTS.writer, {
    format: 'mla9', zoom: 'fit', ruler: true, pasteAsk: true, versions: 40, proofing: true, dialect: 'en-US',
    autocorrect: { typos: true, capitalI: true, doubles: true, smart: true },
    compose: { markdown: true, target: true, quote: true },
    submit: { rememberText: true, text: false },
  });
  const ST = require('../lib/writer-styles.js');
  assert.deepEqual(D.GZ_SPEC.writer.format[1], ST.IDS, 'the formats are lib/writer-styles.js IDS');
  // The paper's zoom menu (writer-paper.js) as percents.
  const steps = /\.\.\.\[([\d., ]+)\]\.map\(\(z\) => \(\{ label: `\$\{z \* 100\}%`/.exec(read('writer-paper.js'));
  assert.ok(steps, 'writer-paper.js zoom steps');
  assert.deepEqual(D.GZ_SPEC.writer.zoom[1], ['fit', ...steps[1].split(',').map((z) => Math.round(+z * 100))]);
  assert.equal(D.GZ_DEFAULTS.writer.versions, require('../lib/writer-papers.js').CAP.versions, 'the versions kept today');
  assert.deepEqual(D.GZ_SPEC.writer.versions[1], [10, 25, 40, 50, 100]);
  assert.deepEqual(D.GZ_SPEC.writer.dialect[1], ['en-US', 'en-GB', 'en-CA', 'en-AU']);
});

test('the writer key sanitises part by part: junk back to its default, the rest kept, idempotent', () => {
  const raw = { writer: { format: 'apa7', zoom: 125, ruler: false, pasteAsk: 'no', versions: 33, proofing: false, dialect: 'en-NZ',
    autocorrect: { typos: false, smart: 1, extra: true }, compose: 'off', submit: { rememberText: false, text: true } } };
  const w = D.GZ_SANITIZE(raw).writer;
  assert.deepEqual(w, { format: 'apa7', zoom: 125, ruler: false, pasteAsk: true, versions: 40, proofing: false, dialect: 'en-US',
    autocorrect: { typos: false, capitalI: true, doubles: true, smart: true }, compose: { markdown: true, target: true, quote: true },
    submit: { rememberText: false, text: true } });
  assert.deepEqual(D.GZ_SANITIZE(D.GZ_SANITIZE(raw)).writer, w);
  assert.equal(D.GZ_SANITIZE({ writer: { zoom: '100' } }).writer.zoom, 'fit', 'a percent is a number');
  // A fresh object each time: editing one never edits the defaults.
  const a = D.GZ_SANITIZE({}).writer;
  a.autocorrect.typos = false;
  assert.equal(D.GZ_DEFAULTS.writer.autocorrect.typos, true);
});

test('backup: the export (Settings, sanitised) carries writer, and a restore reads it back', () => {
  const s = D.GZ_SANITIZE({ writer: { versions: 100, autocorrect: { smart: false }, submit: { text: true } } });
  const back = D.GZ_SANITIZE(JSON.parse(JSON.stringify({ ...s })));
  assert.deepEqual(back.writer, s.writer);
  // options.js's export spreads the whole state; its restore sanitises the file.
  assert.match(read('options.js'), /const settings = \{ \.\.\.s, nav, navbar/);
  assert.match(read('options.js'), /const next = \{ \.\.\.GZ_SANITIZE\(raw\)/);
});

// ---- lib/writer-settings.js -------------------------------------------------------------------------------------------
const reader = (stored) => {
  const listeners = [];
  let value = stored;
  const sync = { get: async () => (value === undefined ? {} : { writer: value }), set: async (o) => { const old = value; value = o.writer; for (const fn of listeners) fn({ writer: { oldValue: old, newValue: value } }, 'sync'); } };
  const prev = globalThis.chrome;
  globalThis.chrome = { storage: { sync, onChanged: { addListener: (fn) => listeners.push(fn) } } };
  delete require.cache[require.resolve('../lib/writer-settings.js')];
  delete globalThis.GZ_WRITER_SETTINGS;
  const W = require('../lib/writer-settings.js');
  delete globalThis.GZ_WRITER_SETTINGS;
  return { W, sync, restore: () => { globalThis.chrome = prev; }, value: () => value };
};

test('the frame reads writer once, follows each change, and patches one part without losing another', async () => {
  const r = reader({ autocorrect: { smart: false }, zoom: 150 });
  try {
    assert.equal(r.W.now().autocorrect.smart, true, 'the defaults until the read lands');
    const seen = [];
    r.W.follow((w) => seen.push([w.autocorrect.smart, w.zoom, w.compose.target]));
    await r.W.load();
    assert.deepEqual(seen, [[false, 150, true]]);
    await r.sync.set({ writer: { ...r.value(), compose: { target: false } } });
    assert.deepEqual(seen.at(-1), [false, 150, false], 'live through onChanged');
    await r.W.patch((w) => ({ ...w, submit: { ...w.submit, text: true } }));
    assert.deepEqual(r.value().submit, { rememberText: true, text: true });
    assert.equal(r.value().zoom, 150, 'the rest stays');
    assert.equal(r.value().compose.target, false);
  } finally { r.restore(); }
});

// ---- the gate on the editor's input rules ---------------------------------------------------------------------------------
const E = require('../lib/writer-editor.js'), S = require('../lib/writer-schema.js'), O = require('../lib/writer-objects.js');
const W = require('../lib/writer-settings.js');
const typer = (mode, off) => {
  const gate = W.gate((cls) => off.includes(cls), { GZ_PM, GZ_WRITER_EDITOR: E });
  const extra = mode === 'paper' && O.plugins ? O.plugins(S.paper) : [];
  const view = { composing: false, state: null, dispatch(tr) { this.state = this.state.apply(tr); } };
  view.state = E.state({ html: '', mode, plugins: [gate, ...extra] });
  const type = (text) => {
    for (const ch of text) {
      const { from, to } = view.state.selection;
      if (!view.state.plugins.some((p) => p.props.handleTextInput?.call(p, view, from, to, ch))) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  };
  return { view, type, text: () => S.text(view.state.doc).text, html: () => S.serialize(view.state.schema, view.state.doc) };
};

test('gate: smart quotes and dashes off go in as typed; on, the editor curls them', () => {
  let e = typer('compose', ['smart']);
  e.type('"Hi," she said -- it\'s late.');
  assert.equal(e.text(), '"Hi," she said -- it\'s late.');
  e = typer('compose', []);
  e.type('"Hi," she said -- it\'s late.');
  assert.equal(e.text(), '“Hi,” she said — it’s late.');
});

test('gate: Markdown shortcuts off stay as typed; smart quotes still curl; on, they format', () => {
  let e = typer('compose', ['markdown']);
  e.type('- item **bold** "q"');
  assert.equal(e.text(), '- item **bold** “q”');
  assert.doesNotMatch(e.html(), /<ul|<strong/);
  e = typer('compose', []);
  e.type('- item **bold**');
  assert.match(e.html(), /<ul/);
  assert.match(e.html(), /<strong>bold<\/strong>/);
});

test('gate: with smart dashes off, a paper\'s --- still draws its line (another plugin\'s rule gets the key first)', () => {
  if (!O.plugins) return;
  const e = typer('paper', ['smart']);
  e.type('---');
  assert.ok(e.view.state.doc.firstChild.type.name === 'horizontal_rule', e.view.state.doc.toString());
});

test('gate: the editor\'s rules plugin is the one just before its history', () => {
  const e = typer('compose', ['smart']);
  const list = e.view.state.plugins, h = list.findIndex((p) => p.key === 'history$');
  assert.ok(h > 0 && list[h - 1].spec.isInputRules);
});

// ---- the section -----------------------------------------------------------------------------------------------------
const html = read('options.html');
const leaves = (o, pre) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? leaves(v, `${pre}.${k}`) : [`${pre}.${k}`]));

test('Settings → Writer: its own tab and six sections, the two switches first, a control for every setting', () => {
  assert.match(html, /data-editor-tab="writer"[^>]*>Writer</);
  const jumps = /<div data-editor-jumps="writer"[^>]*>(.*?)<\/div>/.exec(html);
  assert.ok(jumps, 'the Writer jumps');
  assert.deepEqual([...jumps[1].matchAll(/href="#(writer\/[a-z]+)"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]),
    [['writer/setup', 'Writer'], ['writer/papers', 'Papers'], ['writer/typing', 'Typing'], ['writer/proofing', 'Proofing'], ['writer/discussions', 'Discussions'], ['writer/submitting', 'Submitting']]);
  const panel = /<div id="panel-writer"[^]*?(?=<div id="panel-)/.exec(html)?.[0];
  assert.ok(panel, 'panel-writer');
  const keys = [...panel.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.slice(0, 2), ['enhance.writer', 'enhance.writerUploads'], 'the two existing switches come first');
  assert.equal((html.match(/data-key="enhance\.writer"/g) || []).length, 1, 'and only here');
  for (const k of leaves(D.GZ_DEFAULTS.writer, 'writer').filter((k) => k !== 'writer.submit.text')) assert.ok(keys.includes(k), k);
  // Every switch explains itself in its info popover, as the existing two do; nothing else under it.
  for (const k of keys) assert.match(panel, new RegExp(`data-key="${k.replace(/\./g, '\\.')}"[^>]*aria-describedby="info-${k.replace(/\./g, '-')}"`), `${k} has its info popover`);
  for (const id of ['writer-papers', 'writer-clear-all', 'writer-words', 'writer-words-clear']) assert.match(panel, new RegExp(`id="${id}"`), id);
  assert.match(html, /<dialog id="writer-clear"/);
  assert.match(html, /<script src="lib\/editor-writer\.js"><\/script>/);
});

test('every word lib/editor-writer.js shows is in the five catalogues', () => {
  const src = read('lib/editor-writer.js');
  const words = [...src.matchAll(/\bt\('((?:[^'\\]|\\.)+)'/g)].map((m) => m[1].replace(/\\(.)/g, '$1'));
  assert.ok(words.length > 5);
  for (const f of ['de', 'es', 'fr', 'nl', 'pt-BR']) {
    delete globalThis.GZ_LANGS?.[f];
    require(`../i18n/${f}.js`);
    for (const w of words) assert.ok(Object.hasOwn(globalThis.GZ_LANGS[f], w) && globalThis.GZ_LANGS[f][w] !== w || /^[\d\s%]+$/.test(w), `${f}: ${w}`);
  }
});

test('docs/features.md lists each Writer setting in one line', () => {
  const doc = read('docs/features.md');
  const section = /Settings → Writer[^]*?(?=\n## |\n### |$)/.exec(doc)?.[0] || '';
  for (const label of ['Format for new papers', 'Zoom', 'Ruler', 'Versions kept', 'Clear papers', 'Fix typos', 'Capital I and sentence starts', 'Doubled words and spaces',
    'Smart quotes and dashes', 'Ask how to paste formatting', 'Spelling and grammar', 'Dialect', 'Personal dictionary', 'Markdown shortcuts', 'Word target',
    'Quote while replying', 'Remember']) assert.ok(section.includes(label), label);
});

// ---- the dialect, in the one Harper worker ------------------------------------------------------------------------------
test('dialect: the worker builds Harper in the dialect asked for, and switches a running one', async () => {
  const vm = require('node:vm');
  const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
  const made = [], set = [];
  class LocalLinter {
    constructor(o) { made.push(o.dialect); }
    async setup() {} async importWords() {} async lint() { return []; } async dispose() {}
    async setDialect(d) { set.push(d); }
  }
  const ctx = vm.createContext({ LocalLinter, Dialect: { American: 0, British: 1, Australian: 2, Canadian: 3 }, slimBinary: {}, crypto: { randomUUID: () => 'w' }, performance,
    onconnect: null, close() {}, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(read('lib/harper/shared.js').replace(/^import .*;\n/gm, ''), ctx);
  const p = { got: [], postMessage(m) { this.got.push(m); }, close() {} };
  ctx.onconnect({ ports: [p] });
  const send = (m) => p.onmessage({ data: m });
  send({ op: 'dialect', dialect: 'en-GB' }); await flush();
  send({ op: 'lint', id: 1, text: 'colour' }); await flush();
  assert.deepEqual(made, [1], 'built British');
  send({ op: 'dialect', dialect: 'en-AU' }); await flush();
  send({ op: 'dialect', dialect: 'en-NZ' }); await flush();
  assert.deepEqual(set, [2], 'switched to Australian; one it does not know is refused');
  send({ op: 'stats', id: 2 }); await flush();
  assert.equal(p.got.find((m) => m.op === 'stats').dialect, 'en-AU');
});
