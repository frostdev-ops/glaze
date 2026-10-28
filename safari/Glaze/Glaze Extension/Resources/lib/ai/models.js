// Ported from Rimeward src/lib/agent/openrouter.ts (listCompatModels, listOpenRouterCatalog), context.ts (openrouterContext)
// and models.ts (validateSelection) (MIT). The AI harness's model catalog (docs/ai-harness.md): which models a connection
// serves and, where the catalog says, what each takes. An OpenAI-compatible server's GET <base>/models gives ids only, and
// nothing about capabilities is invented; OpenRouter's public catalog (no key sent) says tools, pictures, JSON output and
// context. A list is kept an hour in memory and the last good one in the worker's store, so a blink is served from cache.
// Provenance: source 'live' | 'cache' | 'none'; a model a live list doesn't name is refused, one no list can vouch for is
// used as typed and marked unverified; a capability no catalog states is absent, never false. A model's reasoning efforts
// (lib/ai/request.js EFFORTS it takes) come from the catalog where it says (OpenRouter's reasoning, DeepSeek's effort,
// xAI's capabilities), else from what a provider's docs say of a model by name (RULES); none known, none offered.
// Classic script; node exports.
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
  const host = (base) => { try { return new URL(base).hostname; } catch { return ''; } };
  const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high']; // lib/ai/request.js EFFORTS
  const known = (list) => EFFORTS.filter((e) => list.includes(e));
  // OpenRouter's reasoning (a model that doesn't reason has none): no supported_efforts, no efforts; null, every one; a
  // model that must reason takes no 'none' (its 400: "Reasoning is mandatory").
  const routed = (r) => {
    if (!r || typeof r !== 'object' || !Array.isArray(r.supported_efforts) && r.supported_efforts !== null) return [];
    return (r.supported_efforts === null ? EFFORTS : known(r.supported_efforts)).filter((e) => e !== 'none' || r.mandatory !== true);
  };
  // What a server's own list says beyond the id: DeepSeek's effort levels (thinking on; 'none' turns it off and is never
  // listed), xAI's capabilities, Anthropic's display name.
  const stated = (base, m) => {
    const h = host(base);
    if (h === 'api.deepseek.com' && Array.isArray(m.effort?.supported_levels)) return { efforts: known(['none', ...m.effort.supported_levels]) };
    if (h === 'api.x.ai' && Array.isArray(m.capabilities?.reasoning_effort)) return { efforts: known(m.capabilities.reasoning_effort) };
    if (h === 'api.anthropic.com' && typeof m.display_name === 'string') return { name: m.display_name.slice(0, 200) };
    return {};
  };
  // The efforts a model takes by name, where the provider's docs say and its list doesn't (2026-10): OpenAI's GPT-5 takes
  // minimal to high and 5.1 none to high, its other reasoning models low to high; Gemini's 2.5 Flash none to high, its
  // other thinking models minimal to high (Pro and 3 can't stop thinking); xAI's Grok 4.5 to 4.7 low to high; Groq's
  // gpt-oss low to high. Anthropic's compatible endpoint ignores reasoning_effort, and Mistral's reasoning answers in
  // parts the stream doesn't read, so neither offers one.
  const RULES = {
    'api.openai.com': [[/^gpt-5\.1(?![\d])/, ['none', 'low', 'medium', 'high']], [/^gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/, ['minimal', 'low', 'medium', 'high']],
      [/^(?:o[134](?:-mini|-pro)?|gpt-5|gpt-6)(?![\w.]*-chat)/, ['low', 'medium', 'high']]],
    'generativelanguage.googleapis.com': [[/^gemini-2\.5-flash/, ['none', 'minimal', 'low', 'medium', 'high']], [/^gemini-(?:2\.5-pro|[34])/, ['minimal', 'low', 'medium', 'high']]],
    'api.x.ai': [[/^grok-4\.[5-7]/, ['low', 'medium', 'high']]],
    'api.groq.com': [[/^openai\/gpt-oss-/, ['low', 'medium', 'high']]],
  };
  // efforts(base, model id, the catalog's entry?) → the EFFORTS it takes, [] when none is known.
  const efforts = (base, id, entry) => {
    if (Array.isArray(entry?.efforts)) return entry.efforts;
    const rule = typeof id === 'string' && (RULES[host(base)] || []).find(([re]) => re.test(id.replace(/^models\//, '')));
    return rule ? rule[1] : [];
  };
  // A server whose list wants more than a Bearer key: Anthropic's (its own headers, and every model on one page).
  const listing = (cfg) => (host(cfg.base) === 'api.anthropic.com'
    ? { url: `${cfg.base}/models?limit=1000`, headers: { ...(cfg.key && { 'x-api-key': cfg.key }), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' } }
    : { url: `${cfg.base}/models`, headers: cfg.key ? { authorization: `Bearer ${cfg.key}` } : {} });
  const memory = new Map(); // revision → { at, list }
  // cfg: { base, key?, generation? }; env: { fetch, cache?: { get(k), set(k, v) }, now? } → { models: [{ id, name, context?, efforts?,
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
      const ask = !shared && listing(cfg);
      const res = await F().wait(() => fetch(shared ? OPENROUTER : ask.url, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store',
        headers: { accept: 'application/json', ...ask.headers }, signal: s.signal }), s.signal);
      s.signal.throwIfAborted();
      if (!res.ok) { res.body?.cancel?.().catch(() => {}); throw Object.assign(new Error(`models ${res.status}`), { status: res.status }); }
      const data = E().guard(JSON.parse(await F().wait(() => F().bounded(res, BODY), s.signal)), cfg.key);
      s.signal.throwIfAborted();
      const models = (Array.isArray(data?.data) ? data.data : []).filter((m) => typeof m?.id === 'string' && m.id.length <= 200).map((m) => {
        if (!shared) return { id: m.id, name: m.id, ...stated(cfg.base, m) };
        const params = m.supported_parameters, inputs = m.architecture?.input_modalities, c = context(m);
        return { id: m.id, name: typeof m.name === 'string' ? m.name.slice(0, 200) : m.id, ...(c && { context: c }),
          ...(Array.isArray(params) && { tools: params.includes('tools'), json: params.includes('response_format') || params.includes('structured_outputs'), efforts: routed(m.reasoning) }),
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
  return { TTL, OPENROUTER, context, list, select, efforts, isOpenRouter, _reset: () => memory.clear() };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_MODELS; else GZ_AI_MODELS;
