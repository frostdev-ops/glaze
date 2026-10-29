// The MCP protocol engine (lib/mcp/wire.js): both eras on one connection, against fake list, listHash, call and send.
// Rules are from the MCP spec, 2026-07-28 (modern) and 2025-11-25 (legacy, the initialize handshake).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const W = require('../lib/mcp/wire.js');

const K = {
  version: 'io.modelcontextprotocol/protocolVersion', caps: 'io.modelcontextprotocol/clientCapabilities', client: 'io.modelcontextprotocol/clientInfo',
  server: 'io.modelcontextprotocol/serverInfo', sub: 'io.modelcontextprotocol/subscriptionId',
};
const SERVER = { name: 'glaze', version: '4.0.0' };
const CLIENT = { name: 'Claude Code', version: '3.0.0' };
const META = { [K.version]: '2026-07-28', [K.caps]: {}, [K.client]: CLIENT };
const PEER = { name: 'claude', exe: '/usr/bin/claude', verified: true };
const tool = (name) => ({ name, description: `The ${name} tool.`, inputSchema: { type: 'object' } });
const tick = () => new Promise((res) => setImmediate(res));

// One engine and one connection. Every line sent is parsed, and checked: one line, never a request.
const setup = (opts = {}) => {
  const { call, tools = [tool('b_tool'), tool('a_tool')] } = opts;
  const instructions = 'instructions' in opts ? opts.instructions : 'Ask Glaze about courses.';
  const io = { sent: [], ended: [], calls: [], tools, hash: 'h1' };
  io.engine = W.create({
    serverInfo: SERVER, instructions, list: () => io.tools, listHash: () => io.hash,
    call: call || (async (c) => { io.calls.push(c); return { content: [{ type: 'text', text: 'done' }] }; }),
  });
  io.open = (id = 'c1') => io.engine.conn(id, PEER, (line) => {
    assert.equal(typeof line, 'string');
    assert.equal(/[\r\n]/.test(line), false, 'one message per line');
    const m = JSON.parse(line);
    assert.equal(m.jsonrpc, '2.0');
    assert.equal('method' in m && 'id' in m, false, 'the engine never sends a request');
    io.sent.push(m);
  }, (why) => io.ended.push(why));
  io.c = io.open();
  io.line = (m) => io.c.line(typeof m === 'string' ? m : JSON.stringify(m));
  io.take = () => io.sent.splice(0);
  io.one = (m) => { io.line(m); const out = io.take(); assert.equal(out.length, 1, JSON.stringify(out)); return out[0]; };
  return io;
};
const req = (id, method, params = {}, meta = {}) => ({ jsonrpc: '2.0', id, method, params: { ...params, _meta: { ...META, ...meta } } });
const bare = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params && { params }) });
const note = (method, params) => ({ jsonrpc: '2.0', method, ...(params && { params }) });
const INIT = (version = '2025-11-25', clientInfo = { name: 'VS Code', version: '1.110.0' }) => bare(0, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo });
const legacy = (opts) => {
  const io = setup(opts);
  io.one(INIT());
  io.line(note('notifications/initialized'));
  return io;
};
const err = (m, code) => { assert.equal(m.error?.code, code, JSON.stringify(m)); assert.equal(typeof m.error.message, 'string'); return m.error; };

// ---- choosing the era ---------------------------------------------------------------------------------------------------
test('initialize starts the legacy era and answers per 2025-11-25, with our latest legacy version for one we do not speak', () => {
  for (const [asked, got] of [['2025-11-25', '2025-11-25'], ['2025-06-18', '2025-06-18'], ['2025-03-26', '2025-11-25'], ['2099-01-01', '2025-11-25']]) {
    const io = setup();
    const m = io.one(INIT(asked));
    assert.equal(m.id, 0);
    assert.deepEqual(m.result, { protocolVersion: got, capabilities: { tools: { listChanged: true } }, serverInfo: SERVER, instructions: 'Ask Glaze about courses.' });
    assert.equal(io.c.snapshot().era, 'legacy');
  }
  assert.equal('instructions' in setup({ instructions: undefined }).one(INIT()).result, false);
});

test('an initialize the engine cannot read is refused and fixes nothing', () => {
  const io = setup();
  err(io.one(bare(1, 'initialize', { capabilities: {}, clientInfo: CLIENT })), -32602);
  err(io.one(bare(2, 'initialize', { protocolVersion: '2025-11-25', clientInfo: CLIENT })), -32602);
  err(io.one(bare(3, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 7 } })), -32602);
  err(io.one(bare(4, 'initialize')), -32602);
  assert.equal(io.c.snapshot().era, null);
  assert.equal(io.one(INIT()).result.protocolVersion, '2025-11-25');
});

test('a request carrying the modern protocolVersion in _meta starts the modern era', () => {
  const io = setup();
  const m = io.one(req(1, 'tools/list'));
  assert.equal(m.result.resultType, 'complete');
  assert.deepEqual(m.result._meta, { [K.server]: SERVER });
  assert.equal(io.c.snapshot().era, 'modern');
});

