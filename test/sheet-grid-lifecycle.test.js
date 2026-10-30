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
  const doc = { activeElement: null, hidden: false, listeners: [] }, life = {}, lives = [], changes = new Set(), timers = new Map(), data = {};
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
  doc.addEventListener = (type, f, opts) => doc.listeners.push({ type, f, opts });
  const fire = (target, type, more = {}) => {
    const e = { target, type, key: '', preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...more };
    for (let el = target; el && !e.stopped; el = el.parentNode) el.dispatchEvent?.(e);
    if (!e.stopped) for (const l of doc.listeners.filter((l) => l.type === type)) l.f(e);
    return e;
  };
  doc.fire = fire;
  const ctx = vm.createContext({ ...(options.ctx || {}), console: { error() {} }, document: doc, Map, Set, Uint8Array, structuredClone, performance, Intl,
    AbortController, innerWidth: 640, innerHeight: 900, GZ_SHEET_MODEL: M, GZ_SHEET_FORMULA: require('../lib/sheet-formula.js'),
    GZ_SHEET_CALC: CALC, GZ_SHEET_NUMFMT: NF, GZ_SHEET_DATA: options.SD || SD,
    chrome: { storage: { local: store, onChanged: { addListener: (f) => changes.add(f), removeListener: (f) => changes.delete(f) } } },
    getComputedStyle: () => ({ fontSize: '13px', fontFamily: 'Arial' }),
    ResizeObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { timers.set(++tick, { fn, ms }); return tick; }, clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, fn, opts) => { life[name] = fn; lives.push({ name, fn, opts }); } });
  vm.runInContext(source, ctx);
  const wb = options.wb || M.workbook();
  const view = ctx.GZ_SHEET_GRID.mount({ key: KEY, wb, fresh: true, papers: P, sigs: new Map(), t: (k) => k,
    show: () => (_, r, c, x) => String(x.v ?? ''), local: true, fileOf: async () => ({ name: 'book.csv', mime: 'text/csv', bytes: new Uint8Array() }),
    download() {}, exportLabel: () => 'Export .csv' });
  const el = (id) => doc.getElementById(id), key = (name, more = {}) => fire(doc.activeElement, 'keydown', { key: name, ...more });
  const type = (text) => { key(text[0]); const editor = el('gx-edit'); editor.value = text; fire(editor, 'input'); };
  const unload = () => { const e = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; life.beforeunload(e); return e; };
  return { doc, view, wb, data, timers, fire, el, key, type, unload, life, lives, changes, store };
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
  f.key(' ', { shiftKey: true }); f.key('+', { ctrlKey: true });
  assert.equal(calls.length, before, 'a locked insert is not applied or tracked');
  await settle();
});

test('dispose ends every listener outside the grid, so an unmounted grid neither reads storage nor redraws again', async () => {
  const f = frame();
  assert.equal(typeof f.view.dispose, 'function', 'writer-kinds.js unmount calls it');
  assert.equal(f.changes.size, 1, 'the storage listener');
  const outside = [...f.doc.listeners, ...f.lives];
  assert.ok(outside.length >= 7 && outside.every((l) => l.opts?.signal), `every page listener ends with the grid (${outside.filter((l) => !l.opts?.signal).map((l) => l.type || l.name)})`);
  f.type('kept'); f.key('Enter');
  assert.equal(await f.view.save(), true);
  await f.view.dispose();
  assert.equal(f.changes.size, 0, 'storage changes no longer reach it');
  assert.ok(outside.every((l) => l.opts.signal.aborted));
  assert.equal(f.doc.getElementById('gx-grid'), null, 'its view is gone');
  assert.equal(f.timers.size, 0, 'no timer left');
});

test('embedded Close waits for the cell being written, and leaving the page commits it too', async () => {
  const f = frame(), read = async () => (await SD.read(async (keys) => Object.fromEntries(keys.map((k) => [k, f.data[k]])), KEY))?.wb.sheets[0].rows.get(0)?.get(0)?.v;
  const leave = () => { const waits = []; f.life['glaze:papers:beforeleave']({ detail: { wait: (p) => waits.push(p) } }); return waits; };
  assert.equal(leave().length, 0, 'a clean grid lets Close go at once');
  f.type('draft');
  const waits = leave();
  assert.equal(waits.length, 1, 'Close waits');
  assert.equal(await waits[0], true, 'and goes once the cell is saved');
  assert.equal(await read(), 'draft');
  f.el('gx-grid').focus(); f.type('gone');
  f.life.pagehide({ persisted: false });
  await settle();
  assert.equal(await read(), 'gone', 'pagehide (an iframe removed) keeps the open cell');
});

