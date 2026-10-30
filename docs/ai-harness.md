# AI harness

Glaze's AI is off by default. The service worker caches its scripts at installation and loads them when AI is used; Firefox loads them with its event page. Nothing is sent
until the student has turned AI on, chosen a model for that feature and allowed it. Its conventions follow
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
| `lib/ai/providers/openai.js` | Any Chat Completions server. A request's `effort` goes as OpenRouter's `reasoning.effort` there and as `reasoning_effort` elsewhere; a model that refuses it gets the next level up (none, minimal, low), then none at all, remembered an hour for that model. `mock.js` is for tests and evals only; the worker never loads it. |
| `lib/ai/providers/device.js` | Chrome's Prompt API (Chrome 138+), in the worker itself. Chrome chooses its built-in model; Glaze retains `gemini-nano` as its compatibility id. Unavailable elsewhere. |
| `lib/ai/providers/apple.js` | Safari only: Apple's Foundation Models on this device, through the extension's native handler, `GlazeAI.swift`. One reply per request; no tools, no streaming. |
| `lib/ai/tools.js` | Tool definitions, `aiTools` (adds the required `reason`), `invokeReadTool`. |
| `lib/ai/loop.js` | The agent loop: rounds, batch triage, approvals, receipts, repair. |
| `lib/ai/task.js` | Task definitions and `run`. Tasks live in `lib/ai/tasks/<id>.js`. |
| `lib/ai/tasks/syllabus-read.js` | `syllabus.read`: a syllabus's values as written, each with its quote; `lib/syllabus-ai.js` reads them with `lib/syllabus.js` and merges them into the import dialog's review. |
| `lib/ai/tasks/writer-*.js` | Glaze Writer's tasks (below); `writer-context.js` cleans the page's context and writes it as the request's reusable context. |
| `lib/ai/settings.js` | storage.local `ai`: `{ on, outline, sources, mode, model, models, tune, features }` (below), the providers Settings names (`PRESETS`), and `migrate` for an older store. Features: `syllabus`, `completion` (the writer's ghost text), `writing` (its review, feedback, requirements, citations and autocorrect calls). |
| `lib/ai/broker.js` | The worker's broker: the port, admission, connections (IndexedDB), Settings' config messages. |

## Chrome's built-in model

Settings and Writer call this connection **Chrome on-device AI**. The stored `gemini-nano` id is a compatibility id, not a request for particular model weights. Chrome chooses the model behind `LanguageModel`; its public creation options do not expose model identity, version or quality selection. Glaze learns context and input capabilities from the running API instead of assuming them from a model name.

Chrome 156 offers a browser-controlled experiment at `chrome://flags/#gemma4-for-built-in-ai`. Enabling **Gemma 4 for Built-in AI** and relaunching changes the foundational-model route to manifest version `v4`; a subsequent user-initiated Download in Glaze can request its assets. The flag has no size selector. A Gemma component listed as **Pending Usage / Not Installed** is not yet requested, and is not proof that the device cannot run it. Glaze neither changes browser flags nor downloads those optional assets automatically.

The [Chrome 156 flag](https://chromium.googlesource.com/chromium/src/+/156.0.8078.74/chrome/browser/about_flags.cc#4924), [creation options](https://chromium.googlesource.com/chromium/src/+/156.0.8078.74/third_party/blink/renderer/modules/ai/language_model_create_options.idl#137), and [routing test](https://chromium.googlesource.com/chromium/src/+/156.0.8078.74/chrome/browser/ai/ai_language_model_unittest.cc#2728) define this behavior. The separate Summarizer, Proofreader, Writer and Rewriter APIs have their own task contracts; their entries in Chrome's internals are not additional `LanguageModel` model ids.

## Settings → AI

storage.local `ai` (`lib/ai/settings.js`) is `{ on, outline, sources, mode, model, models, tune, features }`. `model` is the overall model,
`{ use, model, effort? }`: `use` a connection's id (a provider's: `openai`, `anthropic`, `gemini`, `openrouter`, `xai`,
`mistral`, `groq`, `deepseek`; `device`, the model on this device; or `custom-1` and on, an endpoint the student added),
`model` its id at that provider (`''` on this device), `effort` the student's. `models` holds a feature's own model in that
shape. A feature runs on its own model, else the overall one (`resolve`); with neither, or a connection with no model id,
none is chosen (`chosen`), its status says `why: 'setup'` and Writer says "No AI model is chosen". `mode` is `simple` or
`advanced`; `tune` holds a feature's `{ temperature?, maxTokens?, context?, timeoutMs?, pause? }` (`pause`, the gray text's
wait in ms, for `completion` only), used in Advanced only (`tuning`) and kept while Simple is on.

