// Glaze for iPhone and iPad. Safari owns the extension; this app guides setup.
import SafariServices
import SwiftUI
import WebKit

let extensionBundleIdentifier = (Bundle.main.bundleIdentifier ?? "io.frostdev.Glaze") + ".Extension"

@main
struct GlazeApp: App {
    var body: some Scene {
        WindowGroup { Guide().ignoresSafeArea() }
    }
}

struct Guide: UIViewRepresentable {
    @Environment(\.scenePhase) private var scenePhase
    private var isActive: Bool { scenePhase == .active }
    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> WKWebView {
        context.coordinator.setActive(isActive)
        return context.coordinator.webView
    }
    func updateUIView(_ webView: WKWebView, context: Context) { context.coordinator.setActive(isActive) }
    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) { coordinator.stop() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        let webView = WKWebView()
        private let guideURL = Bundle.main.url(forResource: "Main", withExtension: "html")!
        private var timer: Timer?
        private var isActive = false
        private var pageReady = false
        private var checkInFlight = false
        private var generation = 0
        private var displayedState: String?

        override init() {
            super.init()
            webView.isOpaque = false
            webView.navigationDelegate = self
            // The web view retains its script handlers, so retaining self here would leak the entire guide.
            webView.configuration.userContentController.add(MessageProxy(self), name: "controller")
            webView.loadFileURL(guideURL, allowingReadAccessTo: Bundle.main.resourceURL!)
        }

        deinit { timer?.invalidate() }

        func setActive(_ active: Bool) {
            guard active != isActive else { return }
            isActive = active
            pauseChecks()
            if active { startChecks() }
        }

        private func pauseChecks() {
            timer?.invalidate()
            timer = nil
            generation += 1
            checkInFlight = false
        }

        func stop() {
            isActive = false
            pauseChecks()
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "controller")
            webView.stopLoading()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard webView.url?.standardizedFileURL == guideURL.standardizedFileURL else { return }
            pageReady = true
            displayedState = nil
            call("configureApp", ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "", "channel": "app-store"])
            if #available(iOS 26.2, *) { webView.evaluateJavaScript("document.body.classList.add('live')") }
            pauseChecks()
            startChecks()
        }

        private func startChecks() {
            guard isActive, pageReady, #available(iOS 26.2, *) else { return }
            refreshState()
            timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
                self?.refreshState()
            }
            timer?.tolerance = 1
        }

        @available(iOS 26.2, *)
        private func refreshState() {
            guard isActive, pageReady, !checkInFlight else { return }
            checkInFlight = true
            let token = generation
            SFSafariExtensionManager.getStateOfExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
                DispatchQueue.main.async {
                    guard let self, token == self.generation, self.isActive else { return }
                    self.checkInFlight = false
                    let value = error == nil ? state.map { $0.isEnabled ? "true" : "false" } ?? "null" : "null"
                    guard self.displayedState != value else { return }
                    self.displayedState = value
                    self.webView.evaluateJavaScript("show(\(value))")
                }
            }
        }

        private func call(_ function: String, _ argument: Any) {
            guard let data = try? JSONSerialization.data(withJSONObject: [argument]),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView.evaluateJavaScript("\(function)(\(json)[0])")
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            decisionHandler(action.request.url?.standardizedFileURL == guideURL.standardizedFileURL ? .allow : .cancel)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard isActive, message.frameInfo.isMainFrame,
                  message.frameInfo.request.url?.standardizedFileURL == guideURL.standardizedFileURL else { return }
            switch message.body as? String {
            case "open-preferences":
                guard #available(iOS 26.2, *) else { return }
                call("showError", "")
                SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) { [weak self] error in
                    guard error != nil else { return }
                    DispatchQueue.main.async {
                        self?.call("showError", "Settings could not be opened. Open Settings → Apps → Safari → Extensions, then choose Glaze.")
                    }
                }
            case "open-app-store": UIApplication.shared.open(URL(string: "https://apps.apple.com/app/id6821739877")!)
            case "open-help": UIApplication.shared.open(URL(string: "https://frostdev.io/glaze")!)
            case "open-privacy": UIApplication.shared.open(URL(string: "https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md")!)
            case "copy-setup":
                let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
                let state = displayedState == "true" ? "Enabled" : displayedState == "false" ? "Disabled" : "Unknown"
                UIPasteboard.general.string = "Glaze \(version)\nSource: App Store\nSystem: \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)\nSafari extension: \(state)\nWebsite access: check separately in Safari."
                webView.evaluateJavaScript("setupCopied()")
            default: break
            }
        }
    }
}

private final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var handler: WKScriptMessageHandler?
    init(_ handler: WKScriptMessageHandler) { self.handler = handler }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        handler?.userContentController(controller, didReceive: message)
    }
}
