# Canonical Memory Replica Synchronization

## Scenario: Canonical Memory Replica Journal Application

### 1. Scope / Trigger

- Trigger: B5 applies an admitted Hindsight journal after a verified Bank snapshot or rebuilds the local replica.
- Wave 1 exposes a one-Bank storage/client primitive. Wave 2 adds scheduling/reconciliation; Wave 3 adds the offline
  Pending Memory contract below. Its provider-derived fence, append recovery, and live activation remain incomplete.

### 2. Signatures

- Shared contracts: `HindsightJournalPageSchema`, `MemoryReplicaJournalPageSchema`, `MemoryReplicaCheckpointSchema`,
  and `MemoryReplicaLeaseSchema`. Core wire normalization must return these validated contracts.
- Client: `changesAfter({ bankId, afterCursor, limit, context })`; `limit` is a soft provider page limit.
- Core repository: `seedVerifiedSnapshot(input)`, `applyPage({ page, expectedCheckpoint, lease, deadlineAt?, expectedBank?, expectedAuthority? })`,
  `record`, `logicalRecord`, and `search`. Migration 033 owns `hindsight_replica_sync_records`, `_fts`, `_checkpoints`, and `_leases`.

### 3. Contracts

- Every page validates its provider window, contiguous cursor suffix, per-change lineage/generation/Bank, complete
  transaction batches, unique batch IDs, and unique logical objects within each batch before writing. Successive
  revisions of the same object in distinct batches are valid. The provider's `replication.py`
  `append_logical_changes` contract rejects duplicate object keys inside one authoritative transaction.
- HTTP success bodies are limited to 512 KiB while reading; cancel an oversized stream before buffering the rest.
  Complete pages are separately limited to 10,000 records. Reject the whole page at either bound; never truncate a
  provider transaction or advance its checkpoint. An empty caught-up page retains the predecessor cursor.
- Normalize provider snake_case fields only at the logical payload top level. Preserve nested metadata/config keys
  verbatim and reject any pair of fields that collapses to the same canonical key.
- Require trusted Bank scope and source/Memory policy/provenance bindings. Missing or contradictory mappings fail
  before publication. Provider fields alone cannot fabricate a Taki policy or trusted source provenance.
- Record upserts/tombstones, explicit-column FTS updates, and checkpoint publication share one synchronous SQLite
  transaction. Recheck the owner/run/fence/expiry lease and full expected checkpoint before publishing. Current
  checkpoints never overwrite immutable B4 activation receipts or change Memory Authority.
- Recovery supplies `expectedAuthority: { epochId, providerLineageId }` to journal and snapshot publication. Compare
  active provider/epoch/lineage and current trusted Bank scope inside the publication transaction before writes and
  again before the checkpoint commits. An outer post-await check cannot undo an already published page. Check current
  scope even when the page contains no Bank object; retain earlier complete pages when a later page is refused.
- Full canonical reads retain policy, lifecycle, provenance, source, and derived payloads across reopen. Default
  Memory reads and FTS omit invalidated/tombstoned units. Expiring remote snapshot metadata prevents a new rebuild;
  it never invalidates the previously verified local checkpoint or replica.
- `RetainResultSchema` distinguishes pending acceptance from completed retain. Completed receipts cannot contain
  pending/failed Bank progress; pending Bank entries require an operation ID and only failed entries carry errors.
  A valid two-Bank pending receipt may retain one completed branch and one failed branch. Pending Memory remains
  separate from Run Effects and may not trigger blind generic Effect replay or automatic Local failover.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Malformed cursor/lineage/batch or colliding normalized fields | Client rejects with `HINDSIGHT_RESPONSE_INVALID`; no write. |
| Response exceeds 512 KiB or a complete page exceeds 10,000 records | Refuse the entire page; retain the prior checkpoint and FTS. |
| Lease owner/run/fence/expiry or predecessor checkpoint changed | Reject stale work; no partial canonical state. |
| Record, FTS, or checkpoint publication fails | Roll back all three together. |
| Source or Memory policy binding is absent or contradictory | Refuse the projection/rebuild before publication. |
| Remote snapshot expires after a verified local commit | Existing full records and checkpoint remain readable. |
| Completed retain still reports a failed/pending Bank | Reject the contradictory receipt; post-dispatch coordinator returns unknown outcome. |

### 5. Good/Base/Bad Cases

