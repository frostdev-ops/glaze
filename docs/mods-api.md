# Glaze mods

Mods need Glaze 3.0.4 or newer.

A mod is a signed bundle with settings Glaze draws for it and, in Chrome, code and UI slots that talk to Glaze through
the `glaze` object below. The manifest can also carry Look parts, which apply while the mod is on, with or without code.

- **Code runs only in Chrome**, in a sandbox with no extension APIs or access to the school's page. Workers have no
  network of their own; they use `glaze.fetch`. Where a mod has code, the editor says it needs Chrome.
- **Everything a mod can do is in this document.** Glaze checks broker calls against what the student allowed and draws
  component trees from data, with `textContent` and `setProperty` only. A frame UI draws its own page inside its slot.
- Types for editor completion: [`types/glaze.d.ts`](../types/glaze.d.ts). Add
  `/// <reference path="path/to/glaze.d.ts" />` to the top of a script.

Widgets with no code use [blocks](mods-widgets.md), drawn by Glaze on Chrome, Firefox and Safari.

## A mod

```
my-mod/
  mod.json        the manifest
  hooks.js        code, run in a Worker (optional)
  tile.html       a page for a slot, with its .css and .js files (optional; only without data permissions)
  img/leaf.png    pictures a component tree draws
```

`mod.sig`, the author's signature, is added when the mod is exported. Leave it out of the folder.

**Files.** `js html css json txt md png jpg jpeg gif webp avif woff2`, checked against their bytes. No SVG, wasm or
archives. Paths use letters, digits, `_ - .` and `/`, no part starts with a dot, at most 200 characters and 8 levels.
At most 256 files, 2 MiB in all, 256 KiB of `.js`; `mod.json` at most 64 KiB. A `.glazemod` file is a zip of these; a
`glazemod1:` code is the same zip as text, up to 64 KiB.

### mod.json

```json
{
  "glaze": 1,
  "name": "Next Due Countdown",
  "version": "1.0.0",
  "author": { "name": "Kai", "key": "<your author key>" },
  "permissions": [{ "id": "todo", "why": "Finds your next due date so the tile can count down to it." }],
  "hooks": "hooks.js",
  "ui": { "tiles": [{ "id": "next-due", "name": "Next due", "sizes": ["s", "m"] }] },
  "replaces": [],
  "settings": [{ "id": "course", "type": "toggle", "label": "Show the course name", "default": true }]
}
```

Glaze takes `mod.json` exactly as written or refuses the mod, naming the field: an unknown key, a wrong type or an
over-long value is an error, and nothing is trimmed.

| Field | |
|---|---|
| `glaze` | Required. `1`. |
| `name` | Required. One line, at most 40 characters. Its normalized name is part of the mod's id; changing that makes a different mod. |
| `version` | Required. `1.2.3` or `1.2.3-beta.1`; no `+build`. |
| `author` | Required. `name` (at most 40) and `key`, your Ed25519 public key (43 base64url characters). In a folder loaded in dev mode, leave `key` out and Glaze uses your author key. |
| `permissions` | `[{ id, why }]`, below. |
| `parts` | Look parts, below. |
| `packs` | Sticker and pet files, below; no code or permissions required. |
| `ui` | Slots: `tiles` (at most 8: `id`, `name`, `sizes` of `s` `m` `l`, optional `file`), `rail` (at most 4: `id`, `name`, optional `file`), `nav` and `background` (`null`, `{}` or `{ "file": "x.html" }`). Ids are `a-z 0-9 -`, up to 32, starting with a letter. A `file` is an HTML file of the mod. |
| `hooks` | A `.js` file of the mod, run in a Worker. |
| `replaces` | What the mod can take over, below. |
| `settings` | At most 32, below. |

### `packs`

Up to 24 stickers (`png`, `webp`, `avif`, `json` for Lottie) and 4 pets (`png` or `webp` sprite sheets).
Each entry has a unique `id` (the slot-id rules), a one-line `name` of at most 40 characters, and a `file` in this bundle.
Stickers are checked and cleaned before display; pets go through the existing pet import checks when added to the library.
Packs need no hooks or UI and work on Chrome, Firefox and Safari.

```json
{ "packs": { "stickers": [{ "id": "leaf", "name": "Leaf", "file": "img/leaf.png" }], "pets": [{ "id": "buddy", "name": "Buddy", "file": "img/buddy.webp" }] } }
```

### Permissions

Each is declared with a reason. The student sees Glaze's description of it and the reason quoted ("The author says"),
chooses what to allow, and can take any of it back later. A call without its grant rejects with `permission`.

