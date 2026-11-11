// glaze-mcp agent's session over a dropped connection (mcp/lib/session.js): pure, so every case runs on a made-up clock.
// What the app sent and what Glaze answered decide what goes each way after a reconnect.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../mcp/lib/session.js');
const W = require('../../extension/agents/wire.js');

const J = (o) => JSON.stringify({ jsonrpc: '2.0', ...o });
const P = (lines) => lines.map((l) => JSON.parse(l));
const INIT = { protocolVersion: '2025-11-25', capabilities: { roots: {} }, clientInfo: { name: 'Claude Code', version: '9.1' } };
const ANSWER = { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'glaze', title: 'Glaze', version: '4.0.6' } };
const REPLAY = 'glaze-mcp:t1';
const make = () => S.create({ version: '4.0.6', nonce: 't1' });
// A legacy session, initialized, connected at t=0.
const legacy = () => {
  const s = make();
  s.up(0, 'chrome');
  assert.deepEqual(s.fromApp(J({ id: 0, method: 'initialize', params: INIT }), 0).glaze, [J({ id: 0, method: 'initialize', params: INIT })]);
  assert.deepEqual(s.fromGlaze(J({ id: 0, result: ANSWER }), 0).app, [J({ id: 0, result: ANSWER })]);
  assert.deepEqual(s.fromApp(J({ method: 'notifications/initialized' }), 0).glaze, [J({ method: 'notifications/initialized' })]);
  return s;
};
// Up again, and Glaze's answer to the replayed initialize.
const back = (s, at, answer = ANSWER) => {
  const up = s.up(at, 'chrome');
  assert.deepEqual(P(up.glaze), [{ jsonrpc: '2.0', id: REPLAY, method: 'initialize', params: INIT }], 'the client\'s own params, verbatim, under a private id');
  assert.deepEqual(up.app, []);
  return s.fromGlaze(J({ id: REPLAY, result: answer }), at);
};

test('the versions an app may initialize with are the worker\'s', () => {
  assert.deepEqual(S.LEGACY, W.LEGACY);
});

test('connected: lines go through as they are, both ways', () => {
  const s = make();
  s.up(0, 'chrome');
  const odd = '{"x":"\u2028 é😀 \\r"}\r';
  assert.deepEqual(s.fromApp(odd, 0), { app: [], glaze: [odd] });
  assert.deepEqual(s.fromApp('not json', 0), { app: [], glaze: ['not json'] });
  assert.deepEqual(s.fromGlaze(J({ id: 3, result: {} }), 0), { app: [J({ id: 3, result: {} })], glaze: [] });
});

test('a reconnect replays initialize under a private id whose answer never reaches the app, then initialized, then one list_changed', () => {
  const s = legacy();
  assert.deepEqual(s.down(100), { app: [], glaze: [] });
  const r = back(s, 600);
  assert.deepEqual(r.glaze, [J({ method: 'notifications/initialized' })]);
  assert.deepEqual(r.app, [J({ method: 'notifications/tools/list_changed' })]);
  assert.equal(r.fatal, undefined);
  // Then everything as before.
  assert.deepEqual(s.fromApp(J({ id: 9, method: 'tools/list' }), 700).glaze, [J({ id: 9, method: 'tools/list' })]);
});

test('a tools/call in flight at a drop is answered -31002 and never resent', () => {
  const s = legacy();
  s.fromApp(J({ id: 5, method: 'tools/call', params: { name: 'todo_mark_done', arguments: {} } }), 10);
  const d = s.down(20);
  assert.deepEqual(d.glaze, []);
  const [e] = P(d.app);
  assert.equal(e.id, 5);
  assert.equal(e.error.code, -31002);
  assert.equal(e.error.message, 'Glaze\'s connection was interrupted; a change the student had allowed may have been made. Check before asking again.');
  const r = back(s, 500);
  assert.ok(!r.glaze.some((l) => l.includes('tools/call')), 'never resent');
  // A late answer to it from somewhere is not the app's business twice.
  assert.deepEqual(s.fromGlaze(J({ id: 5, result: {} }), 600).app, [J({ id: 5, result: {} })]);
});

test('a tools/list, server/discover and initialize in flight at a drop are resent once after the reconnect', () => {
  const s = legacy();
  s.fromApp(J({ id: 6, method: 'tools/list' }), 10);
  s.fromApp(J({ id: 7, method: 'server/discover', params: {} }), 10);
  const d = s.down(20);
  assert.deepEqual(d.app, []);
  const r = back(s, 500);
  assert.deepEqual(r.glaze, [J({ method: 'notifications/initialized' }), J({ id: 6, method: 'tools/list' }), J({ id: 7, method: 'server/discover', params: {} })]);
  assert.deepEqual(s.fromGlaze(J({ id: 6, result: { tools: [] } }), 600).app, [J({ id: 6, result: { tools: [] } })]);
  s.down(700);
  assert.ok(!back(s, 900).glaze.some((l) => l.includes('"id":6')), 'answered: not sent a third time');
  // An initialize Glaze never answered goes again as the app's own, not as a replay.
  const f = make();
  f.up(0, 'chrome');
  f.fromApp(J({ id: 0, method: 'initialize', params: INIT }), 0);
  f.down(10);
  assert.deepEqual(f.up(500, 'chrome').glaze, [J({ id: 0, method: 'initialize', params: INIT })]);
});

