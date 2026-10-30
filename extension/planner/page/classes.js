// Class schedule (W14), on Canvas and Blackboard Ultra, loaded on demand: the command palette ("Class schedule"), the
// agenda tile and the reminders hub open it (open()). A schedule is read on this device from an .ics file or a calendar
// link on this site (Ultra's own "Share calendar" link pasted by the student, say), a PDF, a picture or screenshot (also
// pasted), a registrar's page saved as HTML, a Word file or pasted text (lib/classes.js reads it; lib/ics.js and
// features/import.js turn files into text). Every class it finds is shown for review, each field editable and each guess
// marked (a row read from a picture the OCR engine wasn't sure of, too), matched to one of the student's courses on this
// site by code first, then name; nothing is kept until Save. Kept in storage.local (classes:<site>/<user>) through the
// worker's queue ('glaze:classes'). Nothing is sent anywhere: a calendar link is read only when it is on this site.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_CLASSES_UI = globalThis.GZ_CLASSES_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const MAX = 5 << 20; // bytes read from a file or link
  let C = null, key = '', tz, courses = [], store = { courses: [] };
  const ultra = ctx.site === 'ultra';
  // A course's own page on this site: Ultra's <base href> is its CDN, so the address is whole.
  const courseUrl = (id) => (/^\d+$/.test(id) ? `/courses/${id}` : /^_\d+_\d+$/.test(id) ? `${location.origin}/ultra/courses/${id}/outline` : '');
  let box = null, opener = null, view = null; // view: what's drawn ('list', 'import' or 'review'), redrawn on a change
  // Each drawing of the dialog (a view, or the dialog opened again) is a new generation: an answer that comes back after
  // it moved on (a file or link still being read, a write the worker hadn't answered) changes nothing on screen.
  let gen = 0;
  let reading = null; // the AbortController of a schedule being read: Stop reading, a new view or closing the dialog calls it off

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false && k !== '')); return e; };
  // A click a person made (not a page script's): every button here saves, deletes or moves on.
  const button = (text, run, { 'aria-label': name, ...props } = {}) => {
    const b = make('button', { type: 'button', textContent: text, ...props });
    if (name) b.setAttribute('aria-label', name);
    b.addEventListener('click', (e) => { if (e.isTrusted) run(e); });
    return b;
  };
  const field = (label, input, unsure) => {
    const l = make('label', { className: 'gz-cl-field' }, make('span', { textContent: label }), input);
    if (unsure) { l.dataset.unsure = ''; l.append(make('small', { textContent: t('Check this') })); }
    return l;
  };
  const lang = () => GZ_I18N.locale(ctx.locale());
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:classes', key, ...m }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  // A write through the worker, stamped with when the student asked for it (lib/classes.js change weighs it by that), then
  // the list, if the dialog is still where it was asked from.
  // An answer for a view that's gone changes nothing here, not even what's kept in memory: the dialog drawn since read
  // storage afresh, and storage's change events keep it current. tz: the zone the times are in (the Canvas profile's),
  // kept with the schedule so an export can place them.
  const write = async (m, said) => {
    const g = gen;
    const r = await send({ ...m, at: Date.now(), ...(tz && { tz }) });
    if (g !== gen) return;
    if (r?.ok) store = C.clean(r.data);
    if (!r?.ok) return say(limit(r?.error) || t("Couldn't save. Try again in a moment."), true);
    list('.gz-cl-import');
    say(r.stale ? t('Some of this changed in another tab first. This is what is kept now.') : said);
  };
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const dayName = (d, style = 'short') => new Intl.DateTimeFormat(lang(), { weekday: style, timeZone: 'UTC' }).format(Date.UTC(2026, 0, 4 + d)); // 4 Jan 2026 was a Sunday
  // "9:00 – 9:50 AM", as the page's language writes a range of times.
  const hours = (a, b) => new Intl.DateTimeFormat(lang(), { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).formatRange(Date.UTC(2026, 0, 1, 0, a), Date.UTC(2026, 0, 1, 0, b));
  const dateText = (k) => new Date(`${k}T00:00Z`).toLocaleDateString(lang(), { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const minutes = (v) => (/^\d{2}:\d{2}$/.test(v) ? +v.slice(0, 2) * 60 + +v.slice(3) : -1);
  const labelOf = (c) => [c.friendly_name || c.name, c.course_code !== (c.friendly_name || c.name) && c.course_code, location.host].filter(Boolean).join(' · ');
  const tooMany = () => t('A class can have at most {n} times.', { n: C.MAX.periods });
  const limit = (error) => error === 'periods' ? tooMany() : error === 'courses' ? t('A schedule can have at most {n} classes.', { n: C.MAX.courses })
    : error === 'skip' ? t('A class time can have at most {n} days off.', { n: C.MAX.skip }) : '';
  const zoneOf = (p) => p.tz || store.tz || tz;
  // A time's zone, named only when it isn't the one this page is in.
  const zoneTag = (p) => (zoneOf(p) && zoneOf(p) !== tz ? ` (${zoneOf(p)})` : '');
  const say = (text, alert) => { const p = box?.querySelector('.gz-cl-say'); if (p) { p.textContent = text; p.setAttribute('role', alert ? 'alert' : 'status'); } };

  // ---- the saved schedule --------------------------------------------------------------------------------------
  const describe = (p) => [ORDER.filter((d) => p.days.includes(d)).map((d) => dayName(d)).join(', '), `${hours(p.start, p.end)}${zoneTag(p)}`, p.loc,
    (p.from || p.to) && `${p.from ? dateText(p.from) : '…'} – ${p.to ? dateText(p.to) : '…'}`, p.skip.length && t('Days off: {n}', { n: p.skip.length })].filter(Boolean).join(' · ');
  const list = (focus) => {
    view = 'list';
    const confirmAll = make('div', { className: 'gz-cl-row', hidden: true },
      make('span', { textContent: t('Delete every class in your schedule on this site?') }),
      button(t('Delete all'), () => write({ op: 'clear' }, t('Deleted.')), { className: 'gz-cl-danger' }),
      button(t('Cancel'), () => { confirmAll.hidden = true; all.focus(); }));
    const all = button(t('Delete all'), () => { confirmAll.hidden = false; confirmAll.querySelector('button').focus(); });
    const items = store.courses.map((c) => {
      const name = courseUrl(c.id) ? make('a', { href: courseUrl(c.id), textContent: c.name }) : make('span', { textContent: c.name });
      return make('li', {}, make('div', { className: 'gz-cl-main' }, make('strong', {}, name, c.code && !c.name.includes(c.code) && make('span', { className: 'gz-cl-faint', textContent: ` · ${c.code}` })),
        ...c.periods.map((p) => make('span', { className: 'gz-cl-faint', textContent: describe(p) }))),
      make('div', { className: 'gz-cl-row' },
        // Each time stays in the zone it was saved in, whatever this page's is now.
        button(t('Edit'), () => review([{ id: c.id, code: c.code, name: c.name, periods: c.periods.map((p) => ({ ...p, tz: p.tz || store.tz || tz, unsure: [] })) }], { edit: true }), { 'aria-label': t('Edit {name}', { name: c.name }) }),
        button(t('Delete'), () => write({ op: 'drop', id: c.id }, t('Deleted {name}.', { name: c.name })), { 'aria-label': t('Delete {name}', { name: c.name }) })));
    });
    draw(t('Class schedule'),
      items.length ? make('ul', { className: 'gz-cl-list' }, ...items) : make('p', { textContent: t('No classes yet.') }),
      make('div', { className: 'gz-cl-row' }, button(t('Import a schedule'), importer, { className: 'gz-cl-main-btn gz-cl-import' }),
        button(t('Add a class'), () => review([{ code: '', name: '', label: '', periods: [{ days: [], start: 540, end: 590, loc: '', from: '', to: '', skip: [], unsure: [] }] }], { manual: true })),
        items.length > 0 && all),
      confirmAll);
    box.querySelector(focus || '.gz-cl-close')?.focus();
  };

  // ---- reading a schedule --------------------------------------------------------------------------------------
  const cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true });
  const oops = (msg) => Object.assign(new Error(msg), { mine: true }); // translated, like features/import.js
  const TOO_BIG = new Set(['calendar file too large', 'calendar too complex', 'calendar time zone too large']); // lib/ics.js parse
  // signal: Stop reading, another view or the dialog closed. Whatever a wait here ends with, it is checked after.
  const read = async (file, text, link, signal) => {
    const live = () => { if (signal.aborted) throw cancelled(); };
    // A calendar goes to lib/ics.js as bytes: it unfolds lines before decoding them, as a fold can split a character.
    // What the reader refuses (in English, for the code) is said in the page's language.
    const ics = async (s) => {
      await ctx.need('lib/ics.js', () => globalThis.GZ_ICS);
      live();
      try { return C.fromIcs(s, { tz }); } catch (e) { throw oops(TOO_BIG.has(e?.message) ? t('This calendar is too big to read.') : t("Couldn't read that.")); }
    };
    // A link's decoded body, stopping at the first chunk that passes MAX.
    const upTo = async (r) => {
      const rd = r.body.getReader(), parts = [];
      let n = 0, end = false;
      try {
        for (;;) {
          const c = await rd.read();
          if ((end = c.done)) break;
          live();
          if ((n += c.value.length) > MAX) return null;
          parts.push(c.value);
        }
      } finally {
        if (!end) rd.cancel().catch(() => {});
        rd.releaseLock();
      }
      const b = new Uint8Array(n);
      parts.reduce((at, x) => (b.set(x, at), at + x.length), 0);
      return b;
    };
    if (file) {
      if (/\.(ics|ical|ifb)$/i.test(file.name) || file.type === 'text/calendar') {
        if (file.size > MAX) throw oops(t('That file is too big for a schedule.'));
        const b = new Uint8Array(await file.arrayBuffer());
        live();
        return ics(b);
      }
      await ctx.need('features/import.js', () => globalThis.GZ_IMPORT);
      live();
      const r = await GZ_IMPORT.read(file, { signal, progress: (s) => { if (!signal.aborted) say(s); } });
      live();
      return { ...C.fromText(r.text, { lang: lang() }), ocr: r.ocr };
    }
    if (link) {
      // Only this site's own addresses (its calendar feed): Glaze asks nothing of anywhere else.
      let u;
      try { u = new URL(link.replace(/^webcals?:\/\//i, 'https://'), location.origin); } catch { u = null; }
      if (!u || u.origin !== location.origin) throw oops(t('Glaze only reads calendar links on {site}. Download the .ics file instead and choose it above.', { site: location.host }));
      const r = await fetch(u.href, { credentials: 'same-origin', redirect: 'error', signal });
      live();
      const b = r.ok && r.body ? await upTo(r) : new Uint8Array();
      live();
      if (!b || !/BEGIN:VCALENDAR/.test(new TextDecoder().decode(b.subarray(0, 2000)))) throw oops(t("That link isn't a calendar Glaze can read."));
      return ics(b);
    }
    if (/^\s*BEGIN:VCALENDAR/.test(text)) return ics(text);
    return C.fromText(text, { lang: lang() });
  };
  const importer = () => {
    view = 'import';
    const file = make('input', { type: 'file', accept: '.ics,.ical,.pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.html,.htm,.docx,.txt,text/calendar,application/pdf,image/*,text/html,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const text = make('textarea', { rows: 7 });
    const link = make('input', { type: 'url', placeholder: `${location.origin}${ultra ? '/' : '/feeds/calendars/'}….ics` });
    const stop = button(t('Stop reading'), () => reading?.abort(), { hidden: true });
    // pasted: a screenshot pasted into the text box, read instead of what's typed there.
    const run = async (pasted) => {
      const f = pasted || file.files[0];
      if (!f && !text.value.trim() && !link.value.trim()) return say(t('Choose a file, paste your schedule or give a calendar link.'), true);
      // Read schedule is disabled while it reads, so the keyboard's place moves to Stop reading, and back after.
      const kept = document.activeElement === go;
      go.disabled = true;
      say(t('Reading…'));
      const g = gen;
      reading?.abort(); // one still under way (Read schedule is disabled meanwhile, so only a race) is called off
      const ctl = reading = new AbortController();
      stop.hidden = false;
      if (kept) stop.focus();
      try {
        const r = await read(f, text.value, link.value.trim(), ctl.signal);
        if (g !== gen) return;
        if (ctl.signal.aborted) throw cancelled();
        if (limit(r.error)) throw oops(limit(r.error));
        if (!r.entries.length) { go.disabled = false; return say(t("Glaze didn't find any classes there. Check that days and times are in it, or add your classes yourself."), true); }
        // A class read from a line the OCR engine wasn't sure of: its days, times and place are guesses too.
        const doubt = (e) => !!r.ocr && GZ_IMPORT.doubt(r.ocr, e.label);
        const found = r.entries.map((e) => ({ ...e, id: C.match(e, courses), periods: e.periods.map((p) => ({ ...p, importedSkip: p.skip, ...(doubt(e) && { unsure: [...new Set([...p.unsure, 'days', 'time', 'loc'])] }) })) }));
        review(found, { ignored: r.ignored, ocr: r.ocr });
      } catch (e) {
        // A request called off fails with the browser's AbortError.
        const off = !!e?.cancelled || e?.name === 'AbortError' || ctl.signal.aborted;
        if (g === gen) { go.disabled = false; say(off ? t('Stopped.') : e?.mine && e.message || t("Couldn't read that."), !off); }
      }
      finally {
        if (reading === ctl) reading = null;
        const back = document.activeElement === stop;
        stop.hidden = true;
        if ((kept || back) && go.isConnected) go.focus();
      }
    };
    const go = button(t('Read schedule'), () => run(), { className: 'gz-cl-main-btn' });
    text.addEventListener('paste', (e) => {
      const img = e.isTrusted && [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
      if (img && !go.disabled) { e.preventDefault(); run(img); }
    });
    draw(t('Import a schedule'),
      field(t('A file'), file),
      field(t('Or paste it, or paste a screenshot'), text),
      field(t('Or a calendar link on {site}', { site: location.host }), link),
      make('div', { className: 'gz-cl-row' }, go, stop, button(t('Back'), () => list('.gz-cl-import'))));
    file.focus();
  };

  // ---- review: every class found, each field editable ----------------------------------------------------------
  // entries: [{ id ('' when none matched), code, name, label, periods: [{ …, unsure }] }]. opts.edit: one saved course
  // being changed (its course stays the same); opts.manual: a class typed in by hand.
  const review = (entries, opts = {}) => {
    view = 'review';
    const rows = entries.map((e, i) => entry(e, i, opts));
    const save = button(opts.edit ? t('Save changes') : t('Save'), async () => {
      const out = [];
      for (const r of rows) {
        const c = r.value();
        if (c === null) continue;
        if (typeof c === 'string') { say(c, true); return r.focusBad(); }
        const same = out.find((x) => x.id === c.id);
        if (same) same.periods.push(...c.periods); else out.push(c);
      }
      if (!out.length) return say(t('Nothing to save: keep at least one class.'), true);
      save.disabled = true;
      await write({ op: opts.edit ? 'put' : 'add', courses: out }, t('Saved.'));
      save.disabled = false;
    }, { className: 'gz-cl-main-btn' });
    draw(opts.edit ? t('Edit class') : opts.manual ? t('Add a class') : t('Check what Glaze found'),
      opts.ocr && make('p', { className: 'gz-cl-ocr', textContent: GZ_IMPORT.note(opts.ocr) }),
      opts.ignored > 0 && make('p', { className: 'gz-cl-faint', textContent: t('Left out as one-off events or office hours: {n}', { n: opts.ignored }) }),
      ...rows.map((r) => r.el),
      make('div', { className: 'gz-cl-row' }, save, button(t('Cancel'), () => list('.gz-cl-import'))));
    box.querySelector('.gz-cl-entry select, .gz-cl-entry input')?.focus();
  };
  const entry = (e, i, opts) => {
    const keep = make('input', { type: 'checkbox', checked: true });
    const sel = make('select', {}, make('option', { value: '', textContent: ultra ? t('Not a Blackboard course') : t('Not a Canvas course') }),
      ...courses.map((c) => make('option', { value: String(c.id), textContent: labelOf(c), selected: String(c.id) === e.id })));
    const name = make('input', { type: 'text', value: e.name || e.label || '', maxLength: 200 });
    const named = field(t('Name'), name, !opts.manual && !e.id && e.periods.some((p) => p.unsure.includes('label')));
    if (opts.edit) sel.disabled = true;
    if (opts.edit && courseUrl(e.id) && !courses.some((c) => String(c.id) === e.id)) sel.append(make('option', { value: e.id, textContent: e.name, selected: true }));
    const sync = () => { named.hidden = !!sel.value; };
    sel.addEventListener('change', sync);
    sync();
    const periods = make('div', { className: 'gz-cl-periods' });
    const parts = [];
    const addPeriod = (p) => {
      const part = period(p, () => { parts.splice(parts.indexOf(part), 1); part.el.remove(); parts[0]?.el.querySelector('input')?.focus(); });
      parts.push(part);
      periods.append(part.el);
      return part;
    };
    e.periods.forEach(addPeriod);
    const title = make('legend', { textContent: e.label || e.name || t('New class') });
    const el = make('fieldset', { className: 'gz-cl-entry' }, title,
      !opts.edit && !opts.manual && make('label', { className: 'gz-cl-keep' }, keep, make('span', { textContent: t('Keep this class') })),
      field(ultra ? t('Blackboard course') : t('Canvas course'), sel), named, periods,
      button(t('Add a time'), () => (parts.length >= C.MAX.periods ? say(tooMany(), true) : addPeriod({ days: [], start: 540, end: 590, loc: '', from: '', to: '', skip: [], unsure: [] }).el.querySelector('input').focus())));
    keep.addEventListener('change', () => el.toggleAttribute('data-off', !keep.checked));
    let bad = null;
    return {
      el,
      focusBad: () => bad?.focus(),
      // → the course to save, null when not kept, or what's wrong (and bad is where).
      value: () => {
        if (!keep.checked) return null;
        const c = courses.find((x) => String(x.id) === sel.value);
        const nm = c ? c.friendly_name || c.name : name.value.trim();
        if (!nm) { bad = name; return ultra ? t('Give the class a name, or choose its Blackboard course.') : t('Give the class a name, or choose its Canvas course.'); }
        const ps = [];
        for (const part of parts) {
          const p = part.value();
          if (typeof p === 'string') { bad = part.bad(); return p; }
          ps.push(p);
        }
        if (!ps.length) { bad = el.querySelector('button'); return t('Add at least one time for {name}.', { name: nm }); }
        if (ps.length > C.MAX.periods) { bad = parts[0].el.querySelector('input'); return tooMany(); }
        const id = opts.edit ? e.id : c ? String(c.id) : C.otherId(nm);
        return { id, code: c ? c.course_code || '' : e.code || '', name: nm, periods: ps };
      },
    };
  };
  const period = (p, remove) => {
    const u = new Set(p.unsure);
    const days = ORDER.map((d) => {
      const i = make('input', { type: 'checkbox', checked: p.days.includes(d) });
      i.dataset.day = d;
      return make('label', { className: 'gz-cl-day', title: dayName(d, 'long') }, i, make('span', { textContent: dayName(d) }));
    });
    const dayBox = make('fieldset', { className: 'gz-cl-days' }, make('legend', { textContent: t('Days') }), ...days);
    if (u.has('days')) { dayBox.dataset.unsure = ''; dayBox.append(make('small', { textContent: t('Check this') })); }
    const start = make('input', { type: 'time', value: C.hhmm(p.start), required: true });
    const end = make('input', { type: 'time', value: C.hhmm(Math.min(p.end, 1439)), required: true });
    const loc = make('input', { type: 'text', value: p.loc || '', maxLength: 120 });
    const from = make('input', { type: 'date', value: p.from || '' }), to = make('input', { type: 'date', value: p.to || '' });
    // Days the class doesn't meet (holidays, breaks): each removable; another added by date.
    const skip = new Set(p.skip || []);
    const importedSkip = p.importedSkip || [];
    const chips = make('ul', { className: 'gz-cl-chips' });
    const drawSkip = () => chips.replaceChildren(...[...skip].sort().map((k) => make('li', {}, make('span', { textContent: dateText(k) }),
      button('×', () => { skip.delete(k); drawSkip(); add.focus(); }, { 'aria-label': t('Remove {date}', { date: dateText(k) }) }))));
    const more = make('input', { type: 'date' });
    // Only a whole date ("2026-11-26"); an empty or half-typed field adds nothing and says so.
    const add = button(t('Add'), () => {
      if (C.date(more.value) && !skip.has(more.value) && skip.size >= C.MAX.skip) return say(limit('skip'), true);
      if (C.date(more.value)) { skip.add(more.value); more.value = ''; drawSkip(); say(''); }
      else say(t('Choose a date first.'), true);
      more.focus();
    });
    drawSkip();
    const el = make('div', { className: 'gz-cl-period' }, dayBox,
      make('div', { className: 'gz-cl-row' }, field(`${t('Starts')}${zoneTag(p)}`, start, u.has('time')), field(`${t('Ends')}${zoneTag(p)}`, end, u.has('time') || u.has('end')), field(t('Place'), loc, u.has('loc'))),
      make('div', { className: 'gz-cl-row' }, field(t('First day'), from), field(t('Last day'), to, u.has('to'))),
      make('div', { className: 'gz-cl-skip' }, make('span', { textContent: t('No class on') }), chips, field(t('Date'), more), add),
      button(t('Remove this time'), remove, { className: 'gz-cl-quiet' }));
    let bad = null;
    return {
      el,
      bad: () => bad,
      value: () => {
        const ds = days.map((l) => l.firstChild).filter((i) => i.checked).map((i) => +i.dataset.day);
        const s = minutes(start.value), e = minutes(end.value);
        if (!ds.length) { bad = days[0].firstChild; return t('Choose the days this class meets.'); }
        if (s < 0 || e <= s) { bad = s < 0 ? start : end; return t('A class ends after it starts.'); }
        if (skip.size > C.MAX.skip) { bad = more; return limit('skip'); }
        if (from.value && to.value && to.value < from.value) { bad = to; return t('The last day comes after the first.'); }
        return { days: ds, start: s, end: e, loc: loc.value.trim(), from: from.value, to: to.value, skip: [...skip], importedSkip: [...importedSkip], ...(p.tz && { tz: p.tz }) };
      },
    };
  };

  // ---- the dialog ------------------------------------------------------------------------------------------------
  const draw = (title, ...parts) => {
    gen++;
    reading?.abort();
    const close = button('×', () => box.close(), { className: 'gz-cl-close', 'aria-label': t('Close') });
    box.firstChild.replaceChildren(make('div', { className: 'gz-cl-top' }, make('h2', { id: 'gz-cl-title', textContent: title }), close),
      ...parts.filter((p) => p != null && p !== false && p !== ''), make('p', { className: 'gz-cl-say', role: 'status' }));
  };
  const onStore = (ch, area) => {
    if (area !== 'local' || !ch[key] || !box) return;
    store = C.clean(ch[key].newValue);
    if (view === 'list') list();
  };
  const open = async () => {
    if (box) { box.querySelector('.gz-cl-close')?.focus(); return true; }
    await Promise.all([ctx.need('lib/todo.js', () => globalThis.GZ_TODO), ctx.need('lib/classes.js', () => globalThis.GZ_CLASSES)]);
    C = globalThis.GZ_CLASSES;
    const [p, list0] = await Promise.all([ctx.profile(), ctx.canvasCourses()]);
    if (!GZ_TODO.ID.test(String(p?.id))) throw new Error('no profile');
    tz = GZ_TODO.zone(p.time_zone) || new Intl.DateTimeFormat().resolvedOptions().timeZone;
    key = C.storeKey(location.origin, String(p.id));
    courses = list0.filter((c) => GZ_TODO.ID.test(String(c.id)) && c.name);
    store = await new Promise((res) => { try { chrome.storage.local.get(key, (r) => res(C.clean(r?.[key]))); } catch { res(C.clean(null)); } });
    if (box) return true;
    opener = document.activeElement;
    box = make('dialog', { id: 'gz-cl' }, make('div', { className: 'gz-cl-in' }), make('style', { textContent: CSS }));
    box.setAttribute('aria-labelledby', 'gz-cl-title');
    box.addEventListener('close', () => {
      gen++;
      reading?.abort();
      box?.remove();
      box = null;
      view = null;
      try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ }
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.body.append(box);
    box.showModal();
    list();
    return true;
  };

  const CSS = `
#gz-cl { box-sizing: border-box; width: min(640px, calc(100vw - 24px)); max-height: calc(100vh - 24px); padding: 0; overflow: auto;
  font: 13px/1.45 var(--gz-font, system-ui, sans-serif); color: var(--gz-ink, #1f2328); background:var(--gz-surface-grain, none), var(--gz-surface-fill, var(--gz-surface, #fff));
  border: 1px solid var(--gz-line-strong, #8c959f); border-radius: var(--gz-radius, calc(var(--gz-radius, 12px) * 5 / 6)); box-shadow: var(--gz-shadow, 0 8px 30px rgb(0 0 0 / .25)); }
#gz-cl::backdrop { background: rgb(0 0 0 / 0.35); }
#gz-cl * { box-sizing: border-box; }
#gz-cl .gz-cl-in { display: grid; gap: 0.8rem; padding: 1rem 1.1rem 1.1rem; }
#gz-cl .gz-cl-top { display: flex; align-items: center; gap: 0.75rem; }
#gz-cl h2 { flex: 1; margin: 0; font: 600 16px/1.3 var(--gz-font-head, var(--gz-font, inherit)); color: inherit; }
#gz-cl p { margin: 0; }
#gz-cl .gz-cl-faint, #gz-cl small { font-size: 12px; color: var(--gz-ink-muted, #57606a); }
#gz-cl a { color: var(--gz-accent, #0b6e4f); }
#gz-cl button { margin: 0; padding: 0.25rem 0.7rem; font: inherit; color: inherit; background:var(--gz-surface-grain, none), var(--gz-surface-fill-2, var(--gz-surface-2, #f6f8fa));
  border: 1px solid var(--gz-line-strong, #8c959f); border-radius: 999px; cursor: pointer; box-shadow: none; }
#gz-cl button:hover { border-color: var(--gz-accent, #0b6e4f); }
#gz-cl button:disabled { opacity: 0.6; cursor: default; }
#gz-cl .gz-cl-main-btn { font-weight: 600; color: var(--gz-accent-ink, #fff); background: var(--gz-accent, #0b6e4f); border-color: var(--gz-accent, #0b6e4f); }
#gz-cl .gz-cl-danger { color: var(--gz-err, #b42318); border-color: currentColor; }
#gz-cl .gz-cl-quiet { justify-self: start; background: none; border-color: transparent; color: var(--gz-ink-muted, #57606a); padding-inline: 0.3rem; }
#gz-cl .gz-cl-close { flex: none; width: 1.75rem; height: 1.75rem; padding: 0; font-size: 16px; line-height: 1; }
#gz-cl :focus-visible { outline: 2px solid var(--gz-accent, #0b6e4f); outline-offset: 2px; }
#gz-cl .gz-cl-row { display: flex; flex-wrap: wrap; align-items: end; gap: 0.5rem 0.75rem; }
#gz-cl .gz-cl-list { display: grid; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
#gz-cl .gz-cl-list > li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.4rem 0.75rem; padding: 0.5rem 0.6rem;
  border: 1px solid var(--gz-line, #d0d7de); border-radius: var(--gz-radius-sm, calc(var(--gz-radius, 12px) * 1 / 2)); }
#gz-cl .gz-cl-main { display: grid; gap: 0.1rem; min-width: 0; overflow-wrap: anywhere; }
#gz-cl .gz-cl-field { display: grid; gap: 0.15rem; min-width: 0; }
#gz-cl legend { width: auto; margin: 0; padding: 0; border: 0; line-height: 1.45; }
#gz-cl .gz-cl-field > span, #gz-cl legend, #gz-cl .gz-cl-skip > span { font-size: 12px; color: var(--gz-ink-muted, #57606a); }
#gz-cl [data-unsure] :is(input, select) { border-color: var(--gz-warn, #b26b00); border-style: dashed; }
#gz-cl [data-unsure] > small { color: var(--gz-warn, #b26b00); font-weight: 600; }
#gz-cl :is(input:not([type="checkbox"]), select, textarea) { width: auto; max-width: 100%; margin: 0; padding: 0.25rem 0.4rem; height: auto; font: inherit;
  color: var(--gz-ink, #1f2328); background:var(--gz-surface-grain, none), var(--gz-surface-fill-2, var(--gz-surface-2, #f6f8fa)); border: 1px solid var(--gz-line-strong, #8c959f); border-radius: var(--gz-radius-sm, calc(var(--gz-radius, 12px) * 1 / 2)); }
#gz-cl textarea, #gz-cl input[type="url"], #gz-cl input[type="file"] { width: 100%; }
#gz-cl input[type="file"]::file-selector-button { margin-inline-end: 0.6rem; padding: 0.2rem 0.7rem; font: inherit; color: inherit; background:var(--gz-surface-grain, none), var(--gz-surface-fill, var(--gz-surface, #fff));
  border: 1px solid var(--gz-line-strong, #8c959f); border-radius: 999px; cursor: pointer; }
#gz-cl input[type="checkbox"] { margin: 0; accent-color: var(--gz-accent, #0b6e4f); }
#gz-cl .gz-cl-entry { display: grid; gap: 0.6rem; margin: 0; padding: 0.7rem 0.8rem; border: 1px solid var(--gz-line, #d0d7de); border-radius: var(--gz-radius-sm, calc(var(--gz-radius, 12px) * 1 / 2)); min-width: 0; }
#gz-cl .gz-cl-entry > legend { padding: 0 0.3rem; font-size: 13px; font-weight: 600; color: inherit; }
#gz-cl .gz-cl-entry[data-off] > :not(legend, .gz-cl-keep) { display: none; }
#gz-cl .gz-cl-keep, #gz-cl .gz-cl-day { display: inline-flex; align-items: center; gap: 0.3rem; cursor: pointer; }
#gz-cl .gz-cl-periods { display: grid; gap: 0.6rem; }
#gz-cl .gz-cl-period { display: grid; gap: 0.5rem; padding: 0.5rem 0.6rem; background:var(--gz-surface-grain, none), var(--gz-surface-fill-2, var(--gz-surface-2, #f6f8fa)); border-radius: var(--gz-radius-sm, calc(var(--gz-radius, 12px) * 1 / 2)); }
#gz-cl .gz-cl-days { display: flex; flex-wrap: wrap; gap: 0.3rem 0.7rem; margin: 0; padding: 0; border: 0; min-width: 0; }
#gz-cl .gz-cl-days > legend { float: left; width: 100%; margin: 0 0 0.1rem; padding: 0; }
#gz-cl .gz-cl-skip { display: flex; flex-wrap: wrap; align-items: end; gap: 0.4rem 0.6rem; }
#gz-cl .gz-cl-chips { display: contents; list-style: none; }
#gz-cl .gz-cl-chips li { display: inline-flex; align-items: center; gap: 0.2rem; padding: 0.1rem 0.15rem 0.1rem 0.5rem; font-size: 12px;
  border: 1px solid var(--gz-line, #d0d7de); border-radius: 999px; }
#gz-cl .gz-cl-chips button { padding: 0 0.4rem; border: 0; background: none; }
#gz-cl .gz-cl-ocr { padding: 0.4rem 0.6rem; border-inline-start: 3px solid var(--gz-warn, #b26b00); background:var(--gz-surface-grain, none), var(--gz-surface-fill-2, var(--gz-surface-2, #f6f8fa)); }
#gz-cl .gz-cl-say:empty { display: none; }
#gz-cl .gz-cl-say[role="alert"] { color: var(--gz-err, #b42318); font-weight: 600; }
#gz-cl [hidden] { display: none !important; }`;

  // The command palette's entry, on any Canvas or Ultra page.
  const cmds = () => [{ label: t('Class schedule'), hint: 'Glaze', group: 'Glaze', run: () => open().catch(() => {}) }];
  return { open, cmds };
})();

GZ_CLASSES_UI;
