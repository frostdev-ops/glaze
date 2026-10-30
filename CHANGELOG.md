# Changelog

All notable changes to Glaze are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0] — 2026-10-29

### Added

- Blackboard: **Glaze Writer** in discussion, journal, message, assignment and test boxes, with Blackboard's own editor one click away in its ⋯ menu. Discussions and messages get a selection toolbar, targets from the prompt and Ctrl/⌘+Enter to post. Assignments open in the same light editor and Blackboard's own Submit sends them; **Full writer** turns the box into real pages in MLA 9, APA 7, Chicago 17, Blank or your own format, with format checks, footnotes, versions, and .docx import, export and submit. Spelling, grammar and autocorrect run on your device; citations look up a DOI, ISBN or web address when you click. Tab completion and AI feedback run only when turned on in Settings → AI. Tests get proofing only. Papers, documents and sources are in **Back up…**.
- **Documents**: every paper and document in one place, from the popup, Ctrl/⌘+K or Glaze's bar in Blackboard, Canvas and Moodle. Start one (Blank, MLA, APA, Chicago) or import a Word file; search, filter by course, rename, copy, export a .docx. Deleted documents wait 30 days in **Trash**. The page wears your Look.
- Writer's pages follow a dark Look; **Light page** keeps them white.
- Mods: `glaze.documents`, with the `documents` and `documents.read` permissions.

### Changed

- Settings → AI: named providers (OpenAI, Anthropic, Gemini, OpenRouter, xAI, Mistral, Groq, DeepSeek) beside the on-device model, one model for all features or one each, and your own endpoints in Advanced; an existing endpoint moves over.
- Motion starts at Expressive. Updating moves Subtle to Expressive once; Off stays Off.
- Text pasted or imported from Word keeps a colour only where it reads on the page.
- Settings → Writer: Clear all names and removes papers and documents, Trash too.

### Fixed

- Blackboard: the rubric shows on a saved draft's attempt page, and going back to an assignment left with its rubric open shows the assignment. Blackboard's side panels open over Glaze's column.
- Blackboard: **soon** and **today** chips are right across a clock change; impossible gradebook dates are no longer read as due dates.
- Blackboard: Content leaves folder expansion and scrolling to Blackboard; search follows Blackboard's own links; turning Remember your place off cancels a pending restore.
- The sidebar covers its card beside a scrollbar, and the rubric opening lines up in right-to-left layouts.
- Writer: a visible caret on a dark page, no doubled spelling marks in Chrome, and the status bar names the page on screen.
- Settings → Writer: Versions kept saves 50 and 100; Saved papers wraps at narrow widths.
- Your buddy's page no longer throws errors when Glaze updates while it is open.

## [3.4.6] — 2026-10-26

### Added

- Settings → AI, off by default: a model on this device (Chrome's built-in model, or Apple Intelligence in Safari) or an OpenAI-compatible endpoint you choose, which features may use it, and a local list of recent calls. Syllabus import can use it to fill what Glaze's own reading missed; every AI value is marked Check this and nothing is kept until you save.
- Blackboard: **Mark all as read** on a course's Announcements marks every unread announcement read, through Blackboard's own read circles.
- Syllabus import: deadlines by course week become dates, with a Week 1 starts date that moves them; weekly rules become one date a week; exam windows and "week of" items land on their last day; several items on a line become one task each; points-only grading becomes percents; TA office hours come with their role.

### Changed

- Animated backgrounds (three.js), Lottie animations and the photo reader's OCR engine ship as readable code, and the PDF reader keeps its Brotli dictionary in a data file, as the Chrome Web Store requires.

### Fixed

- Blackboard: marking an announcement read or unread on a course's Announcements keeps your place in the list instead of jumping to the top.
- Blackboard: Read this document in Syllabus import reads a document's attached files (PDFs, Word, PowerPoint, pictures) and lists each document under its own title.
- Syllabus import: tables of contents and section numbers are no longer read as dates, weights from tables and charts pair with the right labels, office hours given twice show once, and fields Glaze isn't sure of stay empty.
- Imported pictures keep a table's rows and a chart's labels with their values.
- Syllabus import reads schedule rows whose exam or due word sits in another column, "released … due …" windows, weekly rules limited to weeks or dates (skipping the days they except), and a TA's or coordinator's hours as office hours.
- Syllabus import with AI fills an office from a line that labels it or gives the professor's e-mail.
- Blackboard: a discussion's rubric link, and the one on the page View instructions opens, show Glaze's rubric pop-up instead of Blackboard's own rubric panel.
- Settings: Blackboard's preview repaints its course cards as you change them.

## [3.4.5] — 2026-10-26

### Changed

- The PDF reader behind imports (pdf.js) ships as readable code, as the Chrome Web Store requires.

## [3.4.4] — 2026-10-26

### Fixed

- Blackboard: rubrics show on graded assignments with your scores and feedback, and wherever Blackboard's own rubric link appears, including submitted work not yet graded.
- Blackboard: the page scrolls while the pointer is over a rubric.
- Blackboard: a test's Assessment Results sits on a panel like the other sections.
- Blackboard: an assessment's due date shows one countdown chip instead of two.

## [3.4.3] — 2026-10-25

### Added

- Announcements open in a Glaze pop-up from Better To Do, widgets, Ctrl+K and site lists; Better To Do and lists preview on hover. Opening marks unread Canvas announcements read; Moodle follows automatic forum tracking. Blackboard and previews mark nothing read. Settings → Course pages → Announcements; All settings → Pop-ups.
- Assignment rubrics, with your published scores and feedback, replace the rubric entry in Ultra's Assessment Details when there's room, otherwise open in a pop-up, as Canvas's folded rubric does. Settings → Course pages → Documents and quizzes → Rubrics.
- Back up… and Restore… in Settings → Privacy and data save and bring back everything in one file: settings, Looks, tasks, pet, Notes, dashboard notes, schedules, GPA past terms, widgets and share keys. Restore lists what the file holds and checks it all before changing anything. Older settings files and Notes backups still restore.

### Changed

- Settings → Look → Pointer has a switch for the custom pointer: off gives the system's pointer, without animation, on every page; on brings your choice back. Ctrl+K has it too. System pointer is no longer a choice; if you had it, the switch is off. Your own picture is a card among the pointers.
- The Look's own pointer and cursor effect moved from Motion to Pointer, under This Look's pointer.
- Mods and widgets read only the grades, to-dos and schedule of the account signed in on the page, and nothing while that account is unknown.
- Class schedule: a time saved in another time zone names that zone.
- CI runs Glaze's browser checks in a pinned, integrity-checked Chromium on every push, and a release zip waits for them.

### Fixed

- Draft backup keeps each tab's own copy of the same reply or message, and on Blackboard drops a reply's copy only once it is sent from that page and shows up there. A restored draft is cleaned of scripts and event handlers.
- Notes: restoring a newer backup brings back renames, moves, course changes and folder order, field by field, keeping newer changes made here.
- Class schedule: a reimported calendar updates its days off and keeps yours; adding a class from another time zone no longer moves saved ones; too many class times or classes are reported instead of "Saved"; oversized calendars are reported; large time zone data no longer freezes the page; Stop reading stops a calendar link.
- Settings fit a 320-pixel window with larger text, translations and right-to-left, without sideways scrolling.
- Pages on a school's own Canvas, Blackboard or Moodle address no longer load without Glaze while it installs or updates.
- Blackboard: on the Courses page, course tabs no longer cover the sidebar's header when the To Do column holds the sidebar.
- Blackboard: a course opened over the Courses page with an animated background keeps course-card controls, course tabs and board tiles beneath it.
- Blackboard: a graded attempt's rubric column has its panel again, so an animated background no longer shows through it.

## [3.4.2] — 2026-10-24

### Added

- Settings are grouped by what they change: Look, Navigation, Courses, Study, Course pages, Sharing, Mods, Privacy and data, and About. Each section shows its everyday controls and keeps the rest under More options; All settings adds the power-user sections, and search finds every setting. The side list marks the section in view as you scroll.
- A "?" beside a setting opens its longer description, by click, tap, keyboard or resting the mouse on it.
- The settings page wears your Look: its background, surfaces, fonts and text size.
- Course tabs have an Automatic place, now the default: in Glaze's navigation when it is a top bar holding them on a wide window, above the course otherwise. Installs on the old default move to it once.

### Changed

- Every widget fits its tile's size, on the Dashboard, in the sidebar, floating, in the navigation and on phones.
- The pet habitat is a room that fills its tile, in your Look's colors, with the pet's name, level and XP on it. The Pet button shows today's bonding moments left; Wellbeing, Decorate and Progress are one switcher, and the habitat's settings are in its ⋯ menu.
- A docked widget's Move up and Move down are in its ⋯ menu, and To Do keeps Share sessions and Export behind ⋯.
- Share sessions: Create stays off until it can succeed, saying what is missing, and offers your current Look when there is nothing else to share.
- Moodle: Density, Line height and course color tone work, as on Canvas and Blackboard.

### Fixed

- Blackboard: side panels and drawers, like Activity Stream's notification settings, open below Glaze's top bar with Close in reach, and the pet and Return home step aside while a panel, a dialog or Settings is open.
- Nothing on the page draws over Settings opened inside a course page.
- A page opened while Glaze wasn't answering fills in by itself, without a reload.
- Widget buttons keep readable text in every Look, on hover and focus too.
- Blackboard: Card grades only on hover blurs GPA figures too, as on Canvas, and outlines without Blackboard's actions column no longer leave a second blank column beside the sidebar.
- Canvas: navigation trays keep their room while Glaze navigation is on.
- Links to old settings addresses open the right section, and a link to a section scrolls to it.

## [3.4.1] — 2026-10-23

### Added

- Chrome, Edge and Firefox: a tab on install for your school's own address. Glaze checks it's Blackboard, Canvas or Moodle before keeping it. If no LMS answers, Glaze returns access granted by that attempt and offers up to two course sites nearby; access held beforehand stays. All sites gives Glaze every HTTPS site at once, and Glaze then asks on each new school's pages, as before.
- Chrome, Edge and Firefox: Use Glaze on the site, in Glaze's toolbar popup on a school's own Blackboard, Canvas or Moodle page. On Chrome and Edge, Glaze's icon gets a dot on those pages.
- Chrome, Edge and Firefox: Settings → Privacy and data → Sites adds a site by its address, and a site granted in the browser's own extension menu is checked and taken the same way.
- Moodle on moodlecloud.com works from install, like Canvas on instructure.com and Blackboard on blackboard.com.
- Firefox: where a page shown inside a site can't ask for access (Download all's Allow, Settings shown in the page), a small Glaze tab asks instead.
- Blackboard: Activity Stream settings, in Settings → Course pages → Blackboard Dashboard → More options → Activity Stream and in Blackboard's Stream settings: due dates on deadline notifications, posted dates or both, relative due dates, compact cards, and encouragement on or off.

### Changed

- Chrome, Edge and Firefox: Glaze asks at install only for instructure.com, blackboard.com, moodlecloud.com, frostdev.io and its share relay, instead of every site. Installs from earlier versions keep the access they have. Safari is unchanged.
- Removing a site in Settings → Sites also returns any browser grant for that exact site. All sites access stays.
- Course tabs show a blurred stand-in drawn from a sketch of the course page while it loads, instead of a picture of the page. Glaze takes no screenshots.
- On Chrome, Edge and Firefox, Canvas's Download all asks for the school's file server the first time it's needed; redirected files show an error asking you to download them from Canvas. Glaze cannot discover the redirect's host. Safari keeps its existing access model. Gradescope in To Do asks for gradescope.com when you turn it on, and a Look's picture, video or animation from another site, or a site a mod may reach, asks for that site when you add it.
- Firefox: new installs put Glaze's button on the toolbar.
- A Look's course-card rules and entrance reach the course cards on the Dashboard's board.

### Fixed

- Firefox: Glaze runs on a school's own Blackboard, Canvas or Moodle domain; 3.3.8 didn't register those sites.
- A folded tile's Unfold button sits above its resize corner.

## [3.3.8] — 2026-10-23

### Added

- Frostdev, a new built-in Look: a living topography in cut-ice light that tilts with the pointer, the Frostdev pointer set, and contour effects with flake and shard marks.
- Glaze's own parts move: course tabs, widgets, to-dos, folders and reminders glide to their new places and fade out when removed, and changing a palette, a Look or the Sidebar's width crossfades. Nothing moves with motion off, transitions off or reduced motion.

### Changed

