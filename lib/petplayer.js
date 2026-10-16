// One low-rate clock per visible pet, stopped on hide, removal, context invalidation and pagehide.
var GZ_PET_PLAYER = globalThis.GZ_PET_PLAYER || (() => {
  const mount = (canvas, pet) => {
    const S = GZ_PET_SPRITES, context = canvas.getContext('2d'), image = new Image();
    canvas.width = 192; canvas.height = 208;
    let alive = true, loaded = false, visible = true, timer = 0, state = 'idle', began = performance.now(), gaze = 0, objectURL = '';
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const draw = () => {
      clearTimeout(timer); timer = 0;
      if (!alive || !loaded || !canvas.isConnected || document.hidden || !visible) return;
      if (typeof chrome !== 'undefined' && !chrome.runtime?.id) { stop(); return; }
      const elapsed = performance.now() - began;
      if (['waving', 'jumping', 'failed', 'review'].includes(state) && elapsed >= S.COUNTS[S.STATES.indexOf(state)] * 125) { state = 'idle'; began = performance.now(); }
      const f = S.frame(reduced.matches ? 'idle' : state, reduced.matches ? 0 : state === 'look' ? gaze : elapsed, pet.spriteVersionNumber);
      context.clearRect(0, 0, 192, 208); context.drawImage(image, f.x, f.y, 192, 208, 0, 0, 192, 208);
      if (!reduced.matches && state !== 'look') timer = setTimeout(draw, 125);
    };
    const set = (next, direction = 0) => { if (!alive) return; state = next; gaze = direction; began = performance.now(); draw(); };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; draw(); }) : null;
    const stop = () => {
      if (!alive) return;
      alive = false; clearTimeout(timer); observer?.disconnect();
      document.removeEventListener('visibilitychange', draw); window.removeEventListener('pagehide', stop); reduced.removeEventListener('change', draw);
      image.onload = image.onerror = null; image.src = ''; if (objectURL) URL.revokeObjectURL(objectURL);
    };
    image.onload = () => { if (alive) { loaded = true; draw(); } };
    image.onerror = stop;
    if (pet.data) { objectURL = URL.createObjectURL(new Blob([S.dataBytes(pet.data)], { type: pet.data.startsWith('data:image/png') ? 'image/png' : 'image/webp' })); image.src = objectURL; }
    else image.src = chrome.runtime.getURL(pet.path);
    observer?.observe(canvas);
    document.addEventListener('visibilitychange', draw); window.addEventListener('pagehide', stop); reduced.addEventListener('change', draw);
    return { set, stop, sleep: () => { visible = false; draw(); }, wake: () => { visible = true; draw(); } };
  };
  return { mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_PLAYER; else GZ_PET_PLAYER;
