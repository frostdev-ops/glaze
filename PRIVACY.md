# Privacy Policy — Glaze

_Last updated: 2026-10-15_

## What Glaze stores

- **Your settings**, in `chrome.storage.sync`: the on/off switch, your colors and saved palettes, look,
  background, motion, light/dark schedule, course colour and extras choices, and what you set for a course in its course menu:
  its colour, look, tint and the **nickname you type for it**. When Chrome sync is on, these follow
  your own account between devices. Safari keeps them on this device only.
- **Your GPA choices** (Canvas, the GPA Extra), in `chrome.storage.sync` as their own small item: for each
  course you change, its Canvas site's address and course id with the credits, honors/AP level, grading
  scale you typed and whether it counts. Nothing is stored for a course you leave as it is. It follows
  your account like your settings; Safari keeps it on this device only.
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
- **What-if on Canvas**, in `chrome.storage.local`, on this device only, per Canvas site and signed-in user id:
  for up to 100 courses, the course id with the assignment ids and scores you typed (and the real grade each
  was typed against), the ids of work you left out, your pretend assignments (the name you gave, points and
  score) and a what-if grade per course for the GPA. A score goes once its real grade arrives or changes,
  and the calculator says so. "Clear this course" deletes a course's scores and pretend assignments, "Clear all
  courses" everything, and the time of the last Clear all is kept per site and user so a change from another open
  tab can't bring them back. Nothing of this
  is sent to Canvas or anywhere else.
- **What's due this week**, in `chrome.storage.local`, on this device only: the title, course and due
  time of each item due in the next seven days, from Blackboard's own To Do list (or Canvas's planner, or Moodle's Timeline),
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
  them. Canvas's own editor recovery and its own what-if scores stay with Canvas.
- **Better To Do** (Canvas, off by default), in `chrome.storage.local`, on this device only, per Canvas site and
  signed-in user id: the tasks you add (title, course, due date, notes), the steps, "do on" days and focus sessions
  you plan, and what you tick off while "Tick off in Canvas too" is off. Export settings includes them, so you can
  move them; nothing else sends them anywhere. It also keeps one copy of your planner items (title, course, dates,
  submission status, your planner marks) and, for teachers, the work waiting to be graded with its counts. Two
  minutes is how long that copy counts as fresh, not how long it is kept: it stays until the next fetch replaces it,
  or until Glaze is removed.
- **Reminders and streak** (Canvas, off by default), in `chrome.storage.local`, on this device only, per Canvas site
  and signed-in user id: which reminders have been shown (so another tab doesn't show them again; while one tab is
  showing one, a random id for that tab holds it for 30 seconds), the ones you
  snoozed and the items you muted, each with a time (dropped after a month; mutes after three months), and, with the
  streak on, the day your run started, your best, what a restore forgave and how many restores you used this month.
  It's kept apart from Canvas's own read and done state, which Glaze never changes. Nothing sends it anywhere, and
  Export settings leaves it out; your reminder choices (which kinds, how long before) are settings and sync with them.
- **Your Looks history and favorites**, in `chrome.storage.local`, on this device only: the last 20 themes
  you wore (palette, fonts, look and background, with when you last wore each), so Previous Look can take
  you back, and the theme codes you saved as favorites, with the name and GitHub username of a gallery Look.
  Clear history in the editor deletes the history; Remove deletes a favorite.
