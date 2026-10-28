// Glaze Writer's objects in a .docx, as two passes lib/writer-docx.js makes around its own work, so that file stays as it
// is: exportParts(doc, parts, { format }) after it has written the parts and before it zips them, and
// importHTML(html, { numbering, styles }) on the HTML it read, with the trees it parsed (its xml() shape:
// { local, a, kids }); writer-docx marks each list item it read with its w:numId (data-w-num). Both take the document
// in the order writer-docx does, which is the document's own order:
//   lists: each level's numbering format and bullet (w:numFmt, w:lvlText), a continued list sharing the list before it
//     (one w:num), a restart as a new w:num on the same definition with w:startOverride;
//   tables: borders off (w:tblBorders nil), header rows (w:tblHeader, repeated on each page as Word does), rows kept whole
//     (w:cantSplit, as the pages draw them), a cell's vertical alignment (w:vAlign); writer-docx reads them back;
//   pictures: one set as a block aligns its paragraph (w:jc, no first-line indent), its caption follows in Word's Caption
//     style, kept with it; a picture alone in its paragraph comes back as a block;
//   horizontal lines are written and read by lib/writer-docx.js alongside its other blocks.
// Classic script; module.exports for node.
var GZ_WRITER_OBJECTS_DOCX = globalThis.GZ_WRITER_OBJECTS_DOCX || (() => {
  const S = () => (typeof GZ_WRITER_SCHEMA !== 'undefined' ? GZ_WRITER_SCHEMA : require('./writer-schema.js'));
  const ST = () => (typeof GZ_WRITER_STYLES !== 'undefined' ? GZ_WRITER_STYLES : require('./writer-styles.js'));
  const L = () => (typeof GZ_WRITER_OBJECTS_LIB !== 'undefined' ? GZ_WRITER_OBJECTS_LIB : require('./writer-objects.js'));
  const D = () => (typeof GZ_WRITER_DOCX !== 'undefined' ? GZ_WRITER_DOCX : require('./writer-docx.js'));
  const esc = (v) => D().esc(v);
  const FMT = { decimal: 'decimal', 'lower-alpha': 'lowerLetter', 'lower-roman': 'lowerRoman', 'upper-alpha': 'upperLetter', 'upper-roman': 'upperRoman' };
  const BULLET = { disc: '•', circle: '◦', square: '▪', dash: '–' };
  const DATA = /^data:image\/(png|jpeg|gif);base64,/i;
  const isList = (n) => n.type.name === 'ordered_list' || n.type.name === 'bullet_list';

  // ================================================================================================================
  // Export
  // ================================================================================================================
  const lvl = (style, l, ordered) => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${ordered ? FMT[style] : 'bullet'}"/><w:lvlText w:val="${ordered ? `%${l + 1}.` : BULLET[style]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (l + 1)}" w:hanging="360"/></w:pPr></w:lvl>`;
  const NIL = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((k) => `<w:${k} w:val="nil"/>`).join('')}</w:tblBorders>`;

  // A picture's paragraph as a block: no first-line indent, the picture's alignment, kept with its caption.
  const blockPara = (p, align, keep) => {
    const m = /^<w:p>(?:<w:pPr>([\s\S]*?)<\/w:pPr>)?/.exec(p);
    let inner = m[1] || '';
    const left = /<w:ind[^>]*\sw:left="(\d+)"/.exec(inner)?.[1];
    inner = inner.replace(/<w:jc [^>]*\/>/g, '').replace(/<w:ind [^>]*\/>/g, '');
    if (keep) { const s = /^<w:pStyle [^>]*\/>/.exec(inner)?.[0] || ''; inner = `${s}<w:keepNext/>${inner.slice(s.length)}`; }
    inner += `<w:ind${left ? ` w:left="${left}"` : ''} w:firstLine="0"/><w:jc w:val="${align}"/>`;
    return `<w:p><w:pPr>${inner}</w:pPr>${p.slice(m[0].length)}`;
  };

  // doc: the paper (a Node or its JSON); parts: writer-docx's { path: xml }, changed in place. → parts.
  const exportParts = (doc, parts, o = {}) => {
    if (typeof doc?.forEach !== 'function') doc = S().paper.nodeFromJSON(doc);
    let x = parts['word/document.xml'];
    if (!x) return parts;
    const f = ST().look(ST().get(o.format), doc.attrs.setup);

    // ---- lists
    const lists = [];
    doc.descendants((n) => { if (isList(n)) { lists.push(n); return false; } return true; });
    if (lists.some((l) => l.attrs.styles || l.attrs.continue || l.content.content.some((li) => li.attrs.start != null)) && parts['word/numbering.xml']) {
      let next = lists.length + 1, prev = null;
      const extra = [], itemNums = [];
      lists.forEach((l, i) => {
        const ordered = l.type.name === 'ordered_list';
        let num = i + 1, abs = i + 1;
        if (ordered && l.attrs.continue && prev) ({ num, abs } = prev);
        l.forEach((li) => {
          if (ordered && li.attrs.start != null) { num = next++; extra.push({ num, abs, level: Math.min(8, li.attrs.indent || 0), start: li.attrs.start }); }
          itemNums.push(num);
        });
        if (ordered) prev = { num, abs };
      });
      let k = 0;
      x = x.replace(/<w:numId w:val="\d+"\/>/g, (whole) => (k < itemNums.length ? `<w:numId w:val="${itemNums[k++]}"/>` : whole));
      const open = /^[\s\S]*?<w:numbering[^>]*>/.exec(parts['word/numbering.xml'])[0];
      parts['word/numbering.xml'] = `${open}${lists.map((l, i) => {
        const ordered = l.type.name === 'ordered_list', styles = L().levelStyles(l);
        return `<w:abstractNum w:abstractNumId="${i + 1}"><w:multiLevelType w:val="hybridMultilevel"/>${styles.map((s, lv) => lvl(s, lv, ordered)).join('')}</w:abstractNum>`;
      }).join('')}${lists.map((_, i) => `<w:num w:numId="${i + 1}"><w:abstractNumId w:val="${i + 1}"/></w:num>`).join('')}${extra.map((e) => `<w:num w:numId="${e.num}"><w:abstractNumId w:val="${e.abs}"/><w:lvlOverride w:ilvl="${e.level}"><w:startOverride w:val="${e.start}"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
    }

    // ---- tables, cells and pictures, in document order
    const tables = [], cells = [], images = [];
    doc.descendants((n) => {
      if (n.type.name === 'table') tables.push(n);
      else if (n.type.name === 'table_cell' || n.type.name === 'table_header') cells.push(n);
      else if (n.type.name === 'image' && DATA.test(n.attrs.src)) images.push(n);
      return true;
    });
    const ops = [], stack = [];
    let ti = 0, ci = 0, ii = 0, pOpen = -1, captions = false;
    const TOKENS = /<w:tbl>|<\/w:tbl>|<w:tr>|<w:tcPr>[\s\S]*?<\/w:tcPr>|<w:tblBorders>[\s\S]*?<\/w:tblBorders>|<w:drawing>|<w:p>|<w:p\s[^>]*>|<\/w:p>/g;
    for (let m = TOKENS.exec(x); m; m = TOKENS.exec(x)) {
      const t = m[0], at = m.index;
      if (t === '<w:tbl>') stack.push({ node: tables[ti++], row: -1, head: 0 });
      else if (t === '</w:tbl>') stack.pop();
      else if (t.startsWith('<w:tblBorders>')) { const top = stack.at(-1); if (top?.node && top.node.attrs.borders === false) ops.push({ at, end: at + t.length, text: NIL }); }
      else if (t === '<w:tr>') {
        const top = stack.at(-1);
        if (!top?.node) continue;
        top.row++;
        const row = top.node.maybeChild(top.row);
        const header = row && top.head === top.row && row.childCount > 0 && row.content.content.every((c) => c.type.name === 'table_header');
        if (header) top.head++;
        ops.push({ at: at + t.length, end: at + t.length, text: `<w:trPr><w:cantSplit/>${header ? '<w:tblHeader/>' : ''}</w:trPr>` });
      } else if (t.startsWith('<w:tcPr>')) {
        if (/<w:vMerge\/>/.test(t)) continue; // a merged cell's continuation: writer-docx's, no cell of the paper
        const cell = cells[ci++], v = cell?.attrs.valign;
        if (v === 'middle' || v === 'bottom') { const end = at + t.length - '</w:tcPr>'.length; ops.push({ at: end, end, text: `<w:vAlign w:val="${v === 'middle' ? 'center' : 'bottom'}"/>` }); }
      } else if (t === '<w:drawing>') {
        const img = images[ii++];
        if (!img || img.attrs.display !== 'block' || pOpen < 0) continue;
        const close = x.indexOf('</w:p>', at), align = img.attrs.align || 'center', caption = img.attrs.caption;
        if (close < 0 || ops.some((op) => op.at === pOpen)) continue;
        const p = x.slice(pOpen, close + 6);
        captions ||= !!caption;
        ops.push({ at: pOpen, end: close + 6, text: blockPara(p, align, !!caption) + (caption ? `<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="${align}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(caption)}</w:t></w:r></w:p>` : '') });
      } else if (t === '</w:p>') pOpen = -1;
      else pOpen = at;
    }

    ops.sort((a, b) => b.at - a.at || b.end - a.end);
    for (const op of ops) x = x.slice(0, op.at) + op.text + x.slice(op.end);
    parts['word/document.xml'] = x;
    if (captions && parts['word/styles.xml'] && !parts['word/styles.xml'].includes('w:styleId="Caption"')) {
      const sz = Math.round(Math.max(8, f.size - 2) * 2);
      parts['word/styles.xml'] = parts['word/styles.xml'].replace(/<\/w:styles>\s*$/, `<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style></w:styles>`);
    }
    return parts;
  };

  // ================================================================================================================
  // Import
  // ================================================================================================================
  const els = (n) => (n?.kids || []).filter((k) => k.local);
  const kid = (n, local) => els(n).find((k) => k.local === local);
  const at = (n, local) => { if (!n) return ''; for (const [k, v] of Object.entries(n.a || {})) if (k === local || k.endsWith(`:${local}`)) return v; return ''; };
  const val = (n, local) => at(kid(n, local), 'val');
  const NUM_IN = { decimal: 'decimal', lowerLetter: 'lower-alpha', lowerRoman: 'lower-roman', upperLetter: 'upper-alpha', upperRoman: 'upper-roman' };
  const BULLET_IN = { '•': 'disc', '': 'disc', '·': 'disc', o: 'circle', '◦': 'circle', '▪': 'square', '■': 'square', '': 'square', '–': 'dash', '-': 'dash', '—': 'dash' };
  const DEFAULTS = { ordered: ['decimal', 'lower-alpha', 'lower-roman'], bullet: ['disc', 'circle', 'square'] };

  // html: writer-docx's; ctx: the trees it parsed (numbering.xml, styles.xml; null when absent). → html.
  const importHTML = (html, ctx = {}) => {
    const styleById = new Map();
    for (const s of (function all(n, out = []) { for (const k of els(n)) { if (k.local === 'style') out.push(k); all(k, out); } return out; })(ctx.styles || { kids: [] })) styleById.set(at(s, 'styleId'), s);
    const nums = new Map(), abstracts = new Map();
    for (const n of els(kid(ctx.numbering, 'numbering') || ctx.numbering)) {
      if (n.local === 'num') nums.set(at(n, 'numId'), n);
      if (n.local === 'abstractNum') abstracts.set(at(n, 'abstractNumId'), n);
    }
    // A level's definition: the instance's own override of it, else its abstract's (through a numbering style's link).
    const absOf = (numId, n = 0) => { const a = abstracts.get(val(nums.get(numId), 'abstractNumId')), link = val(a, 'numStyleLink'); return link && n < 4 ? absOf(val(kid(kid(styleById.get(link), 'pPr'), 'numPr'), 'numId'), n + 1) || a : a; };
    const lvlOf = (numId, level) => { const o = els(nums.get(numId)).find((x) => x.local === 'lvlOverride' && +at(x, 'ilvl') === level); return kid(o, 'lvl') || els(absOf(numId)).find((l) => l.local === 'lvl' && +at(l, 'ilvl') === level); };

    // The lists as writer-docx wrote them: each <ol> / <ul> and its items' w:numId and level.
    const runs = [];
    for (const m of html.matchAll(/<(ol|ul)>|<li\b([^>]*?) data-w-num="([^"]*)"/g)) {
      if (m[1]) runs.push({ ordered: m[1] === 'ol', items: [] });
      else runs.at(-1)?.items.push({ id: m[3], level: +(/ql-indent-(\d)/.exec(m[2])?.[1] || 0) });
    }
    const styleOf = (run) => {
      const d = run.ordered ? DEFAULTS.ordered : DEFAULTS.bullet;
      const all = Array.from({ length: 9 }, (_, l) => {
        const v = lvlOf(run.items[0].id, l);
        const s = run.ordered ? NUM_IN[val(v, 'numFmt')] : BULLET_IN[val(v, 'lvlText')];
        return s || d[l % d.length];
      });
      let n = 9;
      while (n > 0 && all[n - 1] === d[(n - 1) % d.length]) n--;
      return n ? all.slice(0, n).join(',') : null;
    };
    const startOf = (item) => {
      const o = els(nums.get(item.id)).find((x) => x.local === 'lvlOverride' && +at(x, 'ilvl') === item.level);
      const v = +val(o, 'startOverride') || +val(lvlOf(item.id, item.level), 'start') || 1;
      return Math.max(1, Math.min(32767, v));
    };

    // ---- the HTML, tag by tag
    let ri = -1, li = 0, prevOrdered = null, continued = false;
    html = html.replace(/<(ol|ul)>|<li\b[^>]*? data-w-num="[^"]*"/g, (tag) => {
      if (tag === '<ol>' || tag === '<ul>') {
        const run = runs[++ri];
        li = 0;
        if (!run?.items.length) return tag;
        const styles = styleOf(run), cont = run.ordered && prevOrdered && prevOrdered.items.at(-1).id === run.items[0].id;
        continued = !!cont;
        if (run.ordered) prevOrdered = run;
        return `<${tag.slice(1, 3)}${styles ? ` data-styles="${styles}"` : ''}${cont ? ' data-continue="true"' : ''}>`;
      }
      if (tag.startsWith('<li')) {
        const run = runs[ri], item = run?.items[li], before = run?.items[li - 1], open = tag.replace(/ data-w-num="[^"]*"$/, '');
        li++;
        return run?.ordered && item && (before ? item.id !== before.id : !continued && startOf(item) !== 1) ? `<li data-start="${startOf(item)}"${open.slice(3)}` : open;
      }
      return tag;
    });
    // A picture alone in its paragraph is a block, aligned as the paragraph was.
    html = html.replace(/<p( style="[^"]*")?><img ([^>]*)><\/p>/g, (whole, style, attrs) => {
      const align = /text-align:(center|right)/.exec(style || '')?.[1] || 'left';
      return `<p${style || ''}><img ${attrs} data-display="block" data-align="${align}"></p>`;
    });
    return html;
  };

  return { exportParts, importHTML };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_OBJECTS_DOCX; else GZ_WRITER_OBJECTS_DOCX;
