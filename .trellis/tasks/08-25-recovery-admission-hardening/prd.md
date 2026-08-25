# Architecture Slice 4: Recovery and Admission Hardening

> This is the parent Harness architecture Slice 4. It is distinct from the downstream T4 product roadmap's delivery
> and reliability convergence slice, which consumes this shared recovery boundary later.

## Goal

Make the existing Core Run/Attempt/Effect lifecycle restart-safe and admission-visible. After a process crash,
shutdown, provider interruption, or cancellation race, Core must classify durable work from its current state and
effect evidence, reconcile it through the existing lifecycle boundary, and never silently replay an unsafe side effect.
The same admission service must expose queued work and enforce captured deadlines and budgets for interactive and future
provider-neutral triggers.

This slice is a shared Harness foundation. Scheduled Task, Heartbeat, webhook, delivery, and Child Run providers are
downstream consumers and do not receive provider-specific policy here.

Implementation status: provider-neutral Core boundary implemented and formally checked. Provider-specific recovery
adapters and queued-chat payload reconstruction remain explicit downstream work.

## Requirements

### Recovery and reconciliation

- Add one Core-owned recovery coordinator that runs from the existing bootstrap/composition root after durable stores
  are available and before new effect dispatch is accepted.
- Scan non-terminal Runs and unfinished Effects using mutable Run/Operation current state as the next-action authority;
  use the Run Event ledger as immutable evidence, never as a replacement state machine.
- Capture a process/owner generation for in-flight work. A previous generation must be classified as gone before a new
  process can resume or reconcile its Run.
- Classify every crash point with a bounded, durable result: resumable preparation, waiting for authority, safe replay,
  reconciliation required, `outcome_unknown`, cancelled, deadline exceeded, failed, or completed.
- Resume only preparation or explicitly safe/idempotent effects when both the stored replay posture and the current
  provider contract permit it. Default missing or uncertain replay metadata to unsafe.
- Never automatically replay an unsafe Host/MCP/tool/Memory mutation. Preserve the original Effect identity and settle
  `outcome_unknown` or leave a bounded reconciliation-required state for an authority-specific status query.
- Reconcile terminal Effects whose owning Run/Attempt did not finish, and make all recovery transitions idempotent under
  the existing `(runId, attemptId, stateVersion, captured generations)` guards.
- Late, duplicate, stale, wrong-generation, and post-terminal callbacks remain no-ops for current truth and retain only
  bounded diagnostic classification.

### Admission, queue, cancellation, and budgets

- Keep one Core admission service for chat and future trigger providers. Do not create a scheduler-owned runtime,
  second Agent loop, or DSH Session/Task authority.
- Make queued Runs observable and non-destructively inspectable by Character/lane, state, age, deadline, initiator, and
  bounded provenance. `runId` remains the queue/resume key; do not introduce a mandatory `queueId` aggregate.
- Make queued cancellation durable. A cancellation before an Attempt/effect starts settles the Run without invoking the
  model or tool; cancellation of already-intended work follows the Effect-specific unknown/cancellation contract.
- Enforce the immutable admission deadline and validated budget before queue admission, before Attempt/effect dispatch,
  and at settlement. Persist the reason for refusal or terminal settlement with bounded codes; do not infer expiry from
  wall-clock logs after restart.
- Keep lane serialization and active AbortSignal process-local, but derive status and recovery decisions from durable
  Run/Attempt state. A restart must not make queued work disappear or make a cancelled Run executable.

### Observability and privacy

- Emit recovery, reconciliation, queue, cancellation, deadline, and budget facts through the existing typed Run Event
  ledger and post-commit live plane. Do not make Pino or a monitor UI an authority.
- Use readable bounded summaries and closed diagnostic codes by default. Prompts, credentials, raw tool/MCP/Host bodies,
  unrestricted provider errors, cwd/env, and sensor/media bytes remain excluded from canonical state and events.
- Preserve the existing developer-trace/trajectory seam; Slice 4 does not add a full monitor UI or external telemetry.

## Acceptance Criteria

- [x] A fresh Core boot performs a bounded recovery scan before accepting new effect dispatch, records a process-generation
      classification, and is idempotent when repeated against the same database.
- [x] Restart fixtures cover queued/prepared, waiting Approval, model intent, safe read, unsafe Host/MCP/Memory effect,
      terminal Effect with unfinished Run, cancellation, and expired deadline crash points.
- [x] Preparation work resumes only when the captured snapshot/generations/deadline/budget remain valid; invalid or
      expired work settles with the correct bounded outcome without invoking an external effect.
- [x] Safe replay requires both stored and current `safe`/idempotent declarations and preserves effect identity and
      deduplication evidence; unsafe effects are never silently replayed and become reconciliation-required or
      `outcome_unknown` according to the authority contract.
- [x] Duplicate, late, stale, wrong-Attempt, and wrong-generation recovery callbacks cannot reopen or mutate newer
      Run/Attempt/Effect truth.
- [x] Queued Runs can be listed and cancelled durably; a cancelled queued Run never starts a model/tool/Host/MCP call,
      including after restart, while an active cancellation still settles already-intended Effects truthfully.
- [x] Absolute deadlines and validated budgets are enforced at admission, dispatch, and settlement, including after
      restart; no negative or fabricated budget is reported.
- [x] Recovery and queue facts use the existing Run Event schema, redaction rules, sequence/cursor behavior, and
      readable projection contract.
- [x] Fresh and synchronized historical migration lineages, Core typechecks, focused/full tests, lint, task validation,
      isolated boot, deterministic restart/process acceptance, and `git diff --check` pass.

## Constraints and non-goals

- PI is the Runtime/Harness architecture reference: durable current program counter, effect sandwich, explicit replay,
  durable cancellation, and bounded recovery. DSH is used only for event/trajectory/observability techniques.
- Preserve the existing AI SDK `ToolLoopAgent`, Character isolation, Timeline/Replay authority, Host/Approval/MCP
  generation contracts, Memory authority, and Slice 1-3 Run/Event/Effect schemas unless an additive contract change is justified by tests.
- Do not implement Scheduled Task, Heartbeat cadence/quiet hours/catch-up, delivery policy, Child Run execution,
  monitor UI, external telemetry, or generic plugin-defined lifecycle authority.
- Do not claim cross-repository atomicity for Memory receipts; reconcile the separated Memory receipt and Core Effect
  transactions explicitly.
- Do not reserve a migration number until the current branch and synchronized `main` migration registries are compared.

## Definition of Done

- Recovery/admission design, crash matrix, authority adapters, migration impact, and test matrix are persisted before
  activation.
- Production implementation is performed only after this planning child is reviewed and explicitly approved.
- Any changed contract updates the parent roadmap, affected specs, task manifests, and deferred decisions in the same
  planning change; this slice label is not a final architecture version.
