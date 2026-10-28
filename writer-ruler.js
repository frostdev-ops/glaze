// Glaze Writer's ruler (writer.html, after writer-paper.js): a strip above a paper's pages, the page's width at the zoom,
// numbered in inches from the left margin with eighth-inch ticks, the margins shaded. Its markers are the caret's
// paragraph: first-line indent (the top triangle), hanging indent (the bottom triangle: the left indent, the first line
// staying where it is), left indent (the box under it: both together), right indent, and the paragraph's own tab stops
// (left, centre, right, decimal). Drag a marker to set it (snapped to a sixteenth of an inch; the format's own value is
// stored as none), drag a margin's edge to change the page's margins (the paper's page setup), click the strip to add a
// left tab stop, click a stop to cycle its kind, drag a stop off the ruler to remove it. Shown unless storage.sync
// writer.ruler is false; ⋯ → Show ruler sets that. Paper mode only, and mouse only: the Paragraph dialog and Page
// setup… are the keyboard's way to the same settings.
var GZ_WRITER_RULER = globalThis.GZ_WRITER_RULER || (() => {
  const api = { shown: () => false, toggle: () => {} };
  const F = globalThis.GZ_WRITER_FRAME;
  if (!F || typeof document === 'undefined') return api;
  const PX = 96, SNAP = 1 / 16, NEXT = { l: 'c', c: 'r', r: 'd', d: 'l' };
  const h = (tag, cls, kids = []) => { const e = document.createElement(tag); if (cls) e.className = cls; e.append(...kids); return e; };
  let on = true, paper = null, el = null, strip = null, ticks = null, marks = null, tickKey = '', frame = 0, drag = null;

  // Settings → Writer (lib/writer-settings.js): writer.ruler, which ⋯ → Show ruler sets.
  const SET = globalThis.GZ_WRITER_SETTINGS;
  SET?.follow((w) => { on = w?.ruler !== false; draw(); });
  const toggle = async () => {
    on = !on;
    draw();
    try { await SET?.patch((w) => ({ ...w, ruler: on })); } catch { /* kept for this paper */ }
  };

  const ST = () => globalThis.GZ_WRITER_STYLES;
  const view = () => paper?.editor.view;
  // The caret's paragraph: its node, where it sits (a quote's, a list entry's), its left, first-line and right indents in
  // inches from the margin, and its stops.
  const para = () => {
    const v = view(), f = paper.look(), $ = v.state.selection.$from, node = $.parent, list = ST().listAt(v.state.doc);
    let quote = false;
    for (let d = $.depth; d > 0; d--) if ($.node(d).type.name === 'blockquote') quote = true;
    const i = $.depth ? $.index(0) : -1, where = { quote, entry: !!list && $.depth === 1 && node.type.name === 'paragraph' && i >= list.from && i < list.to, heading: node.type.name === 'heading' ? node.attrs.level : 0 };
    const a = node.attrs, base = ST().paraBase(f, where, a.align || undefined), item = node.type.name === 'list_item';
    const left = (a.left ?? (item ? (a.indent || 0) * 0.5 + 0.5 : a.indent ? a.indent * 0.5 : base.left)) + (quote ? f.quote.indent : 0);
    return { node, where, base, item, quote: quote ? f.quote.indent : 0, left, first: item ? 0 : a.first ?? base.first, right: a.right ?? 0, tabs: a.tabs || [] };
  };
  const snap = (inches) => Math.round(inches / SNAP) * SNAP;
  const r2 = (n) => Math.round(n * 100) / 100;

  const mount = () => {
    paper = globalThis.GZ_WRITER_PAPER?.current?.() || null;
    if (!paper?.view || el) return !!el;
    el = h('div', 'gr-ruler');
    el.setAttribute('aria-hidden', 'true');
    strip = h('div', 'gr-strip');
    ticks = h('div', 'gr-ticks');
    marks = h('div', 'gr-marks');
    strip.append(ticks, marks);
    el.append(strip);
    paper.view.col.prepend(el);
    paper.view.onDraw(soon);
    paper.view.canvas.addEventListener('scroll', soon, { passive: true });
    addEventListener('resize', soon);
    strip.addEventListener('pointerdown', down);
    draw();
    return true;
  };
  const soon = () => { frame ||= requestAnimationFrame(draw); };

  // ---- drawing
  function draw() {
    frame = 0;
    if (!el) return;
    el.hidden = !on || !paper || F.mode() !== 'paper';
    if (el.hidden) return;
    const g = paper.view.geometry(), sc = paper.view.scale(), box = paper.view.size.getBoundingClientRect(), col = el.getBoundingClientRect();
    strip.style.left = `${box.left - col.left}px`;
    strip.style.width = `${g.width * sc}px`;
    strip.style.setProperty('--ml', `${g.left * sc}px`);
    strip.style.setProperty('--mr', `${g.right * sc}px`);
    const key = `${g.width}|${g.left}|${sc}`;
    if (key !== tickKey) {
      tickKey = key;
      const out = [], step = SNAP * 2 * PX * sc; // eighth inches
      for (const dir of [1, -1]) {
        for (let k = dir > 0 ? 0 : 1; ; k++) {
          const x = g.left * sc + dir * k * step;
          if (x < 0 || x > g.width * sc) break;
          const tick = h('i', k % 8 === 0 ? 'gr-inch' : k % 4 === 0 ? 'gr-half' : k % 2 === 0 ? 'gr-quarter' : 'gr-eighth');
          tick.style.left = `${x}px`;
          if (k % 8 === 0 && k) tick.textContent = String(k / 8);
          out.push(tick);
        }
      }
      ticks.replaceChildren(...out);
    }
    const v = view();
    if (!v || drag) return;
    const p = para(), m = g.left * sc, at = (inches) => `${m + inches * PX * sc}px`;
    const marker = (cls, x, data) => { const e = h('b', `gr-m ${cls}`); e.style.left = x; Object.assign(e.dataset, data); return e; };
    marks.replaceChildren(
      marker('gr-first', at(p.left + p.first), { kind: 'first' }),
      marker('gr-hang', at(p.left), { kind: 'hang' }),
      marker('gr-left', at(p.left), { kind: 'left' }),
      marker('gr-right', `${(g.width - g.right) * sc - p.right * PX * sc}px`, { kind: 'right' }),
      marker('gr-edge gr-edge-l', `${m}px`, { kind: 'margin-l' }),
      marker('gr-edge gr-edge-r', `${(g.width - g.right) * sc}px`, { kind: 'margin-r' }),
      ...p.tabs.map(([pos, kind], i) => marker(`gr-tab gr-tab-${kind}`, at(pos + p.quote), { kind: 'tab', i: String(i) })),
    );
  }

  // ---- dragging and clicking
  const inchesAt = (e) => { const g = paper.view.geometry(), sc = paper.view.scale(), r = strip.getBoundingClientRect(); return (e.clientX - r.left) / sc / PX - g.left / PX; };
  function down(e) {
    if (e.button !== 0 || !paper) return;
    e.preventDefault();
    const target = e.target.closest('.gr-m'), p = para();
    drag = { kind: target?.dataset.kind || 'new', i: +(target?.dataset.i ?? -1), el: target, p, x0: e.clientX, y0: e.clientY, moved: false };
    strip.setPointerCapture(e.pointerId);
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', up, { once: true });
    strip.addEventListener('pointercancel', cancel, { once: true });
  }
  function move(e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x0) > 2 || Math.abs(e.clientY - drag.y0) > 2) drag.moved = true;
    if (!drag.el || !drag.moved) return;
    const r = strip.getBoundingClientRect(), x = Math.max(0, Math.min(r.width, e.clientX - r.left));
    const g = paper.view.geometry(), sc = paper.view.scale(), sx = Math.round((snap((x / sc - g.left) / PX) * PX + g.left) * sc);
    drag.el.style.left = `${sx}px`;
    if (drag.kind === 'left') for (const m of marks.querySelectorAll('.gr-hang, .gr-first')) m.style.left = m.classList.contains('gr-hang') ? `${sx}px` : `${sx + drag.p.first * PX * sc}px`;
    if (drag.kind === 'hang') marks.querySelector('.gr-left').style.left = `${sx}px`;
    drag.el.classList.toggle('gr-off', drag.kind === 'tab' && Math.abs(e.clientY - drag.y0) > 24);
  }
  const cancel = () => { strip.removeEventListener('pointermove', move); drag = null; draw(); };
  function up(e) {
    strip.removeEventListener('pointermove', move);
    const d = drag;
    drag = null;
    if (!d || !paper) return;
    const ed = paper.editor, p = d.p, g = paper.view.geometry(), at = r2(snap(inchesAt(e))), content = g.content / PX;
    // A value as the paragraph stores it: none where it is the format's own.
    const own = (k, v) => (Math.abs(v - p.base[k]) < 0.005 ? null : r2(v));
    if (d.kind === 'tab') {
      const tabs = p.tabs.map((x) => [...x]);
      if (Math.abs(e.clientY - d.y0) > 24) tabs.splice(d.i, 1);
      else if (!d.moved) tabs[d.i][1] = NEXT[tabs[d.i][1]] || 'l';
      else tabs[d.i][0] = Math.max(0, Math.min(content, at - p.quote));
      ed.run('tabs', tabs);
    } else if (d.kind === 'new') {
      if (!d.moved && at > 0 && at < content) ed.run('tabs', [...p.tabs, [r2(at - p.quote), 'l']]);
    } else if (d.moved && d.kind.startsWith('margin')) {
      const s = ST().setup(paper.editor.view.state.doc.attrs.setup) || ST().pageSetup(paper.format()), mg = [...s.margins];
      if (d.kind === 'margin-l') mg[3] = Math.max(0, r2(mg[3] + at)); else mg[1] = Math.max(0, r2(g.width / PX - (at + g.left / PX)));
      paper.setup?.({ margins: mg });
    } else if (d.moved) {
      const left = Math.max(-1, Math.min(content - 0.5, at - p.quote));
      if (d.kind === 'first') ed.run('paragraph', { first: own('first', at - p.quote - (p.left - p.quote)) });
      else if (d.kind === 'hang') ed.run('paragraph', { ...(p.item ? {} : { left: own('left', left) }), first: own('first', p.left - p.quote + p.first - left) });
      else if (d.kind === 'left' && !p.item) ed.run('paragraph', { left: own('left', left) });
      else if (d.kind === 'right') ed.run('paragraph', { right: own('right', Math.max(-1, Math.min(content - 0.5, content - at))) });
    }
    view()?.focus();
    draw();
  }

  F.plugin(new GZ_PM.state.Plugin({ view: () => ({ update: soon }) }));
  F.on('ready', () => {
    if (F.mode() !== 'paper' || mount()) return;
    // The paper mounts after the editor is ready (its libraries load first); its toolbar's buttons arrive after that.
    const mo = new MutationObserver(() => { if (mount()) mo.disconnect(); });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  return Object.assign(api, { shown: () => on, toggle, draw: soon });
})();
if (typeof module !== 'undefined') module.exports = GZ_WRITER_RULER;
