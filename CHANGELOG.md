# Changelog

All notable changes to Glaze are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Blackboard Ultra: hide folders and learning modules locally, with **Show hidden folders (N)** / **Hide them again (N)**, a pressed eye toggle, dimmed **Hidden** badges included in accessible names, and brief saved-action feedback with keyboard-friendly **Undo**. Choices stay separate by account and course and are included in Export all; imports preserve existing choices when records are malformed.

- **Blackboard navigation:** the newer MUI drawer and legacy rail now share Glaze's styling, with a bundled Glaze logo
  at first paint, school/device-only custom logos, precise sizes and spacing, custom http/https links with built-in
  icons, reversible native-item order/hiding and Reset. Institution page reads Dashboard at the same link. Optional
  clock/date, cached next-due item, shared focus timer and pet level can sit at the top or bottom. The editor previews
  the real Ultra nav rules; navigation settings and custom links are included in Export all.

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
    default widgets and Better To Do as a widget) and *Institution page* (Ultra's own page and heading, themed, nothing
    over it). The last tab is kept. Ultra's page waits hidden until the Dashboard is drawn, so it doesn't flash first.
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

[2.1.1]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.1
[2.1.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.1.0
[2.0.3]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.3
[2.0.2]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.2
[2.0.1]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.1
[2.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v2.0.0
[1.0.0]: https://github.com/frostdev-ops/glaze/releases/tag/v1.0.0
