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
  const esc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };
  const LIMIT = { file: 15e6, entries: 2000, entry: 10e6, total: 35e6, part: 5e6, elements: 100000, depth: 80, images: 10e6, html: 16 * 1024 * 1024 };
  const b64 = (s) => (typeof atob === 'function' ? Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) : new Uint8Array(Buffer.from(s, 'base64')));
  const base64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); };

  // ================================================================================================================
  // Export
  // ================================================================================================================
  // doc: a paper-schema Node (or its JSON); o: { format, surname (MLA's header name), title, date (Date: the archive's
  // and properties' time, so tests can pin it) }. → { bytes: Uint8Array, parts: { path: xml }, type }.
  const exportDocx = (doc, o = {}) => {
    const schema = S().paper;
    if (typeof doc?.forEach !== 'function') doc = schema.nodeFromJSON(doc);
    const f = ST().get(o.format), date = o.date instanceof Date ? o.date : new Date();
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
    let images = 0, imageBytes = 0, pendingBreak = false;

    // ---- runs
    const runProps = (m, extra = '') => {
      let s = extra;
      const style = m.text_style, mk = (k) => m[k];
      if (style?.font) s += `<w:rFonts w:ascii="${esc(style.font)}" w:hAnsi="${esc(style.font)}" w:eastAsia="${esc(style.font)}" w:cs="${esc(style.font)}"/>`;
      if (mk('bold')) s += '<w:b/><w:bCs/>';
      if (mk('italic')) s += '<w:i/><w:iCs/>';
      if (mk('strike')) s += '<w:strike/>';
      if (style?.size) s += `<w:sz w:val="${Math.round(style.size * 2)}"/><w:szCs w:val="${Math.round(style.size * 2)}"/>`;
      if (mk('highlight')) s += '<w:highlight w:val="yellow"/>';
      if (mk('underline')) s += '<w:u w:val="single"/>';
      if (mk('sup')) s += '<w:vertAlign w:val="superscript"/>';
      else if (mk('sub')) s += '<w:vertAlign w:val="subscript"/>';
      return s ? `<w:rPr>${s}</w:rPr>` : '';
    };
    const marksOf = (node) => Object.fromEntries(node.marks.map((m) => [m.type.name, m.attrs && Object.keys(m.attrs).length ? m.attrs : true]));
    const textRun = (text, m, rStyle = '') => `<w:r>${runProps(m, rStyle ? `<w:rStyle w:val="${rStyle}"/>` : '')}${String(text).split(/(\t|\n)/).filter((x) => x !== '').map((x) => (x === '\t' ? '<w:tab/>' : x === '\n' ? '<w:br/>' : `<w:t xml:space="preserve">${esc(x)}</w:t>`)).join('')}</w:r>`;
    const image = (node) => {
      const m = /^data:image\/(png|jpeg|gif);base64,([a-z\d+/=]+)$/i.exec(node.attrs.src || '');
      if (!m) return textRun(node.attrs.alt ? `[${node.attrs.alt}]` : '', {});
      const bytes = b64(m[2]);
      imageBytes += bytes.length;
      if (imageBytes > LIMIT.images) throw new RangeError('images too large');
      const ext = m[1].toLowerCase(), n = ++images, name = `media/image${n}.${ext === 'jpeg' ? 'jpeg' : ext}`;
      media.push({ path: `word/${name}`, bytes });
      const id = rel(`${R}/image`, name);
      let size = null;
      try { size = TEXT().imageSize?.(bytes) || null; } catch { size = null; }
      const wpx = Math.min(node.attrs.width || size?.width || 320, ST().geometry(f).content);
      const hpx = size?.width && size?.height ? Math.round((wpx * size.height) / size.width) : Math.round(wpx * 0.625);
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
        const m = marksOf(c), href = m.link?.href || null;
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
    // pPr in the schema's order: style, keep, page break, numbering, spacing, indent, alignment.
    const pPr = (node, o2 = {}) => {
      const a = node.attrs || {};
      let s = o2.style ? `<w:pStyle w:val="${o2.style}"/>` : '';
      if (pendingBreak) { s += '<w:pageBreakBefore/>'; pendingBreak = false; }
      if (o2.num) s += `<w:numPr><w:ilvl w:val="${o2.num.level}"/><w:numId w:val="${o2.num.id}"/></w:numPr>`;
      if (a.line != null) s += `<w:spacing w:line="${Math.round(a.line * 240)}" w:lineRule="auto"/>`;
      if (!o2.num) {
        const base = o2.quote ? f.quote.indent : 0, left = base + (a.indent || 0) * 0.5;
        const first = a.first != null ? a.first : (a.align === 'center' || a.align === 'right') && !o2.quote && !o2.heading ? 0 : null;
        const attrs = [left !== base ? ` w:left="${tw(left)}"` : '', first != null ? (first < 0 ? ` w:hanging="${tw(-first)}"` : ` w:firstLine="${tw(first)}"`) : '', o2.cell && first == null ? ' w:firstLine="0"' : ''].join('');
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
    const blocks = (parent, o2 = {}, depth = 0) => {
      if (depth > 40) throw new RangeError('document nesting too deep');
      let out = '';
      parent.forEach((node, _, index) => {
        const name = node.type.name, entry = parent === doc && list0 && index >= list0.from && index < list0.to;
        if (name === 'paragraph') out += para(node, { ...o2, style: o2.quote ? 'BlockQuote' : entry ? 'Bibliography' : '' });
        else if (name === 'heading') out += para(node, { ...o2, heading: true, style: `Heading${Math.min(4, Math.max(1, node.attrs.level))}` });
        else if (name === 'bullet_list' || name === 'ordered_list') out += list(node, o2);
        else if (name === 'blockquote') out += blocks(node, { ...o2, quote: true }, depth + 1);
        else if (name === 'code_block') {
          for (const line of (node.textContent || '').split('\n')) out += `<w:p>${pPr({ attrs: { first: 0 } }, o2)}${line ? textRun(line, { text_style: { font: 'Courier New' } }) : ''}</w:p>`;
        } else if (name === 'page_break') pendingBreak = true;
        else if (name === 'table') out += table(node, o2);
      });
      return out;
    };

    const list0 = ST().listAt(doc);
    let body = blocks(doc);
    if (pendingBreak) body += `<w:p>${pPr({ attrs: {} })}</w:p>`;
    if (!body) body = '<w:p/>';

    // ---- the package
    const header = {}, title = String(o.title || '').slice(0, 500);
    if (f.header.text !== 'none') {
      const name = f.header.text === 'name-page' && o.surname ? `${String(o.surname).slice(0, 100)} ` : '';
      const field = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
      part('word/header1.xml', 'header', `<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr>${name ? `<w:r><w:t xml:space="preserve">${esc(name)}</w:t></w:r>` : ''}${field}</w:p></w:hdr>`);
      header.header = rel(`${R}/header`, 'header1.xml');
      if (!f.header.first) {
        part('word/header2.xml', 'header', `<w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:jc w:val="right"/></w:pPr></w:p></w:hdr>`);
        header.first = rel(`${R}/header`, 'header2.xml');
      }
    }
    part('word/document.xml', 'document.main', `<w:document ${NS}><w:body>${body}${ST().sectPr(f, header)}</w:body></w:document>`);
    part('word/styles.xml', 'styles', ST().stylesXML(f));
    rel(`${R}/styles`, 'styles.xml');
    part('word/settings.xml', 'settings', ST().settingsXML(notes.length > 0));
    rel(`${R}/settings`, 'settings.xml');
    part('word/fontTable.xml', 'fontTable', ST().fontTableXML());
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

  // bytes: the .docx; o: { format } (a paragraph's spacing and indent equal to the format's own are left to it).
  // → { html, warnings: [key] } for the paper schema's parse.
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
    const cache = new Map();
    const part = async (path) => {
      if (!cache.has(path)) cache.set(path, z.names.includes(path) ? z.text(path).then((t) => (t == null ? null : xml(t))) : Promise.resolve(null));
      return cache.get(path);
    };
    const relsOf = async (path) => {
      const slash = path.lastIndexOf('/'), dir = path.slice(0, slash + 1), x = await part(`${dir}_rels/${path.slice(slash + 1)}.rels`);
      return all(x, 'Relationship').map((r) => {
        const external = r.a.TargetMode === 'External';
        let target = r.a.Target || '';
        if (!external) { const out = []; for (const p of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) { if (p === '..') out.pop(); else if (p && p !== '.') out.push(p); } target = out.join('/'); }
        return { id: r.a.Id || '', type: r.a.Type || '', target, external };
      });
    };
    const main = (await relsOf('')).find((r) => r.type.endsWith('/officeDocument') && !r.external)?.target || 'word/document.xml';
    const doc = await part(main), body = doc && all(doc, 'body')[0];
    if (!body) throw new Error('This file is not a Word document.');
    const rels = await relsOf(main);
    const target = (kind) => rels.find((r) => r.type.endsWith(`/${kind}`) && !r.external)?.target;
    const stylesX = await part(target('styles') || 'word/styles.xml');
    const styles = new Map(all(stylesX, 'style').map((s) => [at(s, 'styleId'), s]));
    const defaults = all(stylesX, 'docDefaults')[0];
    const chain = (id, seen2 = new Set()) => { if (!id || seen2.has(id) || seen2.size > 12) return []; seen2.add(id); const s = styles.get(id); return s ? [...chain(val(s, 'basedOn'), seen2), s] : []; };
    // A paragraph's or run's properties, outermost first: defaults, the default paragraph style, the paragraph's style chain,
    // the run's style chain (less the ones `skip` names), its own.
    const props = (node, kind, pStyle = '', skip = null) => {
      const own = kid(node, kind), id = val(own, kind === 'pPr' ? 'pStyle' : 'rStyle');
      const def = kid(kid(defaults, kind === 'pPr' ? 'pPrDefault' : 'rPrDefault'), kind);
      const normal = !(kind === 'pPr' ? id : pStyle) ? [...styles.values()].find((s) => at(s, 'type') === 'paragraph' && at(s, 'default') === '1') : null;
      const styled = (sid) => chain(sid).filter((s) => !skip?.test(String(val(s, 'name') || at(s, 'styleId')).toLowerCase())).map((s) => kid(s, kind));
      return [def, ...(normal ? styled(at(normal, 'styleId')) : []), ...styled(pStyle), ...styled(id), own].filter(Boolean);
    };
    const styleName = (id) => String(val(styles.get(id), 'name') || id || '').toLowerCase();

    // Lists
    const numX = await part(target('numbering') || 'word/numbering.xml');
    const nums = new Map(all(numX, 'num').map((n) => [at(n, 'numId'), n]));
    const abstracts = new Map(all(numX, 'abstractNum').map((n) => [at(n, 'abstractNumId'), n]));
    const listOf = (p, pp) => {
      const numPr = pp.map((x) => kid(x, 'numPr')).filter(Boolean).at(-1), id = val(numPr, 'numId');
      if (!id || id === '0') return null;
      const level = fin(val(numPr, 'ilvl'), 0, 0, 8), abs = abstracts.get(val(nums.get(id), 'abstractNumId'));
      const lvl = abs && els(abs).find((l) => l.local === 'lvl' && fin(at(l, 'ilvl')) === level);
      return { id, level, ordered: val(lvl, 'numFmt') !== 'bullet' };
    };

    // Footnotes, as inline HTML for the paper schema's footnote_ref.
    const notesX = await part(target('footnotes') || 'word/footnotes.xml');
    const noteById = new Map(all(notesX, 'footnote').filter((n) => !at(n, 'type') || at(n, 'type') === 'normal').map((n) => [at(n, 'id'), n]));

    let imageTotal = 0, noteBytes = 0;
    const image = async (node, source) => {
      const blip = all(node, 'blip')[0], rid = blip && (blip.a['r:embed'] || at(blip, 'embed'));
      const r = (await relsOf(source)).find((x) => x.id === rid && !x.external);
      const ext = r?.target.split('.').at(-1)?.toLowerCase(), mime = { png: 'png', jpg: 'jpeg', jpeg: 'jpeg', gif: 'gif' }[ext || ''];
      if (!r || !mime) { warn('Some pictures were left out.'); return ''; }
      const b = await z.bytes(r.target);
      if (!b) { warn('Some pictures were left out.'); return ''; }
      imageTotal += b.length;
      if (imageTotal > LIMIT.images) throw new RangeError('The pictures in this file are larger than 10 MB.');
      const ext2 = all(node, 'extent')[0], w = Math.round(fin(ext2?.a.cx, 3048000, 9525, 15240000) / 9525);
      return `<img src="data:image/${mime};base64,${base64(b)}" alt="${escH(at(all(node, 'docPr')[0], 'descr'))}" width="${w}">`;
    };
    const runHTML = (rp, inner) => {
      let style = '', h = inner;
      for (const p of rp) {
        const font = at(kid(p, 'rFonts'), 'ascii') || at(kid(p, 'rFonts'), 'hAnsi');
        if (font) { if (ST().FONTS.includes(font)) style = style.replace(/font-family:[^;]*;?/, '') + `font-family:${font};`; else warn('Fonts Word and Blackboard don\'t share were replaced.'); }
        const sz = val(p, 'sz');
        if (sz) style = style.replace(/font-size:[^;]*;?/, '') + `font-size:${fin(sz, 24, 12, 192) / 2}pt;`;
      }
      const t = (k) => { let v; for (const p of rp) { const n = kid(p, k); if (n) v = on(n); } return v; };
      const vert = rp.map((p) => val(p, 'vertAlign')).filter(Boolean).at(-1);
      const u = rp.map((p) => kid(p, 'u')).filter(Boolean).at(-1);
      if (style) {
        const font = /font-family:([^;]*)/.exec(style)?.[1], size = /font-size:([^;]*)/.exec(style)?.[1];
        const keep = [font && font !== f.font ? `font-family:${font}` : '', size && parseFloat(size) !== f.size ? `font-size:${size}` : ''].filter(Boolean).join(';');
        if (keep) h = `<span style="${keep}">${h}</span>`;
      }
      if (vert === 'superscript') h = `<sup>${h}</sup>`; else if (vert === 'subscript') h = `<sub>${h}</sub>`;
      if (u && !['none', '0', 'false'].includes(at(u, 'val'))) h = `<u>${h}</u>`;
      if (t('strike')) h = `<s>${h}</s>`;
      if (t('i')) h = `<em>${h}</em>`;
      if (t('b')) h = `<strong>${h}</strong>`;
      return h;
    };
    // A paragraph's inline content as HTML pieces; a page break inside it splits it ({ br: true } between pieces).
    const inline = async (node, ctx, depth = 0) => {
      if (depth > LIMIT.depth) throw new RangeError('document nesting too deep');
      const name = node.local;
      if (name === 'instrText') { ctx.field += node.kids.map((k) => k.text || '').join(''); return ''; }
      if (name === 'fldChar') {
        const type = at(node, 'fldCharType');
        if (type === 'begin') { ctx.field = ''; ctx.skip = false; }
        if (type === 'separate' && /^\s*(PAGE|NUMPAGES)\b/i.test(ctx.field)) ctx.skip = true;
        if (type === 'end') { ctx.field = ''; ctx.skip = false; }
        return '';
      }
      if (name === 't') return ctx.skip ? '' : escH(node.kids.map((k) => k.text || '').join(''));
      if (name === 'delText' || name === 'del') { warn('Tracked changes were accepted.'); return ''; }
      if (name === 'tab') return '\t';
      if (name === 'br' || name === 'cr') return at(node, 'type') === 'page' ? '\u0000BREAK\u0000' : '<br>';
      if (name === 'drawing') return image(node, ctx.source);
      if (name === 'footnoteReference') {
        if (ctx.note) throw new Error('nested footnote references are not supported');
        const n = noteById.get(at(node, 'id'));
        if (!n) return '';
        const parts2 = [];
        for (const p of all(n, 'p')) parts2.push((await Promise.all(els(p).filter((k) => k.local !== 'pPr').map((k) => inline(k, { ...ctx, field: '', skip: false, note: true }, depth + 1)))).join('').replace(/\u0000BREAK\u0000/g, ''));
        const html = parts2.join(' ').trim();
        noteBytes += html.length;
        if (noteBytes > LIMIT.html) throw new RangeError('The document is too large.');
        return `<sup class="gz-footnote" data-footnote="${escH(html)}"></sup>`;
      }
      if (name === 'footnoteRef') return '';
      if (name === 'pict' || name === 'object' || name === 'oMath' || name === 'oMathPara') { warn('Some pictures, objects or equations were left out.'); return ''; }
      if (['rPr', 'pPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr', 'lastRenderedPageBreak', 'commentRangeStart', 'commentRangeEnd', 'commentReference', 'endnoteReference'].includes(name)) {
        if (name === 'commentReference') warn('Comments were left out.');
        if (name === 'endnoteReference') warn('Endnotes were left out.');
        return '';
      }
      let html = (await Promise.all(els(node).map((k) => inline(k, ctx, depth + 1)))).join('');
      if (name === 'r') {
        if (ctx.note && kid(kid(node, 'rPr'), 'rStyle') && /footnote ?reference/.test(styleName(val(kid(node, 'rPr'), 'rStyle')))) return html;
        if (all(node, 'footnoteReference').length) return html;
        // A heading's own bold and italic are the format's, not the run's.
        html = runHTML(props(node, 'rPr', /heading/.test(styleName(ctx.paragraph)) ? '' : ctx.paragraph, /^(hyperlink|footnote ?reference)$/), html);
      }
      if (name === 'hyperlink') {
        const id = node.a['r:id'] || at(node, 'id'), r = (await relsOf(ctx.source)).find((x) => x.id === id);
        if (r?.external && /^(https?:\/\/|mailto:)/i.test(r.target)) html = `<a href="${escH(r.target)}">${html}</a>`;
      }
      return html;
    };
    // A paragraph's alignment, spacing and indents as the paper schema reads them; what equals the format's own is left
    // out, so the paper keeps following its format. A block quote's own indent is the blockquote's.
    const paraStyle = (pp, { heading, quote, entry, level }) => {
      const css = [];
      let align = '', line = null, left = null, first = null, before = false;
      for (const p of pp) {
        const j = val(p, 'jc'); if (j) align = j === 'both' ? 'justify' : ['center', 'right'].includes(j) ? j : '';
        const sp = kid(p, 'spacing');
        if (sp && at(sp, 'line')) { line = Math.round(Math.max(0.5, Math.min(4, fin(at(sp, 'line'), 240) / 240)) * 100) / 100; if (['exact', 'atLeast'].includes(at(sp, 'lineRule'))) warn('Exact line heights became line spacing.'); }
        const ind = kid(p, 'ind');
        if (ind) {
          if (at(ind, 'left') || at(ind, 'start')) left = fin(at(ind, 'left') || at(ind, 'start')) / 1440;
          if (at(ind, 'firstLine')) first = fin(at(ind, 'firstLine')) / 1440;
          if (at(ind, 'hanging')) first = -fin(at(ind, 'hanging')) / 1440;
        }
        if (kid(p, 'pageBreakBefore')) before = on(kid(p, 'pageBreakBefore'));
      }
      if (quote) { left = (left || 0) - f.quote.indent; if (first === 0) first = null; }
      if (entry && left === f.list.hanging && first === -f.list.hanging) { left = null; first = null; }
      const want = quote ? f.quote.line : f.line;
      if (align && !(heading && (f.headings[level - 1]?.align || 'left') === align)) css.push(`text-align:${align}`);
      if (line != null && line !== want) css.push(`line-height:${line}`);
      if (left && left > 0.05) css.push(`margin-left:${Math.round(left * 100) / 100}in`);
      const def = heading || quote ? null : align === 'center' || align === 'right' ? 0 : f.first;
      const eff = first ?? 0;
      if (!heading && !quote && !(entry && first == null) && eff !== def) css.push(`text-indent:${`${Math.round(eff * 100) / 100}in`}`);
      return { style: css.join(';'), before };
    };
    const BREAK = '\u0000BREAK\u0000';
    const paragraph = async (p, ctx) => {
      ctx.field = ''; ctx.skip = false; ctx.paragraph = val(kid(p, 'pPr'), 'pStyle');
      const name = styleName(ctx.paragraph), m = /heading\s*([1-6])/.exec(name);
      const tag = m ? `h${Math.min(4, +m[1])}` : 'p';
      const pp = props(p, 'pPr'), quote = /quote|block text/.test(name), entry = name === 'bibliography';
      const { style, before } = paraStyle(pp, { heading: !!m, quote, entry, level: m ? Math.min(4, +m[1]) : 0 });
      const inner = (await Promise.all(els(p).filter((k) => k.local !== 'pPr').map((k) => inline(k, ctx)))).join('');
      const open = `<${tag}${style ? ` style="${style}"` : ''}>`;
      const pieces = inner.split(BREAK).map((s) => `${open}${s}</${tag}>`).join('<hr class="gz-page-break">');
      return { html: pieces, before, list: listOf(p, pp), quote };
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
          const c = { rows: 1, span, html: (await blocks(els(cell).filter((k) => k.local !== 'tcPr'), ctx, depth + 1)) || '<p></p>' };
          if (merge && at(merge, 'val') === 'restart') merges.set(col, c); else merges.delete(col);
          cells.push(c);
          col += span;
        }
        grid.push(cells);
      }
      return `<table>${grid.map((cells) => `<tr>${cells.map((c) => `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rows > 1 ? ` rowspan="${Math.min(1000, c.rows)}"` : ''}>${c.html}</td>`).join('')}</tr>`).join('')}</table>`;
    };
    const blocks = async (nodes, ctx, depth = 0) => {
      if (depth > 40) throw new RangeError('document nesting too deep');
      let out = '', list = null, quote = false;
      const close = () => { if (list) { out += list.ordered ? '</ol>' : '</ul>'; list = null; } };
      const unquote = () => { if (quote) { out += '</blockquote>'; quote = false; } };
      for (const node of nodes) {
        if (node.local === 'p') {
          const p = await paragraph(node, ctx);
          if (p.before) { close(); unquote(); out += '<hr class="gz-page-break">'; }
          if (p.list) {
            unquote();
            if (!list || list.ordered !== p.list.ordered) { close(); list = { ordered: p.list.ordered }; out += p.list.ordered ? '<ol>' : '<ul>'; }
            out += p.html.replace(/^<(p|h\d)([^>]*)>/, `<li${p.list.level ? ` class="ql-indent-${p.list.level}"` : ''}>`).replace(/<\/(p|h\d)>$/, '</li>').replace(/<\/(p|h\d)><hr class="gz-page-break"><(p|h\d)[^>]*>/g, '<br>');
            continue;
          }
          close();
          if (p.quote && !quote) { out += '<blockquote>'; quote = true; } else if (!p.quote) unquote();
          out += p.html;
        } else if (node.local === 'tbl') { close(); unquote(); ctx.cells = ctx.cells || []; out += await tableHTML(node, ctx, depth); }
        else if (node.local === 'sdt') { close(); unquote(); const c = kid(node, 'sdtContent'); if (c) out += await blocks(els(c), ctx, depth + 1); }
        else if (!['sectPr', 'bookmarkStart', 'bookmarkEnd', 'proofErr'].includes(node.local)) { close(); unquote(); }
        if (out.length > LIMIT.html) throw new RangeError('The document is too large.');
      }
      close(); unquote();
      return out;
    };
    const ctx = { source: main, field: '', skip: false, paragraph: '' };
    const html = await blocks(els(body), ctx);
    if (html.length > LIMIT.html) throw new RangeError('The document is too large.');
    if (z.names.some((n) => /^word\/(charts|embeddings)\/|vbaProject/i.test(n))) warn('Some pictures, objects or equations were left out.');
    return { html, warnings: [...warnings] };
  };

  return { exportDocx, importDocx, xml, MIME, LIMIT };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_DOCX; else GZ_WRITER_DOCX;
