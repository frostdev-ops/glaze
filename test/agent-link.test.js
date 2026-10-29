// The worker's link to the glaze-mcp host (lib/agent-link.js), against a fake connectNative: every state, the browsers' own
// error strings, backoff on fake timers, triggers, reassembly per connection, bye and disconnect on stop, Safari's serial
// batches, instance filter and keep-alive, and that nothing else in the repo calls connectNative.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const L = require('../lib/agent-link.js');
const F = require('../lib/agent-frames.js');
const G = require('../lib/mcp/grants.js');

const root = path.join(__dirname, '..');
const HOST = 'io.frostdev.glaze_mcp', APP = 'io.frostdev.Glaze';
const HELLO = { t: 'hello', v: 1, host: '0.1.0', os: 'linux', browser: 'chrome', node: '22.11.0' };
const EXITED = 'Native host has exited.', NOT_FOUND = 'Specified native messaging host not found.';
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// Timers on a clock of their own: advance(ms) runs what falls due, in time order.
const clock = () => {
  let t = 1_000_000, id = 0;
  const jobs = new Map();
  const add = (fn, ms, every) => { jobs.set(++id, { at: t + ms, fn, every: every ? ms : 0 }); return id; };
  const timers = {
    setTimeout: (fn, ms) => add(fn, ms, false), clearTimeout: (k) => jobs.delete(k),
    setInterval: (fn, ms) => add(fn, ms, true), clearInterval: (k) => jobs.delete(k),
  };
  const advance = async (ms) => {
    const end = t + ms;
    for (;;) {
      const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [k, j] = due;
      t = j.at;
      if (j.every) j.at += j.every; else jobs.delete(k);
      j.fn();
      await settle();
    }
    t = end;
    await settle();
  };
  return { now: () => t, timers, advance, jobs, pending: () => [...jobs.values()] };
};

const area = (init = {}) => {
  const data = structuredClone(init), writes = [];
  return {
    data, writes,
    get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(data, k)).map((k) => [k, structuredClone(data[k])])),
    set: async (o) => { writes.push(structuredClone(o)); Object.assign(data, structuredClone(o)); },
  };
};

// A native port as Chrome and Firefox give one. host(m) is the far side posting m; die(message) closes it the way Chrome
// does (runtime.lastError, set only while onDisconnect runs) or Firefox does (port.error, null for a clean exit).
const fakePort = (name, runtime, log) => {
  const heard = [], gone = [];
  const p = {
    name, sent: [], disconnected: false, error: undefined,
    onMessage: { addListener: (f) => heard.push(f) },
    onDisconnect: { addListener: (f) => gone.push(f) },
    postMessage(m) {
      if (p.disconnected) throw new Error('Attempting to use a disconnected port object');
      p.sent.push(structuredClone(m));
      log.push(['post', m.t]);
    },
    disconnect() { p.disconnected = true; log.push(['disconnect']); },
    host(m) { for (const f of heard) f(structuredClone(m), p); },
    die(message, { firefox = false } = {}) {
      p.disconnected = true;
      if (firefox) p.error = message == null ? null : { message };
      else runtime.lastError = message == null ? undefined : { message };
      for (const f of gone) f(p);
      runtime.lastError = undefined;
    },
  };
  return p;
};

