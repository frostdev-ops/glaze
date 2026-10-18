// One clock per visible pet; active poses blend at 30 fps, quiet loops keep their low rate.
var GZ_PET_PLAYER = globalThis.GZ_PET_PLAYER || (() => {
  const mount = (canvas, pet) => {
    if (typeof chrome !== 'undefined' && !chrome.runtime?.id) throw Error('reloaded');
    const S = GZ_PET_SPRITES, buddy = pet.layout === 'buddy', legacy = pet.layout === 'card' || buddy, width = legacy ? 128 : 192, height = legacy ? 128 : 208;
    const counts = legacy ? S.STATES.map(() => 4) : S.counts(pet.frameCounts, pet.spriteVersionNumber), context = canvas.getContext('2d'), image = new Image();
    const reactionPath = S.reactionPath(pet), fallback = { xp: 'waving', 'level-up': 'jumping', sleeping: 'waiting', swimming: 'running', climbing: 'running', playing: 'jumping', perching: 'idle', peeking: 'look' };
    const oneShot = (pose) => ['waving', 'jumping', 'failed', 'review', 'xp', 'level-up'].includes(pose), fadeTime = 180;
    canvas.width = width; canvas.height = height;
    let alive = true, loaded = false, painted = false, visible = true, sleeping = false, timer = 0, raf = 0, state = 'idle', resting = 'idle', began = performance.now(), gaze = 0, objectURL = '', reactions = null, reactionLoaded = false, snapshot = null, fading = false, fadeBegan = 0, lastPaint = -Infinity;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const valid = () => canvas.isConnected && (typeof chrome === 'undefined' || chrome.runtime?.id);
    const still = () => reduced.matches || document.documentElement?.getAttribute('data-gz-motion') === 'off';
    const cancel = () => { clearTimeout(timer); timer = 0; if (raf) cancelAnimationFrame(raf); raf = 0; };
    const transition = (now) => {
      if (!painted || still() || document.hidden || !visible || sleeping) { fading = false; return; }
      if (!snapshot) { snapshot = document.createElement('canvas'); snapshot.width = width; snapshot.height = height; }
      const copy = snapshot.getContext('2d'); copy.clearRect(0, 0, width, height); copy.drawImage(canvas, 0, 0);
      fadeBegan = now; fading = true;
    };
    const draw = (scheduled = false) => {
      cancel();
      if (!alive) return;
      if (!valid()) { stop(); return; }
      if (!loaded || document.hidden || !visible || sleeping) { fading = false; return; }
      const now = performance.now(), quiet = still();
      let elapsed = Math.max(0, now - began);
      const duration = reactionLoaded && S.REACTIONS.includes(state) ? 500 : counts[Math.max(0, S.STATES.indexOf(fallback[state] || state))] * 125;
      if (oneShot(state) && elapsed >= duration) { transition(now); state = resting; began = now; elapsed = 0; }
      const reaction = !quiet && reactionLoaded && S.REACTIONS.includes(state), pose = quiet ? 'idle' : fallback[state] || state;
      const rate = reaction && state === 'sleeping' ? 500 : reaction && state === 'peeking' ? 250 : legacy && !reaction && ['idle', 'waiting', 'look'].includes(pose) ? 615 : 125;
      if (quiet) fading = false;
      const fade = fading ? Math.min(1, (now - fadeBegan) / fadeTime) : 1;
      if (fade >= 1) fading = false;
      const active = !quiet && (fading || (reaction ? state !== 'sleeping' : !['idle', 'waiting', 'look'].includes(pose)));
      if (scheduled && active && now - lastPaint < 1000 / 30 - .5) { raf = requestAnimationFrame(() => draw(true)); return; }
      const frame = (at) => {
        const f = reaction ? { x: Math.floor(at / rate) % 4 * 128, y: S.REACTIONS.indexOf(state) * 128 } : S.frame(pose, pose === 'look' ? gaze : quiet ? 0 : at, pet.spriteVersionNumber, counts);
        if (legacy && !reaction) { f.x = quiet ? 0 : Math.floor(at / rate) % 4 * 128; f.y = ['idle', 'waiting', 'look'].includes(pose) ? 0 : 128; }
        if (buddy && !reaction && pose === 'look') f.x = (gaze >= 8 ? 0 : 1) * 128;
        if (buddy && !reaction) f.y = quiet || ['idle', 'waiting'].includes(pose) ? 0 : ['running-right', 'running-left', 'running'].includes(pose) ? 128 : pose === 'jumping' ? 256 : 384;
        return f;
      };
      const paint = (f, alpha) => {
        if (alpha <= 0) return;
        context.globalAlpha = alpha;
        if (buddy && pose === 'running-left') { context.save(); context.translate(width, 0); context.scale(-1, 1); }
        if (reaction) context.drawImage(reactions, f.x, f.y, 128, 128, 0, height - width, width, width);
        else context.drawImage(image, f.x, f.y, width, height, 0, 0, width, height);
        if (buddy && pose === 'running-left') context.restore();
      };
      const f = frame(elapsed), nextAt = (Math.floor(elapsed / rate) + 1) * rate;
      // Add weighted transparent frames so the overlap stays opaque during a blend.
      const blend = active && (reaction || pose !== 'look') && !(oneShot(state) && nextAt >= duration) ? elapsed / rate % 1 : 0;
      const eased = blend * blend * (3 - 2 * blend), easedFade = fade * fade * (3 - 2 * fade);
      context.clearRect(0, 0, width, height); context.globalCompositeOperation = 'lighter';
      if (fading) { context.globalAlpha = 1 - easedFade; context.drawImage(snapshot, 0, 0); }
      paint(f, (1 - eased) * easedFade);
      if (eased) paint(frame(nextAt), eased * easedFade);
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over'; painted = true; lastPaint = now;
      if (active) raf = requestAnimationFrame(() => draw(true));
      else if (!quiet && (reaction || pose !== 'look')) timer = setTimeout(() => draw(true), rate);
    };
    const set = (next, direction = 0, replay = false) => {
      if (!alive) return;
      if (!valid()) { stop(); return; }
      const target = next === 'idle' ? resting : [...S.STATES, ...S.REACTIONS, 'look', 'swimming', 'perching'].includes(next) ? next : 'idle';
      const heading = Number.isFinite(direction) ? ((Math.round(direction) % 16) + 16) % 16 : 0;
      if (state === target && (target !== 'look' || gaze === heading) && !(replay && oneShot(target))) return;
      const now = performance.now(); transition(now); state = target; gaze = heading; began = now;
      if (reactionPath && !reactions && S.REACTIONS.includes(state)) {
        reactions = new Image();
        reactions.onload = () => {
          if (!alive) return;
          const valid = reactions.naturalWidth === 512 && reactions.naturalHeight === 768;
          if (valid && S.REACTIONS.includes(state)) transition(performance.now());
          reactionLoaded = valid; draw();
        };
        reactions.onerror = () => { if (alive) { reactionLoaded = false; draw(); } };
        reactions.src = chrome.runtime.getURL(reactionPath);
      }
      draw();
    };
    const refresh = () => draw();
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; draw(); }) : null;
    const motionObserver = typeof MutationObserver === 'function' && document.documentElement ? new MutationObserver(refresh) : null;
    const stop = () => {
      if (!alive) return;
      alive = false; cancel(); observer?.disconnect(); motionObserver?.disconnect();
      document.removeEventListener('visibilitychange', refresh); window.removeEventListener('pagehide', stop); reduced.removeEventListener('change', refresh);
      image.onload = image.onerror = null; image.src = ''; if (objectURL) URL.revokeObjectURL(objectURL);
      if (reactions) { reactions.onload = reactions.onerror = null; reactions.src = ''; }
      if (snapshot) { snapshot.width = snapshot.height = 0; snapshot = null; }
    };
    image.onload = () => { if (alive) { loaded = true; draw(); } };
    image.onerror = stop;
    if (pet.data) { objectURL = URL.createObjectURL(new Blob([S.dataBytes(pet.data)], { type: pet.data.startsWith('data:image/png') ? 'image/png' : 'image/webp' })); image.src = objectURL; }
    else image.src = chrome.runtime.getURL(pet.path);
    observer?.observe(canvas);
    motionObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-motion'] });
    document.addEventListener('visibilitychange', refresh); window.addEventListener('pagehide', stop); reduced.addEventListener('change', refresh);
    return { set, play: (next, direction) => set(next, direction, true), rest: (next) => { if (resting !== next) { resting = S.STATES.includes(next) || S.REACTIONS.includes(next) ? next : 'idle'; set(resting); } }, stop, sleep: () => { if (!sleeping) { sleeping = true; draw(); } }, wake: () => { if (sleeping || !valid()) { sleeping = false; draw(); } } };
  };
  return { mount };
})();
if (typeof module !== 'undefined') module.exports = GZ_PET_PLAYER; else GZ_PET_PLAYER;
