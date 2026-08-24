# Slice 2 Durable Event Ledger Design

## 1. Boundary

Slice 2 adds the first durable execution evidence plane above the Slice 1 Run/Attempt aggregate. It does not turn the
ledger into a recovery engine, a user-facing monitor, or a second runtime authority.

```text
Trigger / chat admission
  -> RunRepo transition + RunEvent append (one SQLite transaction)
  -> committed Run/Attempt/Receipt state
  -> post-commit live bus (best effort)
  -> query / trajectory / projection-rebuild consumers
```

The mutable `runs` row still answers "what should recovery do next?". The append-only `run_events` table answers "what
durable execution facts were committed?". A projection may read either current state or replayed facts, but it cannot
write Run truth.

## 2. Event Contract

The shared event envelope is intentionally small and versioned:

```ts
type RunEvent = {
  eventId: string;
  runId: string;
  attemptId?: string;
  seq: number;                 // contiguous within runId
  schemaVersion: string;
  category: RunEventCategory;
  kind: RunEventKind;
  occurredAt: string;
  source: string;
  correlation?: { triggerRequestId?: string; taskId?: string; parentRunId?: string };
  payload: RunEventPayload; // closed discriminated union selected by kind
};
```

The first taxonomy and transition mapping are closed to lifecycle evidence:

| Transition | Ordered events in the same transaction |
|---|---|
| New admission | `run.admitted`, `attempt.prepared` |
| Idempotent admission reuse | none; return the existing Run/Attempt and ledger tail |
| Start prepared Attempt | `run.started`, `attempt.started` |
| Retry replacement | `attempt.settled` for the old Attempt, then `attempt.started` for the already-running replacement Attempt |
| Cancellation request | `run.cancel_requested` |
| Terminal settlement | `attempt.settled`, then `run.settled` |

Model/tool/Host/MCP/Approval categories are reserved and must not be emitted as fake placeholders in this slice.

Canonical payloads contain IDs, states, outcomes, bounded reason/error codes, snapshot references, attempt ordinals, and
counts. They do not contain prompt text, model completions, credentials, raw tool arguments/results, cwd/env,
sensor/media bytes, or arbitrary provider exception messages.

### 2.1 Observability layers and modes

The ledger is not the complete detail trace, and the detail trace is not the UI. Keep these layers separate:

| Layer | Contract | Default |
|---|---|---|
| Core Run Event Ledger | Always-on immutable execution facts used for Run correctness, Receipt, replay, and bounded diagnostics | Enabled |
| Developer Trace | Optional records from fixed Agent/Context/Model/Tool/Host/MCP/Memory/Approval/Delivery boundaries; may carry bounded content detail only under an explicit local developer mode | Disabled |
| Trajectory / Inspector projection | Human-readable category, phase, status, result, timing, counts, and error summaries, with a privileged structured detail view | No page; explicit enablement |
| External telemetry/export | Separate non-blocking adapter over authorized redacted projections | Disabled |

Use DSH's mode distinction as an adaptation, not as a second authority: `DISABLED` means no Developer Trace detail,
`FEEDBACK_ONLY` may retain bounded diagnostic summaries, and `FULL_LOCAL` may retain bounded content-bearing detail for
development. All modes still retain the canonical lifecycle ledger. Secrets, tokens, authorization material, and other
structurally forbidden values are excluded in every mode. The exact producer taxonomy is extended in later slices;
Slice 2 establishes the layering and presentation contract without pretending to implement all Agent behavior events.

The presentation projection also adapts DSH's `current`/`shadowed`/`log-only` surface classification. It keeps all
evidence queryable, but only `current` user-meaningful milestones become ordinary rows; superseded or internal facts are
collapsed or placed behind the developer inspector. Opaque IDs, hashes, digests, generations, and revisions remain
internal join fields unless an explicit developer action requests them.

## 3. Transaction and Sequence Authority

`RunRepo` remains the only writer for Run lifecycle state. Its transition helpers accept an injected event writer bound to
the same `Database` wrapper, or call a narrowly owned ledger helper inside the existing transaction. The writer:

1. reads the current maximum sequence for the Run inside the transaction;
2. assigns the next sequence and validates the event envelope;
3. inserts the immutable row with a unique `(run_id, seq)` constraint;
4. returns the committed event value to the transition boundary;
5. never publishes to live observers while the transaction is open.

Admission, start, retry, cancel request, and settlement each write state plus their event facts atomically. A duplicate
idempotent admission reuses the existing Run and does not append a second admission event. A stale/late callback leaves
current state unchanged; it may be represented by bounded in-memory diagnostics, but it must not manufacture a normal
RunEvent that looks like a successful current transition.

