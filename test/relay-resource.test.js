const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { relay, LIMIT, s3Store } = require('../server/relay.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clients = new WeakMap();
const upgrade = 'GET /live HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n';
const start = async (t, limit) => {
  const r = relay({ db: ':memory:', limit: { ...LIMIT, ...limit } });
  const accepted = [];
  r.server.on('connection', (s) => accepted.push(s));
  const { port } = await r.listen(0, '127.0.0.1');
  t.after(() => { for (const s of [...accepted, ...clients.get(t) || []]) s.destroy(); return r.close(); });
  return { r, port };
};
const connect = (t, port, head) => new Promise((resolve) => {
  // Keep our sending half open even after the server starts a WebSocket close.
  const s = net.connect({ port, host: '127.0.0.1', allowHalfOpen: true }, () => s.write(head));
  if (!clients.has(t)) clients.set(t, []);
  clients.get(t).push(s);
  t.after(() => s.destroy());
  let got = '';
  s.on('data', (d) => { got += d; if (got.includes('\r\n')) resolve({ s, line: got.split('\r\n')[0] }); });
  s.on('error', () => {});
  s.on('close', () => resolve({ s, line: got.split('\r\n')[0] }));
});

test('SHR-1 review: a closing WebSocket keeps its address slot until the descriptor closes', { timeout: 5000 }, async (t) => {
  const { port } = await start(t, { sockets: 1 });
  const first = await connect(t, port, upgrade);
  assert.match(first.line, / 101 /);
  // An unmasked frame is invalid. The relay sends close and waits two seconds for our close.
  const closing = new Promise((resolve) => first.s.once('end', resolve));
  first.s.write(Buffer.from([0x81, 0]));
  await closing;
  const next = await connect(t, port, upgrade);
  assert.match(next.line, / 429 /, 'the still-open descriptor must count against admission');
  first.s.destroy();
  await sleep(30);
  assert.match((await connect(t, port, upgrade)).line, / 101 /);
});

test('SHR-1 review: incomplete headers count against the global socket cap', { timeout: 5000 }, async (t) => {
  const { r, port } = await start(t, { socketsAll: 2 });
  const held = [];
  for (let i = 0; i < 5; i++) {
    const s = net.connect(port, '127.0.0.1', () => s.write('GET /live HTTP/1.1\r\nHost:'));
    s.on('error', () => {});
    s.resume();
    held.push(s);
    t.after(() => s.destroy());
  }
  await sleep(100);
  const count = await new Promise((resolve, reject) => r.server.getConnections((e, n) => e ? reject(e) : resolve(n)));
  assert.ok(count <= 2, `${count} pending connections held against a cap of two`);
});

test('SHR-6 review: S3 responses that are not streamed to a client are canceled', async (t) => {
  let canceled = 0;
  let status = 200;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(65536)); },
    cancel() { canceled++; },
  }), { status }));
  const store = s3Store({ endpoint: 'http://127.0.0.1:1', bucket: 'test', keyId: 'test', secret: 'test' });
  await store.put('s/k', Buffer.alloc(1));
  assert.equal(canceled, 1, 'PUT response released');
  await store.del('s/k');
  assert.equal(canceled, 2, 'DELETE response released');
  status = 404;
  assert.equal(await store.get('s/k'), null);
  assert.equal(canceled, 3, 'missing GET response released');
  status = 500;
  await assert.rejects(store.get('s/k'), /store GET 500/);
  assert.equal(canceled, 4, 'failed response released');
  status = 200;
  const stream = await store.get('s/k');
  assert.equal(canceled, 4, 'successful GET stays available for streaming');
  stream.destroy();
  await new Promise((resolve) => stream.once('close', resolve));
  assert.equal(canceled, 5, 'abandoned streamed GET released');
});

