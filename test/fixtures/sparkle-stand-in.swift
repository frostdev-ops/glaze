// Sparkle 2.10's API as safari/dmg/AppDelegate.swift calls it, and no more: enough to typecheck the DMG app's sources
// without Xcode's package. Its protocols are empty, so this checks the app's own code, not its conformance to Sparkle.
import Foundation

@objc public protocol SPUUpdaterDelegate: NSObjectProtocol {}
@objc public protocol SPUUserDriver: NSObjectProtocol {}
public let SUSparkleErrorDomain = "SUSparkleErrorDomain"
public enum SUError: Int32 { case noUpdateError = 1001 }
public enum SPUUpdateCheck: Int { case updates, updatesInBackground, updateInformation }
public enum SPUUserUpdateChoice: Int { case skip, install, dismiss }
public enum SPUUserUpdateStage: Int { case notDownloaded, downloaded, installing }
public final class SPUUserUpdateState: NSObject { public var stage: SPUUserUpdateStage { .notDownloaded } }
public final class SPUUpdatePermissionRequest: NSObject {}
public final class SUUpdatePermissionResponse: NSObject { public init(automaticUpdateChecks: Bool, sendSystemProfile: Bool) {} }
public final class SPUDownloadData: NSObject {}
public final class SUAppcastItem: NSObject {
    public var isCriticalUpdate: Bool { false }
    public var isMajorUpgrade: Bool { false }
    public var isInformationOnlyUpdate: Bool { false }
    public var installationType: String { "application" }
}
public final class SPUUpdater: NSObject {
    public init(hostBundle: Bundle, applicationBundle: Bundle, userDriver: SPUUserDriver, delegate: SPUUpdaterDelegate?) {}
    public var sendsSystemProfile = false
    public var sessionInProgress: Bool { false }
    @objc public dynamic var automaticallyChecksForUpdates = false
    @objc public dynamic var automaticallyDownloadsUpdates = false
    @objc public dynamic var canCheckForUpdates: Bool { false }
    public func start() throws {}
    public func checkForUpdates() {}
    public func checkForUpdatesInBackground() {}
}
public final class SPUStandardUserDriver: NSObject, SPUUserDriver {
    public init(hostBundle: Bundle, delegate: AnyObject?) {}
    public func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {}
    public func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {}
    public func showUpdateFound(with appcastItem: SUAppcastItem, state: SPUUserUpdateState, reply: @escaping (SPUUserUpdateChoice) -> Void) {}
    public func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}
    public func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}
    public func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {}
    public func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {}
    public func showDownloadInitiated(cancellation: @escaping () -> Void) {}
    public func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {}
    public func showDownloadDidReceiveData(ofLength length: UInt64) {}
    public func showDownloadDidStartExtractingUpdate() {}
    public func showExtractionReceivedProgress(_ progress: Double) {}
    public func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {}
    public func showInstallingUpdate(withApplicationTerminated applicationTerminated: Bool, retryTerminatingApplication: @escaping () -> Void) {}
    public func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {}
    public func dismissUpdateInstallation() {}
    public func showUpdateInFocus() {}
}
