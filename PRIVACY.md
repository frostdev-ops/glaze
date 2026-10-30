# Privacy Policy — Glaze

_Last updated: 2026-10-29_

## User-installed mods

Chrome can run JavaScript from mod bundles you choose to install, including author-signed channel updates.
Glaze does not fetch mod code to run automatically from us. Code runs in an isolated sandbox without extension APIs;
Firefox and Safari use declarative parts only. Courses, to-dos, grades and the navigation model require declared and granted permissions,
are scoped to the requesting school's origin and signed-in account, and reach only a DOM-less Worker. Brokered network requests require
a declared and granted exact HTTPS host, omit cookies and referrers, and refuse redirects. A mod granted both data
and network access can send that data to its granted hosts. A mod without data access may have a frame UI that can
contact other sites; linked Look media also contacts its chosen host. Those sites receive ordinary connection
information, including your IP address. Information rendered on a school page is visible as page content.

Installed bundles, grants, settings, per-mod storage, author trust pins and runtime stop status stay in device-local
extension storage. The optional mod-development tools also keep your author signing key there; protect exported
key backups. Removing a mod removes its installed bundle and editor settings and, by default, the data it stored, its
private-data classification, its navigation-layout switch and the note of why it was stopped; untick **Remove its stored
data too** to keep those on this device for a reinstall. Its author/version trust pin remains until you explicitly clear it. Channel traffic and the optional signed blocklist are described below. Glaze adds no analytics
or default notifications for mods.

With **nav.read**, a mod can read Glaze's visible navigation items and course menu: ids, labels (including course
names and names you typed), icons, unread badges, groups, the active item and bar placement, plus events when the bar
changes, you navigate, expand or collapse it, or open or close its phone sheet. The model omits link addresses.
Glaze treats this as personal data, like courses, to-dos and grades: it reaches only the mod's Worker, disables its
frame UI, and keeps the private-data classification locally (until you remove the mod, unless you keep its data). A separately granted network host can
receive it. **nav.items** lets a mod add, update or remove up to eight items of its own, with labels, icons and badges;
links must stay on the school site's origin, or an item can send the mod an action when clicked. **nav.layout** lets
it propose a bar layout while it runs, without saving over yours. **Use my own** keeps that mod's layouts off in
device-local `modNavLayout:<id>` until you allow them again. `glaze.nav.go` lets an enabled replacement navigation
open an existing bar item, only from its Worker within a second of a click in its own navigation controls.

