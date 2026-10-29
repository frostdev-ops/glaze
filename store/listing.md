# Chrome Web Store listing — Glaze 4.0.0

## Name

Glaze: Themes for Canvas, Blackboard & Moodle

## Short summary (132 character maximum)

Canvas, Blackboard & Moodle themes and dark mode. Planner, GPA and notes on Canvas & Blackboard.

## Category

Productivity

## Detailed description

Give Canvas, Blackboard Ultra and Moodle your own theme and dark mode. On Canvas and Blackboard Ultra, Glaze adds a student planner, to-do list, GPA calculator and notes. Free, with no Glaze account, ads or analytics.

YOUR LOOK

• Apply one of eleven Looks, or get free ones at frostdev.io/glaze/looks.
• Dark mode: pair a light and a dark palette with your system's appearance or a schedule.
• Custom colors and fonts: edit all fourteen colors, give each course its own color, and pick Lexend, OpenDyslexic or any Google Font.
• Backgrounds: a gradient, your own picture or one of eleven animated scenes.
• Pointers in Look › Pointer, and typing effects that never read what you type and stay out of password fields and quizzes.
• Glaze navigation, and Ctrl+K (⌘K on a Mac) to jump to any course, page or setting.

PLAN AND STUDY ON CANVAS AND BLACKBOARD ULTRA

• Better To Do: coursework grouped by due date, with your own tasks and focus sessions.
• Announcements open in a Glaze pop-up from Better To Do or Ctrl+K on Canvas and Blackboard Ultra, and from the sites' own lists, including Moodle. Hover to preview in Better To Do and those lists.
• Due-date reminders in the page, never browser notifications, off until you turn them on.
• Import your class schedule or a syllabus from a PDF or photo, read on your device, and export deadlines as a calendar file (.ics).
• Notes with folders and attachments, a focus timer and a pet habitat.
• Course tabs keep up to 4 course pages live alongside the main page.

CANVAS

• A GPA calculator, plus what-if grades that follow Canvas's grading rules.
• Folded assignment rubrics open in a Glaze pop-up with your published scores and feedback.
• Download all for a module's files. Items you haven't opened are left out, and redirected files stop with an error asking you to download them from Canvas.
• Glaze themes Canvas's own what-if scores, editor recovery, nicknames, colors, Files-folder zips and unread counts; it does not replace them.

BLACKBOARD ULTRA

• Grades: score bars, what-if grades and a GPA calculator with past terms and a goal.
• Assignment rubrics, with your published scores and feedback, show in the page when there's room, otherwise in the pop-up.
• Course Content: due-date status, course progress and new-content badges.
• Download all zips files from items you've already opened, so unopened items aren't marked viewed.

MOODLE

• Glaze styles Moodle's Boost theme (Moodle 5, and 4.x where the markup matches), with course totals on cards, what's due this week and Glaze navigation.

AT YOUR SCHOOL

Works from install on instructure.com, blackboard.com and moodlecloud.com. Install access also covers frostdev.io and share.frostdev.io; other hosts are requested when needed. Add your school's own address in Settings › Privacy and data › Sites; Back up… and Restore… there save everything in one file. Glaze never changes grades. Submitting coursework or sending messages requires your action. Writer can attach your .docx and submit it through Blackboard after you confirm. What-if scores stay on your device.

PRIVACY

Settings follow Chrome or Firefox sync if it is on, including course nicknames, GPA choices and some school, course and account identifiers. Coursework records, notes, tasks and typing backups are stored on your device. AI is off by default. If you enable it for a feature, an on-device model works locally; a provider or endpoint you choose receives that feature's context, such as your draft and assignment materials. With AI Feedback on, assignment pictures can be read before Review; up to 128 checked readings stay locally for 30 days. AI outline sends sections while Outline is open; AI source extraction sends bibliography entries while Sources is open. Both have their own switches. Glaze reads your LMS with your session and writes only when you ask (a planner tick, a Canvas nickname or color, Sign out, Moodle's Edit mode, marking announcements read when opened in Canvas or in Moodle forums with automatic read tracking); previews and Blackboard send no read mark. Rubrics are read-only. Chosen web fonts and background images make ordinary network requests. Linked videos and animations are fetched without cookies, referrers or redirects; identifying container metadata is removed, but encoded streams and visible pixels remain. Older files that cannot be cleaned stay local and are not shared; course tab sketches stay in memory and are never sent anywhere. Sharing starts only when you create, join or resume a session. Optional share sessions and mod channels are encrypted so the relay cannot read them; a mod granted course data and network access can send that data to its granted hosts. These services receive connection data such as your IP address. Glaze does not collect or sell your data. Full policy: https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md

Open source (MIT): https://github.com/frostdev-ops/glaze

Canvas is a trademark of Instructure, Inc. Blackboard is a trademark of Anthology Inc. Moodle is a registered trademark of Moodle Pty Ltd. Glaze is an independent project and is not affiliated with or endorsed by any of these companies or any school.

## Release notes

NEW IN 4.0.0

• Blackboard Ultra: Glaze Writer brings an editor to discussions, messages and assignments, with Blackboard's own editor in its ⋯ menu.
• Papers use MLA 9, APA 7, Chicago 17 or your own format, with real pages, format checks, citations, footnotes, versions and .docx import and export.
• The outline follows your headings or the structure of an essay without headings. Sources can be imported from an existing bibliography.
• Spelling, grammar and autocorrect run on your device. Tests get proofing only, with no AI or completion.
• Optional AI finishes the current sentence and comments on your writing. Feedback assesses the rubric and instructions, explains estimated grades or why no score is available, and can label existing sections. Glaze never drafts.
• Review your paper before submitting its .docx through Blackboard's own upload. Back up… and Restore… include papers, versions, your dictionary and saved sources.
• Settings › AI connects named providers with their keys or a model on this device, with one model for everything or one per feature. Simple and Advanced views keep custom endpoints and model controls in reach. AI stays off until you turn it on.
• Blackboard course tabs keep their pages, search follows native course links, and turning Remember your place off cancels pending restoration.

