// The DMG Glaze app as Safari's agent host (safari/dmg/GlazeAgentHost.swift), run with Swift's interpreter and never an
// app bundle: the real `glaze-mcp agent` finds it through rendezvous.js and proves its token, while this test plays the
// worker through the bridge's own client (GlazeAgentBridge.swift) and reads what the host would dispatch to Safari.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const F = require('../lib/agent-frames.js');
const R = require('../mcp/lib/rendezvous.js');
const HS = require('../mcp/lib/handshake.js');
const S = require('./helpers/swift-native.cjs');

const root = path.join(__dirname, '..');
const bridgeFile = path.join(root, 'safari/Glaze/Glaze Extension/GlazeAgentBridge.swift');
const hostFile = path.join(root, 'safari/dmg/GlazeAgentHost.swift');
const appFile = path.join(root, 'safari/dmg/AppDelegate.swift');
const code = (src) => src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDLE = 5, LINE = 1 << 20, QUEUE = 2 << 20;

const I = 'fedcba9876543210fedc', HELLO = { t: 'hello', v: 1, glaze: '4.0.0', instance: I };
const nonce = (n) => String(n).repeat(32).slice(0, 32);
const B = (s, seq, frames) => ({ type: 'agent.frames', i: I, s: nonce(s), seq, frames });
const FROM_HOST = { t: 'hello', v: 1, host: '9.9.9', os: 'darwin', browser: 'safari', node: '' };

const HARNESS = `
nonisolated func json(_ o: Any) -> String { String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes]), encoding: .utf8)! }
@MainActor func emit(_ o: [String: Any]) { print(json(o)); fflush(stdout) }
@MainActor final class Harness {
    var fail = false, buf: [UInt8] = [], host: GlazeAgentHost?, commands: DispatchSourceRead?
    var prepareUpdate: (() -> Void)?
    func run(_ a: [String]) {
        var limits = GlazeAgentHost.Limits()
        limits.idle = Double(a[3])!; limits.line = Int(a[4])!; limits.queue = Int(a[5])!; limits.drain = 2
        let host = GlazeAgentHost(run: a[1], group: a[2], version: "9.9.9", limits: limits) { [unowned self] info, done in
            emit(["ev": "dispatch", "info": info])
            let ok = !self.fail
            self.fail = false
            DispatchQueue.main.async { done(ok) }
        }
        host.onIdle = { emit(["ev": "idle"]); host.stop(); exit(0) }
        let started = host.start()
        self.host = host
        let group = URL(fileURLWithPath: a[2]), c = DispatchSource.makeReadSource(fileDescriptor: 0, queue: .main)
        c.setEventHandler { [unowned self] in self.command(group) }
        c.resume()
        commands = c
        emit(["ev": "ready", "pid": Int(getpid()), "started": started])
    }
    func command(_ group: URL) {
        var chunk = [UInt8](repeating: 0, count: 1 << 20)
        let n = read(0, &chunk, chunk.count)
        guard n > 0 else { host?.stop(); exit(0) }
        buf += chunk[0..<n]
        while let i = buf.firstIndex(of: 10) {
            let m = try! JSONSerialization.jsonObject(with: Data(buf[..<i])) as! [String: Any]
            buf.removeFirst(i + 1)
            switch m["cmd"] as! String {
            case "batch":
                let id = m["id"] as! Int, text = json(m["batch"]!)
                DispatchQueue.global().async {
                    let b = try! JSONSerialization.jsonObject(with: Data(text.utf8))
                    let line = json(["ev": "reply", "id": id, "reply": GlazeAgentBridge.reply(to: b, folder: group, wait: 1) {}])
                    DispatchQueue.main.async { print(line); fflush(stdout) }
                }
            case "fail":
                fail = true
                emit(["ev": "failing"])
            case "prepare":
                prepareUpdate?()
                emit(["ev": "prepared"])
            default:
                host?.stop()
                exit(0)
            }
        }
    }
}
let harness = MainActor.assumeIsolated { Harness() }
MainActor.assumeIsolated { harness.run(CommandLine.arguments) }
dispatchMain()
`;

