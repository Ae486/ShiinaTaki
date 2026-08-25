# Slice 4 Recovery and Admission Hardening Design

## 1. Boundary and authority

Slice 4 adds a recovery/admission coordinator around the existing Core services. It does not replace `RunRepo`,
`EffectRepo`, the AI SDK `ToolLoopAgent`, Host/MCP/Approval/Memory authorities, or the Run Event ledger.

```text
Core boot
  -> durable Run/Effect scan + process-generation fence
  -> classify current Run/Attempt/Effect state
  -> reconcile through RunService/EffectLifecycleService CAS boundary
  -> expose durable queue/status
  -> admit new trigger requests
  -> existing lane queue + ToolLoopAgent
```

The mutable Run/Operation state remains the next-action authority. `run_effects` remains the subordinate uncertain-work
authority. RunEvents record recovery facts after the same transaction commits. Pino is diagnostic only.

The identity model remains `characterId -> runId -> attemptId`; `parentRunId` is reserved for later Child Runs. A queue
entry is the admitted Run itself, not a new `queueId`, and `Operation` remains Run-owned current state.

## 2. Boot and process-generation protocol

At boot, the composition root creates a new opaque process-generation token and passes it to the recovery coordinator.
The coordinator performs a bounded durable scan before the WS server accepts trigger dispatch. It does not trust an old
in-memory `TurnRegistry` or MCP generation to survive restart.

The scan is split into two phases:

1. **Classification transaction:** read non-terminal Runs, their active Attempts, unfinished Effects, deadlines,
   snapshots, replay posture, and captured generations; mark each Run `recovering` or a durable wait/reconciliation
   state with a closed reason code. This phase performs no unsafe external effect.
2. **Authority reconciliation:** invoke only bounded, explicitly registered status/replay adapters. Each adapter returns
   a closed result (`completed`, `failed`, `not_found`, `unknown`, `unavailable`, `not_authorized`) and cannot mutate
   Run truth directly. The coordinator applies the result through the existing CAS settlement API and appends typed
   recovery events post-transaction.

The pass is idempotent. Re-running it sees the same process-generation classification and terminal/blocked rows, and
does not create a new Attempt or duplicate terminal events. A bounded failure for one Run does not prevent unrelated
Runs from being classified, but a malformed database/event invariant fails closed for the Core boot.

## 3. Crash classification matrix

| Durable state at crash | Required Slice 4 action | Automatic replay |
|---|---|---|
| Run queued/prepared, no Effect intent | Validate snapshot, generations, deadline, budget; return to queue or settle skipped/deadline | Yes, new Attempt only if no effect started |
| Run cancel-requested, no Effect intent | Settle cancelled and drain queue reservation | No |
| Approval waiting with valid authority reference | Re-query the Approval authority; resume wait, settle denial/expiry, or promote only after final revalidation | No target effect during wait |
| Model/provider Effect intent without trusted completion | Use provider status/idempotency adapter only when declared safe/idempotent; otherwise reconcile/unknown | Explicit adapter only |
| Safe read/idempotent Effect intent | Recheck stored and current declarations, generation, deadline, and idempotency key | Yes, bounded and once per recovery decision |
| Unsafe Host/MCP/tool/Memory mutation intent | Preserve Effect identity, mark reconciliation-required or `outcome_unknown` | Never silently |
| Terminal Effect, non-terminal Run/Attempt | Apply the recorded terminal result through CAS; rebuild missing Run receipt/event only if invariant permits | No effect replay |
| Deadline or budget already expired before a new effect | Settle deadline-exceeded with no dispatch | No |

`outcome_unknown` is not rewritten to `failed` or `completed`. A provider status query that cannot prove the result
returns unknown. Recovery never redirects a captured Host/MCP/Extension generation to its replacement.

## 4. Durable queue and cancellation

The current `TurnQueue` remains the process-local serialization primitive. Slice 4 adds a Core-facing status/cancellation
adapter backed by the existing Run rows and event ledger:

- list queued/waiting/running/recovering Runs with bounded filters and cursor/age data;
- expose lane occupancy without exposing raw prompt or payload data;
- cancel queued Runs by `runId`/Character ownership through `RunService.requestCancel`;
- ensure `runQueued` checks durable state immediately before `start`, so a restart or cancellation cannot start stale
  work;
