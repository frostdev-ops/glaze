// Glaze Sheets' logical functions: IF IFS AND OR NOT IFERROR IFNA TRUE FALSE, registered with the calc engine
// (sheet-calc.js define). IF and IFS evaluate only the branch they take, unless IF's condition is an array.
// Classic script; module.exports for node.
var GZ_SHEET_FN_LOGICAL = globalThis.GZ_SHEET_FN_LOGICAL || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, isErr, bool, each, map } = C.lib;

  // AND and OR read typed values as booleans (text other than TRUE or FALSE is #VALUE!), and from ranges and arrays
  // only booleans and numbers. With none to read, #VALUE!.
  const logical = (args, ctx, step) => {
    let seen = false, acc = null;
    for (const a of args) each(a, ctx, (v, direct) => {
      if (isErr(v)) throw v;
      let b;
      if (typeof v === 'boolean') b = v;
      else if (typeof v === 'number') b = v !== 0;
      else if (direct) b = bool(v);
      else return;
      seen = true;
      acc = step(acc, b);
    });
    if (!seen) throw ERR.VALUE;
    return acc;
  };

  const FNS = {
    IF: { p: ['r', 'l', 'l'], min: 1, max: 3, fn: ([cond, yes, no], ctx) => {
      const c = ctx.value(cond);
      if (Array.isArray(c)) {
        const y = yes ? ctx.value(yes()) : true, n = no ? ctx.value(no()) : false;
        return map([c, y, n], (ci, yi, ni) => { if (isErr(ci)) return ci; try { return bool(ci) ? yi : ni; } catch (e) { return e; } });
      }
      if (isErr(c)) return c;
      return bool(c) ? (yes ? yes() : true) : no ? no() : false;
    } },
    IFS: { p: ['l'], min: 2, fn: (args, ctx) => {
      if (args.length % 2) throw ERR.NA;
      for (let i = 0; i < args.length; i += 2) {
        let c = ctx.value(args[i]());
        if (Array.isArray(c)) c = c[0][0];
        if (isErr(c)) return c;
        if (bool(c)) return args[i + 1]();
      }
      return ERR.NA;
    } },
    AND: { p: ['r'], min: 1, fn: (args, ctx) => logical(args, ctx, (acc, b) => (acc ?? true) && b) },
    OR: { p: ['r'], min: 1, fn: (args, ctx) => logical(args, ctx, (acc, b) => (acc ?? false) || b) },
    NOT: { p: ['v'], min: 1, max: 1, fn: ([v]) => !bool(v) },
    IFERROR: { p: ['v', 'v'], min: 2, max: 2, errors: true, fn: ([v, alt]) => (isErr(v) ? alt : v) },
    IFNA: { p: ['v', 'v'], min: 2, max: 2, errors: true, fn: ([v, alt]) => (v === ERR.NA ? alt : v) },
    TRUE: { p: [], min: 0, max: 0, fn: () => true },
    FALSE: { p: [], min: 0, max: 0, fn: () => false },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_LOGICAL; else GZ_SHEET_FN_LOGICAL;