// glaze-mcp agent, started as an agent app starts it, with this test's HOME.
const agent = (HOME, npx = false) => {
  const bin = path.join(root, 'mcp/bin/glaze-mcp.js'), quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
  const args = npx ? ['--offline', '--no', '--call', `${quote(process.execPath)} ${quote(bin)} agent --browser safari`] : [bin, 'agent', '--browser', 'safari'];
  const child = spawn(npx ? 'npx' : process.execPath, args, { env: { ...process.env, HOME, ...(npx && { __CFBundleIdentifier: 'io.test.untrusted-self-report' }) }, detached: npx, stdio: ['pipe', 'pipe', 'pipe'] });
  const out = [];
  let err = '', partial = '';
  child.stdout.setEncoding('utf8').on('data', (d) => { const parts = (partial + d).split('\n'); partial = parts.pop(); out.push(...parts); });
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.on('error', () => {});
  const exit = new Promise((r) => child.on('close', (c) => r(c)));
  const line = async (ms = 20000) => {
    for (const until = Date.now() + ms; !out.length; await sleep(10)) if (Date.now() > until) throw new Error(`no line from the agent: ${err}`);
    return out.shift();
  };
  const stop = async () => {
    child.stdin.end();
    await Promise.race([exit, sleep(1000)]);
    if (child.exitCode === null && child.signalCode === null) {
      if (npx) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} } else child.kill();
    }
    await exit;
  };
  return { child, line, exit, stop, err: () => err, write: (s) => child.stdin.write(s) };
};