// One worker: storage (shared when given, as a restarted worker sees its predecessor's), a runtime with or without
// connectNative, the grant, and on Safari a sendNativeMessage whose replies the test gives.
const world = ({ browser = 'chrome', granted = true, native = true, on = true, local = {}, storage } = {}) => {
  const c = clock();
  const ports = [], batches = [], log = [], events = [];
  const runtime = { lastError: undefined, getManifest: () => ({ version: '4.0.0' }) };
  if (native) runtime.connectNative = (name) => { const p = fakePort(name, runtime, log); ports.push(p); return p; };
  if (browser === 'safari') {
    runtime.sendNativeMessage = (app, msg) => new Promise((resolve, reject) => {
      batches.push({ app, msg: structuredClone(msg), resolve, reject });
      log.push(['batch', msg.seq]);
    });
  }
  const permissions = {
    granted, asked: 0,
    contains: async (q) => { permissions.asked++; assert.deepEqual(q, { permissions: ['nativeMessaging'] }); return permissions.granted; },
  };
  storage ||= { local: area({ ...(on ? { mcp: { on: true } } : {}), ...local }), session: area() };
  const random = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
  const env = { runtime, permissions, storage, browser, timers: c.timers, now: c.now, random };
  const link = L.make(env);
  link.attach({
    open: (k, peer) => events.push(['open', k, peer]),
    line: (k, text) => events.push(['line', k, text]),
    close: (k, why) => events.push(['close', k, why]),
    state: (s) => events.push(['state', s.state]),
  });
  return { ...c, env, link, ports, batches, log, events, permissions, storage, runtime, port: () => ports[ports.length - 1] };
};
const connected = async (opts) => {
  const w = world(opts);
  await w.link.ensure();
  w.port().host(HELLO);
  await settle();
  return w;
};
const said = (w, kind) => w.events.filter((e) => e[0] === kind);

test('off unless storage.local mcp says on, as lib/mcp/grants.js reads it; the first pass overwrites a stale session', async () => {
  for (const mcp of [undefined, null, {}, { on: false }, { on: 'true' }, { on: 1 }, true, ['on']]) {
    assert.equal(G.clean(mcp).on, false);
    const w = world({ on: false, local: mcp === undefined ? {} : { mcp } });
    w.storage.session.data.mcpLink = { state: 'connected', at: 5, host: '0.1.0', browser: 'chrome' };
    assert.deepEqual(await w.link.ensure(), { state: 'off', at: w.now() }, JSON.stringify(mcp));
    assert.deepEqual(w.storage.session.data.mcpLink, { state: 'off', at: w.now() }, 'a previous worker\'s state is replaced');
    assert.equal(w.ports.length, 0);
    assert.equal(w.permissions.asked, 0);
    await w.link.ensure();
    assert.equal(w.storage.session.writes.length, 1, 'an unchanged state writes nothing');
  }
  assert.equal(G.clean({ on: true }).on, true);
  assert.equal((await world().link.ensure()).state, 'connecting');
});

test('needs-permission while nativeMessaging is not granted; nothing connects', async () => {
  const w = world({ granted: false });
  assert.deepEqual(await w.link.ensure(), { state: 'needs-permission', at: w.now() });
  assert.equal(w.ports.length, 0);
  assert.deepEqual(w.storage.session.data.mcpLink, { state: 'needs-permission', at: w.now() });
  w.permissions.granted = true;
  assert.equal((await w.link.ensure()).state, 'connecting', 'permissions.onAdded is a trigger');
});

test('restart: granted, but this worker started before the grant and has no connectNative; it waits for the next worker', async () => {
  const w = world({ native: false });
  assert.deepEqual(await w.link.ensure(), { state: 'restart', at: w.now() });
  assert.deepEqual(w.storage.session.data.mcpLink, { state: 'restart', at: w.now() }, 'the options page reads it without waking the worker');
  assert.equal(w.jobs.size, 0, 'no timer: nothing retries');
  await w.advance(10 * 60e3);
  assert.equal((await w.link.ensure()).state, 'restart', 'a trigger in the same worker changes nothing');
  assert.equal(w.storage.session.writes.length, 1);

  const next = world({ storage: w.storage });
  assert.equal((await next.link.ensure()).state, 'connecting', 'the next worker start connects');
  assert.equal(next.port().name, HOST);
  next.port().host(HELLO);
  await settle();
  assert.equal(next.storage.session.data.mcpLink.state, 'connected');
});

