//
//  SafariWebExtensionHandler.swift
//  Glaze Extension
//
//  Created by James Kueller on 10/11/26.
//

import SafariServices
import os.log
#if os(macOS) && GLAZE_DMG
import AppKit
#endif

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let profile: UUID?
        if #available(iOS 17.0, macOS 14.0, *) {
            profile = request?.userInfo?[SFExtensionProfileKey] as? UUID
        } else {
            profile = request?.userInfo?["profile"] as? UUID
        }

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        #if os(macOS) && GLAZE_DMG
        if let command = message as? [String: String], command == ["type": "check-updates"] {
            // Address this extension's containing app explicitly; never route a caller-supplied URL.
            let app = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            NSWorkspace.shared.open([URL(string: "io.frostdev.glaze-update://check")!],
                                    withApplicationAt: app, configuration: configuration) { _, error in
                let response = NSExtensionItem()
                response.userInfo = [SFExtensionMessageKey: ["accepted": error == nil]]
                context.completeRequest(returningItems: [response], completionHandler: nil)
            }
            return
        }
        #endif

        os_log(.default, "Received message from browser.runtime.sendNativeMessage: %@ (profile: %@)", String(describing: message), profile?.uuidString ?? "none")

        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [ SFExtensionMessageKey: [ "echo": message ] ]
        } else {
            response.userInfo = [ "message": [ "echo": message ] ]
        }

        context.completeRequest(returningItems: [ response ], completionHandler: nil)
    }

}
