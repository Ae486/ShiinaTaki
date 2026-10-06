# W5 verified observation implementation

## Verdict and remaining gate

The approved ten-file observer repair is implemented and passes its focused behavioral/type/process checks. Default
positive-binding observation of the real committed corpus now remains within the actual 10s polling period and the
client's unchanged 60s deadline. The complete Core driver still fails with lease loss during settling; this is an
explicit remaining blocker, so the repair is not a real RETURN release or overall W5 PASS.

Current parent-owned working SQLite SHA256 remains
`a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923`. No real HTTP/PG/model service, budget, credential,
TTL, timeout, task lifecycle or Git action was performed by this worker. Tests use new isolated copies and fixtures.

## Production changes

| File | Responsibility |
| --- | --- |
| `memory/transitions/transition-observation-store.ts` | New DB/service/selected-receipt-owned store of verified immutable artifacts; no SQL result, candidate/publication or authority verdict cache. Successful reads prune unused dependencies and retain one pure projection key per Bank. |
| `memory/transitions/transition-evidence-context.ts` | Fresh synchronous observer contexts recheck actual row ID/transition/slot/body bytes. Ordinary full contexts remain independent. Frozen JSON and isolated body byte views prevent mutation leakage. |
| `memory/transitions/transition-local-projection.ts` | Reuse only completed pure Bank projection; key includes complete semantic inputs, verified current/baseline identity, order and future argument fields. |
| `db/memory-transition-publication-reader.ts` | Service-owned observation reader executes the original full reader control flow and every database/mutable join. Public full publication read rejects observer contexts. |
| `db/memory-transition-publication-proof.ts` | Only the separately approved public `readTransitionPublicationBoundary` independent-context guard. |
| `memory/local-runtime-binding.ts` | Detached binding/lifetime/revision metadata follows the existing private binding state identity and stop lifetime. |
| `memory/hindsight-runtime-binding.ts` | Same detached publication metadata; no second authority or binding state owner. |
| `memory/runtime-composition.ts` | Expose provider publication metadata through the cohesive existing binding query seam. |
| `boot/memory-transition-boot.ts` | Own/reset/close observer; seed already-published boot before native dispatch; separate full execution readiness from verified status observation. Positive observation also requires actual published binding presence. |
| `memory/transitions/transition-healthy-service.ts` | Optional `observeReady` only for status and service-failure status projection; preview/admission/execution still use independent full `ready`. |

Paths above are relative to `packages/core/src`. Three new tests plus the changed boot/binding tests cover the scope;
four touched indexes and two transition specs document contracts. The preimage manifest includes one unchanged test
anchor; the final source manifest distinguishes actual changes from preserved verification anchors.

No current Local record/policy/Block state or SQL result is cached. Native evidence reused after warmup must match
fresh persisted bytes/identity. Candidate, baseline, proof, publication, marker, current epoch, queue, source/Pending,
custody/member/witness, ingestion span and native/application checkpoint joins still run on every observation.
Errors, selected receipt or binding replacement, closure and new Database lifetime invalidate reuse. Independent
COMMIT, bind, boot, admission and explicit full reads cannot consume observer contexts.

## Verification

All heavy checks ran sequentially and all Vitest commands used `--maxWorkers=2`.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Initial and final Core typecheck | exit 0 | `w5-verified-observation-types-initial.log`, `w5-verified-observation-types-final.log` |
| Final observer/store/boot/bindings/runtime/publication/custody/source regression | 10 files / 84 tests PASS, 37.72s | `w5-verified-observation-final-tests.log` |
| Full publication order, Hindsight runtime, healthy journey/maintenance/source regression | 5 files / 33 tests PASS, 31.35s | `w5-verified-observation-driver-tests.log` |
| Healthy operation service and queued target effects | 2 files / 17 tests PASS, 22.99s | `w5-verified-observation-service-tests.log` |
| Final scoped ESLint | exit 1: exactly one inherited function-length error, no warnings | `w5-verified-observation-lint-final.log` |
| Native Node 24 strip-only Core process smoke | exit 0: Legacy and genuine B2 Local boot/stop/reopen twice, authenticated WebSocket, integrity check, 0 model requests | `w5-verified-observation-boot.log`; `.trellis/.runtime/w5-boot/ff4774fb-ec26-4629-b0bb-1a2b5a288127/result.json` |
| Default real-corpus observer replay | PASS, zero network/model calls, unchanged source | `w5-verified-observation-replay-result.json` |
| Complete Core driver real-corpus copy | FAIL: lease lost at settling, heartbeat then cancelled | `w5-verified-observation-driver-result.json` |

