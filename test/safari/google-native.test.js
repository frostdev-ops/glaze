// Safari's Google sign-in (safari/Glaze/Glaze Extension/GlazeGoogle.swift), run in Swift's interpreter with an in-memory
// vault, a temporary folder as the app group and a scripted Google: no app bundle, Keychain item or network request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const swift = require('../helpers/swift-native.cjs');

const root = path.join(__dirname, '../../extension');
const safari = path.join(__dirname, '../../safari/Glaze');
const nativeFile = path.join(safari, 'Glaze Extension/GlazeGoogle.swift');
const read = (f) => fs.readFileSync(path.join(safari, f), 'utf8');
const plist = (file) => JSON.parse(spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }).stdout);

const DRIVER = String.raw`
final class Memory: GlazeGoogle.Vault, @unchecked Sendable {
    let lock = NSLock(); var items: [String: Data] = [:]
    func read(_ key: String) -> Data? { lock.withLock { items[key] } }
    func write(_ key: String, _ data: Data) -> Bool { lock.withLock { items[key] = data }; return true }
    func remove(_ key: String) { _ = lock.withLock { items.removeValue(forKey: key) } }
}
final class Google: GlazeGoogle.Transport, @unchecked Sendable {
    let lock = NSLock(); var answers: [(Int, [String: Any])] = []; var sent: [[String: String]] = []
    var during: (@Sendable () async -> Void)?
    func post(_ url: URL, form: [String: String]) async throws -> (Int, Data) {
        if let d = lock.withLock({ () -> (@Sendable () async -> Void)? in let d = during; during = nil; return d }) { await d() }
        return try lock.withLock {
            sent.append(form.merging(["url": url.absoluteString]) { a, _ in a })
            guard !answers.isEmpty else { throw URLError(.notConnectedToInternet) }
            let (s, j) = answers.removeFirst()
            return (s, try JSONSerialization.data(withJSONObject: j))
        }
    }
}
final class Clock: @unchecked Sendable { var t = Date(timeIntervalSince1970: 2_000_000_000) }
func jwt(_ claims: [String: Any]) -> String {
    "e30." + GlazeGoogle.base64url(try! JSONSerialization.data(withJSONObject: claims)) + ".c2ln"
}
func why(_ f: () throws -> Any) -> String { do { _ = try f(); return "ok" } catch let e as GlazeGoogle.Fail { return e.rawValue } catch { return "other" } }
func whyAsync(_ f: () async throws -> Any) async -> String { do { _ = try await f(); return "ok" } catch let e as GlazeGoogle.Fail { return e.rawValue } catch { return "other" } }

let G = GlazeGoogle.self
let clock = Clock()
let now = clock.t
var out: [String: Any] = [:]
let claims: [String: Any] = ["iss": "https://accounts.google.com", "aud": G.client, "exp": now.timeIntervalSince1970 + 3600, "sub": "1234567890", "email": "student@example.edu"]

// PKCE: RFC 7636 appendix B.
out["challenge"] = G.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
out["random"] = G.random()!.count

// The app's sign-in URL, and what it refuses (any page can open the scheme).
let s43 = String(repeating: "s", count: 43), c43 = String(repeating: "c", count: 43)
let signIn = G.SignIn(state: s43, challenge: c43, hint: "student@example.edu")
out["signInURL"] = G.signInURL(signIn).absoluteString
out["roundTrip"] = G.signIn(from: G.signInURL(signIn)) == signIn
out["refused"] = [
    "io.frostdev.glaze-google://other?state=\(s43)&challenge=\(c43)",
    "io.frostdev.glaze-google://signin?state=\(s43)&challenge=\(c43)&redirect_uri=x",
    "io.frostdev.glaze-google://signin?state=\(s43)&state=\(s43)&challenge=\(c43)",
    "io.frostdev.glaze-google://signin?state=short&challenge=\(c43)",
    "io.frostdev.glaze-google://signin?state=\(s43)&challenge=\(c43)x",
    "io.frostdev.glaze-google://signin?state=\(s43)&challenge=\(c43)&hint=not%20an%20email",
    "https://signin?state=\(s43)&challenge=\(c43)",
].map { G.signIn(from: URL(string: $0)!) == nil }
let auth = URLComponents(url: G.authURL(signIn), resolvingAgainstBaseURL: false)!
out["authHost"] = (auth.host ?? "") + auth.path
out["authQuery"] = Dictionary(uniqueKeysWithValues: auth.queryItems!.map { ($0.name, $0.value ?? "") })
out["authSelect"] = URLComponents(url: G.authURL(G.SignIn(state: s43, challenge: c43, hint: nil)), resolvingAgainstBaseURL: false)!
    .queryItems!.first { $0.name == "prompt" }?.value ?? ""
out["authPlus"] = G.authURL(G.SignIn(state: s43, challenge: c43, hint: "a+b@example.edu")).absoluteString.contains("login_hint=a%2Bb@example.edu")

// The redirect Google sends back.
let back = G.redirect + "?state=\(s43)&code=4/abc&scope=x"
out["code"] = (try? G.code(from: back, state: s43)) ?? ""
out["codeFails"] = [
    why { try G.code(from: back, state: c43) },
    why { try G.code(from: G.redirect + "?state=\(s43)&error=access_denied", state: s43) },
    why { try G.code(from: G.redirect + "?state=\(s43)&error=server_error", state: s43) },
    why { try G.code(from: "evil:/oauth2redirect?state=\(s43)&code=x", state: s43) },
    why { try G.code(from: G.callbackScheme + ":/other?state=\(s43)&code=x", state: s43) },
    why { try G.code(from: back + "&code=y", state: s43) },
    why { try G.code(from: G.redirect + "?state=\(s43)", state: s43) },
]

// The token endpoint's answers.
func body(_ j: [String: Any]) -> Data { try! JSONSerialization.data(withJSONObject: j) }
let good: [String: Any] = ["access_token": "ya29.a", "token_type": "Bearer", "expires_in": 3599, "scope": "openid \(G.drive) email", "refresh_token": "1//r", "id_token": jwt(claims)]
out["grantFails"] = [
    why { try G.grant(status: 200, body: body(good.merging(["scope": "openid email"]) { _, b in b }), now: now) },
    why { try G.grant(status: 200, body: body(good.merging(["token_type": "mac"]) { _, b in b }), now: now) },
    why { try G.grant(status: 400, body: body(["error": "invalid_grant"]), now: now) },
    why { try G.grant(status: 401, body: body(["error": "invalid_client"]), now: now) },
    why { try G.grant(status: 503, body: Data(), now: now) },
]
out["grantExpires"] = (try? G.grant(status: 200, body: body(good), now: now))?.expires.timeIntervalSince(now) ?? -1
out["accountFails"] = [
    why { try G.account(idToken: jwt(claims.merging(["aud": "other.apps.googleusercontent.com"]) { _, b in b }), now: now) },
    why { try G.account(idToken: jwt(claims.merging(["iss": "https://evil.example"]) { _, b in b }), now: now) },
    why { try G.account(idToken: jwt(claims.merging(["exp": now.timeIntervalSince1970 - 3600]) { _, b in b }), now: now) },
    why { try G.account(idToken: jwt(claims.merging(["aud": [G.client, "x"]]) { _, b in b }), now: now) },
    why { try G.account(idToken: "not.a.jwt", now: now) },
]
out["accountArray"] = (try? G.account(idToken: jwt(claims.merging(["aud": [G.client, "x"], "azp": G.client]) { _, b in b }), now: now))?.sub ?? ""

// A whole sign-in, then tokens, a revoked grant and a disconnect.
let group = URL(fileURLWithPath: CommandLine.arguments[1])
let vault = Memory(), google = Google(), slot = G.GroupSlot(folder: group)
let engine = G.Engine(vault: vault, slot: slot, transport: google, now: { clock.t })
let p = UUID(uuidString: "6F1C0A3E-1B2C-4D5E-8F90-123456789ABC")!
func ask(_ m: [String: Any], profile: UUID? = p) async -> [String: Any] {
    await G.reply(to: G.Request(m, profile: profile)!, engine: engine) { _ in true }
}
out["status0"] = await ask(["type": "google.status"])
out["token0"] = await ask(["type": "google.token"])
let connect = await ask(["type": "google.connect"])
out["connect"] = connect.filter { $0.key != "open" }
let started = G.signIn(from: URL(string: connect["open"] as! String)!)!
let pending = try! JSONSerialization.jsonObject(with: vault.items["pending." + p.uuidString]!) as! [String: Any]
out["challengeIsVerifiers"] = started.challenge == G.challenge(pending["verifier"] as! String)
out["openHasNoVerifier"] = !(connect["open"] as! String).contains(pending["verifier"] as! String)
out["finishEarly"] = await ask(["type": "google.finish", "wait": 0])
// The app's answer, as GlazeGoogleSignIn writes it.
_ = slot.put(started.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=\(started.state)&code=4/code"]))
google.answers = [(200, good)]
out["finish"] = await ask(["type": "google.finish", "wait": 1000])
out["exchange"] = google.sent.last!
out["slotLeft"] = (try? FileManager.default.contentsOfDirectory(atPath: group.path))?.count ?? -1
out["pendingLeft"] = vault.items["pending." + p.uuidString] != nil
out["finishAgain"] = await ask(["type": "google.finish"])
out["status1"] = await ask(["type": "google.status"])
out["otherProfile"] = await ask(["type": "google.token"], profile: nil)
out["tokenHeld"] = await ask(["type": "google.token", "sub": "1234567890"])
out["sentAfterHeld"] = google.sent.count
out["tokenAccount"] = await ask(["type": "google.token", "sub": "999"])
out["tokenBadSub"] = await ask(["type": "google.token", "sub": "../x"])
clock.t = clock.t.addingTimeInterval(3600)
google.answers = [(200, ["access_token": "ya29.b", "token_type": "Bearer", "expires_in": 3599, "scope": "\(G.drive) openid email"])]
out["tokenRefreshed"] = await ask(["type": "google.token"])
out["refreshForm"] = google.sent.last!
clock.t = clock.t.addingTimeInterval(3600)
google.answers = [(200, good.merging(["id_token": jwt(claims.merging(["sub": "other", "exp": clock.t.timeIntervalSince1970 + 3600]) { _, b in b })]) { _, b in b })]
out["tokenSwitched"] = await ask(["type": "google.token"])
out["tokenOffline"] = await ask(["type": "google.token"])
google.answers = [(400, ["error": "invalid_grant"])]
out["tokenRevoked"] = await ask(["type": "google.token"])
out["tokenAfterRevoked"] = await ask(["type": "google.token"])
// A cancelled sign-in, then one that comes back with another state's code.
let c2 = G.signIn(from: URL(string: (await ask(["type": "google.connect", "hint": "student@example.edu"]))["open"] as! String)!)!
out["hint"] = c2.hint ?? ""
_ = slot.put(c2.state, try! JSONSerialization.data(withJSONObject: ["error": "cancel"]))
out["cancelled"] = await ask(["type": "google.finish"])
let c3 = G.signIn(from: URL(string: (await ask(["type": "google.connect"]))["open"] as! String)!)!
_ = slot.put(c3.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=\(c2.state)&code=4/x"]))
out["wrongState"] = await ask(["type": "google.finish"])
let c4 = G.signIn(from: URL(string: (await ask(["type": "google.connect"]))["open"] as! String)!)!
_ = slot.put(c4.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=\(c4.state)&code=4/y"]))
google.answers = [(200, good.merging(["scope": "openid email"]) { _, b in b })]
out["noDrive"] = await ask(["type": "google.finish"])
out["badHint"] = await ask(["type": "google.connect", "hint": "nope"])
// Connected again, then disconnected.
let c5 = G.signIn(from: URL(string: (await ask(["type": "google.connect"]))["open"] as! String)!)!
_ = slot.put(c5.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=\(c5.state)&code=4/z"]))
google.answers = [(200, good.merging(["id_token": jwt(claims.merging(["exp": clock.t.timeIntervalSince1970 + 3600]) { _, b in b })]) { _, b in b }), (200, [:])]
out["reconnected"] = await ask(["type": "google.finish"])
out["disconnect"] = await ask(["type": "google.disconnect"])
out["revokeForm"] = google.sent.last!
out["vaultLeft"] = vault.items.count
out["disconnectAgain"] = await ask(["type": "google.disconnect"])
// Disconnect while Google answers: the late grant is dropped and revoked, the late refresh not held.
let c6 = G.signIn(from: URL(string: (await ask(["type": "google.connect"]))["open"] as! String)!)!
_ = slot.put(c6.state, try! JSONSerialization.data(withJSONObject: ["url": G.redirect + "?state=\(c6.state)&code=4/late"]))
google.answers = [(200, good.merging(["id_token": jwt(claims.merging(["exp": clock.t.timeIntervalSince1970 + 3600]) { _, b in b })]) { _, b in b }), (200, [:]), (200, [:])]
google.during = { _ = await engine.disconnect(profile: p.uuidString) }
out["lateFinish"] = await ask(["type": "google.finish"])
out["lateRevoke"] = google.sent.last!
out["lateStatus"] = await ask(["type": "google.status"])
_ = vault.write("refresh." + p.uuidString, try! JSONEncoder().encode(G.Engine.Saved(refresh: "1//s", sub: "1234567890", email: "student@example.edu")))
google.answers = [(200, [:]), (200, ["access_token": "ya29.late", "token_type": "Bearer", "expires_in": 3599, "scope": G.drive])] // the revoke inside Disconnect answers first
google.during = { _ = await engine.disconnect(profile: p.uuidString) }
out["lateToken"] = await ask(["type": "google.token"])
out["lateTokenAfter"] = await ask(["type": "google.token"])
out["unknown"] = await ask(["type": "google.nope"])
out["notOurs"] = G.Request(["type": "ai.status"], profile: nil) == nil
let noGroup = G.Engine(vault: Memory(), slot: nil, transport: google)
out["noGroup"] = [await G.reply(to: G.Request(["type": "google.status"], profile: nil)!, engine: noGroup),
                  await G.reply(to: G.Request(["type": "google.connect"], profile: nil)!, engine: noGroup)]
print(String(data: try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]), encoding: .utf8)!)
`;

