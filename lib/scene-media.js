// Glaze — media backgrounds (bg.kind "media"): a looping video, an animated picture or a Lottie animation behind the page.
// content.js imports this module only once a Look with one is worn, and only in the top frame, so none of it costs anything
// otherwise; Lottie's player (lib/lottie/, the official light build: no expressions, so no eval) is imported only for a
// Lottie animation. Always muted, never with controls, drawn behind the page like the scenes. Motion off draws the first
// frame and stops; a hidden tab pauses; a Glaze reloaded under the page keeps the last frame. What can't be shown (an
// address that doesn't load, a host page's policy, a file that isn't on this computer) leaves the gradient: onFail says why.
//
// start(host, live, onFail) → { update(o), draw(), stop() }. host is an empty element in the page; o is { x, ground, speed }:
// x the Look's parts (GZ_CTX.parts()), ground the colour the dim fades toward, speed 0 for a still frame.
// Sources are cleaned before they get here (lib/lookparts.js): an https address, or `file:<sha-256>` for a file kept on this
// computer (kept by the worker, put by the editor, a Look share or the gallery), or `mod:<id>/<path>` for a file
// an installed mod carries, asked of the worker ('glaze:modpage' media), which checks the mod and cleans the file. A video or
// picture at an https address is asked of the worker too ('glaze:remoteMedia'): it fetches the address with no referrer, under
// a byte cap, reads the file under the size, frame and pixel limits a kept file has, and hands back a cleaned copy, so no
// element here is ever given the address itself. A Lottie file is asked of the worker ('glaze:lottie'), which hands back only
// a cleaned copy of what a kept file or the worn Look's address holds.
const FITS = { cover: ['cover', 'xMidYMid slice'], contain: ['contain', 'xMidYMid meet'], fill: ['fill', 'none'] };
const MIMES = { video: ['video/webm', 'video/mp4'], image: ['image/webp', 'image/avif'] };
const DEFAULTS = { fit: 'cover', dim: 40, loop: true };
// The longest side a picture or video may have once the browser has decoded it: lib/media.js's LIMIT.bg.image.side, which the worker
// held the container to. The decoder is the one that has to hold the frames, so it is asked again.
const SIDE = 4096;
const tooBig = (w, h) => w > SIDE || h > SIDE;
const limits = () => Object.assign(new Error('limits'), { why: 'limits' });

// In the editor's preview (an extension page in a frame of the options page) the parent page is told what happened:
// { gzMediaState: { state: 'ready' | 'failed', why? } }.
const tell = (m) => { if (/-extension:$/.test(location.protocol) && parent !== window) parent.postMessage(m, location.origin); };

let lottieLoad = null, lottieAttempt = 0;
// A rejected module URL stays failed in the browser, even after its promise is forgotten.
const loadLottie = () => (lottieLoad ||= import(chrome.runtime.getURL(`lib/lottie/lottie_light_canvas.min.js?gzMediaRetry=${lottieAttempt++}`)).then(() => {
  if (typeof globalThis.lottie?.loadAnimation !== 'function') throw new Error('lottie');
  return globalThis.lottie;
}).catch((error) => {
  lottieLoad = null;
  throw Object.assign(new Error('lottie'), { why: 'module', cause: error });
}));

