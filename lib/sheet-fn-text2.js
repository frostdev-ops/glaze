// Glaze Sheets' further text functions: TEXTBEFORE TEXTAFTER TEXTSPLIT TEXTJOIN SUBSTITUTE REPLACE REPT FIND FINDB
// SEARCH SEARCHB EXACT PROPER CLEAN CHAR CODE UNICHAR UNICODE DOLLAR FIXED NUMBERVALUE VALUETOTEXT ARRAYTOTEXT,
// registered with the calc engine (sheet-calc.js define). Text past 32,767 characters is #VALUE!. FINDB and SEARCHB
// use UTF-16 positions in the fixed SBCS locale; FIND, SEARCH and REPLACE use compatibility-version-2 code points.
// CHAR and CODE deliberately use Windows-1252 on every host for portable workbooks; outside it CODE is 63, "?".
// DBCS byte positions require workbook locale metadata from the model.
// Classic script; module.exports for node.
var GZ_SHEET_FN_TEXT2 = globalThis.GZ_SHEET_FN_TEXT2 || (() => {
  const C = typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : require('./sheet-calc.js');
  const NF = typeof GZ_SHEET_NUMFMT !== 'undefined' ? GZ_SHEET_NUMFMT : require('./sheet-numfmt.js');
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const { ERR, isErr, num, text, bool, round, toArray, map, Ref, Areas } = C.lib;
  const LIMIT = M.CAP.text;

  const capped = (s) => { if (s.length > LIMIT) throw ERR.VALUE; return s; };
  const given = (v) => v !== undefined && v !== null;
  const whole = (v, ctx) => Math.trunc(num(v, ctx));
  // A 0-or-1 switch (match_mode, match_end, format): anything else is #VALUE!.
  const flag = (v, ctx) => { if (!given(v)) return 0; const n = num(v, ctx); if (n !== 0 && n !== 1) throw ERR.VALUE; return n; };
  // A range, array or value as a grid, or as the list of its values row by row.
  const grid = (a, ctx) => {
    if (isErr(a)) throw a;
    if (a instanceof Areas) throw ERR.VALUE;
    if (a instanceof Ref) { const g = toArray(a, ctx); if (isErr(g)) throw g; return g; }
    return Array.isArray(a) ? a : [[a]];
  };
  const values = (a, ctx) => grid(a, ctx).flat();
  const texts = (a, ctx) => values(a, ctx).map((v) => { if (isErr(v)) throw v; return text(v); });

  // Where any of the delimiters occurs, left to right without overlap ([start, end]); of two at one place, the longer.
  const escape = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');
  const occurrences = (s, delims, insensitive) => {
    const ds = [...new Set(delims.filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!ds.length) return [];
    // Match the original string, so case folds such as İ never shift the returned offsets.
    const re = new RegExp(ds.map(escape).join('|'), insensitive ? 'gi' : 'g');
    return [...s.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
  };
  const split = (s, delims, insensitive, dropEmpty) => {
    const parts = [];
    let at = 0;
    for (const [a, b] of occurrences(s, delims, insensitive)) { parts.push(s.slice(at, a)); at = b; }
    parts.push(s.slice(at));
    return dropEmpty ? parts.filter((p) => p !== '') : parts;
  };

  // TEXTBEFORE and TEXTAFTER: the text before (or after) the nth delimiter, counted from the end when n is negative;
  // match_end lets the text's end (or start) stand for one more. An empty delimiter matches at once.
  const around = (after) => ({ p: ['v', 'r', 'v', 'v', 'v', 'v'], min: 2, max: 6, fn: ([t, delimiter, instance, mode, end, missing], ctx) => {
    const s = text(t), delims = texts(delimiter, ctx);
    const n = given(instance) ? whole(instance, ctx) : 1, insensitive = flag(mode, ctx) === 1, toEnd = flag(end, ctx) === 1;
    if (n === 0) throw ERR.VALUE;
    if (s === '') { if (delims.includes('')) return ''; throw ERR.VALUE; }
    if (Math.abs(n) > s.length) throw ERR.VALUE;
    if (delims.includes('')) return (n > 0) === after ? s : '';
    const occ = occurrences(s, delims, insensitive), k = Math.abs(n);
    if (k <= occ.length) { const [a, b] = occ[n > 0 ? k - 1 : occ.length - k]; return after ? s.slice(b) : s.slice(0, a); }
    if (toEnd && k === occ.length + 1) return (n > 0) === after ? '' : s;
    if (given(missing)) return missing;
    throw ERR.NA;
  } });

  // Match the fixed pieces between SEARCH's stars from left to right. Keeping stars out of the regular
  // expressions avoids exponential backtracking on patterns such as *a*a*a*b in a long run of a's.
  const searchAt = (find, s, unicode) => {
    const pieces = [''];
    let leadingStar = false;
    for (let i = 0; i < find.length; i++) {
      const ch = find[i];
      if (ch === '~' && i + 1 === find.length) break; // Excel ignores a trailing escape.
      if (ch === '~') pieces[pieces.length - 1] += escape(find[++i]);
      else if (ch === '*') { if (i === 0) leadingStar = true; pieces.push(''); }
      else pieces[pieces.length - 1] += ch === '?' ? '[\\s\\S]' : escape(ch);
    }
    let at = 0, first = null;
    for (const piece of pieces) {
      if (!piece) continue;
      const rest = s.slice(at), re = new RegExp(piece, 'gi');
      let m = re.exec(rest);
      // Excel's ? consumes one UTF-16 unit, but SEARCH cannot begin inside a surrogate pair.
      while (m && first === null && !leadingStar && unicode && m.index > 0
        && /[\udc00-\udfff]/.test(rest[m.index]) && /[\ud800-\udbff]/.test(rest[m.index - 1])) {
        re.lastIndex = m.index + 1;
        m = re.exec(rest);
      }
      if (!m) return -1;
      if (first === null) first = at + m.index;
      at += m.index + m[0].length;
    }
    return leadingStar ? 0 : first ?? 0;
  };
  // FIND and SEARCH: the 1-based place of find_text in within_text from start_num, which must lie inside it.
  const locate = (wild, bytes = false) => ({ p: ['v', 'v', 'v'], min: 2, max: 3, fn: ([find, within, start], ctx) => {
    const f = text(find), w = text(within), from = given(start) ? whole(start, ctx) : 1;
    const chars = bytes ? w.split('') : [...w], length = chars.length;
    if (from < 1 || from > length + (!wild && f === '' ? 1 : 0)) throw ERR.VALUE;
    if (f === '') return from;
    const offset = chars.slice(0, from - 1).join('').length;
    const found = wild ? searchAt(f, w.slice(offset), !bytes) : w.indexOf(f, offset);
    const at = wild && found >= 0 ? found + offset : found;
    if (at < 0) throw ERR.VALUE;
    return (bytes ? at : [...w.slice(0, at)].length) + 1;
  } });

  // Windows-1252's 128-159 (the five it leaves undefined map to the same code points, as Windows does).
  const CP1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
    0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
  const ANSI = new Map(CP1252.map((u, i) => [u, 128 + i]));

  // Concise as a General cell shows it; strict quotes text, doubling its quotes.
  const show = (v, strict) => {
    if (isErr(v)) return v.code;
    if (typeof v === 'string') return strict ? `"${v.replace(/"/g, '""')}"` : v;
    return v === null || v === undefined ? '' : text(v);
  };
  // DOLLAR and FIXED: rounded to `decimals` (left of the point when negative), at most 127.
  const decimals = (v, ctx, dflt) => { const d = given(v) ? whole(v, ctx) : dflt; if (d > 127) throw ERR.VALUE; return d; };
  const digitsCode = (grouped, d) => `${grouped ? '#,##0' : '0'}${d > 0 ? `.${'0'.repeat(d)}` : ''}`;

  const FNS = {
    TEXTBEFORE: around(false),
    TEXTAFTER: around(true),
    // Rows split on row_delimiter, each row on col_delimiter; short rows pad with pad_with (#N/A). Several cells of
    // text give each its first piece.
    TEXTSPLIT: { p: ['r', 'r', 'r', 'v', 'v', 'v'], min: 2, max: 6, fn: ([t, colDelim, rowDelim, ignore, mode, pad], ctx) => {
      const src = ctx.value(t);
      if (isErr(src)) return src;
      const cols = given(colDelim) ? texts(colDelim, ctx) : [], rows = given(rowDelim) ? texts(rowDelim, ctx) : [];
      if ((!cols.length && !rows.length) || cols.includes('') || rows.includes('')) throw ERR.VALUE;
      const dropEmpty = given(ignore) && bool(ignore), insensitive = flag(mode, ctx) === 1, fill = given(pad) ? pad : ERR.NA;
      const one = (v) => {
        if (isErr(v)) return v;
        const s = text(v);
        if (s === '') return ERR.VALUE;
        const lines = rows.length ? split(s, rows, insensitive, dropEmpty) : [s];
        const out = lines.map((line) => (cols.length ? split(line, cols, insensitive, dropEmpty) : [line])).filter((r) => r.length);
        if (!out.length) return C.err('#CALC!');
        const width = Math.max(...out.map((r) => r.length));
        return out.map((r) => (r.length < width ? r.concat(Array(width - r.length).fill(fill)) : r));
      };
      if (!Array.isArray(src)) return one(src);
      return map([src], (v) => { const g = one(v); return Array.isArray(g) ? g[0][0] : g; });
    } },
    // Delimiters, when several, take turns between the items joined.
    TEXTJOIN: { p: ['r', 'v', 'r'], min: 3, fn: ([delimiter, ignore, ...items], ctx) => {
      const delims = texts(delimiter, ctx), skip = bool(ignore);
      const parts = [];
      for (const a of items) for (const v of a === null ? [null] : values(a, ctx)) {
        if (isErr(v)) throw v;
        const s = text(v);
        if (!(skip && s === '')) parts.push(s);
      }
      let s = '';
      parts.forEach((p, i) => { s += (i ? delims[(i - 1) % delims.length] ?? '' : '') + p; if (s.length > LIMIT) throw ERR.VALUE; });
      return s;
    } },
    SUBSTITUTE: { p: ['v', 'v', 'v', 'v'], min: 3, max: 4, fn: ([t, old, rep, instance], ctx) => {
      const s = text(t), o = text(old), r = text(rep);
      // Left out, every instance; given empty, 0 (#VALUE!), as Excel takes it.
      if (instance === undefined) return o === '' ? s : capped(s.split(o).join(r));
      const n = whole(instance, ctx);
      if (n < 1) throw ERR.VALUE;
      if (o === '') return s;
      let at = -o.length;
      for (let k = 0; k < n; k++) { at = s.indexOf(o, at + o.length); if (at < 0) return s; }
      return capped(s.slice(0, at) + r + s.slice(at + o.length));
    } },
    REPLACE: { p: ['v', 'v', 'v', 'v'], min: 4, max: 4, fn: ([t, start, count, rep], ctx) => {
      const s = text(t), at = whole(start, ctx), n = whole(count, ctx), r = text(rep);
      if (at < 1 || n < 0) throw ERR.VALUE;
      const chars = [...s];
      return capped(chars.slice(0, at - 1).join('') + r + chars.slice(at - 1 + n).join(''));
    } },
    REPT: { p: ['v', 'v'], min: 2, max: 2, fn: ([t, times], ctx) => {
      const s = text(t), n = whole(times, ctx);
      if (n < 0 || s.length * n > LIMIT) throw ERR.VALUE;
      return s.repeat(n);
    } },
    FIND: locate(false),
    FINDB: locate(false, true),
    SEARCH: locate(true),
    SEARCHB: locate(true, true),
    EXACT: { p: ['v', 'v'], min: 2, max: 2, fn: ([a, b]) => text(a) === text(b) },
    // Each letter after a non-letter upper case, every other letter lower.
    PROPER: { p: ['v'], min: 1, max: 1, fn: ([t]) => {
      let s = '', prev = false;
      for (const ch of text(t)) { const letter = /\p{L}/u.test(ch); s += letter ? (prev ? ch.toLowerCase() : ch.toUpperCase()) : ch; prev = letter; }
      return capped(s);
    } },
    // Use CLEAN's documented portable ASCII 0-31 set. Mac Excel additionally strips U+0080-U+009F.
    CLEAN: { p: ['v'], min: 1, max: 1, fn: ([t]) => text(t).replace(/[\x00-\x1f]/g, '') },
    CHAR: { p: ['v'], min: 1, max: 1, fn: ([x], ctx) => {
      const n = whole(x, ctx);
      if (n < 1 || n > 255) throw ERR.VALUE;
      return String.fromCharCode(n >= 128 && n < 160 ? CP1252[n - 128] : n);
    } },
    CODE: { p: ['v'], min: 1, max: 1, fn: ([t]) => {
      const s = text(t);
      if (s === '') throw ERR.VALUE;
      const u = s.charCodeAt(0);
      return ANSI.get(u) ?? (u < 128 || (u >= 160 && u <= 255) ? u : 63);
    } },
    UNICHAR: { p: ['v'], min: 1, max: 1, fn: ([x], ctx) => {
      const n = whole(x, ctx);
      if (n < 1 || n > 0x10ffff) throw ERR.VALUE;
      if (n >= 0xd800 && n <= 0xdfff) throw ERR.NA;
      return String.fromCodePoint(n);
    } },
    UNICODE: { p: ['v'], min: 1, max: 1, fn: ([t]) => {
      const s = text(t);
      if (s === '') throw ERR.VALUE;
      const u = s.codePointAt(0);
      if (u >= 0xd800 && u <= 0xdfff) throw ERR.VALUE;
      return u;
    } },
    // Excel's $#,##0.00_);($#,##0.00), to the decimals asked for.
    DOLLAR: { p: ['v', 'v'], min: 1, max: 2, fn: ([x, d], ctx) => {
      const places = decimals(d, ctx, 2), code = `"$"${digitsCode(true, places)}`;
      const value = num(x, ctx), result = NF.format(Math.abs(round(value, places)), code);
      return value < 0 ? `(${result})` : result;
    } },
    FIXED: { p: ['v', 'v', 'v'], min: 1, max: 3, fn: ([x, d, noCommas], ctx) => {
      const places = decimals(d, ctx, 2);
      return NF.format(round(num(x, ctx), places), digitsCode(!(given(noCommas) && bool(noCommas)), places));
    } },
    // Spaces anywhere are ignored; group separators before the decimal one are dropped, after it #VALUE!; each
    // trailing % divides by 100. Separators default to en-US's . and ,; only a separator's first character counts.
    NUMBERVALUE: { p: ['v', 'v', 'v'], min: 1, max: 3, fn: ([t, decSep, groupSep]) => {
      const dec = given(decSep) ? text(decSep)[0] : '.', group = given(groupSep) ? text(groupSep)[0] : ',';
      if (dec === undefined || group === undefined || dec === group) throw ERR.VALUE;
      let s = text(t).replace(/\s+/g, '');
      if (s === '') return 0;
      let pct = 0;
      while (s.endsWith('%')) { s = s.slice(0, -1); pct++; }
      const point = s.indexOf(dec);
      const plain = (point >= 0 ? s.slice(0, point).split(group).join('') + '.' + s.slice(point + 1) : s.split(group).join(''));
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(plain)) throw ERR.VALUE;
      const n = Number(Number(plain).toPrecision(15)) / 100 ** pct;
      if (!Number.isFinite(n) || Math.abs(n) > 9.99999999999999e307) throw ERR.VALUE;
      return Math.abs(n) < 2.2250738585072014e-308 ? 0 : n;
    } },
    VALUETOTEXT: { p: ['v', 'v'], min: 1, max: 2, errors: true, fn: ([v, format], ctx) => {
      if (isErr(format)) return format;
      return capped(show(v, flag(format, ctx) === 1));
    } },
    // Concise: every value, row by row, between ", "; strict: an array constant, {a,b;c,d}.
    ARRAYTOTEXT: { p: ['r', 'v'], min: 1, max: 2, fn: ([a, format], ctx) => {
      const strict = flag(format, ctx) === 1, g = grid(a, ctx);
      return capped(strict ? `{${g.map((row) => row.map((v) => show(v, true)).join(',')).join(';')}}` : g.flat().map((v) => show(v, false)).join(', '));
    } },
  };
  for (const [name, def] of Object.entries(FNS)) C.define(name, def);
  return FNS;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_FN_TEXT2; else GZ_SHEET_FN_TEXT2;
