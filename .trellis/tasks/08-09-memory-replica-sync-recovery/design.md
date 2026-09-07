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
missing targets `superseded` without blocking other rows; wait for the provider's derived-completion predicate; pull one
more journal page; then advance the normal checkpoint. Pending replay is explicit orchestration, not blind generic Effect
replay.

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
