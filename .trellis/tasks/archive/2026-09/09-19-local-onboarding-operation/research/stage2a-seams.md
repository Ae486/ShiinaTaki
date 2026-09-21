# Research: Stage 2a producer and lifecycle seams

- Query: Make Local-only onboarding over B2 and the Stage 1 operation owner implementation-ready.
- Scope: internal; source, persisted contracts and existing tests, with no production/data mutations.
- Date: 2026-09-19.
- Source revision: HEAD 516e151, as supplied by the leader and reported by jbcontext.

Research read of every producer Stage 2a (explicit Local-only onboarding) wraps, in the format of
`.trellis/tasks/archive/2026-09/09-19-hindsight-durable-operations/research/stage1-seams.md`. Paths are
repository-relative. Line numbers were read directly on 2026-09-19; re-check before editing. Two throwaway Node probes
(temp dir + temp SQLite, no repository writes) were run against the real runner to confirm the empty-workspace and
legacy-workspace behaviour; their outputs are quoted where marked "probe".

STATUS: COMPLETE as a research/design input. Findings below identify production changes still required;
they are not implementation or acceptance evidence. The two probes above belong to the earlier inventory pass;
this continuation read source and tests and did not rerun them.

## 1. Workspace modes at boot

| Fact | Evidence |
| --- | --- |
| The only mode truth is the singleton `memory_authority_selection` row, `mode IN ('legacy-markdown','canonical-local','hindsight')`. | `packages/core/src/db/migrations/040-hindsight-cutover-schema.ts:62-74` (current shape); created by `021-memory-legacy-migration.ts:52-61`. |
| A fresh database is seeded `legacy-markdown` (`INSERT OR IGNORE ... 'legacy-markdown'`). There is NO filesystem probe: an empty `workspace/memory` and a populated one boot identically as Legacy. | `021-memory-legacy-migration.ts:59-61`; probe 1 printed `boot mode: legacy-markdown` for an empty workspace. |
| Reader: `readMemoryAuthoritySelection(db)` returns `{mode, epochId, snapshotId, transactionId, providerLineageId, replicaCheckpointDigest}`; missing/malformed row throws `MEMORY_INTEGRITY_ERROR` (fail closed, never Markdown fallback). | `packages/core/src/memory/legacy-migration/legacy-activation-repo.ts:17-27`. |
| Boot routing: `selectMemoryRuntime` reads the marker once; `legacy-markdown` -> `createLegacy()` (Markdown engine), `canonical-local` -> `createCanonical(epochId)`, `hindsight` -> `createHindsight`. `bindCanonical(epochId)` is the post-activation live rebind (retires Legacy first, then constructs Local). | `packages/core/src/memory/runtime-selector.ts:26-40`, `:51-65`. |
| Composition: `composeMemoryRuntime` wires the fence, `onLegacyRetired` (`fence.retire()`), and exposes `selected.canonical`, `fence`, `memoryRoot`, and `migrationRunner()` (lazy dynamic import of the B2 runner with `destinationRoot = <dataDir>/workspace/memory-migration` and `onActivated: selected.bindCanonical`). | `packages/core/src/memory/runtime-composition.ts:52-82`, `:84-115`. |
| `authorityMode()` used by B3 setup is just `readMemoryAuthoritySelection(db).mode`; B3 validate/setup refuse unless `'canonical-local'` (`HINDSIGHT_STATE_CONFLICT`). So Local onboarding is the prerequisite gate for every Hindsight journey. | `packages/core/src/boot/hindsight-setup-boot.ts:44`; `packages/core/src/memory/hindsight/hindsight-setup-service.ts:53`, `:260`. |
| Legacy runtime = `createMemorySubsystem` (`bootstrap.ts`): Markdown engine over `<dataDir>/workspace/memory` + Block store over `<dataDir>/workspace/blocks`, startup `engine.reconcile()` (files are truth), retention sweeper gated by `enabled: () => !isCanonical()`; engine wrapped in `fenceMemoryEngine(raw, fence)` so every admission goes through the fence. | `packages/core/src/memory/bootstrap.ts:66-72`, `:105-122`, `:129-131`, `:140-153`. |
| Legacy fence: `createMemoryAuthorityFence()` -> `admit/admitSync/retire/quiesce`. `quiesce` drains active admissions (timeout -> `MEMORY_QUIESCENCE_TIMEOUT`), runs the activation, and stays fenced only if `retired`. Admission after retire throws `MEMORY_AUTHORITY_FENCED`. | `packages/core/src/memory/legacy-migration/memory-authority-fence.ts:14-36`. |
| Workspace tools: after activation the Workspace file tools forbid `memory`, `blocks`, `memory-migration` prefixes; before activation only `memory-migration` is forbidden. | `packages/core/src/main.ts:301-306`. |
| `memory.status` (operator read) exposes only `windowSlots/summary/auto` — nothing about mode. | `packages/core/src/server/methods/memory-status.ts:24-34`. |
| `memory.authority.status` exposes `authority.mode/epochId/providerLineageId`, `runtime.providerId` (`legacy-markdown` \| `local` \| `hindsight`), `runtime.available` (always true for Legacy/Local — only the Hindsight branch probes), `setup`, `replica/pending` (null unless Hindsight live), `operations.active/recent`. It says nothing about whether legacy files exist or whether a B2 run is live/ready. | `packages/core/src/memory/operations/memory-authority-status.ts:24-43`; schema `packages/shared/src/memory-authority-status-schema.ts:21-52`. |
| "Immutable Legacy evidence" concretely = (a) the original `workspace/memory/**.md` and `workspace/blocks/**.md` trees, never rewritten; (b) the hash-addressed snapshot dir `workspace/memory-migration/sha256-<id>/{manifest.json,entries/...,blocks/...}`; (c) SQLite ledger tables `memory_migration_runs/_sources/_attempts/_results/_exclusions/_activation_receipts`. | `legacy-snapshot.ts:22-46`; `021-memory-legacy-migration.ts:11-67`; archived design section 3. |

What the inventory could NOT find: any Core code that classifies a workspace as "empty" versus "legacy" before the
operator asks. The only discriminator available today is `memory.migration.dryRun` (`sourceCount === 0` means nothing to
convert). See section 3.

## 2. B2 producer map

### 2.1 Registration

