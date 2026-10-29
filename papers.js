// Glaze Writer's Documents home (papers.html): every document on this device as a grid of first-page thumbnails or a
// list, with a New band (Blank and the three formats), search, a course filter, sort, rename, copy, export, delete with
// Undo, and .docx files dropped or imported as new documents. ?paper=<key> opens one in the same paper chrome an
// assignment's frame has (writer-paper.js). Each kind of document (lib/doc-kinds.js) brings its own page code; this file
// registers the paper's. Reads Writer's storage directly and writes through the worker (lib/writer-papers.js).
(() => {
  // The student's palette as the popup wears it (ui.js paint, GZ_ACTIVE_COLORS): dark by the theme, or by the system with
  // auto light and dark, following both live. Until storage answers, the system's mode.
  const theme = async () => {
    const root = document.documentElement, scheme = matchMedia('(prefers-color-scheme: dark)');
    root.toggleAttribute('data-dark', scheme.matches);
    await GZ_WRITER_PAPER.need(['lib/color.js', 'lib/surfaces.js', 'lib/fonts.js', 'defaults.js', 'ui.js']);
    let turn = 0;
    const paint = async () => {
      const at = ++turn;
      try {
        const raw = await chrome.storage.sync.get(null);
        if (at !== turn) return;
        GZ_UI.paint(GZ_SANITIZE(raw));
        root.toggleAttribute('data-dark', root.style.colorScheme === 'dark');
      } catch (e) { console.error(e); }
    };
    scheme.addEventListener('change', paint);
    chrome.storage.onChanged.addListener((c, where) => { if (where === 'sync') paint(); });
    await paint();
  };
  theme().catch((e) => console.error(e));
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
  const PATHS = { paper: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', list: 'M4 6h16M4 12h16M4 18h16', dots: 'M5 12h.01M12 12h.01M19 12h.01' };
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

  // ---- the paper kind's page code (GZ_DOC_KINDS.register below)
  // A paper as a .docx download.
  const exportFile = async (key) => {
    await GZ_WRITER_PAPER.need([...DOCX, 'lib/writer-submit.js']);
    const p = await papers().get(key);
    if (!p?.doc) return;
    const f = GZ_WRITER_STYLES.get(p.format), surname = GZ_WRITER_FORMAT.surname(p.doc, f);
    const out = GZ_WRITER_DOCX.exportDocx(p.doc, { format: f, surname, title: p.title });
    const url = URL.createObjectURL(new Blob([out.bytes], { type: out.type }));
    const a = h('a', { href: url, download: GZ_WRITER_SUBMIT_LIB.fileName({ surname, title: p.title, fallback: t('Paper') }) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
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
    let editor = null;
    // The same editor modules as an assignment frame, with a local host and no page messaging or submission.
    globalThis.GZ_WRITER_FRAME = {
      t, mode: () => 'paper', kind: () => 'paper', editor: () => editor, slot: () => null, context: () => ({ school: 'local', user: { id: 'local' }, course: { id: 'papers' }, item: { id: key } }),
      on: (event, fn) => { if (hooks[event] && typeof fn === 'function') hooks[event].push(fn); },
      plugin: (p) => { if (editor) editor.addPlugins([p]); else plugins.push(p); },
    };
    await GZ_WRITER_PAPER.need(['lib/writer-sources.js', 'lib/writer-bibliography.js', 'lib/writer-cite.js', 'lib/writer-lookup.js', 'writer-cite.js', 'lib/writer-export.js', 'writer-objects.js', 'writer-find.js', 'writer-counts.js', 'writer-print.js', 'writer-ruler.js', 'lib/writer-color.js', 'writer-paste.js']);
    const mountEl = h('div');
    document.body.append(mountEl);
    editor = GZ_WRITER_EDITOR.create({ mount: mountEl, mode: 'paper', html: '', plugins, onChange: (change) => { for (const fn of hooks.change) fn(change); } });
    await GZ_WRITER_PAPER.mount({ editor, t, standalone: true, key, context: () => ({}) });
    for (const fn of hooks.ready) fn(editor);
  };

  // ---- the home
  const home = async () => {
    await GZ_WRITER_PAPER.need(['lib/writer-styles.js', 'lib/writer-format.js', 'lib/writer-thumb.js', 'lib/doc-home.js']);
    const ST = GZ_WRITER_STYLES, F = GZ_WRITER_FORMAT, PA = GZ_WRITER_PAPERS, DK = GZ_DOC_KINDS, DH = GZ_DOC_HOME, TH = GZ_WRITER_THUMB;
    const st = papers(), { INDEX, PAPER, VERSIONS } = PA.KEYS;
    const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    const VIEW = 'gz-documents-view', TILE = 0.17;
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
      const f = ST.FORMATS[id], a = h('a', { class: 'gd-tile', 'data-format': id, href: fresh(id) }, h('span', { class: 'gd-tile-pic' }, TH.tile(f, {}, { scale: TILE })), h('span', { class: 'gd-tile-name', text: labelOf(f) }));
      const mint = () => a.setAttribute('href', fresh(id));
      a.addEventListener('click', mint);
      a.addEventListener('auxclick', mint);
      return a;
    });
    const band = h('section', { class: 'gd-new', 'aria-labelledby': 'gd-new-h' }, h('h2', { id: 'gd-new-h', text: t('New') }), h('div', { class: 'gd-tiles' }, tiles));

    // ---- the toolbar: search, course, kind (once there are two), sort, grid or list, import
    const q = h('input', { id: 'gd-q', type: 'search', 'aria-label': t('Search'), placeholder: t('Search'), autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
    const courseSel = h('select', { id: 'gd-course', 'aria-label': t('Course'), hidden: true }), kindSel = h('select', { id: 'gd-kind', 'aria-label': t('Kind'), hidden: true });
    const sortSel = h('select', { id: 'gd-sort', 'aria-label': t('Sort') }, h('option', { value: 'updated', text: t('Last edited') }), h('option', { value: 'title', text: t('Title') }));
    const gridB = btn({ id: 'gd-grid', 'aria-label': t('Grid'), title: t('Grid') }, icon('grid')), listB = btn({ id: 'gd-list', 'aria-label': t('List'), title: t('List') }, icon('list'));
    const accept = Object.values(DK.KINDS).flatMap((k) => [...k.accept, k.mime]).join(',');
    const file = h('input', { id: 'gd-file', type: 'file', multiple: true, accept, hidden: true, tabindex: '-1' });
    const importB = btn({ id: 'gd-import', class: 'gd-btn' }, t('Import .docx…'));
    const bar = h('div', { class: 'gd-bar' }, h('label', { class: 'gd-search' }, icon('search'), q), h('div', { class: 'gd-tools' }, courseSel, kindSel, sortSel, h('div', { class: 'gd-views' }, gridB, listB), importB, file));
    const said = h('p', { id: 'gd-said', class: 'gd-said', role: 'status' });
    const docs = h('ul', { id: 'gd-docs', class: 'gd-docs', 'aria-labelledby': 'heading' });
    const count = h('p', { id: 'gd-count', class: 'gd-sr', 'aria-live': 'polite' });
    main.append(band, bar, said, docs, count);
    const say = (text) => { said.textContent = text || ''; };

    // ---- state
    // rows: the index; gone: deleted here, before storage says so; texts: key → { updated, text } (search); derived: key →
    // the record's own first line (rows stored without a title); thumbs: key → { rev, el, stale, next } (next: the record
    // a change brought); near: keys whose card is within a screen of the window.
    let rows = [], view = 'grid', sortBy = 'updated', course = 'all', kind = '', words = [], shown = [], current = null, focusNext = null, seq = 0;
    try { if (localStorage.getItem(VIEW) === 'list') view = 'list'; } catch { /* storage can be unavailable */ }
    const gone = new Set(), texts = new Map(), derived = new Map(), thumbs = new Map(), near = new Set(), cards = new Map();
    const titleOf = (r) => DH.titleOf(r, derived.get(r.key), t('Untitled document'));
    const bodyOf = (r) => { const x = texts.get(r.key); return x && x.updated === r.updated ? x.text : null; };
    const metaOf = (r) => [r.course, labelOf(ST.get(r.format)), t('{n} words', { n: r.words || 0 }), when(r.updated)].filter(Boolean).join(' · ');
    // A row whose kind this build has no page code for stays out of the list, untouched.
    const known = () => rows.filter((r) => typeof DK.get(DK.kindOf(r))?.thumb === 'function' && !gone.has(r.key));
    // What a record says beyond the index: its text for search, and its first line where the index has no title.
    const learn = (k, rec) => {
      if (!rec?.doc) return;
      texts.set(k, { updated: rec.updated, text: DH.flat(rec.doc) });
      if (!rec.title) { try { derived.set(k, F.name(rec.doc, ST.get(rec.format))); } catch { derived.set(k, ''); } }
    };

    // ---- cards: one per document, kept while it is listed so its thumbnail and focus survive a redraw
    const io = new IntersectionObserver((entries) => {
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
      if (renaming) { held = true; return; }
      const list = known();
      choices(list);
      const titles = new Map();
      const hits = list.filter((r) => { const title = titleOf(r); titles.set(r.key, title); return inCourse(r) && (!kind || DK.kindOf(r) === kind) && DH.matches(r, title, words, bodyOf(r)) === true; });
      shown = DH.sort(hits, sortBy, titles, locale);
      const els = shown.map(cardFor);
      if (els.length !== docs.children.length || els.some((e, i) => docs.children[i] !== e)) {
        const had = docs.contains(document.activeElement) ? document.activeElement : null;
        docs.replaceChildren(...els);
        if (had?.isConnected) had.focus({ preventScroll: true });
      }
      const listed = new Set(rows.map((r) => r.key));
      for (const [k, c] of cards) if (!listed.has(k) && !gone.has(k)) { io.unobserve(c.pic); near.delete(k); cards.delete(k); if (undoable?.k !== k) thumbs.delete(k); }
      roving();
      const n = t('{n} documents', { n: shown.length });
      if (count.textContent !== n) count.textContent = n;
      // A copy or an undone delete takes focus once it is listed; one the filters hide doesn't take it later.
      if (focusNext && listed.has(focusNext)) { const k = focusNext; focusNext = null; if (cards.get(k)?.el.isConnected) go(k); }
      pump();
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
          render();
        } while (again);
      })().catch((e) => console.error(e)).finally(() => { reading = null; });
      return reading;
    };

    // ---- thumbnails: drawn for cards within a screen of the window, 12 records per storage read, kept by key and
    // revision; a stored change marks one stale and it is drawn again from that change once it is near and the tab shows.
    let pumping = false, idle = false;
    const pump = async () => {
      if (pumping || document.hidden) return;
      pumping = true;
      try {
        for (;;) {
          const batch = [...near].filter((k) => { const th = thumbs.get(k); return cards.get(k)?.el.isConnected && (!th || th.stale); }).slice(0, 12);
          if (!batch.length) break;
          const ask = batch.filter((k) => !thumbs.get(k)?.next), got = ask.length ? await chrome.storage.local.get(ask.map((k) => PAPER + k)) : {};
          for (const k of batch) draw(k, thumbs.get(k)?.next || got[PAPER + k] || null);
        }
      } catch (e) { console.error(e); } finally { pumping = false; }
    };
    const draw = (k, rec) => {
      let el = null;
      if (rec?.doc) { try { el = DK.get(DK.kindOf(rec))?.thumb(rec) || null; } catch (e) { console.error(e); } learn(k, rec); }
      thumbs.set(k, { rev: rec?.revision ?? null, el, stale: false, next: null });
      const c = cards.get(k);
      if (c) c.pic.replaceChildren(...(el ? [el] : []));
      if (!rows.find((r) => r.key === k)?.title && derived.get(k) && c) { const title = titleOf(c.row); if (c.title !== title && renaming?.k !== k) { c.title = title; c.link.textContent = title; } }
    };
    const later = () => {
      if (idle || document.hidden) return;
      idle = true;
      (globalThis.requestIdleCallback || requestAnimationFrame)(() => { idle = false; pump(); });
    };
    const stale = (k, rec) => {
      if (rec?.doc) learn(k, rec);
      const th = thumbs.get(k);
      if (!th || (rec && th.rev === rec.revision)) return;
      th.stale = true; th.next = rec || null;
      if (near.has(k)) later();
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden) pump(); });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [name, ch] of Object.entries(changes)) if (name.startsWith(PAPER)) stale(name.slice(PAPER.length), ch.newValue);
      if (INDEX in changes) refresh();
    });
    addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });

    // ---- search: titles and courses at once from the index; body text read 10 records at a time, the rest of a search
    // dropped when the next keystroke starts another.
    let gen = 0;
    const bodies = async () => {
      const g = ++gen;
      if (!words.length) return;
      const want = known().filter((r) => bodyOf(r) == null && DH.matches(r, titleOf(r), words, null) === null);
      for (let i = 0; i < want.length; i += 10) {
        const part = want.slice(i, i + 10), got = await chrome.storage.local.get(part.map((r) => PAPER + r.key));
        for (const r of part) { const rec = got[PAPER + r.key]; if (rec?.doc) learn(r.key, rec); else texts.set(r.key, { updated: r.updated, text: '' }); }
        if (g !== gen) return;
        render();
      }
    };
    q.addEventListener('input', () => { words = DH.terms(q.value); render(); bodies().catch((e) => console.error(e)); });
    q.addEventListener('keydown', (e) => { if (e.key === 'Escape' && q.value) { e.preventDefault(); q.value = ''; words = []; gen++; render(); } });
    courseSel.addEventListener('change', () => { course = courseSel.value; render(); });
    kindSel.addEventListener('change', () => { kind = kindSel.value; render(); });
    sortSel.addEventListener('change', () => { sortBy = sortSel.value; render(); });
    const setView = (v, keep) => {
      view = v; main.dataset.view = v;
      gridB.setAttribute('aria-pressed', String(v === 'grid')); listB.setAttribute('aria-pressed', String(v === 'list'));
      if (keep) try { localStorage.setItem(VIEW, v); } catch { /* the choice lasts this visit */ }
    };
    gridB.addEventListener('click', () => setView('grid', true));
    listB.addEventListener('click', () => setView('list', true));
    setView(view, false);

    // ---- the ⋯ menu: Rename (a standalone document's), Make a copy, Export .docx, Delete
    let menu = null, keyMenu = false;
    const closeMenu = (back) => { if (!menu) return; const m = menu; menu = null; m.el.remove(); m.opener.setAttribute('aria-expanded', 'false'); if (back) m.back.focus(); };
    const menuFor = (k, back) => {
      const c = cards.get(k);
      if (!c) return;
      if (menu?.k === k) { closeMenu(true); return; }
      closeMenu();
      const items = [PA.local(k) ? ['rename', 'Rename'] : null, ['copy', 'Make a copy'], ['export', 'Export .docx'], ['delete', 'Delete']].filter(Boolean);
      const el = h('div', { class: 'pop gp-menu gd-menu', role: 'menu', 'aria-labelledby': c.link.id },
        items.map(([act, label]) => btn({ role: 'menuitem', tabindex: '-1', 'data-act': act, onclick: () => { closeMenu(act !== 'rename'); run(act, k); } }, t(label))));
      document.body.append(el);
      const anchor = c.more.getClientRects().length ? c.more : c.link, r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
      el.style.left = `${Math.max(4, Math.min(r.right - w, innerWidth - w - 4))}px`;
      el.style.top = `${r.bottom + 6 + hh > innerHeight - 4 ? Math.max(4, r.top - hh - 6) : r.bottom + 6}px`;
      el.style.transformOrigin = 'top right';
      el.addEventListener('keydown', (e) => {
        const all = [...el.querySelectorAll('[role="menuitem"]')], i = all.indexOf(document.activeElement);
        if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
        else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); all[e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowUp' ? all.length - 1 : 1)) % all.length].focus(); }
      });
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      c.more.setAttribute('aria-expanded', 'true');
      menu = { el, k, opener: c.more, back: back || c.more };
      el.querySelector('[role="menuitem"]').focus();
    };
    const run = (act, k) => {
      dismiss();
      say('');
      if (act === 'rename') rename(k);
      else if (act === 'copy') copy(k).catch((e) => { console.error(e); say(t('Not saved. Try again in a moment.')); });
      // A paper Word can't take (a picture kept in a form Word has no place for) is said on the page, not logged.
      else if (act === 'export') DK.get(DK.kindOf(cards.get(k)?.row)).exportFile(k).catch(() => say(t('The .docx could not be made.')));
      else if (act === 'delete') del(k);
    };
    document.addEventListener('pointerdown', (e) => { keyMenu = false; if (menu && !menu.el.contains(e.target) && !menu.opener.contains(e.target)) closeMenu(); }, true);
    // The menu opened from the keyboard: the browser's own context menu that follows the key stays shut.
    document.addEventListener('contextmenu', (e) => { if (keyMenu) { keyMenu = false; e.preventDefault(); } });

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
          name(k, v).catch((e) => { console.error(e); say(t('Not saved. Try again in a moment.')); });
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

    // ---- delete: the card goes at once; the toast's Undo (or Ctrl+Z while it shows) puts the record and its versions
    // back through the worker (merge). The toast goes at the next action or after 8 seconds.
    let undoable = null;
    const dismiss = () => { if (!undoable) return; clearTimeout(undoable.timer); undoable.el.remove(); undoable = null; };
    const del = async (k) => {
      dismiss();
      say('');
      const i = shown.findIndex((r) => r.key === k), next = shown[i + 1]?.key ?? shown[i - 1]?.key, inside = docs.contains(document.activeElement) || !!menu;
      gone.add(k);
      if (inside && next) current = next;
      render();
      if (inside && next) go(next);
      let records;
      try {
        const got = await chrome.storage.local.get([PAPER + k, VERSIONS + k]);
        records = { ...(got[PAPER + k] ? { [PAPER + k]: got[PAPER + k] } : {}), ...(Array.isArray(got[VERSIONS + k]) ? { [VERSIONS + k]: got[VERSIONS + k] } : {}) };
        await st.remove(k);
      } catch (e) { console.error(e); gone.delete(k); render(); say(t('Not saved. Try again in a moment.')); return; }
      const undo = PAPER + k in records ? btn({ class: 'gp-toast-do', onclick: () => restore() }, t('Undo')) : null;
      const el = h('div', { class: 'pop gp-toast gd-toast', role: 'status' }, h('span', { text: t('Deleted') }), undo);
      document.body.append(el);
      el.getBoundingClientRect();
      el.setAttribute('data-open', '');
      undoable = { k, records, el, timer: setTimeout(dismiss, 8000) };
    };
    const restore = async () => {
      const u = undoable;
      if (!u || !(PAPER + u.k in u.records)) return;
      dismiss();
      try { await st.merge(u.records); } catch (e) { console.error(e); say(t('Not saved. Try again in a moment.')); return; }
      gone.delete(u.k);
      focusNext = u.k;
      await refresh();
    };

    // ---- files dropped anywhere on the page or chosen with Import .docx…: one new document each, at most 20
    const REFUSALS = new Set(['Choose a Word file smaller than 15 MB.', 'The pictures in this file are larger than 10 MB.', 'The document is too large.', 'A table is too wide.']);
    const bring = async (list) => {
      dismiss();
      say('');
      const { take, refused } = DH.route(list, DK.forFile, DK.KINDS, 20);
      const first = refused.find((x) => x.why !== 'count');
      let why = first ? (first.why === 'size' ? 'Choose a Word file smaller than 15 MB.' : 'That file could not be read as a Word document.') : '';
      for (const { file: f, kind: id } of take) {
        try { await DK.get(id).importFile(f); }
        catch (e) { console.error(e); why ||= e instanceof RangeError && REFUSALS.has(e.message) ? e.message : 'That file could not be read as a Word document.'; }
      }
      if (why) say(REFUSALS.has(why) ? t(why) : t('That file could not be read as a Word document.'));
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
      if (!more) return;
      e.preventDefault();
      const k = more.closest('.gd-card').dataset.key;
      current = k; roving();
      menuFor(k, more);
    });
    docs.addEventListener('keydown', (e) => {
      if (!e.target.matches?.('.gd-title')) return;
      const k = e.target.closest('.gd-card').dataset.key;
      if (MAC && e.metaKey && e.key === 'Backspace') { e.preventDefault(); del(k); return; }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); keyMenu = true; menuFor(k, e.target); return; }
      if (e.shiftKey) return;
      const to = DH.move(shown.findIndex((r) => r.key === k), e.key, shown.length, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? cols() : 1);
      if (to != null) { e.preventDefault(); go(shown[to].key); }
      else if (e.key === 'F2' && PA.local(k)) { e.preventDefault(); rename(k); }
      else if (e.key === 'Delete') { e.preventDefault(); del(k); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || isField(e.target)) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !menu) { e.preventDefault(); q.focus(); q.select(); }
      else if (undoable && (MAC ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') { e.preventDefault(); restore(); }
    });

    await refresh();
    main.hidden = false;
  };

  catalogue().then(async () => {
    document.title = t('Documents');
    await GZ_WRITER_PAPER.need(['lib/writer-papers.js', 'lib/doc-kinds.js']);
    GZ_DOC_KINDS.register('paper', { edit, thumb, exportFile, importFile, measure: GZ_WRITER_PAPERS.measure });
    // ?<a kind's param>=<key> opens that document; else the home.
    const params = new URLSearchParams(location.search), id = Object.keys(GZ_DOC_KINDS.KINDS).find((k) => params.get(GZ_DOC_KINDS.KINDS[k].param));
    await (id ? GZ_DOC_KINDS.get(id).edit(params.get(GZ_DOC_KINDS.KINDS[id].param)) : home());
  }).catch((e) => console.error(e));
})();