test('before an era, a request with neither is refused, but a legacy ping is answered', () => {
  const io = setup();
  err(io.one(bare(1, 'tools/list')), -32602);
  err(io.one(bare(2, 'tools/call', { name: 'a_tool' })), -32602);
  assert.deepEqual(io.one(bare(3, 'ping')), { jsonrpc: '2.0', id: 3, result: {} });
  assert.equal(io.c.snapshot().era, null);
  assert.equal(io.calls.length, 0);
});

test('server/discover and rejected modern requests fix nothing, so a client told our versions can still initialize', () => {
  const io = setup();
  assert.equal(io.one(req(1, 'server/discover')).result.resultType, 'complete');
  err(io.one(req(2, 'tools/list', {}, { [K.version]: '2027-03-01' })), -32022);
  err(io.one(req(3, 'tools/list', {}, { [K.caps]: undefined })), -32602);
  assert.equal(io.c.snapshot().era, null);
  assert.equal(io.one(INIT()).result.protocolVersion, '2025-11-25');
  assert.equal(io.c.snapshot().era, 'legacy');
});

test('once legacy, modern-only methods are unknown and a second initialize is refused', () => {
  const io = legacy();
  err(io.one(req(1, 'server/discover')), -32601);
  err(io.one(req(2, 'subscriptions/listen', { notifications: { toolsListChanged: true } })), -32601);
  err(io.one(INIT()), -32600);
  const m = io.one(req(3, 'tools/list'));
  assert.equal('resultType' in m.result, false, 'a modern _meta does not make a legacy connection modern');
});

test('once modern, initialize and ping are not methods of this revision', () => {
  const io = setup();
  io.one(req(1, 'tools/list'));
  err(io.one(INIT()), -32602);
  err(io.one(req(2, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: CLIENT })), -32601);
  err(io.one(req(3, 'ping')), -32601);
  err(io.one(bare(4, 'ping')), -32602);
  assert.equal(io.c.snapshot().era, 'modern');
});

// ---- modern ---------------------------------------------------------------------------------------------------------------
test('server/discover names the versions, tools capability, identity and caching', () => {
  const m = setup().one(req('d1', 'server/discover'));
  assert.deepEqual(m, {
    jsonrpc: '2.0', id: 'd1',
    result: {
      resultType: 'complete', supportedVersions: ['2026-07-28', '2025-11-25', '2025-06-18'], capabilities: { tools: { listChanged: true } },
      instructions: 'Ask Glaze about courses.', ttlMs: W.TTL, cacheScope: 'private', _meta: { [K.server]: SERVER },
    },
  });
  assert.equal(Number.isInteger(W.TTL) && W.TTL >= 0, true);
});

test('every modern request is checked for its _meta: protocolVersion and clientCapabilities are required', () => {
  const io = setup();
  for (const meta of [{ [K.caps]: undefined }, { [K.caps]: null }, { [K.caps]: [] }, { [K.caps]: 'all' }, { [K.version]: 20260728 }, { [K.client]: 'Claude' }, { [K.client]: { name: 'x' } }]) {
    const m = io.one(req(1, 'tools/list', {}, meta));
    err(m, -32602);
    assert.equal(m.id, 1);
  }
  assert.equal(io.one(req(2, 'tools/list', {}, { [K.client]: undefined })).result.resultType, 'complete', 'clientInfo is optional');
});

test('an unsupported version is -32022 with the versions we speak and the one asked for', () => {
  const io = setup();
  for (const v of ['1900-01-01', '2025-11-25', '2025-06-18', '2027-03-01', '']) {
    const e = err(io.one(req(5, 'tools/call', { name: 'a_tool' }, { [K.version]: v })), -32022);
    assert.deepEqual(e.data, { supported: ['2026-07-28', '2025-11-25', '2025-06-18'], requested: v });
  }
  assert.equal(io.calls.length, 0);
});

test('missing or malformed required capabilities is -32602 even with an unsupported version', () => {
  const io = setup();
  for (const caps of [undefined, null, [], 'all']) {
    err(io.one(req(1, 'server/discover', {}, { [K.version]: '2099-01-01', [K.caps]: caps })), -32602);
  }
  assert.equal(io.c.snapshot().era, null);
  assert.equal(io.one(INIT()).result.protocolVersion, '2025-11-25');
});