- Good: authenticated snapshot@C, full journal transaction, atomic commit, SQLite reopen, and canonical policy/FTS read.
- Base: caught-up empty page changes no cursor; a partial two-Bank receipt preserves accepted and failed branches.
- Bad: cut a transaction to the requested page size, trust a malformed logical page until a later consumer notices,
  read an unlimited HTTP body before measuring it, or describe an accepted Pending Memory operation as confirmed data.

### 6. Tests Required

- Shared/client tests for cursor windows, per-change lineage, complete batches, duplicate object rejection within a
  transaction, valid repeated objects across transactions, snake/camel collisions, and verbatim nested JSON keys.
- Stream tests for cancellation above 512 KiB, exact byte-bound acceptance, and multibyte text across chunk boundaries.
- File-backed snapshot-to-journal/reopen tests including a 501-record transaction over the soft 500-record limit,
  checkpoint-write rollback, oversize/auth/reset/cancel/expiry failures, missing projection bindings, default lifecycle
  hiding, Chinese FTS, complete source/derived reads, and unchanged authority/activation receipts.
- Shared/Core full tests, downstream typechecks/tests, root lint, task validation, whitespace/BOM checks, and isolated
  Core boot when migration/startup imports change. Real provider/LLM acceptance remains separately authorized.

### 7. Wrong vs Correct

```ts
// Wrong: this acknowledges only part of one committed provider transaction.
applyRecords(page.changes.slice(0, requestedLimit));
advanceCheckpoint(page.nextCursor);

// Correct: validate the complete page, then publish records, FTS, and checkpoint under the same lease/transaction.
const canonical = projectHindsightJournal(page, projectionContext);
repo.applyPage({ page: canonical, expectedCheckpoint, lease });
```

## Scenario: Durable Replica Scheduling and Verified Reconciliation

### 1. Scope / Trigger

- Trigger: a configured Global or Character Bank is due, receives an explicit incremental/full request, or needs
  verified startup/reconnection catch-up after an outage.
  A foreground Pending write arms the same Bank's existing automatic retry at its child's `nextRetryAt` (or the first
  retry delay when no child retry time exists), preserving any earlier wake and immediately recomputing the scheduler timer.
  A run ending with `HINDSIGHT_PENDING_REMAINS` classifies that Bank's unresolved Pending metadata in the active
  Authority Epoch during its existing settlement transaction. One aggregate supplies waiting counts, the earliest
  retry time and a blocking diagnostic; it replaces the separate post-failure retry query/mutation. Other failures
  do not scan Pending. A future-row early wake leaves the row unclaimed and schedules a future wake without a tight
  loop. Manual-only mode still arms no background recovery.
- B5 owns deterministic synchronization execution. Heartbeat owns wake/budget policy; B6 owns runtime provider,
  recall, and tool wiring. This service neither changes Memory Authority nor replays Pending Memory.
- A live run consumes a verified B4 checkpoint and trusted policy/provenance bindings. Offline fixtures and an
  isolated Core boot do not satisfy B4 current-Local coverage, its final fence, or live activation acceptance.

### 2. Signatures

- Shared: `MemoryReplicaScheduleConfigSchema`, `MemoryReplicaScheduledRunSchema`, `MemoryReplicaRunResultSchema`,
  `MemoryReplicaSyncStateSchema`, and `MemoryReplicaSyncStatusSchema`.
- A scheduled run binds `{ lease, kind, trigger, predecessor, manualRequestId? }`; a result binds `{ checkpoint, observedCursor }`.
  Bank identity is `{ bankId, scope, characterId }`, with a Character identity only for Character scope.
- `createHindsightReplicaSchedulerRepo(db, now)` exposes `ensureBank`, `requestManual`, `requestCatchUp`, `requestRetry`, `recover`,
  `claim`, `promoteToFull`, `succeed`, and `fail`. `ensureBank({ bank })` preserves existing configuration;
  an explicit `config` is required to change it.
- `fail({ run, errorCode })` settles accepted-only Pending as `waiting`; it is not unconditionally a failure.
  Internal `readPendingRecoveryState(db, bankId)` returns `{ unresolvedCount, waitingCount, nextRetryAt, blockingErrorCode }`.
- `createHindsightReplicaScheduler(input)` exposes non-blocking `start()`, bounded `stop()`, `tick()`,
  `requestManual(bankId, kind, requestId?)`, `cancelManual(bankId, requestId?)`, `request(requestId)`,
  `requestRetry(bankId, dueAt)`, `verifiedReconnect()`, `status()`, and the closed supervisor `lastError()`.
