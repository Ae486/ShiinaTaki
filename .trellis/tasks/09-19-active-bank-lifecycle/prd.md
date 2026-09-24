# Active Bank and configuration lifecycle under Hindsight authority

Hindsight closure Stage 2c (matrix A27/A31/A16; acceptance case C04, C06 reconnect subcase). Parent plan:
`.trellis/tasks/09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md`. Grounding:
[research/stage2c-seams.md](research/stage2c-seams.md) (gaps G1-G14, failure matrix §4); decisions: [grill.md](grill.md).

## Goal

Once Hindsight is the memory authority, a newly used Character, a changed connection setting or rotated key, and a
recovered provider never break chat or silently lose turns. Memory degrades truthfully (the Run continues without
memory, the turn is witnessed and ingested later), Home shows why, and Core offers durable operations that provision the
missing Character Bank and revalidate/rebind the connection. Isolated data only; no real Hindsight, model or user data.

## Requirements

- R1 Degraded Run (G1, G2): under marker `hindsight`, a Character without a ready Bank, or a capture with no admission
  evidence for the current fingerprint while the provider is unreachable, or a drifted/disabled connection, admits a
  memory-unavailable Run (no memory tools, no automatic recall, no memory prompt; snapshot capabilities all false,
  `vectorRetrieval: "unavailable"`, provider/lineage/epoch ids kept). A runtime left unbound by a known configuration
  state (disabled/unconfigured, template-revision conflict) also degrades. Integrity failures (marker/receipt/lineage) and
  unbound states of unknown cause keep refusing (S2b contract). Existing-Bank recall failure keeps today's in-Run fallback.
- R2 No lost turns (G11): primary commits of a degraded Run are witnessed through the marker-routed ledger and ingested
  exactly once after the Bank/connection is ready.
- R3 Truthful status (G7, G8, G10): `memory.authority.status` gains a `hindsight` section (non-null iff marker
  `hindsight`, readable while the runtime is unavailable, never probes the network): connection config/drift/admittedAt,
  per-scope Bank readiness `ready | syncing | provisioning | failed | not_provisioned` with `errorCode`, and
  server-derived `actions`. New runtime reasons `connection_disabled` and `config_changed`; `authority_mismatch` only for
  a real epoch/lineage mismatch; the enable flag is never a switch. Runtime construction refuses a
  `desiredTemplateRevision` that differs from the verified Banks' revision.
- R4 B3 snapshot stays readable with non-verified rows (G4): `configured` requires a verified Global row, at least one
  verified Character row and compatibility.
- R5 `bank.provision {characterId}` (G3, G5, G6): durable kind, family `hindsight-lifecycle`; requires marker
  `hindsight`, published runtime, no drift; template revision from the verified Global row (mismatch
  `HINDSIGHT_TEMPLATE_CONFLICT`, zero native calls); occupancy probe before the first PUT for a scope with no B3 row
  (`HINDSIGHT_BANK_OCCUPIED`, no PUT, no row); `applyHindsightBank` unchanged; requests a full replica run and settles
  `completed` only once that Bank's replica is bound; never touches already verified rows.
- R6 `connection.revalidate {expectedEpochId}` (G9, G12): config must be `ready`; refuses changed `deploymentMode` or
  template revision (Stage 5) and a different lineage (`HINDSIGHT_REPLICA_LINEAGE_MISMATCH`, Stage 4) keeping the old
  binding; compatibility validate + lineage admission; export-verify live Banks without row writes; record the new
  fingerprint (never `markAllPending`) and admission evidence; binding `replace(epochId)` when the fingerprint changed or
  the runtime is unavailable; construct/start failure -> `binding_unavailable` with `recoverBinding` offered.
- R7 Verified reconnect (G13): `verifiedReconnect` is called only by a non-swapping revalidate and once per foreground
  capture that admitted and synced every routed Bank while some automatic Bank sits in availability backoff; never from
  the scheduler's own drain or WS/browser events. `armTimer` failures record `lastError` instead of escaping.
