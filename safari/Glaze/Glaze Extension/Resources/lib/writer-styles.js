// Glaze Writer's paper formats as data (MLA 9, APA 7 student, Chicago 17 notes-bibliography, and a student's own presets),
// and everything both sides of a paper are made from: the frame's page CSS, the line heights pagination counts in, and the
// .docx styles.xml, sectPr, settings.xml and fontTable.xml. One set of numbers, so what the editor shows and what Word opens
// can't drift. Lengths are inches and points here; px (96 per inch) and twips (1440 per inch) are made from them.
// Classic script; module.exports for node.
var GZ_WRITER_STYLES = globalThis.GZ_WRITER_STYLES || (() => {
  // Word's single line for each paper font, in ems: (winAscent + winDescent + external leading) / unitsPerEm of the fonts
  // Word has (Tinos, Arimo, Carlito and Cousine copy them; lib/fonts). Word's "double" is twice this, not twice the size.
  const LINE = { 'Times New Roman': 2355 / 2048, Arial: 2355 / 2048, Calibri: 2500 / 2048, 'Courier New': 2320 / 2048 };
  const FONTS = Object.keys(LINE);
  // An imported file's fonts Writer doesn't bundle but Word's are well known (Word 365's Aptos, Office's others): kept by
  // name, so the page uses the font where this computer has it and the .docx names it; their single line from the fonts'
  // own metrics (winAscent + winDescent + lineGap, read from Office's files), so lines are spaced as Word spaces them even
  // where the face falls back to its bundled twin. Aptos Display's file isn't on this Mac: Aptos's metrics, a guess.
  const LOCAL = {
    Aptos: [2631 / 2048, 'Calibri'], 'Aptos Display': [2631 / 2048, 'Calibri'], 'Calibri Light': [2500 / 2048, 'Calibri'], Cambria: [2401 / 2048, 'Times New Roman'],
    Georgia: [2327 / 2048, 'Times New Roman'], 'Century Gothic': [2440 / 2048, 'Arial'], 'Book Antiqua': [2545 / 2048, 'Times New Roman'],
  };
  for (const [name, [line]] of Object.entries(LOCAL)) LINE[name] = line;
  const KNOWN = [...FONTS, ...Object.keys(LOCAL)];
  // A font's CSS stack: itself, then its bundled twin where it is one of the well-known ones, then the generic family.
  const stack = (font) => (LOCAL[font] ? `"${font}", "${LOCAL[font][1]}", ${GENERIC_OF(LOCAL[font][1])}` : `"${font}", ${GENERIC_OF(font)}`);
  // The bundled face for each (lib/fonts/<face>-<weight>-<style>.woff2).
  const FACES = { 'Times New Roman': 'tinos', Arial: 'arimo', Calibri: 'carlito', 'Courier New': 'cousine' };
  const GENERIC = { 'Times New Roman': 'serif', Arial: 'sans-serif', Calibri: 'sans-serif', 'Courier New': 'monospace' };
  const GENERIC_OF = (font) => GENERIC[font] || 'serif';
  // fontTable.xml: panose, family and pitch as Word writes them.
  const TABLE = {
    'Times New Roman': ['02020603050405020304', 'roman', 'variable'], Arial: ['020B0604020202020204', 'swiss', 'variable'],
    Calibri: ['020F0502020204030204', 'swiss', 'variable'], 'Courier New': ['02070309020205020404', 'modern', 'fixed'],
  };
  const PAGE = { width: 8.5, height: 11 }; // US Letter
  const PX = 96, TWIPS = 1440;

  // A format: font and size (pt), line (Word's multiple), after (pt after each paragraph), first (first-line indent, in),
  // margins [top, right, bottom, left] (in), header { distance (in from the top), text 'name-page' | 'page' | 'none',
  // first (shown on page 1) }, opening ('heading': MLA's block on page 1; 'title-page'), title (the paper's title line),
  // headings by level (1-4: Ultra's paper schema keeps four), quote (block quotes: indent, line, after; and when a quote
  // must be one: more than `lines` lines or at least `words` words), list (Works Cited, References, Bibliography),
  // notes (footnotes' size, line, after, first), date ('dmy' | 'mdy') and cite ('mla' | 'apa' | 'chicago').
  const BASE = {
    font: 'Times New Roman', size: 12, line: 2, after: 0, first: 0.5, margins: [1, 1, 1, 1],
    header: { distance: 0.5, text: 'page', first: true },
    title: { align: 'center', bold: false },
    quote: { indent: 0.5, line: 2, after: 0, lines: 0, words: 0 },
    notes: { size: 10, line: 1, after: 0, first: 0.5 },
  };
  const FORMATS = {
    mla9: {
      ...BASE, id: 'mla9', label: 'MLA 9', opening: 'heading', date: 'dmy', cite: 'mla',
      header: { distance: 0.5, text: 'name-page', first: true },
      headings: [{ bold: true, align: 'left' }, { italic: true, align: 'left' }, { bold: true, align: 'center' }, { italic: true, align: 'center' }],
      quote: { ...BASE.quote, lines: 4 },
      list: { title: 'Works Cited', align: 'center', bold: false, hanging: 0.5, line: 2, after: 0 },
    },
    apa7: {
      ...BASE, id: 'apa7', label: 'APA 7', opening: 'title-page', date: 'mdy', cite: 'apa',
      title: { align: 'center', bold: true },
      headings: [{ bold: true, align: 'center' }, { bold: true, align: 'left' }, { bold: true, italic: true, align: 'left' }, { bold: true, align: 'left', first: 0.5 }],
      quote: { ...BASE.quote, words: 40 },
      list: { title: 'References', align: 'center', bold: true, hanging: 0.5, line: 2, after: 0 },
    },
    chicago17: {
      ...BASE, id: 'chicago17', label: 'Chicago 17', opening: 'title-page', date: 'mdy', cite: 'chicago',
      header: { distance: 0.5, text: 'page', first: false },
      headings: [{ bold: true, align: 'center' }, { bold: true, align: 'left' }, { italic: true, align: 'left' }, { align: 'left' }],
      quote: { indent: 0.5, line: 1, after: 12, lines: 5, words: 100 },
      notes: { size: 10, line: 1, after: 12, first: 0.5 },
      list: { title: 'Bibliography', align: 'center', bold: false, hanging: 0.5, line: 1, after: 12 },
    },
  };
  const IDS = Object.keys(FORMATS);

  // A student's own preset: one of the three with its own font, size, spacing, margins, indent and header. Anything out of
  // range or not one of the paper fonts is refused (null), so a stored preset can't break the page or the .docx.
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 100) / 100 : null);
  const custom = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const base = FORMATS[raw.base];
    const id = typeof raw.id === 'string' && /^custom:[\w-]{1,40}$/.test(raw.id) ? raw.id : null;
    const label = typeof raw.label === 'string' ? raw.label.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (!base || !id || !label) return null;
    const font = raw.font === undefined ? base.font : FONTS.includes(raw.font) ? raw.font : null;
    const size = raw.size === undefined ? base.size : num(raw.size, 8, 16);
    const line = raw.line === undefined ? base.line : [1, 1.15, 1.5, 2].includes(raw.line) ? raw.line : null;
    const first = raw.first === undefined ? base.first : num(raw.first, 0, 1);
    const margin = raw.margin === undefined ? base.margins[0] : num(raw.margin, 0.5, 1.5);
    const text = raw.header === undefined ? base.header.text : ['name-page', 'page', 'none'].includes(raw.header) ? raw.header : null;
    if ([font, size, line, first, margin, text].includes(null)) return null;
    return { ...base, id, label, base: base.id, font, size, line, first, margins: [margin, margin, margin, margin], header: { ...base.header, text }, list: { ...base.list, line: Math.min(line, base.list.line) } };
  };
  // An imported Word file's own page and defaults (the paper document's setup attribute): page [width, height] and
  // margins [top, right, bottom, left] (in), header and footer distances (in), the base font and size its text is in,
  // the default tab stop (in), kerning, a different first page (title), and the header's and footer's paragraphs
  // ({ default, first }: [{ align, line, after, before?, left?, right?, first?, exact?, least?, tabs?, runs: [{ text } |
  // { field: 'PAGE' | 'NUMPAGES' }, with b, i, u, s, sup, sub, font, size, color] }]). It comes from storage, so anything
  // out of range is refused (null) or dropped; what import stores has already been through here.
  const len = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 1000) / 1000 : null);
  const two = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v)) * 100) / 100 : null);
  const ALIGNS = ['center', 'right', 'justify'], KINDS = ['l', 'c', 'r', 'd'], LEADERS = ['dot', 'hyphen', 'underscore', 'middleDot', 'heavy'];
  const tabsOf = (raw) => {
    if (!Array.isArray(raw)) return null;
    const out = raw.slice(0, 64).filter((t) => Array.isArray(t) && two(t[0], 0, 22) != null && KINDS.includes(t[1])).map((t) => (LEADERS.includes(t[2]) ? [two(t[0], 0, 22), t[1], t[2]] : [two(t[0], 0, 22), t[1]]));
    return out.length ? out : null;
  };
  const MARKS = ['b', 'i', 'u', 's', 'sup', 'sub'];
  const runOf = (r) => {
    if (!r || typeof r !== 'object') return null;
    const out = {};
    if (r.field === 'PAGE' || r.field === 'NUMPAGES') out.field = r.field;
    else if (typeof r.text === 'string' && r.text) out.text = r.text.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 2000);
    else return null;
    for (const k of MARKS) if (r[k] === true) out[k] = true;
    if (KNOWN.includes(r.font)) out.font = r.font;
    if (two(r.size, 1, 200) != null) out.size = two(r.size, 1, 200);
    if (/^[0-9A-F]{6}$/.test(r.color || '')) out.color = r.color;
    return out;
  };
  const partOf = (raw) => {
    if (!Array.isArray(raw)) return null;
    return raw.slice(0, 20).filter((x) => x && typeof x === 'object').map((x) => {
      const out = { align: ALIGNS.includes(x.align) ? x.align : null, line: two(x.line, 0.5, 4) ?? 1, after: two(x.after, 0, 1584) ?? 0 };
      for (const k of ['before', 'left', 'right', 'first']) if (two(x[k], k === 'before' ? 0 : -22, 22) != null && (k !== 'before' || x[k])) out[k] = two(x[k], k === 'before' ? 0 : -22, 22);
      for (const k of ['exact', 'least']) if (two(x[k], 0.5, 1584) != null) out[k] = two(x[k], 0.5, 1584);
      const tabs = tabsOf(x.tabs); if (tabs) out.tabs = tabs;
      out.runs = (Array.isArray(x.runs) ? x.runs.slice(0, 200) : []).map(runOf).filter(Boolean);
      return out;
    });
  };
  const setup = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const page = Array.isArray(raw.page) && raw.page.length === 2 ? raw.page.map((v) => len(v, 2, 22)) : null;
    const margins = Array.isArray(raw.margins) && raw.margins.length === 4 ? raw.margins.map((v) => len(v, 0, 10)) : null;
    if (!page || page.includes(null) || !margins || margins.includes(null)) return null;
    // An inch of text each way at least, or the page can't hold a line.
    if (page[1] - margins[0] - margins[2] < 1 || page[0] - margins[1] - margins[3] < 1) return null;
    return {
      page, margins, header: len(raw.header, 0, 10) ?? 0.5, footer: len(raw.footer, 0, 10) ?? 0.5,
      font: KNOWN.includes(raw.font) ? raw.font : null, size: two(raw.size, 4, 96), tab: len(raw.tab, 0.05, 22) ?? 0.5, kern: raw.kern === true, title: raw.title === true,
      headers: { default: partOf(raw.headers?.default), first: partOf(raw.headers?.first) }, footers: { default: partOf(raw.footers?.default), first: partOf(raw.footers?.first) },
      own: raw.own === true,
    };
  };
  // Page setup on a paper Writer made (own: the student's, from Page setup…): the format's page, margins and header
  // distance with the change over them; its running header stays the format's ("Surname N") until the student edits it.
  const PAGES = { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14] };
  const pageSetup = (f, change = {}) => setup({
    page: [PAGE.width, PAGE.height], margins: f.margins, header: f.header.distance, footer: 0.5, tab: 0.5, title: f.header.text !== 'none' && !f.header.first,
    headers: { default: null, first: null }, footers: { default: null, first: null }, ...change, own: true,
  });
  // The format's running header as a setup's parts (what editing it starts from).
  const formatHeader = (f, surname = '') => [{ align: 'right', line: 1, after: 0, runs: f.header.text === 'none' ? [] : [...(f.header.text === 'name-page' && surname ? [{ text: `${surname} ` }] : []), { field: 'PAGE' }] }];
  // What the paper is laid out by: its format, with an imported file's own page, margins, base font, tab stop and header
  // and footer over it (the format still says what the checks want). One object per setup, so callers can compare.
  const looks = new WeakMap();
  const look = (f, raw) => {
    const s = raw && typeof raw === 'object' ? (looks.get(raw)?.s ?? setup(raw)) : null;
    if (!s) return f;
    const hit = looks.get(raw);
    if (hit && hit.f === f) return hit.look;
    const out = { ...f, setup: s, page: { width: s.page[0], height: s.page[1] }, margins: s.margins, font: s.font || f.font, size: s.size || f.size, tab: s.tab, kern: s.kern, header: { ...f.header, distance: s.header, ...(s.own ? { first: !s.title } : {}) }, footer: s.footer };
    looks.set(raw, { f, s, look: out });
    return out;
  };
  // An imported header's or footer's paragraphs on page n of total, its fields filled in; null when the paper has no
  // setup (the format's header then: headerText).
  const fill = (parts, n, total) => (parts || []).map((x) => ({ ...x, runs: x.runs.map((r) => (r.field ? (({ field, ...rest }) => ({ text: String(field === 'PAGE' ? n : total), ...rest }))(r) : r)) }));
  // The student's own setup keeps the format's header (null here) until its header has parts of its own.
  const headerParts = (f, n, total = '') => (f.setup && !(f.setup.own && f.setup.headers.default == null) ? fill(n === 1 && f.setup.title ? f.setup.headers.first : f.setup.headers.default, n, total) : null);
  const footerParts = (f, n, total = '') => (f.setup ? fill(n === 1 && f.setup.title ? f.setup.footers.first : f.setup.footers.default, n, total) : null);
  // A paper's format, from what it stores (an id of the three, or a preset) or a format already made. Unknown → MLA.
  const get = (f) => {
    if (typeof f === 'string') return FORMATS[f] || FORMATS.mla9;
    if (!f || typeof f !== 'object') return FORMATS.mla9;
    if (FORMATS[f.id] === f) return f;
    return custom(f.base && Array.isArray(f.margins) ? preset(f) : f) || FORMATS.mla9;
  };
  // What a preset stores (custom()'s input), from a format.
  const preset = (f) => ({ id: f.id, label: f.label, base: f.base || f.id, font: f.font, size: f.size, line: f.line, first: f.first, margin: f.margins[0], header: f.header.text });

  // ---- numbers both sides use
  const pt2px = (pt) => (pt * PX) / 72;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  // A line's height in px: Word's multiple of the font's single line at that size, which Word keeps in whole twips
  // (Times New Roman 12: 275.98 → 276 twips, 13.8pt; double 27.6pt, as its PDFs show). o.exact: exactly that many pt;
  // o.least: at least that many, or the single line when it is taller.
  const lineHeight = (f, o = {}) => {
    if (o.exact != null) return r3(pt2px(o.exact));
    const single = Math.round((o.size ?? f.size) * 20 * LINE[o.font || f.font]);
    if (o.least != null) return r3(pt2px(Math.max(single / 20, o.least)));
    return r3(pt2px(Math.round(single * (o.line ?? f.line)) / 20));
  };
  // Page geometry in px: the page's own size where the paper has one (an imported file's), else Letter.
  const geometry = (f) => {
    const [top, right, bottom, left] = f.margins.map((m) => m * PX), page = f.page || PAGE;
    return { width: page.width * PX, height: page.height * PX, top, right, bottom, left, body: page.height * PX - top - bottom, content: page.width * PX - left - right, header: f.header.distance * PX, ...(f.footer != null ? { footer: f.footer * PX } : {}) };
  };
  // A paragraph's first-line indent in inches: its own, else none for a centred or right-aligned line, else the format's.
  const firstOf = (f, attrs = {}) => (attrs.first != null ? attrs.first : attrs.align === 'center' || attrs.align === 'right' ? 0 : f.first);
  // The Paragraph dialog's starting values: what the format gives a paragraph there (where: { entry, quote, heading }),
  // and what it stores of the values chosen: only those that differ, each null otherwise. v.line: a multiple, or 'exact' /
  // 'least' / 'multiple' with v.at (pt, or the multiple).
  const paraBase = (f, where = {}, align) => {
    const set = where.entry ? f.list : where.quote ? f.quote : f, h = where.heading ? f.headings[where.heading - 1] || {} : null;
    const a = h ? h.align || 'left' : 'left';
    return { align: a, left: where.entry ? f.list.hanging : 0, right: 0, first: h ? h.first || 0 : where.quote ? 0 : where.entry ? -f.list.hanging : firstOf(f, { align: align || a }), before: 0, after: set.after, line: set.line, exact: null, least: null };
  };
  const paraAttrs = (f, where = {}, v = {}) => {
    const b = paraBase(f, where, v.align), eq = (x, y) => Math.abs(x - y) < 0.005, num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const out = {
      align: !v.align || v.align === b.align ? null : v.align,
      left: num(v.left) == null || eq(v.left, b.left) ? null : v.left, right: num(v.right) ? v.right : null,
      first: num(v.first) == null || eq(v.first, b.first) ? null : v.first, before: num(v.before) ? v.before : null,
      after: num(v.after) == null || eq(v.after, b.after) ? null : v.after, line: null, exact: null, least: null,
      keepNext: v.keepNext ? true : null, keepLines: v.keepLines ? true : null, widow: v.widow === false ? false : null,
    };
    if (v.line === 'exact' && num(v.at)) out.exact = v.at;
    else if (v.line === 'least' && num(v.at)) out.least = v.at;
    else { const m = v.line === 'multiple' ? num(v.at) : num(v.line); if (m != null && !eq(m, b.line)) out.line = m; }
    return out;
  };
  // The running header's text on page n (1-based), or '' where there is none. surname: MLA's "Lastname".
  const headerText = (f, n, surname = '') => {
    if (f.header.text === 'none' || (n === 1 && !f.header.first)) return '';
    return f.header.text === 'name-page' && surname ? `${surname} ${n}` : String(n);
  };
  // Today in the format's order: MLA "27 October 2026", APA and Chicago "October 27, 2026". English month names: the
  // paper is written in English whatever the page's language.
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const dateText = (f, d = new Date()) => (f.date === 'dmy' ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`);

  // The list of sources at the paper's end: its title, a centred paragraph reading Works Cited, References or
  // Bibliography (any of the three, so a paper switched between formats keeps it), and the entries after it, which take the
  // format's hanging indent and spacing. doc: a paper Node or its JSON. → { title, from, to } top-level indexes
  // (entries are [from, to)), or null.
  const TITLES = new Set(Object.values(FORMATS).map((x) => x.list.title.toLowerCase()));
  const kids = (doc) => (Array.isArray(doc?.content) ? doc.content : doc?.content?.content || []);
  const textOf = (n) => (typeof n.textContent === 'string' ? n.textContent : (n.content || []).map((c) => c.text || textOf(c)).join(''));
  const listAt = (doc) => {
    const all = kids(doc);
    for (let i = all.length - 1; i >= 0; i--) {
      const n = all[i], type = n.type?.name || n.type;
      if (type === 'paragraph' && n.attrs?.align === 'center' && TITLES.has(textOf(n).trim().toLowerCase())) {
        let to = i + 1;
        while (to < all.length && (all[to].type?.name || all[to].type) === 'paragraph') to++;
        return { title: i, from: i + 1, to };
      }
    }
    return null;
  };
  // A block's line height and space before and after, in px: a list entry, a quoted paragraph, a heading or body, with
  // what the paragraph sets itself over the format's.
  // slack: how far a line's box may hang past the page's text area and still fit, as Word lets multiple spacing's extra
  // space below the text do (exactly and at-least heights must fit whole).
  const blockBox = (f, attrs = {}, where = {}) => {
    const set = where.entry ? f.list : where.quote ? f.quote : f, line = attrs.line ?? set.line;
    const box = { line: lineHeight(f, { line, exact: attrs.exact, least: attrs.least }), after: r3(pt2px(attrs.after ?? set.after)), before: r3(pt2px(attrs.before ?? 0)) };
    if (attrs.exact == null && attrs.least == null && line > 1) box.slack = r3(box.line - lineHeight(f, { line: 1 }));
    return box;
  };

  // ---- the frame's page CSS (writer-paper.js puts it in an adopted sheet). Scoped to the paper's flow.
  const css = (f) => {
    const g = geometry(f), lh = lineHeight(f), q = f.quote, s = '.gp-flow .ProseMirror';
    const out = [
      `.gp-sheet { width: ${g.width}px; height: ${g.height}px; }`,
      `.gp-flow { width: ${g.content}px; left: ${g.left}px; top: ${g.top}px; }`,
      `.gp-hdr { top: ${g.header}px; right: ${g.right}px; left: ${g.left}px; font: ${f.size}pt/${lineHeight(f, { line: 1 })}px ${stack(f.font)}; }`,
      `.gp-notes { left: ${g.left}px; width: ${g.content}px; font: ${f.notes.size}pt/${lineHeight(f, { size: f.notes.size, line: f.notes.line })}px ${stack(f.font)}; }`,
      `.gp-notes p { padding-bottom: ${r3(pt2px(f.notes.after))}px; text-indent: ${f.notes.first}in; }`,
      `${s} { font-family: ${stack(f.font)}; font-size: ${f.size}pt; line-height: ${lh}px; tab-size: ${r3((f.tab || 0.5) * PX)}px;${f.kern != null ? ` font-kerning: ${f.kern ? 'normal' : 'none'};` : ''} }`,
      `.gp-ftr { bottom: ${g.footer ?? g.header}px; right: ${g.right}px; left: ${g.left}px; font: ${f.size}pt/${lineHeight(f, { line: 1 })}px ${stack(f.font)}; }`,
      // Space after (and an imported paragraph's before) as margins: between two paragraphs the larger counts, as in Word.
      `${s} p, ${s} li, ${s} h1, ${s} h2, ${s} h3, ${s} h4, ${s} pre { margin: 0 0 ${r3(pt2px(f.after))}px; padding: 0; text-indent: ${f.first}in; line-height: ${lh}px; }`,
      `${s} .ql-align-center, ${s} .ql-align-right { text-indent: 0; }`,
      `${s} blockquote { margin: 0; padding: 0 0 0 ${q.indent}in; }`,
      `${s} blockquote p { text-indent: 0; line-height: ${lineHeight(f, { line: q.line })}px; margin-bottom: ${r3(pt2px(q.after))}px; }`,
      `${s} pre { font-family: "Courier New"; text-indent: 0; white-space: pre-wrap; }`,
      `${s} li { text-indent: 0; padding-left: 0.5in; }`,
      `${s} img { max-height: ${g.body - lh}px; object-fit: contain; }`,
      `${s} p.gp-entry { padding-left: ${f.list.hanging}in; text-indent: -${f.list.hanging}in; line-height: ${lineHeight(f, { line: f.list.line })}px; margin-bottom: ${r3(pt2px(f.list.after))}px; }`,
    ];
    f.headings.forEach((h, i) => out.push(`${s} h${i + 1} { font-size: inherit; font-weight: ${h.bold ? 700 : 400}; font-style: ${h.italic ? 'italic' : 'normal'}; text-align: ${h.align}; text-indent: ${h.first || 0}in; }`));
    for (const align of ['left', 'center', 'right', 'justify']) out.push(`${s} .ql-align-${align} { text-align: ${align}; }`);
    for (let n = 1; n <= 8; n++) out.push(`${s} .ql-indent-${n} { padding-left: ${n * 0.5}in; }`, `${s} li.ql-indent-${n} { padding-left: ${n * 0.5 + 0.5}in; }`);
    return out.join('\n');
  };

  // ---- the .docx side
  const tw = (inches) => Math.round(inches * TWIPS);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const fonts = (font) => `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"/>`;
  const spacing = (line, after) => `<w:spacing w:before="0" w:after="${Math.round(after * 20)}" w:line="${Math.round(line * 240)}" w:lineRule="auto"/>`;
  const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };
  const style = (type, id, name, body, extra = '') => `<w:style w:type="${type}" w:styleId="${id}"${extra}><w:name w:val="${name}"/>${body}</w:style>`;
  // styles.xml's body (no declaration): the defaults, Normal with the format's first-line indent, headings 1-4, block
  // quote, bibliography entry, footnote text and reference, header and hyperlink.
  const stylesXML = (f) => {
    const runDefault = `<w:rPr>${fonts(f.font)}${f.kern ? '<w:kern w:val="2"/>' : ''}<w:sz w:val="${Math.round(f.size * 2)}"/><w:szCs w:val="${Math.round(f.size * 2)}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr>`;
    const heads = f.headings.map((h, i) => style('paragraph', `Heading${i + 1}`, `heading ${i + 1}`,
      `<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/>${spacing(f.line, 0)}<w:ind w:firstLine="${tw(h.first || 0)}"/><w:jc w:val="${JC[h.align]}"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b w:val="${h.bold ? 1 : 0}"/><w:bCs w:val="${h.bold ? 1 : 0}"/><w:i w:val="${h.italic ? 1 : 0}"/><w:iCs w:val="${h.italic ? 1 : 0}"/></w:rPr>`)).join('');
    const q = f.quote, l = f.list, n = f.notes;
    return `<w:styles ${W}><w:docDefaults><w:rPrDefault>${runDefault}</w:rPrDefault><w:pPrDefault><w:pPr><w:widowControl/>${spacing(f.line, f.after)}</w:pPr></w:pPrDefault></w:docDefaults>`
      + style('paragraph', 'Normal', 'Normal', `<w:qFormat/><w:pPr><w:ind w:firstLine="${tw(f.first)}"/></w:pPr>`, ' w:default="1"')
      + style('character', 'DefaultParagraphFont', 'Default Paragraph Font', '<w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/>', ' w:default="1"')
      + heads
      + style('paragraph', 'BlockQuote', 'Block Quote', `<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${spacing(q.line, q.after)}<w:ind w:left="${tw(q.indent)}" w:firstLine="0"/></w:pPr>`)
      + style('paragraph', 'Bibliography', 'Bibliography', `<w:basedOn w:val="Normal"/><w:next w:val="Bibliography"/><w:uiPriority w:val="37"/><w:pPr>${spacing(l.line, l.after)}<w:ind w:left="${tw(l.hanging)}" w:hanging="${tw(l.hanging)}"/></w:pPr>`)
      + style('paragraph', 'FootnoteText', 'footnote text', `<w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr>${spacing(n.line, n.after)}<w:ind w:firstLine="${tw(n.first)}"/></w:pPr><w:rPr><w:sz w:val="${n.size * 2}"/><w:szCs w:val="${n.size * 2}"/></w:rPr>`)
      + style('character', 'FootnoteReference', 'footnote reference', '<w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr>')
      + style('paragraph', 'Header', 'header', `<w:basedOn w:val="Normal"/><w:uiPriority w:val="99"/><w:pPr>${spacing(1, 0)}<w:ind w:firstLine="0"/></w:pPr>`)
      + style('character', 'Hyperlink', 'Hyperlink', '<w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/><w:unhideWhenUsed/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>')
      + '</w:styles>';
  };
  // The section: the page (Letter, or an imported file's own), the margins and header and footer distances, the default
  // header and footer (and first-page ones where page 1 differs). rels: { header, first, footer, footerFirst } ids.
  const sectPr = (f, rels = {}) => {
    const [top, right, bottom, left] = f.margins.map(tw), page = f.page || PAGE;
    const titlePg = f.setup ? f.setup.title : !f.header.first && f.header.text !== 'none';
    return `<w:sectPr>${rels.header ? `<w:headerReference w:type="default" r:id="${rels.header}"/>` : ''}${rels.footer ? `<w:footerReference w:type="default" r:id="${rels.footer}"/>` : ''}${titlePg && rels.first ? `<w:headerReference w:type="first" r:id="${rels.first}"/>` : ''}${titlePg && rels.footerFirst ? `<w:footerReference w:type="first" r:id="${rels.footerFirst}"/>` : ''}`
      + `<w:pgSz w:w="${tw(page.width)}" w:h="${tw(page.height)}"/><w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="${tw(f.header.distance)}" w:footer="${tw(f.footer ?? 0.5)}" w:gutter="0"/>`
      + `<w:cols w:space="720"/>${titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;
  };
  // settings.xml: Word 2013+ layout (compatibility mode 15, so Word opens it without the Compatibility Mode banner), and
  // the footnote separators when the paper has notes.
  const COMPAT = [['compatibilityMode', 15], ['overrideTableStyleFontSizeAndJustification', 1], ['enableOpenTypeFeatures', 1], ['doNotFlipMirrorIndents', 1], ['differentiateMultirowTableHeaders', 1]];
  const settingsXML = (notes = false, tab = 0.5) => `<w:settings ${W}><w:zoom w:percent="100"/><w:defaultTabStop w:val="${tw(tab)}"/><w:characterSpacingControl w:val="doNotCompress"/>`
    + `${notes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}`
    + `<w:compat>${COMPAT.map(([k, v]) => `<w:compatSetting w:name="${k}" w:uri="http://schemas.microsoft.com/office/word" w:val="${v}"/>`).join('')}</w:compat>`
    + '<w:themeFontLang w:val="en-US"/></w:settings>';
  // fonts: the paper's own besides the four (an imported file's well-known ones), named so Word lays it out in them.
  const fontTableXML = (fonts = []) => `<w:fonts ${W}>${FONTS.map((n) => `<w:font w:name="${n}"><w:panose1 w:val="${TABLE[n][0]}"/><w:charset w:val="00"/><w:family w:val="${TABLE[n][1]}"/><w:pitch w:val="${TABLE[n][2]}"/></w:font>`).join('')}${[...new Set(fonts)].filter((n) => LOCAL[n]).map((n) => `<w:font w:name="${esc(n)}"><w:charset w:val="00"/><w:family w:val="${TABLE[LOCAL[n][1]][1]}"/><w:pitch w:val="variable"/></w:font>`).join('')}</w:fonts>`;

  return { FORMATS, IDS, FONTS, LOCAL, KNOWN, stack, FACES, LINE, PAGE, PAGES, pageSetup, formatHeader, paraBase, paraAttrs, get, custom, preset, setup, look, headerParts, footerParts, lineHeight, geometry, firstOf, headerText, dateText, listAt, blockBox, css, stylesXML, sectPr, settingsXML, fontTableXML, twips: tw, tabsOf };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_STYLES; else GZ_WRITER_STYLES;