- `createHindsightReplicaSyncRunner(input)` implements real admitted-client `run`/`rebuild` paths.
  `syncHindsightBankPage` and repository snapshot/journal inputs accept internal `deadlineAt`, `expectedBank`, and
  `expectedAuthority?: Pick<MemoryAuthorityEpoch, "epochId" | "providerLineageId">`. Scheduled publication carries its
  captured deadline/Bank; Pending recovery additionally carries the captured Authority through both pulls and rebuilds.
- Migration 034 owns `hindsight_replica_sync_schedule(bank_id, version, state_json)` and
  `hindsight_replica_sync_snapshot_cache`. Cache identity includes Bank, provider lineage, Bank generation, and
  provider page hash; rows also retain logical kind/ID, normalized record JSON, and a local integrity digest.

### 3. Contracts

- Ordinary polling defaults to six hours; full reconciliation defaults independently to seven days. Adapter bounds
  are one minute to 31 days and one minute to 90 days respectively; these are not provider API limits.
- Automatic retry delays are one minute, five minutes, fifteen minutes, one hour, then six hours repeatedly.
  A Pending row's `retry` with `HINDSIGHT_PENDING_REMAINS` and non-null `acceptedAt` selects the first delay in that
  same ladder at least as large as the elapsed time since acceptance, capped at six hours, and adds it to the current
  time. With a result read just after acceptance, polls land about 1, 6, 21 and 81 minutes after acceptance, then
  six hours apart. Exact equality still selects that rung. All other codes and unaccepted rows keep the claim-attempt
  ladder. Claims/`forceRetry`, operation identity and Pending terminal rules remain unchanged. Real Bank failures keep
  their existing backoff/counters; accepted-only waits use the separate non-failure settlement below.
  An outstanding retry suppresses overdue interval wakes. Manual action and verified catch-up may bypass backoff.
  Success clears consecutive failures and schedules the next ordinary interval from success. Only a full success
  advances the full-reconciliation interval. Manual mode schedules no background due or retry wake.
- A nonempty unresolved Bank becomes `mode: "waiting"` only when every row has accepted-write evidence, no diagnostic
  other than absent/`HINDSIGHT_PENDING_REMAINS`, and a compatible phase. Tracked `submitted` requires saved Native
  `pending`/`processing`/`partial`; legacy accepted `submitted` keeps its existing semantics. `awaiting_derived` and
  `awaiting_pull` require the saved receipt. Queued/unaccepted, failed, unknown, unavailable and other-diagnostic rows
  retain failure semantics. Do not infer a whole Bank's state from the recovery runner's first unresolved row.
- Waiting clears the run/error, releases its lease, and sets full reconciliation to `waiting` for a full run. It
  preserves actual prior failure counts, retry-attempt history, success/full-success timestamps and Native IDs.
  Automatic Banks reuse the earliest future row retry; absent/already-due retry metadata uses the existing first
  delay to avoid a tight loop. Manual-only Banks keep no automatic wake. `nextAction` tells the operator which applies.
  A normal wait produces no synchronization-failure warning. No payload loading, extra Native probe or timer is added.
- One asynchronous worker serves all configured Banks. A failure in one Bank does not discard another Bank's progress.
  Restart/reconnection performs one eligible catch-up; it does not replay every missed interval.
  Timer callbacks use the scheduler's construction async context, so foreground rearming cannot inherit a settled
  write owner; each new run still passes the current work fence and lease checks.
- Migration 051 stores exact manual request/claim/outcome evidence separately from latest Bank diagnostics. The
  operation owner supplies a pre-persisted request ID; queue admission, claim, cancel and settlement update that
  evidence in the existing schedule transaction. Terminal request records cannot be updated or deleted. A queued
  request can be cancelled while a previous run owns the Bank; wrong IDs and claimed requests refuse. Pre-051 records
  remain readable without fabricated IDs. Process-global supervisor errors cannot settle another Bank's request.
- Migration 063 extends the manual-request SQL CHECK and immutable-terminal trigger with `waiting`, preserving old
  rowids, IDs, states and JSON verbatim. Schedule/operation JSON needs no rewrite. A waiting request is terminal for
  this sync attempt, retains its claim and `settledAt`, has no error and records the automatic/manual next action.
  Later runs are independent and cannot rewrite it. This does not claim that the underlying Native write completed.
  Table replacement also preserves migration 057's populated `memory_transition_emergency_manual_quarantine`
  references and both transition/manual admission triggers; test the actual populated lineage and foreign keys.
