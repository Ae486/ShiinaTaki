# Slice 3 Effect Lifecycle and Settlement Implementation Plan

This plan is executable only after the Slice 3 child remains in planning, the research/design artifacts are reviewed,
and the task is explicitly activated. It authorizes no production implementation by itself.

## 0. Execution Split and Compact-Resistant Handoff

Slice 3 remains one architecture theme, but it is implemented as three sequential batches. This split is authoritative
for implementation dispatch, check dispatch, commit/archive claims, and session recovery after context compaction.

```text
Slice 3A: Effect foundation + per-provider model middleware + authoritative usage
Slice 3B: Governed Tool + Approval wait + Host + MCP execution chain
Slice 3C: Explicit Memory effects + cross-boundary/process acceptance
```

The batches reuse this task's PRD/design/research and the same Effect contracts. Do not duplicate the parent research or
create one task per identifier/subsystem. Each implementation batch targets approximately two to three agent context
windows and keeps highly coupled call-chain work together.

Current execution status: Slice 3A is committed as `e55a8dc`, Slice 3B as `36a3596`, and Slice 3C has passed the final
whole-Slice formal check. The next action is the explicit 3C batch commit; after that the parent task may be archived and
Slice 4 planning may begin. Do not enter Slice 4 implementation from this task.

### Slice 3A - Effect Foundation, Model, and Usage

Owns:

- Shared bounded/versioned Effect and Usage contracts plus backward-compatible RunEvent extensions.
- Additive `run_effects`/`run_usage` persistence, migration lineage, typed repository, CAS, duplicate/stale handling,
  redaction, post-commit event publication, and unfinished-effect reads needed by later recovery.
- One Core `EffectLifecycleService` boundary.
- Installed AI SDK 7 `wrapLanguageModel`/`LanguageModelMiddleware` integration for every actual internal
  `doStream`/`doGenerate` provider request made by ToolLoopAgent.
- Authoritative per-request usage with `reported | estimated | unknown` quality.
- Truthful Model abort/error/unknown semantics; preservation of streaming, primary Timeline persistence,
  cancel/retract, partial output, non-primary behavior, and the existing clean context-overflow retry.
- Model Effect linkage to the current Run and model Attempt. Any Run/Attempt transaction limitation must be explicit and
  must not be represented as completed atomic coupling.

Does not own Tool/Approval/Host/MCP/Memory production adapters. A 3A check must not demand those later adapters and a 3A
completion must not be described as complete Slice 3.

### Slice 3B - Governed External Effects

Owns one coupled execution chain:

```text
AI SDK tool call -> canonical governance -> Approval wait -> final revalidation
                 -> Core/Host/MCP target dispatch -> Effect settlement
```

- One logical Tool Effect; do not double-record Tool plus Host/MCP as independent Core effects for the same operation.
- Durable Approval waiting/denied/expired/cancelled/invalidated references. A wait result never proves target execution.
- Target intent only after Approval and final policy/generation validation.
- Thread enclosing `(runId, attemptId, effectId)` through Host routing while preserving Host-local operation/attempt
  identity, generation, deadline, idempotency, duplicate/late, cooperative cancel, and unsafe `OUTCOME_UNKNOWN` rules.
- MCP outer governed generation/lease boundary, draining/forced-close uncertainty, and no generation redirect/replay.
- Parallel-tool settlement and existing AI SDK tool-result ordering regressions.

Host dispatch uses a required two-phase boundary; no ordering exception is accepted:

```text
Core -> Host preflight (classify only; never execute)
  deny -> settle without target intent
  ask  -> durable Approval wait -> final Core revalidation
  auto -> final Core revalidation
Core commits target Effect intent
Core -> Host explicit execute/resume
Host final lineage/classification validation -> handler -> terminal response
```

The preflight response is bounded authority evidence, not a second Effect or a grant. Core correlation
`(runId, modelAttemptId, effectId)` remains separate from Host-local operation/execution-attempt identity. Existing
challenge/resume authorization, generation retirement, terminal cache, cooperative cancellation, and unsafe unknown
outcome behavior must be adapted rather than replaced.

3B reuses 3A contracts/repository/service and the parent research. Its additional context is limited to governed-tool,
Approval, Host broker/routing, MCP generation/lease, and their tests.

### Slice 3C - Memory and Integration Closure

Owns:

- Explicit Memory tool Effects linked to stable request/effect identity, authority epoch, provider/capability snapshot,
  and exact idempotency behavior.
