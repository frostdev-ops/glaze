# glaze-mcp

Lets AI apps on this computer use [Glaze](https://github.com/frostdev-ops/glaze) in your browser over MCP: your courses,
to-dos, grades, assignments and Writer documents, each only once you allow it in Glaze. Needs Node.js 18 or later. Its
version follows Glaze's. It opens no network connections: it passes lines between the app and the browser through a
local socket (a named pipe on Windows), authenticated with a random token. It relays message contents in memory without
saving them to disk.

## Set up

```sh
npx glaze-mcp setup
```

This sets up each supported browser whose data folder exists. Run it again after installing another browser. Then turn
on **Settings → AI → Agents** in Glaze, and add `npx -y glaze-mcp` to your app as a stdio server:

```json
{ "mcpServers": { "glaze": { "command": "npx", "args": ["-y", "glaze-mcp"] } } }
```

It connects to the browser that started its helper last; `--browser <id>` chooses one (`chrome`, `edge`, `firefox`,
`safari`, …). Glaze asks you to allow each app identity and data group. App names are reported by the app; on Chrome,
Edge and Firefox, program identities are also self-reported and unverified. Windows normally supplies no program path.
Other programs running as your user can reach the helper. See
[Agents](https://github.com/frostdev-ops/glaze/blob/main/docs/agents.md) for approvals, tools and privacy.

In Glaze, **Forget all apps** clears the activity list and assignment reads and forgets paired apps, grants and declines.

For a copy of Glaze loaded unpacked, add `--dev <its folder>` (macOS and Linux) or `--extension-id <id>` with the id
`chrome://extensions` shows. A manifest with a `key` also needs `--extension-id`. Setup remembers only ids explicitly
given to it.

Setup refuses symlinked destinations and files or registrations belonging to another installation. On Windows, Chromium
browsers sharing a registry location use the first installed browser's host manifest.

## App bundle

Releases include `glaze-mcp-<version>.mcpb` for apps that install MCP bundles. With **Set up browsers** on (the
default), it sets up browsers each time the app starts it. Browsers need a system Node.js 18 or later to start the
helper.

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
copies alone. On Windows it removes its registry default values or an otherwise empty host key, preserving unrelated
values and subkeys.

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