test('the Swift host serves the real glaze-mcp agent and a stand-in worker across sessions, then quits when idle', { skip: !S.supported, timeout: 240000 }, async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-agent-host-'));
  const HOME = path.join(temp, 'a home folder long enough that its run socket passes 104 bytes');
  const RUN = R.dir({ platform: 'darwin', env: { HOME } }), GROUP = fs.mkdtempSync(path.join('/tmp', 'gz-group-'));
  const agents = [];
  const file = path.join(temp, 'Host.swift');
  fs.writeFileSync(file, fs.readFileSync(bridgeFile, 'utf8') + fs.readFileSync(hostFile, 'utf8') + HARNESS);
  const swift = S.run(file, [RUN, GROUP, String(IDLE), String(LINE), String(QUEUE)], { flags: ['-D', 'GLAZE_DMG', '-default-isolation', 'MainActor'] });
  const events = [];
  let over = false;
  (async () => { for (;;) { try { events.push(await swift.next(600000)); } catch { over = true; return; } } })();
  const take = async (pred, what, ms = 20000) => {
    for (const until = Date.now() + ms; ; await sleep(10)) {
      const k = events.findIndex(pred);
      if (k >= 0) return events.splice(k, 1)[0];
      if (Date.now() > until || over) throw new Error(`no ${what} in ${ms} ms; ${JSON.stringify(events).slice(0, 1500)}; ${swift.stderr().slice(-1500)}`);
    }
  };
  // What the host dispatched, in order, as { s, f }; frame() takes the first that matches.
  const dispatched = [], got = [];
  const pull = () => {
    for (let k; (k = events.findIndex((m) => m.ev === 'dispatch')) >= 0;) {
      const { info } = events.splice(k, 1)[0];
      dispatched.push(info);
      for (const f of info.frames) got.push({ s: info.s, f });
    }
  };
  const frame = async (pred, what, ms = 20000) => {
    for (const until = Date.now() + ms; ; await sleep(10)) {
      pull();
      const k = got.findIndex(pred);
      if (k >= 0) return got.splice(k, 1)[0].f;
      if (Date.now() > until || over) throw new Error(`no ${what} in ${ms} ms; ${JSON.stringify(got).slice(0, 1500)}; ${swift.stderr().slice(-1500)}`);
    }
  };
  const none = async (pred, what, ms = 400) => { await sleep(ms); pull(); assert.equal(got.findIndex(pred), -1, what); };
  let ids = 0, chain = Promise.resolve();
  // One batch in flight, as the worker sends them.
  const send = (b) => (chain = chain.then(async () => {
    const id = ++ids;
    swift.send({ cmd: 'batch', id, batch: b });
    return (await take((m) => m.ev === 'reply' && m.id === id, `the reply to batch ${id}`)).reply;
  }));
  const start = () => { const a = agent(HOME); agents.push(a); return a; };
  const peer = { exe: fs.realpathSync(process.execPath), ppid: process.pid, verified: true };
  const PING = (n) => `{"jsonrpc":"2.0","id":${n},"method":"ping"}`;
  const OK = { ok: true }, ENDED = { ok: false, error: 'this session has ended' }, ORDER = { ok: false, error: 'a batch out of order' };
  try {
    const ready = await take((m) => m.ev === 'ready', 'the host', 120000);
    const sock = path.join(GROUP, 'agent.sock');
    let cA, rec;
    const A = start();
    A.write(`${PING(1)}\n`);

    await t.test('a hello starts a session: the host answers it, then publishes its socket and run file', async () => {
      assert.ok(fs.lstatSync(sock).isSocket());
      assert.equal(fs.lstatSync(sock).mode & 0o777, 0o600, 'the group socket is private');
      assert.equal(fs.existsSync(RUN), false, 'nothing is published before a worker says hello');
      assert.deepEqual(await send(B(1, 1, [HELLO])), OK);
      const hello = await frame((x) => x.s === nonce(1), 'the host hello');
      assert.deepEqual(hello, FROM_HOST);
      const live = R.list(RUN, { platform: 'darwin' });
      assert.equal(live.length, 1);
      rec = live[0].rec;
      assert.deepEqual([rec.browser, rec.instance, rec.pid, live[0].alive], ['safari', I, ready.pid, true]);
      assert.equal(rec.path, path.join(RUN, `safari.${I}.sock`));
      assert.ok(Buffer.byteLength(rec.path) > 103, 'bound by its name inside the folder, as a full path would not fit');
      assert.equal(fs.statSync(RUN).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.join(RUN, `safari.${I}.json`)).mode & 0o777, 0o600);
      assert.ok(fs.lstatSync(rec.path).isSocket());
      assert.equal(fs.lstatSync(rec.path).mode & 0o777, 0o600);
    });

    await t.test('the agent that waited connects, proves the token and is known by the kernel', async () => {
      const open = await frame((x) => x.f.t === 'open', 'the agent\'s open');
      cA = open.c;
      assert.ok(Number.isSafeInteger(cA) && cA > 0);
      assert.deepEqual(open, { t: 'open', c: cA, peer }, 'its parent, this test, as the kernel says');
      assert.deepEqual(await frame((x) => x.f.t === 'line', 'its line'), { t: 'line', c: cA, d: PING(1) });
      assert.match(A.err(), new RegExp(`connected to Glaze in safari \\(instance ${I}\\)`));
    });

    await t.test('an npx-started agent is verified as npm\'s Node program, never its inherited bundle self-report', async () => {
      const a = agent(HOME, true);
      agents.push(a);
      a.write(`${PING(100)}\n`);
      const open = await frame((x) => x.f.t === 'open', 'npx open');
      assert.equal(open.peer.verified, true);
      assert.equal(open.peer.exe, fs.realpathSync(process.execPath));
      assert.ok(open.peer.ppid > 0 && open.peer.ppid !== process.pid, 'the npm parent, not this test');
      t.diagnostic(`npx kernel parent: ${JSON.stringify(open.peer)}`);
      await frame((x) => x.f.t === 'line' && x.f.c === open.c, 'npx ping');
      await a.stop();
      assert.equal(await a.exit, 0);
      await frame((x) => x.f.t === 'close' && x.f.c === open.c, 'npx close');
    });

    await t.test('lines both ways: whole, in pieces, and a long one cut as agent-frames.js cuts it', async () => {
      assert.deepEqual(await send(B(1, 2, [{ t: 'line', c: cA, d: '{"jsonrpc":"2.0","id":1,"result":{}}' }])), OK);
      assert.equal(await A.line(), '{"jsonrpc":"2.0","id":1,"result":{}}');
      assert.deepEqual(await send(B(1, 3, [{ t: 'line', c: cA, d: '{"a":', m: 1 }, { t: 'line', c: cA, d: '1}' }])), OK);
      assert.equal(await A.line(), '{"a":1}');
      const big = `{"big":"${'é'.repeat(200000)}${'x'.repeat(200000)}"}`;
      A.write(`${big}\n`);
      const pieces = [];
      do pieces.push(await frame((x) => x.f.t === 'line' && x.f.c === cA, 'a piece')); while (pieces.at(-1).m);
      assert.deepEqual(pieces.map((f) => f.d.length), F.split(cA, big).map((f) => f.d.length));
      assert.equal(pieces.map((f) => f.d).join(''), big);
    });

    await t.test('a probe is answered and never reaches the worker; a wrong token is closed with nothing said', async () => {
      const rows = await require('../mcp/lib/agent.js').doctor({ platform: 'darwin', env: { HOME } });
      assert.ok(rows.some((r) => r.level === 'ok' && r.what === `Live safari (${I})`), JSON.stringify(rows));
      const s = R.connect(rec.path);
      s.on('error', () => {});
      await assert.rejects(HS.offer(s, Buffer.alloc(32, 9).toString('base64'), { verified: false }, { timeout: 3000 }), { code: 'closed' });
      await none((x) => x.f.t === 'open', 'no connection for either');
    });

    await t.test('a new session hears hello, then every live connection again; earlier and unknown sessions are refused', async () => {
      assert.deepEqual(await send(B(2, 1, [HELLO])), OK);
      assert.deepEqual(await frame((x) => x.s === nonce(2), 'the second hello'), FROM_HOST);
      assert.deepEqual(await frame((x) => x.s === nonce(2), 'the re-sent open'), { t: 'open', c: cA, peer });
      assert.deepEqual(await send(B(1, 4, [])), ENDED);
      assert.deepEqual(await send(B(3, 5, [])), ENDED, 'only a hello starts a session');
      A.write(`${PING(2)}\n`);
      assert.deepEqual(await frame((x) => x.f.t === 'line', 'a line in the new session'), { t: 'line', c: cA, d: PING(2) });
      pull();
      assert.equal(dispatched.filter((d) => d.s === nonce(3)).length, 0);
    });

    await t.test('a batch out of order ends the session; reads wait; the next hello re-announces and lets them through', async () => {
      assert.deepEqual(await send(B(2, 3, [])), ORDER);
      assert.deepEqual(await send(B(2, 4, [])), ORDER, 'the ended session keeps its reason');
      A.write(`${PING(3)}\n`);
      await none((x) => x.f.t === 'line', 'nothing goes while there is no session');
      assert.deepEqual(await send(B(4, 1, [HELLO])), OK);
      const next = [];
      for (let n = 0; n < 3; n++) next.push(await frame((x) => x.s === nonce(4), 'the fourth session\'s frames'));
      assert.deepEqual(next, [FROM_HOST, { t: 'open', c: cA, peer }, { t: 'line', c: cA, d: PING(3) }]);
    });

    await t.test('when Safari doesn\'t take a dispatch the session ends, and the worker hears why', async () => {
      swift.send({ cmd: 'fail' });
      await take((m) => m.ev === 'failing', 'the stand-in sink set to fail');
      A.write(`${PING(4)}\n`);
      await frame((x) => x.f.t === 'line' && x.f.d === PING(4), 'the dispatch that fails');
      await sleep(100);
      assert.deepEqual(await send(B(4, 2, [])), { ok: false, error: "Safari didn't take the app's message" });
      assert.deepEqual(await send(B(5, 1, [HELLO])), OK);
      assert.deepEqual(await frame((x) => x.s === nonce(5), 'hello'), FROM_HOST);
      assert.deepEqual(await frame((x) => x.s === nonce(5), 'open'), { t: 'open', c: cA, peer });
    });

    let seq = 1;
    await t.test('closes, as mux.js says them: bad-line, eof, the worker\'s close, too-long both ways, overflow', async () => {
      assert.deepEqual(await send(B(5, ++seq, [{ t: 'line', c: cA, d: 'a\nb' }])), OK);
      assert.deepEqual(await frame((x) => x.f.t === 'close', 'bad-line'), { t: 'close', c: cA, why: 'bad-line' });
      assert.equal(await A.exit, 1);
      const opened = async (a) => { a.write(`${PING(9)}\n`); const o = await frame((x) => x.f.t === 'open', 'an open'); await frame((x) => x.f.t === 'line' && x.f.c === o.c, 'its line'); return o.c; };

      const Bee = start(), cB = await opened(Bee);
      assert.ok(cB > cA, 'numbers are never reused');
      Bee.child.stdin.end();
      assert.equal(await Bee.exit, 0);
      assert.deepEqual(await frame((x) => x.f.t === 'close', 'eof'), { t: 'close', c: cB, why: 'eof' });

      const C = start(), cC = await opened(C);
      assert.deepEqual(await send(B(5, ++seq, [{ t: 'close', c: cC, why: 'off' }])), OK);
      assert.equal(await C.exit, 1);
      assert.match(C.err(), /Glaze closed the connection/);

      const D = start(), cD = await opened(D);
      const piece = { t: 'line', c: cD, d: 'x'.repeat(F.PIECE), m: 1 };
      assert.deepEqual(await send(B(5, ++seq, Array(6).fill(piece))), OK);
      assert.deepEqual(await send(B(5, ++seq, [piece])), OK);
      assert.deepEqual(await frame((x) => x.f.t === 'close', 'too-long to the agent'), { t: 'close', c: cD, why: 'too-long' });
      assert.equal(await D.exit, 1);

      const E = start(), cE = await opened(E);
      E.write('y'.repeat(LINE + 1));
      assert.deepEqual(await frame((x) => x.f.t === 'close', 'too-long from the agent'), { t: 'close', c: cE, why: 'too-long' });
      assert.equal(await E.exit, 1);

      const raw = R.connect(rec.path);
      raw.on('error', () => {});
      await HS.offer(raw, rec.token, { name: 'never reads', verified: false });
      raw.pause();
      const cF = (await frame((x) => x.f.t === 'open', 'the reader that never reads')).c;
      for (let n = 0; n < 3; n++) assert.deepEqual(await send(B(5, ++seq, Array(6).fill({ t: 'line', c: cF, d: 'z'.repeat(150000) }))), OK);
      assert.deepEqual(await frame((x) => x.f.t === 'close', 'overflow'), { t: 'close', c: cF, why: 'overflow' });
      raw.destroy();
    });

    await t.test('bye closes every connection and takes the socket and run file away', async () => {
      const G = start();
      G.write(`${PING(7)}\n`);
      await frame((x) => x.f.t === 'line' && x.f.d === PING(7), 'the last agent\'s line');
      assert.deepEqual(await send(B(5, ++seq, [{ t: 'bye' }])), OK);
      assert.equal(await G.exit, 1);
      assert.deepEqual(R.list(RUN, { platform: 'darwin' }), []);
      assert.equal(fs.existsSync(rec.path), false);
      assert.equal(fs.existsSync(path.join(RUN, `safari.${I}.json`)), false);
    });

    await t.test('the app stays up while any worker sends, and quits once none has for its idle time', async () => {
      for (let n = 0; n < IDLE + 2; n++) {
        assert.deepEqual(await send(B(5, ++seq, [])), ENDED, 'a beat after bye still says the worker is there');
        await sleep(1000);
      }
      assert.equal(events.some((m) => m.ev === 'idle'), false, 'not while batches come');
      const quiet = Date.now();
      await take((m) => m.ev === 'idle', 'idle', (IDLE + 3) * 1000);
      const waited = (Date.now() - quiet) / 1000;
      assert.ok(waited > IDLE - 1.5 && waited < IDLE + 2, String(waited));
      assert.equal(await swift.done, 0, swift.stderr());
      assert.equal(fs.existsSync(sock), false, 'the group socket goes with it');
    });

    pull();
    for (const d of dispatched) {
      assert.ok(d.frames.length === 1 || d.frames.reduce((n, f) => n + F.bytes(f), 0) <= F.FRAME, 'a dispatch holds at most a frame\'s bytes');
      for (const f of d.frames) assert.ok(F.valid.toWorker(f), JSON.stringify(f).slice(0, 200));
      assert.equal(d.i, I);
    }
  } finally {
    await Promise.all(agents.map((a) => a.stop()));
    await swift.stop();
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(GROUP, { recursive: true, force: true });
  }
});

