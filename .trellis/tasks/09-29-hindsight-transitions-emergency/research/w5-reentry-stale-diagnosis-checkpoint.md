# W5 reentry stale diagnosis checkpoint

Read-only diagnosis authorized by parent. Existing production/helper/report/manifest files
remain unchanged. No real parent pair, Native data, service, credentials, models, Git/task
lifecycle or dependencies may be used. Source fixes require a new parent-approved scope.

Only permitted diagnostic evidence root:
`H:/TakiAgent/.trellis/.runtime/w5-reentry-stale-5e63660aa04c4eb4816122fcee449a7c`.
Its immutable `copy-manifest.json` must be verified before use and after investigation.
The source SQLite hash in that manifest is distinct from the sanitized copy's own digest;
use the `files.application.sqlite` digest to validate the permitted copy. Any SQLite writes
belong in a separately created derived copy. Do not mutate this evidence root.

Parent-observed failure: `MemoryOperationRefusal: MEMORY_TRANSITION_STALE` at
`memory-operation-service.ts:121`, called by `w5-reused-driver.mjs:208`.
Local planned policy/Block changes completed; new reentry intents/attempts/plans = 0;
prior RETURN remains completed; model submissions remain 301.

Diagnosis loop plan: replay the saved exact request through the actual transition service
and operation owner on a new derived SQLite copy, with network/runtime dependencies
substituted and deterministic time. Capture the inner synchronous refusal before the
operation owner wraps it. First reproduce; then publish 3-5 falsifiable hypotheses before
testing them. Measure expensive real-corpus identity/readiness boundaries without Native
startup. No new request/preview is minted by diagnosis; use retained immutable evidence.

Reproduced saved-request expired restart through real owner/service on a new derivative:
`w5-stale-probe-expired-57a89632-9fa5-4b0d-8e55-291db9ed70e4/result.json`.
Inner origin is `assertTransitionPreviewRequest`, outer wrapper is the reported service:121.
This does not yet establish the original fresh-run cause. Preserved preview created
2026-10-04T10:16:09.933Z, expires 10:18:09.933Z; request
`9a90f97e-a831-48b2-95e5-34f740bb8d2d`, preview
`784eeb71-7680-46bb-a1d8-8f0aec472797`. All 7 evidence input hashes match.

Ranked falsifiable hypotheses shared with parent before probes:
1. Duplicate admission plan/readiness cost crosses TTL: first plan succeeds; second fails expiry.
2. Local post-preview drift: pin valid time and compare current identity; mismatch persists.
3. Runtime publication unready: equal identity but real readiness is false.
4. Actor/request/config mismatch: exact field checks reject even at preview creation time.

Fixed-valid-time result:
`w5-stale-probe-fresh-cafb7db5-6c29-49bf-8561-ac288349889f/result.json`.
Both real plans pass (83.744 s / 83.903 s). Between them the operation owner's additional
authority-selection read costs ~73.94 s; second plan begins at 157.697 s. Overall reaches
admission at 241.608 s, then the diagnostic outer transaction deliberately rolls back.
Same saved request/Local state/config/actor is valid; 1 old RETURN intent/attempt and 8
operations unchanged. SQL execution total is 15.449 s over 48,967 calls; most elapsed time
is outside SQL in full evidence decoding/hashing/projection. Real readiness was substituted
true for this first discriminating probe, so runtime-specific readiness is not yet claimed.

Elapsed-time-only result:
`w5-stale-probe-elapsed-294a250e-b165-42f6-8dbc-e7796a121986/result.json`.
First plan passes in 85.829 s; second plan begins at 162.296 s and refuses in 2.30 ms
at persistAdmission -> plan -> assertTransitionPreviewRequest, 42.296 s past expiry.

Full actual Local runtime/readiness result:
`w5-stale-probe-elapsed-full-fbbd19a8-76f7-4d0e-a1ac-9dc612ec3256/result.json`.
Runtime compose/start takes 76.718 s before admission timing starts. Actual readiness
returns true in 75.498 s. First plan passes in 162.012 s, then owner authority read costs
approximately 74.877 s. Second plan begins at 236.900 s, 116.900 s past the original expiry,
and refuses at the same guard in 2.15 ms. Overall 236.902 s. Counts remain exactly
{intents: 1, attempts: 1, operations: 8}; source preserved; external/model calls both zero.
All probes have exited; no active unified-exec probe session remains.

Fast diagnostic Node tests completed: 2/2 pass, 7.448 s total. Actual tiny-fixture preview
and owner submission reproduce second-plan expiry after advancing synthetic time by
120001 ms, with atomic rollback; the unchanged-clock control completes synthetic reentry.
See `w5-reentry-stale-fast.test.mjs` and `w5-reentry-stale-fast.log`.

Final diagnostic report: `w5-reentry-stale-diagnosis.md`. It proposes explicit threading of
one independent, transaction-local immutable evidence/projection context through both
plans, owner selection and existing full runtime snapshots. All mutable joins and real
expiry checks remain; no observer cache, verdict reuse or timeout extension. A separate
finite explicit renewal must preserve the expired pending request and append new IDs
with supersession linkage only after proving no admission and revalidating RETURN and
the existing policy/Block changes. Neither repair nor renewal has been implemented.

Next action: parent reviews the report and grants a concrete source/helper scope before
any repair. Do not repeat broad diagnosis or start actual services. The latest user line
limit exception permits cohesive functions without artificial splitting. Final preservation,
syntax, encoding and artifact hashes are in the separately named stale diagnostic audit
and manifest; do not overwrite older task evidence.
