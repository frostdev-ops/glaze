// Glaze Sheets' files: read(bytes) turns an .xlsx (or .xlsm) into the workbook model (lib/sheet-model.js), write(wb)
// turns the model back into .xlsx bytes, and readDelimited/writeDelimited do the same for CSV and TSV.
// What the model holds is read into it; what it doesn't is kept and written back as it came: unknown package parts byte
// for byte in wb.keep.parts, a part's other relationships, and a sheet's other elements (conditional formats, data
// validations, hyperlinks, page setup, drawings, extLst…) as their XML, with the cell references in them moved by the rows
// and columns inserted or deleted since (track()). Pivot tables, slicers, query tables, external links and macros are
// kept too, and locked() refuses the structural edits that would leave them pointing at the wrong cells.
// Styles: wb.styles[i] is the file's cellXfs[i], as the difference from the workbook's default font: { fmt (a built-in
// id 0-163 or a format code), font, size, bold, italic, underline, strike, color, vert, fontFamily, fontScheme, charset,
// outline, shadow, condense, extend, fill (solid '#RRGGBB'), pattern { type, fg, bg }, gradient (its XML), border { left,
// right, top, bottom, diagonal: { style, color }, up, down }, h, v, wrap, indent, rotate, shrink, reading, justifyLast,
// locked, hidden, quote, xfId }. Colours are '#RRGGBB', theme colours and tints resolved; the theme or palette entry a
// colour came from is remembered (wb.keep.styles.colors) and written back. A rich text cell has rich: [{ text, …the same
// font fields }]. Sizes: colW and rowH in pixels at 96 dpi (Excel's character widths for a 7-pixel digit; points × 4/3).
// Bounded: the archive by lib/doctext.js's limits, cells and sheets by the model's caps; a part that can't be read is
// left out and listed in wb.keep.problems, so read() fails only for a file that is no workbook at all.
// Rimeward's parseDelimited (notebook-spreadsheet.ts, MIT, the same owner) is the CSV parser's start.
// Classic script; module.exports for node.
var GZ_SHEET_XLSX = globalThis.GZ_SHEET_XLSX || (() => {
  const M = typeof GZ_SHEET_MODEL !== 'undefined' ? GZ_SHEET_MODEL : require('./sheet-model.js');
  const F = typeof GZ_SHEET_FORMULA !== 'undefined' ? GZ_SHEET_FORMULA : require('./sheet-formula.js');
  const NF = typeof GZ_SHEET_NUMFMT !== 'undefined' ? GZ_SHEET_NUMFMT : require('./sheet-numfmt.js');
  const D = typeof GZ_DOCTEXT !== 'undefined' ? GZ_DOCTEXT : require('./doctext.js');
  const { MAX_ROWS, MAX_COLS, CAP } = M;
  const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };

  // ── XML ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const local = (name) => name.slice(name.lastIndexOf(':') + 1);
  const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const attrsOf = (s) => { const out = {}; for (const m of s.matchAll(ATTR)) out[m[1]] = D.decode(m[2] ?? m[3]); return out; };
  // A part as a tree: { name, a (attributes), kids, text, at, end } with at/end its span in src, for keeping it raw.
  const tree = (src) => {
    const root = { name: '', a: {}, kids: [], at: 0, end: src.length };
    const stack = [root];
    for (const tk of D.tokens(src)) {
      const top = stack[stack.length - 1];
      if (!tk.name) { if (stack.length > 1) top.text = (top.text ?? '') + (tk.cdata ?? D.decode(tk.text)); continue; }
      if (tk.close) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name !== tk.name) continue;
          for (let j = stack.length - 1; j >= i; j--) stack[j].end = tk.end;
          stack.length = i;
          break;
        }
        continue;
      }
      const node = { name: tk.name, a: attrsOf(tk.attrs), raw: tk.attrs, kids: [], text: undefined, at: tk.at, end: tk.end, open: tk.end };
      top.kids.push(node);
      if (!tk.empty) stack.push(node);
    }
    for (let j = stack.length - 1; j > 0; j--) stack[j].end = src.length;
    return root;
  };
  const kid = (n, name) => n?.kids.find((k) => local(k.name) === name) ?? null;
  const kids = (n, name) => n?.kids.filter((k) => local(k.name) === name) ?? [];
  const textOf = (n) => (n.text ?? '') + n.kids.map(textOf).join('');
  const truthy = (v) => v === '1' || v === 'true';
  // OOXML's escape for characters XML can't hold: _xHHHH_ (and _x005F_ before a literal one).
  const unescape = (s) => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // Text for a <t> or <v>: XML-escaped, OOXML-escaped where XML can't carry the character (CR, controls, lone surrogates).
  const escText = (s) => esc(String(s).replace(/_x[0-9A-Fa-f]{4}_/g, '_x005F$&')
    .replace(/[\x00-\x08\x0b-\x1f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`));
  const tag = (name, a, body) => {
    const at = Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => ` ${k}="${esc(v === true ? '1' : v)}"`).join('');
    return body === undefined || body === '' ? `<${name}${at}/>` : `<${name}${at}>${body}</${name}>`;
  };
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  // ── Package ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const SML = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
  const TYPES = {
    main: `${CT}sheet.main+xml`, macro: 'application/vnd.ms-excel.sheet.macroEnabled.main+xml', sheet: `${CT}worksheet+xml`,
    styles: `${CT}styles+xml`, strings: `${CT}sharedStrings+xml`, rels: 'application/vnd.openxmlformats-package.relationships+xml',
    core: 'application/vnd.openxmlformats-package.core-properties+xml', app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  };
  const kindOf = (type) => type.slice(type.lastIndexOf('/') + 1);
  const dirOf = (path) => path.slice(0, path.lastIndexOf('/') + 1);
  const relsPath = (path) => `${dirOf(path)}_rels/${path.slice(dirOf(path).length)}.rels`;
  const resolve = (from, target) => {
    const out = [];
    for (const p of (target.startsWith('/') ? target.slice(1) : dirOf(from) + target).split('/')) if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p);
    return out.join('/');
  };
  // A target relative to the part that names it, as Excel writes one.
  const relative = (from, path) => {
    const a = dirOf(from).split('/').filter(Boolean), b = path.split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    return '../'.repeat(a.length - i) + b.slice(i).join('/');
  };

  // ── Colours ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  const rgbHex = (s) => (/^[0-9A-Fa-f]{8}$/.test(s) ? `#${s.slice(2).toUpperCase()}` : /^[0-9A-Fa-f]{6}$/.test(s) ? `#${s.toUpperCase()}` : null);
  // Excel's tint: the colour's HLS lightness moved toward black (tint < 0) or white (tint > 0) by |tint|.
  const tinted = (hex, tint) => {
    if (!tint) return hex;
    let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    const hue = (p, q, t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    if (s === 0) r = g = b = l;
    else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3); }
    return `#${hex2(r * 255)}${hex2(g * 255)}${hex2(b * 255)}`;
  };
  // Indexed colours 0-7 repeat the first eight of the palette; 64 and 65 are the system's text and window colours.
  const INDEXED = [...NF.PALETTE.slice(0, 8), ...NF.PALETTE];
  // A theme's colours in the order a colour's theme="n" counts them: lt1, dk1, lt2, dk2 (the file lists dk1 first), then
  // the six accents, hlink and folHlink.
  const THEME_ORDER = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const DEFAULT_THEME = ['#FFFFFF', '#000000', '#E8E8E8', '#0E2841', '#156082', '#E97132', '#196B24', '#0F9ED5', '#A02B93', '#4EA72E', '#467886', '#96607D'];
  const readTheme = (x) => {
    const scheme = kid(kid(kid(tree(x), 'theme'), 'themeElements'), 'clrScheme');
    if (!scheme) return null;
    return THEME_ORDER.map((n, i) => {
      const c = kid(scheme, n)?.kids[0];
      const v = c && (local(c.name) === 'sysClr' ? c.a.lastClr : c.a.val);
      return (v && rgbHex(v)) || DEFAULT_THEME[i];
    });
  };
  // A <color>/<fgColor>/<bgColor> as '#RRGGBB'; where it came from goes into `seen` (hex → its attributes), so a colour
  // written back keeps its theme or palette entry.
  const colorOf = (n, ctx) => {
    if (!n) return undefined;
    const a = n.a, tint = Number(a.tint) || 0;
    let hex, spec = null;
    if (a.rgb !== undefined) hex = rgbHex(a.rgb) ?? '#000000';
    else if (a.theme !== undefined) { hex = ctx.theme[Number(a.theme)] ?? '#000000'; spec = { theme: a.theme }; }
    else if (a.indexed !== undefined) {
      const i = Number(a.indexed);
      hex = ctx.palette[i] ?? (i === 65 ? '#FFFFFF' : '#000000');
      spec = { indexed: a.indexed };
    } else if (truthy(a.auto)) { hex = '#000000'; spec = { auto: '1' }; } else return undefined;
    const out = tinted(hex, tint);
    if (spec && tint) spec.tint = a.tint;
    if (spec && !ctx.seen.has(out)) ctx.seen.set(out, spec);
    return out;
  };

  // ── Styles ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const FONT_FLAGS = { b: 'bold', i: 'italic', strike: 'strike', outline: 'outline', shadow: 'shadow', condense: 'condense', extend: 'extend' };
  const FONT_KEYS = ['font', 'size', 'bold', 'italic', 'underline', 'strike', 'color', 'vert', 'fontFamily', 'fontScheme', 'charset', 'outline', 'shadow', 'condense', 'extend'];
  const fontOf = (n, ctx) => {
    const o = {};
    for (const k of n?.kids ?? []) {
      const name = local(k.name), v = k.a.val;
      if (FONT_FLAGS[name]) { if (v !== '0' && v !== 'false') o[FONT_FLAGS[name]] = true; continue; }
      switch (name) {
        case 'name': case 'rFont': if (v) o.font = v; break;
        case 'sz': if (Number.isFinite(Number(v))) o.size = Number(v); break;
        case 'u': if (v !== 'none') o.underline = v || 'single'; break;
        case 'vertAlign': if (v && v !== 'baseline') o.vert = v; break;
        case 'color': { const c = colorOf(k, ctx); if (c) o.color = c; break; }
        case 'family': if (Number.isFinite(Number(v))) o.fontFamily = Number(v); break;
        case 'scheme': if (v && v !== 'none') o.fontScheme = v; break;
        case 'charset': if (Number.isFinite(Number(v))) o.charset = Number(v); break;
        default:
      }
    }
    return o;
  };
  const fillOf = (n, ctx) => {
    const p = kid(n, 'patternFill');
    if (kid(n, 'gradientFill')) return { gradient: n.src.slice(kid(n, 'gradientFill').at, kid(n, 'gradientFill').end) };
    const type = p?.a.patternType ?? (kid(p, 'fgColor') ? 'solid' : 'none');
    if (!p || type === 'none') return {};
    const fg = colorOf(kid(p, 'fgColor'), ctx), bg = colorOf(kid(p, 'bgColor'), ctx);
    if (type === 'solid') return { fill: fg ?? '#000000' };
    return { pattern: { type, ...(fg && { fg }), ...(bg && { bg }) } };
  };
  const SIDES = ['left', 'right', 'top', 'bottom', 'diagonal'];
  const borderOf = (n, ctx) => {
    const o = {};
    for (const side of SIDES) {
      const s = kid(n, side) ?? (side === 'left' ? kid(n, 'start') : side === 'right' ? kid(n, 'end') : null);
      if (!s?.a.style || s.a.style === 'none') continue;
      const color = colorOf(kid(s, 'color'), ctx);
      o[side] = color ? { style: s.a.style, color } : { style: s.a.style };
    }
    if (truthy(n?.a.diagonalUp)) o.up = true;
    if (truthy(n?.a.diagonalDown)) o.down = true;
    return o;
  };
  const ALIGN = { horizontal: 'h', vertical: 'v', wrapText: 'wrap', indent: 'indent', textRotation: 'rotate', shrinkToFit: 'shrink', readingOrder: 'reading', justifyLastLine: 'justifyLast' };
  const alignOf = (n) => {
    const o = {};
    for (const [k, key] of Object.entries(ALIGN)) {
      const v = n?.a[k];
      if (v === undefined) continue;
      if (key === 'wrap' || key === 'shrink' || key === 'justifyLast') { if (truthy(v)) o[key] = true; }
      else if (key === 'h') { if (v !== 'general') o.h = v; }
      else if (key === 'v') { if (v !== 'bottom') o.v = v; }
      else if (Number(v)) o[key] = Number(v);
    }
    return o;
  };
  const diff = (o, base) => {
    const out = {};
    for (const k of new Set([...Object.keys(base), ...Object.keys(o)])) {
      if (stable(o[k]) !== stable(base[k])) out[k] = o[k] === undefined ? null : o[k];
    }
    return out;
  };
  const stable = (v) => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`) : JSON.stringify(v));

  // styles.xml → { styles (one per cellXfs entry), keep }: the fonts, fills, borders and number formats as written (so the
  // writer can point at them again, and the cell styles and dxfs that name them stay right), and the rest raw.
  const readStyles = (x, theme) => {
    const root = kid(tree(x), 'styleSheet');
    const raw = (n) => (n ? x.slice(n.at, n.end) : null);
    const palette = [...INDEXED];
    kids(kid(kid(root, 'colors'), 'indexedColors'), 'rgbColor').forEach((c, i) => { palette[i] = rgbHex(c.a.rgb ?? '') ?? palette[i]; });
    const ctx = { theme, palette, seen: new Map() };
    const list = (group, item, of) => kids(kid(root, group), item).map((n) => { n.src = x; return { xml: raw(n), o: of(n, ctx) }; });
    const fonts = list('fonts', 'font', fontOf), fills = list('fills', 'fill', fillOf), borders = list('borders', 'border', borderOf);
    const numFmts = kids(kid(root, 'numFmts'), 'numFmt').map((n) => ({ id: Number(n.a.numFmtId), code: n.a.formatCode ?? 'General' })).filter((f) => Number.isInteger(f.id));
    const codes = new Map(numFmts.map((f) => [f.id, f.code]));
    const base = fonts[0]?.o ?? {};
    const styles = kids(kid(root, 'cellXfs'), 'xf').map((xf) => {
      const a = xf.a, s = {};
      const id = Number(a.numFmtId ?? 0);
      if (id) s.fmt = id >= 164 ? codes.get(id) ?? 'General' : id;
      Object.assign(s, diff(fonts[Number(a.fontId ?? 0)]?.o ?? base, base));
      Object.assign(s, fills[Number(a.fillId ?? 0)]?.o ?? {});
      const border = borders[Number(a.borderId ?? 0)]?.o;
      if (border && Object.keys(border).length) s.border = border;
      Object.assign(s, alignOf(kid(xf, 'alignment')));
      const p = kid(xf, 'protection');
      if (p && p.a.locked !== undefined && !truthy(p.a.locked)) s.locked = false;
      if (p && truthy(p.a.hidden)) s.hidden = true;
      if (truthy(a.quotePrefix)) s.quote = true;
      if (Number(a.xfId)) s.xfId = Number(a.xfId);
      return s;
    });
    const keep = { root: root ? x.slice(root.at, root.open) : null, fonts: fonts.map((f) => f.xml), fills: fills.map((f) => f.xml), borders: borders.map((f) => f.xml),
      numFmts, colors: Object.fromEntries(ctx.seen), palette: kid(root, 'colors') ? raw(kid(root, 'colors')) : null };
    for (const n of ['cellStyleXfs', 'cellStyles', 'dxfs', 'tableStyles', 'extLst']) if (kid(root, n)) keep[n] = raw(kid(root, n));
    return { styles: styles.length ? styles : [{}], keep, ctx, base };
  };

  // Shared strings: { text, rich? } each, phonetic guides left out.
  const runOf = (r, ctx) => ({ text: unescape(kids(r, 't').map(textOf).join('')), ...fontOf(kid(r, 'rPr'), ctx) });
  const stringOf = (si, ctx) => {
    const runs = kids(si, 'r');
    if (!runs.length) return { text: unescape(kids(si, 't').map(textOf).join('')) };
    const rich = runs.map((r) => runOf(r, ctx));
    return { text: rich.map((r) => r.text).join(''), rich };
  };

  // ── Worksheets ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // CT_Worksheet's element order, which the writer keeps.
  const ORDER = ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetCalcPr', 'sheetProtection', 'protectedRanges',
    'scenarios', 'autoFilter', 'sortState', 'dataConsolidate', 'customSheetViews', 'mergeCells', 'phoneticPr', 'conditionalFormatting',
    'dataValidations', 'hyperlinks', 'printOptions', 'pageMargins', 'pageSetup', 'headerFooter', 'rowBreaks', 'colBreaks', 'customProperties',
    'cellWatches', 'ignoredErrors', 'smartTags', 'drawing', 'legacyDrawing', 'legacyDrawingHF', 'drawingHF', 'picture', 'oleObjects', 'controls',
    'webPublishItems', 'tableParts', 'extLst'];
  const RANK = new Map(ORDER.map((n, i) => [n, i]));
  const MODELLED = new Set(['dimension', 'sheetViews', 'cols', 'sheetData', 'autoFilter', 'mergeCells']);
  const MDW = 7;
  const pxFromWidth = (w) => Math.max(0, Math.trunc(((256 * w + Math.trunc(128 / MDW)) / 256) * MDW));
  const widthFromPx = (px) => {
    const chars = Math.max(0, Math.trunc(((px - 5) / MDW) * 100 + 0.5) / 100);
    return Math.trunc(((chars * MDW + 5) / MDW) * 256) / 256;
  };
  const pxFromPt = (pt) => (pt * 4) / 3;
  const ptFromPx = (px) => Math.round(px * 75) / 100;
  // Excel's typeless ISO dates (t="d") as serial numbers.
  const isoSerial = (s, date1904) => {
    const m = /^(?:(\d{4})-(\d{2})-(\d{2}))?(?:T?(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(String(s).trim());
    if (!m || (!m[1] && !m[4])) return null;
    const day = m[1] ? M.toSerial(+m[1], +m[2], +m[3], date1904) : 0;
    return day + (m[4] ? M.timeSerial(+m[4], +m[5], +(m[6] ?? 0)) : 0);
  };

  const fromFile = (text) => stripParams(F.fromFile(text));
  // LET and LAMBDA parameters are written _xlpm.x in a file and x in Glaze.
  const stripParams = (text) => {
    if (!/_xlpm\./i.test(text)) return text;
    let toks;
    try { toks = F.tokenize(text); } catch { return text; }
    return (String(text)[0] === '=' ? '=' : '') + toks.map((t) => (t.k === 'name' && !t.sheet && /^_xlpm\./i.test(t.name) ? t.name.slice(6) : t.s)).join('');
  };
  const addParams = (text) => {
    if (!/\b(?:LET|LAMBDA)\s*\(/i.test(text)) return text;
    let toks;
    try { toks = F.tokenize(text); } catch { return text; }
    const scopes = [];
    toks.forEach((t, i) => {
      if (t.k !== 'fn' || (t.name !== 'LET' && t.name !== 'LAMBDA')) return;
      let j = i + 1;
      while (toks[j]?.k === 'ws') j++;
      if (toks[j]?.k !== '(') return;
      const args = [[]];
      let depth = 0, end = toks.length;
      for (let k = j; k < toks.length; k++) {
        const x = toks[k];
        if (x.k === '(' || x.k === '{') depth++;
        else if (x.k === ')' || x.k === '}') { if (--depth === 0) { end = k; break; } }
        else if (x.k === ',' && depth === 1) { args.push([]); continue; }
        if (depth >= 1 && k > j) args.at(-1).push(x);
      }
      const names = new Set();
      args.slice(0, -1).forEach((arg, n) => {
        const words = arg.filter((x) => x.k !== 'ws');
        if ((t.name === 'LAMBDA' || n % 2 === 0) && words.length === 1 && words[0].k === 'name' && !words[0].sheet) names.add(words[0].name.toLowerCase());
      });
      if (names.size) scopes.push({ from: i, to: end, names });
    });
    if (!scopes.length) return text;
    return (String(text)[0] === '=' ? '=' : '') + toks.map((t, i) => (t.k === 'name' && !t.sheet && !/^_xlpm\./i.test(t.name)
      && scopes.some((s) => i > s.from && i < s.to && s.names.has(t.name.toLowerCase())) ? `_xlpm.${t.name}` : t.s)).join('');
  };
  const toFile = (text) => addParams(F.toFile(text));

  // One worksheet's XML into the model sheet `sh`: sheetData streams; the root's other children are read as spans of x.
  // budget: { cells } across the workbook.
  const readSheet = (x, sh, ctx, budget) => {
    const keep = sh.keep, rows = sh.rows, pending = [];
    let depth = 0, open = null, inData = false, root = { at: 0, open: 0 };
    let r = -1, c = -1, cur = null, field = null;
    const shared = new Map(), sharedKids = [];
    const finish = () => {
      const k = cur;
      cur = null;
      if (budget.cells >= CAP.cells) { budget.over = true; return; }
      let cell = null;
      const v = k.v;
      if (k.t === 'inlineStr') {
        if (k.inline) cell = k.inline.rich ? { t: 's', v: k.inline.text, rich: k.inline.rich } : { t: 's', v: k.inline.text };
      } else if (v !== undefined) {
        switch (k.t) {
          case 's': {
            const str = ctx.strings[Number(v)];
            if (!str) { ctx.problem(sh, 'string', `${M.cellName(k.r, k.c)}: shared string ${v} is missing`); cell = { t: 's', v: '' }; break; }
            cell = str.rich ? { t: 's', v: str.text, rich: str.rich } : { t: 's', v: str.text };
            break;
          }
          case 'str': cell = { t: 's', v: unescape(v) }; break;
          case 'b': cell = { t: 'b', v: truthy(v.trim()) }; break;
          case 'e': cell = { t: 'e', v: v.trim() }; break;
          case 'd': { const n = isoSerial(v, ctx.date1904); cell = n === null ? { t: 's', v } : { t: 'n', v: n }; break; }
          default: {
            const n = Number(v);
            cell = v.trim() !== '' && Number.isFinite(n) ? { t: 'n', v: n || 0 } : { t: 's', v };
          }
        }
      }
      if (k.f !== undefined || k.fkind) {
        cell ??= { t: 'z' };
        if (k.fkind === 'dataTable') cell.dt = k.fraw;
        else if (k.fkind === 'shared' && !k.f) sharedKids.push([k.r, k.c, k.si]);
        else if (k.f.length > CAP.formula) ctx.problem(sh, 'formula', `${M.cellName(k.r, k.c)}: formula too long`);
        else {
          cell.f = k.f;
          if (k.fkind === 'shared' && k.si !== undefined) shared.set(k.si, { f: k.f, r: k.r, c: k.c });
          if (k.fkind === 'array') {
            const g = M.rangePosition(k.ref ?? '');
            cell.a = g && g.r0 === k.r && g.c0 === k.c ? M.rangeName(g.r0, g.c0, g.r1, g.c1) : M.cellName(k.r, k.c);
          }
        }
      }
      if (cell && k.cm !== undefined) cell.cm = k.cm;
      if (cell && k.vm !== undefined) cell.vm = k.vm;
      const s = k.s > 0 && k.s < ctx.styleCount ? k.s : 0;
      if (!cell) { if (!s) return; cell = { t: 'z' }; }
      if (s) cell.s = s;
      let row = rows.get(k.r);
      if (!row) rows.set(k.r, (row = new Map()));
      if (!row.has(k.c)) budget.cells++;
      row.set(k.c, cell);
    };
    const cellTag = (tk, n) => {
      if (n === 'row') {
        if (tk.close) return;
        const a = attrsOf(tk.attrs);
        const rr = a.r !== undefined ? Number(a.r) - 1 : r + 1;
        if (!Number.isInteger(rr) || rr < 0 || rr >= MAX_ROWS) { ctx.problem(sh, 'row', `row ${a.r} is out of range`); r = -2; return; }
        r = rr; c = -1;
        if (a.ht !== undefined && truthy(a.customHeight) && Number.isFinite(Number(a.ht))) sh.rowH.set(r, pxFromPt(Number(a.ht)));
        if (truthy(a.hidden)) sh.hidden.rows.add(r);
        const extra = {};
        if (a.ht !== undefined && !truthy(a.customHeight)) extra.ht = a.ht;
        if (truthy(a.customFormat) && a.s !== undefined) extra.s = a.s;
        for (const k of ['outlineLevel', 'collapsed', 'thickTop', 'thickBot']) if (a[k] !== undefined && a[k] !== '0' && a[k] !== 'false') extra[k] = a[k];
        if (Object.keys(extra).length) keep.rowAttrs.set(r, extra);
        return;
      }
      if (n === 'c') {
        if (tk.close) { if (cur) finish(); return; }
        const a = attrsOf(tk.attrs);
        const p = a.r !== undefined ? M.cellPosition(a.r) : null;
        if ((a.r !== undefined && !p) || r === -2) { ctx.problem(sh, 'cell', `cell ${a.r ?? ''} is out of range`); cur = null; return; }
        if (p) { r = p[0]; c = p[1]; } else { c++; if (r < 0) r = 0; }
        if (c >= MAX_COLS) { ctx.problem(sh, 'cell', 'a cell past the last column'); cur = null; return; }
        cur = { r, c, t: a.t ?? 'n', s: a.s !== undefined ? Number(a.s) : 0, cm: a.cm, vm: a.vm, v: undefined };
        if (tk.empty) finish();
        return;
      }
      if (!cur) return;
      if (field === 'is' && n !== 'is') return;
      if (n === 'f') {
        if (tk.close) { if (cur.fkind === 'dataTable') cur.fraw = x.slice(cur.fat, tk.end); field = null; return; }
        const a = attrsOf(tk.attrs);
        cur.fkind = a.t === 'shared' || a.t === 'array' || a.t === 'dataTable' ? a.t : null;
        cur.ref = a.ref; cur.si = a.si; cur.fat = tk.at;
        if (cur.fkind === 'dataTable' && tk.empty) cur.fraw = x.slice(tk.at, tk.end);
        if (tk.empty) { if (!cur.fkind) cur.f = ''; } else { cur.f = ''; field = 'f'; }
      } else if (n === 'v') {
        if (tk.close) { field = null; return; }
        cur.v = '';
        if (!tk.empty) field = 'v';
      } else if (n === 'is') {
        if (tk.close) { cur.inline = stringOf(tree(x.slice(cur.isAt, tk.end)).kids[0], ctx.colors); field = null; return; }
        if (tk.empty) { cur.inline = { text: '' }; return; }
        cur.isAt = tk.at;
        field = 'is';
      }
    };
    for (const tk of D.tokens(x)) {
      if (inData) {
        if (!tk.name) { if (cur && (field === 'f' || field === 'v')) cur[field] += tk.cdata ?? D.decode(tk.text); continue; }
        const n = local(tk.name);
        if (n === 'sheetData' && tk.close) { inData = false; continue; }
        cellTag(tk, n);
        continue;
      }
      if (!tk.name) continue;
      if (tk.close) {
        depth--;
        if (depth === 1 && open) { pending.push({ name: open.name, from: open.from, to: tk.end }); open = null; }
        continue;
      }
      if (depth === 0) { root = { at: tk.at, open: tk.end }; if (!tk.empty) depth = 1; continue; }
      if (depth === 1) {
        if (local(tk.name) === 'sheetData') { if (!tk.empty) inData = true; continue; }
        if (tk.empty) { pending.push({ name: tk.name, from: tk.at, to: tk.end }); continue; }
        open = { name: tk.name, from: tk.at };
        depth = 2;
        continue;
      }
      if (!tk.empty) depth++;
    }
    // Shared formulas: a cell naming only its group gets the formula moved from the cell that holds it.
    for (const [rr, cc, si] of sharedKids) {
      const m = shared.get(si), cell = rows.get(rr)?.get(cc);
      if (!cell) continue;
      if (!m) { ctx.problem(sh, 'formula', `${M.cellName(rr, cc)}: shared formula ${si} has no first cell`); continue; }
      const f = F.move(m.f, rr - m.r, cc - m.c);
      if (f.length <= CAP.formula) cell.f = f;
    }
    for (const row of rows.values()) for (const cell of row.values()) if (cell.f !== undefined) cell.f = fromFile(cell.f);
    keep.root = x.slice(root.at, root.open);
    for (const p of pending) readSection(p.name, x.slice(p.from, p.to), sh, ctx);
  };

  // A worksheet's other elements: the ones the model has, and the rest kept in order.
  const readSection = (name, xml, sh, ctx) => {
    const n = local(name), keep = sh.keep;
    const node = tree(xml).kids[0];
    if (!node) return;
    const rank = RANK.has(n) ? RANK.get(n) : keep.lastRank + 0.5;
    if (RANK.has(n)) keep.lastRank = rank;
    switch (n) {
      case 'dimension': return;
      case 'sheetViews': {
        const views = kids(node, 'sheetView');
        const view = views[0];
        if (!view) return;
        const pane = kid(view, 'pane');
        const frozen = pane && /^frozen/.test(pane.a.state ?? '');
        const rows = frozen ? Math.max(0, Math.trunc(Number(pane.a.ySplit) || 0)) : 0, cols = frozen ? Math.max(0, Math.trunc(Number(pane.a.xSplit) || 0)) : 0;
        sh.freeze = rows || cols ? { rows, cols } : null;
        const inner = view.kids.map((k) => xml.slice(k.at, k.end)).join('');
        keep.view = { attrs: view.a, inner, freeze: sh.freeze, more: views.slice(1).map((v) => xml.slice(v.at, v.end)).join('') };
        return;
      }
      case 'sheetFormatPr': {
        const a = node.a;
        if (a.defaultColWidth !== undefined) keep.defaults.colW = pxFromWidth(Number(a.defaultColWidth));
        else if (a.baseColWidth !== undefined) keep.defaults.colW = pxFromWidth(Math.trunc(((Number(a.baseColWidth) * MDW + 5) / MDW) * 256) / 256);
        if (Number(a.defaultRowHeight)) keep.defaults.rowH = pxFromPt(Number(a.defaultRowHeight));
        keep.xml.push({ name, rank, xml });
        return;
      }
      case 'cols':
        for (const col of kids(node, 'col')) {
          const a = col.a, min = Number(a.min) - 1, max = Math.min(Number(a.max) - 1, MAX_COLS - 1);
          if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) continue;
          const extra = {};
          for (const k of ['style', 'outlineLevel', 'collapsed', 'bestFit', 'phonetic']) if (a[k] !== undefined && a[k] !== '0' && a[k] !== 'false') extra[k] = a[k];
          for (let i = min; i <= max; i++) {
            if (a.width !== undefined && Number.isFinite(Number(a.width))) sh.colW.set(i, pxFromWidth(Number(a.width)));
            if (truthy(a.hidden)) sh.hidden.cols.add(i);
            if (Object.keys(extra).length) keep.colAttrs.set(i, extra);
          }
        }
        return;
      case 'mergeCells':
        for (const m of kids(node, 'mergeCell')) {
          const g = M.rangePosition(m.a.ref ?? '');
          if (g && (g.r1 > g.r0 || g.c1 > g.c0)) sh.merges.push(g);
        }
        return;
      case 'autoFilter': {
        const g = M.rangePosition(node.a.ref ?? '');
        if (!g) { keep.xml.push({ name, rank, xml }); return; }
        sh.filter = { ...g };
        const inner = node.kids.map((k) => xml.slice(k.at, k.end)).join('');
        if (inner) sh.filter.xml = inner;
        return;
      }
      default:
        keep.xml.push({ name, rank, xml });
    }
  };

  const relsOf = (xml, from) => {
    const out = [];
    for (const n of kids(kid(tree(xml ?? ''), 'Relationships'), 'Relationship')) {
      const { Id: id, Type: type = '', Target: target, TargetMode: mode } = n.a;
      if (!id || target === undefined) continue;
      out.push({ id, type, kind: kindOf(type), target, mode, path: mode === 'External' ? null : resolve(from, target) });
    }
    return out;
  };

  // Why structural edits on a sheet are refused: what keeps cell addresses Glaze can't move.
  const LOCKS = { pivotTable: 'pivot', slicer: 'slicer', timeline: 'slicer', queryTable: 'query' };

  // .xlsx bytes → the workbook model. opts.limits lowers doctext's archive limits.
  const read = async (bytes, opts = {}) => {
    const z = D.unzip(bytes, opts);
    const byLow = new Map(z.names.filter((n) => !n.endsWith('/')).map((n) => [n.toLowerCase(), n]));
    const real = (p) => byLow.get(String(p).toLowerCase()) ?? null;
    const used = new Set();
    const problems = [];
    const problem = (sh, code, message) => { if (problems.length < 100) problems.push({ ...(sh && { sheet: sh.name }), code, message }); };
    const text = async (p, own = true) => {
      const name = real(p);
      if (!name) return null;
      if (own) used.add(name);
      try { return await z.text(name); } catch (e) { problem(null, 'part', `${p}: ${e.message}`); return null; }
    };
    const relsFor = async (p) => relsOf(await text(relsPath(p)), p);

    const types = { defaults: {}, overrides: {} };
    const ct = await text('[Content_Types].xml');
    for (const n of kid(tree(ct ?? ''), 'Types')?.kids ?? []) {
      if (local(n.name) === 'Default' && n.a.Extension) types.defaults[n.a.Extension.toLowerCase()] = n.a.ContentType;
      if (local(n.name) === 'Override' && n.a.PartName) types.overrides[n.a.PartName.replace(/^\//, '').toLowerCase()] = n.a.ContentType;
    }
    const typeOf = (p) => types.overrides[p.toLowerCase()] ?? types.defaults[p.slice(p.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';
    const pkgRels = await relsFor('');
    const bookPath = real(pkgRels.find((r) => r.kind === 'officeDocument')?.path ?? 'xl/workbook.xml') ?? real('xl/workbook.xml');
    const bookXml = bookPath && await text(bookPath);
    if (!bookXml) fail('not-workbook', 'not an Excel workbook');
    const bookRels = await relsFor(bookPath);
    const book = kid(tree(bookXml), 'workbook');
    if (!book) fail('not-workbook', 'not an Excel workbook');

    const wb = M.workbook();
    wb.sheets = [];
    const wbPr = kid(book, 'workbookPr');
    wb.date1904 = truthy(wbPr?.a.date1904);
    const flags = { macros: false, pivots: false, external: false, slicers: false };
    const mainType = typeOf(bookPath);
    if (/macroEnabled/i.test(mainType) || bookRels.some((r) => r.kind === 'vbaProject')) flags.macros = true;
    if (bookRels.some((r) => r.kind === 'externalLink')) flags.external = true;
    if (bookRels.some((r) => r.kind === 'pivotCacheDefinition')) flags.pivots = true;
    if (bookRels.some((r) => /slicerCache|timelineCache/.test(r.kind))) flags.slicers = true;

    const relPart = (kind) => bookRels.find((r) => r.kind === kind && r.path);
    let theme = DEFAULT_THEME;
    const themeRel = relPart('theme');
    if (themeRel) { const t = await text(themeRel.path, false); theme = (t && readTheme(t)) || DEFAULT_THEME; }
    const stylesRel = relPart('styles');
    let st = null;
    if (stylesRel) {
      const sx = await text(stylesRel.path);
      try { if (sx) st = readStyles(sx, theme); } catch (e) { problem(null, 'styles', e.message); }
    }
    st ??= readStyles('', theme);
    wb.styles = st.styles;
    const stringsRel = relPart('sharedStrings');
    let strings = [];
    if (stringsRel) {
      const sx = await text(stringsRel.path);
      try {
        strings = kids(kid(tree(sx ?? ''), 'sst'), 'si').map((si) => stringOf(si, st.ctx));
      } catch (e) { problem(null, 'strings', e.message); }
    }
    for (const r of bookRels) if (r.kind === 'calcChain' && r.path && real(r.path)) used.add(real(r.path));
    const ctx = { strings, styleCount: wb.styles.length, date1904: wb.date1904, colors: st.ctx, problem };

    // Sheets, in tab order; chart sheets and the like are kept where they stand.
    const budget = { cells: 0, over: false };
    const others = [];
    const ids = new Set();
    const sheetEls = kids(kid(book, 'sheets'), 'sheet');
    const pivotSources = new Set();
    for (const r of bookRels.filter((x) => x.kind === 'pivotCacheDefinition' && x.path)) {
      const px = await text(r.path, false);
      const src = px && kid(kid(kid(tree(px), 'pivotCacheDefinition'), 'cacheSource'), 'worksheetSource');
      if (src?.a.sheet) pivotSources.add(src.a.sheet.toLowerCase());
    }
    for (const [i, el] of sheetEls.entries()) {
      const rid = el.a['r:id'] ?? Object.entries(el.a).find(([k]) => local(k) === 'id' && k.includes(':'))?.[1];
      const rel = bookRels.find((r) => r.id === rid);
      const name = el.a.name ?? `Sheet${i + 1}`;
      if (!rel || rel.kind !== 'worksheet' || !rel.path) {
        others.push({ xml: bookXml.slice(el.at, el.end), rel: rel ?? null, after: wb.sheets.at(-1)?.id ?? null });
        continue;
      }
      if (wb.sheets.length >= CAP.sheets) { problem(null, 'cap-sheets', `${name}: a workbook holds 100 sheets`); continue; }
      let id = Number(el.a.sheetId);
      if (!Number.isInteger(id) || id < 1 || ids.has(id)) id = Math.max(0, ...ids) + 1;
      ids.add(id);
      const sh = M.sheet(name, id);
      Object.assign(sh.keep, { path: real(rel.path) ?? rel.path, rels: [], xml: [], rowAttrs: new Map(), colAttrs: new Map(), defaults: { colW: 64, rowH: 20 }, lastRank: -1, locks: [] });
      if (el.a.state && el.a.state !== 'visible') sh.keep.state = el.a.state;
      wb.sheets.push(sh);
      const sx = await text(rel.path);
      if (sx == null) { problem(sh, 'sheet', `${name}: its part is missing or unreadable`); continue; }
      const srels = await relsFor(rel.path);
      sh.keep.rels = srels.map(({ id: rid2, type, target, mode }) => ({ id: rid2, type, target, ...(mode && { mode }) }));
      for (const r of srels) {
        if (LOCKS[r.kind]) sh.keep.locks.push(LOCKS[r.kind]);
        if (r.kind === 'drawing' && r.path) sh.keep.drawing = { id: r.id, path: real(r.path) ?? r.path };
        if (r.kind === 'table') (sh.keep.tables ??= []).push(real(r.path) ?? r.path);
        if (r.kind === 'comments') sh.keep.comments = real(r.path) ?? r.path;
      }
      if (pivotSources.has(name.toLowerCase())) sh.keep.locks.push('pivot');
      try {
        readSheet(sx, sh, ctx, budget);
      } catch (e) {
        problem(sh, 'sheet', `${name}: ${e.message}`);
      }
      if (budget.over) { problem(sh, 'cap-cells', `${name}: a workbook holds 250,000 cells; the rest were left out`); budget.over = false; }
      if (/x14:slicerList|x15:timelineRefs/.test(sx)) sh.keep.locks.push('slicer');
      for (const row of sh.rows.values()) for (const cell of row.values()) if (cell.f !== undefined && /(^|[^\w.])\[\d+\]/.test(cell.f)) { if (!sh.keep.locks.includes('external')) sh.keep.locks.push('external'); }
      sh.keep.locks = [...new Set(sh.keep.locks)];
      delete sh.keep.lastRank;
    }
    if (!wb.sheets.length) {
      const sh = M.sheet('Sheet1', 1);
      Object.assign(sh.keep, { rels: [], xml: [], rowAttrs: new Map(), colAttrs: new Map(), defaults: { colW: 64, rowH: 20 }, locks: [] });
      wb.sheets.push(sh);
      problem(null, 'sheets', 'the workbook has no worksheet Glaze can read');
    }

    // Defined names; a sheet-scoped one counts its sheet among all of them, chart sheets included.
    const allSheets = [];
    let k = 0;
    for (const el of sheetEls) {
      const rid = el.a['r:id'] ?? Object.entries(el.a).find(([kk]) => local(kk) === 'id' && kk.includes(':'))?.[1];
      const rel = bookRels.find((r) => r.id === rid);
      allSheets.push(rel?.kind === 'worksheet' && rel.path ? wb.sheets.find((s) => s.name === el.a.name)?.id ?? null : null);
      k++;
    }
    for (const n of kids(kid(book, 'definedNames'), 'definedName')) {
      const name = n.a.name;
      if (!name) continue;
      const x = { name, ref: fromFile(unescape(textOf(n))) };
      if (n.a.localSheetId !== undefined) {
        const id = allSheets[Number(n.a.localSheetId)];
        if (id === null || id === undefined) continue;
        x.sheet = id;
      }
      if (truthy(n.a.hidden)) x.hidden = true;
      const rest = Object.entries(n.a).filter(([kk]) => !['name', 'localSheetId', 'hidden'].includes(kk));
      if (rest.length) x.attrs = Object.fromEntries(rest);
      wb.names.push(x);
    }
    const view = kid(kid(book, 'bookViews'), 'workbookView');
    const tab = Number(view?.a.activeTab ?? 0);
    const activeId = allSheets[tab];
    wb.active = Math.max(0, wb.sheets.findIndex((s) => s.id === activeId));

    // What the model doesn't hold, kept.
    const bookKeep = { root: bookXml.slice(book.at, book.open), xml: [], rels: [], workbookPr: wbPr?.a ?? null, calcPr: kid(book, 'calcPr')?.a ?? null, view: view?.a ?? null,
      views: kid(book, 'bookViews') ? kids(kid(book, 'bookViews'), 'workbookView').slice(1).map((v) => bookXml.slice(v.at, v.end)) : [] };
    const BOOK_MODELLED = new Set(['workbookPr', 'bookViews', 'sheets', 'definedNames', 'calcPr']);
    for (const n of book.kids) if (!BOOK_MODELLED.has(local(n.name))) bookKeep.xml.push({ name: n.name, xml: bookXml.slice(n.at, n.end) });
    for (const r of bookRels) {
      if (['worksheet', 'styles', 'sharedStrings', 'calcChain'].includes(r.kind)) continue;
      bookKeep.rels.push({ id: r.id, type: r.type, target: r.target, ...(r.mode && { mode: r.mode }) });
    }
    for (const r of others) if (r.rel && r.rel.kind !== 'worksheet' && !bookKeep.rels.some((x) => x.id === r.rel.id)) bookKeep.rels.push({ id: r.rel.id, type: r.rel.type, target: r.rel.target });
    const pkg = pkgRels.filter((r) => r.kind !== 'officeDocument' && r.kind !== 'extended-properties').map(({ id, type, target, mode }) => ({ id, type, target, ...(mode && { mode }) }));
    const appRel = pkgRels.find((r) => r.kind === 'extended-properties' && r.path);
    if (appRel && real(appRel.path)) used.add(real(appRel.path));

    const parts = {};
    for (const name of byLow.values()) {
      if (used.has(name) || name === '[Content_Types].xml') continue;
      try { parts[name] = { type: typeOf(name), data: new Uint8Array(await z.bytes(name)) }; } catch (e) { problem(null, 'part', `${name}: ${e.message}`); }
    }
    for (const p of Object.keys(parts)) {
      if (/^xl\/pivotTables\//i.test(p)) flags.pivots = true;
      if (/^xl\/(slicers|slicerCaches|timelines|timelineCaches)\//i.test(p)) flags.slicers = true;
      if (/^xl\/externalLinks\//i.test(p)) flags.external = true;
      if (/vbaProject\.bin$/i.test(p)) flags.macros = true;
    }
    wb.keep = { parts, book: bookKeep, pkg, others, main: mainType, defaults: types.defaults, styles: st.keep, theme, flags, problems, log: [] };
    return wb;
  };

  return { read, MDW, pxFromWidth, widthFromPx, pxFromPt, ptFromPx, tinted, fromFile, toFile };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_XLSX; else GZ_SHEET_XLSX;
