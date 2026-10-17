# Widgets made of blocks

Widgets made of blocks need Glaze 3.0.4 or newer.

A widget with no code is a mod whose `mod.json` lists **blocks**. Glaze draws it itself, from the blocks and the data it
already has on the student's device, on Chrome, Firefox and Safari alike. Nothing the mod supplies ever runs, so it needs
no sandbox and has no way to send anything anywhere. Students make these in the editor (Mods → Widget builder) and share
them as signed `.glazemod` files like any mod; this page is the format underneath.

## In mod.json

Blocks go on a tile or a rail (navigation) widget. The two may share the same blocks. A widget made of blocks has no
`hooks`, no `file` on any slot, and asks for exactly the permissions its blocks use, each with a reason.

```json
{
  "glaze": 1,
  "name": "Due soon",
  "version": "1.0.0",
  "author": { "name": "Kai", "key": "<author key>" },
  "permissions": [{ "id": "todo", "why": "Shows what is due next." }],
  "ui": {
    "tiles": [{ "id": "main", "name": "Due soon", "sizes": ["m"], "blocks": [
      { "type": "text", "text": "Next: {next.title}", "size": "l" },
      { "type": "countdown", "to": "next.due", "label": "Due in" },
      { "type": "list", "items": "todo.items", "max": 3 },
      { "type": "button", "label": "Open it", "action": "next" }
    ] }]
  }
}
```

`mod.json` must come out of the cleaner unchanged (`GZ_MODWIDGET.blocks`): an unknown key, a wrong type, or a value over
its limit refuses the whole bundle, and nothing is trimmed. Between 1 and 12 blocks.

## Blocks

| type | keys (required first) | notes |
|---|---|---|
| `text` | `text`; `size` `weight` `color` `muted` | up to 200 characters, `{path}` holes; `{{` and `}}` write a brace |
| `number` | `value`; `label` `unit` `digits` `size` `color` | `value` is a number path or a number written in |
| `ring` | `value`; `max` `label` `color` | `max` defaults to 100; a ring with a non-positive maximum is left out |
| `list` | `items`; `max` (1 to 10, default 5) `ordered` `label` `empty` | `items` is a list path; `empty` is said when there are none |
| `countdown` | `to`; `label` `done` | `to` is a time path or milliseconds since 1970 |
| `image` | `src` `alt`; `w` `h` `fit` | `src` is a picture file in the bundle (png, jpg, gif, webp, avif) |
| `button` | `label` `action`; `tone` | `action` is one of Glaze's own, below |

Colors are palette names (`accent`, `ok`, `warn`, `err`, `ink-muted`, …) or `#rrggbb`. Text is only ever set as text:
markup in a block is shown as the characters it is.

## Data paths

Each path needs the permission shown; the mod declares it with a reason, and the student grants it. Without the grant the
block's data is not read at all and the block is left out. Data is this site's only, read on this device from what Glaze
has already fetched (the planner, Insights, the courses it has seen).

| path | kind | permission | what it is |
|---|---|---|---|
| `next.title` `next.course` `next.due` | text, text, time | `todo` | the soonest open to-do due from now on |
| `todo.count` `todo.overdue` `todo.today` | number | `todo` | open to-dos; past due; due today (this device's day) |
| `todo.done` `todo.total` | number | `todo` | done or handed in; all that Glaze has |
| `todo.items` | list | `todo` | open to-dos, soonest first, with course and time |
| `schedule.today` | list | `todo` | today's to-dos by time (a finished one is marked) |
| `grades.gpa` | number | `grades` | grade points on the 4.0 scale, courses weighted equally |
| `grades.average` | number | `grades` | the average of the courses' percent |
| `grades.courses` | list | `grades` | `Course: 91%` for each course Insights has graded |
| `courses.count` `courses.names` | number, list | `courses` | the courses Glaze has seen |

The page asks for a widget's tree again when its data changes, when the page is shown again, and at the time its answer
changes by itself (the next due time, midnight).

## Buttons

`action` is one of `next` (the next to-do's own page), `course` (its course), `dashboard`, `courses`, `grades` or
`calendar`. Each goes to a page of the LMS the student is on, never to an address the mod chose; `next` and `course`
need the `todo` permission and are off when there is no next to-do.
