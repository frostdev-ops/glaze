// The mounted grid's saving and keyboard lifecycle, with real workbook/storage code and a small DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const M = require('../lib/sheet-model.js'), SD = require('../sheet-data.js'), PA = require('../lib/writer-papers.js');
const CALC = require('../lib/sheet-calc.js'), NF = require('../lib/sheet-numfmt.js');
require('../lib/sheet-fn-math.js');
const source = fs.readFileSync(require.resolve('../sheet-grid.js'), 'utf8');
const KEY = 'doc:00000000-0000-4000-8000-000000000001';
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
const frame = (options = {}) => {
  const doc = { activeElement: null, hidden: false, listeners: [] }, life = {}, timers = new Map(), data = {};
  let tick = 0;
  const store = { get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => data[k] !== undefined).map((k) => [k, structuredClone(data[k])])),
    set: async (values) => Object.assign(data, structuredClone(values)), remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; } };
  const P = PA.open(store);
  const element = (tag) => {
    const el = new El(tag, doc), set = el.setAttribute.bind(el);
    el.setAttribute = (k, v) => { set(k, v); if (k === 'hidden') el.hidden = true; if (k === 'disabled') el.disabled = true; };
    el.insertBefore = (child, at) => { if (at) at.before(child); else el.append(child); };
    el.setSelectionRange = (start, end) => { el.selectionStart = start; el.selectionEnd = end; };
    el.select = () => el.setSelectionRange(0, el.value.length);
    el.matches = (selector) => require('./stand-in-dom.js').matches(el, selector);
    el.classList = { toggle() {} };
    el.scrollLeft = el.scrollTop = 0;
    el.box = { left: 0, top: 0, width: 640, height: 400 };
    if (tag === 'canvas') el.getContext = () => ({ measureText: (s) => ({ width: s.length * 7 }) });
    return el;
  };
  doc.root = doc.documentElement = element('html'); doc.body = element('body'); doc.root.append(doc.body);
  doc.createElement = element; doc.createElementNS = (_, tag) => element(tag);
  doc.querySelector = (s) => doc.root.querySelector(s); doc.querySelectorAll = (s) => doc.root.querySelectorAll(s);
  doc.getElementById = (id) => doc.querySelector(`#${id}`);
  doc.addEventListener = (type, f) => doc.listeners.push({ type, f });
  const fire = (target, type, more = {}) => {
    const e = { target, type, key: '', preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...more };
    for (let el = target; el && !e.stopped; el = el.parentNode) el.dispatchEvent?.(e);
    if (!e.stopped) for (const l of doc.listeners.filter((l) => l.type === type)) l.f(e);
    return e;
  };
  doc.fire = fire;
  const ctx = vm.createContext({ ...(options.ctx || {}), console: { error() {} }, document: doc, Map, Set, Uint8Array, structuredClone, performance, Intl,
    innerWidth: 640, innerHeight: 900, GZ_SHEET_MODEL: M, GZ_SHEET_FORMULA: require('../lib/sheet-formula.js'),
    GZ_SHEET_CALC: CALC, GZ_SHEET_NUMFMT: NF, GZ_SHEET_DATA: options.SD || SD,
    chrome: { storage: { local: store, onChanged: { addListener() {} } } },
    getComputedStyle: () => ({ fontSize: '13px', fontFamily: 'Arial' }),
    ResizeObserver: class { observe() {} }, requestAnimationFrame: () => 1,
    setTimeout: (fn, ms) => { timers.set(++tick, { fn, ms }); return tick; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, fn) => { life[name] = fn; } });
  vm.runInContext(source, ctx);
  const wb = options.wb || M.workbook();
  const view = ctx.GZ_SHEET_GRID.mount({ key: KEY, wb, fresh: true, papers: P, sigs: new Map(), t: (k) => k,
    show: () => (_, r, c, x) => String(x.v ?? ''), local: true, fileOf: async () => ({ name: 'book.csv', mime: 'text/csv', bytes: new Uint8Array() }),
    download() {}, exportLabel: () => 'Export .csv' });
  const el = (id) => doc.getElementById(id), key = (name, more = {}) => fire(doc.activeElement, 'keydown', { key: name, ...more });
  const type = (text) => { key(text[0]); const editor = el('gx-edit'); editor.value = text; fire(editor, 'input'); };
  const unload = () => { const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; life.beforeunload(e); return e; };
  return { doc, view, wb, data, timers, fire, el, key, type, unload };
};