let result, diagnostics;
test.before(() => {
  if (!swift.supported) return;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-google-native-'));
  try {
    const file = path.join(temp, 'Google.swift'), group = path.join(temp, 'group');
    fs.mkdirSync(group);
    fs.writeFileSync(file, fs.readFileSync(nativeFile, 'utf8') + DRIVER);
    const run = spawnSync('xcrun', ['swift', '-swift-version', '5', ...swift.FEATURES, '-strict-concurrency=complete', file, group],
      { encoding: 'utf8', timeout: 180000 });
    assert.equal(run.status, 0, run.stderr);
    result = JSON.parse(run.stdout.trim()); diagnostics = run.stderr;
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

const skip = !swift.supported;
test('PKCE is S256 of the verifier (RFC 7636 appendix B); verifiers and states are 43 random characters', { skip }, () => {
  assert.equal(result.challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(result.random, 43);
});
test("the app's sign-in URL carries only a checked state, challenge and hint", { skip }, () => {
  assert.equal(result.signInURL, `io.frostdev.glaze-google://signin?state=${'s'.repeat(43)}&challenge=${'c'.repeat(43)}&hint=student@example.edu`);
  assert.equal(result.roundTrip, true);
  assert.deepEqual(result.refused, Array(7).fill(true));
});
test("Google's authorization URL: the iOS client, the code flow with S256, Drive's scopes", { skip }, () => {
  assert.equal(result.authHost, 'accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(result.authQuery, {
    client_id: '1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh.apps.googleusercontent.com',
    redirect_uri: 'com.googleusercontent.apps.1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh:/oauth2redirect',
    response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file openid email',
    state: 's'.repeat(43), code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', login_hint: 'student@example.edu',
  });
  assert.equal(result.authSelect, 'select_account');
  assert.equal(result.authPlus, true);
});
test('the redirect is accepted only with our scheme, path and state', { skip }, () => {
  assert.equal(result.code, '4/abc');
  assert.deepEqual(result.codeFails, ['state', 'cancel', 'auth', 'auth', 'auth', 'auth', 'auth']);
});
test("the token endpoint's answers: Drive's scope, a bearer token, invalid_grant as revoked", { skip }, () => {
  assert.deepEqual(result.grantFails, ['scope', 'auth', 'revoked', 'auth', 'network']);
  assert.equal(result.grantExpires, 3599);
  assert.deepEqual(result.accountFails, ['auth', 'auth', 'auth', 'auth', 'auth']);
  assert.equal(result.accountArray, '1234567890');
});
test('a sign-in: the verifier stays in the extension, the code is exchanged with it, the refresh token kept', { skip }, () => {
  assert.deepEqual(result.status0, { ok: true, email: null, sub: null });
  assert.deepEqual(result.token0, { ok: false, why: 'signin' });
  assert.deepEqual(result.connect, { ok: true, pending: true, opened: true });
  assert.equal(result.challengeIsVerifiers, true);
  assert.equal(result.openHasNoVerifier, true);
  assert.deepEqual(result.finishEarly, { ok: false, why: 'pending' });
  assert.deepEqual(result.finish, { ok: true, email: 'student@example.edu', sub: '1234567890' });
  const { code_verifier: verifier, ...form } = result.exchange;
  assert.match(verifier, /^[\w-]{43}$/);
  assert.deepEqual(form, {
    url: 'https://oauth2.googleapis.com/token', client_id: '1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh.apps.googleusercontent.com',
    code: '4/code', grant_type: 'authorization_code', redirect_uri: 'com.googleusercontent.apps.1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh:/oauth2redirect',
  });
  assert.equal(result.slotLeft, 0);
  assert.equal(result.pendingLeft, false);
  assert.deepEqual(result.finishAgain, { ok: false, why: 'signin' });
  assert.deepEqual(result.status1, { ok: true, email: 'student@example.edu', sub: '1234567890' });
});
test('tokens: per Safari profile, held until a minute before expiry, bound to the connected account', { skip }, () => {
  assert.deepEqual(result.otherProfile, { ok: false, why: 'signin' });
  assert.equal(result.tokenHeld.token, 'ya29.a');
  assert.equal(result.tokenHeld.expiresAt, (2_000_000_000 + 3599) * 1000);
  assert.equal(result.sentAfterHeld, 1);
  assert.deepEqual(result.tokenAccount, { ok: false, why: 'account' });
  assert.deepEqual(result.tokenBadSub, { ok: false, why: 'request' });
  assert.equal(result.tokenRefreshed.token, 'ya29.b');
  assert.deepEqual(result.refreshForm, { url: 'https://oauth2.googleapis.com/token', client_id: '1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh.apps.googleusercontent.com', grant_type: 'refresh_token', refresh_token: '1//r' });
  assert.deepEqual(result.tokenSwitched, { ok: false, why: 'account' });
  assert.deepEqual(result.tokenOffline, { ok: false, why: 'network' });
  assert.deepEqual(result.tokenRevoked, { ok: false, why: 'revoked' });
  assert.deepEqual(result.tokenAfterRevoked, { ok: false, why: 'signin' });
});
test('sign-ins that fail: cancelled, another state, no Drive scope, a bad hint', { skip }, () => {
  assert.equal(result.hint, 'student@example.edu');
  assert.deepEqual(result.cancelled, { ok: false, why: 'cancel' });
  assert.deepEqual(result.wrongState, { ok: false, why: 'state' });
  assert.deepEqual(result.noDrive, { ok: false, why: 'scope' });
  assert.deepEqual(result.badHint, { ok: false, why: 'request' });
});
test('disconnect revokes with the refresh token and forgets everything', { skip }, () => {
  assert.deepEqual(result.reconnected, { ok: true, email: 'student@example.edu', sub: '1234567890' });
  assert.deepEqual(result.disconnect, { ok: true, revoked: true, had: true });
  assert.deepEqual(result.revokeForm, { url: 'https://oauth2.googleapis.com/revoke', token: '1//r' });
  assert.equal(result.vaultLeft, 0);
  assert.deepEqual(result.disconnectAgain, { ok: true, revoked: false, had: false });
});
test('a Disconnect while Google answers wins: the late grant is revoked, the late token dropped', { skip }, () => {
  assert.deepEqual(result.lateFinish, { ok: false, why: 'signin' });
  assert.deepEqual(result.lateRevoke, { url: 'https://oauth2.googleapis.com/revoke', token: '1//r' });
  assert.deepEqual(result.lateStatus, { ok: true, email: null, sub: null });
  assert.deepEqual(result.lateToken, { ok: false, why: 'signin' });
  assert.deepEqual(result.lateTokenAfter, { ok: false, why: 'signin' });
});
test('fixed reasons; a build without the app group answers setup', { skip }, () => {
  assert.deepEqual(result.unknown, { ok: false, why: 'request' });
  assert.equal(result.notOurs, true);
  assert.deepEqual(result.noGroup, [{ ok: false, why: 'setup' }, { ok: false, why: 'setup' }]);
});
test('the Google code passes complete sendability checking', { skip }, () => {
  assert.doesNotMatch(diagnostics, /warning:|error:/);
});

test('nothing in the Google code logs, and the handler routes google.* before echoing', () => {
  for (const f of ['Glaze Extension/GlazeGoogle.swift', 'Glaze/GlazeGoogleSignIn.swift']) assert.doesNotMatch(read(f), /\b(os_log|NSLog|print|Logger|debugPrint)\(/, f);
  const handler = read('Glaze Extension/SafariWebExtensionHandler.swift');
  assert.ok(handler.indexOf('GlazeGoogle.Request(') > 0 && handler.indexOf('GlazeGoogle.Request(') < handler.indexOf('"echo"'));
});
const mac = { skip: process.platform !== 'darwin' }; // plutil
test('the project compiles the Google code into both apps and both extensions, the sign-in page into the apps only', mac, () => {
  const p = plist(path.join(safari, 'Glaze.xcodeproj/project.pbxproj'));
  const o = p.objects, ref = (name) => Object.keys(o).find((k) => o[k].isa === 'PBXFileReference' && o[k].path === name);
  const compiled = (name) => Object.values(o).find((t) => t.isa === 'PBXNativeTarget' && t.name === name).buildPhases.map((k) => o[k])
    .filter((ph) => ph.isa === 'PBXSourcesBuildPhase').flatMap((ph) => ph.files.map((f) => o[f].fileRef));
  const google = ref('GlazeGoogle.swift'), signIn = ref('GlazeGoogleSignIn.swift');
  for (const t of ['Glaze', 'Glaze Extension', 'Glaze iOS', 'Glaze iOS Extension']) assert.ok(compiled(t).includes(google), t);
  for (const t of ['Glaze', 'Glaze iOS']) assert.ok(compiled(t).includes(signIn), t);
  for (const t of ['Glaze Extension', 'Glaze iOS Extension']) assert.ok(!compiled(t).includes(signIn), t);
  const group = (r) => Object.values(o).find((g) => g.isa === 'PBXGroup' && g.children?.includes(r)).path;
  assert.deepEqual([group(google), group(signIn)], ['Glaze Extension', 'Glaze']);
});
test('entitlements: iOS shares group.io.frostdev.Glaze; the Mac extension reaches the network; the Mac files gain no group', mac, () => {
  const p = plist(path.join(safari, 'Glaze.xcodeproj/project.pbxproj'));
  for (const [target, file] of [['Glaze iOS', 'Glaze iOS/Glaze iOS.entitlements'], ['Glaze iOS Extension', 'Glaze iOS/Glaze iOS Extension.entitlements']]) {
    const t = Object.values(p.objects).find((x) => x.isa === 'PBXNativeTarget' && x.name === target);
    for (const c of p.objects[t.buildConfigurationList].buildConfigurations) assert.equal(p.objects[c].buildSettings.CODE_SIGN_ENTITLEMENTS, file, target);
    assert.deepEqual(plist(path.join(safari, file)), { 'com.apple.security.application-groups': ['group.io.frostdev.Glaze'] });
  }
  assert.deepEqual(plist(path.join(safari, 'Glaze Extension/Release.entitlements')), { 'com.apple.security.app-sandbox': true, 'com.apple.security.network.client': true });
  assert.equal(plist(path.join(safari, 'Glaze/Release.entitlements'))['com.apple.security.application-groups'], undefined);
  const schemes = plist(path.join(safari, 'Glaze/Info.plist')).CFBundleURLTypes.flatMap((t) => t.CFBundleURLSchemes);
  assert.ok(schemes.includes('io.frostdev.glaze-google'));
  assert.match(read('Glaze Extension/GlazeGoogle.swift'), /static let appScheme = "io\.frostdev\.glaze-google"/);
});
