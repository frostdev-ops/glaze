# Privacy Policy — Glaze

_Last updated: 2026-10-14_

## What Glaze stores

- **Your settings**, in `chrome.storage.sync`: the on/off switch, your colors and saved palettes, look,
  background, motion, course colour and extras choices, and what you set for a course in its course menu:
  its colour, look, tint and the **nickname you type for it**. When Chrome sync is on, these follow
  your own account between devices. Safari keeps them on this device only.
- **Your courses**, in `chrome.storage.local`, on this device only: each course's name as Blackboard
  lists it and which of Ultra's ten colour slots it is in, so the editor can list them for you to
  recolour or tint. On Canvas this includes the site's address, course id, name, code and native color.
- **Which grades you've seen**, in `chrome.storage.local`, on this device only: for each course whose
  gradebook you've opened, each item's id and the score it had, so new-grade badges know what's new.
- **Which course items you've seen**, in `chrome.storage.local`, on this device only: for each course
  you've opened, the ids of its items, so new-content badges know what's new.
- **Canvas badge records**, in `chrome.storage.local`, on this device only: the site's address, signed-in
  user's id and course id, with module-item ids, which ones you've seen, unread-grade counts and fetch
  times. These let badges share a five-minute cache between pages and keep accounts separate.
- **Where you were in each course** (the "Remember your place" Extra, on by default), in
  `chrome.storage.local`, on this device only: for up to 30 courses, which folders of its content you
  left open and how far down you had scrolled, so coming back opens and scrolls them again. A copy of
  the same is kept in that browser tab's session storage on your Blackboard site, so a reload finds it
  even right after Glaze updates; the browser clears it when the tab closes. On Canvas this keeps your
  scroll position in Modules and the last module-item id you opened; Canvas keeps modules open or closed itself.
- **Scores you try in the what-if calculator**, in `chrome.storage.local`, on this device only: for up
  to 20 courses, the hypothetical scores you typed for work not graded yet. A score is removed once the
  item has a real grade or is gone, and "Clear scores" removes a course's.
- **What's due this week**, in `chrome.storage.local`, on this device only: the title, course and due
  time of each item due in the next seven days, from Blackboard's own To Do list (or Canvas's planner),
  and the address of the site it came from, so the popup can list them. It is replaced each time it's
  fetched.
- **What you type in Blackboard's editors** (the "Back up what you type" Extra, on by default), in
  `chrome.storage.local`, on this device only. While you write a post, reply, journal entry, message or
  assignment text, Glaze keeps a copy so it can offer it back if the page reloads or your session times
  out before it's posted. Each copy is deleted once the post shows up on the page, when you clear the
  editor or dismiss the offer, and after 14 days at most. Switching the Extra off deletes them all. The
  text is never sent anywhere.
- **Supported new Canvas Inbox drafts**, in `chrome.storage.local`, on this device only: the message
  body, subject, site's address, signed-in user's id, course id and recipient ids. Backup covers new
  messages to individual users in uniquely named courses, with a subject and selected recipients;
  replies and group recipients are not backed up. Copies are kept until a matching sent message is
  confirmed, the body is cleared or the offer dismissed, or 14 days pass. Switching the Extra off deletes
  them. Canvas's own editor recovery and what-if scores stay with Canvas.
- **The last Safari update-check attempt**, in `chrome.storage.local`, on this device only: a timestamp
  that limits requests to the native app to once every 24 hours when Safari starts Glaze's background worker.

Uninstalling the extension removes all of it.

## What Glaze collects

Glaze has no analytics and does not collect, log, or sell your browsing history, page content,
Blackboard coursework, grades, or credentials. The network requests below reach the requested
services, which receive ordinary connection information such as your IP address.

## Network requests

The browser extension ships as static files and loads no remote scripts. Its built-in fonts and three.js (used by the
animated backgrounds) are bundled. It makes requests in these cases:

- **Your course list.** On a Blackboard page, at most every ten minutes, Glaze asks your own Blackboard
  site for your list of courses, the same one Blackboard's Courses page asks for, with your existing
  session, and keeps each course's name and colour slot as above. Nothing is sent anywhere else.
- **What's due this week.** On a Blackboard page, at most every ten minutes, Glaze asks your own
  Blackboard site for your To Do list for the next seven days, the same one Blackboard's own To Do panel
  asks for, with your existing session, and keeps it as above. Picking an item in the command palette
  asks for that course's items to find its address. Nothing is sent anywhere else.
- **Calendar colours.** On Blackboard's Calendar page, Glaze asks your own Blackboard site for your
  calendar entries (six weeks back, ten ahead), as the calendar itself does, to tell which course an entry
  belongs to and paint it in that course's colour. The answer is kept in memory only.
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
  for your list of courses and, inside a course, that course's items, using Blackboard's own addresses
  with your existing session. The answers are kept in memory only.