The migration number is assigned only after rechecking the current branch and synchronized `main` migration registry.
The expected implementation allocation is the next free version after Slice 1, but the number is not frozen in this
planning document.

## 4. Live Plane

The live bus is an in-process, post-commit observer facility. Slice 2 implements the per-Run contract and exposes:

- subscription filtered by `runId`;
- the last delivered cursor per subscriber;
- bounded queue capacity and an explicit overflow/lag signal;
- exact-once unsubscribe on connection close or owner disposal;
- observer error isolation.

Character-lineage aggregation is reserved for a later projection/query slice. It needs an explicit multi-Run cursor,
ordering, authorization, and backfill contract; it must not be approximated by merging independent per-Run sequence
spaces in this slice.

After a successful transaction, the transition boundary publishes the committed event batch. If a subscriber is slow,
disconnected, or throws, the Run remains correct. A consumer reconnects using the durable `(runId, seq)` cursor and
backfills missing events before accepting live events. Live delivery is never the source of truth and is not required for
receipt correctness.

No desktop monitor UI is added. A narrow Core query/replay seam may be exposed for tests and future projections, but the
wire surface must remain bounded, role-gated, and redacted. A future monitor must consume the presentation projection,
not dump database/event columns directly into cards or tables.

## 5. Replay and Projection Rebuild Anchor

The ledger exposes deterministic ordered reads by Run and sequence. A projection interface receives immutable events in
order and can be rebuilt from sequence zero or a validated cursor:

```ts
interface RunEventProjection<T> {
  initial(): T;
  apply(state: T, event: RunEvent): T;
}
```

The implementation must include a test projection that reconstructs lifecycle milestones/terminal summary and proves a
restart/replay yields the same result as the live path. This is an anchor for later Receipt/trajectory rebuild work, not
a second persisted Receipt authority and not a complete projection registry. The test projection should also exercise a
small human-facing summary mapper: readable labels and outcomes are retained, while opaque identity and version fields
are available only through an explicit inspector-shaped detail result.

## 6. Privacy and Failure Handling

Redaction happens at the event producer boundary. Schema validation and bounded field helpers run before the SQLite
write. A rejected event aborts the surrounding state transaction and is returned as a structured error; it does not
create a compensating `RunEvent`. Live consumers receive the same canonical redacted event object, never a privileged
raw input. If a later Developer Trace producer is enabled, it writes to its own bounded/detail plane and is still
subject to mode, role, retention, and mandatory secret exclusion; disabling that plane must not remove the ledger.

The ledger is fail-closed for correctness: a database write failure fails the transition and is reported as a structured
Core error. The live plane is fail-open for availability: observer failure, queue overflow, and temporary subscriber
absence do not affect the already committed Run.

## 7. Adopt / Adapt / Reject

| Reference | Decision | Application |
|---|---|---|
| PI | Adopt | Mutable program-counter authority, commit-before-effect discipline, typed lifecycle boundaries, observer isolation |
| DSH | Adapt | Append-only contiguous events, durable/live split, cursor/backfill, trajectory projection seam |
| DSH raw telemetry export | Reject as default | Mandatory local redaction and no raw prompts/secrets/sensor payloads |
| DSH `DISABLED`/`FEEDBACK_ONLY`/`FULL` modes | Adapt | Keep the ledger always-on; make Developer Trace detail local and explicitly mode-controlled |
| DSH `current`/`shadowed`/`log-only` surfaces | Adopt | Preserve evidence while collapsing superseded/internal facts from ordinary trajectory rows |
| DSH query filters and trajectory inspector | Adopt | Provide the future monitor with category/severity/Run/Attempt/tool/trigger filters and a readable detail projection |
| DSH Session/Task runtime model | Reject | Keep TakiAgent's Run/Attempt hierarchy and one Core runtime |
| Existing Timeline subscriptions | Adapt | Reuse the per-connection cleanup/fan-out pattern, but do not make Timeline the execution ledger |

## 8. Compatibility and Rollback

- Slice 1 databases remain readable; the migration is additive and fresh/historical lineage tests cover both new and
  existing tables.
- Existing Run queries continue to read current state; event queries are additive.
- If the live bus is disabled or unavailable, durable events and future backfill remain correct.
- If event integration fails during rollout, the transition transaction rolls back; no partial Run state is accepted.
- No down migration is required or assumed. Rollback is a code/version rollback against a database that contains an
  additive event table.

## 9. Reserved Future Seams

Slice 3 may add model/tool/Host/MCP/Approval effect events and authoritative usage settlement using the same envelope.
Slice 4 may add recovery/orphan events and reconciliation state. Later T4 providers may emit trigger provenance and
delivery events through this ledger without creating private histories or timer-specific event stores.