Each provider Settings names is an OpenAI-compatible Chat Completions server at its own fixed address (`PRESETS`), kept
with only a key; Anthropic's is asked with its browser header (`anthropic-dangerous-direct-browser-access`), Google Gemini's
at `/v1beta/openai`. Any other id but `device` is an endpoint of the student's own (Advanced), with its name, address and
an optional key. Connect asks the browser for the provider's host from its click, keeps the key, then checks it (`test`)
and reads the catalog (`models`). A key that works fills in what the student hasn't chosen (`lib/ai/settings.js` `suggest`,
`SUGGEST`): the provider's newest main model as the overall one when none is chosen, and as Feedback's own when Feedback
would run on this device; its fast model for Tab completion when the overall model is now its main. No feature turns on.

A model's efforts come from its catalog where the catalog says (OpenRouter's `reasoning.supported_efforts`, DeepSeek's
`effort.supported_levels`, xAI's `capabilities.reasoning_effort`), else from what its provider's docs say of it by name
(`lib/ai/models.js` `RULES`: OpenAI's GPT-5 and o-series, Gemini 2.5 and later, Grok 4.5 to 4.7, Groq's gpt-oss). None
known is none offered, and Settings hides the slider; Anthropic's and Mistral's compatible endpoints offer none, and neither
does a model on this device. The effort thumb shows the student's choice, else completion's `none` or the catalog's stated default; where no default is stated, it shows a separate Default stop without guessing a level. Opening Settings never saves an effort. A run takes the student's effort when its model lists it, else its task's own
(`writer.complete` asks `none`). Reasoning counts against a request's output, so an effort above the task's own adds the
room it thinks in (1,024 tokens for minimal to 8,192 for high, `lib/ai/task.js` `mine`) unless the student set Max output. In Advanced a feature's temperature, max output and timeout replace its tasks' own, and its
context is the window Glaze plans for.

An older Settings kept `{ on, use, features }` and one `endpoint` connection `{ provider: 'openai', base, model, key }`.
`migrate` reads it as the provider its address is (`https://openrouter.ai/api/v1` becomes `openrouter`, its key with it),
else as an endpoint of its own named by its host; the connection's model becomes the overall model, the features stay as
they were, and `device` stays the model on this device. The broker runs on that reading at once, and writes it back,
settings first, the first time Settings asks it anything (`upgrade`).

## Glaze Writer

The writer's frame (`writer.html`, `writer-ai.js`) runs eight tasks on the port. `completion` controls the gray text and `writing` controls Feedback and the other writing calls. AI outline and bibliography extraction have independent `ai.outline` / `ai.sources` switches (true by default); it requires AI on and a configured Feedback model, and uses the writing route even when Feedback’s switch is off. It asks only while Outline is visible, after a pause, with at least 15 seconds between automatic calls. Turning it off cancels its run and restores the local outline. Glaze never drafts: the gray text only finishes the current word and sentence, and feedback is comments only. In a
test's box the frame asks for nothing, every task's `input` refuses a test's context, and the worker refuses the writer's
features on any attempt not known to be an assignment (`attempt`). Any connected model, an endpoint's included, gets the
whole thread with no extra step (owner, 2026-10-26).

