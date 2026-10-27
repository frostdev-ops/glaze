// Glaze Writer's pages: the paper's text flows across real Letter pages. The editor is one column as wide as the page's
// text; this measures its line boxes and puts page-gap widgets where a page ends (between blocks, or at the start of a
// line inside one), so the next line starts at the next page's top margin. It works as Word does by default: a line fits
// while its bottom is inside the page's text area, 2-line widow and orphan control, headings kept with the next
// paragraph, a page break before a block that has one, and footnotes at the foot of the page their reference is on.
// Incremental: a block's lines are measured once per version of it (ProseMirror reuses unchanged nodes), so an edit
// measures only the blocks it touched; the plan over all of them is arithmetic.
// plan() is pure (node tests); plugin() needs a page. Classic script after lib/pm.js and lib/writer-styles.js;
// module.exports for node.
var GZ_WRITER_PAGINATE = globalThis.GZ_WRITER_PAGINATE || (() => {
  const ST = () => (typeof GZ_WRITER_STYLES !== 'undefined' ? GZ_WRITER_STYLES : require('./writer-styles.js'));

  // ---- the plan
  // blocks: in document order, { kind: 'text' | 'break' | 'atom', lines: [{ h, notes: [index] }], after, keepNext }.
  // geo: { body (the text area's height), stride (a page plus the gap after it), notes: [height by note index], sep (the
  // separator over a page's notes) }. → { pages: [{ notes: [index] }], breaks: [{ b, l, gap }] }: before block b's line l
  // a gap of `gap` px takes the flow to the next page's top.
  const plan = (blocks, geo) => {
    const pages = [{ notes: [] }], breaks = [];
    let y = 0, notesH = 0, force = false;
    const page = () => pages.at(-1);
    const next = (b, l) => {
      breaks.push({ b, l, gap: Math.max(0, geo.stride - y) });
      pages.push({ notes: [] });
      y = 0; notesH = 0;
    };
    const noteH = (ids) => ids.reduce((n, i) => n + (geo.notes?.[i] || 0), 0);
    // How many of b's lines from i fit on this page.
    const fit = (b, i) => {
      let k = 0, yy = y, nh = notesH;
      while (i + k < b.lines.length) {
        const L = b.lines[i + k], add = L.notes?.length ? noteH(L.notes) + (nh ? 0 : geo.sep || 0) : 0;
        if (yy + L.h > geo.body - nh - add + 0.01) break;
        yy += L.h; nh += add; k++;
      }
      return k;
    };
    const place = (b, i, k) => {
      for (let j = i; j < i + k; j++) {
        const L = b.lines[j];
        if (L.notes?.length) { notesH += noteH(L.notes) + (notesH ? 0 : geo.sep || 0); page().notes.push(...L.notes); }
        y += L.h;
      }
    };
    // Lines of a block that must stay together at its start: two, or all of a shorter one (orphan control).
    const head = (b) => (b.lines.length <= 2 ? b.lines.length : 2);
    blocks.forEach((b, bi) => {
      if (b.kind === 'break') { force = true; return; }
      const n = b.lines.length;
      if (force && y > 0) next(bi, 0);
      force = false;
      // A heading with its next paragraph's first lines, where both fit on a page.
      if (b.keepNext && y > 0) {
        const nb = blocks[bi + 1];
        if (fit(b, 0) < n) next(bi, 0);
        else if (nb?.kind === 'text') {
          const save = { y, notesH, kept: page().notes.length };
          place(b, 0, n);
          y += b.after;
          const ok = fit(nb, 0) >= head(nb);
          y = save.y; notesH = save.notesH; page().notes.length = save.kept;
          if (!ok) next(bi, 0);
        }
      }
      let i = 0;
      while (i < n) {
        const k = fit(b, i);
        if (i + k >= n) { place(b, i, n - i); break; }
        let take = k;
        if (b.kind === 'text' && n > 1) {
          if (i === 0 && take < head(b)) take = 0; // orphan: a paragraph's first line alone at a page's foot
          if (take > 0 && n - (i + take) === 1) take -= 1; // widow: its last line alone at the next page's top
          if (i === 0 && take < head(b)) take = 0;
        }
        if (take === 0 && y === 0) take = Math.max(1, k); // nothing fits even on an empty page: it runs over
        if (take === 0) { next(bi, i); continue; }
        place(b, i, take);
        i += take;
        if (i < n) next(bi, i);
      }
      y += b.after;
    });
    return { pages, breaks };
  };

  // ---- the editor side
  const PM = () => GZ_PM;
  const key = () => (key.k ||= new (PM().state.PluginKey)('gz-paginate'));
  const gapDOM = (inline, h) => () => {
    const e = document.createElement(inline ? 'span' : 'div');
    e.className = inline ? 'gp-gap gp-gap-line' : 'gp-gap';
    e.style.height = `${h}px`;
    e.setAttribute('aria-hidden', 'true');
    return e;
  };

  // The blocks pagination walks, with where each sits: textblocks, page breaks, and tables (one unbreakable block).
  const walk = (doc, f) => {
    const out = [], list = ST().listAt(doc);
    let note = 0;
    doc.forEach((top, offset, index) => {
      const entry = list && index >= list.from && index < list.to;
      const visit = (node, pos, where) => {
        if (node.type.name === 'page_break') { out.push({ kind: 'break', node, pos }); return; }
        if (node.type.name === 'table') { out.push({ kind: 'atom', node, pos, where, note }); node.descendants((n) => { if (n.type.name === 'footnote_ref') note++; }); return; }
        if (node.isTextblock) {
          const first = note;
          node.forEach((c) => { if (c.type.name === 'footnote_ref') note++; });
          out.push({ kind: 'text', node, pos, where, note: first, keepNext: node.type.name === 'heading' });
          return;
        }
        node.forEach((c, off) => visit(c, pos + 1 + off, { ...where, quote: where.quote || node.type.name === 'blockquote' }));
      };
      visit(top, offset, { entry });
    });
    return out;
  };

  // A textblock's lines as the browser laid them out, less any page gaps in it: { lines: [{ h, at, notes }], after }.
  // at: the line's first position, from the block's content start. scale: the zoom (rects are scaled, layout isn't).
  const measure = (view, blk, f, scale) => {
    const dom = view.nodeDOM(blk.pos), box = ST().blockBox(f, blk.node.attrs, blk.where);
    if (!dom || dom.nodeType !== 1) return { lines: [{ h: box.line, at: 0, notes: [] }], after: box.after };
    if (blk.kind === 'atom') {
      const r = dom.getBoundingClientRect(), count = dom.querySelectorAll('sup.gz-footnote').length;
      const notes = Array.from({ length: count }, (_, i) => blk.note + i);
      return { lines: [{ h: r.height / scale, at: 0, notes }], after: 0 };
    }
    // Every text fragment and inline atom (picture, note mark), grouped into lines by where they sit.
    const frags = [], range = document.createRange();
    const tw = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && n.classList?.contains('gp-gap') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) {
      if (n.nodeType === 3) { if (!n.nodeValue) continue; range.selectNodeContents(n); for (const r of range.getClientRects()) if (r.height) frags.push({ top: r.top, bottom: r.bottom, left: r.left }); }
      else if (n.nodeName === 'IMG' || (n.nodeName === 'SUP' && n.classList.contains('gz-footnote'))) { const r = n.getBoundingClientRect(); if (r.height) frags.push({ top: r.top, bottom: r.bottom, left: r.left, el: n }); }
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
    const natural = rect.height / scale - box.after - gaps;
    const lines = Array.from({ length: n }, () => ({ h: box.line, at: 0, notes: [] }));
    // Taller content (a picture, a bigger font) grows its line: the excess goes to the lines whose glyphs are tallest.
    const extra = natural - n * box.line;
    if (extra > 1 && groups.length) {
      const sizes = groups.map((g) => (g.bottom - g.top) / scale), avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const tall = sizes.map((s, i) => (s > avg * 1.25 ? i : -1)).filter((i) => i >= 0);
      const to = tall.length ? tall : [n - 1], sum = to.reduce((a, i) => a + sizes[i], 0);
      for (const i of to) lines[i].h += (extra * sizes[i]) / sum;
    }
    // Each later line's first position; note marks by the line they sit on, numbered in document order.
    const start = blk.pos + 1;
    for (let i = 1; i < groups.length; i++) {
      const g = groups[i], hit = view.posAtCoords({ left: g.left + 1, top: (g.top + Math.min(g.bottom, g.top + 12 * scale)) / 2 + 1 });
      let pos = hit ? hit.pos : null;
      if (pos == null || pos <= start || pos >= blk.pos + blk.node.nodeSize - 1) {
        // posAtCoords missed: the first position whose caret sits at or below the line's top.
        let lo = start, hi = blk.pos + blk.node.nodeSize - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; let t; try { t = view.coordsAtPos(mid, 1).top; } catch { t = -Infinity; } if (t < g.top - 2) lo = mid + 1; else hi = mid; }
        pos = lo;
      }
      lines[i].at = Math.max(lines[i - 1].at + 1, pos - start);
    }
    let k = 0;
    groups.forEach((g, i) => { for (const r of g.frags) if (r.el?.nodeName === 'SUP') lines[i].notes.push(blk.note + k++); });
    return { lines, after: box.after };
  };

  // opts: { format() → the paper's format, notes(contents) → [height px] (writer-paper.js measures them as the page draws
  // them), onLayout({ pages, breaks, blocks }) }. The plugin's state is its gaps; its view measures and re-plans after each
  // change, in a microtask (before the frame paints, so nothing jumps), never while an input method composes.
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
        let queued = false, dead = false, last = '';
        const run = () => {
          queued = false;
          if (dead || !view.dom.isConnected) return;
          if (view.composing) { view.dom.addEventListener('compositionend', () => schedule(), { once: true }); return; }
          const f = opts.format(), geo = ST().geometry(f), rect = view.dom.getBoundingClientRect();
          const scale = rect.height && view.dom.offsetHeight ? rect.height / view.dom.offsetHeight : 1;
          const doc = view.state.doc, blocks = walk(doc, f);
          for (const b of blocks) {
            if (b.kind === 'break') { b.lines = []; b.after = 0; continue; }
            const hit = cache.get(b.node);
            if (hit && hit.v === version && hit.note === b.note && hit.quote === !!b.where?.quote && hit.entry === !!b.where?.entry) { b.lines = hit.lines; b.after = hit.after; continue; }
            const m = measure(view, b, f, scale);
            view.dom.gzMeasured = (view.dom.gzMeasured || 0) + 1; // how many blocks were measured: checks see edits stay incremental
            cache.set(b.node, { ...m, v: version, note: b.note, quote: !!b.where?.quote, entry: !!b.where?.entry });
            b.lines = m.lines; b.after = m.after;
          }
          const contents = [];
          doc.descendants((n) => { if (n.type.name === 'footnote_ref') contents.push(n.attrs.content || ''); });
          const notes = contents.length ? opts.notes(contents) : [];
          const p = plan(blocks, { body: geo.body, stride: geo.height + (opts.gap || 0), notes, sep: notes.length ? ST().lineHeight(f, { line: 1 }) : 0 });
          const decos = p.breaks.map((br) => {
            const b = blocks[br.b], gap = Math.round(br.gap * 1000) / 1000;
            if (br.l === 0) return Decoration.widget(b.pos, gapDOM(false, gap), { side: -1, key: `gp:b:${gap}`, ignoreSelection: true });
            return Decoration.widget(b.pos + 1 + b.lines[br.l].at, gapDOM(true, gap), { side: -1, key: `gp:l:${gap}`, ignoreSelection: true, marks: [] });
          });
          const sig = p.breaks.map((br) => `${blocks[br.b].pos}:${br.l}:${br.l ? blocks[br.b].lines[br.l].at : 0}:${Math.round(br.gap * 100)}`).join('|');
          const current = key().getState(view.state);
          if (sig !== last || current.find().length !== decos.length) {
            last = sig;
            view.dispatch(view.state.tr.setMeta(key(), DecorationSet.create(doc, decos)).setMeta('addToHistory', false));
          }
          opts.onLayout?.({ pages: p.pages, breaks: p.breaks, blocks, notes: contents });
        };
        const schedule = () => { if (!queued) { queued = true; queueMicrotask(run); } };
        schedule();
        // Fonts arriving change every line's width.
        document.fonts?.ready?.then(() => { cache = new WeakMap(); schedule(); });
        view.dom.gzRelayout = (all) => { if (all) { cache = new WeakMap(); version++; last = ''; } schedule(); };
        return {
          update(v, prev) { if (v.state.doc !== prev.doc || key().getState(v.state) !== key().getState(prev)) schedule(); },
          destroy() { dead = true; },
        };
      },
    });
  };
  // Re-measure everything (the format, zoom-independent geometry or fonts changed).
  const relayout = (view) => view?.dom?.gzRelayout?.(true);

  // Layout styling the schema's DOM can't carry: a block's own line spacing in px as Word counts it, a run in another font
  // or size with its own line height, and the list entries' class (the format's hanging indent and spacing).
  const styler = (format) => {
    const { Plugin } = PM().state, { Decoration, DecorationSet } = PM().view;
    const build = (doc) => {
      const f = format(), out = [], list = ST().listAt(doc), entries = new Set();
      doc.forEach((top, offset, index) => {
        if (list && index >= list.from && index < list.to && top.type.name === 'paragraph') { entries.add(offset); out.push(Decoration.node(offset, offset + top.nodeSize, { class: 'gp-entry' })); }
      });
      doc.descendants((n, pos, parent) => {
        if (!n.isTextblock) return true;
        const quote = parent.type.name === 'blockquote', entry = entries.has(pos);
        const line = n.attrs.line ?? (entry ? f.list.line : quote ? f.quote.line : f.line);
        if (n.attrs.line != null) out.push(Decoration.node(pos, pos + n.nodeSize, { style: `line-height:${ST().blockBox(f, n.attrs, { quote, entry }).line}px` }));
        n.forEach((c, off) => {
          const st = c.marks.find((m) => m.type.name === 'text_style');
          if (c.isText && st && (st.attrs.size || st.attrs.font)) out.push(Decoration.inline(pos + 1 + off, pos + 1 + off + c.nodeSize, { style: `line-height:${ST().lineHeight(f, { line, size: st.attrs.size || f.size, font: st.attrs.font || f.font })}px` }));
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

  return { plan, plugin, styler, relayout, walk, key };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_PAGINATE; else GZ_WRITER_PAGINATE;
