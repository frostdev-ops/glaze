# Glaze art


## Expanded habitats and Classic buddy motion (2026-10-17)

Built-in OpenAI `image_gen` produced four original transparent habitat sprites in `stickers/habitat/`: `shelf`, `pet-bed`, `kelp`, and `sandcastle`. Each final WebP is 256×256, at most 24 KB, with native alpha. Delivery processing trims transparent padding, resizes and encodes only; it does not draw art. The four sprites are also available in the habitat sticker pack. `pets/study-buddy/sprites.webp` is a new 512×512, four-column/four-row base atlas for the existing Classic Shiba: idle, rightward walking, hop, and curious peek poses. Leftward walking mirrors its walking row. It was generated from Glaze's existing study-buddy sticker as the sole identity reference.

Exact built-in generation prompts:

### shelf

Use case: stylized-concept. Asset type: transparent game furniture sprite for Glaze's student pet habitat. Primary request: a small wall-mounted wooden bookshelf, straight front view, with a thick pale oak horizontal shelf, two rounded brackets, no books or objects on top so a pet can stand on it. Style: original cozy rounded clay/enamel game art, calm muted mint and pale oak, cream highlights, a slate inner outline and subtle pale outer keyline. Simple chunky silhouette, readable at 96 pixels. Composition: one complete centered isolated shelf with generous transparent padding, horizontal shelf, no perspective tilt. Native transparent background. No text, no logo, no watermark, no backdrop or ground shadow.

### pet-bed

Use case: stylized-concept. Asset type: transparent game furniture sprite for Glaze's student pet habitat. Primary request: a cozy oval mint pet bed with a thick rounded rim and a soft lilac cushion, front three-quarter view, low enough that the pet can sleep on top. Style: original cozy rounded clay/enamel game art, calm muted mint/teal/lilac, cream highlights, a slate inner outline and subtle pale outer keyline. Simple chunky silhouette, readable at 64 pixels. Composition: one complete centered isolated item with generous transparent padding. Native transparent background. No pet or animal, no text, logo, watermark, backdrop, or ground shadow.

### kelp

Use case: stylized-concept. Asset type: transparent game furniture sprite for Glaze's student pet habitat. Primary request: a small aquarium planting of three curved mint and teal kelp fronds growing from two smooth cream pebbles, front view, compact upright silhouette. Style: original cozy rounded clay/enamel game art, calm muted mint/teal/lilac, cream highlights, a slate inner outline and subtle pale outer keyline. Simple chunky silhouette, readable at 64 pixels. Composition: one complete centered isolated item with generous transparent padding. Native transparent background. No pet or animal, no text, logo, watermark, backdrop, or ground shadow.

### sandcastle

Use case: stylized-concept. Asset type: transparent game furniture sprite for Glaze's student pet habitat. Primary request: a tiny friendly aquarium castle made of pale cream stone with two round towers, lilac roofs and one dark teal arched doorway, front view. Style: original cozy rounded clay/enamel game art, calm muted mint/teal/lilac, cream highlights, a slate inner outline and subtle pale outer keyline. Simple chunky silhouette, readable at 64 pixels. Composition: one complete centered isolated item with generous transparent padding. Native transparent background. No pet or animal, no text, logo, watermark, backdrop, or ground shadow.

### study-buddy base

Use case: stylized-concept. Asset type: a production animation sprite sheet for the ORIGINAL Glaze study buddy shown in the reference. Keep exactly this orange-and-cream Shiba puppy character, same markings, proportions, rounded clay/enamel shading, slate inner outline and pale outer keyline. Make ONE perfectly regular 4 column by 4 row sprite sheet, 16 square equal cells, on native transparent background. No gutters outside the equal grid, no dividing lines, labels or text. Each entire dog fits in its own cell with generous clear margins, equal scale, no overlap. Row 1: four seated idle frames front view: neutral, inhale, blink, neutral. Row 2: four walking RIGHT frames, clear right-facing side profile and alternating paws. Row 3: four hop frames: crouch, takeoff, airborne, land. Row 4: four peek and hide poses front view: curious head tilt left, curious head tilt right, paws up with happy eyes, return seated. Do not draw walls, furniture, objects, ground or shadows around characters. Feet of all grounded poses aligned close to each cell bottom. Preserve consistent character anatomy across all cells. Transparent background throughout.


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

## All-character reaction atlases (2026-10-17)

Every existing bundled character has a new native-alpha `pets/<id>/reactions.webp`: Ember, Luna, Mochi, Sprout, Pebble, Rime, Glaze, Cat, Bunny and Classic study buddy. Each512×768 sheet has24 generated frames in a4×6 grid: climbing, sleeping, playing, peeking, XP and level-up. These are additional local atlases; original base sheets retain their format. Full exact generation prompts, source paths, identity corrections and crop/packing evidence are recorded in [pet-reactions.md](pet-reactions.md). No account data or student content was used in generation.

## Pet toys (2026-10-17)

`stickers/habitat/toy-ball.webp` (11,330 bytes) and `stickers/habitat/yarn-ball.webp` (13,222 bytes) are original 256 × 256 transparent WebP sprites, generated with the built-in `image_gen` tool, inspected, then resized/padded and encoded without altering the illustrations. Both are under this repository's MIT license. Source PNGs remain in the generating session's Codex generated-images directory `01a14c48-0682-7972-8d9d-3b42788cbda7`, files `exec-d56d5f52-a5eb-489b-abb8-47a41f6a53f4.png` and `exec-d8e4cc6b-ac76-4689-93ea-59343540c78c.png`.

Exact ball prompt:

> Use case: stylized-concept. Asset type: transparent pet toy sprite for Glaze's cozy illustrated study pet habitat, viewed from front with a slightly top-down 3D feel. Primary request: one small round soft rubber toy ball, mint green and pale yellow curved panels, warm soft watercolor-gouache illustration with clean edges, subtle volume, cute and tactile, recognizable at 40 pixels. Single ball only, centered with generous transparent padding, no floor plane, no cast shadow outside object, no pet, no text, no watermark. Real transparent alpha background.

Exact yarn prompt:

> Use case: stylized-concept. Asset type: transparent pet toy sprite for Glaze's cozy illustrated study pet habitat, viewed from front with a slightly top-down 3D feel. Primary request: one small round lilac yarn ball, soft winding strands of wool, one short loose curl of yarn alongside it, warm soft watercolor-gouache illustration with clean edges, subtle volume, cute and tactile, recognizable at 40 pixels. Single yarn toy only, centered with generous transparent padding, no floor plane, no cast shadow outside object, no pet, no text, no watermark. Real transparent alpha background.
