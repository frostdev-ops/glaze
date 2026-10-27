// Glaze Writer's citations in the editor frame (writer.html, after writer.js and lib/writer-{sources,cite,lookup}.js):
// the selection toolbar's Cite button (slot 'cite') and its popover (look up a DOI, ISBN or address, pick a saved source,
// or add one by hand; the style's citation goes in at the caret, or a footnote in a Chicago paper), the paper side panel's
// Sources view, ⋯ Add references in compose mode (the list as plain paragraphs Quill keeps), and the cite issues
// (GZ_WRITER_ISSUES, when the proofing part is there). Adds to GZ_WRITER_CITE:
//   open({ anchor, prefill, form }) · add(prefill) · sourcesView(container) → { refresh, destroy } · count(doc?, sources?, style?)
//   sources() · setSources(list) · use(style) · style() · on(fn) (sources or style changed) · references()
// A lookup asks the browser for a page's host from the click itself (GZ_SITE.reach's way), then the worker fetches
// ('glaze:writer-lookup', lib/writer-lookup.js); what comes back is parsed here as untrusted text.
(() => {
  const F = globalThis.GZ_WRITER_FRAME, C = globalThis.GZ_WRITER_CITE, S = globalThis.GZ_WRITER_SOURCES, LK = globalThis.GZ_WRITER_LOOKUP;
  if (!F || !C || !S || !LK) return;
  const t = (k, v) => F.t(k, v);
  const countIn = C.count;
  const { TextSelection } = GZ_PM.state, { Fragment } = GZ_PM.model;
  const STYLE = { mla: 'mla9', mla9: 'mla9', apa: 'apa7', apa7: 'apa7', chicago: 'chicago17', chicago17: 'chicago17' };
  let sources = [], key = null, style = 'mla9', saved = null, loading = null, referenceBlock = null;
  const subs = new Set();
  const changed = () => { for (const fn of subs) try { fn({ sources: sources.slice(), style }); } catch (e) { console.error(e); } recheck(); };

  // ---- DOM helpers ----------------------------------------------------------------------------------------------------
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) { if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
    n.append(...kids.filter((k) => k != null));
    return n;
  };
  // The formatters' HTML (escaped text and <i> only) as nodes, never through innerHTML.
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const runs = (html) => String(html).split(/(<\/?i>)/).reduce((acc, part) => { if (part === '<i>') acc.i = true; else if (part === '</i>') acc.i = false; else if (part) acc.out.push({ text: unesc(part), i: acc.i }); return acc; }, { out: [], i: false }).out;
  const paint = (node, html) => { node.replaceChildren(...runs(html).map((r) => (r.i ? el('i', { text: r.text }) : document.createTextNode(r.text)))); return node; };
  const show = (pop) => { if (!pop.hidden) return; pop.hidden = false; pop.getBoundingClientRect(); pop.setAttribute('data-open', ''); };
  const hide = (pop) => { pop.hidden = true; pop.removeAttribute('data-open'); };

  const undoBox = el('div', { class: 'gzc-undo', role: 'status', hidden: true });
  const undoBtn = el('button', { type: 'button', text: t('Undo') });
  undoBox.append(el('span', { text: t('Source removed') }), undoBtn);
  document.body.append(undoBox);
  let undoAction = null, undoTimer = 0;
  const clearUndo = () => { clearTimeout(undoTimer); undoAction = null; undoBox.hidden = true; };
  undoBtn.addEventListener('click', () => { const action = undoAction; clearUndo(); action?.(); });
  const removeSource = (id, after) => {
    const src = sources.find((s) => s.id === id), where = key;
    if (!src) return;
    clearUndo();
    setSources(S.remove(sources, id));
    after();
    undoAction = () => { if (key === where) { setSources(S.add(sources, src).sources); after(); } };
    undoBox.hidden = false;
    undoTimer = setTimeout(clearUndo, 8000);
  };

  // ---- the style and the sources --------------------------------------------------------------------------------------
  const use = (s) => { const v = STYLE[String(s || '').toLowerCase()]; if (v && v !== style) { style = v; changed(); } return style; };
  const persist = () => {
    if (loading?.pending) { loading.edits = sources.slice(); return Promise.resolve(true); }
    return key ? S.save(key, sources) : Promise.resolve(true);
  };
  const setSources = (list) => { sources = S.dedupe(list); persist(); changed(); };
  const loadFor = async (context) => {
    if (context?.style) use(context.style);
    const k = S.keyOf(context);
    if (k === key) return;
    clearUndo();
    key = k;
    sources = [];
    referenceBlock = null;
    const load = loading = { key: k, pending: !!k, edits: null };
    changed();
    if (!k) return;
    const stored = await S.load(k);
    load.pending = false;
    const merged = load.edits ? S.dedupe([...load.edits, ...stored]) : stored;
    if (load.edits) S.save(k, merged);
    if (loading !== load) return;
    sources = merged;
    changed();
  };
  F.on('ready', (_, init) => loadFor(init?.context || F.context()));
  F.on('context', (c) => loadFor(c));

  // ---- cite issues ------------------------------------------------------------------------------------------------------
  // Off the typing path: a quiet moment after the last change, then one pass over the document.
  let timer = 0;
  const recheck = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const ed = F.editor(), I = globalThis.GZ_WRITER_ISSUES;
      if (!ed?.view || !I?.set) return;
      try { I.set('cite', C.check(ed.view.state.doc, sources, style, { t, shape: F.mode() !== 'paper' })); } catch (e) { console.error(e); }
    }, 600);
  };
  F.on('change', recheck);

  // ---- putting a citation in ------------------------------------------------------------------------------------------
  const insert = (src, page = '') => {
    const ed = F.editor();
    if (!ed?.view || !src) return false;
    const view = ed.view, f = C.format(src, style);
    const size = view.state.doc.content.size;
    const at = Math.max(0, Math.min(saved?.to ?? view.state.selection.to, size));
    if (style === 'chicago17' && F.mode() === 'paper') {
      // The first note for a source is the full one; later notes are short.
      const earlier = C.cites(view.state.doc, sources, style).some((c) => c.kind === 'note' && c.ids.includes(src.id) && c.at[0] < at);
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, at)));
      ed.run('footnote', earlier ? f.short(page) : f.note(page));
      ed.focus();
      return true;
    }
    // Compose has no footnotes: a Chicago citation there is its short note in parentheses.
    const html = style === 'chicago17' ? `(${f.short(page).replace(/\.$/, '')})` : f.inText(page);
    const schema = view.state.schema, italic = schema.marks.italic;
    const before = view.state.doc.textBetween(Math.max(0, at - 1), at, '\n', '\n');
    const nodes = runs(html).map((r) => schema.text(r.text, r.i && italic ? [italic.create()] : []));
    if (before && !/[\s(\[“"‘]/.test(before)) nodes.unshift(schema.text(' '));
    const frag = Fragment.from(nodes);
    let tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, at)).insert(at, frag);
    tr = tr.setSelection(TextSelection.create(tr.doc, at + frag.size)).scrollIntoView();
    view.dispatch(tr);
    ed.focus();
    return true;
  };

  // ⋯ Add references (compose): the list after the post, as a title paragraph and one paragraph an entry; done again, it
  // replaces the list it wrote before.
  const references = () => {
    const ed = F.editor();
    if (!ed?.view || !sources.length) return false;
    const view = ed.view, schema = view.state.schema, italic = schema.marks.italic;
    const l = C.list(sources, style);
    const para = (html) => schema.nodes.paragraph.create(null, runs(html).map((r) => schema.text(r.text, r.i && italic ? [italic.create()] : [])));
    let start = view.state.doc.content.size;
    if (referenceBlock && start >= referenceBlock.size && view.state.doc.content.cut(start - referenceBlock.size).eq(referenceBlock)) start -= referenceBlock.size;
    // The list's title is the style's own (Works Cited), whatever language Glaze speaks.
    const frag = Fragment.from([para(l.title), ...l.entries.map((e) => para(e.html))]);
    const tr = view.state.tr.replaceWith(start, view.state.doc.content.size, frag);
    view.dispatch(tr.scrollIntoView());
    referenceBlock = frag;
    return true;
  };

  // ---- the browser's grant for a page's host, from the click ------------------------------------------------------------
  // As lib/site.js reach: Safari's manifest holds every site; elsewhere exactly https://host/*, asked before anything is
  // awaited. A frame with no permissions API (Firefox's framed extension pages) can't ask: false.
  const reach = (url) => {
    let host;
    try { host = new URL(url).hostname; } catch { return Promise.resolve(false); }
    const c = globalThis.chrome;
    if ((c.runtime.getManifest().host_permissions || []).includes('<all_urls>')) return Promise.resolve(true);
    if (typeof c.permissions?.request !== 'function') return Promise.resolve(false);
    try { Promise.resolve(c.runtime.sendMessage({ type: 'glaze:allow', op: 'feature', origin: `https://${host}` })).catch(() => {}); } catch { /* the worker hears the grant either way */ }
    return new Promise((res) => res(c.permissions.request({ origins: [`https://${host}/*`] }))).then((ok) => ok === true, () => false);
  };
  const ask = (m) => Promise.resolve().then(() => chrome.runtime.sendMessage(m)).catch(() => null);

  // The AI's reading of a page whose metadata said too little: only with Settings → AI on for writing, and only if the
  // harness has the writer.cite task; otherwise the fields stay the student's to fill.
  const aiRead = async (f, url) => {
    const st = (await Promise.resolve().then(() => chrome.storage.local.get('ai')).catch(() => null))?.ai;
    if (!(st?.on === true && typeof st.use === 'string' && st.use && st.features?.writing === true)) return null;
    let port;
    try { port = chrome.runtime.connect({ name: 'glaze:ai' }); } catch { return null; }
    const answer = (id, m) => new Promise((res) => {
      const on = (a) => { if (a?.id === id && ['status', 'end', 'error'].includes(a.type)) { port.onMessage.removeListener(on); res(a); } };
      port.onMessage.addListener(on);
      port.onDisconnect.addListener(() => res(null));
      try { port.postMessage({ id, ...m }); } catch { res(null); }
    });
    const done = (v) => { try { port.disconnect(); } catch { /* gone */ } return v; };
    const timeout = new Promise((res) => setTimeout(() => res(null), 30000));
    const status = await Promise.race([answer(1, { op: 'status', feature: 'writing' }), timeout]);
    if (!status?.allowed || !status.ready) return done(null);
    const end = await Promise.race([answer(2, { op: 'run', feature: 'writing', task: 'writer.cite', input: { url, title: f.title, metas: f.metas.slice(0, 80), text: f.text } }), timeout]);
    return done(end?.type === 'end' && end.output && typeof end.output === 'object' ? S.normalize(end.output.source || end.output) : null);
  };

  // A pasted DOI, ISBN or address → a source to review (or the form with what is known), and a word for the status line.
  const lookup = async (value, say) => {
    const c = LK.classify(value);
    if (!c) { say(t('Use a DOI, ISBN or web address.'), true); return null; }
    const asked = c.kind === 'url' ? reach(c.value) : Promise.resolve(true);
    say(t('Looking up…'));
    const fallback = c.kind === 'doi' ? { type: 'article-journal', DOI: c.value } : c.kind === 'isbn' ? { type: 'book', ISBN: c.value } : { type: 'webpage', URL: c.value, accessed: S.today() };
    if (!await asked) { say(t('Glaze isn’t allowed to reach {host}.', { host: new URL(c.value).hostname }), true); return fallback; }
    const r = await ask({ type: 'glaze:writer-lookup', kind: c.kind, value: c.value });
    if (!r?.ok || typeof r.text !== 'string') { say(r?.error === 'redirect' ? t('This page redirects. Use its final address or add it manually.') : c.kind === 'url' && r?.error === 'host' ? t('Glaze isn’t allowed to reach {host}.', { host: new URL(c.value).hostname }) : t('Nothing found. Fill it in below.'), true); return fallback; }
    let src = null;
    try {
      if (c.kind === 'doi') src = LK.fromCSL(r.text);
      else if (c.kind === 'isbn') src = LK.fromOpenLibrary(r.text, c.value);
      else {
        const f = LK.facts(new DOMParser().parseFromString(r.text, 'text/html'));
        src = LK.fromFacts(f, LK.pageUrl(r.url) || c.value);
        if (LK.thin(src)) src = LK.merge(src, await aiRead(f, c.value).catch(() => null));
      }
    } catch { src = null; }
    say(src ? '' : t('Nothing found. Fill it in below.'), !src);
    return src || fallback;
  };

  // ---- the form -----------------------------------------------------------------------------------------------------------
  const TYPES = [['book', 'Book'], ['edited', 'Edited book'], ['chapter', 'Chapter'], ['article-journal', 'Journal article'], ['article-magazine', 'Magazine article'],
    ['article-newspaper', 'News article'], ['webpage', 'Web page'], ['motion_picture', 'Online video'], ['report', 'Report']];
  // Each type's fields: [field, label]; 'container-title' is named for what holds the work.
  const FIELDS = {
    book: [['author', 'Authors'], ['title', 'Title'], ['publisher', 'Publisher'], ['publisher-place', 'Place'], ['issued', 'Year'], ['edition', 'Edition'], ['ISBN', 'ISBN'], ['URL', 'URL']],
    edited: [['editor', 'Editors'], ['title', 'Title'], ['publisher', 'Publisher'], ['publisher-place', 'Place'], ['issued', 'Year'], ['edition', 'Edition'], ['ISBN', 'ISBN']],
    chapter: [['author', 'Authors'], ['title', 'Title'], ['container-title', 'Book'], ['editor', 'Editors'], ['publisher', 'Publisher'], ['publisher-place', 'Place'], ['issued', 'Year'], ['page', 'Pages']],
    'article-journal': [['author', 'Authors'], ['title', 'Title'], ['container-title', 'Journal'], ['volume', 'Volume'], ['issue', 'Issue'], ['page', 'Pages'], ['issued', 'Date'], ['DOI', 'DOI'], ['URL', 'URL']],
    'article-magazine': [['author', 'Authors'], ['title', 'Title'], ['container-title', 'Magazine'], ['issued', 'Date'], ['page', 'Pages'], ['URL', 'URL']],
    'article-newspaper': [['author', 'Authors'], ['title', 'Title'], ['container-title', 'Newspaper'], ['issued', 'Date'], ['page', 'Pages'], ['URL', 'URL']],
    webpage: [['author', 'Authors'], ['title', 'Title'], ['container-title', 'Website'], ['publisher', 'Publisher'], ['issued', 'Date'], ['URL', 'URL'], ['accessed', 'Accessed'], ['retrieval', 'Changes over time']],
    motion_picture: [['author', 'Authors'], ['title', 'Title'], ['container-title', 'Platform'], ['publisher', 'Uploaded by'], ['issued', 'Date'], ['URL', 'URL']],
    report: [['author', 'Authors'], ['title', 'Title'], ['publisher', 'Publisher'], ['number', 'Report number'], ['issued', 'Date'], ['URL', 'URL']],
  };
  const LIST = new Set(['author', 'editor']), DATES = new Set(['issued', 'accessed']);
  const showField = (src, k) => (k === 'retrieval' ? src[k] === true : LIST.has(k) ? (src[k] || []).map(S.showName).join('\n') : DATES.has(k) ? S.showDate(src[k]) : k === 'title' || k === 'container-title' ? String(src[k] || '').replace(/<\/?i>/g, '') : String(src[k] ?? ''));
  // host ← a form for src; done(source) on submit, cancel() on Cancel, drop(id) on Remove (an existing source).
  let formSerial = 0;
  const form = (host, src, { submit, done, cancel, drop }) => {
    let kind = src.type === 'book' && src.editor?.length && !src.author?.length ? 'edited' : FIELDS[src.type] ? src.type : 'book';
    const formId = ++formSerial;
    const values = {};
    for (const fs of Object.values(FIELDS)) for (const [k] of fs) if (!(k in values)) values[k] = showField(src, k);
    const f = el('form', { class: 'gzc-form', novalidate: true });
    const type = el('select', { class: 'gzc-type', 'aria-label': t('Type') }, ...TYPES.map(([v, l]) => el('option', { value: v, text: t(l), selected: v === kind })));
    const grid = el('div', { class: 'gzc-grid' });
    const draw = () => {
      grid.replaceChildren(...FIELDS[kind].map(([k, label]) => {
        const id = `gzc-${formId}-${k}`;
        const input = LIST.has(k) ? el('textarea', { id, rows: 2, spellcheck: 'false', placeholder: t('Last, First') }) : el('input', { id, type: k === 'retrieval' ? 'checkbox' : 'text', spellcheck: k === 'title' || k === 'container-title' ? 'true' : 'false' });
        if (k === 'retrieval') input.checked = values[k] === true; else input.value = values[k] || '';
        input.dataset.field = k;
        input.addEventListener('input', () => { values[k] = k === 'retrieval' ? input.checked : input.value; });
        return el('label', { class: `gzc-field${k === 'title' || LIST.has(k) || k === 'container-title' || k === 'URL' ? ' wide' : ''}`, for: id }, el('span', { text: t(label) }), input);
      }));
    };
    type.addEventListener('change', () => { kind = type.value; draw(); });
    draw();
    const acts = el('div', { class: 'gzc-acts' },
      el('button', { type: 'submit', class: 'sbtn', text: submit }),
      el('button', { type: 'button', class: 'sbtn ghost2', 'data-do': 'cancel', text: t('Cancel') }),
      drop ? el('span', { class: 'grow' }) : null,
      drop ? el('button', { type: 'button', class: 'sbtn ghost2', 'data-do': 'remove', text: t('Remove') }) : null);
    f.append(type, grid, acts);
    f.addEventListener('click', (e) => { const d = e.target.closest('[data-do]')?.dataset.do; if (d === 'cancel') cancel(); if (d === 'remove') drop(src.id); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const raw = { id: src.id, type: kind === 'edited' ? 'book' : kind };
      for (const [k] of FIELDS[kind]) { if (k === 'retrieval') { raw[k] = values[k] === true; continue; } const v = (values[k] || '').trim(); if (v) raw[k] = LIST.has(k) ? S.names(v) : DATES.has(k) ? S.date(v) || undefined : v; }
      // A title left as it was keeps its italics (the field shows it plain).
      for (const k of ['title', 'container-title']) if (src[k] && raw[k] === showField(src, k)) raw[k] = src[k];
      // What the lookup found but the form doesn't show stays (title-short, archive, …).
      for (const k of ['title-short', 'archive', 'translator', 'genre', 'medium', 'dimensions', 'ISBN', 'DOI']) if (src[k] && raw[k] === undefined && !FIELDS[kind].some(([x]) => x === k)) raw[k] = src[k];
      const s = S.normalize(raw);
      if (!s) { f.querySelector('[data-field="title"]')?.focus(); return; }
      done(s);
    });
    host.replaceChildren(f);
    (f.querySelector('[data-field="title"]:placeholder-shown') || f.querySelector('[data-field="title"]'))?.focus({ preventScroll: true });
    return f;
  };
  // Keeps a source: a new one joins the list (or fills the one it duplicates), an edited one replaces itself.
  const keep = (s) => {
    const had = sources.some((x) => x.id === s.id);
    const r = had ? { sources: S.replace(sources, s), id: s.id } : S.add(sources, s);
    setSources(r.sources);
    return sources.find((x) => x.id === r.id) || null;
  };

  // The lookup row: a field and Look up; found(source) with what came back.
  const finder = (found) => {
    const status = el('div', { class: 'gzc-status', role: 'status', hidden: true });
    const input = el('input', { class: 'gzc-in', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: t('DOI, ISBN or URL'), 'aria-label': t('DOI, ISBN or URL') });
    const go = el('button', { type: 'submit', class: 'sbtn', text: t('Look up') });
    const row = el('form', { class: 'gzc-row' }, input, go);
    let busy = false;
    const say = (msg, bad) => { status.hidden = !msg; status.textContent = msg || ''; status.classList.toggle('bad', !!bad); };
    row.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy || !input.value.trim()) return;
      busy = true;
      go.setAttribute('aria-disabled', 'true');
      // The page's host is asked for inside this submit (the click or Enter), before lookup awaits anything.
      lookup(input.value, say).then((s) => { if (s && row.isConnected) found(s); }).catch(() => say(t('Nothing found. Fill it in below.'), true)).finally(() => { busy = false; go.removeAttribute('aria-disabled'); });
    });
    return { row, status, input, say };
  };

  // ---- the popover ----------------------------------------------------------------------------------------------------------
  const pop = el('div', { class: 'pop gz-cite', role: 'dialog', 'aria-label': t('Cite'), hidden: true });
  document.body.append(pop);
  let anchor = null, returnTo = null, gwPx = 0;
  // In compose mode the frame is only as tall as the box: while the popover is open the frame asks for its height too.
  const fit = () => {
    if (F.mode() !== 'compose') return;
    const gw = document.getElementById('gw');
    gwPx = gw ? Math.ceil(gw.getBoundingClientRect().height) + 6 : 0;
    const need = pop.hidden ? gwPx : Math.max(gwPx, pop.offsetTop + pop.offsetHeight + 6);
    F.say({ type: 'height', px: need });
  };
  const ro = new ResizeObserver(() => { if (!pop.hidden) fit(); });
  ro.observe(pop);
  if (document.getElementById('gw')) ro.observe(document.getElementById('gw'));
  // Where it opened stays put while the frame grows for it (the toolbar that held Cite is gone by then).
  let at = null;
  const place = () => {
    const live = anchor?.getBoundingClientRect?.();
    const r = live?.width ? (at = { left: live.left, bottom: live.bottom }) : at || (at = caretRect());
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(3, Math.min((r?.left ?? 3) - 4, innerWidth - w - 3))}px`;
    pop.style.top = `${Math.max(3, (r?.bottom ?? 3) + 6 + scrollY)}px`;
  };
  const caretRect = () => { const v = F.editor()?.view; try { const c = v.coordsAtPos(v.state.selection.to); return { left: c.left, bottom: c.bottom }; } catch { return null; } };
  const close = (back) => {
    if (pop.hidden) return;
    hide(pop);
    pop.replaceChildren();
    fit();
    if (back) { if (returnTo?.isConnected && returnTo.getClientRects().length && !returnTo.closest('[hidden]')) returnTo.focus(); else F.editor()?.focus(); }
  };
  const sourceRow = (s, page) => {
    const pick = el('button', { type: 'button', class: 'gzc-src', 'data-id': s.id });
    pick.append(paint(el('span', { class: 'gzc-clamp' }), C.format(s, style).entry));
    pick.addEventListener('click', () => { insert(s, page.value.trim()); close(); });
    const edit = el('button', { type: 'button', class: 'gzc-edit', 'aria-label': t('Edit'), title: t('Edit') });
    edit.append(icon('M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4'));
    edit.addEventListener('click', () => drawForm(s, false));
    return el('div', { class: 'gzc-item' }, pick, edit);
  };
  const icon = (d) => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ico'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); svg.append(p); return svg; };
  const dialogClose = () => {
    const b = el('button', { type: 'button', class: 'gzc-close', 'aria-label': t('Close') }, icon('M6 6l12 12M18 6L6 18'));
    b.addEventListener('click', () => close(true));
    return b;
  };
  // Find: look up, saved sources, page, Add manually.
  const drawFind = () => {
    const find = finder((s) => drawForm(s, true, find.status.textContent));
    const page = el('input', { class: 'gzc-page', type: 'text', inputmode: 'text', spellcheck: 'false', placeholder: t('Page'), 'aria-label': t('Page') });
    const ordered = C.list(sources, style).entries.map((e) => sources.find((s) => s.id === e.id)).filter(Boolean);
    const list = el('div', { class: 'gzc-list' }, ...ordered.map((s) => sourceRow(s, page)));
    const manual = el('button', { type: 'button', class: 'sbtn ghost2', 'data-do': 'manual', text: t('Add manually') });
    manual.addEventListener('click', () => drawForm({ type: 'book' }, true));
    pop.replaceChildren(...[dialogClose(), find.row, find.status, ordered.length ? list : null, el('div', { class: 'gzc-foot' }, page, el('span', { class: 'grow' }), manual)].filter(Boolean));
    if (!pop.hidden) { fit(); find.input.focus({ preventScroll: true }); }
  };
  // The form: a found or new source (Cite saves it and puts it in), or a saved one to edit (Save, Remove).
  const drawForm = (src, cite, note) => {
    const status = el('div', { class: 'gzc-status bad', role: 'status', hidden: !note, text: note || '' });
    const host = el('div');
    const page = cite ? el('input', { class: 'gzc-page', type: 'text', spellcheck: 'false', placeholder: t('Page'), 'aria-label': t('Page') }) : null;
    pop.replaceChildren(dialogClose(), status, host);
    const f = form(host, src, {
      submit: cite ? t('Cite') : t('Save'),
      done: (s) => { const k = keep(s); if (cite && k) { insert(k, page?.value.trim()); close(); } else drawFind(); },
      cancel: () => drawFind(),
      drop: !cite && sources.some((x) => x.id === src.id) ? (id) => removeSource(id, drawFind) : null,
    });
    if (page) f.querySelector('.gzc-acts').prepend(page);
    if (!pop.hidden) fit();
  };
  const open = ({ anchor: a = null, prefill = null, form: asForm = false } = {}) => {
    const v = F.editor()?.view;
    saved = v ? { from: v.state.selection.from, to: v.state.selection.to } : null;
    anchor = a;
    returnTo = a || document.activeElement;
    at = null;
    if (prefill || asForm) drawForm(S.normalize({ type: 'book', ...prefill }) || { type: 'book', ...(prefill || {}) }, true); else drawFind();
    show(pop);
    place();
    fit();
    pop.querySelector('.gzc-in, [data-field="title"]')?.focus({ preventScroll: true });
  };
  pop.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } });
  document.addEventListener('pointerdown', (e) => { if (!pop.hidden && !pop.contains(e.target) && !undoBox.contains(e.target) && !(anchor && anchor.contains?.(e.target))) close(); }, true);
  addEventListener('resize', () => { if (!pop.hidden) place(); });

  // The selection toolbar's Cite (compose; the paper toolbar calls open() itself).
  const slot = F.slot('cite');
  if (slot) {
    const b = el('button', { type: 'button', class: 'gzc-cite on', text: t('Cite') });
    b.addEventListener('click', () => open({ anchor: b }));
    slot.append(el('span', { class: 'sepv' }), b);
    F.on('ready', () => { b.textContent = t('Cite'); });
  }
  // ⋯: Sources (the popover) and Add references, in compose mode.
  F.on('ready', () => {
    if (F.mode() !== 'compose') return;
    // After Blackboard editor, as the mockup's ⋯ lists them.
    for (const b of [F.item(t('Sources'), () => open({ anchor: document.getElementById('more') })), F.item(t('Add references'), () => { if (!references()) open({ anchor: document.getElementById('more') }); })]) b.parentNode.append(b);
  });

  // ---- the paper side panel's Sources view -----------------------------------------------------------------------------------
  const sourcesView = (container) => {
    const root = el('div', { class: 'gzc-view' });
    const title = el('h4');
    const addBtn = el('button', { type: 'button', class: 'sbtn', text: t('Add source') });
    const adder = el('div', { class: 'gzc-adder', hidden: true });
    const cards = el('div', { class: 'gzc-cards' });
    root.append(el('div', { class: 'gzc-head' }, title, addBtn), adder, cards);
    const closeAdder = () => { adder.hidden = true; adder.replaceChildren(); addBtn.hidden = false; addBtn.focus(); };
    const editIn = (host, src, after) => form(host, src, {
      submit: t('Save'),
      done: (s) => { keep(s); after(); },
      cancel: after,
      drop: sources.some((x) => x.id === src.id) ? (id) => removeSource(id, after) : null,
    });
    const openAdder = (prefill) => {
      adder.hidden = false;
      addBtn.hidden = true;
      const host = el('div');
      const find = finder((s) => editIn(host, s, closeAdder));
      const manual = el('button', { type: 'button', class: 'sbtn ghost2', text: t('Add manually') });
      manual.addEventListener('click', () => editIn(host, { type: 'book' }, closeAdder));
      const cancel = el('button', { type: 'button', class: 'sbtn ghost2', text: t('Cancel') });
      cancel.addEventListener('click', closeAdder);
      adder.replaceChildren(find.row, find.status, host, el('div', { class: 'gzc-foot' }, el('span', { class: 'grow' }), manual, cancel));
      if (prefill) editIn(host, S.normalize({ type: 'book', ...prefill }) || { type: 'book' }, closeAdder); else find.input.focus();
    };
    addBtn.addEventListener('click', () => openAdder());
    const refresh = () => {
      title.textContent = t(C.TITLES[style]);
      const ordered = C.list(sources, style).entries;
      cards.replaceChildren(...ordered.map((e) => {
        const s = sources.find((x) => x.id === e.id);
        const card = el('div', { class: 'gzc-card', 'data-id': e.id });
        const entry = paint(el('div', { class: 'gzc-entry' }), e.html);
        const cite = el('button', { type: 'button', class: 'sbtn', text: t('Cite') });
        cite.addEventListener('click', () => insert(s, ''));
        const edit = el('button', { type: 'button', class: 'sbtn ghost2', text: t('Edit') });
        edit.addEventListener('click', () => { const host = el('div'); card.replaceChildren(host); editIn(host, s, () => { refresh(); (root.querySelector(`[data-id="${s.id}"] .ghost2`) || addBtn).focus(); }); });
        card.append(entry, el('div', { class: 'row' }, cite, edit));
        return card;
      }));
    };
    const sub = () => refresh();
    subs.add(sub);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const cancel = e.target.closest('.gzc-form')?.querySelector('[data-do="cancel"]'); if (cancel) { e.preventDefault(); e.stopPropagation(); cancel.click(); } } });
    refresh();
    container.replaceChildren(root);
    return { refresh, add: openAdder, destroy: () => { subs.delete(sub); root.remove(); } };
  };

  Object.assign(C, {
    open, sourcesView, references, use, on: (fn) => { if (typeof fn === 'function') subs.add(fn); return () => subs.delete(fn); },
    add: (prefill) => open({ prefill: prefill?.name ? { author: [S.name(prefill.name)].filter(Boolean) } : prefill || {}, form: true }),
    style: () => style, sources: () => sources.slice(), setSources,
    // The compose bar's sources pill: how many of the saved sources the text cites, of how many.
    count: (doc = F.editor()?.view?.state.doc, list = sources, st = style) => (doc ? countIn(doc, list, st) : { cited: 0, total: list.length }),
  });
})();
