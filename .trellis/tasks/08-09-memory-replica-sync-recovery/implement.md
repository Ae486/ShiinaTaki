# Memory Replica Synchronization and Recovery - Execution Plan

The owner approved offline implementation and review of Waves 0-2. Keep the active authority unchanged and use injected
transports in offline tests. Every wave ends with focused tests and `git diff --check`; no wave edits B2 evidence or the
protected backup. This approval does not authorize live activation or Pending Memory recovery implementation.

## Wave 0 - Shared result/effect prerequisite

**Ownership:** Shared memory result schemas, coordinator error projection, governed-tool mapping, and focused regression
tests. This is a bounded prerequisite within B5; do not create a separate task.

**Proof:** offline schemas and tests cover pending receipts, valid zero-result retain, superseded/not-found mutations,
unknown/cancelled outcomes, and two-bank partial progress. Canonical `error.code` drives tool classification. This wave
does not prove replica durability or live activation.

## Wave 1 - First production slice: one Bank snapshot@C to reopen/read

**Ownership:** one-Bank journal client, validated page model, predecessor-cursor CAS, transactional replica/FTS/
checkpoint repository, and safe full canonical reader/projector.

**RED:** apply an ordered upsert and tombstone after a verified snapshot at cursor C; inject a transaction failure and
prove no partial rows/checkpoint; reject stale predecessor, lineage, generation, and lease fence; close/reopen SQLite and
read full canonical records including Taki policy/lifecycle; verify snapshot expiry leaves the prior checkpoint readable.

**GREEN:** page validation, atomic upsert/tombstone plus explicit FTS rebuild, checkpoint-last publication, and restart
read path pass with deterministic fixtures. This is the first reviewable production slice. It proves offline durability
and reader fidelity for one Bank only. It does not prove full scheduling, reconciliation, Pending replay, current Local
coverage, or Hindsight activation.

## Wave 2 - Full sync, scheduler, and reconciliation

**Ownership:** all-Bank iteration, single-flight worker, persisted lease/retry state, manual incremental action, full
logical reconciliation, and cursor-expiry snapshot rebuild.

**Proof:** independent Bank checkpoints, crash/restart catch-up, retry/backoff, manual-vs-automatic semantics, bounded
status telemetry, manifest repair, and no authority mutation. Live provider readiness remains external.

## Wave 3 - Pending and recovery

**Ownership:** Pending Memory repository, overlay projector, ordered recovery coordinator, expected-revision replay,
derived-completion wait, second pull, and superseded diagnostics.

**Proof:** outage writes survive restart, confirmed replica stays separate from unconfirmed overlay, compatible retains and
mutations converge in order, stale/missing mutations become non-blocking `superseded`, and one bad row cannot block the
rest. No blind generic Effect replay and no automatic failover.

## Wave 4 - Quality gate and activation handoff

Run focused Shared/Core tests for each wave, then package typecheck/lint and the full backend quality gate. Validate B5
task manifests and `git diff --check`. Record remaining live prerequisites: B4 current-Local coverage/final fence,
accepted Hindsight compatibility and derived completion, runtime provider wiring, and owner-approved real activation.

The full B5 PRD remains in force across all waves; Wave 1 is an ownership slice, not a narrowed replacement scope.

## Implementation status (2026-09-05)

- **Wave 0 complete:** Shared retain/mutation result contracts represent pending receipts, policy-permitted zero-result completion, superseded/not-found terminal mutations, and bounded per-Bank partial progress. Governed Effect settlement reads nested `error.code`; Local completed/applied behavior remains compatible.
- **Wave 1 complete:** Migration 033 adds a dedicated incremental replica store. Strict snapshot/journal adapters validate canonical kind, Bank, identity, revision, contiguous cursor, complete provider transaction batches, cursor windows, and empty caught-up pages. A Core-issued per-Bank lease fences atomic record/FTS/checkpoint publication; full canonical readers hide invalidated/tombstoned records by default and preserve verified snapshot metadata across reopen.
- **Wave 2 offline implementation reviewed (2026-09-06):** all-Bank execution, durable automatic/manual scheduling, fenced settlement, retry/status, verified cursor reset, and logical reconciliation pass independent review with the five fixes recorded below. This is not B5 acceptance or live activation.
- **Wave 3 pending:** durable Pending Memory outbox, explicit unconfirmed overlay, ordered recovery replay, expected-revision supersession, derived-completion wait, and second pull are not implemented.
- **Wave 4 partial:** Shared/Core focused and full package tests, typechecks, lint, `git diff --check`, and `task.py validate` pass offline. A real isolated Core boot on Node 24.18.0 applied migrations 1..33 and reached `ws server listening` on port 48991, then the process and temporary data directory were removed. No real Hindsight service, provider runtime wiring, current-Local coverage gate, authority activation, or LLM call was performed.

