// Deterministic Safari Google auth races. The Swift source runs with memory storage and a suspended transport;
// the app session test substitutes only AuthenticationServices and app-group discovery, never starting an app or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../helpers/swift-native.cjs');
const root = path.join(__dirname, '../../extension');
const google = fs.readFileSync(path.join(root, '../safari/Glaze/Glaze Extension/GlazeGoogle.swift'), 'utf8');
const signIn = fs.readFileSync(path.join(root, '../safari/Glaze/Glaze/GlazeGoogleSignIn.swift'), 'utf8');
const skip = !S.supported;
const fixtures = String.raw`
final class Memory: GlazeGoogle.Vault, @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String: Data] = [:]
    func read(_ key: String) -> Data? { lock.withLock { items[key] } }
    func write(_ key: String, _ data: Data) -> Bool { lock.withLock { items[key] = data }; return true }
    func remove(_ key: String) { _ = lock.withLock { items.removeValue(forKey: key) } }
}
actor Google: GlazeGoogle.Transport {
    var sent: [[String: String]] = []
    var pending: [Int: CheckedContinuation<(Int, Data), Error>] = [:]
    func post(_ url: URL, form: [String: String]) async throws -> (Int, Data) {
        let index = sent.count
        sent.append(form.merging(["url": url.absoluteString]) { a, _ in a })
        return try await withCheckedThrowingContinuation { pending[index] = $0 }
    }
    func waitFor(_ n: Int) async { while sent.count < n { await Task.yield() } }
    func answer(_ n: Int, _ body: [String: String], status: Int = 200) {
        pending.removeValue(forKey: n)!.resume(returning: (status, try! JSONSerialization.data(withJSONObject: body)))
    }
}
typealias G = GlazeGoogle
let now = Date(timeIntervalSince1970: 2_000_000_000)
let vault = Memory(), transport = Google()
let slot = G.GroupSlot(folder: URL(fileURLWithPath: CommandLine.arguments[1]))
let engine = G.Engine(vault: vault, slot: slot, transport: transport, now: { now })
func grant(_ name: String) -> [String: String] {
    let claims: [String: Any] = ["iss": "https://accounts.google.com", "aud": G.client,
        "exp": now.timeIntervalSince1970 + 3600, "sub": "student", "email": "student@example.edu"]
    let id = "e30." + G.base64url(try! JSONSerialization.data(withJSONObject: claims)) + ".c2ln"
    return ["access_token": "access-" + name, "token_type": "Bearer", "scope": G.drive, "refresh_token": "refresh-" + name, "id_token": id]
}
func start(_ profile: String = "p") async throws -> G.SignIn {
    let s = try await engine.connect(profile: profile, hint: nil)
    _ = slot.put(s.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=" + s.state + "&code=" + s.state]))
    return s
}
func reason(_ f: () async throws -> Any) async -> String {
    do { _ = try await f(); return "ok" } catch let e as G.Fail { return e.rawValue } catch { return "other" }
}
func emit(_ result: [String: Any]) { print(String(data: try! JSONSerialization.data(withJSONObject: result), encoding: .utf8)!) }
`;
async function run(program, { app = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-google-races-'));
  const group = path.join(temp, 'group');
  fs.mkdirSync(group);
  let proc;
  try {
    const file = path.join(temp, 'Race.swift');
    const appSource = app ? signIn.replace(/\bASWebAuthenticationSession\b/g, 'TestSession')
      .replace(/\bASWebAuthenticationPresentationContextProviding\b/g, 'TestPresentation')
      .replace('GlazeGoogle.GroupSlot.shared().slot', 'testSlot') : '';
    fs.writeFileSync(file, google + fixtures + (app ? sessions + appSource : '') + program);
    proc = S.run(file, [group], { flags: ['-swift-version', '5', ...S.FEATURES, '-strict-concurrency=complete', ...(app ? ['-default-isolation', 'MainActor'] : [])] });
    const result = await proc.next();
    assert.equal(await proc.done, 0, proc.stderr());
    assert.doesNotMatch(proc.stderr(), /warning:|error:/);
    return result;
  } finally {
    if (proc) await proc.stop();
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

test('the container probe rejects a folder that can create empty files but cannot write a callback payload', { skip }, async () => {
  const r = await run(String.raw`
import Darwin
// Restrict this interpreter only, after it has loaded: empty file creation still works, payload writes fail with EFBIG.
var original = rlimit()
precondition(getrlimit(RLIMIT_FSIZE, &original) == 0)
var limited = original
limited.rlim_cur = 0
let oldSignal = signal(SIGXFSZ, SIG_IGN)
precondition(setrlimit(RLIMIT_FSIZE, &limited) == 0)
let found = G.GroupSlot.locate(groups: ["test"], container: { _ in slot.folder })
let callback = slot.put(String(repeating: "s", count: 43), Data([1]))
precondition(setrlimit(RLIMIT_FSIZE, &original) == 0)
signal(SIGXFSZ, oldSignal)
let left = try! FileManager.default.contentsOfDirectory(atPath: slot.folder.path)
emit(["step": found.missing?.rawValue ?? "slot", "callback": callback,
      "probes": left.filter { $0.hasPrefix(".google-write-") }.count])
`);
  assert.equal(r.callback, false, 'the callback payload really is refused by the filesystem');
  assert.equal(r.step, 'writable', 'creating an empty file does not prove payload writes work');
  assert.equal(r.probes, 0, 'a refused payload must not leave a probe file');
});

test('the container probe checks the atomic write used by callback files', { skip }, async () => {
  const r = await run(String.raw`
func acl(_ args: [String]) {
    let chmod = Process()
    chmod.executableURL = URL(fileURLWithPath: "/bin/chmod")
    chmod.arguments = args + [slot.folder.path]
    try! chmod.run()
    chmod.waitUntilExit()
    precondition(chmod.terminationStatus == 0)
}
// Plain file creation works; moving the callback's auxiliary file into place requires delete_child permission.
acl(["+a", "everyone deny delete_child"])
let found = G.GroupSlot.locate(groups: ["test"], container: { _ in slot.folder })
let callback = slot.put(String(repeating: "s", count: 43), Data([1]))
acl(["-N"])
emit(["step": found.missing?.rawValue ?? "slot", "callback": callback])
`);
  assert.equal(r.callback, false, 'the callback atomic write really is refused by the ACL');
  assert.equal(r.step, 'writable', 'the probe must exercise the same write operation as the callback');
});

test('concurrent container probes and the sweep preserve callbacks and use separate filenames', { skip }, async () => {
  const r = await run(String.raw`
final class Probes: @unchecked Sendable {
    let lock = NSLock()
    var passed = 0
    func add(_ ok: Bool) { lock.withLock { if ok { passed += 1 } } }
}
let state = String(repeating: "s", count: 43), data = Data("callback".utf8)
precondition(slot.put(state, data))
let fm = FileManager.default, probes = Probes()
let inFlight = slot.folder.appendingPathComponent(".google-write-" + UUID().uuidString)
try! Data([1]).write(to: inFlight)
try! fm.setAttributes([.modificationDate: Date.distantPast], ofItemAtPath: inFlight.path)
let cutoff = Date().addingTimeInterval(-600)
DispatchQueue.concurrentPerform(iterations: 32) { _ in
    probes.add(G.GroupSlot.writable(slot.folder))
    slot.sweep(olderThan: cutoff)
}
let preserved = (try? Data(contentsOf: inFlight)) == Data([1])
try! fm.removeItem(at: inFlight)
let callback = slot.take(state) == data
let left = try! fm.contentsOfDirectory(atPath: slot.folder.path)
emit(["passed": probes.passed, "inFlight": preserved, "callback": callback, "left": left])
`);
  assert.deepEqual(r, { passed: 32, inFlight: true, callback: true, left: [] });
});

test('a superseded Connect drops its late grant without revoking the newer connection', { skip }, async () => {
  const r = await run(String.raw`
_ = try await start()
let old = Task { await reason { try await engine.finish(profile: "p", wait: 0) } }
await transport.waitFor(1)
_ = try await start()
let fresh = Task { try await engine.finish(profile: "p", wait: 0) }
await transport.waitFor(2)
await transport.answer(1, grant("new"))
_ = try await fresh.value
await transport.answer(0, grant("old"))
let oldResult = await old.value
let token = try await engine.token(profile: "p", sub: nil)
emit(["old": oldResult, "token": token.token, "revokes": await transport.sent.filter { $0["url"]?.hasSuffix("/revoke") == true }.count])
`);
  assert.deepEqual(r, { old: 'signin', token: 'access-new', revokes: 0 });
});

test('native drop forgets only the refused access token and renews with the saved grant', { skip }, async () => {
  const r = await run(String.raw`
_ = vault.write("refresh.p", try! JSONEncoder().encode(G.Engine.Saved(refresh: "refresh-old", sub: "student", email: "student@example.edu")))
let first = Task { try await engine.token(profile: "p", sub: "student") }
await transport.waitFor(1)
await transport.answer(0, grant("old"))
let old = try await first.value
let request = G.Request(["type": "google.drop", "token": "someone-else"], profile: nil)!
let ignored = await G.reply(to: request, engine: engine)
if ignored["ok"] as? Bool != true { emit(["drop": false]); exit(0) }
// Use this profile's public native-message path as the worker does.
let profile = UUID()
_ = vault.write("refresh." + profile.uuidString, try! JSONEncoder().encode(G.Engine.Saved(refresh: "refresh-new", sub: "student", email: "student@example.edu")))
let held = Task { try await engine.token(profile: profile.uuidString, sub: "student") }
await transport.waitFor(2)
await transport.answer(1, grant("held"))
let heldToken = try await held.value
_ = await G.reply(to: G.Request(["type": "google.drop", "token": "someone-else"], profile: profile)!, engine: engine)
let same = try await engine.token(profile: profile.uuidString, sub: "student")
let dropped = await G.reply(to: G.Request(["type": "google.drop", "token": heldToken.token], profile: profile)!, engine: engine)
let fresh = Task { try await engine.token(profile: profile.uuidString, sub: "student") }
await transport.waitFor(3)
await transport.answer(2, grant("fresh"))
let next = try await fresh.value
emit(["drop": dropped["ok"] as? Bool == true, "same": same.token, "next": next.token,
      "refresh": await transport.sent.last!["refresh_token"]!, "oldProfile": old.token])
`);
  assert.deepEqual(r, { drop: true, same: 'access-held', next: 'access-fresh', refresh: 'refresh-new', oldProfile: 'access-old' });
});

// Disconnect is this device only (owner, 2026-10-31): the refresh token is forgotten here, Google's grant kept.
test('Disconnect sends nothing to Google, and a Connect right after it starts at once', { skip }, async () => {
  const r = await run(String.raw`
_ = vault.write("refresh.p", try! JSONEncoder().encode(G.Engine.Saved(refresh: "refresh-old", sub: "student", email: "student@example.edu")))
let d = await engine.disconnect(profile: "p")
_ = try await engine.connect(profile: "p", hint: nil)
emit(["had": d, "sent": await transport.sent.count, "left": vault.read("refresh.p") == nil])
`);
  assert.deepEqual(r, { had: true, sent: 0, left: true });
});

for (const early of [false, true]) test(`a disconnected profile's late exchange cannot touch a newer authorization in another profile: newer Connect ${early ? 'before' : 'after'} the old exchange`, { skip }, async () => {
  const r = await run(String.raw`
let oldSignIn = try await start("old")
` + (early ? '_ = try await start("new")\n' : '') + String.raw`
// The fixed test clock is later than file mtimes; deliver the callback after both Connects have swept old files.
_ = slot.put(oldSignIn.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=" + oldSignIn.state + "&code=old"]))
let old = Task { await reason { try await engine.finish(profile: "old", wait: 0) } }
await transport.waitFor(1)
_ = await engine.disconnect(profile: "old")
` + (!early ? '_ = try await start("new")\n' : '') + String.raw`
let fresh = Task { try await engine.finish(profile: "new", wait: 0) }
await transport.waitFor(2)
await transport.answer(1, grant("new"))
_ = try await fresh.value
await transport.answer(0, grant("old"))
let result = await old.value
let token = try await engine.token(profile: "new", sub: nil)
emit(["old": result, "token": token.token, "revokes": await transport.sent.filter { $0["url"]?.hasSuffix("/revoke") == true }.count])
`);
  assert.deepEqual(r, { old: 'signin', token: 'access-new', revokes: 0 });
});

for (const response of ['invalid_grant', 'scope', 'success']) {
  test(`a refresh started during Connect cannot replace or delete the completed grant: ${response}`, { skip }, async () => {
    const r = await run(String.raw`
_ = vault.write("refresh.p", try! JSONEncoder().encode(G.Engine.Saved(refresh: "refresh-old", sub: "student", email: "student@example.edu")))
_ = try await start()
let old = Task { await reason { try await engine.token(profile: "p", sub: nil) } }
await transport.waitFor(1)
let fresh = Task { try await engine.finish(profile: "p", wait: 0) }
await transport.waitFor(2)
await transport.answer(1, grant("new"))
_ = try await fresh.value
` + (response === 'invalid_grant' ? 'await transport.answer(0, ["error": "invalid_grant"], status: 400)' : response === 'scope'
      ? 'await transport.answer(0, grant("old").merging(["scope": "openid email"]) { _, b in b })'
      : 'await transport.answer(0, grant("old"))') + String.raw`
let oldResult = await old.value
let saved = vault.read("refresh.p").flatMap { try? JSONDecoder().decode(G.Engine.Saved.self, from: $0) }
let token = await reason { try await engine.token(profile: "p", sub: nil) }
emit(["old": oldResult, "refresh": saved?.refresh ?? "", "tokenResult": token, "status": await engine.status(profile: "p")])
`);
    assert.equal(r.old, 'signin');
    assert.equal(r.refresh, 'refresh-new');
    assert.equal(r.tokenResult, 'ok');
    assert.deepEqual(r.status, { ok: true, sub: 'student', email: 'student@example.edu', pending: false });
  });
}

const sessions = String.raw`
import AuthenticationServices
import AppKit
let testSlot: G.GroupSlot? = slot
@MainActor protocol TestPresentation: AnyObject {
    func presentationAnchor(for session: TestSession) -> ASPresentationAnchor
}
@MainActor final class TestSession {
    static var created: [TestSession] = []
    static var starts = true
    let completion: @Sendable (URL?, Error?) -> Void
    var presentationContextProvider: (any TestPresentation)?
    var prefersEphemeralWebBrowserSession = false
    var cancels = 0
    init(url: URL, callbackURLScheme: String?, completionHandler: @escaping @Sendable (URL?, Error?) -> Void) {
        completion = completionHandler
        Self.created.append(self)
    }
    func start() -> Bool { Self.starts }
    func cancel() { cancels += 1 } // Programmatic cancel need not call completion.
    func complete(_ url: URL?) { completion(url, nil) }
}
func settle() async { for _ in 0..<20 { await Task.yield() } }
`;

test('replacing an app sign-in completes the displaced caller once and ignores its late callback', { skip }, async () => {
  const r = await run(String.raw`
let manager = GlazeGoogleSignIn()
let s = G.SignIn(state: String(repeating: "s", count: 43), challenge: String(repeating: "c", count: 43), hint: nil)
var first = 0, second = 0
_ = manager.open(G.signInURL(s)) { first += 1 }
let old = TestSession.created[0]
_ = manager.open(G.signInURL(s)) { second += 1 }
let displaced = first
let current = TestSession.created[1]
current.complete(URL(string: G.redirect + "?state=" + s.state + "&code=current"))
await settle()
old.complete(URL(string: G.redirect + "?state=" + s.state + "&code=old"))
await settle()
let reply = slot.take(s.state).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: String]
emit(["displaced": displaced, "first": first, "second": second, "cancels": old.cancels, "reply": reply ?? [:]])
`, { app: true });
  assert.deepEqual(r, { displaced: 1, first: 1, second: 1, cancels: 1,
    reply: { url: 'com.googleusercontent.apps.1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh:/oauth2redirect?state=' + 's'.repeat(43) + '&code=current' } });
});

test('a failed session start completes once even if AuthenticationServices later calls back', { skip }, async () => {
  const r = await run(String.raw`
let manager = GlazeGoogleSignIn()
let s = G.SignIn(state: String(repeating: "s", count: 43), challenge: String(repeating: "c", count: 43), hint: nil)
var done = 0
TestSession.starts = false
_ = manager.open(G.signInURL(s)) { done += 1 }
TestSession.created[0].complete(URL(string: G.redirect + "?state=" + s.state + "&code=late"))
await settle()
let reply = slot.take(s.state).flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: String]
emit(["done": done, "reply": reply ?? [:]])
`, { app: true });
  assert.deepEqual(r, { done: 1, reply: { error: 'auth' } });
});

test('concurrent native requests share one initialized HTTP session without a lazy-initialization race', { skip }, async () => {
  const r = await run(String.raw`
extension GlazeGoogle.HTTP { func testSession() -> URLSession { session } }
final class Sessions: @unchecked Sendable {
    let lock = NSLock()
    var all: [ObjectIdentifier: URLSession] = [:]
    var redirect = "unset"
    func add(_ session: URLSession) { lock.withLock { all[ObjectIdentifier(session)] = session } }
    func redirected(_ request: URLRequest?) { lock.withLock { redirect = request == nil ? "refused" : "followed" } }
}
let http = G.HTTP(), sessions = Sessions()
// Touch only session construction: no URLSession tasks or network requests are started.
DispatchQueue.concurrentPerform(iterations: 32) { _ in sessions.add(http.testSession()) }
let count = sessions.all.count
let session = http.testSession()
let request = URLRequest(url: G.tokenURL), task = session.dataTask(with: G.tokenURL)
(session.delegate as? URLSessionTaskDelegate)?.urlSession?(session, task: task,
    willPerformHTTPRedirection: HTTPURLResponse(url: G.tokenURL, statusCode: 302, httpVersion: nil, headerFields: nil)!,
    newRequest: request, completionHandler: { sessions.redirected($0) })
task.cancel()
for session in sessions.all.values { session.invalidateAndCancel() }
emit(["sessions": count, "redirect": sessions.redirect])
`);
  assert.deepEqual(r, { sessions: 1, redirect: 'refused' });
});