test('connecting says hello with this profile\'s instance; the host\'s hello makes it connected', async () => {
  const w = world();
  assert.deepEqual(await w.link.ensure(), { state: 'connecting', at: w.now() });
  const p = w.port();
  assert.equal(p.name, HOST);
  const instance = w.storage.local.data.mcpInstance;
  assert.match(instance, /^[0-9a-f]{20}$/);
  assert.deepEqual(p.sent, [{ t: 'hello', v: 1, glaze: '4.0.0', instance }]);
  assert.ok(F.valid.toHost(p.sent[0]));
  p.host(HELLO);
  assert.deepEqual(w.link.status(), { state: 'connected', at: w.now(), host: '0.1.0', browser: 'chrome' });
  await settle();
  assert.deepEqual(w.storage.session.data.mcpLink, w.link.status());
  assert.deepEqual(said(w, 'state'), [['state', 'connecting'], ['state', 'connected']]);
  assert.equal(w.jobs.size, 0, 'nothing ticks while connected on Chrome: the open port keeps the worker');
  assert.equal((await w.link.ensure()).state, 'connected', 'a trigger while connected changes nothing');
  assert.equal(w.ports.length, 1);

  const again = world({ local: { mcpInstance: instance } });
  await again.link.ensure();
  assert.equal(again.port().sent[0].instance, instance, 'kept in storage.local');
  assert.equal(again.storage.local.writes.length, 0);
  for (const bad of ['short', 'A'.repeat(20), 'g'.repeat(20), 7, { id: 'x' }, '0'.repeat(21)]) {
    const b = world({ local: { mcpInstance: bad } });
    await b.link.ensure();
    assert.match(b.port().sent[0].instance, /^[0-9a-f]{20}$/, JSON.stringify(bad));
    assert.equal(b.storage.local.data.mcpInstance, b.port().sent[0].instance);
  }
});

test('the browsers\' own words pick the state: Chrome\'s lastError, Firefox\'s port.error', async () => {
  const cases = [
    ['chrome', NOT_FOUND, 'not-installed'],
    ['chrome', 'Access to the specified native messaging host is forbidden.', 'forbidden'],
    ['chrome', 'Invalid native messaging host name specified.', 'not-installed'],
    ['chrome', EXITED, 'exited'],
    ['chrome', 'Error when communicating with the native messaging host.', 'exited'],
    ['chrome', undefined, 'exited'],
    // Firefox says this for a missing manifest and for one that doesn't list Glaze (NativeMessaging.sys.mjs).
    ['firefox', `No such native application ${HOST}`, 'not-installed'],
    ['firefox', null, 'exited'],
    ['firefox', 'An unexpected error occurred', 'exited'],
  ];
  for (const [browser, message, state] of cases) {
    const w = world({ browser });
    await w.link.ensure();
    w.port().die(message, { firefox: browser === 'firefox' });
    await settle();
    const want = { state, at: w.now(), ...(message ? { error: message } : {}) };
    assert.deepEqual(w.link.status(), want, `${browser}: ${message}`);
    assert.deepEqual(w.storage.session.data.mcpLink, want);
    assert.deepEqual(w.pending().map((j) => j.at - w.now()), state === 'exited' ? [1000] : [], `${message}: only exited retries by itself`);
  }
  const thrown = world();
  thrown.runtime.connectNative = () => { throw new Error('Invalid native messaging host name specified.'); };
  assert.equal((await thrown.link.ensure()).state, 'not-installed', 'a throwing connectNative reads the same');
});

test('not-installed and forbidden wait for a trigger, and a retry keeps showing the last answer until it has its own', async () => {
  for (const message of [NOT_FOUND, 'Access to the specified native messaging host is forbidden.']) {
    const w = world();
    await w.link.ensure();
    w.port().die(message);
    await settle();
    const { at } = w.link.status(), writes = w.storage.session.writes.length;
    await w.advance(10 * 60e3);
    assert.equal(w.ports.length, 1, 'no timer retries');
    await w.link.ensure();
    assert.equal(w.ports.length, 2, 'a trigger tries again');
    assert.equal(w.link.status().state, message === NOT_FOUND ? 'not-installed' : 'forbidden', 'no flicker to connecting');
    w.port().die(message);
    await settle();
    assert.equal(w.storage.session.writes.length, writes, 'the same answer writes nothing');
    assert.equal(w.link.status().at, at);
    await w.link.ensure();
    w.port().host(HELLO);
    assert.equal(w.link.status().state, 'connected');
    assert.equal(w.link.status().error, undefined);
  }
});

