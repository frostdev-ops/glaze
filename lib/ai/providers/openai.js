// The AI harness's `openai` provider (docs/ai-harness.md): any server that speaks OpenAI's Chat Completions
// (POST <base>/chat/completions): OpenAI, OpenRouter, Groq, Ollama, LM Studio, vLLM. cfg: { base (https, or http on this
// computer: the hosts the manifest may be granted), model, key? (sent as a Bearer token, to that server only), images?
// (the student says the model takes pictures), context? (tokens it reads) }.
// Servers differ in what they take, so a request starts with the most it can ask for and steps down on a 400 that names
// the part it refused, remembering what worked for that server and model while the worker runs: response_format
// json_schema, then json_object (the schema then goes in the system message), then none; max_tokens, then
// max_completion_tokens (OpenAI's newer models take only that); a temperature, then none; streamed usage, then none.
// The answer is checked against the schema either way (lib/ai/providers.js run). A server's own error text can carry the
// key back: it is only read to choose a step down, and what a developer sees of it is redacted. Runs in the worker and
// in node (fetch passed in, or the global one) for the eval. Classic script; module.exports for node.
var GZ_AI_OPENAI = globalThis.GZ_AI_OPENAI || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const S = typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('../schema.js');
  const isObj = R.isObj;
  // body: an answer's bytes; error: what is read of a refusal; tries: one request and its steps down.
  const LIMIT = { body: 8 << 20, error: 64 << 10, base: 500, model: 200, key: 512, context: 2e6, tries: 5, status: 15000, modes: 50 };
  const LOCAL = /^(localhost|127\.0\.0\.1)$/;
  const CTRL = /[\p{Cc}\p{Bidi_Control}]/u;

  // → cfg cleaned, or null. A base with no path gets /v1 (http://localhost:11434 is Ollama's /v1).
  const config = (raw) => {
    if (!isObj(raw) || Object.keys(raw).some((k) => !['base', 'model', 'key', 'images', 'context'].includes(k))) return null;
    if (typeof raw.base !== 'string' || raw.base.length > LIMIT.base) return null;
    let u;
    try { u = new URL(raw.base); } catch { return null; }
    if (!(u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL.test(u.hostname))) || u.username || u.password || u.search || u.hash || raw.base.includes('#')) return null;
    const path = u.pathname.replace(/\/+$/, '');
    if (typeof raw.model !== 'string' || !raw.model || raw.model.length > LIMIT.model || raw.model.trim() !== raw.model || CTRL.test(raw.model)) return null;
    if (raw.key !== undefined && raw.key !== '' && (typeof raw.key !== 'string' || raw.key.length > LIMIT.key || !/^[\x21-\x7e]+$/.test(raw.key))) return null;
    if (raw.images !== undefined && typeof raw.images !== 'boolean') return null;
    if (raw.context !== undefined && !(Number.isSafeInteger(raw.context) && raw.context > 0 && raw.context <= LIMIT.context)) return null;
    return { base: u.origin + (path || '/v1'), model: raw.model, ...(raw.key && { key: raw.key }), images: raw.images === true, ...(raw.context && { context: raw.context }) };
  };
  const caps = (cfg) => ({ text: true, images: cfg.images === true, json: true, tools: true, stream: true, ...(cfg.context && { context: cfg.context }) });
  // The host the browser must hold for Glaze to reach the server (the manifest's optional https://*/* and loopback hosts).
  const origin = (cfg) => { const u = new URL(cfg.base); return `${u.protocol}//${u.hostname}/*`; };

  // A server's words, for a developer: the key and anything shaped like one out, and short.
  const redact = (s, cfg) => {
    let t = String(s ?? '');
    if (cfg.key) t = t.split(cfg.key).join('[key]');
    return t.replace(/\b(?:sk|rk|pk|gsk|xai|key)[-_]\S+/gi, '[key]').replace(/\bBearer\s+\S+/gi, 'Bearer [key]').slice(0, 300);
  };
  const failure = (status, text, cfg) => {
    const detail = `${status}: ${redact(text, cfg)}`;
    if (status === 401) return R.error('auth', detail);
    if (status === 403) return R.error('denied', detail);
    if (status === 404) return R.error(/model/i.test(text) ? 'model' : 'endpoint', detail);
    if (status === 408) return R.error('timeout', detail);
    if (status === 413 || (status === 400 && /context.{0,20}length|too long|too many tokens|maximum context/i.test(text))) return R.error('size', detail);
    if (status === 429) return R.error('rate', detail);
    if (status >= 500) return R.error('server', detail);
    return R.error('request', detail);
  };
  // A response's text, up to max bytes (more refuses).
  const read = async (r, max) => {
    const reader = r.body?.getReader();
    if (!reader) return '';
    const parts = [];
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if ((got += value.length) > max) throw R.error('size', 'answer too large');
        parts.push(value);
      }
    } catch (e) { reader.cancel().catch(() => {}); throw e; }
    const all = new Uint8Array(got);
    let at = 0;
    for (const p of parts) { all.set(p, at); at += p.length; }
    return new TextDecoder().decode(all);
  };

  // ---- the request ------------------------------------------------------------------------------------------------------
  const words = (m) => m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n');
  const SAY_JSON = (schema) => `Answer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(schema)}`;
  const messages = (req, mode) => {
    const out = req.messages.map((m) => {
      if (m.role === 'user' && m.content.some((p) => p.type === 'image')) {
        return { role: 'user', content: m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } })) };
      }
      if (m.role === 'assistant' && m.toolCalls) {
        return { role: 'assistant', content: words(m) || null, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}) } })) };
      }
      if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: words(m) };
      return { role: m.role, content: words(m) };
    });
    // Without json_schema, the schema is said in words (and json_object wants the word JSON in a message).
    if (req.schema && mode.format !== 'schema') {
      const sys = out.find((m) => m.role === 'system');
      if (sys) sys.content = `${sys.content}\n\n${SAY_JSON(req.schema)}`; else out.unshift({ role: 'system', content: SAY_JSON(req.schema) });
    }
    return out;
  };
  const body = (req, cfg, mode, stream) => ({
    model: cfg.model,
    messages: messages(req, mode),
    stream,
    ...(stream && mode.usage && { stream_options: { include_usage: true } }),
    ...(req.schema && mode.format === 'schema' && { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: S.strict(req.schema), schema: req.schema } } }),
    ...(req.schema && mode.format === 'object' && { response_format: { type: 'json_object' } }),
    ...(req.tools && { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.params } })) }),
    ...(req.temperature !== undefined && mode.temperature && { temperature: req.temperature }),
    ...(req.maxTokens && { [mode.tokens]: req.maxTokens }),
  });
  // The steps down: [whether this refusal is about that part, the next mode].
  const STEPS = [
    [(t, m, req) => req.schema && m.format === 'schema' && /response_format|json_schema|structured output|schema/i.test(t), (m) => ({ ...m, format: 'object' })],
    [(t, m, req) => req.schema && m.format === 'object' && /response_format|json_object|json mode/i.test(t), (m) => ({ ...m, format: 'none' })],
    [(t, m, req) => req.maxTokens && m.tokens === 'max_tokens' && /max_tokens|max_completion_tokens/i.test(t), (m) => ({ ...m, tokens: 'max_completion_tokens' })],
    [(t, m, req) => req.temperature !== undefined && m.temperature && /temperature/i.test(t), (m) => ({ ...m, temperature: false })],
    [(t, m) => m.usage && /stream_options|include_usage/i.test(t), (m) => ({ ...m, usage: false })],
  ];
  const FIRST = { format: 'schema', tokens: 'max_tokens', temperature: true, usage: true };
  const modes = new Map(); // `${base}\n${model}` → the mode that last worked
  const remember = (k, mode) => { modes.delete(k); modes.set(k, mode); if (modes.size > LIMIT.modes) modes.delete(modes.keys().next().value); };

  // ---- the answer -------------------------------------------------------------------------------------------------------
  const FINISH = { stop: 'stop', length: 'length', tool_calls: 'tool', function_call: 'tool', content_filter: 'filter' };
  const ID = /^[\w.:-]{1,128}$/;
  const args = (s) => { if (typeof s !== 'string') return s ?? null; try { return JSON.parse(s || '{}'); } catch { return s; } };
  const usage = (u) => (isObj(u) && Number.isSafeInteger(u.prompt_tokens) && Number.isSafeInteger(u.completion_tokens) ? { input: u.prompt_tokens, output: u.completion_tokens } : undefined);
  const answer = ({ text, calls, finish, refusal, model, used }) => {
    const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: ID.test(c.id || '') ? c.id : `call_${i}`, name: c.name, args: args(c.args) }));
    return { text, ...(toolCalls.length && { toolCalls }), ...(usage(used) && { usage: usage(used) }), model: typeof model === 'string' ? model : '',
      finish: refusal ? 'refusal' : toolCalls.length ? 'tool' : FINISH[finish] || 'stop' };
  };
  const whole = (j) => {
    const c = Array.isArray(j?.choices) ? j.choices[0] : null;
    if (!isObj(c) || !isObj(c.message)) throw R.error('format', 'no choices');
    const m = c.message;
    const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('') : '';
    const calls = (Array.isArray(m.tool_calls) ? m.tool_calls : []).map((t) => ({ id: t?.id, name: t?.function?.name, args: t?.function?.arguments }));
    return answer({ text, calls, finish: c.finish_reason, refusal: typeof m.refusal === 'string' && m.refusal, model: j.model, used: j.usage });
  };
  // Server-sent events: data lines, an event at each blank line, [DONE] at the end. Text goes to onDelta as it comes; tool
  // calls are put together from their pieces by index.
  const streamed = async (r, onDelta, cfg) => {
    const reader = r.body.getReader(), dec = new TextDecoder();
    const acc = { text: '', calls: [], finish: null, refusal: '', model: '', used: null };
    let buf = '', data = [], got = 0, done = false;
    const event = () => {
      const d = data.join('\n');
      data = [];
      if (!d || done) return;
      if (d === '[DONE]') { done = true; return; }
      let j;
      try { j = JSON.parse(d); } catch { throw R.error('format', 'stream'); }
      if (isObj(j.error)) throw failure(Number(j.error.code) || Number(j.error.status) || 500, JSON.stringify(j.error), cfg);
      if (typeof j.model === 'string') acc.model = j.model;
      if (j.usage) acc.used = j.usage;
      const c = Array.isArray(j.choices) ? j.choices[0] : null;
      if (!isObj(c)) return;
      const delta = isObj(c.delta) ? c.delta : {};
      if (typeof delta.content === 'string' && delta.content) { acc.text += delta.content; onDelta(delta.content); }
      if (typeof delta.refusal === 'string') acc.refusal += delta.refusal;
      for (const t of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const i = Number.isSafeInteger(t?.index) && t.index >= 0 && t.index < R.LIMIT.calls ? t.index : acc.calls.length;
        const x = (acc.calls[i] ||= { id: '', name: '', args: '' });
        if (typeof t.id === 'string') x.id = t.id;
        const name = t.function?.name;
        if (typeof name === 'string' && name !== x.name) x.name += name;
        if (typeof t.function?.arguments === 'string') x.args += t.function.arguments;
      }
      if (c.finish_reason) acc.finish = c.finish_reason;
    };
    try {
      while (!done) {
        const { done: end, value } = await reader.read();
        if (end) break;
        if ((got += value.length) > LIMIT.body) throw R.error('size', 'answer too large');
        buf += dec.decode(value, { stream: true });
        const lines = buf.split(/\r\n|\r|\n/);
        buf = lines.pop();
        for (const line of lines) {
          if (line === '') event();
          else if (line.startsWith('data:')) data.push(line.slice(line[5] === ' ' ? 6 : 5));
        }
      }
      if (buf.startsWith('data:')) data.push(buf.slice(buf[5] === ' ' ? 6 : 5));
      event();
    } finally { reader.cancel().catch(() => {}); }
    return answer({ ...acc, calls: acc.calls });
  };

  const headers = (cfg, stream) => ({ 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', ...(cfg.key && { authorization: `Bearer ${cfg.key}` }) });
  // No cookies, no referrer, no redirect (a redirect would take the key elsewhere).
  const INIT = { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store' };
  const run = async (req, cfg, { signal, onDelta, fetch = globalThis.fetch } = {}) => {
    const k = `${cfg.base}\n${cfg.model}`, stream = typeof onDelta === 'function';
    let mode = modes.get(k) || FIRST;
    for (let i = 0; i < LIMIT.tries; i++) {
      let r;
      try {
        r = await fetch(`${cfg.base}/chat/completions`, { ...INIT, method: 'POST', headers: headers(cfg, stream), body: JSON.stringify(body(req, cfg, mode, stream)), signal });
      } catch (e) { if (signal?.aborted) throw e; throw R.error('network', redact(e?.message, cfg)); }
      if (!r.ok) {
        const text = await read(r, LIMIT.error).catch((e) => { if (signal?.aborted) throw e; return ''; });
        const step = (r.status === 400 || r.status === 422) && STEPS.find(([when]) => when(text, mode, req));
        if (!step) throw failure(r.status, text, cfg);
        mode = step[1](mode);
        continue;
      }
      // A server may answer a stream request with one JSON body.
      const out = stream && /event-stream/i.test(r.headers.get('content-type') || '') ? await streamed(r, onDelta, cfg) : whole(await read(r, LIMIT.body).then((t) => { try { return JSON.parse(t); } catch { throw R.error('format', 'not JSON'); } }));
      remember(k, mode);
      return out;
    }
    throw R.error('request', 'every step down was refused');
  };

  // Whether the server answers with the key and lists the model (GET <base>/models): the Settings page's Test. A server
  // that lists other models but not this one: 'model'.
  const status = async (cfg, { signal, fetch = globalThis.fetch } = {}) => {
    const c = new AbortController(), stop = () => c.abort();
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(stop, LIMIT.status);
    try {
      let r;
      try { r = await fetch(`${cfg.base}/models`, { ...INIT, method: 'GET', headers: headers(cfg, false), signal: c.signal }); } catch { return { state: 'unavailable', reason: c.signal.aborted ? 'timeout' : 'network' }; }
      if (!r.ok) { r.body?.cancel?.().catch(() => {}); return { state: 'unavailable', reason: failure(r.status, '', cfg).code }; }
      let ids = null;
      try { const j = JSON.parse(await read(r, LIMIT.body)); ids = Array.isArray(j?.data) ? j.data.map((m) => m?.id).filter((x) => typeof x === 'string') : null; } catch { /* not a list: the server answered */ }
      return ids?.length && !ids.includes(cfg.model) ? { state: 'unavailable', reason: 'model' } : { state: 'ready' };
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  };

  return P.add({ id: 'openai', config, caps, origin, status, run, redact });
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_OPENAI; else GZ_AI_OPENAI;