- Blackboard: the course tab strip, the course header and the headers of items you open (documents, discussions, announcements) float as glass panels; counts and search get pill backgrounds. Canvas's breadcrumb row matches.
- Blackboard: tool pages such as Gradebook and Calendar run the tab strip and course header the full width, with the Sidebar under them, instead of leaving an empty corner.
- Entrances, tooltips and dialogs animate on the graphics card, so they stay smooth on busy pages; dialogs fade out as they close.

### Fixed

- Blackboard: a course tab shows one continuous background with the page around it, with no seam at its edge, also with an item open.
- Blackboard: closing an announcement opened in a course tab goes back to the course's Announcements, instead of taking the window to the Activity Stream.
- Blackboard and Canvas: course tabs can be switched or closed while one is still loading.
- Blackboard: no line down the Courses and Organizations pages, no band or bright line under Gradebook's header, and the open Announcements search is a pill.
- Blackboard: the What-if calculator in a course tab no longer stops at "Glaze couldn't load this course's scores", retries on its own, and shows category names such as Discussion.

## [3.3.7] — 2026-10-22

### Fixed

- Blackboard: opening an announcement in a course tab shows it in that tab, instead of a "We can't find that page" error.
- Includes everything in 3.3.6, which was not released to the stores.

## [3.3.6] — 2026-10-22

### Added

- Every built-in Look has its own pointer set (an arrow and a hand), an animation around the pointer, a typing effect and its own effects for completing, submitting, grades, streaks, the focus timer and Look rotation. Choosing a Look puts them all on; a Look code carries them.
- Typing effects: small particles at the caret as you type. They never read what you type, and never run in password, card or one-time-code fields, while composing, on quizzes or with motion off.
- Look › Pointer: keep the Look's pointer, use the system pointer, pick any of Glaze's pointer sets or a picture of your own, and turn the pointer animation on or off. Your choice stays when you change Looks, applies on courses with their own Look, and is never put in a Look or a theme code.

### Changed

- The pointer is part of the Look. A pointer chosen under the old setting moves into the Look you're wearing, once.

### Fixed

- Safari: Settings opened inside a Blackboard, Canvas or Moodle page no longer shows a blank panel.
- Safari: a Look's animations, effects, pointer animation, navigation and page tweaks load on course pages again, and reading Word and PowerPoint files there works.
- A course tab's animated background no longer stays on its blurred stand-in when a load stalls, and comes back after the browser takes its graphics away.

## [3.3.5] — 2026-10-22

### Added

- Glaze asks before running on a site that only looks like Canvas, Moodle or Blackboard Ultra, and records nothing there until the student says Yes. Canvas on instructure.com, Ultra on blackboard.com and sites already in use stay automatic. Settings → Privacy and data → Sites lists approved custom sites, with Remove.
- A shared Look's offer names every navigation item it hides, where each link goes, the page parts it restyles and any text it writes. A Look from someone else that hides Sign out or the profile, adds a link that isn't https, or disguises a link is refused, with the reasons shown.
- Share protocol v2 adds unambiguous signatures and safe share-creation retries. It stays off until a relay operator enables it; after a share uses v2, older members must update.

### Changed

- Selected bulk reads are queued per document and school site, pause after errors and rate limits, and read whole lists, reducing load and missed badges.
- Look background files live in the worker's database and are cleaned up when unused. Linked images and videos have size caps. New video and AVIF files have container metadata removed; uncleanable older files stay local and are not shared.
- Blackboard course records name their school; "Due this week" is kept per site. Draft backups are kept per site and student.
- An update that adds code to a no-code widget asks first. Removing a mod removes its data unless you choose to keep it. Mods can't send data off-site through navigation links.
- Shared notes keep syncing while you type, text syncs before files, and unused relay files are deleted best effort.
- The share relay bounds heavy traffic, limits new stored data per client per day, and expires shares after two unused years.
- Release scripts and CI use clean checkouts, pinned tools and separate credential-bearing work from third-party checks.

### Fixed

- With Glaze off, Blackboard Ultra loads plain on reload.
- Grades and GPA: range grade scales, failing grades below a scale, Ultra's percent text, XF/FN/IF/FA, J-Term order and four-digit years.
- Moodle keeps its Edit mode switch and the school's own menu links in Glaze's bar.
- Download all works in Blackboard course tabs, Settings opened inside a page saves, and an edited Dashboard stays as edited.
- Blackboard course tabs with unsaved work are never closed for another tab, and Ultra's own Sign Out works with course tabs open.
- Canvas's regional document viewers get Glaze's viewer, large Word, HTML and PowerPoint imports no longer freeze the tab, and zip downloads keep file extensions.
- Notes refuse to save or sync a note that would be cut short, with a warning. The focus timer chimes in background tabs and survives clock changes.
- Editing an imported syllabus row moves its To Do task instead of leaving an overdue copy.
- Changing a Look's palette keeps its navigation and other extras, with Undo, and contrast checks use the surfaces actually shown.
- Glaze's bar and shortcuts work with screen readers, IME input and right-to-left pages.
- Pets keep their streak and bonding through clock changes and come back after back/forward navigation.
- English uses singular and plural forms correctly, and a few untranslated labels are translated.
- Blackboard header buttons, announcement rows, Grades cards and Calendar bars no longer sit on dark patches.
- Store listings and the privacy policy describe what Glaze sends and stores accurately, including browser sync and opt-in sharing.

## [3.3.4] — 2026-10-21

### Fixed

- Blackboard pages use consistent themed backgrounds, rounded headers and controls, and spacing across discussions, assignments, documents, announcements, Activity, Calendar and grades. Activity icons stay centered, and Course Content headings have proper insets.
- Keep scene backgrounds continuous behind navigation and keep full-page panels clear of the bar, including retained course tabs and smaller windows.
- Improve course-tab navigation, sidebar and widget layout recovery, grade and due-date handling, and Settings behavior across Blackboard and Canvas.
- Correct saved Look, note-sharing and session handling, and stabilize validation and packaging checks.

## [3.3.3] — 2026-10-20

### Fixed

- Layouts, pets and other saved changes work again after installing over a Dashboard layout kept from an earlier version. The new-install setup no longer stops on that layout and blocks every save.

## [3.3.2] — 2026-10-20

### Fixed

- Keep scene backgrounds continuous behind the floating navbar and sidebar on Blackboard course content, tool pages and item panels, including retained course tabs.
- Recover animated and mod backgrounds after temporary startup failures.
- Keep fallback backgrounds behind the shared navbar while viewing retained Blackboard course tabs.

## [3.3.1] — 2026-10-20

### Fixed
- Blackboard assessment information shares the sidebar with docked widgets: Grades / Attempts on current assignment overviews, including submitted work and pages without optional Description or Assessment Details sections, and Details & Information while editing an attempt. Native rubric links, the editor and submission controls keep their existing behavior.
- Sidebar headers and controls stay below Blackboard breadcrumbs, document and assessment headers, and Canvas course-tab rows, including when those headers resize.
- Blackboard discussion participants render in the sidebar again. The column stays within the native discussion layout so participant loading and scrolling continue to work.
- The downloaded Mac app respects automatic-update preferences, keeps manual checks available, and reports updater failures and compatibility limits accurately.

### Changed
- Mac, iPhone and iPad setup guides explain Safari profiles and website access, include update and support controls, and pause status checks while inactive. The Mac guide can be resized; phone layouts, keyboard focus and status contrast are clearer.

## [3.3.0] — 2026-10-20

### Added
- Fresh installs: Glaze settings in the navigation bar and after To Do in the sidebar, and a Dashboard starter layout with pet habitat, focus timer, notes, quotes and course cards on Canvas and Ultra. Saved layouts and removals stay as chosen. Course cards fill even responsive rows beside the sidebar, following card size and gap settings.
- Mods and Glaze navigation: new permissions `nav.read` (read the bar, Worker only, as personal data), `nav.items` (up to eight items of a mod's own, linking only to the school's site) and `nav.layout` (a layout proposed over yours, with "Arranged by" and Use my own in the bar and in Settings → Navigation items). A mod's navigation replacement now stands in for Glaze's bar, and may open its items with `glaze.nav.go` right after a click.

- A sidebar on Canvas and Blackboard Ultra: the page's own sidebar and the widgets you dock under it, in one column at the right edge on wide windows and a drawer on narrow ones. Better To Do follows the page's course, or all courses; existing removals stay removed. Compatible widgets can move between the sidebar, the Dashboard and floating. Keyboard reorder and resize, Reset sidebar for this account, and the column stays above Glaze's footer and bottom bar. It covers discussions and assignments on both sites (recognized Blackboard Grades / Attempts and submission Rubric panels integrate visually without moving native nodes; attempt panels stay native), and Settings → Navigation → Sidebar sets its style (Floating by default, or Embedded, like the navigation), how it opens, its name, width, order, surface, corners, spacing, the room the page keeps, and where it shows. The Rubric uses its existing column's room without narrowing or moving the document viewer.

- Document review on recognized submitted-work pages: compact headers, expandable feedback, full screen and document focus with optional hidden Glaze bars. Focus suspends the sidebar and keeps the native rubric, grade, feedback and Close reachable. Editable and unrecognized pages stay native; the viewer remains in place.

- Canvas pages you've visited in a course stay live: Back, Forward and links back to them show them at once, as they were, while a fresh copy loads underneath. A link starts loading as you press it, the page on screen stays until the next one is drawn, and the page around the course tabs never reloads.

### Changed
- Mods' older `glaze.nav.items` transform reads Glaze's bar. Items a mod adds to the bar link only to pages of the school's site.
- Canvas pages kept for Back are quiet: their media pauses, and after a moment they aren't drawn at all. Embedded documents stay live to preserve tool and editor state.
- Canvas loads lighter: course-tab frames get the Look before their first paint and reuse the page's course list and colors instead of asking Canvas again; dashboard grades cover more than 100 courses; course widgets keep their picture while Canvas redraws its cards; a course's colour edit is saved even when you leave at once.

### Fixed
- Blackboard saved assignment drafts stay unsubmitted in due-date badges and Better To Do. Attempt dates and multiple saved attempts no longer count as proof of submission. Completed external-tool items keep their native completion status when Blackboard reports `NO_STATUS`.
- Canvas course card menus stay anchored to the correct native card or course widget after a redraw, save pending color picks when you finish choosing or close the menu, and return focus to the opener after editing card styles.
- Ultra submission reviews keep Rubric integration when Glaze's course-tab strip is beside the native review wrapper.
- Fresh defaults recover when a page starts before installation or Ultra registration, and after an interrupted install. Saved feature switches, later accounts, restored backups and synced removals keep their choices. Responsive widget rows respect saved card widths, right-to-left order and wrapped content heights.
- Canvas: a reload brings back a course tab whose course is the page's own; a link to a part of another page keeps its place; Glaze's bar keeps a same-site link of yours in the frames; the bar's course menu follows each page of a frame; module progress is asked again a minute after a failed request; Glaze's frames no longer keep pages they've left in memory.
- Canvas: delayed pages respect later selections; Back waits for an evicted page to draw; tab selections keep their history destination; saved course nicknames and colors invalidate the previous session snapshot. Retained embedded tools and editors keep their documents and skip automatic refresh.

## [3.2.0] — 2026-10-19

### Added
- Glaze navigation on Canvas and Moodle, on by default, as on Blackboard Ultra. Canvas's Courses, Groups, Account, History, Help and Admin trays, and Moodle's profile, notifications and conversations, open as Glaze panels; a course's own menu sits in the rail, or as a second row under a top bar.
- Widgets in the navigation: the clock, what's due next, the focus timer and your pet, at the top or bottom of the rail, as squares in the icons rail, compact in a top bar and in a phone's More sheet (Settings → Navigation → Navigation items → Widgets). Mods' navigation widgets sit under the rail's items and open over the page from a Widgets button with a top bar or on a phone.
- Live course tabs on Canvas: each course keeps its own page, and Dashboard, Calendar, Inbox and other pages outside a course open in a frame of their own, so course tabs never reload.
- Hide modules on Canvas's Modules page, as folders are hidden on Blackboard.
- Canvas course cards on the Dashboard's board as widgets, with Glaze's card menu merged into Canvas's.
- Glaze settings open as a page of the school site from the navigation, with the live preview; sharing keys, backups and mod permissions keep a tab of their own.

### Changed
- Course tabs fill the top bar and shrink before scrolling; a course tab's frame never shows a page outside its course, which opens in the page around it (another site in a new tab).
- On Canvas, a course tab's frame fills the window under the navigation, so the Look's background runs behind the bar.
- Widgets are on by default with none added.