| Task | Feature | Sends | Gets back, checked |
| --- | --- | --- | --- |
| `writer.complete` (text, streamed; 60 a minute, supersede) | completion | the course name, citation style, discussion prompt, assignment title, instructions and rubric, the thread (posts with their authors, 24,000 characters at most) and the post being answered; then the document so far: the whole text before the sentence being typed as a rolling window, all of it that the model's input window holds after the rest of the request (90% of its catalog or Advanced context, or of the run's 60,000 tokens, the smaller, at four JSON-escaped UTF-8 bytes a token; up to 60,000 bytes of earlier text when no window is known), the earliest paragraphs left out first; then up to 4,000 characters after the caret, to a paragraph's end; the suggestions already shown in this box (the newest 40, as the sentences they would have made, within 5% of the window); and the sentence being typed last. The system, page context and document form a separate text part ending at an explicit cache breakpoint on OpenRouter Anthropic routes; after-caret text, suggestions and the caret sentence stay in a second, unmarked part. Reuse requires an identical prefix and the provider's minimum cache length; actual cache hits are not guaranteed. A model on this computer or with a window under 32,000 tokens gets the sentence, the newest 1,500 bytes of the document so far, the newest three suggestions, the prompt, instructions and post being answered cut to 600 characters, and no rubric, thread or text after the caret. Every model is asked, after a space, for the next words; mid-word, for that word in full and then the next words, so the join is exact; and to reason not at all (`effort: 'none'`) | the rest of the current sentence: mid-word begun with the caret's word, after a space not with a form of it; a reply that repeats the sentence's last words joins only with matching punctuation on the same line; cut at the first sentence end, refused if it is only the sentence's own words again, starts a new sentence or paragraph, repeats the text after or just before the caret, repeats a sentence of the document or a suggestion already shown (six copied words in a row anywhere in the finish, except a reused defined term or capitalized name in document text; or the sentence ending with one whole earlier sentence of at least four words), quotes, cites or links, or runs past 25 words |
| `writer.review` | writing | the draft (in parts when long), the course name, style, prompt and assignment; no thread | at most 40 issues, each anchored to its words in the draft (`text.anchor`), suggestions that replace only those words |
| `writer.feedback` | writing | the draft, the assignment's title, description, instructions and rubric (`lib/rubric.js`'s shape as text); the files its instructions and description attach (Ultra's `data-bbtype="attachment"` links), read by the page for Feedback or quiet image preparation (`lib/writer-context-assignment.js` attachments: at most 6 files, 40 MB, a document's text through `features/import.js`): each document's text as an `attached file: <name>` block (up to 200,000 characters of assignment material in total), and up to 4 pictures read separately through `writer.image` when supported, with only checked descriptions and requirements passed to assessment; unread pictures remain explicit limitations; for a paper, how Writer hands it in (a .docx in the paper's font, size, spacing, margins and header), so file and layout requirements are judged by that and not by the plain text | per rubric criterion (or requirement copied from the instructions, description or an attached document): met, partly or missing, a comment, up to two anchored passages, and the rubric level it reaches (only a level that criterion has, with that cell's points); a comment quoting words in neither the draft nor the assignment is dropped; comments assess and never supply wording (an example sentence, a quoted suggestion, "try writing…", or quoted words the draft and assignment don't hold drops the comment) |
| `writer.outline` (4 a minute, supersede) | writing, with its own `ai.outline` switch | up to 600 existing body blocks / 120,000 characters, identified by snapshot ids, plus interface language; no heading block or bibliography | descriptive headings and levels over contiguous block-id ranges; every block covered once, no invented positions, no swallowed authored headings; stale replies discarded and labels never inserted into the draft |
| `writer.requirements` | writing | the prompt | `{ minWords, maxWords, sources, replies }`, each number only if the prompt states it in digits or words |
| `writer.cite` | writing | the first 30,000 characters of the page the student asked to cite, and its address | the source (CSL-JSON subset), every value found in that text; a date only from a quote holding its year; no title, no answer |
| `writer.decide` | writing | the sentence around a flagged word (1,000 characters at most), the word, the candidate fixes, the course name, style, prompt and assignment | `apply`, `suggest` or `keep`, with a choice only among the candidates |

Completion measures the full bare request, including its system and trust instructions. The 64-token answer reserve is
its requested output ceiling; another 96 estimated tokens cover two optional fenced blocks and cache-part metadata.
It leaves 10% headroom, with at least 128 tokens on tiny windows, measures the finished request again, and refuses before
calling the provider if even the instructions and caret cannot fit. An oversized unfinished caret sentence is also cut
from its beginning; optional after-caret text and context are dropped if necessary. This uses the harness's four-byte
estimate, not a provider tokenizer or a promise of exact token cost. On small windows the three suggestions also share
the 5% byte allowance. The newest 40 suggestions stay only in that frame's memory: fresh editor state and whole-document
replacement clear them (paper open, Documents replacement, version restore and native HTML replacement). Compact/full
moves the same editor and retains them. A warm request still uses only its short caret stub, not the document or history.


