// Ported from Rimeward src/lib/agent/diagnostics.ts (modelFailure), decisions.ts (bounded) and provider.ts (isTransient,
// recordModelCall, runModel's deadline) (MIT). The AI harness's failures and call record (docs/ai-harness.md): a model
// request that fails is one of CATEGORIES, with its HTTP status when there was one and a reference id the student can quote;
// never the server's words, the prompt or a key. The record of calls keeps the last LIMIT.calls, metadata only.
// Classic script for the worker; module.exports for node.
var GZ_AI_FAILURE = globalThis.GZ_AI_FAILURE || (() => {
  const CATEGORIES = ['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'];
  const LIMIT = { calls: 40, body: 64 << 10 };
  const reference = () => crypto.randomUUID();
  // error → an Error with { category, status?, reference }: aborted (the student's cancel) wins, then a category the thrower
  // named, a timeout, an HTTP status (5xx: the provider is unavailable; 4xx: it refused the request), JSON that didn't parse,
  // and anything else is a lost connection.
  const modelFailure = (error, { id = reference(), aborted = false } = {}) => {
    const e = error || {};
    const code = e.status ?? e.cause?.statusCode;
    const status = Number.isInteger(code) && code >= 400 && code <= 599 ? code : undefined;
    const category = aborted ? 'cancelled' : CATEGORIES.includes(e.category) ? e.category
      : [e.name, e.cause?.name].some((n) => n === 'TimeoutError') ? 'timeout'
        : status ? (status >= 500 ? 'provider-unavailable' : 'request-rejected')
          : e.name === 'SyntaxError' ? 'invalid-response' : 'connection-lost';
    const failure = Object.assign(new Error(`Model request ${category}${status ? ` (HTTP ${status})` : ''}. Reference ${id}. No uncertain inference request was automatically replayed.`),
      { code: category, category, ...(status && { status }), reference: id });
    // What the provider said, for a developer (the eval): not enumerable, so it goes nowhere with the failure. Providers
    // take the key out of it first.
    if (error instanceof Error) Object.defineProperty(failure, 'cause', { value: error, enumerable: false });
    return failure;
  };
  // Worth one quiet retry, and only when the server answered without running the request: a rate limit. A dropped
  // connection, a 5xx or a stream cut short may have run it, and inference is never replayed.
  const transient = (status) => status === 429;
  // A response body, refused past `limit` bytes.
  const bounded = async (response, limit = LIMIT.body) => {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        size += r.value.byteLength;
        if (size > limit) throw Object.assign(new Error(`response exceeds ${limit >> 10} KB`), { category: 'invalid-response' });
        chunks.push(r.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return new TextDecoder().decode(all);
  };
  // One signal for several (AbortSignal.any is Chrome 116+, the manifest's minimum is 113): aborts with the first's reason.
  // → { signal, done() } (done removes the listeners).
  const anySignal = (signals) => {
    const c = new AbortController(), list = signals.filter(Boolean), offs = [];
    for (const s of list) {
      if (s.aborted) { c.abort(s.reason); break; }
      const stop = () => c.abort(s.reason);
      s.addEventListener('abort', stop, { once: true });
      offs.push(() => s.removeEventListener('abort', stop));
    }
    return { signal: c.signal, done: () => offs.forEach((f) => f()) };
  };
  // A signal that aborts after ms with a TimeoutError (AbortSignal.timeout's, with a timer that can be cleared).
  const deadline = (ms) => {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(new DOMException('Model response timed out.', 'TimeoutError')), ms);
    return { signal: c.signal, done: () => clearTimeout(t) };
  };
  // The bounded call record: area { get, set } (storage.local in the worker), key, record { id, … }: replaces the row with
  // its id, keeps the last LIMIT.calls. Never prompts, answers, addresses or keys. A failed write never blocks a call.
  const KEYS = ['id', 'task', 'feature', 'provider', 'state', 'category', 'status', 'startedAt', 'ms', 'usage', 'steps', 'parts'];
  const record = async (area, key, row) => {
    try {
      const clean = Object.fromEntries(KEYS.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
      const rows = (await area.get(key))[key];
      await area.set({ [key]: [...(Array.isArray(rows) ? rows.filter((r) => r?.id !== row.id).slice(-(LIMIT.calls - 1)) : []), clean] });
    } catch { /* Diagnostic metadata must never block a model call. */ }
  };
  return { CATEGORIES, LIMIT, modelFailure, transient, bounded, anySignal, deadline, record, reference };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_FAILURE; else GZ_AI_FAILURE;
