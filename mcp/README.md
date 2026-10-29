# glaze-mcp

Lets AI apps on this computer, like Claude, use Glaze in your browser. Needs Node.js 18 or later.

## Install

```sh
npx glaze-mcp setup
```

This sets up Chrome, Edge, Brave, Vivaldi, Chromium and Firefox when their default data folders exist, on macOS,
Linux and Windows, plus Arc on macOS. Run it again after installing another browser. Then turn on agent access in Glaze's Settings → Agents.

For a copy of Glaze loaded unpacked, add `--dev <its folder>` (macOS and Linux) or `--extension-id <id>` with the id
`chrome://extensions` shows. A manifest with a `key` also needs `--extension-id`. Setup remembers only ids explicitly
given to it. If Glaze can't reach the helper, `npx glaze-mcp doctor` says why.

Setup refuses symlinked destinations and files or registrations belonging to another installation. On Windows,
Chromium browsers sharing a registry location use the first installed browser's host manifest.

## Uninstall

```sh
npx glaze-mcp uninstall
```

This removes the helper's manifests, launchers and unchanged versioned copies. It leaves the run folder and modified
copies alone. On Windows it removes only its registry default values, preserving other values and subkeys.

Manifest locations follow the [Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging) and
[Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests) documentation.
