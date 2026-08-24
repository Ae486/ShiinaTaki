# Database Guidelines

## Engine and access

- SQLite via **`node:sqlite`** (Node 24 built-in), wrapped in `packages/core/src/db/`. The wrapper is the only module importing `node:sqlite` — keeps a `better-sqlite3` swap trivial if stability disappoints.
- **Single writer**: only the Agent Core opens the database. Shell, Pet UI, and future mobile nodes query/subscribe over the WS API (ADR 0004). Never open the DB file from Rust or the UI.
- DB file lives in the app data root (`%USERPROFILE%\.takiagent\`, beside the Workspace, not inside it), never in the repo or install dir.

## Schema conventions

- Tables and columns: `snake_case`. Timestamps: `*_at`, ISO-8601 UTC strings.
- Migrations: numbered TS modules `db/migrations/NNN-description.ts`, each exporting `{ version, sql }` (plain SQL string constants — keeps the db layer fs-free and bundle-safe), aggregated in one explicit ordered list (no fs/glob discovery), applied at startup each inside a transaction, tracked in a `migrations` table. No ORM — hand-written SQL in repository modules (`db/timeline-repo.ts`, `db/memory-repo.ts`), one repo per aggregate.
- Memory search: SQLite **FTS5** virtual table indexing Workspace markdown files; markdown is the source of truth, the index is rebuildable.

## Patterns

- Repos expose typed functions; zod-parse rows at boundaries where shape matters. Bound or reject every externally
  supplied diagnostic field before a write, so a post-commit row parse cannot fail after durable state has changed.
- Every externally-relevant write emits a WS event after commit (this is how desktop→phone real-time works). Write + event emission live together in the repo/service layer.
- No transactions across async gaps; keep them synchronous and short.

## Scenario: Parallel Branch Migration Convergence

### 1. Scope / Trigger

- Trigger: two long-lived branches add SQLite migrations after the same shared base, or a merge discovers that one
  numeric version represented different schemas in databases already exercised by either branch.
- Treat an applied migration number as immutable history. Renaming files in Git does not rename versions already
  recorded in a user's `migrations` table.

### 2. Signatures

- Migration module: `db/migrations/NNN-description.ts` exporting `{ version: NNN, sql: string }`.
- Registry: `MIGRATIONS` in `db/migrations/index-list.ts`, strictly ascending and containing one entry per version.
- Compatibility bridge: a new higher-numbered migration whose idempotent SQL guarantees the union of both historical
  schemas without deleting or rewriting either lineage.

### 3. Contracts

- Before assigning a migration version, compare the target branch registry and every branch expected to merge before
  release. Never reserve a number only in a local task document.
- If conflicting versions have reached a real database, choose one canonical forward numbering for new installs and
  append a convergence migration after both histories. Use additive `IF NOT EXISTS` DDL where the bridge must tolerate
  either schema already being present.
- The migration runner remains max-version based. Therefore the convergence sequence must explicitly create anything
  skipped by the historical max; it cannot rely on replaying a lower version.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Conflict found before either migration ran anywhere | Renumber one branch before merge and update tests/registry. |
| Both meanings of a version reached developer or user databases | Preserve recorded history and add a higher convergence migration. |
| Bridge DDL fails when one lineage already owns a table/index | Make the bridge idempotent; do not drop or replace the existing object. |
| Registry contains duplicate or non-ascending versions | Fail review; migration order is not merge-ready. |
| Old-lineage reopen lacks any schema from the merged product | Fail the migration gate and add/repair the convergence bridge. |

### 5. Good/Base/Bad Cases

- Good: simulate each historical lineage in a temporary file, reopen with the merged registry, and prove every required
  table plus the final migration version exists.
- Base: a fresh database applies the canonical ordered registry once and a second open applies nothing.
- Bad: mechanically rename `017-feature-a.ts` to `018-feature-a.ts` after a database recorded version 17, or resolve the
  registry conflict with whole-file ours/theirs selection.

### 6. Tests Required

- Focused tests for every renumbered migration and the convergence migration.
- Temporary-file reopen tests for lineage A, lineage B, and a fresh install; assert final versions and required tables.
- Full Core tests plus a real Core boot against an isolated data directory after synchronization.
- `git diff --check` and a registry review proving unique, ascending versions and matching module names/exports.

### 7. Wrong vs Correct

```ts
// Wrong: version 17 now means a different schema to databases that already recorded it.
export const skillMigration = { version: 17, sql: "CREATE TABLE skill_packages (...)" };

// Correct: preserve the canonical sequence and append an idempotent bridge for historical databases.
export const skillMigration = { version: 19, sql: "CREATE TABLE IF NOT EXISTS skill_packages (...)" };
export const convergenceMigration = { version: 20, sql: canonicalMemoryMigration.sql };
```

## Scenario: Run Event Ledger and Post-Commit Live Plane

### 1. Scope / Trigger

- Trigger: a Core Run lifecycle transition needs durable execution evidence, deterministic replay, or live observers.
- The mutable `runs`/`run_attempts` state remains the recovery authority. The append-only `run_events` ledger is
  immutable evidence for receipts, trajectory, diagnostics, metrics, and projection rebuilds.

### 2. Signatures

- Event identity/order: `RunEvent { eventId, runId, attemptId?, seq, schemaVersion, category, kind, occurredAt,
  source, correlation?, payload }`.
- Repository: append/read/tail operations are typed and Zod-validated; `seq` is contiguous and unique per `runId`.
- Live: `publish(committedEvents)` happens after the transaction; subscriptions use a per-Run `(runId, seq)` cursor.

### 3. Contracts

- Lifecycle state mutation, Attempt/Receipt mutation, and corresponding RunEvent append occur in one short synchronous
  `db.transaction` callback. Event validation or insert failure rolls back the state transition.
- Publish only after commit. Live delivery is best effort; bounded asynchronous queues expose overflow/lag state and
  consumers recover gaps from the durable cursor. Observer errors never change Run correctness.
- Idempotent admission reuses the existing Run/Attempt and returns its unchanged event tail; it does not append a second
  admission fact.
- The ledger is per-Run. Character-lineage aggregation needs a separate multi-Run cursor/order/authorization contract;
  do not merge independent Run sequence spaces as a shortcut.
- Event rows are append-only at the database boundary: normal lifecycle code never updates/deletes them, and migration
  triggers reject such mutations. Projection rows may hide opaque IDs, hashes, generations, and revisions from ordinary
  presentation while retaining them for explicit developer inspection.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Event payload kind/category/version mismatch, secret-bearing text, or bound violation | Reject before durable insert; surrounding state transaction rolls back. |
| `(runId, seq)` gap, duplicate, or malformed stored row | Fail closed; never silently rebuild from an ambiguous tail. |
| Event row UPDATE/DELETE attempted | Reject with immutable-ledger error. |
| Observer throws, is slow, disconnects, or queue overflows | Preserve committed Run; mark observer failure/overflow; backfill from durable cursor. |
| Character-lineage live aggregation requested without a defined global cursor | Keep the per-Run contract; defer aggregation to a dedicated projection/query task. |

### 5. Good/Base/Bad Cases

- Good: `RunRepo` commits state plus ordered events, then publishes the committed batch; a reconnect reads the durable
  suffix after its last cursor before accepting live events.
- Base: developer detail tracing is disabled, but the canonical lifecycle ledger and receipts remain available.
- Bad: publish inside the SQLite transaction, let a UI observer write Run state, or infer Run recovery by folding the
  event ledger instead of reading the mutable program counter.

### 6. Tests Required

- Migration fresh/historical/reopen lineage and immutable trigger tests.
- Transition atomicity and event-write rollback tests for admission/start/retry/cancel/settle.
- Idempotent admission tail, sequence contiguity, cursor/backfill, observer isolation, bounded overflow, and restart
  replay tests.
- Projection tests asserting readable ordinary summaries and inspector-only technical metadata.

### 7. Wrong vs Correct

```ts
// Wrong: state commits, then a failed event write or pre-commit observer leaves an unverifiable transition.
db.prepare("UPDATE runs SET state = 'running'").run();
liveBus.publish(event);
eventRepo.append(event);

// Correct: append evidence in the same synchronous transaction, publish only after commit.
let committed: RunEvent[] = [];
db.transaction(() => {
  updateRunState(db);
  committed = eventRepo.appendMany(events);
});
liveBus.publish(committed);
```

## Scenario: Run-Owned Effect Intent, Settlement, and Usage

### 1. Scope / Trigger

- Trigger: a Run starts an external, uncertain, or separately accountable model/tool/Host/MCP/Approval/Memory action.
- The Effect row is the mutable execution authority for one action under a specific Run Attempt. RunEvents are immutable
  evidence, and `run_usage` is the authoritative model-usage ledger. Timeline content remains a separate conversational
  transaction and must not be described as atomically committed with Effect settlement.

### 2. Signatures

- Shared contract: `EffectRecord { effectId, runId, attemptId, effectKind, state, sourceRef, executorRef?,
  capturedGenerationRef?, inputDigest?, replayPosture, resultRef?, usageRef?, outcome?, version, ... }`.
- Repository boundary: `EffectRepo.commitIntent(input)` and `EffectRepo.settle(input)` own the short synchronous SQLite
  transaction; `EffectLifecycleService` is the Core adapter-facing boundary.
- Model boundary: AI SDK 7 `wrapLanguageModel` middleware wraps each real internal `doStream` / `doGenerate` request,
  not merely the outer `ToolLoopAgent.stream()` call.
- Durable storage: `run_effects` owns current Effect state and `run_usage` owns one accepted usage result linked to the
  settled model Effect. Canonical events are `effect.intent_committed`, `effect.waiting`, `effect.settled`, and
  `usage.settled`.
- An `effect.waiting` row is reserved for a real Approval prompt and therefore requires a canonical `approvalId`; already
  resolved session/always authority proceeds directly to target intent without an untraceable wait row.

### 3. Contracts

- Commit intent and reserve identity before dispatch. If intent persistence fails, the provider/tool/Host/MCP/Memory
  action must not start.
- Settle with `(runId, attemptId, effectId, expectedVersion)` ownership/CAS. Exact terminal duplicates are no-ops;
  unknown IDs, wrong Attempts, inactive/terminal Attempts, and late callbacks are stale and cannot change current truth.
- Approval waiting, waiting settlement, and waiting-to-intent promotion must apply the same active-Attempt check and
  advance `run_attempts.state_version` in the surrounding SQLite transaction; an inactive race rolls back the Effect
  write and emits no event.
- Every terminal model Effect writes exactly one usage row and `usage.settled` event with quality
  `reported | estimated | unknown`. Missing counts are never represented as zero. Abort, interrupted close, provider
  ambiguity, no finish, and finish-without-usage settle truthfully, using `outcome_unknown` where acceptance is uncertain.
- Effect state, accepted usage, Attempt version, and canonical Effect/Usage events commit in one synchronous transaction;
  live publication occurs only after commit and observer failure cannot roll back or relabel durable truth.
- Persist bounded typed references, closed error codes, canonical cryptographic digests, and sanitized summaries only.
  Raw prompts, completions, effective tool arguments, provider errors, credentials, environment values, and sensor/media
  payloads never enter Effect rows, usage rows, events, or ordinary projections.
- Retry identity is mutable execution context: when context overflow creates a replacement Attempt, the exact
  `TurnContext` passed to the model middleware must receive the replacement `attemptId` before the next provider request.
- Memory writes have an asymmetric uncertainty rule: if the provider may have applied `retain` or a mutation but its
  post-dispatch acknowledgement, capability snapshot, or authority evidence cannot be validated, settle the Core
  Memory Effect as `MEMORY_OUTCOME_UNKNOWN`; do not relabel it as an ordinary failure or silently replay it. The
  canonical Memory receipt remains its own authority and transaction boundary for later reconciliation.
- Run-owned Effect context (`runId`, `attemptId`, `effectId`, and lifecycle service) is independent from optional
  interactive Approval context. Non-primary/background turns may record governed Effects without an operator socket;
  an Approval-required action still fails closed when no interactive authority exists.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Intent transaction rejects or rolls back | Do not invoke the external action; expose the bounded failure. |
| Exact terminal callback repeats | Return the committed terminal truth; append no duplicate settlement or usage event. |
| Unknown Effect, wrong Run/Attempt, stale version, or inactive Attempt callback | Classify as stale; do not mutate Effect, Attempt, usage, or events. |
| Provider fails before a response is accepted | Settle failed or unknown according to evidence and persist `unknown` usage if counts are unavailable. |
| Stream closes without finish, or finish has no usage | Settle `outcome_unknown` and persist one `unknown` usage row/event. |
| Abort or transport failure leaves acceptance ambiguous | Settle `outcome_unknown`; never relabel as clean failure or replay automatically. |
| Live observer throws after commit | Preserve the durable terminal Effect and usage; observer failure is diagnostic only. |
| Summary/reference contains raw content, secrets, or an invalid generation/type | Reject before write; the surrounding transaction rolls back. |

### 5. Good/Base/Bad Cases

- Good: middleware commits one model intent, dispatches the provider, then atomically settles Effect + usage + events;
  a tool-loop second provider request receives a second Effect under the active Attempt.
- Base: the provider supplies no token counts; the Effect still reaches a terminal truth with an explicit `unknown`
  usage row and no fabricated zero.
- Bad: start the provider before intent commit, mark any finish marker as settled without examining usage, reuse the
  failed overflow Attempt ID, publish events inside the transaction, or persist a raw prompt/provider error.

### 6. Tests Required

- Migration fresh/historical/reopen/no-op lineage for `run_effects` and `run_usage`.
- Intent-before-dispatch and failed-intent/no-provider-call tests at the installed middleware seam.
- CAS, exact duplicate, stale/wrong-attempt, inactive Attempt, event ordering, redaction, and post-commit observer
  isolation tests at `EffectRepo`.
- Model success, provider failure, abort, no-finish, finish-without-usage, reported/estimated/unknown usage, and
  canonical digest collision-resistance tests.
- Real overflow retry regression proving ordinal-1 failure, ordinal-2 completion, distinct Attempt IDs, and replacement
  Attempt binding for subsequent provider Effects.
- Full Shared/Core tests and typechecks, lint, E2E typecheck, migration/task validation, `git diff --check`, and a real
  isolated Core boot whenever startup wiring changes.

### 7. Wrong vs Correct

```ts
// Wrong: dispatch first, treat any finish as complete, and keep the original Attempt after retry.
const stream = await model.doStream(request);
settled = part.type === "finish";
turn.onRetry?.("context_overflow");

// Correct: commit identity first, settle from evidence, and mutate the shared retry context.
const effect = effects.commitIntent(intent);
const stream = await model.doStream(request);
effects.settle({ effectId: effect.effectId, expectedVersion: effect.version, outcome, usage });
turn.attemptId = replacementAttemptId;
```

## Scenario: Legacy Memory Migration and Authority Cutover

### 1. Scope / Trigger

- Trigger: converting mutable legacy Markdown entries/Blocks into canonical Local SQLite records and changing the
  runtime authority marker. This is cross-layer storage/runtime work and must remain one-time, non-destructive, and
  resumable.
- The durable schema is migration `021-memory-legacy-migration.ts`; migration code is additive and never edits an
  applied migration. The migration runner is an operator/offline capability, not a normal memory adapter.

### 2. Signatures

- Migration export: `memoryLegacyMigration021: Migration = { version: 21, sql }`, registered in the ascending
  `MIGRATIONS` list.
- Runner boundary: `createLegacyMigrationRunner({ db, destinationRoot, fence, now?, onActivated? })` exposes
  `dryRun(root)`, `stage({ workspaceRoot, owner })`, `resume({ runId, owner })`, `status(runId)`,
  `verify(runId)`, `exceptions({ runId, cursor, limit })`, `exclude({ runId, sourceId, reason, actor })`, and
  `activate({ runId, workspaceRoot, timeoutMs })`.
- Operator methods: `memory.migration.dryRun|stage|resume|status|verify|exceptions|exclude|activate`; each has a
  strict shared Zod parameter/result schema and `roles: ["operator"]`.
- Durable tables: `memory_migration_runs`, `memory_migration_sources`, `memory_migration_attempts`,
  `memory_migration_results`, `memory_migration_exclusions`, `memory_migration_activation_receipts`, and the
  singleton `memory_authority_selection`.

### 3. Contracts

- Snapshot contract: stage publishes one complete immutable, hash-addressed snapshot and manifest before normalization;
  each source is represented once by `(relative_path, raw_sha256)`. Raw bytes stay in the snapshot, not SQLite. Dry-run
  may use a private temporary copy but returns with no durable snapshot, ledger, canonical, marker, or Markdown change.
- Ledger contract: every source records phase/disposition, attempt number, closed diagnostic code, exclusion decision,
  canonical source/document/operation IDs, explicit `result_count`, and ordered result IDs. `converted-zero`,
  `converted-one`, and `converted-many` are distinct resolved outcomes; zero never manufactures a Local unit.
- Import contract: the migration-only importer derives domain-separated deterministic IDs and payload hashes, replays an
  identical operation, and raises `IMPORT_CONFLICT` for a destination or payload-hash mismatch. It must not call public
  Local `retain`, generate random IDs, replace a conflicting document, or impersonate `user`/`background` writers.
- Authority contract: startup reads and validates `memory_authority_selection` before constructing legacy memory,
  reconcilers, sweepers, prompts, or tools. The marker starts as `legacy-markdown`; only a verified run may select
  `canonical-local` with an epoch, snapshot, transaction receipt, and lease fence. Canonical activation retires every
  mutable Markdown read/write surface; there is no post-activation fallback or dual-write.
- Activation transaction contract: snapshot hashing, fence drain, and readiness checks occur before one short synchronous
  SQLite transaction. That transaction performs no filesystem I/O and crosses no async gap; it rechecks lease fencing,
  manifest/readiness digests, epoch, and unresolved rows before updating the marker and receipt together.
- Operator loading contract: the method factory dynamically imports and constructs the migration runner per request;
  the runner is absent from ordinary startup/runtime memory graphs and is discarded after the operator operation.
- Privacy contract: status/log/error payloads contain counts, opaque IDs, phase/status, and closed diagnostic codes only.
  Snapshot-relative paths are returned only by the paginated operator exceptions method; memory/Block text, queries,
  secrets, raw exceptions, and full payloads never cross the operator or log boundary.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| UTF-8 BOM, invalid UTF-8, unsupported YAML/frontmatter, unsafe placement, ownership mismatch, or bound violation | Keep source bytes untouched; persist one closed diagnostic code; leave the run blocking until explicit source-scoped exclusion. |
| Snapshot path/hash/manifest changes after the fence or at activation | Fail with `SNAPSHOT_CHANGED`; do not mutate the authority marker. |
| Lease owner/fence expired or superseded | Fail with `LEASE_LOST`; stale worker cannot write ledger, canonical rows, or activation receipt. |
| Destination row or operation exists with a different content/payload hash | Fail with `IMPORT_CONFLICT`; do not replace/invalidate the existing canonical row. |
| Result count differs from durable result rows, missing FK/Bank/FTS/readiness, or unresolved non-excluded source | Verification is false with `INTEGRITY_MISMATCH`; legacy remains authoritative. |
| Fence drain exceeds `timeoutMs` or activation transaction rolls back | Return a structured failure; reopen/retain legacy authority and preserve snapshot/ledger for resume. |
| Authority marker missing, malformed, or internally inconsistent at startup | Fail closed with sanitized `MEMORY_INTEGRITY_ERROR`; never silently fall back to Markdown. |

### 5. Good/Base/Bad Cases

- Good: a staged run publishes the immutable snapshot, deterministically imports zero/one/many outcomes, verifies all
  rows and digests, then commits marker plus receipt in one transaction; restart selects canonical Local before any
  legacy object is constructed.
- Base: a dry-run reports bounded counts and exceptional source IDs while byte-comparing ledger, canonical tables,
  marker, and Markdown before/after with no durable artifact; an interrupted run resumes with identical IDs/results.
- Bad: call public `retain` during migration, use a random memory ID, copy raw Markdown into SQLite, run filesystem
  hashing inside the activation transaction, or leave a legacy reader/writer/fallback reachable after marker commit.

### 6. Tests Required

- Migration `021` reopen test: fresh and existing databases apply versions 1..21 in order and create every ledger,
  receipt, and marker table; a second open is a no-op.
- Snapshot/normalizer/identity tests: exact raw bytes/hash/path, supported flat-frontmatter variants, closed
  diagnostics, path ownership, sanitizer refusal, deterministic canonical JSON and IDs.
- Ledger/runner tests: lease fencing, retry attempts, durable exclusions, reopen/resume determinism, zero/one/many
  result rows, dry-run zero-write cleanup, bounded exception pagination, and changed-snapshot blocking.
- Importer/converter tests: exact replay, conflict refusal, archived/empty semantics, lifecycle/policy/provenance,
  Block registry scope/order, no generic-unit/FTS Block leakage, and no public-`retain` call.
- Activation/runtime tests: fence drain/timeout, digest/readiness/epoch checks, marker-plus-receipt atomicity,
  marker-first startup, canonical-only tools/prompts/maintenance, authority-aware wrappers, and no post-activation
  Markdown reads/writes or dual tool advertisement.
- Quality/privacy gates: Shared/Core tests and typechecks, lint, isolated Core boot, `git diff --check`, task validation,
  and UTF-8/no-BOM checks. Assert logs/status/errors contain no source content, queries, secrets, or raw exceptions.

### 7. Wrong vs Correct

#### Wrong

```ts
// Ordinary runtime semantics: random IDs, replacement behavior, and a mutable fallback after cutover.
await localRetain({ text: legacyText });
if (canonicalUnavailable) return legacyMarkdown.read();
```

#### Correct

```ts
// Migration-only deterministic import, then one fenced synchronous marker transaction.
importer.importRecord({ source, record, operationId, payloadHash });
await fence.quiesce({ timeoutMs }, () => activateCanonicalLocal(db, {
  lease, manifestDigest, readinessDigest, transactionId, now,
}));
// Startup/runtime selects canonical from the persisted marker; no Markdown fallback or dual-write exists.
```