### First-slice proof and provider boundary

- `hindsight-replica-sync-repo.test.ts` now seeds a real file-backed SQLite database through the verified snapshot API,
  pulls an authenticated injected `changesAfter` response after cursor 8, applies a complete upsert/tombstone transaction
  through cursor 10, and closes/reopens the database after the remote snapshot expiry. Full canonical text, lifecycle,
  Taki policy, provenance, source projection, FTS, and current checkpoint remain readable.
- A checkpoint-write trigger failure proves that records, FTS, and cursor roll back together. Additional cases reject
  forged or expired lease owner/run/fence, stale predecessor/replica epoch, wrong provider lineage/Bank generation,
  payload authority mismatch, expired/tampered snapshot replacement, incomplete provider transactions, skipped cursors,
  and oversized complete transactions. Invalidated/tombstoned records remain excluded from default reads and FTS.
- Source-grounded wire evidence is `H:/hindsight/hindsight-api-slim/hindsight_api/engine/replication.py:1181-1228`:
  page size is a soft limit extended through the final transaction, and an empty page keeps the predecessor cursor.
  The existing client response budget is 512 KiB; B5 also bounds a complete page to 10,000 records. Exceeding either
  bound refuses the whole page without checkpoint advancement. Streaming exceptionally large transactions is not part
  of this slice and requires an explicit transport extension before those Banks can catch up.
- `HindsightReplicaProjection` deliberately requires trusted Bank scope and source/Memory policy/provenance bindings.
  The accepted provider snapshot does not supply a complete Taki provenance/policy contract. Missing or contradictory
  mappings fail closed; B4/B6 must supply the verified mapping before live replica initialization or runtime wiring.
- Current checkpoints include both the immutable snapshot manifest digest and a separately recomputed full canonical
  state digest. Routine journal application does not update B4 activation receipts or require an unexpired snapshot.
- Final offline test run: Shared 41 files / 363 tests and Core 295 files / 1871 tests passed. Shared/Core typechecks
  passed. Root lint retains only the existing unused-disable warning in `run-repo.ts`; B5 task validation and whitespace
  checks passed. The full B5 PRD remains incomplete until Wave 2/3 and live acceptance gates are satisfied.
- After journal client wiring, an additional isolated Core boot reached `ws server listening` on port 48992 with
  migrations 1..33. The owned process and temporary data directory were cleaned up immediately after the smoke check.

### Independent Wave 0/1 check (2026-09-06)

The reviewer independently reproduced nine failing assertions before fixing the following bounded issues:

- `memory-provider-operation-schema.ts`: completed retain accepted pending/failed Bank progress, and standalone Bank
  progress accepted missing failure codes or pending operation identities. Each Bank receipt now validates itself;
  completed retain requires all reported Banks to be complete. Valid pending two-Bank receipts still preserve one
  completed branch plus one failed branch through the production coordinator. Post-dispatch contradictory completion
  is classified as `MEMORY_OUTCOME_UNKNOWN`, without replay or authority change.
- `hindsight-journal-schema.ts` and `memory-replica-schema.ts`: the logical client boundary accepted expired/ahead
  cursor windows, per-change lineage drift, repeated batch IDs, and duplicate object transitions within one batch.
  Shared validation now rejects all of these before publication, while accepting successive revisions of the same
  object across separate transactions. This matches the provider's `append_logical_changes` duplicate-object guard
  at `H:/hindsight/hindsight-api-slim/hindsight_api/engine/replication.py:1020-1041`; the reviewer only read this source.