- Claim, run state, lease owner/run/fence/expiry, and schedule version are checked transactionally. Settlement requires
  the same current run and lease plus a result matching the committed checkpoint. Configuration changes and manual
  requests arriving during a run remain intact; only claim consumes a queued request, and full requests are never
  downgraded to incremental. Reset after accepted journal pages captures the new predecessor before rebuilding.
- Stop/timeout retires the lease before aborting transport. An ignored abort or late callback cannot publish records
  or settle current status. Use the injected clock for due/expiry checks. Absolute `deadlineAt` is checked inside
  journal/snapshot transactions before writes and again before checkpoint publication; checking only after an awaited
  page returns is too late. A later failed page/reset leaves earlier complete pages committed.
- Capture the admitted Bank before HTTP work and carry it as `expectedBank`. Reject a projected Bank scope or
  Character binding that differs from admission before any write. Recheck `projection.bankScope()` inside publication
  even when the page contains no Bank object. With `expectedAuthority`, also check the current active provider/epoch/
  lineage before writes and checkpoint commit. Initial admission and outer checks do not cover asynchronous rebinding.
- A claim/database supervisor failure must not rearm a zero-delay loop. Use the existing one-minute first delay for
  automatic mode; manual mode requires another explicit action in that process. This supervisor pause is process-local
  because a failed database may not persist it. Retain a closed `lastError()` and never fabricate a durable attempt.
  `armTimer` is called from settle paths, so a failing status/`banks()` read there (for example a drifted connection)
  is recorded as `lastError()` and arms nothing; it never escapes as a rejection.
- `verifiedReconnect()` has exactly two callers (Stage 2c R7): a `connection.revalidate` whose runtime is already on
  the new fingerprint, and the Hindsight subsystem once per foreground capture that admitted and synced every routed
  Bank while some `automatic` Bank has `retryDueAt` set with an availability `errorCode`. The scheduler's own drain,
  scheduled runs and WS/browser events never call it. The subsystem caller catches (the Run continues); a throw in the
  revalidate caller fails that operation. Contract:
  [`memory-hindsight-lifecycle.md`](./memory-hindsight-lifecycle.md).
- Full reconciliation uses the provider's supported `page_size=1`. Verify complete metadata, manifest digest, page
  hashes, counts, unique logical identities, and the Bank record. Reuse a cached record only after validating both
  its schema and `canonicalPayloadHash({ contract: "taki-replica-snapshot-cache.v1", bankId, providerLineageId,
  bankGeneration, pageHash, record })`. A content-only checksum cannot detect a corrupted association with a new hash
  or lineage. Invalid or old-format cache evidence becomes an authenticated page read.
- Reconcile canonical JSON, hash, revision, operation, and derived FTS by logical kind/ID. A document sharing an ID with
  a Memory unit cannot remove that unit's FTS. FTS accepts malformed non-text IDs: remove invalid/orphan rows by a
  validated SQLite rowid rather than string-coercing their IDs. Record repair, FTS repair/removal, cache replacement/
  pruning, and checkpoint publication commit in one fenced transaction. Journal changes invalidate obsolete cache
  payloads immediately; the current verified manifest replaces old cache entries.
- Verified cache evidence can survive remote snapshot expiry and SQLite reopen. Cold, corrupt, or journal-updated
  entries without a current provider-page witness require downloading those pages, even if canonical rows already
  match. Strict selective transfer without this evidence cost is not provided by the existing API. Source:
  `H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py:118-150,227-235,300-314`.
- Preserve the 512 KiB HTTP response cap, including single-record manifests, and complete 10,000-record journal-page
  cap. Default execution/runner budget is 60 seconds, with a 61-second scheduler lease. Oversize, expiry, and deadline
  failures cannot publish a partial rebuild or skip a cursor.
- Status reports actual attempts, successes, checkpoints, full reconciliation, queued manual kind, due/retry state,
  and failures. Known lag requires matching observed lineage/generation and a valid cursor difference; otherwise it is
  null. Pending Memory has no producer in Wave 2 and its count must not be invented. Diagnostics use the closed
  `MemoryReplicaErrorCodeSchema`; raw exceptions, provider payloads, and credentials never enter status.
  The existing Core logger additionally records Bank/run identity and the known `MEMORY_AUTHORITY_FENCED` cause
  for refused scheduled work; logging failure cannot change the original run outcome.

