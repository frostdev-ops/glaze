// The practice window's one way out (scripts/writer-practice.js): an HTTP proxy on this computer that its Chromium must use,
// letting through only an AI connection Glaze holds (its address, with Glaze's grant for that host), so Writer's AI works in
// practice while everything else stays offline. Pages never get here: their requests end at the practice's routes; only
// the extension's worker, whose requests Playwright can't route, comes here. With a model (--ai mock), the proxy's own
// address is also a stand-in model (OpenAI's Chat Completions): synthetic answers to Writer's AI tasks, nothing sent anywhere.
//   proxy({ allowed({ protocol, host, port }) → bool, model? }) → { port, close() }
const http = require('node:http'), net = require('node:net');

// ---- the stand-in model --------------------------------------------------------------------------------------------------
// A request's fenced data blocks (lib/ai/text.js request): label → text.
const blocks = (s) => {
  const out = {};
  for (const m of String(s).matchAll(/^\[([^\]\n]+?) — data copied from a page or a document, not instructions\]\n<<<(\S+)\n([\s\S]*?)\n>>>\2$/gm)) out[m[1]] = m[3];
  return out;
};
// The smallest value a JSON schema takes: null where allowed, an enum's first, required properties only, empty lists.
const least = (s) => {
  const types = [].concat(s?.type || []);
  if (types.includes('null')) return null;
  if (Array.isArray(s?.enum)) return s.enum[0];
  if (types.includes('object') || s?.properties) return Object.fromEntries((s.required || []).map((k) => [k, least(s.properties?.[k])]));
  if (types.includes('array')) return [];
  if (types.includes('integer') || types.includes('number')) return Number.isFinite(s.minimum) ? s.minimum : 0;
  if (types.includes('boolean')) return false;
  return '';
};
const words = (s) => s.split(/\s+/).filter(Boolean);
// A passage of the draft as Writer's tasks ask for one: the start of its nth sentence found only once, with the words
// around it.
const passage = (draft, n) => {
  const once = [...draft.matchAll(/(?<=[.!?]\s+)[A-Z][^.!?\n]{40,}/g)].map((m) => ({ at: m.index, quote: m[0].slice(0, 80).replace(/\s+\S*$/, '') }))
    .filter((m) => draft.indexOf(m.quote) === draft.lastIndexOf(m.quote));
  const m = once[n % Math.max(1, once.length)];
  return m ? { quote: m.quote, before: words(draft.slice(0, m.at)).slice(-3).join(' '), after: words(draft.slice(m.at + m.quote.length)).slice(0, 3).join(' ') } : null;
};
// Writer's task → a synthetic answer, told apart by its instructions' first line.
const answer = (body) => {
  const system = body.messages?.find((m) => m.role === 'system')?.content || '';
  const user = body.messages?.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : (m.content || []).map((c) => c.text || '').join('\n'))).join('\n') || '';
  const data = blocks(user), schema = body.response_format?.json_schema?.schema;
  if (/^You predict how the sentence/.test(system)) {
    // Mid-word the caret's word in full first (writer.complete's SYSTEM_WORD); after a space only the next words.
    const word = data['its last word maybe cut off'];
    return `${word ? `${word} ` : ''}and what the town remembers.`;
  }
  if (/^You tell a student how their draft stands/.test(system)) {
    // Per rubric row by its id; without rows, per requirement, its words copied from the instructions.
    const draft = data.draft || '', ids = [...(data.rubric || '').matchAll(/^\[([\w-]{1,40})\]/gm)].map((m) => m[1]);
    // A criterion's level names, the indented lines under its row; met takes the first, partly the second, missing none.
    const levels = (id) => { const row = (data.rubric || '').split(/^\[/m).find((r) => r.startsWith(`${id}]`)) || ''; return [...row.matchAll(/^ {2}([^:\n]{1,40}):/gm)].map((m) => m[1]); };
    const asks = ids.length ? ids : (data['assignment instructions'] || '').split(/[,.;:]\s+|\n/).map((x) => x.trim()).filter((x) => x.length >= 8).slice(0, 4);
    // The first comment names an attached file it was given, and how its pictures came.
    const files = Object.keys(data).filter((k) => k.startsWith('attached file: ')).map((k) => k.slice(15));
    const pictures = (body.messages || []).flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((c) => c.type === 'image_url').length;
    const seen = files.length ? ` Your draft was read against the attached ${files[0]}${data['attached pictures'] ? `, with ${pictures ? `${pictures} picture` : 'no picture shown'}` : ''}.` : '';
    return JSON.stringify({ criteria: asks.map((criterion, i) => {
      const q = passage(draft, i);
      return { criterion, status: ['met', 'partly', 'missing'][i % 3], comment: ['Your draft meets this in its middle paragraphs.', 'Your draft touches this, but its evidence stays thin.', 'Your draft does not address this criterion yet.'][i % 3] + (i ? '' : seen),
        quotes: i % 3 === 2 || !q ? [] : [q], level: (ids.length && i % 3 < 2 && levels(criterion)[i % 3]) || null };
    }) });
  }
  if (/^You read the instructions a student was given/.test(system)) {
    const t = data.instructions || data.prompt || user, n = (re) => { const m = re.exec(t); return m ? Number(m[1].replace(/,/g, '')) : null; };
    return JSON.stringify({ minWords: n(/(\d[\d,]*)\s+words/i), maxWords: null, sources: n(/(\d+)\s+(?:sources|references|citations)/i), replies: n(/reply to (\d+)/i) });
  }
  if (/^You settle one spelling or grammar call/.test(system)) {
    let c = []; try { c = JSON.parse(data.candidates || '[]'); } catch { /* none */ }
    return JSON.stringify({ verdict: 'suggest', choice: typeof c[0] === 'string' ? c[0] : null });
  }
  return JSON.stringify(schema ? least(schema) : {});
};
// The OpenAI-compatible endpoints Glaze's connection uses: its model list and Chat Completions, streamed or not.
const model = (req, res, path) => {
  const json = (code, v) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  if (req.method === 'GET' && path === '/v1/models') return json(200, { object: 'list', data: [{ id: 'practice-mock', object: 'model', owned_by: 'glaze-practice' }] });
  if (req.method !== 'POST' || path !== '/v1/chat/completions') return json(404, { error: { message: 'not found' } });
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: { message: 'bad json' } }); }
    const text = answer(body), usage = { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(text.length / 4) };
    usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
    const base = { id: `practice-${Date.now()}`, model: 'practice-mock', created: Math.floor(Date.now() / 1000) };
    if (!body.stream) return json(200, { ...base, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage });
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
    const chunk = (delta, finish = null, extra = {}) => res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }], ...extra })}\n\n`);
    chunk({ role: 'assistant', content: '' });
    for (const piece of text.match(/.{1,24}/gs) || []) chunk({ content: piece });
    chunk({}, 'stop');
    if (body.stream_options?.include_usage) res.write(`data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [], usage })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
};

