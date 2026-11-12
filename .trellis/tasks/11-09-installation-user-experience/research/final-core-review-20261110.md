# Final Core integration review

Date: 2026-11-10. Reviewer: Core runtime worker acting independently of root's
composition changes. Read-only production review; subsequent parent authorization
allowed only regression tests, migration-test fixtures, and this record.

The review used the original PRD/design: configuration-independent basic services,
dependency-scoped availability, actual applied settings, preserved admitted Runs and
user data, and the owner's Hindsight exclusion. This is a bounded Core review, not
native UI, full-product, paid-provider, or owner acceptance.

## Verified findings and disposition

### 1. Concurrent Legacy search rebuild overwrote a later ranking application

Before the fix, `memory-engine.ts` applied its captured `bm25Weights` after awaiting
the tokenizer rebuild. Meanwhile `runtime-composition.ts` separately applied and
committed a newer ranking group through `reconfigureRanking`. Ordinary config
observers do not serialize independent changes, so the old async completion won.

A Node 24.18 real-SQLite probe with 70 Legacy files observed the actual prepared
ranking sequence `2,1,2 -> 1,4,2 -> 2,1,2`. The new weights were briefly effective,
then silently reverted although their configuration application was successful.

Root removed the unrelated ranking assignment from the rebuild completion. The
explicit ranking port now owns that change (`memory-engine.ts:160`).
`runtime-configuration-race.test.ts` verifies actual held-tool search result order
before, during, and after the concurrent rebuild. The new ranking remains effective.
Status: fixed and regression passed.

### 2. Manual tidy could dispatch Utility while the startup index policy was unknown

Foreground capture, direct writes and retention waited/refused correctly, but the
manual tidy producer's configuration capture did not check search readiness. The
Operations path reaches that same raw producer through `tidyOperationRuntime`.

A real-SQLite Canonical fixture with a retained fact lacking disclosure and no
projection-policy row produced `{ready:false,stoplist:null}` both before and after
manual tidy, while its scripted Utility model had already received one call. The
operation failed without an applicable tokenizer. This was a deterministic model
fixture, not a paid endpoint.

Root added the check before `createTidyPass` admits work in both
`canonical-local-subsystem.ts:45` and `bootstrap.ts:94`. The regression covers
Canonical and Legacy: unknown search policy refuses with
`MEMORY_SEARCH_INDEX_UNAVAILABLE`, zero model calls and unchanged retained rows.
Status: fixed and both regressions passed.

### 3. Cold invalid desired search config hid a proven usable applied policy

A persisted supported `stoplist=false` projection with invalid desired startup
configuration continued to serve Local Runs, but application metadata reported
`unavailable` and `activeValue:null`. The basic runtime was correctly retaining
the old index; the displayed state failed to describe that fact.

The original real-SQLite probe observed successful Local capture with
`searchStatus={ready:true,stoplist:false}` and the contradictory unavailable/null
observation. Root added `observeInitialSearch` (`memory-search-application.ts:63`),
which reports failed desired configuration with the proven previous active value.
The regression now observes `failed/"off"` while Local capture remains usable.
Status: fixed and regression passed.

### 4. Utility-only context updates shared Main's invalid-policy gate

Source tracing found that the `main.ts` observer handled every context key by first
refreshing Main and throwing on its policy issue. With Main configured but invalid
and Utility independently usable, a valid Utility window update could not reach
Memory's environment refresh. Root separated Utility context and Compaction's
keep-message setting before the Main gate (`main.ts:264`).

Status: corrected by source inspection. This review did not run a separate real
Core/Main-invalid/Utility-update process scenario; final integration checks own
that remaining evidence boundary.

## Persistence, retained work and ownership checks

- Production Local/Legacy composition injects the persisted policy binding and
  runs narrow abandoned-candidate cleanup before constructing its live search
  application. Unknown policy is never inferred from desired configuration.
- The rebuild writes policy inside the FTS rename/drop transaction. Its in-memory
  facade publishes only after commit. Metadata-write and actual SQLite COMMIT
  failure tests retain the old pair; reopen recovers a committed publication even
  when its old process callback was lost.
- Dirty source identities reconcile Canonical insert/edit/hide and Legacy metadata
  changes before synchronous final publication. Same-authority retained tools use
  the stable tokenizer facade; explicit authority fencing still owns cutover.
- Retention is numerically captured for new Local Runs/operations. Provider facades
  share retrieval/vector-health ownership. Existing explicit expiries remain facts;
  changing defaults does not rewrite those records.
- Malformed optional policies do not create a replacement database or authority.
  Invalid groups remain unavailable; valid independent groups can still operate.
- A final diff-name check still lists exactly the five inherited Hindsight adapter
  files from its dedicated handoff. Withdrawn routing/rebinding/search identifiers
  were absent from `packages/core/src`. No Hindsight implementation was changed by
  this review or its authorized test corrections.

## Authorized migration-test corrections

The parent's full-suite run exposed hardcoded current-tail expectations ending at
69 after migrations 070/071/072 were registered. Eight current-tail test files now
expect 72 while retaining their existing row/byte/receipt/schema/FK assertions.
The lineage matrix additionally checks the three new tables.

The 069 convergence test already imported the exact migration object. Its failure
was a different fixture drift: the shared Subagent fixture opened the full current
schema, then the historical test removed only receipt 69. A max-version runner saw
72 and correctly skipped 69. The test-local registry is now fixed at `<=69` so the
historical recovery scenario remains the one it claims to model. Current full-tail
reopen coverage remains in the lineage matrix; production migration behavior and
all data-preservation expectations are unchanged.

Changed test files:

- `db/cache-usage-repo.test.ts`, `pending-memory-repo.test.ts`, `scheduled-task-repo.test.ts`
- `db/migrations/041-canonical-memory-maintenance.test.ts`, `048-memory-operations.test.ts`,
  `058-agent-inbox.test.ts`, `065-auxiliary-model-usage.test.ts`,
  `069-delegation-schema-convergence.test.ts`, `lineage-reopen-matrix.test.ts`
- `memory/runtime-configuration-race.test.ts` (new)

## Validation and limits

`pnpm --filter @taki/core exec vitest run --maxWorkers=2` over the nine database
suites and the race suite passed 89 tests in 21.84 seconds. After adding the cold
invalid-policy regression, the race suite passed all four tests. The combined
covered set is 90 tests: 86 database/migration tests and four runtime regressions.
Scoped ESLint and tracked `git diff --check` passed.

No further confirmed blocking finding remained in this reviewed scope after the
listed fixes. This does not declare the entire task complete: root still owns the
integrated typecheck/full-suite outcome, startup/resource measurements, other
reviewers' areas, and user acceptance. The earlier full-suite failures and timing
limits are not reclassified as passed by these focused results.
