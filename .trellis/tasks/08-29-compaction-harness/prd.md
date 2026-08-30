# Compaction Harness redesign

## Goal

Rework TakiAgent's context-compaction foundation so long conversational Runs are governed primarily by token pressure,
retain full timeline fidelity, and remain independent from any particular Memory Provider lifecycle. The implementation
must preserve Character-scoped companion continuity, the append-only user-facing timeline, provider-neutral model/tool
execution, and the existing Replay View contract while adapting the proven parts of DSH's compaction and token-meter
design.

The planning gate is complete. Slices 1-3 are implemented and formally checked; Slice 4 remains active. The
task artifacts remain the global contract and must be updated before a later slice changes pressure semantics, lifecycle
ownership, or reduction policy. A completed first slice is not treated as the final context architecture.

## Requirements

### 1. Establish the current truth

- Document the complete current data flow: timeline persistence -> Replay View selection -> summary substitution ->
  pressure folds -> token cut -> model request; and the background flush/summary path.
- Document all current configuration, trigger, retention, watermark, retry, and failure semantics, including the
  `REPLAY_WINDOW = 200` message-count backstop and where it currently acts before token selection.
- Document the actual startup composition for legacy Markdown, canonical Local, and future Hindsight modes. Compaction
  must not disappear merely because a Memory Provider changes or a legacy runtime is retired.
- Record current tests and known production evidence, including the observed stale `conversation_summary` boundary and
  long-history behavior.

### 2. Ground the redesign in DSH

- Read and cite the checked-in DSH compaction seam, `compaction-basic`, model-free tool-result pruner, token meter,
  lifecycle, and manual-command designs.
- Distinguish reusable general mechanisms from DSH-specific implementation details; no DSH code is copied into
  production and no second Runtime/Session authority is introduced.
- Verify which claims are directly evidenced in source and which are local adaptations or unresolved gaps.

### 3. Classify decisions

The design document must explicitly classify each major behavior as one of:

- **TakiAgent-specific**: Character isolation, companion/relationship continuity, global-vs-Character memory authority,
  projection-only summaries hidden from scroll-back, detached background work, and existing privacy/governance rules.
- **Proven general design to retain/adapt**: full-request token-pressure accounting, provider usage as a calibration
  anchor, deterministic Context Reduction before summarization, a separate utility summarizer, balanced
  tool-call/result cuts, append-only evidence plus a replay projection, cache-shaped summarizer requests, explicit
  overflow recovery, and quality/empty-result guards. DSH's tool-result pruner is one reducer reference, not the limit
  of TakiAgent's reduction scope.
- **Current defect or weak choice**: fixed message-count selection as the effective source boundary, compaction being
  constructed only inside the legacy Memory subsystem, absence of a durable compaction lifecycle/compare-and-swap
  contract, and insufficient complete projected-input pressure accounting.

### 4. Define the target architecture and migration slices

- Make token budget the primary context boundary. A message count may remain only as a bounded emergency/backstop
  against estimator failure and must never silently truncate ordinary long history.
- Separate Compaction/Replay infrastructure from Memory Provider lifecycle. Memory flush is an injected, narrow,
  optional side effect; compaction remains available in canonical Local and future Hindsight modes.
- Preserve one common Run/Turn/ToolLoop data flow. Compaction is a context-management operation, not a second agent
  loop or a second conversation authority.
- Define snapshot/revision, tool-pairing, concurrent-append, retry, cancellation, restart, and idempotency behavior.
- Define how summaries are stored, versioned, replaced, surfaced to the model, excluded from user scroll-back, and
  represented in Run Events/Monitor projections.
- Define model/provider routing for the Utility Slot and a provider-neutral usage/pressure contract, with explicit
  fallbacks when upstream usage is absent.
- Define normal compaction pressure as the complete projected next-request input crossing a TakiAgent-local threshold:
  `projectedInputTokens >= effectiveContextWindowTokens * 0.8`. The projection includes stable instructions, Character
  persona/soul prompt, Memory injection, tool/MCP schemas, the rolling summary, replay history, the current user message,
  and other request-local dynamic context. It is not `historyRatio * triggerRatio`, and cache-read tokens still consume
  context capacity.
- Define Context Reduction as a general projection pipeline rather than a tool-only optimization. Reducible candidates
  include old dialogue/summary material, Tool/MCP/search/file results, stale or repeated snapshots, reasoning, bounded
  media descriptions, and duplicate observations. Core governance instructions, Character identity, authoritative Memory,
  the current user message, and recent continuity-bearing dialogue are protected by policy.
- Preserve detached asynchronous behavior: the turn that observes pressure does not wait for model-backed compaction;
  deterministic reduction is measured first, a still-over-threshold view schedules rolling compaction, and only a
  durably committed replacement is visible to a later request.
- Split implementation into independently verifiable slices sized for approximately 2-3 context windows each, with
  later slices allowed to revise the plan when evidence changes.

### 5. Regression coverage required by the design

- Long history beyond 200 rows, tool-dense history, oversized tool results, CJK/multimodal content, and a single
  oversized message.
- Legacy, canonical Local, and provider-switch startup paths all retain compaction availability or fail explicitly;
  no silent lifecycle coupling.
- Concurrent append during summarization, restart/recovery, duplicate trigger, failed/empty summary, cancellation,
  provider overflow, and retry boundaries.
- Replay equality, balanced tool-call/result boundaries, timeline immutability, summary replacement accounting, and
  token-budget arithmetic.
- Full request-envelope accounting, the `0.8` trigger boundary, cache-read pressure semantics, deterministic reduction
  followed by remeasurement, and both tool and non-tool reducers.
