// A workbook from memory (sheet-kind.js show: a Canvas file opened in Glaze) is shown read-only: every way the grid edits
// is refused, the workbook stays as it came and nothing reaches storage. Selecting, moving, copying and Find still work.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const M = require('../../extension/lib/sheet-model.js'), SD = require('../../extension/sheet-data.js');
const CALC = require('../../extension/lib/sheet-calc.js'), NF = require('../../extension/lib/sheet-numfmt.js');
require('../../extension/lib/sheet-fn-math.js');
const source = fs.readFileSync(require.resolve('../../extension/sheet-grid.js'), 'utf8');
const REFUSED = 'Save to Documents to edit.';

// A chart layer that records what the grid asks it to change: one chart at the top left, chosen once clicked.
const chartLayer = (asked) => ({ layer: () => {
  let chosen = null;
  const box = { x: 0, y: 0, w: 200, h: 100 };
  return { draw() {}, changed() {}, dispose() {}, preview() {}, list: () => [{ id: 7, box }], chosen: () => chosen, choose: (id) => { chosen = id; },
    hit: (x, y) => (x < box.w && y < box.h ? { id: 7, box, handle: x > box.w - 8 && y > box.h - 8 } : null),
    insert: (kind) => { asked.push(`insert ${kind}`); return { op: 'gx-chart', kind, chosen: 8 }; },
    move: (id) => { asked.push(`move ${id}`); return { op: 'gx-chart', move: id }; },
    remove: (id) => { asked.push(`remove ${id}`); return { op: 'gx-chart', remove: id }; },
    apply: (op) => { asked.push(`apply ${JSON.stringify(op)}`); return op; } };
} });

const frame = () => {
  const doc = { activeElement: null, hidden: false, listeners: [] }, changes = new Set(), writes = [], asked = [], timers = new Map();
  let tick = 0;
  const store = { get: async () => ({}), set: async (v) => { writes.push(['set', v]); }, remove: async (k) => { writes.push(['remove', k]); } };
  const element = (tag) => {
    const el = new El(tag, doc), set = el.setAttribute.bind(el);
    el.setAttribute = (k, v) => { set(k, v); if (k === 'hidden') el.hidden = true; if (k === 'disabled') el.disabled = true; };
    el.insertBefore = (child, at) => { if (at) at.before(child); else el.append(child); };
    el.setSelectionRange = (start, end) => { el.selectionStart = start; el.selectionEnd = end; };
    el.select = () => el.setSelectionRange(0, el.value.length);
    el.matches = (selector) => require('../stand-in-dom.js').matches(el, selector);
    el.classList = { toggle() {} };
    el.setPointerCapture = () => {};
    el.scrollLeft = el.scrollTop = 0;
    el.clientWidth = 640; el.clientHeight = 400;
    el.box = { left: 0, top: 0, width: 640, height: 400 };
    if (tag === 'canvas') el.getContext = () => ({ measureText: (s) => ({ width: s.length * 7 }) });
    return el;
  };
  doc.root = doc.documentElement = element('html'); doc.body = element('body'); doc.root.append(doc.body);
  doc.createElement = element; doc.createElementNS = (_, tag) => element(tag);
  doc.querySelector = (s) => doc.root.querySelector(s); doc.querySelectorAll = (s) => doc.root.querySelectorAll(s);
  doc.getElementById = (id) => doc.querySelector(`#${id}`);
  doc.addEventListener = (type, f, opts) => doc.listeners.push({ type, f, opts });
  const fire = (target, type, more = {}) => {
    const e = { target, type, key: '', button: 0, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...more };
    for (let el = target; el && !e.stopped; el = el.parentNode) el.dispatchEvent?.(e);
    if (!e.stopped) for (const l of doc.listeners.filter((l) => l.type === type)) l.f(e);
    return e;
  };
  const ctx = vm.createContext({ console: { error() {}, warn() {} }, document: doc, Map, Set, Uint8Array, structuredClone, performance, Intl,
    AbortController, innerWidth: 640, innerHeight: 900, GZ_SHEET_MODEL: M, GZ_SHEET_FORMULA: require('../../extension/lib/sheet-formula.js'),
    GZ_SHEET_CALC: CALC, GZ_SHEET_NUMFMT: NF, GZ_SHEET_DATA: SD, GZ_SHEET_CHART: chartLayer(asked),
    chrome: { storage: { local: store, onChanged: { addListener: (f) => changes.add(f), removeListener: (f) => changes.delete(f) } } },
    getComputedStyle: () => ({ fontSize: '13px', fontFamily: 'Arial' }),
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { timers.set(++tick, { fn, ms }); return tick; }, clearTimeout: (id) => timers.delete(id), addEventListener() {} });
  vm.runInContext(source, ctx);
  // Two sheets, numbers and text, a formula: what a Canvas .xlsx brings.
  const wb = M.workbook(), sh = wb.sheets[0];
  [['Name', 'Score'], ['Ada', 91], ['Grace', 88]].forEach((row, r) => sh.rows.set(r, new Map(row.map((v, c) => [c, typeof v === 'number' ? { t: 'n', v } : { t: 's', v }]))));
  sh.rows.get(1).set(2, { t: 'n', v: 0, f: 'B2*2' });
  wb.sheets.push(M.sheet('Notes', 2));
  CALC.engine(wb).recalc();
  const view = ctx.GZ_SHEET_GRID.mount({ key: null, wb, rec: null, sigs: new Map(), fresh: false, memory: true, t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), papers: null,
    show: () => '', local: false, fileOf: async () => ({ name: 'Grades.xlsx', mime: 'x', bytes: new Uint8Array() }), download() {}, exportLabel: () => 'Export .xlsx',
    host: { mount: doc.body, title: () => 'Grades.xlsx', tools: [] } });
  const el = (id) => doc.getElementById(id), key = (name, more = {}) => fire(doc.activeElement, 'keydown', { key: name, ...more });
  const said = () => doc.querySelector('.gx-said').textContent;
  const snap = () => { const was = wb.active; wb.active = 0; const s = SD.serialize(wb); wb.active = was; return s; };
  return { doc, view, wb, fire, el, key, said, snap, writes, changes, asked, timers, scroller: doc.querySelector('.gx-scroll'), grid: el('gx-grid') };
};

