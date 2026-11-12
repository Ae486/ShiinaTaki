# Database Guidelines

## Engine and access

- SQLite via **`node:sqlite`** (Node 24 built-in), wrapped in `packages/core/src/db/`. The wrapper is the only module importing `node:sqlite` — keeps a `better-sqlite3` swap trivial if stability disappoints.
- **Single writer**: only the Agent Core opens the database. Shell, Pet UI, and future mobile nodes query/subscribe over the WS API (ADR 0004). Never open the DB file from Rust or the UI.
- DB file lives in the app data root (`%USERPROFILE%\.takiagent\`, beside the Workspace, not inside it), never in the repo or install dir.

## Schema conventions

- Tables and columns: `snake_case`. Timestamps: `*_at`, ISO-8601 UTC strings.
- Migrations: numbered TS modules `db/migrations/NNN-description.ts`, exporting `{ version, sql }` with optional declarative `ensureNullableTextColumns: [{table, column}]` or exact `schemaBranches`. Constant SQL and guarded DDL keep the layer fs-free and bundle-safe. One explicit ordered registry applies each migration inside a transaction and records it in `migrations`. No ORM — hand-written SQL in repositories, one repo per aggregate.
- Memory search: SQLite **FTS5** virtual table indexing Workspace markdown files; markdown is the source of truth, the index is rebuildable.

## Patterns

- Repos expose typed functions; zod-parse rows at boundaries where shape matters. Bound or reject every externally
  supplied diagnostic field before a write, so a post-commit row parse cannot fail after durable state has changed.
- Every externally-relevant write emits a WS event after commit (this is how desktop→phone real-time works). Write + event emission live together in the repo/service layer.
- No transactions across async gaps; keep them synchronous and short.

## Scenario: Parallel Branch Migration Convergence

See [SQLite Migration Lineage and Convergence](./sqlite-migration-lineage.md) before assigning or merging
migration versions, adding conditional schema branches, or supporting databases with an older meaning of an
already-recorded version. Applied receipts remain immutable; convergence requires a higher guarded migration.

## Transaction Failure Isolation

See [SQLite Transaction Failure Isolation](./sqlite-transaction-isolation.md) before changing the wrapper or relying
on nested savepoints/deferred constraints. It defines COMMIT-failure rollback, logical-depth restoration and the
SQL-entry guards that prevent auto-commit escape after SQLite aborts an enclosing transaction.

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
- Register publication with `db.afterCommit` so a surrounding transaction cannot leak events after a savepoint
  RELEASE and before the outer COMMIT. Live delivery is best effort; bounded asynchronous queues expose overflow/lag state and
  consumers recover gaps from the durable cursor. Observer errors never change Run correctness.
- Idempotent admission reuses the existing Run/Attempt and returns its unchanged event tail; it does not append a second
  admission fact.
- The ledger is per-Run. Character-lineage aggregation needs a separate multi-Run cursor/order/authorization contract;
  do not merge independent Run sequence spaces as a shortcut.
- Event rows are append-only at the database boundary: normal lifecycle code never updates/deletes them, and migration
  triggers reject such mutations. Opaque IDs, hashes, generations, and revisions remain internal correlation and query
  inputs; no ordinary, expanded, Inspector, tooltip, copy, or accessibility surface displays them. Monitor's compatibility
  `technical` array stays empty, and semantic Inspector sections follow the observability projection whitelist.

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
- Projection tests asserting readable summaries and semantic Inspector sections, empty technical metadata, and no
  exposed opaque identities in user-facing details or accessibility content.

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
  db.afterCommit(() => liveBus.publish(committed));
});
```

### Linked private delegation records

`subagent_conversations`, `subagent_inputs`, `run_messages` and `subagent_executions` hold private Runtime evidence,
not relationship Timeline or semantic Memory. Install the configured `RunLinkedState` before linked admission and
recovery. Its admission and canonical terminal participants are required synchronous writes; failure rolls back
Run/Attempt/Receipt/events and linked result/pointer changes together. Start/dispatch refusal, explicit settlement
and direct recovery settlement must all use the final cancellation/deadline-adjusted terminal outcome.

Exact `workInputId`/`workSeq` controls input eligibility; child-global sequence is display order. Independent queued
work cannot supersede another work's completion. Capture the work expiry once at input acceptance and preserve it
through messages, continuation, retries and linked Run deadlines. First Effect receipts remain immutable, while
every actual later model intent retains its own receipt and replay deduplicates the logical input.

Persist child proposals against the exact active Attempt and work-token digest. A newer active identity may replace
the proposal slot; same-identity edits and stale callbacks refuse. Canonical terminal results remain immutable.
Discard stale proposal body/source instead of relabelling it as covering newer input. Missing current output still
produces an explicit terminal status and does not suppress the captured completion policy. Real work-watermark
supersession is separate from proposal availability. Private transcript/result writes never grant Memory or reply
authority; the shared execution and publication owners enforce those contracts.

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

## Scenario: Run Recovery, Durable Queue, and Shutdown Admission

### 1. Scope / Trigger

- Trigger: Core restarts or shuts down while Runs, Attempts, or Effects are queued, waiting, executing, or unsettled.
- The mutable Run/Attempt state remains the recovery program counter; `run_effects` remains the uncertain-effect
  authority; RunEvents record bounded recovery evidence. A process-local queue or AbortController is never durable truth.

### 2. Signatures

- `RecoveryCoordinator.scan()` performs a bounded boot classification before WS admission opens.
- `RunService.queue({ characterId?, state?, cursor?, limit?, now? })` lists durable queued/nonterminal work; `runId` is
  the resume/cancel key and no mandatory `queueId` is introduced.
- `RunService.seal()` rejects new admissions; shutdown requests durable cancellation, aborts active turns, waits for the
  bounded TurnRegistry drain, then closes WS/MCP/SQLite.
- Recovery adapter results are closed (`completed | failed | unknown | unavailable`) and cannot mutate Run truth directly.

### 3. Contracts

- Boot assigns a process-generation marker and scans nonterminal Runs before new trigger dispatch. Repeating the scan is
  idempotent and refreshes the marker without duplicating classification events.
- Safe replay requires both the stored Effect posture and the current provider/authority contract to be `safe`, with the
  same captured generation/idempotency evidence. Missing adapters or uncertain authority fail closed as
  `reconciliation_required`/`outcome_unknown`; unsafe effects are never silently replayed.
- Absolute deadline and durable budget counters are checked at admission, Attempt start, Effect intent, and settlement.
  Budget reservation is atomic with the target intent; no fabricated or negative usage is accepted.
- Recovery classification, state mutation, and RunEvent append use one short synchronous SQLite transaction. External
  probes never run inside that transaction; live publication occurs only after commit and observer errors are isolated.
- Shutdown seals admission before cancelling durable queued/nonterminal work. It does not fabricate success for active
  effects; unresolved external work retains its unknown/reconciliation semantics.
- Canonical queue/recovery payloads contain bounded IDs, states, timestamps, counts, and closed reason codes only. Raw
  prompts, credentials, tool/Host/MCP/Memory bodies, cwd/env, provider exceptions, and media remain excluded.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Expired deadline or exhausted budget before dispatch | Settle bounded `deadline_exceeded`/`budget_exceeded`; do not invoke an effect. |
| Queued Run cancelled before start | Durable cancellation wins after restart; no model/tool/Host/MCP call starts. |
| Unfinished unsafe Effect or missing recovery adapter | Do not replay; classify reconciliation-required or unknown. |
| Terminal Effect with nonterminal Run | Repair/continue through Run CAS; never invoke the same Effect again. |
| Duplicate/stale/wrong-generation recovery callback | No-op for current truth; retain only bounded diagnostic classification. |
| Observer/live publication throws | Preserve committed recovery state and events. |
| Shutdown arrives during active work | Seal admission, request cancellation, abort active turns, bounded-drain, then close transports/db. |

### 5. Good/Base/Bad Cases

- Good: boot classifies an unfinished Effect, commits one recovery event, applies an explicit safe replay or unknown
  outcome, and a second boot produces no duplicate terminal evidence.
- Base: a queued chat Run remains inspectable and cancellable after restart, but is not replayed without a bounded payload
  reference; raw prompt text is not copied into canonical Run state.
- Bad: infer recovery from Pino logs, fold the entire Run Event ledger as a second state machine, replay a Host write
  because its generation changed, or close SQLite immediately after sealing without cancelling/draining active work.

### 6. Tests Required

- Fresh/historical/reopen migration lineage including the recovery migration and strict budget constraints.
- Restart fixtures for queued/prepared, approval waiting, model/tool/Host/MCP/Memory intent, safe replay, unsafe unknown,
  terminal Effect/Run repair, cancellation, deadline/budget expiry, repeated scan, and shutdown drain.
- Queue cursor look-ahead, durable cancellation, stale/duplicate callbacks, observer isolation, redaction, and no-dispatch
  assertions.
- Shared/Core typecheck, full tests, root lint, relevant process/E2E boot acceptance, task validation, and `git diff --check`.

### 7. Wrong vs Correct

```ts
// Wrong: process-local state decides whether a queued Run exists after restart.
if (!turnQueue.isBusy(characterId)) startModelCall();

// Correct: durable Run state and deadline/budget guard decide; the local queue only serializes execution.
const page = runs.queue({ characterId, limit: 1 });
if (page.entries[0]?.runId && runs.guardDispatch(page.entries[0].runId, attemptId)) {
  // commit/dispatch through the existing Run/Effect boundary
}
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

## Canonical Memory Replica Synchronization

See [Current Local Cutover Coverage](./memory-local-cutover-coverage.md) for B4 current-state manifests, additive
037/038 evidence tables, writer reservations, typed field bindings, and readiness refusals independent of B2 counts.
See [Current-State Transfer and First Activation](./memory-current-state-cutover.md) for migration 039, complete typed
captures/imports, native maintenance evidence, retained snapshot/raw checkpoint publication and durable known-drift refusal.

See [Memory Replica Sync](./memory-replica-sync.md) for the B5 journal, response bounds, canonical projection,
lease/transaction/checkpoint, captured Authority/Bank publication guards, and restart-read contracts. It also defines
migration 035 Pending Memory identity/CAS, native/derived/local-completion phases, separate unconfirmed overlays,
same-lease reset continuation, and the explicit provider evidence required before recovery can be called complete.
G1 adds an explicit tracked dispatch and compact verified factual-result receipt to existing JSON state; migration 035
and old intent/receipt bytes remain unchanged. Only the original identity and an actual transactionally matching
checkpoint may confirm a new tracked write. Legacy derived-wait rows are not promoted automatically.
See [G1 Native Result Recovery](./memory-native-result-recovery.md) for the current tracked protocol.
