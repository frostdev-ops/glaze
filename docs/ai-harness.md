# AI harness

Glaze's AI is off by default. The service worker caches its scripts at installation and loads them when AI is used; Firefox loads them with its event page. Nothing is sent
until the student has turned AI on, chosen a model for that feature and allowed it. Its conventions follow
[Rimeward](https://github.com/frostdev-ops/rimeward)'s agent harness (MIT), and the files ported from it say so at the top.

| File | Role |
| --- | --- |
| `ai/request.js` | The one request and result shape; cleaners return `null` and never truncate. Error codes. |
| `ai/schema.js` | The JSON Schema subset tasks and tools use; `validate`, `strict`, `parse` (askJson-style), `obj/str/num/bool`. |
| `ai/text.js` | Data fences and the trust rule, grounding, `anchor` (a quote's offsets), `estimateTokens`, `chunks`, `paginateText`, `searchPages`. |
| `ai/stream.js` | `sseParser`, `readSse`, `thinkingCounter`. |
| `ai/failure.js` | Failure categories with a reference, the call record (last 40, metadata only), `bounded`, signals. |
| `ai/endpoint.js` | Endpoint addresses (https, or http to localhost/127.0.0.1), `normalize`, `mask`, connection ids and generations. |
| `ai/models.js` | Catalogs (a server's `/models`, OpenRouter's public list) with provenance, and `select`. |
| `ai/providers.js` | The provider registry and `run`, the one way to call a model. |
| `ai/providers/openai.js` | Any Chat Completions server. A request's `effort` goes as OpenRouter's `reasoning.effort` there and as `reasoning_effort` elsewhere; a model that refuses it gets the next level up (none, minimal, low), then none at all, remembered an hour for that model. `mock.js` is for tests and evals only; the worker never loads it. |
| `ai/providers/device.js` | Chrome's Prompt API (Chrome 138+), in the worker itself. Chrome chooses its built-in model; Glaze retains `gemini-nano` as its compatibility id. Unavailable elsewhere. |
| `ai/providers/local.js` | Glaze's own model on this computer (Rime, Frostdev's fine-tune of LFM3-1.7B, on Glaze's WebGPU engine), Chrome and Firefox; unavailable in Safari. Below. |
| `ai/local/` | Its formatter (`format.js`), the link to its engine host (`link.js`), the host (`host.js`, `host.html`, `offscreen.js`), the store, GGUF reader, tokenizer, engine, picture encoder (`vision.js`), grammar and ladder. |
| `ai/providers/apple.js` | Safari only: Apple's Foundation Models on this device, through the extension's native handler, `GlazeAI.swift`. One reply per request; no tools, no streaming. |
| `ai/tools.js` | Tool definitions, `aiTools` (adds the required `reason`), `invokeReadTool`. |
| `ai/loop.js` | The agent loop: rounds, batch triage, approvals, receipts, repair. |
| `ai/task.js` | Task definitions and `run`. Tasks live in `ai/tasks/<id>.js`. |
| `ai/tasks/syllabus-read.js` | `syllabus.read`: a syllabus's values as written, each with its quote; `planner/syllabus-ai.js` reads them with `planner/syllabus.js` and merges them into the import dialog's review. |
| `ai/tasks/writer-*.js` | Glaze Writer's tasks (below); `writer-context.js` cleans the page's context and writes it as the request's reusable context. |
| `ai/tasks/study-help.js`, `ai/tasks/agent-tools.js` | `study.help` and `agent.tools` (below), which Ask Rime runs. `wording.js`: the wording-offer rules they share with Feedback. |
| `ai/agent/js.js`, `places.js`, `wakes.js`; `vendor/quickjs/` | Rime's own tools (below): run_js and its engine, the places map and the panel's actions, wakes and monitors. |
| `ai/ask.js`, `ai/page/ask.js` | Ask Rime (below): the routing rule, the step loop over Agents' tools and the panel's port in the worker; the panel on the school's page, loaded on demand. |
| `ai/settings.js` | storage.local `ai`: `{ on, outline, sources, mode, model, models, tune, features }` (below), the providers Settings names (`PRESETS`), and `migrate` for an older store. Features: `syllabus`, `completion` (the writer's ghost text), `writing` (its review, feedback, requirements, citations and autocorrect calls), `ask` (Ask Rime). |
| `ai/broker.js` | The worker's broker: the port, admission, connections (IndexedDB), Settings' config messages. |

## Chrome's built-in model

Settings and Writer call this connection **Chrome on-device AI**. The stored `gemini-nano` id is a compatibility id, not a request for particular model weights. Chrome chooses the model behind `LanguageModel`; its public creation options do not expose model identity, version or quality selection. Glaze learns context and input capabilities from the running API instead of assuming them from a model name.

Chrome 156 offers a browser-controlled experiment at `chrome://flags/#gemma4-for-built-in-ai`. Enabling **Gemma 4 for Built-in AI** and relaunching changes the foundational-model route to manifest version `v4`; a subsequent user-initiated Download in Glaze can request its assets. The flag has no size selector. A Gemma component listed as **Pending Usage / Not Installed** is not yet requested, and is not proof that the device cannot run it. Glaze neither changes browser flags nor downloads those optional assets automatically.

The [Chrome 156 flag](https://chromium.googlesource.com/chromium/src/+/156.0.8078.74/chrome/browser/about_flags.cc#4924), [creation options](https://chromium.googlesource.com/chromium/src/+/156.0.8078.74/third_party/blink/renderer/modules/ai/language_model_create_options.idl#137), and [routing test](https://chromium.googlesource.com/chromium/src/+/156.0.8078.74/chrome/browser/ai/ai_language_model_unittest.cc#2728) define this behavior. The separate Summarizer, Proofreader, Writer and Rewriter APIs have their own task contracts; their entries in Chrome's internals are not additional `LanguageModel` model ids.

## Settings → AI

storage.local `ai` (`ai/settings.js`) is `{ on, outline, sources, mode, model, models, tune, features }`. `model` is the overall model,
`{ use, model, effort? }`: `use` a connection's id (a provider's: `openai`, `anthropic`, `gemini`, `openrouter`, `xai`,
`mistral`, `groq`, `deepseek`; `device`, the model on this device; `local`, Glaze's own model; or `custom-1` and on, an endpoint the student added),
`model` its id at that provider (`''` on this device), `effort` the student's. `models` holds a feature's own model in that
shape. A feature runs on its own model, else the overall one (`resolve`); with neither, or a connection with no model id,
none is chosen (`chosen`), its status says `why: 'setup'` and Writer says "No AI model is chosen". `mode` is `simple` or
`advanced`; `tune` holds a feature's `{ temperature?, maxTokens?, context?, timeoutMs?, pause? }` (`pause`, the gray text's
wait in ms, for `completion` only), used in Advanced only (`tuning`) and kept while Simple is on.

Each provider Settings names is an OpenAI-compatible Chat Completions server at its own fixed address (`PRESETS`), kept
with only a key; Anthropic's is asked with its browser header (`anthropic-dangerous-direct-browser-access`), Google Gemini's
at `/v1beta/openai`. Any other id but `device` is an endpoint of the student's own (Advanced), with its name, address and
an optional key. Connect asks the browser for the provider's host from its click, keeps the key, then checks it (`test`)
and reads the catalog (`models`). A key that works fills in what the student hasn't chosen (`ai/settings.js` `suggest`,
`SUGGEST`): the provider's newest main model as the overall one when none is chosen, and as Feedback's own when Feedback
would run on this device; its fast model for Tab completion when the overall model is now its main. No feature turns on.

A model's efforts come from its catalog where the catalog says (OpenRouter's `reasoning.supported_efforts`, DeepSeek's
`effort.supported_levels`, xAI's `capabilities.reasoning_effort`), else from what its provider's docs say of it by name
(`ai/models.js` `RULES`: OpenAI's GPT-5 and o-series, Gemini 2.5 and later, Grok 4.5 to 4.7, Groq's gpt-oss). None
known is none offered, and Settings hides the slider; Anthropic's and Mistral's compatible endpoints offer none, and neither
does a model on this device. The effort thumb shows the student's choice, else completion's `none` or the catalog's stated default; where no default is stated, it shows a separate Default stop without guessing a level. Opening Settings never saves an effort. A run takes the student's effort when its model lists it, else its task's own
(`writer.complete` asks `none`). Reasoning counts against a request's output, so an effort above the task's own adds the
room it thinks in (1,024 tokens for minimal to 8,192 for high, `ai/task.js` `mine`) unless the student set Max output. In Advanced a feature's temperature, max output and timeout replace its tasks' own, and its
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

A document opened from Writer's Documents page (`papers.html?paper=<key>`, in its own tab or as a page of an LMS tab)
loads the same `writer-ai.js`, proofing (`writer/writer-proof.js`, `writer-proof.js`, Harper) and Cite, on a stand-in frame
in `papers.js` with one context object: school and user `local`, the course `papers` (an assignment paper's course name
and title from its stored record), never Ultra's instructions, rubric or attached files, which are read only on Ultra. Its
Feedback therefore shows "No instructions or rubric to check against."; completion, Check with AI, AI outline and
proofing rulings run as in an assignment's frame. Citation lookups serve `papers.html` as they do `writer.html`
(`writer/writer-lookup.js` `pages`).

| Task | Feature | Sends | Gets back, checked |
| --- | --- | --- | --- |
| `writer.complete` (text, streamed; 60 a minute, supersede) | completion | the course name, citation style, discussion or journal prompt, assignment title, instructions and rubric, the thread (posts with their authors, 24,000 characters at most) and the post being answered; then the document so far: the whole text before the sentence being typed as a rolling window, all of it that the model's input window holds after the rest of the request (90% of its catalog or Advanced context, or of the run's 60,000 tokens, the smaller, at four JSON-escaped UTF-8 bytes a token; up to 60,000 bytes of earlier text when no window is known), the earliest paragraphs left out first; then up to 4,000 characters after the caret, to a paragraph's end; the suggestions already shown in this box (the newest 40, as the sentences they would have made, within 5% of the window); and the sentence being typed last. The system, page context and document form a separate text part ending at an explicit cache breakpoint on OpenRouter Anthropic routes; after-caret text, suggestions and the caret sentence stay in a second, unmarked part. Reuse requires an identical prefix and the provider's minimum cache length; actual cache hits are not guaranteed. A model on this computer or with a window under 32,000 tokens gets the sentence, the newest 1,500 bytes of the document so far, the newest three suggestions, the prompt, instructions and post being answered cut to 600 characters, and no rubric, thread or text after the caret. Every model is asked, after a space, for the next words; mid-word, for that word in full and then the next words, so the join is exact; and to reason not at all (`effort: 'none'`) | the rest of the current sentence: mid-word begun with the caret's word, after a space not with a form of it; a reply that repeats the sentence's last words joins only with matching punctuation on the same line; cut at the first sentence end, refused if it is only the sentence's own words again, starts a new sentence or paragraph, repeats the text after or just before the caret, repeats a sentence of the document or a suggestion already shown (six copied words in a row anywhere in the finish, except a reused defined term or capitalized name in document text; or the sentence ending with one whole earlier sentence of at least four words), quotes, cites or links, or runs past 25 words |
| `writer.review` | writing | the draft (in parts when long), the course name, style, prompt and assignment; no thread | at most 40 issues, each anchored to its words in the draft (`text.anchor`), suggestions that replace only those words |
| `writer.feedback` | writing | the draft, the assignment's title, description, instructions and rubric (`courses/rubric.js`'s shape as text); the files its instructions and description attach (Ultra's `data-bbtype="attachment"` links), read by the page for Feedback or quiet image preparation (`writer/writer-context-assignment.js` attachments: at most 6 files, 40 MB, a document's text through `planner/page/import.js`): each document's text as an `attached file: <name>` block (up to 200,000 characters of assignment material in total), and up to 4 pictures read separately through `writer.image` when supported, with only checked descriptions and requirements passed to assessment; unread pictures remain explicit limitations; for a paper, how Writer hands it in (a .docx in the paper's font, size, spacing, margins and header), so file and layout requirements are judged by that and not by the plain text | per rubric criterion (or requirement copied from the instructions, description or an attached document): met, partly or missing, a comment, up to two anchored passages, and the rubric level it reaches (only a level that criterion has, with that cell's points); a comment quoting words in neither the draft nor the assignment is dropped; comments assess and never supply wording (an example sentence, a quoted suggestion, "try writing…", or quoted words the draft and assignment don't hold drops the comment) |
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

