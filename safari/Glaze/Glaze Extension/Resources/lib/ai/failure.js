// Ported from Rimeward src/lib/agent/diagnostics.ts (modelFailure), decisions.ts (bounded) and provider.ts (isTransient,
// recordModelCall, runModel's deadline) (MIT). The AI harness's failures and call record (docs/ai-harness.md): a model
// request that fails is one of CATEGORIES, with its HTTP status when there was one and a reference id the student can quote;
// never the server's words, the prompt or a key. The record of calls keeps the last LIMIT.calls, metadata only.
// Classic script for the worker; module.exports for node.
var GZ_AI_FAILURE = globalThis.GZ_AI_FAILURE || (() => {
  const CATEGORIES = ['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'];
  const LIMIT = { calls: 40, body: 64 << 10 };
  // Fixed codes only. Native descriptions and browser exceptions may contain document text.
  const REASONS = {
    browser: 'This browser does not expose the on-device model API.',
    device: 'The browser reports that the model is unavailable for this device or session.',
    failed: 'The browser could not check the on-device model’s availability.',
    native: 'Glaze could not reach the Apple Intelligence native handler.',
    off: 'Apple Intelligence is off. Turn it on in System Settings.',
    os: 'This version of Glaze requires macOS or iOS 27 for Apple Intelligence.',
    'not-ready': 'Apple Intelligence is still preparing its model.',
    context: 'The document and instructions exceed this model’s context window.',
    'response-context': 'The input fit, but the model exhausted its context while producing the answer.',
    'response-limit': 'The model exceeded this request’s output limit.',
    unsupported: 'This model does not support the requested input or response format.',
    language: 'This model does not support the requested language.',
    rate: 'The on-device model is busy. Try again shortly.',
    guardrail: 'The on-device model declined this request under its safety rules.',
    refusal: 'The on-device model declined this request.',
    assets: 'The on-device model’s files are not ready or could not be loaded.',
    decoding: 'The on-device model returned an answer Glaze could not read.',
    unknown: 'The on-device model failed without a specific reason.',
    timeout: 'The on-device model did not respond in time.',
    activation: 'Open Settings → AI and click Download to prepare this model.',
    outline: 'The model returned an outline that did not match the document’s structure.',
    'outline-sections': 'This document has too many sections for one AI outline pass. The local outline is shown.',
    'outline-section-context': 'A section is too long for this model’s context window. The local outline is shown.',
    feedback: 'The model could not produce grounded feedback for every criterion.',
    'feedback-criteria': 'This assignment has more criteria than one feedback assessment supports.',
    'feedback-attachments': 'This assignment has more attachments than one feedback assessment supports.',
    'feedback-material': 'The assignment material exceeds the text limit for one feedback assessment.',
    'feedback-calls': 'Assessing all the material would exceed the request limit for one feedback assessment.',
    'feedback-context': 'A feedback request could not fit within this model’s estimated context budget.',
  };
  const diagnostic = (e) => ({ ...(Object.hasOwn(REASONS, e?.reason) && { reason: e.reason }),
    ...(['create', 'measure', 'response'].includes(e?.phase) && { phase: e.phase }),
    ...Object.fromEntries(['context', 'tokens', 'actual', 'limit'].filter((k) => Number.isSafeInteger(e?.[k]) && e[k] >= 0 && e[k] <= 10000000).map((k) => [k, e[k]])) });
  const ERRORS = { permission: 'Glaze isn’t allowed to reach this address.', setup: 'Choose a model', off: 'AI is off. Turn it on in Settings → AI.', feature: 'Feedback is off. Turn it on in Settings → AI.',
    timeout: 'Timed out', 'connection-lost': 'Connection lost', 'invalid-response': 'Unreadable answer', check: 'No usable answer', refusal: 'No usable answer',
    'request-rejected': 'Refused', 'provider-unavailable': 'The provider is unavailable and did not report a specific reason.', often: 'Not ready', busy: 'Running', cancelled: 'Cancelled', size: 'The document is too large.', limit: 'The document is too large.' };
  const explain = (e) => REASONS[e?.reason] || ERRORS[e?.error || e?.category] || '';
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
      { code: category, category, ...(status && { status }), reference: id, ...diagnostic(e) });
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
  // Race even work that ignores cancellation. A function is not invoked if already aborted; late rejection is handled.
  const wait = (work, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      if (typeof work !== 'function') Promise.resolve(work).catch(() => {});
      reject(signal.reason); return;
    }
    const stop = () => { signal?.removeEventListener('abort', stop); reject(signal.reason); };
    signal?.addEventListener('abort', stop, { once: true });
    let pending;
    try { pending = typeof work === 'function' ? work() : work; } catch (error) { pending = Promise.reject(error); }
    Promise.resolve(pending).then(resolve, reject).finally(() => signal?.removeEventListener('abort', stop));
  });
  // The bounded call record: area { get, set } (storage.local in the worker), key, record { id, … }: replaces the row with
  // its id (and the one with `was`, a tallied row's id before its last failure renamed it), keeps the last LIMIT.calls.
  // count: the runs a tallied row stands for (ms then their total). model: the model's id at its provider. Never prompts,
  // answers, addresses or keys. A failed
  // write never blocks a call.
  const KEYS = ['id', 'task', 'feature', 'provider', 'model', 'state', 'category', 'status', 'startedAt', 'ms', 'usage', 'steps', 'parts', 'count'];
  // All ports share storage, even when their area wrappers differ. Preserve invocation order, including tally renames.
  let writes = Promise.resolve();
  const record = (area, key, row, was) => {
    const clean = { ...Object.fromEntries(KEYS.filter((k) => row[k] !== undefined).map((k) => [k, row[k]])), ...diagnostic(row) };
    return (writes = writes.then(async () => {
      try {
        const rows = (await area.get(key))[key];
        await area.set({ [key]: [...(Array.isArray(rows) ? rows.filter((r) => r?.id !== clean.id && (was === undefined || r?.id !== was)).slice(-(LIMIT.calls - 1)) : []), clean] });
      } catch { /* Diagnostic metadata must never block a model call. */ }
    }));
  };
  return { CATEGORIES, LIMIT, REASONS, diagnostic, explain, modelFailure, transient, bounded, anySignal, deadline, wait, record, reference };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_FAILURE; else GZ_AI_FAILURE;