### Fixed
- The navigation keeps working as plain links after Glaze is reloaded or updated under an open page.
- Unread counts follow their label instead of covering it; Ultra's routed pages, assignment back buttons and Canvas's sticky headers keep clear of the bar.
- Settings' Google Calendar dialog no longer trips the browser's autofocus block inside a school page.

## [3.1.0] — 2026-10-19

### Added
- Glaze navigation on Blackboard Ultra, on by default: Glaze draws its own bar in place of Blackboard's, the same in every Look. A side rail (open with labels, or icons with tooltips and a peek) or a top bar whose extra items move under More; floating over the page or embedded at its edge. On phones, a bottom bar of four tabs and a More sheet. Turning it off brings Blackboard's own navigation back.
- Inside a course the bar can stay the same, become icons only, become a top bar, or hide. Course tabs show in the bar too, and a new course tab placement, Only in the navigation, keeps them there with no strip.
- Navigation items: rename, re-icon, reorder and group every item, hide any of them, choose the four phone tabs, add up to eight links, and opt in to Notes, To Do, search and Glaze settings. The bar's logo can be Glaze's, the school's, your own picture (kept on this device) or none. Looks carry the bar's settings; mods can add items and listen through the navigation API.
- A Navigation tab in Settings holds the bar, its items and the course tab settings (moved from the Blackboard tab; old links still open them).
- Share sessions moved into Settings, with quick sharing of a note from Notes in a protected panel.

### Changed
- The pet habitat shows daily bonding moments, placed furniture and toys, wellbeing and progress, and wandering pets stay with the page as it scrolls instead of catching on the navigation bar or the footer.

### Fixed
- The Notes share panel opens at its full size, follows the Look, and says why when a click is refused instead of doing nothing.
- Course tabs recover when their pages stall and keep clear of panel headings; Ultra panel gutters and close buttons are kept.
- Animations recover after a failed start, pet overlays no longer shift the Dashboard, and Ultra's Activity Stream hover no longer covers themed cards.

## [3.0.6] — 2026-10-18

### Fixed
- Blackboard readers preserve incomplete-data status when pagination reaches its limit. Grade calculators, GPA totals and current-term history withhold calculations from partial gradebooks or grading schemas; Insights marks partial work and omits its grade trend. Saved what-if scores remain intact.
- Course search identifies partial coverage in both visible results and screen-reader announcements, including cached searches and exhausted page or request budgets. Existing read limits remain.
- The short privacy guide explains encrypted sharing, mod permissions, conditional blocklist requests and sensitive keys in private backups, with links to the full policy.
- Public documentation identifies Google Calendar sync as unavailable while verification is pending; calendar file export remains available.
- Direct Safari development resources match the current extension. Both Xcode extension targets reject stale, missing or obsolete generated resources before copying them into an app.
- Tag packaging runs the full suite on Node 26 before producing an artifact. Firefox release packaging requires its compatibility branch and clean tracked sources; explicitly requested development packages are visibly identified and record their source commit.
- Contributor and feature-decision references point to maintained development documentation.

## [3.0.5] — 2026-10-17

### Added
- Career-long pets with continuing levels, account-scoped progress and settings-backup transfer across semesters.
- Room, garden, aquarium and cloud habitats, freely placed furniture, shelves, water physics and draggable ball/yarn toys that invite a short play session outside the habitat.
- Local adaptive behavior with twelve activities, six needs meters, learned routines and toy preferences. Petting, play, moving away, habitat changes and time of day shape the pet's choices; learning can be disabled or reset independently of XP.
- New climbing, sleeping, playing, peeking, XP and level-up animations for all ten bundled characters.

### Changed
- Pets spend more time settled on favorite perches, watch the cursor and make short excursions. Typing, scrolling and focus discourage active behavior.
- Shared pet animations blend frames and transition smoothly between poses, while idle, hidden and reduced-motion displays use less work.
- Wandering pets and dropped toys belong to page content, including native scrolling panes and the active same-account Blackboard course frame. Awake pets gently return into view after scrolling; sleeping pets stay settled.

### Fixed
- Older task backups preserve settled pet XP and newer learned state. Shared timer and XP feedback is applied once across tabs.
- Furniture placement, keyboard focus, habitat-dialog handoff, lazy avatar loading and recovery onto partially visible perches remain consistent.

## [3.0.4] — 2026-10-17

### Added
- Mods. Install them from a code, link, file or the gallery's Mods section; each one lists what it may read and why before you add it. Mods can bring backgrounds (shaders, layered scenes, videos, animated pictures and Lottie animations), motion and event effects, nav layouts, rules that restyle, hide, move or relabel parts of your LMS pages, sticker and pet packs, and widgets for the dashboard and rail.
- A widget builder in the Mods tab: make a dashboard tile or rail widget from text, numbers, rings, lists, countdowns, pictures and buttons, with no code.
- Code mods on Chrome run sandboxed, away from your LMS pages. A mod that reads your courses, to-dos or grades runs without a page of its own and its interface is drawn by Glaze. Firefox and Safari get mods without code.
- Signed updates: an update must come from the same author, and you are asked again when it wants more access. Follow a mod's channel to get its updates, and a signed blocklist (on by default, can be turned off) turns off mods found to be harmful.
- For developers: dev mode, the mods API reference (docs/mods-api.md), TypeScript types and example mods.
- A Look's background can be a looping video, an animated WebP or AVIF, or a Lottie animation, from a link or a file. It is always muted, holds still when motion is off and pauses while the tab is hidden.
- Gallery Looks and mods can have a video or animation background. "Use this Look in Glaze" downloads the Look's file from the gallery and keeps it only if it is exactly the file the Look names; a mod carries its file inside its signed bundle (`./<path>` in `parts.bg.media.src`).

## [3.0.3] — 2026-10-16

### Changed
- The pet habitat, Study buddy widget, Blackboard navigation badge and course-card pet share one character choice on this device. Their visibility switches stay separate; XP, outfits and decorations stay with each school's signed-in account.
- All pet displays react to the focus timer and completed To Do tasks. Interactive pets respond to clicks and keyboard play; animation pauses while hidden and follows reduced motion and Glaze Motion off.
- The original Cat and Bunny can be selected in the pet habitat alongside the animated companions and local imports. Removing a selected imported pet returns to Classic buddy and preserves progress and decorations.

### Fixed
- Blackboard file previews refresh expired viewer tickets for the same document. Previews opened while an uploaded file is still converting retry for up to five minutes.
- The Blackboard navigation pet's level comes from the signed-in account's pet record, independently of the planner cache. Late storage reads cannot replace newer character or timer changes.

### Added
- A dedicated Firefox for Android emulator launcher and testing guide. Android runtime acceptance and physical-device testing remain separate from desktop release validation.

## [3.0.2] — 2026-10-16

### Changed
- Course tabs keep up to four live course pages on every machine again, and a hidden page no longer closes after ten idle minutes: picking any open tab is instant.
- Faster Blackboard Ultra. Every button press, hover and menu used to make the browser restyle the whole page, because a few of Glaze's `:has()` rules matched broadly and tested Ultra's generated class names. The nav, the document view and the tooltips now use attributes Glaze sets as Ultra draws them. Measured on a large synthetic course outline: main-thread work while clicking around fell from 3.0 s to 0.4 s per 3 s, and the browser draws about 2.5× as many frames. Pages are themed in 0.4 s instead of 1.0 s, and route changes take a third less work.
- The course-tab strip no longer forces a layout on every change Ultra makes; it re-checks when the course bar or its own place changes, or when the bar's size does.
- Hide folders repaints only when a row, a folder title or one of its own controls changes, not on every ripple or tooltip.
- Startup reads only Glaze's own settings, reuses this tab's last palette on Ultra (no default-dark flash before storage answers), and lets the browser cache font files. The background worker loads the grade, GPA, Insights, syllabus and class-schedule code when a page first asks for it (32% less script on every wake).

### Added
- A Firefox package (Firefox 140 or newer), built from the Chrome one by `scripts/package-firefox.sh`. Google Calendar sync is not included, as in Safari.

## [3.0.1] — 2026-10-16

### Changed
- Lighter Blackboard course tabs: machines with six or fewer CPU cores keep up to two live course pages; other machines keep up to four. Clean hidden frames can close after ten idle minutes, while edited pages remain protected. Hidden frames pause covered work and the page below a shown frame is not drawn.
- Course-tab pictures use lower JPEG quality and a fifteen-second capture guard. Snapshot bookkeeping reads keys and sizes without loading all pictures. Solid backgrounds skip panel glass blur, and the Expressive pointer light loads only on demand.

### Added
- Shared surface controls for Blackboard Ultra, Canvas and Moodle: opacity, existing glass blur/depth, custom color, accent/course tint, shadow strength and color, fine frost and border strength. The Look tab has a searchable, linked Surfaces section with individual and section resets and the real previews. Surface backgrounds follow global corner radius.
- Animated local pets, with five original companions, the owner’s existing Rime, an animated Glaze droplet, and local import of ChatGPT v1/v2 sprite sheets or ZIP packages. The habitat keeps existing XP/decorations; animation stops while hidden and respects reduced motion and Glaze Motion off. Imports are validated and re-encoded in Glaze’s editor, never fetched from a link or uploaded.

## [3.0.0] — 2026-10-15

Glaze 3.0 makes Blackboard Ultra as capable as Canvas, all on your device: a Glaze Dashboard, widgets you place
anywhere (Better To Do and your course cards among them), course tabs that stay live like browser tabs, search in your
courses, hidden folders, navigation styling, planning, reminders and Insights. Moodle joins Blackboard and Canvas.
Settings move into tabs with search, and optional encrypted share sessions can use frostdev.io's relay or your own.

### Changed
- **Course tabs keep their pages alive, like browser tabs.** A course tab picked from the strip now runs as a live
  Blackboard page in a frame over the window, kept running while you're on another tab: text you typed, an upload or
  submission under way, open folders, an open document or assignment and the scroll are all still there when you
  pick it again, and switching is instant. Up to four framed course pages stay live alongside the surrounding page (the least recently shown stops first; it opens
  again at its saved URL and scroll). Edited pages are protected from automatic eviction; when all four are edited, another waits until you close one. Explicit close, reload and disabling can discard unsaved work. While a tab's page first loads, a blurred picture of how it last looked, with a spinner,
  covers it. Any page of the course is remembered, exactly. Glaze's host access becomes `<all_urls>` (Chrome requires
  it to take those pictures; its install warning is unchanged), and the covered page's animated scene pauses.

### Fixed
- Live course frames cannot overwrite newer tab-list changes with stale saves. Closing a saved tab destroys its live frame, hidden frames pause their scenes, and edited frames stay out of automatic eviction. Privacy and settings text now describe live pages and JPEG captures.
- Ultra navigation keeps its native fixed position with custom backgrounds, collapses the MUI rail to its intended width, and centers the expand control in right-to-left layouts.
- Settings Back/Forward survives preview site changes. Precise navigation dimensions and Blackboard nicknames have usable editor controls; course edits repaint the preview, and open Share sessions pages follow relay preference saves without connecting.
- Course tabs stay visible on Ultra's full routed documents and assessment overviews, preserving
  their URL context and content scroller. The later live-page design remembers any own-course page, including attempts. Saved page and scroll wait for native content to arrive;
  a refreshed native gradebook immediately replaces an older Assignment classification. Floating widgets keep clear
  of the routed native header as well as the strip.
- Course tabs use automatic short names by default, removing common term/section wrappers and spacing subject codes.
  Nicknames still win, saved full-name/code choices stay intact, and the full name/code remain in tooltips and accessible names.
- Ultra route changes show immediately instead of waiting behind Glaze's separate loading gate. Internal widget
  updates no longer trigger native-page sweeps, and an unchanged gradebook keeps its successful empty late-status answer.
- Tabs left open across an extension reload stop feature work immediately; Google sync and Download all close orphaned
  timers/ports safely, and animated scenes stop and release their rendering resources. Shared JSON API reads reject login redirects.
- Widget callbacks left in a tab after reloading Glaze stop before using invalidated Chrome APIs, including the study
  buddy repaint and What Glaze can do hub.
- Blackboard widgets retain the newest layout and timer state when storage replies arrive late. Explicit global floats
  also work from the default Dashboard, respect right-side navigation, resized course tab strips and footer bounds, and
  remain available on the native Institution tab. Landing checks current settings and claims each tab once in the worker;
  unavailable widget files leave the native Institution page reachable.

