// The DMG build's agent bridge in Safari's extension (safari/Glaze/Glaze Extension/GlazeAgentBridge.swift), run with Swift's
// interpreter and never an app bundle: its frames against the vectors lib/agent-frames.js passes, its framing against
// mcp/lib/native.js, and its batches through a stand-in Glaze app on a unix socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const F = require('../lib/agent-frames.js');
const N = require('../mcp/lib/native.js');
const V = require('./fixtures/agent-frames.json');
const S = require('./helpers/swift-native.cjs');

const root = path.join(__dirname, '..');
const ext = path.join(root, 'safari/Glaze/Glaze Extension');
const bridgeFile = path.join(ext, 'GlazeAgentBridge.swift');
const build = (recipe) => recipe.map(([unit, n]) => unit.repeat(n)).join('');
const units = (s) => Array.from({ length: s.length }, (_, i) => s.charCodeAt(i));
const frameOf = (v) => (v.fill ? { ...v.frame, [v.fill.key]: build(v.fill.build) } : v.frame);
const code = (src) => src.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l)).join('\n');

const I = '0123456789abcdef0123', S1 = 'aa'.repeat(16);
const HELLO = { t: 'hello', v: 1, glaze: '4.0.0', instance: I };
const batch = (frames, extra = {}) => ({ type: 'agent.frames', i: I, s: S1, seq: 1, frames, ...extra });
const LINES = batch([{ t: 'line', c: 7, d: '{"a":', m: 1 }, { t: 'line', c: 7, d: '"é😀\u0001"}' }, { t: 'close', c: 7, why: 'eof' }, { t: 'bye' }], { seq: 2 });
const BAD = {
  'another type': batch([HELLO], { type: 'agent.other' }),
  'a short instance': batch([HELLO], { i: 'abc' }),
  'an uppercase nonce': batch([HELLO], { s: 'AA'.repeat(16) }),
  'seq 0': batch([HELLO], { seq: 0 }),
  'a fractional seq': batch([HELLO], { seq: 1.5 }),
  'seq as a string': batch([HELLO], { seq: '1' }),
  'frames not a list': batch(HELLO),
  "the host's open": batch([{ t: 'open', c: 1, peer: { verified: true } }]),
  'an extra key': batch([HELLO], { x: 1 }),
  'no seq': (({ seq, ...b }) => b)(batch([HELLO])),
  'over a frame of frames': batch([{ t: 'line', c: 1, d: '\u0001'.repeat(100000), m: 1 }, { t: 'line', c: 1, d: '\u0001'.repeat(100000) }]),
  'not an object': [HELLO],
};