- Shared: `packages/shared/src/memory-migration-schema.ts:10` — `MEMORY_MIGRATION_METHODS = { dryRun, stage, resume, status, verify, exceptions, exclude, activate }` = `memory.migration.<name>`; params/results `:11-23` (all `.strict()`).
- Core methods: `packages/core/src/server/methods/memory-migration.ts`. Production uses `createAsyncOnDemandMemoryMigrationMethods(factory)` (`:36-47`), registered in `main.ts:464` with `memoryRuntime.migrationRunner` as the factory. Every method: `roles: ["operator"]`, handler = `safeAsync(() => resultSchema.parse(await operation(await factory(), params, ctx)))` (`:50-52`).
- Error mapping (`:62-73`): any throw becomes `appException("INTERNAL_ERROR", "memory migration failed", { reason })`, where `reason` is the thrown message if it is one of the 30 `LEGACY_DIAGNOSTIC_CODES` (`legacy-diagnostics.ts:6-14`), otherwise `"INTEGRITY_MISMATCH"`. Consequence: `MIGRATION_NOT_FOUND`, `MEMORY_QUIESCENCE_TIMEOUT`, `MEMORY_AUTHORITY_FENCED`, `MEMORY_INTEGRITY_ERROR`, `MEMORY_AUTHORITY_MISMATCH` and raw SQLite UNIQUE errors are all reported to the client as `INTEGRITY_MISMATCH`. The operation kinds must classify from the runner error BEFORE this collapse (they call the runner directly, not the RPC).
- The runner is constructed per request (`factory()` each call, `runtime-composition.ts:76-80`); it holds no in-memory state — every read goes to SQLite/filesystem, which is what makes restart re-observation possible.

### 2.2 Runner surface (`packages/core/src/memory/legacy-migration/legacy-migration-runner.ts`)

| RPC / runner method | Params (Shared) | What it does | Persisted evidence | Idempotency / restart | Duration | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `dryRun(workspaceRoot)` `:75-84` | `{workspaceRoot}` | `publishLegacySnapshot(..., dryRun:true)` (manifest only, `directory:null`, `legacy-snapshot.ts:21`), then normalizes each live file; returns `{reportId=snapshotId, exceptional, plannedZero, plannedOne, plannedMany:0, sourceCount}`. | none (probe 1: `memory_migration_runs` count stays 0). | pure; `reportId` is deterministic from `{schemaVersion,normalizerVersion,entries[]}` (`legacy-snapshot.ts:18-19`) so the same tree yields the same id. | sync, O(files); event-loop blocking while it hashes. | **read** (preview). Also the only "is there anything to migrate" probe. |
| `stage({workspaceRoot, owner})` `:86-99` | `{workspaceRoot, owner}` | publishes the durable snapshot (`legacy-snapshot.ts:22-46`), `initializeLocalAuthority` (creates the Local epoch if none, `canonical-memory-authority-repo.ts:30-41`), `ensureBank` Global + hard-coded Character `"taki"` (`:91-92`, deterministic `legacy-bank/v1` ids `:188`), `createRun` (`phase='snapshotted', status='running'`), lease (600 s), then converts EVERY source inline via `stageSource` (`:101-126`), releases lease, returns `status`. | snapshot dir; `memory_migration_runs`, `_sources`, `_attempts`, `_results`; `canonical_memory_authority_epochs/_state`, `canonical_memory_banks`, `canonical_memory_sources/_units/_policy/_fts`, `taki_memory_blocks`. | Run id = `randomUUID()` (`:93`). At most ONE run with `status IN ('running','ready')` (partial unique index `021:21-22`); probe 2: a second `stage` while live throws the raw `UNIQUE constraint failed: index 'idx_memory_migration_one_live_run'` (-> `INTEGRITY_MISMATCH` at the RPC). Re-staging the same tree after a completed run is ALLOWED and mints a new run (probe 1 "second stage: allowed") — `stage` does not check `mode`. Per-source import is replay-safe (`legacy-canonical-import-repo.ts`, same operationId+hash returns existing). | sync, event-loop blocking for the whole conversion; no progress callback; no cancellation point. | **mutation-needs-operation** (`local.onboard.stage`). |
| `resume({runId, owner})` `:60-73` | `{runId, owner}` | requires run `status IN ('running','failed')` with an `epoch_id`, else `MIGRATION_NOT_FOUND`; re-acquires lease; resets every source with disposition `pending/normalized/staged/failed` to `pending` and re-runs `stageSource(existing:true)` from the SNAPSHOT copy (not live files). | new `_attempts` rows (attempt_no increments, probe 2), updated `_sources`. | deterministic identities; safe to repeat. Does NOT resume a run that is `ready` (verified) or `completed`. | sync, blocking, O(unresolved). | **mutation-needs-operation** (`local.onboard.resume`, or fold into the stage kind). |
| `status(runId)` `:179-183` | `{runId}` | `{runId, phase, status, sourceCount, resolvedCount, blockingCount}`. `resolved` = `converted-*`/`excluded`/`verified`; `blocking` = `pending/normalized/staged/failed`. Unknown id -> `MIGRATION_NOT_FOUND`. Note: the RUN `phase` stays `'snapshotted'` after staging (probe 1/2); only `verify` moves it to `'verified'` and `activate` to `'activated'`. | none | pure | sync, 2 queries | **read** |
| `verify(runId)` `:140-157` | `{runId}` | recomputes ledger/canonical consistency (result counts, unit existence in the epoch, source existence, Bank FK); `valid` iff `blockingCount===0` and no mismatch; when valid WRITES `sources.phase='verified'` and `runs.phase='verified',status='ready',verified_manifest_digest,readiness_digest` (`:152-155`). Returns `{runId, verified, manifestDigest, readinessDigest, blockingCount}`. | run digests on success only. | idempotent (re-verify of a completed run does not throw, `legacy-migration-runner.test.ts:49`). | sync, several aggregate queries. | **read-with-side-effect**: safe to call from the Home reply path, but it is the gate that makes `activate` admissible, so the activate kind should call it itself rather than trusting a stale client. |
| `exceptions({runId, cursor, limit})` `:185` | `{runId, cursor, limit<=100}` | paginated `{sourceId, code, relativePath}` for sources with a `diagnostic_code`; ordered by `source_id`. The only surface that exposes snapshot-relative paths. | none | pure | sync | **read** (operator-only detail list). |
| `exclude({runId, sourceId, reason, actor})` `:186` | `{runId, sourceId, reason(1..512)}`; `actor` = authenticated `deviceId` or `"operator"` (`memory-migration.ts:44`) | acquires lease, inserts `memory_migration_exclusions`, sets source `disposition='excluded'`, releases lease, returns `status`. | `_exclusions` row (immutable identity: snapshot id, raw hash, path, reason, actor, time). | one row per `(run, source)`; probe 2: re-excluding throws the raw UNIQUE error (-> `INTEGRITY_MISMATCH`). Lease requires `status IN ('running','ready')` (`ledger-repo.ts:55-59`). | sync, sub-ms. | **mutation, short** — does not outlive a reply; a plain RPC is sufficient, but it changes the settlement of a later verify/activate. No un-exclude exists. |
| `activate({runId, workspaceRoot, timeoutMs})` `:42-49` + `:187` | `{runId, workspaceRoot, timeoutMs 100..60000}` | `fence.quiesce(timeoutMs)` drains Legacy admissions; re-walks the LIVE tree (`dryRun:true`) and requires `snapshotId === run.snapshot_id` else `SNAPSHOT_CHANGED` (probe 2 confirmed after appending to a file); lease `owner:"activation"`; `activateCanonicalLocal` one synchronous transaction (`legacy-activation-repo.ts:46-64`): requires `status='ready'`, matching digests, zero unresolved, `canonical_memory_authority_state.active_epoch_id === run.epoch_id`, marker `mode='legacy-markdown'` -> `'canonical-local'`, inserts receipt, run `phase='activated',status='completed'`. Then `fence.retire()` and `onActivated(epochId)` = `selected.bindCanonical` (live rebind). | `memory_authority_selection`, `memory_migration_activation_receipts`, run row. | Exactly once per database (marker update requires `mode='legacy-markdown'`); a second activation fails `INTEGRITY_MISMATCH`. Post-commit failures (constructor/callback/marker-reread) keep the marker and retire Legacy permanently (`runtime-activation-failure.test.ts:92-131`, `:133-170`). Pre-commit failure reopens Legacy (`:172-189`). | async; bounded by `timeoutMs` for the drain; the transaction itself is short. | **mutation-needs-operation** (`local.onboard.activate`) — a lost reply here is the worst case: the process may already be Local while the client thinks it failed. |