- `hindsight-snapshot-contracts.ts`: snake/camel aliases could silently overwrite each other before identity validation.
  Normalization now rejects collisions and keeps nested metadata/config keys unchanged.
- `hindsight-client.ts`: the 512 KiB check ran after the default transport read the complete body. The default transport
  now bounds bytes while streaming and cancels excess input; chunked multibyte JSON at exactly 512 KiB remains valid.
  HTTP refusals are classified without consuming private response bodies.

Additional file-backed production-path regressions prove a complete 501-record transaction survives the requested
500-record soft limit; 10,001-record pages and oversized/auth/reset/cancel/expired-lease responses cannot change the
prior canonical rows, FTS, or checkpoint; missing source/Memory policy bindings fail closed; complete source, mental
model, directive, lifecycle, and Chinese FTS reads survive SQLite reopen and remote snapshot expiry. These tests use
injected HTTP responses and isolated databases, never real Memory or a running Hindsight service.

Verification executed by the reviewer:

- `pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-sync-repo.test.ts src/memory/hindsight/hindsight-client.test.ts src/memory/hindsight/hindsight-client-transport.test.ts src/memory/memory-coordinator-results.test.ts src/governance/core-tool-governance-adapter.test.ts`: 5 files / 47 tests passed.
- `pnpm -r test`: Shared 42 files / 370 tests, Core 296 files / 1883 tests, CLI 8 files / 47 tests, and Desktop 103 files /
  548 tests passed. After two additional positive transaction-compatibility assertions, `pnpm --filter @taki/shared test`
  passed the final Shared 42 files / 372 tests. No Core or downstream implementation changed after the full run.
- `pnpm -r typecheck`: Shared, Core, CLI, Desktop, and E2E all passed on the final source tree.
- `pnpm lint`: passed with zero errors; the existing `run-repo.ts:6` unused-disable warning remains unchanged.
- `python ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-replica-sync-recovery`: passed with 10 implement
  and 9 check entries. The replica contract is in `backend/memory-replica-sync.md`, referenced by both context manifests,
  so it stays below the 32 KiB per-file context injection limit. `python3` is an unavailable Windows alias here; `python`
  is the installed interpreter.
- `git diff --check` and direct UTF-8/no-BOM/trailing-whitespace checks passed for the 45 relevant changed files,
  including all 19 untracked files, without staging or inspecting the protected backup.
- A separately launched hidden Core process used a newly created temporary data directory, an explicit environment
  allowlist, a dummy loopback provider configuration, and no `.env` file or real credentials. Node 24.18.0 applied
  migrations 1..33 and reached `ws server listening` on port 6257. The owned process and temporary directory were removed.

No in-scope review blocker remains for starting Wave 2 implementation from this Wave 1 foundation. B5 as a whole remains
in progress: Wave 2 scheduler/reconciliation, Wave 3 Pending Memory/recovery, the real B4/B6 policy/provenance bindings,
current-Local coverage/final fence, and owner-approved live authority activation are still outstanding. The reviewer did
not run Rust/clippy or real-process E2E because this slice changes neither Rust/Host protocol consumers nor installed
runtime replica wiring; full TS package tests and all downstream typechecks are the offline regression evidence.
No real Hindsight or LLM call, existing-user-data migration, authority cutover, commit, push, archive, or finish operation
was performed.

### Wave 2 recovery evidence (2026-09-06)

The owner-authorized offline recovery continued on `H:/TakiAgent`, `main`, from HEAD `3c67fd5`. The existing dirty
Wave 0/1 foundation was preserved. Recovery worker: `/root/hindsight_b5_wave2_impl_recovery`; session ID:
`01a0756c-8e36-7853-8598-70de26a8ded2`. No task binding, task status, B2 evidence, B4 activation receipt, or active
Memory Authority was changed by this worker.

**Completed implementation:**

- Shared `memory-replica-schedule-schema.ts` defines independent automatic/full intervals, Character/Global Bank
  identity, lease-bound runs and predecessor checkpoints, result evidence, manual request kind, retry state, and
  closed diagnostics. Unknown checkpoint/lag observations remain null; Pending Memory count has no producer here
  and is not fabricated. Defaults are six hours and seven days. Core configuration currently accepts one minute to
  31 days for ordinary polling and one minute to 90 days for full reconciliation; these are adapter validation bounds,
  not provider API limits.
