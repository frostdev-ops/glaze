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
  return { ID, isLoopbackHost, parse, clean, normalize, mask, generation };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_ENDPOINT; else GZ_AI_ENDPOINT;
