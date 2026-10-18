# Independent Healthy and D2 follow-up measurements

Both requested isolated measurements passed on the frozen diagnostic source. Full
structured Healthy output and exact command/result records are in
`b3-core-healthy-d2-measurements-01.json`; original failures remain unchanged.

| Measurement | Complete case | Wrapper | Result |
| --- | ---: | ---: | --- |
| Selected positive, temporary local 180-second envelope | 59.776 s | 75.632 s | 1 passed / 25 skipped |
| Original D2, temporary CLI 30-second envelope | 3.493 s | 12.795 s | 1 passed / 9 skipped |

Each source recorder verified all 1599 inputs unchanged; each owned temporary root
was empty and removed. There was no concurrent case or other heavy check.

The positive completed both RETURN and REENTRY with non-null completed results,
publication receipts, complete resolutions, ready target runtimes and settled queues.
There were no warning/error records or lease-loss symptoms. The complete original
history, selection, foreign-key and observer assertions passed. This supports the
earlier timeout/teardown interpretation; no production repair is justified by the
late, contaminated REENTRY status from the earlier two-case diagnostic.

D2 retained all original fake-time admission, deferred-read and exact-once eight-unit
binding assertions. A full pass exists now, while the old single-worker five-second
timeout remains valid historical evidence of sensitivity to real SQLite/hash time.

Root accepted these local budgets with headroom from the preserved complete log:

| Case work | Local test limit | Recorded evidence |
| --- | ---: | --- |
| Selected RETURN only | 60 s | Existing successful final-lease case: 48.622 s |
| Selected positive / REENTRY with prior RETURN | 180 s | Complete isolated positive: 59.776 s; prior REENTRY rows reached 87.879 s |
| Removed RETURN only | 240 s | Earlier lease row: 164.274 s; drift rows reached 126.569 s |
| Removed positive / REENTRY with prior RETURN | 360 s | Earlier positive: 279.016 s; REENTRY lease row: 272.996 s |
| D2 only | 15 s | Earlier default-5-second timeouts; complete isolated measurement: 3.493 s |

Timeout durations are evidence that old limits were insufficient, not clean complete
execution benchmarks. The larger limits avoid teardown overlap and give actual
assertions time to finish. Global defaults and every production clock, lease,
deadline and preview TTL remain unchanged.

Root reviewed `b3-core-healthy-capture-final-proposal-01.patch.txt` and authorized
the two exact proposed source images. They were applied with a fresh hash guard.
The 2417-entry maintained-input comparison found only the Healthy and capture-sync
test files changed, and no diagnostic probe remains. See
`b3-core-healthy-capture-final-applied-01.json`.

The permanent logic correction is small: after the original full-row rollback,
RETURN requires a non-null failed transition result and matching `source-aborted`
resolution through existing readers. Prepared REENTRY and final-lease exhaustion
still require `outcome_unknown`. No release-proof implementation, new helper or
new case matrix was added.

The root-authorized complete 26 Healthy + 10 capture-sync run passed under
`b3-whole-core-healthy-capture-tests-01`: 36/36, exit 0, 1515.516 seconds, one worker,
no selector or CLI timeout override. The subsequent Core typecheck passed under
`b3-whole-core-healthy-capture-typecheck-01`: exit 0, 39.454 seconds. Each whole
recorder verified all 2417 inputs unchanged and removed an empty owned temporary root.

The sole heavy-check slot was returned immediately after typecheck. Root then
synchronized the existing Healthy spec paragraph without changing production or test
source. Root's final workspace lint and combined Stage 5B acceptance remain separate.
The final source identities and retained initial/final evidence are recorded in the
updated `b3-independent-core-source-2026-10-12.json` and independent Core review.