// The cell B2 and the corner of the selection at A1, on the grid's face (headers 46 × 24, cells 64 × 20).
const B2 = { clientX: 46 + 64 + 10, clientY: 24 + 20 + 5 };

test('a workbook from memory refuses every edit path; the workbook stays as it came and nothing is stored', async () => {
  const f = frame(), before = f.snap();
  const same = (what) => { assert.equal(f.snap(), before, `${what} left the workbook as it came`); assert.deepEqual(f.writes, [], `${what} wrote nothing`); };
  const refused = (what) => { same(what); assert.equal(f.said(), REFUSED, `${what} says why`); f.doc.querySelector('.gx-said').textContent = ''; };

  // Typing into a cell, F2, double-click and the formula bar open no editor.
  f.key('x'); assert.equal(f.el('gx-edit').hidden, true, 'typing opens no editor'); refused('typing');
  f.key('F2'); assert.equal(f.el('gx-edit').hidden, true, 'F2 opens no editor'); refused('F2');
  f.key('Process'); assert.equal(f.el('gx-edit').hidden, true, 'an input method opens no editor'); same('an input method');
  f.fire(f.scroller, 'dblclick', B2); assert.equal(f.el('gx-edit').hidden, true, 'double-click opens no editor'); refused('double-click');
  f.grid.focus();
  const fx = f.el('gx-formula');
  assert.equal(fx.readOnly, true, 'the formula bar shows the cell and takes no typing');
  fx.focus(); f.fire(fx, 'focus'); fx.value = '=1+1'; f.fire(fx, 'input'); f.fire(fx, 'keydown', { key: 'Enter' }); f.fire(fx, 'blur');
  same('the formula bar');
  f.grid.focus();

  // Paste, cut (and its paste), Delete and Backspace.
  const clip = (text) => ({ clipboardData: { getData: (k) => (k === 'text/plain' ? text : ''), setData() { throw new Error('a cut in memory puts nothing on the clipboard'); } } });
  f.fire(f.grid, 'paste', clip('1\t2\n3\t4')); refused('paste');
  f.fire(f.grid, 'paste', clip('50%\t$3.00')); refused('a paste of formatted numbers');
  f.fire(f.grid, 'cut', clip('')); refused('cut');
  assert.equal(f.el('gx-name').value, 'B2', 'on B2, a number');
  for (const k of ['Delete', 'Backspace']) { f.key(k); refused(k); }
  f.key('ArrowUp'); f.key('ArrowLeft');

  // The fill handle (drag and double-click), Ctrl+D and Ctrl+R.
  const corner = { clientX: 46 + 64, clientY: 24 + 20 };
  f.fire(f.scroller, 'pointerdown', { ...corner, pointerId: 1 }); f.fire(f.scroller, 'pointermove', { clientX: corner.clientX, clientY: corner.clientY + 60 }); f.fire(f.scroller, 'pointerup', {});
  same('the fill handle');
  f.fire(f.scroller, 'dblclick', corner); same('double-clicking the fill handle');
  assert.equal(f.doc.querySelector('.gx-handle'), null, 'no fill handle is drawn');
  f.grid.focus();
  f.key('ArrowDown', { shiftKey: true }); f.key('ArrowDown', { shiftKey: true });
  f.key('d', { ctrlKey: true }); refused('Ctrl+D');
  f.key('ArrowRight', { shiftKey: true }); f.key('r', { ctrlKey: true }); refused('Ctrl+R');

  // Column and row sizes: dragging an edge, double-clicking one.
  const edge = { clientX: 46 + 64, clientY: 10 };
  f.fire(f.scroller, 'pointerdown', { ...edge, pointerId: 2 }); f.fire(f.scroller, 'pointermove', { clientX: edge.clientX + 50, clientY: 10 }); f.fire(f.scroller, 'pointerup', {});
  f.fire(f.scroller, 'dblclick', edge);
  same('resizing a column');
  f.grid.focus();

  // Rows and columns: inserted, deleted, hidden — by the keyboard and by the grid's menu, which offers only Copy.
  f.key(' ', { shiftKey: true }); f.key('+', { ctrlKey: true }); refused('Ctrl++ on a row');
  f.key(' ', { shiftKey: true }); f.key('-', { ctrlKey: true }); refused('Ctrl+- on a row');
  f.fire(f.scroller, 'contextmenu', { clientX: 10, clientY: 50 });
  assert.deepEqual(f.doc.querySelectorAll('.gx-menu [data-act]').map((b) => b.dataset.act), ['copy'], 'the grid\'s menu offers Copy alone');
  f.doc.querySelector('.gx-menu')?.remove();
  f.fire(f.scroller, 'contextmenu', { clientX: 60, clientY: 10 });
  assert.deepEqual(f.doc.querySelectorAll('.gx-menu [data-act]').map((b) => b.dataset.act), ['copy'], 'a column\'s menu offers Copy alone');
  f.doc.querySelector('.gx-menu')?.remove();
  f.grid.focus();

  // The toolbar's editing controls are not there; pressed anyway, they change nothing.
  for (const id of ['gx-undo', 'gx-redo', 'gx-format', 'gx-sort-az', 'gx-sort-za', 'gx-freeze', 'gx-chart', 'gx-add', 'gx-rep-q', 'gx-rep-one', 'gx-rep-all', 'gx-versions']) assert.equal(f.el(id), null, `${id} is not shown`);
  assert.ok(f.el('gx-find-b') && f.el('gx-more'), 'Find and ⋯ (Export) stay');

  // Undo and redo.
  f.key('z', { ctrlKey: true }); refused('Ctrl+Z');
  f.key('z', { ctrlKey: true, shiftKey: true }); refused('Ctrl+Shift+Z');
  f.key('y', { ctrlKey: true }); refused('Ctrl+Y');

  // Charts: none inserted; the one there is neither moved, sized nor deleted.
  f.fire(f.scroller, 'pointerdown', { clientX: 46 + 20, clientY: 24 + 20, pointerId: 3 }); f.fire(f.scroller, 'pointermove', { clientX: 46 + 120, clientY: 24 + 90 }); f.fire(f.scroller, 'pointerup', {});
  f.fire(f.scroller, 'pointerdown', { clientX: 46 + 196, clientY: 24 + 96, pointerId: 4 }); f.fire(f.scroller, 'pointermove', { clientX: 46 + 300, clientY: 24 + 200 }); f.fire(f.scroller, 'pointerup', {});
  f.grid.focus();
  f.fire(f.scroller, 'pointerdown', { clientX: 46 + 20, clientY: 24 + 20, pointerId: 5 }); f.fire(f.scroller, 'pointerup', {});
  f.grid.focus(); f.key('Delete');
  assert.deepEqual(f.asked.filter((x) => x.startsWith('apply')), [], `the chart layer was asked to change nothing (${f.asked.join('; ')})`);
  same('a chart moved, sized or deleted');
  f.grid.focus(); f.key('Escape');

  // Sheet tabs: no add, no rename, no menu (duplicate, move, delete, hide).
  const tab = f.el('gx-tab-1');
  f.fire(tab, 'dblclick'); assert.equal(f.doc.querySelector('.gx-tab-in'), null, 'double-click opens no rename field');
  tab.focus(); f.fire(tab, 'keydown', { key: 'F2' }); assert.equal(f.doc.querySelector('.gx-tab-in'), null, 'F2 opens no rename field');
  f.fire(tab, 'contextmenu', { clientX: 20, clientY: 380 }); assert.equal(f.doc.querySelector('.gx-menu'), null, 'no tab menu');
  f.fire(tab, 'keydown', { key: 'ContextMenu' }); assert.equal(f.doc.querySelector('.gx-menu'), null, 'no tab menu from the keyboard');
  same('the sheet tabs');
  f.grid.focus();

  // Replace: Ctrl+H opens Find alone.
  f.key('h', { ctrlKey: true });
  assert.equal(f.el('gx-find').hidden, false, 'Ctrl+H opens Find');
  assert.equal(f.doc.activeElement?.id, 'gx-find-q', 'on its query, as there is no Replace');
  same('Ctrl+H');

  // Nothing listened to storage, and nothing was written at the end either.
  assert.equal(f.changes.size, 0, 'no storage listener');
  assert.equal(await f.view.save(), true, 'the host\'s save has nothing to do');
  same('the whole run');
});

