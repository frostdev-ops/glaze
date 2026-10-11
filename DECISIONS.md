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
| Course colours: 12 fixed hue anchors mixed toward the accent with `color-mix(in oklch)` | Relative colour syntax (`oklch(from …)`) | Relative colour syntax needs Chrome 119 / Firefox 128; `color-mix` works on the current minimums. |
| No View Transitions | `startViewTransition` | Ultra routes client-side; an extension can't wrap its navigations. |
| Background image by `https:` URL only | Upload into `storage.local` | Requested scope. Add upload if wanted. |

## Build notes (Oct 2026)

| Decision | Considered | Why |
|---|---|---|
| Course colours: harmonised = 70% Ultra hue + 30% muted ink | Mixing toward the accent | Mixing toward the accent made every course the same colour; ink keeps the hues apart. |
| Per-course colour keyed by Ultra's colour slot (1–10) | Course id from `/ultra/courses/_ID_/` | The slot class is on every course-scoped element (calendar, messages, grades, stream); ids are only on some links. Pure CSS via `--gz-pick-N`. |
| Ink-inherit rule wrapped in `:where()` | Raising each colour rule's specificity | At (1,2,3) it silently beat every later button, chip and badge colour, 1.0's included. |
| Backgrounds: a fixed `::before` on `<html>` and on each Ultra overlay root | Hiding the page under an overlay via `aria-hidden` | Ultra doesn't reliably mark the covered layer; each overlay painting the same viewport-fixed layer covers it either way. |
| Preview = iframe of a mock Ultra page running content.js | A separate preview renderer | Zero new styling code; the preview is exactly what the content script does. Edits are posted in unsaved so drags don't spend sync write quota. |
| `ui.js` + `ui.css` shared by popup and options | presets.js as a shared swatch renderer | Two pages share storage, palette painting, swatches and controls. |
| Completion burst triggered by `aria-checked` flipping to true on Ultra's review circle | Watching completion text | Ultra already exposes the state as a checkbox role. |
| "Overdue" only inside course content, where the review circle says not done | Everywhere a past due date appears | Elsewhere a past date may be submitted; the stream already says "Past due". |
| Bundled fonts: Inter (variable) + Atkinson Hyperlegible, Latin subset, 71 KB | Google Fonts at runtime | No third-party request from Blackboard pages. |
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
