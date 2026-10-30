// The worker's way to the engine host of Glaze's own model (ai/local/host.js; docs/ai-harness.md "Glaze's own model").
// Chrome: an offscreen document (ai/local/host.html, reason WORKERS) runs the host in a dedicated Worker and connects a
// port named PORT to this worker (background/background.js hands it to accept()); the document stays while the weights
// are loaded and closes after LIMIT.idle with nothing in flight. A document left from an earlier worker is asked to
// connect again (runtime message 'glaze:local-host'). Firefox: a dedicated Worker started here, from the event page,
// ended after LIMIT.idle; while anything is in flight the page asks the browser something every LIMIT.tick, so it isn't
// unloaded mid-download or mid-answer. Elsewhere (Safari) there is no host.
// call(op, args, { signal, onEvent }) → the host's result; a cancel tells the host. A port that goes ends every call as
// provider-unavailable (reason 'host'); nothing is replayed. Classic script; node exports.
var GZ_AI_LOCAL_LINK = globalThis.GZ_AI_LOCAL_LINK || (() => {
  const LIMIT = { idle: 300000, connect: 20000, tick: 20000 };
  const PAGE = 'ai/local/host.html', WORKER = 'ai/local/host.js', PORT = 'glaze:local';
  const fail = (reason) => Object.assign(new Error(`local host: ${reason}`), { category: 'provider-unavailable', reason });

  // env: { runtime (chrome.runtime), offscreen? (chrome.offscreen), clients? (ServiceWorker clients), Worker?, keep?() (Firefox: any extension API call),
  // setTimeout?, clearTimeout? }.
  const create = (env) => {
    const later = env.setTimeout || setTimeout, cancelTimer = env.clearTimeout || clearTimeout;
    const kind = typeof env.offscreen?.createDocument === 'function' ? 'offscreen' : typeof env.Worker === 'function' ? 'worker' : null;
    const calls = new Map(); // id → { resolve, reject, onEvent }
    let port = null, opening = null, closing = null, waiting = null, seq = 0, keepTimer = null;

    const drop = (p, reason = 'host') => {
      if (p && port !== p) return;
      port = null;
      cancelTimer(keepTimer); keepTimer = null;
      for (const [id, c] of calls) { calls.delete(id); c.reject(fail(reason)); }
    };
    const heard = (m) => {
      if (m?.type === 'idle') {
        if (calls.size) return; // The host may have emitted idle before a new request reached it.
        if (kind === 'worker') { const p = port; drop(p, 'idle'); try { p?.disconnect(); } catch { /* gone */ } }
        else {
          const p = port;
          closing ||= Promise.resolve().then(() => env.offscreen.closeDocument?.()).then(() => drop(p, 'idle'), () => {})
            .finally(() => { closing = null; });
        }
        return;
      }
      const c = calls.get(m?.id);
      if (!c) return;
      if (m.type === 'done') { calls.delete(m.id); c.resolve(m.result); }
      else if (m.type === 'error') { calls.delete(m.id); c.reject(Object.assign(new Error('local host'), m.error || {})); }
      else c.onEvent?.(m);
      keep();
    };
    // Firefox unloads an idle event page whatever its Worker is doing: an API call now and then while something runs.
    const keep = () => {
      if (kind !== 'worker' || keepTimer || !calls.size || typeof env.keep !== 'function') return;
      keepTimer = later(() => { keepTimer = null; if (!calls.size) return; Promise.resolve().then(env.keep).catch(() => {}); keep(); }, LIMIT.tick);
    };
    const use = (p) => {
      port = p;
      p.onMessage.addListener((m) => { if (port === p) heard(m); });
      p.onDisconnect.addListener(() => drop(p));
      p.postMessage({ op: 'config', idle: LIMIT.idle });
    };
    // A port from the host page (background.js checked that it is that page of this extension).
    const accept = (p) => {
      if (kind !== 'offscreen') { try { p.disconnect(); } catch { /* gone */ } return; }
      if (port && port !== p) { const old = port; drop(old); try { old.disconnect(); } catch { /* gone */ } }
      use(p);
      waiting?.(p);
    };
    const exists = async () => {
      const url = env.runtime.getURL(PAGE);
      if (typeof env.runtime.getContexts === 'function') return (await env.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).some((c) => String(c.documentUrl || '').split('?')[0] === url);
      if (typeof env.clients?.matchAll === 'function') return (await env.clients.matchAll()).some((c) => String(c.url || '').split(/[?#]/)[0] === url);
      return typeof env.offscreen.hasDocument === 'function' ? !!await env.offscreen.hasDocument() : false;
    };
    const open = () => {
      if (closing) return closing.then(open);
      if (port) return Promise.resolve(port);
      if (!kind) return Promise.reject(fail('browser'));
      return (opening ||= (async () => {
        if (kind === 'worker') {
          const w = new env.Worker(env.runtime.getURL(WORKER));
          const on = [], gone = [];
          w.onmessage = (e) => on.forEach((f) => f(e.data));
          w.onerror = () => { gone.forEach((f) => f()); try { w.terminate(); } catch { /* gone */ } };
          use({ postMessage: (m) => w.postMessage(m), onMessage: { addListener: (f) => on.push(f) }, onDisconnect: { addListener: (f) => gone.push(f) }, disconnect: () => w.terminate() });
          return port;
        }
        let timer;
        const got = new Promise((resolve, reject) => {
          timer = later(() => { waiting = null; reject(fail('host')); }, LIMIT.connect);
          waiting = (p) => { cancelTimer(timer); waiting = null; resolve(p); };
        });
        const starting = (async () => {
          if (await exists()) env.runtime.sendMessage({ type: 'glaze:local-host', op: 'connect' })?.catch?.(() => {});
          else {
            try { await env.offscreen.createDocument({ url: PAGE, reasons: ['WORKERS'], justification: 'Runs Glaze’s own AI model on this computer.' }); }
            catch { if (await exists().catch(() => false)) env.runtime.sendMessage({ type: 'glaze:local-host', op: 'connect' })?.catch?.(() => {}); else throw fail('host'); }
          }
        })();
        try { await Promise.race([starting, got]); return await got; }
        finally { cancelTimer(timer); waiting = null; }
      })().finally(() => { opening = null; }));
    };
    const call = async (op, args = {}, { signal, onEvent } = {}) => {
      if (signal?.aborted) throw signal.reason;
      const p = await open();
      if (signal?.aborted) throw signal.reason;
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const stop = () => { if (!calls.delete(id)) return; try { p.postMessage({ id, op: 'cancel' }); } catch { /* gone */ } reject(signal.reason); };
        const done = (f) => (v) => { signal?.removeEventListener('abort', stop); f(v); };
        calls.set(id, { resolve: done(resolve), reject: done(reject), onEvent });
        signal?.addEventListener('abort', stop, { once: true });
        try { p.postMessage({ ...args, id, op }); } catch { calls.delete(id); reject(fail('host')); }
        keep();
      });
    };
    return { call, accept, kind, get up() { return !!port; }, close: () => { const p = port; drop(p, 'closed'); try { p?.disconnect(); } catch { /* gone */ } } };
  };
  return { LIMIT, PAGE, WORKER, PORT, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOCAL_LINK; else GZ_AI_LOCAL_LINK;