### D108 policy review on the existing scheduler lifetime

`HindsightPolicySchedule` is an optional internal concern of the B5 scheduler, not another polling loop or an Agent
Scheduled Task. `armTimer` chooses the earliest replica, policy or retry wake; `drain` launches policy work after the
replica Bank loop without awaiting it. Stop/pause await both owned lanes; retirement aborts policy dispatch. Existing
sync settings, leases, manual requests and receipt semantics retain their meanings.

Policy obligations remain independently scheduled when replica automatic synchronization is disabled. A policy pass
uses the committed local replica and does not silently enable automatic pulls. Actual full/incremental application
COMMITs rearm the relevant Bank's threshold scan. Verified reconnect coalesces existing obligations; it never creates
another model pass for the same pending occurrence. Core activity only rearms paused obligations, and config changes
reconcile future schedules without erasing pending work. The existing bounded timer wake also observes User Timezone
changes; it does not acquire a new timezone authority.

The policy lane reuses the existing retry-delay ladder for provider failure, unfinished journal claims, failed-policy
revisions and temporary fences. All nonterminal saved work is counted even when it is not runnable yet. An empty
runnable page cannot complete an occurrence. Detailed persistence/eligibility/fencing contracts and the known
concurrent-use measurement boundary live in `hindsight-application-runtime.md` under D108.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Default Bank enumeration repeats or scope/Character binding changes | Preserve configuration; reject contradictory binding. |
| Expired/replaced lease, stale run, schedule CAS, or predecessor | Refuse stale publication/settlement; preserve current ownership. |
| Claim/database supervisor failure | Bound automatic wake; pause manual execution until explicit action; do not invent an attempt. |
| `armTimer` status read throws | Record `lastError()`, arm no wake, no escaped rejection. |
| Foreground success while no automatic Bank is in availability backoff, or a scheduled run succeeds | No `verifiedReconnect()` call. |
| HTTP response arrives after the absolute deadline | Reject inside publication; leave that page's records, FTS, cache, and checkpoint unchanged. |
| Authority or trusted Bank binding changes during HTTP work | Reject inside publication against captured identity/scope, including pages without a Bank object. |
| Cached payload or page-hash/lineage/generation association is corrupt | Cache miss and authenticated refetch; never trust a copied hash alone. |
| Canonical fields, FTS content, or FTS IDs diverge | Repair from a verified snapshot; preserve unrelated kinds and valid records. |
| Record/FTS/cache/checkpoint write fails | Roll back all writes in that publication together. |
| Cursor reset or provider generation/lineage changes | Verify a fresh snapshot and new replica epoch; retain Authority Epoch and B4 receipts. |
| Manual request/configuration arrives while a run settles | Preserve the new request/configuration; do not recreate disabled background retries. |

### 5. Good/Base/Bad Cases

- Good: warm-cache manifest after reopen downloads only changed/unverified record pages, repairs actual divergence,
  and publishes one consistent replica/FTS/cache/checkpoint while other Banks remain independently usable.
- Base: manual mode is intentionally stale until requested; a cold cache pays the documented first full-read cost.
- Bad: an opaque callback with no production client runner, overdue polling that defeats backoff, content-only cache
  integrity, string-coerced FTS cleanup, or a timeout checked only after the page was committed.

### 6. Tests Required

- Shared state/result/diagnostic consistency and unknown-versus-known lag; persistent configuration and truthful counts.
- D103: accepted-only versus mixed failure/unavailable/unaccepted/unknown; prior genuine failure counters; future-row
  early wake and manual-only behavior; exact terminal waiting request after reopen; operation-family release and boot
  observation; migration 063 byte-preserved history, queued uniqueness and immutable old/new terminal outcomes.
- File-backed claim/CAS/lease/reopen, queued requests, independent intervals, retry precedence, supervisor failure,
  disable/reconfigure during a run, bounded ignored-abort stop, and late completion after lease replacement.
- Actual injected-HTTP client tests for multi-page/two-Bank catch-up, partial-page reset success/failure, deadline and
  Bank-binding races, cache key/content tampering, reordering/reopen, malformed canonical/FTS repair, tombstones,
  missing/duplicate Bank identities, bounds, trusted projection refusal, and whole-publication rollback.
