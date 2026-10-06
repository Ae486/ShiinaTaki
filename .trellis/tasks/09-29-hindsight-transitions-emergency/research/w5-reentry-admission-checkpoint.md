# W5 reentry admission implementation checkpoint

Parent approved the exact 14 production paths in the stale diagnosis proposal, focused
tests/specs/indexes, plus a new one-time renewal helper/test and narrow driver/supervisor
forwarding. No Native change, migration, dependency, real pair, real renewal or model use.
Preserve prior checker fixes and immutable manifests. No Git/task lifecycle/delegation.

Preimages: `w5-reentry-admission-preimages.json`, 25 paths in
`w5-reentry-admission-preimages-9ad533111cdc4c55a50263ae244fb30d`.

Implemented source: all 14 approved paths. Independent context is created inside the
transition admission transaction, in a local handler context only; both plans, epoch
stamp and full default runtime snapshots share it. Byte guards and mutable joins remain.
Pure complete-key Bank output is frozen and scoped. Real expiry is rechecked after
expensive plan work. No timer/TTL changes.

New tests `transition-admission-verification.test.ts` and
`transition-independent-projection.test.ts` initially failed against preimage behavior.
Focused green: 4 files / 20 tests passed, including prior evidence-context and transition
operation integration. Logs: `w5-reentry-admission-red.log`,
`w5-reentry-admission-green-initial.log`.

Completed real copied-corpus acceptance: new script
`w5-reentry-admission-replay.mjs`, log `w5-reentry-admission-corpus.log`.
Uses actual composeMemoryTransitions readiness, exact saved request and original 120s
preview lifetime projected with real monotonic elapsed time. Deliberate rollback prevents
dispatch. Runtime startup measured 39.666s before admission clock. Production hashes at
launch/end still match the delivered14sources. Result:
`.trellis/.runtime/w5-admission-acceptance-b2c21fe0-fb59-4f96-abe7-a66a3cd3c2a4/result.json`.
Both full plans/default Local snapshots and real expiry checks pass; deliberate rollback
returns at61.272s, inside original120s. Zero external/model calls,7inputs preserved,
same1intent/1attempt/8operations before/after. No active probe session remains.

Renewal helper/CLI/doc complete: new `w5-reentry-renewal.mjs`, test and usage doc; driver
and supervisor forward the explicit option; existing checkpoint/admission/gate helpers
are preserved. No real renewal/approval was minted.

Final gates: Core10files/71 plus projection-consumer9files/66; Node24/24; Python5/5 plus
prior checker6/6; workspace5/5types; root lint exit0 without new exception; CLI help/two
invalid-scope cases; four isolated strip-only boots/reopen integrity with zero model calls.
Final report `w5-reentry-admission-implementation.md` records exact evidence and limits.
Separate audit/source manifest capture final delivery. No active exec session remains.

Next: notify parent delivery is ready for independent checking; do not resume the actual
pair, author a real approval, renew the request or advance task lifecycle.
