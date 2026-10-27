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
  // The bundled face for each (lib/fonts/<face>-<weight>-<style>.woff2).
  const FACES = { 'Times New Roman': 'tinos', Arial: 'arimo', Calibri: 'carlito', 'Courier New': 'cousine' };
  const GENERIC = { 'Times New Roman': 'serif', Arial: 'sans-serif', Calibri: 'sans-serif', 'Courier New': 'monospace' };
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
  // (Times New Roman 12: 275.98 → 276 twips, 13.8pt; double 27.6pt, as its PDFs show).
  const lineHeight = (f, o = {}) => {
    const single = Math.round((o.size ?? f.size) * 20 * LINE[o.font || f.font]);
    return r3(pt2px(Math.round(single * (o.line ?? f.line)) / 20));
  };
  // Page geometry in px.
  const geometry = (f) => {
    const [top, right, bottom, left] = f.margins.map((m) => m * PX);
    return { width: PAGE.width * PX, height: PAGE.height * PX, top, right, bottom, left, body: PAGE.height * PX - top - bottom, content: PAGE.width * PX - left - right, header: f.header.distance * PX };
  };
  // A paragraph's first-line indent in inches: its own, else none for a centred or right-aligned line, else the format's.
  const firstOf = (f, attrs = {}) => (attrs.first != null ? attrs.first : attrs.align === 'center' || attrs.align === 'right' ? 0 : f.first);
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
  // A block's line height and space after, in px: a list entry, a quoted paragraph, a heading or body.
  const blockBox = (f, attrs = {}, where = {}) => {
    const set = where.entry ? f.list : where.quote ? f.quote : f;
    return { line: lineHeight(f, { line: attrs.line ?? set.line }), after: r3(pt2px(set.after)) };
  };

  // ---- the frame's page CSS (writer-paper.js puts it in an adopted sheet). Scoped to the paper's flow.
  const css = (f) => {
    const g = geometry(f), lh = lineHeight(f), q = f.quote, s = '.gp-flow .ProseMirror';
    const out = [
      `.gp-sheet { width: ${g.width}px; height: ${g.height}px; }`,
      `.gp-flow { width: ${g.content}px; left: ${g.left}px; top: ${g.top}px; }`,
      `.gp-hdr { top: ${g.header}px; right: ${g.right}px; left: ${g.left}px; font: ${f.size}pt/${lineHeight(f, { line: 1 })}px "${f.font}"; }`,
      `.gp-notes { left: ${g.left}px; width: ${g.content}px; font: ${f.notes.size}pt/${lineHeight(f, { size: f.notes.size, line: f.notes.line })}px "${f.font}"; }`,
      `.gp-notes p { padding-bottom: ${r3(pt2px(f.notes.after))}px; text-indent: ${f.notes.first}in; }`,
      `${s} { font-family: "${f.font}", ${GENERIC[f.font]}; font-size: ${f.size}pt; line-height: ${lh}px; }`,
      `${s} p, ${s} li, ${s} h1, ${s} h2, ${s} h3, ${s} h4, ${s} pre { margin: 0; padding: 0 0 ${r3(pt2px(f.after))}px; text-indent: ${f.first}in; line-height: ${lh}px; }`,
      `${s} .ql-align-center, ${s} .ql-align-right { text-indent: 0; }`,
      `${s} blockquote { margin: 0; padding: 0 0 0 ${q.indent}in; }`,
      `${s} blockquote p { text-indent: 0; line-height: ${lineHeight(f, { line: q.line })}px; padding-bottom: ${r3(pt2px(q.after))}px; }`,
      `${s} pre { font-family: "Courier New"; text-indent: 0; white-space: pre-wrap; }`,
      `${s} li { text-indent: 0; padding-left: 0.5in; }`,
      `${s} img { max-height: ${g.body - lh}px; object-fit: contain; }`,
      `${s} p.gp-entry { padding-left: ${f.list.hanging}in; text-indent: -${f.list.hanging}in; line-height: ${lineHeight(f, { line: f.list.line })}px; padding-bottom: ${r3(pt2px(f.list.after))}px; }`,
    ];
    f.headings.forEach((h, i) => out.push(`${s} h${i + 1} { font-size: inherit; font-weight: ${h.bold ? 700 : 400}; font-style: ${h.italic ? 'italic' : 'normal'}; text-align: ${h.align}; text-indent: ${h.first || 0}in; }`));
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
    const runDefault = `<w:rPr>${fonts(f.font)}<w:sz w:val="${f.size * 2}"/><w:szCs w:val="${f.size * 2}"/><w:lang w:val="en-US" w:eastAsia="en-US" w:bidi="ar-SA"/></w:rPr>`;
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
  // The section: Letter, the format's margins and header distance, the default header (and an empty first-page one where
  // page 1 shows none). rels: { header, first } relationship ids.
  const sectPr = (f, rels = {}) => {
    const [top, right, bottom, left] = f.margins.map(tw), titlePg = !f.header.first && f.header.text !== 'none';
    return `<w:sectPr>${rels.header ? `<w:headerReference w:type="default" r:id="${rels.header}"/>` : ''}${titlePg && rels.first ? `<w:headerReference w:type="first" r:id="${rels.first}"/>` : ''}`
      + `<w:pgSz w:w="${tw(PAGE.width)}" w:h="${tw(PAGE.height)}"/><w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="${tw(f.header.distance)}" w:footer="720" w:gutter="0"/>`
      + `<w:cols w:space="720"/>${titlePg ? '<w:titlePg/>' : ''}</w:sectPr>`;
  };
  // settings.xml: Word 2013+ layout (compatibility mode 15, so Word opens it without the Compatibility Mode banner), and
  // the footnote separators when the paper has notes.
  const COMPAT = [['compatibilityMode', 15], ['overrideTableStyleFontSizeAndJustification', 1], ['enableOpenTypeFeatures', 1], ['doNotFlipMirrorIndents', 1], ['differentiateMultirowTableHeaders', 1]];
  const settingsXML = (notes = false) => `<w:settings ${W}><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>`
    + `${notes ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}`
    + `<w:compat>${COMPAT.map(([k, v]) => `<w:compatSetting w:name="${k}" w:uri="http://schemas.microsoft.com/office/word" w:val="${v}"/>`).join('')}</w:compat>`
    + '<w:themeFontLang w:val="en-US"/></w:settings>';
  const fontTableXML = () => `<w:fonts ${W}>${FONTS.map((n) => `<w:font w:name="${n}"><w:panose1 w:val="${TABLE[n][0]}"/><w:charset w:val="00"/><w:family w:val="${TABLE[n][1]}"/><w:pitch w:val="${TABLE[n][2]}"/></w:font>`).join('')}</w:fonts>`;

  return { FORMATS, IDS, FONTS, FACES, LINE, PAGE, get, custom, preset, lineHeight, geometry, firstOf, headerText, dateText, listAt, blockBox, css, stylesXML, sectPr, settingsXML, fontTableXML, twips: tw };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_STYLES; else GZ_WRITER_STYLES;
