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
    format: 'mla9', zoom: 'fit', ruler: true, lightPage: false, full: false, pasteAsk: true, versions: 40, proofing: true, dialect: 'en-US',
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
  const raw = { writer: { format: 'apa7', zoom: 125, ruler: false, full: 'yes', pasteAsk: 'no', versions: 33, proofing: false, dialect: 'en-NZ',
    autocorrect: { typos: false, smart: 1, extra: true }, compose: 'off', submit: { rememberText: false, text: true } } };
  const w = D.GZ_SANITIZE(raw).writer;
  assert.deepEqual(w, { format: 'apa7', zoom: 125, ruler: false, lightPage: false, full: false, pasteAsk: true, versions: 40, proofing: false, dialect: 'en-US',
    autocorrect: { typos: false, capitalI: true, doubles: true, smart: true }, compose: { markdown: true, target: true, quote: true },
    submit: { rememberText: false, text: true } });
  assert.deepEqual(D.GZ_SANITIZE(D.GZ_SANITIZE(raw)).writer, w);
  assert.equal(D.GZ_SANITIZE({ writer: { zoom: '100' } }).writer.zoom, 'fit', 'a percent is a number');
  for (const n of D.GZ_SPEC.writer.versions[1]) assert.equal(D.GZ_SANITIZE({ writer: { versions: n } }).writer.versions, n, `${n} versions kept`);
  assert.equal(D.GZ_SANITIZE({ writer: { full: true } }).writer.full, true, 'Full writer kept');
  // A fresh object each time: editing one never edits the defaults.
  const a = D.GZ_SANITIZE({}).writer;
  a.autocorrect.typos = false;
  assert.equal(D.GZ_DEFAULTS.writer.autocorrect.typos, true);
});