test('exited backs off from 1 s, doubling to 60 s, and starts again at 1 s after 5 minutes connected', async () => {
  const w = world();
  await w.link.ensure();
  const delays = [];
  for (let i = 0; i < 9; i++) {
    w.port().die(EXITED);
    await settle();
    const [job] = w.pending();
    delays.push(job.at - w.now());
    assert.equal((await w.link.ensure()).state, 'exited');
    assert.equal(w.ports.length, i + 1, 'a trigger waits out the backoff');
    await w.advance(job.at - w.now());
    assert.equal(w.ports.length, i + 2, 'the timer tries again');
  }
  assert.deepEqual(delays, [1e3, 2e3, 4e3, 8e3, 16e3, 32e3, 60e3, 60e3, 60e3]);

  w.port().host(HELLO);
  await w.advance(4 * 60e3);
  w.port().die(EXITED);
  await settle();
  assert.deepEqual(w.pending().map((j) => j.at - w.now()), [60e3], 'under 5 minutes connected: still backing off');
  await w.advance(60e3);
  w.port().host(HELLO);
  await w.advance(5 * 60e3);
  w.port().die(EXITED);
  await settle();
  assert.deepEqual(w.pending().map((j) => j.at - w.now()), [1e3], 'after 5 minutes connected: 1 s again');
});

test('a host that never says hello is dropped after 30 s and tried again as exited', async () => {
  const w = world();
  await w.link.ensure();
  await w.advance(29_999);
  assert.equal(w.link.status().state, 'connecting');
  await w.advance(1);
  assert.ok(w.ports[0].disconnected, 'the link kills the silent host');
  assert.equal(w.link.status().state, 'exited');
  assert.equal(w.link.status().error, 'timeout');
  await w.advance(1000);
  assert.equal(w.ports.length, 2);
});

test('an old helper: a hello with another version, or any other frame first, or a bad frame later; dropped, not retried', async () => {
  const frames = [
    [{ ...HELLO, v: 2 }],
    [{ t: 'hello', v: 0 }],
    [{ t: 'open', c: 1, peer: { verified: false } }],
    [{ ...HELLO, extra: 1 }],
    [HELLO, { t: 'line', c: 1, d: 5 }],
    [HELLO, HELLO],
    [HELLO, { t: 'bye' }],
  ];
  for (const list of frames) {
    const w = world();
    await w.link.ensure();
    for (const f of list) w.port().host(f);
    await settle();
    assert.equal(w.link.status().state, 'old-helper', JSON.stringify(list));
    assert.ok(w.port().disconnected);
    assert.equal(w.jobs.size, 0);
    await w.link.ensure();
    assert.equal(w.ports.length, 2, 'a trigger (the helper updated) tries again');
  }
  const w = await connected();
  w.port().host({ t: 'open', c: 3, peer: { verified: false } });
  w.port().host({ t: 'line', c: 3, d: 'x'.repeat(F.PIECE + 1) });
  assert.equal(w.link.status().state, 'old-helper');
  assert.deepEqual(said(w, 'close'), [['close', 3, 'gone']]);
});

test('connections: each opens with its peer, lines come back whole from interleaved pieces, and close either way', async () => {
  const w = await connected();
  const p = w.port();
  const claude = { name: 'claude-code', exe: '/usr/bin/claude', ppid: 7, verified: false };
  p.host({ t: 'open', c: 1, peer: claude });
  p.host({ t: 'open', c: 2, peer: { verified: false } });
  p.host({ t: 'line', c: 9, d: 'nobody opened 9' });
  const a = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { text: 'a'.repeat(400_000) } });
  const b = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: { e: '😀'.repeat(200_000) } });
  const fa = F.split(1, a), fb = F.split(2, b);
  assert.ok(fa.length === 3 && fb.length === 3);
  for (let i = 0; i < 3; i++) { p.host(fb[i]); p.host(fa[i]); }
  p.host({ t: 'line', c: 1, d: 'short' });
  assert.deepEqual(w.events.filter((e) => e[0] !== 'state'), [
    ['open', 1, claude], ['open', 2, { verified: false }], ['line', 2, b], ['line', 1, a], ['line', 1, 'short'],
  ]);
  w.events.length = 0;
  p.host({ t: 'line', c: 2, d: 'half', m: 1 });
  p.host({ t: 'close', c: 2, why: 'eof' });
  p.host({ t: 'line', c: 2, d: ' and the rest' });
  p.host({ t: 'close', c: 2, why: 'again' });
  assert.deepEqual(w.events, [['close', 2, 'eof']], 'a closed connection hears nothing more, and its half line is gone');
  p.host({ t: 'open', c: 1, peer: { verified: true } });
  assert.deepEqual(w.events, [['close', 2, 'eof']], 'an open connection is not opened twice');
  p.host({ t: 'error', why: 'run folder refused' });
  assert.deepEqual(w.link.status(), { state: 'connected', at: w.now(), host: '0.1.0', browser: 'chrome', error: 'run folder refused' });
  p.host({ t: 'open', c: 4, peer: { verified: false } });
  w.events.length = 0;
  p.die(EXITED);
  assert.deepEqual(w.events.filter((e) => e[0] === 'close').sort(), [['close', 1, 'gone'], ['close', 4, 'gone']], 'the port going closes every connection');
  assert.equal(w.link.status().error, 'run folder refused', 'the helper\'s own reason outlives the browser\'s');
});