- Unshipped additive migration 034 stores versioned per-Bank scheduler state and current verified single-record
  snapshot cache evidence. Migration registry, fresh/historical/reopen expectations, and the version-033 forward
  upgrade test include 034. Existing replica records and leases survive the forward upgrade unchanged and readable.
- `hindsight-replica-scheduler-repo.ts` and `hindsight-replica-schedule-state.ts` preserve explicit configuration,
  atomically acquire run/owner/fence ownership with a predecessor checkpoint, and require the same live lease/run
  plus state CAS at settlement. Recovery classifies an expired run once. Manual requests are consumed only at claim;
  a later request survives success, failure, and reopen, and full requests are never downgraded to incremental.
- `hindsight-replica-scheduler.ts` and `hindsight-replica-run-execution.ts` provide one asynchronous worker across all
  configured Banks. Automatic retry delays are 1 minute, 5 minutes, 15 minutes, 1 hour, then 6 hours repeatedly.
  Future retries suppress overdue ordinary/full polls. Manual action or verified restart/reconnection can request one
  catch-up before backoff expires. Success clears consecutive failures and computes the next interval from success.
  Explicit manual mode has no automatic due/retry wake. Stop/timeout revokes the lease before aborting transport;
  ignored aborts and late callbacks cannot publish or settle status. A stalled/failed Bank does not prevent a later
  Bank from making progress after the bounded attempt ends. Supervisor failures have a bounded readable diagnostic.
- `hindsight-replica-sync-runner.ts` is an actual admitted HTTP-client/repository implementation. It verifies health,
  version, and compatibility, pulls complete journal pages to catch-up, or captures and verifies a fresh logical
  snapshot. Cursor reset and provider lineage/Bank generation changes rebuild under a new replica epoch while
  preserving the Authority Epoch and immutable activation evidence. This runner remains outside runtime boot wiring.
- `hindsight-replica-snapshot-loader.ts` uses the existing provider `page_size=1` contract. Full reconciliation verifies
  the complete manifest, compares identity/revision/lifecycle/integrity through its per-record page hashes, and reuses
  only Bank/lineage/generation-scoped cached records whose normalized content digest still verifies. Canonical repair,
  kind-aware FTS repair/removal, cache replacement/pruning, and checkpoint publication commit atomically under the lease
  and predecessor CAS. Journal changes immediately invalidate obsolete cached payloads for that logical kind/ID.
- Full canonical source, Memory policy/provenance, lifecycle, mental-model/directive payloads, opaque nested JSON keys,
  and Chinese FTS behavior remain intact. Missing trusted B4/B6 source or policy bindings fail before publication.
  A verified local replica and its reusable evidence remain readable after the old remote snapshot expires.

**Provider contract and practical limits:**

- Source evidence is `H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py:118-150` (page-hash
  manifest), `:227-235` (Python canonical JSON), and `:300-314` (page-size slicing and hashes independent of page
  position). No new upstream manifest, fetch-by-ID endpoint, or Hindsight modification was invented.
- A cold cache cannot establish exact provider-byte equality from canonical records alone, particularly for
  Python/JavaScript numeric serialization. Its first full pass downloads every single-record page. Later manifests
  transfer changed or unverified pages and reuse verified unchanged pages even after reorder or reopen. A journal-updated
  record also needs a new snapshot-byte witness after its obsolete cached payload is removed, even if its canonical
  projection already matches. Strict selective transfer without this bootstrap/evidence cost remains unavailable in
  the current provider API; it is not claimed as proven here.
- Existing 512 KiB streaming HTTP limits and complete 10,000-record journal-page limits remain in force. Single-record
  snapshot manifests also remain subject to the 512 KiB response cap. The runner defaults to a 60-second total budget;
  the scheduler defaults to a 61-second lease with a 60-second execution timeout. Large records/manifests, expired
  snapshots, or an exceeded full-rebuild budget fail without replacing the last verified replica. No bound was silently
  relaxed, and no incomplete provider transaction or cursor suffix is acknowledged.

**Verification:**

