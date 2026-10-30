# PDF viewer review, 2026-10-30

Worktree: `/Users/jame/Projects/glaze-pdf-review-viewer`, branch `pdf/review-viewer`.
Reviewed tip: `84d46fa3`; base: `38a8b816`, with the reviewed PDF document lane merged.
Only this worktree was edited. No stash, push, merge, attribution lines, or changes to `lib/pdfjs/*`, `lib/pdf-doc.js`, or `scripts/vendor-pdfjs.sh`.

## Commit dispositions

Source links point to the repaired code. Reproductions and all check counts follow.

| Reviewed commit | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| `0a60594b` | Switch regression tests | — | no finding |
| `e62f2cc2` | Default off, Settings placement, catalogues and first-script allowance | — | no finding |
| `013ca10a` | Registry/storage/viewer checks; extended below for discovered failures | — | no finding |
| `95e0ecb9` | Localization coverage tests | — | no finding |
| `ef5a812c` | Complete ID map, catalogue labels and quiet helper/editor messages | — | no finding |
| `333a84f6` | Stored-byte bounds, fallback CSP, save/navigation races, Trash edits, Escape, timers, named region and documentation (F1–F10 below) | P1–P3 | fixed in the individual commits below |
| `59f50626` | Writer browser inventory omitted `writer.pdf` ([script:87](../../scripts/settings-writer-check.js#L87)); both scheme checks failed | P3 | fixed in `0f324a57` |
| `9815ceae` | Switch-off regression | — | no finding |
| `dde09e28` | Kept PDFs open while only import is gated | — | no finding |
| `86a5210e` | Late-registration contract comment | — | no finding |
| `8b8a2185` | GZ_PDF_DOC open/save/thumbnail wiring; task remains owned by the viewer | — | no finding |
| `84d46fa3` | Refit only active width/whole-page presets on resize | — | no finding |

## Verified findings

| ID | Finding and evidence | Severity | Test commit | Disposition |
| --- | --- | --- | --- | --- |
| F1 | STORE.get decoded arbitrary stored base64 and threw on malformed input. Encoded length, declared size and decoded size are now bounded; malformed records return null ([pdf-kind.js:36](../../pdf-kind.js#L36)). Regression produced two failures against the old source. | P2 | `8db71bed` | fixed in `473ad728` |
| F2 | A refused module worker falls back to the page, where the old CSP blocked WebAssembly. Forced failure produced `LoopbackPort` with `wasm:false`; the repaired page produces `wasm:true` ([papers.html:5](../../papers.html#L5)). | P2 | `23c91dc6` | fixed in `52d2c40d` |
| F3 | Documents navigated in finally even after a quota refusal, losing the unsaved form. It now requires a successful flush; export also waits for success ([pdf-kind.js:301](../../pdf-kind.js#L301)). The real worker refusal check keeps the edited field and last good bytes, then verifies retry. | P1 | `92c92c8a` | fixed in `90775b3e` |
| F4 | pdf.js calls onSetModified only once before its save resets the flag. A second input during the first byte snapshot was dropped: reopening showed `First edit`. Native input/change tracking and a draining save queue now reopen `Second edit` ([pdf-kind.js:285](../../pdf-kind.js#L285)). | P1 | `0685c420`, harness correction `942695aa` | fixed in `bfda1dbf` |
| F5 | Embedded Close removed the frame before its storage write acknowledged; pagehide also destroyed its PDF worker before attempting the final save. A held write reproduced premature removal. Close/Escape/frame history now defer through a shared event; cleanup follows flush, and native unload protects unsaved work ([papers.js:814](../../papers.js#L814), [pdf-kind.js:306](../../pdf-kind.js#L306)). The held-write Close check now passes and reopens the filled value. | P1 | `0685c420`, fixture correction `3d681675` | fixed in `eb8a0602` |
| F6 | PDF byte changes did not count as document edits, leaving a newly filled PDF in Trash and eligible for purge. Changed bytes now restore it; renames and identical bytes stay in Trash ([writer-papers.js:148](../../lib/writer-papers.js#L148)). Regression includes a purge 31 days later. | P2 | `91735d81` | fixed in `b4474f09` |
| F7 | PDF sub-minute timeouts lacked a reviewed timeout budget. The event-driven one-second save debounce is now listed with its clear ([perf-budget.test.js:363](../../test/perf-budget.test.js#L363)); the zero-delay change timer is removed. Download URLs have a 60-second maximum and clear/revoke on pagehide ([pdf-kind.js:140](../../pdf-kind.js#L140)). | P3 | `91735d81` | fixed in `d8342ea6` (zero-delay timer removed in `bfda1dbf`) |
| F8 | Escape only closed Find while its input owned focus. With focus on Zoom, Find stayed open and an embedded frame could handle Escape as departure. The document handler now closes Find before departure ([pdf-kind.js:259](../../pdf-kind.js#L259)). Browser regression failed outside the input, then passes. | P2 | `91735d81` | fixed in `2972fe71` |
| F9 | The focusable scroller's aria-label had no supporting role, so the named region was absent from the accessibility tree. It is now a region ([pdf-kind.js:173](../../pdf-kind.js#L173)); the browser role query failed before the fix. Individual pages remain named regions too. | P3 | `c4d40796` | fixed in `40fb5780` |
| F10 | The guide implied all Documents were backed up, while backup deliberately skips PDF records ([backup.js:131](../../lib/backup.js#L131)). The guide now states the exclusion and the shipped PDF limits and behavior ([features.md:133](../features.md#L133), [features.md:143](../features.md#L143)). | P3 | Prose correction, verified against backup and viewer code | fixed in `a740c027` |

Executable regressions were committed before their fixes. The stored-byte red run was replayed against `8db71bed:pdf-kind.js` in a VM, without switching worktrees or stashing. Its initial assertion spent too long formatting a multi-megabyte diff and was terminated; `d8915326` bounds that diagnostic. Browser harness corrections are explicit commits and are not counted as product defects.

## Security, data and runtime conclusions

- Dynamic imports and workerSrc are fixed runtime.getURL paths ([pdf-kind.js:51](../../pdf-kind.js#L51)). Chromium's actual worker is verified as a module worker by importScripts throwing in its module context, beyond checking the `.mjs` filename.
- The pinned PDFWorker catches construction/handshake failure and imports the internal worker in the page ([pdf.mjs:22577](../../lib/pdfjs/pdf.mjs#L22577), [pdf.mjs:22614](../../lib/pdfjs/pdf.mjs#L22614)). Its image/color decoders compile WebAssembly ([pdf.worker.mjs:7376](../../lib/pdfjs/pdf.worker.mjs#L7376)). The fallback check opens a real PDF and compiles a minimal Wasm module; it does not exercise every image decoder. `wasm-unsafe-eval` is the only added CSP permission. JavaScript eval, remote scripts and blob scripts remain disallowed.
- Safari/Firefox reasoning is source-based, with module-worker refusal simulated in Chromium. Native Safari/Firefox PDF runtime was not exercised. On engines whose extension URL.origin is null, the vendor origin check can attempt its blob wrapper before the page policy rejects it and pdf.js takes the fallback. This is a conditional source path, not an observed native-browser finding ([pdf.mjs:22512](../../lib/pdfjs/pdf.mjs#L22512)).
- PDF scripting remains disabled: the viewer has no scripting manager and AnnotationLayer defaults enableScripting to false ([pdf_viewer.mjs:6608](../../lib/pdfjs/pdf_viewer.mjs#L6608)). Links open `_blank` with `noopener noreferrer nofollow` ([pdf-kind.js:184](../../pdf-kind.js#L184)); the worker validates protocols, excluding javascript ([pdf.worker.mjs:5771](../../lib/pdfjs/pdf.worker.mjs#L5771), [pdf.worker.mjs:47610](../../lib/pdfjs/pdf.worker.mjs#L47610)). SubmitForm actions are ignored ([pdf.worker.mjs:47597](../../lib/pdfjs/pdf.worker.mjs#L47597)).
- ENABLE_FORMS, disabled editors and enablePermissions remain explicit ([pdf-kind.js:187](../../pdf-kind.js#L187)); the viewer consults COPY and form-fill permissions ([pdf_viewer.mjs:13224](../../lib/pdfjs/pdf_viewer.mjs#L13224)). Form values remain in local record bytes. Normal PDF checks report zero network requests, sender refusals or page errors.
- STORE.put/get remains the only byte encoding/decoding seam. Copies contain immutable base64 strings ([writer-papers.js:28](../../lib/writer-papers.js#L28)). Existing copy/removal/purge and quota atomicity tests pass. Home reads remain bounded to 12 records per batch, thumbnails keyed by revision ([papers.js:361](../../papers.js#L361)). Controlled departure waits for bytes and thumbnail in the same acknowledged save. Native navigation uses beforeunload protection while dirty/saving; it cannot await a write invisibly.
- The 640 px page-width layout and reduced-motion checks pass. Find's status region, toolbar labels, quiet localization coverage, the five translated size strings, and Firefox HTML-sink checks pass. No newly verified repair needs were identified in the forbidden lanes.

## Check results

Evidence is local and ignored under `release/pdf-review/`. The table below preserves final count lines for every run, including red checks and harness failures.

| Run | Verbatim final counts/status |
| --- | --- |
| Requested local checks, baseline ([log](../../release/pdf-review/local-baseline.log)) | `ℹ tests 150`<br>`ℹ suites 0`<br>`ℹ pass 150`<br>`ℹ fail 0`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Initial stored-byte test, interrupted during assertion formatting (tool transcript) | `ℹ tests 1`<br>`ℹ suites 0`<br>`ℹ pass 0`<br>`ℹ fail 0`<br>`ℹ cancelled 1`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Stored-byte regressions against original source ([log](../../release/pdf-review/store-red.log)) | `ℹ tests 7`<br>`ℹ suites 0`<br>`ℹ pass 5`<br>`ℹ fail 2`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Stored-byte fix ([log](../../release/pdf-review/store-green.log)) | `ℹ tests 7`<br>`ℹ suites 0`<br>`ℹ pass 7`<br>`ℹ fail 0`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Manifest CSP regression ([log](../../release/pdf-review/csp-red.log)) | `ℹ tests 12`<br>`ℹ suites 0`<br>`ℹ pass 11`<br>`ℹ fail 1`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Fallback before CSP fix ([log](../../release/pdf-review/csp-browser-red.log)) | `FAIL pdf-check: 31 checks` |
| Manifest CSP fix ([log](../../release/pdf-review/csp-green.log)) | `ℹ tests 12`<br>`ℹ suites 0`<br>`ℹ pass 12`<br>`ℹ fail 0`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Quota regression ([log](../../release/pdf-review/save-red.log)) | `FAIL pdf-check: 27 checks` |
| Quota and CSP fixes ([log](../../release/pdf-review/save-green.log)) | `PASS pdf-check: 35 checks` |
| Overlap harness missing core import ([log](../../release/pdf-review/race-red.log)) | `FAIL pdf-check: 30 checks` |
| Close harness malformed fixture and cascading failures ([log](../../release/pdf-review/close-red.log)) | `18/23 Documents page browser checks passed` |
| Overlap regression, corrected harness ([log](../../release/pdf-review/race-red-2.log)) | `FAIL pdf-check: 30 checks` |
| Close harness diagnostic, fail fast ([log](../../release/pdf-review/close-red-2.log)) | `No aggregate emitted (CHECK_FAIL_FAST=1); failed at PDF Close waits for the filled file to reach storage.` |
| Overlap fix ([log](../../release/pdf-review/race-green.log)) | `PASS pdf-check: 36 checks` |
| Close regression, corrected fixture, fail fast ([log](../../release/pdf-review/close-red-3.log)) | `No aggregate emitted (CHECK_FAIL_FAST=1); failed at PDF Close waits for the filled file to reach storage.` |
| Close harness deleted its held-write function too soon ([log](../../release/pdf-review/close-green.log)) | `17/23 Documents page browser checks passed` |
| Timeout budget and Trash regressions ([log](../../release/pdf-review/perf-trash-red.log)) | `ℹ tests 50`<br>`ℹ suites 0`<br>`ℹ pass 48`<br>`ℹ fail 2`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Trash fix ([log](../../release/pdf-review/trash-green.log)) | `ℹ tests 38`<br>`ℹ suites 0`<br>`ℹ pass 38`<br>`ℹ fail 0`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Timeout budget fix ([log](../../release/pdf-review/perf-green.log)) | `ℹ tests 12`<br>`ℹ suites 0`<br>`ℹ pass 12`<br>`ℹ fail 0`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Find Escape regression ([log](../../release/pdf-review/escape-red.log)) | `FAIL pdf-check: 14 checks` |
| Close fix, corrected held-write harness ([log](../../release/pdf-review/close-green-2.log)) | `23/23 Documents page browser checks passed` |
| Named-region regression and module-worker assertion ([log](../../release/pdf-review/region-red.log)) | `FAIL pdf-check: 11 checks` |
| Requested local checks, final ([log](../../release/pdf-review/local-final.log)) | `ℹ tests 154`<br>`ℹ suites 0`<br>`ℹ pass 154`<br>`ℹ fail 0`<br>`ℹ cancelled 0`<br>`ℹ skipped 0`<br>`ℹ todo 0` |
| Safari mirror before refresh ([log](../../release/pdf-review/safari-before.log)) | `safari-resources: all 558 staged files are bundled by both extension targets`<br>`error: Direct Xcode resources are stale. Run bash scripts/sync-safari-resources.sh --refresh from the source checkout.` |
| Safari mirror refresh ([log](../../release/pdf-review/safari-refresh.log)) | `safari-resources: all 558 staged files are bundled by both extension targets`<br>`Refreshed direct Xcode resources from the current Safari package.` |
| Safari mirror after refresh ([log](../../release/pdf-review/safari-final.log)) | `safari-resources: all 558 staged files are bundled by both extension targets`<br>`Direct Xcode resources match all 558 current Safari package files.` |
| Final PDF run 1 ([log](../../release/pdf-review/pdf-final-1.log)) | `PASS pdf-check: 37 checks` |
| Final PDF run 2 ([log](../../release/pdf-review/pdf-final-2.log)) | `PASS pdf-check: 37 checks` |
| Final Documents ([log](../../release/pdf-review/documents-final.log)) | `documents-check: 270 passed, 0 failed` |
| Final Settings wiring ([log](../../release/pdf-review/settings-wiring-final.log)) | `262/262 settings wiring checks passed` |
| Writer inventory regression ([log](../../release/pdf-review/settings-writer-final.log)) | `10/12 Settings → Writer browser checks passed` |
| Final embedded Documents ([log](../../release/pdf-review/documents-page-final.log)) | `23/23 Documents page browser checks passed` |
| Full runner suite ([log](../../release/pdf-review/suite-final.log)) | `ℹ tests 6631`<br>`ℹ suites 0`<br>`ℹ pass 6610`<br>`ℹ fail 5`<br>`ℹ cancelled 0`<br>`ℹ skipped 16`<br>`ℹ todo 0` |
| Writer inventory fix ([log](../../release/pdf-review/settings-writer-fixed.log)) | `12/12 Settings → Writer browser checks passed` |

The full suite's five failures are exactly the authorized exclusions:

- `test/backup-check.test.js`: completed install/startup; pending newsSeen; pending navbarSeen; startup write that never completes.
- `test/check-env.test.js`: installed polls until each install task's last write.

No other suite failures occurred. The full-suite snapshot preceded the one-line Writer browser-inventory correction; the corrected inventory then passed all 12 browser cases. Runtime source and local unit-test inputs did not change after their final checks.

## Fix and test commits

```text
8db71bed Test stored PDF bounds before decoding
473ad728 Bound stored PDFs before decoding and refuse malformed bytes
d8915326 Keep oversized PDF regression diagnostics bounded
23c91dc6 Test WebAssembly in the PDF worker fallback
52d2c40d Allow PDF image decoders in the local worker fallback
92c92c8a Test a refused PDF save before returning to Documents
90775b3e Keep an unsaved PDF open when its write is refused
0685c420 Test overlapping PDF edits and embedded close during a save
942695aa Load the PDF core before capturing the viewer in the race check
d6505493 Follow the current Documents frame while waiting for readiness
bfda1dbf Drain PDF edits made while a save is in flight
3d681675 Encode the embedded PDF fixture as base64 bytes
eb8a0602 Wait for PDF storage before closing its Documents frame
91735d81 Test PDF timer bounds, find Escape and edits in Trash
b4474f09 Restore a PDF from Trash when its filled bytes change
d8342ea6 Bound PDF export URLs and review the form save debounce
2972fe71 Close PDF find on Escape from anywhere in the viewer
52300062 Keep the held PDF write callable while restoring the check seam
c4d40796 Test the PDF region name and actual module worker type
40fb5780 Expose the PDF scroller as a named region
a740c027 Document PDF limits, local forms and backup exclusions
d212fa04 Refresh Safari resources for PDF viewer review fixes
0f324a57 Include the PDFs switch in the Writer browser inventory
```

Safari resources were refreshed and committed in `d212fa04`; all 558 current files match. The runner cleans its containers and temporary profiles at job exit. No local browser, VM, container, preview server or tunnel was started. The interrupted local test and documentation CLI processes exited. Evidence is retained; the task-owned npm cache was removed. CLAUDE.md and AGENTS.md remain untracked/ignored. Final tracked status is clean after committing this report.