test('tools/list is sorted by name, paged by 50 with opaque cursors, and cached privately', () => {
  const io = setup({ tools: Array.from({ length: 120 }, (_, i) => tool(`t${String(119 - i).padStart(3, '0')}`)) });
  const pages = [];
  let cursor;
  do {
    const m = io.one(req(pages.length + 1, 'tools/list', cursor === undefined ? {} : { cursor }));
    assert.equal(m.result.resultType, 'complete');
    assert.equal(m.result.ttlMs, W.TTL);
    assert.equal(m.result.cacheScope, 'private');
    assert.deepEqual(m.result._meta, { [K.server]: SERVER });
    pages.push(m.result.tools.map((t) => t.name));
    cursor = m.result.nextCursor;
    if (cursor !== undefined) assert.equal(typeof cursor, 'string');
  } while (cursor !== undefined && pages.length < 5);
  assert.deepEqual(pages.map((p) => p.length), [50, 50, 20]);
  assert.deepEqual(pages.flat(), Array.from({ length: 120 }, (_, i) => `t${String(i).padStart(3, '0')}`));
  // The same list gives the same pages.
  const again = io.one(req(9, 'tools/list'));
  assert.deepEqual(again.result.tools.map((t) => t.name), pages[0]);
  assert.equal(io.one(req(10, 'tools/list', { cursor: again.result.nextCursor })).result.tools[0].name, 't050');
  // A tool is passed as list() gives it.
  assert.deepEqual(io.one(req(11, 'tools/list')).result.tools[0], tool('t000'));
});

test('a cursor that is not ours, or from a list that has since changed, is -32602', () => {
  const io = setup({ tools: Array.from({ length: 60 }, (_, i) => tool(`t${i}`)) });
  const next = io.one(req(1, 'tools/list')).result.nextCursor;
  for (const cursor of ['', 'nope', '50', 50, null, {}, `${next}x`, `x${next}`]) err(io.one(req(2, 'tools/list', { cursor })), -32602);
  io.hash = 'h2';
  err(io.one(req(3, 'tools/list', { cursor: next })), -32602);
  assert.equal(io.one(req(4, 'tools/list')).result.tools.length, 50);
});

test('a short list has no nextCursor, and an empty one is an empty page', () => {
  assert.equal('nextCursor' in setup().one(req(1, 'tools/list')).result, false);
  assert.deepEqual(setup({ tools: [] }).one(req(1, 'tools/list')).result.tools, []);
  assert.equal('nextCursor' in setup({ tools: Array.from({ length: 50 }, (_, i) => tool(`t${i}`)) }).one(req(1, 'tools/list')).result, false);
});

test('tools/call goes to call() with the connection, peer, client, name, arguments, _meta and a signal', async () => {
  const io = setup({ call: async (c) => { io.calls.push(c); return { content: [{ type: 'text', text: '{"n":1}' }], structuredContent: { n: 1 }, isError: false, extra: 'dropped', _meta: { x: 1 } }; } });
  io.line(req(7, 'tools/call', { name: 'a_tool', arguments: { course: 'BIO 101' } }));
  assert.equal(io.calls.length, 1);
  const c = io.calls[0];
  assert.equal(c.conn, 'c1');
  assert.deepEqual(c.peer, PEER);
  assert.deepEqual(c.client, CLIENT);
  assert.equal(c.name, 'a_tool');
  assert.deepEqual(c.args, { course: 'BIO 101' });
  assert.deepEqual(c.meta, META);
  assert.equal(c.signal.aborted, false);
  assert.equal(typeof c.progress, 'function');
  await tick();
  assert.deepEqual(io.take(), [{
    jsonrpc: '2.0', id: 7,
    result: { resultType: 'complete', content: [{ type: 'text', text: '{"n":1}' }], structuredContent: { n: 1 }, isError: false, _meta: { [K.server]: SERVER } },
  }]);
});

test('tools/call needs a name and object arguments; no arguments is {}; no clientInfo is a null client', async () => {
  const io = setup();
  for (const p of [{}, { name: 7 }, { name: 'a_tool', arguments: [] }, { name: 'a_tool', arguments: 'x' }, { name: 'a_tool', arguments: null }]) err(io.one(req(1, 'tools/call', p)), -32602);
  assert.equal(io.calls.length, 0);
  io.line(req(2, 'tools/call', { name: 'a_tool' }, { [K.client]: undefined }));
  assert.deepEqual(io.calls[0].args, {});
  assert.equal(io.calls[0].client, null);
  await tick();
  assert.equal(io.take()[0].result.content[0].text, 'done');
});

