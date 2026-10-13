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
        if #available(macOS 13, *) {
            webView.evaluateJavaScript("useSettingsName()")
        }
        guard isInstalled else {
            showInstall()
            return
        }
        // The installer launches an update with -updated-from <old version>; NSUserDefaults reads launch arguments.
        let updatedFrom = UserDefaults.standard.string(forKey: "updated-from")
        call("showGuide", updatedFrom.map { ["from": $0, "to": version] } ?? NSNull())
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
        showError("Safari could not load Glaze. Install and open the signed, notarized Glaze app, then try again.")
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
        switch message.body as? String {
        case "install": install()
        case "open-installed": installedCopy.map { launch($0) }
        case "open-preferences": openSafariSettings()
        default: break
        }
    }

}
