//
//  GlazeApp.swift
//  Glaze for iPhone and iPad: the Mac app's setup guide (Main.html), without its installer.
//

import SafariServices
import SwiftUI
import WebKit

let extensionBundleIdentifier = "io.frostdev.Glaze.Extension"

@main
struct GlazeApp: App {
    var body: some Scene {
        WindowGroup { Guide().ignoresSafeArea() }
    }
}

struct Guide: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView { context.coordinator.webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let webView = WKWebView()
        private var timer: Timer?

        override init() {
            super.init()
            // Clear until the page paints, so dark mode doesn't open on a white flash.
            webView.isOpaque = false
            webView.navigationDelegate = self
            webView.configuration.userContentController.add(self, name: "controller")
            webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!,
                                allowingReadAccessTo: Bundle.main.resourceURL!)
        }

        // iOS 26.2 can open Glaze's page in Settings and say whether Glaze is on; before that the guide is the steps alone.
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard #available(iOS 26.2, *) else { return }
            webView.evaluateJavaScript("document.body.classList.add('live')")
            refreshState()
            // Tick step 1 off when the user comes back from Settings.
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                DispatchQueue.main.async { self?.refreshState() }
            }
        }

        @available(iOS 26.2, *)
        private func refreshState() {
            SFSafariExtensionManager.getStateOfExtension(withIdentifier: extensionBundleIdentifier) { state, _ in
                DispatchQueue.main.async { self.webView.evaluateJavaScript("show(\(state?.isEnabled == true))") }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.body as? String == "open-preferences", #available(iOS 26.2, *) else { return }
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) { error in
                if let error { NSLog("Glaze could not open Settings: %@", String(describing: error)) }
            }
        }
    }
}
