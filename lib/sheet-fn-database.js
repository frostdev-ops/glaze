// Glaze Sheets' database functions: DSUM DCOUNT DCOUNTA DAVERAGE DGET DMAX DMIN DPRODUCT DSTDEV DSTDEVP DVAR DVARP,
// registered with the calc engine (sheet-calc.js define). (database, field, criteria): database and criteria are
// references whose first row is labels; field is a label (any case) or a column number, left out only by DCOUNT and
// DCOUNTA (which then count records). Each criteria row below the labels is one alternative, its cells all required, a
// blank or "" cell no condition, a row of them every record. Criteria read as SUMIF's, except that text with no
// operator finds every value beginning with it, and <>n leaves out only the number n. Under a label that names no
// column a constant holds for every record (TRUE, a number not 0) or none; a formula there is a computed criterion,
// which Excel works out per record and Glaze doesn't: #VALUE!.
// Classic script; module.exports for node.
var GZ_SHEET_FN_DATABASE = globalThis.GZ_SHEET_FN_DATABASE || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { ERR, isErr, num, text, same, used, wildcard, criteria, Ref } = C.lib;

  const ERROR_TEXT = /^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|CALC!|SPILL!)$/i;
  const label = (v) => (v === null || isErr(v) ? null : text(v).toLowerCase());

  // A criteria cell's value as a test of a record's value.
  const condition = (c, ctx) => {
    if (typeof c !== 'string') return criteria(c, ctx);
    const [, op = '', rest] = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c);
    const n = rest !== '' && M.parseNumber(rest, { date1904: ctx.date1904 });
    if (n && op === '<>') return (v) => !(typeof v === 'number' && same(v, n.v));
    if (op === '' && !n && !/^(TRUE|FALSE)$/i.test(rest) && !ERROR_TEXT.test(rest)) {
      let tildes = 0;
      while (rest[rest.length - 1 - tildes] === '~') tildes++;
      return wildcard(`${tildes % 2 ? rest.slice(0, -1) : rest}*`);
    }
    return criteria(c, ctx);
  };

  const table = (db, ctx) => {
    if (isErr(db)) throw db;
    if (!(db instanceof Ref)) throw ERR.VALUE;
    const [r1, c1] = used(db, ctx);
    if (r1 === db.r0) throw ERR.VALUE;
    const labels = [];
    for (let c = db.c0; c <= c1; c++) labels.push(label(ctx.read(db.sheet, db.r0, c)));
    return { db, records: r1 - db.r0, labels, get: (i, j) => ctx.read(db.sheet, db.r0 + i, db.c0 + j) };
  };

  const given = (v) => v !== null && v !== undefined;
  // The field's column (0-based), or -1 when it is left out and `optional`.
  const column = (field, t, optional) => {
    if (!given(field)) { if (optional) return -1; throw ERR.VALUE; }
    if (typeof field === 'string') {
      const j = t.labels.indexOf(field.toLowerCase());
      if (j < 0) throw ERR.VALUE;
      return j;
    }
    const j = Math.trunc(num(field)) - 1;
    if (j < 0 || j >= t.db.cols) throw ERR.VALUE;
    return j;
  };

  // The criteria rows as lists of [column, test]; a row no record can meet is left out.
  const conditions = (crit, t, ctx) => {
    if (isErr(crit)) throw crit;
    if (!(crit instanceof Ref)) throw ERR.VALUE;
    if (crit.r1 === crit.r0) throw ERR.VALUE;
    const [r1, c1] = used(crit, ctx);
    const cols = [];
    for (let c = crit.c0; c <= c1; c++) { const l = label(ctx.read(crit.sheet, crit.r0, c)); cols.push(l === null ? -1 : t.labels.indexOf(l)); }
    const rows = [];
    for (let r = crit.r0 + 1; r <= r1; r++) {
      const row = [];
      let never = false;
      cols.forEach((j, k) => {
        const v = ctx.read(crit.sheet, r, crit.c0 + k);
        if (v === null || v === '') return;
        if (j >= 0) { row.push([j, condition(v, ctx)]); return; }
        if (ctx.formulaAt(crit.sheet, r, crit.c0 + k)) throw ERR.VALUE;
        if (!(v === true || (typeof v === 'number' && v !== 0))) never = true;
      });
      if (!never) rows.push(row);
    }
    // Rows past the sheet's used cells (a whole-column range) are blank: every record.
    if (crit.r1 > r1) rows.push([]);
    return rows;
  };

  // The field's value in each matching record (each record's first value when the field is left out).
  const matches = ([db, field, crit], ctx, optional = false) => {
    const t = table(db, ctx), j = column(field, t, optional), rows = conditions(crit, t, ctx);
    const out = [];
    for (let i = 1; i <= t.records; i++) {
      if (rows.some((row) => row.every(([k, test]) => test(t.get(i, k))))) out.push(t.get(i, Math.max(j, 0)));
    }
    return out;
  };
  const numbers = (args, ctx) => {
    const xs = [];
    for (const v of matches(args, ctx)) { if (isErr(v)) throw v; if (typeof v === 'number') xs.push(v); }
    return xs;
  };
  const finite = (x) => (Number.isFinite(x) ? x : ERR.NUM);
  const variance = (xs, sample) => {
    const n = xs.length;
    if (n - sample < 1) throw ERR.DIV0;
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    return xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - sample);
  };

  const D = (fn) => ({ p: ['r', 'v', 'r'], min: 3, max: 3, fn });
  const FNS = {
    DSUM: D((args, ctx) => finite(numbers(args, ctx).reduce((s, x) => s + x, 0))),
    DCOUNT: D((args, ctx) => { const vs = matches(args, ctx, true); return given(args[1]) ? vs.filter((v) => typeof v === 'number').length : vs.length; }),
    DCOUNTA: D((args, ctx) => { const vs = matches(args, ctx, true); return given(args[1]) ? vs.filter((v) => v !== null).length : vs.length; }),
    DAVERAGE: D((args, ctx) => { const xs = numbers(args, ctx); if (!xs.length) throw ERR.DIV0; return finite(xs.reduce((s, x) => s + x, 0) / xs.length); }),
    DGET: D((args, ctx) => {
      const vs = matches(args, ctx);
      if (!vs.length) throw ERR.VALUE;
      if (vs.length > 1) throw ERR.NUM;
      if (vs[0] === null) throw ERR.VALUE;
      return vs[0];
    }),
    DMAX: D((args, ctx) => numbers(args, ctx).reduce((m, x) => (m === null || x > m ? x : m), null) ?? 0),
    DMIN: D((args, ctx) => numbers(args, ctx).reduce((m, x) => (m === null || x < m ? x : m), null) ?? 0),
    DPRODUCT: D((args, ctx) => { const xs = numbers(args, ctx); return xs.length ? finite(xs.reduce((p, x) => p * x, 1)) : 0; }),
    DSTDEV: D((args, ctx) => finite(Math.sqrt(variance(numbers(args, ctx), 1)))),
    DSTDEVP: D((args, ctx) => finite(Math.sqrt(variance(numbers(args, ctx), 0)))),
    DVAR: D((args, ctx) => finite(variance(numbers(args, ctx), 1))),
    DVARP: D((args, ctx) => finite(variance(numbers(args, ctx), 0))),
  };

  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_DATABASE; else GZ_SHEET_FN_DATABASE;
