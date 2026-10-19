// Glaze's own navigation's widgets (features/navbar.js places them): the clock, the next thing due, the focus timer and
// the pet, in the rail (open, or compact in the icons rail), the top bar (compact) or a phone's More sheet. The same timer
// and pet as the dashboard's widgets: nothing more is recorded. Each widget is one element, kept for as long as it's on,
// that the bar moves to where it shows; its words and times are drawn in place, every minute (every second while the
// timer runs). The older rail (features/nav.js) draws the same widgets its own way.
function GZ_NAVBAR_WIDGETS(X, { make, icon, isPreview }) {
  const t = X.t, NAMES = { clock: 'Clock and date', next: 'Next due', timer: 'Focus timer', pet: 'Pet habitat' };
  const get = (area, keys) => new Promise((res) => { try { chrome.storage[area].get(keys, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } });
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const setText = (e, text) => { if (e.textContent !== text) e.textContent = text; };
  const part = (e, name) => { e.setAttribute('part', name); return e; };
  const nodes = new Map(); // id -> { box, time, detail, ... }
  let ids = [], rev = 0, reads = 0, clock = 0, W = null, local = {};
  let nextItems = [], nextAt = 0, nextBusy = false, nextError = false, nextRetry = { key: '', at: 0 };
  let timerPending = false, advanced = '', timerFailed = '';
  const live = () => !!chrome.runtime?.id && ids.length > 0;

  const readLocal = () => {
    const token = rev, read = ++reads;
    get('local', isPreview ? ['todoCache'] : ['widgetTimer', 'todoCache']).then((r) => {
      if (!live() || token !== rev || read !== reads) return;
      if (r.todoCache?.key !== local.todoCache?.key) { nextItems = []; nextAt = 0; }
      local = { ...r, ...(isPreview && { widgetTimer: local.widgetTimer }) };
      draw();
    });
  };
  // What's due next: Canvas and Moodle from the week the palette and the popup read (content.js dueWeek), Ultra from its
  // planner, done and dismissed work left out (as features/nav.js).
  const refreshNext = async () => {
    const token = rev, read = reads, url = location.href;
    const start = new Date(); start.setHours(0, 0, 0, 0); const end = new Date(start); end.setDate(end.getDate() + 7);
    const key = `${local.todoCache?.key || location.origin} ${+start}`;
    const current = () => live() && X.on() && X.settings().enabled && token === rev && read === reads && url === location.href && document.visibilityState !== 'hidden' && ids.includes('next');
    if (isPreview || nextBusy || Date.now() - nextAt < 120000 || nextRetry.key === key && Date.now() < nextRetry.at || !current()) return;
    nextBusy = true; nextAt = Date.now();
    try {
      if (['canvas', 'moodle'].includes(X.site)) {
        const week = await X.dueWeek();
        if (!current()) return;
        nextItems = (Array.isArray(week) ? week : []).map((i) => ({ title: i?.title, at: i?.due, url: i?.url })); nextError = false;
        return;
      }
      await Promise.all([X.need('lib/ultra.js', () => globalThis.GZ_ULTRA), X.need('lib/todo.js', () => globalThis.GZ_TODO)]);
      if (!current()) return;
      const plan = await GZ_ULTRA.page.planned(+start, +end, local.todoCache);
      if (!current()) return;
      const [raw, options] = await Promise.all([get('local', plan.key), get('sync', 'todo')]);
      if (!current()) return;
      const data = GZ_TODO.clean(raw[plan.key]), mode = GZ_SANITIZE(options).todo.done;
      nextItems = plan.items.filter((i) => i && !i.ov?.dismissed && !GZ_TODO.isDone(i, mode, data.items[`${i.type}:${i.id}`]?.done)); nextError = false;
    } catch { nextRetry = { key, at: Date.now() + 60000 }; if (current()) { nextItems = []; nextAt = 0; nextError = true; } }
    finally {
      const fresh = current();
      if (!fresh) nextAt = 0;
      nextBusy = false;
      if (live()) draw();
    }
  };
  // The timer is the worker's (glaze:widgetTimer), shared with the dashboard's; the editor's preview keeps its own.
  const timerAction = async (op, node) => {
    if (!W || timerPending || !node.options) return;
    timerPending = true;
    const token = rev, read = reads;
    let r;
    if (isPreview) {
      const now = Date.now(), before = W.cleanTimer(local.widgetTimer);
      let timer = W.advance(before, now, node.options);
      if (op === 'reset') timer = W.IDLE;
      if (op === 'toggle') timer = timer.end ? W.pause(timer, now) : W.start(timer, now, node.options);
      r = { ok: true, timer };
    } else r = await send({ type: 'glaze:widgetTimer', op });
    timerPending = false;
    if (!live() || token !== rev || read !== reads) return;
    node.status.textContent = r?.ok ? '' : t('Not saved. Try again in a moment.');
    timerFailed = r?.ok ? '' : JSON.stringify(W.cleanTimer(local.widgetTimer));
    if (r?.ok) { local.widgetTimer = r.timer; if (op !== 'advance') advanced = ''; }
    draw();
  };
  // A Canvas or Moodle item's address is a path on this site: anything that resolves elsewhere is dropped.
  const here = (u) => { try { const url = new URL(u, location.origin); return url.origin === location.origin ? url.href : ''; } catch { return ''; } };
  const draw = () => {
    clearTimeout(clock); clock = 0;
    if (!live() || document.visibilityState === 'hidden') return;
    const now = Date.now();
    for (const id of ids) {
      const node = nodes.get(id); if (!node) continue;
      if (id === 'clock') {
        const date = new Date(now), time = new Intl.DateTimeFormat(X.locale(), { hour: 'numeric', minute: '2-digit' }).format(date);
        const day = new Intl.DateTimeFormat(X.locale(), { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
        setText(node.time, time); setText(node.detail, day); node.box.dataset.tip = `${time} · ${day}`;
        node.box.setAttribute('aria-label', `${t('Clock and date')} · ${time} · ${day}`);
      }
      if (id === 'next') {
        refreshNext();
        const item = nextItems.filter((i) => typeof i.title === 'string' && Number.isFinite(i.at) && i.at > now && (typeof i.url === 'string' ? here(i.url) : /^_\d+_\d+$/.test(i.cid))).sort((a, b) => a.at - b.at)[0];
        const when = item && GZ_PAGE.describe(new Date(item.at), true, new Date(now), X.locale()).rel;
        const label = item ? `${item.title.slice(0, 200)} · ${when}` : t(nextError ? "Glaze couldn't load this. Try again in a moment." : 'No upcoming work');
        setText(node.detail, item ? item.title.slice(0, 200) : label); setText(node.when, item ? when : '');
        node.box.dataset.tip = `${t('Next due')} · ${label}`; node.box.setAttribute('aria-label', node.box.dataset.tip);
        if (item) { node.box.href = typeof item.url === 'string' ? here(item.url) : /^_\d+_\d+$/.test(item.content) ? `${location.origin}/ultra/redirect?redirectType=nautilus&courseId=${encodeURIComponent(item.cid)}&contentId=${encodeURIComponent(item.content)}` : `${location.origin}/ultra/courses/${item.cid}/outline`; node.box.removeAttribute('aria-disabled'); }
        else { node.box.removeAttribute('href'); node.box.setAttribute('aria-disabled', 'true'); }
      }
      if (id === 'timer' && W && node.options) {
        const before = W.cleanTimer(local.widgetTimer), state = timerFailed === JSON.stringify(before) ? before : W.advance(before, now, node.options);
        const ended = node.timerEnd === before.end;
        node.timerEnd = before.end > now ? before.end : 0;
        if (state !== before && advanced !== JSON.stringify(before)) { advanced = JSON.stringify(before); timerAction('advance', node); if (ended && now - before.end < 2000) X.moment?.('timer.done', null, `timer ${before.end}`); }
        const left = W.clock(W.left(state, now, node.options)), go = t(state.end ? 'Pause' : 'Start');
        setText(node.time, left); setText(node.goLabel, go);
        if (node.goIcon.dataset.icon !== (state.end ? 'pause' : 'play')) { const svg = icon(state.end ? 'pause' : 'play'); svg.dataset.icon = state.end ? 'pause' : 'play'; node.goIcon.replaceWith(svg); node.goIcon = svg; }
        node.go.setAttribute('aria-label', `${go} · ${t('Focus timer')}`);
        node.go.dataset.tip = node.go.getAttribute('aria-label');
        node.box.dataset.tip = `${t('Focus timer')} · ${left}`;
        node.box.toggleAttribute('data-running', !!state.end);
      }
    }
    const step = ids.includes('timer') && local.widgetTimer?.end > now ? 1000 : 60000;
    clock = setTimeout(draw, step - now % step + 5);
  };

  const build = (id, token) => {
    const box = part(make(id === 'next' ? 'a' : 'div', { className: 'widget' }), `widget ${id}`);
    box.dataset.w = id;
    if (id !== 'next') box.setAttribute('role', 'group');
    box.setAttribute('aria-label', t(NAMES[id]));
    const time = make('span', { className: 'w-time' }), detail = make('span', { className: 'w-detail' });
    const node = { box, time, detail };
    if (id === 'clock') box.append(time, detail);
    if (id === 'next') { node.when = make('span', { className: 'w-when' }); box.append(icon('calendar', 'w-icon'), make('span', { className: 'w-text' }, detail, node.when)); }
    if (id === 'timer') {
      node.goIcon = icon('play'); node.goIcon.dataset.icon = 'play'; node.goLabel = make('span', { className: 'w-label', textContent: t('Start') });
      const go = make('button', { type: 'button', className: 'w-go' }, node.goIcon, node.goLabel);
      const reset = make('button', { type: 'button', className: 'w-reset' }, icon('reset'));
      reset.setAttribute('aria-label', `${t('Reset')} · ${t('Focus timer')}`); reset.dataset.tip = reset.getAttribute('aria-label');
      node.status = make('span', { role: 'status', className: 'w-status' });
      go.addEventListener('click', () => timerAction('toggle', node)); reset.addEventListener('click', () => timerAction('reset', node));
      box.append(icon('timer', 'w-icon'), time, go, reset, node.status); node.go = go;
      X.need('lib/widgets.js', () => globalThis.GZ_WIDGETS).then(async () => {
        const settings = await get('sync', 'widgets');
        if (!live() || token !== rev || nodes.get(id) !== node) return;
        W = GZ_WIDGETS; node.options = GZ_SANITIZE(settings).widgets; draw();
      }).catch(() => {});
    }
    if (id === 'pet') {
      node.image = make('span', { className: 'w-pet' }); box.append(node.image, detail);
      X.need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI).then(() => {
        if (!live() || nodes.get(id) !== node || !chrome.runtime?.id) return;
        node.pet = GZ_WIDGETS_UI.avatar(node.image, { onData: (data) => {
          const label = t('Level {level}', { level: data?.level || 1 }); setText(detail, label); box.dataset.ready = '';
          box.dataset.tip = `${t('Pet habitat')} · ${label}`; box.setAttribute('aria-label', box.dataset.tip);
        } });
      }).catch(() => {});
    }
    return node;
  };

  // The widgets to show, in order: a new one is made, one turned off is let go; the rest are the same elements.
  const set = (list) => {
    const want = list.filter((id) => NAMES[id]);
    if (JSON.stringify(want) === JSON.stringify(ids)) return nodes;
    const token = ++rev;
    for (const [id, node] of nodes) if (!want.includes(id)) { node.pet?.stop(); node.box.remove(); nodes.delete(id); }
    ids = want;
    for (const id of ids) if (!nodes.has(id)) nodes.set(id, build(id, token));
    if (ids.length) { readLocal(); draw(); } else { clearTimeout(clock); clock = 0; }
    return nodes;
  };
  const stop = () => set([]);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (!live()) return;
    if (area === 'local' && Object.keys(changes).some((k) => (!isPreview && k === 'widgetTimer') || k === 'todoCache' || k.startsWith('todo:') || k.startsWith('pet:'))) { if (changes.todoCache) nextAt = 0; readLocal(); }
    if (area === 'sync' && changes.widgets && nodes.get('timer')) { const node = nodes.get('timer'); node.options = GZ_SANITIZE({ widgets: changes.widgets.newValue }).widgets; draw(); }
  });
  document.addEventListener('visibilitychange', () => { if (live()) draw(); });
  return { set, stop, draw, nodes, ids: () => ids };
}
if (typeof module !== 'undefined') module.exports = GZ_NAVBAR_WIDGETS; else ({ ready: true });
