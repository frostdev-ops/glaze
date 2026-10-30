# Agents

AI apps on your computer, like Claude Desktop, Claude Code, Cursor and VS Code, can use Glaze over MCP: your courses,
to-dos and schedule, grades, assignments and rubrics, and Writer documents. Agent access is off by default. You allow
each app and each kind of data in a Glaze window, and every change waits for your OK there. Glaze never submits work.

## Turn it on

1. Get the helper (below).
2. In Glaze, open **Settings → AI → Agents** and turn on the switch. On Chrome, Edge and the other Chromium browsers,
   the browser asks to let Glaze start the helper. Firefox asks for that and for sharing website content, in one prompt.
3. Connect your app (below).
4. Ask it something, like "what's due this week?". Glaze opens its window: allow the app.

The first time in Chrome, Settings shows **Starting…** for up to a minute, until Chrome restarts Glaze's background
worker.

## The helper

Apps reach Glaze through a helper program on the same computer. It opens no network connections and keeps nothing of
what passes through it.

- **npm:** `npx glaze-mcp setup`, with Node.js 18 or later. Its version follows Glaze's. It sets up every supported
  browser it finds; run it again after installing another. `npx glaze-mcp uninstall` removes it. Details:
  [glaze-mcp](../mcp/README.md).
- **Claude Desktop:** the bundle `glaze-mcp-<version>.mcpb`, attached to each
  [GitHub release](https://github.com/frostdev-ops/glaze/releases/latest) next to the Mac app, and linked from
  [frostdev.io/glaze](https://frostdev.io/glaze); for Glaze 4.0.0,
  [glaze-mcp-4.0.0.mcpb](https://github.com/frostdev-ops/glaze/releases/download/v4.0.0/glaze-mcp-4.0.0.mcpb). Open it
  with Claude Desktop. It sets your browsers up each time Claude starts it. Browsers start the helper with a Node.js 18
  or later installed on this computer, not Claude's own.
- **Safari:** the downloaded Glaze Mac app, from the
  [GitHub release](https://github.com/frostdev-ops/glaze/releases/latest) or [frostdev.io/glaze](https://frostdev.io/glaze),
  is Safari's helper and starts by itself. The Mac App Store app has no agent access. Apps still connect with
  `npx -y glaze-mcp` or the Claude Desktop bundle.

## Connect an app

- **Claude Desktop:** open the `.mcpb`. Its **Browser** setting chooses the browser.
- **Claude Code:**

  ```sh
  claude mcp add --scope user glaze -- npx -y glaze-mcp
  ```

- **Cursor:** in `~/.cursor/mcp.json`:

  ```json
  { "mcpServers": { "glaze": { "command": "npx", "args": ["-y", "glaze-mcp"] } } }
  ```

- **VS Code:**

  ```sh
  code --add-mcp '{"name":"glaze","type":"stdio","command":"npx","args":["-y","glaze-mcp"]}'
  ```

- **Other MCP apps:** a stdio server with the command `npx` and the arguments `-y glaze-mcp`.

`npx -y glaze-mcp` connects to the browser that started its helper last. Add `--browser <id>` to choose one: `chrome`,
`edge`, `brave`, `vivaldi`, `arc`, `chromium`, `firefox` or `safari`.

## What apps can use

| Group | Reads | Changes |
|---|---|---|
| Courses, to-dos and schedule | `accounts_list`, `courses_list`, `todo_list`, `schedule_list` | `todo_mark_done` |
| Grades | `grades_list`, `course_grades` | |
| Assignments and rubrics | `assignments_list`, `assignment_read` | |
| Writer documents | `documents_list`, `document_read`, `document_sources`, `document_assignment`, `document_issues` | `citation_insert`, `fix_apply` |
| The mod *name* | that mod's tools | |

- School data comes from what Glaze already read from your Canvas or Blackboard Ultra site, with when it read it. With
  that account's school site open in this browser, Glaze reads it again there first, at most once a minute.
- `assignment_read` reads an assignment's instructions, attached file names and rubric in that open tab, never your
  scores or feedback. With no tab open it answers with the last read, dated.
- `todo_mark_done` marks Glaze's own list. With **Tick off in Canvas too** on, it marks your Canvas planner through the
  open Canvas tab.
- `document_issues`, `citation_insert` and `fix_apply` need the document open in Writer.
- With more than one school account, the app names which one.

## The approval window

One Glaze window holds every request waiting for you and shows the oldest, with or without a school page open. It names
the app as the app reports itself, and the program that started it. **Don't allow** has the focus first.

- An app's first request asks to pair it; **Allow** also gives it the group that request needs.
- A request for another group asks for that group.
- A change shows Glaze's own sentence for it, from Glaze's data, never the app's words.
- Closing the window counts as **Don't allow**. For a pairing or a group, Glaze remembers it and doesn't ask again.
- With no answer in 10 minutes, nothing is done, and Glaze asks again next time.
- An app can have 5 requests waiting at once, 20 across all apps; more are refused as Busy.

## Apps, groups and Revoke

**Settings → AI → Agents → Apps** has a card for each app: its name, its program, when it was paired and last used,
and a switch for each group. Each installed mod with tools is a group of its own.

- A group turned off is asked for again at the app's next request for it.
- **Revoke** forgets the app; its next request asks to pair again.
- An app you declined shows **Declined** and **Forget**, which lets Glaze ask again.
- **Forget all apps** forgets every app, its groups and declines, and the assignment reads Glaze kept for apps.

Turning the switch off ends every connection, declines waiting requests, clears the kept assignment reads and gives
back the browser permissions. The apps and their groups stay for when you turn it on again.

## Activity

**Activity** lists the last 200 calls, newest first: the tool, the app, when, and how it ended (Done, Failed, Declined,
Timed out, Interrupted, Refused, Busy or Cancelled), never what was asked or answered.

## Troubleshooting

Settings → AI → Agents shows the helper's state, with **Copy** for a command.

| Settings says | |
|---|---|
| Ready | Connected. |
| Starting… | Wait; the first time in Chrome, up to a minute. |
| Allow Glaze to start the helper | Press **Allow**. |
| In Claude Desktop, add the Glaze extension. For other apps, run `npx glaze-mcp setup` | No helper is set up for this browser. |
| `npx glaze-mcp setup --extension-id <id>` | The helper doesn't let this copy of Glaze in, as with one loaded unpacked. Run the command shown. |
| Update the helper: `npx glaze-mcp@latest setup` | |
| Install Node.js 18+ for browsers to start the helper | Install Node.js, then reopen Claude or run `npx glaze-mcp setup`. |
| The helper stopped; Glaze is retrying. `npx glaze-mcp doctor` says why. | |
| Agent access in Safari needs the Glaze app from frostdev.io | Install the downloaded Mac app; the Mac App Store app has no agent access. |
| Update the Glaze app from frostdev.io | |
| The Glaze app stopped; Glaze is retrying. | |

`npx glaze-mcp doctor` checks the helper's folders, each browser's setup, the Node.js each one starts, and whether a
browser has agent access on now. An app with no browser to reach says "waiting for Glaze" in its log.

## Browsers

| | macOS | Linux | Windows |
|---|---|---|---|
| Chrome, Edge, Brave, Vivaldi, Chromium | Yes | Yes | Yes |
| Arc | Yes | — | — |
| Firefox | Yes | Yes | Yes |
| Safari | The downloaded Mac app | — | — |

Phones and tablets have no agent access. Mods' code tools need Chrome.

## Mods

Mods can add tools behind the `agents` permission, listed one per line in the install prompt. Declarative tools work
on every browser with no school page open; code tools run in Chrome with a school page open, and every call to one
waits for your OK. See [Mods API](mods-api.md#tools).

## Privacy

Glaze sends nothing to FrostDev. The app you connect may send what it gets to its own AI service, under that app's own
policy. What Glaze keeps for agent access, and what each button clears:
[Privacy policy: Agent access](../PRIVACY.md#agent-access).
