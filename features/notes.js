// Notes (Canvas and Blackboard Ultra, enhance.notes, off by default; the same switch as the Dashboard notes tile), loaded on demand: a notes
// app over the page, like Insights. Opened from the command palette (Notes, New note, Course notes), the Dashboard notes
// tile, a course card's create menu, a Course notes button on a course's home (features/notes-home.js, which the worker
// registers only while Notes is on, calls home; on Ultra, content-ultra.js's pass calls sync on a course outline) and a
// class reminder. On Ultra, links come from the course's content (the public contents API: titles and links only). It
// opens only for the student's own click or key
// (the event that chose Notes is handed to open, through any loading on the way), and each of its controls acts only on
// one: every listener checks its own event (isTrusted), so a control a page script moves out of the view and clicks does
// nothing; typing and submitting also need the user activation a real click or key gives. While it is open, what it
// shows is part of the page, as anything on screen is. Folders (per course or free-standing),
// rich text, pictures and attachments, links to the course's Canvas files, pages and module items, search, sort and
// filter, a trash kept 30 days, and export (one note as Markdown or HTML; everything as a zip) and import of that zip.
// What it keeps is written by the service worker's queue ('glaze:notesapp', lib/notes.js run): the library's index in
// storage.local, bodies and files in the extension's own IndexedDB. Nothing goes in the school page's storage, and
// nothing leaves the device: the only requests are read-only GETs to the student's own Canvas when they pick a link.
// Every HTML that enters the editor (a paste, a drop, a load) and every save goes through lib/notes.js's sanitizer.
// Loaded on demand: a second injection keeps the first.
var GZ_NOTES_UI = globalThis.GZ_NOTES_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false && k !== '')); return e; };
  const attr = (e, o) => { for (const [k, v] of Object.entries(o)) e.setAttribute(k, v); return e; };
  const alive = (s = ctx.settings()) => ctx.on() && s.enabled !== false && !!s.enhance.notes;
  const activated = () => navigator.userActivation?.isActive ?? true;
  // The student's own action: an event the browser made from a real click or key (a page script's are isTrusted false).
  // Typing and submitting also need the activation a real click or key gives (a script can make the browser type).
  const real = (e) => !!e?.isTrusted;
  const typed = (e) => real(e) && activated();
  const libs = () => ctx.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT).then(() => ctx.need('lib/notes.js', () => globalThis.GZ_NOTES));
  const uuid = () => crypto.randomUUID();
  const lang = () => GZ_I18N.locale(ctx.locale());
  const mb = (n) => (n >= 2 ** 30 ? `${GZ_I18N.num(Math.round(n / 2 ** 30 * 10) / 10, ctx.locale())} GB` : `${GZ_I18N.num(Math.max(0.1, Math.round(n / 2 ** 20 * 10) / 10), ctx.locale())} MB`);
  const day = (ms) => new Date(ms).toLocaleDateString(lang(), { month: 'short', day: 'numeric', ...(new Date(ms).getFullYear() !== new Date().getFullYear() && { year: 'numeric' }) });
  const when = (ms) => new Date(ms).toLocaleString(lang(), { dateStyle: 'medium', timeStyle: 'short' });
  let N = null; // lib/notes.js
  let me = null; // { key, uid }
  const send = (m) => new Promise((res) => {
    try { chrome.runtime.sendMessage({ type: 'glaze:notesapp', key: me?.key, ...m }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); }
  });
  // A storage read that worked (an empty one too), or null.
  const get = (keys) => new Promise((res) => {
    try { chrome.storage.local.get(keys, (r) => res(chrome.runtime?.lastError || !r || typeof r !== 'object' ? null : r)); } catch { res(null); }
  });
  const download = (blob, name) => {
    const a = make('a', { href: URL.createObjectURL(blob), download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };
  const ERR = {
    big: "That's too big for a note.", many: 'Too many notes or folders in this account. Empty the trash or delete some first.',
    full: 'Not enough room on this device for that.', type: 'Glaze keeps pictures as PNG, JPEG, GIF or WebP. Add other files as attachments.',
    gone: 'That was deleted in another tab.',
  };
  const fail = (r) => t(ERR[r?.error] || "Couldn't save. Try again in a moment.");

  // ---- the Course notes button on a course's home -----------------------------------------------------------------
  // The button shows when the stored switches say Glaze and Notes are on (on a course's home, Glaze runs whenever it is on:
  // Keep quizzes light never applies there); it doesn't wait for the page's own copy of the settings, or for Glaze to
  // finish starting on the page. Opening still needs both (alive). want: the last answer, for a redraw in new words.
  let want = false;
  const shows = (s) => s.enabled !== false && !!s.enhance.notes;
  // Ultra: a course outline's right column (aside.outline-actions) gets a block of its own at its end, below Ultra's
  // details and Glaze's Better To Do (B0's anchors).
  const ultra = ctx.site === 'ultra';
  const sync = (on = want) => {
    want = on;
    const here = on && ctx.solo && (ultra ? /^\/ultra\/courses\/_\d+_\d+\/outline/ : /^\/courses\/\d+\/?$/).test(location.pathname);
    const side = here && document.querySelector(ultra ? 'aside.outline-actions' : '#course_show_secondary');
    let b = document.getElementById('gz-nt-course');
    if (!side) (ultra ? document.getElementById('gz-nt-block') : b)?.remove();
    else {
      if (!b) { b = make('button', { type: 'button', id: 'gz-nt-course', className: ultra ? 'gz-nt-course' : 'btn button-sidebar-wide' }); b.addEventListener('click', (e) => open({ course: courseHere(), event: e })); }
      if (b.lastChild?.textContent !== t('Course notes')) b.replaceChildren(attr(make('i', { className: 'icon-document' }), { 'aria-hidden': 'true' }), ' ', t('Course notes'));
      if (ultra) {
        let block = document.getElementById('gz-nt-block');
        if (!block) block = make('div', { id: 'gz-nt-block', className: 'outline-action-block' });
        if (b.parentNode !== block) block.append(b);
        if (side.lastElementChild !== block) side.append(block);
      } else {
        const last = [...side.querySelectorAll('a.button-sidebar-wide')].pop();
        if (last ? b.previousElementSibling !== last : b.parentNode !== side) { if (last) last.after(b); else side.prepend(b); }
      }
    }
    if (!on) box?.close();
  };
  ctx.wordsIn?.add(() => sync());
  // The course-home hook (features/notes-home.js), which the worker also puts into a course home already open when Notes
  // is turned on: the switches are read from storage now. A change that comes while that read is on its way supersedes
  // it (seen), so an older answer can't bring the button back after Notes was turned off.
  let seen = 0;
  const home = () => {
    const my = ++seen;
    return new Promise((res) => { try { chrome.storage.sync.get(['enabled', 'enhance'], (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } })
      .then((r) => { if (my === seen) sync(!!r && shows(GZ_SANITIZE(r))); }); // a failed read fails closed
  };
  // Switched off (or on) in another tab or the editor: both switches read afresh from storage, never one of them from the
  // page's own copy of the settings, which may not have caught up (a change names only the item that changed).
  try {
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && (ch.enhance || ch.enabled)) home(); });
  } catch { /* extension reloaded */ }
  // Ultra's reader (lib/ultra.js): what the notes app asks of Blackboard goes only through it.
  const reader = (o = {}) => ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.read({ origin: location.origin, ...o }));
  const courseHere = () => location.pathname.match(ultra ? /^\/ultra\/courses\/(_\d+_\d+)/ : /^\/courses\/(\d+)/)?.[1] || '';

  // ---- the view ----------------------------------------------------------------------------------------------------
  // gen: the view's current opening; anything that finishes for an older one draws nothing. noteGen: the note shown.
  let box = null, opener = null, gen = 0, noteGen = 0, shareSurface = null;
  let idx = null, courses = [];
  const view = { trash: false, course: '', folder: '*', sort: 'at', q: '', found: null };
  let cur = null; // the note in the editor: { id, rev, title, folder, course, cn, ro, saved, sid, copy, busy, tries, wait, urls }
  let el = {}; // the view's parts
  const stop = (my) => my !== gen || !box || !alive();
  const say = (s) => { if (el.say) el.say.textContent = s || ''; };

  // event: the click or key that chose Notes (the course button, the palette, a tile, a card's menu, a reminder).
  const open = async ({ course = '', create = false, event } = {}) => {
    if (!real(event) || !activated()) return;
    if (box) { if (create) newNote(course); else if (course) { view.course = course; view.trash = false; drawLib(); } return el.title?.focus(); }
    if (!alive()) return;
    const my = ++gen;
    try {
      await libs();
      N = globalThis.GZ_NOTES;
      // Ultra: the student's id (/users/me) and their courses (memberships), through lib/ultra.js's reader.
      const [p, list] = ultra ? await reader().then(async (r) => { const id = await r.me(); return [{ id }, await r.memberships(id).catch(() => [])]; })
        .then(([p, ms]) => [p, ms.filter((m) => m?.course).map((m) => ({ id: m.courseId, name: ctx.nickOf(m.courseId) || m.course.name }))])
        : await Promise.all([ctx.profile(), ctx.canvasCourses().catch(() => [])]);
      if (!(ultra ? /^_\d+_\d+$/ : /^\d+$/).test(String(p?.id))) throw new Error('no profile');
      me = { uid: String(p.id), key: N.storeKey(location.origin, String(p.id)) };
      courses = list.filter((c) => c?.id && c.name).map((c) => ({ id: String(c.id), name: c.friendly_name || c.name }));
      const got = await get(me.key);
      if (!got) throw new Error('storage');
      idx = N.clean(got[me.key]);
    } catch { return; }
    if (my !== gen || box || !alive()) return;
    Object.assign(view, { trash: false, course, folder: '*', q: '', found: null });
    build();
    opener = document.activeElement;
    document.body.append(box);
    box.showModal();
    const sharedBox = box;
    ctx.need('features/sharing.js', () => globalThis.GZ_SHARING_UI).then(() => { if (box === sharedBox) shareSurface = GZ_SHARING_UI.surface(); }).catch(() => {});
    drawLib();
    if (create) newNote(course); else drawEmpty();
    (create ? el.title : el.search).focus();
    send({ op: 'tidy' }).then(usage);
  };

  const close = () => box?.close();
  // Glaze's own click on its hidden file fields (to open the browser's file picker), let through the filter below.
  let ours = null;
  const pickFile = (input) => { ours = input; try { input.click(); } finally { ours = null; } };
  const button = (text, run, props = {}) => { const b = make('button', { type: 'button', textContent: text, ...props }); b.addEventListener('click', (e) => { if (real(e)) run(e); }); return b; };
  const select = (label, opts, value, onChange, cls = '') => {
    const s = make('select', {}, ...opts.map(([v, text]) => make('option', { value: v, textContent: text, selected: v === value })));
    s.addEventListener('change', (e) => { if (real(e)) onChange(s.value); });
    return make('label', { className: `gz-nt-field ${cls}`.trim() }, make('span', { textContent: label }), s);
  };

  const build = () => {
    el = {};
    el.say = make('p', { className: 'gz-nt-say', role: 'status' });
    el.search = make('input', { type: 'search', placeholder: t('Search notes'), autocomplete: 'off', spellcheck: false });
    el.search.setAttribute('aria-label', t('Search notes'));
    let searchWait = 0;
    el.search.addEventListener('input', (e) => {
      if (!typed(e)) return;
      view.q = el.search.value;
      view.found = null;
      drawList();
      clearTimeout(searchWait);
      const q = view.q, my = gen;
      if (N.terms(q).some((w) => w.length > 1)) searchWait = setTimeout(() => send({ op: 'search', q }).then((r) => { if (my === gen && view.q === q && r?.ok) { view.found = new Set(r.ids); drawList(); } }), 250);
    });
    el.filters = make('div', { className: 'gz-nt-filters' });
    el.count = make('p', { className: 'gz-nt-count', role: 'status' });
    el.list = make('ul', { className: 'gz-nt-list' });
    el.folders = make('div', { className: 'gz-nt-folders' });
    el.trash = button('', () => { view.trash = !view.trash; view.folder = '*'; drawLib(); if (!view.trash) drawEmpty(); else drawTrash(); });
    el.usage = make('p', { className: 'gz-nt-usage' });
    el.ask = make('div', { className: 'gz-nt-ask', hidden: true });
    el.ed = make('section', { className: 'gz-nt-ed' });
    el.ed.setAttribute('aria-label', t('Note'));
    el.file = make('input', { type: 'file', multiple: true, hidden: true });
    el.file.addEventListener('change', (e) => { if (!real(e)) return; const f = [...el.file.files]; el.file.value = ''; addFiles(f); });
    const lib = make('nav', { className: 'gz-nt-lib' }, el.search, el.filters, el.count, el.list, el.folders, make('div', { className: 'gz-nt-row' }, el.trash), el.usage);
    lib.setAttribute('aria-label', t('Library'));
    box = make('dialog', { id: 'gz-nt' },
      make('header', { className: 'gz-nt-head' },
        make('h2', { id: 'gz-nt-title', tabIndex: -1, textContent: t('Notes') }),
        make('div', { className: 'gz-nt-row' },
          button(t('New note'), () => newNote(view.course !== '-' ? view.course : '')),
          button(t('New folder'), newFolder),
          button(t('Share sessions'), () => chrome.runtime.sendMessage({ type: 'glaze:sessions-open' }).catch(() => {})),
          button(t('Export all'), exportAll),
          button(t('Import'), exportAll),
          button(t('Close'), close))),
      el.say, el.ask, make('div', { className: 'gz-nt-main' }, lib, el.ed), el.file);
    attr(box, { role: 'dialog', 'aria-labelledby': 'gz-nt-title' });
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    // Keys typed here are the view's: Canvas's own page shortcuts (n, e, d, r… on the document) would swallow letters
    // typed in a note. Glaze's own (Ctrl/⌘+K, g then a letter) listen before this and stand down in a dialog.
    for (const ev of ['keydown', 'keypress', 'keyup']) box.addEventListener(ev, (e) => e.stopPropagation());
    // A second line of defence (each listener also checks its own event): a click, key, change, paste or drop the page's
    // scripts fake is stopped here, before anything of Glaze's acts on it; so are typing and a submit the browser makes
    // for a script (execCommand, requestSubmit) without the student's own recent click or key. Glaze's own edits mark
    // the note changed themselves (exec).
    for (const ev of ['click', 'keydown', 'keypress', 'change', 'paste', 'drop', 'dragstart', 'input', 'beforeinput', 'submit']) {
      box.addEventListener(ev, (e) => {
        if (e.target === ours || (e.isTrusted && (!['input', 'beforeinput', 'submit'].includes(e.type) || activated()))) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      }, true);
    }
    // Esc closes a question first, then the view.
    box.addEventListener('cancel', (e) => { if (!el.ask.hidden) { e.preventDefault(); el.ask.dispatchEvent(new Event('gz-cancel')); } });
    box.addEventListener('close', () => {
      shareSurface?.(); shareSurface = null;
      flush();
      gen++; noteGen++;
      pick?.abort();
      for (const u of cur?.urls?.values() || []) URL.revokeObjectURL(u);
      cur = null;
      box?.remove(); box = null; el = {};
      document.removeEventListener('selectionchange', linkBar);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    document.addEventListener('selectionchange', linkBar);
  };

  // A question inside the view instead of the browser's prompt: a text field, or a choice of buttons. → the answer, or
  // null when cancelled.
  const ask = (label, { value = '', choices = null, type = 'text' } = {}) => new Promise((res) => {
    if (!el.ask.hidden) el.ask.dispatchEvent(new Event('gz-cancel')); // one question at a time: the last one asked
    const back = document.activeElement;
    const form = make('form', { className: 'gz-nt-form' });
    const done = (v) => { el.ask.hidden = true; el.ask.replaceChildren(); el.ask.removeEventListener('gz-cancel', cancel); if (back?.isConnected) back.focus({ preventScroll: true }); res(v); };
    const cancel = () => done(null);
    el.ask.addEventListener('gz-cancel', cancel);
    if (choices) {
      form.append(make('p', { textContent: label }), make('div', { className: 'gz-nt-row' }, ...choices.map(([v, text]) => button(text, () => done(v))), button(t('Cancel'), cancel)));
    } else {
      const input = make('input', { type, value, required: true, autocomplete: 'off' });
      form.append(make('label', { className: 'gz-nt-field' }, make('span', { textContent: label }), input), make('div', { className: 'gz-nt-row' }, make('button', { type: 'submit', textContent: t('OK') }), button(t('Cancel'), cancel)));
      form.addEventListener('submit', (e) => { e.preventDefault(); if (typed(e)) done(input.value.trim() || null); });
    }
    el.ask.replaceChildren(form);
    el.ask.hidden = false;
    form.querySelector('input, button').focus();
  });

  // ---- the library -------------------------------------------------------------------------------------------------
  const courseName = (id, cn) => courses.find((c) => c.id === id)?.name || cn || t('Course {id}', { id });
  const courseOpts = () => {
    const known = new Map(courses.map((c) => [c.id, c.name]));
    for (const x of [...Object.values(idx.notes), ...Object.values(idx.folders)]) if (x.course && !known.has(x.course)) known.set(x.course, courseName(x.course, x.cn));
    return [...known].sort((a, b) => a[1].localeCompare(b[1], lang()));
  };
  const folderName = (id) => idx.folders[id]?.name || '';
  const drawLib = () => {
    if (!box) return;
    const live = N.folderList(idx);
    if (view.folder !== '*' && view.folder !== '' && !live.some(([id]) => id === view.folder)) view.folder = '*';
    el.filters.replaceChildren(...(view.trash ? [] : [
      select(t('Course'), [['', t('All courses')], ['-', t('No course')], ...courseOpts()], view.course, (v) => { view.course = v; drawList(); }),
      select(t('Folder'), [['*', t('All folders')], ['', t('No folder')], ...live.map(([id, f]) => [id, f.name])], view.folder, (v) => { view.folder = v; drawList(); }),
      select(t('Sort'), [['at', t('Last edited')], ['created', t('Created')], ['title', t('Title')]], view.sort, (v) => { view.sort = v; drawList(); }),
    ]));
    const binned = N.list(idx, { trash: true }).length + N.folderList(idx, { trash: true }).length;
    el.trash.textContent = view.trash ? t('Back to notes') : t('Trash ({n})', { n: binned });
    el.trash.setAttribute('aria-pressed', String(view.trash));
    drawFolders(live);
    drawList();
  };
  const drawList = () => {
    if (!box) return;
    const focusId = document.activeElement?.closest?.('.gz-nt-list [data-id]')?.dataset.id;
    const rows = N.list(idx, { ...view, course: view.trash ? '' : view.course, folder: view.trash ? '*' : view.folder });
    el.count.textContent = t('Notes: {n}', { n: GZ_I18N.num(rows.length, ctx.locale()) });
    el.list.replaceChildren(...rows.map(([id, n]) => {
      const b = make('button', { type: 'button', className: 'gz-nt-item' },
        make('strong', { textContent: n.title || t('Untitled') }),
        make('small', { textContent: [n.course && courseName(n.course, n.cn), n.folder && folderName(n.folder), day(view.trash ? n.del : n.at)].filter(Boolean).join(' · ') }),
        n.ex && make('span', { textContent: n.ex }));
      b.dataset.id = id;
      if (cur?.id === id) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', (e) => { if (real(e)) openNote(id); });
      return make('li', {}, b);
    }));
    if (!rows.length) el.list.append(make('li', { className: 'gz-nt-none', textContent: t(view.trash ? 'The trash is empty.' : view.q ? 'No notes match.' : 'No notes here yet.') }));
    if (focusId) el.list.querySelector(`[data-id="${focusId}"]`)?.focus();
  };
  const drawFolders = (live) => {
    const binned = N.folderList(idx, { trash: true });
    const rows = view.trash ? binned : live;
    const had = el.folders.contains(document.activeElement) && document.activeElement.getAttribute('aria-label');
    el.folders.replaceChildren(...(rows.length ? [make('h3', { textContent: t(view.trash ? 'Folders in the trash' : 'Folders') }),
      make('ul', {}, ...rows.map(([id, f], i) => make('li', {},
        make('span', { textContent: [f.name, f.course && courseName(f.course, f.cn)].filter(Boolean).join(' · ') }),
        make('span', { className: 'gz-nt-tools' }, ...(view.trash ? [
          button(t('Restore'), () => send({ op: 'restore', ids: [id] }).then((r) => say(r?.ok ? t('Restored.') : fail(r))), { ariaLabel: t('Restore {name}', { name: f.name }) }),
          button(t('Delete forever'), () => purge([id], f.name), { ariaLabel: t('Delete {name} forever', { name: f.name }) }),
        ] : [
          button(t('Rename'), () => renameFolder(id), { ariaLabel: t('Rename {name}', { name: f.name }) }),
          button('↑', () => moveFolder(id, -1), { ariaLabel: t('Move {name} up', { name: f.name }), disabled: i === 0 }),
          button('↓', () => moveFolder(id, 1), { ariaLabel: t('Move {name} down', { name: f.name }), disabled: i === rows.length - 1 }),
          button(t('Delete'), () => deleteFolder(id), { ariaLabel: t('Delete {name}', { name: f.name }) }),
        ])))))] : []));
    if (had) [...el.folders.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === had && !b.disabled)?.focus();
  };
  const newFolder = async () => {
    const name = await ask(t('Folder name'));
    if (!name) return;
    const course = view.course && view.course !== '-' ? view.course : '';
    const r = await send({ op: 'folder', id: uuid(), name, course, cn: course && courseName(course) });
    say(r?.ok ? t('Folder “{name}” made.', { name }) : fail(r));
  };
  const renameFolder = async (id) => {
    const name = await ask(t('Folder name'), { value: folderName(id) });
    if (name) { const r = await send({ op: 'folder', id, name }); if (!r?.ok) say(fail(r)); }
  };
  const moveFolder = (id, by) => {
    const ids = N.folderList(idx).map(([x]) => x);
    const i = ids.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    send({ op: 'order', ids }).then((r) => { if (!r?.ok) say(fail(r)); });
  };
  const deleteFolder = async (id) => {
    const name = folderName(id);
    const n = Object.values(idx.notes).filter((x) => x.folder === id && !x.del).length;
    const choice = n ? await ask(t('Delete the folder “{name}”? It has notes in it: {n}.', { name, n }), { choices: [['keep', t('Keep its notes, with no folder')], ['trash', t('Move its notes to the trash too')]] })
      : await ask(t('Delete the folder “{name}”?', { name }), { choices: [['keep', t('Delete')]] });
    if (!choice) return;
    const r = await send({ op: 'folderDel', id, notes: choice });
    say(r?.ok ? t('Moved to the trash. It stays there for 30 days.') : fail(r));
  };
  const purge = async (ids, name) => {
    if (!await ask(t('Delete “{name}” for good? This can’t be undone.', { name: name || t('Untitled') }), { choices: [['yes', t('Delete forever')]] })) return;
    const r = await send({ op: 'purge', ids });
    say(r?.ok ? t('Deleted.') : fail(r));
    if (r?.ok && ids.includes(cur?.id)) drawTrash();
    usage();
  };
  const usage = () => send({ op: 'usage' }).then((r) => {
    if (!r?.ok || !el.usage) return;
    el.usage.textContent = [t('Notes on this device: {size}', { size: mb(r.mine) }), t('Pictures and files, all accounts: {size} of {limit}', { size: mb(r.files), limit: mb(r.limit) }),
      r.quota && t("Glaze's storage on this device: {used} of {quota}", { used: mb(r.usage), quota: mb(r.quota) })].filter(Boolean).join(' · ');
  });

  // Another tab, or this one, changed the library.
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !box || !me || !ch[me.key]) return;
      idx = N.clean(ch[me.key].newValue);
      drawLib();
      if (!cur) return;
      const n = idx.notes[cur.id];
      if (!cur.ro && (!n || n.del) && cur.rev > 0 && clean()) { say(t('That note went to the trash in another tab.')); drawEmpty(); return; }
      if (n && n.rev !== cur.rev && !cur.busy && clean()) openNote(cur.id, true);
      else if (n && !cur.ro) {
        Object.assign(cur, { folder: n.folder, course: n.course, cn: n.cn });
        if (document.activeElement !== el.title && el.title && el.title.value !== n.title) { cur.title = n.title; el.title.value = n.title; }
        syncMeta(n);
      }
    });
  } catch { /* extension reloaded */ }

  // ---- the editor --------------------------------------------------------------------------------------------------
  const drawEmpty = () => {
    flush();
    noteGen++;
    revoke();
    cur = null;
    el.ed.replaceChildren(make('div', { className: 'gz-nt-empty' }, make('p', { textContent: t('Choose a note, or start a new one.') }), button(t('New note'), () => newNote(view.course !== '-' ? view.course : ''))));
    drawList();
  };
  const drawTrash = () => {
    drawEmpty();
    const n = N.list(idx, { trash: true }).length + N.folderList(idx, { trash: true }).length;
    el.ed.replaceChildren(make('div', { className: 'gz-nt-empty' }, make('p', { textContent: t('Notes and folders in the trash are deleted for good after 30 days.') }),
      n ? button(t('Empty trash'), emptyTrash) : null));
  };
  const emptyTrash = async () => {
    const at = Date.now();
    if (!await ask(t('Delete everything in the trash for good? This can’t be undone.'), { choices: [['yes', t('Empty trash')]] })) return;
    const r = await send({ op: 'empty', at });
    say(r?.ok ? t('The trash is empty.') : fail(r));
    usage();
  };
  const revoke = () => { for (const u of cur?.urls?.values() || []) URL.revokeObjectURL(u); };
  // Leaving a note: what's typed goes now (kept with the note, in case a save of it is still on its way).
  const flush = () => { if (cur && !cur.ro && cur.saved != null && el.body?.isConnected) { cur.pending = serialize(); save(cur); } };
  const clean = () => !el.body?.isConnected || serialize() === cur.saved;
  const snapshot = (c) => (c === cur && el.body?.isConnected && c.saved != null ? serialize() : c.pending);
  // The editor's HTML as it is stored: sanitized, pictures by their id only.
  const serialize = () => {
    const c = el.body.cloneNode(true);
    for (const img of c.querySelectorAll('img')) img.removeAttribute('src');
    return N.sanitize(c.innerHTML);
  };

  const TOOLS = [
    ['H2', 'Heading', () => block('h2')], ['H3', 'Subheading', () => block('h3')],
    ['B', 'Bold', () => exec('bold')], ['I', 'Italic', () => exec('italic')], ['U', 'Underline', () => exec('underline')], ['S', 'Strikethrough', () => exec('strikeThrough')],
    ['•', 'Bulleted list', () => exec('insertUnorderedList')], ['1.', 'Numbered list', () => exec('insertOrderedList')], ['☑', 'Checklist', () => checklist()],
    ['❝', 'Quote', () => block('blockquote')], ['{ }', 'Code', () => code()], ['⌫', 'Clear formatting', () => { exec('removeFormat'); exec('unlink'); block('p', true); }],
  ];
  const drawEditor = (n, ro) => {
    const title = make('input', { className: 'gz-nt-title', value: n.title || '', placeholder: t('Untitled'), readOnly: ro, maxLength: N.LIMIT.title });
    title.setAttribute('aria-label', t('Title'));
    title.addEventListener('input', (e) => { if (typed(e)) titleChanged(); });
    title.addEventListener('keydown', (e) => { if (real(e) && e.key === 'Enter') { e.preventDefault(); el.body.focus(); } });
    const body = make('div', { className: 'gz-nt-body' });
    attr(body, { role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('Note text'), spellcheck: 'true', contenteditable: 'false' });
    body.style.setProperty('--gz-nt-done', JSON.stringify(t('Done')));
    body.style.setProperty('--gz-nt-todo', JSON.stringify(t('Not done')));
    body.addEventListener('input', (e) => {
      if (!typed(e)) return;
      // A new checklist item starts unticked (the browser copies the ticked one Enter was pressed in).
      if (e.inputType === 'insertParagraph') { const li = closest('ul[data-check] > li'); if (inBody(li) && !li.textContent.trim()) li.removeAttribute('data-done'); }
      changed();
    });
    body.addEventListener('paste', onPaste);
    body.addEventListener('drop', onDrop);
    body.addEventListener('dragstart', () => { dragging = true; });
    body.addEventListener('dragend', () => { dragging = false; });
    body.addEventListener('keydown', onKey);
    body.addEventListener('click', onClick);
    const bar = make('div', { className: 'gz-nt-tools-bar' }, ...TOOLS.map(([glyph, name, run]) => {
      const b = button(glyph, run, { title: t(name) });
      b.setAttribute('aria-label', t(name));
      b.addEventListener('mousedown', (e) => e.preventDefault()); // the selection stays in the note
      return b;
    }), button(t('Link'), () => link(), { title: `${t('Link')} (${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}+K)` }),
    button(t(ultra ? 'Blackboard link' : 'Canvas link'), () => canvasPicker()), button(t('Picture or file'), () => { keepRange(); pickFile(el.file); }));
    attr(bar, { role: 'toolbar', 'aria-label': t('Formatting') });
    for (const b of bar.querySelectorAll('button')) b.addEventListener('mousedown', (e) => e.preventDefault());
    el.linkbar = make('div', { className: 'gz-nt-linkbar', hidden: true });
    const meta = make('div', { className: 'gz-nt-meta' });
    const actions = ro ? [button(t('Restore'), () => send({ op: 'restore', ids: [cur.id] }).then((r) => { say(r?.ok ? t('Restored.') : fail(r)); if (r?.ok) { view.trash = false; drawLib(); openNote(cur.id); } })),
      button(t('Delete forever'), () => purge([cur.id], cur.title))]
      : [button(t('Duplicate'), duplicate), button(t('Export as Markdown'), () => exportOne('md')), button(t('Export as HTML'), () => exportOne('html')), button(t('Move to trash'), trashNote)];
    el.ed.replaceChildren(...[title, meta, !ro && bar, !ro && el.linkbar, body, make('div', { className: 'gz-nt-row gz-nt-actions' }, ...actions)].filter(Boolean));
    Object.assign(el, { title, body, meta });
    syncMeta(n);
  };
  const syncMeta = (n) => {
    if (!el.meta || !cur) return;
    const ro = cur.ro;
    const live = N.folderList(idx);
    const sig = JSON.stringify([ro, cur.folder, cur.course, n.at, n.del, live.map(([id, f]) => [id, f.name]), courseOpts(), ctx.locale()]);
    if (el.meta.dataset.sig === sig) return;
    el.meta.dataset.sig = sig;
    const had = [...el.meta.querySelectorAll('select')].indexOf(document.activeElement);
    el.meta.replaceChildren(...(ro ? [make('span', { textContent: t('In the trash since {when}', { when: when(n.del) }) })] : [
      select(t('Folder'), [['', t('No folder')], ...live.map(([id, f]) => [id, f.name])], cur.folder, (v) => metaChange({ folder: v })),
      select(t('Course'), [['', t('No course')], ...courseOpts()], cur.course, (v) => metaChange({ course: v, cn: v && courseName(v) })),
      n.at ? make('span', { className: 'gz-nt-when', textContent: t('Edited {when}', { when: when(n.at) }) }) : null,
    ].filter(Boolean)));
    if (had >= 0) el.meta.querySelectorAll('select')[had]?.focus();
  };
  // A new note keeps its folder and course until its first save makes it.
  const metaChange = async (patch, c = cur) => {
    if (!c) return true;
    Object.assign(c, patch);
    if (!c.rev) return true;
    const r = await send({ op: 'meta', id: c.id, at: Date.now(), ...patch });
    if (!r?.ok) say(fail(r));
    return !!r?.ok;
  };
  let titleWait = 0;
  const titleChanged = () => {
    if (!cur || cur.ro) return;
    cur.title = el.title.value;
    clearTimeout(titleWait);
    const c = cur;
    titleWait = setTimeout(() => (c.rev ? metaChange({ title: c.title }, c) : save(c)), 500);
  };

  const newNote = (course = '') => {
    if (!box) return open({ course, create: true });
    flush();
    noteGen++;
    revoke();
    if (view.trash) { view.trash = false; drawLib(); }
    const folder = view.folder !== '*' ? view.folder : '';
    const c = course || idx.folders[folder]?.course || '';
    cur = { id: uuid(), rev: 0, title: '', folder, course: c, cn: c && courseName(c), ro: false, saved: '', urls: new Map() };
    drawEditor({ title: '', at: 0 }, false);
    el.body.setAttribute('contenteditable', 'true');
    cur.saved = serialize();
    drawList();
    el.title.focus();
  };
  const openNote = async (id, again = false) => {
    if (!again) flush();
    const g = ++noteGen;
    const n = idx.notes[id];
    if (!n) return;
    const keep = again && cur?.id === id ? { sel: el.body?.contains(document.activeElement) } : null;
    revoke();
    cur = { id, rev: n.rev, title: n.title, folder: n.folder, course: n.course, cn: n.cn, ro: !!n.del, saved: null, urls: new Map() };
    drawEditor(n, cur.ro);
    el.body.textContent = t('Loading…');
    drawList();
    const r = await send({ op: 'load', id });
    if (g !== noteGen || !box) return;
    // A note that can't be read stays closed: never an empty note that a save could write over the real one.
    if (!r?.ok) { el.body.textContent = t(r?.error === 'missing' ? "This note's text couldn't be found on this device." : "Couldn't open this note. Try again in a moment."); cur.saved = null; cur.ro = true; return; }
    cur.rev = r.rev;
    // Build from the sanitizer's allowlisted tree, without interpreting another HTML string.
    const node = (n) => {
      if (typeof n === 'string') return n;
      const e = attr(make(n.tag, {}, ...n.kids.map(node)), n.attrs);
      if (n.tag === 'a' && n.attrs.href) attr(e, { rel: 'noopener noreferrer', target: '_blank' });
      return e;
    };
    el.body.replaceChildren(...N.parse(r.html).kids.map(node));
    cur.saved = serialize();
    el.body.setAttribute('contenteditable', String(!cur.ro));
    if (keep?.sel) el.body.focus();
    say(again ? t('Updated from another tab.') : '');
    // Pictures: from the worker, shown through blob: addresses that go when the note does.
    for (const img of el.body.querySelectorAll('img[data-gz-file]')) {
      const fid = img.dataset.gzFile;
      send({ op: 'getFile', id: fid }).then((f) => {
        if (g !== noteGen || !f?.ok || f.kind !== 'image' || !img.isConnected) return;
        const u = URL.createObjectURL(new Blob([N.unb64(f.data)], { type: f.type }));
        cur.urls.set(`${fid}:${cur.urls.size}`, u);
        img.src = u;
      });
    }
  };

  // Saving: a moment after the last change, on leaving the note or the page, and when the view closes. One at a time;
  // a save that fails is tried again (three times, then on the next change), with the same id, so a save that landed
  // but whose answer was lost isn't made twice. Both tabs changed it: the worker keeps this text as a copy.
  const changed = () => {
    if (!cur || cur.ro || cur.saved == null) return;
    cur.tries = 0;
    clearTimeout(cur.wait);
    cur.wait = setTimeout(() => save(), 700);
  };
  const save = async (c = cur) => {
    if (!c || c.ro || c.saved == null) return true;
    clearTimeout(c.wait);
    const html = snapshot(c);
    if (html == null) return true;
    c.pending = html;
    if (c.busy) return c.inflight;
    if (c.rev ? html === c.saved : !html && !c.title.trim()) return true;
    if (html.length > N.LIMIT.body) { say(t("This note is too long to save. Split it into two notes.")); return false; }
    c.busy = true;
    c.sid ||= uuid();
    c.copy ||= uuid();
    let landed;
    c.inflight = new Promise((res) => { landed = res; });
    const r = await send({ op: 'save', id: c.id, base: c.rev, sid: c.sid, copy: c.copy, html, title: c.title, folder: c.folder, course: c.course, cn: c.cn,
      copyTitle: t('{title} (conflict copy)', { title: c.title.trim() || t('Untitled') }) });
    c.busy = false;
    landed(!!r?.ok);
    if (!r?.ok) {
      say(r?.error === 'big' ? t(ERR.big) : r?.error === 'many' ? t(ERR.many) : t("Couldn't save this note. It's still here, and Glaze will try again."));
      c.tries = (c.tries || 0) + 1;
      if (r?.error !== 'big' && r?.error !== 'many' && c.tries < 3) c.wait = setTimeout(() => save(c), 3000);
      return false;
    }
    c.sid = c.copy = null;
    c.tries = 0;
    if (r.conflict) {
      c.id = r.id;
      c.title = t('{title} (conflict copy)', { title: c.title.trim() || t('Untitled') });
      if (cur === c && el.title) el.title.value = c.title;
      say(t('This note was changed in another tab. What you typed here is kept as “{title}”.', { title: c.title }));
    }
    c.rev = r.rev;
    // Again: what's stored is an earlier attempt, not this text, so it goes once more.
    c.saved = r.again ? false : html;
    const next = snapshot(c);
    if (next != null && next !== c.saved) return save(c);
    return true;
  };
  // Until the open note's text and title are all stored (each save that lands may find more to send), or a save fails.
  const settle = async () => {
    const c = cur;
    if (!c || c.ro || c.saved == null) return true;
    clearTimeout(titleWait);
    if (c.rev && c.title !== idx.notes[c.id]?.title && !(await metaChange({ title: c.title }, c))) return false;
    if (el.body?.isConnected && cur === c) c.pending = serialize();
    for (let i = 0; i < 5; i++) {
      if (c.busy) await c.inflight;
      else if (snapshot(c) === c.saved || (!c.rev && !c.pending && !c.title.trim())) return true;
      else if (!(await save(c))) return false;
    }
    return snapshot(c) === c.saved;
  };
  addEventListener('pagehide', () => flush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  const trashNote = async () => {
    const c = cur;
    if (!c) return;
    if (!c.rev) { revoke(); cur = null; drawEmpty(); return; }
    flush();
    const r = await send({ op: 'trash', ids: [c.id] });
    say(r?.ok ? t('Moved to the trash. It stays there for 30 days.') : fail(r));
    if (r?.ok) { drawEmpty(); el.search.focus(); }
  };
  const duplicate = async () => {
    const c = cur;
    if (!c) return;
    const html = serialize();
    const id = uuid();
    const title = t('{title} (copy)', { title: c.title.trim() || t('Untitled') });
    const r = await send({ op: 'save', id, base: 0, sid: uuid(), copy: uuid(), html, title, folder: c.folder, course: c.course, cn: c.cn });
    if (!r?.ok) return say(fail(r));
    // The index as it is now (its change event may not have come yet), so the copy opens.
    const got = await get(me.key);
    if (!box) return;
    if (got) { idx = N.clean(got[me.key]); drawLib(); }
    openNote(r.id);
    say(t('Duplicated as “{title}”.', { title }));
  };

  // ---- formatting ----------------------------------------------------------------------------------------------------
  const exec = (cmd, value) => { if (!cur || cur.ro) return; el.body.focus(); document.execCommand(cmd, false, value); changed(); };
  const here = () => { const s = getSelection(); const n = s?.anchorNode; return n && el.body?.contains(n) ? (n.nodeType === 1 ? n : n.parentElement) : null; };
  const closest = (sel) => here()?.closest(sel);
  const inBody = (e) => e && el.body.contains(e) && e !== el.body;
  const block = (tag, force) => { const b = closest('h1, h2, h3, blockquote, pre, p, div'); exec('formatBlock', `<${!force && inBody(b) && b.tagName.toLowerCase() === tag ? 'p' : tag}>`); };
  const checklist = () => {
    const ul = closest('ul');
    if (inBody(ul) && ul.hasAttribute('data-check')) { ul.removeAttribute('data-check'); changed(); return; }
    if (!inBody(ul)) exec('insertUnorderedList');
    const now = closest('ul');
    if (inBody(now)) { now.setAttribute('data-check', 'true'); changed(); }
  };
  const tick = (li) => { if (li.dataset.done) li.removeAttribute('data-done'); else li.setAttribute('data-done', 'true'); changed(); };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const code = () => {
    const c = closest('code');
    if (inBody(c) && !c.closest('pre')) { c.replaceWith(...c.childNodes); changed(); return; }
    const s = getSelection();
    if (s && !s.isCollapsed && !String(s).includes('\n')) exec('insertHTML', `<code>${esc(String(s))}</code>`);
    else block('pre');
  };
  // Links: typed in the view's own question; a bare address gets https://. Only http(s) and mailto are kept.
  let range = null;
  const keepRange = () => { const s = getSelection(); range = s?.rangeCount && el.body?.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : null; };
  const putRange = () => { el.body.focus(); if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } range = null; };
  const link = async () => {
    if (!cur || cur.ro) return;
    keepRange();
    const a = closest('a');
    const v = await ask(t('Link address'), { value: inBody(a) && a.getAttribute('href') || '', type: 'text' });
    if (v == null) return;
    const href = N.safeUrl(/^[\w.+-]+:/.test(v) ? v : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? `mailto:${v}` : `https://${v}`);
    if (!href) return say(t('That isn’t a web or email address.'));
    putRange();
    if (inBody(a)) { a.setAttribute('href', href); changed(); } else if (getSelection().isCollapsed) exec('insertHTML', `<a href="${esc(href)}">${esc(v)}</a>&nbsp;`);
    else exec('createLink', href);
  };
  // Where the caret is in a link: its address and what can be done with it (the editor never follows a click).
  const linkBar = () => {
    if (!el.linkbar || !cur) return;
    const a = closest('a');
    if (!inBody(a)) { el.linkbar.hidden = true; return; }
    if (el.linkbar.dataset.for === (a.getAttribute('href') || a.dataset.gzFile) && !el.linkbar.hidden) return;
    el.linkbar.dataset.for = a.getAttribute('href') || a.dataset.gzFile;
    const file = a.dataset.gzFile;
    el.linkbar.replaceChildren(make('span', { textContent: file ? a.textContent : a.getAttribute('href') }),
      file ? button(t('Download'), () => fetchFile(file, a.textContent)) : button(t('Open'), () => openLink(a.getAttribute('href'))),
      file ? null : button(t('Edit link'), () => { const s = getSelection(); s.selectAllChildren(a); link(); }),
      button(t(file ? 'Remove attachment' : 'Remove link'), () => { a.replaceWith(...(file ? [] : a.childNodes)); changed(); el.linkbar.hidden = true; }));
    el.linkbar.hidden = false;
  };
  const openLink = (href) => { const u = N.safeUrl(href); if (u) window.open(u, '_blank', 'noopener,noreferrer'); };
  const fetchFile = async (id, name) => {
    const f = await send({ op: 'getFile', id });
    if (!f?.ok) return say(t("Couldn't find that file on this device."));
    // As bytes to save, never to show: an HTML or SVG file opened from a blob: address would run as the school's site.
    download(new Blob([N.unb64(f.data)], { type: 'application/octet-stream' }), f.name || name);
  };
  const onClick = (e) => {
    if (!real(e)) return;
    const li = e.target.closest('ul[data-check] > li');
    if (li && inBody(li) && !cur.ro) {
      const r = li.getBoundingClientRect(), rtl = (li.closest('[dir]')?.getAttribute('dir') || '') === 'rtl';
      if (rtl ? e.clientX > r.right - 28 : e.clientX < r.left + 28) { e.preventDefault(); tick(li); return; }
    }
    const a = e.target.closest('a');
    if (a && inBody(a) && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (a.dataset.gzFile) fetchFile(a.dataset.gzFile, a.textContent); else openLink(a.getAttribute('href')); }
  };
  // Keys: Ctrl/⌘+K a link, Ctrl/⌘+Enter ticks a checklist item. Bold, italic, underline and undo are the browser's own.
  // None of them reaches Canvas, the command palette or Glaze's g-shortcuts (they don't act inside a dialog or while typing).
  const onKey = (e) => {
    if (!real(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopPropagation(); link(); } else if (mod && e.key === 'Enter') {
      const li = closest('ul[data-check] > li');
      if (inBody(li)) { e.preventDefault(); tick(li); }
    }
  };

  // ---- paste, drop, pictures and attachments ---------------------------------------------------------------------------
  const onPaste = (e) => {
    if (!real(e) || !cur || cur.ro) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); keepRange(); addFiles(files); return; }
    const html = e.clipboardData?.getData('text/html');
    if (html) { e.preventDefault(); exec('insertHTML', N.sanitize(html, { base: location.href })); }
  };
  let dragging = false; // a drag that started in the note: the browser moves it
  const onDrop = (e) => {
    if (!real(e) || !cur || cur.ro || dragging) return;
    const files = [...(e.dataTransfer?.files || [])];
    const html = !files.length && e.dataTransfer?.getData('text/html');
    if (!files.length && !html) return;
    e.preventDefault();
    const at = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (at) { const s = getSelection(); s.removeAllRanges(); s.addRange(at); }
    keepRange();
    if (files.length) addFiles(files); else { putRange(); exec('insertHTML', N.sanitize(html, { base: location.href })); }
  };
  // Each file goes to the worker first, then into the note where the caret was: a picture shown from the file itself,
  // anything else as an attachment to download.
  const addFiles = async (files) => {
    const c = cur, g = noteGen;
    if (!c || c.ro) return;
    const tooBig = (kind) => say(t(kind === 'image' ? 'Pictures can be up to {size}.' : 'Attachments can be up to {size}.', { size: mb(N.LIMIT[kind]) }));
    for (const file of files) {
      // Checked before anything is read: a picture over its limit, anything over the attachments' limit.
      const pic = /^image\/(png|jpeg|gif|webp)$/.test(file.type);
      if (file.size > N.LIMIT.file || (pic && file.size > N.LIMIT.image)) { tooBig(pic ? 'image' : 'file'); continue; }
      let bytes;
      try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { say(t("Couldn't read {name}.", { name: file.name })); continue; }
      if (g !== noteGen || cur !== c || !box) return;
      const type = file.type.startsWith('image/') ? N.imageType(bytes) : null;
      const kind = type ? 'image' : 'file';
      if (bytes.length > N.LIMIT[kind]) { tooBig(kind); continue; }
      say(t('Adding {name}…', { name: file.name }));
      const id = uuid();
      const r = await send({ op: 'file', id, kind, name: file.name, data: N.b64(bytes), note: c.id });
      if (g !== noteGen || cur !== c || !box) return;
      if (!r?.ok) { say(r?.error === 'full' ? t('Not enough room: notes keep up to {size} of pictures and files on this device.', { size: mb(N.LIMIT.total) }) : fail(r)); continue; }
      putRange();
      if (kind === 'image') {
        exec('insertHTML', `<img data-gz-file="${id}" alt="${esc(file.name.replace(/\.[^.]+$/, ''))}">`);
        const u = URL.createObjectURL(new Blob([bytes], { type }));
        c.urls.set(id, u);
        for (const img of el.body.querySelectorAll(`img[data-gz-file="${id}"]`)) img.src = u;
      } else exec('insertHTML', `<a data-gz-file="${id}">${esc(file.name)}</a>&nbsp;`);
      keepRange();
      say('');
    }
    usage();
  };

  // ---- links to Canvas: the course's files, pages and module items ---------------------------------------------------
  // Read-only GETs to this Canvas site with the student's own session, paged (on this site only), never following a
  // redirect, and stopped when the picker or the view closes. Only the link and its title go in the note.
  let pick = null; // the picker's AbortController
  const getAll = async (path, signal) => {
    const out = [];
    let url = `${location.origin}/api/v1${path}`;
    for (let i = 0; url && i < 10; i++) {
      const r = await fetch(url, { credentials: 'same-origin', redirect: 'error', signal, headers: { accept: 'application/json+canvas-string-ids, application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
      if (Array.isArray(j)) out.push(...j);
      const next = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      try { url = next && new URL(next, location.origin).origin === location.origin ? new URL(next, location.origin).href : null; } catch { url = null; }
    }
    return out;
  };
  const canvasPicker = () => {
    if (!cur || cur.ro) return;
    keepRange();
    pick?.abort();
    el.ed.querySelector('.gz-nt-pick')?.remove();
    const ctl = (pick = new AbortController());
    let items = [], partial = false;
    const course = make('select', {}, ...courseOpts().map(([id, name]) => make('option', { value: id, textContent: name, selected: id === (cur.course || courseHere()) })));
    const kind = make('select', {}, ...[['file', t('Files')], ['page', t('Pages')], ['module', t('Modules')]].map(([v, text]) => make('option', { value: v, textContent: text })));
    const filter = make('input', { type: 'search', placeholder: t('Filter'), autocomplete: 'off' });
    filter.setAttribute('aria-label', t('Filter'));
    const status = make('p', { className: 'gz-nt-count', role: 'status' });
    const list = make('ul', { className: 'gz-nt-picks' });
    const done = () => { ctl.abort(); if (pick === ctl) pick = null; panel.remove(); el.body?.focus(); };
    const panel = make('div', { className: 'gz-nt-pick' },
      make('div', { className: 'gz-nt-row' }, make('label', { className: 'gz-nt-field' }, make('span', { textContent: t('Course') }), course),
        !ultra && make('label', { className: 'gz-nt-field' }, make('span', { textContent: t('Kind') }), kind), filter, button(t('Cancel'), done)),
      status, list);
    attr(panel, { role: 'group', 'aria-label': t(ultra ? 'Link to something in Blackboard' : 'Link to something in Canvas') });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } });
    const show = () => {
      const want = N.terms(filter.value);
      const rows = items.filter((l) => want.every((w) => N.fold(`${l.title} ${l.group || ''}`).includes(w))).slice(0, 200);
      list.replaceChildren(...rows.map((l) => {
        const b = button('', () => { done(); putRange(); exec('insertHTML', `<a href="${esc(l.href)}" data-gz-kind="${l.kind}">${esc(l.title)}</a>&nbsp;`); });
        b.append(make('span', { textContent: l.title }), l.group && make('small', { textContent: l.group }));
        return make('li', {}, b);
      }));
      status.textContent = items.length ? [t('Found: {n}', { n: GZ_I18N.num(rows.length, ctx.locale()) }), partial && t("Some of this course's content couldn't be listed.")].filter(Boolean).join(' ') : status.textContent;
    };
    const load = async () => {
      const cid = course.value, k = kind.value, my = gen;
      items = [];
      list.replaceChildren();
      if (!(ultra ? /^_\d+_\d+$/ : /^\d+$/).test(cid)) return;
      status.textContent = t('Loading…');
      try {
        const path = k === 'file' ? `/courses/${cid}/files?per_page=100&sort=updated_at&order=desc` : k === 'page' ? `/courses/${cid}/pages?per_page=100&sort=title`
          : `/courses/${cid}/modules?include[]=items&per_page=50`;
        // Ultra: the course's content items, whatever the Kind, through lib/ultra.js's reader (the public contents API, kept to
        // titles, parents and links; GET on this site, redirects refused, stopped with the picker).
        // Only what the student may open now (search's rule), and said when not all of it could be read.
        const u = ultra && await (await reader({ signal: ctl.signal })).contents(cid);
        const got = ultra ? N.ultraLinks(u.items, location.origin) : N.canvasLinks(k, await getAll(path, ctl.signal), location.origin, cid);
        if (ctl.signal.aborted || my !== gen || course.value !== cid || kind.value !== k) return;
        items = got;
        partial = ultra && !u.complete;
        status.textContent = items.length ? '' : [t('Nothing here you can open.'), partial && t("Some of this course's content couldn't be listed.")].filter(Boolean).join(' ');
        show();
      } catch {
        if (!ctl.signal.aborted && course.value === cid && kind.value === k) status.textContent = t(ultra ? "Couldn't read that from Blackboard." : "Couldn't read that from Canvas.");
      }
    };
    course.addEventListener('change', (e) => { if (real(e)) load(); });
    kind.addEventListener('change', (e) => { if (real(e)) load(); });
    filter.addEventListener('input', show);
    el.ed.querySelector('.gz-nt-tools-bar')?.after(panel);
    filter.focus();
    load();
  };

  // ---- export and import ---------------------------------------------------------------------------------------------
  const dataUrl = (f) => `data:${f.type};base64,${f.data}`;
  const exportOne = async (as) => {
    if (!cur || !el.body?.isConnected) return;
    // A snapshot first: the note can be switched or the view closed while its pictures are read.
    const html = serialize(), title = cur.title.trim() || t('Untitled');
    const imgs = new Map();
    for (const id of N.refs(html)) { const f = await send({ op: 'getFile', id }); if (f?.ok && f.kind === 'image') imgs.set(id, dataUrl(f)); }
    const name = title.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, '_').replace(/[. ]+$/, '').slice(0, 120).trim() || 'note';
    if (as === 'md') download(new Blob([`# ${title}\n\n${N.markdown(html, { path: (id) => imgs.get(id) || null })}\n`], { type: 'text/markdown' }), `${name}.md`);
    else {
      const page = `<!doctype html>\n<html lang="${esc(ctx.locale())}"><meta charset="utf-8"><title>${esc(title)}</title>\n<style>body{font:16px/1.55 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}img{max-width:100%}pre{overflow:auto;background:#f4f4f5;padding:.75rem}ul[data-check]{list-style:none;padding-inline-start:1.2rem}ul[data-check] li::before{content:"☐ "}ul[data-check] li[data-done]::before{content:"☑ "}</style>\n<h1>${esc(title)}</h1>\n${N.sanitize(html, { src: (id) => imgs.get(id) })}\n</html>\n`;
      download(new Blob([page], { type: 'text/html' }), `${name}.html`);
    }
  };
  // Keys must never enter an LMS world's blob URL. Export all is confirmed and built on Glaze's own page.
  const exportAll = async () => {
    if (!(await settle())) return say(t("Couldn't save the open note, so nothing was exported. Try again in a moment."));
    try { await chrome.runtime.sendMessage({ type: 'glaze:sessions-open', key: me.key }); }
    catch { say(t('Could not finish. Your local copies are kept. Try again.')); }
  };

  return { sync, home, open, isOpen: () => !!box };
})();

GZ_NOTES_UI;
