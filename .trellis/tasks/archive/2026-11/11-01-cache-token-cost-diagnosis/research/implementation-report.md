# Source recovery and independent compaction implementation

Later follow-up: the owner authorized real-data catch-up, which is now complete. See
[real-catchup-report.md](real-catchup-report.md). The no-live-data/no-paid-call statements below describe this earlier code-only delivery.

Date: 2026-11-01. Worktree: `H:/TakiAgent-worktrees/t4`; branch: `task/t4-skills-mcp-productization`.
The owner approved implementation of batches 1 and 2 plus a read-only historical preview. Existing unrelated work
was preserved. No application-provider paid call, real-data repair, Git commit/push or archive was performed.

## Result and responsibility boundaries

The original failure chain had two unnecessary dependencies: exact source proof was written after the chat transaction,
and context compaction waited for successful canonical ingestion and maintenance. The implementation removes those
dependencies while preserving actual source identity, cancellation, immutable processing receipts and summary CAS.

- The primary Timeline writer now persists input and an open local source atomically. Actual responses and the retained
  source seal commit together. Empty cancellation retracts input/source together; partial output and independently accepted
  work preserve their existing semantics. Publication follows the outer transaction's successful commit.
- Source capture records the available admission Run memory snapshot, or local authority identity for no-Run callers.
  Provider availability and capability changes do not decide whether valid conversation data is durable. Binding compares
  provider/epoch/lineage; it does not move work to a new authority or create two provider witnesses for one occurrence.
  One input source survives supported retries; Run correlation is captured locally, while Attempt state remains owned
  by the existing Run ledger rather than introducing a second attempt lifecycle.
- Boot closes previous-process open inputs from their actual saved membership before new dispatch. It does not invent
  assistant output, replay a paid call or settle an uncertain Run/Effect. Source currentness preserves captured authority
  even before asynchronous provider binding.
- Local and Hindsight ordinary maintenance import retained sources into their existing witness/span/receipt paths.
  Unknown older user gaps no longer stop later valid groups. Grouping preserves gap boundaries, while continuous coverage
  still reports its first unresolved source. Existing provider journals and confirmed receipts are reused.
- Canonical compaction is independently admitted and no longer calls a forced extraction flush. It keeps the raw Timeline,
  original source digest validation, quality checks, cancellation and atomic summary replacement. Shared Utility Slot
  dispatch renews only a still-valid lease; cancelled/expired queued work makes no model request. Legacy retains its
  original extraction/flush ordering and respects in-process retirement.
- The summary prompt preserves salient names, preferences, facts and current constraints without assuming long-term
  extraction already succeeded. This deliberately tolerates some fact duplication to avoid an information gap.

## Scope and cost

[implementation-files.json](implementation-files.json) lists **25 production/schema/wiring files and 28 test files**.
There is **one additive migration, 064**. Production scope remains within the reviewed 18-26 file envelope; the test
count exceeds the initial estimate because of migration lineage expectations, real composition checks and lifecycle
coverage. Many existing production files change only an interface or a wiring point. No new dependency, service,
framework, queue platform, public UI or provider protocol was introduced.

This is a medium subsystem change. Its main cost is validating persistence and compatibility, rather than replacing
the Agent architecture. It prevents future capture gaps and lets summaries progress during ingestion outages; it does
not by itself establish a particular cache-hit percentage or currency saving.

## Verification

- `pnpm -r typecheck`: passed across all workspace packages.
- `cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`: passed.
- `pnpm lint`: found one pre-existing generated snapshot issue in
  `artifacts/runtime-inbox-preimages-20261025/packages/shared/src/index.ts` (469 lines versus the ordinary 360 limit).
  `pnpm lint --ignore-pattern 'artifacts/**'`: passed. No lint rule, source assertion or snapshot was modified to hide it.
- Initial unbounded `pnpm -r test` encountered widespread timeouts during simultaneous package/type/lint work. It is
  recorded as a failed run. The bounded full rerun uses `pnpm -r --workspace-concurrency=1 test --maxWorkers=2`;
  Shared (684), CLI (50) and Desktop (1,289) passed. Core completed with 4,395 passed, 5 failed and 6 skipped.
  All five failures were old contract expectations: a migration tail omitted 064, two upgrade fixtures omitted the new
  nullable membership column, and one activation-failure fixture still required canonical flush to prevent summary
  generation. The expectations were updated to the approved contracts, preserving old-data/receipt and Legacy-fencing
  assertions; the affected suites passed targeted reruns. The analogous scheduled-task migration tail was also updated
  and passed. Core's final full rerun is recorded below. No timeout was relaxed and no failed behavior was hidden.