test('a line over 64 MiB closes its connection as too-long, both ways, and the rest of its pieces are dropped', async () => {
  const w = await connected();
  const p = w.port();
  p.host({ t: 'open', c: 5, peer: { verified: false } });
  const d = 'x'.repeat(F.PIECE), n = Math.ceil(F.LINE / F.PIECE) + 2;
  for (let i = 0; i < n; i++) p.host({ t: 'line', c: 5, d, m: 1 });
  p.host({ t: 'line', c: 5, d: 'end' });
  assert.deepEqual(w.events.filter((e) => e[0] !== 'state' && e[0] !== 'open'), [['close', 5, 'too-long']]);
  assert.deepEqual(p.sent.slice(1), [{ t: 'close', c: 5, why: 'too-long' }]);
  assert.equal(w.link.status().state, 'connected', 'one connection, not the link');
});

test('send splits a line into frames the host takes; close tells the host; nothing goes to a closed or unknown connection', async () => {
  const w = await connected();
  const p = w.port();
  assert.equal(w.link.send(1, 'x'), false, 'not open yet');
  p.host({ t: 'open', c: 1, peer: { verified: false } });
  const text = `${'\u0001'.repeat(F.PIECE)}${'😀'.repeat(F.PIECE / 2)}tail`;
  assert.equal(w.link.send(1, text), true);
  const lines = p.sent.filter((f) => f.t === 'line');
  assert.deepEqual(lines, F.split(1, text));
  assert.ok(lines.length === 3 && lines.every((f) => F.valid.toHost(f) && F.bytes(f) <= F.FRAME));
  assert.equal(w.link.send(1, 42), false);
  assert.equal(w.link.send(2, 'x'), false);
  w.events.length = 0;
  assert.equal(w.link.close(1, 'done'), true);
  assert.deepEqual(p.sent.at(-1), { t: 'close', c: 1, why: 'done' });
  assert.deepEqual(w.events, [], 'the caller closed it, so it isn\'t told');
  assert.equal(w.link.send(1, 'x'), false);
  assert.equal(w.link.close(1, 'again'), false);
  p.host({ t: 'line', c: 1, d: 'in flight' });
  assert.deepEqual(w.events, []);
  p.host({ t: 'open', c: 2, peer: { verified: false } });
  w.link.close(2, 'w'.repeat(5000));
  assert.ok(F.valid.toHost(p.sent.at(-1)), 'a long reason is cut to what the host takes');
});

