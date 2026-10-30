// The PDF viewer's pages panel (pdf-kind.js): the pages as tiles to move (drag, or Move up and Move down), turn, delete,
// a blank page and another PDF's pages to add; Done applies them all at once (lib/pdf-doc.js bake: pdf.js's
// extractPages with the rotations patch) as one step a single Undo takes back. The reducer is pure: what the student
// does (reduce) → the state's tiles → one list of bake's page operations (toOps).
// Classic script; module.exports for node (start, reduce, toOps, changed).
var GZ_PDF_PAGES = globalThis.GZ_PDF_PAGES || (() => {
  const PAGES = 500, BYTES = 50e6; // lib/pdf-doc.js LIMITS.pages and .merged
  const fail = (name, message) => Object.assign(new Error(message), { name });

  // ---- the reducer. A tile: { id, source (0 the document, k the k-th merged file, 'blank'), page, turn (0 to 270, on top
  // of the page's own) }. merges[k - 1]: { pages, bytes, name }. bytes: the document's size, for the merge limit.
  const start = (count, { bytes = 0 } = {}) => ({ count, bytes, tiles: Array.from({ length: count }, (_, page) => ({ id: `0:${page}`, source: 0, page, turn: 0 })), merges: [], next: 0 });
  const inRange = (s, list) => Array.isArray(list) && list.length > 0 && list.every((i) => Number.isInteger(i) && i >= 0 && i < s.tiles.length);
  const reduce = (s, a) => {
    switch (a?.type) {
      case 'move': {
        const { from, to } = a;
        if (!inRange(s, [from, to]) || from === to) return s;
        const tiles = [...s.tiles], [t] = tiles.splice(from, 1);
        tiles.splice(to, 0, t);
        return { ...s, tiles };
      }
      case 'rotate': {
        if (!inRange(s, a.at) || !Number.isInteger(a.by) || a.by % 90 || !(a.by % 360)) return s;
        const turned = new Set(a.at);
        return { ...s, tiles: s.tiles.map((t, i) => (turned.has(i) ? { ...t, turn: (((t.turn + a.by) % 360) + 360) % 360 } : t)) };
      }
      case 'remove': {
        if (!inRange(s, a.at)) return s;
        const gone = new Set(a.at), tiles = s.tiles.filter((_, i) => !gone.has(i));
        return tiles.length ? { ...s, tiles } : s;
      }
      case 'blank': {
        const at = a.at ?? s.tiles.length;
        if (!Number.isInteger(at) || at < 0 || at > s.tiles.length) return s;
        if (s.tiles.length + 1 > PAGES) throw fail('PdfTooManyPagesError', `A PDF can have at most ${PAGES} pages.`);
        const tiles = [...s.tiles];
        tiles.splice(at, 0, { id: `b${s.next}`, source: 'blank', page: 0, turn: 0 });
        return { ...s, tiles, next: s.next + 1 };
      }
      case 'merge': {
        const at = a.at ?? s.tiles.length;
        if (!Number.isInteger(at) || at < 0 || at > s.tiles.length || !Number.isInteger(a.pages) || a.pages < 1) return s;
        if (s.tiles.length + a.pages > PAGES) throw fail('PdfTooManyPagesError', `A PDF can have at most ${PAGES} pages.`);
        if (s.merges.reduce((n, m) => n + m.bytes.length, s.bytes) + a.bytes.length > BYTES) throw fail('PdfTooLargeError', 'The PDF inputs exceed 50 MB.');
        const k = s.merges.length + 1, tiles = [...s.tiles];
        tiles.splice(at, 0, ...Array.from({ length: a.pages }, (_, page) => ({ id: `${k}:${page}`, source: k, page, turn: 0 })));
        return { ...s, tiles, merges: [...s.merges, { pages: a.pages, bytes: a.bytes, name: a.name || '' }] };
      }
      default: return s;
    }
  };
  // The operations that lay the pages out as the tiles show (lib/pdf-doc.js layout): every merged file and blank page
  // added at the end, the pages no tile keeps deleted, the rest put in the tiles' order, then each turn.
  const toOps = (s) => {
    const ops = [], offset = [0];
    let len = s.count;
    for (const m of s.merges) { ops.push({ op: 'merge', bytes: m.bytes, at: len }); offset.push(len); len += m.pages; }
    const blanks = new Map();
    for (const t of s.tiles) if (t.source === 'blank') { ops.push({ op: 'blank', at: len }); blanks.set(t.id, len++); }
    const kept = s.tiles.map((t) => (t.source === 'blank' ? blanks.get(t.id) : offset[t.source] + t.page));
    const keep = new Set(kept), deleted = Array.from({ length: len }, (_, i) => i).filter((i) => !keep.has(i));
    if (deleted.length) ops.push({ op: 'delete', pages: deleted });
    const rank = new Map([...kept].sort((a, b) => a - b).map((i, r) => [i, r])), order = kept.map((i) => rank.get(i));
    if (order.some((r, i) => r !== i)) ops.push({ op: 'reorder', order });
    for (const by of [90, 180, 270]) {
      const pages = s.tiles.flatMap((t, i) => (t.turn === by ? [i] : []));
      if (pages.length) ops.push({ op: 'rotate', pages, by });
    }
    return ops;
  };
  const changed = (s) => toOps(s).length > 0;

  // ---- the panel, over the viewer's pages. o: { P (pdf.mjs), doc, t, h, btn, mount, bytes (the file's size), allows
  // ({ add, why }: whether other PDFs may come in, and why not), apply(state) → a promise (Done), close() }.
  const SVG = 'http://www.w3.org/2000/svg';
  const ICONS = { left: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5', right: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5', up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', blank: 'M6 3h9l4 4v14H6zM14 3v5h5', add: 'M12 5v14M5 12h14' };
  const icon = (d) => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'gp-ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); return s; };
  const panel = (o) => {
    const { P, t, h, btn } = o, life = new AbortController(), signal = life.signal;
    let s = start(o.doc.numPages, { bytes: o.bytes }), focus = 0, busy = false;
    const sel = new Set();
    const docs = [o.doc]; // the document, then each merged file as pdf.js reads it (for its tiles' pictures)
    const said = h('p', { class: 'gq-pages-said', role: 'status' });
    const tool = (act, label, d, run) => btn({ class: 'gq-ib', 'data-act': act, title: t(label), 'aria-label': t(label), onclick: run }, icon(d));
    const picked = () => s.tiles.flatMap((x, i) => (sel.has(x.id) ? [i] : [])), current = () => (picked().length ? picked() : s.tiles.length ? [Math.min(focus, s.tiles.length - 1)] : []);
    const pick = h('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true });
    const addB = tool('merge', 'Add PDF…', ICONS.add, () => pick.click());
    if (!o.allows.add) { addB.disabled = true; addB.title = t(o.allows.why || 'Pages cannot be added to a password-protected PDF, or taken from one.'); }
    const doneB = btn({ class: 'gp-submit', 'data-act': 'done' }, t('Done'));
    const bar = h('div', { class: 'gp-tool gq-pages-bar', role: 'toolbar', 'aria-label': t('Pages') },
      tool('rotate-left', 'Rotate left', ICONS.left, () => act({ type: 'rotate', at: current(), by: -90 })),
      tool('rotate-right', 'Rotate right', ICONS.right, () => act({ type: 'rotate', at: current(), by: 90 })),
      tool('up', 'Move up', ICONS.up, () => shift(-1)), tool('down', 'Move down', ICONS.down, () => shift(1)),
      tool('delete', 'Delete', ICONS.trash, () => { const at = current(); act({ type: 'remove', at }); focus = Math.min(at[0] ?? 0, s.tiles.length - 1); sel.clear(); draw(); }),
      tool('blank', 'Blank page', ICONS.blank, () => { act({ type: 'blank', at: (current().at(-1) ?? s.tiles.length - 1) + 1 }); }),
      addB, h('span', { class: 'grow' }), said, btn({ class: 'gp-tbtn', 'data-act': 'cancel', onclick: () => close() }, t('Cancel')), doneB);
    const grid = h('div', { class: 'gq-pages-grid', role: 'listbox', 'aria-multiselectable': 'true', 'aria-label': t('Pages') });
    const el = h('div', { class: 'gq-pagepanel', role: 'region', 'aria-label': t('Pages') }, bar, grid, pick);
    const act = (a) => {
      try { s = reduce(s, a); said.textContent = ''; } catch (e) { said.textContent = t(e.name === 'PdfTooManyPagesError' ? 'A PDF can have at most 500 pages.' : e.name === 'PdfTooLargeError' ? 'Choose a PDF smaller than 50 MB.' : e.message); }
      draw();
    };
    // The chosen pages one place earlier or later, together.
    const shift = (by) => {
      const at = current().sort((a, b) => (by < 0 ? a - b : b - a));
      if (!at.length || (by < 0 ? at[0] === 0 : at[0] === s.tiles.length - 1)) return;
      for (const i of at) s = reduce(s, { type: 'move', from: i, to: i + by });
      focus = Math.max(0, Math.min(s.tiles.length - 1, focus + by));
      draw();
    };
    // ---- pictures: each tile's page drawn once, small, as it comes into view; a blank page is white.
    const drawn = new Map(), queue = [];
    let drawing = false;
    const paint = async () => {
      if (drawing) return;
      drawing = true;
      try {
        while (queue.length && !signal.aborted) {
          const { tile, canvas } = queue.shift();
          if (drawn.get(tile.id) === canvas) continue;
          const d = docs[tile.source];
          if (!d) continue;
          const page = await d.getPage(tile.page + 1), one = page.getViewport({ scale: 1 }), scale = 112 / Math.max(one.width, one.height);
          const viewport = page.getViewport({ scale: scale * (devicePixelRatio || 1) });
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          canvas.style.width = `${Math.round(one.width * scale)}px`; canvas.style.height = `${Math.round(one.height * scale)}px`;
          await page.render({ canvas, viewport, background: '#fff', annotationMode: P.AnnotationMode.ENABLE_STORAGE }).promise.catch(() => {});
          drawn.set(tile.id, canvas);
        }
      } finally { drawing = false; }
    };
    const seen = new IntersectionObserver((list) => { for (const e of list) if (e.isIntersecting) { const x = e.target; seen.unobserve(x); queue.push({ tile: x._tile, canvas: x.querySelector('canvas') }); } paint(); }, { root: grid, rootMargin: '200px' });
    const pictures = new Map(); // tile id → its canvas, kept across redraws
    // ---- the tiles
    let from = -1;
    const draw = () => {
      grid.replaceChildren(...s.tiles.map((tile, i) => {
        let canvas = pictures.get(tile.id);
        if (!canvas) { canvas = h('canvas', { class: tile.source === 'blank' ? 'gq-blank' : null }); pictures.set(tile.id, canvas); }
        const fig = h('div', { class: 'gq-tile-pic' }, canvas);
        fig.style.setProperty('--turn', `${tile.turn}deg`);
        const x = h('div', { class: 'gq-tile', role: 'option', tabindex: i === focus ? '0' : '-1', draggable: 'true', 'data-id': tile.id, 'data-turn': String(tile.turn), 'aria-selected': String(sel.has(tile.id)),
          'aria-label': t('Page {n}', { n: i + 1 }) }, fig, h('span', { class: 'gq-tile-n', text: String(i + 1) }));
        x._tile = tile;
        if (tile.source !== 'blank' && !drawn.has(tile.id)) seen.observe(x);
        return x;
      }));
      doneB.disabled = busy || !changed(s);
    };
    const tileAt = (e) => e.target.closest?.('.gq-tile');
    const indexOf = (x) => [...grid.children].indexOf(x);
    grid.addEventListener('click', (e) => {
      const x = tileAt(e); if (!x) return;
      const i = indexOf(x), id = x.dataset.id;
      if (e.shiftKey) { const [a, b] = [Math.min(focus, i), Math.max(focus, i)]; for (let k = a; k <= b; k++) sel.add(s.tiles[k].id); }
      else if (e.ctrlKey || e.metaKey) { if (sel.has(id)) sel.delete(id); else sel.add(id); }
      else { sel.clear(); sel.add(id); }
      focus = i; draw(); grid.children[focus]?.focus();
    }, { signal });
    grid.addEventListener('keydown', (e) => {
      const x = tileAt(e); if (!x) return;
      const i = indexOf(x), cols = Math.max(1, [...grid.children].filter((c) => c.offsetTop === grid.children[0].offsetTop).length);
      const go = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols, Home: -i, End: s.tiles.length - 1 - i }[e.key];
      if (go !== undefined && !e.altKey) {
        e.preventDefault();
        focus = Math.max(0, Math.min(s.tiles.length - 1, i + go));
        if (e.shiftKey) sel.add(s.tiles[focus].id);
        draw(); grid.children[focus]?.focus();
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
        e.preventDefault(); if (!sel.size) sel.add(s.tiles[i].id); shift(e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1); grid.children[focus]?.focus();
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault(); const id = s.tiles[i].id; if (sel.has(id)) sel.delete(id); else sel.add(id); draw(); grid.children[focus]?.focus();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); const at = current(); act({ type: 'remove', at }); sel.clear(); focus = Math.min(at[0] ?? 0, s.tiles.length - 1); draw(); grid.children[focus]?.focus();
      }
    }, { signal });
    // Drag a tile before or after another.
    grid.addEventListener('dragstart', (e) => { const x = tileAt(e); if (!x) return; from = indexOf(x); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.dataset.id); }, { signal });
    grid.addEventListener('dragover', (e) => { if (from >= 0 && tileAt(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }, { signal });
    grid.addEventListener('drop', (e) => {
      const x = tileAt(e); if (from < 0 || !x) return;
      e.preventDefault();
      const r = x.getBoundingClientRect(), i = indexOf(x), after = e.clientX > r.left + r.width / 2;
      let to = i + (after ? 1 : 0);
      if (to > from) to--;
      const was = from; from = -1;
      if (to !== was) { s = reduce(s, { type: 'move', from: was, to }); focus = to; draw(); }
    }, { signal });
    grid.addEventListener('dragend', () => { from = -1; }, { signal });
    // Another PDF's pages, after the chosen ones (or at the end).
    pick.addEventListener('change', async () => {
      const f = pick.files[0];
      pick.value = '';
      if (!f) return;
      said.textContent = '';
      try {
        if (f.size > BYTES) throw fail('PdfTooLargeError', '');
        const bytes = new Uint8Array(await f.arrayBuffer());
        const task = P.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, verbosity: 0, wasmUrl: o.wasmUrl });
        const d = await task.promise;
        const next = reduce(s, { type: 'merge', at: (current().at(-1) ?? s.tiles.length - 1) + 1, pages: d.numPages, bytes, name: f.name });
        docs.push(d); s = next; draw();
      } catch (e) {
        said.textContent = t(e.name === 'PdfTooManyPagesError' ? 'A PDF can have at most 500 pages.' : e.name === 'PdfTooLargeError' ? 'Choose a PDF smaller than 50 MB.' : 'That file could not be read.');
      }
    }, { signal });
    doneB.addEventListener('click', async () => {
      if (doneB.disabled) return;
      busy = true; doneB.disabled = true; said.textContent = '';
      try { await o.apply(s); close(true); } catch (e) { console.error(e); said.textContent = t(e.say || 'Not saved. Try again in a moment.'); busy = false; draw(); }
    }, { signal });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); close(); } }, { signal });
    const close = (applied = false) => {
      if (signal.aborted) return;
      life.abort(); seen.disconnect(); el.remove();
      for (const d of docs.slice(1)) d.loadingTask.destroy().catch(() => {});
      for (const c of pictures.values()) c.width = c.height = 0;
      o.close?.(applied);
    };
    o.mount.append(el);
    draw();
    grid.children[0]?.focus();
    return { el, close, state: () => s };
  };

  return { PAGES, BYTES, start, reduce, toOps, changed, panel };
})();

if (typeof module !== 'undefined') module.exports = GZ_PDF_PAGES; else GZ_PDF_PAGES;