- retain the active AbortSignal for process-local interruption, while durable cancellation controls whether any new
  Effect may begin.

No queue scheduler, fairness policy, cron, Heartbeat cadence, or provider-specific admission policy is added here.

## 5. Deadline and budget enforcement

Admission validates absolute `deadlineAt` and bounded `budgetHint` into the immutable Run snapshot. A centralized guard is
called at queue admission, Attempt start, each Effect intent, and settlement. It returns a closed decision such as
`allowed`, `deadline_exceeded`, `budget_exceeded`, `cancel_requested`, or `stale`.

The guard uses persisted absolute timestamps and authoritative counters, not process timers as truth. Timers/AbortSignals
are acceleration only. A crash or clock delay cannot resurrect expired work. Budget semantics remain provider-neutral:
the Harness enforces captured limits and records bounded usage/reason codes; a Scheduled Task or Heartbeat provider owns
eligibility and requested budget policy.

## 6. Event and projection additions

Use the existing closed RunEvent vocabulary or an additive versioned extension for `recovery.*`, `queue.*`,
`cancellation.reconciled`, `deadline.*`, and `budget.*` facts. Each event carries only Run/Attempt/Effect references,
bounded status, reason/error code, replay posture, and counts. Recovery publication is post-commit and observer failure
cannot change truth.

The readable trajectory/Receipt projection shows semantic milestones such as recovering, waiting for authority
verification, safe retry, reconciliation required, cancelled, or deadline exceeded. Opaque IDs, hashes, generations,
and raw payloads remain inspector-only.

## 7. Adapter contracts

```ts
interface RecoveryCoordinator {
  scan(options?: { now?: string }): Promise<RecoveryReport>;
  reconcile(runId: string): Promise<RecoveryResult>;
}

interface EffectRecoveryAdapter {
  supports(effect: EffectLifecycle): boolean;
  classify(effect: EffectLifecycle, snapshot: RunSnapshot): Promise<RecoveryProbeResult>;
  replay?(effect: EffectLifecycle, snapshot: RunSnapshot): Promise<RecoveryProbeResult>;
}
```

Adapters are closed Core registrations, not arbitrary plugins that can write Run truth. A missing adapter means
`reconciliation_required`/`outcome_unknown` for an unfinished unsafe Effect. The adapter result is bounded and must
include the captured identity/generation evidence used by the coordinator's CAS settlement.

## 8. Transaction, migration, and rollback

Run state, Effect state, authoritative usage/receipt changes, and recovery RunEvents remain one short SQLite transaction
per legal transition. External status queries and replay calls occur outside the transaction. Live notifications happen
only after commit.

If a durable process-generation/recovery cursor or queue-index field is required, allocate an additive migration only
after comparing the current branch with synchronized `main`; fresh, historical, and reopen/no-op lineage tests are
mandatory. Code rollback must leave additive rows readable; no destructive down migration or event rewrite is assumed.

## 9. Failure and privacy rules

- A failed observer or telemetry projection never rolls back recovery truth.
- A malformed or secret-bearing recovery payload is rejected before durable insert.
- Raw prompts, tool arguments/results, provider bodies/errors, credentials, cwd/env, and media/sensor bytes never cross
  canonical Run/Effect/Event surfaces.
- Memory canonical receipts and Core Effect settlement remain separate transactions; Slice 4 reconciles the gap rather
  than claiming cross-repository atomicity.

## 10. Reference decisions

| Source | Use in Slice 4 |
|---|---|
| PI Harness | Adopt durable current program counter, process recovery, cancellation reconciliation, effect sandwich, safe/never replay, and bounded queues. |
| DSH | Adapt append-only categorized facts, durable/live split, trajectory/projection classification, and observer isolation. |
| OpenClaw/Hermes | Deferred trigger/provider behavior; no scheduler or Heartbeat policy in this slice. |
| Existing TakiAgent | Preserve Run/Attempt/Effect CAS, Host/MCP/Approval generation checks, Memory authority, Timeline separation, and one ToolLoopAgent. |

## 11. Reserved future seams

Scheduled Task and Heartbeat providers will later submit `TriggerRequest` through this admission/recovery path. Child Runs
will later use `parentRunId` and bounded context/result contracts. Monitor UI and external telemetry will consume the same
Run Event/projection query. None creates a private queue, recovery worker, event ledger, or model loop.
