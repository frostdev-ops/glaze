// Options page: the full editor. Every edit repaints this page and the preview frame at once.
// Sliders and colour drags save after the input rests (sync storage allows ~120 writes a minute);
// everything else saves on change.
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
// In the browser's language (lib/i18n.js): this page's own text now, and every word written later.
GZ_I18N.page();
const t = (key, vars) => GZ_I18N.t(key, vars, GZ_I18N.ui());
// Ultra's own colour for each course slot: the picker starts there.
const DEPTH = ['Flat', 'Soft', 'Raised', 'Floating'];
const FORMAT = {
  pct: (v) => GZ_I18N.pct(Math.round(v * 100), GZ_I18N.ui()),
  surfacepct: (v) => v < 0 ? t('Automatic') : GZ_I18N.pct(v, GZ_I18N.ui()),
  pct100: (v) => GZ_I18N.pct(v, GZ_I18N.ui()),
  px: (v) => `${v}px`,
  depth: (v) => t(DEPTH[v]),
  deg: (v) => `${v}°`,
  presence: (v) => t(['Faint', 'Soft', 'Clear', 'Bold'][Math.min(3, Math.floor(v / 25))]),
  themepx: (v) => (v < 0 ? t('Theme') : `${v}px`),
  sec: (v) => `${GZ_I18N.num(v / 1000, GZ_I18N.ui())} s`,
};

let hintTimer = 0, undoHeld = false;
// `undo`: what an Undo beside the message does. It stays longer, since a change that replaced something is worth a second look,
// and the "Saved" that follows its own change leaves it be (undoHeld) until the next edit or the end of its time.
const hint = (msg, err = false, undo = null) => {
  const h = $('#hint');
  h.textContent = msg;
  h.classList.toggle('err', err);
  undoHeld = !!undo;
  if (undo) {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Undo') });
    b.addEventListener('click', () => { hint(''); undo(); });
    h.append(' ', b);
  }
  clearTimeout(hintTimer);
  if (msg && !err) hintTimer = setTimeout(() => { h.textContent = ''; undoHeld = false; }, undo ? 10000 : 2500);
};

// ---- search: each child of a section (or of a .group) is a setting. It matches on its own text,
// titles and labels, its section and group headings, and the notes it names by aria-describedby or
// aria-labelledby, which show and hide with it. Nothing here lists the settings. ----
const finder = $('#find');
let followSection = () => {}, searchPreview = () => {};
const editor = GZ_EDITOR.mount({ onRoute: (route, part) => followSection(route, part) });
GZ_INFO.mount();

// Opened as a page of the school's site (features/settingspage.js): the same Settings, with Close and a way to its own tab.
// The page around can't read this frame, but it could cover it and borrow a click, so what holds keys and grants (sharing,
// mods, backups) asks for a tab of its own. The worker refuses those operations from a frame anyway; it trusts this frame, once
// it has claimed its ticket, only for the writes that hold no keys or grants (nicknames, Look media, the pet library).
const embedded = window.top !== window;
if (embedded) {
  document.documentElement.setAttribute('data-embedded', '');
  // Shown only once the worker confirms this frame was opened by Glaze's navigation in this tab (a one-use ticket): a
  // site framing Settings on its own gets an empty page.
  const ticket = new URLSearchParams(location.search).get('t') || '';
  history.replaceState(null, '', location.pathname + location.hash);
  chrome.runtime.sendMessage({ type: 'glaze:settings-claim', ticket }).then((r) => { if (r?.ok) document.documentElement.setAttribute('data-embed-ok', ''); }, () => {});
  addEventListener('message', (e) => { if (e.source === window.parent && e.data?.gzSettings === 'go' && /^#[a-z][a-z-]*(\/[a-z-]+)?$/.test(e.data.hash || '')) location.hash = e.data.hash; });
  $('.embed-tools').hidden = false;
  const leave = () => window.parent.postMessage({ gzSettings: 'close' }, '*');
  // Where the frame has no tabs API (Firefox gives an extension page framed in a web page none), the worker opens it.
  const ownTab = (hash = location.hash, action) => {
    const opened = !action && chrome.tabs?.create ? chrome.tabs.create({ url: chrome.runtime.getURL('options.html') + hash })
      : chrome.runtime.sendMessage({ type: 'glaze:settings-tab', hash, ...(action && { action }) }).then((r) => { if (!r?.ok) throw Error('refused'); });
    opened.then(leave, () => {});
  };
  // Nor any permissions API: a control that needs a grant (lib/site.js reach) opens Settings' own tab at its section.
  if (typeof chrome.permissions?.request !== 'function') {
    GZ_SITE.elsewhere = (from, action) => { const at = from?.closest?.('[data-editor-section]')?.dataset.editorSection; ownTab(at ? `#${at}` : location.hash, action); };
  }
  $('#embed-close').addEventListener('click', leave);
  $('#embed-tab').addEventListener('click', () => ownTab());
  addEventListener('keydown', (e) => {
    // Let the browser dismiss its top-layer description before Escape can close the surrounding Settings frame.
    if (e.key === 'Escape' && document.querySelector('.info-pop:popover-open')) return;
    if (e.key !== 'Escape' || e.defaultPrevented || e.target.closest?.('input, select, textarea, dialog, [role="dialog"], [role="menu"]')) return;
    e.preventDefault(); leave();
  });
  const make = (tag, props, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  for (const [panel, name] of [['sharing', 'Sharing'], ['mods', 'Mods'], ['ai', 'AI'], ['backup', 'Privacy and data']]) {
    const box = document.querySelector(`[data-editor-panel="${panel}"]`);
    if (!box) continue;
    const go = make('button', { type: 'button', className: 'primary', textContent: t('Open in a new tab') });
    go.addEventListener('click', () => ownTab());
    box.setAttribute('data-gated', '');
    box.prepend(make('div', { className: 'embed-gate' }, make('h2', { textContent: t(name) }),
      make('p', { textContent: t('This part of Glaze holds your keys, backups and the permissions mods get, so it opens in a tab of its own, where no website can reach it.') }), go));
  }
}
// A section's parts are its children, and the children of the boxes in it (groups, More options, the navigation's bodies), each
// box's own heading aside. A match inside a closed More options opens it; leaving the search closes it again (lib/editor.js).
const BOX = '.group, .nb-body, .nb-group, .nav-own, .stack, details.more';
const filter = () => {
  const words = GZ_FIND.parse(finder.value);
  const on = words.length > 0;
  document.body.classList.toggle('finding', on);
  editor.finding(on); searchPreview(on);
  const marks = [];
  const mark = (root, heading = false) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let t; (t = w.nextNode());) {
      for (const [a, b] of GZ_FIND.spans(t.data, words, heading)) {
        const r = new Range();
        r.setStart(t, a);
        r.setEnd(t, b);
        marks.push(r);
      }
    }
  };
  const named = (el) => [el, ...el.querySelectorAll('[aria-describedby], [aria-labelledby]')]
    .flatMap((e) => `${e.getAttribute('aria-describedby') || ''} ${e.getAttribute('aria-labelledby') || ''}`.split(' '))
    .map((id) => id && document.getElementById(id)).filter(Boolean);
  const said = (el) => [el, ...el.querySelectorAll('[title], [aria-label], [placeholder]')]
    .map((e) => `${e.title} ${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''}`).join(' ');
  let n = 0;
  for (const b of $$('button.info.found')) b.classList.remove('found');
  for (const sec of $$('[data-editor-section]')) {
    const h2 = sec.querySelector('h2'), boxes = [];
    const partsOf = (box) => [...box.children].flatMap((el) => {
      if (el.matches('.section-heading, .section-path, summary') || (box !== sec && el.tagName === 'H3')) return [];
      if (el.matches(BOX)) { boxes.push(el); return partsOf(el); }
      return [el];
    });
    const parts = partsOf(sec);
    const notes = new Map(parts.map((el) => [el, named(el)]));
    const isNote = new Set([...notes.values()].flat());
    for (const el of isNote) el.classList.toggle('miss', on);
    let any = false;
    for (const el of parts) {
      if (isNote.has(el)) continue;
      const heads = [];
      for (let box = el.parentElement; box && box !== sec; box = box.parentElement) if (box.matches(BOX)) heads.push(box.querySelector(':scope > h3')?.textContent || '');
      const text = [el.textContent, said(el), ...notes.get(el).map((x) => x.textContent)].join(' ');
      const tab = $(`[data-editor-tab="${sec.dataset.editorSection.split('/')[0]}"]`).textContent;
      const hit = !on || (!el.closest('[hidden]') && GZ_FIND.matches(`${tab} ${h2.textContent} ${heads.join(' ')}`, `${sec.dataset.sites} ${text}`, words));
      el.classList.toggle('miss', !hit);
      if (!hit || !on) continue;
      any = true;
      n++;
      for (const x of [el, ...notes.get(el)]) { x.classList.remove('miss'); mark(x); }
      // A match only in a "?"'s description rings the "?"; opening it shows the words marked.
      for (const pop of [el, ...notes.get(el)].flatMap((x) => (x.matches('.info-pop') ? [x] : [...x.querySelectorAll('.info-pop')]))) {
        if (GZ_FIND.spans(pop.textContent, words).length) document.querySelector(`[popovertarget="${pop.id}"]`)?.classList.add('found');
      }
    }
    // Innermost first, so a box holding only empty boxes is empty too.
    for (const g of boxes.reverse()) {
      const empty = on && !g.querySelector(':scope > :not(h3, summary, .miss)');
      g.classList.toggle('miss', empty);
      if (!on || empty) continue;
      for (const h3 of g.querySelectorAll(':scope > h3')) mark(h3, true);
      if (g.matches('details.more')) g.open = true;
    }
    sec.classList.toggle('miss', on && !any);
    if (on && any) mark(h2, true);
  }
  for (const panel of $$('[data-editor-panel]')) panel.classList.toggle('miss', on && !panel.querySelector('[data-editor-section]:not(.miss)'));
  if (window.Highlight) CSS.highlights.set('find', new Highlight(...marks));
  const msg = !on ? '' : n ? t('{n} settings', { n }) : t('No settings match');
  if ($('#find-status').textContent !== msg) $('#find-status').textContent = msg;
};
finder.addEventListener('input', filter);
finder.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !finder.value) return;
  e.preventDefault();
  finder.value = '';
  filter();
});
addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input:is([type="text"], [type="url"], [type="search"]), textarea, [contenteditable]')) return;
  e.preventDefault();
  finder.focus();
  finder.select();
});

// ---- what's new: once per version, after an update (lib/news.js) ----
GZ_NEWS.check((notes) => {
  GZ_NEWS.seen();
  if (!notes.length) return;
  $('#news-title').textContent = t('New in {version}', { version: notes.map(([v]) => v).join(', ') });
  $('#news-list').replaceChildren(...notes.flatMap(([, lines]) => lines).map((line) => Object.assign(document.createElement('li'), { textContent: t(line) })));
  $('#news').hidden = false;
});
$('#news-close').addEventListener('click', () => { $('#news').hidden = true; finder.focus(); });