test('call() answering rpcError, throwing or answering nonsense becomes a JSON-RPC error that leaks nothing', async () => {
  const answers = [
    async () => ({ rpcError: { code: -32602, message: 'Unknown tool: nope', data: { name: 'nope' } } }),
    async () => { throw new Error('secret path /Users/x'); },
    () => { throw new Error('sync secret'); },
    async () => null,
    async () => ({ content: 'not an array' }),
    async () => ({ rpcError: { code: 1.5, message: 'x' } }),
    async () => ({ content: [{ type: 'text', text: 'big' }], structuredContent: 10n }),
  ];
  const got = [];
  for (const call of answers) {
    const io = setup({ call });
    io.line(req(1, 'tools/call', { name: 'nope' }));
    await tick();
    got.push(io.take());
  }
  assert.deepEqual(got[0], [{ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Unknown tool: nope', data: { name: 'nope' } } }]);
  for (const out of got.slice(1)) {
    assert.equal(out.length, 1);
    err(out[0], -32603);
    assert.equal(/secret/.test(JSON.stringify(out[0])), false);
  }
});

test('an unserializable rpcError still answers the request with a private internal error', async () => {
  const cycle = {};
  cycle.self = cycle;
  for (const data of [10n, cycle]) {
    for (const open of [setup, legacy]) {
      const io = open({ call: async () => ({ rpcError: { code: -32602, message: 'private diagnostic', data } }) });
      io.line(req(7, 'tools/call', { name: 'a_tool' }));
      await tick();
      assert.deepEqual(io.take(), [{ jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'Internal error.' } }]);
    }
  }
});

test('subscriptions/listen honours toolsListChanged only, acknowledges with its id, and stays open', () => {
  const io = setup();
  io.line(req('s1', 'subscriptions/listen', { notifications: { toolsListChanged: true, promptsListChanged: true, resourceSubscriptions: ['file:///x'] } }));
  assert.deepEqual(io.take(), [{ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { _meta: { [K.sub]: 's1' }, notifications: { toolsListChanged: true } } }]);
  io.line(req(2, 'subscriptions/listen', { notifications: { resourcesListChanged: true } }));
  assert.deepEqual(io.take(), [{ jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: { _meta: { [K.sub]: 2 }, notifications: {} } }]);
  io.c.changed();
  assert.deepEqual(io.take(), [], 'nothing until the list hash moves');
  io.hash = 'h2';
  io.c.changed();
  assert.deepEqual(io.take(), [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { _meta: { [K.sub]: 's1' } } }]);
  io.c.changed();
  assert.deepEqual(io.take(), []);
  assert.deepEqual(io.c.snapshot().subs, [{ id: 's1', tools: true }, { id: 2, tools: false }]);
});

test('every subscription is told, and a cancelled one is gone without a reply', () => {
  const io = setup();
  io.line(req(1, 'subscriptions/listen', { notifications: { toolsListChanged: true } }));
  io.line(req(2, 'subscriptions/listen', { notifications: { toolsListChanged: true } }));
  io.take();
  io.hash = 'h2';
  io.c.changed();
  assert.deepEqual(io.take().map((m) => m.params._meta[K.sub]), [1, 2]);
  io.line(note('notifications/cancelled', { requestId: 1, reason: 'done', _meta: META }));
  assert.deepEqual(io.take(), []);
  io.hash = 'h3';
  io.c.changed();
  assert.deepEqual(io.take().map((m) => m.params._meta[K.sub]), [2]);
  // Its id is free again.
  io.line(req(1, 'subscriptions/listen', { notifications: {} }));
  assert.equal(io.take()[0].method, 'notifications/subscriptions/acknowledged');
});

test('subscriptions/listen needs a notifications filter and has a limit', () => {
  const io = setup();
  for (const p of [{}, { notifications: null }, { notifications: [] }, { notifications: true }]) err(io.one(req(1, 'subscriptions/listen', p)), -32602);
  for (let i = 0; i < W.SUBS; i++) io.line(req(`s${i}`, 'subscriptions/listen', { notifications: { toolsListChanged: true } }));
  assert.equal(io.take().length, W.SUBS);
  err(io.one(req('over', 'subscriptions/listen', { notifications: { toolsListChanged: true } })), -32603);
});

test('malformed subscription filter fields are -32602 and never open a stream', () => {
  const io = setup();
  const filters = [
    { toolsListChanged: 'true' }, { toolsListChanged: null }, { toolsListChanged: 1 },
    { promptsListChanged: [] }, { resourcesListChanged: {} },
    { resourceSubscriptions: 'file:///x' }, { resourceSubscriptions: [7] }, { resourceSubscriptions: [null] },
  ];
  for (const notifications of filters) {
    err(io.one(req(1, 'subscriptions/listen', { notifications })), -32602);
    assert.deepEqual(io.c.snapshot().subs, []);
  }
  io.line(req(2, 'subscriptions/listen', { notifications: { toolsListChanged: false, promptsListChanged: true, resourceSubscriptions: ['file:///x'] } }));
  assert.deepEqual(io.take()[0].params.notifications, {}, 'well-typed unsupported filters are omitted');
});

test('notifications/cancelled aborts the call and its reply never comes; stray ones are ignored', async () => {
  let finish;
  const io = setup({ call: (c) => { io.calls.push(c); return new Promise((res) => { finish = res; }); } });
  io.line(req(9, 'tools/call', { name: 'a_tool' }, { progressToken: 'p' }));
  const { signal, progress } = io.calls[0];
  io.line(note('notifications/cancelled', { requestId: 9, reason: 'The user stopped it.' }));
  assert.equal(signal.aborted, true);
  assert.equal(progress(1), false, 'no progress after a cancel');
  finish({ content: [{ type: 'text', text: 'late' }] });
  await tick();
  assert.deepEqual(io.take(), []);
  // Unknown ids, finished ones and malformed notices change nothing.
  io.line(note('notifications/cancelled', { requestId: 'nope' }));
  io.line(note('notifications/cancelled'));
  io.line(note('notifications/cancelled', { requestId: { x: 1 } }));
  io.line(req(10, 'tools/call', { name: 'a_tool' }));
  finish({ content: [] });
  await tick();
  assert.equal(io.take()[0].id, 10);
  io.line(note('notifications/cancelled', { requestId: 10 }));
  assert.deepEqual(io.take(), []);
});

test('notifications/progress goes out only for a progressToken, only rising, and stops with the reply', async () => {
  let finish;
  const io = setup({ call: (c) => { io.calls.push(c); return new Promise((res) => { finish = res; }); } });
  io.line(req(1, 'tools/call', { name: 'a_tool' }, { progressToken: 42 }));
  const { progress } = io.calls[0];
  assert.equal(progress(0, undefined, 'Waiting for the student in Glaze'), true);
  assert.equal(progress(0), false, 'progress must increase');
  assert.equal(progress(-1), false);
  assert.equal(progress(NaN), false);
  assert.equal(progress(0.5, 1), true);
  assert.deepEqual(io.take(), [
    { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 42, progress: 0, message: 'Waiting for the student in Glaze' } },
    { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 42, progress: 0.5, total: 1 } },
  ]);
  finish({ content: [] });
  await tick();
  assert.equal(io.take().length, 1);
  assert.equal(progress(2), false, 'none after the reply');
  // No token, or a token that is not a string or an integer: no progress at all.
  for (const progressToken of [undefined, 1.5, null, { a: 1 }]) {
    io.line(req(2, 'tools/call', { name: 'a_tool' }, { progressToken }));
    assert.equal(io.calls.at(-1).progress(1), false);
    finish({ content: [] });
    await tick();
    assert.deepEqual(io.take().map((m) => m.method), [undefined]);
  }
});