`writer.sources` reuses the grounded citation reader for individual bibliography entries, with Feedback’s model and tuning. `writer/writer-bibliography.js` first imports common MLA/APA/Chicago entries locally; unparsed entries retain the original text for review. The Sources view enriches only detected citation text while visible, never rewrites the paper, and protects manual edits/removals and stale replies. Documents (`papers.html`) gets the local importer too.

Feedback uses a bounded orchestration hook for local models, small context windows and oversized inputs. It gathers exact evidence from every supplied material chunk as needed, assesses each rubric criterion separately, then synthesizes the checked findings. Local assessment separates a flat decision (status, evidence IDs, level, points and completeness) from a short explanation using only the selected verified passages and rubric facts. Decision, comment and summary requests have trusted 256-token requested ceilings; evidence scans request 640. Prompts specify exact fields, concise prose and compact JSON. Local comments and summaries aim for one complete sentence of about 30 words, bounded at 240 characters; unfinished prose receives bounded repair. A format preset is descriptive metadata, never proof of imported citation conformance. A selected citation preset is omitted when the hand-in metadata already describes it, or explicitly labeled descriptive; it is never presented as an assignment requirement. A known contradictory explanation can reopen one criterion decision and explanation pair from the original evidence, using two of the existing four repair calls with nested repair disabled. Explicit rubric alternatives and legitimate preset comparisons remain valid. For an unambiguous APA criterion, the existing citation parser can supply exact author-page citation spans and a standalone Works Cited heading as counterevidence; multiple such citations with no author-year or mixed-style signals exclude a fully met status, without forcing a rating or score. Those witnesses reach both the decision and explanation, independently of selected-fact limits. Possessive apostrophes do not delimit quotations; actual quoted wording still requires source grounding. A required citation-style edition must be supported by the supplied rubric or assignment material; descriptive preset metadata cannot establish that requirement. If a complete, validated APA decision with actual rubric points and exact citation counterevidence exhausts its explanation repair on a known validation or response-length failure, a checked local sentence explains that mismatch and preserves the rating. This adds no model call; transport failures, cancellation and invalid or incomplete decisions never qualify. Fallback summaries retain whole checked comments instead of slicing a sentence. Fitting cloud requests retain the single-call path. All child requests share the provider, cancellation, deadline and call budget (64 requests / five minutes); uncertain transport failures never replay. At most four repairs are reserved before assessment; one confirmed application output cutoff may regenerate from the original evidence with shorter-output instructions, consuming that same repair reserve. Completeness describes source coverage, not whether the student met a requirement. A fully read mismatch or missing requirement receives the applicable rubric assessment; verified counterevidence remains available privately for its explanation even when missing requirements show no public draft quote. Input completeness markers survive extraction and attachment transport; genuinely unread or excluded material prevents an overall score. Progress is shown and Cancel stops attachment loading or the active model run.

For a general APA criterion, the lowest-band estimate policy applies only when exact body citations are corroborated by leading names or titles in distinct Works Cited entries, no APA or mixed-style signals are found, and the assignment and rubric supply no descriptors or style exceptions. Narrow subcriteria such as an APA title page do not qualify. The supplied bands must form a complete, strictly ordered generic quality scale. After a complete valid decision, Glaze estimates the lowest actual band for the different citation system, explains the absence of teacher descriptors, and states the actual points deducted. It never assumes zero or claims that the teacher mandated that band. Described rubrics, permitted alternatives and uncertain evidence retain ordinary review.

Outline generations are stored in bounded `paper.outline` metadata (64 content entries, 248,192 serialized UTF-8 bytes total), bound to the verified paper identity, safe model/configuration identity, language and schema version. Saved labels are reanchored against current section contents; the task validates supplied cached ranges and calls the model only for missing sections. Each request asks for only a role and, when needed, a title of at most eight words/80 characters, under a trusted 256-token requested ceiling. Its reserved second attempt may repair a known invalid answer or regenerate a confirmed output-size cutoff. Cancelled, stale or malformed results are never saved.

