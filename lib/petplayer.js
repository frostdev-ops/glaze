// One low-rate clock per visible pet, stopped on hide, removal, context invalidation and pagehide.
var GZ_PET_PLAYER = globalThis.GZ_PET_PLAYER || (() => {
  const mount = (canvas, pet) => {
    if (typeof chrome !== 'undefined' && !chrome.runtime?.id) throw Error('reloaded');
    const S = GZ_PET_SPRITES, buddy = pet.layout === 'buddy', legacy = pet.layout === 'card' || buddy, width = legacy ? 128 : 192, height = legacy ? 128 : 208;
    const counts = legacy ? S.STATES.map(() => 4) : S.counts(pet.frameCounts, pet.spriteVersionNumber), context = canvas.getContext('2d'), image = new Image();
    const reactionPath = S.reactionPath(pet), fallback = { xp: 'waving', 'level-up': 'jumping', sleeping: 'waiting', swimming: 'running', climbing: 'running', playing: 'jumping', perching: 'idle', peeking: 'look' };
    canvas.width = width; canvas.height = height;
    let alive = true, loaded = false, visible = true, sleeping = false, timer = 0, state = 'idle', resting = 'idle', began = performance.now(), gaze = 0, objectURL = '', reactions = null, reactionLoaded = false;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const still = () => reduced.matches || document.documentElement?.getAttribute('data-gz-motion') === 'off';
    const draw = () => {
      clearTimeout(timer); timer = 0;
      if (!alive) return;
      if (!canvas.isConnected || (typeof chrome !== 'undefined' && !chrome.runtime?.id)) { stop(); return; }
      if (!loaded || document.hidden || !visible || sleeping) return;
      let elapsed = performance.now() - began;
      const duration = reactionLoaded && S.REACTIONS.includes(state) ? 500 : counts[S.STATES.indexOf(fallback[state] || state)] * 125;
      if (['waving', 'jumping', 'failed', 'review', 'xp', 'level-up'].includes(state) && elapsed >= duration) { state = resting; began = performance.now(); elapsed = 0; }
      const quiet = still(), reaction = !quiet && reactionLoaded && S.REACTIONS.includes(state), pose = quiet ? 'idle' : fallback[state] || state;
      const rate = reaction && state === 'sleeping' ? 500 : reaction && state === 'peeking' ? 250 : 125;
      const f = reaction ? { x: Math.floor(elapsed / rate) % 4 * 128, y: S.REACTIONS.indexOf(state) * 128 } : S.frame(pose, pose === 'look' ? gaze : quiet ? 0 : elapsed, pet.spriteVersionNumber, counts);
      if (legacy && !reaction) { const idle = quiet || ['idle', 'waiting', 'look'].includes(pose); f.x = quiet ? 0 : Math.floor(elapsed / (idle ? 615 : 125)) % 4 * 128; f.y = idle ? 0 : 128; }
      if (buddy && !reaction && pose === 'look') f.x = (gaze >= 8 ? 0 : 1) * 128;
      if (buddy && !reaction) f.y = quiet || ['idle', 'waiting'].includes(pose) ? 0 : ['running-right', 'running-left', 'running'].includes(pose) ? 128 : pose === 'jumping' ? 256 : 384;
      context.clearRect(0, 0, width, height);
      if (buddy && pose === 'running-left') { context.save(); context.translate(width, 0); context.scale(-1, 1); }
      if (reaction) context.drawImage(reactions, f.x, f.y, 128, 128, 0, height - width, width, width);
      else context.drawImage(image, f.x, f.y, width, height, 0, 0, width, height);
      if (buddy && pose === 'running-left') context.restore();
      if (!quiet && (reaction || pose !== 'look')) timer = setTimeout(draw, rate);
    };
    const set = (next, direction = 0) => {
      if (!alive) return;
      state = next === 'idle' ? resting : [...S.STATES, ...S.REACTIONS, 'look', 'swimming', 'perching'].includes(next) ? next : 'idle';
      gaze = Number.isFinite(direction) ? direction : 0; began = performance.now();
      if (reactionPath && !reactions && S.REACTIONS.includes(state)) {
        reactions = new Image();
        reactions.onload = () => { if (alive) { reactionLoaded = reactions.naturalWidth === 512 && reactions.naturalHeight === 768; began = performance.now(); draw(); } };
        reactions.onerror = () => { if (alive) { reactionLoaded = false; draw(); } };
        reactions.src = chrome.runtime.getURL(reactionPath);
      }
      draw();
    };
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; draw(); }) : null;
    const motionObserver = typeof MutationObserver === 'function' && document.documentElement ? new MutationObserver(draw) : null;
    const stop = () => {
      if (!alive) return;
      alive = false; clearTimeout(timer); observer?.disconnect(); motionObserver?.disconnect();
      document.removeEventListener('visibilitychange', draw); window.removeEventListener('pagehide', stop); reduced.removeEventListener('change', draw);
      image.onload = image.onerror = null; image.src = ''; if (objectURL) URL.revokeObjectURL(objectURL);
      if (reactions) { reactions.onload = reactions.onerror = null; reactions.src = ''; }
    };
    image.onload = () => { if (alive) { loaded = true; draw(); } };
    image.onerror = stop;
    if (pet.data) { objectURL = URL.createObjectURL(new Blob([S.dataBytes(pet.data)], { type: pet.data.startsWith('data:image/png') ? 'image/png' : 'image/webp' })); image.src = objectURL; }
    else image.src = chrome.runtime.getURL(pet.path);
    observer?.observe(canvas);
    motionObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-motion'] });
    document.addEventListener('visibilitychange', draw); window.addEventListener('pagehide', stop); reduced.addEventListener('change', draw);
    return { set, play: set, rest: (next) => { if (resting !== next) { resting = S.STATES.includes(next) || S.REACTIONS.includes(next) ? next : 'idle'; set(resting); } }, stop, sleep: () => { sleeping = true; draw(); }, wake: () => { sleeping = false; draw(); } };
  };
  return { mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_PLAYER; else GZ_PET_PLAYER;
