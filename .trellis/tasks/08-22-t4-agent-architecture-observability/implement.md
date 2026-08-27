# Agent Harness Architecture and Observability Research-to-Implementation Plan

This plan remains non-executing for production code. The parent task is `in_progress` only so its architecture and
contract work can be advanced; a separate implementation child and explicit owner approval are still required before
any new Harness production source, Run/Event schema, or runtime behavior is added. Slice 0's staged synchronization of
the already committed main baseline does not grant that authorization.

## Current Implementation Status (2026-08-27)

The historical phase notes below describe how the architecture was reached; they are not the current production status.
The following children are implemented, checked, committed, and archived:

- Slice 1 Harness foundation;
- Slice 2 Durable Run Event Ledger and in-process live/replay anchor;
- Slice 3 Effect lifecycle and settlement;
- Slice 4 Recovery and admission hardening;
- Slice 5A Scheduled Task Provider, the first downstream T4 consumer.

The child `.trellis/tasks/08-27-observability-projection-ui/` is implemented, formally checked, and manually accepted
for primary chat/tool/Monitor correctness; it is pending documentation closeout and commit. Owner acceptance exposed
three reserved follow-ups: a reactive UI/streaming baseline, producer-first DSH observability expansion, and an
`avatar_set_expression`/ToolLoopAgent reproduction and contract investigation. Their planning evidence is recorded in
`research/post-acceptance-observability-followups-2026-08-27.md`, D67-D69, and the architecture roadmap. Heartbeat
remains downstream and unimplemented; its event-wake and evolvable Interaction Pattern decisions are recorded in
`docs/T4-HANDOFF.md`, `docs/ARCHITECTURE-ROADMAP.md`, `CONTEXT.md`, and
`.trellis/workspace/pleia/t4-heartbeat-engine.md`.

The parent remains open because the complete observability projection/product and later integration closure are not yet
delivered. A child count is not evidence that the parent architecture is complete.

## Stage 0 Current Readiness (2026-08-23)

The initial read-only comparison is recorded in `research/main-sync-2026-08-22.md`. Main `9895dd3` commits the
Hindsight initial-cutover work and migration `023`; that committed baseline is now staged in T4 through a
`--no-ff --no-commit` semantic merge. T4 HEAD remains `c652abb` until an authorized commit. No production Harness
implementation is authorized by this note.

The semantic synchronization of main `9895dd3` is now staged in T4 without a commit. The Slice 0 lineage and
full-quality gates are recorded as passed in `research/slice-0-semantic-sync-2026-08-23.md`; the first executable child
must still not reserve a migration number, copy dirty Hindsight files, or implement against a Hindsight-specific API.
It must begin only after the owner reviews and approves a separate Harness child boundary against `main.ts`, shared
exports, Memory composition, the migration registry, and the Phase B-D contracts.

## Architecture Phase A: Current-state audit — complete for planning (2026-08-23)

1. Verify the PI and DSH source reports against their cited files.
2. Map the live TakiAgent call graph from input/trigger through loop, persistence, effects, delivery, and logging.
3. Classify each state as authoritative, derived projection, in-memory control, or diagnostic output.
4. Record existing strengths, missing Harness boundaries, duplicate ownership risks, and cross-layer hotspots.

Exit evidence: `research/phase-a-current-state-audit.md`. The report confirms the current single `ToolLoopAgent`
loop, identifies the in-memory-only admission/cancellation boundaries, and names the missing durable Run/program-counter,
event-ledger, Context Manifest, effect-settlement, and recovery contracts. No production code was changed.

## Architecture Phase B: Harness contract — in progress (2026-08-23)

1. Define canonical Run/Operation/Attempt terms and their containment/lineage.
2. Define admission, queue/lane, cancellation, steering/follow-up reservation, deadline, and budget seams.
3. Define immutable effective snapshots and Context Manifest compatibility.
4. Define effect intent/settlement, safe/unsafe replay, stale completion, and terminal outcomes.
5. Prove that the existing AI SDK `ToolLoopAgent` remains the only low-level model loop.

Exit evidence: `research/phase-b-harness-contract.md`. This phase freezes semantic containment and authority without
creating a separate `operationId` implementation track; `Operation` is the runtime state-machine concept inside a Run
until an independent lifecycle is proven necessary.

## Architecture Phase C: Persistence and recovery design

Detailed planning record: `research/phase-c-persistence-recovery.md`.

