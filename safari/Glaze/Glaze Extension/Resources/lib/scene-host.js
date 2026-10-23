// A single renderer covers the full visible shell, including the space around Glaze's bars.
// Loaded with animated backgrounds only; partial-width sheets keep their own backgrounds.
var GZ_SCENE_HOST = (() => {
  const layers = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  // Something of the page shows beside a shell, under it.
  const beneath = (shell) => [...shell.parentElement.children].some((c) => c !== shell && c.getClientRects().length && c.getBoundingClientRect().height > 0);
  // [shell, over]: over when the shell is a layer over the page (an off-canvas panel, an item, a routed page over another).
  const find = (ultra) => {
    // Retained tabs hide the native course's ancestors, while the shared navbar stays visible.
    if (ultra && document.documentElement.hasAttribute('data-gz-ctab-framed')) return [document.body, false];
    const layer = ultra ? [...document.querySelectorAll(layers)].filter(e => e.getClientRects().length).pop() : null;
    const course = layer?.closest('.course-content-container');
    // Routed discussions put their clipped content panel beside the navbar, inside a full-width page shell.
    const routed = layer?.closest('.routed-page.bb-offcanvas-container');
    // Legacy item panels are siblings of the course scroller, without an off-canvas shell.
    const item = layer?.parentElement === course && course && course.querySelector('.panel-wrap') !== layer;
    const off = layer?.closest('.bb-offcanvas-panel');
    const shell = off || (item ? layer : course) || routed || layer || document.body;
    // A course or routed page that is all a course tab's frame holds covers nothing; over a base page it does.
    const page = shell === course ? course.closest('.bb-offcanvas-container') || course : shell === routed ? routed : null;
    return [shell, !!off || !!item || (!!page && beneath(page))];
  };
  const home = (ultra) => find(ultra)[0];
  const hosts = new WeakMap();
  // A course tab's frame (content.js syncThrough). Wearing the page's background with no layer over its course page, it lets
  // the page's show through, and the page hides its own strip under it (features/coursetabs.css). Drawing one of its own, it
  // draws it where the page's is (--gz-vx/vy/vw/vh: the page's viewport in the frame's pixels) and on the page's clock. The
  // scenes of both hear the pointer over both, for their parallax.
  let shown = false, visible = false, armed = false, pointAt = null, followed = null, relaying = false, at = [0, 0];
  const pageRoot = () => { try { return parent.document.documentElement; } catch { return null; } };
  const view = () => {
    try {
      const r = frameElement.getBoundingClientRect(), s = document.documentElement.style;
      at = [r.left, r.top];
      s.setProperty('--gz-vx', `${-r.left}px`); s.setProperty('--gz-vy', `${-r.top}px`);
      s.setProperty('--gz-vw', `${parent.innerWidth}px`); s.setProperty('--gz-vh', `${parent.innerHeight}px`);
    } catch { /* left the page */ }
  };
  const forward = (e) => {
    if (!visible || e.pointerType === 'touch' || !pageRoot()?.hasAttribute('data-gz-scene-pointer')) return;
    if (!pointAt) requestAnimationFrame(() => {
      if (visible && pageRoot()?.hasAttribute('data-gz-scene-pointer')) parent.postMessage({ gzScenePoint: pointAt }, location.origin);
      pointAt = null;
    });
    pointAt = [e.clientX, e.clientY];
  };
  // The page's pointer, for a frame's own scene: scene.point takes its own window's pixels.
  const fromPage = (e) => { if (visible && e.pointerType !== 'touch' && followed?.follows) followed.point?.(e.clientX - at[0], e.clientY - at[1]); };
  const relay = (e) => {
    const p = e.data?.gzScenePoint;
    if (e.origin !== location.origin || !followed?.follows || !followed?.point || !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)) return;
    const f = [...document.querySelectorAll('#gz-ctabs-frames > iframe')].find((x) => x.contentWindow === e.source);
    if (!f || f.hidden || f.inert || f.style.visibility === 'hidden') return;
    const r = f.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && p[0] >= 0 && p[0] <= r.width && p[1] >= 0 && p[1] <= r.height) followed.point(p[0] + r.left, p[1] + r.top);
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
        view();
        addEventListener('resize', view);
        addEventListener('pointermove', forward, { passive: true });
        parent.addEventListener('pointermove', fromPage, { passive: true });
        addEventListener('pagehide', () => { try { parent.removeEventListener('pointermove', fromPage); } catch { /* gone */ } });
        new MutationObserver(() => again()).observe(pageRoot(), { attributeFilter: ['data-gz-bg-key', 'data-gz-scene-clock'] });
      }
      const on = !!sig && pageRoot()?.getAttribute('data-gz-bg-key') === sig && !find(ultra)[1];
      visible = !hidden;
      shown = on && visible;
      try { frameElement?.toggleAttribute('data-gz-through', shown); } catch { /* left the page */ }
      return on;
    },
    // A frame's own scene runs on the page's clock (lib/scene.js opts.clock), when the page has one.
    clock() {
      const [t, at] = (pageRoot()?.getAttribute('data-gz-scene-clock') || '').split(',').map(Number);
      return Number.isFinite(t) && at > 0 ? { t, at } : undefined;
    },
    // This document's scene. The page shares its clock and whether it follows the pointer on <html>, for its frames; a
    // frame's follows the page's pointer.
    share(scene) {
      followed = scene;
      if (window.top !== window) return;
      const html = document.documentElement, c = scene?.clock, at = c ? `${c.t},${c.at}` : null;
      html.toggleAttribute('data-gz-scene-pointer', !!scene?.follows);
      if (at === null) html.removeAttribute('data-gz-scene-clock'); else if (html.getAttribute('data-gz-scene-clock') !== at) html.setAttribute('data-gz-scene-clock', at);
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
