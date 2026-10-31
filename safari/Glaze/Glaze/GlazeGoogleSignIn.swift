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
    private struct Active {
        let id: UUID, state: String, slot: GlazeGoogle.GroupSlot
        let done: @MainActor () -> Void
    }
    private var active: Active?

    /// Whether url is the sign-in URL's scheme. done runs once this sign-in ends (at once if none started).
    @discardableResult
    func open(_ url: URL, done: @escaping @MainActor () -> Void = {}) -> Bool {
        guard url.scheme?.lowercased() == GlazeGoogle.appScheme else { return false }
        guard let s = GlazeGoogle.signIn(from: url), let slot = GlazeGoogle.GroupSlot.shared() else { done(); return true }
        if let old = active { complete(old.id, ["error": "cancel"], cancel: true) }
        let id = UUID()
        let session = ASWebAuthenticationSession(url: GlazeGoogle.authURL(s), callbackURLScheme: GlazeGoogle.callbackScheme) { [weak self] url, error in
            Task { @MainActor in
                let canceled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                self?.complete(id, url.map { ["url": $0.absoluteString] } ?? ["error": canceled ? "cancel" : "auth"])
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        self.session = session
        active = Active(id: id, state: s.state, slot: slot, done: done)
        if !session.start() {
            complete(id, ["error": "auth"])
        }
        return true
    }

    /// Programmatic cancel need not call AuthenticationServices' completion. Retire ownership before cancel/done so
    /// delayed callbacks cannot answer twice, overwrite a newer reply, or decrement the DMG app's sign-in count twice.
    private func complete(_ id: UUID, _ reply: [String: String], cancel: Bool = false) {
        guard let old = active, old.id == id else { return }
        let session = self.session
        active = nil
        self.session = nil
        answer(old.slot, old.state, reply)
        if cancel { session?.cancel() }
        old.done()
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
