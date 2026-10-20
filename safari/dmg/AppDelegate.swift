import Cocoa
import Sparkle

@main
final class AppDelegate: NSObject, NSApplicationDelegate, SPUUpdaterDelegate, NSMenuItemValidation {
    private var updater: SPUUpdater?
    private let driver = GlazeUpdateDriver()
    private var window: NSWindowController?
    private var launched = false
    private var pendingCheck = false
    private var userSession = false
    private var deadline: Timer?
    private var updaterObservations: [NSKeyValueObservation] = []
    private var updateStatus = ""

    func application(_ application: NSApplication, open urls: [URL]) {
        // URL parameters never select a feed, file, action or installation target.
        guard urls.contains(where: { $0.absoluteString == "io.frostdev.glaze-update://check" }) else { return }
        NSLog("Glaze update: private URL received, launched=%d", launched)
        pendingCheck = true
        if launched { checkFromExtension() }
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        NSLog("Glaze update: willFinish policy=%ld active=%d windows=%ld", NSApp.activationPolicy().rawValue,
              NSApp.isActive, NSApp.windows.count)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        launched = true
        if let appMenu = NSApp.mainMenu?.items.first?.submenu {
            let item = NSMenuItem(title: "Check for Updates…", action: #selector(checkForUpdatesByUser), keyEquivalent: "")
            item.target = self
            appMenu.insertItem(item, at: min(1, appMenu.items.count))
        }
        driver.unexpectedExtraction = { [weak self] in self?.finishHidden("unexpected interactive extraction") }
        if notification.userInfo?[NSApplication.launchIsDefaultUserInfoKey] as? Bool == true {
            showGuide()
        } else {
            NSApp.setActivationPolicy(.accessory)
            deadline = Timer.scheduledTimer(withTimeInterval: 180, repeats: false) { [weak self] _ in
                self?.finishHidden("timeout; prepared updates may install on quit")
            }
        }
        NSLog("Glaze update: launch user=%d policy=%ld active=%d windows=%ld", userSession,
              NSApp.activationPolicy().rawValue, NSApp.isActive, NSApp.windows.count)
        if pendingCheck { checkFromExtension() }
        else if userSession { startUpdater(background: false) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showGuide()
        if updater == nil { startUpdater(background: false) }
        return true
    }

    private func showGuide() {
        userSession = true
        deadline?.invalidate()
        NSApp.setActivationPolicy(.regular)
        driver.enableStandardUI()
        if window == nil {
            window = NSStoryboard(name: "Main", bundle: nil)
                .instantiateController(withIdentifier: "GlazeWindow") as? NSWindowController
        }
        window?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func checkFromExtension() {
        pendingCheck = false
        guard updater?.sessionInProgress != true else { return }
        let defaults = UserDefaults.standard
        let last = defaults.double(forKey: "GlazeLastNativeUpdateCheck")
        guard Date().timeIntervalSince1970 - last >= 3600 else {
            finishHidden("rate limited")
            return
        }
        defaults.set(Date().timeIntervalSince1970, forKey: "GlazeLastNativeUpdateCheck")
        startUpdater(background: true)
    }

    private func startUpdater(background: Bool, manual: Bool = false) {
        guard let key = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
              let decoded = Data(base64Encoded: key), decoded.count == 32 else {
            updateStatus = "Updates are unavailable in this build. Get a signed release from frostdev.io."
            publishUpdateSettings()
            finishHidden("public update key is not configured")
            return
        }
        do {
            if updater == nil {
                let instance = SPUUpdater(hostBundle: .main, applicationBundle: .main,
                                          userDriver: driver, delegate: self)
                updater = instance
                instance.sendsSystemProfile = false
                try instance.start()
                updaterObservations = [
                    instance.observe(\.automaticallyChecksForUpdates, options: [.new]) { [weak self] _, _ in self?.publishUpdateSettings() },
                    instance.observe(\.automaticallyDownloadsUpdates, options: [.new]) { [weak self] _, _ in self?.publishUpdateSettings() },
                    instance.observe(\.canCheckForUpdates, options: [.new]) { [weak self] _, _ in self?.publishUpdateSettings() }
                ]
            }
            guard let updater else { return }
            if manual {
                guard updater.canCheckForUpdates else {
                    updateStatus = "An update check or download is already in progress."
                    publishUpdateSettings()
                    return
                }
                driver.backgroundCheck = false
                updater.checkForUpdates()
            } else {
                // A native check-only message must respect the user's automatic-check preference too.
                guard updater.automaticallyChecksForUpdates else {
                    publishUpdateSettings()
                    finishHidden("automatic checks are disabled")
                    return
                }
                driver.backgroundCheck = background
                updater.checkForUpdatesInBackground()
            }
            updateStatus = "Checking for updates…"
            publishUpdateSettings()
            NSLog("Glaze update: check started, manual=%d hidden=%d", manual, !userSession)
        } catch {
            updater = nil
            updaterObservations = []
            updateStatus = "Updates could not start. Try again, or open Setup help."
            publishUpdateSettings()
            NSLog("Glaze update: startup failed: %@", String(describing: error))
            finishHidden("startup error")
        }
    }

    func updateSettings() -> [String: Any] {
        ["automaticChecks": updater?.automaticallyChecksForUpdates == true,
         "automaticDownloads": updater?.automaticallyDownloadsUpdates == true,
         "canCheck": updater?.canCheckForUpdates == true,
         "updateStatus": updateStatus]
    }

    private func publishUpdateSettings() {
        NotificationCenter.default.post(name: Notification.Name("GlazeUpdateStateChanged"), object: nil)
    }

    func setUpdatePreference(_ preference: String, enabled: Bool) {
        guard let updater else { return }
        if preference == "automatic-checks" { updater.automaticallyChecksForUpdates = enabled }
        if preference == "automatic-downloads", updater.automaticallyChecksForUpdates {
            updater.automaticallyDownloadsUpdates = enabled
        }
        publishUpdateSettings()
    }

    @objc func checkForUpdatesByUser() {
        showGuide()
        startUpdater(background: false, manual: true)
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        menuItem.action != #selector(checkForUpdatesByUser) || updater?.canCheckForUpdates == true
    }

    private func finishHidden(_ reason: String) {
        NSLog("Glaze update: %@, user=%d", reason, userSession)
        guard !userSession else { return }
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { userSession }

    func updater(_ updater: SPUUpdater, shouldProceedWithUpdate item: SUAppcastItem,
                 updateCheck: SPUUpdateCheck) throws {
        if driver.quiet && (item.isCriticalUpdate || item.isMajorUpgrade || item.isInformationOnlyUpdate || item.installationType != "application") {
            throw NSError(domain: "io.frostdev.Glaze.Update", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "This update requires a normal Glaze launch."])
        }
    }

    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock: @escaping () -> Void) -> Bool {
        // Never invoke the immediate block: it installs AND relaunches.
        finishHidden("prepared; installing on normal termination")
        return true
    }

    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        NSLog("Glaze update: cycle finished, error=%@", String(describing: error))
        finishHidden("cycle complete")
        driver.backgroundCheck = false
        let detail = error as NSError?
        let noUpdate = detail?.domain == SUSparkleErrorDomain && detail?.code == Int(SUError.noUpdateError.rawValue)
        let checked = DateFormatter.localizedString(from: Date(), dateStyle: .short, timeStyle: .short)
        updateStatus = noUpdate ? "You’re up to date. Last checked \(checked)."
            : error == nil ? "Last checked \(checked)."
            : "The update check did not complete. Check your connection and try again."
        publishUpdateSettings()
    }

    func allowedSystemProfileKeys(for updater: SPUUpdater) -> [String]? { [] }
}

// This no-UI driver deviates from Sparkle's custom-UI guide and depends on 2.10.0 source.
// Reverify every Sparkle bump: Dismiss at Downloaded prevents interactive extraction/authorization;
// Dismiss at Installing preserves install-on-quit. A prior user-interactive helper may still show progress.
private final class GlazeUpdateDriver: NSObject, SPUUserDriver {
    private var standard: SPUStandardUserDriver?
    var backgroundCheck = false
    var unexpectedExtraction: (() -> Void)?
    var quiet: Bool { standard == nil || backgroundCheck }
    private var ui: SPUStandardUserDriver? { quiet ? nil : standard }
    func enableStandardUI() {
        if standard == nil { standard = SPUStandardUserDriver(hostBundle: .main, delegate: nil) }
    }
    func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
        if let ui = ui { ui.show(request, reply: reply) }
        else { reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false)) }
    }
    func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
        if let ui = ui { ui.showUserInitiatedUpdateCheck(cancellation: cancellation) } else { cancellation() }
    }
    func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {
        if let ui = ui { ui.showUpdateFound(with: appcastItem, state: state, reply: reply) }
        else {
            NSLog("Glaze update: dismissing interactive update stage=%ld", state.stage.rawValue)
            reply(.dismiss)
        }
    }
    func showUpdateReleaseNotes(with downloadData: SPUDownloadData) { ui?.showUpdateReleaseNotes(with: downloadData) }
    func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) { ui?.showUpdateReleaseNotesFailedToDownloadWithError(error) }
    func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
        if let ui = ui { ui.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement) } else { acknowledgement() }
    }
    func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
        if let ui = ui { ui.showUpdaterError(error, acknowledgement: acknowledgement) } else { acknowledgement() }
    }
    func showDownloadInitiated(cancellation: @escaping () -> Void) {
        if let ui = ui { ui.showDownloadInitiated(cancellation: cancellation) } else { cancellation() }
    }
    func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) { ui?.showDownloadDidReceiveExpectedContentLength(expectedContentLength) }
    func showDownloadDidReceiveData(ofLength length: UInt64) { ui?.showDownloadDidReceiveData(ofLength: length) }
    func showDownloadDidStartExtractingUpdate() {
        if let ui = ui { ui.showDownloadDidStartExtractingUpdate() }
        else {
            // Unreachable without an Install reply; terminate rather than enter interactive extraction.
            NSLog("Glaze update: unexpected interactive extraction; terminating")
            unexpectedExtraction?()
        }
    }
    func showExtractionReceivedProgress(_ progress: Double) { ui?.showExtractionReceivedProgress(progress) }
    func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
        if let ui = ui { ui.showReady(toInstallAndRelaunch: reply) } else { reply(.dismiss) }
    }
    func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {
        ui?.showInstallingUpdate(withApplicationTerminated: applicationTerminated, retryTerminatingApplication: retryTerminatingApplication)
    }
    func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
        if let ui = ui { ui.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: acknowledgement) } else { acknowledgement() }
    }
    func dismissUpdateInstallation() { ui?.dismissUpdateInstallation() }
    func showUpdateInFocus() { ui?.showUpdateInFocus() }
}