- Focused SQLite/source/chat/ingestion/compaction tests passed, including actual reopen at transaction/recovery boundaries,
  below-cadence binding, old witness/receipt preservation, changed authority/capabilities, unknown gaps, pending/failing
  maintenance, queue cancellation/lease expiry, Legacy behavior, iterator-close and independent-work cancellation.
  Exact commands/results are in [the compaction checkpoint](implementation-checkpoint.md) and
  [the independent review](final-review.md). Focused totals overlap and must not be added as unique coverage.
- Isolated real Node Core boot and graceful shutdown passed for fresh Legacy and canonical Local. The Local fixture
  started with an open source, recovered it to retained, and preserved exactly one input row with no fabricated provider
  witness. Both databases reached migration 064. Local fake-provider HTTP count was **0**. Logs, driver and report are
  under `target/cache-token-cost-implementation-20261101/`; the test driver's first IPC channel teardown bug was fixed
  in that driver, without changing production shutdown.
- Task manifests and tracked diff whitespace checks passed. UTF-8/JSON/link validation and final review are recorded
  with the final check results below.

### Final integrated results

- Final Core full command: `pnpm --filter @taki/core test --maxWorkers=4` — **540 files passed, 1 skipped;
  4,400 tests passed, 6 skipped**, exit 0 (319.49 seconds).
- Combined with the unchanged packages' complete successful runs: **6,423 tests passed, 6 skipped** across the workspace
  packages exposing a `test` script. This does not claim the separately invoked E2E or real-provider suites ran.
- Final Core typecheck after all test/fixture changes: passed. Full workspace typecheck, source lint excluding the
  pre-existing `artifacts/**` snapshot issue, Rust Clippy, task manifests and local Markdown/UTF-8/JSON checks passed.
  The five final fixture files also passed scoped lint and diff checks after their expectation updates.
- Independent review confirmed no production behavioral defect; its added iterator-close and independent-work
  cancellation regressions passed. Isolated Legacy/Local Core startup and graceful shutdown passed with zero model HTTP
  requests. The Local boot recovered the exact saved input source without creating an assistant row or provider receipt.
- Evidence logs are under `target/cache-token-cost-implementation-20261101/`: `typecheck.log`,
  `typecheck-final-core.log`, `lint.log`, `lint-source.log`, `clippy.log`, `tests-bounded.log`, `tests-final-core.log`
  and `boot-smoke.json`. Initial failures remain recorded; no failed run is described as green.

## Historical data and remaining limits

[Historical preview](historical-source-preview.md) confirms three unresolved old rows at 3816/3838/3847 and 417 pending
existing witnesses. They can be considered as four independent candidate groups after exact runtime checks. No old
source classification, Run settlement, baseline movement, deletion or catch-up has been applied to the real database.
New schema migration does not repair old unknown source identity automatically.

The Utility Slot remains serial; an active model request can still occupy it. Source import is bounded to 256 IDs per
ordinary invocation. Existing one-pending-span-per-Character processing remains: a failed extraction/native span retries
through its existing owner, rather than a new parallel queue. A source committed during cancellation is recovered by a
later eligible maintenance trigger, not a new paid cancellation callback. Real-provider summary quality, provider-wide
outage recovery and actual before/after cost need separate observation; deterministic tests do not prove them.

The broader diagnostic findings about replay-prefix churn, tool-result size and incomplete usage accounting remain
documented follow-ups, outside this approved implementation scope. No model switch, required-tool removal, arbitrary
history cap or capability reduction was used to improve a metric.

## Rollout and rollback

The next ordinary Core startup with this code applies the additive migration to its selected database and performs
boot-only recovery before accepting work. This task only exercised isolated test databases; it did not launch against
the user's normal data root. Preserve a normal database backup when deploying the code.

Stop Core before code rollback and preserve all new source tables, Timeline membership, provider journals and receipts.
Older code can still read the Timeline, but cannot supply the new capture/recovery guarantees and restores the old
compaction dependency. Prefer correcting forward; do not delete source evidence or rewrite historical migration receipts
to simulate rollback.
