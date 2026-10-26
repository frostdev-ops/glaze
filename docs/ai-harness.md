# AI harness

Glaze's AI is off by default. The service worker caches its scripts at installation and loads them when AI is used; Firefox loads them with its event page. Nothing is sent
until the student has turned AI on, chosen a connection and allowed that feature. Its conventions follow
[Rimeward](https://github.com/frostdev-ops/rimeward)'s agent harness (MIT), and the files ported from it say so at the top.

| File | Role |
| --- | --- |
| `lib/ai/request.js` | The one request and result shape; cleaners return `null` and never truncate. Error codes. |
| `lib/ai/schema.js` | The JSON Schema subset tasks and tools use; `validate`, `strict`, `parse` (askJson-style), `obj/str/num/bool`. |
| `lib/ai/text.js` | Data fences and the trust rule, grounding, `estimateTokens`, `chunks`, `paginateText`, `searchPages`. |
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
| `lib/ai/settings.js` | storage.local `ai`: `{ on, use, features }`. |
| `lib/ai/broker.js` | The worker's broker: the port, admission, connections (IndexedDB), Settings' config messages. |

## Add a provider

One file, `lib/ai/providers/<id>.js`, that calls `GZ_AI_PROVIDERS.add({ … })`:

```js
{ id, config(raw) → cfg | null, caps(cfg) → { text, images, json, tools, stream, context },
  status(cfg, { fetch, signal, cache }) → { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason? },
  run(request, cfg, { signal, onDelta, onThinking, fetch }) → { text, toolCalls?, usage?, model, finish },
  origin?(cfg) → 'https://host/*', catalog?(cfg, env) → models.list(),
  prepare?(cfg, { onProgress }) → status, for a model that downloads to this computer }
```

A capability that isn't known is left out, never `false`. Name the file in the worker's `importScripts` call
(`lib/background.js` `aiFiles`; Firefox loads only the files named there) and in `lib/ai/settings.js` `PROVIDERS`.
Throw errors with a `status` or a `category`; `providers.run` turns them into a failure category with a reference.

## Add a task

`lib/ai/tasks/<id>.js` calls `GZ_AI_TASKS.add({ … })` and is named in `aiFiles`:

```js
{ id: 'syllabus.read', version: 1, caps: { images?, tools? },
  input(raw) → input | null, build(input, { caps, text, fence }) → request (no schema),
  output: JSON Schema (object root), check(output, input) → output | null,
  tools?: ['name'], limits?: { steps, ms, tokens, maxTokens }, stream?: false,
  split?(input, { budget, text }) → [input], merge([output], input) → output }
```

Build with `text.request({ system, data: [{ label, text }], images })`: instructions go only in the system message,
page and document text only inside the fence. Ground every extracted value in `check` with
`text.source(input.text).has(quote)`. Raise `version` when the output changes.

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
ends with `{ id, type: 'end', output?, pending?, steps?, meta }` or `{ id, type: 'error', error, reference?, status? }`.
Show `text_delta` and model output as text only. Credentialed structured replies release deltas only after parsing and credential checks. Keep the port open while a run is in flight; closing it cancels the run.

Error codes: the model request's category (`cancelled`, `timeout`, `provider-unavailable`, `request-rejected`,
`invalid-response`, `connection-lost`), or `off`, `feature`, `task`, `setup`, `caps`, `permission`, `changed`, `busy`,
`often`, `input`, `size`, `check`, `refusal`, `limit`, `steps`, `request`.

Settings' top frame (`options.html`) manages connections with `chrome.runtime.sendMessage({ type: 'glaze:ai-config', op })`:
`get`, `set { id, cfg: { provider, base, model, key?, images?, context? } }`, `remove { id }`, `test { id }`,
`models { id }`. `get` also returns `providers`, the shipped providers registered in this browser. Request the host from a click first with `chrome.permissions.request({ origins: [origin] })`.
Settings → AI (`lib/editor-ai.js`) keeps two connections, `endpoint` and `device`, and asks for the host with
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
| Runs | one at a time per tab and feature; 6 a minute per tab and feature, 30 in all |
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
- Confirmations are single-use, owned by their port and cancelled with their run; feature, task, tool, connection and sender authority are checked again before execution.
- Provider replies and catalogs that echo a credential are refused before display or caching. Errors retain only safe diagnostics.
- Everything from a page, a document or a model is data. Answers are checked against the schema and the task's `check`;
  inference that may have run is never replayed.
- The call record (`storage.local aiCalls`) keeps ids, task, feature, provider, state, category, status, timing and usage:
  no prompts, answers, addresses or keys.

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
