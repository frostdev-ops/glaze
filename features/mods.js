// Code mods on the page (Chrome, whose manifest has the sandbox). content.js loads this only when
// the worker names an installed mod that is on, in the top frame of a page Glaze is on. It frames mods/host.html inside a
// closed shadow root, hands it one port with a one-use nonce, starts the mods' Workers there and passes their calls on to
// the worker ('glaze:mod'), which checks every one (lib/modbroker.js). A frame UI (a slot with an HTML file of its own) gets
// a host of its own in its slot, the same way, while the slot is on the page. It owns the watchdog, with heartbeats while
// the page is shown: a Worker that stops answering is ended alone; a host that stops answering froze on a frame UI (they
// share a thread), so it is removed and the other mods start again without that mod. A mod stopped so is kept for the
// editor (storage.local modStops). Never on a quiz or a tool's page; everything stops when Glaze is reloaded or turned off.
//
// What mods show and change here is only what the worker's answer to a call carries (cleaned there, lib/modapi.js and
// lib/lookparts.js): a slot's component tree (features/modui.js draws it), a card's decoration, palette commands, Look
// rules, a nav layout or Look parts laid over the student's Look while the mod runs (GZ_CTX.parts reads parts()), and
// effects. Slots: tiles on the widget boards (features/widgets.js declare), rail widgets on the nav (features/nav.js),
// and, where the student turned the replacement on (modReplace, the worker's list says which), the nav and the background.
// Where two mods claim one, the student's order (modOrder) decides, and transforms are taken in that order.
var GZ_MODS = globalThis.GZ_MODS || (() => {
  const BEAT = 2000, HANG = 5000, SLOW = 2000, RESTARTS = 3, INFLIGHT = 64, MIB = 1 << 20;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const alive = () => !!globalThis.chrome?.runtime?.id;
  const ctx = () => globalThis.GZ_CTX;
  // lib/lookx.js quiet's routes with features/rules.js's wider ones (whole quiz and tool routes), and a tool's frame.
  const QUIET = /\/(quizzes|external_tools|assessment|attempt|lti)(\/|$)|\/mod\/(quiz|lti)(\/|$)/;
  const quiet = () => QUIET.test(location.pathname) || !!document.getElementById('tool_content');

  // The watchdog's call at `now` (ms). A host silent past HANG, after it had answered, froze with the frame UIs it runs:
  // it goes, and so do those mods (the ones in `frames`; one that never ends can't be told apart from the others on the
  // same thread). A host that never answered goes alone. Otherwise each Worker silent past HANG is ended.
  // seen: [[mod, when its Worker last answered]].
  const verdict = ({ now, host, ok, seen, frames }) => (now - host > HANG ? { host: true, stop: ok ? frames : [] }
    : { host: false, kill: seen.filter(([, t]) => now - t > HANG).map(([id]) => id) });

  let list = [];
  let run = null; // the host now: { mount, port, host, ok, seen, waiting, timer, loads, slots: Map(slot key → its frame UI's host) }
  const gone = new Map(); // mod → why, stopped on this page
  let restarts = 0, beats = 0, runtime = null, checking = false;
  const stats = { began: 0, ready: {}, stopped: {}, hosts: 0, applied: {} };
  const running = () => list.filter((m) => !gone.has(m.id));

  // ---- the hosts ----------------------------------------------------------------------------------------------------------
  // One host frame in a closed shadow root: hidden (the Workers' host), or filling a slot (a frame UI's).
  const frameHost = (title) => {
    const nonce = crypto.randomUUID() + crypto.randomUUID();
    const mount = document.createElement('div');
    const root = mount.attachShadow({ mode: 'closed' });
    const frame = document.createElement('iframe');
    if (title === undefined) {
      frame.setAttribute('aria-hidden', 'true');
      frame.tabIndex = -1;
      frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
    } else {
      frame.title = title;
      mount.style.cssText = 'display:block;width:100%;height:100%';
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal';
    }
    root.append(frame);
    const ch = new MessageChannel();
    return { nonce, mount, frame, port: ch.port1, port2: ch.port2 };
  };
  const label = (id, why) => {
    gone.set(id, why);
    stats.stopped[id] = why;
    forget(id);
    if (alive()) chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'stopped', mod: id, why }).catch(() => {});
  };
  const closeSlot = (sh) => { sh.closed = true; sh.port.close(); sh.mount.remove(); };
  // grace: the host stays a moment for a 'stop' event to arrive; it no longer counts as running.
  const teardown = (grace) => {
    if (!run) return;
    const { timer, port, mount, slots } = run;
    run = null;
    clearTimeout(timer);
    for (const sh of slots.values()) closeSlot(sh);
    const end = () => { port.close(); mount.remove(); };
    if (grace) setTimeout(end, 100); else end();
    resetAll();
    place(); // with no host, nothing of the mods' stays on the page
  };
  // Whether code mods run in this browser is found here, not assumed: the host says whether it really is the sandbox. The
  // answer is kept for the editor (storage.local modRuntime), which shows code mods as needing Chrome where it is no. A
  // host that never answers, however often it is started, counts as no too.
  const runs = (r, yes) => {
    if (runtime !== yes && alive()) chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'runtime', ok: yes }).catch(() => {});
    runtime = yes;
    if (!yes) { restarts = RESTARTS; lost(r, []); } else place();
  };
  // The host is gone or must go: the mods named stop for good on this page, and the rest start again in a new host.
  const lost = (r, stop) => {
    if (r !== run) return;
    teardown();
    for (const id of stop) label(id, 'hung');
    if (restarts++ < RESTARTS) begin();
    else if (runtime === null && !r.ok) runs(r, false);
  };
  // One mod stops for good on this page: its Worker, its frame UIs' hosts and whatever it showed.
  const drop = (r, id, why) => {
    if (gone.has(id)) return;
    r.port.postMessage({ kill: id });
    r.seen.delete(id);
    for (const [k, sh] of r.slots) if (sh.mod === id) { closeSlot(sh); r.slots.delete(k); }
    label(id, why);
    place();
  };

  // A call from a mod: to the worker, and its answer back to where it came from. An answer the worker gave is applied here
  // first when the call shows or does something on the page.
  const forward = (r, d, port, sh) => {
    const current = () => r === run && !sh?.closed;
    const reply = (x) => { if (current()) port.postMessage({ mod: d.mod, via: d.via, id: d.id, ...(x?.ok === true ? { ok: true, value: x.value } : { ok: false, error: typeof x?.error === 'string' ? x.error : 'failed' }) }); };
    const n = r.waiting.get(d.mod) || 0;
    if (!list.some((m) => m.id === d.mod) || gone.has(d.mod) || n >= INFLIGHT) return reply({ error: 'busy' });
    let size;
    try { size = JSON.stringify(d.args).length; } catch { return reply({ error: 'args' }); }
    if (size > 2 * MIB) return reply({ error: 'size' }); // the worker's own limit is lower; this only spares the message
    if (!alive()) return stop();
    r.waiting.set(d.mod, n + 1);
    chrome.runtime.sendMessage({ type: 'glaze:mod', mod: d.mod, via: d.via, call: d.call, args: d.args })
      .then((x) => { if (x?.ok === true && current() && !gone.has(d.mod)) apply(d.mod, d.via, d.call, x.value); reply(x); }, () => reply({ error: 'failed' }))
      .finally(() => r.waiting.set(d.mod, r.waiting.get(d.mod) - 1));
  };
  const heard = (r, d) => {
    if (r !== run || !isObj(d)) return;
    const now = performance.now();
    r.host = now;
    r.ok = true;
    if (typeof d.ready === 'boolean') return runs(r, d.ready);
    if (Number.isSafeInteger(d.pong)) { if (typeof d.mod === 'string' && r.seen.has(d.mod)) r.seen.set(d.mod, now); return; }
    if (typeof d.ran === 'string') { stats.ready[d.ran] ??= Math.round(now - stats.began); return greet(d.ran); }
    if (typeof d.frame === 'string' && typeof d.mod === 'string') return show(d.mod, d.frame, d.bm);
    if (typeof d.stopped === 'string' && list.some((m) => m.id === d.stopped)) { r.seen.delete(d.stopped); label(d.stopped, d.why === 'navigated' ? 'navigated' : 'error'); return place(); }
    if (typeof d.mod === 'string' && typeof d.call === 'string') forward(r, d, r.port);
  };
  // A frame UI's own host, in its slot's element.
  const heardSlot = (r, sh, d) => {
    if (r !== run || sh.closed || !isObj(d)) return;
    sh.host = performance.now();
    if (typeof d.ready === 'boolean') { sh.ok = d.ready; if (!d.ready) unslot(r, sh); return; }
    if (d.ran === sh.mod) { stats.ready[sh.mod] ??= Math.round(performance.now() - stats.began); return greet(sh.mod, sh.port); }
    if (typeof d.slow === 'string' && d.slow === sh.mod && d.ms >= SLOW) return drop(r, sh.mod, 'hung');
    if (typeof d.stopped === 'string' && d.stopped === sh.mod) return drop(r, sh.mod, d.why === 'navigated' ? 'navigated' : 'error');
    if (d.mod === sh.mod && typeof d.call === 'string') forward(r, d, sh.port, sh);
  };
  const unslot = (r, sh) => { closeSlot(sh); for (const [k, x] of r.slots) if (x === sh) r.slots.delete(k); };
  // Moving an element that holds a frame loads it again (a tile carried from a board to float): a new host then, a few times
  // a slot; a frame UI whose host keeps loading again is not started again on this page.
  const SLOT_LOADS = 6, reloads = new Map();
  const startSlot = (r, mod, slot, el) => {
    const k = `${mod.id}|${slot.key}`;
    const h = frameHost(slot.name);
    const sh = { ...h, mod: mod.id, key: slot.key, el, host: performance.now(), ok: false, posted: false, closed: false };
    sh.port.onmessage = (e) => heardSlot(r, sh, e.data);
    h.frame.addEventListener('load', () => {
      if (sh.closed || r !== run) return;
      if (!sh.posted) { sh.posted = true; h.frame.contentWindow.postMessage({ type: 'glaze:host', nonce: h.nonce }, '*', [h.port2]); return; }
      unslot(r, sh);
      const n = (reloads.get(k) || 0) + 1;
      reloads.set(k, n);
      if (n < SLOT_LOADS && el.isConnected) startSlot(r, mod, slot, el);
    });
    h.frame.src = `${chrome.runtime.getURL('mods/host.html')}#${h.nonce}`;
    el.append(h.mount);
    sh.port.postMessage({ op: 'start', mods: [{ id: mod.id, name: mod.name, worker: null, frames: [{ slot: slot.key, file: slot.file }], text: mod.text }], boot: chrome.runtime.getURL('mods/boot.js') });
    r.slots.set(k, sh);
    return sh;
  };

  const beat = (r) => {
    clearTimeout(r.timer);
    if (r !== run) return;
    if (!alive()) return stop();
    if (!r.mount.isConnected) return lost(r, []); // the page took it out
    if (document.hidden) { r.timer = setTimeout(() => beat(r), BEAT); return; } // still notice extension reload
    const now = performance.now();
    for (const sh of r.slots.values()) if (!sh.el.isConnected || !sh.mount.isConnected) unslot(r, sh);
    const silent = [...r.slots.values()].filter((sh) => sh.posted && now - sh.host > HANG);
    const v = verdict({ now, host: r.host, ok: r.ok, seen: [...r.seen], frames: [...new Set(silent.filter((sh) => sh.ok).map((sh) => sh.mod))].filter((id) => !gone.has(id) && list.some((m) => m.id === id)) });
    if (v.host) return lost(r, v.stop);
    for (const id of v.kill) { r.port.postMessage({ kill: id }); r.seen.delete(id); label(id, 'hung'); }
    // A frame UI's host gone quiet while the Workers' host answers: that mod froze it.
    for (const sh of silent) if (sh.ok) drop(r, sh.mod, 'hung'); else unslot(r, sh);
    r.port.postMessage({ ping: ++beats });
    for (const sh of r.slots.values()) sh.port.postMessage({ ping: beats });
    if (v.kill.length) place();
    r.timer = setTimeout(() => beat(r), BEAT);
  };

  const begin = () => {
    const mods = running();
    if (run || checking || !mods.length || quiet() || !alive() || runtime === false || restarts > RESTARTS) return;
    const h = frameHost();
    const now = performance.now();
    const r = run = { mount: h.mount, port: h.port, host: now, ok: false, seen: new Map(mods.filter((m) => m.worker !== null).map((m) => [m.id, now])), waiting: new Map(), timer: 0, loads: 0, slots: new Map() };
    h.port.onmessage = (e) => heard(r, e.data);
    // One post, on the host's first load, to the frame only this script can reach. A later load means something navigated
    // the host away: never post again; start afresh in a new one.
    h.frame.addEventListener('load', () => {
      if (++r.loads === 1) h.frame.contentWindow.postMessage({ type: 'glaze:host', nonce: h.nonce }, '*', [h.port2]);
      else lost(r, []);
    });
    h.frame.src = `${chrome.runtime.getURL('mods/host.html')}#${h.nonce}`;
    document.documentElement.append(h.mount);
    // The Workers only: a frame UI starts in its slot's own host (startSlot).
    h.port.postMessage({ op: 'start', mods: mods.filter((m) => m.worker !== null).map((m) => ({ id: m.id, name: m.name, worker: m.worker, frames: [], text: {} })), boot: chrome.runtime.getURL('mods/boot.js') });
    stats.began = now;
    stats.hosts++;
    r.timer = setTimeout(() => beat(r), BEAT);
  };
  // Stop every mod on this page (they get 'stop' first when there is time to).
  const stop = (grace = true) => {
    const live = !!run && alive();
    if (live) run.port.postMessage({ event: 'stop' });
    teardown(live && grace);
  };

  // ---- events to mods -------------------------------------------------------------------------------------------------------
  // To one mod (its Worker and its frame UIs), or to every mod that may hear it. except: the frame or Worker that sent it.
  const emit = (id, event, data, except) => {
    if (!run || gone.has(id)) return;
    run.port.postMessage({ event, mod: id, data, ...(except && { except }) });
    for (const sh of run.slots.values()) if (sh.mod === id) sh.port.postMessage({ event, mod: id, data, ...(except && { except }) });
  };
  const emitAll = (event, data, may = () => true) => { for (const m of running()) if (may(m)) emit(m.id, event, data); };
  // The data events, each only to the mods granted what it is about; they carry no data (the mod asks, and is checked).
  const NEEDS = { courses: 'courses', todo: 'todo', grade: 'grades', complete: 'todo', submit: 'todo' };
  const tell = (event, data = {}) => emitAll(event, data, (m) => Array.isArray(m.events) && m.events.includes(NEEDS[event]));
  const site = () => ctx()?.site || '';
  const pageNow = () => {
    const p = location.pathname;
    const courseId = p.match(/\/ultra\/courses\/(_\d+_\d+)/)?.[1] || p.match(/^\/courses\/(\d+)/)?.[1] || (/^\/course\/view\.php$/.test(p) ? new URLSearchParams(location.search).get('id') : null) || null;
    const kind = courseId ? 'course' : /^\/ultra\/course\/?$|^\/courses\/?$|^\/my\/courses\.php$/.test(p) ? 'courses' : /^\/(ultra\/institution-page\/?|my\/?|)$/.test(p) ? 'dashboard'
      : /grades?/.test(p) ? 'grades' : /calendar/.test(p) ? 'calendar' : 'other';
    return { site: site(), kind, courseId };
  };
  // Just started: where it is, and what it may transform now.
  const greet = (id, port) => {
    const m = list.find((x) => x.id === id);
    if (!m || !ctx()) return;
    const send = (event, data) => port ? port.postMessage({ event, mod: id, data }) : emit(id, event, data);
    // A Worker started again knows nothing yet: sizes and the pause are told afresh.
    if (!port) {
      for (const [k, x] of mounts) if (k.startsWith(`${id}|`)) x.size = '';
      pausedOf.delete(id);
    }
    send('page', pageNow());
    send('visible', !document.hidden);
    if (!port && m.events?.includes('courses')) send('cards', { courses: cardList() });
    send('nav.items', { items: navItems() });
    if (!port) sizeAll();
  };

  // ---- slots ---------------------------------------------------------------------------------------------------------------
  const trees = new Map(); // `${mod}|${slot}` → the last tree its Worker sent
  const mounts = new Map(); // `${mod}|${slot}` → { el, root, canvas, g, size, ro, frame }
  const overlays = new Map(); // mod → { cards, nav, rules, look, cmds }
  const assets = new Map(); // `${mod}|${path}` → Promise<ImageBitmap>
  const slotOf = (id, key) => list.find((m) => m.id === id)?.slots?.find((s) => s.key === key);
  const ui = () => (globalThis.GZ_MODUI ? Promise.resolve(globalThis.GZ_MODUI) : ctx()?.need('features/modui.js', () => globalThis.GZ_MODUI).then(() => globalThis.GZ_MODUI));
  const motionOff = () => document.documentElement.getAttribute('data-gz-motion') === 'off';
  // A slot's element `el` takes the mod's UI: its frame UI (a host of its own, once the Workers' host has said mods run
  // here), or its tree, drawn in a closed root. → stop().
  const attach = (id, key, el) => {
    const k = `${id}|${key}`;
    detach(k);
    const slot = slotOf(id, key);
    if (!slot) return () => {};
    const m = { el, root: null, canvas: null, g: null, size: '', ro: null, frame: !!slot.file };
    mounts.set(k, m);
    if (m.frame) frameIn(id, key);
    else { m.root = el.attachShadow({ mode: 'closed' }); draw(id, key); }
    return () => detach(k, m);
  };
  const frameIn = (id, key) => {
    const m = mounts.get(`${id}|${key}`), mod = list.find((x) => x.id === id), slot = slotOf(id, key);
    if (!m?.frame || !run || runtime !== true || gone.has(id) || run.slots.has(`${id}|${key}`) || !mod || !slot || (reloads.get(`${id}|${key}`) || 0) >= SLOT_LOADS) return;
    startSlot(run, mod, slot, m.el);
  };
  const detach = (k, only) => {
    const m = mounts.get(k);
    if (!m || (only && m !== only)) return;
    mounts.delete(k);
    m.ro?.disconnect();
    const sh = run?.slots.get(k);
    if (sh) unslot(run, sh);
    if (m.root) m.root.replaceChildren();
    paused();
  };
  const draw = (id, key) => {
    const k = `${id}|${key}`, m = mounts.get(k);
    if (!m?.root) return;
    ui()?.then((U) => {
      if (mounts.get(k) !== m) return;
      const got = U.render(m.root, trees.get(k) ?? null, { send: (kind, cid, value) => emit(id, 'ui', { slot: key, id: cid, kind, ...(value !== undefined && { value }) }), asset: (p) => asset(id, p), canvas: m.canvas });
      if (got.canvas !== m.canvas) {
        m.ro?.disconnect();
        m.canvas = got.canvas; m.g = null; m.size = ''; m.ro = null;
        if (m.canvas) {
          if (key === 'background') m.canvas.style.setProperty('height', '100vh');
          m.g = m.canvas.getContext('bitmaprenderer');
          m.ro = new ResizeObserver(() => sizeOne(id, key));
          m.ro.observe(m.canvas);
          sizeOne(id, key);
        }
      }
    }, () => {});
  };
  // The canvas's size on the page in device pixels (at most 2 per CSS pixel, 4096 a side), told to the Worker as it changes.
  const sizeOne = (id, key) => {
    const m = mounts.get(`${id}|${key}`);
    if (!m?.canvas) return;
    const r = m.canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.min(4096, Math.round(r.width * dpr)), h = Math.min(4096, Math.round(r.height * dpr));
    const size = `${w}x${h}`;
    if (size !== m.size && w && h) { m.size = size; emit(id, 'canvas.size', { slot: key, w, h, dpr }); }
    paused();
  };
  const sizeAll = () => { for (const k of mounts.keys()) { const [id, key] = k.split('|'); sizeOne(id, key); } };
  // A Worker's animation frames stop while nothing of its canvases shows: the page hidden, motion off, or none drawn.
  const pausedOf = new Map();
  const paused = () => {
    for (const m of running()) {
      const showing = [...mounts].some(([k, x]) => {
        if (!k.startsWith(`${m.id}|`) || !x.canvas?.isConnected || !x.size) return false;
        const r = x.canvas.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      const p = document.hidden || motionOff() || !showing;
      if (pausedOf.get(m.id) !== p) { pausedOf.set(m.id, p); emit(m.id, 'canvas.pause', { paused: p }); }
    }
  };
  // A picture from the Worker for one of its canvases; one with no canvas on the page now is let go.
  const show = (id, key, bm) => {
    const m = mounts.get(`${id}|${key}`);
    if (!(bm instanceof ImageBitmap)) return;
    if (!m?.g || gone.has(id)) return bm.close();
    try { m.g.transferFromImageBitmap(bm); stats.frames = (stats.frames || 0) + 1; } catch { bm.close(); }
  };
  // One of the mod's pictures, asked of the worker (which gives only that mod's own files), decoded here.
  const asset = (id, path) => {
    const k = `${id}|${path}`;
    if (!assets.has(k)) {
      assets.set(k, chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'asset', mod: id, path }).then((a) => {
        if (!a?.ok) throw new Error('asset');
        return createImageBitmap(new Blob([Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0))], { type: a.type }));
      }));
      const pending = assets.get(k);
      pending.catch(() => { if (assets.get(k) === pending) assets.delete(k); });
    }
    return assets.get(k);
  };

  // What a mod's checked call does here.
  const lastFx = new Map();
  const apply = (id, via, call, v) => {
    stats.applied[call] = (stats.applied[call] || 0) + 1;
    const o = overlays.get(id) || {};
    overlays.set(id, o);
    if (call === 'ui.render') { trees.set(`${id}|${v.slot}`, v.tree); draw(id, v.slot); }
    else if (call === 'cards.set') { o.cards = v; paintCards(); }
    else if (call === 'palette.set') o.cmds = v;
    else if (call === 'nav.set' || call === 'rules.set' || call === 'look.override') {
      o[{ 'nav.set': 'nav', 'rules.set': 'rules', 'look.override': 'look' }[call]] = Array.isArray(v) && !v.length ? null : v;
      reparts();
    } else if (call === 'effects.play') {
      // At most one effect a mod every 200 ms, and none with motion off or the page hidden (features/motionx.js checks).
      const now = performance.now();
      if (now - (lastFx.get(id) ?? -1e9) < 200 || motionOff() || document.hidden) return;
      lastFx.set(id, now);
      ctx()?.need('features/motionx.js', () => globalThis.GZ_MOTIONX).then(() => GZ_MOTIONX.burst(v.fx, v.x * innerWidth, v.y * innerHeight), () => {});
    } else if (call === 'broadcast') emit(id, 'broadcast', v, via);
  };
  // What one mod showed or changed, gone with it.
  const forget = (id) => {
    for (const k of [...trees.keys()]) if (k.startsWith(`${id}|`)) trees.delete(k);
    for (const k of [...mounts.keys()]) if (k.startsWith(`${id}|`)) detach(k);
    for (const k of [...assets.keys()]) if (k.startsWith(`${id}|`)) { assets.get(k).then((bm) => bm.close(), () => {}); assets.delete(k); }
    const had = overlays.get(id);
    overlays.delete(id);
    pausedOf.delete(id);
    if (had?.cards) paintCards();
    if (had?.nav || had?.rules || had?.look) reparts();
  };
  const resetAll = () => { for (const m of list) forget(m.id); };

  // ---- Look parts laid over the student's ------------------------------------------------------------------------------------
  // GZ_CTX.parts() asks parts(base) with the worn Look's (or null). The first mod in the student's order to give a part wins
  // it; rules add up (the Look's first), up to the 64 a Look may have. Never saved; gone with the mod.
  let partsSig = '', partsOut = null, partsBase;
  const freeze = (o) => { for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v); return Object.freeze(o); };
  const parts = (base) => {
    const o = running().map((m) => overlays.get(m.id)).filter((x) => x && (x.nav || x.rules || x.look));
    if (!o.length) return base;
    const sig = JSON.stringify(o.map((x) => [x.nav, x.rules, x.look]));
    if (sig === partsSig && base === partsBase) return partsOut;
    const x = { ...(base || {}) };
    for (const p of o.map((y) => y.look).filter(Boolean).reverse()) Object.assign(x, p);
    const nav = o.map((y) => y.nav || y.look?.nav).find(Boolean);
    if (nav) x.nav = nav;
    const rules = [...(base?.rules || []), ...o.flatMap((y) => [...(y.look?.rules || []), ...(y.rules || [])])].slice(0, 64);
    if (rules.length) x.rules = rules;
    partsSig = sig; partsBase = base; partsOut = freeze(JSON.parse(JSON.stringify(x)));
    return partsOut;
  };
  const reparts = () => { partsSig = ''; document.dispatchEvent(new CustomEvent('glaze:parts')); };

  // ---- cards ------------------------------------------------------------------------------------------------------------------
  const CARDS = { ultra: 'article[id^="course-list-course-"]', canvas: '.ic-DashboardCard', moodle: '[data-region="course-content"]' };
  const cardId = (card) => (site() === 'ultra' ? card.dataset.courseId || card.id.slice(19) : site() === 'moodle' ? card.dataset.courseId
    : card.querySelector('a[href*="/courses/"]')?.getAttribute('href')?.match(/\/courses\/(\d+)/)?.[1]) || '';
  const cards = () => (CARDS[site()] ? [...document.querySelectorAll(CARDS[site()])] : []);
  const cardList = () => cards().map((c) => ({ id: cardId(c), name: (c.querySelector('h2, h3, h4, .course-title, .ic-DashboardCard__header-title, .coursename')?.textContent || '').trim().slice(0, 200) })).filter((c) => /^[\w.:-]{1,64}$/.test(c.id));
  const decos = new WeakMap(); // card → its decoration's host
  let cardsAsked = '';
  // Each card on the page with the first decoration given for its course, applied as the page is swept: never waited for.
  const paintCards = () => {
    const given = running().map((m) => overlays.get(m.id)?.cards).filter(Boolean);
    for (const card of cards()) {
      const d = given.map((g) => g[cardId(card)]).find(Boolean);
      let host = decos.get(card);
      if (!d) { if (host) { host.el.remove(); decos.delete(card); } continue; }
      const sig = JSON.stringify(d);
      if (host?.sig === sig && host.el.parentNode === card) continue;
      if (!host || host.el.parentNode !== card) {
        const el = document.createElement('span');
        el.className = 'gz-mod-deco';
        host = { el, root: el.attachShadow({ mode: 'closed' }), sig: '' };
        decos.set(card, host);
        card.append(el);
      }
      host.sig = sig;
      ui()?.then((U) => U.decorate(host.root, d), () => {});
    }
  };

  // ---- the nav: items for transforms, rail widgets, a replacement -----------------------------------------------------------
  const navItems = () => [...document.querySelectorAll('[data-gz-nav-id]')].slice(0, 64).map((u) => ({ id: u.dataset.gzNavId, label: (u.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80) }))
    .filter((i) => i.id && !i.id.startsWith('w:') && !i.id.startsWith('g:'));
  let itemsSig = '';
  // The first running mod, in the student's order, that has `key` turned on (and the slot to fill it, for nav and bg).
  const claimant = (key) => (run && runtime === true ? running().find((m) => m.on?.includes(key) && (key === 'bg' ? slotOf(m.id, 'background') : key === 'nav' || key.startsWith('tile:') ? slotOf(m.id, key) : true)) : null);
  const railBoxes = new Map(); // `${mod}|${slot}` → the rail's element for it
  // Rail widgets of the running mods, for features/nav.js to put among its own.
  const rail = () => {
    const want = run && runtime === true ? running().flatMap((m) => (m.slots || []).filter((s) => s.key.startsWith('rail:')).map((s) => [m, s])) : [];
    for (const k of [...railBoxes.keys()]) if (!want.some(([m, s]) => `${m.id}|${s.key}` === k)) { detach(k); railBoxes.get(k).remove(); railBoxes.delete(k); }
    return want.map(([m, s]) => {
      const k = `${m.id}|${s.key}`;
      if (!railBoxes.has(k)) {
        const box = document.createElement('div');
        box.className = 'gz-nav-widget gz-mod-rail';
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', s.name);
        const el = document.createElement('div');
        el.style.cssText = s.file ? 'width:100%;height:120px' : 'width:100%';
        box.append(el);
        railBoxes.set(k, box);
        attach(m.id, s.key, el);
      }
      return { key: k, el: railBoxes.get(k) };
    });
  };
  const NAV_ROOT = { ultra: 'nav[class*="makeStylesnavigation"], nav#base_tools', canvas: '#header .ic-app-header__main-navigation', moodle: '.primary-navigation' };
  let navTaken = null; // { root, display, box, k }
  const syncNavSlot = () => {
    const m = claimant('nav');
    const root = m && NAV_ROOT[site()] ? document.querySelector(NAV_ROOT[site()]) : null;
    const k = m && root ? `${m.id}|nav` : '';
    if (navTaken && (navTaken.k !== k || navTaken.root !== root || !navTaken.box.isConnected)) {
      detach(navTaken.k);
      navTaken.box.remove();
      if (navTaken.root.isConnected) { if (navTaken.display) navTaken.root.style.setProperty('display', navTaken.display, navTaken.prio); else navTaken.root.style.removeProperty('display'); }
      navTaken = null;
    }
    if (!k || navTaken) { if (navTaken && navTaken.root.style.getPropertyValue('display') !== 'none') navTaken.root.style.setProperty('display', 'none', 'important'); return; }
    const box = document.createElement('div');
    box.className = 'gz-mod-nav';
    box.setAttribute('role', 'navigation');
    box.setAttribute('aria-label', slotOf(m.id, 'nav').name || m.name);
    box.style.cssText = 'display:block;width:100%;height:100%;min-height:240px;overflow:auto';
    navTaken = { root, display: root.style.getPropertyValue('display'), prio: root.style.getPropertyPriority('display'), box, k };
    root.before(box);
    root.style.setProperty('display', 'none', 'important');
    attach(m.id, 'nav', box);
  };
  let bgTaken = null; // { box, k }
  const syncBg = () => {
    const m = claimant('bg');
    const k = m ? `${m.id}|background` : '';
    if (bgTaken && bgTaken.k !== k) { detach(bgTaken.k); bgTaken.box.remove(); bgTaken = null; ctx()?.background?.(null); }
    if (!k || bgTaken) return;
    // In the scene's place (content.js puts it in the topmost layer, where #gz-scene is styled).
    const box = document.createElement('div');
    box.id = 'gz-scene';
    box.setAttribute('aria-hidden', 'true');
    bgTaken = { box, k };
    attach(m.id, 'background', box);
    ctx()?.background?.(box);
  };

  // Tiles of the running mods for features/widgets.js: { tile id: { name, size, fill } }. A tile's id is the board's kind
  // of id (lib/widgets.js MORE_ID): m, the mod id's first 14 characters and the tile's place in its manifest.
  const tiles = () => Object.fromEntries((run && runtime === true ? running() : []).flatMap((m) => (m.slots || []).filter((s) => s.key.startsWith('tile:')).map((s, i) => [claimant(s.key)?.id === m.id ? s.key.slice(5) : `m${m.id.slice(0, 14)}${i}`, {
    name: s.name, size: s.size || 's', owner: `${m.id}|${s.key}`,
    fill: (body) => {
      const el = document.createElement('div');
      el.style.cssText = s.file ? `width:100%;height:${{ s: 160, m: 240, l: 360 }[s.size] || 200}px` : 'width:100%';
      body.append(el);
      return { stop: attach(m.id, s.key, el) };
    },
  }])));
  // Everything the mods show, put where it goes now (a new list, a host that just said mods run, a page swept).
  const place = () => {
    if (!ctx()) return;
    const on = !!run && runtime === true;
    globalThis.GZ_WIDGETS_UI?.declare?.(tiles());
    const railWant = on && running().some((m) => m.slots?.some((s) => s.key.startsWith('rail:')));
    if (railWant || railBoxes.size) {
      if (!railWant) rail();
      ctx().need('features/nav.js', () => globalThis.GZ_NAV_UI).then(() => GZ_NAV_UI.sync(), () => {});
    }
    syncNavSlot();
    syncBg();
    for (const k of mounts.keys()) { const [id, key] = k.split('|'); frameIn(id, key); }
    paintCards();
  };
  // Content.js's sweep: cards and the nav as the LMS redraws them; what changed is told to the mods.
  let where = '';
  const pass = () => {
    if (quiet()) return stop(false);
    if (!run || runtime !== true) return;
    const here = location.href;
    if (here !== where) { where = here; emitAll('page', pageNow()); }
    const ids = cardList();
    const sig = JSON.stringify(ids);
    if (sig !== cardsAsked) { cardsAsked = sig; emitAll('cards', { courses: ids }, (m) => m.events?.includes('courses')); }
    const items = navItems(), isig = JSON.stringify(items);
    if (isig !== itemsSig) { itemsSig = isig; emitAll('nav.items', { items }); }
    syncNavSlot();
    for (const k of mounts.keys()) { const [id, key] = k.split('|'); frameIn(id, key); }
    paintCards();
    paused();
  };
  // The palette's commands from the mods, in the student's order (features/palette.js).
  const cmds = () => running().flatMap((m) => (overlays.get(m.id)?.cmds || []).map((c) => ({ label: c.title, hint: c.hint || m.name, group: 'Glaze', run: () => emit(m.id, 'palette.run', { id: c.id }) })));
  // Whether a running mod takes over `key` (effect:<moment>, nav, bg) where the student turned that on.
  const replaces = (key) => !!claimant(key);

  // What the worker says to run now; restarted when that changes. A mod stopped here starts again only if it changed. Only the
  // order or which replacements are on changing moves what shows, without a restart.
  let asking = 0, revision = 0;
  const same = (a, b) => JSON.stringify(a.map(({ on, ...m }) => m).sort((x, y) => (x.id < y.id ? -1 : 1))) === JSON.stringify(b.map(({ on, ...m }) => m).sort((x, y) => (x.id < y.id ? -1 : 1)));
  const refresh = () => {
    clearTimeout(asking);
    const current = ++revision;
    checking = true;
    asking = setTimeout(() => {
      if (!alive()) return stop();
      chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'list' }).then((a) => {
        if (current !== revision) return;
        checking = false;
        const next = Array.isArray(a?.mods) ? a.mods : [];
        if (JSON.stringify(next) === JSON.stringify(list)) return begin();
        if (run && same(next, list)) { list = next; reparts(); paintCards(); return place(); }
        const was = new Map(list.map((m) => [m.id, JSON.stringify(m)]));
        for (const id of [...gone.keys()]) if (was.get(id) !== JSON.stringify(next.find((m) => m.id === id))) gone.delete(id);
        stop();
        list = next;
        restarts = 0;
        begin();
      }, () => {});
    }, 50);
  };
  // Pages that change in place (Ultra): stop on a quiz or tool route, start again off one.
  const placeNow = () => { if (quiet()) stop(); else { begin(); pass(); } };
  let wired = false;
  const wire = () => {
    wired = true;
    document.addEventListener('visibilitychange', () => {
      if (!run) return;
      if (!document.hidden) {
        const now = performance.now();
        run.host = now;
        for (const k of run.seen.keys()) run.seen.set(k, now);
        for (const sh of run.slots.values()) sh.host = now;
        beat(run);
      }
      run?.port.postMessage({ event: 'visible', data: !document.hidden });
      for (const sh of run?.slots.values() || []) sh.port.postMessage({ event: 'visible', data: !document.hidden });
      paused();
    });
    globalThis.navigation?.addEventListener('navigatesuccess', placeNow);
    addEventListener('popstate', placeNow);
    // The moments content.js and the features announce: data events to the mods granted them, and a moment's effect to
    // the mod that replaces it (with motion on and the page shown).
    document.addEventListener('glaze:moment', (e) => {
      const { name, x, y } = e.detail || {};
      if (typeof name !== 'string' || !run) return;
      if (['complete', 'submit', 'grade'].includes(name)) tell(name);
      const m = claimant(`effect:${name}`);
      if (m && !motionOff() && !document.hidden) emit(m.id, 'effect', { moment: name, ...(Number.isFinite(x) && Number.isFinite(y) && { x: x / innerWidth, y: y / innerHeight }) });
    });
    chrome.storage.onChanged.addListener((c, area) => {
      if (!alive()) return stop();
      // A kill message cannot reach a host frozen by frame code. Remove it before asking for the new list.
      const revoked = area === 'local' && (c.mods || c.modsBlocklist || (c.modDev && c.modDev.newValue !== true) || Object.entries(c).some(([k, v]) => k.startsWith('mod:') && (!v.newValue || v.newValue.enabled === false || v.newValue.blocked || JSON.stringify(v.oldValue?.grants) !== JSON.stringify(v.newValue?.grants))));
      if (revoked || (area === 'sync' && c.enabled?.newValue === false)) stop(false);
      if ((area === 'local' && Object.keys(c).some((k) => k === 'mods' || k === 'modsBlocklist' || k === 'modOrder' || k === 'modDev' || k.startsWith('mod:') || k.startsWith('modReplace:'))) || (area === 'sync' && c.enabled)) refresh();
      if (area === 'sync' && (c.colors || c.motion)) { run?.port.postMessage({ event: 'theme' }); for (const sh of run?.slots.values() || []) sh.port.postMessage({ event: 'theme' }); setTimeout(paused, 100); }
      if (area === 'local') {
        for (const k of Object.keys(c)) if (k.startsWith('modSettings:')) emit(k.slice(12), 'settings', {});
        if (c.seenCourses) tell('courses');
        if (c.todoCache) tell('todo');
      }
    });
  };
  const start = (mods) => {
    if (!wired) wire();
    if (!run && Array.isArray(mods)) { list = mods; begin(); } else refresh();
  };
  return { start, stop, verdict, parts, hasBg: () => running().some((m) => overlays.get(m.id)?.look?.bg), replaces, tiles, rail, cmds, pass, attach,
    stats: () => ({ ...stats, running: !!run, runtime, gone: Object.fromEntries(gone), slots: [...mounts.keys()], slotHosts: run ? run.slots.size : 0, nav: navTaken?.k || '', bg: bgTaken?.k || '' }) };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODS; else GZ_MODS;