GZ_UI.load().then((s) => {
  const frame = $('#preview'), backdrop = $('#backdrop');
  let navItems = GZ_NAV.clean(), navbarEditor = null;
  // A pasted theme code shows in the preview until it is used or cancelled.
  let offer = null;
  let courses = {}; // course id -> { name, slot, org }, from the content script
  const previewItems = () => navItems.links.length ? navItems : GZ_NAV.clean({ ...navItems, links: [{ id: 'previewlinkx', n: t('Research resources and academic support'), u: 'https://example.invalid/research', i: 'book', tab: true }] });
  const supportedPages = { ultra: ['courses', 'outline', 'dashboard', 'tabs', 'stream'], canvas: ['courses', 'outline', 'dashboard', 'tabs', 'document', 'quiz'], moodle: ['courses', 'outline', 'dashboard'] };
  let previewSite = 'ultra', previewPage = 'outline', previewCourse = '', previewCollapsed = false, searchWasOn = false, beforeSearch = false;
  const sizePreview = () => {
    const phone = $('#preview-size').value === 'phone', width = phone ? 375 : 1280, height = phone ? 812 : 900;
    const stage = $('.preview-stage'), available = stage.clientWidth, scale = Math.min(1, available / width);
    Object.assign(frame.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${scale})`, left: `${Math.max(0, (available - width * scale) / 2)}px` });
    stage.style.height = `${Math.ceil(height * scale)}px`;
  };
  // The page's own background: the Look worn, or the one on offer while it is previewed.
  const paintBackdrop = () => backdrop.contentWindow?.postMessage({ gzPreview: offer || s, gzPreviewParts: (offer || s).parts ?? null }, location.origin);
  const preview = () => {
    const belongs = (course) => course && (course.canvas ? 'canvas' : course.moodle ? 'moodle' : 'ultra') === previewSite;
    const base = offer || s, id = belongs(courses[previewCourse]) ? previewCourse : base.courses.tinted.find((id) => belongs(courses[id])), course = courses[id];
    const settings = offer || (previewPage === 'outline' ? GZ_COURSE_LOOK(s, id) : s), mode = $('#nav-preview-mode').value, scheme = $('#nav-preview-scheme').value;
    // The real Ultra painter reads the first tinted course's slot and variables from its mock section.
    const section = frame.contentDocument?.querySelector('section.course');
    if (section) {
      section.className = `course course-color-${course?.slot || 1}`;
      section.style.cssText = course ? Object.entries(GZ_COURSE_VARS(GZ_COURSE_COLORS(courses, settings.courses.colors)[id])).map(([key, value]) => `${key}:${value}`).join(';') : '';
      if (course) section.querySelector('.pv-course').textContent = settings.courses.names[id] || course.name;
    }
    const nav = { ...settings.nav };
    if (mode !== 'current') { nav.collapsed = mode === 'collapsed'; nav.labels = mode === 'icons' ? 'icons' : nav.labels === 'icons' ? 'normal' : nav.labels; }
    const colors = scheme === 'current' ? null : GZ_PRESET(scheme === 'light' ? 'Paper' : 'Frost');
    const shown = previewSite === 'ultra' && course ? { ...settings, courses: { ...settings.courses, tinted: GZ_COURSE_TINTED(settings.courses, id, courses) ? [id] : [] } } : settings;
    frame.contentWindow?.postMessage({ gzPreviewContext: { site: previewSite, page: previewPage, viewport: $('#preview-size').value } }, location.origin);
    const coursePointer = settings !== base && GZ_LOOK_PARTS({ name: base.courses.looks[id] })?.x?.pointer;
    frame.contentWindow?.postMessage({ gzPreview: { ...shown, nav, ...(colors && { colors, auto: { ...settings.auto, on: false } }) }, gzPreviewParts: settings === base ? base.parts ?? null : coursePointer ? { x: { pointer: coursePointer } } : null }, location.origin);
    renderNav(); renderContrast(); frame.contentWindow?.postMessage({ gzNavPreview: previewItems() }, location.origin); sizePreview();
    paintBackdrop();
  };
  const contextPreview = (site, page) => {
    if (!supportedPages[site].includes(page)) page = 'courses';
    const reload = site !== previewSite; previewSite = site; previewPage = page;
    $('#preview-site').value = site; $('#preview-page').value = page;
    for (const option of $('#preview-page').options) option.disabled = !supportedPages[site].includes(option.value);
    $('#nav-preview-control').hidden = site !== 'ultra';
    if (reload) frame.contentWindow.location.replace(chrome.runtime.getURL(`preview.html?site=${site}`));
    frame.title = t('Live preview: {site}, {page}', { site: $('#preview-site').selectedOptions[0].textContent, page: $('#preview-page').selectedOptions[0].textContent });
    preview();
  };
  followSection = (route, part = '') => {
    // part: the box in use inside the section (its id), where its preview differs from the section's.
    let site = previewSite, page = previewPage;
    if (part === 'bb-stream') { site = 'ultra'; page = 'stream'; }
    else if (route === 'pages/dashboard') { site = 'ultra'; page = 'dashboard'; }
    else if (route === 'pages/declutter') { site = 'ultra'; page = 'outline'; }
    else if (route === 'pages/documents') { site = 'canvas'; page = 'document'; }
    else if (route === 'navigation/tabs') { if (site === 'moodle') site = 'ultra'; page = 'tabs'; }
    else if (route === 'courses/list') { site = 'ultra'; page = 'outline'; }
    else if (route === 'pages/content') page = 'outline';
    else if (/\/(cards|palette|background)$/.test(route)) page = 'courses';
    else if (route === 'navigation/sidebar') { if (site === 'moodle') site = 'canvas'; page = 'courses'; }
    else if (route === 'study/widgets' || route === 'study/todo' || route === 'study/grades') { if (site === 'moodle') site = 'ultra'; page = 'dashboard'; }
    contextPreview(site, page);
  };
  $('.editor').addEventListener('focusin', (e) => { const section = e.target.closest('[data-editor-section]'); if (section) followSection(section.dataset.editorSection, e.target.closest('#bb-stream')?.id); });
  for (const el of $$('#preview-site, #preview-page')) el.addEventListener('change', () => contextPreview($('#preview-site').value, $('#preview-page').value));
  for (const el of $$('#nav-preview-mode, #nav-preview-scheme, #preview-size')) el.addEventListener('change', preview);
  const showPreview = () => { $('#preview-body').hidden = previewCollapsed; $('#preview-toggle').setAttribute('aria-expanded', String(!previewCollapsed)); $('#preview-toggle').textContent = t(previewCollapsed ? 'Show preview' : 'Hide preview'); if (!previewCollapsed) sizePreview(); };
  $('#preview-toggle').addEventListener('click', () => { previewCollapsed = !previewCollapsed; showPreview(); });
  searchPreview = (on) => { if (on !== searchWasOn) { if (on) { beforeSearch = previewCollapsed; previewCollapsed = true; } else previewCollapsed = beforeSearch; searchWasOn = on; showPreview(); } };
  frame.addEventListener('load', preview);
  addEventListener('message', (e) => {
    if (e.origin === location.origin && e.source === backdrop.contentWindow && e.data?.gzPreviewReady) paintBackdrop();
    if (e.origin !== location.origin || e.source !== frame.contentWindow) return;
    if (e.data?.gzPreviewReady) preview();
    if (e.data?.gzPreviewFailed) Object.assign($('#preview-note'), { textContent: t('Preview could not load. Try reloading settings.'), hidden: false });
  });
  // Sticky things sit under the header; a section scrolled to sits under the header and, in one column, the categories' row too.
  const geometry = new ResizeObserver(() => {
    const top = $('.top').getBoundingClientRect().height, row = matchMedia('(max-width: 980px)').matches ? $('.editor-nav').getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty('--editor-top', `${top}px`);
    document.documentElement.style.setProperty('--editor-header', `${top + row}px`);
    sizePreview();
  });
  geometry.observe($('.top')); geometry.observe($('.editor-nav')); geometry.observe($('.preview-stage'));

  // ---- saving: keys touched while an input moves go out together once it rests ----
  const pending = new Set(), pendingNav = new Set(), pendingNavbar = new Set();
  let timer = 0, partKeys = [], saving = 0, settingsRead = 0;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending.size) return;
    const navPatch = pendingNav.size ? Object.fromEntries([...pendingNav].map((k) => [k, s.nav[k]])) : undefined;
    const navbarPatch = pendingNavbar.size ? Object.fromEntries([...pendingNavbar].map((k) => [k, s.navbar[k]])) : undefined;
    saving++;
    GZ_UI.save(s, [...pending], (err) => { saving--; if (err || !undoHeld) hint(err || t('Saved'), !!err); if (!err) syncSettings(); }, navPatch, partKeys?.length ? partKeys : undefined, navbarPatch);
    pending.clear(); pendingNav.clear(); pendingNavbar.clear(); partKeys = [];
  };
  const save = (keys, soon = false, parts) => {
    settingsRead++;
    undoHeld = false;
    if (keys.includes('parts')) partKeys = parts && partKeys ? [...new Set([...partKeys, ...parts])] : null;
    for (const k of keys) pending.add(k);
    clearTimeout(timer);
    if (soon) timer = setTimeout(flush, 500);
    else flush();
  };
  addEventListener('pagehide', flush);

  const get = (path) => path.startsWith('nav.') && Object.hasOwn(GZ_NAV.dimensions(s.nav), path.slice(4)) ? GZ_NAV.dimensions(s.nav)[path.slice(4)] : path.split('.').reduce((o, k) => o[k], s);
  const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], s)[last] = v; if (ks[0] === 'nav') pendingNav.add(last); if (ks[0] === 'navbar') pendingNavbar.add(last); };
  const group = (path) => path.split('.')[0];

  // Relay preference and explicit health action; sessions themselves are lib/sessions-ui.js's.
  const defaultRelay = 'https://share.frostdev.io';
  let relayBusy = false, relayKept = defaultRelay;
  const relayStatus = (text, error = false) => { $('#relay-status').textContent = text; $('#relay-status').classList.toggle('error', error); };
  const relayValue = () => $('#relay-kind').value === 'default' ? defaultRelay : GZ_RELAY.normalize($('#relay-url').value);
  const relaySend = async (op, server) => {
    const result = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op, server });
    if (!result?.ok) throw new Error('relay'); return result;
  };
  const relayAction = async (test) => {
    if (relayBusy) return;
    const server = relayValue();
    if (!server) return relayStatus(t('Enter an HTTPS origin, or HTTP localhost or 127.0.0.1, without a path, query, fragment or credentials.'), true);
    relayBusy = true; $('#relay-save').disabled = $('#relay-test').disabled = true;
    try {
      if (!test) {
        await relaySend('relaySave', server);
        relayKept = server; showResets();
        if ($('#relay-kind').value === 'custom') $('#relay-url').value = server;
        relayStatus(t('Relay saved for new sessions. Existing sessions keep their own server.')); return;
      }
      const origins = [server + '/*'];
      if (!await chrome.permissions.contains({ origins }) && !await chrome.permissions.request({ origins })) return relayStatus(t('Host permission was not granted. No connection was made.'), true);
      relayStatus(t('Testing {server}…', { server }));
      const result = await relaySend('relayTest', server);
      const messages = { connected: 'Connected to {server}.', timeout: 'Connection to {server} timed out.', http: 'The relay returned HTTP {status}.', invalid: 'The server did not return a valid Glaze health response.', cancelled: 'Connection test cancelled.', network: 'Could not connect. Check the URL, TLS and relay availability; redirects are refused.' };
      relayStatus(t(messages[result.result], { server, status: result.status }), result.result !== 'connected');
    } catch { relayStatus(t('Could not finish. Your local copies are kept. Try again.'), true); }
    finally { relayBusy = false; $('#relay-save').disabled = $('#relay-test').disabled = false; }
  };
  const relayHuman = (e) => e.isTrusted && (navigator.userActivation?.isActive ?? true);
  const resetRelay = () => { if (relayBusy) return; $('#relay-kind').value = 'default'; $('#relay-custom').hidden = true; $('#relay-url').value = ''; return relayAction(false); };
  $('#relay-kind').addEventListener('change', () => { $('#relay-custom').hidden = $('#relay-kind').value !== 'custom'; relayStatus(''); });
  $('#relay-url').addEventListener('input', () => relayStatus(''));
  $('#relay-save').addEventListener('click', (e) => { if (relayHuman(e)) relayAction(false); });
  $('#relay-test').addEventListener('click', (e) => { if (relayHuman(e)) relayAction(true); });
  chrome.storage.sync.get('shareRelay').then((r) => {
    const server = GZ_RELAY.normalize(r.shareRelay) || defaultRelay;
    relayKept = server; showResets();
    $('#relay-kind').value = server === defaultRelay ? 'default' : 'custom'; $('#relay-url').value = server === defaultRelay ? '' : server; $('#relay-custom').hidden = server === defaultRelay;
  }).catch(() => {});

  // ---- palette ----
  const colorInputs = {};
  for (const [v, label] of GZ_COLORS) {
    const row = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'color', title: v });
    input.addEventListener('input', () => {
      s.colors[v] = input.value;
      s.preset = GZ_MATCH_PRESET(s.colors, s.presets);
      s.auto.on = false;
      refresh();
      save(['colors', 'preset', 'auto'], true);
    });
    input.addEventListener('change', () => save(['colors', 'preset', 'auto']));
    colorInputs[v] = input;
    row.append(input, t(label));
    $('#colors').append(row);
  }

  const presetOptions = () => {
    for (const sel of [$('#auto-light'), $('#auto-dark')]) {
      sel.replaceChildren(...GZ_ALL_PRESETS(s.presets).map(([n]) => new Option(n, n)));
      sel.value = get(sel.dataset.key);
    }
  };

  const renderMine = () => {
    $('#mine').replaceChildren(...s.presets.map((p) => {
      const li = document.createElement('li');
      const dot = document.createElement('span');
      dot.className = 'swatch';
      dot.style.cssText = `background:${p.colors['--gz-surface']};border-color:${p.colors['--gz-line-strong']};--dot:${p.colors['--gz-accent']};cursor:default`;
      const name = Object.assign(document.createElement('input'), { type: 'text', value: p.name, maxLength: 40 });
      name.setAttribute('aria-label', t('Rename {name}', { name: p.name }));
      name.addEventListener('change', () => {
        const next = name.value.trim();
        if (next === p.name) return;
        if (!next || GZ_PRESET(next, s.presets)) { name.value = p.name; return hint(next ? t("There's already a palette called {name}.", { name: next }) : t('A palette needs a name.'), true); }
        for (const k of ['light', 'dark']) if (s.auto[k] === p.name) s.auto[k] = next;
        if (s.preset === p.name) s.preset = next;
        p.name = next;
        refresh();
        save(['presets', 'preset', 'auto']);
      });
      const del = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Delete'), className: 'danger' });
      del.addEventListener('click', () => {
        s.presets = s.presets.filter((q) => q !== p);
        if (s.preset === p.name) s.preset = null;
        if (s.auto.light === p.name) s.auto.light = 'Paper';
        if (s.auto.dark === p.name) s.auto.dark = 'Frost';
        refresh();
        save(['presets', 'preset', 'auto']);
      });
      li.append(dot, name, del);
      return li;
    }));
  };

  // The checks for the palette the pages are drawn with: the Look on offer while one is previewed, else the one worn (an auto
  // palette, by the system's mode), under its surface color and tint and with its page tweaks' colors (ui.js contrast). Drawn
  // with the preview, which also redraws when an offer comes or goes, and only when a check changed, so a search's marks on the
  // list stay. A Look on offer that fails a check says so in its offer.
  const renderContrast = (() => {
    let drawn = '';
    return () => {
      const v = offer || s, dark = matchMedia('(prefers-color-scheme: dark)').matches;
      const courseColors = v.look.surfaceTint && v.look.surfaceTintSource === 'course' ? [...new Set([...Object.values(GZ_COURSE_COLORS(courses, v.courses.colors)).map((c) => c.color), ...Object.values(courses).map((c) => c?.color)])].filter(Boolean) : [];
      const rows = GZ_UI.contrast(v, dark, courseColors, v.parts?.x?.rules);
      const sig = JSON.stringify([!!offer, rows.map((r) => [r.label, r.part, r.ratio])]);
      if (sig === drawn) return;
      drawn = sig;
      const site = { ultra: 'Blackboard', canvas: 'Canvas', moodle: 'Moodle' };
      const said = (r) => t(r.label, r.part && { part: `${site[r.part.split('.')[0]]} · ${t(GZ_PARTS.get(r.part)?.label ?? r.part)}` });
      $('#contrast').replaceChildren(...rows.map((r) => {
        const li = document.createElement('li');
        li.className = r.pass ? 'pass' : 'fail';
        li.title = t('Needs {min}:1', { min: r.min });
        const b = document.createElement('b');
        b.textContent = `${GZ_I18N.num(+r.ratio.toFixed(1), GZ_I18N.ui())}:1`;
        li.append(said(r), b);
        return li;
      }));
      const failing = offer ? rows.filter((r) => !r.pass) : [];
      const warn = $('#share-contrast');
      warn.hidden = !failing.length;
      warn.textContent = failing.length ? t('Text in this Look may be hard to read: {pairs}.', { pairs: new Intl.ListFormat(GZ_I18N.locale(GZ_I18N.ui())).format(failing.map((r) => `${said(r)} (${GZ_I18N.num(Math.floor(r.ratio * 10) / 10, GZ_I18N.ui())}:1)`)) }) : '';
    };
  })();

  // Reset buttons show only while what they reset differs from the defaults (set up with the resets, below).
  let showResets = () => {};
  // ---- everything that follows the state, cheap enough to redo on every edit ----
  const outputs = () => {
    for (const o of $$('output[data-for]')) o.textContent = (FORMAT[o.dataset.format] || ((v) => GZ_I18N.num(v, GZ_I18N.ui())))(get(o.dataset.for));
  };
  const refresh = () => {
    GZ_UI.paint(s, { page: true });
    preview();
    // A whole Look brings its own extras: the Look being left is in History first, and Undo wears it again.
    GZ_UI.looks($('#looks'), s, (L) => {
      const undo = leaving();
      save(GZ_UI.pickLook(s, L));
      fill();
      if (undo) hint(t('{name} replaced this Look’s extras.', { name: L.name }), false, undo);
    });
    GZ_UI.swatches($('#presets'), s, (name, colors) => { save(GZ_UI.pickPreset(s, name, colors)); fill(); });
    renderMine();
    renderHistory();
    renderExtras();
    renderBg();
    GZ_EDITOR_X.render();
    renderNav();
    navbarEditor?.render();
    presetOptions();
    GZ_XEDIT.render();
    outputs();
    for (const el of $$('#ultra-nav-editor input[type="range"][data-key]')) el.value = get(el.dataset.key);
    $('[data-key="auto.on"]').checked = s.auto.on;
    $('[data-key="stream.relative"]').disabled = s.stream.dates === 'posted';
    $('[data-key="nav.detailed"]').checked = s.nav.detailed;
    $('#auto-times').hidden = s.auto.mode !== 'schedule';
    for (const el of $$('[data-tint]')) el.hidden = !s.courses.tint;
    // A control only where it has an effect (lib/editor.js SHOW); a More options with nothing left to show goes too.
    for (const el of $$('[data-show]')) el.hidden = !GZ_EDITOR.SHOW[el.dataset.show](s);
    for (const d of $$('details.more')) d.hidden = ![...d.children].some((el) => el.tagName !== 'SUMMARY' && !el.hidden);
    showResets();
    document.body.classList.toggle('off', !s.enabled);
    // Redrawn lists and shown/hidden controls: match again.
    if (finder.value) filter();
  };
  // Puts every control back in line with the state (load, import, reset, preset pick).
  const fill = () => {
    $('#enabled').checked = s.enabled;
    for (const [v] of GZ_COLORS) colorInputs[v].value = s.colors[v];
    presetOptions();
    for (const el of $$('[data-key]')) {
      const v = get(el.dataset.key);
      if (el.type === 'checkbox') el.checked = v;
      else el.value = v;
    }
    for (const r of $$('.seg input[type="radio"]:not([data-local])')) r.checked = String(r.name === 'card.pet' && get(r.name) !== 'none' ? 'selected' : get(r.name)) === r.value;
    $('#bg-image').value = s.bg.image;
    for (const [slug, box] of tabBoxes) box.checked = s.declutter.tabs.includes(slug);
    for (const [slug, box] of sidebarBoxes) box.checked = !s.sidebar.off.includes(slug);
    renderFonts();
    renderCourses();
    renderNavItems();
    refresh();
  };

  // ---- fonts: one list for three slots (text, headings, code), each card drawn in its own face ----
  let slot = 'font';
  const AUTO = { head: 'Same as text', mono: 'As the site has it' };
  // A few built-in names are words ("Serif", "System"); the rest are the fonts' own names.
  const fontName = (f) => t(f.name);
  const fontLabel = (sl) => (s.look[sl] === 'auto' ? t(AUTO[sl]) : (GZ_FONTS.resolve(s.look[sl]) && fontName(GZ_FONTS.resolve(s.look[sl]))) || s.look[sl]);
  const META = { system: 'This computer', blackboard: 'Open Sans', inter: 'Bundled', atkinson: 'Bundled', serif: 'This computer', mono: 'This computer' };
  const meta = (f) => (META[f.id] ? t(META[f.id]) : f.files ? `jsDelivr${f.size ? ` · ${f.size}` : ''}` : f.local ? t('Google Fonts or this computer') : 'Google Fonts');
  // The card's own face: a preview family where there is one (Google's text= subset, loaded when the
  // list opens), else the stack content.js would use.
  const face = (f) => (f.google || f.preview ? `"${f.preview || f.google}", ${f.fb}` : GZ_FONTS.stack(f.id));
  const card = (value, name, sub, family) => {
    const label = Object.assign(document.createElement('label'), { className: 'font-card' });
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'font-pick', value, checked: s.look[slot] === value });
    // Arrow keys walk the list: only the font it rests on is applied (and downloaded), and the list
    // isn't redrawn under the focus.
    input.addEventListener('change', () => {
      s.look[slot] = value;
      fontLabels();
      clearTimeout(pickTimer);
      pickTimer = setTimeout(() => { refresh(); save(['look']); }, 350);
    });
    const n = Object.assign(document.createElement('span'), { className: 'face', textContent: name });
    n.style.fontFamily = family;
    label.append(input, n, Object.assign(document.createElement('span'), { className: 'meta', textContent: sub }));
    return label;
  };
  let pickTimer = 0;
  const fontLabels = () => { for (const sl of ['font', 'head', 'mono']) $(`#font-now-${sl}`).textContent = fontLabel(sl); };
  const renderFonts = () => {
    fontLabels();
    const groups = new Map();
    if (slot !== 'font') groups.set('', [card('auto', t(AUTO[slot]), t(slot === 'head' ? 'Follows the text font' : "The site's monospace"), 'inherit')]);
    const own = GZ_FONTS.custom(s.look[slot]) ? [GZ_FONTS.resolve(s.look[slot])] : [];
    for (const f of [...GZ_FONTS.LIST, ...own]) {
      if (!groups.has(f.group)) groups.set(f.group, []);
      groups.get(f.group).push(card(f.id, fontName(f), meta(f), face(f)));
    }
    $('#font-grid').replaceChildren(...[...groups].flatMap(([g, cards]) => {
      const box = Object.assign(document.createElement('div'), { className: 'cards', role: 'radiogroup' });
      box.setAttribute('aria-label', t(g || 'Automatic'));
      box.append(...cards);
      return g ? [Object.assign(document.createElement('h3'), { textContent: t(g) }), box] : [box];
    }));
    findFont();
  };
  // Typing a name searches the list (no request); Use takes a name the list doesn't have.
  const findFont = () => {
    const q = $('#font-custom').value.trim().toLowerCase();
    let n = 0;
    for (const box of $$('#font-grid .cards')) {
      let any = false;
      for (const c of box.children) {
        const hit = !q || c.querySelector('.face').textContent.toLowerCase().includes(q);
        c.classList.toggle('miss', !hit);
        if (hit) { any = true; n++; }
      }
      box.classList.toggle('miss', !any);
      if (box.previousElementSibling?.tagName === 'H3') box.previousElementSibling.classList.toggle('miss', !any);
    }
    $('#font-found').textContent = !q ? '' : n ? t('{n} fonts', { n }) : t('None in the list. Use tries Google Fonts, then this computer.');
  };
  $('#font-custom').addEventListener('input', findFont);
  // Previews: every Google family's name, and only those letters, in one small request.
  const previewLink = (names) => {
    const text = [...new Set([...GZ_FONTS.LIST.map((f) => f.name).join(''), ...names.join(''), ...'Aa'])].join('');
    const fams = names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}`).join('&');
    document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${fams}&text=${encodeURIComponent(text)}&display=swap` }));
  };
  $('#font-browse').addEventListener('toggle', (e) => {
    if (!e.target.open || e.target.dataset.loaded) return;
    e.target.dataset.loaded = '1';
    previewLink(GZ_FONTS.LIST.filter((f) => f.google || f.preview).map((f) => f.preview || f.google));
    // The small file-only faces load whole (OpenDyslexic, from jsDelivr: PRIVACY.md says so); the Nerd Fonts preview
    // through their base family.
    for (const f of GZ_FONTS.LIST) if (f.files && !f.size) GZ_FONTS.load(f.id);
  });
  for (const r of $$('input[name="font-slot"]')) r.addEventListener('change', () => { slot = r.value; renderFonts(); });
  $('#font-use').addEventListener('click', async () => {
    const name = $('#font-custom').value.trim().replace(/\s+/g, ' ');
    if (!GZ_FONTS.custom(name) && !GZ_FONTS.resolve(name)) return hint(t('Font names are letters, digits and spaces.'), true);
    const known = GZ_FONTS.LIST.find((f) => f.name.toLowerCase() === name.toLowerCase());
    const value = known ? known.id : name;
    s.look[slot] = value;
    $('#font-custom').value = '';
    renderFonts();
    refresh();
    save(['look']);
    if (known) return;
    const found = await fetch(GZ_FONTS.cssUrl(name, false), { credentials: 'omit', referrerPolicy: 'no-referrer' }).then((r) => r.ok, () => false);
    if (found) previewLink([name]);
    else hint(t("{name} isn't on Google Fonts. It shows if it's installed on this computer.", { name }));
  });
  $('#font-custom').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#font-use').click(); });

  // ---- background colors: a ready-made set or three pickers. None stored means the palette's, so
  // they follow palette changes until one is picked. ----
  const activeColors = (v = s) => GZ_ACTIVE_COLORS(v, matchMedia('(prefers-color-scheme: dark)').matches);
  const bgPickers = [1, 2, 3].map((n) => {
    const input = Object.assign(document.createElement('input'), { type: 'color' });
    input.setAttribute('aria-label', t('Background color {n}', { n }));
    input.addEventListener('input', () => {
      if (!s.bg.colors.length) s.bg.colors = [...GZ_BG_COLORS([], activeColors())];
      s.bg.colors[n - 1] = input.value;
      refresh();
      save(['bg'], true);
    });
    input.addEventListener('change', () => save(['bg']));
    $('#bg-colors').append(input);
    return input;
  });
  const renderBg = () => {
    const shows = (el) => el.dataset.kinds.split(' ').includes(s.bg.kind) && (!el.dataset.styles || el.dataset.styles.split(' ').includes(s.bg.style));
    for (const el of $$('#background [data-kinds]')) el.hidden = !shows(el);
    $('#bg-sets').replaceChildren(...[['Palette', []], ...GZ_BG_SETS].map(([name, set]) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'swatch bg-set', title: name === 'Palette' ? t(name) : name });
      b.setAttribute('aria-label', name === 'Palette' ? t('Palette colors') : name);
      b.setAttribute('aria-pressed', String(set.join() === s.bg.colors.join()));
      b.style.background = `linear-gradient(135deg, ${GZ_BG_COLORS(set, activeColors()).join(', ')})`;
      b.addEventListener('click', () => { s.bg.colors = [...set]; refresh(); save(['bg']); });
      return b;
    }));
    GZ_BG_COLORS(s.bg.colors, activeColors()).forEach((c, i) => { bgPickers[i].value = c; });
  };

  // Ultra's item settings use a separate capped sync item; appearance still uses the shared nav patch queue.
  const N = GZ_NAV;
  const nativeNames = { profile: 'Profile', 'institution-page': 'Dashboard', stream: 'Activity', course: 'Courses', organization: 'Organizations', calendar: 'Calendar', messages: 'Messages', grades: 'Grades', tools: 'Tools', logout: 'Sign out', glaze: 'Glaze settings' };
  const widgetNames = { clock: 'Clock and date', next: 'Next due', timer: 'Focus timer', pet: 'Pet habitat' };
  const iconNames = ['Link', 'Book', 'Video', 'Chat', 'Document', 'Calendar', 'Folder', 'Code', 'Star', 'Globe'];
  const node = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids); return el; };
  const navButton = (text, run, label = text) => { const b = node('button', { type: 'button', textContent: t(text) }); b.setAttribute('aria-label', t(label)); b.addEventListener('click', run); return b; };
  let editingLink = '', navLogoPick = 0, navDrag = null;
  const showLinkIcon = () => $('#nav-link-icon-preview path').setAttribute('d', GZ_CARDS.ICONS[$('#nav-link-icon').value] || GZ_CARDS.ICONS.link);
  const showNavPreview = () => frame.contentWindow?.postMessage({ gzNavPreview: previewItems() }, location.origin);
  const writeNavItems = async (next) => {
    next = N.clean(next);
    const r = await new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:nav', nav: {}, items: next }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
    if (!r?.ok) { hint(t('Not saved. Try again in a moment.'), true); return false; }
    navItems = N.clean(r.items); renderNavItems(); showNavPreview(); hint(t('Saved'));
    return true;
  };
  const move = (list, at, by) => { const out = [...list]; const [x] = out.splice(at, 1); out.splice(at + by, 0, x); return out; };
  const reorderHandle = (li, ids, at, name, write, list) => {
    const handle = node('button', { type: 'button', textContent: '↕', draggable: true });
    handle.setAttribute('aria-label', t('Reorder {name}', { name })); handle.setAttribute('aria-describedby', 'nav-reorder-note');
    handle.addEventListener('keydown', (e) => {
      const by = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      if (!by) return;
      e.preventDefault();
      if (at + by >= 0 && at + by < ids.length) write(move(ids, at, by));
    });
    handle.addEventListener('dragstart', (e) => { navDrag = { list, id: ids[at] }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(at)); });
    handle.addEventListener('dragend', () => { navDrag = null; for (const row of $$('.nav-editor-list [data-drop]')) delete row.dataset.drop; });
    li.addEventListener('dragover', (e) => { if (navDrag?.list === list && navDrag.id !== ids[at]) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; li.dataset.drop = ''; } });
    li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) delete li.dataset.drop; });
    li.addEventListener('drop', (e) => {
      if (navDrag?.list !== list) return;
      e.preventDefault(); delete li.dataset.drop;
      const from = ids.indexOf(navDrag.id); navDrag = null;
      if (from >= 0 && from !== at) write(move(ids, from, at - from));
    });
    li.prepend(handle);
  };
  const renderNavItems = () => {
    const focused = document.activeElement, focusRow = focused?.closest('#nav-items li, #nav-widgets li'), focusAt = focusRow ? [...focusRow.querySelectorAll('button, input, select')].indexOf(focused) : -1, focusId = focusRow?.dataset.id;
    const order = N.sequence(N.NATIVE, navItems);
    $('#nav-items').replaceChildren(...order.map((id, at) => {
      const link = navItems.links.find((l) => l.id === id), name = link ? link.n : t(id === 'institution-page' && !s.enhance.dashboard ? 'Institution page' : nativeNames[id]);
      const li = node('li', { }, node('span', { textContent: name })); li.dataset.id = id;
      reorderHandle(li, order, at, name, (order) => writeNavItems({ ...navItems, order }), 'items');
      const up = navButton('Move up', () => { if (at > 0) writeNavItems({ ...navItems, order: move(order, at, -1) }); }); up.setAttribute('aria-disabled', String(at === 0));
      const down = navButton('Move down', () => { if (at < order.length - 1) writeNavItems({ ...navItems, order: move(order, at, 1) }); }); down.setAttribute('aria-disabled', String(at === order.length - 1));
      up.setAttribute('aria-label', `${t('Move up')} · ${name}`); down.setAttribute('aria-label', `${t('Move down')} · ${name}`);
      li.append(up, down);
      if (link) {
        li.append(navButton('Edit', () => { editingLink = id; $('#nav-link-name').value = link.n; $('#nav-link-url').value = link.u; $('#nav-link-icon').value = link.i; showLinkIcon(); $('#nav-link-tab').checked = link.tab; $('#nav-link-save').textContent = t('Save link'); $('#nav-link-name').focus(); }), navButton('Remove link', () => writeNavItems({ ...navItems, links: navItems.links.filter((l) => l.id !== id), order: navItems.order.filter((k) => k !== id) })));
      } else {
        const hidden = navItems.hidden.includes(id);
        const b = navButton(hidden ? 'Show' : 'Hide', () => writeNavItems({ ...navItems, hidden: hidden ? navItems.hidden.filter((k) => k !== id) : [...navItems.hidden, id] }));
        b.setAttribute('aria-pressed', String(hidden)); b.setAttribute('aria-label', `${t(hidden ? 'Show' : 'Hide')} · ${name}`); li.append(b);
      }
      return li;
    }));
    $('#nav-widgets').replaceChildren(...navItems.widgets.map((w, at) => {
      const input = node('input', { type: 'checkbox', checked: w.on });
      input.addEventListener('change', () => writeNavItems({ ...navItems, widgets: navItems.widgets.map((x) => x.id === w.id ? { ...x, on: input.checked } : x) }));
      const position = node('select'); position.setAttribute('aria-label', t(widgetNames[w.id]));
      position.append(new Option(t('Top'), 'top'), new Option(t('Bottom'), 'bottom')); position.value = w.at;
      position.addEventListener('change', () => writeNavItems({ ...navItems, widgets: navItems.widgets.map((x) => x.id === w.id ? { ...x, at: position.value } : x) }));
      const up = navButton('Move up', () => { if (at > 0) writeNavItems({ ...navItems, widgets: move(navItems.widgets, at, -1) }); }); up.setAttribute('aria-disabled', String(at === 0));
      const down = navButton('Move down', () => { if (at < navItems.widgets.length - 1) writeNavItems({ ...navItems, widgets: move(navItems.widgets, at, 1) }); }); down.setAttribute('aria-disabled', String(at === navItems.widgets.length - 1));
      const row = node('li', {}, node('label', {}, input, t(widgetNames[w.id])), position, up, down); row.dataset.id = `widget-${w.id}`; reorderHandle(row, navItems.widgets.map((x) => x.id), at, t(widgetNames[w.id]), (ids) => writeNavItems({ ...navItems, widgets: ids.map((id) => navItems.widgets.find((x) => x.id === id)) }), 'widgets'); return row;
    }));
    if (focusId) { const row = document.querySelector(`.nav-editor-list [data-id="${focusId}"]`); const controls = row?.querySelectorAll('button, input, select'); (controls?.[focusAt]?.disabled ? row.querySelector('button:not([disabled]), input, select') : controls?.[focusAt])?.focus(); }
    showResets();
  };
  const cancelLink = () => { editingLink = ''; $('#nav-link-name').value = ''; $('#nav-link-url').value = ''; $('#nav-link-icon').value = 'link'; showLinkIcon(); $('#nav-link-tab').checked = false; $('#nav-link-save').textContent = t('Add link'); };
  N.ICONS.forEach((id, at) => $('#nav-link-icon').append(new Option(t(iconNames[at]), id)));
  $('#nav-link-icon').addEventListener('change', showLinkIcon);
  showLinkIcon();
  $('#nav-link-save').addEventListener('click', async () => {
    const id = editingLink || Array.from(crypto.getRandomValues(new Uint8Array(12)), (v) => 'abcdefghijklmnopqrstuvwxyz0123456789'[v % 36]).join('');
    const l = N.link({ id, n: $('#nav-link-name').value, u: $('#nav-link-url').value.trim(), i: $('#nav-link-icon').value, tab: $('#nav-link-tab').checked });
    if (!l) return hint(t('Use an http:// or https:// link and a name.'), true);
    if (!editingLink && navItems.links.length >= 8) return hint(t('You can keep up to 8 navigation links.'), true);
    if (await writeNavItems({ ...navItems, links: editingLink ? navItems.links.map((x) => x.id === id ? l : x) : [...navItems.links, l] })) { cancelLink(); $('#nav-link-name').focus(); }
  });
  $('#nav-link-cancel').addEventListener('click', () => { cancelLink(); $('#nav-link-name').focus(); });
  $('#nav-link-editor').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancelLink(); $('#nav-link-name').focus(); } });
  // A logo picture, for the site's own navigation and Glaze navigation alike: one picture on this device (nav.li), stored by the
  // worker, picked where the navigation in use has Your logo chosen.
  const pickLogo = async (e) => {
    const file = e.target.files[0], rev = ++navLogoPick; e.target.value = ''; if (!file) return;
    let logoImage;
    try { logoImage = await GZ_CARDS.picture(file); } catch { return hint(t("That file isn't a picture Glaze can read."), true); }
    if (rev !== navLogoPick) return;
    const r = await new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:nav', nav: {}, logoImage }, (x) => res(chrome.runtime.lastError ? null : x)));
    if (rev !== navLogoPick) return;
    if (!r?.ok) return hint(t(r?.error === 'cap' ? "That picture is too big to keep. Try a smaller one, or remove another card's picture." : 'Not saved. Try again in a moment.'), true);
    Object.assign(s.nav, r.nav); fill(); hint(t('Saved'));
  };
  $('#nav-logo-pick').addEventListener('click', () => $('#nav-logo-file').click());
  $('#nav-logo-file').addEventListener('change', (e) => pickLogo(e));
  const NAV_RESETS = {
    dimensions: ['size', 'width', 'icon', 'height', 'gap', 'padding', 'expandOnHover'],
    labels: ['labels', 'text', 'labelOverflow'],
    appearance: ['itemStyle', 'itemBackground', 'activeIndicator'],
    branding: ['brand', 'logo', 'logoSize', 'logoAlign', 'footer'],
  };
  for (const button of $$('[data-nav-reset]')) button.addEventListener('click', async () => {
    const section = button.dataset.navReset;
    if (section === 'layout') return writeNavItems({ ...navItems, order: [], hidden: [] });
    if (section === 'widgets') return writeNavItems({ ...navItems, widgets: N.clean().widgets });
    const keys = NAV_RESETS[section];
    if (!keys) return;
    if (section === 'dimensions' || section === 'labels') {
      Object.assign(s.nav, N.dimensions(s.nav), { detailed: true });
      for (const k of [...Object.keys(N.dimensions(s.nav)), 'detailed']) pendingNav.add(k);
    }
    if (section === 'branding') navLogoPick++;
    for (const k of keys) { s.nav[k] = GZ_DEFAULTS.nav[k]; pendingNav.add(k); }
    fill(); save(['nav']);
  });
  $('#nav-reset').addEventListener('click', async () => {
    navLogoPick++; cancelLink(); if (!await writeNavItems(N.clean())) return;
    for (const k of Object.keys(N.SPEC).filter((k) => k !== 'li')) { s.nav[k] = GZ_DEFAULTS.nav[k]; pendingNav.add(k); }
    for (const k of ['labels', 'size', 'collapsed', 'logo']) { s.nav[k] = GZ_DEFAULTS.nav[k]; pendingNav.add(k); }
    fill(); save(['nav']);
  });
  chrome.storage.sync.get('navItems', (r) => { navItems = N.clean(r?.navItems); renderNavItems(); showNavPreview(); });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'sync' && changes.navItems) { navItems = N.clean(changes.navItems.newValue); renderNavItems(); showNavPreview(); } });
  // A Look's own nav layout and page tweaks (lib/editor-xparts.js): they edit s.parts and save it with the Look.
  GZ_XEDIT.mount({ s, t, save, refresh, frame, navItems: () => navItems, preview: (site) => contextPreview(site, site === previewSite ? previewPage : 'courses') });

  let navPick = 0, navReview = 0, navRendered = '', navImage = null;
  const navAverages = new Map();
  const renderNav = () => {
    // Placement can change without changing the cached navigation paint.
    $('#tabs [data-tabs-nav-note]').hidden = s.tabs.at !== 'nav' || (s.navbar.on && s.navbar.tabs);
    const n = { ...(offer || s).nav };
    const signature = JSON.stringify([n, n.k === 'default' ? activeColors(offer || s) : null, s.navbar]);
    if (signature === navRendered) return;
    navRendered = signature;
    const rev = ++navReview;
    const pv = $('#nav-preview');
    const paint = (src = '') => {
      if (rev !== navReview) return;
      const p = GZ_CARDS.paint(n, src, 'nav');
      pv.dataset.kind = p?.kind || 'default';
      pv.style.cssText = Object.entries({ ...p?.vars, '--gz-nav-c': n.k === 'default' ? activeColors(offer || s)['--gz-surface-2'] : n.c, '--gz-nav-ink': n.k === 'default' ? activeColors(offer || s)['--gz-ink'] : n.ink }).map(([k, v]) => `${k}:${v}`).join(';');
    };
    paint(n.u);
    for (const el of $$('#sidebar [data-nav-kinds]')) el.hidden = !el.dataset.navKinds.split(' ').includes(n.k);
    // Glaze navigation's rail controls while it is a rail somewhere.
    $('#navbar [data-navbar-rail]').hidden = s.navbar.place !== 'rail' && s.navbar.course !== 'icons';
    // The sidebar's controls while it is on; blur and opacity only for glass.
    $('#side-panel [data-sidebar]').hidden = !s.enhance.sidebar;
    $('#side-panel [data-sidebar-glass]').hidden = s.sidebar.surface !== 'glass';
    $('#nav-url').value = n.u;
    $('#nav-picture-note').textContent = n.i ? t('Picture kept on this device') : '';
    $('#nav-logo-note').textContent = n.li ? t('Logo kept on this device') : '';
    $('#nav-logo-pick').textContent = t(n.li ? 'Change logo' : 'Choose a logo');
    const note = $('#nav-contrast');
    note.classList.remove('err');
    if (n.k === 'default') { if (note.textContent) note.textContent = ''; return; }
    const show = (avg) => {
      if (rev !== navReview) return;
      const ratio = GZ_CARDS.contrast(n, { avg, ink: n.ink });
      note.classList.toggle('err', ratio !== null && ratio < 4.5);
      let text = ratio === null ? t('Image contrast cannot be measured. Check that every label is readable.')
        : t(ratio < 4.5 ? 'Low site navigation contrast: {ratio}:1. Choose different text or background colors.' : 'Site navigation contrast: {ratio}:1. Text should reach 4.5:1; icons 3:1.', { ratio: GZ_I18N.num(+ratio.toFixed(2), GZ_I18N.ui()) });
      if (n.k === 'image' && ratio !== null) text += ' ' + t('Image contrast uses an average; check the whole picture.');
      if (note.textContent !== text) note.textContent = text;
    };
    if (n.k !== 'image') return show(null);
    show(null);
    const key = `${n.i || n.u}|${n.f}`;
    if (n.i && navImage?.id !== n.i) navImage = { id: n.i, src: new Promise((res) => chrome.storage.local.get(`cardImg:${n.i}`, (r) => res(r?.[`cardImg:${n.i}`]))) };
    const src = n.i ? navImage.src : Promise.resolve(n.u);
    src.then((u) => { if (u) paint(u); });
    if (!navAverages.has(key)) {
      if (navAverages.size >= 8) navAverages.delete(navAverages.keys().next().value);
      navAverages.set(key, src.then((u) => u ? GZ_CARDS.average(u, n.f) : null));
    }
    navAverages.get(key).then(show, () => show(null));
  };
  $('#nav-pick').addEventListener('click', () => $('#nav-file').click());
  $('#nav-file').addEventListener('change', async (e) => {
    const file = e.target.files[0], rev = ++navPick;
    e.target.value = '';
    if (!file) return;
    let image;
    try { image = await GZ_CARDS.picture(file); }
    catch (err) { if (rev === navPick) hint(t(err.message === 'cap' ? "That picture is too big to keep. Try a smaller one, or remove another card's picture." : "That file isn't a picture Glaze can read."), true); return; }
    if (rev !== navPick) return;
    const r = await new Promise((res) => {
      try { chrome.runtime.sendMessage({ type: 'glaze:nav', nav: { k: 'image', u: '', i: '' }, image }, (x) => res(chrome.runtime.lastError ? null : x)); }
      catch { res(null); }
    });
    if (rev !== navPick) return;
    if (!r?.ok) return hint(t(r?.error === 'cap' ? "That picture is too big to keep. Try a smaller one, or remove another card's picture." : 'Not saved. Try again in a moment.'), true);
    Object.assign(s.nav, { k: 'image', u: '', i: r.id });
    fill();
    hint(t('Saved'));
  });
  $('#nav-url').addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    let u;
    try { u = raw && new URL(raw); } catch { /* invalid */ }
    if (raw && u?.protocol !== 'https:') return hint(t('Use an https:// link to an image.'), true);
    navPick++;
    Object.assign(s.nav, { u: u ? u.href : '', i: '', k: 'image' });
    for (const k of ['u', 'i', 'k']) pendingNav.add(k);
    fill(); save(['nav']);
  });

  // ---- the sidebar's pages: the kinds it stays off on (sidebar.off), a box ticked for each it shows on ----
  const sidebarBoxes = GZ_SIDEBAR_KINDS.map(([slug, label]) => {
    const row = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
    box.addEventListener('change', () => {
      s.sidebar.off = box.checked ? s.sidebar.off.filter((k) => k !== slug) : [...s.sidebar.off, slug];
      refresh();
      save(['sidebar']);
    });
    row.append(box, t(label));
    $('#sidebar-off').append(row);
    return [slug, box];
  });

  // ---- declutter tabs: a list of slugs, so one checkbox each ----
  const tabBoxes = GZ_TABS.map(([slug, label]) => {
    const row = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
    box.addEventListener('change', () => {
      s.declutter.tabs = box.checked ? [...s.declutter.tabs, slug] : s.declutter.tabs.filter((t) => t !== slug);
      refresh();
      save(['declutter']);
    });
    row.append(box, t(label));
    $('#declutter-tabs').append(row);
    return [slug, box];
  });

  // ---- generic controls: data-key is the settings path; radios use it as their name ----
  // "Use a custom surface color" paints every surface and the ground that one color. Its own default is Frost's navy whatever the
  // palette is, so a first tick starts from the surface being worn instead, and changes nothing until a color is picked. A color
  // the student chose before stays.
  const seedSurface = () => {
    if (s.look.surfaceColor !== GZ_SPEC.look.surfaceColor[0]) return;
    s.look.surfaceColor = activeColors()['--gz-surface'];
    for (const input of $$('[data-key="look.surfaceColor"]')) input.value = s.look.surfaceColor;
  };
  for (const el of $$('[data-key]')) {
    const key = el.dataset.key;
    if (key === 'nav.size') el.addEventListener('change', () => { s.nav.detailed = false; pendingNav.add('detailed'); });
    if (key === 'nav.k') el.addEventListener('change', () => { navPick++; });
    // Gradescope isn't a host Glaze holds from the start: switched on, it is asked for in this click; refused, the switch stays
    // off. Switched off, the worker hands its grant back.
    if (key === 'enhance.gradescope' && el.type === 'checkbox') { el.addEventListener('change', () => { const on = el.checked; el.checked = false; (on ? GZ_SITE.reach([GZ_GRADESCOPE.HOST], el) : Promise.resolve(true)).then((held) => { if (!held) return; el.checked = on; set(key, on); refresh(); save([group(key)]); }); }); continue; }
    if (el.type === 'checkbox') el.addEventListener('change', () => { set(key, el.checked); if (key === 'look.surfaceCustom' && el.checked) seedSurface(); if (key === 'enhance.coursemenu') renderCourses(); if (key === 'enhance.dashboard') renderNavItems(); refresh(); save([group(key)]); });
    else if (el.type === 'range') {
      el.addEventListener('input', () => { if (key.startsWith('nav.') && Object.hasOwn(N.dimensions(s.nav), key.slice(4))) { Object.assign(s.nav, N.dimensions(s.nav), { detailed: true }); for (const k of [...Object.keys(N.dimensions(s.nav)), 'detailed']) pendingNav.add(k); } set(key, +el.value); refresh(); save([group(key)], true); });
      el.addEventListener('change', () => save([group(key)]));
    } else el.addEventListener('change', () => {
      // A cleared time keeps the last one: the schedule never holds an empty end.
      if (el.type === 'time' && !el.value) { el.value = get(key); return; }
      set(key, el.value); refresh(); save([group(key)]);
    });
  }
  for (const r of $$('.seg input[type="radio"]:not([data-local])')) {
    r.addEventListener('change', () => { set(r.name, r.value); refresh(); save([group(r.name)]); });
  }
  $('#enabled').addEventListener('change', (e) => { s.enabled = e.target.checked; refresh(); save(['enabled']); });

  $('#bg-image').addEventListener('change', (e) => {
    const raw = e.target.value.trim();
    if (raw) {
      let url = null;
      try { url = new URL(raw); } catch { /* not a URL */ }
      if (url?.protocol !== 'https:') return hint(t('Use an https:// link to an image.'), true);
      // One the settings won't keep (too long, or a quote or backslash the page's url("…") can't hold) is refused here,
      // not dropped silently when it is saved.
      if (GZ_SANITIZE({ bg: { image: url.href } }).bg.image !== url.href) return hint(t('That link can’t be saved.'), true);
      s.bg.image = url.href;
      s.bg.kind = 'image';
    } else s.bg.image = '';
    fill();
    save(['bg']);
  });

  $('#save-preset').addEventListener('click', () => {
    const name = $('#preset-name').value.trim();
    if (!name) return hint(t('Give the palette a name first.'), true);
    if (GZ_PRESET(name, s.presets)) return hint(t("There's already a palette called {name}.", { name }), true);
    if (s.presets.length >= GZ_MAX_PRESETS) return hint(t('You can keep {n} palettes. Delete one first.', { n: GZ_MAX_PRESETS }), true);
    s.presets.push({ name, colors: { ...s.colors } });
    s.preset = name;
    $('#preset-name').value = '';
    refresh();
    save(['presets', 'preset']);
  });
  $('#reset-colors').addEventListener('click', () => { save(GZ_UI.pickPreset(s, 'Frost', GZ_PRESET('Frost'))); fill(); });

  // ---- courses: recorded by the content script, on this device only ----
  // A row per course, organizations apart, each in its own color (GZ_COURSE_COLORS) with its own tint.
  const renderCourses = (next = courses) => {
    courses = next || {};
    const all = Object.entries(courses).filter(([, c]) => c?.slot || c?.canvas || c?.moodle)
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    // Picks and ticks from before each course had its own were by slot: a pick becomes the slot's own
    // course's, a tick every course in the slot.
    const own = GZ_COURSE_COLORS(courses, {});
    const cc = s.courses;
    const oldTicks = cc.tinted.filter((n) => /^\d+$/.test(n));
    const oldPicks = Object.keys(cc.colors).filter((n) => /^\d+$/.test(n) && all.some(([id, c]) => c.slot === n && own[id].own));
    if (all.length && (oldTicks.length || oldPicks.length)) {
      cc.tinted = [...new Set([...cc.tinted.filter((n) => !oldTicks.includes(n)), ...all.filter(([, c]) => oldTicks.includes(c.slot)).map(([id]) => id)])];
      for (const n of oldPicks) {
        const [id] = all.find(([i, c]) => c.slot === n && own[i].own);
        cc.colors[id] ||= cc.colors[n];
        delete cc.colors[n];
      }
      save(['courses']);
    }
    const colors = GZ_COURSE_COLORS(courses, cc.colors);
    const row = ([id, c]) => {
      const li = document.createElement('li');
      li.addEventListener('focusin', () => { previewCourse = id; contextPreview(c.canvas ? 'canvas' : c.moodle ? 'moodle' : 'ultra', 'outline'); });
      // Ultra nicknames share the card menu's sanitizer; Canvas and Moodle keep their native names and colors.
      const own = c.canvas ? t('Change the colour and nickname in its card’s menu on Canvas’s Dashboard. Canvas keeps them.') : c.moodle ? t('The colour is Moodle’s own for this course.') : '';
      const nick = (!own && s.enhance.coursemenu && cc.names[id]) || '';
      c = { ...c, real: c.name, name: nick || c.name };
      const input = Object.assign(document.createElement('input'), { type: 'color', value: own ? c.color || '#808080' : colors[id].color });
      input.dataset.settingControl = 'courses.colors';
      input.setAttribute('aria-label', t('Colour for {name}', { name: c.name }));
      if (own) { input.disabled = true; input.title = own; }
      const reset = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Reset'), hidden: !cc.colors[id] });
      input.addEventListener('input', () => { cc.colors[id] = input.value; reset.hidden = false; refresh(); save(['courses'], true); });
      input.addEventListener('change', () => save(['courses']));
      reset.addEventListener('click', () => { delete cc.colors[id]; renderCourses(); refresh(); save(['courses']); });
      const name = Object.assign(document.createElement('span'), { className: 'name', textContent: c.name, title: nick ? c.real : c.name });
      if (!own) {
        const nickname = Object.assign(document.createElement('input'), { type: 'text', maxLength: GZ_NICK_MAX, value: cc.names[id] || '', placeholder: c.real });
        nickname.dataset.settingControl = 'courses.names';
        nickname.setAttribute('aria-label', `${t('Nickname')}: ${c.real}`);
        nickname.addEventListener('change', async () => {
          flush();
          try {
            const result = await chrome.runtime.sendMessage({ type: 'glaze:courseName', id, name: nickname.value });
            // The worker refuses a frame it doesn't know ('sender'): that is no size problem, and Settings in a tab of its own saves.
            if (!result?.ok) return hint(result?.error === 'sender' ? t('Open Settings in its own tab.') : t('Too much to sync. Shorten a nickname or clear one.'), true);
            s.courses = result.courses; renderCourses(); refresh(); hint(t('Saved'));
          } catch { hint(t('Not saved. Try again in a moment.'), true); }
        });
        name.replaceChildren(nickname);
      }
      if (own) name.append(Object.assign(document.createElement('small'), { textContent: own }));
      if (nick) name.append(Object.assign(document.createElement('small'), { textContent: c.real }));
      const tint = Object.assign(document.createElement('label'), { className: 'check', hidden: !cc.tint });
      tint.dataset.tint = '';
      const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: cc.tinted.includes(id) });
      box.dataset.settingControl = 'courses.tinted';
      box.setAttribute('aria-label', t('Tint inside {name}', { name: c.name }));
      box.addEventListener('change', () => {
        cc.tinted = box.checked ? [...cc.tinted, id] : cc.tinted.filter((n) => n !== id);
        refresh();
        save(['courses']);
      });
      tint.append(box, t('Tint'));
      // Its own look on its pages, or the student's theme. Look names are names: not translated.
      const look = Object.assign(document.createElement('select'), { title: t('Look for {name}', { name: c.name }) });
      look.dataset.settingControl = 'courses.looks';
      look.setAttribute('aria-label', look.title);
      look.append(new Option(t('Your theme'), ''), ...GZ_LOOKS.map((L) => Object.assign(new Option(L.name, L.name), { translate: false })));
      look.value = cc.looks[id] || '';
      look.addEventListener('change', () => {
        if (look.value) cc.looks[id] = look.value; else delete cc.looks[id];
        refresh();
        save(['courses']);
      });
      li.append(input, name, look, tint);
      if (!own) li.append(reset);
      return li;
    };
    const orgs = all.filter(([, c]) => c.org);
    $('#course-list').replaceChildren(...all.filter(([, c]) => !c.org).map(row));
    $('#org-list').replaceChildren(...orgs.map(row));
    $('#course-head').hidden = $('#org-head').hidden = !orgs.length;
    $('#course-empty').hidden = all.length > 0;
  };
  chrome.storage.local.get('seenCourses', (r) => renderCourses(r?.seenCourses));

  // ---- course cards: a theme's set of card styles (lib/cards.js), worn by cards without their own ----
  const renderCardSet = (raw) => {
    const n = GZ_CARDS.styles(raw)['*']?.length || 0;
    $('#card-set').hidden = !n;
    $('#card-set-note').textContent = n ? t('{n} card styles from a theme take turns on the cards that have no style of their own.', { n }) : '';
  };
  chrome.storage.sync.get('cards', (r) => renderCardSet(r?.cards));
  // Card writes go through the background worker, one at a time with every Canvas tab's (lib/cards.js change).
  const cardsOp = (op) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:cards', ...op }, (r) => res(!chrome.runtime.lastError && r?.ok)));
  $('#card-set-clear').addEventListener('click', async () => { const ok = await cardsOp({ set: [] }); hint(ok ? t('Saved') : t('Not saved. Try again in a moment.'), !ok); });

  // ---- Gradescope (lib/gradescope.js): which Canvas or Ultra course each Gradescope course goes with, changed here too ----
  // Writes go through the worker's queue ('glaze:gradescope'), as the bar's on Gradescope do.
  let gsSeen = {};
  const gsOp = (op) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:gradescope', ...op }, (r) => res(!chrome.runtime.lastError && r?.ok)))
    .then((ok) => hint(ok ? t('Saved') : t('Not saved. Try again in a moment.'), !ok));
  const renderGradescope = (raw) => {
    const d = GZ_GRADESCOPE.clean(raw);
    const canvas = GZ_GRADESCOPE.canvas(gsSeen); // labelled with code and site, so alike names differ
    const ids = Object.keys(d.map);
    $('#gs-map').hidden = !ids.length && !d.hide && !Object.keys(d.bind).length;
    $('#gs-ask').hidden = !d.hide;
    $('#gs-acct').textContent = d.acct ? t('Gradescope account: {name}', { name: d.acct.name || '—' }) : '';
    $('#gs-forget').hidden = !Object.keys(d.bind).length;
    $('#gs-map ul').replaceChildren(...ids.map((gid) => {
      const m = d.map[gid];
      const c = d.courses[gid];
      const sel = document.createElement('select');
      sel.append(...[['', t('None of these courses')], ...canvas.map((x) => [x.key, x.label]), ['?', t('Forget it (ask again on Gradescope)')]]
        .map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label, selected: value === m.to })));
      sel.setAttribute('aria-label', t('Course for {course}', { course: m.name || gid }));
      sel.addEventListener('change', () => gsOp({ op: 'map', acct: d.acct?.id, list: [{ gid, to: sel.value === '?' ? null : sel.value }] }));
      const li = document.createElement('li');
      const read = c ? [t('Read {when}', { when: when(c.at) }), c.bad ? t('Unreadable rows: {n}', { n: c.bad }) : ''].filter(Boolean).join(' · ') : '';
      li.append(Object.assign(document.createElement('span'), { textContent: m.name || gid }), sel, Object.assign(document.createElement('span'), { className: 'desc', textContent: read }));
      return li;
    }));
  };
  const gsLoad = () => chrome.storage.local.get(['gradescope', 'seenCourses'], (r) => { gsSeen = r?.seenCourses || {}; renderGradescope(r?.gradescope); });
  gsLoad();
  $('#gs-ask').addEventListener('click', () => gsOp({ op: 'hide', hide: false }));
  $('#gs-forget').addEventListener('click', () => gsOp({ op: 'bind', key: null }));

  // ---- Google Calendar sync (lib/gcal.js, through the worker: 'glaze:gcal'), Chrome only ----
  // Behind the build-time switch (lib/gcal.js ON): off, the section stays hidden and nothing here runs.
  if (GZ_GCAL.ON) {
    $('#gcal').hidden = false; $('#sharing-calendar').hidden = false; for (const link of $$('[data-gcal-link]')) link.hidden = false;
    // Offered where chrome.identity.getAuthToken signs in with the browser's own Google account: Google Chrome (and plain
    // Chromium). Edge doesn't support it, Brave has no Google sign-in, Safari and Firefox have no getAuthToken (S3 §1, §4):
    // those get a note pointing to the .ics export.
    const gcalHere = location.protocol === 'chrome-extension:' && !('brave' in navigator) && !!navigator.userAgentData?.brands?.length
      && navigator.userAgentData.brands.every((b) => /^(Google Chrome|Chromium|HeadlessChrome)$|Not.?A.?Brand/i.test(b.brand));
    const gcalOp = (op) => new Promise((res) => chrome.runtime.sendMessage({ type: 'glaze:gcal', ...op }, (r) => res(chrome.runtime.lastError ? { ok: false, error: 'network' } : r || { ok: false })));
    const gcalRender = (g) => {
      $('#gcal-other').hidden = gcalHere;
      $('#gcal-off').hidden = !gcalHere || !!g?.cal;
      $('#gcal-on').hidden = !gcalHere || !g?.cal;
      if (!g?.cal) return;
      // The account is what Google reports as the calendar's owner when it was made or linked: a label, not a check.
      $('#gcal-who').textContent = g.owner ? t('Connected to {account}.', { account: g.owner }) : t('Connected.');
      const last = Math.max(0, ...Object.values(g.last || {}).filter(Number.isFinite));
      $('#gcal-when').textContent = last ? t('Last synced {when}.', { when: when(last) }) : t('Glaze syncs the next time you open Canvas.');
      $('#gcal-error').textContent = g.error === 'auth' ? t('Google needs you to sign in again before Glaze can sync.')
        : g.error === 'missing' || g.error === 'denied' ? t("Glaze can't reach its calendar in your Google account. Disconnect, then connect again to make a new one.")
          : g.error ? t("Google Calendar didn't answer last time. Glaze tries again later.") : '';
      $('#gcal-reconnect').hidden = g.error !== 'auth';
      $('#gcal-id').value = g.cal;
    };
    const gcalLoad = () => new Promise((res) => chrome.storage.local.get('gcal', (r) => res(gcalRender(r?.gcal))));
    gcalLoad();
    // The sign-in, inside the student's own click: Chrome's identity permission (optional; Chrome shows no warning for
    // it), then Google's consent in Chrome's own window. → '' once Chrome holds a token with the calendar scope, else why not.
    const gcalSignIn = async () => {
      try {
        if (!await chrome.permissions.request({ permissions: ['identity'] })) return t("Glaze can't connect without Chrome's sign-in permission.");
        const r = await chrome.identity.getAuthToken({ interactive: true });
        const scope = chrome.runtime.getManifest().oauth2.scopes[0];
        if (Array.isArray(r?.grantedScopes) && !r.grantedScopes.includes(scope)) {
          // Chrome would hand the same token back: forgotten, so the next Connect asks Google again.
          await chrome.identity.removeCachedAuthToken({ token: r.token }).catch(() => {});
          return t("Glaze needs the calendar access on Google's screen. Connect again and leave it ticked.");
        }
        return '';
      } catch { return t("Google didn't connect. Export calendar (.ics) works without signing in."); }
    };
    // Only a person's click or key, while the page has their activation; one at a time.
    let gcalBusy = false;
    const gcalClick = (id, f) => $(id).addEventListener('click', async (e) => {
      if (!e.isTrusted || !(navigator.userActivation?.isActive ?? true) || gcalBusy) return;
      gcalBusy = true;
      try { await f(); } finally { gcalBusy = false; }
    });
    const gcalJoin = async (op) => {
      const no = await gcalSignIn();
      if (no) return hint(no, true);
      const r = await gcalOp(op);
      // Focus moves to what replaced the button that was pressed.
      if (r.ok) return gcalLoad().then(() => { $('#gcal-share').focus(); hint(t('Connected.')); });
      hint(r.error === 'code' ? t("That isn't a link code. Copy it from Link another device on your other computer.")
        : r.error === 'missing' || r.error === 'denied' ? t("That calendar isn't in this Google account, or Glaze didn't make it.")
          : t("Couldn't reach Google Calendar. Try again in a moment."), true);
    };
    gcalClick('#gcal-connect', () => gcalJoin({ op: 'connect', tz: Intl.DateTimeFormat().resolvedOptions().timeZone }));
    gcalClick('#gcal-link', () => ($('#gcal-code').value.trim() ? gcalJoin({ op: 'connect', code: $('#gcal-code').value }) : $('#gcal-code').focus()));
    gcalClick('#gcal-reconnect', async () => {
      const no = await gcalSignIn();
      if (no) return hint(no, true);
      await gcalOp({ op: 'retry' });
      hint(t('Connected.'));
    });
    $('#gcal-share').addEventListener('click', () => {
      const open = $('#gcal-pair').hidden;
      $('#gcal-pair').hidden = !open;
      $('#gcal-share').setAttribute('aria-expanded', String(open));
      if (open) $('#gcal-id').select();
    });
    $('#gcal-copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#gcal-id').value); hint(t('Copied.')); } catch { $('#gcal-id').select(); hint(t('Copy the code from the box.')); }
    });
    // Escape keeps the last returnValue, so each question starts from none.
    $('#gcal-disconnect').addEventListener('click', () => { $('#gcal-drop').checked = false; $('#gcal-bye').returnValue = ''; $('#gcal-bye').showModal(); $('#gcal-bye-cancel').focus(); }); // focused here, not by autofocus: Settings can be a frame of a school page, where browsers refuse autofocus
    $('#gcal-bye').addEventListener('close', async () => {
      if ($('#gcal-bye').returnValue !== 'ok') return $('#gcal-disconnect').focus();
      const r = await gcalOp({ op: 'disconnect', drop: $('#gcal-drop').checked });
      if (!r.ok) return hint(t("Couldn't delete the Glaze calendar, so nothing changed. Try again, or disconnect without deleting it."), true);
      // Nothing stays behind: the permission goes too, until the next Connect asks again.
      await chrome.permissions.remove({ permissions: ['identity'] }).catch(() => {});
      gcalRender(null);
      $('#gcal-connect').focus();
      hint(r.had && !r.revoked ? t("Disconnected on this device. Google didn't confirm it removed Glaze's access: you can remove it at myaccount.google.com/connections.") : t('Disconnected.'), r.had && !r.revoked);
    });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.gcal) gcalRender(changes.gcal.newValue); });
  }

  // Another surface changed something: read after our queued saves, and never apply a read older than an edit.
  const syncSettings = () => {
    if (pending.size || saving) return;
    const mine = ++settingsRead;
    GZ_UI.load().then((next) => {
      if (mine !== settingsRead || pending.size || saving || JSON.stringify(next) === JSON.stringify(s)) return;
      Object.assign(s, next);
      fill();
    });
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.seenCourses) renderCourses(changes.seenCourses.newValue);
    if (area === 'local' && (changes.gradescope || changes.seenCourses)) gsLoad();
    if (area === 'sync' && changes.cards) renderCardSet(changes.cards.newValue);
    if (area === 'sync' || (area === 'local' && changes.freshDefaults)) syncSettings();
    if (area === 'local' && changes[GZ_MEDIA.INDEX]) GZ_EDITOR_XBG.kept(); // the files kept for backgrounds (lib/media.js)
  });

  // ---- share: a theme code is the palette, look and background, checked by lib/share.js ----
  let partsStorageRead = 0;
  const partsStorage = async () => {
    const mine = ++partsStorageRead, { lookX } = await chrome.storage.sync.get('lookX');
    const localOnly = typeof lookX?.h === 'string';
    const packed = localOnly ? await GZ_XPARTS.stored(lookX, GZ_XPARTS.areas().local) : null;
    if (mine !== partsStorageRead) return;
    const notice = $('#look-parts-storage');
    notice.hidden = !localOnly;
    notice.textContent = !localOnly ? '' : packed === undefined ? t("This Look's extras are unavailable on this device.") : t('Extras on this device only.');
  };
  partsStorage().catch(() => {});
  chrome.storage.onChanged.addListener((ch) => { if (ch.lookX) partsStorage().catch(() => {}); });
  $('#share-copy').addEventListener('click', async () => {
    const { cards } = await new Promise((res) => chrome.storage.sync.get('cards', (r) => res(r || {})));
    let code;
    // A pasted code can't bring a file kept on this computer (only a share session can), so a Look that needs one is refused here.
    try { code = await GZ_SHARE.encode(s, cards, s.parts, { files: false }); } catch (e) { return hint(t(e.why || e.message, e.vars), true); }
    try { await navigator.clipboard.writeText(code); hint(t('Theme code copied.')); } catch { $('#share-code').value = code; $('#share-code').select(); hint(t('Copy the code from the box.')); }
  });
  // from: the gallery Look the code came with ({ name, author }), or null for a pasted code.
  let from = null;
  // The background file the worker kept for a gallery or share offer, pending (lib/media.js) until the offer is used: any other
  // end of the offer, or leaving the editor, lets it go. used: the Look (or a favorite) now names it, so it stays.
  let offerFile = '', offerGeneration = 0;
  const letGo = (used = false) => {
    if (offerFile) chrome.runtime.sendMessage({ type: 'glaze:media', op: used ? 'keep' : 'drop', h: offerFile, ...(!used && { pending: true }) }, () => void chrome.runtime.lastError);
    offerFile = '';
  };
  addEventListener('pagehide', () => { offerGeneration++; letGo(); });
  const endOffer = (used = false) => { offerGeneration++; letGo(used === true); offer = null; from = null; $('#share-offer').hidden = true; GZ_UI.paint(s, { page: true }); preview(); };
  const tryCode = async (gallery = null) => {
    const code = $('#share-code').value.trim();
    if (!code) return endOffer();
    const generation = ++offerGeneration;
    if (offerFile && offerFile !== gallery?.media?.h) letGo();
    if (gallery?.media?.pending) offerFile = gallery.media.h;
    let got;
    try { got = await GZ_SHARE.decode(code); } catch (e) { if (generation !== offerGeneration) return; endOffer(); return hint(t(e.why || e.message, e.vars), true); }
    if (generation !== offerGeneration) return; // Cancel, another code or leaving the editor won while decoding.
    const and = (names) => new Intl.ListFormat(GZ_I18N.locale(GZ_I18N.ui())).format(names);
    // A Look part's sentence (lib/lookparts.js): a list in it is Glaze's own names, each translated, then joined.
    const say = (n) => t(n.why, n.vars && Object.fromEntries(Object.entries(n.vars).map(([k, v]) => [k, Array.isArray(v) ? and(v.map((w) => t(w))) : v])));
    // Every code is someone else's Look here (pasted, the gallery's, a Look share's): one that takes away signing out or
    // the account, or adds a link without https or named as Glaze's own, is refused whole, with its reasons.
    const refused = GZ_XPARTS.outside(got.parts);
    if (refused.length) { endOffer(); return hint([t("Glaze won't use this Look."), ...refused.map(say)].join(' '), true); }
    from = gallery;
    offer = GZ_SANITIZE({ ...s, colors: got.colors, look: { ...s.look, ...got.look }, bg: { ...s.bg, ...got.bg }, nav: GZ_SHARE.nav(s.nav, got.nav), navbar: { ...s.navbar, ...got.navbar || {} }, sidebar: { ...s.sidebar, ...got.sidebar || {} } });
    offer.preset = GZ_MATCH_PRESET(offer.colors, s.presets);
    offer.auto = { ...s.auto, on: false };
    offer.card = GZ_CARDS.settings({ ...s.card, ...got.card });
    offer.cardSet = got.cards;
    offer.code = code;
    // Every code brings its own parts or clears the previous Look's parts.
    const paletteOnly = !Object.keys(got.look).length && !Object.keys(got.bg).length && !Object.keys(got.nav).length && !Object.keys(got.navbar || {}).length && !Object.keys(got.sidebar || {}).length && !got.cards.length && !got.parts;
    offer.parts = got.parts;
    const palette = offer.preset ? t('The {name} palette', { name: offer.preset }) : t('A custom palette');
    const what = $('#share-what');
    what.replaceChildren();
    if (from) what.append(Object.assign(document.createElement('b'), { textContent: from.author ? t('{name} by {author}.', from) : `${from.name}.`, translate: false }), ' ');
    if (paletteOnly) {
      // A palette alone (the gallery has those) leaves the rest as it is.
      what.append(t("{palette}. Your fonts and background stay as they are. It's showing in the preview.", { palette }));
    } else {
      // What it is, and anything it would fetch from elsewhere.
      const fonts = [...new Set([...['font', 'head', 'mono'].map((k) => offer.look[k]), ...(got.parts?.x?.rules || []).map((r) => r.st?.f)].filter((v) => v && v !== 'auto'))].map((v) => GZ_FONTS.resolve(v));
      const web = fonts.filter((f) => f.google || f.files).map((f) => f.name);
      const fontHosts = [...new Set(fonts.flatMap((f) => f.google ? ['fonts.googleapis.com', 'fonts.gstatic.com'] : Object.values(f.files || {}).map((url) => new URL(url).hostname)))];
      // Style and scene values are the editor's own labels, lowercased: 'radial' is 'Radial'.
      const word = (v) => t(v[0].toUpperCase() + v.slice(1));
      const kind = { solid: t('a solid background'), gradient: t('a {style|lower} gradient background', { style: word(offer.bg.style) }), aurora: t('an aurora background'), scene: t('the {scene|lower} animated background', { scene: word(offer.bg.scene) }), image: t('an image background') }[offer.bg.kind] || t(GZ_XPARTS.KIND_WORD[offer.bg.kind]);
      what.append(t("{palette}, {fonts}, and {background}. It's showing in the preview.", { palette, fonts: and(fonts.map(fontName)), background: kind }));
      const notes = [];
      if (web.length) notes.push(t('Downloads {fonts} (web fonts).', { n: web.length, fonts: and(web) }));
      if (fontHosts.length) notes.push(t('Its web fonts load from {hosts}.', { hosts: and(fontHosts) }));
      if (offer.bg.kind === 'image' && offer.bg.image) notes.push(t('Loads its background image from {host}.', { host: new URL(offer.bg.image).hostname }));
      const cardHosts = [...new Set(got.cards.filter((c) => c.u).map((c) => new URL(c.u).hostname))];
      if (got.cards.length) notes.push(t('Brings {n} course card styles for your Canvas Dashboard.', { n: got.cards.length }));
      if (cardHosts.length) notes.push(t('Its card pictures load from {hosts}.', { hosts: and(cardHosts) }));
      if (offer.nav.k === 'image' && offer.nav.u) notes.push(t('Its sidebar picture loads from {host}.', { host: new URL(offer.nav.u).hostname }));
      for (const n of GZ_XPARTS.describe(got.parts)) notes.push(say(n));
      if (from?.media?.error === 'full') notes.push(t("There isn't room to keep this Look's background file, so the gradient shows instead. Remove a kept file under Background, then open the Look again."));
      if (notes.length) what.append(Object.assign(document.createElement('span'), { className: 'desc', textContent: notes.join(' ') }));
    }
    $('#share-offer').hidden = false;
    GZ_UI.paint(offer, { page: true });
    preview();
  };
  $('#share-try').addEventListener('click', () => tryCode());
  $('#share-code').addEventListener('paste', () => setTimeout(tryCode));
  $('#share-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryCode(); });
  $('#share-cancel').addEventListener('click', () => { $('#share-code').value = ''; endOffer(); });
  // A code brings its own extras or none: the Look being left goes into History before the one below replaces it.
  $('#share-apply').addEventListener('click', () => {
    const chosen = offer, generation = offerGeneration;
    if (!chosen) return;
    const apply = () => {
      if (offer !== chosen || generation !== offerGeneration) return;
      leaving();
      for (const k of GZ_HISTORY.KEYS) s[k] = offer[k];
      s.card = offer.card;
      s.nav = offer.nav;
      // How Glaze's own navigation bar looks and sits (lib/share.js NAVBAR); whether it is on stays the student's.
      s.navbar = { ...offer.navbar, on: s.navbar.on };
      // The sidebar's appearance a Look brings (lib/share.js): its style, surface and corners only.
      const sidebarLook = ['style', 'surface', 'radius'].some((k) => s.sidebar[k] !== offer.sidebar[k]);
      if (sidebarLook) for (const k of ['style', 'surface', 'radius']) s.sidebar[k] = offer.sidebar[k];
      pendingNav.clear();
      // A theme's card styles take turns on the cards without their own (lib/cards.js).
      const set = offer.cardSet;
      if (set.length) cardsOp({ set });
      $('#share-code').value = '';
      endOffer(true); // its background file, if it brought one, is kept now
      fill();
      save([...GZ_HISTORY.KEYS, 'card', 'nav', 'navbar', ...sidebarLook ? ['sidebar'] : []]);
      hint(t('Theme applied.'));
    };
    const src = chosen.parts?.x?.bg?.media?.src;
    if (!src?.startsWith('https://')) return apply();
    // A code can introduce remote media just as the link box can. Ask in Apply's click before changing this Look.
    GZ_SITE.reach([src], $('#share-apply'), { kind: 'code', code: chosen.code }).then((held) => {
      if (held === null) return; // sent to Settings' own tab
      if (offer !== chosen || generation !== offerGeneration) return;
      if (!held) return hint(t('That link can’t be saved.'), true);
      apply();
    });
  });

  // ---- gallery, favorites and history: kept on this device (storage.local), lib/history.js ----
  const local = chrome.storage.local;
  const chips = (colors) => {
    const box = Object.assign(document.createElement('span'), { className: 'chips' });
    box.setAttribute('aria-hidden', 'true');
    for (const v of ['--gz-surface-2', '--gz-surface', '--gz-accent', '--gz-accent-hi', '--gz-ink']) {
      const i = document.createElement('i');
      i.style.background = colors[v];
      box.append(i);
    }
    return box;
  };
  const when = (at) => new Intl.DateTimeFormat(GZ_I18N.locale(GZ_I18N.ui()), { dateStyle: 'medium', timeStyle: 'short' }).format(at);
  const button = (text, label, onClick, cls = '') => {
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, className: cls });
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };
  // Look and gallery names are names: not translated.
  const row = (colors, name, sub, ...buttons) => {
    const li = document.createElement('li');
    const n = Object.assign(document.createElement('span'), { className: 'name', textContent: name, title: name, translate: false });
    if (sub) n.append(Object.assign(document.createElement('small'), { textContent: sub }));
    li.append(chips(colors), n, ...buttons);
    return li;
  };
  let favorites = [];
  let history = [];
  const renderFavorites = async () => {
    // Each code is checked again: storage is only as good as what put it there.
    const rows = await Promise.all(favorites.map(async (f) => {
      let got;
      try { got = await GZ_SHARE.decode(f.code); } catch { return null; }
      return row(got.colors, f.name, f.author || '',
        button(t('Preview'), t('Preview {name}', { name: f.name }), async () => {
          $('#share-code').value = f.code;
          await tryCode(f);
          $('#share-offer').scrollIntoView({ block: 'nearest' });
        }),
        button(t('Remove'), t('Remove {name} from favorites', { name: f.name }), () => local.set({ lookFavorites: favorites.filter((x) => x !== f) }), 'danger'));
    }));
    $('#favorites').replaceChildren(...rows.filter(Boolean));
  };
  // A change that replaces this Look's extras (a whole Look, a code, an entry of History, a reset): the Look being left goes into
  // History now, since the background records a theme only after 4 s of rest and what was typed in the last moments would be
  // lost. The worker merges the snapshot on its history/clear queue, even before the editor's first history read finishes.
  // → how to wear it again, or null when it has no extras to lose.
  const leaving = () => {
    if (!s.parts) return null;
    const was = structuredClone({ colors: s.colors, preset: s.preset, auto: s.auto, look: s.look, bg: s.bg, parts: s.parts, card: s.card });
    try { chrome.runtime.sendMessage({ type: 'glaze:history-checkpoint', theme: was }, () => void chrome.runtime.lastError); } catch { /* Undo still holds the snapshot if the worker is unavailable. */ }
    return () => { Object.assign(s, structuredClone(was)); fill(); save([...GZ_HISTORY.KEYS, 'card']); };
  };
  const wearEntry = (e) => {
    endOffer();
    leaving();
    Object.assign(s, GZ_HISTORY.wear(s, e));
    fill();
    save(GZ_HISTORY.KEYS);
    hint(t('Theme applied.'));
  };
  // Redrawn only when what it shows changes: History itself, or which entries are worn now and which is the Previous Look (a
  // slider moves neither, so a drag cleans one theme per tick and builds no rows). Each entry's theme and name are made once,
  // when History comes in (lib/history.js).
  const renderHistory = (() => {
    let drawn = '', from = null, entries = [], shown = '';
    return () => {
      const worn = JSON.stringify([s.colors, s.preset, s.auto, s.look, s.bg, s.parts, s.presets]);
      if (worn === drawn && history === from) return;
      drawn = worn;
      if (history !== from) {
        from = history;
        shown = '';
        entries = history.map((e) => { const theme = GZ_HISTORY.theme(e.theme); return { ...e, theme, name: GZ_UI.themeName(theme) }; });
      }
      const now = GZ_HISTORY.theme(s), wearing = entries.map((e) => GZ_HISTORY.wearing(now, e));
      const back = GZ_HISTORY.previous(entries, now);
      const view = `${wearing.map(Number).join('')} ${entries.indexOf(back)}`;
      if (view === shown) return;
      shown = view;
      $('#history-back').disabled = !back;
      $('#history-back').title = back ? t('Back to {name}', { name: back.name }) : '';
      $('#history-clear').hidden = !entries.length;
      $('#history').replaceChildren(...entries.map((e, at) => {
        if (wearing[at]) return row(e.theme.colors, e.name, t('Wearing now'));
        return row(e.theme.colors, e.name, typeof e.at === 'number' ? when(e.at) : '', button(t('Wear'), t('Wear {name}', { name: e.name }), () => wearEntry(e)));
      }));
    };
  })();
  $('#history-back').addEventListener('click', () => { const e = GZ_HISTORY.previous(history, s); if (e) wearEntry(e); });
  // Through the background, which also drops a recording still waiting to be written.
  $('#history-clear').addEventListener('click', () => chrome.runtime.sendMessage('clear-history', () => void chrome.runtime.lastError));
  $('#share-fav').addEventListener('click', () => {
    const f = { code: offer.code, name: from?.name || offer.preset || t('Custom theme'), author: from?.author || '', at: Date.now() };
    letGo(true); // a favorite names its background file: it stays
    local.set({ lookFavorites: GZ_HISTORY.favor(favorites, f) }, () => {
      const err = chrome.runtime.lastError;
      hint(err ? t('Not saved: {error}', { error: err.message }) : t('Saved to your favorites.'), !!err);
    });
  });
  // A Look picked on the gallery (lib/gallery.js, then the background): previewed here; the student decides.
  // The editor the worker opens takes it (openOptionsPage: a tab of its own). Settings framed in a school's page, open or
  // not, would otherwise take it first, and that tab would show nothing.
  const takeOffer = async () => {
    if (embedded) return;
    const { galleryOffer: g } = await local.get('galleryOffer');
    if (!g?.code) return;
    await local.remove('galleryOffer');
    $('#share-code').value = g.code;
    await tryCode({ name: g.name || t('Custom theme'), author: g.author || '', media: g.media });
    editor.show('look/palette', { scroll: true });
    if (offer) $('#share-apply').focus({ preventScroll: true });
  };
  local.get(['lookFavorites', 'lookHistory'], (r) => {
    favorites = GZ_HISTORY.favorites(r?.lookFavorites);
    history = GZ_HISTORY.entries(r?.lookHistory);
    renderFavorites();
    renderHistory();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.lookFavorites) { favorites = GZ_HISTORY.favorites(changes.lookFavorites.newValue); renderFavorites(); }
    if (changes.lookHistory) { history = GZ_HISTORY.entries(changes.lookHistory.newValue); renderHistory(); }
    if (changes.galleryOffer?.newValue) takeOffer();
  });
  takeOffer();
  if (!embedded) chrome.runtime.sendMessage({ type: 'glaze:settings-action' }).then(async (r) => {
    const a = r?.action;
    if (a?.kind === 'media') {
      editor.show('look/background', { scroll: true });
      GZ_EDITOR_XBG.offer(a);
    } else if (a?.kind === 'notes') {
      editor.show('sharing/sessions', { scroll: true });
      globalThis.GZ_SESSION_OFFER?.(a);
    } else if (a?.kind === 'code') {
      $('#share-code').value = a.code;
      await tryCode();
      editor.show('look/palette', { scroll: true });
      if (offer) $('#share-apply').focus({ preventScroll: true });
    }
  }).catch(() => {});

  // ---- Look rotation's list: kept on this computer (storage.local), lib/lookx.js. Your own pointer picture is
  // lib/editor-pointer.js's. ----
  let rotateLooks = [];
  const renderExtras = () => {
    $('#rotate-at').hidden = s.extras.rotate !== 'daily';
    $('#rotate-looks').hidden = s.extras.rotate === 'off';
  };
  const renderRotate = async () => {
    const tick = (id, colors, name) => {
      const c = Object.assign(document.createElement('input'), { type: 'checkbox', checked: rotateLooks.includes(id) });
      c.setAttribute('aria-label', t('Rotate through {name}', { name }));
      c.addEventListener('change', () => local.set({ rotateLooks: c.checked ? [...rotateLooks, id] : rotateLooks.filter((x) => x !== id) }));
      return row(colors, name, '', c);
    };
    const favs = await Promise.all(favorites.map((f) => GZ_SHARE.decode(f.code).then((got) => tick(f.code, got.colors, f.name), () => null)));
    $('#rotate-looks').replaceChildren(...GZ_LOOKS.map((L) => tick(L.name, L.colors, L.name)), ...favs.filter(Boolean));
  };
  local.get('rotateLooks', (r) => { rotateLooks = Array.isArray(r?.rotateLooks) ? r.rotateLooks : []; renderRotate(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.rotateLooks) rotateLooks = Array.isArray(changes.rotateLooks.newValue) ? changes.rotateLooks.newValue : [];
    if (changes.rotateLooks || changes.lookFavorites) renderRotate();
  });

  // ---- the restore list (#restore-pick): what a read file holds (lib/backup.js read), every category ticked; an old Notes
  // zip goes into an account on this device. → { ticked: Set, account } once Restore is pressed, or null.
  const askRestore = (() => {
    const dialog = $('#restore-pick'), cats = $('#restore-cats'), go = $('#restore-ok'), field = $('#restore-account-field'), select = $('#restore-account');
    let answer = null;
    const boxes = () => [...cats.querySelectorAll('input')];
    const enabled = () => { go.disabled = !boxes().some((b) => b.checked && !b.disabled) || (!field.hidden && boxes().some((b) => b.value === 'notes' && b.checked) && !select.value); };
    cats.addEventListener('change', enabled);
    select.addEventListener('change', enabled);
    dialog.addEventListener('close', () => {
      const ticked = new Set(boxes().filter((b) => b.checked && !b.disabled).map((b) => b.value));
      answer?.(dialog.returnValue === 'ok' && ticked.size ? { ticked, account: select.value } : null);
      answer = null;
    });
    // A Notes account as a person reads it: its school's host and user id.
    const account = (key) => { const u = new URL(key.slice(9)); return `${u.host} · ${u.pathname.slice(1)}`; };
    return (file, plan, accounts) => new Promise((resolve) => {
      const names = backupNames(), count = plan.cats.notes?.length || 0;
      $('#restore-title').textContent = t('Restore from {file}', { file: file.name });
      cats.replaceChildren(...GZ_BACKUP.CATS.filter((k) => plan.cats[k] !== undefined).map((k) => {
        const none = k === 'notes' && plan.kind === 'notes' && !accounts.length;
        const box = Object.assign(document.createElement('input'), { type: 'checkbox', value: k, checked: !none, disabled: none });
        const label = Object.assign(document.createElement('label'), { className: 'check' });
        label.append(box, Object.assign(document.createElement('span'), { textContent: k === 'notes' && count > 1 ? t('Notes ({n} accounts)', { n: count }) : names[k] }));
        if (none) label.append(Object.assign(document.createElement('span'), { className: 'desc', textContent: t('No notes on this device yet. Write one in Notes on Canvas or Blackboard first.') }));
        return label;
      }));
      field.hidden = plan.kind !== 'notes' || !accounts.length;
      select.replaceChildren(Object.assign(document.createElement('option'), { value: '', textContent: '', selected: true }), ...accounts.map((k) => Object.assign(document.createElement('option'), { value: k, textContent: account(k) })));
      enabled();
      answer = resolve;
      dialog.returnValue = '';
      dialog.showModal();
      (boxes().find((b) => !b.disabled) || $('#restore-cancel')).focus(); // focused here, not by autofocus: Settings can be a frame
    });
  })();

  // ---- backup ----
  // One file (lib/backup.js): the settings, with Better To Do's own tasks and plans (storage.local, per Canvas site and user)
  // and the pet beside them, card styles and bookmarks (a picture kept on this computer stays here), Look favorites, every
  // Notes account, and this device's own records. Restore… lists what a file holds; each ticked category joins what is here.
  const backupNames = () => ({ settings: t('Settings and Looks'), notes: t('Notes'), tasks: t('Tasks and pet'), dashNotes: t('Dashboard notes'),
    classes: t('Class schedules'), gpa: t('GPA past terms'), widgets: t('Widgets'), shareKeys: t('Share keys'), papers: t('Papers') });
  const sessionsOp = async (op, rest = {}) => {
    const r = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op, ...rest });
    if (!r?.ok) throw new Error(r?.error || 'storage');
    return r;
  };
  let backupBusy = false;
  $('#export').addEventListener('click', async (e) => {
    if (!e.isTrusted || !(navigator.userActivation?.isActive ?? true) || backupBusy) return;
    backupBusy = true;
    try {
      const keys = await chrome.runtime.sendMessage({ type: 'glaze:sessions', op: 'exportKeys' });
      if (!keys?.ok || !Array.isArray(keys.keys)) throw new Error('keys');
      const r = await chrome.storage.sync.get(['cards', 'links', 'ucards', 'ulinks', 'navItems', 'navbarItems']);
      const fresh = (await chrome.storage.local.get('freshDefaults')).freshDefaults?.fresh === true;
      r.navbarItems = GZ_NAVBAR.initial(r.navbarItems, r.navItems, fresh);
      const all = await chrome.storage.local.get(null);
      const tasks = Object.fromEntries(Object.entries(all).filter(([k]) => GZ_TODO.STORE_KEY.test(k)));
      const pets = GZ_PET.backup(Object.fromEntries(Object.entries(all).filter(([k]) => GZ_PET.KEY.test(k))));
      if (!pets) throw new Error('pet history');
      const folders = GZ_FOLDERS.backup(all);
      const nav = { ...s.nav, i: '', li: '', ...(s.nav.li && { brand: 'glaze' }), ...(s.nav.i && { k: 'default', u: '' }) };
      const navbar = { ...s.navbar, ...(s.navbar.brand === 'custom' && { brand: 'glaze' }) };
      const settings = { ...s, nav, navbar, navItems: N.clean(r?.navItems), navbarItems: GZ_NAVBAR.clean(r?.navbarItems), folders, cards: GZ_CARDS.styles(r.cards), links: GZ_CARDS.links(r.links), ucards: GZ_CARDS.styles(r.ucards), ulinks: GZ_CARDS.links(r.ulinks), favorites: GZ_HISTORY.favorites(all.lookFavorites) };
      const notes = [];
      for (const account of Object.keys(all).filter((k) => GZ_BACKUP.ACCOUNT.test(k))) {
        hint(t('Backing up…'));
        notes.push({ account, entries: await GZ_BACKUP.notesOut(account, sessionsOp) });
      }
      const entries = GZ_BACKUP.pack({ settings, tasks: { tasks, pets }, local: all, notes, keys: keys.keys, version: chrome.runtime.getManifest().version });
      const blob = new Blob(GZ_ZIP.zip(entries), { type: 'application/zip' });
      if (blob.size > GZ_BACKUP.LIMIT.zip || entries.length > GZ_BACKUP.LIMIT.entries) throw Object.assign(new Error('big'), { ui: t('Too big for one backup file (up to {size}).', { size: `${GZ_BACKUP.LIMIT.zip >> 20} MB` }) });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: GZ_BACKUP.fileName() });
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      hint('');
    } catch (err) { hint(err.ui || t('Could not finish. Your local copies are kept. Try again.'), true); }
    finally { backupBusy = false; }
  });
  // Clean Settings for the worker's staged restore; the UI reloads them only after the whole backup commits.
  const putSettings = async (raw) => {
    const next = { ...GZ_SANITIZE(raw), card: GZ_CARDS.settings(raw.card) };
    next.nav.i = ''; next.nav.li = ''; if (next.nav.brand === 'custom') next.nav.brand = 'glaze'; // A backup never names a picture on another device.
    if (next.navbar.brand === 'custom') next.navbar.brand = 'glaze';
    const mediaSrc = raw.parts?.x?.bg?.media?.src;
    // A kept file isn't in a backup: unless this computer still has it (a backup put back where it was made), as the worker
    // that keeps it lists it (lib/media.js).
    const kept = typeof mediaSrc === 'string' && mediaSrc.startsWith('file:') ? mediaSrc.slice(5) : '';
    const mediaMissing = next.bg.kind === 'media' && !!kept
      && !(await chrome.runtime.sendMessage({ type: 'glaze:media', op: 'list' }).catch(() => null))?.files?.some((f) => f.h === kept);
    if (mediaMissing) next.bg.kind = 'gradient';
    const tasks = raw.tasks && typeof raw.tasks === 'object'
      ? Object.fromEntries(Object.entries(raw.tasks).filter(([k]) => GZ_TODO.STORE_KEY.test(k)).map(([k, v]) => [k, GZ_TODO.clean(v)])) : {};
    const restore = { tasks, pets: raw.pets, folders: GZ_FOLDERS.backup(raw.folders), parts: raw.parts ?? null,
      settings: { version: 2, ...next, navItems: N.clean(raw.navItems), ...(raw.navbarItems !== undefined && { navbarItems: GZ_NAVBAR.clean(raw.navbarItems) }) } };
    const cards = [
      ...(raw.ucards || raw.ulinks ? [{ ultra: true, replace: { cards: raw.ucards, links: raw.ulinks } }] : []),
      { nav: next.nav, ...(raw.cards || raw.links ? { replace: { cards: raw.cards, links: raw.links } } : {}) },
    ];
    return { restore, cards, media: mediaMissing };
  };
  $('#import-btn').addEventListener('click', (e) => { if (e.isTrusted) $('#import').click(); });
  $('#import').addEventListener('change', async (e) => {
    if (!e.isTrusted) return;
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || backupBusy) return;
    backupBusy = true;
    let plan;
    try {
      hint(t('Reading {name}…', { name: file.name }));
      try { plan = await GZ_BACKUP.read(file); hint(''); } catch (err) {
        const zip = /\.zip$/i.test(file.name);
        return hint({
          big: () => t('That file is too big to import (up to {size}).', { size: `${(zip ? GZ_BACKUP.LIMIT.zip : GZ_BACKUP.LIMIT.json) >> 20} MB` }),
          json: () => t("{file} isn't a JSON file.", { file: file.name }),
          none: () => t('No Glaze settings found in {file}.', { file: file.name }),
          newer: () => t('{file} was made by a newer Glaze. Update Glaze to restore it.', { file: file.name }),
        }[err.why]?.() || t("{file} isn't a Glaze backup, or it's damaged.", { file: file.name }), true);
      }
      const accounts = plan.kind !== 'notes' ? [] : (chrome.storage.local.getKeys ? await chrome.storage.local.getKeys() : Object.keys(await chrome.storage.local.get(null))).filter((k) => GZ_BACKUP.ACCOUNT.test(k));
      const pick = await askRestore(file, plan, accounts);
      if (!pick) return;
      let token;
      const backupOp = async (op, rest = {}) => {
        const r = await chrome.runtime.sendMessage({ type: 'glaze:backup', restore: { op, token, ...rest } });
        if (!r?.ok) throw new Error(r?.error || 'write');
        return r;
      };
      const abandon = () => { if (token) chrome.runtime.sendMessage({ type: 'glaze:backup', restore: { op: 'abort', token } }).catch(() => {}); };
      addEventListener('pagehide', abandon, { once: true });
      flush();
      hint(t('Restoring…'));
      const out = await GZ_BACKUP.restore(plan, pick.ticked, {
        begin: async () => { token = (await backupOp('begin')).token; },
        own: (value) => backupOp('stage', { action: 'own', value }),
        settings: async (raw) => { const value = await putSettings(raw); await backupOp('stage', { action: 'settings', value }); return { ok: true, media: value.media }; },
        send: (op, rest) => backupOp('stage', { action: 'send', value: { op, ...rest } }),
        finish: () => chrome.runtime.sendMessage({ type: 'glaze:backup', restore: { op: 'commit', token } }),
        abort: async () => { if (token) await backupOp('abort'); },
      }, pick.account);
      removeEventListener('pagehide', abandon);
      const names = backupNames();
      if (!out.failed.length) {
        Object.assign(s, await GZ_UI.load());
        navItems = N.clean((await chrome.storage.sync.get('navItems')).navItems); renderNavItems(); showNavPreview(); fill();
        hint([t('Restored {file}.', { file: file.name }), out.media && t('The background file was not included in this backup; showing the gradient.'),
          pick.ticked.has('shareKeys') && t('Resume sharing to reconnect.'), out.skipped && t('Skipped (already up to date or too large): {n}', { n: out.skipped })].filter(Boolean).join(' '));
      } else if (out.undone === false) hint(t("Couldn't restore {names}. Try again.", { names: new Intl.ListFormat(GZ_I18N.locale(GZ_I18N.ui())).format(out.failed.map((k) => names[k])) }), true);
      else if (!out.changed) hint(t("Couldn't restore {file}, so nothing changed.", { file: file.name }), true);
      else hint(t("Couldn't restore {names}. Try again.", { names: new Intl.ListFormat(GZ_I18N.locale(GZ_I18N.ui())).format(out.failed.map((k) => names[k])) }), true);
    } catch { hint(t('Could not finish. Your local copies are kept. Try again.'), true); } finally {
      backupBusy = false;
      $('#import-btn').focus();
    }
  });
  // The defaults this device started with: a fresh install has Notes and the pet habitat on (GZ_SANITIZE's fresh), so a
  // reset gives those back rather than turning them off.
  let freshHere = false;
  chrome.storage.local.get('freshDefaults', (r) => { freshHere = r?.freshDefaults?.fresh === true; showResets(); });
  const defaultsHere = () => ({ ...GZ_SANITIZE(undefined, freshHere), card: GZ_CARDS.settings() });
  // Two clicks, so a stray one can't wipe everything. Custom presets survive.
  let armed = 0;
  $('#reset-all').addEventListener('click', (e) => {
    const b = e.currentTarget;
    if (!armed) {
      b.textContent = t('Click again to reset');
      armed = setTimeout(() => { armed = 0; b.textContent = t('Reset everything'); }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = 0;
    b.textContent = t('Reset everything');
    leaving();
    const defaults = defaultsHere();
    const touched = GZ_EDITOR.reset(s, Object.keys(defaults), defaults);
    pendingNav.clear();
    // Keep image IDs, per-course styles/bookmarks, local data and share keys: the worker resets only the files kept for Looks'
    // backgrounds (lib/media.js). The Look's parts go too: they are part of the Look being reset.
    s.parts = null;
    GZ_EDITOR_X.render(true); // Discard unsaved shader text even when there were no saved parts.
    save([...touched, 'parts']);
    fill();
    hint(t('Preferences reset and files kept for backgrounds removed. Your presets and other local data are kept.'));
    chrome.runtime.sendMessage({ type: 'glaze:media', op: 'reset' }, (r) => { if (chrome.runtime.lastError || !r?.ok) hint(t("Couldn't remove the files kept for backgrounds. Try again in a moment."), true); });
    // And the sites said yes to (Sites, below): Glaze asks again on each.
    chrome.runtime.sendMessage({ type: 'glaze:sites', op: 'reset' }).catch(() => {});
  });

  // ---- Sites: the sites the student said yes to (lib/background.js approved), each with Remove, which only the worker does.
  // Each LMS's own hosts (GZ_BUILT_IN) are Glaze's anyway, so they aren't listed.
  const KINDS = { canvas: 'Canvas', moodle: 'Moodle', ultra: 'Blackboard Ultra' };
  const siteSaid = (text) => { $('#site-status').textContent = text; };
  const renderSites = (r) => {
    const sites = new Map();
    for (const kind of Object.keys(KINDS)) for (const x of Array.isArray(r?.[kind]) ? r[kind] : []) {
      let u;
      try { u = new URL(String(x).replace(/\/\*$/, '')); } catch { continue; }
      const automatic = GZ_BUILT_IN(kind, u);
      if (u.protocol !== 'https:' || automatic) continue;
      sites.set(u.origin, [...new Set([...sites.get(u.origin) || [], t(KINDS[kind])])]);
    }
    $('#site-list').replaceChildren(...[...sites].sort(([a], [b]) => a.localeCompare(b)).map(([origin, kinds]) => {
      const host = new URL(origin).host;
      const name = Object.assign(document.createElement('span'), { className: 'name' });
      name.append(Object.assign(document.createElement('span'), { textContent: host, translate: false }), Object.assign(document.createElement('small'), { textContent: kinds.join(' · ') }));
      const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: t('Remove') });
      remove.setAttribute('aria-label', t('Remove {name}', { name: host }));
      remove.addEventListener('click', async (e) => {
        if (!e.isTrusted || remove.disabled) return;
        remove.disabled = true;
        const done = await chrome.runtime.sendMessage({ type: 'glaze:sites', op: 'remove', origin }).catch(() => null);
        if (!done?.ok) { remove.disabled = false; siteSaid(t('Not saved. Try again in a moment.')); return; }
        // And the browser's grant for it, where the student gave one for exactly this site (lib/site.js handBack).
        const site = GZ_SITE.address(origin);
        if (site?.origin === origin) await GZ_SITE.handBack(site);
        siteSaid(t('Removed {site}. Glaze no longer runs there.', { site: host }));
        $('#heading-backup-sites').focus({ preventScroll: true });
      });
      const li = document.createElement('li');
      li.append(name, remove);
      return li;
    }));
    $('#site-empty').hidden = sites.size > 0;
  };
  // Add a site, the first screen's way (lib/site.js allow): the browser's prompt from the submit itself, then the check;
  // a course site is listed with its LMS, anything else has its grant handed back, with the course sites nearby to pick.
  // Where Glaze holds every site (Safari), a school's own site is added from its pages' card instead.
  const addForm = $('#site-add'), addInput = $('#site-address'), addGo = $('#site-allow');
  addForm.hidden = !!chrome.runtime.getManifest().host_permissions?.includes('<all_urls>');
  let adding = false;
  const addSaid = (text = '', hosts = []) => {
    $('#site-error').textContent = text;
    $('#site-picks').replaceChildren(...hosts.map((h) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: h });
      b.setAttribute('translate', 'no');
      b.addEventListener('click', (e) => { if (!e.isTrusted || adding) return; addInput.value = h; addSite(GZ_SITE.address(h)); });
      return b;
    }));
    $('#site-note').hidden = !text;
  };
  const addSite = (site) => {
    adding = true;
    addInput.readOnly = true;
    addGo.setAttribute('aria-busy', 'true');
    addSaid();
    siteSaid('');
    GZ_SITE.allow(site, { checking: () => siteSaid(t('Checking {host}', { host: site.host })) }).then((r) => {
      adding = false;
      addInput.readOnly = false;
      addGo.removeAttribute('aria-busy');
      siteSaid(r.state === 'done' ? t('Allowed {host}', { host: site.host }) : '');
      if (r.state === 'done') { addInput.value = ''; addInput.focus(); return; }
      if (r.state === 'refused') { addInput.focus(); return; }
      addSaid(t(r.state === 'none' ? 'No course site at {host}' : "Can't reach {host}", { host: site.host }), r.hosts);
      ($('#site-picks').children[0] || addInput).focus();
    });
  };
  addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!e.isTrusted || adding) return;
    const site = GZ_SITE.address(addInput.value);
    if (!site) { addSaid(t('Not a web address')); return; }
    addSite(site);
  });
  addInput.addEventListener('input', () => addSaid());
  const readSites = () => chrome.storage.local.get(Object.keys(KINDS), renderSites);
  readSites();
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && Object.keys(KINDS).some((k) => k in c)) readSites(); });

  for (const button of $$('[data-reset-setting]')) {
    const control = $$('[data-key]').find((el) => el.dataset.key === button.dataset.resetSetting);
    button.setAttribute('aria-label', t('Reset {name}', { name: control?.closest('label')?.querySelector('span')?.textContent || button.dataset.resetSetting }));
    button.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const path = button.dataset.resetSetting, touched = GZ_EDITOR.reset(s, [path], defaultsHere());
    fill(); save(touched);
    });
  }
  // A Look's own navigation layout and page tweaks are parts of the Look (lib/editor-xparts.js), not settings: the section's
  // Reset takes that part out of the Look, as its own button does, and can be undone.
  const LOOK_PART = { 'look/nav-layout': 'nav', 'look/rules': 'rules' };
  const LOOK_PARTS = { 'look/pointer': ['pointer', 'cursor'], 'look/motion': ['anim', 'fx', 'type'] };
  for (const button of $$('[data-reset-section]')) button.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    if (button.dataset.resetSection === 'sharing/relay') return resetRelay();
    const part = LOOK_PART[button.dataset.resetSection];
    if (part) {
      const was = s.parts;
      if (!was?.x?.[part]) return hint(t('Section reset. Your local data is kept.'));
      leaving();
      s.parts = GZ_XEDIT.put(was, part, null);
      refresh();
      save(['parts'], false, [part]);
      return hint(t('Section reset. Your local data is kept.'), false, () => { s.parts = was; refresh(); save(['parts'], false, [part]); });
    }
    const section = button.closest('[data-editor-section]'), paths = GZ_EDITOR.keys(section);
    const touched = GZ_EDITOR.reset(s, paths, defaultsHere());
    if (touched.includes('nav')) for (const key of paths.filter((p) => p.startsWith('nav.') && !['nav.i', 'nav.li'].includes(p))) pendingNav.add(key.slice(4));
    fill(); save(touched); hint(t('Section reset. Your local data is kept.'));
  });
  const resetScope = new Map($$('[data-reset-section]').map((b) => [b, GZ_EDITOR.keys(b.closest('[data-editor-section]'))]));
  const navDiffers = (keys) => keys.some((k) => JSON.stringify(s.nav[k]) !== JSON.stringify(GZ_DEFAULTS.nav[k]));
  showResets = () => {
    const defaults = defaultsHere();
    for (const [b, paths] of resetScope) {
      const route = b.dataset.resetSection, part = LOOK_PART[route];
      b.hidden = part ? !s.parts?.x?.[part] : route === 'sharing/relay' ? relayKept === defaultRelay : !GZ_EDITOR.differs(s, paths, defaults) && !LOOK_PARTS[route]?.some((key) => s.parts?.x?.[key]);
    }
    for (const b of $$('[data-reset-setting]')) b.hidden = !GZ_EDITOR.differs(s, [b.dataset.resetSetting], defaults);
    for (const b of $$('[data-nav-reset]')) {
      const g = b.dataset.navReset;
      b.hidden = g === 'layout' ? !navItems.order.length && !navItems.hidden.length : g === 'widgets' ? JSON.stringify(navItems.widgets) === JSON.stringify(N.clean().widgets) : !navDiffers(NAV_RESETS[g]);
    }
    $('#nav-reset').hidden = JSON.stringify(navItems) === JSON.stringify(N.clean()) && !navDiffers([...Object.keys(N.SPEC).filter((k) => k !== 'li'), 'labels', 'size', 'collapsed', 'logo']);
  };
  // Look parts builders (lib/editor-x*.js): they edit s.parts and save it like any other key. The pointer's cards
  // (lib/editor-pointer.js) are the student's, not the Look's: they save extras; its This Look's pointer edits s.parts.
  GZ_EDITOR_X.mount({ s, save: (...args) => { showResets(); save(...args); }, preview, t, frame, hint });
  $('#editor-version').textContent = `Glaze ${chrome.runtime.getManifest().version}`;
  GZ_PET_LIBRARY.mount($('#pet-library'), t);
  // Mods (lib/editor-mods.js): installed mods, adding one, its install prompt and dev mode.
  const widgets = GZ_WIDGETEDIT.mount({ t, show: (route) => editor.show(route, { scroll: true }) }); // widgets made of blocks (lib/editor-widget.js)
  navbarEditor = GZ_NAVBAREDIT.mount({ t, settings: () => s, hint }); // Glaze navigation's items (lib/editor-navbar.js)
  GZ_MODSEDIT.mount({ t, and: (list) => new Intl.ListFormat(GZ_I18N.locale(GZ_I18N.ui())).format(list), edit: widgets.edit, canEdit: widgets.canEdit,
    when: (at) => new Intl.DateTimeFormat(GZ_I18N.locale(GZ_I18N.ui()), { dateStyle: 'medium' }).format(at), show: (route) => editor.show(route, { scroll: true }) });
  // AI (lib/editor-ai.js): its switch, the connection, the features allowed to use it and the record of calls.
  GZ_AIEDIT.mount({ t, when: (at) => new Intl.DateTimeFormat(GZ_I18N.locale(GZ_I18N.ui()), { dateStyle: 'medium', timeStyle: 'short' }).format(at),
    pct: (x) => GZ_I18N.pct(Math.round(x * 100), GZ_I18N.ui()) });
  followSection(editor.route(), editor.part());

  // Opening the editor wakes the mod blocklist check, which asks only if one is due (lib/blocklist.js).
  try { chrome.runtime.sendMessage({ type: 'glaze:blocklist' }, () => void chrome.runtime.lastError); } catch { /* no worker */ }

  // Report a problem: a GitHub issue filled in here with the version, browser and system (lib/widgets.js feedback).
  $('#report-link').href = GZ_WIDGETS.feedback({ version: chrome.runtime.getManifest().version, ua: navigator.userAgent, lang: navigator.language });

  fill();
});
