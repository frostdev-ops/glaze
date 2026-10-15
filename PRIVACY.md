# Privacy Policy — Glaze

_Last updated: 2026-10-15_

## What Glaze stores

- **Blackboard navigation:** precise size/spacing and logo choices sync in `nav`; up to eight custom link names,
  http/https URLs, built-in icon choices, new-tab preferences, native-item order/hidden choices and rail-widget
  switches/order/position sync in the separate capped `navItems` item. A link is contacted only when you click it;
  icons and the default Glaze logo are bundled. Custom logos are resized on this device and stored as `navLogo:<id>`
  in local storage (960 px longest side, 400,000 characters each, within the existing 4,000,000-character combined
  picture cap). Replacement/reset deletes unused custom-logo pictures after the new setting is saved; failed saves
  retain the old picture. A displayed local picture is readable by the school page, like other displayed images.
  Export all carries navigation settings/links but removes local picture ids and restores the bundled logo on import;
  Look/share codes exclude personal navigation links, layout and logos. Rail widgets are off by default. The timer
  shares the existing device `widgetTimer`; next due uses the same-origin due cache and the pet reads existing progress
  for a fresh cached same-origin account, without fetching a profile, awarding XP or recording extra activity.

- **Pet habitat** (off by default), in `chrome.storage.local`, per site and confirmed signed-in account (`pet:<origin>/<uid>`): settled XP contributions for rewarded work/plan ids, existing source-cache timestamps, the provider hand-in timestamp saved when work credit settles, credited streak day numbers, the selected buddy look and decoration positions. The broker reads existing Better To Do, planner-cache, Insights and W11 streak records, plus the existing To Do/Streak switches; it adds no assignment requests or activity tracking. The ordinary shared identity helper may read the signed-in profile once for the page. Saved W11 `[streak.start, min(today, streak.asOf))` is the only source of streak days while Streak is on, including free restores; no days are guessed from its all-time best. With Streak off, no saved streak, or no valid saved calculation day (`asOf`), no new streak XP is awarded and existing XP stays. Missing/cleared caches and deleting finished task or plan history preserve settled rewards. With Canvas tick sync on, historical hand-ins and kept plans can receive first rewards without a planner row. A missing row preserves settled work/plan values; work credit can update if a fresh existing source proves a hand-in newer than the saved provider hand-in timestamp. A refreshed source timestamp alone cannot override a native untick. Ultra always follows local ticks. Visible unticks (local or synced), manual done mode and newer submission corrections revoke the associated work/plan XP; a still-present plan moved to a future day or with a known missed completion also loses plan credit. Each contribution/version/provider-baseline/day collection is capped at 4,096 entries. An unreadable, oversized or full record is left untouched and the view explains that its update was refused; existing earned history is never silently truncated or reset. No focus timer rewards, analytics, remote game service, notifications or missed-day penalties. Progress is not synced; removing the extension or clearing its local storage deletes it. Moodle has no supported stored account-scoped completion source yet, so no game is shown there.

- **Your settings**, in `chrome.storage.sync`: the on/off switch, your colors and saved palettes, look,
  background, motion, light/dark schedule, course colour and extras choices, and what you set for a course in its course menu:
  its colour, look, tint and the **nickname you type for it**. When Chrome sync is on, these follow
  your own account between devices. Safari keeps them on this device only.
- **Your GPA choices** (Canvas and Blackboard, the GPA Extra), in `chrome.storage.sync` as their own small item: for each
  course you change, its site's address and course id with the credits, honors/AP level, grading
  scale you typed and whether it counts. Nothing is stored for a course you leave as it is. It follows
  your account like your settings; Safari keeps it on this device only.
- **Your courses**, in `chrome.storage.local`, on this device only: each course's name as Blackboard
  lists it and which of Ultra's ten colour slots it is in (with its site's address and course code, so Gradescope
  courses can be placed with it), so the editor can list them for you to
  recolour or tint. On Canvas this includes the site's address, course id, name, code and native color; on Moodle,
  the site's address (with its folder, if Moodle is in one), course id, full and short name, and the colour Moodle
  gives the course.
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
- **What-if** (Canvas and Blackboard), in `chrome.storage.local`, on this device only, per site and signed-in user id:
  for up to 100 courses, the course id with the assignment ids and scores you typed (and the real grade each
  was typed against), the ids of work you left out, your pretend assignments (the name you gave, points and
  score) and a what-if grade per course for the GPA. A score goes once its real grade arrives or changes,
  and the calculator says so. "Clear this course" deletes a course's scores and pretend assignments, "Clear all
  courses" everything, and the time of the last Clear all is kept per site and user so a change from another open
  tab can't bring them back. Nothing of this
  is sent to Canvas, Blackboard or anywhere else. Scores typed in Glaze 2.2's Blackboard calculator (kept by course id
  alone) move into this record the first time you open that course's grades, in one step that deletes exactly those
  entries from the old store; after a Clear all courses on that site they are deleted instead. A read that fails, or a
  failed write of the record, changes neither store; if the record is written but the old entries can't then be
  deleted, they stay in both until the next visit deletes them, so nothing is lost. The old store names no site or account, so taking a course's scores into the account
  whose course has the same ids is Glaze's inference.
