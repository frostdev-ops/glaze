// Glaze Sheets' XOR and SWITCH, registered with the calc engine (sheet-calc.js define). XOR reads its values as AND
// and OR do. SWITCH compares its values in order, evaluating each only when the ones before it missed and only the
// matching result: a value matches when it is of the expression's kind and equal (text without case), a blank reading
// as 0 (Excel 16.114.1).
// Classic script; module.exports for node.
var GZ_SHEET_FN_LOGICAL2 = globalThis.GZ_SHEET_FN_LOGICAL2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, isErr, bool, compare, each } = C.lib;

  const kind = (v) => typeof v;
  const matches = (a, b) => kind(a) === kind(b) && compare(a, b) === 0;

  const FNS = {
    // TRUE when an odd number of its logical values are TRUE. Typed values read as logicals; ranges and arrays give
    // their booleans and numbers only; with none, #VALUE!.
    XOR: { p: ['r'], min: 1, fn: (args, ctx) => {
      let seen = false, odd = false;
      for (const a of args) each(a, ctx, (v, direct) => {
        if (isErr(v)) throw v;
        let b;
        if (typeof v === 'boolean') b = v;
        else if (typeof v === 'number') b = v !== 0;
        else if (direct) b = bool(v);
        else return;
        seen = true;
        if (b) odd = !odd;
      });
      if (!seen) throw ERR.VALUE;
      return odd;
    } },
    // SWITCH(expression, value1, result1, …, [default]): an odd count of arguments after the expression ends in a
    // default. An error met in a value before a match is the result.
    SWITCH: { p: ['v', 'l'], min: 3, fn: ([x, ...rest], ctx) => {
      const key = x === null ? 0 : x;
      const pairs = rest.length - (rest.length % 2);
      for (let i = 0; i < pairs; i += 2) {
        let v = ctx.value(rest[i]());
        if (Array.isArray(v)) v = v[0][0];
        if (isErr(v)) return v;
        if (matches(key, v === null ? 0 : v)) return rest[i + 1]();
      }
      return rest.length % 2 ? rest[rest.length - 1]() : ERR.NA;
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_LOGICAL2; else GZ_SHEET_FN_LOGICAL2;
