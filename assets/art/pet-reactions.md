# Pet reaction art provenance

Original new reaction art generated with built-in OpenAI image_gen on 2026-10-17, using only Glaze's own existing characters as references. Native alpha is preserved; delivery processing crops, resizes, places and encodes generated pixels. There are ten 512×768 atlases, each with24 frames: climbing, sleeping, playing, peeking, XP and level-up (four frames per state). Exact prompts, source masters and art-only validation follow. Runtime contract: [pet-animation-api.md](../../docs/pet-animation-api.md).

## Glaze forest pet reaction atlas provenance

Generated with built-in image_gen.imagegen on 2026-10-17, transparent_background=true. No API fallback. Character reference for each pet extracted with sharp from its existing spritesheet.webp first 192x208 frame and inspected with view_image before generation. Existing base sprite files were not changed.

### Outputs

| Pet | Output | Bytes |
| --- | --- | --- |
| Ember | /Users/jame/Projects/glaze/assets/art/pets/ember/reactions.webp | 233172 |
| Luna | /Users/jame/Projects/glaze/assets/art/pets/luna/reactions.webp | 236158 |
| Mochi | /Users/jame/Projects/glaze/assets/art/pets/mochi/reactions.webp | 183144 |

Every output is 512x768, lossless WebP, RGBA native alpha, 4 columns x 6 rows, 128x128 cells. Rows: climbing, sleeping, playing, peeking, xp, level-up. All 24 cells populated per pet. No cell-edge alpha crossings. Transparent pixel fractions: Ember 72.7763%, Luna 72.1413%, Mochi 76.3092%.

### Sources

- Ember: /Users/jame/.codex/generated_images/01a14c55-4271-78a3-8268-baf29c2b2a3a/exec-b7944b6c-6450-445c-b48c-fbd96bc8c6c0.png
- Luna: /Users/jame/.codex/generated_images/01a14c55-4271-78a3-8268-baf29c2b2a3a/exec-ef7e528b-5505-4f90-9ca7-6452a3870969.png
- Mochi initial: /Users/jame/.codex/generated_images/01a14c55-4271-78a3-8268-baf29c2b2a3a/exec-da243d79-27d6-4b26-b09f-09b50550fd2a.png
- Mochi selected cleanup: /Users/jame/.codex/generated_images/01a14c55-4271-78a3-8268-baf29c2b2a3a/exec-b865ecff-af50-4fbe-bfb8-7bc4658ceed5.png
- References: /tmp/glaze-{ember,luna,mochi}-reference.png

### Exact generation prompts

#### Ember

Use case: stylized-concept. Asset type: transparent plush mascot reaction sprite atlas. Input image is a character reference only: preserve Ember, this exact cute orange stuffed fox, cream cheek muzzle and fluffy chest, enormous brown eyes, tall dark-brown-tipped ears with cream interiors, four dark brown paws, bushy orange tail with large cream tip, realistic soft plush fabric and seams. Generate a NEW image with EXACTLY FOUR COLUMNS and SIX ROWS, 24 separate complete character poses, on a regular invisible grid. Canvas portrait 2:3, preferably 1024x1536. Every one of the 24 equal square cells contains exactly one whole fox, centered, same scale, generous transparent margins so no ears or tail touches cell edges. Read left to right within each row as four consecutive animation keyframes: Row 1 climbing: fox reaching upward with alternating front paws, upward clamber cycle, rear paws tucked; Row 2 sleeping: curled on side eyes closed, four subtly different slow breathing and sleepy blink poses; Row 3 playing: standing playful paw lift, body crouch, little bounce, tail wag; Row 4 peeking: curious fox slight left lean, upright inquisitive glance, slight right lean, upright gentle head tilt, full body always visible; Row 5 XP: small pleased smile, eyes brighten, small proud chest lift, happy relaxed pose; Row 6 level-up: crouch in anticipation, joyful small hop both paws raised, higher joyful hop, happy landing. Keep identical anatomy, face, markings, material and warm plush lighting across all frames. Baseline consistent except hop lift. Actual native alpha transparency across ALL empty space. No background, checkerboard, ground, drop shadows, scenery, props, text, numbers, labels, cell dividers, borders, sparkles or cut-off body parts.

#### Luna

