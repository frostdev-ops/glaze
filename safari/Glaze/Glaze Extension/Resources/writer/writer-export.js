// Glaze Writer's paper or post as plain text and as Markdown (⋯ → Export .txt and Export .md, writer-print.js). Text: a
// block a blank line from the next, lists bulleted and numbered as the paper numbers them (1., a., i., its own styles), block quotes
// indented, table cells a tab apart, note marks as [1] with the notes after the text, a link's address after its words,
// pictures as [Image: alt]. Markdown (CommonMark with GitHub's tables, strikethrough and footnotes): headings, emphasis,
// links, lists, block quotes, tables, notes as [^1], pictures as references listed at the end; underline, superscript and
// subscript as HTML. Page breaks and empty lines are left out in both. Pure, over a GZ_WRITER_SCHEMA document (paper or
// compose); module.exports for node.
var GZ_WRITER_EXPORT = globalThis.GZ_WRITER_EXPORT || (() => {
  const schema = () => globalThis.GZ_WRITER_SCHEMA || require('./writer-schema.js');
  // A note's text (inline HTML on its mark) as the textblocks it parses to.
  const noteBlocks = (content) => {
    const S = schema(), out = [];
    S.parse(S.paper, `<div>${content || ''}</div>`).descendants((n) => { if (n.isTextblock) { out.push(n); return false; } return true; });
    return out;
  };

  // ---- inline content
  const DELIM = {
    link: (m) => ['[', `](${/[\s()<>]/.test(m.attrs.href) ? `<${m.attrs.href}>` : m.attrs.href})`],
    bold: () => ['**', '**'], italic: () => ['*', '*'], strike: () => ['~~', '~~'],
    underline: () => ['<u>', '</u>'], sup: () => ['<sup>', '</sup>'], sub: () => ['<sub>', '</sub>'],
  };
  const esc = (s) => s.replace(/[\\`*_[\]<~]/g, '\\$&');
  // What would start a heading, list, quote or rule at a line's start.
  const escStart = (s) => s.replace(/^(\s*)([#>+-])(?=\s|$)/, '$1\\$2').replace(/^(\s*\d+)([.)])(?=\s|$)/, '$1\\$2').replace(/^(\s*)([-=])(?=\2{2,}\s*$)/, '$1\\$2');

  // A textblock's inline content. ctx: { md, notes: [], images: [] }.
  const inline = (block, ctx) => {
    let s = '';
    if (!ctx.md) {
      let link = null, linkText = '';
      const endLink = () => { if (link && linkText.trim() !== link && !/^mailto:/i.test(link)) s += ` (${link})`; link = null; linkText = ''; };
      block.forEach((c) => {
        const href = c.marks.find((m) => m.type.name === 'link')?.attrs.href || null;
        if (href !== link) endLink();
        link = href;
        const piece = c.isText ? c.text : c.type.name === 'hard_break' ? '\n' : c.type.name === 'footnote_ref' ? note(c, ctx) : c.type.name === 'image' ? image(c, ctx) : '';
        if (link) linkText += piece;
        s += piece;
      });
      endLink();
      return s;
    }
    const open = []; // [mark, closer]
    const close = (k) => {
      const ws = /\s*$/.exec(s)[0];
      s = s.slice(0, s.length - ws.length);
      while (open.length > k) s += open.pop()[1];
      s += ws;
    };
    block.forEach((c) => {
      const marks = c.marks.filter((m) => DELIM[m.type.name]);
      let k = 0;
      while (k < open.length && k < marks.length && open[k][0].eq(marks[k])) k++;
      close(k);
      let piece = c.isText ? esc(c.text) : c.type.name === 'hard_break' ? '\\\n' : c.type.name === 'footnote_ref' ? note(c, ctx) : c.type.name === 'image' ? image(c, ctx) : '';
      if (k < marks.length) {
        const lead = /^\s*/.exec(piece)[0];
        s += lead;
        piece = piece.slice(lead.length);
        for (const m of marks.slice(k)) { const [a, b] = DELIM[m.type.name](m); s += a; open.push([m, b]); }
      }
      s += piece;
    });
    close(0);
    return s;
  };
  const note = (c, ctx) => {
    const n = ctx.notes.push(noteBlocks(c.attrs.content).map((b) => inline(b, { ...ctx, notes: [], images: ctx.images })).join(ctx.md ? '\n\n    ' : '\n\n').trim());
    return ctx.md ? `[^${n}]` : `[${n}]`;
  };
  const image = (c, ctx) => {
    const alt = String(c.attrs.alt || '').replace(/\s+/g, ' ').trim();
    if (!ctx.md) return alt ? `[Image: ${alt}]` : '[Image]';
    const n = ctx.images.push(c.attrs.src);
    return `![${esc(alt)}][image-${n}]`;
  };

  // ---- blocks
  // The paper's list markers (writer/writer-objects.js), and its counters: each level counts on from the item before, an
  // item's start sets its level, a deeper level starts again under each item, and a list that continues the numbered one
  // before it counts on from it.
  const objects = () => globalThis.GZ_WRITER_OBJECTS_LIB || require('./writer-objects.js');
  const prefix = (text, first, rest = first) => text.split('\n').map((l, i) => ((i ? rest : first) + l).replace(/\s+$/, '')).join('\n');

  const blocks = (parent, ctx) => {
    const out = [];
    parent.forEach((n) => {
      const name = n.type.name;
      if (name === 'paragraph') { const s = inline(n, ctx); if (s.trim()) out.push(ctx.md ? escStart(s) : s); }
      else if (name === 'heading') { const s = inline(n, ctx); if (s.trim()) out.push(ctx.md ? `${'#'.repeat(n.attrs.level)} ${s}` : s); }
      else if (name === 'code_block') { if (n.textContent) out.push(ctx.md ? `\`\`\`\n${n.textContent.replace(/\n$/, '')}\n\`\`\`` : n.textContent.replace(/\n$/, '')); }
      else if (name === 'blockquote') { const inner = blocks(n, ctx).join('\n\n'); if (inner) out.push(prefix(inner, ctx.md ? '> ' : '    ')); }
      else if (name === 'bullet_list' || name === 'ordered_list') {
        const ordered = name === 'ordered_list', counts = ordered && n.attrs.continue ? ctx.counts : [], lines = [];
        const styles = ordered && objects().levelStyles(n);
        n.forEach((li) => {
          const level = Math.max(0, li.attrs.indent || 0);
          counts.length = level + 1;
          counts[level] = ordered && li.attrs.start != null ? li.attrs.start : (counts[level] || 0) + 1;
          const mark = !ordered ? (ctx.md ? '-' : '•') : `${ctx.md ? counts[level] : objects().marker(styles[level], counts[level])}.`;
          const pad = '    '.repeat(level);
          lines.push(prefix(inline(li, ctx), `${pad}${mark} `, `${pad}    `));
        });
        if (ordered) ctx.counts = counts;
        out.push(lines.join('\n'));
      } else if (name === 'table') {
        // spans[column]: the rows below that a cell above still covers there.
        const rows = [], spans = [];
        n.forEach((row) => {
          const cells = [];
          const covered = () => { while (spans[cells.length] > 0) { spans[cells.length]--; cells.push(''); } };
          row.forEach((cell) => {
            covered();
            const parts = [];
            cell.descendants((b) => { if (b.isTextblock) { parts.push(inline(b, ctx)); return false; } return true; });
            const s = parts.filter((p) => p.trim()).join(ctx.md ? '<br>' : ' ');
            cells.push(ctx.md ? s.replace(/\n/g, ' ').replace(/\|/g, '\\|') : s.replace(/[\t\n]/g, ' '));
            for (let i = 0; i < (cell.attrs.colspan || 1); i++) { if (i) cells.push(''); spans[cells.length - 1] = (cell.attrs.rowspan || 1) - 1; }
          });
          while (spans.slice(cells.length).some((v) => v > 0)) { if (spans[cells.length] > 0) spans[cells.length]--; cells.push(''); }
          rows.push(cells);
        });
        if (!rows.length) return;
        if (!ctx.md) { out.push(rows.map((r) => r.join('\t')).join('\n')); return; }
        const w = Math.max(...rows.map((r) => r.length)), line = (r) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? '').join(' | ')} |`;
        out.push([line(rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n'));
      } else if (n.isTextblock) { const s = inline(n, ctx); if (s.trim()) out.push(s); }
      else if (!n.isAtom) out.push(...blocks(n, ctx));
    });
    return out;
  };

  const run = (doc, md) => {
    const ctx = { md, notes: [], images: [], counts: [] }, out = blocks(doc, ctx);
    if (ctx.notes.length) {
      if (!md) out.push('Notes', ctx.notes.map((s, i) => `[${i + 1}] ${s}`).join('\n'));
      else out.push(ctx.notes.map((s, i) => `[^${i + 1}]: ${s}`).join('\n'));
    }
    if (ctx.images.length) out.push(ctx.images.map((src, i) => `[image-${i + 1}]: <${src}>`).join('\n'));
    return out.length ? `${out.join('\n\n')}\n` : '';
  };
  return { text: (doc) => run(doc, false), markdown: (doc) => run(doc, true) };
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_EXPORT;
