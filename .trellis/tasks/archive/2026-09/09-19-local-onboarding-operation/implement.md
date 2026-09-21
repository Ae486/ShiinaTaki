# Stage 2a Execution Plan

Date: 2026-09-20. Status: in progress; backend/Shared implementation dispatched. Follow [PRD](prd.md), [design](design.md) and both research
reports. Existing task only; do not recreate Stage 1. The owner authorized continuation; grill is conditional on a
material unresolved product issue, not an automatic pause between steps.

## Planning and activation

- [x] Restore main `516e151`, current task none, existing planning edits and no active prior subagents.
- [x] Complete producer/Home research; independently review candidate isolation, source custody and runtime publication.
- [x] Write requirements, acceptance criteria and source-grounded design.
- [x] Curate implement/check context and validate every local reference; compact research index prevents truncation.
- [x] Review complete artifacts and resolve substantive findings; Astra reviewer confirmed all six blockers closed.
- [x] `task.py start 09-19-local-onboarding-operation`; session binding is
      `codex_01a0b444-0f71-7492-9ddf-c2cb47553c23`. Backend/Shared dispatched to Astra `s2a_backend_implement`.

## Implementation waves and ownership

One Astra `trellis-implement` owns Core/Shared waves A-C serially; no concurrent writer touches migration registry,
authority transactions, runtime composition, Chat persistence or the shared protocol entry. An Astra frontend
implementer may own wave D only after protocol names/shapes are stable. The leader owns task/spec/handoff documents.
Agents implement directly and do not recursively dispatch. Preserve all unrelated worktree edits.
Freeze wave C's Shared schema definitions early so the frontend may proceed independently; A-C runtime/storage
mutations remain serialized under the backend implementer.

### A. Producer and storage foundation

- [ ] Recheck migration registry; add next immutable migration (expected 049) for candidate/supersession/Block plans
      and trusted primary group/member custody. Extend fresh/upgrade/reopen lineage tests.
- [ ] Make complete manifest/run inventory durable before conversion; atomic per-source import/ledger publication;
      live lease clock, finally release and cooperative snapshot/source work.
- [ ] Implement exact verification, completed-run immutability, admissible/idempotent exclusion and safe isolated
      replacement candidates with selected Block publication and explicit historical conflict refusals.
- [ ] Prove omitted-source, partial import, extra/tampered candidate, stale preview, replacement and supersession cases.

### B. Runtime and primary custody

- [x] Add trusted primary group persistence: append/member atomicity, full-group finalize, retry/retraction and retained
      user-only terminal outcomes. Preserve external callback behavior and post-commit notification ordering.
- [x] Assign/open candidate custody before first append, adopt preexisting in-flight groups at initial preparation,
      preserve eligibility across replacement and reconcile dead/terminal groups explicitly without replay.
- [x] Make source flush account for exact unfinalized groups at retirement target.
- [x] Refactor Local runtime draft/start/publication into one binding truth; handle failed constructors/flush callbacks,
      cleanup, unavailable boot and exact same-epoch binding recovery without reviving Legacy.
- [x] Prove primary callback crash, cancellation/retry, replacement/late-finalize, and all accessor/flush failure cases.

### C. Durable operator surface

- [x] Add Shared local command/producer/progress/result/error and read/invalidation contracts.
- [x] Extend existing owner with local family, deferred claim/pre-claim cancellation and read-only Local boot observation;
      preserve setup/replica behavior. Add bounded local service/handlers and exact producer discovery/receipt validation.
- [x] Register authenticated preview/status/exceptions/exclude/subscription methods using Core-owned workspace and
      server actor. Remove any independent production legacy mutation bypass with explicit compatibility refusal.
- [x] Wire pure runtime readiness, durable invalidations and shutdown order. Update headers/indexes and deadline policy.
- [x] Run registered-method integration with actual empty/legacy B2/runtime and restart, conflict/lost-reply scenarios.

### D. Home

- [ ] Add typed WS local method group/invalidation routing, focused controller/hook/card and Operations page mount.
- [ ] Cover preview, prepare, exceptions/exclusions, same-run resume, stale replacement, activation and binding repair.
      Disable stale/unsupported actions; subscribe/refetch with generation/visibility guards; never poll or replay writes.
- [ ] Update operation labels for new kinds; preserve existing Hindsight card and unrelated maintenance controls.
- [ ] Test controller late-client/race/timeout/hidden-page behavior and render all meaningful states; build Desktop.

## Validation and final review

- [ ] Implementer runs targeted regressions as each wave changes code. No repeated full formal check per wave.
- [ ] One independent Astra `trellis-check` covers all S2a changes, PRD AC1-AC11 and research fault matrix; fixes are
      permitted within scope. Source-only review is not a replacement for this final implementation check.
