// The "?" beside a setting (options.html button.info): its longer description in a popover, opened by a click, a tap or the
// keyboard, and on a mouse by resting on it. Placed beside the button and kept on screen when it opens. Settings page only.
var GZ_INFO = (() => {
  const GAP = 6, EDGE = 8;
  // Below the button, or above where only that has room; where neither has, on the roomier side, scrolling within. Never
  // over the button, never past the window's edges.
  const place = (button, pop) => {
    pop.style.maxHeight = '';
    const b = button.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    const below = innerHeight - EDGE - b.bottom - GAP, above = b.top - GAP - EDGE, down = h <= below || (h > above && below >= above);
    const room = down ? below : above, tall = Math.min(h, room);
    const left = Math.max(EDGE, Math.min(b.left - 12, innerWidth - w - EDGE));
    Object.assign(pop.style, { left: `${left}px`, top: `${down ? b.bottom + GAP : b.top - GAP - tall}px`, maxHeight: h > room ? `${room}px` : '' });
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
      // It stays by its button while the page scrolls or resizes under it.
      const follow = () => {
        const b = button.getBoundingClientRect();
        if (!button.getClientRects().length || b.bottom <= 0 || b.top >= innerHeight || b.right <= 0 || b.left >= innerWidth) {
          pop.hidePopover(); return;
        }
        place(button, pop);
      };
      pop.addEventListener('beforetoggle', (e) => {
        if (e.newState === 'open') { pop.classList.remove('placed'); return; }
        rested = false; removeEventListener('scroll', follow, true); removeEventListener('resize', follow);
      });
      pop.addEventListener('toggle', (e) => {
        if (e.newState !== 'open') return;
        place(button, pop); pop.classList.add('placed');
        addEventListener('scroll', follow, { capture: true, passive: true }); addEventListener('resize', follow);
      });
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
