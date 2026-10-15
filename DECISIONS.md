# Decisions

What 2.0 chose, what it turned down, and why. Newest last.

## Scope (from the 2.0 survey, Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| One 2.0 release | Phased 1.1–1.4 | Owner's call. |
| Popup for quick controls, options page for the editor | Tabs inside the popup | 30+ controls don't fit a 320px popup. |
| Motion level Off / Subtle / Expressive, Subtle default | Subtle only; Expressive default | Expressive effects are opt-in; reduced-motion users get Off. |
| UX enhancements behind separate opt-in switches | Style only | They parse page text, so they can misfire; off by default limits the damage. |
| Zero build, zero deps, `node --test` | Playwright snapshots | Keeps CONTRIBUTING's promise. Visual checks stay manual on a live Ultra site. |
| Chrome first, stay Firefox-compatible | Ship both | No Firefox test pass yet. |

## Architecture

| Decision | Considered | Why |
|---|---|---|
| Every setting is a CSS custom property or an `html[data-gz-*]` attribute | JS toggling per-element styles | CSS never branches in JS; turning a feature off is one attribute. |
| `GZ_SANITIZE` handles stored data, 1.0 migration and imports | Separate migrate + validate | One trust-boundary function; idempotent, so it runs on every read. |
| Classic scripts with a `module.exports` guard | ES modules; node `vm` | MV3 content scripts can't import modules; the guard is one line per file. |
| Three stylesheets (`theme`, `motion`, `extras`), each its own `<link>` | One file; `@import` | Keeps theme.css readable; `@import` resolution under `use_dynamic_url` is untested. |
| Stylesheets added at document_start before the storage read | Manifest `css` | Manifest CSS can't be removed without a reload, and the popup toggles the theme live. A disabled user sees a frame of theme instead of an enabled user seeing a frame of Ultra. |
| Course colors: 12 fixed hue anchors mixed toward the accent with `color-mix(in oklch)` | Relative colour syntax (`oklch(from …)`) | Relative colour syntax needs Chrome 119 / Firefox 128; `color-mix` works on the current minimums. |
| No View Transitions | `startViewTransition` | Ultra routes client-side; an extension can't wrap its navigations. |
| Background image by `https:` URL only | Upload into `storage.local` | Requested scope. Add upload if wanted. |