- R8 Automatic triggers (owner Q1-A/Q2-A, 2026-09-24): the first degraded Run for a Character without a Bank submits
  `bank.provision` once per Character per connection fingerprint; the first detection of `config_changed` submits
  `connection.revalidate` once per fingerprint, only when lineage, `deploymentMode` and template revision are unchanged.
  A failed automatic attempt is not retried automatically; the operator's 创建 Bank / 重新校验连接 retries.
  Automatic submits go through the same kinds and admission; a busy family refuses and the Run stays degraded (no queueing, Stage 4).
- R9 Family `hindsight-lifecycle` joins `EXCLUSIVE_MEMORY_FAMILIES` (four families mutually single-flight). Both kinds
  follow the S2a/S2b handler rules: synchronous side-effect-free admission, Core-minted ids, deferred claim, cancel only
  while admitted, read-only `observeBoot` (settle from B3 row, replica state and binding snapshot, else
  `outcome_unknown`). One migration (050): the reviewed `deploymentMode` is persisted beside the reviewed fingerprint so a
  revalidation after a restart can prove the mode unchanged (leader ruling, wave B).
- R10 Home (G14): the authority card shows readiness rows, the new reason labels and 创建 Bank / 重新校验连接 from
  `hindsight.actions` only; no client-derived allow rules, no polling, no replay.
- R11 Shared additions are additive and strict; producer-kind inference becomes an explicit per-kind table;
  `packages/shared/src/index.ts` stays under its 500-line limit.
- R12 D87 closes with the journey test in AC6; D86/D88 are retargeted in `docs/deferred-decisions.md`.

## Acceptance Criteria

- [ ] AC1 New Character after activation: `chat.send` for `mika` admits a memory-unavailable Run and replies; status
  shows `not_provisioned`; after `bank.provision` the Bank is `ready`, a later Run recalls from Global + `mika`, and the
  degraded turn is ingested exactly once.
- [ ] AC2 Provision refusals/failures: wrong marker, drift/unavailable runtime, template conflict (zero native calls),
  occupied Bank (no PUT/row), dry-run/import/verify failure (`failed` row, other Banks keep serving), first-sync failure
  (`failed` + replica code, re-submit idempotent), busy against each of the four families.
- [ ] AC3 Drift: timeout change or key rotation -> status `config_changed`, Runs degraded, witnesses kept; revalidate ->
  runtime available on the new fingerprint, no Bank row changed, old scheduler stopped once, witnessed turns ingested
  once. Enable flag off -> `connection_disabled`, revalidate refuses, authority unchanged. Lineage/deploymentMode/template
  change -> refused, old binding kept.
- [ ] AC4 Provider outage: first capture with no evidence degrades instead of throwing; after recovery a foreground
  success triggers one `verifiedReconnect`; no call when no Bank is in availability backoff or from scheduled runs.
- [ ] AC5 Restart mid-provision and mid-revalidate classifies per R9 with no redispatch; boot with a changed config binds
  and reports drift until revalidated; boot with a changed template revision yields an unavailable runtime, not an
  aborted Core.
- [ ] AC6 D87 journey: interval Character -> resume blocking -> 应用配置 -> resume completes; post-COMMIT Character ->
  provision -> carried/degraded turns ingested once.
- [ ] AC7 Status schema passes in every readiness state and reason; `hindsight` is null under other markers.
- [ ] AC8 Home card renders every readiness state and reason from fixtures, submits both kinds through the generic
  controller, disables actions while pending/disconnected.
- [ ] AC9 Gates: `pnpm typecheck` 5/5, `pnpm lint`, Shared/Core/Desktop tests, Desktop build, `git diff --check`,
  isolated boot (head 050, status reads answered, both kinds registered, zero fetches at boot). Owner manual acceptance
  is batched with Stage 2a/2b after this stage and never marked here.

## Out of scope

Template revision change, model re-provisioning and `deploymentMode` change (Stage 5); a different provider lineage or
disabling Hindsight as a switch (Stage 4); native Bank delete/reset (Stage 3/5); queueing requests behind a busy family
(Stage 4); backup/restore (Stage 3).
