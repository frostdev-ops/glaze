# glaze-mcp

Lets AI apps on this computer, like Claude, use Glaze in your browser. Needs Node.js 18 or later.

## Install

```sh
npx glaze-mcp setup
```

This sets up every supported browser it finds: Chrome, Edge, Brave, Vivaldi, Arc, Chromium and Firefox, on macOS,
Linux and Windows. Run it again after installing another browser. Then turn on agent access in Glaze's Settings → Agents.

For a copy of Glaze loaded unpacked, add `--dev <its folder>` (macOS and Linux) or `--extension-id <id>` with the id
`chrome://extensions` shows. If Glaze can't reach the helper, `npx glaze-mcp doctor` says why.

## Uninstall

```sh
npx glaze-mcp uninstall
```

This removes the helper's files, and the Windows registry keys, that setup made. Other apps' files are left alone.
