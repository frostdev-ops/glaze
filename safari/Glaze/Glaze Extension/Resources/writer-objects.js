// Glaze Writer's objects in the editor frame (writer.html, after writer-paper.js; lib/writer-objects.js does the work):
// in paper mode the toolbar's Insert menu (Picture… ⌘⇧I, a table grid up to 10 × 10, Link… ⌘K, Horizontal line, Special
// characters…) and list style menu (presets, each level's numbering or bullet, restart and continue); a picture drawn
// with its caption, selected with an outline and corner handles that keep its shape, and its popover (in line or a
// block left, centre or right, width in inches and percent of the text width, alt text, caption, delete); pictures from
// a file, pasted, or dropped on the page, held in the paper within lib/writer-objects.js's bounds; the table toolbar
// over a table the caret is in; the link card on a link (open, edit its text and address, remove) in both modes; and
// links typed on space, --- lines and Tab between cells (lib/writer-objects.js plugins), as glaze-plans/writer/
// mockups/objects draws these. Popovers are writer.css's .pop: they scale in and fade, and go at once.
// The paper toolbar has no slot of its own yet: Insert goes before its spacer, the list style caret after Numbered list.
(() => {
  const F = globalThis.GZ_WRITER_FRAME, L = globalThis.GZ_WRITER_OBJECTS_LIB;
  if (!F || !L) return;
  const t = (k, v) => F.t(k, v);
  const { NodeSelection } = GZ_PM.state, { Fragment, Slice } = GZ_PM.model, T = GZ_PM.tables;
  const SVG = 'http://www.w3.org/2000/svg';
  const PATHS = {
    plus: 'M12 5v14M5 12h14', caret: 'm6 9 6 6 6-6',
    image: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM9 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2M21 16l-5-5-9 9',
    table: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M3 15h18M9 4v16M15 4v16',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    hr: 'M4 12h16', omega: 'M5 19h4v-2a6 6 0 1 1 6 0v2h4',
    inline: 'M3 6h18M3 18h18M3 12h4M17 12h4M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z',
    left: 'M4 7h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM3 4h18M3 20h18M14 10h7M14 14h7',
    center: 'M9 7h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM3 4h18M3 20h18',
    right: 'M14 7h6a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM3 4h18M3 20h18M3 10h7M3 14h7',
    tleft: 'M4 6h16M4 12h10M4 18h16', tcenter: 'M4 6h16M7 12h10M4 18h16', tright: 'M4 6h16M10 12h10M4 18h16',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    rowup: 'M4 12h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1zM12 3v6M9 6h6',
    rowdown: 'M4 4h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM12 15v6M9 18h6',
    colleft: 'M13 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 12h6M6 9v6',
    colright: 'M5 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 12h6M18 9v6',
    rowdel: 'M4 8h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM9 10l6 4M15 10l-6 4',
    coldel: 'M9 3h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM10 9l4 6M14 9l-4 6',
    header: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 10h18M7 7h10',
    borders: 'M3 4h18v16H3zM12 4v16M3 12h18',
    vtop: 'M4 4h16M12 8v12M8 12l4-4 4 4', vmid: 'M4 12h16M12 3v5M12 16v5M9 6l3 2 3-2M9 18l3-2 3 2', vbot: 'M4 20h16M12 4v12M8 12l4 4 4-4',
    edit: 'M4 20h4l10-10-4-4L4 16zM13 7l4 4',
    unlink: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16',
    open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5', search: 'M11 5a6 6 0 1 0 0 12 6 6 0 0 0 0-12M20 20l-4.5-4.5',
  };
  const icon = (name) => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', PATHS[name]); s.append(p); return s; };
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };
  const ibtn = (name, label, run) => h('button', { type: 'button', class: 'gzo-ibtn', title: t(label), 'aria-label': t(label), onclick: run }, icon(name));
  const show = (pop) => { if (!pop.hidden) return; pop.hidden = false; pop.getBoundingClientRect(); pop.setAttribute('data-open', ''); };
  const hide = (pop) => { if (pop.hidden) return; pop.hidden = true; pop.removeAttribute('data-open'); };
  const nf = (n, d = 0) => new Intl.NumberFormat(document.documentElement.lang || undefined, { maximumFractionDigits: d }).format(n);
  const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : NaN; };

  let ed = null, view = null, cmds = null, paperMode = false;
  const PAPER = () => globalThis.GZ_WRITER_PAPER?.current?.() || null;
  const content = () => { const p = PAPER(); return p && globalThis.GZ_WRITER_STYLES ? GZ_WRITER_STYLES.geometry(p.look()).content : 624; };
  const notify = (m) => { const p = PAPER(); if (p) p.notify(m); };
  const run = (name, ...args) => { const ok = cmds[name](...args)(view.state, view.dispatch); return ok; };
  const keep = (el) => el.addEventListener('mousedown', (e) => { if (!e.target.closest('input, textarea')) e.preventDefault(); });

  // ---- pictures in
  // Made on first use, after the paper's own file input (which writer-paper.js and its checks find first).
  let file = null;
  const fileInput = () => {
    if (file) return file;
    file = h('input', { type: 'file', accept: L.IMAGE.types.join(','), hidden: true });
    file.addEventListener('change', () => { const f = file.files[0]; file.value = ''; if (f) loadImage(f); });
    document.body.append(file);
    return file;
  };
  const dataURL = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(blob); });
  // Drawn again at its fitted size: PNG while it fits in the bound, then JPEG at falling quality, then smaller still.
  const encode = async (bmp, fit, type) => {
    let w = fit.width, hh = fit.height;
    for (let round = 0; round < 4; round++) {
      const c = document.createElement('canvas');
      c.width = w; c.height = hh;
      const g = c.getContext('2d');
      const blob = (kind, q) => new Promise((ok) => c.toBlob(ok, kind, q));
      if (type !== 'image/jpeg') { g.drawImage(bmp, 0, 0, w, hh); const png = await blob('image/png'); if (png && png.size <= L.IMAGE.maxBytes) return png; }
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh); g.drawImage(bmp, 0, 0, w, hh);
      for (const q of [0.85, 0.72, 0.6]) { const jpg = await blob('image/jpeg', q); if (jpg && jpg.size <= L.IMAGE.maxBytes) return jpg; }
      w = Math.max(1, Math.round(w * 0.75)); hh = Math.max(1, Math.round(hh * 0.75));
    }
    return null;
  };
  let loading = false;
  const loadImage = async (f, at = null) => {
    if (!view || !paperMode || loading) return;
    if (!L.IMAGE.types.includes(f?.type)) { notify('That file is not a picture Writer can hold.'); return; }
    if (f.size > 40e6) { notify('That picture could not be read.'); return; }
    loading = true;
    try {
      let bmp;
      try { bmp = await createImageBitmap(f); } catch { notify('That picture could not be read.'); return; }
      const fit = L.fitImage({ width: bmp.width, height: bmp.height, bytes: f.size, type: f.type });
      const blob = fit?.reencode ? await encode(bmp, fit, f.type) : f;
      bmp.close?.();
      if (!fit || !blob) { notify('That picture could not be read.'); return; }
      const src = await dataURL(blob);
      if (at != null) view.dispatch(view.state.tr.setSelection(GZ_PM.state.TextSelection.near(view.state.doc.resolve(at))));
      if (!run('insertImage', { src, width: Math.min(fit.width, content()) })) { notify('The paper’s pictures are larger than 5 MB.'); return; }
      if (fit.smaller) notify('The picture was made smaller to fit the paper.');
      view.focus();
    } finally { loading = false; }
  };
  const pickImage = () => { if (!paperMode) return false; fileInput().click(); return true; };
  // A picture dropped on the page goes in where it lands; any other file, or one dropped beside the page, stays the
  // paper's (writer-paper.js routes it).
  addEventListener('drop', (e) => {
    if (!paperMode || !view || !e.target.closest?.('.gp-flow, .gp-sheet')) return;
    const img = [...(e.dataTransfer?.files || [])].find((f) => L.IMAGE.types.includes(f.type));
    if (!img) return;
    e.preventDefault(); e.stopImmediatePropagation();
    document.querySelector('.gp-canvas')?.classList.remove('gp-drop');
    loadImage(img, view.posAtCoords({ left: e.clientX, top: e.clientY })?.pos ?? null);
  }, true);

  // ---- a picture on the page: its caption under it, an outline and four handles when selected
  let relayoutFrame = 0;
  const relayout = () => { relayoutFrame ||= requestAnimationFrame(() => { relayoutFrame = 0; if (view) globalThis.GZ_WRITER_PAGINATE?.relayout(view); }); };
  class ImageView {
    constructor(node, v, getPos) {
      this.node = node; this.view = v; this.getPos = getPos;
      this.img = h('img', { draggable: 'false' });
      this.size = h('span', { class: 'gzo-size', 'aria-hidden': 'true' });
      this.box = h('span', { class: 'gzo-box' }, this.img, ['nw', 'ne', 'sw', 'se'].map((c) => h('span', { class: 'gzo-h', 'data-c': c, 'aria-hidden': 'true' })), this.size);
      this.dom = h('span', { class: 'gzo-img' }, this.box);
      this.box.addEventListener('pointerdown', (e) => this.drag(e));
      // A picture's height is known once it decodes, after the pages were measured: they are measured again.
      this.img.addEventListener('load', relayout);
      this.set(node);
    }
    set(node) {
      const a = node.attrs;
      if (this.img.getAttribute('src') !== a.src) this.img.setAttribute('src', a.src);
      this.img.alt = a.alt || '';
      if (a.width) this.img.style.width = `${a.width}px`; else this.img.style.removeProperty('width');
      this.dom.dataset.display = a.display === 'block' ? 'block' : 'inline';
      if (a.align) this.dom.dataset.align = a.align; else delete this.dom.dataset.align;
      if (a.display === 'block' && a.caption) this.dom.dataset.caption = a.caption; else delete this.dom.dataset.caption;
    }
    update(node) { if (node.type !== this.node.type) return false; this.node = node; this.set(node); return true; }
    selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
    deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
    stopEvent(e) { return !!e.target.closest?.('.gzo-h'); }
    ignoreMutation() { return true; }
    // A corner drag keeps the shape; the width shows in inches and percent of the text width as it changes.
    drag(e) {
      const handle = e.target.closest('.gzo-h');
      if (!handle || e.button !== 0) return;
      e.preventDefault();
      const scale = this.box.getBoundingClientRect().width / (this.box.offsetWidth || 1) || 1, start = this.img.offsetWidth, x0 = e.clientX, west = /w/.test(handle.dataset.c);
      const wmax = content();
      let width = start;
      handle.setPointerCapture(e.pointerId);
      this.dom.classList.add('gzo-sizing');
      const move = (ev) => {
        width = L.clampWidth(start + ((ev.clientX - x0) / scale) * (west ? -1 : 1) * (this.dom.dataset.align === 'center' && this.dom.dataset.display === 'block' ? 2 : 1), wmax);
        this.img.style.width = `${width}px`;
        const s = L.size(width, wmax);
        this.size.textContent = `${nf(s.inches, 2)}″ · ${nf(s.percent)}%`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
        this.dom.classList.remove('gzo-sizing');
        const pos = this.getPos();
        if (typeof pos === 'number' && width !== start) cmds.setImage(pos, { width })(this.view.state, this.view.dispatch);
      };
      handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
      move(e);
    }
  }

  // ---- popovers
  const pops = [];
  // Escape goes back to the text (and never reaches the paper, where it would end Focus).
  const pop = (cls, label) => {
    const el = h('div', { class: `pop gzo-pop ${cls}`, role: 'dialog', 'aria-label': t(label), hidden: true });
    keep(el);
    el.addEventListener('keydown', (e) => { if (e.key !== 'Escape') return; e.preventDefault(); e.stopPropagation(); if (el === linkEdit) closeLinkEditor(); else view?.focus(); });
    document.body.append(el); pops.push(el);
    return el;
  };
  const within = (el) => el.contains(document.activeElement);
  // Whether an anchor is in view: inside the paper's canvas, or the window in compose.
  const seen = (r) => { const c = document.querySelector('.gp-canvas')?.getBoundingClientRect() || { top: 0, bottom: innerHeight }; return r.bottom > c.top && r.top < c.bottom; };
  // Under the anchor where it fits, else over it; inside the window.
  const place = (el, r, above = false) => {
    const w = el.offsetWidth, hh = el.offsetHeight;
    let top = above ? r.top - hh - 8 : r.bottom + 8;
    if (!above && top + hh > innerHeight - 4) top = r.top - hh - 8;
    if (above && top < 4) top = r.bottom + 8;
    el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`;
    el.style.top = `${Math.max(4, Math.min(top, innerHeight - hh - 4))}px`;
  };
  const field = (label, o = {}) => h('input', { class: 'gzo-field', type: 'text', placeholder: o.ph === false ? null : t(label), 'aria-label': t(label), spellcheck: o.spell ? null : 'false', inputmode: o.mode || null, maxlength: o.max || null });
  const commit = (input, fn) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); fn(); view.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); view.focus(); }
    });
    input.addEventListener('change', fn);
  };

  // The picture's popover.
  const imgPop = pop('gzo-imgpop', 'Picture');
  const layouts = [['inline', 'In line', { display: 'inline', align: null }], ['left', 'Left', { display: 'block', align: 'left' }], ['center', 'Center', { display: 'block', align: 'center' }], ['right', 'Right', { display: 'block', align: 'right' }]]
    .map(([ico, label, attrs]) => { const b = ibtn(ico, label, () => { const s = imageSel(); if (s) run('setImage', s.pos, attrs); }); b.dataset.layout = ico; b.setAttribute('aria-pressed', 'false'); return b; });
  const inches = field('Width in inches', { ph: false, mode: 'decimal', max: '6' }), percent = field('Width in percent', { ph: false, mode: 'numeric', max: '3' });
  const alt = field('Alt text', { spell: true, max: '1000' }), caption = field('Caption', { spell: true, max: '500' });
  commit(inches, () => { const s = imageSel(), v = num(inches.value); if (s && v > 0) run('setImage', s.pos, { width: L.fromInches(v, content()) }); });
  commit(percent, () => { const s = imageSel(), v = num(percent.value); if (s && v > 0) run('setImage', s.pos, { width: L.fromPercent(v, content()) }); });
  commit(alt, () => { const s = imageSel(); if (s && alt.value !== s.node.attrs.alt) run('setImage', s.pos, { alt: alt.value }); });
  commit(caption, () => { const s = imageSel(); if (s && caption.value.trim() !== s.node.attrs.caption) run('setImage', s.pos, { caption: caption.value }); });
  imgPop.append(
    h('div', { class: 'gzo-row' }, layouts, h('span', { class: 'gzo-sepv' }), h('label', { class: 'gzo-unit' }, inches, h('span', { text: t('in') })), h('label', { class: 'gzo-unit' }, percent, h('span', { text: '%' })), h('span', { class: 'grow' }),
      ibtn('trash', 'Delete', () => { const s = imageSel(); if (s) { run('deleteImage', s.pos); view.focus(); } })),
    alt, caption);
  const imageSel = () => { const s = view?.state.selection; return s instanceof NodeSelection && s.node.type.name === 'image' ? { pos: s.from, node: s.node } : null; };
  const drawImgPop = () => {
    const s = imageSel(), dom = s && view.nodeDOM(s.pos);
    if (!s || !dom?.querySelector) { hide(imgPop); return; }
    const a = s.node.attrs, cur = a.display === 'block' ? a.align || 'center' : 'inline', w = a.width || dom.querySelector('img').offsetWidth, size = L.size(w, content());
    for (const b of layouts) b.setAttribute('aria-pressed', String(b.dataset.layout === cur));
    if (document.activeElement !== inches) inches.value = nf(size.inches, 2);
    if (document.activeElement !== percent) percent.value = String(size.percent);
    if (document.activeElement !== alt) alt.value = a.alt;
    if (document.activeElement !== caption) caption.value = a.caption;
    caption.hidden = a.display !== 'block';
    const box = dom.querySelector('.gzo-box').getBoundingClientRect();
    if (!seen(box) && !within(imgPop)) { hide(imgPop); return; }
    show(imgPop);
    place(imgPop, { left: box.left, right: box.right, top: box.top, bottom: dom.getBoundingClientRect().bottom }); // under its caption too
  };

  // The table toolbar.
  const tablePop = pop('gzo-tablepop', 'Table');
  const tableRun = (name) => () => { if (!run('table', name, { content: content() }) && /^addColumn/.test(name)) notify('The table is as wide as the text.'); view.focus(); };
  const tb = {
    header: ibtn('header', 'Header row', () => { run('table', 'toggleHeaderRow'); view.focus(); }),
    borders: ibtn('borders', 'Borders', () => { const tbl = tableAt(); if (tbl) run('tableAttr', 'borders', !tbl.attrs.borders); view.focus(); }),
    left: ibtn('tleft', 'Left', () => { run('cellAlign', 'left'); view.focus(); }), center: ibtn('tcenter', 'Center', () => { run('cellAlign', 'center'); view.focus(); }), right: ibtn('tright', 'Right', () => { run('cellAlign', 'right'); view.focus(); }),
    top: ibtn('vtop', 'Top', () => { run('cellAttr', 'valign', null); view.focus(); }), middle: ibtn('vmid', 'Middle', () => { run('cellAttr', 'valign', 'middle'); view.focus(); }), bottom: ibtn('vbot', 'Bottom', () => { run('cellAttr', 'valign', 'bottom'); view.focus(); }),
  };
  for (const b of Object.values(tb)) b.setAttribute('aria-pressed', 'false');
  tablePop.setAttribute('role', 'toolbar');
  tablePop.append(h('div', { class: 'gzo-row' },
    ibtn('rowup', 'Row above', tableRun('addRowBefore')), ibtn('rowdown', 'Row below', tableRun('addRowAfter')), ibtn('colleft', 'Column left', tableRun('addColumnBefore')), ibtn('colright', 'Column right', tableRun('addColumnAfter')), h('span', { class: 'gzo-sepv' }),
    ibtn('rowdel', 'Delete row', tableRun('deleteRow')), ibtn('coldel', 'Delete column', tableRun('deleteColumn')), h('span', { class: 'gzo-sepv' }),
    tb.header, tb.borders, h('span', { class: 'gzo-sepv' }), tb.left, tb.center, tb.right, h('span', { class: 'gzo-sepv' }), tb.top, tb.middle, tb.bottom, h('span', { class: 'gzo-sepv' }),
    ibtn('trash', 'Delete table', tableRun('deleteTable'))));
  tablePop.addEventListener('keydown', (e) => {
    const all = [...tablePop.querySelectorAll('button')], i = all.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); view.focus(); }
    else if (i >= 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus(); }
  });
  const tableAt = () => { const $ = view.state.selection.$from; for (let d = $.depth; d > 0; d--) if ($.node(d).type.name === 'table') return Object.assign($.node(d), { pos: $.before(d) }); return null; };
  const drawTablePop = () => {
    const tbl = paperMode && !imageSel() && T.isInTable(view.state) ? tableAt() : null, dom = tbl && view.nodeDOM(tbl.pos);
    if (!tbl || !dom?.getBoundingClientRect) { hide(tablePop); return; }
    const cell = T.cellAround(view.state.selection.$from)?.nodeAfter, para = view.state.selection.$from.parent;
    tb.header.setAttribute('aria-pressed', String(tbl.firstChild.content.content.every((c) => c.type.name === 'table_header')));
    tb.borders.setAttribute('aria-pressed', String(tbl.attrs.borders));
    for (const k of ['left', 'center', 'right']) tb[k].setAttribute('aria-pressed', String((para.attrs.align || 'left') === k));
    for (const k of ['top', 'middle', 'bottom']) tb[k].setAttribute('aria-pressed', String((cell?.attrs.valign || 'top') === k));
    show(tablePop);
    const r = (dom.matches?.('table') ? dom : dom.querySelector?.('table') || dom).getBoundingClientRect(), canvas = document.querySelector('.gp-canvas')?.getBoundingClientRect();
    if (!seen(r) && !within(tablePop)) { hide(tablePop); return; }
    // Over the table where there is room, else under it, else held at the top of the pages.
    const hh = tablePop.offsetHeight + 12, top = canvas?.top || 0, bottom = canvas?.bottom || innerHeight;
    if (r.top - hh >= top) place(tablePop, r, true);
    else if (r.bottom + hh <= bottom) place(tablePop, { left: r.left, right: r.right, top: r.bottom, bottom: r.bottom });
    else place(tablePop, { left: r.left, right: r.right, top: top + hh, bottom: top + hh }, true);
  };

  // The link card, and its editor (also ⌘K).
  const linkPop = pop('gzo-linkpop', 'Link');
  const url = h('a', { class: 'gzo-url', target: '_blank', rel: 'noopener noreferrer' });
  linkPop.append(url, ibtn('edit', 'Edit', () => openLinkEditor()), ibtn('unlink', 'Remove link', () => { run('unlink'); view.focus(); }), ibtn('open', 'Open', () => { const l = L.linkAt(view.state); if (l) window.open(l.href, '_blank', 'noopener'); }));
  url.addEventListener('click', (e) => { e.preventDefault(); const l = L.linkAt(view.state); if (l) window.open(l.href, '_blank', 'noopener'); });
  const linkEdit = pop('gzo-linkedit', 'Link');
  const linkText = field('Text', { spell: true, max: '500' }), linkHref = field('Link', { max: '2048' });
  linkHref.type = 'url'; linkHref.placeholder = 'https://';
  const applyLink = () => {
    if (!linkHref.value.trim()) { run('unlink'); closeLinkEditor(); return; }
    if (run('link', { text: linkText.value, href: linkHref.value })) closeLinkEditor();
    else linkHref.setAttribute('aria-invalid', 'true');
  };
  linkEdit.append(linkText, linkHref, h('div', { class: 'gzo-row' }, h('span', { class: 'grow' }), h('button', { type: 'button', class: 'gzo-sbtn', onclick: applyLink }, t('Apply'))));
  for (const i of [linkText, linkHref]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyLink(); } else if (e.key === 'Escape') { e.preventDefault(); closeLinkEditor(); } });
  linkHref.addEventListener('input', () => linkHref.removeAttribute('aria-invalid'));
  let editing = null;
  const closeLinkEditor = () => { editing = null; hide(linkEdit); view.focus(); };
  const openLinkEditor = () => {
    if (!view) return false;
    const st = view.state, l = L.linkAt(st), { from, to, empty } = st.selection;
    if (st.selection.$from.parent.type.spec.code) return false;
    // The selection stays where it was while the editor has focus; the fields work on that range.
    editing = l ? { from: l.from, to: l.to } : { from, to };
    linkText.value = l ? l.text : empty ? '' : st.doc.textBetween(from, to, ' ');
    linkHref.value = l ? l.href : '';
    linkHref.removeAttribute('aria-invalid');
    hide(linkPop);
    show(linkEdit);
    const c = view.coordsAtPos(editing.from);
    place(linkEdit, { left: c.left, right: c.left, top: c.top, bottom: view.coordsAtPos(editing.to).bottom });
    (l || !empty ? linkHref : linkText).focus();
    (l || !empty ? linkHref : linkText).select();
    return true;
  };
  const drawLinkPop = () => {
    if (editing) return;
    const l = view.state.selection.empty && (view.hasFocus() || within(linkPop)) ? L.linkAt(view.state) : null;
    if (!l) { hide(linkPop); return; }
    const a = view.coordsAtPos(l.from), b = view.coordsAtPos(l.to);
    if (!seen(a) && !within(linkPop)) { hide(linkPop); return; }
    url.textContent = l.href.replace(/^mailto:/, '');
    url.href = l.href;
    show(linkPop);
    place(linkPop, { left: a.left, right: b.right, top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });
  };

  let frame = 0;
  const refresh = () => {
    frame = 0;
    if (!view) return;
    if (paperMode) { drawImgPop(); drawTablePop(); }
    drawLinkPop();
  };
  const soon = () => { frame ||= requestAnimationFrame(refresh); };
  addEventListener('resize', soon);
  document.addEventListener('scroll', soon, true);
  document.addEventListener('focusin', soon);
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!view) return;
    const inPop = pops.some(within) || !!document.activeElement?.closest?.('.gzo-menu');
    if (!inPop && !view.hasFocus()) { for (const p of pops) hide(p); editing = null; }
  }, 0));

  // ---- menus: Insert, the table grid, special characters, list styles (writer-paper.css's .gp-menu look)
  let open = null;
  const closeMenu = (back) => { if (!open) return; const o = open; open = null; o.el.remove(); o.opener.setAttribute('aria-expanded', 'false'); if (back) o.opener.focus(); };
  const menuAt = (opener, el) => {
    closeMenu();
    el.classList.add('pop', 'gp-menu', 'gzo-menu');
    document.body.append(el);
    const r = opener.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - el.offsetWidth - 4))}px`;
    el.style.top = `${Math.min(r.bottom + 6, innerHeight - el.offsetHeight - 4)}px`;
    el.addEventListener('keydown', (e) => {
      const all = [...el.querySelectorAll('[role^=menuitem]')], i = all.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
      else if (i >= 0 && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length].focus(); }
    });
    el.getBoundingClientRect();
    el.setAttribute('data-open', '');
    opener.setAttribute('aria-expanded', 'true');
    open = { el, opener };
    el.querySelector('[role^=menuitem], input, [tabindex="0"]')?.focus();
  };
  document.addEventListener('pointerdown', (e) => { if (open && !open.el.contains(e.target) && !open.opener.contains(e.target)) closeMenu(); }, true);
  const item = (ico, label, hint, fn, o = {}) => h('button', { type: 'button', role: o.checked == null ? 'menuitem' : 'menuitemradio', 'aria-checked': o.checked == null ? null : String(!!o.checked), onclick: () => { closeMenu(); fn(); } },
    ico ? icon(ico) : null, h('span', { class: 'gzo-mlabel', text: label }), hint ? h('small', { text: hint }) : null);
  const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const keyHint = (k) => (MAC ? k : k.replace('⌘', 'Ctrl+').replace('⇧', 'Shift+'));

  // A grid: point, arrow keys or type to size it; click or Enter puts it in.
  const grid = () => {
    let rows = 1, cols = 1;
    const cells = Array.from({ length: 100 }, (_, i) => h('i', { 'data-r': String(Math.floor(i / 10) + 1), 'data-c': String((i % 10) + 1) }));
    const label = h('div', { class: 'gzo-gridlbl', 'aria-hidden': 'true' });
    const box = h('div', { class: 'gzo-grid', tabindex: '0', role: 'button', 'aria-label': t('Table') }, cells);
    const paint = () => { for (const c of cells) c.classList.toggle('on', +c.dataset.r <= rows && +c.dataset.c <= cols); label.textContent = `${nf(cols)} × ${nf(rows)}`; box.setAttribute('aria-label', `${t('Table')} ${cols} × ${rows}`); };
    const put = () => { closeMenu(); run('insertTable', { rows, cols, header: false }); view.focus(); };
    box.addEventListener('pointermove', (e) => { const c = e.target.closest('i'); if (c) { rows = +c.dataset.r; cols = +c.dataset.c; paint(); } });
    box.addEventListener('click', (e) => { if (e.target.closest('i')) put(); });
    box.addEventListener('keydown', (e) => {
      const d = { ArrowRight: [0, 1], ArrowLeft: [0, -1], ArrowDown: [1, 0], ArrowUp: [-1, 0] }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); rows = Math.min(10, Math.max(1, rows + d[0])); cols = Math.min(10, Math.max(1, cols + d[1])); paint(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); put(); }
    });
    paint();
    return [h('div', { class: 'gzo-mhead' }, icon('table'), h('span', { text: t('Table') })), box, label];
  };
  const insertMenu = (opener) => {
    if (open?.opener === opener) { closeMenu(); return; }
    menuAt(opener, h('div', { role: 'menu', 'aria-label': t('Insert') },
      item('image', t('Picture…'), keyHint('⌘⇧I'), pickImage), ...grid(), h('div', { class: 'gp-hr', role: 'separator' }),
      item('link', t('Link…'), keyHint('⌘K'), () => openLinkEditor()),
      item('hr', t('Horizontal line'), null, () => { run('insertRule'); view.focus(); }),
      item('omega', t('Special characters…'), null, () => charsAt(opener))));
  };

  // Special characters: search by name or code point, by group; a click puts one in and the palette stays.
  const GROUPS = [['', 'All'], ['punctuation', 'Punctuation'], ['symbols', 'Symbols'], ['accents', 'Accents'], ['greek', 'Greek'], ['arrows', 'Arrows'], ['math', 'Math']];
  const charsAt = (opener) => {
    let cat = '';
    const search = h('input', { class: 'gzo-field', type: 'search', placeholder: t('Search'), 'aria-label': t('Search'), spellcheck: 'false' });
    const name = h('span'), code = h('kbd');
    const list = h('div', { class: 'gzo-cgrid', role: 'listbox', 'aria-label': t('Special characters…') });
    const chips = GROUPS.map(([id, label]) => h('button', { type: 'button', class: 'gzo-cat', 'aria-pressed': String(id === cat), onclick: () => { cat = id; for (const c of chips) c.setAttribute('aria-pressed', String(c === chips[GROUPS.findIndex((g) => g[0] === id)])); draw(); } }, t(label)));
    const tell = (x) => { name.textContent = x ? x.name : ''; code.textContent = x ? L.code(x.c) : ''; };
    const draw = () => {
      const found = L.searchChars(search.value, cat);
      list.replaceChildren(...found.map((x, i) => {
        const b = h('button', { type: 'button', role: 'option', class: 'gzo-char', title: `${x.name} ${L.code(x.c)}`, 'aria-label': x.name, tabindex: i ? '-1' : '0', text: x.c, onclick: () => { run('insertChar', x.c); } });
        b.addEventListener('focus', () => tell(x)); b.addEventListener('pointerenter', () => tell(x));
        return b;
      }));
      tell(found[0]);
    };
    search.addEventListener('input', draw);
    search.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); list.querySelector('button')?.focus(); } else if (e.key === 'Enter') { e.preventDefault(); list.querySelector('button')?.click(); } });
    list.addEventListener('keydown', (e) => {
      const all = [...list.querySelectorAll('button')], i = all.indexOf(document.activeElement), d = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 10, ArrowUp: -10 }[e.key];
      if (i < 0 || !d) return;
      e.preventDefault(); e.stopPropagation();
      const j = i + d;
      if (j < 0) { search.focus(); return; }
      all[Math.min(all.length - 1, j)]?.focus();
    });
    const el = h('div', { role: 'dialog', class: 'gzo-chars', 'aria-label': t('Special characters…') }, h('label', { class: 'gzo-search' }, icon('search'), search), h('div', { class: 'gzo-cats' }, chips), list, h('div', { class: 'gzo-cname' }, name, code));
    draw();
    menuAt(opener, el);
    search.focus();
  };

  // List styles: presets, this level's style, restart and continue.
  const listMenu = (opener) => {
    if (open?.opener === opener) { closeMenu(); return; }
    const st = view.state, a = ed.active(), $ = st.selection.$from;
    let list = null, item0 = null;
    for (let d = $.depth; d > 0; d--) if ($.node(d).type.name === 'list_item') { item0 = $.node(d); list = $.node(d - 1); break; }
    const ordered = a.list === 'ordered', bullet = a.list === 'bullet', styles = list ? L.levelStyles(list) : null, level = item0?.attrs.indent || 0;
    const as = (want, fn) => () => { if (a.list !== want) ed.run(want === 'ordered' ? 'orderedList' : 'bulletList'); fn(); view.focus(); };
    const NUM = [['decimal', '1.'], ['lower-alpha', 'a.'], ['lower-roman', 'i.'], ['upper-alpha', 'A.'], ['upper-roman', 'I.']], BUL = [['disc', '•'], ['circle', '◦'], ['square', '▪'], ['dash', '–']];
    const presetOn = (type, name) => list?.type.name === type && (L.PRESETS[type][name] || null) === (list.attrs.styles || null);
    menuAt(opener, h('div', { role: 'menu', 'aria-label': t('List style'), class: 'gzo-listmenu' },
      ...Object.keys(L.PRESETS.ordered_list).map((name) => item(null, name, null, as('ordered', () => run('listPreset', name)), { checked: presetOn('ordered_list', name) })),
      h('div', { class: 'gp-hr', role: 'separator' }),
      h('div', { class: 'gzo-mrow' }, NUM.map(([s, label]) => item(null, label, null, as('ordered', () => run('listStyle', s)), { checked: ordered && styles[level] === s }))),
      h('div', { class: 'gp-hr', role: 'separator' }),
      ...Object.keys(L.PRESETS.bullet_list).map((name) => item(null, name, null, as('bullet', () => run('listPreset', name)), { checked: presetOn('bullet_list', name) })),
      h('div', { class: 'gzo-mrow' }, BUL.map(([s, label]) => item(null, label, null, as('bullet', () => run('listStyle', s)), { checked: bullet && styles[level] === s }))),
      ordered ? h('div', { class: 'gp-hr', role: 'separator' }) : null,
      ordered ? item(null, t('Restart numbering'), null, () => { run('restart'); view.focus(); }, { checked: item0?.attrs.start != null }) : null,
      ordered ? item(null, t('Continue numbering'), null, () => { run('continueList'); view.focus(); }, { checked: !!list.attrs.continue }) : null));
  };

  // ---- the paper toolbar's buttons, once writer-paper.js has drawn it
  const mountToolbar = () => {
    const tool = document.querySelector('.gp .gp-tool');
    if (!tool || tool.querySelector('.gzo-insert')) return !!tool;
    const insert = h('button', { type: 'button', class: 'gzo-tbtn gzo-insert', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('plus'), t('Insert'), icon('caret'));
    insert.addEventListener('click', () => insertMenu(insert));
    tool.querySelector(':scope > .grow')?.before(insert);
    const numbers = tool.querySelector('[data-run="orderedList"]');
    if (numbers) {
      const caret = h('button', { type: 'button', class: 'gzo-caretbtn', title: t('List style'), 'aria-label': t('List style'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('caret'));
      caret.addEventListener('click', () => listMenu(caret));
      numbers.after(caret);
    }
    for (const b of tool.querySelectorAll('.gzo-insert, .gzo-caretbtn')) b.addEventListener('mousedown', (e) => e.preventDefault());
    return true;
  };

  // ---- the editor's plugins
  const ui = () => new GZ_PM.state.Plugin({
    props: {
      nodeViews: paperMode ? { image: (node, v, getPos) => new ImageView(node, v, getPos) } : {},
      handleKeyDown: (v, e) => {
        // Tab on a selected picture goes to its popover (Escape comes back).
        if (e.key === 'Tab' && !e.shiftKey && imageSel() && !imgPop.hidden) { e.preventDefault(); imgPop.querySelector('button').focus(); return true; }
        return false;
      },
      handlePaste: (v, e) => {
        const imgs = [...(e.clipboardData?.files || [])].filter((f) => L.IMAGE.types.includes(f.type));
        if (!paperMode || !imgs.length || e.clipboardData.getData('text/html')) return false;
        (async () => { for (const f of imgs) await loadImage(f); })();
        return true;
      },
      // Pasted pictures within the paper's bound: larger ones are left out (a file is made smaller; HTML can't be).
      transformPasted: (slice) => {
        if (!paperMode) return slice;
        let dropped = false;
        const walk = (frag) => {
          const out = [];
          frag.forEach((n) => {
            if (n.type.name === 'image' && /^data:/.test(n.attrs.src) && n.attrs.src.length * 0.75 > L.IMAGE.maxBytes) { dropped = true; return; }
            out.push(n.isLeaf ? n : n.copy(walk(n.content)));
          });
          return Fragment.from(out);
        };
        const content2 = walk(slice.content);
        if (!dropped) return slice;
        notify('Large pictures were left out of the paste.');
        return new Slice(content2, slice.openStart, slice.openEnd);
      },
    },
    view: () => ({ update: soon }),
  });

  F.on('ready', (editor) => {
    ed = editor; view = editor.view; paperMode = F.mode() === 'paper';
    cmds = L.commands(view.state.schema, { content });
    for (const p of [...L.plugins(view.state.schema, { onLink: openLinkEditor, onImage: pickImage }), ui()]) F.plugin(p);
    if (paperMode && !mountToolbar()) {
      const mo = new MutationObserver(() => { if (mountToolbar()) mo.disconnect(); });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  });
})();
