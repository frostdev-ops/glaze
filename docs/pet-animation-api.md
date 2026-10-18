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

`play(state, direction = 0)` and the existing `set(state, direction = 0)` are aliases. Calling either starts the requested animation from its first frame. `rest(state)` sets the pose used after a one-shot finishes; `play('idle')` returns to that resting pose. `perching` always displays the base idle pose. Unknown states use idle. `look` uses a clockwise direction from 0 (up) through 15, with 4 right, 8 down and 12 left; imported v1 sheets use idle for gaze.

`GZ_WIDGETS_UI.avatar(body, options)` exposes `play(state, direction)`, `sleep()`, `wake()` and `stop()`. It retains the latest requested pose while its modules and picture load, and when its character changes. The widget's internal buddy renderer also exposes `update()`. A host should call `sleep()` when hidden and `stop()` when removed. These hooks animate pictures and do not award XP or change saved pet progress.

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
