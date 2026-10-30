//
//  GlazeGoogleSignIn.swift
//  Glaze (macOS and iOS apps)
//
//  The sign-in page for Drive (GlazeGoogle.swift): the extension opens io.frostdev.glaze-google://signin with a state and
//  a PKCE challenge; this app builds Google's URL from them, runs ASWebAuthenticationSession on it (it needs this app's
//  window), and leaves the URL Google redirected to, or { error: 'cancel' | 'auth' }, in the app group's container under
//  that state. The code in it is useless without the verifier, which only the extension holds.
//

import AuthenticationServices
import Foundation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor
final class GlazeGoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = GlazeGoogleSignIn()
    private var session: ASWebAuthenticationSession?
    private var state: String?

    /// Whether url is the sign-in URL's scheme. done runs once this sign-in ends (at once if none started).
    @discardableResult
    func open(_ url: URL, done: @escaping @MainActor () -> Void = {}) -> Bool {
        guard url.scheme?.lowercased() == GlazeGoogle.appScheme else { return false }
        guard let s = GlazeGoogle.signIn(from: url), let slot = GlazeGoogle.GroupSlot.shared() else { done(); return true }
        if let old = state { session?.cancel(); answer(slot, old, ["error": "cancel"]) }
        let session = ASWebAuthenticationSession(url: GlazeGoogle.authURL(s), callbackURLScheme: GlazeGoogle.callbackScheme) { [weak self] url, error in
            Task { @MainActor in
                let canceled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                self?.answer(slot, s.state, url.map { ["url": $0.absoluteString] } ?? ["error": canceled ? "cancel" : "auth"])
                if self?.state == s.state { self?.session = nil; self?.state = nil }
                done()
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        state = s.state
        if !session.start() {
            answer(slot, s.state, ["error": "auth"])
            self.session = nil
            state = nil
            done()
        }
        return true
    }

    private func answer(_ slot: GlazeGoogle.GroupSlot, _ state: String, _ reply: [String: String]) {
        if let data = try? JSONSerialization.data(withJSONObject: reply) { _ = slot.put(state, data) }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if os(macOS)
        return NSApp.keyWindow ?? NSApp.mainWindow ?? NSApp.windows.first ?? ASPresentationAnchor()
        #else
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        if let window = scene?.keyWindow ?? scene?.windows.first { return window }
        return scene.map { UIWindow(windowScene: $0) } ?? ASPresentationAnchor()
        #endif
    }
}