- **New-content badges** (an Extra, on by default). In a course's content, Glaze asks your own
  Blackboard site for the course's list of items (the same request as the command palette's, which
  shares the answer), and on the Courses and Grades pages for each course you've opened before whose
  card is on screen: at most once every five minutes per course, with your existing session. The list
  is kept in memory; only the items' ids are stored, as above. Nothing is sent anywhere else.
- **On Canvas.** At most every ten minutes, Glaze asks your own Canvas site for your planner items for the
  next seven days, the same list Canvas's own planner and To Do list show, and keeps what's still to do as
  the due list above. On the Dashboard (Grades on course cards) and when you open the command palette, it
  asks for your active courses with their current scores and, inside a course, that course's navigation
  tabs. Extras also read native course colors, assignments and submission status, module completion
  requirements and items, folder and file metadata, and the server-rendered Grades page's unread dots.
  These requests are read-only GETs to your own Canvas site with your existing session. Only the due
  list, course details and badge records described above are stored; other answers stay in memory.
  For supported Inbox draft recovery, Glaze reads your profile id and, when offering a copy or checking
  a send, your sent conversations and matching conversation details without marking mail read. It
  sends no messages. Download all also fetches accessible module files to build a zip on your device.
  Nothing is sent anywhere else.
- **Web fonts.** Only if you choose one: Glaze downloads that font from Google Fonts
  (`fonts.googleapis.com`, `fonts.gstatic.com`), or from jsDelivr (`cdn.jsdelivr.net`) for OpenDyslexic
  and the Nerd Fonts. The request carries no cookies and no page address; those services see an
  ordinary font download from your browser. Opening the font list in the editor loads small previews
  of the fonts' names from Google Fonts the same way. Built-in fonts load nothing.
- **Grades on course cards** (an Extra, on by default). To show your overall grade on each course on
  the Courses page, Glaze makes the same gradebook request for each course whose card is on screen, at
  most once a minute per course, to the site you are on, with your existing session. The answer is kept
  in memory only. Nothing is stored or sent anywhere else.
- **Download all** (an Extra, on by default). When you click "Download all" on a folder, Glaze asks your
  own Blackboard site for the folder's contents, the same way folder previews do, then fetches the files in
  items you've already opened from that site, which hands them over from Blackboard's own file storage, as
  when you open them yourself. The zip is made in your browser and saved to your device. Nothing is sent
  anywhere else.
- **Background image.** If you choose an image background, your browser loads the `https://` link you
  typed, like any image on a web page. That site sees an ordinary image request.
- **Mac app updates.** The downloaded Mac DMG app checks
  `https://frostdev.io/projects/glaze/appcast.xml` about once a day while Glaze is in use and downloads
  updates from GitHub. Sparkle system profiling is disabled: no system profile, coursework, settings,
  or browsing history is sent. Frostdev.io and GitHub receive the update requests and ordinary
  connection information such as your IP address. The Mac App Store and iPhone/iPad apps include no
  Sparkle updater; their updates come through the App Store.

The only link in the extension is the footer link to the project's GitHub page, which you click yourself.

## Recognizing Canvas

To recognize Canvas on any school's domain, Glaze checks the head of each https page for Canvas's own stylesheet link and stops at the page body; nothing is read beyond that, and nothing leaves the browser. When it finds Canvas, it remembers that site so it can style it from the start next time.

## Permissions

- `storage` — to save the settings, course names, places, what-if scores, due list, typed-text backups
  and Safari update-check timestamp described above.
- `nativeMessaging` (Safari only) — to ask the containing Mac app to check for updates. The App Store
  apps ignore this request. Chrome does not request this permission.
- Host access to `https://*/ultra/*` — to apply the theme on Blackboard Ultra pages. Blackboard Ultra is
  self-hosted per institution on arbitrary domains, always under the `/ultra/` path, so the match
  pattern cannot name a fixed host. Glaze reads and restyles the page in your browser only.
- Host access to `https://*.instructure.com/*` — to apply the theme on Canvas, which Instructure hosts
  for most schools under that domain.
- Host access to `https://*/*` and `scripting` — Canvas also runs on schools' own domains. The Canvas check
  described above runs on https pages for that reason; when it finds Canvas, Glaze styles that site, and
  only that site, the same way. The hostname is kept in the extension's local storage on your device.

## Hosting

The Chrome Web Store requires a publicly hosted privacy policy URL. This document is served from the
project's GitHub repository at
`https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md`.

## Contact

admin@frostdev.io