test('resources and prompts are not offered, in either era', () => {
  const methods = ['resources/list', 'resources/read', 'resources/templates/list', 'resources/subscribe', 'prompts/list', 'prompts/get', 'completion/complete', 'logging/setLevel'];
  const modern = setup(), old = legacy();
  for (const method of methods) {
    err(modern.one(req(1, method)), -32601);
    err(old.one(bare(1, method, {})), -32601);
  }
});

// ---- legacy ---------------------------------------------------------------------------------------------------------------
test('2025-06-18 is echoed, advertised and restored, without offering 2025-03-26', async () => {
  assert.deepEqual(W.LEGACY, ['2025-11-25', '2025-06-18']);
  assert.equal(W.SUPPORTED.includes('2025-03-26'), false);
  const io = setup();
  assert.equal(io.one(INIT('2025-06-18')).result.protocolVersion, '2025-06-18');
  io.line(note('notifications/initialized'));
  const next = setup();
  assert.equal(next.c.restore(JSON.parse(JSON.stringify(io.c.snapshot()))), true);
  assert.equal(next.c.snapshot().version, '2025-06-18');
  assert.deepEqual(next.one(bare(1, 'ping')).result, {});
  assert.equal(next.one(bare(2, 'tools/list')).result.tools.length, 2);
  next.line(bare(3, 'tools/call', { name: 'a_tool' }));
  await tick();
  assert.deepEqual(next.take()[0].result, { content: [{ type: 'text', text: 'done' }] });
});

test('legacy lists omit output schemas their revision cannot describe and preserve the modern list', () => {
  const tools = [
    { ...tool('array'), outputSchema: { type: 'array', items: { type: 'number' } } },
    { ...tool('object'), outputSchema: { type: 'object', properties: { n: { type: 'number' } } } },
    { ...tool('union'), outputSchema: { anyOf: [{ type: 'number' }, { type: 'object' }] } },
  ];
  const modern = setup({ tools });
  assert.deepEqual(modern.one(req(1, 'tools/list')).result.tools, tools);
  for (const version of ['2025-11-25', '2025-06-18']) {
    const io = setup({ tools });
    io.one(INIT(version));
    io.line(note('notifications/initialized'));
    const result = io.one(bare(1, 'tools/list')).result.tools;
    assert.equal('outputSchema' in result[0], false);
    assert.deepEqual(result[1], tools[1]);
    assert.equal('outputSchema' in result[2], false);
  }
  assert.equal(tools[0].outputSchema.type, 'array', 'list() objects are never mutated');
  assert.deepEqual(modern.one(req(2, 'tools/list')).result.tools, tools);
});