## Build notes (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Course colors: harmonised = 70% Ultra hue + 30% muted ink | Mixing toward the accent | Mixing toward the accent made every course the same colour; ink keeps the hues apart. |
| Per-course colour keyed by Ultra's colour slot (1–10) | Course id from `/ultra/courses/_ID_/` | The slot class is on every course-scoped element (calendar, messages, grades, stream); ids are only on some links. Pure CSS via `--gz-pick-N`. |
| Ink-inherit rule wrapped in `:where()` | Raising each colour rule's specificity | At (1,2,3) it silently beat every later button, chip and badge colour, 1.0's included. |
| Backgrounds: a fixed `::before` on `<html>` and on each Ultra overlay root | Hiding the page under an overlay via `aria-hidden` | Ultra doesn't reliably mark the covered layer; each overlay painting the same viewport-fixed layer covers it either way. |
| Preview = iframe of a mock Ultra page running content.js | A separate preview renderer | Zero new styling code; the preview is exactly what the content script does. Edits are posted in unsaved so drags don't spend sync write quota. |
| `ui.js` + `ui.css` shared by popup and options | presets.js as a shared swatch renderer | Two pages share storage, palette painting, swatches and controls. |
| Completion burst triggered by `aria-checked` flipping to true on Ultra's review circle | Watching completion text | Ultra already exposes the state as a checkbox role. |
| Due-date chips in course content show status from the progress circle and the gradebook (`gradebook/grades?expand=column`, matched by `column.contentId`); urgency only on items not done | Countdowns everywhere; the circle alone | A past date reading "2 weeks ago" sent students to check work they'd handed in. Courses without progress tracking have no circle, so a submitted assignment showed as overdue. `hasBeenViewedByStudent` is about viewing the grade, so only the circle says opened. One request per course a minute. |
| No chip for a past due date whose status is unknown | "Was due 2 weeks ago" | The date is on the page already; a bare "ago" reads as a warning Glaze can't back up. |
| Bundled fonts: Inter (variable) + Atkinson Hyperlegible, Latin subset, 71 KB | Google Fonts at runtime | No third-party request from Blackboard pages. (2.1 adds web fonts, but only once the user picks one.) |
| Themed tooltips replace native `title` tooltips while hovered (title restored on leave; aria-label filled when the title was the only name) | Leaving native tooltips | Native tooltips can't be styled and appear late; Ultra's icon buttons rely on them. Stands down when Ultra shows its own tooltip. |
| Hover hints worked out at hover time (dates, grade share, ellipsised text) | Pre-tagging the page | No cost until someone points at something; no attributes left on Ultra's tree. |
| Light hover fills caught on first pointer contact | Parsing Ultra's 100+ JSS sheets for :hover rules | Hashed class names change per build; checking the live element is robust. |
| Aurora drifts by `transform` on an oversized layer | Animating gradient stops via `@property` | Compositor-only: no full-viewport repaint per frame on school laptops. |
| Panels only fade (Expressive: blur-to-sharp), never transform | Glaze's own slide | Ultra already slides panels with a transform transition; two transforms fought. |
| Folder previews use Ultra's internal content API (`/learn/api/v1/.../children`) | Public REST API | The internal one carries each item's state and due date; the public one has neither. Same origin, user's session, cached a minute; fails quietly. |
| Countdown chips and grade % drawn by CSS `::after` from attributes | Inserting elements | Nothing added to React/Angular-managed trees. |
| Declutter tabs matched by link path segment | Matching tab text | Works in every UI language. |
| Course progress counts "N of M completed" and top-level review circles | Recursing the content API | Uses what the outline already shows; no requests. |
| Entrance animations fill `backwards`, never `both` | `both` | A finished transform or filter animation that keeps filling makes the element a containing block for `position: fixed`. Every panel's background layer became panel-sized and scrollable sideways. |
| The sweep leaves dark text on a saturated fill, or in the accent-ink colour | Tagging all dark text | It turned Submit's dark label light on cyan. |
| The hover tagger marks light fills as hover fills only on clickable elements; elsewhere they are tagged light | Hover-only tagging | Ultra's JSS can restyle a new panel without a DOM change, so the sweep misses it. The tagger then tinted a whole page body as if it were a hover fill. |
| Attempt page: the details column sticks and a long description scrolls inside it | Clamping with expand-on-hover | Due date and points stay in view while long instructions scroll. A scroller is keyboard-reachable; hover-expand isn't. |
| Due dates labelled by a sibling element ("Assessment due date") get urgency and a countdown | Only text that says "due" itself | The attempt page is where the deadline matters most. |
| Rich-text images dimmed to 85% on dark palettes, full brightness on hover | Inverting them; leaving them | They're screenshots and diagrams: inverting breaks them, and full white glares. |
| Slide-outs (`.peek`) get their own opaque sheet; only full-screen panels paint the page background layer | Clipping each panel's layer with `clip-path` | The layer is viewport-sized, so on a slide-out it hid the page beside it. Clipping also cut off the close button, which sits half outside the panel. |
| Inside a slide-out, `--gz-ground` is transparent | Re-colouring each piece Ultra paints in the ground colour | One variable stops a dozen pieces patching over the sheet. |
| `#site-wrap` is `overflow: clip` | Leaving Ultra's `hidden` | An off-screen helper of Ultra's sticks out past the edge, so opening a slide-out scrolled the page 91px sideways. That happens without Glaze too. |
| Button press feedback uses the `scale` property, and the close button's hover changes colour only | `transform: scale()` / `rotate()` on hover and press | A `transform` on press or hover replaces whatever transform Ultra positions a button with. The close button swung away from the pointer. |
| Safari: a Mac app wrapper generated by `safari-web-extension-packager`, built and notarized by `scripts/build-safari.sh` | App Store distribution | Same route as Gemino. A Developer ID app installs from GitHub without App Store review. |
| The Safari build copies the Chrome zip into a temporary copy of the Xcode project | Building the checked-in project in place | One file list (`package.sh`) for both browsers; local Xcode edits stay untouched. |
| Safari manifest drops `options_ui.open_in_tab` and `use_dynamic_url` | Keeping one manifest | Safari rejects the first and ignores the second; Chrome keeps both. |
| Packager's app icon kept (the 128px icon on a white plate) | Rendering a full-size icon from `icons/icon.svg` | Matches Gemino. Worth redoing for both apps together. |
| Chrome Web Store uploads via API v2 and a service account impersonated with `gcloud` | OAuth client + refresh token; a JSON key | Short-lived tokens only; nothing secret on disk or in the repo. The dashboard can't be scripted by any extension. |
| Mac downloads: a notarized DMG with an Applications link, alongside the zip | Zip only (Gemino's) | Drag-to-install is what Mac users expect from a download. |
| Mac App Store: same Xcode project, automatic App Store signing via an Admin API key, upload with `xcodebuild -exportArchive` | Transporter; a separate App Store project | One project for both channels; Xcode makes the certificates and profiles. |
| App Store manifest description shortened to 86 characters, Safari copy only | Shortening the Chrome manifest too | The App Store caps it at 112; Chrome's 120-character summary stays as published. |
| App Store listing reuses the Chrome screenshots of themed Blackboard pages, not the 1.0 popup shot | New screenshots | They show no browser frame or Chrome branding; the popup shot no longer matches 2.0. |
| Mac download: the app is its own installer. Opened from the disk image, one button copies it into Applications and reopens it on an illustrated setup guide that watches Safari's on/off state | A `.pkg` installer; DMG drag only | One click instead of Installer's Continue / Install / password. The guide is drawn in HTML, not screenshots, so it doesn't go stale with Safari's UI. |
| The Developer ID app runs unsandboxed; the extension and the App Store build stay sandboxed | Sandbox temporary-exception entitlements for `/Applications` | macOS won't run an app that a sandboxed app wrote ("File created by an AppSandbox"). The setup app only loads its own bundled page. |

## After 2.0.2 (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Score bars, countdowns, folder previews and course progress on by default | All extras opt-in | Owner's call. Defaults only reach people who never touched an Extra; anyone who did keeps their stored switches. |
| Background colors: three hex, or none stored to follow the palette | A separate "custom" switch | Empty means "the palette's", so they keep following palette changes until someone picks colors. One key, one sanitize rule. |
| Animated backgrounds use three.js, vendored as one tree-shaken module (`lib/three.min.js`, ~520 KB) | Raw WebGL; a CDN | Owner asked for three.js. Vendored because extensions can't load remote code; tree-shaken because the scenes use a dozen of its classes. `scripts/vendor-three.sh` derives the export list from `lib/scene.js`'s import. |
| three.js loads by `import()` from the content script only once a scene is picked, top frame only | Listing it in the manifest's content scripts | Nobody else pays for it, and Ultra's iframes don't each get a WebGL context. Any failure (no WebGL, import blocked) leaves the gradient under it showing. |
| One canvas, moved into the topmost full-screen layer | A canvas per layer; one canvas behind everything | A canvas per layer means a WebGL context per open panel. Behind everything, the opaque panel layers hide it. Moving it is what the per-layer `::before` already does in CSS. |
| Drawn at 20–50% of CSS resolution, 30 fps cap, motion in the vertex/fragment shaders from one time uniform | Full resolution; animating on the CPU | Soft scenes look the same stretched, and a frame is one uniform write and one draw. Motion Off renders a single frame. |
| Scene dim mixes the colors toward the ground before drawing | A CSS tint over the canvas | Same result as the gradient's tint under normal alpha blending, with no extra layer to composite each frame. |
| Scene modules (and the fonts) are web-accessible without `use_dynamic_url` | Keeping every file on the dynamic URL | Chrome 155 hands content scripts the dynamic URL, and the content script's CSP only trusts the static origin, so the `import()` was blocked. Chromium 153 hands out the static URL, which a dynamic-only file refuses; that broke the bundled fonts on Ultra pages. Listing the fonts in both entries covers both. The cost: a site can tell Glaze is installed by probing those paths. |
| Intensity is the one knob for scenes; dim and blur stay for the other kinds | Separate dim, contrast and speed sliders per scene | Asked for "how much it is noticed". One slider maps to dim, a per-scene contrast uniform and pace (`GZ_SCENE_LOOK`). |
| Gradients are built in JS (`GZ_GRADIENT`) as one CSS image, fill the screen and mix in OKLab when supported | Three corner glows over the ground; nested `calc()` in CSS | The glows read as patches, not a gradient. Stop positions for blend and spread are plain arithmetic, and testable. `in oklab` is chosen by `CSS.supports`, because an invalid value in a custom property can't fall back. |
| Palette background colors: accent, bright accent, muted text | Accent, bright accent, success | Success green made Ember and Rose gradients sweep into green once the gradient filled the screen. Muted text is a neutral from the same palette. |
| Store art rendered by `scripts/store-screenshots.js`, promo tiles from `store/promo.html` | Hand-drawn SVG tiles | The tiles show the real Borealis scene, and one command redraws all store art. |
| Documents: a centered column that zooms with the content area (`zoom: clamp(1, 100cqi / 92.5rem, 1.5)`), the paper as one frosted card | A fixed max-width; scaling font-size | Wide screens left a small card in a sea of background. Ultra's rich text sets pixel font sizes, so only `zoom` scales all of it (and file previews) together. The title row zooms by the same factor, so it stays lined up. Typed `calc()` division is Chrome 140+; elsewhere the zoom is invalid and falls back to 1. |
| The file viewer's toolbar stays Blackboard's | Restyling it | It is inside a cross-origin frame; reaching it needs host permissions beyond `/ultra/`. Glaze frames it instead. |
| Grain is an SVG noise tile in the `::before` stack, under the tint | Dithering in JS; a separate overlay | Static, painted once; dimming quiets it with everything else. Blur hides it, which is fine: blur is for smooth. |
| Safari installer updates an existing Glaze in place, found at `Glaze.app` in `/Applications` or `~/Applications` by bundle ID | Always install to `/Applications`; search LaunchServices for every copy | Installing beside an old copy left two extensions with one ID in Safari. Fixed paths cover how the installer puts it there; a renamed copy is the user's own. |
| Never replace an equal, newer or App Store Glaze; offer Open Glaze instead | Reinstall/downgrade buttons | Downgrades are accidents; an App Store copy is root-owned, so replacing it fails into a duplicate. |
| The update is told to the new copy with a `-updated-from <version>` launch argument, read through `UserDefaults` | A flag file; comparing versions on every launch | Launch arguments land in the volatile argument domain, so nothing is stored and the message shows once. |
| After installing, the disk-image copy runs `lsregister -u` on itself and `diskutil eject` from a shell that outlives it | Eject only; leaving it | A running copy registers its extension, so Safari listed two Glazes with one ID. Ejecting fails while Safari holds the image's extension open; unregistering doesn't. |
| Hold each page's container (`.route-view-container`, not the course shell) hidden while Ultra builds it, release after 300 ms still with no loader and grades in (2.5 s cap), reveal from blur | Animating each part as it arrives; a fixed delay | Measured: Ultra's own script stalls up to ~0.5 s and parts land in bursts (CS2010 opened with CLS 0.11, half from Glaze's progress bar). Hiding until built took CLS to ~0. Held in the observer callback so nothing paints first; 300 ms because Grades pauses ~250 ms between courses. |
| Menu and tab clicks: a view transition from the old page until the new one is held, then a crossfade | Holding until fully loaded inside the transition | Rendering is frozen during a transition's update, so a long hold feels hung; the gate shows the wait instead. |
| Download all leaves out items you haven't opened (`state` other than Started or Completed), and says how many | Downloading everything behind a warning that it counts as opening | Measured on a live Ultra: listing children (38 unopened documents) changed no state, and fetching an opened document's file neither completed it nor touched its block's state. Whether a file fetch marks an *unopened* item viewed can't be tested without doing it, and the `/bbcswebdav/pid-…` address is the one Blackboard logs content access through. Leaving them out means Glaze never changes what an instructor sees; opening the item first is one click. `state` is kept even in courses without progress tracking. |
| Download all: files fetched from the content script, zipped by `lib/zip.js` (store method), saved through a blob link | Background fetch with host permissions; CompressionStream deflate; the `downloads` permission | `/bbcswebdav/` redirects to Blackboard's file CDN, which answers with CORS, so no new permission. Course files are PDFs, slides and pictures, already compressed. `<a download>` needs no permission. Held in memory, so capped at 250 MB. |
| Grade pills one width (10rem min) on one line; the gradebook's Grade column widened from Item Name | Narrower type; hiding the rubric icon or percentage | Ultra's 102 px box clipped "100 / 100" and wrapped "Not graded"; what's in the pill stays, the pill fits it. |

## 2.1 (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Web fonts fetched by the content script and handed to `document.fonts` as `FontFace` data, registered as "Glaze <name>" | `@font-face` with a URL; a `<link>` to Google's CSS | A URL font is subject to the page's `font-src` CSP; data isn't. No cookies or referrer go with the fetch. The prefix keeps it from colliding with a face the page defines. |
| Google Fonts for most faces; jsDelivr (pinned versions) for OpenDyslexic (Fontsource) and Nerd Fonts (the GitHub release) | Bundling them; the Nerd Fonts symbols font as a fallback | Bundling 40 families is megabytes for a choice most people never make. Google's CSS API takes any family by name. Nerd Font icons never appear in Blackboard text, so the patched families are offered as-is. |
| Latin and Latin Extended subsets only | Every subset Google lists | Data fonts can't load subsets lazily the way `unicode-range` URL fonts do. |
| One font list for three slots (text, headings, code) | Three selects | Native `<option>`s can't be drawn in their own face. Previews use Google's `text=` subsets of just the names, loaded when the list is opened. |
| A typed name is tried on Google Fonts, then as a local font | A separate "local font" field | The stack lists both, so one field covers Google families and installed ones (a Nerd Font you already have). |
| Theme code = `glaze1:` + base64url(deflate-raw(JSON)): palette as 84 hex digits, look (minus tooltips and hints), background | A short link to a server; only non-default values | No server to run or trust. Full values (~360 characters) keep a code's meaning fixed if a default changes later. |
| A code is refused whole when any value doesn't come through `GZ_SANITIZE` unchanged, and capped at 4,000 characters in and 8 KB inflated | Sanitizing it like an import (bad values become defaults) | Someone else wrote it: a silently patched theme isn't the one that was shared. The cap stops a small code inflating into a big one. |
| "Submitted late" from the latest attempt's `attemptDate` against the column's `dueDate`, only for items waiting to be graded | Every submitted or graded item; the first attempt | Once graded, the grade is what matters; one request per waiting attempt keeps within the per-course budget, and an attempt's date never changes, so each is asked once. The latest attempt is the one Blackboard flags. |
| No "late" at all where the membership's `dueDateExceptionType` isn't `Normal`, or the course's exceptions list mentions the item | Ignoring exceptions | A student with an accommodation being told "late" is the anxious misfire the status chips were redesigned to avoid. When the exceptions can't be read, nothing is called late. |
| New grades: what's been seen is per course, column id → score, in `storage.local`; a course seen for the first time counts Ultra's `hasBeenViewedByStudent: false` grades as new | Ultra's flag alone; everything new on first run | The flag only clears when the student opens the attempt, so it would nag; a fresh install marking every grade "New" would be noise. Local, not sync: it's per-device bookkeeping, not a setting. |
| Showing a course's gradebook marks its grades seen; course cards only count | Clearing on any page that mentions the course | The badge clears when the grade has actually been in front of you. Badges stay for the rest of that visit. |
| The calculator reads the overall column's `calculatedFormula` (`BBCalColElem(wgt:…)`, category weights, proportional or equal, running total) and is used only when it reproduces Blackboard's overall score to 0.01 | A points total for every course; guessing the formula grammar | Ultra doesn't publish the grammar. Reading only what's been seen and checking the result against Blackboard's own number means a wrong guess shows as "can't work it out", never as a wrong grade. Drop rules, weighted single items and points totals are refused until a real one has been seen. |
| "What it takes": the even share of the remaining points that lands on the target, by bisection | Solving per category | One number a student can act on; bisection works for any recipe the model can compute. |
| Command palette on its own switch, on by default | Behind the keyboard-shortcuts Extra (off by default) | It's invisible until Ctrl+K. Ctrl+K is left alone in inputs and editors, where Ultra's editor uses it for links. |
| Palette jumps to items through the public API's `links[0]` (`/ultra/redirect?…`) from `contents?recursive=true` | Building Ultra routes per content type; only items in the open outline | Ultra resolves its own deep link for every type, and the recursive listing reaches items inside closed folders. |
| Blackboard's pages are a fixed list of `/ultra/…` routes | Reading `#base_tools` | In a narrow window the main menu lives in a drawer that isn't in the DOM until opened. |
## 2.1: back up what you type (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| A post counts as sent once the start of what was written (500 characters, whitespace ignored) shows on the page outside an editable editor, checked for a minute after the editor empties or goes, and again before offering a copy | Watching Ultra's requests; the editor emptying or closing | A content script can't see Ultra's XHRs. An editor also empties or closes on Cancel and when you leave the page, so neither means posted. A sent post renders its text (discussions and journals in a read-only Quill), and a failed one doesn't. |
| Restore by `execCommand('insertHTML')` into the focused editor | Quill's API; a synthetic paste; setting `innerHTML` | Ultra's editor is Quill 1 (`.ql-editor`), whose instance is out of reach of a content script's isolated world. Its paste handler relies on the browser's native paste into a hidden box, which a synthetic event doesn't do. Tested on a Quill built from Ultra's own constructor: insertHTML keeps bold, italic, lists and links, Quill reports a `user` change and one undo takes it back; it also fires `input`, which setting `innerHTML` doesn't. |
| Keyed by the page's path, the nearest Blackboard id (`_123_1`) above the editor, and the editor's id | An editor's index on the page; Ultra's random `BB_Editor_ID_*` | Discussion reply boxes open one at a time, so an index would hand one post's reply to another. The random id changes every load. |
| Nothing under 20 characters is kept; a copy on offer is only replaced once something worth keeping is typed | Keeping everything | Short text costs nothing to retype and could match the page by chance. An accidental keystroke shouldn't throw away the copy being offered. |
| Each copy is its own `draft:` key in `storage.local`, written a second after typing stops (and on `pagehide`) | One object holding every draft | Tabs and frames write at once; one key each can't overwrite another tab's copy. |
| Card grades come from each course's own gradebook request (the due-date one, now cached per course), and only the column marked `externalGrade` | Ultra's Grades page data; a per-course `gradebook/columns` call | The Grades page makes the same per-course calls plus columns, schedule and attempts, so it's no cheaper. The existing request already carries the overall column; sharing it means opening a course right after costs nothing. A course whose instructor hides the overall grade returns no such column (CS2010 here), so it shows nothing. Columns flagged `visible: false` or `visibleInBook: false` are skipped as well. |
| Card grade = effectiveScore / pointsPossible, cut to two places (or the gradebook's letter text if it gives one) | `displayGrade.score`; rounding | `displayGrade.score` is a percentage only under a percent schema; the ratio is schema-free and matched Ultra's "82.45%" (77.30273 / 93.75). Ultra cuts rather than rounds, and the band follows the shown number, so 89.996 never reads "90%" in the mid color. |
| Card grades fetched only once a card is on screen (IntersectionObserver), and the page-load gate waits for any pending course | Fetching for every card; tagging in the mutation pass only | Scrolling isn't a mutation, so the throttled pass alone would miss cards scrolled into view. A hidden tab fetches nothing. Waiting for grades keeps the chips from popping in after the reveal (still capped at 2.5 s). |
| Drawn as `::after` on the card's status line from `data-gz-grade` and `data-gz-chip` | An element inside Ultra's card | Same as the due-date chips: nothing added to Angular's tree, cleared with the other tags, and the switch is a CSS gate. Grid and list views share one card template, so one selector covers both. |
## 2.1: document buttons (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Dark documents invert the preview's frame (`filter: invert(0.9) hue-rotate(180deg)`) | Styling inside the frame | The PDF and Office viewer behind an attachment preview is another origin, out of reach; a filter on the frame works whatever its origin. The viewer's own toolbar inverts too. 0.9 keeps white paper off pure black. Images and videos are turned back only in same-origin frames. |
| Dark documents only on dark palettes; the moon button hides on light ones | Showing it everywhere | A dark page inside a light palette is the glare in reverse. The choice is kept, so it comes back when the palette (or auto mode) turns dark. |
| The dark-documents choice is a synced setting (`enhance.darkDocs`) written by the button, also in the editor | `storage.local`; button only | One place for it, and it stays switchable when the buttons are hidden. |
| Focus mode is not remembered and leaves when the document does | Remembering it | It's for one reading; coming back to a document with its header gone would look broken. |
| Buttons float bottom right; under 58rem of document width the document pads its right side for them | A toolbar in Ultra's title bar; always padding both sides | The title bar's contents vary per item and focus mode hides it. Padding one side keeps the most width in a narrow window, where exact centering matters least. |
| Reading time from the document's own text at 230 words a minute, none under half a minute | Counting attachments; always showing it | Attachments can't be read from here; "1 min" on a file-only page is noise. |
| Esc leaves focus mode at the window in capture, before Ultra's handlers | Letting it through | One key, one effect. Focus inside a preview frame keeps Esc there; the button still works. |
| No keyboard shortcut for focus mode | A letter key or Ctrl/Cmd+K | Ctrl/Cmd+K belongs to the command palette; Esc and the button cover it. |
## New content (2.1)

| Decision | Considered | Why |
|---|---|---|
| Seen = a set of content ids per course (`seenContent` in `storage.local`); the first visit records everything | Comparing `created` dates to a last-visit time | Courses are copied each term, so `created` is the copy's date (2024 for a Fall 2026 course here), and an item made visible keeps its old date. An id that wasn't there before is exactly "added or made visible". |
| An item is seen once its row has been on the page; the badge stays for that visit | Seen as soon as the course is opened; seen once scrolled on screen | Opening a course shouldn't clear what's inside folders you never unfolded, which is what the folder count is for. On screen would need an observer per row for little gain. A long outline's last rows count as seen unscrolled. |
| A folder's count only while it's closed, and a quiet outline pill rather than the accent fill | A count always; a dot | Open, its new items carry their own "New". The count says how many without opening anything. |
| An Ultra document's blocks (children of an `isBbPage` folder) are left out | Counting them into the document | Every document is a page folder with its body as a hidden child; counted, a new document would never be seen. |
| Card counts only for courses opened before, fetched only while the card is on screen, sharing the palette's request (five minutes) | Leaving cards out | `fields=` cuts the request to ~25–40 KB a course (130–160 KB unfiltered); four open courses here make that ~120 KB per five minutes on the Courses page at most. A course never opened has nothing to compare with. |
| Clicking a count lands on the newest new item (highest id), unfolding each folder above it once | The first in outline order; opening the item | Folders are only unfolded, never opened, so no progress is recorded. Once each, so a slow folder isn't clicked shut again; given up after ten seconds. |

## Course tint (2.1)

| Decision | Considered | Why |
|---|---|---|
| Off, with no courses picked, until set up under Courses; picked by color slot like per-course colors | On for every course | Owner's call: nothing changes until it is configured. Slots are what the Course colors list already shows. |
| The accent takes the course's hue; strength moves its lightness and colorfulness from the palette's to the course color's (100% is the course color) | Mixing the two colors in sRGB, OKLab or OKLCH | Halfway, a pink accent and a green course mix to gray (OKLab) or orange (OKLCH). Taking the hue reads as that course at any strength. |
| The course color is read off a hidden probe on `<html>` carrying the slot's class | Recomputing it in JS | It is exactly what the Course colors section paints (a pick, toned or raw), without a second copy of the slot table and the OKLCH toning. Outside the observed body, so it costs no sweep. |
| The slot is remembered per course id (`courseSlots` in `storage.local`), read from the course section's `bb-course-membership-markups` | The address alone; the course API | Item pages (documents) replace the course section and carry no slot, and the API has no color. The address changes ~250 ms before the next course's section replaces the last one, so the section names its own course. |
| Painted on `<html>` and re-checked on each sweep pass | Scoping the tokens to the course section | Item pages replace the section entirely, and anything Ultra mounts on `<body>` sits outside it; `<html>` reaches all of it and the background layer. |
| Contrast: a surface tint that costs a text pair is dropped; the accent moves toward the text until it reads on the surface and its text reads on it | Adjusting the text colors | Text stays the palette's. Paper's faint text has 3.07:1 on its ground, so Paper and Rose keep their own surfaces for most courses. |
| Backgrounds pick up the tint only when they follow the palette | Tinting picked background colors too | Picked colors are an explicit choice. The ground's slight lean reaches every kind through the dim layer. |

## Editor help (2.1)

| Decision | Considered | Why |
|---|---|---|
| A fresh install shows no what's-new card and no welcome | A short welcome | The editor already is the welcome, and the owner turns down nagging UI. |
| Fresh install = nothing seen and no settings ever saved (no `version` key in sync storage); either surface marks it seen | `runtime.onInstalled` in a background script | There is no background script, and Firefox MV3 wants `background.scripts` where Chrome wants a service worker: one cross-browser background page for one flag. Cost: an existing user who never saved a setting misses 2.1's card. |
| Notes are hand-written in `lib/news.js`, keyed by version; every unseen version up to the running one shows, newest first | Parsing CHANGELOG.md; only the running version's notes | The changelog is too long for a card. Skipping a version (2.0.4 to 2.2) still shows 2.1's lines; a patch without notes shows nothing. |
| Marked seen when shown, not when dismissed | On dismiss | "Once" means once; a card that comes back each visit until clicked is nagging. |
| Notes ahead of manifest.json stay hidden, and `node --test` lists a todo until the manifest catches up | Keying on the manifest version as it is today | The branch says 2.0.4 while the notes say 2.1; the todo is the release-step reminder. |
| Search items found from the DOM: each child of a section or `.group`, matched on its text, title, aria-label and placeholder, plus the section and group headings and the notes it names by `aria-describedby` / `aria-labelledby` | A list of settings and keywords | New Extras rows are found with no edit here. Notes linked by ARIA move with their control, so the two places that needed it got proper ARIA. |
| Synonyms can be heading-only (`h:palette`) | Plain synonyms | Plain, "dark" matched every "palette" in the text (Command palette, theme codes). |
| Highlights with the CSS Custom Highlight API; no highlight where it's missing (Firefox before 140) | Wrapping matches in `<mark>` | Wrapping rewrites text nodes the editor redraws and labels it reads; ranges leave the DOM alone. |
| Controls hidden by the current choice (a background kind, tint off) don't match | Showing them anyway | They can't be used until that choice changes; switching it re-runs the search. |
| While searching in one column (under 980px), the preview hides | Leaving it above the results | It's 460px tall, so results started below the fold. |

## Due dates in other locales (2.1)

| Decision | Considered | Why |
|---|---|---|
| In course content and on an assignment's page, the due date is the gradebook's `column.dueDate`, matched by item id; text is read only where there's no record | Parsing the text everywhere; the content API's `genericReadOnlyData.dueDate` | The gradebook is already fetched for the chips, so it costs nothing. The content API carries the date too, but only per folder (`/children`), which would be a request per open folder; the public `contents?recursive=true` the palette uses has no due dates. Items past the gradebook's 200 still read their text. |
| A discussion with two due dates ("Due dates: 9/17 and 9/20") counts down to the last one | Keeping the first, as the text gave it | The gradebook keeps only the last, and "Submitted late" already compared against it; chip and lateness now agree. |
| Due dates found by where Ultra writes them: an item's grade line (`[class*="makeStylesgradeDetail-"]`) and `.due-date-container`; the word "due" only when the locale is English | Ultra's translated labels from its locale bundles | Structure holds in every language. A word list would need every language pack, and "puede" contains "due". |
| Ultra's locale from `<html lang>`, then `navigator.language` | `/users/me`; the `cldrdata-*` bundle Ultra loaded | Ultra binds `lang` to the locale it renders in (`{{index.locale}}`, the user's or else the system default). `/users/me` had no locale field here (none picked), and costs a request. Untested on a course that enforces its own locale. |
| Only day/month/year order (and month names, digits, AM/PM words) from `Intl`; separators, year width and 12/24-hour read loosely | Matching `Intl`'s exact pattern | Ultra formats with its own CLDR data, which differs from the browser's: pt-BR and nl write 2-digit years where Intl writes 4, zh writes `yy/M/d`, ko uses a 24-hour clock where Intl uses 12. Order matched in every bundle checked. |
| en-US keeps its old patterns byte for byte (no month names, no dotted dates) | One reader for all | Owner's call: US users see no change. A 600,000-case differential check against 2.1 found none. |
| Gregorian dates only | Following `Intl`'s default calendar | `Intl` writes fa and th in Persian and Buddhist calendars. Assumed, not checked on such a site: Ultra writes Gregorian dates there too. |
## iPhone and iPad (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| iOS app and extension use the Mac bundle ids (`io.frostdev.Glaze`, `io.frostdev.Glaze.Extension`) | `io.frostdev.Glaze.iOS` | Universal purchase needs the same bundle id on both platforms; the iOS platform is then added to the existing App Store record. |
| Separate `Glaze iOS` and `Glaze iOS Extension` targets in the same project, sharing the extension's resource and handler file references | Making the Mac targets multiplatform; a second project | The Mac app is AppKit with an installer; the iOS app is a SwiftUI shell. Shared file references keep one copy of the extension, and the Mac targets, schemes and scripts are untouched. |
| Minimum iOS 18.0 | iOS 17.2, where the styling already works | iOS is tied to its Safari version. 18 brings unprefixed `backdrop-filter` (the glass) and view transitions; every device that runs 17 runs 18, so it costs no one. |
| The iOS guide is the Mac guide's `Main.html` look: `Style.css` and `Script.js` shared, an iOS `Main.html` and `iOS.css` on top | A native SwiftUI screen | One look across both apps, and the guide's drawn mocks don't go stale with Safari's UI. `Script.js` only needed its installer button made optional. |
| On iOS 26.2+, "Open Settings" (`SFSafariSettings.openExtensionsSettings`) and a live on/off tick (`SFSafariExtensionManager`); before 26.2 the steps alone | Requiring 26.2; private `App-prefs:` links | Both APIs are new in 26.2 and private URLs fail review. The written path is always shown: in the Simulator the button sometimes opened Settings at its top level instead. |
| iOS app icon rendered full-bleed from `icons/icon.svg`, no alpha | Reusing the Mac icon (the 128px icon on a white plate) | iOS masks the corners itself and the App Store rejects icons with alpha. |
| Touch fixes are CSS media queries (`hover: none`, `pointer: coarse`) plus one `pointerType` check | Detecting iOS in JS | Matches what the device can do, not what it is, so an iPad with a trackpad or a touchscreen laptop gets the right behavior. The rules sit in their own blocks. |
| On touch screens, Shorter descriptions is off rather than tap-to-expand | Expanding on tap | A tap on a course item opens it; there's no gesture left to expand with. |
| `scripts/appstore-ios.sh` exports an `.ipa` and keeps the archive; uploading is opt-in (`APPSTORE_UPLOAD=1`) | Uploading by default, like `appstore-safari.sh` | The iOS record doesn't exist yet, and the Mac record is in review. |

## Glaze's own text in other languages (2.1)

| Decision | Considered | Why |
|---|---|---|
| Catalogues are plain classic scripts, `i18n/<lang>.js`, loaded with the content script and by the editor and popup; looked up by `lib/i18n.js` | `_locales/*/messages.json` through `chrome.i18n`; the same JSON fetched by our own lookup | `chrome.i18n` speaks only the browser's language, and Blackboard's can differ. Fetching JSON from a content script needs it in `web_accessible_resources` (any site could then probe for Glaze) and is async, while Ultra's language is only known once Ultra boots (`<html lang>`): chips would render English first and need a second pass. A script is synchronous and works the same in Chrome, Firefox and Safari with no background script. messages.json also forbids the English-as-key and plural-object format below. |
| The English text is the key; plurals are `{ one, other, … }` picked by `Intl.PluralRules`; `{name}` placeholders, numbers through `Intl.NumberFormat` | Named keys (`chip.unopened`) with an `en` catalogue; ICU MessageFormat | A reviewer sees the English beside the translation, and code reads as it renders. Changing an English string drops its translations until updated, which `node --test` reports (a key no source uses, a string no catalogue has). ICU would need a parser. |
| Words on Blackboard follow Ultra's language (`<html lang>`); the editor and popup the browser's (`chrome.i18n.getUILanguage()`) | One language for both | A student with a Spanish Ultra and an English browser reads Spanish chips beside Spanish Ultra, and an editor in the language of the rest of their browser. |
| A region gets its language (es-MX → es, pt-PT → pt-BR); a language Glaze lacks is English throughout, numbers and dates too | English words with the page's own number and date formats | A sentence that mixes an English template with an Arabic relative date reads worse than English. en-GB keeps its own date format. |
| The editor's static text is translated in place by matching each text node, `title`, `placeholder` and `aria-label` against the keys; `translate="no"` opts out | A `data-i18n` attribute on every element | No edit to options.html's ~150 strings, and text beside an input inside one label (`<label>Light <select>`) works. Settings search reads the DOM, so it finds the translated names with no change; accents are optional in a search. |
| Adding a language: one catalogue file, plus its line in manifest.json, options.html and popup.html (a test fails until all three load it), and optionally `_locales/<lang>/messages.json` for the store description | Discovering catalogues at runtime | Pages and content scripts can only load scripts listed up front, synchronously. |
| Every language loads in every Ultra frame (140 KB for five; under 1 ms to evaluate in node) | Only the page's language, through `import()` | Synchronous, and Ultra's language is known late. ponytail: split out the editor-only strings, or import() the one language needed, if more languages make this heavy. |
| Not translated: palette and background-set names (Frost, Lagoon), font names, Glaze, Blackboard, Ultra and the shortcut letters (g then c, …) | Translating everything | Palette names are stored values and share a namespace with the user's own; the others are names. |
| Manifest `description` localized through `_locales`; `name` stays "Glaze for Blackboard Ultra" in every language | Localizing the name ("Glaze para Blackboard Ultra") | The owner keeps the name Glaze everywhere; a translated tail would make the store name differ by locale. |
| es, fr, de, pt-BR and nl are machine translations, accepted by the owner; wording is fixed as bug reports come in | Shipping English only until a native review | Asked for in 2.1; noted at the top of each file. Chips and pills were worded short on purpose (German "{n} Min.", "Überfällig"). |
| Not in this pass: reading Ultra's English text (folder icons' `aria-label="Folder"`, "N of M completed") | | That is Ultra's text, not Glaze's: on a non-English Ultra, folder previews, Download all and course progress likely don't find their folders. Not checked on such a site. |

## Ultra's words (2.1)

| Decision | Considered | Why |
|---|---|---|
| Folders and learning modules by their fold toggle's id, `folder-title-<id>` / `learning-module-title-<id>`, for folder previews and Download all | The icon's `aria-label` ("Folder"), as before; `contentHandler` from the shared `contents?recursive=true` | Ultra builds those ids in code (`folder-title-${i.id}`), so no language changes them, and they're on the row before any request answers. An Ultra document (a folder to the API) has no toggle, so it stays out as before. |
| Course progress reads the two numbers in the line, the larger as the total, and counts some done only where Ultra draws its check (all done) or a completed part in its chart | Ultra's line in each language from its locale bundles; the per-folder `stateCompletion` from `contents/ROOT/children` | Every one of Ultra's 33 templates has the two numbers, in either order (Japanese writes the total first). Ultra shows "N of M started" only while nothing is completed (its `a$` chooser), so the words carry nothing the structure doesn't. `stateCompletion` would be a new request per course. Arabic-Indic digits are read; a grouped "1,234" isn't (no folder holds that many). |
| Item-type icon tints match Ultra's own names for them in its 32 other locale bundles (rel.37), written into theme.css beside the English rules | Tagging icons from the content API; matching icon path data | The type is only in the label: the content API's handler can't tell an assignment from a test. Path data would be unreadable magic. ~6 KB of selectors; a renamed label just goes back to the accent color. The English rules are untouched, so "Form" (Ultra's current name for a survey) is still untinted in English. ponytail: regenerate from the bundles if Ultra renames a type. |
| The `/` shortcut finds `input[type=search]` and inputs or buttons whose id has "search" | Placeholder and aria-label containing "earch" | Ultra's ids (`courses-overview-filter-search`, `search-button`) don't change with language. The Courses page's search box had neither a placeholder nor a search type, so `/` found nothing there before, in English too. |
| A course card's id line is skipped by Ultra's label for it in every language ("ID:", "Code :", "Kimlik:"…) | Structure | Not seen on this site's pages, so no structure to go by; the word list comes from the bundles' `base.courses.idLabel`. |

