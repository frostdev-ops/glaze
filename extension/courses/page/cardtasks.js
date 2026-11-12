// Tasks on course cards (enhance.cardTasks): Canvas's Dashboard cards and Blackboard Ultra's Courses page cards. Loaded
// on demand: the site's part (syncCardTasks) calls sync(on) from content.js's passes while cards are on the page. Each
// card lists its course's next items as Better To Do sees them (planner/todo.js build and card: its timeframe, past-due
// window, done rules, ticks on this device and marks in Canvas), from the same planner answer (storage.local todoCache).
// The site is asked only when that answer is missing or over two minutes old and the To Do list isn't on the page to ask
// itself, and what comes back is kept there for the list (and on Canvas the popup) too. Reads only: nothing here writes
// to the site. Classic script, through GZ_CTX; a second injection keeps the first.
// On Ultra's Activity page (stream.status, its own switch: stream(on)) the same answer gives each card that names an
// assignment where it stands, in the card tasks' words and colours, "Not submitted" for open work Blackboard has a standing for.
var GZ_CARD_TASKS = globalThis.GZ_CARD_TASKS || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const CACHE = 'todoCache';
  const FRESH = 120000; // as the list's
  const ACCEPT = 'application/json+canvas-string-ids, application/json';
  const TONE = { Missing: 'err', 'Submitted late': 'warn', Submitted: 'ok', Graded: 'ok', Excused: 'ok', Done: 'ok' };
  let L = null; // planner/todo.js
  let tz, uid = '', key = '', o = null, data = null, cache = null;
  let on = false, cards = false, streamOn = false, starting = null, asking = null, failed = 0, listed = false;
  let generation = 0, retired = false;
  const current = (g) => !retired && g === generation;
  let gs = null; // Gradescope's items for this site (planner/todo.js gradescope)
  let asked = null; // Gradescope's one-time question, while it's on the page

  const get = (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const readPrefs = () => new Promise((res) => { try { chrome.storage.sync.get('todo', (r) => res(r?.todo)); } catch { res(); } })
    .then((raw) => { o = GZ_SANITIZE({ todo: raw }).todo; });
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const chip = (s) => { const e = make('span', { className: 'gz-todo-chip', textContent: t(s) }); if (TONE[s]) e.dataset.tone = TONE[s]; return e; };
  // The cards: [selector, the card's course id, where the list goes after, the course's name]. Ultra's card is a link to
  // its course as a whole (a click anywhere on it opens the course), so the list keeps its own clicks and keys.
  const ultra = ctx.site === 'ultra';
  const CARDS = ultra
    ? ['article[id^="course-list-course-"]', (el) => el.dataset.courseId || el.id.slice(19), (el) => el.querySelector(':scope > .element-details'), (el) => el.querySelector('.js-course-title-element')?.textContent.trim() || '']
    : ['.ic-DashboardCard', (el) => el.querySelector('a[href*="/courses/"]')?.getAttribute('href')?.match(/\/courses\/(\d+)/)?.[1], (el) => el.querySelector(':scope > .ic-DashboardCard__header'), (el) => el.getAttribute('aria-label') || ''];
  const keep = (e) => e.stopPropagation();

  // ---- Canvas: the planner, as the list asks for it (planner/page/todo.js pages and load) ----
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
  // teach is null, and the list keeps these planner items and asks for the grading alone (planner/page/todo.js load).
  // It's kept through the worker, only if no newer one is stored (planner/todo.js publishIn): an answer asked for before the
  // one already kept (the list's, another tab's) is dropped, and the newer one shown.
  const load = async (g) => {
    const account = key;
    const now = Date.now();
    const { start, end } = L.fetchRange(o, now, tz);
    let c, due;
    if (ultra) {
      // Ultra: no teachers' grading, and no popup list from here (content.js keeps Ultra's own). Read only while still on.
      await ctx.need('courses/ultra.js', () => globalThis.GZ_ULTRA);
      if (!on || !current(g)) throw new Error('off');
      const r = await GZ_ULTRA.page.due(Date.parse(start), Date.parse(end));
      c = { key: account, at: r.at ?? now, epoch: r.epoch, start, end, teach: o.teacher, progress: o.progress, items: r.items, complete: r.complete, grading: [], sums: {} };
    } else {
      const [raw, list] = await Promise.all([pages(`/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`), ctx.canvasCourses()]);
      const teaches = list.some((c) => (c.enrollments || []).some((e) => /^(teacher|ta)/i.test(e.type || '')));
      c = { key: account, at: now, start, end, teach: o.teacher && teaches ? null : o.teacher, progress: o.progress, items: raw.map(L.slim), grading: [], sums: {} };
      due = GZ_CANVAS_DUE_WEEK(raw, now);
    }
    if (!on || !current(g)) return;
    const best = (await new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:todo', key: account, cache: c, due }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } }))?.cache || c;
    if (!on || !current(g)) return;
    if (!(cache?.key === key && cache.at > best.at)) cache = best;
    paint();
  };
  // When the cards start, the page is shown again and the list's settings change, and from content.js's passes while
  // the cards have nothing or the list that was to ask has gone (it failed). Not while the list is on the page, and not
  // within a minute of a failed ask.
  const refresh = (force = false) => {
    if (!on || !L || !mine || asking || Date.now() - failed < 60000 || (!force && fresh(cache, Date.now())) || document.getElementById('gz-todo')) return;
    const g = generation;
    const pending = load(g).catch(() => { if (current(g)) failed = Date.now(); }).finally(() => { if (asking === pending) asking = null; });
    asking = pending;
  };

  // ---- the cards ----
  // Only what changed is drawn again: a pass over unchanged cards writes nothing (each list keeps what it shows).
  // The same renderer for native cards and board cards. A board supplies only a stored planner answer.
  const render = (el, cid, head, course, { L, o, data, cache, uid, tz, extra = [] }) => {
    const now = Date.now(), lang = GZ_I18N.locale(ctx.locale());
    const was = el.querySelector(':scope > .gz-ct');
    if (!head || !cid || !cache) { was?.remove(); return; }
    // Ultra has no planner to tick in: its ticks are this device's, as Better To Do's there.
    // All of the course's rows are counted; o.cardN are shown, then "and N more" (the card grows to fit, never scrolls).
    const all = L.card(L.build({ items: [...(cache.items || []), ...extra], data, o, now, tz, course: cid, sync: !ultra && o.sync }), Infinity, o.cardCross, tz);
    const more = all.length - o.cardN;
    const rows = all.slice(0, o.cardN).map((r) => {
      // Undated work planned for a day (a "do on" day or a focus session) reads as planned for that day.
      const w = L.label(r.at === null ? { allDay: true, day: r.plan } : r, now, tz, lang);
      const text = o.rel ? w.rel : w.abs;
      return { ...r, when: r.at === null ? t('Planned for {when}', { when: text }) : r.type === 'planner_note' ? text : t(r.past ? 'Was due {when}' : 'Due {when}', { when: text }), other: o.rel ? w.abs : w.rel };
    });
    // Ultra couldn't send everything: said, and never "Nothing due".
    const part = cache.complete === false && t('Blackboard sent only part of your calendar, so some work may be missing.');
    const sig = JSON.stringify([o.cardStatus, part, more, rows.map((r) => [r.key, r.url, r.title, r.when, r.other, r.status, r.done, r.past])]);
    if (was?.dataset.sig === sig) return;
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
      }), more > 0 && make('li', { className: 'gz-ct-part', textContent: t('and {n} more', { n: more }) }), part && make('li', { className: 'gz-ct-part', textContent: part }))
      : make('p', { textContent: part || t('Nothing due') });
    box.className = 'gz-ct';
    box.dataset.sig = sig;
    if (ultra) for (const ev of ['click', 'keydown', 'pointerdown', 'mousedown']) box.addEventListener(ev, keep);
    if (rows.length) box.setAttribute('aria-label', t('Tasks for {course}', { course }));
    if (was) was.replaceWith(box); else head.after(box);
  };
  // Activity cards: a status after the card's name, drawn again only when its word changes.
  let streamed = false;
  const unstream = () => { if (!streamed) return; streamed = false; for (const e of document.querySelectorAll('.gz-stream-status')) e.remove(); };
  const paintStream = () => {
    const S = globalThis.GZ_STREAM;
    if (!S?.find) return;
    for (const row of document.querySelectorAll('#activity-stream .stream-item-container')) {
      const details = row.querySelector('.element-details'), name = details?.querySelector(':scope > .name');
      let box = details?.querySelector(':scope > .gz-stream-status');
      const context = details?.querySelector(':scope > .context');
      const course = context?.textContent.replace(/\s+/g, ' ').trim().toLowerCase() || '';
      // The course line is the course's name or its course ID (Glaze's course list keeps both, as code).
      const cid = course && Object.entries(ctx.courseList?.() || {}).find(([k, c]) => /^_\d+_\d+$/.test(k) && (!c?.site || c.site === location.origin) && [c?.code, c?.name].some((x) => x && x.replace(/\s+/g, ' ').trim().toLowerCase() === course))?.[0];
      // Only the card's identifying links count; excerpts can link to unrelated work.
      const links = [name, context].flatMap((e) => e ? [...e.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')) : []);
      const i = name && cache && S.find(cache.items || [], { links, title: name.textContent, course, cid });
      const word = i ? L.status(i, L.isDone(i, o.done, data.items[`${i.type}:${i.id}`]?.done)) || (i.sub ? 'Not submitted' : '') : '';
      if (!word) { box?.remove(); continue; }
      if (box?.dataset.word === word && box.previousElementSibling === name) continue;
      box?.remove();
      box = make('div', { className: 'gz-stream-status' }, chip(word));
      box.dataset.word = word;
      name.after(box);
      streamed = true;
    }
  };
  const paint = () => {
    if (!on || !data || !mine) return;
    if (streamOn) paintStream(); else unstream();
    if (!cards) { for (const e of document.querySelectorAll('.gz-ct')) e.remove(); asked?.remove(); asked = null; return; }
    const now = Date.now();
    const [sel, idOf, headOf, nameOf] = CARDS;
    for (const el of document.querySelectorAll(sel)) {
      const head = headOf(el);
      const cid = idOf(el);
      const was = el.querySelector(':scope > .gz-ct');
      if (!head || !cid || !cache) { was?.remove(); continue; }
      gs ||= L.gradescope(paint);
      render(el, cid, head, nameOf(el), { L, o, data, cache, uid, tz, extra: gs(now, uid) });
    }

    // Gradescope's one-time question (planner/todo.js gradescope question), one quiet line above the first card's tasks,
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
    if (ch[CACHE] && !ch[CACHE].newValue) cache = null;
    const c = ch[CACHE]?.newValue;
    if (c?.key === key && !(cache?.key === key && cache.at > c.at)) cache = c;
    if (ch[key]) data = L.clean(ch[key].newValue);
    paint();
  };
  document.addEventListener('glaze:ultra-refresh', (e) => {
    if (!ultra) return;
    if (e.detail?.identity || e.detail?.retire) {
      // A new identity must confirm itself again; no continuation from the old account may draw or publish.
      generation++;
      retired ||= !!e.detail.retire;
      mine = false;
      cache = data = starting = asking = null;
      uid = key = '';
      failed = 0;
      for (const el of document.querySelectorAll('.gz-ct')) el.remove();
      unstream(); asked?.remove(); asked = null;
      if (retired) cards = streamOn = false;
      run();
      return;
    }
    cache = null;
    if (on) refresh(true);
  });
  const onShow = () => { if (document.visibilityState === 'visible') refresh(); };
  // Who's signed in (their id names their data and the cache; their Canvas time zone counts the days), what's kept. On
  // Ultra the student last confirmed on this site answers first (courses/ultra.js page.known), so what's kept is read while
  // /users/me confirms who it is; sure says whether it's them, and the tasks show only once it is (mine).
  let heard = false, sure = null, mine = false;
  const start = async (g) => {
    await ctx.need('planner/todo.js', () => globalThis.GZ_TODO);
    if (!current(g)) throw new Error('stale');
    L = globalThis.GZ_TODO;
    const known = ultra ? await ctx.need('courses/ultra.js', () => globalThis.GZ_ULTRA).then(() => globalThis.GZ_ULTRA?.page?.known?.() || null, () => null) : null;
    if (!current(g)) throw new Error('stale');
    const [p] = known ? [known, await readPrefs()] : await Promise.all([ctx.profile(), readPrefs()]);
    if (!current(g)) throw new Error('stale');
    if (!L.ID.test(String(p?.id))) throw new Error('no profile');
    tz = L.zone(p.time_zone);
    uid = String(p.id);
    key = L.storeKey(location.origin, uid);
    mine = !known;
    sure = known ? () => ctx.profile().then((x) => String(x?.id) === String(p.id)) : () => true;
    const r = await get([key, CACHE]);
    if (!current(g)) throw new Error('stale');
    data = L.clean(r[key]);
    cache = r[CACHE]?.key === key ? r[CACHE] : null;
    if (heard) return;
    heard = true;
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.addEventListener('visibilitychange', onShow);
    addEventListener('focus', onShow);
  };
  // If it can't start (no profile), the cards stay as Canvas has them, and it tries again after a minute. Drawn for
  // another student than the one signed in: those tasks go, and it starts again.
  const sync = (want) => { cards = !!want; run(); };
  const stream = (want) => {
    streamOn = ultra && !retired && !!want;
    if (streamOn && !globalThis.GZ_STREAM) ctx.need('courses/stream.js', () => globalThis.GZ_STREAM).then(paint, () => {});
    run();
  };
  const run = () => {
    on = !retired && (cards || streamOn);
    if (!on) { for (const e of document.querySelectorAll('.gz-ct')) e.remove(); unstream(); asked?.remove(); asked = null; return; }
    const list = !!document.getElementById('gz-todo');
    // Started: whether the list is here now counts as seen, so its going later is noticed whenever it goes.
    const g = generation;
    if (!starting) starting = start(g).then(() => { if (!current(g)) return; listed = !!document.getElementById('gz-todo'); paint(); return sure(); }).then((ok) => {
      if (!current(g)) return;
      mine = ok;
      if (ok) { paint(); if (ultra && fresh(cache, Date.now())) setTimeout(() => { if (on) refresh(true); }, 0); else return refresh(); }
      for (const e of document.querySelectorAll('.gz-ct')) e.remove();
      unstream();
      cache = data = null;
      starting = null;
      run();
    }, () => { if (current(g)) setTimeout(() => { if (current(g)) starting = null; }, 60000); });
    else {
      paint();
      if (!cache || (listed && !list)) refresh();
    }
    if (L) listed = list;
  };

  return { sync, stream, render };
})();

GZ_CARD_TASKS;