`writer.outline` sends one natural section at a time, asking for an at-most-eight-word title and an introduction/body/conclusion/custom role. Authored headings stay exact. Code computes all anchors; the model never supplies ranges. A heading-only entry needs no call. The run is bounded to 32 sections / 64 requests, with at most one repair of a known invalid answer per section; oversized sections keep the local outline with a specific reason.

`writer.sources` reuses the grounded citation reader for individual bibliography entries, with Feedback’s model and tuning. `lib/writer-bibliography.js` first imports common MLA/APA/Chicago entries locally; unparsed entries retain the original text for review. The Sources view enriches only detected citation text while visible, never rewrites the paper, and protects manual edits/removals and stale replies. Standalone Papers gets the local importer too.

Feedback uses a bounded orchestration hook for local models, small context windows and oversized inputs. It gathers exact evidence from every supplied material chunk as needed, assesses each rubric criterion separately, then synthesizes the checked findings. Local assessment separates a flat decision (status, evidence IDs, level, points and completeness) from a short explanation using only the selected verified passages and rubric facts. Decision, comment and summary requests have trusted 256-token requested ceilings; evidence scans request 640. Prompts specify exact fields, concise prose and compact JSON. Local comments and summaries aim for one complete sentence of about 30 words, bounded at 240 characters; unfinished prose receives bounded repair. A format preset is descriptive metadata, never proof of imported citation conformance. A selected citation preset is omitted when the hand-in metadata already describes it, or explicitly labeled descriptive; it is never presented as an assignment requirement. A known contradictory explanation can reopen one criterion decision and explanation pair from the original evidence, using two of the existing four repair calls with nested repair disabled. Explicit rubric alternatives and legitimate preset comparisons remain valid. For an unambiguous APA criterion, the existing citation parser can supply exact author-page citation spans and a standalone Works Cited heading as counterevidence; multiple such citations with no author-year or mixed-style signals exclude a fully met status, without forcing a rating or score. Those witnesses reach both the decision and explanation, independently of selected-fact limits. Possessive apostrophes do not delimit quotations; actual quoted wording still requires source grounding. A required citation-style edition must be supported by the supplied rubric or assignment material; descriptive preset metadata cannot establish that requirement. If a complete, validated APA decision with actual rubric points and exact citation counterevidence exhausts its explanation repair on a known validation or response-length failure, a checked local sentence explains that mismatch and preserves the rating. This adds no model call; transport failures, cancellation and invalid or incomplete decisions never qualify. Fallback summaries retain whole checked comments instead of slicing a sentence. Fitting cloud requests retain the single-call path. All child requests share the provider, cancellation, deadline and call budget (64 requests / five minutes); uncertain transport failures never replay. At most four repairs are reserved before assessment; one confirmed application output cutoff may regenerate from the original evidence with shorter-output instructions, consuming that same repair reserve. Completeness describes source coverage, not whether the student met a requirement. A fully read mismatch or missing requirement receives the applicable rubric assessment; verified counterevidence remains available privately for its explanation even when missing requirements show no public draft quote. Input completeness markers survive extraction and attachment transport; genuinely unread or excluded material prevents an overall score. Progress is shown and Cancel stops attachment loading or the active model run.

For a general APA criterion, the lowest-band estimate policy applies only when exact body citations are corroborated by leading names or titles in distinct Works Cited entries, no APA or mixed-style signals are found, and the assignment and rubric supply no descriptors or style exceptions. Narrow subcriteria such as an APA title page do not qualify. The supplied bands must form a complete, strictly ordered generic quality scale. After a complete valid decision, Glaze estimates the lowest actual band for the different citation system, explains the absence of teacher descriptors, and states the actual points deducted. It never assumes zero or claims that the teacher mandated that band. Described rubrics, permitted alternatives and uncertain evidence retain ordinary review.

Outline generations are stored in bounded `paper.outline` metadata (64 content entries, 248,192 serialized UTF-8 bytes total), bound to the verified paper identity, safe model/configuration identity, language and schema version. Saved labels are reanchored against current section contents; the task validates supplied cached ranges and calls the model only for missing sections. Each request asks for only a role and, when needed, a title of at most eight words/80 characters, under a trusted 256-token requested ceiling. Its reserved second attempt may repair a known invalid answer or regenerate a confirmed output-size cutoff. Cancelled, stale or malformed results are never saved.

