// Glaze Sheets' workbook model. A workbook is { v, date1904, sheets[], styles[] (shared, a cell's s indexes it),
// names[] ({ name, ref, sheet? }: ref is formula text, sheet the id of the sheet it is scoped to), keep { parts } (package
// parts kept byte for byte), active (an index into sheets) }. A sheet is { id, name, rows: Map r → Map c → cell, colW and
// rowH: Map index → size, hidden { rows, cols }: Set, merges[] ({ r0, c0, r1, c1 }), freeze ({ rows, cols } frozen),
// filter (a range), charts[], keep }. A cell is { t, v, f?, s?, rich?, a? }: t 'n' number, 's' text, 'b' boolean, 'e'
// error (v its text, '#DIV/0!'), 'z' empty with a style; f formula text without its '='; a the range of the array
// formula it heads. Rows and columns count from 0.
// Every change the grid and its undo stack make goes through apply(wb, op, hooks), which returns the op that undoes it.
// Moving rows or columns, renaming or removing a sheet rewrites formulas only through hooks (sheet-formula.js supplies
// them), so the model knows nothing of formula syntax. Adapted from Rimeward's notebook-spreadsheet.ts (MIT, the same
// owner): columnName and cellPosition.
// Classic script; module.exports for node.
var GZ_SHEET_MODEL = globalThis.GZ_SHEET_MODEL || (() => {
  const MAX_ROWS = 1048576, MAX_COLS = 16384;
  const CAP = Object.freeze({ cells: 250000, sheets: 100, formula: 8192, nest: 64, args: 255, text: 32767 });
  const ERRORS = Object.freeze(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']);
  const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };

  const columnName = (c) => { let s = ''; for (c++; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
  const columnIndex = (name) => {
    if (typeof name !== 'string' || !/^[A-Za-z]{1,3}$/.test(name)) return -1;
    let c = 0;
    for (const ch of name.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
    return c <= MAX_COLS ? c - 1 : -1;
  };
  const cellName = (r, c) => `${columnName(c)}${r + 1}`;
  const CELL = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/;
  const cellPosition = (ref) => {
    const m = typeof ref === 'string' ? CELL.exec(ref) : null;
    if (!m) return null;
    const c = columnIndex(m[1]), r = Number(m[2]) - 1;
    return c >= 0 && r < MAX_ROWS ? [r, c] : null;
  };
  const rangeName = (r0, c0, r1, c1) => (r0 === r1 && c0 === c1 ? cellName(r0, c0) : `${cellName(r0, c0)}:${cellName(r1, c1)}`);
  const rangePosition = (text) => {
    const [a, b = a, extra] = typeof text === 'string' ? text.split(':') : [];
    const p = cellPosition(a), q = cellPosition(b);
    if (!p || !q || extra !== undefined) return null;
    return { r0: Math.min(p[0], q[0]), c0: Math.min(p[1], q[1]), r1: Math.max(p[0], q[0]), c1: Math.max(p[1], q[1]) };
  };

  const sheet = (name, id) => ({ id, name, rows: new Map(), colW: new Map(), rowH: new Map(), hidden: { rows: new Set(), cols: new Set() },
    merges: [], freeze: null, filter: null, charts: [], keep: {} });
  const workbook = (o = {}) => ({ v: 1, date1904: o.date1904 === true, sheets: [sheet('Sheet1', 1)], styles: [{}], names: [], keep: { parts: {} }, active: 0 });
  const getSheet = (wb, key) => {
    if (typeof key === 'number') return wb.sheets.find((s) => s.id === key) || null;
    const low = typeof key === 'string' ? key.toLowerCase() : null;
    return wb.sheets.find((s) => s.name.toLowerCase() === low) || null;
  };
  const cell = (sh, r, c) => sh.rows.get(r)?.get(c) ?? null;
  const cellCount = (wb) => { let n = 0; for (const sh of wb.sheets) for (const row of sh.rows.values()) n += row.size; return n; };

  // Why a sheet name can't be used, or null. except: the id of the sheet being renamed.
  const validName = (wb, name, except) => {
    if (typeof name !== 'string' || !name.length || name.length > 31) return 'length';
    if (/[:\\/?*[\]]/.test(name)) return 'chars';
    if (name.startsWith("'") || name.endsWith("'")) return 'apostrophe';
    const low = name.toLowerCase();
    if (low === 'history') return 'reserved';
    return wb.sheets.some((s) => s.id !== except && s.name.toLowerCase() === low) ? 'taken' : null;
  };
  const nextSheetName = (wb) => { let n = wb.sheets.length + 1; while (validName(wb, `Sheet${n}`)) n++; return `Sheet${n}`; };

  // ── Operations ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const need = (wb, id) => getSheet(wb, typeof id === 'number' ? id : -1) || fail('sheet', `no sheet ${id}`);
  const index = (v, max) => Number.isInteger(v) && v >= 0 && v < max;
  const inBounds = (r, c) => (index(r, MAX_ROWS) && index(c, MAX_COLS)) || fail('bounds', `no cell at ${r},${c}`);

  // Writes one cell (null clears it) and returns the cell it replaced.
  const put = (wb, sh, r, c, value, run) => {
    inBounds(r, c);
    let row = sh.rows.get(r);
    const prev = row?.get(c) ?? null;
    if (value) {
      if (!prev) { run.count ??= cellCount(wb); if (run.count >= CAP.cells) fail('cap-cells', 'a workbook holds 250,000 cells'); run.count++; }
      if (!row) sh.rows.set(r, (row = new Map()));
      row.set(c, { ...value });
    } else if (prev) {
      run.count ??= cellCount(wb);
      run.count--;
      row.delete(c);
      if (!row.size) sh.rows.delete(r);
    }
    run.touched.push([sh.id, r, c]);
    return prev;
  };

  // A span [a, b] after inserting (n > 0) or deleting (n < 0) at `at`; null when the delete takes all of it.
  const shiftSpan = (a, b, at, n, max) => {
    if (n > 0) return a >= at ? [Math.min(a + n, max - 1), Math.min(b + n, max - 1)] : b >= at ? [a, Math.min(b + n, max - 1)] : [a, b];
    const end = at - n;
    if (b < at) return [a, b];
    if (a >= end) return [a + n, b + n];
    if (a >= at && b < end) return null;
    return [a < at ? a : at, b >= end ? b + n : at - 1];
  };
  const shiftRange = (g, row, at, n) => {
    const s = row ? shiftSpan(g.r0, g.r1, at, n, MAX_ROWS) : shiftSpan(g.c0, g.c1, at, n, MAX_COLS);
    if (!s) return null;
    return row ? { ...g, r0: s[0], r1: s[1] } : { ...g, c0: s[0], c1: s[1] };
  };
  // Map/Set keys after the shift; what a delete takes goes to `gone`.
  // An insert's keys pushed past the last row or column are dropped: only sizes and hidden flags can be there.
  const moved = (k, at, n, max) => (k < at ? k : n < 0 && k < at - n ? null : k + n < max ? k + n : undefined);
  const shiftMap = (map, at, n, max, gone) => {
    const out = new Map();
    for (const [k, v] of map) { const to = moved(k, at, n, max); if (to === null) gone?.(k, v); else if (to !== undefined) out.set(to, v); }
    return out;
  };
  const shiftSet = (set, at, n, max, gone) => {
    const out = new Set();
    for (const k of set) { const to = moved(k, at, n, max); if (to === null) gone?.(k); else if (to !== undefined) out.add(to); }
    return out;
  };

  // Rewrites every formula (and every defined name) through fn(text, hostSheetName) → text; returns what changed, for
  // the inverse, at the positions the cells have now.
  const rewrite = (wb, fn, skip) => {
    const formulas = [];
    for (const sh of wb.sheets) {
      for (const [r, row] of sh.rows) for (const [c, x] of row) {
        if (x.f === undefined || skip?.(sh, r, c)) continue;
        const f = fn(x.f, sh.name);
        if (f !== x.f) { formulas.push([sh.id, r, c, x.f]); row.set(c, { ...x, f }); }
      }
    }
    const names = wb.names.map((x) => ({ ...x }));
    let renamed = false;
    wb.names = wb.names.map((x) => {
      const ref = fn(x.ref, x.sheet === undefined ? null : getSheet(wb, x.sheet)?.name ?? null);
      if (ref === x.ref) return x;
      renamed = true;
      return { ...x, ref };
    });
    return { formulas, names: renamed ? names : null };
  };

  const props = (sh) => [[sh.id, 'merges', sh.merges], [sh.id, 'freeze', sh.freeze], [sh.id, 'filter', sh.filter]];

  // Insert or delete rows or columns. The inverse moves the cells back without rewriting formulas, then restores what
  // this one removed or rewrote exactly.
  const structure = (wb, op, hooks, run) => {
    const sh = need(wb, op.sheet);
    const row = op.axis === 'row';
    if (!row && op.axis !== 'col') fail('op', 'axis is row or col');
    const max = row ? MAX_ROWS : MAX_COLS;
    const insert = op.op === 'insert';
    const { at, n: count } = op;
    if (!index(at, max) || !Number.isInteger(count) || count < 1 || (!insert && at + count > max)) fail('bounds', 'no such rows or columns');
    const n = insert ? count : -count;
    if (insert) {
      for (const [r, cells] of sh.rows) {
        const edge = Math.max(at, max - count);
        if (row ? r >= edge : [...cells.keys()].some((c) => c >= edge)) fail('bounds', 'cells would move past the last row or column');
      }
    }
    const restore = { op: 'restore', cells: [], formulas: [], names: null, dims: [], hidden: [], props: props(sh) };
    if (hooks.shift && op.shift !== false) {
      const change = { sheet: sh.name, axis: op.axis, at, n };
      const deleted = (s, r, c) => !insert && s === sh && (row ? r : c) >= at && (row ? r : c) < at + count;
      const done = rewrite(wb, (f, host) => hooks.shift(f, change, host), deleted);
      restore.formulas = done.formulas;
      restore.names = done.names;
    }
    const axis = op.axis;
    if (row) {
      sh.rows = shiftMap(sh.rows, at, n, max, (r, cells) => { for (const [c, x] of cells) restore.cells.push([sh.id, r, c, x]); });
      sh.rowH = shiftMap(sh.rowH, at, n, max, (i, size) => restore.dims.push([sh.id, axis, i, size]));
      sh.hidden.rows = shiftSet(sh.hidden.rows, at, n, max, (i) => restore.hidden.push([sh.id, axis, i, true]));
    } else {
      for (const [r, cells] of sh.rows) {
        const next = shiftMap(cells, at, n, max, (c, x) => restore.cells.push([sh.id, r, c, x]));
        if (next.size) sh.rows.set(r, next); else sh.rows.delete(r);
      }
      sh.colW = shiftMap(sh.colW, at, n, max, (i, size) => restore.dims.push([sh.id, axis, i, size]));
      sh.hidden.cols = shiftSet(sh.hidden.cols, at, n, max, (i) => restore.hidden.push([sh.id, axis, i, true]));
    }
    if (run.count !== undefined) run.count -= restore.cells.length;
    // An array formula's range is its first cell's: it moves with that cell, keeping its size.
    for (const [r, cells] of sh.rows) for (const [c, x] of cells) {
      if (x.a === undefined) continue;
      const g = rangePosition(x.a);
      if (g && (g.r0 !== r || g.c0 !== c)) cells.set(c, { ...x, a: rangeName(r, c, Math.min(r + g.r1 - g.r0, MAX_ROWS - 1), Math.min(c + g.c1 - g.c0, MAX_COLS - 1)) });
    }
    sh.merges =sh.merges.map((g) => shiftRange(g, row, at, n)).filter(Boolean);
    if (sh.filter) sh.filter = shiftRange(sh.filter, row, at, n);
    if (sh.freeze) {
      const k = row ? sh.freeze.rows : sh.freeze.cols;
      const next = insert ? (at < k ? k + count : k) : k - Math.max(0, Math.min(k, at + count) - at);
      sh.freeze = row ? { ...sh.freeze, rows: next } : { ...sh.freeze, cols: next };
    }
    run.rebuild = true;
    return { op: 'batch', ops: [{ op: insert ? 'delete' : 'insert', sheet: sh.id, axis, at, n: count, shift: false }, restore] };
  };

  const restoreOp = (wb, op, run) => {
    const back = { op: 'restore', cells: [], formulas: [], names: null, dims: [], hidden: [], props: [] };
    for (const [id, r, c, x] of op.cells || []) back.cells.unshift([id, r, c, put(wb, need(wb, id), r, c, x, run)]);
    for (const [id, r, c, f] of op.formulas || []) {
      const row = need(wb, id).rows.get(r), x = row?.get(c);
      if (!x) continue;
      back.formulas.push([id, r, c, x.f]);
      const next = { ...x, f };
      if (f === undefined) delete next.f;
      row.set(c, next);
      run.touched.push([id, r, c]);
    }
    if (op.names) { back.names = wb.names; wb.names = op.names.map((x) => ({ ...x })); }
    for (const [id, axis, i, size] of op.dims || []) {
      const map = need(wb, id)[axis === 'row' ? 'rowH' : 'colW'];
      back.dims.push([id, axis, i, map.get(i) ?? null]);
      if (size === null) map.delete(i); else map.set(i, size);
    }
    for (const [id, axis, i, on] of op.hidden || []) {
      const set = need(wb, id).hidden[axis === 'row' ? 'rows' : 'cols'];
      back.hidden.push([id, axis, i, set.has(i)]);
      if (on) set.add(i); else set.delete(i);
    }
    for (const [id, key, value] of op.props || []) { const sh = need(wb, id); back.props.push([id, key, sh[key]]); sh[key] = value; }
    if (op.formulas?.length || op.names) run.rebuild = true;
    return back;
  };

  const PROPS = new Set(['merges', 'freeze', 'filter', 'charts']);
  const OPS = {
    set: (wb, op, hooks, run) => { const sh = need(wb, op.sheet); return { op: 'set', sheet: sh.id, r: op.r, c: op.c, cell: put(wb, sh, op.r, op.c, op.cell, run) }; },
    cells: (wb, op, hooks, run) => {
      const sh = need(wb, op.sheet);
      const back = [];
      try {
        for (const [r, c, x] of op.cells) back.push([r, c, put(wb, sh, r, c, x, run)]);
      } catch (e) {
        for (const [r, c, x] of back.reverse()) put(wb, sh, r, c, x, run);
        throw e;
      }
      return { op: 'cells', sheet: sh.id, cells: back.reverse() };
    },
    clear: (wb, op, hooks, run) => {
      const sh = need(wb, op.sheet);
      const found = [];
      for (const [r, row] of sh.rows) if (r >= op.r0 && r <= op.r1) for (const c of row.keys()) if (c >= op.c0 && c <= op.c1) found.push([r, c, null]);
      return OPS.cells(wb, { op: 'cells', sheet: sh.id, cells: found }, hooks, run);
    },
    insert: structure,
    delete: structure,
    restore: (wb, op, hooks, run) => restoreOp(wb, op, run),
    rename: (wb, op, hooks, run) => {
      const sh = need(wb, op.sheet);
      const why = validName(wb, op.name, sh.id);
      if (why) fail('name', `sheet name: ${why}`);
      const from = sh.name;
      sh.name = op.name;
      run.rebuild = true;
      const back = { op: 'rename', sheet: sh.id, name: from, shift: false };
      if (!hooks.rename || op.shift === false) return back;
      const done = rewrite(wb, (f) => hooks.rename(f, from, op.name));
      return { op: 'batch', ops: [back, { op: 'restore', formulas: done.formulas, names: done.names }] };
    },
    addSheet: (wb, op, hooks, run) => {
      if (wb.sheets.length >= CAP.sheets) fail('cap-sheets', 'a workbook holds 100 sheets');
      let sh = op.sheet;
      if (!sh) {
        const name = op.name ?? nextSheetName(wb);
        const why = validName(wb, name);
        if (why) fail('name', `sheet name: ${why}`);
        sh = sheet(name, Math.max(0, ...wb.sheets.map((s) => s.id)) + 1);
      }
      const at = Math.max(0, Math.min(Number.isInteger(op.at) ? op.at : wb.sheets.length, wb.sheets.length));
      const active = wb.sheets[wb.active];
      wb.sheets.splice(at, 0, sh);
      wb.active = op.active ?? wb.sheets.indexOf(active);
      run.rebuild = true;
      return { op: 'removeSheet', sheet: sh.id, shift: false };
    },
    removeSheet: (wb, op, hooks, run) => {
      const sh = need(wb, op.sheet);
      if (wb.sheets.length === 1) fail('last-sheet', 'a workbook keeps one sheet');
      const at = wb.sheets.indexOf(sh), active = wb.active, current = wb.sheets[active];
      const names = wb.names;
      wb.sheets.splice(at, 1);
      wb.active = current === sh ? Math.min(at, wb.sheets.length - 1) : wb.sheets.indexOf(current);
      wb.names = wb.names.filter((x) => x.sheet !== sh.id);
      run.rebuild = true;
      const restore = { op: 'restore', formulas: [], names: wb.names.length !== names.length ? names : null };
      if (hooks.rename && op.shift !== false) {
        const done = rewrite(wb, (f) => hooks.rename(f, sh.name, null));
        restore.formulas = done.formulas;
        if (done.names) restore.names = names;
      }
      return { op: 'batch', ops: [{ op: 'addSheet', at, sheet: sh, active }, restore] };
    },
    moveSheet: (wb, op) => {
      const sh = need(wb, op.sheet);
      const from = wb.sheets.indexOf(sh), current = wb.sheets[wb.active];
      const to = Math.max(0, Math.min(op.to, wb.sheets.length - 1));
      wb.sheets.splice(from, 1);
      wb.sheets.splice(to, 0, sh);
      wb.active = wb.sheets.indexOf(current);
      return { op: 'moveSheet', sheet: sh.id, to: from };
    },
    size: (wb, op) => {
      const sh = need(wb, op.sheet);
      const map = op.axis === 'row' ? sh.rowH : op.axis === 'col' ? sh.colW : fail('op', 'axis is row or col');
      const prev = map.get(op.i) ?? null;
      if (op.size === null) map.delete(op.i); else map.set(op.i, op.size);
      return { op: 'size', sheet: sh.id, axis: op.axis, i: op.i, size: prev };
    },
    hide: (wb, op) => {
      const sh = need(wb, op.sheet);
      const set = op.axis === 'row' ? sh.hidden.rows : op.axis === 'col' ? sh.hidden.cols : fail('op', 'axis is row or col');
      const prev = set.has(op.i);
      if (op.hidden) set.add(op.i); else set.delete(op.i);
      return { op: 'hide', sheet: sh.id, axis: op.axis, i: op.i, hidden: prev };
    },
    prop: (wb, op) => {
      const sh = need(wb, op.sheet);
      if (!PROPS.has(op.key)) fail('op', `no sheet property ${op.key}`);
      const prev = sh[op.key];
      sh[op.key] = op.value;
      return { op: 'prop', sheet: sh.id, key: op.key, value: prev };
    },
    name: (wb, op, hooks, run) => {
      const prev = wb.names;
      const low = String(op.name).toLowerCase();
      const same = (x) => x.name.toLowerCase() === low && x.sheet === op.sheet;
      wb.names = wb.names.filter((x) => !same(x));
      if (op.ref !== null && op.ref !== undefined) wb.names.push({ name: op.name, ref: op.ref, ...(op.sheet !== undefined && { sheet: op.sheet }) });
      run.rebuild = true;
      return { op: 'restore', names: prev };
    },
    batch: (wb, op, hooks, run) => {
      const back = [];
      try {
        for (const step of op.ops) back.push(step1(wb, step, hooks, run));
      } catch (e) {
        for (const step of back.reverse()) step1(wb, step, hooks, run);
        throw e;
      }
      return { op: 'batch', ops: back.reverse() };
    },
  };
  const step1 = (wb, op, hooks, run) => (Object.hasOwn(OPS, op?.op) ? OPS[op.op] : fail('op', `no operation ${op?.op}`))(wb, op, hooks, run);
  // → { inverse, touched: [[sheetId, r, c]] cells written, rebuild: whether formulas or names changed meaning }.
  const apply = (wb, op, hooks = {}) => {
    const run = { touched: [], rebuild: false, count: undefined };
    const inverse = step1(wb, op, hooks, run);
    return { inverse, touched: run.touched, rebuild: run.rebuild };
  };

  // ── Serial dates ────────────────────────────────────────────────────────────────────────────────────────────────────
  // 1900 system: serial 1 is 1900-01-01 and 60 is 1900-02-29, a day that never was (Lotus 1-2-3's leap-year bug, which
  // Excel keeps); 1904 system: serial 0 is 1904-01-01.
  const DAY = 864e5, MAX_SERIAL = 2958465, SHIFT_1904 = 1462;
  const utc = (y, m, d) => { const t = new Date(0); t.setUTCFullYear(y, m, d); return t.getTime(); };
  const EPOCH = utc(1899, 11, 31), EPOCH_1904 = utc(1904, 0, 1);
  // DATE's arithmetic: months past 12 roll into years, days count on from the first of the month.
  const toSerial = (y, m, d, date1904 = false) => {
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12;
    let first = (utc(y, m, 1) - (date1904 ? EPOCH_1904 : EPOCH)) / DAY;
    if (!date1904 && first >= 60) first++;
    return first + d - 1;
  };
  const timeSerial = (h, m, s) => (h * 3600 + m * 60 + s) / 86400;
  // → { y, m, d, H, M, S, ms, dow (0 Sunday), day (the whole serial) }, or null outside 1900 (1904) to 9999. The time
  // is rounded to the millisecond, carrying into the next day.
  const fromSerial = (n, date1904 = false) => {
    if (!Number.isFinite(n) || n < 0) return null;
    let day = Math.floor(n), ms = Math.round((n - day) * DAY);
    if (ms >= DAY) { day++; ms -= DAY; }
    if (day > MAX_SERIAL - (date1904 ? SHIFT_1904 : 0)) return null;
    const time = { H: Math.floor(ms / 36e5), M: Math.floor(ms / 6e4) % 60, S: Math.floor(ms / 1e3) % 60, ms: ms % 1000 };
    const dow = (day + (date1904 ? SHIFT_1904 : 0) + 6) % 7;
    if (!date1904 && day === 60) return { y: 1900, m: 2, d: 29, ...time, dow, day };
    if (!date1904 && day === 0) return { y: 1900, m: 1, d: 0, ...time, dow, day };
    const t = new Date(date1904 ? EPOCH_1904 + day * DAY : EPOCH + (day < 60 ? day : day - 1) * DAY);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), ...time, dow, day };
  };

  // ── Typed input ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const monthOf = (s) => { const low = s.toLowerCase(); return MONTHS.findIndex((m) => m === low || (low.length === 3 && m.startsWith(low))) + 1; };
  const daysIn = (y, m) => (y === 1900 && m === 2 ? 29 : new Date(utc(y, m, 0)).getUTCDate());
  const fullYear = (y) => (y.length <= 2 ? (Number(y) < 30 ? 2000 : 1900) + Number(y) : Number(y));

  const NUMBER = /^(?:(\d{1,3}(?:,\d{3})+)|(\d+))?(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
  const number = (s) => {
    let neg = false;
    if (s.startsWith('(') && s.endsWith(')')) { neg = true; s = s.slice(1, -1).trim(); }
    const sign = () => { if (s[0] === '-' || s[0] === '+') { if (s[0] === '-') neg = !neg; s = s.slice(1).trim(); } };
    sign();
    const money = s[0] === '$';
    if (money) { s = s.slice(1).trim(); sign(); }
    const pct = s.endsWith('%');
    if (pct) s = s.slice(0, -1).trim();
    const m = NUMBER.exec(s);
    if (!m || !/\d/.test(s)) return null;
    const grouped = m[1] !== undefined, decimals = m[3] !== undefined && m[3] !== '', exp = m[4] !== undefined;
    if (exp && (grouped || money || pct)) return null;
    if (money && pct) return null;
    const digits = s.replace(/,/g, '');
    let v = Number(pct ? `${digits}e-2` : digits);
    if (!Number.isFinite(v)) return null;
    if (neg) v = -v;
    if (v === 0) v = 0;
    const fmt = exp ? '0.00E+00' : pct ? (decimals ? '0.00%' : '0%') : money ? (decimals ? '"$"#,##0.00' : '"$"#,##0') : grouped ? (decimals ? '#,##0.00' : '#,##0') : null;
    return fmt ? { v, fmt } : { v };
  };

  const TIME = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}(?:\.\d+)?))?\s*([ap])?(m)?$/i;
  const time = (s) => {
    const m = TIME.exec(s);
    if (!m || (m[2] === undefined && !m[4]) || (m[5] && !m[4])) return null;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0), sec = Number(m[3] ?? 0);
    if (min > 59 || sec >= 60) return null;
    if (m[4]) { if (h < 1 || h > 12) return null; h = (h % 12) + (m[4].toLowerCase() === 'p' ? 12 : 0); }
    const fmt = `${h > 23 ? '[h]:mm' : 'h:mm'}${m[3] !== undefined ? ':ss' : ''}${m[4] ? ' AM/PM' : ''}`;
    return { v: timeSerial(h, min, sec), fmt, elapsed: h > 23 };
  };

  const DATES = [
    [/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/, (x) => [x[3], x[1], x[2]], 'm/d/yyyy', 'd-mmm'],
    [/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/, (x) => [x[1], x[2], x[3]], 'm/d/yyyy'],
    [/^(\d{1,2})[-\s]+([A-Za-z]{3,9})(?:[-\s,]+(\d{2}|\d{4}))?$/, (x) => [x[3], monthOf(x[2]), x[1]], 'd-mmm-yy', 'd-mmm'],
    [/^([A-Za-z]{3,9})[-\s]+(\d{1,2})(?:,?\s+(\d{4}|\d{2}))?$/, (x) => [x[3], monthOf(x[1]), x[2]], 'd-mmm-yy', 'd-mmm'],
    [/^([A-Za-z]{3,9})[-\s]+(\d{4})$/, (x) => [x[2], monthOf(x[1]), 1], 'mmm-yy'],
  ];
  const date = (s, o) => {
    for (const [re, parts, fmt, noYear] of DATES) {
      const x = re.exec(s);
      if (!x) continue;
      const [ys, mo, ds] = parts(x);
      const y = ys === undefined ? o.year ?? new Date().getFullYear() : fullYear(ys);
      const m = Number(mo), d = Number(ds);
      if (!m || m > 12 || d < 1 || d > daysIn(y, m) || y > 9999 || y < (o.date1904 ? 1904 : 1900)) return null;
      return { v: toSerial(y, m, d, o.date1904), fmt: ys === undefined ? noYear : fmt };
    }
    return null;
  };

  // Text as Excel reads it into a number, the way typing it into a cell or coercing it in a formula does: "1,200",
  // "$5.25", "12%", "(42)", "1e3", "3/4/2025", "4-Mar", "1:30 PM", "3/4/2025 13:30". → { v, fmt? } or null. fmt: the
  // format Excel gives a General cell typed that way. o: { date1904, year (for a date typed without one) }.
  const parseNumber = (text, o = {}) => {
    const s = String(text ?? '').trim();
    if (!s) return null;
    const n = number(s);
    if (n) return n;
    const t = time(s);
    if (t) return { v: t.v, fmt: t.fmt };
    const d = date(s, o);
    if (d) return d;
    const split = /^(.*?\S)\s+(\d{1,2}(?::\d{2}(?::\d{2}(?:\.\d+)?)?)?\s*(?:[ap]m?)?)$/i.exec(s);
    if (split) {
      const dd = date(split[1], o), tt = time(split[2]);
      if (dd && tt && !tt.elapsed) return { v: dd.v + tt.v, fmt: 'm/d/yyyy h:mm' };
    }
    return null;
  };

  // What typing `text` into a cell stores: { t, v, fmt? } (fmt as parseNumber's), { f } for a formula, or null for
  // nothing. A leading apostrophe keeps the rest as text.
  const parseInput = (text, o = {}) => {
    const s = String(text ?? '');
    if (s === '') return null;
    if (s[0] === "'") return { t: 's', v: s.slice(1) };
    if (s[0] === '=' && s.length > 1) return { f: s.slice(1) };
    const up = s.trim().toUpperCase();
    if (up === 'TRUE' || up === 'FALSE') return { t: 'b', v: up === 'TRUE' };
    if (ERRORS.includes(up)) return { t: 'e', v: up };
    const n = parseNumber(s, o);
    if (n) return n.fmt ? { t: 'n', v: n.v, fmt: n.fmt } : { t: 'n', v: n.v };
    return { t: 's', v: s };
  };

  // ── Shared styles ───────────────────────────────────────────────────────────────────────────────────────────────────
  const stable = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`) : JSON.stringify(v));
  const styleKeys = new WeakMap();
  // The index of a style equal to `style`, added when the workbook has none.
  const internStyle = (wb, style) => {
    let known = styleKeys.get(wb);
    if (!known || known.list !== wb.styles || known.length !== wb.styles.length) {
      const keys = new Map();
      wb.styles.forEach((s, i) => { const k = stable(s); if (!keys.has(k)) keys.set(k, i); });
      known = { keys, list: wb.styles, length: wb.styles.length };
      styleKeys.set(wb, known);
    }
    const key = stable(style);
    if (known.keys.has(key)) return known.keys.get(key);
    wb.styles.push(style);
    known.keys.set(key, (known.length = wb.styles.length) - 1);
    return known.length - 1;
  };

  return {
    MAX_ROWS, MAX_COLS, CAP, ERRORS, columnName, columnIndex, cellName, cellPosition, rangeName, rangePosition,
    workbook, sheet, getSheet, cell, cellCount, validName, nextSheetName, apply, shiftSpan,
    toSerial, fromSerial, timeSerial, parseNumber, parseInput, internStyle,
  };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_MODEL; else GZ_SHEET_MODEL;
