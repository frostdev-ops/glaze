// Dashboard notes, widgets and the feature hub (Canvas), loaded on demand. content.js (syncWidgets) calls sync(on) from
// its passes while enhance.notes or enhance.widgets is on, in the top frame, and hub() from the command palette.
// The Dashboard gets a grid of tiles under its heading (notes, agenda, focus timer, quote, music, breathe, study buddy),
// each small, medium or large, in the order the student puts them; any tile can float instead, over every Canvas page,
// dragged with the pointer or moved with the arrow keys, and it snaps to the window's edges. The logic is
// lib/widgets.js. What it asks Canvas for: the student's profile (id and time zone, shared with the other extras) and,
// for the agenda, their planner items for a day Better To Do's copy doesn't cover. The music player is the one other
// address, and only after the student clicks Load player. Nothing here polls: each clock is one setTimeout to its next
// change, and only while the page is shown. Loaded on demand: a second injection into the same frame keeps the first.
var GZ_WIDGETS_UI = globalThis.GZ_WIDGETS_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const NAMES = { notes: 'Notes', agenda: 'Agenda', timer: 'Focus timer', quotes: 'Quote', music: 'Music', breathe: 'Breathe', buddy: 'Study buddy' };
  const SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Large' };
  // Written for Glaze (original, not quoted from anyone), each in every language Glaze speaks.
  const QUOTES = [
    ['focus', 'One page at a time is still forward.'], ['focus', 'Start with the smallest next step.'],
    ['focus', 'Twenty-five minutes of attention beats a day of worry.'], ['focus', 'Close the extra tabs. Keep this one.'],
    ['focus', 'Done today beats perfect someday.'],
    ['calm', 'Breathe out. The deadline can wait one breath.'], ['calm', "You don't have to finish everything today."],
    ['calm', 'Rest is part of the work.'], ['calm', 'A tired mind learns less. Take the break.'], ['calm', 'Drink some water. Then begin again.'],
    ['courage', 'Asking a question is how you learn the answer.'], ['courage', 'Every expert was confused by this once too.'],
    ['courage', 'A rough draft is a real draft.'], ['courage', "You've handled hard weeks before."], ['courage', 'Mistakes are how practice shows up.'],
  ];
  const CHEERS = ['such focus', 'very study', 'wow', 'much learning', 'so brave', 'many tasks, much done'];
  // The feature hub: Canvas's extras by where they show, with the names the editor gives them.
  const HUB = [
    ['Dashboard', ['notes', 'widgets', 'todo', 'cardTasks', 'overall', 'gradeHover', 'gpa', 'newgrades', 'newcontent', 'coursemenu']],
    ['Course pages', ['progress', 'place', 'download', 'calc', 'inline', 'scores', 'urgency', 'previews', 'toggles', 'darkDocs', 'reading', 'clamp']],
    ['Reminders and streak', ['remind', 'remindExam', 'remindPlan', 'streak']],
    ['Everywhere', ['palette', 'search', 'keys', 'drafts', 'quizLight']],
  ];
  const EXTRA = {
    notes: 'Dashboard notes', widgets: 'Widgets', todo: 'Better To Do', cardTasks: 'Tasks on course cards', overall: 'Grades on course cards',
    gradeHover: 'Card grades only on hover', gpa: 'Grade point average', newgrades: 'New-grade badges', newcontent: 'New-content badges', coursemenu: 'Course menu',
    progress: 'Course progress', place: 'Remember your place', download: 'Download all', calc: 'What-if calculator', inline: 'Due-date status and percentages',
    scores: 'Score bars', urgency: 'Due-date urgency', previews: 'Folder previews', toggles: 'Document buttons', darkDocs: 'Dark documents',
    reading: 'Reading width', clamp: 'Shorter descriptions', palette: 'Command palette', search: 'Search in your courses',
    remind: 'Due-date reminders', remindExam: 'Exam reminders', remindPlan: 'Plan reminders', streak: 'Streak', keys: 'Keyboard shortcuts', drafts: 'Back up what you type', quizLight: 'Keep quizzes light',
  };

  let W = null; // lib/widgets.js
  let o = null; // the widgets settings (storage.sync widgets)
  let lay = null; // the layout (storage.local widgetLayout)
  let on = false, starting = null, editing = false;
  let me = null; // { uid, tz }
  let grid = null, floats = null;
  const tiles = new Map(); // id -> { el, body, wake?, stop?, update? }

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const button = (text, run, props = {}) => { const b = make('button', { type: 'button', className: 'gz-w-btn', textContent: text, ...props }); b.addEventListener('click', run); return b; };
  const area = (a) => { try { return chrome.storage[a]; } catch { return null; } };
  const get = (a, keys) => new Promise((res) => { try { area(a).get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  // What this tab wrote, so the change events that echo it back (late, after newer writes) don't undo what came after.
  const mine = new Map(); // key -> JSON written and not yet echoed
  const put = (v) => {
    for (const [k, x] of Object.entries(v)) mine.set(k, (mine.get(k) || new Set()).add(JSON.stringify(x)));
    try { area('local').set(v); } catch { /* reloaded under the tab */ }
  };
  const echo = (k, c) => !!mine.get(k)?.delete(JSON.stringify(c.newValue));
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const shown = () => document.visibilityState === 'visible';
  const lang = () => GZ_I18N.locale(ctx.locale());
  const dash = () => location.pathname === '/';
  const allowed = (id) => (id === 'notes' ? ctx.settings().enhance.notes : ctx.settings().enhance.widgets);
  const saveLayout = (next) => { lay = next; put({ widgetLayout: lay }); draw(); };
  // Who's signed in (their id names their notes; their Canvas time zone counts the agenda's days), asked only when a
  // tile needs it: a page with nothing of theirs to show asks Canvas nothing. A failed ask is asked again next time.
  let asking = null;
  const who = () => (asking ||= ctx.profile().then((p) => {
    if (!/^\d+$/.test(String(p?.id))) throw new Error('no profile');
    let tz;
    try { tz = p.time_zone && new Intl.DateTimeFormat('en', { timeZone: p.time_zone }).resolvedOptions().timeZone; } catch { /* the browser's */ }
    me = { uid: String(p.id), tz: tz || undefined };
  }).catch((e) => { asking = null; throw e; }));

  // ---- the tiles ---------------------------------------------------------------------------------------------
  // Each widget fills its tile's body once; wake() runs when the page is shown again, update() when settings change,
  // stop() when the tile goes.
  const WIDGETS = {
    notes(body) {
      // note: the last saved (or stored) text; draft: the newest typed, stamped when typed, until a save confirms that very
      // draft. Shown is the draft while there is one.
      let key = '', note = { text: '', at: 0 }, draft = null, wait = 0, busy = false, tries = 0;
      const view = make('div', { className: 'gz-w-note-view', tabIndex: 0 });
      view.setAttribute('role', 'button');
      view.setAttribute('aria-label', t('Edit notes'));
      const text = make('textarea', { className: 'gz-w-note', placeholder: t('Notes for yourself. Links work.'), maxLength: W.NOTES_MAX, hidden: true });
      text.setAttribute('aria-label', t('Notes'));
      const status = make('p', { className: 'gz-w-status', role: 'status' });
      const shown = () => (draft || note).text;
      // The note only ever moves forward: whatever comes in (storage, another tab, a save's answer) replaces it only if newer.
      const newer = (x) => { if (x && x.at > note.at) note = x; };
      const render = () => {
        view.replaceChildren(...(shown() ? W.links(shown()).map((p) => (p.href ? make('a', { href: p.href, textContent: p.text, target: '_blank', rel: 'noopener noreferrer' }) : p.text))
          : [make('span', { className: 'gz-w-faint', textContent: t('Notes for yourself. Links work.') })]));
      };
      const edit = () => { view.hidden = true; text.hidden = false; text.value = shown(); text.focus(); text.setSelectionRange(text.value.length, text.value.length); };
      // A draft stays until the worker confirms that draft (a confirmation of an older one confirms only that); a failed
      // save is tried again on blur, on leaving the page and when the tile goes, three times per draft at most. One save
      // at a time: a draft typed while one is on its way goes as soon as it's answered.
      const fail = () => { status.textContent = t("Couldn't save your notes. They're still here; try again in a moment."); };
      const save = () => {
        clearTimeout(wait);
        if (!draft || busy || tries >= 3) return;
        if (!key) { fail(); return; }
        const sent = draft;
        busy = true;
        tries++;
        send({ type: 'glaze:notes', key, text: sent.text, at: sent.at }).then((r) => {
          busy = false;
          if (!r?.ok) return fail();
          status.textContent = '';
          newer(r.kept ? sent : r.note);
          // Done when this was the newest draft, or a stored note (another tab's) is as new; else the newer draft goes now.
          tries = 0;
          if (draft === sent || draft.at <= note.at) draft = null; else save();
          if (text.hidden) render();
        });
      };
      view.addEventListener('click', (e) => { if (!e.target.closest('a')) edit(); });
      view.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); edit(); } });
      text.addEventListener('input', () => { draft = { text: text.value, at: Date.now() }; tries = 0; clearTimeout(wait); wait = setTimeout(save, 600); });
      text.addEventListener('blur', () => { save(); render(); text.hidden = true; view.hidden = false; });
      const leave = () => save();
      addEventListener('pagehide', leave);
      const onStore = (ch, a) => { if (a === 'local' && key && ch[key]) { newer(W.cleanNote(ch[key].newValue)); if (text.hidden && !draft) render(); } };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      const load = () => who().then(() => { key = W.notesKey(location.origin, me.uid); return get('local', key); })
        .then((r) => { newer(W.cleanNote(r[key])); if (text.hidden && !draft) render(); }, () => {});
      load();
      render();
      body.append(view, text, status);
      return { wake: () => { if (!key) load(); }, stop: () => { save(); removeEventListener('pagehide', leave); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    agenda(body) {
      let L = null, day = null, data = null, cache = null, alive = true;
      const memo = new Map(); // day -> { at, items } for days the shared copy doesn't cover
      const title = make('h4', { className: 'gz-w-day' });
      const list = make('ul', { className: 'gz-w-agenda' });
      const today = () => L.dayOf(Date.now(), me.tz);
      const go = (d) => { day = d; paint(); };
      const back = button('‹', () => go(day - 1), { className: 'gz-w-icon' });
      const next = button('›', () => go(day + 1), { className: 'gz-w-icon' });
      const home = button(t('Today'), () => go(today()), { className: 'gz-w-small' });
      back.setAttribute('aria-label', t('Previous day'));
      next.setAttribute('aria-label', t('Next day'));
      const dayName = (d) => {
        const off = d - today();
        if (Math.abs(off) <= 1) return t(off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : 'Yesterday');
        return new Date(d * L.DAY).toLocaleDateString(lang(), { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
      };
      // Better To Do's copy when it's this account's, covers the day and is under ten minutes old; else this day alone.
      const items = async (d) => {
        const lo = L.midnight(d, me.tz), hi = L.midnight(d + 1, me.tz);
        if (cache?.key === L.storeKey(location.origin, me.uid) && Date.now() - cache.at < 6e5 && Date.parse(cache.start) <= lo && Date.parse(cache.end) >= hi) return cache.items || [];
        const m = memo.get(d);
        if (m && Date.now() - m.at < 12e4) return m.items;
        const raw = await ctx.capi(`/planner/items?start_date=${new Date(lo).toISOString()}&end_date=${new Date(hi).toISOString()}&per_page=100`);
        const got = (Array.isArray(raw) ? raw : []).map(L.slim);
        memo.set(d, { at: Date.now(), items: got });
        return got;
      };
      let asked = 0;
      const paint = async () => {
        if (!L) return;
        const n = ++asked;
        title.textContent = dayName(day);
        home.hidden = day === today();
        let rows;
        try { rows = W.agenda(L, { items: await items(day), data, day, tz: me.tz }); } catch { rows = null; }
        if (n !== asked) return;
        list.replaceChildren(...(rows === null ? [make('li', { className: 'gz-w-faint', textContent: t("Couldn't load this day. Try again in a moment.") })]
          : rows.length ? rows.map((r) => {
            const when = r.kind === 'session' ? t('Focus · {min} min', { min: r.min }) : r.kind === 'plan' ? t('Planned') : r.at === null ? t('All day')
              : new Date(r.at).toLocaleTimeString(lang(), { timeZone: me.tz, hour: 'numeric', minute: '2-digit' });
            const at = r.kind === 'session' ? `${new Date(r.at).toLocaleTimeString(lang(), { timeZone: me.tz, hour: 'numeric', minute: '2-digit' })} · ${when}` : when;
            const li = make('li', {}, make('span', { className: 'gz-w-when', textContent: at }),
              make(r.url ? 'a' : 'span', { className: 'gz-w-what', textContent: r.title, ...(r.url && { href: r.url }) }),
              r.course && make('span', { className: 'gz-w-faint', textContent: r.course }));
            if (r.done) li.dataset.done = '';
            return li;
          }) : [make('li', { className: 'gz-w-faint', textContent: t('Nothing planned or due.') })]));
      };
      const onStore = (ch, a) => {
        if (a !== 'local' || !L) return;
        const k = L.storeKey(location.origin, me.uid);
        if (ch.todoCache) cache = ch.todoCache.newValue;
        if (ch[k]) data = L.clean(ch[k].newValue);
        if (ch.todoCache || ch[k]) paint();
      };
      body.append(make('div', { className: 'gz-w-row' }, back, title, next, home), list);
      Promise.all([ctx.need('lib/todo.js', () => globalThis.GZ_TODO), who()]).then(async () => {
        if (!alive) return;
        L = globalThis.GZ_TODO;
        const k = L.storeKey(location.origin, me.uid);
        const r = await get('local', [k, 'todoCache']);
        data = L.clean(r[k]);
        if (!alive) return;
        cache = r.todoCache;
        day = today();
        try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
        paint();
      }, () => list.replaceChildren(make('li', { className: 'gz-w-faint', textContent: t("Couldn't load this day. Try again in a moment.") })));
      return { wake: () => { if (L && day !== null) paint(); }, stop: () => { alive = false; try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    timer(body) {
      let s = W.IDLE, tick = 0, audio = null, alive = true;
      // Text nodes changed in place, and labels only when they change: the page's own observer sees no new nodes each second.
      const phase = document.createTextNode(''), time = document.createTextNode('');
      const clock = make('p', { className: 'gz-w-clock' }, time);
      clock.setAttribute('role', 'timer');
      const say = make('p', { className: 'gz-w-status', role: 'status' });
      const go = button(t('Start'), () => {
        if (s.end) s = W.pause(s, Date.now());
        else {
          // A sound needs a click to be allowed: it plays in the tab where Start was pressed.
          if (o.sound) try { audio ||= new AudioContext(); audio.resume(); } catch { audio = null; }
          s = W.start(s, Date.now(), o);
        }
        put({ widgetTimer: s });
        run();
      }, { className: 'gz-w-btn gz-w-main' });
      const reset = button(t('Reset'), () => { s = W.IDLE; put({ widgetTimer: s }); run(); });
      const chime = () => {
        if (!o.sound || !audio) return;
        const at = audio.currentTime;
        for (const [f, d] of [[660, 0], [880, 0.28]]) {
          const osc = audio.createOscillator(), g = audio.createGain();
          osc.frequency.value = f;
          g.gain.setValueAtTime(0.0001, at + d);
          g.gain.exponentialRampToValueAtTime(0.18, at + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.7);
          osc.connect(g).connect(audio.destination);
          osc.start(at + d);
          osc.stop(at + d + 0.75);
        }
      };
      // One timeout to the next second shown, while it runs and the page is shown. A phase that ended while away moves
      // on quietly; one ending now rings (if the sound is on) and says so.
      const run = () => {
        clearTimeout(tick);
        tick = 0;
        if (!alive) return;
        const now = Date.now();
        const was = s;
        s = W.advance(s, now, o);
        if (s !== was && shown()) {
          put({ widgetTimer: s });
          if (now - was.end < 2000) { chime(); say.textContent = t(s.phase === 'rest' ? 'Time for a break.' : 'Break over. Ready when you are.'); }
        }
        phase.data = t(s.phase === 'rest' ? 'Break' : 'Focus');
        time.data = W.clock(W.left(s, now, o));
        const label = t(s.end ? 'Pause' : W.left(s, now, o) < W.len(s.phase, o) ? 'Resume' : 'Start');
        if (go.textContent !== label) go.textContent = label;
        body.dataset.running = s.end ? 'yes' : 'no';
        if (s.end && shown()) tick = setTimeout(run, ((s.end - now) % 1000 || 1000) + 5);
      };
      const onStore = (ch, a) => { if (a === 'local' && ch.widgetTimer && !echo('widgetTimer', ch.widgetTimer)) { s = W.cleanTimer(ch.widgetTimer.newValue); run(); } };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      get('local', 'widgetTimer').then((r) => { s = W.cleanTimer(r.widgetTimer); run(); });
      body.append(make('p', { className: 'gz-w-faint' }, phase), clock, make('div', { className: 'gz-w-row' }, go, reset), say);
      run();
      return { wake: run, update: run, stop: () => { alive = false; clearTimeout(tick); audio?.close?.(); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    quotes(body) {
      let step = 0, paused = false, wait = 0;
      const q = make('blockquote', { className: 'gz-w-quote' });
      const list = () => QUOTES.filter(([k]) => o.quotes === 'all' || k === o.quotes);
      const pause = button(t('Pause'), () => { paused = !paused; show(); });
      const show = () => {
        clearTimeout(wait);
        const all = list();
        const now = Date.now();
        q.textContent = t(all[W.quoteAt(all.length, now, o.quoteMode, o.quoteEvery, step)][1]);
        pause.hidden = o.quoteMode !== 'cycle';
        pause.textContent = t(paused ? 'Play' : 'Pause');
        pause.setAttribute('aria-pressed', String(paused));
        if (o.quoteMode === 'cycle' && !paused && shown()) wait = setTimeout(show, o.quoteEvery * 1000 - (now % (o.quoteEvery * 1000)) + 5);
      };
      const prev = button('‹', () => { step--; show(); }, { className: 'gz-w-icon' });
      const next = button('›', () => { step++; show(); }, { className: 'gz-w-icon' });
      prev.setAttribute('aria-label', t('Previous quote'));
      next.setAttribute('aria-label', t('Next quote'));
      body.append(q, make('div', { className: 'gz-w-row' }, prev, pause, next));
      show();
      return { wake: show, update: show, stop: () => clearTimeout(wait) };
    },

    music(body) {
      const form = make('form', { className: 'gz-w-music' });
      const input = make('input', { type: 'url', placeholder: 'https://open.spotify.com/…', value: lay.music, spellcheck: false, autocomplete: 'off' });
      input.setAttribute('aria-label', t('A Spotify, YouTube, Apple Music or YouTube Music link'));
      const err = make('p', { className: 'gz-w-status', role: 'status' });
      const stage = make('div', { className: 'gz-w-stage' });
      // Nothing is asked of the player's site until Load player: the link stays on this device and goes nowhere else.
      const ready = () => {
        const m = W.music(lay.music);
        stage.replaceChildren(...(m ? [
          make('p', { className: 'gz-w-faint', textContent: t('Plays from {provider}, which then sees this visit.', { provider: m.provider }) }),
          button(t('Load player'), () => {
            const f = make('iframe', { src: m.src, title: t('{provider} player', { provider: m.provider }), loading: 'lazy', allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write' });
            // YouTube refuses to play without the page's origin; the others get nothing.
            f.referrerPolicy = m.src.startsWith('https://www.youtube-nocookie.com/') ? 'strict-origin' : 'no-referrer';
            f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation');
            stage.replaceChildren(f);
          }, { className: 'gz-w-btn gz-w-main' }),
        ] : [make('p', { className: 'gz-w-faint', textContent: t('Paste a Spotify, YouTube, Apple Music or YouTube Music link to listen while you work.') })]));
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (v && !W.music(v)) { err.textContent = t("That link isn't a song, album, playlist or video Glaze can play."); input.setAttribute('aria-invalid', 'true'); return; }
        err.textContent = '';
        input.removeAttribute('aria-invalid');
        lay = { ...lay, music: v };
        put({ widgetLayout: lay });
        ready();
      });
      form.append(input, make('button', { type: 'submit', className: 'gz-w-btn', textContent: t('Save') }));
      body.append(form, err, stage);
      ready();
      return {};
    },

    breathe(body) {
      let t0 = 0, wait = 0;
      const ring = make('div', { className: 'gz-w-breath' });
      ring.setAttribute('aria-hidden', 'true');
      const word = make('p', { className: 'gz-w-breath-word' });
      word.setAttribute('aria-live', 'polite');
      const left = document.createTextNode('');
      const count = make('p', { className: 'gz-w-faint' }, left);
      const go = button(t('Start'), () => { if (t0) stop(); else { t0 = Date.now(); go.textContent = t('Stop'); step(); } }, { className: 'gz-w-btn gz-w-main' });
      const WORDS = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' };
      const stop = (done) => {
        clearTimeout(wait);
        t0 = 0;
        ring.dataset.phase = '';
        word.textContent = done ? t('Well done.') : '';
        left.data = '';
        go.textContent = t('Start');
      };
      // One timeout to each next whole second: every phase is whole seconds long.
      const step = () => {
        const b = W.breath(Date.now() - t0, o);
        if (b.done) return stop(true);
        if (ring.dataset.phase !== b.phase) {
          ring.style.setProperty('--gz-breath', `${b.count}s`);
          ring.dataset.phase = b.phase;
          word.textContent = t(WORDS[b.phase]);
        }
        left.data = t('{left} · breath {cycle} of {cycles}', { left: b.count, cycle: b.cycle, cycles: o.cycles });
        wait = setTimeout(step, 1000 - ((Date.now() - t0) % 1000) + 5);
      };
      body.append(ring, word, count, go);
      // A breathing exercise doesn't carry on unseen: a hidden page ends it.
      return { wake: () => { if (!shown() && t0) stop(); }, stop: () => clearTimeout(wait) };
    },

    // The study buddy: asleep while nothing's going on, awake while the timer runs or after a pat, happy for a while after
    // a finished focus block (any tab) or an item ticked off in Better To Do. Only when the last win was is kept.
    buddy(body) {
      let st = { happyAt: 0, patAt: 0, running: false }, wait = 0, todoKey = '', alive = true;
      const img = make('img', { alt: '', draggable: false, decoding: 'async' });
      const paint = () => {
        clearTimeout(wait);
        if (!alive) return;
        const m = W.mood(st, Date.now());
        const src = chrome.runtime.getURL(`assets/art/stickers/critters/study-buddy${m.mood ? `-${m.mood}` : ''}.webp`);
        if (img.src !== src) img.src = src;
        body.dataset.mood = m.mood || 'awake';
        if (m.until) wait = setTimeout(paint, m.until - Date.now() + 50);
      };
      const win = () => { st.happyAt = Date.now(); put({ widgetBuddy: { happyAt: st.happyAt } }); paint(); };
      const pet = button('', () => {
        st.patAt = Date.now();
        paint();
        const w = make('span', { className: 'gz-w-cheer', textContent: t(CHEERS[Math.floor(Math.random() * CHEERS.length)]) });
        w.setAttribute('aria-hidden', 'true');
        pet.after(w);
        setTimeout(() => w.remove(), 1600);
      }, { className: 'gz-w-pet' });
      pet.setAttribute('aria-label', t('Pet your study buddy'));
      pet.append(img);
      const onStore = (ch, a) => {
        if (a !== 'local') return;
        const tm = ch.widgetTimer;
        if (tm) {
          const was = W.cleanTimer(tm.oldValue), now = W.cleanTimer(tm.newValue);
          st.running = !!now.end;
          if (was.phase === 'work' && was.end && now.phase === 'rest') win(); else paint();
        }
        if (todoKey && ch[todoKey] && W.ticks(ch[todoKey].newValue) > W.ticks(ch[todoKey].oldValue)) win();
        if (ch.widgetBuddy && !tm) { st.happyAt = Math.max(st.happyAt, +ch.widgetBuddy.newValue?.happyAt || 0); paint(); }
      };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      get('local', ['widgetTimer', 'widgetBuddy']).then((r) => {
        st.running = !!W.cleanTimer(r.widgetTimer).end;
        st.happyAt = Math.max(st.happyAt, Number.isFinite(r.widgetBuddy?.happyAt) ? r.widgetBuddy.happyAt : 0);
        paint();
      });
      // Better To Do's data is per account: its key needs who's signed in. Without it, only the timer counts.
      who().then(() => { todoKey = `todo:${location.origin}/${me.uid}`; }, () => {});
      paint();
      body.append(pet);
      return { wake: paint, stop: () => { alive = false; clearTimeout(wait); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },
  };

  // ---- the grid and the floating layer ------------------------------------------------------------------------
  const tileEl = (id) => {
    const name = t(NAMES[id]);
    const el = make('section', { className: 'gz-w' });
    el.dataset.id = id;
    el.setAttribute('aria-label', name);
    const grip = button('', () => {}, { className: 'gz-w-grip' });
    grip.setAttribute('aria-label', t('Move {name}: arrow keys', { name }));
    grip.title = t('Drag to move, or use the arrow keys');
    const head = make('header', { className: 'gz-w-head' }, grip, make('h3', { textContent: name }));
    const tools = make('div', { className: 'gz-w-tools' });
    const body = make('div', { className: 'gz-w-body' });
    el.append(head, tools, body);
    drag(el, head, grip, id);
    return { el, head, tools, body };
  };
  // The controls a tile shows: floating, its way back and away; in the grid while editing, order, size and float.
  const toolsFor = (x, tile) => {
    const name = t(NAMES[tile.id]);
    const label = (b, text) => { b.setAttribute('aria-label', text); b.title = text; return b; };
    if (tile.float) {
      x.tools.replaceChildren(
        label(button('⇲', () => saveLayout(W.set(lay, tile.id, { float: false })), { className: 'gz-w-icon' }), t('Put {name} back on the Dashboard', { name })),
        label(button('×', () => saveLayout(W.set(lay, tile.id, { on: false, float: false })), { className: 'gz-w-icon' }), t('Remove {name}', { name })),
      );
      return;
    }
    if (!editing) { x.tools.replaceChildren(); return; }
    const size = make('select', { className: 'gz-w-size' }, ...W.SIZES.map((v) => make('option', { value: v, textContent: t(SIZE_NAMES[v]), selected: v === tile.size })));
    size.setAttribute('aria-label', t('Size of {name}', { name }));
    size.addEventListener('change', () => saveLayout(W.set(lay, tile.id, { size: size.value })));
    x.tools.replaceChildren(
      label(button('←', () => saveLayout(W.move(lay, tile.id, -1)), { className: 'gz-w-icon' }), t('Move {name} earlier', { name })),
      label(button('→', () => saveLayout(W.move(lay, tile.id, 1)), { className: 'gz-w-icon' }), t('Move {name} later', { name })),
      size,
      label(button('⇱', () => saveLayout(W.set(lay, tile.id, { float: true })), { className: 'gz-w-icon' }), t('Float {name} over every page', { name })),
      label(button('×', () => saveLayout(W.set(lay, tile.id, { on: false })), { className: 'gz-w-icon' }), t('Remove {name}', { name })),
    );
  };

  // Floating: dragged by its header with the pointer, or moved by its grip with the arrow keys (Shift: further).
  // It lands inside the window and snaps to an edge near it; where it is in the room the window leaves is kept.
  let dragged = null; // the grid tile being dragged to a new place in the order
  const drag = (el, head, grip, id) => {
    const keep = (left, top) => {
      const r = el.getBoundingClientRect();
      const p = W.place(left, top, r.width, r.height, innerWidth, innerHeight);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
      lay = W.set(lay, id, { x: p.x, y: p.y });
      put({ widgetLayout: lay });
    };
    head.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !lay.tiles.find((x) => x.id === id)?.float || (e.target.closest('button, a, input, select, textarea') && e.target !== grip)) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      head.setPointerCapture(e.pointerId);
      el.dataset.dragging = '';
      const move = (ev) => {
        el.style.left = `${Math.min(innerWidth - r.width, Math.max(0, ev.clientX - dx))}px`;
        el.style.top = `${Math.min(innerHeight - r.height, Math.max(0, ev.clientY - dy))}px`;
      };
      const up = (ev) => {
        head.removeEventListener('pointermove', move);
        head.removeEventListener('pointerup', up);
        head.removeEventListener('pointercancel', up);
        delete el.dataset.dragging;
        keep(ev.clientX - dx, ev.clientY - dy);
      };
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    grip.addEventListener('keydown', (e) => {
      const by = e.shiftKey ? 96 : 32; // more than SNAP, so a step away from an edge isn't pulled back to it
      const d = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] }[e.key];
      if (!d) return;
      e.preventDefault();
      const tile = lay.tiles.find((x) => x.id === id);
      // In the grid: left and up move it earlier, right and down later.
      if (!tile?.float) { saveLayout(W.move(lay, id, d[0] + d[1] < 0 ? -1 : 1)); grip.focus(); return; }
      const r = el.getBoundingClientRect();
      keep(r.left + d[0], r.top + d[1]);
    });
    // In the grid while editing: drag a tile onto another to put it there.
    el.addEventListener('dragstart', (e) => { dragged = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t(NAMES[id])); });
    el.addEventListener('dragover', (e) => { if (dragged && dragged !== id) { e.preventDefault(); el.dataset.over = ''; } });
    el.addEventListener('dragleave', () => delete el.dataset.over);
    el.addEventListener('drop', (e) => { e.preventDefault(); delete el.dataset.over; if (dragged && dragged !== id) saveLayout(W.move(lay, dragged, 0, id)); dragged = null; });
    el.addEventListener('dragend', () => { dragged = null; });
  };

  const gridEl = () => {
    const edit = button(t('Edit widgets'), () => { editing = !editing; edit.setAttribute('aria-pressed', String(editing)); draw(); }, { className: 'gz-w-small' });
    edit.setAttribute('aria-pressed', 'false');
    const hubBtn = button(t('What Glaze can do'), () => hub(), { className: 'gz-w-small' });
    const box = make('section', { id: 'gz-dash' }, make('div', { className: 'gz-dash-bar' }, make('h2', { className: 'screenreader-only', textContent: t('Notes and widgets') }), edit, hubBtn),
      make('div', { className: 'gz-dash-grid' }), make('div', { className: 'gz-dash-add' }));
    box.setAttribute('aria-label', t('Notes and widgets'));
    return box;
  };
  // Right under the Dashboard's heading: the GPA goes right before the cards, so the two never trade places.
  const placeGrid = () => {
    const head = dash() && document.getElementById('dashboard_header_container');
    if (!head) { grid?.remove(); return false; }
    grid ||= gridEl();
    if (head.nextElementSibling !== grid) head.after(grid);
    return true;
  };

  const draw = () => {
    if (!on || !lay) return;
    const hasGrid = placeGrid();
    const want = wanted(hasGrid);
    if (want.some((x) => x.float) && !floats?.isConnected) { floats = make('div', { id: 'gz-float' }); document.body.append(floats); }
    for (const [id, x] of tiles) if (!want.some((w) => w.id === id)) { x.stop?.(); x.el.remove(); tiles.delete(id); }
    const last = new Map(); // home -> the tile placed last in it
    for (const tile of want) {
      let x = tiles.get(tile.id);
      if (!x) {
        x = tileEl(tile.id);
        Object.assign(x, WIDGETS[tile.id](x.body) || {});
        tiles.set(tile.id, x);
      }
      x.el.dataset.size = tile.size;
      x.el.draggable = editing && !tile.float;
      x.el.toggleAttribute('data-float', tile.float);
      toolsFor(x, tile);
      // In order, moving only what is out of place: a moved element loses focus (a note being typed).
      const home = tile.float ? floats : grid.querySelector('.gz-dash-grid');
      const prev = last.get(home);
      if (x.el.parentNode !== home || x.el.previousElementSibling !== (prev || null)) { if (prev) prev.after(x.el); else home.prepend(x.el); }
      last.set(home, x.el);
      if (!tile.float) x.el.removeAttribute('style');
    }
    placeFloats();
    if (grid) {
      grid.toggleAttribute('data-editing', editing);
      const add = grid.querySelector('.gz-dash-add');
      const off = lay.tiles.filter((x) => !x.on && allowed(x.id));
      add.replaceChildren(...(editing && off.length ? [make('span', { className: 'gz-w-faint', textContent: t('Add:') }),
        ...off.map((x) => button(`+ ${t(NAMES[x.id])}`, () => saveLayout(W.set(lay, x.id, { on: true })), { className: 'gz-w-small' }))] : []));
    }
  };

  // What this page shows: tiles that are on, allowed by their switch, and floating or with the grid here.
  const canGrid = () => dash() && !!document.getElementById('dashboard_header_container');
  const wanted = (hasGrid) => lay.tiles.filter((x) => x.on && allowed(x.id) && (x.float || hasGrid));
  const placeFloats = () => {
    for (const tile of lay.tiles) {
      const el = tile.float && tiles.get(tile.id)?.el;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const p = W.spot(tile.x, tile.y, r.width, r.height, innerWidth, innerHeight);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
    }
  };

  // ---- the feature hub and the tour ----------------------------------------------------------------------------
  // "What Glaze can do": every Canvas extra with its switch, the tour, reporting a problem and the editor. Opened by the
  // student only (the command palette, or the Dashboard's button): nothing here opens by itself.
  let hubBox = null;
  const hub = () => {
    hubBox?.remove();
    const s = ctx.settings();
    const set = (k, v) => { try { chrome.storage.sync.set({ version: 2, enhance: { ...ctx.settings().enhance, [k]: v } }); } catch { /* reloaded */ } };
    const close = () => hubBox?.close();
    const report = make('a', { className: 'gz-w-btn', textContent: t('Report a problem'), target: '_blank', rel: 'noopener noreferrer',
      href: W.feedback({ version: chrome.runtime.getManifest().version, ua: navigator.userAgent, lang: ctx.locale(), lms: 'Canvas' }) });
    report.title = t('Opens a new GitHub issue with your Glaze version and browser filled in. GitHub receives that text when the page opens; nothing is posted until you submit it.');
    const tourBtn = button(t('Take the tour'), () => { close(); tour(); }, { className: 'gz-w-btn gz-w-main' });
    const editor = button(t('Glaze settings'), () => { try { chrome.runtime.sendMessage('options'); } catch { /* reloaded */ } });
    hubBox = make('dialog', { id: 'gz-hub', className: 'gz-w-dialog' },
      make('header', { className: 'gz-w-row' }, make('h2', { id: 'gz-hub-h', textContent: t('What Glaze can do') }), button('×', close, { className: 'gz-w-icon', ariaLabel: t('Close') })),
      make('p', { className: 'gz-w-faint', textContent: t('Switch any of these on or off. Everything runs on this device; the editor has the details.') }),
      ...HUB.map(([group, keys]) => make('fieldset', {}, make('legend', { textContent: t(group) }),
        ...keys.map((k) => {
          const box = make('input', { type: 'checkbox', checked: !!s.enhance[k] });
          box.dataset.key = k;
          box.addEventListener('change', () => set(k, box.checked));
          return make('label', { className: 'gz-w-check' }, box, make('span', { textContent: t(EXTRA[k]) }));
        }))),
      make('footer', { className: 'gz-w-row' }, tourBtn, report, editor));
    hubBox.setAttribute('aria-labelledby', 'gz-hub-h');
    const sync = (ch, a) => { if (a === 'sync' && ch.enhance) for (const b of hubBox.querySelectorAll('input[data-key]')) b.checked = !!ch.enhance.newValue?.[b.dataset.key]; };
    try { chrome.storage.onChanged.addListener(sync); } catch { /* reloaded */ }
    hubBox.addEventListener('close', () => { try { chrome.storage.onChanged.removeListener(sync); } catch { /* reloaded */ } hubBox.remove(); hubBox = null; });
    hubBox.addEventListener('click', (e) => { if (e.target === hubBox) close(); });
    document.body.append(hubBox);
    hubBox.showModal();
  };
  // A few steps over what's on this page, each pointing at its part; a step whose part isn't here is skipped. Esc,
  // End tour or the last step's Finish ends it; nothing is kept.
  const STEPS = [
    ['#gz-dash', 'Your notes and widgets. Edit widgets adds, orders and sizes them; any of them can float over every Canvas page.'],
    ['#gz-todo, #right-side .Sidebar__TodoListContainer, #right-side .todo-list-header', "Your To Do. Glaze's Better To Do can take its place, grouped by day, with your own tasks and plans."],
    ['#DashboardCard_Container .ic-DashboardCard', "Your course cards. Each card's menu gives it a color, a picture and bookmarks."],
    [null, 'Press Ctrl+K (⌘K on a Mac) anywhere in Canvas to jump to a course, a page or a Glaze setting.'],
    [null, "Glaze's button in your browser's toolbar has your Looks and palettes, and What Glaze can do is in Ctrl+K whenever you want it."],
  ];
  const tour = () => {
    const steps = STEPS.map(([sel, text]) => [sel && [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length), text]).filter(([el], i) => el || !STEPS[i][0]);
    let i = 0;
    const ring = make('div', { className: 'gz-tour-ring' });
    const text = make('p', { id: 'gz-tour-text' });
    const n = make('p', { className: 'gz-w-faint' });
    const backBtn = button(t('Back'), () => show(i - 1));
    const nextBtn = button(t('Next'), () => (i === steps.length - 1 ? end() : show(i + 1)), { className: 'gz-w-btn gz-w-main' });
    const bubble = make('div', { className: 'gz-tour gz-w-dialog', tabIndex: -1 }, text, n, make('div', { className: 'gz-w-row' }, button(t('End tour'), () => end(), { className: 'gz-w-small' }), backBtn, nextBtn));
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-labelledby', 'gz-tour-text');
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); end(); } };
    const end = () => { ring.remove(); bubble.remove(); document.removeEventListener('keydown', key, true); };
    const show = (k) => {
      i = k;
      const [el, words] = steps[i];
      text.textContent = t(words);
      n.textContent = t('{step} of {steps}', { step: i + 1, steps: steps.length });
      backBtn.disabled = i === 0;
      nextBtn.textContent = t(i === steps.length - 1 ? 'Finish' : 'Next');
      ring.hidden = !el;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        const r = el.getBoundingClientRect();
        Object.assign(ring.style, { left: `${r.left + scrollX - 6}px`, top: `${r.top + scrollY - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
        const below = r.bottom + 220 < innerHeight;
        Object.assign(bubble.style, { position: 'absolute', left: `${Math.max(12, Math.min(innerWidth - 372, r.left)) + scrollX}px`, top: `${(below ? r.bottom + 14 : Math.max(12, r.top - 200)) + scrollY}px`, transform: '' });
      } else Object.assign(bubble.style, { position: 'fixed', left: '50%', top: '30%', transform: 'translateX(-50%)' });
      bubble.focus();
    };
    document.addEventListener('keydown', key, true);
    document.body.append(ring, bubble);
    show(0);
  };

  // ---- starting and stopping ------------------------------------------------------------------------------------
  const readPrefs = () => get('sync', 'widgets').then((r) => { o = GZ_SANITIZE({ widgets: r.widgets }).widgets; });
  const onStore = (ch, a) => {
    if (a === 'sync' && ch.widgets) readPrefs().then(() => { for (const x of tiles.values()) x.update?.(); });
    if (a === 'local' && ch.widgetLayout && !echo('widgetLayout', ch.widgetLayout)) {
      const next = W.layout(ch.widgetLayout.newValue);
      if (JSON.stringify(next) !== JSON.stringify(lay)) { lay = next; draw(); }
    }
  };
  const onShow = () => { for (const x of tiles.values()) x.wake?.(); };
  const onResize = () => { if (on && lay) placeFloats(); };
  const start = async () => {
    await ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS);
    W = globalThis.GZ_WIDGETS;
    const [r] = await Promise.all([get('local', 'widgetLayout'), readPrefs()]);
    lay = W.layout(r.widgetLayout);
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.addEventListener('visibilitychange', onShow);
    addEventListener('resize', onResize);
  };
  // If it can't start (the extension reloaded under the tab), the page stays as Canvas has it; it tries again after a minute.
  const sync = (want) => {
    on = !!want;
    if (!on) {
      for (const x of tiles.values()) { x.stop?.(); x.el.remove(); }
      tiles.clear();
      grid?.remove();
      floats?.remove();
      grid = floats = null;
      return;
    }
    if (!starting) starting = start().then(draw, () => { setTimeout(() => { starting = null; }, 60000); });
    else if (W && lay) {
      // A pass: draw only when something changed (a switch let a tile in or out, Canvas redrew the Dashboard), so the
      // page's observer isn't fed changes of Glaze's own.
      const hasGrid = canGrid();
      const want = wanted(hasGrid);
      const head = hasGrid && document.getElementById('dashboard_header_container');
      if (want.map((x) => x.id).sort().join() !== [...tiles.keys()].sort().join() || (hasGrid ? head.nextElementSibling !== grid : grid?.isConnected)
        || (want.some((x) => x.float) && !floats?.isConnected)) draw();
    }
  };
  // The hub can open with the widgets off: it needs only this file and lib/widgets.js.
  const open = () => ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS).then(() => { W ||= globalThis.GZ_WIDGETS; hub(); });

  return { sync, hub: open };
})();

GZ_WIDGETS_UI;