test('backup: the export (Settings, sanitised) carries writer, and a restore reads it back', () => {
  const s = D.GZ_SANITIZE({ writer: { versions: 100, autocorrect: { smart: false }, submit: { text: true } } });
  const back = D.GZ_SANITIZE(JSON.parse(JSON.stringify({ ...s })));
  assert.deepEqual(back.writer, s.writer);
  assert.equal(back.writer.versions, 100);
  // options.js's export spreads the whole state; its restore sanitises the file.
  assert.match(read('options.js'), /const settings = \{ \.\.\.s, nav, navbar/);
  assert.match(read('options.js'), /const next = \{ \.\.\.GZ_SANITIZE\(raw\)/);
});

test('only two numeric endpoints declare a range; mixed choices keep their types', () => {
  const spec = D.GZ_SPEC.writer.versions, rule = spec[1];
  try {
    spec[1] = [10, 'all'];
    for (const n of spec[1]) assert.equal(D.GZ_SANITIZE({ writer: { versions: n } }).writer.versions, n);
    assert.equal(D.GZ_SANITIZE({ writer: { versions: 25 } }).writer.versions, 40);
    spec[1] = [10, 100];
    assert.equal(D.GZ_SANITIZE({ writer: { versions: 55 } }).writer.versions, 55);
    assert.equal(D.GZ_SANITIZE({ writer: { versions: '55' } }).writer.versions, 40);
  } finally { spec[1] = rule; }
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

test('a settings change during the initial read wins over its older snapshot', async () => {
  const r = reader({ autocorrect: { smart: true } });
  try {
    let release;
    r.sync.get = () => new Promise((resolve) => { release = resolve; });
    const loading = r.W.load();
    await r.sync.set({ writer: { autocorrect: { smart: false } } });
    release({ writer: { autocorrect: { smart: true } } });
    await loading;
    assert.equal(r.W.now().autocorrect.smart, false);
  } finally { r.restore(); }
});

// ---- the gate on the editor's input rules ---------------------------------------------------------------------------------
const E = require('../lib/writer-editor.js'), S = require('../lib/writer-schema.js'), O = require('../lib/writer-objects.js');
const typer = (mode, off) => {
  const extra = mode === 'paper' && O.plugins ? O.plugins(S.paper) : [];
  const view = { composing: false, state: null, dispatch(tr) { this.state = this.state.apply(tr); } };
  view.state = E.state({ html: '', mode, plugins: extra, rulesOff: (cls) => off.includes(cls) });
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

test('the editor filters its input rules directly and follows live changes', () => {
  const off = ['smart', 'markdown'], e = typer('compose', off);
  e.type('"plain" **plain** ');
  assert.equal(e.text(), '"plain" **plain** ');
  assert.doesNotMatch(e.html(), /<strong/);
  off.length = 0;
  e.type('"curled" **bold**');
  assert.match(e.text(), /“curled”/);
  assert.match(e.html(), /<strong>bold<\/strong>/);
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
  // Existing switches keep their info popovers; Light page and Full writer are self-explanatory.
  for (const k of keys.filter((k) => k !== 'writer.lightPage' && k !== 'writer.full')) assert.match(panel, new RegExp(`data-key="${k.replace(/\./g, '\\.')}"[^>]*aria-describedby="info-${k.replace(/\./g, '-')}"`), `${k} has its info popover`);
  assert.match(panel, /data-key="writer\.lightPage" aria-labelledby="writer-lightPage-name"/);
  assert.doesNotMatch(panel, /id="info-writer-lightPage"/);
  // Full writer (writer.full): the compact box's off switch, in Papers after Light page, its label the switch's own.
  assert.match(panel, /data-key="writer\.lightPage"[^\n]*\n<div class="wr-row"><span class="wr-name" id="writer-full-name">Full writer<\/span><input type="checkbox" data-key="writer\.full" aria-labelledby="writer-full-name"><\/div>/);
  for (const id of ['writer-paper-list', 'writer-clear-all', 'writer-words', 'writer-words-clear']) assert.match(panel, new RegExp(`id="${id}"`), id);
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
    for (const w of words) assert.ok(Object.hasOwn(globalThis.GZ_LANGS[f], w) && (globalThis.GZ_LANGS[f][w] !== w || w === 'Documents') || /^[\d\s%]+$/.test(w), `${f}: ${w}`);
  }
});

test('docs/features.md lists each Writer setting in one line', () => {
  const doc = read('docs/features.md');
  const section = /Settings → Writer[^]*?(?=\n## |\n### |$)/.exec(doc)?.[0] || '';
  for (const label of ['Format for new papers', 'Zoom', 'Ruler', 'Full writer', 'Versions kept', 'Clear papers', 'Fix typos', 'Capital I and sentence starts', 'Doubled words and spaces',
    'Smart quotes and dashes', 'Ask how to paste formatting', 'Spelling and grammar', 'Dialect', 'Personal dictionary', 'Markdown shortcuts', 'Word target',
    'Quote while replying', 'Remember']) assert.ok(section.includes(label), label);
});

// ---- the dialect, in the one Harper worker ------------------------------------------------------------------------------
test('dialect: the worker builds Harper in the dialect asked for, and switches a running one', async () => {
  const vm = require('node:vm');
  const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
  const made = [], linted = [];
  class LocalLinter {
    constructor(o) { this.dialect = o.dialect; made.push(o.dialect); }
    async setup() {} async importWords() {} async lint() { linted.push(this.dialect); return []; } async dispose() {}
    async setDialect(d) { this.dialect = d; }
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
  send({ op: 'lint', id: 3, text: 'colour' }); await flush();
  assert.deepEqual(linted, [1, 2], 'the next lint is Australian; an unknown dialect is refused');
  send({ op: 'stats', id: 2 }); await flush();
  assert.equal(p.got.find((m) => m.op === 'stats').dialect, 'en-AU');
});

test('papers by course, from the paper index; the dictionary as kept', () => {
  const WE = require('../lib/editor-writer.js');
  const rows = [
    { key: 'bb.school.test|_9_1|_101_1|_7_1', course: 'ENG 101' }, { key: 'bb.school.test|_9_1|_101_1|_8_1', course: '' },
    { key: 'bb.school.test|_9_1|_202_1|_7_1', course: 'HIS 210' }, { key: 'broken' }, null,
  ];
  assert.deepEqual(WE.byCourse(rows).map((c) => [c.name, c.keys.length]), [['ENG 101', 2], ['HIS 210', 1]]);
  assert.deepEqual(WE.byCourse([{ key: 'bb.school.test|_9_1|_303_1|_1_1' }])[0].name, '_303_1', 'a course with no name shows its id');
  assert.deepEqual(WE.words(['a', 3, '', ' ', 'B']), ['a', 'B']);
  assert.deepEqual(WE.FORMATS, require('../lib/writer-styles.js').IDS.map((id) => [id, require('../lib/writer-styles.js').FORMATS[id].label]));
});

test('a word taken out of the personal dictionary is unknown again: the worker forgets it and builds Harper again', async () => {
  const vm = require('node:vm');
  const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
  let built = 0, disposed = 0;
  const imported = [];
  class LocalLinter {
    constructor() { built++; }
    async setup() {} async importWords(w) { imported.push([...w]); } async dispose() { disposed++; }
    async lint(text) { return text.includes('rememory') ? [{ span: () => ({ start: 0, end: 8 }), lint_kind: () => 'Spelling', message: () => 'm', get_problem_text: () => 'rememory', suggestions: () => [] }] : []; }
  }
  const ctx = vm.createContext({ LocalLinter, Dialect: { American: 0 }, slimBinary: {}, crypto: { randomUUID: () => 'w' }, performance, onconnect: null, close() {}, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(read('lib/harper/shared.js').replace(/^import .*;\n/gm, ''), ctx);
  const p = { got: [], postMessage(m) { this.got.push(m); }, close() {} };
  ctx.onconnect({ ports: [p] });
  const send = async (m) => { p.onmessage({ data: m }); await flush(); };
  await send({ op: 'dict', words: ['rememory', 'Sethe'] });
  await send({ op: 'lint', id: 1, text: 'rememory' });
  assert.equal(p.got.find((m) => m.id === 1).lints.length, 0, 'known while in the dictionary');
  await send({ op: 'undict', words: ['Rememory'] });
  await send({ op: 'lint', id: 2, text: 'rememory' });
  assert.equal(p.got.find((m) => m.id === 2).lints.length, 1, 'flagged once taken out');
  assert.deepEqual([built, disposed], [2, 1], 'Harper built again without it');
  assert.deepEqual(imported.at(-1), ['sethe']);
});


test('Settings groups standalone and recovery documents so every counted paper is visible', () => {
  const WE = require('../lib/editor-writer.js'), PA = require('../lib/writer-papers.js');
  const keys = [PA.newKey(), 'recovery:1234'];
  const groups = WE.byCourse(keys.map((key) => ({ key })));
  assert.deepEqual(groups, [{ id: 'documents', name: 'Documents', keys }]);
});

test('Settings lists and counts no document in Trash, and Clear all clears those too', () => {
  const WE = require('../lib/editor-writer.js'), PA = require('../lib/writer-papers.js');
  const doc = PA.newKey(), binned = PA.newKey(), paper = 'bb.school.test|_9_1|_101_1|_7_1', gone = 'bb.school.test|_9_1|_101_1|_8_1';
  const rows = [{ key: doc }, { key: binned, trashed: 1 }, { key: paper, course: 'ENG 101' }, { key: gone, course: 'ENG 101', trashed: 2 }];
  assert.deepEqual(WE.byCourse(rows).map((c) => [c.name, c.keys]), [['Documents', [doc]], ['ENG 101', [paper]]]);
  assert.deepEqual(WE.allKeys(rows).sort(), [doc, binned, paper, gone].sort());
});


test('Clear all stays enabled with only Trash and confirms every paper it removes', async () => {
  const vm = require('node:vm'), WE = require('../lib/editor-writer.js'), PA = require('../lib/writer-papers.js');
  const source = read('lib/editor-writer.js'), from = source.indexOf('    const drawPapers = '), to = source.indexOf("    dialog.addEventListener('close'", from);
  const nodes = new Map(), $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', replaceChildren() {}, showModal() {}, focus() {} });
    return nodes.get(id);
  };
  await vm.runInNewContext(`(async () => { let courses, everything, asked; ${source.slice(from, to).replace('    let asked = null;', '')} await drawPapers(); ask(everything); })()`, {
    $, papers: () => ({ list: async () => [{ key: PA.newKey(), trashed: 1 }] }), byCourse: WE.byCourse, allKeys: WE.allKeys,
    t: (k, v) => k.replace('{n}', v?.n), away: () => false, console,
  });
  assert.equal($('writer-papers-count').textContent, '', 'the list count skips Trash');
  assert.equal($('writer-clear-all').disabled, false, 'Clear all can still remove Trash');
  assert.equal($('writer-clear-title').textContent, 'Clear all papers and documents?');
  assert.equal($('writer-clear-ok').textContent, 'Clear all');
  assert.match($('writer-clear-note').textContent, /^1 papers and documents\./, 'the confirmation counts what it deletes');
});

test('each Clear… confirms and reports what it clears: a course’s papers, Documents, or papers and documents', async () => {
  const vm = require('node:vm'), WE = require('../lib/editor-writer.js'), PA = require('../lib/writer-papers.js');
  const source = read('lib/editor-writer.js'), from = source.indexOf('    const drawPapers = '), to = source.indexOf("    $('writer-clear-all').addEventListener", from);
  const rows = [{ key: PA.newKey() }, { key: 'bb.school.test|_9_1|_101_1|_7_1', course: 'ENG 101' }];
  // Settings' papers code with stand-ins for the page; each removal redraws, as storage.onChanged does there.
  const panel = async (remove) => {
    const nodes = new Map(), hints = [], $ = (id) => {
      if (!nodes.has(id)) nodes.set(id, { textContent: '', on: {}, replaceChildren() {}, showModal() {}, focus() {}, addEventListener(type, fn) { this.on[type] = fn; } });
      return nodes.get(id);
    };
    const p = await vm.runInNewContext(`(async () => { let courses, everything; ${source.slice(from, to)} await drawPapers(); return { ask, drawPapers, courses: () => courses, everything: () => everything }; })()`, {
      $, el: () => ({ setAttribute() {}, addEventListener() {}, append() {} }),
      papers: () => ({ list: async () => rows, remove: async (k) => { await p.drawPapers(); return remove(k); } }), byCourse: WE.byCourse, allKeys: WE.allKeys,
      t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (s, x) => (x in v ? v[x] : s)), away: () => false, o: { hint: (m, err) => hints.push([m, err]) }, console: { error() {} },
    });
    return async (pick) => {
      p.ask(pick(p));
      const dialog = $('writer-clear');
      dialog.returnValue = 'ok';
      await dialog.on.close();
      return [$('writer-clear-title').textContent, $('writer-clear-ok').textContent, ...hints.at(-1)];
    };
  };
  const course = (p) => p.courses().filter((c) => c.id !== 'documents'), documents = (p) => p.courses().filter((c) => c.id === 'documents'), all = (p) => p.everything();
  const cleared = await panel(async () => {});
  assert.deepEqual(await cleared(course), ['Clear ENG 101’s papers?', 'Clear papers', 'Papers cleared.', false]);
  assert.deepEqual(await cleared(documents), ['Clear documents?', 'Clear documents', 'Documents cleared.', false]);
  assert.deepEqual(await cleared(all), ['Clear all papers and documents?', 'Clear all', 'Papers and documents cleared.', false]);
  const refused = await panel(async () => { throw Error('busy'); });
  assert.deepEqual(await refused(course), ['Clear ENG 101’s papers?', 'Clear papers', 'Some papers could not be cleared. Try again.', true]);
  assert.deepEqual(await refused(documents), ['Clear documents?', 'Clear documents', 'Some documents could not be cleared. Try again.', true]);
  assert.deepEqual(await refused(all), ['Clear all papers and documents?', 'Clear all', 'Some papers and documents could not be cleared. Try again.', true]);
});
