# Glaze art

Original bitmap art made for Glaze, MIT like the rest of the repo. Created with the built-in OpenAI `image_gen` tool (2026-10-15). No competitor artwork was used or inspected. Generated source masters and discarded variants remain outside this repository.

The prompts follow Glaze's own Frost, Midnight, Forest, Ember and Rose palettes and its rounded glass Looks: calm frosted glass/clay shading, chunky silhouettes, muted mint/teal/lilac or autumn colors, cream highlights, a slate inner outline and a pale outer keyline. Every subject was generated separately; each animal animation was requested as one sheet. Delivery processing only crops, resizes, encodes and assembles generated raster content while retaining its native alpha. No artwork was drawn programmatically.

## Inventory and prompt summaries

All sticker files below are `stickers/<pack>/<name>.webp`: 256 × 256 pixels, transparent, at most 24,000 bytes each. The shared prompt requests one centered original subject with generous padding, no text/background/watermark, and a simple silhouette readable at 48 pixels. Per-file subject summaries are the names below.

| Pack | File names | Bytes |
| --- | --- | ---: |
| `study` | `blank-sticky-note`, `checkmark`, `closed-books`, `coffee`, `desk-lamp`, `graduation-cap`, `hourglass`, `notebook`, `open-book`, `pencil`, `reading-glasses`, `star-cluster` | 120,670 |
| `cozy-autumn` | `acorn`, `candle`, `cinnamon-bun`, `cozy-sock`, `folded-blanket`, `knitted-mittens`, `maple-leaf`, `mushroom`, `oak-leaf`, `pumpkin`, `scarf`, `steaming-cocoa-mug` | 154,820 |
| `space-sky` | `comet`, `constellation`, `crescent-moon`, `earthlike-planet`, `fluffy-cloud`, `full-moon`, `rainbow`, `ringed-planet`, `rocket`, `shooting-star`, `sun`, `telescope` | 160,788 |
| `critters` | `bumblebee`, `gentle-otter`, `lilac-hedgehog`, `little-mouse`, `mint-frog`, `penguin-chick`, `red-panda`, `round-owl`, `seal-pup`, `sitting-bunny`, `small-fox`, `study-buddy`, `study-buddy-bandana`, `study-buddy-happy`, `study-buddy-sleepy`, `teal-turtle` | 219,896 |

The three `study-buddy*` stickers were added for W7: a seated orange-and-cream Shiba with an attentive smile, then happy eyes-closed and sleepy half-closed expression edits of the same generated primary. Prompt: soft rounded clay/enamel shading, slate inner outline and pale outer keyline, tiny mint/lilac reflected accents, no props/text/background, readable at 48 px. They are 12,950 / 13,446 / 13,286 bytes respectively. Native transparency is retained through crop/resize/WebP encoding. Full prompts, source-master references and light/dark review sheet are in the authorized side-session notes (`codex-art-doge.md`, `doge-contact-sheet.png`); the existing repo contact sheet predates this addition.

`pets/cat/sprites.webp` and `pets/bunny/sprites.webp` are lossless transparent WebP sheets, 512 × 256 pixels, with eight 128 × 128 frames in four columns and two rows. Cat prompt: same silver-lilac cat, mint eyes, four seated idle poses and four gentle stretch poses, isolated in a regular grid with transparent gutters. Bunny prompt: same mint-white bunny, lilac nose, four seated idle poses and four gentle hop poses. The first cat sheet was rejected for neighboring-frame overlap and regenerated with wider gutters. Source cells are normalized at a common scale per animal; row-relative vertical positions preserve the hop. Do not resize the sheet when extracting frames.

## Pet frame order and timing

Number frames left to right, then top to bottom. The top-left frame 0 is the static/reduced-motion pose and works alone. Frame rectangle: `x = (frame % 4) * 128`, `y = floor(frame / 4) * 128`, width/height 128.

| Frame | Cat | Bunny | Suggested duration |
| --- | --- | --- | --- |
| 0 | Neutral seated, eyes open | Neutral seated, eyes open | 1800 ms |
| 1 | Gentle inhale, head slightly raised | Gentle inhale | 240 ms |
| 2 | Blink | Blink | 120 ms |
| 3 | Neutral with tail wiggle | Neutral with one tilted ear | 300 ms |
| 4 | Seated stretch start | Crouch | 160 ms |
| 5 | Lean forward | Hop, paws lifted | 180 ms |
| 6 | Paws forward stretch | Soft landing crouch | 420 ms cat / 160 ms bunny |
| 7 | Return seated | Return seated | 220 ms |

