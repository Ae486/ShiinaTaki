# Agent Harness Architecture and Observability Research

## Goal

Prepare an owner-reviewable architecture baseline for the TakiAgent Agent Runtime/Harness and its developer/operator
observability plane. PI is the primary reference for Runtime/Harness architecture; DSH is the primary reference for
execution events, logs, trajectories, and monitoring projections. T4 autonomous providers are downstream consumers of
the resulting contracts, not the default scope of this task.

## Requirements

- Maintain the formal Trellis parent task in contract-planning mode. The task may be `in_progress` while architecture
  phases advance, but production implementation remains disabled until a separately selected child and explicit owner
  approval.
- Research `references/pi-main` for the high-level Agent Harness architecture: loop versus harness boundaries, session/operation/run state, lanes, steering/follow-up/abort, context transformation, compaction, durable resume, typed events/hooks, and telemetry.
- Research `references/deepseek-harness-master` for transparent, low-overhead observability: append-only event production, event categories, tool lifecycle boundaries, persistence, telemetry projection, and human-readable trajectory inspection.
- Evaluate the current TakiAgent architecture using live repository evidence, especially Core composition, chat runtime, turn serialization/cancellation, context replay, extension snapshots, timeline persistence, and Pino logging.
- Preserve the product boundary that heartbeat is one extensible trigger provider, not a hard-coded timer or transport keepalive. Future providers may include cron, at, every, external events, memory commitments, activity signals, or composed conditions.
- Preserve the logging boundary that observability is fixed framework code, can be enabled in development and toggled by users, records the complete execution lifecycle, is categorized/filterable and rendered through readable projections, and does not consume Agent tools, tokens, context, or steps.
- Produce explicit architecture phases: current-state audit, Harness contract, persistence/recovery, observability plane,
  integration mapping, T4 compatibility review, and implementation gates.
- Explicitly separate current-task architecture contracts from downstream T4 product policy and deferred implementation work.

## Acceptance Criteria

- [ ] `research/pi-harness.md` contains source-backed PI findings with file/line references and an adopt/adapt/reject matrix.
- [ ] `research/dsh-observability.md` contains source-backed DSH findings with file/line references and an adopt/adapt/reject matrix.
- [ ] `research/takiagent-architecture.md` records the current runtime call graph, ownership boundaries, strengths, gaps, and recommended seams.
- [ ] `design.md` defines the proposed trigger → run → attempt → agent runtime → delivery → event ledger flow and its invariants without committing to a single heartbeat mechanism.
- [ ] `implement.md` describes a staged implementation plan, verification gates, and explicit out-of-scope items; it does not authorize production implementation by itself.
- [ ] `implement.jsonl` and `check.jsonl` are ready for a later implementation/check phase with relevant specs and research files.
- [ ] No new Harness production behavior, Run/Event schema, runtime configuration, or user-facing behavior is added by
  this planning task. Slice 0 may stage an owner-authorized semantic synchronization of an already committed main
  baseline, but that synchronization is not implementation authorization.

## Definition of Done

- Research artifacts are persisted under this task directory.
- The owner receives a concise Chinese summary of the architecture boundary, technical recommendations, risks, and the next approval gate.
- The parent remains in contract-planning mode until the architecture phases and gates are reviewed. Entering production
  implementation requires a separately selected child task and explicit owner approval; changing the parent status alone
  is not implementation authorization.

## Out of Scope

- Implementing Autonomous Run, Scheduled Task, Heartbeat, delivery, or observability production code.
- Implementing the full T4 product program merely because its consumers are used as compatibility examples.
- Choosing a fixed heartbeat interval or baking cron into the runtime core.
- Replacing AI SDK `ToolLoopAgent` or copying PI/DSH wholesale.
- Exposing secrets, raw prompts, raw tool payloads, or unfiltered JSON directly to end users.
- Adding a second approval system, second timeline authority, or a separate autonomous chat loop.

## Current Task / T4 Boundary

The current task owns reusable Harness and observability contracts: admission, Run/Operation/Attempt lifecycle,
immutable snapshots, effect settlement, recovery policy, typed execution events, projections, redaction, and integration
seams. T4 owns provider-specific scheduling, Heartbeat eligibility/budgets, proactive delivery policy, and product UI.

T4 material is included only when it constrains a reusable contract. For example, `runId`, `attemptId`, trigger
provenance, Child Run lineage, Context Manifest, Run Receipt, and non-primary turn semantics are compatibility inputs.
Cron/DST rules, Heartbeat cadence, quiet hours, Class A/B policy, and Pet/Home product behavior remain downstream T4
decisions.

## Technical Notes

- Authoritative product boundary: [`docs/T4-HANDOFF.md`](../../../docs/T4-HANDOFF.md).
- Cross-module architecture baseline and stage dependencies: [`docs/ARCHITECTURE-ROADMAP.md`](../../../docs/ARCHITECTURE-ROADMAP.md).
- The roadmap records the adopted PI/DSH/OpenClaw/Hermes patterns and implementation follow-up; it does not replace
  the handoff's frozen product contracts or the task's executable planning artifacts.
- Existing runtime anchors: `packages/core/src/main.ts`, `packages/core/src/agents/chat-agent.ts`, `packages/core/src/server/methods/chat-send.ts`, `packages/core/src/agents/turn-queue.ts`, `packages/core/src/agents/turn-registry.ts`, `packages/core/src/agents/conversation-store.ts`, `packages/core/src/db/timeline-repo.ts`, and `packages/core/src/logging/logger.ts`.
- Reference sources: `references/pi-main` and `references/deepseek-harness-master`.
