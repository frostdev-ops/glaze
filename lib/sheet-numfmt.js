// Excel number formats: a code (or a built-in id, 0-49, kept as the id) turns a cell's value into the text the grid
// shows and TEXT() returns. Up to four sections (positive; negative; zero; text), [>100] conditions in place of the
// signs, [Red] and [ColorN] colours, digit placeholders 0 # ? with thousands and scaling commas, %, E+ and engineering
// notation, fractions, quoted and backslashed literals, _ padding and * fill, @, General, and date/time codes with
// elapsed [h] [mm] [ss]. Numbers round half away from zero after Excel's 15 significant digits. Codes are en-US.
// Classic script; module.exports for node.
var GZ_SHEET_NUMFMT = globalThis.GZ_SHEET_NUMFMT || (() => {
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const bad = (why) => { throw Object.assign(new Error(`number format: ${why}`), { code: 'format' }); };

  const BUILTIN = Object.freeze({
    0: 'General', 1: '0', 2: '0.00', 3: '#,##0', 4: '#,##0.00',
    5: '"$"#,##0_);("$"#,##0)', 6: '"$"#,##0_);[Red]("$"#,##0)', 7: '"$"#,##0.00_);("$"#,##0.00)', 8: '"$"#,##0.00_);[Red]("$"#,##0.00)',
    9: '0%', 10: '0.00%', 11: '0.00E+00', 12: '# ?/?', 13: '# ??/??', 14: 'm/d/yyyy', 15: 'd-mmm-yy', 16: 'd-mmm', 17: 'mmm-yy',
    18: 'h:mm AM/PM', 19: 'h:mm:ss AM/PM', 20: 'h:mm', 21: 'h:mm:ss', 22: 'm/d/yyyy h:mm',
    37: '#,##0 ;(#,##0)', 38: '#,##0 ;[Red](#,##0)', 39: '#,##0.00;(#,##0.00)', 40: '#,##0.00;[Red](#,##0.00)',
    41: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)', 42: '_("$"* #,##0_);_("$"* (#,##0);_("$"* "-"_);_(@_)',
    43: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)', 44: '_("$"* #,##0.00_);_("$"* (#,##0.00);_("$"* "-"??_);_(@_)',
    45: 'mm:ss', 46: '[h]:mm:ss', 47: 'mmss.0', 48: '##0.0E+0', 49: '@',
  });
  // An id 0-49 the en-US locale leaves undefined reads as General; past 49 the workbook defines its own.
  const builtin = (id) => (Object.hasOwn(BUILTIN, id) ? BUILTIN[id] : Number.isInteger(id) && id >= 0 && id <= 49 ? 'General' : null);
  const BY_CODE = new Map(Object.entries(BUILTIN).map(([id, c]) => [c, Number(id)]));
  const idOf = (code) => BY_CODE.get(code) ?? null;
  const code = (fmt) => (typeof fmt === 'number' ? builtin(fmt) ?? 'General' : typeof fmt === 'string' && fmt ? fmt : 'General');

  const COLORS = Object.freeze({ black: '#000000', blue: '#0000FF', cyan: '#00FFFF', green: '#00FF00', magenta: '#FF00FF', red: '#FF0000', white: '#FFFFFF', yellow: '#FFFF00' });
  // Excel's default 56-colour palette: [Color1] to [Color56], and the indexed colours 8-63 of a styles part.
  const PALETTE = Object.freeze(['#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#800000', '#008000',
    '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080', '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080',
    '#0066CC', '#CCCCFF', '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF', '#00CCFF', '#CCFFFF',
    '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99', '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600',
    '#666699', '#969696', '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333']);

  // ── Digits ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  // |x| to `dp` decimals, half away from zero, from its 15 significant digits: → [integer digits ('' for none), dp
  // decimal digits].
  const fixed = (x, dp) => {
    x = Math.abs(x);
    if (x === 0) return ['', '0'.repeat(dp)];
    const [mant, e] = x.toExponential(14).split('e');
    let digits = mant.replace('.', ''), point = Number(e) + 1;
    const keep = point + dp;
    if (keep < 0) return ['', '0'.repeat(dp)];
    if (keep < digits.length) {
      const up = digits[keep] >= '5';
      digits = digits.slice(0, keep);
      if (up) {
        let i = digits.length - 1;
        const a = digits.split('');
        while (i >= 0 && a[i] === '9') a[i--] = '0';
        if (i >= 0) a[i] = String(Number(a[i]) + 1); else { a.unshift('1'); point++; }
        digits = a.join('');
      }
    } else digits = digits.padEnd(keep, '0');
    const int = point <= 0 ? '' : digits.slice(0, point).replace(/^0+/, '');
    const frac = point <= 0 ? ('0'.repeat(-point) + digits).slice(0, dp).padEnd(dp, '0') : digits.slice(point);
    return [int, frac];
  };
  const exponent = (x) => Number(Math.abs(x).toExponential(14).split('e')[1]);
  const expText = (e) => `E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  const stripZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

  // General in `width` characters (the minus sign aside): fixed while the integer part fits and the number shows as more
  // than zero, scientific past that, both trimmed of trailing zeros.
  const general = (v, width = 11) => {
    if (!Number.isFinite(v)) return '#NUM!';
    if (v === 0) return '0';
    const sign = v < 0 ? '-' : '', a = Math.abs(v), e = exponent(a);
    if (e < width && e > 1 - width) {
      const [int, frac] = fixed(a, Math.max(0, width - (e >= 0 ? e + 1 : 1) - 1));
      const text = stripZeros(`${int || '0'}${frac ? `.${frac}` : ''}`);
      if (int.length <= width && text !== '0') return sign + text;
    }
    let s = a.toExponential(Math.max(0, width - expText(e).length - 2));
    let [m, x] = s.split('e');
    if (expText(Number(x)).length !== expText(e).length) [m, x] = a.toExponential(Math.max(0, width - expText(Number(x)).length - 2)).split('e');
    return `${sign}${stripZeros(m)}${expText(Number(x))}`;
  };
  // A number as text in a formula ("x"&A1, LEN, CONCAT): 15 significant digits, scientific from 1E+20 and below 1E-18.
  const numberText = (v) => {
    if (!Number.isFinite(v)) return '#NUM!';
    if (v === 0) return '0';
    const [m, x] = v.toExponential(14).split('e');
    const e = Number(x);
    if (e >= 20 || e <= -19) return `${stripZeros(m)}${expText(e)}`;
    const [int, frac] = fixed(Math.abs(v), Math.max(0, 14 - e));
    return (v < 0 ? '-' : '') + stripZeros(`${int || '0'}${frac ? `.${frac}` : ''}`);
  };

  // ── Compiling a code ────────────────────────────────────────────────────────────────────────────────────────────────
  const split = (src) => {
    const out = [];
    let cur = '';
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"') { const j = src.indexOf('"', i + 1); if (j < 0) bad('unclosed quote'); cur += src.slice(i, j + 1); i = j; }
      else if (ch === '\\' || ch === '_' || ch === '*') { cur += src.slice(i, i + 2); i++; }
      else if (ch === '[') { const j = src.indexOf(']', i); if (j < 0) bad('unclosed bracket'); cur += src.slice(i, j + 1); i = j; }
      else if (ch === ';') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    if (out.length > 4) bad('more than four sections');
    return out;
  };

  const COND = /^(<=|>=|<>|<|>|=)\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i;
  const DATE_RUN = /^(y+|m+|d+|h+|s+|e)/i;
  const tokenize = (src) => {
    const sec = { tokens: [], color: null, cond: null };
    const push = (t) => sec.tokens.push(t);
    const lit = (s) => { const last = sec.tokens.at(-1); if (last?.k === 'lit') last.s += s; else push({ k: 'lit', s }); };
    for (let i = 0; i < src.length;) {
      const ch = src[i], rest = src.slice(i);
      let m;
      if (ch === '"') { const j = src.indexOf('"', i + 1); lit(src.slice(i + 1, j)); i = j + 1; }
      else if (ch === '\\') { lit(src[i + 1] ?? ''); i += 2; }
      else if (ch === '_') { lit(' '); i += 2; }
      else if (ch === '*') { push({ k: 'fill', ch: src[i + 1] ?? ' ' }); i += 2; }
      else if (ch === '[') {
        const j = src.indexOf(']', i), inner = src.slice(i + 1, j);
        i = j + 1;
        if (/^(h+|m+|s+)$/i.test(inner)) push({ k: 'dt', s: inner[0].toLowerCase(), n: inner.length, elapsed: true });
        else if ((m = COND.exec(inner.trim()))) sec.cond = { op: m[1], v: Number(m[2]) };
        else if (inner[0] === '$') { const text = inner.slice(1).split('-')[0]; if (text) lit(text); }
        else if (Object.hasOwn(COLORS, inner.toLowerCase())) sec.color = COLORS[inner.toLowerCase()];
        else if ((m = /^color\s*(\d{1,2})$/i.exec(inner)) && m[1] >= 1 && m[1] <= 56) sec.color = PALETTE[m[1] - 1];
        else bad(`[${inner}]`);
      }
      else if (/^general/i.test(rest)) { push({ k: 'gen' }); i += 7; }
      else if ((m = /^(am\/pm|a\/p)/i.exec(rest))) { push({ k: 'dt', s: 'ampm', text: m[1] }); i += m[1].length; }
      else if ((m = /^[eE][+-]/.exec(rest))) { push({ k: 'E', s: m[0][0], sign: m[0][1] }); i += 2; }
      else if ((m = DATE_RUN.exec(rest))) { push({ k: 'dt', s: m[1][0].toLowerCase(), n: m[1].length }); i += m[1].length; }
      else if (ch === '0' || ch === '#' || ch === '?') { push({ k: 'd', ch }); i++; }
      else if (ch === '.' || ch === ',' || ch === '%' || ch === '/' || ch === '@') { push({ k: ch }); i++; }
      else { lit(ch); i++; }
    }
    return sec;
  };

  // A date section: m is minutes right after an hour or right before seconds; .0 after seconds is a fraction of one.
  const dateSection = (sec) => {
    const dts = sec.tokens.filter((t) => t.k === 'dt');
    dts.forEach((t, i) => {
      if (t.s !== 'm' || t.elapsed) return;
      if (dts[i - 1]?.s === 'h' || dts[i + 1]?.s === 's') t.s = 'min';
    });
    const out = [];
    for (let i = 0; i < sec.tokens.length; i++) {
      const t = sec.tokens[i];
      if (t.k === '.' && out.at(-1)?.k === 'dt' && out.at(-1).s === 's' && sec.tokens[i + 1]?.k === 'd' && sec.tokens[i + 1].ch === '0') {
        let n = 0;
        while (sec.tokens[i + 1 + n]?.k === 'd' && sec.tokens[i + 1 + n].ch === '0') n++;
        out.push({ k: 'dt', s: 'frac', n: Math.min(n, 3) });
        i += n;
      } else if (t.k === 'dt' || t.k === 'lit' || t.k === 'fill') out.push(t);
      else out.push({ k: 'lit', s: t.k === 'd' ? t.ch : t.k === 'gen' ? 'General' : t.k === 'E' ? t.s + t.sign : t.k });
    }
    sec.tokens = out;
    sec.ampm = out.some((t) => t.s === 'ampm');
    sec.digits = out.find((t) => t.s === 'frac')?.n ?? 0;
    sec.seconds = sec.digits > 0 || out.some((t) => t.s === 's');
    return sec;
  };

  // A number section: which commas group thousands and which scale by 1000, where the point, exponent and fraction are.
  const numberSection = (sec) => {
    const tk = sec.tokens;
    const isD = (t) => t?.k === 'd';
    const lastD = tk.findLastIndex(isD);
    const eAt = tk.findIndex((t) => t.k === 'E');
    const dot = tk.findIndex((t, i) => t.k === '.' && (eAt < 0 || i < eAt));
    const intEnd = dot >= 0 ? dot : eAt >= 0 ? eAt : tk.length;
    sec.pct = 0; sec.scale = 0; sec.group = false;
    tk.forEach((t, i) => {
      if (t.k === '%') { sec.pct++; tk[i] = { k: 'lit', s: '%' }; }
      else if (t.k === ',') {
        if (i > lastD || (i < intEnd && tk.slice(i, intEnd).every((x) => x.k === ','))) { sec.scale++; tk[i] = { k: 'skip' }; }
        else if (i < intEnd && tk.slice(0, i).some(isD) && tk.slice(i + 1, intEnd).some(isD)) { sec.group = true; tk[i] = { k: 'skip' }; }
        else tk[i] = { k: 'lit', s: ',' };
      } else if (t.k === '@') tk[i] = { k: 'gen' };
    });
    if (tk.some((t) => t.k === 'dt')) bad('a date code among digits');
    const slash = tk.findIndex((t, i) => t.k === '/' && tk.slice(0, i).some(isD) && (isD(tk[i + 1]) || /^\d/.test(tk[i + 1]?.s ?? '')));
    if (eAt >= 0) {
      if (!tk.slice(eAt + 1).some(isD)) bad('an exponent without digits');
      sec.kind = 'exp';
      sec.mant = tk.slice(0, dot >= 0 ? dot : eAt);
      sec.frac = dot >= 0 ? tk.slice(dot + 1, eAt) : [];
      sec.dot = dot >= 0;
      sec.e = tk[eAt];
      sec.exp = tk.slice(eAt + 1);
    } else if (slash >= 0) {
      sec.kind = 'frac';
      let n0 = slash;
      while (isD(tk[n0 - 1])) n0--;
      sec.int = tk.slice(0, n0);
      sec.num = tk.slice(n0, slash);
      let end = slash + 1, den = '';
      while (end < tk.length && (isD(tk[end]) || (tk[end].k === 'lit' && /^\d/.test(tk[end].s)))) {
        if (tk[end].k === 'lit') { const d = /^\d+/.exec(tk[end].s)[0]; den += d; if (d.length < tk[end].s.length) { tk.splice(end + 1, 0, { k: 'lit', s: tk[end].s.slice(d.length) }); end++; break; } }
        else den += tk[end].ch;
        end++;
      }
      sec.den = /[1-9]/.test(den) ? { fixed: Number(den.replace(/[#?]/g, '0')), width: den.length } : { slots: tk.slice(slash + 1, end) };
      sec.tail = tk.slice(end);
      sec.hasInt = sec.int.some(isD);
    } else {
      sec.kind = 'num';
      sec.int = tk.slice(0, intEnd);
      sec.dot = dot >= 0;
      sec.frac = dot >= 0 ? tk.slice(dot + 1) : [];
      sec.fracSlots = sec.frac.filter(isD).length;
    }
    return sec;
  };

  const compiled = new Map();
  const compile = (src) => {
    let c = compiled.get(src);
    if (c) return c;
    const sections = split(src).map((s) => {
      const sec = tokenize(s);
      const dts = sec.tokens.filter((t) => t.k === 'dt');
      const onlyE = dts.length && dts.every((t) => t.s === 'e');
      if (dts.length && !(onlyE && sec.tokens.some((t) => t.k === 'd'))) { sec.kind = 'date'; return dateSection(sec); }
      if (onlyE) bad('an exponent without a sign');
      if (sec.tokens.some((t) => t.k === '@')) { sec.kind = 'text'; return sec; }
      if (!sec.tokens.some((t) => t.k === 'd' || t.k === '.' || t.k === 'E')) { sec.kind = 'plain'; return sec; }
      return numberSection(sec);
    });
    const last = sections.at(-1);
    const textAt = sections.length === 4 ? 3 : last.kind === 'text' ? sections.length - 1 : -1;
    c = { sections, textAt, numeric: textAt === sections.length - 1 && sections.length < 4 ? sections.slice(0, -1) : sections.slice(0, 4).filter((s, i) => i !== 3) };
    if (!c.numeric.length) c.numeric = [{ kind: 'plain', tokens: [{ k: 'gen' }], color: null, cond: null }];
    if (compiled.size > 2000) compiled.clear();
    compiled.set(src, c);
    return c;
  };

  // ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const blank = (t) => (t.ch === '0' ? '0' : t.ch === '?' ? ' ' : '');
  // An integer's digits into placeholders interleaved with literals, right to left; the leftmost placeholder takes any
  // digits left over. → pieces; numeric ones are { d } for the thousands separator to count.
  const fillInt = (tokens, digits, group, out) => {
    const slots = tokens.filter((t) => t.k === 'd').length;
    const pieces = new Array(tokens.length);
    let rest = digits, seen = 0;
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t.k !== 'd') { pieces[i] = t; continue; }
      seen++;
      if (rest && seen === slots) { pieces[i] = { d: rest }; rest = ''; }
      else if (rest) { pieces[i] = { d: rest.slice(-1) }; rest = rest.slice(0, -1); }
      else pieces[i] = blank(t) === '0' ? { d: '0' } : { k: 'lit', s: blank(t) };
    }
    if (!slots && digits) pieces.push({ d: digits });
    if (group) {
      let total = pieces.reduce((n, p) => n + (p?.d ? p.d.length : 0), 0);
      for (const p of pieces) {
        if (!p?.d) continue;
        let s = '';
        for (const ch of p.d) { s += ch; total--; if (total > 0 && total % 3 === 0) s += ','; }
        p.d = s;
      }
    }
    for (const p of pieces) if (p) { if (p.d !== undefined) out.push(p.d); else emit(p, out); }
  };
  const emit = (t, out) => { if (t.k === 'lit') out.push(t.s); else if (t.k === 'fill') out.push(t); else if (t.k === '.') out.push('.'); else if (t.k === '/') out.push('/'); };

  // Each renderer → whether the number it wrote shows as anything but zero.
  const renderNum = (sec, a, out, o) => {
    const x = a * 10 ** (2 * sec.pct - 3 * sec.scale);
    const [int, frac] = fixed(x, sec.fracSlots);
    fillInt(sec.int.filter((t) => t.k !== 'skip'), int, sec.group, out);
    const shown = /[1-9]/.test(int + frac);
    if (!sec.dot) return shown;
    out.push('.');
    const lastNonZero = frac.search(/0*$/) - 1;
    let i = 0;
    for (const t of sec.frac) {
      if (t.k === 'd') { out.push(i <= lastNonZero ? frac[i] : blank(t)); i++; }
      else if (t.k === 'gen') out.push(general(a, o.width));
      else emit(t, out);
    }
    return shown;
  };

  const renderExp = (sec, a, out) => {
    const intSlots = sec.mant.filter((t) => t.k === 'd').length;
    const fracSlots = sec.frac.filter((t) => t.k === 'd').length;
    const period = intSlots > 1 && sec.mant.some((t) => t.ch === '#') ? intSlots : 1;
    let e = 0, int = '', frac = '0'.repeat(fracSlots);
    if (a) {
      e = Math.floor(exponent(a) / period) * period;
      [int, frac] = fixed(a / 10 ** e, fracSlots);
      if (int.length > period) { e += period; [int, frac] = fixed(a / 10 ** e, fracSlots); }
    }
    fillInt(sec.mant, int, false, out);
    if (sec.dot) out.push('.');
    let i = 0;
    for (const t of sec.frac) { if (t.k === 'd') out.push(frac[i++]); else emit(t, out); }
    out.push(sec.e.s + (e < 0 ? '-' : sec.e.sign === '+' ? '+' : ''));
    const width = sec.exp.filter((t) => t.ch === '0').length;
    fillInt(sec.exp, String(Math.abs(e)).padStart(width, '0'), false, out);
    return a !== 0;
  };

  // The last continued-fraction convergent with a denominator up to `most`, as Excel 16.114.1 chooses: 0.7 in ?/? is
  // 2/3, not the closer 5/7.
  const convergent = (x, most) => {
    most = Math.min(most, Number.MAX_SAFE_INTEGER);
    if (x === Math.round(x)) return [Math.round(x), 1];
    // Continued fractions bound the work by precision, even with many denominator placeholders.
    let p0 = 0, q0 = 1, p1 = 1, q1 = 0, remainder = x;
    for (let step = 0; step < 64; step++) {
      const a = Math.floor(remainder), q2 = q0 + a * q1;
      if (q2 > most) break;
      const p2 = p0 + a * p1;
      [p0, q0, p1, q1] = [p1, q1, p2, q2];
      if (remainder === a) return [p1, q1];
      remainder = 1 / (remainder - a);
    }
    return [p1, q1];
  };
  const renderFrac = (sec, a, out) => {
    const slots = sec.den.slots;
    let whole = sec.hasInt ? Math.floor(a) : 0;
    const part = a - whole;
    let [p, q] = sec.den.fixed ? [Math.round(part * sec.den.fixed), sec.den.fixed] : convergent(part, 10 ** slots.filter((t) => t.k === 'd').length - 1);
    if (sec.hasInt && p >= q) { whole += Math.floor(p / q); p %= q; }
    const numWidth = sec.num.length + 1 + (sec.den.fixed ? sec.den.width : slots.length);
    fillInt(sec.int, whole ? String(whole) : sec.hasInt && !p ? '0' : '', false, out);
    if (sec.hasInt && !p) { out.push(' '.repeat(numWidth)); for (const t of sec.tail) emit(t, out); return whole !== 0; }
    fillInt(sec.num, String(p), false, out);
    out.push('/');
    if (sec.den.fixed) out.push(String(sec.den.fixed));
    else {
      const ds = String(q);
      let i = 0;
      for (const t of slots) { if (t.k !== 'd') { emit(t, out); continue; } out.push(i < ds.length ? ds[i] : t.ch === '?' ? ' ' : ''); i++; }
      if (ds.length > i) out.push(ds.slice(i));
    }
    for (const t of sec.tail) emit(t, out);
    return whole !== 0 || p !== 0;
  };

  const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const two = (n) => String(n).padStart(2, '0');
  const renderDate = (sec, v, out, o) => {
    const step = 86400 * 10 ** sec.digits;
    const n = Math.round(v * step) / step;
    const t = M.fromSerial(n, o.date1904);
    if (!t) return false;
    const total = Math.round(n * 864e5);
    const elapsedH = sec.tokens.some((x) => x.elapsed && x.s === 'h'), elapsedM = sec.tokens.some((x) => x.elapsed && x.s === 'm');
    for (const x of sec.tokens) {
      if (x.k !== 'dt') { emit(x, out); continue; }
      const len = x.n;
      switch (x.s) {
        case 'y': case 'e': out.push(x.s === 'e' || len > 2 ? String(t.y) : two(t.y % 100)); break;
        case 'm': out.push(x.elapsed ? String(Math.floor(total / 6e4)).padStart(len, '0') : len === 1 ? String(t.m) : len === 2 ? two(t.m)
          : len === 3 ? MONTH[t.m - 1].slice(0, 3) : len === 5 ? MONTH[t.m - 1][0] : MONTH[t.m - 1]); break;
        case 'min': { const mins = elapsedH ? Math.floor(total / 6e4) % 60 : t.M; out.push(len === 1 ? String(mins) : two(mins)); break; }
        case 'd': out.push(len === 1 ? String(t.d) : len === 2 ? two(t.d) : len === 3 ? WEEKDAY[t.dow].slice(0, 3) : WEEKDAY[t.dow]); break;
        case 'h': {
          const h = x.elapsed ? Math.floor(total / 36e5) : sec.ampm ? t.H % 12 || 12 : t.H;
          out.push(String(h).padStart(Math.min(len, 2), '0'));
          break;
        }
        case 's': {
          const s = x.elapsed ? Math.floor(total / 1e3) : elapsedM || elapsedH ? Math.floor(total / 1e3) % 60 : t.S;
          out.push(String(s).padStart(Math.min(len, 2), '0'));
          break;
        }
        case 'frac': out.push(`.${String(t.ms).padStart(3, '0').slice(0, x.n)}`); break;
        case 'ampm': out.push(x.text.length === 3 ? x.text[t.H < 12 ? 0 : 2] : t.H < 12 ? 'AM' : 'PM'); break;
      }
    }
    return true;
  };

  const passes = (cond, v) => {
    switch (cond.op) {
      case '<': return v < cond.v;
      case '<=': return v <= cond.v;
      case '>': return v > cond.v;
      case '>=': return v >= cond.v;
      case '=': return v === cond.v;
      default: return v !== cond.v;
    }
  };
  const choose = (c, v) => {
    const s = c.numeric;
    if (s[0].cond || s[1]?.cond) {
      if (s[0].cond && passes(s[0].cond, v)) return s[0];
      if (s[1]?.cond && passes(s[1].cond, v)) return s[1];
      if (!s[1]?.cond) return s[1] ?? s[0];
      return s[2] ?? (s[0].cond ? null : s[0]);
    }
    return v > 0 || s.length === 1 ? s[0] : v < 0 ? s[1] ?? s[0] : s[2] ?? s[0];
  };

  const finish = (pieces, color) => {
    let text = '', fill = null;
    for (const p of pieces) {
      if (typeof p === 'string') text += p;
      else if (!fill) fill = { at: text.length, ch: p.ch };
    }
    return { text, color, fill };
  };

  // → { text, color (#RRGGBB or null), fill ({ at, ch }: where a * repeats its character to fill the cell, or null) },
  // or null when the value can't show in the format (a date before the epoch or past 9999). Throws (code 'format') on
  // a malformed code. o: { date1904, width (General's characters, 11 by default) }.
  const render = (v, fmt, o = {}) => {
    const c = compile(code(fmt));
    if (v === null || v === undefined || v === '') return { text: '', color: null, fill: null };
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', color: null, fill: null };
    if (typeof v === 'string') {
      const sec = c.textAt >= 0 ? c.sections[c.textAt] : null;
      if (!sec) return { text: v, color: null, fill: null };
      const out = [];
      for (const t of sec.tokens) {
        if (t.k === '@') out.push(v);
        else if (t.k === 'd') out.push(t.ch);
        else if (t.k === 'dt') out.push('');
        else emit(t, out);
      }
      return finish(out, sec.color);
    }
    if (!Number.isFinite(v)) return { text: '#NUM!', color: null, fill: null };
    const sec = choose(c, v);
    if (!sec) return null;
    // One section shows the minus sign itself, unless the number shows as zero (Excel 16.114.1: -0.4 as 0 is "0"); with
    // more, the section chosen for a negative number writes its own.
    const conditional = c.numeric[0].cond || c.numeric[1]?.cond;
    const signed = conditional ? !sec.cond : c.numeric.length === 1;
    const a = Math.abs(v);
    const out = [];
    if (sec.kind === 'date') {
      if (v < 0 || !renderDate(sec, v, out, o)) return null;
      return finish(out, sec.color);
    }
    let shown = a !== 0;
    if (sec.kind === 'num') shown = renderNum(sec, a, out, o);
    else if (sec.kind === 'exp') shown = renderExp(sec, a, out);
    else if (sec.kind === 'frac') shown = renderFrac(sec, a, out);
    else for (const t of sec.tokens) { if (t.k === 'gen') out.push(general(a, o.width)); else emit(t, out); }
    if (signed && v < 0 && shown) out.unshift('-');
    return finish(out, sec.color);
  };
  const format = (v, fmt, o) => render(v, fmt, o)?.text ?? null;
  // Whether a format shows dates or times (its first section has date codes).
  const isDate = (fmt) => { try { return compile(code(fmt)).sections[0].kind === 'date'; } catch { return false; } };

  return { BUILTIN, PALETTE, COLORS, builtin, idOf, code, format, render, general, numberText, isDate, compile };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_NUMFMT; else GZ_SHEET_NUMFMT;
