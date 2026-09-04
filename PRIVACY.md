# Privacy Policy — Glaze for Blackboard Ultra

_Last updated: 2026-09-04_

## What Glaze stores

Your settings, and nothing else: the theme on/off switch, your 14 colour values, the three motion
toggles, and the footer toggle. They live in `chrome.storage.sync`, which means Chrome syncs them to
your own Google account so your theme follows you between devices. Uninstalling the extension removes
them.

## What Glaze collects

Nothing. Glaze does not collect, log, transmit, or sell any data — not personal information, not
browsing history, not page content, not your Blackboard coursework, grades, or credentials.

## Network requests

Glaze makes none. The extension ships as static files (`content.js`, `popup.js`, `defaults.js`,
`theme.css`, `popup.html`, icons) and loads no remote code or analytics. Verified by search: there are
no `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, or dynamic `import()` calls anywhere in the
source. The only link in the extension is the footer link to the project's GitHub page, which you click
yourself.

## Permissions

- `storage` — to save the settings described above.
- Host access to `https://*/ultra/*` — to apply the theme on Blackboard Ultra pages. Blackboard Ultra is
  self-hosted per institution on arbitrary domains, always under the `/ultra/` path, so the match
  pattern cannot name a fixed host. Glaze reads and restyles the page in your browser only.

## Hosting

The Chrome Web Store requires a publicly hosted privacy policy URL. This document is served from the
project's GitHub repository at
`https://github.com/frostdev-io/glaze/blob/main/PRIVACY.md`.

## Contact

admin@frostdev.io
