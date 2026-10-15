<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo.svg" alt="Glaze" width="360">
  </picture>
</p>

# Glaze

Glaze is a Chrome and Safari extension that restyles Blackboard Ultra, Canvas and Moodle. It replaces the palette with one you
control, reshapes the pages around it, and adds small helpers you can see at a glance. It works on any
institution's Blackboard Ultra install, because every Ultra deployment lives under `/ultra/` on its own
domain, and on Canvas and Moodle, which Glaze recognizes on any school's domain.

<p align="center">
  <a href="https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh"><b>Get it for Chrome</b></a> ·
  <a href="https://github.com/frostdev-ops/glaze/releases/download/v2.2.0/glaze-2.2.0-safari-macos.dmg"><b>Download for Mac (Safari)</b></a>
</p>

## Features

- **Pet habitat (off by default)** — enable it under Reminders and streak in the editor or What Glaze can do, then open **Pet habitat** in Ctrl+K. To put it on Canvas's Dashboard, use Edit widgets → + Pet habitat; it uses the shared widget registration for Ultra's Dashboard panel too when that panel is available. Your study buddy earns 20 XP for work handed in on time, 10 for late work, 15 when no due date is known, 8 for a kept “do on” plan, and 5 for each verified streak day. Five levels unlock a mint bandana, a happy look, and books, a mushroom, a moon and stars to place in a small habitat. Rewards use only work, plans and streaks already stored on this device; the game never asks for assignments or runs a timer to track study. No focus-session XP, notifications, sad pets or missed-day penalties. Repeated reads do not add XP twice; unticking work removes its credit. Each site's signed-in account has its own progress and decorations. Moodle currently has no stored account-scoped completion source, so the game is absent there.