## Looks (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| A look sets every look and background value; what it doesn't name goes back to the default | Changing only what the look names | Picking Terminal after Clear would otherwise keep Clear's larger text and roomy spacing: the result would be neither. |
| Tooltips, hints and the background image's address survive a look | Resetting them too | They're how Glaze behaves and what the user typed, not how a theme looks (the same line theme codes draw). |
| Applied at once, in the popup and the editor | Previewing first, like a pasted theme code | Every look is one click back to any other, and the palette swatches undo the colors; a confirm step would make the popup's quick controls slow. |
| A look with its own palette (Synthwave) leaves no preset name, like an unsaved palette | Adding Synthwave to the palette presets | The palette list stays the six palettes; save it as a preset to keep it on its own. |
| Look names aren't translated | Translating them | Same as palette names: they're names. |

## Looks gallery, favorites and history (G1, Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| The gallery is static pages on frostdev.io built from a public repository; submissions are GitHub issues or pull requests | A Glaze server with accounts, likes and comments (another extension's `/themes*`) | No server to run, nothing to sign in to, nothing to count. Review happens in the open. |
| "Use this Look in Glaze": a content script that runs only on `https://frostdev.io/glaze/looks` and the pages under it (`lib/gallery.js`; the background checks the same exact paths), hands the code to the background on a trusted click, and the editor previews it | `externally_connectable`; copy and paste only | `https://*/*` host access already covers the page, so no new permission or warning, and it works the same in Chrome, Safari and Firefox (`externally_connectable` needs the extension id on the page and isn't in Firefox). The page can't trigger it with a scripted click and learns nothing back. Copy and paste still works for older Glaze. |
| The code waits in `storage.local` (`galleryOffer`) and the editor takes it, previews it and removes it | Passing it in the editor's URL | Survives the editor not being open yet; nothing personal in a URL. Nothing applies without Use this theme. |
| History is recorded by the background from `storage.onChanged` (sync), once a burst of changes has rested 4 seconds, with the theme from before the burst; Clear history goes through the same writer | Hooks in each place that applies a theme; clearing storage from the editor | One place sees every route: the popup, the editor, Ctrl+K on a course page, another device. Recording the theme left as well means Previous Look works from the first change. A dragged color counts once. Clearing there cancels a recording still waiting, which would otherwise write the cleared themes back. |
| History keeps 20 themes, favorites 100 codes, both in `storage.local` | Sync storage | Device bookkeeping, like seen grades; sync's 8 KB items and write quota are for settings. |
| A theme for history is colors, preset, auto, look and background; tooltips and hints stay the student's | Every setting | The same line theme codes and Looks draw. Auto light/dark comes back with the theme it belonged to. |
| Gallery palettes are codes with colors only (`{c}`), which the 2.1+ decoder already accepts | A palette flag in the code | Applying one keeps the student's fonts and background; no format change. |


## Moodle (W20, Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Recognized by core's keywords meta in the head ("moodle, …") and the page id and layout core puts on `<body>`, both required; the host is then registered like a Canvas host, in its own list (`moodle`) | A hostname containing "moodle" or a `/course/view.php` address (another extension) | Moodle runs on any domain and any path; the meta alone also appears on blogs about Moodle. Its own list keeps Moodle hosts out of the Canvas list that Download all trusts. |
| The theme is `moodle.css`, Boost's own variables remapped (Bootstrap 5's greys and body, Moodle's design-system tokens), plus classes for Bootstrap's rgb() utilities, literals and Bootstrap 4 | One rule per component | Boost's dark mode works the same way, so one remap covers almost every page in both palette directions. Moodle 4.x (Bootstrap 4) has few variables: its rules are kept to stable classes; not measured. |
| Everything beyond the head gate loads on demand (`lib/moodle.js` parsing, `features/moodle.js` asking) | Moodle code in the first content script | The first script on Canvas and Ultra pages doesn't carry Moodle. |
| Due list from `core_calendar_get_action_events_by_timesort` and courses from `core_course_get_enrolled_courses_by_timeline_classification`, through `/lib/ajax/service.php` with the page's session key from the log-out link | A web services token; `M.cfg` from the page's world | What Moodle's own Timeline and Course overview call, with no setup; both read only. The isolated world can't read `M.cfg`, and the log-out link carries the key on every signed-in page, and the site's root when Moodle is in a folder. |
| Card grades from the server-rendered grades overview, read row by row, shown as Moodle formats them; a band only for a percentage | `gradereport_user_get_grade_items` (another extension) | That service isn't AJAX-enabled (`servicenotavailable`, measured), so another extension's Moodle card grades come back empty. Points carry no maximum there, so they get a neutral chip. |
| No course menu, per-course tint or Look, and no keyboard shortcuts on Moodle yet | Generalizing the Canvas course keys | Each needs Moodle course keys threaded through content.js (seen courses, tint, Looks, the editor's list), more than this package's share of the first script. |