test('stop says bye, then disconnects the port itself (permissions.remove leaves it open), and closes every connection', async () => {
  const w = await connected();
  const p = w.port();
  p.host({ t: 'open', c: 1, peer: { verified: false } });
  w.events.length = 0;
  w.log.length = 0;
  assert.deepEqual(await w.link.stop(), { state: 'off', at: w.now() });
  assert.deepEqual(w.log, [['post', 'bye'], ['disconnect']]);
  assert.deepEqual(p.sent.at(-1), { t: 'bye' });
  assert.deepEqual(w.events, [['close', 1, 'stopped'], ['state', 'off']]);
  assert.deepEqual(w.storage.session.data.mcpLink, { state: 'off', at: w.now() });
  assert.equal(w.link.send(1, 'x'), false);
  assert.equal(w.jobs.size, 0);
  assert.equal((await w.link.ensure()).state, 'connecting', 'the setting is still on, so a trigger connects again');

  const backing = world();
  await backing.link.ensure();
  backing.port().die(EXITED);
  await backing.link.stop();
  assert.equal(backing.jobs.size, 0, 'stop cancels a pending retry');
  await backing.advance(120e3);
  assert.equal(backing.ports.length, 1);
});

test('triggers: ensure follows the setting and the grant either way, one pass at a time', async () => {
  const w = world();
  const [a, b] = await Promise.all([w.link.ensure(), w.link.ensure()]);
  assert.equal(w.ports.length, 1, 'two triggers at once connect once');
  assert.equal(a.state, 'connecting');
  assert.equal(b.state, 'connecting');
  w.port().host(HELLO);
  w.port().host({ t: 'open', c: 1, peer: { verified: false } });

  w.storage.local.data.mcp = { on: false };
  w.log.length = 0;
  assert.equal((await w.link.ensure()).state, 'off', 'turning it off is a trigger too');
  assert.deepEqual(w.log, [['post', 'bye'], ['disconnect']]);
  assert.deepEqual(said(w, 'close'), [['close', 1, 'stopped']]);

  w.storage.local.data.mcp = { on: true };
  await w.link.ensure();
  w.port().host(HELLO);
  w.permissions.granted = false;
  w.log.length = 0;
  assert.equal((await w.link.ensure()).state, 'needs-permission', 'a grant taken away elsewhere');
  assert.deepEqual(w.log, [['post', 'bye'], ['disconnect']]);

  w.permissions.granted = true;
  await w.link.ensure();
  w.port().die(EXITED);
  w.permissions.granted = false;
  await w.link.ensure();
  assert.equal(w.jobs.size, 0, 'no retry without the grant');

  for (const browser of ['chrome', 'safari']) {
    const racing = world({ browser, local: { mcpInstance: '0123456789abcdef0123' } });
    const pass = racing.link.ensure();
    racing.link.stop();
    await pass;
    assert.equal(racing.ports.length, 0, `${browser}: a stop during a pass leaves nothing connected`);
    assert.equal(racing.link.status().state, 'off');
  }
  const asking = world({ local: { mcpInstance: '0123456789abcdef0123' } });
  let answer;
  asking.permissions.contains = () => new Promise((r) => { answer = r; });
  const pass = asking.link.ensure();
  await settle();
  asking.link.stop();
  answer(true);
  await pass;
  assert.equal(asking.ports.length, 0, 'nor a stop while the grant is being checked');
});

test('a late message, answer or close from an earlier session changes nothing', async () => {
  const w = world();
  await w.link.ensure();
  const first = w.port();
  first.host({ ...HELLO, v: 2 });
  await w.link.ensure();
  first.host(HELLO);
  first.die(EXITED);
  assert.equal(w.ports.length, 2);
  assert.equal(w.link.status().state, 'old-helper', 'the new try still waits for its own hello');
  w.port().host(HELLO);
  assert.equal(w.link.status().state, 'connected');

  const s = world({ browser: 'safari' });
  for (let n = 0; n < 2; n++) {
    await s.link.ensure();
    await s.link.stop();
  }
  await s.link.ensure();
  const hellos = s.batches.filter((x) => x.msg.frames[0]?.t === 'hello');
  assert.equal(hellos.length, 3);
  hellos[0].resolve({ echo: hellos[0].msg });
  hellos[1].reject(new Error('late'));
  await settle();
  assert.equal(s.link.status().state, 'connecting', 'earlier sessions\' answers are not this one\'s');
  const i = s.storage.local.data.mcpInstance;
  s.ports[0].host({ name: 'agent.frames', userInfo: { i, frames: [HELLO] } });
  assert.equal(s.link.status().state, 'connecting', 'nor are their ports\' frames');
  s.port().host({ name: 'agent.frames', userInfo: { i, frames: [{ ...HELLO, v: 2 }, HELLO] } });
  assert.equal(s.link.status().state, 'old-helper', 'and frames after the one that ended a session are dropped with it');
});

