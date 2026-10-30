// Glaze Sheets' XOR and SWITCH, registered with the calc engine (sheet-calc.js define). XOR reads its values as AND
// and OR do. SWITCH compares its values in order, evaluating each only when the ones before it missed and only the
// matching result: a value matches when it is of the expression's kind and equal (text without case), a blank reading
// as 0 (Excel 16.114.1).
// Classic script; module.exports for node.
var GZ_SHEET_FN_LOGICAL2 = globalThis.GZ_SHEET_FN_LOGICAL2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const { ERR, isErr, bool, compare, each, at, Ref } = C.lib;

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
    SWITCH: { p: ['r', 'l'], min: 3, fn: ([x, ...rest], ctx) => {
      const expression = ctx.value(x), array = Array.isArray(expression), cache = new Map(), values = new Map();
      const read = (i) => { if (!cache.has(i)) cache.set(i, rest[i]()); return cache.get(i); };
      const value = (i) => { if (!values.has(i)) values.set(i, ctx.value(read(i))); return values.get(i); };
      const result = (i, r, c) => {
        const v = read(i);
        if (!array) return v;
        if (v instanceof Ref && (v.rows !== 1 || v.cols !== 1)) return ERR.VALUE;
        return at(value(i), r, c);
      };
      const one = (key, r, c) => {
        if (isErr(key)) return key;
        if (key === null) key = 0;
        const pairs = rest.length - (rest.length % 2);
        for (let i = 0; i < pairs; i += 2) {
          const candidate = value(i);
          const v = array ? at(candidate, r, c) : Array.isArray(candidate) ? candidate[0][0] : candidate;
          if (isErr(v)) return v;
          if (matches(key, v === null ? 0 : v)) return result(i + 1, r, c);
        }
        return rest.length % 2 ? result(rest.length - 1, r, c) : ERR.NA;
      };
      return array ? expression.map((row, r) => row.map((v, c) => one(v, r, c))) : one(expression, 0, 0);
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_LOGICAL2; else GZ_SHEET_FN_LOGICAL2;
