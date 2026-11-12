# Memory Regression Repair Evidence

## Scope and boundary

Executed in `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`, with Node `v24.18.0`, pnpm `10.22.0`, and Vitest `4.1.10`. The parent explicitly assigned this task; the integration clone has no `.trellis/.current-task`. No commits, staging, branch alignment, original-profile writes, paid providers, live Native/PostgreSQL stack or external messages were performed by this worker.

The initial focused reproduction (`test-memory-repair-initial.json`) had 125 tests: 86 passed and 39 failed. The final focused run (`test-memory-repair-final.json`) has **165/165 passing tests across 20 actual files**, with a 192.719-second test-result span. These are deterministic Core/SQLite tests with synthetic transport/model ports, not connected-service, real-corpus or owner-manual acceptance.

## Verified causes and repairs

- **Historical Timeline construction:** capped main 055/059 fixtures used the current Timeline repository before the T4 source-context columns existed. `memory-historical-timeline-fixture.ts` preserves frozen-main append/read/name-only tool-call semantics, rejects newer source/presentation fields, and adds a test-only transactional batch adapter. The existing caps remain intact: archived candidate evidence is not upgraded. Historical transition recovery performs full convergence only at its existing upgrade boundary; old receipts remain asserted byte-for-byte.
- **Captured recall policy:** current Run admission constructs an independent provider through `captureRetention`. Initiative tests now observe that captured provider, retaining the real one-attempt-per-Bank, authority-change, cancellation and original-Source checks instead of spying on an unused public provider.
- **Unknown Local search policy:** activation fixtures now explicitly describe the empty Legacy index's default applied tokenizer, and initialize newly admitted Local search through the supported `captureRun` path. Local-only projection metadata is read lazily, so a historical Hindsight composition does not require an unused newer Local table.
- **Local transition readiness:** a real red regression showed `searchStatus.ready === false` after successful Local bind, followed by missing queued-write receipts. `prepareLocal` in the existing configuration owner awaits the existing index producer and rechecks liveness plus the full current authority identity. Local transition bind/source recovery waits for that readiness before returning. Failure preserves the committed authority, original queue and publication receipt; later recovery completes the original intent. Runtime stop rejects a late initialization outcome.
- **Nonretiring summaries:** actual Compaction preserves every raw Timeline/source row. Published Local and a published Hindsight binding whose bound identity matches the current marker may therefore commit summaries independently of extraction. Failed/unpublished/mismatched Hindsight paths retain factual flush refusal. Tests assert unchanged raw Timeline bytes, no fabricated extraction receipts and no model dispatch on refusal. Direct source retirement remains strict.
- **Hindsight coverage:** pending entries are split at an unproven user occurrence. Every supplied source still proves all included witness IDs/digests and rejects a missing or omitted user inside its own range. Both completion and coverage advancement revalidate completed source/outbox receipts, then advance only through the first actual gap. Existing durable cursors remain monotone; observations and flush cannot authorize retirement across a newly incomplete group. Known groups on both sides of a hole can process independently without crossing it.
- **Pre-baseline custody:** both Local and Hindsight flush adapters refuse an actual `coverageGap` before the historical-baseline exemption. Hindsight coverage includes exact open custody members even before the eligibility baseline and includes assistant-only groups. The DB worker's repo-backed regression separately established red-to-green behavior.
- **Runtime shutdown:** the existing liveness/start/producer-settlement owner lives in `runtime-lifetime.ts`. Its one shared stop completion includes configuration, transition, Utility, maintenance and retired bindings. Repeated stop returns the same completion and joins producers before SQLite closes.
- **Read/projection assertions:** configuration comparisons use current control identity while independent full publication admission still runs its validators. Cancelled but unsettled turns remain occupied under T4's non-replacing registration semantics. Unavailable prompt tests assert the retained truthfulness guarantees using current wording. Opaque records with no direct Source refuse stronger recall evidence before unnecessary per-candidate control reads; real Source evidence and currentness checks are unchanged.

The preexisting Tidy repair was preserved. Final coverage includes `tidy-shutdown.test.ts` and `memory-tidy-runtime.integration.test.ts` without further Tidy production changes.

## Files changed by this worker

Production:

- `packages/core/src/db/hindsight-ingestion-source-repo.ts`
- `packages/core/src/db/hindsight-ingestion-repo.ts` (parent-approved shared DB ownership)
- `packages/core/src/memory/memory-flush-port.ts`
- `packages/core/src/memory/runtime-compaction-composition.ts`
- `packages/core/src/memory/runtime-composition.ts`
- `packages/core/src/memory/runtime-configuration-application.ts`
- `packages/core/src/memory/runtime-lifetime.ts` (new existing-owner extraction)
- `packages/core/src/memory/transitions/transition-runtime.ts`
- `packages/core/src/memory/hindsight/hindsight-ingestion.ts`
- `packages/core/src/memory/hindsight/hindsight-recall-evidence.ts`

