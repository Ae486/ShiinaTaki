# Hindsight backup, restore and common recovery point

Hindsight closure Stage 3. Parent plan:
`.trellis/tasks/09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md` (PR01, PR02,
clarification 2 "emergency recovery", revised allocation row 3). Parent requirements: `../08-09-hindsight-memory-provider/prd.md`
R9/R10. Acceptance cases: `closure-plan.md` C10 (complete backup and recovery), C12/C16 subcases touched by restore.
Prior source mapping: `native-setup-administration.md` N10.

## Goal

Taki memory under Hindsight authority can be backed up as one consistent pair (native PostgreSQL + Core SQLite) and
restored into an isolated target that reads back exact identities and proofs and resumes incomplete work without repeating
native effects. The backup path works for an already running existing instance, independent of Stage 5 managed provisioning.
This stage gates any later real-data authority replacement.

Research: `research/stage3-seams.md` (gaps G1-G12, failure matrix §4, contracts §5, routes §6). Design: `design.md`.

## Requirements

- R1 (PR01) One recoverable capture boundary across native PostgreSQL and Core SQLite: both artifacts name the same
  authority epoch, Banks, configuration and native/application checkpoints; a mismatched pair is refused before any
  restore worker starts. A coordinated pause is acceptable if it proves the cut. A write landing between the two captures
  must never restore as a Core terminal success with the native effect missing.
- R2 (PR02) An executable administration path: either an invocation route to the native backup/restore that does not
  assume an HTTP API key grants database permission, or admission of an externally produced native artifact with
  verification. Core stays OS-neutral; process/filesystem/service actions stay outside `packages/core` (parent R10).
- R3 Complete inventory (C10): native/application tables plus Core authority, mappings, Pending/journals, configuration
  and the credential-custody prerequisite (secrets are never copied into an artifact; a missing credential is explicit).
- R4 Isolated restore only in automated verification; never the owner's original data, real Hindsight or real models.
- R5 Emergency rule (clarification 2): a fresh backup of an unavailable provider never gates emergency admission; seal
  surviving Core/replica/Pending/checkpoint evidence, reference the last verified full backup, expose backup age and the
  missing interval. The takeover itself is Stage 4.
- R6 Durable operations follow the Stage 1/2 operation owner (admission, deferred claim, observeBoot, exclusive families).
- R7 Rollback is never absorbed: a native instance behind Core (same lineage and generation, `cursor_ahead`) is refused
  as `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED` without a replica rebuild (G5).
- R8 Operator surface: status reports the last verified backup, its age and the per-Bank missing interval; Home shows a
  minimal truthful backup block (state, age, capture/verify actions through the generic controller).

## Acceptance Criteria

- [ ] AC1 `Database.backupTo` produces a copy that opens, passes `integrity_check`, keeps rowids, reflects a write made
      during the copy; a partial file never survives a failure.
- [ ] AC2 Pair verifier refuses each mismatch (lineage, Bank set, `nativeBankId`, generation, each cursor, a Core
      terminal operation id missing natively) and accepts the native-superset case (inter-capture write after the Core
      copy that lands natively before the native snapshot).
- [ ] AC3 `backup.capture` with a native route double: Hindsight writers get retryable fenced results while reads and
      chat continue; the scheduler pauses and resumes; the fence always releases; quiescence timeout, Core copy failure,
      native failure, pair mismatch and storage failure each settle `failed` with their code and leave no listed artifact.
- [ ] AC4 Family `hindsight-backup` is exclusive both ways with setup, onboarding, activation and lifecycle; restart
      mid-capture settles `outcome_unknown` with the partial artifact quarantined and unlisted; no redispatch.
- [ ] AC5 `backup.admit` / `backup.verify` refuse invalid hash/size/schema/version, missing proof and pair mismatch;
      a verified artifact updates `verifiedAt` and the status section.
- [ ] AC6 Custody: no secret value or catalog envelope appears in any artifact byte; a present ref missing at read-back
      is named by `HINDSIGHT_BACKUP_CREDENTIAL_MISSING`.
- [ ] AC7 Rollback detection per R7; `cursor_expired` keeps today's rebuild.
- [ ] AC8 Emergency seal works while the native client fails, never waits for a native backup, and records the last
      verified backup, its age and the missing interval.
- [ ] AC9 Status schema passes with and without a backup; Home backup block renders every state from fixtures and
      submits through the generic controller.
- [ ] AC10 Native route per the owner's PR02 answer, with native pytest on pg0 (opt-in off refuses; proof equals the
      snapshot contents; existing backup/restore tests green).
- [ ] AC11 Environment evidence on the native-smoke harness: capture -> isolated restore (fresh pg0 schema, restore,
      `repair-bank --all`, `decommission-workers`, copied Core data dir) -> read-back of identities -> resume without a
      repeated native effect.
- [ ] AC12 Gates: `pnpm typecheck`, `pnpm lint`, Shared/Core/Desktop tests, Desktop build, `git diff --check`, isolated
      Core boot (head migration, kinds registered, zero fetches at boot, clean exit).

## Out of scope

Staged upgrade (C11) and managed provisioning (Stage 5); emergency takeover and repeated transitions (Stage 4); remote
Core selection (D23).

## Open questions

- PR02 ANSWERED 2026-09-26 by the owner: option 1 = route (c). The native fork gains an opt-in, default-off endpoint
  callable with the existing API key; the native ZIP stays on the native host and the endpoint returns only the proof
  and artifact reference (no download through the API); one backup at a time. Route (b) (operator CLI run with the same
  proof, admitted from `backups/inbox`) ships as the fallback with the same verifier. Streaming the ZIP to Core (c-stream)
  would widen the key's power and needs a new owner decision.