| `id` | Gives |
|---|---|
| `courses` | `glaze.courses()`, `glaze.cards.decorate()` and the `courses` event. |
| `todo` | `glaze.todo()`, `glaze.schedule()` and the `todo`, `complete` and `submit` events. |
| `grades` | `glaze.grades()` and the `grade` event. |
| `nav.read` | `glaze.nav.model()` and the `nav.change`, `nav.navigate`, `nav.expand`, `nav.collapse` and `nav.sheet` events. Glaze's bar shows course names and unread counts, so this is personal data. |
| `nav.items` | `glaze.nav.add()`, `glaze.nav.update()` and `glaze.nav.remove()`: up to 8 items of the mod's own in Glaze's bar, and the `nav.action` event. |
| `nav.layout` | `glaze.nav.layout()`, a layout returned from `glaze.nav.items()`, and a `nav` in `glaze.look.override()`: a layout proposed over the student's while the mod runs. Its links go only to pages of the school's site. |
| `network:<host>` | `glaze.fetch()` to `https://<host>/`. The host is a lowercase DNS name with at least two labels: no port, wildcard, address or local name, and subdomains don't count. At most 8. |
| `documents` | On the [Documents page](#the-documents-page): `glaze.documents.list()`, `open()`, `create()`, `add()`, `remove()` and `style()`, and the `documents.action` and `documents.change` events. The list holds the titles, courses and word counts of the student's documents, so this is personal data. |
| `documents.read` | `glaze.documents.read()` and `glaze.documents.export()`: a document's text, and the file it saves as. Needs `documents` too. |

`why` is one line of at most 280 characters.

- **Personal data stays in the Worker.** A mod that declares `courses`, `todo`, `grades`, `nav.read`, `documents` or `documents.read` has no page of its own: no
  HTML file anywhere in its bundle, and every UI is a component tree. A mod that has held such data stays Worker-only
  through updates.
- **Glaze adds its own warnings** to the prompt: personal data together with a network host ("could send your grades to
  ..."), a page of its own (it can contact other sites, which learn the student's address and when they use it), unsigned
  (Dev), not reviewed, and Chrome only.
- **Code is a permission of its own.** A mod with `hooks` or a slot `file` is listed as "Runs its author's code". An update
  that adds code to a mod that had none (a widget made of blocks) asks again, even with the same permissions, and a
  followed channel waits for the student's review.
- **Removing a mod** asks whether to remove its stored data too (on by default): what it saved with `glaze.storage`, its
  private-data mark, its navigation-layout switch and its stop note. Keep it, and a mod with the same id finds it again.

### `replaces`

Any of `bg`, `nav`, `effect:<moment>` (`complete` `submit` `grade` `streak` `timer.done` `look.rotate`) or
`tile:<built-in>` (`notes` `agenda` `timer` `quotes` `music` `breathe` `buddy` `todo`). Each appears as a switch under
**What it may replace** on the mod's card in the **Mods** tab. Switches are off by default; the student turns each on
for that mod. Updates keep switches for keys still declared and leave new keys off.

- `bg` needs `ui.background`, `nav` needs `ui.nav`, and `tile:<id>` needs a tile in `ui.tiles` with that same id. The
  mod's UI then stands in for Glaze's own.
- `nav`: where Glaze's bar is drawn, the mod's `nav` slot takes its place (the rail, the top bar, or a phone's tabs) in the
  room the bar keeps for the page; Glaze's bar hides and the school's own stays hidden. Turned off, Glaze's bar is back.
  Without Glaze's bar, it takes the place of the school's own navigation. A replacement drawn from a tree may call
  `glaze.nav.go(id)` within a second of a click in its `nav` slot; to show the bar's items it also declares `nav.read`.
- `effect:<moment>` stops Glaze's own effect for that moment, and the mod hears an `effect` event instead (not with motion
  off or the page hidden).
- Two running mods with the same switch on: the one higher in the student's order (**Mods** tab, **Order**) wins.
  A replacement without its matching UI slot does not compete.

### `settings`

Glaze draws these in the Mods tab; `glaze.settings()` returns the student's values. Each has `id` (as slot ids), `type`
and `label` (one line, at most 60).

| `type` | Also | Value |
|---|---|---|
| `toggle` | `default` | boolean, false by default |
| `choice` | `options` (2 to 16 different, each at most 40), `default` | one of `options`, the first by default |
| `number` | `min`, `max` (required), `step`, `default` | a number between them (on the step), `min` by default |
| `text` | `max` (1 to 500, default 500), `default` | a line of text, `''` by default |
| `color` | `default` | `#rrggbb` (lowercase), `#000000` by default |

### Look parts

`parts` holds the same data as a theme code's parts, cleaned by `lib/lookparts.js`, which has every field and limit.
An installed mod's `parts` apply while it is on (and not blocklisted; a development copy only while development mode is on),
on every browser: a mod with only `parts` and no code is a whole mod, and a code mod's parts apply in Firefox and Safari
too, where its code can't run. They go where a Look's parts go, including live course tabs, never on quiz or tool pages. The
student's Look is the base, or on a course that wears a Look of its own, that Look; each mod's parts lay over it in the student's mod order: the first
mod to set a key (`bg`, `anim`, `fx`, `cursor`, `pointer`, `type`, `nav`) wins it whole, and `rules` add up, the Look's first, to 64 in
all. A mod's background is drawn whatever kind of background the student chose. `glaze.look.override()` layers from
running code go on top of all of these. Turning the mod off, removing it or reordering applies at once:

| Key | What |
|---|---|
| `bg.shader` | `{ src }`: a fragment shader in GLSL ES 1.00, ASCII, at most 8 KiB, written as `vec4 scene(vec2 uv)` (`uv` 0 to 1, y up; rgb is the colour, a how much covers the ground). Uniforms `uTime` `uAspect` `uPx` `uAmount` `uGround` `uC1` `uC2` `uC3`, helpers `hash` `noise` `fbm` `amt` `rot` `px`. Checked by `lib/glsl.js` before anything draws. |
| `bg.layers` | 1 to 4 layers, bottom first: `scene`, `noise`, `gradient` or `particles`. |
| `bg.media` | `{ type, src, fit?, dim?, loop? }`: a looping `video`, an animated `image` (WebP or AVIF) or a `lottie` animation. `src` is an `https:` address (the install prompt names its host), or `./<path>`, a file in the bundle: `.webm` or `.mp4` for a video, `.webp` or `.avif` for a picture, `.json` for Lottie. The file must be what `type` says and within a Look background's limits (video 12 MiB, picture 6 MiB, Lottie 1 MiB); it also shares the bundle's 2 MiB with every other file, so in practice a bundled background is a Lottie animation, an animated WebP or AVIF, or a short clip. Otherwise the bundle is refused, as it is for a `file:` source; the file is checked again each time a page or the editor's preview asks for it. A video file may be in a bundle only as this. The gallery takes only `./` files. |
| `anim` | Keyframes for `page.enter` `panel.enter` `card.enter` `tile.enter` `rail.open` `tooltip.in` `card.hover` `button.press`. |
| `fx` | Effects for `complete` `submit` `grade` `streak` `timer.done` `look.rotate`. |
| `cursor` | The pointer's animation, drawn around the system pointer: `trail`, `sparkle`, `ripple`, `glow`, `flicker`, `orbit`, `scan` or `drift`, with `shape` for the marks `orbit`, `drift` and `sparkle` use. |
| `pointer` | The pointer set, by name: `aqua` `lilac` `pearl` `aurora` `quill` `terminal` `lava` `neon` `clear` `lagoon` `rose` `ghost` `pumpkin`, or `own` (the student's own picture, which never travels in a code). |
| `type` | A typing effect at the caret: `embers`, `ink`, `sparks`, `pixels`, `petals`, `snow`, `bubbles` or `wisps`, with `c`, `size` and `count` (per key). Never in password, card or one-time-code fields, never while composing, never on quiz or tool pages; it never reads what is typed. |
| `nav` | A nav layout, below. |
| `rules` | At most 64 rules on named page parts, below. |

Colours are a palette token or `#rrggbb`. A shader or layers background draws when the worn Look's background is set to
Custom shader or Layers. The editor's builders produce the same data.

## Dev mode

In the editor's **Mods** tab, **Mod development**:

1. Turn on **Dev mode**. Without it, an unsigned mod can't be installed or run. Turning it off stops Dev copies;
   turning it back on restores their saved on/off state.
2. **Load mod folder...** (Chrome) reads the folder and shows the install prompt. The mod is installed unsigned, marked
   **Dev**, "From a folder". It needs an author key: **Make author key**, or put `author.key` in `mod.json`.
3. After editing, press **Reload**. The folder is read again; if the mod asks for nothing new it updates quietly, and mods
   open on school pages restart without a page reload. Nothing watches the folder.
4. **Export signed** writes `<name>.glazemod`, signed with your author key.

A Dev copy never replaces a signed one, and a signed one can't replace a Dev copy until you remove it. The folder is read
without dot-files or a top-level `mod.sig`, with the same limits as a bundle. Open [`examples/mods`](../examples/mods) to
see a folder.

## Signing, updates and sharing

- **Author key.** An Ed25519 key kept in the browser. Glaze makes it the first time you need one; **Back up key...**
  saves it to a file locked with a passphrase, and without it you can't update your mods. Signing needs a browser with
  WebCrypto Ed25519.
- **Identity.** `mod.sig` is an Ed25519 signature over the bundle's files. A mod's id comes from the author key and the
  normalized name, so keep the same key and name for updates.
- **Signed updates.** An update has the same id, a higher version and the same signing key; Glaze pins the key at the first
  install. If it asks for no new permission (or a page of its own) it installs quietly, keeping what the student granted;
  otherwise the student is asked again. A lower or equal version, a different key, and the same version with different
  files are refused.
- **Getting it to students.** A `.glazemod` file, a `glazemod1:` code, the gallery or a channel link, below.
- **Blocklist.** A mod Glaze has blocked can't be installed or turned on.

### Mod channels

- **Author.** Load the folder in **Mods → Mod development**, then **Publish to a channel**. Glaze signs it with your
  author key and copies the read link. For each update, keep the same name and key, raise `version`, **Reload**, then
  publish again. **Copy channel link** copies the same channel's link later.
- **Student.** Paste the link in **Mods → Add a mod → Mod code**, press **Read code**, review the prompt and install.
  Installing from the link follows that channel. Its card has **Check now**, **Review update** when more access is
  requested, and **Stop following**, which keeps the installed copy.
- **Checks.** Opening the editor checks enabled followed mods. Loading code mods on a school page also checks, at most
  once a day per followed mod; there is no background daily timer. **Check now** also works for a disabled copy.
  A signed newer version asking for no new access updates quietly; otherwise it waits for review. Failed checks keep
  the installed copy. Every bundle's author signature, pinned key, version and blocklist are checked.
- **Relay.** A new channel uses the author's relay selected in **Sharing → Relay**. Existing channels keep their server.
  The install prompt and followed mod's card show the link's relay host, where Glaze checks for updates. Channel checks
  use no cookies or referrer and refuse redirects; they do not need a mod's `network:<host>` permission.

## Running code

Two places, by what the mod asks for:

| | Worker (`hooks`) | Frame UI (a slot's `file`) |
|---|---|---|
| Runs | `hooks.js`, once, at the top level. No modules: one classic script. | The page's `<script src>` files in order, at the top level. |
| Has | Timers, `OffscreenCanvas`, `requestAnimationFrame` (from Glaze), `glaze`. No DOM. | Its own page: HTML, CSS, canvas, WebGL, `glaze`. |
| UI | Component trees and a canvas, drawn by Glaze. | Fills its slot. |
| Data permissions | Yes. | Never. |

- **Frame pages.** Scripts and stylesheets must be files of the mod, named by relative path. Inline `<script>` and any
  `<link>` that isn't one of the mod's stylesheets are removed; inline `<style>` works. Images and fonts use `data:` or
  `blob:` URLs; bundle paths are not rewritten. A frame is as tall as its slot: tiles 160 (`s`), 240 (`m`) or 360 (`l`)
  pixels, rail widgets 120.
- **Network and storage.** `fetch`, XHR and WebSocket are blocked by the sandbox: use `glaze.fetch`. Top-page navigation,
  popups and browser storage are blocked. A frame UI that navigates away is stopped; Glaze still warns that a page of
  its own can contact other sites. `glaze.storage` is the mod's storage.
- **When it runs.** In the top frame of Canvas, Blackboard Ultra and Moodle pages Glaze is on, never on a quiz or a
  tool's page; and, for a mod granted `documents`, its Worker on the Documents page in a tab of its own. It stops when the page goes, the mod is turned off or revoked, or Glaze is turned off.
- **When it is stopped.** A Worker that doesn't answer the heartbeat (every 2 s) for 5 s, a frame that holds the page for
  2 s or more, more than 240 messages from the mod in a second, a frame that navigates away, and an error that is
  thrown and not caught in a Worker (including one thrown inside a handler or a `decorate` or `items` function; a
  rejected promise doesn't count). It stays off on that page until the page is reloaded or the student turns the mod off and
  on; the Mods tab says why.

## The `glaze` object

Data reads and broker calls return promises; listeners, `cards.decorate`, `nav.items` and `ui.commit` return nothing.
A refused call rejects with an `Error` whose message is a code: `permission` (not declared and
granted, or a frame asking for personal data), `args` (wrong arguments or a value Glaze refuses), `size`, `quota`,
`busy` (64 calls already waiting), `slot`, `tree`, `image`, `method`, `header`, `redirect`, `timeout`, `network`,
`blocked`, `mod` (not runnable), `call` (unknown call), `write`, `cancelled` or `failed`.

Where a row says Worker, a frame UI can't use it (personal data goes to Workers only).

| Call | Does | Needs |
|---|---|---|
| `glaze.on(event, fn)` `glaze.off(event, fn)` | Listen for an event, below. | |
| `glaze.call(name, ...args)` | The raw call behind the rest, by the name Glaze checks (`'storage.get'`). Prefer the methods. | |
| `glaze.storage.get(key?)` | One value (`null` if unset), or with no key everything stored. | |
| `glaze.storage.set(key, value)` | Keeps a JSON value (not `undefined`). 1 MiB per mod, device only; key 1 to 256 characters. | |
| `glaze.storage.remove(key)` | Removes it. | |
| `glaze.theme()` | `{ tokens: { accent: '#17c8f4', ... }, dark, motion: 'off' \| 'subtle' \| 'expressive' }`. The `tokens` are the palette Glaze wears. | |
| `glaze.settings()` | `{ [setting id]: value }`, with defaults. | |
| `glaze.courses()` | `[{ id, name, code, color }]`, the courses Glaze has seen on this site. Worker. | `courses` |
| `glaze.todo()` | `[{ id, type, courseId, course, title, due, url, done, submitted, graded, late, missing }]`, the cached plan of the account signed in on this page; `due` is ms since 1970 or null; planner notes' text isn't included. Worker. | `todo` |
| `glaze.schedule(from, to)` | Cached due items in `[from, to]`, including both ends, with the same fields and cleaning as `todo`. Both arguments are non-negative safe integer ms since 1970, `from <= to`, at most 60 days apart; at most 500 results in cache order. Undated items are omitted. Uses only the plan Glaze has already read: no fetch for missing days, no class timetable. Worker. | `todo` |
| `glaze.grades(courseId?)` | `[{ courseId, name, percent, at }]`, each course's latest grade from Insights for the account signed in on this page, `[]` until Insights has run or while that account is unknown. Worker. | `grades` |
| `glaze.fetch(url, init?)` | `{ status, ok, headers, text }`. `https` on port 443, `GET` or `POST` (`init.body` a string), request headers `accept` `accept-language` `content-language` `content-type` `authorization`. No cookies, no referrer, redirects refused, 15 s, 2 MiB back as text; of the response headers only `content-type` `content-length` `etag` `last-modified` `date` `cache-control`. | `network:<host>` |
| `glaze.ui.render(slot, tree)` | Draws a component tree in a slot of the manifest that has no `file`; `null` clears it. | |
| `glaze.ui.canvas(slot)` | The slot's `canvas` component as an `OffscreenCanvas`. Worker. | |
| `glaze.ui.commit(slot)` | Sends the canvas to the page now. Worker. | |
| `glaze.cards.decorate(fn)` | `fn(courses)` gets `[{ id, name }]` for the cards on the page and returns `{ [courseId]: { badge, accent, note } }` (or a promise of it; `{}` clears). Applied on the next pass. Worker. | `courses` |
| `glaze.nav.items(fn)` | `fn(items)` gets `[{ id, label }]`, the page's own items shown in Glaze's bar (or the older rail), each with Glaze's English name for it (`course` is `Courses`), and returns a nav layout to stand in for the student's own, or nothing. The first mod in the student's order to give one wins. Returning a layout needs `nav.layout`; returning nothing needs no permission. Glaze refusing the layout stops the mod, as an error thrown in `fn` would. | `nav.layout` for a layout |
| `glaze.nav.model()` | Glaze's bar: `{ place, items: [{ id, label, icon, badge, active, group }], groups: [{ label, items: [id] }], course: { name, items } \| null, active }`, hidden items left out, no addresses, at most 64 items; `null` where the bar isn't drawn. Worker. | `nav.read` |
| `glaze.nav.add(item)` | One of the mod's own items in the bar: `{ id, label, icon?, href \| action, badge?, group \| slot }`. `id` as slot ids; `label` one line of at most 40, and not the name of Glaze's own settings or sign-out items in any of Glaze's languages, compared without case, spaces or punctuation (`Glaze settings`, `Sign out`, `Log out`, `Abmelden`, ...; refused with `args`); `icon` one of the bar's except `glaze` and `signout`, which only Glaze's own items wear (else the link icon); `href` a page of the school's site this page is on, nothing else; `action: true` sends `nav.action` on a click instead; `badge` a number or at most 4 characters; `group` a group's label or place (0 to 7), or `slot` `top` or `bottom`. At most 8; the same `id` replaces. They show with the mod's name and go when it stops. | `nav.items` |
| `glaze.nav.update(id, patch)` | Changes one of its own items; the patch has the same keys, without `id`. | `nav.items` |
| `glaze.nav.remove(id)` | Removes one of its own items. | `nav.items` |
| `glaze.nav.layout(patch)` | A nav layout proposed over the student's while the mod runs, never saved; `null` withdraws it. Its links must be pages of the school's site, below. `place` `left` or `top` moves the bar. The student's own choices win where they made them, as with a worn Look; the first mod in the student's order wins. The bar says "Arranged by" the mod with **Use my own**, which keeps that mod's layouts off until the student lets it again in **Settings → Navigation → Navigation items**. | `nav.layout` |
| `glaze.nav.go(id)` | Opens a bar item (or its panel) as a click on it would. Only for the mod whose `nav` replacement is on, in its Worker, within a second of a click in its tree-drawn `nav` slot. One click allows one call. Destinations must be on the current school's origin; the student's and worn Looks' off-site HTTPS links still work when clicked directly. | |
| `glaze.palette.commands(list)` | `[{ id, title, hint?, run }]` for Ctrl+K, at most 16; `run()` is called here when the student picks it. | |
| `glaze.rules.set(rules)` | Page rules, below; `[]` clears. | |
| `glaze.effects.play(kind, options?)` | A particle effect: `kind` is `burst`, `confetti`, `rain`, `ring`, `sprite` or `contour` (up to 4 nested rings stepping out to `size`, traced round `spread` degrees and lifted by -`gravity` × 4 px, then its `shapes` round the rim). Options: `count` 1 to 60, `shapes` (up to 4 of `dot` `star` `snow` `heart` `leaf` `spark`), `c` (up to 6 colours), `spread` 0 to 360, `gravity` -2 to 2, `life` 200 to 2500 ms, `size` 2 to 48, `x` and `y` 0 to 1 (fractions of the window; 0.5 and 0.33 by default). One a mod every 200 ms; none with motion off or the page hidden. | |
| `glaze.look.override(parts)` | Look parts laid over the student's Look while the mod runs, never saved; `null` removes them. The first mod in the student's order to give a part wins it; `rules` add up. Media `src` and `type` must exactly match `parts.bg.media` in the installed manifest; code can change its fit, dim and loop controls. A `nav` is a nav layout from code, as `glaze.nav.layout()`'s, and needs `nav.layout`. Use `glaze.fetch` for network requests. | `nav.layout` for a `nav` |
| `glaze.broadcast(data)` | To this mod's other Worker and frames on the page, as a `broadcast` event; not back to the sender. At most 64 KiB. | |
| `glaze.documents.list()` | `[{ key, kind, title, format, words, updated, course }]`: every document the page lists (none in its Trash), newest first, its title as shown, `updated` in ms since 1970, `course` `''` for none. Never its text. Documents page, Worker. | `documents` |
| `glaze.documents.open(key)` | Opens a document in this tab, restoring it first if it is in Trash. Only within a second of the student's click on one of the mod's own items; one click allows one call, and any other rejects with `permission`. | `documents` |
| `glaze.documents.create({ format })` | Starts a new document in this tab: `format` `plain` (Blank, the default), `mla9`, `apa7` or `chicago17`. As `open`, after a click. | `documents` |
| `glaze.documents.read(key)` | `{ key, title, text }`: a listed document's text, a line a paragraph. | `documents.read` |
| `glaze.documents.export(key)` | `{ name, mime, bytes }`: a listed document as the file its kind saves (`Lastname_Title.docx`), `bytes` a `Uint8Array`. | `documents.read` |
| `glaze.documents.add(slot, { id, label })` | One of the mod's own items: `slot` `documents.toolbar` (a button in the toolbar) or `documents.card` (an entry in every card's ⋯ menu, after Glaze's own). `id` as slot ids, `label` one line of at most 40. At most 4 a slot; the same `id` replaces. They show with the mod's name and go when it stops; a click sends `documents.action`. | `documents` |
| `glaze.documents.remove(slot, id)` | Removes one of its own items. | `documents` |
| `glaze.documents.style(hooks)` | The page's hooks while the mod runs, never saved; `null` withdraws them: `radius` (0 to 32 px), `glass` (the blur, 0 to 40 px), `thumb` (the thumbnails' scale, 0.6 to 1.6), `column` (the grid's narrowest column, 160 to 400 px). The first mod in the student's order to set one wins it. | `documents` |

**Nav layout** (`glaze.nav.items`, `glaze.nav.layout`, `glaze.look.override`, `parts.nav`): `{ place: 'left' | 'top' | 'bottom' | 'dock', groups: [{ label, items: [id] }]
(up to 6), hidden: [id], links: [{ id, n, u, i }] (up to 8), icons: { id: icon } }`. Ids are the navigation's own names
(`course`, `calendar`, `grades`, ...), `link:<id>` for your own links (`id` is 12 characters of `a-z0-9`) or `w:clock`,
`w:next`, `w:timer`, `w:pet`. Icons are `link` `book` `video` `chat` `doc` `calendar` `folder` `code` `star` `globe`. Unknown
ids are dropped. In a layout from code (the first three), each link's `u` must be an `http(s)` page of the school's site the
page is on, the same rule as `glaze.nav.add`'s `href`; a link anywhere else refuses the whole call with `args`, so none of
that layout applies. Otherwise its address could carry what the mod read off the site without a network permission. A
bundle's static `parts.nav` carries no data of the student's, so its links may go to other sites.

Reserved item names also compare compatibility characters, accents, and common Cyrillic/Greek lookalikes of Latin
letters (for example, `Glаze settings` with Cyrillic `а`). This comparison does not change the displayed label.

**Rules** (`glaze.rules.set`, `parts.rules`): `{ p, do, ... }` on a named part from `lib/parts.js` (`ultra.course-card.title`).
`do` is `hide`, `show`, `move` (with `to`, the part to move beside, and `at`, `before` or `after`), `style` (with `st`: `bg`
`fg` `bc` colours, `bw` 0 to 4, `r` 0 to 32, `p` and `g` 0 to 6, `sh` 0 to 3, `o` 0 to 100, `f` a font id) or `label` (with
`t`, up to 60 characters). At most 64 with the Look's.

## Events

`glaze.on(event, fn)`. The data events (`courses`, `todo`, `grade`, `complete`, `submit`, and the bar's `nav.*` events but `nav.items` and
`nav.action`) reach only mods granted the permission and carry little: ask the call.

| Event | When | Data |
|---|---|---|
| `stop` | Glaze is about to stop the mod. | |
| `page` | At start and when the address changes. | `{ site: 'ultra' \| 'canvas' \| 'moodle' \| 'documents', kind: 'course' \| 'courses' \| 'dashboard' \| 'grades' \| 'calendar' \| 'documents' \| 'other', courseId }` |
| `visible` | The page is shown or hidden. | boolean |
| `theme` | Glaze's colours or motion changed: ask `glaze.theme()`. | |
| `settings` | The student changed the mod's settings: ask `glaze.settings()`. | `{}` |
| `courses` | Glaze saw new courses (`courses`). | `{}` |
| `todo` | The plan changed (`todo`). | `{}` |
| `grade` | A grade came in (`grades`). | `{}` |
| `complete` `submit` | Work was ticked off or handed in (`todo`). | `{}` |
| `effect` | A moment the mod replaces happened. | `{ moment, x?, y? }`, x and y fractions of the window |
| `ui` | A button or input in a tree was used (a real click or change). | `{ slot, id, kind: 'click' \| 'change', value? }` |
| `broadcast` | Another part of this mod called `glaze.broadcast`. | what it sent |
| `cards` | The cards on the page changed (`courses`); `cards.decorate` answers this. | `{ courses: [{ id, name }] }` |
| `nav.items` | The navigation changed; `nav.items` answers this. Every mod hears it, so it carries only the page's own items by id with Glaze's English names: not what the student renamed or added, not the account item, Glaze's own items or other mods' items (`glaze.nav.model()` reads the bar as drawn, with `nav.read`). | `{ items: [{ id, label }] }` |
| `nav.change` | Glaze's bar changed (`nav.read`): ask `glaze.nav.model()`. | `{}` |
| `nav.navigate` | The student used an item of the bar (`nav.read`). | `{ id }` |
| `nav.expand` `nav.collapse` | The rail opened or closed (`nav.read`). | `{}` |
| `nav.sheet` | A phone's More sheet opened or closed (`nav.read`). | `{ open }` |
| `nav.action` | The student clicked one of the mod's own `action` items. | `{ id }` |
| `documents.action` | The student clicked one of the mod's own items on the Documents page (`documents`). | `{ slot, id, doc? }`: `doc`, the card's summary as `list()` gives it, for a `documents.card` item |
| `documents.change` | The documents changed (`documents`): ask `glaze.documents.list()`. | `{}` |
| `canvas.size` | Worker. A slot's canvas has this size in device pixels. | `{ slot, w, h, dpr }` |
| `canvas.pause` | Worker. Nothing of the mod's canvases shows (page hidden, motion off, canvas not on the page); animation frames wait. | `{ paused }` |

## UI slots and components

A slot is `tile:<id>` (a tile on the student's widget boards), `rail:<id>` (a widget in Glaze's navigation rail), `nav`
(with `replaces: ["nav"]`) or `background` (with `replaces: ["bg"]`), as `ui` in `mod.json` declares it.

- A slot **with a `file`** is a frame UI and fills its slot.
- A slot **without one** is drawn by Glaze from a tree: `glaze.ui.render('tile:next-due', tree)`. Anything the tree
  breaks rejects the whole call with `tree`, and nothing is drawn.
- Colours: a palette token (`accent` `accent-hi` `accent-soft` `accent-ink` `surface` `surface-2` `ink` `ink-muted`
  `ink-faint` `line` `line-strong` `ok` `warn` `err`) or `#rrggbb`. Text has control and direction characters turned
  into spaces. A string over its limit refuses.
- At most 8 levels, 200 nodes, 50 children a node, one `canvas`. Ids (`a-z 0-9 -`, up to 32) are unique in a tree.
- A re-render keeps the focus and caret where the student had them.

| Component | Keys (`*` required) |
|---|---|
| `stack` | `children*`, `label`, `gap` 0 to 6, `align` `start` `center` `end` `stretch` |
| `row` | as `stack`, and `wrap` |
| `list` | `children*`, `label`, `ordered` |
| `text` | `text*` (at most 500; line breaks kept), `size` `xs` `s` `m` `l` `xl`, `weight` `normal` `bold`, `color`, `muted` |
| `number` | `value*`, `label`, `unit` (at most 12), `digits` 0 to 4, `size`, `color` |
| `ring` | `value*`, `max` (100), `label`, `color` |
| `progress` | as `ring`, a bar |
| `countdown` | `to*` (ms since 1970), `label`, `done` (said after; at most 80) |
| `image` | `src*` (a png, jpg/jpeg, gif, webp or avif of the mod, at most 4096 pixels a side), `alt*` (`''` for a decoration), `w`, `h` (1 to 2000), `fit` `contain` `cover` |
| `button` | `id*`, `label*` (at most 60), `tone` `primary` `plain`, `disabled` |
| `input` | `id*`, `kind*`, `label*`, `disabled`, then by `kind`: `text` (`value`, `maxLength`, `placeholder`), `number` (`value`, `min`, `max`, `step`), `toggle` (`value`), `select` (`options*` up to 32 different, `value`) |
| `canvas` | `h` 24 to 800 CSS pixels, `label` |

**Canvas.** Render a tree with a `canvas`, then `const c = await glaze.ui.canvas(slot)` and draw with
`requestAnimationFrame`. The canvas has the slot's width in device pixels (at most 2 a CSS pixel and 4096 a side) and
Glaze resizes it as the slot changes. Its picture goes to the page after each animation frame in which the mod drew on it
(any call or assignment on the canvas's context counts; a context taken from `OffscreenCanvas.prototype` directly isn't
seen, so call `glaze.ui.commit` after drawing with one), or on `glaze.ui.commit`, at most 60 a second. Frames stop while `canvas.pause` says so. Nothing animates with motion off.

## The Documents page

Glaze Writer's Documents page, in a tab of its own (the popup's Documents, or Settings → Writer's Documents link), runs
the Worker of each mod granted `documents`, as a school page runs mods, and nothing of the others. Documents opened as a
page of a school's site (Ctrl+K, the navigation's Documents) and a document opened from the list run no mods. There a mod
has `glaze.storage`, `glaze.theme()`, `glaze.settings()`, `glaze.broadcast()`
and `glaze.documents`; any other call rejects with `call`, as `glaze.documents` does on a school page. Its `page` event says
`{ site: 'documents', kind: 'documents', courseId: null }`. A key is a random opaque handle, `document:<uuid>`, scoped to
this mod on this page, without the school host or user id in the internal storage key. It comes from `glaze.documents.list()` or
`documents.action`; do not persist it across page loads or mod restarts. The document must still be listed;
any other key rejects with `args`.

```js
glaze.documents.add('documents.card', { id: 'count', label: 'Count sentences' });
glaze.on('documents.action', async ({ id, doc }) => {
  if (id !== 'count') return;
  const { text } = await glaze.documents.read(doc.key); // documents.read
  await glaze.storage.set(doc.key, text.split(/[.!?]+\s/).length);
});
```

The page wears the student's Look, background and glass included. These hooks restyle it, through
`glaze.documents.style()` (a Look has no CSS of its own):

| Property | Default | |
|---|---|---|
| `--gd-radius` | the Look's corners | The panels', cards' and menus' corners (`radius`). |
| `--gd-glass` | the Look's blur | The blur behind the panels, cards and menus over a background (`glass`). |
| `--gd-thumb` | `1` | The thumbnails' scale (`thumb`). |
| `--gd-column` | `224px` | The grid's narrowest column (`column`). |
| `--gd-lift` | Glaze's hover lift (`--gz-lift`: up 2px, 4px and 1% larger on Expressive, none with motion or hover effects off) | A hovered card's and New tile's lift, a `transform`. |
| `--gd-panel` | the Look's surface, opaque enough to read | The panels' and cards' fill. |

The page's parts keep these class names: `gd-top` (the heading and New), `gd-new`, `gd-tile`, `gd-bar` (the toolbar),
`gd-search`, `gd-extra` (the toolbar's added items), `gd-docs`, `gd-card`, `gd-pic`, `gd-title`, `gd-meta`, `gd-more`,
`gd-menu` and `gd-added` (an added menu item).

## Limits

| | |
|---|---|
| A bundle | 256 files, 2 MiB in all, 256 KiB of `.js`, `mod.json` 64 KiB |
| A call | arguments 1 MiB as JSON, an answer 4 MiB, 64 calls waiting |
| Messages | 240 a second from a mod; over that the mod is stopped. Canvas pictures count against their own canvas, 240 a second each |
| `glaze.storage` | 1 MiB per mod |
| `glaze.fetch` | 15 s, 2 MiB back, no redirects |
| `courses`, `todo`, `schedule`, `grades` | at most 500 items; `schedule` spans at most 60 days |
| A component tree | 8 levels, 200 nodes, 50 children a node, 500 characters of text, one canvas |
| A canvas | 24 to 800 CSS pixels tall, at most 2 pixels per CSS pixel and 4096 a side, at most 60 pictures a second |
| `glaze.effects.play` | one a mod every 200 ms |
| `glaze.cards.decorate` | up to 200 courses; `badge` at most 12 characters, `note` at most 120 |
| `glaze.palette.commands` | 16 |
| `glaze.nav.add` | 8 items a mod; label 40, badge 4 characters |
| `glaze.broadcast` | 64 KiB |
| `glaze.documents.add` | 4 items a slot; label 40 characters |
| Hangs | a Worker silent for 5 s, or a frame holding the page for 2 s, is stopped |

## Examples

Each mod folder in [`examples/mods`](../examples/mods) loads with **Load mod folder...**.

| Folder | Shows |
|---|---|
| `examples/mods/countdown-tile` | A tile drawn from a component tree: counts down to the next open due item (`todo`), with a setting. |
| `examples/mods/rail-widget` | A rail widget with a page of its own: HTML, CSS and a script that follows Glaze's theme and keeps a count in `glaze.storage`. |
| `examples/mods/card-decorator` | A badge on each course card (`courses`). |

[`examples/looks/shader-background`](../examples/looks/shader-background) is a Look-parts example: paste its GLSL into
**Look → Background → Custom shader**. It becomes part of the worn Look; **Copy theme code** shares it.