Use case: stylized-concept. Asset type: transparent plush mascot reaction sprite atlas. Input image is a character reference only: preserve Luna, this exact cute round navy blue stuffed owl, deep blue plush head and wings, small pointed ear tufts, enormous amber orange eyes with black pupils encircled in large cream heartlike facial discs, tiny orange beak, cream oval belly, two orange feet, realistic soft stuffed plush fabric and subtle seams. Generate a NEW image with EXACTLY FOUR COLUMNS and SIX ROWS, 24 separate complete owl poses, on a regular invisible grid. Canvas portrait 2:3, preferably 1024x1536. Every one of the 24 equal square cells contains exactly one whole owl, centered, same scale, generous transparent margins so wing or ear tips cannot touch edges. Read left to right within each row as four consecutive animation keyframes: Row 1 climbing: owl reaching upward with alternating wings and small clambering orange feet, four upward clamber poses; Row 2 sleeping: curled squat owl eyes closed, four subtly different slow breathing and sleepy blink poses; Row 3 playing: playful wing lift, soft crouch, little bounce, delighted wing wag; Row 4 peeking: curious owl slight left lean, upright inquisitive glance, slight right lean, upright gentle head tilt, full body always visible; Row 5 XP: small pleased smile, eyes brighten, small proud belly lift, happy relaxed pose; Row 6 level-up: crouch in anticipation, joyful small hop both wings raised, higher joyful hop, happy landing. Keep identical anatomy, face, markings, material and soft plush lighting across all frames. Baseline consistent except hop lift. Actual native alpha transparency across ALL empty space. No background, checkerboard, ground, drop shadows, scenery, props, text, numbers, labels, cell dividers, borders, sparkles or cut-off body parts.

#### Mochi

Use case: stylized-concept. Asset type: transparent plush mascot reaction sprite atlas. Input image is a character reference only: preserve Mochi, this exact cute seated pale lavender stuffed kitten, round head, small pointed lavender ears with cream interiors, round tiny chocolate brown eyes, small brown embroidered nose and mouth, cream cheek muzzle and cream belly, tiny brown whisker strokes, four cream paws, stubby curved lavender tail with cream tip, realistic soft plush fabric and seams. Generate a NEW image with EXACTLY FOUR COLUMNS and SIX ROWS, 24 separate complete character poses, on a regular invisible grid. Canvas portrait 2:3, preferably 1024x1536. Every one of the 24 equal square cells contains exactly one whole kitten, centered, same scale, generous transparent margins so no ears or tail touches cell edges. Read left to right within each row as four consecutive animation keyframes: Row 1 climbing: kitten reaching upward with alternating front paws, upward clamber cycle, rear paws tucked; Row 2 sleeping: curled on side eyes closed, four subtly different slow breathing and sleepy blink poses; Row 3 playing: standing playful paw lift, body crouch, little bounce, tail wag; Row 4 peeking: curious kitten slight left lean, upright inquisitive glance, slight right lean, upright gentle head tilt, full body always visible; Row 5 XP: small pleased smile, eyes brighten, small proud chest lift, happy relaxed pose; Row 6 level-up: crouch in anticipation, joyful small hop both paws raised, higher joyful hop, happy landing. Keep identical anatomy, face, markings, material and soft plush lighting across all frames. Baseline consistent except hop lift. Actual native alpha transparency across ALL empty space. No background, checkerboard, ground, drop shadows, scenery, props, text, numbers, labels, cell dividers, borders, sparkles or cut-off body parts.

#### Mochi targeted cleanup

Use case: precise-object-edit. Edit this transparent 4-column by 6-row plush lavender kitten animation atlas. Remove ONLY the two small brown curved motion lines floating just above the tail of the kitten in row 3 column 4 (the rightmost playing kitten). Replace the removed marks with fully transparent pixels. Preserve all 24 kitten characters, every pose, size, placement, color, fine plush detail, all other alpha edges, the canvas dimensions and transparent background exactly. Add nothing.

### Delivery processing and checks

Source generated poses have slightly irregular row spacing, so used alpha-connected main-character bounding boxes (alpha >=50; connected regions >1000 pixels), grouped into six rows of four and sorted left-to-right. Cropped each character bounding box plus two source pixels, uniformly downscaled all crops to 36%, centered each in a 128x128 cell with baseline y=116. Playing frame 3 lifted 6 pixels; level-up frames 2 and 3 lifted 5 and 10 pixels. Packed without drawing or recoloring generated artwork, encoded lossless WebP. Original source native alpha retained. No alpha threshold modification or background color removal used.

