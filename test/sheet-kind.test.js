// Spreadsheets on the Documents page: the storage layout (sheet-data.js: a book in the record, a part per sheet per 1,000-row
// band, the change test, measure, search text, the 6×4 card text, packed versions), the worker's write path for parts
// (lib/writer-papers.js), and sheet-kind.js's registration behind Settings → Writer → Spreadsheets (writer.sheets). The grid
// itself is scripts/sheets-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const M = require('../lib/sheet-model.js');
const SD = require('../sheet-data.js');
const PA = require('../lib/writer-papers.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const put = (sh, r, c, cell) => { if (!sh.rows.has(r)) sh.rows.set(r, new Map()); sh.rows.get(r).set(c, cell); };
const book = () => {
  const wb = M.workbook();
  const a = wb.sheets[0];
  put(a, 0, 0, { t: 's', v: 'Name' }); put(a, 0, 1, { t: 's', v: 'Score' }); put(a, 1, 0, { t: 's', v: 'Ada' }); put(a, 1, 1, { t: 'n', v: 91.5, s: 1 });
  put(a, 999, 2, { t: 'b', v: true }); put(a, 1000, 0, { t: 'n', v: 3, f: 'B2+1' }); put(a, 2500, 4, { t: 'e', v: '#DIV/0!', f: '1/0' });
  put(a, 3, 3, { t: 's', v: 'rich', rich: [{ text: 'ri', b: true }, { text: 'ch' }] });
  a.colW.set(0, 18); a.rowH.set(2, 30); a.hidden.rows.add(5); a.hidden.cols.add(7);
  a.merges.push({ r0: 10, c0: 0, r1: 11, c1: 2 }); a.freeze = { rows: 1, cols: 0 }; a.filter = { r0: 0, c0: 0, r1: 1, c1: 1 };
  const b = M.sheet('Totals', 2);
  put(b, 0, 0, { t: 'n', v: 91.5, f: 'Sheet1!B2' });
  wb.sheets.push(b);
  wb.styles.push({ fmt: '0.0' });
  wb.names.push({ name: 'Top', ref: 'Sheet1!$B$2' });
  wb.keep.parts['xl/media/image1.png'] = new Uint8Array([137, 80, 78, 71, 0, 255]);
  return wb;
};
const same = (a, b) => assert.equal(SD.serialize(a), SD.serialize(b));

test('a workbook is a book (all but its cells) and a part per sheet per 1,000-row band; join gives it back', () => {
  const wb = book(), { book: bk, parts } = SD.split(wb);
  assert.equal(SD.BAND, 1000);
  assert.deepEqual([...parts.keys()].sort(), ['1:0', '1:1', '1:2', '2:0']);
  assert.ok(!JSON.stringify(bk).includes('Ada'), 'the book holds no cells');
  assert.equal(bk.sheets[0].name, 'Sheet1');
  assert.deepEqual(parts.get('1:2'), [[2500, [[4, 'e', '#DIV/0!', '1/0']]]]);
  // The book and parts are plain JSON; kept binaries are tagged so a store can take them later.
  const back = SD.join(JSON.parse(JSON.stringify(bk)), new Map(JSON.parse(JSON.stringify([...parts]))));
  same(back, wb);
  assert.ok(back.sheets[0].rows instanceof Map && back.sheets[0].hidden.rows instanceof Set);
  assert.deepEqual([...back.keep.parts['xl/media/image1.png']], [137, 80, 78, 71, 0, 255]);
  assert.deepEqual(back.sheets[0].rows.get(3).get(3).rich, [{ text: 'ri', b: true }, { text: 'ch' }]);
});

test('the change test: only bands whose content changed are written, the book only when it changed, an emptied band dropped', () => {
  const wb = book();
  const first = SD.plan(wb, new Map());
  assert.deepEqual(Object.keys(first.parts).sort(), ['1:0', '1:1', '1:2', '2:0']);
  assert.ok(first.book && first.changed);
  assert.deepEqual(first.drop, []);
  const again = SD.plan(wb, first.sigs);
  assert.deepEqual([Object.keys(again.parts), again.book, again.drop, again.changed], [[], undefined, [], false], 'nothing changed: nothing written');
  wb.sheets[0].rows.get(1000).set(1, { t: 's', v: 'x' });
  const one = SD.plan(wb, again.sigs);
  assert.deepEqual([Object.keys(one.parts), one.book, one.changed], [['1:1'], undefined, true]);
  wb.sheets[0].rows.delete(2500);
  const gone = SD.plan(wb, one.sigs);
  assert.deepEqual([Object.keys(gone.parts), gone.drop], [[], ['1:2']]);
  wb.sheets[1].name = 'Sums';
  const named = SD.plan(wb, gone.sigs);
  assert.ok(named.book && named.book.sheets[1].name === 'Sums' && !Object.keys(named.parts).length);
  // Rows inserted at the top move every band of that sheet: each that differs is written.
  M.apply(wb, { op: 'insert', sheet: 1, axis: 'row', at: 0, n: 1 });
  const moved = SD.plan(wb, named.sigs);
  assert.deepEqual(Object.keys(moved.parts).sort(), ['1:0', '1:1']);
  // The sigs are a change test, not JSON compares of the whole: a 32-bit hash per part.
  for (const v of moved.sigs.values()) assert.match(v, /^[0-9a-f]{8}$/);
});

test('measure: cells and sheets; the search text is the cells\' text, bounded', () => {
  const wb = book();
  assert.deepEqual(SD.measure(wb), { cells: 9, sheets: 2 });
  const text = SD.text(wb, (sh, r, c, x) => String(x.v));
  assert.match(text, /Name\tScore/);
  assert.match(text, /Ada\t91\.5/);
  assert.match(text, /Totals/);
  const big = M.workbook();
  for (let r = 0; r < 3000; r++) put(big.sheets[0], r, 0, { t: 's', v: 'word '.repeat(5) });
  assert.ok(SD.text(big).length <= SD.TEXT_CAP);
});

test('the card: the active sheet\'s A1:F4 as display text, 4 rows of 6, each bounded', () => {
  const wb = book();
  const g = SD.glance(wb, (sh, r, c, x) => (x.t === 'n' ? x.v.toFixed(1) : String(x.v)));
  assert.equal(g.length, 4);
  for (const row of g) assert.equal(row.length, 6);
  assert.deepEqual(g[0].slice(0, 2), ['Name', 'Score']);
  assert.deepEqual(g[1].slice(0, 2), ['Ada', '91.5']);
  assert.equal(g[3][3], 'rich');
  put(wb.sheets[0], 0, 5, { t: 's', v: 'x'.repeat(500) });
  assert.ok(SD.glance(wb)[0][5].length <= 40);
  wb.active = 1;
  assert.equal(SD.glance(wb)[0][0], '91.5');
  assert.ok(SD.isGlance(g) && !SD.isGlance([['a']].concat(Array(9).fill([]))) && !SD.isGlance('x'));
});

test('versions: the workbook packed as gzip and base64, back the same; 16 MB of them per spreadsheet', async () => {
  const wb = book();
  const gz = await SD.pack(wb);
  assert.match(gz, /^[A-Za-z0-9+/]+=*$/);
  same(await SD.unpack(gz), wb);
  assert.equal(SD.VERSIONS_CAP, 16e6);
  const big = M.workbook();
  for (let r = 0; r < 2000; r++) put(big.sheets[0], r, 0, { t: 's', v: `row ${r} of a long column of words` });
  const packed = await SD.pack(big);
  assert.ok(packed.length < SD.serialize(big).length / 4, `gzip shrinks it (${packed.length})`);
  await assert.rejects(SD.unpack('not base64 gzip'));
});

// A stand-in chrome.storage.local that counts its writes.
const store = () => {
  const data = {}, sets = [];
  return { data, sets, get: async (k) => { const ks = Array.isArray(k) ? k : [k]; return Object.fromEntries(ks.filter((x) => data[x] !== undefined).map((x) => [x, JSON.parse(JSON.stringify(data[x]))])); },
    set: async (o) => { sets.push(Object.keys(o).sort()); for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const KEY = 'doc:00000000-0000-4000-8000-000000000001';

test('a sheet save writes its changed parts, the record and the index in one set(), each part under the record\'s revision', async () => {
  let t = 1000;
  const s = store(), P = PA.open(s, () => t, { versions: async () => 40 });
  const wb = book(), first = SD.plan(wb, new Map());
  const r = await P.save(KEY, { kind: 'sheet', book: first.book, title: 'Grades', named: true }, { parts: first.parts, changed: true });
  assert.equal(s.sets.length, 1, 'one write');
  assert.deepEqual(s.sets[0], [`writerPaper:${KEY}`, 'writerPapers', ...['1:0', '1:1', '1:2', '2:0'].map((n) => `writerSheet:${KEY}:${n}`)].sort());
  const rec = s.data[`writerPaper:${KEY}`];
  assert.equal(rec.kind, 'sheet');
  assert.deepEqual(rec.parts, { '1:0': 1, '1:1': 1, '1:2': 1, '2:0': 1 });
  assert.equal(s.data[`writerSheet:${KEY}:1:0`].rev, r.paper.revision);
  // Read back as the page reads it: the record and its parts, one get each.
  const got = await SD.read((ks) => s.get(ks), KEY);
  same(got.wb, wb);
  assert.equal(got.rec.revision, 1);
  // The next save: the one changed band, under the new revision; the others keep theirs.
  wb.sheets[0].rows.get(1).set(0, { t: 's', v: 'Grace' });
  const next = SD.plan(wb, first.sigs);
  t += 1000;
  await P.save(KEY, { ...(next.book && { book: next.book }) }, { parts: next.parts, drop: next.drop, changed: next.changed });
  assert.deepEqual(s.sets[1], [`writerPaper:${KEY}`, 'writerPapers', `writerSheet:${KEY}:1:0`].sort());
  assert.deepEqual(s.data[`writerPaper:${KEY}`].parts, { '1:0': 2, '1:1': 1, '1:2': 1, '2:0': 1 });
  assert.equal(s.data[`writerPaper:${KEY}`].edited, 2, 'a parts write is an edit');
  same((await SD.read((ks) => s.get(ks), KEY)).wb, wb);
  // A rename alone is no edit.
  await P.save(KEY, { title: 'Grades 2', named: true });
  assert.equal(s.data[`writerPaper:${KEY}`].edited, 2);
});

test('write(): the changed parts, the card\'s text, search text and counts in one save; nothing when nothing changed', async () => {
  let t = 1;
  const s = store(), P = PA.open(s, () => t, { versions: async () => 40 });
  const wb = book();
  const first = await SD.write(P, KEY, wb, new Map(), { patch: { title: 'Grades', named: true }, version: { reason: 'start', gz: await SD.pack(wb), cells: 9 } });
  const rec = s.data[`writerPaper:${KEY}`];
  assert.deepEqual([rec.kind, rec.title, rec.cells, rec.sheets, rec.grid[0][0], rec.text.slice(0, 10)], ['sheet', 'Grades', 9, 2, 'Name', 'Sheet1\nNam']);
  assert.deepEqual(s.data.writerPapers[0].grid, rec.grid, 'the index row carries the card\'s text');
  assert.equal((await P.versions(KEY)).length, 1);
  const writes = s.sets.length;
  const same2 = await SD.write(P, KEY, wb, first.sigs);
  assert.equal(same2.saved, null);
  assert.equal(s.sets.length, writes, 'nothing changed: nothing sent');
  wb.sheets[1].rows.get(0).set(1, { t: 's', v: 'new' });
  t++;
  const next = await SD.write(P, KEY, wb, first.sigs, { dirty: new Set(['2:0']) });
  assert.deepEqual(s.sets[s.sets.length - 1], [`writerPaper:${KEY}`, 'writerPapers', `writerSheet:${KEY}:2:0`].sort());
  assert.ok(next.saved.paper.revision === 2);
  // A refused write keeps the old sigs: the next one tries the same parts again.
  const failing = { save: async () => { throw new Error('paper storage unavailable'); } };
  wb.sheets[1].rows.get(0).set(2, { t: 's', v: 'more' });
  await assert.rejects(SD.write(failing, KEY, wb, next.sigs, { dirty: new Set(['2:0']) }));
});

test('a part from another write is a torn read: read() tries again, then gives up', async () => {
  const s = store(), P = PA.open(s, () => 5, { versions: async () => 40 });
  const wb = book(), first = SD.plan(wb, new Map());
  await P.save(KEY, { kind: 'sheet', book: first.book }, { parts: first.parts, changed: true });
  s.data[`writerSheet:${KEY}:1:1`].rev = 99;
  await assert.rejects(SD.read((ks) => s.get(ks), KEY), /torn/);
  let calls = 0;
  const healing = async (ks) => { const got = await s.get(ks); if (++calls === 2) s.data[`writerSheet:${KEY}:1:1`].rev = 1; return got; };
  same((await SD.read(healing, KEY)).wb, wb);
  delete s.data[`writerSheet:${KEY}:1:2`];
  await assert.rejects(SD.read((ks) => s.get(ks), KEY), /torn/, 'a missing part is torn too');
  assert.equal(await SD.read((ks) => s.get(ks), 'doc:00000000-0000-4000-8000-0000000000ff'), null, 'no record');
});

test('drop removes parts after the write; Delete forever and the 30-day purge take every part', async () => {
  let t = 0;
  const s = store(), P = PA.open(s, () => t, { versions: async () => 40 });
  const wb = book(), first = SD.plan(wb, new Map());
  await P.save(KEY, { kind: 'sheet', book: first.book }, { parts: first.parts, changed: true });
  wb.sheets[0].rows.delete(2500);
  const next = SD.plan(wb, first.sigs);
  await P.save(KEY, {}, { parts: next.parts, drop: next.drop, changed: true });
  assert.equal(s.data[`writerSheet:${KEY}:1:2`], undefined);
  assert.deepEqual(Object.keys(s.data[`writerPaper:${KEY}`].parts).sort(), ['1:0', '1:1', '2:0']);
  await P.remove(KEY);
  assert.deepEqual(Object.keys(s.data).filter((k) => k.includes(KEY)), [], 'remove takes the record, its versions and its parts');
  // Purge: a sheet in Trash past 30 days goes with its parts.
  const K2 = 'doc:00000000-0000-4000-8000-000000000002';
  await P.save(K2, { kind: 'sheet', book: first.book }, { parts: first.parts, changed: true });
  await P.trash(K2);
  t += 31 * 864e5;
  assert.deepEqual(await P.purge(), [K2]);
  assert.deepEqual(Object.keys(s.data).filter((k) => k.includes(K2)), []);
});

test('part names are the sheet kind\'s own and stay under the record\'s key', async () => {
  const s = store(), P = PA.open(s, () => 1, { versions: async () => 40 });
  for (const bad of ['../x', '', 'a'.repeat(100), '1:0:extra:more:than:allowed:x', 'writerPaper:x']) {
    await assert.rejects(P.save(KEY, { kind: 'sheet' }, { parts: { [bad]: { rows: [] } }, changed: true }), /part/, bad);
  }
  await assert.rejects(P.save(KEY, { kind: 'sheet' }, { drop: ['../../x'], changed: true }), /part/);
  assert.deepEqual(s.sets, []);
});

test('a sheet\'s versions are its packed copies, kept to 16 MB, the newest always', async () => {
  let t = 0;
  const s = store(), P = PA.open(s, () => t, { versions: async () => 40 });
  const wb = book(), first = SD.plan(wb, new Map());
  const gz = await SD.pack(wb);
  const r = await P.save(KEY, { kind: 'sheet', book: first.book }, { parts: first.parts, changed: true, version: { reason: 'start', gz, cells: 9 } });
  assert.equal(r.version.reason, 'start');
  assert.equal(r.paper.lastVersion, 0);
  const list = await P.versions(KEY);
  assert.deepEqual(list.map((v) => [v.reason, v.kind, v.cells, v.bytes, v.gz]), [['start', 'sheet', 9, gz.length, undefined]], 'the list leaves the packed copy out');
  const v = await P.version(KEY, list[0].id);
  same(await SD.unpack(v.gz), wb);
  // 6 MB each: the third pushes the oldest out past 16 MB.
  for (let i = 0; i < 3; i++) { t += 1000; await P.save(KEY, {}, { changed: true, version: { reason: 'auto', gz: 'A'.repeat(6e6), cells: i } }); }
  const kept = await P.versions(KEY);
  assert.deepEqual(kept.map((x) => x.cells), [2, 1]);
  assert.ok(kept.reduce((n, x) => n + x.bytes, 0) <= SD.VERSIONS_CAP);
  // A paper's 4 MB cap is untouched.
  assert.equal(PA.CAP.bytes, 4e6);
});

// sheet-kind.js in a context of its own: the registry, a storage.sync answering writer.sheets, need() a no-op.
const load = (writer, overrides = {}) => {
  delete require.cache[require.resolve('../lib/doc-kinds.js')];
  delete globalThis.GZ_DOC_KINDS;
  const DK = require('../lib/doc-kinds.js');
  const ctx = vm.createContext({ GZ_DOC_KINDS: DK, GZ_WRITER_PAPER: { need: async () => {} }, console, URL, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, RangeError, Error, Promise, Object, Array, String, Number, Math, JSON, Map, Set, btoa, atob, ...overrides,
    chrome: { storage: { sync: { get: async () => (writer === undefined ? {} : { writer }) }, local: overrides.local || { get: async () => ({}) } }, runtime: { getURL: (f) => `chrome-extension://x/${f}` } } });
  ctx.globalThis = ctx;
  vm.runInContext(read('sheet-kind.js'), ctx);
  return { DK, ctx };
};

test('papers.html loads sheet-kind.js after papers.js with its stylesheet; both package lists ship the sheet files', () => {
  const html = read('papers.html');
  const at = (src) => html.indexOf(`<script src="${src}"></script>`);
  assert.ok(at('lib/doc-kinds.js') > 0 && at('lib/doc-kinds.js') < at('papers.js'), 'the registry before papers.js');
  assert.ok(at('sheet-kind.js') > at('papers.js'), 'sheet-kind.js after papers.js');
  assert.ok(html.includes('<link rel="stylesheet" href="sheet.css">'));
  const pkg = read('package.sh').split('\n').filter((l) => / papers\.js /.test(l));
  assert.equal(pkg.length, 2, 'chmod and zip');
  for (const line of pkg) for (const f of ['sheet-kind.js', 'sheet-grid.js', 'sheet-data.js', 'sheet.css']) assert.ok(line.includes(` ${f} `), `${f} in: ${line.slice(0, 40)}…`);
});

test('off (the default): spreadsheets still open, copy and export; Documents neither creates nor imports them', async () => {
  for (const writer of [undefined, { sheets: false }, { sheets: 'yes' }, { full: true }]) {
    const { DK } = load(writer);
    await DK.settled();
    const k = DK.get('sheet');
    for (const f of ['edit', 'thumb', 'file', 'exportFile', 'copy', 'text', 'measure']) assert.equal(typeof k[f], 'function', `${f}: ${JSON.stringify(writer)}`);
    assert.equal(k.importFile, undefined);
    assert.equal(k.create, undefined, 'no Spreadsheet tile');
    assert.equal(DK.opens('Grades.xlsx'), null);
    assert.equal(DK.opens('grades.csv'), null);
    assert.ok(!/xlsx|csv|spreadsheet/.test(DK.accept()));
  }
});

test('on: the sheet kind creates and imports', async () => {
  const { DK } = load({ sheets: true });
  await DK.settled();
  const k = DK.get('sheet');
  for (const f of ['edit', 'thumb', 'exportFile', 'importFile', 'create', 'measure', 'file', 'text', 'copy']) assert.equal(typeof k[f], 'function', f);
  assert.equal(DK.opens('Grades.xlsx'), 'sheet');
  assert.equal(DK.opens('grades.CSV'), 'sheet');
  assert.equal(k.label, 'Spreadsheet');
  assert.equal(k.exportLabel, 'Export .csv', 'without the .xlsx writer, a .csv');
  const withXlsx = load({ sheets: true }, { GZ_SHEET_XLSX: { read: async () => null, write: async () => new Uint8Array() } });
  await withXlsx.DK.settled();
  assert.equal(withXlsx.DK.get('sheet').exportLabel, 'Export .xlsx');
  assert.deepEqual(Object.keys(k.says).sort(), ['read', 'size']);
});

test('the card is the record\'s 6×4 text; its text and measure come from the record, not its parts', async () => {
  const { DK } = load({ sheets: true });
  await DK.settled();
  const k = DK.get('sheet');
  const rec = { kind: 'sheet', book: { sheets: [] }, text: 'Name\tScore', cells: 9, sheets: 2, grid: [['Name', 'Score', '', '', '', ''], ['Ada', '91.5', '', '', '', ''], ['', '', '', '', '', ''], ['', '', '', '', '', '']] };
  assert.equal(k.text(rec), 'Name\tScore');
  assert.deepEqual({ ...k.measure(rec) }, { cells: 9, sheets: 2 }, 'from the page\'s realm');
  assert.equal(k.text({}), '');
});

// An assignment's frame (writer-kinds.js on the integration lane): the grid as the attempt's view, a brought spreadsheet as
// the attempt's record (into: the paper kept as a version, parts the record had dropped), a blank start (empty).
test('the assignment frame\'s hooks: view, into over a paper, empty', async () => {
  const s = store(), P = PA.open(s, () => 1000, { versions: async () => 40 }), K = 'bb.school.test|_900_1|_101_1|_7_1';
  await P.save(K, { kind: 'paper', doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'my draft' }] }] }, title: 'Lab 3' });
  const G = require('../sheet-grid.js');
  for (const f of ['date', 'math', 'info']) require(`../lib/sheet-fn-${f}.js`);
  const { DK } = load({ sheets: true }, { local: s, GZ_WRITER_PAPERS: { ...PA, open: () => P }, GZ_SHEET_MODEL: M, GZ_SHEET_DATA: SD, GZ_SHEET_GRID: G, GZ_SHEET_CALC: require('../lib/sheet-calc.js'),
    GZ_SHEET_NUMFMT: require('../lib/sheet-numfmt.js'), CompressionStream, DecompressionStream, Response, Blob });
  await DK.settled();
  const k = DK.get('sheet');
  assert.equal(typeof k.view, 'function');
  const file = (name, text) => ({ name, size: Buffer.byteLength(text), arrayBuffer: async () => { const b = Buffer.from(text); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
  // The vm's chrome.storage.local reads the same stand-in store the worker writes.
  const rec = await k.into(K, file('scores.csv', 'Name,Score\nAda,91\nGrace,=B2-3\n'));
  assert.deepEqual([rec.kind, rec.doc, rec.words, rec.cells, rec.title], ['sheet', null, 0, 6, 'Lab 3']);
  const versions = await P.versions(K);
  assert.ok(versions.some((v) => v.reason === 'import' && v.words === 2), 'the paper it held is kept as a version');
  const got = await SD.read((ks) => s.get(ks), K);
  assert.equal(got.wb.sheets[0].rows.get(2).get(1).v, 88, 'its formulas calculated');
  // A second spreadsheet over it leaves none of the first's parts.
  const big = 'x\n'.repeat(1500);
  await k.into(K, file('long.csv', big));
  await k.into(K, file('short.csv', 'only\n'));
  assert.deepEqual(Object.keys(s.data).filter((x) => x.startsWith(`writerSheet:${K}:`)), [`writerSheet:${K}:1:0`]);
  await assert.rejects(k.into(K, file('book.xlsx', 'PK')), (e) => e instanceof RangeError || e.name === 'RangeError', 'an .xlsx without the reader is refused');
  const e = k.empty();
  assert.ok(SD.isGlance(JSON.parse(JSON.stringify(e.grid))) && e.cells === 0 && e.sheets === 1 && !('book' in e));
});

test('two editors refuse a stale spreadsheet save before any bands or history change', async () => {
  const s = store(), P = PA.open(s, () => 1), wb = book();
  await SD.write(P, KEY, wb, new Map());
  const a = await SD.read((ks) => s.get(ks), KEY), b = await SD.read((ks) => s.get(ks), KEY);
  put(a.wb.sheets[0], 1, 0, { t: 's', v: 'newer tab' });
  await SD.write(P, KEY, a.wb, a.sigs);
  const before = JSON.stringify(s.data);
  put(b.wb.sheets[0], 1000, 0, { t: 's', v: 'older tab' });
  await assert.rejects(SD.write(P, KEY, b.wb, b.sigs), /changed in another tab/);
  assert.equal(JSON.stringify(s.data), before, 'refusal cannot publish a mixture of the two workbooks');
  same((await SD.read((ks) => s.get(ks), KEY)).wb, a.wb);
});
