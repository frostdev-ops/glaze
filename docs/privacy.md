# Privacy summary

A plain-language summary. The full policy is [PRIVACY.md](../PRIVACY.md).

Optional [encrypted sharing](../PRIVACY.md#optional-encrypted-share-sessions) encrypts selected content on your device before sending it to your chosen relay. The relay receives ciphertext and connection metadata, including your IP address; recipients can retain their own copies. Sharing starts only after you choose Create, Join or Resume in Glaze.

User-installed [mods](../PRIVACY.md#user-installed-mods) can read course data only with declared and granted permissions. On Chrome, code with access to personal data runs in a Worker; a mod granted both data and network access can send that data to its approved hosts. Firefox and Safari use declarative parts only.

On Chrome, the optional [signed mod blocklist](../PRIVACY.md#signed-mod-blocklist) makes a credential-free request at most daily when Glaze and the setting are on and a code mod is installed. Failed checks retry after an hour. Declarative-only mods, Firefox and Safari do not make this request.

Private backups of settings and notes ZIPs include share keys and creator delete tokens for all sessions, even paused ones. Keep these backups private: the keys grant access to shared content. Single-note exports do not contain session keys. See [sharing and backups](../PRIVACY.md#optional-encrypted-share-sessions).

Glaze stores your settings in `chrome.storage.sync`, including the course nicknames, colours, looks and tint
you set in a course's menu. These follow Chrome sync when it's on; Safari keeps them on this device only.
It keeps the course names your LMS lists, which grades and course
items you've seen and a backup of what you type in Blackboard's editors (until it's posted, 14 days at most) on your own
device. On Canvas it also keeps course names, codes and colors, unread-grade counts, module-item ids and your place,
with site and account identifiers for badge records, and the what-if scores and pretend assignments you enter per site,
account and course. On Blackboard it keeps the what-if scores and pretend assignments you enter, past terms and a GPA goal, a syllabus you import and an Insights summary the same way, per site and account. Your GPA choices per course (credits, level, scale) sync with your settings. Supported new Inbox drafts keep the body, subject and destination
identifiers locally for up to 14 days. Your Looks history (the last 20 themes) and favorites stay on your device too,
as do your stickers, your own sticker and pointer pictures and Look rotation's list;
the Looks gallery is a website you visit yourself, and Glaze sends it nothing. Canvas's own what-if scores and editor recovery remain with Canvas.
Better To Do's own tasks and plans stay on your device too, with a two-minute copy of your Canvas planner items or Blackboard due items.
A calendar file you export (.ics) is made on your device and saved by your browser; it holds your course and assignment names, and Glaze keeps no copy.
With Google Calendar sync connected (Chrome, off until you connect), Glaze sends the same events to the Glaze calendar in your Google account and reads back changes to them there, directly between your browser and Google (`www.googleapis.com`, and `oauth2.googleapis.com` to revoke access on Disconnect); Chrome keeps the sign-in.
Dashboard notes, the widgets' layout, the timer and the music link you type stay on your device. So do the notes app's notes, folders, pictures and attachments, in Glaze's own storage (not the school page's); its Canvas link picker reads your own Canvas site, and only a link and title are kept. A music widget contacts its
player (Spotify, YouTube through youtube-nocookie.com, Apple Music) only after you press Load player.
Your class schedule stays on your device: the file, page or text you import is read there and never uploaded, and a calendar link is read only when it is on your own Canvas or Blackboard site.
Course tabs show an automatic short name by default, with common term/section wrappers removed and subject codes spaced. A nickname wins; full-name and code choices remain available, and the original name and code stay in the tooltip and accessible name. Tabs keep your list (each course's id and original name, where you were in it, pinned or not) on your device, per site and account; routed page and scroll changes are saved only after native content establishes the destination. The blurred JPEG pictures shown during first load can include any visible content on the Blackboard tab and stay in memory only (the page, and the browser's session storage in Glaze's background worker), are never written to disk, and are dropped when the browser closes, when you turn the tabs or Glaze off, or when another account signs in.
Reminders, what you've snoozed or muted and your streak stay on your device as well, and so do your marks on documents; reminders show only inside Canvas and Blackboard pages, and Glaze has no notifications permission.
With Gradescope in To Do on, Glaze reads your own Gradescope course pages (read-only, signed in as you) and keeps the assignments on your device; nothing from Gradescope goes anywhere else.
It has no analytics. Glaze's writes anywhere are opt-in: with Better To Do's "Tick off in Canvas too" on, ticking an item
marks it done or not done in your own Canvas planner, as Canvas's List View does, and with Google Calendar sync connected it writes to the one calendar it made in your Google account. Apart from the optional sharing and mods described above, the extension's other requests are read-only and go to your own Blackboard, Canvas or Moodle site
(folder previews; a folder's files when you click Download all; your grades and submission status for due dates, new-grade badges, the calculator and
your overall grade on course cards; on Canvas a course's assignment groups when you use its what-if calculator;
on Blackboard each course's grading schemas for the GPA, a course's grade categories when its what-if needs their names, this term's
gradebooks with your submission status for Insights, and a course's documents when you import a syllabus from one;
your course list and a course's items for the command palette and new-content badges; on Canvas, what you type in the command palette, to search your courses' titles), to Google Fonts or jsDelivr for a web
font you choose, and to a background image, video or animation, course card picture or sidebar picture you choose. For Canvas Download all, the extension's background worker
fetches signed file links from your school's file host without cookies. Links and file bytes stay in memory while
Glaze makes the zip; they are not saved in extension storage. Blackboard's course content answers can include a course tool's launch credentials: Glaze asks for them to be left out and never keeps them. The downloaded Mac app also checks
`https://frostdev.io/projects/glaze/appcast.xml` about once a day and downloads updates from GitHub,
with system profiling disabled. These services receive ordinary network requests, including your IP
address. See [PRIVACY.md](../PRIVACY.md).
