# Pet animation API

`GZ_PET_SPRITES.picture(id, imported)` returns the local picture metadata used by the habitat, buddy widget, navigation badge and course-card pet. The built-in IDs are `ember`, `luna`, `mochi`, `sprout`, `pebble`, `rime`, `glaze`, `cat` and `bunny`. `picture('study-buddy')` returns the Classic buddy without adding a duplicate character choice.

## Renderer hooks

```js
const picture = GZ_PET_SPRITES.picture('ember');
const player = GZ_PET_PLAYER.mount(canvas, picture);
player.play('climbing');
player.play('look', GZ_PET_SPRITES.direction(dx, dy));
player.rest('sleeping');
player.sleep(); // Pause rendering while its host surface is hidden.
player.wake();
player.stop(); // Release the clock, observers, image callbacks and object URL.
```

`set(state, direction = 0)` preserves the current animation phase when its state and gaze are unchanged. `play(state, direction = 0)` also preserves looping poses, but explicitly restarts a repeated one-shot reaction. `rest(state)` sets the pose used after a one-shot finishes; `play('idle')` returns to that resting pose. `perching` always displays the base idle pose. Unknown states use idle. `look` uses a clockwise direction from 0 (up) through 15, with 4 right, 8 down and 12 left; imported v1 sheets use idle for gaze.

`GZ_WIDGETS_UI.avatar(body, options)` exposes `play(state, direction)`, `sleep()`, `wake()` and `stop()`. It retains the latest requested pose while its modules and picture load, and when its character changes. The widget's internal buddy renderer also exposes `update()`. A host should call `sleep()` when hidden and `stop()` when removed. These hooks animate pictures and do not award XP or change saved pet progress.

Active poses blend neighboring transparent sprite frames at up to 30 paints per second. State changes, gaze changes, reaction-atlas arrival and one-shot returns crossfade from the displayed pose over 180 ms. Rapid changes reuse one snapshot, and the first image displays immediately. Original frame intervals, imported frame counts and the still directional gaze contract are preserved. Idle loops stay at 8 paints per second or less; a held gaze stops painting after its transition.

Every renderer stops its clock when offscreen, explicitly sleeping, or in a hidden document. Reduced motion and Glaze Motion off display the base idle still. Removal, extension-context invalidation and page unload release listeners and image resources. A late image callback cannot restart a stopped player.

## Reaction atlas

Built-in picture metadata includes `reactions: 'assets/art/pets/<id>/reactions.webp'`. `GZ_PET_SPRITES.reactionPath(picture)` accepts only the matching shipped primary picture and reaction path. It rejects imported picture data and arbitrary metadata paths. The secondary image is loaded locally on the first reaction request. Missing, failed or incorrectly sized atlases use the compatible base pose.

Each transparent WebP is exactly **512 × 768**, containing **4 columns × 6 rows** of **128 × 128** cells. Frames run left to right. Square cells keep their aspect ratio and align with the bottom of the base canvas.

| Row | State | Frame interval | Behavior | Base-pose fallback |
| --- | --- | --- | --- | --- |
| 0 | `climbing` | 125 ms | Loop | `running` |
| 1 | `sleeping` | 500 ms | Loop | `waiting` |
| 2 | `playing` | 125 ms | Loop | `jumping` |
| 3 | `peeking` | 250 ms | Loop | `look` |
| 4 | `xp` | 125 ms | One pass, then resting pose | `waving` |
| 5 | `level-up` | 125 ms | One pass, then resting pose | `jumping` |

`swimming` uses the existing running pose, and `perching` uses idle. These aliases need no additional atlas rows. Direction affects gaze; reaction rows do not require directional frames.

## Compatibility and editor previews

`GZ_PET_SPRITES.STATES` and `frame()` retain their existing nine-row index contract: idle, running right, running left, waving, jumping, failed, waiting, running and review. V2 keeps its two additional gaze rows. The six reaction names are exported separately as `GZ_PET_SPRITES.REACTIONS`; they do not change imported frame counts or sprite versions.

Imported v1 and v2 PNG/WebP packages continue through the existing dimension, alpha, size and re-encoding checks. Import metadata cannot attach a reaction atlas or remote resource. Cat and Bunny retain their original two-row idle/action sheet, and Classic buddy retains its four-row sheet; each can use the same optional reaction atlas. No saved pet progress or package migration is needed.

The editor library's Animation selector includes the original nine states and all six reactions. Selecting a reaction on an imported pet previews its compatible fallback. Built-in previews and live surfaces use the same renderer.

