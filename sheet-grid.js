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
  const TAIL = /^(.*?)(\d+)(\D*)$/;
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
        const nums = m.map((x) => Number(x[2])), width = m[0][2].length, step = L === 1 ? 1 : nums[1] - nums[0];
        if (L === 1 || steady(nums)) value = (p) => `${m[0][1]}${String(Math.abs(nums[0] + step * p)).padStart(width, '0')}${m[0][3]}`;
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

  const pure = { Sizes, px, range, inside, select, end, bounds, count, name, edge, fill, parseDelimited, writeDelimited, sniff, sig, copy, parseHTML, fromR1C1 };
  if (typeof document === 'undefined') return pure;
  return { ...pure };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_GRID; else GZ_SHEET_GRID;