test('a workbook from memory still selects, moves, copies, finds and switches sheets', () => {
  const f = frame(), before = f.snap();
  f.key('ArrowDown'); f.key('ArrowRight');
  assert.equal(f.el('gx-name').value, 'B2');
  assert.equal(f.el('gx-formula').value, '91', 'the formula bar shows the cell');
  f.key('ArrowRight'); assert.equal(f.el('gx-formula').value, '=B2*2', 'and a formula');
  f.key('ArrowLeft', { shiftKey: true });
  let tsv = null;
  f.fire(f.grid, 'copy', { clipboardData: { setData: (k, v) => { if (k === 'text/plain') tsv = v; } } });
  assert.equal(tsv?.replace(/\r?\n$/, ''), '91\t182', 'Copy puts the selection on the clipboard');
  f.key('f', { ctrlKey: true });
  const q = f.el('gx-find-q'); q.value = 'grace'; f.fire(q, 'input');
  assert.equal(f.el('gx-find-n').textContent, '1 of 1');
  assert.equal(f.el('gx-name').value, 'A3', 'Find lands on the match');
  f.grid.focus();
  f.fire(f.el('gx-tab-2'), 'click');
  assert.equal(f.wb.active, 1, 'another sheet shows');
  assert.equal(f.snap(), before);
  assert.equal(f.said(), '', 'none of it is refused');
});

