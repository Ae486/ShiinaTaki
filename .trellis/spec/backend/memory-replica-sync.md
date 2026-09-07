# Canonical Memory Replica Synchronization

## Scenario: Canonical Memory Replica Journal Application

### 1. Scope / Trigger

- Trigger: B5 applies an admitted Hindsight journal after a verified Bank snapshot or rebuilds the local replica.
- Wave 1 exposes a one-Bank storage/client primitive. Wave 2 adds the scheduling/reconciliation contract below.
  Pending Memory recovery and runtime authority activation remain later work; offline fixtures do not prove them.

### 2. Signatures

- Shared contracts: `HindsightJournalPageSchema`, `MemoryReplicaJournalPageSchema`, `MemoryReplicaCheckpointSchema`,
  and `MemoryReplicaLeaseSchema`. Core wire normalization must return these validated contracts.
- Client: `changesAfter({ bankId, afterCursor, limit, context })`; `limit` is a soft provider page limit.
- Core repository: `seedVerifiedSnapshot(input)`, `applyPage({ page, expectedCheckpoint, lease, deadlineAt?, expectedBank? })`,
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
- B5 owns deterministic synchronization execution. Heartbeat owns wake/budget policy; B6 owns runtime provider,
  recall, and tool wiring. This service neither changes Memory Authority nor replays Pending Memory.
- A live run consumes a verified B4 checkpoint and trusted policy/provenance bindings. Offline fixtures and an
  isolated Core boot do not satisfy B4 current-Local coverage, its final fence, or live activation acceptance.

### 2. Signatures

- Shared: `MemoryReplicaScheduleConfigSchema`, `MemoryReplicaScheduledRunSchema`, `MemoryReplicaRunResultSchema`,
  `MemoryReplicaSyncStateSchema`, and `MemoryReplicaSyncStatusSchema`.
- A scheduled run binds `{ lease, kind, trigger, predecessor }`; a result binds `{ checkpoint, observedCursor }`.
  Bank identity is `{ bankId, scope, characterId }`, with a Character identity only for Character scope.
- `createHindsightReplicaSchedulerRepo(db, now)` exposes `ensureBank`, `requestManual`, `requestCatchUp`, `recover`,
  `claim`, `promoteToFull`, `succeed`, and `fail`. `ensureBank({ bank })` preserves existing configuration;
  an explicit `config` is required to change it.
- `createHindsightReplicaScheduler(input)` exposes non-blocking `start()`, bounded `stop()`, `tick()`,
  `requestManual(bankId, kind)`, `verifiedReconnect()`, `status()`, and the closed supervisor `lastError()`.
- `createHindsightReplicaSyncRunner(input)` implements real admitted-client `run`/`rebuild` paths.
  `syncHindsightBankPage` and repository snapshot/journal inputs accept optional internal `deadlineAt` and
  `expectedBank`; the scheduled runner always carries its captured deadline and admitted Bank through publication.
- Migration 034 owns `hindsight_replica_sync_schedule(bank_id, version, state_json)` and
  `hindsight_replica_sync_snapshot_cache`. Cache identity includes Bank, provider lineage, Bank generation, and
  provider page hash; rows also retain logical kind/ID, normalized record JSON, and a local integrity digest.

### 3. Contracts

- Ordinary polling defaults to six hours; full reconciliation defaults independently to seven days. Adapter bounds
  are one minute to 31 days and one minute to 90 days respectively; these are not provider API limits.
- Automatic retry delays are one minute, five minutes, fifteen minutes, one hour, then six hours repeatedly.
  An outstanding retry suppresses overdue interval wakes. Manual action and verified catch-up may bypass backoff.
  Success clears consecutive failures and schedules the next ordinary interval from success. Only a full success
  advances the full-reconciliation interval. Manual mode schedules no background due or retry wake.
- One asynchronous worker serves all configured Banks. A failure in one Bank does not discard another Bank's progress.
  Restart/reconnection performs one eligible catch-up; it does not replay every missed interval.
- Claim, run state, lease owner/run/fence/expiry, and schedule version are checked transactionally. Settlement requires
  the same current run and lease plus a result matching the committed checkpoint. Configuration changes and manual
  requests arriving during a run remain intact; only claim consumes a queued request, and full requests are never
  downgraded to incremental. Reset after accepted journal pages captures the new predecessor before rebuilding.
- Stop/timeout retires the lease before aborting transport. An ignored abort or late callback cannot publish records
  or settle current status. Use the injected clock for due/expiry checks. Absolute `deadlineAt` is checked inside
  journal/snapshot transactions before writes and again before checkpoint publication; checking only after an awaited
  page returns is too late. A later failed page/reset leaves earlier complete pages committed.
- Capture the admitted Bank before HTTP work and carry it as `expectedBank`. Reject a projected Bank scope or
  Character binding that differs from admission before any write. Initial admission and scheduler configuration
  checks alone do not cover projection changes during an asynchronous request.
- A claim/database supervisor failure must not rearm a zero-delay loop. Use the existing one-minute first delay for
  automatic mode; manual mode requires another explicit action in that process. This supervisor pause is process-local
  because a failed database may not persist it. Retain a closed `lastError()` and never fabricate a durable attempt.
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

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Default Bank enumeration repeats or scope/Character binding changes | Preserve configuration; reject contradictory binding. |
| Expired/replaced lease, stale run, schedule CAS, or predecessor | Refuse stale publication/settlement; preserve current ownership. |
| Claim/database supervisor failure | Bound automatic wake; pause manual execution until explicit action; do not invent an attempt. |
| HTTP response arrives after the absolute deadline | Reject inside publication; leave that page's records, FTS, cache, and checkpoint unchanged. |
| Projection changes a Bank binding during HTTP work | Reject against captured `expectedBank` before publication. |
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

```ts
// Wrong: a late page may already have committed before this check.
await syncHindsightBankPage(input);
if (Date.now() >= Date.parse(deadlineAt)) throw new Error("HINDSIGHT_DEADLINE_EXCEEDED");

// Correct: carry admission constraints to the repository's transaction-local publication checks.
await syncHindsightBankPage({ ...input, deadlineAt, expectedBank: admittedBank });
```