test('Safari: batches to the Glaze app, one in flight, numbered in order; frames back only for this instance', async () => {
  const w = world({ browser: 'safari' });
  assert.equal((await w.link.ensure()).state, 'connecting');
  assert.equal(w.permissions.asked, 0, 'Safari requires nativeMessaging');
  assert.equal(w.port().name, APP, 'the port only hears the app\'s dispatchMessage');
  const i = w.storage.local.data.mcpInstance;
  assert.deepEqual(w.batches.map((x) => [x.app, x.msg]), [[APP, { type: 'agent.frames', i, seq: 1, frames: [{ t: 'hello', v: 1, glaze: '4.0.0', instance: i }] }]]);
  assert.deepEqual(w.port().sent, [], 'nothing is posted on the port');

  const app = (userInfo, name = 'agent.frames') => w.port().host({ name, userInfo });
  app({ i: 'another profile', frames: [HELLO] });
  app({ i, frames: [HELLO] }, 'something.else');
  app({ frames: [HELLO] });
  app({ i, frames: HELLO });
  assert.equal(w.link.status().state, 'connecting', 'another instance\'s frames, or another message, count for nothing');
  app({ i, frames: [{ ...HELLO, browser: 'safari' }, { t: 'open', c: 1, peer: { verified: true } }] });
  assert.deepEqual(w.link.status(), { state: 'connected', at: w.now(), host: '0.1.0', browser: 'safari' });
  assert.deepEqual(said(w, 'open'), [['open', 1, { verified: true }]]);

  assert.equal(w.link.send(1, 'a'), true);
  assert.equal(w.link.send(1, 'b'), true);
  assert.equal(w.batches.length, 1, 'the hello is still in flight');
  w.batches[0].resolve({ ok: true });
  await settle();
  assert.deepEqual(w.batches[1].msg, { type: 'agent.frames', i, seq: 2, frames: [{ t: 'line', c: 1, d: 'a' }, { t: 'line', c: 1, d: 'b' }] });
  w.link.send(1, 'c');
  w.link.close(1, 'done');
  await settle();
  assert.equal(w.batches.length, 2);
  w.batches[1].resolve({ ok: true });
  await settle();
  assert.deepEqual(w.batches[2].msg, { type: 'agent.frames', i, seq: 3, frames: [{ t: 'line', c: 1, d: 'c' }, { t: 'close', c: 1, why: 'done' }] });

  app({ i, frames: [{ t: 'open', c: 2, peer: { verified: true } }] });
  assert.equal(w.link.send(2, '\u0001'.repeat(F.PIECE * 2)), true);
  assert.equal(w.link.send(2, 'small'), true);
  for (let n = 2; n < 5; n++) {
    w.batches[n].resolve({ ok: true });
    await settle();
  }
  assert.deepEqual(w.batches.slice(3).map((x) => x.msg.frames.map((f) => f.d.length)), [[F.PIECE], [F.PIECE, 5]], 'a batch holds at most a frame\'s bytes');
  assert.ok(w.batches.every((x) => x.msg.frames.reduce((n, f) => n + F.bytes(f), 0) <= F.FRAME));
  w.batches[4].resolve({ ok: true });
  await settle();
  assert.equal(w.batches.length, 5, 'nothing waiting, nothing sent');
});

