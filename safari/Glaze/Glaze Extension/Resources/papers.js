// Glaze Writer's Documents home (papers.html): every document on this device as a grid of first-page thumbnails or a
// list, with a New band (Blank and the three formats), search, a course filter, sort, rename, copy, export, delete to
// Trash with Undo (the Trash its own view: Restore, Delete forever), and .docx files dropped or imported as new documents.
// ?paper=<key> opens one in the same paper chrome an assignment's frame has (writer-paper.js). Each kind of document
// (lib/doc-kinds.js) brings its own page code; this file registers the paper's. Reads Writer's storage directly and writes
// through the worker (lib/writer-papers.js).
(() => {
  // The student's Look as Glaze's own pages wear it (ui.js paint, settings and parts as GZ_UI.load reads them): the
  // palette, dark by the theme or by the system with auto light and dark (until storage answers, the system's mode), and
  // the motion level as content.js takes it (off under reduced motion while it follows the system). The student's own
  // theme: this is no course's page, so course Looks don't apply. With look.whole (the home), the whole Look as Settings
  // wears it: fonts, text size, corners, depth, surfaces opaque enough to read over its background, and the background
  // itself drawn behind everything by Settings' own painter (#gd-backdrop: preview.html's backdrop, fed the Look and its
  // parts as options.js feeds #backdrop; there only while Glaze is on and the Look has one). Follows storage live. The home
  // is an address with no document's key (a kind's param, lib/doc-kinds.js), so its first paint is already the whole Look; a
  // stale link that falls back home paints again (home below). The Look's surfaces (features/surfaces.css) are the home's.
  const look = { whole: !/[?&]paper=/.test(location.search), paint: () => {}, surfaces: null,
    sheet: () => { look.surfaces ||= new Promise((ok) => { const l = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'features/surfaces.css', onload: ok, onerror: ok }); document.head.append(l); }); } };
  const theme = async () => {
    const root = document.documentElement, scheme = matchMedia('(prefers-color-scheme: dark)'), calm = matchMedia('(prefers-reduced-motion: reduce)');
    root.toggleAttribute('data-dark', scheme.matches);
    if (look.whole) look.sheet();
    await GZ_WRITER_PAPER.need(['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js', 'lib/cards.js', 'lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js', 'lib/motionx.js', 'lib/lookparts.js', 'ui.js']);
    let turn = 0, worn = null, backdrop = null;
    // The frame shows once it wears this Look's ground (its first paint is the default Look's), at most a second later.
    const post = () => {
      const b = backdrop;
      if (!worn || !b?.hasAttribute('data-ready')) return;
      b.contentWindow?.postMessage({ gzPreview: worn, gzPreviewParts: worn.parts ?? null }, location.origin);
      let frames = 0;
      const show = () => { if (b.contentDocument?.documentElement.getAttribute('data-gz-bg') === root.getAttribute('data-gz-bg') || ++frames > 60) b.setAttribute('data-shown', ''); else requestAnimationFrame(show); };
      if (!b.hasAttribute('data-shown')) requestAnimationFrame(show);
    };
    const wear = (s) => {
      const art = look.whole && s.enabled !== false && s.bg.kind !== 'solid';
      GZ_UI.paint(art || !look.whole ? s : { ...s, bg: { ...s.bg, kind: 'solid' } }, { page: look.whole });
      root.toggleAttribute('data-dark', root.style.colorScheme === 'dark');
      root.dataset.motion = s.motion.followSystem && calm.matches ? 'off' : s.motion.level;
      // Glaze's motion knobs (motion.css) read the same level and the three switches, as content.js sets them.
      root.dataset.gzMotion = root.dataset.motion;
      for (const [a, on] of [['data-gz-no-trans', s.motion.transitions], ['data-gz-no-enter', s.motion.enter], ['data-gz-no-hover', s.motion.hover]]) root.toggleAttribute(a, !on);
      if (art && !backdrop) {
        backdrop = Object.assign(document.createElement('iframe'), { id: 'gd-backdrop', src: 'preview.html?site=canvas&backdrop', tabIndex: -1, inert: true });
        backdrop.setAttribute('aria-hidden', 'true');
        document.body.prepend(backdrop);
      } else if (!art && backdrop) { backdrop.remove(); backdrop = null; }
      worn = s;
      post();
    };
    const paint = async () => {
      const at = ++turn;
      try {
        const s = await GZ_UI.load();
        if (at === turn) wear(s);
      } catch (e) { console.error(e); }
    };
    addEventListener('message', (e) => { if (backdrop && e.origin === location.origin && e.source === backdrop.contentWindow && e.data?.gzPreviewReady) { backdrop.setAttribute('data-ready', ''); post(); } });
    for (const q of [scheme, calm]) q.addEventListener('change', paint);
    chrome.storage.onChanged.addListener((c, where) => { if (where === 'sync' || (where === 'local' && 'lookX' in c)) paint(); });
    look.paint = paint;
    await paint();
  };
  theme().catch((e) => console.error(e));
  // The page in motion (papers-motion.js): cards moving, menus, the field, the toast and the status line coming and going,
  // and the list or a document having drawn. Without it, each change at once.
  const STILL = { cards: (change) => change(), open: () => {}, leave: (el) => el.remove(), say: (el, text) => { el.textContent = text; }, shown: () => {} };
  const motion = () => globalThis.GZ_PAPERS_MOTION || STILL;
  const $ = (id) => document.getElementById(id);
  const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language || 'en'; } })();
  const t = (k, v) => GZ_I18N.t(k, v, locale);
  // An element: 'class' and 'text' as themselves, on* as listeners, anything else an attribute (true: present).
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
  const SVG = 'http://www.w3.org/2000/svg';
  const PATHS = { paper: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M4 6h16M4 12h16M4 18h16', dots: 'M5 12h.01M12 12h.01M19 12h.01', trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6' };
  const icon = (name, cls = 'ico') => { const s = document.createElementNS(SVG, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(SVG, 'path'); p.setAttribute('d', PATHS[name] || PATHS.paper); s.append(p); return s; };
  const catalogue = () => new Promise((ok) => {
    const file = GZ_I18N.file(locale);
    if (!file || globalThis.GZ_LANGS?.[file.slice(5, -3)]) { ok(); return; }
    const s = h('script', { src: file, onload: ok, onerror: ok });
    document.head.append(s);
  });
  // What reading and writing .docx needs (writer-paper.js's DOCX, and the colour rule an import reads runs by).
  const DOCX = ['lib/writer-color.js', 'lib/zip.js', 'lib/doctext.js', 'lib/writer-docx.js', 'lib/writer-objects-docx.js'];
  let store = null;
  const papers = () => (store ||= GZ_WRITER_PAPERS.open());
  // In a frame of a school's page the worker takes this document's writes once it has claimed its pass (embedded below,
  // which keeps the body inert until then): what writes waits for that.
  const claimed = () => (document.body.inert ? new Promise((ok) => new MutationObserver((_, o) => { if (!document.body.inert) { o.disconnect(); ok(); } })
    .observe(document.body, { attributes: true, attributeFilter: ['inert'] })) : Promise.resolve());

  // ---- the paper kind's page code (GZ_DOC_KINDS.register below)
  // A paper as its .docx: { name, mime, bytes }, or null when it holds no document.
  const file = async (key) => {
    await GZ_WRITER_PAPER.need([...DOCX, 'lib/writer-submit.js']);
    const p = await papers().get(key);
    if (!p?.doc) return null;
    const f = GZ_WRITER_STYLES.get(p.format), surname = GZ_WRITER_FORMAT.surname(p.doc, f);
    const out = GZ_WRITER_DOCX.exportDocx(p.doc, { format: f, surname, title: p.title });
    return { name: GZ_WRITER_SUBMIT_LIB.fileName({ surname, title: p.title, fallback: t('Paper') }), mime: out.type, bytes: out.bytes };
  };
  // A paper as a .docx download.
  const exportFile = async (key) => {
    const f = await file(key);
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.bytes], { type: f.mime }));
    const a = h('a', { href: url, download: f.name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  // A paper's text, a line a paragraph (lib/doc-home.js flat).
  const text = (rec) => GZ_DOC_HOME.flat(rec?.doc);
  // A paper's page 1, small (lib/writer-thumb.js).
  const thumb = (rec, scale = 0.25) => GZ_WRITER_THUMB.render(GZ_WRITER_THUMB.firstPage(rec.doc), rec.format, { scale });
  // A Word file as a new standalone document, as the editor's import reads one (writer-paper.js importFile): in the format
  // Settings → Writer starts papers in, its own formatting kept where the format would flag it, the save taking the
  // document's first version. Its title is the file's name. → its key.
  const importFile = async (file) => {
    if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > GZ_DOC_KINDS.KINDS.paper.max) throw new RangeError('Choose a Word file smaller than 15 MB.');
    await GZ_WRITER_PAPER.need(['lib/writer-styles.js', 'lib/writer-format.js', 'lib/doc-home.js', ...DOCX]);
    const ST = GZ_WRITER_STYLES, F = GZ_WRITER_FORMAT;
    const id = await chrome.storage.sync.get('writer').then((r) => r?.writer?.format, () => null);
    const format = ST.FORMATS[ST.IDS.includes(id) ? id : 'mla9'];
    const bytes = await file.arrayBuffer();
    if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== file.size) throw new Error('invalid file read');
    const r = await GZ_WRITER_DOCX.importDocx(new Uint8Array(bytes), { format });
    const doc = GZ_WRITER_SCHEMA.paper.nodeFromJSON(r.doc);
    const keep = F.check(doc, format, {}, {}).issues.some((i) => F.KEPT.has(i.rule) && i.fix?.op !== 'format');
    const key = GZ_WRITER_PAPERS.newKey(), title = GZ_DOC_HOME.stem(file.name);
    await papers().save(key, { kind: 'paper', doc: doc.toJSON(), format: format.id, keep, named: !!title, title }, { reason: 'import' });
    return key;
  };
  const edit = async (key) => {
    document.documentElement.dataset.mode = 'paper';
    await GZ_WRITER_PAPER.need(['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js', 'lib/writer-settings.js']);
    await GZ_WRITER_SETTINGS.load();
    const plugins = [], hooks = { ready: [], change: [], context: [] };
    const emit = (event, ...a) => { for (const fn of hooks[event]) try { fn(...a); } catch (e) { console.error(e); } };
    let editor = null;
    // One context object, as writer.js keeps its init's. Verified assignment parts open the attempt's Sources store;
    // standalone, recovery and mismatched records keep the local key. Instructions and rubric are read only on Ultra.
    const rec = GZ_WRITER_PAPERS.local(key) ? null : await papers().get(key).catch(() => null);
    const paper = rec && GZ_WRITER_PAPERS.keyOf(rec) === key ? { school: rec.school.toLowerCase(), user: rec.user, course: rec.course, content: rec.content } : null;
    const context = { school: 'local', user: { id: 'local' }, course: { id: 'papers', ...(rec?.courseName && { name: rec.courseName }) }, item: { id: key },
      ...(rec && { kind: 'assignment', assignment: { title: rec.title || '', due: rec.due || null } }), ...(paper && { paper }) };
    // The same editor modules as an assignment frame, with a local host and no page messaging or submission. ⋯ entries
    // (item) stay off the page, as the paper hides writer.html's bar.
    globalThis.GZ_WRITER_FRAME = {
      t, mode: () => 'paper', kind: () => 'paper', editor: () => editor, slot: () => null, context: () => context,
      on: (event, fn) => { if (hooks[event] && typeof fn === 'function') hooks[event].push(fn); },
      plugin: (p) => { if (editor) editor.addPlugins([p]); else plugins.push(p); },
      item: (text, fn) => { const b = h('button', { type: 'button', role: 'menuitem', text }); b.addEventListener('click', fn); return b; },
    };
    await GZ_WRITER_PAPER.need(['lib/writer-sources.js', 'lib/writer-bibliography.js', 'lib/writer-cite.js', 'lib/writer-lookup.js', 'lib/ai/failure.js', 'lib/writer-issues.js', 'lib/writer-proof.js', 'lib/ai/tasks/writer-context.js', 'writer-proof.js', 'writer-ai.js', 'writer-mcp.js', 'writer-cite.js', 'lib/writer-export.js', 'writer-objects.js', 'writer-find.js', 'writer-counts.js', 'writer-print.js', 'writer-ruler.js', 'lib/writer-color.js', 'writer-paste.js']);
    const mountEl = h('div');
    document.body.append(mountEl);
    editor = GZ_WRITER_EDITOR.create({ mount: mountEl, mode: 'paper', html: '', plugins, onChange: (change) => emit('change', change) });
    // Opening writes (a document in Trash comes out of it, a tab's unsaved copy is saved): not before the claim.
    await claimed();
    await GZ_WRITER_PAPER.mount({ editor, t, standalone: true, key, context: () => ({}) });
    emit('ready', editor);
    motion().shown('paper');
  };

  // ---- the home
  const home = async () => {
    if (!look.whole) { look.whole = true; look.sheet(); look.paint(); }
    await GZ_WRITER_PAPER.need(['lib/writer-styles.js', 'lib/writer-format.js', 'lib/writer-thumb.js', 'lib/doc-home.js']);
    const ST = GZ_WRITER_STYLES, F = GZ_WRITER_FORMAT, PA = GZ_WRITER_PAPERS, DK = GZ_DOC_KINDS, DH = GZ_DOC_HOME, TH = GZ_WRITER_THUMB;
    const st = papers(), { INDEX, PAPER } = PA.KEYS;
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const VIEW = 'gz-documents-view', TILE = 0.17, THUMB_CAP = 48, TEXT_CAP = 2e6;
    const main = $('list');
    $('heading').textContent = t('Documents');
    // A format's name: the three's and presets' as they are, Blank's in the page's language.
    const labelOf = (f) => (f === ST.FORMATS.plain ? t('Blank') : f.label);
    const timeF = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }), dayF = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });
    const yearF = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' });
    const when = (ms) => { const d = new Date(ms), today = new Date(); return d.toDateString() === today.toDateString() ? timeF.format(d) : d.getFullYear() === today.getFullYear() ? dayF.format(d) : yearF.format(d); };
    const isField = (el) => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');

    // ---- the New band: Blank, then the three formats, each a link to a new document under a key minted as it opens
    const fresh = (id) => `papers.html?paper=${encodeURIComponent(PA.newKey())}&format=${id}`;
    const tiles = ['plain', ...ST.IDS.filter((id) => id !== 'plain')].map((id) => {
      const values = { name: t('Your name'), instructor: t('Instructor'), course: t('Course'), date: t('Date'), title: t('Title') };
      const f = ST.FORMATS[id], a = h('a', { class: 'gd-tile', 'data-format': id, href: fresh(id) }, h('span', { class: 'gd-tile-pic' }, TH.tile(f, id === 'plain' ? {} : values, { scale: TILE })), h('span', { class: 'gd-tile-name', text: labelOf(f) }));
      const mint = () => a.setAttribute('href', fresh(id));
      a.addEventListener('click', mint);
      a.addEventListener('auxclick', mint);
      return a;
    });
    const band = h('section', { class: 'gd-new', 'aria-labelledby': 'gd-new-h' }, h('h2', { id: 'gd-new-h', text: t('New') }), h('div', { class: 'gd-tiles' }, tiles));

    // ---- the toolbar: search, course, kind (once there are two), sort, grid or list, Trash (while it holds anything), import
    const q = h('input', { id: 'gd-q', type: 'search', 'aria-label': t('Search'), placeholder: t('Search'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    const courseSel = h('select', { id: 'gd-course', 'aria-label': t('Course'), hidden: true }), kindSel = h('select', { id: 'gd-kind', 'aria-label': t('Kind'), hidden: true });
    const sortSel = h('select', { id: 'gd-sort', 'aria-label': t('Sort') }, h('option', { value: 'updated', text: t('Last edited') }), h('option', { value: 'title', text: t('Title') }));
    const gridB = btn({ id: 'gd-grid', 'aria-label': t('Grid'), title: t('Grid') }, icon('grid')), listB = btn({ id: 'gd-list', 'aria-label': t('List'), title: t('List') }, icon('list'));
    const binB = btn({ id: 'gd-trash', 'aria-label': t('Trash'), title: t('Trash'), 'aria-pressed': 'false' }, icon('trash')), binBox = h('div', { class: 'gd-views gd-bin', hidden: true }, binB);
    const accept = Object.values(DK.KINDS).flatMap((k) => [...k.accept, k.mime]).join(',');
    const file = h('input', { id: 'gd-file', type: 'file', multiple: true, accept, hidden: true, tabindex: '-1', 'aria-label': t('Import .docx…') });
    const importB = btn({ id: 'gd-import', class: 'gd-btn' }, t('Import .docx…'));
    // Items the page's own scripts and mods add (GZ_DOCUMENTS.item 'toolbar'), before Import.
    const extra = h('div', { class: 'gd-extra', hidden: true });
    const said = h('p', { id: 'gd-said', class: 'gd-said', role: 'status' });
    const bar = h('div', { class: 'gd-bar' }, h('label', { class: 'gd-search' }, icon('search'), q), h('div', { class: 'gd-tools' }, courseSel, kindSel, sortSel, h('div', { class: 'gd-views' }, gridB, listB), binBox, extra, importB, file), said);
    const docs = h('ul', { id: 'gd-docs', class: 'gd-docs', 'aria-labelledby': 'heading' });
    const count = h('p', { id: 'gd-count', class: 'gd-sr', 'aria-live': 'polite' });
    // The heading and the New band share one panel of glass; the toolbar is another, the cards each their own.
    main.append(h('div', { class: 'gd-top' }, $('heading'), band), bar, docs, count);
    const say = (text) => motion().say(said, text || '');

    // ---- state
    // Text is bounded by characters, thumbnails by count (including those held in a detached card). Search retains each
    // row's match separately, so evicting text never removes a result. Epochs reject reads started before a stored edit.
    let rows = [], view = 'grid', sortBy = 'updated', course = 'all', kind = '', words = [], shown = [], current = null, focusNext = null, seq = 0;
    try { if (localStorage.getItem(VIEW) === 'list') view = 'list'; } catch { /* storage can be unavailable */ }
    let active = true, life = 0, textSize = 0;
    const gone = new Set(), texts = new Map(), derived = new Map(), thumbs = new Map(), near = new Set(), cards = new Map(), epochs = new Map(), hitsByKey = new Map();
    // bin: the Trash is the view. moving: key → into Trash (true) or out (false), as shown until storage says so.
    let bin = false;
    const moving = new Map();
    const epoch = (k) => epochs.get(k) || 0;
    const forgetText = (k) => { const x = texts.get(k); if (x) textSize -= x.text.length; texts.delete(k); hitsByKey.delete(k); };
    const titleOf = (r) => DH.titleOf(r, derived.get(r.key), t('Untitled document'));
    const bodyOf = (r) => { const x = texts.get(r.key); return x && x.updated === r.updated && x.epoch === epoch(r.key) ? x.text : null; };
    const matches = (r, title) => {
      const x = hitsByKey.get(r.key);
      if (x && x.gen === gen && x.updated === r.updated && x.epoch === epoch(r.key)) return x.hit;
      const hit = DH.matches(r, title, words, bodyOf(r));
      if (words.length && hit !== null) hitsByKey.set(r.key, { gen, updated: r.updated, epoch: epoch(r.key), hit });
      return hit;
    };
    // A narrow card wraps its line between parts, never inside one ("7:33 / PM") nor before a dot; a course name wraps.
    const whole = (s) => String(s).replace(/ /g, '\u00a0');
    const metaOf = (r) => [r.course, ...[labelOf(ST.get(r.format)), t('{n} words', { n: r.words || 0 }), when(r.updated)].map(whole)].filter(Boolean).join('\u00a0· ');
    // A row whose kind this build has no page code for stays out of the list, untouched.
    const known = () => rows.filter((r) => typeof DK.get(DK.kindOf(r))?.thumb === 'function' && !gone.has(r.key));
    // What the lists, search, the course choices and mods see: no document in Trash. inView: the view's (the Trash's).
    const live = () => DH.view(known(), false, moving), inView = () => DH.view(known(), bin, moving);
    // What a record says beyond the index: its text for search, and its first line where the index has no title.
    const learn = (k, rec) => {
      if (!rec?.doc) return;
      const text = DH.flat(rec.doc);
      forgetText(k);
      texts.set(k, { updated: rec.updated, epoch: epoch(k), text }); textSize += text.length;
      if (words.length) hitsByKey.set(k, { updated: rec.updated, epoch: epoch(k), gen, hit: DH.matches({ course: rec.courseName }, titleOf(rec), words, text) });
      while (textSize > TEXT_CAP) { const first = texts.keys().next().value; textSize -= texts.get(first).text.length; texts.delete(first); }
      if (!rec.title) { try { derived.set(k, F.name(rec.doc, ST.get(rec.format))); } catch { derived.set(k, ''); } }
    };

    // ---- cards: one per document, kept while it is listed so its thumbnail and focus survive a redraw
    const io = new IntersectionObserver((entries) => {
      if (!active) return;
      for (const e of entries) { if (e.isIntersecting) near.add(e.target.dataset.key); else near.delete(e.target.dataset.key); }
      pump();
    }, { rootMargin: '100% 0px' });
    const cardFor = (r) => {
      let c = cards.get(r.key);
      if (!c) {
        const id = `gd-t${++seq}`, k = DK.get(DK.kindOf(r));
        const link = h('a', { class: 'gd-title', id, href: `papers.html?${k.param}=${encodeURIComponent(r.key)}`, tabindex: '-1' });
        const more = btn({ class: 'gd-more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': t('More'), 'aria-describedby': id, title: t('More'), tabindex: '-1' }, icon('dots'));
        const pic = h('div', { class: 'gd-pic', 'data-key': r.key }), meta = h('p', { class: 'gd-meta' }), badge = h('span', { class: 'gd-badge', text: t('Submitted'), hidden: true });
        const el = h('li', { class: 'gd-card', 'data-key': r.key }, pic, h('div', { class: 'gd-info' }, icon(k.icon, 'gd-kind'), h('div', { class: 'gd-text' }, link, meta), badge, more));
        c = { el, link, more, pic, meta, badge, row: r, title: null, metaText: null };
        cards.set(r.key, c);
        const th = thumbs.get(r.key);
        if (th?.el) pic.append(th.el);
        io.observe(pic);
      }
      c.row = r;
      const title = titleOf(r), m = metaOf(r);
      if (c.title !== title && !(renaming?.k === r.key)) { c.title = title; c.link.textContent = title; }
      if (c.metaText !== m) { c.metaText = m; c.meta.textContent = m; }
      c.badge.hidden = !r.submitted;
      return c.el;
    };
    // The choices the rows hold: their courses (the filter shows once one has a course) and kinds (once there are two).
    let courseSig = '', kindSig = '';
    const choices = (list) => {
      const { names, none } = DH.courses(list, locale), sig = JSON.stringify([names, none]);
      if (sig !== courseSig) {
        courseSig = sig;
        courseSel.replaceChildren(h('option', { value: 'all', text: t('All courses') }), ...names.map((n) => h('option', { value: `c:${n}`, text: n })), none ? h('option', { value: 'none', text: t('No course') }) : null);
        if (![...courseSel.options].some((o) => o.value === course)) course = 'all';
        courseSel.value = course;
      }
      courseSel.hidden = !names.length;
      const ids = [...new Set(list.map((r) => DK.kindOf(r)))], ksig = ids.join();
      if (ksig !== kindSig) {
        kindSig = ksig;
        kindSel.replaceChildren(h('option', { value: '', text: t('All') }), ...ids.map((id) => h('option', { value: id, text: t(DK.KINDS[id].label) })));
        if (!ids.includes(kind)) kind = '';
        kindSel.value = kind;
      }
      kindSel.hidden = ids.length < 2;
    };
    const inCourse = (r) => DH.inCourse(r, course === 'all' ? '' : course === 'none' ? DH.NONE : course.slice(2));
    // The cards as the filters, search and order have them; the rest leave the page. One Tab stop: the current card's link.
    let renaming = null, held = false;
    const render = () => {
      if (!active) return;
      if (renaming) { held = true; return; }
      const all = known(), list = DH.view(all, bin, moving);
      // The Trash: newest trashed first, search only; its control shows while it holds anything or is open.
      if (bin) courseSel.hidden = kindSel.hidden = true; else choices(list);
      sortSel.hidden = bin;
      binBox.hidden = !bin && !all.some((r) => DH.inTrash(r, moving));
      const titles = new Map();
      const hits = list.filter((r) => { const title = titleOf(r); titles.set(r.key, title); return (bin || (inCourse(r) && (!kind || DK.kindOf(r) === kind))) && matches(r, title) === true; });
      shown = DH.sort(hits, bin ? 'trashed' : sortBy, titles, locale);
      const els = shown.map(cardFor);
      if (els.length !== docs.children.length || els.some((e, i) => docs.children[i] !== e)) {
        const had = docs.contains(document.activeElement) ? document.activeElement : null;
        motion().cards(() => docs.replaceChildren(...els));
        if (had?.isConnected) had.focus({ preventScroll: true });
      }
      const listed = new Set(rows.map((r) => r.key));
      for (const [k, c] of cards) if (!listed.has(k)) { io.unobserve(c.pic); near.delete(k); cards.delete(k); thumbs.delete(k); forgetText(k); derived.delete(k); epochs.delete(k); }
      for (const k of epochs.keys()) if (!listed.has(k)) { epochs.delete(k); forgetText(k); derived.delete(k); }
      roving();
      const n = t('{n} documents', { n: shown.length });
      if (count.textContent !== n) count.textContent = n;
      // A copy or an undone delete takes focus once it is listed; one the filters hide doesn't take it later.
      if (focusNext && listed.has(focusNext)) { const k = focusNext; focusNext = null; if (cards.get(k)?.el.isConnected) go(k); }
      later();
    };
    const roving = () => {
      if (!shown.some((r) => r.key === current)) current = shown[0]?.key ?? null;
      for (const r of shown) { const c = cards.get(r.key), ti = r.key === current ? '0' : '-1'; if (c.link.getAttribute('tabindex') !== ti) c.link.setAttribute('tabindex', ti); }
    };
    const go = (k) => { current = k; roving(); cards.get(k)?.link.focus(); };
    // The index again (storage changed, or the tab came back): one read at a time, the latest last.
    let reading = null, again = false;
    const refresh = () => {
      if (reading) { again = true; return reading; }
      reading = (async () => {
        do {
          again = false;
          rows = await st.list();
          for (const k of gone) if (!rows.some((r) => r.key === k)) gone.delete(k);
          for (const [k, into] of moving) { const r = rows.find((x) => x.key === k); if (!r || PA.trashed(r) === into) moving.delete(k); }
          render();
          if (active && words.length) await bodies();
        } while (again);
        tell('change');
      })().catch((e) => console.error(e)).finally(() => { reading = null; });
      return reading;
    };

    // ---- thumbnails: drawn for cards within a screen of the window, 12 records per storage read, kept by key and
    // revision; a stored change only invalidates it. Index refreshes and autosaves share one idle draw, never retaining
    // a full changed record for each offscreen document. Leaving this page disconnects the observer, also under bfcache.
    let pumping = false, idle = false;
    const pump = async () => {
      if (pumping || !active || document.hidden) return;
      pumping = true;
      const at = life;
      try {
        for (;;) {
          if (!active || at !== life) break;
          const batch = [...near].filter((k) => { const th = thumbs.get(k); return cards.get(k)?.el.isConnected && (!th || th.stale); }).slice(0, 12);
          if (!batch.length) break;
          const stamps = batch.map(epoch), got = await chrome.storage.local.get(batch.map((k) => PAPER + k));
          if (!active || at !== life) break;
          for (let i = 0; i < batch.length; i++) if (stamps[i] === epoch(batch[i])) draw(batch[i], got[PAPER + batch[i]] || null);
        }
      } catch (e) { console.error(e); } finally { pumping = false; }
    };
    const draw = (k, rec) => {
      let el = null;
      if (rec?.doc) { try { el = DK.get(DK.kindOf(rec))?.thumb(rec) || null; } catch (e) { console.error(e); } learn(k, rec); }
      thumbs.delete(k);
      thumbs.set(k, { rev: rec?.revision ?? null, el, stale: false });
      const c = cards.get(k);
      if (c) c.pic.replaceChildren(...(el ? [el] : []));
      if (!rows.find((r) => r.key === k)?.title && derived.get(k) && c) { const title = titleOf(c.row); if (c.title !== title && renaming?.k !== k) { c.title = title; c.link.textContent = title; } }
      for (const [old] of thumbs) {
        if (thumbs.size <= THUMB_CAP) break;
        if (near.has(old) && cards.get(old)?.el.isConnected) continue;
        thumbs.delete(old); cards.get(old)?.pic.replaceChildren();
      }
    };
    const later = () => {
      if (idle || !active || document.hidden) return;
      idle = true;
      (globalThis.requestIdleCallback || requestAnimationFrame)(() => { idle = false; pump(); });
    };
    const stale = (k, rec) => {
      epochs.set(k, epoch(k) + 1); forgetText(k); derived.delete(k);
      const th = thumbs.get(k);
      if (!th || (rec && th.rev === rec.revision)) return;
      th.stale = true;
      if (near.has(k)) later();
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pump(); });
    const changed = (changes, area) => {
      if (area !== 'local' || !active) return;
      for (const [name, ch] of Object.entries(changes)) if (name.startsWith(PAPER)) stale(name.slice(PAPER.length), ch.newValue);
      if (words.length) gen++;
      if (INDEX in changes || (words.length && Object.keys(changes).some((n) => n.startsWith(PAPER)))) refresh();
    };
    chrome.storage.onChanged.addListener(changed);
    addEventListener('pagehide', () => { active = false; life++; gen++; io.disconnect(); near.clear(); closeMenu(); dismiss(); chrome.storage.onChanged.removeListener(changed); });
    addEventListener('pageshow', (e) => {
      if (!e.persisted) return;
      active = true; thumbs.clear(); texts.clear(); hitsByKey.clear(); textSize = 0;
      for (const c of cards.values()) { c.pic.replaceChildren(); io.observe(c.pic); }
      chrome.storage.onChanged.addListener(changed); refresh();
    });

    // ---- search: titles and courses at once from the index; body text read 10 records at a time, the rest of a search
    // dropped when the next keystroke starts another.
    let gen = 0;
    const bodies = async () => {
      const g = ++gen;
      if (!active || !words.length) return;
      const want = inView().filter((r) => matches(r, titleOf(r)) === null);
      for (let i = 0; i < want.length; i += 10) {
        if (g !== gen || !active) return;
        const part = want.slice(i, i + 10), stamps = part.map((r) => epoch(r.key)), got = await chrome.storage.local.get(part.map((r) => PAPER + r.key));
        if (g !== gen || !active) return;
        for (let j = 0; j < part.length; j++) {
          const r = part[j], rec = got[PAPER + r.key];
          if (stamps[j] !== epoch(r.key)) continue;
          if (rec?.doc) learn(r.key, rec);
          else hitsByKey.set(r.key, { gen, updated: r.updated, epoch: epoch(r.key), hit: false });
        }
        render();
      }
    };
    q.addEventListener('input', () => { words = DH.terms(q.value); gen++; render(); bodies().catch((e) => console.error(e)); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; words = []; gen++; render(); } });
    courseSel.addEventListener('change', () => { course = courseSel.value; render(); });
    kindSel.addEventListener('change', () => { kind = kindSel.value; render(); });
    sortSel.addEventListener('change', () => { sortBy = sortSel.value; render(); });
    const setView = (v, keep) => {
      view = v; motion().cards(() => { main.dataset.view = v; });
      gridB.setAttribute('aria-pressed', String(v === 'grid')); listB.setAttribute('aria-pressed', String(v === 'list'));
      if (keep) try { localStorage.setItem(VIEW, v); } catch { /* the choice lasts this visit */ }
    };
    gridB.addEventListener('click', () => setView('grid', true));
    listB.addEventListener('click', () => setView('list', true));
    setView(view, false);

    // ---- the ⋯ menu: Rename (a standalone document's), Make a copy, Export .docx, Delete; then the items added for cards
    // (GZ_DOCUMENTS.item 'card'), each told the card's summary. In Trash: Restore and Delete forever only.
    let menu = null, keyMenu = false;
    const closeMenu = (back) => { if (!menu) return; const m = menu; menu = null; motion().leave(m.el, m.opener); m.opener.setAttribute('aria-expanded', 'false'); if (back) m.back.focus(); };
    const menuFor = (k, back) => {
      const c = cards.get(k);
      if (!c) return;
      if (menu?.k === k) { closeMenu(true); return; }
      closeMenu();
      const items = bin ? [['restore', 'Restore'], ['forever', 'Delete forever']] : [PA.local(k) ? ['rename', 'Rename'] : null, ['copy', 'Make a copy'], ['export', 'Export .docx'], ['delete', 'Delete']].filter(Boolean);
      const added = bin ? [] : [...slots.card.values()];
      const el = h('div', { class: 'pop gp-menu gd-menu', role: 'menu', 'aria-labelledby': c.link.id },
        items.map(([act, label]) => btn({ role: 'menuitem', tabindex: '-1', 'data-act': act, onclick: () => { closeMenu(act !== 'rename'); run(act, k); } }, t(label))),
        added.length ? h('div', { class: 'gp-hr', role: 'separator' }) : null,
        added.map((x) => btn({ role: 'menuitem', tabindex: '-1', class: 'gd-added', title: x.by || null, onclick: (e) => { closeMenu(true); x.run(summary(c.row), e); } }, x.label)));
      document.body.append(el);
      // A host can finish resizing its iframe after the menu opens. Keep both actions beside the live card geometry.
      const place = () => {
        const anchor = c.more.getClientRects().length ? c.more : c.link, r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
        el.style.left = `${Math.max(4, Math.min(r.right - w, innerWidth - w - 4))}px`;
        // The short Trash menu stays above its card, clear of the LMS's bottom navigation in a narrow frame.
        const above = (bin && r.top >= hh + 10) || r.bottom + 6 + hh > innerHeight - 4;
        el.style.top = `${Math.max(4, Math.min(above ? r.top - hh - 6 : r.bottom + 6, innerHeight - hh - 4))}px`;
      };
      place();
      el.style.transformOrigin = 'top right';
      el.addEventListener('keydown', (e) => {
        const all = [...el.querySelectorAll('[role="menuitem"]')], i = all.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length].focus(); }
      });
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      motion().open(el, c.more);
      c.more.setAttribute('aria-expanded', 'true');
      menu = { el, k, opener: c.more, back: back || c.more, place };
      el.querySelector('[role="menuitem"]').focus();
      place();
    };
    const run = (act, k) => {
      dismiss();
      say('');
      if (act === 'rename') rename(k);
      else if (act === 'copy') copy(k).catch((e) => { console.error(e); say(t('Not saved. Try again in a moment.')); });
      // A paper Word can't take (a picture kept in a form Word has no place for) is said on the page, not logged.
      else if (act === 'export') DK.get(DK.kindOf(cards.get(k)?.row)).exportFile(k).catch(() => say(t('The .docx could not be made.')));
      else if (act === 'delete') del(k);
      else if (act === 'restore') out(k);
      else if (act === 'forever') forever(k);
    };
    document.addEventListener('pointerdown', (e) => { keyMenu = false; if (menu && !menu.el.contains(e.target) && !menu.opener.contains(e.target)) closeMenu(); }, true);
    // The menu opened from the keyboard: the browser's own context menu that follows the key stays shut.
    document.addEventListener('contextmenu', (e) => { if (keyMenu) { keyMenu = false; e.preventDefault(); } });
    addEventListener('resize', () => menu?.place());
    addEventListener('scroll', () => menu?.place(), { passive: true });

    // ---- rename in place: Enter saves (named; emptied, the document's first line again), Esc or an unchanged name keeps it
    const rename = (k) => {
      const c = cards.get(k);
      if (!c || !PA.local(k) || renaming) return;
      dismiss();
      const input = h('input', { class: 'gd-rename', type: 'text', maxlength: '120', autocomplete: 'off', spellcheck: 'false', 'aria-label': t('Title') });
      const was = c.title;
      input.value = was;
      c.link.hidden = true;
      c.link.after(input);
      motion().open(input);
      renaming = { k, input };
      input.focus();
      input.select();
      let done = false;
      const finish = (keep, back) => {
        if (done) return;
        done = true;
        const v = input.value.replace(/\s+/g, ' ').trim();
        renaming = null;
        input.remove();
        c.link.hidden = false;
        if (keep && v !== was) {
          if (v) { c.title = v; c.link.textContent = v; }
          name(k, v).catch((e) => { console.error(e); say(t('Not saved. Try again in a moment.')); refresh(); });
        }
        if (back) go(k);
        if (held) { held = false; render(); }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true, true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false, true); }
      });
      input.addEventListener('blur', () => finish(true, false));
    };
    const name = async (k, v) => {
      if (v) return st.save(k, { title: v, named: true });
      const rec = await st.get(k);
      return st.save(k, { title: rec?.doc ? F.name(rec.doc, ST.get(rec.format)) : '', named: false });
    };
    // A copy as a standalone document (lib/writer-papers.js copyOf: the text and its look, never the assignment).
    const copy = async (k) => {
      const rec = await st.get(k);
      if (!rec) return;
      const c = PA.copyOf(rec, t('Copy of {title}', { title: titleOf(cards.get(k)?.row || rec) }));
      focusNext = c.key;
      await st.save(c.key, c);
    };

    // ---- delete: the card goes to Trash at once; the toast's Undo (or Ctrl+Z while it shows) takes it out again through the
    // worker. The toast goes at the next action or after 8 seconds. In Trash, Restore and Delete forever (the record and its
    // versions, no Undo) take the card out of the view at once too.
    let undoable = null;
    const dismiss = () => { if (!undoable) return; clearTimeout(undoable.timer); motion().leave(undoable.el); undoable = null; };
    // The card leaves the view (hide), focus going to the next card, else the one before, else search; then the worker's
    // write (write), and the card back with a word on the page if it is refused. → whether it was written.
    const leave = async (k, hide, back, write) => {
      dismiss();
      say('');
      const i = shown.findIndex((r) => r.key === k), next = shown[i + 1]?.key ?? shown[i - 1]?.key, inside = docs.contains(document.activeElement) || !!menu;
      hide();
      if (inside && next) current = next;
      render();
      if (inside && next) go(next);
      else if (inside) q.focus();
      try { if (await write()) { refresh(); return true; } } catch (e) { console.error(e); }
      back(); render(); say(t('Not saved. Try again in a moment.'));
      return false;
    };
    const del = async (k) => {
      if (!await leave(k, () => moving.set(k, true), () => moving.delete(k), () => st.trash(k))) return;
      const el = h('div', { class: 'pop gp-toast gd-toast', role: 'status' }, h('span', { text: t('Deleted') }), btn({ class: 'gp-toast-do', onclick: () => undo() }, t('Undo')));
      document.body.append(el);
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      motion().open(el);
      undoable = { k, el, timer: setTimeout(dismiss, 8000) };
    };
    const undo = async () => {
      const u = undoable;
      if (!u || u.restoring) return;
      u.restoring = true; clearTimeout(u.timer);
      try { await st.untrash(u.k); } catch (e) {
        console.error(e); say(t('Not saved. Try again in a moment.')); u.restoring = false;
        if (undoable === u) u.timer = setTimeout(dismiss, 8000);
        return;
      }
      if (undoable === u) dismiss();
      moving.set(u.k, false);
      focusNext = u.k;
      await refresh();
    };
    const out = (k) => leave(k, () => moving.set(k, false), () => moving.delete(k), () => st.untrash(k));
    const forever = (k) => leave(k, () => gone.add(k), () => gone.delete(k), async () => { await st.remove(k); return true; });
    // A document in Trash opens restored: a click here waits for the worker, then opens it as a card's link does (a frame
    // of a school's page replacing itself, embedded below); a new tab or window opens at once, restoring alongside.
    const reopen = (e) => {
      const link = e.target.closest?.('.gd-title'), k = link?.closest('.gd-card')?.dataset.key;
      if (!k || e.button > 1) return;
      const here = e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
      if (here) e.preventDefault();
      st.untrash(k).then(() => { if (here && active) location[window.top === window ? 'assign' : 'replace'](link.href); },
        (err) => { console.error(err); if (here) say(t('Not saved. Try again in a moment.')); });
    };
    binB.addEventListener('click', () => {
      bin = !bin;
      binB.setAttribute('aria-pressed', String(bin));
      dismiss(); closeMenu(); say('');
      render();
      if (binBox.hidden) q.focus();
    });

    // ---- files dropped anywhere on the page or chosen with Import .docx…: one new document each, at most 20
    const REFUSALS = new Set(['Choose a Word file smaller than 15 MB.', 'The pictures in this file are larger than 10 MB.', 'The document is too large.', 'A table is too wide.']);
    const bring = async (list) => {
      dismiss();
      say('');
      const { take, refused } = DH.route(list, DK.forFile, DK.KINDS, 20);
      const first = refused.find((x) => x.why !== 'count');
      const limitText = refused.some((x) => x.why === 'count') ? t('Choose up to 20 files at a time.') : '';
      let why = first ? (first.why === 'size' ? 'Choose a Word file smaller than 15 MB.' : 'That file could not be read as a Word document.') : '';
      for (const { file: f, kind: id } of take) {
        try { await DK.get(id).importFile(f); }
        catch (e) { console.error(e); why ||= e instanceof RangeError && REFUSALS.has(e.message) ? e.message : 'That file could not be read as a Word document.'; }
      }
      say([why && t(why), limitText].filter(Boolean).join(' '));
    };
    importB.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const list = [...file.files]; file.value = ''; bring(list).catch((e) => console.error(e)); });
    let depth = 0;
    const carries = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const dropOff = () => { depth = 0; main.removeAttribute('data-drop'); };
    document.addEventListener('dragenter', (e) => { if (!carries(e)) return; depth++; main.setAttribute('data-drop', ''); });
    document.addEventListener('dragover', (e) => { if (!carries(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; main.setAttribute('data-drop', ''); });
    document.addEventListener('dragleave', (e) => { if (carries(e) && (--depth <= 0 || !e.relatedTarget)) dropOff(); });
    document.addEventListener('drop', (e) => { if (!carries(e)) return; e.preventDefault(); dropOff(); bring([...e.dataTransfer.files]).catch((err) => console.error(err)); });

    // ---- the keyboard: arrows (the grid by its columns), Enter opens, F2 renames, Delete deletes, Shift+F10 or the
    // ContextMenu key opens the menu; / goes to search; Ctrl+Z undoes a delete while its toast shows.
    const cols = () => {
      if (view !== 'grid') return 1;
      const els = docs.children, top = els[0]?.offsetTop;
      let n = 0;
      while (n < els.length && els[n].offsetTop === top) n++;
      return Math.max(1, n);
    };
    docs.addEventListener('focusin', (e) => { const k = e.target.closest?.('.gd-card')?.dataset.key; if (k && e.target.matches('.gd-title') && k !== current) { current = k; roving(); } });
    docs.addEventListener('click', (e) => {
      const more = e.target.closest?.('.gd-more');
      if (!more) { if (bin) reopen(e); return; }
      e.preventDefault();
      const k = more.closest('.gd-card').dataset.key;
      current = k; roving();
      menuFor(k, more);
    });
    docs.addEventListener('auxclick', (e) => { if (bin) reopen(e); });
    docs.addEventListener('keydown', (e) => {
      if (!e.target.matches?.('.gd-title')) return;
      const k = e.target.closest('.gd-card').dataset.key;
      if (MAC && e.metaKey && e.key === 'Backspace') { e.preventDefault(); if (!bin) del(k); return; }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); keyMenu = true; menuFor(k, e.target); return; }
      if (e.shiftKey) return;
      const to = DH.move(shown.findIndex((r) => r.key === k), e.key, shown.length, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? cols() : 1);
      if (to != null) { e.preventDefault(); go(shown[to].key); }
      else if (e.key === 'F2' && PA.local(k) && !bin) { e.preventDefault(); rename(k); }
      else if (e.key === 'Delete' && !bin) { e.preventDefault(); del(k); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || isField(e.target)) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !menu) { e.preventDefault(); q.focus(); q.select(); }
      else if (undoable && (MAC ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    });

    // ---- GZ_DOCUMENTS: the page's hooks for its own scripts, as GZ_WRITER_FRAME is the editor's. on(event, fn): 'ready'
    // (the home is drawn) and 'change' (the documents changed); list(): every listed document's public summary
    // (lib/doc-home.js summary), newest first; open(key) and create(format) in this tab; read(key) → { key, title, text } and
    // export(key) → { name, mime, bytes } (its kind's file, GZ_DOC_KINDS), for a listed key only, else null; item(slot, label,
    // fn, { by }): a button in the toolbar ('toolbar') or an entry in every card's ⋯ menu ('card'), fn(summary or null, the
    // click) → { remove() }; style({ radius, glass, thumb, column }): the --gd-* hooks (papers.css), each a number or left
    // to the Look. Mods reach these through features/mods.js, each call checked by the worker first (lib/modbroker.js).
    const hooks = { ready: [], change: [] }, slots = { toolbar: new Map(), card: new Map() };
    const tell = (ev) => { for (const fn of hooks[ev]) try { fn(); } catch (e) { console.error(e); } };
    const summary = (r) => DH.summary(r, titleOf(r), DK.kindOf(r));
    const listed = (key) => live().find((r) => r.key === key) || null;
    const STYLE = { radius: ['--gd-radius', 'px'], glass: ['--gd-glass', 'px'], thumb: ['--gd-thumb', ''], column: ['--gd-column', 'px'] };
    let slotSeq = 0;
    const tools = () => { extra.replaceChildren(...[...slots.toolbar.values()].map((x) => x.el)); extra.hidden = !slots.toolbar.size; };
    const D = {
      t,
      on: (ev, fn) => { if (hooks[ev] && typeof fn === 'function') hooks[ev].push(fn); },
      list: () => DH.sort(live(), 'updated', new Map(), locale).map(summary),
      open: async (key) => {
        const r = known().find((r) => r.key === key);
        if (!r || (DH.inTrash(r, moving) && !await st.untrash(key))) return false;
        location[window.top === window ? 'assign' : 'replace'](`papers.html?${DK.get(DK.kindOf(r)).param}=${encodeURIComponent(key)}`);
        return true;
      },
      create: (format) => { const ok = ST.IDS.includes(format); if (ok) location.assign(fresh(format)); return ok; },
      read: async (key) => { const r = listed(key), rec = r && await st.get(key); return rec?.doc ? { key, title: titleOf(r), text: DK.get(DK.kindOf(r)).text(rec) } : null; },
      export: async (key) => { const r = listed(key), f = r && await DK.get(DK.kindOf(r)).file(key); return f ? { name: f.name, mime: f.mime, bytes: new Uint8Array(f.bytes) } : null; },
      item: (slot, label, fn, { by = '' } = {}) => {
        if (!slots[slot] || typeof fn !== 'function') return null;
        const k = ++slotSeq, x = { label: String(label), by: String(by), run: fn };
        if (slot === 'toolbar') x.el = btn({ class: 'gd-btn gd-quiet', title: x.by || null, onclick: (e) => fn(null, e) }, x.label);
        slots[slot].set(k, x);
        if (slot === 'toolbar') tools();
        return { remove: () => { if (slots[slot].delete(k) && slot === 'toolbar') tools(); } };
      },
      style: (vars) => { for (const [k, [prop, unit]] of Object.entries(STYLE)) { const v = vars?.[k]; if (Number.isFinite(v)) document.documentElement.style.setProperty(prop, `${v}${unit}`); else document.documentElement.style.removeProperty(prop); } },
    };
    globalThis.GZ_DOCUMENTS = Object.freeze(D);
    hooks.change.push(() => globalThis.GZ_MODS?.documents.change());

    // ---- mods: the Workers of the mods granted documents run here as on a school page (features/mods.js: its host, its
    // watchdog), on this page's calls: what the worker's answer carries is done through GZ_DOCUMENTS. Their items show with
    // the mod's name; opening or starting a document follows a click on one of the mod's own items, within a second, once.
    // The first mod in the student's order to set a --gd-* hook wins it.
    const mods = async () => {
      if (!chrome.runtime.getManifest().sandbox) return; // code mods run only where the manifest has their sandbox (content.js too)
      const a = await chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'list' }).catch(() => null);
      if (!Array.isArray(a?.mods) || !a.mods.length || !active) return;
      await GZ_WRITER_PAPER.need(['defaults.js', 'lib/modapi.js']);
      const keys = GZ_MODAPI.docKeys();
      const own = new Map(), styles = new Map(), clicked = new Map(); // `${mod}|${slot}|${id}` → item; mod → its hooks; mod → when its item was clicked
      const restyle = () => { const won = {}; for (const id of GZ_MODS.order()) for (const [k, v] of Object.entries(styles.get(id) || {})) won[k] ??= v; D.style(won); };
      const done = (value) => (value == null ? { error: 'args' } : { ok: true, value });
      const call = async (id, name, v, by) => {
        if (name === 'documents.list') return done(D.list().map((doc) => keys.summary(id, doc)));
        if (name === 'documents.read') { const r = await D.read(keys.resolve(id, v.key)); return done(r && { ...r, key: v.key }); }
        if (name === 'documents.export') return done(await D.export(keys.resolve(id, v.key)));
        if (name === 'documents.open' || name === 'documents.create') {
          const at = clicked.get(id);
          if (at === undefined || performance.now() - at > 1000) return { error: 'permission' };
          clicked.delete(id);
          return (name === 'documents.open' ? await D.open(keys.resolve(id, v.key)) : D.create(v.format)) ? null : { error: 'args' };
        }
        if (name === 'documents.add') {
          const k = `${id}|${v.slot}|${v.id}`;
          if (!own.has(k) && [...own.keys()].filter((x) => x.startsWith(`${id}|${v.slot}|`)).length >= 4) return { error: 'args' };
          own.get(k)?.remove();
          own.set(k, D.item(v.slot.slice(10), v.label, (doc, e) => { if (e?.isTrusted) clicked.set(id, performance.now()); GZ_MODS.documents.action(id, { slot: v.slot, id: v.id, ...(doc && { doc: keys.summary(id, doc) }) }); }, { by }));
          return null;
        }
        if (name === 'documents.remove') { const k = `${id}|${v.slot}|${v.id}`; if (!own.has(k)) return { error: 'args' }; own.get(k).remove(); own.delete(k); return null; }
        if (name === 'documents.style') { if (v) styles.set(id, v); else styles.delete(id); restyle(); return null; }
        return { error: 'call' };
      };
      const forget = (id) => { for (const [k, x] of own) if (k.startsWith(`${id}|`)) { x.remove(); own.delete(k); } clicked.delete(id); keys.forget(id); if (styles.delete(id)) restyle(); };
      globalThis.GZ_CTX = Object.freeze({ site: 'documents', need: (f, ready) => (ready() ? Promise.resolve() : GZ_WRITER_PAPER.need([f])), documents: Object.freeze({ call, forget }) });
      await GZ_WRITER_PAPER.need(['features/mods.js']);
      GZ_MODS.start(a.mods);
    };

    // What has been in Trash past 30 days goes as the page opens, once the worker takes its writes.
    claimed().then(() => st.purge()).catch((e) => console.error(e));
    await Promise.all([refresh(), look.surfaces]);
    main.hidden = false;
    tell('ready');
    motion().shown('home');
    mods().catch((e) => console.error(e));
  };

  catalogue().then(async () => {
    document.title = t('Documents');
    await GZ_WRITER_PAPER.need(['lib/writer-papers.js', 'lib/doc-kinds.js']);
    GZ_DOC_KINDS.register('paper', { edit, thumb, file, exportFile, text, importFile, measure: GZ_WRITER_PAPERS.measure });
    // ?<a kind's param>=<key> opens that document; else the home.
    const params = new URLSearchParams(location.search), id = Object.keys(GZ_DOC_KINDS.KINDS).find((k) => params.get(GZ_DOC_KINDS.KINDS[k].param));
    if (id) {
      const key = params.get(GZ_DOC_KINDS.KINDS[id].param), k = GZ_DOC_KINDS.get(id);
      const rec = GZ_WRITER_PAPERS.valid(key) ? await papers().get(key) : null;
      // Only a New tile can open a missing key. A stale link, malformed key or a kind this build cannot edit returns home
      // without mounting an empty editor over an existing document of another kind.
      const fresh = !rec && GZ_WRITER_PAPERS.local(key) && ['plain', 'mla9', 'apa7', 'chicago17'].includes(params.get('format'));
      if (typeof k.edit === 'function' && ((rec && GZ_DOC_KINDS.kindOf(rec) === id) || fresh)) { await k.edit(key); return; }
      history.replaceState(null, '', 'papers.html');
    }
    await home();
  }).catch((e) => console.error(e));
})();

