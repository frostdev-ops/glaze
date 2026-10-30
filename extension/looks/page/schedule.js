// Scheduled dark mode's clock (W5), loaded by content.js (need) only while a schedule is on; the first paint's choice
// is defaults.js's GZ_SCHEDULE_DARK and doesn't wait for this. One timeout to the next boundary, never a poll. A
// timer can stall while the computer sleeps, so it also rechecks the wall clock every 10 minutes at most and when the
// tab is shown. `hook.auto()` is the schedule being worn (null when there's none), `hook.reapply()` repaints.
var GZ_SCHEDULE = globalThis.GZ_SCHEDULE || (() => {
  let flip = 0, dark, hook;
  const arm = () => {
    clearTimeout(flip);
    flip = 0;
    const a = hook.auto();
    if (!a) return;
    const now = new Date(), next = GZ_SCHEDULE_NEXT(a.from, a.to, now);
    dark = GZ_SCHEDULE_DARK(a.from, a.to, now);
    if (next) flip = setTimeout(check, Math.min(next - now, 6e5));
  };
  const check = () => {
    const a = hook.auto();
    if (a && GZ_SCHEDULE_DARK(a.from, a.to, new Date()) !== dark) hook.reapply();
    else arm();
  };
  document.addEventListener('visibilitychange', () => { if (flip && !document.hidden) check(); });
  return { arm: (h) => { hook = h; arm(); } };
})();
GZ_SCHEDULE;
