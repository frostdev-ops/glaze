# Startup and selected-font cache, 2026-10-16

This pass covers the shared content script, selected web fonts and the background worker. Ultra stylesheet and DOM hot-path changes are a separate pass.

## Changes

- Theme startup reads the keys in `GZ_DEFAULTS`, rather than every independent card, bookmark and widget record in sync storage. Ultra now reuses the same sanitized tab-local appearance snapshot as Canvas and Moodle, so the previous palette can paint while fresh settings load. Course nicknames are excluded; fresh settings still take over.
- Theme variable and attribute setters compare current values before writing. They still repair values changed by the host page and retain the existing disable/cleanup behavior.
- Font binaries use the browser's native memory/disk HTTP cache with `force-cache`. Google font file URLs and the catalog's version-pinned files identify their contents. The existing per-document promise cache deduplicates concurrent loads. Google CSS retains its normal HTTP freshness; binary data is not serialized through runtime messages. Only selected families load; packaged fonts stay packaged.
- Five rarely needed worker helpers (`gradecalc`, `gpa`, `insights`, `classes`, `syllabus`) are cached during extension installation and imported by their existing broker requests. Pet reconciliation also loads Insights and its grade helper. Dependencies load before validation/run; validation and the serialized write queue remain in place. Failed imports return an error and can be retried.

## Measured

Headless Chrome for Testing, one browser at a time, `nice -n 15`, fresh temporary profiles. These are local probes, not live school measurements.

| Check | Before | After |
| --- | ---: | ---: |
| Eager worker imports, including defaults | 482,153 B / 29 files | 328,225 B / 24 files |
| Worker wake/reply, median of five forced stops | 12.5 ms | 11.2 ms |
| Ultra initial content-script bytes | 228,426 B | 228,317 B |
| Canvas initial content-script bytes | 205,379 B | 205,270 B |
| Default-palette animation-frame samples after FCP, remembered Paper with 120 ms settings delay | 4 | 0 |

A separate prototype shared font metadata through the worker's RAM and disk Cache Storage. Its first font load was 151.6 ms against 150.2 ms before; warm medians were 4.25 versus 4.70 ms. Both versions already loaded the font offline after a browser restart (6.5 and 5.4 ms). This did not justify a custom cache or an asleep-worker round trip, so the prototype was removed. Native font-byte caching is the final implementation; no meaningful font timing improvement is claimed.

The final native-cache font probe also passed first/warm loads, offline loads and an offline browser restart. Warm medians were 4.45 ms before and 4.80 ms after, inside the noise of these small samples. Worker wake timing likewise has a small/noisy absolute difference; the 153,928-byte import reduction is exact.

After each of five real worker restarts, the five deferred modules were absent on an ordinary message and loaded successfully on the appropriate feature messages. Sender rejection replies remained unchanged. The install precache therefore permits subsequent MV3 lazy imports.

Peer review found an indirect pet-to-Insights dependency. An authorized fresh-worker pet request reproduced the failure without that dependency and awarded the expected 15 fixture XP after the fix. A fresh-context transitive dependency check covered all 22 broker handlers; shared dependencies imported only once. These checks live in the temporary validation artifacts, and existing repository tests remain unchanged.

The existing Ultra performance harness passed its plain and instrumented samples: 14 fixture API reads each, no page errors, no non-fixture requests, no route-content hiding. Its approximately 500 ms settle floor does not establish an overall startup timing improvement.

Assert-based probes checked font-byte fetch cache policy and per-document load deduplication; the Ultra palette snapshot before storage answers, fresh-settings precedence and nickname exclusion. Repeated identical setter calls produced two writes rather than twenty, and externally changed values were still repaired. A synthetic sync payload fell from 20,331 to 2,271 characters while sanitizing to identical settings; that is a fixture payload, not an estimate of a user's storage.

## Validation and limits

`node --test --test-concurrency=1`: **1,302 passed, zero failed**, 31.81 seconds. Existing tests were retained; no test code or performance budgets changed. `git diff --check` passed.

Raw receipts and temporary probe scripts were kept outside the repository.

Safari and Firefox runtime behavior, an authenticated LMS session and slow physical hardware were not tested. Immutable font bytes follow the browser's disk-cache eviction policy. No release or store submission is part of this pass.