1. Define the durable current program counter and append-only execution fact model.
2. Define atomic transition/settlement boundaries, event ordering, versioning, retention, and migration convergence.
3. Define crash-point behavior for provider, tool, approval, MCP, Host, persistence, and delivery effects.
4. Define orphan Run reconciliation, safe resume, explicit retry, wait, interruption, and `outcome_unknown` rules.
5. Define authoritative usage/effect records and their relation to Run/Attempt evidence.

## Architecture Phase D: Observability plane

Detailed planning record: `research/phase-d-observability-plane.md`.

1. Define a closed/versioned event vocabulary and fixed producer boundaries.
2. Define durable and live event planes, sequence/cursor semantics, bounded payloads, drop/lag policy, and observer failure isolation.
3. Define Run Receipt, developer trajectory, query, metrics, and optional telemetry projections.
4. Define mandatory redaction, retention, query authorization, local developer detail, operator detail, disabled mode,
   and explicit export policy.
5. Keep Pino as process diagnostics; it is not the canonical execution ledger.

## Architecture Phase E: Integration mapping

Detailed planning record: `research/phase-e-integration-map.md`.

1. Map the Harness contract to `chat-agent.ts`, `chat-send.ts`, queue/registry, Replay View, Memory, Host, Approval,
   Extension, Timeline, and Pino.
2. Assign one owner to each write path and lifecycle transition.
3. Define the additive chat turn-kind/autonomous adapter without implementing Scheduler or Heartbeat policy.
4. Define how Host/Extension/Memory generations enter the Run snapshot and how stale results settle.

## Architecture Phase F: T4 compatibility review

Detailed planning record: `research/phase-f-t4-compatibility.md`.

1. Define the provider-neutral Trigger Request shape and admission handoff.
2. Define which T4 concepts are reusable Harness contracts: Run/Attempt identity, provenance, Context Manifest,
   Receipt, non-primary turn semantics, and Child Run compatibility.
3. Explicitly leave cron/DST, Heartbeat eligibility/budgets, quiet hours, delivery policy, and Pet/Home behavior to T4.
4. Confirm Scheduled Task, Heartbeat, Webhook, system events, and Subagents all reuse one Runtime/Harness path.

## Architecture Phase G: Implementation slices and gates

Detailed planning record: `research/phase-g-slices-gates.md`.

1. Split production work into Harness state, event ledger/projections, Runtime adapter, recovery/admission, and later
   T4 consumer slices.
2. Curate child-task specs/research and prevent a first implementation batch from becoming the final architecture.
3. Define migration allocation, test matrix, boot proof, privacy checks, and full quality gates before implementation.
4. Update the roadmap and affected task artifacts whenever implementation evidence changes an assumption.

## Downstream T4 consumer work

These are not part of this architecture task by default. They consume the contracts produced above:

1. Scheduled Task provider and its `at`/`every`/`cron`, timezone/DST, catch-up, and Class A policies.
2. Heartbeat provider and its eligibility, Class B budgets, quiet hours, structural silence, and context policy.
3. Proactive delivery and D59/D61 client reliability convergence.
4. Child Run implementation, if not delivered as part of the Harness adapter slice.
5. Procedural Knowledge and Experience Review.

## Verification gates

- Unit tests for legal transitions, idempotent settlement, duplicate/late completions, immutable snapshots, event ordering, redaction, queue busy probes, and non-primary Memory behavior.
- Integration tests for Core boot/migrations, one trigger-to-run path, retry, cancellation, outcome_unknown, and receipt projection.
- Projection tests for category filters, readable summaries, detail access, disabled monitoring, retention, and no secret/raw payload leakage.
- Full repository checks only after implementation is approved: typecheck, lint, tests, build, Rust checks, and `git diff --check`.

## Explicitly deferred

- Reactive UI revalidation/streaming polish for Perception, Monitor, and Chat (D67).
- Producer-first DSH trajectory expansion for model/tool/usage/context/timing/governance/delivery facts (D68).
- `avatar_set_expression` versus generic ToolLoopAgent error/repair investigation (D69).
- Arbitrary third-party plugin marketplace semantics.
- Automatic Experience Review application.
- Fixed heartbeat interval as a core contract.
- A second Agent loop or direct PI/DSH runtime replacement.

The items above are implementation follow-up, not unresolved architecture direction. Any change to the adopted baseline
must update the roadmap, affected task artifacts, and compatibility evidence in one planning change before code work.