Feedback errors distinguish criteria, attachment, material and planned-request limits from estimated fit failures and native context failures. Count-only metadata retains the relevant limits without retaining prompts; native failures also distinguish measured input overflow from a context failure while producing a response.

Assignment pictures first pass through `writer.image` (Feedback's route), one image at a time, with a 512-token requested ceiling and a separately validated 512-estimated-token JSON bound. A confirmed output-size cutoff or a completed response contradicting its own completeness flag permits one regeneration from the same image/context, counted against the task's two-call budget or Feedback's shared budget. A complete reading must have an empty limitation reason; a repeated contradiction remains incomplete. Transport failures and native truncation do not trigger this retry. The pass preserves visible requirements, scales, tables and diagram relationships and classifies relevance against compact assignment context. Descriptions can be shorter; omitted facts must still mark the reading incomplete. All subsequent Feedback calls are text only, including the fitting cloud path. Visual formatting requirements receive the same uncertainty checks as textual requirements. `requirements` holds only text visible in the picture: a requirement that is an exact copy of the picture's file name (with or without its extension) or of a whole line of the context block (spacing, wrapping quotes and a final period aside) is dropped from the reading; similar wording stays. A model on this computer (the stock picture model, which copied both) is told the file name is not in the picture and to copy every requirement the picture shows, even when the context says something like it.

`writer-ai.js` prefetches these readings for visible, verified paper assignments only when Feedback is enabled, ready and vision capable. Foreground Feedback joins matching preparation. `ai/visual-cache.js` persists complete readings for 30 days, at most 128, keyed by SHA-256 over the verified school/account/assignment, full task-context fingerprint, image bytes/MIME and reader version. The worker refreshes `/learn/api/v1/users/me` and rechecks the host route before binding cache authority; a stale paper identity cannot read that cache. Raw pictures, account identifiers and assignment context are not persisted by this cache. Incomplete readings have only a bounded memory guard against immediate automatic replay; active task leases preserve it across slow batches. Settings/context changes, hiding the tab, cancellation and teardown stop pending work.

Orchestration's trusted `imageCache` hook receives this worker-bound adapter; page payloads cannot supply cached readings or cache keys. A trusted subrequest can set `maxTokensCap` in both `fits` and `ask`, limiting a larger Advanced output override without affecting later review calls. `writer.image` has its own supersede/rate slot (30 per minute), and Activity identifies image preparation separately.

Paper Feedback also requests a grade-as-is assessment. The assignment transport converts scalar percentage rubrics into actual points only when the assignment has an explicit positive total, all scored weights total 100%, and all level percentages are valid. A 25% row on a 100-point assignment with 100/75/50/25% levels becomes 25/18.75/12.5/6.25 points. Unknown totals, unscored or hidden data and percentage ranges remain explicitly nonpoint facts; no total or range endpoint is invented. Each earned score is checked against the actual rubric row’s maximum, with a named rubric level’s points taking precedence; the overall estimate is summed only when every rubric row has a valid score and the supplied documents were read. The summary uses the same assessment-only checks as criterion comments. Every grade carries either a grounded explanation or a translated, concrete reason for withholding its score. Missing scales, unread documents, incomplete or invalid scores, zero point totals and missing explanations are distinct states. Editing the draft hides the old numeric estimate and marks it stale until the next check.

The frame's results: the gray text after an adaptive pause (about 500 ms; Tab takes it, ⌥→ or Ctrl+→ a word, Esc
dismisses it, typing it consumes it, any other key, a click or an IME composition ends it and the run in flight); Check with
AI (⌘⇧K, the chip's menu and ⋯) sets `GZ_WRITER_ISSUES.set('ai', …)` with positions mapped through every edit since the run
began; `GZ_WRITER_AI.feedbackView(container)` is the Feedback panel; `GZ_WRITER_PROOF.decide` answers `{ verdict: 'apply'|'suggest'|'keep', choice }`, the
choice an index into the candidates (-1 with keep). `GZ_WRITER_AI.requirements(prompt)` and `cite({ text, url })` give the other parts of the
writer those tasks' outputs, or null. `writer/writer-tools.js` declares editor tools (read: document, issues, sources,
assignment; confirm: insert a citation, apply a fix). `agents/writer.js` exposes them to apps allowed in **Settings → AI → Agents**. Stored-document reads use opaque session keys; reading issues and making changes require an open Writer page, and each change waits for approval in Glaze.

## Study help and agent tools

Ask Rime runs both (below); the worker loads them with the harness (`aiFiles`). Both have a token in `GLAZE_TOKENS` (ids
125047, 125048); `glaze-plans/lfm-tune/FORMAT-new-tasks.md` gives their training layouts.

