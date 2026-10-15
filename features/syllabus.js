// Syllabus import (W15), loaded on demand: content.js (syncSyl) on a course's home and Syllabus page while
// enhance.syllabus is on, and the command palette's "Import a syllabus" on any page of a course. A syllabus (Canvas's own
// Syllabus page as it's shown, a PDF, a picture or screenshot (also pasted), a Word, PowerPoint, web page or text file,
// or pasted text) is read on this device by lib/syllabus.js (features/import.js for files), shown for review with every
// field editable and the line it came from (a line read from a picture the OCR engine wasn't sure of marks a guess), and
// kept only when the student saves: in storage.local per Canvas site, user and course, through the worker
// ('glaze:syllabus'). On save the scale can become the course's in the GPA (sync gpaCourses), the dates can become the
// student's own To Do tasks ('glaze:todo'); the professor, class times and dates show on the course home, the weights
// beside the what-if calculator (features/grades.js). Nothing is sent anywhere.
// On Blackboard Ultra (content-ultra.js syncSyl), which has no syllabus tool: on a course's outline, in its right-hand
// column, with a document of the course's own (its text from the public content API, lib/ultra.js) in place of Canvas's
// Syllabus page; kept per Ultra site, user and course, the scale for the course's GPA (ultra:<origin>/<id>).
var GZ_SYL_UI = globalThis.GZ_SYL_UI || (() => {
  const X = globalThis.GZ_CTX;
  const { t, locale, need } = X;
  const ultra = X.site === 'ultra';
  const cidHere = () => (ultra ? X.courseId() : X.canvasCourseId());
  let L = null; // lib/syllabus.js
  let on = false, starting = null, failedAt = 0;
  let who = null; // { uid, cid, key, course }
  let rec = null; // what is kept for this course, or null
  let dlg = null, opener = null;
  let reading = null; // the AbortController of a PDF or picture being read: another step or closing the dialog calls it off

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false && k !== '')); return e; };
  const attr = (el, a) => { for (const [k, v] of Object.entries(a)) el.setAttribute(k, v); return el; };
  const lang = () => GZ_I18N.locale(locale());
  const store = (area) => { try { return chrome.storage[area]; } catch { return null; } };
  const get = (area, k) => new Promise((res) => { try { store(area).get(k, (r) => res(chrome.runtime.lastError ? undefined : r?.[k])); } catch { res(undefined); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const page = () => document.getElementById('course_syllabus');
  // Canvas's Syllabus page as the student sees it, its tables kept as rows (lib/doctext.js).
  const pageText = () => (page()?.textContent.trim() ? globalThis.GZ_DOCTEXT.html(page().innerHTML) : '');
  const docIn = () => need('lib/doctext.js', () => globalThis.GZ_DOCTEXT);

  // ---- formatting -------------------------------------------------------------------------------------------------
  const dayName = (d, style = 'short') => new Intl.DateTimeFormat(lang(), { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + L.DAYS.indexOf(d)));
  const clock = (hm) => new Intl.DateTimeFormat(lang(), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(Date.UTC(2000, 0, 1, +hm.slice(0, 2), +hm.slice(3)));
  const when = (m) => `${m.days.map((d) => dayName(d)).join(', ')} ${clock(m.start)}–${clock(m.end)}`;
  const dayText = (day) => new Intl.DateTimeFormat(lang(), { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
  // Numeric dates in the syllabus are month first where the page's language writes them so (US English).
  const monthFirst = () => { const p = new Intl.DateTimeFormat(lang()).formatToParts(new Date(2026, 10, 22)).map((x) => x.type); return p.indexOf('month') < p.indexOf('day'); };
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  // ---- who and what -----------------------------------------------------------------------------------------------
  const start = async () => {
    // W14's day and time reader first: the extractor reads class times with it.
    await need('lib/classes.js', () => globalThis.GZ_CLASSES);
    await need('lib/syllabus.js', () => globalThis.GZ_SYLLABUS);
    L = globalThis.GZ_SYLLABUS;
    const cid = cidHere();
    // Ultra: you are the course list's user; the course's term (its start dates the syllabus's) is lib/ultra.js's reading.
    if (ultra) await need('lib/ultra.js', () => globalThis.GZ_ULTRA);
    const mem = ultra && await X.myCourses();
    const [p, list] = ultra ? [{ id: mem.find((m) => m?.courseId === cid)?.userId }, Object.entries(GZ_ULTRA.courses(mem)).map(([id, c]) => ({ ...c, id }))]
      : await Promise.all([X.profile(), X.canvasCourses()]);
    if (!cid || !(ultra ? /^_\d+_\d+$/ : /^\d+$/).test(String(p?.id))) throw new Error('no course or profile');
    const course = list.find((c) => String(c.id) === cid) || null;
    who = { uid: String(p.id), cid, key: L.key(location.origin, String(p.id), cid), course };
    rec = L.tidy(await get('local', who.key));
  };
  const ready = () => {
    if (who && who.cid === cidHere()) return Promise.resolve();
    if (!starting || (failedAt && Date.now() - failedAt > 60000)) {
      failedAt = 0;
      starting = start().catch((e) => { failedAt = Date.now(); throw e; });
    }
    return starting;
  };
  try {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local' || !who || !ch[who.key]) return;
      rec = L.tidy(ch[who.key].newValue);
      draw(true);
    });
  } catch { /* extension reloaded */ }

  // ---- on the course's pages --------------------------------------------------------------------------------------
  // Kept: a card on the course home's sidebar (or above the syllabus). Nothing kept: one quiet line above Canvas's
  // Syllabus, where there is one; nowhere else.
  const where = () => {
    // Ultra: a block of its own in the outline's right-hand column, under Ultra's details and actions.
    const aside = ultra && document.querySelector('aside.outline-actions');
    if (aside) { const d = aside.querySelector('.js-details-and-actions'); return (b) => (d ? d.after(b) : aside.append(b)); }
    if (ultra) return null;
    const side = document.getElementById('course_show_secondary');
    if (rec && side && side.offsetParent !== null) return (b) => side.prepend(b);
    const syl = page();
    if (syl) return (b) => syl.before(b);
    const home = rec && document.getElementById('course_home_content');
    return home ? (b) => home.prepend(b) : null;
  };
  let drawn = '';
  const draw = (force) => {
    const old = document.getElementById('gz-syl');
    const place = on && who && X.on() && where();
    if (!place) { old?.remove(); drawn = ''; return; }
    const sig = `${JSON.stringify(rec)} ${locale()} ${!!page()}`;
    if (old && !force && sig === drawn) return;
    drawn = sig;
    const box = rec ? card() : bar();
    const f = old?.contains(document.activeElement) && document.activeElement.dataset.f;
    old?.remove();
    place(box);
    if (f) box.querySelector(`[data-f="${f}"]`)?.focus();
  };
  const button = (text, f, run, cls = '') => { const b = make('button', { type: 'button', className: `gz-syl-btn ${cls}`.trim(), textContent: text }); b.dataset.f = f; b.addEventListener('click', run); return b; };
  const bar = () => {
    const box = make('section', { id: 'gz-syl', className: `gz-syl-bar${ultra ? ' outline-action-block' : ''}` },
      make('p', { textContent: ultra ? t('Glaze can read a syllabus into this course, your GPA and To Do. It stays on this device.') : t('Glaze can read this syllabus into your course home, GPA and To Do. It stays on this device.') }),
      make('div', { className: 'gz-syl-actions' },
        page()?.textContent.trim() && button(t('Read this syllabus'), 'read', () => fromPage()),
        button(ultra ? t('Import a syllabus') : t('Use a file or text'), 'file', () => open())));
    return attr(box, { 'aria-label': t('Syllabus import') });
  };
  const card = () => {
    const r = rec;
    const rows = [];
    const row = (name, ...dd) => rows.push(make('dt', { textContent: name }), ...dd.map((x) => make('dd', {}, x)));
    const p = r.prof;
    if (p.name || p.email || p.office) {
      row(t('Professor'), make('span', {}, p.name, p.name && p.email ? ' · ' : '', p.email && make('a', { href: `mailto:${p.email}`, textContent: p.email })), ...(p.office ? [p.office] : []));
    }
    if (r.hours.length || p.note) row(t('Office hours'), ...r.hours.map((m) => [when(m), m.location].filter(Boolean).join(' · ')), ...(p.note ? [p.note] : []));
    if (r.meetings.length) row(t('Class times'), ...r.meetings.map((m) => [m.label, when(m), m.location].filter(Boolean).join(' · ')));
    const next = r.dates.filter((d) => d.day >= today()).sort((a, b) => a.day.localeCompare(b.day)).slice(0, 4);
    if (next.length) row(t('Coming up'), ...next.map((d) => `${dayText(d.day)} · ${d.title}`));
    if (r.weights.length) row(t('Weights'), L.weightsText(r.weights));
    if (r.scale.length) row(t('Grading scale'), r.scale.map(([l, v]) => `${l} ${v}`).join(', '));
    const h = make('h2', { id: 'gz-syl-h', tabIndex: -1, textContent: t('From your syllabus') });
    const box = make('section', { id: 'gz-syl', className: `gz-syl-card${ultra ? ' outline-action-block' : ''}` }, h, make('dl', {}, ...rows),
      make('div', { className: 'gz-syl-actions' }, button(t('Edit'), 'edit', () => open(r)), button(t('Delete'), 'delete', remove)));
    return attr(box, { 'aria-labelledby': 'gz-syl-h' });
  };
  const remove = async () => {
    if (!confirm(t('Delete what Glaze kept from this syllabus? Your GPA scale and To Do tasks stay.'))) return;
    const r = await send({ type: 'glaze:syllabus', key: who.key, rec: null, at: Date.now() });
    if (r?.ok) { rec = null; draw(true); document.querySelector('#gz-syl button')?.focus(); }
  };

  // ---- reading ----------------------------------------------------------------------------------------------------
  const fromPage = () => open(null, true);
  // ocr: what came from a picture (features/import.js); a field from a line the OCR engine wasn't sure of is a guess too.
  const extract = (text, ocr) => {
    const c = who.course;
    const startAt = Date.parse(c?.term?.start_at || c?.start_at || '');
    const r = L.extract(text, { start: Number.isFinite(startAt) ? startAt : Date.now(), md: monthFirst(), hint: locale() });
    if (!ocr) return r;
    const d = (f) => (GZ_IMPORT.doubt(ocr, f.src) ? { ...f, conf: 'check' } : f);
    return { ...r, ocr, prof: Object.fromEntries(Object.entries(r.prof).map(([k, f]) => [k, d(f)])), hours: r.hours.map(d), meetings: r.meetings.map(d), dates: r.dates.map(d), scale: d(r.scale), weights: d(r.weights) };
  };

  // ---- the dialog -------------------------------------------------------------------------------------------------
  // Opens on the source step, on the review of what's kept (saved), or straight on a review of Canvas's own page.
  // Still wanted when the code it waited for arrives: Glaze on, the switch on, still in that course.
  const allowed = (cid) => X.on() && X.settings().enabled !== false && !!X.settings().enhance.syllabus && !!cid && cidHere() === cid;
  const open = async (saved, usePage) => {
    const cid = cidHere();
    if (!allowed(cid)) return;
    try { await ready(); } catch { return; }
    if (usePage) await docIn().catch(() => {});
    if (!allowed(cid)) return;
    opener = document.activeElement;
    dlg?.close();
    dlg = attr(make('dialog', { id: 'gz-syl-dlg' }), { 'aria-labelledby': 'gz-syl-title' });
    dlg.addEventListener('close', () => { reading?.abort(); dlg?.remove(); dlg = null; if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    if (saved) review(fromSaved(saved), '');
    else if (usePage && globalThis.GZ_DOCTEXT) { const text = pageText(); review(extract(text), text); }
    else source();
    dlg.showModal();
  };
  const frame = (title, ...kids) => {
    reading?.abort();
    const close = attr(make('button', { type: 'button', className: 'gz-syl-x', textContent: '×' }), { 'aria-label': t('Close') });
    close.addEventListener('click', () => dlg.close());
    dlg.replaceChildren(make('div', { className: 'gz-syl-in' }, make('div', { className: 'gz-syl-top' }, make('h2', { id: 'gz-syl-title', textContent: title }), close), ...kids));
  };
  const status = () => attr(make('p', { className: 'gz-syl-status' }), { role: 'status' });

  const source = () => {
    const say = status();
    const file = make('input', { type: 'file', id: 'gz-syl-file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.pptx,.html,.htm,.txt,.md,application/pdf,image/*' });
    const paste = make('textarea', { id: 'gz-syl-paste', rows: 8 });
    const stop = button(t('Stop reading'), 'stop', () => reading?.abort());
    stop.hidden = true;
    // pasted: a screenshot pasted into the text box, read instead of what's typed there.
    const go = async (pasted) => {
      const f = pasted instanceof File ? pasted : file.files[0];
      // Only the newest read is wanted: one still under way is called off, and says nothing more.
      reading?.abort();
      say.textContent = t('Reading…');
      const ctl = reading = new AbortController();
      stop.hidden = false;
      try {
        let text = paste.value, ocr = null;
        if (f) {
          await need('features/import.js', () => globalThis.GZ_IMPORT);
          ({ text, ocr } = await GZ_IMPORT.read(f, { signal: ctl.signal, progress: (s) => { say.textContent = s; } }));
        }
        if (ctl.signal.aborted) return;
        if (!text.trim()) { say.textContent = t('Choose a file or paste the text first.'); return; }
        review(extract(text, ocr), text);
      } catch (e) { if (reading === ctl) say.textContent = e?.cancelled ? t('Stopped.') : e?.mine ? e.message : t("Glaze couldn't read that file."); }
      finally { if (reading === ctl) { reading = null; stop.hidden = true; } }
    };
    paste.addEventListener('paste', (e) => {
      const img = e.isTrusted && [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (img && !reading) { e.preventDefault(); go(img); }
    });
    frame(t('Import a syllabus'),
      make('p', { className: 'gz-syl-desc', textContent: t('Glaze reads it on this device. Nothing is sent anywhere, and nothing is kept until you check it and save.') }),
      page()?.textContent.trim() && button(t("Read this course's Syllabus page"), 'page', async () => { await docIn().catch(() => {}); if (globalThis.GZ_DOCTEXT) { const text = pageText(); review(extract(text), text); } }),
      ultra && docPicker(say),
      make('div', { className: 'gz-syl-f' }, make('label', { htmlFor: 'gz-syl-file', textContent: t('A file') }), file,
        make('small', { textContent: t('A PDF, a picture or screenshot, Word, PowerPoint, a web page or text.') })),
      make('div', { className: 'gz-syl-f' }, make('label', { htmlFor: 'gz-syl-paste', textContent: t('Or paste the text, or a screenshot') }), paste),
      make('div', { className: 'gz-syl-actions' }, button(t('Read it'), 'go', () => go(), 'gz-syl-main'), stop, button(t('Cancel'), 'cancel', () => dlg.close())),
      say);
    first(file);
  };
  // Ultra: a document of the course's, read from the public content API (its text and its blocks'; reading it there marks
  // nothing as opened), listed once the dialog asks, syllabus-like titles first. Shown only when the course has one.
  const SYL = /syllab|course (outline|info)|programa|lehrplan|plan de cours|studiewijzer/i;
  const docPicker = (say) => {
    const box = make('div', { className: 'gz-syl-f', hidden: true });
    const cid = who.cid, mine = dlg;
    need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.read({ origin: location.origin, live: () => dlg === mine && allowed(cid) })
      .all(`/learn/api/public/v1/courses/${cid}/contents?recursive=true&limit=200&fields=id,parentId,title,body,contentHandler.id,availability.available`)).then((all) => {
      const avail = all.filter((c) => c?.availability?.available === 'Yes'); // not items held back from you (B0)
      const html = (d) => [d.body, ...avail.filter((c) => c.parentId === d.id).map((c) => c.body)].filter((b) => typeof b === 'string').join('\n');
      const isDoc = (c) => c?.contentHandler?.id === 'resource/x-bb-document';
      const pages = new Set(avail.filter(isDoc).map((c) => c.id));
      // A document's blocks are documents too: they're read as part of it, not listed.
      const docs = avail.filter((c) => isDoc(c) && !pages.has(c.parentId) && html(c).trim()).sort((a, b) => SYL.test(b.title) - SYL.test(a.title));
      if (!docs.length || !box.isConnected) return;
      const sel = make('select', { id: 'gz-syl-doc' }, ...docs.slice(0, 200).map((d, i) => make('option', { value: String(i), textContent: String(d.title || '').slice(0, 200) })));
      const read = async () => {
        await docIn().catch(() => {});
        const text = globalThis.GZ_DOCTEXT?.html(html(docs[+sel.value])) || '';
        if (!text.trim()) { say.textContent = t("Glaze couldn't read that file."); return; }
        review(extract(text), text);
      };
      box.append(make('label', { htmlFor: 'gz-syl-doc', textContent: t('A document in this course') }), sel, button(t('Read this document'), 'doc', read));
      box.hidden = false;
    }, () => {});
    return box;
  };
  // The step's first control has focus: as the dialog opens (autofocus), or now when it's open already.
  const first = (el) => { el.autofocus = true; if (dlg.open) el.focus(); };

  // What's kept, in the extractor's shape (no source lines, nothing to check).
  const F = (value) => ({ value, conf: '', src: '' });
  const fromSaved = (r) => ({ saved: true, prof: { name: F(r.prof.name), email: F(r.prof.email), office: F(r.prof.office), note: F(r.prof.note) },
    hours: r.hours, meetings: r.meetings, dates: r.dates, scale: F(r.scale), weights: F(r.weights) });

  let uid = 0;
  const id = () => `gz-syl-${++uid}`;
  // A field: its label, the value to correct, a "Check this" / "Not found" mark and the line it came from.
  const mark = (conf, empty, saved) => (saved ? '' : conf === 'check' ? t('Check this') : empty ? t('Not found') : '');
  const note = (input, conf, src, saved) => {
    const m = mark(conf, !src, saved);
    const tag = m && make('span', { id: id(), className: `gz-syl-conf${conf === 'check' ? ' gz-syl-check' : ''}`, textContent: m });
    const from = src && make('small', { id: id(), className: 'gz-syl-src', textContent: t('From: “{text}”', { text: src }) });
    const by = [tag?.id, from?.id].filter(Boolean).join(' ');
    if (by) input.setAttribute('aria-describedby', by);
    return [tag || '', from || ''];
  };
  const field = (label, input, f, saved) => {
    input.id = id();
    const [tag, from] = note(input, f.conf, f.src, saved);
    return make('div', { className: 'gz-syl-f' }, make('div', { className: 'gz-syl-lab' }, make('label', { htmlFor: input.id, textContent: label }), tag), input, from);
  };
  const text = (value, more = {}) => make('input', { type: 'text', value: value || '', ...more });
  const x = (name, run) => { const b = attr(make('button', { type: 'button', className: 'gz-syl-x', textContent: '×' }), { 'aria-label': t('Remove {name}', { name }) }); b.addEventListener('click', run); return b; };

  // A weekly time (class or office hours): label, days, start, end, where.
  const timeRow = (list, m, n, saved) => {
    const name = m.label || t('Time {n}', { n });
    const label = attr(text(m.label, { maxLength: 80, className: 'gz-syl-label' }), { 'aria-label': t('Name') });
    const days = attr(make('span', { className: 'gz-syl-days' }, ...L.DAYS.map((d) => make('label', { title: dayName(d, 'long') },
      attr(make('input', { type: 'checkbox', value: d, checked: m.days.includes(d) }), { 'aria-label': dayName(d, 'long') }), dayName(d, 'narrow')))), { role: 'group', 'aria-label': t('Days') });
    const from = attr(make('input', { type: 'time', value: m.start || '', className: 'gz-syl-start' }), { 'aria-label': t('Starts') });
    const to = attr(make('input', { type: 'time', value: m.end || '', className: 'gz-syl-end' }), { 'aria-label': t('Ends') });
    const loc = attr(text(m.location, { maxLength: 80, className: 'gz-syl-loc', placeholder: t('Where') }), { 'aria-label': t('Where') });
    const row = attr(make('div', { className: 'gz-syl-row' }), { role: 'group', 'aria-label': name });
    const [tag, src] = note(label, m.conf, m.src, saved || !m.src);
    row.append(label, days, from, '–', to, loc, x(name, () => { row.remove(); list.querySelector('input')?.focus(); }), tag, src);
    return row;
  };
  const dateRow = (list, d, n, saved, todo) => {
    const name = d.title || t('Date {n}', { n });
    const title = attr(text(d.title, { maxLength: 200, className: 'gz-syl-label' }), { 'aria-label': t('What') });
    const day = attr(make('input', { type: 'date', value: d.day || '' }), { 'aria-label': t('Date') });
    const kind = attr(make('select', {}, ...[['exam', 'Exam'], ['due', 'Due'], ['other', 'Other']].map(([v, k]) => make('option', { value: v, textContent: t(k), selected: d.kind === v }))), { 'aria-label': t('Kind') });
    const row = attr(make('div', { className: 'gz-syl-row gz-syl-date' }), { role: 'group', 'aria-label': name });
    const add = todo && make('label', { className: 'gz-syl-todo' }, make('input', { type: 'checkbox', className: 'gz-syl-task' }), ` ${t('Add to To Do')}`);
    const [tag, src] = note(title, d.conf, d.src, saved || !d.src);
    row.append(title, day, kind, add || '', x(name, () => { row.remove(); list.querySelector('input')?.focus(); }), tag, src);
    return row;
  };
  const rows = (legend, items, make1, blank) => {
    const list = make('div', { className: 'gz-syl-rows' });
    items.forEach((m, i) => list.append(make1(list, m, i + 1)));
    const add = button(t('Add'), '', () => { const r = make1(list, blank, list.children.length + 1); list.append(r); r.querySelector('input')?.focus(); });
    attr(add, { 'aria-label': `${t('Add')}: ${legend}` });
    return make('fieldset', { className: 'gz-syl-set' }, make('legend', { textContent: legend }), list, add);
  };

  const review = (r, read) => {
    const saved = !!r.saved;
    const p = r.prof;
    const say = status();
    const todo = !!X.settings().enhance.todo;
    const name = text(p.name.value, { maxLength: 100 });
    const email = text(p.email.value, { maxLength: 120, type: 'email' });
    const office = text(p.office.value, { maxLength: 120 });
    const hoursNote = text(p.note.value, { maxLength: 200 });
    const blank = { label: '', days: [], start: '', end: '', location: '' };
    const hours = rows(t('Office hours'), r.hours, (l, m, n) => timeRow(l, m, n, saved), blank);
    const meets = rows(t('Class times'), r.meetings, (l, m, n) => timeRow(l, m, n, saved), blank);
    const dates = rows(t('Important dates'), r.dates, (l, d, n) => dateRow(l, d, n, saved, todo), { title: '', day: '', kind: 'exam' });
    const scale = text(r.scale.value ? r.scale.value.map(([l, v]) => `${l} ${v}`).join(', ') : '', { maxLength: 300, placeholder: 'A 93, A- 90, B+ 87, …' });
    // Used for the GPA without asking only when it's sure: a guess, or ranges that overlap or leave gaps, wait for a tick.
    const issues = r.scale.issues || [];
    const useScale = make('input', { type: 'checkbox', checked: !!r.scale.value?.length && (saved || (r.scale.conf === 'sure' && !issues.length)) });
    const said = (i) => (i.kind === 'order' ? t("The letters aren't in order.") : t(i.kind === 'gap' ? 'Nothing covers the scores between {a} and {b}.' : '{a} and {b} overlap.', i));
    const scaleIssues = issues.length > 0 && make('p', { className: 'gz-syl-issues', textContent: `${t('Check the ranges:')} ${issues.map(said).join(' ')}` });
    // Weights that don't add up to 100 are shown as found, with what they add up to.
    const sum = r.weights.issues?.find((i) => i.kind === 'sum');
    const weightIssues = sum && make('p', { className: 'gz-syl-issues', textContent: t('These add up to {total}%, not 100%.', { total: sum.total }) });
    const cut = r.truncated && make('p', { className: 'gz-syl-issues', textContent: t('Only the first {n} characters were read. If something is missing, paste the part with the course details.', { n: L.MAX }) });
    const weights = text(L.weightsText(r.weights.value || []), { maxLength: 600, placeholder: t('Homework 20%, Exams 50%, …') });
    const save = async () => {
      say.textContent = '';
      for (const el of dlg.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
      const bad = (el, msg) => { el.setAttribute('aria-invalid', 'true'); el.focus(); say.textContent = msg; return null; };
      await need('lib/gradecalc.js', () => globalThis.GZ_GRADECALC).catch(() => {});
      const C = globalThis.GZ_GRADECALC;
      if (!C) { say.textContent = t('Not saved. Try again in a moment.'); return; }
      const sc = scale.value.trim() ? C.parseScheme(scale.value) : [];
      if (!sc) return bad(scale, t('Write a scale as letters and their lowest percent: A 93, A- 90, B+ 87.'));
      const ws = L.parseWeights(weights.value);
      if (!ws) return bad(weights, t('Write weights as names and percents: Homework 20%, Exams 50%.'));
      if (email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) return bad(email, t('That e-mail address looks wrong.'));
      const times = (set) => [...set.querySelectorAll('.gz-syl-row')].map((row) => ({ row, label: row.querySelector('.gz-syl-label').value, days: [...row.querySelectorAll('.gz-syl-days input:checked')].map((c) => c.value),
        start: row.querySelector('.gz-syl-start').value, end: row.querySelector('.gz-syl-end').value, location: row.querySelector('.gz-syl-loc').value }));
      const all = [...times(hours), ...times(meets)];
      const wrong = all.find((m) => !m.days.length || !m.start || !m.end || m.end <= m.start);
      if (wrong) return bad(wrong.row.querySelector(wrong.days.length ? '.gz-syl-start' : '.gz-syl-days input'), t('Give each time a day, a start and an end after it.'));
      const ds = [...dates.querySelectorAll('.gz-syl-row')].map((row) => ({ row, title: row.querySelector('.gz-syl-label').value.trim(), day: row.querySelector('input[type="date"]').value, kind: row.querySelector('select').value, task: !!row.querySelector('.gz-syl-task')?.checked }));
      const noDate = ds.find((d) => !d.title || !d.day);
      if (noDate) return bad(noDate.row.querySelector(noDate.title ? 'input[type="date"]' : '.gz-syl-label'), t('Give each date a name and a day.'));
      const strip = ({ row, ...m }) => m;
      const out = L.tidy({ prof: { name: name.value, email: email.value, office: office.value, note: hoursNote.value },
        hours: times(hours).map(strip), meetings: times(meets).map(strip), dates: ds.map(({ row, task, ...d }) => d), scale: sc, weights: ws, at: Date.now() });
      if (!out) { say.textContent = t('There is nothing to save.'); return; }
      const res = await send({ type: 'glaze:syllabus', key: who.key, rec: out, at: out.at });
      if (!res?.ok) { say.textContent = t('Not saved. Try again in a moment.'); return; }
      rec = L.tidy(res.rec);
      const notes = [];
      const scaleSaid = useScale.checked && sc.length ? await gpaScale(C, sc) : '';
      if (scaleSaid) notes.push(scaleSaid);
      const tasks = ds.filter((d) => d.task);
      if (tasks.length && !await addTasks(tasks)) notes.push(t('The dates could not be added to To Do.'));
      if (notes.length) { say.textContent = `${t('Saved.')} ${notes.join(' ')}`; return; }
      dlg.close();
      draw(true);
      document.getElementById('gz-syl-h')?.focus();
    };
    const back = !saved && button(t('Back'), 'back', () => source());
    frame(t(saved ? 'Edit your syllabus' : 'Check what Glaze found'),
      make('p', { className: 'gz-syl-desc', textContent: saved ? t('Change anything, then save. It stays on this device.')
        : t('Every field can be changed. "Check this" marks a guess, and the line each value came from is shown under it. Nothing is kept until you save.') }), cut,
      r.ocr && make('p', { className: 'gz-syl-issues', textContent: GZ_IMPORT.note(r.ocr) }),
      make('fieldset', { className: 'gz-syl-set' }, make('legend', { textContent: t('Professor') }),
        field(t('Name'), name, p.name, saved), field(t('E-mail'), email, p.email, saved), field(t('Office'), office, p.office, saved),
        field(t('Office hours, in words'), hoursNote, p.note, saved || !p.note.value)),
      hours, meets, dates,
      field(t('Grading scale'), scale, r.scale, saved), scaleIssues,
      make('label', { className: 'gz-syl-check-row' }, useScale, ` ${t('Use it for this course in your GPA')}`),
      field(t('Weights'), weights, r.weights, saved), weightIssues,
      make('small', { className: 'gz-syl-hint', textContent: ultra ? t("Shown beside the what-if calculator. Blackboard's own weights are the ones that count.") : t("Shown beside the what-if calculator. Canvas's own weights are the ones that count.") }),
      read && make('details', { className: 'gz-syl-read' }, make('summary', { textContent: t('The text Glaze read') }), make('pre', { textContent: read.slice(0, 20000) })),
      make('div', { className: 'gz-syl-actions' }, button(t('Save'), 'save', save, 'gz-syl-main'), back, button(t('Cancel'), 'cancel', () => dlg.close())),
      say);
    first(name);
  };

  // The scale becomes the course's own in the GPA's synced choices (gpaCourses), set by the worker for this course alone
  // on what is stored then ('glaze:gpa', which the GPA table uses too), so two courses saved at once both keep theirs.
  // → '' when it's in, else the words to show.
  const gpaScale = async (C, sc) => {
    const r = await send({ type: 'glaze:gpa', key: `${ultra ? 'ultra' : 'canvas'}:${location.origin}/${who.cid}`, patch: { s: C.schemeText(sc) } });
    return r?.ok ? '' : r?.error === 'full' ? t('Not saved: too many course settings are stored. Clear a course you no longer need.') : t('The scale could not be given to your GPA.');
  };
  // Dates become the student's own To Do tasks (lib/todo.js importTask), one id per date and title, so saving again updates
  // them and keeps whether they're done and their steps.
  const addTasks = async (list) => {
    const key = `todo:${location.origin}/${who.uid}`;
    const edits = list.map((d) => ['importTask', { id: L.taskId(who.cid, d), title: d.title, cid: who.cid, due: { day: d.day }, notes: t('From your syllabus'), done: 0, at: Date.now() }]);
    for (let i = 0; i < edits.length; i += 20) if (!(await send({ type: 'glaze:todo', key, edits: edits.slice(i, i + 20) }))?.ok) return false;
    return true;
  };

  // ---- switches ---------------------------------------------------------------------------------------------------
  const sync = (want) => {
    on = !!want;
    // Off this page's part, the dialog stays (Ctrl+K opens it on any course page); with Glaze or the switch off, it goes.
    if (!on) { draw(); if (!X.on() || X.settings().enabled === false || !X.settings().enhance.syllabus) dlg?.close(); return; }
    ready().then(() => draw(), () => {});
  };
  return { sync, open: () => open() };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_SYL_UI; else GZ_SYL_UI;