- Fresh, 033-to-034, and no-op reopen migration fixtures carrying valid Core-issued leases and checkpoints, with prior
  replica state still usable and authority unchanged.
- Focused/full TS tests, all downstream typechecks, root lint with protected-backup exclusion, task/context validation,
  untracked-file UTF-8/whitespace/header/index checks, and isolated Core startup after migration/import changes.
  Explicitly close SQLite inspection handles before Windows temp cleanup. Startup plus process termination does not
  prove graceful shutdown or real provider/Host acceptance.

### 7. Wrong vs Correct

Wrong: treat any `HINDSIGHT_PENDING_REMAINS` as success or waiting, or keep a manual request claimed until Native finishes.
Correct: classify the existing Bank-wide aggregate, end this attempt with its exact waiting evidence, and let the
ordinary Pending recovery continue under the original Native identity.

```ts
// Wrong: a late page may already have committed before this check.
await syncHindsightBankPage(input);
if (Date.now() >= Date.parse(deadlineAt)) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");

// Correct: carry admission constraints to the repository's transaction-local publication checks.
await syncHindsightBankPage({ ...input, deadlineAt, expectedBank: admittedBank, expectedAuthority: admittedAuthority });
```

## Scenario: Durable Pending Memory and Ordered Recovery

### Owner amendment: routine confirmation contract (G1 candidate, 2026-09-08)

The owner accepted G1's second option in
[the recovery design record](../../tasks/09-07-hindsight-recovery-evidence/grill.md). Routine recovery now targets
authenticated first pull, safe compatible replay, reliable native-result proof, then second pull/local application
through a matching checkpoint. That pending write may complete without waiting for observation or mental-model work.
Native acceptance alone, a request echo, a currently similar document or an arbitrary later checkpoint is insufficient;
the result and applied factual boundary must belong to the original operation and Bank lineage/generation.

Later derived changes still synchronize through the journal. Derived status is separate and must come from a real
producer or remain unknown. Initial activation and planned authority switching keep independent required-maintenance,
manifest/reconciliation and final-fence gates; zero pending writes does not satisfy them. Native failures/unknown
outcomes, idempotency, supersession, lease/deadline guards and checkpoint atomicity retain their existing obligations.

**Implementation boundary:** sections 1-7 below preserve the reviewed legacy protocol and its tests, including
`awaiting_derived`, the unavailable completion port and append refusal. They continue to govern old rows and old
builds. New explicitly tracked rows use [G1 native-result recovery](./memory-native-result-recovery.md). Its implementation has offline producer/consumer
evidence; independent review and the actual Rust dependency/build gate remain open. Neither protocol permits
silently promoting ambiguous rows. See the child task's `research/g1-validation-results.md` for current evidence.

### 1. Scope / Trigger

- Trigger: an authorized write must survive a Hindsight outage, or the existing replica worker recovers queued writes.
  Pending admission never selects Local authority, writes confirmed replica rows, or invokes generic Run Effect replay.
- These are implemented offline consumer mechanics. The supported Hindsight build has no operation-scoped derived
  fence, and append-specific recovery mapping remains unimplemented. B6 runtime composition and live/manual acceptance
  remain separate; injected completion evidence does not satisfy the missing provider contract.

### 2. Signatures

- Shared: `PendingMemoryIntentSchema`, `PendingMemoryStateSchema`, `PendingMemoryNativeReceiptSchema`,
  `MemoryDerivedCompletionRequestSchema`, `MemoryDerivedCompletionEvidenceSchema`, `PendingMemorySummarySchema`,
  and `PendingMemoryOverlayEntrySchema` are the validated contracts.
- `createPendingMemoryWriter(deps).enqueue(operation, call, bank)` captures authorized call identity and Bank binding.
- `createPendingMemoryRepo(db, now?)` exposes `enqueue(intent)`, `get(ref)`, `list(input)`, `summary(ref)`, `overlay(input)`,
  `claim({ record, guard, forceRetry? })`, `progress({ record, guard, change, checkpoint? })`, and `cancelQueued(ref)`.
  A guard is `{ lease: MemoryReplicaLease, deadlineAt: string }`.
- Migration 035 adds `pending_memory`, uniquely keyed by Authority epoch, Bank, and operation identity. Persisted
  sequence supports bounded ordered reads; state version/hash bind phase transitions to the observed row.
