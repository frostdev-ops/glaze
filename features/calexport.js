// Export calendar (.ics) (Canvas): a file the student saves and imports into Google Calendar, Outlook or Apple Calendar
// themselves. Opened from Better To Do's header or the command palette (Ctrl+K); the options page keeps the same choices.
// Made entirely here, on the device: Canvas's planner is read for the range with the student's own session, as Better To
// Do reads it, and the file goes to the browser's own download through a blob link (no downloads permission). Nothing
// is sent anywhere. What goes in it is lib/calexport.js; lib/ics.js writes it.
// Loaded on demand: a second injection keeps the first.
var GZ_CAL_UI = globalThis.GZ_CAL_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter(Boolean)); return e; };
  const DAY = 864e5;
  let box = null, opener = null, say = null, busy = false;

  const readTodo = () => new Promise((res) => { try { chrome.storage.sync.get('todo', (r) => res(r?.todo)); } catch { res(); } });
  const local = (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (r) => res(r || {})); } catch { res({}); } });
  const libs = () => ctx.need('lib/todo.js', () => globalThis.GZ_TODO)
    .then(() => Promise.all([ctx.need('lib/ics.js', () => globalThis.GZ_ICS), ctx.need('lib/calexport.js', () => globalThis.GZ_CALEXPORT)]));
  // Canvas's planner over every page its Link header names, on this site only, as Better To Do reads it.
  // ponytail: ten pages (1,000 items).
  const pages = async (path) => {
    const out = [];
    let url = location.origin + path;
    for (let i = 0; url && i < 10; i++) {
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json+canvas-string-ids, application/json' } });
      if (!r.ok) throw new Error(String(r.status));
      const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
      if (Array.isArray(j)) out.push(...j);
      const next = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next && new URL(next, location.origin).origin === location.origin ? next : null;
    }
    return out;
  };

  // What the file may hold, read afresh from storage: Glaze on, the Gradescope switch and this Canvas account's answer
  // for the Gradescope account kept (sig), the Gradescope items that answer allows, and the student's own data.
  const sync = () => new Promise((res) => { try { chrome.storage.sync.get(null, (r) => res(r || {})); } catch { res({}); } });
  const state = async (key, uid) => {
    const [raw, kept] = await Promise.all([sync(), local([key, 'gradescope'])]);
    const s = GZ_SANITIZE(raw);
    const G = globalThis.GZ_GRADESCOPE;
    const d = G ? G.clean(kept.gradescope) : null;
    const sig = JSON.stringify([s.enabled, s.enhance.gradescope, d?.acct?.id, d?.bind[`${location.origin}/${uid}`]]);
    const gs = s.enabled && s.enhance.gradescope && G ? G.items(kept.gradescope, location.origin, uid, Date.now()) : [];
    return { on: s.enabled, gs, data: kept[key], sig };
  };

  // Makes the file for these choices and hands it to save(text) → its name: { n, name, guessed }, or null when it
  // stopped because something changed while Canvas answered (alive() false: the dialog closed; Glaze turned off; the
  // Gradescope switch or this account's answer changed since the export began). Checked right before the file is made
  // and again right before it's saved, with nothing awaited between that check and the save.
  const run = async (o, alive, save) => {
    const L = GZ_TODO, X = GZ_CALEXPORT;
    if (ctx.settings().enhance.gradescope) await ctx.need('lib/gradescope.js', () => globalThis.GZ_GRADESCOPE).catch(() => {});
    const [p, list] = await Promise.all([ctx.profile(), ctx.canvasCourses()]);
    if (!/^\d+$/.test(String(p?.id))) throw new Error('no profile');
    const uid = String(p.id), tz = L.zone(p.time_zone), now = Date.now();
    // The courses Better To Do shows: active ones the student can open. An empty answer (none, or the request failed)
    // filters nothing, as there.
    const live = list.filter((c) => /^\d+$/.test(String(c.id)) && c.name && !c.access_restricted_by_date);
    const names = Object.fromEntries(live.map((c) => [String(c.id), c.name]));
    const r = X.range(o.icsRange, now, tz, live);
    const key = L.storeKey(location.origin, uid);
    const before = await state(key, uid);
    // Planner items through eight weeks past the range, so a plan in the range for work due later has its title; and,
    // for plans whose work isn't among them (overdue work planned for later), half a year back, as far as Better To Do
    // looks. Past deadlines themselves stay out of the file; any plan still without its item goes in untitled.
    const iso = (ms) => new Date(ms).toISOString();
    const ask = (a, b) => pages(`/api/v1/planner/items?start_date=${iso(a)}&end_date=${iso(b)}&per_page=100`).then((x) => x.map(L.slim));
    let items = o.icsDue || o.icsPlan ? await ask(r.from, r.to + 56 * DAY) : [];
    if (o.icsPlan) {
      const read = new Set(items.map((i) => `${i.type}:${i.id}`));
      const want = X.planned((await local([key]))[key], r).filter((k) => !/^(task|gradescope):/.test(k) && !read.has(k));
      if (want.length) items = [...items, ...await ask(r.from - 180 * DAY, r.from)];
    }
    if (!alive()) return null;
    const a = await state(key, uid);
    if (!alive() || !a.on || a.sig !== before.sig) return null;
    const events = X.events({
      items, gs: a.gs, data: a.data, o, ...r, site: location.origin, host: location.host, cids: live.length ? new Set(Object.keys(names)) : null, names,
      words: { plan: (title) => t('Do: {title}', { title }), focus: (title) => t('Focus: {title}', { title }), untitled: t('Planned work') },
    });
    const text = GZ_ICS.write({ name: 'Glaze', events }, { now });
    const b = await state(key, uid);
    if (!alive() || !b.on || b.sig !== a.sig) return null;
    return { n: events.length, name: events.length ? save(text) : '', guessed: r.guessed };
  };

  const save = (text) => {
    const a = make('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/calendar' })), download: `glaze-calendar-${new Date().toISOString().slice(0, 10)}.ics` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return a.download;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    // Only the student's own click or key, never a script's.
    if (!e.isTrusted || busy) return;
    const f = new FormData(e.target);
    const o = { icsDue: f.has('icsDue'), icsTasks: f.has('icsTasks'), icsPlan: f.has('icsPlan'), icsRange: String(f.get('icsRange')) };
    // Gradescope's box is there only with Gradescope in To Do on; otherwise its choice stays as it was.
    if (e.target.elements.icsGs) o.icsGs = f.has('icsGs');
    // Remembered for next time (and shown in the options page).
    readTodo().then((todo) => { try { chrome.storage.sync.set({ todo: GZ_SANITIZE({ todo: { ...todo, ...o } }).todo }); } catch { /* reloaded */ } });
    busy = true;
    const mine = box;
    const line = say;
    line.textContent = t('Making your calendar…');
    try {
      const r = await run(o, () => box === mine && !!mine?.open, save);
      line.textContent = !r ? '' : !r.n ? t('Nothing to export in that range.')
        : [t('Saved {file}', { file: r.name }), r.guessed && t('Canvas gives no end date for this term, so this covers the next 16 weeks.')].filter(Boolean).join(' ');
    } catch {
      line.textContent = t("Couldn't make the calendar. Try again in a moment.");
    } finally { busy = false; }
  };

  const open = async () => {
    if (box) return box.querySelector('button')?.focus();
    await libs();
    if (box) return;
    const o = GZ_SANITIZE({ todo: await readTodo() }).todo;
    const check = (name, label) => make('label', { className: 'gz-ics-check' }, make('input', { type: 'checkbox', name, checked: o[name] }), make('span', { textContent: label }));
    const range = make('select', { name: 'icsRange' }, ...[['2w', 'Next 2 weeks'], ['4w', 'Next 4 weeks'], ['8w', 'Next 8 weeks'], ['16w', 'Next 16 weeks'], ['term', 'This term']]
      .map(([value, label]) => make('option', { value, textContent: t(label), selected: o.icsRange === value })));
    say = make('p', { className: 'gz-ics-say', role: 'status' });
    const close = make('button', { type: 'button', textContent: t('Close') });
    close.addEventListener('click', () => box.close());
    const form = make('form', {},
      make('h2', { id: 'gz-ics-title', textContent: t('Export calendar (.ics)') }),
      make('p', { className: 'gz-ics-desc', textContent: t('Made on this device. The file holds your course and assignment names: import it into Google Calendar, Outlook or Apple Calendar yourself. Importing a newer file updates the same events where your calendar supports it.') }),
      make('fieldset', {}, check('icsDue', t('Canvas due dates')), check('icsTasks', t('Your tasks with a due date')), check('icsPlan', t('Do-on days and focus sessions')),
        ctx.settings().enhance.gradescope && check('icsGs', t('Gradescope work'))),
      make('label', { className: 'gz-ics-range' }, make('span', { textContent: t('Range') }), range),
      say,
      make('div', { className: 'gz-ics-row' }, make('button', { type: 'submit', textContent: t('Download') }), close));
    form.addEventListener('submit', onSubmit);
    opener = document.activeElement;
    box = make('dialog', { id: 'gz-ics' }, form);
    box.setAttribute('aria-labelledby', 'gz-ics-title');
    box.addEventListener('click', (e) => { if (e.target === box) box.close(); });
    box.addEventListener('close', () => { box?.remove(); box = null; if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    document.body.append(box);
    box.showModal();
  };

  return { open, run };
})();

GZ_CAL_UI;
