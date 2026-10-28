// Glaze Writer's .docx: a paper (the paper schema's document) out to a Word file, and a Word file in as HTML the paper
// schema reads. Export writes Word 2013+ OOXML (compatibility mode 15), Letter pages, the format's styles, header and
// sections from lib/writer-styles.js, real footnotes, and each list item and quoted paragraph as its own paragraph. Import
// reads the archive with lib/doctext.js's bounded unzip and tokenizer (no DOMParser, so it runs anywhere), as untrusted
// input: sizes, entries, elements and nesting are capped, no DTDs, no remote images. Ported from Rimeward's
// note-docx.ts (MIT, the owner's), onto Glaze's zip and the paper schema.
// Classic script, loaded by writer-paper.js and papers.html; module.exports for node.
var GZ_WRITER_DOCX = globalThis.GZ_WRITER_DOCX || (() => {
  const ST = () => (typeof GZ_WRITER_STYLES !== 'undefined' ? GZ_WRITER_STYLES : require('./writer-styles.js'));
  const S = () => (typeof GZ_WRITER_SCHEMA !== 'undefined' ? GZ_WRITER_SCHEMA : require('./writer-schema.js'));
  const ZIP = () => (typeof GZ_ZIP !== 'undefined' ? GZ_ZIP : require('./zip.js'));
  const TEXT = () => (typeof GZ_DOCTEXT !== 'undefined' ? GZ_DOCTEXT : require('./doctext.js'));

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const NS = `xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
  const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  // Text for XML: what XML forbids dropped, markup escaped (lib/writer-objects-docx.js writes with it too).
  const esc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };
  const LIMIT = { file: 15e6, entries: 2000, entry: 10e6, total: 35e6, part: 5e6, elements: 100000, depth: 80, images: 10e6, html: 16 * 1024 * 1024 };
  const b64 = (s) => (typeof atob === 'function' ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));
  const base64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); };

  // ================================================================================================================
  // Export
  // ================================================================================================================
  // doc: a paper-schema Node (or its JSON); o: { format, surname (MLA's header name), title, date (Date: the archive's
  // and properties' time, so tests can pin it) }. An imported paper's setup gives the page, defaults, header and footer.
  // → { bytes: Uint8Array, parts: { path: xml }, type }.
  const exportDocx = (doc, o = {}) => {
    const schema = S().paper;
    if (typeof doc?.forEach !== 'function') doc = schema.nodeFromJSON(doc);
    const f = ST().look(ST().get(o.format), doc.attrs?.setup), date = o.date instanceof Date ? o.date : new Date();
    const rels = [], noteRels = [], overrides = [], parts = {}, media = [];
    const rel = (type, target, external = false, pool = rels) => {
      const hit = pool.find((r) => r.type === type && r.target === target && r.external === external);
      if (hit) return hit.id;
      const id = `rId${pool.length + 1}`;
      pool.push({ id, type, target, external });
      return id;
    };
    const part = (path, kind, body) => { parts[path] = DECL + body; overrides.push([path, `application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml`]); };
    const notes = [], lists = [];
    let images = 0, imageBytes = 0, pendingBreak = 0;

    // ---- runs
    const runProps = (m, extra = '') => {
      let s = extra;
      const style = m.text_style, mk = (k) => m[k];
      if (style?.font) s += `<w:rFonts w:ascii="${esc(style.font)}" w:hAnsi="${esc(style.font)}" w:eastAsia="${esc(style.font)}" w:cs="${esc(style.font)}"/>`;
      if (mk('bold')) s += '<w:b/><w:bCs/>';
      else if (m.bold === false) s += '<w:b w:val="0"/><w:bCs w:val="0"/>';
      if (mk('italic')) s += '<w:i/><w:iCs/>';
      else if (m.italic === false) s += '<w:i w:val="0"/><w:iCs w:val="0"/>';
      if (mk('all_caps')) s += '<w:caps/>';
      if (mk('small_caps')) s += '<w:smallCaps/>';
      if (mk('strike')) s += '<w:strike/>';
      if (m.color?.color) s += `<w:color w:val="${esc(m.color.color)}"/>`;
      if (style?.size) s += `<w:sz w:val="${Math.round(style.size * 2)}"/><w:szCs w:val="${Math.round(style.size * 2)}"/>`;
      if (m.highlight) s += `<w:highlight w:val="${esc(m.highlight.color || 'yellow')}"/>`;
      if (mk('underline')) s += '<w:u w:val="single"/>';
      if (mk('sup')) s += '<w:vertAlign w:val="superscript"/>';
      else if (mk('sub')) s += '<w:vertAlign w:val="subscript"/>';
      if (m.direction) s += m.direction.dir === 'rtl' ? '<w:rtl/>' : '<w:rtl w:val="0"/>';
      return s ? `<w:rPr>${s}</w:rPr>` : '';
    };
    const marksOf = (node) => Object.fromEntries(node.marks.map((m) => [m.type.name, m.attrs && Object.keys(m.attrs).length ? m.attrs : true]));
    const textRun = (text, m, rStyle = '') => `<w:r>${runProps(m, rStyle ? `<w:rStyle w:val="${rStyle}"/>` : '')}${String(text).split(/(\t|\n)/).filter((x) => x !== '').map((x) => (x === '\t' ? '<w:tab/>' : x === '\n' ? '<w:br/>' : `<w:t xml:space="preserve">${esc(x)}</w:t>`)).join('')}</w:r>`;
    const image = (node) => {
      const m = /^data:image\/(png|jpeg|gif);base64,([a-z\d+/=]+)$/i.exec(node.attrs.src || '');
      if (!m) throw new Error('This picture cannot be exported to Word.');
      const bytes = b64(m[2]);
      imageBytes += bytes.length;
      if (imageBytes > LIMIT.images) throw new RangeError('images too large');
      const ext = m[1].toLowerCase(), n = ++images, name = `media/image${n}.${ext === 'jpeg' ? 'jpeg' : ext}`;
      media.push({ path: `word/${name}`, bytes });
      const id = rel(`${R}/image`, name);
      let size = null;
      try { size = TEXT().imageSize?.(bytes) || null; } catch { size = null; }
      const geo = ST().geometry(f);
      let wpx = Math.min(node.attrs.width || size?.w || 320, geo.content);
      let hpx = size?.w && size?.h ? (wpx * size.h) / size.w : wpx * 0.625;
      const maxHeight = geo.body - ST().lineHeight(f);
      if (hpx > maxHeight) { wpx *= maxHeight / hpx; hpx = maxHeight; }
      const cx = Math.round(wpx * 9525), cy = Math.round(hpx * 9525);
      return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}" descr="${esc(node.attrs.alt)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="Picture ${n}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    };
    const noteRuns = (html) => {
      const d = S().parse(schema, `<p>${html}</p>`);
      let out = '';
      d.descendants((n) => { if (n.isTextblock) { out += inlines(n, true); return false; } return true; });
      return out;
    };
    // A textblock's inline content. Adjacent text with one link becomes one hyperlink.
    const inlines = (block, inNote = false) => {
      let out = '', link = null, linked = '';
      const flush = () => { if (link) { out += `<w:hyperlink r:id="${rel(`${R}/hyperlink`, link, true, inNote ? noteRels : rels)}" w:history="1">${linked}</w:hyperlink>`; link = null; linked = ''; } };
      block.forEach((c) => {
        const m = { ...(block.attrs.weight != null ? { bold: block.attrs.weight === 'bold' } : {}), ...(block.attrs.slant != null ? { italic: block.attrs.slant === 'italic' } : {}), ...marksOf(c) }, href = m.link?.href || null;
        let x = '';
        if (c.isText) x = textRun(c.text, m, href ? 'Hyperlink' : '');
        else if (c.type.name === 'hard_break') x = '<w:r><w:br/></w:r>';
        else if (c.type.name === 'image') x = image(c);
        else if (c.type.name === 'footnote_ref' && !inNote) {
          const id = notes.length + 1;
          notes.push(c.attrs.content || '');
          x = `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
        }
        if (href !== link) flush();
        if (href) { link = href; linked += x; } else out += x;
      });
      flush();
      return out;
    };

    // ---- paragraphs
    const tw = ST().twips;
    // pPr in the schema's order: style, keeps, page break, widow control, numbering, tabs, direction, spacing, indent,
    // alignment (rPr's too: CT_RPr's, direction after vertical alignment).
    const TAB = { l: 'left', c: 'center', r: 'right', d: 'decimal' };
    const tabsXML = (tabs) => (tabs?.length ? `<w:tabs>${tabs.map(([pos, kind, leader]) => `<w:tab w:val="${TAB[kind] || 'left'}"${leader ? ` w:leader="${esc(leader)}"` : ''} w:pos="${tw(pos)}"/>`).join('')}</w:tabs>` : '');
    const spacingXML = (a) => {
      const line = a.exact != null ? ` w:line="${Math.round(a.exact * 20)}" w:lineRule="exact"` : a.least != null ? ` w:line="${Math.round(a.least * 20)}" w:lineRule="atLeast"` : a.line != null ? ` w:line="${Math.round(a.line * 240)}" w:lineRule="auto"` : '';
      const attrs = `${a.before != null ? ` w:before="${Math.round(a.before * 20)}"` : ''}${a.after != null ? ` w:after="${Math.round(a.after * 20)}"` : ''}${line}`;
      return attrs ? `<w:spacing${attrs}/>` : '';
    };
    const pPr = (node, o2 = {}) => {
      const a = node.attrs || {};
      let s = o2.style ? `<w:pStyle w:val="${o2.style}"/>` : '';
      if (a.keepNext) s += '<w:keepNext/>';
      if (a.keepLines) s += '<w:keepLines/>';
      if (pendingBreak) { s += '<w:pageBreakBefore/>'; pendingBreak = 0; }
      if (a.widow === false) s += '<w:widowControl w:val="0"/>';
      if (o2.num) s += `<w:numPr><w:ilvl w:val="${o2.num.level}"/><w:numId w:val="${o2.num.id}"/></w:numPr>`;
      s += tabsXML(a.tabs);
      if (a.dir) s += a.dir === 'rtl' ? '<w:bidi/>' : '<w:bidi w:val="0"/>';
      s += spacingXML(a);
      if (!o2.num) {
        const base = o2.quote ? f.quote.indent : 0, left = base + (a.left != null ? a.left : (a.indent || 0) * 0.5);
        const first = a.first != null ? a.first : (a.align === 'center' || a.align === 'right') && !o2.quote && !o2.heading ? 0 : null;
        const attrs = [left !== base || (a.left != null && o2.style === 'Bibliography') ? ` w:left="${tw(left)}"` : '', a.right != null ? ` w:right="${tw(a.right)}"` : '', first != null ? (first < 0 ? ` w:hanging="${tw(-first)}"` : ` w:firstLine="${tw(first)}"`) : '', o2.cell && first == null ? ' w:firstLine="0"' : ''].join('');
        if (attrs) s += `<w:ind${attrs}/>`;
      }
      if (a.align) s += `<w:jc w:val="${JC[a.align] || 'left'}"/>`;
      return s ? `<w:pPr>${s}</w:pPr>` : '';
    };
    const para = (node, o2 = {}) => `<w:p>${pPr(node, o2)}${inlines(node)}</w:p>`;
    // Word's numbering for one list: bullets, or decimal / letter / roman by level as Quill counts them.
    const list = (node, o2) => {
      const id = lists.length + 1, ordered = node.type.name === 'ordered_list';
      lists.push(ordered);
      let out = '';
      node.forEach((li) => { out += para(li, { ...o2, num: { id, level: Math.min(8, li.attrs.indent || 0) } }); });
      return out;
    };
    const table = (node, o2) => {
      const geo = ST().geometry(f);
      let cols = 0;
      node.forEach((row) => { let n = 0; row.forEach((c) => { n += c.attrs.colspan || 1; }); cols = Math.max(cols, n); });
      cols = Math.max(1, Math.min(63, cols));
      const width = Math.floor(tw(geo.content / 96) / cols), active = new Map();
      let rows = '';
      node.forEach((row) => {
        let col = 0, cells = '';
        const carry = () => { while (active.has(col)) { const a = active.get(col); cells += `<w:tc><w:tcPr><w:tcW w:w="${width * a.span}" w:type="dxa"/>${a.span > 1 ? `<w:gridSpan w:val="${a.span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`; if (--a.rows <= 0) active.delete(col); col += a.span; } };
        row.forEach((cell) => {
          carry();
          const span = Math.max(1, Math.min(63, cell.attrs.colspan || 1)), rs = Math.max(1, Math.min(1000, cell.attrs.rowspan || 1));
          const inner = blocks(cell, { ...o2, cell: true });
          cells += `<w:tc><w:tcPr><w:tcW w:w="${width * span}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${rs > 1 ? '<w:vMerge w:val="restart"/>' : ''}</w:tcPr>${inner || '<w:p/>'}${inner.endsWith('</w:tbl>') ? '<w:p/>' : ''}</w:tc>`;
          if (rs > 1) active.set(col, { rows: rs - 1, span });
          col += span;
        });
        carry();
        rows += `<w:tr>${cells}</w:tr>`;
      });
      const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${borders}</w:tblBorders><w:tblLook w:val="04A0"/></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
    };
    // One page break is the next paragraph's page break before. Two or more in a row, or one before a table (whose cells
    // Word gives no page break before), are each a paragraph holding a page break, as Word writes them.
    const breaks = () => { const s = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'.repeat(pendingBreak); pendingBreak = 0; return s; };
    const blocks = (parent, o2 = {}, depth = 0) => {
      if (depth > 40) throw new RangeError('document nesting too deep');
      let out = '';
      parent.forEach((node, _, index) => {
        const name = node.type.name, entry = parent === doc && list0 && index >= list0.from && index < list0.to;
        if (pendingBreak && name !== 'page_break' && (pendingBreak > 1 || name === 'table')) out += breaks();
        if (name === 'paragraph') out += para(node, { ...o2, style: o2.quote ? 'BlockQuote' : entry ? 'Bibliography' : '' });
        else if (name === 'heading') out += para(node, { ...o2, heading: true, style: `Heading${Math.min(6, Math.max(1, node.attrs.level))}` });
        else if (name === 'bullet_list' || name === 'ordered_list') out += list(node, o2);
        else if (name === 'blockquote') out += blocks(node, { ...o2, quote: true }, depth + 1);
        else if (name === 'code_block') {
          for (const line of (node.textContent || '').split('\n')) out += `<w:p>${pPr({ attrs: { first: 0 } }, o2)}${line ? textRun(line, { text_style: { font: 'Courier New' } }) : ''}</w:p>`;
        } else if (name === 'horizontal_rule') {
          const pr = pPr({ attrs: {} }, { style: o2.quote ? 'BlockQuote' : '' });
          const border = '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr><w:ind w:firstLine="0"/>';
          out += `<w:p>${pr ? pr.replace('</w:pPr>', `${border}</w:pPr>`) : `<w:pPr>${border}</w:pPr>`}</w:p>`;
        } else if (name === 'page_break') pendingBreak++;
        else if (name === 'table') out += table(node, o2);
      });
      return out;
    };

    const list0 = ST().listAt(doc);
    let body = blocks(doc);
    if (pendingBreak > 1) body += `${breaks()}<w:p/>`;
    else if (pendingBreak) body += `<w:p>${pPr({ attrs: {} })}</w:p>`;
    if (!body) body = '<w:p/>';

    // ---- the package
    const header = {}, title = String(o.title || '').slice(0, 500);
    // An imported paper's own header and footer: their paragraphs, runs and PAGE / NUMPAGES fields.
    const fieldXML = (code, rp) => `<w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>1</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r>`;
    const partRun = (r) => {
      const m = { bold: r.b, italic: r.i, underline: r.u, strike: r.s, sup: r.sup, sub: r.sub, ...(r.font || r.size ? { text_style: { font: r.font || null, size: r.size || null } } : {}), ...(r.color ? { color: { color: r.color } } : {}) };
      return r.field ? fieldXML(r.field, runProps(m)) : textRun(r.text, m);
    };
    const partXML = (kind, paras) => `<w:${kind} ${NS}>${(paras?.length ? paras : [{ runs: [] }]).map((x) => `<w:p><w:pPr><w:pStyle w:val="Header"/>${tabsXML(x.tabs)}${spacingXML({ before: x.before, after: x.after ?? 0, line: x.exact == null && x.least == null ? x.line ?? 1 : null, exact: x.exact, least: x.least })}<w:ind${x.left ? ` w:left="${tw(x.left)}"` : ''}${x.right ? ` w:right="${tw(x.right)}"` : ''}${x.first < 0 ? ` w:hanging="${tw(-x.first)}"` : ` w:firstLine="${tw(x.first || 0)}"`}/>${x.align ? `<w:jc w:val="${JC[x.align]}"/>` : ''}</w:pPr>${x.runs.map(partRun).join('')}</w:p>`).join('')}</w:${kind}>`;
    // The setup's own header (an imported file's, or one the student edited); a paper's own setup keeps the format's
    // header until then, its footer the setup's.
    const s2 = f.setup, n = { header: 0, footer: 0 }, ownHeader = s2 && !(s2.own && s2.headers.default == null);
    const add = (kind, paras, key) => { const name = `${kind}${++n[kind]}.xml`; part(`word/${name}`, kind, partXML(kind === 'header' ? 'hdr' : 'ftr', paras)); header[key] = rel(`${R}/${kind}`, name); };
    if (ownHeader) {
      if (s2.headers.default) add('header', s2.headers.default, 'header');
      if (s2.footers.default) add('footer', s2.footers.default, 'footer');
      if (s2.title && (s2.headers.first || s2.headers.default)) add('header', s2.headers.first, 'first');
      if (s2.title && (s2.footers.first || s2.footers.default)) add('footer', s2.footers.first, 'footerFirst');
    } else if (f.header.text !== 'none') {
      const name = f.header.text === 'name-page' && o.surname ? `${String(o.surname).slice(0, 100)} ` : '';
      const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
      part('word/header1.xml', 'header', `<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${name ? `<w:r><w:t xml:space="preserve">${esc(name)}</w:t></w:r>` : ''}${field}</w:p></w:hdr>`);
      header.header = rel(`${R}/header`, 'header1.xml');
      if (!f.header.first) {
        part('word/header2.xml', 'header', `<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr></w:p></w:hdr>`);
        header.first = rel(`${R}/header`, 'header2.xml');
      }
    }
    if (s2 && !ownHeader) {
      if (s2.footers.default) add('footer', s2.footers.default, 'footer');
      if (s2.title && (s2.footers.first || s2.footers.default)) add('footer', s2.footers.first, 'footerFirst');
    }
    part('word/document.xml', 'document.main', `<w:document ${NS}><w:body>${body}${ST().sectPr(f, header)}</w:body></w:document>`);
    part('word/styles.xml', 'styles', ST().stylesXML(f));
    rel(`${R}/styles`, 'styles.xml');
    part('word/settings.xml', 'settings', ST().settingsXML(notes.length > 0, f.tab || 0.5));
    rel(`${R}/settings`, 'settings.xml');
    const used = [f.font];
    doc.descendants((x) => { const st = x.isText && x.marks.find((m) => m.type.name === 'text_style' && m.attrs.font); if (st) used.push(st.attrs.font); return true; });
    part('word/fontTable.xml', 'fontTable', ST().fontTableXML(used));
    rel(`${R}/fontTable`, 'fontTable.xml');
    if (lists.length) {
      const lvls = (ordered) => Array.from({ length: 9 }, (_, l) => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? ['decimal', 'lowerLetter', 'lowerRoman'][l % 3] : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${l + 1}.` : ['•', '◦', '▪'][l % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('');
      part('word/numbering.xml', 'numbering', `<w:numbering ${NS}>${lists.map((ordered, i) => `<w:abstractNum w:abstractNumId="${i + 1}"><w:multiLevelType w:val="hybridMultilevel"/>${lvls(ordered)}</w:abstractNum>`).join('')}${lists.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i + 1}"/></w:num>`).join('')}</w:numbering>`);
      rel(`${R}/numbering`, 'numbering.xml');
    }
    if (notes.length) {
      const sep = (type, id, mark) => `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:${mark}/></w:r></w:p></w:footnote>`;
      const body2 = notes.map((html, i) => `<w:footnote w:id="${i + 1}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>${noteRuns(html)}</w:p></w:footnote>`).join('');
      part('word/footnotes.xml', 'footnotes', `<w:footnotes ${NS}>${sep('separator', -1, 'separator')}${sep('continuationSeparator', 0, 'continuationSeparator')}${body2}</w:footnotes>`);
      rel(`${R}/footnotes`, 'footnotes.xml');
    }
    const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
    parts['docProps/core.xml'] = `${DECL}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${stamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${stamp}</dcterms:modified></cp:coreProperties>`;
    parts['docProps/app.xml'] = `${DECL}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Glaze Writer</Application></Properties>`;
    if (noteRels.length) parts['word/_rels/footnotes.xml.rels'] = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${noteRels.map((r) => `<Relationship Id="${r.id}" Type="${esc(r.type)}" Target="${esc(r.target)}" TargetMode="External"/>`).join('')}</Relationships>`;
    parts['word/_rels/document.xml.rels'] = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="${esc(r.type)}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
    parts['_rels/.rels'] = `${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${R}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    parts['[Content_Types].xml'] = `${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>${overrides.map(([p, c]) => `<Override PartName="/${p}" ContentType="${c}"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;

    globalThis.GZ_WRITER_OBJECTS_DOCX?.exportParts(doc, parts, { format: ST().get(o.format) });
    const enc = new TextEncoder(), order = ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'word/document.xml', 'word/_rels/document.xml.rels'];
    const names = [...order, ...Object.keys(parts).filter((p) => !order.includes(p)).sort()];
    const files = [...names.map((name) => ({ name, data: enc.encode(parts[name]), date })), ...media.map((m) => ({ name: m.path, data: m.bytes, date }))];
    const chunks = ZIP().zip(files), bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { bytes.set(c, at); at += c.length; }
    return { bytes, parts, type: MIME, notes: notes.length };
  };

  // ================================================================================================================
  // Import
  // ================================================================================================================
  // XML text → a small tree of { name, local, a: attributes, kids } and { text }, through doctext's tokenizer.
  const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const xml = (src) => {
    if (src.length > LIMIT.part) throw new RangeError('a part of the document is too large');
    if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new Error('XML declarations are not supported');
    const root = { name: '#root', local: '#root', a: {}, kids: [] }, stack = [root];
    let count = 0;
    for (const t of TEXT().tokens(src)) {
      const top = stack.at(-1);
      if (t.text != null || t.cdata != null) { top.kids.push({ text: t.cdata ?? TEXT().decode(t.text) }); continue; }
      if (t.close) { if (stack.length < 2 || top.name !== t.name) throw new Error('malformed XML'); stack.pop(); continue; }
      if (++count > LIMIT.elements) throw new RangeError('too many elements');
      const a = {};
      for (const m of t.attrs.matchAll(ATTR)) a[m[1]] = TEXT().decode(m[2] ?? m[3]);
      const node = { name: t.name, local: t.name.slice(t.name.lastIndexOf(':') + 1), a, kids: [] };
      top.kids.push(node);
      if (!t.empty) { if (stack.length > LIMIT.depth * 4) throw new RangeError('document nesting too deep'); stack.push(node); }
    }
    if (stack.length !== 1 || els(root).length !== 1) throw new Error('malformed XML');
    return root;
  };
  const els = (n) => (n?.kids || []).filter((k) => k.name);
  const kid = (n, local) => els(n).find((k) => k.local === local);
  const all = (n, local, out = []) => { for (const k of els(n)) { if (k.local === local) out.push(k); all(k, local, out); } return out; };
  const at = (n, local) => { if (!n) return ''; for (const [k, v] of Object.entries(n.a)) if (k === local || k.endsWith(`:${local}`)) return v; return ''; };
  const val = (n, local) => at(kid(n, local), 'val');
  const fin = (v, d = 0, lo = -1e5, hi = 1e5) => (v !== '' && Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const on = (n) => !!n && !['0', 'false', 'off', 'none'].includes(at(n, 'val'));
  const escH = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // bytes: the .docx; o: { format }. The file as Word lays it out: each paragraph's and run's properties resolved from the
  // document's defaults through its paragraph style's basedOn chain and its character style to its own, then kept where
  // they differ from what the format gives a paragraph in that place, so the paper follows its format wherever the file
  // does. The last section's page, margins, header and footer, the font and size most of the text is in, the default tab
  // stop and kerning are the paper's setup (lib/writer-styles.js setup).
  // → { doc (the paper's JSON, its setup on it), html (the paper schema's parse with { pre: true } reads it), setup,
  // warnings: [key] }.
  const importDocx = async (bytes, o = {}) => {
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!buf.length || buf.length > LIMIT.file) throw new RangeError('Choose a Word file smaller than 15 MB.');
    const z = TEXT().unzip(buf, { limits: { input: LIMIT.file, entries: LIMIT.entries, entry: LIMIT.entry, total: LIMIT.total, duplicates: true } });
    const seen = new Set();
    for (const name of z.names) {
      if (name.startsWith('/') || /[\\\u0000-\u001f]/.test(name) || name.split('/').some((p) => p === '..' || p === '.') || seen.has(name.toLowerCase())) throw new Error('The Word file has invalid or duplicate paths.');
      seen.add(name.toLowerCase());
    }
    const f = ST().get(o.format), warnings = new Set(), warn = (k) => warnings.add(k);
    // Part names are case-insensitive (the paths above are unique that way).
    const cache = new Map(), named = new Map(z.names.map((n) => [n.toLowerCase(), n])), entry = (path) => named.get(String(path).toLowerCase());
    const part = async (path) => {
      if (!cache.has(path)) cache.set(path, entry(path) ? z.text(entry(path)).then((t) => (t == null ? null : xml(t))) : Promise.resolve(null));
      return cache.get(path);
    };
    // A part's relationships, read once: { list, id: Map (the first of each id) }.
    const relCache = new Map();
    const relsOf = (path) => {
      if (!relCache.has(path)) relCache.set(path, (async () => {
        const slash = path.lastIndexOf('/'), dir = path.slice(0, slash + 1), x = await part(`${dir}_rels/${path.slice(slash + 1)}.rels`);
        const list = all(x, 'Relationship').map((r) => {
          const external = r.a.TargetMode === 'External';
          let target = r.a.Target || '';
          if (!external) { const out = []; for (const p of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } target = out.join('/'); }
          return { id: r.a.Id || '', type: r.a.Type || '', target, external };
        });
        const id = new Map();
        for (const r of list) if (!id.has(r.id)) id.set(r.id, r);
        return { list, id };
      })());
      return relCache.get(path);
    };
    const main = (await relsOf('')).list.find((r) => r.type.endsWith('/officeDocument') && !r.external)?.target || 'word/document.xml';
    const doc = await part(main), body = doc && all(doc, 'body')[0];
    if (!body) throw new Error('This file is not a Word document.');
    const rels = (await relsOf(main)).list;
    const target = (kind) => rels.find((r) => r.type.endsWith(`/${kind}`) && !r.external)?.target;
    const stylesX = await part(target('styles') || 'word/styles.xml');
    const styles = new Map(all(stylesX, 'style').map((s) => [at(s, 'styleId'), s]));
    const defaults = all(stylesX, 'docDefaults')[0];
    const chain = (id, seen2 = new Set()) => { if (!id || seen2.has(id) || seen2.size > 12) return []; seen2.add(id); const s = styles.get(id); return s ? [...chain(val(s, 'basedOn'), seen2), s] : []; };
    const normal = at([...styles.values()].find((s) => at(s, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(at(s, 'default'))), 'styleId');
    const styleName = (id) => String(val(styles.get(id), 'name') || id || '').toLowerCase();
    // A paragraph's or run's properties, outermost first, each with where it came from: the defaults, the paragraph style's
    // chain (Normal when the paragraph names none), the run's character style chain (none for a linked run's Hyperlink
    // style: the link draws itself), its own.
    const levels = (node, kind, pStyle = normal, linked = false) => {
      const own = kid(node, kind), out = [];
      const def = kid(kid(defaults, kind === 'pPr' ? 'pPrDefault' : 'rPrDefault'), kind);
      if (def) out.push({ p: def, from: 'default' });
      for (const s of chain(kind === 'pPr' ? val(own, 'pStyle') || normal : pStyle)) { const x = kid(s, kind); if (x) out.push({ p: x, from: 'paragraph' }); }
      if (kind === 'rPr' && !(linked && /^(followed)?hyperlink$/.test(styleName(val(own, 'rStyle'))))) for (const s of chain(val(own, 'rStyle'))) { const x = kid(s, 'rPr'); if (x) out.push({ p: x, from: 'run' }); }
      if (own) out.push({ p: own, from: 'own' });
      return out;
    };

    // Fonts: the theme's for asciiTheme, then each name as the paper font that sets it (itself, one with its metrics, else
    // the nearest of its family from fontTable.xml, which is a warning).
    const themeX = await part(target('theme') || 'word/theme/theme1.xml');
    const face = (k) => at(kid(all(themeX, k)[0], 'latin'), 'typeface');
    const theme = { major: face('majorFont'), minor: face('minorFont') };
    const fontX = await part(target('fontTable') || 'word/fontTable.xml');
    const families = new Map(all(fontX, 'font').map((n) => [at(n, 'name').toLowerCase(), val(n, 'family')]));
    const NEAR = { times: 'Times New Roman', tinos: 'Times New Roman', 'liberation serif': 'Times New Roman', arimo: 'Arial', 'liberation sans': 'Arial', helvetica: 'Arial', carlito: 'Calibri', cousine: 'Courier New', 'liberation mono': 'Courier New', courier: 'Courier New' };
    const FAMILY = { roman: 'Times New Roman', swiss: 'Arial', modern: 'Courier New' };
    const known = new Map();
    const paperFont = (name) => {
      if (!known.has(name)) {
        // Word's well-known fonts (Aptos and Office's others) keep their names: the page uses them where installed.
        const lower = String(name).toLowerCase(), hit = ST().KNOWN.find((x) => x.toLowerCase() === lower) || NEAR[lower];
        if (!hit) warn('Fonts Word and Blackboard don\'t share were replaced.');
        known.set(name, hit || FAMILY[families.get(lower)] || null);
      }
      return known.get(name);
    };
    // A run's properties, including a heading's inherited emphasis.
    const runProps = (lv) => {
      const r = { font: 'Times New Roman', size: 10, b: false, i: false, u: false, s: false, vert: '', color: '', highlight: '', hidden: false, caps: '', dir: null };
      for (const { p } of lv) {
        const rf = kid(p, 'rFonts');
        if (rf) { const th = at(rf, 'asciiTheme') || at(rf, 'hAnsiTheme'), name = th ? theme[/^major/.test(th) ? 'major' : 'minor'] : at(rf, 'ascii') || at(rf, 'hAnsi'); if (name) r.font = name; }
        if (val(p, 'sz') !== '') r.size = fin(val(p, 'sz'), 20, 2, 3276) / 2;
        for (const k of ['b', 'i']) { const n = kid(p, k); if (n) r[k] = on(n); }
        const u = kid(p, 'u'); if (u) r.u = !['none', '0', 'false'].includes(at(u, 'val'));
        for (const k of ['strike', 'dstrike']) { const n = kid(p, k); if (n) r.s = on(n); }
        const v = val(p, 'vertAlign'); if (v) r.vert = ['superscript', 'subscript'].includes(v) ? v : '';
        const c = kid(p, 'color'); if (c) r.color = /^[0-9a-f]{6}$/i.test(at(c, 'val')) && !/^0{6}$/.test(at(c, 'val')) ? at(c, 'val').toUpperCase() : '';
        const hl = kid(p, 'highlight'); if (hl) r.highlight = S().HIGHLIGHT[at(hl, 'val')] ? at(hl, 'val') : '';
        const rtl = kid(p, 'rtl'); if (rtl) r.dir = on(rtl) ? 'rtl' : 'ltr';
        const hid = kid(p, 'vanish'); if (hid) r.hidden = on(hid);
        for (const [k, v] of [['caps', 'all'], ['smallCaps', 'small']]) { const n = kid(p, k); if (n) r.caps = on(n) ? v : r.caps === v ? '' : r.caps; }
      }
      r.font = paperFont(r.font);
      return r;
    };
    // A paragraph's properties in twips: spacing (Word's auto spacing is 14 pt), the line and its rule, indents (a later
    // first-line indent replaces an earlier hanging one), alignment, tab stops (a later clear removes one), keep options,
    // widow control (on unless turned off), contextual spacing and page break before.
    const KIND = { left: 'l', start: 'l', num: 'l', center: 'c', right: 'r', end: 'r', decimal: 'd' };
    const paraProps = (lv) => {
      const r = { before: 0, after: 0, line: 240, rule: 'auto', left: 0, right: 0, first: 0, jc: '', tabs: new Map(), keepNext: false, keepLines: false, widow: true, contextual: false, breakBefore: false, dir: null };
      for (const { p } of lv) {
        const sp = kid(p, 'spacing');
        if (sp) {
          for (const k of ['before', 'after']) { if (['1', 'true', 'on'].includes(at(sp, `${k}Autospacing`))) r[k] = 280; else if (at(sp, k) !== '') r[k] = fin(at(sp, k), 0, 0, 31680); }
          if (at(sp, 'line') !== '') { r.line = fin(at(sp, 'line'), 240, 1, 31680); r.rule = ['exact', 'atLeast'].includes(at(sp, 'lineRule')) ? at(sp, 'lineRule') : 'auto'; }
        }
        const ind = kid(p, 'ind');
        if (ind) {
          const left = at(ind, 'left') || at(ind, 'start'), right = at(ind, 'right') || at(ind, 'end');
          if (left !== '') r.left = fin(left, 0, -31680, 31680);
          if (right !== '') r.right = fin(right, 0, -31680, 31680);
          if (at(ind, 'hanging') !== '') r.first = -fin(at(ind, 'hanging'), 0, 0, 31680); else if (at(ind, 'firstLine') !== '') r.first = fin(at(ind, 'firstLine'), 0, 0, 31680);
        }
        const bidi = kid(p, 'bidi'); if (bidi) r.dir = on(bidi) ? 'rtl' : 'ltr';
        const j = val(p, 'jc'); if (j) r.jc = { both: 'justify', distribute: 'justify', center: 'center', right: 'right', end: 'right', left: 'left', start: 'left' }[j] || 'left';
        for (const t of els(kid(p, 'tabs')).filter((x) => x.local === 'tab')) {
          const pos = fin(at(t, 'pos'), 0, 0, 31680), v = at(t, 'val');
          if (v === 'clear') r.tabs.delete(pos); else if (KIND[v]) r.tabs.set(pos, [KIND[v], at(t, 'leader')]);
        }
        for (const [k, key] of [['keepNext', 'keepNext'], ['keepLines', 'keepLines'], ['widowControl', 'widow'], ['contextualSpacing', 'contextual'], ['pageBreakBefore', 'breakBefore']]) { const n = kid(p, k); if (n) r[key] = on(n); }
      }
      return r;
    };
    const r2 = (n) => Math.round(n * 100) / 100;
    const tabsOf = (r) => ST().tabsOf([...r.tabs].sort((a, b) => a[0] - b[0]).map(([pos, [kind, leader]]) => [r2(pos / 1440), kind, leader]));

    // The base: the font and size most of the body's text is in (an empty paragraph counts its mark once).
    const tally = new Map();
    for (const p of all(body, 'p')) {
      const ps = val(kid(p, 'pPr'), 'pStyle') || normal;
      let any = false;
      for (const r of all(p, 'r')) {
        const n = all(r, 't').reduce((k, t) => k + t.kids.reduce((m, x) => m + (x.text || '').length, 0), 0) + all(r, 'tab').length;
        if (!n) continue;
        any = true;
        const rp = runProps(levels(r, 'rPr', ps));
        if (!rp.hidden) { const key = `${rp.font || ''}|${rp.size}`; tally.set(key, (tally.get(key) || 0) + n); }
      }
      if (!any) { const rp = runProps(levels(kid(p, 'pPr') || { kids: [] }, 'rPr', ps)); const key = `${rp.font || ''}|${rp.size}`; tally.set(key, (tally.get(key) || 0) + 1); }
    }
    const top = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] || `${runProps(levels({ kids: [] }, 'rPr')).font || ''}|${runProps(levels({ kids: [] }, 'rPr')).size}`;
    const base = { font: top.split('|')[0] || null, size: +top.split('|')[1] };

    // Lists
    const numX = await part(target('numbering') || 'word/numbering.xml');
    const nums = new Map(all(numX, 'num').map((n) => [at(n, 'numId'), n]));
    const abstracts = new Map(all(numX, 'abstractNum').map((n) => [at(n, 'abstractNumId'), n]));
    const listOf = (pp) => {
      const numPr = pp.map((x) => kid(x, 'numPr')).filter(Boolean).at(-1), id = val(numPr, 'numId');
      if (!id || id === '0') return null;
      const level = fin(val(numPr, 'ilvl'), 0, 0, 8), abs = abstracts.get(val(nums.get(id), 'abstractNumId'));
      const lvl = abs && els(abs).find((l) => l.local === 'lvl' && fin(at(l, 'ilvl')) === level);
      return { id, definition: val(nums.get(id), 'abstractNumId'), level, ordered: val(lvl, 'numFmt') !== 'bullet' };
    };

    // Footnotes, as inline HTML for the paper schema's footnote_ref.
    const notesPath = target('footnotes') || 'word/footnotes.xml', notesX = await part(notesPath);
    const noteById = new Map(all(notesX, 'footnote').filter((n) => !at(n, 'type') || at(n, 'type') === 'normal').map((n) => [at(n, 'id'), n]));

    let imageTotal = 0, noteBytes = 0;
    const image = async (node, source) => {
      const blip = all(node, 'blip')[0], rid = blip && (blip.a['r:embed'] || at(blip, 'embed'));
      const hit = (await relsOf(source)).id.get(rid), r = hit && !hit.external ? hit : null;
      const ext = r?.target.split('.').at(-1)?.toLowerCase(), mime = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif' }[ext || ''];
      if (!r || !mime) { warn('Some pictures were left out.'); return ''; }
      const b = entry(r.target) && await z.bytes(entry(r.target));
      if (!b) { warn('Some pictures were left out.'); return ''; }
      imageTotal += b.length;
      if (imageTotal > LIMIT.images) throw new RangeError('The pictures in this file are larger than 10 MB.');
      const ext2 = all(node, 'extent')[0], w = Math.round(fin(ext2?.a.cx, 3048000, 9525, 15240000) / 9525);
      return `<img src="data:image/${mime};base64,${base64(b)}" alt="${escH(at(all(node, 'docPr')[0], 'descr'))}" width="${w}">`;
    };
    // A run's formatting as the paper schema's marks: its font and size where they differ from the base (in a footnote,
    // from its paragraph style's: the format sets notes' size).
    const runHTML = (r, inner, from = base) => {
      if (!inner) return inner;
      let h = inner;
      const font = r.font && r.font !== from.font ? r.font : null, size = r.size !== from.size ? r.size : null;
      if (font || size) h = `<span style="${[font ? `font-family:${font}` : '', size ? `font-size:${size}pt` : ''].filter(Boolean).join(';')}">${h}</span>`;
      if (r.dir) h = `<span dir="${r.dir}">${h}</span>`;
      if (r.caps) h = `<span data-gz-caps="${r.caps}">${h}</span>`;
      if (r.highlight) h = `<span data-gz-highlight="${r.highlight}">${h}</span>`;
      if (r.color) h = `<span data-gz-color="${r.color}">${h}</span>`;
      if (r.vert === 'superscript') h = `<sup>${h}</sup>`; else if (r.vert === 'subscript') h = `<sub>${h}</sub>`;
      if (r.u) h = `<u>${h}</u>`;
      if (r.s) h = `<s>${h}</s>`;
      if (r.i) h = `<em>${h}</em>`;
      if (r.b) h = `<strong>${h}</strong>`;
      return h;
    };
    const BREAK = '\u0000BREAK\u0000';
    // A paragraph's inline content as HTML; a page break inside it is BREAK. Fields and links set ctx as the runs come, in
    // order (each run reads it before its first await): ctx.link inside a w:hyperlink, ctx.href in a HYPERLINK field's result.
    const inline = async (node, ctx, depth = 0) => {
      if (depth > LIMIT.depth) throw new RangeError('document nesting too deep');
      const name = node.local;
      if (name === 'instrText') { ctx.field += node.kids.map((k) => k.text || '').join(''); return ''; }
      if (name === 'fldChar') {
        const type = at(node, 'fldCharType');
        if (type === 'begin') { ctx.field = ''; ctx.skip = false; }
        if (type === 'separate' && /^\s*(PAGE|NUMPAGES)\b/i.test(ctx.field)) ctx.skip = true;
        if (type === 'separate') { const m = /^\s*HYPERLINK\s+(?:"([^"]+)"|([^\s"\\]\S*))/i.exec(ctx.field); if (m) ctx.href = S().href(m[1] || m[2]); }
        if (type === 'end') { ctx.field = ''; ctx.skip = false; ctx.href = null; }
        return '';
      }
      if (name === 't') return ctx.skip ? '' : escH(node.kids.map((k) => k.text || '').join(''));
      if (name === 'ins' || name === 'moveTo') warn('Tracked changes were accepted.');
      if (name === 'delText' || name === 'del' || name === 'moveFrom') { warn('Tracked changes were accepted.'); return ''; }
      if (name === 'tab' || name === 'ptab') return ctx.skip ? '' : '\t';
      if (name === 'br' || name === 'cr') return at(node, 'type') === 'page' ? BREAK : at(node, 'type') === 'column' ? '' : '<br>';
      if (name === 'noBreakHyphen') return '-';
      if (name === 'softHyphen') return '­';
      if (name === 'drawing') return image(node, ctx.source);
      if (name === 'footnoteReference') {
        if (ctx.note) throw new Error('nested footnote references are not supported');
        const n = noteById.get(at(node, 'id'));
        if (!n) return '';
        const parts2 = [];
        for (const p of all(n, 'p')) parts2.push((await Promise.all(els(p).filter((k) => k.local !== 'pPr').map((k) => inline(k, { ...ctx, source: notesPath, field: '', skip: false, href: null, link: 0, note: true, paragraph: val(kid(p, 'pPr'), 'pStyle') || normal, heading: false }, depth + 1)))).join('').replace(/\u0000BREAK\u0000/g, ''));
        const html = parts2.join(' ').trim();
        noteBytes += html.length;
        if (noteBytes > LIMIT.html) throw new RangeError('The document is too large.');
        return `<sup class="gz-footnote" data-footnote="${escH(html)}"></sup>`;
      }
      if (name === 'footnoteRef') return '';
      if (name === 'pict' || name === 'object' || name === 'oMath' || name === 'oMathPara') { warn('Some pictures, objects or equations were left out.'); return ''; }
      if (['rPr', 'pPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'lastRenderedPageBreak', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'endnoteReference', 'sdtPr', 'sdtEndPr'].includes(name)) {
        if (name === 'commentReference') warn('Comments were left out.');
        if (name === 'endnoteReference') warn('Endnotes were left out.');
        return '';
      }
      const href = ctx.link ? null : ctx.href, linked = !!(ctx.link || href);
      if (name === 'hyperlink') ctx.link = (ctx.link || 0) + 1;
      const kids = Promise.all(els(node).map((k) => inline(k, ctx, depth + 1)));
      if (name === 'hyperlink') ctx.link--;
      let html = (await kids).join('');
      if (name === 'r') {
        if (ctx.note && kid(kid(node, 'rPr'), 'rStyle') && /footnote ?reference/.test(styleName(val(kid(node, 'rPr'), 'rStyle')))) return html;
        if (all(node, 'footnoteReference').length) return html;
        const rp = runProps(levels(node, 'rPr', ctx.paragraph, linked));
        if (rp.hidden) return '';
        html = runHTML(rp, html, ctx.note ? runProps(levels({ kids: [] }, 'rPr', ctx.paragraph)) : base);
        if (href && html) html = `<a href="${escH(href)}">${html}</a>`;
      }
      if (name === 'hyperlink') {
        const id = node.a['r:id'] || at(node, 'id'), r = (await relsOf(ctx.source)).id.get(id), h = r?.external ? S().href(r.target) : null;
        if (h) html = `<a href="${escH(h)}">${html}</a>`;
      }
      return html;
    };
    // A paragraph as Word resolves it: { r (paraProps), style, heading (level), quote, list, html, text }. Contextual
    // spacing drops its space before or after next to a paragraph of its own style (ctx.prev, ctx.next).
    const paragraph = async (p, ctx) => {
      const style = val(kid(p, 'pPr'), 'pStyle') || normal, name = styleName(style), m = /heading\s*([1-6])/.exec(name);
      Object.assign(ctx, { field: '', skip: false, href: null, link: 0, paragraph: style, heading: !!m });
      const lv = levels(p, 'pPr'), r = paraProps(lv);
      if (r.contextual) { if (ctx.prev === style) r.before = 0; if (ctx.next === style) r.after = 0; }
      const html = (await Promise.all(els(p).filter((k) => k.local !== 'pPr').map((k) => inline(k, ctx)))).join('');
      return { kind: 'p', r, style, heading: m ? +m[1] : 0, quote: /quote|block text/.test(name), list: listOf(lv.map((x) => x.p)), html, text: TEXT().decode(html.replace(/<[^>]*>/g, '')) };
    };
    // A paragraph's attributes as the paper schema reads them: what Word gives it, less what the format gives a paragraph
    // there (a list entry, a quoted paragraph, a heading, body). → [style, data-gz].
    const attrsOf = (d, where = {}) => {
      const { r } = d, css = [], gz = {};
      const set = where.entry ? f.list : d.quote ? f.quote : f;
      // Imported headings carry their actual emphasis on their runs, with no format emphasis underneath.
      if (d.heading) css.push('font-weight:normal', 'font-style:normal');
      if ((r.jc || 'left') !== (d.heading ? f.headings[d.heading - 1]?.align || 'left' : 'left')) css.push(`text-align:${r.jc || 'left'}`);
      if (r.rule === 'exact') gz.exact = r2(r.line / 20);
      else if (r.rule === 'atLeast') gz.least = r2(r.line / 20);
      else { const line = r2(Math.min(4, Math.max(0.5, r.line / 240))); if (line !== set.line) css.push(`line-height:${line}`); }
      if (r.dir) gz.dir = r.dir;
      if (r.before) gz.before = r2(r.before / 20);
      if (r2(r.after / 20) !== set.after) gz.after = r2(r.after / 20);
      if (!d.list) {
        const left = r.left / 1440 - (d.quote ? f.quote.indent : 0), first = r.first / 1440;
        if (where.entry) { if (Math.abs(left - f.list.hanging) > 0.005) gz.left = r2(left); }
        else if (Math.abs(left) > 0.005) { if (left > 0 && left <= 4 && Math.abs(left / 0.5 - Math.round(left / 0.5)) < 0.002) css.push(`margin-left:${Math.round(left / 0.5) * 0.5}in`); else gz.left = r2(left); }
        const def = d.heading ? f.headings[d.heading - 1]?.first || 0 : d.quote ? 0 : where.entry ? -f.list.hanging : ST().firstOf(f, { align: r.jc });
        if (Math.abs(first - def) > 0.005) css.push(`text-indent:${r2(first)}in`);
      }
      if (Math.abs(r.right / 1440) > 0.005) gz.right = r2(r.right / 1440);
      if (r.tabs.size) gz.tabs = tabsOf(r);
      if (r.keepNext) gz.keepNext = true;
      if (r.keepLines) gz.keepLines = true;
      if (!r.widow) gz.widow = false;
      return [css.join(';'), S().dataGz(gz)];
    };
    const open = (tag, [style, gz]) => `<${tag}${style ? ` style="${style}"` : ''}${gz ? ` data-gz="${escH(gz)}"` : ''}>`;
    const HR = '<hr class="gz-page-break">';
    // One paragraph's HTML. A page break inside it splits it: the part after continues the paragraph (no first-line indent
    // of its own), and an empty part beside a break is no line at all, as Word draws a paragraph that only holds one.
    const paraHTML = (d, where, tag) => {
      const pieces = d.html.split(BREAK), a = attrsOf(d, where), rest = pieces.length > 1 ? attrsOf({ ...d, r: { ...d.r, first: 0, before: 0 } }, where) : a;
      return pieces.map((x, i) => (pieces.length > 1 && !x ? '' : `${open(tag, i ? rest : a)}${x}</${tag}>`)).join(HR);
    };
    const tableHTML = async (node, ctx, depth) => {
      const grid = [], merges = new Map();
      for (const row of els(node).filter((k) => k.local === 'tr')) {
        const cells = [];
        let col = 0;
        for (const cell of els(row).filter((k) => k.local === 'tc')) {
          const pr = kid(cell, 'tcPr'), span = fin(val(pr, 'gridSpan'), 1, 1, 100), merge = kid(pr, 'vMerge');
          if (col + span > 1000) throw new RangeError('A table is too wide.');
          if (merge && at(merge, 'val') !== 'restart' && merges.has(col)) { merges.get(col).rows++; col += span; continue; }
          const c = { rows: 1, span, html: render(await collect(els(cell).filter((k) => k.local !== 'tcPr'), ctx, depth + 1)) || '<p></p>' };
          if (merge && at(merge, 'val') === 'restart') merges.set(col, c); else merges.delete(col);
          cells.push(c);
          col += span;
        }
        grid.push(cells);
      }
      return `<table>${grid.map((cells) => `<tr>${cells.map((c) => `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rows > 1 ? ` rowspan="${Math.min(1000, c.rows)}"` : ''}>${c.html}</td>`).join('')}</tr>`).join('')}</table>`;
    };
    // A section's w:type says how it starts: after a paragraph that ends a section, a new page unless the next section is
    // continuous (or a new column).
    const sects = [...all(body, 'p').map((x) => kid(kid(x, 'pPr'), 'sectPr')).filter(Boolean), els(body).filter((k) => k.local === 'sectPr').at(-1)];
    const newPage = new Map(sects.slice(0, -1).map((x, i) => [x, !['continuous', 'nextColumn'].includes(val(sects[i + 1], 'type'))]));
    // The blocks of a body, cell or content control, in order: paragraphs resolved, tables as HTML, page breaks before
    // (one at a new section's top is that page) and after a section's end.
    let size = 0;
    const collect = async (nodes, ctx, depth = 0) => {
      if (depth > 40) throw new RangeError('document nesting too deep');
      const out = [], styleOf = (n) => (n?.local === 'p' ? val(kid(n, 'pPr'), 'pStyle') || normal : null);
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.local === 'p') {
          const d = await paragraph(node, Object.assign(ctx, { prev: styleOf(nodes[i - 1]), next: styleOf(nodes[i + 1]) }));
          if (d.r.breakBefore && !out.at(-1)?.section) out.push({ kind: 'break' });
          const border = kid(kid(kid(node, 'pPr'), 'pBdr'), 'bottom');
          if (!d.html && border && !['nil', 'none', '0'].includes(at(border, 'val'))) d.kind = 'rule';
          out.push(d);
          if (newPage.get(kid(kid(node, 'pPr'), 'sectPr'))) out.push({ kind: 'break', section: true });
          size += d.html.length;
        } else if (node.local === 'tbl') { const html = await tableHTML(node, ctx, depth); size += html.length; out.push({ kind: 'html', html }); }
        else if (node.local === 'customXml') out.push(...await collect(els(node), ctx, depth + 1));
        else if (node.local === 'sdt') { const c = kid(node, 'sdtContent'); if (c) out.push(...await collect(els(c), ctx, depth + 1)); }
        else if (node.local === 'ins' || node.local === 'moveTo') { warn('Tracked changes were accepted.'); out.push(...await collect(els(node), ctx, depth + 1)); }
        else if (node.local === 'del' || node.local === 'moveFrom') warn('Tracked changes were accepted.');
        if (size > LIMIT.html) throw new RangeError('The document is too large.');
      }
      return out;
    };
    // Blocks to HTML: lists and quoted paragraphs grouped, and at the top the list of sources found as writer-styles
    // listAt finds it (its entries take the format's hanging indent and spacing, so theirs are compared with those).
    const TITLES = new Set(Object.values(ST().FORMATS).map((x) => x.list.title.toLowerCase()));
    const render = (items, top = false) => {
      const plain = (d) => d?.kind === 'p' && !d.list && !d.quote && !d.heading;
      let from = -1, to = -1;
      if (top) {
        for (let i = items.length - 1; i >= 0 && from < 0; i--) if (plain(items[i]) && items[i].r.jc === 'center' && TITLES.has(items[i].text.trim().toLowerCase()) && !items[i].html.includes(BREAK)) from = i + 1;
        to = from;
        while (from >= 0 && plain(items[to]) && !items[to].html.includes(BREAK)) to++;
      }
      let out = '', list = null, quote = false;
      const close = () => { if (list) { out += list.ordered ? '</ol>' : '</ul>'; list = null; } };
      const unquote = () => { if (quote) { out += '</blockquote>'; quote = false; } };
      items.forEach((d, i) => {
        if (d.kind === 'break') { close(); unquote(); out += HR; return; }
        if (d.kind === 'html') { close(); unquote(); out += d.html; return; }
        if (d.kind === 'rule') {
          close();
          if (d.quote && !quote) { out += '<blockquote>'; quote = true; } else if (!d.quote) unquote();
          out += '<hr class="gz-rule">'; return;
        }
        const tag = d.heading ? `h${d.heading}` : 'p';
        if (d.list) {
          unquote();
          if (!list || list.ordered !== d.list.ordered || list.definition !== d.list.definition) { close(); list = { ordered: d.list.ordered, definition: d.list.definition }; out += d.list.ordered ? '<ol>' : '<ul>'; }
          const [style, gz] = attrsOf(d);
          // data-w-num: the item's w:numId, for lib/writer-objects-docx.js (the schema drops it).
          out += `<li${d.list.level ? ` class="ql-indent-${d.list.level}"` : ''}${style ? ` style="${style}"` : ''}${gz ? ` data-gz="${escH(gz)}"` : ''} data-w-num="${escH(d.list.id)}">${d.html.split(BREAK).join('<br>')}</li>`;
          return;
        }
        close();
        if (d.quote && !quote) { out += '<blockquote>'; quote = true; } else if (!d.quote) unquote();
        out += paraHTML(d, { entry: i >= from && i < to }, tag);
      });
      close(); unquote();
      return out;
    };
    const ctx = { source: main, field: '', skip: false, paragraph: normal, heading: false };
    let html = render(await collect(els(body), ctx), true);
    if (html.length > LIMIT.html) throw new RangeError('The document is too large.');
    if (z.names.some((n) => /^word\/(charts|embeddings)\/|vbaProject/i.test(n))) warn('Some pictures, objects or equations were left out.');

    // The page: the last section's size and margins (Word's defaults where it gives none), its header and footer.
    const sect = els(body).filter((k) => k.local === 'sectPr').at(-1) || all(body, 'sectPr').at(-1);
    const pg = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    const inch = (v, d) => Math.abs(fin(v, d, -31680, 31680)) / 1440;
    // A header's or footer's paragraphs: their alignment, spacing and stops, and their text runs and PAGE / NUMPAGES fields
    // with the marks that differ from the base.
    const hf = async (kind, type) => {
      const ref = els(sect).find((k) => k.local === `${kind}Reference` && (at(k, 'type') || 'default') === type);
      const r = ref && rels.find((x) => x.id === (ref.a['r:id'] || at(ref, 'id')) && !x.external);
      const x = r && await part(r.target);
      if (!x) return null;
      const paras = [];
      const walk = (n) => { for (const k of els(n)) { if (k.local === 'p') paras.push(k); else if (k.local === 'sdt') walk(kid(k, 'sdtContent')); } };
      walk(els(x)[0]);
      return paras.slice(0, 20).map((p) => {
        const style = val(kid(p, 'pPr'), 'pStyle') || normal, pr = paraProps(levels(p, 'pPr'));
        const out = { align: pr.jc || null, line: pr.rule === 'auto' ? r2(pr.line / 240) : 1, after: r2(pr.after / 20) };
        if (pr.rule !== 'auto') out[pr.rule === 'exact' ? 'exact' : 'least'] = r2(pr.line / 20);
        if (pr.before) out.before = r2(pr.before / 20);
        for (const k of ['left', 'right', 'first']) if (pr[k]) out[k] = r2(pr[k] / 1440);
        if (pr.tabs.size) out.tabs = tabsOf(pr);
        const runs = [];
        let field = '', skip = false;
        const push = (run) => {
          const last = runs.at(-1), same = (a, b) => ['b', 'i', 'u', 's', 'sup', 'sub', 'font', 'size', 'color'].every((k) => a[k] === b[k]);
          if (run.text && last?.text && !last.field && same(last, run)) last.text += run.text; else runs.push(run);
        };
        const visit = (n) => {
          for (const k of els(n)) {
            if (k.local === 'r') {
              const rp = runProps(levels(k, 'rPr', style));
              if (rp.hidden) continue;
              const marks = { ...(rp.b ? { b: true } : {}), ...(rp.i ? { i: true } : {}), ...(rp.u ? { u: true } : {}), ...(rp.s ? { s: true } : {}), ...(rp.vert === 'superscript' ? { sup: true } : rp.vert === 'subscript' ? { sub: true } : {}),
                ...(rp.font && rp.font !== base.font ? { font: rp.font } : {}), ...(rp.size !== base.size ? { size: rp.size } : {}), ...(rp.color ? { color: rp.color } : {}) };
              for (const c of els(k)) {
                if (c.local === 'fldChar') { const t = at(c, 'fldCharType'); if (t === 'begin') field = ''; else if (t === 'separate') { const m = /^\s*(PAGE|NUMPAGES)\b/i.exec(field); if (m) { push({ field: m[1].toUpperCase(), ...marks }); skip = true; } } else if (t === 'end') { skip = false; field = ''; } }
                else if (c.local === 'instrText') field += c.kids.map((t) => t.text || '').join('');
                else if (!skip && c.local === 't') push({ text: c.kids.map((t) => t.text || '').join(''), ...marks });
                else if (!skip && (c.local === 'tab' || c.local === 'ptab')) push({ text: '\t', ...marks });
                else if (!skip && (c.local === 'br' || c.local === 'cr')) push({ text: '\n', ...marks });
              }
            } else if (k.local === 'fldSimple') { const m = /^\s*(PAGE|NUMPAGES)\b/i.exec(at(k, 'instr')); if (m) push({ field: m[1].toUpperCase() }); else visit(k); }
            else if (['hyperlink', 'sdt', 'sdtContent', 'smartTag', 'ins', 'customXml'].includes(k.local)) visit(k);
          }
        };
        visit(p);
        out.runs = runs.filter((x) => x.field || x.text);
        return out;
      });
    };
    const settingsX = await part(target('settings') || 'word/settings.xml');
    const setup = ST().setup({
      page: [inch(at(pg, 'w'), 12240), inch(at(pg, 'h'), 15840)], margins: [['top', 1440], ['right', 1800], ['bottom', 1440], ['left', 1800]].map(([k, d]) => inch(at(mar, k), d)),
      header: inch(at(mar, 'header'), 720), footer: inch(at(mar, 'footer'), 720), font: base.font, size: base.size,
      tab: inch(val(all(settingsX, 'settings')[0], 'defaultTabStop'), 720), kern: !!kid(kid(kid(defaults, 'rPrDefault'), 'rPr'), 'kern'), title: on(kid(sect, 'titlePg')),
      headers: { default: await hf('header', 'default'), first: await hf('header', 'first') }, footers: { default: await hf('footer', 'default'), first: await hf('footer', 'first') },
    });
    if (globalThis.GZ_WRITER_OBJECTS_DOCX) html = GZ_WRITER_OBJECTS_DOCX.importHTML(html, { body: doc, numbering: numX, styles: stylesX });
    return { doc: { ...S().parse(S().paper, html, { pre: true, document: true }).toJSON(), attrs: { setup } }, html, setup, warnings: [...warnings] };
  };

  return { exportDocx, importDocx, xml, esc, MIME, LIMIT };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_DOCX; else GZ_WRITER_DOCX;
