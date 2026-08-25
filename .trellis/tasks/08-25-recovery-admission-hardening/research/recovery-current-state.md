# Slice 4 Current-State and Reference Synthesis

## Existing TakiAgent seams

- `packages/core/src/harness/run-service.ts:57-104` already owns admission, start, retry, settle, cancel, and
  process-local execution contexts, but it has no boot-time unfinished-Run scan or recovery coordinator. Its context
  map is empty after restart, so a recovered Run must reacquire context from its immutable snapshot rather than silently
  depending on an old closure.
- `packages/core/src/db/run-repo.ts:76-301` persists queued/running/waiting/recovering/cancel-requested/terminal Run
  states, Attempt versions, absolute deadlines, idempotency, receipts, and lifecycle events. Its `status`, `start`,
  `retry`, `settle`, and `cancel` methods are the CAS boundary to reuse. `start()` currently promotes queued work
  without a deadline/budget guard, and `cancel()` records `cancel_requested` without completing reconciliation.
- `packages/core/src/db/effect-repo.ts:51-152` persists one Run-owned Effect lifecycle, exposes `listUnfinished`, and
  rejects stale/duplicate settlement. Slice 3 deliberately leaves unfinished Effects for Slice 4. Effect settlement
  can therefore commit an Effect terminal state while the owning Run still needs a continuation/terminal repair.
- `packages/core/src/agents/turn-queue.ts:15-35` and `turn-registry.ts:16-34` are intentionally process-local
  mutex/AbortSignal controls. They have no peek, busy status, durable ownership, or queued cancellation and must not be
  promoted into a second authority.
- `packages/core/src/server/methods/chat-send.ts` admits before queueing, checks `RunService.start` after acquiring the
  Character lane, and carries mutable Attempt identity through overflow retry. Slice 4 must keep that flow intact while
  adding a durable pre-start cancellation/deadline guard.
- `packages/core/src/main.ts:101-110,274-451` composes all Core services and starts the WS server after wiring
  providers. Recovery must be composed from this root and complete its bounded classification before accepting new
  effect dispatch. Shutdown currently closes WS/MCP/DB but has no admission seal or accepted-work drain barrier.

## Parent architecture evidence

`phase-b-harness-contract.md` freezes the compact identity hierarchy (`characterId -> runId -> attemptId`), one Core
Admission service, Run-owned Operation state, durable cancellation, immutable snapshots, absolute deadline/budget, and
explicit safe/never replay. `phase-c-persistence-recovery.md` supplies the crash matrix and orphan policy. `phase-g-slices-gates.md`
explicitly assigns Slice 4 to queue status, cancellation reconciliation, orphan recovery, safe replay, unknown outcomes,
and deadline/budget enforcement.

## PI adoption

The local PI Harness research identifies the durable program counter, process restart recovery, durable abort/drained
queue records, intent-before-effect/settlement, `safe`/`never` replay, and idempotent unknown outcomes as the correct
architecture baseline. TakiAgent adopts these semantics around its existing ToolLoopAgent and Core Run/Effect stores;
it does not import PI's incomplete driver or create PI Session/Lane repositories.

## DSH adaptation

DSH contributes append-only categorized events, durable/live separation, observer isolation, trajectory surface
classification, and query filters. DSH Session/Task runtime and raw telemetry export are rejected as Slice 4 runtime
authorities. Recovery facts use the existing redacted Run Event plane and remain disabled from default user UI.

## Naming clarification

This task is **Architecture Slice 4: Recovery and Admission Hardening** from the parent
`.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md`. It must not be confused
with the downstream product roadmap's T4 “Slice 4 - delivery and reliability convergence” described in
`docs/T4-HANDOFF.md`. The latter consumes the shared Harness after recovery is durable; it is not part of this task.

## Risks and open decisions for implementation

1. Whether a persisted process-generation/recovery lease is needed depends on the supported multi-process deployment
   model; one Core writer may use a boot generation marker without a new queue identity.
2. Whether queue status needs a dedicated index or only existing Run indexes must be decided from query plans and tests.
3. Provider/model status probing is not universally available; the adapter must return unknown rather than claim failure.
4. Budget accounting needs a provider-neutral counter contract; token-specific policy remains outside this slice.
5. Memory receipt/Core Effect reconciliation crosses authorities and cannot be made atomic by this slice without a
   separate provider contract.

These are implementation decisions, not reasons to create parallel IDs or runtime pipelines.

## Bounded crash matrix for implementation

| Crash position | Durable evidence | Slice 4 classification |
|---|---|---|
| Before admission commit | No Run/effect | No recovery action; the same idempotency key may be retried. |
| Queued/prepared or waiting in the process-local queue | Run queued, Attempt prepared | List/reclaim once; enforce cancel/deadline before start. |
| Run started before first Effect intent | Run running, Attempt effect-running, no Effect row | Resume preparation only after snapshot/cancel/deadline/budget checks. |
| Effect intent without settlement | Non-terminal Effect with captured replay/generation evidence | Safe replay only when both stored and current contracts allow it; otherwise unknown/reconciliation-required. |
| Approval waiting | Effect waiting with canonical approval reference | Reconcile Approval authority; never infer target execution. |
| Effect terminal but Run non-terminal | Effect settled, Run/Attempt active | Repair/continue through Run CAS; never dispatch the same Effect again. |
| Cancel requested | Run cancel-requested with queued or active work | Start no new effects; drain queued work and reconcile already-intended effects. |
| Deadline/budget expired | Absolute deadline or exhausted counter | Durable deadline/budget settlement before any new dispatch; uncertain in-flight effects stay unknown. |
