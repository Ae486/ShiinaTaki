# Slice 3 Effect Lifecycle and Settlement

## Goal

Integrate model, tool, Host, MCP, Approval, usage, and non-primary Memory side effects into the Core-owned
Run/Attempt/Event lifecycle established by Slices 1-2. The slice must make external-effect intent and settlement
durable, reject stale completion, and preserve truthful `outcome_unknown` behavior without adding a second model loop,
runtime, task authority, or recovery worker.

## What We Already Know

- `characterId -> runId -> attemptId` remains the compact project identity hierarchy. Character is the project-specific
  persona/Memory isolation boundary; correlation fields do not become new lifecycle authorities.
- Mutable Run/Attempt current state is the next-action and recovery authority. The immutable Run Event ledger is the
  execution-evidence authority. Receipt, trajectory, metrics, Developer Trace, and UI are projections.
- Slice 2 provides atomic lifecycle event commits, contiguous per-Run sequence, post-commit live delivery,
  cursor/backfill, and deterministic projection anchors.
- The existing AI SDK `ToolLoopAgent` remains the only model/tool loop. Slice 3 must wrap or adapt its real production
  seams instead of introducing a replacement loop.
- PI is the primary reference for runtime/harness structure, current-state authority, typed lifecycle, and
  commit-before-effect discipline. DSH is used for durable event/log/trajectory patterns rather than as a second
  runtime model.
- Slice 4 owns boot-time orphan recovery, automatic reconciliation, durable queue hardening, and deadline/budget
  enforcement. Slice 3 must persist enough truthful state and evidence for Slice 4 to act safely.
- YCE is disabled. Semantic code exploration uses `jbcontext`, followed by direct file reads and exact `rg` searches.

## Assumptions to Validate

- One provider-neutral effect record or subordinate Operation shape can cover model, tool, Host, MCP, Approval, usage,
  and Memory settlement without creating one authority/table per effect kind.
- Existing Host/MCP/Approval generation and idempotency identities can be captured as references rather than copied into
  an open-ended event payload.
- Usage can be committed authoritatively with the same Attempt/effect settlement that accepts the model response, while
  existing detached calibration remains a non-authoritative consumer.
- Non-primary Memory behavior can be expressed through the same Run/effect boundary without advancing conversational
  watermarks or writing fake relationship Timeline rows.

## Requirements (Evolving)

- Define one bounded, versioned, provider-neutral effect lifecycle contract with stable effect identity, owning
  `runId`/`attemptId`, effect kind, operation phase, replay declaration, captured generation/idempotency references,
  bounded input identity, timestamps, and settlement state.
- Persist intent before invoking an external or uncertain effect. Persist settlement after a result is accepted, in the
  same short synchronous transaction as the owning Run/Attempt current-state transition and canonical Run events.
- Integrate the real production model, tool, Host, MCP, Approval, usage, and non-primary Memory seams. Do not emit fake
  placeholder effects for a boundary that is not actually integrated.
- Reject stale, duplicate, late, wrong-Attempt, wrong-generation, or post-terminal completions without reopening or
  mutating the current Run. Retain bounded classified evidence where useful.
- Distinguish safe replay, idempotent retry, reconciliation-required, cancellation, failure, deadline, and
  `outcome_unknown`. Unsafe effects must never be silently replayed.
- Couple authoritative model usage to the accepted model/effect settlement. Detached calibration, logs, or live
  notifications cannot substitute for durable usage evidence.
- Preserve Approval as governance authority, Host as execution authority for Host-bound effects, Memory as its own data
  authority, and RunRepo/transition service as lifecycle authority.
- Redact and bound effect evidence before persistence/live delivery. Canonical facts must exclude prompts,
  completions, credentials, raw tool/MCP/Host bodies, sensor/media bytes, unrestricted exception messages, cwd, and env.
- Extend the existing readable trajectory/projection contract with effect milestones while keeping opaque IDs,
  generations, digests, hashes, and revisions behind an explicit developer inspector.
- Preserve primary chat behavior, full tool-call/result persistence, Approval behavior, Host/MCP routing, Memory
  authority, cancellation, overflow retry, Timeline/Replay, and Slice 1-2 Run/event semantics.

## Acceptance Criteria (Evolving)

