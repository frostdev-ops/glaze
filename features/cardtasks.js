// Tasks on course cards (enhance.cardTasks): Canvas's Dashboard cards and Blackboard Ultra's Courses page cards. Loaded
// on demand: the site's part (syncCardTasks) calls sync(on) from content.js's passes while cards are on the page. Each
// card lists its course's next items as Better To Do sees them (lib/todo.js build and card: its timeframe, past-due
// window, done rules, ticks on this device and marks in Canvas), from the same planner answer (storage.local todoCache).
// The site is asked only when that answer is missing or over two minutes old and the To Do list isn't on the page to ask
// itself, and what comes back is kept there for the list (and on Canvas the popup) too. Reads only: nothing here writes
// to the site. Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_CARD_TASKS = globalThis.GZ_CARD_TASKS || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const CACHE = 'todoCache';
  const FRESH = 120000; // as the list's
  const ACCEPT = 'application/json+canvas-string-ids, application/json';
  const TONE = { Missing: 'err', 'Submitted late': 'warn', Submitted: 'ok', Graded: 'ok', Excused: 'ok', Done: 'ok' };
  let L = null; // lib/todo.js
  let tz, uid = '', key = '', o = null, data = null, cache = null;
  let on = false, starting = null, asking = null, failed = 0, listed = false;
  let gs = null; // Gradescope's items for this site (lib/todo.js gradescope)
  let asked = null; // Gradescope's one-time question, while it's on the page

  const get = (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const readPrefs = () => new Promise((res) => { try { chrome.storage.sync.get('todo', (r) => res(r?.todo)); } catch { res(); } })
    .then((raw) => { o = GZ_SANITIZE({ todo: raw }).todo; });
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const chip = (s) => { const e = make('span', { className: 'gz-todo-chip', textContent: t(s) }); e.dataset.tone = TONE[s]; return e; };
  // The cards: [selector, the card's course id, where the list goes after, the course's name]. Ultra's card is a link to
  // its course as a whole (a click anywhere on it opens the course), so the list keeps its own clicks and keys.
  const ultra = ctx.site === 'ultra';
  const CARDS = ultra
    ? ['article[id^="course-list-course-"]', (el) => el.dataset.courseId || el.id.slice(19), (el) => el.querySelector(':scope > .element-details'), (el) => el.querySelector('.js-course-title-element')?.textContent.trim() || '']
    : ['.ic-DashboardCard', (el) => el.querySelector('a[href*="/courses/"]')?.getAttribute('href')?.match(/\/courses\/(\d+)/)?.[1], (el) => el.querySelector(':scope > .ic-DashboardCard__header'), (el) => el.getAttribute('aria-label') || ''];
  const keep = (e) => e.stopPropagation();

  // ---- Canvas: the planner, as the list asks for it (features/todo.js pages and load) ----
  // ponytail: ten pages (1,000 items), as there.
  const pages = async (path) => {
    const out = [];
    let url = location.origin + path;
    for (let i = 0; url && i < 10; i++) {
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: ACCEPT } });
      if (!r.ok) throw new Error(String(r.status));
      const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
      if (Array.isArray(j)) out.push(...j);
      const next = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next && new URL(next, location.origin).origin === location.origin ? next : null;
    }
    return out;
  };
  const fresh = (c, now) => {
    if (c?.key !== key || now - c.at >= FRESH) return false;
    const need = L.fetchRange(o, now, tz);
    return Date.parse(c.start) <= Date.parse(need.start) && Date.parse(c.end) >= Date.parse(need.end) - L.DAY;
  };
  // Kept in the list's shape, so the list takes it as its own. A teacher's list also wants the grading: for a teacher,
  // teach is null, and the list keeps these planner items and asks for the grading alone (features/todo.js load).
  // It's kept through the worker, only if no newer one is stored (lib/todo.js publishIn): an answer asked for before the
  // one already kept (the list's, another tab's) is dropped, and the newer one shown.
  const load = async () => {
    const now = Date.now();
    const { start, end } = L.fetchRange(o, now, tz);
    let c, due;
    if (ultra) {
      // Ultra: no teachers' grading, and no popup list from here (content.js keeps Ultra's own).
      const r = await ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.page.due(Date.parse(start), Date.parse(end)));
      c = { key, at: now, start, end, teach: o.teacher, progress: o.progress, items: r.items, complete: r.complete, grading: [], sums: {} };
    } else {
      const [raw, list] = await Promise.all([pages(`/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`), ctx.canvasCourses()]);
      const teaches = list.some((c) => (c.enrollments || []).some((e) => /^(teacher|ta)/i.test(e.type || '')));
      c = { key, at: now, start, end, teach: o.teacher && teaches ? null : o.teacher, progress: o.progress, items: raw.map(L.slim), grading: [], sums: {} };
      due = GZ_CANVAS_DUE_WEEK(raw, now);
    }
    const best = (await new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:todo', key, cache: c, due }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } }))?.cache || c;
    if (!(cache?.key === key && cache.at > best.at)) cache = best;
    paint();
  };
  // When the cards start, the page is shown again and the list's settings change, and from content.js's passes while
  // the cards have nothing or the list that was to ask has gone (it failed). Not while the list is on the page, and not
  // within a minute of a failed ask.
  const refresh = () => {
    if (!on || !L || asking || Date.now() - failed < 60000 || fresh(cache, Date.now()) || document.getElementById('gz-todo')) return;
    asking = load().catch(() => { failed = Date.now(); }).finally(() => { asking = null; });
  };

  // ---- the cards ----
  // Only what changed is drawn again: a pass over unchanged cards writes nothing (each list keeps what it shows).
  const paint = () => {
    if (!on || !data) return;
    const now = Date.now();
    const lang = GZ_I18N.locale(ctx.locale());
    const [sel, idOf, headOf, nameOf] = CARDS;
    for (const el of document.querySelectorAll(sel)) {
      const head = headOf(el);
      const cid = idOf(el);
      const was = el.querySelector(':scope > .gz-ct');
      if (!head || !cid || !cache) { was?.remove(); continue; }
      gs ||= L.gradescope(paint);
      const rows = L.card(L.build({ items: [...(cache.items || []), ...gs(now, uid)], data, o, now, tz, course: cid, sync: o.sync }), o.cardN, o.cardCross, tz).map((r) => {
        // Undated work planned for a day (a "do on" day or a focus session) reads as planned for that day.
        const w = L.label(r.at === null ? { allDay: true, day: r.plan } : r, now, tz, lang);
        const text = o.rel ? w.rel : w.abs;
        return { ...r, when: r.at === null ? t('Planned for {when}', { when: text }) : r.type === 'planner_note' ? text : t(r.past ? 'Was due {when}' : 'Due {when}', { when: text }), other: o.rel ? w.abs : w.rel };
      });
      const sig = JSON.stringify([o.cardStatus, rows.map((r) => [r.key, r.url, r.title, r.when, r.other, r.status, r.done, r.past])]);
      if (was?.dataset.sig === sig) continue;
      const course = nameOf(el);
      const box = rows.length
        ? make('ul', {}, ...rows.map((r) => {
          const li = make('li', {}, make(r.url ? 'a' : 'span', { className: 'gz-ct-row', ...(r.url && { href: r.url }) },
            make('span', { className: 'gz-ct-t', textContent: r.title }),
            make('span', { className: 'gz-ct-when', title: r.other, textContent: r.when }),
            r.type === 'gradescope' && make('span', { className: 'gz-todo-chip', textContent: 'Gradescope' }),
            r.status && (o.cardStatus ? chip(r.status) : r.done && make('span', { className: 'screenreader-only', textContent: t(r.status) }))));
          if (r.done) li.dataset.done = '';
          if (r.past) li.dataset.past = '';
          return li;
        }))
        : make('p', { textContent: t('Nothing due') });
      box.className = 'gz-ct';
      box.dataset.sig = sig;
      if (ultra) for (const ev of ['click', 'keydown', 'pointerdown', 'mousedown']) box.addEventListener(ev, keep);
      if (rows.length) box.setAttribute('aria-label', t('Tasks for {course}', { course }));
      if (was) was.replaceWith(box); else head.after(box);
    }
    // Gradescope's one-time question (lib/todo.js gradescope question), one quiet line above the first card's tasks,
    // unless Better To Do on this page asks it already (one question a page); drawn again only when what it asks
    // changes, so a pass never moves focus off it.
    const q = document.getElementById('gz-todo') ? null : gs?.question(uid, t, 'gz-ct-ask') ?? null;
    const first = q && document.querySelector(`${sel} > .gz-ct`);
    if (!first) { asked?.remove(); asked = null; } else if (asked?.dataset.ask !== q.dataset.ask || !asked.isConnected || asked.nextElementSibling !== first) {
      asked?.remove();
      asked = q;
      first.before(q);
    }
  };

  const onStore = (ch, area) => {
    if (area === 'sync' && ch.todo) return void readPrefs().then(() => { paint(); refresh(); });
    if (area !== 'local' || !(ch[CACHE] || ch[key])) return;
    const c = ch[CACHE]?.newValue;
    if (c?.key === key && !(cache?.key === key && cache.at > c.at)) cache = c;
    if (ch[key]) data = L.clean(ch[key].newValue);
    paint();
  };
  const onShow = () => { if (document.visibilityState === 'visible') refresh(); };
  // Who's signed in (their id names their data and the cache; their Canvas time zone counts the days), what's kept.
  const start = async () => {
    await ctx.need('lib/todo.js', () => globalThis.GZ_TODO);
    L = globalThis.GZ_TODO;
    const [p] = await Promise.all([ctx.profile(), readPrefs()]);
    if (!L.ID.test(String(p?.id))) throw new Error('no profile');
    tz = L.zone(p.time_zone);
    uid = String(p.id);
    key = L.storeKey(location.origin, uid);
    const r = await get([key, CACHE]);
    data = L.clean(r[key]);
    cache = r[CACHE]?.key === key ? r[CACHE] : null;
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.addEventListener('visibilitychange', onShow);
    addEventListener('focus', onShow);
  };
  // If it can't start (no profile), the cards stay as Canvas has them, and it tries again after a minute.
  const sync = (want) => {
    on = !!want;
    if (!on) { for (const e of document.querySelectorAll('.gz-ct')) e.remove(); asked?.remove(); asked = null; return; }
    const list = !!document.getElementById('gz-todo');
    // Started: whether the list is here now counts as seen, so its going later is noticed whenever it goes.
    if (!starting) starting = start().then(() => { listed = !!document.getElementById('gz-todo'); paint(); refresh(); }, () => { setTimeout(() => { starting = null; }, 60000); });
    else {
      paint();
      if (!cache || (listed && !list)) refresh();
    }
    if (L) listed = list;
  };

  return { sync };
})();

GZ_CARD_TASKS;
