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
  const UNREAD = 'That file could not be read.', TOO_BIG = 'Choose a PDF smaller than 3 MB.';
  const PAGES = 500;

  // ---- storage: the one place a PDF's bytes are kept and read back. For now a base64 `file` field in the paper record
  // (chrome.storage.local through the worker, lib/writer-papers.js), within the record's 4 MB: at most 3 MB of PDF. The
  // worker-owned blob store (glaze-docs, the sheets stage) replaces put and get with a hash into it and lifts max to the
  // kind's 50 MB; nothing else here reads `file`.
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
  const STORE = {
    max: 3e6,
    // bytes → the record's fields for them.
    put: (bytes) => { if (!(bytes?.length > 0) || bytes.length > STORE.max) throw new RangeError(TOO_BIG); return { file: b64(bytes), size: bytes.length }; },
    // a record → its bytes, or null.
    get: (rec) => {
      if (typeof rec?.file !== 'string' || !rec.file || rec.file.length > 4 * Math.ceil(STORE.max / 3)
        || (rec.size != null && (!Number.isSafeInteger(rec.size) || rec.size <= 0 || rec.size > STORE.max))) return null;
      try {
        const bytes = unb64(rec.file);
        return bytes.length > 0 && bytes.length <= STORE.max && (rec.size == null || rec.size === bytes.length) ? bytes : null;
      } catch { return null; }
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
  // too many pages or is pure XFA.
  const read = async (bytes) => {
    const lib2 = pdfdoc();
    if (lib2) {
      const pdf = await lib2;
      try { const { doc } = await pdf.open(bytes); return { task: doc.loadingTask, doc }; } catch { throw new RangeError(UNREAD); }
    }
    const P = await pdfjs();
    const task = P.getDocument({ ...GET, data: bytes.slice() });
    let doc;
    try { doc = await task.promise; } catch { await task.destroy().catch(() => {}); throw new RangeError(UNREAD); }
    try {
      const [{ info }, fields] = await Promise.all([doc.getMetadata(), doc.getFieldObjects()]);
      if (doc.numPages > PAGES || pureXfa(info, fields)) throw new RangeError(UNREAD);
    } catch (e) { await task.destroy().catch(() => {}); throw e instanceof RangeError ? e : new RangeError(UNREAD); }
    return { task, doc };
  };
  // Page 1 as a small picture (a data URL), as filled in: what the home's card shows. lib/pdf-doc.js's PNG (24 KB at most)
  // where that is loaded and it fits, else a JPEG drawn here.
  const picture = async (doc) => {
    const lib2 = pdfdoc(), page = await doc.getPage(1);
    if (lib2) { const { png } = await (await lib2).thumbnail(page, 528); if (png) return `data:image/png;base64,${b64(png)}`; }
    const P = await pdfjs(), one = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 408 / Math.max(1, one.width) });
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.ceil(viewport.width), height: Math.min(Math.ceil(viewport.height), 1200) });
    // The page is the viewer's too (one proxy per page): the viewer cleans it up.
    await page.render({ canvas, viewport, background: '#fff', annotationMode: P.AnnotationMode.ENABLE_STORAGE }).promise;
    const out = canvas.toDataURL('image/jpeg', 0.78);
    canvas.width = canvas.height = 0;
    return out;
  };

  let store = null;
  const papers = () => (store ||= GZ_WRITER_PAPERS.open());
  const locale = () => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language || 'en'; } };
  const t = (k, v) => GZ_I18N.t(k, v, locale());
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
    await papers().save(key, { kind: 'pdf', ...STORE.put(bytes), pages, ...(thumb && { thumb }), title, named: !!title }, { reason: 'import' });
    return key;
  };
  // The card's picture: the one the record keeps, else drawn once from its bytes here and kept for its revision.
  const drawn = new Map();
  const thumb = (rec) => {
    const img = h('img', { class: 'gq-thumb', alt: '', decoding: 'async' });
    const at = `${rec.key}|${rec.revision}`, src = rec.thumb || drawn.get(at);
    if (src) { img.src = src; return img; }
    const bytes = STORE.get(rec);
    if (bytes) read(bytes).then(async ({ task, doc }) => { try { const u = await picture(doc); drawn.set(at, u); img.src = u; } finally { await task.destroy().catch(() => {}); } }).catch(() => {});
    return img;
  };
  const file = async (key) => { const rec = await papers().get(key), bytes = STORE.get(rec); return bytes ? { name: nameOf(rec), mime: 'application/pdf', bytes } : null; };
  const exportFile = async (key) => {
    const f = await file(key);
    if (!f) throw new Error('no file');
    const href = URL.createObjectURL(new Blob([f.bytes], { type: f.mime })), a = h('a', { href, download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 30000);
  };
  // No text of its own yet: search finds a PDF by its title (the text layer's words feed search in a later step).
  const text = () => '';
  const measure = () => ({ chars: 0, words: 0 });

  // ---- the viewer
  const edit = async (key) => {
    const root = document.documentElement;
    root.dataset.mode = 'pdf';
    await GZ_WRITER_PAPER.need(['lib/writer-papers.js', 'lib/pdf-l10n.js']);
    const sheet = (href) => new Promise((ok) => { document.head.append(h('link', { rel: 'stylesheet', href, onload: ok, onerror: ok })); });
    const st = papers(), PA = GZ_WRITER_PAPERS;
    let rec = await st.get(key);
    const [P, V] = await Promise.all([pdfjs(), viewerjs(), sheet('lib/pdfjs/pdf_viewer.css')]);

    // The chrome: Documents and the title, the save state; zoom, find and ⋯; the pages.
    const own = PA.local(key);
    const titleIn = own ? h('input', { class: 'gp-title-in', type: 'text', maxlength: '120', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Title'), placeholder: t('Untitled document') }) : null;
    const state = h('span', { class: 'gp-state', role: 'status' });
    const back = h('a', { href: 'papers.html', text: t('Documents') });
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
    const pagesEl = h('div', { class: 'pdfViewer' }), scroll = h('div', { class: 'gq-scroll', tabindex: '0', 'aria-label': rec?.title || t('PDF') }, pagesEl);
    const said = h('p', { class: 'gq-said', role: 'alert', hidden: true });
    const ui = h('div', { class: 'gp gp-standalone gq' },
      h('header', { class: 'gp-top' }, back, h('h1', {}, titleIn || rec?.title || t('Untitled document')), h('span', { class: 'grow' }), state),
      h('div', { class: 'gp-tool', role: 'toolbar', 'aria-label': t('PDF') }, zoomOut, zoomB, zoomIn, h('span', { class: 'gp-sepv' }), findB, h('span', { class: 'grow' }), moreB),
      findBar, h('div', { class: 'gq-work' }, scroll, said));
    document.body.append(ui);
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
    const refuse = () => { said.textContent = t(UNREAD); said.hidden = false; for (const b of [zoomOut, zoomB, zoomIn, findB]) b.disabled = true; };
    const bytes = STORE.get(rec);
    let task = null, doc = null;
    try { if (!bytes) throw new RangeError(UNREAD); ({ task, doc } = await read(bytes)); } catch { refuse(); }
    addEventListener('pagehide', () => { task?.destroy().catch(() => {}); });
    const inited = new Promise((ok) => bus.on('pagesinit', ok, { once: true }));
    if (doc) {
      bus.on('pagesinit', () => { viewer.currentScaleValue = 'page-width'; });
      viewer.setDocument(doc);
      links.setDocument(doc, null);
    }

    // ---- zoom: −, the box (Page width, Whole page, percents), +; Ctrl or ⌘ with + and −
    const PRESETS = [['page-width', 'Page width'], ['page-fit', 'Whole page']], STEPS = [50, 75, 100, 125, 150, 200, 300];
    bus.on('scalechanging', ({ scale, presetValue }) => { const p = PRESETS.find(([v]) => v === presetValue); zoomLabel.textContent = p ? t(p[1]) : `${Math.round(scale * 100)}%`; });
    zoomIn.addEventListener('click', () => viewer.increaseScale());
    zoomOut.addEventListener('click', () => viewer.decreaseScale());
    // A fit follows the room it fits (the window, the find bar), as pdf.js's own app re-applies it.
    new ResizeObserver(() => { const v = viewer.currentScaleValue; if (doc && PRESETS.some(([p]) => p === v)) viewer.currentScaleValue = v; }).observe(scroll);

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
    document.addEventListener('pointerdown', (e) => { if (menu && !menu.el.contains(e.target) && !menu.opener.contains(e.target)) closeMenu(); }, true);
    zoomB.addEventListener('click', () => openMenu(zoomB, [...PRESETS.map(([v, label]) => [t(label), () => { viewer.currentScaleValue = v; }, { 'data-zoom': v }]),
      ...STEPS.map((n) => [`${n}%`, () => { viewer.currentScaleValue = String(n / 100); }, { 'data-zoom': String(n) }])]));
    // ⋯: Export .pdf (the pages panel's bake and the tools come in later steps).
    moreB.addEventListener('click', () => openMenu(moreB, [[t('Export .pdf'), () => { flush().then(() => exportFile(key)).catch(() => say(t(UNREAD))); }, { 'data-act': 'export' }]]));

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
      if (!(MAC ? e.metaKey : e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'f' && doc) { e.preventDefault(); showFind(true); }
      else if ((k === '=' || k === '+') && doc) { e.preventDefault(); viewer.increaseScale(); }
      else if (k === '-' && doc) { e.preventDefault(); viewer.decreaseScale(); }
    });

    // ---- saving: a field filled (pdf.js's annotation storage) saves a second after the last change, and before the page
    // leaves for Documents; the bytes pdf.js writes (an incremental update) replace the record's, with page 1 drawn again.
    const say = (text) => { state.textContent = text; };
    let dirty = false, saving = null, timer = 0;
    const save = async () => {
      if (!doc || !dirty) return;
      dirty = false; clearTimeout(timer);
      say(t('Saving…'));
      try {
        const lib2 = pdfdoc(), out = lib2 ? (await (await lib2).save(doc)).bytes : await doc.saveDocument();
        const thumbUrl = await picture(doc).catch(() => null);
        ({ paper: rec } = await st.save(key, { ...STORE.put(out), pages: doc.numPages, ...(thumbUrl && { thumb: thumbUrl }) }));
        say(dirty ? '' : t('Saved'));
      } catch (e) { console.error(e); dirty = true; say(t(e instanceof RangeError ? TOO_BIG : 'Not saved. Try again in a moment.')); }
    };
    const flush = () => { const p = (saving || Promise.resolve()).then(save); saving = p; p.finally(() => { if (saving === p) saving = null; }); return p; };
    if (doc) {
      doc.annotationStorage.onSetModified = () => { dirty = true; say(''); clearTimeout(timer); timer = setTimeout(flush, 1000); };
      ui.addEventListener('change', (e) => { if (e.target.closest?.('.annotationLayer')) { clearTimeout(timer); timer = setTimeout(flush, 0); } });
    }
    back.addEventListener('click', (e) => {
      if (!dirty && !saving) return;
      e.preventDefault();
      flush().finally(() => location[window.top === window ? 'assign' : 'replace'](back.href));
    });
    addEventListener('pagehide', () => { if (dirty) flush(); });

    // ---- the title: a standalone document's to type, saved on Enter or leaving the field; Esc puts it back
    if (titleIn) {
      let was = titleIn.value;
      const keep = () => { const v = titleIn.value.replace(/\s+/g, ' ').trim(); if (v === was) return; was = v; st.save(key, { title: v, named: !!v }).catch((e) => { console.error(e); say(t('Not saved. Try again in a moment.')); }); };
      titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); keep(); scroll.focus(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); titleIn.value = was; scroll.focus(); } });
      titleIn.addEventListener('blur', keep);
    }
    document.title = rec?.title || t('Untitled document');
    if (doc) await inited;
    // papers-motion.js holds the page hidden until a document has drawn.
    globalThis.GZ_PAPERS_MOTION?.shown?.('paper');
  };

  // ---- registration: a PDF already kept lists and opens either way; only Settings → Writer → PDFs on (writer.pdf) lets
  // Documents import new ones (its Import, file chooser and drops: GZ_DOC_KINDS.opens). The page routes once this has answered.
  const on = Promise.resolve().then(() => chrome.storage.sync.get('writer')).then((r) => r?.writer?.pdf === true, () => false);
  GZ_DOC_KINDS.wait(on.then((yes) => { GZ_DOC_KINDS.register('pdf', { edit, thumb, file, exportFile, text, measure, ...(yes && { importFile }) }); }));

  return { STORE, pureXfa };
})();