Feedback errors distinguish criteria, attachment, material and planned-request limits from estimated fit failures and native context failures. Count-only metadata retains the relevant limits without retaining prompts; native failures also distinguish measured input overflow from a context failure while producing a response.

Assignment pictures first pass through `writer.image` (Feedback's route), one image at a time, with a 512-token requested ceiling and a separately validated 512-estimated-token JSON bound. A confirmed output-size cutoff or a completed response contradicting its own completeness flag permits one regeneration from the same image/context, counted against the task's two-call budget or Feedback's shared budget. A complete reading must have an empty limitation reason; a repeated contradiction remains incomplete. Transport failures and native truncation do not trigger this retry. The pass preserves visible requirements, scales, tables and diagram relationships and classifies relevance against compact assignment context. Descriptions can be shorter; omitted facts must still mark the reading incomplete. All subsequent Feedback calls are text only, including the fitting cloud path. Visual formatting requirements receive the same uncertainty checks as textual requirements.

`writer-ai.js` prefetches these readings for visible, verified paper assignments only when Feedback is enabled, ready and vision capable. Foreground Feedback joins matching preparation. `lib/ai/visual-cache.js` persists complete readings for 30 days, at most 128, keyed by SHA-256 over the verified school/account/assignment, full task-context fingerprint, image bytes/MIME and reader version. The worker refreshes `/learn/api/v1/users/me` and rechecks the host route before binding cache authority; a stale paper identity cannot read that cache. Raw pictures, account identifiers and assignment context are not persisted by this cache. Incomplete readings have only a bounded memory guard against immediate automatic replay; active task leases preserve it across slow batches. Settings/context changes, hiding the tab, cancellation and teardown stop pending work.

Orchestration's trusted `imageCache` hook receives this worker-bound adapter; page payloads cannot supply cached readings or cache keys. A trusted subrequest can set `maxTokensCap` in both `fits` and `ask`, limiting a larger Advanced output override without affecting later review calls. `writer.image` has its own supersede/rate slot (30 per minute), and Activity identifies image preparation separately.

Paper Feedback also requests a grade-as-is assessment. The assignment transport converts scalar percentage rubrics into actual points only when the assignment has an explicit positive total, all scored weights total 100%, and all level percentages are valid. A 25% row on a 100-point assignment with 100/75/50/25% levels becomes 25/18.75/12.5/6.25 points. Unknown totals, unscored or hidden data and percentage ranges remain explicitly nonpoint facts; no total or range endpoint is invented. Each earned score is checked against the actual rubric row’s maximum, with a named rubric level’s points taking precedence; the overall estimate is summed only when every rubric row has a valid score and the supplied documents were read. The summary uses the same assessment-only checks as criterion comments. Every grade carries either a grounded explanation or a translated, concrete reason for withholding its score. Missing scales, unread documents, incomplete or invalid scores, zero point totals and missing explanations are distinct states. Editing the draft hides the old numeric estimate and marks it stale until the next check.

The frame's results: the gray text after an adaptive pause (about 500 ms; Tab takes it, ⌥→ or Ctrl+→ a word, Esc
dismisses it, typing it consumes it, any other key, a click or an IME composition ends it and the run in flight); Check with
AI (⌘⇧K, the chip's menu and ⋯) sets `GZ_WRITER_ISSUES.set('ai', …)` with positions mapped through every edit since the run
began; `GZ_WRITER_AI.feedbackView(container)` is the Feedback panel; `GZ_WRITER_PROOF.decide` answers `{ verdict: 'apply'|'suggest'|'keep', choice }`, the
choice an index into the candidates (-1 with keep). `GZ_WRITER_AI.requirements(prompt)` and `cite({ text, url })` give the other parts of the
writer those tasks' outputs, or null. `lib/writer-tools.js` declares editor tools (read: document, issues, sources,
assignment; confirm: insert a citation, apply a fix) for a later MCP integration; nothing offers them to a model yet.

## Add a provider

One file, `lib/ai/providers/<id>.js`, that calls `GZ_AI_PROVIDERS.add({ … })`:

