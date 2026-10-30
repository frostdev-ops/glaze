// Ultra's native read controls refresh its paged list, briefly shortening the scroll area. Keep the student's place
// through that refresh. Bulk reading uses those same controls (and their errors/count updates), never a private write API.
var GZ_ANNOUNCE_READ = globalThis.GZ_ANNOUNCE_READ || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  const t = (k, v) => ctx.t(k, v);
  const CHECK = 'button[role="checkbox"][data-analytics-id="course.announcements.listPanel.listItem.status.checkbox"]';
  const ROW = 'tr.announcement-item-row';
  const route = () => ctx.site === 'ultra' && ctx.on() && location.pathname.match(/^\/ultra\/courses\/(_\d+_\d+)\/announcements\/?$/)?.[1];
  const idOf = (row) => row?.querySelector('a.list-item-title')?.id.match(/^list-item-title-(_\d+_\d+)$/)?.[1];
  const rows = (list) => [...list.querySelectorAll(ROW)];
  const checkbox = (list, id) => rows(list).find((row) => idOf(row) === id)?.querySelector(CHECK);
  const enabled = (b) => b && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
  const scroller = (list) => {
    for (let p = list.parentElement; p && p !== document.body; p = p.parentElement) if (/^(auto|scroll|overlay)$/.test(getComputedStyle(p).overflowY)) return p;
    return document.scrollingElement;
  };
  let page = null, bulk = null, restore = null;
  const live = (p) => page === p && p.list.isConnected && route() === p.cid;
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { end(); reject(new Error('cancelled')); };
    const timer = setTimeout(() => { end(); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  const stopRestore = () => { restore?.abort(); restore = null; };
  // Clamping to the shortened list's bottom also lets Ultra's infinite loader refill the missing pages. Reapply until
  // the original extent is back and stable, not just when the checkbox changes (the refresh follows that change).
  const keepPlace = async (p, top, count, id, checked, focus) => {
    stopRestore();
    const ctl = new AbortController();
    restore = ctl;
    const sc = scroller(p.list), end = Date.now() + 10000;
    let steady = 0;
    try {
      while (live(p) && Date.now() < end) {
        const b = id && checkbox(p.list, id);
        const ready = rows(p.list).length >= count && (!id || b?.getAttribute('aria-checked') === checked);
        sc.scrollTop = top;
        steady = ready && Math.abs(sc.scrollTop - top) < 2 ? steady + 1 : 0;
        if (steady >= 8) {
          if (focus && b && (!document.activeElement || document.activeElement === document.body || document.activeElement === focus)) b.focus({ preventScroll: true });
          break;
        }
        await pause(100, ctl.signal);
      }
    } catch { /* user input, navigation or Glaze switched off */ }
    finally { if (restore === ctl) restore = null; }
  };
  const tell = (p, text, error = false) => { p.status.textContent = text; p.status.classList.toggle('sr-only', !error); };
  const paint = (p) => {
    const running = bulk?.p === p;
    const label = running ? t('Marking…') : t('Mark all as read');
    if (p.button.textContent !== label) p.button.textContent = label;
    if (p.button.disabled !== running) p.button.disabled = running;
    if (p.button.getAttribute('aria-busy') !== String(running)) p.button.setAttribute('aria-busy', String(running));
  };
  // Snapshot the course's unread IDs before changing any. Refuse incomplete/malformed pagination, so "all" never
  // silently means the first ten. Only this course's list may supply another page; no titles/bodies are retained.
  const unread = async (p, signal) => {
    await ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA);
    await ctx.need('lib/lmsq.js', () => globalThis.GZ_LMSQ);
    const api = GZ_ULTRA.read({ origin: location.origin, signal, live: () => live(p), f: async (url, init) => {
      const ctl = new AbortController(), abort = () => ctl.abort();
      const timer = setTimeout(abort, 10000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      try { return await GZ_LMSQ.fetch(url, { ...init, signal: ctl.signal }); }
      finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    } });
    const path = `/learn/api/v1/courses/${p.cid}/announcements`, seen = new Set(), items = new Set(), ids = new Set();
    let next = `${path}?limit=100`, count = null;
    for (let n = 0; next; n++) {
      if (n >= 100 || seen.has(next)) throw new Error('incomplete list');
      seen.add(next);
      const j = await api.get(next);
      if (!Array.isArray(j?.results) || !Number.isSafeInteger(j?.paging?.count) || j.paging.count < 0 || j.paging.count > 10000) throw new Error('unknown list');
      count ??= j.paging.count;
      if (count !== j.paging.count) throw new Error('list changed');
      for (const item of j.results) {
        if (!/^_\d+_\d+$/.test(item?.id) || items.has(item.id) || (item.courseId && item.courseId !== p.cid)) throw new Error('unknown announcement');
        items.add(item.id);
        if (!item.isDraft && typeof item.readStatus?.isRead !== 'boolean') throw new Error('unknown read state');
        if (!item.isDraft && item.readStatus?.isRead === false) ids.add(item.id);
      }
      if (!j.paging.nextPage) { if (items.size !== count) throw new Error('incomplete list'); next = ''; }
      else {
        const u = new URL(j.paging.nextPage, location.origin + path);
        if (u.origin !== location.origin || u.pathname !== path) throw new Error('unexpected page');
        next = u.pathname + u.search;
      }
    }
    return [...ids];
  };
  const markAll = async (p) => {
    if (bulk || !live(p)) return;
    stopRestore();
    const job = { p, ctl: new AbortController() }, sc = scroller(p.list), top = sc.scrollTop, count = rows(p.list).length;
    bulk = job;
    paint(p); tell(p, '');
    try {
      const ids = await unread(p, job.ctl.signal);
      for (const id of ids) {
        // Ultra can discard later pages after each mark. Look up the current node again, loading more only as needed.
        let b, end = Date.now() + 10000;
        while (live(p) && !job.ctl.signal.aborted && !(b = checkbox(p.list, id))) {
          if (Date.now() >= end) throw new Error('announcement missing');
          sc.scrollTop = sc.scrollHeight;
          await pause(100, job.ctl.signal);
        }
        if (!live(p) || job.ctl.signal.aborted) throw new Error('cancelled');
        if (b.getAttribute('aria-checked') === 'true') continue;
        if (!enabled(b) || b.getAttribute('aria-checked') !== 'false') throw new Error('read control unavailable');
        b.click();
        end = Date.now() + 10000;
        let steady = 0;
        while (live(p) && !job.ctl.signal.aborted) {
          await pause(100, job.ctl.signal);
          b = checkbox(p.list, id);
          if (!b) sc.scrollTop = sc.scrollHeight;
          steady = b?.getAttribute('aria-checked') === 'true' ? steady + 1 : 0;
          if (steady >= 5) break;
          if (Date.now() >= end) throw new Error('read update failed');
        }
        if (!live(p) || job.ctl.signal.aborted) throw new Error('cancelled');
      }
      tell(p, t('All announcements marked as read'));
    } catch {
      if (live(p) && !job.ctl.signal.aborted) tell(p, t('Could not mark all announcements as read. Try again.'), true);
    } finally {
      if (bulk === job) bulk = null;
      if (live(p)) {
        paint(p);
        if (!job.ctl.signal.aborted) {
          p.button.focus({ preventScroll: true });
          void keepPlace(p, top, count);
        }
      }
    }
  };
  const click = (e) => {
    const p = page, b = e.target?.closest?.(CHECK);
    if (!e.isTrusted || !p || !live(p) || !b || !p.list.contains(b) || !enabled(b)) return;
    const id = idOf(b.closest(ROW)), checked = b.getAttribute('aria-checked');
    if (!id || !['true', 'false'].includes(checked)) return;
    void keepPlace(p, scroller(p.list).scrollTop, rows(p.list).length, id, checked === 'true' ? 'false' : 'true', b);
  };
  const interrupt = (e) => {
    if (!e.isTrusted) return;
    stopRestore();
    bulk?.ctl.abort();
  };
  const INPUTS = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
  const off = () => {
    stopRestore(); bulk?.ctl.abort();
    if (!page) return;
    page.button.remove(); page.status.remove(); page = null;
    removeEventListener('click', click, true);
    for (const k of INPUTS) removeEventListener(k, interrupt, true);
  };
  const sync = () => {
    const cid = route(), list = cid && document.querySelector('announcement-list');
    const toolbar = list?.querySelector('.guidance-wrapper');
    if (!cid) { off(); return; }
    if (!toolbar) { if (page && (page.cid !== cid || !page.list.isConnected)) off(); return; }
    if (page && (page.cid !== cid || page.list !== list)) off();
    if (!page) {
      // Older Ultra versions, instructors and unsupported list variants keep their own UI.
      if (!list.querySelector(CHECK)) return;
      const button = Object.assign(document.createElement('button'), { type: 'button', className: 'gz-ann-read-all' });
      const status = Object.assign(document.createElement('span'), { className: 'gz-ann-read-status sr-only' });
      status.setAttribute('role', 'status');
      const p = page = { cid, list, button, status };
      button.addEventListener('click', (e) => { if (e.isTrusted) void markAll(p); });
      addEventListener('click', click, true);
      for (const k of INPUTS) addEventListener(k, interrupt, { capture: true, passive: true });
    }
    // Before Ultra's search, which stays the toolbar's last control.
    const search = toolbar.querySelector(':scope > .header-actions-menu__item');
    if (page.button.parentElement !== toolbar || (search && page.button.nextElementSibling !== search)) toolbar.insertBefore(page.button, search);
    if (page.status.parentElement !== toolbar) toolbar.append(page.status);
    paint(page);
  };
  // Glaze switched off stops its passes (content.js), so the button goes here; switched on, the next pass brings it back.
  globalThis.chrome?.storage?.onChanged?.addListener((c, area) => { if (area === 'sync' && c.enabled?.newValue === false) off(); });
  return { sync, off };
})();

GZ_ANNOUNCE_READ;