- [ ] Leader independently checks actual authority/receipt/custody/binding paths and verification evidence.
- [ ] Run workspace `pnpm typecheck`, root `pnpm lint`; Shared/Core/Desktop full tests (plus other affected packages).
      Commands: `pnpm --filter @taki/shared test`, `pnpm --filter @taki/core test`,
      `pnpm --filter @taki/desktop test`, `pnpm --filter @taki/desktop build`.
- [ ] Run isolated real Core startup with a temporary data directory, non-default free port and sanitized/no private
      model/provider configuration; observe migrations, WS listening and clean shutdown. Test no real Hindsight/models.
- [ ] Check diff, source headers/indexes, strict schemas and unresolved skipped tests. Follow spec-required unchanged
      workspace/Rust checks at final gate when applicable; explicitly record any justified scope or environment limits.
- [ ] Update executable specs (migration/onboarding, primary custody/runtime, operation lifecycle) and task evidence.
- [ ] Prepare coherent scoped commit batches under current owner authorization; never include unknown edits or push.
      Archive/journal only after the required completion gates and applicable authorization; manual acceptance remains
      separately pending unless the owner performs it. Do not claim the Hindsight parent complete from S2a delivery.

## Rollback / stop points

Keep failed work observable and preserve original/snapshot evidence. Before authority COMMIT, Legacy remains the
selected provider; after COMMIT, only compatible Local binding recovery is allowed. Never reset markers or delete
candidate/history tables to make tests pass. If a new unresolved product constraint emerges, record the concrete
scenario and recommendation before asking; routine technical findings are resolved from source within these contracts.

## Execution evidence

No production implementation or test execution has occurred at initial plan publication. Append actual wave/review
results here with dates and exact commands; do not convert research examples into passing tests.

Recovery checkpoint (2026-09-20): initial planning artifacts validated with 20 entries per context manifest and no
broken local links/BOM. Backend/Shared owns waves A-C and must freeze schemas before the separate Home writer starts.
The leader owns all task/spec/handoff records. No code acceptance, manual acceptance, commit or archive is implied.

Session recovery (2026-09-20): resumed the owner-authorized session
`01a0b444-0f71-7492-9ddf-c2cb47553c23` in session `01a0be83-0c6c-7402-b989-83d7614fc442`.
Verified `H:/TakiAgent`, branch `main`, HEAD `516e151` and the reviewed planning artifacts. The existing task is
rebound with `task.py start`; `task.py current --source` confirms the new session binding. The interrupted backend
worker left only three unverified Shared schema edits. Astra `s2a_backend_resume` now owns waves A-C; the frontend
wave waits for its Shared contract freeze. Existing unrelated edits and the separate T4 worktree are preserved.
Toolchain verified: Node 24.18.0, pnpm 10.22.0 and Cargo 1.97.0. No verification outcome is implied by recovery.

2026-09-20 artifact review initially found six bounded gaps (candidate finalized-group relocation, healthy/ready-run
custody recovery, empty/unassigned group semantics, claim/unknown interface, legacy RPC/subscription contract and
capture-gate release). The leader incorporated all six in design before task activation. Add explicit regressions for
empty group, unassigned Legacy group, relocated finalized group and healthy-binding source reconciliation.

Session recovery (2026-09-21): the owner requested continuation of
`01a0b444-0f71-7492-9ddf-c2cb47553c23`. Verified its persisted authorization and reviewed artifacts against live
`H:/TakiAgent`, `main`, HEAD `516e151`. Rebound the existing in-progress task to
`codex_01a0c1ca-f090-7230-8822-4fb89e158913`; both 20-entry manifests validate. No earlier worker is running.
Astra `s2a_backend` owns Core/Shared waves A-C and has reviewed/frozen the existing Shared contracts (Shared
typecheck and 7 schema tests passed). Astra `s2a_home` owns Desktop wave D after that freeze. The leader owns
task/spec/handoff evidence and final verification. Full implementation and owner acceptance remain pending.

Leader takeover (2026-09-21 13:00, Claude session `2462d73f`): the Codex-led session's workers last wrote at 10:50 and
are treated as stopped; the task is rebound to this session. Live state of the uncommitted tree on `516e151`:

- Shared: `memory-local-operation-schema.ts`, `memory-local-onboarding-schema.ts`, operation-schema union arms,
  `index.ts` exports — typecheck green, 56 files / 516 tests green. Contract frozen.