test('non-object structured content reaches legacy clients as text and stays structured for modern clients', async () => {
  for (const value of [[1, 2], 'answer', 42, true, null]) {
    for (const version of [null, '2025-11-25', '2025-06-18']) {
      const io = setup({ call: async () => ({ content: [], structuredContent: value }) });
      if (version) { io.one(INIT(version)); io.line(note('notifications/initialized')); }
      io.line(version ? bare(1, 'tools/call', { name: 'a_tool' }) : req(1, 'tools/call', { name: 'a_tool' }));
      await tick();
      const result = io.take()[0].result;
      if (version) {
        assert.equal('structuredContent' in result, false);
        assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(value) }]);
      } else assert.deepEqual(result.structuredContent, value);
    }
  }
  const content = [{ type: 'text', text: '[1,2]' }];
  const io = legacy({ call: async () => ({ content, structuredContent: [1, 2] }) });
  io.line(bare(1, 'tools/call', { name: 'a_tool' }));
  await tick();
  assert.deepEqual(io.take()[0].result.content, content, 'an existing text fallback is not duplicated');
  const bad = legacy({ call: async () => ({ content: [], structuredContent: 10n }) });
  bad.line(bare(1, 'tools/call', { name: 'a_tool' }));
  await tick();
  err(bad.take()[0], -32603);
});

test('legacy ping, tools/list and tools/call carry no modern-only fields', async () => {
  const io = legacy({ tools: Array.from({ length: 51 }, (_, i) => tool(`t${String(i).padStart(2, '0')}`)) });
  assert.deepEqual(io.one(bare(1, 'ping')), { jsonrpc: '2.0', id: 1, result: {} });
  const page = io.one(bare(2, 'tools/list', {})).result;
  assert.deepEqual(Object.keys(page).sort(), ['nextCursor', 'tools']);
  assert.deepEqual(io.one(bare(3, 'tools/list', { cursor: page.nextCursor })).result, { tools: [tool('t50')] });
  assert.deepEqual(io.one(bare(4, 'tools/list')).result.tools.length, 50, 'params are optional');
  io.line(bare(5, 'tools/call', { name: 't01', arguments: { a: 1 } }));
  assert.deepEqual(io.calls[0].client, { name: 'VS Code', version: '1.110.0' }, 'the client is the one initialize named');
  assert.deepEqual(io.calls[0].args, { a: 1 });
  await tick();
  assert.deepEqual(io.take(), [{ jsonrpc: '2.0', id: 5, result: { content: [{ type: 'text', text: 'done' }] } }]);
});

test('legacy tools/list_changed goes out after initialized, when the list hash moves', () => {
  const io = setup();
  io.one(INIT());
  io.hash = 'h2';
  io.c.changed();
  assert.deepEqual(io.take(), [], 'not before notifications/initialized');
  io.line(note('notifications/initialized'));
  io.c.changed();
  assert.deepEqual(io.take(), []);
  io.hash = 'h3';
  io.c.changed();
  assert.deepEqual(io.take(), [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }]);
  io.c.changed();
  assert.deepEqual(io.take(), []);
});

test('legacy progress and cancellation work as in the modern era', async () => {
  let finish;
  const io = legacy({ call: (c) => { io.calls.push(c); return new Promise((res) => { finish = res; }); } });
  io.line(bare(1, 'tools/call', { name: 'a_tool', _meta: { progressToken: 'p1' } }));
  assert.equal(io.calls[0].progress(1, 2), true);
  assert.deepEqual(io.take(), [{ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, total: 2 } }]);
  io.line(note('notifications/cancelled', { requestId: 1 }));
  assert.equal(io.calls[0].signal.aborted, true);
  finish({ content: [] });
  await tick();
  assert.deepEqual(io.take(), []);
});

