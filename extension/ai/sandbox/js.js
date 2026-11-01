// run_js's sandbox (docs/ai-harness.md "Rime's own tools"): a manifest sandbox page (an opaque origin, no extension APIs,
// the manifest's sandbox CSP: connect-src 'none', frame-src 'none', worker-src blob:), framed by ai/sandbox/frame.js. It
// takes one handshake from its parent, with the one-use nonce in its own address, then talks only over the port that came
// with it: { id, code } → { id, ok, value, logs, error?, cut?, ms }. Each run is a new blob Worker that sees nothing but the
// code: network, other scripts, storage, more workers and messaging are taken out of its scope first, and the CSP refuses
// any fetch that is left. The Worker is ended at LIMIT.ms, and what it says is held to LIMIT.output characters.
// Chrome only: Firefox and Safari have no manifest sandbox (tools/build drop it), so run_js is not offered there.
// run(code, { make, ms }) is the page's run with a Worker maker, so node can test it. Its limits and the answer's shape
// (tidy) are run_js's own (ai/agent/js.js, loaded first). Classic script; node exports.
var GZ_AI_RIME_SANDBOX = globalThis.GZ_AI_RIME_SANDBOX || (() => {
  const J = typeof GZ_AI_RIME_JS !== 'undefined' ? GZ_AI_RIME_JS : require('../agent/js.js');
  const { LIMIT, tidy } = J;

  // The Worker's whole script, sent as source: it uses nothing from around it.
  function harness(LIMIT) {
    const post = self.postMessage.bind(self), now = () => performance.now();
    // Nothing that reaches out, loads code or keeps anything: gone from the scope, and from every prototype above it (Chrome
    // keeps fetch and the rest on WorkerGlobalScope.prototype), before the code runs.
    const levels = [];
    for (let o = self; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) levels.push(o);
    for (const k of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'WebTransport', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'Worker', 'SharedWorker',
      'BroadcastChannel', 'MessageChannel', 'Request', 'Response', 'Headers', 'navigator', 'location', 'postMessage', 'close', 'chrome', 'browser', 'FileReaderSync', 'OffscreenCanvas', 'storage', 'cookieStore']) {
      for (const o of levels) if (o === self || Object.getOwnPropertyDescriptor(o, k)) try { Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false }); } catch { /* not ours to take */ }
    }
    const show = (v, depth = 0) => {
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v;
      if (v === undefined) return 'undefined';
      if (typeof v === 'bigint') return `${v}n`;
      if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
      if (typeof v === 'symbol') return String(v);
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x === undefined ? null : x))); } catch { return depth ? '[object]' : String(v); }
    };
    const line = (args) => args.map((a) => { const s = show(a); return typeof s === 'string' ? s : JSON.stringify(s); }).join(' ').slice(0, LIMIT.line);
    const logs = [];
    let size = 0, cut = false;
    const log = (...args) => {
      if (logs.length >= LIMIT.lines || size >= LIMIT.output) { cut = true; return; }
      const l = line(args).slice(0, LIMIT.output - size);
      size += l.length; logs.push(l);
    };
    const c = { log, info: log, warn: log, error: log, debug: log, table: (t) => log(t) };
    Object.defineProperty(self, 'console', { value: c, writable: false, configurable: false });
    let started = false;
    self.onmessage = async (e) => {
      if (started) return;
      started = true;
      self.onmessage = null;
      const t0 = now();
      const done = (r) => {
        let value = r.value;
        if (typeof value === 'string' && value.length > Math.max(0, LIMIT.output - size)) { value = value.slice(0, Math.max(0, LIMIT.output - size)); cut = true; }
        post({ ...r, value, logs, ...(cut && { cut: true }), ms: Math.round(now() - t0) });
      };
      try {
        let v = (0, eval)(String(e.data?.code ?? ''));
        if (v && typeof v.then === 'function') v = await v;
        let shown = show(v);
        if (typeof shown !== 'string' && JSON.stringify(shown).length > LIMIT.output) { shown = JSON.stringify(shown); }
        done({ ok: true, value: shown });
      } catch (err) {
        done({ ok: false, value: null, error: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, LIMIT.line) : `Thrown: ${line([err])}` });
      }
    };
  }
  const source = () => `(${harness.toString()})(${JSON.stringify(LIMIT)});`;

  // One run in a new Worker: → its answer, or a stop at ms. make(src) → { postMessage, onmessage, onerror, terminate }.
  const run = (code, { make, ms = LIMIT.ms } = {}) => new Promise((resolve) => {
    if (typeof code !== 'string' || !code.trim()) return resolve({ ok: false, value: null, logs: [], error: 'No code to run.' });
    if (code.length > LIMIT.code) return resolve({ ok: false, value: null, logs: [], error: `The code is longer than ${LIMIT.code} characters.` });
    let w, over = false;
    const end = (r) => { if (over) return; over = true; clearTimeout(timer); try { w?.terminate(); } catch { /* gone */ } resolve(r); };
    const timer = setTimeout(() => end({ ok: false, value: null, logs: [], error: `Stopped after ${ms / 1000} seconds.`, ms }), ms);
    try { w = make(source()); } catch { return end({ ok: false, value: null, logs: [], error: 'The sandbox could not start.' }); }
    w.onmessage = (e) => end(tidy(e.data));
    w.onerror = (e) => { e?.preventDefault?.(); end({ ok: false, value: null, logs: [], error: String(e?.message || 'The code failed.').slice(0, LIMIT.line) }); };
    w.postMessage({ code });
  });
  // The page: one handshake from the parent with this address's nonce, then runs over its port, one at a time.
  if (typeof window !== 'undefined' && typeof location !== 'undefined' && /^#[A-Za-z0-9_-]{20,64}$/.test(location.hash)) {
    const want = location.hash.slice(1);
    let port = null, busy = Promise.resolve();
    const make = (src) => new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    window.addEventListener('message', (e) => {
      if (port || e.source !== window.parent || e.data?.type !== 'glaze:rime-js' || e.data.nonce !== want || !e.ports?.[0]) return;
      port = e.ports[0];
      port.onmessage = (m) => {
        const { id, code } = m.data || {};
        if (!Number.isSafeInteger(id)) return;
        busy = busy.then(() => run(code, { make })).then((r) => port.postMessage({ id, ...r }));
      };
      port.postMessage({ ready: true });
    });
  }
  return { LIMIT, harness, source, run, tidy };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_RIME_SANDBOX;
