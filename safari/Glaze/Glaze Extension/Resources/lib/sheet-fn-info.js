// Glaze Sheets' information functions, registered with the calc engine (sheet-calc.js define): ISBLANK ISERR ISERROR
// ISNA ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISREF ISEVEN ISODD ISFORMULA N T TYPE ERROR.TYPE NA CELL INFO SHEET SHEETS
// FORMULATEXT (ROW, ROWS, COLUMN and COLUMNS are sheet-fn-lookup.js's). The IS functions take a value as it is: "19"
// is text. CELL answers "address", "col", "row", "contents", "type" and "format", and without a reference answers for
// its own cell; INFO answers nothing. An address on another sheet is 'Sheet 2'!$B$2 without the [Book1] Excel puts
// first: a Glaze workbook has no file name (its record's title is not one), and INDIRECT reads the address back.
// Classic script; module.exports for node.
var GZ_SHEET_FN_INFO = globalThis.GZ_SHEET_FN_INFO || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const F = typeof GZ_SHEET_FORMULA !== 'undefined' ? GZ_SHEET_FORMULA : require('./sheet-formula.js');
  const NF = typeof GZ_SHEET_NUMFMT !== 'undefined' ? GZ_SHEET_NUMFMT : require('./sheet-numfmt.js');
  const { ERR, isErr, num, text, Ref, Areas } = C.lib;

  // One area of cells; a list of areas is #VALUE!.
  const reference = (v) => {
    if (isErr(v)) throw v;
    if (v instanceof Areas) throw ERR.VALUE;
    if (!(v instanceof Ref)) throw ERR.VALUE;
    return v;
  };
  // CELL("format"): Excel's code for a number format's first section: G, F, ",", C, P or S with its decimals, D1-D9 for
  // dates and times, "-" when negatives show in a colour, "()" when positives show in parentheses.
  const sections = (code) => {
    const out = [{ text: '', literal: '', color: false }];
    for (let i = 0; i < code.length; i++) {
      const ch = code[i], cur = out[out.length - 1];
      if (ch === '"') { const end = code.indexOf('"', i + 1); cur.literal += code.slice(i + 1, end < 0 ? code.length : end); i = end < 0 ? code.length : end; }
      else if (ch === '\\') cur.literal += code[++i] ?? '';
      else if (ch === '_' || ch === '*') i++;
      else if (ch === '[') {
        const end = code.indexOf(']', i), inner = code.slice(i + 1, end < 0 ? code.length : end);
        if (/^(h+|m+|s+)$/i.test(inner)) cur.text += inner;
        else if (inner[0] === '$') cur.literal += inner.slice(1).split('-')[0];
        else if (!/^[<>=]/.test(inner)) cur.color = true;
        i = end < 0 ? code.length : end;
      } else if (ch === ';') out.push({ text: '', literal: '', color: false });
      else cur.text += ch;
    }
    return out;
  };
  const formatCode = (fmt) => {
    const code = NF.code(fmt), [first, negative] = sections(code), t = first.text.toLowerCase().trim();
    const suffix = (negative?.color ? '-' : '') + (/\(/.test(first.text + first.literal) ? '()' : '');
    if (t.trim() === 'general') return 'G' + suffix;
    if (/[ydhs]/.test(t) || /m/.test(t.replace(/am\/pm/g, ''))) {
      // CELL describes format families, not whether the formatter can render a date. Token-only, ISO and elapsed
      // formats return G in Excel. Locale-prefixed dates have their own legacy D2 classification.
      let kind = 'G';
      if (!/\[[hms]+\]/i.test(code)) {
        if (/^\[\$-[\da-f]+\]/i.test(code) && /[mdy]/.test(t)) kind = 'D2';
        else if (/^m{1,4}[^a-z]+d{1,2}[^a-z]+y/.test(t)) kind = 'D4';
        else if (/^d{1,2}[^a-z]+m{3,4}[^a-z]+y/.test(t)) kind = 'D1';
        else if (/^d{1,4}[^a-z]+m{3,4}/.test(t)) kind = 'D2';
        else if (/^m{3,4}[^a-z]+y/.test(t)) kind = 'D3';
        else if (/^m{1,2}\/d{1,2}$/.test(t)) kind = 'D5';
        else if (/^h{1,2}:mm/.test(t)) {
          const ampm = /am\/pm|a\/p/.test(t);
          kind = t.includes('s') ? (ampm ? 'D6' : 'D8') : ampm ? 'D7' : 'D9';
        }
      }
      return kind + suffix;
    }
    if (!/[0#?]/.test(t) && t.includes('@')) return 'G';
    if (/[0#?]\s*\/\s*[0-9#?]/.test(t)) return 'G' + suffix;
    const mantissa = t.split(/e[+-]/)[0], dot = mantissa.indexOf('.');
    const decimals = dot < 0 ? 0 : (mantissa.slice(dot + 1).match(/[0#?]/g) || []).length;
    const currency = /[$€£¥]/.test(first.text + first.literal);
    const kind = /e[+-]/.test(t) ? 'S' : t.includes('%') ? 'P' : currency ? 'C' : /[0#?],[0#?]/.test(t) ? ',' : 'F';
    return kind + decimals + suffix;
  };

  const is = (test) => ({ p: ['v'], min: 1, max: 1, errors: true, fn: ([v]) => test(v) });
  const parity = (odd) => ({ p: ['v'], min: 1, max: 1, fn: ([v], ctx) => {
    if (typeof v === 'boolean') throw ERR.VALUE;
    return Math.abs(Math.trunc(num(v, ctx)) % 2) === (odd ? 1 : 0);
  } });
  const ERROR_TYPES = { '#NULL!': 1, '#DIV/0!': 2, '#VALUE!': 3, '#REF!': 4, '#NAME?': 5, '#NUM!': 6, '#N/A': 7, '#GETTING_DATA': 8 };

  const FNS = {
    ISBLANK: is((v) => v === null),
    ISERR: is((v) => isErr(v) && v !== ERR.NA),
    ISERROR: is(isErr),
    ISNA: is((v) => v === ERR.NA),
    ISNUMBER: is((v) => typeof v === 'number'),
    ISTEXT: is((v) => typeof v === 'string'),
    ISNONTEXT: is((v) => typeof v !== 'string'),
    ISLOGICAL: is((v) => typeof v === 'boolean'),
    ISREF: { p: ['r'], min: 1, max: 1, fn: ([v]) => v instanceof Ref || v instanceof Areas },
    ISEVEN: parity(false),
    ISODD: parity(true),
    ISFORMULA: { p: ['r'], min: 1, max: 1, fn: ([v], ctx) => { const ref = reference(v); return ctx.formulaAt(ref.sheet, ref.r0, ref.c0) !== null; } },
    // A range or an array formula's cells show the formula bar's text: the head's formula, an array's in braces.
    FORMULATEXT: { p: ['r'], min: 1, max: 1, fn: ([v], ctx) => {
      const ref = reference(v), cell = ctx.formulaAt(ref.sheet, ref.r0, ref.c0);
      if (!cell) throw ERR.NA;
      return cell.a !== undefined ? `{=${cell.f}}` : `=${cell.f}`;
    } },
    N: { p: ['v'], min: 1, max: 1, fn: ([v]) => (typeof v === 'number' ? v : v === true ? 1 : 0) },
    T: { p: ['v'], min: 1, max: 1, fn: ([v]) => (typeof v === 'string' ? v : '') },
    TYPE: { p: ['r'], min: 1, max: 1, fn: ([v], ctx) => {
      if (v instanceof Areas) return 16;
      if (v instanceof Ref) v = ctx.value(v);
      if (Array.isArray(v)) return 64;
      if (typeof v === 'string') return 2;
      if (typeof v === 'boolean') return 4;
      return isErr(v) ? 16 : 1;
    } },
    'ERROR.TYPE': { p: ['v'], min: 1, max: 1, errors: true, fn: ([v]) => (isErr(v) && ERROR_TYPES[v.code]) || ERR.NA },
    NA: { p: [], min: 0, max: 0, fn: () => ERR.NA },
    CELL: { p: ['v', 'r'], min: 1, max: 2, fn: ([info, v], ctx) => {
      const kind = text(info).toLowerCase();
      const { sheet, r0: r, c0: c } = v === undefined ? { sheet: ctx.sheet, r0: ctx.r, c0: ctx.c } : reference(v);
      switch (kind) {
        case 'address': return `${sheet === ctx.sheet ? '' : F.sheetPrefix(sheet.name)}$${M.columnName(c)}$${r + 1}`;
        case 'col': return c + 1;
        case 'row': return r + 1;
        case 'contents': return ctx.read(sheet, r, c);
        // Excel classifies text results, including text formulas, as labels.
        case 'type': {
          const cell = sheet.rows.get(r)?.get(c);
          if (!cell || cell.t === 'z') return 'b';
          return cell.t === 's' ? 'l' : 'v';
        }
        case 'format': { const s = sheet.rows.get(r)?.get(c)?.s; return formatCode(s === undefined ? 0 : ctx.style(s)?.fmt); }
        default: throw ERR.VALUE;
      }
    } },
    INFO: { p: ['v'], min: 1, max: 1, fn: () => ERR.VALUE },
    SHEET: { p: ['r'], min: 0, max: 1, fn: ([v], ctx) => {
      const sheets = ctx.sheets;
      if (v === undefined) return sheets.indexOf(ctx.sheet) + 1;
      if (isErr(v)) return v;
      if (v instanceof Areas) return sheets.indexOf(v.list[0].sheet) + 1;
      if (v instanceof Ref) return sheets.indexOf(v.sheet) + 1;
      if (Array.isArray(v)) throw ERR.VALUE;
      const named = ctx.sheetNamed(text(v));
      if (!named) throw ERR.NA;
      return sheets.indexOf(named) + 1;
    } },
    SHEETS: { p: ['r'], min: 0, max: 1, fn: ([v], ctx) => {
      if (v === undefined) return ctx.sheets.length;
      if (isErr(v)) return v;
      if (v instanceof Areas) return new Set(v.list.map((ref) => ref.sheet)).size;
      if (v instanceof Ref) return 1;
      throw ERR.NA;
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return { FNS, formatCode };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_INFO; else GZ_SHEET_FN_INFO;