test('while down: lines are held in order, up to 10 s a request and 1 MiB in all, then answered -31003 naming what to open', () => {
  const s = legacy();
  s.down(0);
  assert.deepEqual(s.fromApp(J({ id: 1, method: 'tools/list' }), 100), { app: [], glaze: [] });
  assert.deepEqual(s.fromApp(J({ method: 'notifications/cancelled', params: { requestId: 99 } }), 200), { app: [], glaze: [] });
  assert.deepEqual(s.tick(10099), { app: [], glaze: [] });
  const t = P(s.tick(10100).app);
  assert.deepEqual(t.map((m) => [m.id, m.error.code]), [[1, -31003]]);
  assert.match(t[0].error.message, /chrome/);
  assert.match(t[0].error.message, /Settings → AI → Agents/);
  // 1 MiB in all: the request that would pass it is answered at once.
  const big = J({ id: 2, method: 'tools/call', params: { name: 'x', arguments: { s: 'a'.repeat(S.HOLD - 200) } } });
  assert.deepEqual(s.fromApp(big, 10200).app, []);
  const over = P(s.fromApp(J({ id: 3, method: 'tools/call', params: { name: 'x', arguments: { s: 'b'.repeat(300) } } }), 10300).app);
  assert.deepEqual(over.map((m) => [m.id, m.error.code]), [[3, -31003]]);
  assert.ok(s.held() <= S.HOLD);
  // Held lines go in order once Glaze is back, after the replay.
  const r = back(s, 10400);
  assert.deepEqual(P(r.glaze).map((m) => m.method || m.id), ['notifications/initialized', 'notifications/cancelled', 'tools/call']);
});

test('moving safe in-flight requests into the reconnect queue enforces its total byte limit', () => {
  const s = make();
  s.up(0, 'chrome');
  const request = (id) => J({ id, method: 'tools/list', params: { extra: 'x'.repeat(Math.floor(S.HOLD * 0.6)) } });
  const first = request(1), second = request(2);
  s.fromApp(first, 0);
  s.fromApp(second, 0);
  const dropped = s.down(1);
  assert.ok(s.held() <= S.HOLD, `held ${s.held()} bytes`);
  assert.deepEqual(P(dropped.app).map((m) => [m.id, m.error.code]), [[2, S.AWAY]]);
  assert.deepEqual(s.up(2, 'chrome').glaze, [first]);
});

test('ping while down is answered at once, without Glaze', () => {
  const s = legacy();
  s.fromApp(J({ id: 'p1', method: 'ping' }), 10);
  assert.deepEqual(P(s.down(20).app), [{ jsonrpc: '2.0', id: 'p1', result: {} }], 'a ping in flight at the drop');
  assert.deepEqual(P(s.fromApp(J({ id: 'p2', method: 'ping' }), 30).app), [{ jsonrpc: '2.0', id: 'p2', result: {} }]);
  assert.ok(!back(s, 500).glaze.some((l) => l.includes('ping')));
});

test('a connection or replay answer at the waiting deadline expires queued calls before sending them', () => {
  const call = J({ id: 8, method: 'tools/call', params: { name: 'todo_mark_done', arguments: {} } });
  const first = make();
  first.fromApp(call, 0);
  const initial = first.up(S.WAIT, 'chrome');
  assert.deepEqual(initial.glaze, [], 'a late first connection cannot execute an expired call');
  assert.equal(P(initial.app)[0].error.code, S.AWAY);

  const s = legacy();
  s.down(0);
  s.fromApp(call, 0);
  s.up(S.WAIT - 1, 'chrome');
  const resumed = s.fromGlaze(J({ id: REPLAY, result: ANSWER }), S.WAIT);
  assert.deepEqual(resumed.glaze, [J({ method: 'notifications/initialized' })]);
  assert.deepEqual(P(resumed.app).filter((m) => m.id === 8).map((m) => m.error.code), [S.AWAY]);
  assert.equal(s.held(), 0);
});

test('a replay that errors or answers another protocolVersion is fatal', () => {
  const s = legacy();
  s.down(0);
  const r = back(s, 500, { ...ANSWER, protocolVersion: '2025-06-18' });
  assert.match(r.fatal, /2025-06-18/);
  assert.deepEqual(r.app, []);
  const e = legacy();
  e.down(0);
  e.up(500, 'chrome');
  const x = e.fromGlaze(J({ id: REPLAY, error: { code: -32600, message: 'Already initialized.' } }), 500);
  assert.match(x.fatal, /Already initialized/);
  assert.deepEqual(x.app, []);
});

