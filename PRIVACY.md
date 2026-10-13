# Privacy Policy — Glaze for Blackboard Ultra

_Last updated: 2026-10-11_

## What Glaze stores

- **Your settings**, in `chrome.storage.sync`: the on/off switch, your colors and saved palettes, look,
  background, motion, course colour and extras choices. Chrome syncs them to your own Google account so
  your theme follows you between devices.
- **The names of your courses**, in `chrome.storage.local`, on this device only. Glaze notes which
  course Ultra shows in which of its ten colour slots, so the editor can list them for you to recolour.

Uninstalling the extension removes both.

## What Glaze collects

Nothing. Glaze does not collect, log, transmit, or sell any data — not personal information, not
browsing history, not page content, not your Blackboard coursework, grades, or credentials. It has no
analytics and no server of its own.

## Network requests

Glaze ships as static files and loads no remote code. Its fonts and three.js (used by the animated
backgrounds) are bundled. It makes requests in two cases:

- **Folder previews** (an Extra, on by default; switch it off under Extras). Hovering a folder asks your own Blackboard site for the
  folder's contents, using the same internal address Blackboard's own page uses. The request goes to the
  site you are on, with your existing session, and the answer is kept in memory for a minute. Nothing is
  sent anywhere else.
- **Background image.** If you choose an image background, your browser loads the `https://` link you
  typed, like any image on a web page. That site sees an ordinary image request.

The only link in the extension is the footer link to the project's GitHub page, which you click yourself.

## Permissions

- `storage` — to save the settings and course names described above.
- Host access to `https://*/ultra/*` — to apply the theme on Blackboard Ultra pages. Blackboard Ultra is
  self-hosted per institution on arbitrary domains, always under the `/ultra/` path, so the match
  pattern cannot name a fixed host. Glaze reads and restyles the page in your browser only.

## Hosting

The Chrome Web Store requires a publicly hosted privacy policy URL. This document is served from the
project's GitHub repository at
`https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md`.

## Contact

admin@frostdev.io
