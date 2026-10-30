// Public discussion ids differ from Ultra's content ids. An explicit search selection first opens the native
// discussion list, then follows its exact, unambiguous title link. Never synthesize a content id from a forum id.
var GZ_DISCUSSION_NAV = globalThis.GZ_DISCUSSION_NAV || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  const KEY = 'gz-discussion-jump';
  let target = null, timer = 0, listening = false;
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
  const off = () => {
    clearTimeout(timer); timer = 0; target = null;
    if (listening) for (const ev of events) document.removeEventListener(ev, cancel, true);
    listening = false;
  };
  const cancel = (e) => { if (e.isTrusted) off(); };
  const sync = () => {
    if (timer || document.documentElement.hasAttribute('data-gz-ctab-framed') || (!ctx.tabFrame && globalThis.GZ_CTABS?.showing?.())) return;
    if (!target) {
      try { target = JSON.parse(sessionStorage.getItem(KEY)); } catch { target = null; }
      if (!target || !/^_\d+_\d+$/.test(target.cid) || typeof target.title !== 'string' || !target.title.trim() || target.title.length > 300 || !Number.isFinite(target.at)) return off();
      // All same-site course documents share sessionStorage. The list we are leaving must not steal a
      // selection for another course while its destination frame is still loading.
      if (!new RegExp(`^/ultra/courses/${target.cid}/engagement/?$`).test(location.pathname)) return off();
      try { sessionStorage.removeItem(KEY); } catch { /* storage became unavailable */ }
    }
    if (!ctx.on() || !ctx.settings().enhance.search || !new RegExp(`^/ultra/courses/${target.cid}/engagement/?$`).test(location.pathname) || Date.now() - target.at > 15000 || target.at > Date.now()) return off();
    if (!listening) { for (const ev of events) document.addEventListener(ev, cancel, { capture: true, passive: true }); listening = true; }
    const urls = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      if (a.textContent.replace(/\s+/g, ' ').trim() !== target.title.replace(/\s+/g, ' ').trim()) continue;
      try { const u = new URL(a.href, location.origin); if (u.origin === location.origin && new RegExp(`^/ultra/courses/${target.cid}/discussion/_\\d+_\\d+/?$`).test(u.pathname)) urls.add(u.href); } catch { /* not a native discussion link */ }
    }
    if (urls.size === 1) {
      const url = [...urls][0];
      off();
      globalThis.GZ_PLACE?.stop();
      globalThis.GZ_CTABS?.bar?.open(url, { native: true }) || location.assign(url);
    } else timer = setTimeout(() => { timer = 0; sync(); }, 200);
  };
  return { sync, off, pending: () => !!target };
})();
GZ_DISCUSSION_NAV;