test('unsaved work over another tab\'s write saves over it whole, keeping theirs as a version, instead of retrying forever', async () => {
  const f = frame(), get = (keys) => f.store.get(keys);
  f.type('mine'); f.key('Enter');
  assert.equal(await f.view.save(), true);
  // Another tab: a workbook of two sheets over the one just saved.
  const theirs = M.workbook();
  theirs.sheets[0].rows.set(0, new Map([[0, { t: 's', v: 'theirs' }]]));
  theirs.sheets.push(M.sheet('Extra', 2)); theirs.sheets[1].rows.set(0, new Map([[0, { t: 'n', v: 5 }]]));
  const other = PA.open(f.store), was = await SD.read(get, KEY);
  const wrote = await SD.write(other, KEY, theirs, was.sigs, { base: was.rec.revision });
  // It lands while a cell here is being written.
  f.el('gx-grid').focus(); f.type('later');
  for (const l of f.changes) l({ [`writerPaper:${KEY}`]: { newValue: wrote.saved.paper } }, 'local');
  await settle();
  f.key('Enter');
  assert.equal(await f.view.save(), true, 'the save is not refused');
  const got = await SD.read(get, KEY);
  assert.equal(got.wb.sheets.length, 1);
  assert.equal(got.wb.sheets[0].rows.get(0).get(0).v, 'mine');
  assert.equal(got.wb.sheets[0].rows.get(1).get(0).v, 'later');
  assert.deepEqual(Object.keys(got.rec.parts), ['1:0'], 'their second sheet\'s band is dropped');
  assert.equal(f.data[`writerSheet:${KEY}:2:0`], undefined);
  const kept = (await other.versions(KEY)).find((v) => v.reason === 'conflict');
  assert.ok(kept, 'their workbook is a version');
  const back = await SD.unpack((await other.version(KEY, kept.id)).gz);
  assert.equal(back.sheets[0].rows.get(0).get(0).v, 'theirs');
  assert.equal(back.sheets[1].rows.get(0).get(0).v, 5);
});

test('a write that leaves the cells alone (a submit checkpoint) keeps undo; another tab\'s cells still show', async () => {
  const f = frame(), get = (keys) => f.store.get(keys), other = PA.open(f.store);
  const deliver = (paper) => { for (const l of f.changes) l({ [`writerPaper:${KEY}`]: { newValue: paper } }, 'local'); };
  f.type('one'); f.key('Enter');
  assert.equal(await f.view.save(), true);
  let got = await SD.read(get, KEY);
  const checkpoint = await other.save(KEY, {}, { expectedKind: 'sheet', base: got.rec.revision, version: { reason: 'submit', gz: await SD.pack(got.wb), cells: 1 } });
  assert.equal(checkpoint.paper.edited, got.rec.edited, 'the checkpoint changes no cell');
  deliver(checkpoint.paper);
  await settle();
  assert.equal(f.el('gx-undo').disabled, false, 'undo is still there');
  f.key('z', { ctrlKey: true });
  assert.equal(await f.view.save(), true, 'and saves on the checkpoint\'s revision');
  got = await SD.read(get, KEY);
  assert.equal(got.wb.sheets[0].rows.get(0)?.get(0), undefined, 'the typed cell undone and saved');
  // Cells from another tab: shown, as before.
  const theirs = M.workbook(); theirs.sheets[0].rows.set(0, new Map([[0, { t: 's', v: 'theirs' }]]));
  const wrote = await SD.write(other, KEY, theirs, got.sigs, { base: got.rec.revision });
  deliver(wrote.saved.paper);
  await settle();
  f.el('gx-grid').focus(); f.key('ArrowUp');
  assert.equal(f.el('gx-formula').value, 'theirs');
  assert.equal(f.el('gx-undo').disabled, true, 'their workbook comes without this one\'s undo');
});

test('while an input method composes, Enter, Tab, Escape and the arrows stay with it', () => {
  const f = frame();
  f.type('かな');
  for (const key of ['Enter', 'Tab', 'Escape', 'ArrowDown']) {
    const e = f.key(key, { isComposing: true, keyCode: 229 });
    assert.ok(!e.defaultPrevented, `${key} reaches the input method`);
    assert.equal(f.el('gx-edit').hidden, false, `${key} leaves the cell open`);
  }
  assert.equal(f.el('gx-name').value, 'A1');
  f.key('Enter');
  assert.equal(f.wb.sheets[0].rows.get(0).get(0).v, 'かな', 'Enter after it commits');
  assert.equal(f.el('gx-name').value, 'A2');
});

test('Ctrl+minus and Ctrl+plus over cells are the browser\'s zoom; over whole rows they delete and insert', () => {
  const f = frame();
  f.type('keep'); f.key('Enter'); f.key('ArrowUp');
  for (const [k, more] of [['-', { ctrlKey: true }], ['-', { metaKey: true }], ['+', { ctrlKey: true, shiftKey: true }], ['=', { metaKey: true, shiftKey: true }]]) {
    assert.ok(!f.key(k, more).defaultPrevented, `${JSON.stringify(more)} ${k} zooms`);
    assert.equal(f.wb.sheets[0].rows.get(0)?.get(0)?.v, 'keep', `${k} leaves row 1`);
  }
  f.key(' ', { shiftKey: true });
  assert.ok(f.key('+', { ctrlKey: true, shiftKey: true }).defaultPrevented);
  assert.equal(f.wb.sheets[0].rows.get(1)?.get(0)?.v, 'keep', 'a row inserted above');
  f.key(' ', { shiftKey: true });
  assert.ok(f.key('-', { ctrlKey: true }).defaultPrevented);
  assert.equal(f.wb.sheets[0].rows.get(0)?.get(0)?.v, 'keep', 'and deleted');
});