The final three test groups cover 17 distinct files / 134 tests. Initial groups (20 and 21 cases) overlap and are not
added to this count. The first reader/store run had two faulty expectations: cold full ID loading accepts slot-only
mutation, and an invalid-digest fixture was rejected by an SQL CHECK before reaching the reader. Both test fixtures
were corrected; the failed log remains. The command selectors also contained nonexistent standalone publication-
corruption and healthy test paths; the counts above report only actual selected files, not those unused selectors.

The sole scoped lint error is `createHindsightRuntimeBinding` at 54/50 lines, down from inherited 55/50. No suppression,
warning bypass, artificial split or weakened check was introduced. The scoped lint result is not green; root lint
and broader workspace/native quality baselines were not rerun or relabeled by this observer delivery.

New coverage includes frozen/exhaustive projection keys, dependency pruning, receipt/DB/close lifecycle, caller
envelope refusal, byte isolation and async-context misuse; warm versus independent full reads and lost-COMMIT replay;
native body/identity/deletion, candidate/baseline/proof/publication/marker/cutoff corruption; real Local policy/Block
edits, late primary append/finalize/ingestion and compaction; current member/witness and forged consumed-span refusal;
Hindsight application-checkpoint deletion, native-pair drift, preparation deletion and delta-body corruption.

## Default observation replay and complete-driver failure

Default boot independently constructs the runtime and cold-seeds observation in 81.921s. Two warm status reads take
3.824s and 3.632s; the actual Hindsight client three-event-loop-turn pending response resolves in 3.834s. The production
deadline remains 60s and the poll interval 10s. The assertion uses the real 10s period; the old 1s absent-binding
criterion is not claimed for this positive-binding path. Original source and outputs are preserved.

The complete-driver diagnostic uses the same default boot, actual Core operation/service/runtime and original
transition recovery, but synthetic Native outcomes over genuine retained evidence. Cold composition takes 82.423s;
driver duration is 419.430s. Final phase is `settling`, operation is `outcome_unknown`, primary diagnostic is
`MEMORY_TRANSITION_LEASE_LOST`. The pending heartbeat waits 349.467s then receives `HINDSIGHT_CANCELLED` at shutdown.
This was not `HINDSIGHT_TIMEOUT`, and older UNCLASSIFIED records have not been retrospectively relabeled.

Measured independent synchronous boundaries: native outcomes 27.257/7.957s, bind 79.592s, full Local readiness 39.361s,
complete queued-intent validation 120.201s, and native release 34.264s. Ordinary microtask continuation starves due
heartbeat and native response delivery across the combined chain. Empty queue does not authorize skipping its full
validation. `w5-finalization-scheduling-proposal.md` proposes two production paths, real event-loop yields between
completed independent boundaries, joining the existing heartbeat and refusing stale late renewal state replacement.
It remains a separate approval gate. This report does not authorize real-service startup.

## Evidence and preservation

`w5-verified-observation-source-manifest.json` is a new exact source/evidence inventory. Its audit checks strict UTF-8,
no BOM/trailing whitespace, module headers/index coverage, exact saved preimages and original SQLite SHA256. It
retains the earlier source manifests unchanged:

- `w5-core-validation-source-manifest.json`: `bcf06e76032d77fce66b3d26c34b60dd1be2deba821a35e6a10e60b51beaa6f4`.
- `w5-postcommit-readiness-source-manifest.json`: `5f056f60218dbba7a1b574f7f89c63f77b788e394321fb1ab421f2bba3ca2341`.
- `w5-verified-observation-preimage-manifest.json`: `0f09be95af97b6d3e4677c6a5feb30360f1e069803372b0e1b04b226ec55fac0`.

The replay ran before the final boot positivity guard and two header-comment corrections; final type/tests/smoke
cover those final edits. The guard only adds the existing published-presence requirement and the replay proved that
presence true. Nevertheless the final source manifest is a delivery anchor, not a claim that the prior replay
captured hashes at launch. The next complete scheduling replay must capture its own exact source identities.

Remaining: parent review/approval of the separate scheduling patch, deterministic and new full-driver replay proof,
independent release review, then real Native finalization and the authorized preserved-corpus continuation. Cold boot
and individual full validators remain expensive; a full reader still accepts slot-only mutation by its pre-existing
ID-based loading semantics. Neither limit is hidden by a general performance or integrity PASS claim.
