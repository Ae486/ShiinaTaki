# Tidy Progress and Shutdown Independent Challenge

Date: 2026-11-12. Scope: read-only source review in `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`. This report is the only advisor-owned change. No tests, model calls, reference changes, production edits, original profiles, or journals were touched.

## Requirements and conclusion

The integration PRD requires preserving main Hindsight and T4 Tidy, real committed effects and durable history, restart reconciliation, and isolated G-only verification. The design assigns durable operation truth to Core and forbids replacing unknown evidence with zero.

Both reported failures have independently verified, reachable causes. The progress issue is missing argument forwarding, not missing transactional accounting. The shutdown issue is a runner reason-priority error, not a reason to relax authority fencing.

## 1. Shutdown reason is overwritten after an actual cancellation

- `packages/core/src/memory/tidy-shutdown.test.ts:74-84` starts the composed producer, waits until its model call is active, invokes `runtime.stop()`, observes the actual abort signal, and expects `failed/unfinished`, zero edits/steps, and exactly one real scripted SDK invocation. The same contract covers Legacy and canonical Local.
- `packages/core/src/memory/runtime-composition.ts:320-327` stops the selected runtime and concurrently drains producer owners. `canonical-local-subsystem.ts:70` retires the Local fence before calling the raw Tidy pass's stop method. `tidy-pass.ts:60-62` aborts the pass signal and awaits every admitted flight.
- `canonical-local-runtime.ts:116-128` binds captured authority reads to `writeFence.assertAlive()`. Consequently a final captured `activeEpoch()` call after retirement throws even though SQLite's epoch row itself has not changed.
- `canonical-tidy-review.ts:72-82` catches that authority failure, keeps its issue diagnostic, and reports `review-stale` with the review's actual edit total.
- `tidy-agent-runner.ts:46-48` first records explicit signal cancellation as `unfinished`. Lines 50-58 then copy actual review edits/issues and replace that reason with `review-stale`, because the override guard exempts `timeout` but does not exempt an explicit cancellation.

Smallest fix: preserve the runner's explicit cancellation reason when reconciling a review outcome, alongside the existing timeout priority. Continue calling `reviewOutcome()` and copying its actual edits/issues; do not bypass the read or weaken `activeEpoch`, write-fence, finish, or CAS guards. A conditional exemption for a recorded `unfinished` cancellation is sufficient for the observed path. A signal-based exemption additionally covers an SDK result returned at the same cancellation boundary.

Meaningful regression: keep the existing Legacy/canonical shutdown test and `canonical-local-maintenance.test.ts:382-401`, which expects `partial/edits:1/review-stale` when a real authority epoch closes before or after finish with no explicit cancellation. Preserve the pre-finish stale-authority refusal at lines 641-655. Cancellation after a committed edit must remain partial with its factual edit total and no successful watermark.

## 2. The reachable Local runNow wrapper discards operation progress

Exact operation path:

1. `memory/operations/memory-operation-kind-tidy.ts:27-29` supplies `onProgress` to `runtime.runNow`; it invokes the existing `updateProducer` owner.
2. `runtime-configuration-application.ts:72-78` selects published Local first and forwards `(characterId, options)` to its Tidy surface.
3. `canonical-local-subsystem.ts:46-51` builds the raw pass with the direct canonical `engine.tidy`, then returns the published fenced Tidy surface at line 67.
4. `canonical-local-writers.ts:61-62` overrides `runNow` with a one-argument function and invokes the raw pass with only `characterId`. This drops `options.onProgress` before any `TidyPass` callback can run.

This directly explains `memory-tidy-runtime.integration.test.ts:237-247`: a real first `block_rethink` has committed Block revision 1 when the second actual SDK call is gated, while the durable operation producer is still zero. The later operation-owner reconstruction at lines 249-273 must retain that edit and reject the retired operation's second replacement.

Smallest fix: accept and pass `options` through the Local fence wrapper, preserving `fence.admit`. Do not add a parallel counter, reconstruct edits from Block revision, defer producer persistence until settlement, or move the callback outside the mutation transaction.

