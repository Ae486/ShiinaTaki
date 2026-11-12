# Compaction implementation checkpoint

Date: 2026-11-01. Implementer: `complete_compaction`, taking over the stopped `implement_compaction` agent. Baseline: `target/cache-token-cost-implementation-20261101/baseline/compaction/`.

## Owned changes

- `packages/core/src/agents/compaction-coordinator.ts`: optional captured `legacyFlush` port; canonical summary generation bypasses extraction without emitting a fabricated `flush_completed` event. Recheck cancellation and renew a current lease inside actual Utility Slot dispatch. Expired/stale queued work does not call the model or misreport summary-generation failure.
- `packages/core/src/agents/compaction-pass.ts`: retain salient names, preferences, hard boundaries and current constraints in rolling summaries without assuming completed long-term extraction.
- `packages/core/src/db/compaction-operation-repo.ts`: `renewLease({ lease, now, expiresAt })` updates a still-open, owned, unexpired fence without appending extraction evidence. Legacy `recordFlush` reuses that update while retaining its real event.
- `packages/core/src/memory/auto-memory.ts`: independent per-Character maintenance and compact chains; `legacyMaintenanceBeforeCompact` is captured per trigger, defaults false, and the existing Legacy wrapper selects true. `settle` and `stop` drain both branches.
- Tests: `agents/compaction-pass.test.ts`, `agents/compaction-slice4.test.ts`, `agents/source-compaction.test.ts`, `agents/chat-agent-compaction-seam.test.ts`, `db/compaction-operation-repo.test.ts`, `memory/auto-memory-shutdown.test.ts` (all under `packages/core/src/`).
- Additional parent-requested test ownership: `memory/runtime-composition.test.ts` and `memory/hindsight-runtime-composition.test.ts`. These exercise production runtime composition; no production composition/main files were edited by this agent.

## Verification

From `H:/TakiAgent-worktrees/t4`:

```powershell
pnpm --filter @taki/core exec vitest run src/agents/compaction-pass.test.ts src/agents/compaction-slice4.test.ts src/agents/source-compaction.test.ts src/agents/chat-agent-compaction-seam.test.ts src/memory/auto-memory.test.ts src/memory/auto-memory-shutdown.test.ts src/db/compaction-operation-repo.test.ts
```

Result: 7 files, 95 tests passed. A subsequent focused rerun of `src/agents/compaction-pass.test.ts` passed all 40 tests after strengthening the valid-dispatch case to complete after the original lease expiry and within its renewal, then replacing `Promise.withResolvers` with the project's existing deferred-promise pattern for the configured TypeScript lib.

Scoped `pnpm exec eslint` over the ten changed TypeScript files plus unchanged `auto-memory.test.ts`, and scoped `git diff --check`, passed. The test-only final adjustment also passed its scoped lint/diff check.

Deterministic coverage proves failed/blocked maintenance does not withhold canonical summary admission; actual constructed requests retain a name/preference/hard-boundary example; raw Timeline and ingestion watermark stay unchanged; canonical event history contains no flush event; Legacy extraction, summary quality, source digest/CAS, cancellation and competing operation behavior remain covered. New tests cover both active shutdown branches, per-Character serialization, Legacy admission capture, current lease renewal without extraction evidence, and expired/cancelled queued dispatch without a model call.

## Integration boundaries

Parent owns `main.ts`, `memory/runtime-composition.ts`, `agents/source-context-real.test.ts`, indexes and contract documents. Core typecheck was rerun after fixing this branch's four test-lib errors; only two parent-owned call sites still using the old `flush` argument remained at that point (`runtime-composition.ts:153` and `source-context-real.test.ts:116`). The parent subsequently completed those updates; final integrated typecheck remains a parent gate.

After those production wiring updates, this agent ran:

```powershell
pnpm --filter @taki/core exec vitest run src/memory/runtime-composition.test.ts src/memory/hindsight-runtime-composition.test.ts
```

Result: 2 files, 31 tests passed; both files also passed scoped ESLint and `git diff --check`. Original tests had assumed a forced retirement Write Gate for 10 rows below the ordinary 20-row threshold. Their replacement contract now verifies one real summary request, all 10 source rows still pending, unchanged contiguous cursor, and no fabricated extraction event. Additional tests demonstrate summary progress during a real Local ingestion-journal SQLite failure, a Write Gate waiting before shared-slot admission, and Hindsight maintenance fenced by connection drift. Legacy still executes its real retirement port, records `flush_completed`, and advances its flush watermark; in-process activation stops subsequent Legacy flushes. Runtime test teardown now awaits `stop()` before closing SQLite.

The existing process-wide Utility Slot remains serial: an active model task can still occupy it. This change removes maintenance-completion eligibility dependencies without introducing paid concurrency. A queued operation that expires must be retried by a later ordinary trigger.

No live database, application start, real model/native provider request, historical repair, Git commit/push or owner acceptance was performed. Real-model summary quality and actual savings are not established by these mocked-model tests. Source capture/recovery and consumer changes belong to the parallel batch-2 owners.
