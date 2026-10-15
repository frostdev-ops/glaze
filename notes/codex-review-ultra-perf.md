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

Pending owners retain their work: B7c's eager nav/dependency loading, first-paint gate and planned cache; B7b's widget
load/callback/geometry work and shared planner/profile use; B9's folder trust/stale-row/import/storage work. The f39
outline-only one-frame folder observer fix is already in the baseline and did not run away in this harness.

Cold first paint was 40 ms and there were no long tasks in the baseline synthetic sample. That is no proof of an
owner cold-load problem. The owner live numbers supplied by the coordinator are peer-reported, not this review's
observations. No identity cache refactor is justified by the one measured `/users/me` read.

Causal fixes are implemented and measured separately. SPA hiding is zero, the owned-update native scans fall 4→0,
and three native due-row status updates issue 3→0 extra gradebook reads. The regressions failed before and the focused
perf/package/Safari-resource/i18n set passes 26/26. Ultra's first script shrinks 2,804 bytes to 212,928; shared core
shrinks 293 bytes on Canvas/Moodle. Ratchets are unchanged. No owned browser/process/profile remains.

The later owner reload report adds lifecycle scope: preserve integration `07b8390`'s core/card invalid-context guards,
make `GZ_CTX.on()` notice invalidation before a body mutation, stop an orphaned Google sync timer and safely close a
Download all port keepalive. Nav/widget callback guards stay with B7c/B7b. Final integration/full-suite/reload/3D
verification is still pending, and no claim of live cold-load slowdown is made.
