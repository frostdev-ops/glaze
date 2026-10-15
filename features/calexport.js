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

  // The file for these choices: { text, n, guessed }.
  const build = async (o) => {
    const L = GZ_TODO, X = GZ_CALEXPORT;
    const [p, list] = await Promise.all([ctx.profile(), ctx.canvasCourses()]);
    if (!/^\d+$/.test(String(p?.id))) throw new Error('no profile');
    const tz = L.zone(p.time_zone), now = Date.now();
    // The courses Better To Do shows: active ones the student can open. An empty answer (none, or the request failed)
    // filters nothing, as there.
    const live = list.filter((c) => /^\d+$/.test(String(c.id)) && c.name && !c.access_restricted_by_date);
    const names = Object.fromEntries(live.map((c) => [String(c.id), c.name]));
    const r = X.range(o.icsRange, now, tz, live);
    const gsOn = ctx.settings().enhance.gradescope && (o.icsGs || o.icsPlan);
    if (gsOn) await ctx.need('lib/gradescope.js', () => globalThis.GZ_GRADESCOPE);
    const key = L.storeKey(location.origin, String(p.id));
    const kept = await local([key, ...(gsOn ? [GZ_GRADESCOPE.KEY] : [])]);
    // Planner items through eight weeks past the range, so a plan in the range for work due later still has its title.
    // ponytail: a plan for work due more than eight weeks after the range is left out.
    const iso = (ms) => new Date(ms).toISOString();
    const items = o.icsDue || o.icsPlan ? (await pages(`/api/v1/planner/items?start_date=${iso(r.from)}&end_date=${iso(r.to + 56 * DAY)}&per_page=100`)).map(L.slim) : [];
    const gs = gsOn ? GZ_GRADESCOPE.items(kept[GZ_GRADESCOPE.KEY], location.origin, String(p.id), now) : [];
    const events = X.events({
      items, gs, data: kept[key], o, ...r, site: location.origin, host: location.host, cids: live.length ? new Set(Object.keys(names)) : null, names,
      words: { plan: (title) => t('Do: {title}', { title }), focus: (title) => t('Focus: {title}', { title }) },
    });
    return { text: GZ_ICS.write({ name: 'Glaze', events }, { now }), n: events.length, guessed: r.guessed };
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
    say.textContent = t('Making your calendar…');
    try {
      const r = await build(o);
      say.textContent = !r.n ? t('Nothing to export in that range.')
        : [t('Saved {file}', { file: save(r.text) }), r.guessed && t('Canvas gives no end date for this term, so this covers the next 16 weeks.')].filter(Boolean).join(' ');
    } catch {
      say.textContent = t("Couldn't make the calendar. Try again in a moment.");
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

  return { open };
})();

GZ_CAL_UI;