- `study.help`: help with a question about coursework that never gives the answer. Input `{ question, attempt?, subject
  (math, science, code, essay, reading, other), locale? (en, pt-BR, es, fr, de, nl), material?, context?, history? }` (context as
  `writer-context.js` cleans it; history, Ask Rime's conversation so far, reaches a cloud model only). Output `{ kind: hint | question | concept | check-my-step, step: correct | mistake |
  unclear | null, reply, followUp }`. `check` refuses a reply that states the answer (each locale's "the answer is…", the
  correct option, including a bare number or option letter), gives a result one step of arithmetic on the problem's numbers makes or a new equation in its
  variables, writes code with the student's own names, offers wording (`wording.js`, Feedback's rules but "for example,"),
  quotes three words no source holds, or (essay, reading, other) makes a statement that neither speaks to the student nor
  is about their work; `why(output, input)` names the rule, and `hands(text, input)` gives only the answer-giving ones
  (answer, solves, code, wording) for a text that isn't a tutor's reply. Symbolic rearrangements count as steps too; a number merely
  appearing in the attempt does not excuse a new result. Quotations may come from any context block shown to the model,
  including the discussion prompt.
- `agent.tools`: one turn of a small model's tool loop over twelve of Agents' tools and eight of Rime's own (below) (`SPECS`: accounts, courses,
  assignments, an assignment, to-do, schedule, grades, a course's grades, documents, a document, a document's assignment,
  and `todo_mark_done`, the one write, which waits for the student's approval as in Agents). `SPECS.parameters` are
  Agents' `inputSchema` with shorter words (the test holds them equal). Input `{ question, tools (names), steps: [{ call,
  result }], now, zone, locale?, fired? }`; each result is fenced data, its times in the student's zone (`readable`). Output
  `{ call, answer }`, one null: `check` validates a call against its tool's schema and refuses one whose ids no result value or
  the question holds, a repeat, or a call after six steps; an answer's quotes must be in a result and its numbers in a
  result value, the question or the time, preserving signs and the locale's number formatting. Single-character grades
  and scores are valid quotes when they are whole values. History accepts the checked call (including its derived `kind`)
  and normalizes it to `{ name, arguments }`. Unserializable or oversized results, results deeper than 12 levels and
  clocks outside JavaScript's Date range are refused as input. Ask Rime runs each call through Agents' call path and runs the task again
  with the step added (`rate.perMinute` 42: six questions of seven runs a minute in a tab). Glaze's model reads it in LFM3's
  own tool syntax (`layout`, `native`): `ai/local/format.js` writes a run's request in those turns (`fromRequest` reads
  build()'s request back into `layout()`'s parts), each earlier assistant turn opened by FORMAT v2's direct prefill and the
  turn being written by its mode's; the host's grammar holds the turn to the answer's schema or one native call to an
  offered tool (`constraint()`), and the provider reads a native call back as the task's JSON. A stock model reads the
  harness's messages, held to the task's schema.

## Ask Rime

Rime is Glaze's assistant; its voice comes from the fine-tune alone, so no task's instructions name it. Internal ids keep
`ask`: the feature, `#gz-ask`, the port `glaze:ask`. Settings → AI → Ask Rime (`ask`, off by default, its own model or the
overall one). The command palette on Canvas and
Ultra offers **Ask Rime** while AI and Ask are on; it opens a chat in a dialog over the page (`ai/page/ask.js`, loaded on
demand; its sheet is `#gz-ask` in `core/page/apps.css`, in Glaze's tokens, frosted where the Look is and solid on a solid
background) for the student's own click or key, and every control acts only on a trusted event, sending also on user
activation. The panel: four starters while empty, the student's questions, answers drawn from their markdown as elements
(never markup; links only to https, in a new tab) and revealed as they arrive, each tool call as a card on a rail while it
runs, a change waiting on Glaze's approval window as a card of its own (the answer is given only in that window: the
page's own scripts can rewrite what the panel shows), a failure with Try again, Stop, New chat and Copy. Every animation
sits in one block gated on `prefers-reduced-motion: no-preference` and Glaze's Motion not off. The question goes on the
port `glaze:ask` (`background/background.js`, the AI port's sender rules) in the page's language, with the last three
questions and answers for a follow-up; nothing is kept after the panel closes, and Ask or AI turned off closes it.
`GZ_ASK_UI.on(kind, handler)` takes the UI actions a run sends (`{ type: 'action', action: { kind, … } }`) while its
question runs, and `run({ event, question })` asks a question the student didn't type, for their own click only.

`ai/ask.js` `route(question, { attempt, locale })`: agent.tools only for a question about the student's own records (to-dos
and due dates, grades, assignments, Writer documents: word lists in English and the student's locale) that asks for no help
with work and comes with no attempt; else study.help, its subject by symbols and words (code, math, science, essay,
reading, other); at tools level 3 also Rime's own topics (below). agent.tools gets the tools its topics need, at most six (the 4,096-token window of Glaze's own model
holds no more, and training offered three to six). `episode()` runs agent.tools, runs each call, appends the step and
runs again; a seventh call ends it as `steps`. Model runs go to the broker over a channel in the worker, as the feature
`ask` and this sender's: admission, rates and the call record are the broker's. Tool calls go through `agents/calls.js`
with Agents' tools (`mcpCore`; the native link stays off): Ask's switch is the grant of Agents' groups, a result reaches
the model as the tool gave it (calls.js's note, source and age left out, as agent.tools was trained), a failure as
`{ ok: false, error }`, and the one write, `todo_mark_done`, waits for the student in Agents' approval window, with
Glaze's own sentence for it (the window names the asker Ask Rime); any answer but Allow ends the question with nothing changed and no further model run. The
sender is checked again before each call. An agent answer must also pass study.help's `hands()`, so no path hands over
work. Port: `{ id, op: 'ask', question, attempt?, locale, history? }`, `cancel`, `status` (the broker's for `ask`);
events `route { task }`, `step { n, name, kind, state, ms? }` (a call's card: `run`, then `done` or `fail`; a write `ask`
while the approval window waits, then `done` or `no`; never its arguments or result), `approve`, `keepalive` (a local
run's and the approval window's), then `end` (`output`, `answer { text }` or `declined: true`) or `error`. `history`
(`[{ question, answer }]`, six at most) goes to study.help only, which shows it to a cloud model as data before the
question and leaves a local model's request as trained; agent.tools' trained turns hold no conversation, so a follow-up
about records starts afresh.

## Rime's own tools

Fifteen tools Ask Rime alone offers (`agent-tools.js` `OWN`), in the same `<tools>` lines and native calls as Agents' twelve,
so Rime can be trained on them (`glaze-plans/lfm-tune/FORMAT-tools-v3.md`). They have no Agents group, so no app sees them.
Their rules live in their descriptions; the instructions Rime was trained on are unchanged, and a request that offers none
of them is the same, byte for byte. Every parameter is a string or an integer (the native grammar holds no other).

| Tool | Kind | Arguments | What it does |
| --- | --- | --- | --- |
| `run_js` | read | `code` (one line, ≤ 1,000) | QuickJS in WebAssembly (`vendor/quickjs/`, pinned and rebuilt by `tools/build/vendor-quickjs.sh`), run in the extension's background in Chrome, Firefox and Safari alike under the extension pages' `'wasm-unsafe-eval'`. The code sees ECMAScript's builtins and a console, nothing else: no network, timers, storage, messaging, modules or extension APIs. A new runtime and context per run, the engine's whole WebAssembly heap capped at 32 MB and a 512 KB stack, interrupted at 2 s (the background is busy for at most that long); value and console lines share 4,000 characters, 40 lines. The 0.5 MB engine is fetched and compiled on the first run. → `{ ok, value, logs, error?, cut? }`. |
| `places_list` | read | `course?` | The site's pages (Canvas: dashboard, courses, calendar, grades; Ultra: courses, calendar, grades, activity stream; Moodle: dashboard, my courses, calendar, grades), Documents (Writer on), Settings and each course; with `course`, its pages (Canvas: home, grades, assignments, announcements, modules; Ultra: outline, gradebook, announcements; Moodle: home, grades). Paths are the ones Glaze already opens or the sites' own course navigation links. → `{ site, here, places: [{ place, title }] }`. |
| `place_open` | read | `place` | A place on the map → a ui action `{ action: 'open', place, title, url | app }`; anything else refused with the nearest place. |
| `page_highlight` | read | `text`, `note?` | Words on this page (checked against `ctx.text` when given) or on the place just opened → `{ action: 'highlight', text, note }`. |
| `wake_create` | confirm | `at` (local, 2026-10-31 21:00), `say` | Comes back at that time, at most 60 days ahead, 20 at once. |
| `monitor_create` | confirm | `watch` (grade, announcement, due, submitted), `course?`, `type?`, `id?`, `say?`, `account?` | Watches the student's own data for 30 days, 20 at once: due and submitted an item of the to-do list, grade a course in Insights (a new graded point or percent), announcement Canvas's planner (refused on Blackboard). |
| `wakes_list` | read | | What waits: `{ items: [{ id, what, at | watch, about, say }] }`. |
| `wake_cancel` | confirm | `id` | Cancels one. |
| `announcements_list` | read | `course?`, `account?` | Canvas: the to-do list's announcements (storage.local todoCache, its range: `covers`), every course or one; Ultra: one course's, by search's visibility rule, no drafts, in Ultra's `position` order, `at` from `availability.duration.start`, else `modified`, else `created` (a reposted one keeps an older `created`; probed 2026-11-01) (needs `course`). → `{ items: [{ id, title, at, … }], more? }`. |
| `announcement_read` | read | `course`, `id`, `page?` | One, as Glaze's pop-up reads it (courses/announce.js; Canvas's topic, Ultra's public announcement), never the read mark: `{ title, author?, at, text, page, pages, files? }`. |
| `content_list` | read | `course` | Canvas: its modules' items (no headers, unpublished or locked); Ultra: what the student may see now (Ultra search's documents, folders, files, links). `{ items: [{ id, title, kind, module? }] }`. |
| `content_read` | read | `course`, `id`, `page?` | An Ultra item's text, paged, with the names, types and sizes of the files its body embeds (`data-bbfile`: never the signed `resourceUrl`/`viewerUrl`); an Ultra document (a folder with `isBbPage`) is read from its `children`' `ultraDocumentBody` block; a body that is only a file gives `files` and a `note`. Canvas pages and files are refused: unverified, since no Canvas page, syllabus or file response has been captured yet (the local Canvas is down), and nothing is built against a guess. Canvas syllabus text is unverified the same way; `syllabus_read` gives only what an import kept there. |
| `syllabus_read` | read | `course`, `page?` | What Glaze kept from a syllabus import (planner/syllabus.js): instructor, hours, meetings, dates, scale, weights; on Ultra also `document`: the shallowest visible document or file at most three folders down whose title names a syllabus in one of the six languages, read as `content_read` reads one; else how to import. An embedded PDF's text is not read. |
| `discussions_list`, `discussion_read` | read | `course`; `id`, `page?` | Canvas: titles are listed and prompts read only when their author is a teacher or TA of the course (the course's `enrollments?type[]=TeacherEnrollment&type[]=TaEnrollment`, one same-origin GET per course for the page; any failure keeps the refusal, so a classmate's topic never becomes a prompt), with the same reply rules as Ultra below (entries and their `recent_replies`; shapes from Canvas's API documentation, not yet captured live). Ultra: the list as Ultra answers it (id and title only, whatever fields are asked); one discussion's prompt (its `topic`, when available and published), `gradable`, `at`, the student's own replies (`userId` is theirs; at most 3, 300 characters each, page 1; `reply`: it answers a classmate's post, not the prompt) and `others`, the count of classmates' replies. Quoted blocks are removed from the student's replies, and participant names supplied by the topic/messages are redacted from returned text. Classmates' names and posts never leave the tab: they could otherwise reach a cloud provider. |

There is no fill tool: Glaze never fills in the student's work or a site's forms.

`check()` adds, for these tools (`ownWhy`): `work`, run_js that would solve graded work: homework, a worksheet, a quiz or
exam question, a numbered problem or pasted problem text, or an assessment named beside a verb asking for its working
(six languages, `gradedWork`), or after `assignment_read` or `document_read`; the student's own grade math ("what do I
need on the exam to keep a B") runs; `place`, a place no places_list result
named; `text`, highlighted words neither the question nor a result holds; `asked`, a wake, monitor or cancel when the
question makes no affirmative request for that action (mentions and negations do not grant one; cancellation is separate
from creation); `time`, a wake that isn't a time on the student's clock in the next 60 days (`moment`);
`monitor`, a monitor's fields that don't fit what it watches. An answer after run_js still passes study.help's `hands()`
in Ask Rime.

Wakes and monitors (`ai/agent/wakes.js`) live in storage.local `rimeWakes` with their alarms (`gz-rime:wake:<id>`, and
`gz-rime:tick` every 30 minutes while a monitor waits). A monitor compares what Agents' own tool reads for its account
(`todo_list`, `course_grades`) with what it read when it was made; no model runs until one fires. What fired waits until
the student's next school page takes it (`take()`, which checks everything due first), shown inside Glaze, never as a
notification. Safari unloads Glaze's background about 30 s after its last event, so an alarm can come late there; the
page's `take()` still finds it. A fired record runs agent.tools once with `fired: { what, watch?, say, at, fact? }` and
the say as the question: a `fired` data block (its readable JSON) sits between `now` and `question`, grounds the answer as
a result does, and is absent from every other turn. Monitor descriptions (`about`) and the approval sentences come in the
student's language (`ctx.locale`, the i18n tables). Settings → AI → Ask Rime → **Reminders and watches** (`ai.wakes`, on unless turned off):
off, nothing is made, checked or shown. Async reads recheck that switch before saving or delivering. Browser startup and
switch changes reconcile the saved alarms; an existing periodic monitor alarm keeps its cadence. Expired records release
their capacity before creation, and stored records are validated and bounded before use.

In Ask Rime (`ai/ask.js`, `ai/page/ask.js`):

- **The gate.** A local model gets Rime's own tools when its models.json entry says `tools: 3` (`ai/providers/local.js`
  `toolsLevel`, the entry the provider runs). Without it Ask Rime offers Agents' twelve as before, and its routing, tools and
  requests are byte for byte the chat port's (test/ai/rime-ask.test.js compares them with that router). Rime r5's entries
  say `tools: 3` although no round trained it on them: the owner turned them on to try before release (2026-11-01).
  Every other model (an endpoint, Chrome's, Apple's) gets level 3.
