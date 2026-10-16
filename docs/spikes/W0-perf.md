# W0: performance budget and baseline (updated in W0b, W0c and W0d)

**Verdict.**
- **B0b: each LMS has its own first content script (measured): Ultra 206,952 B, Canvas 201,446 B, Moodle 171,507 B,**
  from 228,144 B for all three (17 B under the old ratchet). `content.js` is the core; `content-ultra.js` and
  `content-canvas.js` hold what only that site does (B0b below). Same pixels and 0 light frames before and after.
- **W0d: the first content script is now 223,687 bytes in 7 files (measured), 29,687 less than the 253,374 Wave 2 and
  W12 had taken it to.** Draft backup, Ultra's what-if calculator, the document buttons and your place in a course load
  on demand (`features/drafts.js`, `whatif.js`, `docs.js`, `place.js`) behind a per-pass hook each. Same outcomes before
  and after on the local Canvas, with 0 page errors (below).
- W0c: the first content script is now 248,536 bytes in 7 files (measured), 46,915 less than the 295,451 Waves 1 and 2
  had taken it to.** The command palette, keyboard shortcuts, the course menu's popover, folder previews and Download all
  load on demand (`features/*.js`); content.js keeps a small hook for each. Same screenshots before and after,
  byte for byte (below).
- W0b: 290,457 bytes, under the plan's 300 KB. It was 457,988 at W0 and 465,846 after the G1 merge. W0b loads the five
  translation files, `lib/zip.js` and `lib/drafts.js` on demand through the new loader.
- Glaze paints a dark palette before Canvas's first contentful paint on every measured load, both before and after W0b:
  **0 light frames** in every Glaze-on run.
- On pages served in German and French, **0 of Glaze's words were seen in English** before their translation arrived
  (measured, below). English pages load no catalogue.
- `test/perf-budget.test.js` holds the size (now 223,687 + 2%) and the timer/sweep rules as a ratchet.
- `test/loader.test.js` holds the loader's allowlist, its document targeting and its completion check.

Tags: **measured** / **documented** / **inferred**.

## Static budget (`node --test`, measured)

| Rule | W0 | W0b | W0c | W0d | Test |
|---|---|---|---|---|---|
| First content script (Canvas/Ultra) | 457,988 B, 14 files | 290,457 B, 7 files | 248,536 B, 7 files | **223,687 B, 7 files** | ≤ 228,161 B (baseline + 2%) |
| `lib/detect.js` (every other https page) | 1,196 B | 1,196 B | 1,196 B | 1,196 B | < 2,048 B |
| `setInterval` faster than 60 s | 2 | 2 | 2 (the keep-alive now in `features/download.js`) | 2 | Each reviewed call, by exact text and count, with the clear that bounds it (`FAST_INTERVALS`). Ultra's 50 ms hold-and-reveal poll; Download all's 15 s worker keep-alive |
| `getComputedStyle` / `querySelectorAll('*')` / `getElementsByTagName('*')` | 11 | 11 | 11 | 11 (two scroller reads now in `features/docs.js`, `place.js`) | Each reviewed call, by exact text and count (`STYLE_READS`). The documented long-tail sweep, plus single elements or one element's ancestors |

Notes on the scans (after Codex's W0 review):
- They cover every first-party script Glaze ships, at any depth (`features/`, `lib/`, `i18n/`, the root), whether it is
  loaded on demand or not.
- They find a call however it is written: `f (…)`, `f/* … */(…)`, `f // …` then `(…)` on the next line, `f?.(…)`,
  `obj.f(…)`, `obj['f'](…)`, or split over lines. A fast timer's clear is matched in the code with comments removed.
  A renamed alias and `.call`/`.apply` are out of reach; review has to catch those.

The size check reads the manifest, so moving a file out of a site's entry shows up as a saving at once. After a cut,
lower that site's `FIRST_SCRIPT_BASELINE` to the new total so it can't creep back. Since B0b each site has its own:
Ultra's and Canvas's entries, and Moodle's list as `lib/background.js` registers it (Canvas's without `content-canvas.js`).

## B0b: the first script per LMS (measured)

