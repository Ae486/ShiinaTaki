# Memory Replica Synchronization and Recovery - Technical Design

## Boundaries

B5 consumes the B4 verified Hindsight epoch and provides ongoing replica synchronization, durable Pending Memory, and
recovery. It never changes the active authority, performs automatic Local takeover, or treats an expired remote snapshot
as invalidating a previously verified local replica. B4 remains responsible for initial current-Local coverage,
import completeness, activation receipts, and the final authority fence. B6 consumes the stable provider/coordinator and
replica contracts for runtime recall, tools, policy, and flush wiring.

## Canonical sync contract

Each Bank has an independent `ReplicaCheckpoint` containing provider lineage, Bank generation, last applied cursor,
replica epoch, manifest digest, and verification time. A sync run has its own run identity, owner lease, monotonically
increasing fence, predecessor cursor, target cursor, attempt state, and safe diagnostic. The scheduler may request a run,
but the run must acquire the lease and compare-and-swap the predecessor cursor before applying data. T4 Heartbeat owns
wake and budget policy; B5's scheduler owns only persisted sync due/retry execution.

The change source is an ordered journal of `upsert` and `tombstone` records for Bank, source/document, memory unit,
mental model, and directive objects. Every record carries object identity, authoritative revision, Bank generation,
provider lineage, cursor, batch identity/order, operation, bounded canonical payload (or tombstone), and timestamp. A
cursor reset, lineage mismatch, generation reset, or expired cursor requires a fresh logical snapshot and reconciliation;
skipping ahead is forbidden.

## Atomic application and reader

For one journal page, validate all records first, then use one SQLite transaction to upsert/tombstone canonical payload
rows, rebuild affected FTS rows with explicit column lists, and advance the checkpoint last. A failure exposes neither
partial rows nor an advanced cursor. The reader/projector returns the complete canonical record plus Taki policy fields,
filters invalidated/tombstoned records by default, and never returns raw provider payloads or credentials. The old
identity/revision/hash listing remains a diagnostic projection only.

Current checkpoints and immutable activation receipts are separate tables/concepts. Activation receipts prove a B4
promotion event and are never overwritten by routine sync. A verified local replica remains readable when a remote
snapshot expires; expiry only prevents using that snapshot for a new rebuild.

## Pending Memory and recovery

When Hindsight is unavailable, writes enter a durable Pending Memory row with idempotency key, Bank, operation kind,
sanitized payload, target identity, expected revision when applicable, original timestamp, retry state, and bounded
terminal diagnostics. Pending rows are an explicitly unconfirmed overlay and never mutate confirmed replica rows.

Recovery order is: authenticate and verify lineage/banks; pull journal pages after each checkpoint; transactionally apply
them; replay pending retains; replay edit/invalidate/restore only when `expectedRevision` still matches; mark stale or
missing targets `superseded` without blocking other rows; verify each actual native result; pull its committed factual
changes and confirm the write only after the matching local checkpoint proves application. Pull as many pages as
needed to reach that boundary. Pending replay is explicit orchestration, not blind generic Effect replay.

Owner amendment (2026-09-07): observation and mental-model maintenance may continue after routine write confirmation.
Their later writes synchronize through the existing journal; progress uses real evidence or remains unknown. Do not
equate zero Pending Memory with current derived summaries or a passed authority-cutover gate. The stronger B4 and
planned switch-back requirements remain independent. Existing code still uses the earlier derived-wait sequence.

## Scheduler and lease

Automatic sync defaults to the approved six-hour interval and persists next due/retry state. One single-flight worker
serves automatic and manual requests. Lease expiry makes a run retryable; an owner/fence mismatch refuses the write.
Manual failure does not silently arm background retries. Full logical reconciliation remains separately scheduled (the
approved seven-day default), compares complete identity/revision/lifecycle/integrity manifests, and repairs only
divergent records.

## Effect/result prerequisite

Before the first replica slice, fix the shared provider result contract and governed-tool projection in a bounded
prerequisite change. Retain must represent pending receipt, valid zero-result completion when policy allows, and
superseded/unknown/cancelled terminal states; mutation must represent `applied`, `unchanged`, `superseded`, and
`not_found`; two-bank retain must expose per-bank progress and partial failure. `MEMORY_OUTCOME_UNKNOWN` and
`MEMORY_OPERATION_CANCELLED` are read from `error.code` and preserve their canonical disposition. Add focused schema,
coordinator, and tool regression tests before B5 sync code depends on these states.

## Offline proof and remaining gate

Offline tests can prove transaction atomicity, CAS fencing, restart persistence, safe full-record reads, pending replay
ordering, supersession, cursor reset recovery, and deterministic scheduler leases. They cannot prove a real Hindsight
service, live derived maintenance, current Local coverage, or authority activation. B4's current-Local manifest/final
fence and the owner-approved live activation gate remain mandatory.

## Verified Wave 3 baseline and revised follow-up (2026-09-07)

Read-only inspection of the supported Hindsight checkout at `7eca2056` found a required contract gap: native retain
completion reports extraction outcome, and conditional mutations persist their receipt before post-commit derived
submission. The public response does not supply operation-scoped derived task identities or a completion fence;
enqueue failures can be logged without changing the native receipt. Neither a completed native operation nor an
empty Bank queue proves derived completion. This blocked the earlier routine guarantee before the owner's amendment;
it does not automatically block the new factual-write confirmation condition. Source anchors are
`hindsight-api-slim/hindsight_api/api/http.py:3346` and
`hindsight-api-slim/hindsight_api/engine/memory_engine.py:2962`, `:8599`, `:9033`, and `:9076` in `H:/hindsight`.

The reviewed, pre-amendment offline implementation requires explicit derived evidence and fails closed with
`HINDSIGHT_DERIVED_FENCE_UNAVAILABLE` on the current real-client path. Persist known native acceptance/completion
separately from awaiting-derived and local replica completion. A restart must not redispatch a known successful write
because derived evidence is missing. Injected evidence can prove the ordering machinery, but cannot satisfy this
provider dependency or full Wave 3 acceptance.

Native Hindsight supports append, but this implementation has not established a safe append-specific result mapping;
the replace-source proof must not be reused. Refuse unsupported append before dispatch, preserve its original intent
and diagnostic, and continue independent rows. This is an unresolved recovery requirement, not an upstream absence of
append. Similarly, a missing native operation after dispatch may mean its terminal row was pruned; preserve
`outcome_unknown` instead of assuming no write occurred and blindly retrying.

The selected follow-up must prove the native write result and its committed factual boundary, adapt durable recovery
transitions to the approved condition and close safe append mapping. Reuse supported APIs and extension facilities
before adding native transaction hooks. Keep a separate source-backed completion gate for authority cutover; routine
confirmation no longer requires tracking the full operation-scoped derived chain or changing automatic model-refresh
timing. Public contract, compatibility and transport/restart tests must pass before the new behavior is advertised.
Version/transition handling must preserve existing receipts, identities and unknown outcomes. B5 remains in progress;
the design amendment is not implementation or manual acceptance.
