// The PDF kind on the Documents page (papers.html, after papers.js; lib/doc-kinds.js): with Settings → Writer → PDFs on
// (writer.pdf), a .pdf imports as a document whose record holds the file (STORE below), shows its first page on the home's
// card, exports as itself, and opens in pdf.js's own viewer (lib/pdfjs: pdf.mjs and pdf_viewer.mjs, imported only when a
// PDF is first read; pdf.js parses in its module worker, pdf.worker.mjs): the visible pages drawn, zoom, the text layer and
// pdf.js's find, AcroForm fields filled and kept (saved by lib/pdf-doc.js, or as pdf.js writes them where that isn't
// loaded), the file's permissions honoured, and a form only XFA can show refused. The page itself stays white, a
// print document; its chrome is the paper's (writer-paper.css: the top bar, the toolbar, ⋯) in the student's Look.
// Off, Documents takes Word files only, as before, and a PDF already kept still lists, opens and fills. pdf.js's words are
// Glaze's (lib/pdf-l10n.js).
var GZ_PDF_KIND = globalThis.GZ_PDF_KIND || (() => {
  const url = (f) => chrome.runtime.getURL(f);
  const UNREAD = 'That file could not be read.', TOO_BIG = GZ_DOC_KINDS.KINDS.pdf.big;
  const PAGES = 500;

  // ---- storage: the one place a PDF's bytes are kept and read back: the worker's file store (lib/doc-files.js, over its
  // port), the record pointing at them (file: { hash, size, type }), up to the kind's max. A record from before the store
  // holds them as base64 in `file`: read as before, and moved over as it is opened. Where the store is unavailable, a PDF
  // up to the old 3 MB is kept that way still. Nothing else here reads `file`.
  const files = () => GZ_WRITER_PAPER.need(['lib/doc-files.js']).then(() => GZ_DOC_FILES);
  // A refusal of the store's, as the page says it.
  class FileError extends RangeError { constructor(why) { super(GZ_DOC_KINDS.SAYS[why] || UNREAD); this.why = why; } }
  const b64 = (bytes) => {
    if (typeof bytes.toBase64 === 'function') return bytes.toBase64();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const unb64 = (s) => {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(s);
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const LEGACY = 3e6;
  const STORE = {
    max: GZ_DOC_KINDS.KINDS.pdf.max,
    // bytes → the record's fields for them, the bytes kept in the store; a RangeError says why not.
    put: async (bytes) => {
      if (!(bytes?.length > 0) || bytes.length > STORE.max) throw new RangeError(TOO_BIG);
      const F = await files();
      try { return { file: await F.client().put(bytes, 'application/pdf'), size: bytes.length }; } catch (e) {
        if (e.why === 'unavailable' && bytes.length <= LEGACY) return { file: b64(bytes), size: bytes.length };
        throw new FileError(e.why);
      }
    },
    // a record → its bytes, or null for none; a FileError when the store can't give them (missing, unavailable, cut).
    get: async (rec) => {
      if (typeof rec?.file === 'string') {
        if (!rec.file || rec.file.length > 4 * Math.ceil(LEGACY / 3) || (rec.size != null && (!Number.isSafeInteger(rec.size) || rec.size <= 0 || rec.size > LEGACY))) return null;
        try {
          const bytes = unb64(rec.file);
          return bytes.length > 0 && bytes.length <= LEGACY && (rec.size == null || rec.size === bytes.length) ? bytes : null;
        } catch { return null; }
      }
      const F = await files();
      if (!F.ref(rec?.file) || rec.file.size > STORE.max) return null;
      try { return await F.client().get(rec.file); } catch (e) { throw new FileError(e.why); }
    },
  };

  // A form only XFA can draw (XFA, and no AcroForm fields to fall back on): pdf.js shows its "needs Adobe Reader" page.
  const pureXfa = (info, fields) => !!info?.IsXFAPresent && !(fields && Object.keys(fields).length);

  // ---- pdf.js, imported the first time a PDF is read
  let lib = null, viewerLib = null;
  const pdfjs = () => (lib ||= import(url('lib/pdfjs/pdf.mjs')).then((P) => { P.GlobalWorkerOptions.workerSrc = url('lib/pdfjs/pdf.worker.mjs'); return P; }));
  const viewerjs = () => (viewerLib ||= pdfjs().then(() => import(url('lib/pdfjs/pdf_viewer.mjs'))));
  // lib/pdf-doc.js over this pdf.js (papers.html loads it before this file), or null where it isn't loaded: then pdf.js
  // directly, the same checks.
  const GET = { wasmUrl: url('lib/pdfjs/'), isEvalSupported: false, enableXfa: false, verbosity: 0 };
  let docLib = null;
  const pdfdoc = () => (typeof globalThis.GZ_PDF_DOC?.use === 'function' ? (docLib ||= pdfjs().then((P) => GZ_PDF_DOC.use(P, GET))) : null);
  // bytes (a copy goes to the worker) → { task, doc }, or a RangeError(UNREAD) for a file that is no PDF, is locked, has
  // too many pages, is pure XFA or has no first page to show (pdf.js's viewer would wait for it).
  const read = async (bytes) => {
    const lib2 = pdfdoc();
    let task, doc;
    if (lib2) {
      const pdf = await lib2;
      try { ({ doc } = await pdf.open(bytes)); task = doc.loadingTask; } catch { throw new RangeError(UNREAD); }
    } else {
      const P = await pdfjs();
      task = P.getDocument({ ...GET, data: bytes.slice() });
      try { doc = await task.promise; } catch { await task.destroy().catch(() => {}); throw new RangeError(UNREAD); }
    }
    try {
      if (!lib2) {
        const [{ info }, fields] = await Promise.all([doc.getMetadata(), doc.getFieldObjects()]);
        if (doc.numPages > PAGES || pureXfa(info, fields)) throw new RangeError(UNREAD);
      }
      await doc.getPage(1);
    } catch (e) { await task.destroy().catch(() => {}); throw e instanceof RangeError ? e : new RangeError(UNREAD); }
    return { task, doc };
  };
  // Page 1 as a small picture (a data URL), as filled in: what the home's card shows (204 px wide, 408 on a 2× screen).
  // Try lib/pdf-doc.js's PNG (24 KB at most) once at full size, else a JPEG drawn here: a scan or a photo fits 24 KB of
  // PNG only as a postage stamp. At most two draws, including the JPEG.
  const picture = async (doc) => {
    const lib2 = pdfdoc(), page = await doc.getPage(1);
    if (lib2) { const { png } = await (await lib2).thumbnail(page, 528, { minPx: 528 }); if (png) return `data:image/png;base64,${b64(png)}`; }
    const P = await pdfjs(), one = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 408 / Math.max(1, one.width) });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(viewport.width), height: Math.min(Math.ceil(viewport.height), 1200) });
    // The page is the viewer's too (one proxy per page): the viewer cleans it up.
    try {
      await page.render({ canvas, viewport, background: '#fff', annotationMode: P.AnnotationMode.ENABLE_STORAGE }).promise;
      for (const q of [0.78, 0.6, 0.45, 0.3, 0.15, 0.05]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= 64e3) return out;
      }
      return null;
    } finally { canvas.width = canvas.height = 0; }
  };

  let store = null;
  const papers = () => (store ||= GZ_WRITER_PAPERS.open());
  const locale = () => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language || 'en'; } };
  // An assignment's frame says its words in the page's language (writer.js t).
  let words = null;
  const t = (k, v) => (words ? words(k, v) : GZ_I18N.t(k, v, locale()));
  const h = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v);
    }
    e.append(...kids.flat().filter((x) => x != null && x !== false));
    return e;
  };
  const btn = (props, ...kids) => h('button', { type: 'button', ...props }, ...kids);
  const PATHS = { minus: 'M5 12h14', plus: 'M12 5v14M5 12h14', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', dots: 'M5 12h.01M12 12h.01M19 12h.01', caret: 'm6 9 6 6 6-6',
    up: 'm6 15 6-6 6 6', down: 'm6 9 6 6 6-6', x: 'M6 6l12 12M18 6 6 18' };
  const icon = (name) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', 'gp-ico'); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', PATHS[name]); s.append(p); return s; };
  const nameOf = (rec) => `${String(rec?.title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Document'}.pdf`;

  // ---- the page code GZ_DOC_KINDS takes
  // A PDF file as a new standalone document, its title the file's name, its first page drawn for the card. → its key.
  const importFile = async (file) => {
    if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > STORE.max) throw new RangeError(TOO_BIG);
    await GZ_WRITER_PAPER.need(['lib/writer-papers.js', 'lib/doc-home.js']);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length !== file.size) throw new Error('invalid file read');
    const { task, doc } = await read(bytes);
    let thumb = null, pages = 0;
    try { pages = doc.numPages; thumb = await picture(doc).catch(() => null); } finally { await task.destroy().catch(() => {}); }
    const key = GZ_WRITER_PAPERS.newKey(), title = GZ_DOC_HOME.stem(file.name);
    await papers().save(key, { kind: 'pdf', ...await STORE.put(bytes), pages, ...(thumb && { thumb }), title, named: !!title }, { reason: 'import' });
    return key;
  };
  // The card's picture: the one the record keeps, else drawn once from its bytes here and kept for its revision.
  const drawn = new Map();
  const thumb = (rec) => {
    const img = h('img', { class: 'gq-thumb', alt: '', decoding: 'async' });
    const at = `${rec.key}|${rec.revision}`, src = rec.thumb || drawn.get(at);
    if (src) { img.src = src; return img; }
    STORE.get(rec).then((bytes) => bytes && read(bytes)).then(async (r) => { if (!r) return; const { task, doc } = r; try { const u = await picture(doc); drawn.set(at, u); img.src = u; } finally { await task.destroy().catch(() => {}); } }).catch(() => {});
    return img;
  };
  const file = async (key) => { const rec = await papers().get(key), bytes = await STORE.get(rec); return bytes ? { name: nameOf(rec), mime: 'application/pdf', bytes } : null; };
  const exportFile = async (key) => {
    const f = await file(key);
    if (!f) throw new Error('no file');
    const href = URL.createObjectURL(new Blob([f.bytes], { type: f.mime })), a = h('a', { href, download: f.name });
    document.body.append(a); a.click(); a.remove();
    const revoke = () => { clearTimeout(revokeTimer); URL.revokeObjectURL(href); removeEventListener('pagehide', revoke); };
    const revokeTimer = setTimeout(revoke, 60000);
    addEventListener('pagehide', revoke, { once: true });
  };
  // No text of its own yet: search finds a PDF by its title (the text layer's words feed search in a later step).
  const text = () => '';
  const measure = () => ({ chars: 0, words: 0 });

  // ---- the viewer. host: an assignment's frame (writer-kinds.js view): { mount, t, title, tools }, the viewer in mount with
  // the assignment's title and the frame's tools (Submit…) before ⋯, no way back to Documents; → its surface.
  // o: papers.js's { fresh } (a kind that opens a new document empty), or view's { host }.
  const edit = async (key, { host = null } = {}) => {
    const root = document.documentElement;
    const life = new AbortController(), signal = life.signal;
    if (host) words = host.t || null; else root.dataset.mode = 'pdf';
    await GZ_WRITER_PAPER.need(['lib/writer-papers.js', 'lib/pdf-l10n.js']);
    const sheet = (href) => new Promise((ok) => { document.head.append(h('link', { rel: 'stylesheet', href, onload: ok, onerror: ok })); });
    const st = papers(), PA = GZ_WRITER_PAPERS;
    let rec = await st.get(key);
    const [P, V] = await Promise.all([pdfjs(), viewerjs(), sheet('lib/pdfjs/pdf_viewer.css')]);

    // The chrome: Documents and the title, the save state; zoom, find and ⋯; the pages.
    const own = !host && PA.local(key);
    const titleIn = own ? h('input', { class: 'gp-title-in', type: 'text', maxlength: '120', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Title'), placeholder: t('Untitled document') }) : null;
    const state = h('span', { class: 'gp-state', role: 'status' });
    const back = host ? null : h('a', { href: 'papers.html', text: t('Documents') });
    const zoomOut = btn({ id: 'gq-zoom-out', class: 'gq-ib', title: t('Zoom out'), 'aria-label': t('Zoom out') }, icon('minus'));
    const zoomLabel = h('span'), zoomB = btn({ id: 'gq-zoom', class: 'gp-box', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('Zoom') }, zoomLabel, icon('caret'));
    const zoomIn = btn({ id: 'gq-zoom-in', class: 'gq-ib', title: t('Zoom in'), 'aria-label': t('Zoom in') }, icon('plus'));
    const findB = btn({ id: 'gq-find-b', class: 'gq-ib', title: t('Find'), 'aria-label': t('Find'), 'aria-expanded': 'false', 'aria-controls': 'gq-find' }, icon('search'));
    const moreB = btn({ class: 'gq-ib gq-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('More'), 'aria-label': t('More') }, icon('dots'));
    const q = h('input', { id: 'gq-find-q', type: 'search', autocomplete: 'off', spellcheck: 'false', placeholder: t('Find'), 'aria-label': t('Find') });
    const count = h('span', { id: 'gq-find-n', class: 'gq-find-n', role: 'status' });
    const prevB = btn({ class: 'gq-ib', title: t('Previous'), 'aria-label': t('Previous') }, icon('up')), nextB = btn({ class: 'gq-ib', title: t('Next'), 'aria-label': t('Next') }, icon('down'));
    const closeFind = btn({ class: 'gq-ib', title: t('Close'), 'aria-label': t('Close') }, icon('x'));
    const findBar = h('div', { id: 'gq-find', class: 'gq-find', role: 'search', hidden: true }, q, count, prevB, nextB, closeFind);
    const pagesEl = h('div', { class: 'pdfViewer' }), scroll = h('div', { class: 'gq-scroll', role: 'region', tabindex: '0', 'aria-label': rec?.title || t('PDF') }, pagesEl);
    const said = h('p', { class: 'gq-said', role: 'alert', hidden: true });
    const ui = h('div', { class: 'gp gp-standalone gq' },
      h('header', { class: 'gp-top' }, back, h('h1', {}, titleIn || host?.title?.() || rec?.title || t('Untitled document')), h('span', { class: 'grow' }), state),
      h('div', { class: 'gp-tool', role: 'toolbar', 'aria-label': t('PDF') }, zoomOut, zoomB, zoomIn, h('span', { class: 'gp-sepv' }), findB, h('span', { class: 'grow' }), ...(host?.tools || []), moreB),
      findBar, h('div', { class: 'gq-work' }, scroll, said));
    (host?.mount || document.body).append(ui);
    if (titleIn) titleIn.value = rec?.title || '';

    // pdf.js's viewer over the pages: only those in view drawn, forms as fields, links in a new tab, the file's own
    // permissions (copying, filling) honoured. Its editors stay off until the tools step turns them on.
    const bus = new V.EventBus(), links = new V.PDFLinkService({ eventBus: bus, externalLinkTarget: V.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' });
    const finder = new V.PDFFindController({ eventBus: bus, linkService: links });
    const l10n = GZ_PDF_L10N.make({ t, lang: locale() });
    const viewer = new V.PDFViewer({ container: scroll, viewer: pagesEl, eventBus: bus, linkService: links, findController: finder, l10n, annotationMode: P.AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: P.AnnotationEditorType.DISABLE, enablePermissions: true, imageResourcesPath: url('lib/pdfjs/images/'), removePageBorders: false });
    links.setViewer(viewer);
    l10n.translate(scroll);
    const refuse = (e) => {
      said.textContent = t(e instanceof FileError ? e.message : UNREAD); said.hidden = false; for (const b of [zoomOut, zoomB, zoomIn, findB]) b.disabled = true;
      // A file the store no longer has: Delete (to Trash, as Documents' own) or Import… it again, where this is a document of its own.
      if (e?.why === 'missing' && own) said.append(' ', btn({ class: 'gp-box', 'data-act': 'delete', onclick: () => { st.trash(key).then(() => location[window.top === window ? 'assign' : 'replace']('papers.html'), () => say(t('Not saved. Try again in a moment.'))); } }, t('Delete')),
        ' ', btn({ class: 'gp-box', 'data-act': 'reimport', onclick: () => { pick.click(); } }, t('Import…')));
    };
    const pick = h('input', { type: 'file', accept: '.pdf,application/pdf', hidden: true, onchange: () => {
      const f = pick.files[0];
      pick.value = '';
      if (f) into(key, f).then(() => location.reload(), (e) => { console.error(e); say(t(e instanceof RangeError ? e.message : UNREAD)); });
    } });
    ui.append(pick);
    let bytes = null, task = null, doc = null;
    // A record from before the store moves into it as it is opened (the worker reads its base64 again).
    if (typeof rec?.file === 'string') st.migrate?.(key).catch(() => {});
    try { bytes = await STORE.get(rec); if (!bytes) throw new RangeError(UNREAD); ({ task, doc } = await read(bytes)); } catch (e) { refuse(e); }
    const inited = new Promise((ok) => bus.on('pagesinit', ok, { once: true }));
    if (doc) {
      bus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; });
      viewer.setDocument(doc);
      links.setDocument(doc, null);
    }

    // ---- zoom: −, the box (Page width, Whole page, percents), +; Ctrl or ⌘ with + and −
    const PRESETS = [['page-width', 'Page width'], ['page-fit', 'Whole page']], STEPS = [50, 75, 100, 125, 150, 200, 300];
    // fit: the preset the zoom follows, or null at a percent. Whole page is set as its scale (wholePage), so a change
    // while it is being set keeps it.
    let fit = null, fitting = false;
    const sayZoom = (scale) => { const p = PRESETS.find(([v]) => v === fit); zoomLabel.textContent = p ? t(p[1]) : `${Math.round(scale * 100)}%`; };
    bus.on('scalechanging', ({ scale, presetValue }) => { if (!fitting) fit = PRESETS.some(([v]) => v === presetValue) ? presetValue : null; sayZoom(scale); });
    // pdf.js's 'page-fit' leaves 5 px of the room for its own page borders (pdf_viewer.mjs VERTICAL_PADDING); Glaze's pages
    // sit under the viewer's top padding with a margin below (pdf-kind.css), so the page's height is the room less those.
    const wholePage = () => {
      const pv = viewer.getPageView(viewer.currentPageNumber - 1);
      if (!pv?.div || !pv.width || !pv.height) return null;
      const n = (v) => parseFloat(v) || 0, box = getComputedStyle(pagesEl), pg = getComputedStyle(pv.div);
      const down = scroll.clientHeight - n(box.paddingTop) - n(pg.marginBottom) - n(pg.borderTopWidth) - n(pg.borderBottomWidth);
      return Math.min((scroll.clientWidth - 40) / pv.width, down / pv.height) * pv.scale;
    };
    const zoomTo = (v) => {
      if (v !== 'page-fit') { viewer.currentScaleValue = v; return; }
      const s = wholePage();
      if (!(s > 0)) return;
      fit = v; fitting = true;
      try { viewer.currentScaleValue = String(s); } finally { fitting = false; }
      sayZoom(s);
    };
    zoomIn.addEventListener('click', () => viewer.increaseScale());
    zoomOut.addEventListener('click', () => viewer.decreaseScale());
    // A fit follows the room it fits (the window, the find bar), as pdf.js's own app re-applies it.
    const sizing = new ResizeObserver(() => { if (doc && fit) zoomTo(fit); });
    sizing.observe(scroll);

    // ---- menus (the paper's .pop .gp-menu): arrows move, Esc and Tab close, focus back on the opener
    let menu = null;
    const closeMenu = (backTo) => { if (!menu) return; const m = menu; menu = null; m.el.remove(); m.opener.setAttribute('aria-expanded', 'false'); if (backTo) m.opener.focus(); };
    const openMenu = (opener, items) => {
      if (menu?.opener === opener) { closeMenu(true); return; }
      closeMenu();
      const el = h('div', { class: 'pop gp-menu gq-menu', role: 'menu' }, items.map(([label, run, props = {}]) => btn({ role: 'menuitem', tabindex: '-1', ...props, onclick: () => { closeMenu(true); run(); } }, label)));
      document.body.append(el);
      const r = opener.getBoundingClientRect(), w = el.offsetWidth;
      el.style.left = `${Math.max(4, Math.min(r.left, innerWidth - w - 4))}px`;
      el.style.top = `${r.bottom + 6}px`;
      el.addEventListener('keydown', (e) => {
        const all = [...el.querySelectorAll('[role="menuitem"]')], i = all.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length].focus(); }
      });
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      opener.setAttribute('aria-expanded', 'true');
      menu = { el, opener };
      el.querySelector('[role="menuitem"]')?.focus();
    };
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.el.contains(e.target) && !menu.opener.contains(e.target)) closeMenu(); }, { capture: true, signal });
    zoomB.addEventListener('click', () => openMenu(zoomB, [...PRESETS.map(([v, label]) => [t(label), () => { zoomTo(v); }, { 'data-zoom': v }]),
      ...STEPS.map((n) => [`${n}%`, () => { viewer.currentScaleValue = String(n / 100); }, { 'data-zoom': String(n) }])]));
    // ⋯: Export .pdf (the pages panel's bake and the tools come in later steps).
    moreB.addEventListener('click', () => openMenu(moreB, [[t('Export .pdf'), () => { flush().then((ok) => ok && exportFile(key)).catch(() => say(t(UNREAD))); }, { 'data-act': 'export' }]]));

    // ---- find: pdf.js's find controller over the text layer, every hit highlighted, the current one counted
    const find = (type, back = false) => bus.dispatch('find', { source: findBar, type, query: q.value, caseSensitive: false, entireWord: false, matchDiacritics: false, highlightAll: true, findPrevious: back });
    const showFind = (on) => {
      findBar.hidden = !on; findB.setAttribute('aria-expanded', String(on));
      if (on) { q.focus(); q.select(); if (q.value) find('again'); }
      else { bus.dispatch('findbarclose', { source: findBar }); count.textContent = ''; scroll.focus({ preventScroll: true }); }
    };
    const counted = ({ total, current }) => { count.textContent = !q.value ? '' : total ? t('{n} of {m}', { n: current, m: total }) : t('No results'); };
    bus.on('updatefindmatchescount', ({ matchesCount }) => counted(matchesCount));
    bus.on('updatefindcontrolstate', ({ state: s, matchesCount }) => { if (s === V.FindState.NOT_FOUND) counted({ total: 0 }); else if (matchesCount) counted(matchesCount); });
    findB.addEventListener('click', () => showFind(findBar.hidden));
    closeFind.addEventListener('click', () => showFind(false));
    q.addEventListener('input', () => { if (q.value) find(''); else { bus.dispatch('findbarclose', { source: findBar }); count.textContent = ''; } });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); find('again', e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); showFind(false); }
    });
    prevB.addEventListener('click', () => find('again', true));
    nextB.addEventListener('click', () => find('again', false));
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    document.addEventListener('keydown', (e) => {
      if (!e.defaultPrevented && e.key === 'Escape' && !findBar.hidden) { e.preventDefault(); e.stopPropagation(); showFind(false); }
    }, { signal });
    // Ahead of the page's own: in an assignment's frame the parked paper's find (writer-find.js) takes Ctrl+F at the document.
    addEventListener('keydown', (e) => {
      if (e.defaultPrevented || !doc || !(MAC ? e.metaKey : e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f') showFind(true);
      else if (k === '=' || k === '+') viewer.increaseScale();
      else if (k === '-') viewer.decreaseScale();
      else return;
      e.preventDefault(); e.stopPropagation();
    }, { capture: true, signal });

    // ---- saving: a field filled (pdf.js's annotation storage) saves a second after the last change, and before the page
    // leaves for Documents; the bytes pdf.js writes (an incremental update) replace the record's, with page 1 drawn again.
    const say = (text) => { state.textContent = text; };
    let dirty = false, saving = null, timer = 0;
    const save = async () => {
      if (!doc || !dirty) return true;
      dirty = false; clearTimeout(timer);
      say(t('Saving…'));
      try {
        const lib2 = pdfdoc(), out = lib2 ? (await (await lib2).save(doc)).bytes : await doc.saveDocument();
        const thumbUrl = await picture(doc).catch(() => null);
        ({ paper: rec } = await st.save(key, { ...await STORE.put(out), pages: doc.numPages, ...(thumbUrl && { thumb: thumbUrl }) }, { expectedKind: 'pdf' }));
        say(dirty ? '' : t('Saved'));
        return true;
      } catch (e) { console.error(e); dirty = true; say(t(e instanceof FileError ? e.message : e instanceof RangeError ? TOO_BIG : 'Not saved. Try again in a moment.')); return false; }
    };
    const flush = () => {
      clearTimeout(timer);
      if (!saving) saving = (async () => {
        while (dirty) if (!await save()) return false;
        return true;
      })().finally(() => { saving = null; });
      return saving;
    };
    if (doc) {
      const modified = () => { dirty = true; say(''); clearTimeout(timer); timer = setTimeout(flush, 1000); };
      doc.annotationStorage.onSetModified = modified;
      // pdf.js only calls onSetModified once until its current save finishes. Track each input as well, so a field
      // changed during that save cannot be mistaken for the value its worker already captured.
      ui.addEventListener('input', (e) => { if (e.target.closest?.('.annotationLayer')) modified(); }, { signal });
      ui.addEventListener('change', (e) => { if (e.target.closest?.('.annotationLayer')) { modified(); flush(); } }, { signal });
    }
    back?.addEventListener('click', (e) => {
      if (!dirty && !saving) return;
      e.preventDefault();
      flush().then((ok) => { if (ok) location[window.top === window ? 'assign' : 'replace'](back.href); });
    });
    // The embedded frame's Close, Escape and history routes await the same storage acknowledgement as Documents.
    addEventListener('glaze:papers:beforeleave', (e) => { if (dirty || saving) e.detail.wait(flush()); }, { signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) flush(); }, { signal });
    // Native tab navigation cannot await a promise. Protect unsaved work until the write acknowledges it.
    addEventListener('beforeunload', (e) => { if (dirty || saving) { flush(); e.preventDefault(); e.returnValue = ''; } }, { signal });
    const dispose = async () => {
      life.abort(); clearTimeout(timer); sizing.disconnect(); l10n.destroy(); closeMenu();
      viewer.setDocument(null); links.setDocument(null); finder.setDocument(null);
      if (doc) doc.annotationStorage.onSetModified = null;
      await task?.destroy().catch(() => {});
    };
    addEventListener('pagehide', () => {
      flush().finally(dispose);
    }, { signal });
    addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); }, { signal });

    // ---- the title: a standalone document's to type, saved on Enter or leaving the field; Esc puts it back
    if (titleIn) {
      let was = titleIn.value;
      const keep = () => { const v = titleIn.value.replace(/\s+/g, ' ').trim(); if (v === was) return; was = v; st.save(key, { title: v, named: !!v }).catch((e) => { console.error(e); say(t('Not saved. Try again in a moment.')); }); };
      titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); keep(); scroll.focus(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); titleIn.value = was; scroll.focus(); } });
      titleIn.addEventListener('blur', keep);
    }
    if (!host) document.title = rec?.title || t('Untitled document');
    if (doc) await inited;
    // papers-motion.js holds the page hidden until a document has drawn.
    globalThis.GZ_PAPERS_MOTION?.shown?.('paper');
    // What an assignment's submit sheet sends (writer-submit.js): the PDF as saved, its fields filled.
    return { pages: () => doc?.numPages || 0, say, ready: () => !!doc, save: flush, dispose,
      file: async () => { if (!await flush()) throw new Error('not saved'); rec = await st.get(key); const bytes = await STORE.get(rec); if (!bytes) throw new Error('no file'); return { bytes, mime: 'application/pdf', ext: '.pdf' }; } };
  };
  // A PDF brought to an assignment (Open in Glaze, writer-kinds.js): the attempt's record becomes it, the paper it held
  // kept as a version first (the 'import' save), its title the assignment's. → the record.
  const into = async (key, f) => {
    if (!Number.isSafeInteger(f?.size) || f.size <= 0 || f.size > STORE.max) throw new RangeError(TOO_BIG);
    await GZ_WRITER_PAPER.need(['lib/writer-papers.js']);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length !== f.size) throw new Error('invalid file read');
    const { task, doc } = await read(bytes);
    let thumbUrl = null, pages = 0;
    try { pages = doc.numPages; thumbUrl = await picture(doc).catch(() => null); } finally { await task.destroy().catch(() => {}); }
    return (await papers().save(key, { kind: 'pdf', doc: null, words: 0, ...await STORE.put(bytes), pages, ...(thumbUrl && { thumb: thumbUrl }) }, { reason: 'import' })).paper;
  };

  // ---- registration: a PDF already kept lists and opens either way; only Settings → Writer → PDFs on (writer.pdf) lets
  // Documents import new ones (its Import, file chooser and drops: GZ_DOC_KINDS.opens). The page routes once this has answered.
  // The switch as Settings shows it: the stored value through defaults.js, so no stored key means the default. writer.html
  // has defaults.js already (a second copy would redeclare its constants); papers.html loads it on demand, after the three
  // scripts it reads as it loads, in papers.js's order (need() shares their loads).
  const DEFAULTS = ['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js'];
  const on = Promise.resolve().then(() => (typeof GZ_SANITIZE === 'function' ? null : GZ_WRITER_PAPER.need(DEFAULTS)))
    .then(() => chrome.storage.sync.get('writer')).then((r) => GZ_SANITIZE({ writer: r?.writer }).writer.pdf === true, () => false);
  GZ_DOC_KINDS.wait(on.then((yes) => { GZ_DOC_KINDS.register('pdf', { edit, view: (key, host) => edit(key, { host }), into, says: { size: TOO_BIG, read: UNREAD, ...GZ_DOC_KINDS.SAYS }, thumb, file, exportFile, text, measure, ...(yes && { importFile }) }); }));

  return { STORE, pureXfa };
})();
