# W1 independent check

Date: 2026-09-29. Workspace: `H:/TakiAgent`, branch `main`, baseline HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Scope: independent W1 review and bounded repairs after the resumed
implementation. The leader supplied the active session/task binding; the empty legacy pointer was not used as
authority. Cwd, branch and worktree list were checked. Existing W0 and other working-tree changes were preserved.

## Gate

**W1 PASS after the fixes below.** No known unresolved blocker remains within the W1 durable foundation boundary.
This is not acceptance of a native fence, complete authority COMMIT, runtime binding, queue effect execution,
healthy/emergency transition journey or manual/original-environment behavior. No actual transition driver is composed.
The missing-driver refusal remains mandatory. The leader owns the decision to advance to W2.

Reviewed the PRD, design, implementation plan, curated check context, W0 independent report, W1 implementation report,
root/backend guidance and current Shared/Core/Desktop code. Source paths and tests, not the implementation report
alone, establish the conclusions below. No migration, native source/service, original database, new dependency,
task status, deferred ledger, historical corpus/helper, commit, push or archive was changed by this reviewer.

## Findings (fixed)

### F1 — High: terminal or already-settled ownership could still acknowledge new queue custody

- File: `packages/core/src/db/memory-transition-queue-repo.ts`.
- Issue: admission checked opening/cutoff/lease but not attempt termination or owning operation state. A source-abort
  resolution could close the attempt while leaving its admission opening present; a later caller could receive an ACK
  for an intent with no live transition owner. A durable result also left a short window before operation projection.
- Fix: new custody refuses when a durable original result exists, the attempt is terminal, or its owning operation
  is not running. Exact retries still return the original queued identity or factual outcome before this check.
- Regression: real SQLite tests resolve an open source transition, then assert new custody refusal and unchanged
  old caller cancellation; a second test records failure before operation projection and rejects new custody.

### F2 — High: phase alone was treated as proof that claimed work had no isolation obligations

- File: `packages/core/src/db/memory-transition-evidence-repo.ts`.
- Issue: `settleTransition()` called claimed `admitted`/`draining` phases `neverDispatched` and terminalized the attempt
  on a settled failure/cancellation. An executor can start external drain/fence work before recording its next phase;
  a failure alone cannot establish release. Terminalization removed the DB exclusion without release evidence.
- Fix: factual failure remains immutable but never releases the attempt. Only explicit identity-bound resolution
  releases claimed obligations. Claimed cancellation through `settleTransition()` refuses; pre-claim owner CAS is
  unchanged, and proven resolution remains the separate safe-boundary path.
- Regression: both claimed phases retain their attempt after failure, terminal operation projection and lease expiry;
  setup and direct manual-sync admission remain blocked. Claimed cancellation is rejected before a result write.

### F3 — High: a post-driver operation read failure could manufacture a terminal failure

- File: `packages/core/src/memory/operations/memory-operation-kind-transition.ts`.
- Issue: the operation lookup following driver execution was outside the unresolved evidence catch. A transient
  lookup error escaped into the generic owner's catch, which terminally settled `producer_failed` without evidence.
- Fix: include the post-driver operation lookup in the same unresolved boundary as receipt observation.
- Regression: after persisting real transition evidence in SQLite, inject exactly one operation lookup error. The
  stored operation remains running; a later status read settles from durable UNKNOWN evidence without redispatch.

### F4 — Medium: hash-valid receipt reads did not bind all admission identities

- Files: `packages/core/src/db/memory-transition-evidence-repo.ts`, `memory-transition-recovery-repo.ts`.
- Issue: receipt read-back checked its hash/proof but not admission operation, request and direction. A validly hashed
  mismatched body could be accepted by boot observation. Several evidence reads also omitted persisted row-key checks.
- Fix: receipt read-back joins its immutable admission identities and receipt key; proof, result and resolution reads
  verify their applicable persisted transition/operation/key identities in addition to existing schema/hash checks.
- Regression: separately corrupt operation ID, request ID and direction while recomputing a valid receipt hash in an
  isolated fixture. Every read refuses. Normal write APIs and immutable triggers remain unchanged.

The transition spec and touched source indexes were synchronized. The spec now explicitly distinguishes the future
W4 full authority-marker/epoch/receipt/candidate/checkpoint/custody/queue join from W1's partial publication fixture.

## Findings (not fixed)

None within W1. The following are explicit integration gates, not claims of implemented or accepted behavior:

- W2 verifies the real native protocol, writer coverage, certificates and release/retirement effects. Synthetic fixture
  proof hashes establish only repository checks. W1 storage cannot independently certify an external native effect.
