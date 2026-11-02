# Ask Rime memory

Settings → AI → Memory controls Ask Rime's saved memories and course cache. Memory starts on when Ask Rime is enabled.
It can be turned off without deleting existing records. Management controls remain available while AI is off.

Saved memories are short Markdown records, each with an independent identity and revision. Rime may save a useful fact
or preference from the current user's message. An exact supporting excerpt establishes where it came from; the model
still has to select and summarize it faithfully. A saved-memory receipt appears only after storage succeeds. The user
can edit or delete it without a model request. Manually edited records resist later automatic replacement.

The course cache contains excerpts from successful assignment, announcement, content, syllabus and discussion reads.
Only the supported reader's known fields are retained. Discussion classmates' posts, personal drafts and arbitrary
page text are not indexed. An excerpt retains its source, observation time and partial-read status. It is evidence of
what was read then, not proof of a current grade, deadline or submission. Those questions still require the ordinary
school tools. A missing match never means Glaze has read every course or that no work exists.

## Storage and retrieval

`ai/memory.js` stores one JSON envelope with Markdown content per `storage.local` key. Saved memories use
`rimeMemory:<origin>/<user>|m-<32hex>`; device-local course material uses `rimeMaterial:<origin>/<user>|s-<32hex>`.
All model access receives a freshly verified school account from the worker. Current page titles, cached account lists
and model arguments cannot select a different account. Trusted extension Settings can manage all stored accounts,
including after logout. Google account binding selects the sync destination, not the school account a memory belongs to.

Retrieval is a bounded Unicode lexical search over the readable records. Pre-turn retrieval includes matching material
and reusable preferences, with at most three records and a small context allowance. The exact constructed model request
is counted before sending; optional recall is reduced when it does not fit. No embedding service or vector database is
required, and the retrieval index is disposable. Recall is an untrusted data block, separate from instructions and
conversation compaction. Current user instructions take precedence. Recall grants no permission and cannot authorize a
tool action. Agent answers retain the existing tool-first rule; study help may use remembered preferences while keeping
its tutoring restrictions.

Automatic saving uses a separate short, optional tool pass at every context size. Its durable receipt appears
immediately, while the main school request keeps its required tools and answer budget as later tool results arrive.
Explicit memory-management requests keep their own memory tools.

The four private tools are `memory_search`, `memory_read`, `memory_save` and `memory_forget`. A save uses a bounded
current-message excerpt and may classify the record as a preference or fact. Corrections and deletion require the
record's current revision. The model can forget a record only when the current user directly requests forgetting;
automatic saving does not authorize automatic deletion. Successful writes return a device receipt; failures cannot be described as remembered or
forgotten. Used record revisions are checked again before a reply is published. Switching Memory off, editing, deleting
or clearing invalidates pending producers so earlier work cannot restore removed content.

## Sync and retention

Saved memories use Glaze's existing Drive record sync when enabled and are included in backup files. Each record syncs
independently. Conflicting active edits converge deterministically; a content-free deletion marker wins over an older
copy when the device receives both, including on first sync or backup restore. A fresh installation restoring an old
backup cannot know about a later deletion until it receives that marker. New explicit memories receive new identities. Drive acknowledgement is
separate from a local save receipt. Course excerpts and derived search data never enter Drive or backups.

There is no timed expiry. Saved memories are bounded to 500 active records per school account, with at most 600
characters each. Each account's course cache holds at most 250 sources with at most 20,000 characters per source,
within a 2 MiB active-record allowance for each kind of record. Full stores report a limit rather than silently discarding
saved memories. Deleting active content does not remove earlier exports, backup files, provider-side data or messages
already shown in the open conversation. Export produces Markdown; no model or network request is needed.

Forgetting an individual course source suppresses that source from being saved again. Clearing the course cache
removes the selected cached sources and its suppression markers; fresh verified reads can then refill it. Removing a
school from Glaze purges that school's course cache. Saved memories remain available in Settings for explicit deletion.

Memory applies only to Ask Rime in this version. Writer's AI features do not consume these records. Runtime contracts
and changes must be reflected in the model's training and evaluation before a model is published; runtime test success
does not establish that an untrained model uses the tools correctly.
Local models declare the supported memory contract separately from general tool support, using `memory: 1` in their
model metadata. Missing or unsupported versions leave ordinary Ask available without memory recall or tools; existing
model entries are not relabeled as trained. The capability follows the downloaded model version through update and rollback.