- **Past terms and a GPA goal** (Canvas and Blackboard, the GPA Extra), in `chrome.storage.local`, on this device only,
  per site and signed-in user id: up to 40 terms you typed in or imported, each with its name, plus/minus or whole-letter
  scale and up to 40 courses (the name, credits, grade as written, honors/AP level, left out or not), and your goal
  (cumulative or this term's GPA). A transcript you paste or pick (text, a web page, a Word file, a PDF, a photo or a
  screenshot) is read on this device; only the terms you review and add are kept, never the transcript itself. Glaze
  sends none of it anywhere: no upload, no AI service. "Remove this term" and "Remove all past terms" delete it, and
  the time of the last Remove all is kept so a change from another open tab can't bring terms back.
- **Insights** (Canvas and Blackboard, off by default), in `chrome.storage.local`, on this device only, per site and
  signed-in user id: one small summary of this term, so the view opens at once next time: each current course's id and
  name, its published work's name, due date, points, when you handed it in and whether it was on time, late, missing or
  excused (as Canvas marks it; on Blackboard, as Glaze reads the submission time against the due date), and the course's grade after each graded piece of work (each grading period's own, where the course has
  them). It keeps one term at a time, the one most recently worked out. "Clear saved insights" deletes it, and the time of that clear is kept so an answer still on its way from
  another tab can't bring it back. Nothing is timed or tracked; the view also reads Better To Do's plans and the streak
  (if you use them) already on this device. The summary card you save as a picture is made in the page and saved by
  your browser; nothing is uploaded.
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
- **Better To Do** (Canvas and Blackboard, on by default), in `chrome.storage.local`, on this device only, per Canvas
  or Blackboard site and signed-in user id: the tasks you add (title, course, due date, notes), the steps, "do on" days
  and focus sessions you plan, and what you tick off while "Tick off in Canvas too" is off (on Blackboard, always). Export settings includes them, so you can
  move them; nothing else sends them anywhere. It also keeps one copy of your planner items (title, course, dates,
  submission status, your planner marks; on Blackboard, your due items with whether each was handed in, late, missing or
  excused, and whether Blackboard sent its calendar whole) and, for teachers, the work waiting to be graded with its counts. Two
  minutes is how long that copy counts as fresh, not how long it is kept: it stays until the next fetch replaces it,
  or until Glaze is removed.
- **Export calendar (.ics)** (Canvas): no data of its own. Which parts go in the file and how far ahead are settings
  (`chrome.storage.sync`, like the others). The file itself is made on the page and handed to your browser's own
  download: Glaze keeps no copy and sends it nowhere. It holds what you chose of your Canvas deadlines, your own tasks,
  your "do on" days and focus sessions and your Gradescope work, with **course and assignment names**, links to them on
  your Canvas site and your tasks' notes, and the Canvas site's address in each event's identifier. Once saved, it is
  an ordinary file on your device; what happens to it after you import it is up to you and your calendar provider.
- **Google Calendar sync** (Chrome, off until you connect), in `chrome.storage.local`, on this device only: the ID of
  the calendar named Glaze that Glaze made in your Google account (or that you linked with a code from another device),
  the Google account Google names as that calendar's owner (its email address, shown as "Connected to …"), when you
  connected, when each Canvas site and account last synced and how the last sync ended. For each event Glaze wrote: an
  event ID (a SHA-256 hash of the Canvas site, your Canvas user id and the event's identifier), which Canvas account
  and, for a "do on" day or focus session, which Better To Do item it belongs to, that plan's date or time, when the
  event ends, a hash of what was written and Google's version tag for it; Google's sync cursor; and the IDs of deadline
  events you deleted in Google Calendar, so Glaze doesn't put them back. No sign-in token: Chrome keeps that itself.
  **Disconnect** deletes all of it.
- **Gradescope in To Do** (off by default), in `chrome.storage.local`, on this device only: which Gradescope account
  it's from (your name on Gradescope, and a SHA-256 hash of your Gradescope email address, never the address itself),
  which Canvas or Blackboard course each of your Gradescope courses goes with (by its Gradescope course id and short name, or "none of
  these courses"), and for each one placed with a course, the assignments read from its Gradescope course page (id, title, due and late
  due dates, whether you handed it in, the score if graded, whether it was late), the time they were read and how many
  rows couldn't be read; whether you said "Don't ask again" on Gradescope; and, with the daily check on, when each
  course was last tried; and, per Canvas or Blackboard account (site and user id), your one-time answer to "Show Gradescope
  work from … here?" (asked with one line in Better To Do, the course cards or the reminders hub; one answer for all
  three). Nothing from Gradescope shows for an account until it says yes there, so two people sharing
  a browser don't see each other's; signing in to another Gradescope account starts the Gradescope data afresh. It
  shows only on the Canvas or Blackboard site of the course it's placed with (and only for courses you're enrolled in there); what you tick off on a Gradescope item is kept with Better To Do's ticks above. No
  Gradescope password, cookie or session is stored. Placing a course elsewhere or forgetting it deletes what was read
  for it.
