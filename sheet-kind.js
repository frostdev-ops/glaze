// Spreadsheets on the Documents page (papers.html): the sheet kind's page code (lib/doc-kinds.js). Settings → Writer →
// Spreadsheets (writer.sheets, defaults.js) adds the New band's Spreadsheet tile (create) and takes .xlsx, .csv and .tsv files
// (importFile); existing spreadsheets always open, copy and export. A card shows the record's 6×4 text (sheet-data.js
// glance). Opening one mounts the grid (sheet-grid.js) on the calc engine (lib/sheet-*.js). .xlsx files are read and written
// by GZ_SHEET_XLSX (lib/sheet-xlsx.js), loaded on demand before a file or the grid opens. Storage is sheet-data.js's alone.
// In an assignment's frame (writer-kinds.js) the same grid is the attempt's
// view (view), a brought .xlsx, .csv or .tsv becomes the attempt's record (into), and an empty attempt can start as a blank
// workbook (empty); the view's file() is what submit sends.
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
  // The .xlsx reader and writer and what they stand on, loaded the first time a spreadsheet is listed, opened, imported or
  // written (never with the page). One shared load; a failure rejects the operation and allows a later retry.
  const CODECS = ['lib/doctext.js', 'lib/zip.js', 'lib/sheet-xlsx.js'];
  // The charts a workbook's sheets keep, drawn on the grid; without them the grid opens all the same.
  const CHARTS = ['lib/sheet-chart-xml.js', 'lib/sheet-chart.js'];
  let codecLoad = null;
  const codecs = () => (codecLoad ||= Promise.resolve().then(() => need(CODECS)).then(() => {
    if (!xlsx()) throw new Error('lib/sheet-xlsx.js did not load');
    return true;
  }).catch((cause) => { codecLoad = null; throw Object.assign(new Error('Spreadsheet codecs did not load.', { cause }), { code: 'codecs' }); })).then(() => xlsx());
  // What a workbook read with parts left out says, once (lib/sheet-xlsx.js keep.problems), in a line Glaze already has.
  const NOTICE = { 'cap-cells': 'A workbook holds 250,000 cells.', 'cap-sheets': 'A workbook holds 100 sheets.' };
  const noticeOf = (wb) => { const p = wb?.keep?.problems || []; return p.length ? NOTICE[p.find((x) => NOTICE[x.code])?.code] || 'Some pictures, objects or equations were left out.' : undefined; };
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
  // A–F's widths in the grid's pixels (sheet-grid.js px.col, 64 where the sheet sets none), from the active sheet's colW in
  // the record's book (sheet-data.js enc: a Map as { $map: [[i, w]…] }); null when they are all one width.
  const widths = (book) => {
    const sh = book?.sheets?.[book.active] || book?.sheets?.[0], pairs = sh?.colW?.$map;
    if (!Array.isArray(pairs)) return null;
    const at = new Map();
    for (const p of pairs) if (Array.isArray(p) && Number.isInteger(p[0]) && p[0] >= 0 && p[0] < 6 && Number.isFinite(p[1]) && p[1] >= 0) at.set(p[0], p[1]);
    // Work in digit units above the pixel formula's safe range; its subpixel rounding is then immaterial. Dividing by
    // the largest keeps CSS's fractions finite even for huge stored widths, with a sum of at least one to fill the card.
    const ws = LETTERS.map((_, i) => { const w = at.get(i); return w === undefined ? 64 / 7 : w > Number.MAX_SAFE_INTEGER / 256 ? w : Math.trunc(((256 * w + Math.trunc(128 / 7)) / 256) * 7) / 7; });
    const largest = Math.max(...ws);
    return ws.some((w) => w !== ws[0]) && largest > 0 ? ws.map((w) => w / largest) : null;
  };
  // ---- the card's charts: the record's summary (sheet-data.js charts) as a small picture of each kind over the cells it
  // covers in A1:F4, the undrawn charts counted in the corner; a record kept before the summary counts its drawing's charts.
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); return e; };
  const HEX = /^#[0-9a-f]{6}$/i;
  // In a 24×16 box: 4–5 shapes in the chart's colours.
  const wedge = (cx, cy, rx, ry, a0, a1) => { const p = (a) => `${(cx + rx * Math.sin(a)).toFixed(2)} ${(cy - ry * Math.cos(a)).toFixed(2)}`; return `M${cx} ${cy}L${p(a0)}A${rx} ${ry} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}Z`; };
  const glyph = (kind, colours) => {
    const cs = colours.length ? colours : ['#156082', '#E97132', '#196B24', '#0F9ED5'], col = (i) => cs[i % cs.length];
    const H = [0.5, 0.8, 0.6, 1];
    if (kind === 'column' || kind === 'column3D') return H.map((v, i) => svgEl('rect', { x: 2 + i * 5.5, y: 15 - v * 13, width: 4, height: v * 13, fill: col(i) }));
    if (kind === 'bar' || kind === 'bar3D') return H.map((v, i) => svgEl('rect', { x: 1, y: 1 + i * 3.8, width: v * 22, height: 2.8, fill: col(i) }));
    if (kind === 'line') return [svgEl('path', { d: 'M2 13L8 8L14 10L22 3', fill: 'none', stroke: col(0), 'stroke-width': 1.6, 'stroke-linejoin': 'round' }), ...(cs.length > 1 ? [svgEl('path', { d: 'M2 15L8 12L14 13L22 9', fill: 'none', stroke: col(1), 'stroke-width': 1.6, 'stroke-linejoin': 'round' })] : [])];
    if (kind === 'area') return [svgEl('path', { d: 'M1 15L1 10L8 6L15 9L23 3L23 15Z', fill: col(0) })];
    if (kind === 'scatter') return [[4, 12], [9, 7], [15, 10], [20, 4]].map(([x, y], i) => svgEl('circle', { cx: x, cy: y, r: 1.8, fill: col(cs.length > 1 ? i : 0) }));
    if (kind === 'pie' || kind === 'doughnut' || kind === 'pie3D') {
      const n = Math.min(5, cs.length), flat = kind === 'pie3D', ry = flat ? 5 : 7, cy = flat ? 7 : 8, out = [];
      if (flat) out.push(svgEl('ellipse', { cx: 12, cy: cy + 3, rx: 10, ry, fill: col(0), class: 'gx-th-side' }));
      for (let i = 0; i < n; i++) out.push(n === 1 ? svgEl('ellipse', { cx: 12, cy, rx: flat ? 10 : 7, ry, fill: col(0) }) : svgEl('path', { d: wedge(12, cy, flat ? 10 : 7, ry, (i / n) * 2 * Math.PI, ((i + 1) / n) * 2 * Math.PI), fill: col(i) }));
      if (kind === 'doughnut') out.push(svgEl('circle', { cx: 12, cy, r: 3, class: 'gx-th-hole' }));
      return out;
    }
    return [svgEl('path', { d: 'M3 15h18M6 15v-5M11 15V3M16 15V8', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 })];
  };
  const svgOf = (kind, colours) => { const g = svgEl('svg', { viewBox: '0 0 24 16', preserveAspectRatio: 'xMidYMid meet' }); g.append(...glyph(kind, colours)); return g; };
  // Legacy records: scan only the active sheet's owned drawing, once per unchanged part. Recognize chart children
  // of the first graphic frame in each anchor, just as the chart reader does (Choice/Fallback is one object).
  const counts = new WeakMap();
  const countXml = (xml) => {
    const stack = [];
    let anchor = null, n = 0;
    const local = (name) => name.slice(name.lastIndexOf(':') + 1);
    const leave = (name) => {
      const i = stack.lastIndexOf(name);
      if (i < 0) return;
      stack.length = i;
      if (anchor && stack.length < anchor.depth) anchor = null;
      if (anchor?.frame && stack.length < anchor.frame) anchor.frame = 0;
      if (anchor?.data && stack.length < anchor.data) anchor.data = 0;
    };
    // Quoted attributes may contain >; comments and CDATA never contribute tags. No DOM or chart models per card.
    for (const m of xml.matchAll(/<(?:!--[\s\S]*?--|!\[CDATA\[[\s\S]*?\]\]|[!?][^>]*|\/?[\w:.-]+(?:[^"'<>]|"[^"]*"|'[^']*')*)>/g)) {
      const tag = /^<(\/?)([\w:.-]+)/.exec(m[0]);
      if (!tag) continue;
      const [, close, name] = tag, k = local(name);
      if (close) { leave(name); continue; }
      if (stack.length === 1 && local(stack[0]) === 'wsDr' && /^(twoCellAnchor|oneCellAnchor|absoluteAnchor)$/.test(k)) anchor = { depth: stack.length + 1, frame: 0, data: 0, frameSeen: false, dataSeen: false, found: false };
      if (anchor) {
        if (k === 'graphicFrame' && !anchor.frameSeen) { anchor.frame = stack.length + 1; anchor.frameSeen = true; }
        else if (k === 'graphicData' && anchor.frame && !anchor.dataSeen) { anchor.data = stack.length + 1; anchor.dataSeen = true; }
        else if (k === 'chart' && anchor.data && stack.length === anchor.data && !anchor.found) { anchor.found = true; n++; }
      }
      stack.push(name);
      if (/\/\s*>$/.test(m[0])) leave(name);
    }
    return n;
  };
  const counted = (book) => {
    const sh = book?.sheets?.[book.active] || book?.sheets?.[0], path = sh?.keep?.drawing?.path, parts = book?.keep?.parts;
    if (!path || !parts) return 0;
    const owners = book.sheets.filter((s) => s.keep?.drawing?.path === path);
    if ((owners.find((s) => s.keep.sourceId === s.id) || owners[0]) !== sh) return 0;
    const part = parts[path] ?? parts[Object.keys(parts).find((k) => k.toLowerCase() === String(path).toLowerCase())];
    if (!part || typeof part !== 'object') return 0;
    const data = part.data?.$b64 ?? part.data, cached = counts.get(part);
    if (cached?.data === data) return cached.n;
    let xml = data;
    if (typeof part.data?.$b64 === 'string') { try { xml = atob(data); } catch { xml = ''; } }
    const n = typeof xml === 'string' ? countXml(xml) : 0;
    counts.set(part, { data, n });
    return n;
  };
  const chartsOn = (box, rec) => {
    const list = Array.isArray(rec?.charts) ? rec.charts.slice(-32).filter((x) => x && Array.isArray(x.anchor) && x.anchor.length === 4 && x.anchor.every(Number.isSafeInteger)) : null;
    const kept = Array.isArray(rec?.charts) ? rec.charts.length : 0;
    const total = Number.isSafeInteger(rec?.chartCount) && rec.chartCount >= 0 ? rec.chartCount : kept === 32 ? Math.max(kept, counted(rec?.book)) : kept;
    let away = list ? Math.max(0, total - list.length) : counted(rec?.book);
    for (const x of list || []) {
      const [r0, c0, r1, c1] = x.anchor;
      if (r0 > 3 || c0 > 5 || r1 < 0 || c1 < 0 || r1 < r0 || c1 < c0) { away++; continue; }
      const kind = typeof x.kind === 'string' ? x.kind : 'chart', colours = Array.isArray(x.colours) ? x.colours.slice(0, 5).filter((c) => typeof c === 'string' && HEX.test(c)) : [];
      const m = h('i', { class: 'gx-th-chart', 'data-kind': kind });
      m.style.gridRow = `${Math.max(0, r0) + 2} / ${Math.min(3, r1) + 3}`;
      m.style.gridColumn = `${Math.max(0, c0) + 2} / ${Math.min(5, c1) + 3}`;
      m.append(svgOf(kind, colours));
      box.append(m);
    }
    if (away) box.append(h('i', { class: 'gx-th-more', 'data-count': String(away) }, svgOf('chart', []), h('b', { text: String(away) })));
  };
  const thumb = (rec) => {
    if (rec) codecs().catch((e) => console.error(e));
    const g = Array.isArray(rec?.grid) ? rec.grid : [];
    const box = h('div', { class: 'gx-thumb', 'aria-hidden': 'true' }, h('span', { class: 'gx-th-h' }), LETTERS.map((l) => h('span', { class: 'gx-th-h', text: l })));
    const ws = widths(rec?.book);
    if (ws) box.style.gridTemplateColumns = `14px ${ws.map((w) => `minmax(0, ${w}fr)`).join(' ')}`;
    for (let r = 0; r < 4; r++) {
      box.append(h('span', { class: 'gx-th-h', text: String(r + 1) }));
      for (let c = 0; c < 6; c++) { const s = typeof g[r]?.[c] === 'string' ? g[r][c] : ''; box.append(h('span', { class: /^[-+$€£(]?[\d.,]+%?\)?$/.test(s) ? 'gx-th-c gx-th-n' : 'gx-th-c', text: s })); }
    }
    if (rec) chartsOn(box, rec);
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
    return { book, grid: got.rec.grid, charts: got.rec.charts, chartCount: got.rec.chartCount, text: got.rec.text, cells: got.rec.cells, sheets: got.rec.sheets, parts: Object.fromEntries([...parts].map(([n, rows]) => [n, { rows }])) };
  };

  // ---- files: .xlsx, .csv and .tsv through GZ_SHEET_XLSX
  const stem = (name) => (globalThis.GZ_DOC_HOME ? GZ_DOC_HOME.stem(name) : String(name || '').replace(/\.[^./\\]+$/, '').trim().slice(0, 120));
  // A file as a workbook, its formulas calculated, each stage told to progress (lib/doc-kinds.js progress); a RangeError
  // (SAYS) when it is too large or can't be read.
  const workbookOf = async (file, progress = null) => {
    if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > DK.KINDS.sheet.max) throw new RangeError(SAYS.size);
    const p = typeof progress === 'function' ? progress : () => {};
    p({ stage: 'read', done: 0, total: file.size });
    await need([...ENGINE, 'sheet-grid.js']);
    const raw = await file.arrayBuffer();
    if (!(raw instanceof ArrayBuffer) || raw.byteLength !== file.size) throw new Error('invalid file read');
    p({ stage: 'read', done: raw.byteLength, total: raw.byteLength });
    p({ stage: 'prepare' });
    const X = await codecs(), bytes = new Uint8Array(raw);
    await need(CHARTS).catch((e) => console.error(e));
    const wb = /\.(csv|tsv)$/i.test(file.name) ? X.readDelimited(bytes, { name: file.name }) : await X.read(bytes).catch(() => null);
    if (!wb?.sheets?.length) throw new RangeError(SAYS.read);
    GZ_SHEET_CALC.engine(wb).recalc();
    return wb;
  };
  const importFile = async (file, { progress = null } = {}) => {
    const wb = await workbookOf(file, progress);
    progress?.({ stage: 'save' });
    const key = GZ_WRITER_PAPERS.newKey(), title = stem(file.name);
    await saveAll(key, wb, { named: !!title, title }, 'start');
    const notice = noticeOf(wb);
    return notice ? { key, notice } : key;
  };
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  // A spreadsheet as .xlsx, waiting for the writer. → { name, mime, bytes }.
  const fileOf = async (wb, title) => {
    const name = safe(title) || t('Spreadsheet');
    const X = await codecs(), bytes = await X.write(wb);
    return { name: `${name}.xlsx`, mime: DK.KINDS.sheet.mime, bytes };
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

  // The frame's submit and kind-change checkpoints keep the complete workbook, as the grid's own Versions do.
  const version = async (key, reason) => {
    await need(ENGINE);
    const got = await GZ_SHEET_DATA.read(get, key);
    if (got?.rec.kind !== 'sheet') throw new Error('document kind changed');
    const gz = await GZ_SHEET_DATA.pack(got.wb);
    return papers().save(key, {}, { expectedKind: 'sheet', base: got.rec.revision, version: { reason, gz, cells: GZ_SHEET_DATA.measure(got.wb).cells } });
  };

  // ---- the grid
  // A spreadsheet brought to an assignment (Open in Glaze, writer-kinds.js): the attempt's record becomes it, the paper it
  // held kept as a version first (the 'import' save), every part it had before dropped. → the record.
  const into = async (key, f, { progress = null } = {}) => {
    const wb = await workbookOf(f, progress), SD = GZ_SHEET_DATA;
    progress?.({ stage: 'save' });
    let had = (await get([`writerPaper:${key}`]))[`writerPaper:${key}`];
    const prior = had?.kind === 'sheet' ? await SD.read(get, key) : null;
    if (prior) had = prior.rec;
    const sigs = new Map(Object.keys(had?.parts || {}).map((n) => [n, 'stale']));
    const checkpoint = prior?.wb || wb, gz = await SD.pack(checkpoint);
    const paper = (await SD.write(papers(), key, wb, sigs, { base: had?.revision || 0, patch: { doc: null, words: 0 }, reason: 'import', show: shower(wb), version: { reason: prior ? 'import' : 'start', gz, cells: SD.measure(checkpoint).cells } })).saved.paper;
    const notice = noticeOf(wb);
    return notice ? { ...paper, notice } : paper;
  };
  // An empty attempt started as a spreadsheet (writer-kinds.js): what its record takes; the grid opens a blank workbook.
  const empty = () => ({ charts: [], chartCount: 0, grid: Array.from({ length: 4 }, () => Array(6).fill('')), text: '', cells: 0, sheets: 1 });
  const create = () => `papers.html?sheet=${encodeURIComponent(GZ_WRITER_PAPERS.newKey())}&new`;
  // host: an assignment's frame (view below): { mount, t, title, tools }. → the grid's surface (sheet-grid.js mount).
  const edit = async (key, { fresh = false, host = null } = {}) => {
    await need([...ENGINE, 'sheet-grid.js']);
    const got = fresh ? null : await GZ_SHEET_DATA.read(get, key);
    const wb = got?.wb || GZ_SHEET_MODEL.workbook();
    // A workbook from an .xlsx keeps parts whose references the codec moves as the grid edits: it is here before the grid.
    await codecs();
    await need(CHARTS).catch((e) => console.error(e));
    if (!host) document.documentElement.dataset.mode = 'sheet';
    const v = GZ_SHEET_GRID.mount({ key, wb, rec: got?.rec || null, sigs: got?.sigs || new Map(), fresh: !got, t: host?.t || t, locale, papers: papers(), show: shower,
      local: GZ_WRITER_PAPERS.local(key), fileOf, download, exportLabel: () => 'Export .xlsx', host });
    globalThis.GZ_PAPERS_MOTION?.shown('paper');
    return v;
  };
  const view = (key, host) => edit(key, { host });

  // Opening, copying and exporting stay registered; creating and importing follow the switch, read as Settings shows it
  // (defaults.js: its default where none is stored). papers.html loads defaults.js on demand; writer.html has it already,
  // and a second load would redeclare its consts. The page waits before it routes or draws.
  const DEFAULTS = ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js'];
  const on = Promise.resolve().then(() => (typeof GZ_SANITIZE === 'undefined' ? need(DEFAULTS) : null)).then(() => chrome.storage.sync.get('writer'))
    .then((r) => GZ_SANITIZE({ writer: r?.writer }).writer.sheets === true, () => false);
  DK.wait(on.then((yes) => DK.register('sheet', { edit, view, into, empty, thumb, file, exportFile, version, text, measure, copy, says: SAYS, exportLabel: 'Export .xlsx',
    ...(yes && { importFile, create }) })));
  globalThis.GZ_SHEET_KIND = Object.freeze({ shower, fileOf });
})();