test('reconnect replays the initialize that succeeded after an earlier initialize was rejected', () => {
  const s = make();
  s.up(0, 'chrome');
  s.fromApp(J({ id: 1, method: 'initialize', params: { protocolVersion: INIT.protocolVersion } }), 0);
  s.fromGlaze(J({ id: 1, error: { code: -32602, message: 'Invalid params.' } }), 1);
  s.fromApp(J({ id: 2, method: 'initialize', params: INIT }), 2);
  s.fromGlaze(J({ id: 2, result: ANSWER }), 3);
  s.fromApp(J({ method: 'notifications/initialized' }), 4);
  s.down(5);
  assert.deepEqual(P(s.up(6, 'chrome').glaze), [{ jsonrpc: '2.0', id: REPLAY, method: 'initialize', params: INIT }]);
});

test('an app started before the browser gets its initialize answered, and the first connection replays it', () => {
  const s = make();
  assert.deepEqual(s.fromApp(J({ id: 0, method: 'initialize', params: INIT }), 0), { app: [], glaze: [] });
  const [a] = P(s.tick(S.WAIT).app);
  assert.deepEqual(a, { jsonrpc: '2.0', id: 0, result: { protocolVersion: '2025-11-25', capabilities: { tools: { listChanged: true } }, serverInfo: { name: 'glaze', title: 'Glaze', version: '4.0.6' } } });
  assert.deepEqual(s.fromApp(J({ method: 'notifications/initialized' }), S.WAIT + 1), { app: [], glaze: [] });
  const r = back(s, S.WAIT + 500);
  assert.deepEqual(r.glaze, [J({ method: 'notifications/initialized' })], 'initialized once, from the replay');
  assert.deepEqual(r.app, [J({ method: 'notifications/tools/list_changed' })]);
  // A version Glaze doesn't speak gets the worker's own choice; invalid params its own error.
  const o = make();
  o.fromApp(J({ id: 1, method: 'initialize', params: { ...INIT, protocolVersion: '2024-11-05' } }), 0);
  assert.equal(P(o.tick(S.WAIT).app)[0].result.protocolVersion, W.LEGACY[0]);
  const bad = make();
  bad.fromApp(J({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }), 0);
  assert.equal(P(bad.tick(S.WAIT).app)[0].error.code, -32602);
  // Connected within the wait: the app's initialize goes to Glaze as it is, and nothing is replayed.
  const quick = make();
  quick.fromApp(J({ id: 0, method: 'initialize', params: INIT }), 0);
  assert.deepEqual(quick.up(300, 'chrome').glaze, [J({ id: 0, method: 'initialize', params: INIT })]);
});

test('a cancelled request is out of flight; a subscription is resent, its second acknowledgement kept from the app', () => {
  const s = make();
  s.up(0, 'chrome');
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
  const listen = J({ id: 'L', method: 'subscriptions/listen', params: { _meta: meta, notifications: { toolsListChanged: true } } });
  s.fromApp(listen, 0);
  const ack = J({ method: 'notifications/subscriptions/acknowledged', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'L' }, notifications: { toolsListChanged: true } } });
  assert.deepEqual(s.fromGlaze(ack, 0).app, [ack]);
  s.fromApp(J({ id: 4, method: 'tools/call', params: { name: 'x' } }), 0);
  s.fromApp(J({ method: 'notifications/cancelled', params: { requestId: 4 } }), 0);
  assert.deepEqual(s.down(10).app, [], 'nothing for the cancelled call');
  const up = s.up(500, 'chrome');
  assert.deepEqual(up.glaze, [listen]);
  assert.deepEqual(up.app, [], 'the subscription is restored only once Glaze acknowledges it');
  assert.deepEqual(P(s.fromGlaze(ack, 500).app), [{ jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'L' } } }]);
  assert.deepEqual(s.fromGlaze(ack, 600).app, [ack], 'only the one');
});

test('a subscription cut off before its first acknowledgement still receives that acknowledgement after reconnect', () => {
  const s = make();
  s.up(0, 'chrome');
  const listen = J({ id: 'L', method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true } } });
  const ack = J({ method: 'notifications/subscriptions/acknowledged', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'L' } } });
  s.fromApp(listen, 0);
  s.down(1);
  const up = s.up(2, 'chrome');
  assert.deepEqual(up.glaze, [listen]);
  assert.deepEqual(up.app, [], 'no event before the subscription is acknowledged');
  const r = s.fromGlaze(ack, 3);
  assert.deepEqual(r.app, [ack, J({ method: 'notifications/tools/list_changed', params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'L' } } })]);
});

test('tries: every 250 ms for 5 s, then doubling to 2 s; from 250 ms again after 30 s connected', () => {
  const s = legacy();
  s.down(0);
  assert.deepEqual([0, 4999, 5000, 5500, 6500, 8500, 10500].map((t) => s.delay(t)), [250, 250, 500, 1000, 2000, 2000, 2000]);
  s.up(11000, 'chrome');
  s.down(12000);
  assert.equal(s.delay(12000), 2000, 'a short connection keeps the slow pace');
  s.up(13000, 'chrome');
  s.down(43000);
  assert.equal(s.delay(43000), 250);
});
