// Your place in a course (enhance.place), loaded on demand: content.js loads this on a course outline (Ultra), or a
// course's Modules list or an item opened from it (Canvas), and calls sync() from its passes and stop() when you do
// anything (wheel, touch, a key, a click), which it watches from the page's start.
// Ultra keeps a course's open folders and last-clicked item in memory only: gone with a reload, a
// new visit or another course's content. Glaze keeps them per course on this device (storage.local
// coursePlace, lib/page.js): a folder once it unfolds, forgotten once you fold it yourself (Ultra
// folds some itself), and how far down you were. Each time the outline comes back, folders still
// closed are unfolded as the jump above does, each once, then it scrolls back if nothing has moved
// it. Anything you do first (wheel, touch, a key, a click) ends that; given up after ten seconds.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_PLACE = globalThis.GZ_PLACE || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { local, courseId, canvasCourseKey, toggleOf, ROWS } = ctx;
  const OUTLINE = /^\/ultra\/courses\/_\d+_\d+\/outline\/?$/;
  // On Ultra, anything you did once the outline was there, while this file loaded, counts as done after the place was made.
  let since = ctx.placeAsked();
  let place = null; // { cid, open (folder ids), top, seen (id → open), away, loaded, back: { at, opened, clicked, quiet, scrolled, steady } | null }
  const scrollerOf = (el) => {
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll|overlay/.test(getComputedStyle(p).overflowY)) return p;
    return document.scrollingElement;
  };
  const outlineRows = (cid) => (OUTLINE.test(location.pathname) && courseId() === cid ? document.querySelectorAll(ROWS) : []);
  // Also kept in this tab's sessionStorage, so a reload finds it even when storage.local can't be
  // reached: an extension updated or reloaded under the tab leaves the tab's old script without it.
  const tabPlace = (cid) => `gz-place:${cid}`;
  const savePlace = () => {
    const p = place;
    if (!p?.loaded) return;
    const v = { open: [...(p.open || [])], top: p.top };
    const now = Date.now();
    try { sessionStorage.setItem(tabPlace(p.cid), JSON.stringify(GZ_PAGE.place(null, p.cid, v, now)[p.cid])); } catch { /* blocked or full */ }
    local((s) => s.get('coursePlace', (r) => s.set({ coursePlace: GZ_PAGE.place(r?.coursePlace, p.cid, { ...v, item: r?.coursePlace?.[p.cid]?.item }, now) })));
  };
  // Canvas keeps which modules you collapsed itself (per student, on its server), so here it's how far down
  // the Modules list you were, measured from the list's top so a course home showing it agrees with the
  // Modules page, and the item you opened last, marked when you come back. Every page change is a full
  // load on Canvas; Back may bring a page back as it was (bfcache), and that is left alone.
  const MODULES = 'context_modules_sortable_container';
  const listTop = (list, sc) => list.getBoundingClientRect().top + sc.scrollTop - (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top);
  let noted = false; // this page's module item recorded
  // Put back until it holds there a second running (a module Canvas collapses once the student's progress
  // arrives moves the list), with the same rules as above: anything you do first ends it; ten seconds at most.
  const canvasBack = () => {
    const p = place;
    const list = p?.back && p.top && document.getElementById(MODULES);
    if (!list) { if (p) p.back = null; return; }
    const sc = scrollerOf(list);
    const want = listTop(list, sc) + p.top;
    const there = Math.abs(sc.scrollTop - want) < 2;
    p.back.steady = there ? (p.back.steady || 0) + 1 : 0;
    if (p.back.steady >= 5 || Date.now() - p.back.at > 10000) { p.back = null; return; }
    if (!there) sc.scrollTop = want;
    setTimeout(canvasBack, 200);
  };
  const canvasPlace = () => {
    const cid = ctx.solo && ctx.on() && canvasCourseKey();
    if (!cid) return;
    // An item opened from Modules, or with its Next and Previous buttons, carries its module item id.
    const item = new URLSearchParams(location.search).get('module_item_id');
    if (item && !noted) {
      noted = true;
      local((s) => s.get('coursePlace', (r) => s.set({ coursePlace: GZ_PAGE.place(r?.coursePlace, cid, { open: [], top: r?.coursePlace?.[cid]?.top, item }, Date.now()) })));
    }
    if (place || !/^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) || !document.getElementById(MODULES)) return;
    const p = (place = { cid, top: 0, back: !ctx.acted() && { at: Date.now() } });
    local((s) => s.get('coursePlace', (r) => {
      const was = r?.coursePlace?.[cid];
      p.top = +was?.top || 0;
      p.loaded = true;
      if (was?.item) document.getElementById(`context_module_item_${was.item}`)?.setAttribute('data-gz-last', '');
      canvasBack();
    }));
  };
  // While a place is being put back (data-gz-placing): a course tab's frame waits for it before it shows (features/coursetabs.js).
  const placing = (on) => document.documentElement.toggleAttribute('data-gz-placing', on);
  const backTo = () => {
    const p = place;
    const b = p?.back;
    if (!b) return placing(false);
    placing(true);
    const rows = outlineRows(p.cid);
    if (!rows.length) { p.back = null; return; }
    if (b.ready && !ctx.holding()) {
      let busy = false;
      for (const row of rows) {
        const id = row.dataset.contentId;
        const tg = p.open.has(id) && toggleOf(row);
        if (!tg || tg.getAttribute('aria-expanded') !== 'false') continue;
        if (!b.opened.has(id)) { b.opened.add(id); b.clicked = Date.now(); tg.click(); }
        // A folder that never opens (restricted, say) is waited for two seconds.
        busy ||= Date.now() - b.clicked < 2000;
      }
      b.quiet = busy ? 0 : b.quiet + 1;
      if (b.quiet >= 2 || Date.now() - b.at > 10000) {
        const sc = scrollerOf(rows[0]);
        // Anything you do ends this above, so what moved the outline meanwhile is Ultra (it scrolls a
        // module it unfolds into view): the place kept wins.
        if (!p.top) { p.back = null; return; }
        // An unfolded module's contents slide open over ~0.4 s and rows can still arrive, so the outline
        // grows under the scroll (clamping it, then anchoring shifts it): set again until it holds there
        // twice running, for three seconds at most. Nothing is saved meanwhile.
        b.scrolled ||= Date.now();
        const there = Math.abs(sc.scrollTop - p.top) < 2;
        b.steady = there ? (b.steady || 0) + 1 : 0;
        if (b.steady >= 2 || Date.now() - b.scrolled > 3000) { p.back = null; return; }
        if (!there) sc.scrollTop = p.top;
      }
    }
    setTimeout(backTo, 200);
  };
  const sync = () => {
    if (!ctx.settings().enhance.place) { place = null; return; }
    if (!ultra) return canvasPlace();
    const cid = ctx.solo && ctx.on() && courseId();
    const rows = cid ? outlineRows(cid) : [];
    if (!rows.length) { if (place) place.away = true; return; }
    if (!place || place.away || place.cid !== cid) {
      const late = since && ctx.acted() >= since;
      since = 0;
      const p = { cid, open: new Set(), top: 0, seen: new Map(), back: !late && { at: Date.now(), opened: new Set(), clicked: 0, quiet: 0 } };
      place = p;
      // The newer of what this device and this tab kept.
      let tab = null;
      try { tab = JSON.parse(sessionStorage.getItem(tabPlace(cid))); } catch { /* none */ }
      const got = (kept) => {
        const was = tab?.at > (kept?.at || 0) ? tab : kept;
        p.open = new Set([...(Array.isArray(was?.open) ? was.open : []), ...p.open]);
        if (was?.top > 0) p.top = +was.top;
        p.loaded = true;
        if (p.back) { p.back.ready = true; backTo(); }
      };
      try { chrome.storage.local.get('coursePlace', (r) => got(r?.coursePlace?.[cid])); } catch { got(null); }
    }
    let changed = false;
    for (const row of rows) {
      const tg = toggleOf(row);
      if (!tg) continue;
      const id = row.dataset.contentId;
      const open = tg.getAttribute('aria-expanded') === 'true';
      const was = place.seen.get(id);
      place.seen.set(id, open);
      if (was === open) continue;
      const tapped = ctx.tapped();
      if (open) place.open.add(id);
      else if (was && tapped?.id === id && Date.now() - tapped.at < 3000) place.open.delete(id);
      else continue;
      changed = true;
    }
    if (changed) savePlace();
  };
  // How far down, read at most every half second while scrolling; not while being put back, or once the
  // outline is gone (a page shrinking under it scrolls it too).
  let placeTimer = 0;
  document.addEventListener('scroll', () => {
    if (!place || place.back || placeTimer) return;
    placeTimer = setTimeout(() => {
      placeTimer = 0;
      if (!ultra) {
        const list = place?.loaded && !place.back && document.getElementById(MODULES);
        const sc = list && scrollerOf(list);
        const top = list && Math.max(0, Math.round(sc.scrollTop - listTop(list, sc)));
        if (list && top !== place.top) { place.top = top; savePlace(); }
        return;
      }
      const rows = place && !place.back && !place.away ? outlineRows(place.cid) : [];
      const top = rows.length && scrollerOf(rows[0]).scrollTop;
      if (rows.length && top !== place.top) { place.top = top; savePlace(); }
    }, 500);
  }, { capture: true, passive: true });
  // Anything you do first ends putting your place back.
  const stop = () => { if (place) place.back = null; placing(false); };
  return { sync, stop };
})();

GZ_PLACE;