test('pasting a picture, a file or an empty clipboard leaves the cell as it was', () => {
  const f = frame();
  f.type('kept'); f.key('Enter'); f.key('ArrowUp');
  for (const html of ['', '<img src="shot.png">', '<meta charset="utf-8"><img src="blob:x">']) {
    const e = f.fire(f.el('gx-grid'), 'paste', { clipboardData: { getData: (type) => (type === 'text/html' ? html : '') } });
    assert.ok(e.defaultPrevented);
    assert.equal(f.wb.sheets[0].rows.get(0)?.get(0)?.v, 'kept', JSON.stringify(html));
  }
  assert.equal(f.el('gx-undo').disabled, false);
  f.key('z', { ctrlKey: true });
  assert.equal(f.wb.sheets[0].rows.get(0)?.get(0), undefined, 'no empty paste took an undo step');
});

test('Replace says why a cell in an array stays, and passes over a match in the shown text alone', () => {
  const wb = M.workbook(), sh = wb.sheets[0];
  sh.rows.set(0, new Map([[0, { t: 'n', v: 2, f: '1+1', a: 'A1:A2' }], [1, { t: 'n', v: 5, s: M.internStyle(wb, { fmt: '$#,##0.00' }) }]]));
  sh.rows.set(1, new Map([[0, { t: 'n', v: 2 }]]));
  const f = frame({ wb }), said = () => f.doc.querySelector('.gx-said').textContent;
  f.key('f', { ctrlKey: true });
  const find = (q, rep) => { f.el('gx-find-q').value = q; f.fire(f.el('gx-find-q'), 'input'); f.el('gx-rep-q').value = rep; f.fire(f.el('gx-rep-one'), 'click'); };
  find('1+1', '2+2');
  assert.equal(said(), 'You can’t change part of an array.');
  assert.equal(sh.rows.get(0).get(0).f, '1+1');
  find('$', '€');
  assert.equal(sh.rows.get(0).get(1).v, 5);
  assert.equal(f.el('gx-undo').disabled, true, 'no undo step for a replace that changed nothing');
});

test('sorting from a cell or a whole column keeps rows whole and the header row a numeric column shows', () => {
  const rows = [['Name', 'Score'], ['Zoe', 90], ['Adam', 70], ['Mia', 80]];
  const names = (wb) => [0, 1, 2, 3].map((r) => `${wb.sheets[0].rows.get(r).get(0).v}${r ? wb.sheets[0].rows.get(r).get(1).v : ''}`).join();
  for (const [from, desc, want] of [['A1', false, 'Name,Adam70,Mia80,Zoe90'], ['B3', true, 'Name,Zoe90,Mia80,Adam70'], ['A:A', false, 'Name,Adam70,Mia80,Zoe90']]) {
    const wb = M.workbook();
    rows.forEach((row, r) => wb.sheets[0].rows.set(r, new Map(row.map((v, c) => [c, typeof v === 'number' ? { t: 'n', v } : { t: 's', v }]))));
    const f = frame({ wb });
    if (from === 'A:A') f.key(' ', { ctrlKey: true }); else { f.el('gx-name').value = from; f.fire(f.el('gx-name'), 'keydown', { key: 'Enter' }); }
    f.fire(f.el(desc ? 'gx-sort-za' : 'gx-sort-az'), 'click');
    assert.equal(names(f.wb), want, `from ${from}`);
  }
  // No header to keep: every row of text.
  const wb = M.workbook();
  ['Cy', 'Ab', 'Bo'].forEach((v, r) => wb.sheets[0].rows.set(r, new Map([[0, { t: 's', v }]])));
  const f = frame({ wb });
  f.fire(f.el('gx-sort-az'), 'click');
  assert.equal([0, 1, 2].map((r) => f.wb.sheets[0].rows.get(r).get(0).v).join(), 'Ab,Bo,Cy');
});

test('a cell starts with a character typed with AltGr or the Mac\'s Option; Windows\' Alt+letter stays the browser\'s', () => {
  const altGr = (m) => m === 'AltGraph';
  const pc = frame({ ctx: { navigator: { platform: 'Win32' } } });
  pc.key('€', { ctrlKey: true, altKey: true, getModifierState: altGr });
  assert.equal(pc.el('gx-edit').hidden, false);
  assert.equal(pc.el('gx-edit').value, '€');
  pc.key('Escape');
  assert.ok(!pc.key('d', { altKey: true }).defaultPrevented, 'Alt+D: the address bar');
  assert.equal(pc.el('gx-edit').hidden, true);
  const mac = frame({ ctx: { navigator: { platform: 'MacIntel' } } });
  mac.key('@', { altKey: true });
  assert.equal(mac.el('gx-edit').value, '@', 'Option+L on a German Mac');
});