- **Dashboard notes and widgets** (Canvas and Blackboard Ultra, off by default), in `chrome.storage.local`, on this device only: your notes
  (at most 20,000 characters) per site and signed-in user id, with when you last typed them, so a note typed later
  in another tab wins; an emptied note keeps only the time it was emptied, so an older copy can't bring it back. The widgets' layout (which are on, their order and size, where a
  floating one sits), the music link you typed and when your study buddy last had a win to be happy about; the focus timer's phase and when
  it ends, so it keeps running from page to page. The widgets' settings (timer
  lengths, chime, quote choices, breathing lengths) are in `chrome.storage.sync` with your other settings (`widgets`).
  On Ultra, whether you folded Glaze's panel on the Courses page away (`panelShut`) is kept there too.
- **Notes** (Canvas and Blackboard Ultra, the notes app; the Notes switch, off by default), on this device only, per site and signed-in user id. The
  library's index is in `chrome.storage.local`: each note's title, folder, course (its id and the name the site showed),
  when it was made and last changed, its first 140 characters for the list, and when it went to the trash; your folders'
  names, courses and order. Each note's text and the pictures and attachments you add are in the extension's own
  IndexedDB, which only Glaze's background worker opens. Neither is in the school page's own storage (its
  `localStorage` or IndexedDB), so your school's Canvas pages can't read them. Notes opens, and its buttons, lists and
  menus act, only on your own clicks and key presses; clicks and keys the page's scripts fake are ignored, even on a
  control they move out of the view. While the Notes view is open, what it shows (the list and the note on screen) is
  part of the page, like anything shown there: the page's scripts can read it, and could type into it while you use it. Pictures are kept as PNG, JPEG, GIF or WebP, up to 5 MB each;
  attachments up to 20 MB each, kept as bytes and only ever offered as a download; 200 MB in all on this device. Links to
  Canvas files, pages and module items are kept as their address and title only; the file itself is never copied. A note
  or folder in the trash is deleted for good after 30 days, or when you empty the trash; its id and the time are kept
  30 days more, so a change still on its way from another tab can't bring it back. A step that fails (a deletion
  interrupted, say) is finished the next time Notes opens, so nothing deleted stays behind. Glaze doesn't ask for unlimited
  storage, so the browser may clear this storage if the device runs very short of space: **Export all** saves a copy
  (a zip of Markdown files, the pictures and attachments, and the notes as HTML for importing back) through your
  browser's own download, and **Import** reads such a zip on your device.
- **Reminders and streak** (Canvas and Blackboard, off by default), in `chrome.storage.local`, on this device only, per
  Canvas or Blackboard site and signed-in user id: which reminders have been shown (so another tab doesn't show them again; while one tab is
  showing one, a random id for that tab holds it for 30 seconds), the ones you
  snoozed and the items you muted, each with a time (dropped after a month; mutes after three months), and, with the
  streak on, the day your run started, the day it was last calculated, your best, what a restore forgave and how many restores you used this month.
  It's kept apart from Canvas's and Blackboard's own read and done state, which Glaze never changes. Nothing sends it anywhere, and
  Export settings leaves it out; your reminder choices (which kinds, how long before) are settings and sync with them.
- **Your class schedule** (Canvas and Blackboard), in `chrome.storage.local`, on this device only, per Canvas or
  Blackboard site and signed-in user id: for each course you saved, its course id there (or a name of your own), code and
  name, and each meeting's days, start and end time, place, first and last day and days off; the time zone those times
  are in (your Canvas profile's; on Blackboard, your browser's); and when each course was last saved, when you last pressed Delete all and which courses you deleted when,
  so a save from another tab made before a deletion can't bring a course back. Only what you choose to save on the
  review screen is kept; the file, page or text you import is read on your device and not kept. Delete removes a
  course, Delete all the lot. Nothing sends it anywhere other than into a calendar file you export yourself (Export
  calendar (.ics), "Your class schedule"), and Export settings leaves it out; whether class reminders are on, and how
  long before, are settings and sync with them.
- **Your Looks history and favorites**, in `chrome.storage.local`, on this device only: the last 20 themes
  you wore (palette, fonts, look and background, with when you last wore each), so Previous Look can take
  you back, and the theme codes you saved as favorites, with the name and GitHub username of a gallery Look.
  Clear history in the editor deletes the history; Remove deletes a favorite.
