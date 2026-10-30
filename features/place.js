// Canvas Modules position (enhance.place), loaded on demand. Canvas owns module expansion; Glaze remembers
// only the list's scroll and last module item. Ultra's live course tabs retain their native state without replaying it.
// Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_PLACE = globalThis.GZ_PLACE || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const { local, canvasCourseKey } = ctx;
  let restoreTimer = 0;
  let place = null; // { cid, top, loaded, back: { at, steady } | null }
  const scrollerOf = (el) => {
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll|overlay/.test(getComputedStyle(p).overflowY)) return p;
    return document.scrollingElement;
  };
  // Also kept in this tab's sessionStorage, so a reload finds it even when storage.local can't be
  // reached: an extension updated or reloaded under the tab leaves the tab's old script without it.
  const tabPlace = (cid) => `gz-place:${cid}`;
  // What's kept on this device goes through the worker's one write queue (lib/background.js 'glaze:place'), which applies
  // only the fields sent to what is stored then: a read and a write from here, at up to two a second while scrolling, let
  // two tabs on different courses write each other's older copy back. The item a tab opened stays with a later scroll.
  const keep = (cid, fields) => { try { chrome.runtime.sendMessage({ type: 'glaze:place', cid, ...fields }, () => void chrome.runtime.lastError); } catch { /* the extension was reloaded under this tab */ } };
  const savePlace = () => {
    const p = place;
    if (!p?.loaded) return;
    const v = { open: [], top: p.top };
    try { sessionStorage.setItem(tabPlace(p.cid), JSON.stringify(GZ_PAGE.place(null, p.cid, v, Date.now())[p.cid])); } catch { /* blocked or full */ }
    keep(p.cid, v);
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
    restoreTimer = 0;
    const list = p?.back && p.top && ctx.on() && ctx.settings().enhance.place && document.getElementById(MODULES);
    if (!list) return stop();
    const sc = scrollerOf(list);
    const want = listTop(list, sc) + p.top;
    const there = Math.abs(sc.scrollTop - want) < 2;
    p.back.steady = there ? (p.back.steady || 0) + 1 : 0;
    if (p.back.steady >= 5 || Date.now() - p.back.at > 10000) return stop();
    if (!there) sc.scrollTop = want;
    restoreTimer = setTimeout(canvasBack, 200);
  };
  const canvasPlace = () => {
    const cid = ctx.solo && ctx.on() && canvasCourseKey();
    if (!cid) return;
    // An item opened from Modules, or with its Next and Previous buttons, carries its module item id.
    const item = new URLSearchParams(location.search).get('module_item_id');
    if (item && !noted) {
      noted = true;
      keep(cid, { item });
    }
    if (place || !/^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) || !document.getElementById(MODULES)) return;
    const p = (place = { cid, top: 0, back: !ctx.acted() && { at: Date.now() } });
    local((s) => s.get('coursePlace', (r) => {
      if (place !== p || !ctx.on() || !ctx.settings().enhance.place) return;
      const was = r?.coursePlace?.[cid];
      p.top = +was?.top || 0;
      p.loaded = true;
      if (was?.item) document.getElementById(`context_module_item_${was.item}`)?.setAttribute('data-gz-last', '');
      canvasBack();
    }));
  };
  // Ultra owns its outline state. Replaying folder clicks rebuilds potentially thousands of native rows and
  // competes with an explicit navigation. Live course tabs retain their actual outline without reconstruction.
  const sync = () => {
    if (ultra || !ctx.settings().enhance.place || !ctx.on()) { stop(); place = null; return; }
    canvasPlace();
  };
  // How far down, read at most every half second while scrolling; not while being put back, or once the
  // outline is gone (a page shrinking under it scrolls it too).
  let placeTimer = 0;
  document.addEventListener('scroll', () => {
    if (!place || place.back || placeTimer) return;
    placeTimer = setTimeout(() => {
      placeTimer = 0;
      const list = place?.loaded && !place.back && ctx.on() && ctx.settings().enhance.place && document.getElementById(MODULES);
      const sc = list && scrollerOf(list);
      const top = list && Math.max(0, Math.round(sc.scrollTop - listTop(list, sc)));
      if (list && top !== place.top) { place.top = top; savePlace(); }
    }, 500);
  }, { capture: true, passive: true });
  // Anything you do first ends putting your place back.
  const stop = (reset = false) => {
    clearTimeout(restoreTimer); restoreTimer = 0;
    if (reset) { clearTimeout(placeTimer); placeTimer = 0; place = null; }
    else if (place) place.back = null;
  };
  return { sync, stop };
})();

GZ_PLACE;
