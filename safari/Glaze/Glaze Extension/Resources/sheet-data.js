// A spreadsheet as Documents keeps it (sheet-kind.js, sheet-grid.js): the one module that knows its storage. The record
// (writerPaper:<key>, lib/writer-papers.js) holds the book, everything of the workbook but its cells; the cells go in parts,
// one per sheet per 1,000-row band (writerSheet:<key>:<sheet id>:<band>), each stamped with the record revision that wrote it
// (the record's parts: name → revision), so a read that meets a part of another write knows it is torn. A save writes only
// the parts whose content changed and the book only when it changed (plan: a 32-bit hash per part, kept from the last
// save, with an exact per-part comparison when hashes match), in the worker's one set() with the record and the index. Versions are the whole workbook packed as gzip and
// base64, up to 16 MB of them per spreadsheet. The card shows the active sheet's A1:F4 as text (glance), kept in the
// record and its index row; search reads the cells' text (text). Kept package parts (bytes) travel tagged in the book, the
// seam where the worker's blob store will take them by reference.
// Classic script; module.exports for node.
var GZ_SHEET_DATA = globalThis.GZ_SHEET_DATA || (() => {
  const BAND = 1000, TEXT_CAP = 2e4, VERSIONS_CAP = 16e6, CUT = 40, PAPER = 'writerPaper:', PART = 'writerSheet:';
  const keyOf = (key, name) => `${PART}${key}:${name}`;

  // Plain JSON for what the model holds in Maps, Sets and bytes, and back.
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = (s) => { const bin = atob(s), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
  const enc = (v) => {
    if (v instanceof Map) return { $map: [...v].map(([k, x]) => [k, enc(x)]) };
    if (v instanceof Set) return { $set: [...v] };
    if (v instanceof Uint8Array) return { $b64: b64(v) };
    if (Array.isArray(v)) return v.map(enc);
    if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = enc(x); return o; }
    return v;
  };
  const one = (o, k) => { const ks = Object.keys(o); return ks.length === 1 && ks[0] === k; };
  const dec = (v) => {
    if (Array.isArray(v)) return v.map(dec);
    if (!v || typeof v !== 'object') return v;
    if (one(v, '$map') && Array.isArray(v.$map)) return new Map(v.$map.map(([k, x]) => [k, dec(x)]));
    if (one(v, '$set') && Array.isArray(v.$set)) return new Set(v.$set);
    if (one(v, '$b64') && typeof v.$b64 === 'string') return unb64(v.$b64);
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = dec(x);
    return o;
  };

  // A cell as [c, t, v, f, s, a, rich, cm, vm, dt], nothing past its last field; null where a field before it is missing.
  // cm, vm and dt: a dynamic array's and a data table's (lib/sheet-xlsx.js), after the rest so older parts read the same.
  const FIELDS = ['t', 'v', 'f', 's', 'a', 'rich', 'cm', 'vm', 'dt'];
  const cellOut = (c, x) => {
    const out = [c, ...FIELDS.map((k) => (x[k] === undefined ? null : x[k]))];
    while (out.length > 2 && out[out.length - 1] === null) out.pop();
    return out;
  };
  const cellIn = (a) => { const x = {}; FIELDS.forEach((k, i) => { if (a[i + 1] !== null && a[i + 1] !== undefined) x[k] = a[i + 1]; }); return x; };
  const byKey = (a, b) => a[0] - b[0];
  // One band's rows: [[r, [cell…]]…] by row, each row's cells by column.
  const bandRows = (sh, band) => {
    const lo = band * BAND, hi = lo + BAND, out = [];
    for (const [r, row] of sh.rows) if (r >= lo && r < hi && row.size) out.push([r, [...row].sort(byKey).map(([c, x]) => cellOut(c, x))]);
    return out.sort(byKey);
  };
  const bandsOf = (sh) => { const s = new Set(); for (const [r, row] of sh.rows) if (row.size) s.add(Math.floor(r / BAND)); return [...s].sort((a, b) => a - b); };

  // The book: the workbook without its cells.
  const bookOf = (wb) => enc({ ...wb, sheets: wb.sheets.map(({ rows, ...rest }) => rest) });
  const split = (wb) => {
    const parts = new Map();
    for (const sh of wb.sheets) for (const band of bandsOf(sh)) parts.set(`${sh.id}:${band}`, bandRows(sh, band));
    return { book: bookOf(wb), parts };
  };
  // parts: name → rows (a Map, or an object).
  const join = (book, parts) => {
    const wb = dec(book), all = parts instanceof Map ? parts : new Map(Object.entries(parts || {}));
    for (const sh of wb.sheets) {
      sh.rows = new Map();
      const mine = [...all].filter(([n]) => n.split(':')[0] === String(sh.id)).sort((a, b) => Number(a[0].split(':')[1]) - Number(b[0].split(':')[1]));
      for (const [, rows] of mine) for (const [r, cells] of rows) sh.rows.set(r, new Map(cells.map((a) => [a[0], cellIn(a)])));
    }
    return wb;
  };
  const serialize = (wb) => { const { book, parts } = split(wb); return JSON.stringify({ book, parts: [...parts].sort((a, b) => (a[0] < b[0] ? -1 : 1)) }); };
  const deserialize = (s) => { const o = JSON.parse(s); return join(o.book, new Map(o.parts)); };

  // FNV-1a over the text, as 8 hex digits: the change test.
  const sig = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); };

  // What a save writes: the parts whose hash differs from the last save's (sigs: name → hash, '' the book's), the book
  // when its hash does, and the names of parts no longer there. dirty: the part names that may have changed (a sheet's
  // `${id}:*` for all of its bands), or null for every one. → { book?, parts: { name: { rows } }, drop, sigs, changed }.
  const plan = (wb, sigs = new Map(), dirty = null) => {
    const next = new Map(), parts = {};
    // Hashes reject changed parts quickly, but a matching 32-bit digest alone cannot prove a part is unchanged.
    next.content = new Map();
    const take = (name, rows) => {
      if (!rows.length) return;
      const json = JSON.stringify(rows), s = sig(json);
      next.set(name, s); next.content.set(name, json);
      if (sigs.get(name) !== s || sigs.content?.get(name) !== json) parts[name] = { rows };
    };
    for (const sh of wb.sheets) {
      const id = String(sh.id);
      if (!dirty || dirty.has(`${id}:*`)) { for (const band of bandsOf(sh)) take(`${id}:${band}`, bandRows(sh, band)); continue; }
      for (const [name, s] of sigs) if (name && name.split(':')[0] === id) { next.set(name, s); if (sigs.content?.has(name)) next.content.set(name, sigs.content.get(name)); }
      for (const name of dirty) {
        const [sid, band] = name.split(':');
        if (sid !== id || band === '*') continue;
        next.delete(name);
        take(name, bandRows(sh, Number(band)));
      }
    }
    const drop = [...sigs.keys()].filter((n) => n && !next.has(n));
    const book = bookOf(wb), json = JSON.stringify(book), bsig = sig(json);
    const bookChanged = sigs.get('') !== bsig || sigs.content?.get('') !== json;
    next.set('', bsig);
    next.content.set('', json);
    return { book: bookChanged ? book : undefined, parts, drop, sigs: next, changed: bookChanged || Object.keys(parts).length > 0 || drop.length > 0 };
  };

  // A cell's text as the card and search show it, when the page gives no renderer: its value as typed.
  const plain = (sh, r, c, x) => (x.t === 'b' ? (x.v ? 'TRUE' : 'FALSE') : x.v === undefined || x.v === null ? '' : String(x.v));
  const measure = (wb) => { let cells = 0; for (const sh of wb.sheets) for (const row of sh.rows.values()) cells += row.size; return { cells, sheets: wb.sheets.length }; };
  // The cells' text: each sheet's name, then a line a row, its cells by column with tabs between, to TEXT_CAP.
  const text = (wb, show = plain) => {
    let out = '';
    for (const sh of wb.sheets) {
      out += `${out ? '\n' : ''}${sh.name}`;
      for (const r of [...sh.rows.keys()].sort((a, b) => a - b)) {
        if (out.length >= TEXT_CAP) return out.slice(0, TEXT_CAP);
        const row = sh.rows.get(r), line = [...row.keys()].sort((a, b) => a - b).map((c) => show(sh, r, c, row.get(c))).filter(Boolean).join('\t');
        if (line) out += `\n${line}`;
      }
    }
    return out.slice(0, TEXT_CAP);
  };
  // The card's text: the active sheet's A1:F4, each cell cut to 40 characters.
  const glance = (wb, show = plain) => {
    const sh = wb.sheets[wb.active] || wb.sheets[0];
    return Array.from({ length: 4 }, (_, r) => Array.from({ length: 6 }, (_, c) => { const x = sh?.rows.get(r)?.get(c); return x ? String(show(sh, r, c, x) ?? '').slice(0, CUT) : ''; }));
  };
  const isGlance = (g) => Array.isArray(g) && g.length === 4 && g.every((row) => Array.isArray(row) && row.length === 6 && row.every((s) => typeof s === 'string' && s.length <= CUT));

  // A version: the workbook as gzip, in base64.
  const through = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
  const pack = async (wb) => b64(await through(new TextEncoder().encode(serialize(wb)), new CompressionStream('gzip')));
  const unpack = async (s) => deserialize(new TextDecoder().decode(await through(unb64(s), new DecompressionStream('gzip'))));

  // The stored spreadsheet: its record and its parts read back, each part checked against the revision the record says
  // wrote it; a torn read (a save landed between the two reads) is read again. get: chrome.storage.local.get. → { rec, wb,
  // sigs } or null when there is no record; throws when every try was torn.
  const read = async (get, key, tries = 3) => {
    for (let i = 0; i < tries; i++) {
      const rec = (await get([PAPER + key]))[PAPER + key];
      if (!rec) return null;
      const names = Object.keys(rec.parts || {}), got = names.length ? await get(names.map((n) => keyOf(key, n))) : {};
      const parts = new Map();
      if (!names.every((n) => { const p = got[keyOf(key, n)]; if (!p || p.rev !== rec.parts[n] || !Array.isArray(p.rows)) return false; parts.set(n, p.rows); return true; })) continue;
      const wb = join(rec.book || bookOf(GZ_SHEET_MODEL_OR().workbook()), parts);
      const content = new Map([...parts].map(([n, rows]) => [n, JSON.stringify(rows)]));
      content.set('', JSON.stringify(rec.book || null));
      const sigs = new Map([...content].map(([n, json]) => [n, sig(json)]));
      sigs.content = content;
      sigs.revision = rec.revision || 0;
      return { rec, wb, sigs };
    }
    throw new Error('torn read of a spreadsheet');
  };
  // A spreadsheet written through the worker (papers: lib/writer-papers.js open()): the parts plan() finds changed and the
  // book when it changed, with the card's text, the search text and the counts; a packed version ({ reason, gz, cells })
  // when one is asked for. Nothing is sent when nothing changed and nothing else is asked. show: a cell's shown text.
  // → { sigs (for the next write; the old ones if the write fails, as it throws), saved (the worker's answer, or null) }.
  const write = async (papers, key, wb, sigs, { patch = {}, dirty = null, version = null, show = plain, reason, base = sigs?.revision ?? 0 } = {}) => {
    const p = plan(wb, sigs, dirty);
    if (!p.changed && !version && !Object.keys(patch).length) return { sigs, saved: null };
    const m = measure(wb);
    const saved = await papers.save(key, { kind: 'sheet', ...(p.book && { book: p.book }), grid: glance(wb, show), text: text(wb, show), cells: m.cells, sheets: m.sheets, ...patch },
      { base, parts: p.parts, drop: p.drop, changed: p.changed, ...(version && { version }), ...(reason && { reason }) });
    p.sigs.revision = saved.paper.revision;
    return { sigs: p.sigs, saved };
  };
  const GZ_SHEET_MODEL_OR = () => (typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./lib/sheet-model.js'));

  return { BAND, TEXT_CAP, VERSIONS_CAP, PART, keyOf, enc, dec, split, join, serialize, deserialize, sig, plan, measure, text, glance, isGlance, pack, unpack, read, write };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_DATA; else GZ_SHEET_DATA;