// ---- both eras ------------------------------------------------------------------------------------------------------------
test('a batch is -32600, non-JSON is -32700, and neither has an id', () => {
  for (const io of [setup(), legacy()]) {
    for (const text of ['[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '[]']) {
      const m = io.one(text);
      assert.deepEqual(Object.keys(m).sort(), ['error', 'jsonrpc']);
      err(m, -32600);
    }
    for (const text of ['{', 'not json', '', '{"jsonrpc":"2.0","id":1,"method":"ping"} {}']) {
      const m = io.one(text);
      assert.deepEqual(Object.keys(m).sort(), ['error', 'jsonrpc']);
      err(m, -32700);
    }
  }
});

test('a line over 1 MiB of UTF-8 is -32600 and closes the connection; one at exactly 1 MiB is read', () => {
  const io = setup();
  io.line(req('s', 'subscriptions/listen', { notifications: { toolsListChanged: true } }));
  io.take();
  const pad = (n, ch = 'a') => { const head = JSON.stringify(req(1, 'tools/list', { pad: '' })); return head.replace('"pad":""', `"pad":"${ch.repeat(n)}"`); };
  const exact = pad(W.MAX - Buffer.byteLength(pad(0)));
  assert.equal(Buffer.byteLength(exact), W.MAX);
  assert.equal(io.one(exact).result.resultType, 'complete');
  // UTF-16 length under the cap, UTF-8 over it.
  const wide = pad(W.MAX / 2 + 1, 'é');
  assert.equal(wide.length < W.MAX && Buffer.byteLength(wide) > W.MAX, true);
  io.c.line(wide);
  const out = io.take();
  assert.deepEqual(out[0], { jsonrpc: '2.0', error: { code: -32600, message: out[0].error.message } });
  assert.deepEqual(io.ended, ['too-big']);
  assert.deepEqual(out.slice(1).map((m) => m.id ?? m.method), ['s', 'notifications/cancelled'], 'open subscriptions end gracefully');
  io.line(req(2, 'tools/list'));
  io.c.changed();
  assert.deepEqual(io.take(), [], 'a closed connection reads and sends nothing');
});

test('unknown methods are -32601 in both eras, and unknown notifications get no reply', () => {
  for (const io of [setup(), legacy()]) {
    err(io.one(req('u', 'glaze/secret')), -32601);
    io.line(note('notifications/whatever', { _meta: META }));
    io.line(note('notifications/roots/list_changed'));
    assert.deepEqual(io.take(), []);
  }
  const before = setup();
  before.line(note('notifications/initialized'));
  before.line(note('notifications/cancelled', { requestId: 1 }));
  assert.deepEqual(before.take(), []);
  assert.equal(before.c.snapshot().era, null);
});

test('malformed messages: bad ids and versions are -32600, responses from the client are dropped', () => {
  const io = setup();
  for (const m of [{ jsonrpc: '2.0', id: null, method: 'ping' }, { jsonrpc: '2.0', id: 1.5, method: 'ping' }, { jsonrpc: '2.0', id: {}, method: 'ping' }, { jsonrpc: '2.0', id: true, method: 'ping' }, 42, '"str"', null, true]) {
    const out = io.one(m);
    err(out, -32600);
    assert.equal('id' in out, false);
  }
  for (const m of [{ jsonrpc: '1.0', id: 3, method: 'ping' }, { id: 3, method: 'ping' }, { jsonrpc: '2.0', id: 3, method: 7 }, { jsonrpc: '2.0', id: 3 }]) {
    const out = io.one(m);
    err(out, -32600);
    assert.equal(out.id, 3);
  }
  for (const p of [[], 'x', 5]) err(io.one({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: p }), -32602);
  io.line({ jsonrpc: '2.0', id: 1, result: {} });
  io.line({ jsonrpc: '2.0', id: 1, error: { code: 1, message: 'x' } });
  io.line({ jsonrpc: '2.0', method: 'notifications/cancelled', params: 'x' });
  assert.deepEqual(io.take(), []);
});

test('an id already in flight is refused, and free again once answered', async () => {
  let finish;
  const io = setup({ call: (c) => { io.calls.push(c); return new Promise((res) => { finish = res; }); } });
  io.line(req(1, 'tools/call', { name: 'a_tool' }));
  err(io.one(req(1, 'tools/list')), -32600);
  io.line(req('1', 'tools/list'));
  assert.equal(io.take()[0].id, '1', '"1" and 1 are different ids');
  io.line(req('s', 'subscriptions/listen', { notifications: {} }));
  io.take();
  err(io.one(req('s', 'tools/list')), -32600);
  finish({ content: [] });
  await tick();
  io.take();
  assert.equal(io.one(req(1, 'tools/list')).id, 1);
});

// ---- close, snapshot and restore ----------------------------------------------------------------------------------------
test('close ends open subscriptions gracefully, aborts calls and silences the connection', async () => {
  let finish;
  const io = setup({ call: (c) => { io.calls.push(c); return new Promise((res) => { finish = res; }); } });
  io.line(req('s1', 'subscriptions/listen', { notifications: { toolsListChanged: true } }));
  io.line(req(2, 'tools/call', { name: 'a_tool' }, { progressToken: 't' }));
  io.take();
  io.c.close('off');
  assert.deepEqual(io.take(), [
    { jsonrpc: '2.0', id: 's1', result: { resultType: 'complete', _meta: { [K.sub]: 's1', [K.server]: SERVER } } },
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 's1', reason: 'off' } },
  ]);
  assert.equal(io.calls[0].signal.aborted, true);
  assert.equal(io.calls[0].progress(1), false);
  finish({ content: [] });
  await tick();
  io.line(req(3, 'tools/list'));
  io.hash = 'h2';
  io.c.changed();
  io.c.close('again');
  assert.deepEqual(io.take(), []);
  assert.deepEqual(io.ended, [], 'close() is the caller closing; end() is only for the engine closing');
});

test('a legacy connection resumes from its snapshot after a worker restart', async () => {
  const io = legacy();
  const snap = JSON.parse(JSON.stringify(io.c.snapshot()));
  assert.deepEqual(snap, { v: 1, era: 'legacy', version: '2025-11-25', client: { name: 'VS Code', version: '1.110.0' }, ready: true, hash: 'h1', subs: [] });
  const next = setup();
  const c = next.open('c1');
  assert.equal(c.restore(snap), true);
  next.c = c;
  assert.equal('resultType' in next.one(bare(1, 'tools/list', {})).result, false);
  err(next.one(INIT()), -32600);
  next.hash = 'h2';
  c.changed();
  assert.deepEqual(next.take(), [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }]);
  c.line(JSON.stringify(bare(2, 'tools/call', { name: 'a_tool' })));
  assert.deepEqual(next.calls[0].client, { name: 'VS Code', version: '1.110.0' });
  await tick();
});