## 3. Existing atomic progress/rollback contract must remain intact

- `tidy-pass.ts:131-135` captures `baseEdits` and provides `onEdits`, translating batch edits into operation progress. The callback currently emits a proposed progress object; it deliberately does not mutate the pass's in-memory progress before commit.
- `canonical-tidy-review.ts:112-127` guards current authority and receipts, executes the real mutation in `repo.transaction`, and invokes `onEdits(review.edits + 1)` inside that same transaction only for successful applied non-finish effects. Cached receipts return before the callback. `acceptResult` at lines 141-156 increments the in-memory review total and records its receipt only after the transaction returns.
- `canonical-memory-maintenance-repo.ts:20` and `canonical-memory-maintenance-storage.ts:16-25` route that transaction to the same Core SQLite connection. `structured-memory-block-repo.ts:27-43` nests Block epoch/CAS checks and replacement into it.
- `memory-operation-service.ts:186-190` rejects progress for a settled operation. `memory-operation-repo.ts:78-92` updates producer JSON through an expected-state/terminal-state CAS inside a nested transaction.
- `memory-operation-service.ts:243-247` publishes through `db.afterCommit`, and `sqlite.ts:117-145` merges nested callbacks into their outer frame and discards them on rollback or COMMIT failure.
- If producer persistence throws after a Block write, the outer transaction rolls the Block and producer JSON back together. `canonical-tidy-review.ts:129-137` restores captured Block evidence and records a factual no-write issue; no accepted receipt/edit is created.

Relevant existing checks: `memory-operation-kind-tidy.test.ts:52-68` asserts atomic producer updates and publication only after outer commit/rollback; lines 83-96 assert restarted-owner evidence retention and rejection of retired progress from within a mutation. `sqlite.test.ts:297-307` checks after-commit callbacks against an actual deferred-FK COMMIT failure. `canonical-local-maintenance.test.ts:206-228` protects receipt replay and unchanged-effect counting; lines 658-678 protect committed edits after stale CAS or later model failure.

The strongest focused integration check is the existing two-call gate/restart test, because it uses the actual composed Local producer, Block writer, operation service and RPC. Owner reconstruction plus release of the held second call must leave Block revision 1, producer edits 1, and the recovered `outcome_unknown/core_restart` row unchanged. The raw transaction checks alone could not detect the missing wrapper argument.

## 4. Adjacent typed wrappers and bounded scope

- `runtime-selector.ts:198` drops `TidyReviewOptions` in its delegating `captureReview`. Forwarding options preserves `onEdits`, short model references, and admitted `intentionsDefaultDays`. This is independently incorrect relative to `memory-engine.ts:56-65`, but it is not the direct cause of the reported Local operation test: the raw Local pass captures `engine.tidy` directly.
- `hindsight/hindsight-writer-fence.ts:40-41` likewise drops `runNow` options. Forwarding the optional argument while retaining the fence is the same narrow interface repair. Current main's `hindsight-memory-subsystem.ts:171-184` adapter itself consumes no `onProgress` and returns final actual curator effects, so this forwarding repair does not establish intermediate native progress or native/SQLite atomicity. Do not invent those claims or redesign accepted main Hindsight to make this Local fix pass.
- `authority-aware-legacy-surfaces.ts:17` also drops options, but an exact symbol search found no production caller of `authorityAwareTidy` in the current memory tree. Treat it as an adjacent dormant seam, not evidence that the failing Local path uses it. `runtime-composition.ts:132` exposes a one-argument public convenience method, while durable operation execution uses the separate options-aware configuration port above.

## Verification limits

The advisor verified wiring, guards and existing executable expectations from current source; the two failures were reported by root's earlier test runs. This advisor did not rerun tests or claim live-provider or owner acceptance. Root should repair the smallest forwarding/reason guards, run the named focused tests, and retain the existing transactional and genuine-stale-authority tests. There is no evidence requiring changes to mutation/CAS/receipt accounting, schemas, or main Hindsight product behavior.