Scripts: /tmp/glaze-forest-process.cjs (component discovery), /tmp/glaze-forest-pack.cjs (crop, resize, pack, assertions).
Machine reports: /tmp/glaze-{ember,luna,mochi}-reaction-validation.json.
Rendered alpha-composited previews: /tmp/glaze-{ember,luna,mochi}-reactions-preview.png.

Visual checks: all original references, all three initial source grids, Mochi cleanup grid, and all three final atlases composited on dark blue have been viewed. Character appearance, six requested row meanings, full-body visibility, generous margins, no cell dividers/scenery/text, and clean transparent silhouettes verified. Mochi initial had two floating motion strokes by the playing tail; selected targeted cleanup removed them.

Automated assertions: exactly 512x768 RGBA; all 24 cells alpha>50 area >2000 pixels; every cell boundary fully transparent. Final output bytes recorded above.

No runtime/browser playback checked in this art-only subtask. No commits created.



## Sprout, Pebble, Rime reaction atlas provenance

Generated with built-in image_gen tool; transparent_background=true for every call. No API/CLI fallback. Character references extracted from each existing assets/art/pets/<pet>/spritesheet.webp first frame (left0 top0 width192 height208) with Sharp, then inspected with view_image before generation.

### Delivery

- assets/art/pets/sprout/reactions.webp: 512x768, lossless WebP, native alpha, 261948 bytes, SHA256 7b018e879d7615344e6573c092f5596b53f1b21d979e15babec5af13325cdafa
- assets/art/pets/pebble/reactions.webp: 512x768, lossless WebP, native alpha, 263090 bytes, SHA256 c0d940cd07f957543df302b55c5c17de4f2f64607173035505a5b2f469a8785e
- assets/art/pets/rime/reactions.webp: 512x768, lossless WebP, native alpha, 246492 bytes, SHA256 893fa7a96010ad99e142e66e4b440368f0bb49545dfb2ac678372f75243c04e5

All delivery atlases: 4 columns x6 rows, 128-square cells. Rows climbing, sleeping, playing, peeking, xp, level-up. Each contains 24 populated cells. Native alpha min0 max255. All cells have >1000 pixels with alpha>16 and no visible pixels in outer3pixel borders. Full sources and dark-background final previews visually inspected, character identities checked; Rime retains white fox, blue inner ears, navy vest, cyan square pendant, white tail.

Delivery processing: /tmp/glaze-frost-atlas.js uses source alpha connected components only to locate full sprite crop rectangles. Crops include3pixels padding, then each crop resized (uniform scaling with .42 maximum and112px per-axis cap) and centered in a regular128px cell, baseline116px except jump poses lifted9px. Source alpha preserved. Only crop, resize, placement and lossless encoding; no programmatic redrawing, recoloring or background removal. Source irregular spacing corrected by per-sprite crop placement. Existing base spritesheet files unchanged.

QA artifacts: /tmp/glaze-<pet>-reactions-preview.png, /tmp/glaze-<pet>-reactions-check.json. Runtime/UI playback not checked by art worker.

### Sprout initial

Reference path(s): /tmp/glaze-sprout-reference.png

Generated source: /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-c86b47a0-13f6-47a0-b135-b3a9f6ba67c1.png

Discarded: two sprites touched vertically.

Exact prompt:

```text
Use case: stylized-concept
Asset type: production transparent animation spritesheet for a small desktop pet.
Primary request: Create ONE regular 4-column by 6-row atlas, exactly 24 full-character poses, based faithfully on the character reference. Canvas portrait 2:3 aspect ratio, ideally 1024x1536, evenly divided into 24 identical square cells. Each row is a coherent four-frame animation read left to right. Native transparent alpha background everywhere outside the character.
Input image 1 is a CHARACTER REFERENCE, not an edit target: preserve Sprout's soft plush sage-green baby dragon, tiny cream horns, glossy dark eyes, cream segmented belly, little bat wings, rounded feet, small tail, warm fuzzy fabric texture. Preserve its proportions, colors and friendly toy appearance.
Rows top to bottom:
1 climbing: reaching both arms upward, left arm pulls and right foot lifts, right arm pulls and left foot lifts, upward clamber return. Complete body, no ladder or wall.
2 sleeping: curled resting sideways with wings folded, eyes closing, asleep gentle breathing in, asleep breathing out. Keep full recognizable dragon.
3 playing: happy crouch, playful left lean with paw lifted, bouncy upright pose, playful right lean with wing/tail wag.
4 peeking: curious left lean, curious centered rise, curious right lean, shy small duck with eyes visible. Complete character in every cell, no objects hiding it.
5 xp: content upright, pleased eyes and slight arm lift, bright pleased little bounce, satisfied settling pose.
6 level-up: excited anticipation crouch, big happy rising hop arms up, airborne joyous spread wings, happy landing.
Composition constraints: EXACTLY four equal-width columns and six equal-height rows filling the canvas uniformly, no outer header, labels, borders, grid marks or gutters that alter cell pitch. Every square cell must contain one complete isolated dragon centered horizontally, with all horns wings feet and tail inside its own cell and generous transparent margins. Consistent character scale, use roughly 72% of cell width and 76% of cell height; body baseline at 88% cell height except jump frames. Clean readable coherent animation poses, no overlap across cells. Transparent background, no text, no letters, no numbers, no scenery, no floor, no drop shadow, no white rectangles, no checkerboard painted into image.
```

### Sprout accepted layout correction

Reference path(s): /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-c86b47a0-13f6-47a0-b135-b3a9f6ba67c1.png

Generated source: /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-9f572c71-9465-4db9-b9a8-6df9f45d66fc.png

Accepted source: 24 separate sprites.

Exact prompt:

```text
Use case: precise-object-edit. Edit target: the attached transparent 24-pose sage plush dragon reaction atlas. Keep all 24 character poses, row ordering, sage green plush texture, cream horns and segmented belly, wings, feet, tail, expressions, and real transparent alpha. Change ONLY layout and scale: shrink every sprite to 80 percent of its current size, then center each sprite in its own exact equal square cell on a 4-column 6-row regular grid. Canvas1024x1536, cells256x256. Each whole character must have at least24pixels of transparent margin from every cell boundary. Preserve all horns, wings, feet, tails. In particular the second-column character in row5 and second-column character in row6 must be fully separate with at least30transparentpixels between them. No touching or overlaps anywhere. Baseline at y224 inside each cell except jumps, which can float. Each row stays exactly: climbing,sleeping,playing,peeking,xp,level-up. Do not add anything. No text, borders, grid lines, background, shadows, new objects, or checkerboard pixels. Actual transparent alpha.
```

### Pebble accepted

Reference path(s): /tmp/glaze-pebble-reference.png

Generated source: /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-254c5b67-8c9e-49fa-9e7f-f46dc4ba363e.png

Accepted source: 24 separate sprites.

Exact prompt:

```text
Use case: stylized-concept
Asset type: production transparent animation spritesheet for a small desktop pet.
Primary request: Create ONE regular 4-column by 6-row atlas, exactly 24 full-character poses, based faithfully on the character reference. Canvas portrait 2:3 aspect ratio, ideally 1024x1536, evenly divided into 24 identical square cells. Each row is a coherent four-frame animation read left to right. Native transparent alpha background everywhere outside the character.
Input image 1 is a CHARACTER REFERENCE, not an edit target: preserve Pebble's cute plush brown capybara: chunky quadruped body, round small ears, warm caramel fuzzy fabric, pale tan large oval muzzle, small glossy black eyes, short broad feet with subtle dark toes, very short tail. Keep capybara anatomy and identity, no accessories.
Rows top to bottom:
1 climbing: front paws reaching upward, left forepaw pulls with rear leg lifted, right forepaw pulls with opposite rear leg lifted, upward clamber return. Complete body visible, no ladder or wall.
2 sleeping: curled resting sideways, eyes closing, asleep gentle breathing in, asleep breathing out.
3 playing: happy crouch, playful forepaw stretch, bouncy happy trot pose, playful side lean.
4 peeking: curious left lean, curious raised head, curious right lean, shy low duck with eyes visible. Complete body in every cell, no occluding objects.
5 xp: content standing, pleased eyes and small forepaw lift, bright pleased little bounce, satisfied settled stance.
6 level-up: excited anticipation crouch, big happy rising hop, airborne joyous short-legged pose, happy landing.
Composition constraints: EXACTLY four equal-width columns and six equal-height rows filling canvas uniformly. Each pose confined to its own equal square cell. No outer header, labels, borders, grid marks or gutters that alter cell pitch. Every cell contains one complete capybara centered horizontally, ears paws and body all inside own cell with generous transparent margins. Consistent scale across all frames, roughly72% cell width and76%cell height; feet baseline88%cell height except jumps. Clean readable coherent animation. Transparent background, no text, no letters, no numbers, no scenery, no floor or shadow, no white rectangles, no painted checkerboard.
```

