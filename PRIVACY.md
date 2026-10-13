# Privacy Policy — Glaze for Blackboard Ultra

_Last updated: 2026-10-13_

## What Glaze stores

- **Your settings**, in `chrome.storage.sync`: the on/off switch, your colors and saved palettes, look,
  background, motion, course colour and extras choices. Chrome syncs them to your own Google account so
  your theme follows you between devices.
- **The names of your courses**, in `chrome.storage.local`, on this device only. Glaze notes which
  course Ultra shows in which of its ten colour slots, so the editor can list them for you to recolour.
- **Which grades you've seen**, in `chrome.storage.local`, on this device only: for each course whose
  gradebook you've opened, each item's id and the score it had, so new-grade badges know what's new.
- **What you type in Blackboard's editors** (the "Back up what you type" Extra, on by default), in
  `chrome.storage.local`, on this device only. While you write a post, reply, journal entry, message or
  assignment text, Glaze keeps a copy so it can offer it back if the page reloads or your session times
  out before it's posted. Each copy is deleted once the post shows up on the page, when you clear the
  editor or dismiss the offer, and after 14 days at most. Switching the Extra off deletes them all. The
  text is never sent anywhere.

Uninstalling the extension removes all of it.

## What Glaze collects

Nothing. Glaze does not collect, log, transmit, or sell any data — not personal information, not
browsing history, not page content, not your Blackboard coursework, grades, or credentials. It has no
analytics and no server of its own.

## Network requests

Glaze ships as static files and loads no remote code. Its built-in fonts and three.js (used by the
animated backgrounds) are bundled. It makes requests in these cases:

- **Folder previews** (an Extra, on by default; switch it off under Extras). Hovering a folder asks your own Blackboard site for the
  folder's contents, using the same internal address Blackboard's own page uses. The request goes to the
  site you are on, with your existing session, and the answer is kept in memory for a minute. Nothing is
  sent anywhere else.
- **Due-date status** (the "Due-date status and percentages" Extra, on by default, and due-date urgency).
  To show beside a due date whether you've submitted the work or had it graded, Glaze asks your own
  Blackboard site's gradebook for your grades in the course you're viewing, using the same internal
  address Blackboard's own Grades page uses. To say whether work waiting for a grade was handed in late,
  it also asks for the date of your latest submission of it (once per submission) and whether you have a
  due-date exception in that course. The requests go to the site you are on, with your existing session,
  at most once a minute per course, and the answers are kept in memory only. Nothing is stored or sent
  anywhere else.
- **New-grade badges** (an Extra, on by default). To count new grades on your course cards, Glaze asks
  your own Blackboard site's gradebook for your grades in the courses on the Courses and Grades pages
  (the first twelve), the same way as for due-date status: at most once a minute per course, kept in
  memory. The what-if calculator uses the same answer and asks for nothing more.
- **Command palette** (an Extra, on by default). When you open it, Glaze asks your own Blackboard site
  for your list of courses and, inside a course, that course's items, once per page, using Blackboard's
  own addresses with your existing session. The answers are kept in memory only.
- **Web fonts.** Only if you choose one: Glaze downloads that font from Google Fonts
  (`fonts.googleapis.com`, `fonts.gstatic.com`), or from jsDelivr (`cdn.jsdelivr.net`) for OpenDyslexic
  and the Nerd Fonts. The request carries no cookies and no page address; those services see an
  ordinary font download from your browser. Opening the font list in the editor loads small previews
  of the fonts' names from Google Fonts the same way. Built-in fonts load nothing.
- **Grades on course cards** (an Extra, on by default). To show your overall grade on each course on
  the Courses page, Glaze makes the same gradebook request for each course whose card is on screen, at
  most once a minute per course, to the site you are on, with your existing session. The answer is kept
  in memory only. Nothing is stored or sent anywhere else.
- **Background image.** If you choose an image background, your browser loads the `https://` link you
  typed, like any image on a web page. That site sees an ordinary image request.

The only link in the extension is the footer link to the project's GitHub page, which you click yourself.

## Permissions

- `storage` — to save the settings, course names and typed-text backups described above.
- Host access to `https://*/ultra/*` — to apply the theme on Blackboard Ultra pages. Blackboard Ultra is
  self-hosted per institution on arbitrary domains, always under the `/ultra/` path, so the match
  pattern cannot name a fixed host. Glaze reads and restyles the page in your browser only.

## Hosting

The Chrome Web Store requires a publicly hosted privacy policy URL. This document is served from the
project's GitHub repository at
`https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md`.

## Contact

admin@frostdev.io
