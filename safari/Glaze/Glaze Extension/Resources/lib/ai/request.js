// The AI harness's one request and one result (docs/ai-harness.md), whatever the provider. A request:
//   { messages: [{ role: 'system' | 'user' | 'assistant' | 'tool', content: [{ type: 'text', text } | { type: 'image', mime,
//     data (base64) }], toolCalls?: [{ id, name, args }] (assistant), toolCallId? (tool) }],
//     schema? (lib/ai/schema.js, an object at the root), tools?: [{ name, description, parameters }], temperature?,
//     maxTokens?, timeoutMs? }
// A message's content may be given as a string (one text part) and an image's data as bytes (Uint8Array or ArrayBuffer):
// clean() turns them into the form above, which is plain JSON, so it crosses a runtime port and goes into an eval's log as
// it is. A result: { text, json?, toolCalls?, usage?: { input, cached?, cacheWrite?, output? } (Rimeward's names), provider,
// model, finish: 'stop' | 'length' | 'tool' }.
// Everything here may have come from a page, a model or a document, so a cleaner refuses (null) on an unknown key, a wrong
// type, or a count or size over its limit; nothing is truncated. Errors are { code } (CODES): what a page is told, never a
// provider's own words; a model request's failure is one of lib/ai/failure.js CATEGORIES, with a reference.
// Classic script for the worker; module.exports for node.
var GZ_AI_REQUEST = globalThis.GZ_AI_REQUEST || (() => {
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  // A plain object, from this realm or another (a message from a page, a test's): no class instance.
  const isObj = (o) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return false; const p = Object.getPrototypeOf(o); return p === null || Object.getPrototypeOf(p) === null; };
  // chars: all text parts together. image: one picture's base64 (about 6 MB of bytes). args: a tool call's arguments as JSON.
  const LIMIT = { messages: 64, parts: 32, text: 1 << 20, chars: 2e6, images: 8, image: 8 << 20, tools: 32, calls: 16, args: 64 << 10, description: 1024, maxTokens: 32768, timeout: [1000, 300000] };
  const ROLES = ['system', 'user', 'assistant', 'tool'];
  const MIME = { 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/jpeg': [0xff, 0xd8, 0xff], 'image/gif': [0x47, 0x49, 0x46, 0x38], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
  const FINISH = ['stop', 'length', 'tool'];
  // What went wrong, as a page or the eval is told: a model request's failure category (lib/ai/failure.js), then the
  // harness's own refusals: the request, the connection and caps, the broker's (off … often), the tasks' and the loop's.
  const CATEGORIES = ['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'];
  const CODES = [...CATEGORIES, 'request', 'setup', 'caps', 'changed', 'refusal', 'off', 'feature', 'task', 'permission', 'busy', 'often', 'input', 'size', 'check', 'limit', 'steps', 'tool', 'failed'];
  // An error a provider, a task or the broker throws: its code (one of CODES, else 'failed') and, for a developer, detail
  // (a status, the schema's complaints): never shown on a page, and never a key (providers redact it first).
  const error = (code, detail) => Object.assign(new Error(CODES.includes(code) ? code : 'failed'), { code: CODES.includes(code) ? code : 'failed', ...(detail !== undefined && { detail }) });
  // An error as it may leave: its code, or 'cancelled'/'timeout' for an abort, else 'failed'.
  const code = (e) => (CODES.includes(e?.code) ? e.code : CATEGORIES.includes(e?.category) ? e.category : e?.name === 'TimeoutError' ? 'timeout' : e?.name === 'AbortError' ? 'cancelled' : 'failed');

  // ---- bytes ----------------------------------------------------------------------------------------------------------
  // A flat alphabet scan avoids regex-stack growth on multi-megabyte pictures. The length check below supplies the
  // four-character grouping; the final assertion rejects even a trailing newline (unlike $).
  const B64 = /^[A-Za-z0-9+/]*={0,2}(?![\s\S])/;
  const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const head = (data, n = 16) => Uint8Array.from(atob(data.slice(0, Math.ceil(n / 3) * 4)), (c) => c.charCodeAt(0));
  // The picture's type from its first bytes, so a part's mime is what it holds (WebP: RIFF, then WEBP at 8).
  const sniff = (data) => {
    const h = head(data);
    const t = Object.keys(MIME).find((m) => MIME[m].every((b, i) => h[i] === b));
    return t === 'image/webp' && String.fromCharCode(...h.subarray(8, 12)) !== 'WEBP' ? null : t || null;
  };

  // ---- cleaners -------------------------------------------------------------------------------------------------------
  const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : null);
  const ID = /^[\w.:-]{1,128}$/;
  // A tool's name as OpenAI-compatible servers take it, lower case: courses_list.
  const NAME = /^[a-z][a-z0-9_]{0,63}$/;
  const part = (v) => {
    if (!isObj(v)) return null;
    if (v.type === 'text') return Object.keys(v).length === 2 && str(v.text, LIMIT.text) !== null ? { type: 'text', text: v.text } : null;
    if (v.type !== 'image' || Object.keys(v).length !== 3 || !Object.hasOwn(MIME, v.mime)) return null;
    let data = v.data;
    if (data instanceof ArrayBuffer) data = new Uint8Array(data);
    if (data instanceof Uint8Array) data = data.length && data.length <= LIMIT.image * 0.75 ? b64(data) : null;
    if (typeof data !== 'string' || !data.length || data.length > LIMIT.image || data.length % 4 !== 0 || !B64.test(data)) return null;
    return sniff(data) === v.mime ? { type: 'image', mime: v.mime, data } : null;
  };
  // A tool call the model made: { id, name, args }. args is what the model sent, parsed when it was JSON (the loop checks it
  // against the tool's own schema, and tells the model when it doesn't fit).
  const call = (v) => {
    if (!isObj(v) || typeof v.id !== 'string' || !ID.test(v.id) || typeof v.name !== 'string' || v.name.length > 64) return null;
    let size;
    try { size = JSON.stringify(v.args ?? null).length; } catch { return null; }
    return size <= LIMIT.args ? { id: v.id, name: v.name, args: v.args ?? null } : null;
  };
  const list = (v, max, rule) => {
    if (!Array.isArray(v) || v.length > max) return null;
    const out = v.map(rule);
    return out.includes(null) ? null : out;
  };
  const KEYS = ['role', 'content', 'toolCalls', 'toolCallId'];
  const message = (v) => {
    if (!isObj(v) || !ROLES.includes(v.role) || Object.keys(v).some((k) => !KEYS.includes(k))) return null;
    const content = typeof v.content === 'string' ? (str(v.content, LIMIT.text) === null ? null : [{ type: 'text', text: v.content }]) : list(v.content ?? [], LIMIT.parts, part);
    if (!content) return null;
    // Instructions and tool results are words; pictures come from the student's side of the conversation.
    if (v.role !== 'user' && content.some((p) => p.type !== 'text')) return null;
    const out = { role: v.role, content };
    if (v.toolCalls !== undefined) {
      const calls = v.role === 'assistant' && list(v.toolCalls, LIMIT.calls, call);
      if (!calls?.length) return null;
      out.toolCalls = calls;
    }
    if (v.role === 'tool') { if (typeof v.toolCallId !== 'string' || !ID.test(v.toolCallId)) return null; out.toolCallId = v.toolCallId; } else if (v.toolCallId !== undefined) return null;
    return content.length || out.toolCalls ? out : null;
  };
  const tool = (v) => {
    if (!isObj(v) || Object.keys(v).some((k) => !['name', 'description', 'parameters'].includes(k)) || !NAME.test(v.name) || str(v.description, LIMIT.description) === null) return null;
    const parameters = S().clean(v.parameters);
    return parameters && parameters.type === 'object' ? { name: v.name, description: v.description, parameters } : null;
  };
  const OPTS = { temperature: (v) => (Number.isFinite(v) && v >= 0 && v <= 2 ? v : null), maxTokens: (v) => (Number.isSafeInteger(v) && v >= 1 && v <= LIMIT.maxTokens ? v : null),
    timeoutMs: (v) => (Number.isSafeInteger(v) && v >= LIMIT.timeout[0] && v <= LIMIT.timeout[1] ? v : null) };
  // → the request in its one form, or null.
  const clean = (raw) => {
    if (!isObj(raw) || Object.keys(raw).some((k) => !['messages', 'schema', 'tools', ...Object.keys(OPTS)].includes(k))) return null;
    const messages = list(raw.messages, LIMIT.messages, message);
    if (!messages?.some((m) => m.role === 'user')) return null;
    const parts = messages.flatMap((m) => m.content);
    if (parts.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0) > LIMIT.chars || parts.filter((p) => p.type === 'image').length > LIMIT.images) return null;
    // A tool's answer follows the call it answers.
    const asked = new Set();
    for (const m of messages) { for (const c of m.toolCalls || []) asked.add(c.id); if (m.role === 'tool' && !asked.has(m.toolCallId)) return null; }
    const out = { messages };
    if (raw.schema !== undefined) { const s = S().clean(raw.schema); if (!s || s.type !== 'object') return null; out.schema = s; }
    if (raw.tools !== undefined) {
      const tools = list(raw.tools, LIMIT.tools, tool);
      if (!tools || new Set(tools.map((t) => t.name)).size !== tools.length) return null;
      if (tools.length) out.tools = tools;
    }
    for (const [k, rule] of Object.entries(OPTS)) if (raw[k] !== undefined) { const v = rule(raw[k]); if (v === null) return null; out[k] = v; }
    return out;
  };
  const images = (req) => req.messages.reduce((n, m) => n + m.content.filter((p) => p.type === 'image').length, 0);

  // A provider's answer in the one result form: → the result, or null when it isn't one.
  const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const result = (raw) => {
    if (!isObj(raw) || typeof raw.provider !== 'string' || !FINISH.includes(raw.finish)) return null;
    const text = raw.text ?? '';
    if (typeof text !== 'string' || text.length > LIMIT.text) return null;
    const out = { text, provider: raw.provider, model: typeof raw.model === 'string' && raw.model.length <= 200 ? raw.model : '', finish: raw.finish };
    if (raw.toolCalls !== undefined && raw.toolCalls.length) { const calls = list(raw.toolCalls, LIMIT.calls, call); if (!calls) return null; out.toolCalls = calls; }
    if (isObj(raw.usage) && count(raw.usage.input) !== null) {
      out.usage = { input: raw.usage.input };
      for (const k of ['cached', 'cacheWrite', 'output']) if (count(raw.usage[k]) !== null) out.usage[k] = raw.usage[k];
    }
    return out;
  };

  return { LIMIT, ROLES, MIME, FINISH, CATEGORIES, CODES, NAME, error, code, clean, result, images, sniff, b64, isObj };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_REQUEST; else GZ_AI_REQUEST;
