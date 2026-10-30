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
// font fields }]. Sizes are the file's: colW a <col width> (characters of a 7-pixel digit, padding included), rowH a row's
// height in points; sheet.keep.defaults has the sheet's defaults in the same units. A hidden sheet has keep.hidden.
// Bounded: the archive by lib/doctext.js's limits, cells and sheets by the model's caps; a part that can't be read is
// left out and listed in wb.keep.problems, so read() fails only for a file that is no workbook at all.
// Rimeward's parseDelimited (notebook-spreadsheet.ts, MIT, the same owner) is the CSV parser's start.
// Classic script, loaded with the page: the engine (lib/sheet-model.js, -formula, -numfmt, -calc), lib/doctext.js and
// lib/zip.js are looked up when a function runs, so they may load later. module.exports for node.
var GZ_SHEET_XLSX = globalThis.GZ_SHEET_XLSX || (() => {
  const fail = (code, message) => { throw Object.assign(new Error(message || code), { code }); };
  const dep = (name, file) => (typeof globalThis[name] !== 'undefined' ? globalThis[name] : typeof module !== 'undefined' ? require(file) : fail('deps', `${file} is not loaded`));
  let M, F, NF, D, MAX_ROWS, MAX_COLS, CAP, INDEXED;
  const deps = () => {
    if (M) return;
    M = dep('GZ_SHEET_MODEL', './sheet-model.js'); F = dep('GZ_SHEET_FORMULA', './sheet-formula.js');
    NF = dep('GZ_SHEET_NUMFMT', './sheet-numfmt.js'); D = dep('GZ_DOCTEXT', './doctext.js');
    ({ MAX_ROWS, MAX_COLS, CAP } = M);
    // Indexed colours 0-7 repeat the first eight of the palette; 64 and 65 are the system's text and window colours.
    INDEXED = [...NF.PALETTE.slice(0, 8), ...NF.PALETTE];
  };
  const calc = () => (typeof GZ_SHEET_CALC !== 'undefined' ? GZ_SHEET_CALC : typeof module !== 'undefined' ? require('./sheet-calc.js') : null);

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
  const escBody = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // Text for a <t> or <v>: XML-escaped, OOXML-escaped where XML can't carry the character (CR, controls, lone surrogates).
  const escText = (s) => escBody(String(s).replace(/_x[0-9A-Fa-f]{4}_/g, '_x005F$&')
    .replace(/[\x00-\x08\x0b-\x1f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,
      (c) => `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`));
  const attrText = (a) => Object.entries(a).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => ` ${k}="${esc(v === true ? '1' : v)}"`).join('');
  const tag = (name, a, body) => (body === undefined || body === '' ? `<${name}${attrText(a)}/>` : `<${name}${attrText(a)}>${body}</${name}>`);
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
    if (/^[a-z][\w+.-]*:|[\\?#]/i.test(target)) return null;
    const out = [];
    for (const p of (target.startsWith('/') ? target.slice(1) : dirOf(from) + target).split('/')) {
      if (p === '..') { if (!out.length) return null; out.pop(); }
      else if (p !== '.' && p !== '') out.push(p);
    }
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
      if (id && (id < 164 || codes.has(id))) s.fmt = id >= 164 ? codes.get(id) : id;
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
  // A width of n characters as a file writes it: n digits of 7 px and 5 px of padding, in 1/256ths.
  const fileWidth = (chars) => Math.trunc(((chars * 7 + 5) / 7) * 256) / 256;
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
        else if (!k.f || k.f.length > CAP.formula) ctx.problem(sh, 'formula', `${M.cellName(k.r, k.c)}: formula empty or too long`);
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
      if (cell?.t === 's' && cell.v.length > CAP.text) {
        ctx.problem(sh, 'text', `${M.cellName(k.r, k.c)}: text past 32,767 characters was left out`);
        cell.v = cell.v.slice(0, CAP.text);
        if (cell.rich) {
          let left = CAP.text;
          cell.rich = cell.rich.flatMap((run) => { const text = run.text.slice(0, left); left -= text.length; return text ? [{ ...run, text }] : []; });
        }
      }
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
        if (a.ht !== undefined && truthy(a.customHeight) && Number.isFinite(Number(a.ht))) sh.rowH.set(r, Number(a.ht));
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
        if (Number.isFinite(Number(a.defaultColWidth))) keep.defaults.colW = Number(a.defaultColWidth);
        else if (Number.isFinite(Number(a.baseColWidth))) keep.defaults.colW = fileWidth(Number(a.baseColWidth));
        if (Number(a.defaultRowHeight)) keep.defaults.rowH = Number(a.defaultRowHeight);
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
            if (a.width !== undefined && Number.isFinite(Number(a.width))) sh.colW.set(i, Number(a.width));
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

  const relsOf = (xml, from, problem) => {
    const out = [];
    for (const n of kids(kid(tree(xml ?? ''), 'Relationships'), 'Relationship')) {
      const { Id: id, Type: type = '', Target: target, TargetMode: mode } = n.a;
      if (!id || target === undefined) continue;
      const path = mode === 'External' ? null : resolve(from, target);
      if (mode !== 'External' && !path) { problem?.(null, 'relationship', `${from}: invalid relationship target ${target}`); continue; }
      out.push({ id, type, kind: kindOf(type), target, mode, path });
    }
    return out;
  };

  // CT_Workbook's element order.
  const BOOK_ORDER = ['fileVersion', 'fileSharing', 'workbookPr', 'workbookProtection', 'bookViews', 'sheets', 'functionGroups', 'externalReferences',
    'definedNames', 'calcPr', 'oleSize', 'customWorkbookViews', 'pivotCaches', 'smartTagPr', 'smartTagTypes', 'webPublishing', 'fileRecoveryPr',
    'webPublishObjects', 'extLst'];
  const BOOK_RANK = new Map(BOOK_ORDER.map((n, i) => [n, i]));
  const BOOK_MODELLED = new Set(['workbookPr', 'bookViews', 'sheets', 'definedNames', 'calcPr']);

  // Why structural edits on a sheet are refused: what keeps cell addresses Glaze can't move.
  const LOCKS = { pivotTable: 'pivot', slicer: 'slicer', timeline: 'slicer', queryTable: 'query' };

  // .xlsx bytes → the workbook model. opts.limits lowers doctext's archive limits.
  const read = async (bytes, opts = {}) => {
    const z = D.unzip(bytes, { ...opts, limits: { ...opts.limits, duplicates: true } });
    const byLow = new Map();
    for (const n of z.names.filter((n) => !n.endsWith('/'))) {
      if (byLow.has(n.toLowerCase())) fail('not-workbook', `ambiguous duplicate package part: ${n}`);
      byLow.set(n.toLowerCase(), n);
    }
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
    const relsFor = async (p) => relsOf(await text(relsPath(p)), p, problem);

    const types = { defaults: {}, overrides: {} };
    const ct = await text('[Content_Types].xml');
    if (!kid(tree(ct ?? ''), 'Types')) problem(null, 'content-types', '[Content_Types].xml is missing or unreadable');
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
      Object.assign(sh.keep, { path: real(rel.path) ?? rel.path, rels: [], xml: [], rowAttrs: new Map(), colAttrs: new Map(), defaults: { colW: fileWidth(8), rowH: 15 }, lastRank: -1, locks: [] });
      if (el.a.state === 'hidden' || el.a.state === 'veryHidden') sh.keep.hidden = true;
      if (el.a.state === 'veryHidden') sh.keep.state = 'veryHidden';
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
      Object.assign(sh.keep, { rels: [], xml: [], rowAttrs: new Map(), colAttrs: new Map(), defaults: { colW: fileWidth(8), rowH: 15 }, locks: [] });
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
    const bookKeep = { path: bookPath, root: bookXml.slice(book.at, book.open), xml: [], rels: [], workbookPr: wbPr?.a ?? null, calcPr: kid(book, 'calcPr')?.a ?? null, view: view?.a ?? null,
      views: kid(book, 'bookViews') ? kids(kid(book, 'bookViews'), 'workbookView').slice(1).map((v) => bookXml.slice(v.at, v.end)) : [] };
    let rank = -1;
    for (const n of book.kids) {
      const name = local(n.name);
      rank = BOOK_RANK.has(name) ? BOOK_RANK.get(name) : rank + 0.5;
      if (!BOOK_MODELLED.has(name)) bookKeep.xml.push({ name: n.name, rank, xml: bookXml.slice(n.at, n.end) });
    }
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
    // A drawing's charts, for the charts lane (lib/sheet-chart-xml.js) to read from keep.parts.
    for (const sh of wb.sheets) {
      const d = sh.keep.drawing, rp = d && relsPath(d.path);
      if (d) d.charts = parts[rp] ? relsOf(new TextDecoder().decode(parts[rp].data), d.path).filter((r) => r.kind === 'chart' && r.path).map((r) => real(r.path) ?? r.path) : [];
    }
    for (const p of Object.keys(parts)) {
      if (/^xl\/pivotTables\//i.test(p)) flags.pivots = true;
      if (/^xl\/(slicers|slicerCaches|timelines|timelineCaches)\//i.test(p)) flags.slicers = true;
      if (/^xl\/externalLinks\//i.test(p)) flags.external = true;
      if (/vbaProject\.bin$/i.test(p)) flags.macros = true;
    }
    for (const sh of wb.sheets) sh.keep.name = sh.name;
    st.keep.colors = Object.fromEntries(st.ctx.seen);
    wb.keep = { parts, book: bookKeep, pkg, others, main: mainType, defaults: types.defaults, styles: st.keep, theme, flags, problems, log: [],
      sheetNames: Object.fromEntries(wb.sheets.map((sh) => [sh.id, sh.name])) };
    return wb;
  };

  // ── Moving kept references ──────────────────────────────────────────────────────────────────────────────────────────
  // wb.keep.log lists, in order, the rows and columns inserted or deleted ({ op: 'shift', sheet, name, axis, at, n }) and
  // the sheets renamed or removed ({ op: 'rename', sheet, from, to }) since the file was read; the writer moves what it
  // kept by it. An edit that undoes the last one takes it off instead, so an undone delete brings references back.
  const inverse = (a, b) => !!a && a.op === b.op && a.sheet === b.sheet && (a.op === 'shift'
    ? a.axis === b.axis && a.at === b.at && a.n === -b.n : a.from === b.to && a.to === b.from);
  // Records a model operation the grid has just applied (sheet-model.js apply, sheet-calc.js engine.apply): do, undo or redo.
  const track = (wb, op) => {
    const keep = (wb.keep ??= { parts: {} });
    const log = (keep.log ??= []);
    const push = (e) => { if (inverse(log.at(-1), e)) log.pop(); else log.push(e); };
    const was = keep.sheetNames ?? {};
    const now = new Map(wb.sheets.map((s) => [s.id, s.name]));
    for (const [id, name] of Object.entries(was)) if (now.get(Number(id)) !== name) push({ op: 'rename', sheet: Number(id), from: name, to: now.get(Number(id)) ?? null });
    for (const [id, name] of now) if (!Object.hasOwn(was, id)) { const last = log.at(-1); if (last?.op === 'rename' && last.sheet === id && last.to === null && last.from === name) log.pop(); }
    keep.sheetNames = Object.fromEntries(now);
    const walk = (o) => {
      if (!o) return;
      if (o.op === 'batch') { for (const x of o.ops) walk(x); return; }
      if ((o.op === 'insert' || o.op === 'delete') && now.has(o.sheet)) push({ op: 'shift', sheet: o.sheet, name: now.get(o.sheet), axis: o.axis, at: o.at, n: o.op === 'insert' ? o.n : -o.n });
    };
    walk(op);
  };
  // Why the grid must refuse a structural operation (inserting or deleting rows or columns), or null: what refers to the
  // sheet's cells by address and isn't moved here.
  const REASONS = { pivot: 'a pivot table uses this sheet', slicer: 'a slicer uses this sheet', query: 'a query table fills this sheet', external: 'this sheet links to another workbook', macros: 'the workbook has macros', table: 'a table on this sheet would lose its columns' };
  const locked = (wb, op) => {
    if (!op) return null;
    if (op.op === 'batch') { for (const x of op.ops) { const why = locked(wb, x); if (why) return why; } return null; }
    if (op.op !== 'insert' && op.op !== 'delete') return null;
    if (wb.keep?.flags?.macros) return REASONS.macros;
    const sh = M.getSheet(wb, op.sheet);
    const why = sh?.keep?.locks?.[0];
    if (why) return REASONS[why] ?? why;
    if (op.axis === 'col' && sh?.keep?.tables?.length) return REASONS.table;
    return null;
  };

  const maxOf = (axis) => (axis === 'row' ? MAX_ROWS : MAX_COLS);
  const moveIndex = (k, e) => (k < e.at ? k : e.n < 0 && k < e.at - e.n ? null : k + e.n < maxOf(e.axis) ? k + e.n : null);
  const own = (log, id) => log.filter((e) => e.op === 'shift' && e.sheet === id);
  const moveKey = (k, axis, entries) => { for (const e of entries) { if (e.axis !== axis) continue; k = moveIndex(k, e); if (k === null) return null; } return k; };
  const moveRange = (g, entries) => {
    for (const e of entries) {
      const s = M.shiftSpan(e.axis === 'row' ? g.r0 : g.c0, e.axis === 'row' ? g.r1 : g.c1, e.at, e.n, maxOf(e.axis));
      if (!s) return null;
      g = e.axis === 'row' ? { ...g, r0: s[0], r1: s[1] } : { ...g, c0: s[0], c1: s[1] };
    }
    return g;
  };
  const moveRefList = (text, entries) => {
    if (!entries.length) return text;
    const out = [];
    for (const part of String(text).split(/\s+/).filter(Boolean)) {
      const g = M.rangePosition(part.replace(/\$/g, ''));
      if (!g) { out.push(part); continue; }
      const m = moveRange(g, entries);
      if (m) out.push(M.rangeName(m.r0, m.c0, m.r1, m.c1));
    }
    return out.length ? out.join(' ') : null;
  };
  // A kept formula through the whole log: its sheet's renames (host follows them) and every sheet's rows and columns.
  const moveFormula = (text, log, host) => {
    let f = text, h = host;
    for (const e of log) {
      if (e.op === 'rename') { f = F.rename(f, e.from, e.to); if (h !== null && h !== undefined && h.toLowerCase() === String(e.from).toLowerCase()) h = e.to; }
      else f = F.shift(f, { sheet: e.name, axis: e.axis, at: e.at, n: e.n }, h);
    }
    return f;
  };
  const FORMULA_TEXT = new Set(['formula', 'formula1', 'formula2', 'f']);
  // One kept piece of XML with its references moved. how: { entries (this sheet's shifts), log, host, anchors: a drawing's
  // from/to rows and columns (clamped), vml: a comment shape's x:Row / x:Column (deleted with its cell) }. Elements whose
  // ref or sqref is deleted go, and a container left with no children goes too (→ '').
  const moveXml = (xml, how) => {
    const { entries = [], log = [], host = null } = how;
    if (!entries.length && !log.length) return xml;
    const out = [], stack = [];
    for (const tk of D.tokens(xml)) {
      const top = stack.at(-1);
      if (!tk.name) {
        const s = tk.cdata ?? D.decode(tk.text);
        const n = top ? local(top.name) : '';
        const parent = stack.at(-2) ? local(stack.at(-2).name) : '';
        let next = null;
        if (top && (FORMULA_TEXT.has(n) || n === 'location')) next = escBody(moveFormula(s, log, host));
        else if (top && n === 'sqref') { const m = moveRefList(s, entries); if (m === null) top.drop = true; else next = escBody(m); }
        else if (top && how.anchors && (n === 'row' || n === 'col') && (parent === 'from' || parent === 'to')) {
          let k = Number(s);
          for (const e of entries) { if (e.axis !== n) continue; const m = moveIndex(k, e); k = m === null ? e.at : m; }
          next = String(k);
        } else if (top && how.vml && (n === 'Row' || n === 'Column')) {
          const k = moveKey(Number(s), n === 'Row' ? 'row' : 'col', entries);
          if (k === null) { const shape = [...stack].reverse().find((x) => local(x.name) === 'shape'); (shape ?? top).drop = true; } else next = String(k);
        } else if (top && how.vml && n === 'Anchor') {
          const v = s.split(',').map((x) => x.trim());
          for (const [idx, axis] of [[0, 'col'], [2, 'row'], [4, 'col'], [6, 'row']]) {
            let k = Number(v[idx]);
            for (const e of entries) { if (e.axis !== axis) continue; const m = moveIndex(k, e); k = m === null ? e.at : m; }
            v[idx] = String(k);
          }
          next = v.join(', ');
        }
        out.push(next ?? (tk.cdata != null ? `<![CDATA[${tk.cdata}]]>` : tk.text));
        continue;
      }
      if (tk.close) {
        const k = stack.findLastIndex((x) => x.name === tk.name);
        if (k < 0) { out.push(xml.slice(tk.at, tk.end)); continue; }
        const el = stack[k];
        stack.length = k;
        if (el.drop) { out.length = el.out; continue; }
        if (el.kids && !el.left && el.container) { out.length = el.out; continue; }
        out.push(xml.slice(tk.at, tk.end));
        const parent = stack.at(-1);
        if (parent) parent.left = true;
        if (el.counted && el.left) out[el.out] = out[el.out].replace(/\bcount="\d+"/, `count="${el.n}"`);
        continue;
      }
      let start = xml.slice(tk.at, tk.end);
      let drop = false;
      start = start.replace(/(\s)(ref|sqref|location)="([^"]*)"/g, (m, sp, k, v) => {
        if (k === 'location') return `${sp}${k}="${esc(moveFormula(D.decode(v), log, host))}"`;
        const moved = moveRefList(D.decode(v), entries);
        if (moved === null) { drop = true; return m; }
        return `${sp}${k}="${esc(moved)}"`;
      });
      if (local(tk.name) === 'brk' && /\bid="(\d+)"/.test(start) && how.breaks) {
        const k = moveKey(Number(/\bid="(\d+)"/.exec(start)[1]), how.breaks, entries);
        if (k === null) drop = true; else start = start.replace(/\bid="\d+"/, `id="${k}"`);
      }
      const parent = stack.at(-1);
      if (parent) { parent.kids = true; if (!drop) parent.n = (parent.n ?? 0) + 1; }
      if (tk.empty) {
        if (!drop) { out.push(start); if (parent) parent.left = true; }
        continue;
      }
      stack.push({ name: tk.name, out: out.length, drop, container: !how.part && stack.length === 0, counted: /\bcount="\d+"/.test(start) });
      out.push(start);
    }
    return out.join('');
  };

  // ── Writing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Recalculates, so every formula's cached value is current. A formula with a function Glaze lacks gives #NAME? here;
  // the file keeps the value it came with instead. → Map cell → the { t, v } to write.
  const refresh = (wb, opts) => {
    const C = calc();
    const before = new Map();
    for (const sh of wb.sheets) for (const row of sh.rows.values()) for (const x of row.values()) if (x.f !== undefined && x.t !== 'z') before.set(x, { t: x.t, v: x.v });
    let eng = opts.engine ?? null;
    if (!eng && opts.recalc !== false && C && C.fn('SUM')) { try { eng = C.engine(wb); } catch { eng = null; } }
    try { eng?.recalc(); } catch { /* the cached values stay */ }
    const keepOld = new Map();
    for (const [x, old] of before) {
      if (x.t !== 'e' || x.v !== '#NAME?') continue;
      let toks;
      try { toks = F.tokenize(x.f); } catch { continue; }
      if (toks.some((t) => t.k === 'fn' && C && !C.fn(t.name))) keepOld.set(x, old);
    }
    return keepOld;
  };

  const ERR_OK = new Set(['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA']);
  const errText = (v) => (ERR_OK.has(v) ? v : '#VALUE!');
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? (v === 0 ? '0' : String(v)) : '0');
  const tText = (s) => `<t${/^[\s]|[\s]$|[\n\t]/.test(s) ? ' xml:space="preserve"' : ''}>${escText(s)}</t>`;

  const colorXml = (name, hex, colors) => {
    const spec = colors[hex];
    return tag(name, spec ?? { rgb: `FF${String(hex).replace('#', '').toUpperCase()}` });
  };
  const FONT_XML = [['bold', 'b'], ['italic', 'i'], ['strike', 'strike'], ['condense', 'condense'], ['extend', 'extend'], ['outline', 'outline'], ['shadow', 'shadow']];
  const fontBody = (o, colors, nameTag) => FONT_XML.map(([k, t]) => (o[k] ? `<${t}/>` : '')).join('')
    + (o.underline ? (o.underline === 'single' ? '<u/>' : tag('u', { val: o.underline })) : '')
    + (o.vert ? tag('vertAlign', { val: o.vert }) : '') + (o.size !== undefined ? tag('sz', { val: o.size }) : '')
    + (o.color ? colorXml('color', o.color, colors) : '') + (o.font !== undefined ? tag(nameTag, { val: o.font }) : '')
    + (o.fontFamily !== undefined ? tag('family', { val: o.fontFamily }) : '') + (o.charset !== undefined ? tag('charset', { val: o.charset }) : '')
    + (o.fontScheme ? tag('scheme', { val: o.fontScheme }) : '');
  const fillXml = (o, colors) => {
    if (o.gradient) return `<fill>${o.gradient}</fill>`;
    if (o.fill) return `<fill><patternFill patternType="solid">${colorXml('fgColor', o.fill, colors)}<bgColor indexed="64"/></patternFill></fill>`;
    if (o.pattern) return `<fill><patternFill patternType="${esc(o.pattern.type)}">${o.pattern.fg ? colorXml('fgColor', o.pattern.fg, colors) : ''}${o.pattern.bg ? colorXml('bgColor', o.pattern.bg, colors) : ''}</patternFill></fill>`;
    return '<fill><patternFill patternType="none"/></fill>';
  };
  const borderXml = (o, colors) => `<border${o.up ? ' diagonalUp="1"' : ''}${o.down ? ' diagonalDown="1"' : ''}>${SIDES.map((side) => {
    const b = o[side];
    return b?.style ? `<${side} style="${esc(b.style)}">${b.color ? colorXml('color', b.color, colors) : ''}</${side}>` : `<${side}/>`;
  }).join('')}</border>`;
  const FRESH_FONT = { font: 'Calibri', size: 11, color: '#000000', fontFamily: 2 };

  // wb.styles (and what was kept) → styles.xml. Each cellXfs entry is wb.styles' entry of the same index.
  const writeStyles = (wb) => {
    const keep = wb.keep?.styles ?? {};
    const colors = keep.colors ?? {};
    const palette = [...INDEXED];
    if (keep.palette) kids(kid(tree(keep.palette), 'colors') && kid(kid(tree(keep.palette), 'colors'), 'indexedColors'), 'rgbColor').forEach((c, i) => { palette[i] = rgbHex(c.a.rgb ?? '') ?? palette[i]; });
    const ctx = { theme: wb.keep?.theme ?? DEFAULT_THEME, palette, seen: new Map() };
    const table = (xmls, of, fresh) => {
      const list = (xmls?.length ? xmls : fresh).map((x) => { const n = tree(x).kids[0]; n.src = x; return { xml: x, key: stable(of(n, ctx)) }; });
      const index = new Map();
      list.forEach((f, i) => { if (!index.has(f.key)) index.set(f.key, i); });
      return { list, id: (o, make) => { const key = stable(o); if (!index.has(key)) { index.set(key, list.length); list.push({ xml: make(o), key }); } return index.get(key); } };
    };
    const fonts = table(keep.fonts, fontOf, [`<font>${fontBody(FRESH_FONT, colors, 'name')}</font>`]);
    const fills = table(keep.fills, fillOf, ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']);
    const borders = table(keep.borders, borderOf, ['<border><left/><right/><top/><bottom/><diagonal/></border>']);
    const baseFont = keep.fonts?.length ? fontOf(tree(keep.fonts[0]).kids[0], ctx) : FRESH_FONT;
    const numFmts = [...(keep.numFmts ?? [])];
    const byCode = new Map(numFmts.filter((f) => f.id >= 164).map((f) => [f.code, f.id]));
    const fmtId = (fmt) => {
      if (fmt === undefined || fmt === null || fmt === 0) return 0;
      if (typeof fmt === 'number') return fmt;
      if (fmt === 'General') return 0;
      if (!byCode.has(fmt)) { const id = Math.max(163, ...numFmts.map((f) => f.id)) + 1; numFmts.push({ id, code: fmt }); byCode.set(fmt, id); }
      return byCode.get(fmt);
    };
    const xfs = (wb.styles.length ? wb.styles : [{}]).map((s) => {
      s = s ?? {};
      const font = { ...baseFont };
      for (const k of FONT_KEYS) if (Object.hasOwn(s, k)) { if (s[k] === null || s[k] === undefined || s[k] === false) delete font[k]; else font[k] = s[k]; }
      const fontId = fonts.id(font, (o) => `<font>${fontBody(o, colors, 'name')}</font>`);
      const fillO = s.gradient ? { gradient: s.gradient } : s.fill ? { fill: s.fill } : s.pattern ? { pattern: s.pattern } : {};
      const fillId = fills.id(fillO, (o) => fillXml(o, colors));
      const borderO = s.border && Object.keys(s.border).length ? s.border : {};
      const borderId = borders.id(borderO, (o) => borderXml(o, colors));
      const numFmtId = fmtId(s.fmt);
      const align = {};
      for (const [k, key] of Object.entries(ALIGN)) if (s[key] !== undefined && s[key] !== null && s[key] !== false) align[k] = s[key] === true ? '1' : s[key];
      const hasAlign = Object.keys(align).length, prot = s.locked === false || s.hidden === true;
      const body = (hasAlign ? tag('alignment', align) : '') + (prot ? tag('protection', { locked: s.locked === false ? '0' : undefined, hidden: s.hidden ? '1' : undefined }) : '');
      return tag('xf', { numFmtId, fontId, fillId, borderId, xfId: s.xfId ?? 0, quotePrefix: s.quote ? '1' : undefined,
        applyNumberFormat: numFmtId ? '1' : undefined, applyFont: fontId ? '1' : undefined, applyFill: fillId ? '1' : undefined,
        applyBorder: borderId ? '1' : undefined, applyAlignment: hasAlign ? '1' : undefined, applyProtection: prot ? '1' : undefined }, body);
    });
    const root = keep.root ?? `<styleSheet xmlns="${SML}">`;
    const rootName = /^<([^\s>]+)/.exec(root)[1];
    return HEAD + root
      + (numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f) => tag('numFmt', { numFmtId: f.id, formatCode: f.code })).join('')}</numFmts>` : '')
      + `<fonts count="${fonts.list.length}">${fonts.list.map((f) => f.xml).join('')}</fonts>`
      + `<fills count="${fills.list.length}">${fills.list.map((f) => f.xml).join('')}</fills>`
      + `<borders count="${borders.list.length}">${borders.list.map((f) => f.xml).join('')}</borders>`
      + (keep.cellStyleXfs ?? '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>')
      + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`
      + (keep.cellStyles ?? '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>')
      + (keep.dxfs ?? '<dxfs count="0"/>')
      + (keep.tableStyles ?? '<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>')
      + (keep.palette ?? '') + (keep.extLst ?? '') + `</${rootName}>`;
  };

  // Shared strings, each text (or rich run list) once.
  const stringTable = () => {
    const index = new Map(), list = [];
    let count = 0;
    return {
      add: (cell) => {
        count++;
        const rich = Array.isArray(cell.rich) && cell.rich.length && cell.rich.map((r) => r.text ?? '').join('') === cell.v ? cell.rich : null;
        const key = rich ? `r${stable(rich)}` : `s${cell.v}`;
        if (!index.has(key)) { index.set(key, list.length); list.push(rich ? { rich } : { text: String(cell.v ?? '') }); }
        return index.get(key);
      },
      xml: (colors) => `${HEAD}<sst xmlns="${SML}" count="${count}" uniqueCount="${list.length}">${list.map((x) => (x.rich
        ? `<si>${x.rich.map((r) => { const p = fontBody(r, colors, 'rFont'); return `<r>${p ? `<rPr>${p}</rPr>` : ''}${tText(r.text ?? '')}</r>`; }).join('')}</si>`
        : `<si>${tText(x.text)}</si>`)).join('')}</sst>`,
    };
  };

  const sortedKeys = (map) => [...map.keys()].sort((a, b) => a - b);
  // One model sheet → worksheet XML. w: { sst, keepOld, active, log, entries, rels kept, metadata (cm/vm allowed), colors }.
  const writeSheet = (sh, w) => {
    const keep = sh.keep ?? {};
    const { entries, log } = w;
    const host = keep.name ?? sh.name;
    const parts = [];
    let r0 = Infinity, c0 = Infinity, r1 = -1, c1 = -1;
    for (const [r, row] of sh.rows) for (const c of row.keys()) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    parts.push({ rank: RANK.get('dimension'), xml: `<dimension ref="${r1 < 0 ? 'A1' : M.rangeName(r0, c0, r1, c1)}"/>` });
    // Sheet view: the one read, its pane and selection kept while the frozen panes are what they were.
    const view = keep.view;
    const attrs = { ...(view?.attrs ?? {}) };
    delete attrs.tabSelected;
    const viewAttrs = { ...(w.active && { tabSelected: '1' }), ...attrs, workbookViewId: attrs.workbookViewId ?? '0' };
    let inner;
    if (view && stable(view.freeze ?? null) === stable(sh.freeze ?? null)) inner = view.inner;
    else if (sh.freeze && (sh.freeze.rows > 0 || sh.freeze.cols > 0)) {
      const fr = Math.min(sh.freeze.rows || 0, MAX_ROWS - 1), fc = Math.min(sh.freeze.cols || 0, MAX_COLS - 1);
      const pane = fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight', first = M.cellName(fr, fc);
      inner = tag('pane', { xSplit: fc || undefined, ySplit: fr || undefined, topLeftCell: first, activePane: pane, state: 'frozen' }) + tag('selection', { pane, activeCell: first, sqref: first });
    } else inner = '';
    parts.push({ rank: RANK.get('sheetViews'), xml: `<sheetViews>${tag('sheetView', viewAttrs, inner)}${view?.more ?? ''}</sheetViews>` });
    if (!keep.xml) parts.push({ rank: RANK.get('sheetFormatPr'), xml: '<sheetFormatPr defaultRowHeight="15"/>' });
    // Columns: runs of equal width, hidden flag and kept attributes.
    const cols = new Map();
    const col = (i) => { if (!cols.has(i)) cols.set(i, {}); return cols.get(i); };
    for (const [i, w] of sh.colW) if (Number.isFinite(w) && w >= 0) col(i).width = w;
    for (const i of sh.hidden.cols) col(i).hidden = '1';
    for (const [i, a] of keep.colAttrs ?? []) { const k = moveKey(i, 'col', entries); if (k !== null) Object.assign(col(k), a); }
    if (cols.size) {
      const runs = [];
      for (const i of sortedKeys(cols)) {
        const a = cols.get(i);
        const last = runs.at(-1);
        if (last && last.max === i - 1 && stable(last.a) === stable(a)) last.max = i; else runs.push({ min: i, max: i, a });
      }
      parts.push({ rank: RANK.get('cols'), xml: `<cols>${runs.map(({ min, max, a }) => tag('col', { min: min + 1, max: max + 1, width: a.width, style: a.style, hidden: a.hidden,
        bestFit: a.bestFit, customWidth: a.width !== undefined && sh.colW.has(min) ? '1' : undefined, phonetic: a.phonetic, outlineLevel: a.outlineLevel, collapsed: a.collapsed })).join('')}</cols>` });
    }
    // Rows and cells.
    const rowAttrs = new Map();
    for (const [i, a] of keep.rowAttrs ?? []) { const k = moveKey(i, 'row', entries); if (k !== null) rowAttrs.set(k, a); }
    const rowSet = new Set([...sh.rows.keys(), ...sh.rowH.keys(), ...sh.hidden.rows, ...rowAttrs.keys()]);
    const out = [];
    for (const r of [...rowSet].sort((a, b) => a - b)) {
      const a = rowAttrs.get(r) ?? {};
      const custom = sh.rowH.has(r);
      const head = attrText({ r: r + 1, s: a.s, customFormat: a.s !== undefined ? '1' : undefined, ht: custom ? sh.rowH.get(r) : a.ht,
        hidden: sh.hidden.rows.has(r) ? '1' : undefined, customHeight: custom ? '1' : undefined, outlineLevel: a.outlineLevel, collapsed: a.collapsed,
        thickTop: a.thickTop, thickBot: a.thickBot });
      const row = sh.rows.get(r);
      if (!row?.size) { out.push(`<row${head}/>`); continue; }
      out.push(`<row${head}>`);
      for (const c of sortedKeys(row)) out.push(cellXml(row.get(c), r, c, w));
      out.push('</row>');
    }
    parts.push({ rank: RANK.get('sheetData'), xml: out.length ? `<sheetData>${out.join('')}</sheetData>` : '<sheetData/>' });
    if (sh.filter && M.rangePosition(M.rangeName(sh.filter.r0, sh.filter.c0, sh.filter.r1, sh.filter.c1))) {
      const f = sh.filter, body = f.xml ? moveXml(f.xml, { entries, log, host }) : '';
      parts.push({ rank: RANK.get('autoFilter'), xml: `<autoFilter ref="${M.rangeName(f.r0, f.c0, f.r1, f.c1)}"${body ? `>${body}</autoFilter>` : '/>'}` });
    }
    const merges = (sh.merges ?? []).filter((g) => g && (g.r1 > g.r0 || g.c1 > g.c0));
    if (merges.length) parts.push({ rank: RANK.get('mergeCells'), xml: `<mergeCells count="${merges.length}">${merges.map((g) => `<mergeCell ref="${M.rangeName(g.r0, g.c0, g.r1, g.c1)}"/>`).join('')}</mergeCells>` });
    const dropped = w.dropped;
    for (const x of keep.xml ?? []) {
      if (dropped.size && [...dropped].some((id) => new RegExp(`\\br:(?:id|embed|link|pict)="${id}"`).test(x.xml))) continue;
      const n = local(x.name);
      const moved = moveXml(x.xml, { entries, log, host, breaks: n === 'rowBreaks' ? 'row' : n === 'colBreaks' ? 'col' : null });
      if (moved) parts.push({ rank: x.rank, xml: moved });
    }
    parts.sort((a, b) => a.rank - b.rank);
    // A copy isn't the sheet Excel's revision id names.
    const root = keep.root && w.copy ? keep.root.replace(/\sxr:uid="[^"]*"/, '') : keep.root;
    return HEAD + (root ?? `<worksheet xmlns="${SML}" xmlns:r="${OD}">`) + parts.map((p) => p.xml).join('') + '</worksheet>';
  };

  const cellXml = (x, r, c, w) => {
    const ref = M.cellName(r, c);
    const s = x.s ? ` s="${x.s}"` : '';
    if (x.f !== undefined) {
      const val = w.keepOld.get(x) ?? x;
      const g = x.a !== undefined ? M.rangePosition(x.a) : null;
      const array = g && g.r0 === r && g.c0 === c;
      const f = escBody(toFile(x.f));
      const ft = array ? `<f t="array" ref="${M.rangeName(g.r0, g.c0, g.r1, g.c1)}">${f}</f>` : `<f>${f}</f>`;
      const meta = (array && x.cm !== undefined && w.metadata ? ` cm="${esc(x.cm)}"` : '') + (x.vm !== undefined && w.metadata && val.t === 'e' && errText(val.v) === '#VALUE!' ? ` vm="${esc(x.vm)}"` : '');
      switch (val.t) {
        case 's': return `<c r="${ref}"${s} t="str"${meta}>${ft}<v>${escText(val.v ?? '')}</v></c>`;
        case 'b': return `<c r="${ref}"${s} t="b"${meta}>${ft}<v>${val.v ? 1 : 0}</v></c>`;
        case 'e': return `<c r="${ref}"${s} t="e"${meta}>${ft}<v>${errText(val.v)}</v></c>`;
        case 'n': return `<c r="${ref}"${s}${meta}>${ft}<v>${num(val.v)}</v></c>`;
        default: return `<c r="${ref}"${s}${meta}>${ft}</c>`;
      }
    }
    const dt = x.dt ?? '';
    const vm = x.vm !== undefined && w.metadata && x.t === 'e' && errText(x.v) === '#VALUE!' ? ` vm="${esc(x.vm)}"` : '';
    switch (x.t) {
      case 'n': return `<c r="${ref}"${s}>${dt}<v>${num(x.v)}</v></c>`;
      case 's': return `<c r="${ref}"${s} t="s">${dt}<v>${w.sst.add(x)}</v></c>`;
      case 'b': return `<c r="${ref}"${s} t="b">${dt}<v>${x.v ? 1 : 0}</v></c>`;
      case 'e': return `<c r="${ref}"${s} t="e"${vm}>${dt}<v>${errText(x.v)}</v></c>`;
      default: return `<c r="${ref}"${s}/>`;
    }
  };

  const nextId = (taken) => { let n = 1; while (taken.has(`rId${n}`)) n++; taken.add(`rId${n}`); return `rId${n}`; };
  const relsXml = (list) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => tag('Relationship', { Id: r.id, Type: r.type, Target: r.target, TargetMode: r.mode })).join('')}</Relationships>`;
  const SHEET_REL = `${OD}/worksheet`;

  // The workbook model → .xlsx bytes (a Uint8Array). opts: { engine (the grid's, recalculated here instead of a new one),
  // recalc: false (write the values as they are), macros: false (leave a macro project out), date (the parts' time) }.
  const write = async (wb, opts = {}) => {
    const keepOld = refresh(wb, opts);
    const keep = wb.keep ?? {};
    const kept = { ...(keep.parts ?? {}) };
    const macros = opts.macros !== false && !!keep.flags?.macros && Object.keys(kept).some((p) => /vbaProject\.bin$/i.test(p));
    if (!macros) for (const p of Object.keys(kept)) if (/vbaProject\.bin$/i.test(p)) delete kept[p];
    const log = keep.log ?? [];
    const colors = keep.styles?.colors ?? {};
    const bookPath = keep.book?.path ?? 'xl/workbook.xml';
    const dir = dirOf(bookPath);
    const files = new Map();
    const put = (path, text) => files.set(path, typeof text === 'string' ? new TextEncoder().encode(text) : text);
    const metadata = !!(keep.book?.rels ?? []).find((r) => kindOf(r.type) === 'sheetMetadata' && kept[resolve(bookPath, r.target)]);
    // Sheet parts: the path each came from, unless an earlier sheet (a copy) or a kept part has it.
    const taken = new Set(Object.keys(kept).map((p) => p.toLowerCase()));
    const sst = stringTable();
    const sheetFiles = wb.sheets.map((sh) => {
      const path = sh.keep?.path, low = path?.toLowerCase();
      if (!path || taken.has(low)) return { sh, path: null, copy: !!path };
      taken.add(low);
      return { sh, path };
    });
    for (const f of sheetFiles) {
      if (f.path) continue;
      let n = 1;
      while (taken.has(`${dir}worksheets/sheet${n}.xml`.toLowerCase())) n++;
      f.path = `${dir}worksheets/sheet${n}.xml`;
      taken.add(f.path.toLowerCase());
    }
    // Kept relationships of each sheet; a part two sheets would share stays with the first.
    const owner = new Map();
    for (const f of sheetFiles) {
      f.rels = [];
      f.dropped = new Set();
      for (const r of f.sh.keep?.rels ?? []) {
        if (r.mode === 'External') { f.rels.push(r); continue; }
        const from = f.sh.keep.path ?? f.path;
        const target = resolve(from, r.target);
        if (owner.has(target)) { f.dropped.add(r.id); continue; }
        owner.set(target, f.sh);
        f.rels.push({ ...r, target: relative(f.path, target) });
      }
    }
    const active = Math.min(Math.max(0, wb.active | 0), wb.sheets.length - 1);
    for (const [i, f] of sheetFiles.entries()) {
      const entries = own(log, f.sh.id);
      put(f.path, writeSheet(f.sh, { sst, keepOld, active: i === active, log, entries, metadata, colors, dropped: f.dropped, copy: f.copy }));
      if (f.rels.length) put(relsPath(f.path), relsXml(f.rels));
    }
    // Workbook relationships: the kept ones keep their ids.
    const bookRels = (keep.book?.rels ?? []).filter((r) => macros || kindOf(r.type) !== 'vbaProject');
    const ids = new Set(bookRels.map((r) => r.id));
    for (const f of sheetFiles) { f.rid = nextId(ids); bookRels.push({ id: f.rid, type: SHEET_REL, target: relative(bookPath, f.path) }); }
    bookRels.push({ id: nextId(ids), type: `${OD}/styles`, target: relative(bookPath, `${dir}styles.xml`) });
    bookRels.push({ id: nextId(ids), type: `${OD}/sharedStrings`, target: relative(bookPath, `${dir}sharedStrings.xml`) });
    // Sheets in tab order, the kept chart sheets back where they stood.
    const tabs = [];
    const others = [...(keep.others ?? [])].filter((o) => o.rel);
    const usedIds = new Set(others.map((o) => Number(attrsOf(o.xml).sheetId)));
    for (const o of others.filter((x) => x.after === null)) tabs.push({ xml: o.xml, model: null });
    for (const f of sheetFiles) {
      let id = f.sh.id;
      if (usedIds.has(id) || !Number.isInteger(id) || id < 1) { id = 1; while (usedIds.has(id) || wb.sheets.some((s) => s !== f.sh && s.id === id)) id++; }
      usedIds.add(id);
      const state = f.sh.keep?.hidden ? (f.sh.keep.state === 'veryHidden' ? 'veryHidden' : 'hidden') : undefined;
      tabs.push({ xml: tag('sheet', { name: f.sh.name, sheetId: id, state, 'r:id': f.rid }), model: f.sh });
      for (const o of others.filter((x) => x.after === f.sh.id)) tabs.push({ xml: o.xml, model: null });
    }
    for (const o of others.filter((x) => x.after !== null && !wb.sheets.some((s) => s.id === x.after))) tabs.push({ xml: o.xml, model: null });
    const tabOf = (id) => tabs.findIndex((t) => t.model?.id === id);
    let activeTab = tabOf(wb.sheets[active].id);
    if (wb.sheets[active].keep?.hidden) { const v = tabs.findIndex((t) => t.model && !t.model.keep?.hidden); if (v >= 0) activeTab = v; }
    const names = (wb.names ?? []).filter((x) => x.sheet === undefined || tabOf(x.sheet) >= 0).map((x) => tag('definedName', {
      name: x.name, ...(x.attrs ?? {}), localSheetId: x.sheet !== undefined ? tabOf(x.sheet) : undefined, hidden: x.hidden ? '1' : undefined }, escBody(toFile(String(x.ref ?? '')))));
    const bk = keep.book ?? {};
    const pr = { ...(bk.workbookPr ?? {}) };
    delete pr.date1904;
    const viewA = { ...(bk.view ?? {}) };
    if (activeTab > 0) viewA.activeTab = activeTab; else delete viewA.activeTab;
    if (Number(viewA.firstSheet) >= tabs.length) delete viewA.firstSheet;
    const bookParts = [
      { rank: BOOK_RANK.get('workbookPr'), xml: tag('workbookPr', { ...(wb.date1904 && { date1904: '1' }), ...pr }) },
      { rank: BOOK_RANK.get('bookViews'), xml: `<bookViews>${tag('workbookView', viewA)}${(bk.views ?? []).join('')}</bookViews>` },
      { rank: BOOK_RANK.get('sheets'), xml: `<sheets>${tabs.map((t) => t.xml).join('')}</sheets>` },
      ...(names.length ? [{ rank: BOOK_RANK.get('definedNames'), xml: `<definedNames>${names.join('')}</definedNames>` }] : []),
      { rank: BOOK_RANK.get('calcPr'), xml: tag('calcPr', { ...(bk.calcPr ?? {}), calcId: bk.calcPr?.calcId ?? '191029', fullCalcOnLoad: '1' }) },
      ...(bk.xml ?? []).map((x) => ({ rank: x.rank, xml: x.xml })),
    ].sort((a, b) => a.rank - b.rank);
    put(bookPath, HEAD + (bk.root ?? `<workbook xmlns="${SML}" xmlns:r="${OD}">`) + bookParts.map((p) => p.xml).join('') + '</workbook>');
    put(relsPath(bookPath), relsXml(bookRels));
    put(`${dir}styles.xml`, writeStyles(wb));
    put(`${dir}sharedStrings.xml`, sst.xml(colors));
    // Package relationships and properties.
    const pkg = [...(keep.pkg ?? [])];
    const pids = new Set(pkg.map((r) => r.id));
    pkg.unshift({ id: nextId(pids), type: `${OD}/officeDocument`, target: bookPath });
    pkg.push({ id: nextId(pids), type: `${OD}/extended-properties`, target: 'docProps/app.xml' });
    put('_rels/.rels', relsXml(pkg));
    put('docProps/app.xml', `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Glaze</Application></Properties>`);
    // Kept parts reachable from what is written, their references moved.
    const reach = new Map();
    const visit = (rels, from, how) => {
      for (const r of rels) {
        if (r.mode === 'External') continue;
        const path = resolve(from, r.target);
        if (!kept[path] || reach.has(path)) continue;
        const kind = kindOf(r.type);
        reach.set(path, { ...how, kind });
        const rp = relsPath(path);
        if (kept[rp]) { reach.set(rp, { kind: 'rels' }); visit(relsOf(new TextDecoder().decode(kept[rp].data), path), path, how); }
      }
    };
    visit(pkg, '', {});
    visit(bookRels, bookPath, {});
    for (const f of sheetFiles) visit(f.rels, f.path, { sheet: f.sh });
    for (const [path, how] of reach) {
      if (files.has(path)) continue;
      const part = kept[path];
      let data = part.data;
      const shifting = log.length && /^(comments|threadedComment|table|vmlDrawing|drawing|chart|chartsheet)$/.test(how.kind);
      if (shifting) {
        const xml = new TextDecoder().decode(data);
        const entries = how.sheet ? own(log, how.sheet.id) : [];
        let moved = xml;
        if (how.kind === 'chart') moved = moveXml(xml, { entries: [], log, host: null, part: true });
        else if (how.sheet) moved = moveXml(xml, { entries, log: [], host: how.sheet.keep?.name ?? how.sheet.name, anchors: how.kind === 'drawing', vml: how.kind === 'vmlDrawing', part: true });
        if (moved && moved !== xml && !(how.sheet && !moved.trim())) data = new TextEncoder().encode(moved);
      }
      files.set(path, data);
    }
    // Content types.
    const defaults = { ...(keep.defaults ?? {}), rels: TYPES.rels, xml: 'application/xml' };
    const overrides = new Map();
    overrides.set(bookPath, macros ? TYPES.macro : TYPES.main);
    for (const f of sheetFiles) overrides.set(f.path, TYPES.sheet);
    overrides.set(`${dir}styles.xml`, TYPES.styles);
    overrides.set(`${dir}sharedStrings.xml`, TYPES.strings);
    overrides.set('docProps/app.xml', TYPES.app);
    for (const path of reach.keys()) {
      if (files.has(path) && !kept[path]) continue;
      const type = kept[path]?.type;
      const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
      if (type && defaults[ext] !== type) overrides.set(path, type);
    }
    const usedExt = new Set([...files.keys()].map((p) => p.slice(p.lastIndexOf('.') + 1).toLowerCase()));
    const ct = `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${Object.entries(defaults).filter(([ext]) => usedExt.has(ext) || ext === 'rels' || ext === 'xml')
      .map(([ext, type]) => tag('Default', { Extension: ext, ContentType: type })).join('')}${[...overrides].map(([p, type]) => tag('Override', { PartName: `/${p}`, ContentType: type })).join('')}</Types>`;
    const date = opts.date ?? new Date();
    const order = ['[Content_Types].xml', '_rels/.rels', ...[...files.keys()].filter((p) => p !== '_rels/.rels')];
    const list = [{ name: '[Content_Types].xml', data: new TextEncoder().encode(ct), date }, ...order.slice(1).map((name) => ({ name, data: files.get(name), date }))];
    const Zp = dep('GZ_ZIP', './zip.js');
    const chunks = await Zp.zipAsync(list, { deflate: opts.deflate !== false });
    const size = chunks.reduce((n, p) => n + p.length, 0);
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const p of chunks) { bytes.set(p, at); at += p.length; }
    return bytes;
  };
  // The extension the written file needs: a kept macro project makes it .xlsm.
  const extension = (wb) => (wb.keep?.flags?.macros && Object.keys(wb.keep.parts ?? {}).some((p) => /vbaProject\.bin$/i.test(p)) ? 'xlsm' : 'xlsx');

  // ── CSV and TSV ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // A file's text: its byte-order mark says the encoding (UTF-8, or UTF-16 as Excel's Unicode Text writes it); without one,
  // UTF-8, or Windows-1252 when the bytes aren't UTF-8.
  const fileText = (input) => {
    if (typeof input === 'string') return input.replace(/^﻿/, '');
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder('utf-8').decode(b.subarray(3));
    if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('windows-1252').decode(b); }
  };
  // The delimiter a file uses: of tab, comma, semicolon and pipe (a tie goes to the earlier), the one that most lines hold
  // the same number of, outside quotes, over its first 50 lines.
  const DELIMITERS = ['\t', ',', ';', '|'];
  const sniff = (text) => {
    const lines = [];
    let counts = DELIMITERS.map(() => 0), quoted = false;
    for (let i = 0, n = Math.min(text.length, 1 << 16); i < n && lines.length < 50; i++) {
      const ch = text[i];
      if (ch === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; lines.push(counts); counts = DELIMITERS.map(() => 0); continue; }
      const k = DELIMITERS.indexOf(ch);
      if (k >= 0) counts[k]++;
    }
    if (counts.some(Boolean)) lines.push(counts);
    let best = ',', score = 0;
    DELIMITERS.forEach((d, k) => {
      const tally = new Map();
      for (const l of lines) if (l[k]) tally.set(l[k], (tally.get(l[k]) ?? 0) + 1);
      const s = Math.max(0, ...tally.values());
      if (s > score) { score = s; best = d; }
    });
    return best;
  };
  // Rows of fields: quotes only at a field's start, "" for a quote inside them, CRLF, LF or CR between rows, no empty
  // row after a final line end. Adapted from Rimeward's parseDelimited; a row at a time, so a reader can stop at its cap.
  function* delimitedRows(text, delimiter, problems) {
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch !== '"') field += ch;
        else if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
        continue;
      }
      if (ch === '"' && field === '') quoted = true;
      else if (ch === delimiter) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        row.push(field); field = '';
        yield row;
        row = [];
        if (ch === '\r' && text[i + 1] === '\n') i++;
      } else field += ch;
    }
    if (quoted) problems.push({ code: 'quote', message: 'a quoted field has no closing quote' });
    if (field !== '' || row.length) { row.push(field); yield row; }
  }
  // A .csv or .tsv (bytes or text) → a workbook of one sheet, each field typed as Excel opens it (parseInput: numbers,
  // money, percents, dates and times with their formats, booleans, errors, formulas Excel would take). opts: { name (the
  // file's: .tsv means tabs, and the sheet is named after it), delimiter }.
  const readDelimited = (input, opts = {}) => {
    const text = fileText(input);
    const file = String(opts.name ?? '').split(/[\\/]/).pop();
    const delimiter = opts.delimiter ?? (/\.tsv$/i.test(file) ? '\t' : sniff(text));
    const wb = M.workbook();
    const sh = wb.sheets[0];
    const base = file.replace(/\.[^.]*$/, '').slice(0, 31).trim();
    if (base && !M.validName(wb, base, sh.id)) sh.name = base;
    const problems = [];
    let r = 0, cells = 0;
    for (const fields of delimitedRows(text, delimiter, problems)) {
      if (r >= MAX_ROWS) { problems.push({ code: 'bounds', message: 'rows past the last one were left out' }); break; }
      const row = new Map();
      for (let c = 0; c < fields.length && c < MAX_COLS; c++) {
        const s = fields[c];
        if (s === '') continue;
        if (cells >= CAP.cells) break;
        let cell;
        const x = s[0] === "'" ? { t: 's', v: s } : M.parseInput(s, { date1904: wb.date1904 });
        if (!x) continue;
        if (x.f !== undefined) { try { F.parse(x.f, r, c); cell = { t: 'z', f: F.normalize(x.f) }; } catch { cell = { t: 's', v: s }; } }
        else { cell = { t: x.t, v: x.v }; if (x.fmt) cell.s = M.internStyle(wb, { fmt: x.fmt }); }
        if (cell.t === 's' && cell.v.length > CAP.text) cell.v = cell.v.slice(0, CAP.text);
        row.set(c, cell);
        cells++;
      }
      if (row.size) sh.rows.set(r, row);
      if (cells >= CAP.cells) { problems.push({ code: 'cap-cells', message: 'a workbook holds 250,000 cells; the rest were left out' }); break; }
      r++;
    }
    wb.keep = { parts: {}, problems, log: [], sheetNames: { [sh.id]: sh.name } };
    return wb;
  };
  // One sheet (opts.sheet: its id or name; the active one) as Excel saves CSV UTF-8: each cell as its format shows it,
  // a field quoted when it holds the delimiter, a quote or a line break, CRLF after every row, a byte-order mark
  // (opts.bom: false leaves it out). opts.delimiter: '\t' for TSV. → text.
  const writeDelimited = (wb, opts = {}) => {
    const sh = opts.sheet === undefined ? wb.sheets[wb.active] ?? wb.sheets[0] : M.getSheet(wb, opts.sheet);
    if (!sh) fail('sheet', `no sheet ${opts.sheet}`);
    const d = opts.delimiter ?? ',';
    let r1 = -1, c1 = -1;
    for (const [r, row] of sh.rows) for (const [c, x] of row) if (x.t !== 'z') { r1 = Math.max(r1, r); c1 = Math.max(c1, c); }
    const shown = (x) => {
      if (!x || x.t === 'z') return '';
      if (x.t === 'b') return x.v ? 'TRUE' : 'FALSE';
      if (x.t === 'e') return String(x.v);
      const fmt = x.s ? wb.styles[x.s]?.fmt : 0;
      let out = null;
      try { out = NF.format(x.v, fmt ?? 0, { date1904: wb.date1904 }); } catch { out = null; }
      return out ?? String(x.v);
    };
    const quote = (s) => (s.includes(d) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [];
    for (let r = 0; r <= r1; r++) {
      const row = sh.rows.get(r);
      const fields = [];
      for (let c = 0; c <= c1; c++) fields.push(quote(shown(row?.get(c))));
      lines.push(`${fields.join(d)}\r\n`);
    }
    return (opts.bom === false ? '' : '﻿') + lines.join('');
  };

  const api = { read, write, track, locked, extension, readDelimited, writeDelimited, sniff, tinted, fromFile, toFile };
  for (const [k, fn] of Object.entries(api)) api[k] = (...args) => { deps(); return fn(...args); };
  return api;
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_XLSX; else GZ_SHEET_XLSX;
