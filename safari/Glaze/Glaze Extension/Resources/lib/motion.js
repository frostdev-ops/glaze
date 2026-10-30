// Glaze's own UI in motion: reorders and relayouts glide (flip), what goes away fades first (exit), and changes that
// reflow the whole page crossfade (swap). Every timing is read from motion.css's knobs on <html> at the moment of the call,
// so the level, the three switches, reduced motion and a Look's own curves apply here with no branching: a knob at 0s
// means the change happens in one frame and nothing animates. Moves use the translate and scale properties, never
// transform (Ultra positions with it, and a hover lift owns it: motion.css) and never composite 'add' (which keeps an
// animation off the compositor). Local changes happen first; native page swaps defer their update for the old snapshot.
// Classic script; module.exports for node. The worker injects it ahead of the features that use it (lib/background.js
// MOVERS), and the preview loads it; a feature without it just changes in one frame. A second injection keeps the first.
var GZ_MOTION = globalThis.GZ_MOTION || (() => {
  // A CSS time ('0.25s', '250ms') in ms; anything else 0.
  const ms = (v) => {
    const m = /^(-?\d*\.?\d+)(m?s)$/.exec(String(v || '').trim());
    return m ? Math.max(0, Number(m[1]) * (m[2] === 's' ? 1000 : 1)) : 0;
  };
  // The knobs, now: move and fade lengths, curves, and whether things may enter. --gz-enter is `none` with entrances off.
  const knobs = () => {
    const s = getComputedStyle(document.documentElement);
    const v = (n) => s.getPropertyValue(n).trim();
    return { move: ms(v('--gz-t-move')), fade: ms(v('--gz-t')), ease: v('--gz-ease') || 'ease', spring: v('--gz-spring') || v('--gz-ease') || 'ease', enter: v('--gz-enter') !== 'none' };
  };
  // WAAPI takes the curve as it is, linear() included, where the browser knows it; one it doesn't throws, so a plain curve.
  const live = new Map();
  let observer = null;
  const finishHidden = () => { if (document.hidden) for (const a of live.keys()) a.finish(); };
  const watch = (el, a) => {
    if (typeof MutationObserver !== 'function') return a;
    live.set(a, el);
    if (!observer) {
      observer = new MutationObserver((records = []) => {
        const k = records.some((r) => r.type === 'attributes') && knobs();
        for (const [a, el] of live) { if (!el.isConnected) a.cancel(); else if (document.hidden || k && !k.move && !k.fade) a.finish(); }
      });
      observer.observe(document, { childList: true, subtree: true });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-gz-motion', 'data-gz-no-trans'] });
      document.addEventListener?.('visibilitychange', finishHidden);
    }
    const done = () => { live.delete(a); if (!live.size) { observer?.disconnect(); observer = null; document.removeEventListener?.('visibilitychange', finishHidden); } };
    a.finished.then(done, done);
    return a;
  };
  const play = (el, frames, o) => {
    try { return watch(el, el.animate(frames, o)); } catch { try { return watch(el, el.animate(frames, { ...o, easing: 'ease-out' })); } catch { return null; } }
  };
  // Finished, an animation lets go of its element: one left attached keeps a later transform transition there off the
  // compositor (motion.css).
  const release = (a) => a?.finished.then(() => a.cancel(), () => {});
  const ours = new WeakMap(); // element -> its running move, so the next one starts where this one has it now
  const settle = (el) => { const a = ours.get(el); if (a) { a.cancel(); ours.delete(el); } };

  // Glides `items()` from where they show to where `mutate()` puts them. items: a function giving the elements to follow,
  // called before and after; key(el) matches an element across a rebuild (default: the element itself). skip(el): left as
  // is (the one under the pointer in a drag). size: also scale from the old size (default: position only). ghosts: an
  // element that left fades out where it was, as a copy laid over its container, while the rest close up (the container
  // must be a containing block: one that isn't gets position: relative). within: an element the old box must have been
  // inside for its copy to show (a list that scrolls: no copy over what is beside it). enter: new elements fade and settle in.
  // Returns what mutate returned.
  const flip = (items, mutate, { key = (e) => e, skip = () => false, size = false, ghosts = false, enter = true, container = null, within = null } = {}) => {
    const k = typeof document !== 'undefined' && knobs();
    if (!k || document.hidden || (!k.move && !k.fade)) { for (const el of items()) settle(el); return mutate(); }
    const before = new Map();
    for (const el of items()) {
      if (skip(el)) { settle(el); continue; }
      if (el.isConnected) before.set(key(el), { el, box: el.getBoundingClientRect() });
    }
    const out = mutate();
    for (const { el } of before.values()) if (!el.isConnected) settle(el); // gone while gliding: its glide goes with it
    const seen = new Set();
    for (const el of items()) {
      if (!el.isConnected || skip(el)) continue;
      const id = key(el);
      seen.add(id);
      const was = before.get(id);
      // One that wasn't drawn before (display: none, so an empty box at the corner) comes in, not across the page.
      if (!was || (!was.box.width && !was.box.height)) {
        if (enter && k.enter && k.fade && el.getClientRects().length) release(play(el, [{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }], { duration: k.fade, easing: k.ease }));
        continue;
      }
      if (!k.move) continue;
      settle(el); // its true place, without the move still running
      const now = el.getBoundingClientRect();
      const dx = was.box.left - now.left + (size ? (was.box.width - now.width) / 2 : 0);
      const dy = was.box.top - now.top + (size ? (was.box.height - now.height) / 2 : 0);
      const sx = size && now.width ? was.box.width / now.width : 1, sy = size && now.height ? was.box.height / now.height : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      const from = { translate: `${dx}px ${dy}px`, ...(size && { scale: `${sx} ${sy}` }) };
      const to = { translate: '0px 0px', ...(size && { scale: '1 1' }) };
      const a = play(el, [from, to], { duration: k.move, easing: k.spring });
      if (!a) continue;
      ours.set(el, a);
      a.finished.then(() => { if (ours.get(el) === a) { ours.delete(el); a.cancel(); } }, () => {});
    }
    if (ghosts && k.fade && container?.isConnected) {
      const w = within?.getBoundingClientRect();
      const inside = (b) => !w || (b.left >= w.left - 1 && b.right <= w.right + 1 && b.top >= w.top - 1 && b.bottom <= w.bottom + 1);
      for (const [id, { el, box }] of before) if (!seen.has(id) && box.width && box.height && inside(box)) ghost(container, el, box, k);
    }
    return out;
  };
  // A copy of what left, where it was: never focusable, never read out, never matched as the real thing.
  const GHOSTLESS = ['id', 'role', 'name', 'for', 'href', 'data-course-id', 'data-tile', 'data-id', 'data-key', 'data-focus', 'data-act', 'aria-selected', 'aria-current', 'aria-labelledby', 'aria-describedby', 'aria-controls'];
  const ghost = (container, el, box, k) => {
    const c = el.cloneNode(true);
    for (const e of [c, ...c.querySelectorAll('*')]) {
      for (const a of GHOSTLESS) e.removeAttribute(a);
      if (e.hasAttribute('tabindex')) e.setAttribute('tabindex', '-1');
    }
    c.inert = true;
    c.setAttribute('aria-hidden', 'true');
    c.dataset.gzGhost = '';
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    const r = container.getBoundingClientRect();
    Object.assign(c.style, { position: 'absolute', margin: '0', left: `${box.left - r.left - container.clientLeft + container.scrollLeft}px`, top: `${box.top - r.top - container.clientTop + container.scrollTop}px`,
      width: `${box.width}px`, height: `${box.height}px`, pointerEvents: 'none', zIndex: '0' });
    container.append(c);
    const a = play(c, [{ opacity: 1, scale: 1 }, { opacity: 0, scale: 0.9 }], { duration: k.fade, easing: k.ease, fill: 'forwards' });
    if (!a) return c.remove();
    a.finished.then(() => c.remove(), () => c.remove());
  };

  // Fades `el` out, then removes it (`remove: false` keeps it, for a caller that hides it itself). `to`: extra keyframe
  // values to end on ({ translate: '0 8px' }). Resolves once it is gone; at once with transitions off. It can't be clicked
  // or focused while it goes. Someone else removing it first just ends the fade.
  const exits = new WeakMap();
  const exit = (el, { to = {}, remove = true } = {}) => {
    const prior = el && exits.get(el);
    if (prior) { prior.a.cancel(); el.inert = prior.inert; exits.delete(el); }
    const done = () => { if (remove) { settle(el); el.remove(); } }; // a glide still running stops with it, not after
    const k = typeof document !== 'undefined' && el?.isConnected && knobs();
    if (!k || document.hidden || !k.fade) { if (el) done(); return Promise.resolve(); }
    const inert = el.inert;
    el.inert = true;
    const a = play(el, [{ opacity: getComputedStyle(el).opacity }, { opacity: 0, scale: 0.96, ...to }], { duration: k.fade, easing: k.ease, fill: 'forwards' });
    if (!a) { done(); el.inert = inert; return Promise.resolve(); }
    const turn = { a, inert }; exits.set(el, turn);
    const restore = () => { if (exits.get(el) !== turn) return; exits.delete(el); el.inert = inert; };
    return a.finished.then(() => { if (exits.get(el) !== turn) return; done(); if (!remove) a.cancel(); restore(); }, restore);
  };

  // Settles `el` in from nothing: for what Glaze adds outside a flip. Nothing with entrances or transitions off.
  const enter = (el, { from = {} } = {}) => {
    const k = typeof document !== 'undefined' && el?.isConnected && knobs();
    if (!k || document.hidden || !k.enter || !k.fade) return null;
    const a = play(el, [{ opacity: 0, scale: 0.96, ...from }, { opacity: 1, scale: 1, translate: '0px 0px' }], { duration: k.fade, easing: k.spring });
    release(a);
    return a;
  };

  // A short pop on something that changed (a count, a figure): never on its first paint, which the caller knows.
  const pop = (el) => {
    const k = typeof document !== 'undefined' && el?.isConnected && knobs();
    if (!k || document.hidden || !k.fade) return null;
    settle(el);
    const a = play(el, [{ scale: 1 }, { scale: 1.18 }, { scale: 1 }], { duration: k.fade * 1.6, easing: k.ease });
    if (a) { ours.set(el, a); release(a); }
    return a;
  };

  // A change that reflows the page (a palette, the sidebar's width): the old page's picture crossfades into the new one on
  // the compositor, instead of every frame laying the page out again. update() runs inside the transition, a frame later;
  // without view transitions, with transitions off, in a hidden page, under a course tab's frame or inside any frame (a
  // course tab's draws its own copy of the page's background, placed and clocked to match it: a crossfade of its root alone
  // would show a seam), or while another transition runs (Ultra's page change, content-ultra.js, which a second one would
  // cut short), it runs now. Only a recent action on this page permits the crossfade, which temporarily owns hit testing.
  // Resolves once the update has run; native capture normally defers it one frame, with a bounded stalled-callback fallback.
  let swapping = null;
  const busy = () => { try { return document.documentElement.matches(':active-view-transition'); } catch { return true; } }; // unknown detection stays instant
  const framed = () => { try { return typeof window !== 'undefined' && window.top !== window; } catch { return true; } };
  // A native crossfade temporarily owns hit testing. Background settings/system changes must stay clickable.
  const asked = () => (typeof navigator === 'undefined' || !navigator.userActivation ? true : navigator.userActivation.isActive);
  // Chrome rejects a skipped or timed-out transition's ready in the page's own world too, not only in this content script's,
  // and only the page can handle it there (a school's error tracker would collect it). In a school's page a crossfade waits
  // for the guard lib/background.js puts in that world (transitionGuard): asked before it starts (it cancels the event), it
  // is told once one has. Glaze's own pages are that world, and a browser without activeViewTransition can't be guarded.
  const guarded = () => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.getURL || !('activeViewTransition' in document)) return true;
      if (chrome.runtime.getURL('').replace(/\/$/, '').toLowerCase() === location.origin.toLowerCase()) return true; // Safari lowercases its own
      return !dispatchEvent(new Event('glaze:transition', { cancelable: true }));
    } catch { return false; }
  };
  const handOver = () => { try { if (typeof dispatchEvent === 'function') dispatchEvent(new Event('glaze:transition')); } catch { /* no page world to tell */ } };
  const swap = (update) => {
    // A native transition takes its old snapshot before calling us. Flush a queued predecessor before a second
    // change, or the older callback could overwrite it; the eventual native callback then has nothing left to do.
    swapping?.run();
    const html = typeof document !== 'undefined' && document.documentElement;
    const k = html && knobs();
    if (!k || !k.fade || swapping || typeof document.startViewTransition !== 'function' || document.hidden || html.hasAttribute('data-gz-ctab-framed') || framed() || !asked() || busy() || !guarded()) {
      update();
      return Promise.resolve();
    }
    let t, ran = false, timer, resolve;
    const done = new Promise((r) => { resolve = r; });
    const run = () => { if (ran) return; ran = true; clearTimeout(timer); try { update(); } finally { resolve(); } };
    const turn = { run };
    try {
      html.setAttribute('data-gz-swap', '');
      t = document.startViewTransition(run);
    } catch { html.removeAttribute('data-gz-swap'); run(); return done; }
    handOver();
    swapping = turn;
    t.ready?.catch(() => {});
    const finish = () => { try { run(); } finally { if (swapping === turn) { swapping = null; html.removeAttribute('data-gz-swap'); } } };
    t.finished.then(finish, finish).catch(() => {});
    t.updateCallbackDone.then(run, run).catch(() => {});
    // A hidden/aborted native transition must never strand the change, even if its callbacks do not settle.
    if (!ran) timer = setTimeout(() => { try { t.skipTransition?.(); } finally { try { finish(); } catch { /* the update already settled */ } } }, 100);
    return done;
  };

  return { ms, knobs, flip, exit, enter, pop, swap };
})();

if (typeof module !== 'undefined') module.exports = GZ_MOTION; else GZ_MOTION;