const HARNESS = `
func json(_ o: Any) -> String { String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys, .withoutEscapingSlashes, .fragmentsAllowed]), encoding: .utf8)! }
func emit(_ o: [String: Any]) { print(json(o)); fflush(stdout) }
func units(_ v: Any) -> [UInt16] {
    (v as! [[Any]]).flatMap { p -> [UInt16] in Array([[UInt16]](repeating: (p[0] as! [NSNumber]).map(\\.uint16Value), count: (p[1] as! NSNumber).intValue).joined()) }
}
func bytes(_ hex: String) -> [UInt8] { let h = Array(hex.utf8); return stride(from: 0, to: h.count, by: 2).map { UInt8(String(decoding: h[$0..<$0 + 2], as: UTF8.self), radix: 16)! } }
func hex(_ d: Data) -> String { d.map { String(format: "%02x", $0) }.joined() }
func chars(_ s: NSString) -> [UInt16] { var b = [UInt16](repeating: 0, count: s.length); s.getCharacters(&b, range: NSRange(location: 0, length: s.length)); return b }
let input = try! JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))) as! [String: Any]
var out: [String: Any] = ["ev": "vectors"]
out["limits"] = [GlazeAgentFrames.piece, GlazeAgentFrames.frame, GlazeAgentFrames.line, GlazeAgentFrames.string, GlazeAgentFrames.nativeIn]
out["split"] = (input["split"] as! [[String: Any]]).map { v -> [String: Any] in
    let u = units(v["text"]!), frames = GlazeAgentFrames.split((v["c"] as! NSNumber).intValue, u), pieces = frames.map { chars($0["d"] as! NSString) }
    return ["pieces": pieces.map(\\.count), "bytes": frames.map { GlazeAgentFrames.size($0) }, "more": frames.map { $0["m"] as? Int ?? 0 },
            "whole": Array(pieces.joined()) == u, "valid": frames.allSatisfy { GlazeAgentFrames.toWorker($0) != nil && GlazeAgentFrames.toHost($0) != nil }]
}
for side in ["toWorker", "toHost"] {
    let set = (input["frames"] as! [String: Any])[side] as! [String: Any]
    let check = { (f: Any) in side == "toWorker" ? GlazeAgentFrames.toWorker(f) : GlazeAgentFrames.toHost(f) }
    out[side] = ["valid": (set["valid"] as! [Any]).map { check($0).map { json($0) } ?? "refused" }, "invalid": (set["invalid"] as! [Any]).map { check($0) == nil }]
}
out["native"] = (input["native"] as! [[String: Any]]).map { v -> [String: Any] in
    var whole: [Any] = [], bytewise: [Any] = [], a = GlazeAgentFrames.Reader(), b = GlazeAgentFrames.Reader()
    try! a.push(bytes(v["hex"] as! String)) { whole.append($0) }
    for x in bytes(v["hex"] as! String) { try! b.push([x]) { bytewise.append($0) } }
    return ["whole": json(whole), "bytewise": json(bytewise), "encoded": hex(GlazeAgentFrames.encode(v["message"]!)!), "size": GlazeAgentFrames.size(v["message"]!)]
}
out["refused"] = (input["refused"] as! [String]).map { h -> [String] in
    var r = GlazeAgentFrames.Reader()
    let code = { (m: [UInt8]) -> String in
        do { try r.push(m) { _ in }; return "none" } catch let e as GlazeAgentFrames.Refusal { return e.code } catch { return "other" }
    }
    return [code(bytes(h)), code(bytes("020000007b7d"))]
}
out["batches"] = (input["batches"] as! [String: Any]).mapValues { GlazeAgentBridge.batch($0).map { json($0) } ?? "refused" }
out["over"] = GlazeAgentFrames.encode(["d": String(repeating: "a", count: GlazeAgentFrames.frame)]) == nil
emit(out)
for c in input["cases"] as! [[String: Any]] {
    let name = c["name"] as! String
    let folder = (c["folder"] as? String).map { URL(fileURLWithPath: $0) }
    var launched = 0
    let reply = GlazeAgentBridge.reply(to: c["message"], folder: folder, wait: (c["wait"] as! NSNumber).doubleValue) {
        launched += 1
        emit(["ev": "launch", "name": name])
    }
    emit(["ev": "case", "name": name, "reply": reply, "launched": launched])
}
emit(["ev": "done"])
`;