- Initial RED command:
  `pnpm --filter @taki/core exec vitest run src/db/hindsight-replica-scheduler-repo.test.ts src/db/hindsight-replica-sync-repo.test.ts`.
  Six assertions failed while the existing 12 Wave 1 tests passed: configuration overwrite, missing running claim,
  lost in-flight manual request, arbitrary diagnostic persistence, uncounted manual failure, and same-ID document
  replacement deleting a Memory unit's FTS row. The repaired repository boundary passed 24 tests.
- Final focused command:
  `pnpm --filter @taki/core exec vitest run src/db/migrations/index-list.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/scheduled-task-repo.test.ts src/memory/hindsight/hindsight-replica-sync-runner.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts src/db/hindsight-replica-scheduler-repo.test.ts src/db/hindsight-replica-sync-repo.test.ts`:
  **7 files / 66 tests passed**. Shared schedule contract tests separately passed **1 file / 6 tests**.
- `pnpm -r typecheck`: Shared, Core, CLI, Desktop, and E2E passed.
- `pnpm lint --ignore-pattern '.backup-memory-legacy-migration-live-20260821-01/**'`: passed with zero errors and only
  the existing `run-repo.ts:6` unused-disable warning. The explicit ignore avoids inspecting the protected backup.
- Final `pnpm -r test`: **Shared 43 files / 378 tests; Core 299 / 1928; CLI 8 / 47; Desktop 103 / 548**, all passed.
  The initial run alongside typecheck/lint hit a Windows `lstat UNKNOWN` on installed `zod/v4/locales/no.js` and the
  existing MCP npx-fixture's 30-second timeout. Both passed a focused rerun
  (`pnpm --filter @taki/core exec vitest run src/skills/skill-package-source.test.ts src/mcp/mcp-connect.test.ts --maxWorkers 1`,
  **2 files / 17 tests**), then the unchanged full suite passed without competing gate jobs. No MCP/Skills/dependency
  code was changed; the original environmental cause was not independently established.
- `python -X utf8 ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-replica-sync-recovery` and
  `git diff --check` passed. A direct audit of **29 owned/carried-forward files**, including untracked source/tests,
  passed UTF-8/no-BOM/trailing-whitespace, production INPUT/OUTPUT/POS, source-index, and file-size checks. New production
  modules stay below 300 lines; the shared public entry is 326 lines, within the 360-line review tolerance.
- A hidden isolated Core boot ran `node packages/core/src/main.ts` under **Node 24.18.0** with a fresh temporary
  `TAKI_DATA_DIR`, an explicit minimal environment, a dummy loopback model endpoint/key, and no `.env` file or credential
  source. It applied **migrations 1..34**, reached `ws server listening` on port **1941**, accepted a TCP readiness probe,
  and made **zero dummy-provider requests**. Read-only inspection after process exit confirmed versions 1..34, both
  new tables, and unchanged `legacy-markdown` authority. The owned Core process, dummy provider, log, and temp data were
  removed. An earlier identical startup on port 4888 also passed; its inspection connection initially delayed cleanup,
  which was completed after that process exited. The final smoke used an explicitly closed inspection handle and
  completed with exit code 0.

**Incomplete / unverified / extra:**

- Wave 3 Pending Memory outbox, unconfirmed overlay, replay/supersession, derived-completion recovery, and second pull
  remain incomplete. B5 as a whole remains in progress; no manual acceptance criterion is marked passed.
- Independent review was pending at the worker handoff; the completed review is recorded below. B4 current-Local
  coverage/final fence, actual trusted policy/provenance bindings,
  live Hindsight/LLM behavior, B6 runtime provider/recall/tool integration, and owner-approved live activation remain
  unverified and gated. Rust/clippy and real-process Host E2E were not run because this slice changes no Rust/Host
  consumer or runtime provider wiring; all downstream TS typechecks/tests passed.
- Extra production scope: none. Source folder indexes and narrow migration-count expectations are supporting changes.
  No parent/B4/B6 planning document, general handoff, broad spec, T4 implementation, protected backup, existing user
  database, credential file, model asset, reference repository, or other worktree was modified. No commit, staging,
  push, merge, reset, rebase, task finish/archive, real provider call, or Authority activation was performed.

