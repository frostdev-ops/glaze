// One low-rate clock per visible pet, stopped on hide, removal, context invalidation and pagehide.
var GZ_PET_PLAYER = globalThis.GZ_PET_PLAYER || (() => {
  const mount = (canvas, pet) => {
    if (typeof chrome !== 'undefined' && !chrome.runtime?.id) throw Error('reloaded');
    const S = GZ_PET_SPRITES, legacy = pet.layout === 'card', width = legacy ? 128 : 192, height = legacy ? 128 : 208;
    const counts = legacy ? S.STATES.map(() => 4) : S.counts(pet.frameCounts, pet.spriteVersionNumber), context = canvas.getContext('2d'), image = new Image();
    canvas.width = width; canvas.height = height;
    let alive = true, loaded = false, visible = true, sleeping = false, timer = 0, state = 'idle', resting = 'idle', began = performance.now(), gaze = 0, objectURL = '';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const still = () => reduced.matches || document.documentElement?.getAttribute('data-gz-motion') === 'off';
    const draw = () => {
      clearTimeout(timer); timer = 0;
      if (!alive) return;
      if (!canvas.isConnected || (typeof chrome !== 'undefined' && !chrome.runtime?.id)) { stop(); return; }
      if (!loaded || document.hidden || !visible || sleeping) return;
      let elapsed = performance.now() - began;
      if (['waving', 'jumping', 'failed', 'review'].includes(state) && elapsed >= counts[S.STATES.indexOf(state)] * 125) { state = resting; began = performance.now(); elapsed = 0; }
      const quiet = still(), f = S.frame(quiet ? 'idle' : state, quiet ? 0 : state === 'look' ? gaze : elapsed, pet.spriteVersionNumber, counts);
      // shortcut: the original cat/bunny have only idle/action poses; replace their atlas for richer reactions.
      if (legacy) { const idle = quiet || ['idle', 'waiting', 'look'].includes(state); f.x = quiet ? 0 : Math.floor(elapsed / (idle ? 615 : 125)) % 4 * 128; f.y = idle ? 0 : 128; }
      context.clearRect(0, 0, width, height); context.drawImage(image, f.x, f.y, width, height, 0, 0, width, height);
      if (!quiet && state !== 'look') timer = setTimeout(draw, 125);
    };
    const set = (next, direction = 0) => { if (!alive) return; state = next === 'idle' ? resting : next; gaze = direction; began = performance.now(); draw(); };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; draw(); }) : null;
    const motionObserver = typeof MutationObserver === 'function' && document.documentElement ? new MutationObserver(draw) : null;
    const stop = () => {
      if (!alive) return;
      alive = false; clearTimeout(timer); observer?.disconnect(); motionObserver?.disconnect();
      document.removeEventListener('visibilitychange', draw); window.removeEventListener('pagehide', stop); reduced.removeEventListener('change', draw);
      image.onload = image.onerror = null; image.src = ''; if (objectURL) URL.revokeObjectURL(objectURL);
    };
    image.onload = () => { if (alive) { loaded = true; draw(); } };
    image.onerror = stop;
    if (pet.data) { objectURL = URL.createObjectURL(new Blob([S.dataBytes(pet.data)], { type: pet.data.startsWith('data:image/png') ? 'image/png' : 'image/webp' })); image.src = objectURL; }
    else image.src = chrome.runtime.getURL(pet.path);
    observer?.observe(canvas);
    motionObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-motion'] });
    document.addEventListener('visibilitychange', draw); window.addEventListener('pagehide', stop); reduced.addEventListener('change', draw);
    return { set, rest: (next) => { if (resting !== next) { resting = next; set(next); } }, stop, sleep: () => { sleeping = true; draw(); }, wake: () => { sleeping = false; draw(); } };
  };
  return { mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_PLAYER; else GZ_PET_PLAYER;