### Added
- Ultra course cards can be added as individual widgets on Courses or the Dashboard: move, snap, resize, fold or remove each card, with separate per-board layouts and a quick return to Ultra’s native list and filters. Cards reuse already-loaded course data, stored tasks, native or chosen colours, hover effects and motion-safe pets, without additional course or gradebook requests.
- **Tabbed settings and custom share relay.** Eight tabs provide cross-tab search, section links and safe preference resets, with a local preview at desktop or phone widths. Share sessions can save an HTTPS origin (or localhost HTTP for testing) for new sessions, test `/health` with a bounded deadline, and explicitly confirm custom invite hosts before joining. Existing sessions and restored keys keep their original server. HTTP requests omit browser credentials and refuse redirects; device-local host consent stays separate from browser permissions and sync. A public self-host guide covers Node/Docker, TLS proxies, disk/R2 storage, backups, limits and updates.
- Blackboard Ultra: hide folders and learning modules locally, with **Show hidden folders (N)** / **Hide them again (N)**, a pressed eye toggle, dimmed **Hidden** badges included in accessible names, and brief saved-action feedback with keyboard-friendly **Undo**. Choices stay separate by account and course and are included in Export all; imports preserve existing choices when records are malformed.

- **Blackboard navigation:** the newer MUI drawer and legacy rail now share Glaze's styling, with a bundled Glaze logo
  at first paint, school/device-only custom logos, precise sizes and spacing, custom http/https links with built-in
  icons, reversible native-item order/hiding and Reset. Institution page reads Dashboard at the same link while
  Glaze's Dashboard is enabled. Optional clock/date, planner-backed next-due item, shared focus timer and pet level can sit at the top or bottom. The editor previews
  the real Ultra nav rules, with compact rows, ellipsis/wrap/shrink labels, tile/pill/flat items, active indicators,
  logo alignment and footer controls, section resets, drag/keyboard reordering and a collapsed-rail hover/focus/touch overlay
  that keeps page content in place. Navigation settings and custom links
  are included in Export all. Next due stops pending reads when its widget or page changes and backs off failed reads
  for a minute; callbacks from an invalidated extension stop scheduling.

- **Optional encrypted share sessions.** Create/join by pasted invite, copy view/edit invites, see encrypted editing-device last-seen information, pause/resume, leave locally, creator deletion and opt-in one-year expiry. Selected notes/folders and encrypted files, the current Look, and selected custom tasks/plans stay copied locally and catch up when reopened. Looks apply only by explicit choice; joined data never replaces existing app items. Recovery can re-upload retained files after a relay restore. Notes import/Export all now use an extension-only backup surface; all settings/notes backups always include session keys and creator delete tokens with a private-backup warning. On-demand only, with no LMS first-script increase or new dependencies. Relay deployment and native Safari/Firefox live checks remain separate.

- **Share-session review fixes.** Pause/leave/delete interrupt busy syncs; old callbacks and closed views cannot reconnect. Changed file references are validated before cached bytes are reused, local-session reading stays visible, and extension caller/import checks fail closed.

- **Planning on Blackboard Ultra.** Better To Do (on by default), tasks on course cards, reminders and the streak, Export
  calendar (.ics), the class schedule, Gradescope in To Do and Google Calendar sync now work on Blackboard Ultra too: the
  same features, settings and words as on Canvas.
  - Better To Do takes the place of Ultra's own To Do on the Courses page (Ultra's comes back the moment Glaze's list goes)
    and is a block beside a course's content on its outline, with that course's work. Your own tasks, steps, "do on" days
    and focus sessions work as on Canvas; ticks stay on your device (Glaze never writes to Blackboard).
  - What's due comes from Ultra's To Do list and calendar, read in the parts Ultra allows, and what you handed in, late,
    missing or excused from each course's gradebook; an item Ultra can't place in a gradebook shows with no status. If
    Ultra can't send the calendar whole, the list (and a saved export) says some work may be missing. Days are in your
    browser's time zone. One read serves the list, the cards and the reminders.
  - Tasks show under each card on the Courses page; a task's link opens the task, not the course.
  - Reminders show on Blackboard pages, never on a test, assignment or tool page.
  - The class schedule matches classes to your Blackboard courses by code, then name, and reads a calendar link only on
    your own Blackboard site. Glaze never reads or makes Ultra's own "Share calendar" link.
  - Gradescope courses can be placed with Blackboard courses (not yet checked against a real school with Gradescope).
  - Google Calendar sync also runs from Blackboard pages, behind the same build switch (still off).
  - The planning features' styles moved to `features/apps.css`, linked on Canvas and Blackboard.

- **Search in your courses on Blackboard Ultra:** the same Ctrl/⌘K search and switch as Canvas, now finding available
  content titles and released public document, announcement and discussion topic text, with native type labels. Current course and term first, up to
  24 results; open current-term courses only, nothing stored, five-minute cache reuse, cancellation on typing, closing or disabling. Unknown release conditions are omitted and transient errors retry after backoff. Read-only public
  lists only, bounded to 30 requests per query and two pages per list. No addition to any site's first content script.