### Independent Wave 2 review (2026-09-06)

**Verdict: pass with fixes for the approved offline Wave 2 scope.** Reviewer:
`/root/hindsight_b5_wave2_check`; session (`CODEX_THREAD_ID`):
`01a07675-61a8-7080-b526-29de4524c4f0`. The reviewer verified `H:/TakiAgent`, branch `main`, and HEAD `3c67fd5`,
loaded the explicit B5 task and all curated check context, and preserved the existing dirty Wave 0/1 foundation.
The child had no Trellis session binding; no binding or task status was changed. No subordinate agent was spawned.

**Findings fixed:**

1. `hindsight-replica-scheduler.ts`: a database/claim failure could leave an overdue schedule and immediately rearm a
   zero-delay wake, including in manual mode. Per-Bank supervisor pauses now use the existing one-minute first retry
   delay for automatic mode; manual mode retains its queued request but requires a new explicit action in that process.
   Healthy Banks continue independently. The closed `lastError()` diagnostic remains readable; a failure before claim
   does not fabricate a persisted attempt. This pause is process-local because the failure may prevent database writes;
   ordinary run retry/backoff remains durable.
2. `hindsight-replica-snapshot-cache.ts`: the cache digest covered only the normalized record. Corrupting `page_hash`,
   `provider_lineage_id`, or `bank_generation` could associate old payloads with another verified manifest and publish
   stale content. The integrity digest now binds Bank, lineage, generation, page hash, and normalized record together.
   Invalid or old-format evidence becomes a cache miss and requires an authenticated page read.
3. `hindsight-replica-record-store.ts`: FTS accepts NULL, integer, and blob IDs, but orphan cleanup converted them to
   strings and consequently deleted nothing. Reconciliation now validates and deletes those rows by SQLite rowid.
   Existing valid Memory rows and same-ID documents remain independent.
4. `hindsight-incremental-sync.ts`, `hindsight-replica-sync-runner.ts`, and `hindsight-replica-sync-repo.ts`: a journal
   response arriving after the captured run deadline could commit before the runner noticed expiry. The internal
   `deadlineAt` now reaches journal publication, where the injected database clock checks it before writes and again
   before checkpoint publication. Late pages cannot alter canonical rows, FTS, cache, or checkpoint; previously accepted
   pages remain committed if a later page or reset fails.
5. `hindsight-replica-sync-runner.ts` and `hindsight-replica-sync-repo.ts`: initial admission compared Bank scope, but a
   trusted projection changing during HTTP work could still publish a Character binding into a Global Bank. The
   validated admitted Bank is captured and passed as internal `expectedBank` to snapshot/journal publication. Any
   projected Bank scope or Character mismatch fails before writing. These optional internal inputs preserve Wave 1
   direct callers; no Shared wire schema or migration version changed during review.

Eleven RED assertions reproduced these five defects before repair. Additional regressions cover malformed canonical
JSON/hash/revision/operation fields, duplicate logical identities and a missing Bank row, unchanged page reuse after
reorder/reopen, actual-client stop/timeout with ignored abort and late response, partial-journal reset success/failure,
and disabling/reconfiguring scheduling while a full run settles. The version-033 upgrade fixture now contains a valid
checkpoint and a Core-issued UUID lease, verifies their continued usability after 034 and no-op reopen, and checks
unchanged authority. Source headers/indexes were synchronized. The new FTS rowid binding initially failed TypeScript's
optional SQL-value check; explicit integer validation fixed it before the final gate.

**Verification executed independently:**

- Focused Core command:
  `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-replica-sync-runner.test.ts src/memory/hindsight/hindsight-replica-scheduler.test.ts src/db/hindsight-replica-scheduler-repo.test.ts src/db/hindsight-replica-sync-repo.test.ts src/db/migrations/index-list.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/scheduled-task-repo.test.ts src/memory/hindsight/hindsight-client.test.ts src/memory/hindsight/hindsight-client-transport.test.ts`:
  **9 files / 106 tests passed**.