Remote effects: none. Every B2 path is filesystem + SQLite only; grep of `legacy-migration/` shows no HTTP client,
no Hindsight import (`hindsight-*` is imported only by the activation-repo's Hindsight-marker verifier `:29-44`, which is
a read). Confirmed.

### 2.3 Identities B2 already mints (candidates for `producerRef`)

| Identity | Where minted | Stable across restart? |
| --- | --- | --- |
| `runId` (UUID) | `stage` `:93` | yes — primary key of `memory_migration_runs`. |
| `snapshotId` (`sha256:<64hex>`, deterministic over the tree) | `legacy-snapshot.ts:19` | yes; also the `dryRun.reportId`; equality between live tree and run row is the `SNAPSHOT_CHANGED` check. |
| `epoch_id` (Local epoch UUID) | `initializeLocalAuthority` | yes; becomes `memory_authority_selection.active_epoch_id` on activation. |
| `lease_fence` (monotonic int per run) | `acquireLease` `ledger-repo.ts:52-63` | yes; every ledger write is CAS on `(lease_owner, lease_fence, lease_expires_at > now)`. |
| `verified_manifest_digest`, `readiness_digest` | `verify` `:150-151` | yes; activation re-checks both. |
| `activation_transaction_id` (UUID) | `activate` `:187` | yes; receipt PK + marker column. |
| per-source `source_id` (`sha256:` over path+rawSha256) | `sourceIdentity` | yes, deterministic. |

### 2.4 Closed reason union seen at the runner boundary

`LEGACY_DIAGNOSTIC_CODES` (30 codes, `legacy-diagnostics.ts:6-14`) plus runner-level throws that are NOT in that list:
`MIGRATION_NOT_FOUND` (`:62`, `:142`, `:180`, `:187`), `MEMORY_INTEGRITY_ERROR` (`:187`, activation repo), `LEASE_LOST`
(in list), `MEMORY_QUIESCENCE_TIMEOUT` and `MEMORY_AUTHORITY_FENCED` (fence), raw SQLite `UNIQUE constraint failed ...`
(second live stage, duplicate exclusion). An operation kind must map these itself; the RPC layer collapses non-listed
ones to `INTEGRITY_MISMATCH`.

## 3. Empty-workspace path (probe 1, real runner, empty `workspace/`)