With **documents**, a mod's Worker runs on Writer's Documents page in a tab of its own (not when Documents opens as a page
of a school's site) and can read the titles, courses, formats, word counts
and last-edited times of the documents listed there, add up to four items of its own to the toolbar and to each card's
menu, and open or start a document right after a click on one of them. **documents.read** (which needs documents) adds
a document's text and its exported .docx. Glaze treats both as personal data, as above: Worker only, no frame UI, and a
separately granted network host can receive it. Document handles are random and scoped to this mod on this page; they do
not expose the school host or user identifiers stored in an assignment's internal key.

## Expanded habitats and local pet learning

The optional pet record stores habitat style, furniture placements, wandering/physics/learning switches, six 0–100 needs (mood, playfulness, energy, bond, curiosity and comfort), and a bounded local preference model. Twelve activities use twenty-six numeric inputs, online weights and confidence estimates, short/long preference estimates, aggregate time-of-day habits and action-transition counts. At most three recent action/context/timestamp records provide delayed feedback; they stop receiving credit after sixty seconds. Observations are limited to one per eight seconds across tabs. Older models migrate without discarding learned weights.

Petting, play, moving the pet away, habitat transitions, focus-timer changes and existing XP changes provide signals. Inputs include local time, needs, coarse visible element/furniture/toy categories, pointer proximity and speed, and whether typing or scrolling recently occurred. Pointer coordinates, keystrokes, typed content, page text and browsing history are not stored or uploaded. The companion uses limited visible element geometry to perch, hide and investigate, and normally stays settled. User-dropped toys invite a short play session. Pet and floating toy page coordinates last only for the current page; saved habitat placements remain in the account record. Page controls and coursework are never activated or edited. Navigation, forms, editable content, assessments and tool pages are excluded from wandering targets.

The learning switch stops using/updating learned preferences, and Reset learned behavior clears the model without clearing academic XP. Time away does not punish the pet or remove XP. Settings export/import now includes per-account pet progress, placements, needs and model state in the student’s chosen local backup file. It preserves current settled contributions when restoring older history. A bounded import baseline stores affected task IDs, completion timestamps, tick booleans and plan dates until those imported fields change; it stores no task titles or text. The pet record also keeps the last reconciled shared timer state so multiple tabs cannot repeat the same focus/break feedback. Imported pet image packages remain separate and are still excluded from settings backups. No pet history or learning state enters Look codes or share sessions.

## 3.0.1 surface settings and local pets

Surface appearance is part of the existing synced `look` settings and saved Look codes/history. It introduces no analytics, tracking, remote configuration or requests for school content. Frost is a bundled/generated local CSS texture. Custom fills may reduce contrast; check the live preview. Custom transparency is ignored over solid pages or without glass blur, and small rows gain no extra backdrop filters.

Pet animation adds no completion tracking or activity log. The existing per-site/account pet record keeps only the chosen character alongside its existing XP and habitat data. The bundled companions, including the owner-provided Rime and animated Glaze droplet, need no network service. Custom pets are imported only through Glaze’s extension-owned editor from explicitly chosen local files: PNG/WebP sheets, optional `pet.json`, or a bounded ZIP. Remote paths, scripts and metadata links are ignored; files are decoded, checked for supported dimensions/frame occupancy/transparency and re-encoded locally. Source input is capped at 20 MiB, normalized picture data at 2,000,000 characters each, and the local library at eight pets and 4,000,000 picture-data characters total; a failed read/write keeps the prior library. No file is executed or uploaded. The library is shared among this device’s habitats in `storage.local` under `petSprites`; it does not sync, enter Look codes or share sessions, and settings backups do not include the sprite library. Keep the original pet files as a backup. Removing an imported pet affects its artwork only; existing XP/decorations remain. Uninstalling or clearing extension storage removes imported artwork.

Glaze’s isolated content script displays the selected sprite on the LMS page; this does not upload the picture to the school. Its rendered pixels are visible like other page content; do not import a picture containing private material you would not display on that page. Animation stops on hidden/offscreen surfaces and follows reduced motion and Glaze Motion off. ChatGPT compatibility is a local file-format adapter, independent of OpenAI accounts and without a connection to ChatGPT.


Ultra performance changes reuse the page's existing gradebook reads and ignore internal Glaze UI mutations. They add
no stored fields, requests to other sites, or activity collection. The synthetic performance harness is development-only.
The shared JSON reader refuses redirects, including redirects to an external sign-in page. File/media downloads keep
their separate, existing URL handling.

## Signed mod blocklist

On Chrome, while Glaze and its synced blocklist setting are on and at least one installed mod contains code, Glaze
asks `https://frostdev.io/glaze/mods/api/blocklist` at most daily (failed attempts retry after an hour). This fixed GET
has no cookies, referrer, query string, request body or student identifiers. Declarative-only mods, Firefox and Safari
never cause this request. The signed list and check timestamps stay in device-local storage. Turning the setting off
stops checks; previously blocked mods stay blocked, including when the last verified list is out of date.

## Mod channels

A mod installed from a channel link is checked against that link's relay when the editor opens, on **Check now**, and
at most daily while a page runs it; **Stop following** or removing the mod ends this. An author's **Publish to a
channel** uploads the signed mod to their selected relay. Both are encrypted share-session requests without cookies,
referrer or student identifiers; the relay sees what it sees for any session (described below). The check state stays
in device-local storage. The edit key of a channel you publish (`modChannelOwn:<id>`) is kept in the `vault` store of
the worker-only `glaze-sharing` database, not in `storage.local`, where a page's script could read it; a backup does
not carry it. The install prompt and followed mod name the relay host. After publishing a newer version,
Glaze requests deletion of the previous bundle file, best effort; older relays without file deletion retain it until
session deletion or expiry. Recipients and operator backups may keep copies.

## Optional encrypted share sessions

Sharing is off on each device until a trusted Create, Join or Resume action in Glaze's settings or in the Notes share panel. That panel is an extension page framed inside the Notes view: the school page cannot read it, and it posts nothing to the page. Each opening gets a one-use ticket from the worker, bound to that tab, Notes account and note. It is delivered directly to the extension frame, never in a URL, and consumed by a runtime port. Closing, reloading or replacing the panel revokes that port; after a worker restart, close the panel and open Share again. The frame sits in a closed shadow root. The panel sees and acts on only that account's sessions. It can only list, create (that note), join, copy, leave or stop sessions; keys, backups and the relay setting stay in settings. Its action buttons require verified IntersectionObserver v2 visibility, full intersection and a stable button rectangle for at least half a second. Browsers without that protection keep the embedded actions disabled; use Glaze Settings for sharing there. Browser visibility observations are asynchronous, so native browser testing remains necessary for rapid parent-page layout changes. Glaze checks the selected origin's browser permission and requests it only if missing. Glaze's required access covers the default relay (`share.frostdev.io`); a custom relay, including `http://localhost` or `http://127.0.0.1` for local testing, is optional access asked for when you test it or create, join or resume a session there (Safari's all-site access already covers it). A browser prompt is only needed when the selected origin's access is missing or withheld. Device-local consent gates session traffic independently. Pause aborts requests and closes the live connections. Backup/key restore never enables sharing. No session connection runs without an open Notes, To Do or settings Sharing tab. Pause, Leave, Delete and key restore interrupt active sync before waiting for the local storage queue; older queued syncs and callbacks are discarded. A closed or replaced Notes/To Do surface cannot leave a hidden live port.

The Relay preference (`shareRelay`) is stored in browser sync, without credentials, and applies only to new sessions. Each existing session and backup key retains its own server. Entering or saving a relay URL makes no request and grants no host consent. **Test connection** explicitly sends a credential-free HTTP `GET /health` to the entered server, bounded to five seconds and 1 KiB of response, refusing redirects and suppressing the referrer; it does not save the URL or enable sharing. HTTP session requests also omit browser credentials and refuse redirects; live updates keep the existing native WebSocket transport. A custom-server invite names its host and requires confirmation in the extension before permission checks or joining. Device-local approved hosts (`shareHosts`) do not sync. Imported keys stay paused; Resume confirms previously unapproved hosts.

With a custom relay, encrypted data and necessary metadata go to that server and its infrastructure, instead of the default operator. Glaze cannot vouch for that operator, its availability, proxy, logs, backups or retention. Content remains end-to-end encrypted either way; a relay can withhold/delete ciphertext and creator actions reveal the delete token as described below. See [the self-host guide](server/README.md) for the public interface and operator responsibilities.

The worker keeps session keys, creator delete tokens, merge state, unsent changes, decrypted local copies and retained file bytes in Glaze's own IndexedDB (`glaze-sharing`). Only Glaze extension pages may request keys. LMS-side buttons open that page with a validated, nonsecret account selection hint. **Back up…** and **Restore…** live on that page: a key-bearing file input or blob URL must never belong to a school page. Backups include every session's share keys and creator delete tokens, even while sharing is paused, with an explicit private-backup warning. A failed key read fails the export; it never silently omits keys. Single-note exports do not include session keys.

Selected notes/folders, their pictures and attachments, a Look, or selected custom tasks and their steps/plans are encrypted on this device before going to `https://share.frostdev.io`. Account/site identifiers and LMS assignments are not carrier fields. Decrypted remote content is still untrusted: Notes HTML is sanitized, Look codes decoded/validated and custom tasks/plans cleaned before use. Joining first keeps a separate local session; an explicit copy into a chosen existing local account creates fresh IDs, preserving existing work. Viewer copies are detached; editable copies follow changes. Use this Look opens the existing editor preview (including its external font/image notices); only Apply changes your theme. All local app copies survive pause, leave, session deletion and expiry.

The relay receives ciphertext and necessary metadata: session and file identifiers, public verification keys, signatures, padded sizes, batch numbers, connection/request times, the expiry choice, the last day anyone used the session (so it can expire) and a hash of the creator's delete token. File identifiers are random. The identifier of a new Notes, To Do or Look share is derived from the share's public verification key (a fixed prefix and part of a SHA-256 of the key), which the relay already receives, so it tells the relay nothing more; mod channels and shares made by earlier versions use random session identifiers. The delete token itself is sent only when authorizing creator actions. Network infrastructure can see the device IP and timing; the relay operator's configured limits/backups apply, including Cloudflare on the default relay. The default relay limits each client (an IPv4 address, or an IPv6 address's network prefix) to a daily amount of new stored data, 1 GiB, as well as hourly and per-minute request limits, and it refuses new shares and writes when it is nearly full. Its counters reset when the relay restarts; they limit new stored data per day, not a lifetime storage quota, so continued uploads can still fill shared capacity over several days. Operators and infrastructure may keep network logs. People behind one shared network address (a campus, say) share a client's limits, so shares may go offline for a while when many of them sync at once. A custom relay sets its own limits. The relay cannot read note text, filenames, task content, Looks, member names or encryption keys. The default relay stores encrypted files in Cloudflare R2; custom operators can use disk or R2. R2 credentials stay server-side and are never in the extension. Editing-device aliases and last-seen times are encrypted content, self-chosen, not verified identity or access controls. View-only devices cannot sign presence writes.

The updated signing format is staged: relays enable it with `GZS2=1`, off by default. Updated clients use it only after the relay advertises support; once a session accepts an updated-format write, older members must update to keep using that session. Until enablement, compatible legacy-format writes remain in use. Deriving an identifier from its public key does not by itself mean a relay enforces that binding; mod channels still use random identifiers.

Invite keys live in the link fragment, which browsers do not send in HTTP requests. Glaze leads with pasting into its extension pages (settings or the Notes share panel) and renders no invite in LMS DOM/storage. Opening an invite in a browser can retain its fragment in history or expose it to a changed landing page; keep links private. Settings and the share panel have a no-referrer policy. No new `/j` page script is installed by S6b.

The creator can delete a session at any time. Otherwise, on the default relay, a share nobody has used for two years is deleted (one year if its creator chose deletion after a year unused), and a share that was created but never written to is removed after two unused days. Any read or write by any member counts as use; active requests and live subscriptions keep a share in use. Expiry applies after inactivity, not simply because a share is old. Deleting or expiring a share (other than one never written to) leaves a marker (its identifier and the day, no content) for a year, so members learn it was deleted. Relay deletion does not erase device copies or older operator/infrastructure backups. Removing a note/file from a session is narrower: old encrypted log data may remain until an editor's Glaze compacts the log (it does so once the log runs 200 batches past its last trim, or when the relay says it is full), and recipients keep their copies. Once a change is accepted, editors' devices also delete the relay's copies of files the share no longer uses (replaced or removed attachments, changed Look media, re-uploads), best effort: a delete that fails is retried on a later sync, and older relays without file deletion keep those files until session deletion/expiry. Removing one recipient requires a fresh session and link. Re-upload retained files is an explicit recovery action after a relay restore; it republishes encrypted references from bytes this device still has. No analytics, accounts, remote configuration or server credentials are introduced.

## What Glaze stores

Settings backups omit kept background file bytes. Restoring on the same computer can reuse a file the worker still keeps;
if that file is missing, the background falls back to a gradient and the import explains why. Keep original media files
separately. On older browsers without `storage.local.getKeys`, unknown legacy background files cannot be listed, reset or
collected until a saved reference or direct request discovers them; Reset removes current and discoverable kept media,
not those unknown legacy copies or unrelated stickers.

- **Glaze navigation** (Canvas, Blackboard Ultra and Moodle, on by default): Glaze draws its own bar from the
  site's own navigation, which stays in the page, hidden. Its settings sync in `navbar` (placement, style, rail state,
  course behavior, logo choice) and the capped `navbarItems` item (names, icons, groups, hidden items, phone tabs, up to
  eight links, Glaze's own items and widgets). To draw the bar before a site's menu arrives, the last items read on that
  site (their ids, names up to 80 characters and paths, at most 20) are kept per site and user as
  `navbarSeen:<site-root>:<user-id-or-name>` in local
  storage, on this device only. Opening one of the site's own menus as a Glaze panel asks your own school site, with
  your existing session, for what that menu itself shows: on Canvas your favorite or active courses, groups, account
  links, recent history, admin accounts or the school's help links (`/api/v1/users/self/favorites/courses`,
  `/api/v1/courses`, `/api/v1/users/self/groups`, `/api/v1/users/self/tabs`, `/api/v1/users/self/history`,
  `/api/v1/accounts`, `/help_links` or `/api/v1/accounts/self/help_links`); on Moodle your notifications or
  conversations (Moodle's own `message_popup_get_popup_notifications` and `core_message_get_conversations` services).
  Panel rows stay in page memory for a minute and are never stored or sent anywhere else. Navigation widgets (clock,
  next due, focus timer, pet; off until you turn them on) use the same timer, planner readers and pet progress as the
  rail widgets below and record nothing more. Mods' navigation widgets show in the bar with only the permissions you
  granted those mods.
- **The sidebar** (Canvas and Blackboard Ultra, on by default), in `chrome.storage.local`, on this device only:
  one record per LMS, school site's origin and signed-in account (`sidebar:<lms>:<origin>/<uid>`). It keeps the width
  you dragged, desktop open state, folded page/widgets sections per kind of page, whether To Do follows this course
  or shows all courses, and the dock's widget ids, order, folds and heights. It also keeps each widget's destination
  (dock, board, floating or off), where Move back returns it, removed-widget entries, revision/migration markers,
  whether you chose a width or scope here, and whether you dismissed the offer to dock To Do. The account id comes
  from the page's shared `GZ_CTX.account()` reader: Canvas's profile id (`/api/v1/users/self/profile`) or Ultra's
  me id (`/learn/api/v1/users/me`), using your existing school session. The worker checks the sending document's site
  and account before saving. The sidebar record is not uploaded; the starter-removal sync keys below are an exception
  to keeping the account id on this device. **Reset sidebar for this account** clears its own width/To Do scope choices,
  opens it and unfolds its sections/widgets, and clears widget heights; destinations, dock order, migration markers
  and widget data stay.
  Its general settings sync in `sidebar`: the title you type (up to 40 characters), style, starting open state and
  width, section order, page content/header/jump choices, surface, blur, opacity, corners, density, room for content,
  Canvas/Ultra and page-kind switches, To Do scope and whether native panels appear in the sidebar. Look codes carry
  only its style, surface and corners. Glaze reads the LMS's own side column and shows it in place; Ultra's assignment
  Grades / Attempts and submission Rubric are positioned visually, with their native controls still in place. The
  sidebar keeps none of those panels' text, grades, attempts or rubric content in extension storage and adds no
  request for them. Course-tab sketches below also keep the course's name and page location. Docked notes, To Do, timers and pets use
  their existing records below; moving or removing a widget keeps its data.
- **Document review** (Canvas and Blackboard Ultra): Glaze reads the submitted-work page's structure, title, grade,
  feedback/rubric elements and the embedded viewer's address to recognize a supported read-only view. It changes
  their presentation in place, without copying or saving the submission, grade, feedback, rubric or document bytes.
  Compact review, Full screen, Focus document, hiding Glaze bars and remembering focus are settings in
  `chrome.storage.sync` (`docreview`). Remember focus is off by default; when on, it keeps only `1` or `0` under
  `gz-review:<page path>` in that school site's tab session storage, until the tab closes. That key includes the
  submission page path and is readable by the school page. Other review state stays in page memory. Between a
  course-tab frame and the surrounding page, the review relay carries only a hide/show-bars boolean and a
  bars-shown notification, never document or grade content. It checks the school origin and sending window; the
  surrounding page also checks that the frame is the current visible document for the same account and that it is
  showing a supported review. Full screen uses the browser's own Fullscreen API on the existing viewer frame or
  its container. Review makes no request to the viewer's origin or your school, and does not read inside the
  external viewer. The separate annotation and course-tab stand-in features below keep their existing data.
- **Fresh-install defaults**, in `chrome.storage.local`: `freshDefaults` records whether this was a new install and
  whether setup is pending, with the first sidebar account key and whether its settings tile was added;
  `freshDefaultAccount` keeps that first key too. `widgetLayout` keeps the starter layout and its starter/migration
  markers. Edits made before setup finishes can wait locally in `earlyWidgetEdits` (widget/course ids, layout,
  sizes, order, widths and music link). A new install starts with pet, timer, notes and quote tiles on both Dashboards,
  course cards added once their list arrives, and To Do and Glaze settings in the first account's sidebar. Notes and
  pet switches start on locally unless a saved preference says otherwise; updates keep existing choices, including
  empty layouts. `starterTouched` notes, on this device only, which starter Dashboards (Canvas's and Ultra's) you have
  arranged, so a removal synced from another device never changes a board you edited here. The initial settings item in
  navigation is also a local fallback. Edited feature switches and
  navigation choices sync normally. Separate `starterOff:*` booleans sync removals and re-additions so defaults do not
  return: board/widget choices, empty-board and course-card choices. Course-card keys include the school origin and
  course id; sidebar To Do/settings keys (`starterOff:sidebar:<lms>:<origin>/<uid>:<widget>`) include the origin and
  account id. These identifiers can therefore follow browser sync; the sidebar records and starter layout do not.
- **Blackboard navigation:** drawer layout and expansion are local presentation only and add no storage or requests. Precise size/spacing, label overflow, item style/background, active indicator, logo size/alignment, footer visibility and hover-expansion choices sync in `nav`; up to eight custom link names,
  http/https URLs, built-in icon choices, new-tab preferences, native-item order/hidden choices and rail-widget
  switches/order/position sync in the separate capped `navItems` item. A link is contacted only when you click it;
  icons and the default Glaze logo are bundled. Custom logos are resized on this device and stored as `navLogo:<id>`
  in local storage (960 px longest side, 400,000 characters each, within the existing 4,000,000-character combined
  committed-picture cap). Replacement can temporarily retain the previous logo until the new setting commits;
  failed saves retain the old picture. Replacement/reset/import then remove unused custom logos. A displayed local
  picture is readable by the school page, like other displayed images.
  A backup carries navigation settings/links but removes local picture ids and restores the bundled logo on restore;
  Look/share codes exclude personal navigation links, layout and logos. Rail widgets are off by default. The timer
  shares the existing device `widgetTimer`; its editor preview is an isolated demonstration. When Next due is enabled
  and visible, it uses the agenda/Better To Do planner reader and account-matched cache: a covered To Do copy under
  ten minutes old, otherwise a two-minute range memo. That existing reader may read your profile, memberships, work,
  calendar and submission state from this school's `/learn/api/` paths. Finished/dismissed work is excluded. The pet
  reads existing progress for a fresh cached same-origin account without fetching a profile or awarding XP.
  These widgets record no extra activity.

- **Pet habitat** (on for fresh installs unless a saved preference says otherwise; otherwise off by default), in `chrome.storage.local`, per site and confirmed signed-in account (`pet:<origin>/<uid>`): settled XP contributions for rewarded work/plan ids, existing source-cache timestamps, the provider hand-in timestamp saved when work credit settles, credited streak day numbers, the selected buddy look and decoration positions. The broker reads existing Better To Do, planner-cache, Insights and W11 streak records, plus the existing To Do/Streak switches; it adds no assignment requests or activity tracking. The ordinary shared identity helper may read the signed-in profile once for the page. Saved W11 `[streak.start, min(today, streak.asOf))` is the only source of streak days while Streak is on, including free restores; no days are guessed from its all-time best. With Streak off, no saved streak, or no valid saved calculation day (`asOf`), no new streak XP is awarded and existing XP stays. Missing/cleared caches and deleting finished task or plan history preserve settled rewards. With Canvas tick sync on, historical hand-ins and kept plans can receive first rewards without a planner row. A missing row preserves settled work/plan values; work credit can update if a fresh existing source proves a hand-in newer than the saved provider hand-in timestamp. A refreshed source timestamp alone cannot override a native untick. Ultra always follows local ticks. Visible unticks (local or synced), manual done mode and newer submission corrections revoke the associated work/plan XP; a still-present plan moved to a future day or with a known missed completion also loses plan credit. Contribution, version and provider-baseline collections are capped at 65,536 entries each; the credited-day collection is capped at 32,768. An unreadable, oversized or full record is left untouched and the view explains that its update was refused; existing earned history is never silently truncated or reset. No focus timer rewards, analytics, remote game service, notifications or missed-day penalties. Progress is not synced; removing the extension or clearing its local storage deletes it. Moodle has no supported stored account-scoped completion source yet, so no game is shown there.

- **Your settings**, in `chrome.storage.sync`: the on/off switch, your colors and saved palettes, look,
  background, motion, light/dark schedule, course colour and extras choices, and what you set for a course in its course menu:
  its colour, look, tint and the **nickname you type for it**. When Chrome sync (or Firefox Sync) is on, these follow
  your own account between devices, through Google's or Mozilla's servers. Safari keeps them on this device only.
- **Your GPA choices** (Canvas and Blackboard, the GPA Extra), in `chrome.storage.sync` as their own small item: for each
  course you change, its site's address and course id with the credits, honors/AP level, grading
  scale you typed and whether it counts. Nothing is stored for a course you leave as it is. It follows
  your account like your settings, in Chrome sync or Firefox Sync; Safari keeps it on this device only.
- **Your courses**, in `chrome.storage.local`, on this device only: each course's name as Blackboard
  lists it and which of Ultra's ten colour slots it is in (with its site's address and course code, so Gradescope
  courses can be placed with it), so the editor can list them for you to
  recolour or tint. On Canvas this includes the site's address, course id, name, code and native color; on Moodle,
  the site's address (with its folder, if Moodle is in one), course id, full and short name, and the colour Moodle
  gives the course.
