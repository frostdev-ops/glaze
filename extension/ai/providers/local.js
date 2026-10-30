// The AI harness's `local` provider (docs/ai-harness.md "Glaze's own model"): Glaze's own LFM3 model on this computer,
// run by Glaze's WebGPU engine in its host (ai/local/host.js, reached through ai/local/link.js). Nothing goes over the
// network but the weights' download from Hugging Face, and that only from Settings' Download click.
// status() is the worker's own and starts nothing: the browser (Safari keeps Apple Intelligence: unavailable, 'browser'),
// WebGPU, and which model the store holds (ai/local/store.js). The model is the one with the tier Settings' Advanced
// chose, else the one downloaded, else, at Download, the ladder's pick for this computer (host.js). prepare() downloads in
// the host and answers once it is there, or `downloading` after four minutes while it goes on (its progress still reaches
// Settings). run() writes the request as the model's tokens' parts (ai/local/format.js: the fine-tune's format, or a stock
// model's chat template) and streams the answer. Tools and pictures: not taken.
// cfg: { model: MODEL, tier?, context?, images?, generation? }. Classic script; module.exports for node.
var GZ_AI_LOCAL = globalThis.GZ_AI_LOCAL || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const FMT = () => (typeof GZ_AI_LOCAL_FORMAT !== 'undefined' ? GZ_AI_LOCAL_FORMAT : require('../local/format.js'));
  const MODEL = 'glaze-local', NAME = 'Glaze on-device AI';
  // A tier's window (docs/ai-harness.md): every tier reads 16k tokens for now.
  const CONTEXT = 16000, MAX_TOKENS = 1024;
  const LIMIT = { prepare: 240000 };
  const fail = (category, reason, extra = {}) => Object.assign(new Error(`local: ${reason || category}`), { category, ...(reason && { reason }), ...extra });
  const refuse = (code, message) => Object.assign(new Error(message), { code });
  const safari = () => { try { return new URL((typeof globalThis.browser?.runtime?.getURL === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime).getURL('')).protocol === 'safari-web-extension:'; } catch { return false; } };

  // env: { store, link, gpu() } for tests; the worker's own by default.
  let env = null;
  const own = () => env || (env = {
    store: globalThis.GZ_AI_STORE,
    link: globalThis.GZ_AI_LOCAL_LINK.create({ runtime: globalThis.chrome?.runtime, offscreen: globalThis.chrome?.offscreen, clients: globalThis.clients, Worker: globalThis.Worker,
      keep: () => (globalThis.browser?.runtime || globalThis.chrome?.runtime).getPlatformInfo() }),
    gpu: () => globalThis.navigator?.gpu || null,
  });
  // A port from the host page (background/background.js has checked its sender).
  const accept = (port) => own().link.accept(port);

  const config = (raw) => {
    if (!R.isObj(raw) || Object.keys(raw).some((k) => !['model', 'tier', 'context', 'images', 'generation'].includes(k))) return null;
    if (raw.model !== undefined && raw.model !== MODEL) return null;
    if (raw.tier !== undefined && !(Number.isSafeInteger(raw.tier) && raw.tier >= 1 && raw.tier <= 9)) return null;
    if (raw.context !== undefined && !(Number.isSafeInteger(raw.context) && raw.context > 0)) return null;
    if (raw.images !== undefined && typeof raw.images !== 'boolean') return null;
    if (raw.generation !== undefined && (typeof raw.generation !== 'string' || !/^[\w-]{1,64}$/.test(raw.generation))) return null;
    return { model: MODEL, ...(raw.tier && { tier: raw.tier }), ...(raw.context && { context: raw.context }), ...(raw.generation && { generation: raw.generation }) };
  };
  const caps = (cfg) => ({ text: true, json: true, stream: true, tools: false, images: false, local: true, context: Math.min(cfg.context || CONTEXT, CONTEXT) });

  let preparing = null; // the download in the host: { done, listeners, last }
  let broken = null; // a reason the engine gave that holds until a connection changes (release)
  // The store's models, and the one this cfg runs: its tier's, else the one here (ready, then partial).
  const models = async () => (await own().store.list()).filter((m) => m.state !== 'stale');
  const choose = (list, cfg) => (cfg.tier ? list.find((m) => m.tier === cfg.tier) : list.find((m) => m.state === 'ready') || list.find((m) => m.state === 'partial')) || null;
  const where = () => {
    if (safari()) return 'browser';
    const e = own();
    if (!e.link.kind) return 'browser';
    if (!e.gpu()) return 'webgpu';
    return broken;
  };
  // → { state, reason?, size?, tier?, tiers, progress? }: size and tier of the model it runs or would download (the smallest
  // when the ladder hasn't picked yet), tiers each { tier, size }, for Settings' card.
  const status = async (cfg) => {
    const no = where();
    if (no) return { state: 'unavailable', reason: no };
    let list;
    try { list = await models(); } catch { return { state: 'unavailable', reason: 'failed' }; }
    const m = choose(list, cfg) || [...list].sort((a, b) => a.tier - b.tier)[0];
    const about = { ...(m && { size: m.size, tier: m.tier }), tiers: list.map((x) => ({ tier: x.tier, size: x.size })).sort((a, b) => a.tier - b.tier) };
    if (preparing) return { state: 'downloading', ...about, ...(preparing.last !== null && { progress: preparing.last }) };
    return { state: m?.state === 'ready' && choose(list, cfg) ? 'ready' : 'download', ...about };
  };

  // The download, in the host. Callers that ask while it runs join it and hear its progress.
  const prepare = async (cfg, { onProgress } = {}) => {
    const no = where();
    if (no) return { state: 'unavailable', reason: no };
    const listen = typeof onProgress === 'function' ? (p) => { if (Number.isFinite(p)) onProgress(Math.min(1, Math.max(0, p))); } : null;
    if (!preparing) {
      const job = preparing = { listeners: new Set(), last: null };
      job.call = own().link.call('prepare', { ...(cfg.tier && { tier: cfg.tier }) }, { onEvent: (e) => {
        if (e?.type !== 'progress' || !Number.isFinite(e.loaded)) return;
        job.last = e.loaded;
        for (const f of job.listeners) try { f(e.loaded); } catch { /* a listener's own */ }
      } }).then((r) => (R.isObj(r) && ['ready', 'download', 'unavailable'].includes(r.state) ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }) } : { state: 'unavailable', reason: 'failed' }),
        (e) => ({ state: 'unavailable', reason: typeof e?.reason === 'string' ? e.reason : 'failed' }))
        .finally(() => { if (preparing === job) preparing = null; job.listeners.clear(); });
    }
    const job = preparing;
    if (listen) { job.listeners.add(listen); if (job.last !== null) listen(job.last); }
    let timer;
    const late = new Promise((r) => { timer = setTimeout(() => r({ state: 'downloading' }), LIMIT.prepare); timer.unref?.(); });
    try { return await Promise.race([job.call, late]); } finally { clearTimeout(timer); }
  };

  // The model a run or a warm-up uses, ready, with its parts.
  const ready = async (req, cfg) => {
    const no = where();
    if (no) throw fail('provider-unavailable', no);
    const m = choose(await models(), cfg);
    if (!m || m.state !== 'ready') throw fail('provider-unavailable', 'assets');
    return { m, ...FMT().format(req, { dialect: m.stock ? 'chatml' : 'glaze' }) };
  };
  const host = (e) => {
    if (e?.category === 'cancelled') return e;
    if (['engine', 'webgpu', 'hardware'].includes(e?.reason)) broken = e.reason;
    if (typeof e?.code === 'string' && !e.category) return refuse(e.code, 'local host');
    return fail(typeof e?.category === 'string' ? e.category : 'provider-unavailable', typeof e?.reason === 'string' ? e.reason : 'unknown',
      { ...(Number.isSafeInteger(e?.tokens) && { tokens: e.tokens }), ...(Number.isSafeInteger(e?.context) && { context: e.context }) });
  };
  const run = async (req, cfg, { signal, onDelta } = {}) => {
    if (req.tools || req.messages.some((m) => m.role === 'tool' || m.toolCalls)) throw refuse('caps', 'Glaze\'s own model does not take tool calls.');
    if (R.images(req) > 0) throw refuse('caps', 'Glaze\'s own model does not take pictures.');
    let plan;
    try { plan = await ready(req, cfg); } catch (e) { if (e?.code) throw refuse(e.code, e.message); throw e; }
    if (signal?.aborted) throw signal.reason;
    const maxTokens = Math.min(req.maxTokens || MAX_TOKENS, CONTEXT);
    let r;
    try {
      r = await own().link.call('run', { model: plan.m.id, parts: plan.parts, stable: plan.stable, ...(req.schema && { schema: req.schema }),
        sampler: { ...(req.temperature !== undefined && { temperature: req.temperature }) }, maxTokens },
      { signal, onEvent: (e) => { if (e?.type === 'delta' && typeof e.text === 'string' && e.text) onDelta?.(e.text); } });
    } catch (e) { if (signal?.aborted) throw signal.reason; throw host(e); }
    if (!R.isObj(r) || typeof r.text !== 'string') throw fail('invalid-response');
    return { text: r.text, model: MODEL, finish: r.finish === 'stop' ? 'stop' : 'length',
      ...(R.isObj(r.usage) && Number.isSafeInteger(r.usage.input) && { usage: { input: r.usage.input, ...(Number.isSafeInteger(r.usage.output) && { output: r.usage.output }) } }) };
  };
  // A warm-up: the host loads the model and reads the system turn once, kept for the run that follows. Never downloads.
  const warm = async (req, cfg, { signal } = {}) => {
    if (R.images(req) > 0) return false;
    let plan;
    try { plan = await ready(req, cfg); } catch { return false; }
    try { return (await own().link.call('warm', { model: plan.m.id, parts: plan.parts.slice(0, plan.stable) }, { signal }))?.ok === true; } catch { return false; }
  };
  const catalog = async () => ({ models: [{ id: MODEL, name: NAME, json: true, tools: false, vision: false, context: { window: CONTEXT, inputLimit: CONTEXT - CONTEXT / 10 } }], source: 'live', at: Date.now() });
  // A connection changed: the host lets the model go (it loads again at the next run). Starts no host.
  const release = () => { broken = null; const l = own().link; if (l.up) l.call('release').catch(() => {}); };
  // Delete: the downloaded model goes (a download in progress ends), in the host when it is up, else here.
  const remove = async (cfg) => {
    const l = own().link;
    try {
      if (l.up) await l.call('remove');
      else for (const m of await own().store.list()) await own().store.remove(m.id);
    } catch { return { state: 'unavailable', reason: 'failed' }; }
    return status(cfg);
  };

  const provider = { id: 'local', config, caps, status, prepare, run, warm, catalog, release, remove, accept, MODEL, NAME, CONTEXT, LIMIT,
    _env: (e) => { env = e; preparing = null; broken = null; } };
  return P.add(provider);
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOCAL; else GZ_AI_LOCAL;
