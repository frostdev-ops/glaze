# glaze-mcp

Lets AI apps on this computer, like Claude, use [Glaze](https://github.com/frostdev-ops/glaze) in your browser over MCP:
your courses, to-dos, grades, assignments and Writer documents, each only once you allow it in Glaze. Needs Node.js 18
or later. Its version follows Glaze's. It opens no network connections: it passes lines between the app and the browser
through a socket (a named pipe on Windows) that only your user account can open.

## Set up

```sh
npx glaze-mcp setup
```

This sets up each supported browser whose data folder exists. Run it again after installing another browser. Then turn
on **Settings → AI → Agents** in Glaze, and add `npx -y glaze-mcp` to your app as a stdio server:

```sh
claude mcp add --scope user glaze -- npx -y glaze-mcp
```

It connects to the browser that started its helper last; `--browser <id>` chooses one (`chrome`, `edge`, `firefox`,
`safari`, …). Cursor, VS Code and the rest: [Agents](https://github.com/frostdev-ops/glaze/blob/main/docs/agents.md).

For a copy of Glaze loaded unpacked, add `--dev <its folder>` (macOS and Linux) or `--extension-id <id>` with the id
`chrome://extensions` shows. A manifest with a `key` also needs `--extension-id`. Setup remembers only ids explicitly
given to it.

Setup refuses symlinked destinations and files or registrations belonging to another installation. On Windows,
Chromium browsers sharing a registry location use the first installed browser's host manifest.

## Claude Desktop

`glaze-mcp-<version>.mcpb`, attached to each [Glaze release](https://github.com/frostdev-ops/glaze/releases/latest) (for
4.0.0, [glaze-mcp-4.0.0.mcpb](https://github.com/frostdev-ops/glaze/releases/download/v4.0.0/glaze-mcp-4.0.0.mcpb)), is
this package as a Claude Desktop extension: open it with Claude Desktop. It sets the browsers up each time Claude starts
it. Browsers start the helper with a Node.js 18 or later installed on this computer, not Claude's own.

## Doctor

```sh
npx glaze-mcp doctor
```

Checks the helper's folders, each browser's manifest, launcher and Node.js, and whether a browser has agent access on
now. It exits 1 when something fails.

## Uninstall

```sh
npx glaze-mcp uninstall
```

This removes the helper's manifests, launchers and unchanged versioned copies. It leaves the run folder and modified
copies alone. On Windows it removes only its registry default values, preserving other values and subkeys.

## Browsers

| | macOS | Linux | Windows |
|---|---|---|---|
| Chrome, Edge, Brave, Vivaldi, Chromium | Yes | Yes | Yes |
| Arc | Yes | — | — |
| Firefox | Yes | Yes | Yes |
| Safari | The downloaded Glaze Mac app | — | — |

On Safari the downloaded Glaze Mac app is the helper, with no setup; the Mac App Store app has no agent access.

Manifest locations follow the [Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging),
[Edge](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging) and
[Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests) documentation.