## Single-purpose statement

Glaze customizes how Blackboard Ultra, Canvas and Moodle pages look and read, and helps users plan and keep their own coursework on those pages. Its themes and optional helpers present the user's existing course information, keep the user's own tasks, notes and drafts locally, and save accessible files the user chooses. Every permission serves that purpose.

## Permission justifications

### storage

Saves theme and extra settings in chrome.storage.sync, including user-set course nicknames, colors, tint and Looks; these follow Chrome sync when enabled. Local storage keeps course details, seen-grade and content records, the due list, Better To Do's own tasks and plans, the class schedule, reminder and streak state, widget layouts, hidden folders, supported draft backups, what-if scores and course positions, and the sites the user approved. Course tab sketches (boxes, colours and the course's name, with its page path) stay in page memory and chrome.storage.session (memory). Canvas badge records include site, account and course identifiers; some Ultra seen-grade/content records still use course ids without account scoping. Drafts expire after at most 14 days; switching backup off deletes them. Coursework records and draft text are not synced. See the privacy policy for each record's retention and removal behavior.

### unlimitedStorage

Notes, their pictures and attachments, course-card pictures and files kept for Look backgrounds are kept in the extension's own storage. This permission stops the browser from deleting them to free space. Nothing more is collected or sent because of it.

### Host access (1,000 character maximum)

Required hosts: *.instructure.com, *.blackboard.com, *.moodlecloud.com, frostdev.io and share.frostdev.io. https://*/* is optional: the popup checks the page before offering Use Glaze on the site; the first-run and Settings address fields check LMS APIs after the user grants access, returning only new grants if no LMS answers. Browser-menu grants are checked too; failed checks leave that access unused. All sites grants every HTTPS site; Glaze then asks the user first on each new school's pages. Redirected files stop with a Canvas fallback on Chrome/Edge/Firefox. Other hosts are requested as needed: Canvas Download all file servers, Gradescope, Look media, mod network hosts and custom share relays. Local testing uses optional http://localhost/* and http://127.0.0.1/*. On allowed school sites Glaze reads with the user's session and writes only on their click (planner ticks, Canvas nicknames and colors, announcement read marks, Sign out, Moodle's Edit mode).

### activeTab

When the user opens Glaze's toolbar popup, Glaze reads that tab's address and checks its markup for Canvas, Blackboard Ultra or Moodle with a packaged function, so the popup can offer to turn Glaze on for that site. It reads nothing beyond that check and keeps nothing unless the user allows the site.

### declarativeContent

Puts a dot on Glaze's toolbar icon on pages that look like Canvas, Blackboard Ultra or Moodle, with page-URL and CSS rules that Chrome evaluates itself, so the user can see where Glaze can be turned on. Glaze is not told which pages match.

### scripting

Registers Glaze's packaged content scripts on the sites the user allowed, so later visits are themed from the start, and runs the popup's LMS check in the current tab. With All sites granted, it also registers a packaged check that reads only a page's head. All code is packaged; nothing is fetched and run. It does not inject Glaze's theme into unrelated sites.

### Web-accessible resources

The theme stylesheets (theme.css, motion.css, extras.css, canvas.css, moodle.css, features/apps.css, features/lookx.css), bundled fonts, logos, stickers, pointers and pet sprites provide the theme in the page. lib/scene.js and the bundled lib/three.js draw animated backgrounds, and lib/scene-media.js with the bundled Lottie player (lib/lottie/) plays a video or animation behind the page. reader.html opens a file the user imports, and reads only with a one-use pass from Glaze's worker. Chrome requires these packaged files to be web-accessible to load them into LMS pages.

## Remote code (1,000 character maximum)

All of Glaze's own code ships in the package. The only code not in it is user-installed mods (Chrome only): JavaScript from a mod bundle the user chooses to install from a file, link, code or the Glaze gallery, or a signed update from the same author for a mod the user follows. Glaze never downloads code of its own to run. Before installing, the user sees what the mod may read and why, and approves it. Mod code runs only in the extension's manifest sandbox page, isolated from the LMS page, with no extension APIs and no cookies. Mods that read courses, to-dos or grades run in a Worker with no page of their own and reach the network only through Glaze, to HTTPS hosts that are declared and granted. A mod without data access may have a frame UI that can contact other sites. Updates must come signed from the same author and ask again for more access, and a signed blocklist can turn off harmful mods. Firefox and Safari builds run no mod code.

## Data usage (privacy practices tab)

Glaze has no analytics and does not sell user data or use it for unrelated purposes, creditworthiness or lending. Optional share sessions and mod channels send encrypted content to the selected relay. The optional signed blocklist sends a fixed credential-free GET without student identifiers. User-installed mods and linked media may contact other hosts as described above; a mod granted personal data and network access can send that data to its granted hosts. These services receive ordinary connection information such as an IP address. Keep the store's data-use answers consistent with these behaviors and PRIVACY.md.

## Screenshot and promo delivery

Submit up to five 1280×800 captures from the submission package's screenshots/ directory, plus the 440×280 small tile and 1400×560 marquee from promo/. Captures use only synthetic sample courses and seeded data.

## Privacy policy URL

https://github.com/frostdev-ops/glaze/blob/main/PRIVACY.md
