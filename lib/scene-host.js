// A single renderer covers the full visible shell, including the space around Glaze's bars.
// Loaded with animated backgrounds only; partial-width sheets keep their own backgrounds.
var GZ_SCENE_HOST = (() => {
  const layers = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  // [shell, over]: over when the shell is a layer over the page (an off-canvas panel, an item, a routed page).
  const find = (ultra) => {
    // Retained tabs hide the native course's ancestors, while the shared navbar stays visible.
    if (ultra && document.documentElement.hasAttribute('data-gz-ctab-framed')) return [document.body, false];
    const layer = ultra ? [...document.querySelectorAll(layers)].filter(e => e.getClientRects().length).pop() : null;
    const course = layer?.closest('.course-content-container');
    // Routed discussions put their clipped content panel beside the navbar, inside a full-width page shell.
    const routed = layer?.closest('.routed-page.bb-offcanvas-container');
    // Legacy item panels are siblings of the course scroller, without an off-canvas shell.
    const item = layer?.parentElement === course && course && course.querySelector('.panel-wrap') !== layer;
    const over = layer?.closest('.bb-offcanvas-panel') || (item ? layer : null) || (!course && routed);
    return [over || course || layer || document.body, !!over];
  };
  const home = (ultra) => find(ultra)[0];
  const hosts = new WeakMap();
  // A course tab's frame wearing the page's background (content.js syncThrough) lets it show through, unless a layer covers
  // its course page. While it shows, the page hides its own strip under it (features/coursetabs.css) and its scene hears the
  // pointer moving over the frame, for its parallax.
  let shown = false, armed = false, pointAt = null, followed = null, relaying = false;
  const pageRoot = () => { try { return parent.document.documentElement; } catch { return null; } };
  const forward = (e) => {
    if (!shown || e.pointerType === 'touch' || !pageRoot()?.hasAttribute('data-gz-scene-pointer')) return;
    if (!pointAt) requestAnimationFrame(() => { parent.postMessage({ gzScenePoint: pointAt }, location.origin); pointAt = null; });
    pointAt = [e.clientX, e.clientY];
  };
  const relay = (e) => {
    const p = e.data?.gzScenePoint;
    if (!Array.isArray(p) || e.origin !== location.origin || !followed?.point) return;
    const f = [...document.querySelectorAll('#gz-ctabs-frames > iframe')].find((x) => x.contentWindow === e.source);
    if (f) { const r = f.getBoundingClientRect(); followed.point(+p[0] + r.left, +p[1] + r.top); }
  };
  // Mods may detach their element before handing it back to content.js.
  const clear = (element) => {
    (hosts.get(element) || element?.parentNode)?.removeAttribute('data-gz-scene-host');
    hosts.delete(element);
  };
  return {
    clear,
    covered: (ultra) => find(ultra)[1],
    // sig: this frame's background (content.js bgSig), or false when it draws none. again: called when the page's changes.
    through(sig, ultra, hidden, again) {
      if (!armed && pageRoot()) {
        armed = true;
        addEventListener('pointermove', forward, { passive: true });
        new MutationObserver(() => again()).observe(pageRoot(), { attributeFilter: ['data-gz-bg-key'] });
      }
      const on = !!sig && pageRoot()?.getAttribute('data-gz-bg-key') === sig && !find(ultra)[1];
      shown = on && !hidden;
      try { frameElement?.toggleAttribute('data-gz-through', shown); } catch { /* left the page */ }
      return on;
    },
    // The page's scene, for its frames' pointer moves: whether it follows them is on <html> for the frames to read.
    pointer(scene) {
      if (window.top !== window) return;
      followed = scene;
      document.documentElement.toggleAttribute('data-gz-scene-pointer', !!scene?.follows);
      if (scene && !relaying) { relaying = true; addEventListener('message', relay); }
    },
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
