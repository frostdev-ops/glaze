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

At this branch base, root `package.sh` includes `assets/art/pets/`; stickers and cursors are not included yet. `scripts/package-safari.sh` derives its input from that Chrome zip. W7/W12 integration must add only the runtime files each feature needs and any required manifest resources. Keep `assets/art/contact-sheet.png` and this README excluded. The study-buddy addition changes assets only: it does not verify tile wiring, packaging, browser cursor hit-testing, or Safari/iOS behavior.

## W24 pet habitat accessory

`stickers/critters/study-buddy-bandana.webp` is original Glaze artwork, MIT like the other study-buddy art: 256 × 256 pixels, transparent WebP, 9,760 bytes. Created with the built-in OpenAI `image_gen` tool on 2026-10-15 from Glaze's own `study-buddy.webp` as the edit target. The exact prompt requested the same seated orange-and-cream Shiba, cream markings, attentive smile, slate inner outline, pale keyline and frosted clay/enamel shading, adding only a cozy muted mint bandana with a tiny lilac star; centered full dog and tail with padding, native transparency, no text, watermark or background, readable at 96 pixels. Delivery processing only crops transparent padding, resizes and encodes WebP. Source master: `01a1406b-cf7a-7311-850b-f5b2a821f204/exec-bd31e56c-1c0c-4abe-af16-d5d0769013e8.png` under the generating session's Codex generated-images directory. Existing books/mushroom/moon/stars stickers furnish the habitat; no competitor artwork was used.
