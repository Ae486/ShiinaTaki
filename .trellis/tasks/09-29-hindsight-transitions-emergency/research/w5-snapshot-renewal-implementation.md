# W5 unused-snapshot and historical-evidence recovery repair

Task: `09-29-hindsight-transitions-emergency`. Cwd `H:/TakiAgent`, branch `main`, HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Repair implementer: `/root/w5_snapshot_repair`.

## Scope and outcome

The owner authorized repairing the W4/W5 check findings and resuming existing real-model acceptance only after
checking the repair. This delivery fixes Core recovery and supplies deterministic/zero-model evidence. Native
source, existing real working/original data, W4/W5 predecessor manifests, task lifecycle and W6-W8 are untouched.
The parent owns real-test helper changes, `leader-now.md` and `execution-status.md`.

Independent review and actual Native/reused-real-corpus acceptance remain separate gates. No actual model request,
Native service startup or original authority replacement was performed by this repair agent. The explicitly requested
boot smoke starts only synthetic fresh Core roots with a local model-request trap.

## Reproductions and causes

`w5-snapshot-renewal-red.log` records raw exit **1**, two failing complete-driver tests. They run the actual operation
owner, healthy service, Local writers, W3/W4 producers and physical SQLite close/reopen. The Native double follows the
real snapshot request/page TTL contract and throws the actual `HindsightApplicationRefusal` class.

1. After an earlier Bank's prepared delta, a later unused Bank materializes a snapshot and loses its response before
   preparation. At 601 seconds, the immutable original request receives `snapshot_expired` forever. Earlier effects
   correctly prevent abort, so recovery stays unknown. Native `application_state/snapshot.py:190-223` confirms that
   only final-proof snapshots bypass expiry; page reads use the same guard.
2. A proven earlier Bank's executor expires and is claimed while its application inventory is still valid. Its sealed
   proof does not change, but live status changes. Rebuilding the immutable evidence document changes its hash and
   collides with the existing Bank slot (`MEMORY_TRANSITION_CONFLICT`). Native `transition_storage.py:286` confirms
   proven executor liveness still follows lease time. A separate 301-second/reopen RED isolates this case.
3. The parent identified a consequence of bounded renewal: reclaiming an executor during inventory loading leaves
   the caller's earlier status stale. A separate full-driver RED (`w5-snapshot-renewal-executor-red.log`, raw exit **1**)
   uses Native `transfer/transition_delta.py::_admit`'s live executor equality and observes `executor_lost` at delta
   dispatch. Refreshing only the executor capability fixes it without replacing any prepared logical request.

The ranked, falsifiable hypotheses and pre-production parent relay are recorded in
`w5-snapshot-renewal-checkpoint.md`. Initial fixture setup was corrected to respect Native Bank-ID iteration order;
the two precise REDs distinguish fixture setup failures from the actual defects.

## Implementation

| File | Change |
| --- | --- |
| `packages/core/src/memory/transitions/transition-unused-inventory.ts` | New focused unused-inventory loader. Reuses the existing055 command journal, follows an immutable successor chain, allows one positively expired application snapshot renewal per Bank/invocation, and verifies current source/fence/namespace ownership. |
| `packages/core/src/memory/transitions/transition-healthy-candidate.ts` | Calls that loader; reuses previously verified native evidence only under identical original request and complete sealed proof; refreshes the current executor before delta dispatch. |
| `packages/core/src/memory/transitions/transition-healthy-snapshot-recovery.test.ts` | Fifteen complete-driver regressions, including physical reconstruction and strict identity/error boundaries. |
| `packages/core/src/memory/transitions/transition-healthy-source.test.ts` | Keeps the original100,000-character UTF-8 payload/all original assertions, adds exact two-part coverage, and uses the explicitly reviewed60-second per-test budget described below. |
| `packages/core/src/memory/transitions/index.md` | Updated responsibility and executable regression descriptions. |
| `.trellis/spec/backend/memory-transition-healthy-drivers.md` | Captures bounded renewal, immutable evidence reuse, executor refresh and measured multipart fixture budget contracts. |

The original `unused-inventory` command remains unchanged. A positive typed expiry appends
`unused-inventory:expired:<predecessor-command-id>` with a fresh snapshot request ID, same namespace and600-second TTL.
The leaf is committed and marked dispatched before I/O. Lost renewed responses resume that exact leaf after reopen.
An expired replacement stops this invocation; another explicit recovery may continue its same chain. Missing snapshots,
namespace conflicts, request conflicts, untyped lookalike errors and body failures do not authorize renewal.

Before renewal and after complete loading, the loader checks the original acquire request, admitted unused Bank,
current Local source/configuration/lease, exact Native lineage/generation, live fenced executor, no proof/outcome,
zero writers/accepted operations and no existing preparation. W3 still verifies complete page/body/hash/cursor closure.
Completed preparations, delta operations, proofs, transition identities and original terminal operations are retained.

Native evidence reuse fully verifies the persisted original document and compares its original request and complete
sealed proof to authenticated current status. A validly rehashed but different proof is explicitly refused. This does
not weaken immutable slots, CAS, final candidate validation or authority COMMIT.

## Source integration-test timing investigation

The unchanged30-second Source test timed out in a9-file run, a single-worker two-file run and a truly isolated run.
Initial resource-contention attribution was withdrawn because it was not demonstrated.

