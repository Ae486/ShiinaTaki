# First-use path — leader independent verification (pre-report)

Date: 2026-10-29. Scope: implement.md section 1 bullet 1 ("trace the actual Home/RPC/Core/Native path").
This is the leader's own ground truth captured while the Codex Q1-Q5 research runs; the incoming Codex
report is verified against this file, not trusted as-is.

## 1. Journey RPC map

| Journey step | Wire entry | Backing code | Home surface |
| --- | --- | --- | --- |
| Local onboarding | `memory.operations.submit` kinds `local.onboard.prepare` / `local.onboard.activate` | memory-operation-kinds.ts | local-onboarding-card.tsx |
| Connection config (non-secret) | config knobs `TAKI_HINDSIGHT_ENABLED` (bool, default false, live), `TAKI_HINDSIGHT_ENDPOINT` (string, default null, live), deployment mode, timeouts, template revision, model overrides | knob-registry.ts:188-208 (Hindsight setup-plane block); resolveHindsightConfig hindsight-config.ts:13-34 | Settings page "advanced" group (config-groups.ts:72); non-secret non-env-locked knobs are editable [inference, knob-editor.ts] |
| Connection secret | `secret.set` — generic operator-only write-only RPC | secret-methods.ts | NONE — see section 2 |
| Setup validate/apply | `memory.operations.submit` kinds `setup.validate` / `setup.apply` | memory-operation-kind-setup.ts (wraps the live HindsightSetupService) | activation card 校验连接 / 应用配置 (hindsight-activation-actions.ts) |
| Legacy setup control plane | `memory.hindsight.status/validate/setup/llm-health/disable` | hindsight-setup-methods.ts (registered, operator) | NONE — no desktop code imports HINDSIGHT_METHODS or setup-method symbols (symbol + literal greps both empty) |
| Activation | `memory.operations.submit` kind `hindsight.activate` (memory-operation-kinds.ts:32); read `memory.activation.status` (memory-activation-schema.ts:16) | memory-operation-kind-hindsight.ts | activation card 启用 Hindsight / 继续 / 恢复运行时 |
| Retain/recall | memory runtime (B6-validated) | runtime-composition.ts | chat |
| Sync | kind `replica.sync` | memory-operation-kind-replica.ts | operations page |
| Reopen + bounded outage | kinds `transition.return-local` / `transition.reenter-hindsight` (memory-operation-kinds.ts:39) / `transition.emergency-local` | memory-operation-kind-transition.ts | memory-transitions-card.tsx |
| Configuration observation | `memory.hindsight.configuration.observe/status` | hindsight-configuration-methods.ts | observation-only card |
| Templates | reads `memory.template.*`; writes kinds `template.apply` / `template.recover` | hindsight-template-methods.ts | template card |
| Backup | kinds `backup.capture` / `backup.admit` / `backup.verify` | memory-operation-kind-backup-*.ts | memory-hindsight-backup-block.tsx |
| D1-B candidates | kinds `candidate.prepare` / `candidate.inspect` / `candidate.resume` (uncommitted D1-B set) | memory-operation-kind-candidate.ts | row labels only |

## 2. Confirmed missing edge (blocker candidate)

The API key for secretRef `memory.hindsight.connection.api-key` has no Home write surface:

- [source] `secret.set` is generic and operator-only (secret-methods.ts); the desktop client `secretSet` exists
  (ws-client-methods.ts, comment "The MCP page's write-only secret-value path") but the only caller is the MCP page
  (mcp-controller.ts storeSecretValues).
- [source] Settings secret rows are read-only by design: "密钥类配置只存于系统凭据管理器，面板不接受写入"
  (config-state.ts:29; knob-editor.ts; knob-input.tsx renders a presence Badge only).
- [source] apiKeySecretRef is hardcoded at hindsight-config.ts:22; the ref string appears in Core config/fixtures
  and the custody schema constant only, never in apps/desktop.
- [inference] No env-seeding path is visible in the catalog contract (secret-catalog-service.ts header: operator
  surface is set/clear/presence/list over an encrypted secret-catalog.bin under MasterKeySource).
- Consequence: with an existing external instance the operator can set enabled/endpoint from Settings but cannot
  store the key from any UI; validate/apply cannot succeed until the key exists in the catalog [inference from
  hindsight-setup-service.ts validate path + activation-action allow rules].

## 3. Producer/environment facts (for the controlled-provider decision)

- [source] `H:/hindsight/docker/standalone/` exists: Dockerfile, Dockerfile.c2a-fake, managed_bootstrap
  (C2b producer; marker-publication cleanup defect recorded, deploymentReady=false), start-all.sh, tests.
- implement.md's first decision (controlled-provider entry point) stays open until the Codex Q3 runbook evidence
  lands; default remains the existing native fixture path, C2b producer excluded until its defect is fixed.

## 4. Verification checklist for the incoming Codex report

- Q1 table: reconcile against section 1 (method names, files, Home surfaces).
- Q2 edge list: reconcile against section 2 (the key-entry gap must appear; no invented edges).
- Q4 diff list: reconcile against the captured working-tree ground truth (41 modified files incl. the migration-060
  D1-B set; untracked candidate modules).
- Drift scan: scope expansion, invented requirements, defensive-design proposals, premature stop.

## 5. Independent verification of the two breaks (added 20:45, after the pre-failure Codex message)

Codex reported two source-proven breaks in its last message before the rate-limit turn failure. Both are now independently corroborated:

**Break A - no Home input for the fixed API-key reference** (full evidence chain in section 2 above).

**Break B - setup phase deadlock at `unconfigured`**:

- [source] Persisted phase is seeded `unconfigured` (migration 022, INSERT OR IGNORE singleton row).
- [source] The card's allow-rule offers `validate` only in phases ready-to-validate / compatible / failed
  (hindsight-activation-actions.ts SETUP_ACTION_PHASES).
- [source] The displayed phase is a pure passthrough of the persisted phase
  (hindsight-activation-reads.ts:46 `setupPhase: snapshot.phase`; setup service read() = connectionRepo.read).
- [source] No production writer ever sets `ready-to-validate`: repo-wide literal grep finds it only in the
  migration CHECK constraint, the shared enum, the desktop allow-rule/labels/fixtures, and one repo test.
- [source] Core-side guards would accept validate from `unconfigured` (requireIdle blocks only BUSY_SETUP_PHASES;
  requireConnection needs enabled + endpoint) - so direct RPC and operation submissions work; only Home deadlocks.
- [inference] On a fresh setup, saving endpoint + enabled never changes the phase, so Home hides `validate`
  forever. Fix direction (for the post-report dispatch): either advance the phase when connection params resolve,
  or widen the allow-rule when the connection is configured; product intent per UI label 连接参数已填写，请先校验连接
  (hindsight-activation-state.ts:36) suggests the phase-advance was intended.