// ---- embedded: Documents as a page of the school's site (features/settingspage.js). It shows, and the worker takes its
// writes, only once this document claims the one-use pass Glaze's page sends it after its hello (lib/background.js
// 'glaze:papers'): a site framing this page itself gets an empty one. It talks to that page over the pass's MessageChannel:
//   frame → page: opened { at } (this document's query once the list or a document shows), leave (Close, Escape);
//   page → frame: go { at } (Back or Forward to the list or a document).
// A link to another of Documents' addresses replaces this document, so the tab's history is the page's to keep.
if (window.top !== window) (() => {
  const root = document.documentElement, $ = (id) => document.getElementById(id);
  const locale = (() => { try { return chrome.i18n.getUILanguage(); } catch { return navigator.language || 'en'; } })();
  let port = null, told = false;
  root.setAttribute('data-embedded', '');
  root.style.setProperty('opacity', '0', 'important');
  document.body.inert = true;
  const leave = () => port?.postMessage({ type: 'leave' });
  // Back or Forward in the tab: where its entry says, or (here already, or nowhere Documents goes) where this is.
  const go = (at) => { if (/^(\?[^#]*)?$/.test(at) && at !== location.search) location.replace(`papers.html${at}`); else port?.postMessage({ type: 'opened', at: location.search }); };
  // Close: at the end of a document's top bar, or level with the list's heading.
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'gd-btn';
  for (const [k, v] of [['background', 'var(--gz-surface)'], ['color', 'var(--gz-ink)'], ['border', '1px solid var(--gz-line-strong)'], ['flex', 'none']]) close.style.setProperty(k, v);
  close.addEventListener('click', leave);
  const align = () => {
    const h = $('heading'), main = $('list');
    if (!h || close.parentNode !== main) return;
    close.style.setProperty('top', `${h.offsetTop + (h.offsetHeight - close.offsetHeight) / 2}px`);
    close.style.setProperty('right', `${main.clientWidth - h.offsetLeft - h.offsetWidth}px`);
  };
  const place = () => {
    if (close.isConnected) return true;
    const paper = root.dataset.mode === 'paper', at = paper ? document.querySelector('.gp-top') : $('list');
    if (!at || at.hidden) return false;
    close.textContent = GZ_I18N.t('Close', {}, locale);
    if (!paper) { close.style.setProperty('position', 'absolute'); addEventListener('resize', align); }
    at.append(close);
    align();
    return true;
  };
  const update = () => {
    if (port && !told && (root.dataset.mode === 'paper' || $('list')?.hidden === false)) { told = true; port.postMessage({ type: 'opened', at: location.search }); }
    if (place() && told) seen.disconnect();
  };
  const seen = new MutationObserver(update);
  seen.observe(root, { attributes: true, attributeFilter: ['data-mode'] });
  seen.observe(document.body, { childList: true });
  if ($('list')) seen.observe($('list'), { attributes: true, attributeFilter: ['hidden'] });
  addEventListener('message', async (e) => {
    const p = e.ports?.[0];
    if (port || !p || e.source !== parent || e.data?.type !== 'glaze:papers' || typeof e.data.pass !== 'string') return;
    const ok = await Promise.resolve().then(() => chrome.runtime.sendMessage({ type: 'glaze:papers', op: 'claim', pass: e.data.pass })).then((r) => r?.ok === true, () => false);
    if (!ok || port) { p.close(); return; }
    port = p;
    port.onmessage = ({ data }) => { if (data?.type === 'go' && typeof data.at === 'string') go(data.at); };
    root.style.removeProperty('opacity');
    document.body.inert = false;
    update();
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (a.target && a.target !== '_self') || a.hasAttribute('download')
      || a.href.split(/[?#]/)[0] !== location.href.split(/[?#]/)[0]) return;
    e.preventDefault();
    location.replace(a.href);
  });
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.target.closest?.('input, select, textarea, dialog, [role="dialog"], [role="menu"], [contenteditable]:not([contenteditable="false"])')) return;
    e.preventDefault();
    leave();
  });
  parent.postMessage({ type: 'glaze:papers:hello' }, '*');
})();
