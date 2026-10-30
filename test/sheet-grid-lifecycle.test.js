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
  const ctx = vm.createContext({ console: { error() {} }, document: doc, Map, Set, Uint8Array, structuredClone, performance, Intl,
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

test('the last shown sheet cannot be deleted while every other sheet is hidden', () => {
  const wb = M.workbook(), hidden = M.sheet('Hidden', 2); hidden.keep.hidden = true; wb.sheets.push(hidden);
  const f = frame({ wb }), tab = f.el('gx-tab-1');
  f.fire(tab, 'contextmenu', { clientX: 20, clientY: 20 });
  assert.equal(f.doc.querySelector('.gx-menu [data-act="delete"]').disabled, true);
});