test('repeated read-only attempts leave the current status announcement and its expiry alone', () => {
  const f = frame(), said = f.doc.querySelector('.gx-said');
  const text = Object.getOwnPropertyDescriptor(El.prototype, 'textContent');
  let writes = 0;
  Object.defineProperty(said, 'textContent', {
    get() { return text.get.call(this); },
    set(value) { writes++; text.set.call(this, value); },
  });
  f.key('x');
  const expiry = [...f.timers].find(([, timer]) => timer.ms === 6000);
  assert.ok(expiry, 'the first refusal expires');
  for (const key of ['y', 'z', 'F2', 'Process', 'Dead']) f.key(key);
  assert.equal(writes, 1, 'one live-region update while the same refusal is already visible');
  assert.ok(f.timers.has(expiry[0]), 'repeated attempts do not postpone the current announcement');
  expiry[1].fn();
  assert.equal(f.said(), '');
  f.key('x');
  assert.equal(f.said(), REFUSED, 'an attempt after expiry can explain the refusal again');
});

test('read-only keyboard fills refuse before expanding the selection into shifted formulas', () => {
  for (const [range, key] of [['C2:C10001', 'd'], ['C2:ZZ2', 'r']]) {
    const f = frame(), before = f.snap(), name = f.el('gx-name');
    name.value = range; f.fire(name, 'keydown', { key: 'Enter' });
    const cell = f.wb.sheets[0].rows.get(1).get(2), formula = cell.f;
    let reads = 0;
    Object.defineProperty(cell, 'f', { enumerable: true, get() { reads++; return formula; } });
    f.key(key, { ctrlKey: true });
    assert.equal(reads, 0, `${range}: Ctrl+${key.toUpperCase()} must refuse before copying formulas`);
    assert.equal(f.said(), REFUSED);
    assert.equal(f.snap(), before);
    assert.deepEqual(f.writes, []);
  }
});