Idle loops frames 0–3, then returns to 0. The occasional action plays frames 4–7 once, then returns to 0. The timings are integration recommendations; these sheets contain no autoplay behavior. Keep frame 0 when motion is off or reduced motion is requested. Neutral feet rest near y=122; the bunny's raised frame deliberately lifts from that floor.

## Cursors

All six files are transparent 32 × 32 PNG. Prompts request one recognizable chunky cursor, a charcoal slate border and pale outer keyline, no background/text/watermark, and legibility on both light and dark pages. Aqua uses rounded frosted mint glass; Lilac uses a stepped geometric silhouette; Pearl uses cream/gold enamel and a fountain-pen nib for its default shape. Pointer files use a raised index finger. Coordinates are zero-based pixels in the final file and identify the visible tip, not the image's corner.

| File | Hotspot (x, y) |
| --- | --- |
| `cursors/aqua/default.png` | 7, 2 |
| `cursors/aqua/pointer.png` | 14, 2 |
| `cursors/lilac/default.png` | 7, 2 |
| `cursors/lilac/pointer.png` | 14, 2 |
| `cursors/pearl/default.png` | 3, 2 |
| `cursors/pearl/pointer.png` | 14, 2 |

No text cursor is supplied; preserve the native text selection cursor. CSS integration should retain a native fallback (`auto` or `pointer`) after the bitmap URL and hotspot.

## Review and packaging boundary

`contact-sheet.png` is a review-only composite: every sticker is shown at actual 48 px on light and dark backgrounds, followed by both full pet frame grids and actual 32 px cursor strips. The sheet is opaque intentionally; runtime artwork retains transparency.

Root `package.sh` includes runtime pets, stickers and cursors. Safari’s release scripts stage the Chrome package and verify both extension targets’ resource lists before building. Review composites, source strips and this README remain outside the runtime package. Resource inclusion does not establish native Safari/iOS behavior.

## W24 pet habitat accessory

`stickers/critters/study-buddy-bandana.webp` is original Glaze artwork, MIT like the other study-buddy art: 256 × 256 pixels, transparent WebP, 9,760 bytes. Created with the built-in OpenAI `image_gen` tool on 2026-10-15 from Glaze's own `study-buddy.webp` as the edit target. The exact prompt requested the same seated orange-and-cream Shiba, cream markings, attentive smile, slate inner outline, pale keyline and frosted clay/enamel shading, adding only a cozy muted mint bandana with a tiny lilac star; centered full dog and tail with padding, native transparency, no text, watermark or background, readable at 96 pixels. Delivery processing only crops transparent padding, resizes and encodes WebP. Source master: `01a1406b-cf7a-7311-850b-f5b2a821f204/exec-bd31e56c-1c0c-4abe-af16-d5d0769013e8.png` under the generating session's Codex generated-images directory. Existing books/mushroom/moon/stars stickers furnish the habitat; no competitor artwork was used.

## 3.0.1 animated companions

`pets/{ember,luna,mochi,sprout,pebble}/` each contains original Glaze artwork and a `pet.json` package manifest, licensed under this repository’s MIT license. The five dedicated art runs used the built-in image-generation tool for a canonical character and independent grounded animation strips, then deterministic extraction, registration, alpha cleanup and atlas assembly. No student content or account data was used.

Each final transparent WebP is 1536 × 2288: eight columns, eleven rows, 192 × 208 cells, 73 populated frames and 15 clear slots. Rows are idle, rightward movement, leftward movement, wave, jump, disappointment, waiting, focused work and review; the last two rows hold sixteen clockwise gaze directions, starting upward. Original source strips and contact/motion/quality evidence remain outside the shipped package. The local runtime supports importing the older nine-row v1 format too.

Rime is the owner’s existing arctic-fox pet, reused at their request. Its `pet.json` and WebP are copied unchanged from the local pet package; the sprite SHA-256 is `a355713c1c8cab988e71a6604cf1e6ebfdf88bc3593dd36513780b7fc3ab7ca4`. The importer accepts both `name`/`spritesheet` and `displayName`/`spritesheetPath` metadata conventions; file paths in metadata are never followed.


The Glaze droplet (`pets/glaze/`) is new original animation based on Glaze’s own logo, under the same MIT license: 1,783,056 bytes, SHA-256 `4a0653c6b961c4757e2c634de2bc7367b317e373767bb91b84728f69578a7473`. It uses the same 73-frame v2 layout. Its flexible body deliberately turns and narrows in the side-looking poses: final gaze registration spans 5 pixels, with a 1.307 maximum width ratio; the jump lifts 53 pixels and returns within 1 pixel. Three separate blind reviews matched every horizontal/vertical direction axis. Subtle near-horizontal cues, anatomical transparent gaps and larger gaze-family transitions are recorded in the external QA report rather than presented as zero differences. No QA composites or source strips ship.