- [ ] Every in-scope external/uncertain effect commits a durable intent before invocation and an authoritative
      settlement after an accepted completion.
- [ ] Intent, Run/Attempt current-state changes, settlement, usage, Receipt changes where applicable, and canonical
      RunEvents are transactionally consistent; a rejected write leaves no partial lifecycle state.
- [ ] Model response and usage acceptance are linked to the same Run/Attempt/effect settlement.
- [ ] Tool, Host, MCP, and Approval tests prove the captured owner/generation/idempotency tuple is checked at settlement.
- [ ] Duplicate, late, stale-generation, replaced-Attempt, and post-terminal callbacks are idempotent or classified as
      stale without mutating current truth.
- [ ] Unsafe effect interruption cannot be silently replayed and produces a truthful reconciliation-required or
      `outcome_unknown` state according to the frozen contract.
- [ ] Safe read/idempotent effect retry remains explicit and bounded; no generic blind retry path is introduced.
- [ ] Non-primary Memory effects do not create fake user/assistant Timeline rows, consume conversational-only state, or
      advance conversational Memory watermarks.
- [ ] Canonical durable/live/projection surfaces exclude structurally forbidden content and present readable effect
      summaries by default.
- [ ] Fresh and synchronized historical migration lineages converge and reopen as a no-op if Slice 3 needs additive
      schema changes.
- [ ] Shared/Core typechecks, focused and full tests, lint, migration lineage, real Core boot, and relevant process-level
      effect paths pass without regressing Slice 1-2 behavior.

## Expansion Sweep

### Future Evolution

- Preserve a stable seam for Slice 4 orphan reconciliation and later Scheduled Task, Heartbeat, delivery, and Child Run
  consumers without implementing their policy here.
- Keep effect kinds and adapters extensible through a closed Core registry/union rather than plugin-defined Run truth or
  one pipeline per provider.

### Related Scenarios

- Approval wait/resume, Host disconnect/generation replacement, MCP reload/lease retirement, cancellation, and model
  overflow retry must agree on one effect settlement vocabulary.
- Developer Trace and future trajectory UI should consume the same canonical effect milestones while content-bearing
  detail remains a separate opt-in plane.

### Failure and Edge Cases

- Crash after intent but before effect, after effect but before settlement, and after settlement but before live publish.
- Provider callbacks without idempotency/status-query support, Host disconnect during unsafe effect, stale Approval
  response, old catalog/generation response, partial usage, and Memory mutation with an uncertain acknowledgement.

## Out of Scope

- Boot-time orphan/reconciliation worker, automatic restart recovery, durable queue scheduling, deadline/budget
  enforcement, or provider-specific retry policy implementation (Slice 4).
- Scheduled Task, Heartbeat, webhook, proactive delivery, Child Run execution, procedural knowledge, or Experience
  Review product behavior (later consumers).
- A new model loop, DSH Session/Task runtime, generic plugin-defined lifecycle authority, full monitor UI, or external
  telemetry marketplace.
- Broad MCP/Skills UI cleanup or the D64 command-approval presentation debt unless the final Slice 3 boundary directly
  requires a narrowly scoped Approval presentation change.

## Research References

- Parent Phase C: `../08-22-t4-agent-architecture-observability/research/phase-c-persistence-recovery.md`.
- Parent Phase E: `../08-22-t4-agent-architecture-observability/research/phase-e-integration-map.md`.
- Parent Phase G: `../08-22-t4-agent-architecture-observability/research/phase-g-slices-gates.md`.
- Slice 2 contract: `../archive/2026-08/08-24-slice-2-durable-event-ledger/design.md`.
- Focused current-code and PI/DSH research is in progress and will be persisted under `research/` before convergence.

## Open Questions

- No owner preference question is currently blocking. Implementation-level choices will be derived from verified
  current code and reference designs, then presented for review if more than one materially different safe approach
  remains.

## Definition of Done

- Current-code and reference research is persisted with exact source evidence.
- PRD, design, implementation plan, context manifests, migration impact, failure matrix, and explicit Slice 4 seams are
  reviewed before activation.
- One implementation agent and one formal check agent are used at most if implementation is authorized.
- Relevant specs, roadmap, deferred decisions, and tests are updated only where implementation evidence changes a
  contract.
- No planning artifact is treated as implementation authorization or as the final immutable architecture.
