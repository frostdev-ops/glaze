//
//  ViewController.swift
//  Glaze
//
//  Created by James Kueller on 10/11/26.
//

import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "io.frostdev.Glaze.Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!
    private var stateTimer: Timer?
    private var checkedOnce = false
    private var failedChecks = 0

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    // The sandbox points NSHomeDirectory() at the app's container; the account's real home is in the user database.
    private var homeApplications: URL {
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home).appendingPathComponent("Applications")
    }

    // Opened from the disk image or Downloads, Glaze offers to install itself; from an Applications folder it shows the guide.
    private var isInstalled: Bool {
        let folder = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL.path
        return folder == "/Applications" || folder == homeApplications.standardizedFileURL.path
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if #available(macOS 13, *) {
            webView.evaluateJavaScript("useSettingsName()")
        }
        guard isInstalled else {
            webView.evaluateJavaScript("showInstall()")
            return
        }
        webView.evaluateJavaScript("showGuide()")
        refreshState()
        // Tick the guide off as soon as Safari turns Glaze on.
        stateTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshState() }
    }

    private func refreshState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            DispatchQueue.main.async {
                // Opening Glaze while it's off means setting it up, so go straight to Safari's settings.
                // That also launches Safari, which can't report a just-installed Glaze until it has run.
                if !self.checkedOnce && state?.isEnabled != true {
                    self.openSafariSettings()
                }
                self.checkedOnce = true
                guard let state = state, error == nil else {
                    self.failedChecks += 1
                    if self.failedChecks == 15 {
                        self.showExtensionError(error)
                    }
                    return
                }
                if self.failedChecks >= 15 {
                    self.showError("")
                }
                self.failedChecks = 0
                // Stay above Safari's settings window until Glaze is on, so the guide stays in view.
                self.view.window?.level = state.isEnabled ? .normal : .floating
                self.webView.evaluateJavaScript("show(\(state.isEnabled))")
            }
        }
    }

    private func install() {
        let source = Bundle.main.bundleURL
        var failure: Error?
        // /Applications needs an administrator; a standard account installs into its own Applications folder.
        for folder in [URL(fileURLWithPath: "/Applications"), homeApplications] {
            let target = folder.appendingPathComponent("Glaze.app")
            do {
                if FileManager.default.fileExists(atPath: target.path) {
                    // Replace an older Glaze, never another app that happens to share the name.
                    guard Bundle(url: target)?.bundleIdentifier == Bundle.main.bundleIdentifier else {
                        throw CocoaError(.fileWriteFileExists)
                    }
                    try FileManager.default.removeItem(at: target)
                }
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: source, to: target)
                // The copy inherits the download's quarantine without the approval given to this one, and
                // macOS won't open a quarantined app from Applications that Finder didn't move there.
                removexattr(target.path, "com.apple.quarantine", 0)
                launch(target)
                return
            } catch {
                NSLog("Glaze could not install into %@: %@", folder.path, String(describing: error))
                failure = error
            }
        }
        NSLog("Glaze install failed: %@", String(describing: failure))
        showError("Glaze couldn’t copy itself into Applications. Drag Glaze into your Applications folder, then open it from there.")
    }

    private func launch(_ app: URL) {
        let configuration = NSWorkspace.OpenConfiguration()
        // The copy works out what to show from where it runs.
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
            DispatchQueue.main.async {
                if let error = error {
                    NSLog("Glaze could not open %@: %@", app.path, String(describing: error))
                    self.showError("Glaze is in Applications. Open it from there to finish setting up.")
                    return
                }
                NSApplication.shared.terminate(nil)
            }
        }
    }

    private func openSafariSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                // Safari that hasn't found Glaze yet can't show its settings; opening Safari lets it look,
                // and the state check reports a real failure.
                if let error = error {
                    NSLog("Glaze could not open Safari settings: %@", String(describing: error))
                    if let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.apple.Safari") {
                        NSWorkspace.shared.openApplication(at: safari, configuration: NSWorkspace.OpenConfiguration())
                    }
                }
            }
        }
    }

    private func showExtensionError(_ error: Error?) {
        NSLog("Glaze Safari extension error: %@", String(describing: error))
        showError("Safari could not load Glaze. Install and open the signed, notarized Glaze app, then try again.")
    }

    private func showError(_ message: String) {
        guard let data = try? JSONSerialization.data(withJSONObject: [message]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("showError(\(json)[0])")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.body as? String {
        case "install": install()
        case "open-preferences": openSafariSettings()
        default: break
        }
    }

}
