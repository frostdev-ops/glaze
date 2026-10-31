// Course data ahead of time (enhance.prefetch, on by default), on Blackboard Ultra's top page. Once the page has settled,
// at low priority in the site's queue and only where what's kept is stale: the To Do copy (Better To Do's own range, kept
// as its copy, courses/ultra.js page.planned), then the gradebook of each course with work still due. And a course's
// content once its card, course tab or link has been pointed at for a moment, kept five minutes for the new-content
// badges, the palette and search (page.outline). Classic script, loaded on demand (content-ultra.js syncAhead); a second
// injection keeps the first. sync(on).
var GZ_AHEAD = globalThis.GZ_AHEAD || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // landed before its document's bootstrap: asked for again
  const LOW = 1, INTENT = 150, KEPT = 6e5; // a gradebook kept for less than ten minutes isn't asked for again here
  const ID = /^_\d+_\d+$/;
  let on = false, ran = false, idle = 0, pointing = '', timer = 0;
  const stores = () => ctx.need('courses/lmsq.js', () => globalThis.GZ_LMSQ).then(() => ctx.need('courses/ultra.js', () => globalThis.GZ_ULTRA)).then(() => GZ_ULTRA.page);
  const still = () => on && document.visibilityState !== 'hidden';
  const kept = () => new Promise((res) => { try { chrome.storage.local.get('todoCache', (r) => res(chrome.runtime.lastError ? null : r?.todoCache)); } catch { res(null); } });

  // ---- once the page has settled ----
  const settle = async () => {
    if (!still()) return;
    const p = await stores();
    const { id } = await p.profile();
    if (!still()) return;
    const day = new Date(); day.setHours(0, 0, 0, 0);
    const next = new Date(day); next.setDate(next.getDate() + 1);
    // A fresh To Do copy covering today answers without asking; otherwise Better To Do's range is read and kept.
    const { items } = await p.planned(+day, +next, await kept(), id, LOW);
    const now = Date.now();
    for (const cid of new Set(items.filter((i) => i?.at >= now && !i.sub?.submitted && ID.test(i.cid)).map((i) => i.cid))) {
      if (!still()) return;
      if (p.fresh.book(cid, id)) continue;
      const k = await p.saved(cid, id);
      if (!k || now - k.at >= KEPT) p.book(cid, id, { prio: LOW }).catch(() => {});
    }
  };
  const later = () => {
    if (ran || idle) return;
    const go = () => { idle = 0; if (!still()) return; ran = true; settle().catch(() => {}); };
    const wait = () => { idle = globalThis.requestIdleCallback ? requestIdleCallback(go, { timeout: 5000 }) : setTimeout(go, 2000); };
    if (document.readyState === 'complete') wait(); else addEventListener('load', wait, { once: true });
    idle ||= -1;
  };

  // ---- a course pointed at ----
  const courseAt = (t) => {
    const e = t?.closest?.('[data-course-id], a[href*="/ultra/courses/_"]');
    const cid = e?.dataset?.courseId || e?.getAttribute?.('href')?.match(/\/ultra\/courses\/(_\d+_\d+)/)?.[1] || '';
    return ID.test(cid) ? cid : '';
  };
  const onOver = (e) => {
    const cid = courseAt(e.target);
    if (cid === pointing) return;
    clearTimeout(timer);
    pointing = cid;
    if (cid) timer = setTimeout(() => { if (still() && pointing === cid) stores().then((p) => p.outline(cid, { prio: LOW, body: true })).catch(() => {}); }, INTENT);
  };
  const onOut = (e) => { if (!courseAt(e.relatedTarget)) { clearTimeout(timer); pointing = ''; } };

  const sync = (want) => {
    if (!!want === on) return;
    on = !!want;
    if (on) {
      document.addEventListener('pointerover', onOver, true);
      document.addEventListener('pointerout', onOut, true);
      later();
      return;
    }
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    clearTimeout(timer);
    pointing = '';
  };
  return { sync };
})();

GZ_AHEAD;
