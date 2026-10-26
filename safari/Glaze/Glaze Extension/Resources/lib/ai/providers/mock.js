// The AI harness's `mock` provider, for tests and the eval (docs/ai-harness.md): it answers from a script, so a task, the loop
// or the broker can be run with no model and the same answers every time. The worker never loads it.
// cfg: { replies: [reply] | (request, n) → reply, caps?, status?, seen? }. A reply, taken in order (n counts from 0):
//   { text?, json? (sent as its JSON text), toolCalls?: [{ id, name, args }], deltas?: [text] (streamed, then the text is
//   their join unless given), usage?, finish?, model?, wait? (ms before answering; an abort ends it), error? (a code: thrown
//   as the provider would) }
// cfg.seen gets each request as it came (cleaned), for a test to look at. Classic script; module.exports for node.
var GZ_AI_MOCK = globalThis.GZ_AI_MOCK || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const turns = new WeakMap(); // cfg → replies given
  const config = (raw) => (R.isObj(raw) && (Array.isArray(raw.replies) || typeof raw.replies === 'function') ? raw : null);
  const caps = (cfg) => ({ text: true, images: true, json: true, tools: true, stream: true, ...cfg.caps });
  const status = async (cfg) => cfg.status || { state: 'ready' };
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(t); reject(signal.reason); };
    signal?.addEventListener('abort', stop, { once: true });
  });
  const run = async (req, cfg, { signal, onDelta } = {}) => {
    const n = turns.get(cfg) || 0;
    turns.set(cfg, n + 1);
    if (Array.isArray(cfg.seen)) cfg.seen.push(structuredClone(req));
    const reply = typeof cfg.replies === 'function' ? await cfg.replies(req, n) : cfg.replies[n];
    if (!reply) throw R.error('server', `no reply ${n}`);
    if (reply.wait) await pause(reply.wait, signal);
    if (signal?.aborted) throw signal.reason;
    if (reply.error) throw R.error(reply.error, 'mock');
    for (const d of reply.deltas || []) { if (signal?.aborted) throw signal.reason; onDelta?.(d); await null; }
    const text = reply.text ?? (reply.json !== undefined ? JSON.stringify(reply.json) : (reply.deltas || []).join(''));
    return { text, ...(reply.toolCalls && { toolCalls: reply.toolCalls }), ...(reply.usage && { usage: reply.usage }), model: reply.model || 'mock',
      finish: reply.finish || (reply.toolCalls?.length ? 'tool' : 'stop') };
  };
  return P.add({ id: 'mock', config, caps, status, run });
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_MOCK; else GZ_AI_MOCK;