- **Canvas course cards**, in `chrome.storage.sync` like your settings: your card settings (`card`), each course's
  card style (`cards`: colors, a gradient, a picture's `https://` link and how it is shown) and its bookmarks
  (`links`: their names, addresses and icons), by your Canvas site's address and course number.
- **Canvas sidebar settings**, in `chrome.storage.sync`: background colors, an optional `https://` picture link
  or a local picture identifier, filter/overlay, text color, logo visibility, labels, size and collapsed state.
- **Pictures you choose for course cards or the Canvas sidebar from your computer**, in `chrome.storage.local`, on this device only:
  scaled down to at most 960 pixels and kept as WebP (JPEG in Safari), at most about 400 KB each and 4 MB in all.
  They are never synced, exported or put in a theme code. Choosing another picture, removing the card's style,
  or switching the sidebar away from its local picture deletes the old one; Reset everything deletes them all.
  Sidebar pictures use a temporary blob URL while shown, rather than embedding their bytes in the page's
  inline styles or sessionStorage. Canvas page code can still read a picture displayed on its page.
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
  The course list includes each course's term (for the GPA and to search this term's courses first).
  **Search in your courses** (on by default, under the command palette): once you have typed two characters
  in the command palette and paused, Glaze sends what you typed to your own Canvas site, and only there, asking
  each of your active courses for pages, assignments, discussions, announcements, modules and files whose titles
  match (Canvas's own `search_term` lists). The next keystroke cancels the requests still running. The answers are
  kept in memory on that page for five minutes, filed by course, kind and what you typed in lower case (so typing it
  again in any case asks nothing new), and are gone when you leave the page; none of it, what you typed included, is
  stored. When you open the what-if calculator on a
  course's Grades page (or when you have something saved for that course), Glaze asks for that course's
  assignment groups with your submissions, and its grading periods or grading scheme where the course has
  them; the answers stay in memory. With the GPA on, a what-if grade for a course whose letter grade Canvas gives
  asks once for that course's grading scheme, to read the what-if on the same scale. Glaze never writes grades or
  what-if scores to Canvas.
  These requests are read-only GETs to your own Canvas site with your existing session (Better To Do's opt-in tick, below, is the one write). Only the due
  list, course details and badge records described above are stored; other answers stay in memory.
  For supported Inbox draft recovery, Glaze reads your profile id and, when offering a copy or checking
  a send, your sent conversations and matching conversation details without marking mail read. It
  sends no messages. When you click Download all, Canvas supplies signed links for accessible module
  files. The extension's background worker fetches them from your school's file host without cookies.
  Links and file bytes stay in memory while Glaze makes the zip; they are not saved in extension storage.
  The resulting zip is saved to your device.
- **Better To Do** (Canvas, off by default). On the Dashboard and a course's home page, Glaze asks your own Canvas
  site for your profile (for your user id and time zone), your planner items from a week back (longer if you choose
  to keep past-due work longer) to the end of your timeframe, and your active courses. If you teach or assist a
  course, it also asks for your To Do list's grading items and, with grading progress on, each listed assignment's
  submission counts. It asks when such a page opens and its copy is more than two minutes old, when you come back to
  the page (shown or focused) after that, and when you change the list's settings; a grading count that didn't
  come is asked for again when you come back. These are read-only GETs with your existing session. The answer also
  replaces the due list above, and on these pages the due list's start-of-page fetch is skipped. Opening the command
  palette before the list has its first answer can still ask for the due list once more (at most every ten minutes).
  Other pages keep fetching the due list on their own schedule; the two aren't merged because the due list covers the
  next seven days from Blackboard, Canvas or Moodle on every page, while To Do's window follows your settings and only runs
  where the list is.
- **Tasks on course cards** (Canvas, off by default). On the Dashboard's card view, Glaze asks your own Canvas site
  for your profile (user id and time zone; one request a page, shared with Better To Do) and uses Better To Do's copy
  of your planner items. Only when that copy is missing or more than two minutes old and the To Do list isn't on the
  page (or it left without an answer) does it ask for your planner items itself, the same read-only request with the
  same window, and keeps the answer in that same copy (and the due list above), unless a newer one arrived meanwhile;
  the list then uses it too (a teacher's list asks only for its grading items). It asks again when you come back to
  the page after that, or change the To Do settings, and not within a minute of a failed ask. It never writes to Canvas.
- **Reminders and streak** (Canvas, off by default). On any Canvas page while one is on, Glaze asks your own Canvas
  site for your profile and course list (as Better To Do does) and uses Better To Do's copy of your planner items. Only
  when that copy is missing or more than ten minutes old and neither the To Do list nor the card tasks are on the page
  does it ask for your planner items itself, the same read-only request with the same window, keeping the answer in
  that same copy. It asks again when you come back to the page after that, not within a minute of a failed ask, and
  never on a timer. Reminders are drawn inside the Canvas page only: Glaze has no notifications permission and sends
  nothing to any other place. It never writes to Canvas.
- **Ticking off in Canvas** (Better To Do's "Tick off in Canvas too", off by default). This is the only change Glaze
  makes to any site. When you tick or untick an item, Glaze writes Canvas's own planner mark for it, as Canvas's List
  View checkbox does: one request to your own Canvas site (`POST /api/v1/planner/overrides`, or `PUT` to the mark
  that already exists) with the item's type and id, your user id and done or not done, and the page's own CSRF token.
  Nothing is written at any other time, and nothing else is written. If Canvas refuses, the tick goes back and the
  list says so. Off, ticks stay on this device.
- **On Moodle.** At most every ten minutes, Glaze asks your own Moodle site for the activities due in the
  next seven days, with the same request Moodle's own Timeline block makes (`core_calendar_get_action_events_by_timesort`
  through Moodle's `/lib/ajax/service.php`, with your existing session and the page's own session key), and keeps
  them as the due list above. When you open the command palette, it asks for your courses in progress, the same
  request as Moodle's Course overview block (`core_course_get_enrolled_courses_by_timeline_classification`). On
  the Dashboard and My courses, with Grades on course cards on, it loads your grades overview page
  (`/grade/report/overview/index.php`), as you would see it, once per page, to read each course's total. These are
  read-only: Moodle sends its service calls as POST requests, and these two only read. They go only to the Moodle
  site you are on. Only the due list is stored; the other answers stay in memory. Moodle may log that the grades
  overview was viewed, as it does when you open it yourself.
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
- **Sidebar pictures.** A sidebar picture linked by `https://` is loaded by your browser from that host when
  shown. The editor also reads it for its contrast warning when the host permits that; the preview of a theme
  code names its sidebar image host before you apply it. Files selected from your device cause no upload.
- **Course card pictures and bookmarks.** A card picture you give as an `https://` link is loaded by your browser
  like the background image. With condensed cards, the card editor reads that picture once more to measure how
  well text reads on it; a site that doesn't allow that gets an ordinary request and is just not measured. A
  theme code's card pictures are named in its preview before you use it. Bookmark icons are drawn by Glaze: the
  linked sites are asked for nothing (no favicons) until you click a bookmark. The create button asks your own
  Canvas site, once per course, whether you may start a discussion there.
- **Mac app updates.** The downloaded Mac DMG app checks
  `https://frostdev.io/projects/glaze/appcast.xml` about once a day while Glaze is in use and downloads
  updates from GitHub. Sparkle system profiling is disabled: no system profile, coursework, settings,
  or browsing history is sent. Frostdev.io and GitHub receive the update requests and ordinary
  connection information such as your IP address. The Mac App Store and iPhone/iPad apps include no
  Sparkle updater; their updates come through the App Store.

The extension has two links, and you click each yourself: the footer link to the project's GitHub page, and "Open the
gallery" in the editor (see below).

## The Looks gallery

The Looks gallery at `https://frostdev.io/glaze/looks` is an ordinary website. Glaze makes no request
to it; you visit it yourself, from the editor's Open the gallery button or any other link, and
frostdev.io sees that visit like any other (see its [privacy page](https://frostdev.io/privacy)). On
the gallery's pages only, Glaze runs a small script that waits for you to click **Use this Look in
Glaze**. That click passes the Look's code, name and author from the page to Glaze's editor on your
device; nothing is sent anywhere, and the editor applies nothing until you choose **Use this theme**.
If a Look's code names a background image on another site, the editor's preview loads it from that
site, as for any pasted theme code, and says which site it is.

## Recognizing Canvas and Moodle

To recognize Canvas and Moodle on any school's domain, Glaze checks the head of each https page for Canvas's own stylesheet link or the keywords line Moodle writes into every page ("moodle, …"), and stops at the page body. For Moodle it also checks the page id and layout Moodle puts on the body tag itself, so a page that merely mentions Moodle is left alone. Nothing is read beyond that, and nothing leaves the browser. When it finds either, it remembers that site so it can style it from the start next time.

## Permissions

- `storage` — to save the settings, GPA choices, course names, places, what-if scores, due list, Better To Do's tasks and plans, reminder and streak state,
  typed-text backups, Looks history and favorites, and Safari update-check timestamp described above.
- `nativeMessaging` (Safari only) — to ask the containing Mac app to check for updates. The App Store
  apps ignore this request. Chrome does not request this permission.
- Host access to `https://*/ultra/*` — to apply the theme on Blackboard Ultra pages. Blackboard Ultra is
  self-hosted per institution on arbitrary domains, always under the `/ultra/` path, so the match
  pattern cannot name a fixed host. Glaze reads and restyles the page in your browser only.
- Host access to `https://*.instructure.com/*` — to apply the theme on Canvas, which Instructure hosts
  for most schools under that domain.
- Host access to `https://*/*` and `scripting` — Canvas also runs on schools' own domains, and Moodle always does.
  The check described above runs on https pages for that reason; when it finds Canvas or Moodle, Glaze styles that
  site, and only that site, the same way. The hostname is kept in the extension's local storage on your device.
  The same host access lets the gallery script above run on `https://frostdev.io/glaze/looks`; it adds no
  permission.

## Hosting

The Chrome Web Store requires a publicly hosted privacy policy URL. This document is served from the
project's GitHub repository at
`https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md`.

## Contact

admin@frostdev.io