- W3 produces complete candidate, baseline and logical mapping evidence. W4 owns exact target mapping/revision
  validation, fresh execution context, factual target lookup and unchanged-source execution after pre-COMMIT abort.
  W1 currently allows truthful refusal/cancellation of pre-COMMIT queued entries; no old Run or closure is replayed.
- W4 must publish `memory_authority_selection`, canonical state/epoch, transition receipt, candidate/checkpoint
  identities, exact primary custody and queue ownership in one transaction and validate the same join at boot.
  Existing first-activation readers are not bypassed and old receipts are not manufactured by W1.
- W5/W6 must supply source-backed drivers, actual runtime readiness, emergency incident/quarantine verification and
  recovery integration before exposing runnable transition actions. Lease expiry is never release evidence.

## Actual-path review

| Concern | Verified current behavior |
| --- | --- |
| UNKNOWN queue recovery | Observation is append-only; eventual factual result retains the exact dispatch target request. UNKNOWN cannot be cancelled or replaced with a new dispatch ID and blocks later ordered dispatch. File-backed reopen/new recovery tests preserve old observations and terminal original operation history. |
| Recovery identity | Recovery has a new operation/request with original transition, expected generation and receipt. Claim validates running operation, recovery admission, lease expiry and new attempt/generation/owner CAS. Cancellation of an unclaimed recovery leaves the original attempt isolated. |
| Admission/exclusion | Operation plus intent insertion is one transaction; stale preview/current identity and injected persistence/COMMIT failures roll back. SQLite triggers exclude six control families and direct queued/claimed manual requests in both directions, including terminal original projections with unresolved attempts. |
| Queue contracts | Real bounded branch caller IDs are accepted; Core target/replay IDs remain UUIDs. Captured Run/Attempt/Effect fields are immutable provenance; execution has only a fresh target identity. Public operation union applies transition direction/baseline/recovery validation. |
| Cancellation/ownership | Pre-claim CAS prevents dispatch. After claim, user cancellation refuses. Stale revisions, old lease ownership and generation changes refuse; two-connection/reopen tests exercise the real SQLite state. |
| Owner truth | Driver return alone cannot settle. Driver exceptions and post-driver lookup/evidence errors retain uncertainty. Boot observes receipts without dispatch. Existing terminal operation history is not rewritten by a new recovery. |
| Migration/history | 052 follows W0 051, adds immutable evidence/queue/recovery tables and attempt guards, and preserves existing operation rows. Focused 051 upgrade/reopen asserts old migration receipts unchanged. No migration was changed in this review. |
| Desktop | Only read-only labels were added for the three kinds; no transition action, confirmation UI or independent frontend operation ledger is advertised. |

## Verification

Vitest commands ran sequentially with at most two workers, using isolated in-memory/file-backed SQLite fixtures.
Counts overlap and must not be added as unique coverage. New regressions were added with the fixes; no separate
pre-fix red run is claimed.

| Command | Result |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/db/memory-transition-repo.test.ts src/db/memory-transition-queue-repo.test.ts src/memory/operations/memory-operation-kind-transition.test.ts --maxWorkers=2 --reporter=dot` | Initial targeted check: exit 0, 3 files / 31 passed. Superseded by the final run below after the additional result-before-projection test. |
| `pnpm --filter @taki/core exec vitest run src/db/memory-transition-repo.test.ts src/db/memory-transition-queue-repo.test.ts src/memory/operations --maxWorkers=2 --reporter=dot` | Final Core check: exit 0, **13 files / 102 passed**, including existing operation-kind and W0 exact-request regressions. |
| `pnpm --filter @taki/shared exec vitest run src/memory-transition-schema.test.ts src/memory-operation-schema.test.ts --maxWorkers=2 --reporter=dot` | Exit 0, **2 files / 9 passed**. |
| `pnpm typecheck` | **Pass**, all five workspace packages; final log `w1-independent-typecheck.log`. |
| `pnpm lint` | **Pass**; final log `w1-independent-lint.log`. |
| `git diff --check` | **Pass** for tracked changes; only unrelated parent task/deferred-ledger CRLF normalization warnings. |
| `python ./.trellis/scripts/task.py validate 09-29-hindsight-transitions-emergency` | **Pass**, 22 implementation / 24 check entries at execution time. |

The implementer's 44-file Core/migration, full Shared and Desktop evidence was reviewed rather than rerun wholesale.
No full-workspace suite, Desktop build, standalone Core process/service boot, native PostgreSQL, original historical
corpus, real authority transition, paid call or owner/manual acceptance was executed. Service boot observation and
receipt/epoch publication in these tests are isolated in-process foundation fixtures only.