- **Canvas and Blackboard Ultra course cards**, in `chrome.storage.sync` like your settings: your card settings (`card`), each course's
  card style (Canvas `cards`, Ultra `ucards`: colors, a gradient, a picture's `https://` link and how it is shown) and its bookmarks
  (Canvas `links`, Ultra `ulinks`: their names, addresses and icons), by LMS site address and course id. Separate Ultra items protect them from older Glaze clients.
- **Your marks on documents** (Canvas, "Pen and highlighter on documents", off by default), in `chrome.storage.local`,
  on this device only, per Canvas site, signed-in user id and file id (which the viewer's address on your Canvas page
  names): each pen or highlighter stroke's points, color and width, page by page. Canvas's document viewer runs on
  Instructure's own host, and Glaze asks your Canvas page for the palette, the file and the user over the browser's
  messaging between the two, at each one's exact address. When the viewer's address doesn't name the user, Glaze asks
  your own Canvas who you are (`/api/v1/users/self/profile`, read-only, only while the switch is on). Signed out, marks
  are kept apart for that site as "anon" and shown only while signed out; if Glaze can't tell who you are, it keeps and
  shows none, so one person's marks never show for another. Nothing is sent to Canvas, Instructure or anywhere else.
  Export annotations saves them as a file you keep; Clear page and undo remove them.
- **Canvas and Blackboard Ultra navigation settings**, in `chrome.storage.sync`: background colors, an optional `https://` picture link
  or a local picture identifier, filter/overlay, text color, logo visibility, labels, size and collapsed state.
- **Pictures you choose for course cards or navigation from your computer**, in `chrome.storage.local`, on this device only:
  scaled down to at most 960 pixels and kept as WebP (JPEG in Safari), at most about 400 KB each and 4 MB in all.
  They are never synced, exported or put in a theme code. Choosing another picture, removing the card's style,
  or switching the sidebar away from its local picture deletes the old one; Reset everything deletes them all.
  Sidebar pictures use a temporary blob URL while shown, rather than embedding their bytes in the page's
  inline styles or sessionStorage. Canvas and Ultra page code can still read a picture displayed on their page. Ultra card pictures use separate `ultraCardImg:` local keys, so older clients cannot delete them as unused Canvas pictures.
- **Stickers, your pointer picture and Look rotation**, in `chrome.storage.local`, on this device only: where you put
  stickers on a page (the site's address and the page's path, with each sticker's position, size and angle), the
  pictures you add as your own stickers (scaled down to at most 256 pixels, at most about 200 KB each and 4 MB in all),
  your own pointer picture (scaled to 32 pixels), and which Looks rotation takes turns with and when it last changed.
  None of it is synced, exported or put in a theme code; the pointer and rotation choices themselves sync with your
  settings. Remove deletes a sticker, Delete your picture deletes a picture; Reset everything deletes all of it.
  Your own pictures are shown on a page through temporary blob addresses, not written into it, though the LMS page's
  own code can still read a picture shown on it.
- **What you keep from a syllabus** (Canvas and Blackboard, the Syllabus import Extra, off by default), in
  `chrome.storage.local`, on this device only, per site, user and course, and only after you check it and choose Save: the professor's
  name, e-mail, office and office hours, class times, the dates you kept, the grading scale and the weights. The
  syllabus itself (the Syllabus page's text, a Blackboard course's document, a file you pick, text you paste) is read on this device, shown to you
  while you review it, and not kept. If you choose so when saving, the scale also goes to your GPA choices above
  (synced like them) and the dates you tick become your own Better To Do tasks. Delete on the course home removes the
  record, keeping only when it was deleted (so a late save from another tab can't bring it back); the GPA scale and
  tasks stay until you change them there. Only the first 200,000 characters of a syllabus are read, and the review says
  so when there were more.
- **The last Safari update-check attempt**, in `chrome.storage.local`, on this device only: a timestamp
  that limits requests to the native app to once every 24 hours when Safari starts Glaze's background worker.

Uninstalling the extension removes all of it.

## What Glaze collects

Glaze has no analytics and does not collect, log, or sell your browsing history, page content,
Blackboard coursework, grades, or credentials. The network requests below reach the requested
services, which receive ordinary connection information such as your IP address.

## Network requests

Ultra appearance uses the visible course-card banners and existing color slots; it makes no LMS API requests. Linked images load from their chosen HTTPS hosts, exactly as on Canvas. The Ultra document viewer has no added iframe injection or host access.

The browser extension ships as static files and loads no remote scripts. Its built-in fonts, three.js (used by the
animated backgrounds), pdf.js and the Tesseract OCR engine with its six language models (used to read PDFs and photos
you import) are bundled. It makes requests in these cases:

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
  folder's contents, using the same internal address Blackboard's own page uses, for each item's title,
  state and due date only. The request goes to the site you are on, with your existing session, and those
  three are kept in memory until you leave or reload the page (after a minute, hovering the folder again asks
  afresh). Nothing is sent anywhere else. Blackboard can include a course
  tool's launch credentials in that answer; Glaze asks for them to be left out and never keeps them.
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
  memory. The what-if calculator uses the same answer; it asks for the course's grade categories (their names) only
  when the course's overall grade weighs one that no item names, and for the gradebook itself only when the page
  hasn't asked yet. Glaze never writes grades or what-if scores to Blackboard.
- **GPA on Blackboard** (the GPA Extra, off by default). On Blackboard's Grades page, Glaze reads your course list (as
  above) for this term's courses and asks for each one's gradebook the same way, and once a page for each course's
  grading schemas, to find its letter cut-offs where Blackboard shows them. The answers stay in memory.
- **Insights on Blackboard** (off by default). When you open it (and at most every six hours after, or when you press
  Refresh), Glaze asks your own Blackboard site for each of this term's courses' gradebook with your submission status,
  the address Blackboard's own course Grades page uses, and, only for a course with work it would call late or missing,
  whether you have due-date exceptions there. These never follow a redirect. Only the summary above is kept.
- **Syllabus import on Blackboard** (off by default). On a course's outline Glaze uses your course list (as above) for
  your user id and the course's term. When you open Import a syllabus, it asks your own Blackboard site's public
  content API for the course's items with their titles and text, to list its documents; the answer stays in memory
  while the dialog is open. Glaze expects that reading a document there marks nothing as opened, since it only lists the
  course's items and opens none, but that hasn't been measured. Files you pick are read on this device.
- **Command palette** (an Extra, on by default). When you open it, Glaze asks your own Blackboard site
  for your list of courses and, inside a course, that course's items, using Blackboard's own addresses
  with your existing session. The answers are kept in memory only.
- **New-content badges** (an Extra, on by default). In a course's content, Glaze asks your own
  Blackboard site for the course's list of items (the same request as the command palette's, which
  shares the answer), and on the Courses and Grades pages for each course you've opened before whose
  card is on screen: at most once every five minutes per course, with your existing session. The list
  is kept in memory; only the items' ids are stored, as above. Nothing is sent anywhere else.
- **Search in your courses on Blackboard Ultra** (on by default): after two typed characters and a 150 ms pause,
  Glaze reads your own site's public recursive content, announcement and discussion topic lists with GETs through
  its Ultra reader, reusing the page's existing memberships. It searches this course and open courses in this term,
  up to 100 courses. Only titles, availability, handler type and public body text are requested; no private content
  details, LTI fields, discussion threads, attempts or messages. Content with future, expired, missing, malformed or
  unsupported release conditions is omitted, including under restricted ancestors. HTML becomes text locally and
  never loads its images or scripts. Your query stays on the device. Projected source text and the course/term list
  are reused for five minutes in a bounded memory cache; expired rows are evicted on later cache reads/writes.
  Switching search or Glaze off clears the caches; leaving the page clears them too. Nothing is stored on disk.
  At most three lists run together, 30 search GETs per query and two pages of up to 200 items per list. The palette
  shares its existing membership lookup. Temporary failures are not cached as empty: network/server errors pause
  retries for three seconds and HTTP 429 for 30 seconds. Missing tools (403/404) can be cached as empty.
  New input, closing the palette, or switching search or Glaze off cancels pending search reads. Content links use
  the native redirect; announcement/discussion results open the course tool list only after you choose one.
  Search itself marks nothing read.
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
  asks once for that course's grading scheme, to read the what-if on the same scale. With a GPA goal set, a course
  whose letter grade Canvas gives asks once for its grading scheme (the lowest percent for each letter), and
  **What it takes** asks for that course's assignment groups with your submissions, as the what-if calculator does.
  When you open **Insights** (and at most every six hours after, or when you press Refresh), Glaze asks for each current
  course's assignment groups with your submissions, and its grading periods where it has them. These never follow a
  redirect, and the next page is asked for only on your own Canvas site.
  Glaze never writes grades or what-if scores to Canvas.
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
- **Better To Do, tasks on course cards, reminders, Export calendar (.ics), the class schedule and Google Calendar sync on
  Blackboard.** They ask your own Blackboard site, with your existing session, in read-only GETs that never follow a
  redirect, for what Blackboard's own pages ask for: who you are and your course list (the same requests as the course
  list above, shared with it), your To Do list for the window (in 14-day parts: Blackboard refuses longer ones), your
  calendar's items for the same window, and, for each course with something due in it, that course's gradebook rows
  with each item's last attempt and submission status (to tell what you handed in, late, missing or excused), plus your
  due-date exceptions in a course where work would otherwise count as late or missing. Nothing opens a test, an
  attempt, a discussion or a message, marks anything read, or reads a content item's tool credentials. One answer
  serves the To Do list, the cards and the reminders, kept as the copy above and asked for on the same schedule as on
  Canvas (below): when such a page opens with a copy more than two minutes old (ten for reminders on their own), when
  you come back to the page after that, and when the list's settings change; Export asks when you press Download, and
  Google Calendar sync on its schedule while a Blackboard page is open. Blackboard's own calendar feed link ("Share
  calendar") is never read or made by Glaze; you can paste it into the class schedule yourself, and it's then read
  once, from your own Blackboard site. Ticks stay on this device: Glaze never writes to Blackboard.
