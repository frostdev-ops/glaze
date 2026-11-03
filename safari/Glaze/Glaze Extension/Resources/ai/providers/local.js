// The AI harness's `local` provider (docs/ai-harness.md "Glaze's own model"): Glaze's own model on this computer, Rime
// (Frostdev's fine-tune of LFM3-1.7B), run by Glaze's WebGPU engine in its host (ai/local/host.js, reached through
// ai/local/link.js). Nothing goes over the network but the weights' download from Hugging Face, from Settings' Download
// click, and, while a model is downloaded, its background updates (ai/local/updates.js).
// status() is the worker's own and starts nothing: the browser (Safari keeps Apple Intelligence: unavailable, 'browser'),
// WebGPU, and which model the store holds (ai/local/store.js). The model is the one with the tier Settings' Advanced
// chose, else the one downloaded, else, at Download, the ladder's pick for this computer (host.js). prepare() downloads in
// the host and answers once it is there, or `downloading` after four minutes while it goes on (its progress still reaches
// Settings). run() writes the request as the model's tokens' parts (ai/local/format.js: the fine-tune's format, or a stock
// model's chat template) and streams the answer; agent.tools in its own turns (format.js turns), the turn held to its answer or
// one offered call and read back as the task's JSON. Tools: not taken. Pictures: only once the picture download (models.json's
// role pictures and its projector; Settings' second Download, part 'pictures') is here: caps.images and the catalog's
// vision say so, and a request with pictures runs on that model (LFM3-VL, stock: its own chat template) in the host, which
// lets the text model go first; the text model's runs bring it back.
// Reasoning: a Glaze-tuned model (no `stock`) thinks before it answers (format.js's think mode, the host's think phase) for the
// tasks and windows limits() permits. Adaptive thought keeps the configured answer and remaining deadline intact;
// its model can end thought early. The 4K direct profile and stock models remain direct.
// cfg: { model: MODEL, tier?, context?, images?, weights?, generation? }; images, what the catalog said, and weights, the store id
// of the text model whose window it gave (the broker sets both): a text request runs on that model only. Classic script;
// module.exports for node.
var GZ_AI_LOCAL = globalThis.GZ_AI_LOCAL || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const FMT = () => (typeof GZ_AI_LOCAL_FORMAT !== 'undefined' ? GZ_AI_LOCAL_FORMAT : require('../local/format.js'));
  const AGENT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('../tasks/agent-tools.js'));
  const TASKS = () => (typeof GZ_AI_TASKS !== 'undefined' ? GZ_AI_TASKS : require('../task.js'));
  const SCHEMA = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('../schema.js'));
  const MODEL = 'glaze-local', NAME = 'Rime';
  // A stock model's window; TUNED, a Glaze-tuned model's (no `stock`): the one its training data was planned for
  // (glaze-plans/lfm-tune FORMAT.md, caps.context 4096), which a request then plans for exactly.
  const CONTEXT = 131072, TUNED = 4096, MAX_TOKENS = 1024;
  const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
  // A tuned model's window is the context size Settings' Advanced keeps on the connection (cfg.window: WINDOWS), else TUNED.
  const WINDOWS = Object.freeze([8192, 16384, 32768, 65536, 131072]);
  const windowOf = (m, cfg = {}) => (m && !m.stock ? { window: cfg.window || TUNED, inputLimit: cfg.window || TUNED } : { window: CONTEXT, inputLimit: Math.floor(CONTEXT * 0.9) });
  // Admission has the catalog's trusted stock marker, while inference also checks the actual model. A context
  // override can narrow the selected window, but cannot enlarge it; stock models retain their own window.
  const profileWindow = (window, cfg = {}) => Math.min(window, cfg.context || window, cfg.reasoning === false ? CONTEXT : cfg.window || TUNED);
  const LIMIT = { prepare: 240000, reasoning: 300000 };
  // Tokens a task's request may reason in before its answer; 0 answers directly. A task with calls (its requests'
  // task.call, ai/task.js ask) has a row per call, and a request without one answers directly. Each row is D4's p3dpo,
  // think against direct at Q4_K_M / Q5_K_M / Q6_K / Q8_0 (glaze-plans/lfm-tune/reports/d4-p3dpo.md "Think versus direct"):
  // agent.tools: direct. p3dpo gained from thought (check() 87→92, 97→95, 95→98, 93→98 %), but r5 thinking ties stock on
  // writes right (58 of 60) at every quant, a strict-gate fail, where direct passes (59; reports/d4-r5-copy-gate.md).
  // study.help: direct; step judged right 70→60, 67→59, 70→64, 71→76 % (Q5_K_M think fails the gate on it).
  // writer.review: direct; planted errors found 88→81, 89→87, 87→85, 88→85 %.
  // writer.feedback decide: direct; status in expected set 93→83, 84→79, 93→86, 91→86 %.
  // writer.feedback explain: direct; status 93→90, 84→80, 93→90, 91→88 %, criteria covered 98→94, 97→95, 96→95, 97→97 %.
  // writer.feedback summary: direct; status and criteria unchanged at every quant, judge 3.63→3.52 at Q4_K_M, ~0.4 s a call.
  // writer.feedback scan: direct; its 49 think-mode training examples (lfm-tune FORMAT-v2) are too few to trust.
  // The rest never trained thought (FORMAT-v2 THINK_TASKS).
  const THINK = Object.freeze({ 'writer.feedback': Object.freeze({ decide: 0, explain: 0, summary: 0, scan: 0 }),
    'writer.review': 0, 'study.help': 0, 'agent.tools': 0,
    'writer.complete': 0, 'writer.outline': 0, 'writer.requirements': 0, 'writer.cite': 0, 'writer.sources': 0, 'writer.decide': 0,
    'syllabus.read': 0, 'writer.image': 0, 'chat.compact': 0 });
  // table: THINK, or a test's own (_env's think).
  const thinkFor = (task, table = env?.think || THINK) => {
    const row = Object.hasOwn(table, task?.id || '') ? table[task.id] : 0;
    return typeof row === 'number' ? row : (typeof task.call === 'string' && Object.hasOwn(row, task.call) ? row[task.call] : 0);
  };
  // The window's size (format.js SIZES, its token after the task's) scales the reasoning and the answer (owner, 2026-11-01).
  // THINK_SIZED: the tasks that reason, per size; the rest answer directly. ANSWER: the answer's reserve per size; a request
  // asking less keeps its own. SCALE: the switches, all off, so Rime r5 and R8 read what they were gated on (no size token,
  // THINK, the request's maxTokens): token sends the size token, answer takes ANSWER, think[task][size] lets that task
  // reason at that size, compact enables chat.compact's new task token. SCALED: a model trained with them (models.json
  // `scale: 1`, R9 on, owner 2026-11-03) gets token, answer and compact; its think switches stay off, adaptive as before.
  // The host caps both budgets by the room left in the window.
  const SIZE = ['4k', '8k', '16k', '32k', '64k', '128k'];
  const bySize = (f) => Object.freeze(Object.fromEntries(SIZE.map((k, i) => [k, f(i)])));
  const REASONS = bySize((i) => [128, 256, 512, 1024, 1024, 1024][i]);
  const THINK_SIZED = Object.freeze({ 'agent.tools': REASONS, 'study.help': REASONS });
  const ANSWER = bySize((i) => [512, 768, 1024, 1536, 2048, 2048][i]);
  const SCALE = Object.freeze({ token: false, answer: false, compact: false, think: Object.freeze({ 'agent.tools': bySize(() => false), 'study.help': bySize(() => false) }) });
  const SCALED = Object.freeze({ ...SCALE, token: true, answer: true, compact: true });
  // A test's own switches (_env's scale), else the model's: SCALED only for a tuned text model declaring exactly scale 1.
  const scaleFor = (m) => env?.scale || (m && !m.stock && !m.role && m.scale === 1 ? SCALED : SCALE);
  // Adaptive reasoning is independent of the experimental size-token/answer tables. The selected window is a
  // ceiling, never a target: the model may close thought immediately. Keep the gated 4K direct profile intact.
  const EFFORT = Object.freeze({ none: 0, minimal: 0.125, low: 0.25, medium: 0.5, high: 1 });
  const adaptive = (task, window, { effort, reasoning = true } = {}) => reasoning !== false && window > TUNED &&
    ['agent.tools', 'study.help'].includes(task?.id) ? Math.floor(Math.min(32768, window / 4) * (EFFORT[effort] ?? 1)) : 0;
  // selected: the models.json entry that runs; without it, the one this cfg ran on in the last list read (admission's reserve).
  const limits = (task, window, { maxTokens, effort, reasoning, promptTokens, scale, selected, ...cfg } = {}) => {
    scale ||= scaleFor(selected || modelOf(listed, cfg));
    const token = FMT().sizeOf(window), key = token && token.slice(9, -2);
    const legacy = key && scale.think?.[task?.id]?.[key] === true && Object.hasOwn(THINK_SIZED, task.id) ? THINK_SIZED[task.id][key] : thinkFor(task);
    const think = effort === 'none' || reasoning === false ? 0 : Math.max(legacy, adaptive(task, window, { effort, reasoning }));
    const answer = key && scale.answer === true ? Math.min(maxTokens || ANSWER[key], ANSWER[key]) : Math.min(maxTokens || MAX_TOKENS, CONTEXT);
    return { size: scale.token === true ? token : null, think: Number.isSafeInteger(promptTokens) ? Math.max(0, Math.min(think, window - promptTokens - answer - (think ? CLOSE : 0))) : think, maxTokens: answer };
  };
  // Unknown hardware gets a conservative allowance; the host rechecks its measured decode pace after prefill and
  // every thought token. The configured answer is reserved in full, both in tokens and in the remaining wall time.
  const FALLBACK_TPS = 15, CLOSE = 2, TIME_GUARD = 2000;
  // Decode tokens a second below which every task answers directly: a full budget then costs at most 256 / 40 = 6.4 s. The
  // ladder's measured machines decode 79 to 133 (ai/local/ladder.js: M5 Pro Q8_0 78.9 to RTX 3080 Ti Q4_K_M 133.2), so each
  // thinks at every tier, with room for a busier GPU; a computer near the ladder's floor (MIN_TPS 15) would wait 17 s.
  const THINK_TPS = 40;
  // RATES: storage.session's { [model id]: tokens a second }, kept across the worker's restarts until the browser closes.
  const RATES = 'aiLocalRates', MEASURED = 'aiLocalMeasured';
  const fail = (category, reason, extra = {}) => Object.assign(new Error(`local: ${reason || category}`), { category, ...(reason && { reason }), ...extra });
  const refuse = (code, message) => Object.assign(new Error(message), { code });
  const safari = () => { try { return new URL((typeof globalThis.browser?.runtime?.getURL === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime).getURL('')).protocol === 'safari-web-extension:'; } catch { return false; } };

  // env: { store, link, gpu(), session? } for tests; the worker's own by default.
  let env = null;
  const own = () => env || (env = {
    store: globalThis.GZ_AI_STORE,
    session: (globalThis.browser?.storage || globalThis.chrome?.storage)?.session || null,
    link: globalThis.GZ_AI_LOCAL_LINK.create({ runtime: globalThis.chrome?.runtime, offscreen: globalThis.chrome?.offscreen, clients: globalThis.clients, Worker: globalThis.Worker,
      keep: () => (globalThis.browser?.runtime || globalThis.chrome?.runtime).getPlatformInfo() }),
    gpu: () => globalThis.navigator?.gpu || null,
  });
  // A port from the host page (background/background.js has checked its sender).
  const accept = (port) => own().link.accept(port);

  const config = (raw) => {
    if (!R.isObj(raw) || Object.keys(raw).some((k) => !['model', 'tier', 'context', 'images', 'weights', 'generation', 'window', 'effort', 'reasoning'].includes(k))) return null;
    if (raw.effort !== undefined && !Object.hasOwn(EFFORT, raw.effort)) return null;
    if (raw.reasoning !== undefined && typeof raw.reasoning !== 'boolean') return null;
    if (raw.window !== undefined && raw.window !== TUNED && !WINDOWS.includes(raw.window)) return null;
    if (raw.model !== undefined && raw.model !== MODEL) return null;
    if (raw.tier !== undefined && !(Number.isSafeInteger(raw.tier) && raw.tier >= 1 && raw.tier <= 9)) return null;
    if (raw.context !== undefined && !(Number.isSafeInteger(raw.context) && raw.context > 0)) return null;
    if (raw.images !== undefined && typeof raw.images !== 'boolean') return null;
    if (raw.weights !== undefined && !(typeof raw.weights === 'string' && ID.test(raw.weights))) return null;
    if (raw.generation !== undefined && (typeof raw.generation !== 'string' || !/^[\w-]{1,64}$/.test(raw.generation))) return null;
    return { model: MODEL, ...(raw.effort !== undefined && { effort: raw.effort }), ...(raw.reasoning !== undefined && { reasoning: raw.reasoning }), ...(raw.tier && { tier: raw.tier }), ...(raw.context && { context: raw.context }), ...(raw.images !== undefined && { images: raw.images }), ...(raw.weights && { weights: raw.weights }), ...(raw.generation && { generation: raw.generation }), ...(WINDOWS.includes(raw.window) && { window: raw.window }) };
  };
  const caps = (cfg) => ({ text: true, json: true, stream: true, tools: false, images: cfg.images === true, local: true, context: Math.min(cfg.context || CONTEXT, Math.max(CONTEXT, cfg.window || 0)) });

  // ---- reasoning ------------------------------------------------------------------------------------------------------
  let rates = null; // model id → decode tokens a second here
  const known = async () => {
    if (rates) return rates;
    let saved = {};
    try { saved = await own().session?.get([RATES, MEASURED]) || {}; } catch { /* none */ }
    if (rates) return rates;
    rates = new Map(Object.entries(R.isObj(saved[RATES]) ? saved[RATES] : {}).filter(([id, v]) => ID.test(id) && Number.isFinite(v) && v > 0));
    for (const id of Array.isArray(saved[MEASURED]) ? saved[MEASURED] : []) if (rates.has(id)) measured.add(id);
    return rates;
  };
  // A measured rate replaces an estimate, and averages with an earlier measure; an estimate never replaces anything.
  const measured = new Set();
  const learn = async (id, rate, { estimate = false } = {}) => {
    if (!ID.test(id || '') || !Number.isFinite(rate) || rate <= 0) return;
    const r = await known();
    if (estimate && r.has(id)) return;
    r.set(id, !estimate && measured.has(id) ? (r.get(id) + rate) / 2 : rate);
    if (!estimate) measured.add(id);
    try { await own().session?.set({ [RATES]: Object.fromEntries(r), [MEASURED]: [...measured] }); } catch { /* kept in memory */ }
  };
  // The same context profile is used by admission, counting and inference; only wall time can reduce its allowance.
  const budget = async (req, m, window, cfg) => {
    const profile = limits(req.task, window, { maxTokens: req.maxTokens, ...cfg, selected: m });
    if (m.stock || !profile.think) return { budget: 0 };
    const rate = (await known()).get(m.id);
    if (!adaptive(req.task, window, cfg)) return { budget: rate >= THINK_TPS ? profile.think : 0 };
    const tps = rate || FALLBACK_TPS, ms = req.timeoutMs || 120000;
    return { budget: Math.max(0, Math.min(profile.think, Math.floor(Math.max(0, ms - TIME_GUARD) / 1000 * tps) - profile.maxTokens)),
      rate: tps, ms, preserveAnswer: true };
  };

  const preparing = { text: null, pictures: null }; // a download in the host: { call, listeners, last }
  let broken = null; // a reason the engine gave that holds until a connection changes (release)
  // The store's text models (the tiers), and the one this cfg runs: its tier's, else the one here (ready, then partial).
  // A saved tier the catalog no longer offers follows Auto, as Settings' picker does.
  let listed = [];
  const models = async () => (listed = (await own().store.list()).filter((m) => m.state !== 'stale'));
  const tiers = (list) => list.filter((m) => !m.role);
  const choose = (list, cfg) => { list = tiers(list); return (cfg.tier && list.find((m) => m.tier === cfg.tier)) || list.find((m) => m.state === 'ready') || list.find((m) => m.state === 'partial') || null; };
  const modelOf = (list, cfg) => cfg.weights ? tiers(list).find((m) => m.id === cfg.weights) : choose(list, cfg);
  // The agent tools the model this cfg runs was trained on (models.json `tools`): 3 from the round that trains Ask Rime's own
  // tools; an entry without a level is 1, Agents' twelve (ai/ask.js offers it no more).
  const levelOf = (list, cfg = {}) => { const m = modelOf(list, cfg); return Number.isSafeInteger(m?.tools) && m.tools > 0 ? m.tools : 1; };
  const toolsLevel = async (cfg = {}) => levelOf(await models(), cfg);
  // Memory is a separate training contract (`memory: 1`), never inferred from tools. Read the same pinned model as a run;
  // a missing capability or a version this harness does not understand cannot enable memory.
  const memoryOf = (list, cfg = {}) => modelOf(list, cfg)?.memory === 1 ? 1 : 0;
  const memoryVersion = async (cfg = {}) => memoryOf(await models(), cfg);
  // Size tokens and per-size answers (SCALED) are a training contract of their own (`scale: 1`), read on the same model.
  const scaleOf = (list, cfg = {}) => (scaleFor(modelOf(list, cfg)) === SCALED ? 1 : 0);
  const scaleVersion = async (cfg = {}) => scaleOf(await models(), cfg);
  // Check the request again on the model selected for this operation: an update may have rolled the same id back since
  // broker admission. These are the two tasks that can carry memory; all other tasks retain their existing formatter.
  const memoryReady = (req, m) => {
    if (!['agent.tools', 'study.help'].includes(req.task?.id)) return false;
    const recall = FMT().parse(req, { images: true }).blocks.some((block) => block.kind === 'data' && block.label === 'recall');
    const tools = !recall && req.task.id === 'agent.tools' && AGENT().fromRequest(req).tools.some((name) => name.startsWith('memory_'));
    if ((recall || tools) && m.memory !== 1) throw refuse('caps', 'This model does not support memory.');
    return recall || tools;
  };
  // The picture download: { model, projector, size, ready } when models.json offers it, else null.
  const pictures = (list) => {
    const model = list.find((m) => m.role === 'pictures'), projector = model && list.find((m) => m.role === 'projector' && m.id === model.projector);
    return projector ? { model, projector, size: model.size + projector.size, ready: model.state === 'ready' && projector.state === 'ready' } : null;
  };
  const where = () => {
    if (safari()) return 'browser';
    const e = own();
    if (!e.link.kind) return 'browser';
    if (!e.gpu()) return 'webgpu';
    return broken;
  };
  // → { state, reason?, size?, tier?, tiers, progress?, pictures?, stale?, caps }: size and tier of the model it runs or would
  // download (the smallest when the ladder hasn't picked yet), tiers each { tier, size }, for Settings' card; pictures, the
  // picture download's { state: 'ready' | 'download' | 'downloading', size, progress? } where models.json offers one; caps,
  // whether pictures can be read now.
  const status = async (cfg) => {
    const no = where();
    // Safari's package carries no models.json (tools/build/safari-drop.txt): nothing to list or delete there.
    if (safari()) return { state: 'unavailable', reason: no };
    let list;
    try { list = await own().store.list(); } catch { return { state: 'unavailable', reason: no || 'failed' }; }
    // A replaced catalog can leave gigabytes here. Delete must remain reachable before another download, even without GPU support.
    const stale = list.some((m) => m.state === 'stale') ? { stale: true } : {};
    if (no) return { state: 'unavailable', reason: no, ...stale };
    list = list.filter((m) => m.state !== 'stale');
    const text = tiers(list), m = choose(list, cfg) || [...text].sort((a, b) => a.tier - b.tier)[0], pics = pictures(list);
    const job = preparing.pictures;
    const about = { ...stale, ...(m && { size: m.size, tier: m.tier }), tiers: text.map((x) => ({ tier: x.tier, size: x.size })).sort((a, b) => a.tier - b.tier),
      ...(pics && { pictures: { state: job ? 'downloading' : pics.ready ? 'ready' : 'download', size: pics.size, ...(job && job.last !== null && { progress: job.last }) } }),
      ...(pics && { caps: { images: pics.ready && !job } }) };
    if (preparing.text) return { state: 'downloading', ...about, ...(preparing.text.last !== null && { progress: preparing.text.last }) };
    return { state: m?.state === 'ready' && choose(list, cfg) ? 'ready' : 'download', ...about };
  };

  // A download, in the host: the text model (its tier's, or the ladder's pick), or with part 'pictures' the picture
  // download. Callers that ask while one runs join it and hear its progress.
  const prepare = async (cfg, { onProgress, part } = {}) => {
    const no = where();
    if (no) return { state: 'unavailable', reason: no };
    const listen = typeof onProgress === 'function' ? (p) => { if (Number.isFinite(p)) onProgress(Math.min(1, Math.max(0, p))); } : null;
    const which = part === 'pictures' ? 'pictures' : 'text';
    if (!preparing[which]) {
      const job = preparing[which] = { listeners: new Set(), last: null };
      job.call = own().link.call('prepare', which === 'pictures' ? { part: 'pictures' } : { ...(cfg.tier && { tier: cfg.tier }) }, { onEvent: (e) => {
        if (e?.type !== 'progress' || !Number.isFinite(e.loaded)) return;
        job.last = e.loaded;
        for (const f of job.listeners) try { f(e.loaded); } catch { /* a listener's own */ }
      } }).then(async (r) => {
        if (R.isObj(r) && typeof r.model === 'string' && Number.isFinite(r.tps)) await learn(r.model, r.tps, { estimate: true });
        return R.isObj(r) && ['ready', 'download', 'unavailable'].includes(r.state) ? { state: r.state, ...(typeof r.reason === 'string' && { reason: r.reason }) } : { state: 'unavailable', reason: 'failed' };
      },
        (e) => ({ state: 'unavailable', reason: typeof e?.reason === 'string' ? e.reason : 'failed' }))
        .finally(() => { if (preparing[which] === job) preparing[which] = null; job.listeners.clear(); });
    }
    const job = preparing[which];
    if (listen) { job.listeners.add(listen); if (job.last !== null) listen(job.last); }
    let timer;
    const late = new Promise((r) => { timer = setTimeout(() => r({ state: 'downloading' }), LIMIT.prepare); timer.unref?.(); });
    try { return await Promise.race([job.call, late]); } finally { clearTimeout(timer); }
  };

  // The model a run or a warm-up uses, ready, with its parts: a request with pictures, the picture model and its
  // projector (both here, else reason 'pictures'), in its own chat template; any other, the text model.
  const ready = async (req, cfg) => {
    const no = where();
    if (no) throw fail('provider-unavailable', no);
    const list = await models();
    if (R.images(req) > 0) {
      const pics = pictures(list);
      if (!pics) throw refuse('caps', 'Glaze\'s own model does not take pictures.');
      if (!pics.ready || preparing.pictures) throw fail('provider-unavailable', 'pictures');
      const memory = memoryReady(req, pics.model);
      return { m: pics.model, ...(memory && { memory: 1 }), window: Math.min(cfg.context || CONTEXT, CONTEXT), projector: pics.projector.id, ...FMT().format(req, { dialect: 'chatml', images: true }) };
    }
    const m = modelOf(list, cfg);
    if (!m || m.state !== 'ready') throw fail('provider-unavailable', 'assets');
    const memory = memoryReady(req, m);
    const window = Math.min(cfg.context || windowOf(m, cfg).window, windowOf(m, cfg).window);
    const reasoning = await budget(req, m, window, cfg), think = reasoning.budget, sized = !m.stock && limits(req.task, window, { selected: m }).size;
    // r5 and R8 never trained chat.compact's task token: the native prompt unless the model's scale enables it.
    const native = m.stock || (req.task?.id === 'chat.compact' && scaleFor(m).compact !== true);
    return { m, ...(memory && { memory: 1 }), window, reasoning, budget: think, ...FMT().format(req, { dialect: native ? 'chatml' : 'glaze', think: !m.stock && (adaptive(req.task, window, cfg) > 0 || think > 0), ...(sized && { window }) }) };
  };
  const host = (e) => {
    if (e?.category === 'cancelled') return e;
    if (['engine', 'webgpu', 'hardware'].includes(e?.reason)) broken = e.reason;
    if (typeof e?.code === 'string' && !e.category) return refuse(e.code, 'local host');
    return fail(typeof e?.category === 'string' ? e.category : 'provider-unavailable', typeof e?.reason === 'string' ? e.reason : 'unknown',
      { ...(Number.isSafeInteger(e?.tokens) && { tokens: e.tokens }), ...(Number.isSafeInteger(e?.context) && { context: e.context }) });
  };
  // The task's own schema with its spans (ai/schema.js span; a request carries it bare) and the text of each data block a
  // span names (its label, or a split part's "<label> part …"), as the model reads it: { schema, sources }, or null when the
  // request's schema isn't the task's or no such block is there.
  const spans = (req) => {
    const S = SCHEMA(), out = req.schema && req.task && TASKS().get(req.task.id)?.output;
    if (!S.isObj(out) || S.bare(out) === out || JSON.stringify(S.bare(out)) !== JSON.stringify(req.schema)) return null;
    const names = new Set();
    const walk = (s) => { if (!S.isObj(s)) return; if (S.isObj(s.span)) names.add(s.span.source); Object.values(s.properties || {}).forEach(walk); walk(s.items); (s.anyOf || []).forEach(walk); };
    walk(out);
    let blocks;
    try { blocks = FMT().parse(req, { images: true }).blocks.filter((b) => b.kind === 'data'); } catch { return null; }
    const sources = Object.fromEntries([...names].flatMap((n) => {
      const hit = blocks.filter((b) => b.label === n || b.label.startsWith(`${n} part `));
      return hit.length === 1 ? [[n, hit[0].text]] : [];
    }));
    return Object.keys(sources).length ? { schema: out, sources } : null;
  };
  const run = async (req, cfg, { signal, onDelta } = {}) => {
    if (req.tools || req.messages.some((m) => m.role === 'tool' || m.toolCalls)) throw refuse('caps', 'Glaze\'s own model does not take tool calls.');
    const started = Date.now();
    let plan;
    try { plan = await ready(req, cfg); } catch (e) { if (e?.code) throw refuse(e.code, e.message); throw e; }
    if (signal?.aborted) throw signal.reason;
    const maxTokens = plan.projector || plan.m.stock ? Math.min(req.maxTokens || MAX_TOKENS, CONTEXT) : limits(req.task, plan.window, { maxTokens: req.maxTokens, ...cfg, selected: plan.m }).maxTokens;
    let r;
    try {
      // A task in its own turns (agent.tools) is held to its answer's schema or one offered call (format.js constraint); a
      // span to words of its source (spans).
      const held = plan.constraint ? { schema: plan.constraint.schema, tools: plan.constraint.tools } : req.schema && (spans(req) || { schema: req.schema });
      r = await own().link.call('run', { model: plan.m.id, ...(plan.memory && { memory: plan.memory }), parts: plan.parts, stable: plan.stable, ...(plan.images && { projector: plan.projector, images: plan.images }), ...held,
        ...(plan.think && { think: { budget: plan.budget, ...plan.think, ...(plan.reasoning.preserveAnswer && { preserveAnswer: true, rate: plan.reasoning.rate, ms: Math.max(0, plan.reasoning.ms - (Date.now() - started)) }) } }), window: plan.window, ...(req.task?.id === 'writer.complete' && { priority: 'low' }),
        sampler: { ...(req.temperature !== undefined && { temperature: req.temperature }) }, maxTokens },
      { signal, onEvent: (e) => { if (e?.type === 'delta' && typeof e.text === 'string' && e.text) onDelta?.(e.text); } });
    } catch (e) { if (signal?.aborted) throw signal.reason; throw host(e); }
    if (!R.isObj(r) || typeof r.text !== 'string') throw fail('invalid-response');
    if (!plan.projector && Number.isFinite(r.rate)) await learn(plan.m.id, r.rate);
    // Its turn in LFM3's own syntax (a native call, or the answer's JSON) read back as the task's JSON.
    const native = plan.constraint && AGENT().fromNative(r.text);
    if (plan.constraint && native === undefined) throw fail('invalid-response', 'native');
    return { text: plan.constraint ? JSON.stringify(native) : r.text, model: MODEL, finish: r.finish === 'stop' ? 'stop' : 'length',
      ...(R.isObj(r.usage) && Number.isSafeInteger(r.usage.input) && { usage: { input: r.usage.input, ...(Number.isSafeInteger(r.usage.output) && { output: r.usage.output }),
        ...(Number.isSafeInteger(r.usage.cached) && r.usage.cached >= 0 && r.usage.cached <= r.usage.input && { cached: r.usage.cached }) } }) };
  };
  // count(req, cfg) → the request's prompt tokens, counted by the host with the model's own tokenizer (host.js count).
  const count = async (req, cfg, { signal } = {}) => {
    if (R.images(req) > 0) return null;
    const plan = await ready(req, cfg);
    const r = await own().link.call('count', { model: plan.m.id, ...(plan.memory && { memory: plan.memory }), parts: plan.parts }, { signal });
    return Number.isSafeInteger(r?.tokens) ? r.tokens : null;
  };
  // A warm-up: the host keeps the system turn and reads the history while the student types. Never downloads.
  const warm = async (req, cfg, { signal } = {}) => {
    if (R.images(req) > 0) return false;
    let plan;
    try { plan = await ready(req, cfg); } catch { return false; }
    try { return (await own().link.call('warm', { model: plan.m.id, ...(plan.memory && { memory: plan.memory }), parts: plan.parts, stable: plan.stable, window: plan.window }, { signal }))?.ok === true; } catch { return false; }
  };
  // vision: whether the picture download is here (the broker sets cfg.images from it for a run). context: the window of the
  // text model this cfg runs, and weights its id (the broker sets cfg.context and cfg.weights from them); pictures.context,
  // the picture model's, for a task that only reads pictures.
  const catalog = async (cfg = {}) => {
    let list = [];
    try { list = await models(); } catch { /* none */ }
    const m = choose(list, cfg), pics = pictures(list), vision = !preparing.pictures && !!pics?.ready;
    return { models: [{ id: MODEL, name: NAME, json: true, tools: false, vision, context: windowOf(m, cfg), ...(m && { weights: m.id, reasoning: !m.stock }),
      ...(vision && { pictures: { context: windowOf(pics.model) } }) }], source: 'live', at: Date.now() };
  };
  // A connection changed: the host lets the model go (it loads again at the next run). Starts no host.
  const release = () => { broken = null; const l = own().link; if (l.up) l.call('release').catch(() => {}); };
  // Delete: every downloaded model goes (a download in progress ends), or with part 'pictures' the picture download only,
  // in the host when it is up, else here.
  const remove = async (cfg, { part } = {}) => {
    const l = own().link, only = part === 'pictures';
    try {
      if (l.up) await l.call('remove', only ? { part: 'pictures' } : {});
      else for (const m of await own().store.list()) if (!only || m.role) await own().store.remove(m.id);
    } catch { return { state: 'unavailable', reason: 'failed' }; }
    return status(cfg);
  };

  // The engine host's link, for the background model updates (ai/local/updates.js check).
  const link = () => own().link;
  const provider = { id: 'local', config, caps, status, prepare, run, warm, count, catalog, release, remove, accept, levelOf, toolsLevel, memoryOf, memoryVersion, scaleOf, scaleVersion, link, windowOf, WINDOWS, MODEL, NAME, CONTEXT, TUNED, LIMIT, THINK, THINK_TPS, thinkFor,
    THINK_SIZED, ANSWER, SCALE, SCALED, limits, adaptive, profileWindow, CLOSE,
    _env: (e) => { env = e; listed = []; preparing.text = preparing.pictures = null; broken = null; rates = null; measured.clear(); } };
  return P.add(provider);
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOCAL; else GZ_AI_LOCAL;