- `createHindsightPendingRecoveryRunner(deps)` implements the existing scheduler runner's `run`/`rebuild` interface.
  It reuses the replica runner, worker, lease and retry policy.
- `MemoryDerivedCompletionPort.check({ request, context })` returns validated `pending` or `completed` evidence.
  `unavailableHindsightDerivedCompletion` is the explicit refused implementation for the current supported provider.

### 3. Contracts

- New admission requires the active Hindsight epoch, verified checkpoint lineage/generation, trusted Bank scope and
  authorized canonical request. The writer preserves original provenance time for retain and captured operation time
  for mutations. Eligibility and trusted provenance remain the caller's responsibility; admission checks are not a
  replacement Write Gate or a license to invent policy bindings.
- Preserve immutable intent, intent hash, Bank/operation identity, deterministic native UUID, original timestamp,
  document identity, target revision, and normalized replay payload. Identical admission returns the original record;
  changed payload under the same identity is refused. A retry must not mint a new identity or rewrite its history.
- Persist `queued`, `submitted`, `awaiting_derived`, `awaiting_pull`, `completed`, `superseded`, `failed`,
  `outcome_unknown`, and `cancelled` distinctly. Native acceptance/completion, derived evidence and local reflection
  are separate durable facts. Known native success cannot become an unapplied failure, cancellation or unknown write.
- Claim/progress use synchronous SQLite transactions, observed version/intent-hash CAS, the current Bank lease and
  one absolute deadline. Recovery also carries captured Authority identity into the actual journal/snapshot
  transaction guards above. Neither a current-looking lease nor an outer callback check proves active Authority.
- Recovery order is authenticated lineage/Bank admission, complete first pull, retain-first compatible replay,
  operation-scoped derived checks, then second pull and local confirmation. A slow or failed row does not prevent
  independent rows from being submitted; Bank failures retain other Banks' progress. Unresolved pending/failed/unknown
  rows prevent an overall convergence claim even when individual rows or replica pages succeeded.
  With automatic scheduling, a retry requested for rows admitted after a run's final Pending summary survives that
  run's success; the earliest pending retry remains scheduled through the existing scheduler.
- In composed D77 recovery, each warm sync validates the live authenticated manifest against keyed admission evidence
  without repeating health/version probes. After the first successful pull, native-result support comes from that
  admitted evidence; a failed read throws instead of disabling support. Standalone legacy negotiation stays fresh.
- Queued mutations compare the current target and expected revision; stale/missing targets become `superseded`.
  Submitted lost-acknowledgement mutations first replay their identical frozen normalized body and native UUID to
  obtain the stored receipt. Do not supersede a previously applied operation merely because the target later changed
  or disappeared. Never force an overwrite, merge conflicts, or replace the expected revision with a newer value.
- Native retain UUIDs are not provider-payload-fingerprinted and terminal operation records can be pruned. Local
  immutable hashing is mandatory. A missing post-dispatch operation remains `outcome_unknown`; do not guess a remote
  retention interval or blindly submit again. A Bank generation replacement similarly distinguishes never-dispatched
  refusal from dispatched uncertainty; known native success retains its receipt and unresolved derived phase.
- Cursor reset/rebuild can re-enter a stage held by the identical scheduler lease. Resume that stage without another
  claim, attempt increment, or repeating completed native/derived work. A different lease still needs normal claim/CAS. One
  captured deadline spans both pulls and every reset/rebuild; reset does not grant a new execution budget.
- Derived evidence binds Authority epoch, provider lineage, Bank generation, native operation UUID and receipt hash,
  plus `throughCursor`. Only the matching locally applied checkpoint reaching that cursor permits `completed`.
  An unreachable/invalid cursor rejects that evidence while retaining native success and independent completed rows.
  An all-terminal/superseded pass still pulls again to capture concurrent authoritative changes.
- Native handler completion, extraction count, and Bank-wide queue emptiness do not prove derived completion.
  Current real-client composition retains `awaiting_derived` with `HINDSIGHT_DERIVED_FENCE_UNAVAILABLE`, without
  redispatching known successful writes. A future producer must durably link required derived work and its
  submission/failure/retry outcome to an observable journal boundary before replacing the unavailable port.
- Native Hindsight supports append, but this consumer cannot prove its combined-document/fact mapping. It refuses
  append before dispatch with `HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED`, preserves the original intent in a visible
  terminal failed row, and continues independent rows. Do not reinterpret append as replace or advertise it as ready.
