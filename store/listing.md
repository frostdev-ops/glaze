# Chrome Web Store listing — Glaze 2.2.0

## Name

Glaze

## Short summary (132 character maximum)

Restyle Blackboard Ultra and Canvas: palettes, fonts, backgrounds and motion, plus handy extras. Works at any school.

## Category

Productivity

## Detailed description

Make Blackboard Ultra and Canvas feel like yours. Glaze restyles your courses with palettes, fonts, backgrounds and motion, and adds small helpers where you do your coursework. Works at any school using Blackboard Ultra or Canvas LMS, including Canvas on a school's own domain.

YOUR LOOK

• Pick a palette, edit all fourteen colors, save your own palettes, or pair light and dark palettes with your system's appearance.
• Choose separate fonts for text, headings and code, including Lexend and OpenDyslexic. Adjust text size, line height, spacing, rounded corners, depth and frosted glass.
• Use a solid background, a linear, radial, conic or mesh gradient, an aurora, your own image link, or one of ten animated scenes. One Intensity slider sets how much a scene stands out.
• Apply one of ten Looks: a matching palette, fonts, shape and background in one click. The Halloween Looks, Graveyard and Pumpkin Patch, each have their own animated scene: moonlit headstones and drifting ghosts, or jack-o'-lanterns under a dusk sky.
• Choose Off, Subtle or Expressive motion. Glaze follows your reduced-motion setting by default. Animated scenes pause in background tabs and hold still when motion is off.
• Give individual courses a tint or a Look of their own. On Blackboard's Courses cards, the Course menu also sets nicknames and colors. On Canvas's Dashboard, Glaze adds tint and Look controls alongside Canvas's own nickname and color menu.

EXTRAS ON BLACKBOARD ULTRA

• Course Content: due-date status such as “in 2 days · Unopened”, “Submitted”, “Submitted late” and “Graded · 18/20”; closed-folder previews; course progress; new-content badges; and returning to the folders and scroll position you left.
• Gradebook: score bars, percentages and new-grade badges. Glaze's what-if calculator tries hypothetical scores for ungraded work or a target grade, uses course weights where supported, and keeps your trial scores on your device until you clear them or real grades arrive.
• Courses and Grades pages: overall grades on course cards when your instructor shares them, plus counts of new grades and content. Course colors also appear on course pages, Messages, Grades and the calendar.
• Folder and learning-module headers: Download all makes a zip of accessible files from items you've already opened. Unopened items are left out, so downloading does not mark them viewed.
• Blackboard editors: a local typing backup can offer back your writing after a reload or session timeout, before it is posted.
• Course documents: focus mode, a reading-progress line and reading-time estimate; an optional dark view for PDFs and file previews.
• Optional controls: due-date urgency, shorter descriptions, reading width, keyboard shortcuts and hiding page parts you don't use.

EXTRAS ON CANVAS

• Modules: course progress from module completion requirements, previews of closed modules, new-item badges, and remembering your scroll position and last opened item. Courses without completion requirements show no progress bar; Canvas itself keeps modules open or closed.
• Modules with files: Glaze's Download all makes a zip of accessible module files, leaving out items you haven't opened. Files-folder previews appear on Files; folder zip downloads on Files remain Canvas's own feature.
• Grades and Assignments: score bars and percentages. Assignments, Modules and To Do: due-date status and optional urgency, using Canvas's assignment and submission information.
• Dashboard cards: current grades when Canvas shares them, course tint and Looks, new-item counts, and new-grade counts that follow Canvas's own unread grades. Course colors carry through course pages, Grades and Inbox.
• Announcements, posts and documents: optional shorter announcement previews and reading width. Supported document views have focus mode and dark file-preview controls.
• New Inbox messages: local draft backup for messages to individual users in uniquely named courses, with a subject and selected recipients. Replies and group recipients are not backed up.
• Optional shortcuts: g then d, c, a, g or m for Dashboard, Courses, Calendar, Grades or Inbox. Hide the Help link, Dashboard card images or course links you don't use.

Canvas's what-if scores, rich-editor recovery, course nicknames and colors, Files-folder zips, and native unread counts belong to Canvas. Glaze themes them and uses Canvas's unread-grade information for its badges; it does not replace those native tools.

ON BOTH PLATFORMS

