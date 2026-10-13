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
