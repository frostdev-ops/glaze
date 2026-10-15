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
| `critters` | `bumblebee`, `gentle-otter`, `lilac-hedgehog`, `little-mouse`, `mint-frog`, `penguin-chick`, `red-panda`, `round-owl`, `seal-pup`, `sitting-bunny`, `small-fox`, `teal-turtle` | 170,454 |

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

At this commit, root `package.sh` packages an explicit file list that omits **all of `assets/art/`**; `scripts/package-safari.sh` derives its input from that Chrome zip. Thus the review sheet is currently unshipped, and the runtime art is also not yet shipped. W4/W12 integration must add only `assets/art/stickers/`, `assets/art/pets/` and `assets/art/cursors/` to the package/chmod lists and any required manifest resources. Keep `assets/art/contact-sheet.png` and this README excluded. Asset creation does not verify runtime wiring, browser cursor hit-testing, or Safari/iOS behavior.