- **Tool first at level 3.** Every agent.tools run carries `first`: `check()` refuses an answer with no tool result
  behind it (`first`) and, where any result holds facts (`rich`), an answer quoting none of them (`ground`); an empty or
  failed result holds none, so the answer says only that. Help with work that names the student's records (a course code,
  a lab report, an essay, an assignment, or a records topic) first runs agent.tools' help turn (`help`: study.help's
  subject as a data block before the question; route's `read` tools), whose answer is never shown, then study.help with
  what was read as its `material`. Help naming nothing, and general questions, go to study.help alone. The reads go
  through `agents/tab.js` ops (`announcement`, `search`, `modules`, `topics`) in an open tab of the account's school,
  as Agents' reads do, or Glaze's caches; with no tab open a read says so. Moodle accounts aren't read by the agent layer.
- **The student's week, dates and the conversation at level 3** (the owner's Sunday, 2026-11-01): the `now` block adds the
  windows a student means (today, tomorrow, this week to the coming Sunday or on a weekend the next, this weekend, next
  week, due soon: a week), resolved on their clock; times in results are friendly and localized ("Monday, November 2,
  11:59 PM"; the year only when it isn't now's); an answer that says nothing is due while a result lists work not handed in
  fails (`missed`); agent.tools takes the panel's last three turns (an `earlier` block, 300/600 characters a turn), and
  pushback or a follow-up after an answer ("that's not true", "you missed…", "what about Monday?", six languages) routes as
  the question before it with fresh calls; the system text asks for glaze-plans' MARKDOWN.md answer format, which the
  panel renders. Reminder, notice, watch and cancel phrasings are one table (agent-tools.js `PHRASES`) the router and the
  check share. Level 1 is byte-identical.
- **Known limit, Canvas announcements and discussion prompts:** both are read only when a teacher or TA of the course wrote
  them (the course's enrollments). A course that hides its People list from students shows Glaze no teachers, so there
  `announcement_read` and `discussion_read` refuse ("Glaze can't verify…") until a probe of a real Canvas shows a field that
  marks an announcement on its own.
- **The context window** (ai/ask.js; the owner, 2026-11-01): before each request Ask Rime asks the broker to `count` it
  (Glaze's own model: its tokenizer in the engine host, exactly; a cloud model: text.js's estimate) against the window the
  provider runs with (the configured context, never an assumed 4,096), and posts `{ id, type: 'context', task, used,
  window, reserve, exact }` to the panel (reserve: the answer's max tokens). At level 3 the panel's turns before the last
  two fold into a summary once the next request would pass 70% of the window (or more than three turns are open):
  `chat.compact` (ai/tasks/chat-compact.js, at most six bullets, every bullet resting on a quoted value the turns hold) runs
  between turns with the chat's model; if it fails its check, or the next question comes first, its deterministic
  fallback (the older questions and the items their answers named) stands. agent.tools reads it as a `summary` block
  before `earlier`; study.help (cloud only) as the conversation's first turn. Within one run, results the model has used
  become digests (titles, ids, dates) when the next request would overflow; the latest never does. A question with no
  history (New chat) clears it all. Compaction scales with the window. Level 1 sends nothing new.
  From a 16K window up, a chat offers the union of the tools routed so far (the newest question's always, earlier ones most
  recent first within about 2,000 tokens of `<tools>` lines), so the system turn stays cached across turns; below 16K each
  question gets its own.
- **Routing at level 3** (`TOPICS3`, six languages): announcements, content, syllabus and discussions (their reads), compute (`run_js`; a computing verb in the student's own grade math
  is no help request, but graded work still goes to study.help), navigate (`places_list`, `place_open`, `page_highlight`),
  remind (`wake_create`, `wakes_list`, `wake_cancel`) and watch (`monitor_create`, `wakes_list`, `todo_list`,
  `grades_list`), their tools before records' ones in the six.
- **The call path.** Rime's tools run in the worker, never through `agents/calls.js`, with their `ctx`: the account (the
  call's, else the one on this school's site Glaze read last), zone, locale, the page (its site from the panel, its address
  from the sender), its courses, Writer's switch, the page's visible words (the question carries them, at most 20,000
  characters) and the actions list. A confirm tool asks Glaze's approval window with its own `summarize()` sentence; any
  answer but Allow ends the question with nothing done and no further model run.
- **Cards and actions.** A card shows run_js's value or error, the place opened and the words marked (`detail`). The
  actions (`open`, `highlight`) reach the panel just before the answer's end and run once the answer shows: open goes to a
  place on this site only (or Documents, Settings), a highlight after it carried in the extension's private session storage for a
  minute, bound to the tab and exact destination including its query; highlight marks the words (`mark.gz-ask-spot`, never in Glaze's own panel or cards) and gives the answer a Show
  on the page button. There is no fill.
- **Fired reminders and watches.** On each Canvas or Ultra page with AI and Ask on, `content/content.js` asks the worker
  how many fired (`glaze:rime` peek; with Reminders and watches off, none) and loads the panel only for one or for a carried
  highlight. The panel takes them (`fired` on the port) and shows each as a card in a corner of the page: what it was, the
  student's words, Ask Rime and Dismiss. Ask Rime, the student's own click, runs `run({ question: say, fired: id })`; at
  level 3 that is agent.tools' fired turn with the tools what it watched needs (`routeFired`), else the say as any question.

## Add a provider

One file, `ai/providers/<id>.js`, that calls `GZ_AI_PROVIDERS.add({ … })`:

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
(`background/background.js` `aiFiles`; Firefox loads only the files named there) and in `ai/settings.js` `PROVIDERS`.
Throw errors with a `status` or a `category`; `providers.run` turns them into a failure category with a reference.

## Add a task

`ai/tasks/<id>.js` calls `GZ_AI_TASKS.add({ … })` and is named in `aiFiles`:

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
it, the models on this device ignore it) and `reply: { lang }` (the answer's language, a BCP 47 tag such as `de` or `pt-BR`:
an endpoint adds one line saying it at the end of the system turn; the models on this device are not told, so their prompts
stay what they were tuned on). An orchestrating task's `ask(request, { output, accept })` may check the answer against
`accept`, a looser schema, while the provider still gets `output` (Feedback's comment bound per language). The student's effort and Advanced tuning win over the task's (Settings → AI above). Ground every extracted value in `check` with
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
Settings → AI (`settings/editor-ai.js`) keeps a connection per provider the student connects, `custom-1` and on for endpoints,
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

While an admitted run on a model that downloads to this computer (a provider with `prepare`: `device`, `local`) is active, the broker sends `{ id, type: 'keepalive' }` on its existing port every
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
  `background/background.js`); a writer frame no claim named may not ask. On every message the worker reads that frame's address
  and every address above it in its own document, and the tab's page with `tabs.get`: one LMS site Glaze runs on, never a
  quiet route. The one exception is the tab's own Ultra attempt page (`/ultra/courses/_x_/assessment/_y_/attempt/create`
  or `/_z_`), where only `completion` and `writing` may ask, and only once Glaze's content script in that tab's top frame
  (fromLms's checks, on this route) has sent `{ type: 'glaze:attempt-kind', kind: 'assignment' }` for the page the tab
  shows now. `test`, no word, or an attempt inside another frame (a course tab's) is `attempt`. The word and the seats are
  kept per tab (storage.session too); the word goes when the tab goes to another page, both when it closes. Mods, stickers
  and every other feature stay quiet there.
- Documents in its own tab is a top-level Glaze page. Documents as a page of an LMS tab (`papers.html` in
  `settings/page/settingspage.js`'s frame, `AI_FRAMES`) is judged as the writer frame is: each document it loads claims a
  one-use `glaze:papers` pass that the tab's top frame asked for, and that claim seats it with the broker
  (`aiFrameHost`); on every message the worker also checks it is still the tab's claimed Documents frame
  (`trustedFrame(s, 'papers')`).
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
run (`ai/broker.js` `onDevice`): Apple Intelligence where Safari registers `apple`, unless its status is `unavailable`
for `off`, `os` or `device` and the browser's own model (`device`) can run; otherwise the browser's model. Status, test and
the call record name the provider it resolved to, and a status for an unavailable provider carries its `reason` (Writer
says "Apple Intelligence is off" for `off`). A saved `apple` (an older `use`, or a model's) reads as `device` (`ai/settings.js` `clean`).

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

## Glaze's own model

`ai/providers/local.js` (`local`, Settings' **Rime**) runs Rime, Frostdev's fine-tune of LiquidAI's LFM3-1.7B
(`frostdev-ops/Rime-1.7B-GGUF`: Q4_K_M, Q6_K and Q8_0 at tiers 1, 3 and 4, tier 2 kept for a Q5_K_M), from
`ai/local/models.json` on Glaze's WebGPU engine. caps: `{ text, json, stream, local: true, tools: false, images, context }` (`context`, the window
below; `images` below), so `writer.complete`'s brief path and Feedback's local orchestration apply. Settings, `ai/settings.js`
`HERE` and `writer-ai.js` treat `device`, `apple` and `local` alike as models on this computer: no model id, no key.

Where it runs: Chrome, an offscreen document (`ai/local/host.html`, reason WORKERS, the `offscreen` permission) whose
`offscreen.js` runs `ai/local/host.js` in a dedicated Worker and connects a port `glaze:local` to the worker
(`background/background.js` takes it only from that page of this extension, with no tab); Firefox, `host.js` in a Worker of
the background event page, and while anything is in flight the page calls `runtime.getPlatformInfo()` every 20 s; Safari,
nowhere: status `unavailable`, reason `browser`, and Settings lists no card (Apple Intelligence stays). The host keeps the
weights loaded between requests and, after five minutes with nothing in flight, releases them and says `idle`: Chrome's
document is closed, Firefox's Worker ended. A port that goes ends its calls as `provider-unavailable`, reason `host`; nothing
is replayed. The host page's CSP: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src
'self' https://huggingface.co https://*.huggingface.co https://*.hf.co`; the Worker itself runs under the manifest's
`extension_pages` policy, which leaves `connect-src` open, and `ai/local/store.js` refuses any host but Hugging Face's.

`status` is the worker's and starts nothing: the browser, `navigator.gpu`, a reason a run met (`engine`, `webgpu`,
`hardware`, until a connection changes), then the store: `ready` when the model it runs is downloaded, else `download`,
`downloading` while its prepare runs. The model: the tier Settings' Advanced keeps on the `local` connection (`{ provider:
'local', tier }`), if the catalog still offers it; otherwise Auto: the one downloaded (ready, then partial), else at Download
the ladder's pick. Settings' ops:
`test { provider: 'local' }` → `{ ok, state, reason?, size, tier, tiers: [{ tier, size }], progress?, stale? }`; `stale: true`
means files from a replaced catalog remain, and Settings offers Delete even before Download or when the model is unavailable. `prepare` from the
Download click (progress events as the device's; it answers `downloading` after four minutes while the download goes on in
the host); `delete { provider: 'local' }` removes every downloaded model and ends a download. A failed download answers
`download` with reason `quota` or `network`, so Download stays.

Pictures are a second, optional download on the same card: models.json's `role: 'pictures'` entry (LFM3-VL-2B's own
language model, Q4_K_M, the smallest tier's quant and the one C9b checked end to end) and the `role: 'projector'` file it
names (its mmproj, F16: `vision.js` reads F16 and F32 matrices), fetched and removed together, never a tier and never the
ladder's. Settings' ops take `part: 'pictures'` (`prepare` and `delete`; progress events carry it), and `test` answers
`pictures: { state, size, progress? }`. `status` says `caps.images` and `catalog` says `vision` from it, so the broker's
`cfg.images` and Writer's `caps.images` are true only while both files are here; then `writer.image` (and Feedback's
picture reading) run on Glaze's model. A request with pictures goes to LFM3-VL in its own chat template (`chatml`, it is
stock), each picture after its line as `<|vision_start|>`, its embeddings, `<|vision_end|>`; the host releases the text
model first (one model is loaded at a time), loads LFM3-VL and its projector on the engine's device, decodes each picture
in the Worker (the header checked before `createImageBitmap`, unknown dimensions or over 60 MP refused as in the document
reader; an `OffscreenCanvas` of at most 16.8 MP and 16,384 pixels per side), sizes it (`prepare`; a prompt over the window
is refused before encoding), encodes it and feeds it as prefill `embeds`, then decodes with the JSON grammar as for text.
A cancel ends it at the next encoder stage, prefill chunk or token. A projector that isn't there, or isn't one: reason
`pictures` (Writer: "Picture reading isn’t downloaded."). The text model's next run brings it back.

A run: `ai/local/format.js` writes the request as `[{ special } | { text }]` parts, which the host tokenizes with
`encodeWith` (page text never makes a control token). `ai/task.js` puts `task: { id, version, call? }` on every request (call: an orchestrated request's kind, as `ask`
was given it; writer.feedback's scan, decide, explain, summary) and
`ai/text.js` `fenced: { context, data }`; `ai/request.js` keeps both, no provider sends them, and `estimateTokens` leaves them
out. Dialects: `glaze` (the fine-tune; agent.tools in its own turns, above: `<|startoftext|><|im_start|>system\n<|gz_task:ID|>{system}\n\n{TRUST}[\n\n{schema in
words}]<|im_end|>\n<|im_start|>user\n<|gz_ctx|>label\ntext<|/gz_ctx|>\n…<|gz_data|>label\ntext<|/gz_data|><|im_end|>\n<|im_start|>
assistant\n` and the mode's prefill: direct `<think></think>`, think `<think>\n`), and `chatml` for a `stock: true` model,
whose weights never learnt Glaze's tokens (the harness's messages as written, the schema in words, `<think></think>` after
the assistant header; never think mode). A models.json entry without `stock` (Rime;
`tools/vendor/model-manifest.js` without `--stock`) reads `glaze`. `test/ai/local-format-ids.test.js` holds `glaze` to
`glaze-plans/lfm-tune/FORMAT-v2.md` id for id: for requests each trained task builds, the ids its `train/format.js`
`promptV2` and LFM3's tokenizer give, direct and, for a think task, think (fixture: `tools/dev/local-format-fixture.js`).

Context size (round 8 format): six specials `<|gz_ctx:4k|>` … `<|gz_ctx:128k|>` (ids 125049–125054; `<|gz_task:chat.compact|>`
is 125055; all `[PAD]` rows of LFM3's GGUFs, never produced by text) name the window a glaze-dialect request runs with, right
after the task token: the largest size at or under it. `SCALE` in `ai/providers/local.js` turns them on with the per-size
think budget (`THINK_SIZED`: agent.tools and study.help 128/256/512/1024 at 4K/8K/16K/32K+) and answer reserve (`ANSWER`:
512/768/1024/1536/2048 at 4K/8K/16K/32K/64K+), each capped by the room the window leaves; all off until a model trained
with them ships, so Rime r5's requests are unchanged.

Think mode (FORMAT-v2): a Glaze-tuned model reasons before it answers for the requests `THINK` in `ai/providers/local.js`
gives a budget (256 tokens: agent.tools only; D4 measured p3dpo thinking worse than answering directly on writer.review,
study.help and each writer.feedback call, so they and every other task answer directly; the numbers are beside `THINK`), once this computer decodes that model at `THINK_TPS` (40 tokens a second) or faster; any other run answers directly.
The rate is the host's measure of the model's decoding over a run of at least 16 tokens (a run's `rate`, averaged with the
last), else the ladder's estimate for the model it picked at Download (`tps`); none yet: direct. It is kept per model id in
`storage.session` `aiLocalRates`, and which of them were measured in `aiLocalMeasured`, so they outlive the worker until the
browser closes. 40: a full budget then costs at most 6.4 s, and every machine the ladder measured (79 to 133 tokens a second, Q8_0 to Q4_K_M) thinks at every tier. The host
decodes the reasoning unconstrained but for its own mask (text tokens and `</think>`: never the end token or another
control token) until the model writes `</think>` or the budget is spent, where it feeds `\n</think>` itself; then the
answer, with the JSON grammar as any run. The reasoning is never decoded to text, posted or returned; `maxTokens` counts the
answer only. A Glaze-tuned model's trained window holds the prompt, the close, the reasoning and the answer, think mode or
not: the reasoning keeps its budget while the answer is left at least 256 tokens (or its `maxTokens`, if fewer), and the
answer is cut to the rest (a request asking 4,096 still thinks its 256); a prompt that leaves the answer less runs
as planned in the engine's room (a request whose close that room can't hold is refused before prefill); `usage.output` counts both. `test/ai/local-think.test.js` holds it with a stub engine.
The window a run plans for is its model's: 4,096 tokens for a model without `stock` (FORMAT.md's inference window; the
training data was made at caps.context 4096), 131,072 for a stock one (with an input limit of 90% of that), the picture model included.
`catalog` says the window of the text model the connection runs (its tier's, else the one here) and that model's store id
(`weights`), and, while pictures are here, `pictures.context`; the broker sets `cfg.context` from the first (from the
second for a task that only reads pictures, `writer.image`) and `cfg.weights`, and a text request runs on that model
only (undiscovered, missing or not ready: `provider-unavailable`, `assets`), so a request is never planned for one model and read by
another. A catalog without a selected text model is not cached; the next run discovers a completed download or a recovered
store read. A picture request goes to the picture model whatever the window: its own is the larger. In Advanced a feature's
context replaces the window up to the model's own. The model's own is the context size Settings → AI → Rime's Advanced
keeps on the `local` connection (`window`: 8K, 16K, 32K, 64K or 128K; 4K, the default, isn't stored, so a 4K run sends
what it always did): `windowOf(m, cfg)` makes it the tuned model's window and input limit in the catalog, `caps.context`
holds it, and each run sends it as `window`. A changed size is a new connection generation, so the broker's kept catalog
goes. Settings refuses a size this computer can't hold with `ai/local/ladder.js` `windows` (its `footprint` at that size
against half of `navigator.deviceMemory`: `memory`, or `no-f16` when only the f16 cache fits); the tier pick is unchanged.
The engine host opens its session at the selected size when it exceeds the default 16,000 positions; a warm-up uses the
same size, and changing it releases the earlier session. A status and a
warm-up use the same window as the run (the broker's `sized`), so Writer's status says 4,096 for a tuned model. `test/ai/local-window.test.js` holds `writer.review` and `syllabus.read` through the
broker to lfm-tune's training examples (fixture: `tools/dev/local-window-fixture.js`). The system turn is the prefix kept
warm: up to three per loaded model, as snapshots. Sampling: the request's temperature, else LFM3's GGUF defaults
(temperature 0.1, top-k 50); output up to the request's `maxTokens` (1,024 by default) and refused before reading when the
prompt and output exceed the window (`request-rejected`, `context`).

### Model updates

Glaze ships before Rime is final and takes newer versions without the student doing anything (`ai/local/updates.js`).
Frostdev publishes a signed list beside the weights, `https://huggingface.co/frostdev-ops/Rime-1.7B-GGUF/resolve/main/glaze-models.json`:

```json
{ "list": { "v": 1, "serial": 2, "issued": "2026-11-20T09:00:00Z", "models": [
    { "id": "rime-1.7b-q4_k_m", "name": "Rime 1.7B Q4_K_M", "repo": "frostdev-ops/Rime-1.7B-GGUF", "commit": "<40-hex>",
      "file": "Rime-1.7B-Q4_K_M.gguf", "url": "https://huggingface.co/frostdev-ops/Rime-1.7B-GGUF/resolve/<commit>/Rime-1.7B-Q4_K_M.gguf",
      "size": 1099627200, "chunk": 67108864, "sha256": ["<64-hex per 64 MB chunk>"], "total": "<64-hex>", "license": "lfm1.0",
      "quant": "Q4_K_M", "tier": 1, "tools": 3, "minGlaze": "4.0.3", "version": "r6" } ] },
  "sig": "<Ed25519 over utf8('glaze-models-1|' + canon(list)), base64url>" }
```

`canon` is JSON with keys sorted and no spaces. Glaze takes a list only if the signature verifies (WebCrypto Ed25519)
against `updates.js` `KEY` (SHA-256 `070eb5374fb18fe2b5880643eb7d5c42bf517667c9d3b0c08447b338b2891e7c`), its serial is above
the one held, and every entry is a models.json text entry with `tools`, `minGlaze` and `version`, ids and tiers once each;
entries needing a newer Glaze or a tools level above `TOOLS` (3) are skipped. A newer version keeps its size's id (a new id
may only add a tier models.json doesn't hold). models.json stays the starting list and the fallback; offline, or with
Hugging Face down, everything runs on what's stored.

State: `glaze-models/~updates.json` in OPFS beside the models (`store.js` `edit`, under the Web Lock `glaze-model-updates`):
the accepted list's usable entries, `pins` (each downloaded id stays on its version until a swap), `keep` (versions kept
beside it), `trial` and `failed`. `store.js` `compose` makes every context's catalog from models.json and that file; each
version of an id is its own tag folder, so the old one stays while the new one downloads.

Schedule and guards (`background/background.js`): the alarm `gz-models:daily` (every 1,440 minutes, made once), and
`gz-models:start` 2 to 10 minutes after the browser starts (skipped when a check ran in the last 20 hours, unless a download
waits to resume). A check does nothing, and asks nothing of the network, unless this browser holds a downloaded Rime model,
`ai.updates` (Settings → AI → Rime, Advanced: **Update automatically**, on by default) is on, it isn't Safari, and Data Saver
is off. It fetches the list without cookies or cache, verifies it, and when the model in use (Advanced's tier if
downloaded, else the downloaded one) has a newer version, hands the list to the engine host (op `update`). The host verifies
again, downloads the version beside the old one through the store (Range resume across restarts, per-chunk and whole-file
SHA-256, the quota checked first: reason `quota` and the next check tries again), waiting before each chunk while a run or
warm-up is in flight, then swaps at the next idle moment (after the runs queued before it) and lets the engine go. The old
version stays until the new one has loaded and answered once, then goes. If the new one fails to load or run (`assets`,
`engine`, or an engine error of its own), the old one comes back, the run goes again on it when nothing of its answer was
sent, and that version isn't tried until a newer serial. A version whose chunk fails twice, or whose whole hash is wrong,
is dropped the same way. The tools level follows the version in use (`levelOf` reads its entry). Settings asks `{ op:
'updates', provider: 'local' }` → `{ auto, version?, update?: { version, progress } }`; progress events carry `part:
'update'`. Delete removes every version and the state's pins and spares; the serial and failures stay.

### Publishing a model

Every publish happens only after the owner's go.

1. Upload the GGUFs to `frostdev-ops/Rime-1.7B-GGUF` and note the commit.
2. Build each size's entry: `node tools/vendor/model-manifest.js --repo frostdev-ops/Rime-1.7B-GGUF --commit <sha> --file
   Rime-1.7B-Q4_K_M.gguf --tier 1 --tools 3 --version r6 --min-glaze 4.0.3 --out ~/glaze-models/entries.json` (once per
   quant, into the same file; keep each size's id).
3. Sign: `node tools/vendor/model-manifest.js --sign --entries ~/glaze-models/entries.json --key ~/.glaze-signing/models.key
   --out ~/glaze-models/glaze-models.json`. The serial is one above the published list's (`--serial` to set it, `--offline`
   without the fetch); it refuses a key other than `KEY`, a serial at or below the live one, and entries out of the schema.
4. Upload `glaze-models.json` to the repo's `main`. Browsers with Rime take it within a day.

The key pair was made with `--keygen ~/.glaze-signing/models.key` (mode 600, outside the repo); its private half is never
printed, committed or logged.

### The engine, grammar and ladder the host uses

`ai/local/engine.js` (`GZ_AI_ENGINE`), loaded in the host's Worker after `quant.js` and `reference.js`:

```js
GZ_AI_ENGINE.load(gguf, { context, signal, onProgress? }) → Promise<model>
  // gguf: GZ_AI_GGUF.open(store.open(id)); context: positions allocated initially; reserve grows the live sequence.
model.context                                   // the positions allocated now
model.reserve(n, most) → Promise<number>         // grow without losing the sequence, up to most
model.common(ids) → number                       // length of the common held prefix
model.extend(ids, { at?, signal, step?, pace? }) → Promise<{ reused, fed }>
  // Keep the common prefix, rewind to a light mark if needed, feed only the rest; at: token positions to mark.
model.prefill(ids, { snapshot?, signal, step?, pace? }) → Promise<snap | undefined>
  // ids: Uint32Array fed at the next positions; afterwards the model holds the logits for the next one.
  // snapshot: true → resolves to a snapshot of the state after them.
model.decode({ sampler: { temperature, topK, topP?, repetitionPenalty? }, mask?, signal }) → Promise<id>
  // Samples one id (temperature 0: greedy); mask: a Uint32Array, or a function returning one once the previous
  // token's forward is submitted. Token i allowed when bit i & 31 of word i >> 5 is set; never written.
  // The selected id is fed by the next decode or prefill.
model.snapshot() → Promise<snap>;  model.restore(snap) → Promise<void>  // positions after snap.pos are dropped
snap: { pos, drop() }                           // drop frees what it holds; the host drops each one it lets go
model.release()                                 // frees every GPU resource; the model is not used again
// load rejects with signal.reason on abort, else an Error whose reason is 'webgpu' | 'memory' | 'lost' | 'model'
// (the provider says webgpu | hardware | engine | assets).
```

`ai/local/grammar.js` (`GZ_AI_GRAMMAR`): per model `vocab(tokenizer.byteStrings(), { eos: [id], marks })` (`marks`, the
ids of LFM3's tool tags, `TOOL_MARKS`), per schema `compile(schema, vocab, { tools?, sources? })` (a refusal: `request-rejected`,
reason `unsupported`), per run `matcher()` with `mask()`, `advance(id)`, `complete`, `done`; the mask allows the end token
only once the JSON is whole, so a run stops at the end token. What it lets through `validate()` accepts, an anchored ASCII
`pattern` included (one it can't hold leaves `exact: false`). A run's `tools` (`agent.tools`' `constraint(input)`) make the
answer either that JSON or one native call to a listed tool, each parameter held to its own schema, so a turn the engine
writes is one `fromNative()` reads and `OUTPUT` takes; `test/ai/agent-tools-grammar.test.js` holds it. A string with
`span: { source, min?, word? }` (`ai/schema.js`) is held to words of `compile`'s `sources[source]`, cut where `ai/text.js`
folds them alike: `providers/local.js` finds the task's own schema by `task.id` (a request carries it `bare()`, so no
provider is sent the keyword) and passes the data block of that label as the model reads it; writer.review's and
writer.feedback's quotes, syllabus.read's and every writer.cite value use it (`test/ai/local-grammar-span.test.js`). `ai/local/ladder.js`
(`GZ_AI_LADDER`): `pick({ adapter, models }) → { id } | { reason }`, `adapter` the Worker's `requestAdapter()` (null without
one), `models` the store's list. The grammar and `ai/schema.js`, which it reads as it loads, are the host's required imports
(`IMPORTS` in `host.js`; `test/ai/local-host-worker.test.js` runs them as the Worker does): a run with a schema and no grammar
is `provider-unavailable`, reason `engine`, never a run in words only. The others are optional until they ship: no engine is
`unavailable`, reason `engine`; no ladder, the smallest tier where there is an adapter.

The host's messages (`host.js` header): `prepare { tier?, part? }`, `run { model, parts, stable, schema?, sources?, sampler, maxTokens,
projector?, images?, think?: { budget, close, after }, window?, priority?: 'low' }`, `warm { model, parts, stable?, window? }`, `remove { part? }`, `release`, `cancel`; it answers `progress`, `delta`, `done` or `error`, `tick` every 20 s
while anything is in flight, and `idle`.

The host starts with 8,192 allocated positions and grows only when a request needs more, up to its requested window
(at least 16,000 physical positions, at most 131,072). Text requests retain one sequence across runs: common history is
kept, and a changed suffix rewinds to a light checkpoint of convolution state, sliding-window keys/values and logits.
Checkpoints sit at the system turn, selected turn boundaries and sparse 2,048-token positions; a checkpoint splits a
prefill, so the host avoids placing one at every conversation marker. `usage.cached` reports prompt positions already held.
Warm-up may include history after its `stable` system turn; an incoming run cancels background reading before taking over.
`writer.complete` and explicit low-priority runs use small adaptive prefill submissions, wait for their GPU completion and
yield between them, aiming for about 20 ms each. Decode also yields, and cancellation is observed between submissions.
The grammar mask is built after the preceding token's GPU forward is submitted, overlapping CPU grammar work with it.
Integer dot-product and experimental subgroup-matrix candidates are optional. On each engine/device load, they must
match the normal matmul on the loaded model's representative matrices and run at least 10% faster, including activation
packing, before that exact matrix/tile shape can use them. Unsupported, inaccurate, slower or failed candidates retain
the normal f32/f16 path. No hardware speedup follows from feature support alone.

What needs a real GPU or browser: the engine's numbers and speed, the ladder's tiers, Firefox's event page staying while its
Worker works (measured nowhere yet), and Chrome closing an idle offscreen document. `checks/ai/local-provider-check.js`
covers the rest in Chromium with a stub engine.