### Rime initial

Reference path(s): /tmp/glaze-rime-reference.png

Generated source: /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-25e27f9a-41a4-4999-a9c2-1e2d15258573.png

Discarded: incorrect blue tail tips.

Exact prompt:

```text
Use case: stylized-concept
Asset type: production transparent animation spritesheet for a small desktop pet.
Primary request: Create ONE regular 4-column by 6-row atlas, exactly 24 full-character poses faithfully based on the reference. Portrait canvas2:3 aspect ratio ideally1024x1536, uniformly divided into 24 identical square cells. Each row is a four-frame animation left to right. Genuine native transparent alpha background.
Input image1 CHARACTER REFERENCE: preserve Rime EXACTLY as the fluffy white baby arctic fox shown, large triangular ears with bright blue inner ears, large glossy navy-blue eyes, small black nose, white fluffy tail, little white paws, navy blue open sleeveless vest, small cyan luminous square clasp/pendant at chest. Same soft 3D plush toy look, anatomy and costume. This is a fox, NOT a dragon/cat/dog. Keep blue ears and vest in every pose; keep the pendant visible whenever chest faces forward.
Rows top to bottom:
1 climbing: both paws reach upward, left paw pulls and right foot lifts, right paw pulls and left foot lifts, upward clamber return. Entire body, no wall or ladder.
2 sleeping: curled sideways resting with tail tucked, eyes closing, peaceful breathing in, peaceful breathing out.
3 playing: happy low play bow, playful left paw wave, little bouncy upright pose, playful right lean and tail wag.
4 peeking: curious left lean with ears perked, curious centered rise, curious right lean, shy small duck. Entire fox visible in each cell without any hiding objects.
5 xp: calm happy upright, pleased eyes with slight arm lift, bright pleased tiny bounce, satisfied settled pose.
6 level-up: excited crouch anticipation, big happy rising hop with both paws up, airborne joyous pose and spreading paws, happy landing.
Constraints: EXACTLY4equal-widthcolumns and6equal-heightrows, uniformly spaced. Each cell has one whole fox centered horizontally, fully contained with generous transparent margins. Same character scale and anatomy, roughly72%cell width and76%cell height, grounded baseline88%cell height except jumps. No cell overlap. Preserve every key identity detail from reference. No text, letters, numbers, labels, borders, grid lines, floor, scenery, backdrop, shadow, white rectangles, or checkerboard drawn into the image. Only isolated fox sprites on actual transparent alpha.
```

### Rime accepted identity correction

Reference path(s): /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-25e27f9a-41a4-4999-a9c2-1e2d15258573.png and /tmp/glaze-rime-reference.png

Generated source: /Users/jame/.codex/generated_images/01a14c55-57a4-77a1-88c2-2b62973aa409/exec-9ab35f38-78ca-42c7-b060-07a3ca036d7e.png

Accepted source: 24 separate sprites, all-white tails restored.

Exact prompt:

```text
Use case: precise-object-edit. Input image1 is the edit target reaction atlas. Input image2 is the original character identity reference. Keep the atlas's 24 distinct poses and exact6row order and4column arrangement. Preserve navy vest, cyan square pendant, blue inner ears, glossy blue eyes, fluffy white arctic fox face and physique. Change ONLY the incorrectly blue tail tips: EVERY tail must be entirely WHITE fur like the original character reference, with soft cool shading but absolutely no blue color patches on tails. The blue color belongs only inside the ears and cyan pendant. Preserve real transparent alpha. Also shrink sprites as needed so every complete fox, including ears paws and tail, has at least20transparent pixels from its own256x256cell boundaries on the1024x1536canvas. No text, labels, grid, shadows, background, scenery or new objects. Row order climbing,sleeping,playing,peeking,xp,level-up.
```




## Classic pet reaction atlas provenance

Built-in image_gen tool only, transparent_background=true; no API fallback. Generated 2026-10-17.