- Exact preimage differential: the original candidate bytes matched the immutable W5 checker SHA256
  `6a66c0d31daba5821b101a29176356a0367b1a74cf0b7d2f2795b8d8a1ed5931`. The same Source test also timed out at31.163s;
  repaired candidate timing was31.281s. `w5-snapshot-renewal-source-baseline.py` restored repaired bytes in `finally`,
  verified as `aa2ad5874582c4e371723416cfaf62bd50312179fbf266aa1c64016dc62178f0`.
- The baseline diagnostic wrapper encountered a GBK console-print error after saving the complete test output;
  restoration still succeeded. The saved log independently records pnpm/Vitest exit1. The helper now prints ASCII
  JSON summaries; that display-only change did not trigger another baseline run.
- A diagnostic-only120-second envelope completed **all original assertions** with raw exit0 at30.573s:
  harness1.251s, first return4.153s, lost seal7.789s, recovered reentry16.814s, final return30.529s, last assertion30.535s.
  The unchanged original test bytes/SHA `e9d84d52c534390b5c707f1935a773ff8b0b94abc0390ba8d0264808004cbc76` were restored.
  This diagnostic is not a pass of the original30-second gate.
- A minimum multipart-text experiment preserved two actual parts but did not reliably fit30s. That reduction was
  withdrawn; original100,000-character bytes and assertions remain. The parent transparently disclosed the timing
  evidence and explicitly approved changing **only this integration test** to60 seconds. No production deadline,
  global test timeout or original data changed. The exact two-part assertion strengthens the existing coverage.

## Verification

Every Vitest invocation used at most two workers; the final Source run used one, without competing heavy checks.

| Check | Actual result |
| --- | --- |
| Original snapshot/evidence RED | exit1;2 tests fail with the intended recovery symptoms. |
| Additional stale-executor RED | exit1;1 test fails with the expected `executor_lost`;14 unrelated cases skipped. |
| Final snapshot recovery matrix |15/15 PASS on final production code (`w5-snapshot-renewal-final-core-check.log`); that two-file command still exited1 because of the then30-second Source limit. |
| Broader W5/driver repository regressions |9 files/50 tests:49 PASS,1 Source timeout, raw exit1. No other failure. |
| Final original-payload Source integration |`pnpm --filter @taki/core exec vitest run src/memory/transitions/transition-healthy-source.test.ts --maxWorkers=1 --reporter=verbose`: raw exit0;1/1 PASS at31.225s under the reviewed60-second per-test budget. |
| Whole workspace typecheck |`pnpm -r typecheck`: exit0. |
| Final affected Core typecheck |`pnpm --filter @taki/core typecheck`: exit0. |
| Root lint |`pnpm lint`: raw exit1, exactly the existing7 max-lines-per-function errors; no suppression or new diagnostic. |
| New/changed TypeScript lint |Final focused ESLint over all four owned TypeScript files: exit0. |
| Node native-type-stripping boot |`node .../research/w5-boot.mjs`: exit0; four fresh Legacy/Local startup-restart/shutdown cycles, authenticated WS checks, reopened integrity checks; model requests0. |
| Trellis context validation |exit0,40 implement entries/43 check entries. |
| Tracked diff whitespace |exit0; unrelated existing CRLF notices remain. |

The final Source run is saved in `w5-snapshot-renewal-source-budget-reviewed.log`. Earlier raw failures and diagnostic
logs are preserved; they are not relabeled green. Final snapshot-matrix assertions and final Source assertions pass;
the earlier broad command retains its original nonzero exit and has not been needlessly repeated.

Known lint functions remain: `createHindsightRuntimeBinding`, `composeMemoryRuntime`, `selectMemoryRuntime`,
`createHealthyTransitionService`, `projectTransitionLocalBank`, `createTransitionNativeSession`,
`createMemoryTransitionRuntime`.

## Preservation and handoff

`w5-snapshot-renewal-source-hashes.json` is a new repair inventory. The audit compares the139-path W4/W5 Core overlay,
allows only these four existing changed paths plus two new paths, checks all355 current Native source paths unchanged,
and verifies nine predecessor manifest hashes. Original W4/W5 delivery/checker inventories are not regenerated.
The provisional pre-budget-review inventory is separately retained as
`w5-snapshot-renewal-source-hashes-before-budget-review.json`.

Final repair inventory SHA256: `f3d67950fc370905b07617e721a6948233cc4b77edecb309397963cd55ca4464`.
Audit raw exit0:6 owned files,139 predecessor Core paths verified,4 existing changes,2 new paths,355 unchanged Native
paths,9 preserved manifests,0 encoding/header/index/whitespace issues. Candidate SHA256 remains
`aa2ad5874582c4e371723416cfaf62bd50312179fbf266aa1c64016dc62178f0`; new loader SHA256 is
`0434292532c47c83e171cd0e3178c4b1669b90b2310bb6ad5639783b9565ca5e`.

Zero-model boot outputs remain in `.trellis/.runtime/w5-boot/7f774a14-8bf7-4094-a62c-f96db6e4da87/`, with complete
results in `result.json`. Every owned Core process exited0 and the request trap saw0 model requests.

The independent checker should review the six owned files, expiry/request/fence/proof boundaries and the explicit
Source test-budget decision. It should use fresh scoped verification, retain the root lint exception truthfully,
and coordinate with the parent before any real workload. This delivery does not claim Native HTTP/PG/model E2E,
real-corpus completion, manual acceptance or W6-W8 progress. No Git mutation or task finish/archive occurred.
