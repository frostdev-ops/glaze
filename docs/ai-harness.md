# AI harness

Glaze's AI is off by default. The service worker caches its scripts at installation and loads them when AI is used; Firefox loads them with its event page. Nothing is sent
until the student has turned AI on, chosen a connection and allowed that feature. Its conventions follow
[Rimeward](https://github.com/frostdev-ops/rimeward)'s agent harness (MIT), and the files ported from it say so at the top.

| File | Role |
| --- | --- |
| `lib/ai/request.js` | The one request and result shape; cleaners return `null` and never truncate. Error codes. |
| `lib/ai/schema.js` | The JSON Schema subset tasks and tools use; `validate`, `strict`, `parse` (askJson-style), `obj/str/num/bool`. |
| `lib/ai/text.js` | Data fences and the trust rule, grounding, `anchor` (a quote's offsets), `estimateTokens`, `chunks`, `paginateText`, `searchPages`. |
| `lib/ai/stream.js` | `sseParser`, `readSse`, `thinkingCounter`. |
| `lib/ai/failure.js` | Failure categories with a reference, the call record (last 40, metadata only), `bounded`, signals. |
| `lib/ai/endpoint.js` | Endpoint addresses (https, or http to localhost/127.0.0.1), `normalize`, `mask`, connection ids and generations. |
| `lib/ai/models.js` | Catalogs (a server's `/models`, OpenRouter's public list) with provenance, and `select`. |
| `lib/ai/providers.js` | The provider registry and `run`, the one way to call a model. |
| `lib/ai/providers/openai.js` | Any Chat Completions server. `mock.js` is for tests and evals only; the worker never loads it. |
| `lib/ai/providers/device.js` | Chrome's Prompt API (Gemini Nano, Chrome 138+), in the worker itself. Unavailable elsewhere. |
| `lib/ai/providers/apple.js` | Safari only: Apple's Foundation Models on this device, through the extension's native handler, `GlazeAI.swift`. One reply per request; no tools, no streaming. |
| `lib/ai/tools.js` | Tool definitions, `aiTools` (adds the required `reason`), `invokeReadTool`. |
| `lib/ai/loop.js` | The agent loop: rounds, batch triage, approvals, receipts, repair. |
| `lib/ai/task.js` | Task definitions and `run`. Tasks live in `lib/ai/tasks/<id>.js`. |
| `lib/ai/tasks/syllabus-read.js` | `syllabus.read`: a syllabus's values as written, each with its quote; `lib/syllabus-ai.js` reads them with `lib/syllabus.js` and merges them into the import dialog's review. |
| `lib/ai/tasks/writer-*.js` | Glaze Writer's tasks (below); `writer-context.js` cleans the page's context and writes it as the request's reusable context. |
| `lib/ai/settings.js` | storage.local `ai`: `{ on, use, features }`. Features: `syllabus`, `completion` (the writer's ghost text), `writing` (its review, feedback, requirements, citations and autocorrect calls). |
| `lib/ai/broker.js` | The worker's broker: the port, admission, connections (IndexedDB), Settings' config messages. |

## Glaze Writer

The writer's frame (`writer.html`, `writer-ai.js`) runs six tasks on the port, each only when the student turned its feature
on in Settings → AI (`completion` for the gray text, `writing` for the rest); with a feature off nothing is sent and no port
is opened. Glaze never drafts: the gray text only finishes the current word and sentence, and feedback is comments only. In a
test's box the frame asks for nothing, every task's `input` refuses a test's context, and the worker refuses the writer's
features on any attempt not known to be an assignment (`attempt`). Any connected model, an endpoint's included, gets the
whole thread with no extra step (owner, 2026-10-26).

| Task | Feature | Sends | Gets back, checked |
| --- | --- | --- | --- |
| `writer.complete` (text, streamed; 60 a minute, supersede) | completion | up to 4,000 characters before the caret and 1,000 after; the course name, citation style, discussion prompt, assignment title, instructions and rubric, the thread (posts with their authors, 24,000 characters at most) and the post being answered | the rest of the current sentence: begun with the caret's word (so the join is exact), cut at the first sentence end, refused if it starts a new sentence or paragraph, repeats the text after or just before the caret, quotes, cites or links, or runs past 25 words |
| `writer.review` | writing | the draft (in parts when long), the course name, style, prompt and assignment; no thread | at most 40 issues, each anchored to its words in the draft (`text.anchor`), suggestions that replace only those words |
| `writer.feedback` | writing | the draft, the assignment's title, instructions and rubric (`lib/rubric.js`'s shape as text) | per rubric criterion (or requirement copied from the instructions): met, partly or missing, a comment, up to two anchored passages; a comment quoting words in neither the draft nor the assignment is dropped |
| `writer.requirements` | writing | the prompt | `{ minWords, maxWords, sources, replies }`, each number only if the prompt states it in digits or words |
| `writer.cite` | writing | the first 30,000 characters of the page the student asked to cite, and its address | the source (CSL-JSON subset), every value found in that text; a date only from a quote holding its year; no title, no answer |
| `writer.decide` | writing | the sentence around a flagged word (1,000 characters at most), the word, the candidate fixes, the course name, style, prompt and assignment | `apply`, `suggest` or `keep`, with a choice only among the candidates |

The frame's results: the gray text after an adaptive pause (about 500 ms; Tab takes it, ⌥→ or Ctrl+→ a word, Esc
dismisses it, typing it consumes it, any other key, a click or an IME composition ends it and the run in flight); Check with
AI (⌘⇧K, the chip's menu and ⋯) sets `GZ_WRITER_ISSUES.set('ai', …)` with positions mapped through every edit since the run
began; `GZ_WRITER_AI.feedbackView(container)` is the Feedback panel; `GZ_WRITER_PROOF.decide` answers `apply` only when the
model takes the first candidate. `GZ_WRITER_AI.requirements(prompt)` and `cite({ text, url })` give the other parts of the
writer those tasks' outputs, or null. `lib/writer-tools.js` declares editor tools (read: document, issues, sources,
assignment; confirm: insert a citation, apply a fix) for a later MCP integration; nothing offers them to a model yet.

## Add a provider

One file, `lib/ai/providers/<id>.js`, that calls `GZ_AI_PROVIDERS.add({ … })`:

```js
{ id, config(raw) → cfg | null, caps(cfg) → { text, images, json, tools, stream, context },
  status(cfg, { fetch, signal, cache }) → { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason? },
  run(request, cfg, { signal, onDelta, onThinking, fetch }) → { text, toolCalls?, usage?, model, finish },
  origin?(cfg) → 'https://host/*', catalog?(cfg, env) → models.list(),
  prepare?(cfg, { onProgress }) → status, for a model that downloads to this computer,
  release?() → drops what it keeps warm between requests; the broker calls it when a connection changes }
```

A capability that isn't known is left out, never `false`. Name the file in the worker's `importScripts` call
(`lib/background.js` `aiFiles`; Firefox loads only the files named there) and in `lib/ai/settings.js` `PROVIDERS`.
Throw errors with a `status` or a `category`; `providers.run` turns them into a failure category with a reference.

## Add a task

`lib/ai/tasks/<id>.js` calls `GZ_AI_TASKS.add({ … })` and is named in `aiFiles`:

```js
{ id: 'syllabus.read', version: 1, caps: { images?, tools? },
  input(raw) → input | null, build(input, { caps, text, fence }) → request (no schema),
  output: JSON Schema (object root) | 'text', check(output, input, { truncated }) → output | null,
  tools?: ['name'], limits?: { steps, ms, tokens, maxTokens }, stream?: false,
  rate?: { perMinute?: 1..120, supersede?: true },
  split?(input, { budget, text }) → [input], merge([output], input) → output }
```

Build with `text.request({ system, context: [{ label, text }], data: [{ label, text }], images })`: instructions go only
in the system message, page and document text only inside the fence. `context` is what stays the same from one request to
the next (an assignment's prompt, a thread), `data` what changes (the text around the caret); leave out `fence` so the
context keeps its tag (below). Ground every extracted value in `check` with `text.source(input.text).has(quote)`, and
anchor an issue to the student's text with `text.anchor(text, quote, { before, after })` → `[start, end]` (UTF-16 offsets
in the original, the same folding as `has`) or `null` when it isn't there or is there more than once and the words around
it don't say which. Raise `version` when the output changes.

`output: 'text'`: no schema; the answer is the model's words, and `check(text, input, { truncated })` gets them. With
`stream: true` they reach the page as `text_delta` as they come, on this device and from an endpoint, an endpoint with a key
through its credential guard (`safeStream`: only a suffix that could begin the key is held until the next delta). An
answer cut off at `maxTokens` comes back as far as it got with `meta.truncated: true` (a JSON task's is still a `refusal`).
A text task needs no JSON from its provider.

`rate`: `perMinute` replaces the broker's six a minute for this task in a tab's feature (counted apart from every other
task, at most 240 a minute in all tabs). `supersede`: a new run of the task in the same tab and feature cancels the one in
flight (it ends `cancelled`) instead of being refused `busy`; other tasks keep one run at a time per tab and feature, so a
supersede task and another feature's runs never wait on each other. A supersede task's runs share one call-record row a
minute per tab and feature: `count`, total `ms`, summed `usage`, and the last `state` (named by the last failure's
reference).

### The fence and the cached prefix

A request is `[system: instructions + trust rule naming the tag] [user: context blocks, then data blocks, each fenced with
that tag]`. Without `context`, the tag is new for every request, as before. With it, the tag is drawn at random once for
those instructions and that context and kept 10 minutes (at most 32 kept, in the worker's memory only), so the system
message and the context are the same text request after request: an endpoint's prompt cache, the device's warm session and
Apple's warm session all start from it. Nothing about the fence is weaker: the tag is still random and never shown to a
page, it is still named only in the system message, and any text in the request that holds it (context or data) gets a new
one for that request, which is then kept.

## Add a tool

```js
GZ_AI_TOOLS.add({ name: 'courses_list', kind: 'read' | 'write' | 'confirm', description,
  parameters: S.obj({ … }, [required]), run(args, ctx) → data, summarize?(args, ctx) → string })
```

Names are snake_case. Every call must carry a `reason` (added to the schema for you). `read` runs; `confirm` waits for the
student and its summary comes from `summarize`, never from the model's words; `write` waits too under every approval policy and needs its own review
before Glaze ships one. Errors a tool throws go back to the model as `{ error }`.

## The port

```js
const port = chrome.runtime.connect({ name: 'glaze:ai' });
port.postMessage({ id: 1, op: 'run', feature: 'syllabus', task: 'syllabus.read', input });
port.postMessage({ id: 1, op: 'cancel' });
port.postMessage({ id: 2, op: 'status', feature: 'syllabus' });
port.postMessage({ id: 3, op: 'confirm', confirmId, approve: true });
```

A run posts events `{ id, type, … }`: `thinking`, `text_delta { delta, offset }` (stream tasks only), `says`, `note
{ part, parts }`, `step_start`, `step { step }`, `pending { pending }`, `usage`, `reply`; an event's own id is `event`. It
ends with `{ id, type: 'end', output?, pending?, steps?, meta }` (a text task's `meta.truncated`) or `{ id, type: 'error',
error, reference?, status? }`. A port's messages are taken in the order they were sent. A cancelled run gives up its place
at once.
Show `text_delta` and model output as text only. Credentialed structured replies release deltas only after parsing and credential checks. Keep the port open while a run is in flight; closing it cancels the run.

Error codes: the model request's category (`cancelled`, `timeout`, `provider-unavailable`, `request-rejected`,
`invalid-response`, `connection-lost`), or `off`, `feature`, `task`, `setup`, `caps`, `permission`, `changed`, `busy`,
`often`, `attempt`, `input`, `size`, `check`, `refusal`, `limit`, `steps`, `request`. `attempt` refuses one message and
keeps the port: the writer's features on an Ultra attempt not known to be an assignment; a status then answers
`{ type: 'status', on, allowed: false, why: 'attempt' }`.

Settings' top frame (`options.html`) manages connections with `chrome.runtime.sendMessage({ type: 'glaze:ai-config', op })`:
`get`, `set { id, cfg: { provider, base, model, key?, images?, context? } }`, `remove { id }`, `test { id }`,
`models { id }`. `get` also returns `providers`, the shipped providers registered in this browser. Request the host from a click first with `chrome.permissions.request({ origins: [origin] })`.
Settings → AI (`lib/editor-ai.js`) keeps up to three connections, `endpoint`, `device` and, on Safari, `apple` (`{ provider:
'apple', model: 'on-device' }`, kept the first time it is chosen, then `test`ed for its state), and asks for the host with
`GZ_SITE.reach` from the Save or Test click.
The model on this computer: `test { provider: 'device' }` → `{ ok, state, reason? }`, and from a click `prepare { provider:
'device' }`, which answers once the model is ready and meanwhile sends `{ type: 'glaze:ai-config', event: 'progress',
provider, loaded }` (0 to 1) to Glaze's pages. A `download` reply with reason `activation` keeps Download available for another click.
Concurrent prepare calls share one attempt, limited to four minutes; a timeout answers `unavailable` with reason `timeout`.
If the worker stops or the attempt times out, ask `test` again and let the student retry; inference is never replayed.
Feature status reports `ready: false` with `why: 'download' | 'downloading' | 'unavailable'` until Chrome reports ready.
For a connection that goes over the network it reports `to`, the host the text goes to, so the feature can say so.

## Limits

| What | Limit |
| --- | --- |
| Run input | 16 MB JSON; text 1 M characters a part, 2 M in all; 8 pictures, 8 MB each |
| Runs | one at a time per tab and feature (a supersede task: per task, the newer replacing the older); 6 a minute per tab and feature, 30 in all; a task's own `rate.perMinute` (at most 120) instead, 240 in all |
| Catalog | asked once per connection generation, kept an hour; a changed connection or a device download asks again |
| Loop | 24 rounds; 120 s (at most 300 s); 60k tokens (at most 500k); tool answers 12k characters |
| Model call | 120 s unless the request says; one retry for a 429, none for anything that may have run |
| Device status / download | 20 s / 4 minutes per shared attempt |
| Answers | 10 MB across the entire response, including SSE; 64 KB of an error body is read |

## Security rules

- Keys and connections live only in the worker's IndexedDB (`glaze-ai`), never in storage.local, sync, a Back up file,
  a shared Look or a page. Settings sees a key only masked.
- A key goes only over https, or to localhost/127.0.0.1; redirects are refused. A request goes only to the connection's
  exact origin, including its port, and only while the connection keeps the generation the run was admitted on.
- Senders: Glaze's own top-level pages, or Glaze in a same-origin LMS frame whose full ancestor chain is safe; never quiz, assessment or LTI pages. Every message rechecks the live document, including SPA navigation.
- Glaze's writer frame (`writer.html`, an extension page inside an LMS tab) is judged by the frame it sits in, which the
  writer's claim of its one-use pass names (`aiFrameHost(writer frame's sender, the sender that asked for the pass)` in
  `lib/background.js`); a writer frame no claim named may not ask. On every message the worker reads that frame's address
  and every address above it in its own document, and the tab's page with `tabs.get`: one LMS site Glaze runs on, never a
  quiet route. The one exception is the tab's own Ultra attempt page (`/ultra/courses/_x_/assessment/_y_/attempt/create`
  or `/_z_`), where only `completion` and `writing` may ask, and only once Glaze's content script in that tab's top frame
  (fromLms's checks, on this route) has sent `{ type: 'glaze:attempt-kind', kind: 'assignment' }` for the page the tab
  shows now. `test`, no word, or an attempt inside another frame (a course tab's) is `attempt`. The word and the seats are
  kept per tab (storage.session too); the word goes when the tab goes to another page, both when it closes. Mods, stickers
  and every other feature stay quiet there.
- Confirmations are single-use, owned by their port and cancelled with their run; feature, task, tool, connection and sender authority are checked again before execution.
- Provider replies and catalogs that echo a credential are refused before display or caching. Errors retain only safe diagnostics.
- Everything from a page, a document or a model is data. Answers are checked against the schema and the task's `check`;
  inference that may have run is never replayed.
- The call record (`storage.local aiCalls`) keeps ids, task, feature, provider, state, category, status, timing, usage and
  a tallied row's count: no prompts, answers, addresses or keys.

## Warm sessions

The device provider prompts a `clone()` of one warm `LanguageModel` session per system prompt (and sampling and pictures)
for a request with no earlier turns, so the instructions are read once. At most three are kept; each is destroyed two
minutes after its last use, when a call on it fails or times out (not when the caller cancels), and on `release`. Its
`create()` has a signal of its own, since a later abort of a call's signal would destroy it. Without `clone()` each request
has its own session, destroyed after it.

Apple's native side keeps a warm session per instructions (at most four, five minutes each), made and `prewarm()`ed when a
request with those instructions comes, so the next starts on it. A session answers once, since its transcript would carry
that answer into the next request. `{ type: 'ai.release' }` drops them; the worker sends it when a connection changes.

## Safari's Apple provider

An `apple` connection uses `model: 'on-device'`, Apple Intelligence on this device; text stays on the device. It is
registered and offered by Settings only on Safari, and needs macOS 27 or iOS 27; older systems return `unavailable` with
reason `os`.

`ai.run` is one native request and reply. Refusals stay `refusal`; a reply reaching `maximumResponseTokens` is marked
`length`, and structured output is refused even if guided generation closed the JSON. Rate and quota limits carry 429.
Schemas are converted to `DynamicGenerationSchema`; the worker validates every answer against the full original schema.
Native messages and errors never log or forward prompt text through diagnostics.

Cancel and timeout end the worker's wait immediately and send `ai.cancel` for that request id. Native cancellation is
cooperative and confined to the same extension process; `cancelled: true` means a registered task received cancellation,
not that computation has already stopped. An early cancel is remembered for five minutes (up to 256 ids), duplicate runs
cannot replace an active task, and late output is discarded. A different native process cannot cancel the original task.