- Existing normal chat, tool execution, Character isolation, memory authority, cache-prefix stability, and Monitor
  projections remain green.

## Confirmed Prior Decisions

The following decisions are already ratified elsewhere and are inputs to this task, not new choices to reopen:

- `characterId` remains the relationship and memory isolation boundary. Compaction does not create a user-visible
  session list or a second relationship timeline.
- The Timeline is append-only. A rolling summary is a model Replay View projection and never a Timeline row.
- Memory extraction/flush has priority over context retirement. Compaction is detached from the user turn and must not
  make normal chat wait.
- T5 R2 remains the compatibility baseline during this redesign: a provider context overflow recalibrates the effective
  window and retries only a clean, side-effect-free outer attempt; it does not silently become model-backed compaction.
  Any request-local overflow recovery must be separately proven and recorded before it can replace that behavior.
- The first implementation is a staged foundation, not a final architecture. Later slices may revise the plan when
  implementation or provider evidence changes the trade-off.
- Normal proactive compaction is triggered by complete projected input pressure at
  `effectiveContextWindowTokens * 0.8`. The existing effective-window calibration remains authoritative; the overflow
  recovery shrink to 90% is a post-overflow calibration/retry rule, not the proactive compaction trigger.
- Token component breakdowns remain useful diagnostics and reducer inputs, but they do not create separate budgets or
  multiply the trigger. Upstream `inputTokens`, when authoritative, calibrates the whole request envelope.
- Context Reduction is broader than tool-result pruning. The common order is measure -> deterministic reduction ->
  remeasure -> skip the auxiliary model if safe -> otherwise schedule detached rolling compaction -> use the committed
  summary on a later request.

## Planning Decision

The selected direction is a Core-owned Compaction Coordinator plus one pure token-first Context Projector and one
deterministic Context Reduction pipeline. The coordinator is constructed independently of Legacy/Canonical/Hindsight
Memory selection and receives a narrow optional Memory Flush port. DSH contributes token-meter, prune-first/remeasure,
balanced-range, lifecycle, revision, and progress-proof patterns; its Cordis plugin tree, char/4 estimator, coding-agent
prompt, raw-output persistence, and broad outer-loop retry are not copied. No new framework is required.

Only `characterId`, a compaction `operationId`, and optional originating `runId`/`attemptId` correlation are needed for
this operation. Revisions and sequence watermarks are versions, not additional session/task authorities.

## Acceptance Criteria

- [x] The current implementation and DSH reference are documented with verified source evidence.
- [x] Slice 1 removes the ordinary 200-row source cliff, keeps an explicit 10,000-row emergency backstop, and preserves
  balanced Replay View semantics.
- [x] Slice 2 makes Compaction Core-owned and available independently of Legacy/Canonical Local Memory composition,
  with one Utility Slot and explicit Memory Flush outcomes.
- [x] Slice 3 provides a durable per-Character operation lifecycle, lease, revision/CAS summary transaction,
  restart/cancellation reconciliation, and idempotent terminal evidence without becoming a second Run authority.
- [ ] Slice 4 implements complete projected-input pressure at the `0.8` threshold, general Context Reduction and
  remeasurement, summary-quality guards, retry/cooldown, and end-to-end regression coverage.
- [ ] Legacy, canonical Local, and Hindsight-compatible provider modes retain one compaction path; unsupported Memory
  flush behavior is explicit and cannot silently disable compaction.
- [ ] Parent D68 planning docs keep this task as the completed context-management gate before D68-B.

## Definition of Done

- Slices 1-4 are implemented, formally checked, and recorded in the task artifacts.
- Every numerical threshold or lifecycle claim has a cited source or is marked as a TakiAgent-local policy choice.
- Full-request pressure, Context Reduction, durable summary replacement, and provider-independent composition are
  proven without regressing normal chat, tools, Character isolation, Memory authority, cache stability, or Monitor facts.

## Out of Scope

- Replacing the Memory Provider, redesigning semantic memory extraction, or changing Character/Memory authority.
- Building D68-B Monitor UI, general Home refresh, or Chat streaming UI.
- Introducing a local KV cache, provider-specific production branches, fabricated cache metrics, or a second agent loop.
- Adding a user-facing manual compact command or enabling unsafe mid-ToolLoop model-backed recovery without proof that
  completed tool effects cannot be replayed.

## Technical Notes

- Current primary code: `packages/core/src/agents/conversation-store.ts`, `context-window.ts`, `replay-folds.ts`,
  `compaction-pass.ts`, `packages/core/src/memory/auto-memory.ts`, `bootstrap.ts`, `runtime-composition.ts`,
  `runtime-selector.ts`, and `packages/core/src/config/context-config.ts`.
- Prior T5 decisions: `.trellis/tasks/archive/2026-08/07-28-memory-context/batch-6-design.md`,
  `batch-7-design.md`, `research/re-compaction-prompts.md`, and `research/rb-projection-precedents.md`.
- DSH references: `references/deepseek-harness-master/packages/compaction/`,
  `packages/llm/token-meter/`, and `docs/agent-lifecycle.md`.
- Existing project constraints: `CONTEXT.md`, `docs/ARCHITECTURE-ROADMAP.md`, `docs/T4-HANDOFF.md`, and the backend
  Trellis specs. YCE is disabled; semantic code search uses `jbcontext`.

## Research References

- [`research/current-compaction-design.md`](research/current-compaction-design.md) — live TakiAgent implementation and
  evidence.
- [`research/dsh-compaction-design.md`](research/dsh-compaction-design.md) — DSH compaction/token-meter/lifecycle
  comparison.