- **Canvas's course-list snapshot**, in your Canvas site's tab session storage (`gz-canvas-courses`): the signed-in
  user id, fetch time, course-list and course-color answers, including course names, codes, terms, enrollments and
  current scores returned by Canvas. It is reused for less than a minute, after the profile reader confirms the
  account, and replaced after a successful fresh read; saving a Canvas nickname or color removes it. The minute is
  its reuse window, not a deletion deadline: the stored copy can remain until the tab closes. The school page's own
  code can read this storage. It is not put in browser sync or sent elsewhere. The `gz-settings` session copy of
  presentation settings, which lets the next page of the tab paint in your palette at once, holds only what that first
  paint shows (colours, look, background and navigation styling, motion and extras switches, whether course tint is on and how strong). It
  leaves out course names and nicknames, picture and link addresses, preset names, the sidebar title and review
  preferences.
- **Which grades you've seen**, in `chrome.storage.local`, on this device only: for each course whose
  gradebook you've opened, each item's id and the score it had, so new-grade badges know what's new.
- **Which course items you've seen**, in `chrome.storage.local`, on this device only: for each course
  you've opened, the ids of its items, so new-content badges know what's new.
- **Canvas badge records**, in `chrome.storage.local`, on this device only: the site's address, signed-in
  user's id and course id, with module-item ids, which ones you've seen, unread-grade counts and fetch
  times. These let badges share a five-minute cache between pages and keep accounts separate.