test('a modern connection resumes its subscriptions, and a list that moved during the restart is announced', () => {
  const io = setup();
  io.line(req(7, 'subscriptions/listen', { notifications: { toolsListChanged: true } }));
  io.line(req('q', 'subscriptions/listen', { notifications: {} }));
  const snap = JSON.parse(JSON.stringify(io.c.snapshot()));
  assert.deepEqual(snap, { v: 1, era: 'modern', version: null, client: null, ready: false, hash: 'h1', subs: [{ id: 7, tools: true }, { id: 'q', tools: false }] });
  const next = setup();
  next.hash = 'h2';
  const c = next.open('c1');
  assert.equal(c.restore(snap), true);
  c.changed();
  assert.deepEqual(next.take(), [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { _meta: { [K.sub]: 7 } } }]);
  c.line(JSON.stringify(note('notifications/cancelled', { requestId: 7 })));
  next.hash = 'h3';
  c.changed();
  assert.deepEqual(next.take(), []);
  c.close('bye');
  assert.deepEqual(next.take().map((m) => m.id ?? m.params.requestId), ['q', 'q']);
});

test('restore refuses anything that is not a snapshot and leaves the connection fresh', () => {
  const good = { v: 1, era: 'modern', version: null, client: null, ready: false, hash: 'h1', subs: [] };
  const bad = [
    null, 'x', {}, { ...good, v: 2 }, { ...good, era: 'future' }, { ...good, era: 'legacy', version: '1999-01-01' }, { ...good, era: 'legacy', version: null },
    { ...good, subs: [{ id: null, tools: true }] }, { ...good, subs: [{ id: 1, tools: 'yes' }] }, { ...good, subs: 'all' },
    { ...good, era: 'legacy', version: '2025-11-25', subs: [{ id: 1, tools: true }] }, { ...good, subs: Array.from({ length: W.SUBS + 1 }, (_, i) => ({ id: i, tools: true })) },
    { ...good, subs: [{ id: 1, tools: true }, { id: 1, tools: false }] }, { ...good, client: { name: 5 } }, { ...good, hash: 7 }, { ...good, ready: 'no' },
  ];
  for (const snap of bad) {
    const io = setup();
    assert.equal(io.c.restore(snap), false, JSON.stringify(snap));
    assert.deepEqual(io.c.snapshot(), { v: 1, era: null, version: null, client: null, ready: false, hash: 'h1', subs: [] });
  }
  const closed = setup();
  closed.c.close('x');
  assert.equal(closed.c.restore(good), false);
});

// ---- the engine itself ----------------------------------------------------------------------------------------------------
test('create checks what it is given', () => {
  const ok = { serverInfo: SERVER, list: () => [], listHash: () => '', call: async () => ({ content: [] }) };
  assert.doesNotThrow(() => W.create(ok));
  for (const [what, over] of [['serverInfo', { serverInfo: { name: 'g' } }], ['serverInfo', { serverInfo: null }], ['list', { list: [] }], ['listHash', { listHash: 'h' }], ['call', { call: undefined }], ['instructions', { instructions: 5 }]]) {
    assert.throws(() => W.create({ ...ok, ...over }), (e) => e instanceof TypeError && e.message.includes(what), what);
  }
  assert.throws(() => W.create({ ...ok }).conn('c', PEER, 'send'), TypeError);
});

test('connections are independent', () => {
  const io = setup();
  const other = io.open('c2');
  io.one(INIT());
  other.line(JSON.stringify(req(1, 'tools/list')));
  assert.equal(io.take()[0].result.resultType, 'complete');
  assert.equal(io.c.snapshot().era, 'legacy');
  assert.equal(other.snapshot().era, 'modern');
});

test('the engine is pure: a classic script with no chrome.*, no timers and no imports', () => {
  const src = fs.readFileSync(require.resolve('../lib/mcp/wire.js'), 'utf8');
  for (const word of [/\bchrome\./, /\bbrowser\./, /setTimeout|setInterval|queueMicrotask/, /\bimportScripts\b/, /\brequire\(/, /\bfetch\(/]) assert.equal(word.test(src), false, String(word));
  const context = vm.createContext({ AbortController, TextEncoder, JSON });
  vm.runInContext(src, context);
  const wire = vm.runInContext('GZ_MCP_WIRE', context);
  const sent = [];
  wire.create({ serverInfo: SERVER, list: () => [], listHash: () => '', call: async () => ({ content: [] }) }).conn('c', PEER, (l) => sent.push(JSON.parse(l))).line(JSON.stringify(req(1, 'server/discover')));
  assert.equal(sent[0].result.supportedVersions[0], '2026-07-28');
});
