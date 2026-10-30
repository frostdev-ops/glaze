// Spreadsheets on the Documents page (papers.html): the sheet kind's page code (lib/doc-kinds.js). Settings → Writer →
// Spreadsheets (writer.sheets, off by default) adds the New band's Spreadsheet tile (create) and takes .xlsx and .csv files
// (importFile); existing spreadsheets always open, copy and export. A card shows the record's 6×4 text (sheet-data.js
// glance). Opening one mounts the grid (sheet-grid.js) on the calc engine (lib/sheet-*.js). .xlsx files are read and written
// by GZ_SHEET_XLSX (lib/sheet-xlsx.js) where the page has it; without it an .xlsx is refused and Export writes the active
// sheet as .csv. Storage is sheet-data.js's alone.
(() => {
  const DK = globalThis.GZ_DOC_KINDS;
  const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return globalThis.navigator?.language || 'en'; } })();
  // lib/i18n.js's GZ_I18N is a page-wide const, not a property of the window.
  const t = (k, v) => (typeof GZ_I18N !== 'undefined' ? GZ_I18N.t(k, v, locale) : k);
  const need = (files) => GZ_WRITER_PAPER.need(files);
  const FNS = ['math', 'math2', 'math3', 'stats', 'stats2', 'logical', 'logical2', 'lookup', 'lookup2', 'text', 'text2', 'date', 'info', 'financial', 'financial2', 'database'];
  const ENGINE = ['lib/sheet-model.js', 'lib/sheet-numfmt.js', 'lib/sheet-formula.js', 'lib/sheet-calc.js', ...FNS.map((f) => `lib/sheet-fn-${f}.js`), 'sheet-data.js'];
  const SAYS = { size: 'Choose a spreadsheet smaller than 15 MB.', read: 'That file could not be read.' };
  const xlsx = () => globalThis.GZ_SHEET_XLSX ?? null;
  let store = null;
  const papers = () => (store ||= GZ_WRITER_PAPERS.open());
  const get = (keys) => chrome.storage.local.get(keys);

  // A cell's shown text: its value in its style's number format (lib/sheet-numfmt.js).
  const shower = (wb) => (sh, r, c, x) => {
    if (x.t === 'e' || x.t === 's') return String(x.v ?? '');
    if (x.t === 'b') return x.v ? 'TRUE' : 'FALSE';
    if (x.t !== 'n') return '';
    try { return GZ_SHEET_NUMFMT.format(x.v, wb.styles[x.s ?? 0]?.fmt, { date1904: wb.date1904 }) ?? '#######'; } catch { return String(x.v); }
  };

  // ---- the card: the record's A1:F4 as text under column letters and row numbers
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };
  const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
  const thumb = (rec) => {
    const g = Array.isArray(rec?.grid) ? rec.grid : [];
    const box = h('div', { class: 'gx-thumb', 'aria-hidden': 'true' }, h('span', { class: 'gx-th-h' }), LETTERS.map((l) => h('span', { class: 'gx-th-h', text: l })));
    for (let r = 0; r < 4; r++) {
      box.append(h('span', { class: 'gx-th-h', text: String(r + 1) }));
      for (let c = 0; c < 6; c++) { const s = typeof g[r]?.[c] === 'string' ? g[r][c] : ''; box.append(h('span', { class: /^[-+$€£(]?[\d.,]+%?\)?$/.test(s) ? 'gx-th-c gx-th-n' : 'gx-th-c', text: s })); }
    }
    return box;
  };
  const text = (rec) => (typeof rec?.text === 'string' ? rec.text : '');
  const measure = (rec) => ({ cells: Number.isSafeInteger(rec?.cells) ? rec.cells : 0, sheets: Number.isSafeInteger(rec?.sheets) ? rec.sheets : 0 });

  // ---- storage through sheet-data.js
  const saveAll = async (key, wb, patch, version) => {
    const SD = GZ_SHEET_DATA;
    const gz = version ? await SD.pack(wb) : null;
    return SD.write(papers(), key, wb, new Map(), { patch, show: shower(wb), ...(gz && { version: { reason: version, gz, cells: SD.measure(wb).cells } }) });
  };
  // A copy: the book and every part under the copy's key (papers.js saves it with the parts this gives).
  const copy = async (rec) => {
    await need(ENGINE);
    const got = rec?.key ? await GZ_SHEET_DATA.read(get, rec.key) : null;
    if (!got) return {};
    const { book, parts } = GZ_SHEET_DATA.split(got.wb);
    return { book, grid: rec.grid, text: rec.text, cells: rec.cells, sheets: rec.sheets, parts: Object.fromEntries([...parts].map(([n, rows]) => [n, { rows }])) };
  };

  // ---- files: .xlsx through GZ_SHEET_XLSX, .csv by the grid's reader
  const stem = (name) => (globalThis.GZ_DOC_HOME ? GZ_DOC_HOME.stem(name) : String(name || '').replace(/\.[^./\\]+$/, '').trim().slice(0, 120));
  const fromCsv = (textIn) => {
    const M = GZ_SHEET_MODEL, G = GZ_SHEET_GRID, wb = M.workbook(), sh = wb.sheets[0];
    const rows = G.parseDelimited(textIn, G.sniff(textIn));
    let cells = 0;
    rows.forEach((row, r) => row.forEach((v, c) => {
      const x = M.parseInput(v, { date1904: false });
      if (!x || r >= M.MAX_ROWS || c >= M.MAX_COLS) return;
      if (++cells > M.CAP.cells) throw new RangeError(SAYS.read);
      const cell = x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v };
      if (x.fmt) cell.s = M.internStyle(wb, { fmt: x.fmt });
      if (!sh.rows.has(r)) sh.rows.set(r, new Map());
      sh.rows.get(r).set(c, cell);
    }));
    return wb;
  };
  const importFile = async (file) => {
    if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > DK.KINDS.sheet.max) throw new RangeError(SAYS.size);
    await need([...ENGINE, 'sheet-grid.js']);
    const raw = await file.arrayBuffer();
    if (!(raw instanceof ArrayBuffer) || raw.byteLength !== file.size) throw new Error('invalid file read');
    let wb = null;
    if (/\.csv$/i.test(file.name)) wb = fromCsv(new TextDecoder().decode(raw));
    else if (xlsx()) wb = await xlsx().read(new Uint8Array(raw)).catch(() => null);
    if (!wb?.sheets?.length) throw new RangeError(SAYS.read);
    GZ_SHEET_CALC.engine(wb).recalc();
    const key = GZ_WRITER_PAPERS.newKey(), title = stem(file.name);
    await saveAll(key, wb, { named: !!title, title }, 'start');
    return key;
  };
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  // A spreadsheet as its file: .xlsx where the writer is here, else its active sheet as .csv. → { name, mime, bytes } or null.
  const fileOf = async (wb, title) => {
    const name = safe(title) || t('Spreadsheet');
    if (xlsx()) { const bytes = await xlsx().write(wb); return { name: `${name}.xlsx`, mime: DK.KINDS.sheet.mime, bytes }; }
    const sh = wb.sheets[wb.active] || wb.sheets[0], show = shower(wb), rows = [];
    let cols = 0;
    for (const [r, row] of sh.rows) { rows[r] = row; for (const c of row.keys()) cols = Math.max(cols, c + 1); }
    const out = Array.from({ length: rows.length }, (_, r) => Array.from({ length: cols }, (_, c) => { const x = rows[r]?.get(c); return x ? show(sh, r, c, x) : ''; }));
    return { name: `${name}.csv`, mime: 'text/csv', bytes: new TextEncoder().encode(`﻿${GZ_SHEET_GRID.writeDelimited(out, ',')}`) };
  };
  const file = async (key) => {
    await need([...ENGINE, 'sheet-grid.js']);
    const got = await GZ_SHEET_DATA.read(get, key);
    return got ? fileOf(got.wb, got.rec.title) : null;
  };
  let exported = null;
  const download = (f) => {
    if (exported) URL.revokeObjectURL(exported);
    exported = URL.createObjectURL(new Blob([f.bytes], { type: f.mime }));
    const a = h('a', { href: exported, download: f.name });
    document.body.append(a); a.click(); a.remove();
  };
  globalThis.addEventListener?.('pagehide', (e) => { if (!e.persisted && exported) { URL.revokeObjectURL(exported); exported = null; } });
  const exportFile = async (key) => { const f = await file(key); if (f) download(f); };

  // ---- the grid
  const create = () => `papers.html?sheet=${encodeURIComponent(GZ_WRITER_PAPERS.newKey())}&new`;
  const edit = async (key, { fresh = false } = {}) => {
    document.documentElement.dataset.mode = 'sheet';
    await need([...ENGINE, 'sheet-grid.js']);
    const got = fresh ? null : await GZ_SHEET_DATA.read(get, key).catch((e) => { console.warn(e); return null; });
    const wb = got?.wb || GZ_SHEET_MODEL.workbook();
    GZ_SHEET_GRID.mount({ key, wb, rec: got?.rec || null, sigs: got?.sigs || new Map(), fresh: !got, t, locale, papers: papers(), show: shower,
      local: GZ_WRITER_PAPERS.local(key), exportFile: async () => download(await fileOf(wb, (await papers().get(key))?.title)), exportLabel: () => (xlsx() ? 'Export .xlsx' : 'Export .csv') });
    globalThis.GZ_PAPERS_MOTION?.shown('paper');
  };

  // Opening, copying and exporting stay registered; creating and importing follow the switch. The page waits before it
  // routes or draws.
  const on = Promise.resolve().then(() => chrome.storage.sync.get('writer')).then((r) => r?.writer?.sheets === true, () => false);
  DK.wait(on.then((yes) => DK.register('sheet', { edit, thumb, file, exportFile, text, measure, copy, says: SAYS, get exportLabel() { return xlsx() ? 'Export .xlsx' : 'Export .csv'; },
    ...(yes && { importFile, create }) })));
  globalThis.GZ_SHEET_KIND = Object.freeze({ shower, fileOf });
})();