- **Canvas Modules position** (the "Remember your place" Extra, on by default), in
  `chrome.storage.local`, on this device only: for up to 30 courses, your scroll position and last
  module-item id. A tab-local session copy is cleared when the tab closes. Canvas owns module
  expansion. Older Blackboard folder records may remain stored but are no longer read or replayed;
  live course tabs retain their native page state until their frames are closed or evicted.
- **Pending discussion navigation**, in tab session storage: one course id, selected discussion title and timestamp, consumed on the destination list and ignored after 15 seconds. This resolves Blackboard’s different discussion and content ids through its native links.
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
  and the address of the site it came from, so the popup can list them. It is kept per school site
  (`dueWeek:<origin>`), so two schools in one browser don't overwrite each other, and replaced each time it's
  fetched.
- **What you type in Blackboard's editors** (the "Back up what you type" Extra, on by default), in
  `chrome.storage.local`, on this device only, per school site and signed-in student. While you write a post,
  reply, journal entry, message or assignment text, Glaze keeps a copy so it can offer it back if the page
  reloads or your session times out before it's posted. To know whose copy it is, Ultra asks your own
  Blackboard site who you are (`/learn/api/v1/users/me`, shared with the other extras), and keeps nothing until
  that answers; another account on the same browser is never offered your copies. A copy an earlier page kept
  isn't written over by what you type now: it stays beside the new text until you restore it, dismiss it, it
  posts or it expires, with at most three per editor (the oldest goes when another is saved). Copies are deleted when the matching post appears, when you dismiss their offer, or after 14 days. Clearing the editor
  deletes this page's new copy; unresolved older copies remain available. Switching the Extra off deletes them all. Copies kept by earlier versions without a site or an
  account (Ultra's) can't be tied to anyone, so they are no longer offered and the next cleanup deletes them.
  The text is never sent anywhere.
- **Supported new Canvas Inbox drafts**, in `chrome.storage.local`, on this device only: the message
  body, subject, site's address, signed-in user's id, course id and recipient ids. Backup covers new
  messages to individual users in uniquely named courses, with a subject and selected recipients;
  replies and group recipients are not backed up. Copies are kept until a matching sent message is
  confirmed, their offer is dismissed, or 14 days pass. Clearing the body removes this page's new copy, while unresolved
  older copies remain available. Switching the Extra off deletes
  them. Canvas's own editor recovery and its own what-if scores stay with Canvas.
- **Better To Do** (Canvas and Blackboard, on by default), in `chrome.storage.local`, on this device only, per Canvas
  or Blackboard site and signed-in user id: the tasks you add (title, course, due date, notes), the steps, "do on" days
  and focus sessions you plan, and what you tick off while "Tick off in Canvas too" is off (on Blackboard, always). A backup includes them, so you can
  move them; nothing else sends them anywhere. It also keeps one copy of your planner items (title, course, dates,
  submission status, your planner marks; on Blackboard, your due items with whether each was handed in, late, missing or
  excused, and whether Blackboard sent its calendar whole) and, for teachers, the work waiting to be graded with its counts. Two
  minutes is how long that copy counts as fresh, not how long it is kept: it stays until the next fetch replaces it,
  or until Glaze is removed.
  An unfinished add/edit task form in the sidebar can also be kept locally as `draft:todo:<origin>/<uid>` when the
  page is hidden, left or the widget unmounted, while **Back up what you type** is on. This holds the typed title,
  course, date, time and notes, plus the edited task's id and existing timestamps/completion state. It is removed when
  taken up in a supported sidebar form, or swept after 14 days or when backup is switched off, by the same draft
  cleanup as the editor copies above. Without backup, the unfinished form stays only in that document's memory.
  Where the browser cannot list storage keys, `draftsSwept` keeps the last cleanup time locally to limit the full
  draft sweep to once a day.
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
- **Dashboard notes and widgets** (Canvas and Blackboard Ultra; widgets on by default, with the fresh-install starter layout above; notes on for fresh installs unless a saved preference says otherwise), in `chrome.storage.local`, on this device only: your notes
  (at most 20,000 characters) per site and signed-in user id, with when you last typed them, so a note typed later
  in another tab wins; an emptied note keeps only the time it was emptied, so an older copy can't bring it back. The widgets' layout (which are on, their order and size, where a
  floating one sits), the music link you typed and when your study buddy last had a win to be happy about; the focus timer's phase and when
  it ends, so it keeps running from page to page. The widgets' settings (timer
  lengths, chime, quote choices, breathing lengths) are in `chrome.storage.sync` with your other settings (`widgets`).
  On Ultra, whether you folded Glaze's panel on the Courses page away (`panelShut`) is kept there too, and so are the
  Courses page's and the Dashboard's own layouts and the widgets floating over every Blackboard page (in the same
  `widgetLayout`: which tiles are on, their size, where each sits, folded or not, which is on top, and how wide the page
  was when you placed them) and which Dashboard tab you chose last (`dashTab`). With **Open Blackboard on the dashboard**
  on (`widgets.land`, off by default), Glaze's background page remembers which browser tabs already went on to the
  Dashboard (their tab number, in its session storage: in memory, never written to disk, gone when the browser closes or
  the tab does), so it happens once in a tab; the school's site sees nothing of it. The claim accepts only a top-frame
  page on a recorded Ultra site while the master, Dashboard and landing switches are on; failed session-storage reads or
  writes leave the page where it is.
  Course-card widgets keep the school origin and course id, term label and placement/size/fold choices in
  `widgetLayout`, up to 48 cards per board. They draw names, codes, terms, colors, native pictures and action links,
  unread counts, grades and progress from the page and its existing readers, and tasks from the existing planner
  cache when enabled. Canvas's native card picture address is retained in page memory across card replacement;
  drawing it can load that image from its host as the native card does. There is no separate stored copy of grades,
  tasks or page content for these cards; the existing badge, course and planner records still apply.
- **Notes** (Canvas and Blackboard Ultra, the notes app; the Notes switch on for fresh installs unless a saved preference says otherwise, otherwise off by default), on this device only, per site and signed-in user id. The
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
  interrupted, say) is finished the next time Notes opens, so nothing deleted stays behind. Glaze never stores a
  shortened note: a note too long to keep whole (over 2 MB of text, or more than 100,000 elements) is refused with a
  visible warning when you save, import, duplicate, export, paste or sync it, never cut. Glaze asks the browser for
  `unlimitedStorage` (see Permissions), so this storage isn't cleared to free space; where a browser withholds that, it
  may clear it if the device runs very short, so **Back up…** saves a copy
  (a zip of Markdown files, the pictures and attachments, and the notes as HTML for importing back) through your
  browser's own download, and **Import** reads such a zip on your device.
- **Reminders and streak** (Canvas and Blackboard, off by default), in `chrome.storage.local`, on this device only, per
  Canvas or Blackboard site and signed-in user id: which reminders have been shown (so another tab doesn't show them again; while one tab is
  showing one, a random id for that tab holds it for 30 seconds), the ones you
  snoozed and the items you muted, each with a time (dropped after a month; mutes after three months), and, with the
  streak on, the day your run started, the day it was last calculated, your best, what a restore forgave and how many restores you used this month.
  It's kept apart from Canvas's and Blackboard's own read and done state, which Glaze never changes. Nothing sends it anywhere, and
  a backup leaves it out; your reminder choices (which kinds, how long before) are settings and sync with them.
- **Your class schedule** (Canvas and Blackboard), in `chrome.storage.local`, on this device only, per Canvas or
  Blackboard site and signed-in user id: for each course you saved, its course id there (or a name of your own), code and
  name, and each meeting's days, start and end time, place, first and last day and days off; the time zone those times
  are in (your Canvas profile's; on Blackboard, your browser's); and when each course was last saved, when you last pressed Delete all and which courses you deleted when,
  so a save from another tab made before a deletion can't bring a course back. Only what you choose to save on the
  review screen is kept; the file, page or text you import is read on your device and not kept. Delete removes a
  course, Delete all the lot. Nothing sends it anywhere other than into a calendar file you export yourself (Export
  calendar (.ics), "Your class schedule") or a backup you save yourself (**Back up…**); whether class reminders are on, and how
  long before, are settings and sync with them.
- **Your Looks history and favorites**, in `chrome.storage.local`, on this device only: the last 20 themes
  you wore (palette, fonts, look and background, with when you last wore each), so Previous Look can take
  you back, and the theme codes you saved as favorites, with the name and GitHub username of a gallery Look.
  Clear history in the editor deletes the history; Remove deletes a favorite.