```js
{ id, config(raw) → cfg | null, caps(cfg) → { text, images, json, tools, stream, local, context },
  status(cfg, { fetch, signal, cache }) → { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason? },
  run(request, cfg, { signal, onDelta, onThinking, fetch }) → { text, toolCalls?, usage?, model, finish },
  origin?(cfg) → 'https://host/*', catalog?(cfg, env) → models.list(),
  prepare?(cfg, { onProgress }) → status, for a model that downloads to this computer,
  warm?(request, cfg, { signal }) → true when it readied a session for the request's instructions (nothing asked),
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
  output: JSON Schema (object root) | 'text', check(output, input, { truncated, caps }) → output | null,
  tools?: ['name'], limits?: { steps, ms, tokens, maxTokens }, stream?: false,
  rate?: { perMinute?: 1..120, supersede?: true }, warm?: true,
  split?(input, { budget, text }) → [input], merge([output], input) → output }
```

Build with `text.request({ system, context: [{ label, text }], data: [{ label, text }], images })`: instructions go only
in the system message, page and document text only inside the fence. `context` is what stays the same from one request to
the next (an assignment's prompt, a thread), `data` what changes (the text around the caret); leave out `fence` so the
context keeps its tag (below). Beside them a request may carry `temperature`, `maxTokens`, `timeoutMs` and `effort`
(`none`, `minimal`, `low`, `medium` or `high`: how long a reasoning model thinks before it answers; only an endpoint sends
it, the models on this device ignore it). The student's effort and Advanced tuning win over the task's (Settings → AI above). Ground every extracted value in `check` with
`text.source(input.text).has(quote)`, and anchor an issue to the student's text with `text.anchor(text, quote, { before, after })` → `[start, end]` (UTF-16 offsets
in the original, the same folding as `has`) or `null` when it isn't there or is there more than once and the words around
it don't say which. Raise `version` when the output changes.

