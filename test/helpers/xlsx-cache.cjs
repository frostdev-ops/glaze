// The values Excel cached in an .xlsx, read back as Excel saved them: each sheet's cells with their type, cached value
// and formula text, shared and array formulas resolved to every cell they cover. The golden harness's own reader
// (scripts/sheet-excel-golden.js, test/sheet-golden.test.js); lib/sheet-xlsx.js is the product's. Runs on
// lib/doctext.js's unzip and tokenizer and is bounded the same way: archive limits come from unzip, and sheets, cells,
// shared strings and formula length are capped here. Every limit can be lowered per call with { limits }.
// → { date1904, sheets: [{ name, cells: Map 'A1' → { t: 'n'|'s'|'b'|'e', v, f?, kind?, ref?, cm? } }] }
// f is the formula without its '='; kind is 'shared' or 'array' when the file wrote it so, with ref the range it covers.
const { unzip, tokens, decode } = require('../../lib/doctext.js');

const LIMITS = { sheets: 100, cells: 250000, strings: 250000, formula: 8192 };
const MAX_ROW = 1048576, MAX_COL = 16384;
const fail = (what) => { throw new RangeError(what); };

const local = (name) => name.slice(name.lastIndexOf(':') + 1);
const attr = (attrs, name) => {
  const n = name.startsWith('*:') ? `[\\w.-]+:${name.slice(2)}` : name;
  const m = new RegExp(`(?:^|\\s)${n}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decode(m[1] ?? m[2]) : null;
};
// OOXML's escape for characters XML can't hold: _xHHHH_ (and _x005F_ before a literal one).
const unescape = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const colName = (c) => { let s = ''; for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s; return s; };
const colNumber = (s) => { let c = 0; for (const ch of s.toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64; return c; };
const address = (r, c) => colName(c) + r;
const parseAddress = (a) => {
  const m = /^([A-Za-z]{1,3})(\d{1,7})$/.exec(a || '');
  if (!m) return null;
  const r = +m[2], c = colNumber(m[1]);
  return r >= 1 && r <= MAX_ROW && c >= 1 && c <= MAX_COL ? { r, c } : null;
};
const parseRange = (ref) => {
  const parts = String(ref || '').split(':');
  if (parts.length > 2) return null;
  const [a, b = a] = parts;
  const p = parseAddress(a), q = parseAddress(b);
  return p && q ? { r0: Math.min(p.r, q.r), c0: Math.min(p.c, q.c), r1: Math.max(p.r, q.r), c1: Math.max(p.c, q.c) } : null;
};

// A formula moved by dr rows and dc columns, as Excel fills it: relative references move, $-anchored parts stay, and a
// reference moved off the sheet becomes #REF!. Strings, quoted sheet names, structured references, error literals,
// numbers and names are copied as they are; a name only counts as a reference when nothing name-like touches it.
const shift = (f, dr, dc) => {
  let out = '', i = 0;
  const n = f.length;
  const row = (abs, r) => (abs ? r : r + dr), col = (abs, c) => (abs ? c : c + dc);
  const okRow = (r) => r >= 1 && r <= MAX_ROW, okCol = (c) => c >= 1 && c <= MAX_COL;
  while (i < n) {
    const ch = f[i], rest = f.slice(i);
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      for (; j < n; j++) if (f[j] === ch) { if (f[j + 1] === ch) j++; else break; }
      out += f.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '[') {
      let j = i, depth = 0;
      for (; j < n; j++) { if (f[j] === '[') depth++; else if (f[j] === ']' && --depth === 0) break; }
      out += f.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '#') { const m = /^#[A-Za-z0-9_/]+[!?]?/.exec(rest); const s = m ? m[0] : '#'; out += s; i += s.length; continue; }
    let m;
    if ((m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w.(!])/.exec(rest))) {
      const r = row(m[3], +m[4]), c = col(m[1], colNumber(m[2]));
      out += okRow(r) && okCol(c) && okRow(+m[4]) && okCol(colNumber(m[2])) ? `${m[1]}${colName(c)}${m[3]}${r}` : '#REF!';
      i += m[0].length; continue;
    }
    if ((m = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![\w.(!])/.exec(rest))) {
      const a = col(m[1], colNumber(m[2])), b = col(m[3], colNumber(m[4]));
      out += okCol(a) && okCol(b) ? `${m[1]}${colName(a)}:${m[3]}${colName(b)}` : '#REF!';
      i += m[0].length; continue;
    }
    if ((m = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![\w.(!])/.exec(rest))) {
      const a = row(m[1], +m[2]), b = row(m[3], +m[4]);
      out += okRow(a) && okRow(b) ? `${m[1]}${a}:${m[3]}${b}` : '#REF!';
      i += m[0].length; continue;
    }
    if ((m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)) || (m = /^[A-Za-z_\\][\w.\\]*/.exec(rest))) {
      out += m[0]; i += m[0].length; continue;
    }
    out += ch; i++;
  }
  return out;
};

// A part's relationships: rId → path inside the archive.
const rels = async (z, path) => {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const x = await z.text(`${dir}_rels/${path.slice(dir.length)}.rels`);
  const out = new Map();
  for (const tk of tokens(x || '')) {
    if (!tk.name || tk.close || local(tk.name) !== 'Relationship') continue;
    const id = attr(tk.attrs, 'Id'), target = attr(tk.attrs, 'Target');
    if (!id || !target || attr(tk.attrs, 'TargetMode') === 'External') continue;
    const parts = [];
    for (const p of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) if (p === '..') parts.pop(); else if (p !== '.') parts.push(p);
    out.set(id, parts.join('/'));
  }
  return out;
};

// Shared strings in order, each the text of its runs (<t> in <si>, or in its <r>s), phonetic guides (<rPh>) left out.
const sharedStrings = (x, L) => {
  const out = [];
  let cur = null, inT = 0, skip = 0;
  for (const tk of tokens(x || '')) {
    if (tk.name) {
      const n = local(tk.name);
      if (n === 'si') {
        if (tk.empty) out.push('');
        else if (tk.close) { out.push(unescape(cur ?? '')); cur = null; } else cur = '';
        if (out.length > L.strings) fail('too many shared strings');
      } else if (n === 'rPh') { if (!tk.empty) skip += tk.close ? -1 : 1; }
      else if (n === 't' && !tk.empty) inT += tk.close ? -1 : 1;
      continue;
    }
    if (cur != null && inT > 0 && !skip) cur += tk.cdata ?? decode(tk.text);
  }
  return out;
};

const value = (t, v, inline, strings) => {
  if (t === 'inlineStr' ? inline == null : v == null) return null;
  switch (t) {
    case 's': {
      const k = Number(v);
      if (!Number.isInteger(k) || k < 0 || k >= strings.length) throw new Error(`shared string ${v} out of range`);
      return { t: 's', v: strings[k] };
    }
    case 'str': return { t: 's', v: unescape(v ?? '') };
    case 'inlineStr': return { t: 's', v: unescape(inline ?? '') };
    case 'b': return { t: 'b', v: v === '1' || v === 'true' };
    case 'e': return { t: 'e', v: v ?? '' };
    case 'd': return { t: 'd', v: v ?? '' };
    default: {
      if (v == null) return null;
      const x = Number(v);
      if (v.trim() === '' || !Number.isFinite(x)) throw new Error(`bad number ${JSON.stringify(v)}`);
      return { t: 'n', v: x };
    }
  }
};

// One worksheet's cells. A cell without a cached value (a styled blank) is left out unless it holds a formula.
const sheetCells = (x, strings, L, budget) => {
  const cells = new Map(), shared = new Map(), arrays = [];
  let row = 0, col = 0, cur = null, field = null, inT = 0, skip = 0;
  const finish = () => {
    const c = cur;
    cur = null;
    if (++budget.cells > L.cells) fail('too many cells');
    if (c.f != null && c.f.length > L.formula) fail('formula too long');
    const v = value(c.t, c.v, c.inline, strings);
    if (!v && c.f == null && !c.fkind) return;
    const cell = v || { t: null, v: null };
    if (c.f != null || c.fkind) Object.assign(cell, { f: c.f ?? null });
    if (c.fkind) cell.kind = c.fkind;
    if (c.fref) cell.ref = c.fref;
    if (c.cm != null) cell.cm = c.cm;
    if (c.fkind === 'shared') {
      if (c.f) shared.set(c.si, { f: c.f, r: c.r, c: c.c });
      cell.si = c.si;
    }
    if (c.fkind === 'array') {
      const range = parseRange(c.fref);
      if (!range || c.r < range.r0 || c.r > range.r1 || c.c < range.c0 || c.c > range.c1) throw new Error('bad array range');
      budget.arrays += (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
      if (budget.arrays > L.cells) fail('too many array cells');
      arrays.push({ at: address(c.r, c.c), ...range });
    }
    cells.set(address(c.r, c.c), cell);
  };
  for (const tk of tokens(x || '')) {
    if (!tk.name) {
      if (!cur || !field) continue;
      if (field === 'is' && (!inT || skip)) continue;
      const s = tk.cdata ?? decode(tk.text);
      cur[field === 'is' ? 'inline' : field] = (cur[field === 'is' ? 'inline' : field] ?? '') + s;
      if ((cur.f?.length || 0) > L.formula) fail('formula too long');
      continue;
    }
    const n = local(tk.name);
    if (n === 'row' && !tk.close) { const r = attr(tk.attrs, 'r'); row = r ? +r : row + 1; col = 0; if (!(row >= 1 && row <= MAX_ROW)) throw new Error('bad row'); }
    else if (n === 'c') {
      if (tk.close) { if (cur) finish(); continue; }
      const r = attr(tk.attrs, 'r'), p = r == null ? null : parseAddress(r);
      if (r != null && !p) throw new Error('bad cell reference');
      if (p) { row = p.r; col = p.c; } else col++;
      if (!(col >= 1 && col <= MAX_COL) || !(row >= 1)) throw new Error('bad cell reference');
      cur = { r: row, c: col, t: attr(tk.attrs, 't') || 'n', cm: attr(tk.attrs, 'cm') };
      if (tk.empty) finish();
    } else if (!cur) continue;
    else if (n === 'f') {
      if (!tk.close) {
        cur.fkind = attr(tk.attrs, 't') === 'shared' ? 'shared' : attr(tk.attrs, 't') === 'array' ? 'array' : attr(tk.attrs, 't') === 'dataTable' ? 'dataTable' : null;
        cur.fref = attr(tk.attrs, 'ref');
        cur.si = attr(tk.attrs, 'si');
        if (tk.empty) { if (!cur.fkind) cur.f = ''; } else { cur.f = cur.f ?? ''; field = 'f'; }
      } else field = null;
    } else if (n === 'v') { if (!tk.close && cur.t === 'str') cur.v = ''; field = tk.close || tk.empty ? null : 'v'; }
    else if (n === 'is') { if (!tk.close) cur.inline = ''; field = tk.close || tk.empty ? null : 'is'; }
    else if (n === 'rPh' && field === 'is' && !tk.empty) skip += tk.close ? -1 : 1;
    else if (n === 't' && field === 'is' && !tk.empty) inT += tk.close ? -1 : 1;
  }
  // Shared formulas: a cell that only names its group gets the group's formula moved from the cell that holds it.
  for (const cell of cells.values()) {
    if (cell.kind !== 'shared' || cell.f) continue;
    const m = shared.get(cell.si);
    if (!m) throw new Error(`shared formula ${cell.si} has no master`);
  }
  for (const [at, cell] of cells) {
    if (cell.kind !== 'shared' || cell.f) continue;
    const m = shared.get(cell.si), p = parseAddress(at);
    cell.f = shift(m.f, p.r - m.r, p.c - m.c);
    if (cell.f.length > L.formula) fail('formula too long');
  }
  // Array formulas: every other cell of the range belongs to the formula its first cell holds.
  for (const a of arrays) {
    const master = cells.get(a.at);
    for (let r = a.r0; r <= a.r1; r++) for (let c = a.c0; c <= a.c1; c++) {
      const at = address(r, c);
      if (at === a.at) continue;
      const cell = cells.get(at);
      if (cell) Object.assign(cell, { f: master.f, kind: 'array', ref: master.ref, master: a.at });
    }
  }
  return cells;
};

const read = async (bytes, opts = {}) => {
  const L = { ...LIMITS, ...opts.limits };
  const z = unzip(bytes, opts);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('not an Excel workbook');
  let date1904 = false;
  const list = [];
  for (const tk of tokens(wb)) {
    if (!tk.name || tk.close) continue;
    const n = local(tk.name);
    if (n === 'workbookPr') date1904 = /^(1|true)$/.test(attr(tk.attrs, 'date1904') || '');
    else if (n === 'sheet') {
      list.push({ name: attr(tk.attrs, 'name'), id: attr(tk.attrs, '*:id') });
      if (list.length > L.sheets) fail('too many sheets');
    }
  }
  const r = await rels(z, 'xl/workbook.xml');
  const ssPath = [...r.values()].find((p) => /sharedStrings\.xml$/.test(p));
  const strings = sharedStrings(ssPath ? await z.text(ssPath) : '', L);
  const budget = { cells: 0, arrays: 0 };
  const sheets = [];
  for (const s of list) {
    const path = r.get(s.id);
    const x = path && await z.text(path);
    if (x == null) throw new Error(`sheet ${s.name} is missing`);
    sheets.push({ name: s.name, cells: sheetCells(x, strings, L, budget) });
  }
  return { date1904, sheets };
};

module.exports = { read, shift, colName, colNumber, parseAddress, parseRange, LIMITS };