- Boot: `legacy-markdown` (marker seed), Legacy Markdown engine constructed over non-existent dirs (`walk` returns when `!existsSync(root)`, `legacy-snapshot.ts:58`; the Markdown engine's own reconcile tolerates an absent tree — see `bootstrap.ts:150`).
- Canonical Local is NOT activated automatically. No code path calls `stage`/`activate` at boot.
- `dryRun` on an empty tree returns `{"exceptional":0,"plannedZero":0,"plannedOne":0,"plannedMany":0,"sourceCount":0}` with a deterministic `reportId` (`sha256:688d3090...` for the empty manifest). This is the "nothing to migrate" preview; there is no dedicated flag — `sourceCount === 0` is the signal.
- `stage` on an empty tree succeeds: publishes a snapshot dir containing only `manifest.json`, creates the Local epoch and TWO Banks (Global + Character `"taki"`, hard-coded at `:92`), a run with `sourceCount:0, blockingCount:0, status:'running'`.
- `verify` -> `verified:true`, `status:'ready'`. `activate` -> `{"activated":true,"mode":"canonical-local"}`, marker updated, one receipt row, snapshot dir remains under `workspace/memory-migration/`.
- Therefore the empty-workspace onboarding is the SAME three mutations (`stage -> verify -> activate`) with zero sources; evidence written = snapshot dir (manifest only) + run/receipt rows + epoch/Banks. No special-casing exists.
- After activation, `dryRun` still works and `stage` is still ALLOWED (mints a second run; `verify` would pass but `activate` would fail `INTEGRITY_MISMATCH` on the `mode='legacy-markdown'` guard). The onboarding kinds must refuse at `admit()` when `mode !== 'legacy-markdown'`; B2 does not.
- Caveat: the hard-coded `"taki"` Character Bank at `:92` means a fresh install gets a Character Bank whose id is `legacy-bank/v1("taki")`; `ensureCanonicalLocalBanks` (`canonical-local-banks.ts:24-31`) reuses existing Banks by scope, so the Local runtime picks these up and creates random-UUID Banks only for other Characters.

## 4. Gap to a durable operation

### 4.1 Concrete correctness gaps in the current producer

All paths in this subsection are under `packages/core/src/` unless stated otherwise.

| Gap | Exact evidence and consequence | Required producer change |
| --- | --- | --- |
| Missing manifest sources after interruption | `memory/legacy-migration/legacy-migration-runner.ts:94-96,103` inserts each source immediately before processing it. `:66` resumes only existing ledger rows; `:143-149` verifies only those rows. A crash after source N can omit N+1..end while reporting zero blockers. | Atomically create run + the entire source inventory before conversion; on historical partial runs reconcile exact manifest identities before resuming. Verify set equality, not only row counts. Never interpret zero registered rows as an empty snapshot. |
| Snapshot is trusted too weakly on reuse/resume | `legacy-snapshot.ts:25,72-75` only checks manifest version and presence of an ID; `legacy-migration-runner.ts:64,107` parses saved JSON and reads bytes without recomputing the saved manifest/source identity. | Validate the manifest schema, safe relative paths, canonical manifest hash, unique source identities and each copied byte hash/length on reuse and resume. Preserve discovery exceptions; resume currently replaces their descriptor with `exception:null` at `:69`. |
| Verification reopens completed work | `legacy-migration-runner.ts:152-154` unconditionally writes `status='ready'`. Existing test `legacy-migration-runner.test.ts:49` checks only that verify does not throw after activation. | Separate a pure verification projection from a lease-owned readiness mutation. A completed run must remain completed; its historical receipt can be read without rewriting it. |
| Verification proof is incomplete | `legacy-migration-runner.ts:144-148` checks result counts, unit existence, source existence and Bank FKs, but not the complete payload/revision/policy/Block closure. `:150-151` hashes ledger fields rather than re-proving their targets. | Re-prove the deterministic conversion outcome against stored canonical data, policy and expected Block projection. Include explicit zero-result and exclusion evidence. Activation re-runs this proof under the fence and uses the returned digests. |
| Per-source partial publication | Import commits independently (`legacy-canonical-import-repo.ts:24-28,42-46,54-55`), then the runner writes results, canonical IDs and attempt completion separately (`legacy-migration-runner.ts:113-122`). Crash/failure can leave an imported record whose source still appears failed. | One synchronous source transaction encloses import, result rows, source IDs and successful attempt outcome. Record failure separately after rollback. Existing repository transactions nest through the established savepoint wrapper. |
| Exclusion is not a deletion | `legacy-migration-ledger-repo.ts:121-137` changes disposition and writes a receipt but never removes earlier canonical effects; it also accepts a successfully imported source. | Restrict the short exclusion command to unresolved sources with no committed import effects. For a historical partial import, reconcile/replay it first or refuse with a precise repair requirement; never certify it excluded while leaving active imported data. |
| Failed-run resume cannot acquire a lease | Runner accepts `status IN ('running','failed')` (`:61`), but ledger acquisition accepts only `('running','ready')` (`legacy-migration-ledger-repo.ts:56`). | A same-run explicit resume transitions a recoverable failed run to running atomically with the lease claim. Do not create a new run to work around the mismatch. |
| Lease time does not advance | Runner evaluates `now()` once for all stage/resume writes (`:36-37`), never calls `renewLease`, and does not release in a `finally`. | Use a live clock per committed chunk, renew before expiry, and best-effort release in `finally` without hiding the original failure. Use Core/boot/operation-derived owners, not arbitrary client owner strings or the global `activation` owner. |
| Prepared data contaminates a replacement run | The Local epoch is initialized/reused at `:89`; imports live in that epoch, and Blocks have no epoch. A new snapshot would add changed identities while retaining prior prepared effects. | Do not implement restaging by marking the old run failed and calling stage again. A changed preview must either be restored to its accepted snapshot or use an explicit exact cleanup/rebuild of migration-owned staged effects. This is a required actionable recovery boundary, not permission to delete original Legacy data. |
| Source-level error loses classification | `stageSource` catches many errors and records a source failure (`:123-132`), so stage can return normally with blockers. RPC guards collapse other codes (`server/methods/memory-migration.ts:62-72`). | Operation settlement inspects the saved source/run outcome and blocker count. Call the producer directly; preserve closed failure codes instead of treating a returned stage status as successful readiness. |

The original §2 table describes observed legacy behavior, not the desired contract. In particular, `verify` is
**not** a safe generic Home read in its current form, and `resume` is not complete crash recovery until the
manifest-coverage and atomic-source gaps above are closed.

### 4.2 Recommended minimal operation surface and identities

Use two handler kinds in the existing registry, both in one `local-onboarding` family:

1. `local.onboard.prepare`: a new preparation accepted against an exact preview identity, or an explicit resume
   of a discovered run. It snapshots/registers/stages and performs fresh verification. A prepared operation may
   finish with an actionable source-blocked result; the producer run remains available for exclusions/resume.
2. `local.onboard.activate`: explicit activation of a prepared run. It verifies again after quiescence, commits
   using the B2 activation repository, and binds the Local runtime. For an exact already-committed run, this kind
   performs **binding recovery only**, never another authority transaction.

Keep preview, run discovery, status and exception pages as reads. Make public verification a pure read and reserve
readiness writes for these two handlers. Exclusion remains a short authenticated command, serialized with the same
family and producer lease; it does not need a separate scheduler or long-running operation kind.

`memory-operation-service.ts:65-82` calls `admit()` before inserting the operation, and immediately starts `execute()`.
Keep `admit()` cheap and side-effect free: validate authority/run/preview identity and mint the prospective run UUID
and activation transaction UUID where applicable. Persist that producer reference **in the admitted operation before
any snapshot/import work**. Yield to a macrotask before the producer is claimed. No producer work belongs in `admit()`.

Identity requirements:

| Identity | Meaning and lifetime |
| --- | --- |
| Durable operation UUID | One operator command/attempt, minted by the existing owner. An explicit retry gets a new operation UUID. |
| B2 run UUID | One preserved snapshot and migration ledger, reused across prepare/resume/activate/recover attempts; minted by Core before first side effect. Add an internal runner input accepting this Core-owned UUID. |
| Snapshot/report hash | Exact accepted evidence, never a substitute for run identity. Compare preview with the snapshot actually published, and compare live files again under the final fence. |
| Activation transaction UUID | Exact commit identity reserved in the activation operation producer reference and passed to `activateCanonicalLocal`; read the receipt by this ID/run on recovery. |
| Source import `operation_id` | Existing deterministic `legacy-operation/v1` hash (`legacy-identities.ts:29-30`), scoped to source/Bank/bytes; it is **not** the user-visible operation UUID. Preserve its import idempotency. |
| Epoch/lease fence/owner boot ID | Epoch is the prepared/selected Local authority; lease identifies the actual writer attempt. Neither is inferred from timestamps or the most recent unrelated operation. |

The current producer union has setup/replica arms only (`shared/src/memory-operation-schema.ts:49-52`), the error field
is a replica-only union (`:75`), and `MemoryOperationSettlement` permits only completed/failed
(`memory/operations/memory-operation-contract.ts:28-33`). Add a local producer/result/progress arm, closed local
diagnostics, and an explicit local unknown classification. Do not cast B2 codes into the replica union.

Progress belongs to producer evidence: phase, expected manifest count, registered/resolved/blocked counts and latest
checkpoint. The owner publishes after a persisted chunk through its existing CAS + `onChanged` path. A non-terminal
operation cannot use `result` as progress (`memory-operation-schema.ts:84`); add a bounded progress field or carry the
checkpoint in the local producer ref, rather than weakening that invariant. Discovery must include a live/last B2 run
even if no Stage 2a operation exists (old raw B2 work) or the operation is no longer in the recent-20 list.

### 4.3 Admission, old RPCs and repeated commands

The operation table already has family single-flight (`db/migrations/048-memory-operations.ts:27`), while B2 has a
separate one-live-run index (`021-memory-legacy-migration.ts:21-22`). They are complementary: an operation can finish
while its prepared run must remain selected for later activation. Do not release the latter constraint by spawning
a new run every time Home clicks prepare.

- Check mode before new prepare. Canonical Local and Hindsight refuse new onboarding. Activate permits Canonical
  Local only for an exact run/receipt recovery branch; a different epoch/snapshot/transaction refuses.
- After a lost submit reply, clients discover the existing family operation/run; they do not automatically resubmit.
  A simultaneous submit returns BUSY with the active operation ID. A completed prepare is discovered and reused as a
  run; a later explicit resume creates a new command linked to that run.
- Old `memory.migration.stage/resume/activate` currently bypass the owner (`server/methods/memory-migration.ts:39-45`,
  registered at `main.ts:464`). Route them through the same service or refuse them with a migration-to-durable-API
  diagnostic. A legacy synchronous result must not silently be returned from a new durable asynchronous contract.
  Compatibility adapters may wait on the **same admitted operation**, but may never call the runner independently.
- Old verify/exclude routes must pass the same family ownership guard and phase rules. Read-only verify is preferable
  to a hidden write. The process-level guard plus the SQLite lease protects all mutation paths, not just Home clicks.
- Workspace and snapshot destination come from composition (`runtime-composition.ts:75-79`). Old path-bearing
  requests must match the effective Core workspace or be refused; strict JSON schemas alone do not constrain paths.
  Actor comes from authenticated connection context, and lease owner from Core.
- Exact duplicate exclusion `(runId, sourceId, same reason, same actor)` returns the already persisted exclusion.
  Changed reason/actor for the immutable receipt is an explicit conflict. Do not silently overwrite audit evidence.
  Adding an exclusion invalidates readiness, and activation must reverify; a failed run with imported remnants refuses
  exclusion until the effects are reconciled.

#### Supported recovery after a changed snapshot

Distinguish **resume** from **replace preparation**. Resume never adopts changed live files: it finishes the same
immutable snapshot/run, and activation still refuses while live bytes differ. Do not require an operator to rewrite
their current data merely to escape a stale run. Recommend an explicit fresh preview + replace-preparation action
within `local.onboard.prepare`, preserving old evidence and building an isolated candidate:

1. Under the same family owner, prove Legacy is still selected, no activation receipt exists, and no old lease/worker
   can write. Terminalize the superseded producer run with an explicit durable supersession association; retain its
   ledger, immutable snapshot, canonical records and operation history. A bare `failed` value without the successor
   relationship is insufficient for recovery/discovery.
2. Create a fresh candidate Local epoch and run for the new snapshot. Atomically close the former preactivation
   candidate and move `canonical_memory_authority_state` to the new one while **leaving the authority selection
   marker Legacy**. This is internal preparation replacement, not a second user-visible authority activation.
   The existing repo cannot do this: `canonical-memory-authority-repo.ts:30-40` only initializes/reuses. Add a tightly
   scoped preactivation-only method guarded by marker/receipt/lease checks. Migration 017 permits only one active
   epoch (`017-canonical-memory.ts:11-19`), so old-close/new-create/pointer-change must share a transaction.
3. Stage Blocks by run rather than writing `taki_memory_blocks` during preparation. That table has no epoch
   (`017-canonical-memory.ts:69-73`), so epoch isolation alone cannot fix stale Blocks. Use additive run-scoped Block
   projection evidence; publish only the selected run's projections in the final activation transaction. Preserve
   existing independently owned Blocks; detect conflicts instead of overwriting them.
4. For old raw B2 runs that already published Blocks, compare exact deterministic scope/content with their immutable
   source evidence. If existing global Block ownership cannot be established, refuse replacement with an integrity
   repair diagnostic. Never assume a Block is disposable solely because it resembles a legacy import. This is an
   explicit compatibility limit for historical partial runs, not a limitation of the new supported onboarding path.
5. Verify the selected epoch's entire import closure against the selected run: no extra canonical sources/units/policy
   effects from an earlier preparation, plus exact selected Block plans. Unrelated or unattributable prepared data
   blocks activation. Epoch isolation preserves old evidence without deleting user or historical data.
6. Keep exact primary source custody across candidate replacement: before Local activation no Local ingestion is
   dispatched, so any witnesses assigned to the old prepared epoch must still be unprocessed. Transfer that exact
   unprocessed witness set and the preserved eligibility boundary in the candidate replacement transaction. If an
   old ingestion span/receipt exists, refuse and investigate instead of declaring it transferable. Never reset the
   boundary to today's tail or carry source identity merely by a numeric range.

This is more work than deleting prepared rows, but it gives an explicit, non-destructive recovery path and avoids
misrepresenting stale imports as new input. It reuses existing converter/importer/activation ownership and does not
introduce another scheduler. If design instead chooses exact cleanup of derived staging data, it must specify
ownership evidence and preservation explicitly; cleanup is not authorized by this research recommendation.

### 4.4 Restart and COMMIT classification

Stage 1 bulk-reconciles every foreign non-terminal row to unknown at construction
(`memory-operation-service.ts:53-54`, `db/memory-operation-repo.ts:84-100`); terminal rows cannot transition
(`memory-operation-repo.ts:68`). That behavior must remain for setup/replica. Add a kind-specific **boot observation**
hook for Local before the generic fallback. It reads B2 state; it does not dispatch work. Do not first terminalize
Local rows and then try to use ordinary `observe()` to change the terminal result.

| Evidence at restart/exception | Truth and supported next action |
| --- | --- |
| Operation admitted, reserved run absent | Preparation did not reach run publication. Preserve unknown/interrupted command truth; explicit retry may materialize the reserved run against the same preview. Do not claim no filesystem effect: a published snapshot may exist. |
| Exact run exists, incomplete inventory/attempt | Interrupted preparation; expose full expected coverage and resume same run after manifest validation/lease recovery. No auto-dispatch. |
| Exact run has complete verified evidence, marker still Legacy | Prepared, not activated. Reconstruct the successful prepare result; activation still requires explicit intent. |
| Activation operation, marker positively Legacy, no matching receipt | No committed authority switch. Release/recover producer lease; preserve Legacy; expose failure/interruption and explicit retry. |
| Receipt, run completion and marker agree on run/snapshot/epoch/transaction | Authority switch is committed, even if the callback threw. Never call activation again. If runtime binding is healthy the command can be reconstructed as completed; otherwise expose committed-but-unavailable with recover-binding action. |
| Marker/receipt/run disagree or cannot be read | Unknown/integrity failure, never a success or pre-commit rollback claim. Keep old writer fenced until positive Legacy evidence proves reopening safe. |
| Prior activation command is already terminal failed after bind error | Preserve that command's historical outcome. Show the committed receipt independently in overview; a new recovery operation references the same run/transaction and only repairs binding. |

For the first row, explicit retry uses the earlier admitted operation's reserved `runId`/preview through an
operation-reference recovery request; clients never supply a new arbitrary producer UUID. Mark the interrupted
operation terminal (unknown with exact producer evidence), admit a new prepare operation with the same reserved
run and expected preview, validate/reuse any published snapshot directory, and then atomically publish run plus
complete inventory. The family must not remain occupied forever by an admitted row with no producer. If live input
has drifted, return the fresh-preview/replace path above; never create a run from different bytes under the old
accepted preview. A process alive but stopped before claim also needs this explicit terminal/retry path.

The positive commit proof joins all fields from `memory_migration_activation_receipts` with the run and marker.
`readMemoryAuthoritySelection` validates non-null Local marker fields only (`legacy-activation-repo.ts:20`), unlike its
Hindsight receipt check (`:29-44`); it is insufficient by itself for this recovery proof. Perform the Local receipt
validation in the producer observation/boot path; do not infer commitment from `mode` or `run.status` alone.

`runtime-selector.ts:61` currently refuses recovery indirectly: after failed construction, `canonical=true` and
`current=undefined`, so a second bind calls `readCurrent()` and throws again. Implement same-epoch recovery when the
engine/flush binding is unavailable. Construct and publish a replacement only after required components succeed;
dispose partially constructed subsystem/sweepers and preserve failing flush until ready. A healthy same-epoch retry
is a no-op. Boot must offer unavailable status/recovery if construction fails, rather than terminating Core before
the operator can see the operation. No recovery reopens held Legacy tools or writes.

### 4.5 Responsiveness, cancellation and shutdown

`stage/resume` are synchronous full loops (`legacy-migration-runner.ts:60-98`); `dryRun` and snapshot creation also use
synchronous traversal/read/copy (`legacy-snapshot.ts:16-45,56-69`). Declaring their wrapper `async` is insufficient.

Recommended minimum: defer producer claim with `setImmediate`, make snapshot traversal/copy and source iteration
cooperative, use async/chunked file IO for potentially large source bytes, and commit each source atomically before
yielding. No `await` may occur inside `Database.transaction`. Even a single huge file must not block all status and
cancel requests. Pure preview should also remain responsive, though it does not need a durable mutation row.

For S2a, support **cancel-before-claim** only. The deferred execution must re-read the operation and atomically claim
it before work; a cancelled admitted row can never later run. Once claimed, cancel returns RUNNING while reads/events
remain responsive. This is coherent with the current synchronous owner `cancel()` that immediately terminalizes
(`memory-operation-service.ts:138-145`). Merely adding an AbortSignal and marking cancelled immediately is unsafe.
If in-progress cancellation is later implemented, persist a stop request and wait for producer acknowledgment after
the last atomic chunk/lease release; never cancel inside the activation COMMIT region.

Shutdown must stop new Local claims and await producer completion/checkpoint before stopping memory/runtime/DB.
Current order stops runtime before awaiting operations (`main.ts:525` and following); that is tailored to B5 ticks
and cannot be copied blindly for an operation still preparing or binding Local. Extend the existing lifecycle;
do not create a timer-driven second queue/recovery loop. A Core crash is distinct from acknowledged cancellation.

### 4.6 Closed failure matrix

| Condition | Classification / action |
| --- | --- |
| Family busy, different live B2 run | Admission refusal with active operation/run reference; no snapshot/import mutation. |
| Wrong mode, unknown run, expected snapshot mismatch | Precise closed refusal; no new authority/epoch. |
| Source syntax/placement/unsupported format | Persist the actual `LEGACY_DIAGNOSTIC_CODES` value; blocked prepare, explicit source-level resolution/exclusion only. |
| Supported valid source fails converter/schema/import | Producer defect/integrity failure; do not relabel as unsupported or auto-exclude. |
| Stale preview or live source change | `SNAPSHOT_CHANGED`; Legacy remains usable; refresh preview and perform a safe explicit restage strategy or restore the accepted input. |
| Lost/stale lease | `LEASE_LOST`; preserve evidence and stop writes; never map it to an arbitrary import defect. |
| Fence drain timeout | `MEMORY_QUIESCENCE_TIMEOUT`; no COMMIT, Legacy may reopen only after positive marker check. |
| Post-commit bind failure | Committed receipt + unavailable runtime; explicit binding recovery, never an activation retry. |
| Storage/marker read failure prevents classification | `outcome_unknown` with a closed local reason; no fabricated success and no assertion that the effect did not occur. |
| Stopped runtime or operation owner | Refuse new claims; existing shutdown policy determines completed/checkpointed interruption, never cancellation merely from socket closure. |

## 5. Usable-Local proof

### 5.1 Real runtime components to reuse

| Capability | Live producer and supporting tests |
| --- | --- |
| Foreground tools and captured provider identity | `packages/core/src/memory/canonical-local-runtime.ts:33-56` composes canonical tools/assembly/retain and `captureRun`; `packages/core/src/agents/chat-agent-canonical-memory.test.ts:29-55` uses the real Local provider through Harness admission and asserts the captured vector-unavailable contract. |
| Local-only provider composition | `canonical-local-runtime.ts:59-70` registers only Local. `local-memory-provider.ts:32-35,53-66,96-102` exposes retain/recall/CAS lifecycle, sparse retrieval and optional vectors; reflect is unsupported. No Hindsight connection is required. |
| New Character admission and scope | `canonical-local-runtime.ts:36-40` calls `ensureCanonicalLocalBanks`, and `canonical-local-subsystem.ts:49-52` initializes ingestion baseline on capture. Test Global/active-Character routing and exclusion of another Character; no assumption that hard-coded migration Bank `taki` is the active Character. |
| Exact-source ingestion | `canonical-local-subsystem.ts:29-36,40-57` installs the real journal/ingestion/maintenance; `canonical-local-ingestion.ts:57-68` preserves cadence and exact primary commits. Tests in `canonical-local-ingestion.test.ts` cover saved decisions, receipts and duplicate reinforcement. |
| Compaction and maintenance | `runtime-composition.ts:132-146` installs one provider-specific maintenance chain and rebindable flush. `runtime-composition.test.ts:95-120` covers Local compaction and in-process rebinding, but manually updates a marker, so it is not B2 onboarding integration proof. |
| Activation failure fencing | `runtime-activation-failure.test.ts:92-129,133-169,172-188` proves failed constructor/callback/read after COMMIT keeps Legacy retired, and pre-COMMIT rollback reopens it. Reopening the DB at `:125` proves marker/receipt, not reconstruction of a working runtime. |

Completion must require a composition-owned binding snapshot: installed engine, expected epoch, ready flush and
lifecycle availability. `snapshot()` is diagnostic marker projection (`runtime-composition.ts:61,164-168`);
`memory.authority.status` currently reports Local available from mode alone. Neither proves a usable runtime.
Do not use `captureRun()` as a status health probe because it can create Banks and baselines.

### 5.2 Legacy-to-Local primary source custody is part of this slice

The current fence counts memory calls, not a complete foreground Run (`memory-authority-fence.ts:17-23`). Chat may
be streaming when activation commits. `chat-agent.ts:310,316,321` supplies exact primary commit evidence after
persistence; `main.ts:366` points it at `runtime-composition.ts:69`, which silently does nothing while Local has not
been constructed. Failed binding therefore creates a real period in which committed primary evidence is discarded.
Local construction then initializes baselines to the current tail (`canonical-local-subsystem.ts:34-35`,
`canonical-local-ingestion.ts:62-64`), which can hide that loss as historical data. A healthy late callback is accepted
below baseline by `canonical-ingestion-source-repo.ts:132-144`; the problem is the callback being dropped, not merely
its sequence number.

**Recommended bounded design: durable exact-primary custody at composition, independent of successful binding.**
For the prepared Local epoch, use the existing `createCanonicalIngestionSourceRepo` to persist the trusted callback
directly; do not depend on `scope.canonical` being constructed. Initialize and preserve the eligibility boundary
before the transition can receive new commits; initialize new Characters before their first append. The repository
already verifies exact Timeline bytes/IDs/digests/commit boundaries (`canonical-ingestion-source-repo.ts:69-91`), and
its Local-authority check uses the active canonical epoch (`canonical-memory-maintenance-storage.ts:30-35`), which
B2 establishes during preparation. This allows custody while Legacy is still selected without running a second
ingestion pipeline. Normal Local ingestion later consumes the same witnesses and receipts.

At activation, temporarily gate new memory Run capture and retain that gate until a ready binding is published.
Existing late primary callbacks route to the preserved prepared/committed epoch even when the constructor fails;
existing Legacy tool references still fail closed after commit. Captured source witnesses must survive restart and
must not be reconstructed from `role='user'` or a numeric range. Failed witness persistence is an unresolved source
condition and prevents retirement/readiness; logging a warning is not durable acknowledgment.

A whole-Run drain alone is insufficient: `auto-memory.ts` queues detached work and looks up maintenance later,
so `settle` of foreground work does not prove source processing; its errors are intentionally swallowed. Existing
Run lifetime/disposal seams are `harness/run-service.ts:70-85,97-120`; memory capture occurs at
`harness/run-snapshot-capture.ts:61` but has no memory lifetime disposal in its context (`:65-73`). Use these seams
only for the short transition admission gate if needed; do not call permanent `RunService.seal()` (`:114`) for a
reversible transition pause or hold the old memory fence in a way that deadlocks existing tool calls.

The exact persistence-to-callback crash window is an additional required fault case: Chat appends before invoking
the callback. Preserve the activation eligibility boundary and refuse readiness/retirement for unproven in-flight
sources; if a positive primary witness is required to survive that precise crash, attach its durable recording to
the existing Chat persistence commit boundary. Do not backfill every Timeline row or silently advance baseline at
restart. This is source-custody hardening for Legacy-to-Local and cannot be claimed covered by future S2b PR03.

### 5.3 Meaningful integration verification

Use isolated temporary SQLite/files and the real B2 producer/activation/composition; substitute only external model
responses with existing deterministic model fixtures. The following are implementation requirements, not tests run
in this research pass.

| Test | Assertions that catch the actual gap |
| --- | --- |
| Empty workspace via registered operation methods | Submit returns/discovers one operation before producer completion; zero-source manifest/run verifies; one receipt and one Local epoch; real captured retain/recall work. No Hindsight/vector factory or network call. |
| Representative supported Legacy set | Global + two Characters, active/archived entries, zero-result entry, Blocks and unsupported fixture. Original bytes unchanged; exact import evidence/policy/Block closure; unsupported blocker requires explicit exclusion. |
| Crash immediately after run publication / between sources | Entire manifest remains discoverable, later sources cannot vanish, status reports expected inventory; resume same run; imported source count and immutable receipt count do not duplicate. |
| Inject failure after canonical insert before ledger update | Source transaction rolls back completely or resumes exact committed evidence; exclusion cannot hide an imported artifact. |
| Tamper manifest, copied bytes, canonical policy/result or Block | Verify refuses; no ready marker; live matching the original snapshot does not mask corrupted saved evidence. |
| Re-verify completed run | Run stays activated/completed, receipt unchanged; a later raw stage remains refused. |
| Two clients + old raw RPC + lost reply | One family writer, same run association, proper BUSY/refusal. Short exclusion/verify cannot change proof during activation drain. |
| Preview drift and replacement preparation | Activation refuses live changes; explicit new preview creates an isolated replacement candidate, retains old evidence, transfers only exact unprocessed witnesses, and publishes only selected Block plans. No stale effects appear in the new authority. Historical unowned Block conflict refuses explicitly. |
| Responsiveness and cancel | Hold cooperative file/source work, process another status/event turn, cancel admitted before claim and prove no later producer writes. Running cancellation returns refusal while source work continues correctly. |
| Pre-COMMIT vs post-COMMIT failure | Inject receipt insert/COMMIT failure, constructor failure, callback failure and marker reread failure. Assert marker/run/receipt, old reference fencing, runtime readiness and supported next action separately. |
| Same-epoch bind recovery | After committed constructor failure, explicit recovery yields actual tools/flush; exactly one receipt/epoch; no duplicate retention worker; repeat healthy recovery is a no-op. |
| Real process/database restart | Reopen the same file DB, reconstruct composition and operation owner with new boot ID, discover exact producer state, resume only explicitly. Recovered Local retain/recall/ingestion work; no marker-only shortcut. |
| Foreground commit crosses transition | A deterministic streaming turn finishes before COMMIT, after COMMIT, and after forced bind failure; exact witnesses remain durable and are processed once after bind/restart. No callback is discarded or inferred from Timeline role. |
| Persistent source gap / callback crash | An unproven in-flight/just-persisted primary row cannot be hidden below a newly advanced baseline or retired by Compaction; recover exact evidence or surface a blocking source failure. |
| No-vector ordinary use | Via real Harness/chat admission, scoped retain+lexical recall, hidden/archived filtering, exact ingestion and one observable maintenance effect work immediately and after restart. Mere nonempty tool names do not pass. |

Existing tests to extend, rather than duplicate: `legacy-migration-runner.test.ts`, `legacy-snapshot.test.ts`,
`runtime-activation-failure.test.ts`, `runtime-composition.test.ts`, `chat-agent-canonical-memory.test.ts`,
`chat-agent-primary-commit.test.ts`, operation service/repo/Shared schema tests. Add one full onboarding integration
test that traverses the registered methods to real producers and runtime. Run relevant suites, then workspace
typecheck/lint, Desktop build and isolated real Node boot with no private credentials or original user data.

## 6. Home mount points

See [Home and protocol research](stage2a-home.md), owned separately. This file specifies only producer/readiness
requirements that the Home projection must consume.

## 7. Q1 engineering-constraint notes

### Recommended implementation order and hotspots

1. Harden B2 inventory/manifest validation, source transaction/idempotency, verify lifecycle and exclusion rules.
   Tests must first demonstrate the omitted-source and completed-run regression.
2. Introduce Core-owned run/activation identities and cooperative producer execution; establish family ownership
   across new and old methods, precise diagnostics and pre-claim cancellation.
3. Extend the existing operation kind contract with Local producer progress and read-only boot observation; keep
   Stage 1 foreign setup/replica unknown behavior unchanged. No new scheduler, polling or retry loop.
4. Add exact Local commit recovery, same-epoch binding repair, readiness evidence and primary-source custody.
   Ensure shutdown ordering and failed constructor cleanup are covered before calling the flow usable.
5. Connect the separate Home research surface and run end-to-end empty/legacy/restart integration evidence.

The two-kind recommendation keeps stage/resume as producer actions within one durable preparation command, while
activation remains explicit. Eight separate operation kinds would add state combinations without solving source
integrity. One monolithic prepare-and-activate command would obscure the required exception/exclusion review
boundary. Neither is necessary to satisfy the accepted scope.

Suggested module boundaries are a small B2 snapshot/inventory helper, producer execution helper, verifier/receipt
observer and Local operation handler. Keep `legacy-migration-runner.ts` as orchestration, use existing DB transaction
helpers, and preserve the documented import identities. Prefer additive schema for genuinely missing durable facts;
do not edit historical migrations 021/048. Existing operation JSON fields can hold Local producer/progress arms,
but a new durable phase/stop/custody fact must not live only in a JavaScript closure.

### Related specifications and records

- `.trellis/spec/backend/memory-operations.md`: one operation owner, exact producer outcome, family single-flight,
  CAS/push and Stage 1 restart semantics. S2a must extend its signature/Local matrix without rewriting Stage 1 claims.
- `.trellis/spec/backend/canonical-local-memory-runtime.md`: actual Local tools/maintenance, exact primary witnesses,
  retirement refusal, and irreversible Legacy retirement after marker commit.
- `.trellis/spec/backend/sqlite-transaction-isolation.md`: nested source transactions and true COMMIT failure isolation;
  asynchronous filesystem/model work must remain outside transaction callbacks.
- `.trellis/tasks/archive/2026-09/09-19-hindsight-durable-operations/design.md` and `implement.md`: completed owner,
  failure/restart precision and existing test seams. Historical unchecked bookkeeping is not new S2a implementation work.
- `.trellis/tasks/09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md`: accepted scope,
  conditional product grill and PR05 engineering obligations; no redoing overall audit or Stage 1.
- Current task `prd.md`: empty/supported Legacy onboarding, no arbitrary caller paths, no remote/vector prerequisite,
  actual Local usability, explicit original-data/manual acceptance boundaries.

### External references and versions

No external service or web lookup was needed. Repository package declarations: Node `>=24`, pnpm `10.22.0`,
TypeScript `^6.0.0`, Vitest `^4.1.0`, Core `zod ^4.4.0`, `ai ^7.0.17` and `json-rpc-2.0 ^1.7.1`.
These are declared ranges, not a fresh installed-version audit. Source-grounded event-loop examples are
`auto-memory.ts` (deferred macrotask chain) and the synchronous SQLite transaction contract above.

## Caveats / Not Found

- No production code, task state, spec, Git state or original user data was changed by this research continuation.
  No test suite or new probe was executed; existing tests were read for actual coverage and missing assertions.
- The first inventory's probes establish only their stated old behavior. In particular, re-verifying completed work
  without throwing is a bug indicator, not idempotency evidence.
- The isolated candidate replacement and precise Chat persistence callback crash hardening above require explicit
  design/implementation work. Raw retry of the old B2 methods is not an acceptable substitute; no destructive cleanup
  is implied. Historical raw-run Block ownership may require an explicit repair refusal rather than automatic adoption.
- Full Home layout and exact client request naming belong to the separate Home research; the proposed two operation
  kinds and lifecycle semantics above are engineering recommendations, not claims that those schemas already exist.
- Any proposed activation recovery must also handle a constructor failure during boot so the operator can reach
  unavailable status and recovery. The current selector throws during construction; DB reopen alone does not prove it.
- All verification remains synthetic/isolated. Original-data switching, live model/provider calls and manual owner
  acceptance are not authorized or established by this report.