test('the host compiles for macOS 12 in the app with complete concurrency checking', { skip: !S.supported }, () => {
  for (const isolation of ['MainActor', 'nonisolated']) {
    const r = S.typecheck([bridgeFile, hostFile], ['-D', 'GLAZE_DMG', '-default-isolation', isolation, '-strict-concurrency=complete']);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /warning:|error:/, isolation);
  }
});

test('the DMG app\'s sources compile together as its target builds them, against a stand-in for Sparkle\'s API', { skip: !S.supported }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sparkle-'));
  try {
    const files = S.sparkleSources([appFile, path.join(root, 'safari/Glaze/Glaze/ViewController.swift'), hostFile, bridgeFile], temp);
    const r = S.typecheck(files, ['-parse-as-library', '-module-name', 'Glaze', '-D', 'GLAZE_DMG', '-default-isolation', 'MainActor']);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /warning:|error:/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('the host is DMG-only, starts no process and opens no network socket; the app keeps a hidden launch up for it', () => {
  const host = code(fs.readFileSync(hostFile, 'utf8')), lines = host.split('\n').filter((l) => l.trim());
  assert.equal(lines[0], '#if os(macOS) && GLAZE_DMG');
  assert.equal(lines.at(-1), '#endif');
  assert.equal(host.split('#endif').length, 2);
  for (const src of [host, code(fs.readFileSync(bridgeFile, 'utf8'))]) {
    assert.doesNotMatch(src, /\bProcess\(|posix_spawn|NSTask|\bsystem\(|popen|AF_INET|URLSession|NWConnection|NWListener/);
  }
  const app = code(fs.readFileSync(appFile, 'utf8'));
  assert.match(app, /if urls\.contains\(where: \{ \$0\.absoluteString == GlazeAgentBridge\.start \}\) \{ startAgents\(\) \}/);
  assert.match(app, /guard !userSession, force \|\| agents == nil \|\| forUpdate && agents\?\.canInstallUpdate == true else \{ return \}/, 'a hidden launch stays up until its calls and traffic are quiet');
  assert.match(app, /finishHidden\("unexpected interactive extraction", force: true\)/, 'Sparkle\'s safety stop still ends it');
  assert.match(app, /func applicationWillTerminate\(_ notification: Notification\) \{ agents\?\.stop\(\) \}/);
  assert.match(app, /host\.onIdle = \{[^]*self\.agents\?\.stop\(\)[^]*finishHidden\("agents idle"\)/);
});


test('the bridge reaches the host in a group container whose path exceeds sun_path, without relaunching it', { skip: !S.supported }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-agent-long-'));
  const group = path.join(temp, 'a'.repeat(100), 'Library/Group Containers/22AAZFMTV8.io.frostdev.Glaze');
  fs.mkdirSync(group, { recursive: true, mode: 0o700 });
  assert.ok(Buffer.byteLength(path.join(group, 'agent.sock')) > 104);
  const file = path.join(temp, 'Long.swift');
  fs.writeFileSync(file, fs.readFileSync(bridgeFile, 'utf8') + fs.readFileSync(hostFile, 'utf8') + HARNESS);
  const swift = S.run(file, [path.join(temp, 'run'), group, '30', String(LINE), String(QUEUE)], { flags: ['-D', 'GLAZE_DMG', '-default-isolation', 'MainActor'] });
  try {
    const ready = await swift.next();
    assert.equal(ready.started, true, 'the host must bind agent.sock by name inside the group');
    swift.send({ cmd: 'batch', id: 1, batch: B(1, 1, [HELLO]) });
    let reply, hello;
    while (!reply || !hello) {
      const m = await swift.next();
      if (m.ev === 'reply') reply = m.reply;
      if (m.ev === 'dispatch') hello = m.info;
    }
    assert.deepEqual(reply, { ok: true }, 'the extension bridge connects to the long group path');
    assert.deepEqual(hello, { i: I, s: nonce(1), frames: [FROM_HOST] });
  } finally {
    swift.send({ cmd: 'stop' });
    await swift.done;
    assert.equal(fs.existsSync(path.join(group, 'agent.sock')), false, 'owned socket removed');
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

// Exercise the actual Sparkle callback and hidden-quit guard. No application bundle or installed updater is used.
const UPDATE_BOOT = `
@MainActor final class QuitProbe: NSApplication {
    override func terminate(_ sender: Any?) { emit(["ev": "quit"]); harness.host?.stop(); exit(0) }
}
extension AppDelegate {
    func attachForTest(_ host: GlazeAgentHost) { agents = host }
}
let harness = MainActor.assumeIsolated { Harness() }
let delegate = MainActor.assumeIsolated { AppDelegate() }
MainActor.assumeIsolated {
    _ = QuitProbe.shared
    harness.run(CommandLine.arguments)
    delegate.attachForTest(harness.host!)
    harness.prepareUpdate = {
        let updater = SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: SPUStandardUserDriver(hostBundle: .main, delegate: nil), delegate: delegate)
        _ = delegate.updater(updater, willInstallUpdateOnQuit: SUAppcastItem()) { fatalError("must never install and relaunch immediately") }
    }
}
dispatchMain()
`;

test('a prepared update waits for a long call and its split reply, then quits the hidden app during an idle gap', { skip: !S.supported, timeout: 180000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-update-idle-'));
  const group = path.join(temp, 'group');
  fs.mkdirSync(group, { mode: 0o700 });
  const HOME = path.join(temp, 'home'), file = path.join(temp, 'Update.swift');
  const app = fs.readFileSync(path.join(__dirname, 'fixtures/sparkle-stand-in.swift'), 'utf8') + fs.readFileSync(appFile, 'utf8').replace(/^import Sparkle$/m, '').replace(/^@main$/m, '');
  fs.writeFileSync(file, fs.readFileSync(bridgeFile, 'utf8') + fs.readFileSync(hostFile, 'utf8') + app + HARNESS.slice(0, HARNESS.indexOf('let harness =')) + UPDATE_BOOT);
  const swift = S.run(file, [R.dir({ platform: 'darwin', env: { HOME } }), group, '60', String(LINE), String(QUEUE)], { flags: ['-D', 'GLAZE_DMG', '-default-isolation', 'MainActor'] });
  const events = [];
  let over = false, a;
  (async () => { for (;;) { try { events.push(await swift.next(600000)); } catch { over = true; return; } } })();
  const take = async (pred, what, ms = 20000) => {
    for (const until = Date.now() + ms; ; await sleep(10)) {
      const k = events.findIndex(pred);
      if (k >= 0) return events.splice(k, 1)[0];
      if (over || Date.now() > until) throw new Error(`no ${what}; ${JSON.stringify(events).slice(-1500)}; ${swift.stderr().slice(-2000)}`);
    }
  };
  let seq = 0;
  const send = async (frames) => {
    swift.send({ cmd: 'batch', id: ++seq, batch: B(1, seq, frames) });
    assert.deepEqual((await take((m) => m.ev === 'reply' && m.id === seq, 'batch answer')).reply, { ok: true });
  };
  try {
    assert.equal((await take((m) => m.ev === 'ready', 'ready', 120000)).started, true);
    await send([HELLO]);
    a = agent(HOME);
    a.write('{"jsonrpc":"2.0","id":"cancelled-call","method":"tools/call","params":{"name":"slow"}}\n');
    const opened = await take((m) => m.ev === 'dispatch' && m.info.frames.some((f) => f.t === 'open'), 'open');
    const c = opened.info.frames.find((f) => f.t === 'open').c;
    const line = () => take((m) => m.ev === 'dispatch' && m.info.frames.some((f) => f.t === 'line'), 'call');
    await line();
    await send([{ t: 'line', c, d: '{"jsonrpc":"2.0","id":"cancelled-call",', m: 1 }]);
    a.write('{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"cancelled-call"}}\n');
    await line();
    await send([{ t: 'line', c, d: '"result":{}}' }]);
    assert.equal(await a.line(), '{"jsonrpc":"2.0","id":"cancelled-call","result":{}}');
    a.write('{"jsonrpc":"2.0","id":"long-call","method":"tools/call","params":{"name":"slow"}}\n');
    await line();
    swift.send({ cmd: 'prepare' });
    await take((m) => m.ev === 'prepared', 'prepared');
    await sleep(6500);
    assert.equal(over, false, 'a call outlives the quiet gap without losing its agent');
    assert.equal(events.some((m) => m.ev === 'quit'), false);
    await send([{ t: 'line', c, d: '{"jsonrpc":"2.0","id":"long-call",', m: 1 }]);
    await sleep(6500);
    assert.equal(events.some((m) => m.ev === 'quit'), false, 'a split reply still needs its final piece');
    await send([{ t: 'line', c, d: '"result":{}}' }]);
    assert.equal(await a.line(), '{"jsonrpc":"2.0","id":"long-call","result":{}}');
    await take((m) => m.ev === 'quit', 'prepared update termination after the completed call', 9000);
    assert.equal(await swift.done, 0, swift.stderr());
    assert.equal(await a.exit, 1, 'idle agent reconnects after the update');
    assert.equal(fs.existsSync(path.join(group, 'agent.sock')), false);
  } finally {
    await a?.stop();
    await swift.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('replayed hellos cannot reset a live session, replace its nonce or resurrect a session after bye', { skip: !S.supported }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-agent-replay-'));
  const group = path.join(temp, 'group');
  fs.mkdirSync(group, { mode: 0o700 });
  const file = path.join(temp, 'Replay.swift');
  fs.writeFileSync(file, fs.readFileSync(bridgeFile, 'utf8') + fs.readFileSync(hostFile, 'utf8') + HARNESS);
  const swift = S.run(file, [path.join(temp, 'run'), group, '60', String(LINE), String(QUEUE)], { flags: ['-D', 'GLAZE_DMG', '-default-isolation', 'MainActor'] });
  const send = async (b) => {
    swift.send({ cmd: 'batch', id: 1, batch: b });
    for (;;) { const m = await swift.next(); if (m.ev === 'reply') return m.reply; }
  };
  const replay = { ok: false, error: 'a replayed hello' };
  try {
    assert.equal((await swift.next()).started, true);
    assert.deepEqual(await send(B(1, 1, [HELLO])), { ok: true });
    assert.deepEqual(await send(B(1, 1, [HELLO])), replay, 'a duplicate hello cannot reset seq');
    assert.deepEqual(await send(B(1, 2, [])), { ok: true });
    assert.deepEqual(await send(B(2, 1, [HELLO])), { ok: true });
    assert.deepEqual(await send(B(1, 1, [HELLO])), replay, 'a retired hello cannot take over a new session');
    assert.deepEqual(await send(B(2, 2, [])), { ok: true }, 'the current nonce and seq still work');
    assert.deepEqual(await send(B(2, 3, [{ t: 'bye' }])), { ok: true });
    assert.deepEqual(await send(B(2, 1, [HELLO])), replay, 'bye cannot erase the replay guard');
    assert.deepEqual(await send(B(3, 1, [HELLO])), { ok: true }, 'a fresh worker can reconnect');
  } finally {
    swift.send({ cmd: 'stop' });
    await swift.done;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
