# AI harness

Glaze's AI is off by default. Nothing in `lib/ai/` loads until a feature opens a `glaze:ai` port, and nothing is sent
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
| `lib/ai/tools.js` | Tool definitions, `aiTools` (adds the required `reason`), `invokeReadTool`. |
| `lib/ai/loop.js` | The agent loop: rounds, batch triage, approvals, receipts, repair. |
| `lib/ai/task.js` | Task definitions and `run`. Tasks live in `lib/ai/tasks/<id>.js`. |
| `lib/ai/settings.js` | storage.local `ai`: `{ on, use, features }`. |
| `lib/ai/broker.js` | The worker's broker: the port, admission, connections (IndexedDB), Settings' config messages. |

## Add a provider

One file, `lib/ai/providers/<id>.js`, that calls `GZ_AI_PROVIDERS.add({ … })`:

```js
{ id, config(raw) → cfg | null, caps(cfg) → { text, images, json, tools, stream, context },
  status(cfg, { fetch, signal, cache }) → { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason? },
  run(request, cfg, { signal, onDelta, onThinking, fetch }) → { text, toolCalls?, usage?, model, finish },
  origin?(cfg) → 'https://host/*', catalog?(cfg, env) → models.list() }
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
student and its summary comes from `summarize`, never from the model's words; `write` waits too and needs its own review
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
Show `text_delta` and model output as text only. Keep the port open while a run is in flight; closing it cancels the run.

Error codes: the model request's category (`cancelled`, `timeout`, `provider-unavailable`, `request-rejected`,
`invalid-response`, `connection-lost`), or `off`, `feature`, `task`, `setup`, `caps`, `permission`, `changed`, `busy`,
`often`, `input`, `size`, `check`, `refusal`, `limit`, `steps`, `request`.

Settings' top frame (`options.html`) manages connections with `chrome.runtime.sendMessage({ type: 'glaze:ai-config', op })`:
`get`, `set { id, cfg: { provider, base, model, key?, images?, context? } }`, `remove { id }`, `test { id }`,
`models { id }`. Request the host from a click first with `chrome.permissions.request({ origins: [origin] })`.

## Limits

| What | Limit |
| --- | --- |
| Run input | 16 MB JSON; text 1 M characters a part, 2 M in all; 8 pictures, 8 MB each |
| Runs | one at a time per tab and feature; 6 a minute per tab and feature, 30 in all |
| Loop | 24 rounds; 120 s (at most 300 s); 60k tokens (at most 500k); tool answers 12k characters |
| Model call | 120 s unless the request says; one retry for a 429, none for anything that may have run |
| Answers | 10 MB; 64 KB of an error body is read |

## Security rules

- Keys and connections live only in the worker's IndexedDB (`glaze-ai`), never in storage.local, sync, a Back up file,
  a shared Look or a page. Settings sees a key only masked.
- A key goes only over https, or to localhost/127.0.0.1; redirects are refused. A request goes only to the connection's
  host, and only while the connection keeps the generation the run was admitted on.
- Senders: Glaze's own pages, or Glaze in a frame of a site it runs on; never quiz, assessment or LTI pages.
- Everything from a page, a document or a model is data. Answers are checked against the schema and the task's `check`;
  inference that may have run is never replayed.
- The call record (`storage.local aiCalls`) keeps ids, task, feature, provider, state, category, status, timing and usage:
  no prompts, answers, addresses or keys.