- Focused Shared command:
  `pnpm --filter @taki/shared exec vitest run src/memory-replica-schedule-schema.test.ts src/memory-replica-schema.test.ts src/hindsight-journal-schema.test.ts src/memory-provider-operation-schema.test.ts`:
  **4 files / 25 tests passed**.
- Final `pnpm -r typecheck`: **Shared, Core, CLI, Desktop, and E2E passed**.
- `pnpm lint --ignore-pattern '.backup-memory-legacy-migration-live-20260821-01/**'`: **passed**, zero errors and only
  the unchanged `run-repo.ts:6` unused-disable warning.
- Final `pnpm -r test`: **Shared 43 files / 378 tests; Core 299 / 1950; CLI 8 / 47; Desktop 103 / 548**, all passed.
  Gates ran sequentially. The first full run failed only the existing `mcp-generations.test.ts:238` late-client shutdown
  assertion (`closedCount` was 0 rather than 1). The unchanged focused command
  `pnpm --filter @taki/core exec vitest run src/mcp/mcp-generations.test.ts --maxWorkers 1` passed **1 file / 23 tests**,
  followed by the unchanged full-suite pass. The original timing cause remains unconfirmed; no MCP code, dependency,
  or timeout was changed.
- `python -X utf8 ./.trellis/scripts/task.py validate .trellis/tasks/08-09-memory-replica-sync-recovery`: **passed** with
  **10 implement / 9 check entries**. `git diff --check` used explicit exclusions for the protected backup, other
  worktrees, models, and references. Direct byte/content audit passed **56 task/carried-forward files**, including
  **32 untracked files** and **28 production modules**, for UTF-8/no-BOM, whitespace, INPUT/OUTPUT/POS headers, source
  indexes, and size. New production modules remain below 300 lines; carried-forward `governed-tool.ts` (322) and the
  Shared public entry (326) remain within the 360-line tolerance.
- Isolated startup ran `node packages/core/src/main.ts` under **Node 24.18.0** in a hidden process, with a unique fresh
  temporary `TAKI_DATA_DIR`, an explicit minimal environment, an isolated profile/temp directory, and a dummy loopback
  provider. It read no `.env` or real credential source. Core applied **migrations 1..34**, reached
  `ws server listening` on **port 12912**, and accepted a TCP readiness probe. Explicitly closed read-only SQLite
  inspection verified both 034 tables and unchanged **`legacy-markdown`** authority. Dummy-provider request count was
  **zero**. Core was explicitly terminated after readiness (Windows process return code 1); this is startup evidence,
  not graceful signal-shutdown acceptance. The smoke harness exited 0 after removing its process, provider, log, and
  temporary directory and confirming complete cleanup.

**Unresolved / incomplete / unverified / extra scope:**

- No reproduced blocker remains within offline Wave 2. B5 remains **in progress** and no manual acceptance criterion
  was marked passed. Wave 3 Pending Memory outbox, overlay, replay/supersession, derived completion, and second pull
  remain incomplete. B4 current-Local coverage/final fence and trusted live policy/provenance bindings, B6 runtime
  provider/recall/tool integration, real Hindsight/LLM behavior, and owner-approved activation remain gated.
- Existing provider limits remain: one-record snapshot pages support selective reuse only after exact page evidence is
  cached; cold, corrupt, or newly journal-updated records require a new snapshot-byte witness. No fetch-by-ID endpoint
  was invented. The 512 KiB HTTP limit, 10,000-record complete journal limit, 60-second runner/execution defaults, and
  61-second lease default remain in force. Large records/manifests or exhausted budgets fail closed.
- Rust `cargo clippy`/`cargo test`, Rust/Desktop release builds, and real-process Host/live-provider E2E were **not run**.
  This slice changes no Rust/Host consumer, OS capability, UI, or installed runtime provider wiring. The evidence is the
  full TS matrix, all downstream typechecks, and actual isolated Core startup; these do not claim those other gates.
- Extra production scope: **none**. Broad executable-spec and parent-HANDOFF synthesis remain Leader-owned; the five
  fixes and internal API details were sent to the Leader for that update. No staging, commit, push, merge, reset,
  rebase, finish/archive, Hindsight repository change, real provider call, existing-user-data migration, authority
  activation, protected-backup access, credential/model/reference access, or other-worktree change occurred.
