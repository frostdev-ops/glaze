// A single renderer covers the full visible shell, including the space around Glaze's bars.
// Loaded with animated backgrounds only; partial-width sheets keep their own backgrounds.
var GZ_SCENE_HOST = (() => {
  const layers = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  const home = (ultra) => {
    // Retained tabs hide the native course's ancestors, while the shared navbar stays visible.
    if (ultra && document.documentElement.hasAttribute('data-gz-ctab-framed')) return document.body;
    const layer = ultra ? [...document.querySelectorAll(layers)].filter(e => e.getClientRects().length).pop() : null;
    const course = layer?.closest('.course-content-container');
    // Routed discussions put their clipped content panel beside the navbar, inside a full-width page shell.
    const routed = layer?.closest('.routed-page.bb-offcanvas-container');
    // Legacy item panels are siblings of the course scroller, without an off-canvas shell.
    const item = layer?.parentElement === course && course && course.querySelector('.panel-wrap') !== layer;
    return layer?.closest('.bb-offcanvas-panel') || (item ? layer : course) || routed || layer || document.body;
  };
  const hosts = new WeakMap();
  // Mods may detach their element before handing it back to content.js.
  const clear = (element) => {
    (hosts.get(element) || element?.parentNode)?.removeAttribute('data-gz-scene-host');
    hosts.delete(element);
  };
  return {
    clear,
    place(element, ultra) {
      const target = home(ultra);
      const moved = element.parentNode !== target;
      if (moved) { clear(element); target.append(element); }
      if (!target.hasAttribute('data-gz-scene-host')) target.setAttribute('data-gz-scene-host', '');
      hosts.set(element, target); return moved;
    },
  };
})();
GZ_SCENE_HOST;