## Local learning hooks

`GZ_PET_BRAIN` exports `VERSION`, `ACTIONS`, `FEATURES`, `vector`, `context`, `clean`, `choose`, `predict`, `observe`, `feedback`, `learn`, `needs`, `interact` and `describe`. It accepts dense legacy 12- and 24-feature vectors as well as the current 26-feature vector; migration preserves the first five action indices and prior weights/counts. Use `vector()` instead of constructing new vectors by hand.

```js
const context = GZ_PET_BRAIN.vector({
  needs, focus, pointerNear, hour, kind, wandering, water,
  idle, cursorSpeed, typing, scrolling, moved, celebrating, decor, returning,
});
const action = GZ_PET_BRAIN.choose(brain, context, availableActions, Math.random, { recent });
```

Needs are 0–100 values; idle is seconds (capped at 120), cursor speed is pixels/second (capped at 1,000), and other signals are booleans. `kind` distinguishes heading, card, bed, ball and yarn; `decor` identifies furniture. The first twelve features retain their original contract; the appended features are bond, curiosity, comfort, idle, speed, typing, scrolling, moved, celebrating, decor, bed, returning, ball and yarn.

Persist changes through the queued `glaze:pet` broker with the existing validated account key. `observe` takes an action/context, records bounded short-term credit and enforces an eight-second cadence across tabs. `interact` takes an explicit user event and optional current action/context; it adjusts needs and applies decaying feedback once to eligible recent decisions. Explicit current context refreshes its trace to full current credit. Focus, break and celebrate events are reserved for broker reconciliation: a `read` checks the shared timer state and settled XP, persists the consumed timer state, and applies each transition or gain once across documents. `wander` accepts the same optional action/context; `voluntary: true` distinguishes the pet's own return from a recall. Timestamps come from the broker, never page messages. `learn` accepts an explicit bounded reward for internal callers; normal UI uses interaction events. `learning: false` stops model use/update and discards pending traces; `forget` clears only the model. None of these operations award academic XP.

`GZ_PET_WORLD.mount(stage, { key, data, save, t })` owns behavior, geometry and toy physics. It dispatches `glaze:pet-intent` on its stage with a known action ID and coarse reason when an activity changes. `avatar(..., { interactive: false, resting: 'idle', attention: false })` keeps world-controlled one-shots from reverting to the widget's automatic focus pose. Toy furniture has `toy: true` in `GZ_PET.DECOR`; temporary page positions are runtime state, while saved habitat coordinates remain in the account record. Imported sprites use the same behavior hooks and compatible animation fallback poses.

Avatar pointer attention is enabled by default, including noninteractive card displays. It is throttled, limited to nearby visible pets, yields to reactions, and returns to idle after inactivity. Set `attention: false` when a host owns cursor tracking, as the pet world does. Pointer attention keeps no cursor history and does not itself train the model or award XP.

Wandering actors and toys use document coordinates inside one owned absolute layer. Each entity tracks its native scroll ancestors and applies their deltas immediately, including while sleeping or motion is reduced. Physics uses the corresponding content offset, so offscreen positions survive scrolling until awake recovery begins. Scroll ownership is transient geometry only and ignores unrelated sidebars and owned UI trays. Pointer events and gaze convert client coordinates at the boundary; saved habitat placements retain their normalized coordinates. Active targets stay attached through window and nested scrolling. Awake offscreen pets recover toward the visible page after a short delay; sleeping pets keep their position. New perches fit the visible height as well as width. Recovery selects positions within both the supporting ledge and the viewport; ledges with too little visible width use the floor fallback. Scroll events mark geometry dirty, with scans limited to one per 80 ms while movement is eligible. The return-home control remains reachable from the viewport.

Settings backups preserve saved needs timestamps until selection and compare model observations as well as feedback counts. The account’s bounded `restored` map carries only task IDs, completion timestamps, tick booleans and plan dates before/after an import; it temporarily substitutes the prior completion evidence until those imported source fields change. Task content still restores normally, and the pet baseline participates in the same rollback transaction.

`GZ_CTABS.petSurface(petKey)` supplies the currently owned, ready course frame and its document after validating the pet account against that document's confirmed course-tab account. Other frames and loading/snapshot surfaces return `null`. The top-level pet world converts child rectangles and pointer positions into its own page coordinates and binds only that document's pointer, typing and scroll events. Tab changes, document replacement and account revocation release that connection; child widgets remain disabled so there is one companion.
