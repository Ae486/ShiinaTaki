# Operation integration review

Date: 2026-11-06. Reviewed the completed Shared/operation-owner/runtime slice described in `integration-contract.md`. This is not a review of the producer or Home changes still being implemented.

## Result

One concrete join-attribution defect was found and corrected by the parent during review. The updated source has no remaining confirmed blocker within this narrow slice. Regression execution for the correction and final producer/UI integration remain the parent's validation responsibility.

## Finding and correction

### A current request could join a prior authority's operation

The initial `tidy-operation-adapter.ts` joined any active tidy with the same Character. Its call to `service.submit()` could be refused because the single global family still contained work admitted under an earlier authority, then `wait()` would return that old operation's outcome. Existing producer fences protect writes, but they do not make an old outcome a result of a new current-authority request.

The parent added a required current-authority getter to `createTidyOperationAdapter`. The reread source now captures current authority at the request boundary (`tidy-operation-adapter.ts:10-13`) and checks both Character and authority before joining (`:22-28`). A different Character or authority receives the existing busy refusal. This is a small adapter correction, not a new generic service policy.

## Verified properties

- **One active flight:** `memory-operation-kind-tidy.ts:14` uses one global `tidy` family, consistent with Global memory and Blocks being shared between Characters. Admission continues through the existing partial unique family index. The compatibility adapter joins rather than redispatches; different Characters do not borrow each other's result.
- **No raw-producer recursion:** the kind invokes the selected raw `runNow` (`memory-operation-kind-tidy.ts:27`), while `main.ts` installs the automatic callback to the operation adapter. The raw execution path does not call `maybeRun` in this slice.
- **After-commit publication:** service transitions use `publish()` (`memory-operation-service.ts:148-153`), which calls `db.afterCommit`. `sqlite.ts` keeps callbacks in transaction/savepoint frames and discards them on rollback. A progress row rolled back with a surrounding mutation is not published.
- **Retired progress aborts a mutation:** `updateProducer` rereads the operation, refuses terminal rows, and requires a successful nonterminal transition (`memory-operation-service.ts:92-97`). When the producer invokes this inside the same database transaction as its write, a restarted/retired operation cannot commit untracked new effects.
- **Restart preserves known progress:** `memory-operation-repo.ts` reconciles old nonterminal rows to `outcome_unknown/core_restart` without clearing the producer JSON. Late settlement is ignored because `settle()` leaves terminal rows unchanged.
- **Wait does not replay:** `memory-operation-service.ts:64` awaits the promise stored under that operation ID and rereads the durable operation. A new process has no old in-flight promise and immediately returns the retained terminal/unknown state. The compatibility adapter rejects an unknown outcome rather than fabricating zero edits.
- **Fresh authority check before raw invocation:** the kind compares the admitted producer authority with the current accessor (`memory-operation-kind-tidy.ts:23-25`); the runtime closure checks selection again before dispatch. The producer must still validate its captured epoch after waiting for Utility Slot admission, which is outside this slice.
- **Filtered reads are not starved by unrelated history:** operation list kind/Character filters run in SQL before the terminal limit. This avoids a busy unrelated kind hiding the latest tidy.
- **Shared types retain content-free boundaries:** the new progress/result arms contain counts and closed issues, not memory text or raw provider exceptions. Nonterminal operation results remain null; progress lives in the typed producer reference.

## Precision notes, not blocking findings

Legacy/Hindsight raw tidy paths currently ignore the new progress callback. Their durable operation may remain `admitted` until it settles even though work has begun. Do not label `admitted` as proof that execution has not started, or present Local intermediate progress guarantees for those providers. The parent was notified; no producer redesign is requested here.

If a kind returns a definite `failed/runtime_unavailable` with no result, the compatibility adapter currently uses the same unconfirmed-result error text as restart/unknown work. New operation UI can distinguish the actual outer state and reason. The old text is conservative but less precise; it is not a false successful outcome.

## Evidence and limits

Read Shared outcome/diagnostic/operation schemas; service, repository, tidy kind and adapter; main/runtime composition additions; the operation-kind tests; and the existing SQLite nested transaction/after-commit implementation. The parent reported thirteen targeted owner tests and Shared typecheck passing before this review. This reviewer did not rerun or expand those tests, so that result is attributed rather than independently claimed.

The producer must still prove atomic per-edit callbacks, exact review checkpoints, fresh queue capture, bounded retries/timeouts and actual HTTP cancellation. Home must still prove subscribe-before-read, remount/reconnect recovery, and accurate active/partial/unknown wording. Those are not inferred from this owner-slice review.

Actual changes by this reviewer: this research document only. No production edits, paid calls, live-data writes, task transitions, or commits.