test('SHR-6 review: pipelined downloads are bounded and abort outstanding store reads on disconnect', { timeout: 5000 }, async (t) => {
  const { Readable } = require('node:stream');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const signals = [];
  const streams = [];
  const r = relay({ db: ':memory:', limit: { ...LIMIT, socketsAll: 2 }, store: {
    get: async (key, { signal } = {}) => {
      signals.push(signal);
      await gate;
      const stream = Readable.from([Buffer.alloc(32)]);
      streams.push(stream);
      return stream;
    },
  } });
  const { port } = await r.listen(0, '127.0.0.1');
  t.after(() => r.close());
  const sid = 'S'.repeat(22), id = 'I'.repeat(22);
  r.db.prepare('INSERT INTO sessions (sid, pub, del, touched) VALUES (?, ?, ?, 0)').run(sid, Buffer.alloc(32), Buffer.alloc(32));
  r.db.prepare('INSERT INTO blobs (sid, id, size) VALUES (?, ?, 32)').run(sid, id);
  const s = net.connect(port, '127.0.0.1', () => s.write(`GET /s/${sid}/b/${id} HTTP/1.1\r\nHost: x\r\n\r\n`.repeat(3)));
  s.on('error', () => {});
  s.resume();
  try {
    await sleep(100);
    assert.equal(signals.length, 2, 'queued HTTP responses must not bypass the global store-read cap');
    s.destroy();
    await sleep(50);
    assert.ok(signals.every((signal) => signal?.aborted), 'disconnect cancels reads even before the store returns headers');
  } finally { s.destroy(); release(); }
  await sleep(50);
  assert.ok(streams.every((stream) => stream.destroyed), 'late store streams are closed too');
});

test('SHR-6 review: S3 header fetch observes caller cancellation', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (url, init) => { signal = init.signal; return new Response('bytes'); });
  const store = s3Store({ endpoint: 'http://127.0.0.1:1', bucket: 'test', keyId: 'test', secret: 'test' });
  const ctl = new AbortController();
  const stream = await store.get('s/k', { signal: ctl.signal });
  ctl.abort();
  assert.equal(signal.aborted, true);
  if (typeof stream.destroy === 'function') stream.destroy();
});

test('SHR-6 review: spool open/write/read failures release admission and remove temporary files', async (t) => {
  const spool = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-spool-fault-'));
  const r = relay({ db: ':memory:', spool, limit: { ...LIMIT, inflight: 100, inflightAll: 100 } });
  const { port } = await r.listen(0, '127.0.0.1');
  t.after(async () => { await r.close(); fs.rmSync(spool, { recursive: true, force: true }); });
  const sid = 'S'.repeat(22), id = 'I'.repeat(22);
  r.db.prepare('INSERT INTO sessions (sid, pub, del, touched) VALUES (?, ?, ?, 0)').run(sid, Buffer.alloc(32), Buffer.alloc(32));
  const open = fs.promises.open, read = fs.promises.readFile;
  let fault = '';
  const io = () => Object.assign(new Error('injected spool I/O error'), { code: 'ENOSPC' });
  t.mock.method(console, 'error', () => {});
  t.mock.method(fs.promises, 'open', async (file, ...args) => {
    if (String(file).endsWith('.part') && fault === 'open') throw io();
    const fh = await open(file, ...args);
    if (String(file).endsWith('.part') && fault === 'write') fh.write = async () => { throw io(); };
    return fh;
  });
  t.mock.method(fs.promises, 'readFile', async (file, ...args) => {
    if (String(file).endsWith('.part') && fault === 'read') throw io();
    return read(file, ...args);
  });
  const put = async () => fetch(`http://127.0.0.1:${port}/s/${sid}/b/${id}`, {
    method: 'PUT', headers: { 'x-glaze-sig': 'A'.repeat(86) }, body: Buffer.alloc(100),
  }).then((res) => res.status, () => 'reset');
  for (const kind of ['open', 'write', 'read']) {
    fault = kind;
    assert.ok([500, 'reset'].includes(await put()), `${kind}: failed I/O must refuse upload`);
    fault = '';
    assert.equal(await put(), 403, `${kind}: the next full-cap body can be admitted`);
    assert.deepEqual(fs.readdirSync(spool), [], `${kind}: no abandoned spool`);
  }
});

test('SHR-11 review: a database error releasing the lease cannot reject the close callback or wedge shutdown', { timeout: 5000 }, async (t) => {
  const code = `const {relay} = require(${JSON.stringify(path.join(__dirname, '../server/relay.js'))});
    (async () => {
      const r = relay({db: ':memory:'});
      await r.listen(0, '127.0.0.1');
      r.db.exec("CREATE TRIGGER fail_lease_free BEFORE DELETE ON lease BEGIN SELECT RAISE(ABORT, 'disk full at close'); END;");
      await r.close();
      console.log('closed');
    })();`;
  const child = spawn(process.execPath, ['-e', code]);
  t.after(() => child.kill());
  let out = '', err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  const exit = await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(exit, 0, err);
  assert.match(out, /closed/);
  assert.match(err, /disk full at close/);
});
