// Ported from Rimeward src/lib/agent/accounts.ts (parseEndpointUrl, normalizeEndpoint, mask, credentialGeneration) (MIT).
// The AI harness's connections (docs/ai-harness.md): an endpoint's base address, checked so a key goes only over https or to
// this computer, and the connection's id and generation. Glaze's manifest can be granted plain http only on localhost and
// 127.0.0.1, so those are this computer here (Rimeward takes any loopback spelling). Classic script; module.exports for node.
var GZ_AI_ENDPOINT = globalThis.GZ_AI_ENDPOINT || (() => {
  // A connection's id, as Rimeward names endpoints.
  const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
  const isLoopbackHost = (hostname) => ['localhost', '127.0.0.1'].includes(String(hostname).toLowerCase());
  // The base URL as the student gave it: https (http only to this computer, a local model server), no credentials, no
  // query or fragment; the provider appends /chat/completions and /models. Throws one sentence saying what to fix.
  const parse = (raw) => {
    let url;
    try { url = new URL(String(raw ?? '').trim()); } catch { throw new Error('The endpoint address must be a full address, like https://api.example.com/v1 or http://127.0.0.1:11434/v1.'); }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The endpoint address must start with https://.');
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) throw new Error('A remote endpoint must use https, so a key is never sent in the clear. Plain http is only for a server on this computer (localhost or 127.0.0.1).');
    if (url.username || url.password) throw new Error('Put the key in the key field, not in the address.');
    if (url.search || url.hash) throw new Error('The endpoint address must not have a ? or # part.');
    return url.toString().replace(/\/+$/, '');
  };
  // Glaze's cleaner form: the address, or null.
  const clean = (raw) => { try { return typeof raw === 'string' && raw.length <= 500 ? parse(raw) : null; } catch { return null; } };
  // Non-secret backend identity: scheme, host, explicit port and path, case- and slash-normalised.
  const normalize = (raw) => {
    const text = String(raw ?? '').trim();
    if (!text) return '';
    try {
      const u = new URL(text);
      const dflt = u.protocol === 'https:' ? '443' : u.protocol === 'http:' ? '80' : '';
      const port = u.port && u.port !== dflt ? `:${u.port}` : '';
      return `${u.protocol}//${u.hostname.toLowerCase()}${port}${u.pathname.replace(/\/+$/, '')}`;
    } catch { return text.replace(/\/+$/, ''); }
  };
  const mask = (v) => (v.length <= 8 ? '••••' : `${v.slice(0, 4)}••••${v.slice(-4)}`);
  // A connection's generation: a new random id whenever its address or key changes, or it is removed and made again, so a
  // run admitted on one generation sends nothing once it is replaced.
  const generation = () => crypto.randomUUID();
  // Provider data crosses into pages and caches. Refuse credential echoes in values and object keys, including after
  // structured output has been parsed. Do not attach the rejected value to the error.
  const guard = (value, key) => {
    if (!key) return value;
    const pending = [value], seen = new Set();
    while (pending.length) {
      const v = pending.pop();
      if (typeof v === 'string' && (v.includes(key) || v.replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).includes(key))) {
        throw Object.assign(new Error('Unsafe provider response.'), { category: 'invalid-response' });
      }
      if (v && typeof v === 'object' && !seen.has(v)) { seen.add(v); for (const [k, x] of Object.entries(v)) pending.push(k, x); }
    }
    return value;
  };
  const redact = (value, key) => {
    let text = String(value ?? '');
    if (key) text = text.split(key).join('[key]');
    return text.replace(/\b(?:sk|rk|pk|gsk|xai)[-_]\S+/gi, '[key]').replace(/\bBearer\s+\S+/gi, 'Bearer [key]').slice(0, 300);
  };
  // A fresh error deliberately drops original stacks, causes and arbitrary provider properties.
  const safeError = (error) => {
    const out = new Error('Model request failed.');
    const name = [error?.name, error?.cause?.name].includes('TimeoutError') ? 'TimeoutError' : error?.name;
    if (['AbortError', 'TimeoutError', 'SyntaxError', 'TypeError'].includes(name)) out.name = name;
    if (['cancelled', 'timeout', 'provider-unavailable', 'request-rejected', 'invalid-response', 'connection-lost'].includes(error?.category)) out.category = error.category;
    if (['request', 'setup', 'caps', 'changed', 'refusal', 'permission'].includes(error?.code)) out.code = error.code;
    const status = error?.status ?? error?.cause?.statusCode;
    if (Number.isInteger(status) && status >= 400 && status <= 599) out.status = status;
    return out;
  };
  // Hold only a suffix that could become a credential on the next delta. Safe text still streams immediately.
  const safeStream = (receive, key) => {
    let tail = '';
    return {
      push(text) {
        const value = tail + text;
        guard(value, key);
        let n = key ? Math.min(key.length - 1, value.length) : 0;
        while (n && !key.startsWith(value.slice(-n))) n--;
        tail = n ? value.slice(-n) : '';
        const safe = value.slice(0, value.length - n);
        if (safe) receive?.(safe);
      },
      finish() { if (tail) receive?.(tail); tail = ''; },
    };
  };
  return { ID, isLoopbackHost, parse, clean, normalize, mask, generation, guard, redact, safeError, safeStream };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_ENDPOINT; else GZ_AI_ENDPOINT;