- `overlay()` is separate from confirmed reads and returns literal `confirmed: false`, including unresolved unknown
  intents. It never mutates confirmed canonical rows or FTS. `summary()` counts actual persisted phases/receipts;
  surfaces without that producer must retain unknown telemetry rather than inventing zeros.
- Reject unsafe source envelopes/credential fields with closed diagnostics. Admission is limited to 512 KiB of
  serialized intent, persisted state to 2 MiB, and resolved retain results to 256 fact references. These are local
  consumer bounds; preserve the separate 512 KiB HTTP response and complete 10,000-record journal-page bounds.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Same identity with changed intent | `HINDSIGHT_PENDING_IDENTITY_CONFLICT`; preserve the original row. |
| Unsafe/oversized intent or contradictory Bank request | Closed admission refusal; no provider dispatch or confirmed-row write. |
| Stale row/version, replaced lease, expired deadline or changed Authority/scope | Refuse stale progress/publication inside its transaction; preserve prior complete pages. |
| Queued cancellation | Persist `cancelled` without dispatch; cancellation after possible dispatch cannot imply rollback. |
| Queued mutation target stale/missing | `superseded`; retain diagnostics and continue independent rows. |
| Submitted mutation target later changed | Use the original normalized request/UUID receipt path before deciding its outcome. |
| Post-dispatch native operation missing, or generation replaced without a receipt | Preserve `outcome_unknown`, original intent and UUID; no blind redispatch. |
| Native success but no derived fence | `awaiting_derived` plus `HINDSIGHT_DERIVED_FENCE_UNAVAILABLE`; preserve the native receipt. |
| Derived identity/hash/cursor invalid or second pull fails | Do not complete the row; retain native proof and independently completed work. |
| Reset resumes the same held lease/stage | Continue once without incrementing attempts or repeating native work. |
| Append recovery requested | Pre-dispatch `HINDSIGHT_PENDING_PAYLOAD_UNSUPPORTED`; visible retained intent, no endless row retry. |

### 5. Good/Base/Bad Cases

- Good: durable native receipt survives reopen; operation-bound injected evidence is validated, second pull reaches
  its cursor, and the row becomes completed without changing Authority or merging the unconfirmed overlay.
- Base: the current supported provider cannot supply the fence; the receipt remains awaiting-derived and recovery
  reports its incomplete requirement. A superseded row does not block another compatible write.
- Bad: claim success from a native `completed` response, retry a missing operation with a new UUID, overwrite a newer
  target, or commit a page after Authority changes and only then reject it in the outer runner.

### 6. Tests Required

- Shared/repository tests for identity/hash and phase consistency, bounded payloads, real summary counts, separate
  overlays, queue cancellation, version/lease CAS, rollback, and file-backed restart/reopen.
- Actual injected-HTTP client plus SQLite/scheduler tests for original timestamps/metadata, complete retain mapping,
  zero-result policy, append refusal, receipt-first mutation replay, pruned/missing operations, supersession,
  independent rows/Banks, unavailable/invalid derived evidence, and second-pull failure/restart.
- First/second-pull Authority/Bank races, snapshots with in-flight Authority changes, and transaction-injected changes
  must preserve canonical rows, FTS, cache and checkpoint together. Include journal pages without a Bank record.
- Both reset positions must retain one native dispatch, one derived check and one attempt; prove the captured
  deadline and Authority guard survive rebuild. Generation replacement after lost ACK must preserve unknown intent
  for retain and mutation. Late callbacks and ignored abort cannot publish or settle stale work.
- Fresh/034-to-035/no-op reopen preserve canonical records, checkpoints, leases and activation history. Run affected
  TS gates, untracked source audits and isolated native Node imports/startup after relevant changes; close all owned
  handles/processes/temp paths. Report unrun provider/Host/manual checks and unproven graceful shutdown separately.

### 7. Wrong vs Correct

```ts
// Wrong: native completion alone cannot authorize local recovery completion.
if (nativeOperation.status === "completed") {
  pending.progress({ record, guard, change: { kind: "confirm" }, checkpoint });
}

// Correct for the supported build: declare the missing producer contract explicitly.
const recovery = createHindsightPendingRecoveryRunner({
  ...deps,
  derivedCompletion: unavailableHindsightDerivedCompletion,
});
// Successful native receipts remain durable; the runner reports the missing fence instead of false convergence.
```
