// Glaze Sheets' array-shaping functions: AREAS TAKE DROP CHOOSECOLS CHOOSEROWS VSTACK HSTACK EXPAND TOCOL TOROW
// WRAPROWS WRAPCOLS, registered with the calc engine (sheet-calc.js define). All but AREAS give 2D arrays; a range
// arrives whole (to lib.used's extent, so a whole column ends at the sheet's last used row) and its blanks stay blank,
// which a cell shows as 0. Counts truncate toward zero; a negative one counts from the end; past the size is the whole
// array. An empty result is #CALC!, one past the engine's cell cap #NUM!. An index of 0 or past the size is #VALUE!;
// a shorter array stacks or wraps padded with #N/A (or pad_with, an error or a blank kept as given). AREAS counts a
// reference's areas; a 3-D reference is #VALUE! (Excel 16.114.1).
// Classic script; module.exports for node.
var GZ_SHEET_FN_LOOKUP2 = globalThis.GZ_SHEET_FN_LOOKUP2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { ERR, isErr, err, Ref, Areas, num, bool, map, toArray } = C.lib;
  const { MAX_ROWS, MAX_COLS, CAP } = M;

  const given = (v) => v !== undefined && v !== null;
  const empty = () => err('#CALC!');
  const capped = (rows, cols) => { if (rows * cols > CAP.cells) throw ERR.NUM; };

  // An array argument as a grid of values; an error is that error.
  const grid = (arg, ctx) => {
    if (isErr(arg)) throw arg;
    if (arg instanceof Areas) throw ERR.VALUE;
    const g = arg instanceof Ref ? toArray(arg, ctx) : Array.isArray(arg) ? arg : [[arg ?? null]];
    if (isErr(g)) throw g;
    return g;
  };
  const block = (g, r0, r1, c0, c1) => (r1 <= r0 || c1 <= c0 ? empty() : g.slice(r0, r1).map((line) => line.slice(c0, c1)));

  // TAKE's, DROP's and EXPAND's sizes come as given ('r'): an empty argument is omitted (null) while a blank cell is 0.
  // An array of sizes gives one result per element, each its top-left value, as the engine lifts a 'v' argument.
  const sizes = (args, ctx, f) => {
    const vals = args.map((v) => { if (!given(v)) return undefined; const x = ctx.value(v); return x ?? 0; });
    const count = (x) => { if (x === undefined) return null; if (isErr(x)) throw x; return Math.trunc(num(x ?? 0, ctx)); };
    if (!vals.some(Array.isArray)) return f(...vals.map(count));
    return map(vals, (...xs) => {
      try { const r = f(...xs.map(count)); return Array.isArray(r) ? r[0][0] : r; } catch (e) { if (isErr(e)) return e; throw e; }
    });
  };
  // pad_with: #N/A when omitted; one value (an error or a blank too); a larger range or array is #VALUE!.
  const padding = (p, ctx) => {
    if (!given(p)) return ERR.NA;
    if (p instanceof Areas) throw ERR.VALUE;
    if (p instanceof Ref) { if (p.rows !== 1 || p.cols !== 1) throw ERR.VALUE; return ctx.read(p.sheet, p.r0, p.c0); }
    if (Array.isArray(p)) { if (p.length !== 1 || p[0].length !== 1) throw ERR.VALUE; return p[0][0]; }
    return p;
  };
  // CHOOSECOLS' and CHOOSEROWS' indices: numbers or vectors of them, each 1..n or -n..-1, as positions from 0.
  const positions = (args, n, ctx) => {
    const out = [];
    for (const arg of args) {
      const g = grid(arg, ctx);
      if (g.length > 1 && g[0].length > 1) throw ERR.VALUE;
      for (const x of g.flat()) {
        if (isErr(x)) throw x;
        const k = Math.trunc(num(x ?? 0, ctx));
        if (k === 0 || Math.abs(k) > n) throw ERR.VALUE;
        out.push(k > 0 ? k - 1 : n + k);
      }
    }
    return out;
  };
  // Arrays one after another, down (VSTACK) or across; a lone error argument is that error.
  const stack = (down) => ({ p: ['a'], min: 1, fn: (args, ctx) => {
    const gs = args.map((a) => grid(a, ctx));
    const rows = down ? gs.reduce((s, g) => s + g.length, 0) : Math.max(...gs.map((g) => g.length));
    const cols = down ? Math.max(...gs.map((g) => g[0].length)) : gs.reduce((s, g) => s + g[0].length, 0);
    capped(rows, cols);
    const out = Array.from({ length: rows }, () => new Array(cols).fill(ERR.NA));
    let at = 0;
    for (const g of gs) {
      g.forEach((line, i) => line.forEach((v, j) => { if (down) out[at + i][j] = v; else out[i][at + j] = v; }));
      at += down ? g.length : g[0].length;
    }
    return out;
  } });
  // ignore: 0 keep all, 1 blanks, 2 errors, 3 both; scan_by_column reads down each column first.
  const flatten = (across) => ({ p: ['a', 'v', 'v'], min: 1, max: 3, fn: ([a, ig, byCol], ctx) => {
    const g = grid(a, ctx), ignore = given(ig) ? Math.trunc(num(ig, ctx)) : 0, cols = given(byCol) && bool(byCol);
    if (ignore < 0 || ignore > 3) throw ERR.VALUE;
    const list = [];
    const keep = (v) => { if (!((ignore & 1 && v === null) || (ignore & 2 && isErr(v)))) list.push(v); };
    if (cols) { for (let j = 0; j < g[0].length; j++) for (let i = 0; i < g.length; i++) keep(g[i][j]); } else for (const line of g) for (const v of line) keep(v);
    if (!list.length) return empty();
    return across ? [list] : list.map((v) => [v]);
  } });
  // A vector into rows (WRAPROWS) or columns of wrap_count values; a count past its length gives one line.
  const wrap = (rows) => ({ p: ['a', 'v', 'r'], min: 2, max: 3, fn: ([a, w, p], ctx) => {
    const g = grid(a, ctx);
    if (g.length > 1 && g[0].length > 1) throw ERR.VALUE;
    const n = Math.trunc(num(w, ctx));
    if (n < 1) throw ERR.NUM;
    const list = g.flat(), width = Math.min(n, list.length), lines = Math.ceil(list.length / width), pad = padding(p, ctx);
    const out = Array.from({ length: lines }, (_, i) => Array.from({ length: width }, (__, j) => (i * width + j < list.length ? list[i * width + j] : pad)));
    return rows ? out : out[0].map((_, j) => out.map((line) => line[j]));
  } });

  const FNS = {
    // A union's areas, all on one sheet; a reference across sheets is #VALUE!.
    AREAS: { p: ['r'], min: 1, max: 1, fn: ([ref]) => {
      if (isErr(ref)) return ref;
      if (ref instanceof Ref) return 1;
      if (ref instanceof Areas && ref.list.every((x) => x.sheet === ref.list[0].sheet)) return ref.list.length;
      throw ERR.VALUE;
    } },
    TAKE: { p: ['a', 'r', 'r'], min: 2, max: 3, fn: ([a, r, c], ctx) => {
      const g = grid(a, ctx);
      const part = (n, len) => (n === null ? [0, len] : n >= 0 ? [0, Math.min(n, len)] : [Math.max(0, len + n), len]);
      return sizes([r, c], ctx, (rn, cn) => block(g, ...part(rn, g.length), ...part(cn, g[0].length)));
    } },
    DROP: { p: ['a', 'r', 'r'], min: 2, max: 3, fn: ([a, r, c], ctx) => {
      const g = grid(a, ctx);
      const part = (n, len) => (n === null ? [0, len] : n >= 0 ? [Math.min(n, len), len] : [0, Math.max(0, len + n)]);
      return sizes([r, c], ctx, (rn, cn) => block(g, ...part(rn, g.length), ...part(cn, g[0].length)));
    } },
    CHOOSECOLS: { p: ['a', 'a'], min: 2, fn: ([a, ...ks], ctx) => {
      const g = grid(a, ctx), js = positions(ks, g[0].length, ctx);
      capped(g.length, js.length);
      return g.map((line) => js.map((j) => line[j]));
    } },
    CHOOSEROWS: { p: ['a', 'a'], min: 2, fn: ([a, ...ks], ctx) => {
      const g = grid(a, ctx), is = positions(ks, g.length, ctx);
      capped(is.length, g[0].length);
      return is.map((i) => g[i].slice());
    } },
    VSTACK: stack(true),
    HSTACK: stack(false),
    // rows or columns omitted keep the array's; fewer than it has is #VALUE!, as is more than a sheet holds.
    EXPAND: { p: ['a', 'r', 'r', 'r'], min: 2, max: 4, fn: ([a, r, c, p], ctx) => {
      const g = grid(a, ctx), pad = padding(p, ctx);
      return sizes([r, c], ctx, (rn, cn) => {
        const rows = rn ?? g.length, cols = cn ?? g[0].length;
        if (rows < g.length || cols < g[0].length || rows > MAX_ROWS || cols > MAX_COLS) throw ERR.VALUE;
        capped(rows, cols);
        return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (__, j) => (i < g.length && j < g[0].length ? g[i][j] : pad)));
      });
    } },
    TOCOL: flatten(false),
    TOROW: flatten(true),
    WRAPROWS: wrap(true),
    WRAPCOLS: wrap(false),
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_LOOKUP2; else GZ_SHEET_FN_LOOKUP2;
