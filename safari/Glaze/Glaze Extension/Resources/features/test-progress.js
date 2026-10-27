// A test attempt's progress band (the bar, "N of M questions remaining") sticks to the top of Ultra's scroller as a whole
// band, over the questions being read. In its place it stays as it is; once it has left its place it is marked
// data-gz-stuck and theme.css folds it into a small pill. The height folded is given back below it as --gz-progress-fold,
// so nothing under it moves (and the fold can't unstick it). A page feature (features/routes.js).
var GZ_TEST_PROGRESS = globalThis.GZ_TEST_PROGRESS || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  const BAND = '.assessment-attempt-panel .assessment-progress-header';
  let listening = false, frame = 0, place = new WeakMap();
  // How far into its parent the band sits in its place: read once with its sticking turned off.
  const offset = (band) => {
    band.style.setProperty('position', 'static', 'important');
    const at = band.getBoundingClientRect().top - band.parentElement.getBoundingClientRect().top;
    band.style.removeProperty('position');
    return at;
  };
  const fold = (band, stuck) => {
    if (stuck === band.hasAttribute('data-gz-stuck')) return;
    if (!stuck) { band.removeAttribute('data-gz-stuck'); band.style.removeProperty('--gz-progress-fold'); return; }
    const whole = band.offsetHeight;
    band.setAttribute('data-gz-stuck', '');
    band.style.setProperty('--gz-progress-fold', `${Math.max(0, whole - band.offsetHeight)}px`);
  };
  const check = () => {
    frame = 0;
    if (!listening || !ctx.on()) return;
    for (const band of document.querySelectorAll(BAND)) {
      const parent = band.parentElement;
      if (!parent) continue;
      if (!place.has(band)) place.set(band, offset(band));
      fold(band, band.getBoundingClientRect().top - parent.getBoundingClientRect().top > place.get(band) + 0.5);
    }
  };
  const later = () => { if (!frame) frame = requestAnimationFrame(check); };
  const resized = () => { place = new WeakMap(); later(); };
  const off = () => {
    cancelAnimationFrame(frame); frame = 0;
    if (listening) { document.removeEventListener('scroll', later, true); globalThis.removeEventListener('resize', resized); }
    listening = false;
    for (const band of document.querySelectorAll(BAND)) fold(band, false);
  };
  const sync = () => {
    if (!ctx.on()) return off();
    if (!listening) { document.addEventListener('scroll', later, { capture: true, passive: true }); globalThis.addEventListener('resize', resized); }
    listening = true;
    later();
  };
  return { sync, off };
})();

GZ_TEST_PROGRESS;
