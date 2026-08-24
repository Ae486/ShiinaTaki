# Slice 2 Durable Event Ledger

## Goal

Implement the Core-owned durable Run Event ledger, its redaction-safe observability contracts, post-commit live plane,
and projection rebuild anchor above the Slice 1 Run foundation; no full monitor UI or T4 provider policy.

## Requirements

- Add one provider-neutral, versioned `RunEvent` contract shared by Core and future projections. Each event carries a
  stable `eventId`, `runId`, optional `attemptId`, contiguous per-Run `seq`, event schema version, category/kind,
  timestamp, producer/source, bounded redaction-safe payload, and correlation references.
- Keep `Run.currentState` / `Operation` as the recovery authority. `RunEvent` is immutable evidence for audit,
  trajectory, Receipt validation, metrics, diagnostics, and later projection rebuild; no consumer may settle or reopen a
  Run from an event stream.
- Persist lifecycle evidence for the Slice 1 state-changing boundaries: new admission, Attempt preparation/start,
  retry replacement, cancellation request, and terminal settlement. An idempotent admission reuse returns the existing
  Run and ledger tail without appending a new event. Model/tool/Host/MCP/Approval effect events remain Slice 3 work.
- Allocate the next migration only after checking the current branch and synchronized `main` registry. The migration
  must add an append-only event table with a uniqueness constraint for `(run_id, seq)` and immutable identity fields.
- Write the Run state mutation, Attempt mutation, Receipt mutation where applicable, and corresponding durable events
  in the same short synchronous SQLite transaction. A failed event write must roll back the state transition.
- Add a post-commit live event plane with subscription, cursor/backfill, bounded observer queues, and failure isolation.
  Live delivery is best effort and never blocks or changes the committed Run outcome; missed events are recovered from
  the durable ledger.
- Add a deterministic replay/projection-rebuild seam that reads durable events in sequence order. It is an internal
  framework contract and test anchor, not a full monitor UI, export marketplace, or user-facing trajectory product.
- Keep three explicitly different observability layers:
  - the Core Run Event Ledger is always enabled and contains bounded lifecycle/effect facts needed for correctness,
    receipts, replay, and diagnostics;
  - the Developer Trace is an optional, local, mode-controlled detail plane fed by fixed Agent/Host/MCP/Memory/
    Approval/Delivery boundaries as those producers are implemented in later slices;
  - the human-facing trajectory/inspector is a role-gated presentation projection and is not a raw ledger viewer.
- The default mode has no monitor page and does not capture content-bearing Developer Trace detail. An explicit local
  developer mode may capture bounded prompt/context/tool detail for optimization, while secrets, tokens, authorization
  material, and other structurally forbidden values remain excluded. `FEEDBACK_ONLY`/`FULL_LOCAL`/`DISABLED`-style
  behavior may follow DSH, but execution facts remain correct when detail tracing is disabled.
- Redact before persistence and before live delivery. Canonical events must not contain prompt/completion text,
  credentials, raw tool/MCP/Host payloads, sensor/media bytes, or unbounded exception text by construction. Any
  content-bearing Developer Trace record is separate, bounded, explicitly mode-controlled, and authorization-aware.
- Human-facing projections must prefer readable category/phase/status/result/timing/count/error summaries. Opaque IDs,
  hashes, digests, generations, revisions, and internal correlation values are for joins or an explicit developer
  inspector, not ordinary list rows.
- Preserve the Slice 1 primary chat behavior, Run/Attempt identity hierarchy, idempotency, cancellation, immutable
  snapshot, Receipt semantics, and Character isolation.

## Acceptance Criteria

- [ ] Fresh and every known synchronized historical migration lineage converge to the event-ledger schema and reopen as
      a no-op.
- [ ] Shared/Core event schemas reject malformed, oversized, secret-bearing, or structurally inconsistent events.
- [ ] Every in-scope Run transition emits the expected event(s) exactly once in the same transaction as state changes;
      rollback leaves neither a partial state transition nor a partial event tail.
- [ ] Idempotent admission reuse returns the existing Run/Attempt and unchanged event tail; it cannot manufacture a
      second admission fact.
