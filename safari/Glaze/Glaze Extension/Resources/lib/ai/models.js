// Ported from Rimeward src/lib/agent/openrouter.ts (listCompatModels, listOpenRouterCatalog), context.ts (openrouterContext)
// and models.ts (validateSelection) (MIT). The AI harness's model catalog (docs/ai-harness.md): which models a connection
// serves and, where the catalog says, what each takes. An OpenAI-compatible server's GET <base>/models gives ids only, and
// nothing about capabilities is invented; OpenRouter's public catalog (no key sent) says tools, pictures, JSON output and
// context. A list is kept an hour in memory and the last good one in the worker's store, so a blink is served from cache.
// Provenance: source 'live' | 'cache' | 'none'; a model a live list doesn't name is refused, one no list can vouch for is
// used as typed and marked unverified; a capability no catalog states is absent, never false. Classic script; node exports.
var GZ_AI_MODELS = globalThis.GZ_AI_MODELS || (() => {
  const F = () => (typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js'));
  const E = () => (typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('./endpoint.js'));
  const TTL = 3600000, TIMEOUT = 10000, BODY = 10 << 20;
  const OPENROUTER = 'https://openrouter.ai/api/v1/models';
  const positive = (n) => (typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : undefined);
  // Token limits the catalog reports, never inferred from a name: the smallest window it states, ten percent kept for the
  // reply (bounded by the advertised output ceiling).
  const context = (m) => {
    const limits = [positive(m.context_length), positive(m.top_provider?.context_length)].filter((n) => n !== undefined);
    if (!limits.length) return undefined;
    const window = Math.min(...limits);
    const reserve = Math.min(Math.ceil(window * 0.1), positive(m.top_provider?.max_completion_tokens) ?? Infinity);
    return { window, inputLimit: window - reserve };
  };
  const isOpenRouter = (base) => { try { return new URL(base).hostname === 'openrouter.ai'; } catch { return false; } };
  const memory = new Map(); // revision → { at, list }
  // cfg: { base, key?, generation? }; env: { fetch, cache?: { get(k), set(k, v) }, now? } → { models: [{ id, name, context?,
  // tools?, vision?, json? }], source: 'live' | 'cache', at }. Throws when there is neither a live nor a kept list.
  const list = async (cfg, { fetch, cache, now = Date.now, signal } = {}) => {
    signal?.throwIfAborted();
    const shared = isOpenRouter(cfg.base);
    const revision = shared ? 'openrouter' : `${E().normalize(cfg.base)}\n${cfg.generation || ''}`;
    const kept = memory.get(revision);
    if (kept && now() - kept.at < TTL) return E().guard(kept.list, cfg.key);
    const store = `models:${shared ? 'openrouter' : cfg.generation || E().normalize(cfg.base)}`;
    const t = F().deadline(TIMEOUT), s = F().anySignal([signal, t.signal]);
    try {
      // The catalog is public: no key goes to it, whoever's connection asks.
      const res = await F().wait(() => fetch(shared ? OPENROUTER : `${cfg.base}/models`, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
        headers: { accept: 'application/json', ...(!shared && cfg.key && { authorization: `Bearer ${cfg.key}` }) }, signal: s.signal }), s.signal);
      s.signal.throwIfAborted();
      if (!res.ok) { res.body?.cancel?.().catch(() => {}); throw Object.assign(new Error(`models ${res.status}`), { status: res.status }); }
      const data = E().guard(JSON.parse(await F().wait(() => F().bounded(res, BODY), s.signal)), cfg.key);
      s.signal.throwIfAborted();
      const models = (Array.isArray(data?.data) ? data.data : []).filter((m) => typeof m?.id === 'string' && m.id.length <= 200).map((m) => {
        if (!shared) return { id: m.id, name: m.id };
        const params = m.supported_parameters, inputs = m.architecture?.input_modalities, c = context(m);
        return { id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 200) : m.id, ...(c && { context: c }),
          ...(Array.isArray(params) && { tools: params.includes('tools'), json: params.includes('response_format') || params.includes('structured_outputs') }),
          ...(Array.isArray(inputs) && { vision: inputs.includes('image') }) };
      }).sort((a, b) => a.id.localeCompare(b.id));
      if (!models.length) throw new Error('empty model list');
      const out = { models, source: 'live', at: now() };
      await F().wait(() => Promise.resolve(cache?.set(store, { at: out.at, models })).catch(() => {}), s.signal);
      s.signal.throwIfAborted();
      memory.set(revision, { at: out.at, list: out });
      return out;
    } catch (err) {
      if (s.signal.aborted) throw E().safeError(s.signal.reason, cfg.key);
      const last = await F().wait(() => Promise.resolve(cache?.get(store)).catch(() => null), s.signal);
      s.signal.throwIfAborted();
      if (!Array.isArray(last?.models) || !last.models.length) throw E().safeError(err, cfg.key);
      return E().guard({ models: last.models, source: 'cache', at: last.at || 0 }, cfg.key);
    } finally { t.done(); s.done(); }
  };
  // Check a model before a run: an id a live list doesn't name is refused; a stale or missing list marks it unverified; a
  // model the catalog says can't take tools or pictures the run needs is refused; nothing is ever substituted. Throws one
  // sentence, with code 'setup' or 'caps'. catalog: list()'s answer, or null when none could be had. → { model, unverified?, caps }.
  const select = (model, catalog, needs = {}) => {
    const no = (code, why) => Object.assign(new Error(why), { code });
    if (typeof model !== 'string' || !model || model.length > 200) throw no('setup', 'Pick a model for this connection.');
    const known = catalog?.models.find((m) => m.id === model);
    if (!known && catalog?.source === 'live') throw no('setup', `This connection does not list a model "${model}". Pick one of the models it lists.`);
    if (needs.tools && known?.tools === false) throw no('caps', `"${model}" does not take tool calls. Pick a model that does.`);
    if (needs.images && known?.vision === false) throw no('caps', `"${model}" does not take pictures. Pick a vision model.`);
    const caps = { ...(known?.tools !== undefined && { tools: known.tools }), ...(known?.vision !== undefined && { images: known.vision }), ...(known?.json !== undefined && { json: known.json }),
      ...(known?.context && { context: known.context.inputLimit }) };
    return { model, ...(!known && { unverified: true }), caps };
  };
  return { TTL, OPENROUTER, context, list, select, isOpenRouter, _reset: () => memory.clear() };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_MODELS; else GZ_AI_MODELS;