Fixtures and tests:

- `packages/core/src/testing/memory-historical-timeline-fixture.ts` (new)
- `packages/core/src/testing/hindsight-runtime-composition-fixtures.ts`
- `packages/core/src/memory/hindsight-activation/hindsight-activation-fixture.ts`
- `packages/core/src/memory/initiative-memory-recall.test.ts`
- `packages/core/src/memory/runtime-activation-failure.test.ts`
- `packages/core/src/memory/runtime-composition.test.ts`
- `packages/core/src/memory/hindsight-runtime-composition.test.ts`
- `packages/core/src/memory/hindsight/hindsight-configuration-context.test.ts`
- `packages/core/src/memory/hindsight/hindsight-ingestion.test.ts`
- `packages/core/src/memory/hindsight/hindsight-policy-schedule-wiring.test.ts`
- `packages/core/src/memory/hindsight/hindsight-unavailable-run.test.ts`
- `packages/core/src/memory/transitions/transition-healthy-queue.test.ts`

Folder indexes: `memory/index.md`, `memory/hindsight/index.md`, `memory/transitions/index.md`, `testing/index.md`. The parent owns DB/spec truth-source updates after independent review.

## Validation commands and artifacts

All commands ran from the integration root. Each Vitest run uses `--maxWorkers=1 --reporter=json`; output paths resolve from `packages/core` through `../../.trellis/tasks/11-11-main-t4-baseline-integration/research/`.

```powershell
pnpm --filter @taki/core test src/memory/transitions/transition-healthy-queue.test.ts -t 'applies the Local search projection' --maxWorkers=1 --reporter=json --outputFile=../../.trellis/tasks/11-11-main-t4-baseline-integration/research/test-transition-local-search-red.json
pnpm --filter @taki/core test src/db/primary-memory-custody-repo.test.ts src/memory/memory-flush-port.test.ts --maxWorkers=1 --reporter=json --outputFile=../../.trellis/tasks/11-11-main-t4-baseline-integration/research/test-custody-flush-repair.json
pnpm --filter @taki/core test src/memory/hindsight-runtime-composition.test.ts src/memory/initiative-memory-recall.test.ts src/memory/runtime-activation-failure.test.ts src/memory/runtime-composition.test.ts src/memory/hindsight-candidates/hindsight-candidate-admission.test.ts src/memory/hindsight-candidates/hindsight-candidate-verifier.test.ts src/memory/hindsight/hindsight-configuration-context.test.ts src/memory/hindsight/hindsight-ingestion.test.ts src/memory/hindsight/hindsight-policy-schedule-wiring.test.ts src/memory/hindsight/hindsight-runtime-guard-cost.test.ts src/memory/hindsight/hindsight-unavailable-run.test.ts src/memory/transitions/transition-healthy-maintenance.test.ts src/memory/transitions/transition-healthy-queue.test.ts src/memory/transitions/transition-runtime.test.ts src/memory/memory-flush-port.test.ts src/memory/runtime-configuration.test.ts src/memory/runtime-configuration-race.test.ts src/memory/hindsight/hindsight-initiative-memory.test.ts src/memory/tidy-shutdown.test.ts src/memory/operations/memory-tidy-runtime.integration.test.ts --maxWorkers=1 --reporter=json --outputFile=../../.trellis/tasks/11-11-main-t4-baseline-integration/research/test-memory-repair-final.json
```

The issued final command also named `src/db/hindsight-ingestion-repo.test.ts`; that path has no standalone file, so the actual 20-file/165-test count above comes from the report rather than the argument count. The reproduction command printed above omits that ineffective selector.

Additional artifacts: `test-memory-repair-round1.json` (73 tests, four remaining failures), `test-memory-repair-round2.json` (50 tests, four remaining failures), `test-memory-repair-round3.json` (91/91), `test-transition-local-search-green.json` (26/26), and `test-memory-final-lifetime.json` (35 tests, one closed-code expectation corrected before the final run).

Scoped ESLint passed for all 22 changed TypeScript files. The earlier lint identified composition size accumulation; the coherent lifetime-owner extraction resolved it without compression or rule relaxation. Owned tracked `git diff --check` passed; new files were separately covered by ESLint and review. Unified Core typecheck and isolated Node boot/native gates remain coordinated by the parent/DB worker.

## Remaining limits

No assigned memory failure remains in the final focused tests. The full Core suite was not rerun by this worker. Independent review, final typecheck, actual strip-only startup, connected Native/PostgreSQL journeys, historical stopped-copy replay and owner acceptance remain the integration task's separate gates. No memory-source scale or process-memory claim is inferred from test counts.
