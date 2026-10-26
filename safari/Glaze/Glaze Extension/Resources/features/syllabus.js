// Syllabus import (W15), loaded on demand: content.js (syncSyl) on a course's home and Syllabus page while
// enhance.syllabus is on, and the command palette's "Import a syllabus" on any page of a course. A syllabus (Canvas's own
// Syllabus page as it's shown, a PDF, a picture or screenshot (also pasted), a Word, PowerPoint, web page or text file,
// or pasted text) is read on this device by lib/syllabus.js (features/import.js for files), shown for review with every
// field editable and the line it came from (a line read from a picture the OCR engine wasn't sure of marks a guess), and
// kept only when the student saves: in storage.local per Canvas site, user and course, through the worker
// ('glaze:syllabus'). On save the scale can become the course's in the GPA (sync gpaCourses), the dates can become the
// student's own To Do tasks ('glaze:todo'); the professor, class times and dates show on the course home, the weights
// beside the what-if calculator (features/grades.js). Nothing is sent anywhere, unless the student has turned on AI for
// syllabus import (Settings → AI): then, after Glaze's own reading, the text (and a picture read, to a model that takes
// pictures) goes to their connection ('glaze:ai' port, lib/ai/tasks/syllabus-read.js), and what it reads is put beside
// Glaze's (lib/syllabus-ai.js), each value of it to check. The dialog says where an endpoint's text goes.
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
  let opened = null; // the course (who) the open dialog is for
  let reading = null; // the AbortController of a PDF or picture being read: another step or closing the dialog calls it off
  let asking = null; // the AbortController of AI's reading after it: Stop ends it alone, and the review shows Glaze's own

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
  // Who you are in which course: Ultra moves from course to course in one document, so each course is started on its own
  // (ready), an answer for a course the page has left is dropped, and every action keeps the course it began in.
  const start = async (cid) => {
    // W14's day and time reader first: the extractor reads class times with it.
    await need('lib/classes.js', () => globalThis.GZ_CLASSES);
    await need('lib/syllabus.js', () => globalThis.GZ_SYLLABUS);
    L = globalThis.GZ_SYLLABUS;
    // Ultra: you are the course list's user; the course's term (its start dates the syllabus's) is lib/ultra.js's reading.
    if (ultra) await need('lib/ultra.js', () => globalThis.GZ_ULTRA);
    const mem = ultra && await X.myCourses();
    const m = ultra && mem.find((x) => x?.courseId === cid);
    const [p, list] = ultra ? [{ id: m?.userId }, Object.entries(GZ_ULTRA.courses(mem)).map(([id, c]) => ({ ...c, id }))]
      : await Promise.all([X.profile(), X.canvasCourses()]);
    if (!cid || !(ultra ? /^_\d+_\d+$/ : /^\d+$/).test(String(p?.id))) throw new Error('no course or profile');
    const course = list.find((c) => String(c.id) === cid) || null;
    // The course's own dates (own: { known, start }), for week 1: Canvas's when they override the term; Ultra's kind from
    // the course list, a date range's start asked when needed (ownStart).
    const own = ultra ? GZ_ULTRA.ownDates(m?.course) : { known: true, start: course?.restrict_enrollments_to_course_dates ? Date.parse(course.start_at || '') : undefined };
    const w = { uid: String(p.id), cid, key: L.key(location.origin, String(p.id), cid), course, own };
    const kept = L.tidy(await get('local', w.key));
    if (cid !== cidHere()) throw new Error('another course now');
    [who, rec] = [w, kept];
  };
  const ready = () => {
    const cid = cidHere();
    if (who && who.cid === cid) return Promise.resolve();
    if (!starting || starting.cid !== cid || (failedAt && Date.now() - failedAt > 60000)) {
      failedAt = 0;
      starting = Object.assign(start(cid).catch((e) => { failedAt = Date.now(); throw e; }), { cid });
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
    // With the sidebar (features/sidebar.js) the column ends with its widgets: a block goes above them.
    if (aside) { const d = aside.querySelector('.js-details-and-actions'), end = [...aside.children].find((c) => c.id === 'gz-sb-widgets'); return (b) => (d ? d.after(b) : end ? end.before(b) : aside.append(b)); }
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
    const sig = `${who.cid} ${JSON.stringify(rec)} ${locale()} ${!!page()}`;
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
      make('div', { className: 'gz-syl-actions' }, button(t('Edit'), 'edit', () => open(r)), button(t('Delete'), 'delete', remove(who))));
    return attr(box, { 'aria-labelledby': 'gz-syl-h' });
  };
  const remove = (w) => async () => {
    if (!confirm(t('Delete what Glaze kept from this syllabus? Your GPA scale and To Do tasks stay.')) || w !== who) return;
    const r = await send({ type: 'glaze:syllabus', key: w.key, rec: null, at: Date.now() });
    if (r?.ok && w === who) { rec = null; draw(true); document.querySelector('#gz-syl button')?.focus(); }
  };

  // ---- reading ----------------------------------------------------------------------------------------------------
  const fromPage = () => open(null, true);
  // An instant → UTC midnight of its day here (lib/syllabus.js week1), or undefined.
  const dayOf = (ms) => { if (!Number.isFinite(ms)) return undefined; const d = new Date(ms); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  const options = (week1) => {
    const c = opened.course;
    const startAt = Date.parse(c?.term?.start_at || c?.start_at || '');
    // No start for a course with no term dates: the reader then places a year-less date by today, not as if today began the term.
    return { start: Number.isFinite(startAt) ? startAt : undefined, md: monthFirst(), hint: locale(), week1 };
  };
  // ocr: what came from a picture (features/import.js); a field from a line the OCR engine wasn't sure of is a guess too.
  // week1: the course's own first day, for dates by course week.
  const extract = (text, ocr, week1 = dayOf(opened.own.start)) => {
    const o = options(week1);
    const r = { ...L.extract(text, o), opts: o };
    if (!ocr) return r;
    const d = (f) => (GZ_IMPORT.doubt(ocr, f.src) ? { ...f, conf: 'check' } : f);
    return { ...r, ocr, prof: Object.fromEntries(Object.entries(r.prof).map(([k, f]) => [k, d(f)])), hours: r.hours.map(d), meetings: r.meetings.map(d), dates: r.dates.map(d), scale: d(r.scale), weights: d(r.weights), week1: r.week1.src ? d(r.week1) : r.week1 };
  };
  // Ultra: a course the course list doesn't say has no dates of its own, asked once (one GET of its public availability,
  // never contentDetail). → its date range's start (ms), or undefined; a failed ask is asked again next time.
  const ownStart = (w) => (w.own.known ? Promise.resolve(w.own.start)
    : (w.asking ||= GZ_ULTRA.read({ origin: location.origin }).get(`/learn/api/public/v3/courses/${w.cid}?fields=availability`)
      .then((j) => { w.own = { known: true, start: GZ_ULTRA.ownDates(j).start }; return w.own.start; }, () => { w.asking = null; return undefined; })));
  // p's answer, or undefined after 5 s; Stop or closing the dialog (signal) ends the wait as a cancelled read.
  const until = (p, signal) => new Promise((res, rej) => {
    const stop = () => rej(Object.assign(new Error('stopped'), { cancelled: true }));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener('abort', stop, { once: true });
    setTimeout(() => res(undefined), 5000);
    p.then(res);
  });
  // A text read, for review. On Ultra the course's own start is asked only when the text has dates by course week that
  // would otherwise count from the term, or from nothing at all.
  const reviewed = async (text, ocr, signal) => {
    const w = opened, r = extract(text, ocr);
    if (w.own.known || r.week1.from === 'text') return r;
    const weekly = r.week1.value || (!Number.isFinite(options().start) && L.extract(text, options(dayOf(Date.now()))).week1.from === 'course');
    if (!weekly) return r;
    const start = dayOf(await until(ownStart(w), signal));
    return Number.isFinite(start) ? extract(text, ocr, start) : r;
  };


  // ---- AI (docs/ai-harness.md) ------------------------------------------------------------------------------------
  // Asked only when storage.local ai says AI is on, a connection is chosen and syllabus import may use it; otherwise no
  // port is opened and the dialog is as without AI. One port a dialog, closed with it (which cancels a run).
  let port = null, asked = 0;
  const waits = new Map(); // message id → its answer's handler
  const aiOn = async () => { const s = await get('local', 'ai'); return !!s && s.on === true && typeof s.use === 'string' && !!s.use && s.features?.syllabus === true; };
  const hangUp = () => {
    const p = port;
    port = null;
    for (const w of waits.values()) w({ type: 'error', error: 'connection-lost' });
    waits.clear();
    try { p?.disconnect(); } catch { /* gone */ }
  };
  // → the answer that ends message m (its id: .id): a status, an end or an error. Events before it go to each(event).
  const ask = (m, each) => {
    const id = ++asked;
    return Object.assign(new Promise((resolve) => {
      waits.set(id, (a) => { if (['status', 'end', 'error'].includes(a?.type)) { waits.delete(id); resolve(a); } else each?.(a); });
      try {
        if (!port) {
          const p = port = chrome.runtime.connect({ name: 'glaze:ai' });
          p.onMessage.addListener((a) => waits.get(a?.id)?.(a));
          p.onDisconnect.addListener(() => { if (port === p) hangUp(); });
        }
        port.postMessage({ id, ...m });
      } catch { waits.delete(id); resolve({ type: 'error', error: 'failed' }); }
    }), { id });
  };
  // Where the text would go now: null (AI won't read), '' (this computer), or the endpoint's host.
  const aiWhere = async () => {
    if (!await aiOn()) return null;
    const st = await ask({ op: 'status', feature: 'syllabus' });
    return st.allowed && st.ready ? { to: typeof st.to === 'string' ? st.to : '', caps: st.caps || {} } : null;
  };
  // The dialog's line on where the text goes, kept to what it says (shown: '' for this computer).
  const privacy = (desc) => {
    desc.dataset.to = '';
    aiWhere().then((w) => { if (w?.to && desc.isConnected !== false) { desc.dataset.to = w.to; desc.textContent = t('Glaze reads it and sends the text to {host}. Nothing is kept until you check it and save.', { host: w.to }); } }, () => {});
  };
  // Pictures for a model that takes them: PNG, JPEG, WebP or GIF files, each at most 6 MB, 12 MB in all, eight at most.
  const MIME = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/gif', [0x47, 0x49, 0x46, 0x38]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];
  const pictures = async (files) => {
    const out = [];
    let size = 0;
    for (const f of files.slice(0, 8)) {
      let b;
      try {
        if (!(f.size <= 6 << 20)) continue;
        const h = new Uint8Array(await f.slice(0, 12).arrayBuffer());
        const mime = MIME.find(([, m]) => m.every((x, i) => h[i] === x))?.[0];
        if (!mime || (mime === 'image/webp' && String.fromCharCode(...h.subarray(8, 12)) !== 'WEBP')) continue;
        b = { mime, bytes: new Uint8Array(await f.arrayBuffer()) };
      } catch { continue; }
      const { mime, bytes } = b;
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = btoa(s);
      if ((size += data.length) > 12 << 20) break;
      out.push({ type: 'image', mime, data });
    }
    return out;
  };
  // Glaze's reading r, with AI's beside it when AI may read and still sends where the dialog said (shown). read: the read's
  // controller (a newer read or closing the dialog ends AI too); files: pictures read. → the result to review; when AI
  // didn't finish, Glaze's own with aiSaid, a few words on why.
  const withAI = async (r, text, { read, say, stop, shown = '', files = [] }) => {
    const w = await aiWhere().catch(() => null);
    if (!w || w.to !== shown || read.signal.aborted) return r;
    const ctl = asking = new AbortController();
    const off = () => ctl.abort();
    read.signal.addEventListener('abort', off, { once: true });
    say.textContent = t('Reading with AI…');
    if (stop) stop.hidden = false;
    let id = 0;
    // Stop: the broker is told, and the answer that may still come is no longer waited for.
    const cancelled = new Promise((resolve) => ctl.signal.addEventListener('abort', () => {
      if (id) { waits.delete(id); try { port?.postMessage({ id, op: 'cancel' }); } catch { /* gone */ } }
      resolve({ type: 'error', error: 'cancelled' });
    }, { once: true }));
    try {
      const names = [opened.course?.name, opened.course?.course_code].filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim().slice(0, 200));
      const input = { text: text.slice(0, L.MAX), images: w.caps.images === true ? await pictures(files) : [], names: [...new Set(names)] };
      if (ctl.signal.aborted) throw new Error('stopped');
      const run = ask({ op: 'run', feature: 'syllabus', task: 'syllabus.read', input });
      id = run.id;
      const end = await Promise.race([run, cancelled]);
      if (end.type !== 'end' || !end.output) throw Object.assign(new Error('ai'), { code: end.error });
      await need('lib/syllabus-ai.js', () => globalThis.GZ_SYLLABUS_AI);
      if (ctl.signal.aborted) throw new Error('stopped');
      return GZ_SYLLABUS_AI.merge(r, GZ_SYLLABUS_AI.interpret(end.output, r.opts, r, text));
    } catch (e) {
      return { ...r, aiSaid: ctl.signal.aborted ? t('Stopped.') : e?.code === 'size' ? t('That syllabus is too long for AI. This is what Glaze read.') : t("AI couldn't read it. This is what Glaze read.") };
    } finally {
      read.signal.removeEventListener('abort', off);
      if (asking === ctl) asking = null;
    }
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
    // Canvas's own page straight to its review, unless AI reads it too: then the first step shows it being read, with Stop.
    const aiPage = usePage && await aiOn().catch(() => false);
    if (!allowed(cid)) return;
    opener = document.activeElement;
    opened = who;
    dlg?.close();
    const box = (dlg = attr(make('dialog', { id: 'gz-syl-dlg' }), { 'aria-labelledby': 'gz-syl-title' }));
    // Its own close only: one closed as the next opens (close fires later) leaves the new one, its read and focus alone.
    box.addEventListener('close', () => { box.remove(); if (dlg !== box) return; reading?.abort(); asking?.abort(); hangUp(); dlg = null; if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
    if (saved) review(fromSaved(saved), '');
    else if (usePage && globalThis.GZ_DOCTEXT && !aiPage) { const text = pageText(); review(extract(text), text); }
    else source(aiPage && globalThis.GZ_DOCTEXT);
    dlg.showModal();
  };
  const frame = (title, ...kids) => {
    reading?.abort();
    const close = attr(make('button', { type: 'button', className: 'gz-syl-x', textContent: '×' }), { 'aria-label': t('Close') });
    close.addEventListener('click', () => dlg.close());
    dlg.replaceChildren(make('div', { className: 'gz-syl-in' }, make('div', { className: 'gz-syl-top' }, make('h2', { id: 'gz-syl-title', textContent: title }), close), ...kids));
  };
  const status = () => attr(make('p', { className: 'gz-syl-status' }), { role: 'status' });

  // pageNow: read Canvas's Syllabus page at once (the course page's own button, with AI on).
  const source = (pageNow) => {
    const say = status();
    const file = make('input', { type: 'file', id: 'gz-syl-file', accept: '.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.pptx,.html,.htm,.txt,.md,application/pdf,image/*' });
    const paste = make('textarea', { id: 'gz-syl-paste', rows: 8 });
    // Stop ends AI's reading alone while it reads (Glaze's own reading is then reviewed), else the file's.
    const stop = button(t('Stop reading'), 'stop', () => (asking ? asking.abort() : reading?.abort()));
    const desc = make('p', { className: 'gz-syl-desc', textContent: t('Glaze reads it on this device. Nothing is sent anywhere, and nothing is kept until you check it and save.') });
    privacy(desc);
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
        const r = await withAI(await reviewed(text, ocr, ctl.signal), text, { read: ctl, say, stop, shown: desc.dataset.to, files: f ? [f] : [] });
        if (ctl.signal.aborted) return;
        review(r, text);
      } catch (e) { if (reading === ctl) say.textContent = e?.cancelled ? t('Stopped.') : e?.mine ? e.message : t("Glaze couldn't read that file."); }
      finally { if (reading === ctl) { reading = null; stop.hidden = true; } }
    };
    paste.addEventListener('paste', (e) => {
      const img = e.isTrusted && [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (img && !reading) { e.preventDefault(); go(img); }
    });
    // Canvas's Syllabus page, as it's shown; with AI, read after Glaze's own reading like a file.
    const fromHere = async () => {
      await docIn().catch(() => {});
      if (!globalThis.GZ_DOCTEXT) return;
      const text = pageText();
      reading?.abort();
      const ctl = reading = new AbortController();
      try {
        const r = await withAI(extract(text), text, { read: ctl, say, stop, shown: desc.dataset.to });
        if (!ctl.signal.aborted) review(r, text);
      } finally { if (reading === ctl) { reading = null; stop.hidden = true; } }
    };
    frame(t('Import a syllabus'), desc,
      page()?.textContent.trim() && button(t("Read this course's Syllabus page"), 'page', fromHere),
      ultra && docPicker(say, stop, desc),
      make('div', { className: 'gz-syl-f' }, make('label', { htmlFor: 'gz-syl-file', textContent: t('A file') }), file,
        make('small', { textContent: t('A PDF, a picture or screenshot, Word, PowerPoint, a web page or text.') })),
      make('div', { className: 'gz-syl-f' }, make('label', { htmlFor: 'gz-syl-paste', textContent: t('Or paste the text, or a screenshot') }), paste),
      // Only the student's own click reads (a page's script could put a file of its own in the field and click).
      make('div', { className: 'gz-syl-actions' }, button(t('Read it'), 'go', (e) => { if (e.isTrusted) go(); }, 'gz-syl-main'), stop, button(t('Cancel'), 'cancel', () => dlg.close())),
      say);
    first(file);
    if (pageNow) fromHere();
  };
  // Ultra: a document of the course's, read from the public content API (a list of metadata and text, which [I] marks
  // nothing as opened: not measured), listed once the dialog asks, syllabus-like titles first. Shown only when the course
  // has one. A document is a page: a folder Ultra marks isBbPage (as Ultra writes them), or a document with documents in
  // it; its text sits in its blocks (its children), titled like it, "ultraDocumentBody" or anything, so it's listed by its
  // own title, the blocks read as part of it, in order. A block can be only a file's link (data-bbfile on /bbcswebdav/,
  // lib/page.js files()): on the student's click, never while listing, each such file is fetched with the session (Ultra
  // sends it on to its file store) and read by features/import.js, in its place among the blocks' text, with the read's
  // progress, Stop, and its end when the dialog closes, as a chosen file is. A file that can't be fetched or read is left
  // out; with nothing read at all, the reason (the last file's own, or that it couldn't be read). Only the student's own
  // click reads, as Read it.
  const SYL = /syllab|course (outline|info)|programa|lehrplan|plan de cours|studiewijzer/i;
  const docPicker = (say, stop, desc) => {
    const box = make('div', { className: 'gz-syl-f', hidden: true });
    const cid = opened.cid, mine = dlg;
    // Never contentDetail or the whole contentHandler: an LTI link keeps its tool's secret there (lib/ultra.js).
    need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.read({ origin: location.origin, live: () => dlg === mine && allowed(cid) })
      .all(`/learn/api/public/v1/courses/${cid}/contents?recursive=true&limit=200&fields=id,parentId,title,body,contentHandler.id,contentHandler.isBbPage,availability.available`)).then((all) => {
      const avail = all.filter((c) => c?.availability?.available === 'Yes'); // not items held back from you (B0)
      const html = (d) => [d.body, ...avail.filter((c) => c.parentId === d.id).map((c) => c.body)].filter((b) => typeof b === 'string').join('\n');
      const isDoc = (c) => c?.contentHandler?.id === 'resource/x-bb-document';
      const pages = new Set(avail.filter((c) => isDoc(c) || c?.contentHandler?.isBbPage === true).map((c) => c.id));
      const docs = avail.filter((c) => pages.has(c.id) && !pages.has(c.parentId) && html(c).trim()).sort((a, b) => SYL.test(b.title) - SYL.test(a.title));
      if (!docs.length || !box.isConnected) return;
      const sel = make('select', { id: 'gz-syl-doc' }, ...docs.slice(0, 200).map((d, i) => make('option', { value: String(i), textContent: String(d.title || '').slice(0, 200) })));
      const live = () => dlg === mine && mine.open && box.isConnected && allowed(cid);
      const read = async () => {
        const chosen = docs[+sel.value];
        if (!live() || !chosen) return;
        // One read at a time, as go()'s: a newer one, Stop, another step or closing the dialog calls this one off.
        reading?.abort();
        say.textContent = t('Reading…');
        const ctl = reading = new AbortController(), signal = ctl.signal;
        const check = () => { if (!live() || reading !== ctl) ctl.abort(); signal.throwIfAborted(); };
        stop.hidden = false;
        try {
          await docIn();
          check();
          const D = globalThis.GZ_DOCTEXT;
          const texts = [], ocrs = [], files = [];
          const tooLarge = () => Object.assign(new Error(t('That file is too large.')), { mine: true });
          let why = null;
          // Tokenize real tags, not anchor-like text inside attributes, comments or scripts.
          const source = html(chosen);
          let at = 0;
          for (const tk of D.tokens(source, new Set(['script', 'style', 'template', 'noscript', 'textarea', 'title']))) {
            check();
            if (tk.name?.toLowerCase() !== 'a' || tk.close) continue;
            const f = GZ_PAGE.files({ body: source.slice(tk.at, tk.end) }, location.origin)[0];
            if (!f) continue;
            texts.push(source.slice(at, tk.at));
            at = tk.end;
            try {
              // Bound the download by the largest file the importer reads, even without a trustworthy size header.
              // The importer checks the detected kind's own limit afterwards (a renamed file can still be a PDF).
              if (!D.kind(f.name)) continue;
              if (+f.size > D.READ.pdf) throw tooLarge();
              const r = await fetch(f.url, { credentials: 'same-origin', signal });
              const body = r.body?.getReader();
              let file;
              try {
                check();
                if (!r.ok) continue;
                if (+r.headers.get('content-length') > D.READ.pdf) throw tooLarge();
                if (!body) continue;
                const chunks = [];
                let size = 0;
                for (;;) {
                  const { done, value } = await body.read();
                  check();
                  if (done) break;
                  if ((size += value.byteLength) > D.READ.pdf) throw tooLarge();
                  chunks.push(value);
                }
                file = new File(chunks, f.name, { type: r.headers.get('content-type') || '' });
                chunks.length = 0;
                if (file.size > D.READ.pdf) throw tooLarge();
              } finally { if (body) { body.cancel().catch(() => {}); body.releaseLock(); } }
              await need('features/import.js', () => globalThis.GZ_IMPORT);
              check();
              const got = await GZ_IMPORT.read(file, { signal, progress: (w) => { if (live() && reading === ctl && !signal.aborted) say.textContent = w; } });
              check();
              texts.push({ text: got.text || '' });
              if (got.ocr) ocrs.push(got.ocr);
              files.push(file);
            } catch (e) { if (signal.aborted) throw e; why = e; }
          }
          check();
          texts.push(source.slice(at));
          // Runs of HTML become text together, so a split never cuts a line in two.
          const parts = [];
          for (const x of texts) if (typeof x === 'string' && typeof parts.at(-1) === 'string') parts[parts.length - 1] += x; else parts.push(x);
          const text = parts.map((x) => (typeof x === 'string' ? D.html(x) : x.text).trim()).filter(Boolean).join('\n\n');
          if (!text) { say.textContent = why?.mine ? why.message : t("Glaze couldn't read that file."); return; }
          // The pictures' OCR as one (features/import.js note and doubt): pages, blank pages and unsure lines added up,
          // confidence by page.
          const n = ocrs.reduce((k, o) => k + o.pages, 0);
          const ocr = ocrs.length ? { pages: n, conf: Math.round(ocrs.reduce((k, o) => k + o.conf * o.pages, 0) / n), unsure: ocrs.flatMap((o) => o.unsure), blank: ocrs.reduce((k, o) => k + (o.blank || 0), 0) } : null;
          const r = await withAI(await reviewed(text, ocr, signal), text, { read: ctl, say, stop, shown: desc.dataset.to, files });
          check();
          review(r, text);
        } catch (e) { if (reading === ctl) say.textContent = signal.aborted ? t('Stopped.') : t("Glaze couldn't read that file."); }
        finally { if (reading === ctl) { reading = null; stop.hidden = true; } }
      };
      box.append(make('label', { htmlFor: 'gz-syl-doc', textContent: t('A document in this course') }), sel, button(t('Read this document'), 'doc', (e) => { if (e.isTrusted) read(); }));
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
  // ai: the value is AI's (lib/syllabus-ai.js), marked as one.
  const note = (input, conf, src, saved, ai) => {
    const m = mark(conf, !src, saved);
    const tag = m && make('span', { id: id(), className: `gz-syl-conf${conf === 'check' ? ' gz-syl-check' : ''}${ai && !saved ? ' gz-syl-ai' : ''}`, textContent: m });
    const from = src && make('small', { id: id(), className: 'gz-syl-src', textContent: t('From: “{text}”', { text: src }) });
    const by = [tag?.id, from?.id].filter(Boolean).join(' ');
    if (by) input.setAttribute('aria-describedby', by);
    return [tag || '', from || ''];
  };
  const field = (label, input, f, saved) => {
    input.id = id();
    const [tag, from] = note(input, f.conf, f.src, saved, f.ai);
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
    const [tag, src] = note(label, m.conf, m.src, saved || !m.src, m.ai);
    row.append(label, days, from, '–', to, loc, x(name, () => { row.remove(); list.querySelector('input')?.focus(); }), tag, src);
    return row;
  };
  // kept: the record this review began from, whose ids a new row mustn't take (lib/syllabus.js ids).
  const dateRow = (list, d, n, saved, todo, kept) => {
    const name = d.title || t('Date {n}', { n });
    const title = attr(text(d.title, { maxLength: 200, className: 'gz-syl-label' }), { 'aria-label': t('What') });
    const day = attr(make('input', { type: 'date', value: d.day || '' }), { 'aria-label': t('Date') });
    const kind = attr(make('select', {}, ...[['exam', 'Exam'], ['due', 'Due'], ['other', 'Other']].map(([v, k]) => make('option', { value: v, textContent: t(k), selected: d.kind === v }))), { 'aria-label': t('Kind') });
    const row = attr(make('div', { className: 'gz-syl-row gz-syl-date' }), { role: 'group', 'aria-label': name });
    // The row's own id, from the first review of it: its To Do task follows the row through edits.
    row.dataset.id = d.id || L.newId([...list.children].map((r) => r.dataset.id).concat((kept?.dates || []).map((x) => x.id)));
    const add = todo && make('label', { className: 'gz-syl-todo' }, make('input', { type: 'checkbox', className: 'gz-syl-task' }), ` ${t('Add to To Do')}`);
    // A date by course week moves with Week 1 starts until the student sets its day.
    if (Number.isInteger(d.week) && Number.isInteger(d.wd)) {
      Object.assign(row.dataset, { week: String(d.week), wd: String(d.wd), ...(d.dow && { dow: d.dow }) });
      for (const type of ['input', 'change']) day.addEventListener(type, () => { row.dataset.own = '1'; });
    }
    const [tag, src] = note(title, d.conf, d.src, saved || !d.src, d.ai);
    row.append(title, day, kind, add || '', x(name, () => { row.remove(); list.querySelector('input')?.focus(); }), tag, src);
    return row;
  };
  // lead: a field above the rows (the dates' Week 1 starts).
  const rows = (legend, items, make1, blank, lead) => {
    const list = make('div', { className: 'gz-syl-rows' });
    items.forEach((m, i) => list.append(make1(list, m, i + 1)));
    const add = button(t('Add'), '', () => { const r = make1(list, blank, list.children.length + 1); list.append(r); r.querySelector('input')?.focus(); });
    attr(add, { 'aria-label': `${t('Add')}: ${legend}` });
    return make('fieldset', { className: 'gz-syl-set' }, make('legend', { textContent: legend }), lead, list, add);
  };

  const review = (r, read) => {
    const w = opened; // the course this dialog is for, whatever the page shows by the time it is saved
    const box = dlg; // and the dialog: a save that finishes after another opened leaves that one open
    const kept = w === who ? rec : null; // what is kept for it as this review begins: To Do follows the changes from it
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
    // The day dates by course week count from (lib/syllabus.js week1): the syllabus's (with its line), the course's own, or
    // the term's ("Check this"). Changing it moves each of those rows whose day the student hasn't set.
    const wk = r.week1?.value ? make('input', { type: 'date', value: r.week1.value }) : null;
    const wkSrc = r.week1?.from === 'text' ? r.week1.src : '';
    const week1 = wk && field(t('Week 1 starts'), wk, { conf: r.week1.conf, src: wkSrc, ai: r.week1.ai }, saved || (r.week1.conf !== 'check' && !wkSrc));
    const dates = rows(t('Important dates'), L.ids(r.dates, kept?.dates), (l, d, n) => dateRow(l, d, n, saved, todo, kept), { title: '', day: '', kind: 'exam' }, week1);
    const move = () => {
      for (const row of dates.querySelectorAll('.gz-syl-date')) {
        const day = !row.dataset.own && row.dataset.week && L.weekDay(wk.value, +row.dataset.week, +row.dataset.wd, row.dataset.dow);
        if (day) row.querySelector('input[type="date"]').value = day;
      }
    };
    for (const type of ['input', 'change']) wk?.addEventListener(type, move);
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
      const ds = [...dates.querySelectorAll('.gz-syl-row')].map((row) => ({ row, id: row.dataset.id, title: row.querySelector('.gz-syl-label').value.trim(), day: row.querySelector('input[type="date"]').value, kind: row.querySelector('select').value, task: !!row.querySelector('.gz-syl-task')?.checked }));
      const noDate = ds.find((d) => !d.title || !d.day);
      if (noDate) return bad(noDate.row.querySelector(noDate.title ? 'input[type="date"]' : '.gz-syl-label'), t('Give each date a name and a day.'));
      const strip = ({ row, ...m }) => m;
      const out = L.tidy({ prof: { name: name.value, email: email.value, office: office.value, note: hoursNote.value },
        hours: times(hours).map(strip), meetings: times(meets).map(strip), dates: ds.map(({ row, task, ...d }) => d), scale: sc, weights: ws, at: Date.now() });
      if (!out) { say.textContent = t('There is nothing to save.'); return; }
      // Refused when the page has moved to another course since this review began (Ultra moves in one document).
      if (w !== who || w.cid !== cidHere()) { say.textContent = t('Not saved: this page now shows another course.'); return; }
      const res = await send({ type: 'glaze:syllabus', key: w.key, rec: out, at: out.at });
      if (!res?.ok) { say.textContent = t('Not saved. Try again in a moment.'); return; }
      if (w === who) rec = L.tidy(res.rec);
      const notes = [];
      const scaleSaid = useScale.checked && sc.length ? await gpaScale(C, sc, w) : '';
      if (scaleSaid) notes.push(scaleSaid);
      if (!await syncTasks(w, kept?.dates, out.dates, new Set(ds.filter((d) => d.task).map((d) => d.id)))) notes.push(t('The dates could not be added to To Do.'));
      if (notes.length) { say.textContent = `${t('Saved.')} ${notes.join(' ')}`; return; }
      if (dlg !== box) return;
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
    if (r.aiSaid) say.textContent = r.aiSaid;
    first(name);
  };

  // The scale becomes the course's own in the GPA's synced choices (gpaCourses), set by the worker for this course alone
  // on what is stored then ('glaze:gpa', which the GPA table uses too), so two courses saved at once both keep theirs.
  // → '' when it's in, else the words to show.
  const gpaScale = async (C, sc, w) => {
    const r = await send({ type: 'glaze:gpa', key: `${ultra ? 'ultra' : 'canvas'}:${location.origin}/${w.cid}`, patch: { s: C.schemeText(sc) } });
    return r?.ok ? '' : r?.error === 'full' ? t('Not saved: too many course settings are stored. Clear a course you no longer need.') : t('The scale could not be given to your GPA.');
  };
  // Dates become the student's own To Do tasks (lib/todo.js importTask), one for each row of the record: what a save does to
  // them is lib/syllabus.js taskEdits (a row ticked is added or brought up to date, an edited row moves its task, a row taken
  // out takes it). was, now: the record's dates before and as saved; picked: the ids of the rows ticked. A second Save of one
  // review (the first one told of a problem) works out the same changes again, which do nothing twice.
  const syncTasks = async (w, was, now, picked) => {
    const key = `todo:${location.origin}/${w.uid}`;
    const edits = L.taskEdits({ cid: w.cid, was, now, picked, tasks: (await get('local', key))?.tasks, note: t('From your syllabus'), at: Date.now() });
    for (let i = 0; i < edits.length; i += 20) if (!(await send({ type: 'glaze:todo', key, edits: edits.slice(i, i + 20) }))?.ok) return false;
    return true;
  };

  // ---- switches ---------------------------------------------------------------------------------------------------
  const sync = (want) => {
    on = !!want;
    if (opened && !allowed(opened.cid)) reading?.abort();
    // Off this page's part, the dialog stays (Ctrl+K opens it on any course page); with Glaze or the switch off, it goes.
    if (!on) { draw(); if (!X.on() || X.settings().enabled === false || !X.settings().enhance.syllabus) dlg?.close(); return; }
    ready().then(() => draw(), () => {});
  };
  return { sync, open: () => open() };
})();

// Node takes the module; a page that loaded this on demand gets it as the script's last value, which is how
// lib/background.js knows it ran to the end.
if (typeof module !== 'undefined') module.exports = GZ_SYL_UI; else GZ_SYL_UI;
