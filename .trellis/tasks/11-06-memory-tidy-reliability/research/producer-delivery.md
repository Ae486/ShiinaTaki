# Local tidy producer delivery

## Implemented

- Fresh review capture occurs inside the shared Utility Slot. Duplicate direct requests join one promise; production durable admission remains owned by MemoryOperationService.
- Canonical reports use short pass-local references. Full duplicate-group evidence/targets remain visible even when the seed-candidate cap is smaller than the group. Only the actual visible union is checkpointed.
- One explicit issue ledger accepts known no-write corrections through a later successful call ID, or a closed not-needed disposition. Exact prior CAS correction remains supported. Corrected and skipped counts are separate; neither invents an applied edit. Unknown persistence/authority/request-identity failures stop further model mutations.
- The loop stops on accepted finish, rather than merely calling finish. SDK-invalid inputs enter the same ledger and are disclosed to the next step. Conflict responses disclose the current scoped record/Block before granting its new reference; no stale write silently retargets.
- Local writes and operation applied-count callbacks share the canonical transaction. Callback failure rolls the mutation back. Identical Block replacements are no-ops after a revision check.
- Migration 067 adds exact memory revision/time coverage, Block revision coverage, and automatic retry eligibility. It does not infer coverage from historical success timestamps. Successful bounded batches checkpoint independently; unseen and externally changed versions remain pending. A tail below the ordinary forty-write cadence can continue.
- One default 120-second cooperative HTTP timeout and the existing total step budget cover all batches. SDK calls execute tools sequentially with no independent provider retry layer. Automatic failures wait at least one minute, then five minutes, then require an explicit retry; eligibility is checked on the next maintenance trigger, not by a new timer.
- Raw unreadable capture refuses without fabricating remaining=0. Timeout after an applied edit retains its exact effect count and leaves coverage pending.

## Files

Modified existing Local tidy/report/pass/view/subsystem modules and migration/index entries. Added `canonical-tidy-review.ts`, `tidy-agent-runner.ts`, `tidy-coverage.ts`, `tidy-issues.ts`, `tidy-prompt.ts`, `db/memory-tidy-review-repo.ts`, and migration `067-memory-tidy-reviews.ts`. Added focused issue, whole-chain producer and migration/reopen tests. Shared schemas, outer runtime wiring, operation ownership and Home integration are owned by the parent/other worker.

## Validation

From H:/TakiAgent-worktrees/t4:

```powershell
pnpm --filter @taki/core exec vitest run src/memory/tidy-reliability.test.ts src/memory/canonical-local-maintenance.test.ts src/memory/tidy-pass.test.ts src/memory/tidy-report.test.ts src/memory/tidy-issues.test.ts src/db/memory-tidy-review-repo.test.ts --maxWorkers=2
```

Result: **6 files, 86 tests passed**. This includes the actual compatible HTTP adapter receiving one successful Block tool response followed by a stalled response; timeout preserves the edit and releases the Utility Slot for subsequent work.

Scoped ESLint over all changed producer modules/tests passed. `git diff --check` passed with existing CRLF normalization notices only. The final `pnpm --filter @taki/core typecheck` rerun exited successfully.

The former unknown-repository-error test expected a later mutation after the unknown failure. Its expectation was strengthened to stop immediately, assert one model call and zero later edits, while retaining the unresolved issue and privacy assertions. Existing Legacy/Canonical maintenance tests otherwise remain unchanged.

## Limits and tradeoffs

- SDK timeout is cooperative. The shipped compatible HTTP adapter is tested; arbitrary injected providers that ignore cancellation are not promised a hard termination guarantee.
- A duplicate group is an indivisible review unit, matching the existing report's group behavior. The cap limits seed candidates and does not truncate peer evidence. This preserves deduplication capability rather than pretending a peer count is enough for judgment.
- No paid model, live application database mutation, packaged UI/human acceptance, commit, push or archive occurred in this producer subtask. Model quality and full rendered/runtime integration are separate final gates.
- `tidy-report.ts` already contained one literal NUL in its duplicate-key delimiter at HEAD; its Git diff is therefore displayed as binary unless `--text` is used. This patch did not introduce that NUL.

## Full-gate follow-up

The parent full gate exposed explicit latest-version/tail snapshots in nine existing migration/repository test files. Focused reproduction showed expected 66 versus actual 67 (or the same ordered array with 67 appended), not lost historical data. Those explicit snapshots now include migration 067; all existing byte-preservation, lineage-gap, receipt, overflow and reopen assertions remain intact. The lineage schema matrix also checks the three new checkpoint tables.

The five runtime activation failures were a genuine compatibility regression: the optional clean preview catch deferred a Legacy retirement refusal, then replaced MEMORY_AUTHORITY_FENCED with MEMORY_PROVIDER_UNAVAILABLE. Non-capturing Legacy views now preserve their original report/admission exceptions; only a recapturable Canonical view can defer to a queued snapshot. The runtime activation tests were not weakened or changed.

Focused follow-up: nine files / 71 tests passed; the additional one-test migration registry check and scoped lint were run separately. No full-suite rerun was performed by this worker; the parent owns the final workspace gate.

The final reviewer also identified that a stopped automatic retry budget was not distinguished in the returned next action. The producer now emits `manual-retry` only after a successfully persisted retry state reports positive failures and no future retry eligibility. A retry-state persistence/authority exception does not imply that stop state. The parent owns the matching Shared/UI contract and final cross-layer verification.