- **Ultra course cards as board tiles** are optional and device-local, in `widgetLayout` beside the existing widgets. Keys include the school’s origin and course ID; each board keeps at most 48 cards per school (384 across schools) and a bounded term label with its placement. Course titles, grades, progress and tasks come from metadata/readers Glaze already loaded, or the existing account-scoped planner copy. Board cards start no new course, gradebook or planner reads and add no tracking. Ultra’s original list and filters stay reachable. The Dashboard and Courses layouts are independent; removing a tile does not delete the course’s tasks, notes or style.
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
  None of it is synced, exported or put in a theme code; rotation's choices sync with your settings, and which pointer a
  Look wears is part of the Look (a theme code of a Look with your own pointer picture goes without it). Which pointer
  you see with every Look (the Look's, the system's, a set or your picture) and whether its animation plays sync with
  your settings, and are never put in a Look or a theme code. Remove deletes a sticker, Delete your picture deletes a picture,
  Remove picture under Look › Pointer deletes your pointer picture; Reset everything deletes all of it.
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
- **AI connections** (Settings → AI, off by default), in the extension worker's own IndexedDB (`glaze-ai`), on this
  device only: each provider you connect (its key) and, in Advanced, each OpenAI-compatible endpoint you add (its name,
  address and key). A key is never in `chrome.storage`, never synced, never in a Back up file or a shared Look, and never
  given to a page; Settings shows it masked. `chrome.storage.local` keeps whether AI is on, Simple or Advanced, the
  overall model and any feature's own (a provider's name, a model's id and the effort you set), Advanced's tuning, which
  features may use AI, and a list of recent AI calls with metadata only (feature, provider, model, time, size, outcome;
  no text, address or key). Clear empties that list. A connection kept by an earlier version is moved into this shape the
  first time Settings opens, its key with it.
- **Glaze Writer** (Blackboard Ultra, on by default), in `chrome.storage.local`, on this device only, never synced:
  each assignment's paper (its text, title, course name, due date, format and address), keyed by school, student, course
  and assignment (one Blackboard hasn't yet said whose it is waits under a key of its own), with the versions Settings →
  Writer keeps (40 to start, 10 to 100; 4 MB in all, the last submitted one always kept) and your own format presets; your
  personal dictionary (up to 5,000 words, shared by every box); and your saved sources (up to 300 per store), keyed the
  same way: one store per assignment or journal, one shared by a discussion's post and replies, and one shared by each
  course's new messages. The documents you start or import on Writer's Documents page are kept
  the same way, each under a random key (`doc:<uuid>`) with its text, title, format and versions; Glaze keeps no copy on
  a server. Delete there moves a paper or document to Trash, which keeps it and its versions on this device; 30 days later
  it is deleted for good the next time the browser starts or Documents opens, unless you restore it first. A paper's edits
  not yet saved wait in the writer frame's own
  `sessionStorage` until they are. What you type in a discussion, reply, message or test box goes to Back up what you
  type (when it is on), as Blackboard's own editor's does; Writer keeps no copy of its own. **Back up…** includes papers,
  documents (those in Trash too), versions, presets, the dictionary and saved sources; uninstalling removes them. The thread, prompt, rubric, attached files and names Writer reads
  from Blackboard for a box are held in that page's memory only.
- **Course tabs** (Canvas and Blackboard Ultra, on by default), in `chrome.storage.local`, on this device only, per site and
  signed-in account (`ctabs:<origin>:<uid>`): for each tab (40 at most) the course's id, name and code, whether it is
  pinned, when it was last used, its own-course URL including query parameters, and scroll position. Any previously
  opened course page can reopen, including a test, attempt, discussion or message. Glaze does not press controls there.
  Closing a tab removes its entry and live frame. The surrounding page owns list writes; live frames report only their
  own place so a late frame save cannot overwrite another tab's pin, order or closure.
  **Live pages** run as ordinary same-origin Canvas or Blackboard frames, up to four course frames alongside the surrounding page, with their scripts, form values and native
  requests still active while hidden. Edited pages are excluded from automatic eviction after trusted input, change
  or submit events; if all four are protected, another page waits until you explicitly close one. Protection is
  conservative until closure and does not identify every native operation. Closing, reloading, signing out or disabling
  tabs can discard unsaved native work. A clean older frame can stop to make room; reopening restores its URL and saved
  scroll, not arbitrary native state. These frames are not isolated from the surrounding school page.
  Canvas also keeps one frame for pages outside a course (Dashboard, Calendar or Inbox), earlier pages of each frame
  (up to three per frame and eight in all), and replacement pages while loading. Earlier pages keep their DOM and
  form values in memory, without a content copy in extension storage; their scripts and native requests can still run.
  Media is paused and recognized external players stopped until shown again. Returning can reload a clean page from
  your school under the retained one; edited pages, pages with embedded frames and submission/quiz/tool-action paths
  are excluded from this automatic reload. Edited earlier pages are protected from eviction too; navigation waits
  when no protected-page space is left. Back/Forward entries keep the frame/course id and page URL in browser history
  state. A page can start loading when you press its link, before the click completes; Glaze does not load unchosen
  courses in advance.
  **Sketches for first load** are the shapes of a course page as it was on screen when you left it: up to 60 of its
  boxes with their place, size, colour and corners (lines of text as bars, without the words), the course's name, the
  window's size, the course's scroll and the place of Glaze's tab strip. No other page text or image data is copied.
  Sketches are keyed by site, account and course, and also keep the relative page path (including permitted query
  parameters) and the time they were made.
  They are kept only in page memory and `chrome.storage.session` (the browser's in-memory extension storage), or worker
  memory where that API is unavailable. Each sketch is at most 8,000 characters and all together at most 400,000, oldest
  first. No sketch is written to `storage.local` or sent to a server. They are cleared on browser close, sign-out,
  account change or disabling tabs/Glaze. Session-only account metadata keeps up to 64 document/tab ids per site with
  birth times and a cache generation, so an old top-level page cannot restore a previous account's sketches.
- **The last Safari update-check attempt**, in `chrome.storage.local`, on this device only: a timestamp
  that limits requests to the native app to once every 24 hours when Safari starts Glaze's background worker.

Uninstalling the extension removes all of it.

## What Glaze collects

Glaze has no analytics and does not collect, log, or sell your browsing history, page content,
Blackboard coursework, grades, or credentials. The network requests below reach the requested
services, which receive ordinary connection information such as your IP address.

## Network requests

Ultra appearance uses the visible course-card banners and existing color slots; it makes no LMS API requests. Linked images load from their chosen HTTPS hosts, exactly as on Canvas. The Ultra document viewer has no added iframe injection or host access.

Glaze's built-in features ship as static files and load no remote scripts; user-installed mods are described above.
Its built-in fonts, three.js (used by the
animated backgrounds), lottie-web's light player (used for Lottie animations), pdf.js and the Tesseract OCR engine with its six language models (used to read PDFs and photos
you import) are bundled. It makes requests in these cases:

- **The site check** (Chrome, Edge and Firefox). When you add a school's own site (the first tab, Settings → Sites or
  the browser's own menu), Glaze asks that site for three addresses that tell Blackboard, Canvas and Moodle apart:
  Blackboard's public version (`/learn/api/public/v1/system/version`), Canvas's `/api/v1/users/self` and Moodle's web
  services (`/webservice/rest/server.php?moodlewsrestformat=json`, also under the address's first folder), without cookies
  and without following redirects. From the first tab or Settings, if the site isn't one, Glaze reads course-site links
  on that site's homepage (fetched the same way) and checks whether the usual course-site names (bb, blackboard, canvas, moodle,
  learn, lms, elearning, courses, mycourses) and one made-up name exist on the same domain. These last requests send no
  cookies, may follow redirects and show Glaze only whether something answered. Glaze keeps the confirmed site's address
  and LMS in its local site list; it keeps no response bodies from these checks.
- **Your course list.** On a Blackboard page, at most every ten minutes, Glaze asks your own Blackboard
  site for your list of courses, the same one Blackboard's Courses page asks for, with your existing
  session, and keeps each course's name and colour slot as above. Nothing is sent anywhere else.
- **Course tabs.** To keep each account's tabs apart, Glaze asks your own school site who is signed in (Canvas's
  `/api/v1/users/self/profile` or Ultra's `/learn/api/v1/users/me`), once a page, shared with the existing profile and course-list
  reads above. A tab you pick from the strip opens that course's own-site address in a frame over the page, only
  when you pick it, and keeps it running while you're on another tab (four at most), as a browser keeps its tabs; it
  stops when you close the tab, sign out, or turn the tabs or Glaze off. While a tab's page first loads, a blurred
  stand-in drawn from the sketch above covers it. Glaze takes no pictures of your pages. Sketching and showing one make
  no requests. On Canvas,
  a page in an already-running frame can start loading on a link press before the click completes, and returning
  to a retained clean page can reload it from your school. Glaze does not load unchosen courses in advance.
  Frames load your school’s own pages with your existing session; their native scripts and embeds make their own requests.
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
  course's items and opens none, but that hasn't been measured. When you choose Read this document, Glaze also reads the
  files the document links (PDFs, Word, PowerPoint, pictures) from your own Blackboard site, which hands them over from
  its file store, with your existing session; nothing is fetched while the list is open. Files you pick are read on this
  device.
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
- **File previews on Blackboard Ultra** (while Glaze is on; no separate switch). Ultra opens a file preview in
  Blackboard's document viewer, at an address that holds a ticket good for about two minutes, and keeps that address,
  so a preview opened later is refused. When a preview's viewer address is for a file that is still converting, or its
  ticket has run out or is about to, Glaze asks your own Blackboard site again for a fresh one: it re-requests the page's
  own `/learn/api/` addresses that last brought a viewer address (the five newest, newest first, stopping at the first
  that returns the same document), with your existing session, never following a redirect. It asks once when the preview
  appears and then, while the address is still not a finished one, about every 15 seconds, at most twenty more times
  (five minutes) per preview. The answers are read in memory only for the document's new viewer address; nothing is
  stored or sent anywhere else. Turning Glaze off stops it.
- **On Canvas.** At most every ten minutes, Glaze asks your own Canvas site for your planner items for the
  next seven days, the same list Canvas's own planner and To Do list show, and keeps what's still to do as
  the due list above. On the Dashboard (Grades on course cards) and when you open the command palette, it
  asks for your active courses with their current scores and, inside a course, that course's navigation
  tabs. Extras also read native course colors, assignments and submission status, module completion
  requirements and items, folder and file metadata, and the server-rendered Grades page's unread dots.
  The course list includes each course's term (for the GPA and to search this term's courses first); Glaze follows
  Canvas's next-page links only on this site's API, up to twenty pages. The course-list/color snapshot described
  above is kept in the school tab's session storage, including returned scores and enrollments.
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
  These requests are read-only GETs to your own Canvas site with your existing session; opt-in planner ticks,
  nickname/color edits and an announcement's read mark are described below. The due list, course details, course-list snapshot, badge records and
  saved feature summaries described above are kept; search and calculator source answers stay in page memory.
  For supported Inbox draft recovery, Glaze reads your profile id and, when offering a copy or checking
  a send, your sent conversations and matching conversation details without marking mail read. It
  sends no messages. When you click Download all, Canvas supplies signed links for accessible module
  files. The extension's background worker fetches them from your school's file host without cookies.
  Links and file bytes stay in memory while Glaze makes the zip; they are not saved in extension storage.
  The resulting zip is saved to your device.
