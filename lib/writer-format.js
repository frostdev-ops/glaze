// Glaze Writer's paper formats at work on a paper: a new paper's opening (MLA's heading block, APA's and Chicago's title
// page) and list page filled from what Ultra says, a switch between formats that carries the opening's lines over, and the
// format checks: local, deterministic, each an issue (source 'format') the Checks tab lists with a fix, plus the
// checklist under them. Pure: paper-schema nodes or their JSON in, data out; writer-paper.js applies the fixes.
// Classic script; module.exports for node.
var GZ_WRITER_FORMAT = globalThis.GZ_WRITER_FORMAT || (() => {
  const ST = () => (typeof GZ_WRITER_STYLES !== 'undefined' ? GZ_WRITER_STYLES : require('./writer-styles.js'));

  // ---- making a paper
  const BLOCK = { align: null, indent: 0, line: null, first: null };
  const p = (text, attrs = {}, marks) => ({ type: 'paragraph', attrs: { ...BLOCK, ...attrs }, ...(text ? { content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] } : {}) });
  const BOLD = [{ type: 'bold' }], C = { align: 'center' };
  const blanks = (n) => Array.from({ length: n }, () => p('', C));
  // v: { name, instructor, course, date, title }; an unknown line stays empty for the student to fill.
  const opening = (f, v = {}) => {
    const s = (x) => String(x || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (f.opening === 'heading') return [...[v.name, v.instructor, v.course, v.date].map((x) => p(s(x), { first: 0 })), p(s(v.title), C)];
    const title = p(s(v.title), C, f.title.bold && s(v.title) ? BOLD : undefined);
    const lines = [v.name, v.course, v.instructor, v.date].map((x) => p(s(x), C));
    // APA: the title three lines down, a blank line, the student's lines, and the title again over the text. Chicago
    // (Turabian's class paper): the title a third of the way down, the student's lines two thirds down.
    if (f.cite === 'apa') { lines.splice(1, 0, p(s(v.affiliation), C)); if (v.dueDate) lines[4] = p(s(v.dueDate), C); return [...blanks(3), title, p('', C), ...lines, { type: 'page_break' }, JSON.parse(JSON.stringify(title))]; }
    return [...blanks(6), title, ...blanks(7), ...lines, { type: 'page_break' }];
  };
  const closing = (f) => [{ type: 'page_break' }, p(f.list.title, C, f.list.bold ? BOLD : undefined)];
  // A new paper: the opening, the body (paragraph JSON, or one empty paragraph), the list page.
  const template = (f, v = {}, body = []) => ({ type: 'doc', content: [...opening(f, v), ...(body.length ? body : [p('')]), ...closing(f)] });

  // ---- reading a paper's opening back
  const kids = (doc) => (Array.isArray(doc?.content) ? doc.content : doc?.content?.content || []);
  const type = (n) => n?.type?.name || n?.type;
  const text = (n) => (typeof n?.textContent === 'string' ? n.textContent : (n?.content || []).map((c) => c.text || text(c)).join(''));
  const attrs = (n) => n?.attrs || {};
  const DATE = /^(\d{1,2}\s+[A-Z][a-z]+\.?\s+\d{4}|[A-Z][a-z]+\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;
  // The opening as the format makes it, if the paper still has that shape: { end (first body index), lines: { name,
  // instructor, course, date, title }, at: { line → top-level index } }. null when it doesn't.
  const read = (doc, f) => {
    const all = kids(doc);
    if (f.opening === 'heading') {
      if (all.length < 5 || all.slice(0, 4).some((n) => type(n) !== 'paragraph' || attrs(n).align) || type(all[4]) !== 'paragraph' || attrs(all[4]).align !== 'center') return null;
      const keys = ['name', 'instructor', 'course', 'date'];
      return { end: 5, lines: { ...Object.fromEntries(keys.map((k, i) => [k, text(all[i]).trim()])), title: text(all[4]).trim() }, at: { ...Object.fromEntries(keys.map((k, i) => [k, i])), title: 4 } };
    }
    const brk = all.findIndex((n) => type(n) === 'page_break');
    if (brk < 1 || brk > 24 || all.slice(0, brk).some((n) => type(n) !== 'paragraph' || attrs(n).align !== 'center')) return null;
    // The student's four lines sit right before the break (an empty one stays in its place); the title is the first
    // line with text above them.
    if (brk < 5) return null;
    const lines = {}, at = {};
    const ti = all.slice(0, brk - 4).findIndex((n) => text(n).trim());
    const start = ti + 1 + (ti >= 0 && !text(all[ti + 1]).trim() ? 1 : 0);
    const keys = f.cite === 'apa' && ti >= 0 && brk - start >= 5 ? ['name', 'affiliation', 'course', 'instructor', 'date'] : ['name', 'course', 'instructor', 'date'];
    keys.forEach((k, j) => { at[k] = brk - keys.length + j; lines[k] = text(all[at[k]]).trim(); });
    if (ti >= 0) { at.title = ti; lines.title = text(all[ti]).trim(); }
    let end = brk + 1;
    if (f.cite === 'apa' && type(all[end]) === 'paragraph' && attrs(all[end]).align === 'center' && text(all[end]).trim() === (lines.title || '')) end++;
    return { end, lines, at };
  };
  // MLA's header name: the last word of the heading's first line.
  const surname = (doc, f) => {
    const o = read(doc, f), name = o?.lines.name || '';
    return name.split(/\s+/).filter(Boolean).at(-1)?.replace(/[^\p{L}\p{M}'’-]/gu, '') || '';
  };
  // The paper in another format: its opening rebuilt from the same lines (or left alone when it isn't the old format's
  // shape), the list page renamed. JSON in, JSON out. v: lines to use where the old opening has none.
  const restyle = (doc, from, to, v = {}) => {
    const all = kids(doc).map((n) => JSON.parse(JSON.stringify(n.toJSON ? n.toJSON() : n)));
    const old = read({ content: all }, from);
    let body = all;
    if (old) body = [...opening(to, { ...v, ...Object.fromEntries(Object.entries(old.lines).filter(([, x]) => x)) }), ...all.slice(old.end)];
    const list = ST().listAt({ content: body });
    if (list) body[list.title] = p(to.list.title, C, to.list.bold ? BOLD : undefined);
    return { type: 'doc', content: body };
  };

  // ---- checks
  // Each rule's id, the checklist row it counts in, and the message the student sees (the frame translates it).
  const ROWS = {
    mla: [['heading', 'Heading'], ['header', 'Header'], ['margins', 'Margins'], ['font', 'Font and spacing'], ['citations', 'Citations'], ['list', 'Works Cited']],
    apa: [['heading', 'Title page'], ['header', 'Page numbers'], ['margins', 'Margins'], ['font', 'Font and spacing'], ['headings', 'Headings'], ['citations', 'Citations'], ['list', 'References']],
    chicago: [['heading', 'Title page'], ['header', 'Page numbers'], ['margins', 'Margins'], ['font', 'Font and spacing'], ['citations', 'Notes'], ['list', 'Bibliography']],
  };
  // Quotations in a run of text, paired in order (a straight quote opens, then closes; curly ones say which they are), so
  // the stretch between two quotations is never taken for one. → [{ index, length, inner }].
  const quotes = (s) => {
    const out = [];
    let open = -1;
    for (const m of s.matchAll(/["\u201c\u201d]/g)) {
      const c = m[0];
      if (open < 0) { if (c !== '\u201d') open = m.index; continue; }
      if (c === '\u201c') { open = m.index; continue; }
      out.push({ index: open, length: m.index - open + 1, inner: s.slice(open + 1, m.index) });
      open = -1;
    }
    return out;
  };
  const words = (s) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  // About how many lines a run of text takes in the body: the frame passes the real count (writer-paginate measures);
  // 90 characters a line is Times New Roman 12 on 6.5 inches.
  const estimate = (s) => Math.ceil(s.length / 90);

  // What an imported file sets itself and a paper that keeps the file's formatting doesn't hear about: line spacing,
  // space between paragraphs, the page's margins and the base font (a preset's own margins and font still count).
  const KEPT = new Set(['spacing', 'paragraph-space', 'paragraph-space-before', 'margins', 'preset-font', 'font']);
  // doc: a paper Node (positions are its positions). f: the format. ctx: { name, course } as Ultra gave them.
  // o: { lines(from, to) → line count, keep (the paper keeps an imported file's formatting) }. → { issues, rows: [{ id,
  // label, count }] }.
  const fill = (k, v) => k.replace(/\{(\w+)\}/g, (m, n) => (v && n in v ? String(v[n]) : m));
  const check = (doc, f, ctx = {}, o = {}) => {
    const issues = [], cite = f.cite;
    // key: the message with {vars} (what the frame translates); message: it filled in, in English.
    const add = (row, rule, from, to, key, extra = {}) => issues.push({ id: `format:${rule}:${from}:${to}`, row, rule, from, to, source: 'format', kind: 'format', key, message: fill(key, extra.vars), suggestions: [], sure: false, ...extra });
    const tops = [];
    doc.forEach((node, offset, index) => tops.push({ node, pos: offset, index }));
    const span = (t) => ({ from: t.pos + 1, to: t.pos + t.node.nodeSize - 1 });
    const end = doc.content.size;
    const open = read(doc, f), list = ST().listAt(doc);
    const def = ST().FORMATS[f.base || f.id];

    // The opening
    if (!open) add('heading', 'opening', 0, 0, f.opening === 'heading' ? 'Start with the MLA heading: your name, instructor, course and date' : 'Start with a title page', { fix: { op: 'opening' } });
    else if (f.opening === 'heading') {
      const names = { name: 'Your name', instructor: 'Instructor', course: 'Course', date: 'Date' };
      for (const k of Object.keys(names)) if (!open.lines[k]) { const t = tops[open.at[k]]; add('heading', `heading-${k}`, t.pos + 1, t.pos + 1, 'Heading line missing: {line}', { vars: { line: names[k] } }); }
      // Their order: the date last, the student's name first, the course third (where Ultra's names say which is which).
      const role = (s) => (DATE.test(s) ? 'date' : ctx.name && s === ctx.name ? 'name' : ctx.course && s === ctx.course ? 'course' : '');
      const roles = ['name', 'instructor', 'course', 'date'].map((k) => role(open.lines[k] || ''));
      if (roles.some((r, i) => r && r !== ['name', 'instructor', 'course', 'date'][i])) {
        add('heading', 'heading-order', tops[0].pos + 1, tops[3].pos + tops[3].node.nodeSize - 1, 'Heading lines go in this order: your name, instructor, course, date', { fix: { op: 'heading-order', roles } });
      }
      const date = open.lines.date || '', d = Date.parse(date.replace(/(\d)(st|nd|rd|th)\b/, '$1'));
      if (date && DATE.test(date) && Number.isFinite(d)) {
        const want = ST().dateText(f, new Date(d));
        if (want !== date) { const t = span(tops[3]); add('heading', 'heading-date', t.from, t.to, 'MLA dates go day, month, year', { suggestions: [want] }); }
      }
    }
    if (open && open.lines.title !== undefined) {
      const t = tops[open.at.title];
      if (!open.lines.title && t) add('heading', 'title-missing', t.pos + 1, t.pos + 1, 'Add a title');
      else if (t) {
        const s = span(t), marks = (name) => { let all = true, any = false; t.node.forEach((c) => { if (c.isText) { any = true; if (!c.marks.some((m) => m.type.name === name)) all = false; } }); return any && all; };
        const tx = open.lines.title;
        if (f.opening === 'heading' && marks('bold')) add('heading', 'title-bold', s.from, s.to, 'Titles aren\'t bold in MLA', { fix: { op: 'unmark', mark: 'bold' } });
        if (!f.title.bold && cite !== 'chicago' && f.opening !== 'heading' && marks('bold')) add('heading', 'title-bold', s.from, s.to, 'Titles aren\'t bold here', { fix: { op: 'unmark', mark: 'bold' } });
        if (f.title.bold && !marks('bold')) add('heading', 'title-plain', s.from, s.to, 'APA titles are bold', { fix: { op: 'mark', mark: 'bold' } });
        if (marks('underline')) add('heading', 'title-underline', s.from, s.to, 'Titles aren\'t underlined', { fix: { op: 'unmark', mark: 'underline' } });
        if (/^["“].*["”]$/.test(tx)) add('heading', 'title-quoted', s.from, s.to, 'Titles aren\'t in quotation marks', { suggestions: [tx.slice(1, -1)] });
      }
    }
    // APA repeats the title over the first page of text.
    if (cite === 'apa' && open && open.lines.title) {
      const t = tops[open.end - 1];
      if (!(t && t.node.attrs.align === 'center' && t.node.textContent.trim() === open.lines.title)) {
        const brk = tops.find((x) => x.node.type.name === 'page_break');
        if (brk) add('heading', 'title-repeat', brk.pos + 1, brk.pos + 1, 'Repeat the title at the top of the first page of text', { fix: { op: 'title-repeat', at: brk.pos + 1, title: open.lines.title } });
      }
    }

    // The header (an imported file's own header is its own text)
    const setup = ST().setup(doc.attrs?.setup);
    if (f.header.text === 'name-page' && open && !setup && !surname(doc, f)) add('header', 'header-name', 0, 0, 'Add your name to the heading so the page header shows it');
    if (def && f.header.text !== def.header.text) add('header', 'header-kind', 0, 0, cite === 'mla' ? 'MLA pages show your last name and the page number' : 'Pages show their number at the top right', { fix: { op: 'format', id: def.id } });

    // Margins, font and spacing: an imported file's own page and base font, the paper's preset, then what's set by hand on
    // its text.
    if (def && setup && setup.margins.some((m, i) => m !== def.margins[i])) add('margins', 'margins', 0, 0, 'Margins are 1 inch on every side', { fix: { op: 'setup', key: 'margins', value: def.margins } });
    else if (def && f.margins.some((m, i) => m !== def.margins[i])) add('margins', 'margins', 0, 0, 'Margins are 1 inch on every side', { fix: { op: 'format', id: def.id } });
    const fontAllowed = (cite === 'apa' && ((['Arial', 'Calibri'].includes(f.font) && f.size === 11) || (f.font === 'Times New Roman' && f.size === 12)))
      || (cite === 'chicago' && ((f.font === 'Arial' && f.size === 11) || (['Times New Roman', 'Calibri'].includes(f.font) && f.size === 12)));
    if (def && setup?.font && (setup.font !== f.font || setup.size !== f.size)) add('font', 'preset-font', 0, 0, '{format} uses {font} {size}', { vars: { format: def.label, font: f.font, size: f.size }, fix: { op: 'setup', key: 'font', value: null } });
    else if (def && !fontAllowed && (f.font !== def.font || f.size !== def.size)) add('font', 'preset-font', 0, 0, '{format} uses {font} {size}', { vars: { format: def.label, font: def.font, size: def.size }, fix: { op: 'format', id: def.id } });
    if (def && f.line !== def.line) add('font', 'preset-line', 0, 0, 'The text is double-spaced', { fix: { op: 'format', id: def.id } });
    let run = null;
    const flush = () => { if (run) add('font', 'font', run.from, run.to, "The paper's text is all {font} {size}", { vars: { font: f.font, size: f.size }, fix: { op: 'unmark', mark: 'text_style' } }); run = null; };
    doc.descendants((n, pos) => {
      if (!n.isText) return true;
      const st = n.marks.find((m) => m.type.name === 'text_style');
      const off = st && ((st.attrs.font && st.attrs.font !== f.font) || (st.attrs.size && st.attrs.size !== f.size));
      if (off && run && run.to === pos) run.to = pos + n.nodeSize;
      else { flush(); if (off) run = { from: pos, to: pos + n.nodeSize }; }
      return false;
    });
    flush();
    doc.descendants((n, pos, parent) => {
      if (n.isTextblock && ((n.attrs.line != null && n.attrs.line !== (parent.type.name === 'blockquote' ? f.quote.line : f.line)) || n.attrs.exact != null || n.attrs.least != null)) {
        add('font', 'spacing', pos + 1, pos + n.nodeSize - 1, f.line === 2 ? 'The text is double-spaced' : 'Line spacing differs from the format', { fix: n.attrs.exact != null || n.attrs.least != null ? { op: 'clear', key: ['line', 'exact', 'least'], at: [pos] } : { op: 'attr', key: 'line', value: null, at: pos } });
      }
      return !n.isTextblock;
    });
    // Space between paragraphs an imported file keeps (8 pt after, say): one card each for after and before, whose fix
    // gives every such paragraph the format's.
    const entries = new Set(list ? tops.slice(list.from, list.to).map((t) => t.pos) : []), away = { after: [], before: [] };
    doc.descendants((n, pos, parent) => {
      if (!n.isTextblock) return true;
      const set = entries.has(pos) ? f.list : parent.type.name === 'blockquote' ? f.quote : f;
      if (n.attrs.after != null && n.attrs.after !== set.after) away.after.push(pos);
      if (n.attrs.before) away.before.push(pos);
      return false;
    });
    if (away.after.length) add('font', 'paragraph-space', away.after[0] + 1, away.after[0] + 1, f.after === 0 ? 'Paragraphs have no space after them' : 'Space after paragraphs differs from the format', { fix: { op: 'clear', key: 'after', at: away.after } });
    if (away.before.length) add('font', 'paragraph-space-before', away.before[0] + 1, away.before[0] + 1, 'Paragraphs have no space before them', { fix: { op: 'clear', key: 'before', at: away.before } });

    // Quotes long enough to be block quotes, and in-text citations' shape.
    const lines = o.lines || ((from, to) => estimate(doc.textBetween(from, to, ' ')));
    for (const t of tops) {
      if (t.node.type.name !== 'paragraph' || (list && t.index >= list.title) || (open && t.index < open.end)) continue;
      const s = t.node.textContent, base = t.pos + 1;
      for (const m of quotes(s)) {
        const from = base + m.index, to = from + m.length, inner = m.inner;
        const byWords = f.quote.words && words(inner) >= f.quote.words;
        const long = (f.quote.lines && lines(from, to) >= f.quote.lines + (cite === 'mla' ? 1 : 0)) || byWords;
        if (long) add('citations', 'block-quote', from, to, cite === 'chicago' && !byWords ? 'Quotes of five lines or more go in a block quote' : f.quote.words && cite !== 'mla' ? 'Quotes of {n} words or more go in a block quote' : 'Quotes over four lines go in a block quote', { vars: { n: f.quote.words }, fix: { op: 'block-quote', from, to } });
      }
      if (cite === 'mla') {
        for (const m of s.matchAll(/\(([A-Z][\p{L}\p{M}'’.-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}\p{M}'’.-]+|\s+et al\.)?),\s*(?:p{1,2}\.\s*)?(\d+(?:\s*[-–]\s*\d+)?)\)/gu)) {
          const from = base + m.index;
          add('citations', 'cite-shape', from, from + m[0].length, 'MLA citation', { suggestions: [`(${m[1]} ${m[2].replace(/\s+/g, '')})`] });
        }
      } else if (cite === 'apa') {
        for (const m of s.matchAll(/\(([A-Z][\p{L}\p{M}'’.-]+(?:\s+(?:and|&)\s+[A-Z][\p{L}\p{M}'’.-]+|\s+et al\.)?)\s+((?:19|20)\d{2}[a-z]?)\)/gu)) {
          const from = base + m.index;
          add('citations', 'cite-shape', from, from + m[0].length, 'APA citation', { suggestions: [`(${m[1]}, ${m[2]})`] });
        }
      } else if (cite === 'chicago') {
        for (const m of s.matchAll(/\(([A-Z][\p{L}\p{M}'’.-]+(?:\s+et al\.)?),?\s+(\d+(?:\s*[-–]\s*\d+)?)\)/gu)) {
          const from = base + m.index;
          add('citations', 'cite-note', from, from + m[0].length, 'Chicago cites in footnotes', { fix: { op: 'to-note', from, to: from + m[0].length, note: `${m[1]}, ${m[2]}.` } });
        }
      }
    }

    // APA headings follow their level's style: one set by hand differently is flagged.
    if (cite === 'apa') {
      doc.descendants((n, pos) => {
        if (n.type.name === 'heading') {
          const want = f.headings[n.attrs.level - 1];
          if (want && n.attrs.align && n.attrs.align !== want.align) add('headings', 'heading-align', pos + 1, pos + n.nodeSize - 1, want.align === 'center' ? 'Level {n} headings are centered' : 'Level {n} headings are flush left', { vars: { n: n.attrs.level }, fix: { op: 'attr', key: 'align', value: null, at: pos } });
        }
        return !n.isTextblock;
      });
    }

    // The list page
    if (!list) add('list', 'list-missing', end, end, 'Add a {title} page', { vars: { title: f.list.title }, fix: { op: 'list-add' } });
    else {
      const t = tops[list.title], s = span(t);
      if (t.node.textContent.trim() !== f.list.title) add('list', 'list-title', s.from, s.to, 'This format calls it {title}', { vars: { title: f.list.title }, suggestions: [f.list.title] });
      if (tops[list.title - 1]?.node.type.name !== 'page_break') add('list', 'list-page', s.from, s.to, '{title} starts on a new page', { vars: { title: f.list.title }, fix: { op: 'page-break', at: t.pos } });
      const entries = tops.slice(list.from, list.to).filter((x) => x.node.textContent.trim());
      const flat = entries.filter((x) => x.node.attrs.first != null && x.node.attrs.first >= 0);
      if (flat.length) add('list', 'list-hanging', flat[0].pos + 1, flat.at(-1).pos + flat.at(-1).node.nodeSize - 1, 'Entries take a hanging indent', { fix: { op: 'hanging', at: flat.map((x) => x.pos) } });
      const keys = entries.map((x) => x.node.textContent.trim().replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase());
      if (keys.some((k, i) => i && k.localeCompare(keys[i - 1]) < 0)) add('list', 'list-order', entries[0].pos + 1, entries.at(-1).pos + entries.at(-1).node.nodeSize - 1, 'Entries go in alphabetical order', { fix: { op: 'sort', from: list.from, to: list.to } });
      const bold = t.node.content.content.some((c) => c.isText) && t.node.content.content.every((c) => !c.isText || c.marks.some((m) => m.type.name === 'bold'));
      if (f.list.bold && !bold) add('list', 'list-bold', s.from, s.to, '{title} is bold', { vars: { title: f.list.title }, fix: { op: 'mark', mark: 'bold' } });
      if (!f.list.bold && bold) add('list', 'list-plain', s.from, s.to, "{title} isn't bold", { vars: { title: f.list.title }, fix: { op: 'unmark', mark: 'bold' } });
    }


    if (o.keep) for (let k = issues.length - 1; k >= 0; k--) if (KEPT.has(issues[k].rule) && issues[k].fix?.op !== 'format') issues.splice(k, 1);
    const rows = ROWS[cite].map(([id, label]) => ({ id, label, count: issues.filter((x) => x.row === id).length }));
    return { issues, rows };
  };

  // The Outline: the paper's title (as read() finds it), its headings, and its list of sources, in order. doc: a paper
  // Node. → [{ kind: 'title' | 'heading' | 'list', level (headings' 1-4, else 0), text, pos (where the block starts) }]
  const outline = (doc, f) => {
    const top = [];
    doc.forEach((n, pos) => top.push(pos));
    const title = read(doc, f)?.at?.title, list = ST().listAt(doc), out = [];
    doc.descendants((n, pos) => {
      if (n.type.name === 'heading' && n.textContent.trim()) out.push({ kind: 'heading', level: n.attrs.level, text: n.textContent.trim(), pos });
      return !n.isTextblock;
    });
    for (const [kind, i] of [['title', title], ['list', list?.title]]) {
      const n = Number.isInteger(i) && doc.child(i);
      if (n && n.textContent.trim()) out.push({ kind, level: 0, text: n.textContent.trim(), pos: top[i] });
    }
    return out.sort((a, b) => a.pos - b.pos);
  };

  // The paper to its format: an imported file's page, base font and paragraph spacing and line heights left to the format
  // (indents and tabs are the text's own). JSON in, JSON out.
  const apply = (doc) => {
    const json = JSON.parse(JSON.stringify(doc.toJSON ? doc.toJSON() : doc));
    const walk = (n) => { if (n.attrs) for (const k of ['line', 'exact', 'least', 'before', 'after']) if (k in n.attrs) n.attrs[k] = null; (n.content || []).forEach(walk); };
    (json.content || []).forEach(walk);
    return { ...json, attrs: { ...json.attrs, setup: null } };
  };

  return { template, opening, closing, read, surname, restyle, check, outline, apply, KEPT, DATE };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_FORMAT; else GZ_WRITER_FORMAT;
