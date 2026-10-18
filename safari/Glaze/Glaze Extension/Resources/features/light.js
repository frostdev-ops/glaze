// Expressive motion's pointer light, loaded by content.js (need) once motion is expressive: a hovered card carries a soft
// light under the pointer (extras.css, canvas.css, moodle.css). --gz-mx/--gz-my go on the card those sheets light, not on
// <html>, where every move restyled the whole page. One write per frame; content.js's sweep skips these style changes.
var GZ_LIGHT = globalThis.GZ_LIGHT || (() => {
  const LIT = '.element-card, .content-list-item > .itemContainer, .element-list-row, .messages-container-summary, .ic-DashboardCard, .ig-row, .ic-item-row, [data-region="course-content"].card';
  let raf = 0, last = null, lit = null;
  const light = (el, e) => { el?.style.setProperty('--gz-mx', e ? `${e.clientX}px` : ''); el?.style.setProperty('--gz-my', e ? `${e.clientY}px` : ''); };
  document.addEventListener('pointermove', (e) => {
    // A finger has no hover: the light would stay wherever the last touch was.
    last = e.pointerType !== 'touch' && document.documentElement.getAttribute('data-gz-motion') === 'expressive' && e;
    if (!raf && (last || lit)) raf = requestAnimationFrame(() => {
      raf = 0;
      const el = (last && last.target.closest?.(LIT)) || null;
      if (lit !== el) light(lit);
      light(lit = el, last);
    });
  }, { passive: true });
  const unlit = (s) => (s || '').replace(/(^|;)\s*--gz-m[xy]:[^;]*/g, '').replace(/;\s*$/, '').trim();
  return { owns: (r) => r.attributeName === 'style' && unlit(r.oldValue) === unlit(r.target.getAttribute('style')) };
})();
GZ_LIGHT;
