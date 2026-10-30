// Glaze Sheets' text functions: CONCAT CONCATENATE LEFT RIGHT MID LEN TRIM UPPER LOWER TEXT VALUE, registered with the
// calc engine (sheet-calc.js define). A number as text has 15 significant digits; TEXT formats through sheet-numfmt.js.
// LEN, LEFT, RIGHT and MID count characters, one outside the BMP (an emoji) once, as Excel 16.114.1 does.
// Classic script; module.exports for node.
var GZ_SHEET_FN_TEXT = globalThis.GZ_SHEET_FN_TEXT || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const NF = typeof GZ_SHEET_NUMFMT !== 'undefined' ? GZ_SHEET_NUMFMT : require('./sheet-numfmt.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { ERR, isErr, num, text, each } = C.lib;
  const LIMIT = M.CAP.text;

  const capped = (s) => { if (s.length > LIMIT) throw ERR.VALUE; return s; };
  // A string's characters: its UTF-16 units unless it has a surrogate pair.
  const chars = (s) => (/[\ud800-\udbff][\udc00-\udfff]/.test(s) ? Array.from(s) : s);
  const part = (s, from, n) => { const cs = chars(s); return typeof cs === 'string' ? cs.substr(from, n) : cs.slice(from, from + n).join(''); };
  const count = (v, ctx) => { const n = Math.trunc(num(v, ctx)); if (n < 0) throw ERR.VALUE; return n; };

  const FNS = {
    CONCAT: { p: ['r'], min: 1, fn: (args, ctx) => {
      let s = '';
      for (const a of args) each(a, ctx, (v) => { if (isErr(v)) throw v; s += text(v); if (s.length > LIMIT) throw ERR.VALUE; }, true);
      return s;
    } },
    CONCATENATE: { p: ['v'], min: 1, fn: (args) => capped(args.map(text).join('')) },
    LEFT: { p: ['v', 'v'], min: 1, max: 2, fn: ([s, n], ctx) => part(text(s), 0, n === undefined ? 1 : count(n, ctx)) },
    RIGHT: { p: ['v', 'v'], min: 1, max: 2, fn: ([s, n], ctx) => {
      const t = text(s), k = n === undefined ? 1 : count(n, ctx), size = chars(t).length;
      return part(t, Math.max(0, size - k), k);
    } },
    MID: { p: ['v', 'v', 'v'], min: 3, max: 3, fn: ([s, start, n], ctx) => {
      const t = text(s), at = Math.trunc(num(start, ctx)), k = count(n, ctx);
      if (at < 1) throw ERR.VALUE;
      return part(t, at - 1, k);
    } },
    LEN: { p: ['v'], min: 1, max: 1, fn: ([s]) => chars(text(s)).length },
    // Excel's TRIM takes only the space character: none at either end, one between words.
    TRIM: { p: ['v'], min: 1, max: 1, fn: ([s]) => text(s).replace(/ {2,}/g, ' ').replace(/^ | $/g, '') },
    UPPER: { p: ['v'], min: 1, max: 1, fn: ([s]) => text(s).toUpperCase() },
    LOWER: { p: ['v'], min: 1, max: 1, fn: ([s]) => text(s).toLowerCase() },
    TEXT: { p: ['v', 'v'], min: 2, max: 2, fn: ([v, fmt], ctx) => {
      const code = text(fmt);
      let value = v;
      if (typeof v === 'string') { const n = M.parseNumber(v, { date1904: ctx.date1904 }); if (n) value = n.v; }
      else if (v === null) value = 0;
      // An empty format shows a number as nothing, a negative one as "-" (Excel 16.114.1); text as it is.
      if (code === '') return typeof value === 'number' ? (value < 0 ? '-' : '') : text(value);
      let out;
      try { out = NF.format(value, code, { date1904: ctx.date1904 }); } catch (e) { if (e.code === 'format') throw ERR.VALUE; throw e; }
      if (out === null) throw ERR.VALUE;
      return capped(out);
    } },
    VALUE: { p: ['v'], min: 1, max: 1, fn: ([v], ctx) => {
      if (typeof v === 'number') return v;
      if (v === null) return 0;
      if (typeof v !== 'string') throw ERR.VALUE;
      const n = M.parseNumber(v, { date1904: ctx.date1904 });
      if (!n) throw ERR.VALUE;
      return n.v;
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_TEXT; else GZ_SHEET_FN_TEXT;
