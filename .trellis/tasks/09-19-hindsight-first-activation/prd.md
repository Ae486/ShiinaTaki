# Existing-instance first Hindsight activation as one recoverable operation

Hindsight closure Stage 2b (PR03; matrix A10/A11/A12/A38-first-activation; acceptance case C03). Parent plan:
`.trellis/tasks/09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md`. Grounding:
[research/stage2b-seams.md](research/stage2b-seams.md); decisions: [grill.md](grill.md).

## Goal

An operator with a healthy Canonical Local instance and a configured Hindsight connection enables Hindsight with ONE
confirmation (U1). Core then runs the accepted B4/D78 chain as a durable, resumable operation — drain Local writers,
capture current coverage, prepare/import every Bank natively, obtain the required-maintenance certificate, verify the
replica, promote the authority atomically — carries every committed primary conversation span into the new epoch
(PR03), rebinds the runtime in-process, and recovers truthfully on either side of COMMIT without redispatch or
fabricated receipts. Isolated data only; no real Hindsight, model or user data in automated verification.

## Requirements

- R1 One durable kind `hindsight.activate` (family `hindsight-activation`) with sources `new`, `resume`, `recover`,
  owned by the Stage 1/2a operation service (`tryClaim`, checkpoints, `observeBoot`, closed error codes,
  `outcome_unknown` never collapsed). Core mints the Hindsight epoch id, transaction id and per-Bank replica/verification
  ids at admission; clients never supply them.
- R2 Admission is synchronous and side-effect free: marker `canonical-local` (or `hindsight` + matching receipt for
  `recover`), B3 phase `configured` with live-fingerprint match, no open `setup` / `local-onboarding` / activation row,
  the B2 run proven by `verifyCanonicalLocalReceipt`, every Local Bank with a verified B3 row (else the missing scopes
  are reported and nothing native happens).
- R3 Drain before capture: a write-only Canonical Local fence covers foreground memory tools, `writeMemory`, background
  ingestion, tidy (records and Blocks), the retention sweeper, compaction flush and custody baseline; reads stay open;
  fenced writes return structured `MEMORY_AUTHORITY_FENCED`. Pending spans are ingested to completion or the operation
  fails `MEMORY_INGESTION_INCOMPLETE` with Local intact.
- R4 The chain reuses the B4/D78 primitives unchanged (capture, prepare, import, verify, markReady, promote), each step
  its own transaction with a persisted checkpoint; native calls are idempotent replays of persisted results (exactly one
  POST per import/verification); coverage staleness is a refusal followed by explicit recapture on `resume`.
- R5 PR03 custody: inside the promotion transaction, refuse incomplete Local spans, copy unconsumed Local witnesses into
  the Hindsight witness table with per-Character cursors, reassign open and finalized-unconsumed groups to the new epoch;
  custody finalize routes by the assigned epoch's provider; `recordPrimaryCommitted` routes by the durable marker so a
  commit between COMMIT and bind is never dropped; carried rows are processed exactly once.
- R6 Rebind: after COMMIT the Local subsystem is retired (fence retired, workers stopped, old closures fail closed) and a
  Hindsight subsystem is drafted, installed, published and started as one binding; failure leaves an observable
  `binding_unavailable` result with Hindsight still selected; `recover` repairs the binding only and never re-promotes;
  pre-COMMIT failure reopens Local only on positive marker evidence; Hindsight construction failure at boot yields an
  unavailable runtime, not an aborted Core.
- R7 During the interval chat stays usable (grill Q1); committed-but-unbound state refuses `captureRun` with a structured
  unavailable error; `memory.hindsight.*` RPCs and `disable` refuse while activation is open or Hindsight is selected.
- R8 One operator read `memory.activation.status` (authority, runtime, setup, Bank prerequisites, run/phase/receipt,
  custody counters, relevant operation, server-derived actions) invalidated through `memory.operations.changed`;
  `memory.authority.status` stays truthful before and after COMMIT.
