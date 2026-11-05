# Privacy summary

_Last updated: 2026-11-01_

A plain-language summary. The full policy is [PRIVACY.md](../PRIVACY.md).

Optional [encrypted sharing](../PRIVACY.md#optional-encrypted-share-sessions) encrypts selected content on your device before sending it to your chosen relay. The relay receives ciphertext and connection metadata, including your IP address; recipients can retain their own copies. Sharing starts only after you choose Create, Join or Resume in Glaze. On the default relay, a share nobody has used for two years is deleted (one year if its creator chose that), a share never written to is removed after two unused days, and each client has a daily limit on new stored data; the creator can delete a share at any time, and editors' devices delete files a share no longer uses.

User-installed [mods](../PRIVACY.md#user-installed-mods) can read course data only with declared and granted permissions. Removing a mod also removes the data it stored, unless you untick **Remove its stored data too**. On Chrome, code with access to personal data runs in a Worker; a mod granted both data and network access can send that data to its approved hosts. Firefox and Safari use declarative parts only.
The `nav.read` permission is personal-data access too: it reads the bar's items, course names, unread counts and navigation events, without link addresses, and disables the mod's frame UI. `nav.items` lets a mod manage up to eight items of its own with school-origin links or click actions; `nav.layout` proposes a layout while it runs. Use my own keeps that mod's layouts off locally. An enabled replacement can use `glaze.nav.go` to open an existing bar item only within a second of a click in its navigation controls.
`documents` lets a mod's Worker on the Documents page, in its own tab, read your documents' titles, courses and word counts and add items of its own there; `documents.read` adds their text and exported files. Both are personal data, Worker only, and only once you grant them. A mod sees random handles of its own for your documents, never their storage keys.

On Chrome, the optional [signed mod blocklist](../PRIVACY.md#signed-mod-blocklist) makes a credential-free request at most daily when Glaze and the setting are on and a code mod is installed. Failed checks retry after an hour. Declarative-only mods, Firefox and Safari do not make this request.

Settings backups omit kept background file bytes. On the same computer an existing file can be reused; on another device,
or if the file is missing, its background becomes a gradient. Keep the original files separately. Older browsers without
storage key listing cannot reset unknown legacy media until it is discovered; current and discoverable media are removed,
while stickers and other local data stay.

Backups (**Back up…**, and older settings files and notes ZIPs) include share keys and creator delete tokens for all sessions, even paused ones. Keep these backups private: the keys grant access to shared content. Single-note exports do not contain session keys. See [sharing and backups](../PRIVACY.md#optional-encrypted-share-sessions).

[Glaze Writer](../PRIVACY.md#what-glaze-stores) (Blackboard Ultra) keeps your papers and the documents on its Documents
page, their versions and your format presets, your personal dictionary and the sources you save in `chrome.storage.local`
on this device, with no server; **Back up…** includes them. Documents' Trash keeps a deleted paper or document for 30
days, then deletes it. A document goes to your own Google Drive only when you connect Drive and choose Save to Drive,
or while Sync to Google Drive is on. The Documents page loads a web font your Look uses from Google Fonts or jsDelivr, as Settings does. Discussion,
message and test boxes keep their drafts through Back up what you type when it is on, as Blackboard's own editor does. Spelling and
grammar are checked on your device. Writer reads the prompt, thread and rubric from your own Blackboard site, read-only,
and sends nothing to Blackboard itself: your words reach it only when you press Blackboard's own Post, Reply, Send or
Submit (an assignment's compact box puts its text in Blackboard's text box; with Full writer the submit sheet attaches
your paper's .docx through Blackboard's upload and clicks its Submit). A citation
lookup goes out only when you click Look up: a DOI to `doi.org` (or Crossref and DataCite), an ISBN to
`openlibrary.org`, a web address to that page's own host once you allow it. AI runs only for what you turn on in
Settings → AI, to the model you chose for it: Tab completion sends the text around the caret, the course, prompt
or assignment, and in a discussion your classmates' posts with their names; Feedback sends your draft with the
assignment's instructions and rubric. Nothing goes to AI from a test.

[Rime](../PRIVACY.md#network-requests), Glaze's own model (Frostdev's, built on LFM3-1.7B; Chrome and
Firefox), downloads from `huggingface.co` and its CDN only when you click Download in Settings → AI, and nothing about
you goes with it. It then runs on this device, so what you give it stays there. Glaze comes without Rime: until a Rime
model is offered, opening Rime's card in Settings → AI asks `huggingface.co` for the signed list of Rime models, at most
once a day and never with Data Saver on; nothing about you is sent. While it is downloaded, Glaze checks
`huggingface.co` for a signed list of Rime models about once a day and downloads updates from there and its CDN; nothing
about you is sent. **Update automatically** in the card's Advanced section turns that off.

[Ask Rime](../PRIVACY.md#ask-rime) (Settings → AI → Ask Rime, off by default) sends your question, and your work when
you add it, to the model you chose for it. For a question about your own courses it also sends what Glaze reads to
answer it: your to-dos, schedule, grades, assignments or Writer documents, as Glaze already keeps them on this device,
and a course's announcements, content, syllabus and discussions. From a discussion it sends the prompt and your own
replies, and only the number of your classmates' replies, never their names or posts.
Marking a to-do done waits for your OK in Glaze's window. The conversation itself is temporary. With Memory on, Ask Rime
can keep useful preferences and facts from your messages as editable Markdown records and retain excerpts from course
material it has read. Relevant records can be sent with later questions to your chosen model. **Settings → AI → Memory**
lets you turn this off, view, edit, delete, clear and export records, even while AI is off. Turning it off keeps existing
records. Saved memories join Glaze backups and existing Google Drive sync when enabled; the course cache and search
index stay on this device. Records are separated by school account and have no timed expiry. Deletion removes active
content and keeps a small marker against restoration; earlier exported/backed-up copies and an open conversation remain
separate. A reminder or watch you approve is kept on this device until shown or cancelled.

[Agent access](../PRIVACY.md#agent-access) (Settings → AI → Agents) is off by default. Apps on this computer connect
through a local helper: `glaze-mcp`, or the downloaded Glaze Mac app on Safari. Glaze asks you to allow each app
identity and data group: Courses, to-dos and schedule; Grades; Assignments and rubrics; Writer documents; each mod's
tools. App names are self-reported, and program identities can be too. Every built-in change and every call to a
mod's code tool waits for your OK in Glaze's window. Built-in agent tools never submit work. A mod's code tool can send
the app's arguments and data the mod may read to its approved hosts. Agent access sends no data to FrostDev; the app may
send what it gets to its own AI service, under that app's own policy.

Glaze keeps app identities, grants and declines, the switch and profile id locally without a timed expiry, the last 200
calls' metadata (never their content), and the 100 assignment reads used last. Session-only approval records can include
document text in action summaries; records no longer waiting become eligible for cleanup an hour after creation, on
later requests or agent-worker startup, and may remain until session end. Turn off cancels waiting requests and clears
assignment reads, keeping apps and grants; a change already started can finish. Revoke forgets one app; Forget all apps
clears the activity list and assignment reads and forgets all apps, grants and declines. Removing a site clears its
assignment reads; Reset everything clears all assignment reads, keeping the switch, apps, grants and activity. None of
these erases copies an app kept. On Firefox, turning agent access on also asks to share website content, which turning
it off gives back.

Glaze stores your settings in `chrome.storage.sync`, including the course nicknames, colours, looks and tint
you set in a course's menu. These follow Chrome sync (or Firefox Sync) when it's on; Safari keeps them on this device only.

Canvas on instructure.com, Blackboard on blackboard.com and Moodle on moodlecloud.com are automatic. A school's own
site needs your yes first: on Chrome, Edge and Firefox the popup checks the page, while an address added in the first-run
tab or Settings is checked through the site's APIs after access is granted. Browser-menu grants are checked too; a failed
check leaves that access unused. With All sites, in Safari and on installs from before 3.4.0, Glaze asks on unapproved
course sites (**Use Glaze on example.edu?**) before theming them, reading their APIs or keeping course data. **Settings →
Privacy and data → Sites** lists your sites, with Remove, which also forgets the courses and due dates Glaze read there.
See [Adding a school's own site](../PRIVACY.md#adding-a-schools-own-site).

Pearson MyLab homework is themed on `mylab.pearson.com` and its player frames on `tdx.acs.pearson.com`.
Pearson inside Blackboard is on by default and can be switched off under Course pages → Documents and quizzes.
The exact `socket.pearsoned.com/uiservice/opener` launcher opens Pearson's own content in a child frame. Glaze forwards
only resolved appearance variables into that frame and its known homework children. The canonical homework address
and selected question number stay in memory to support Open in tab; launch tokens and unrelated URL parameters are
excluded. During sign-in, Open in tab starts a fresh native Blackboard launch. Glaze does not store these locations,
copy authentication credentials, change browser security policies, or send homework information to a new service.
The problem viewer keeps the native question and answer nodes and changes their layout. Its Settings switch syncs;
the page's layout switch is temporary. A Glaze frame draws the saved Look's background through the existing media
and file checks. Modern equations read each native formula's LaTeX locally. When you open the optional equation editor,
it reads that field's current answer into an extension-owned frame; typing and validation leave the original answer intact.
Use equation transfers a supported expression back through Pearson's native editor. These math values stay in memory
in your browser; they are not stored or sent to a math service or AI provider. Glaze does not invoke Check answer, Save
or submission actions, read scores or course data, or make Pearson API requests. Pearson handles the edit normally.
Other Pearson pages and test mode
keep their native appearance.

The sidebar's title, style, page choices and other general settings sync too. Its width, open/fold state, To Do scope,
dock order/heights, widget destinations and migration markers stay in local records keyed by LMS, school origin and
account id. The page's shared account reader gets Canvas's profile id or Ultra's me id from your own school session.
Reset sidebar for this account resets its presentation but keeps widget destinations, order and data. The LMS's own
side column, Ultra's Grades / Attempts, attempt Details & Information and submission Rubric stay in place; the sidebar saves
none of their text or grades and makes no panel request. Docked widgets use their existing data stores.

New installs get pet, timer, notes and quote tiles, course cards once listed, and To Do/settings in the first sidebar;
notes and pets start on unless a saved preference says otherwise. The install flag and starter layout stay local.
Edited switches sync, as do `starterOff:*` choices that keep removed defaults from returning. Those keys can include
school origin and course id, or the sidebar's account id; those identifiers can therefore leave the device through
browser sync, although the sidebar record does not.

Glaze keeps the course names your LMS lists and records of which grades and course items you've seen on your own device.
Backups of what you type in Blackboard's editors are kept per school site and signed-in student (until posted, 14 days
at most): Ultra asks your own Blackboard site who you are for this, and older copies stay
beside new text until you restore or dismiss them (three at most), and copies saved by earlier versions without a site or
account are never offered and are removed by cleanup. On Canvas it also keeps course names, codes and colors, unread-grade counts, module-item ids and your place,
with site and account identifiers for badge records, and the what-if scores and pretend assignments you enter per site,
account and course. On Blackboard it keeps the what-if scores and pretend assignments you enter, past terms and a GPA goal, a syllabus you import and an Insights summary the same way, per site and account. Your GPA choices per course (credits, level, scale) sync with your settings. Supported new Inbox drafts keep the body, subject and destination
identifiers locally for up to 14 days. With Back up what you type on, an unfinished sidebar To Do form (title, course,
date/time, notes and edited task identifiers/state) can also be backed up locally per school/account when hidden or
left, until restored or cleaned up after 14 days; without backup it stays in document memory. Your Looks history (the last 20 themes) and favorites stay on your device too,
as do your stickers, your own sticker and pointer pictures and Look rotation's list;
the Looks gallery is a website you visit yourself; Glaze asks it only for the one background file or mod you choose there, when you click to use it (see [The Looks gallery](../PRIVACY.md#the-looks-gallery)). Canvas's own what-if scores and editor recovery remain with Canvas.
Better To Do's own tasks and plans stay on your device too, with a two-minute copy of your Canvas planner items or Blackboard due items.
A calendar file you export (.ics) is made on your device and saved by your browser; it holds your course and assignment names, and Glaze keeps no copy.
Google Calendar sync (Chrome and Safari, off until you connect) sends the same events to the Glaze calendar in your Google account and reads changes there, directly between your browser and Google (`www.googleapis.com`), with one scope, `calendar.app.created`, which can't see your other calendars. Chrome keeps the sign-in; Safari signs in through the Glaze app, with a grant apart from Drive's, and the Glaze extension keeps its refresh token in its own Keychain items on this device; Glaze keeps the calendar's ID, your account's address and what it wrote (`gcal`, `gcalSync`) on this device, and **Disconnect** deletes them on this device only, with Chrome's sign-in permission unless Google Drive is connected here; Google keeps Glaze's access for your other devices until you remove it at https://myaccount.google.com/connections. Calendar file export works without connecting Google.
Google Drive (Chrome, Edge, Brave, Firefox and Safari, off until you connect): Connect in Settings asks Google for `drive.file`, `openid` and `email`: Glaze can reach only the Drive files it creates or the ones you pick, and the email shows which account is connected. Open from Drive, Save to Drive (a file edited outside Glaze is never overwritten: Save writes a new one beside it), Sync to Google Drive (on once you connect, off in Settings: a Glaze folder in your Drive kept in step with this device, holding each document's file and JSON copy, a file per setting and per record (tasks, Notes with their pictures and attachments, Gradescope's placings and the rest of what Back up… covers), and a daily Back up… zip without documents' files, the newest five kept; a file over 5 MB goes up or comes in in pieces, waiting between runs in Glaze's own IndexedDB `glaze-drive`, and a document or record too large for that (a JSON copy over 64 MB, a record over 32 MB) stays on this device; never share keys (each share's end-to-end keys), AI keys, Agents pairing, sign-in records or what Glaze read from your school; changed on both sides, both are kept or the later change wins (for Notes, field by field); deleting follows Glaze's Trash, and no Drive file is deleted for good except Glaze's own daily zips past the newest five) and Submit from Drive go directly between your browser and Google (`accounts.google.com`, `openidconnect.googleapis.com` and `www.googleapis.com`). To pick a file, Glaze opens a static page, `https://frostdev.io/glaze/drive-picker/` or its copy `https://frostdev-ops.github.io/glaze-drive-picker/`, that loads Google's Picker; the token reaches it in the address's fragment, which browsers don't send to servers, so those hosts see only an ordinary page request. Glaze stores the connected account's email, Google account id, sign-in flow and time in extension storage. Chrome keeps access tokens in its sign-in cache; Edge, Brave and Firefox hold them only in background worker memory. Safari signs in through the Glaze app: the extension keeps Drive's refresh token in its own Keychain items on this device, holds access tokens only in memory, and reaches `oauth2.googleapis.com` from Safari to exchange the sign-in code and renew access tokens; its picker opens in a tab and comes back to a Glaze page, which hands the file ids, names and types to the background worker and closes. Disconnect forgets the sign-in on this device only: Google keeps Glaze's access, so Drive and Calendar on your other devices keep working, until you remove Glaze at https://myaccount.google.com/connections. Nothing goes to Frostdev. Glaze's use of Google data adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.
Dashboard notes, the widgets' layout, the timer and the music link you type stay on your device. So do the notes app's notes, folders, pictures and attachments, in Glaze's own storage (not the school page's); its Canvas link picker reads your own Canvas site, and only a link and title are kept. A music widget contacts its
player (Spotify, YouTube through youtube-nocookie.com, Apple Music) only after you press Load player.

Course-card widgets keep course ids, school origins, term labels and layout choices locally, reusing existing course,
grade, badge and planner readers. Displaying a native Canvas card picture can load it from its host. Canvas also keeps
its course-list/color answers, including scores, enrollments and your id, in the school's tab session storage. The copy
is reused for less than a minute after checking the account; it can remain until the tab closes and the school page
can read it. The settings session copy in the school tab holds only what the first paint shows, with no course names or nicknames, picture or link addresses, sidebar title or review choices.

Document review reads the submitted-work page's structure, title, grade/feedback/rubric elements and viewer address
to arrange the existing view. It saves no document or grade content and makes no request to the viewer's origin.
Its preferences sync; optional Remember focus (off by default) keeps only a focus flag keyed by the submission page
path in the school's tab session storage. The frame relay carries only bar visibility controls, checks origin and
sending window, and accepts review requests only from the current visible same-account frame. Full screen uses the
browser's own Fullscreen API on the existing viewer or its container.

Your class schedule stays on your device: the file, page or text you import is read there and never uploaded, and a calendar link is read only when it is on your own Canvas or Blackboard site.
Course tabs show an automatic short name by default, with common term/section wrappers removed and subject codes spaced. A nickname wins; full-name and code choices remain available, and the original name and code stay in the tooltip and accessible name. Tabs keep your list (each course's id and original name, where you were in it, pinned or not) on your device, per site and account; routed page and scroll changes are saved only after native content establishes the destination. Canvas's live frames also retain earlier pages' content and forms in memory; native scripts and requests can continue while hidden. Returning to a clean retained page can reload it from your school, and a link press can start loading before the click completes. Back/Forward history state holds frame/course ids and page URLs. The blurred stand-in shown during first load is drawn from a sketch of the page (its boxes and colours, with no text but the course's name and no images), not a picture of it. Sketches stay in memory only (the page and `chrome.storage.session` in Glaze's worker), are never written to disk, and are dropped when the browser closes, when you turn the tabs or Glaze off, or when another account signs in.
Reminders, what you've snoozed or muted and your streak stay on your device as well, and so do your marks on documents; reminders show only inside Canvas and Blackboard pages, and Glaze has no notifications permission.
With Gradescope in To Do on, Glaze reads your own Gradescope course pages (read-only, signed in as you) and keeps the assignments on your device; nothing from Gradescope goes anywhere else.
It has no analytics. Glaze's writes anywhere are opt-in: with Better To Do's "Tick off in Canvas too" on, ticking an item
marks it done or not done in your own Canvas planner, as Canvas's List View does, and so does an agent app's mark done
once you allow it. Changing a course's nickname or color in its Canvas card menu saves that choice to your own Canvas site too, Sign out in Glaze's Canvas bar signs you out of Canvas as Canvas's own button does, and Moodle's Edit mode switch in Glaze's bar flips Moodle's own control. Apart from those clicks and the optional
sharing and mods described above, the extension's other requests are read-only and go to your own Blackboard, Canvas or Moodle site
(folder previews; a folder's files when you click Download all; your grades and submission status for due dates, new-grade badges, the calculator and
your overall grade on course cards; on Canvas a course's assignment groups when you use its what-if calculator;
on Blackboard each course's grading schemas for the GPA, a course's grade categories when its what-if needs their names, this term's
gradebooks with your submission status for Insights, and a course's documents and the files they link when you import a syllabus from one;
your course list and a course's items for the command palette and new-content badges; on Ultra, a fresh viewer address for a file preview that is still converting or whose ticket expired; on Canvas, what you type in the command palette, to search your courses' titles), to Google Fonts or jsDelivr for a web
font you choose, and to a background image, course card picture or sidebar picture you choose. A video, animated picture or
animation background is fetched by Glaze's background worker instead, with no cookies, referrer or redirects, within size limits
(12 MiB for a video, 6 MiB for a picture, 1 MiB for a Lottie animation; pictures and videos at most 4096 pixels on a side),
and handed to the page as a cleaned copy. Location, device, time, title and program details are removed from the file’s container;
the encoded stream and visible pixels remain, so this is not a forensic guarantee. New files whose containers cannot be cleaned
are refused. Files saved before 3.3.5 that cannot be cleaned stay on this device and are not shared.
Selected bulk reads share a queue per document and school site: three at a time, with a pause after a 429 or server error.
Separate tabs and frames have independent queues; identity, membership, due-date exception and other readers use their existing paths.
Ultra's queue honors Retry-After up to ten minutes; Canvas module-list failures use a fallback delay because their adapter does not expose that header. For Canvas Download all, the extension's background worker
fetches signed file links from your school's file host without cookies. Links and file bytes stay in memory while
Glaze makes the zip; they are not saved in extension storage. Blackboard's course content answers can include a course tool's launch credentials: Glaze asks for them to be left out and never keeps them. The downloaded Mac app also checks
`https://frostdev.io/projects/glaze/appcast.xml` about once a day and downloads updates from GitHub,
with system profiling disabled. These services receive ordinary network requests, including your IP
address. See [PRIVACY.md](../PRIVACY.md).