test('beforeunload protects uncommitted cell text with the browser prompt and saves it; clean views do not prompt', async () => {
  const f = frame();
  assert.equal(f.unload().prevented, false);
  f.type('draft');
  const leaving = f.unload();
  assert.equal(leaving.prevented, true);
  assert.equal(leaving.returnValue, '', 'only the browser supplies prompt text');
  await settle();
  const got = await SD.read(async (keys) => Object.fromEntries(keys.map((k) => [k, f.data[k]])), KEY);
  assert.equal(got.wb.sheets[0].rows.get(0).get(0).v, 'draft');
  assert.equal(f.unload().prevented, false);
});

test('Escape then Tab or Shift+Tab releases the grid to native keyboard focus navigation', () => {
  const f = frame();
  assert.equal(f.key('Tab').defaultPrevented, true, 'ordinary Tab still moves between cells');
  f.key('Escape');
  assert.ok(!f.key('Tab').defaultPrevented, 'Tab can reach the sheet tabs');
  f.key('Escape');
  f.key('Shift');
  assert.ok(!f.key('Tab', { shiftKey: true }).defaultPrevented, 'Shift+Tab can reach the formula bar and toolbar');
});

test('the format menu lets keyboard users Tab from presets to its custom input', () => {
  const f = frame();
  const format = f.el('gx-format'); format.focus(); f.fire(format, 'click');
  const menu = f.doc.querySelector('.gx-menu'), preset = menu.querySelector('button');
  preset.focus();
  f.fire(preset, 'keydown', { key: 'Tab' });
  assert.equal(f.doc.activeElement?.id, 'gx-fmt-code');
  assert.ok(menu.isConnected);
});

test('saving keeps dirty cells when version compression fails and retries them later', async () => {
  let fail = true;
  const f = frame({ SD: { ...SD, pack: async (wb) => { if (fail) throw new Error('compression refused'); return SD.pack(wb); } } });
  f.type('keep me'); f.key('Enter');
  assert.equal(await f.view.save(), false, 'a compression refusal leaves the view unsaved');
  assert.equal(f.unload().prevented, true);
  await settle();
  fail = false;
  assert.equal(await f.view.save(), true);
  assert.equal((await SD.read(async (keys) => Object.fromEntries(keys.map((k) => [k, f.data[k]])), KEY)).wb.sheets[0].rows.get(0).get(0).v, 'keep me');
});

test('keyboard movement skips hidden rows and columns in both directions', () => {
  const wb = M.workbook(); wb.sheets[0].hidden.rows.add(1); wb.sheets[0].hidden.cols.add(1);
  const f = frame({ wb });
  f.key('ArrowDown'); assert.equal(f.el('gx-name').value, 'A3');
  f.key('ArrowUp'); assert.equal(f.el('gx-name').value, 'A1');
  f.key('Tab'); assert.equal(f.el('gx-name').value, 'C1');
  f.key('Tab', { shiftKey: true }); assert.equal(f.el('gx-name').value, 'A1');
});

test('HTML paste retains number formats on Google Sheets numeric values and formulas', () => {
  const f = frame();
  const html = '<table><tr><td data-sheets-value=\'{"1":3,"3":0.5}\' style="mso-number-format:Percent">50%</td>'
    + '<td data-sheets-formula="=R[0]C[-1]*2" style="mso-number-format:Percent">100%</td></tr></table>';
  f.fire(f.el('gx-grid'), 'paste', { clipboardData: { getData: (type) => type === 'text/html' ? html : '50%\t100%' } });
  const row = f.wb.sheets[0].rows.get(0);
  assert.equal(f.wb.styles[row.get(0).s]?.fmt, '0%');
  assert.equal(f.wb.styles[row.get(1).s]?.fmt, '0%');
  assert.equal(row.get(1).f, 'A1*2');
});

test('plain text and HTML formula paste use dynamic evaluation and keep dependencies through undo and redo', () => {
  for (const html of ['', '<table><tr><td data-sheets-formula="=SUM((R1C1:R5C1&gt;2)*R1C2:R5C2)">0</td></tr></table>']) {
    const wb = M.workbook(), sh = wb.sheets[0];
    for (let r = 0; r < 5; r++) sh.rows.set(r, new Map([[0, { t: 'n', v: r + 1 }], [1, { t: 'n', v: 10 }]]));
    const f = frame({ wb });
    f.key('Tab'); f.key('Tab');
    f.fire(f.el('gx-grid'), 'paste', { clipboardData: { getData: (kind) => kind === 'text/html' ? html : '=SUM((A1:A5>2)*B1:B5)' } });
    assert.deepEqual(sh.rows.get(0).get(2), { t: 'n', v: 30, f: html ? 'SUM(($A$1:$A$5>2)*$B$1:$B$5)' : 'SUM((A1:A5>2)*B1:B5)', a: 'C1', cm: '1' });
    f.key('z', { ctrlKey: true }); assert.equal(sh.rows.get(0).get(2), undefined);
    f.key('y', { ctrlKey: true }); assert.equal(sh.rows.get(0).get(2).v, 30);
    f.key('ArrowLeft'); f.key('ArrowDown'); f.key('ArrowDown'); f.type('20'); f.key('Enter');
    assert.equal(sh.rows.get(0).get(2).v, 40, 'a precedent outside the formula row recalculates it');
    f.key('z', { ctrlKey: true }); assert.equal(sh.rows.get(0).get(2).v, 30);
    f.key('y', { ctrlKey: true }); assert.equal(sh.rows.get(0).get(2).v, 40);
  }
});

