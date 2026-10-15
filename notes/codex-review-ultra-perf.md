# Ultra performance review

Baseline: `f39b3ed`. Scope: all Ultra startup/SPA observers, native sweeps, extension storage/load traffic and existing
page data reuse; actual unpacked headless extension on local synthetic responses. Evidence and commands:
[`parity/spikes/Ultra-perf.md`](../parity/spikes/Ultra-perf.md).

Confirmed causes, ranked by measured impact:

1. **SPA route hiding:** local fixture replies still left native content hidden for sampled 256–474 ms. Remove the
   separate route hold/reveal and its 50 ms timer. Keep the initial document-start sheet gate.
2. **Internal UI updates schedule native sweeps:** 30 widget text updates caused four whole-document native
   course-color scans. Filter mutations inside owned roots, preserving native-parent removals and mixed batches.
3. **Successful empty lateness results are not recorded on unchanged grades:** the short sequence asked one
   gradebook three times. Save the empty result before content comparison; preserve failure retries and minute refresh.

Pending B7c retains eager nav/dependency loading, default first-paint text and planned-cache work. Accepted B7b widget
and B9 folder fixes are inherited through integration `47a3301`; they are not counted as this audit's fixes. The f39
outline-only one-frame folder observer fix is already in the baseline and did not run away in this harness.

Cold first paint was 40 ms and there were no long tasks in the baseline synthetic sample. That is no proof of an
owner cold-load problem. The owner live numbers supplied by the coordinator are peer-reported, not this review's
observations. No identity cache refactor is justified by the one measured `/users/me` read.

Causal fixes are implemented and measured separately. SPA hiding is zero, the owned-update native scans fall 4→0,
and three native due-row status updates issue 3→0 extra gradebook reads. Each causal increment used one paired browser
repetition, separately from the final three paired integrated samples. The regressions failed before; final full-suite
and package/resource checks pass. The initial causal three-fix chain cut 2,804 Ultra bytes and 293 shared bytes.

The later owner reload report adds lifecycle scope: preserve integration `07b8390`'s core/card invalid-context guards,
make `GZ_CTX.on()` notice invalidation before a body mutation, stop an orphaned Google sync timer and safely close a
Download all port keepalive. A scene now checks its caller's liveness before another animation frame and stops/disposes
its WebGL resources. Editor preview uses the same caller; standalone store promo behavior is preserved. Its regression
failed before because another frame was scheduled, then both lifecycle/still-frame tests passed.

Reload/request fixes now pass 55 focused checks after seven failures on saved pre-fix source and the separate stale
`GZ_CTX.on()` failure. This includes late card storage, stale sticker construction/action, safe injection and real key
listeners, JSON auth redirects, Google orphan timer and Port keepalive teardown. Integration 07/a694 guards/budget are
merged, followed by accepted `47a3301`. Generic core `X.gate` and synchronous native-added-subtree dispatch are restored for B7c's pending
`gate: discoverNav`; Ultra's removed hold/mask/timer are not restored. Pending nav/planner/widget optimizations are not
claimed here.

Final integrated browser evidence: three plain/shim pairs, zero SPA hiding, zero extra empty-late gradebook reads,
zero owned-update native scans, 14 fixture API reads per sample, and no page errors or non-fixture requests. Plain
Courses/outline/Grades settle medians are 512/622/514 ms, with a 500 ms measurement floor; plain first paint is
28–44 ms and no long tasks were reported. Six route replacements keep the isolated observer count at four; CDP-visible
document/window listener counts stay 0/13. The latter is a limited CDP view, not a census of isolated-world listeners.

Plain bundled-pumpkin animation uses 22.8 ms of renderer task time over two seconds; shim samples draw 60 frames in
two seconds. This is not GPU time. A real extension reload leaves `runtime` and `ctx.on()` false before any native body
mutation; old-scene draw counts remain 76/76/76 across two 300 ms quiet windows and the following native mutation.

Final full gate: **1,080 tests; 1,079 pass, zero fail, one existing news/version TODO**, 30.94 seconds, nice15/concurrency1.
The first full attempts exposed test-only valid-runtime mocks and a flush slice ending at the removed section marker;
those fixtures were adapted without changing their behavior assertions. Package succeeds; all 201 staged resources
are bundled by both Safari targets. No Safari runtime or live school/account claim is made.

Final first scripts: Ultra **214,310**, Canvas **201,443**, Moodle **171,517** bytes. Versus accepted `47a3301` alone,
this work is **−2,331 Ultra / +180 Canvas / +180 Moodle**; versus f39, the total integrated difference is
−1,422/+355/+355. Owner-supplied budget changes are inherited; this branch does not edit a size baseline.

Raw JSON and failed/passing suite receipts are retained under the session notes' `artifacts/codex-ultra-perf/` folder
(full path in the spike report). Throwaway extension/profile/package stages are removed; nothing owned is running.
