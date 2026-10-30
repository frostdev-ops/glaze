// Deterministic Safari Google auth races. The Swift source runs with memory storage and a suspended transport;
// the app session test substitutes only AuthenticationServices and app-group discovery, never starting an app or network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('./helpers/swift-native.cjs');
const root = path.join(__dirname, '..');
const google = fs.readFileSync(path.join(root, 'safari/Glaze/Glaze Extension/GlazeGoogle.swift'), 'utf8');
const signIn = fs.readFileSync(path.join(root, 'safari/Glaze/Glaze/GlazeGoogleSignIn.swift'), 'utf8');
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
    var holdRevokes = false
    func suspendRevocation() { holdRevokes = true }
    func post(_ url: URL, form: [String: String]) async throws -> (Int, Data) {
        let index = sent.count
        sent.append(form.merging(["url": url.absoluteString]) { a, _ in a })
        if url == GlazeGoogle.revokeURL && !holdRevokes { return (200, Data()) }
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
      .replace('GlazeGoogle.GroupSlot.shared()', 'testSlot') : '';
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
emit(["old": oldResult, "token": token.token, "revokes": await transport.sent.filter { $0["url"] == G.revokeURL.absoluteString }.count])
`);
  assert.deepEqual(r, { old: 'signin', token: 'access-new', revokes: 0 });
});

test('Connect waits for an already dispatched revocation before starting a new authorization', { skip }, async () => {
  const r = await run(String.raw`
_ = vault.write("refresh.p", try! JSONEncoder().encode(G.Engine.Saved(refresh: "refresh-old", sub: "student", email: "student@example.edu")))
await transport.suspendRevocation()
let disconnect = Task { await engine.disconnect(profile: "p") }
await transport.waitFor(1)
actor Progress {
    var started = false, connected = false
    func start() { started = true }
    func connect() { connected = true }
}
let progress = Progress()
let connect = Task {
    await progress.start()
    _ = try await engine.connect(profile: "p", hint: nil)
    await progress.connect()
}
while !(await progress.started) { await Task.yield() }
// Let the actor process Connect while the revocation response is deliberately held.
try await Task.sleep(nanoseconds: 20_000_000)
let before = await progress.connected
await transport.answer(0, [:])
_ = await disconnect.value
try await connect.value
emit(["beforeRevoked": before, "afterRevoked": await progress.connected])
`);
  assert.deepEqual(r, { beforeRevoked: false, afterRevoked: true });
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
    assert.deepEqual(r.status, { ok: true, sub: 'student', email: 'student@example.edu' });
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