- **Free-placed widgets and a Glaze Dashboard on Blackboard Ultra** (B7b; the Courses page and the floating widgets with
  the Notes and Widgets switches, the Dashboard with its own, **Glaze Dashboard**, on by default):
  - The Courses page's widgets float over the page instead of sitting in the side column. They start where the panel
    had them, at the top of its right column, which keeps room for every widget over it (Ultra's To Do and Better To Do
    are never under one); the panel keeps its bar (Edit layout, Reminders, What Glaze can do, Insights).
  - The Institution page becomes Glaze's **Dashboard** (on by default; Glaze Dashboard in the editor, What Glaze can do
    and Ctrl+K): two tabs in its header (a real tablist: arrow keys, Home, End; above the board where the header has no
    place for them), *Dashboard* (the default, and the page's heading says so; its own layout, starting with Canvas's
    default widgets and Better To Do as a widget) and *Institution page* (Ultra's own page and heading, themed; the
    Dashboard board hides, while any widgets explicitly floated over every page remain). The last tab is kept. Ultra's
    page waits hidden until the Dashboard is drawn, so it doesn't flash first.
    The Dashboard's widgets need no other switch (the notes and the pet keep theirs); with every widget off it says how
    to add them. Ctrl+K has a Dashboard entry.
  - **Edit layout** (then Reset layout and Done; Esc ends it too) moves a widget anywhere, by its heading or with the
    arrow keys on its handle (a grid step; Shift: four), and says where it went. It snaps to a 16px grid, the page's
    edges, the other widgets' edges and centres and Ultra's column, with a guide while you drag; Alt places freely. The
    one you moved goes on top. Fold any widget to its heading. Outside Edit layout a click never moves anything.
  - Each board keeps its own layout on this device (which widgets, size, place, folded, stacking order), kept from the
    nearer side so it holds as the window changes. A window narrower than the one you arranged in stacks the widgets in
    reading order instead, and the layout comes back on a wider one. Today's layout carries over: every widget that was
    on stays on, on the Courses page where the panel had it. The notes, timer, music link and pet are shared.
  - **Float on every Blackboard page** (⇱ in Edit layout): a widget leaves its page's layout and floats over every Ultra
    page, once (never on a board at the same time), from the window's bottom right, clear of the nav, a course's top bar
    and Glaze's footer; moved, snapped, announced, folded and stacked as on the boards, and one column at the window's
    edge when the window is too narrow. ⇲ puts it back where it was on the page's layout. Widgets that floated over every
    Ultra page before still do, at their place. Canvas's floating widgets are as they were.
  - **Open Blackboard on the dashboard** (off by default): when Ultra opens on its start page right after sign-in (its
    bare address, or its stream or Courses page coming from the sign-in page), go on to the Dashboard once in that tab.
    Never on a reload or Back, never from a page you opened by address, bookmark or link, and not if you clicked, typed
    or went elsewhere meanwhile. The tab is remembered by Glaze's background page, not the school's site.
  - Every change to the layout goes to Glaze's background page as a change (this tile on this board), applied to what
    is stored then, so two tabs never undo each other's. The focus timer's Start, Pause and Reset go through one queue
    there too (shared with the nav's timer), say so if it couldn't change, and never show an answer older than what is
    stored since.
  - `scripts/ultra-boards-check.js` checks it all headless on synthetic Ultra pages, with screenshots.
- **Notes and widgets on Blackboard Ultra** (the same Notes and Widgets switches, off by default): Ultra has no
  Dashboard, so they sit in Glaze's panel at the top of the Courses page's right column, above Ultra's own To Do. Its
  heading folds it away (kept on this device); on a narrow window Ultra puts that column under the courses, and the
  panel with it. The notes box, the agenda (that day's Ultra To Do and calendar items, with your submissions), the
  focus timer, quote, music, breathing and study buddy work as on Canvas, and any of them can float over every Ultra
  page. **What Glaze can do** lists the extras that work on Ultra, and the panel opens the reminders when they're on.
  - The notes app on Ultra: Ctrl+K (Notes, New note, Course notes), the notes box, and **Course notes** at the end of
    a course outline's right column. **Blackboard link** picks from the course's content items (link and title only).
    Kept per Ultra site and account, with every safeguard Notes has on Canvas.
  - Other files can add a tile the same way on both sites (`features/widgets.js`, `MORE` and `register`).
- **Blackboard Ultra appearance:** shared course-card editor (solid, gradient, picture, overlay, crop and filters), grid layout and motion-aware effects/pets, bookmarks, and base-navigation backgrounds, labels and sizes. Ultra list rows keep their native layout. No new viewer host access.

- **PDFs and photos in the imports** (class schedule, syllabus, transcript), read on your device: a PDF's own text
  (tables kept as rows, two-column pages in order), and the text of a scanned PDF, a photo or a screenshot (PNG, JPEG,
  WebP, HEIC where your browser opens it; or paste one into the import's text box) recognized by the Tesseract OCR engine,
  bundled with its English, German, Spanish, French, Dutch and Portuguese models. Nothing is uploaded or downloaded for
  it. A progress line and Stop reading while it works; closing the dialog stops it too. When the text came from a
  picture, the review says so and marks "Check this" on what came from a line the engine wasn't sure of. Password-
  protected and broken PDFs get a plain message. The extension grows by about 10 MB (the OCR models), and its pages may
  now compile WebAssembly ('wasm-unsafe-eval' in its content security policy); no new permission.

- **Pet habitat**, opt-in and local: the study buddy earns XP from already-stored handed-in work, W11's verified closed streak days and W17 kept do-on plans, with five levels, unlockable looks and a keyboard-friendly habitat editor. Canvas and Ultra share one widget, palette renderer, account helper and app stylesheet; Ultra's hub offers Streak beside Pet habitat. Rewards reconcile idempotently through the background broker per site and account. Streak rewards stop at W11's saved calculation day; restores add days once. Historical hand-ins and kept plans can earn their first reward outside the planner window. Existing synced values stay settled until their native row returns; a fresh source proving a newer provider hand-in can also update work credit. Local, synced and manual unticks revoke work/plan credit; clearing Insights and deleting finished history preserve settled XP. Bounded records fail closed without resetting progress, and failed module loads back off quietly. No focus-session XP, notifications or missed-day losses. Includes original matching bandana artwork (9,760-byte transparent WebP), all six languages and table tests for the XP rules.

- **Notes** (Canvas, off by default; the Dashboard notes' switch, now called Notes, turns on both): a notes app over
  the page, from Ctrl+K (Notes, New note, Course notes), the Dashboard notes tile, a course card's create menu, Course
  notes on a course's home (there as soon as Notes is turned on), or a class reminder. It opens and acts only on your own
  clicks and keys.
  - Folders for a course or free-standing; rich text with headings, bold, italic, underline, strikethrough, lists,
    checklists (Ctrl/⌘+Enter ticks), quotes, code and links (Ctrl/⌘+K); pictures pasted, dropped or added (PNG, JPEG,
    GIF, WebP up to 5 MB) and attachments (up to 20 MB, downloaded, never opened in the page); links to a course's
    Canvas files, pages and module items picked from a list, kept as link and title only.
  - Search in titles and text, sort by last edited, created or title, filter by course or folder, a note count; rename,
    move and duplicate notes; rename, reorder and delete folders, choosing whether their notes stay (with no folder) or
    go to the trash with them. A trash keeps notes and folders 30 days, with restore and Empty trash.
  - Export a note as Markdown or HTML, or everything as a zip of Markdown, pictures and attachments (with a
    `notes.json` that imports back exactly). Export all first stores what you just typed, and makes no file if any
    note or picture can't be read. Importing keeps each note's identity: one already here is replaced only by a newer
    copy, so the same export twice adds nothing, and Notes says how many it skipped.
  - Every paste, drop, save and load goes through an allowlist sanitizer: no scripts, event handlers, styles, frames,
    forms, or `javascript:`/`data:` links; links open with `rel="noopener noreferrer"`; a picture from another site
    becomes a link instead of loading. The same note changed in two tabs keeps both: the later save becomes a copy.
  - Kept on this device per Canvas site and account: the index in `storage.local`, text and files in the extension's
    own IndexedDB through the background worker, never the school page's storage; a save that fails leaves the note as
    it was, and anything a failed step leaves behind is cleaned up the next time Notes opens. Storage used is shown,
    with limits and a clear message. No new permission, and nothing added to the first content script. The Dashboard
    notes stay as they are and get an Open Notes button.

- **Moodle: tint, Looks, the course menu and keyboard shortcuts.** A Moodle course can tint its pages and wear its own
  Look, on its course page, its activities and its card on the Dashboard and My courses, set from the course menu on
  that card or in
  the editor, where Moodle courses are listed in the colour Moodle gives them. The keyboard shortcuts work on Moodle
  as on Canvas: `g` then `d`, `c`, `a`, `g` or `m` for the Dashboard, My courses, the calendar, grades and messages,
  `g` then `?` for the list, on Moodle's main pages and a course's sections and activities, never while typing, in
  a quiz being taken or in an editing form. Each course is kept by its site (Moodle's folder too) and id, apart from
  Canvas's, so nothing moves. The course list is read from your own Moodle, read-only, at most every ten minutes for
  each Moodle site.

- **Insights** (Canvas, off by default): an Insights button on the Dashboard, or Insights in Ctrl+K, shows your term
  in numbers, worked out on this device: how much you handed in on time per course and overall (late, missing and
  excused apart, and the best run of weeks with everything on time); each course's grade after each piece of graded
  work by Canvas's own rules, as sparklines; the work due each week with the three busiest weeks ahead; how often your
  Better To Do "do on" days and focus sessions were kept; and a summary card you can save as a PNG. Every chart has a
  table of the same figures. Only a small summary of this term is kept on this device, until you clear it. No
  comparisons with anyone, nothing timed or tracked, nothing sent anywhere.

- **Class schedule (Canvas):** Ctrl+K, Class schedule (or the agenda widget's button) imports your timetable, read on
  your device and never uploaded.
  - From an `.ics` file or a calendar link on your own Canvas site (weekly rules, cancelled and moved meetings become
    days off; one-off events such as exams are left out), a registrar's page saved as HTML, a Word file (.docx), or
    pasted text: Banner, PeopleSoft and Workday copies, plain lists ("BIO 110 TR 1:30-2:45pm Life Sciences 120"),
    24-hour times, "14h30", "Uhr", and day names and abbreviations in English, German, Spanish, French, Dutch and
    Portuguese. Term dates and holidays ("Thanksgiving break: Nov 25–27") are picked up; office hours aren't classes.
  - A review screen before anything is kept: each class matched to your Canvas course by code or name (labelled with
    the site and code), or kept as not a Canvas course; days, times, place, first and last day and days off all
    editable; what Glaze guessed is marked "Check this". Nothing is saved until you choose Save.
  - View, edit and delete each course, add a class by hand, or delete all. Kept on this device per Canvas site and
    account; a save from another tab made before a deletion doesn't bring a course back.
  - Export calendar (.ics) can include your classes ("Your class schedule"), one event per meeting in the range.
  - The agenda widget shows the day's classes with your work. Class reminders (off by default; Reminders hub or the
    editor) remind 5, 10, 15 or 30 minutes before each class, inside Canvas like the others.
  - Photos and PDFs aren't read yet.
- **Export calendar (.ics)** (Canvas): Better To Do's Export button, or Export calendar (.ics) in Ctrl+K, saves an
  .ics file of your Canvas deadlines, your own tasks with a due date, "do on" days and focus sessions, and Gradescope
  work (for a Canvas account that said yes to it), each part optional, for the next 2, 4, 8 or 16 weeks or the current
  term. Import it into Google Calendar, Outlook or Apple Calendar; stable event identifiers mean a newer file updates
  the same events where the calendar supports it. Made on the device, downloaded by the browser (no new permission);
  the choices are remembered and also in the options page. No subscribe link: that would need a server.
- **Google Calendar sync** (Chrome, off until you connect; Glaze's settings, Google Calendar sync): a calendar named
  Glaze in your Google account, kept up to date with the same events and choices as Export calendar (.ics). Built in,
  but behind a build-time switch (`lib/gcal.js` `ON`) that stays off until Google verifies the app: released builds
  show nothing of it, and their manifest has no `identity` permission or `oauth2` client.
  - Chrome's own Google sign-in (`chrome.identity.getAuthToken`, an optional `identity` permission asked for on your
    click, with no install warning) and one scope, `calendar.app.created`: Glaze can manage only calendars it makes,
    and never sees your others. No Glaze server; requests go only to `www.googleapis.com` and, to revoke access,
    `oauth2.googleapis.com`, without cookies and without following redirects.
  - Incremental: events keep stable IDs (a hash of the Canvas account and the event's identifier), only what changed
    is written, past events stay as history, and changes made in Google come back through Google's sync cursor.
    Requests are spaced out, at most 150 writes a run, with exponential backoff on 429, rate-limit 403s and 5xx, and a
    fresh token after a 401.
  - Deadlines, tasks, Gradescope work and classes mirror Canvas: an edit in Google is written over, a deletion
    stays. A "do on" day or focus session moved or deleted in Google moves or clears the plan in Better To Do, unless
    you changed it here since. No reminders on the events; they show you as free.
  - It runs from Canvas pages: on open if the last sync was 15 minutes ago or more, every 15 minutes while one stays
    open, and 10 seconds after your plans, schedule or choices change. No `alarms` permission.
  - **Link another device**: a code (the calendar's ID) to paste on another computer, so both keep one calendar
    without Glaze listing your calendars.
  - **Disconnect**: optionally deletes the Glaze calendar (asked first), revokes Glaze's access, has Chrome forget
    its tokens, removes the permission and deletes what Glaze kept for it.
  - Edge, Brave and Safari show a note pointing to the export. `scripts/dev-gcal.sh` builds an unpacked copy with the
    store's public key, for testing with the real OAuth client; the store package never carries it.
- **Past terms, GPA trends and a GPA goal** (Canvas, with the GPA on): add earlier terms by hand or import them from a
  transcript's text, a web page or a Word file, read on this device and always shown for review first (the transcript's
  own term GPA is checked against Glaze's). Plus/minus or whole-letter scales per term, credits, honors and AP;
  pass/fail, withdrawn, transfer and incomplete courses are listed but left out. The Dashboard's GPA gains an overall
  figure with past terms, a chart of term and cumulative GPA (with a table of the same figures for screen readers),
  and a cumulative or term goal: what this term needs, whether it's in reach, and one route there from your grades
  now, with the lowest percent for each letter and, per course, what the work left needs. Ctrl+K: GPA: past terms,
  trends and goal. Free, unlimited and kept on this device; nothing is uploaded. PDF and photo transcripts aren't
  read yet.

- **Syllabus import** (Canvas, off by default): read a course's syllabus on your device, from its Syllabus page, a
  Word, PowerPoint, web page or text file, or pasted text, in six languages. Every field (professor, office hours,
  class times, exam and due dates, grading scale, weights) is shown with the line it came from for you to correct
  before anything is kept. Saved, it shows on the course home, can set the course's scale in your GPA, adds the dates
  you pick to Better To Do and lists the weights beside the what-if calculator. Nothing is uploaded. PDF not yet.
- **Canvas sidebar:** style Canvas's native global navigation with a solid color, two-color gradient or picture
  (an https link or local file), filters and an overlay. Choose text and icon colors, normal/small/icon-only labels,
  three sizes, logo visibility and a collapsed rail. Native links keep their labels and keyboard access. The
  editor warns below 4.5:1 and previews the background; colors are never corrected automatically. Theme codes
  can carry sidebar appearance, with linked pictures only; layout preferences stay yours. Codes with sidebar settings need
  this Glaze or newer; the gallery checker needs its next vendor update. Canvas only.
- **Looks gallery:** free Looks and palettes shared openly at frostdev.io/glaze/looks, with no accounts,
  likes or tracking. **Use this Look in Glaze** there opens the editor with the Look in its preview;
  nothing changes until you choose Use this theme. A code made of a palette alone changes only your colors.
- **Favorites:** save a gallery Look or any theme code from its preview, and preview it again later.
  Kept on this device.
- **Stickers:** 51 stickers in four packs (study, cozy autumn, space and sky, critters), or your own pictures, on any
  course page. Ctrl+K, Place stickers on this page: drag to move, drag the corner to resize, turn a little, remove;
  every step works from the keyboard too, and a list shows all the stickers on the page. They never take a click
  from the page, and never show on a quiz you are taking. Free, unlimited, kept on this device.
- **Pointers:** three pointer sets (Aqua, Lilac, Pearl), each with its own hand for links and buttons, or a PNG or
  JPEG of your own scaled to 32 pixels. Text fields keep the usual text cursor. Course pages only.
- **Look rotation** (off by default): wears the next of the Looks and favorites you choose every 6, 12 or 24 hours,
  every week, or every day at a set time. One timer to the next change, run on this device; Ctrl+K has Next Look now.
- **Looks history and Previous Look:** the last 20 themes you wore, from the popup, the editor or Ctrl+K,
  with one click back to the one before, in the editor and on the popup's Looks sheet. Free and unlimited;
  kept on this device.
- **Canvas course cards:** give each Dashboard card its own color, two-color gradient or picture (a link, or a
  picture from your computer, scaled down and kept on it), with a picture filter (vivid, mono, noir, warm, cool,
  faded, dreamy), focus point, zoom, and overlay color and strength. The list view's course banners follow. Free,
  like everything in Glaze. Opened from the card's course menu (Card style and bookmarks).
- **Course bookmarks:** up to eight links per course, each with a name and an icon from Glaze's own set, shown as
  icons on its card. Add, edit, reorder and hide them; turn the icons off. Glaze asks the linked sites for nothing.
- **Card layout and effects:** card width, space between cards, corners, picture height, condensed cards (the name on
  the picture), Canvas's color over pictures on or off, hover effects (lift, glow, tilt, grow, shine), particles
  (sparkles, snow, bubbles, confetti) and a pet (cat or bunny) on your first card. All of it moves only while motion
  is on.
- **Create button on cards** (off by default): message the class, or start a discussion where the course allows it.
- **Contrast warnings for cards:** with condensed cards, the card editor shows how well white text reads on the card
  (the measured ratio) and warns below 4.5:1. It never changes your colors.
- **Font search:** typing in the font list filters it; a name that isn't in the list is tried on Google Fonts.
- **Theme codes and Looks carry course cards:** how cards look, and up to eight card styles that take turns on the
  cards without their own. Only linked pictures travel; a picture from your computer never leaves it. A code with
  card settings needs this Glaze or newer; the Looks gallery's checker learns them with the next release. A code that
  would be too long (many card pictures with long links) is refused when you copy it, with the reason.
- **Scheduled dark mode:** auto light and dark can follow a schedule instead of the system, dark from one time
  until another (20:00 to 08:00 by default, past midnight too). It switches on time while a page is open, and a
  page opened after the switch starts in the right palette. Set it in the editor, the popup or Ctrl+K.
- **Keep quizzes light** (Canvas, off by default): no Glaze on a quiz you're taking or its history, and on
  external tool pages such as New Quizzes.
- **Canvas: a what-if calculator** above a course's grades (the What-if calculator Extra, now on Canvas too). It
  works out your grade by Canvas's own rules: weighted groups, dropped lowest and highest scores (the set that
  helps most, not just the lowest percentages), excused and omitted work, grading periods and letters-only
  courses, and it matches the totals Canvas shows. Try scores for work not graded yet, change real ones, leave
  work out, add pretend assignments, and see the even score you'd need on what's left for a target. What you
  change is kept on this device, per course, until the real grade arrives (Glaze tells you when one goes), and
  is never sent to Canvas.
- **Canvas: GPA on the Dashboard** (off by default): your GPA for each term and across your current courses, on a
  4.0 or plus/minus scale, weighted for honors (+0.5) and AP or IB (+1) if you like, above or below the cards.
  Set credits, a grading scale of your own and a what-if grade for each course.
- **Card grades:** click a grade on a Canvas Dashboard card to open that course's grades (with the keyboard, Tab to
  the card's grade link), or show card grades only when you point at the card.

- **Better To Do (Canvas, off by default; turn it on under Extras):** Glaze's own To Do list in place of Canvas's,
  on the Dashboard and on a course's home page (that course only). Grouped by day in your Canvas time zone (past due,
  today, tomorrow, this week, later, no date), or one list by date; what's done, what's graded and announcements
  (unread first) apart. Relative or exact dates, urgent items marked, and how long past-due work stays.
  - A custom timeframe of any number of days or weeks, from today or from the start of your week. Free.
  - Your own tasks (with a course, due date and notes), steps, a "do on" day and timed focus sessions on any item
    (a planned item still shows under its due date until it's done),
    kept on this device and included in Export settings.
  - Done follows your submissions, or only what you tick. "Tick off in Canvas too" marks items done in Canvas's own
    planner, as Canvas's List View does; Glaze's first and only write to Canvas: opt-in, only from your own tick, and a tick Canvas doesn't confirm goes back and is checked with Canvas again.
  - For teachers: work waiting to be graded, and how much of it you've graded.
  - Ctrl+K: turn it on or off, and Add task. Ticking off bursts in Expressive motion.
- **Tasks on course cards (Canvas, off by default; Extras, under Better To Do):** each Dashboard card lists its
  course's next items, soonest first, each a link, with its date (relative or exact) and status (submitted, graded,
  late, missing, excused). 1 to 10 per card (4 by default); done items can stay crossed out. It follows Better To Do's
  timeframe, past-due window and done rules, ticks and Canvas marks included, and shares its planner copy: the
  planner is asked once, whether or not the list is on. Every card style and the card grade fit
  beside it. Ctrl+K turns it on or off.
- **Dashboard notes (Canvas, off by default; Extras, Notes and widgets):** a notes box on the Dashboard, small, medium
  or large, saved as you type on this device for each Canvas site and account. Web addresses become links; click the
  text to edit it. A note typed later in another tab wins.
- **Widgets (Canvas, off by default):** a grid under the Dashboard's heading. Edit widgets adds, removes, orders (arrows,
  arrow keys or drag) and sizes them; any widget can float over every Canvas page instead, dragged by its heading or
  moved with the arrow keys, snapping to the window's edges, and stays where you put it.
  - Agenda: one day's due work, "do on" plans and focus sessions, with previous and next day and back to today.
  - Focus timer: work and break lengths, start, pause, resume, reset; the break starts by itself and the timer keeps
    running across pages and tabs. An optional soft chime made by the browser, no sound file.
  - Quote: original lines written for Glaze in all six languages (focus, calm, courage), every few seconds or once a
    day, with previous, next and pause.
  - Music: a Spotify, YouTube, Apple Music or YouTube Music link. Nothing is asked of the player until you press Load
    player; YouTube plays from youtube-nocookie.com. The link stays on this device.
  - Breathe: in, hold and out for the lengths you set, for a number of breaths; with motion off, words and a count.
  - Study buddy: a Shiba who dozes while nothing's going on, wakes for the timer or a pat, and is happy for a while
    after a finished focus block or an item ticked off. Click it for a word of encouragement.
- **What Glaze can do:** every Canvas extra in one panel with its switch, from Ctrl+K or the Dashboard, with an
  optional tour of the page and **Report a problem**. Nothing opens by itself.
- **Report a problem:** opens a new GitHub issue with your Glaze version, browser, system and language filled in, and
  nothing about your school. GitHub receives that text when the page opens; nothing is posted until you submit it. In the editor under Share and back up, and in What Glaze can do.
- **Reminders and streak (Canvas, every part off by default; Extras, Reminders and streak):** each its own opt-in:
  - Due-date reminders at any of 15 minutes, 1 hour, 3 hours, 1 day and 2 days before (several at once, free); a day
    before means the same time the day before, in your Canvas time zone, across daylight-saving changes.
  - Exam reminders: quizzes, and titles with exam, test, midterm, final, Klausur, Prüfung, examen, parcial, partiel,
    contrôle, tentamen, toets, prova and the like in Glaze's six languages, 1 day to 1 week ahead.
  - Plan reminders: Better To Do's "do on" days (at the start of the day) and focus sessions (up to an hour before).
  - Shown only inside Canvas, in the tab you're looking at: one small toast in the corner that never takes focus,
    is announced politely to screen readers, can be dismissed (Esc too) or snoozed for an hour, and doesn't slide in
    under reduced motion. Never on a quiz you're taking or a tool's page. No notifications permission, no badge, no sound.
  - What came due while no Canvas page was open shows once, as one toast that says how many more there are, not a pile;
    a reminder shown in one tab doesn't show in another.
  - A hub (the bell in the To Do header, or Ctrl+K "Reminders") lists what's coming up, what was shown in the last
    three days and what's snoozed, lets you mute an item and bring it back, and has the settings. A reminder counts
    as shown only once a tab has drawn it: one that closes or goes quiet first leaves it for the next.
  - Streak: days in a row with nothing missed, and your best, in the To Do header. Work past due and not handed in, or
    handed in late (ticked or not), ends a run; excused work and work with nothing to hand in never count. Two free restores a month
    put back a run. Never a guilt message.
  - One timer to the next reminder, set again when the page is shown and at most ten minutes long: no polling. It
    reuses Better To Do's planner copy. What's seen, snoozed, muted and the streak stay on this device, apart from
    Canvas's own read state, which Glaze never changes.
- **Gradescope in To Do (off by default; Extras, under Better To Do):** your Gradescope assignments join Better To Do,
  the course cards and reminders, each marked Gradescope and linking to it, with its status (submitted, graded with
  the score, late, missing, nothing handed in). On gradescope.com a small bar asks once which Canvas course each
  Gradescope course belongs to, with a guess by course code or name; Don't ask again means it, and the choice can be
  changed in Glaze's settings. Glaze reads each course page signed in as you, whenever you visit Gradescope, and
  optionally once a day from Canvas. Rows are read one by one: an odd row is skipped and counted, never the whole
  course. Ticks stay on this device. Read only, and kept on this device; nothing runs on Gradescope while it or Glaze
  is off. Each Canvas account is asked once, with one quiet line wherever its Gradescope work would show (Better To
  Do, above the first course card's tasks, the reminders hub; never a popup or toast), and one answer counts
  everywhere, so two people sharing a browser never see each other's; signing in to another Gradescope account starts
  afresh.
- **Moodle:** Glaze restyles Moodle (the Boost theme of Moodle 5, and 4.x where its markup is the same) on any
  school's domain, with the same palettes, Looks, fonts, backgrounds and motion: the Dashboard and My courses,
  course and activity pages, grades, the calendar, messages and the login page, in light and dark palettes.
  Course cards show your course total from Moodle's grades overview; what's due this week comes from your
  Timeline, in the popup and the command palette, which also lists Moodle's pages, your courses and the
  course's tabs. Read-only: Glaze asks your own Moodle what its own pages ask.
- **Search in your courses (Canvas, on by default; Extras, under Command palette):** from two typed characters, the
  Ctrl+K palette also finds pages, assignments, discussions, announcements, modules and files in your active courses
  by title, each labelled with its type and course: the course you're in first, then this term's, then the rest, up to
  24 results. Results join the list in that order (a slow course doesn't lose its place) below what's already shown, so nothing moves under the pointer or
  the keyboard's choice; looser matches of Glaze's own commands follow once it's done. Screen readers hear the count
  when the search is done. Turning it off while the palette is open stops it at once. It waits for a 150 ms pause, cancels what's still running on
  the next keystroke, asks six lists at a time, and keeps answers in memory for five minutes. Read-only, to your own
  Canvas only.
- **Canvas's document viewer in your palette** (on by default): PDFs and other files Canvas shows in its own viewer get
  your palette's background, toolbar and thumbnails, instead of the whole viewer being turned negative. The pages stay
  as the document has them unless you dim or invert them. A signed-in student's annotation tools keep Canvas's look.
- **Pen, highlighter and eraser on documents** (Canvas, off by default): draw and highlight on files in Canvas's
  document viewer in any color and size, with undo and redo (Ctrl/⌘+Z), clear page, export and import as a file, and
  a page saved as a picture. Free, no account. Marks are kept on this device per Canvas site, account and file, and
  never sent anywhere; they keep their place at any zoom and come back as you scroll. Works with a mouse, a pen or
  touch (once an Apple Pencil draws, fingers scroll). Canvas's own annotations are left alone.

- **Grades on Blackboard Ultra.** The Canvas grade features, on Ultra:
  - **What-if calculator** under a course's overall grade, the same one as on Canvas: change real scores, leave work
    out, add pretend items, and see what a target takes. It follows the course's own overall-grade recipe where Ultra
    gives it to students and Glaze reproduces Blackboard's figure with it (weighted categories, equal or proportional,
    running total or not); otherwise its figures are an estimate from your share of the points in graded work, shown
    beside Blackboard's own figure and marked Estimate. Kept on this device until the real grade arrives; Blackboard
    never sees it.
  - **GPA** on Ultra's Grades page, for this term's courses, with credits, levels, a what-if grade per course, past
    terms, trends and a goal. Blackboard doesn't show students a course's letter cut-offs on the account checked, so
    Glaze uses your scale for a course (typed, or from its syllabus) or a common one, and says so.
  - **Syllabus import** on a course's outline, from a document in the course, a file or pasted text; the scale can go
    to the GPA and the dates to To Do.
  - **Insights** from a button on the Courses page or Ctrl+K: on time, each course's grade over the term, workload
    and plans, from your own Blackboard.
  - Ctrl+K gains the GPA, Insights and, in a course, Import a syllabus.

- **Course tabs on Blackboard Ultra (on by default).** Each course you open gets a tab, as pages do in a browser: in a
  strip above the course's sticky top bar (or between its two rows, or below it, in the editor), at the header of an
  item opened over the course (a document, a discussion), and above pages outside a course.
  - A tab goes back to where you were in its course: the tool, the page and how far down. A test, attempt, assessment,
    discussion or message is never reopened: an allowlist of the course's tools, its documents and folders decides,
    and anything else opens at its tool.
  - Close (its ×, the middle button, Delete), pin (pinned tabs go first and never close on their own) and reorder (drag,
    or Shift with an arrow key). Past the cap (8 by default) the least recently used unpinned tab closes, and the strip
    says which. A real tablist for the keyboard and screen readers; no browser shortcut is taken.
  - Switching shows an inert copy of the course as you last saw it at once, then fades to Blackboard's live page. The
    copies hold only what you already saw (no scripts, frames, fields or media), stay in memory (the page, then the
    worker's `storage.session` across reloads), are never written to disk, and go when the browser closes, when the
    tabs or Glaze are turned off, when another account turns up on the site, or on sign-out. Nothing is fetched or
    opened in the background.
  - The tab buttons' shape, size and width, the course's name or code, a colour dot or an icon, and a tint or more of
    each course's own colour (Course colors'), in the editor's Course tabs section with a live preview. Ctrl+K turns the
    tabs on or off.

### Fixed

- Course tabs: sign-out now stays cleared through page exit and delayed work; worker cache writes and clears are serialized and bound to the account. Snapshot replay no longer relinks opaque stylesheets or reloads image/CSS resources, and custom elements cannot run while a copy is taken. Snapshot limits include ancestor metadata; 40 pinned tabs cannot grow the list without bound. A stalled switch still falls back after 2.5 seconds when Ultra removes its header. Still copies use readable styles and system fonts; unreadable CDN styling and tainted pictures are omitted until the live page arrives.

### Changed

- **Blackboard's what-if calculator is the Canvas one now.** Scores you typed in the old one move over the first time
  you open that course's grades (those graded since are dropped, and the calculator says so).
- **Blackboard (for what comes next):** Glaze can now read Ultra's courses and terms, what's due (To Do in two-week
  slices and the calendar), where each piece of work stands (on time, late, missing, excused, or unknown, never
  guessed) and the gradebook, in the same shapes its Canvas planning and grade features use. Courses with no overall
  formula Glaze can read get a share-of-points estimate, labelled as one. Nothing new is shown yet, and nothing is
  read until a feature asks; when one does, only GETs to your own Blackboard site, one at a time.
- **Better To Do is on by default** on Canvas (owner decision). One switch in the editor turns it off and brings back
  Canvas's own To Do; What's new says so once.
- **Rose palette:** its accent is a little darker (#c026d3 → #b31fc4), so links and active labels pass 4.5:1 on Rose's
  backgrounds.
- **Notes are never cleared for space:** Glaze asks for `unlimitedStorage`, which Chrome shows no warning for.

- **Dark documents** is now a choice: off, dimmed (pictures stay true) or inverted (as before). If you had it on, it
  stays inverted. The moon button beside a preview switches between dimmed and off.

- **Lighter on every page:** Glaze loads about 38% less code on Canvas and Blackboard pages. Its words in your
  language, Download all and draft backup now load only on the pages that use them.
- **Blackboard's what-if calculator** now loads only on a gradebook, like Canvas's.
- **Pages load less code until you use a feature:** the command palette, keyboard shortcuts, the course menu's
  popover, folder previews and Download all's buttons now load the first time you use them (or, for Download all, on
  a course page with folders), so every other page starts with about 46 KB less. They work as before.
- **And about 30 KB less again:** draft backup, Blackboard's what-if calculator, the document buttons (focus mode,
  reading time, dark file previews) and remembering your place in a course now load only on the pages where they
  appear. They work as before.
- **Each LMS loads only its own code:** Blackboard, Canvas and Moodle pages no longer start with each other's
  extras. A page now starts with about 21 KB less code on Blackboard, 27 KB less on Canvas and 57 KB less on Moodle.
  Everything looks and works as before.

### Fixed

- **Blackboard Ultra, course cards:** the tasks on a card stay inside it. The card grows to fit them (and the courses
  below move down), instead of the list spilling over the next term's heading and cards. A card shows its first tasks
  (4 by default, up to 10) and then "and N more" (on Canvas too); never a scrolling box. Glaze's banner height now
  sets the least height of the card, so a short banner no longer leaves a tall, empty card, and the list no longer
  runs past the card's right edge. Glaze's card gap also reaches Ultra's newer Courses page.
- **Notes:** a new, unsaved note's details line no longer shows the word "null".
- **Dark palettes:** a page with a form holding a field named "id" no longer stops Glaze's pass that darkens
  what the stylesheet can't reach.
- **Canvas, dark palettes:** text that was too faint is now readable:
  - the list view's item labels, due times, points and status pills;
  - its course titles, which now show in each course's color;
  - announcement dates, the inbox's preview line, a locked module's unlock date, and "late" on an assignment.
- **Canvas, dark palettes:** the white line under the list view's course titles is gone, and unchecked calendars
  show as empty boxes.
- **Canvas, dark palettes:** diagrams and equations in quizzes and pages that are drawn in black on a see-through
  background show again.
- **Canvas, light palettes:** "Complete All Items" and the chosen calendar view use a deeper accent that reads.
- **Canvas:** quiz preview notices use the palette.
- **Canvas, dark palettes:** an instructor's text in a dark colour (navy, dark green, deep red) is lifted to a
  light shade of the same colour.
- **Blackboard, folder previews and Download all:** Glaze no longer receives or keeps the launch credentials (`key`
  and `secret`) Blackboard includes for some course tool links in its content answers. Both ask only for the fields
  they use, and folder previews keep only each item's title, state and due date. They were never stored, logged or
  sent, but folder previews held them in memory for the page's life. Download all now reads a File item's file
  through Blackboard's public content API, and whether an item is a document from the course's public content list.

## [2.2.0] — 2026-10-15

### Added

- **Canvas:** Glaze restyles Canvas LMS on `*.instructure.com` and on a school's own domain, with the
  same palettes, Looks, fonts, backgrounds and motion as on Blackboard.
- **The extras on Canvas,** each where Canvas keeps the same thing: tooltips with date and score hints;
  score bars and percentages on Grades and Assignments; due-date status and urgency on Assignments,
  Modules and To Do; shorter announcement previews; reading width; course progress from module
  completion requirements; your place in Modules; previews of closed modules and Files folders;
  Download all for a module's files (files you haven't opened are left out); new-grade counts that
  follow Canvas's own unread grades, and new items in Modules; tint and a Look per course, from a
  menu on each Dashboard card; course colors on course pages, Grades and the Inbox; focus mode and
  dark file previews; keyboard shortcuts (g then d, c, a, g or m); hiding the Help link, card
  images and course links you don't use; draft backup for new Inbox messages.
- Where Canvas already has its own, Glaze leaves it to Canvas and themes it: what-if scores, editor
  recovery, course nicknames and colors, folder zips on Files, unread counts.
- **Halloween Looks:** Graveyard and Pumpkin Patch, each with its own animated scene.
- **Mac app updates:** the downloaded Mac app checks for updates about once a day while Glaze is in
  use and installs them quietly.

## [2.1.4] — 2026-10-14

### Added

- **Due this week:** the popup and the command palette (Ctrl+K) list what's left to do in the next
  seven days, from Blackboard's own To Do list, with its course, due time and how long is left;
  picking one in the palette opens it. Checked at most every ten minutes. No badges, nothing pops up.
- **A Look per course:** in the editor's Courses section, each course has a menu: keep your theme, or
  pick one of the eight Looks. That course's outline and items wear it; everywhere else stays yours.
- **Remember your place:** come back to a course and its content opens the folders you left open and
  scrolls back to where you were, even after a reload or another course in between. Folders you close
  stay closed, and scrolling yourself always wins. On by default; switch it off in Extras.
- **Glaze settings in the command palette:** type "settings" after Ctrl+K to open the editor.
- **What-if scores are kept:** the calculator remembers the scores you type for each course, even after
  you leave or reload, until you clear them with the new Clear scores button. A score goes away on its
  own once that item gets a real grade.

### Changed

- **Calendar course colours:** a calendar entry takes its course's own colour when its title belongs to
  one course, so courses sharing a Blackboard colour no longer look the same there.
- **A new popup:** tiles, all in view at once: the theme switch, the Look you're wearing (tap for all
  eight), what's due this week, palette, motion, and Open the editor across the bottom.
- **Slide switches:** every checkbox in the editor is a switch that slides on and off. On a phone, a
  course's name gets its own line, with its Look and Tint under it.

### Fixed

- **Toned course colours keep their hue:** yellow stays yellow instead of turning green, and orange no
  longer turns pink.
- **Discussion headers:** with a background other than solid, a discussion's back button and breadcrumbs
  were hidden under the background (still clickable). They show again.
- **Course progress on Content only:** the bar no longer turns up on a course's Discussions tab.
- **Square corners:** the course header, the Course Content header, Messages rows, the Courses list/grid
  switch and the gradebook's student header are rounded like everything else, with no box drawn inside
  another.

## [2.1.3] — 2026-10-13

### Changed

- **Every course its own colour.** Blackboard has ten course colours and gives two courses the same
  one whenever their numbers line up, so three courses could share yellow, and 2.1.2's course list put
  them in one row with one colour and one Tint box. Now each course and organization has its own row,
  its own colour and its own Tint box, under Courses and Organizations. Where Blackboard repeats a
  colour, its newest course keeps it and the others get one no course has; Glaze paints those on
  course pages, Messages and Grades, and tints with them. The calendar names no course, so its
  entries keep Blackboard's colour. Colours and ticks you set before carry over.

### Fixed

- **Course tint on a course's first page.** The tint could miss a course whose page didn't change
  after loading, until something on it moved.

## [2.1.2] — 2026-10-13

### Added

- **Looks:** eight ready-made combinations of palette, fonts, shape and background, one click each,
  in the popup and at the top of the editor's Palette section, and as "Look: …" in the command palette.
  Aurora Night, Library, Terminal, Lava Lounge, Synthwave, Clear, Lagoon and Rose Garden. A look sets
  the whole look and background, so nothing from the last one lingers; your tooltips, hints and a
  background image's address stay as you set them.

### Fixed

- **Every course in the editor's course list.** The Courses section learned course names from headings
  on Messages and Grades, one per colour slot, so courses sharing one of Blackboard's ten slots hid each
  other, and headings inside a course got in as names ("Course Content"). It now lists every course
  you haven't hidden, from Blackboard's own course list, the moment you open Blackboard; courses that
  share a slot share a row, since they share its colour and tint. Course tint also works on a course's
  item pages before you've opened the course itself.

## [2.1.1] — 2026-10-13

### Fixed

- **Folder previews, Download all and course progress in any language.** They found folders and
  learning modules, and read "3 of 7 completed", by Blackboard's English words, so on a Blackboard in
  another language they did nothing. They now go by how Blackboard builds the page, and course progress
  reads the count in any of its languages ("7 件中 3 件が完了済み" too). Item-type icon colors know
  Blackboard's names for them in its other languages, and the / shortcut finds the course search box.

## [2.1.0] — 2026-10-13

### Added

- **Fonts:** about forty to choose from, each shown in its own face in a new font list. Readable
  faces (Lexend, OpenDyslexic, Atkinson Hyperlegible Next, Andika, Readex Pro, Comic Neue), sans,
  serif and monospace families from Google Fonts, and four Nerd Fonts (JetBrainsMono, FiraCode, Hack,
  Meslo). Type any Google Font's name, or one installed on your computer. Headings and code can each
  have their own font. Web fonts download only once chosen, and load even on Blackboard sites whose
  security policy blocks outside fonts.
- **Theme codes:** copy your palette, fonts, look and background as one line of text and send it to
  someone. Pasting a code shows it in the preview first, says what it would download (a web font, a
  background image's site), and applies only when you choose. Codes are checked setting by setting;
  one with anything Glaze wouldn't accept is refused whole. Under Share in the editor.
- **Submitted late:** due-date status says "Submitted late", in amber, for work handed in after its due
  date and not graded yet. Never said where you have a due-date exception.
- **New-grade badges:** "New" beside grades that arrived since you last opened a course's gradebook,
  and a count ("2 new") on course cards on the Courses and Grades pages; clicking the count opens that
  course's gradebook at the first new grade. The first time, the grades
  Blackboard says you haven't viewed count as new. What you've seen is kept on this computer.
- **New-content badges:** "New" after course items your instructor added or made visible since you
  last looked at the course, and a quieter count on a closed folder or learning module holding some;
  clicking the count unfolds it down to the newest one, without opening anything. Course cards on the
  Courses and Grades pages say "3 new items" for courses you've opened before; clicking it opens the
  course there. The first visit to a course counts nothing as new. An item stays marked for the visit
  in which it's first on the page. On by default under Extras. Ultra itself marks no new content.
- **What-if calculator** on a course's gradebook: type scores for work that isn't graded yet and see
  the overall grade they'd make, or set a target and see the score you'd need on everything left. It
  follows the course's own category weights, and only once it reproduces the overall grade Blackboard
  shows; when a course uses rules Glaze can't read (dropped scores, say), it says so instead of
  guessing. A course with no overall grade gets a plain share of points, labelled as just that.
- **Command palette:** Ctrl+K (⌘K on a Mac) to jump to a course, an item in the course you're in, a
  course tab or a Blackboard page, or to switch a palette, the motion level or an Extra. Fuzzy search,
  keyboard first; it stays out of the way while you type in an editor. On by default; switch it off
  under Extras.
- **Back up what you type.** While you write a discussion response, reply, journal entry, message or
  assignment text, Glaze keeps a copy on your device. If the page reloads, the tab crashes or your
  session times out before it's posted, a small bar above the empty editor offers it back: Restore puts
  it in with its formatting, Dismiss deletes it. The copy is deleted once your post shows up on the
  page, and after 14 days either way. On by default under Extras; switching it off deletes every copy.
- **Grades on course cards.** On the Courses page, each course shows your overall grade beside its
  status, "82.45%" as Ultra's Grades page writes it, in its score band's color like the due-date
  chips. Only where the instructor shares the overall grade with students; otherwise nothing. Works
  in Recent Courses and in the card and list views of all courses. The grade comes from the same
  gradebook request as due-date status, asked only for courses on screen and at most once a minute
  each, so opening a course right after reuses it. An Extra, on by default.
- **Download all.** Each folder and learning module in course content gets a download arrow beside its
  title, shown while you point at it or tab to it, that saves the files inside, subfolders included, as one zip named after it. It
  shows its progress, a second click cancels, and folders over 250 MB are refused rather than filling
  your browser's memory. Files in items you haven't opened yet are left out, and the button says how
  many, so a download never marks anything as viewed. On by default; switch it off under Extras.
- **Dark documents.** PDFs and file previews in course documents can turn dark to match a dark
  palette: the page inverted, its colors turned back so links stay blue and photos keep their hues.
  Off until you switch it on, with the moon button that appears at the bottom right while a preview
  is on screen; Glaze remembers the choice. Light palettes leave previews as they are, so the button
  shows only on dark ones.
- **Focus mode** for course documents. The focus button at the bottom right hides the document's
  title bar, a learning module's bar and Previous / Next, leaving the document on its own with a thin
  reading-progress line along the top and the reading time beside the button. Esc or the button again
  brings everything back.
- Both buttons are themed, follow the motion setting, and can be reached with the keyboard. In a
  narrow window the document makes room for them instead of sitting underneath. "Document buttons"
  under Extras hides them altogether.
- **Course tint**, off until you set it up: inside a course you pick, the accent takes that course's
  color and the background leans toward it, so you can tell at a glance which course you're in. Turn
  it on under Courses in the editor, tick the courses, and set how strong it is; the preview shows it.
  It follows the course onto its item pages and panels and lets go when you leave. Gradients and
  animated backgrounds that follow your palette pick it up too. Text on the accent and the accent on
  the page keep their contrast.
- **Settings search** at the top of the editor. It narrows the editor to the settings whose name or
  description matches, highlights the words, and says how many there are, or "No settings match".
  A few synonyms help: "dark" also finds the palettes, "font" text size and line height. / jumps to
  it, Esc clears it.
- **What's new.** After an update, the editor opens with a few lines on what changed, once; Dismiss
  puts it away. A fresh install shows nothing. Until then, a small dot on the popup's "Open the
  editor" button. Nothing on the toolbar icon or on Blackboard.
- **Glaze speaks Spanish, French, German, Portuguese (Brazil) and Dutch.** Everything Glaze writes
  on Blackboard (due-date status, hover hints, new badges, the what-if calculator, the command
  palette, Download all, the typing backup, focus mode, keyboard shortcuts, folder previews) is in the
  language Blackboard is shown in, so a Spanish Blackboard gets "dentro de 2 días · Sin abrir" even in
  an English browser. The editor and the popup follow your browser's language. Dates, numbers and
  percentages are written that language's way ("82,45 %"). Any other language, and any word not
  translated yet, stays English. Settings search finds the translated names, with or without accents.
  The store description is translated too; the name stays Glaze. The translations are machine-made
  and waiting for native speakers to review them.
- **Glaze for iPhone and iPad.** Safari on iOS and iPadOS 18 or newer, from the same App Store listing as
  the Mac app. The app is a two-step guide in the Mac app's style, in light and dark: turn Glaze on in
  Settings, then allow it on your Blackboard site. On iOS 26.2 and newer its button opens Safari's
  extension settings, and the guide ticks the first step off as soon as Glaze is on.
- **Smoother page changes.** Ultra builds each page in view: a spinner, then parts arriving and
  pushing each other down. Glaze now holds a page hidden while it loads and reveals it once it's
  built, resolving from a blur in one motion; a spinner shows only if the wait outlasts 0.4 s. Clicking
  the main menu or a course's tabs crossfades from the old page instead of flashing through
  half-built ones. Opening a course no longer jumps (its layout shift went from 0.11 to 0), and
  Glaze's course progress bar no longer pushes the content down as it appears. Follows the motion
  setting: off reveals instantly.

### Changed

- **Due dates in any language.** Due-date status, urgency, "Submitted late" and date hints used to
  read only US-style dates (10/18/26, 11:59 PM). In course content and on an assignment's page the
  date now comes from your gradebook, whatever language Blackboard shows; elsewhere Glaze reads it the
  way Blackboard writes it for your language: 18.10.26, 18/10/2026, 2026/10/18, month names, a 24-hour
  clock, Arabic digits. A discussion with two due dates now counts down to the last one, the date your
  gradebook keeps.
- **Touch screens.** Cards and buttons no longer stay lifted or scaled after a tap, and Expressive's pointer
  light no longer sticks where a finger last touched. Shorter descriptions stay full length on touch
  screens, where there's no hover to expand them.
- **The popup** fills Safari's sheet on iPhone and opens wider on iPad, with fingertip-sized swatches,
  switches and choices.
- **The editor at phone width:** the section links scroll in one row instead of stacking four deep,
  sliders get the full width under their labels, and segmented choices wrap instead of running out of
  their card. Text fields no longer make iOS zoom in when you tap them.
- **Grade pills** are one width and one line in every row, sized for the longest grade ("100 / 100 ·
  100%" with the rubric icon); "Not graded" no longer wraps and long grades no longer lose their ends.
  A course gradebook's Grade column takes the room from Item Name.
- **Due-date status** replaces countdowns in course content: beside each due date, where the work
  stands. "in 2 days · Unopened" or "· Opened" (from Ultra's progress circle), "Submitted · due in 2
  days", "Submitted", "Graded · 18/20" in its score band's color, "Exempt", "Done", and "Past due ·
  Not submitted" in red. A past due date whose status Glaze can't know (an external tool's item, say)
  gets no chip, instead of an anxious "2 weeks ago"; outside course content only upcoming dates get one.
  The same chip sits beside the due date on an assignment's own page. The status comes from your
  Blackboard's gradebook, asked at most once a minute per course.
- **Loading spinners and placeholders** follow your palette: Ultra's spinners turn from the
  institution's brand color (or plain grey) to the accent with a soft glow, and the course cards'
  loading placeholders shimmer in the accent.
- The favorite star on a course is your accent, with a soft glow, instead of the institution's brand
  purple; Ally's alternative-formats icon follows the text color instead of near-black.
- In a narrow window, the menu drawer that floats over the page is solid, so the page no longer shows
  through it.

### Fixed

- The selected item's glow in the main menu now also shows in a narrow window, where Ultra moves the
  menu into a drawer; it had Ultra's purple bar back.
- **Due-date urgency** no longer flags work you've handed in, in any course: due soon and due today
  now check it too, not only overdue, and courses without progress circles check the gradebook.
- Glaze no longer stops with an error on an /ultra/ address that isn't a web page, such as a missing
  file on Blackboard's content server.
- In Firefox and Safari, the editor's preview follows each change as you make it, as in Chrome.

## [2.0.3] — 2026-10-13

### Added

- **Animated backgrounds:** eight slow, soft three.js scenes, off until you pick one. Mist, Orbs,
  Borealis (swaying northern lights), Lava (a lava lamp), Waves, Dust, Contours (a topographic map that
  reshapes itself) and Horizon (a striped sun over a gliding grid). Drawn at low resolution, at most 30
  frames a second, paused in background tabs and still when motion is off. three.js loads only when a
  scene is chosen.
- **Intensity:** one slider for how much an animated background stands out. It sets color, contrast
  and pace together, from barely there to bold.
- **Gradient controls:** style (Linear, Radial, Conic, Mesh), angle, blend (soft to crisp bands) and
  spread. Gradients now fill the screen and are mixed in OKLab where the browser supports it, so the
  colors melt into each other instead of sitting in separate patches.
- **Background colors:** gradient, aurora and animated backgrounds can use your own three colors, or
  one of six ready-made sets, instead of the palette's.
- **Grain** for gradient, aurora and image backgrounds: a faint noise that hides color banding. On by default.

### Changed

- Score bars, countdowns and percentages, folder previews and course progress are now on by default.
  If you had already changed any Extra, your choices are kept.
- The background editor shows only the controls the chosen background uses.
- Palette-colored backgrounds use the accent, bright accent and muted text colors. The success green
  clashed with warm palettes once the gradient filled the screen.
- The aurora's fourth glow uses the background colors instead of the palette's error red.
- New store screenshots and promo tiles, drawn with the animated backgrounds.
- **Course documents** are a centered column on one frosted-glass card, with the title lined up above
  it, instead of a narrow stack of nested boxes at the left of the page. On wide screens the whole
  column scales up with the window, text, files and videos included, up to 1.5x.
- Videos at Ultra's default size fill the document column at 16:9. Attachments are rounded tiles, with
  an open preview framed inside them.
- **Safari updates:** opening a newer Glaze over an installed one offers **Update Glaze**, replaces the
  old copy where it is (`/Applications` or `~/Applications`), quits it if it's running, and then says
  what changed instead of repeating setup. An equal or newer Glaze, or the App Store's, is opened
  rather than replaced. The new copy is swapped in only once it's fully copied, so a failed update
  leaves the old Glaze working.
- **Safari:** after installing, the disk image's copy of Glaze unregisters itself and ejects the image.
  Running it had added a second Glaze to Safari's Extensions list; ticking that one left Glaze off
  once the image was ejected.
- Previous and Next above an item are themed buttons instead of a dark grey bar.
- **Assignment pages:** the title lines up with the content, and the instructions and the details
  panel are frosted-glass cards, without the divider between them.
- With Reading width on, text sits in the middle of its card instead of against the left edge.
- The current page in the main nav and in a course's Contents list is marked by a glowing accent bar,
  replacing Ultra's purple strip.

### Fixed

- With Reading width on, course documents were squeezed into a narrow column at the left of the page.
- The bundled Inter and Atkinson Hyperlegible fonts didn't load on Ultra pages in Chrome builds that
  give extension files their static address.

## [2.0.2] — 2026-10-11

### Added

- A Safari Mac app, released separately as `safari-v2.0.1`.
- The Safari Mac app installs itself: open it from the disk image and click **Install Glaze**. It
  copies itself into Applications, opens Safari's Extensions settings, and shows an illustrated
  guide that ticks off as Safari turns Glaze on.

### Changed

- The popup's "Open the editor" button works whether or not the browser returns a promise.
- American spelling: "colours" is now "colors".

## [2.0.1] — 2026-10-11

### Fixed

- With a background on, opening a slide-out (rubric, settings, attendance) covered the whole page with the background.
- Slide-outs now look like a sheet over the dimmed page, with an edge, a shadow and a round close button.
- Opening a slide-out no longer shifts the page sideways and leaves a strip beside the panel. This was Ultra's bug.
- The attendance slide-out showed a scrollbar along its bottom.
- Pressing a button could nudge it out from under the pointer; the slide-out close button swung away on hover.

## [2.0.0] — 2026-10-11

Glaze now reshapes Ultra's pages, not just their colors, and has a full editor.

### Added

- **Editor page** with a live preview. The popup keeps the master switch, palettes, motion level and a link to the editor.
- **Look:** font (System, Blackboard, Inter, Atkinson Hyperlegible, Serif, Mono; Inter and Atkinson are bundled), text size, line height, corner radius, density, depth and glass blur.
- **Backgrounds:** solid, gradient, aurora, or an image from an `https://` link, with dim and blur.
- **Motion levels:** Off, Subtle (default) and Expressive. Off is used automatically when the system asks for reduced motion, unless you opt out. The three 1.0 switches remain as fine-tuning.
- **Course colors:** Ultra's course stripes are blended into the palette, or set one by one.
- **Theme management:** save, rename and delete your own palettes; export and import settings as JSON; contrast badges; automatic light/dark palettes that follow the system.
- **Tooltips and hints:** themed tooltips replace the browser's plain ones. Hovering a date shows how far off it is, a grade shows its share, and cut-off text shows in full.
- **Extras**, each off until switched on: due-date urgency, countdowns and grade percentages, shorter descriptions, score bars, reading width, folder previews, course progress, keyboard shortcuts, and hiding parts of the page you don't use.
- Tests (`node --test`) and a CI workflow.

### Changed

- Page polish across Ultra: button hierarchy, a clear selected state on segmented controls, glass headers, the calendar month view, gradebook grade bands, discussions, rich text, empty states and the course outline.
- Assignment pages: instructions in one card, details that stay in view, a single-card text editor with a focus ring, and a drop zone that responds to the pointer.
- The theme's stylesheets are added at page start, so Ultra no longer flashes unthemed.
- 1.0 settings carry over: your palette, motion switches and footer setting are migrated on first run.

### Fixed

- Glass headers were painted opaque, so the blur never showed.
- Under reduced motion, cards could stay invisible until their entrance delay ran out.
- On light palettes, chips and badges were flattened to the background.
- Ultra's grey course header and breadcrumb bar ignored the palette.
- Dark labels on accent buttons were recoloured light and became hard to read.
- Finished entrance animations left panels scrollable sideways under a background.

## [1.0.0] — 2026-09-04

Initial release.

- Full theme for Blackboard Ultra, applied on any host under `https://*/ultra/*`.
- Popup with 14 customisable colour tokens and live application to open tabs.
- Palette presets with a reset to the default "Frost" palette.
- Independent toggles for entrance animations, hover lift, and colour transitions.
- Footer bar toggle.
- Master on/off switch that adds and removes the theme without a page reload.
- Settings stored in `chrome.storage.sync`; no data collection and no network requests.

[3.0.1]: https://github.com/frostdev-ops/glaze/releases/tag/v3.0.1
[3.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v3.0.0
[2.2.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.2.0
[2.1.4]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.4
[2.1.3]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.3
[2.1.2]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.2
[2.1.1]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.1
[2.1.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.0
[2.0.3]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.3
[2.0.2]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.2
[2.0.1]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.1
[2.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.0
[1.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v1.0.0
