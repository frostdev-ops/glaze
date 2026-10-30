// Glaze Sheets' calc engine. engine(wb) keeps a dependency graph of the workbook's formulas, a reverse index of what
// each one reads (bucketed per column, wide ranges apart), and recalculates what an edit dirties in dependency order on
// an explicit stack, so no chain is too deep. Volatile functions recalculate on every edit, never on a timer. A
// circular reference reads 0 and is listed in status.circular. Values are Excel's: numbers, text, booleans, the seven
// errors (XErr), blanks (null); compare is case-insensitive with number < text < FALSE < TRUE.
// Outside an array formula a range where one value belongs intersects the formula's row or column (Excel's implicit
// intersection); inside one (a cell with `a`) ranges are evaluated whole and the result fills the array's range. There
// is no spill. Functions come from the sheet-fn-*.js files through define(); their arguments are typed by p: 'v' a
// value (intersected or lifted over arrays, errors returned first), 'r' as given (references and arrays whole), 'l' a
// thunk evaluated on demand, 'a' evaluated as in an array formula.
// Classic script; module.exports for node.
var GZ_SHEET_CALC = globalThis.GZ_SHEET_CALC || (() => {
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const NF = typeof GZ_SHEET_NUMFMT !== 'undefined' ? GZ_SHEET_NUMFMT : require('./sheet-numfmt.js');
  const F = typeof GZ_SHEET_FORMULA !== 'undefined' ? GZ_SHEET_FORMULA : require('./sheet-formula.js');
  const { MAX_ROWS, MAX_COLS, CAP } = M;

  class XErr { constructor(code) { this.code = code; } toString() { return this.code; } }
  const ERR = Object.freeze({ NULL: new XErr('#NULL!'), DIV0: new XErr('#DIV/0!'), VALUE: new XErr('#VALUE!'), REF: new XErr('#REF!'), NAME: new XErr('#NAME?'), NUM: new XErr('#NUM!'), NA: new XErr('#N/A') });
  const CODES = new Map(Object.values(ERR).map((e) => [e.code, e]));
  // An error cached in a file under a newer name (#SPILL!, #CALC!) reads as itself; it is never produced here.
  const err = (code) => { let e = CODES.get(code); if (!e) CODES.set(code, (e = new XErr(code))); return e; };
  const isErr = (v) => v instanceof XErr;

  class Ref {
    constructor(sheet, r0, c0, r1, c1) { this.sheet = sheet; this.r0 = r0; this.c0 = c0; this.r1 = r1; this.c1 = c1; }
    get rows() { return this.r1 - this.r0 + 1; }
    get cols() { return this.c1 - this.c0 + 1; }
  }
  class Areas { constructor(list) { this.list = list; } }

  const VOLATILE = new Set(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN', 'OFFSET', 'INDIRECT', 'RANDARRAY', 'CELL', 'INFO']);
  const REGISTRY = new Map();
  // One definition per name: a second is a mistake (two files claiming one function), never an override.
  const define = (name, def) => {
    if (REGISTRY.has(name)) throw Error(`${name} is defined twice`);
    REGISTRY.set(name, { name, min: def.min ?? 0, max: def.max ?? CAP.args, p: def.p ?? ['v'], rep: def.rep ?? 1, errors: def.errors === true,
      volatile: def.volatile === true || VOLATILE.has(name), fn: def.fn });
  };
  const fn = (name) => REGISTRY.get(name) ?? null;
  const kindAt = (def, i) => (i < def.p.length ? def.p[i] : def.p[def.p.length - def.rep + ((i - def.p.length) % def.rep)]);

  // ── Coercion ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const cellValue = (cell) => {
    if (!cell) return null;
    switch (cell.t) {
      case 'n': return typeof cell.v === 'number' ? cell.v : null;
      case 's': return typeof cell.v === 'string' ? cell.v : null;
      case 'b': return cell.v === true;
      case 'e': return err(cell.v);
      default: return null;
    }
  };
  const num = (v, ctx) => {
    if (typeof v === 'number') return v;
    if (v === null || v === undefined) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (isErr(v)) throw v;
    if (typeof v === 'string') { const n = M.parseNumber(v, { date1904: ctx?.date1904 }); if (n) return n.v; }
    throw ERR.VALUE;
  };
  const text = (v) => {
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return NF.numberText(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v === null || v === undefined) return '';
    if (isErr(v)) throw v;
    throw ERR.VALUE;
  };
  const bool = (v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v === null || v === undefined) return false;
    if (isErr(v)) throw v;
    const up = String(v).toUpperCase();
    if (up === 'TRUE' || up === 'FALSE') return up === 'TRUE';
    throw ERR.VALUE;
  };
  const same = (a, b) => a === b || Number(a.toPrecision(15)) === Number(b.toPrecision(15));
  const COLLATE = new Intl.Collator('en-US');
  const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : 2);
  // Excel's order: numbers, then text (any case), then FALSE, then TRUE; a blank is 0, "" or FALSE beside the other.
  const compare = (a, b) => {
    if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (ra === 0) return same(a, b) ? 0 : a < b ? -1 : 1;
    if (ra === 1) { const la = a.toLowerCase(), lb = b.toLowerCase(); return la === lb ? 0 : COLLATE.compare(la, lb) || (la < lb ? -1 : 1); }
    return a === b ? 0 : a ? 1 : -1;
  };

  // x rounded to d decimals from its 15 significant digits: 'half' away from zero, 'up' away, 'down' toward.
  const round = (x, d, mode = 'half') => {
    if (!Number.isFinite(x) || x === 0) return x;
    d = Math.trunc(d);
    if (d > 300) return x;
    if (d < -308) return 0;
    const sign = x < 0 ? -1 : 1;
    const [m, e] = Number(Math.abs(x).toPrecision(15)).toExponential().split('e');
    const shifted = Number(`${m}e${Number(e) + d}`);
    if (!Number.isFinite(shifted)) return x;
    const k = mode === 'half' ? Math.floor(shifted + 0.5) : mode === 'up' ? Math.ceil(shifted) : Math.floor(shifted);
    return sign * Number(`${k}e${-d}`) || 0;
  };

  // ── Arrays ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const dims = (v) => (Array.isArray(v) ? [v.length, v[0]?.length ?? 0] : [1, 1]);
  const at = (v, i, j) => {
    if (!Array.isArray(v)) return v;
    const ii = v.length === 1 ? 0 : i, jj = v[0].length === 1 ? 0 : j;
    return ii < v.length && jj < v[0].length ? v[ii][jj] : ERR.NA;
  };
  // fn over several values element by element, arrays broadcast Excel's way (a single row or column stretches; past
  // the end of a shorter array is #N/A).
  const map = (vals, f) => {
    if (!vals.some(Array.isArray)) return f(...vals);
    let rows = 1, cols = 1;
    for (const v of vals) { const [r, c] = dims(v); rows = Math.max(rows, r); cols = Math.max(cols, c); }
    if (rows * cols > CAP.cells) return ERR.NUM;
    const out = new Array(rows);
    for (let i = 0; i < rows; i++) { out[i] = new Array(cols); for (let j = 0; j < cols; j++) out[i][j] = f(...vals.map((v) => at(v, i, j))); }
    return out;
  };

  // ── Reading ranges ──────────────────────────────────────────────────────────────────────────────────────────────────
  // cb(value, i, j) for each cell present in a range (offsets from its corner), row by row when `ordered`.
  const eachCell = (ref, ctx, cb, ordered = false) => {
    const { sheet, r0, c0, r1, c1 } = ref;
    const visitRow = (r, row) => {
      if (c1 - c0 + 1 <= row.size) { for (let c = c0; c <= c1; c++) if (row.has(c)) cb(ctx.read(sheet, r, c), r - r0, c - c0); return; }
      const cs = [];
      for (const c of row.keys()) if (c >= c0 && c <= c1) cs.push(c);
      if (ordered) cs.sort((a, b) => a - b);
      for (const c of cs) cb(ctx.read(sheet, r, c), r - r0, c - c0);
    };
    if (r1 - r0 + 1 <= sheet.rows.size) { for (let r = r0; r <= r1; r++) { const row = sheet.rows.get(r); if (row) visitRow(r, row); } return; }
    const rs = [];
    for (const r of sheet.rows.keys()) if (r >= r0 && r <= r1) rs.push(r);
    if (ordered) rs.sort((a, b) => a - b);
    for (const r of rs) visitRow(r, sheet.rows.get(r));
  };
  // cb(value, direct) for each value an argument holds: a typed value is direct; a reference gives its non-blank cells,
  // an array its elements.
  const each = (arg, ctx, cb, ordered = false) => {
    if (arg instanceof Ref) eachCell(arg, ctx, (v) => { if (v !== null) cb(v, false); }, ordered);
    else if (arg instanceof Areas) for (const ref of arg.list) eachCell(ref, ctx, (v) => { if (v !== null) cb(v, false); }, ordered);
    else if (Array.isArray(arg)) { for (const row of arg) for (const v of row) if (v !== null) cb(v, false); }
    else cb(arg, true);
  };
  // A range's last row and column as the engine reads it: one of more than 4,096 rows or columns (a whole row or
  // column) stops at the sheet's last used cell, keeping at least its first row and column.
  const used = (ref, ctx) => {
    if (ref.r1 - ref.r0 < 4096 && ref.c1 - ref.c0 < 4096) return [ref.r1, ref.c1];
    const [mr, mc] = ctx.extent(ref.sheet);
    return [Math.max(ref.r0, Math.min(ref.r1, mr)), Math.max(ref.c0, Math.min(ref.c1, mc))];
  };
  // A range as a grid of values, to its used extent.
  const toArray = (ref, ctx) => {
    const [r1, c1] = used(ref, ctx);
    if ((r1 - ref.r0 + 1) * (c1 - ref.c0 + 1) > CAP.cells) return ERR.NUM;
    const out = [];
    for (let r = ref.r0; r <= r1; r++) { const row = new Array(c1 - ref.c0 + 1); for (let c = ref.c0; c <= c1; c++) row[c - ref.c0] = ctx.read(ref.sheet, r, c); out.push(row); }
    return out;
  };
  // A range or array as positions: rows, cols, get(i, j), and each(cb(i, j, v)) over its non-blank positions.
  const view = (arg, ctx) => {
    if (arg instanceof Ref) {
      return { rows: arg.rows, cols: arg.cols, get: (i, j) => ctx.read(arg.sheet, arg.r0 + i, arg.c0 + j), each: (cb) => eachCell(arg, ctx, (v, i, j) => { if (v !== null) cb(i, j, v); }) };
    }
    if (arg instanceof Areas) throw ERR.VALUE;
    const a = Array.isArray(arg) ? arg : [[arg]];
    return { rows: a.length, cols: a[0].length, get: (i, j) => a[i]?.[j] ?? null, each: (cb) => a.forEach((row, i) => row.forEach((v, j) => { if (v !== null) cb(i, j, v); })) };
  };
  const resize = (arg, rows, cols) => (arg instanceof Ref ? new Ref(arg.sheet, arg.r0, arg.c0, Math.min(arg.r0 + rows - 1, MAX_ROWS - 1), Math.min(arg.c0 + cols - 1, MAX_COLS - 1)) : arg);

  // A criteria argument (SUMIF, COUNTIFS…) as a test of one cell's value. Text criteria may start with = <> < > <= >=;
  // what follows reads as typed input, so ">3/4/2025" compares dates. * and ? are wildcards (~ escapes them) in = and
  // <>. A number also matches text that reads as that number; an empty criteria cell is 0; "" matches blank and empty
  // text, "=" only blank, "<>" anything not blank.
  const wildcard = (t) => {
    if (!/[*?~]/.test(t)) { const low = t.toLowerCase(); return (s) => s.toLowerCase() === low; }
    let re = '';
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (ch === '~' && '*?~'.includes(t[i + 1] ?? '')) re += `\\${t[++i]}`;
      else if (ch === '*') re += '[\\s\\S]*';
      else if (ch === '?') re += '[\\s\\S]';
      else re += ch.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
    }
    const rx = new RegExp(`^${re}$`, 'i');
    return (s) => rx.test(s);
  };
  const test = (op, c) => (op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0);
  const criteria = (c, ctx) => {
    if (isErr(c)) return (v) => v === c;
    if (c === null || c === undefined) c = 0;
    const numEq = (n) => (v) => (typeof v === 'number' && same(v, n)) || (typeof v === 'string' && /\d/.test(v) && (() => { const x = M.parseNumber(v, { date1904: ctx.date1904 }); return !!x && same(x.v, n); })());
    if (typeof c === 'number') return numEq(c);
    if (typeof c === 'boolean') return (v) => v === c;
    const [, op = '', rest] = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c);
    if (rest === '') return op === '' ? (v) => v === null || v === '' : op === '=' ? (v) => v === null : op === '<>' ? (v) => v !== null : () => false;
    const n = M.parseNumber(rest, { date1904: ctx.date1904 }), up = rest.toUpperCase();
    if (n) {
      const eq = numEq(n.v);
      if (op === '' || op === '=') return eq;
      if (op === '<>') return (v) => !eq(v);
      return (v) => typeof v === 'number' && test(op, compare(v, n.v));
    }
    if (up === 'TRUE' || up === 'FALSE') {
      const b = up === 'TRUE';
      if (op === '' || op === '=') return (v) => v === b;
      if (op === '<>') return (v) => v !== b;
      return (v) => typeof v === 'boolean' && test(op, compare(v, b));
    }
    if (CODES.has(up)) { const e = err(up); return op === '<>' ? (v) => v !== e : op === '' || op === '=' ? (v) => v === e : () => false; }
    const match = wildcard(rest);
    if (op === '' || op === '=') return (v) => typeof v === 'string' && match(v);
    if (op === '<>') return (v) => !(typeof v === 'string' && match(v));
    return (v) => typeof v === 'string' && test(op, compare(v, rest));
  };

  // ── Evaluation ──────────────────────────────────────────────────────────────────────────────────────────────────────
  class Ctx {
    constructor(eng, sheet, r, c, array, depth = 0) { this.eng = eng; this.sheet = sheet; this.r = r; this.c = c; this.array = array; this.depth = depth; this.date1904 = eng.wb.date1904; }
    read(sheet, r, c) { return this.eng.read(sheet, r, c); }
    now() { return this.eng.time; }
    random() { return (this.eng.opts.random || Math.random)(); }
    // The workbook as functions see it: sheets in tab order, a sheet by name (any case), a defined name's value (n: a
    // name node, { name, sheet }), a sheet's last used [row, column], the formula computing a cell, a style by index.
    get sheets() { return this.eng.wb.sheets; }
    sheetNamed(name) { return this.eng.sheetNamed(name); }
    evalName(n) { return this.eng.evalName(n, this); }
    extent(sheet) { return this.eng.extent(sheet); }
    formulaAt(sheet, r, c) { return this.eng.formulaAt(sheet, r, c); }
    style(s) { return this.eng.wb.styles[s] ?? null; }
    // A value where one value belongs: a range intersects (or, in an array formula, becomes its grid of values).
    value(v) {
      if (v instanceof Ref) {
        if (v.r0 === v.r1 && v.c0 === v.c1) return this.read(v.sheet, v.r0, v.c0);
        return this.array ? toArray(v, this) : intersect(v, this);
      }
      return v instanceof Areas ? ERR.VALUE : v;
    }
  }
  const intersect = (ref, ctx) => {
    if (ref.r0 === ref.r1 && ref.c0 === ref.c1) return ctx.read(ref.sheet, ref.r0, ref.c0);
    if (ref.c0 === ref.c1 && ctx.r >= ref.r0 && ctx.r <= ref.r1) return ctx.read(ref.sheet, ctx.r, ref.c0);
    if (ref.r0 === ref.r1 && ctx.c >= ref.c0 && ctx.c <= ref.c1) return ctx.read(ref.sheet, ref.r0, ctx.c);
    return ERR.VALUE;
  };

  const makeRef = (n, ctx) => {
    const eng = ctx.eng;
    const sheet = n.sheet === null ? ctx.sheet : eng.sheetNamed(n.sheet);
    if (!sheet) return ERR.REF;
    const pos = (v, abs, host) => (abs ? v : v + host);
    const r0 = pos(n.r0, n.abs[0], ctx.r), c0 = pos(n.c0, n.abs[1], ctx.c), r1 = pos(n.r1, n.abs[2], ctx.r), c1 = pos(n.c1, n.abs[3], ctx.c);
    if (r0 < 0 || c0 < 0 || r1 >= MAX_ROWS || c1 >= MAX_COLS) return ERR.REF;
    if (!n.sheet2) return new Ref(sheet, r0, c0, r1, c1);
    const last = eng.sheetNamed(n.sheet2);
    if (!last) return ERR.REF;
    const a = eng.wb.sheets.indexOf(sheet), b = eng.wb.sheets.indexOf(last);
    return new Areas(eng.wb.sheets.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => new Ref(s, r0, c0, r1, c1)));
  };

  const numeric = (f) => (x, y, ctx) => {
    if (isErr(x)) return x;
    if (isErr(y)) return y;
    let a, b;
    try { a = num(x, ctx); b = num(y, ctx); } catch (e) { if (isErr(e)) return e; throw e; }
    const r = f(a, b);
    return isErr(r) ? r : Number.isFinite(r) ? r || 0 : ERR.NUM;
  };
  const power = (a, b) => {
    if (a === 0 && b === 0) return ERR.NUM;
    if (a === 0 && b < 0) return ERR.DIV0;
    if (a < 0 && !Number.isInteger(b)) return ERR.NUM;
    return a ** b;
  };
  // KB 78113: when a formula's last operation adds or subtracts and the result is within a rounding error of zero,
  // Excel shows 0.
  const snap = (r, a, b) => {
    const magnitude = Math.max(Math.abs(a), Math.abs(b));
    let e = Math.floor(Math.log2(magnitude));
    if (2 ** e > magnitude) e--;
    // The binary boundary is verified in Excel; KB 78113 describes the optimization without specifying its threshold.
    return r !== 0 && Math.abs(r) < 2 ** (e - 49) ? 0 : r;
  };
  const OPS = {
    '+': numeric((a, b) => a + b), '-': numeric((a, b) => a - b), '*': numeric((a, b) => a * b),
    '/': numeric((a, b) => (b === 0 ? ERR.DIV0 : a / b)), '^': numeric(power),
    top: { '+': numeric((a, b) => snap(a + b, a, b)), '-': numeric((a, b) => snap(a - b, a, b)) },
    '&': (x, y) => { if (isErr(x)) return x; if (isErr(y)) return y; const s = text(x) + text(y); return s.length > CAP.text ? ERR.VALUE : s; },
  };
  const COMPARE = { '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '>=': (c) => c >= 0 };

  const evaluate = (n, ctx, top = false) => {
    switch (n.k) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': return err(n.v);
      case 'empty': return null;
      case 'array': return (n.value ??= n.rows.map((row) => row.map((v) => (v && typeof v === 'object' ? err(v.err) : v))));
      case 'ref': return makeRef(n, ctx);
      case 'name': return ctx.eng.evalName(n, ctx);
      case 'table': case 'ext': return ERR.REF;
      case 'fn': return call(n, ctx);
      case 'union': {
        const list = [];
        for (const item of n.items) {
          const v = evaluate(item, ctx);
          if (isErr(v)) return v;
          if (v instanceof Ref) list.push(v); else if (v instanceof Areas) list.push(...v.list); else return ERR.VALUE;
        }
        return new Areas(list);
      }
      case 'un': {
        const v = evaluate(n.a, ctx);
        if (n.op === '+') return v;
        if (n.op === '@') return v instanceof Ref ? intersect(v, ctx) : Array.isArray(v) ? v[0][0] : v;
        return map([ctx.value(v)], (x) => numeric((a) => -a)(x, 0, ctx));
      }
      case 'pct': return map([ctx.value(evaluate(n.a, ctx))], (x) => numeric((a) => a / 100)(x, 0, ctx));
      case 'bin': {
        if (n.op === ':' || n.op === ' ') {
          const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
          if (isErr(a)) return a;
          if (isErr(b)) return b;
          if (!(a instanceof Ref) || !(b instanceof Ref) || a.sheet !== b.sheet) return ERR.VALUE;
          if (n.op === ':') return new Ref(a.sheet, Math.min(a.r0, b.r0), Math.min(a.c0, b.c0), Math.max(a.r1, b.r1), Math.max(a.c1, b.c1));
          const r0 = Math.max(a.r0, b.r0), c0 = Math.max(a.c0, b.c0), r1 = Math.min(a.r1, b.r1), c1 = Math.min(a.c1, b.c1);
          return r0 > r1 || c0 > c1 ? ERR.NULL : new Ref(a.sheet, r0, c0, r1, c1);
        }
        const a = ctx.value(evaluate(n.a, ctx)), b = ctx.value(evaluate(n.b, ctx));
        if (COMPARE[n.op]) {
          const test1 = COMPARE[n.op];
          return map([a, b], (x, y) => (isErr(x) ? x : isErr(y) ? y : test1(compare(x, y))));
        }
        const op = (top && !n.grouped && OPS.top[n.op]) || OPS[n.op];
        return map([a, b], (x, y) => op(x, y, ctx));
      }
      default: return ERR.VALUE;
    }
  };

  const invoke = (def, args, ctx) => {
    if (!def.errors) for (let i = 0; i < args.length; i++) if (isErr(args[i]) && kindAt(def, i) === 'v') return args[i];
    try { return def.fn(args, ctx); } catch (e) { if (isErr(e)) return e; throw e; }
  };
  const call = (n, ctx) => {
    const def = REGISTRY.get(n.name);
    if (!def) return ERR.NAME;
    const argc = n.args.length;
    if (argc < def.min || argc > def.max) return ERR.VALUE;
    const args = new Array(argc);
    let lifted = false;
    for (let i = 0; i < argc; i++) {
      const kind = kindAt(def, i), a = n.args[i];
      if (kind === 'l') { args[i] = () => evaluate(a, ctx); continue; }
      if (kind === 'a') { args[i] = evaluate(a, ctx.array ? ctx : new Ctx(ctx.eng, ctx.sheet, ctx.r, ctx.c, true, ctx.depth)); continue; }
      const v = evaluate(a, ctx);
      args[i] = kind === 'r' ? v : ctx.value(v);
      if (kind === 'v' && Array.isArray(args[i])) lifted = true;
    }
    if (!lifted) return invoke(def, args, ctx);
    const slots = args.map((v, i) => (kindAt(def, i) === 'v' ? v : null));
    return map(slots, (...xs) => invoke(def, xs.map((x, i) => (kindAt(def, i) === 'v' ? x : args[i])), ctx));
  };

  // What a cell shows of a formula's result: a range intersects (or, in an array formula, gives its top-left), an
  // array its top-left; blank is 0; past Excel's limits is #NUM! or #VALUE!.
  const toCell = (v) => {
    if (Array.isArray(v)) v = v[0][0];
    if (v === null || v === undefined) return { t: 'n', v: 0 };
    if (typeof v === 'number') return Number.isFinite(v) ? { t: 'n', v: v || 0 } : { t: 'e', v: '#NUM!' };
    if (typeof v === 'string') return v.length > CAP.text ? { t: 'e', v: '#VALUE!' } : { t: 's', v };
    if (typeof v === 'boolean') return { t: 'b', v };
    if (isErr(v)) return { t: 'e', v: v.code };
    return { t: 'e', v: '#VALUE!' };
  };
  const settle = (v, ctx) => {
    if (v instanceof Ref) return ctx.array ? (v.r0 === v.r1 && v.c0 === v.c1 ? ctx.read(v.sheet, v.r0, v.c0) : toArray(v, ctx)) : intersect(v, ctx);
    return v instanceof Areas ? ERR.VALUE : v;
  };

  // ── The graph ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const WIDE = 64;
  // Canonical binary-tree segments let a point query visit at most one path, rather than every range in a column.
  const segments = (first, last, base) => {
    const out = [];
    for (let a = first + base, b = last + base; a <= b; a = Math.floor(a / 2), b = Math.floor(b / 2)) {
      if (a % 2) out.push(a++);
      if (!(b % 2)) out.push(b--);
    }
    return out;
  };
  const path = function* (point, base) { for (let k = point + base; k; k = Math.floor(k / 2)) yield k; };
  const addEntry = (map, segment, k) => {
    let entries = map.get(segment);
    if (!entries) map.set(segment, (entries = new Set()));
    entries.add(k);
  };
  const removeEntry = (map, segment, k) => {
    const entries = map.get(segment);
    if (entries) { entries.delete(k); if (!entries.size) map.delete(segment); }
  };
  const key = (id, r, c) => (id * MAX_ROWS + r) * MAX_COLS + c;
  const analyses = new WeakMap();
  const analyze = (ast) => {
    let info = analyses.get(ast);
    if (info) return info;
    info = { refs: [], names: [], fns: new Set(), opaque: false };
    const walk = (n) => {
      if (n.k === 'ref') info.refs.push(n);
      else if (n.k === 'name') info.names.push(n);
      else if (n.k === 'table' || n.k === 'ext') info.opaque = true;
      else if (n.k === 'fn') info.fns.add(n.name);
      for (const x of n.args || n.items || []) walk(x);
      if (n.a) walk(n.a);
      if (n.b) walk(n.b);
    };
    walk(ast);
    analyses.set(ast, info);
    return info;
  };

  class Engine {
    constructor(wb, opts = {}) {
      this.wb = wb;
      this.opts = opts;
      this.nodes = new Map();
      this.index = new Map();
      this.dirty = new Set();
      this.volatile = new Set();
      this.members = new Map();
      this.circular = new Map();
      this.needs = null;
      this.changed = new Map();
      this.status = { circular: [] };
      this.time = Date.now();
      this.build();
    }

    sheetNamed(name) { return this.byName.get(String(name).toLowerCase()) ?? null; }
    extent(sheet) {
      let e = this.extents.get(sheet);
      if (!e) {
        let mr = 0, mc = 0;
        for (const [r, row] of sheet.rows) { if (r > mr) mr = r; for (const c of row.keys()) if (c > mc) mc = c; }
        this.extents.set(sheet, (e = [mr, mc]));
      }
      return e;
    }

    checkArrays() {
      let count = M.cellCount(this.wb);
      const holes = new Map();
      for (const sheet of this.wb.sheets) for (const [r, row] of sheet.rows) for (const [c, cell] of row) {
        if (cell.f === undefined || cell.a === undefined) continue;
        const span = M.rangePosition(cell.a);
        if (!span || span.r0 !== r || span.c0 !== c) continue;
        const area = (span.r1 - r + 1) * (span.c1 - c + 1);
        if (area > CAP.cells) throw Object.assign(new Error('array exceeds cell cap'), { code: 'cap-cells' });
        for (let i = r; i <= span.r1; i++) for (let j = c; j <= span.c1; j++) {
          const k = key(sheet.id, i, j);
          if (!M.cell(sheet, i, j) && !holes.has(k)) {
            if (++count > CAP.cells) throw Object.assign(new Error('array exceeds cell cap'), { code: 'cap-cells' });
            holes.set(k, [sheet.id, i, j, null]);
          }
        }
      }
      return [...holes.values()];
    }

    build() {
      this.checkArrays();
      this.nodes.clear(); this.index.clear(); this.volatile.clear(); this.members.clear(); this.dirty.clear(); this.circular.clear();
      this.byName = new Map(this.wb.sheets.map((s) => [s.name.toLowerCase(), s]));
      this.byId = new Map(this.wb.sheets.map((s) => [s.id, s]));
      this.extents = new Map();
      this.names = new Map();
      for (const x of this.wb.names) {
        const scope = x.sheet === undefined ? null : this.byId.get(x.sheet) ?? null;
        if (x.sheet !== undefined && !scope) continue;
        let ast = null;
        try { ast = F.compile(String(x.ref), 0, 0).ast; } catch { ast = null; }
        this.names.set(`${scope ? scope.id : ''}|${x.name.toLowerCase()}`, { ast, scope });
      }
      for (const sheet of this.wb.sheets) for (const [r, row] of sheet.rows) for (const [c, cell] of row) if (cell.f !== undefined) this.add(sheet, r, c, cell);
    }

    nameDef(name, sheet) {
      const low = name.toLowerCase();
      return (sheet && this.names.get(`${sheet.id}|${low}`)) || this.names.get(`|${low}`) || null;
    }
    evalName(n, ctx) {
      const scope = n.sheet ? this.sheetNamed(n.sheet) : ctx.sheet;
      if (n.sheet && !scope) return ERR.REF;
      const def = this.nameDef(n.name, scope);
      if (!def?.ast || ctx.depth > 16) return ERR.NAME;
      return evaluate(def.ast, new Ctx(this, def.scope || ctx.sheet, 0, 0, ctx.array, ctx.depth + 1));
    }

    register(node, id, r0, c0, r1, c1) {
      let si = this.index.get(id);
      if (!si) this.index.set(id, (si = { cols: new Map(), wide: new Map() }));
      node.entries.push([id, r0, c0, r1, c1]);
      if (c1 - c0 >= WIDE) {
        for (const rs of segments(r0, r1, MAX_ROWS)) {
          let cols = si.wide.get(rs);
          if (!cols) si.wide.set(rs, (cols = new Map()));
          for (const cs of segments(c0, c1, MAX_COLS)) addEntry(cols, cs, node.key);
        }
        return;
      }
      for (let c = c0; c <= c1; c++) {
        let col = si.cols.get(c);
        if (!col) si.cols.set(c, (col = { cells: new Map(), ranges: new Map() }));
        if (r0 === r1) { let s = col.cells.get(r0); if (!s) col.cells.set(r0, (s = new Set())); s.add(node.key); }
        else for (const rs of segments(r0, r1, MAX_ROWS)) addEntry(col.ranges, rs, node.key);
      }
    }
    unregister(node) {
      for (const [id, r0, c0, r1, c1] of node.entries) {
        const si = this.index.get(id);
        if (!si) continue;
        if (c1 - c0 >= WIDE) {
          for (const rs of segments(r0, r1, MAX_ROWS)) {
            const cols = si.wide.get(rs);
            if (!cols) continue;
            for (const cs of segments(c0, c1, MAX_COLS)) removeEntry(cols, cs, node.key);
            if (!cols.size) si.wide.delete(rs);
          }
          continue;
        }
        for (let c = c0; c <= c1; c++) {
          const col = si.cols.get(c);
          if (!col) continue;
          if (r0 === r1) { const s = col.cells.get(r0); if (s) { s.delete(node.key); if (!s.size) col.cells.delete(r0); } }
          else for (const rs of segments(r0, r1, MAX_ROWS)) removeEntry(col.ranges, rs, node.key);
          if (!col.cells.size && !col.ranges.size) si.cols.delete(c);
        }
      }
      for (const [id, si] of this.index) if (!si.cols.size && !si.wide.size) this.index.delete(id);
      node.entries = [];
    }
    dependents(id, r, c, visit) {
      const si = this.index.get(id);
      if (!si) return;
      const col = si.cols.get(c);
      if (col) {
        const s = col.cells.get(r);
        if (s) for (const k of s) visit(k);
        for (const rs of path(r, MAX_ROWS)) { const entries = col.ranges.get(rs); if (entries) for (const k of entries) visit(k); }
      }
      for (const rs of path(r, MAX_ROWS)) {
        const cols = si.wide.get(rs);
        if (!cols) continue;
        for (const cs of path(c, MAX_COLS)) { const entries = cols.get(cs); if (entries) for (const k of entries) visit(k); }
      }
    }

    // The cells a formula reads, through its names too, as index entries.
    depend(node, ast, sheet, r, c, depth = 0) {
      const info = analyze(ast);
      const pos = (v, abs, host) => (abs ? v : v + host);
      for (const n of info.refs) {
        const first = n.sheet === null ? sheet : this.sheetNamed(n.sheet);
        if (!first) continue;
        const r0 = pos(n.r0, n.abs[0], r), c0 = pos(n.c0, n.abs[1], c), r1 = pos(n.r1, n.abs[2], r), c1 = pos(n.c1, n.abs[3], c);
        if (r0 < 0 || c0 < 0 || r1 >= MAX_ROWS || c1 >= MAX_COLS) continue;
        let sheets = [first];
        if (n.sheet2) {
          const last = this.sheetNamed(n.sheet2);
          if (!last) continue;
          const a = this.wb.sheets.indexOf(first), b = this.wb.sheets.indexOf(last);
          sheets = this.wb.sheets.slice(Math.min(a, b), Math.max(a, b) + 1);
        }
        for (const s of sheets) this.register(node, s.id, r0, c0, r1, c1);
      }
      for (const fname of info.fns) if (VOLATILE.has(fname) || REGISTRY.get(fname)?.volatile) node.volatile = true;
      if (info.opaque) node.opaque = true;
      if (depth > 16) return;
      for (const n of info.names) {
        const scope = n.sheet ? this.sheetNamed(n.sheet) : sheet;
        const def = scope || !n.sheet ? this.nameDef(n.name, scope) : null;
        if (def?.ast) this.depend(node, def.ast, def.scope || sheet, 0, 0, depth + 1);
      }
    }

    add(sheet, r, c, cell) {
      const k = key(sheet.id, r, c);
      const node = { key: k, sheet, r, c, cell, ast: null, error: false, volatile: false, opaque: false, entries: [], array: cell.a !== undefined, span: null, result: undefined };
      try { node.ast = F.compile(cell.f, r, c).ast; } catch { node.error = true; }
      if (node.ast) this.depend(node, node.ast, sheet, r, c);
      if (node.volatile) this.volatile.add(k);
      this.nodes.set(k, node);
      const span = node.array ? M.rangePosition(cell.a) : null;
      if (span && span.r0 === r && span.c0 === c && (span.r1 > r || span.c1 > c)) {
        node.span = span;
        for (let i = r; i <= span.r1; i++) for (let j = c; j <= span.c1; j++) {
          if (i === r && j === c) continue;
          const mk = key(sheet.id, i, j);
          let row = sheet.rows.get(i);
          const there = row?.get(j);
          if (there?.f !== undefined) continue;
          if (!there) { if (!row) sheet.rows.set(i, (row = new Map())); row.set(j, { t: 'z' }); }
          const member = { key: mk, sheet, r: i, c: j, master: node, i: i - r, j: j - c, entries: [] };
          this.register(member, sheet.id, r, c, r, c);
          this.nodes.set(mk, member);
          this.members.set(mk, k);
          this.dirty.add(mk);
        }
      }
      return node;
    }
    remove(k) {
      const node = this.nodes.get(k);
      if (!node) return;
      this.unregister(node);
      this.nodes.delete(k);
      this.volatile.delete(k);
      this.dirty.delete(k);
      this.circular.delete(k);
      this.members.delete(k);
      if (node.span) for (const [mk, master] of [...this.members]) if (master === k) this.remove(mk);
    }

    // The cell whose formula computes (r, c): its own, or the head of the array formula covering it; null for none.
    // sheet: a sheet or its id.
    formulaAt(sheet, r, c) {
      const sh = typeof sheet === 'number' ? this.byId.get(sheet) : sheet;
      const cell = sh?.rows.get(r)?.get(c);
      if (!cell) return null;
      return cell.f !== undefined ? cell : this.nodes.get(key(sh.id, r, c))?.master?.cell ?? null;
    }

    read(sheet, r, c) {
      const cell = sheet.rows.get(r)?.get(c);
      if (this.needs && this.dirty.size) { const k = key(sheet.id, r, c); if (this.dirty.has(k)) this.needs.add(k); }
      return cellValue(cell);
    }

    markFrom(seeds) {
      const queue = seeds.slice();
      for (let i = 0; i < queue.length; i++) {
        const [id, r, c] = queue[i];
        this.dependents(id, r, c, (k) => {
          if (this.dirty.has(k)) return;
          this.dirty.add(k);
          const n = this.nodes.get(k);
          if (n) queue.push([n.sheet.id, n.r, n.c]);
        });
      }
    }

    store(node, v) {
      let cell = node.sheet.rows.get(node.r)?.get(node.c);
      if (!cell) {
        if (!node.master) return;
        let row = node.sheet.rows.get(node.r);
        if (!row) node.sheet.rows.set(node.r, (row = new Map()));
        row.set(node.c, (cell = { t: 'z' }));
      }
      const out = toCell(v);
      if (cell.t !== out.t || !Object.is(cell.v, out.v)) { cell.t = out.t; cell.v = out.v; this.changed.set(node.key, [node.sheet.id, node.r, node.c]); }
    }
    // Evaluates a node and stores its value; → null when done, or the dirty cells it read and must wait for.
    compute(node) {
      if (node.master) {
        if (this.dirty.has(node.master.key)) return new Set([node.master.key]);
        const res = node.master.result;
        this.store(node, Array.isArray(res) ? at(res, node.i, node.j) : res);
        return null;
      }
      if (node.opaque) return null;
      if (node.error) { this.store(node, ERR.NAME); return null; }
      const ctx = new Ctx(this, node.sheet, node.r, node.c, node.array);
      const needs = (this.needs = new Set());
      let v;
      try { v = settle(evaluate(node.ast, ctx, true), ctx); } finally { this.needs = null; }
      if (needs.size) return needs;
      node.result = v;
      this.store(node, v);
      return null;
    }
    zero(node) {
      if (!node.master) node.result = 0;
      this.store(node, 0);
      const sheet = node.sheet;
      const ref = (sheet === this.wb.sheets[this.wb.active] ? '' : F.sheetPrefix(sheet.name)) + M.cellName(node.r, node.c);
      this.circular.set(node.key, { sheet: sheet.id, r: node.r, c: node.c, ref });
    }

    // Recalculates every dirty cell: depth first on an explicit stack, each cell waiting for the dirty cells it reads.
    run() {
      const seeds = [];
      for (const k of this.volatile) { this.dirty.add(k); const n = this.nodes.get(k); seeds.push([n.sheet.id, n.r, n.c]); }
      this.markFrom(seeds);
      this.time = this.opts.now ? this.opts.now() : Date.now();
      this.extents = new Map();
      const keys = [], parents = [], on = new Map();
      const push = (k, parent) => { on.set(k, keys.length); keys.push(k); parents.push(parent); };
      for (const start of [...this.dirty]) {
        if (!this.dirty.has(start)) continue;
        push(start, -1);
        while (keys.length) {
          const top = keys.length - 1, k = keys[top];
          if (!this.dirty.has(k)) { keys.pop(); parents.pop(); if (on.get(k) === top) on.delete(k); continue; }
          const node = this.nodes.get(k);
          const needs = node ? this.compute(node) : null;
          if (!needs) { this.dirty.delete(k); if (node && !node.opaque) this.circular.delete(k); keys.pop(); parents.pop(); on.delete(k); continue; }
          let ancestors = null, loop = null, pushed = false;
          for (const n of needs) {
            if (!this.dirty.has(n)) continue;
            if (on.has(n)) {
              if (!ancestors) { ancestors = new Set(); for (let i = top; i >= 0; i = parents[i]) ancestors.add(keys[i]); }
              if (ancestors.has(n)) { loop ??= n; continue; }
            }
            push(n, top);
            pushed = true;
          }
          if (pushed) continue;
          // Unreachable while needs holds only cells dirty when read; never spin if that changes.
          if (loop === null) { this.dirty.delete(k); keys.pop(); parents.pop(); on.delete(k); continue; }
          // A loop: this cell and its ancestors back to the one it waits on all wait on each other. Each reads 0.
          for (let i = top; i >= 0; i = parents[i]) {
            const m = keys[i];
            this.zero(this.nodes.get(m));
            this.dirty.delete(m);
            on.delete(m);
            if (m === loop) break;
          }
        }
      }
      this.status = { circular: [...this.circular.values()] };
    }

    finish() {
      const changed = [...this.changed.values()];
      this.changed = new Map();
      return changed;
    }
    // Every formula, from scratch. → { changed, status }
    recalc() {
      for (const k of this.nodes.keys()) this.dirty.add(k);
      this.run();
      return { changed: this.finish(), status: this.status };
    }

    // Excel refuses a change to part of an array formula's range.
    guard(op) {
      // Like restore, this inverse carries a complete saved array, including generated result cells.
      if (op.arrayUndo === true) return;
      const check = (r, c, cell) => {
        const span = cell?.f !== undefined && cell.a !== undefined ? M.rangePosition(cell.a) : null;
        if (span && span.r0 === r && span.c0 === c && (span.r1 - r + 1) * (span.c1 - c + 1) > CAP.cells) {
          throw Object.assign(new Error('array exceeds cell cap'), { code: 'cap-cells' });
        }
      };
      if (op.op === 'set') check(op.r, op.c, op.cell);
      if (op.op === 'cells') for (const [r, c, cell] of op.cells) check(r, c, cell);
      if (op.op === 'batch') { for (const x of op.ops) this.guard(x); return; }
      if (!this.members.size || !['set', 'cells', 'clear'].includes(op.op)) return;
      const sheet = this.byId.get(op.sheet);
      if (!sheet) return;
      const hit = new Set();
      if (op.op === 'set') hit.add(key(sheet.id, op.r, op.c));
      else if (op.op === 'cells') for (const [r, c] of op.cells) hit.add(key(sheet.id, r, c));
      const inside = (k) => hit.has(k) || (op.op === 'clear' && (() => { const n = this.nodes.get(k); return n.sheet === sheet && n.r >= op.r0 && n.r <= op.r1 && n.c >= op.c0 && n.c <= op.c1; })());
      const masters = new Set();
      for (const [mk, master] of this.members) if (inside(mk) || inside(master)) masters.add(master);
      for (const master of masters) {
        const all = [master, ...[...this.members].filter(([, m]) => m === master).map(([mk]) => mk)];
        if (!all.every(inside)) throw Object.assign(new Error('part of an array'), { code: 'array-part' });
      }
    }

    // A model operation (sheet-model.js apply), then the recalculation it calls for. → { inverse, changed: [[sheetId,
    // r, c]] cells whose value or content changed, status }
    apply(op) {
      this.guard(op);
      const res = M.apply(this.wb, op, F.hooks);
      const arraysChanged = res.rebuild || res.touched.some(([id, r, c]) => M.cell(this.byId.get(id), r, c)?.a !== undefined);
      if (arraysChanged) {
        let holes;
        try { holes = this.checkArrays(); }
        catch (error) { M.apply(this.wb, res.inverse, F.hooks); throw error; }
        if (holes.length) res.inverse = { op: 'batch', arrayUndo: true, ops: [{ op: 'restore', cells: holes }, res.inverse] };
      }
      for (const [id, r, c] of res.touched) this.changed.set(key(id, r, c), [id, r, c]);
      if (res.rebuild) {
        this.build();
        for (const k of this.nodes.keys()) this.dirty.add(k);
      } else {
        const seeds = [];
        for (const [id, r, c] of res.touched) {
          const k = key(id, r, c), sheet = this.byId.get(id);
          if (this.nodes.has(k) && !this.members.has(k)) this.remove(k);
          const cell = sheet.rows.get(r)?.get(c);
          if (cell?.f !== undefined) { this.add(sheet, r, c, cell); this.dirty.add(k); }
          seeds.push([id, r, c]);
        }
        this.markFrom(seeds);
      }
      this.run();
      return { inverse: res.inverse, changed: this.finish(), status: this.status };
    }

    // What typing `input` into a cell does: a formula (refused with { error } when Excel would refuse it), a value, or
    // a value that also gives a General cell the format it was typed in ("12%", "$5", "3/4/2025").
    edit(sheetId, r, c, input) {
      const sheet = this.byId.get(sheetId);
      if (!sheet) throw Object.assign(new Error(`no sheet ${sheetId}`), { code: 'sheet' });
      const x = M.parseInput(input, { date1904: this.wb.date1904 });
      const prev = M.cell(sheet, r, c);
      const style = prev?.s !== undefined ? { s: prev.s } : {};
      let cell;
      if (x === null) cell = prev?.s !== undefined ? { t: 'z', s: prev.s } : null;
      else if (x.f !== undefined) {
        try { F.parse(x.f, r, c); } catch (error) { return { error, inverse: null, changed: [], status: this.status }; }
        cell = { t: 'n', v: 0, f: F.normalize(x.f), ...style };
      } else {
        cell = { t: x.t, v: x.v, ...style };
        const fmt = this.wb.styles[prev?.s ?? 0]?.fmt;
        if (x.fmt && (fmt === undefined || fmt === 0 || fmt === 'General')) cell.s = M.internStyle(this.wb, { ...this.wb.styles[prev?.s ?? 0], fmt: x.fmt });
      }
      return this.apply({ op: 'set', sheet: sheetId, r, c, cell });
    }

    // A cell's value: a number, text, a boolean, an XErr, or null for blank.
    value(sheetId, r, c) { const sheet = this.byId.get(sheetId); return sheet ? cellValue(M.cell(sheet, r, c)) : null; }
    // A formula's value as if it were in the cell at (r, c), without writing it there.
    evaluate(text, sheetId, r, c) {
      const sheet = this.byId.get(sheetId);
      let ast;
      try { ast = F.parse(text, r, c); } catch { return ERR.NAME; }
      const ctx = new Ctx(this, sheet, r, c, false);
      const v = settle(evaluate(ast, ctx, true), ctx);
      const out = toCell(v);
      return out.t === 'e' ? err(out.v) : out.v;
    }
  }

  const engine = (wb, opts) => new Engine(wb, opts);
  const lib = { ERR, isErr, err, Ref, Areas, num, text, bool, compare, same, round, map, at, dims, each, eachCell, used, toArray, view, resize, criteria, cellValue };
  return { ERR, XErr, VOLATILE, isErr, err, define, fn, engine, lib };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_CALC; else GZ_SHEET_CALC;