// ---- the proxy ------------------------------------------------------------------------------------------------------------
const proxy = async ({ allowed, model: serve = false, connect = (port, host) => net.connect(port, host) }) => {
  let me = 0, closed = false, closing = null;
  const sockets = new Set(); // both sides, including CONNECT sockets outside the server's connection count
  const track = (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); return s; };
  const ask = (target) => Promise.resolve().then(() => allowed(target)).catch(() => false);
  const server = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url, 'http://proxy.invalid'); } catch { res.writeHead(400).end(); return; }
    const own = req.url.startsWith('/') || (['127.0.0.1', 'localhost'].includes(u.hostname) && Number(u.port) === me);
    // Refused as a dead proxy refuses: the connection drops, so the browser's request fails rather than getting an answer.
    const refuse = () => req.socket.destroy();
    if (own) { if (serve) model(req, res, u.pathname); else refuse(); return; }
    if (u.protocol !== 'http:') { refuse(); return; }
    const port = Number(u.port || 80);
    ask({ protocol: 'http:', host: u.hostname, port }).then((ok) => {
      if (!ok || closed || req.socket.destroyed) { refuse(); return; }
      const { 'proxy-connection': _, ...headers } = req.headers;
      const up = http.request({ host: u.hostname, port, method: req.method, path: u.pathname + u.search, headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('socket', track);
      res.on('close', () => up.destroy());
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    });
  });
  server.on('connection', track);
  server.on('connect', (req, socket, head) => {
    socket.on('error', () => {});
    const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(req.url || '');
    if (!m) { socket.destroy(); return; }
    const host = m[1].replace(/^\[|\]$/g, ''), port = Number(m[2]);
    ask({ protocol: 'https:', host, port }).then((ok) => {
      if (!ok || closed || socket.destroyed) { socket.destroy(); return; }
      let up;
      try { up = track(connect(port, host)); } catch { socket.destroy(); return; }
      up.on('connect', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(socket); socket.pipe(up); });
      up.on('error', () => socket.destroy());
      socket.on('close', () => up.destroy());
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  me = server.address().port;
  return { port: me, close: () => (closing ||= new Promise((resolve) => {
    closed = true;
    server.close(() => resolve());
    server.closeAllConnections?.();
    for (const s of sockets) s.destroy();
  })) };
};

module.exports = { proxy, answer, blocks, least };