const layer = (tag) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries({ position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', 'pointer-events': 'none' })) e.style.setProperty(k, v);
  return e;
};
const revoke = (src) => { if (src.revoke) { URL.revokeObjectURL(src.url); src.revoke = false; } };
const once = (target, ok, bad) => new Promise((res, rej) => {
  target.addEventListener(ok, () => res(), { once: true });
  if (bad) target.addEventListener(bad, () => rej(new Error(bad)), { once: true });
});
const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
// A worker's base64 as bytes, or null.
const unb64 = (b64) => {
  try {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return null; }
};
// A worker's file as { bytes, mime }, if it is a file of the kind asked for.
const filed = (r, type) => {
  if (!r?.ok || typeof r.b64 !== 'string' || !(MIMES[type] || []).includes(r.mime)) return null;
  const bytes = unb64(r.b64);
  return bytes && { bytes, mime: r.mime };
};
// A file kept on this computer, as bytes, from the worker that keeps it ('glaze:keptFile'). It was checked and named by its
// SHA-256 when it was kept, and only the worker writes it, so it isn't hashed again on every page.
const kept = async (h, type) => filed(await send({ type: 'glaze:keptFile', h }), type);
const modFile = (src) => src.startsWith('mod:');
const ask = (src) => (modFile(src) ? send({ type: 'glaze:modpage', op: 'media', src }).then((r) => (r?.ok && r.kind === 'lottie' ? r : { ok: false, error: 'missing' }))
  : send({ type: 'glaze:lottie', src }));
// A mod's file, as bytes, of the kind the Look part says.
const carried = async (src, type) => {
  const r = await send({ type: 'glaze:modpage', op: 'media', src });
  return r?.kind === type ? filed(r, type) : null;
};
// A video or picture at an https address, as bytes: fetched and cleaned by the worker (lib/media.js remote), which refuses what
// is past the limits a kept file has. why 'limits' tells the editor the file is too big, not that the link is wrong.
const fetched = async (src, type) => {
  const r = await send({ type: 'glaze:remoteMedia', src, kind: type });
  const f = r?.type === type ? filed(r, type) : null;
  if (!f) throw Object.assign(new Error('remote'), { why: ['big', 'type'].includes(r?.error) ? 'limits' : 'load' });
  return f;
};

export const start = (host, live = () => true, onFail = () => {}) => {
  let key = '', spec = null, still = true, ground = '#000', view = null, dim = null, turn = 0;
  let stopped = false, failed = false, frozen = false;
  // Elements still loading for a build nobody waits for any more: let go of what they were fetching.
  const loose = new Map(), loading = new Set();
  const abandon = () => {
    for (const [e, src] of loose) { e.removeAttribute('src'); e.load?.(); revoke(src); }
    loose.clear();
    for (const anim of loading) anim.destroy();
    loading.clear();
  };

  // 'play', 'hold' (the tab is hidden: stay where it is), 'first' (motion off), or 'freeze' (Glaze went away).
  const mode = () => (!live() ? 'freeze' : still ? 'first' : document.hidden ? 'hold' : 'play');
  const teardown = () => {
    turn++;
    abandon();
    view?.stop();
    view = null;
    removeEventListener('resize', onResize);
    clearTimeout(resizing);
    host.replaceChildren();
  };
  const fail = (why) => {
    if (failed || stopped) return;
    failed = true;
    teardown();
    document.removeEventListener('visibilitychange', apply);
    tell({ gzMediaState: { state: 'failed', why } });
    onFail(why);
  };
  // Cut off (Glaze reloaded under the tab): everything pauses and the last frame stays until the page loads again.
  const freeze = () => {
    if (stopped || frozen) return;
    frozen = true;
    view?.mode('hold');
    removeEventListener('resize', onResize);
    clearTimeout(resizing);
    document.removeEventListener('visibilitychange', apply);
  };
  function apply() {
    if (stopped || failed || frozen) return;
    const m = mode();
    if (m === 'freeze') return freeze();
    view?.mode(m);
  }
  document.addEventListener('visibilitychange', apply);
  let resizing = 0;
  function onResize() { clearTimeout(resizing); resizing = setTimeout(() => view?.resize?.(), 150); }

  // The fit and dim are style only: a slider moving them changes nothing that loads.
  const paint = () => {
    const D = { ...DEFAULTS, ...spec };
    view?.fit?.(FITS[D.fit][0]);
    if (dim) { dim.style.setProperty('background', ground); dim.style.setProperty('opacity', String(D.dim / 100)); }
  };

  // ---- the three kinds ------------------------------------------------------------------------------------------
  // Each builder resolves { el, mode(m), stop(), resize? } once the first frame is ready, or rejects.
  const source = async (s, type) => {
    if (s.src.startsWith('file:') || modFile(s.src)) {
      const f = modFile(s.src) ? await carried(s.src, type) : await kept(s.src.slice(5), type);
      if (!f) throw Object.assign(new Error('file'), { why: 'file' });
      return { url: URL.createObjectURL(new Blob([f.bytes], { type: f.mime })), bytes: f.bytes, mime: f.mime, revoke: true };
    }
    if (!s.src.startsWith('https://')) throw new Error('bad');
    const f = await fetched(s.src, type);
    return { url: URL.createObjectURL(new Blob([f.bytes], { type: f.mime })), bytes: f.bytes, mime: f.mime, revoke: true };
  };
  const video = async (s, mine) => {
    const src = await source(s, 'video');
    if (mine !== turn) { revoke(src); throw new Error('stale'); }
    const v = layer('video');
    Object.assign(v, { muted: true, defaultMuted: true, loop: s.loop !== false, playsInline: true, controls: false, preload: 'auto', disablePictureInPicture: true, disableRemotePlayback: true, tabIndex: -1 });
    v.setAttribute('muted', '');
    v.setAttribute('aria-hidden', 'true');
    const ready = once(v, 'loadeddata', 'error');
    const metadata = new Promise((_, reject) => v.addEventListener('loadedmetadata', () => { if (tooBig(v.videoWidth, v.videoHeight)) reject(limits()); }, { once: true }));
    loose.set(v, src);
    v.src = src.url;
    try {
      await Promise.race([ready, metadata]);
      if (tooBig(v.videoWidth, v.videoHeight)) throw limits();
    } catch (e) { v.pause(); v.removeAttribute('src'); v.load(); revoke(src); throw e; } finally { loose.delete(v); }
    return {
      el: v,
      fit: (f) => v.style.setProperty('object-fit', f),
      mode: (m) => {
        if (m === 'play') { if (!v.ended) v.play().catch(() => {}); return; }
        v.pause();
        if (m === 'first' && v.currentTime) v.currentTime = 0;
      },
      stop: () => { v.pause(); v.removeAttribute('src'); v.load(); revoke(src); },
    };
  };
  // An animated picture moves by itself in an <img>, which can't be paused, so a still is a canvas with its first frame, drawn
  // from the file's own bytes. Only one of the two is on the page at a time.
  const image = async (s, mine) => {
    const src = await source(s, 'image');
    if (mine !== turn) { revoke(src); throw new Error('stale'); }
    const img = layer('img'), canvas = layer('canvas');
    img.alt = ''; img.decoding = 'async'; img.referrerPolicy = 'no-referrer'; img.draggable = false;
    let drawn = false;
    const first = async () => {
      if (drawn) return;
      drawn = true;
      const pic = await createImageBitmap(new Blob([src.bytes], { type: src.mime })), w = pic.width, h = pic.height;
      const k = Math.min(1, 1920 / Math.max(w, h));
      canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k));
      canvas.getContext('2d').drawImage(pic, 0, 0, canvas.width, canvas.height);
      pic.close?.();
    };
    // Ready once the picture decodes, in the element that will show it.
    const probe = Object.assign(new Image(), { referrerPolicy: 'no-referrer' });
    loose.set(probe, src);
    probe.src = src.url;
    try {
      await probe.decode();
      if (tooBig(probe.naturalWidth, probe.naturalHeight)) throw limits();
    } catch (e) { revoke(src); throw e; } finally { loose.delete(probe); probe.src = ''; }
    const box = layer('div');
    let shown = '';
    const show = async (what) => {
      if (what === shown) return;
      shown = what;
      if (what === 'img') { box.replaceChildren(img); img.src = src.url; return; }
      await first();
      if (shown === 'canvas') { box.replaceChildren(canvas); img.removeAttribute('src'); }
    };
    return {
      el: box,
      fit: (f) => { for (const e of [img, canvas]) e.style.setProperty('object-fit', f); },
      mode: (m) => { if (m === 'play') show('img'); else if (m === 'first') show('canvas').catch(() => {}); },
      stop: () => { shown = ''; img.removeAttribute('src'); revoke(src); },
      first,
    };
  };
  const lottie = async (s, mine) => {
    const [player, got] = await Promise.all([loadLottie(), ask(s.src)]);
    if (!got?.ok) throw Object.assign(new Error('lottie'), { why: got?.error === 'missing' ? 'file' : 'load' });
    if (mine !== turn) throw new Error('stale');
    const box = layer('div');
    host.append(box); // it is measured as it is set up
    const fits = () => Number.isSafeInteger(got.canvases) && got.canvases > 0
      && Math.max(1, host.offsetWidth) * Math.max(1, host.offsetHeight) * got.canvases <= 6.4e7;
    if (!fits()) throw new Error('budget');
    // Player setup is asynchronous; a resize while loading must not enlarge unchecked buffers.
    box.style.setProperty('width', `${Math.max(1, host.offsetWidth)}px`);
    box.style.setProperty('height', `${Math.max(1, host.offsetHeight)}px`);
    const D = { ...DEFAULTS, ...s };
    const anim = player.loadAnimation({ container: box, renderer: 'canvas', loop: s.loop !== false, autoplay: false, animationData: got.json,
      rendererSettings: { preserveAspectRatio: FITS[D.fit][1], clearCanvas: true, dpr: 1 } });
    loading.add(anim);
    try {
      if (!anim.isLoaded) await new Promise((res, rej) => { anim.addEventListener('DOMLoaded', res); anim.addEventListener('data_failed', () => rej(new Error('lottie'))); });
      if (!fits()) throw new Error('budget');
    } catch (e) { anim.destroy(); throw e; } finally { loading.delete(anim); }
    box.style.setProperty('width', '100%');
    box.style.setProperty('height', '100%');
    anim.setSubframe?.(false);
    const canvas = box.querySelector('canvas'), poster = layer('img');
    poster.alt = '';
    let held = '', snapshot = 0, stillUrl = '';
    const release = () => { if (stillUrl) URL.revokeObjectURL(stillUrl); stillUrl = ''; };
    const capture = () => {
      const mine = ++snapshot;
      canvas.toBlob((blob) => {
        if (mine !== snapshot || !blob) return;
        release();
        stillUrl = URL.createObjectURL(blob);
        poster.src = stillUrl;
        canvas.width = canvas.height = 0;
      });
      box.replaceChildren(poster); // a paused canvas still costs software compositor work
    };
    return {
      el: box,
      mode: (m) => {
        if (m === held) return;
        if (m === 'play') {
          snapshot++; release();
          box.replaceChildren(canvas);
          if (held) { if (!fits()) return fail('load'); anim.resize(); }
          held = '';
          anim.play();
        } else {
          held = m;
          if (m === 'first') anim.goToAndStop(0, true); else anim.pause();
          capture();
        }
      },
      resize: () => { if (!fits()) return fail('load'); anim.resize(); if (held) capture(); },
      stop: () => { snapshot++; release(); try { anim.destroy(); } catch { /* already gone */ } },
    };
  };

  const build = async (s) => {
    const mine = ++turn;
    try {
      const v = await ({ video, image, lottie }[s.type] || (() => { throw new Error('type'); }))(s, mine);
      if (mine !== turn || stopped || failed) { v.stop(); return; }
      view = v;
      dim = layer('div');
      host.replaceChildren(v.el, dim);
      addEventListener('resize', onResize);
      paint();
      tell({ gzMediaState: { state: 'ready' } });
      apply();
    } catch (e) {
      if (mine === turn) fail(e?.why || 'load');
    }
  };

  return {
    update(o) {
      if (stopped || failed || frozen) return;
      if (!live()) return freeze();
      const s = o.x?.bg?.media;
      if (!s || typeof s.src !== 'string') return fail('empty');
      still = !(o.speed > 0);
      ground = o.ground || ground;
      spec = s;
      // What loads: the kind, the address and whether it loops; a Lottie animation also its fit (set when it is made).
      const k = JSON.stringify([s.type, s.src, s.loop !== false, s.type === 'lottie' ? s.fit : null]);
      if (k !== key) { key = k; abandon(); if (view) { view.stop(); view = null; } host.replaceChildren(); dim = null; build(s); } else { paint(); apply(); }
    },
    draw: apply,
    stop() {
      if (stopped) return;
      stopped = true;
      teardown();
      document.removeEventListener('visibilitychange', apply);
    },
  };
};
