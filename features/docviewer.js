// Glaze in Canvas's document viewer, DocViewer: Instructure's canvadocs app on its own host, always in a frame of a Canvas
// page. Its own manifest entry (with lib/ink.js) in every frame on a canvadocs host; the first content script stays off them.
// (1) The palette: the viewer's background, toolbar and thumbnails in Glaze's colors. The pages stay as the document has
// them, or are dimmed or inverted in a dark palette (enhance.docPages). The toolbar is themed only while it holds nothing
// but the page, zoom, rotate and full-screen controls, so a signed-in student's annotation tools keep Canvas's own look.
// (2) Annotations (enhance.docInk, off by default): pen, highlighter and eraser on an SVG layer over each page, kept in
// storage.local per Canvas site, person and file (lib/ink.js) and never sent anywhere. Undo, redo, clear page, export and
// import as a file, a page saved as a picture. Canvas's own annotations are left alone: Glaze's layer takes the pointer
// only while one of its tools is picked, and picking one of Canvas's puts Glaze's down.
// What it can't know it asks the Canvas page around it (content.js, "DocViewer"): the palette, the switches, which file
// and whose, and Glaze's words in the page's language. Asked at that page's origin only, answers taken only from it; the
// page tells it again whenever any of that changes. No polling: a MutationObserver, only while annotations are on, puts
// the layer back on pages the viewer draws again as it scrolls and zooms.
(() => {
  if (window.__gzDocs || window.top === window || !/^canvadocs(-[\w-]+)?\.instructure\.com$/.test(location.hostname) || !/html/.test(document.contentType)) return;
  window.__gzDocs = true;
  const I = GZ_INK;
  const html = document.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  // The Canvas page's origin: Chrome and Safari name it, Firefox has the referrer.
  let canvas = location.ancestorOrigins?.[0];
  if (!canvas) try { canvas = new URL(document.referrer).origin; } catch { /* none: nothing to ask */ }
  if (!/^https:\/\/[a-z\d.-]+(:\d+)?$/i.test(canvas || '')) return;

  const WORDS = ['Annotations', 'Annotate', 'Pen', 'Highlighter', 'Eraser', 'Black', 'Red', 'Blue', 'Green', 'Yellow', 'Custom color', 'Size',
    'Undo', 'Redo', 'Clear page', 'Export annotations', 'Import annotations', 'Save page as picture', 'Done',
    "Couldn't save on this device", "That file isn't Glaze annotations", 'Annotations imported', "This page isn't drawn yet"];
  let words = {};
  const t = (s) => words[s] || s;

  // ---- the palette ------------------------------------------------------------------------------------------------
  const BAR = '.ViewerControls:not(:has(button:not(.ViewerControls--page-controls button, .DocumentControls button)))';
  const CSS = `html[data-gz-docs] { color-scheme: var(--gz-scheme); scrollbar-color: var(--gz-line-strong) transparent; }
html[data-gz-docs] :is(body, #App, .Pages) { background: var(--gz-surface-2) !important; color: var(--gz-ink) !important; }
html[data-gz-docs] ${BAR} { background: var(--gz-surface) !important; color: var(--gz-ink) !important; border-color: var(--gz-line) !important; box-shadow: 0 1px 0 var(--gz-line) !important; }
html[data-gz-docs] ${BAR} :is(button, input, span, div) { color: inherit !important; }
html[data-gz-docs] ${BAR} svg { fill: currentColor; }
html[data-gz-docs] ${BAR} input { background: var(--gz-surface-2) !important; border: 1px solid var(--gz-line-strong) !important; border-radius: 6px; }
html[data-gz-docs] ${BAR} button:is(:hover, :focus-visible):not(:disabled) .AnnotationControlButton-outer { background: var(--gz-accent-soft) !important; }
html[data-gz-docs] ${BAR} :is(button, input):focus-visible { outline: 2px solid var(--gz-accent) !important; outline-offset: 1px; }
html[data-gz-docs] ${BAR} button:disabled { opacity: 0.45; }
html[data-gz-docs] .Page { box-shadow: 0 0 0 1px var(--gz-line-strong), 0 2px 10px rgb(0 0 0 / 0.3) !important; }
html[data-gz-docs] [class*="Thumbnail"]:not(canvas, img) { background-color: var(--gz-surface) !important; border-color: var(--gz-line) !important; color: var(--gz-ink) !important; }
html[data-gz-pages="dim"] .Page-canvas-container { filter: brightness(0.8) contrast(1.05); }
html[data-gz-pages="dark"] .Page-canvas-container { filter: invert(0.9) hue-rotate(180deg); }
.gz-ink { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 5; pointer-events: none; overflow: visible; }
html[data-gz-tool] .gz-ink { pointer-events: auto; cursor: crosshair; touch-action: none; }
html[data-gz-tool="eraser"] .gz-ink { cursor: cell; }
html[data-gz-tool][data-gz-pencil] .gz-ink { touch-action: pan-x pan-y pinch-zoom; }`;
  let got = null; // the Canvas page's last answer
  let style = null;
  const paint = () => {
    html.toggleAttribute('data-gz-docs', got.on && got.theme);
    if (got.on && got.dark && got.pages !== 'plain') html.setAttribute('data-gz-pages', got.pages);
    else html.removeAttribute('data-gz-pages');
    if (!got.on) { style?.remove(); style = null; return; }
    style ||= document.createElement('style');
    const css = `:root { ${got.colors.map(([k, v]) => `${k}: ${v}; `).join('')}--gz-scheme: ${got.dark ? 'dark' : 'light'}; }\n${CSS}`;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) (document.head || html).append(style);
  };

  // ---- the Canvas page --------------------------------------------------------------------------------------------
  const ask = () => { try { parent.postMessage({ gz: 'docs?', words: WORDS }, canvas); } catch { /* the page went away */ } };
  addEventListener('message', (e) => {
    const r = e.data;
    if (e.source !== parent || e.origin !== canvas || r?.gz !== 'docs') return;
    const said = JSON.stringify(words);
    words = Object.fromEntries(Object.entries(r.words || {}).filter(([k, v]) => WORDS.includes(k) && typeof v === 'string' && v.length <= 200));
    got = {
      on: r.on === true, dark: r.dark === true, theme: r.theme === true, ink: r.ink === true, pages: ['dim', 'dark'].includes(r.pages) ? r.pages : 'plain',
      colors: Object.entries(r.colors || {}).filter(([k, v]) => /^--gz-[a-z\d-]{1,24}$/.test(k) && /^#[0-9a-f]{6}$/i.test(v)).slice(0, 40),
    };
    paint();
    const k = got.on && got.ink ? I.storeKey(canvas, String(r.user || ''), String(r.file || '')) : null;
    if (k !== key) open(k);
    else if (bar && said !== JSON.stringify(words)) { const was = expanded; hideBar(); showBar(was); }
  });
  ask();
  // Once more when the frame's document is in, in case the page's Glaze was still starting.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (!got) ask(); }, { once: true });

  // ---- annotations ------------------------------------------------------------------------------------------------
  const stamp = Math.random().toString(36).slice(2); // this frame's own writes, told apart from another tab's
  let key = null;
  let pages = {}; // page number -> strokes
  let done = [], undone = [];
  let gen = 0;
  const ver = {};
  let tool = null;
  let live = null; // the stroke or erasing under way
  let rot = 0; // quarter turns made with the viewer's rotate button since it opened
  const color = { pen: '#e11d48', hl: '#fde047' };
  let size = 3;
  const width = () => (tool === 'hl' ? size * 6 : size * 1.2);

  const local = (f) => { try { return f(chrome.storage.local); } catch { return Promise.reject(new Error('reloaded')); } };
  const save = () => {
    const k = key;
    if (!k) return;
    local((s) => (Object.keys(pages).length ? s.set({ [k]: { v: 1, by: stamp, pages } }) : s.remove(k))).then(() => say(''), () => say(t("Couldn't save on this device")));
  };
  try {
    chrome.storage.onChanged.addListener((c, area) => {
      if (area !== 'local' || !key || !(key in c) || c[key].newValue?.by === stamp) return;
      pages = I.clean(c[key].newValue?.pages);
      done = []; undone = [];
      gen++;
      mountAll();
      syncBar();
    });
  } catch { /* extension reloaded under the frame */ }

  let mo = null, queued = 0;
  const schedule = () => { if (key && !queued) queued = requestAnimationFrame(() => { queued = 0; mountAll(); }); };
  const open = (k) => {
    key = k;
    pages = {}; done = []; undone = [];
    gen++;
    setTool(null);
    if (!k) {
      mo?.disconnect(); mo = null;
      hideBar();
      for (const s of document.querySelectorAll('.gz-ink')) s.remove();
      return;
    }
    local((s) => s.get(k)).then((r) => {
      if (key !== k) return;
      pages = I.clean(r[k]?.pages);
      mo ||= new MutationObserver((rs) => { if (rs.some((x) => !x.target.closest?.('.gz-ink'))) schedule(); });
      mo.observe(html, { childList: true, subtree: true });
      if (!bar) showBar(false);
      mountAll();
    }, () => {});
  };

  // The rotate button turns the pages (its label in Canvas's languages). A viewer that turns them with a CSS transform
  // turns Glaze's layer with them, so there it stays unturned.
  addEventListener('click', (e) => {
    if (/rotat|dreh|gira|pivot|draai/i.test(e.target.closest?.('button')?.getAttribute('aria-label') || '')) { rot = (rot + 1) % 4; schedule(); }
  }, true);
  const turn = (page) => (page.closest('[style*="rotate"]') ? 0 : rot);

  const pathOf = (s) => {
    const p = document.createElementNS(NS, 'path');
    for (const [a, v] of [['d', I.path(s.p)], ['fill', 'none'], ['stroke', s.c], ['stroke-width', s.w], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['opacity', s.t === 'hl' ? 0.35 : 1]]) p.setAttribute(a, v);
    return p;
  };
  const mount = (page) => {
    const n = page.id.slice(5);
    const w = page.clientWidth, hh = page.clientHeight;
    if (!/^[1-9]\d{0,4}$/.test(n) || !w || !hh) return;
    const r = turn(page);
    const h = Math.round(I.W * (r % 2 ? w / hh : hh / w));
    let svg = page.querySelector(':scope > .gz-ink');
    const sig = `${r} ${h} ${gen} ${ver[n] || 0}`;
    if (svg && (svg.dataset.sig === sig || live?.svg === svg)) return; // drawn already, or a stroke is under way on it
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'gz-ink');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('preserveAspectRatio', 'none');
      for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) svg.addEventListener(ev, onPointer);
      page.append(svg);
    }
    svg.setAttribute('viewBox', `0 0 ${I.view(r, h).join(' ')}`);
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `matrix(${I.matrix(r, h)})`);
    for (const s of pages[n] || []) g.append(pathOf(s));
    svg.replaceChildren(g);
    svg.dataset.sig = sig;
    svg.dataset.n = n;
  };
  const mountAll = () => { for (const page of document.querySelectorAll('.Page[id^="page-"]')) mount(page); };

  const changed = (n) => {
    ver[n] = (ver[n] || 0) + 1;
    const page = document.getElementById(`page-${n}`);
    if (page) mount(page);
    save();
    syncBar();
  };
  const edit = (op) => {
    I.apply(pages, op);
    done.push(op);
    if (done.length > 200) done.shift();
    undone = [];
    changed(op.n);
  };
  const undo = () => { const op = done.pop(); if (op) { I.revert(pages, op); undone.push(op); changed(op.n); } };
  const redo = () => { const op = undone.pop(); if (op) { I.apply(pages, op); done.push(op); changed(op.n); } };
  // The page the viewer says it is on.
  const current = () => { const v = document.querySelector('.ViewerControls--current-page')?.value; return /^[1-9]\d{0,4}$/.test(v) ? v : '1'; };
  const clearPage = () => { const n = current(); if (pages[n]?.length) edit({ n, add: [], del: pages[n].map((s, i) => [i, s]) }); };

  // Drawing: mouse, pen and touch alike. Once an Apple Pencil (or any pen) has drawn, fingers scroll and only the pen draws.
  const onPointer = (e) => {
    if (!tool) return;
    if (e.pointerType === 'pen') html.setAttribute('data-gz-pencil', '');
    else if (e.pointerType === 'touch' && html.hasAttribute('data-gz-pencil')) return;
    const svg = e.currentTarget;
    if (e.type === 'pointerdown') {
      if (live || e.button !== 0 || !svg.firstChild) return;
      e.preventDefault();
      svg.setPointerCapture?.(e.pointerId);
      live = { svg, g: svg.firstChild, n: svg.dataset.n, id: e.pointerId, pts: [], gone: new Set(), tool };
      if (tool !== 'eraser') live.g.append(live.el = pathOf({ t: tool, c: color[tool], w: width(), p: [] }));
    } else if (live?.id !== e.pointerId || live.svg !== svg) return;
    const m = live.g.getScreenCTM()?.inverse();
    if (m) {
      const list = pages[live.n] || [];
      const reach = 10 * Math.hypot(m.a, m.b); // 10 px, in page units
      for (const ev of e.getCoalescedEvents?.() || [e]) {
        const { x, y } = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m);
        if (live.tool === 'eraser') {
          list.forEach((s, i) => { if (!live.gone.has(i) && I.hits(s, x, y, reach)) { live.gone.add(i); live.g.children[i]?.setAttribute('display', 'none'); } });
        } else if (live.pts.length < 2 * I.MAX_POINTS) live.pts.push(x, y);
      }
      if (live.el) live.el.setAttribute('d', I.path(live.pts.map((v) => Math.round(v * 10) / 10)));
    }
    if (e.type !== 'pointerup' && e.type !== 'pointercancel') return;
    const { n, pts, gone } = live;
    const op = live.tool === 'eraser' ? gone.size && { n, add: [], del: [...gone].sort((a, b) => a - b).map((i) => [i, pages[n][i]]) }
      : e.type === 'pointerup' && pts.length && { n, add: [{ t: live.tool, c: color[live.tool], w: Math.round(width() * 10) / 10, p: I.simplify(pts) }], del: [] };
    live = null;
    if (op) edit(op);
    else { gen++; mountAll(); }
  };

  // ---- the toolbar ------------------------------------------------------------------------------------------------
  // In its own shadow root, so neither the viewer's styles nor Glaze's reach across. Fixed at the bottom of the frame,
  // clear of Canvas's toolbar at the top.
  const ICON = {
    pen: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4', hl: 'M4 20h6M7 17l-2 3M7 17l3-7 7-6 3 3-6 7z', eraser: 'M8 20h12M4 15l9-9 6 6-6 6H8zM9 10l5 5',
    undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-4', redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h4', clear: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    out: 'M12 4v11M7 10l5 5 5-5M5 20h14', in: 'M12 15V4M7 9l5-5 5 5M5 20h14', picture: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4', done: 'M5 12l5 5 9-10',
  };
  const SWATCHES = [['Black', '#111827'], ['Red', '#e11d48'], ['Blue', '#2563eb'], ['Green', '#16a34a'], ['Yellow', '#fde047']];
  const BAR_CSS = `:host { all: initial; position: fixed; left: 50%; bottom: 12px; transform: translateX(-50%); z-index: 2147483000; max-width: calc(100vw - 16px); }
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2px; padding: 4px; border-radius: 12px; font: 13px/1.2 system-ui, sans-serif;
  background: var(--gz-surface, #fff); color: var(--gz-ink, #111); border: 1px solid var(--gz-line-strong, #c8cdd4); box-shadow: 0 6px 24px rgb(0 0 0 / 0.25); }
button { all: unset; box-sizing: border-box; width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; cursor: pointer; color: inherit; }
button:hover:not(:disabled) { background: var(--gz-accent-soft, #dbeafe); }
button[aria-pressed="true"] { background: var(--gz-accent-soft, #dbeafe); color: var(--gz-accent, #2563eb); box-shadow: inset 0 0 0 1.5px currentColor; }
button:disabled { opacity: 0.4; cursor: default; }
:is(button, input):focus-visible { outline: 2px solid var(--gz-accent, #2563eb); outline-offset: 1px; }
svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.dot { width: 18px; height: 18px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgb(127 127 127 / 0.6); }
input[type="color"] { width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
input[type="range"] { width: 72px; accent-color: var(--gz-accent, #2563eb); }
.sep { width: 1px; align-self: stretch; margin: 4px 3px; background: var(--gz-line, #e3e6ea); }
[role="status"]:empty { display: none; }
[role="status"] { padding: 0 6px; color: var(--gz-warn, #b45309); }
[hidden] { display: none !important; }`;
  let bar = null, ui = null, expanded = false;
  const icon = (d) => {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.append(p);
    return s;
  };
  const button = (label, content, run) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(content);
    b.addEventListener('click', run);
    return b;
  };
  const sep = () => Object.assign(document.createElement('span'), { className: 'sep' });
  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const fileId = () => key.split('/').pop();
  const say = (text) => { if (ui) ui.status.textContent = text; };
  const exportInk = () => download(new Blob([I.exportFile(fileId(), pages)], { type: 'application/json' }), `annotations-${fileId()}.json`);
  const importInk = () => {
    const f = document.createElement('input');
    f.type = 'file';
    f.accept = '.json,application/json';
    f.addEventListener('change', async () => {
      const file = f.files?.[0];
      const r = file && file.size < 8e6 && I.importFile(await file.text(), pages);
      if (!r) return say(t("That file isn't Glaze annotations"));
      pages = r.pages;
      done = []; undone = [];
      gen++;
      mountAll();
      save();
      syncBar();
      say(t('Annotations imported'));
    });
    f.click();
  };
  // The page as the viewer drew it, with the marks on top, as a PNG.
  const picture = async () => {
    const n = current();
    const page = document.getElementById(`page-${n}`);
    const cv = page?.querySelector('.Page-canvas-container canvas');
    if (!cv?.width || page.classList.contains('Page--not-rendered')) return say(t("This page isn't drawn yet"));
    const out = document.createElement('canvas');
    out.width = cv.width;
    out.height = cv.height;
    const c = out.getContext('2d');
    c.fillStyle = '#fff';
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(cv, 0, 0);
    const svg = page.querySelector(':scope > .gz-ink')?.cloneNode(true);
    if (svg) {
      svg.setAttribute('xmlns', NS);
      svg.setAttribute('width', out.width);
      svg.setAttribute('height', out.height);
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
      try { await img.decode(); c.drawImage(img, 0, 0, out.width, out.height); } catch { /* the page alone */ } finally { URL.revokeObjectURL(img.src); }
    }
    try { out.toBlob((b) => b && download(b, `page-${n}-${fileId()}.png`), 'image/png'); } catch { say(t("This page isn't drawn yet")); }
  };

  const setTool = (x) => {
    tool = x;
    if (x) html.setAttribute('data-gz-tool', x);
    else html.removeAttribute('data-gz-tool');
    syncBar();
  };
  const syncBar = () => {
    if (!ui) return;
    ui.more.hidden = !expanded;
    ui.annotate.hidden = expanded;
    for (const [k, b] of Object.entries(ui.tools)) b.setAttribute('aria-pressed', String(tool === k));
    const c = color[tool === 'hl' ? 'hl' : 'pen'];
    for (const b of ui.swatches) b.setAttribute('aria-pressed', String(b.dataset.c === c));
    ui.custom.value = c;
    ui.undo.disabled = !done.length;
    ui.redo.disabled = !undone.length;
  };
  const showBar = (wide) => {
    expanded = wide;
    bar = document.createElement('div');
    bar.id = 'gz-ink-bar';
    const root = bar.attachShadow({ mode: 'open' });
    const css = document.createElement('style');
    css.textContent = BAR_CSS;
    const box = document.createElement('div');
    box.className = 'bar';
    box.setAttribute('role', 'toolbar');
    box.setAttribute('aria-label', t('Annotations'));
    const pick = (k) => () => setTool(tool === k ? null : k);
    const tools = { pen: button(t('Pen'), icon(ICON.pen), pick('pen')), hl: button(t('Highlighter'), icon(ICON.hl), pick('hl')), eraser: button(t('Eraser'), icon(ICON.eraser), pick('eraser')) };
    const paintWith = (c) => { const k = tool === 'hl' ? 'hl' : 'pen'; color[k] = c; if (!tool || tool === 'eraser') setTool(k); else syncBar(); };
    const swatches = SWATCHES.map(([name, c]) => {
      const dot = Object.assign(document.createElement('span'), { className: 'dot' });
      dot.style.background = c;
      const b = button(t(name), dot, () => paintWith(c));
      b.dataset.c = c;
      return b;
    });
    const custom = Object.assign(document.createElement('input'), { type: 'color', title: t('Custom color') });
    custom.setAttribute('aria-label', t('Custom color'));
    custom.addEventListener('input', () => paintWith(custom.value.toLowerCase()));
    const range = Object.assign(document.createElement('input'), { type: 'range', min: 1, max: 10, step: 1, value: size, title: t('Size') });
    range.setAttribute('aria-label', t('Size'));
    range.addEventListener('input', () => { size = +range.value; });
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    const undoB = button(t('Undo'), icon(ICON.undo), undo);
    const redoB = button(t('Redo'), icon(ICON.redo), redo);
    const more = document.createElement('span');
    more.style.display = 'contents';
    more.append(...Object.values(tools), sep(), ...swatches, custom, range, sep(), undoB, redoB, button(t('Clear page'), icon(ICON.clear), clearPage), sep(),
      button(t('Export annotations'), icon(ICON.out), exportInk), button(t('Import annotations'), icon(ICON.in), importInk),
      button(t('Save page as picture'), icon(ICON.picture), picture), sep(),
      button(t('Done'), icon(ICON.done), () => { expanded = false; setTool(null); ui.annotate.focus(); }));
    const annotate = button(t('Annotate'), icon(ICON.pen), () => { expanded = true; setTool('pen'); tools.pen.focus(); });
    box.append(annotate, more, status);
    root.append(css, box);
    ui = { tools, swatches, custom, status, undo: undoB, redo: redoB, more, annotate };
    syncBar();
    (document.body || html).append(bar);
  };
  const hideBar = () => { bar?.remove(); bar = ui = null; };

  // Keys while a tool is picked: Esc puts it down, Ctrl/⌘+Z undoes, with Shift (or Ctrl+Y) redoes. Otherwise the viewer's.
  addEventListener('keydown', (e) => {
    if (!tool) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    if (e.key === 'Escape') setTool(null);
    else if (mod && k === 'z') (e.shiftKey ? redo : undo)();
    else if (mod && k === 'y') redo();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // One of Canvas's own tools, or anything else in its toolbar but paging and zoom, puts Glaze's down.
  addEventListener('pointerdown', (e) => {
    if (tool && e.target.closest?.('.ViewerControls') && !e.target.closest('.ViewerControls--page-controls, .DocumentControls')) setTool(null);
  }, true);
})();