A `context` or `data` block may set `cache: true`; `text.request` ends a separate fenced text part there, and
`request.clean` preserves only that boolean marker. `providers/openai.js` emits `cache_control: { type: 'ephemeral' }`
only on marked blocks for OpenRouter `anthropic/` models, using the documented Chat Completions content-block format:
https://openrouter.ai/docs/guides/best-practices/prompt-caching#explicit-cache-breakpoints-fine-grained-control.
This checkout has no native Anthropic Messages provider. Its direct Anthropic Chat Completions compatibility endpoint
[does not support prompt caching](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk#important-openai-compatibility-limitations), so it receives ordinary text without a marker. Provider caches may have a minimum
prefix length and different read/write pricing. Offline body tests prove placement and serialization, not cache hits.


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
reference). A run refused before it is admitted (`permission`, `setup`, `attempt`, …) leaves a row too when the connection
it would use can be named from Settings alone; Settings → AI → Activity shows it as Not run.

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
port.postMessage({ id: 4, op: 'warm', feature: 'completion', task: 'writer.complete', input });
```

A run posts events `{ id, type, … }`: `thinking`, `text_delta { delta, offset }` (stream tasks only), `says`, `note
{ part, parts }`, `step_start`, `step { step }`, `pending { pending }`, `usage`, `reply`; an event's own id is `event`. It
ends with `{ id, type: 'end', output?, pending?, steps?, meta }` (a text task's `meta.truncated`) or `{ id, type: 'error',
error, reference?, status? }`. A port's messages are taken in the order they were sent. A cancelled run gives up its place
at once. A `warm` (a task with `warm: true`) is admitted as a run is, builds the run's first request (`tasks.prepare`) and has
the provider ready a session for its instructions (`providers.warm`), then posts `{ id, type: 'warmed', ok }`; nothing is
asked of the model, counted or recorded. Writer warms `writer.complete` as a box opens, on focus a minute later and every 90
seconds while focused.
Show `text_delta` and model output as text only. Credentialed structured replies release deltas only after parsing and credential checks. Keep the port open while a run is in flight; closing it cancels the run.

Safari may retire an idle worker without reporting a port disconnection. Writer opens a fresh port before a new request batch when no replies are pending. Concurrent requests retain their connection, and messages from an obsolete port are ignored. This renews only an idle connection; it never replays a request that may have executed.

Error codes: the model request's category (`cancelled`, `timeout`, `provider-unavailable`, `request-rejected`,
`invalid-response`, `connection-lost`), or `off`, `feature`, `task`, `setup`, `caps`, `permission`, `changed`, `busy`,
`often`, `attempt`, `input`, `size`, `check`, `refusal`, `limit`, `steps`, `request`. `attempt` refuses one message and
keeps the port: the writer's features on an Ultra attempt not known to be an assignment; a status then answers
`{ type: 'status', on, allowed: false, why: 'attempt' }`. A sender check that takes over 5 seconds refuses its message
the same way, as `timeout` (a status gets that error). The writer's frame asks a feature's status again, after 0.5, 1, 2, 4
and 8 seconds, when it got no status (none comes within 30 seconds) or `attempt`.

Settings' top frame (`options.html`) manages connections with `chrome.runtime.sendMessage({ type: 'glaze:ai-config', op })`:
`get`, `set { id, cfg: { provider, name?, base?, key?, images?, context? } }` (a provider's id is always at its own
address; `name` is an endpoint's; a model is the settings', never a connection's), `remove { id }`, `test { id }`, `models { id }`
(each model with the `efforts` it takes). `get` also returns `providers`, the shipped providers registered in this browser.
Request the host from a click first with `chrome.permissions.request({ origins: [origin] })`.
Settings → AI (`lib/editor-ai.js`) keeps a connection per provider the student connects, `custom-1` and on for endpoints,
and `device` (On this device, `test { id: 'device' }` → `{ ok, state, reason?, provider }`, the resolved provider naming
its card: Apple Intelligence or Gemini Nano), and asks for the host with `GZ_SITE.reach` from the Connect, Save or Test click.
The model on this computer: `test { provider: 'device' }` → `{ ok, state, reason? }`, and from a click `prepare { provider:
'device' }`, which answers once the model is ready and meanwhile sends `{ type: 'glaze:ai-config', event: 'progress',
provider, loaded }` (0 to 1) to Glaze's pages. A `download` reply with reason `activation` keeps Download available for another click.
Concurrent prepare calls share one attempt, limited to four minutes; a timeout answers `unavailable` with reason `timeout`.
Its one-time message channel keeps the worker alive until the reply, within Chrome's five-minute request limit.
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
| Model call | 120 s unless the request says; one provider retry for a 429. Confirmed output-size regeneration belongs to the bounded task; uncertain inference never replays. |
| Device status / download | 20 s / 4 minutes per shared attempt |
| Answers | 10 MB across the entire response, including SSE; 64 KB of an error body is read |

While an admitted Chrome device run is active, the broker sends `{ id, type: 'keepalive' }` on its existing port every
20 seconds. Chrome's [worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
allows a silent asynchronous operation to stop after 30 seconds; keeping a port open alone does not reset that timer.
The pulse covers session setup, token measurement and non-streaming inference, including the quiet gaps within staged
Feedback. It stops on completion, failure, cancellation, timeout, connection revocation or port disconnection. The task's
existing deadline still applies; idle ports, warm sessions and endpoint requests start no keepalive. A worker crash or
unexpected termination still requires a fresh user request, with no replay of an uncertain inference.

Chrome's local model exceptions retain fixed reasons: service/execution failures (`OperationError`, `UnknownError`, or
an `AbortError` without an aborted request signal) report provider unavailable with reason `unknown`; safety-filtered
output (`NotReadableError`) reports a refusal with reason `guardrail`. Token-measurement quota errors report `context`.
Actual request cancellation and timeout keep their own categories. These mappings follow Chromium's
[exception helpers](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/ai/exception_helpers.cc);
no native exception description enters a page response or Activity.

Chrome 156 has no public native output-token cap. For structured requests with `maxTokens`, Glaze privately consumes `promptStreaming()` and stops at the first chunk exceeding `4 * maxTokens` UTF-8 bytes. This is an application byte allowance derived from the existing token estimate, not exact generated-token accounting. The partial answer is discarded, the reader cancelled and the request session destroyed. Older implementations without streaming can only reject an overlong completed answer afterward. Fixed `response-limit` diagnostics report observed/allowed bytes, measured input and window; payloads never enter Activity. Feedback and Outline handle a confirmed cutoff with their bounded task repair policies; the provider never retries.

Schema instructions are explicit compact JSON in the actual measured user message, with `omitResponseConstraintInput:true` and the same `responseConstraint` during generation. A native Chrome 156 probe returned the same input count with no schema, a small schema and a large schema, confirming that this build's measurement omitted implicit schema guidance. Explicit guidance removes that hidden overhead while retaining constrained decoding. This follows the [Prompt API options](https://developer.chrome.com/docs/ai/prompt-api) and works around the [M156 measurement implementation](https://github.com/chromium/chromium/blob/156.0.8078.0/third_party/blink/renderer/modules/ai/language_model.cc#L1009-L1041).

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
- The call record (`storage.local aiCalls`) keeps ids, task, feature, provider (the connection's id, or the model on this
  device's provider), the model's id, state, category, status, timing, usage and a tallied row's count: no prompts,
  answers, addresses or keys.

## Warm sessions

The device provider prompts a `clone()` of one warm `LanguageModel` session per system prompt (and sampling and pictures)
for a request with no earlier turns, so the instructions are read once. At most three are kept; each is destroyed two
minutes after its last use, when a call on it fails or times out (not when the caller cancels), and on `release`. Its
`create()` has a signal of its own, since a later abort of a call's signal would destroy it. Without `clone()` each request
has its own session, destroyed after it.

Apple's native side keeps a warm session per instructions (at most four, five minutes each), made and `prewarm()`ed when a
request with those instructions comes, so the next starts on it. A session answers once, since its transcript would carry
that answer into the next request. `{ type: 'ai.release' }` drops them; the worker sends it when a connection changes.
`{ type: 'ai.warm', model, instructions }` makes and prewarms one before any request, or renews one already warm; the
device provider's `warm` does the same with its warm `create()`, never starting a download.

## Safari's Apple provider

An `apple` connection uses `model: 'on-device'`, Apple Intelligence on this device; text stays on the device. It is
registered only on Safari, and needs macOS 27 or iOS 27; older systems return `unavailable` with reason `os`.

Settings offers one **On this device** choice (connection id `device`), and the broker resolves it at each status, test and
run (`lib/ai/broker.js` `onDevice`): Apple Intelligence where Safari registers `apple`, unless its status is `unavailable`
for `off`, `os` or `device` and the browser's own model (`device`) can run; otherwise the browser's model. Status, test and
the call record name the provider it resolved to, and a status for an unavailable provider carries its `reason` (Writer
says "Apple Intelligence is off" for `off`). A saved `apple` (an older `use`, or a model's) reads as `device` (`lib/ai/settings.js` `clean`).

`ai.run` is one native request and reply. Refusals stay `refusal`; a reply reaching `maximumResponseTokens` is marked
`length`, and structured output is refused even if guided generation closed the JSON. Rate and quota limits carry 429.
Schemas are converted to `DynamicGenerationSchema`; the worker validates every answer against the full original schema.
Each object carries its property order to the native side, so guided generation follows the task's order. Omitted optional
properties remain omitted; required nullable properties still accept `null`. Temperature zero uses greedy sampling.
Native messages and errors never log or forward prompt text through diagnostics.

Apple's background budget errors retain the fixed `busy` reason and ask the user to try again in a few minutes. This
classification uses only bounded underlying error domains and codes; it has no HTTP status and is not retried as 429.

Cancel and timeout end the worker's wait immediately and send `ai.cancel` for that request id. Native cancellation is
cooperative and confined to the same extension process; `cancelled: true` means a registered task received cancellation,
not that computation has already stopped. An early cancel is remembered for five minutes (up to 256 ids), duplicate runs
cannot replace an active task, and late output is discarded. A different native process cannot cancel the original task.

On-device errors retain only fixed reason codes and bounded token counts through provider sanitization, broker responses and Activity. Readiness failures receive bounded probe retries and an explicit retry action. Chrome’s API does not provide a detailed hardware reason for every unavailable state; the UI states that limitation rather than inventing one.

Native Apple requests use the reported context size and preflight complete text and schema without cutting input. On
macOS 27.0.1, Apple's token counter throws for image attachments even when inference can read them. Image requests count
their text separately and reserve an estimated 1,024 tokens per image; this estimate is not an exact measured image count.
If the system refuses token counting, the request retains its output ceiling and the model's own context-size check.
