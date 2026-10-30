// The worker's end of the glaze-mcp pipe, and the only code that calls connectNative (test/agent-link.test.js). One native
// port to the helper (io.frostdev.glaze_mcp; on Safari the Glaze app) carries every agent app's connection as
// lib/agent-frames.js frames; the worker glue attaches the MCP engine to open, line and close.
//
// make(env) → { attach, send, close, ensure, stop, status }
//   env: runtime (connectNative, lastError, getManifest; on Safari sendNativeMessage), permissions (contains), storage
//   (local, session), browser ('chrome' | 'firefox' | 'safari'); timers, now() and random(n) default to the real ones.
//   attach({ open(c, peer), line(c, text), close(c, why), state(status) }). send(c, text) and close(c, why) → whether it went;
//   the link closes a connection itself as 'gone' (the helper left), 'stopped' or 'too-long' (a line over 64 MiB).
//   ensure() brings the link to what storage.local mcp says (as lib/mcp/grants.js reads it) and runs on every trigger:
//   worker start, onStartup, onInstalled, an mcp change either way, permissions.onAdded.
//   stop() says bye and disconnects the port itself, as permissions.remove leaves an open port open.
//
// status() → { state, at, host?, browser?, error? }, mirrored to storage.session mcpLink so the options page can read it
// without waking the worker. at: when the state began; host, browser: the helper's hello; error: what the browser or the
// helper last said.
//   off               mcp isn't on
//   needs-permission  nativeMessaging isn't granted
//   restart           granted after this worker started, so it has no connectNative; the next worker start connects
//   not-installed     no helper for this browser (on Safari, an app without the agent bridge)  ┐
//   forbidden         the helper's manifest doesn't allow this extension                       │
//   old-helper        the helper's hello has another version, or a frame doesn't fit           ├ tried again on a trigger
//   no-node           the helper's launcher has no Node.js to run it: instead of a hello it    │
//                     said {t:'error',why:'no-node'} (mcp/lib/launcher.js) and exited          ┘
//   exited            the helper left: tried again after 1 s, doubling to 60 s, from 1 s again after 5 minutes connected
//   connecting        waiting up to 30 s for the helper's hello; a retry keeps showing the last answer instead
//   connected
//
// Safari Swift contract (DMG bridge, T12/T13): batches {type:'agent.frames', i, s, seq, frames}, sent through
// runtime.sendNativeMessage(SAFARI, batch), one in flight. i is the stable profile instance; s is a fresh 128-bit hex
// nonce at each connection, and seq starts at 1. The app must scope its queue and replies to both i and s, and dispatch
// with dispatchMessage("agent.frames", {i, s, frames}). On the connectNative event port this becomes
// {name:'agent.frames', userInfo:{i, s, frames}}; both ids must match before any frame is accepted.
// The app answers {ok:true} once it has the batch; anything else ends the session. Only {ok:false,error:'not-installed'}
// or the echo from a build without the bridge means not-installed. A 20 s keep-alive sends an empty batch when idle.
// Empty batches also run before hello and during exited backoff, keeping native API traffic under the worker's idle
// limit so the retry timer can run. In backoff they carry the retired s: Swift must never open a session without hello,
// and their answers/dispatches cannot restore it. Only the scheduled retry sends hello with a fresh s.
//
// Classic script; module.exports for node. In the worker it's loaded after lib/agent-frames.js.
var GZ_AGENT_LINK = globalThis.GZ_AGENT_LINK || (() => {
  const F = typeof GZ_AGENT_FRAMES !== 'undefined' ? GZ_AGENT_FRAMES : require('./agent-frames.js');
  const HOST = 'io.frostdev.glaze_mcp', SAFARI = 'io.frostdev.Glaze';
  const KEY = 'mcpLink', INSTANCE = 'mcpInstance', SETTING = 'mcp';
  const STATES = ['off', 'needs-permission', 'restart', 'not-installed', 'forbidden', 'exited', 'connecting', 'connected', 'old-helper', 'no-node'];
  const NO_NODE = 'no-node';
  // Tries from these keep showing them until they have an answer; the live ones keep Safari's worker up.
  const RETRYING = new Set(['not-installed', 'forbidden', 'old-helper', 'exited', NO_NODE]), LIVE = new Set(['connecting', 'connected', 'exited']);
  const FIRST = 1e3, LAST = 60e3, SETTLED = 5 * 60e3, HELLO = 30e3, DRAIN = 1e3, ERROR_MAX = 200;
  // The browsers' own words as a native port closes: Chromium's, as the spike recorded them (progress.md, 2026-10-29), and
  // Firefox's, which says the same for a missing manifest and for one that doesn't list Glaze (NativeMessaging.sys.mjs).
  // Any other, or none (Firefox's clean exit), is exited.
  const SAID = new Map([
    ['Specified native messaging host not found.', 'not-installed'],
    ['Invalid native messaging host name specified.', 'not-installed'],
    ['Access to the specified native messaging host is forbidden.', 'forbidden'],
    ['Native host has exited.', 'exited'],
    [`No such native application ${HOST}`, 'not-installed'],
  ]);
  const ID = /^[0-9a-f]{20}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const on = (raw) => isObj(raw) && raw.on === true; // lib/mcp/grants.js clean().on, without loading it at worker start
  const cut = (s) => String(s).slice(0, ERROR_MAX);
  const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const make = (env) => {
    const { runtime, permissions, storage, browser } = env;
    const timers = env.timers || globalThis, now = env.now || Date.now;
    const random = env.random || ((n) => globalThis.crypto.getRandomValues(new Uint8Array(n)));
    const safari = browser === 'safari';
    let h = {};
    let cur = { state: 'off', at: now() }, shown = false; // shown: mirrored once, so a previous worker's state is replaced
    let writes = Promise.resolve();
    // The session: its port, the helper's hello, open connections and their pieces, and Safari's outbox. gen moves on at
    // every end (and every stop), so a late reply, event or pass from before changes nothing.
    let port = null, hello = null, hostError = '', conns = new Set(), join = F.joiner(), gen = 0, instance = '', session = '';
    let out = [], flying = false, flight = null, draining = null, seq = 0;
    let retry = null, wait = 0, since = 0, greet = null, keep = null;

    const call = (name, ...args) => { try { h[name]?.(...args); } catch (e) { console.warn(e); } };
    const status = () => ({ ...cur });
    const set = (state, extra = {}) => {
      const next = { state, at: state === cur.state ? cur.at : now(), ...extra };
      if (shown && ['state', 'host', 'browser', 'error'].every((k) => next[k] === cur[k])) return;
      cur = next;
      shown = true;
      const s = status();
      if (storage?.session) writes = writes.then(() => storage.session.set({ [KEY]: s })).catch(() => {});
      call('state', status());
      const live = safari && LIVE.has(state);
      if (live && !keep) keep = timers.setInterval(beat, 20000);
      else if (!live && keep) { timers.clearInterval(keep); keep = null; }
    };
    const about = () => (hello ? { host: cut(hello.host), browser: cut(hello.browser) } : {});

    // Safari: the outbox goes in batches of at most a frame's bytes, one in flight; a beat is an empty one.
    const batch = (frames, token = { i: instance, s: session, seq: ++seq }) => {
      const msg = { type: 'agent.frames', ...token, frames };
      try { return Promise.resolve(runtime.sendNativeMessage(SAFARI, msg)); } catch (e) { return Promise.reject(e); }
    };
    // Disconnect/fence immediately, but let the outstanding native call finish before bye. A stalled native call cannot
    // block shutdown or a replacement forever; after the deadline no continuation may send for this session.
    const drain = (pending, token) => {
      let release, live = true;
      const done = new Promise((r) => { release = r; });
      draining = done;
      const finish = () => {
        if (!live) return;
        live = false;
        timers.clearTimeout(deadline);
        if (draining === done) draining = null;
        release();
      };
      const deadline = timers.setTimeout(finish, DRAIN);
      const bye = () => { if (live) batch([{ t: 'bye' }], token).then(finish, finish); };
      if (pending) pending.then(bye, bye); else bye();
    };
    const flush = (empty = false) => {
      if (flying || !port || (!out.length && !empty)) return;
      const frames = [];
      for (let n = 0; out.length;) {
        const b = F.bytes(out[0]);
        if (frames.length && n + b > F.FRAME) break;
        n += b;
        frames.push(out.shift());
      }
      const g = gen;
      flying = true;
      const sent = { i: instance, s: session, seq: seq + 1 };
      flight = batch(frames);
      flight.then((r) => {
        if (g !== gen) return;
        flying = false; flight = null;
        if (r?.ok === true) flush();
        else if (isObj(r) && r.ok === false) ended(typeof r.error === 'string' && r.error ? r.error : 'refused', r.error === 'not-installed' ? 'not-installed' : 'exited');
        else if (isObj(r?.echo) && r.echo.type === 'agent.frames'
          && ['i', 's', 'seq'].every((k) => r.echo[k] === sent[k])) ended('no agent bridge', 'not-installed');
        else ended('unexpected agent bridge reply', 'exited');
      }, (e) => { if (g === gen) ended(e?.message || 'sendNativeMessage failed'); });
    };
    const beat = () => {
      if (port) return flush(true); // hello need not have completed to keep the worker alive
      if (!retry || flying || draining) return;
      const g = gen;
      flying = true;
      flight = batch([]); // keep the native API active while preserving the retry's deadline
      const done = () => {
        if (g !== gen) return;
        flying = false; flight = null;
        flush(); // a retry may have queued its hello behind this keep-alive
      };
      flight.then(done, done); // a retired session's answer cannot change the replacement's state
    };

    const post = (f) => {
      if (!port) return false;
      if (safari) { out.push(f); flush(); return true; }
      try { port.postMessage(f); return true; } catch { return false; }
    };

    // End the session before any late event can reach it. Safari's bye drains separately on its captured session.
    const teardown = (why, bye = false) => {
      const p = port, open = [...conns], pending = flight;
      const token = { i: instance, s: session, seq: seq + 1 };
      if (p && bye && !safari) try { p.postMessage({ t: 'bye' }); } catch { /* already gone */ }
      gen++;
      port = null; hello = null; hostError = '';
      timers.clearTimeout(greet); greet = null;
      out = []; flying = false; flight = null;
      conns = new Set(); join = F.joiner();
      if (p) try { p.disconnect(); } catch { /* already gone */ }
      if (p && bye && safari) drain(pending, token);
      for (const c of open) call('close', c, why);
    };
    // The far side ended it (or never answered): the state from what was said, and for exited a retry after the backoff.
    const ended = (error, state = (!hello && hostError === NO_NODE && NO_NODE) || (typeof error === 'string' && SAID.get(error)) || 'exited') => {
      const lasted = !!hello && now() - since >= SETTLED, why = hostError || error;
      teardown('gone');
      if (state === 'exited') {
        wait = lasted || !wait ? FIRST : Math.min(wait * 2, LAST);
        retry = timers.setTimeout(() => { retry = null; ensure(); }, wait);
      }
      set(state, why ? { error: cut(why) } : {});
    };
    const mismatch = (why) => { teardown('gone'); set('old-helper', { error: why }); };

    // A frame from the helper. The hello comes first and once; then frames for open connections only (the helper's frames
    // for one the worker closed may still be on their way).
    const take = (f) => {
      if (!hello) {
        if (F.valid.toWorker(f) && f.t === 'error' && f.why === NO_NODE) { hostError = f.why; return; }
        if (isObj(f) && f.t === 'hello' && f.v !== 1) return mismatch('version');
        if (!F.valid.toWorker(f) || f.t !== 'hello') return mismatch('frame');
        hello = f;
        since = now();
        timers.clearTimeout(greet); greet = null;
        return set('connected', about());
      }
      if (!F.valid.toWorker(f) || f.t === 'hello') return mismatch('frame');
      if (f.t === 'error') { hostError = f.why; return set('connected', { ...about(), error: cut(f.why) }); }
      if (f.t === 'open') {
        if (!conns.has(f.c)) { conns.add(f.c); call('open', f.c, f.peer); }
        return;
      }
      if (!conns.has(f.c)) return;
      if (f.t === 'close') { conns.delete(f.c); join.drop(f.c); return call('close', f.c, f.why); }
      const text = join.push(f);
      if (text === false) { close(f.c, 'too-long'); call('close', f.c, 'too-long'); } else if (text !== null) call('line', f.c, text);
    };
    const fromApp = (m, g) => {
      const u = isObj(m) && m.name === 'agent.frames' ? m.userInfo : null;
      if (!isObj(u) || u.i !== instance || u.s !== session || !Array.isArray(u.frames)) return;
      for (const f of u.frames) { if (g !== gen) break; take(f); }
    };

    const connect = () => {
      session = hex(random(16));
      seq = 0;
      let p;
      try { p = runtime.connectNative(safari ? SAFARI : HOST); } catch (e) { return ended(e?.message); }
      port = p;
      const g = gen;
      p.onMessage.addListener((m) => { if (port === p) (safari ? fromApp(m, g) : take(m)); });
      // Chrome says why in runtime.lastError, only while this runs; Firefox in port.error.
      p.onDisconnect.addListener(() => { const e = p.error?.message ?? runtime.lastError?.message; if (port === p) ended(e); });
      greet = timers.setTimeout(() => { if (port === p && !hello) ended('timeout'); }, HELLO);
      if (!RETRYING.has(cur.state)) set('connecting');
      post({ t: 'hello', v: 1, glaze: cut(runtime.getManifest?.()?.version || ''), instance });
    };

    const pass = async () => {
      const g = gen;
      if (draining) await draining;
      if (g !== gen) return;
      const got = await storage.local.get([SETTING, INSTANCE]);
      if (g !== gen) return;
      if (!on(got[SETTING])) return void stop();
      if (!safari) {
        const granted = await Promise.resolve(permissions.contains({ permissions: ['nativeMessaging'] })).catch(() => false);
        if (g !== gen) return;
        if (!granted) {
          timers.clearTimeout(retry); retry = null; wait = 0;
          teardown('stopped', true);
          return set('needs-permission');
        }
      }
      if (port || retry) return;
      if (typeof runtime.connectNative !== 'function') return set('restart');
      let id = got[INSTANCE];
      if (typeof id !== 'string' || !ID.test(id)) {
        id = hex(random(10));
        try { await storage.local.set({ [INSTANCE]: id }); } catch { /* a new one next time, then */ }
        if (g !== gen || port || retry) return;
      }
      instance = id;
      connect();
    };
    // One pass at a time; a trigger during one runs another after it.
    let running = null, again = false;
    const ensure = () => {
      if (running) { again = true; return running; }
      running = (async () => {
        do {
          again = false;
          try { await pass(); } catch { /* storage or the grant failed to answer: nothing changed */ }
        } while (again);
        running = null;
        await writes;
        return status();
      })();
      return running;
    };

    const stop = () => {
      again = false; // discard triggers queued before this stop; a later ensure may queue a fresh pass
      timers.clearTimeout(retry); retry = null; wait = 0;
      teardown('stopped', true);
      set('off');
      return writes.then(status);
    };
    const send = (c, text) => !!hello && conns.has(c) && typeof text === 'string' && F.split(c, text).every(post);
    const close = (c, why = 'closed') => {
      if (!conns.delete(c)) return false;
      join.drop(c);
      return post({ t: 'close', c, why: String(why).slice(0, F.STR) });
    };
    const attach = (handlers) => { h = isObj(handlers) ? handlers : {}; };
    return { attach, send, close, ensure, stop, status };
  };

  return { HOST, SAFARI, KEY, INSTANCE, STATES, make };
})();
GZ_AGENT_LINK;
if (typeof module !== 'undefined') module.exports = GZ_AGENT_LINK;