All outputs are 512x768 native-alpha WebP, 4 columns x 6 rows, 128px cells. Row order: climbing, sleeping, playing, peeking, XP, level-up. Each source is a 1024x1536 grid. Deterministic sharp processing extracts transparent character bounds per source cell, preserves source native alpha, resizes uniformly per character, and packs into exact cells. The first row source band extends to y296 to retain climbing feet, with clear gaps before the sleeping row. Cat uses y1250 as its final row boundary to retain the hopping ear without leaking it into the XP row. Bounds use source alpha >8 plus 2px padding; scale is uniform within each pet (0.44, bounded to 116px maximum dimension). No programmatic artwork redraw.

### glaze

Reference: /tmp/glaze-ref-glaze.png (first frame of existing base sheet).
Final source: /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-7fe88846-c9c3-4091-8c20-dad8dba02f1c.png
Final output: /Users/jame/Projects/glaze/assets/art/pets/glaze/reactions.webp
Bytes: 93254
Validation: 24/24 occupied cells, all cell edges alpha zero, 279641/393216 exactly transparent pixels. Source and white-composited final visually inspected.

Exact accepted prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact shiny cyan teardrop water mascot shown: pointy teardrop head/body, large dark oval eyes with white glints, tiny smile, two short rounded cyan arms and two feet. Climbing is droplet clamber/stretch with alternating hands; sleeping squashed with closed eyes.
CRITICAL GRID GEOMETRY: output 1024x1536. There are six exact 256px-high horizontal bands and four exact 256px-wide columns. In EACH cell, draw the character only inside the centered 190x190px box; leave a fully transparent gutter at least 33px on ALL four sides. Never let ears, feet or tail cross a cell boundary. Use smaller sprites than the supplied example; blank transparent space is required. Every action including climbing and hopping stays wholly within its own 256x256 cell. This exact geometry is essential for a game sprite animation; no frame may overlap another frame.
```

Initial source (discarded because tight grid placement): /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-6dc6f0de-71b9-4e41-81d1-80dcc9061e6d.png
Initial exact prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact shiny cyan teardrop water mascot shown: pointy teardrop head/body, large dark oval eyes with white glints, tiny smile, two short rounded cyan arms and two feet. Climbing is droplet clamber/stretch with alternating hands; sleeping squashed with closed eyes.
```

### cat

Reference: /tmp/glaze-ref-cat.png (first frame of existing base sheet).
Final source: /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-20fdca36-6601-48a3-a734-d8e48c3f25c9.png
Final output: /Users/jame/Projects/glaze/assets/art/pets/cat/reactions.webp
Bytes: 117720
Validation: 24/24 occupied cells, all cell edges alpha zero, 266571/393216 exactly transparent pixels. Source and white-composited final visually inspected.

Exact accepted prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact small soft lavender-gray kitten shown: mint-green eyes, pink inner ears/nose, fluffy pale chest, four legs and one fluffy curled tail. Preserve painterly plush illustration and thin soft outline. Sleeping is curled kitten, playing paws and tail, climbing alternating forepaws. Exactly four legs.
CRITICAL GRID GEOMETRY: output 1024x1536. There are six exact 256px-high horizontal bands and four exact 256px-wide columns. In EACH cell, draw the character only inside the centered 190x190px box; leave a fully transparent gutter at least 33px on ALL four sides. Never let ears, feet or tail cross a cell boundary. Use smaller sprites than the supplied example; blank transparent space is required. Every action including climbing and hopping stays wholly within its own 256x256 cell. This exact geometry is essential for a game sprite animation; no frame may overlap another frame.
```

Initial source (discarded because tight grid placement): /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-0feac953-a9f6-4245-b955-91be39e4d3a5.png
Initial exact prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact small soft lavender-gray kitten shown: mint-green eyes, pink inner ears/nose, fluffy pale chest, four legs and one fluffy curled tail. Preserve painterly plush illustration and thin soft outline. Sleeping is curled kitten, playing paws and tail, climbing alternating forepaws. Exactly four legs.
```

### bunny

Reference: /tmp/glaze-ref-bunny.png (first frame of existing base sheet).
Final source: /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-8aed4579-3b7c-4c64-867b-8478de69ed88.png
Final output: /Users/jame/Projects/glaze/assets/art/pets/bunny/reactions.webp
Bytes: 92624
Validation: 24/24 occupied cells, all cell edges alpha zero, 294440/393216 exactly transparent pixels. Source and white-composited final visually inspected.

