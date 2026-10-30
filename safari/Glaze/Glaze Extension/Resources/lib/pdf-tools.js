// The PDF viewer's tools (pdf-kind.js, loaded with the viewer of a kept PDF): Highlight, Pen, Text, Image, Shapes and
// Signature over pdf.js's own annotation editor (lib/pdfjs: AnnotationEditorUIManager, reached through the viewer's
// EventBus), with colour, size, Undo and Redo, as a group in Glaze's toolbar. What they add are the PDF's own annotations
// (Highlight, Ink, FreeText, Stamp), saved by the viewer's autosave as an incremental update and exported as they are,
// still editable. A shape is an Ink annotation whose strokes Glaze lays out (shape below), put on the page through
// AnnotationEditorLayer.deserialize, so it moves, resizes, recolours and undoes as pdf.js's own ink does. A file whose
// owner forbids adding annotations (getPermissions) shows the tools disabled, with the reason.
// Classic script; module.exports for node (shape is pure).
var GZ_PDF_TOOLS = globalThis.GZ_PDF_TOOLS || (() => {
  const SHAPES = [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['line', 'Line'], ['arrow', 'Arrow']];
  // Ink's colours and sizes, Text's, Highlight's. pdf.js's own highlight colours (its viewer's defaults).
  const INKS = [['#000000', 'Black'], ['#1a56db', 'Blue'], ['#d93025', 'Red'], ['#188038', 'Green'], ['#8e24aa', 'Purple']];
  const MARKS = [['#FFFF98', 'Yellow'], ['#53FFBC', 'Green'], ['#80EBFF', 'Blue'], ['#FFCBE6', 'Pink'], ['#FF4F5F', 'Red']];
  const SIZES = { ink: [1, 2, 4, 8, 12], text: [10, 12, 14, 18, 24, 36], highlight: [8, 12, 16, 24] };
  const HIGHLIGHTS = MARKS.map(([c, n]) => `${n.toLowerCase()}=${c}`).join(',');
  const NO_TOOLS = "The owner of this PDF doesn't allow adding to it.";

  // ---- a shape as pdf.js's Ink JSON. box: [x0, y0, x1, y1] in the page's PDF space (y up): a rectangle's or an ellipse's
  // corners, a line's or an arrow's ends. Each corner is given twice: pdf.js smooths an ink path through the midpoints of
  // its points (Outline.createBezierPoints), and a point given twice keeps its corner sharp, before and after a reload
  // (an Ink annotation keeps only its points). → { annotationType, color, thickness, opacity, paths, rect, rotation,
  // pageIndex }.
  const twice = (pts) => pts.flatMap(([x, y]) => [x, y, x, y]);
  const shape = (kind, [x0, y0, x1, y1], { color = [0, 0, 0], thickness = 2, pageIndex = 0, rotation = 0, type = 15 } = {}) => {
    let strokes;
    if (kind === 'rect') strokes = [twice([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]])];
    else if (kind === 'ellipse') {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2, n = 72, pts = [];
      for (let i = 0; i <= n + 1; i++) { const a = (i / n) * 2 * Math.PI; pts.push(cx + rx * Math.cos(a), cy + ry * Math.sin(a)); }
      strokes = [pts];
    } else if (kind === 'line') strokes = [twice([[x0, y0], [x1, y1]])];
    else if (kind === 'arrow') {
      const len = Math.hypot(x1 - x0, y1 - y0) || 1, head = Math.min(len * 0.4, 10 + 2.5 * thickness), a = Math.atan2(y1 - y0, x1 - x0), w = Math.PI / 7;
      const side = (s) => [x1 - head * Math.cos(a + s * w), y1 - head * Math.sin(a + s * w)];
      strokes = [twice([[x0, y0], [x1, y1]]), twice([side(1), [x1, y1], side(-1)])];
    } else throw new TypeError(`no shape ${kind}`);
    const xs = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 0)), ys = strokes.flatMap((s) => s.filter((_, i) => i % 2 === 1)), pad = thickness / 2 + 1;
    return { annotationType: type, color: [...color], thickness, opacity: 1, paths: { points: strokes.map((s) => Float32Array.from(s)) },
      rect: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad], rotation, pageIndex };
  };
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  // ---- the group. o: { P (pdf.mjs), viewer, bus, t, h, btn, openMenu(opener, items), modified(), scroll, signatures
  // (lib/pdf-sign.js's manager, or null), say(text) }. Mounted before the viewer has its document: pdf.js hands over its
  // editor once page 1 is read (annotationeditoruimanager). → { el, ready (resolves true when the tools are on, false when
  // the file forbids them), dispose }.
  const SVG = 'http://www.w3.org/2000/svg';
  const ICONS = {
    select: 'M5 3l14 8-6 1.5L10 19z', highlight: 'M4 20h7M14.5 4.5l5 5L10 19H5v-5z', pen: 'M4 20c3-1 4-3 6-5s5-7 7-9a2 2 0 0 1 3 3c-2 2-7 5-9 7s-4 3-5 6', text: 'M5 6V4h14v2M12 4v16M9 20h6',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01', shape: 'M3 10h8v10H3zM17 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8M14 21l7-7', signature: 'M3 17c3-6 5-9 6-7s-2 8 1 7 3-5 5-4 1 3 3 3 2-1 3-2M3 21h18',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'm15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3', caret: 'm6 9 6 6 6-6',
  };
  const icon = (d) => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'gp-ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', d); s.append(p); return s; };

  const mount = (o) => {
    const { P, viewer, bus, t, h, btn, openMenu } = o, T = P.AnnotationEditorType, K = P.AnnotationEditorParamsType;
    const life = new AbortController(), signal = life.signal;
    const MODES = { highlight: T.HIGHLIGHT, pen: T.INK, text: T.FREETEXT, image: T.STAMP, shape: T.INK, signature: T.SIGNATURE };
    const TOOLS = [['highlight', 'Highlight'], ['pen', 'Pen'], ['text', 'Text'], ['image', 'Image'], ['shape', 'Shapes'], ['signature', 'Signature']].filter(([id]) => id !== 'signature' || o.signatures);
    const family = (id) => (id === 'pen' || id === 'shape' ? 'ink' : id === 'text' ? 'text' : id === 'highlight' ? 'highlight' : null);
    const params = { ink: { color: INKS[0][0], size: 2 }, text: { color: INKS[0][0], size: 12 }, highlight: { color: MARKS[0][0], size: 12 } };
    let tool = null, shapeKind = 'rect', ui = null, on = false, armed = false, drag = null;

    const buttons = Object.fromEntries(TOOLS.map(([id, label]) => [id, btn({ class: 'gq-ib gq-tool', 'data-tool': id, 'aria-pressed': 'false', title: t(label), 'aria-label': t(label), disabled: true, ...(id === 'shape' && { 'aria-haspopup': 'menu', 'aria-expanded': 'false' }) }, icon(ICONS[id]))]));
    const swatch = h('span', { class: 'gq-swatch' });
    const colorB = btn({ class: 'gq-ib', 'data-act': 'color', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('Color'), 'aria-label': t('Color'), disabled: true }, swatch);
    const sizeL = h('span', { class: 'gq-size' });
    const sizeB = btn({ class: 'gp-box gq-sizeb', 'data-act': 'size', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('Size'), 'aria-label': t('Size'), disabled: true }, sizeL, icon(ICONS.caret));
    const undoB = btn({ class: 'gq-ib', 'data-act': 'undo', title: t('Undo'), 'aria-label': t('Undo'), disabled: true }, icon(ICONS.undo));
    const redoB = btn({ class: 'gq-ib', 'data-act': 'redo', title: t('Redo'), 'aria-label': t('Redo'), disabled: true }, icon(ICONS.redo));
    const el = h('span', { class: 'gq-tools', role: 'group', 'aria-label': t('Tools') }, ...Object.values(buttons), colorB, sizeB, h('span', { class: 'gp-sepv' }), undoB, redoB);

    // What the colour and size controls show: the current tool's (Pen and Shapes share ink's).
    const showParams = () => {
      const f = family(tool), p = f && params[f];
      colorB.hidden = sizeB.hidden = !p;
      if (!p) return;
      swatch.style.background = p.color;
      sizeL.textContent = String(p.size);
    };
    const push = () => {
      const f = family(tool), p = f && params[f];
      if (!p || !ui) return;
      const send = (type, value) => bus.dispatch('switchannotationeditorparams', { source: el, type, value });
      if (f === 'ink') { send(K.INK_COLOR, p.color); send(K.INK_THICKNESS, p.size); }
      else if (f === 'text') { send(K.FREETEXT_COLOR, p.color); send(K.FREETEXT_SIZE, p.size); }
      else { send(K.HIGHLIGHT_COLOR, p.color); send(K.HIGHLIGHT_THICKNESS, p.size); }
    };
    const pressed = () => {
      for (const [id, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(id === tool));
      el.dataset.active = tool || '';
      showParams();
    };
    // pdf.js switches its mode itself too (a double click on a note it drew, a pasted editor): the group follows.
    const toolOf = (mode) => (mode === T.INK ? (tool === 'shape' ? 'shape' : 'pen') : Object.keys(MODES).find((id) => MODES[id] === mode && id !== 'shape') || null);
    let after = null;
    bus.on('annotationeditormodechanged', ({ mode }) => {
      tool = toolOf(mode);
      pressed(); push();
      const next = after; after = null;
      if (next && mode === next.mode) next.run();
    }, { signal });
    bus.on('switchannotationeditormode', (e) => { if (on && e.source !== el) viewer.annotationEditorMode = { mode: e.mode, editId: e.editId ?? null, isFromKeyboard: !!e.isFromKeyboard, mustEnterInEditMode: !!e.mustEnterInEditMode, editComment: !!e.editComment }; }, { signal });
    const setMode = (mode, { keyboard = false, then = null } = {}) => {
      after = then && { mode, run: then };
      if (viewer.annotationEditorMode === mode) { const next = after; after = null; next?.run(); tool = toolOf(mode) || tool; pressed(); return; }
      viewer.annotationEditorMode = { mode, isFromKeyboard: keyboard && mode === T.FREETEXT };
    };
    // A new editor in the middle of the page in view: an image's picker, a signature's dialog (pdf.js's CREATE).
    const create = () => bus.dispatch('switchannotationeditorparams', { source: el, type: K.CREATE, value: null });
    const choose = (id, e) => {
      if (!on) return;
      const keyboard = e?.detail === 0;
      if (id === 'image' || id === 'signature') { tool = id; setMode(MODES[id], { then: create }); return; }
      if (tool === id && id !== 'shape') { off(); return; }
      tool = id;
      setMode(MODES[id], { keyboard });
      pressed();
    };
    const off = () => { tool = null; armed = false; if (on) viewer.annotationEditorMode = { mode: T.NONE }; pressed(); };
    for (const [id, b] of Object.entries(buttons)) {
      if (id === 'shape') b.addEventListener('click', () => openMenu(b, SHAPES.map(([k, label]) => [t(label), (e) => { shapeKind = k; choose('shape'); armed = true; if (e?.detail === 0) placeShape(k); }, { 'data-shape': k, 'aria-checked': String(k === shapeKind), role: 'menuitemradio' }])));
      else b.addEventListener('click', (e) => choose(id, e));
    }
    colorB.addEventListener('click', () => {
      const f = family(tool);
      if (!f) return;
      openMenu(colorB, (f === 'highlight' ? MARKS : INKS).map(([c, label]) => [h('span', { class: 'gq-menu-sw' }, ((sw) => { sw.style.background = c; return sw; })(h('span', { class: 'gq-swatch' })), t(label)), () => { params[f].color = c; showParams(); push(); }, { 'data-color': c, role: 'menuitemradio', 'aria-checked': String(params[f].color === c) }]));
    });
    sizeB.addEventListener('click', () => {
      const f = family(tool);
      if (!f) return;
      openMenu(sizeB, SIZES[f].map((n) => [String(n), () => { params[f].size = n; showParams(); push(); }, { 'data-size': String(n), role: 'menuitemradio', 'aria-checked': String(params[f].size === n) }]));
    });
    // One more step back after pdf.js's own: the viewer's (the pages panel's Done, extraUndo).
    let extra = null, canUndo = false;
    undoB.addEventListener('click', () => { if (canUndo || !extra) bus.dispatch('editingaction', { source: el, name: 'undo' }); else extra.run(); });
    redoB.addEventListener('click', () => bus.dispatch('editingaction', { source: el, name: 'redo' }));
    bus.on('editingstateschanged', ({ details }) => {
      if (!on) return;
      canUndo = !!details.hasSomethingToUndo;
      undoB.disabled = !canUndo && !extra;
      redoB.disabled = !details.hasSomethingToRedo;
    }, { signal });

    // ---- pdf.js's editor: every command it records (an editor added, moved, resized, recoloured, typed into, deleted)
    // and every undo or redo is a change the viewer saves.
    let ready;
    const settled = new Promise((r) => { ready = r; });
    let session = null, pressedDown = false;
    bus.on('annotationeditoruimanager', ({ uiManager }) => {
      ui = uiManager;
      // pdf.js queues DOM placement for reading order. Reparenting a live contenteditable resets its caret, or
      // triggers focusout before the deferred refocus. Its commit queues placement again once typing has ended.
      const addLayer = ui.addLayer.bind(ui);
      ui.addLayer = (layer) => {
        const move = layer.moveEditorInDOM.bind(layer);
        layer.moveEditorInDOM = (editor) => {
          if (editor.mode === T.FREETEXT && editor.isEditing) return;
          return move(editor);
        };
        return addLayer(layer);
      };
      // The layer a pen is drawing on: pdf.js keeps its strokes as one drawing until the session ends (commit).
      const setSession = ui.setCurrentDrawingSession.bind(ui);
      ui.setCurrentDrawingSession = (layer) => { session = layer; return setSession(layer); };
      for (const name of ['addCommands', 'undo', 'redo']) {
        const own = ui[name].bind(ui);
        ui[name] = (...args) => { const out = own(...args); o.modified(); return out; };
      }
    }, { signal });
    // Once page 1 is read: the file's permissions decide. pdf.js makes no editor where the owner forbids changing the
    // file's contents; Glaze also honours the bit for adding annotations (ISO 32000-1, table 22).
    const decide = async (doc) => {
      const perms = await doc.getPermissions().catch(() => null);
      on = !!ui && (!perms || perms.includes(P.PermissionFlag.MODIFY_ANNOTATIONS));
      for (const b of [...Object.values(buttons), colorB, sizeB]) { b.disabled = !on; if (!on) b.title = t(NO_TOOLS); }
      if (!on) { el.title = t(NO_TOOLS); el.dataset.off = ''; }
      showParams();
      undoB.disabled = !extra && !canUndo;
      ready(on);
      return on;
    };

    // ---- shapes: drawn by dragging on a page (a box, or a line's two ends) while Shapes is the tool; chosen with the
    // keyboard, one goes in the middle of the page in view, selected, to move with the arrow keys.
    const layerOf = (pageIndex) => viewer.getPageView(pageIndex)?.annotationEditorLayer?.annotationEditorLayer || null;
    const put = async (pageIndex, box) => {
      const pv = viewer.getPageView(pageIndex), layer = layerOf(pageIndex);
      if (!pv || !layer || !ui) return null;
      const data = shape(shapeKind, box, { color: rgb(params.ink.color), thickness: params.ink.size, pageIndex, rotation: pv.viewport.rotation, type: T.INK });
      const editor = await layer.deserialize(data);
      if (!editor) return null;
      ui.addCommands({ cmd: () => layer.addOrRebuild(editor), undo: () => editor.remove(), mustExec: true });
      return editor;
    };
    const placeShape = async (kind) => {
      shapeKind = kind;
      const pv = viewer.getPageView((viewer.currentPageNumber || 1) - 1);
      if (!pv) return;
      const [x0, y0, x1, y1] = pv.pdfPage.view, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = (x1 - x0) / 6;
      const box = kind === 'line' || kind === 'arrow' ? [cx - w, cy, cx + w, cy] : [cx - w, cy - w * 0.66, cx + w, cy + w * 0.66];
      const editor = await put(pv.id - 1, box);
      if (editor) { ui.setSelected(editor); editor.div?.focus(); }
    };
    o.scroll.addEventListener('pointerdown', (e) => {
      if (!on || tool !== 'shape' || !armed || e.button !== 0) return;
      const pageDiv = e.target.closest?.('.page[data-page-number]');
      if (!pageDiv || e.target.closest('.annotationEditorLayer > div')) return;
      e.preventDefault(); e.stopPropagation();
      const pv = viewer.getPageView(Number(pageDiv.dataset.pageNumber) - 1), r = pageDiv.getBoundingClientRect();
      const at = (ev) => [Math.max(0, Math.min(r.width, ev.clientX - r.left)), Math.max(0, Math.min(r.height, ev.clientY - r.top))];
      const preview = document.createElementNS(SVG, 'svg');
      preview.setAttribute('class', 'gq-shape-draft');
      const mark = document.createElementNS(SVG, shapeKind === 'ellipse' ? 'ellipse' : shapeKind === 'rect' ? 'rect' : 'line');
      mark.setAttribute('stroke', params.ink.color); mark.setAttribute('stroke-width', String(params.ink.size * pv.scale)); mark.setAttribute('fill', 'none');
      preview.append(mark); pageDiv.append(preview);
      drag = { pv, from: at(e), to: at(e), preview, mark };
      const draw = () => {
        const [[ax, ay], [bx, by]] = [drag.from, drag.to];
        if (shapeKind === 'rect') Object.entries({ x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) }).forEach(([k, v]) => mark.setAttribute(k, v));
        else if (shapeKind === 'ellipse') Object.entries({ cx: (ax + bx) / 2, cy: (ay + by) / 2, rx: Math.abs(bx - ax) / 2, ry: Math.abs(by - ay) / 2 }).forEach(([k, v]) => mark.setAttribute(k, v));
        else Object.entries({ x1: ax, y1: ay, x2: bx, y2: by }).forEach(([k, v]) => mark.setAttribute(k, v));
      };
      pageDiv.setPointerCapture?.(e.pointerId);
      const move = (ev) => { drag.to = at(ev); draw(); };
      const up = async (ev) => {
        pageDiv.removeEventListener('pointermove', move); pageDiv.removeEventListener('pointerup', up); pageDiv.removeEventListener('pointercancel', up);
        const d = drag; drag = null; d.preview.remove();
        if (ev.type === 'pointercancel') return;
        d.to = at(ev);
        if (Math.hypot(d.to[0] - d.from[0], d.to[1] - d.from[1]) < 4) return;
        const [ax, ay] = d.pv.viewport.convertToPdfPoint(...d.from), [bx, by] = d.pv.viewport.convertToPdfPoint(...d.to);
        await put(d.pv.id - 1, shapeKind === 'line' || shapeKind === 'arrow' ? [ax, ay, bx, by] : [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
      };
      pageDiv.addEventListener('pointermove', move, { signal });
      pageDiv.addEventListener('pointerup', up, { signal });
      pageDiv.addEventListener('pointercancel', up, { signal });
      draw();
    }, { capture: true, signal });
    // Esc with nothing of pdf.js's to close puts the tool down.
    document.addEventListener('keydown', (e) => { if (!e.defaultPrevented && e.key === 'Escape' && tool && !document.querySelector('.gq-menu, dialog[open]')) { e.preventDefault(); off(); } }, { signal });

    o.scroll.addEventListener('pointerdown', () => { pressedDown = true; }, { capture: true, signal });
    addEventListener('pointerup', () => { pressedDown = false; }, { capture: true, signal });
    addEventListener('pointercancel', () => { pressedDown = false; }, { capture: true, signal });
    // Before a save: the pen's drawing becomes its annotation (unless a stroke is under way: its end saves again). Leaving
    // (all): the note being typed is kept too.
    const commit = (all = false) => {
      if (!ui) return;
      try {
        if (session && !pressedDown) session.commitOrRemove();
        if (all) ui.commitOrRemove();
      } catch (e) { console.error(e); }
    };

    pressed();
    const dispose = () => { life.abort(); drag?.preview.remove(); };
    return { el, decide, commit, ready: settled, dispose, extraUndo: (x) => { extra = x; undoB.disabled = false; }, get tool() { return tool; } };
  };

  return { SHAPES, INKS, MARKS, SIZES, HIGHLIGHTS, NO_TOOLS, shape, mount };
})();

if (typeof module !== 'undefined') module.exports = GZ_PDF_TOOLS; else GZ_PDF_TOOLS;