- Desktop wave D: `ws-client-memory-onboarding.ts`, routes/methods/deadline registration, `local-onboarding-*`
  controller/hook/state/card/exceptions/fixtures + tests, Operations page mount — typecheck green, 108 files / 600 tests
  green. Not yet exercised against a real Core.
- Core wave A (partial): migration 049 registered; `legacy-snapshot.ts` cooperative walk + `readLegacySnapshot`
  validation; new `legacy-candidate-repo.ts`, `legacy-source-stage.ts`, `legacy-migration-verification.ts`,
  `db/primary-memory-custody-repo.ts`. None is wired: `legacy-migration-runner.ts`, `chat-agent.ts`,
  `runtime-composition.ts`, `runtime-selector.ts`, `main.ts`, the operation kind registry and server methods are
  unchanged. Core typecheck fails (registry missing `local.onboard.*` handlers; `SqlRow | undefined` narrowing in
  `legacy-candidate-repo.ts:41,114,117` and `legacy-migration-verification.ts:47`); root lint fails on three unused
  bindings in `legacy-migration-verification.ts`. No Core test covers the new files; no `index.md` was updated.
- Waves B and C are not started. `cargo` gates recorded on 2026-09-21 predate any Rust change and stay valid.

Remaining backend work is dispatched as one serial `trellis-implement` (waves A-C, then targeted regressions), followed
by one formal `trellis-check`. Desktop consumers change only if the frozen Shared contract must change, in the same wave.

Re-split (2026-09-21 15:30): the single serial implementer (`s2a-implement`) exhausted its context window mid-wave A and
stopped. Its work is kept: `legacy-migration-runner.ts` rewritten to the design API (`preview/prepare/resume/status/
verify/exceptions/exclude/activate`, `ProducerControl` with `stopRequested`, `ActivateInput{transactionId,owner}`),
new `legacy-migration-reads.ts` and `legacy-migration-exclusion.ts`, ledger `acquireLease({recoverFailed})` with
`MIGRATION_BUSY`, `assertNoOpenCustody` in `canonical-ingestion-source-repo.ts`. Live gates: Core typecheck 20 errors
in four files (`memory-migration.ts` server method and two legacy tests still call the removed `stage`/old `activate`
shape; `memory-operation-kinds.ts` registry lacks the local kinds), lint 2 unused bindings in
`legacy-migration-verification.ts:64`. No Core test covers the new modules; no `index.md` updated.

Remaining work follows the original wave boundaries, one serial `trellis-implement` per wave so each keeps the locality
of its own files/tests: A-close (compile/lint/tests/indexes for wave A, compat refusal in the legacy RPC), B (primary
custody in the Chat path + one published Local runtime binding + pure binding snapshot), C (local operation kinds,
onboarding service, boot observation, `memory.onboarding.*` methods/subscription, main/shutdown wiring, integration +
isolated boot smoke). Each ends with its own gate run and an evidence entry below. Then one formal `trellis-check`.
Owner direction (2026-09-21): do not split finer than the waves.

A-close (2026-09-22, Claude `s2a-a-close`): wave A compiles, lints and tests green. Changed: `legacy-migration-verification.ts`
(dead bindings removed via column filter; fixed `candidateClosure` binding an unused `:epoch` to the plan query, which
`node:sqlite` rejects, so every verify counted a phantom blocker), `legacy-migration-runner.ts` (activate publishes the
fresh proof before refusing, retracting stale readiness), `legacy-migration-ledger-repo.ts` (dropped the 049-table
`NOT EXISTS` clause from `acquireLease`; supersession stays enforced by `requireMigrationRun` at every mutation entry and
the ledger works against pre-049 lineage fixtures again), `server/methods/memory-migration.ts` + `main.ts` (single
`createMemoryMigrationMethods({runner,workspaceRoot})`; stage/resume/verify/exclude/activate -> `MEMORY_OPERATION_REFUSED`
reason `MEMORY_OPERATION_REQUIRED`; dryRun confined to the Core workspace with `FORBIDDEN`; unknown run -> `MIGRATION_NOT_FOUND`).
New tests: `049-local-onboarding.test.ts`, `legacy-candidate-repo.test.ts`, `legacy-source-stage.test.ts`,
`legacy-migration-exclusion.test.ts`, shared `legacy-migration-fixture.ts`; runner/snapshot/activation-failure/server tests
repaired; 7 lineage tests bumped 48 -> 49; `index.md` updated for legacy-migration, db, db/migrations, server/methods.
Gates: tsc = only the `memory-operation-kinds.ts` registry error (C1); eslint clean; `git diff --check` clean; Core tests
3109 total, all legacy-migration/db/server suites green; full-suite run shows 9 Hindsight tests timing out at 5000 ms
(varying set per run, present in the pre-slice baseline, 111/111 pass in isolation) — pre-existing load flake, not this slice.