Before is the integration branch at `71a9632` (228,144 B, the same 7 files on every site). Bytes are `fs.stat` sizes,
after merging the integration branch at `a7108f3` (W19a, B0 and the owner's decisions; `defaults.js` one byte less).
The runs below compare `71a9632` with B0b on it; the merge was checked again on the Canvas Dashboard (last item).
After Codex's B0b review, `content.js` gained 567 B: a page that has to ask for its part keeps the theme while it waits
(`test/site-part.test.js`), and `GZ_CTX` asks the part for its helpers when called; the checks were run again after it.

| Site | Files | Before | After | Under the old limit (228,161 B) |
|---|---|---|---|---|
| Ultra | libs, `defaults.js`, `content-ultra.js` (35,445), `content.js` (89,449) | 228,144 | **206,952** | 21,209 |
| Canvas | libs, `defaults.js`, `content-canvas.js` (29,939), `content.js` | 228,144 | **201,446** | 26,715 |
| Moodle | libs, `defaults.js`, `content.js` | 228,144 | **171,507** | 56,654 |

Checks (headless Chrome for Testing, `nice -n 15`, one run at a time):
- **Same pixels, local Canvas:** `canvas-shots.js` on the Dashboard, BIO 1100's home and its Grades, Frost and Paper,
  default settings: 6 of 6 PNGs identical (MD5). With urgency, Better To Do, card tasks, GPA, Insights, syllabus import
  and a solid icons-only sidebar on (Frost), plus Modules: course and Modules identical; the Dashboard differs only in
  the first card's photo (11,793 px, at most 5/255) and the Grades page in 2 px (3/255). The old build shot twice
  differs from itself the same way (11,793 px; 75 px), and the new Dashboard is pixel-identical to its second shot.
- **Same pixels, local Moodle 5.3:** Dashboard, My courses and BIO 1100, Frost and Paper: 6 of 6 identical; with BIO
  1100's tint and the shortcuts on: 2 of 2 identical (the tint was worn: surface `#152336`).
- **Same pixels, Ultra:** no Ultra site here. The options preview (a mock of Ultra running the real scripts) in Frost,
  then fed tint and the extras as the editor does: both identical, the same 26 `data-gz-*` on `<html>`, the same due
  chip, the same two missing-file errors as before (assets the harness leaves out). `GZ_CTX` there lacks only
  Canvas's four (`canvasCourses`, `profile`, `canvasPeek`, `moduleItems`).
- **No light frame, local Canvas** (W0's command, `--perf 3 --look Frost`, dashboard and course home, medians in ms,
  before / after; a second pair of dashboard runs in brackets):

  | Page | Start | Dark at | FCP | Script | Light frames |
  |---|---|---|---|---|---|
  | dashboard | first | 461 / 492 (558 / 477) | 508 / 536 | 970 / 949 | 0 / 0 |
  | dashboard | next | 305 / 342 (355 / 329) | 348 / 388 | 361 / 372 | 0 / 0 |
  | course home | first | 730 / 750 | 784 / 808 | 1,418 / 1,446 | 0 / 0 |
  | course home | next | 482 / 471 | 528 / 524 | 895 / 885 | 0 / 0 |

  "Dark at" comes before FCP in all 36 loads; the differences are inside the run-to-run spread (the old build's own
  dashboard "next" moved 50 ms between its two runs).
- **No light frame, local Moodle** (`--lms moodle --perf 3 --look Frost`, Dashboard and BIO 1100): 0 light frames in all
  24 loads, dark before FCP in each. Times are Moodle's PHP serving (2–4 s, one load 12 s) and move by seconds run to
  run; script time 117–366 ms before, 108–396 ms after.
- **After the merge** (integration head `a7108f3` against B0b merged into it; the Dashboard and BIO 1100, Frost and
  Paper): 3 of 4 identical. Frost's course home differs only in the course-progress bar's rounded cap and gradient
  (1,849 px, 4 by more than 2/255); the old build shot twice differs from itself by exactly that, and `71a9632` against
  B0b shot back to back is identical there, DOM included.
- **Not run:** a live Ultra site (B0 checks it on the owner's account), Safari, Firefox.

## W0b: loading on demand (measured)

What moved out of the first content script, and when each file now loads:

| File | Bytes | Loads |
|---|---|---|
| `i18n/de.js`, `es.js`, `fr.js`, `nl.js`, `pt-BR.js` (after G1's strings) | 172,945 | Only the page's own (`<html lang>`), asked for as the page starts; none on an English page or a language Glaze doesn't have |
| `lib/zip.js` | 4,463 | The first Download all click |
| `lib/drafts.js` | 2,749 | An editor it backs up appears (the Inbox compose dialog on Canvas, an editor on Ultra), or old copies need tidying |

How the language loads without a flicker:
- The catalogue is requested at document start, in parallel with the settings.
- The theme (stylesheets, `--gz-*` variables, the sweep) never waits for it.
- The extras that write words (chips, the progress bar, badges, the course menu, Download all, the document tools) wait
  until it is in. The first pass after it arrives draws them over the whole page.
- The catalogue is asked for once per page. If that fails, the page stays in English for good: switching language under
  the student later would be worse. This is tested in `test/ondemand.test.js`.
- Anything drawn outside the extras' wait (the keyboard help) is redrawn when the words arrive.
- An editor written in while `lib/drafts.js` is on its way is backed up once it arrives, without another keystroke.
- `lib/i18n.js` no longer caches a language whose catalogue is still on its way as English.
- The popup and the editor keep loading all five. They translate their page synchronously as it opens, so a catalogue
  arriving later would flash English there; and they aren't on every LMS page, so they don't count toward this budget.

Checks on the local Canvas:
- **What a page holds** (measured; read through CDP from Glaze's isolated world):

  | Page | Loaded |
  |---|---|
  | English modules, dashboard, inbox | no catalogue, no zip, no drafts |
  | After a Download all click | `GZ_ZIP` (the zip saved: "Saved 1 file") |
  | After opening Inbox compose | `GZ_DRAFTS` |
  | Course home `?glaze_lang=de` | `de` only |
  | Assignments `?glaze_lang=fr` | `fr` only |
  | Grades `?glaze_lang=pt-PT` | `pt-BR` only |

- **No light frame, no English-then-translated** (measured):
  - Command: `canvas-shots.js --perf 3 --look Frost --look Synthwave` on course home `?glaze_lang=de` and assignments
    `?glaze_lang=fr`. `?glaze_lang=` serves the page as that `<html lang>`, read-only.
  - Every text and `data-gz-*` label Glaze wrote was recorded as it appeared and checked against the English of every key
    the language translates.
  - Result over 24 loads, first page of a tab and next page: **0 light frames, 0 words in English**. The first German or
    French words appear 1.5–3.4 s in at ×4 throttling, as the extras are drawn.
  - The same check flags the English when the catalogue fails to load. It did, before the harness's dev copy was given
    host access to localhost, which shows the check works.
- **Main-thread time:** within the noise of a shared machine. The Glaze-off rows moved by as much as 500 ms between W0's
  run and W0b's, so the script-time medians don't isolate a W0b saving. The byte saving is exact; its parse and compile
  share wasn't measured on its own.

## W0d: rarely used code on demand, round 2 (measured)

Before is the integration branch at `ea253a5` (252,659 bytes), merged with W12 at `6205c80` (253,374). Section sizes are
bytes of content.js between its `// ----` markers.

| Section | In content.js before | In content.js after (the hook) | On-demand file | Loads |
|---|---|---|---|---|
| Draft backup | 14,933 | 2,592 (the editor selector, `local`, the three input listeners, the per-pass presence check, `tidyDrafts`) | `features/drafts.js` 13,782 (after `lib/drafts.js`) | An editor it backs up is on the page (an Ultra editor; Canvas's Inbox compose on /conversations) or written in, with the switch on |
| Ultra's what-if calculator | 6,828 | 1,506 (`make`, Canvas's `canvasGrades`, the check) | `features/whatif.js` 6,318 (after `lib/gradecalc.js`) | An Ultra course's Grades with its overview and grades in, with the switch on |
| Document buttons | 7,243 | 2,463 (`PREVIEWS`, `DOC`, `docButton` (the course menu's too), `setDark`, the check, the Esc listener) | `features/docs.js` 6,231 | A course document (top frame, switch on), a file preview there, or on Ultra a preview frame in any frame |
| Your place in a course | 9,297 | 1,714 (the click and "you did something" listeners, the check) | `features/place.js` 9,327 | An Ultra course outline with rows; a Canvas course's Modules list, or an item opened from it (`module_item_id`) |
| Elsewhere (`GZ_CTX`, `disable()`, the drafts switch) | | +339 | | |
| **First content script** | **253,374** | **223,687** | | |

How each hands off (the W0c lessons):
- Events that must be seen first stay in content.js: the first keydown/input/paste in an editor is buffered (the editor)
  and replayed once both files are in; the Esc that leaves focus mode is a window capture listener registered at
  document start, as before, which asks `GZ_DOCS.esc`; the "you did something" listeners for your place stay too, so a
  scroll you make before `place.js` arrives still stops it putting you back (`GZ_CTX.acted()`), and the last row clicked
  is still known (`GZ_CTX.tapped()`).
- After Codex's W0d review: on Ultra, anything you do once the outline is there, while `place.js` loads, stops it
  putting your place back (`GZ_CTX.acted()` is now a time, compared with `placeAsked()`); on Canvas, what is written in
  compose before your account and courses are in waits for them and is then kept (it was dropped). A test for each fails
  on the code before (`test/ondemand.test.js`). First script 223,896 B after these.
- And: an editor gone (compose closed, the reply or page changed) before `drafts.js` or the account arrived lost its
  first input. content.js now reads what a copy needs as it is written (`draftAt`: the text and HTML, the page, the
  ancestors' Blackboard ids, compose's course, recipients and subject), refreshed each pass while the files load, and
  `drafts.js` keeps that copy (`keep`) once it can make the key, under the same rules (switch, worth keeping, 14 days,
  removed once posted). Tests for Ultra and for compose closed before the files and during the account fail on the code
  before. +973 B: 225,528 B with W9's hooks in.
- And: the snapshot held elements, so an editor and wrapper Ultra reused for another post (post_12_3/ed1 → post_99_1/ed2)
  before the copy was made put the old text under the new ids. `draftAt` now reads the values (the nearest Blackboard id,
  the editor's id, the page); `keyOf` uses only those. An editor still on the page is taken up as just written only if
  it is still on the same post; one put to another post while the files load keeps what it held for the first one too
  (`take`). Tests for both reuse orders fail on the code before. +718 B: 226,275 B with W10 in.
- Each file's entry re-checks the switch, Glaze being on and the page when it arrives (`write`, `watch`, `render`,
  `sync`): nothing is drawn by a file that lands after you turned it off or left.
- New globals `GZ_DRAFT_UI`, `GZ_WHATIF`, `GZ_DOCS`, `GZ_PLACE`: none is declared by the first script (tested).
- New `GZ_CTX` entries: `draftEditor`, `bookFor`, `docButton`, `setVar`, `setDark`, `PREVIEWS`, `DOC`, `darkTheme()`,
  `canvasCourseKey`, `ROWS`, `holding()`, `tapped()`, `acted()`. `setDark` stays in content.js because it writes
  `settings`; W9 can move the `darkDocs` handling with it.
- Open branches' hooks keep their place: `armFlip` (W12, now merged) still uses content.js's `local`; `syncDocTools`
  keeps its name and its call sites.

Checks on the local Canvas (measured): a headless script (Chrome for Testing, Frost) ran the same steps on `ea253a5` and on
W0d and read which modules were in Glaze's isolated world through CDP.
- Same outcomes, 0 page errors on both: a wiki page and an assignment show the document buttons; focus mode turns on
  (`data-gz-focus`, the reading bar) and Esc turns it off; Syllabus.pdf's preview shows "Dark documents" and toggles
  `darkDocs`; an Inbox compose written in is kept (1 copy), offered back after a reload (1 bar) and restored word for word;
  Modules scrolled to 900 px comes back at 900 px, and the item opened from it is marked (`context_module_item_271`).
- Same pixels: page in focus mode, assignment, Inbox offer and Inbox restored are identical PNGs (same MD5). The file
  preview's PNG differs only inside Google's viewer frame (cross-origin, loaded from the network), the same in both by eye.
  Rerun after merging W12: the same outcomes and 0 errors; the assignment's PNG no longer matches `ea253a5` byte for byte
  (W12 is in it now) but shows no difference by eye. No W12-only baseline was shot.
- Loaded: dashboard and grades none of the four; the page and assignment `GZ_DOCS`; the Inbox `GZ_DRAFT_UI` once compose
  is open (none before); Modules `GZ_PLACE`.
- **Not moved:** new grades and new content (13,874 + 4,114): they run on the Dashboard, the course lists and every Ultra
  course page, and share `cardBadge`, `cardsInView`/`inView`, `courseItems` (the palette's too) and the openNew listener,
  so a hook would save little on the pages that pay for them. Next candidates, not measured for cleanliness: grades on
  course cards (7,688), the Canvas editor's writing area (`themeEditors`, ~2.5 KB of CSS text).
- **Not run:** Ultra (no Ultra site here; the what-if calculator, Ultra's drafts and the outline's place moved unchanged,
  with tests for when each hook loads), Moodle (none of the four runs there; their hooks return as before), Safari, Firefox.

## W0c: rarely used code on demand (measured)

Before is the integration branch at `7616be4` (W6, W20 and W11 merged): 295,451 bytes. Section sizes are bytes of
content.js between its `// ----` markers.

| Section | In content.js before | In content.js after (the hook) | On-demand file | Loads |
|---|---|---|---|---|
| Course menu | 21,732 | 7,794 (the card buttons, nicknames on the page, the press handler) | `features/coursemenu.js` 15,611 | A card button is first pointed at, focused or pressed |
| Command palette (with W6's search, W11's commands) | 14,510 | 1,117 (the Ctrl/⌘K listener) | `features/palette.js` 14,342 | The first Ctrl/⌘K |
| Download all | 11,432 | 931 (the page check) | `features/download.js` 11,963 | A course page with a folder or module (Ultra), or a course's modules (Canvas), with the switch on |
| Folder previews | 8,603 | 2,667 (course id, folder toggle and Canvas's lists, shared; the hover check) | `features/previews.js` 7,933 | The pointer first rests on a folder or module row (or, on Canvas, focus reaches one) |
| Keyboard shortcuts | 4,687 | 1,231 (`typing`, the key listener) | `features/keys.js` 5,033 | The first `g` (on Ultra also `/` or `?`) with the switch on |
| Elsewhere (`GZ_CTX`, the calls in passes and `disable()`) | | +309 | | |
| **First content script** | **295,451** | **248,536** | | |

How each hands off:
- The listener that must act at once stays in content.js: Ctrl/⌘K is stopped there before the file arrives; the card
  button's press is kept from Ultra's card there; Ultra's `?` keeps its `preventDefault`. The key, press or hover is
  handed to the file when it arrives (keys: a copy of the key as it was; previews: only if the row is still hovered or
  focused).
- Once loaded, each file adds its own listeners (the course menu's Esc/Tab/arrows and outside press, the previews' hide
  on leave/scroll/Esc) and content.js's passes call it: `GZ_COURSE_MENU.sync`, `GZ_DOWNLOAD.sync`, `GZ_PEEK.sync`,
  `GZ_KEYS.sync/off`; `disable()` closes what is open.
- The hook points of the branches still open keep their place: `syncCourseMenu`, `syncTodo`, `syncCardTasks`,
  `syncRemind`; the palette's commands from other files are still read as `globalThis.GZ_TODO_UI?.cmds()` and
  `globalThis.GZ_REMIND_UI?.cmds()`, now in `features/palette.js` `canvasCommands`.
- The course menu's edits write `settings.courses` through `GZ_CTX.setCourses`, which repaints as before.
- Found in the browser, not by the tests: `var GZ_PALETTE` clashed with `defaults.js`'s `const GZ_PALETTE` and the file
  threw as it loaded. It is `GZ_CMD` now, and `test/loader.test.js` checks no loadable file declares a name the first
  script has.

Checks on the local Canvas (measured):
- **Same pixels.** `canvas-shots.js --look Frost --settings '{enhance:{keys:true}}' --course-menu` on the Dashboard (course
  menu open), BIO 1100's modules (Download all buttons, a module's preview through focus), course home (palette opened
  with Ctrl+K, "lab" typed, search results in) and Grades (`g` then `?`), run on `7616be4` and on W0c: the four PNGs are
  identical (same MD5), with 0 page errors. Counts read from the page: 4 menu buttons and the menu open; 3 Download all
  buttons and the preview "6 items · 1 done"; 15 palette rows; 7 shortcut rows.
- **The course menu still opens at once.** Press to popover, headless, unthrottled, 3 loads: before, synchronous (2–6 ms
  of work); W0c, 8–14 ms when the file isn't in yet (a press with no hover first: a real pointer hovers, and that loads
  it), then 2–7 ms. That is under a frame at 60 Hz plus a little, well under what reads as a delay.
- **Runtime** (W0's command, Frost only, 3 runs, ×4 throttling, medians in ms; before and after run back to back):

  | Page | Start | Dark at (W0 / before / W0c) | FCP | Script | Light frames (W0c) |
  |---|---|---|---|---|---|
  | dashboard | first | 671 / 604 / 532 | 728 / 840 / 576 | 1,259 / 1,075 / 993 | 0 / 338 |
  | dashboard | next | 490 / 417 / 348 | 532 / 468 / 392 | 464 / 381 / 382 | 0 / 246 |
  | course home | first | 961 / 787 / 816 | 1,024 / 828 / 880 | 1,702 / 1,549 / 1,496 | 0 / 210 |
  | course home | next | 781 / 786 / 542 | 820 / 836 / 588 | 1,028 / 1,020 / 995 | 0 / 241 |

  Script time moves by −82 to +1 ms, inside the run-to-run spread (±150 ms on this shared machine), so no
  saving is claimed beyond the bytes. 0 light frames on every load.
- **Not moved** (≥ 3 KB, measured; each runs on every pass of the pages it serves, so moving it means a per-pass hook):
  draft backup 14,933 (its engine is already on demand), new grades 13,874, your place in a course 9,297, document
  buttons 7,243 (`docButton` is shared with the course menu), Ultra's what-if calculator 6,828 (Ultra gradebook only:
  the next candidate, about 6 KB).
- **Not run:** Ultra (no Ultra site here; its paths moved unchanged, with `ultra` read from `GZ_CTX.site`; of these five
  features, only the keyboard help on Ultra has a test of its own), Moodle (the local Moodle wasn't up; the palette's Moodle branch moved unchanged), Safari, Firefox.

## Runtime baseline (measured)

- Command: `canvas-shots.js --perf 3 --look Frost --look Synthwave 'dashboard=/' 'course=/courses/{bio}'`, plus the
  same with `--settings '{enabled:false}'`.
- Setup:
  - Playwright's Chrome for Testing (chromium-1243 build), headless, 1440×900, on an Apple M5 Pro, under `nice -n 15`;
  - CDP CPU throttling ×4 from just before the navigation;
  - 3 runs per cell, medians shown, ms from navigation start.
- Two starting points:
  - **first**: a new tab from a black `data:` page. Canvas's sessionStorage is empty, so Glaze waits for `storage.sync`.
  - **next**: from `/grades` in the same tab, the usual click-through. Glaze's sessionStorage mirror is there.
- What each column measures:
  - **Dark at**: the first animation frame where the body's (else the root's) fill is dark.
  - **Light frames**: screencast frames (480×300 JPEG) with more than 30% of pixels light, out of all frames from
    navigation to load + 1.5 s.
  - **Script / Task**: CDP `ScriptDuration` / `TaskDuration` deltas for the renderer's main thread. That's Canvas's work
    and Glaze's together, so compare a row against Glaze off.

| Look | Page | Start | Dark at | FCP | Script | Task | Light frames |
|---|---|---|---|---|---|---|---|
| Frost (solid) | dashboard | first | 671 | 728 | 1,259 | 3,048 | 0 / 390 |
| Frost | dashboard | next | 490 | 532 | 464 | 1,489 | 0 / 258 |
| Frost | course home | first | 961 | 1,024 | 1,702 | 4,098 | 0 / 202 |
| Frost | course home | next | 781 | 820 | 1,028 | 3,071 | 0 / 259 |
| Synthwave (three.js scene) | dashboard | first | 656 | 756 | 1,312 | 4,317 | 0 / 433 |
| Synthwave | dashboard | next | 430 | 532 | 603 | 3,052 | 0 / 328 |
| Synthwave | course home | first | 978 | 1,136 | 1,644 | 4,158 | 0 / 163 |
| Synthwave | course home | next | 752 | 816 | 1,199 | 4,836 | 0 / 151 |
| Glaze off | dashboard | first | — | 1,188 | 1,338 | 3,343 | 277 / 277 |
| Glaze off | dashboard | next | — | 568 | 521 | 1,596 | 300 / 300 |
| Glaze off | course home | first | — | 836 | 1,084 | 2,799 | 191 / 191 |
| Glaze off | course home | next | — | 644 | 505 | 1,896 | 179 / 179 |

Reading it:
- **No light flash:** "dark at" comes before FCP in all 24 Glaze-on loads, even the first page of a tab under ×4
  throttling. The Glaze-off rows show the check isn't vacuous: every frame there is light.
- **Glaze's main-thread cost:** about +500–600 ms of script at ×4 on course home (about 130–150 ms unthrottled, inferred
  by dividing by 4). That page runs the course-progress bar, module previews, new-content records and the first-pass
  sweep. On the dashboard the difference is inside the run-to-run noise (±150 ms).
- **The scene Looks:** `TaskDuration` goes up by about 1–1.8 s at ×4. That's three.js and WebGL (SwiftShader in headless),
  not script.
- **Later waves:** rerun the same command and compare against these medians. A wave that adds more than about 100 ms of
  script at ×4 to a page that doesn't use its feature has missed the on-demand rule.

## Further options (not done)

| Option | Saving | Cost and risk |
|---|---|---|
| Minify | — | Ruled out: zero build |

## The on-demand loader (implemented in W0b; Wave 1 uses it)

- **Content script:** `need(file, ready)` in content.js.
  - It sends `{ type: 'glaze:load', files: [file] }` once per file and document, and resolves when `ready()` (is what
    the file defines here?) holds after the worker answers.
  - A failed load can be asked for again a minute later, no sooner. The page's catalogue is the exception: one request
    per page.
  - The request carries `doc`, a random id for this document that content.js also keeps in Glaze's world there.
  - The options preview has the files as `<script>` tags, so there `ready()` is already true.
- **Worker** (`lib/background.js`):
  - Only files on `LOADABLE`, only from a tab of this extension.
  - It targets the asking document with `documentIds: [sender.documentId]` (Chrome), so a frame that navigated during
    the request gets nothing. Without a document id it falls back to `frameIds: [sender.frameId]`. First it asks that
    frame (`func`) whether Glaze's world there still holds the requesting `doc`, and injects nothing if not.
  - It replies `{ ok: true }` only when the injection reports the file's last value. A file that throws, stops short or
    errors is `{ ok: false, error }`.
  - It keeps no state about what is loaded.
- **Loaded files:**
  - Classic scripts in content.js's isolated world.
  - They guard themselves without a top-level `const` (`var GZ_ZIP = globalThis.GZ_ZIP || (…)()`), so a second
    injection keeps the first.
  - They end on a value: the module, or the catalogue object.
  - They reach content.js's helpers through `globalThis.GZ_CTX` (`need`, `t`, `locale`, `capi`, `local`,
    `canvasCourses`, `canvasCourseId`, `settings()`, `on()`; since W0c also `site`, `wordsIn`, `typing`, `make`, the
    course and due-list helpers, `courseList()` and `setCourses()`).
  - Their global (`var GZ_X`) must not be a name the first content script declares: it shares their global scope.
- **Hosts:** a frame Glaze runs in is already covered by `host_permissions`. The files aren't web-accessible.
- **Adding a feature file:** list it in `LOADABLE`, call `need('features/x.js', () => globalThis.GZ_X)`, and end the
  file on its module. `test/loader.test.js` checks that every `need('…')` path is loadable and outside the first script.
  `test/perf-budget.test.js` scans `features/` for timers and sweeps.

## Not verified

- Safari: nothing in W0 or W0b ran in Safari.
  - `documentIds` and injection results for files are Chrome-documented. Safari falls back to `frameIds`, and there the
    worker trusts the injection while content.js's `ready()` check decides.
  - The Safari app's copy of the extension (`safari/…/Resources`) wasn't touched; it needs the usual resync.
  - Firefox wasn't run either.
- Without `documentId` (Safari, older browsers), the frame is now asked whether it still holds the requesting document
  before anything is injected.
  - What remains: a navigation in the moment between that answer and the injection isn't caught.
  - If Safari returns no result for the check, the worker goes ahead, and content.js's own `ready()` check is what's left.
  - That's harmless for today's files, which only define globals. Re-check before a `features/*.js` that writes to the
    page relies on it.
  - Navigation and bfcache weren't exercised in a browser.
- Real hardware throttling: ×4 CDP throttling on an M5 Pro isn't a low-end Chromebook. The flash result has a margin
  of 40–160 ms between "dark at" and FCP, not more.
- Parse and compile time of the first script, before and after, wasn't isolated from Canvas's own script time.
