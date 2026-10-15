// Google Calendar sync, a Canvas or Blackboard Ultra page's side (Chrome). lib/background.js runs this file in Canvas
// sites' and Ultra's top frames only while the student is connected. It works out what Export calendar (.ics) would save,
// with the same remembered choices (features/calexport.js compose), and hands the events to the worker, which writes what
// changed to the Glaze calendar (lib/gcal.js). When: as the page opens, if this account's last run was 15 minutes ago or
// more; every 15 minutes while the page stays open (no alarms permission: with no such page open there's nothing new to read); 10
// seconds after Better To Do's data, the class schedule, Gradescope's work or the export's choices change; a minute
// after a run that had more to write. Nothing shows on the page.
(() => {
  if (globalThis.GZ_GCAL_PAGE || window.top !== window) return;
  globalThis.GZ_GCAL_PAGE = true;
  const EVERY = 15 * 6e4;
  let timer = 0, busy = false, off = false, waited = 0;
  const soon = (ms, force) => { clearTimeout(timer); if (!off) timer = setTimeout(() => go(force), ms); };
  const go = async (force) => {
    const ctx = globalThis.GZ_CTX;
    // Glaze's own content script sets up this frame first; give it half a minute.
    if (!ctx) return waited++ < 30 && soon(1000, force);
    if (busy) return soon(10000, force);
    busy = true;
    let next = EVERY, again = false;
    try {
      const { gcal } = await chrome.storage.local.get('gcal');
      if (!gcal?.cal) { off = true; return; }
      if ((ctx.site !== 'canvas' && ctx.site !== 'ultra') || !ctx.on() || !ctx.settings().enabled) return;
      const me = await ctx.profile();
      if (!/^(?:\d+|_\d+_\d+)$/.test(String(me?.id))) return;
      const src = `${location.origin}/${me.id}`;
      const since = Date.now() - (gcal.last?.[src] || 0);
      if (!force && since < EVERY) { next = EVERY - since; return; }
      await ctx.need('features/calexport.js', () => globalThis.GZ_CAL_UI);
      const c = await GZ_CAL_UI.compose(null, () => ctx.on());
      if (!c || !await c.recheck()) return;
      // whole: false (Ultra couldn't send its calendar whole): the worker deletes nothing for being missing from it.
      const r = await chrome.runtime.sendMessage({ type: 'glaze:gcal', op: 'sync', src, events: c.events, from: c.from, first: c.first, consent: c.consent, whole: c.whole !== false });
      if (r?.error === 'off') off = true;
      if (r?.more) { next = 6e4; again = true; }
    } catch { /* the site or the worker didn't answer: the next turn tries again */ } finally {
      busy = false;
      soon(next, again);
    }
  };
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && 'gcal' in c && !c.gcal.newValue?.cal) { off = true; clearTimeout(timer); return; }
    const here = (k) => k.startsWith(`todo:${location.origin}/`) || k.startsWith(`classes:${location.origin}/`) || k === 'gradescope';
    if ((area === 'local' && Object.keys(c).some(here)) || (area === 'sync' && (c.todo || c.enabled || c.enhance))) soon(10000, true);
  });
  go(false);
})();
