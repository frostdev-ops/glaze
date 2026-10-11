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

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self

        self.webView.configuration.userContentController.add(self, name: "controller")

        self.webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { (state, error) in
            DispatchQueue.main.async {
                guard let state = state, error == nil else {
                    self.showExtensionError(error)
                    return
                }
                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show(\(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show(\(state.isEnabled), false)")
                }
            }
        }
    }

    private func showExtensionError(_ error: Error?) {
        let message = "Safari could not load Glaze. Install and open the signed, notarized Glaze app, then try again."
        NSLog("Glaze Safari extension error: %@", String(describing: error))
        guard let data = try? JSONSerialization.data(withJSONObject: [message]),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("showError(\(json)[0])")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.body as? String == "open-preferences" else { return }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            DispatchQueue.main.async {
                if let error = error {
                    self.showExtensionError(error)
                    return
                }
                NSApplication.shared.terminate(nil)
            }
        }
    }

}