- Recall safe posture under the same captured authority; writes default `never` unless exact provider idempotency is
  proven with the same request identity.
- Preservation of primary detached AutoMemory/image behavior and every non-primary no-fake-Timeline,
  no-costume-consumption, and no-conversational-watermark invariant.
- Final cross-boundary Model/Tool/Approval/Host/MCP/Memory process tests, projection/readability closure, and complete
  Slice 3 acceptance review.

3C does not implement Slice 4 orphan scanning, automatic safe replay, durable queue/deadline/budget enforcement,
Scheduler, Heartbeat, Child Run, monitor UI, or external telemetry.

3C uses the existing marker-selected `MemoryCoordinator` and canonical Local receipt authority. It adds only the
Effect-aware adapter and integration tests. The provider receipt transaction remains separate from the Core Effect
transaction, and detached primary AutoMemory/image hooks remain outside Effect settlement.

### Dispatch and Completion Rules

- At most one implementation agent and one formal check agent per batch. Reuse the existing implementation agent for
  sequential follow-ups while its context is healthy; do not create parallel replacement implementers.
- Every implementation prompt names the exact batch and includes an acceptance matrix. The agent may report
  `COMPLETED` only when every item in that batch is implemented and verified.
- If a batch is incomplete, do not dispatch its formal check. Resume the same implementation agent or explicitly revise
  the batch plan first.
- Each formal check reviews only its batch plus regression effects on earlier batches. Passing 3A or 3B never implies
  complete Slice 3.
- Commit and archive records must name the batch. The parent Slice 3 may close only after the 3C integration review.
- After context compaction or session resume, read this section, `research/implementation-evidence.md`, Git status, and
  the latest batch-specific agent report before taking any action. Do not reconstruct progress from chat memory alone.

## 1. Preparation

1. Verify `H:/TakiAgent-worktrees/t4`, branch, active task, parent task, current HEAD, dirty paths, and migration
   registry. Do not touch `H:/TakiAgent` or `H:/hindsight`.
2. Read the Slice 3 PRD/design/research, archived Slice 2 evidence, Phase B/C/E/G reports, and all context manifests.
3. Load backend specs for agent runtime, database, error handling, logging, Host lifecycle, MCP lifecycle, approval,
   permission, tool design, and Memory authority. YCE is disabled; use jbcontext for any unknown semantic code location.
4. Recheck the actual AI SDK version/API and current `chat-agent.ts`, `chat-send.ts`, Host broker, MCP lease, Approval,
   Memory coordinator, and usage callback seams before choosing exact wrapper signatures.
5. Allocate any migration only after comparing this branch with synchronized `main`; never reserve a number in prose.

## 2. Whole-Slice Technical Order

### Step 1 - Shared effect and usage contracts

- Add closed, bounded, versioned schemas for effect kind/state, replay posture, source/generation references,
  idempotency, settlement outcome, usage quality, and effect/usage event payloads.
- Keep subsystem identities as typed references; reject arbitrary payload maps, raw content, credentials, and unbounded
  errors.
- Add schema tests for malformed identity, stale version, unknown kind, forbidden content, bounds, and safe/never default.

### Step 2 - Additive persistence and typed repository

- Add the next migration for Run-owned effects and authoritative usage only after registry/lineage review.
- Enforce unique effect identity, `(run_id, attempt_id, effect_id)` ownership, immutable event linkage, version/CAS,
  terminal idempotency, and bounded fields.
- Add typed append/read/settlement methods and fresh/historical/reopen/no-op migration tests.

### Step 3 - Core effect transition boundary

- Implement one `EffectLifecycleService` or equivalently named Core service above repositories and below domain adapters.
- Implement prepare/wait/intent/settle/cancel/stale classification with synchronous SQLite transactions and post-commit
  RunEvent publishing.
- Prove failed intent writes start no effect; exact duplicate settlement is a no-op; stale callbacks cannot mutate a new
  Attempt or terminal Run.

### Step 4 - Model integration

- Wrap the real model request seam used by `ToolLoopAgent` so each provider request gets intent before dispatch and
  response/usage/effect settlement after completion.
- Preserve AI SDK stream semantics, primary Timeline persistence, cancel-retract, partial output, approval behavior, and
  the one existing context-overflow retry. Do not replace or fork the loop.
- Add tests for success, provider error, abort, no usage, unknown usage, duplicate settlement, and overflow retry.

