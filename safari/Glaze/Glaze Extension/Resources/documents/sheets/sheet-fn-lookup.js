// Glaze Sheets' lookup and reference functions: VLOOKUP HLOOKUP XLOOKUP XMATCH MATCH INDEX LOOKUP OFFSET INDIRECT CHOOSE
// ROW ROWS COLUMN COLUMNS ADDRESS TRANSPOSE UNIQUE SORT SORTBY FILTER SEQUENCE HYPERLINK, registered with the calc engine
// (sheet-calc.js define). A lookup matches only a value of its own kind (number, text, boolean), text without case, and
// never a blank cell. Classic approximate matches search by halves over data they take to be sorted, stepping over
// values of another kind; X lookups' approximate modes use the order number < text < logical. INDEX, OFFSET,
// INDIRECT, CHOOSE and an XLOOKUP that finds one cell give references; the dynamic-array functions give arrays, which a
// cell shows by their top-left value (there is no spill) and an array formula fills its range with.
// Classic script; module.exports for node.
var GZ_SHEET_FN_LOOKUP = globalThis.GZ_SHEET_FN_LOOKUP || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const F = typeof GZ_SHEET_FORMULA !== 'undefined' ? GZ_SHEET_FORMULA : require('./sheet-formula.js');
  const { ERR, isErr, err, Ref, Areas, num, text, bool, compare, at, dims, used, toArray, wildcard } = C.lib;
  const { MAX_ROWS, MAX_COLS, CAP } = M;

  const given = (v) => v !== undefined && v !== null;
  const whole = (v, ctx) => Math.trunc(num(v, ctx));
  const kind = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : -1);
  const equal = (a, b) => kind(a) >= 0 && kind(a) === kind(b) && compare(a, b) === 0;

  // Unlike criteria, a lookup reads ~ as an escape even in text without * or ? (Excel 16.114.1).
  const matcher = (x, wild) => (wild && typeof x === 'string' && /[*?~]/.test(x) ? wildcard(x) : (v) => equal(v, x));

  // A range or array as a grid: its size, get(i, j), and `used`, how much of it is worth searching (lib.used's
  // extent).
  const grid = (arg, ctx) => {
    if (isErr(arg)) throw arg;
    if (arg instanceof Areas) throw ERR.VALUE;
    if (arg instanceof Ref) {
      const [r1, c1] = used(arg, ctx);
      return { rows: arg.rows, cols: arg.cols, used: [r1 - arg.r0 + 1, c1 - arg.c0 + 1], get: (i, j) => ctx.read(arg.sheet, arg.r0 + i, arg.c0 + j), ref: arg };
    }
    const a = Array.isArray(arg) ? arg : [[arg]];
    return { rows: a.length, cols: a[0].length, used: [a.length, a[0].length], get: (i, j) => a[i][j], ref: null };
  };
  const column = (g, j) => ({ n: g.used[0], len: g.rows, get: (k) => g.get(k, j) });
  const row = (g, i) => ({ n: g.used[1], len: g.cols, get: (k) => g.get(i, k) });
  // A one-row or one-column grid as a vector, or null.
  const vectorOf = (g) => (g.cols === 1 ? column(g, 0) : g.rows === 1 ? row(g, 0) : null);
  // A range or array as a grid of values (#NUM! past the engine's array cap).
  const values = (arg, ctx) => {
    if (isErr(arg)) throw arg;
    if (arg instanceof Areas) throw ERR.VALUE;
    const g = arg instanceof Ref ? toArray(arg, ctx) : Array.isArray(arg) ? arg : [[arg]];
    if (isErr(g)) throw g;
    return g;
  };
  const transpose = (g) => g[0].map((_, j) => g.map((r) => r[j]));
  // ROW's and COLUMN's argument: one area (several are #REF!).
  const area = (v) => {
    if (isErr(v)) throw v;
    if (v instanceof Areas) throw ERR.REF;
    if (!(v instanceof Ref)) throw ERR.VALUE;
    return v;
  };

  // A search by halves for the last (or first) position where ok(compare(value, x)) holds, ok running true then
  // false along the vector (or false then true). A probe on a value of another kind than x moves on to the next value
  // of x's kind before the end of the half being searched. → the position, or -1.
  const probe = (vec, x, mid, hi) => {
    const want = kind(x);
    let k = mid;
    while (k <= hi && kind(vec.get(k)) !== want) k++;
    return k;
  };
  const lastTrue = (vec, x, ok) => {
    let lo = 0, hi = vec.n - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, k = probe(vec, x, mid, hi);
      if (k <= hi && ok(compare(vec.get(k), x))) { best = k; lo = k + 1; } else hi = mid - 1;
    }
    return best;
  };
  const firstTrue = (vec, x, ok) => {
    let lo = 0, hi = vec.n - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, k = probe(vec, x, mid, hi);
      if (k > hi) hi = mid - 1;
      else if (ok(compare(vec.get(k), x))) { best = k; hi = mid - 1; } else lo = k + 1;
    }
    return best;
  };
  const AT_MOST = (c) => c <= 0, AT_LEAST = (c) => c >= 0;
  const scan = (vec, test, reverse = false) => {
    if (reverse) { for (let k = vec.n - 1; k >= 0; k--) if (test(vec.get(k))) return k; } else for (let k = 0; k < vec.n; k++) if (test(vec.get(k))) return k;
    return -1;
  };
  // MATCH's types: 0 the first equal value (wildcards in text), 1 the largest value at most x in ascending data, -1 the
  // smallest at least x in descending data.
  const position = (x, vec, type) => {
    if (type === 0) return scan(vec, matcher(x, true));
    const k = lastTrue(vec, x, type > 0 ? AT_MOST : AT_LEAST);
    // Descending MATCH returns the first equal value, but the last next-larger value when no exact match exists.
    return type < 0 && k >= 0 && equal(vec.get(k), x) ? firstTrue(vec, x, AT_MOST) : k;
  };

  // X binary searches compare across kinds. The boundary is the first >= x in ascending data, or < x descending.
  const xboundary = (x, vec, up) => {
    let lo = 0, hi = vec.n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1, v = vec.get(mid), c = kind(v) < 0 ? 1 : compare(v, x);
      if (up ? c >= 0 : c < 0) hi = mid; else lo = mid + 1;
    }
    return lo;
  };

  // XLOOKUP's and XMATCH's match modes (0 exact, -1 exact or next smaller, 1 exact or next larger, 2 wildcards) and
  // search modes (1 first to last, -1 last to first, 2 by halves over ascending data, -2 over descending).
  const modes = (mm, sm, ctx) => {
    const m = given(mm) ? whole(mm, ctx) : 0, s = given(sm) ? whole(sm, ctx) : 1;
    if (![0, -1, 1, 2].includes(m) || ![1, -1, 2, -2].includes(s)) throw ERR.VALUE;
    if (m === 2 && Math.abs(s) === 2) throw ERR.VALUE;
    return [m, s];
  };
  const xfind = (x, vec, m, s) => {
    if (x === null) {
      if (s !== -1) return scan({ ...vec, n: Math.min(vec.len, vec.n + 1) }, (v) => v === null);
      return vec.len > vec.n ? vec.len - 1 : scan(vec, (v) => v === null, true);
    }
    if (s === 2 || s === -2) {
      const up = s === 2, edge = xboundary(x, vec, up), exact = up ? edge : edge - 1;
      if (exact >= 0 && exact < vec.n && equal(vec.get(exact), x)) return exact;
      const k = m === -1 ? (up ? edge - 1 : edge) : m === 1 ? (up ? edge : edge - 1) : -1;
      return k >= 0 && k < vec.n ? k : -1;
    }
    const hit = scan(vec, matcher(x, m === 2), s === -1);
    if (hit >= 0 || m === 0 || m === 2) return hit;
    let best = -1, bv;
    for (let i = 0; i < vec.n; i++) {
      const k = s === -1 ? vec.n - 1 - i : i, v = vec.get(k);
      if (kind(v) < 0 || (m === -1 ? compare(v, x) >= 0 : compare(v, x) <= 0)) continue;
      if (best < 0 || (m === -1 ? compare(v, bv) > 0 : compare(v, bv) < 0)) { best = k; bv = v; }
    }
    return best;
  };

  // VLOOKUP, HLOOKUP, MATCH and LOOKUP look for a blank value as 0 (XLOOKUP and XMATCH among blank cells); the first
  // three refuse one of more than 255 characters.
  const lookupValue = (v) => v ?? 0;
  const short = (v) => { if (typeof v === 'string' && v.length > 255) throw ERR.VALUE; return v; };

  const tableLookup = (across) => ({ p: ['v', 'a', 'v', 'v'], min: 3, max: 4,
    // An array lookup value lifts, but its index is scalar even when supplied as an array. A scalar lookup value
    // still lifts over index arrays; range_lookup arrays broadcast in either case (Excel 16.114.1).
    prepare: (args, ctx) => {
      if (!Array.isArray(args[0]) || !Array.isArray(args[2])) return;
      try { args[2] = num(args[2][0][0], ctx); }
      catch (e) { if (isErr(e)) args[2] = ERR.REF; else throw e; }
    },
    fn: ([x, table, index, approx], ctx) => {
    const g = grid(table, ctx), n = whole(index, ctx);
    if (n < 1) throw ERR.VALUE;
    if (n > (across ? g.rows : g.cols)) throw ERR.REF;
    const exact = approx !== undefined && !bool(approx), vec = across ? row(g, 0) : column(g, 0);
    const v = short(lookupValue(x));
    const k = exact ? scan(vec, matcher(v, true)) : lastTrue(vec, v, AT_MOST);
    if (k < 0) return ERR.NA;
    return across ? g.get(n - 1, k) : g.get(k, n - 1);
  } });

  // INDEX: row and column count from 1, 0 takes them all; a one-row area takes a lone number as its column.
  const index = (src, r, c, a, ctx) => {
    for (const v of [r, c, a]) if (isErr(v)) throw v;
    let area = src;
    const n = given(a) ? whole(a, ctx) : 1;
    if (src instanceof Areas) {
      if (src.list.some((x) => x.sheet !== src.list[0].sheet)) throw ERR.VALUE;
      area = src.list[n - 1];
    } else if (n !== 1) throw ERR.REF;
    if (!area) throw ERR.REF;
    if (isErr(area)) throw area;
    const g = area instanceof Ref ? area : Array.isArray(area) ? area : [[area]];
    const [rows, cols] = area instanceof Ref ? [area.rows, area.cols] : dims(g);
    let i = given(r) ? whole(r, ctx) : 0, j = given(c) ? whole(c, ctx) : 0;
    if (c === undefined && rows === 1 && cols > 1) [i, j] = [0, i];
    if (i < 0 || j < 0) throw ERR.VALUE;
    if (i > rows || j > cols) throw ERR.REF;
    if (area instanceof Ref) {
      const { sheet, r0, c0, r1, c1 } = area;
      return new Ref(sheet, i ? r0 + i - 1 : r0, j ? c0 + j - 1 : c0, i ? r0 + i - 1 : r1, j ? c0 + j - 1 : c1);
    }
    if (i && j) return g[i - 1][j - 1];
    if (i) return [g[i - 1]];
    if (j) return g.map((line) => [line[j - 1]]);
    return g;
  };

  // OFFSET: a negative height or width reaches up or left from the moved corner.
  const offset = (ref, dr, dc, h, w, ctx) => {
    for (const v of [dr, dc, h, w]) if (isErr(v)) throw v;
    const r = ref.r0 + whole(dr, ctx), c = ref.c0 + whole(dc, ctx);
    const height = given(h) ? whole(h, ctx) : ref.rows, width = given(w) ? whole(w, ctx) : ref.cols;
    if (!height || !width) throw ERR.REF;
    const r0 = height > 0 ? r : r + height + 1, r1 = height > 0 ? r + height - 1 : r;
    const c0 = width > 0 ? c : c + width + 1, c1 = width > 0 ? c + width - 1 : c;
    if (r0 < 0 || c0 < 0 || r1 >= MAX_ROWS || c1 >= MAX_COLS) throw ERR.REF;
    return new Ref(ref.sheet, r0, c0, r1, c1);
  };

  // INDIRECT's text: an A1 reference or a defined name (as a formula would read it), or R1C1 (R[1]C[-1] relative to
  // the formula's cell; R2 a whole row, C3 a whole column); either may name a sheet. Anything else is #REF!.
  const referenceText = (s) => {
    try { return s.startsWith('=') || s.startsWith(' ') ? null : F.parse(s, 0, 0); } catch { return null; }
  };
  const namedReference = (n, ctx) => {
    if (n?.k === 'name') {
      const v = ctx.evalName(n);
      if (v instanceof Ref || v instanceof Areas) return v;
    }
    return null;
  };
  const fromA1 = (s, ctx) => {
    const n = referenceText(s);
    if (n?.k === 'ref' && !n.sheet2) {
      const sheet = n.sheet === null ? ctx.sheet : ctx.sheetNamed(n.sheet);
      if (sheet) return new Ref(sheet, n.r0, n.c0, n.r1, n.c1);
    }
    const named = namedReference(n, ctx);
    if (named) return named;
    throw ERR.REF;
  };
  const RC = /^(R(\[[+-]?\d+\]|\d+)?)?(C(\[[+-]?\d+\]|\d+)?)?$/i;
  const fromR1C1 = (s, ctx) => {
    if (s.startsWith(' ')) throw ERR.REF;
    const ref = namedReference(referenceText(s), ctx);
    if (ref) return ref;
    s = s.replace(/ +$/, '');
    let sheet = ctx.sheet, body = s;
    const named = /^(?:'((?:[^']|'')+)'|([^'!]+))!([\s\S]*)$/.exec(s);
    if (named) { sheet = ctx.sheetNamed(named[1] !== undefined ? named[1].replace(/''/g, "'") : named[2]); body = named[3]; }
    const sides = body.split(':');
    if (!sheet || sides.length > 2) throw ERR.REF;
    const coord = (g, host, max) => {
      const v = g === undefined ? host : g[0] === '[' ? host + Number(g.slice(1, -1)) : Number(g) - 1;
      if (!(v >= 0 && v < max)) throw ERR.REF;
      return v;
    };
    const ends = sides.map((part) => {
      const m = RC.exec(part);
      if (!m || (!m[1] && !m[3])) throw ERR.REF;
      return { r: m[1] ? coord(m[2], ctx.r, MAX_ROWS) : null, c: m[3] ? coord(m[4], ctx.c, MAX_COLS) : null };
    });
    const [a, b = a] = ends;
    if ((a.r === null) !== (b.r === null) || (a.c === null) !== (b.c === null)) throw ERR.REF;
    const [r0, r1] = a.r === null ? [0, MAX_ROWS - 1] : [Math.min(a.r, b.r), Math.max(a.r, b.r)];
    const [c0, c1] = a.c === null ? [0, MAX_COLS - 1] : [Math.min(a.c, b.c), Math.max(a.c, b.c)];
    return new Ref(sheet, r0, c0, r1, c1);
  };

  // Sorting: numbers, text, FALSE, TRUE, errors, with blanks last either way.
  const sortRank = (v) => (v === null || v === undefined ? 4 : isErr(v) ? 3 : kind(v));
  const sortOrder = (x, y, dir) => {
    const rx = sortRank(x), ry = sortRank(y);
    if (rx === 4 || ry === 4) return rx === ry ? 0 : rx === 4 ? 1 : -1;
    const c = rx !== ry ? rx - ry : rx === 3 ? 0 : compare(x, y);
    return dir * Math.sign(c);
  };
  const direction = (v, ctx) => {
    const d = given(v) ? whole(v, ctx) : 1;
    if (d !== 1 && d !== -1) throw ERR.VALUE;
    return d;
  };
  const numbers = (arg, ctx, dflt) => (given(arg) ? values(arg, ctx).flat() : [dflt]);
  const sorted = (lines, keys) => lines.map((line, i) => ({ line, i }))
    .sort((a, b) => { for (const k of keys) { const c = sortOrder(k.get(a), k.get(b), k.dir); if (c) return c; } return a.i - b.i; })
    .map((x) => x.line);
  // A value as UNIQUE compares it: text without case, numbers to 15 digits, blank apart from 0 and "".
  const keyOf = (v) => (v === null || v === undefined ? 'z' : isErr(v) ? `e${v.code}` : typeof v === 'number' ? `n${Number(v.toPrecision(15))}` : typeof v === 'string' ? `s${v.toLowerCase()}` : `b${v}`);
  const included = (v) => {
    return bool(v);
  };
  const empty = () => err('#CALC!');

  const FNS = {
    VLOOKUP: tableLookup(false),
    HLOOKUP: tableLookup(true),
    MATCH: { p: ['v', 'a', 'v'], min: 2, max: 3, fn: ([x, look, t], ctx) => {
      const vec = vectorOf(grid(look, ctx)), type = t === undefined ? 1 : Math.sign(num(t, ctx));
      const k = vec ? position(short(lookupValue(x)), vec, type) : -1;
      return k < 0 ? ERR.NA : k + 1;
    } },
    XMATCH: { p: ['v', 'a', 'v', 'v'], min: 2, max: 4, fn: ([x, look, mm, sm], ctx) => {
      const vec = vectorOf(grid(look, ctx)), [m, s] = modes(mm, sm, ctx);
      if (!vec) throw ERR.VALUE;
      const k = xfind(x, vec, m, s);
      return k < 0 ? ERR.NA : k + 1;
    } },
    // The row (or column) of return_array where lookup_array, a column (or row) as long, holds the value.
    XLOOKUP: { p: ['v', 'a', 'a', 'l', 'v', 'v'], min: 3, max: 6, fn: ([x, look, ret, missing, mm, sm], ctx) => {
      const L = grid(look, ctx), R = grid(ret, ctx), [m, s] = modes(mm, sm, ctx);
      const down = L.cols === 1 && (L.rows > 1 || R.rows === 1);
      if (down ? R.rows !== L.rows : L.rows !== 1 || R.cols !== L.cols) throw ERR.VALUE;
      const vec = down ? column(L, 0) : row(L, 0);
      const found = (k) => {
        if (R.ref) {
          const { sheet, r0, c0, r1, c1 } = R.ref;
          const sub = down ? new Ref(sheet, r0 + k, c0, r0 + k, c1) : new Ref(sheet, r0, c0 + k, r1, c0 + k);
          return sub.rows === 1 && sub.cols === 1 ? sub : toArray(sub, ctx);
        }
        const a = values(ret, ctx), out = down ? [a[k]] : a.map((line) => [line[k]]);
        return out.length === 1 && out[0].length === 1 ? out[0][0] : out;
      };
      const k = xfind(x, vec, m, s);
      if (k >= 0) return found(k);
      const alt = missing ? missing() : null;
      return alt === null ? ERR.NA : alt;
    } },
    // Vector form: the match in lookup_vector picks from result_vector, which a reference extends past its end. Array
    // form: search the first row of an array wider than tall (else its first column), return from the last.
    LOOKUP: { p: ['v', 'a', 'a'], min: 2, max: 3, fn: ([x, look, res], ctx) => {
      const g = grid(look, ctx), wide = g.cols > g.rows;
      let vec = res === undefined ? null : vectorOf(g), pick;
      if (!vec) vec = wide ? row(g, 0) : column(g, 0);
      if (res === undefined) pick = wide ? (k) => g.get(g.rows - 1, k) : (k) => g.get(k, g.cols - 1);
      else {
        const R = grid(res, ctx), across = R.rows === 1;
        pick = (k) => {
          if (R.ref) {
            const r = R.ref.r0 + (across ? 0 : k), c = R.ref.c0 + (across ? k : 0);
            return r < MAX_ROWS && c < MAX_COLS ? ctx.read(R.ref.sheet, r, c) : ERR.NA;
          }
          return k < (across ? R.cols : R.rows) ? (across ? R.get(0, k) : R.get(k, 0)) : ERR.NA;
        };
      }
      const k = lastTrue(vec, lookupValue(x), AT_MOST);
      return k < 0 ? ERR.NA : pick(k);
    } },
    // INDEX's and OFFSET's own argument's error comes before their numbers' (errors: true).
    INDEX: { p: ['a', 'v', 'v', 'v'], min: 2, max: 4, errors: true, fn: ([src, r, c, a], ctx) => (isErr(src) ? src : index(src, r, c, a, ctx)) },
    OFFSET: { p: ['r', 'v', 'v', 'v', 'v'], min: 3, max: 5, errors: true, fn: ([ref, dr, dc, h, w], ctx) => {
      if (isErr(ref)) return ref;
      if (!(ref instanceof Ref)) throw ERR.VALUE;
      return offset(ref, dr, dc, h, w, ctx);
    } },
    INDIRECT: { p: ['v', 'v'], min: 1, max: 2, volatile: true, fn: ([t, a1], ctx) => (a1 === undefined || bool(a1) ? fromA1(text(t), ctx) : fromR1C1(text(t), ctx)) },
    // Only the value chosen is evaluated, unless the index is an array.
    CHOOSE: { p: ['r', 'l'], min: 2, fn: ([i, ...choices], ctx) => {
      const idx = ctx.value(i);
      const pick = (x) => {
        if (isErr(x)) throw x;
        const n = whole(x, ctx);
        if (n < 1 || n > choices.length) throw ERR.VALUE;
        return n;
      };
      if (!Array.isArray(idx)) return choices[pick(idx) - 1]();
      const chosen = new Map();
      for (const line of idx) for (const x of line) {
        let n;
        try { n = pick(x); } catch (e) { if (isErr(e)) continue; throw e; }
        if (!chosen.has(n)) chosen.set(n, ctx.value(choices[n - 1]()));
      }
      let [rows, cols] = dims(idx);
      for (const v of chosen.values()) { const [r, c] = dims(v); rows = Math.max(rows, r); cols = Math.max(cols, c); }
      if (rows * cols > CAP.cells) throw ERR.NUM;
      return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (__, c) => {
        try { return at(chosen.get(pick(at(idx, r, c))), r, c); } catch (e) { if (isErr(e)) return e; throw e; }
      }));
    } },
    // A range's row numbers (a column) or column numbers (a row) to lib.used's extent; one cell's alone.
    ROW: { p: ['r'], min: 0, max: 1, fn: ([ref], ctx) => {
      if (ref === undefined) return ctx.r + 1;
      const [r1] = used(area(ref), ctx), rows = r1 - ref.r0 + 1;
      if (rows > CAP.cells) throw ERR.NUM;
      return rows === 1 ? ref.r0 + 1 : Array.from({ length: rows }, (_, i) => [ref.r0 + i + 1]);
    } },
    COLUMN: { p: ['r'], min: 0, max: 1, fn: ([ref], ctx) => {
      if (ref === undefined) return ctx.c + 1;
      const [, c1] = used(area(ref), ctx), cols = c1 - ref.c0 + 1;
      return cols === 1 ? ref.c0 + 1 : [Array.from({ length: cols }, (_, j) => ref.c0 + j + 1)];
    } },
    ROWS: { p: ['a'], min: 1, max: 1, fn: ([a]) => { if (isErr(a)) return a; if (a instanceof Areas) throw ERR.REF; return a instanceof Ref ? a.rows : dims(a)[0]; } },
    COLUMNS: { p: ['a'], min: 1, max: 1, fn: ([a]) => { if (isErr(a)) return a; if (a instanceof Areas) throw ERR.REF; return a instanceof Ref ? a.cols : dims(a)[1]; } },
    // abs_num 1 $A$1, 2 A$1, 3 $A1, 4 A1; in R1C1 a relative part is the number itself in brackets.
    ADDRESS: { p: ['v', 'v', 'v', 'v', 'v'], min: 2, max: 5, fn: ([r, c, abs, a1, sheet], ctx) => {
      const rn = whole(r, ctx), cn = whole(c, ctx), mode = given(abs) ? whole(abs, ctx) : 1;
      if (mode < 1 || mode > 4 || rn < 1 || rn > MAX_ROWS || cn < 1 || cn > MAX_COLS) throw ERR.VALUE;
      const ar = mode <= 2, ac = mode % 2 === 1;
      const body = !given(a1) || bool(a1) ? `${ac ? '$' : ''}${M.columnName(cn - 1)}${ar ? '$' : ''}${rn}` : `R${ar ? rn : `[${rn}]`}C${ac ? cn : `[${cn}]`}`;
      return given(sheet) ? F.sheetPrefix(text(sheet)) + body : body;
    } },
    TRANSPOSE: { p: ['a'], min: 1, max: 1, fn: ([a], ctx) => transpose(values(a, ctx)) },
    UNIQUE: { p: ['a', 'v', 'v'], min: 1, max: 3, fn: ([a, byCol, once], ctx) => {
      const cols = given(byCol) && bool(byCol), lines = cols ? transpose(values(a, ctx)) : values(a, ctx);
      const seen = new Map();
      for (const line of lines) {
        const k = JSON.stringify(line.map(keyOf)), hit = seen.get(k);
        if (hit) hit.n++; else seen.set(k, { line, n: 1 });
      }
      const out = [...seen.values()].filter((x) => !(given(once) && bool(once)) || x.n === 1).map((x) => x.line);
      if (!out.length) return empty();
      return cols ? transpose(out) : out;
    } },
    SORT: { p: ['a', 'a', 'a', 'v'], min: 1, max: 4, fn: ([a, by, order, byCol], ctx) => {
      const cols = given(byCol) && bool(byCol), lines = cols ? transpose(values(a, ctx)) : values(a, ctx);
      const which = numbers(by, ctx, 1).map((v) => whole(v, ctx)), dirs = numbers(order, ctx, 1).map((v) => direction(v, ctx));
      if (which.some((n) => n < 1 || n > lines[0].length) || (dirs.length > 1 && dirs.length !== which.length)) throw ERR.VALUE;
      const keys = which.map((n, i) => ({ get: (x) => x.line[n - 1], dir: dirs[dirs.length === 1 ? 0 : i] }));
      const out = sorted(lines, keys);
      return cols ? transpose(out) : out;
    } },
    // Each by_array is a column as long as the array (sorting its rows) or a row as wide (sorting its columns).
    SORTBY: { p: ['a', 'a', 'v'], rep: 2, min: 2, fn: ([a, ...rest], ctx) => {
      const g = values(a, ctx);
      let cols = null;
      const keys = [];
      for (let i = 0; i < rest.length; i += 2) {
        const by = values(rest[i], ctx), [r, c] = dims(by);
        const across = c === 1 && r === g.length ? false : r === 1 && c === g[0].length ? true : null;
        if (across === null || (cols !== null && cols !== across)) throw ERR.VALUE;
        cols = across;
        const key = across ? by[0] : by.map((line) => line[0]);
        keys.push({ get: (x) => key[x.i], dir: direction(rest[i + 1], ctx) });
      }
      const out = sorted(cols ? transpose(g) : g, keys);
      return cols ? transpose(out) : out;
    } },
    // include is a column as long as the array (keeping rows) or a row as wide (keeping columns).
    FILTER: { p: ['a', 'a', 'l'], min: 2, max: 3, fn: ([a, inc, ifEmpty], ctx) => {
      const g = values(a, ctx), keep = values(inc, ctx), [r, c] = dims(keep);
      let out;
      if (c === 1 && r === g.length) out = g.filter((_, i) => included(keep[i][0]));
      else if (r === 1 && c === g[0].length) { const on = keep[0].map(included); out = on.some(Boolean) ? g.map((line) => line.filter((_, j) => on[j])) : []; }
      else throw ERR.VALUE;
      if (out.length && out[0].length) return out;
      const alt = ifEmpty ? ifEmpty() : null;
      return alt === null ? empty() : alt;
    } },
    SEQUENCE: { p: ['v', 'v', 'v', 'v'], min: 1, max: 4, fn: ([r, c, s, st], ctx) => {
      const rows = whole(r, ctx), cols = given(c) ? whole(c, ctx) : 1;
      const start = given(s) ? num(s, ctx) : 1, step = given(st) ? num(st, ctx) : 1;
      if (rows < 0 || cols < 0 || rows > MAX_ROWS || cols > MAX_COLS) throw ERR.VALUE;
      if (!rows || !cols) return empty();
      if (rows * cols > CAP.cells) throw ERR.NUM;
      return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (__, j) => start + (i * cols + j) * step));
    } },
    HYPERLINK: { p: ['v', 'v'], min: 1, max: 2, fn: ([link, name]) => (name === undefined ? link : name) },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_LOOKUP; else GZ_SHEET_FN_LOOKUP;
