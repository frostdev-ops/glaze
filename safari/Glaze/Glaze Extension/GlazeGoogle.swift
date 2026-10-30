//
//  GlazeGoogle.swift
//  Glaze Extension (and both Glaze apps)
//
//  Google sign-in for Drive in Safari: lib/google.js's native flow. Google's "iOS" OAuth client, the authorization code
//  flow with PKCE (S256), no client secret. ASWebAuthenticationSession needs a window to present from (its
//  presentationContextProvider), and this extension has none, so the sign-in page runs in the Glaze app
//  (GlazeGoogleSignIn.swift). The code verifier never leaves this extension: the app gets only the state and the challenge
//  in its sign-in URL, and hands back the URL Google redirected to through a file named by the state in the app group's
//  container. This extension exchanges the code, keeps the refresh token in its own Keychain items (one per Safari
//  profile) and mints access tokens, held in this process's memory only. Messages (sendNativeMessage, type google.*):
//    { type: 'google.status' } → { ok: true, email, sub } (null until connected) | { ok: false, why: 'setup' }
//    { type: 'google.connect', hint? } → { ok: true, pending: true, open, opened }: open is the app's sign-in URL; opened,
//      whether this extension opened it (macOS); if not, the worker opens it in a tab for the student to tap (iOS)
//    { type: 'google.finish', wait? } → { ok: true, email, sub } | { ok: false, why: 'pending' (ask again) | 'cancel' |
//      'state' | 'scope' | 'auth' | 'network' | 'signin' (no sign-in started, or it expired) }; wait: ms to wait, ≤ 20000
//    { type: 'google.token', sub? } → { ok: true, token, expiresAt (ms since 1970) } | { ok: false, why: 'signin' |
//      'account' (sub isn't the connected account's) | 'network' | 'revoked' (Google refused the refresh token: forgotten) }
//    { type: 'google.disconnect' } → { ok: true, revoked, had }: the grant revoked with its refresh token, everything forgotten
//  Any other failure is { ok: false, why: 'request' | 'setup' }. Nothing here logs; replies carry fixed reasons only.
//

import CryptoKit
import Foundation
import Security

