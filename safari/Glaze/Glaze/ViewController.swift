//
//  ViewController.swift
//  Glaze
//
//  Created by James Kueller on 10/11/26.
//

import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = (Bundle.main.bundleIdentifier ?? "io.frostdev.Glaze") + ".Extension"

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!
    private var stateTimer: Timer?
    private var failedChecks = 0
    private var pageReady = false
    private var stateCheckInFlight = false
    private var stateGeneration = 0
    private var displayedState: String?
    private let guideURL = Bundle.main.url(forResource: "Main", withExtension: "html")!

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        // WKUserContentController retains its handlers; the proxy must not retain this controller.
        self.webView.configuration.userContentController.add(GuideMessageProxy(self), name: "controller")
        NotificationCenter.default.addObserver(self, selector: #selector(resumeStateChecks),
                                               name: NSApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(stopStateChecks),
                                               name: NSApplication.didResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(configureApp),
                                               name: Notification.Name("GlazeUpdateStateChanged"), object: nil)

        self.webView.loadFileURL(guideURL, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.contentMinSize = NSSize(width: 480, height: 440)
        resumeStateChecks()
    }
    override func viewWillDisappear() { stopStateChecks(); super.viewWillDisappear() }
    deinit { stateTimer?.invalidate(); NotificationCenter.default.removeObserver(self) }

    // The sandbox points NSHomeDirectory() at the app's container; the account's real home is in the user database.
    private var homeApplications: URL {
        let home = getpwuid(getuid()).map { String(cString: $0.pointee.pw_dir) } ?? NSHomeDirectory()
        return URL(fileURLWithPath: home).appendingPathComponent("Applications")
    }

    // Opened from the disk image or Downloads, Glaze offers to install itself; from an Applications folder it shows the guide.
    private var isInstalled: Bool {
        #if GLAZE_DMG && !DEBUG
        let folder = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL.path
        return folder == "/Applications" || folder == homeApplications.standardizedFileURL.path
        #else
        // Store builds use the App Store. Development previews must never replace an installed release.
        return true
        #endif
    }

    private var version: String { Self.version(of: Bundle.main) }

    private static func version(of bundle: Bundle?) -> String {
        bundle?.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
    }

    // A Glaze already in an Applications folder. Installing updates it where it is, so there's never a second copy.
    private var installedCopy: URL? {
        [URL(fileURLWithPath: "/Applications"), homeApplications]
            .map { $0.appendingPathComponent("Glaze.app") }
            .first { Bundle(url: $0)?.bundleIdentifier == Bundle.main.bundleIdentifier }
    }

    private func isFromAppStore(_ app: URL) -> Bool {
        FileManager.default.fileExists(atPath: app.appendingPathComponent("Contents/_MASReceipt").path)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView.url?.standardizedFileURL == guideURL.standardizedFileURL else { return }
        stopStateChecks()
        displayedState = nil
        pageReady = true
        if #available(macOS 13, *) {
            webView.evaluateJavaScript("useSettingsName()")
        }
        configureApp()
        guard isInstalled else {
            showInstall()
            return
        }
        // The installer launches an update with -updated-from <old version>; NSUserDefaults reads launch arguments.
        let updatedFrom = UserDefaults.standard.string(forKey: "updated-from")
        call("showGuide", updatedFrom.map { ["from": $0, "to": version] } ?? NSNull())
        resumeStateChecks()
    }

    @objc private func resumeStateChecks() {
        guard pageReady, isInstalled, NSApp.isActive, view.window?.isVisible == true else { return }
        stateTimer?.invalidate()
        configureApp()
        refreshState()
        stateTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.refreshState() }
        stateTimer?.tolerance = 1
    }

    @objc private func stopStateChecks() {
        stateTimer?.invalidate()
        stateTimer = nil
        stateGeneration += 1
        stateCheckInFlight = false
    }

    private func refreshState() {
        guard pageReady, !stateCheckInFlight, NSApp.isActive, view.window?.isVisible == true else { return }
        stateCheckInFlight = true
        let generation = stateGeneration
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] (state, error) in
            DispatchQueue.main.async {
                guard let self, generation == self.stateGeneration else { return }
                self.stateCheckInFlight = false
                guard let state = state, error == nil else {
                    self.failedChecks += 1
                    self.showState(nil)
                    if self.failedChecks == 3 {
                        self.showExtensionError(error)
                    }
                    return
                }
                if self.failedChecks >= 3 {
                    self.showError("")
                }
                self.failedChecks = 0
                self.showState(state.isEnabled)
            }
        }
    }

    private func showState(_ enabled: Bool?) {
        let value = enabled.map { $0 ? "true" : "false" } ?? "null"
        guard displayedState != value else { return }
        displayedState = value
        webView.evaluateJavaScript("show(\(value))")
    }

    @objc private func configureApp() {
        guard pageReady else { return }
        var info: [String: Any] = ["version": version, "channel": "app-store"]
        #if GLAZE_DMG
        info["channel"] = "dmg"
        if let delegate = NSApp.delegate as? AppDelegate {
            info.merge(delegate.updateSettings()) { _, new in new }
        }
        #endif
        call("configureApp", info)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        decisionHandler(action.request.url?.standardizedFileURL == guideURL.standardizedFileURL ? .allow : .cancel)
    }

    // Tell the page what's already installed: nothing, an older or newer Glaze, or the App Store's.
    private func showInstall() {
        guard let copy = installedCopy else { return call("showInstall", NSNull()) }
        let installed = Self.version(of: Bundle(url: copy))
        let relation = ["older", "same", "newer"][installed.compare(version, options: .numeric).rawValue + 1]
        call("showInstall", ["version": installed, "relation": relation, "appStore": isFromAppStore(copy)])
    }

    private func install() {
        let source = Bundle.main.bundleURL
        let existing = installedCopy
        let updatedFrom = existing.map { Self.version(of: Bundle(url: $0)) }
        // Quit the Glaze being replaced, so it isn't left running from a deleted copy.
        for app in NSRunningApplication.runningApplications(withBundleIdentifier: Bundle.main.bundleIdentifier!)
        where app.processIdentifier != getpid() {
            app.terminate()
        }
        var failure: Error?
        // /Applications needs an administrator; a standard account installs into its own Applications folder.
        let folders = existing.map { [$0.deletingLastPathComponent()] } ?? [URL(fileURLWithPath: "/Applications"), homeApplications]
        for folder in folders {
            let target = folder.appendingPathComponent("Glaze.app")
            do {
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                // Copy beside the target first and swap it in, so a failed copy leaves the old Glaze working.
                let staged = try FileManager.default.url(for: .itemReplacementDirectory, in: .userDomainMask,
                                                         appropriateFor: folder, create: true)
                    .appendingPathComponent("Glaze.app")
                try FileManager.default.copyItem(at: source, to: staged)
                // The copy inherits the download's quarantine without the approval given to this one, and
                // macOS won't open a quarantined app from Applications that Finder didn't move there.
                removexattr(staged.path, "com.apple.quarantine", 0)
                if FileManager.default.fileExists(atPath: target.path) {
                    // Replace an older Glaze, never another app that happens to share the name.
                    guard Bundle(url: target)?.bundleIdentifier == Bundle.main.bundleIdentifier else {
                        throw CocoaError(.fileWriteFileExists)
                    }
                    _ = try FileManager.default.replaceItemAt(target, withItemAt: staged)
                } else {
                    try FileManager.default.moveItem(at: staged, to: target)
                }
                launch(target, updatedFrom: updatedFrom)
                return
            } catch {
                NSLog("Glaze could not install into %@: %@", folder.path, String(describing: error))
                failure = error
            }
        }
        NSLog("Glaze install failed: %@", String(describing: failure))
        showError("Glaze couldn’t copy itself into Applications. Drag Glaze into your Applications folder, replacing any older Glaze, then open it from there.")
    }

    private func launch(_ app: URL, updatedFrom: String? = nil) {
        let configuration = NSWorkspace.OpenConfiguration()
        // The copy works out what to show from where it runs.
        configuration.createsNewApplicationInstance = true
        if let updatedFrom = updatedFrom {
            configuration.arguments = ["-updated-from", updatedFrom]
        }
        NSWorkspace.shared.openApplication(at: app, configuration: configuration) { _, error in
            DispatchQueue.main.async {
                if let error = error {
                    NSLog("Glaze could not open %@: %@", app.path, String(describing: error))
                    self.showError("Glaze is in Applications. Open it from there to finish setting up.")
                    return
                }
                self.leaveDiskImage()
                NSApplication.shared.terminate(nil)
            }
        }
    }

    // Run from the disk image, this copy's extension shows up in Safari's settings as a second Glaze, and
    // ticking that one leaves Glaze off once the image is ejected. Forget it and eject the image.
    private func leaveDiskImage() {
        let bundle = Bundle.main.bundleURL
        let volume = bundle.deletingLastPathComponent()
        guard let values = try? volume.resourceValues(forKeys: [.volumeURLKey, .volumeIsReadOnlyKey]),
              values.volumeIsReadOnly == true,
              values.volume?.standardizedFileURL == volume.standardizedFileURL else { return }
        let lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
        let shell = Process()
        shell.executableURL = URL(fileURLWithPath: "/bin/sh")
        // Outlives Glaze: the image can't eject while Glaze runs from it. Best effort; it stays if Safari holds it.
        shell.arguments = ["-c", "\"$0\" -u \"$1\"; sleep 1; /usr/sbin/diskutil eject \"$2\" >/dev/null",
                           lsregister, bundle.path, volume.path]
        try? shell.run()
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
        showError("Safari could not report Glaze’s status. Open Safari’s extension settings, check that Glaze is listed, then return here. If it is missing, reinstall Glaze from the same source.")
    }

    private func showError(_ message: String) {
        call("showError", message)
    }

    // Calls a page function with one JSON argument.
    private func call(_ function: String, _ argument: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: [argument]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("\(function)(\(json)[0])")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.request.url?.standardizedFileURL == guideURL.standardizedFileURL else { return }
        #if GLAZE_DMG
        if let preference = message.body as? [String: Any], preference.count == 2,
           let action = preference["action"] as? String, let enabled = preference["enabled"] as? Bool,
           action == "automatic-checks" || action == "automatic-downloads" {
            (NSApp.delegate as? AppDelegate)?.setUpdatePreference(action, enabled: enabled)
            return
        }
        #endif
        switch message.body as? String {
        #if GLAZE_DMG && !DEBUG
        case "install": install()
        case "open-installed": installedCopy.map { launch($0) }
        #endif
        case "open-preferences": openSafariSettings()
        case "open-app-store": NSWorkspace.shared.open(URL(string: "https://apps.apple.com/app/id6821739877")!)
        case "open-help": NSWorkspace.shared.open(URL(string: "https://frostdev.io/glaze")!)
        case "open-privacy": NSWorkspace.shared.open(URL(string: "https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md")!)
        case "copy-setup":
            #if GLAZE_DMG
            let channel = "Downloaded Mac app"
            #else
            let channel = "Mac App Store"
            #endif
            let state = displayedState == "true" ? "Enabled" : displayedState == "false" ? "Disabled" : "Unknown"
            let details = "Glaze \(version)\nSource: \(channel)\nSystem: \(ProcessInfo.processInfo.operatingSystemVersionString)\nSafari extension: \(state)\nWebsite access: check separately in Safari."
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(details, forType: .string)
            webView.evaluateJavaScript("setupCopied()")
        #if GLAZE_DMG
        case "check-updates": (NSApp.delegate as? AppDelegate)?.checkForUpdatesByUser()
        #endif
        default: break
        }
    }

}

private final class GuideMessageProxy: NSObject, WKScriptMessageHandler {
    weak var handler: WKScriptMessageHandler?
    init(_ handler: WKScriptMessageHandler) { self.handler = handler }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        handler?.userContentController(controller, didReceive: message)
    }
}