Exact accepted prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact small pale mint-white rabbit shown: two long upright pink-inner ears, dark round eyes, tiny dark nose and mouth, rounded body and paws. Preserve soft shaded outlined illustration. Exactly two ears, four paws, one small rabbit tail. Sleeping ears relaxed.
CRITICAL GRID GEOMETRY: output 1024x1536. There are six exact 256px-high horizontal bands and four exact 256px-wide columns. In EACH cell, draw the character only inside the centered 190x190px box; leave a fully transparent gutter at least 33px on ALL four sides. Never let ears, feet or tail cross a cell boundary. Use smaller sprites than the supplied example; blank transparent space is required. Every action including climbing and hopping stays wholly within its own 256x256 cell. This exact geometry is essential for a game sprite animation; no frame may overlap another frame.
```

Initial source (discarded because tight grid placement): /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-dab3093c-0d66-4c0b-93d5-19e5532550e1.png
Initial exact prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact small pale mint-white rabbit shown: two long upright pink-inner ears, dark round eyes, tiny dark nose and mouth, rounded body and paws. Preserve soft shaded outlined illustration. Exactly two ears, four paws, one small rabbit tail. Sleeping ears relaxed.
```

### study-buddy

Reference: /tmp/glaze-ref-study-buddy.png (first frame of existing base sheet).
Final source: /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-36a523fd-c313-428b-b5df-5978109a62e4.png
Final output: /Users/jame/Projects/glaze/assets/art/pets/study-buddy/reactions.webp
Bytes: 115034
Validation: 24/24 occupied cells, all cell edges alpha zero, 273203/393216 exactly transparent pixels. Source and white-composited final visually inspected.

Exact accepted prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact cheerful orange-and-cream Shiba puppy shown: triangular orange ears with pale inner ears, black oval eyes/nose, cream round muzzle and belly/chest/paws, tiny smile and orange fluffy curled tail. Preserve plush softly shaded outlined illustration. Exactly four legs and one tail. Sleeping curled puppy, playing paws and wag.
CRITICAL GRID GEOMETRY: output 1024x1536. There are six exact 256px-high horizontal bands and four exact 256px-wide columns. In EACH cell, draw the character only inside the centered 190x190px box; leave a fully transparent gutter at least 33px on ALL four sides. Never let ears, feet or tail cross a cell boundary. Use smaller sprites than the supplied example; blank transparent space is required. Every action including climbing and hopping stays wholly within its own 256x256 cell. This exact geometry is essential for a game sprite animation; no frame may overlap another frame.
```

Initial source (discarded because tight grid placement): /Users/jame/.codex/generated_images/01a14c55-6bce-7780-9eaa-573ac54bcb45/exec-7c1831cc-419a-47d3-a2cc-20cb3b142810.png
Initial exact prompt:
```text
Use case: stylized-concept. Asset type: transparent game pet reaction sprite atlas. Use the attached image ONLY as character identity and illustration-style reference. Create NEW poses/animation frames of this exact character. Portrait atlas exactly 4 columns and 6 rows of equal square cells, regular 4x6 grid, 24 frames total. Canvas aspect ratio 2:3, ideally 1024x1536, transparent native alpha. Every cell contains exactly one complete character with generous transparent margins, consistent scale and baseline except jumping. No gridlines, cell borders, labels, text, scenery, background, props or extra characters. Read left to right within each row; show four smooth sequential frames of each action. Row1 climbing: clambering upward cycle, limbs alternate. Row2 sleeping: curled or tucked asleep, eyes closed, slight breathing cycle. Row3 playing: playful bounce with limb movement. Row4 peeking: curious sideward leaning and returning, eyes curious. Row5 XP: small pleased happy reaction, subtle squash and smile. Row6 level-up: large joyful celebratory hop, raised limbs then landing. Keep original anatomy/colors/material/face, do not add limbs, clothing, accessories, sparkle particles, or redesign the character. Each 4-frame row is a coherent loop, with visibly different poses. Character is the exact cheerful orange-and-cream Shiba puppy shown: triangular orange ears with pale inner ears, black oval eyes/nose, cream round muzzle and belly/chest/paws, tiny smile and orange fluffy curled tail. Preserve plush softly shaded outlined illustration. Exactly four legs and one tail. Sleeping curled puppy, playing paws and wag.
```

No existing base sheets, code or commits changed. Runtime playback review belongs to the integrating parent agent.