nonisolated enum GlazeGoogle {
    static let client = "1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh.apps.googleusercontent.com"
    /// The iOS client's callback scheme: its id reversed. ASWebAuthenticationSession catches it; no app registers it.
    static let callbackScheme = "com.googleusercontent.apps.1071735898350-h5i3v4abnj2o4btvn270vq9689585eeh"
    static let redirect = callbackScheme + ":/oauth2redirect"
    static let drive = "https://www.googleapis.com/auth/drive.file"
    static let scopes = [drive, "openid", "email"]
    static let authorize = URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    static let tokenURL = URL(string: "https://oauth2.googleapis.com/token")!
    static let revokeURL = URL(string: "https://oauth2.googleapis.com/revoke")!
    /// The app's sign-in URL: io.frostdev.glaze-google://signin?state=…&challenge=…[&hint=…]
    static let appScheme = "io.frostdev.glaze-google"
    /// A sign-in left unfinished this long is dropped; a held access token is renewed this long before Google's expiry.
    static let pendingFor: TimeInterval = 600, early: TimeInterval = 60, maxWait: TimeInterval = 20

    enum Fail: String, Error { case signin, account, network, revoked, cancel, state, scope, auth, setup, pending, request }

    // MARK: PKCE and URLs

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
    static func base64urlDecode(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        b += String(repeating: "=", count: (4 - b.count % 4) % 4)
        return Data(base64Encoded: b)
    }
    /// 32 random bytes, base64url: 43 characters, a verifier or a state.
    static func random() -> String? {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { return nil }
        return base64url(Data(bytes))
    }
    /// RFC 7636 S256.
    static func challenge(_ verifier: String) -> String { base64url(Data(SHA256.hash(data: Data(verifier.utf8)))) }

    static func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }
    static func validState(_ s: String) -> Bool { matches(s, "^[A-Za-z0-9_-]{43,128}$") }
    static func validChallenge(_ s: String) -> Bool { matches(s, "^[A-Za-z0-9_-]{43}$") }
    static func validEmail(_ s: String) -> Bool { s.utf8.count <= 320 && matches(s, "^[^@\\s]+@[^@\\s]+$") }
    static func validSub(_ s: String) -> Bool { matches(s, "^[A-Za-z0-9_-]{1,255}$") }

    struct SignIn: Equatable, Sendable { let state: String, challenge: String, hint: String? }

    static func signInURL(_ s: SignIn) -> URL {
        var c = URLComponents()
        c.scheme = appScheme
        c.host = "signin"
        c.queryItems = [URLQueryItem(name: "state", value: s.state), URLQueryItem(name: "challenge", value: s.challenge)]
            + (s.hint.map { [URLQueryItem(name: "hint", value: $0)] } ?? [])
        return c.url!
    }
    /// The app's sign-in URL, each value checked; nil for anything else (any page can open this scheme).
    static func signIn(from url: URL) -> SignIn? {
        guard url.scheme?.lowercased() == appScheme, url.host == "signin", url.path.isEmpty || url.path == "/",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        var q: [String: String] = [:]
        for i in items {
            guard ["state", "challenge", "hint"].contains(i.name), q[i.name] == nil, let v = i.value else { return nil }
            q[i.name] = v
        }
        guard let state = q["state"], validState(state), let challenge = q["challenge"], validChallenge(challenge) else { return nil }
        if let hint = q["hint"], !validEmail(hint) { return nil }
        return SignIn(state: state, challenge: challenge, hint: q["hint"])
    }
    /// Google's authorization URL for a sign-in, built here from checked values only.
    static func authURL(_ s: SignIn) -> URL {
        var c = URLComponents(url: authorize, resolvingAgainstBaseURL: false)!
        var q = [("client_id", client), ("redirect_uri", redirect), ("response_type", "code"), ("scope", scopes.joined(separator: " ")),
                 ("state", s.state), ("code_challenge", s.challenge), ("code_challenge_method", "S256")]
        q.append(s.hint.map { ("login_hint", $0) } ?? ("prompt", "select_account"))
        c.queryItems = q.map { URLQueryItem(name: $0.0, value: $0.1) }
        // URLComponents leaves "+" and "/" alone in a query; Google reads "+" as a space.
        c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return c.url!
    }

    /// The code in the URL Google sent back, once it is our redirect with our state.
    static func code(from callback: String, state: String) throws -> String {
        guard callback.utf8.count <= 8192, let c = URLComponents(string: callback), c.scheme?.lowercased() == callbackScheme,
              c.path == "/oauth2redirect", c.fragment == nil else { throw Fail.auth }
        var q: [String: String] = [:]
        for i in c.queryItems ?? [] {
            guard q[i.name] == nil else { throw Fail.auth }
            q[i.name] = i.value ?? ""
        }
        guard q["state"] == state else { throw Fail.state }
        if let error = q["error"] { throw error == "access_denied" ? Fail.cancel : Fail.auth }
        guard let code = q["code"], !code.isEmpty, code.utf8.count <= 2048 else { throw Fail.auth }
        return code
    }

    // MARK: Google's answers

    struct Account: Equatable, Codable, Sendable { let sub: String, email: String }
    struct Grant: Sendable { let access: String, expires: Date, refresh: String?, account: Account? }

    /// The token endpoint's answer (code exchange or refresh). invalid_grant: the refresh token is dead (revoked); other
    /// refusals: auth; Google unreachable or failing: network.
    static func grant(status: Int, body: Data, now: Date) throws -> Grant {
        let j = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        guard status == 200 else {
            if (400...499).contains(status) { throw j?["error"] as? String == "invalid_grant" ? Fail.revoked : Fail.auth }
            throw Fail.network
        }
        guard let j, let access = j["access_token"] as? String, !access.isEmpty, access.utf8.count <= 4096,
              (j["token_type"] as? String)?.lowercased() == "bearer" else { throw Fail.auth }
        guard ((j["scope"] as? String) ?? "").split(separator: " ").contains(Substring(drive)) else { throw Fail.scope }
        let s = (j["expires_in"] as? NSNumber)?.doubleValue ?? 0
        let refresh = j["refresh_token"] as? String
        if let refresh, refresh.isEmpty || refresh.utf8.count > 4096 { throw Fail.auth }
        let account = try (j["id_token"] as? String).map { try self.account(idToken: $0, now: now) }
        return Grant(access: access, expires: now.addingTimeInterval(s > 0 ? min(s, 86400) : 3600), refresh: refresh, account: account)
    }

    /// The account an ID token names. It comes straight from Google's token endpoint over TLS, which OpenID Connect Core
    /// 3.1.3.7 accepts in place of checking its signature; its issuer, audience and expiry are still checked.
    static func account(idToken: String, now: Date) throws -> Account {
        let parts = idToken.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3, let data = base64urlDecode(String(parts[1])),
              let c = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let iss = c["iss"] as? String, iss == "https://accounts.google.com" || iss == "accounts.google.com" else { throw Fail.auth }
        let aud = c["aud"] as? String ?? ((c["aud"] as? [String])?.contains(client) == true ? client : nil)
        guard aud == client, (c["aud"] is String || c["azp"] as? String == client),
              let exp = (c["exp"] as? NSNumber)?.doubleValue, exp > now.timeIntervalSince1970 - 300,
              let sub = c["sub"] as? String, validSub(sub), let email = c["email"] as? String, validEmail(email) else { throw Fail.auth }
        return Account(sub: sub, email: email)
    }

    // MARK: The engine

    /// The extension's side: sign-ins started and finished, tokens minted, the grant revoked.
    actor Engine {
        struct Pending: Codable { let state: String, verifier: String, at: Double }
        struct Saved: Codable { let refresh: String, sub: String, email: String }

        private let vault: Vault, slot: Slot?, transport: Transport, now: @Sendable () -> Date
        private var held: [String: (token: String, expires: Date, sub: String)] = [:]

        init(vault: Vault, slot: Slot?, transport: Transport, now: @escaping @Sendable () -> Date = { Date() }) {
            self.vault = vault; self.slot = slot; self.transport = transport; self.now = now
        }

        private func load<T: Decodable>(_ type: T.Type, _ key: String) -> T? { vault.read(key).flatMap { try? JSONDecoder().decode(T.self, from: $0) } }
        private func store<T: Encodable>(_ value: T, _ key: String) -> Bool { (try? JSONEncoder().encode(value)).map { vault.write(key, $0) } ?? false }

        func status(profile: String) -> [String: any Sendable] {
            guard slot != nil else { return ["ok": false, "why": Fail.setup.rawValue] }
            let s = load(Saved.self, "refresh." + profile)
            return ["ok": true, "email": s?.email ?? NSNull(), "sub": s?.sub ?? NSNull()]
        }

        func connect(profile: String, hint: String?) throws -> SignIn {
            guard let slot else { throw Fail.setup }
            if let hint, !validEmail(hint) { throw Fail.request }
            guard let state = random(), let verifier = random() else { throw Fail.setup }
            if let old = load(Pending.self, "pending." + profile) { slot.remove(old.state) }
            slot.sweep(olderThan: now().addingTimeInterval(-pendingFor))
            guard store(Pending(state: state, verifier: verifier, at: now().timeIntervalSince1970), "pending." + profile) else { throw Fail.setup }
            return SignIn(state: state, challenge: challenge(verifier), hint: hint)
        }

        func finish(profile: String, wait: TimeInterval) async throws -> Account {
            guard let slot else { throw Fail.setup }
            guard let p = load(Pending.self, "pending." + profile) else { throw Fail.signin }
            let drop = { self.vault.remove("pending." + profile); slot.remove(p.state) }
            guard now().timeIntervalSince1970 - p.at < pendingFor else { drop(); throw Fail.signin }
            let until = now().addingTimeInterval(min(max(wait, 0), maxWait))
            var reply = slot.take(p.state)
            while reply == nil, now() < until {
                try? await Task.sleep(nanoseconds: 250_000_000)
                reply = slot.take(p.state)
            }
            guard let reply else { throw Fail.pending }
            // The sign-in is answered either way: a new one starts with google.connect.
            drop()
            let r = (try? JSONSerialization.jsonObject(with: reply)) as? [String: Any]
            guard let url = r?["url"] as? String else { throw r?["error"] as? String == "cancel" ? Fail.cancel : Fail.auth }
            let code = try code(from: url, state: p.state)
            let (status, body) = try await post(tokenURL, ["client_id": client, "code": code, "code_verifier": p.verifier,
                                                           "grant_type": "authorization_code", "redirect_uri": redirect])
            let g: Grant
            do { g = try grant(status: status, body: body, now: now()) } catch Fail.revoked { throw Fail.auth } // a spent code
            guard let refresh = g.refresh, let account = g.account else { throw Fail.auth }
            guard store(Saved(refresh: refresh, sub: account.sub, email: account.email), "refresh." + profile) else { throw Fail.setup }
            held[profile] = (g.access, g.expires, account.sub)
            return account
        }

        func token(profile: String, sub: String?) async throws -> (token: String, expires: Date) {
            guard let s = load(Saved.self, "refresh." + profile) else { held[profile] = nil; throw Fail.signin }
            if let sub, sub != s.sub { throw Fail.account }
            if let h = held[profile], h.sub == s.sub, h.expires.timeIntervalSince(now()) > early { return (h.token, h.expires) }
            held[profile] = nil
            let (status, body) = try await post(tokenURL, ["client_id": client, "grant_type": "refresh_token", "refresh_token": s.refresh])
            let g: Grant
            do { g = try grant(status: status, body: body, now: now()) } catch Fail.revoked { vault.remove("refresh." + profile); throw Fail.revoked }
            catch Fail.scope { vault.remove("refresh." + profile); throw Fail.revoked } // Drive's access was taken back
            catch Fail.network { throw Fail.network } catch { throw Fail.auth }
            if let a = g.account, a.sub != s.sub { throw Fail.account }
            held[profile] = (g.access, g.expires, s.sub)
            return (g.access, g.expires)
        }

        func disconnect(profile: String) async -> (revoked: Bool, had: Bool) {
            let s = load(Saved.self, "refresh." + profile)
            if let p = load(Pending.self, "pending." + profile) { slot?.remove(p.state) }
            vault.remove("refresh." + profile)
            vault.remove("pending." + profile)
            held[profile] = nil
            guard let s else { return (false, false) }
            let r = try? await post(revokeURL, ["token": s.refresh])
            return (r?.0 == 200, true)
        }

        private func post(_ url: URL, _ form: [String: String]) async throws -> (Int, Data) {
            do { return try await transport.post(url, form: form) } catch { throw Fail.network }
        }
    }

    // MARK: Storage and transport

    protocol Vault: Sendable {
        func read(_ key: String) -> Data?
        func write(_ key: String, _ data: Data) -> Bool
        func remove(_ key: String)
    }
    /// The app's answers to sign-ins, by state.
    protocol Slot: Sendable {
        func put(_ state: String, _ data: Data) -> Bool
        func take(_ state: String) -> Data?
        func remove(_ state: String)
        func sweep(olderThan: Date)
    }
    protocol Transport: Sendable {
        func post(_ url: URL, form: [String: String]) async throws -> (Int, Data)
    }

    /// This process's own Keychain items (generic passwords): the refresh token and the sign-in under way, never synced,
    /// this device only.
    struct Keychain: Vault {
        let service = "io.frostdev.Glaze.google"
        private func query(_ key: String) -> [String: Any] {
            [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: key]
        }
        func read(_ key: String) -> Data? {
            var q = query(key)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            return SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess ? out as? Data : nil
        }
        func write(_ key: String, _ data: Data) -> Bool {
            remove(key)
            var q = query(key)
            q[kSecValueData as String] = data
            q[kSecAttrSynchronizable as String] = false
            #if os(iOS)
            q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            #endif
            return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
        }
        func remove(_ key: String) { SecItemDelete(query(key) as CFDictionary) }
    }

    /// Files in the app group's container, one per sign-in: google-<state>.json. The app writes, the extension takes.
    struct GroupSlot: Slot {
        let folder: URL
        private func file(_ state: String) -> URL? { validState(state) ? folder.appendingPathComponent("google-\(state).json") : nil }
        func put(_ state: String, _ data: Data) -> Bool {
            guard let f = file(state) else { return false }
            #if os(iOS)
            let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            #else
            let options: Data.WritingOptions = [.atomic]
            #endif
            return (try? data.write(to: f, options: options)) != nil
        }
        func take(_ state: String) -> Data? {
            guard let f = file(state), let d = try? Data(contentsOf: f) else { return nil }
            try? FileManager.default.removeItem(at: f)
            return d
        }
        func remove(_ state: String) { if let f = file(state) { try? FileManager.default.removeItem(at: f) } }
        func sweep(olderThan: Date) {
            let fm = FileManager.default
            for f in (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            where f.lastPathComponent.hasPrefix("google-") && f.pathExtension == "json" {
                if let d = try? f.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate, d < olderThan {
                    try? fm.removeItem(at: f)
                }
            }
        }
        /// The app group's container: macOS, from this process's own entitlement (only the DMG build has one); iOS,
        /// group.<app's bundle id>. nil without one, or if it can't be written.
        static func shared() -> GroupSlot? {
            #if os(macOS)
            guard let task = SecTaskCreateFromSelf(nil),
                  let groups = SecTaskCopyValueForEntitlement(task, "com.apple.security.application-groups" as CFString, nil) as? [String],
                  groups.count == 1 else { return nil }
            let group = groups[0]
            #else
            let id = Bundle.main.bundleIdentifier ?? ""
            let group = "group." + (id.hasSuffix(".Extension") ? String(id.dropLast(".Extension".count)) : id)
            #endif
            guard let folder = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group),
                  FileManager.default.isWritableFile(atPath: folder.path) else { return nil }
            return GroupSlot(folder: folder)
        }
    }

    /// Google's endpoints only: a form POST, no cookies, no cache, no redirects followed.
    final class HTTP: NSObject, Transport, URLSessionTaskDelegate, @unchecked Sendable {
        private lazy var session: URLSession = {
            let c = URLSessionConfiguration.ephemeral
            c.httpCookieStorage = nil
            c.urlCache = nil
            c.requestCachePolicy = .reloadIgnoringLocalCacheData
            c.timeoutIntervalForRequest = 15
            return URLSession(configuration: c, delegate: self, delegateQueue: nil)
        }()
        func post(_ url: URL, form: [String: String]) async throws -> (Int, Data) {
            var r = URLRequest(url: url)
            r.httpMethod = "POST"
            r.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            r.httpBody = Data(GlazeGoogle.form(form).utf8)
            let (data, response) = try await session.data(for: r)
            return ((response as? HTTPURLResponse)?.statusCode ?? 0, data)
        }
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    }

    /// application/x-www-form-urlencoded, keys sorted.
    static func form(_ f: [String: String]) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return f.sorted { $0.key < $1.key }.map {
            "\($0.key.addingPercentEncoding(withAllowedCharacters: allowed)!)=\($0.value.addingPercentEncoding(withAllowedCharacters: allowed)!)"
        }.joined(separator: "&")
    }

    // MARK: Messages

    /// A google.* message, its fields checked before anything awaits.
    struct Request: Sendable {
        let type: String, profile: String, hint: String?, sub: String?, wait: TimeInterval
        init?(_ message: Any?, profile: UUID?) {
            guard let m = message as? [String: Any], let type = m["type"] as? String, type.hasPrefix("google.") else { return nil }
            self.type = type
            self.profile = profile?.uuidString ?? "default"
            hint = m["hint"] as? String
            sub = m["sub"] as? String
            wait = ((m["wait"] as? NSNumber)?.doubleValue ?? 0) / 1000
        }
    }

    static let engine = Engine(vault: Keychain(), slot: GroupSlot.shared(), transport: HTTP())

    /// The reply to r. open: opens the app's sign-in URL where this process can (macOS), answering whether it did.
    static func reply(to r: Request, engine: Engine = engine, open: @Sendable (URL) async -> Bool = { _ in false }) async -> [String: any Sendable] {
        let fail = { (f: Fail) -> [String: any Sendable] in ["ok": false, "why": f.rawValue] }
        do {
            switch r.type {
            case "google.status": return await engine.status(profile: r.profile)
            case "google.connect":
                let url = signInURL(try await engine.connect(profile: r.profile, hint: r.hint))
                return ["ok": true, "pending": true, "open": url.absoluteString, "opened": await open(url)]
            case "google.finish":
                let a = try await engine.finish(profile: r.profile, wait: r.wait)
                return ["ok": true, "email": a.email, "sub": a.sub]
            case "google.token":
                if let sub = r.sub, !validSub(sub) { return fail(.request) }
                let t = try await engine.token(profile: r.profile, sub: r.sub)
                return ["ok": true, "token": t.token, "expiresAt": (t.expires.timeIntervalSince1970 * 1000).rounded()]
            case "google.disconnect":
                let d = await engine.disconnect(profile: r.profile)
                return ["ok": true, "revoked": d.revoked, "had": d.had]
            default: return fail(.request)
            }
        } catch let f as Fail { return fail(f) } catch { return fail(.auth) }
    }
}
