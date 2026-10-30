// The spreadsheet grid of Documents (sheet-kind.js mounts it): its pure parts first (offsets, selection, the data edge,
// fill series, the clipboard's TSV and HTML), then the grid itself (mount): a virtualized DOM of pooled cells in four
// frozen quadrants over one native scroller, the formula bar, sheet tabs, menus, find and replace, and the status bar.
// Every change is an operation of the workbook model (lib/sheet-model.js) applied through the calc engine
// (lib/sheet-calc.js), whose inverse is the undo step and whose changed cells mark the parts the next autosave writes
// (sheet-data.js plan). parseDelimited and writeDelimited are adapted from Rimeward's notebook-spreadsheet.ts (MIT, the
// same owner), as are the keyboard and clipboard handlers' shapes.
// Classic script; module.exports for node.
var GZ_SHEET_GRID = globalThis.GZ_SHEET_GRID || (() => {
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./lib/sheet-model.js');
  const FX = () => (typeof GZ_SHEET_FORMULA !== 'undefined' ? GZ_SHEET_FORMULA : require('./lib/sheet-formula.js'));

  // ---- offsets: a Fenwick tree of each index's size beyond the base, so a row's top and the row under a pixel are a few
  // steps among a million rows. A hidden row or column is size 0.
  class Sizes {
    constructor(n, base, sizes = null) { this.base = base; this.own = new Map(sizes || []); this.grow(n); }
    grow(n) {
      this.n = n;
      const t = new Float64Array(n + 1);
      for (const [i, px] of this.own) if (i >= 0 && i < n) t[i + 1] += px - this.base;
      for (let i = 1; i <= n; i++) { const j = i + (i & -i); if (j <= n) t[j] += t[i]; }
      this.t = t;
    }
    size(i) { return this.own.has(i) ? this.own.get(i) : this.base; }
    set(i, px) {
      if (i < 0 || i >= this.n) return;
      const d = px - this.size(i);
      if (px === this.base) this.own.delete(i); else this.own.set(i, px);
      for (let j = i + 1; j <= this.n; j += j & -j) this.t[j] += d;
    }
    // The pixels before index i.
    offset(i) {
      i = Math.max(0, Math.min(i, this.n));
      let s = this.base * i;
      for (let j = i; j > 0; j -= j & -j) s += this.t[j];
      return s;
    }
    total() { return this.offset(this.n); }
    // The index whose span holds pixel px (the last of a run of hidden ones before it never is).
    at(px) {
      if (px <= 0) return this.firstShown(0);
      const total = this.total();
      // Keep the binary search inside the last positive span, even if the end of the axis is hidden.
      px = Math.min(px, total - Number.EPSILON * Math.max(1, total));
      let pos = 0, left = px;
      for (let step = 1 << Math.floor(Math.log2(this.n || 1)); step; step >>= 1) {
        const next = pos + step;
        if (next <= this.n) { const span = this.t[next] + this.base * step; if (span <= left) { pos = next; left -= span; } }
      }
      return Math.min(pos, this.n - 1);
    }
    firstShown(i) { while (i < this.n - 1 && this.size(i) === 0) i++; return i; }
  }
  // Excel's units: a column's width as a file's <col width> says it (characters of a 7 px digit, with 5 px of padding), a
  // row's height in points.
  const MDW = 7;
  const px = {
    col: (w) => (Number.isFinite(w) ? Math.max(0, Math.trunc(((256 * w + Math.trunc(128 / MDW)) / 256) * MDW)) : 64),
    toCol: (p) => { const chars = Math.trunc(((p - 5) / MDW) * 100 + 0.5) / 100; return Math.trunc(((chars * MDW + 5) / MDW) * 256) / 256; },
    row: (pt) => (Number.isFinite(pt) ? Math.max(0, Math.round((pt * 4) / 3)) : 20),
    toRow: (p) => Math.round(p * 75) / 100,
  };

  // ---- selection: ranges { r0, c0, r1, c1 }, the active cell and the anchor Shift extends from
  const range = (r0, c0, r1 = r0, c1 = c0) => ({ r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) });
  const inside = (g, r, c) => r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;
  // extend: from the anchor to (r, c), the active cell kept; add: another range (Ctrl), active there.
  const select = (sel, r, c, { extend = false, add = false } = {}) => {
    if (!sel || (!extend && !add)) return { active: [r, c], anchor: [r, c], ranges: [range(r, c)] };
    if (add) return { active: [r, c], anchor: [r, c], ranges: [...sel.ranges, range(r, c)] };
    const [ar, ac] = sel.anchor;
    return { active: sel.active, anchor: sel.anchor, ranges: [...sel.ranges.slice(0, -1), range(ar, ac, r, c)] };
  };
  // The corner of the last range Shift+arrow moves: the one across from the anchor.
  const end = (sel) => { const g = sel.ranges[sel.ranges.length - 1], [ar, ac] = sel.anchor; return [ar === g.r0 ? g.r1 : g.r0, ac === g.c0 ? g.c1 : g.c0]; };
  const bounds = (ranges) => ranges.reduce((b, g) => ({ r0: Math.min(b.r0, g.r0), c0: Math.min(b.c0, g.c0), r1: Math.max(b.r1, g.r1), c1: Math.max(b.c1, g.c1) }), { ...ranges[0] });
  const count = (ranges) => ranges.reduce((n, g) => n + (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1), 0);
  const name = (g) => M.rangeName(g.r0, g.c0, g.r1, g.c1);
  // Where Ctrl+arrow goes: inside a run of filled cells to its end; else to the next filled one, or the sheet's edge.
  const edge = (has, r, c, dr, dc, lim) => {
    const ok = (a, b) => a >= 0 && b >= 0 && a < lim.rows && b < lim.cols;
    if (!ok(r + dr, c + dc)) return [r, c];
    if (has(r, c) && has(r + dr, c + dc)) {
      while (ok(r + dr, c + dc) && has(r + dr, c + dc)) { r += dr; c += dc; }
      return [r, c];
    }
    do { r += dr; c += dc; } while (ok(r + dr, c + dc) && !has(r, c));
    return [r, c];
  };

  // ---- fill: what the fill handle (or Ctrl+D, Ctrl+R) writes past the source cells along its way
  const DAYS = [['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'], ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']];
  const MONTHS = [['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'],
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']];
  const LISTS = [...DAYS, ...MONTHS];
  const caseOf = (s) => (s === s.toUpperCase() ? 'up' : s === s.toLowerCase() ? 'low' : 'cap');
  const inCase = (s, k) => (k === 'up' ? s.toUpperCase() : k === 'low' ? s : s[0].toUpperCase() + s.slice(1));
  const TAIL = /^(.*?)(-?\d+)(\D*)$/;
  const steady = (xs) => xs.every((x, i) => i === 0 || Math.abs(x - xs[i - 1] - (xs[1] - xs[0])) < 1e-12);
  // A source column or row (cells or null) and how many cells come after it. o: back (up or left: the series runs the other
  // way, the nearest cell first), dr and dc (one step of the fill's way, for moving formulas), isDate(cell). → [{ cell, from }]
  // where from is the source the copy came from.
  const fill = (src, n, o = {}) => {
    const L = src.length, back = o.back === true;
    const pos = (k) => (back ? -1 - k : L + k);
    const fromOf = (k) => { const p = pos(k); return ((p % L) + L) % L; };
    const kinds = src.map((x) => (!x ? 'empty' : x.f !== undefined ? 'f' : x.t));
    let value = null;
    if (kinds.every((k) => k === 'n')) {
      const ys = src.map((x) => x.v);
      if (L === 1) { if (o.isDate?.(src[0])) value = (p) => ys[0] + p; }
      else if (steady(ys)) value = (p) => ys[0] + (ys[1] - ys[0]) * p;
      else {
        const mx = (L - 1) / 2, my = ys.reduce((a, b) => a + b, 0) / L;
        const b = ys.reduce((s, y, i) => s + (i - mx) * (y - my), 0) / ys.reduce((s, _, i) => s + (i - mx) ** 2, 0);
        value = (p) => my + b * (p - mx);
      }
    } else if (kinds.every((k) => k === 's')) {
      const list = LISTS.find((l) => src.every((x) => l.includes(x.v.toLowerCase())));
      const m = !list && src.map((x) => TAIL.exec(x.v));
      if (list) {
        const at = src.map((x) => list.indexOf(x.v.toLowerCase())), step = L === 1 ? 1 : (at[1] - at[0] + list.length) % list.length;
        const ok = L === 1 || at.every((x, i) => i === 0 || (x - at[i - 1] + list.length) % list.length === step);
        if (ok) { const k = caseOf(src[0].v); value = (p) => inCase(list[(((at[0] + step * p) % list.length) + list.length) % list.length], k); }
      } else if (m && m.every((x) => x && x[1] === m[0][1] && x[3] === m[0][3])) {
        const nums = m.map((x) => Number(x[2])), width = m[0][2].replace(/^-/, '').length, step = L === 1 ? 1 : nums[1] - nums[0];
        if (L === 1 || steady(nums)) value = (p) => { const n = nums[0] + step * p; return `${m[0][1]}${n < 0 ? '-' : ''}${String(Math.abs(n)).padStart(width, '0')}${m[0][3]}`; };
      }
    }
    const out = [];
    for (let k = 0; k < n; k++) {
      const from = fromOf(k), x = src[from];
      if (!x) { out.push({ cell: null, from }); continue; }
      if (value) { out.push({ cell: { ...x, v: value(pos(k)) }, from }); continue; }
      if (x.f !== undefined) {
        const dist = Math.abs(pos(k) - from);
        out.push({ cell: { ...x, f: FX().move(x.f, (o.dr || 0) * dist, (o.dc || 0) * dist) }, from });
      } else out.push({ cell: { ...x }, from });
    }
    return out;
  };

  // ---- the clipboard and delimited files
  // Fields of text by a delimiter: double quotes around a field that holds one, doubled quotes inside, CRLF or LF rows, a
  // BOM dropped, no empty row after a final line break. Adapted from Rimeward's parseDelimited.
  const parseDelimited = (text, delimiter) => {
    text = String(text ?? '').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '"' && (quoted || field === '')) { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
      else if (!quoted && (ch === delimiter || ch === '\n' || ch === '\r')) {
        row.push(field); field = '';
        if (ch !== delimiter) { rows.push(row); row = []; if (ch === '\r' && text[i + 1] === '\n') i++; }
      } else field += ch;
    }
    if (quoted) throw new Error('a quoted field is missing its closing quote');
    if (field || row.length || !rows.length) { row.push(field); rows.push(row); }
    return rows;
  };
  const writeDelimited = (rows, delimiter) => rows.map((row) => row.map((v) => (/["\r\n]/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v)).join(delimiter)).join('\r\n');
  // A CSV's delimiter: the one of , ; and tab its first line has most of.
  const sniff = (text) => { const line = String(text).replace(/^﻿/, '').split(/\r?\n/, 1)[0]; return [',', ';', '\t'].map((d) => [d, line.split(d).length]).sort((a, b) => b[1] - a[1])[0][0]; };
  const sig = (s) => { s = String(s).replace(/\r\n?/g, '\n').replace(/\n$/, ''); let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // What a copy puts on the clipboard: the shown text as TSV (a field quoted only for a tab, a line break or a leading quote,
  // as Excel does) and as an HTML table. rows: [[{ text }]].
  const copy = (rows) => {
    const tsv = rows.map((row) => row.map((x) => { const v = String(x?.text ?? ''); return /[\t\r\n]/.test(v) || v.startsWith('"') ? `"${v.replace(/"/g, '""')}"` : v; }).join('\t')).join('\r\n');
    const html = `<table>${rows.map((row) => `<tr>${row.map((x) => `<td>${esc(x?.text ?? '')}</td>`).join('')}</tr>`).join('')}</table>`;
    return { tsv, html };
  };
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const unent = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
  const attrsOf = (s) => { const o = {}; for (const m of s.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) o[m[1].toLowerCase()] = unent(m[2] ?? m[3] ?? m[4] ?? ''); return o; };
  const NAMED = { percent: '0%', fixed: '0.00', standard: '#,##0.00', 'short date': 'm/d/yyyy', 'long date': 'dddd, mmmm d, yyyy', general: 'General', scientific: '0.00E+00', currency: '$#,##0.00' };
  const msoFormat = (v) => {
    let s = String(v).trim().replace(/^(["'])(.*)\1$/, '$2');
    if (Object.hasOwn(NAMED, s.toLowerCase())) return NAMED[s.toLowerCase()];
    s = s.replace(/\\(.)/g, '$1');
    return s || null;
  };
  const msoOf = (css) => { const m = /mso-number-format\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;]+)/i.exec(css || ''); return m ? msoFormat(m[1]) : null; };
  // A pasted HTML table (Excel's, Google Sheets', a page's) as rows of { text, fmt?, value?, formula? }: fmt Excel's
  // mso-number-format (inline or by class), value and formula Sheets' data-sheets-value and data-sheets-formula (R1C1).
  // No DOM: a tokenizer over the markup, scripts and styles never text. → null when it holds no table cell.
  const parseHTML = (html) => {
    html = String(html ?? '').replace(/<!--[^]*?-->/g, '');
    const classes = new Map();
    for (const m of html.matchAll(/<style[^>]*>([^]*?)<\/style>/gi)) for (const r of m[1].matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) { const f = msoOf(r[2]); if (f) classes.set(r[1], f); }
    html = html.replace(/<(script|style|head)\b[^]*?<\/\1\s*>/gi, '');
    const rows = [];
    let row = null, cell = null;
    const close = () => {
      if (!cell) return;
      const text = cell.text.replace(/[ \t\r\n\f]+/g, ' ').replace(/ ?\u2028 ?/g, '\n').trim();
      const a = cell.attrs, x = { text };
      const fmt = msoOf(a.style) || String(a.class || '').split(/\s+/).map((c) => classes.get(c)).find(Boolean);
      if (fmt) x.fmt = fmt;
      if (a['data-sheets-value']) {
        try { const v = JSON.parse(a['data-sheets-value']); if (v[1] === 3 && Number.isFinite(v[3])) x.value = v[3]; else if (v[1] === 2 && typeof v[2] === 'string') x.value = v[2]; else if (v[1] === 4) x.value = !!v[4]; } catch { /* the shown text stands */ }
      }
      if (typeof a['data-sheets-formula'] === 'string' && a['data-sheets-formula'].startsWith('=')) x.formula = a['data-sheets-formula'].slice(1);
      row.push(x);
      for (let i = 1; i < Math.min(Number(a.colspan) || 1, 256); i++) row.push({ text: '' });
      cell = null;
    };
    for (const m of html.matchAll(/<(\/?)([a-z][\w:-]*)([^>]*)>|([^<]+)/gi)) {
      if (m[4] !== undefined) { if (cell) cell.text += unent(m[4]); continue; }
      const tag = m[2].toLowerCase(), shut = m[1] === '/';
      if (tag === 'tr') { close(); if (!shut) rows.push((row = [])); else row = null; }
      else if (tag === 'td' || tag === 'th') { close(); if (!shut) { if (!row) rows.push((row = [])); cell = { text: '', attrs: attrsOf(m[3]) }; } }
      else if (tag === 'br' && cell) cell.text += '\u2028';
      else if (tag === 'table' && shut) { close(); row = null; }
    }
    close();
    const out = rows.filter((r) => r.length);
    return out.length ? out : null;
  };
  // Google Sheets' R1C1 formula as A1 at the cell (r, c) it lands in.
  const fromR1C1 = (text, r, c) => String(text).split(/("(?:[^"]|"")*")/).map((part, i) => (i % 2 ? part : part.replace(/(?<![A-Za-z0-9_.$])R(\[-?\d+\]|\d+)?C(\[-?\d+\]|\d+)?(?![A-Za-z0-9_(])/g, (m, R, C) => {
    const one = (v, at) => (v === undefined ? [at, false] : v[0] === '[' ? [at + Number(v.slice(1, -1)), false] : [Number(v) - 1, true]);
    const [rr, ar] = one(R, r), [cc, ac] = one(C, c);
    if (rr < 0 || cc < 0 || rr >= M.MAX_ROWS || cc >= M.MAX_COLS) return '#REF!';
    return `${ac ? '$' : ''}${M.columnName(cc)}${ar ? '$' : ''}${rr + 1}`;
  }))).join('');

  // ---- the grid on the page
  const SVG = 'http://www.w3.org/2000/svg';
  // An element: 'class' and 'text' as themselves, on* as listeners, anything else an attribute (true: present).
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };
  const btn = (props, ...kids) => h('button', { type: 'button', ...props }, ...kids);
  const PATHS = {
    undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3', dots: 'M5 12h.01M12 12h.01M19 12h.01', caret: 'm6 9 6 6 6-6',
    az: 'M4 18V6M1 9l3-3 3 3M11 7h6l-6 8h6M11 19h7', za: 'M4 6v12M1 15l3 3 3-3M11 7h6l-6 8h6M11 19h7', find: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
    freeze: 'M4 4h16v16H4zM4 9h16M9 4v16', clock: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', plus: 'M12 5v14M5 12h14', close: 'M6 6l12 12M18 6 6 18',
    up: 'm18 15-6-6-6 6', down: 'm6 9 6 6 6-6', num: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
  };
  const icon = (name) => { const s = document.createElementNS(SVG, 'svg'), p = document.createElementNS(SVG, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'gp-ico'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', PATHS[name]); s.append(p); return s; };
  const HW = 46, HH = 24, OVER = 2, MIN_ROWS = 1000, MIN_COLS = 26, MORE_ROWS = 200, MORE_COLS = 6, MAX_PX = 15e6, BAND = 1000;
  const UNDO = { steps: 200, bytes: 8e6 }, EVERY = 10 * 60e3, BIG = 1000;
  const REF_COLORS = ['#2563eb', '#dc2626', '#7c3aed', '#059669', '#d97706', '#db2777'];
  const FORMATS = [['General', 'General'], ['Number', '#,##0.00'], ['Currency', '$#,##0.00'], ['Percent', '0.00%'], ['Date', 'm/d/yyyy'], ['Time', 'h:mm AM/PM'], ['Text', '@']];
  // Signatures for the commonest functions; the rest show their count of arguments.
  const SIGS = {
    SUM: 'number1, [number2], …', AVERAGE: 'number1, [number2], …', COUNT: 'value1, [value2], …', COUNTA: 'value1, [value2], …', MIN: 'number1, [number2], …', MAX: 'number1, [number2], …',
    IF: 'logical_test, [value_if_true], [value_if_false]', IFERROR: 'value, value_if_error', IFS: 'logical_test1, value_if_true1, …', AND: 'logical1, [logical2], …', OR: 'logical1, [logical2], …', NOT: 'logical',
    VLOOKUP: 'lookup_value, table_array, col_index_num, [range_lookup]', HLOOKUP: 'lookup_value, table_array, row_index_num, [range_lookup]', XLOOKUP: 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]',
    INDEX: 'array, row_num, [column_num]', MATCH: 'lookup_value, lookup_array, [match_type]', SUMIF: 'range, criteria, [sum_range]', SUMIFS: 'sum_range, criteria_range1, criteria1, …', COUNTIF: 'range, criteria', COUNTIFS: 'criteria_range1, criteria1, …',
    AVERAGEIF: 'range, criteria, [average_range]', ROUND: 'number, num_digits', ROUNDUP: 'number, num_digits', ROUNDDOWN: 'number, num_digits', ABS: 'number', SQRT: 'number', POWER: 'number, power', MOD: 'number, divisor',
    CONCAT: 'text1, [text2], …', CONCATENATE: 'text1, [text2], …', TEXTJOIN: 'delimiter, ignore_empty, text1, …', TEXT: 'value, format_text', LEFT: 'text, [num_chars]', RIGHT: 'text, [num_chars]', MID: 'text, start_num, num_chars', LEN: 'text',
    TRIM: 'text', UPPER: 'text', LOWER: 'text', TODAY: '', NOW: '', DATE: 'year, month, day', YEAR: 'serial_number', MONTH: 'serial_number', DAY: 'serial_number', PMT: 'rate, nper, pv, [fv], [type]',
    STDEV: 'number1, [number2], …', MEDIAN: 'number1, [number2], …', RANK: 'number, ref, [order]', LARGE: 'array, k', SMALL: 'array, k',
  };

  // o: { key, wb, rec, sigs, fresh, t, locale, papers, show (wb → a cell's shown text), local, fileOf (wb, title → { name,
  // mime, bytes }), download (that file), exportLabel, host }. host: an assignment's frame (writer-kinds.js view): { mount,
  // title, tools }, the grid in mount under the assignment's title with the frame's tools (Submit…) before ⋯, no way back to
  // Documents. → { pages, say, ready, save (→ whether all is saved), file (→ { bytes, mime, ext, name }) }.
  const mount = (o) => {
    const { key, t, papers } = o;
    const NF = GZ_SHEET_NUMFMT, CALC = GZ_SHEET_CALC, SD = GZ_SHEET_DATA, F = FX();
    let wb = o.wb, eng = null, sigs = o.sigs || new Map(), rec = o.rec, fresh = !!o.fresh;
    const begin = () => { eng = CALC.engine(wb); eng.recalc(); };
    begin();
    // A workbook kept with a hidden sheet active (a file's) opens on the first one shown.
    if (wb.sheets[wb.active]?.keep?.hidden) wb.active = Math.max(0, wb.sheets.findIndex((x) => !x.keep?.hidden));
    const S = () => wb.sheets[wb.active] || wb.sheets[0];
    const shown0 = () => o.show(wb);
    const root = document.documentElement;
    const isField = (el) => !!el?.closest?.('input, textarea, select');

    // ---- the chrome: Documents and the title; the toolbar; the formula bar; the grid; the sheet tabs; the status bar
    const state = h('span', { class: 'gp-state' });
    const titleText = rec?.title || '';
    const host = o.host || null;
    const titleIn = o.local && !host ? h('input', { id: 'gx-title', class: 'gp-title-in', type: 'text', maxlength: '120', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Title') }) : null;
    if (titleIn) { titleIn.value = titleText || t('Untitled document'); titleIn.size = Math.max(4, titleIn.value.length + 1); }
    const back = host ? null : h('a', { href: 'papers.html', text: t('Documents') });
    const top = h('header', { class: 'gp-top' }, back, h('h1', {}, titleIn || (host?.title?.() || titleText || t('Untitled document'))), h('span', { class: 'grow' }), state);
    const tb = (id, label, name, more = {}) => btn({ id, class: 'gp-tbtn gx-tb', 'aria-label': label, title: label, ...more }, icon(name));
    const undoB = tb('gx-undo', t('Undo'), 'undo'), redoB = tb('gx-redo', t('Redo'), 'redo');
    const fmtB = btn({ id: 'gx-format', class: 'gp-tbtn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('Number format') }, icon('num'), h('span', { class: 'gx-lbl', text: t('General') }), icon('caret'));
    const azB = tb('gx-sort-az', t('Sort A to Z'), 'az'), zaB = tb('gx-sort-za', t('Sort Z to A'), 'za');
    const freezeB = btn({ id: 'gx-freeze', class: 'gp-tbtn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('Freeze') }, icon('freeze'), h('span', { class: 'gx-lbl', text: t('Freeze') }), icon('caret'));
    const findB = tb('gx-find-b', t('Find'), 'find', { 'aria-pressed': 'false' });
    const versB = btn({ id: 'gx-versions', class: 'gp-tbtn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('Versions') }, icon('clock'), h('span', { class: 'gx-lbl', text: t('Versions') }));
    const moreB = tb('gx-more', t('More'), 'dots', { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    const sep = () => h('span', { class: 'gp-sepv' });
    const tool = h('div', { class: 'gp-tool gx-tool', role: 'toolbar', 'aria-label': t('Spreadsheet') }, undoB, redoB, sep(), fmtB, sep(), azB, zaB, freezeB, sep(), findB, h('span', { class: 'grow' }), versB, ...(host?.tools || []), moreB);
    const nameIn = h('input', { id: 'gx-name', class: 'gx-name', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Name box') });
    const fx = h('input', { id: 'gx-formula', class: 'gx-fx', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Formula') });
    const fbar = h('div', { class: 'gx-bar' }, nameIn, fx);
    const findQ = h('input', { id: 'gx-find-q', type: 'search', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Find'), placeholder: t('Find') });
    const findN = h('span', { id: 'gx-find-n', class: 'gx-find-n', 'aria-live': 'polite' });
    const repQ = h('input', { id: 'gx-rep-q', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Replace with'), placeholder: t('Replace with') });
    const findPrev = btn({ class: 'gp-tbtn gx-tb', 'aria-label': t('Previous'), title: t('Previous') }, icon('up')), findNext = btn({ class: 'gp-tbtn gx-tb', 'aria-label': t('Next'), title: t('Next') }, icon('down'));
    const repOne = btn({ id: 'gx-rep-one', class: 'gp-tbtn' }, t('Replace')), repAll = btn({ id: 'gx-rep-all', class: 'gp-tbtn' }, t('Replace all'));
    const findX = btn({ class: 'gp-tbtn gx-tb', 'aria-label': t('Close'), title: t('Close') }, icon('close'));
    const findBar = h('div', { id: 'gx-find', class: 'gx-find', role: 'search', hidden: true }, findQ, findN, findPrev, findNext, repQ, repOne, repAll, findX);

    const gridEl = h('div', { id: 'gx-grid', class: 'gx-grid', role: 'grid', tabindex: '0', 'aria-multiselectable': 'true' });
    const pane = (cls, fr, fc) => { const inner = h('div', { class: 'gx-in' }), ov = h('div', { class: 'gx-ov', 'aria-hidden': 'true' }); const el = h('div', { class: `gx-pane gx-q ${cls}`, role: 'rowgroup' }, inner); inner.append(ov); return { el, inner, ov, fr, fc, rows: new Map() }; };
    const Q = { tl: pane('gx-tl', true, true), tr: pane('gx-tr', true, false), bl: pane('gx-bl', false, true), br: pane('gx-br', false, false) };
    const head = (cls, axis, frozen) => { const inner = h('div', { class: 'gx-in' }); const el = h('div', { class: `gx-pane gx-head ${cls}`, 'aria-hidden': 'true' }, inner); return { el, inner, axis, frozen, cells: new Map() }; };
    const HD = { chf: head('gx-ch', 'col', true), chs: head('gx-ch', 'col', false), rhf: head('gx-rh', 'row', true), rhs: head('gx-rh', 'row', false) };
    const corner = h('div', { class: 'gx-corner', 'aria-hidden': 'true' });
    const space = h('div', { class: 'gx-space' }), scroller = h('div', { class: 'gx-scroll', 'aria-hidden': 'true' }, space);
    const editor = h('textarea', { id: 'gx-edit', class: 'gx-edit', hidden: true, rows: '1', spellcheck: 'false', autocomplete: 'off', 'aria-label': t('Cell') });
    const complete = h('ul', { id: 'gx-complete', class: 'pop gx-complete', role: 'listbox', hidden: true, 'aria-label': t('Functions') });
    const sigEl = h('div', { class: 'pop gx-sig', hidden: true, 'aria-live': 'polite' });
    gridEl.append(...Object.values(Q).map((p) => p.el), ...Object.values(HD).map((p) => p.el), corner, scroller, editor, complete, sigEl);
    const live = h('p', { id: 'gx-live', class: 'gx-sr', 'aria-live': 'polite' });
    const tabs = h('div', { id: 'gx-tabs', class: 'gx-tabs', role: 'tablist', 'aria-label': t('Sheets') });
    const addB = btn({ id: 'gx-add', class: 'gp-tbtn gx-tb', 'aria-label': t('Add sheet'), title: t('Add sheet') }, icon('plus'));
    const circ = h('span', { id: 'gx-circ', class: 'gx-circ' }), said = h('span', { class: 'gx-said', role: 'status' }), stats = h('span', { id: 'gx-sum', class: 'gx-sum' });
    const status = h('div', { id: 'gx-status', class: 'gp-status gx-status' }, circ, said, h('span', { class: 'grow' }), stats);
    const view = h('div', { class: 'gp gp-standalone gx' }, top, tool, fbar, findBar, h('div', { class: 'gx-wrap' }, gridEl, live), h('div', { class: 'gx-tabbar' }, addB, tabs), status);
    (host?.mount || document.body).append(view);
    // The one style read: the grid's font, for measuring text to fit a column.
    const css = getComputedStyle(gridEl), font = `${css.fontSize} ${css.fontFamily}`;
    let sayTimer = 0;
    const say = (text) => { said.textContent = text || ''; clearTimeout(sayTimer); if (text) sayTimer = setTimeout(() => { said.textContent = ''; }, 6000); };

    // ---- the sheet's room: its used range and a margin, grown as it is scrolled or reached (a page can't be 17.9M px)
    const rooms = new Map();
    const used = (sh) => { let r = 0, c = 0; for (const [ri, row] of sh.rows) if (row.size) { r = Math.max(r, ri + 1); for (const ci of row.keys()) c = Math.max(c, ci + 1); } return { r, c }; };
    const MAX_VIEW_ROWS = Math.min(M.MAX_ROWS, Math.floor(MAX_PX / 20)), MAX_VIEW_COLS = Math.min(M.MAX_COLS, Math.floor(MAX_PX / 64));
    let R = null, C = null, ext = null;
    const sizes = () => {
      const sh = S();
      const u = used(sh), had = rooms.get(sh.id) || { rows: 0, cols: 0 };
      ext = { rows: Math.min(MAX_VIEW_ROWS, Math.max(had.rows, MIN_ROWS, u.r + MORE_ROWS)), cols: Math.min(MAX_VIEW_COLS, Math.max(had.cols, MIN_COLS, u.c + MORE_COLS)) };
      rooms.set(sh.id, ext);
      const rs = new Map([...sh.rowH].map(([i, v]) => [i, px.row(v)])), cs = new Map([...sh.colW].map(([i, v]) => [i, px.col(v)]));
      for (const i of sh.hidden.rows) rs.set(i, 0);
      for (const i of sh.hidden.cols) cs.set(i, 0);
      R = new Sizes(ext.rows, 20, rs); C = new Sizes(ext.cols, 64, cs);
    };
    const reach = (r, c) => {
      const need = { rows: Math.min(MAX_VIEW_ROWS, Math.max(ext.rows, r + MORE_ROWS)), cols: Math.min(MAX_VIEW_COLS, Math.max(ext.cols, c + MORE_COLS)) };
      if (need.rows === ext.rows && need.cols === ext.cols) return;
      ext = need; rooms.set(S().id, ext);
      R.grow(ext.rows); C.grow(ext.cols);
      layout();
    };

    // ---- selection, per sheet
    const sels = new Map();
    let sel = select(null, 0, 0);
    const clampRC = (r, c) => [Math.max(0, Math.min(r, ext.rows - 1)), Math.max(0, Math.min(c, ext.cols - 1))];

    // ---- geometry: frozen panes, the panes' places, the scroller's room
    let FR = 0, FC = 0, FW = 0, FH = 0, vw = 0, vh = 0, sL = 0, sT = 0;
    const place = (el, x, y, w, hh) => { el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.width = `${Math.max(0, w)}px`; el.style.height = `${Math.max(0, hh)}px`; };
    const layout = () => {
      const fz = S().freeze;
      FR = Math.min(Math.max(0, fz?.rows | 0), ext.rows - 1); FC = Math.min(Math.max(0, fz?.cols | 0), ext.cols - 1);
      FW = C.offset(FC); FH = R.offset(FR);
      vw = scroller.clientWidth || gridEl.clientWidth; vh = scroller.clientHeight || gridEl.clientHeight;
      place(Q.tl.el, HW, HH, FW, FH); place(Q.tr.el, HW + FW, HH, vw - HW - FW, FH); place(Q.bl.el, HW, HH + FH, FW, vh - HH - FH); place(Q.br.el, HW + FW, HH + FH, vw - HW - FW, vh - HH - FH);
      place(HD.chf.el, HW, 0, FW, HH); place(HD.chs.el, HW + FW, 0, vw - HW - FW, HH); place(HD.rhf.el, 0, HH, HW, FH); place(HD.rhs.el, 0, HH + FH, HW, vh - HH - FH);
      place(corner, 0, 0, HW, HH);
      space.style.width = `${HW + C.total()}px`; space.style.height = `${HH + R.total()}px`;
      for (const p of Object.values(Q)) p.el.hidden = (p.fr && !FR) || (p.fc && !FC);
      HD.chf.el.hidden = !FC; HD.rhf.el.hidden = !FR;
      gridEl.setAttribute('aria-rowcount', String(ext.rows)); gridEl.setAttribute('aria-colcount', String(ext.cols));
      gridEl.setAttribute('aria-label', S().name);
    };
    // A cell's place in a pane (frozen axes not scrolled), and on the grid's face.
    const lx = (p, c) => C.offset(c) - (p.fc ? 0 : FW), ly = (p, r) => R.offset(r) - (p.fr ? 0 : FH);
    const sx = (c) => HW + C.offset(c) - (c < FC ? 0 : sL), sy = (r) => HH + R.offset(r) - (r < FR ? 0 : sT);
    const paneOf = (r, c) => (r < FR ? (c < FC ? Q.tl : Q.tr) : (c < FC ? Q.bl : Q.br));

    // ---- what a cell shows
    const fmtOf = (x) => wb.styles[x?.s ?? 0]?.fmt;
    const charsOf = (c) => Math.max(1, Math.floor((C.size(c) - 5) / 7));
    const display = (x, c) => {
      if (!x) return null;
      if (x.t === 'n') {
        let out = null;
        try { out = NF.render(x.v, fmtOf(x), { date1904: wb.date1904, width: charsOf(c) }); } catch { out = { text: String(x.v), color: null }; }
        return { text: out ? out.text : '#######', color: out?.color || null, kind: 'n' };
      }
      if (x.t === 'b') return { text: x.v ? 'TRUE' : 'FALSE', kind: 'b' };
      if (x.t === 'e') return { text: String(x.v), kind: 'e' };
      if (x.t === 's') return { text: String(x.v ?? ''), kind: 's' };
      return { text: '', kind: 'z' };
    };
    const cellAt = (r, c, sh = S()) => sh.rows.get(r)?.get(c) ?? null;
    const shownAt = (r, c) => display(cellAt(r, c), c)?.text ?? '';
    // What editing a cell starts from: its formula, or its value as it would be typed.
    const editText = (r, c) => {
      const x = cellAt(r, c);
      if (!x) return '';
      if (x.f !== undefined) return `=${x.f}`;
      if (x.t === 'b') return x.v ? 'TRUE' : 'FALSE';
      if (x.t === 'e') return String(x.v);
      if (x.t === 'n') {
        const fmt = NF.code(fmtOf(x));
        if (NF.isDate(fmt)) { try { return NF.format(x.v, x.v % 1 ? (x.v >= 1 ? 'm/d/yyyy h:mm:ss' : 'h:mm:ss') : 'm/d/yyyy', { date1904: wb.date1904 }) ?? String(x.v); } catch { return String(x.v); } }
        if (/%/.test(fmt.replace(/"[^"]*"|\\./g, ''))) return `${+(x.v * 100).toPrecision(15)}%`;
        return String(+x.v.toPrecision(15));
      }
      if (x.t === 's') { const s = String(x.v ?? ''); const p = M.parseInput(s); return p && p.t === 's' && p.v === s ? s : `'${s}`; }
      return '';
    };

    // ---- drawing: each pane's visible rows and cells from a pool; headers; the overlay
    const freeCells = [], freeRows = [];
    // The indices a pane or header shows along one axis, a few past each edge: frozen ones, or the scrolled rest.
    const spanOf = (col, frozen) => {
      const size = col ? (frozen ? FW : vw - HW - FW) : (frozen ? FH : vh - HH - FH);
      if (size <= 0) return null;
      const Z = col ? C : R, F0 = col ? FC : FR, off = col ? (frozen ? 0 : FW + sL) : (frozen ? 0 : FH + sT), n = col ? ext.cols : ext.rows;
      const lo = Math.max(frozen ? 0 : F0, Z.at(off) - OVER), hi = Math.min(frozen ? F0 - 1 : n - 1, Z.at(off + size) + OVER);
      return hi >= lo ? [lo, hi] : null;
    };
    const visible = (p) => { const cs = spanOf(true, p.fc), rs = spanOf(false, p.fr); return cs && rs ? { r0: rs[0], r1: rs[1], c0: cs[0], c1: cs[1] } : null; };
    const paint = (p, el, r, c, span) => {
      const x = cellAt(r, c), d = display(x, c);
      el.id = `gx-c-${r}-${c}`;
      el.dataset.r = r; el.dataset.c = c;
      el.setAttribute('aria-colindex', String(c + 1));
      el.style.left = `${lx(p, c)}px`;
      // Text runs on over the empty cells after it, as far as they are drawn.
      let w = C.size(c), k = c + 1;
      if (d?.kind === 's' && d.text) while (k <= span && !cellAt(r, k) && w < 2000) { w += C.size(k); k++; }
      el.style.width = `${w}px`;
      el.className = `gx-c${d ? ` gx-${d.kind}` : ''}${k > c + 1 ? ' gx-spill' : ''}`;
      el.textContent = d?.text ?? '';
      el.style.color = d?.color || '';
    };
    const drawPane = (p, all) => {
      const v = p.el.hidden ? null : visible(p);
      p.inner.style.transform = `translate(${p.fc ? 0 : -sL}px, ${p.fr ? 0 : -sT}px)`;
      const want = new Set();
      if (v) for (let r = v.r0; r <= v.r1; r++) if (R.size(r) > 0) want.add(r);
      for (const [r, row] of p.rows) {
        if (want.has(r)) continue;
        for (const el of row.cells.values()) { el.remove(); freeCells.push(el); }
        row.cells.clear(); row.el.remove(); freeRows.push(row); p.rows.delete(r);
      }
      if (!v) return;
      for (const r of want) {
        let row = p.rows.get(r), fresh2 = false;
        if (!row) { row = freeRows.pop() || { el: h('div', { class: 'gx-r', role: 'row' }), cells: new Map() }; p.rows.set(r, row); p.inner.insertBefore(row.el, p.ov); fresh2 = true; }
        if (fresh2 || all) { row.el.style.top = `${ly(p, r)}px`; row.el.style.height = `${R.size(r)}px`; row.el.setAttribute('aria-rowindex', String(r + 1)); }
        for (const [c, el] of row.cells) if (c < v.c0 || c > v.c1 || !C.size(c)) { el.remove(); freeCells.push(el); row.cells.delete(c); }
        for (let c = v.c0; c <= v.c1; c++) {
          if (!C.size(c)) continue;
          let el = row.cells.get(c);
          if (!el) { el = freeCells.pop() || h('div', { class: 'gx-c', role: 'gridcell' }); row.cells.set(c, el); row.el.append(el); paint(p, el, r, c, v.c1); }
          else if (all || fresh2) paint(p, el, r, c, v.c1);
        }
      }
    };
    const drawHead = (hd, all) => {
      const col = hd.axis === 'col', p = col ? { fc: hd.frozen } : { fr: hd.frozen };
      const span = hd.el.hidden ? null : spanOf(col, hd.frozen);
      hd.inner.style.transform = col ? `translateX(${hd.frozen ? 0 : -sL}px)` : `translateY(${hd.frozen ? 0 : -sT}px)`;
      const lo = span ? span[0] : 0, hi = span ? span[1] : -1;
      for (const [i, el] of hd.cells) if (i < lo || i > hi) { el.remove(); hd.cells.delete(i); }
      const [g0, g1] = selSpan(col);
      for (let i = lo; i <= hi; i++) {
        const size = col ? C.size(i) : R.size(i);
        let el = hd.cells.get(i);
        if (!size) { if (el) { el.remove(); hd.cells.delete(i); } continue; }
        if (!el) { el = h('div', { class: col ? 'gx-ch-c' : 'gx-rh-c' }); hd.cells.set(i, el); hd.inner.append(el); el.textContent = col ? M.columnName(i) : String(i + 1); all = true; }
        if (all) {
          if (col) { el.style.left = `${lx(p, i)}px`; el.style.width = `${size}px`; el.dataset.c = i; } else { el.style.top = `${ly(p, i)}px`; el.style.height = `${size}px`; el.dataset.r = i; }
          el.textContent = col ? M.columnName(i) : String(i + 1);
        }
        el.classList.toggle('gx-on', i >= g0 && i <= g1);
      }
    };
    // The rows or columns the selection covers, for the headers' marks.
    const selSpan = (col) => { const b = bounds(sel.ranges); return col ? [b.c0, b.c1] : [b.r0, b.r1]; };
    let frame = 0, frameAll = false;
    const draw = (all = false) => {
      frameAll ||= all;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; const a = frameAll; frameAll = false; drawNow(a); });
    };
    const drawNow = (all) => {
      sL = scroller.scrollLeft; sT = scroller.scrollTop;
      for (const p of Object.values(Q)) drawPane(p, all);
      for (const hd of Object.values(HD)) drawHead(hd, all);
      overlay();
      if (editing && editing.surface === editor) placeEditor();
      const id = `gx-c-${sel.active[0]}-${sel.active[1]}`;
      if (document.getElementById(id)) gridEl.setAttribute('aria-activedescendant', id); else gridEl.removeAttribute('aria-activedescendant');
    };
    // The overlay: the selection's ranges, the active cell, the fill handle (in the pane that holds its corner), the copied
    // range, a fill's reach, and a formula's references while it is written.
    let marquee = null, reachG = null, refs = [];
    const box = (p, g, cls, color) => {
      const r1 = Math.min(g.r1, ext.rows - 1), c1 = Math.min(g.c1, ext.cols - 1);
      const el = h('div', { class: cls });
      el.style.left = `${lx(p, g.c0)}px`; el.style.top = `${ly(p, g.r0)}px`;
      el.style.width = `${C.offset(c1 + 1) - C.offset(g.c0)}px`; el.style.height = `${R.offset(r1 + 1) - R.offset(g.r0)}px`;
      if (color) el.style.setProperty('--ref', color);
      return el;
    };
    const overlay = () => {
      const last = sel.ranges[sel.ranges.length - 1], [ar, ac] = sel.active, one = sel.ranges.length === 1 && last.r0 === last.r1 && last.c0 === last.c1;
      for (const p of Object.values(Q)) {
        if (p.el.hidden) { p.ov.replaceChildren(); continue; }
        const kids = [];
        if (!one) for (const g of sel.ranges) kids.push(box(p, g, 'gx-range'));
        kids.push(box(p, range(ar, ac), 'gx-active'));
        if (marquee && marquee.sheet === S().id) kids.push(box(p, marquee.g, 'gx-marquee'));
        if (reachG) kids.push(box(p, reachG, 'gx-reach'));
        refs.forEach((x, i) => kids.push(box(p, x, 'gx-ref', REF_COLORS[i % REF_COLORS.length])));
        if (!editing && paneOf(Math.min(last.r1, ext.rows - 1), Math.min(last.c1, ext.cols - 1)) === p) {
          const hEl = h('div', { class: 'gx-handle' });
          hEl.style.left = `${lx(p, Math.min(last.c1, ext.cols - 1) + 1) - 4}px`; hEl.style.top = `${ly(p, Math.min(last.r1, ext.rows - 1) + 1) - 4}px`;
          kids.push(hEl);
        }
        p.ov.replaceChildren(...kids);
      }
    };
    scroller.addEventListener('scroll', () => {
      // Near the room's end it grows, as Sheets adds rows.
      if (scroller.scrollTop + scroller.clientHeight > space.offsetHeight - 400 && ext.rows < MAX_VIEW_ROWS) reach(ext.rows + MIN_ROWS - MORE_ROWS, 0);
      if (scroller.scrollLeft + scroller.clientWidth > space.offsetWidth - 300 && ext.cols < MAX_VIEW_COLS) reach(0, ext.cols + 10 - MORE_COLS);
      draw();
    }, { passive: true });
    new ResizeObserver(() => { layout(); draw(true); }).observe(gridEl);

    // Scrolls the cell into view, past the frozen panes.
    const reveal = (r, c) => {
      reach(r, c);
      if (r >= FR) { const y = R.offset(r) - FH, ph = vh - HH - FH; if (y < scroller.scrollTop) scroller.scrollTop = y; else if (y + R.size(r) > scroller.scrollTop + ph) scroller.scrollTop = y + R.size(r) - ph; }
      if (c >= FC) { const x = C.offset(c) - FW, pw = vw - HW - FW; if (x < scroller.scrollLeft) scroller.scrollLeft = x; else if (x + C.size(c) > scroller.scrollLeft + pw) scroller.scrollLeft = x + C.size(c) - pw; }
    };

    // ---- the selection's words: the name box, the formula bar, the headers, the status bar, the live region
    let liveTimer = 0;
    const NUM = new Intl.NumberFormat(o.locale || undefined, { maximumFractionDigits: 10 });
    const statsOf = () => {
      if (count(sel.ranges) < 2) return '';
      let sum = 0, n = 0, filled = 0;
      const sh = S();
      for (const g of sel.ranges) for (const [r, row] of sh.rows) {
        if (r < g.r0 || r > g.r1) continue;
        for (const [c, x] of row) if (c >= g.c0 && c <= g.c1 && x.t !== 'z') { filled++; if (x.t === 'n') { sum += x.v; n++; } }
      }
      if (!filled) return '';
      return [n ? t('Sum: {n}', { n: NUM.format(sum) }) : '', n ? t('Average: {n}', { n: NUM.format(sum / n) }) : '', t('Count: {n}', { n: filled })].filter(Boolean).join('   ');
    };
    const told = () => {
      const [r, c] = sel.active;
      if (document.activeElement !== nameIn) nameIn.value = M.cellName(r, c);
      if (!editing) fx.value = editText(r, c);
      stats.textContent = statsOf();
      const fm = FORMATS.find(([, code]) => code === NF.code(fmtOf(cellAt(r, c))));
      fmtB.querySelector('.gx-lbl').textContent = t(fm ? fm[0] : 'Custom');
      undoB.disabled = !undos.length; redoB.disabled = !redos.length;
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => { live.textContent = [M.cellName(r, c), shownAt(r, c)].filter(Boolean).join(' '); }, 250);
    };
    const circular = () => { const x = eng.status?.circular?.[0]; circ.textContent = x ? t('Circular reference: {ref}', { ref: x.ref }) : ''; };
    const setSel = (next, { scroll = true } = {}) => {
      sel = next;
      if (scroll) reveal(sel.active[0], sel.active[1]);
      told();
      drawNow(false);
    };
    // Moves the active cell (extend: the selection's far corner instead).
    const move = (dr, dc, extend = false) => {
      if (extend) { const [er, ec] = end(sel), [r, c] = clampRC(er + dr, ec + dc); setSel(select(sel, r, c, { extend: true })); }
      else { const [r, c] = clampRC(sel.active[0] + dr, sel.active[1] + dc); setSel(select(null, r, c)); }
    };
    const moveTo = (r, c, extend = false) => { [r, c] = clampRC(r, c); setSel(extend ? select(sel, r, c, { extend: true }) : select(null, r, c)); };

    // ---- operations: every change goes through the engine; its inverse is the undo step; the cells it changed mark the
    // parts the next save writes
    const undos = [], redos = [];
    let undoBytes = 0;
    const weigh = (v, depth = 0) => {
      if (v == null || depth > 6) return 8;
      if (typeof v === 'string') return v.length * 2;
      if (typeof v !== 'object') return 8;
      if (v instanceof Map || v instanceof Set) { let n = 16; for (const x of v.values()) n += weigh(x, depth + 1); return n; }
      if (Array.isArray(v)) { let n = 16; for (const x of v) n += weigh(x, depth + 1); return n; }
      let n = 16; for (const k in v) n += k.length * 2 + weigh(v[k], depth + 1); return n;
    };
    const dirty = new Set();
    let dirtyAll = false, nextVersion = null, nextPatch = {};
    // Cell writes mark the bands their changed cells are in; anything that moves cells or rewrites formulas, every band.
    const mark = (res, op) => {
      if (['set', 'cells', 'clear'].includes(op.op)) for (const [id, r] of res.changed) dirty.add(`${id}:${Math.floor(r / BAND)}`);
      else dirtyAll = true;
      schedule();
    };
    // A grid-level operation the model has no op for: a sheet hidden (kept in its keep, as a file's state="hidden").
    const run = (op) => {
      if (op.op === 'gx-hide') {
        const sh = M.getSheet(wb, op.sheet), prev = sh.keep?.hidden === true;
        sh.keep = { ...(sh.keep || {}), hidden: op.hidden };
        if (!op.hidden) delete sh.keep.hidden;
        return { inverse: { op: 'gx-hide', sheet: op.sheet, hidden: prev }, changed: [], rebuild: true };
      }
      return eng.apply(op);
    };
    const WHY = { 'cap-cells': 'A workbook holds 250,000 cells.', 'cap-sheets': 'A workbook holds 100 sheets.', 'last-sheet': 'A workbook keeps one sheet.', 'array-part': 'You can’t change part of an array.', name: 'Use a different sheet name.', bounds: 'That would move cells off the sheet.' };
    const refused = (e) => { if (!WHY[e?.code]) console.error(e); say(t(WHY[e?.code] || 'Not saved. Try again in a moment.')); };
    // big: keep a version of the workbook as it was before (sort, a sheet deleted, a large paste).
    const apply = (op, { big = false, after = null } = {}) => {
      if (big) nextVersion ||= SD.pack(wb).then((gz) => ({ reason: 'edit', gz, cells: SD.measure(wb).cells }));
      const before = { sheet: S().id, sel };
      let res;
      try { res = run(op); } catch (e) { refused(e); return null; }
      undos.push({ op: res.inverse, ...before, bytes: weigh(res.inverse) });
      undoBytes += undos[undos.length - 1].bytes;
      while (undos.length > UNDO.steps || (undoBytes > UNDO.bytes && undos.length > 1)) undoBytes -= undos.shift().bytes;
      redos.length = 0;
      mark(res, op);
      changed(res, op);
      after?.();
      return res;
    };
    const changed = (res, op) => {
      const shapes = ['insert', 'delete', 'size', 'hide', 'prop', 'addSheet', 'removeSheet', 'moveSheet', 'rename', 'batch', 'restore', 'gx-hide'];
      if (shapes.includes(op.op) || res.rebuild) { if (!wb.sheets[wb.active] || S().keep?.hidden) wb.active = wb.sheets.findIndex((s) => !s.keep?.hidden); sizes(); layout(); tabsDraw(); }
      circular();
      told();
      drawNow(true);
    };
    const undo = (redo = false) => {
      const from = redo ? redos : undos, to = redo ? undos : redos, x = from.pop();
      if (!x) return;
      if (!redo) undoBytes -= x.bytes;
      if (x.sheet !== S().id) { const i = wb.sheets.findIndex((s) => s.id === x.sheet); if (i >= 0) { wb.active = i; sizes(); layout(); tabsDraw(); } }
      let res;
      try { res = run(x.op); } catch (e) { refused(e); return; }
      const back = { op: res.inverse, sheet: x.sheet, sel, bytes: weigh(res.inverse) };
      to.push(back);
      if (redo) undoBytes += back.bytes;
      mark(res, x.op);
      sel = x.sel;
      changed(res, x.op);
      reveal(sel.active[0], sel.active[1]);
    };
    undoB.addEventListener('click', () => { commit(); undo(false); gridEl.focus(); });
    redoB.addEventListener('click', () => { commit(); undo(true); gridEl.focus(); });

    // ---- saving: the parts the changes marked, the book and the card's text, a while after the last change; a version
    // every 10 minutes of editing, before a big change, a restore or on the first save. Leaving saves at once.
    let timer = 0, saving = null, again = false, lastVersion = rec?.lastVersion || 0, foreign = false;
    const busy = () => !!(timer || saving || dirty.size || dirtyAll);
    const pill = () => { state.textContent = busy() ? t('Saving…') : ''; };
    const schedule = () => { clearTimeout(timer); timer = setTimeout(() => { timer = 0; flush(); }, 700); pill(); };
    const flush = () => {
      clearTimeout(timer); timer = 0;
      if (saving) { again = true; return saving; }
      saving = (async () => {
        do {
          again = false;
          const d = dirtyAll || foreign ? null : new Set(dirty), patch = nextPatch, pend = nextVersion;
          dirty.clear(); dirtyAll = false; nextPatch = {}; nextVersion = null;
          if (foreign) sigs = new Map([...sigs.keys()].map((n) => [n, 'stale']));
          let version = pend ? await pend : null;
          if (!version && (fresh || Date.now() - lastVersion >= EVERY)) version = { reason: fresh ? 'start' : 'auto', gz: await SD.pack(wb), cells: SD.measure(wb).cells };
          try {
            const out = await SD.write(papers, key, wb, sigs, { base: rec?.revision || 0, dirty: d, version, patch: { ...(fresh && !patch.title && { title: '', named: false }), ...patch }, show: shown0() });
            sigs = out.sigs;
            if (out.saved) { rec = out.saved.paper; lastVersion = rec.lastVersion || lastVersion; }
            fresh = false; foreign = false;
          } catch (e) {
            console.error(e);
            if (d) for (const n of d) dirty.add(n); else dirtyAll = true;
            nextPatch = { ...patch, ...nextPatch };
            if (version && version.reason !== 'auto') nextVersion ||= Promise.resolve(version);
            say(t('Not saved. Try again in a moment.'));
            timer = setTimeout(() => { timer = 0; flush(); }, 5000);
            break;
          }
        } while (again);
      })().finally(() => { saving = null; pill(); });
      pill();
      return saving;
    };
    // Another tab's write: with nothing unsaved here, its workbook is shown; else the next save writes every part.
    const theirs = async (rev) => {
      if (rev == null || rev <= (rec?.revision || 0)) return;
      if (busy() || editing) { foreign = true; return; }
      const got = await SD.read((ks) => chrome.storage.local.get(ks), key).catch(() => null);
      if (!got || busy() || editing) { foreign = !!got; return; }
      wb = got.wb; rec = got.rec; sigs = got.sigs; lastVersion = rec.lastVersion || lastVersion;
      begin(); undos.length = 0; redos.length = 0; undoBytes = 0;
      if (wb.active >= wb.sheets.length) wb.active = 0;
      if (titleIn && document.activeElement !== titleIn && rec.title) titleIn.value = rec.title;
      sizes(); layout(); tabsDraw(); sel = clampSel(sel); told(); circular(); draw(true);
    };
    const clampSel = (s) => { const [r, c] = clampRC(s.active[0], s.active[1]); return select(null, r, c); };
    const PAPER = `writerPaper:${key}`;
    const onStore = (ch, area) => {
      if (area !== 'local' || !(PAPER in ch)) return;
      const rev = ch[PAPER].newValue?.revision;
      if (saving) saving.then(() => theirs(rev)); else theirs(rev);
    };
    chrome.storage.onChanged.addListener(onStore);
    addEventListener('pagehide', () => { if (busy()) flush(); });
    // A tab closed while a save waits: the browser asks first, as for a PDF's unsaved form.
    addEventListener('beforeunload', (e) => { if (busy()) { flush(); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.hidden && busy()) flush(); });
    // Documents: what is unsaved goes first (a frame of a school's page replaces itself, as papers.js's links do).
    back?.addEventListener('click', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      commit();
      Promise.race([flush(), new Promise((ok) => setTimeout(ok, 3000))]).finally(() => location[window.top === window ? 'assign' : 'replace'](back.href));
    });
    if (titleIn) {
      const named = () => { const v = titleIn.value.replace(/\s+/g, ' ').trim(); if (v === (rec?.title || '')) return; nextPatch = { ...nextPatch, title: v, named: !!v }; schedule(); };
      titleIn.addEventListener('input', () => { titleIn.size = Math.max(4, titleIn.value.length + 1); });
      titleIn.addEventListener('change', named);
      titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); named(); gridEl.focus(); } else if (e.key === 'Escape') { e.preventDefault(); titleIn.value = rec?.title || t('Untitled document'); gridEl.focus(); } });
    }

    // ---- writing in a cell: in place (the cell's editor) or in the formula bar; Enter, Tab and their Shift go on, Esc
    // goes back, F2 switches between moving out with the arrows and moving in the text. While a formula waits for an
    // argument, a click, a drag or the arrows put a reference in.
    let editing = null; // { r, c, sheet, mode: 'enter' | 'edit', orig, surface, point: { at, len, r, c } }
    const other = (s) => (s === editor ? fx : editor);
    const placeEditor = () => {
      const { r, c } = editing;
      editor.style.left = `${sx(c)}px`; editor.style.top = `${sy(r)}px`;
      editor.style.minWidth = `${C.size(c) + 1}px`; editor.style.height = `${Math.max(R.size(r), 20) + 1}px`;
      editor.style.width = `${Math.min(Math.max(C.size(c) + 1, editor.value.length * 7.5 + 12), Math.max(120, vw - sx(c) - 4))}px`;
    };
    const startEdit = (text, mode, surface = editor) => {
      const [r, c] = sel.active;
      reveal(r, c);
      editing = { r, c, sheet: S().id, mode, orig: editText(r, c), surface, point: null };
      const v = text ?? editing.orig;
      editor.value = v; fx.value = v;
      if (surface === editor) { editor.hidden = false; drawNow(false); placeEditor(); editor.focus({ preventScroll: true }); }
      surface.setSelectionRange(v.length, v.length);
      overlay();
      typed();
    };
    const stopEdit = () => {
      editing = null; editor.hidden = true; complete.hidden = true; sigEl.hidden = true; refs = []; reachG = null;
      fx.value = editText(...sel.active);
      overlay();
    };
    // Writes what was typed. → false when the engine refused the formula (the cell stays open).
    const commit = () => {
      if (!editing) return true;
      const x = editing, text = x.surface.value;
      if (text === x.orig) { stopEdit(); return true; }
      if (x.sheet !== S().id) { const i = wb.sheets.findIndex((s) => s.id === x.sheet); if (i >= 0) { wb.active = i; sizes(); layout(); tabsDraw(); } }
      let res;
      try { res = eng.edit(x.sheet, x.r, x.c, text); } catch (e) { refused(e); return false; }
      if (res.error) { say(t('There’s a problem with this formula.')); x.surface.focus(); return false; }
      undos.push({ op: res.inverse, sheet: x.sheet, sel, bytes: weigh(res.inverse) });
      undoBytes += undos[undos.length - 1].bytes;
      while (undos.length > UNDO.steps) undoBytes -= undos.shift().bytes;
      redos.length = 0;
      reach(x.r, x.c);
      marquee = null;
      stopEdit();
      mark(res, { op: 'set' });
      changed(res, { op: 'set' });
      return true;
    };
    const cancel = () => { if (!editing) return; stopEdit(); gridEl.focus({ preventScroll: true }); };
    // Where a reference can go: the formula's text before the caret ends in an operator, a parenthesis, a comma or the =.
    const pointable = () => {
      if (!editing) return false;
      const s = editing.surface, v = s.value, at = s.selectionStart;
      if (!v.startsWith('=') || at !== s.selectionEnd) return false;
      if (editing.point && editing.point.at + editing.point.len === at) return true;
      return /[=(,+\-*/^&<>;:]\s*$/.test(v.slice(0, at));
    };
    // Puts the reference to (r0, c0)–(r1, c1) of the shown sheet in at the caret, or in place of the one just put in.
    const point = (r0, c0, r1 = r0, c1 = c0) => {
      const s = editing.surface, v = s.value, sh = S();
      const ref = (sh.id === editing.sheet ? '' : F.sheetPrefix(sh.name)) + M.rangeName(Math.min(r0, r1), Math.min(c0, c1), Math.max(r0, r1), Math.max(c0, c1));
      const at = editing.point && editing.point.at + editing.point.len === s.selectionStart ? editing.point.at : s.selectionStart;
      const end2 = editing.point && at === editing.point.at ? at + editing.point.len : at;
      const next = v.slice(0, at) + ref + v.slice(end2);
      s.value = next; other(s).value = next;
      editing.point = { at, len: ref.length, r: r1, c: c1, r0, c0 };
      s.setSelectionRange(at + ref.length, at + ref.length);
      if (s === editor) placeEditor();
      typed(true);
    };
    const signature = (name) => { const d = CALC.fn(name); if (!d) return null; if (SIGS[name] !== undefined) return `${name}(${SIGS[name]})`; const args = Array.from({ length: Math.min(d.min, 4) }, (_, i) => `value${i + 1}`); if (d.max > d.min) args.push(d.max - d.min > 1 ? '…' : `[value${d.min + 1}]`); return `${name}(${args.join(', ')})`; };
    let names = null;
    const fnNames = () => (names ||= [...new Set(Object.keys(globalThis).filter((k) => /^GZ_SHEET_FN_/.test(k)).flatMap((k) => Object.keys(globalThis[k]?.FNS || globalThis[k] || {})))].filter((n) => CALC.fn(n)).sort());
    let pick = 0;
    // After each keystroke: the other surface follows; the references are outlined; function names that start the word
    // being typed are offered, and inside a call its signature shows.
    const typed = (pointing = false) => {
      if (!editing) return;
      const s = editing.surface, v = s.value;
      other(s).value = v;
      if (!pointing) editing.point = null;
      if (s === editor) placeEditor();
      refs = [];
      if (v.startsWith('=')) {
        let toks = [];
        try { toks = F.tokenize(v.slice(1)); } catch { toks = []; }
        const here = S().name.toLowerCase(), host = M.getSheet(wb, editing.sheet)?.name.toLowerCase();
        for (const k of toks) if (k.k === 'ref' && !k.sheet2 && ((k.sheet ? k.sheet.toLowerCase() : host) === here)) refs.push({ r0: k.r0, c0: k.c0, r1: Math.min(k.r1, ext.rows - 1), c1: Math.min(k.c1, ext.cols - 1) });
      }
      overlay();
      const before = v.slice(0, s.selectionStart), word = v.startsWith('=') ? /(?:^=|[=(,+\-*/^&<>;\s])([A-Za-z][A-Za-z0-9._]*)$/.exec(before)?.[1] : null;
      const list = word ? fnNames().filter((n) => n.startsWith(word.toUpperCase())).slice(0, 8) : [];
      complete.replaceChildren(...list.map((n, i) => h('li', { role: 'option', id: `gx-opt-${i}`, 'aria-selected': String(i === 0), 'data-name': n, text: n, onpointerdown: (e) => { e.preventDefault(); accept(n); } })));
      complete.hidden = !list.length || (list.length === 1 && list[0] === word.toUpperCase());
      pick = 0;
      let depth = 0, call = null;
      if (v.startsWith('=')) for (let i = before.length - 1; i >= 0; i--) { const ch = before[i]; if (ch === ')') depth++; else if (ch === '(') { if (depth) depth--; else { call = /([A-Za-z][A-Za-z0-9._]*)$/.exec(before.slice(0, i))?.[1]?.toUpperCase(); break; } } }
      const sig = call && complete.hidden ? signature(call) : null;
      sigEl.textContent = sig || ''; sigEl.hidden = !sig;
      const anchor = s === editor ? editor : fx, ab = anchor.getBoundingClientRect(), gb = gridEl.getBoundingClientRect();
      for (const el of [complete, sigEl]) { el.style.left = `${Math.max(0, ab.left - gb.left)}px`; el.style.top = `${Math.max(0, ab.bottom - gb.top + 2)}px`; }
      s.setAttribute('aria-expanded', String(!complete.hidden));
      if (!complete.hidden) s.setAttribute('aria-activedescendant', 'gx-opt-0'); else s.removeAttribute('aria-activedescendant');
    };
    const accept = (n) => {
      const s = editing.surface, v = s.value, at = s.selectionStart, before = v.slice(0, at).replace(/[A-Za-z][A-Za-z0-9._]*$/, '');
      const next = `${before}${n}(${v.slice(at)}`;
      s.value = next; s.setSelectionRange(before.length + n.length + 1, before.length + n.length + 1);
      complete.hidden = true;
      typed();
    };
    const editKeys = (e) => {
      if (!editing) return;
      const s = editing.surface;
      if (!complete.hidden && ['ArrowDown', 'ArrowUp', 'Tab'].includes(e.key) && !e.altKey) {
        const items = [...complete.children];
        if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); accept(items[pick].dataset.name); return; }
        e.preventDefault(); e.stopPropagation();
        pick = (pick + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        items.forEach((li, i) => li.setAttribute('aria-selected', String(i === pick)));
        s.setAttribute('aria-activedescendant', `gx-opt-${pick}`);
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!complete.hidden) { complete.hidden = true; return; } cancel(); return; }
      if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); e.stopPropagation(); if (commit()) { move(e.shiftKey ? -1 : 1, 0); gridEl.focus({ preventScroll: true }); } return; }
      if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); if (commit()) { move(0, e.shiftKey ? -1 : 1); gridEl.focus({ preventScroll: true }); } return; }
      if (e.key === 'F2') { e.preventDefault(); e.stopPropagation(); editing.mode = editing.mode === 'enter' ? 'edit' : 'enter'; return; }
      const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
      if (arrow && editing.mode === 'enter' && s === editor && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); e.stopPropagation();
        if (pointable()) {
          const p = editing.point, [r, c] = p ? [p.r, p.c] : [editing.r, editing.c];
          const [nr, nc] = clampRC(r + arrow[0], c + arrow[1]);
          if (e.shiftKey && p) point(p.r0, p.c0, nr, nc); else point(nr, nc);
          reveal(nr, nc); draw();
        } else if (commit()) { move(arrow[0], arrow[1]); gridEl.focus({ preventScroll: true }); }
        return;
      }
      e.stopPropagation();
    };
    for (const s of [editor, fx]) {
      s.addEventListener('keydown', editKeys);
      s.addEventListener('input', () => typed());
      s.addEventListener('click', () => { if (editing) { editing.point = null; typed(); } });
    }
    fx.addEventListener('focus', () => { if (!editing) startEdit(editText(...sel.active), 'edit', fx); else if (editing.surface === editor) { editing.surface = fx; editor.hidden = true; } });
    editor.addEventListener('blur', () => { setTimeout(() => { if (editing?.surface === editor && document.activeElement !== editor && document.activeElement !== fx && !document.activeElement?.closest?.('.gx-menu')) commit(); }, 0); });
    fx.addEventListener('blur', () => { setTimeout(() => { if (editing?.surface === fx && document.activeElement !== fx && document.activeElement !== gridEl) commit(); }, 0); });

    // ---- the name box: a cell, a range, a sheet's or a name's; Enter goes there
    const goTo = (text) => {
      let s = String(text || '').trim(), sh = S();
      const nm = wb.names.find((x) => x.name.toLowerCase() === s.toLowerCase());
      if (nm) s = nm.ref.replace(/^=/, '');
      const m = /^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/.exec(s);
      if (m) { const named = M.getSheet(wb, (m[1] ?? m[2]).replace(/''/g, "'")); if (!named) return false; sh = named; s = m[3]; }
      const g = M.rangePosition(s.replace(/\$/g, '').toUpperCase());
      if (!g || g.r1 >= MAX_VIEW_ROWS || g.c1 >= MAX_VIEW_COLS) return false;
      if (sh !== S()) show(wb.sheets.indexOf(sh));
      reach(g.r1, g.c1);
      const at = { active: [g.r0, g.c0], anchor: [g.r0, g.c0], ranges: [range(g.r0, g.c0, g.r1, g.c1)] };
      setSel(at);
      return true;
    };
    nameIn.addEventListener('focus', () => nameIn.select());
    nameIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (!goTo(nameIn.value)) say(t('Reference isn’t valid.')); nameIn.value = M.cellName(...sel.active); gridEl.focus({ preventScroll: true }); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); nameIn.value = M.cellName(...sel.active); gridEl.focus({ preventScroll: true }); }
    });

    // ---- the pointer: one target over the grid, found back to a cell, a header, a column's edge or the fill handle
    const hit = (e) => {
      const b = gridEl.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
      const ax = x - HW < FW ? x - HW : x - HW + sL, ay = y - HH < FH ? y - HH : y - HH + sT;
      const c = C.at(Math.max(0, ax)), r = R.at(Math.max(0, ay));
      const area = x < HW && y < HH ? 'corner' : y < HH ? 'col' : x < HW ? 'row' : 'cell';
      return { r, c, ax, ay, area, x, y };
    };
    const edgeAt = (p) => {
      if (p.area === 'col') { if (Math.abs(p.ax - C.offset(p.c + 1)) <= 4) return { axis: 'col', i: p.c }; if (p.c > 0 && Math.abs(p.ax - C.offset(p.c)) <= 4) return { axis: 'col', i: p.c - 1 }; }
      if (p.area === 'row') { if (Math.abs(p.ay - R.offset(p.r + 1)) <= 3) return { axis: 'row', i: p.r }; if (p.r > 0 && Math.abs(p.ay - R.offset(p.r)) <= 3) return { axis: 'row', i: p.r - 1 }; }
      return null;
    };
    const onHandle = (p) => {
      if (editing || p.area !== 'cell') return false;
      const g = sel.ranges[sel.ranges.length - 1], r1 = Math.min(g.r1, ext.rows - 1), c1 = Math.min(g.c1, ext.cols - 1);
      return Math.abs(p.x - sx(c1 + 1)) <= 6 && Math.abs(p.y - sy(r1 + 1)) <= 6;
    };
    scroller.addEventListener('pointermove', (e) => {
      if (drag) return;
      const p = hit(e), ed = edgeAt(p);
      scroller.style.cursor = ed ? (ed.axis === 'col' ? 'col-resize' : 'row-resize') : onHandle(p) ? 'crosshair' : p.area === 'cell' ? 'cell' : 'default';
    });
    let drag = null;
    // Whole columns or rows from a to b, after the ranges kept (base: Ctrl's earlier ones); the active cell in view.
    const lineSel = (axis, a, b, base = []) => {
      const g = axis === 'col' ? range(0, Math.min(a, b), ext.rows - 1, Math.max(a, b)) : range(Math.min(a, b), 0, Math.max(a, b), ext.cols - 1);
      const active = axis === 'col' ? [FR ? 0 : R.at(FH + sT), a] : [a, FC ? 0 : C.at(FW + sL)];
      return { active, anchor: axis === 'col' ? [0, a] : [a, 0], ranges: [...base, g] };
    };
    scroller.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const p = hit(e);
      if (editing && p.area === 'cell' && pointable()) {
        e.preventDefault();
        point(p.r, p.c);
        editing.surface.focus({ preventScroll: true });
        drag = { kind: 'point', r: p.r, c: p.c };
        scroller.setPointerCapture(e.pointerId);
        return;
      }
      if (editing && !commit()) { e.preventDefault(); return; }
      e.preventDefault();
      gridEl.focus({ preventScroll: true });
      const add = e.ctrlKey || e.metaKey;
      const ed = edgeAt(p);
      if (ed) drag = { kind: 'size', ...ed, from: ed.axis === 'col' ? C.offset(ed.i) : R.offset(ed.i), start: ed.axis === 'col' ? C.size(ed.i) : R.size(ed.i) };
      else if (onHandle(p)) drag = { kind: 'fill', g: sel.ranges[sel.ranges.length - 1] };
      else if (p.area === 'corner') { setSel({ active: [0, 0], anchor: [0, 0], ranges: [range(0, 0, ext.rows - 1, ext.cols - 1)] }, { scroll: false }); return; }
      else if (p.area === 'col' || p.area === 'row') {
        const col = p.area === 'col';
        drag = { kind: p.area, a: e.shiftKey ? sel.anchor[col ? 1 : 0] : col ? p.c : p.r, base: add ? sel.ranges : [] };
        setSel(lineSel(p.area, drag.a, col ? p.c : p.r, drag.base), { scroll: false });
      }
      else { setSel(select(sel, p.r, p.c, { extend: e.shiftKey, add: add && !e.shiftKey }), { scroll: false }); drag = { kind: 'cells' }; }
      scroller.setPointerCapture(e.pointerId);
    });
    scroller.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = hit(e);
      if (drag.kind === 'point') { if (p.r !== drag.r || p.c !== drag.c) { const q = editing?.point; if (q) point(q.r0, q.c0, p.r, p.c); } return; }
      if (drag.kind === 'cells') { const [er, ec] = end(sel); if (er !== p.r || ec !== p.c) setSel(select(sel, p.r, p.c, { extend: true }), { scroll: false }); }
      else if (drag.kind === 'col' || drag.kind === 'row') setSel(lineSel(drag.kind, drag.a, drag.kind === 'col' ? p.c : p.r, drag.base), { scroll: false });
      else if (drag.kind === 'size') {
        const at = drag.axis === 'col' ? p.ax : p.ay, size = Math.max(drag.axis === 'col' ? 8 : 6, Math.round(at - drag.from));
        (drag.axis === 'col' ? C : R).set(drag.i, size); drag.size = size; layout(); draw(true);
      } else if (drag.kind === 'fill') {
        const g = drag.g, down = p.r > g.r1 ? p.r - g.r1 : p.r < g.r0 ? p.r - g.r0 : 0, right = p.c > g.c1 ? p.c - g.c1 : p.c < g.c0 ? p.c - g.c0 : 0;
        if (Math.abs(down) >= Math.abs(right) && down) drag.to = { axis: 'row', n: down }; else if (right) drag.to = { axis: 'col', n: right }; else drag.to = null;
        reachG = !drag.to ? null : drag.to.axis === 'row' ? range(down > 0 ? g.r0 : g.r0 + down, g.c0, down > 0 ? g.r1 + down : g.r1, g.c1) : range(g.r0, right > 0 ? g.c0 : g.c0 + right, g.r1, right > 0 ? g.c1 + right : g.c1);
        overlay();
      }
    });
    const release = () => {
      const d = drag; drag = null;
      if (!d) return;
      if (d.kind === 'size' && d.size !== undefined) apply({ op: 'size', sheet: S().id, axis: d.axis, i: d.i, size: d.axis === 'col' ? px.toCol(d.size) : px.toRow(d.size) });
      else if (d.kind === 'size') { sizes(); layout(); draw(true); }
      if (d.kind === 'fill') { reachG = null; if (d.to) fillOut(d.g, d.to.axis, d.to.n); else overlay(); }
    };
    scroller.addEventListener('pointerup', release);
    scroller.addEventListener('pointercancel', () => { if (drag?.kind === 'size') { sizes(); layout(); draw(true); } reachG = null; drag = null; overlay(); });
    scroller.addEventListener('dblclick', (e) => {
      const p = hit(e), ed = edgeAt(p);
      if (ed?.axis === 'col') { fitColumn(ed.i); return; }
      if (ed?.axis === 'row') { apply({ op: 'size', sheet: S().id, axis: 'row', i: ed.i, size: null }); return; }
      if (onHandle(p)) { fillToData(); return; }
      if (p.area === 'cell') { setSel(select(null, p.r, p.c), { scroll: false }); startEdit(null, 'edit'); }
    });
    scroller.addEventListener('wheel', () => { if (editing?.surface === editor) placeEditor(); }, { passive: true });
    // A column as wide as its widest shown text (measured on a canvas in the grid's font).
    const measure = document.createElement('canvas').getContext('2d');
    const fitColumn = (c) => {
      measure.font = font;
      let w = 0;
      for (const [r, row] of S().rows) { const x = row.get(c); if (x) w = Math.max(w, measure.measureText(display(x, c).text).width); if (w > 1000) break; }
      apply({ op: 'size', sheet: S().id, axis: 'col', i: c, size: w ? px.toCol(Math.ceil(w) + 12) : null });
    };

    // ---- fill: the handle's drag, its double-click (down as far as the column beside goes), Ctrl+D and Ctrl+R
    const isDate = (x) => NF.isDate(fmtOf(x));
    const fillOut = (g, axis, n) => {
      const sh = S(), cells = [], back = n < 0, k = Math.abs(n);
      if (axis === 'row') for (let c = g.c0; c <= g.c1; c++) {
        const src = []; for (let r = g.r0; r <= g.r1; r++) src.push(cellAt(r, c));
        fill(src, k, { back, dr: back ? -1 : 1, dc: 0, isDate }).forEach((x, i) => cells.push([back ? g.r0 - 1 - i : g.r1 + 1 + i, c, x.cell]));
      } else for (let r = g.r0; r <= g.r1; r++) {
        const src = []; for (let c = g.c0; c <= g.c1; c++) src.push(cellAt(r, c));
        fill(src, k, { back, dr: 0, dc: back ? -1 : 1, isDate }).forEach((x, i) => cells.push([r, back ? g.c0 - 1 - i : g.c1 + 1 + i, x.cell]));
      }
      const ok = cells.filter(([r, c]) => r >= 0 && c >= 0 && r < M.MAX_ROWS && c < M.MAX_COLS);
      const all = axis === 'row' ? range(back ? g.r0 + n : g.r0, g.c0, back ? g.r1 : g.r1 + n, g.c1) : range(g.r0, back ? g.c0 + n : g.c0, g.r1, back ? g.c1 : g.c1 + n);
      apply({ op: 'cells', sheet: sh.id, cells: ok }, { big: ok.length >= BIG, after: () => setSel({ active: sel.active, anchor: [g.r0, g.c0], ranges: [all] }) });
    };
    const fillToData = () => {
      const g = sel.ranges[sel.ranges.length - 1], has = (r, c) => !!cellAt(r, c);
      const beside = g.c0 > 0 && has(g.r1 + 1, g.c0 - 1) ? g.c0 - 1 : has(g.r1 + 1, g.c1 + 1) ? g.c1 + 1 : null;
      if (beside === null) return;
      let r = g.r1 + 1;
      while (has(r + 1, beside)) r++;
      fillOut(g, 'row', r - g.r1);
    };
    const copyAlong = (axis) => {
      const g = sel.ranges[sel.ranges.length - 1], cells = [];
      if (axis === 'row') { if (g.r1 === g.r0) return; for (let c = g.c0; c <= g.c1; c++) { const x = cellAt(g.r0, c); for (let r = g.r0 + 1; r <= g.r1; r++) cells.push([r, c, x ? { ...x, ...(x.f !== undefined && { f: F.move(x.f, r - g.r0, 0) }) } : null]); } }
      else { if (g.c1 === g.c0) return; for (let r = g.r0; r <= g.r1; r++) { const x = cellAt(r, g.c0); for (let c = g.c0 + 1; c <= g.c1; c++) cells.push([r, c, x ? { ...x, ...(x.f !== undefined && { f: F.move(x.f, 0, c - g.c0) }) } : null]); } }
      apply({ op: 'cells', sheet: S().id, cells }, { big: cells.length >= BIG });
    };

    // ---- clearing, sorting, formats, rows and columns
    const within = (g, fn) => { for (const [r, row] of S().rows) if (r >= g.r0 && r <= g.r1) for (const [c, x] of row) if (c >= g.c0 && c <= g.c1) fn(r, c, x); };
    const clearSel = () => {
      const cells = [];
      for (const g of sel.ranges) within(g, (r, c, x) => cells.push([r, c, x.s !== undefined && x.s !== 0 ? { t: 'z', s: x.s } : null]));
      if (cells.length) apply({ op: 'cells', sheet: S().id, cells }, { big: cells.length >= BIG });
    };
    const collator = new Intl.Collator(o.locale || undefined, { sensitivity: 'base', numeric: true });
    const rank = (x) => (!x || x.t === 'z' ? 9 : x.t === 'n' ? 0 : x.t === 's' ? 1 : x.t === 'b' ? 2 : 3);
    // The rows of the selection (or, from one cell, the block of data around it, its first row kept when it reads as a
    // header), in order by the active cell's column; their formulas move with them.
    const region = (r, c) => {
      const sh = S(), has = (a, b) => a >= 0 && b >= 0 && !!sh.rows.get(a)?.get(b);
      let g = range(r, c), grew = true;
      while (grew) {
        grew = false;
        const test = (a0, a1, b0, b1) => { for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) if (has(a, b)) return true; return false; };
        if (test(g.r0 - 1, g.r0 - 1, g.c0 - 1, g.c1 + 1)) { g.r0--; grew = true; }
        if (test(g.r1 + 1, g.r1 + 1, g.c0 - 1, g.c1 + 1)) { g.r1++; grew = true; }
        if (test(g.r0, g.r1, g.c0 - 1, g.c0 - 1)) { g.c0--; grew = true; }
        if (test(g.r0, g.r1, g.c1 + 1, g.c1 + 1)) { g.c1++; grew = true; }
      }
      return g;
    };
    const sort = (desc) => {
      commit();
      const last = sel.ranges[sel.ranges.length - 1], [, col] = sel.active;
      let g = last.r0 === last.r1 && last.c0 === last.c1 ? region(last.r0, last.c0) : { ...last };
      const u = used(S());
      g = range(g.r0, g.c0, Math.min(g.r1, u.r - 1), Math.min(g.c1, u.c - 1));
      if (last.r0 === last.r1 && g.r1 > g.r0) {
        const a = cellAt(g.r0, col), b = cellAt(g.r0 + 1, col);
        if (a?.t === 's' && b && b.t !== 's') g.r0++;
      }
      if (g.r1 <= g.r0) return;
      const rows = []; for (let r = g.r0; r <= g.r1; r++) rows.push(r);
      const cmp = (ra, rb) => {
        const a = cellAt(ra, col), b = cellAt(rb, col), ka = rank(a), kb = rank(b);
        if (ka === 9 || kb === 9) return ka - kb;
        let d = ka - kb;
        if (!d) d = ka === 0 ? a.v - b.v : ka === 1 ? collator.compare(a.v, b.v) : ka === 2 ? Number(a.v) - Number(b.v) : 0;
        return desc ? -d : d;
      };
      const order = [...rows].sort(cmp), cells = [];
      order.forEach((from, i) => { const to = g.r0 + i; for (let c = g.c0; c <= g.c1; c++) { const x = cellAt(from, c), y = cellAt(to, c); if (x || y) cells.push([to, c, x ? { ...x, ...(x.f !== undefined && { f: F.move(x.f, to - from, 0) }) } : null]); } });
      apply({ op: 'cells', sheet: S().id, cells }, { big: true, after: () => setSel({ active: [g.r0, col], anchor: [g.r0, g.c0], ranges: [g] }, { scroll: false }) });
    };
    azB.addEventListener('click', () => { sort(false); gridEl.focus(); });
    zaB.addEventListener('click', () => { sort(true); gridEl.focus(); });
    const setFormat = (code) => {
      try { NF.compile(NF.code(code)); } catch { say(t('That format can’t be used.')); return false; }
      const cells = [], seen = new Set();
      const style = (x) => M.internStyle(wb, { ...(wb.styles[x?.s ?? 0] || {}), fmt: code });
      for (const g of sel.ranges) {
        within(g, (r, c, x) => { seen.add(`${r},${c}`); cells.push([r, c, { ...x, s: style(x) }]); });
        const u = used(S()), r1 = Math.min(g.r1, Math.max(u.r, g.r0 + 1) - 1, g.r0 + 9999), c1 = Math.min(g.c1, Math.max(u.c, g.c0 + 1) - 1, g.c0 + 255);
        for (let r = g.r0; r <= r1 && cells.length < 20000; r++) for (let c = g.c0; c <= c1; c++) if (!seen.has(`${r},${c}`)) cells.push([r, c, { t: 'z', s: style(null) }]);
      }
      apply({ op: 'cells', sheet: S().id, cells });
      return true;
    };
    const lines = (axis) => { const g = sel.ranges[sel.ranges.length - 1]; return axis === 'row' ? { at: g.r0, n: g.r1 - g.r0 + 1 } : { at: g.c0, n: g.c1 - g.c0 + 1 }; };
    const whole = (axis) => sel.ranges.every((g) => (axis === 'row' ? g.c0 === 0 && g.c1 >= ext.cols - 1 : g.r0 === 0 && g.r1 >= ext.rows - 1));
    const shape = (op, axis, side) => {
      commit();
      const { at, n } = lines(axis), sh = S();
      if (op === 'insert') apply({ op: 'insert', sheet: sh.id, axis, at: side === 'after' ? at + n : at, n });
      else apply({ op: 'delete', sheet: sh.id, axis, at, n: Math.min(n, (axis === 'row' ? M.MAX_ROWS : M.MAX_COLS) - at) }, { big: n * (axis === 'row' ? 1 : 1) >= 100 });
    };
    const hideLines = (axis, on) => {
      const g = bounds(sel.ranges), ops = [];
      const [a, b] = axis === 'row' ? [g.r0, g.r1] : [g.c0, g.c1], set = S().hidden[axis === 'row' ? 'rows' : 'cols'];
      for (let i = on ? a : Math.max(0, a - 1); i <= (on ? b : b + 1); i++) if (on !== set.has(i)) ops.push({ op: 'hide', sheet: S().id, axis, i, hidden: on });
      if (ops.length) apply({ op: 'batch', ops });
    };

    // ---- menus (the toolbar's, the grid's and a tab's): pop menus of buttons, arrow keys inside, Esc back
    let menu = null;
    const closeMenu = (backTo) => { if (!menu) return; const m = menu; menu = null; m.el.remove(); m.opener?.setAttribute('aria-expanded', 'false'); if (backTo) (m.back || gridEl).focus({ preventScroll: true }); };
    const openMenu = (items, at, { opener = null, back = null, label = '' } = {}) => {
      closeMenu();
      const el = h('div', { class: 'pop gp-menu gx-menu', role: 'menu', 'aria-label': label || null });
      for (const it of items) {
        if (it === '-') { el.append(h('div', { class: 'gp-hr', role: 'separator' })); continue; }
        if (it.el) { el.append(it.el); continue; }
        el.append(btn({ role: it.check === undefined ? 'menuitem' : 'menuitemcheckbox', tabindex: '-1', 'data-act': it.act, disabled: it.disabled, 'aria-checked': it.check === undefined ? null : String(!!it.check),
          onclick: () => { const m = menu; closeMenu(false); it.run(); if (!document.activeElement || document.activeElement === document.body || document.activeElement === m?.opener || document.activeElement === m?.back) gridEl.focus({ preventScroll: true }); } }, it.label));
      }
      document.body.append(el);
      const w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = `${Math.max(4, Math.min(at.x, innerWidth - w - 4))}px`;
      el.style.top = `${Math.max(4, at.y + hh > innerHeight - 4 ? at.y - hh - (at.h || 0) : at.y)}px`;
      el.addEventListener('keydown', (e) => {
        const all = [...el.querySelectorAll('[role^="menuitem"]:not([disabled])')], i = all.indexOf(document.activeElement);
        if (e.key === 'Escape' || (e.key === 'Tab' && !e.target.matches('input'))) { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && !e.target.matches('input')) { e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length]?.focus(); }
      });
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      opener?.setAttribute('aria-expanded', 'true');
      menu = { el, opener, back: back || opener };
      el.querySelector('[role^="menuitem"]:not([disabled])')?.focus();
    };
    const below = (b) => { const r = b.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4, h: r.height + 8 }; };
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.el.contains(e.target) && !menu.opener?.contains(e.target)) closeMenu(); }, true);
    const toggle = (b, items, label) => b.addEventListener('click', () => { if (menu?.opener === b) { closeMenu(true); return; } commit(); openMenu(typeof items === 'function' ? items() : items, below(b), { opener: b, label }); });
    toggle(fmtB, () => {
      const now = NF.code(fmtOf(cellAt(...sel.active)));
      const code = h('input', { id: 'gx-fmt-code', type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Custom format'), value: now });
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (setFormat(code.value)) closeMenu(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); } });
      return [...FORMATS.map(([label, c]) => ({ act: `fmt-${label.toLowerCase()}`, label: t(label), check: now === c, run: () => setFormat(c) })), '-',
        { el: h('div', { class: 'gx-fmt-row' }, code, btn({ class: 'gp-tbtn', 'data-act': 'fmt-custom', onclick: () => { if (setFormat(code.value)) closeMenu(true); } }, t('Apply'))) }];
    }, t('Number format'));
    toggle(freezeB, () => {
      const [r, c] = sel.active, fz = S().freeze, set = (v) => apply({ op: 'prop', sheet: S().id, key: 'freeze', value: v });
      return [{ act: 'freeze-row', label: t('Freeze top row'), check: fz?.rows === 1 && !fz?.cols, run: () => set({ rows: 1, cols: 0 }) },
        { act: 'freeze-col', label: t('Freeze first column'), check: fz?.cols === 1 && !fz?.rows, run: () => set({ rows: 0, cols: 1 }) },
        { act: 'freeze-here', label: t('Freeze at {cell}', { cell: M.cellName(r, c) }), disabled: !r && !c, run: () => set({ rows: r, cols: c }) },
        { act: 'unfreeze', label: t('Unfreeze'), disabled: !fz?.rows && !fz?.cols, run: () => set(null) }];
    }, t('Freeze'));
    const fileNow = async () => o.fileOf(wb, rec?.title || host?.title?.() || '');
    toggle(moreB, () => [{ act: 'export', label: t(o.exportLabel()), run: () => { flush(); fileNow().then(o.download, (e) => { console.error(e); say(t('Not saved. Try again in a moment.')); }); } }], t('More'));
    const when = new Intl.DateTimeFormat(o.locale || undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    versB.addEventListener('click', async () => {
      if (menu?.opener === versB) { closeMenu(true); return; }
      commit();
      const list = await papers.versions(key).catch(() => []);
      openMenu(list.length ? list.map((v) => ({ act: 'restore', label: when.format(v.at), run: () => restore(v.id) })) : [{ act: 'none', label: t('No versions yet'), disabled: true, run: () => {} }], below(versB), { opener: versB, label: t('Versions') });
    });
    const restore = async (id) => {
      const v = await papers.version(key, id).catch(() => null), next = v?.gz ? await SD.unpack(v.gz).catch(() => null) : null;
      if (!next) { say(t('That file could not be read.')); return; }
      commit();
      nextVersion = SD.pack(wb).then((gz) => ({ reason: 'restore', gz, cells: SD.measure(wb).cells }));
      wb = next;
      begin(); undos.length = 0; redos.length = 0; undoBytes = 0;
      dirtyAll = true;
      sizes(); layout(); tabsDraw(); sel = clampSel(sel); told(); circular(); draw(true);
      flush();
    };
    // The grid's own menu: at the pointer (right click), or at the active cell (Shift+F10, the menu key).
    const gridMenu = (at, area) => {
      const rows = whole('row') || area === 'row', cols = whole('col') || area === 'col';
      const { n: nr } = lines('row'), { n: nc } = lines('col');
      const items = [
        { act: 'cut', label: t('Cut'), run: () => { gridEl.focus(); document.execCommand('cut'); } },
        { act: 'copy', label: t('Copy'), run: () => { gridEl.focus(); document.execCommand('copy'); } }, '-',
        ...(cols ? [] : [{ act: 'row-above', label: t(nr > 1 ? 'Insert {n} rows above' : 'Insert row above', { n: nr }), run: () => shape('insert', 'row', 'before') },
          { act: 'row-below', label: t(nr > 1 ? 'Insert {n} rows below' : 'Insert row below', { n: nr }), run: () => shape('insert', 'row', 'after') }]),
        ...(rows ? [] : [{ act: 'col-left', label: t(nc > 1 ? 'Insert {n} columns left' : 'Insert column left', { n: nc }), run: () => shape('insert', 'col', 'before') },
          { act: 'col-right', label: t(nc > 1 ? 'Insert {n} columns right' : 'Insert column right', { n: nc }), run: () => shape('insert', 'col', 'after') }]), '-',
        ...(cols ? [] : [{ act: 'delete-rows', label: t(nr > 1 ? 'Delete {n} rows' : 'Delete row', { n: nr }), run: () => shape('delete', 'row') }]),
        ...(rows ? [] : [{ act: 'delete-cols', label: t(nc > 1 ? 'Delete {n} columns' : 'Delete column', { n: nc }), run: () => shape('delete', 'col') }]),
        { act: 'clear', label: t('Clear'), run: clearSel },
        ...(rows ? ['-', { act: 'hide-rows', label: t('Hide rows'), run: () => hideLines('row', true) }, { act: 'unhide-rows', label: t('Unhide rows'), run: () => hideLines('row', false) }] : []),
        ...(cols ? ['-', { act: 'hide-cols', label: t('Hide columns'), run: () => hideLines('col', true) }, { act: 'unhide-cols', label: t('Unhide columns'), run: () => hideLines('col', false) }] : []),
      ];
      openMenu(items, at, { label: t('Cell') });
    };
    scroller.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const p = hit(e);
      if (editing && !commit()) return;
      gridEl.focus({ preventScroll: true });
      const inSel = sel.ranges.some((g) => inside(g, p.r, p.c));
      if (p.area === 'row' && !(inSel && whole('row'))) setSel(lineSel('row', p.r, p.r), { scroll: false });
      else if (p.area === 'col' && !(inSel && whole('col'))) setSel(lineSel('col', p.c, p.c), { scroll: false });
      else if (p.area === 'cell' && !inSel) setSel(select(null, p.r, p.c), { scroll: false });
      gridMenu({ x: e.clientX, y: e.clientY }, p.area);
    });

    // ---- sheet tabs: click to show, double-click to rename (the formulas that name it follow), ⋯ by right click or the
    // menu key: rename, duplicate, delete, hide and unhide, move
    const show = (i) => {
      if (i < 0 || i >= wb.sheets.length || i === wb.active) return;
      commit();
      sels.set(S().id, { sel, sL: scroller.scrollLeft, sT: scroller.scrollTop });
      wb.active = i;
      const was = sels.get(S().id);
      sel = was?.sel || select(null, 0, 0);
      sizes(); layout();
      scroller.scrollLeft = was?.sL || 0; scroller.scrollTop = was?.sT || 0;
      tabsDraw(); told(); circular(); draw(true);
    };
    const tabsDraw = () => {
      tabs.replaceChildren(...wb.sheets.map((s, i) => (s.keep?.hidden ? null : btn({ class: 'gx-tab', role: 'tab', id: `gx-tab-${s.id}`, 'data-sheet': s.id, 'aria-selected': String(i === wb.active), 'aria-controls': 'gx-grid', tabindex: i === wb.active ? '0' : '-1' }, s.name))));
      gridEl.setAttribute('aria-label', S().name);
    };
    const tabOf = (el) => { const id = Number(el?.closest?.('.gx-tab')?.dataset.sheet); return Number.isInteger(id) ? wb.sheets.findIndex((s) => s.id === id) : -1; };
    tabs.addEventListener('click', (e) => { const i = tabOf(e.target); if (i >= 0) { show(i); gridEl.focus({ preventScroll: true }); } });
    const renameTab = (i) => {
      const sh = wb.sheets[i], el = tabs.querySelector(`[data-sheet="${sh.id}"]`);
      if (!el) return;
      const input = h('input', { class: 'gx-tab-in', type: 'text', maxlength: '31', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Sheet name') });
      input.value = sh.name;
      el.replaceWith(input);
      input.focus(); input.select();
      let done = false;
      const finish = (keep) => {
        if (done) return; done = true;
        const v = input.value.trim();
        if (keep && v && v !== sh.name) { if (M.validName(wb, v, sh.id)) say(t('Use a different sheet name.')); else apply({ op: 'rename', sheet: sh.id, name: v }); }
        tabsDraw();
        gridEl.focus({ preventScroll: true });
      };
      input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
      input.addEventListener('blur', () => finish(true));
    };
    tabs.addEventListener('dblclick', (e) => { const i = tabOf(e.target); if (i >= 0) renameTab(i); });
    const copyName = (name) => { for (let n = 2; ; n++) { const v = `${name.slice(0, 26)} (${n})`; if (!M.validName(wb, v)) return v; } };
    const duplicate = (i) => {
      const s = wb.sheets[i], id = Math.max(...wb.sheets.map((x) => x.id)) + 1;
      const clone = { ...structuredClone({ ...s, rows: null }), id, name: copyName(s.name), rows: new Map([...s.rows].map(([r, row]) => [r, new Map([...row].map(([c, x]) => [c, { ...x }]))])) };
      apply({ op: 'addSheet', sheet: clone, at: i + 1, active: i + 1 });
    };
    const tabMenu = (i, at) => {
      const s = wb.sheets[i], shown = wb.sheets.filter((x) => !x.keep?.hidden), hidden = wb.sheets.filter((x) => x.keep?.hidden);
      openMenu([
        { act: 'rename', label: t('Rename'), run: () => renameTab(i) },
        { act: 'duplicate', label: t('Duplicate'), run: () => duplicate(i) },
        { act: 'delete', label: t('Delete'), disabled: wb.sheets.length < 2, run: () => apply({ op: 'removeSheet', sheet: s.id }, { big: true }) },
        { act: 'hide', label: t('Hide'), disabled: shown.length < 2, run: () => apply({ op: 'gx-hide', sheet: s.id, hidden: true }) },
        ...hidden.map((x) => ({ act: 'unhide', label: t('Unhide {name}', { name: x.name }), run: () => apply({ op: 'gx-hide', sheet: x.id, hidden: false }) })), '-',
        { act: 'move-left', label: t('Move left'), disabled: i === 0, run: () => apply({ op: 'moveSheet', sheet: s.id, to: i - 1 }) },
        { act: 'move-right', label: t('Move right'), disabled: i === wb.sheets.length - 1, run: () => apply({ op: 'moveSheet', sheet: s.id, to: i + 1 }) },
      ], at, { back: tabs.querySelector(`[data-sheet="${s.id}"]`), label: s.name });
    };
    tabs.addEventListener('contextmenu', (e) => { const i = tabOf(e.target); if (i < 0) return; e.preventDefault(); show(i); tabMenu(i, { x: e.clientX, y: e.clientY }); });
    tabs.addEventListener('keydown', (e) => {
      const i = tabOf(e.target);
      if (i < 0) return;
      const vis = wb.sheets.map((s, k) => (s.keep?.hidden ? -1 : k)).filter((k) => k >= 0), at = vis.indexOf(i);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const to = vis[(at + (e.key === 'ArrowRight' ? 1 : vis.length - 1)) % vis.length]; show(to); tabs.querySelector(`[data-sheet="${wb.sheets[to].id}"]`)?.focus(); }
      else if (e.key === 'F2') { e.preventDefault(); renameTab(i); }
      else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); tabMenu(i, below(e.target)); }
    });
    addB.addEventListener('click', () => { commit(); const at = wb.active + 1; apply({ op: 'addSheet', at, active: at }, { after: () => { sel = select(null, 0, 0); scroller.scrollTop = 0; scroller.scrollLeft = 0; told(); } }); gridEl.focus({ preventScroll: true }); });

    // ---- find and replace in the shown sheet: its cells' shown text and formulas, case aside
    let hits = [], hitAt = -1;
    const findOpen = (replace = false) => { findBar.hidden = false; findB.setAttribute('aria-pressed', 'true'); layout(); draw(true); (replace ? repQ : findQ).focus(); findQ.select(); };
    const findClose = () => { findBar.hidden = true; findB.setAttribute('aria-pressed', 'false'); hits = []; findN.textContent = ''; layout(); draw(true); gridEl.focus({ preventScroll: true }); };
    const search = () => {
      const q = findQ.value.toLowerCase();
      hits = [];
      if (q) for (const r of [...S().rows.keys()].sort((a, b) => a - b)) for (const c of [...S().rows.get(r).keys()].sort((a, b) => a - b)) { const x = cellAt(r, c); if (shownAt(r, c).toLowerCase().includes(q) || (x.f !== undefined && `=${x.f}`.toLowerCase().includes(q))) hits.push([r, c]); }
      hitAt = hits.length ? Math.max(0, hits.findIndex(([r, c]) => r > sel.active[0] || (r === sel.active[0] && c >= sel.active[1]))) : -1;
      landHit();
    };
    const landHit = () => { findN.textContent = !findQ.value ? '' : hits.length ? t('{n} of {m}', { n: hitAt + 1, m: hits.length }) : t('No results'); if (hitAt >= 0) setSel(select(null, ...hits[hitAt])); };
    const step = (by) => { if (!hits.length) return; hitAt = (hitAt + by + hits.length) % hits.length; landHit(); };
    const swap = (text) => { const q = findQ.value; return q ? text.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => repQ.value) : text; };
    const replaceOne = () => {
      if (hitAt < 0) return;
      const [r, c] = hits[hitAt], next = swap(editText(r, c));
      const res = eng.edit(S().id, r, c, next);
      if (res.error) { say(t('There’s a problem with this formula.')); return; }
      undos.push({ op: res.inverse, sheet: S().id, sel, bytes: weigh(res.inverse) }); redos.length = 0;
      mark(res, { op: 'set' }); changed(res, { op: 'set' });
      search();
    };
    const replaceAll = () => {
      if (!hits.length) return;
      const cells = [];
      for (const [r, c] of hits) {
        const x = cellAt(r, c), p = M.parseInput(swap(editText(r, c)), { date1904: wb.date1904 }), keep = x.s !== undefined ? { s: x.s } : {};
        cells.push([r, c, !p ? (x.s !== undefined ? { t: 'z', s: x.s } : null) : p.f !== undefined ? { t: 'n', v: 0, f: F.normalize(p.f), ...keep } : { t: p.t, v: p.v, ...keep }]);
      }
      apply({ op: 'cells', sheet: S().id, cells }, { big: cells.length >= 100 });
      say(t('{n} replaced', { n: cells.length }));
      search();
    };
    findQ.addEventListener('input', search);
    findQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); findClose(); } });
    repQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); findClose(); } });
    findNext.addEventListener('click', () => step(1)); findPrev.addEventListener('click', () => step(-1));
    repOne.addEventListener('click', replaceOne); repAll.addEventListener('click', replaceAll);
    findX.addEventListener('click', findClose);
    findBar.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); findClose(); } });
    findB.addEventListener('click', () => (findBar.hidden ? findOpen() : findClose()));

    // ---- the clipboard: the shown text as TSV and a table; Glaze's own copy found again by its TSV's hash keeps formulas
    let clip = null;
    const onGrid = () => document.activeElement === gridEl && !editing;
    const copyOut = (e, cut) => {
      if (!onGrid()) return;
      e.preventDefault();
      const g = sel.ranges[sel.ranges.length - 1], u = used(S()), r1 = Math.min(g.r1, Math.max(u.r - 1, g.r0)), c1 = Math.min(g.c1, Math.max(u.c - 1, g.c0));
      const rows = [], cells = [];
      for (let r = g.r0; r <= r1; r++) { const a = [], b = []; for (let c = g.c0; c <= c1; c++) { const x = cellAt(r, c); a.push({ text: x ? display(x, c).text : '' }); b.push(x ? { ...x } : null); } rows.push(a); cells.push(b); }
      const out = copy(rows);
      e.clipboardData.setData('text/plain', out.tsv);
      e.clipboardData.setData('text/html', out.html);
      clip = { sig: sig(out.tsv), cells, r0: g.r0, c0: g.c0, sheet: S().id, cut };
      marquee = { sheet: S().id, g: range(g.r0, g.c0, r1, c1) };
      overlay();
    };
    document.addEventListener('copy', (e) => copyOut(e, false));
    document.addEventListener('cut', (e) => copyOut(e, true));
    const cellOf = (x, r, c) => {
      if (x.formula) return { t: 'n', v: 0, f: F.normalize(fromR1C1(x.formula, r, c)) };
      if (x.value !== undefined) return typeof x.value === 'number' ? { t: 'n', v: x.value } : typeof x.value === 'boolean' ? { t: 'b', v: x.value } : { t: 's', v: x.value };
      if (x.fmt === '@') return x.text ? { t: 's', v: x.text, s: M.internStyle(wb, { fmt: '@' }) } : null;
      const p = M.parseInput(x.text, { date1904: wb.date1904 });
      if (!p) return null;
      const out = p.f !== undefined ? { t: 'n', v: 0, f: F.normalize(p.f) } : { t: p.t, v: p.v };
      const fmt = x.fmt && x.fmt !== 'General' ? x.fmt : p.fmt;
      if (fmt && out.t === 'n') out.s = M.internStyle(wb, { fmt });
      return out;
    };
    document.addEventListener('paste', (e) => {
      if (!onGrid()) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain'), html = e.clipboardData.getData('text/html');
      const g = sel.ranges[sel.ranges.length - 1], r0 = g.r0, c0 = g.c0, cells = [];
      let rows = 0, cols = 0;
      if (clip && text && sig(text) === clip.sig) {
        const dr = r0 - clip.r0, dc = c0 - clip.c0;
        clip.cells.forEach((row, i) => row.forEach((x, j) => { cells.push([r0 + i, c0 + j, x ? { ...x, ...(x.f !== undefined && !clip.cut && { f: F.move(x.f, dr, dc) }) } : null]); cols = Math.max(cols, j + 1); }));
        rows = clip.cells.length;
      } else {
        let table = null;
        try { table = html ? parseHTML(html) : null; } catch { table = null; }
        if (!table) { try { table = parseDelimited(text.replace(/\r?\n$/, ''), '\t').map((row) => row.map((v) => ({ text: v }))); } catch { table = [[{ text }]]; } }
        table.forEach((row, i) => row.forEach((x, j) => { cells.push([r0 + i, c0 + j, cellOf(x, r0 + i, c0 + j)]); cols = Math.max(cols, j + 1); }));
        rows = table.length;
      }
      if (!cells.length) return;
      if (r0 + rows > M.MAX_ROWS || c0 + cols > M.MAX_COLS) { say(t('That would move cells off the sheet.')); return; }
      reach(r0 + rows, c0 + cols);
      const ops = [{ op: 'cells', sheet: S().id, cells }];
      if (clip?.cut && sig(text) === clip.sig) {
        const target = range(r0, c0, r0 + rows - 1, c0 + cols - 1), from = [];
        clip.cells.forEach((row, i) => row.forEach((x, j) => { const r = clip.r0 + i, c = clip.c0 + j; if (x && !(clip.sheet === S().id && inside(target, r, c))) from.push([r, c, null]); }));
        if (from.length) ops.unshift({ op: 'cells', sheet: clip.sheet, cells: from });
      }
      const op = ops.length > 1 ? { op: 'batch', ops } : ops[0];
      apply(op, { big: cells.length >= BIG, after: () => setSel({ active: [r0, c0], anchor: [r0, c0], ranges: [range(r0, c0, r0 + rows - 1, c0 + cols - 1)] }, { scroll: false }) });
      if (clip?.cut) { clip = null; marquee = null; overlay(); }
    });

    // ---- the keyboard on the grid
    const pageRows = () => Math.max(1, Math.floor((vh - HH - FH) / 20) - 1), pageCols = () => Math.max(1, Math.floor((vw - HW - FW) / 64) - 1);
    const filled = (r, c) => !!cellAt(r, c) && cellAt(r, c).t !== 'z';
    gridEl.addEventListener('keydown', (e) => {
      if (e.target !== gridEl || editing) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key;
      const lim = { rows: ext.rows, cols: ext.cols };
      const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[k];
      if (arrow && !e.altKey) {
        e.preventDefault();
        if (mod) { const [r, c] = e.shiftKey ? end(sel) : sel.active, to = edge(filled, r, c, arrow[0], arrow[1], lim); moveTo(to[0], to[1], e.shiftKey); }
        else move(arrow[0], arrow[1], e.shiftKey);
        return;
      }
      const g = sel.ranges[sel.ranges.length - 1];
      switch (true) {
        case k === 'Tab': e.preventDefault(); move(0, e.shiftKey ? -1 : 1); return;
        case k === 'Enter' && !mod: e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); return;
        case k === 'Home': e.preventDefault(); moveTo(mod ? 0 : sel.active[0], 0, e.shiftKey); return;
        case k === 'End': { e.preventDefault(); const u = used(S()); if (mod) moveTo(Math.max(0, u.r - 1), Math.max(0, u.c - 1), e.shiftKey); else { const row = S().rows.get(sel.active[0]); moveTo(sel.active[0], row?.size ? Math.max(...row.keys()) : sel.active[1], e.shiftKey); } return; }
        case k === 'PageDown' || k === 'PageUp': {
          e.preventDefault();
          if (mod) { const vis = wb.sheets.map((s, i) => (s.keep?.hidden ? -1 : i)).filter((i) => i >= 0), at = vis.indexOf(wb.active); show(vis[Math.max(0, Math.min(vis.length - 1, at + (k === 'PageDown' ? 1 : -1)))]); return; }
          const n = k === 'PageDown' ? 1 : -1;
          if (e.altKey) move(0, n * pageCols(), e.shiftKey); else { move(n * pageRows(), 0, e.shiftKey); scroller.scrollTop += n * pageRows() * 20; }
          return;
        }
        case k === 'F2': e.preventDefault(); startEdit(null, 'edit'); return;
        case k === 'Delete' || k === 'Backspace': e.preventDefault(); clearSel(); return;
        case k === 'Escape': if (marquee || clip) { e.preventDefault(); marquee = null; clip = null; overlay(); } return;
        case (k === 'F10' && e.shiftKey) || k === 'ContextMenu': { e.preventDefault(); const [r, c] = sel.active; const b = gridEl.getBoundingClientRect(); gridMenu({ x: b.left + sx(c) + 8, y: b.top + sy(r) + R.size(r) }, 'cell'); return; }
        case mod && !e.altKey && (k === 'z' || k === 'Z'): e.preventDefault(); undo(e.shiftKey); return;
        case mod && !e.altKey && (k === 'y' || k === 'Y'): e.preventDefault(); undo(true); return;
        case mod && (k === 'a' || k === 'A'): e.preventDefault(); setSel({ active: sel.active, anchor: [0, 0], ranges: [range(0, 0, ext.rows - 1, ext.cols - 1)] }, { scroll: false }); return;
        case mod && (k === 'f' || k === 'F'): e.preventDefault(); findOpen(false); return;
        case mod && (k === 'h' || k === 'H'): e.preventDefault(); findOpen(true); return;
        case mod && (k === 'd' || k === 'D'): e.preventDefault(); copyAlong('row'); return;
        case mod && (k === 'r' || k === 'R'): e.preventDefault(); copyAlong('col'); return;
        case mod && k === ' ': e.preventDefault(); setSel({ active: sel.active, anchor: [0, g.c0], ranges: [range(0, g.c0, ext.rows - 1, g.c1)] }, { scroll: false }); return;
        case e.shiftKey && !mod && k === ' ': e.preventDefault(); setSel({ active: sel.active, anchor: [g.r0, 0], ranges: [range(g.r0, 0, g.r1, ext.cols - 1)] }, { scroll: false }); return;
        case mod && (k === '+' || (k === '=' && e.shiftKey)): e.preventDefault(); shape('insert', whole('col') ? 'col' : 'row', 'before'); return;
        case mod && k === '-': e.preventDefault(); shape('delete', whole('col') ? 'col' : 'row'); return;
        default:
      }
      if (k.length === 1 && !mod && !e.altKey) { e.preventDefault(); startEdit(k, 'enter'); return; }
      if (k === 'Process' || k === 'Dead') startEdit('', 'enter');
    });
    gridEl.addEventListener('focus', () => draw());
    // Find from anywhere in the sheet's chrome but a text field.
    view.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.target === gridEl || isField(e.target) || !(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H') { e.preventDefault(); findOpen(/h/i.test(e.key)); }
    });

    // ---- first paint
    sizes(); layout(); tabsDraw(); told(); circular(); drawNow(true);
    gridEl.focus({ preventScroll: true });
    const save = async () => { if (!commit()) return false; await flush(); return !busy(); };
    return { pages: () => wb.sheets.length, say, ready: () => true, save,
      file: async () => { if (!await save()) throw new Error('not saved'); const f = await fileNow(); return { bytes: f.bytes, mime: f.mime, ext: f.name.slice(f.name.lastIndexOf('.')), name: f.name }; } };
  };

  return { Sizes, px, range, inside, select, end, bounds, count, name, edge, fill, parseDelimited, writeDelimited, sniff, sig, copy, parseHTML, fromR1C1, mount };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_GRID; else GZ_SHEET_GRID;
