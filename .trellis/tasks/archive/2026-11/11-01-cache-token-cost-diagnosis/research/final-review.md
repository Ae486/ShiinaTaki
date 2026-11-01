# Final independent source and compaction review

Date: 2026-11-01. Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`; HEAD: `6b36d0d`.

## Conclusion

No production behavioral defect was confirmed in the reviewed implementation. The change follows the approved bounded design: capture exact source membership at the local Timeline writer, reuse the existing provider journals and immutable receipts, and admit canonical compaction independently of ingestion. This reviewer added two missing persistence-path regressions and corrected one obsolete source comment. No new guard, queue, dependency, provider call, or production behavior was introduced by the review.

The session task's PRD explicitly supersedes the stale legacy `.trellis/.current-task` pointer. Review used the PRD, accepted design, curated check specs, simplification scope review, implementation checkpoints, current code and real temporary SQLite tests. Existing unrelated dirty changes were preserved.

## Checked paths and contracts

Paths below are relative to `packages/core/src/`.

- Source ownership: `db/primary-conversation-source-repo.ts`, `db/migrations/064-primary-conversation-sources.ts`, migration registration and `db/timeline-repo.ts`. Begin, response append/seal, and retract are atomic; exact members are linked instead of inferred from ranges. Run captures retain admission memory identity. No-Run callers capture the local selected provider/epoch/lineage marker without a capability or connection call. Boot closes actual interrupted inputs, without inventing response rows or settling Runs/Effects. Migration 064 leaves historical unknown rows and old journal/receipt bytes unchanged.
- Chat wiring: `agents/conversation-store.ts`, `conversation-turn-writer.ts`, `turn-recording.ts`, `chat-agent.ts`, and `main.ts`. Post-commit publication waits for the outer transaction; completed and partial output uses one source across the supported retry; retracted input is never imported. Main installs the writer and invokes `recoverOpen()` after Run recovery and before trigger admission. The compatibility witness callback is not the production source producer.
- Local/Hindsight consumers: `db/{canonical,hindsight}-ingestion-source-repo.ts`, both ingestion journal repositories, `db/primary-ingestion-progress.ts`, `memory/canonical-ingestion-source.ts`, `canonical-local-ingestion.ts`, `canonical-local-subsystem.ts`, and `memory/hindsight/{hindsight-ingestion,hindsight-memory-subsystem}.ts`. Import selects captured provider/epoch/lineage, runs before cadence, keeps failed sources durable, and excludes existing occurrences from either provider. Exact witness/digest/claim checks and immutable plans/receipts remain. Later known groups can be processed despite older unknown user rows; groups stop at omitted user occurrences and continuous coverage stops before the first unresolved boundary.
- Independent summary: `agents/compaction-coordinator.ts`, `compaction-pass.ts`, `db/compaction-operation-repo.ts`, `memory/auto-memory.ts`, and `runtime-composition.ts`. Canonical maintenance and compaction have separate per-Character chains and retain the existing shared Utility Slot. Legacy alone retains its real flush. Dispatch rejects expired/cancelled ownership, valid dispatch renews the lease without a fake flush event, and commit still checks source digest and summary CAS. Summary instructions preserve salient names/preferences/current constraints while extraction is delayed.
- Compatibility reader: `db/primary-memory-source-read.ts` and `primary-source-row.test.ts`. New unbound sources preserve captured epoch evidence, while old absent source metadata remains a direct legacy-compatible source; provider-backed lookups still use the original claimed source and receipt baseline.

## Findings (fixed)

1. File: `packages/core/src/agents/chat-agent-primary-source.test.ts:104`.
   Issue: iterator-close and accepted-independent-work cancellation were not directly exercised with the new durable source writer and a real SQLite reopen.
   Fix: added two regressions proving exact retained membership, no fabricated/unread response, no detached maintenance, no false retract, and unchanged source after reopen. Accepted-independent-work cancellation preserves the original `AbortError`; the test does not require normal completion or settle a Run/Effect.
2. File: `packages/core/src/agents/conversation-store.ts:88`.
   Issue: `windowStart` documentation still asserted all compaction flushes before advancing summary coverage.
   Fix: clarified that the shared projection boundary feeds Legacy flush, while canonical ingestion owns independent durable coverage.

## Findings (not fixed)

None confirmed within this review's authorized production scope.

## Verification

Environment: Node `v24.18.0`, pnpm `10.22.0`, Vitest `4.1.10`; no real service/model dependency in these tests.

- Source/migration/writer/ingestion compatibility: **107 tests passed, 8 files**, before the two review-added cases.
  `pnpm --filter @taki/core exec vitest run src/db/primary-conversation-source-repo.test.ts src/db/migrations/064-primary-conversation-sources.test.ts src/agents/chat-agent-primary-source.test.ts src/agents/conversation-turn-writer.test.ts src/memory/canonical-local-ingestion.test.ts src/memory/hindsight/hindsight-ingestion.test.ts src/db/canonical-ingestion-repo.test.ts src/db/primary-source-row.test.ts`
- Final changed lifecycle suite: **8 tests passed**, including both added cases.
  `pnpm --filter @taki/core exec vitest run --maxWorkers=1 src/agents/chat-agent-primary-source.test.ts`
- Lint: **pass** over the 24 reviewed source/test files; the changed test was linted again after its cancellation expectation was corrected.
- TypeCheck: Core `pnpm --filter @taki/core typecheck` **pass**, including the final rerun after the test/comment additions.
- Scoped tracked-file `git diff --check`: **pass**. Git emitted only existing CRLF normalization notices.
- Compaction and composition deterministic suites were already run by the implementation owner: 95 tests across 7 compaction/auto-memory files and 31 tests across 2 production-composition files. Those are checkpoint evidence, not a second run by this reviewer. Parent owns full-project gates and isolated Core boot.

## Limits and retained tradeoffs

- Exact-source import is bounded to 256 retained source IDs per invocation; provider journals still own one pending span per Character. This slice introduces no general recovery queue or paid startup catch-up.
- An active model call can still occupy the single Utility Slot. Independent admission removes maintenance-completion gating; it does not add paid concurrency or preempt an in-flight request. An expired queued compaction requires a later ordinary trigger.
- No live database mutation, historical relabeling/repair, native Hindsight/model call, paid catch-up, Git commit/push, or owner acceptance was performed by this reviewer. Real summary quality and actual token/currency savings remain unmeasured.
