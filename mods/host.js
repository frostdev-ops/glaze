// Glaze's mods host: a manifest sandbox page (an opaque origin, no extension APIs, the sandbox
// CSP), framed by features/mods.js inside a closed shadow root. It takes one handshake, from its parent, with the one-use
// nonce in its own address, and from then on talks only over the port that came with it. There it starts each mod: a
// Worker (blob:) for the mod's logic, and frame UIs (sandboxed srcdoc whose only script is mods/boot.js). Each has a
// channel of its own; what a mod sends goes up as { mod, via, id, call, args }, tagged here with which mod and where from,
// and each answer goes back to that one alone. The worker checks every call (lib/modbroker.js).
(() => {
  const want = location.hash.slice(1);
  let BOOT = new URL('boot.js', location.href).href;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const LIMIT = (1 << 20) + 16 * 1024, INFLIGHT = 64, RATE = 240;
  const mods = new Map(); // id → { worker, frames: Map(via → { el, port }) }
  const frameOf = new Map(); // a frame UI's element id → its mod
  let up = null, workerUrl = '', frames = 0;
  const send = (m) => up?.postMessage(m);

  // `glaze`, the client each mod gets: in its Worker (port: the worker's own scope) and in its frame UIs (boot.js hands it
  // the frame's port). Promise-based calls ({ id, call, args } → { id, ok, value | error }), events ({ event, data }),
  // heartbeats, and the mod's code, run once at global scope. Sent as source, so it uses nothing from around it.
  // Events Glaze sends that the client answers itself, before the mod's own handlers hear them: 'cards' and 'nav.items'
  // (the mod's transform runs and its result goes back as a call), 'palette.run' (the command's function), and in a
  // Worker 'canvas.size' and 'canvas.pause'.
  function glazeClient(port) {
    const waiting = new Map(), on = new Map(), inner = new Map();
    let n = 0, ran = false;
    const post = (m, transfer) => port.postMessage(m, transfer || []);
    const call = (name, ...args) => new Promise((res, rej) => { if (waiting.size >= 64) return rej(new Error('busy')); const id = ++n; waiting.set(id, [res, rej]); post({ id, call: name, args }); });
    const later = (err) => setTimeout(() => { throw err; });
    const fire = (map, event, data) => { for (const f of map.get(event) || []) try { f(data); } catch (err) { later(err); } };
    port.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (Number.isSafeInteger(d.ping)) return post({ pong: d.ping });
      if (Array.isArray(d.run) && !ran) {
        ran = true;
        try { for (const src of d.run) (0, eval)(String(src)); post({ ran: true }); } catch (err) { post({ error: String(err?.message || err) }); }
        return;
      }
      if (Number.isSafeInteger(d.id) && waiting.has(d.id)) {
        const [res, rej] = waiting.get(d.id);
        waiting.delete(d.id);
        return d.ok ? res(d.value) : rej(new Error(String(d.error)));
      }
      if (typeof d.event === 'string') { fire(inner, d.event, d.data); fire(on, d.event, d.data); }
    });
    port.start?.();
    const opt = (v) => (v === undefined ? [] : [v]);
    // Transforms: the mod's function runs when Glaze asks, and what it gives goes back through the worker's checks.
    const fns = { decorate: null, items: null }, commands = new Map();
    const answer = (fn, arg, as) => { if (fn) Promise.resolve().then(() => fn(arg)).then((r) => (r === undefined ? null : call(as, r))).catch(later); };
    inner.set('cards', [(d) => answer(fns.decorate, d?.courses, 'cards.set')]);
    inner.set('nav.items', [(d) => answer(fns.items && ((items) => fns.items(items) ?? null), d?.items, 'nav.set')]);
    inner.set('palette.run', [(d) => { const f = commands.get(d?.id); if (f) try { f(); } catch (err) { later(err); } }]);
    // A Worker's canvases: glaze.ui.canvas(slot) gives an OffscreenCanvas the size of the slot's canvas on the page (in device
    // pixels, 'canvas.size' { slot, w, h, dpr } when that changes). What it holds goes to the page as a picture after each
    // animation frame and on commit(slot); a canvas can't be handed across processes without taking the page down with it.
    // Animation frames come from Glaze here, and stop while the page or the slot is hidden or motion is off ('canvas.pause').
    // Only a canvas drawn on since its last picture is sent (its context marks it; commit(slot) forces one), so a mod with
    // several canvases and one animation loop doesn't send a picture of every canvas on every frame.
    const canvases = new Map(), sizes = new Map();
    let paused = false;
    const ship = (slot) => {
      const k = canvases.get(slot);
      if (!k || paused || !k.dirty) return;
      if (k.busy) { k.again = true; return; }
      k.busy = true;
      k.dirty = false;
      createImageBitmap(k.c).then((bm) => post({ frame: slot, bm }, [bm]), () => { k.dirty = true; }).finally(() => { k.busy = false; if (k.again) { k.again = false; ship(slot); } });
    };
    const fit = (slot) => { const k = canvases.get(slot), s = sizes.get(slot); if (k && s && (k.c.width !== s.w || k.c.height !== s.h)) { k.c.width = s.w; k.c.height = s.h; k.dirty = true; } };
    // The context the mod draws with, passing every call and assignment through and noting that the canvas changed.
    const watch = (k, ctx) => {
      if (!ctx || typeof ctx !== 'object') return ctx;
      // getContext returns the same context each time; drawing code may use that identity.
      if (k.contexts.has(ctx)) return k.contexts.get(ctx);
      const fns = new Map();
      const proxy = new Proxy(ctx, {
        get: (t, key) => {
          const v = Reflect.get(t, key, t);
          if (typeof v !== 'function') return v;
          if (!fns.has(v)) fns.set(v, (...args) => { k.dirty = true; return v.apply(t, args); });
          return fns.get(v);
        },
        set: (t, key, v) => { k.dirty = true; return Reflect.set(t, key, v, t); },
      });
      k.contexts.set(ctx, proxy);
      return proxy;
    };
    if (typeof document === 'undefined') {
      let next = 1, timer = 0;
      const queue = new Map(), held = new Map();
      const tick = () => {
        timer = 0;
        const now = performance.now(), due = [...queue.values()];
        queue.clear();
        for (const f of due) try { f(now); } catch (err) { later(err); }
        for (const slot of canvases.keys()) ship(slot);
      };
      globalThis.requestAnimationFrame = (f) => {
        if (typeof f !== 'function') throw new TypeError('requestAnimationFrame needs a function');
        const id = next++;
        (paused ? held : queue).set(id, f);
        if (!paused && !timer) timer = setTimeout(tick, 16);
        return id;
      };
      globalThis.cancelAnimationFrame = (id) => { queue.delete(id); held.delete(id); };
      inner.set('canvas.pause', [(d) => {
        paused = d?.paused === true;
        if (paused) { for (const [id, f] of queue) held.set(id, f); queue.clear(); clearTimeout(timer); timer = 0; return; }
        for (const [id, f] of held) queue.set(id, f);
        held.clear();
        if (queue.size && !timer) timer = setTimeout(tick, 16);
        // Pictures sent while paused were dropped, so everything is shown afresh.
        for (const [slot, k] of canvases) { k.dirty = true; ship(slot); }
      }]);
      inner.set('canvas.size', [(d) => { if (typeof d?.slot === 'string' && Number.isInteger(d.w) && Number.isInteger(d.h)) { sizes.set(d.slot, d); fit(d.slot); ship(d.slot); } }]);
    }
    const ui = Object.freeze({
      render: (slot, tree) => call('ui.render', slot, tree === undefined ? null : tree),
      canvas: (slot) => {
        if (typeof OffscreenCanvas !== 'function' || typeof document !== 'undefined') return Promise.reject(new Error('canvas is for Workers'));
        slot = String(slot);
        if (!canvases.has(slot)) {
          const s = sizes.get(slot), k = { c: new OffscreenCanvas(s?.w || 300, s?.h || 150), busy: false, again: false, dirty: false, contexts: new WeakMap() };
          const getContext = k.c.getContext;
          k.c.getContext = (...args) => { k.dirty = true; return watch(k, getContext.apply(k.c, args)); };
          canvases.set(slot, k);
        }
        return Promise.resolve(canvases.get(slot).c);
      },
      commit: (slot) => { const k = canvases.get(String(slot)); if (k) { k.dirty = true; ship(String(slot)); } },
    });
    const glaze = Object.freeze({
      call,
      on: (event, f) => { if (typeof f === 'function') on.set(event, [...(on.get(event) || []), f]); },
      off: (event, f) => on.set(event, (on.get(event) || []).filter((g) => g !== f)),
      storage: Object.freeze({ get: (key) => call('storage.get', ...opt(key)), set: (key, value) => call('storage.set', key, value), remove: (key) => call('storage.remove', key) }),
      theme: () => call('theme'),
      courses: () => call('courses'),
      todo: () => call('todo'),
      schedule: (from, to) => call('schedule', from, to),
      grades: (courseId) => call('grades', ...opt(courseId)),
      fetch: (url, init) => call('fetch', String(url), init ?? {}),
      settings: () => call('settings'),
      ui,
      cards: Object.freeze({ decorate: (fn) => { fns.decorate = typeof fn === 'function' ? fn : null; } }),
      // items(fn): the older transform. model, add, update, remove, layout and go: nav.read, nav.items, nav.layout, and a
      // replacement's go (with its switch on, right after a click in its nav slot).
      nav: Object.freeze({ items: (fn) => { fns.items = typeof fn === 'function' ? fn : null; }, model: () => call('nav.model'), add: (item) => call('nav.add', item),
        update: (id, patch) => call('nav.update', id, patch), remove: (id) => call('nav.remove', id), layout: (patch) => call('nav.layout', patch === undefined ? null : patch), go: (id) => call('nav.go', id) }),
      // [{ id, title, hint?, run }]: run stays here and is called when the student picks the command in the palette.
      palette: Object.freeze({ commands: (list) => {
        commands.clear();
        const sent = Array.isArray(list) ? list.map((c) => { if (typeof c?.run === 'function') commands.set(c.id, c.run); const { run, ...rest } = c || {}; return rest; }) : list;
        return call('palette.set', sent);
      } }),
      rules: Object.freeze({ set: (list) => call('rules.set', list) }),
      effects: Object.freeze({ play: (kind, opts) => call('effects.play', kind, opts ?? {}) }),
      look: Object.freeze({ override: (parts) => call('look.override', parts === undefined ? null : parts) }),
      // To this mod's own Worker and frames on this page ('broadcast' events), never another mod's.
      broadcast: (data) => call('broadcast', data === undefined ? null : data),
    });
    Object.defineProperty(globalThis, 'glaze', { value: glaze, enumerable: false });
    return glaze;
  }

  // Workers share the host's origin: deny cross-mod channels and fresh realms before any mod code runs.
  function isolateWorker() {
    const remove = (o, k) => {
      try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch {}
      if (o[k] !== undefined) throw new Error('isolation');
    };
    for (const k of [...Object.getOwnPropertyNames(globalThis).filter((k) => /^(webkit)?rtc/i.test(k)), 'BroadcastChannel', 'Worker', 'SharedWorker', 'caches', 'indexedDB']) remove(globalThis, k);
    for (let o = navigator; o; o = Object.getPrototypeOf(o)) for (const k of ['locks', 'storage', 'serviceWorker']) if (Object.hasOwn(o, k)) remove(o, k);
  }

  const stop = (id, why) => {
    const m = mods.get(id);
    if (!m) return;
    mods.delete(id);
    m.worker?.terminate();
    for (const f of m.frames.values()) { f.port.close(); frameOf.delete(f.el.id); f.el.remove(); }
    if (why) send({ stopped: id, why });
  };
  const channel = (m, via) => via === 'worker' ? m?.worker : m?.frames.get(via)?.port;
  const fromMod = (id, via) => (e) => {
    const d = e.data, m = mods.get(id);
    if (!isObj(d)) return;
    const bitmap = d.bm instanceof ImageBitmap;
    if (!m) { if (bitmap) d.bm.close(); return; }
    const now = performance.now();
    // A picture of one of the Worker's canvases, for its slot on the page (only pixels: an ImageBitmap carries nothing else).
    // Pictures have a budget per canvas, so several animated canvases don't use up the mod's message rate.
    if (bitmap) {
      const slot = typeof d.frame === 'string' ? d.frame : '', size = m.sizes.get(slot);
      if (via !== 'worker' || !size) {
        d.bm.close();
        if (now - m.since >= 1000) { m.since = now; m.messages = 0; }
        return ++m.messages > RATE ? stop(id, 'error') : undefined;
      }
      const w = m.budget.get(slot) || { since: now, n: 0 };
      if (now - w.since >= 1000) { w.since = now; w.n = 0; }
      m.budget.set(slot, w);
      if (++w.n > RATE) { d.bm.close(); return stop(id, 'error'); }
      if (m.paused || d.bm.width !== size.w || d.bm.height !== size.h || now - (m.painted.get(slot) ?? -Infinity) < 1000 / 60) return d.bm.close();
      m.painted.set(slot, now);
      return up.postMessage({ frame: slot, mod: id, bm: d.bm }, [d.bm]);
    }
    if (now - m.since >= 1000) { m.since = now; m.messages = 0; }
    if (++m.messages > RATE) return stop(id, 'error');
    if (Number.isSafeInteger(d.pong)) return send({ pong: d.pong, mod: id });
    if (Number.isSafeInteger(d.id) && typeof d.call === 'string' && d.call.length <= 64 && Array.isArray(d.args)) {
      const reply = (error) => channel(m, via)?.postMessage({ id: d.id, ok: false, error });
      let json;
      try { json = JSON.stringify(d.args); } catch { return reply('args'); }
      if (new TextEncoder().encode(json).length > LIMIT) return reply('size');
      const key = `${via}:${d.id}`;
      if (m.pending.size >= INFLIGHT || m.pending.has(key)) return reply('busy');
      m.pending.add(key);
      return send({ mod: id, via, id: d.id, call: d.call, args: JSON.parse(json) });
    }
    if (d.ran === true) return send({ ran: id, via });
    if (typeof d.error === 'string') stop(id, 'error');
  };

  // A frame UI: the mod's HTML file, parsed inert, its scripts taken out (they run through boot.js, in order) and its
  // stylesheets put inline, both only from the mod's own files; boot.js first in the head.
  const frame = (mod, m, f) => {
    if (typeof mod.text?.[f.file] !== 'string') return;
    const doc = new DOMParser().parseFromString(mod.text[f.file], 'text/html');
    // A reference to one of the mod's own files of that kind (relative to the HTML file), or null.
    const file = (ref, ext) => {
      let p;
      try { const u = new URL(ref || '', `https://mod.invalid/${f.file}`); p = u.origin === 'https://mod.invalid' && !u.search ? decodeURIComponent(u.pathname.slice(1)) : ''; } catch { return null; }
      return ext.test(p) && typeof mod.text[p] === 'string' ? mod.text[p] : null;
    };
    const code = [];
    for (const s of doc.querySelectorAll('script')) { const c = file(s.getAttribute('src'), /\.js$/i); if (c !== null) code.push(c); s.remove(); }
    for (const l of doc.querySelectorAll('link')) {
      const c = /\bstylesheet\b/i.test(l.rel) ? file(l.getAttribute('href'), /\.css$/i) : null;
      if (c !== null) { const st = doc.createElement('style'); st.textContent = c; l.replaceWith(st); } else l.remove();
    }
    const boot = doc.createElement('script');
    boot.src = BOOT;
    doc.head.prepend(boot);
    const el = document.createElement('iframe');
    el.id = `f${++frames}`;
    el.setAttribute('sandbox', 'allow-scripts');
    // A host that holds a frame UI is that slot's, on the page: the frame fills it.
    el.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;display:block;background:transparent';
    el.srcdoc = `<!doctype html>${doc.documentElement.outerHTML}`;
    const via = `frame:${f.slot}`;
    const ch = new MessageChannel();
    ch.port1.onmessage = fromMod(mod.id, via);
    let loads = 0;
    el.addEventListener('load', () => {
      // A second load is the mod navigating its frame, which the CSP turns into an error page: it's gone.
      if (++loads > 1) return stop(mod.id, 'navigated');
      el.contentWindow.postMessage({ type: 'glaze:boot' }, '*', [ch.port2]);
      ch.port1.postMessage({ client: `(${glazeClient})` });
      ch.port1.postMessage({ run: code });
      entry.booted = true;
    });
    frameOf.set(el.id, mod.id);
    // Events wait until the frame has its client: boot.js takes the port's first message as the client's source.
    const entry = { el, port: ch.port1, booted: false };
    m.frames.set(via, entry);
    (document.body || document.documentElement).append(el);
  };
  const start = (mod) => {
    if (!isObj(mod) || typeof mod.id !== 'string' || mods.has(mod.id)) return;
    const m = { worker: null, frames: new Map(), pending: new Set(), since: performance.now(), messages: 0, paused: true, sizes: new Map(), painted: new Map(), budget: new Map() };
    mods.set(mod.id, m);
    if (typeof mod.worker === 'string') {
      workerUrl ||= URL.createObjectURL(new Blob([`(${isolateWorker})();(${glazeClient})(self);`], { type: 'text/javascript' }));
      m.worker = new Worker(workerUrl);
      m.worker.onmessage = fromMod(mod.id, 'worker');
      m.worker.onerror = () => stop(mod.id, 'error');
      m.worker.postMessage({ run: [mod.worker] });
    }
    for (const f of Array.isArray(mod.frames) ? mod.frames : []) if (isObj(f) && typeof f.slot === 'string' && typeof f.file === 'string') frame(mod, m, f);
  };

  // A frame UI holding this thread for a second or more, named once its task ends (frame UIs share the host's thread, so
  // only a task that ends can be told apart; one that never ends is the content script's watchdog's to find).
  try {
    new PerformanceObserver((list) => {
      for (const t of list.getEntries()) for (const a of t.attribution || []) { const id = frameOf.get(a.containerId); if (id && t.duration >= 1000) send({ slow: id, ms: Math.round(t.duration) }); }
    }).observe({ type: 'longtask' });
  } catch { /* no long task timing here */ }

  const fromUp = (e) => {
    const d = e.data;
    if (!isObj(d)) return;
    if (Number.isSafeInteger(d.ping)) {
      send({ pong: d.ping });
      for (const m of mods.values()) m.worker?.postMessage({ ping: d.ping });
      return;
    }
    if (d.op === 'start' && Array.isArray(d.mods)) {
      // Chrome resolves the host to its static id; only runtime.getURL knows the web-accessible bootstrap's dynamic id.
      if (typeof d.boot === 'string') {
        try { const u = new URL(d.boot); if (d.boot.length > 256 || u.protocol !== 'chrome-extension:' || u.pathname !== '/mods/boot.js' || u.search || u.hash) return; BOOT = u.href; } catch { return; }
      }
      return d.mods.forEach(start);
    }
    if (typeof d.kill === 'string') return stop(d.kill);
    if (typeof d.event === 'string') {
      // except: the one that sent a broadcast, which doesn't hear its own.
      for (const [id, m] of mods) if (d.mod === undefined || d.mod === id) {
        if (d.event === 'canvas.pause') m.paused = d.data?.paused === true;
        if (d.event === 'canvas.size' && typeof d.data?.slot === 'string' && [d.data.w, d.data.h].every((n) => Number.isInteger(n) && n > 0 && n <= 4096)) m.sizes.set(d.data.slot, d.data);
        for (const [via, p] of [['worker', m.worker], ...[...m.frames].filter(([, f]) => f.booted).map(([v, f]) => [v, f.port])]) if (p && via !== d.except) p.postMessage({ event: d.event, data: d.data });
      }
      return;
    }
    if (typeof d.mod === 'string' && Number.isSafeInteger(d.id)) {
      const m = mods.get(d.mod);
      if (!m?.pending.delete(`${d.via}:${d.id}`)) return;
      const to = channel(m, d.via);
      to?.postMessage(d.ok === true ? { id: d.id, ok: true, value: d.value } : { id: d.id, ok: false, error: String(d.error) });
    }
  };
  // Whether this page really is the sandbox: an opaque origin with no extension APIs, where the sandbox CSP lets mod code
  // run. A browser without manifest sandboxes would load it as an ordinary extension page; then nothing starts here.
  const sandboxed = () => {
    if (self.origin !== 'null' || globalThis.chrome?.runtime?.id) return false;
    try { return (0, eval)('1') === 1; } catch { return false; }
  };
  // The one handshake: from the parent (the LMS tab's top window, where both Glaze's content script and the page's own
  // scripts post from, so the nonce is what tells them apart), with this page's nonce and one port. Anything else is ignored.
  // The first answer says whether mods can run here.
  const hello = (e) => {
    if (e.source !== parent || want.length < 32 || !isObj(e.data) || e.data.type !== 'glaze:host' || e.data.nonce !== want || e.ports?.length !== 1) return;
    removeEventListener('message', hello);
    const ok = sandboxed();
    e.ports[0].postMessage({ ready: ok });
    if (!ok) return e.ports[0].close();
    up = e.ports[0];
    up.onmessage = fromUp;
  };
  addEventListener('message', hello);
})();