### Step 5 - Tool, Approval, Host, and MCP integration

- Wrap governed tool execution after effective-argument validation and Approval decision, before raw effect dispatch.
- Persist Approval waiting and settlement references; revalidate policy/generation before target intent.
- Thread `(runId, attemptId, effectId)` through Host routing while retaining Host-local operation identity and broker
  unknown/late/duplicate behavior.
- Capture MCP generation/lease before intent; forced close or transport ambiguity becomes unknown without generation
  redirect or silent replay.
- Add focused tests for denial, expiry, cancel, stale Approval, Host disconnect/deadline, stale generation, MCP drain,
  forced close, and duplicate/late results.

### Step 6 - Memory and usage integration

- Link explicit Memory coordinator requests to effect identity and authority epoch while preserving provider authority and
  request-id idempotency.
- Keep detached primary AutoMemory/image hooks and non-primary suppression unchanged unless the PRD is explicitly
  revised with evidence.
- Persist authoritative usage with the accepted model settlement, including explicit synthetic/unknown quality rows;
  keep window calibration as a consumer.
- Test recall safe posture, write never posture, exact idempotent duplicate, stale epoch/revision, non-primary rules,
  and detached hook failure isolation.

### Step 7 - Projection/spec integration

- Extend readable effect trajectory summaries and inspector-only technical detail over the existing Slice 2 projection.
- Update backend specs, roadmap, deferred decisions, and T4 handoff only where implementation evidence changes a
  contract. Keep D65/D64 and Character-lineage aggregation deferred unless directly required.

## 3. Verification Gates

### Focused gates

- Shared effect/usage schema and redaction tests.
- Core repository/transition atomicity, CAS, idempotency, stale callback, migration lineage, and restart-read tests.
- Model stream/tool-loop regression, provider failure/abort, usage coupling, cancellation/retraction, and overflow retry.
- Approval/Host/MCP generation/unknown outcome process tests.
- Memory authority/idempotency and non-primary regression tests.
- Event sequence, post-commit live delivery, projection readability, observer isolation, and no raw-content tests.

### Required package checks

```text
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/shared exec vitest run
pnpm --filter @taki/core exec vitest run
pnpm lint
pnpm --filter @taki/e2e typecheck
python ./.trellis/scripts/task.py validate 08-24-slice-3-effect-lifecycle-settlement
git diff --check
```

Before handoff, run an isolated Core boot and at least one process-level model/tool/Host or MCP path using the current
configured test provider/stub. Manual UI acceptance is not implied by this child.

## 4. Delegation Contract

At most one implementation agent and one formal check agent may be used for this child. Every prompt must be in English,
start with `Active task: .trellis/tasks/08-24-slice-3-effect-lifecycle-settlement`, state owned files, cite the PRD,
design, research, and specs, and report `completed`, `incomplete`, `unverified`, `extra changes`, and `residual risk`.

Every delegated prompt must include:

```text
YCE is disabled and must not be used.
Use jbcontext for semantic code search, then direct reads and rg for exact follow-up.
Do not spawn child agents.
Do not commit, push, reset, rebase, or archive.
```

Use high effort for implementation and xhigh effort for check/explore/research. Do not interrupt a healthy delegated
run; wait in ten-minute cadence.

## 5. Stop Conditions

- Stop if one effect requires a second Run/Task/Session authority or if subsystem IDs are promoted into parallel Core
  lifecycle lines.
- Stop if intent cannot commit before dispatch, settlement cannot be identity/CAS guarded, or an observer can alter
  current truth.
- Stop if usage cannot be linked to the accepted model settlement, or if unknown provider results are relabeled as
  success/failure without evidence.
- Stop if Host/MCP generation loss redirects to a replacement generation, or Approval starts a target effect before final
  revalidation.
- Stop if raw prompt/completion/tool/credential/sensor data enters canonical persistence/live events.
- Stop and return to planning if the change requires orphan recovery, scheduler/heartbeat policy, a new model loop, or a
  destructive migration.

## 6. Delivery Boundary

The child is complete only when live effect intent/settlement and authoritative usage are proven across the real
production seams, stale/unknown/replay rules are explicit, primary and non-primary behavior remains compatible, and the
Slice 4 recovery worker can act without guessing. Passing Slice 3 does not close recovery, scheduling, Child Runs,
monitor UI, or the global architecture roadmap.
