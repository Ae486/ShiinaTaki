# Phase C - Persistence and Recovery Design

> Scope: durable Run current state, append-only execution evidence, effect settlement, and restart recovery. Exact
> SQL tables and migration numbers remain implementation-slice decisions after semantic main synchronization.

## 1. Authority Split

Phase C adopts PI's program-counter principle and DSH's immutable event-fact principle without making them competing
recovery models:

```text
Run current state / Operation program counter = next-action authority
Run Event Ledger                         = immutable evidence authority
Receipt / trajectory / metrics / Pino    = projections and diagnostics
```

Recovery reads the current Run state directly. It does not reconstruct state by folding an unbounded event stream. The
ledger is still required for audit, receipts, duplicate detection, and projection rebuilds.

## 2. Commit Boundary

Every legal lifecycle transition is committed by one Core transition service. Within the SQLite single-writer boundary,
the service atomically:

1. validates the expected Run state version and identity tuple;
2. updates the Run-owned current Operation state and Attempt settlement fields;
3. appends the corresponding immutable Run Event facts;
4. appends authoritative usage/effect settlement evidence when available;
5. publishes post-commit live notifications or schedules projections.

Observer failure cannot roll back a committed transition. Live delivery is post-commit and lossy; durable facts are not.

## 3. Event Ordering and Retention

The implementation must choose and document one monotonic sequence scope before migrations. The recommended first scope
is `runId + seq`, because a Receipt and recovery query are Run-oriented. A global database row id may assist storage but
must not replace the Run sequence used for deterministic projections.

Events are immutable and versioned. Payloads are bounded, redacted structured data with references to separately
authorized artifacts where necessary. Retention may delete old events only through an explicit policy that preserves
the Run terminal summary and Receipt link required for the configured history window.

## 4. Crash-Point Matrix

| Crash point | Recovery result | Automatic replay |
|---|---|---|
| Before intent commit | No effect was authorized; Run remains resumable/queued according to current state | Yes, create a fresh Attempt if deadline/policy permit |
| After provider/model intent, before response settlement | Provider may have received the request | Only provider-declared idempotent retry under captured snapshot; otherwise settle `outcome_unknown` or explicit retry decision |
| After safe read/tool intent, before settlement | Read-only effect may or may not have completed | Yes only when stored and current replay declarations both say `safe` |
| After unsafe Host/MCP/tool intent, before settlement | External side effect may have happened | Never silently replay; reconcile or settle `outcome_unknown` |
| After effect result, before Core commit | Effect result is known in memory but not durable | Reconcile via idempotency key/result reference; duplicate settlement is a no-op |
| After Core commit, before live notification | Run is durable | No replay of effect; notification backfill/cursor catches up |
| During projection update | Canonical facts are durable | Rebuild projection from facts; observer failure does not affect Run |
| During process shutdown/restart | Current state marks active/waiting/recovering work | Reconciliation worker applies the effect-specific policy |

`outcome_unknown` is a truthful terminal or pending-reconciliation outcome, not a generic failure bucket. A provider may
offer an explicit status query, but the Core must not claim success from an absent callback.

## 5. Orphan and Resume Policy

On boot, a recovery pass finds non-terminal Runs whose owner process generation is gone. It classifies them by the
current Operation phase and last intent marker:

- resume pure preparation/context work when the snapshot, deadline, and generations are still valid;
- create a new Attempt for a provider retry only when its policy explicitly permits it;
- wait for an approval/Host/provider reconciliation when the external system can answer status;
- settle `outcome_unknown` when an unsafe effect cannot be proven;
- settle cancelled/deadline-exceeded when the captured control or deadline won before a new effect could start.

The worker is idempotent, bounded, observable through the same Run/Event path, and never writes relationship Timeline
rows merely because a process restarted.

## 6. Idempotency and Late Results

The stable mutation guard is `(runId, attemptId, stateVersion, captured generation tuple)`. Every repository transition
must support expected-version checks and idempotent terminal settlement. A duplicate or late callback records evidence
with a stale/duplicate classification and leaves current state unchanged. It must not reopen a terminal Run, consume a
newer Attempt, or redirect to a replacement Host/Extension generation.

## 7. Usage and Effect Evidence

Usage is authoritative only when linked to the same Run/Attempt settlement as the model response or synthetic terminal
result. Detached calibration remains a separate consumer and cannot substitute for durable Run evidence. Effect records
must include the effect kind, bounded input identity/hash, replay declaration, captured generation, settlement state, and
idempotency key. Secrets, raw prompts, full tool bodies, and credential values are excluded by construction.

## 8. Phase C Exit Criteria

Phase C is complete when a later implementation task can point to:

1. one Run current-state authority and one append-only evidence authority;
2. a legal transition/versioning contract and atomic transition boundary;
3. a crash matrix covering provider, tool, approval, MCP, Host, persistence, and delivery effects;
4. orphan reconciliation, retry, wait, cancellation, deadline, and `outcome_unknown` rules;
5. migration-lineage, retention, redaction, and projection-rebuild constraints;
6. focused tests for duplicate/late callbacks and idempotent settlement.

Concrete table layout, migration allocation after main `9895dd3`, and recovery worker scheduling are deliberately
reserved for the first production child after semantic synchronization.
