// The "?" beside a setting (options.html button.info): its longer description in a popover, opened by a click, a tap or the
// keyboard, and on a mouse by resting on it. Placed beside the button and kept on screen when it opens. Settings page only.
var GZ_INFO = (() => {
  const GAP = 6, EDGE = 8;
  // Below the button, or above where there is no room; never past the window's edges.
  const place = (button, pop) => {
    const b = button.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const left = Math.max(EDGE, Math.min(b.left - 12, innerWidth - w - EDGE));
    const top = b.bottom + GAP + h <= innerHeight - EDGE ? b.bottom + GAP : Math.max(EDGE, b.top - GAP - h);
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
  };
  const mount = (root = document) => {
    const buttons = [...root.querySelectorAll('button.info[popovertarget]')];
    // Without popovers (Chrome before 114) the descriptions stay in the page and the buttons go.
    if (!Object.hasOwn(HTMLElement.prototype, 'popover')) { for (const b of buttons) b.hidden = true; for (const p of root.querySelectorAll('.info-pop')) p.classList.add('inline'); return; }
    const hover = matchMedia('(hover: hover)');
    for (const button of buttons) {
      const pop = root.getElementById(button.getAttribute('popovertarget'));
      if (!pop) continue;
      let timer = 0, rested = false;
      const later = (f, ms) => { clearTimeout(timer); timer = setTimeout(f, ms); };
      // Measured once it is open, then shown where it belongs: no frame at the wrong place.
      pop.addEventListener('beforetoggle', (e) => { if (e.newState === 'open') pop.classList.remove('placed'); else rested = false; });
      pop.addEventListener('toggle', (e) => { if (e.newState === 'open') { place(button, pop); pop.classList.add('placed'); } });
      const rest = (e) => { if (e.pointerType === 'mouse' && hover.matches && !pop.matches(':popover-open')) later(() => { rested = true; pop.showPopover(); }, 300); };
      const leave = (e) => {
        if (e.pointerType !== 'mouse') return;
        clearTimeout(timer);
        if (rested) later(() => { if (!button.matches(':hover') && !pop.matches(':hover')) pop.hidePopover(); }, 150);
      };
      button.addEventListener('pointerenter', rest); button.addEventListener('pointerleave', leave);
      pop.addEventListener('pointerenter', () => clearTimeout(timer)); pop.addEventListener('pointerleave', leave);
      // A click on one opened by resting keeps it open, instead of closing it.
      button.addEventListener('click', (e) => { clearTimeout(timer); if (rested && pop.matches(':popover-open')) { e.preventDefault(); rested = false; } });
    }
  };
  return { mount, place };
})();
if (typeof module !== 'undefined') module.exports = GZ_INFO;
