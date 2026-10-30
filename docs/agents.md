# Agents

AI apps on your computer can use Glaze over MCP: your courses, to-dos and schedule, grades, assignments and rubrics, and
Writer documents. Agent access is off by default. You allow each app and each kind of data in a Glaze window, and every
change waits for your OK there. Glaze's built-in agent tools never submit work.

## Turn it on

1. Get the helper (below).
2. In Glaze, open **Settings → AI → Agents** and turn on the switch. On Chrome, Edge and the other Chromium browsers,
   the browser asks to let Glaze start the helper. Firefox asks for that and for sharing website content, in one prompt.
3. Connect your app (below).
4. Ask it something, like "what's due this week?". Glaze opens its window: allow the app.

The first time in Chrome, Settings shows **Starting…** for up to a minute, until Chrome restarts Glaze's background
worker.

## The helper

Apps reach Glaze through a helper program on the same computer. It opens no network connections and relays messages in
memory without saving their contents to disk.

- **npm:** `npx glaze-mcp setup`, with Node.js 18 or later. Its version follows Glaze's. It sets up every supported
  browser it finds; run it again after installing another. `npx glaze-mcp uninstall` removes owned setup files and
  unchanged copies. Details: [glaze-mcp](../mcp/README.md).
- **App bundle:** releases include `glaze-mcp-<version>.mcpb` for apps that install MCP bundles. Open it in your app.
  With **Set up browsers** on (the default), it sets up browsers each time the app starts it. Browsers need a system
  Node.js 18 or later to start the helper.
- **Safari:** the downloaded Glaze Mac app, from the [GitHub
  release](https://github.com/frostdev-ops/glaze/releases/latest) or [frostdev.io/glaze](https://frostdev.io/glaze), is
  Safari's helper and starts by itself. The Mac App Store app has no agent access. Apps still connect with `npx -y
  glaze-mcp` or the app bundle.

## Connect an app

Add a stdio MCP server with the command `npx` and arguments `-y glaze-mcp`. For an app that uses `mcpServers` in its
configuration:

```json
{ "mcpServers": { "glaze": { "command": "npx", "args": ["-y", "glaze-mcp"] } } }
```

Apps that install `.mcpb` bundles can open `glaze-mcp-<version>.mcpb` from the [Glaze
release](https://github.com/frostdev-ops/glaze/releases/latest). Its **Browser** setting chooses the browser.

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
  that account's school site open in this browser, Glaze attempts to refresh planner and Insights data first, at most
  once a minute per account and group; otherwise it uses the cache.
- `assignment_read` reads an assignment's instructions, attached file names and rubric in that open tab, never your
  scores or feedback. With no tab open it answers with the last read, dated.
- `todo_mark_done` marks Glaze's own list. With **Tick off in Canvas too** on, it marks your Canvas planner through the
  open Canvas tab.
- `document_issues`, `citation_insert` and `fix_apply` need the document open in Writer.
- With more than one school account, the app names which one.

## The approval window

One Glaze window holds every request waiting for you and shows the oldest, with or without a school page open. It names
the app as the app reports itself. On Chrome, Edge and Firefox, its program identity is also self-reported and
unverified: macOS may report a bundle id, and Windows normally supplies no program path. Other programs under your user
account can reach the helper; these identities are not proof of who an app is. **Don't allow** has the focus first.

- An app's first request asks to pair it; **Allow** also gives it the group that request needs.
- A request for another group asks for that group.
- A change shows Glaze's own sentence for it, from Glaze's data, never the app's words.
- Closing the window counts as **Don't allow**. For a pairing or a group, Glaze remembers it and doesn't ask again.
- With no answer in 10 minutes, nothing is done, and Glaze asks again next time.
- Some apps, Claude Desktop among them, stop waiting for an answer after about a minute. The window then closes and
  nothing is done; ask the app again.
- An app can have 5 requests waiting at once, 20 across all apps; more are refused as Busy.

## Apps, groups and Revoke

**Settings → AI → Agents → Apps** has a card for each app: its name, its program, when it was paired and last used, and
a switch for each group. Each installed mod with tools is a group of its own.

- A group turned off is asked for again at the app's next request for it.
- **Revoke** forgets the app; its next request asks to pair again.
- An app you declined shows **Declined** and **Forget**, which lets Glaze ask again.
- **Forget all apps** clears the activity list and assignment reads and forgets every app, its groups and declines.

Turning the switch off ends every connection, cancels waiting requests, clears the kept assignment reads and gives back
the optional browser permissions on Chrome, Edge and Firefox. The apps, groups, declines, activity and profile id stay.
A change already started can finish. Removing a site clears its assignment reads; Reset everything clears them all while
keeping agent access and grants. Neither uninstalls the helper. Helper uninstall empties the run folder, except a
running helper's run file, and leaves modified copies alone.

## Activity

**Activity** lists the last 200 calls, newest first: the tool, the app, when, and how it ended (Done, Failed, Declined,
Timed out, Interrupted, Refused, Busy, Cancelled or Invalid request), never what was asked or answered. **Forget all
apps** clears this list.

## Troubleshooting

Settings → AI → Agents shows the helper's state, with **Copy** for a command.

| Helper state | Action |
|---|---|
| Ready | Connected. |
| Starting… | Wait; the first time in Chrome, up to a minute. |
| Allow Glaze to start the helper | Press **Allow**. |
| Restart your browser to start the helper | Quit the browser and open it again. |
| The helper is missing | Open the app bundle or run `npx glaze-mcp setup`. |
| `npx glaze-mcp setup --extension-id <id>` | The helper doesn't let this copy of Glaze in, as with one loaded unpacked. Run the command shown. |
| Update the helper: `npx glaze-mcp@latest setup` | |
| Install Node.js 18+ for browsers to start the helper | Install Node.js, then restart your app or run `npx glaze-mcp setup`. |
| The helper stopped; Glaze is retrying. `npx glaze-mcp doctor` says why. | |
| Agent access in Safari needs the Glaze app from frostdev.io | Install the downloaded Mac app; the Mac App Store app has no agent access. |
| Update the Glaze app from frostdev.io | |
| The Glaze app stopped; Glaze is retrying. | |

`npx glaze-mcp doctor` checks the helper's folders, each browser's setup, the Node.js each one starts, and whether a
browser has agent access on now. An app with no browser to reach says "waiting for Glaze" in its log.
In Safari, after a long idle, an app can time out before Glaze wakes: open a Blackboard or Canvas tab, or Glaze's
popup, then ask again. If the app then shows Glaze as disconnected, reconnect it there (in Claude Code, `/mcp`).

## Browsers

| | macOS | Linux | Windows |
|---|---|---|---|
| Chrome, Edge, Brave, Vivaldi, Chromium | Yes | Yes | Yes |
| Arc | Yes | — | — |
| Firefox | Yes | Yes | Yes |
| Safari | The downloaded Mac app | — | — |

Phones and tablets have no agent access. Mods' code tools need Chrome.

## Mods

Mods can add tools behind the `agents` permission, listed one per line in the install prompt. Declarative tools work on
every browser with no school page open; code tools run in Chrome with a school page open, and every call to one waits
for your OK. A mod's code tool can send the app's arguments and data the mod may read to its approved hosts. The app's
group grant does not narrow the mod's permissions. See [Mods API](mods-api.md#tools).

## Privacy

Agent access sends no data to FrostDev. The app you connect may send what it gets to its own AI service, under that
app's own policy. What Glaze keeps for agent access, and what each button clears: [Privacy policy: Agent
access](../PRIVACY.md#agent-access).
