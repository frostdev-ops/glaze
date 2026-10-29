// The MCP protocol engine: JSON-RPC lines in and out for each agent app's connection, in both eras of the spec
// (https://modelcontextprotocol.io/specification/2026-07-28, and 2025-11-25 / 2025-06-18 for clients that send initialize).
// - Modern (2026-07-28) is stateless: every request names its version and client capabilities in _meta. server/discover,
//   tools/list (sorted by name, 50 a page, cached privately), tools/call, and subscriptions/listen for toolsListChanged.
// - Legacy is the initialize handshake, ping, tools/list, tools/call and notifications/tools/list_changed.
// The first request served fixes a connection's era: initialize means legacy, a request with the modern protocolVersion in
// _meta means modern. server/discover and invalid request metadata fix nothing, so a client told our versions can choose.
// Tools only: resources, prompts and the rest are unknown methods. The engine answers; it never asks the client anything.
//
// create({ serverInfo: {name, version}, instructions?, list() → [MCP Tool], listHash() → string, call(c) → Promise })
//   call gets { conn, peer, client, name, args, meta, progress(progress, total?, message?), signal } and answers
//   { content, structuredContent?, isError? }, or { rpcError: { code, message, data? } } for a JSON-RPC error.
// → { conn(id, peer, send(line), end?(why)) → { line(text), close(why), changed(), snapshot(), restore(snap) } }
//   send gets one JSON message without its newline. end(why) is the engine closing a connection itself (a line over 1 MiB);
//   close(why) is the caller closing one: open subscriptions end gracefully and calls are aborted. changed() tells
//   listeners when listHash() has moved. snapshot() and restore() carry a connection over a worker restart; calls in
//   flight are lost, as the spec allows.
//
// Pure: no extension APIs and no timers. Classic script for the worker (loaded with the rest of lib/mcp on first use);
// module.exports for node.
var GZ_MCP_WIRE = globalThis.GZ_MCP_WIRE || (() => {
  const MODERN = '2026-07-28', LEGACY = ['2025-11-25', '2025-06-18'];
  const SUPPORTED = [MODERN, ...LEGACY];
  // The most a line may be, in UTF-8 bytes; how long a list stays fresh; tools in a page; open subscriptions a connection may hold.
  const MAX = 1 << 20, TTL = 60e3, PAGE = 50, SUBS = 16;
  const NS = 'io.modelcontextprotocol/';
  const KEY = { version: `${NS}protocolVersion`, caps: `${NS}clientCapabilities`, client: `${NS}clientInfo`, server: `${NS}serverInfo`, sub: `${NS}subscriptionId` };
  const CAPS = { tools: { listChanged: true } };
  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const isId = (x) => typeof x === 'string' || Number.isInteger(x);
  const te = new TextEncoder();
  const tooBig = (s) => s.length > MAX || (s.length * 3 > MAX && te.encode(s).length > MAX);
  const short = (s) => typeof s === 'string' && s.length <= 256;
  // An Implementation as the engine keeps it ({ name, version, title? }), or null when it isn't one.
  const info = (x) => (isObj(x) && short(x.name) && short(x.version) && (x.title === undefined || short(x.title))
    ? { name: x.name, version: x.version, ...(x.title !== undefined && { title: x.title }) } : null);
  // The list's fingerprint in a cursor (FNV-1a), so a cursor from a list that has since changed is refused.
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); return (h >>> 0).toString(36); };
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // A snapshot restore() takes: what snapshot() gives, through JSON.
  const valid = (s) => isObj(s) && s.v === 1 && [null, 'modern', 'legacy'].includes(s.era)
    && (s.era === 'legacy' ? LEGACY.includes(s.version) && !!info(s.client) : s.version === null && s.client === null)
    && typeof s.ready === 'boolean' && typeof s.hash === 'string' && Array.isArray(s.subs) && s.subs.length <= (s.era === 'modern' ? SUBS : 0)
    && s.subs.every((x) => isObj(x) && isId(x.id) && typeof x.tools === 'boolean') && new Set(s.subs.map((x) => x.id)).size === s.subs.length;

  const create = (o) => {
    const d = isObj(o) ? o : {};
    const server = info(d.serverInfo);
    const why = !server ? 'serverInfo' : typeof d.list !== 'function' ? 'list' : typeof d.listHash !== 'function' ? 'listHash'
      : typeof d.call !== 'function' ? 'call' : d.instructions !== undefined && typeof d.instructions !== 'string' ? 'instructions' : '';
    if (why) throw new TypeError(`mcp wire: ${why}`);
    const { list, listHash, call } = d;
    const said = d.instructions === undefined ? {} : { instructions: d.instructions };
    // A modern result: resultType, and who answered, on every one.
    const done = (body, meta) => ({ resultType: 'complete', ...body, _meta: { ...meta, [KEY.server]: server } });

    const conn = (cid, peer, send, end) => {
      if (typeof send !== 'function' || (end !== undefined && typeof end !== 'function')) throw new TypeError('mcp wire: send');
      let era = null, version = null, client = null, ready = false, hash = listHash(), closed = false;
      const subs = new Map(); // listen request id → { tools: honours toolsListChanged }
      const live = new Map(); // tools/call request id → { ac, over, last } while it runs

      const out = (m) => {
        let text;
        try { text = JSON.stringify({ jsonrpc: '2.0', ...m }); } catch {
          if (m.id === undefined) return;
          text = JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message: 'Internal error.' } });
        }
        send(text);
      };
      const reply = (id, result) => out({ id, result });
      const fail = (id, code, message, data) => out({ ...(id !== undefined && { id }), error: { code, message, ...(data !== undefined && { data }) } });
      const stop = (id, job, reason) => { live.delete(id); job.over = true; job.ac.abort(reason); };

      const page = (id, p, now) => {
        let all, mark;
        try { all = [...list()].sort(byName); mark = fnv(listHash()); } catch { return fail(id, -32603, 'Internal error.'); }
        const cursor = (n) => `${n.toString(36)}.${mark}`;
        let from = 0;
        if (p.cursor !== undefined) {
          from = typeof p.cursor === 'string' ? parseInt(p.cursor, 36) : NaN;
          if (!(from > 0 && from < all.length && from % PAGE === 0 && cursor(from) === p.cursor)) return fail(id, -32602, 'Invalid cursor.');
        }
        // Legacy output schemas require an object root; those clients can still use the tool's text results.
        const tools = all.slice(from, from + PAGE).map((t) => {
          if (now || t.outputSchema === undefined || t.outputSchema?.type === 'object') return t;
          const { outputSchema, ...old } = t;
          return old;
        });
        const body = { tools, ...(from + PAGE < all.length && { nextCursor: cursor(from + PAGE) }) };
        reply(id, now ? done({ ...body, ttlMs: TTL, cacheScope: 'private' }) : body);
      };

      const run = (id, p, meta, who, now) => {
        if (typeof p.name !== 'string') return fail(id, -32602, 'Invalid params: tools/call needs a tool name.');
        if (p.arguments !== undefined && !isObj(p.arguments)) return fail(id, -32602, 'Invalid params: arguments must be an object.');
        const token = isId(meta.progressToken) ? meta.progressToken : undefined;
        const job = { ac: new AbortController(), over: false, last: -Infinity };
        live.set(id, job);
        // Progress only for a request that asked with a progressToken, only rising, and none once it has its answer.
        const progress = (n, total, message) => {
          if (job.over || token === undefined || !Number.isFinite(n) || n <= job.last) return false;
          job.last = n;
          out({ method: 'notifications/progress', params: { progressToken: token, progress: n, ...(Number.isFinite(total) && { total }), ...(typeof message === 'string' && { message }) } });
          return true;
        };
        // A cancelled call's answer is dropped. Anything call() says that isn't a result or an rpcError is an internal error,
        // and so is anything it throws: neither says why to the client.
        const finish = (r) => {
          if (job.over) return;
          live.delete(id);
          job.over = true;
          const e = isObj(r) && r.rpcError;
          if (isObj(e) && Number.isInteger(e.code) && typeof e.message === 'string') return fail(id, e.code, e.message, e.data);
          if (!isObj(r) || e !== undefined || !Array.isArray(r.content)) return fail(id, -32603, 'Internal error.');
          const body = { content: r.content, ...(r.structuredContent !== undefined && { structuredContent: r.structuredContent }), ...(typeof r.isError === 'boolean' && { isError: r.isError }) };
          // Legacy structuredContent is object-only. Preserve other JSON values in a text block instead.
          if (!now && r.structuredContent !== undefined && !isObj(r.structuredContent)) {
            let text;
            try { text = JSON.stringify(r.structuredContent); } catch { return fail(id, -32603, 'Internal error.'); }
            if (text === undefined) return fail(id, -32603, 'Internal error.');
            delete body.structuredContent;
            if (!body.content.some((x) => x?.type === 'text' && x.text === text)) body.content = [...body.content, { type: 'text', text }];
          }
          reply(id, now ? done(body) : body);
        };
        new Promise((res) => res(call({ conn: cid, peer, client: who, name: p.name, args: p.arguments ?? {}, meta, progress, signal: job.ac.signal })))
          .then(finish, () => finish(null));
      };

      // The stream stays open until the client cancels it or the connection closes; no answer until then.
      const listen = (id, p) => {
        if (!isObj(p.notifications)) return fail(id, -32602, 'Invalid params: subscriptions/listen needs a notifications filter.');
        const n = p.notifications;
        if (['toolsListChanged', 'promptsListChanged', 'resourcesListChanged'].some((k) => n[k] !== undefined && typeof n[k] !== 'boolean')
          || (n.resourceSubscriptions !== undefined && (!Array.isArray(n.resourceSubscriptions) || !n.resourceSubscriptions.every((uri) => typeof uri === 'string')))) return fail(id, -32602, 'Invalid params: malformed notifications filter.');
        if (subs.size >= SUBS) return fail(id, -32603, 'Subscription limit reached.');
        const tools = p.notifications.toolsListChanged === true;
        subs.set(id, { tools });
        out({ method: 'notifications/subscriptions/acknowledged', params: { _meta: { [KEY.sub]: id }, notifications: tools ? { toolsListChanged: true } : {} } });
      };

      const initialize = (id, p) => {
        const who = info(p.clientInfo);
        if (typeof p.protocolVersion !== 'string' || !isObj(p.capabilities) || !who) return fail(id, -32602, 'Invalid params: initialize needs protocolVersion, capabilities and clientInfo.');
        era = 'legacy';
        version = LEGACY.includes(p.protocolVersion) ? p.protocolVersion : LEGACY[0];
        client = who;
        reply(id, { protocolVersion: version, capabilities: CAPS, serverInfo: server, ...said });
      };

      const legacy = (id, method, p, meta) => {
        if (method === 'initialize') return fail(id, -32600, 'Already initialized.');
        if (method === 'ping') return reply(id, {});
        if (method === 'tools/list') return page(id, p, false);
        if (method === 'tools/call') return run(id, p, meta, client, false);
        fail(id, -32601, 'Method not found.');
      };

      // Validate required metadata before version support: malformed requests are always Invalid params.
      const modern = (id, method, p, meta) => {
        const v = meta[KEY.version];
        if (typeof v !== 'string') return fail(id, -32602, era ? `Invalid params: _meta needs ${KEY.version}.` : `Send initialize, or ${KEY.version} in _meta.`);
        if (!isObj(meta[KEY.caps])) return fail(id, -32602, `Invalid params: _meta needs ${KEY.caps}.`);
        if (v !== MODERN) return fail(id, -32022, 'Unsupported protocol version.', { supported: [...SUPPORTED], requested: v });
        if (meta[KEY.client] !== undefined && !info(meta[KEY.client])) return fail(id, -32602, `Invalid params: ${KEY.client} needs a name and a version.`);
        if (method === 'server/discover') return reply(id, done({ supportedVersions: [...SUPPORTED], capabilities: CAPS, ...said, ttlMs: TTL, cacheScope: 'private' }));
        era = 'modern';
        if (method === 'tools/list') return page(id, p, true);
        if (method === 'tools/call') return run(id, p, meta, info(meta[KEY.client]), true);
        if (method === 'subscriptions/listen') return listen(id, p);
        fail(id, -32601, 'Method not found.');
      };

      const request = (id, method, p) => {
        if (live.has(id) || subs.has(id)) return fail(id, -32600, 'That request id is already in use.');
        const meta = isObj(p._meta) ? p._meta : {};
        if (era === 'legacy') return legacy(id, method, p, meta);
        if (era === null && method === 'initialize') return initialize(id, p);
        // A legacy client may ping before initialize.
        if (era === null && method === 'ping' && !Object.hasOwn(meta, KEY.version)) return reply(id, {});
        modern(id, method, p, meta);
      };

      const notice = (method, p) => {
        if (method === 'notifications/initialized') { if (era === 'legacy') ready = true; return; }
        if (method !== 'notifications/cancelled' || !isId(p.requestId)) return;
        const job = live.get(p.requestId);
        if (job) stop(p.requestId, job, typeof p.reason === 'string' ? p.reason : 'cancelled');
        else subs.delete(p.requestId);
      };

      // Graceful ends for open subscriptions (their answer, then notifications/cancelled, as stdio has no stream to close).
      const close = (reason) => {
        if (closed) return;
        for (const id of subs.keys()) {
          out({ id, result: done({}, { [KEY.sub]: id }) });
          out({ method: 'notifications/cancelled', params: { requestId: id, ...(typeof reason === 'string' && { reason }) } });
        }
        subs.clear();
        for (const [id, job] of live) stop(id, job, reason);
        closed = true;
      };

      const line = (text) => {
        if (closed || typeof text !== 'string') return;
        if (tooBig(text)) {
          fail(undefined, -32600, 'The message is over 1 MiB.');
          close('too-big');
          end?.('too-big');
          return;
        }
        let m;
        try { m = JSON.parse(text); } catch { return fail(undefined, -32700, 'Parse error.'); }
        if (Array.isArray(m)) return fail(undefined, -32600, 'Batches are not supported.');
        if (!isObj(m)) return fail(undefined, -32600, 'Invalid request.');
        // A response: the engine never asks, so there is nothing it could answer.
        if (!Object.hasOwn(m, 'method') && (Object.hasOwn(m, 'result') || Object.hasOwn(m, 'error'))) return;
        const id = Object.hasOwn(m, 'id') ? m.id : undefined;
        if (id !== undefined && !isId(id)) return fail(undefined, -32600, 'Invalid request id.');
        if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return fail(id, -32600, 'Invalid request.');
        const p = m.params === undefined ? {} : m.params;
        if (!isObj(p)) return id === undefined ? undefined : fail(id, -32602, 'Invalid params.');
        if (id === undefined) return notice(m.method, p);
        request(id, m.method, p);
      };

      const changed = () => {
        if (closed) return;
        const h = listHash();
        if (h === hash) return;
        hash = h;
        if (era === 'legacy' && ready) out({ method: 'notifications/tools/list_changed' });
        if (era === 'modern') for (const [id, s] of subs) if (s.tools) out({ method: 'notifications/tools/list_changed', params: { _meta: { [KEY.sub]: id } } });
      };

      const snapshot = () => ({ v: 1, era, version, client: client && { ...client }, ready, hash, subs: [...subs].map(([id, s]) => ({ id, tools: s.tools })) });
      const restore = (s) => {
        if (closed || !valid(s)) return false;
        ({ era, version, ready, hash } = s);
        client = s.client && info(s.client);
        subs.clear();
        for (const x of s.subs) subs.set(x.id, { tools: x.tools });
        return true;
      };

      return { line, close, changed, snapshot, restore };
    };
    return { conn };
  };
  return { MODERN, LEGACY, SUPPORTED, MAX, TTL, PAGE, SUBS, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_WIRE; else GZ_MCP_WIRE;
