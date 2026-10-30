// Excel formulas: a tokenizer, a parser to an AST, and the text rewrites the model's operations, the grid's fill and
// paste, and the .xlsx reader and writer need. Formula text is en-US (',' between arguments, ';' between array rows)
// and carries no leading '='.
// AST nodes: num/str/bool/err { v }; ref { sheet, sheet2 (a 3-D span's last sheet), r0, c0, r1, c1, abs: [r0, c0, r1,
// c1 absolute], cell (written as one cell), whole ('row' | 'col' | null) } where a relative coordinate is an offset from
// the formula's own cell, so every cell whose formula has the same R1C1 text shares one AST (compile); name { name,
// sheet }; fn { name (upper case, _xlfn. stripped), args }; un { op: '-' | '+' | '@', a }; pct { a }; bin { op, a, b }
// (op ':' joins references, ' ' intersects them); union { items }; array { rows } (errors as { err }); empty (an
// argument left out); table and ext { s } (structured and external references, kept as text: the cell keeps its cached
// value).
// grouped marks an explicit parenthesized result (Excel suppresses final-operation cancellation there).
// Rewrites work on tokens, so a formula's spacing and spelling survive everything but the references they change.
// Classic script; module.exports for node.
var GZ_SHEET_FORMULA = globalThis.GZ_SHEET_FORMULA || (() => {
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { MAX_ROWS, MAX_COLS, CAP } = M;
  const fail = (code, message, at) => { throw Object.assign(new Error(message), { code, at }); };

  // Functions added after Excel 2007, written with _xlfn. (and SORT, FILTER with _xlfn._xlws.) in a file.
  const FUTURE = new Set(('ACOT ACOTH AGGREGATE ANCHORARRAY ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE BINOM.INV BITAND '
    + 'BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW CEILING.MATH CEILING.PRECISE CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST '
    + 'CHOOSECOLS CHOOSEROWS COMBINA CONCAT CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP '
    + 'ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST FILTER FILTERXML FLOOR.MATH FLOOR.PRECISE '
    + 'FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY FORECAST.ETS.STAT FORECAST.LINEAR FORMULATEXT GAMMA GAMMA.DIST GAMMA.INV '
    + 'GAMMALN.PRECISE GAUSS GROUPBY HSTACK HYPGEOM.DIST IFNA IFS IMAGE IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA '
    + 'ISOMITTED ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST '
    + 'NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV NUMBERVALUE PDURATION PERCENTILE.EXC PERCENTILE.INC PERCENTOF '
    + 'PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA PHI PIVOTBY POISSON.DIST QUARTILE.EXC QUARTILE.INC QUERYSTRING RANDARRAY RANK.AVG '
    + 'RANK.EQ REDUCE REGEXEXTRACT REGEXREPLACE REGEXTEST RRI SCAN SEC SECH SEQUENCE SHEET SHEETS SINGLE SKEW.P SORT SORTBY STDEV.P '
    + 'STDEV.S SWITCH T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW TRIMRANGE '
    + 'UNICHAR UNICODE UNIQUE VALUETOTEXT VAR.P VAR.S VSTACK WEBSERVICE WEIBULL.DIST WORKDAY.INTL WRAPCOLS WRAPROWS XLOOKUP XMATCH XOR Z.TEST').split(' '));
  const XLWS = new Set(['FILTER', 'SORT']);
  const PREFIX = /^(?:_xlfn\._xlws\.|_xlfn\.|_xlws\.)/i;

  // ── Tokens ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const NAME_CHAR = /[A-Za-z0-9_.\\\p{L}\p{N}]/u;
  const NAME_RUN = /^[A-Za-z0-9_.\\\p{L}\p{N}]+/u;
  const ERR = /^(#NULL!|#DIV\/0!|#VALUE!|#REF!|#NAME\?|#NUM!|#N\/A)/i;
  const COLS = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_.\\(![])/;
  const ROWS = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![A-Za-z0-9_.\\(![])/;
  const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_.\\(![\p{L}])/u;
  const NUM = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
  const OPS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%', ':', '@'];

  const cellAt = (src, j) => {
    const m = CELL.exec(src.slice(j));
    if (!m) return null;
    const c = M.columnIndex(m[2]), r = Number(m[4]) - 1;
    return c >= 0 && r < MAX_ROWS && r >= 0 ? { len: m[0].length, r, c, ar: !!m[3], ac: !!m[1] } : null;
  };
  // A reference's own text (no sheet) at j: whole columns, whole rows, a cell or a cell:cell area. Corners come out
  // top-left first.
  const refAt = (src, j) => {
    const rest = src.slice(j);
    let m = COLS.exec(rest);
    if (m) {
      const a = M.columnIndex(m[2]), b = M.columnIndex(m[4]);
      if (a >= 0 && b >= 0) return order({ len: m[0].length, r0: 0, c0: a, r1: MAX_ROWS - 1, c1: b, abs: [true, !!m[1], true, !!m[3]], cell: false, whole: 'col' });
    }
    m = ROWS.exec(rest);
    if (m) {
      const a = Number(m[2]) - 1, b = Number(m[4]) - 1;
      if (a >= 0 && b >= 0 && a < MAX_ROWS && b < MAX_ROWS) return order({ len: m[0].length, r0: a, c0: 0, r1: b, c1: MAX_COLS - 1, abs: [!!m[1], true, !!m[3], true], cell: false, whole: 'row' });
    }
    const p = cellAt(src, j);
    if (!p) return null;
    if (src[j + p.len] === ':') {
      const q = cellAt(src, j + p.len + 1);
      if (q) return order({ len: p.len + 1 + q.len, r0: p.r, c0: p.c, r1: q.r, c1: q.c, abs: [p.ar, p.ac, q.ar, q.ac], cell: false, whole: null });
    }
    return { len: p.len, r0: p.r, c0: p.c, r1: p.r, c1: p.c, abs: [p.ar, p.ac, p.ar, p.ac], cell: true, whole: null };
  };
  const order = (t) => {
    if (t.r0 > t.r1) { [t.r0, t.r1] = [t.r1, t.r0]; [t.abs[0], t.abs[2]] = [t.abs[2], t.abs[0]]; }
    if (t.c0 > t.c1) { [t.c0, t.c1] = [t.c1, t.c0]; [t.abs[1], t.abs[3]] = [t.abs[3], t.abs[1]]; }
    return t;
  };
  const bracketed = (src, j) => {
    let depth = 0;
    for (let k = j; k < src.length; k++) {
      if (src[k] === "'") k++;
      else if (src[k] === '[') depth++;
      else if (src[k] === ']' && --depth === 0) return k + 1;
    }
    return fail('syntax', 'an unclosed [', j);
  };

  const tokenize = (text) => {
    const src = String(text ?? '');
    if (src.length > CAP.formula) fail('limit', 'a formula holds 8,192 characters', CAP.formula);
    const out = [];
    let i = src[0] === '=' ? 1 : 0;
    const push = (t, len) => { t.i = i; t.s = src.slice(i, i + len); out.push(t); i += len; };
    // What follows a sheet prefix (pre: its text, sheet/sheet2: its names): a reference, #REF! or a name.
    const afterSheet = (pre, sheet, sheet2, start) => {
      const j = i + pre.length;
      const ref = refAt(src, j);
      if (ref) return push({ k: 'ref', pre, sheet, sheet2, body: src.slice(j, j + ref.len), ...ref }, pre.length + ref.len);
      const e = ERR.exec(src.slice(j));
      if (e && e[1].toUpperCase() === '#REF!') return push({ k: 'err', v: '#REF!' }, pre.length + e[1].length + (refAt(src, j + e[1].length)?.len ?? 0));
      const n = NAME_RUN.exec(src.slice(j));
      if (n) return push({ k: 'name', pre, sheet, sheet2, name: n[0] }, pre.length + n[0].length);
      return fail('syntax', 'a sheet name with nothing after it', start);
    };
    while (i < src.length) {
      const ch = src[i], rest = src.slice(i);
      let m;
      if ((m = /^\s+/.exec(rest))) { push({ k: 'ws' }, m[0].length); continue; }
      if (ch === '"') {
        let j = i + 1, v = '';
        for (;;) {
          const q = src.indexOf('"', j);
          if (q < 0) fail('syntax', 'an unclosed string', i);
          v += src.slice(j, q);
          if (src[q + 1] === '"') { v += '"'; j = q + 2; } else { j = q + 1; break; }
        }
        push({ k: 'str', v }, j - i);
        continue;
      }
      if (ch === "'") {
        let j = i + 1, name = '';
        for (;;) {
          const q = src.indexOf("'", j);
          if (q < 0) fail('syntax', 'an unclosed sheet name', i);
          name += src.slice(j, q);
          if (src[q + 1] === "'") { name += "'"; j = q + 2; } else { j = q + 1; break; }
        }
        if (src[j] !== '!') fail('syntax', 'a quoted name without !', i);
        const pre = src.slice(i, j + 1);
        if (/^\[\d+\]/.test(name)) {
          const ref = refAt(src, j + 1), n = ref ? null : NAME_RUN.exec(src.slice(j + 1));
          push({ k: 'ext' }, pre.length + (ref?.len ?? n?.[0].length ?? 0));
          continue;
        }
        const [a, b] = name.split(':');
        afterSheet(pre, a, b ?? null, i);
        continue;
      }
      if (ch === '[') {
        if ((m = /^\[\d+\][^!]*!/.exec(rest))) {
          const ref = refAt(src, i + m[0].length), n = ref ? null : NAME_RUN.exec(src.slice(i + m[0].length));
          push({ k: 'ext' }, m[0].length + (ref?.len ?? n?.[0].length ?? 0));
        } else if ((m = /^\[\d+\]/.exec(rest))) {
          push({ k: 'ext' }, m[0].length + (NAME_RUN.exec(src.slice(i + m[0].length))?.[0].length ?? 0));
        } else push({ k: 'table' }, bracketed(src, i) - i);
        continue;
      }
      if (ch === '#') {
        m = ERR.exec(rest);
        if (!m) fail('syntax', 'an unknown error value', i);
        const v = m[1].toUpperCase();
        push({ k: 'err', v }, m[1].length + (v === '#REF!' ? refAt(src, i + m[1].length)?.len ?? 0 : 0));
        continue;
      }
      // A sheet prefix: Name! or First:Last!
      if ((m = /^([A-Za-z0-9_.\\\p{L}\p{N}]+)(?::([A-Za-z0-9_.\\\p{L}\p{N}]+))?!/u.exec(rest))) { afterSheet(m[0], m[1], m[2] ?? null, i); continue; }
      if (/[0-9.$]/.test(ch) || NAME_CHAR.test(ch)) {
        const ref = refAt(src, i);
        if (ref) { push({ k: 'ref', pre: '', sheet: null, sheet2: null, body: rest.slice(0, ref.len), ...ref }, ref.len); continue; }
        if ((m = NUM.exec(rest))) { push({ k: 'num', v: Number(m[0]) }, m[0].length); continue; }
        if ((m = NAME_RUN.exec(rest)) && !/^\d/.test(m[0])) {
          const word = m[0], after = src[i + word.length];
          if (after === '(') { push({ k: 'fn', name: word.replace(PREFIX, '').toUpperCase(), prefix: PREFIX.exec(word)?.[0] ?? '', raw: word.replace(PREFIX, '') }, word.length); continue; }
          if (after === '[') { push({ k: 'table' }, bracketed(src, i + word.length) - i); continue; }
          const up = word.toUpperCase();
          if (up === 'TRUE' || up === 'FALSE') { push({ k: 'bool', v: up === 'TRUE' }, word.length); continue; }
          push({ k: 'name', pre: '', sheet: null, sheet2: null, name: word }, word.length);
          continue;
        }
      }
      const op = OPS.find((o) => rest.startsWith(o));
      if (op) { push({ k: 'op' }, op.length); continue; }
      if ('(),;{}'.includes(ch)) { push({ k: ch }, 1); continue; }
      fail('syntax', `unexpected ${ch}`, i);
    }
    return out;
  };

  // ── Parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const BIN = { ':': 90, ' ': 80, '^': 40, '*': 30, '/': 30, '+': 20, '-': 20, '&': 10, '=': 5, '<>': 5, '<': 5, '>': 5, '<=': 5, '>=': 5 };
  const UNARY = 60, PERCENT = 50;
  const REFISH = new Set(['ref', 'name', 'fn', 'union', 'table', 'ext']);
  const STARTS_REF = new Set(['ref', 'name', 'fn', '(', 'table']);

  const parseTokens = (toks, r, c, length) => {
    let i = 0, depth = 0, nest = 0;
    const skip = () => { while (toks[i]?.k === 'ws') i++; };
    const peek = () => { skip(); return toks[i]; };
    const next = () => { skip(); return toks[i++]; };
    const stop = (t, why) => fail('syntax', why, t ? t.i : length);
    const expect = (k) => { const t = next(); if (t?.k !== k) stop(t, `expected ${k}`); };
    const refish = (n) => REFISH.has(n.k) || (n.k === 'bin' && (n.op === ':' || n.op === ' '));
    const off = (v, abs, host) => (abs ? v : v - host);

    const array = () => {
      const rows = [[]];
      for (;;) {
        let t = next(), sign = 1, signed = false;
        while (t?.k === 'op' && (t.s === '-' || t.s === '+')) { if (t.s === '-') sign = -sign; signed = true; t = next(); }
        let v;
        if (t?.k === 'num') v = sign * t.v || 0;
        else if (!signed && t?.k === 'str') v = t.v;
        else if (!signed && t?.k === 'bool') v = t.v;
        else if (!signed && t?.k === 'err') v = { err: t.v };
        else stop(t, 'an array holds numbers, text, TRUE, FALSE or errors');
        rows.at(-1).push(v);
        const sep = next();
        if (sep?.k === ',') continue;
        if (sep?.k === ';') { rows.push([]); continue; }
        if (sep?.k === '}') break;
        stop(sep, 'expected , ; or }');
      }
      if (rows.some((row) => row.length !== rows[0].length)) stop(null, 'array rows differ in length');
      return { k: 'array', rows };
    };

    const call = (t) => {
      if (++nest > CAP.nest) fail('limit', 'more than 64 nested functions', t.i);
      expect('(');
      const args = [];
      if (peek()?.k === ')') i++;
      else {
        for (;;) {
          const a = peek();
          args.push(a && (a.k === ',' || a.k === ')') ? { k: 'empty' } : expr(0));
          const sep = next();
          if (sep?.k === ')') break;
          if (sep?.k !== ',') stop(sep, 'expected , or )');
        }
      }
      if (args.length > CAP.args) fail('limit', 'more than 255 arguments', t.i);
      // LET declarations are syntax: Excel refuses duplicate names in one scope and dots in a local name.
      // A nested call has its own set, so shadowing an outer local remains valid.
      if (t.name === 'LET') {
        const names = new Set();
        for (let j = 0; j + 1 < args.length; j += 2) {
          const n = args[j], low = n.name?.toLowerCase();
          if (n.k !== 'name' || n.sheet || n.name.includes('.') || names.has(low)) stop(t, 'invalid LET name');
          names.add(low);
        }
      }
      nest--;
      return { k: 'fn', name: t.name, args };
    };

    const prefix = () => {
      const t = next();
      if (!t) return stop(null, 'a value is missing');
      switch (t.k) {
        case 'num': case 'str': case 'bool': case 'err': return { k: t.k, v: t.v };
        case 'ref': return { k: 'ref', sheet: t.sheet, sheet2: t.sheet2, r0: off(t.r0, t.abs[0], r), c0: off(t.c0, t.abs[1], c), r1: off(t.r1, t.abs[2], r),
          c1: off(t.c1, t.abs[3], c), abs: t.abs, cell: t.cell, whole: t.whole };
        case 'name': return { k: 'name', name: t.name, sheet: t.sheet };
        case 'table': case 'ext': return { k: t.k, s: t.s };
        case 'fn': return call(t);
        case '{': return array();
        case '(': {
          const first = expr(0);
          if (peek()?.k !== ',') { expect(')'); return { ...first, grouped: true }; }
          const items = [first];
          while (peek()?.k === ',') { i++; items.push(expr(0)); }
          expect(')');
          return { k: 'union', items };
        }
        case 'op': if (t.s === '-' || t.s === '+' || t.s === '@') return { k: 'un', op: t.s, a: expr(UNARY) };
        // fallthrough
        default: return stop(t, `unexpected ${t.s}`);
      }
    };

    const expr = (min) => {
      if (++depth > 1024) fail('limit', 'a formula nested too deeply', toks[i]?.i ?? length);
      let left = prefix();
      for (;;) {
        if (toks[i]?.k === 'ws' && BIN[' '] >= min && refish(left)) {
          let j = i;
          while (toks[j]?.k === 'ws') j++;
          if (toks[j] && STARTS_REF.has(toks[j].k)) { i = j; left = { k: 'bin', op: ' ', a: left, b: expr(BIN[' '] + 1) }; continue; }
        }
        const t = peek();
        if (t?.k !== 'op') break;
        if (t.s === '%') { if (PERCENT < min) break; i++; left = { k: 'pct', a: left }; continue; }
        const prec = BIN[t.s];
        if (prec === undefined || prec < min) break;
        i++;
        left = { k: 'bin', op: t.s, a: left, b: expr(prec + 1) };
      }
      depth--;
      return left;
    };

    const ast = expr(0);
    if (peek()) stop(peek(), `unexpected ${peek().s}`);
    return ast;
  };

  // Formula text (an optional leading '=') to its AST, relative references as offsets from (r, c). Throws { code:
  // 'syntax' | 'limit', at } on text Excel would refuse.
  const parse = (text, r = 0, c = 0) => {
    const toks = tokenize(text);
    if (!toks.some((t) => t.k !== 'ws')) fail('syntax', 'an empty formula', 0);
    return parseTokens(toks, r, c, String(text).length);
  };

  // ── R1C1 and the shared-AST cache ───────────────────────────────────────────────────────────────────────────────────
  const rc = (v, abs, host, ch) => (abs ? `${ch}${v + 1}` : v === host ? ch : `${ch}[${v - host}]`);
  const r1c1Ref = (t, r, c) => {
    const [ra0, ca0, ra1, ca1] = t.abs;
    if (t.whole === 'col') return rc(t.c0, ca0, c, 'C') + (t.c0 === t.c1 && ca0 === ca1 ? '' : `:${rc(t.c1, ca1, c, 'C')}`);
    if (t.whole === 'row') return rc(t.r0, ra0, r, 'R') + (t.r0 === t.r1 && ra0 === ra1 ? '' : `:${rc(t.r1, ra1, r, 'R')}`);
    const one = rc(t.r0, ra0, r, 'R') + rc(t.c0, ca0, c, 'C');
    return t.cell ? one : `${one}:${rc(t.r1, ra1, r, 'R')}${rc(t.c1, ca1, c, 'C')}`;
  };
  const keyOf = (toks, r, c) => toks.map((t) => (t.k === 'ref' ? t.pre + r1c1Ref(t, r, c) : t.k === 'fn' ? t.name : t.s)).join('');
  const r1c1 = (text, r, c) => keyOf(tokenize(text), r, c);
  const cache = new Map();
  // → { key (R1C1 text), ast }: one AST per R1C1 text. Throws as parse does.
  const compile = (text, r, c) => {
    const toks = tokenize(text);
    const key = keyOf(toks, r, c);
    let ast = cache.get(key);
    if (!ast) {
      if (!toks.some((t) => t.k !== 'ws')) fail('syntax', 'an empty formula', 0);
      ast = parseTokens(toks, r, c, String(text).length);
      if (cache.size >= 100000) cache.clear();
      cache.set(key, ast);
    }
    return { key, ast };
  };

  // The ranges an AST reads, resolved at (r, c): [{ sheet, sheet2, r0, c0, r1, c1 }], names and tables left out.
  const refs = (ast, r, c) => {
    const out = [];
    const walk = (n) => {
      if (n.k === 'ref') {
        const at = (v, abs, host) => (abs ? v : v + host);
        out.push({ sheet: n.sheet, sheet2: n.sheet2, r0: at(n.r0, n.abs[0], r), c0: at(n.c0, n.abs[1], c), r1: at(n.r1, n.abs[2], r), c1: at(n.c1, n.abs[3], c) });
      }
      for (const x of n.args || n.items || []) walk(x);
      if (n.a) walk(n.a);
      if (n.b) walk(n.b);
    };
    walk(ast);
    return out;
  };

  // ── Rewrites ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const a1 = (r, c, ar, ac) => `${ac ? '$' : ''}${M.columnName(c)}${ar ? '$' : ''}${r + 1}`;
  const refText = (t) => {
    const [ra0, ca0, ra1, ca1] = t.abs;
    if (t.whole === 'col') return `${ca0 ? '$' : ''}${M.columnName(t.c0)}:${ca1 ? '$' : ''}${M.columnName(t.c1)}`;
    if (t.whole === 'row') return `${ra0 ? '$' : ''}${t.r0 + 1}:${ra1 ? '$' : ''}${t.r1 + 1}`;
    return t.cell ? a1(t.r0, t.c0, ra0, ca0) : `${a1(t.r0, t.c0, ra0, ca0)}:${a1(t.r1, t.c1, ra1, ca1)}`;
  };
  const tokensOf = (text) => { try { return tokenize(text); } catch { return null; } };
  const rewriteRefs = (text, fn) => {
    const toks = tokensOf(text);
    if (!toks) return text;
    let changed = false;
    const out = toks.map((t) => {
      if (t.k !== 'ref') return t.s;
      const s = fn(t);
      if (s === null || s === undefined) return t.s;
      changed = true;
      return s;
    });
    return changed ? (String(text)[0] === '=' ? '=' : '') + out.join('') : text;
  };

  // A cell index after inserting (n > 0) or deleting (n < 0) at `at`, or null when it is deleted or pushed off.
  const moveIndex = (k, at, n, max) => (k < at ? k : n < 0 ? (k < at - n ? null : k + n) : k + n < max ? k + n : null);
  const moveSpan = (a, b, at, n, max) => (n < 0 ? M.shiftSpan(a, b, at, n, max) : a >= at ? (a + n < max ? [a + n, Math.min(b + n, max - 1)] : null) : b >= at ? [a, Math.min(b + n, max - 1)] : [a, b]);

  // The model's shift hook: references to change.sheet's cells after rows or columns are inserted (n > 0) at `at` or
  // deleted (n < 0). host: the sheet the formula is on (null for a workbook-wide name). A reference whose cells are all
  // deleted, or pushed past the last row or column, turns to #REF!. 3-D references stay as they are.
  const shift = (text, change, host) => {
    const target = String(change.sheet).toLowerCase();
    const row = change.axis === 'row', max = row ? MAX_ROWS : MAX_COLS;
    return rewriteRefs(text, (t) => {
      const sheet = t.sheet ?? host;
      if (t.sheet2 || sheet === null || sheet === undefined || sheet.toLowerCase() !== target) return null;
      if (t.whole === (row ? 'col' : 'row')) return null;
      const a = row ? t.r0 : t.c0, b = row ? t.r1 : t.c1;
      const span = t.cell ? [moveIndex(a, change.at, change.n, max)] : moveSpan(a, b, change.at, change.n, max);
      if (!span || span[0] === null) return `${t.pre}#REF!`;
      const [a2, b2 = a2] = span;
      if (a2 === a && b2 === b) return null;
      return t.pre + refText(row ? { ...t, r0: a2, r1: b2 } : { ...t, c0: a2, c1: b2 });
    });
  };

  // A sheet name as a reference writes it: quoted when it has anything but letters, digits, _ and ., starts with a
  // digit, or reads as a cell, an R1C1 reference or a boolean.
  const needsQuotes = (name) => !/^[A-Za-z_\\\p{L}][A-Za-z0-9_.\p{L}\p{N}]*$/u.test(name) || /^\$?[A-Za-z]{1,3}\$?\d+$/.test(name)
    || /^[RrCc]\d*$|^[Rr]\d*[Cc]\d*$/.test(name) || /^(true|false)$/i.test(name);
  const sheetPrefix = (name, last) => {
    const text = last ? `${name}:${last}` : name;
    return needsQuotes(name) || (last && needsQuotes(last)) ? `'${text.replace(/'/g, "''")}'!` : `${text}!`;
  };

  // The model's rename hook: references to sheet `from` (any case) now name `to`; to null, the sheet is gone and they
  // read #REF!.
  const rename = (text, from, to) => {
    const low = String(from).toLowerCase();
    const toks = tokensOf(text);
    if (!toks) return text;
    let changed = false;
    const out = toks.map((t) => {
      if ((t.k !== 'ref' && t.k !== 'name') || !t.sheet) return t.s;
      const first = t.sheet.toLowerCase() === low, last = t.sheet2?.toLowerCase() === low;
      if (!first && !last) return t.s;
      changed = true;
      const rest = t.s.slice(t.pre.length);
      if (to === null) return t.sheet2 || t.k === 'name' ? '#REF!' : `#REF!${rest}`;
      return sheetPrefix(first ? to : t.sheet, t.sheet2 ? (last ? to : t.sheet2) : null) + rest;
    });
    return changed ? (String(text)[0] === '=' ? '=' : '') + out.join('') : text;
  };

  // A formula copied dr rows down and dc columns right (fill, paste): its relative parts move with it; one that leaves
  // the sheet reads #REF!.
  const move = (text, dr, dc) => {
    if (!dr && !dc) return text;
    return rewriteRefs(text, (t) => {
      const [ra0, ca0, ra1, ca1] = t.abs;
      const n = { ...t };
      if (t.whole !== 'col') { if (!ra0) n.r0 += dr; if (!ra1) n.r1 += dr; }
      if (t.whole !== 'row') { if (!ca0) n.c0 += dc; if (!ca1) n.c1 += dc; }
      if ([n.r0, n.r1].some((r) => r < 0 || r >= MAX_ROWS) || [n.c0, n.c1].some((c) => c < 0 || c >= MAX_COLS)) return `${t.pre}#REF!`;
      return n.r0 === t.r0 && n.c0 === t.c0 && n.r1 === t.r1 && n.c1 === t.c1 ? null : t.pre + refText(n);
    });
  };

  const mapTokens = (text, fn) => {
    const toks = tokensOf(text);
    if (!toks) return text;
    return (String(text)[0] === '=' ? '=' : '') + toks.map(fn).join('');
  };
  // Walking a formula's tokens by @'s operands: what @ binds is a value, a reference, a call, a group or an array, and any
  // : after (UNARY binds tighter than every operator but : and the space).
  const operands = (toks) => {
    const skip = (i) => { while (toks[i]?.k === 'ws') i++; return i; };
    // The end (exclusive) of the bracketed run from toks[i], an opening ( or {.
    const close = (i) => {
      let depth = 0;
      for (let j = i; j < toks.length; j++) {
        const k = toks[j].k;
        if (k === '(' || k === '{') depth++;
        else if ((k === ')' || k === '}') && --depth === 0) return j + 1;
      }
      return toks.length;
    };
    const primary = (i) => {
      i = skip(i);
      const t = toks[i];
      if (!t) return i;
      if (t.k === 'op' && t.s === '@') return primary(i + 1);
      if (t.k === 'fn') return toks[i + 1]?.k === '(' ? close(i + 1) : i + 1;
      if (t.k === '(' || t.k === '{') return close(i);
      return i + 1;
    };
    const operand = (i) => { let end = primary(i); for (let j = skip(end); toks[j]?.k === 'op' && toks[j].s === ':'; j = skip(end)) end = primary(j + 1); return end; };
    return { skip, close, operand };
  };
  // A file's formula as Glaze keeps it: _xlfn. prefixes off, and Excel's _xlfn.SINGLE(x) the @x it stands for (@(x) when
  // x is more than @ binds).
  const fromFile = (text) => {
    const toks = tokensOf(text);
    if (!toks) return text;
    const { skip, close, operand } = operands(toks);
    const emit = (from, to) => {
      let out = '';
      for (let i = from; i < to; i++) {
        const t = toks[i];
        if (t.k === 'fn' && t.prefix && t.name === 'SINGLE' && toks[i + 1]?.k === '(') {
          const end = close(i + 1), first = skip(i + 2), bare = first < end - 1 && skip(operand(first)) === end - 1;
          out += bare ? `@${emit(first, skip(operand(first)))}` : `@(${emit(i + 2, end - 1)})`;
          i = end - 1;
          continue;
        }
        out += t.k === 'fn' && t.prefix ? t.raw : t.s;
      }
      return out;
    };
    return (String(text)[0] === '=' ? '=' : '') + emit(0, toks.length);
  };
  // Glaze's formula as a file writes it: functions upper case, the newer ones prefixed, and @x as _xlfn.SINGLE(x) (a file
  // has no @ operator).
  const fnText = (t) => (t.prefix ? t.prefix + t.name : FUTURE.has(t.name) ? (XLWS.has(t.name) ? '_xlfn._xlws.' : '_xlfn.') + t.name : t.name);
  const toFile = (text) => {
    const toks = tokensOf(text);
    if (!toks) return text;
    const { skip, close, operand } = operands(toks);
    const emit = (from, to) => {
      let out = '';
      for (let i = from; i < to; i++) {
        const t = toks[i];
        if (t.k === 'fn') { out += fnText(t); continue; }
        if (t.k !== 'op' || t.s !== '@') { out += t.s; continue; }
        const start = skip(i + 1), end = operand(start);
        const inner = emit(start, end);
        out += `_xlfn.SINGLE${toks[start]?.k === '(' && close(start) === end ? inner : `(${inner})`}`;
        i = end - 1;
      }
      return out;
    };
    return (String(text)[0] === '=' ? '=' : '') + emit(0, toks.length);
  };
  // Typed formula text the way Excel keeps it once entered: functions, references, booleans and errors upper case.
  const normalize = (text) => mapTokens(text, (t) => {
    if (t.k === 'fn') return t.prefix + t.name;
    if (t.k === 'ref') return t.pre + t.body.toUpperCase();
    if (t.k === 'bool' || t.k === 'err') return t.s.toUpperCase();
    return t.s;
  });

  const hooks = Object.freeze({ shift, rename });
  return { FUTURE, XLWS, tokenize, parse, compile, r1c1, refs, shift, rename, move, fromFile, toFile, normalize, sheetPrefix, hooks };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FORMULA; else GZ_SHEET_FORMULA;