test('the last shown sheet cannot be deleted while every other sheet is hidden', () => {
  const wb = M.workbook(), hidden = M.sheet('Hidden', 2); hidden.keep.hidden = true; wb.sheets.push(hidden);
  const f = frame({ wb }), tab = f.el('gx-tab-1');
  f.fire(tab, 'contextmenu', { clientX: 20, clientY: 20 });
  assert.equal(f.doc.querySelector('.gx-menu [data-act="delete"]').disabled, true);
});

test('typed edits obey the undo byte budget as well as the step count', () => {
  const f = frame();
  for (let i = 0; i < 140; i++) { f.type(`${'x'.repeat(32000)}${i}`); f.key('Enter'); f.key('ArrowUp'); }
  let steps = 0;
  while (!f.el('gx-undo').disabled && steps < 150) { f.key('z', { ctrlKey: true }); steps++; }
  assert.ok(steps > 100 && steps <= 126, `8 MB holds about 125 of these 64 KB inverses, found ${steps}`);
});

test('sheet operations undo and redo through autosave with matching books bands and formula results', async () => {
  const f = frame(); f.type('original'); f.key('Enter');
  assert.equal(await f.view.save(), true);
  const original = SD.serialize(f.wb);
  f.fire(f.el('gx-add'), 'click');
  f.type('=Sheet1!A1'); f.key('Enter');
  assert.equal(await f.view.save(), true);
  f.key('z', { ctrlKey: true }); // clear the new sheet's only cell
  assert.equal(await f.view.save(), true);
  assert.equal(f.data[`writerPaper:${KEY}`].parts['2:0'], undefined);
  assert.equal(f.data[`writerSheet:${KEY}:2:0`], undefined);
  f.key('z', { ctrlKey: true }); // remove the added sheet
  assert.equal(await f.view.save(), true);
  let got = await SD.read(async (keys) => Object.fromEntries(keys.map((k) => [k, f.data[k]])), KEY);
  assert.equal(SD.serialize(got.wb), original);
  f.key('y', { ctrlKey: true }); f.key('y', { ctrlKey: true });
  assert.equal(await f.view.save(), true);
  got = await SD.read(async (keys) => Object.fromEntries(keys.map((k) => [k, f.data[k]])), KEY);
  assert.equal(got.wb.sheets.length, 2);
  assert.equal(got.wb.sheets[1].rows.get(0).get(0).f, 'Sheet1!A1');
  assert.equal(got.wb.sheets[1].rows.get(0).get(0).v, 'original');
  assert.equal(f.data[`writerSheet:${KEY}:2:0`].rev, got.rec.parts['2:0']);
});

// A workbook read from an .xlsx keeps what Glaze doesn't model, with cell references in it: the grid tells the codec of
// every operation it applies (do, undo, redo: lib/sheet-xlsx.js track) and asks it before a structural one (locked), which
// it refuses when kept parts would point at the wrong cells.
test('the grid tracks each applied operation with the codec and refuses a structural edit it locks', async () => {
  const calls = [];
  const X = { track: (wb, op) => calls.push(['track', op.op]), locked: (wb, op) => (op.op === 'insert' ? 'a pivot table uses this sheet' : null) };
  const f = frame({ ctx: { GZ_SHEET_XLSX: X } });
  f.type('12'); f.key('Enter');
  assert.deepEqual(calls.filter(([k]) => k === 'track').map(([, op]) => op), ['set'], 'the typed value');
  f.key('z', { ctrlKey: true }); f.key('y', { ctrlKey: true });
  assert.equal(calls.filter(([k]) => k === 'track').length, 3, 'undo and redo too');
  const before = calls.length;
  f.key('+', { ctrlKey: true });
  assert.equal(calls.length, before, 'a locked insert is not applied or tracked');
  await settle();
});