- **Palettes** — six presets, 14 colour tokens, your own saved palettes, and automatic light/dark palettes that follow the system or a schedule (dark from 20:00 to 08:00, say). Keep quizzes light (off by default) leaves quizzes you're taking and external tools such as New Quizzes unthemed on Canvas.
- **Look** — fonts for text, headings and code (two bundled; about forty more from Google Fonts and Nerd Fonts, or any Google Font by name, each previewed in its own face), text size, line height, corner radius, density, depth and glass.
- **Backgrounds** — solid; a gradient you shape (linear, radial, conic or mesh; angle, blend, spread); a drifting aurora; your own image; or ten slow animated scenes (three.js, drawn at low resolution; two for Halloween, a moonlit graveyard and a pumpkin patch) with one Intensity slider. Palette colors or your own.
- **Motion** — Off, Subtle or Expressive. Reduced-motion users get Off automatically.
- **Course colors** — every course its own color, from Ultra's stripes blended into your palette or set one by one, on course pages, Messages, Grades and the calendar.
- **Tooltips and hints** — themed tooltips. Hover a date for how far off it is, a grade for its share.
- **Extras** — score bars, due-date status ("in 2 days · Unopened", "Submitted", "Submitted late", "Graded · 18/20") and grade percentages, folder previews, course progress, new-grade and new-content badges, a what-if grade calculator that keeps your scores, a Ctrl+K command palette for courses, items, pages, settings and what's due this week (also in the popup) that on Canvas also searches your courses' pages, assignments, discussions, announcements, modules and files, remembering your place in a course's content, a backup of what you type in Blackboard's editors, Download all, which saves a folder's files as one zip, and focus mode for course documents (on by default); due-date urgency, shorter descriptions, reading width, keyboard shortcuts, dark documents (dimmed or inverted) and hiding page parts you don't use (off by default).
- **On Canvas** — the same extras, each where Canvas keeps the same thing: progress, previews, new-item badges, your place and Download all on Modules; score bars and percentages on Grades and Assignments; due-date status and urgency on Assignments, Modules and To Do; tint, a Look per course and card grades on the Dashboard (click one for the course's grades, or keep them hidden until you point at the card); draft backup for new Inbox messages to individual users in uniquely named courses. A **what-if calculator** above a course's grades works out your grade by Canvas's own rules (weights, dropped scores, excused work, grading periods) and matches Canvas's totals: change real scores, leave work out, add pretend assignments and see what you'd need for a target. It keeps what you change on your device until the real grade arrives, and never writes to Canvas. An optional **GPA** on the Dashboard gives your term and cumulative GPA on a 4.0 or plus/minus scale, weighted for honors and AP if you like, with credits, a grading scale and a what-if grade per course. Add your **past terms** by hand or from a transcript's text, web page or Word file (read on your device and shown for review first; pass/fail, withdrawn and transfer courses are listed but not counted) for an overall GPA, a **trend** chart with the same figures as a table, and a **goal**: what this term needs, and one way there from your grades now, with the lowest percent for each letter and what each course's work left needs. Kept on your device; Ctrl+K opens it. Where Canvas has its own (editor recovery, course nicknames and colors, folder zips, unread counts), Glaze leaves it to Canvas, themed; Canvas's own what-if scores still work beside Glaze's. Course progress counts module completion requirements, so a course without any shows no bar.
- **Insights (Canvas, off by default)** — your term in numbers, from a button on the Dashboard or Ctrl+K: the share of work you handed in on time per course, each course's grade over the term as a sparkline, the work due each week with the busiest weeks ahead, how often your Better To Do plans were kept, and a summary card you can save as a picture. Every chart has a table beside it. Worked out on your device from your own Canvas; only a small summary of this term is kept there, until you clear it.
- **Better To Do (Canvas, on by default)** — Glaze's own To Do list in place of Canvas's on the Dashboard and a course's home page: grouped by day in your Canvas time zone (past due, today, tomorrow, this week, later), with what's done, what's graded and announcements apart; a free custom timeframe; your own tasks, steps, a day to do something on and timed focus sessions, kept on your device; and, for teachers, work to grade with grading progress. Ticking can also mark the item done in Canvas's own planner, if you switch that on. Courses Canvas no longer lists as active are left out; if Canvas's course list can't be loaded, every course shows rather than any being hidden.
- **Export calendar (.ics) (Canvas)** — from Better To Do's Export button or Ctrl+K: one file of your Canvas deadlines, your own tasks with a due date, your "do on" days and focus sessions (as events at their times) and, if you show it, your Gradescope work, for the next 2, 4, 8 or 16 weeks or the rest of the term. Import it into Google Calendar, Outlook or Apple Calendar yourself; each item keeps the same identifier, so importing a newer file updates it where the calendar supports that. Made on your device and saved by your browser; the file holds your course and assignment names. Live sync with Google or Microsoft calendars isn't here yet.
- **Tasks on course cards (Canvas, off by default)** — each Dashboard card lists its course's next items (4 by default, up to 10), soonest first, with the date and a status chip (submitted, graded, late, missing, excused); done items can stay crossed out. It follows Better To Do's timeframe and done rules and reuses its copy of your planner, on or off.
- **Canvas's document viewer** — PDFs and files in Canvas's viewer wear your palette (background, toolbar, thumbnails) with the pages left readable, or dimmed or inverted in a dark palette. **Pen, highlighter and eraser** (off by default): any color and size, undo and redo, clear page, export and import as a file, a page saved as a picture; kept on your device per site, account and file, never sent anywhere, and beside Canvas's own annotations, never over them.
- **Syllabus import (Canvas, off by default)** — read a course's syllabus on your device: Canvas's own Syllabus page, a Word (.docx), PowerPoint (.pptx), web page or text file, or pasted text, in English, German, Spanish, French, Dutch or Portuguese. Glaze finds the professor (name, e-mail, office, office hours), class times, exam and due dates (in the course's term year), the grading scale and the weights, then shows every field for you to correct, each with the line it came from and "Check this" on a guess. Nothing is kept until you save. Then the professor, class times and coming dates show on the course home; the scale can become the course's in your GPA, the dates your own Better To Do tasks, and the weights show beside the what-if calculator (Canvas's own weights still count). Edit or delete it from the course home; Ctrl+K has Import a syllabus on any course page. PDF isn't read yet: paste its text.
- **Gradescope in To Do (off by default)** — your Gradescope assignments in Better To Do, on the course cards and in reminders, marked Gradescope with a link to each and their status (submitted, graded with the score, late, missing). On gradescope.com Glaze asks once which Canvas course each Gradescope course belongs to (with a guess by course code), then reads your assignments whenever you visit, and optionally once a day from Canvas, signed in as you. Each Canvas account is asked once, with one quiet line where its Gradescope work would show (Better To Do, the course cards or the reminders hub), before any of it shows there. Read only, kept on your device.
- **Dashboard notes and widgets (Canvas, off by default)** — a notes box (small, medium or large; saved as you type, on your device, links clickable) and a grid of widgets under the Dashboard's heading: an agenda of any day (from your planner and Better To Do's plans, with previous and next day), a focus timer (work and break lengths, an optional chime, and it keeps running from page to page), a quote (original lines in every language, changing every few seconds or once a day, with pause), music (a Spotify, YouTube, Apple Music or YouTube Music link; nothing loads until you press Load player), a guided breathing exercise and a study buddy. Order, size and float them: a floating widget stays over every Canvas page, dragged or moved with the arrow keys, and snaps to the window's edges. **What Glaze can do** (Ctrl+K, or the Dashboard) lists every Canvas extra with its switch, an optional tour and **Report a problem**, a GitHub issue with your Glaze version and browser filled in (GitHub receives that text when the page opens; nothing is posted until you submit it).
- **Notes (Canvas, off by default)** — one switch with the Dashboard notes: a notes app over the page, folders for a course or for anything, rich text (headings, bold, italic, underline, strikethrough, lists, checklists, quotes, code, links), pictures pasted or added and attachments, and links to a course's Canvas files, pages and module items picked from a list. Search titles and text, sort by last edited, created or title, filter by course or folder; rename and move notes, rename, reorder and delete folders (keeping their notes or trashing them too). A trash keeps deleted notes and folders 30 days. Export a note as Markdown or HTML, or everything as a zip of Markdown and pictures that imports back (a note already there is replaced only by a newer copy, so importing the same backup twice adds nothing). The same note changed in two tabs never loses text: the later save becomes a copy beside it. It opens and acts only on your own clicks and keys. Open it from Ctrl+K (Notes, New note, Course notes), the Dashboard notes, a course card's create menu, Course notes on a course's home, or a class reminder. Kept on your device in Glaze's own storage, which your school's pages can't read; the Dashboard notes stay as they are.
- **Class schedule (Canvas)** — import your timetable from an `.ics` calendar (a file, or a calendar link on your own Canvas site), a registrar's page saved as HTML, a Word file or text you paste (Banner, PeopleSoft and Workday copies, "MWF 9:00–9:50 AM", "TR 1:30-2:45pm", 24-hour times, and day names in all six languages). Glaze reads it on your device and shows every class it found for review before anything is kept: each one matched to your Canvas course by code or name (or kept as not a Canvas course), every field editable, guesses marked, holidays and breaks as days off. Your classes show in the agenda widget with the day's work, and optionally as class-start reminders. Ctrl+K, Class schedule, or the agenda's button. Photos and PDFs aren't read yet.
- **Reminders and streak (Canvas, every part off by default)** — due-date reminders at the lead times you pick (15 minutes to 2 days, several at once), exam reminders (quizzes and exam-like titles in all six languages), reminders for Better To Do's "do on" days and focus sessions, and class-start reminders from your class schedule (5 to 30 minutes before), each its own switch. They show only inside Canvas, as one small toast in the corner that never takes focus, never as a browser notification; what came due while Canvas was closed shows once, not as a pile. A hub from the To Do header's bell or Ctrl+K lists what's coming and lets you mute items. An optional streak counts the days in a row with nothing missed, with two free restores a month. Everything stays on your device.
- **On Moodle** — the theme on Moodle's Boost theme (Moodle 5; 4.x where its markup is the same): Dashboard, My courses, course and activity pages, grades, calendar, messages and the login page. Your course total on each course card, from Moodle's grades overview (points, a percentage or a letter, as your Moodle shows it); what's due this week from your Timeline, in the popup and the Ctrl+K palette, which also lists Moodle's pages, your courses and the course's tabs. A course's own tint and Look on its course and activity pages and on its card, set from the course menu on the card or in the editor (the colour is the one Moodle gives the course), and the keyboard shortcuts (`g` then `d`, `c`, `a`, `g`, `m`, `?`) on the Dashboard, My courses, calendar, grades, messages, and a course's sections and activities.
- **Looks** — ten ready-made combinations (Graveyard and Pumpkin Patch are for Halloween) of palette, fonts, shape and background, one click each in the popup or the editor, or one for a single course.
- **Editor** — every setting in one page with a live preview; the popup keeps the quick controls.
- **Theme codes** — share your palette, fonts, look and background as one line of text; a pasted code previews before it applies.
- **Canvas sidebar** — style Canvas's own navigation with a solid color, gradient or picture, filters and an overlay; choose text and icon colors, labels and size, hide the institution logo or collapse the rail. Every native link stays reachable. The editor warns about low contrast; local pictures share the course-card storage limits and stay on this device. Theme codes carry linked pictures only. Canvas only.
- **Canvas course cards** — each Dashboard card its own color, gradient or picture (a link, or a file kept on your computer) with filters, focus, zoom and overlay; bookmarks as icons on the card; card width, spacing, corners, picture height and a condensed layout; hover effects, particles and a cat or bunny on your first card; an optional create button. The card editor warns, with the measured ratio, when text on a card would be hard to read. Fonts can be searched.
- **Looks gallery** — free Looks shared openly at [frostdev.io/glaze/looks](https://frostdev.io/glaze/looks). Use this Look in Glaze opens it in the editor's preview; save favorites, and go back with Previous Look from a history of the themes you wore. Both stay on your device.
- **Stickers, pointers and Look rotation** — put stickers from four packs, or your own pictures, on any course page (Ctrl+K: Place stickers on this page), then drag, resize, turn or remove them with the pointer or the keyboard; they never get in the way of a click and stay off quizzes you are taking. Three pointer sets (Aqua, Lilac, Pearl) or your own picture, with the usual text cursor kept in text fields. Look rotation wears the next of your chosen Looks and favorites every 6, 12 or 24 hours, weekly or daily at a set time. Free, unlimited, and kept on your device.
- **Languages** — English, Spanish, French, German, Portuguese (Brazil) and Dutch. On Blackboard, Glaze writes in the language Ultra is shown in; the editor and popup follow the browser. Adding one is a file in `i18n/` (see `lib/i18n.js`); the five above are machine translations, and corrections are welcome as bug reports.

- **Any host** — matches `https://*/ultra/*`, so it works on your university's Blackboard without configuration. Canvas is matched on `*.instructure.com`, and recognized by its own stylesheet on a school's own domain. Moodle is recognized by the keywords line its core writes in every page's head, together with the page id and layout it puts on the page's body.

## Install

**Chrome:** install from the [Chrome Web Store](https://chromewebstore.google.com/detail/jmmaeoajomodnbnlmdikjooalmcilooh).

**Load unpacked (development):**

1. Clone or download this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.
5. Open your Blackboard Ultra, Canvas or Moodle site and click the Glaze icon.

## Safari

[Download the Mac app](https://github.com/frostdev-ops/glaze/releases/download/v2.2.0/glaze-2.2.0-safari-macos.dmg): signed and notarized, attached to each release on
[GitHub Releases](https://github.com/frostdev-ops/glaze/releases). It runs
on Intel and Apple Silicon Macs with macOS 12 or newer. Glaze's styling needs Safari 17.2 or newer;
the frosted-glass blur needs Safari 18.

1. Open the `.dmg`, open **Glaze** and click **Install Glaze**. It copies itself into Applications
   (your own `~/Applications` if you aren't an administrator) and reopens from there. Dragging it into
   **Applications** works too. (A `.zip` of the same app is there too.)
2. Glaze opens Safari's Extensions settings and shows an illustrated guide: tick Glaze, then allow it
   on your Blackboard, Canvas or Moodle site. The guide ticks off the first step as soon as Safari turns Glaze on.

The downloaded Mac app checks `https://frostdev.io/projects/glaze/appcast.xml` about once a day
while Glaze is in use and downloads updates from GitHub. Sparkle system profiling is disabled.
Background checks stay silent and skip updates that need user interaction; opening Glaze yourself
can show the standard updater interface. An installation previously prepared through that interface
may still show its existing progress window when a background check finishes it. The Mac App Store
and iPhone/iPad apps use App Store updates and include no Sparkle updater.

Safari loads Glaze from this Mac app. The Xcode project is in `safari/`; to build the app yourself
you need Xcode and the public key from [Mac update release setup](#mac-update-release-setup):

```sh
sh scripts/build-safari.sh
```

That packages the extension, copies it into a temporary copy of the project, and builds a universal
app in `release/Glaze.app`, signed with the configured Developer ID. Override `SAFARI_SIGN_IDENTITY`
and `SAFARI_TEAM_ID` to use a different identity. Safari only installs apps from outside the App Store
when they are notarized, so pass a saved `notarytool` Keychain profile:

```sh
NOTARY_PROFILE=your-profile sh scripts/build-safari.sh
```

or set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` for an App Store Connect API key. The script
then notarizes the app, staples the ticket, checks Gatekeeper, and writes
`release/glaze-<version>-safari-macos.zip` and a notarized `.dmg`, each with its SHA-256 checksum. Without credentials the zip is
marked `unnotarized` and is for development only.

For the Mac App Store, `scripts/appstore-safari.sh` archives the same project with App Store signing
and uploads the build to App Store Connect. It needs an App Store Connect API key with the Admin role in
`ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID`; Xcode creates the distribution certificate and profiles
on first use. `APPSTORE_EXPORT_ONLY=1` builds the signed package without uploading. Listing text,
screenshots and review submission happen in App Store Connect.

The app bundles only the files the Xcode project lists for its two extension targets (Mac and iOS); a folder
reference brings everything under it. Every build script copies the package into the project's Resources folder
and then runs `node scripts/safari-resources.js` on it, which stops the build if the package has a file the
project doesn't list. Add a new top-level file or folder to both extension targets in Xcode;
`test/safari-resources.test.js` checks the project against everything the package ships.

`scripts/package-safari.sh` regenerates the Xcode project from scratch and replaces its native edits.
Use it only when you mean to regenerate the project. It doesn't know about the iPhone and iPad targets below.

### Mac update release setup

The Developer ID build stages Sparkle 2.10.0 in a temporary Mac project through
`scripts/stage-safari-dmg.py`; the checked-in App Store project stays free of Sparkle.
Glaze's signing key was made once with the [Sparkle distribution's key generator](https://sparkle-project.org/documentation/#eddsa-ed25519-signatures)
(`bin/generate_keys`), which keeps the private key in the login Keychain (account `ed25519`) of the Mac
that made it. Back it up with `generate_keys -x <file>` and keep that file somewhere safe: without it,
no update can be signed for apps already installed. `scripts/build-safari.sh` passes the public key
(`0lbeC9MO1QDsjSGjs6iyxSBwXKMpEiKVoB+5wZwQEqY=`, or `SAFARI_UPDATE_PUBLIC_KEY` if set) into
`SUPublicEDKey` in the staged Mac app's `Glaze/Info.plist`. Staging on its own without a key leaves
updates disabled; a release build rejects the `REPLACE_WITH_SPARKLE_EDDSA_PUBLIC_KEY` placeholder.

After building and notarizing a release, generate its signed update entry locally (replace
`<version>` with the manifest version):

```sh
sh scripts/safari-appcast.sh "release/glaze-<version>-safari-macos.dmg" /path/to/Sparkle/bin
```

The helper verifies the notarized DMG and app, checks that the Keychain signing key matches the
app's public key, and writes `release/appcast.xml`, preserving older entries. It does not publish
anything. Upload the DMG to its GitHub release before publishing that feed at
`https://frostdev.io/projects/glaze/appcast.xml` (the frostdev.io path is `/projects/glaze/appcast.xml`).
Use the same Sparkle Keychain account for key generation and appcast signing; if you choose a
custom account, set `SAFARI_UPDATE_KEY_ACCOUNT` to it when running the helper.

### iPhone and iPad

Glaze for Safari on iPhone and iPad needs iOS or iPadOS 18 or newer. It comes from the same App Store
listing as the Mac app; buying or installing on one platform covers the other.

1. Install **Glaze** and open it. It shows a two-step guide.
2. Turn Glaze on in **Settings › Apps › Safari › Extensions › Glaze** by switching on
   **Allow Extension**. On iOS 26.2 and newer, the guide's **Open Settings** button takes you to
   Safari's extension settings, and the guide ticks the step off as soon as Glaze is on.
3. Open your Blackboard Ultra, Canvas or Moodle site in Safari and tap the extensions button in the address bar (a puzzle
   piece; on iPhone it can be in the page menu at the left of the address). Tap **Glaze**, then **Always Allow…** and **Always Allow on This Website**, and reload the page.

The popup and the editor are under the same button. The editor also opens from Settings › Apps › Safari ›
Extensions › Glaze › Settings.

The iOS app is two more targets in the same Xcode project (`Glaze iOS` and `Glaze iOS Extension`), sharing
the extension's resources and native handler with the Mac targets. `scripts/appstore-ios.sh` archives it
with App Store signing into `release/Glaze-iOS.xcarchive` and `release/glaze-<version>-ios.ipa`. It uses
the App Store profiles already on the Mac; set `ASC_KEY_PATH`, `ASC_KEY_ID` and `ASC_ISSUER_ID` to let Xcode
create them. It never uploads unless `APPSTORE_UPLOAD=1` is set. To try it in the Simulator, run the
`Glaze iOS` scheme in Xcode.

## How it works

The content script adds three stylesheets it owns (`theme.css`, `motion.css`, `extras.css`) at page
start, so the popup can switch the theme on and off without a reload. `theme.css` remaps Blackboard's
own `--palette-*` custom properties onto Glaze's `--gz-*` tokens and restyles Ultra's components. Every
setting becomes either a `--gz-*` variable or a `data-gz-*` attribute on `<html>`, which the content
script writes from your saved settings, so the CSS never needs JavaScript to decide anything. A small
DOM sweep tags the long tail — hardcoded light backgrounds, dark text, viewport-fixed bars — with
`data-gz-*` attributes the stylesheets then restyle.

Each LMS loads only what it needs at first paint: the shared `content.js` (with the small libraries it uses)
plus that site's own part, `content-ultra.js` on Blackboard Ultra and `content-canvas.js` on Canvas. Moodle
has no part; it is themed by `content.js` and `moodle.css`. Everything else, from the command palette to the
grade calculators, loads on demand from `features/` the first time a page needs it.

## Building

```sh
./package.sh
```

Writes `dist/glaze-v<version>.zip`, ready for the Chrome Web Store. Requires `node` and `zip`.

```sh
node --test
```

Runs the tests for the colour, settings and page-text logic. No dependencies to install.

### Publishing to the Chrome Web Store

```sh
sh scripts/publish-chrome.sh
```

Packages the extension, uploads it with the Chrome Web Store API, and submits it for review. Pass a
zip path to upload a specific build; set `CWS_NO_PUBLISH=1` to upload without submitting. It signs in
as the `cws-publisher` service account through `gcloud` impersonation, so no key file is kept: your
Google account needs the Service Account Token Creator role on it, and the service account must be
added under **Account** in the Developer Dashboard. The listing text, screenshots and privacy answers
aren't in the API; edit those in the dashboard. The publisher and item IDs default to Glaze's; override them with `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID` (the publisher ID is in the dashboard's address, after `/devconsole/`).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Privacy

Glaze stores your settings in `chrome.storage.sync`, including the course nicknames, colours, looks and tint
you set in a course's menu. These follow Chrome sync when it's on; Safari keeps them on this device only.
It keeps the course names your LMS lists, which grades and course
items you've seen and a backup of what you type in Blackboard's editors (until it's posted, 14 days at most) on your own
device. On Canvas it also keeps course names, codes and colors, unread-grade counts, module-item ids and your place,
with site and account identifiers for badge records, and the what-if scores and pretend assignments you enter per site,
account and course. Your GPA choices per course (credits, level, scale) sync with your settings. Supported new Inbox drafts keep the body, subject and destination
identifiers locally for up to 14 days. Your Looks history (the last 20 themes) and favorites stay on your device too,
as do your stickers, your own sticker and pointer pictures and Look rotation's list;
the Looks gallery is a website you visit yourself, and Glaze sends it nothing. Canvas's own what-if scores and editor recovery remain with Canvas.
Better To Do's own tasks and plans stay on your device too, with a two-minute copy of your Canvas planner items.
A calendar file you export (.ics) is made on your device and saved by your browser; it holds your course and assignment names, and Glaze keeps no copy.
Dashboard notes, the widgets' layout, the timer and the music link you type stay on your device. So do the notes app's notes, folders, pictures and attachments, in Glaze's own storage (not the school page's); its Canvas link picker reads your own Canvas site, and only a link and title are kept. A music widget contacts its
player (Spotify, YouTube through youtube-nocookie.com, Apple Music) only after you press Load player.
Your class schedule stays on your device: the file, page or text you import is read there and never uploaded, and a calendar link is read only when it is on your own Canvas site.
Reminders, what you've snoozed or muted and your streak stay on your device as well, and so do your marks on documents; reminders show only inside Canvas pages, and Glaze has no notifications permission.
With Gradescope in To Do on, Glaze reads your own Gradescope course pages (read-only, signed in as you) and keeps the assignments on your device; nothing from Gradescope goes anywhere else.
It has no analytics. Glaze's one write anywhere is opt-in: with Better To Do's "Tick off in Canvas too" on, ticking an item
marks it done or not done in your own Canvas planner, as Canvas's List View does. The extension's other requests are read-only and go to your own Blackboard, Canvas or Moodle site
(folder previews; a folder's files when you click Download all; your grades and submission status for due dates, new-grade badges, the calculator and
your overall grade on course cards; on Canvas a course's assignment groups when you use its what-if calculator;
your course list and a course's items for the command palette and new-content badges; on Canvas, what you type in the command palette, to search your courses' titles), to Google Fonts or jsDelivr for a web
font you choose, and to a background image, course card picture or sidebar picture you choose. For Canvas Download all, the extension's background worker
fetches signed file links from your school's file host without cookies. Links and file bytes stay in memory while
Glaze makes the zip; they are not saved in extension storage. Blackboard's course content answers can include a course tool's launch credentials: Glaze asks for them to be left out and never keeps them. The downloaded Mac app also checks
`https://frostdev.io/projects/glaze/appcast.xml` about once a day and downloads updates from GitHub,
with system profiling disabled. These services receive ordinary network requests, including your IP
address. See [PRIVACY.md](PRIVACY.md).

## License

MIT — see [LICENSE](LICENSE).

---

Blackboard is a trademark of Anthology Inc. This project is not affiliated with, endorsed by, or
sponsored by Anthology Inc.
