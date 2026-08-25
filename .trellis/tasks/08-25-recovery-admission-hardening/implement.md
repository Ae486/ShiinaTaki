# Slice 4 Recovery and Admission Hardening Implementation Plan

This document records the implementation completed in the T4 worktree. Code is committed as `5a4b32d`; task archive
bookkeeping remains separate. No push, reset, or rebase was performed.

## 0. Preconditions and review gate

- Re-read the current `main` migration registry and T4 branch migration registry; do not reserve a version from a stale
  planning snapshot.
- Re-run current-state checks for `main.ts`, `RunService`, `RunRepo`, `EffectRepo`, `TurnQueue`, `TurnRegistry`,
  `chat-send`, Host/MCP/Approval/Memory authority adapters, and Slice 3 acceptance evidence.
- Confirm the child remains limited to recovery/admission hardening and does not absorb Scheduled Task, Heartbeat,
  Child Run, delivery, or monitor UI behavior.
- If a contract changes, update the parent roadmap and the relevant phase/spec/task manifests before implementation.

## 1. Contract and schema slice

- Added bounded queue list/status contracts, recovery classification/report schemas, `run.queue`, and the closed
  `recovery.classified` Run Event payload.
- Compared the live T4 registry with current `main`: both ended at 027, so additive migration 028 was allocated.

- Freeze the recovery result/reason vocabulary, process-generation ownership, queue status/cursor shape, and deadline/
  budget guard semantics in `@taki/shared`.
- Decide whether existing Run/Effect fields suffice or an additive migration is required. Allocate the next migration
  only after lineage comparison; add fresh/historical/reopen tests.
- Add only the minimum closed RunEvent variants needed for recovery/queue/deadline/budget evidence.

## 2. Core recovery coordinator

- Added `createRecoveryCoordinator` with generation fencing, bounded orphan scan, cancellation/deadline handling,
  terminal Effect -> Run repair, safe replay requiring stored and current `safe`, and fail-closed reconciliation for
  missing/unsafe adapters.
- Added `run-recovery-repo.ts` to keep queue/recovery persistence helpers out of the primary Run repository.

- Implement a Core-owned coordinator that scans unfinished Runs/Effects at boot and records one bounded classification.
- Keep classification, external probing, and CAS settlement as separate steps; never hold a SQLite transaction across I/O.
- Add adapter interfaces for Approval, Host/MCP, provider/model, and canonical Memory receipt reconciliation. Missing or
  uncertain adapters fail closed and do not replay unsafe effects.
- Make scan/reconcile idempotent under process restarts, duplicate probes, stale generations, and late callbacks.

## 3. Admission/queue/cancellation hardening

- Added durable `run.queue` inspection, queue cursor/filter support, durable admission seal, and pre-dispatch
  cancellation/deadline guard. `runId` remains the sole queue/resume key.

- Add durable queue status reads and bounded filters over Run state without introducing a queue aggregate.
- Make queued cancellation visible in RunEvents and ensure the process-local queue checks durable cancellation before start.
- Reconcile active cancellation with existing AbortSignal, Host/MCP cancellation, and Effect unknown-outcome rules.
- Keep Character lane serialization and existing primary chat behavior unchanged.

## 4. Deadline/budget guards

- Admission rejects expired deadlines and zero budgets before persistence; queued start and effect intent paths recheck
  persisted cancellation/deadline state and settle bounded terminal outcomes.

- Validate absolute deadline and budget at admission, before Attempt/effect dispatch, and at settlement.
- Persist closed reason/error codes and authoritative counters; process timers only accelerate a durable decision.
- Prove restart behavior for expired queued work, expiry during waiting, and expiry after an unsafe intent.

## 5. Boot/process acceptance

- Boot runs recovery before registering/accepting the WS server and shutdown seals admission before closing services.
- Focused restart/crash fixtures cover queued idempotence, expired queue, unsafe Host effect, safe replay identity,
  terminal Effect repair, queue listing, and shutdown admission seal.

- Wire the coordinator into the existing Core composition root before WS trigger acceptance, with bounded startup and
  deterministic handling of per-Run failures.
- Add isolated-process fixtures that seed unfinished Runs/Effects, stop Core, restart against the same DB, and assert
  classification, no unsafe replay, effect/Run CAS, event sequence, and idempotent second boot.
- Add one whole-chain acceptance covering queue admission -> cancellation/recovery -> safe replay or unknown outcome.

## 6. Quality gates

- Shared/Core tests and typechecks, lint, focused migration lineage/reopen tests, and `git diff --check` pass.

- Shared/Core typechecks and focused/full tests.
- Migration lineage fresh/historical/reopen/no-op tests if schema changes.
- Real Core boot/restart acceptance and relevant Host/MCP/Approval/Memory adapter tests.
- `pnpm lint`, E2E typecheck, Rust parity only if the wire contract changes, task validation, and `git diff --check`.
- One implementation agent and one unique formal check agent at most; prompts must state the active task, ownership,
  PI-primary/DSH-observability references, YCE disabled, `jbcontext` required, English-only sub-agent communication,
  no commit/push/reset/rebase, and the exact verification/report format.

## 7. Rollback and deferred work

- No destructive migration or down-migration path added. Provider/Host/MCP/Memory authority probes remain deferred;
  missing adapters intentionally classify unfinished unsafe work as reconciliation-required.

- Roll back code against additive schema while preserving unread rows and event facts; do not down-migrate or rewrite
  history.
- If recovery evidence changes the identity or queue contract, stop implementation, update parent/child planning docs,
  specs, and manifests, then request renewed approval.
- Defer provider-specific schedule/Heartbeat policies, delivery reliability, Child Run result protocol, monitor UI,
  external telemetry, and cross-repository Memory atomicity to their own slices.
