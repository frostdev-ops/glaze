# Career-long pet habitats

Pet XP and equipment stay in the existing `pet:<school origin>/<student id>` record across courses and semesters. The original five level thresholds are unchanged. Later thresholds follow `600 + (level - 5) * 200 + (level - 5) * (level - 6) * 20`, with no final level. History holds up to 65,536 contribution records and 32,768 verified streak days; exceeding a bound preserves the stored record instead of resetting it.

Settings export/import now carries pet history, placements, needs and learned preferences. Import unions missing contributions and streak days, retains current settled contributions (including deliberate zeroes), and uses the existing rollback transaction. It preserves the more-trained model. Imported custom character image packages remain in the separate pet library and need importing on a new device. Accounts are isolated; importing a backup does not automatically link different school identities.

## Habitat and wandering

The room, moss garden, water tank and cloud loft share the same furniture. Drag items from the tray into the habitat, then drag them freely. Arrow keys move a focused item, Shift moves farther, and Delete/Backspace puts it away. The dropdown controls provide a non-drag alternative. Three independently placed shelf pieces support pets and falling items. Gravity, collisions, wall response, water drag and buoyancy use bounded time steps without a physics dependency.

Drag the pet outside to enable wandering and inside to return home. W and H perform the same mode changes; Return home remains accessible while wandering. A wandering pet survives closing its habitat window, follows the saved mode after page reload, and reacts to changes from another tab. Disabling the feature removes the companion. Hidden documents, offscreen habitats and reduced motion pause movement.

Wandering uses visible element geometry to approach cards/headings, climb edges, sit on top, and hide/peek behind cards. A mask occludes the part behind an element; page content and controls are never activated or edited. Perches track scrolling and disappear safely when their source element is removed. Forms, navigation, editable elements, assessments and tool pages are excluded.

## Local learning and needs

`lib/petbrain.js` implements a small online contextual bandit, with five behavior choices and twelve bounded inputs: bias, focus timer, pointer proximity, mood, playfulness, energy, sine/cosine time of day, heading/card context, wandering mode and water habitat. Each choice has a linear weight vector; a tanh prediction estimates welcomed behavior. Bounded gradient updates learn from positive play/petting and negative moved-away/recall signals. Limited exploration keeps it from repeating a single behavior. Target ranking also learns preferences for element types. Only recent decisions receive feedback.

Mood, playfulness and energy are shown as 0–100 meters. Interactions adjust them; time and a gentle daily energy rhythm return them toward comfortable baselines. Missing days never punish the pet or remove academic XP. The learning switch stops use/update of learned preferences. Reset learned behavior clears weights and counts without touching XP, equipment or needs. All model state stays in local pet storage and the student's own exported backup; no text entry or page content is training data.

The model is an online preference learner, not a language model or a cloud service. See [pet-animation-api.md](pet-animation-api.md) for renderer states, reaction atlas layout and compatible fallbacks.

## Local validation

The existing 2,075-test Node suite passes. Temporary assertions cover learned preference reversals across time/mode contexts, malformed/sparse input rejection, persisted interaction feedback, learning disabled/reset, independent academic XP, older-backup merging, rollback and career thresholds. Headless Chromium checks on controlled local school fixtures cover native item/pet dragging, keyboard placement, water, climbing, perching and scroll tracking, hide/peek masking, fold/unfold wake, cross-tab activation, reduced motion and cleanup. All ten delivered atlases play all six new states with distinct rendered pixels and no browser errors. The existing real-extension board checks also pass (42 Canvas checks and 185 Blackboard checks), including wide/mobile layouts and no page errors. These checks do not establish authenticated LMS or Safari verification, packaging, deployment or publication.

![New reaction art for every existing character](screenshots/pets/reactions.png)

![Pet perching on a course card, with habitat furniture and needs](screenshots/pets/perching.png)
