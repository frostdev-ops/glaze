// Glaze Writer's pages: the paper's text flows across real Letter pages. The editor is one column as wide as the page's
// text; this measures its line boxes and puts page-gap widgets where a page ends (between blocks, or at the start of a
// line inside one), so the next line starts at the next page's top margin. It works as Word does: a line fits while its
// text is inside the page's text area (multiple spacing's extra space below it may hang into the margin, slack), 2-line widow and orphan control (unless a paragraph turns it off), headings and
// paragraphs set to keep with the next one kept with it, lines kept together, a page break before a block that has one,
// space between paragraphs the larger of one's after and the next's before (none before at the top of a page after the
// first), and footnotes at the foot of the page their reference is on.
// Incremental: a block's lines are measured once per version of it (ProseMirror reuses unchanged nodes), so an edit
// measures only the blocks it touched; the plan over all of them is arithmetic.
// plan() is pure (node tests); plugin() needs a page. Classic script after lib/pm.js and lib/writer-styles.js;
// module.exports for node.
var GZ_WRITER_PAGINATE = globalThis.GZ_WRITER_PAGINATE || (() => {
  const ST = () => (typeof GZ_WRITER_STYLES !== 'undefined' ? GZ_WRITER_STYLES : require('./writer-styles.js'));

  // ---- the plan
  // blocks: in document order, { kind: 'text' | 'break' | 'atom', lines: [{ h, slack, notes: [index] }], after, before, keepNext,
  // keepLines, widow (false: off) }.
  // geo: { body (the text area's height), stride (a page plus the gap after it), notes: [height by note index], sep (the
  // separator over a page's notes) }. → { pages: [{ notes: [index] }], breaks: [{ b, l, gap }] }: before block b's line l
  // a gap of `gap` px takes the flow to the next page's top.
  const plan = (blocks, geo) => {
    const pages = [{ notes: [], fragments: [] }], breaks = [], pending = [];
    let y = 0, notesH = 0, force = 0;
    const page = () => pages.at(-1);
    const sep = geo.sep || 0, unit = geo.noteLine || 1;
    const slice = (id, from, height, total) => {
      if (!page().notes.includes(id)) page().notes.push(id);
      page().fragments.push({ id, from, height, total });
      notesH += height + (notesH ? 0 : sep);
    };
    const advance = (b, l, flow) => {
      if (flow) breaks.push({ b, l, gap: Math.max(0, geo.stride - y) });
      pages.push({ notes: [], fragments: [] }); y = 0; notesH = 0;
    };
    // starts: block b's line l starts the new page (false: the page stays empty, a page break after a page break).
    const next = (b, l, flow = true, starts = true) => {
      advance(b, l, flow);
      while (pending.length) {
        const n = pending[0], room = Math.floor((geo.body - notesH - (notesH ? 0 : sep)) / unit) * unit;
        // Not one line of it fits under the separator even on an empty page: one runs over, so every page takes some.
        const take = Math.min(n.total - n.from, Math.max(notesH ? 0 : unit, room));
        if (take) { slice(n.id, n.from, take, n.total); n.from += take; }
        if (n.from >= n.total) pending.shift();
        if (pending.length || (flow && notesH + (blocks[b]?.lines[l]?.h || 0) > geo.body)) advance(b, l, flow);
      }
      // A block starting a page has no space before: its margin goes into the gap.
      if (starts && flow && l === 0 && blocks[b]?.before) breaks.at(-1).gap = Math.max(0, breaks.at(-1).gap - blocks[b].before);
    };
    const noteH = (ids) => ids.reduce((n, i) => n + (geo.notes?.[i] || 0), 0);
    // How many of b's lines from i fit on this page.
    const fit = (b, i) => {
      if (pending.length) return 0;
      let k = 0, yy = y, nh = notesH;
      while (i + k < b.lines.length) {
        const L = b.lines[i + k], add = L.notes?.length ? Math.min(noteH(L.notes), Math.max(0, geo.body - L.h - sep)) + (nh ? 0 : sep) : 0;
        if (yy + L.h - (L.slack || 0) > geo.body - nh - add + 0.01) break;
        yy += L.h; nh += add; k++;
      }
      return k;
    };
    const place = (b, i, k) => {
      for (let j = i; j < i + k; j++) {
        const L = b.lines[j];
        if (L.notes?.length) for (const id of L.notes) {
          const total = geo.notes?.[id] || 0, room = Math.max(0, geo.body - y - L.h - notesH - (notesH ? 0 : sep));
          const take = total <= room ? total : Math.floor(room / unit) * unit;
          if (take) slice(id, 0, take, total);
          if (take < total) pending.push({ id, from: take, total });
        }
        y += L.h;
      }
    };
    // Lines of a block that must stay together at its start: two, or all of a shorter one (orphan control).
    const head = (b) => (b.lines.length <= 2 ? b.lines.length : 2);
    let after = 0;
    blocks.forEach((b, bi) => {
      if (b.kind === 'break') { force++; return; }
      const n = b.lines.length;
      // Each page break after the first in a row leaves an empty page.
      if (force && y > 0) next(bi, 0, true, force === 1);
      for (; force > 1; force--) next(bi, 0, true, force === 2);
      force = 0;
      // Space before, where it is more than the space after the block above (already counted).
      const before = () => { if (y > 0 || pages.length === 1) y += Math.max(0, (b.before || 0) - (y > 0 ? after : 0)); };
      const top = y;
      before();
      // A heading with its next paragraph's first lines (a table's first row), where both fit on a page; lines kept
      // together, where they fit.
      if ((b.keepNext || b.keepLines) && top > 0) {
        const nb = blocks[bi + 1];
        if (fit(b, 0) < n) { y = top; next(bi, 0); }
        else if (b.keepNext && (nb?.kind === 'text' || nb?.kind === 'table')) {
          const save = { y, notesH, kept: page().notes.length, fragments: page().fragments.length, pending: pending.length };
          place(b, 0, n);
          y += Math.max(b.after, nb.before || 0);
          const ok = fit(nb, 0) >= (nb.kind === 'table' ? 1 : head(nb));
          y = save.y; notesH = save.notesH; page().notes.length = save.kept; page().fragments.length = save.fragments; pending.length = save.pending;
          if (!ok) { y = top; next(bi, 0); }
        }
      }
      let i = 0;
      while (i < n) {
        const k = fit(b, i);
        if (i + k >= n) { place(b, i, n - i); break; }
        let take = k;
        if (b.kind === 'text' && n > 1 && b.widow !== false) {
          if (i === 0 && take < head(b)) take = 0; // orphan: a paragraph's first line alone at a page's foot
          if (take > 0 && n - (i + take) === 1) take -= 1; // widow: its last line alone at the next page's top
          if (i === 0 && take < head(b)) take = 0;
        }
        if (take === 0 && y === 0) take = Math.max(1, k); // nothing fits even on an empty page: it runs over
        if (take === 0) { if (i === 0) y = top; next(bi, i); continue; }
        place(b, i, take);
        i += take;
        if (i < n) next(bi, i);
      }
      y += b.after;
      after = b.after;
    });
    if (pending.length) next(0, 0, false);
    return { pages, breaks };
  };

  // ---- the editor side
  const PM = () => GZ_PM;
  const key = () => (key.k ||= new (PM().state.PluginKey)('gz-paginate'));
  const gapDOM = (inline, h, cols = 0) => () => {
    const e = document.createElement(cols ? 'tr' : inline ? 'span' : 'div');
    if (cols) { const cell = document.createElement('td'); cell.colSpan = cols; cell.style.height = `${h}px`; e.append(cell); }
    e.className = cols ? 'gp-gap gp-gap-row' : inline ? 'gp-gap gp-gap-line' : 'gp-gap';
    e.style.height = `${h}px`;
    e.setAttribute('aria-hidden', 'true');
    return e;
  };

  // The blocks pagination walks, with where each sits: textblocks, page breaks, horizontal lines, and tables (one
  // unbreakable block).
  const walk = (doc, f) => {
    const out = [], list = ST().listAt(doc);
    let note = 0;
    doc.forEach((top, offset, index) => {
      const entry = list && index >= list.from && index < list.to;
      const visit = (node, pos, where) => {
        if (node.type.name === 'page_break') { out.push({ kind: 'break', node, pos }); return; }
        if (node.type.name === 'horizontal_rule') { out.push({ kind: 'atom', node, pos, where, note }); return; }
        if (node.type.name === 'table') { out.push({ kind: 'table', node, pos, where, note }); node.descendants((n) => { if (n.type.name === 'footnote_ref') note++; }); return; }
        if (node.isTextblock) {
          const first = note;
          node.forEach((c) => { if (c.type.name === 'footnote_ref') note++; });
          out.push({ kind: 'text', node, pos, where, note: first, keepNext: node.type.name === 'heading' || !!node.attrs.keepNext, keepLines: !!node.attrs.keepLines, widow: node.attrs.widow });
          return;
        }
        node.forEach((c, off) => visit(c, pos + 1 + off, { ...where, quote: where.quote || node.type.name === 'blockquote' }));
      };
      visit(top, offset, { entry });
    });
    return out;
  };

  // The first of the offsets lo…hi-1 whose top (topOf) is at or below a line's top, hi if none: a text node's characters
  // only go down the page.
  const firstOn = (lo, hi, topOf, top) => {
    while (lo < hi) { const mid = (lo + hi) >> 1; if (topOf(mid) < top - 2) lo = mid + 1; else hi = mid; }
    return lo;
  };
  // Where each DOM text node and inline atom of a textblock starts, from its content's start, read from ProseMirror's own
  // view of the block (its descs and their sizes: no lookup across the document) → Map, or null if the view isn't one.
  const startsOf = (dom, node) => {
    let d = dom?.pmViewDesc;
    if (!d && dom?.parentNode?.pmViewDesc?.nodeDOM === dom) d = dom.parentNode.pmViewDesc;
    if (!d || d.node !== node || !Array.isArray(d.children)) return null;
    const map = new Map();
    const visit = (x, at) => {
      for (const c of x.children) {
        const size = c.size;
        if (c.widget) { /* a widget (a page gap, a ghost completion) holds no position */ }
        else if (c.node?.isText) map.set(c.nodeDOM || c.dom, at);
        else if (c.node) { map.set(c.dom, at); if (c.nodeDOM) map.set(c.nodeDOM, at); } // a picture, a note mark, a line break
        else if (c.children?.length) visit(c, at); // a mark
        else if (c.dom) map.set(c.dom, at); // ProseMirror's own break after a last line break
        at += size;
      }
    };
    try { visit(d, 0); } catch { return null; }
    return map;
  };
  // A line's first position from the block's content start: its leftmost fragment's text node or atom (an atom's own text,
  // a note mark's number, is the atom's), the character there found by halving the text node when the line starts inside
  // it. null where nothing on the line has a place (a widget's text alone).
  const lineStart = (g, starts, dom, range) => {
    let best = null, place = null;
    for (const r of g.frags) {
      let e = r.node;
      while (e && e !== dom && !starts.has(e)) e = e.parentNode;
      if (!e || e === dom || (best && r.left >= best.left)) continue;
      best = r; place = e;
    }
    if (!best) return null;
    const at = starts.get(place);
    if (place !== best.node || !best.k) return at;
    const n = best.node;
    return at + firstOn(0, n.nodeValue.length, (o) => { range.setStart(n, o); range.setEnd(n, o + 1); const r = range.getBoundingClientRect(); return r.height ? r.top : -Infinity; }, g.top);
  };

  // A textblock's lines as the browser laid them out, less any page gaps in it: { lines: [{ h, at, notes }], after }.
  // at: the line's first position, from the block's content start. scale: the zoom (rects are scaled, layout isn't).
  // legacy: each line's start from ProseMirror's posAtCoords (checks compare the two).
  const measure = (view, blk, f, scale, legacy = false) => {
    const dom = view.nodeDOM(blk.pos), box = ST().blockBox(f, blk.node.attrs, blk.where);
    if (!dom || dom.nodeType !== 1) return { lines: [{ h: box.line, at: 0, notes: [] }], after: box.after, before: box.before };
    if (blk.kind === 'table') {
      const rows = [...dom.querySelectorAll('tr')].filter((r) => !r.classList.contains('gp-gap-row') && r.closest('table') === (dom.matches('table') ? dom : dom.querySelector('table')));
      const lines = []; let note = blk.note, until = 0;
      blk.node.forEach((row, off, i) => {
        const refs = []; row.descendants((n) => { if (n.type.name === 'footnote_ref') refs.push(note++); });
        let span = 1; row.forEach((c) => { span = Math.max(span, c.attrs.rowspan || 1); });
        const h = rows[i]?.getBoundingClientRect().height / scale || box.line;
        if (i < until && lines.length) { lines.at(-1).h += h; lines.at(-1).notes.push(...refs); }
        else lines.push({ h, at: off, notes: refs });
        until = Math.max(until, i + span);
      });
      return { lines, after: 0 };
    }
    if (blk.kind === 'atom') {
      const r = dom.getBoundingClientRect(), count = dom.querySelectorAll('sup.gz-footnote').length;
      const notes = Array.from({ length: count }, (_, i) => blk.note + i);
      return { lines: [{ h: r.height / scale, at: 0, notes }], after: 0 };
    }
    // Every text fragment and inline atom (picture, note mark, line break: an empty line has only that), grouped into
    // lines by where they sit.
    const frags = [], range = document.createRange();
    const tw = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && n.classList?.contains('gp-gap') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) { if (!n.nodeValue) continue; range.selectNodeContents(n); let k = 0; for (const r of range.getClientRects()) { if (r.height) frags.push({ top: r.top, bottom: r.bottom, left: r.left, node: n, k }); k++; } }
      else if (n.nodeName === 'IMG' || n.nodeName === 'BR' || (n.nodeName === 'SUP' && n.classList.contains('gz-footnote'))) { const r = n.getBoundingClientRect(); if (r.height) frags.push({ top: r.top, bottom: r.bottom, left: r.left, el: n, node: n }); }
    }
    frags.sort((a, b) => a.top - b.top || a.left - b.left);
    const groups = [];
    for (const r of frags) {
      const g = groups.at(-1);
      if (g && r.top < g.bottom - 2) { g.bottom = Math.max(g.bottom, r.bottom); g.top = Math.min(g.top, r.top); g.left = Math.min(g.left, r.left); g.frags.push(r); }
      else groups.push({ top: r.top, bottom: r.bottom, left: r.left, frags: [r] });
    }
    const n = Math.max(1, groups.length), rect = dom.getBoundingClientRect();
    let gaps = 0;
    for (const g of dom.querySelectorAll('.gp-gap')) gaps += g.getBoundingClientRect().height / scale;
    const natural = rect.height / scale - gaps; // space before and after are margins, outside it
    const lines = Array.from({ length: n }, () => ({ h: box.line, slack: box.slack, at: 0, notes: [] }));
    // Taller content (a picture, a bigger font) grows its line: the excess goes to the lines whose glyphs are tallest.
    const extra = natural - n * box.line;
    if (extra > 1 && groups.length) {
      const sizes = groups.map((g) => (g.bottom - g.top) / scale), avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const tall = sizes.map((s, i) => (s > avg * 1.25 ? i : -1)).filter((i) => i >= 0);
      const to = tall.length ? tall : [n - 1], sum = to.reduce((a, i) => a + sizes[i], 0);
      for (const i of to) lines[i].h += (extra * sizes[i]) / sum;
    }
    // Each later line's first position (lineStart); note marks by the line they sit on, numbered in document order.
    // ProseMirror's posAtCoords for it hit-tests the page and walks every block before this one, per line: quadratic
    // over a long paper (most of a 2,600-paragraph paper's layout). It stays where lineStart finds nothing, and for checks.
    // Bidi's visual left edge need not be its first logical character. Preserve the coordinate lookup for these
    // blocks (including explicit direction marks); halving logical offsets only works for left-to-right text.
    const visual = blk.node.attrs.dir === 'rtl' || /[\u0590-\u08ff\u200e\u200f\u202a-\u202e\u2066-\u2069\ufb1d-\ufdff\ufe70-\ufefc\u{10800}-\u{10fff}\u{1e800}-\u{1eeff}]/u.test(blk.node.textContent) || dom.querySelector('[dir="rtl"]');
    const start = blk.pos + 1, starts = !legacy && !visual && groups.length > 1 ? startsOf(dom, blk.node) : null;
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i];
      let at = starts ? lineStart(g, starts, dom, range) : null;
      if (at == null) {
        // ProseMirror's coordinate lookup scans every character of a text node. Repeating it for
        // each line of a huge paragraph becomes quadratic; binary caret search stays bounded.
        const hit = blk.node.content.size <= 2048 ? view.posAtCoords({ left: g.left + 1, top: (g.top + Math.min(g.bottom, g.top + 12 * scale)) / 2 + 1 }) : null;
        let pos = hit ? hit.pos : null;
        if (pos == null || pos <= start || pos >= blk.pos + blk.node.nodeSize - 1) {
          // posAtCoords missed: the first position whose caret sits at or below the line's top.
          pos = firstOn(start, blk.pos + blk.node.nodeSize - 1, (q) => { try { return view.coordsAtPos(q, 1).top; } catch { return -Infinity; } }, g.top);
        }
        at = pos - start;
      }
      lines[i].at = Math.min(blk.node.content.size, Math.max(lines[i - 1].at + 1, at));
    }
    let k = 0;
    groups.forEach((g, i) => { for (const r of g.frags) if (r.el?.nodeName === 'SUP') lines[i].notes.push(blk.note + k++); });
    return { lines, after: box.after, before: box.before };
  };

  // A paragraph's tabs where Word's stops differ from the page's default ones (CSS tab-size): its own left, centre, right
  // and decimal stops (measured from the margin; default stops go on after the last of them), and a hanging indent's
  // stop at the left indent. → [{ pos, w (px), leader, node }]: each tab's width, from where it starts on its line and
  // the text after it (up to the next tab, or a decimal point), corrected for the tabs before it on the line.
  const sizeTabs = (view, blocks, f, scale, applied = new Map()) => {
    const out = [], left = view.dom.getBoundingClientRect().left, unit = (f.tab || 0.5) * 96;
    const at = (q, side) => { try { return view.coordsAtPos(q, side); } catch { return null; } };
    for (const b of blocks) {
      const a = b.node?.attrs;
      if (b.kind !== 'text' || !(a.tabs?.length || a.left != null || (a.first ?? 0) < 0) || !b.node.textContent.includes('\t')) continue;
      const stops = (a.tabs || []).map(([pos, kind, leader]) => [pos * 96, kind, leader]);
      const indent = ((b.where?.quote ? f.quote.indent : 0) + (a.left ?? (a.indent || 0) * 0.5)) * 96;
      if ((a.first ?? 0) < 0) stops.push([indent, 'l']);
      stops.sort((x, y) => x[0] - y[0]);
      const last = a.tabs?.length ? a.tabs.at(-1)[0] * 96 : 0, start = b.pos + 1, text = b.node.textBetween(0, b.node.content.size, '\u0000', '\u0000');
      // A sized tab's start is its own box's (carets at its edges aren't reliable); an unsized one's, its caret's.
      const boxes = [...(view.nodeDOM(b.pos)?.querySelectorAll?.('.gp-tabstop') || [])];
      let line = null, shift = 0, k = 0;
      for (let i = text.indexOf('\t'); i >= 0; i = text.indexOf('\t', i + 1)) {
        const q = start + i, box = applied.has(q) ? boxes[k++]?.getBoundingClientRect() : null, s0 = box || at(q, 1), e0 = box ? { left: box.right } : at(q + 1, -1);
        if (!s0 || !e0) continue;
        if (line == null || Math.abs(s0.top - line) > 3) { line = s0.top; shift = 0; }
        const x = (s0.left - left) / scale + shift, cur = applied.get(q) ?? Math.max(0, (e0.left - s0.left) / scale);
        const next = text.indexOf('\t', i + 1), seg = text.slice(i + 1, next < 0 ? text.length : next);
        const stop = stops.find(([pos]) => pos > x + 0.5) || [Math.floor(Math.max(x, last) / unit + 1) * unit, 'l'];
        let w = 0, fieldEnd = null;
        if (stop[1] !== 'l' && seg) {
          const upto = stop[1] === 'd' && seg.includes('.') ? seg.indexOf('.') : seg.length, c1 = at(q + 1, 1), c2 = at(q + 1 + upto, -1);
          if (c1 && c2 && Math.abs(c2.top - c1.top) < 3) w = (c2.left - c1.left) / scale;
          const end = start + (next < 0 ? text.length : next), tail = at(end, -1);
          // Short fields align as a unit. A field spanning lines (or wider than the body after an edit) must still wrap.
          if (c1 && tail && Math.abs(tail.top - c1.top) < 3 && tail.left - c1.left <= view.dom.getBoundingClientRect().width) fieldEnd = end;
        }
        const width = Math.max(0, (stop[1] === 'c' ? stop[0] - w / 2 : stop[1] === 'l' ? stop[0] : stop[0] - w) - x);
        shift += width - cur;
        out.push({ pos: q, w: Math.round(width * 10) / 10, leader: stop[2] || '', end: fieldEnd, edge: next < 0, node: b.node });
      }
    }
    return out;
  };

  // A plan over a layout's first k blocks (the rest not yet measured) → the part of it later blocks can't change: the
  // breaks decided before its last block (whose keep-with-next and widow lines look one block on) and the pages up to
  // the one after the last of them, which is still filling.
  const settled = (p, k) => {
    const breaks = p.breaks.filter((br) => br.b < k - 1);
    return { pages: p.pages.slice(0, breaks.length + 1), breaks };
  };
  // A layout measures for SLICE ms at most in one turn, then goes on in the next (a task of its own: the browser draws
  // and takes keys between them), drawing its settled pages as it goes: at once, then every SHOW ms (each drawing moves
  // every line after it, which a browser with accessibility on takes half a second to follow on a 2,600-paragraph paper).
  const SLICE = 12, SHOW = 1000, FONT_WAIT = 3000;
  const clock = () => (globalThis.performance?.now ? performance.now() : Date.now());
  const soon = (fn) => {
    if (typeof MessageChannel === 'function') { const c = new MessageChannel(); c.port1.onmessage = () => { c.port1.close(); fn(); }; c.port2.postMessage(0); return () => { c.port1.onmessage = null; c.port1.close(); }; }
    const t = setTimeout(fn, 0);
    return () => clearTimeout(t);
  };

  // opts: { format() → the paper's format, notes(contents) → [height px] (writer-paper.js measures them as the page draws
  // them), onLayout({ pages, breaks, blocks, partial }), paused() (true: no pages are shown, nothing is measured;
  // relayout() once they are) }. The plugin's state is its gaps; its view measures and re-plans after each change, in a
  // microtask (before the frame paints, so nothing jumps), never while an input method composes nor while the page's
  // fonts load. What one turn can't measure goes on in slices (SLICE): onLayout hears partial: true with the settled pages
  // until the whole is laid out. view.dom: gzLaying while slices go on, gzLaid the document last laid out whole.
  const plugin = (opts) => {
    const { Plugin } = PM().state, { Decoration, DecorationSet } = PM().view;
    let cache = new WeakMap(), version = 0;
    return new Plugin({
      key: key(),
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const meta = tr.getMeta(key());
          if (meta) return meta;
          if (!tr.docChanged) return set;
          set = set.map(tr.mapping, tr.doc);
          // A gap inside a block that changed may no longer be at a line's start: it goes until the next plan.
          const drop = [];
          tr.mapping.maps.forEach((map, i) => map.forEach((_a, _b, from, to) => {
            const m = tr.mapping.slice(i + 1), a = m.map(from, -1), b = m.map(to, 1);
            tr.doc.nodesBetween(Math.max(0, a), Math.min(tr.doc.content.size, b), (n, pos) => { if (n.isTextblock) { drop.push(...set.find(pos + 1, pos + n.nodeSize - 1, (s) => s.inline)); return false; } return true; });
          }));
          return drop.length ? set.remove(drop) : set;
        },
      },
      props: { decorations: (state) => key().getState(state) },
      view(view) {
        let queued = false, dead = false, last = '', tabSig = '', tabDecos = [], passes = 0, seen = null;
        let later = null, shown = 0, own = false, waiting = null, since = null, walked = null, noted = null;
        const settle = (laying) => { if (later) { later(); later = null; } view.dom.gzLaying = laying; if (!laying) shown = 0; };
        const geoOf = (f, notes) => ({ body: ST().geometry(f).body, stride: ST().geometry(f).height + (opts.gap || 0), notes, sep: notes.length ? ST().lineHeight(f, { line: 1 }) : 0, noteLine: ST().lineHeight(f, { size: f.notes.size, line: f.notes.line }) });
        const contentsOf = (doc) => {
          if (noted?.doc !== doc) { const contents = []; doc.descendants((n) => { if (n.type.name === 'footnote_ref') contents.push(n.attrs.content || ''); }); noted = { doc, contents }; }
          return noted.contents;
        };
        const gapsOf = (p, blocks) => p.breaks.map((br, index) => {
          const b = blocks[br.b], gap = Math.round(br.gap * 1000) / 1000;
          if (br.l === 0) return Decoration.widget(b.pos, gapDOM(false, gap), { side: -1, key: `gp:b:${index}:${gap}`, ignoreSelection: true });
          return Decoration.widget(b.pos + 1 + b.lines[br.l].at, gapDOM(true, gap, b.kind === 'table' ? b.node.firstChild.content.content.reduce((n, c) => n + (c.attrs.colspan || 1), 0) : 0), { side: -1, key: `gp:l:${index}:${gap}`, inline: true, ignoreSelection: true, marks: [] });
        });
        const sigOf = (p, blocks) => p.breaks.map((br) => `${blocks[br.b].pos}:${br.l}:${br.l ? blocks[br.b].lines[br.l].at : 0}:${Math.round(br.gap * 100)}`).join('|');
        const scaleOf = (rect) => {
          // offsetHeight rounds a many-page flow to an integer; using it as the zoom accumulates page-position error.
          const width = parseFloat(getComputedStyle(view.dom).width);
          return rect.width && width ? rect.width / width : 1;
        };
        const run = () => {
          queued = false;
          if (dead || !view.dom.isConnected || opts.paused?.()) { settle(false); return; }
          if (view.composing) { view.dom.addEventListener('compositionend', () => schedule(), { once: true }); return; }
          const f = opts.format(view.state.doc), rect = view.dom.getBoundingClientRect(), scale = scaleOf(rect);
          // The page's fonts still on their way (the layout just read asked for them): lines measured now would be a
          // fallback font's, all measured again once they land (fonts, below). Wait for them, as long as the browser
          // holds back their text (once while they load: a font that never comes waits no further).
          if (document.fonts?.status !== 'loading') since = null;
          else if (clock() - (since ??= clock()) < FONT_WAIT) {
            waiting ||= Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, FONT_WAIT))]).then(() => { waiting = null; schedule(); });
            view.dom.gzFontWaits = (view.dom.gzFontWaits || 0) + 1;
            return;
          }
          const doc = view.state.doc;
          if (walked?.doc !== doc) walked = { doc, blocks: walk(doc, f) };
          const blocks = walked.blocks;
          const cached = (b) => {
            const hit = cache.get(b.node);
            return hit && hit.v === version && hit.note === b.note && hit.quote === !!b.where?.quote && hit.entry === !!b.where?.entry ? hit : null;
          };
          // A font or geometry change invalidates line starts. Measuring around an old inline gap would keep that
          // artificial wrap forever, so let the view remove it before reading the block's natural lines again.
          // (Both lists are in document order: one pass over them.)
          const dirty = blocks.filter((b) => b.kind !== 'break' && !cached(b));
          const currentGaps = key().getState(view.state), stale = [];
          let j = 0;
          for (const d of currentGaps.find(undefined, undefined, (spec) => spec.inline).sort((x, y) => x.from - y.from)) {
            while (j < dirty.length && dirty[j].pos + dirty[j].node.nodeSize <= d.from) j++;
            if (j < dirty.length && d.from > dirty[j].pos && d.from < dirty[j].pos + dirty[j].node.nodeSize) stale.push(d);
          }
          if (stale.length) {
            view.dispatch(view.state.tr.setMeta(key(), currentGaps.remove(stale)).setMeta('addToHistory', false));
            schedule(); return;
          }
          // Tabs first: their widths change where lines break. A few passes settle tabs that move each other.
          if (seen !== doc) { seen = doc; passes = 0; }
          const applied = new Map(key().getState(view.state).find(undefined, undefined, (spec) => spec.tab).map((d) => [d.from, d.spec.w]));
          const want = passes < 4 ? sizeTabs(view, blocks, f, scale, applied) : null;
          const tsig = want ? want.map((t) => `${t.pos}:${t.w}:${t.leader}:${t.end}`).join('|') : tabSig;
          if (tsig !== tabSig) {
            passes++; tabSig = tsig;
            for (const t of want) cache.delete(t.node);
            tabDecos = want.flatMap((t) => [
              Decoration.inline(t.pos, t.pos + 1, { class: `gp-tabstop${t.leader ? ` gp-tabstop-${t.leader}` : ''}`, style: `width:${t.w}px` }, { tab: true, w: t.w }),
              // Word aligns a whole tab field, including a final decimal fraction that extends past the margin.
              // The final field has no following layout to advance; its text can hang past the right edge.
              ...(t.end > t.pos + 1 ? [Decoration.inline(t.pos + 1, t.end, { style: `display:inline-block;white-space:pre${t.edge ? ';width:0;overflow:visible' : ''}` }, { field: true })] : []),
            ]);
            const gaps = key().getState(view.state).find(undefined, undefined, (spec) => !spec.tab && !spec.field);
            view.dispatch(view.state.tr.setMeta(key(), DecorationSet.create(doc, [...gaps, ...tabDecos])).setMeta('addToHistory', false));
            schedule();
            return;
          }
          // In document order, SLICE ms of measuring at most (one block at least): k blocks are then known.
          const t0 = clock();
          let k = 0, fresh = 0;
          for (; k < blocks.length; k++) {
            const b = blocks[k];
            if (b.kind === 'break') { b.lines = []; b.after = 0; continue; }
            const hit = cached(b);
            if (hit) { b.lines = hit.lines; b.after = hit.after; b.before = hit.before; continue; }
            if (fresh && clock() - t0 > SLICE) break;
            const m = measure(view, b, f, scale);
            fresh++;
            view.dom.gzMeasured = (view.dom.gzMeasured || 0) + 1; // how many blocks were measured: checks see edits stay incremental
            cache.set(b.node, { ...m, v: version, note: b.note, quote: !!b.where?.quote, entry: !!b.where?.entry });
            b.lines = m.lines; b.after = m.after; b.before = m.before || 0;
          }
          const contents = contentsOf(doc);
          const notes = contents.length ? opts.notes(contents) : [];
          if (k < blocks.length) {
            // More to measure: the next slice in a turn of its own; the settled pages drawn now and then meanwhile.
            settle(true);
            later = soon(() => { later = null; schedule(); });
            if (shown && clock() - shown < SHOW) return;
            shown = clock();
            const part = blocks.slice(0, k), p = settled(plan(part, geoOf(f, notes)), k), sig = sigOf(p, part);
            if (sig !== last) {
              last = sig;
              own = true;
              try { view.dispatch(view.state.tr.setMeta(key(), DecorationSet.create(doc, [...gapsOf(p, part), ...tabDecos])).setMeta('addToHistory', false)); } finally { own = false; }
            }
            opts.onLayout?.({ pages: p.pages, breaks: p.breaks, blocks: part, notes: contents, partial: true });
            return;
          }
          settle(false);
          const p = plan(blocks, geoOf(f, notes)), decos = gapsOf(p, blocks), sig = sigOf(p, blocks);
          const current = key().getState(view.state);
          if (sig !== last || current.find().length !== decos.length + tabDecos.length) {
            last = sig;
            view.dispatch(view.state.tr.setMeta(key(), DecorationSet.create(doc, [...decos, ...tabDecos])).setMeta('addToHistory', false));
          }
          view.dom.gzLaid = doc;
          opts.onLayout?.({ pages: p.pages, breaks: p.breaks, blocks, notes: contents });
        };
        const schedule = () => { if (!queued) { queued = true; queueMicrotask(run); } };
        schedule();
        // The paper's own faces asked for now (even in the compact box), so the pages a switch shows don't wait for them.
        try { const f0 = opts.format(view.state.doc); for (const style of ['', 'bold ', 'italic ', 'italic bold ']) document.fonts?.load?.(`${style}${f0.size || 12}pt ${ST().stack(f0.font)}`)?.catch?.(() => {}); } catch { /* no font loading here */ }
        // Fonts arriving change every line's width: the first ones, and any a paper starts using later (an imported file's).
        const fonts = () => { cache = new WeakMap(); passes = 0; schedule(); };
        document.fonts?.ready?.then(fonts);
        document.fonts?.addEventListener?.('loadingdone', fonts);
        view.dom.gzRelayout = (all) => { if (all) { cache = new WeakMap(); passes = 0; version++; last = ''; } schedule(); };
        // The paper laid out whole in this turn, from scratch, its plan returned and nothing drawn (checks compare it with
        // the sliced layout); legacy: each line's start from ProseMirror's posAtCoords.
        view.dom.gzWhole = ({ legacy = false } = {}) => {
          const doc = view.state.doc, f = opts.format(doc), scale = scaleOf(view.dom.getBoundingClientRect()), blocks = walk(doc, f);
          for (const b of blocks) {
            if (b.kind === 'break') { b.lines = []; b.after = 0; continue; }
            const m = measure(view, b, f, scale, legacy);
            b.lines = m.lines; b.after = m.after; b.before = m.before || 0;
          }
          const contents = contentsOf(doc);
          return { ...plan(blocks, geoOf(f, contents.length ? opts.notes(contents) : [])), blocks };
        };
        return {
          update(v, prev) { if (v.state.doc !== prev.doc || (!own && key().getState(v.state) !== key().getState(prev))) schedule(); },
          destroy() { dead = true; settle(false); document.fonts?.removeEventListener?.('loadingdone', fonts); },
        };
      },
    });
  };
  // Re-measure everything (the format, zoom-independent geometry or fonts changed).
  const relayout = (view) => view?.dom?.gzRelayout?.(true);
  // The paper laid out whole, at once (plugin's gzWhole): { pages, breaks, blocks }, or null without a laid-out view.
  const whole = (view, o) => view?.dom?.gzWhole?.(o) || null;

  // Layout styling the schema's DOM can't carry: a block's own line spacing in px as Word counts it, a run in another font
  // or size with its own line height, and the list entries' class (the format's hanging indent and spacing).
  // format(doc): what the paper is laid out by, for the document being decorated (its setup is on it).
  const styler = (format) => {
    const { Plugin } = PM().state, { Decoration, DecorationSet } = PM().view;
    const build = (doc) => {
      const f = format(doc), out = [], list = ST().listAt(doc), entries = new Set();
      doc.forEach((top, offset, index) => {
        if (list && index >= list.from && index < list.to && top.type.name === 'paragraph') { entries.add(offset); out.push(Decoration.node(offset, offset + top.nodeSize, { class: 'gp-entry' })); }
      });
      doc.descendants((n, pos, parent) => {
        if (!n.isTextblock) return true;
        const quote = parent.type.name === 'blockquote', entry = entries.has(pos);
        const line = n.attrs.line ?? (entry ? f.list.line : quote ? f.quote.line : f.line), { exact, least } = n.attrs;
        if (n.attrs.line != null || exact != null || least != null) out.push(Decoration.node(pos, pos + n.nodeSize, { style: `line-height:${ST().blockBox(f, n.attrs, { quote, entry }).line}px` }));
        n.forEach((c, off) => {
          const st = c.marks.find((m) => m.type.name === 'text_style');
          if (c.isText && st && (st.attrs.size || st.attrs.font)) out.push(Decoration.inline(pos + 1 + off, pos + 1 + off + c.nodeSize, { style: `line-height:${ST().lineHeight(f, { line, exact, least, size: st.attrs.size || f.size, font: st.attrs.font || f.font })}px` }));
        });
        return false;
      });
      return DecorationSet.create(doc, out);
    };
    const k = new (PM().state.PluginKey)('gz-paper-style');
    return new Plugin({
      key: k,
      state: { init: (_, s) => build(s.doc), apply: (tr, set, _o, s) => (tr.docChanged || tr.getMeta(k) ? build(s.doc) : set) },
      props: { decorations: (s) => k.getState(s) },
    });
  };

  return { plan, settled, firstOn, startsOf, plugin, styler, relayout, whole, walk, key };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_PAGINATE; else GZ_WRITER_PAGINATE;