Due this week lists work still to do in the next seven days in the popup and command palette. Press Ctrl+K (⌘K on a Mac) to jump to courses, pages, Glaze settings and due work; on Blackboard you can also search the current course's items, and on Canvas its navigation tabs. The editor has a live sample preview; the popup keeps quick controls close. Share a theme as a code that previews before applying, or export and import your settings as a file. Extras can be switched on or off.

Glaze's helpers do not change grades, submit coursework or send messages. Blackboard what-if scores are hypothetical and stay on your device; Canvas handles its own what-if scores.

PRIVACY

No analytics. Settings stay in your browser and follow Chrome sync if it is on. Course details, seen-item and grade records, your place, the due list and supported typing backups stay on your device. Draft backups expire after at most 14 days. Glaze reads your own Blackboard or Canvas site using your existing session. Chosen web fonts and background images make ordinary network requests; Canvas module downloads also fetch signed file links from your school's file host without cookies. Glaze does not collect or sell your coursework, grades, credentials or browsing history. Full policy: https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md

Open source (MIT): https://github.com/frostdev-ops/glaze

Canvas is a trademark of Instructure, Inc. Blackboard is a trademark of Anthology Inc. Glaze is an independent project and is not affiliated with or endorsed by either company or any school.

## What's new in 2.2.0

Prepared release copy; the Chrome Web Store has no separate What's New field.

Canvas support, with the same palettes, fonts, backgrounds, motion and Looks as Blackboard Ultra. Canvas Extras include module progress, previews, new-item badges, remembering your place, module file zips, score bars, due-date status, Dashboard card grades and tint, document tools, shortcuts and supported new Inbox draft backup. Canvas's own what-if scores, editor recovery, nicknames, colors, Files-folder zips and unread counts stay with Canvas. Graveyard and Pumpkin Patch add two Halloween Looks with their own animated scenes.

## Single-purpose statement

Glaze customizes how Blackboard Ultra and Canvas LMS pages look and read, and helps users keep track of and keep their own coursework on those pages. Its themes and optional helpers present the user's existing course information, save accessible files the user chooses, and keep supported draft backups locally. Every permission serves that purpose.

## Permission justifications

### storage

Saves theme and Extra settings in chrome.storage.sync, including user-set course nicknames, colors, tint and Looks; these follow Chrome sync when enabled. Local storage keeps course details, seen-grade and content records, the due list, supported draft backups, Blackboard what-if scores, course positions and recognized Canvas hosts. Canvas badge records include the site, signed-in account and course identifiers to keep accounts separate. Supported Canvas Inbox drafts keep body, subject and destination identifiers. Drafts expire after at most 14 days; switching backup off deletes them. Coursework records and draft text are not synced. See the privacy policy for each record's retention and removal behavior.

### Host access: https://*/*

Blackboard Ultra runs on institutions' own arbitrary domains under /ultra/; Canvas runs on instructure.com and schools' own domains. The manifest therefore requests HTTPS host access. The full content script is initially matched to Ultra paths and *.instructure.com. On other HTTPS pages, lib/detect.js checks only the page head for Canvas's own /dist/brandable_css/ stylesheet link and stops at the body. When it recognizes Canvas, it asks the background worker to inject Glaze and remember/register that host. The detector sends no page content.

On supported LMS pages, the content script injects local styles and reads the course information needed by enabled Extras. Read-only requests use the user's existing LMS session for course lists, grades, submission status, due work, previews and module information. Supported Canvas Inbox recovery reads matching sent conversations to confirm a send without marking messages read; Glaze sends no messages. User-requested downloads fetch accessible files and make a zip locally. On Canvas the background worker fetches validated signed file links without cookies. Chosen web fonts and background images are the other extension network requests. No remote script is loaded.

### scripting

Injects and registers Glaze's packaged content scripts after recognizing Canvas on a school's own domain, so later visits to that host can be themed from the start. It does not inject Glaze's full theme into unrelated sites.

### Web-accessible resources

theme.css, motion.css, extras.css, canvas.css and bundled fonts provide the theme. lib/scene.js and bundled lib/three.min.js draw animated backgrounds. The content script loads these packaged files into supported LMS pages; Chrome requires them to be web-accessible for that use.

## Remote code

None. All executable code ships in the package, including the bundled MIT-licensed three.js library. Optional web fonts and background images are data, not remote code.

## Screenshot and promo delivery

Submit five 1280×800 captures from the submission package's screenshots/ directory, plus the 440×280 small tile and 1400×560 marquee from promo/. Use the package report for the final filenames and capture evidence. Captures must use only the local sample course and seeded Canvas data.

## Privacy policy URL

https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md