- R9 Recovery: pre-COMMIT failure -> `failed` + closed code, Local intact, `resume`; restart before COMMIT ->
  `outcome_unknown/producer_incomplete` + `resume`, Local boots normally, no auto-dispatch; restart after COMMIT ->
  Hindsight selected, `observeBoot` reconstructs from the receipt; marker/receipt mismatch -> `outcome_unknown/
  commitment_unknown`, fail closed; lost reply -> discovery; duplicate -> `MEMORY_OPERATION_BUSY`; shutdown stops at a
  Bank boundary, never inside COMMIT.
- R10 Home: one focused card on the Operations page showing setup phase and Bank prerequisites, offering the existing
  `setup.validate`/`setup.apply` kinds while unconfigured and a single 启用 Hindsight action (U1), then phase progress,
  继续 after interruption and 恢复运行时 for committed-but-unavailable; Core-derived actions only, no polling, no replay.
- R11 Shared additions are additive and strict; Desktop `KIND_LABEL` grows; `shared/index.ts` stays under its 500-line
  limit with source-bearing named re-exports only.

## Acceptance Criteria

- [ ] AC1 Full C03 journey on temp SQLite with the Hindsight transport double and scripted models: Legacy -> Local
  (S2a operations) -> retain through a captured Run -> `setup.validate` + `setup.apply` -> `hindsight.activate` ->
  marker `hindsight`, activation/bank receipts, `operations() !== null`, `memory.authority.status.runtime.available`,
  a captured Hindsight Run; exactly one native POST per import/verification.
- [ ] AC2 Admission refusals: wrong marker, unconfigured/drifted setup, missing verified Bank scopes (reported), busy
  families, direct `memory.hindsight.*` during activation, `disable` under Hindsight.
- [ ] AC3 Drain: fenced Local tool/`writeMemory`/tidy/flush writes return `MEMORY_AUTHORITY_FENCED` while reads succeed;
  pending spans are drained; an undrainable span fails `MEMORY_INGESTION_INCOMPLETE` with Local intact and fence released.
- [ ] AC4 Every pre-COMMIT failure (stale coverage, target conflict, preparation gaps, native refusal, lost response,
  incomplete verification, lease lost, transport failure) settles `failed` with the matrix code, Local stays selected
  and usable, and `resume` continues from persisted evidence without a second native POST.
- [ ] AC5 PR03: a primary commit during the interval and one between COMMIT and bind are both witnessed and processed
  exactly once by the Hindsight epoch; open and finalized-unconsumed groups are reassigned; an incomplete Local span
  refuses promotion; a group finalizing after COMMIT writes Hindsight witnesses.
- [ ] AC6 Post-COMMIT bind failure -> `failed/runtime_unavailable` with `binding_unavailable`, Local retired, `captureRun`
  structured refusal, `recover` repairs without re-promotion, historical rows immutable after repair.
- [ ] AC7 Restart before and after COMMIT with a new `bootId` classifies per R9 with no redispatch; a corrupt marker fails
  closed with observable state; lost reply and duplicate submit behave per R9.
- [ ] AC8 `memory.activation.status` passes its schema in every state (fixtures for each phase/outcome) and
  `memory.authority.status` reports Hindsight truthfully before bind (`not_installed`/unavailable) and after.
- [ ] AC9 Home card renders every state from fixtures, submits through the generic controller, disables actions while
  stale/pending, and the Local card and Stage 1 card are unchanged; Desktop tests and build pass.
- [ ] AC10 Gates: `pnpm typecheck` 5/5, `pnpm lint`, Shared/Core/Desktop tests, Desktop build, `git diff --check`,
  isolated Core boot on a non-default port through the head migration with the operation registered and a clean exit.
  Owner manual acceptance (real Hindsight/PostgreSQL maintenance semantics, drain quality, credential custody, live
  Home path) is batched with the Stage 2 acceptance session and never marked here.

## Non-goals

Generic provider switching or reverse transitions (Stage 4), backup/restore (Stage 3), Bank lifecycle (2c), any
change to the native Hindsight patch, vector infrastructure, automatic Bank provisioning inside the activation.