- **Export calendar (.ics)** (Canvas, only when you press Download). Glaze asks your own Canvas site for your profile
  (user id and time zone), your active courses (with their term dates, for "This term") and, for Canvas deadlines or
  plans, your planner items from today to eight weeks past the end of the range you picked (so a plan has its item's
  title) and, only when a plan in the range is for work not among those (overdue work planned for later), your planner
  items from half a year back to today. Read-only GETs with your existing session, one export at a time; the answer
  isn't kept. If Glaze, the Gradescope switch or your Gradescope answer changes, or the dialog closes, while Canvas
  answers, no file is saved. With Gradescope in
  To Do on, the Gradescope work comes from what's already kept on this device; nothing is asked of Gradescope.
- **Google Calendar sync** (Chrome, off until you connect; not in released builds until Google verifies Glaze, and
  those builds can't make any of these requests). The only destinations are Google's Calendar API at
  `https://www.googleapis.com` and Google's token revocation at `https://oauth2.googleapis.com`; requests carry the
  access token Chrome gives Glaze, never cookies, and never follow a redirect. There is no Glaze server.
  - **Connect** (your click in Glaze's settings): Chrome asks for the `identity` permission and shows Google's own
    sign-in and consent for one scope, `https://www.googleapis.com/auth/calendar.app.created` ("make secondary Google
    calendars, and see, create, change and delete events on them"). With it Glaze can't see or change your other
    calendars, nor list them. Chrome talks to Google for the sign-in itself. Glaze then creates one calendar named
    Glaze, with your time zone. **Link another device** opens that same calendar by its ID instead of making one.
  - **Sync**: a Canvas or Blackboard page works out what Export calendar (.ics) would save, with the same choices, and Glaze sends
    Google what changed: for each event its title (an assignment, task, plan or class name), the course name, your
    task's notes, its date or time, the class's room, and the link back to the item on your Canvas or Blackboard site. No
    reminders, and the events show you as free. Glaze also reads back changes made in Google Calendar to the events
    in the Glaze calendar: an edited deadline is written over; a deleted one stays deleted; a "do on" day or focus
    session you move or delete there moves or clears that plan in Better To Do. It runs when a Canvas or Blackboard
    page opens if the last sync was 15 minutes ago or more, every 15 minutes while such a page stays open, and 10 seconds
    after your Better To Do data, class schedule or export choices change. Nothing runs with no Canvas or Blackboard
    page open; a Blackboard page reads what's due as described above.
  - **Disconnect**: if you choose, Glaze deletes the Glaze calendar first; then it asks Google to revoke Glaze's
    access (the token goes in the request body), has Chrome forget its tokens, removes the `identity` permission and
    deletes what it stored. You can also remove Glaze's access at https://myaccount.google.com/connections.
  - Uninstalling Glaze deletes what it stored on the device but doesn't revoke Google's access by itself:
    disconnect first, or remove it at https://myaccount.google.com/connections.
  - Edge, Brave, Safari and Firefox don't offer it; Export calendar (.ics) works everywhere.
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
- **Syllabus import** (Canvas, off by default). On a course's home and Syllabus page, Glaze asks your own Canvas site
  for your profile (your user id) and course list (the course's term start, for dates written without a year), the
  same read-only requests Better To Do makes. It reads the Syllabus page from the page already open, with no request
  of its own, and reads files you pick on this device. Nothing about the syllabus is sent anywhere: there is no server
  to parse it and no consent box to tick, because nothing leaves your computer. It never writes to Canvas.
- **PDFs and photos you import** (class schedule, syllabus, transcript): none. A PDF or picture you pick or paste is read
  on your device by Glaze's reader, a page of the extension that the import opens in a hidden frame for that one file:
  pdf.js reads a PDF's text, and the OCR engine reads a picture or a scanned page, both from the extension's own files.
  The reader's own policy lets it load nothing but Glaze's files, so it can't send anything anywhere; it keeps nothing,
  and the frame is removed (its work stopped, its memory freed) when the read ends or you close the dialog. Only the
  fields you review and save are kept, as above; the file never is. Like everything Glaze shows on a page, the text read
  appears in the review on the LMS page, where that page's own code could read it.
- **Class schedule** (Canvas). Opening it asks your own Canvas site for your profile and course list (as Better To
  Do does), to match classes to your courses. A file you choose or text you paste is read on your device and never
  uploaded. A calendar link is read only when it is an address on the Canvas site you're on (your own calendar feed,
  say), with your existing session; a link anywhere else is refused before any request, and Glaze asks you to download
  the file instead. Showing your classes in the agenda uses what you saved and asks nothing more. With only class
  reminders on, the reminders ask your Canvas site for your profile (for your time zone) and course list, as above, and
  never for your planner items.
- **Gradescope in To Do** (off by default). Gradescope has no API for students, so Glaze reads your Gradescope course
  pages, signed in as you, and nothing else of Gradescope's. While the switch is on and Glaze itself is on, and only then, Glaze runs on
  `https://www.gradescope.com` pages. When there's something to read or ask, it first reads your account page
  (`https://www.gradescope.com/account/edit`, for whose data it is: your name and email address, of which only the name
  and a hash of the address are kept). Each time you open a Gradescope page, it reads again every course you've placed
  with a Canvas course and that wasn't read in the last ten minutes, asking again before each one whether Glaze and the
  switch are still on: the page you're on if it's that course's, else
  `https://www.gradescope.com/courses/<id>` (a read-only GET from that page, with your existing Gradescope session).
  With "Also check Gradescope once a day from Canvas or Blackboard" on (off by default), a Canvas or Blackboard page
  showing your To Do, card tasks or reminders, for an account there that said yes, also has Glaze's background worker GET each of that site's placed
  courses' Gradescope page and your account page (to check it's still the same account), at most once a day per course, whether or not it worked (signed out, Gradescope redirects to its sign-in page; Glaze never
  follows a redirect from Gradescope, here or on Gradescope's own pages, and keeps what it read before); the request carries your Gradescope cookies, as visiting the page would, and the page is read on the Canvas
  page and kept on this device as above. Nothing read on Gradescope is sent to Canvas or anywhere else, and Glaze never
  writes to Gradescope. To suggest a Canvas course on Gradescope, Glaze uses the course names it already keeps on this
  device (above); the bar on Gradescope sits in a closed shadow root, so Gradescope's own scripts can't read that list.
- **Ticking off in Canvas** (Better To Do's "Tick off in Canvas too", off by default). This is the only change Glaze
  makes to any site. When you tick or untick an item, Glaze writes Canvas's own planner mark for it, as Canvas's List
  View checkbox does: one request to your own Canvas site (`POST /api/v1/planner/overrides`, or `PUT` to the mark
  that already exists) with the item's type and id, your user id and done or not done, and the page's own CSRF token.
  Nothing is written at any other time, and nothing else is written. If Canvas refuses, the tick goes back and the
  list says so. Off, ticks stay on this device.
- **Dashboard notes and widgets** (Canvas, off by default). They ask your own Canvas site for your profile (user id
  and time zone; one request a page, shared with the other extras). The agenda uses Better To Do's copy of your planner
  items when that covers the day shown and is under ten minutes old; otherwise it asks your own Canvas site for that one
  day's planner items, a read-only GET, at most every two minutes per day you look at. Nothing is written to Canvas.
  On Blackboard Ultra they sit in a panel on the Courses page and ask your own Ultra site for who is signed in
  (`/users/me`, shared with the other extras) and, for a day the agenda shows, that day's To Do and calendar items with
  your submissions for the courses that have something due (read-only GETs through Glaze's Ultra reader, never
  following a redirect), at most every two minutes per day. Nothing is written to Blackboard.
- **Notes** (Canvas, off by default). Glaze uses your profile and course list (as the other extras do). When you choose
  **Canvas link** in a note, it lists one course's files, pages or modules with their items from your own Canvas site:
  read-only GETs with your existing session, the next page asked for only on your own site, never following a redirect,
  and stopped when you close the picker or the view. Only the link and title you pick go in the note. Opening a note
  loads nothing from anywhere: a picture from another site, pasted into a note, becomes a link to it instead. Links in
  notes open in a new tab without telling the site where you came from. Nothing about your notes is sent anywhere.
  On Blackboard Ultra, it asks your own Ultra site who is signed in and for your course list, and **Blackboard link**
  lists a course's content items you can open now from Blackboard's public contents API (each kept to its title, folder and link):
  read-only GETs that never follow a redirect and stop when you close the picker. Only the link and title you pick go
  in the note. Glaze also keeps the address of each Ultra site it has started on (storage.local `ultra`), so only those
  sites' pages may save notes, Better To Do's tasks and plans, reminders and class schedules.
- **Music widget** (Canvas, off by default). Glaze contacts no music service until you press **Load player**, on each
  page. Then your browser loads that service's player inside the widget, from **Spotify** (`open.spotify.com`),
  **YouTube** or **YouTube Music** (both from `www.youtube-nocookie.com`, YouTube's privacy-enhanced mode) or **Apple
  Music** (`embed.music.apple.com`), and that service works as it does on any site that embeds its player: it sees
  what you play, your IP address and its own cookies, under its own privacy policy. Spotify and Apple Music get no
  referrer; YouTube's player won't play without one, so it gets your Canvas site's origin (`https://` and the host
  name, no page path). The player's address is built by Glaze from the parts of your link it checked (a track,
  album, playlist or video id); your link is not sent anywhere else. Glaze has no analytics, so nobody else learns
  what you listen to.
- **On Moodle.** At most every ten minutes, Glaze asks your own Moodle site for the activities due in the
  next seven days, with the same request Moodle's own Timeline block makes (`core_calendar_get_action_events_by_timesort`
  through Moodle's `/lib/ajax/service.php`, with your existing session and the page's own session key), and keeps
  them as the due list above. At most every ten minutes for each Moodle site (at once for one whose courses it
  doesn't know yet), it asks for your courses, the same request as Moodle's Course overview block
  (`core_course_get_enrolled_courses_by_timeline_classification`), and keeps each one's name and colour as your
  courses above, so the editor, the course menu, the tint and the course cards know them. When you open the command palette, it asks
  for your courses in progress with the same request. On
  the Dashboard and My courses, with Grades on course cards on, it loads your grades overview page
  (`/grade/report/overview/index.php`), as you would see it, once per page, to read each course's total. These are
  read-only: Moodle sends its service calls as POST requests, and these two only read. They go only to the Moodle
  site you are on. Only the due list and your courses are stored; the other answers stay in memory. The keyboard
  shortcuts, a course's tint and Look, and the course menu ask Moodle for nothing. Moodle may log that the grades
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
  own Blackboard site for the folder's contents (the same way folder previews do, leaving out tool
  credentials), and for a file item, its file through Blackboard's public content address. It then fetches the
  files in items you've already opened from that site, which hands them over from Blackboard's own file
  storage, as when you open them yourself. The zip is made in your browser and saved to your device. Nothing is sent
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

The extension's own links are opened only when you click them: the footer link to the project's GitHub page, "Open the
gallery" in the editor (see below), and **Report a problem** (the editor, and What Glaze can do on Canvas), which opens a
new issue on `github.com/frostdev-ops/glaze` with your Glaze version, browser, system and language filled in, and nothing
about your school. That text is part of the link, so GitHub receives it when the page opens, with ordinary connection
information; nothing is posted until you submit the issue yourself, and you can change or delete any of it first. Web addresses in
your Dashboard notes are links too, opened in a new tab without telling the site where you came from.

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

- `storage` — to save the settings, GPA choices, past terms and goal, the Insights summary, course names, places, what-if scores, due list, Better To Do's tasks and plans, your class schedule, reminder and streak state, marks on documents,
  typed-text backups, Looks history and favorites, Dashboard notes and widgets, the notes app's index, Google Calendar sync's state, and Safari update-check timestamp described above.
  Notes' text, pictures and attachments are in the extension's own IndexedDB.
- No permission for reading PDFs and photos. The extension's own pages may compile WebAssembly (`'wasm-unsafe-eval'` in
  its content security policy), which the OCR engine needs; it still runs only code that ships in the package, and
  never in the LMS page. The reader page is web-accessible so an import can open it in a frame; it reads a file only
  with a one-use pass that Glaze's import gets from its own background worker, so a site that framed it itself can't
  make it read anything.
- `identity` (Chrome only, optional) — asked for only when you press Connect in Google Calendar sync, and removed on
  Disconnect. It lets Chrome sign Glaze in to Google Calendar with the Google account in your browser; Chrome shows no
  warning for it. Glaze never asks for `identity.email` and never sees your password.
- `unlimitedStorage` — so the browser never clears your notes, pictures and attachments to free space. Nothing more is
  stored or sent because of it; Chrome shows no warning for it.
- `nativeMessaging` (Safari only) — to ask the containing Mac app to check for updates. The App Store
  apps ignore this request. Chrome does not request this permission.
- Host access to `https://*/ultra/*` — to apply the theme on Blackboard Ultra pages. Blackboard Ultra is
  self-hosted per institution on arbitrary domains, always under the `/ultra/` path, so the match
  pattern cannot name a fixed host. Glaze reads and restyles the page in your browser only.
- Host access to `https://*.instructure.com/*` — to apply the theme on Canvas, which Instructure hosts
  for most schools under that domain, and in Canvas's document viewer on `canvadocs.instructure.com`, where a
  separate small script applies the palette and, if you switch them on, your marks on documents.
- Host access to `https://*/*` and `scripting` — Canvas also runs on schools' own domains, and Moodle always does.
  The check described above runs on https pages for that reason; when it finds Canvas or Moodle, Glaze styles that
  site, and only that site, the same way. The hostname is kept in the extension's local storage on your device.
  The same host access lets the gallery script above run on `https://frostdev.io/glaze/looks`, and, only while
  "Gradescope in To Do" is on, Glaze's Gradescope script run on `https://www.gradescope.com` and its background worker
  read Gradescope course pages; neither adds a permission. It also covers Google Calendar sync's requests to
  `www.googleapis.com` and `oauth2.googleapis.com`.

## Google user data

Glaze's use and transfer of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including
the Limited Use requirements. Glaze uses Google Calendar access only to keep the Glaze calendar in step with your
Canvas work, as described above. It doesn't sell, share or use this data for advertising or to train AI models, no
person reads it, and none of it goes to frostdev or anyone else.

## Hosting

The Chrome Web Store requires a publicly hosted privacy policy URL. This document is served from the
project's GitHub repository at
`https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md`.

## Contact

admin@frostdev.io
