// Ultra's sticky bands over what is read under them: a test attempt's progress band (the bar, "N of M questions
// remaining") and a course's top bar (its header and tools). In its place each stays as it is; FOLD px past it, it is marked
// data-gz-stuck and theme.css folds it into a small pill, without moving anything under it, until it is back in its place.
// At its scroller's top it is whole: a trackpad's last pixels there, or Safari's bounce, never flip it. Off with the
// enhance.fold setting. A page feature (content/routes.js).
var GZ_STICKY_FOLD = globalThis.GZ_STICKY_FOLD || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  // The progress band is the pill itself: the height it folds is given back below it (--gz-fold). The course bar keeps its
  // height (--gz-whole, set before the fold) and only its tools show: no layout under it changes even for a moment, which
  // Chrome's scroll anchoring followed, scrolling the course by the fold.
  // [selector, keeps its height]
  const BANDS = [['.assessment-attempt-panel .assessment-progress-header', false], ['div.bb-course-navigation', true]];
  const FOLD = 16;
  let listening = false, frame = 0, place = new WeakMap(); // band → { at (its offset in its parent's content), scroller (the parent scrolls) }
  const wanted = () => ctx.on() && ctx.settings().enhance?.fold !== false;
  // How far into its parent's content the band sits in its place: read once with its sticking turned off.
  const offset = (band) => {
    band.style.setProperty('position', 'static', 'important');
    const at = band.getBoundingClientRect().top - band.parentElement.getBoundingClientRect().top + (band.parentElement.scrollTop || 0);
    band.style.removeProperty('position');
    return at;
  };
  const fold = (band, stuck, keep) => {
    if (stuck === band.hasAttribute('data-gz-stuck')) return;
    if (!stuck) { band.removeAttribute('data-gz-stuck'); band.style.removeProperty('--gz-fold'); band.style.removeProperty('--gz-whole'); return; }
    // Fractional heights: offsetHeight rounds, and a rounded fold moved what is under it by part of a pixel.
    const whole = band.getBoundingClientRect().height;
    if (keep) { band.style.setProperty('--gz-whole', `${whole}px`); band.setAttribute('data-gz-stuck', ''); return; }
    band.setAttribute('data-gz-stuck', '');
    band.style.setProperty('--gz-fold', `${Math.max(0, whole - band.getBoundingClientRect().height)}px`);
  };
  const check = () => {
    frame = 0;
    if (!listening || !wanted()) return;
    for (const [sel, keep] of BANDS) for (const band of document.querySelectorAll(sel)) {
      const parent = band.parentElement;
      if (!parent) continue;
      if (!place.has(band)) place.set(band, { at: offset(band), scroller: /^(auto|scroll|overlay)$/.test(globalThis.getComputedStyle?.(parent).overflowY) });
      const p = place.get(band), past = band.getBoundingClientRect().top - parent.getBoundingClientRect().top + (parent.scrollTop || 0) - p.at;
      fold(band, !(p.scroller && parent.scrollTop <= 0) && past > (band.hasAttribute('data-gz-stuck') ? 0.5 : FOLD), keep);
    }
  };
  const later = () => { if (!frame) frame = requestAnimationFrame(check); };
  const resized = () => { place = new WeakMap(); later(); };
  const off = () => {
    cancelAnimationFrame(frame); frame = 0;
    if (listening) { document.removeEventListener('scroll', later, true); globalThis.removeEventListener('resize', resized); }
    listening = false;
    for (const [sel] of BANDS) for (const band of document.querySelectorAll(sel)) fold(band, false);
  };
  const sync = () => {
    if (!wanted()) return off();
    if (!listening) { document.addEventListener('scroll', later, { capture: true, passive: true }); globalThis.addEventListener('resize', resized); }
    listening = true;
    later();
  };
  return { sync, off };
})();

GZ_STICKY_FOLD;