// The stand-in app: one message per connection, each answered by the next behaviour in line.
const app = (dir, behaviours) => {
  const got = [];
  const server = net.createServer((sock) => {
    const reader = N.reader((m) => {
      got.push(m);
      const how = behaviours.shift();
      if (how === 'close') return sock.end();
      if (how === 'junk') return sock.end(Buffer.from('020000007b2c', 'hex'));
      sock.end(N.encode(how));
    });
    sock.on('data', (c) => { try { reader(c); } catch { sock.destroy(); } });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(path.join(dir, 'agent.sock'), () => resolve({ server, got })));
};

test('the bridge, its frames and its framing match lib/agent-frames.js and native.js, and it carries batches to the app', { skip: !S.supported }, async () => {
  const temp = fs.mkdtempSync(path.join('/tmp', 'gz-bridge-'));
  const servers = [];
  try {
    const appDir = path.join(temp, 'app'), lateDir = path.join(temp, 'late'), goneDir = path.join(temp, 'gone');
    for (const d of [appDir, lateDir, goneDir]) fs.mkdirSync(d);
    const stand = await app(appDir, [{ ok: true }, { ok: false, error: 'seq' }, { ok: 1 }, { ok: true, x: 1 }, 'close', 'junk']);
    servers.push(stand.server);
    const cases = [
      { name: 'hello', message: batch([HELLO]), folder: appDir, wait: 1 },
      { name: 'lines', message: LINES, folder: appDir, wait: 1 },
      { name: 'odd answer', message: batch([]), folder: appDir, wait: 1 },
      { name: 'extra key answer', message: batch([]), folder: appDir, wait: 1 },
      { name: 'no answer', message: batch([]), folder: appDir, wait: 1 },
      { name: 'junk answer', message: batch([]), folder: appDir, wait: 1 },
      { name: 'bad batch', message: BAD["the host's open"], folder: appDir, wait: 1 },
      { name: 'no group', message: batch([HELLO]), wait: 1 },
      { name: 'app gone', message: batch([], { seq: 3 }), folder: goneDir, wait: 1 },
      { name: 'app starts', message: batch([HELLO]), folder: lateDir, wait: 10 },
      { name: 'app never starts', message: batch([HELLO]), folder: goneDir, wait: 0.3 },
    ];
    const input = {
      split: V.split.map((v) => ({ c: v.c || 1, text: v.build ? v.build.map(([u, n]) => [units(u), n]) : [[units(v.text), 1]] })),
      frames: Object.fromEntries(['toWorker', 'toHost'].map((side) => [side, { valid: V.frames[side].valid.map(frameOf), invalid: V.frames[side].invalid.map(frameOf) }])),
      native: V.native, refused: V.nativeRefused.map((v) => v.hex),
      batches: { hello: batch([HELLO]), lines: LINES, ...BAD }, cases,
    };
    fs.writeFileSync(path.join(temp, 'input.json'), JSON.stringify(input));
    const file = path.join(temp, 'Bridge.swift');
    fs.writeFileSync(file, fs.readFileSync(bridgeFile, 'utf8') + HARNESS);
    const swift = S.run(file, [path.join(temp, 'input.json')], { flags: ['-D', 'GLAZE_DMG'] });
    const v = await swift.next();
    assert.equal(v.ev, 'vectors', JSON.stringify(v));

    assert.deepEqual(v.limits, [V.limits.piece, V.limits.frame, V.limits.line, V.limits.string, V.limits.nativeIn]);
    V.split.forEach((x, n) => {
      assert.deepEqual(v.split[n].pieces, x.pieces, x.name);
      assert.deepEqual(v.split[n].bytes, x.bytes, `${x.name}: JSON.stringify's size`);
      assert.deepEqual(v.split[n].more, x.pieces.map((_, k) => (k < x.pieces.length - 1 ? 1 : 0)), x.name);
      assert.equal(v.split[n].whole, true, `${x.name}: the pieces make the line`);
      assert.equal(v.split[n].valid, true, `${x.name}: both sides take them`);
    });
    for (const side of ['toWorker', 'toHost']) {
      V.frames[side].valid.forEach((x, n) => assert.deepEqual(JSON.parse(v[side].valid[n]), frameOf(x), `${side} valid ${n}`));
      V.frames[side].invalid.forEach((x, n) => assert.equal(v[side].invalid[n], true, `${side} refuses ${x.name}`));
    }
    V.native.forEach((x, n) => {
      assert.deepEqual(JSON.parse(v.native[n].whole), [x.message], x.name);
      assert.deepEqual(JSON.parse(v.native[n].bytewise), [x.message], `${x.name}, a byte at a time`);
      const back = [];
      N.reader((m) => back.push(m))(Buffer.from(v.native[n].encoded, 'hex'));
      assert.deepEqual(back, [x.message], `${x.name}: native.js reads what Swift writes`);
      assert.equal(v.native[n].size, Buffer.from(x.hex, 'hex').length - 4, `${x.name}: JSON.stringify's size`);
      assert.equal(v.native[n].size, F.bytes(x.message));
    });
    V.nativeRefused.forEach((x, n) => assert.deepEqual(v.refused[n], [x.code, x.code], `${x.name}, and every push after it`));
    assert.equal(v.over, true, 'nothing over a frame is written');
    assert.deepEqual(JSON.parse(v.batches.hello), batch([HELLO]));
    assert.deepEqual(JSON.parse(v.batches.lines), LINES);
    for (const name of Object.keys(BAD)) assert.equal(v.batches[name], 'refused', name);

    const replies = {};
    for (;;) {
      const m = await swift.next(20000);
      if (m.ev === 'done') break;
      if (m.ev === 'launch') {
        assert.equal(m.name in replies, false);
        if (m.name === 'app starts') servers.push((await app(lateDir, [{ ok: true }])).server);
        continue;
      }
      replies[m.name] = m;
    }
    assert.equal(await swift.done, 0, swift.stderr());
    const said = (name) => [replies[name].reply, replies[name].launched];
    assert.deepEqual(said('hello'), [{ ok: true }, 0]);
    assert.deepEqual(said('lines'), [{ ok: false, error: 'seq' }, 0], 'the app\'s refusal reaches the worker as it said it');
    for (const name of ['odd answer', 'extra key answer']) assert.deepEqual(said(name), [{ ok: false, error: 'unexpected reply from the Glaze app' }, 0], name);
    for (const name of ['no answer', 'junk answer']) assert.deepEqual(said(name), [{ ok: false, error: "the Glaze app didn't answer" }, 0], name);
    assert.deepEqual(said('bad batch'), [{ ok: false, error: 'bad-batch' }, 0]);
    assert.deepEqual(said('no group'), [{ ok: false, error: 'not-installed' }, 0], 'a build without the group has no bridge');
    assert.deepEqual(said('app gone'), [{ ok: false, error: "the Glaze app isn't running" }, 0], 'only a hello opens the app');
    assert.deepEqual(said('app starts'), [{ ok: true }, 1]);
    assert.deepEqual(said('app never starts'), [{ ok: false, error: "the Glaze app didn't start" }, 1]);
    assert.deepEqual(stand.got, [batch([HELLO]), LINES, batch([]), batch([]), batch([]), batch([])], 'the app gets each batch whole, and nothing refused');
  } finally {
    for (const s of servers) s.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('the bridge compiles for macOS 12 in the extension and in the app, with complete concurrency checking', { skip: !S.supported }, () => {
  for (const isolation of ['nonisolated', 'MainActor']) {
    const r = S.typecheck([bridgeFile], ['-D', 'GLAZE_DMG', '-default-isolation', isolation, '-strict-concurrency=complete']);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stderr, /warning:|error:/, isolation);
  }
});

test('the extension compiles with the bridge in the DMG build and without it in the App Store build', { skip: !S.supported }, () => {
  const handler = path.join(ext, 'SafariWebExtensionHandler.swift'), ai = path.join(ext, 'GlazeAI.swift');
  for (const [files, flags] of [[[handler, ai, bridgeFile], ['-D', 'GLAZE_DMG']], [[handler, ai], []]]) {
    const r = S.typecheck(files, flags);
    assert.equal(r.status, 0, `${flags.join(' ') || 'App Store'}: ${r.stderr}`);
  }
});

test('only the DMG build routes agent.* to the bridge; the App Store build echoes it, which the worker reads as not installed', () => {
  const src = code(fs.readFileSync(path.join(ext, 'SafariWebExtensionHandler.swift'), 'utf8'));
  const start = src.indexOf('#if os(macOS) && GLAZE_DMG', src.indexOf('func beginRequest')), end = src.indexOf('#endif', start);
  const dmg = src.slice(start, end), rest = src.slice(0, start) + src.slice(end);
  assert.ok(start > 0 && end > start);
  assert.match(dmg, /hasPrefix\("agent\."\)[^]*GlazeAgentBridge\.reply\(to: command, folder: GlazeAgentBridge\.folder\(\)\)/);
  assert.match(dmg, /NSWorkspace\.shared\.open\(\[URL\(string: GlazeAgentBridge\.start\)!\], withApplicationAt: app,/, 'only this extension\'s own app');
  assert.doesNotMatch(rest, /GlazeAgentBridge|"agent\./);
  assert.match(rest, /"echo": message/);
});

test('the bridge is all DMG-only, never logs, and the checked-in project never compiles it', () => {
  const src = fs.readFileSync(bridgeFile, 'utf8'), lines = code(src).split('\n').filter((l) => l.trim());
  assert.equal(lines[0], '#if os(macOS) && GLAZE_DMG');
  assert.equal(lines.at(-1), '#endif');
  assert.equal(code(src).split('#endif').length, 2, 'one block, the whole file');
  assert.doesNotMatch(code(src), /\bos_log\(|\bNSLog\(|\bprint\(|Logger\(/);
  assert.ok(!fs.readFileSync(path.join(root, 'safari/Glaze/Glaze.xcodeproj/project.pbxproj'), 'utf8').includes('GlazeAgentBridge'),
    'only scripts/stage-safari-dmg.py adds it');
});