Wave B (2026-09-22, Claude `s2a-b-runtime`): custody + one Local binding. Chat path: new `agents/conversation-writer.ts` (write API
extracted from the store) and `agents/primary-persistence.ts`; `chat-agent.ts` opens one group per primary turn before `appendUser`,
routes persist/retract through the group writer, finalizes once in `runTurn`'s finally (retry shares the group). `db/primary-memory-custody-repo.ts`
draft reviewed: candidate lookup tightened to the selected non-superseded candidate whose epoch is the active authority (the draft's
LEFT JOIN could raise MEMORY_AUTHORITY_MISMATCH on every chat turn for stale pre-049 runs); members re-read via `TimelineEntrySchema`.
Runtime: new `memory/local-runtime-binding.ts` (draft->install->publish->start, disposal + unavailable state, pure `snapshot()`);
`runtime-composition.ts` drops `bindFlush`/`scope.canonical` — flush resolves from `current()` per call (failing MEMORY_FLUSH_FAILED
when unavailable), exposes `custody`, `bindingSnapshot()`, `recoverLocalBinding(epochId)` (marker + joined receipt proof via new
`verifyCanonicalLocalReceipt`, custody reconcile, construct only when unavailable); `runtime-selector.ts` gains `onBootUnavailable`
+ `recoverCanonical`; `canonical-local-subsystem.ts` splits `start()`; runner gains `reconcileCustody` before resume/activate;
`main.ts` hoists one `bootId` and wires `primaryPersistence`. Orphaned `createMemoryFlushBinding` removed. `assertNoOpenCustody`
already covered pre-baseline/assistant-only members; proven by tests, not changed. New tests: custody repo (7), binding (5),
chat custody (7), composition unavailable boot/legacy refusal (2), activation-failure recovery/healthy reconciliation (extended).
Gates: tsc = only `memory-operation-kinds.ts` (C); `eslint packages/core/src` clean; `git diff --check` clean;
`pnpm --filter @taki/core test` 388 files / 3129 tests all green (no Hindsight flake this run). Deferred: none in scope; Hindsight-mode
turns also open (unassigned, header-only) groups — bounded rows, consistent with "Legacy work enrolls too"; wave C maps the snapshot.

Wave C (2026-09-22, Claude `s2a-wave-c`): durable operator surface. Owner contract widened (settlement `outcome_unknown`, closed
`MemoryOperationErrorCode`, execution `tryClaim()`/`checkpoint()`, `observeBoot`, `ctx.lookup`/`ctx.local`); service runs per-kind boot
observation before `reconcileForeign`, adds `latest(family)`; repo gains `listForeign`/`latestInFamily`. New `operations/memory-operation-kind-local.ts`
+ `memory-operation-local-evidence.ts` (prepare new/resume/retry, activate/repair-only on a committed run, macrotask-deferred CAS claim,
pre-claim cancel, receipt-based classification, `commitment_unknown`/`producer_incomplete`). New `memory/local-onboarding/` (service over the
runner + composition, reads/progress/availability, status composite with server-derived actions, test fixture). New
`server/methods/memory-onboarding-methods.ts` (device actor, closed codes -> `MEMORY_OPERATION_REFUSED`), generic `createConnectionSubscriptions`
for `memory.onboarding.changed`; `memory.authority.status` reads the binding snapshot; `main.ts` wires service/publisher and the shutdown order
`localOnboarding.stop() -> memoryRuntime.stop() -> memoryOperations.stop()`. Deadline classification already existed Desktop-side (wave D).
Defect found: the privacy-pause writer sweep pins `.resume(` member calls; the runner resume is invoked via destructuring (commented).
Tests: kind-local 7, onboarding service 5 (empty + legacy B2 journeys with real files/SQLite, replace, cancel/duplicate/lost reply, shutdown
checkpoint), reads 3, onboarding methods 6. Gates: `pnpm typecheck` 5/5 projects 0 errors; `pnpm lint` clean; Shared 56 files/516 tests,
Core 392 files/3150 tests, Desktop 108 files/600 tests all green (no Hindsight flake this run); Desktop build ok; `git diff --check` clean.
Isolated boot (`research/isolated-process-check.mjs`, temp data dir, ports 8304/8307, no provider fetch): migrations 1..49 applied,
`ws server listening`, connect + operations/onboarding subscribe, preview/status/prepare/activate/repair, reopen shows canonical-local with
the same receipt, both shutdowns exit 0; no LISTENING socket or Core child left (TIME_WAIT only). Deferred: none in scope.