test('Safari: the app\'s answer decides; a build without the agent bridge is not-installed', async () => {
  const cases = [
    [(x) => x.resolve({ echo: x.msg }), 'not-installed', 'no agent bridge'],
    [(x) => x.resolve(undefined), 'not-installed', 'no agent bridge'],
    [(x) => x.resolve({ ok: false, error: 'not-installed' }), 'not-installed', 'not-installed'],
    [(x) => x.resolve({ ok: false, error: 'host gone' }), 'exited', 'host gone'],
    [(x) => x.reject(new Error('Native messaging is not available')), 'exited', 'Native messaging is not available'],
  ];
  for (const [answer, state, error] of cases) {
    const w = world({ browser: 'safari' });
    await w.link.ensure();
    answer(w.batches[0]);
    await settle();
    assert.deepEqual(w.link.status(), { state, at: w.now(), error }, error);
    assert.ok(w.port().disconnected);
    assert.deepEqual(w.pending().filter((j) => !j.every).map((j) => j.at - w.now()), state === 'exited' ? [1000] : []);
  }
  const w = world({ browser: 'safari' });
  await w.link.ensure();
  const i = w.storage.local.data.mcpInstance;
  w.port().host({ name: 'agent.frames', userInfo: { i, frames: [HELLO, { t: 'open', c: 1, peer: { verified: true } }] } });
  w.batches[0].resolve({ ok: true });
  await settle();
  w.link.send(1, 'x');
  w.batches[1].reject(new Error('gone'));
  await settle();
  assert.deepEqual(said(w, 'close'), [['close', 1, 'gone']]);
  assert.equal(w.link.status().state, 'exited');
});

test('Safari: a 20 s keep-alive while on, an empty batch when idle, cleared when turned off; never elsewhere', async () => {
  const w = world({ browser: 'safari' });
  await w.link.ensure();
  const beats = () => w.pending().filter((j) => j.every);
  assert.deepEqual(beats().map((j) => j.every), [20e3]);
  const i = w.storage.local.data.mcpInstance;
  w.port().host({ name: 'agent.frames', userInfo: { i, frames: [HELLO] } });
  w.batches[0].resolve({ ok: true });
  await settle();
  await w.advance(20e3);
  assert.deepEqual(w.batches[1].msg, { type: 'agent.frames', i, seq: 2, frames: [] }, 'the beat also tells the app the worker is there');
  await w.advance(20e3);
  assert.equal(w.batches.length, 2, 'not while a batch is in flight');
  w.batches[1].resolve({ ok: true });
  await settle();
  assert.equal(w.batches.length, 2);
  await w.advance(20e3);
  assert.equal(w.batches.length, 3);
  w.batches[2].resolve({ ok: true });
  await settle();

  w.storage.local.data.mcp = { on: false };
  assert.equal((await w.link.ensure()).state, 'off');
  assert.deepEqual(beats(), [], 'cleared when turned off');
  assert.deepEqual(w.batches.at(-1).msg, { type: 'agent.frames', i, seq: 4, frames: [{ t: 'bye' }] });
  assert.ok(w.port().disconnected);
  await w.advance(120e3);
  assert.equal(w.batches.length, 4);

  const bare = world({ browser: 'safari' });
  await bare.link.ensure();
  bare.batches[0].resolve({ echo: bare.batches[0].msg });
  await settle();
  assert.equal(bare.link.status().state, 'not-installed');
  assert.deepEqual(bare.pending(), [], 'nothing to keep alive for without the app');

  for (const browser of ['chrome', 'firefox']) {
    const other = await connected({ browser });
    await other.advance(120e3);
    assert.deepEqual(other.pending(), [], browser);
  }
});

test('nothing but the link calls connectNative', () => {
  const own = new Set(['lib/agent-link.js', 'safari/Glaze/Glaze Extension/Resources/lib/agent-link.js']);
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[\s;{}()])\/\/[^\n]*/gm, '$1');
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')
    .filter((f) => /\.(m|c)?js$|\.html?$/.test(f) && !f.startsWith('test/') && fs.existsSync(path.join(root, f)));
  assert.ok(files.includes('lib/background.js') && files.includes('mcp/bin/glaze-mcp.js'), 'the scan sees the worker and the helper');
  const callers = files.filter((f) => !own.has(f) && /connectNative/.test(code(fs.readFileSync(path.join(root, f), 'utf8'))));
  assert.deepEqual(callers, []);
  assert.match(code(fs.readFileSync(path.join(root, 'lib/agent-link.js'), 'utf8')), /\.connectNative\(/);
  assert.match(code('// connectNative(x)\nnothing()'), /^\s*nothing/, 'a comment doesn\'t count');
  assert.match(code('chrome.runtime.connectNative(x)'), /connectNative/);
});