- [ ] `(runId, seq)` is contiguous and unique for committed events; duplicate append, stale version, and late callback
      paths cannot rewrite or reuse an existing sequence.
- [ ] Event rows are immutable after commit and queries return zod-validated, bounded data in deterministic order.
- [ ] Post-commit subscribers see only committed events; observer exceptions, slow consumers, disconnects, and queue
      overflow cannot fail or mutate the Run transition.
- [ ] Cursor/backfill and replay rebuild return the same ordered event set after a restart, with no duplicate live event
      required for correctness.
- [ ] Layering tests prove that the always-on ledger remains available when Developer Trace is disabled, while
      disabled/feedback-only/full-local detail modes have explicit capture and authorization behavior.
- [ ] Redaction/privacy tests prove that prompts, secrets, raw effect payloads, sensor/media content, and arbitrary
      provider exception text are absent from canonical durable/live event surfaces; any enabled detail record remains
      bounded and structurally excludes secrets and authorization material.
- [ ] Projection tests prove that ordinary trajectory rows show readable labels, category/phase/status, timing,
      outcome, counts, and bounded error summaries, while internal IDs/hashes/generations/revisions are omitted unless
      an explicit developer inspector is requested. DSH-like `current`/`shadowed`/`log-only` classification does not
      delete evidence or create duplicate ordinary rows.
- [ ] Existing Slice 1 focused tests, primary chat regressions, migration lineage tests, and Core boot remain green.
- [ ] No full monitor UI, third-party export, Scheduler/Heartbeat policy, effect-intent settlement, recovery worker,
      Child Run implementation, or second model loop is introduced.

## Definition of Done

- `prd.md`, `design.md`, `implement.md`, and curated context manifests are complete and validated before activation.
- Implementation and check evidence cover migration, transaction coupling, sequence integrity, redaction, live-plane
  isolation, replay, and Slice 1 regression behavior.
- Relevant backend indexes/specs and the parent roadmap are updated only where implementation evidence changes a
  contract; no first-batch label is treated as a final architecture.
- No commit, archive, or production implementation is implied by this planning artifact alone.

## Technical Approach

- Use one Core transition/event boundary above the existing `RunRepo`; do not add a second event authority or a separate
  Session/Task runtime.
- Use `runId + seq` as the deterministic event order for this slice. A physical SQLite row id may assist storage but is
  not the projection/replay cursor.
- Keep the durable ledger authoritative for execution evidence and the mutable Run row authoritative for recovery.
  Receipts, trajectory, metrics, and live notifications remain projections.
- Apply DSH's append-only event and durable/live split, adapted to TakiAgent's mandatory redaction and Core authority;
  apply PI's commit-before-effect and program-counter separation from the parent architecture contract.

## Out of Scope

- Full monitor/trajectory UI, third-party telemetry/export marketplace, or arbitrary plugin-defined Run truth.
- Model/tool/Host/MCP/Approval effect intent/settlement events and authoritative usage integration; reserved for Slice 3.
- Orphan recovery worker, durable queue reconciliation, deadline/budget enforcement, or automatic replay; reserved for
  Slice 4.
- Scheduled Task, Heartbeat, proactive delivery, Child Run execution, Procedural Knowledge, and Experience Review.
- Replacing `ToolLoopAgent`, Timeline/Replay authority, Memory authority, Approval authority, or Pino diagnostics.

## Technical Notes

- Parent Phase C: `../08-22-t4-agent-architecture-observability/research/phase-c-persistence-recovery.md`.
- Parent Phase D: `../08-22-t4-agent-architecture-observability/research/phase-d-observability-plane.md`.
- Parent Phase G: `../08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md`.
- Slice 1 implementation: `../archive/2026-08/08-23-slice-1-harness-foundation/` and `packages/core/src/db/run-repo.ts`.
- Cross-module baseline: `docs/ARCHITECTURE-ROADMAP.md` and `docs/T4-HANDOFF.md`.
- YCE is disabled. If an implementation detail is unknown, use one focused `jbcontext search` from this worktree,
  then direct reads and exact `rg` follow-up.