- **Better To Do** (Canvas, on by default). On the Dashboard, a course's home page, or wherever its sidebar widget is shown, Glaze asks your own Canvas
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
  to parse it and no consent box to tick, because nothing leaves your computer. It never writes to Canvas. The one
  exception is AI reading below, which you turn on yourself.
- **AI reading** (Settings → AI, off by default; Canvas and Blackboard). Only when AI is on, a connection is set up and
  you allow a feature (Syllabus import first), that feature can ask the AI to read for it. With a model on this device
  (Chrome's built-in model, or Apple Intelligence through Glaze's Safari app) nothing leaves your computer. With an
  provider or an endpoint, the syllabus text (and its pictures, when the model reads pictures) goes to the provider you
  chose for it, or the address you entered, and only after the import dialog has shown that host; Glaze asks the browser
  for permission to reach that one host when you click Connect (or save or test an endpoint). The key is sent only there,
  over https (or to your own computer). Glaze never chooses a provider, runs no server for AI, and never uses AI on quiz
  or test pages. AI answers are only
  suggestions in the review, marked Check this; nothing is kept until you save.
- **Glaze Writer** (Blackboard Ultra, on by default). For a box's prompt, targets, thread and rubric it asks your own
  Blackboard site, read-only, signed in as you, for your profile (`users/me`) and course list, the course's discussion
  and its posts, and an assignment's gradebook column with its rubric; when you ask for Feedback, the files the assignment's
  instructions and description attach (at most 6, 40 MB in all), read on this device as the syllabus import reads them. Proofing runs on this device (Harper, from the extension's own files)
  and sends nothing. It sends nothing to Blackboard itself: what you write reaches Blackboard only through Blackboard's
  own buttons, when you post, reply, send or submit (Ctrl/⌘+Enter presses Post, Reply or Send; the submit sheet's
  Submit attaches the paper's .docx through Ultra's own upload, writes your note and clicks Ultra's Submit once).
  Writer's frame may not connect anywhere itself; two things leave the device, each only as described:
  - **Citation lookups**, only when you click Look up in Cite, made by Glaze's worker with no cookies, referrer or cache,
    one 10-second deadline, at most 2 MB read and https all the way: a DOI to `doi.org` (falling back to
    `api.crossref.org` and `data.crosscite.org`), an ISBN to `openlibrary.org`, and a web address to that page's own
    host, after the browser asks you for access to that one host. The answer is read as untrusted text; only the
    source's fields are kept, and only if you save it.
  - **AI**, only for the features you turned on in Settings → AI, to the model you chose for each (see AI reading
    above; a model on this device sends nothing anywhere). **Tab completion** sends the whole document before the caret on each pause,
    within a rolling window bounded by the model's context and a 60,000-token estimated run cap; earliest paragraphs
    are dropped first. It also sends up to 4,000 characters after the caret, the course name, citation style, the
    discussion's prompt or the assignment's title, instructions and rubric, and, in a discussion, the thread: your
    classmates' posts with their names (24,000 characters at most) and the post you are answering. The newest 40
    suggestions shown in that editor may accompany the request to avoid repeating them. They stay in frame memory only,
    are cleared when another paper opens or the document is replaced, and are never saved. Device and small-window
    models receive a brief context, up to the newest 1,500 bytes of earlier document text and three suggestions, within
    the available window. Completion is limited to 60 requests per minute per tab. OpenRouter Anthropic requests mark
    the stable document prefix for the provider's temporary prompt cache; actual cache use depends on the provider. **Feedback** sends your draft with the
    course name, style, prompt and assignment (no thread) for Check with AI; the draft with the assignment's
    instructions and rubric for Feedback, with the text of the documents the assignment attaches (up to 200,000 characters
    of assignment material in total) and its pictures (4 at most, only to a model that takes pictures); the prompt, to read its word, source and reply targets; the sentence around a
    flagged word with its candidate fixes; and, when a web page you look up in Cite says too little about itself, the
    first 30,000 characters of that page and its address. **AI outline** sends the current document’s sections separately (up to 120,000 characters in total) and interface language to the Feedback model while Outline is open. It defaults on when AI is on and that model is configured; its switch is in Outline and Settings → AI. Generated labels and their section text are saved locally with the paper so unchanged sections can reuse them across reviews and reloads. Reuse is scoped to the paper, model configuration, language and outline version. **AI source extraction** sends individual entries detected in the document’s bibliography to the Feedback model while Sources is open; it defaults on with AI configured and has its own switch in Sources and Settings → AI. Local bibliography extraction works without AI. Imported source metadata, original citations and removal markers stay on this device with Writer’s saved sources. Paper Feedback also asks for an estimated grade against the same rubric, instructions and attached documents; it uses the same supplied material, potentially in multiple evidence, rubric-criterion and synthesis requests. These calls share a bounded run and cancellation; fitting cloud text requests may remain one call. Nothing is sent from a test's box, or from an attempt not known to be an assignment.

    When AI Feedback is configured and enabled, visible assignment papers can prepare attached images before you press Review. The Feedback model receives each image with brief assignment context to produce a bounded description, exact requirements and a relevance assessment; later assessment calls use this text. Complete readings stay locally for up to 30 days, with at most 128 entries, scoped to the verified account and assignment and invalidated by changed image content or task context. The cache stores readings and hashes, not original pictures, credentials or full assignment context. Failed readings are not persisted; a short memory guard prevents immediate automatic repeats during joined preparation/review. Turning Feedback or AI off stops pending preparation.
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
- **Ticking off in Canvas** (Better To Do's "Tick off in Canvas too", off by default). When you tick or untick an
  item, Glaze writes Canvas's own planner mark for it, as Canvas's List View checkbox does: one request to your own
  Canvas site (`POST /api/v1/planner/overrides`, or `PUT` to the mark that already exists) with the item's type and id,
  your user id and done or not done, and the page's own CSRF token. Nothing is written at any other time, and nothing
  else is written. If Canvas refuses, the tick goes back and the list says so. Off, ticks stay on this device.
- **A course's nickname and color on Canvas** (the course card's menu). Only when you change one there, Glaze saves it
  in Canvas as Canvas's own card menu does: one request to your own Canvas site (`PUT` or, to clear a nickname, `DELETE`
  `/api/v1/users/self/course_nicknames/<course>`; `PUT /api/v1/users/self/colors/course_<course>` with the color) and
  the page's own CSRF token. To show the nickname, the menu reads the course list Canvas's Dashboard already asks for.
- **Signing out from Glaze's Canvas bar, and Moodle's Edit mode.** Only when you click it. **Sign out** in the account
  panel of Glaze's bar on Canvas sends what Canvas's own Sign out sends: `DELETE /logout` to your own Canvas site, with
  the page's own CSRF token, then takes you to the login page. On Moodle, the bar's **Edit mode** switch operates
  Moodle's own control (it flips Moodle's checkbox, so Moodle's script does what it always does, or submits Moodle's
  form if that script hasn't started), and only on your click. On Ultra and Moodle, Sign out is the site's own link.
- **Marking an announcement read when you open it** (Glaze's announcement pop-up, on by default). Only when you open
  one, from Better To Do, a widget, Ctrl+K search or the site's own lists, Glaze asks your own site for that announcement, with your
  existing session (Canvas `GET /api/v1/courses/<course>/discussion_topics/<topic>`; Blackboard's public
  `GET /learn/api/public/v1/courses/<course>/announcements/<announcement>`; Moodle's `mod_forum_get_discussion_posts`
  through `/lib/ajax/service.php` with the page's session key), and marks it read as the site's own page does when you
  open it there: on Canvas, `PUT /api/v1/courses/<course>/discussion_topics/<topic>/read` with the page's own CSRF token,
  only for one Canvas calls unread; on Moodle, Moodle's own answer marks its posts read when the forum tracks them automatically, as
  its page does. Blackboard is not marked. The pop-up shows the body through Glaze's sanitizer, pictures only from your
  school's site, fetched without following redirects; their temporary image addresses are released when the pop-up closes.
  The announcement is kept in the page's memory for the page's life and never stored. A preview on hover or focus,
  after its delay, asks the same read-only request on Canvas and Blackboard and marks nothing; on Moodle it asks nothing.
  If the announcement can't be read, the site's own page opens instead.
  These, the nickname and color edits, the read mark and the ticks above are the only changes Glaze makes to any site.
- **Announcement read controls on Blackboard Ultra.** Checking or unchecking a native announcement control keeps your
  scroll position while Blackboard refreshes its list. **Mark all as read** first reads that course's paged announcement
  list (`GET /learn/api/v1/courses/<course>/announcements`) through the shared queue with your existing session, refusing
  redirects and pagination outside that course. It keeps unread IDs in memory for the operation and activates Blackboard's
  own read controls one at a time, including announcements on later pages. Already-read items are skipped. User input,
  leaving the list or switching Glaze off stops further marks; an update already sent by Blackboard may still finish.
  Nothing is stored or sent to another site.
- **Rubrics** (Canvas and Blackboard Ultra, Automatic by default). On a recognized assignment page, Glaze first uses the shared account lookup
  (Canvas `GET /api/v1/users/self/profile`; Ultra `GET /learn/api/v1/users/me`) to identify your account.
  It then reads the rubric and your own published rubric scores and feedback from your own site with your existing session, through paced,
  same-origin GETs that never follow a redirect (Canvas `/api/v1/courses/<course>/assignments/<assignment>` and its
  `submissions/self`; on Ultra, your grades for the course, the assignment's gradebook column and your attempt). It writes
  nothing and marks nothing read. The rubric stays in the page's memory until you leave the assignment, hide the tab or
  turn Glaze off, and is never stored. When Glaze can't read or recognize a rubric, the site's own view stays.
- **Dashboard notes and widgets** (Canvas; widgets on by default, with the fresh-install starter layout above). The notes and widgets that need your account ask your own Canvas site for your profile (user id
  and time zone; one request a page, shared with the other extras). The agenda uses Better To Do's copy of your planner
  items when that covers the day shown and is under ten minutes old; otherwise it asks your own Canvas site for that one
  day's planner items, a read-only GET, at most every two minutes per day you look at. Nothing is written to Canvas.
  On Blackboard Ultra they can sit on the Dashboard, Courses page, float or dock in the sidebar and ask your own Ultra site for who is signed in
  (`/users/me`, shared with the other extras) and, for a day the agenda shows, that day's To Do and calendar items with
  your submissions for the courses that have something due (read-only GETs through Glaze's Ultra reader, never
  following a redirect), at most every two minutes per day. Nothing is written to Blackboard.
- **Notes** (Canvas; on for fresh installs unless a saved preference says otherwise, otherwise off by default). Glaze uses your profile and course list (as the other extras do). When you choose
  **Canvas link** in a note, it lists one course's files, pages or modules with their items from your own Canvas site:
  read-only GETs with your existing session, the next page asked for only on your own site, never following a redirect,
  and stopped when you close the picker or the view. Only the link and title you pick go in the note. Opening a note
  loads nothing from anywhere: a picture from another site, pasted into a note, becomes a link to it instead. Links in
  notes open in a new tab without telling the site where you came from. Nothing about your notes is sent anywhere.
  On Blackboard Ultra, it asks your own Ultra site who is signed in and for your course list, and **Blackboard link**
  lists a course's content items you can open now from Blackboard's public contents API (each kept to its title, folder and link):
  read-only GETs that never follow a redirect and stop when you close the picker. Only the link and title you pick go
  in the note. Glaze also keeps the address of each Ultra site you approved (storage.local `ultra`; sites on blackboard.com
  need no approval), so only those sites' pages may save notes, Better To Do's tasks and plans, reminders and class schedules.
- **Music widget** (Canvas and Blackboard Ultra, off by default). Glaze contacts no music service until you press **Load player**, on each
  page. Then your browser loads that service's player inside the widget, from **Spotify** (`open.spotify.com`),
  **YouTube** or **YouTube Music** (both from `www.youtube-nocookie.com`, YouTube's privacy-enhanced mode) or **Apple
  Music** (`embed.music.apple.com`), and that service works as it does on any site that embeds its player: it sees
  what you play, your IP address and its own cookies, under its own privacy policy. Spotify and Apple Music get no
  referrer; YouTube's player won't play without one, so it gets your Canvas or Blackboard site's origin (`https://` and the host
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
  of the fonts' names from Google Fonts the same way, and OpenDyslexic's two files from jsDelivr (it has no small
  preview). Built-in fonts load nothing. Writer's Documents page wears your Look, so it loads the web font you chose
  from the same hosts (its page policy allows only those).
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
- **Video, animated picture or animation background.** If a Look's background is a video, an animated picture (WebP or
  AVIF) or a Lottie animation named by an `https://` link on a public website, Glaze's background worker fetches it when
  a page is shown, not the page itself, with no cookies, no referrer and no redirects, and hands the page a cleaned
  copy. The site sees an ordinary request for the file. The worker fetches only the address the worn Look (or an
  installed mod) names; the editor's preview may fetch one it is showing. A file is capped at 12 MiB for a video, 6 MiB
  for a picture and 1 MiB for a Lottie file, and a video or picture at 4096 pixels on a side; a file past the limits is
  refused and the Look shows its fallback. The file is read, never run, and nothing fetched this way is stored. MP4,
  WebM and AVIF files have location, device, time, title and program details removed from the file’s container
  before new files are kept or shared. The encoded stream and visible pixels remain; this is not a forensic guarantee
  that all identifying information is gone. New files whose containers cannot be cleaned safely are refused.
  Files saved before 3.3.5 that cannot be cleaned stay on this device and are not shared. The editor, and the preview of a theme code, name the site before you apply the Look. A
  Look can also name a file kept on your computer by its SHA-256; such a file reaches you only through a share session
  (encrypted end to end, like a shared note's file), the gallery, or because you chose it in the editor. Kept files are
  held in a database only Glaze's background worker opens (`glaze-media`), with a small index (`lookMediaIndex`) in
  `storage.local`, up to 48 MiB in all. A file from the gallery or a share is held as pending until you use or save
  the Look, and goes if you cancel, pick another code or close the editor; a file no Look, favorite, history entry or
  rotation names is cleaned up. Settings lists the kept files, and Reset everything removes current and discoverable kept files (stickers and other
  local data stay). A theme code can't carry a kept file, so Copy theme code asks you to use a link or a share instead.
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

**How often Glaze asks your school's site.** Selected bulk reads (course gradebooks and content through Ultra's card
readers, and Canvas's collapsed module lists) share a queue per document, grouped by school site: at most three requests at a time, with visible work first. Separate tabs and frames have independent queues. This limit does not cover every
school request: identity, memberships and due-date exceptions, and other page/planner readers, use their existing paths.
For queued reads, a 429 or server error (5xx) pauses that queue. Ultra's queued fetches use the site's `Retry-After` header, otherwise for
2 seconds, doubling with each further error up to ten minutes; the ten-minute cap also applies to the header's delay.
Canvas's module-list adapter does not expose a failed response's `Retry-After` header, so it uses the fallback delay.
A queued 401 stops that queue until the document's page address changes. The queue does not retry failed work itself;
the card readers cache failures for a minute before another pass may ask again. Canvas follows its API's same-origin
`Link` header for paged lists. An incomplete content read marks nothing as new, and Download all refuses to save part of
a module.

The extension's own links are opened only when you click them: the footer link to the project's GitHub page, "Open the
gallery" in the editor (see below), and **Report a problem** (the editor, and What Glaze can do on Canvas), which opens a
new issue on `github.com/frostdev-ops/glaze` with your Glaze version, browser, system and language filled in, and nothing
about your school. That text is part of the link, so GitHub receives it when the page opens, with ordinary connection
information; nothing is posted until you submit the issue yourself, and you can change or delete any of it first. Web addresses in
your Dashboard notes are links too, opened in a new tab without telling the site where you came from.

## The Looks gallery

The Looks gallery at `https://frostdev.io/glaze/looks` is an ordinary website. You visit it yourself,
from the editor's Open the gallery button or any other link, and
frostdev.io sees that visit like any other (see its [privacy page](https://frostdev.io/privacy)). On
the gallery's pages only, Glaze runs a small script that waits for you to click **Use this Look in
Glaze**. That click passes the Look's code, name and author from the page to Glaze's editor on your
device; the editor applies nothing until you choose **Use this theme**.
If a Look's code names a background image on another site, the editor's preview loads it from that
site, as for any pasted theme code, and says which site it is. If the Look's background is a video or animation file the
gallery keeps and this device doesn't already keep, that click also makes Glaze download that one file from
`https://frostdev.io/glaze/looks/api/media/<its SHA-256>`, with no cookies or referrer. The request names the file's hash;
the gallery still receives your network address and normal browser headers. The file is checked and kept by its hash
for the editor's preview; Glaze makes this request only then. A mod from the gallery carries its background file inside
its signed bundle, downloaded when you click **Use in Glaze**. Sharing your own Look there is the
website's own form, which you fill in yourself; Glaze takes no part in it.

## Adding a school's own site

Canvas on `*.instructure.com`, Blackboard Ultra on `*.blackboard.com` and Moodle on `*.moodlecloud.com` work from install. On Chrome, Edge and Firefox, there are four ways to add a school's own site. The browser asks for any access Glaze does not already hold:

- **Use Glaze on example.edu** in Glaze's toolbar popup. Opening the popup lets Glaze into that one tab (`activeTab`), where it checks the page's head for Canvas's own stylesheet, the keywords line Moodle writes into every page ("moodle, …", with the page id and layout it puts on the body tag) or Blackboard Ultra's `/ultra/` base address on an `/ultra` page. The check reads only those markers and keeps no page content. On Chrome and Edge, Glaze's toolbar icon gets a dot on pages that look like Canvas, Moodle or Blackboard Ultra: the browser matches the page itself and does not report those rule matches to Glaze.
- The school address field on the tab Glaze opens once when it's installed.
- The school address field in **Settings → Privacy and data → Sites**. Both address fields check for Blackboard, Canvas or Moodle after access is granted (see the site check under Network requests). If no LMS answers, Glaze offers up to two course sites nearby and returns access granted by that attempt; access held beforehand stays.
- The browser's own extension menu or settings. Glaze checks a site granted there the same way and turns on if it's a course site; anything else keeps the access you gave, unused.

**All sites** on that first tab gives Glaze every https site at once. Glaze then checks the markers above on https pages outside its built-in hosts and, on a course site it doesn't know, shows a small bar on the page: **Use Glaze on example.edu?** Until you press **Yes**, Glaze does not register its theme, read the site's API or keep course data there; it never asks while Glaze is off. **Not now** stops the question on that site for a week (the time is kept in `askLater`, for the 50 sites most recently put off). Installs from before 3.4.0 keep the all-site access they had. Safari lets you choose Glaze's sites in its own settings and uses the same in-page question on sites Glaze has not already approved.

A site you add is kept in a list in the extension's local storage (`canvas`, `moodle` or `ultra`) so Glaze styles it from the start next time; sites Glaze already ran on before it asked stay on the list. **Settings → Privacy and data → Sites** lists them, each with **Remove**, which stops Glaze there, returns any browser grant for that exact site and forgets the courses and due dates Glaze read from it (your notes and tasks stay). Broader grants such as All sites stay. **Reset everything** clears the list and the Not nows.

## Permissions

- `storage` — to save the settings, GPA choices, past terms and goal, the Insights summary, course names, places, what-if scores, due list, Better To Do's tasks and plans, your class schedule, reminder and streak state, marks on documents,
  typed-text backups, Looks history and favorites, Dashboard notes and widgets, the notes app's index, Google Calendar sync's state, and Safari update-check timestamp described above.
  Notes' text, pictures and attachments are in the extension's own IndexedDB.
- No permission for reading PDFs and photos. The extension's own pages may compile WebAssembly (`'wasm-unsafe-eval'` in
  its content security policy), which the OCR engine needs; the reader runs only code that ships in the package, and
  never in the LMS page. The reader page is web-accessible so an import can open it in a frame; it reads a file only
  with a one-use pass that Glaze's import gets from its own background worker, so a site that framed it itself can't
  make it read anything.
- `identity` (Chrome only, optional) — not requested by released builds while Google Calendar sync is switched off
  at build time (`ON` in `lib/gcal.js`): the Chrome, Firefox and Safari packaging scripts remove it, with the OAuth
  client, from the manifest they ship. In a build that enables the sync it is asked for only when you press Connect in
  Google Calendar sync, and removed on Disconnect. It lets Chrome sign Glaze in to Google Calendar with the Google
  account in your browser; Chrome shows no warning for it. Glaze never asks for `identity.email` and never sees your
  password.
- `unlimitedStorage` — requested at install, so the browser doesn't clear your notes, pictures, attachments and the
  files kept for Look backgrounds to free space. Nothing more is stored or sent because of it; Chrome shows no warning
  for it.
- `nativeMessaging` (Safari only) — to ask the containing Mac app to check for updates. The App Store
  apps ignore this request. Chrome does not request this permission.
- `activeTab` (Chrome, Edge and Firefox) — when you open Glaze's toolbar popup, the browser lets Glaze into that one tab: the popup reads its
  address and runs the check described in "Adding a school's own site", so it can offer **Use Glaze on** that site.
  Chrome shows no warning for it.
- `declarativeContent` (Chrome and Edge) — to put a dot on Glaze's toolbar icon on pages that look like Canvas, Moodle or
  Blackboard Ultra. The browser matches the page against Glaze's rules itself and does not report those rule matches to Glaze.
  Chrome shows no warning for it.
- `scripting` — to start Glaze from the first page you open on a site you allowed, to run the popup's check in its tab,
  and, with All sites, to run that check on https pages.
- Host access to `https://*.instructure.com/*`, `https://*.blackboard.com/*` and `https://*.moodlecloud.com/*` — to apply
  the theme on Canvas, Blackboard Ultra (its `/ultra` pages) and Moodle where Instructure, Blackboard and MoodleCloud host
  them, and in Canvas's document viewer on `canvadocs.instructure.com`, where a separate small script applies the palette
  and, if you switch them on, your marks on documents. Glaze reads and restyles the page in your browser only.
- Host access to `https://frostdev.io/*` and `https://share.frostdev.io/*` — for the gallery script above on
  `https://frostdev.io/glaze/looks` and `/glaze/mods`, the gallery's Looks and mods, the mod blocklist and optional
  encrypted share sessions on the default relay.
- Optional access to other sites (`https://*/*`, and `http://localhost` and `http://127.0.0.1` for local testing) — not
  granted at install. Glaze asks the browser for one site at a time, when you choose it:
  - your school's own Canvas, Blackboard Ultra or Moodle, as described in "Adding a school's own site";
  - the school's file server for Canvas's Download all, the first time it's needed; on Chrome, Edge and Firefox,
    redirected files stop with an error asking you to download them from Canvas, because Glaze cannot discover the redirect's host;
  - `https://www.gradescope.com` when you turn on "Gradescope in To Do", for Glaze's Gradescope script there and its
    background worker's reads of Gradescope course pages;
  - the site of a picture, video or animation you add to a Look, or a site you let a mod reach, when you add it;
  - a custom share relay, when you test it or create, join or resume a session there;
  - the AI provider you connect in Settings → AI, when you click Connect, and only that one:
    - `https://api.openai.com` for OpenAI;
    - `https://api.anthropic.com` for Anthropic;
    - `https://generativelanguage.googleapis.com` for Google Gemini;
    - `https://openrouter.ai` for OpenRouter;
    - `https://api.x.ai` for xAI;
    - `https://api.mistral.ai` for Mistral;
    - `https://api.groq.com` for Groq;
    - `https://api.deepseek.com` for DeepSeek;
  - an AI endpoint you add in Settings → AI's Advanced, when you save or test it.
  **All sites** asks for every https site at once. Access you remove in the browser's extension settings stops Glaze
  there. Installs from before 3.4.0 keep the all-site access granted then.
- In Safari, Glaze asks for all sites (`<all_urls>`) as before, and Safari asks you which sites it may use in its own
  settings.

On a site you allowed, Glaze reads the school's pages and makes the requests described above with your existing
session. It writes to a site only on your own click: a planner tick (if you switched "Tick off in Canvas too" on), a
Canvas course nickname or color, Sign out in Glaze's Canvas bar, Moodle's Edit mode switch in its bar, and Glaze
Writer's Post, Reply, Send or Submit when you press it (see Glaze Writer above). Glaze never changes grades.

## Google user data

Google Calendar sync is unavailable in the current build while Google verification is pending. The following describes its use of Google data in a future build that enables this optional feature; calendar file export does not require it.

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

### Hidden Ultra folders

Hidden folder/module IDs and the Show hidden folders switch are stored in `storage.local`, separately for each HTTPS site, known Ultra account and course. No titles or content are stored. Limits are 500 IDs per course, 200 account/course records and 256 KiB across them. Unknown identity or failed storage leaves the outline untouched. The feature makes no requests, including no profile request; it reuses only the existing page identity cache. Back up… includes validated records; imports retain their account/site/course keys and ignore malformed records without replacing existing choices. Only your own clicks or keyboard activation save a choice. The brief status and Undo are held only in memory, cleared on navigation, account changes or disabling, and store no additional data. Undo changes only the folder just hidden. Search, Download all, progress and new-item counts are unaffected.

The settings editor remembers its last tab in device-local `editorTab`. Its previews are authored synthetic pages inside the extension, with no school account or LMS request. They reuse Glaze’s styles and local feature helpers. Existing notices still apply when you deliberately select a web font or linked image. Preference resets keep local notes/tasks, stickers, bookmarks and share keys, but Reset everything removes current and discoverable files kept for Look backgrounds, subject to the older-browser limit described above.
Blackboard nicknames edited here use the same synced course-name fields as the course-card menu. Selecting a preview course does not store any additional course data.
