// Reminders and streak (Canvas, W11): the student's own opt-in, every part off by default (enhance.remind, remindExam,
// remindPlan, streak). content.js loads this (need) in the top frame of a Canvas page only while one of them is on, and
// calls sync(on) from its passes; the logic is lib/remind.js. Nothing leaves the page: no notifications permission, no
// badge, no sound. A reminder is a toast in the page's corner (one at a time, never taking focus, shown only in the tab
// being looked at, never on a quiz being taken or a tool's page) and a hub from the To Do header and the command palette.
// One setTimeout to the next reminder, set again when the page is shown or focused, and at most ten minutes long (a
// timer stalls while the computer sleeps): never a poll.
// It reads the shared planner answer (storage.local todoCache) and asks Canvas's planner itself only when that is missing
// or ten minutes old and neither the To Do list nor the card tasks are on the page to ask. What's seen, snoozed, muted
// and the streak are kept on this device (storage.local remind:<site>/<user>) through the worker's queue
// (lib/background.js 'glaze:remind'), apart from Canvas's own read state, which nothing here touches.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_REMIND_UI = globalThis.GZ_REMIND_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const CACHE = 'todoCache';
  const OLD = 6e5;
  const H = 36e5;
  const ACCEPT = 'application/json+canvas-string-ids, application/json';
  const CATS = [['remind', 'Due-date reminders'], ['remindExam', 'Exam reminders'], ['remindPlan', 'Plan reminders'], ['remindClass', 'Class reminders'], ['streak', 'Streak']];
  const KIND = { due: 'Due date', exam: 'Exam', day: 'Planned day', session: 'Focus session', class: 'Class' };
  let T = null, R = null, who = null, todoKey = '', key = '';
  let todoO = null, o = null, data = { tasks: [], items: {} }, cache = null, st = null, cids = null;
  let on = false, starting = null, asking = null, failed = 0, timer = 0, writing = false, sig = '';
  let busy = false, wait = 0; // a claim in flight; no new one before wait (the worker didn't answer)
  let unacked = null; // { ids, lease }: a toast drawn whose acknowledgement the worker hasn't kept yet
  const drawn = new Set(); // every reminder this page has drawn, for the page's life
  const tab = crypto.randomUUID(); // this page, to the worker's leases (lib/remind.js claim and confirm)
  let live = null, hub = null, opener = null, run = null; // run: the streak as reckoned last
  let gs = null; // Gradescope's items for this site (lib/todo.js gradescope)
  const sources = new Map(); // reminders other packages add (class start W14, study W18): name -> () => events
  // Class start (enhance.remindClass): the class schedule kept on this device (lib/classes.js, storage.local classes:<site>/<user>).
  let classes = null, ckey = '';
  sources.set('class', () => {
    if (!en().remindClass || !classes) return [];
    if (!globalThis.GZ_CLASSES) { ctx.need('lib/classes.js', () => globalThis.GZ_CLASSES).then(() => { if (on) arm(); }, () => {}); return []; }
    return GZ_CLASSES.events(classes, { now: Date.now(), tz: who.tz, lead: +o.cls });
  });

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const button = (text, act, label) => { const b = make('button', { type: 'button', textContent: text }); b.dataset.act = act; if (label) b.setAttribute('aria-label', label); return b; };
  const get = (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const readPrefs = () => new Promise((res) => { try { chrome.storage.sync.get(['todo', 'remind'], (r) => res(r || {})); } catch { res({}); } })
    .then((r) => { const s = GZ_SANITIZE({ todo: r.todo, remind: r.remind }); todoO = s.todo; o = s.remind; });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:remind', key, ...m }, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const lang = () => GZ_I18N.locale(ctx.locale());
  const en = () => ctx.settings().enhance;
  const reminding = () => en().remind || en().remindExam || en().remindPlan || en().remindClass;
  // A person did this (a trusted click or key), not a script on the page.
  const human = (e) => e.isTrusted && (navigator.userActivation?.isActive ?? true);
  const ns = 'http://www.w3.org/2000/svg';
  const bell = () => {
    const s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', 'M5 17h14l-1.6-2.2V10a5.4 5.4 0 0 0-10.8 0v4.8zM10 20.2a2.1 2.1 0 0 0 4 0');
    s.append(p);
    return s;
  };

  // ---- Canvas's planner, as the list asks for it (features/todo.js and cardtasks.js), kept in the list's shape ----
  const pages = async (path) => {
    const out = [];
    let url = location.origin + path;
    for (let i = 0; url && i < 10; i++) { // ponytail: ten pages (1,000 items), as there
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: ACCEPT } });
      if (!r.ok) throw new Error(String(r.status));
      const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
      if (Array.isArray(j)) out.push(...j);
      const next = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next && new URL(next, location.origin).origin === location.origin ? next : null;
    }
    return out;
  };
  const load = async () => {
    const now = Date.now();
    const { start, end } = T.fetchRange(todoO, now, who.tz);
    const [raw, list] = await Promise.all([pages(`/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`), ctx.canvasCourses()]);
    const teaches = list.some((c) => (c.enrollments || []).some((e) => /^(teacher|ta)/i.test(e.type || '')));
    const c = { key: todoKey, at: now, start, end, teach: todoO.teacher && teaches ? null : todoO.teacher, progress: todoO.progress, items: raw.map(T.slim), grading: [], sums: {} };
    const r = await new Promise((res) => { try { chrome.runtime.sendMessage({ type: 'glaze:todo', key: todoKey, cache: c, due: GZ_CANVAS_DUE_WEEK(raw, now) }, (x) => res(chrome.runtime.lastError ? null : x)); } catch { res(null); } });
    const best = r?.cache || c;
    if (!(cache?.key === todoKey && cache.at > best.at)) cache = best;
    arm();
  };
  // The To Do list and the card tasks ask for themselves where they run, if they're on: by content.js's own gates
  // (todoHere; cardsHere with Canvas's course cards on the page, as syncCardTasks), not by whether they've drawn yet.
  // The Dashboard without cards (its list view) has no card tasks, so there this asks for itself.
  const theyAsk = () => {
    const e = en(), p = location.pathname;
    return (e.todo && /^\/(courses\/\d+\/?)?$/.test(p)) || (e.cardTasks && p === '/' && !!document.querySelector('.ic-DashboardCard'));
  };
  // Class reminders alone (the class schedule kept on this device) never ask Canvas for the planner.
  const planner = () => en().remind || en().remindExam || en().remindPlan || en().streak;
  const refresh = () => {
    const now = Date.now();
    if (!on || !T || asking || !planner() || now - failed < 6e4 || (cache && now - cache.at < OLD) || theyAsk()) return;
    asking = load().catch(() => { failed = Date.now(); }).finally(() => { asking = null; });
  };

  // ---- what's due when ----------------------------------------------------------------------------------------
  // The list over the next eight days and the past month, as Better To Do counts it (lib/todo.js build).
  const reckon = (now) => {
    gs ||= T.gradescope(() => { if (on) arm(); });
    const b = T.build({ items: [...(cache?.items || []), ...gs(now, who.uid)], data, o: { ...todoO, span: 'custom', unit: 'days', n: 8, start: 'rolling', past: 'month', group: false }, now, tz: who.tz, cids, sync: todoO.sync });
    const extra = [...sources.values()].flatMap((f) => { try { return f() || []; } catch { return []; } });
    return { b, evs: R.events({ rows: b.groups.flatMap(([, l]) => l), cats: { due: en().remind, exam: en().remindExam, plan: en().remindPlan }, o, tz: who.tz, extra }) };
  };
  // Not over a quiz being taken or a tool's page (New Quizzes), and only in the tab being looked at: it waits for the next.
  const quiet = () => document.visibilityState !== 'visible' || /\/quizzes\/\d+\/take|\/external_tools\//.test(location.pathname);
  const arm = () => {
    clearTimeout(timer);
    timer = 0;
    if (!on || !st) return;
    const now = Date.now();
    const { b, evs } = reckon(now);
    if (en().streak && cache) keepStreak(b, now);
    paintHead();
    if (hub) drawHub();
    const p = reminding() ? R.pending(evs, st, now, tab) : { show: [], next: Infinity };
    // A toast drawn but not yet acknowledged: only the acknowledgement is sent again, never the toast. Nothing this page
    // has drawn is drawn here again, acknowledged or not.
    const fresh = p.show.filter((e) => !drawn.has(e.id));
    if (unacked) { if (!busy && now >= wait) retry(); } else if (fresh.length && !quiet() && !busy && now >= wait) fire({ ...p, show: fresh, ids: p.ids.filter((id) => !drawn.has(id)) });
    const next = Math.min(p.next, wait > now ? wait : Infinity, en().streak ? T.midnight(T.dayOf(now, who.tz) + 1, who.tz) : Infinity);
    if (next < Infinity) timer = setTimeout(arm, Math.max(1000, Math.min(next - now, OLD)));
  };
  // Every tab may have the same reminder due: the one whose claim the worker takes first holds it, shows it, and then
  // confirms it, which marks it seen. Whether this tab may show anything is asked again once the worker answers: hidden
  // by then, on a quiz, or turned off, it shows nothing and confirms nothing, and the lease runs out for this tab or
  // another to show it later. An answer that came after its lease ended shows nothing either: by then another tab may
  // hold and have shown it. A worker that doesn't answer is asked again after a lease's length, not at once.
  // An answer that keeps none of them is not an acknowledgement. What's left once seen ones and ones another tab now
  // holds are dropped is this page's lease gone past its grace: it takes a new one, quietly (nothing is drawn), and
  // confirms under that, once; anything still left is asked again a lease later.
  const ack = async (again = true) => {
    const c = await send({ op: 'confirm', ids: unacked.ids, lease: unacked.lease, tab });
    if (!c?.ok) return false;
    st = R.clean(c.data);
    const now = Date.now();
    const kept = new Set(c.confirmed || []);
    let left = unacked.ids.filter((id) => !kept.has(id) && !st.seen[id] && !(st.held[id] && st.held[id].by !== tab && st.held[id].until > now));
    if (left.length && again) {
      const r = await send({ op: 'claim', ids: left, tab });
      if (r?.ok) {
        st = R.clean(r.data);
        left = left.filter((id) => r.claimed.includes(id));
        if (!left.length) { unacked = null; return true; }
        unacked = { ids: left, lease: r.lease };
        return ack(false);
      }
    }
    unacked = left.length ? { ids: left, lease: unacked.lease } : null;
    return !unacked;
  };
  const settled = (ok) => { busy = false; if (!ok) wait = Date.now() + R.LEASE; if (on) arm(); };
  const fire = (p) => {
    busy = true;
    let ok = false;
    return send({ op: 'claim', ids: p.ids, tab }).then((r) => {
      if (!r?.ok) return;
      st = R.clean(r.data);
      ok = true;
      const mine = new Set(r.claimed);
      const show = p.show.filter((e) => mine.has(e.id));
      if (!show.length || !on || quiet() || !(Date.now() < r.until)) return;
      toast(show[0], p.show.length - 1);
      for (const id of mine) drawn.add(id); // the toast stands for all of them ("N more")
      unacked = { ids: [...mine], lease: r.lease };
      tries = 0;
      return ack().then((x) => { ok = x; });
    }).finally(() => settled(ok));
  };
  // At most ACKS retries, a lease apart; then this page lets it go. It never draws it again; a later page may.
  const ACKS = 5;
  let tries = 0;
  const retry = () => {
    busy = true;
    tries++;
    const done = (ok) => { if (!ok && tries >= ACKS) unacked = null; settled(ok); };
    ack().then(done, () => done(false));
  };
  const keepStreak = (b, now) => {
    const s = R.streak(b, st.streak, T.dayOf(now, who.tz));
    run = s;
    const was = st.streak;
    if (writing || (was && s.start === was.start && s.best === was.best)) return;
    writing = true;
    const { current, extended, ...keep } = s;
    send({ op: 'streak', from: was?.start ?? null, streak: keep }).then((r) => { writing = false; if (r?.data) { st = R.clean(r.data); arm(); } });
  };

  // ---- the toast ----------------------------------------------------------------------------------------------
  const when = (at, now) => T.label({ at }, now, who.tz, lang());
  const what = (e, now) => {
    const rel = e.allDay ? T.label({ allDay: true, day: e.day }, now, who.tz, lang()).rel : when(e.end, now).rel;
    if (e.cat === 'due') return t('Due {when}', { when: rel });
    if (e.cat === 'exam') return t('Exam {when}', { when: rel });
    if (e.cat === 'day') return t('Planned for today');
    if (e.cat === 'session') return t('Focus session {when}', { when: rel });
    if (e.cat === 'class') return t('Class {when}', { when: rel });
    return e.text || '';
  };
  // The region is on the page, empty, before anything is said in it, so a screen reader announces what comes.
  const region = () => {
    if (live?.isConnected) return live;
    live = make('div', { className: 'gz-rm-live' });
    live.setAttribute('aria-live', 'polite');
    live.addEventListener('click', onToast);
    live.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); hide(); } });
    document.body.append(live);
    return live;
  };
  const hide = () => {
    const had = live?.contains(document.activeElement);
    live?.replaceChildren();
    if (had) document.querySelector('#gz-todo .gz-rm-bell, #gz-todo .gz-rm-streak')?.focus({ preventScroll: true });
  };
  // A class about to start, with the notes app on: its course's notes, a new note ready (features/notes.js).
  const notesFor = (e) => (e.cat === 'class' && en().notes && e.url?.match(/^\/courses\/(\d+)$/)?.[1]) || '';
  const toast = (e, more) => {
    const now = Date.now();
    const title = e.url ? make('a', { href: e.url, className: 'gz-rm-title', textContent: e.title }) : make('strong', { className: 'gz-rm-title', textContent: e.title });
    const snooze = e.until > now + H && button(t('Snooze 1 hour'), 'snooze');
    const card = make('section', { className: 'gz-rm-toast' },
      make('p', { className: 'gz-rm-what' }, make('span', { textContent: what(e, now) }), button('×', 'hide', t('Dismiss'))),
      title, (e.course || e.key.startsWith('gradescope:')) && make('p', { className: 'gz-rm-course', textContent: [e.course, e.key.startsWith('gradescope:') && 'Gradescope'].filter(Boolean).join(' · ') }),
      make('div', { className: 'gz-rm-row' }, snooze, !!notesFor(e) && button(t('Open course notes'), 'notes'), button(more > 0 ? t('All reminders ({n} more)', { n: more }) : t('All reminders'), 'hub')));
    card.setAttribute('aria-label', t('Glaze reminder'));
    card.dataset.id = e.id;
    if (notesFor(e)) card.dataset.course = notesFor(e);
    region().replaceChildren(card);
  };
  const onToast = (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    const id = ev.target.closest('[data-id]')?.dataset.id;
    if (act === 'hide') hide();
    else if (act === 'hub') { hide(); openHub(); }
    else if (act === 'notes' && human(ev)) { const course = ev.target.closest('[data-course]')?.dataset.course; hide(); ctx.need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.open({ course, create: true }), () => {}); }
    else if (act === 'snooze' && id && human(ev)) {
      hide();
      send({ op: 'snooze', id, until: Date.now() + H }).then((r) => {
        if (r?.ok) {
          // Snoozed on purpose: this page may draw it again when the hour is up, and no pending acknowledgement
          // marks it seen meanwhile.
          drawn.delete(id);
          const left = unacked?.ids.filter((x) => x !== id);
          if (unacked) unacked = left.length ? { ...unacked, ids: left } : null;
          st = R.clean(r.data);
        }
        arm();
      });
    }
  };

  // ---- the To Do header: the streak and the way into the hub ---------------------------------------------------------
  const headEl = make('span', { className: 'gz-rm-head' });
  headEl.addEventListener('click', (e) => { if (e.target.closest('[data-act="hub"]')) openHub(); });
  let headSig = '';
  const paintHead = () => {
    const s = run && en().streak ? run : null;
    const next = JSON.stringify([s?.current, s?.best, reminding(), lang()]);
    if (next !== headSig) {
      headSig = next;
      const streak = s && button(t('Streak: {n}', { n: s.current }), 'hub');
      if (streak) { streak.className = 'gz-rm-streak'; streak.title = t('Days in a row with nothing missed. Best: {n}', { n: s.best }); }
      const ring = reminding() && button('', 'hub', t('Reminders'));
      if (ring) { ring.className = 'gz-rm-bell'; ring.title = t('Reminders'); ring.append(bell()); }
      headEl.replaceChildren(...[streak, ring].filter(Boolean));
    }
    // Into the To Do list's header when it's on the page without it (the list draws it there itself from then on).
    const h = document.querySelector('#gz-todo .gz-todo-head');
    if (h && !h.contains(headEl)) { const add = h.querySelector('[data-focus="add"]'); if (add) add.before(headEl); else h.append(headEl); }
  };

  // ---- the hub ------------------------------------------------------------------------------------------------------
  const check = (label, k, checked, desc) => {
    const i = make('input', { type: 'checkbox', checked });
    i.dataset.key = k;
    return make('label', { className: 'gz-rm-check' }, i, make('span', { textContent: label }), desc && make('small', { textContent: desc }));
  };
  const pick = (label, k, value, opts) => {
    const s = make('select', {}, ...opts.map(([v, text]) => make('option', { value: v, textContent: text, selected: v === value })));
    s.dataset.key = k;
    return make('label', { className: 'gz-rm-pick' }, make('span', { textContent: label }), s);
  };
  const LEADS = [['m15', '15 minutes'], ['h1', '1 hour'], ['h3', '3 hours'], ['d1', '1 day'], ['d2', '2 days']];
  const drawHub = () => {
    const now = Date.now();
    const { b, evs } = reckon(now);
    const titles = new Map([...b.groups.flatMap(([, l]) => l), ...b.done, ...b.graded].map((r) => [r.key, r.title]));
    const was = hub.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const parts = [make('div', { className: 'gz-rm-top' }, make('h2', { id: 'gz-rm-title', textContent: t('Reminders') }), button('×', 'close', t('Close'))),
      gs?.question(who.uid, t, 'gz-rm-gs')]; // Gradescope's one-time question (lib/todo.js gradescope), when there is one
    if (en().streak && run) {
      const month = T.dayKey(T.dayOf(now, who.tz)).slice(0, 7);
      const n = R.left(st, month);
      parts.push(make('section', {}, make('h3', { textContent: t('Streak') }),
        make('p', { textContent: t('Streak: {n} · Best: {best}', { n: run.current, best: run.best }) }),
        make('p', { className: 'gz-rm-desc', textContent: t('Days in a row with nothing missed. Excused work never counts, and today counts once nothing due today is open.') }),
        st.streak?.was !== null && st.streak?.was !== undefined && n > 0 && button(t('Restore my streak ({n} left this month)', { n }), 'restore')));
    }
    if (reminding()) {
      const up = R.upcoming(evs, st, now).slice(0, 30);
      parts.push(make('section', {}, make('h3', { textContent: t('Coming up') }),
        up.length ? make('ul', { className: 'gz-rm-list' }, ...up.map((e) => {
          const mute = button(t('Mute'), 'mute', t('Mute reminders for {title}', { title: e.title }));
          mute.dataset.item = e.key;
          mute.dataset.focus = `mute ${e.key}`;
          return make('li', {}, make('span', { className: 'gz-rm-at', textContent: when(e.fires, now).abs }),
            make('span', { className: 'gz-rm-main' }, make('span', { className: 'gz-rm-kind', textContent: t(KIND[e.cat] || 'Reminder') }), make('span', { textContent: e.title })), mute);
        })) : make('p', { className: 'gz-rm-desc', textContent: t('No reminders coming up.') })));
      // What toasts stood for lately (one names an item and counts the rest) and what's snoozed: all of it, here.
      const back = R.recent(evs, st, now).slice(0, 30);
      if (back.length) {
        parts.push(make('section', {}, make('h3', { textContent: t('Recent') }), make('ul', { className: 'gz-rm-list' }, ...back.map((e) => {
          const mute = button(t('Mute'), 'mute', t('Mute reminders for {title}', { title: e.title }));
          mute.dataset.item = e.key;
          mute.dataset.focus = `recent ${e.key}`;
          const at = e.snoozed ? t('Snoozed until {when}', { when: when(e.snoozed, now).abs }) : when(e.seen, now).abs;
          return make('li', {}, make('span', { className: 'gz-rm-at', textContent: at }),
            make('span', { className: 'gz-rm-main' }, make('span', { className: 'gz-rm-kind', textContent: what(e, now) }),
              e.url ? make('a', { href: e.url, textContent: e.title }) : make('span', { textContent: e.title })), mute);
        }))));
      }
      const muted = Object.keys(st.mute).filter((k) => titles.has(k));
      if (muted.length) {
        parts.push(make('section', {}, make('h3', { textContent: t('Muted') }), make('ul', { className: 'gz-rm-list' }, ...muted.map((k) => {
          const again = button(t('Remind me again'), 'unmute', t('Remind me again about {title}', { title: titles.get(k) }));
          again.dataset.item = k;
          again.dataset.focus = `unmute ${k}`;
          return make('li', {}, make('span', { className: 'gz-rm-main', textContent: titles.get(k) }), again);
        }))));
      }
    }
    const e = en();
    const set = make('section', { className: 'gz-rm-set' }, make('h3', { textContent: t('Settings') }),
      check(t('Due-date reminders'), 'enhance.remind', e.remind),
      e.remind && make('fieldset', {}, make('legend', { textContent: t('Before a due date') }), ...LEADS.map(([k, label]) => check(t(label), `remind.${k}`, o[k]))),
      check(t('Exam reminders'), 'enhance.remindExam', e.remindExam, t("Quizzes, and titles with exam, test, midterm or final in any of Glaze's six languages.")),
      e.remindExam && pick(t('Before an exam'), 'remind.exam', o.exam, [['1d', t('1 day')], ['2d', t('2 days')], ['3d', t('3 days')], ['1w', t('1 week')]]),
      check(t('Plan reminders'), 'enhance.remindPlan', e.remindPlan, t('Your "do on" days and focus sessions from Better To Do.')),
      e.remindPlan && pick(t('Before a focus session'), 'remind.plan', o.plan, [['0', t('At the start')], ['5', t('5 minutes')], ['15', t('15 minutes')], ['30', t('30 minutes')], ['60', t('1 hour')]]),
      check(t('Class reminders'), 'enhance.remindClass', e.remindClass, t('Before each class in your class schedule.')),
      e.remindClass && pick(t('Before a class'), 'remind.cls', o.cls, [['5', t('5 minutes')], ['10', t('10 minutes')], ['15', t('15 minutes')], ['30', t('30 minutes')]]),
      e.remindClass && button(t('Class schedule'), 'classes'),
      check(t('Streak'), 'enhance.streak', e.streak),
      button(t('All Glaze settings'), 'options'));
    for (const el of set.querySelectorAll('[data-key]')) el.dataset.focus = el.dataset.key;
    parts.push(set, make('p', { className: 'gz-rm-desc', textContent: t('Reminders show only on Canvas pages while one is open. They stay on this device and change nothing in Canvas.') }));
    hub.firstChild.replaceChildren(...parts.filter(Boolean));
    if (was) (hub.querySelector(`[data-focus="${CSS.escape(was)}"]`) || hub.querySelector('[data-act="close"]'))?.focus({ preventScroll: true });
  };
  const openHub = () => {
    if (!st) return false;
    if (hub) { hub.querySelector('[data-act="close"]')?.focus(); return true; }
    opener = document.activeElement;
    hub = make('dialog', { id: 'gz-rm' }, make('div', { className: 'gz-rm-in' }));
    hub.setAttribute('aria-labelledby', 'gz-rm-title');
    hub.addEventListener('click', onHub);
    hub.addEventListener('change', onHub);
    hub.addEventListener('close', () => { hub?.remove(); hub = null; if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    document.body.append(hub);
    drawHub();
    hub.showModal();
    return true;
  };
  const say = (text) => { const p = make('p', { className: 'gz-rm-desc', textContent: text }); p.setAttribute('role', 'status'); hub?.firstChild.append(p); };
  const onHub = (e) => {
    if (e.target === hub && e.type === 'click') return hub.close();
    const el = e.target.closest('[data-act], [data-key]');
    if (!el) return;
    if (e.type === 'click' && el.dataset.act === 'close') return hub.close();
    if (e.type === 'click' && el.dataset.act === 'options') { try { Promise.resolve(chrome.runtime.sendMessage('options')).catch(() => {}); } catch { /* reloaded */ } return; }
    if (e.type === 'click' && el.dataset.act === 'classes') { hub.close(); ctx.need('features/classes.js', () => globalThis.GZ_CLASSES_UI).then(() => GZ_CLASSES_UI.open()).catch(() => {}); return; }
    if (!human(e)) { if (e.type === 'change') drawHub(); return; }
    const done = (r) => { if (r?.data) st = R.clean(r.data); arm(); };
    if (e.type === 'click' && el.dataset.act === 'mute') send({ op: 'mute', item: el.dataset.item }).then(done);
    else if (e.type === 'click' && el.dataset.act === 'unmute') send({ op: 'unmute', item: el.dataset.item }).then(done);
    else if (e.type === 'click' && el.dataset.act === 'restore') {
      send({ op: 'restore', month: T.dayKey(T.dayOf(Date.now(), who.tz)).slice(0, 7) }).then((r) => { done(r); say(r?.ok ? t('Streak restored.') : t('No restores left this month.')); });
    } else if (e.type === 'change' && el.dataset.key) {
      const [g, k] = el.dataset.key.split('.');
      const v = el.type === 'checkbox' ? el.checked : el.value;
      try { chrome.storage.sync.set(g === 'enhance' ? { version: 2, enhance: { ...en(), [k]: v } } : { remind: { ...o, [k]: v } }); } catch { /* reloaded */ }
    }
  };

  // ---- on the page ------------------------------------------------------------------------------------------------
  const onStore = (ch, area) => {
    if (!on || !st) return;
    if (area === 'sync' && (ch.todo || ch.remind)) return void readPrefs().then(arm);
    if (area !== 'local') return;
    const c = ch[CACHE]?.newValue;
    if (c?.key === todoKey && !(cache?.key === todoKey && cache.at > c.at)) cache = c;
    if (ch[todoKey]) data = T.clean(ch[todoKey].newValue);
    if (ch[key]) st = R.clean(ch[key].newValue);
    if (ch[ckey]) classes = ch[ckey].newValue?.courses?.length ? ch[ckey].newValue : null;
    if (ch[CACHE] || ch[todoKey] || ch[key] || ch[ckey]) arm();
  };
  const onShow = () => { if (on && st && document.visibilityState === 'visible') { refresh(); arm(); } };
  const start = async () => {
    await ctx.need('lib/todo.js', () => globalThis.GZ_TODO);
    await ctx.need('lib/remind.js', () => globalThis.GZ_REMIND);
    T = globalThis.GZ_TODO;
    R = globalThis.GZ_REMIND;
    const [p, list] = await Promise.all([ctx.profile(), ctx.canvasCourses(), readPrefs()]);
    if (!/^\d+$/.test(String(p?.id))) throw new Error('no profile');
    who = { uid: String(p.id), tz: T.zone(p.time_zone) };
    // Active courses only, as the To Do's Dashboard list: a concluded course's work reminds of nothing. An empty answer
    // (none, or the request failed) filters nothing.
    const live = list.filter((c) => /^\d+$/.test(String(c.id)) && !c.access_restricted_by_date);
    cids = live.length ? new Set(live.map((c) => String(c.id))) : null;
    todoKey = T.storeKey(location.origin, who.uid);
    key = R.storeKey(location.origin, who.uid);
    ckey = `classes:${location.origin}/${who.uid}`;
    const r = await get([todoKey, key, CACHE, ckey]);
    classes = r[ckey]?.courses?.length ? r[ckey] : null;
    data = T.clean(r[todoKey]);
    st = R.clean(r[key]);
    cache = r[CACHE]?.key === todoKey ? r[CACHE] : null;
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.addEventListener('visibilitychange', onShow);
    addEventListener('focus', onShow);
  };
  // If it can't start (no profile), nothing shows, and it tries again after a minute.
  const sync = (want) => {
    on = !!want;
    if (!on) return off();
    if (!starting) starting = start().then(() => { refresh(); arm(); }, () => { setTimeout(() => { starting = null; }, 6e4); });
    else if (st) {
      const next = JSON.stringify(CATS.map(([k]) => en()[k]));
      if (next !== sig) { sig = next; arm(); } else paintHead();
    }
  };
  const off = () => {
    clearTimeout(timer);
    timer = 0;
    live?.remove();
    live = null;
    hub?.close();
    headEl.remove();
    headSig = '';
    sig = '';
  };

  return {
    sync,
    // The To Do list's header draws this (features/todo.js).
    head: () => (on && st ? [headEl] : []),
    cmds: () => (on && st ? [{ label: t('Reminders'), hint: 'Glaze', group: 'Glaze', run: openHub }] : []),
    // Later packages' reminders: fn returns events in lib/remind.js events()'s extra shape.
    source: (name, fn) => { sources.set(name, fn); if (on && st) arm(); },
  };
})();

GZ_REMIND_UI;
