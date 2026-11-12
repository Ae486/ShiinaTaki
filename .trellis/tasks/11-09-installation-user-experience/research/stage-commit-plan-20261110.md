# Scoped stage-commit proposal

Status: the owner explicitly approved both scoped commits on 2026-11-10 after
reviewing the prerequisite boundary. The first commit is
`2c761fb2e1c41c7222e0a1641549630b105d2685`; this record accompanies the second commit.
Only the documented baseline/task changes are included. Other work stays unstaged.

Workspace: `H:/TakiAgent-worktrees/t4`, branch
`task/t4-skills-mcp-productization`, base `cd3cd91b51d299d82c808b324d60284711314e6c`.
The existing installation-user-experience task remains `in_progress`; this proposal
neither accepts manual criteria nor archives this or the prerequisite task.

## Why a prerequisite is necessary

The live-configuration task was implemented on an already dirty maintenance baseline.
Its Memory policy reads the earlier Tidy timeout/input fields; its index operation
joins the earlier durable `MemoryOperationService.wait` owner. Current Tidy code also
uses the review repository and runner introduced by that baseline. Migration 070-072
must follow existing 067-069: the migration runner skips versions at or below the
stored maximum, so committing 070+ first would make later 067-069 adoption unsafe.

Maintenance Monitor is a cohesive source-preserving part of that baseline, rather
than a claim that every UI line is individually required for model switching.
Removing it would create a new partial producer/observation variant requiring design
and validation. The proposed prerequisite keeps the existing feature, its UI, tests
and contracts together; it does not include arbitrary unrelated work.

Independent advice and exact Core/Shared dependency edges:
`G:/taki-native-flow-artifacts-20261110/commit-preparation/core-shared-prerequisite-advice.md`.
Root verified 309 relevant pretask copies against their original SHA256 manifest.

## Proposed commits, in order

1. `feat(memory): add maintenance recovery and preserve migration lineage`
   - 119 paths, using pretask baseline B snapshots, never whole current mixed files.
   - Reliable Tidy operations/recovery and maintenance observations with matching UI,
     tests and specifications; migrations 067-069 and their registry/lineage checks.
   - The owner separately approved this additional predecessor scope.
2. `feat: simplify local startup and apply live configuration`
   - 334 validated candidate paths plus this review plan (335 paths when staged).
   - Local native authentication/Home startup, grouped profiles, coherent live
     application, Local/Legacy search/retention/listener replacement, packaged-avatar
     resource/current-state fixes and idle-rendering corrections, with tests/specs
     and this task's durable evidence records.
   - Five documented Hindsight Utility/prompt adapters remain; withdrawn Hindsight
     transport/index internals are not restored by this commit.

Private-worker summary-repair changes are not necessary prerequisites. The proposal
keeps the old HEAD summary algorithm/repository and applies only this task's optional
summarizer-capture API plus its two-line call adaptation in the existing `compact`
function. The unrelated worker repair remains in the user's worktree, unstaged.
This candidate adaptation passed the old private-context tests and related live
configuration tests; it has not replaced the working copy.

## Verification of the actual candidates

- Both prerequisite and final trees passed Core, Shared and Desktop `tsc --noEmit`:
  six successful checks, with each tree's workspace package links verified local.
- Final-tree targeted Vitest: seven files / 52 tests passed. Coverage includes the
  isolated private-summary adaptation, profile/configuration capture and migration
  registry/lineage. These are candidate checks, separate from the earlier combined
  worktree's full-suite/native evidence.
- Proposals were materialized only as review artifacts on G, using existing locked
  dependency links. No dependency installation, real profile or native process
  mutation was needed. Source worktree and the real Git index stayed untouched.
- The known retained Hindsight function-size lint finding remains an explicit stage
  quality limitation. No production rule is suppressed; this is not a clean release
  or completed/manual-accepted task.
- HEAD, branch, initially empty live index and all inventoried working-file hashes
  were rechecked before execution; no drift was found. The first staged check found
  one redundant EOF blank line in baseline `memory/tidy-prompt.ts`. Only its staged
  representation was normalized; production working-file contents remain untouched.
  No push, archive, finish, amend or reset is included.

Review artifacts (not proposed for committing):

- `G:/taki-native-flow-artifacts-20261110/commit-preparation/01-prerequisites.patch`
- `G:/taki-native-flow-artifacts-20261110/commit-preparation/02-flow-live-configuration.patch`
- `G:/taki-native-flow-artifacts-20261110/commit-preparation/proposal-trees.json`
- `G:/taki-native-flow-artifacts-20261110/commit-preparation/*-typecheck.log`
- `G:/taki-native-flow-artifacts-20261110/commit-preparation/candidate-final-focused-tests.log`

The patch/tree metadata predates this documentation-only plan; add this plan in the
second commit without confusing it with an untested production change.

## Excluded work

- Exec-tool guidance and associated unrelated tool specifications.
- Private worker summary repair and its repository/tests; only the task capture seam
  described above is proposed.
- Other delegation/context E2E work and their task documents.
- Other tasks' bookkeeping, task archives, local continuation scratch checkpoints,
  raw runtime data, source backups, local fixture credentials, generated builds,
  model assets and evidence-directory junctions. These remain local.

The baseline deltas in the following paths are excluded (a path can still have a
separate, explicitly scoped task-only hunk in commit 2):

- `.trellis/spec/backend/private-worker-context.md`
- `.trellis/spec/backend/tool-design.md`
- `e2e/src/agent-delegation-goals-real.e2e.test.ts`
- `e2e/src/agent-delegation-upgrade.e2e.test.ts`
- `e2e/src/fixture/agent-context-scenario.ts`
- `e2e/src/fixture/agent-context-timing-relay.e2e.test.ts`
- `e2e/src/fixture/agent-context-timing-relay.ts`
- `e2e/src/fixture/index.md`
- `e2e/src/index.md`
- `packages/core/src/agents/chat-agent-worker-context.test.ts`
- `packages/core/src/agents/chat-agent-worker-summary-repair.test.ts`
- `packages/core/src/agents/index.md`
- `packages/core/src/agents/private-task-context.test.ts`
- `packages/core/src/agents/private-task-context.ts`
- `packages/core/src/agents/private-task-summarizer.ts`
- `packages/core/src/capabilities/exec-tool.ts`
- `packages/core/src/capabilities/index.md`
- `packages/core/src/db/subagent-context-summary-repo.test.ts`
- `packages/core/src/db/subagent-context-summary-repo.ts`

## Commit 1 exact path list

- `M .trellis/spec/backend/canonical-local-memory-runtime.md`
- `M .trellis/spec/backend/memory-operations.md`
- `M .trellis/spec/backend/observability-projection.md`
- `M .trellis/spec/backend/sqlite-migration-lineage.md`
- `M .trellis/spec/frontend/reactive-read-models.md`
- `M apps/desktop/src/lib/index.md`
- `A apps/desktop/src/lib/ws-client-maintenance-monitor.ts`
- `M apps/desktop/src/lib/ws-client-methods.ts`
- `M apps/desktop/src/lib/ws-client-routes.ts`
- `M apps/desktop/src/lib/ws-client.ts`
- `M apps/desktop/src/windows/home/index.md`
- `M apps/desktop/src/windows/home/pages/monitor/cache-usage-strip.tsx`
- `M apps/desktop/src/windows/home/pages/monitor/index.md`
- `A apps/desktop/src/windows/home/pages/monitor/maintenance-monitor-controller.ts`
- `A apps/desktop/src/windows/home/pages/monitor/maintenance-monitor-panel.tsx`
- `A apps/desktop/src/windows/home/pages/monitor/maintenance-monitor.module.css`
- `A apps/desktop/src/windows/home/pages/monitor/maintenance-monitor.test.tsx`
- `M apps/desktop/src/windows/home/pages/monitor/monitor-page.tsx`
- `M apps/desktop/src/windows/home/pages/monitor/monitor-workspace.module.css`
- `M apps/desktop/src/windows/home/pages/monitor/use-cache-usage.ts`
- `A apps/desktop/src/windows/home/pages/monitor/use-maintenance-monitor.ts`
- `M apps/desktop/src/windows/home/pages/monitor/use-monitor-controller.ts`
- `M apps/desktop/src/windows/home/pages/operations/index.md`
- `M apps/desktop/src/windows/home/pages/operations/memory-authority-card.test.tsx`
- `M apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx`
- `M apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts`
- `M apps/desktop/src/windows/home/pages/operations/memory-operations-controller.test.ts`
- `M apps/desktop/src/windows/home/pages/operations/memory-operations-controller.ts`
- `M apps/desktop/src/windows/home/pages/operations/memory-tidy-card.test.tsx`
- `M apps/desktop/src/windows/home/pages/operations/memory-tidy-card.tsx`
- `D apps/desktop/src/windows/home/pages/operations/memory-tidy-controller.test.ts`
- `D apps/desktop/src/windows/home/pages/operations/memory-tidy-controller.ts`
- `A apps/desktop/src/windows/home/pages/operations/memory-tidy-fixtures.ts`
- `A apps/desktop/src/windows/home/pages/operations/memory-tidy-operation.test.ts`
- `A apps/desktop/src/windows/home/pages/operations/memory-tidy-state.ts`
- `M apps/desktop/src/windows/home/pages/operations/operations-page.tsx`
- `M apps/desktop/src/windows/home/pages/operations/operations-state.test.ts`
- `M apps/desktop/src/windows/home/pages/operations/operations-state.ts`
- `M apps/desktop/src/windows/home/pages/operations/use-memory-operations.ts`
- `D apps/desktop/src/windows/home/pages/operations/use-memory-tidy.ts`
- `M apps/desktop/src/windows/home/pages/operations/use-operations.ts`
- `M apps/desktop/src/windows/home/resource-state-pages.test.tsx`
- `M packages/core/src/agents/compaction-coordinator.ts`
- `M packages/core/src/agents/compaction-pass.test.ts`
- `M packages/core/src/config/index.md`
- `M packages/core/src/config/knob-registry.test.ts`
- `M packages/core/src/config/knob-registry.ts`
- `M packages/core/src/config/memory-config.test.ts`
- `M packages/core/src/config/memory-config.ts`
- `M packages/core/src/db/auxiliary-usage-repo.ts`
- `M packages/core/src/db/cache-usage-repo.test.ts`
- `M packages/core/src/db/cache-usage-repo.ts`
- `M packages/core/src/db/compaction-operation-repo.ts`
- `M packages/core/src/db/index.md`
- `A packages/core/src/db/maintenance-monitor-repo.ts`
- `M packages/core/src/db/memory-operation-repo.ts`
- `A packages/core/src/db/memory-tidy-review-repo.test.ts`
- `A packages/core/src/db/memory-tidy-review-repo.ts`
- `M packages/core/src/db/migrations/041-canonical-memory-maintenance.test.ts`
- `M packages/core/src/db/migrations/048-memory-operations.test.ts`
- `M packages/core/src/db/migrations/058-agent-inbox.test.ts`
- `M packages/core/src/db/migrations/065-auxiliary-model-usage.test.ts`
- `A packages/core/src/db/migrations/067-memory-tidy-reviews.ts`
- `A packages/core/src/db/migrations/068-maintenance-monitor.ts`
- `A packages/core/src/db/migrations/069-delegation-schema-convergence.test.ts`
- `A packages/core/src/db/migrations/069-delegation-schema-convergence.ts`
- `A packages/core/src/db/migrations/069-delegation-schema.ts`
- `M packages/core/src/db/migrations/index-list.test.ts`
- `M packages/core/src/db/migrations/index-list.ts`
- `M packages/core/src/db/migrations/index.md`
- `M packages/core/src/db/migrations/lineage-reopen-matrix.test.ts`
- `M packages/core/src/db/pending-memory-repo.test.ts`
- `M packages/core/src/db/scheduled-task-repo.test.ts`
- `M packages/core/src/index.md`
- `M packages/core/src/main.ts`
- `M packages/core/src/memory/bootstrap.ts`
- `M packages/core/src/memory/canonical-local-maintenance.test.ts`
- `M packages/core/src/memory/canonical-local-subsystem.ts`
- `M packages/core/src/memory/canonical-local-tidy.ts`
- `A packages/core/src/memory/canonical-tidy-review.ts`
- `M packages/core/src/memory/index.md`
- `M packages/core/src/memory/memory-engine.ts`
- `M packages/core/src/memory/operations/index.md`
- `M packages/core/src/memory/operations/memory-operation-contract.ts`
- `A packages/core/src/memory/operations/memory-operation-kind-tidy.test.ts`
- `A packages/core/src/memory/operations/memory-operation-kind-tidy.ts`
- `M packages/core/src/memory/operations/memory-operation-kinds.ts`
- `M packages/core/src/memory/operations/memory-operation-service.ts`
- `A packages/core/src/memory/operations/memory-tidy-runtime.integration.test.ts`
- `A packages/core/src/memory/operations/tidy-operation-adapter.ts`
- `M packages/core/src/memory/runtime-composition.ts`
- `A packages/core/src/memory/tidy-agent-runner.ts`
- `A packages/core/src/memory/tidy-coverage.ts`
- `A packages/core/src/memory/tidy-issues.test.ts`
- `A packages/core/src/memory/tidy-issues.ts`
- `M packages/core/src/memory/tidy-pass.ts`
- `A packages/core/src/memory/tidy-prompt.ts`
- `A packages/core/src/memory/tidy-reliability.test.ts`
- `M packages/core/src/memory/tidy-report.ts`
- `A packages/core/src/memory/tidy-shutdown.test.ts`
- `M packages/core/src/observability/auxiliary-usage-meter.test.ts`
- `M packages/core/src/observability/auxiliary-usage-meter.ts`
- `M packages/core/src/observability/cache-usage-service.ts`
- `M packages/core/src/observability/index.md`
- `A packages/core/src/observability/maintenance-monitor-service.ts`
- `A packages/core/src/observability/maintenance-monitor.test.ts`
- `M packages/core/src/observability/model-usage-context.ts`
- `M packages/core/src/server/methods/index.md`
- `A packages/core/src/server/methods/maintenance-monitor-methods.ts`
- `M packages/core/src/server/methods/memory-operation-methods.test.ts`
- `M packages/shared/src/auxiliary-usage-schema.ts`
- `M packages/shared/src/cache-usage-schema.ts`
- `M packages/shared/src/index.md`
- `M packages/shared/src/index.ts`
- `A packages/shared/src/maintenance-monitor-schema.ts`
- `A packages/shared/src/maintenance-operation-ref-schema.ts`
- `M packages/shared/src/memory-operation-schema.ts`
- `M packages/shared/src/memory-tidy-diagnostics-schema.ts`
- `A packages/shared/src/memory-tidy-outcome-schema.ts`

## Commit 2 exact path list

- `A .trellis/spec/backend/live-configuration.md`
- `A .trellis/tasks/11-09-installation-user-experience/check.jsonl`
- `A .trellis/tasks/11-09-installation-user-experience/design.md`
- `A .trellis/tasks/11-09-installation-user-experience/implement.jsonl`
- `A .trellis/tasks/11-09-installation-user-experience/implement.md`
- `A .trellis/tasks/11-09-installation-user-experience/prd.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/avatar-final-source-review-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/avatar-import-ui-repair-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/config-runtime-application.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/continuation-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/core-runtime-progress.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/delivery-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/desktop-acceptance-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/empty-pet-performance-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/final-core-review-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/hindsight-change-inventory-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/intentions-retention-progress-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/live-settings-smoke.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/local-policy-advisor-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/model-ui-progress.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-auth-latency.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-cdp-probe.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-flow-progress.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-helper-smoke.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-origin-check.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-reconnect-check.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-resource-sample.ps1`
- `A .trellis/tasks/11-09-installation-user-experience/research/native-runtime-check.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/packaged-avatar-acceptance-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/packaged-avatar-acceptance.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/repeated-lifecycle-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/repeated-lifecycle-20261110.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/search-rebuild-benchmark.mjs`
- `A .trellis/tasks/11-09-installation-user-experience/research/stage-commit-plan-20261110.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/startup-baseline.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/startup-core-map.md`
- `A .trellis/tasks/11-09-installation-user-experience/research/startup-desktop-map.md`
- `A .trellis/tasks/11-09-installation-user-experience/task.json`
- `A apps/desktop/src-tauri/capabilities/character-assets.json`
- `A apps/desktop/src-tauri/capabilities/local-auth.json`
- `A apps/desktop/src-tauri/permissions/autogenerated/local_characters_root.toml`
- `A apps/desktop/src-tauri/permissions/autogenerated/local_core_endpoint.toml`
- `A apps/desktop/src-tauri/permissions/autogenerated/local_operator_identity.toml`
- `A apps/desktop/src-tauri/permissions/autogenerated/local_operator_proof.toml`
- `A apps/desktop/src-tauri/src/browser_attachment/lifecycle.rs`
- `A apps/desktop/src-tauri/src/character_assets.rs`
- `A apps/desktop/src-tauri/src/local_auth.rs`
- `A apps/desktop/src-tauri/src/local_auth/index.md`
- `A apps/desktop/src-tauri/src/local_auth/tests.rs`
- `A apps/desktop/src-tauri/src/local_auth_commands.rs`
- `A apps/desktop/src-tauri/src/local_auth_commands/index.md`
- `A apps/desktop/src-tauri/src/local_auth_commands/tests.rs`
- `A apps/desktop/src-tauri/src/ws_local_auth.rs`
- `A apps/desktop/src/lib/costume-scene-event.ts`
- `A apps/desktop/src/lib/native-local-auth.ts`
- `A apps/desktop/src/lib/ws-client-model-profiles.ts`
- `A apps/desktop/src/windows/home/model-profiles-controller.test.ts`
- `A apps/desktop/src/windows/home/model-profiles-controller.ts`
- `A apps/desktop/src/windows/home/pages/chat/chat-model-availability.tsx`
- `A apps/desktop/src/windows/home/pages/costume/costume-scene-observer.test.ts`
- `A apps/desktop/src/windows/home/pages/costume/costume-scene-observer.ts`
- `A apps/desktop/src/windows/home/pages/costume/use-costume-scene-observation.test.ts`
- `A apps/desktop/src/windows/home/pages/costume/use-costume-scene-observation.ts`
- `A apps/desktop/src/windows/home/pages/settings/config-application-view.ts`
- `A apps/desktop/src/windows/home/pages/settings/model-profile-card.tsx`
- `A apps/desktop/src/windows/home/pages/settings/model-profile-editor-controller.test.ts`
- `A apps/desktop/src/windows/home/pages/settings/model-profile-editor-controller.ts`
- `A apps/desktop/src/windows/home/pages/settings/model-profile-fields.tsx`
- `A apps/desktop/src/windows/home/pages/settings/model-profile-form.ts`
- `A apps/desktop/src/windows/home/pages/settings/model-profiles-section.tsx`
- `A apps/desktop/src/windows/home/pages/settings/use-model-profile-editor.ts`
- `A apps/desktop/src/windows/home/use-model-profiles.ts`
- `A apps/desktop/src/windows/pet/use-costume-scene-observer.ts`
- `A apps/desktop/src/windows/pet/use-render-governor.test.ts`
- `A apps/desktop/test/model-profile-native-smoke.mjs`
- `A packages/core/src/agents/agent-runtime-binding.ts`
- `A packages/core/src/boot/feature-configuration.ts`
- `A packages/core/src/config/agent-runtime-config.test.ts`
- `A packages/core/src/config/agent-runtime-config.ts`
- `A packages/core/src/config/config-application.test.ts`
- `A packages/core/src/config/config-application.ts`
- `A packages/core/src/config/memory-runtime-policy.ts`
- `A packages/core/src/config/model-profile-application.ts`
- `A packages/core/src/config/model-profile-resolution.ts`
- `A packages/core/src/config/model-profile-secrets.ts`
- `A packages/core/src/config/model-profile-service.test.ts`
- `A packages/core/src/config/model-profile-service.ts`
- `A packages/core/src/db/migrations/070-model-profiles.ts`
- `A packages/core/src/db/migrations/071-model-profile-secrets.ts`
- `A packages/core/src/db/migrations/072-search-projection-policy.ts`
- `A packages/core/src/db/model-profile-repo.ts`
- `A packages/core/src/db/search-projection-policy-repo.test.ts`
- `A packages/core/src/db/search-projection-policy-repo.ts`
- `A packages/core/src/devices/local-connection-auth.test.ts`
- `A packages/core/src/devices/local-connection-auth.ts`
- `A packages/core/src/media/attachment-gc.test.ts`
- `A packages/core/src/memory/canonical-local-retention.test.ts`
- `A packages/core/src/memory/canonical-search-projection.ts`
- `A packages/core/src/memory/legacy-search-projection.test.ts`
- `A packages/core/src/memory/legacy-search-projection.ts`
- `A packages/core/src/memory/live-search-tokenizer.test.ts`
- `A packages/core/src/memory/live-search-tokenizer.ts`
- `A packages/core/src/memory/memory-search-application.ts`
- `A packages/core/src/memory/operations/index-operation-adapter.ts`
- `A packages/core/src/memory/operations/memory-operation-kind-index.ts`
- `A packages/core/src/memory/runtime-configuration-race.test.ts`
- `A packages/core/src/memory/runtime-configuration.test.ts`
- `A packages/core/src/memory/search-projection-rebuild.test.ts`
- `A packages/core/src/memory/search-projection-rebuild.ts`
- `A packages/core/src/secrets/local-bootstrap-key.ts`
- `A packages/core/src/server/methods/connect-local.test.ts`
- `A packages/core/src/server/methods/model-profile-methods.ts`
- `A packages/core/src/server/ws-listener.test.ts`
- `A packages/core/src/server/ws-listener.ts`
- `A packages/shared/src/model-profile-schema.ts`
- `A scripts/prepare-native-helper.mjs`
- `A scripts/start-core.mjs`
- `A scripts/start-desktop.mjs`
- `M .trellis/spec/backend/canonical-local-memory-runtime.md`
- `M .trellis/spec/backend/config-store.md`
- `M .trellis/spec/backend/index.md`
- `M .trellis/spec/backend/server-push-and-connection-auth.md`
- `M .trellis/spec/frontend/costume-operation-lifecycle.md`
- `M .trellis/spec/frontend/home-window.md`
- `M .trellis/spec/frontend/index.md`
- `M .trellis/spec/frontend/live2d-renderer.md`
- `M .trellis/spec/frontend/operator-connection-recovery.md`
- `M .trellis/spec/frontend/packaged-build.md`
- `M .trellis/spec/frontend/quality-guidelines.md`
- `M .trellis/spec/frontend/reactive-read-models.md`
- `M apps/desktop/src-tauri/Cargo.lock`
- `M apps/desktop/src-tauri/Cargo.toml`
- `M apps/desktop/src-tauri/build.rs`
- `M apps/desktop/src-tauri/src/browser_attachment.rs`
- `M apps/desktop/src-tauri/src/browser_attachment/index.md`
- `M apps/desktop/src-tauri/src/browser_attachment/server.rs`
- `M apps/desktop/src-tauri/src/browser_attachment/tests.rs`
- `M apps/desktop/src-tauri/src/browser_attachment_commands.rs`
- `M apps/desktop/src-tauri/src/index.md`
- `M apps/desktop/src-tauri/src/lib.rs`
- `M apps/desktop/src-tauri/src/node.rs`
- `M apps/desktop/src-tauri/src/protocol.rs`
- `M apps/desktop/src-tauri/src/secrets.rs`
- `M apps/desktop/src-tauri/src/ws_client.rs`
- `M apps/desktop/src-tauri/tauri.conf.json`
- `M apps/desktop/src/features/character-import/index.md`
- `M apps/desktop/src/features/character-import/use-costume-switch.test.ts`
- `M apps/desktop/src/features/character-import/use-costume-switch.ts`
- `M apps/desktop/src/features/presence/index.md`
- `M apps/desktop/src/features/presence/use-home-timezone.ts`
- `M apps/desktop/src/hooks/index.md`
- `M apps/desktop/src/hooks/use-operator-connection.ts`
- `M apps/desktop/src/lib/character-asset-url.test.ts`
- `M apps/desktop/src/lib/character-asset-url.ts`
- `M apps/desktop/src/lib/costume-switch-attempt.test.ts`
- `M apps/desktop/src/lib/costume-switch-attempt.ts`
- `M apps/desktop/src/lib/index.md`
- `M apps/desktop/src/lib/operator-auth.test.ts`
- `M apps/desktop/src/lib/operator-auth.ts`
- `M apps/desktop/src/lib/rpc-deadline.test.ts`
- `M apps/desktop/src/lib/rpc-deadline.ts`
- `M apps/desktop/src/lib/ws-client-methods.ts`
- `M apps/desktop/src/lib/ws-client-routes.ts`
- `M apps/desktop/src/lib/ws-client.test.ts`
- `M apps/desktop/src/lib/ws-client.ts`
- `M apps/desktop/src/renderer/index.md`
- `M apps/desktop/src/renderer/pet-scene.test.ts`
- `M apps/desktop/src/renderer/pet-scene.ts`
- `M apps/desktop/src/renderer/render-governor.test.ts`
- `M apps/desktop/src/renderer/render-governor.ts`
- `M apps/desktop/src/windows/home/index.md`
- `M apps/desktop/src/windows/home/pages/chat/chat-page.tsx`
- `M apps/desktop/src/windows/home/pages/chat/index.md`
- `M apps/desktop/src/windows/home/pages/costume/costume-select-state.test.ts`
- `M apps/desktop/src/windows/home/pages/costume/costume-select-state.ts`
- `M apps/desktop/src/windows/home/pages/costume/costume-view.test.ts`
- `M apps/desktop/src/windows/home/pages/costume/costume-view.ts`
- `M apps/desktop/src/windows/home/pages/costume/index.md`
- `M apps/desktop/src/windows/home/pages/costume/use-costume-page.ts`
- `M apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts`
- `M apps/desktop/src/windows/home/pages/perception/index.md`
- `M apps/desktop/src/windows/home/pages/perception/use-browser-attachment.ts`
- `M apps/desktop/src/windows/home/pages/settings/config-groups.ts`
- `M apps/desktop/src/windows/home/pages/settings/config-observer.ts`
- `M apps/desktop/src/windows/home/pages/settings/config-save-controller.test.ts`
- `M apps/desktop/src/windows/home/pages/settings/config-save-controller.ts`
- `M apps/desktop/src/windows/home/pages/settings/config-state.test.ts`
- `M apps/desktop/src/windows/home/pages/settings/config-state.ts`
- `M apps/desktop/src/windows/home/pages/settings/index.md`
- `M apps/desktop/src/windows/home/pages/settings/knob-draft-controller.test.ts`
- `M apps/desktop/src/windows/home/pages/settings/knob-editor.test.ts`
- `M apps/desktop/src/windows/home/pages/settings/knob-editor.ts`
- `M apps/desktop/src/windows/home/pages/settings/knob-field.tsx`
- `M apps/desktop/src/windows/home/pages/settings/model-capabilities-section.test.tsx`
- `M apps/desktop/src/windows/home/pages/settings/model-capabilities-section.tsx`
- `M apps/desktop/src/windows/home/pages/settings/settings-page.tsx`
- `M apps/desktop/src/windows/home/pages/settings/use-config-read.ts`
- `M apps/desktop/src/windows/home/pages/settings/use-model-capabilities.ts`
- `M apps/desktop/src/windows/home/resource-state-pages.test.tsx`
- `M apps/desktop/src/windows/pet/costume-report.test.ts`
- `M apps/desktop/src/windows/pet/costume-report.ts`
- `M apps/desktop/src/windows/pet/index.md`
- `M apps/desktop/src/windows/pet/pet-stage.tsx`
- `M apps/desktop/src/windows/pet/use-costume-switch-event.ts`
- `M apps/desktop/src/windows/pet/use-initial-costume.ts`
- `M apps/desktop/src/windows/pet/use-render-governor.ts`
- `M docs/UIUX-OPTIMIZATION.md`
- `M docs/deferred-decisions.md`
- `M docs/index.md`
- `M eslint.config.js`
- `M package.json`
- `M packages/core/package.json`
- `M packages/core/src/agents/agent-attempt.ts`
- `M packages/core/src/agents/chat-agent.ts`
- `M packages/core/src/agents/compaction-coordinator.ts`
- `M packages/core/src/agents/conversation-store.ts`
- `M packages/core/src/agents/private-task-context.ts`
- `M packages/core/src/agents/private-task-summarizer.ts`
- `M packages/core/src/boot/core-bootstrap.test.ts`
- `M packages/core/src/boot/core-bootstrap.ts`
- `M packages/core/src/boot/index.md`
- `M packages/core/src/co-watching/viewing-invitation-evidence.test.ts`
- `M packages/core/src/co-watching/viewing-invitation-evidence.ts`
- `M packages/core/src/config/config-source.test.ts`
- `M packages/core/src/config/config-source.ts`
- `M packages/core/src/config/config-writer.test.ts`
- `M packages/core/src/config/config-writer.ts`
- `M packages/core/src/config/context-config.ts`
- `M packages/core/src/config/hindsight-config.test.ts`
- `M packages/core/src/config/index.md`
- `M packages/core/src/config/initiative-policy-config.test.ts`
- `M packages/core/src/config/initiative-wake-knobs.test.ts`
- `M packages/core/src/config/knob-registry.test.ts`
- `M packages/core/src/config/knob-registry.ts`
- `M packages/core/src/config/model-capabilities.test.ts`
- `M packages/core/src/config/model-capabilities.ts`
- `M packages/core/src/config/provider-config.ts`
- `M packages/core/src/config/server-config.test.ts`
- `M packages/core/src/config/server-config.ts`
- `M packages/core/src/config/subagent-config.test.ts`
- `M packages/core/src/config/utility-config.ts`
- `M packages/core/src/db/cache-usage-repo.test.ts`
- `M packages/core/src/db/index.md`
- `M packages/core/src/db/memory-repo.ts`
- `M packages/core/src/db/migrations/041-canonical-memory-maintenance.test.ts`
- `M packages/core/src/db/migrations/048-memory-operations.test.ts`
- `M packages/core/src/db/migrations/058-agent-inbox.test.ts`
- `M packages/core/src/db/migrations/065-auxiliary-model-usage.test.ts`
- `M packages/core/src/db/migrations/069-delegation-schema-convergence.test.ts`
- `M packages/core/src/db/migrations/index-list.test.ts`
- `M packages/core/src/db/migrations/index-list.ts`
- `M packages/core/src/db/migrations/index.md`
- `M packages/core/src/db/migrations/lineage-reopen-matrix.test.ts`
- `M packages/core/src/db/pending-memory-repo.test.ts`
- `M packages/core/src/db/scheduled-task-repo.test.ts`
- `M packages/core/src/devices/device-registry.ts`
- `M packages/core/src/devices/index.md`
- `M packages/core/src/devices/paired-device-store.test.ts`
- `M packages/core/src/devices/paired-device-store.ts`
- `M packages/core/src/harness/run-service.ts`
- `M packages/core/src/harness/run-snapshot-capture.test.ts`
- `M packages/core/src/harness/run-snapshot-capture.ts`
- `M packages/core/src/main.ts`
- `M packages/core/src/media/attachment-gc.ts`
- `M packages/core/src/memory/assembler.ts`
- `M packages/core/src/memory/bootstrap.ts`
- `M packages/core/src/memory/canonical-local-ingestion.test.ts`
- `M packages/core/src/memory/canonical-local-ingestion.ts`
- `M packages/core/src/memory/canonical-local-maintenance.test.ts`
- `M packages/core/src/memory/canonical-local-retention.ts`
- `M packages/core/src/memory/canonical-local-runtime.ts`
- `M packages/core/src/memory/canonical-local-subsystem.ts`
- `M packages/core/src/memory/canonical-local-tidy.ts`
- `M packages/core/src/memory/canonical-memory-run.test.ts`
- `M packages/core/src/memory/canonical-memory-run.ts`
- `M packages/core/src/memory/canonical-observed-write.ts`
- `M packages/core/src/memory/canonical-tools/canonical-memory-tools.test.ts`
- `M packages/core/src/memory/canonical-tools/canonical-memory-tools.ts`
- `M packages/core/src/memory/canonical-tools/index.md`
- `M packages/core/src/memory/episodic-writer.ts`
- `M packages/core/src/memory/flush-writer.ts`
- `M packages/core/src/memory/hindsight/hindsight-ingestion-lifetime.ts`
- `M packages/core/src/memory/hindsight/hindsight-ingestion.ts`
- `M packages/core/src/memory/hindsight/hindsight-memory-runtime.ts`
- `M packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts`
- `M packages/core/src/memory/hindsight/hindsight-policy-curator.ts`
- `M packages/core/src/memory/index.md`
- `M packages/core/src/memory/legacy-migration/fenced-memory-engine.ts`
- `M packages/core/src/memory/local-memory-provider.ts`
- `M packages/core/src/memory/memory-engine.ts`
- `M packages/core/src/memory/operations/index.md`
- `M packages/core/src/memory/operations/memory-operation-contract.ts`
- `M packages/core/src/memory/operations/memory-operation-kinds.ts`
- `M packages/core/src/memory/operations/memory-operation-service.ts`
- `M packages/core/src/memory/persona-provider.ts`
- `M packages/core/src/memory/retention-sweeper.test.ts`
- `M packages/core/src/memory/retention-sweeper.ts`
- `M packages/core/src/memory/runtime-activation-failure.test.ts`
- `M packages/core/src/memory/runtime-composition.test.ts`
- `M packages/core/src/memory/runtime-composition.ts`
- `M packages/core/src/memory/runtime-selector.ts`
- `M packages/core/src/memory/store.ts`
- `M packages/core/src/memory/tidy-pass.ts`
- `M packages/core/src/memory/tidy-reliability.test.ts`
- `M packages/core/src/memory/tidy-shutdown.test.ts`
- `M packages/core/src/memory/utility-slot.test.ts`
- `M packages/core/src/memory/utility-slot.ts`
- `M packages/core/src/perception/ambient-screenshot-sampler.test.ts`
- `M packages/core/src/perception/ambient-screenshot-sampler.ts`
- `M packages/core/src/perception/ambient-shot-gc.test.ts`
- `M packages/core/src/perception/ambient-shot-gc.ts`
- `M packages/core/src/perception/perception-layer.test.ts`
- `M packages/core/src/perception/perception-layer.ts`
- `M packages/core/src/scheduler/schedule-engine.ts`
- `M packages/core/src/scheduler/sweep-runner.ts`
- `M packages/core/src/secrets/index.md`
- `M packages/core/src/secrets/master-key.ts`
- `M packages/core/src/secrets/secret-catalog-service.test.ts`
- `M packages/core/src/secrets/secret-catalog-service.ts`
- `M packages/core/src/server/index.md`
- `M packages/core/src/server/methods/config-methods.test.ts`
- `M packages/core/src/server/methods/config-methods.ts`
- `M packages/core/src/server/methods/config-model-capabilities.ts`
- `M packages/core/src/server/methods/config-set.ts`
- `M packages/core/src/server/methods/connect.ts`
- `M packages/core/src/testing/source-live-evidence.ts`
- `M packages/shared/src/config-schema.ts`
- `M packages/shared/src/connect-schema.test.ts`
- `M packages/shared/src/connect-schema.ts`
- `M packages/shared/src/error-code-schema.ts`
- `M packages/shared/src/harness-schema.ts`
- `M packages/shared/src/index.md`
- `M packages/shared/src/index.ts`
- `M packages/shared/src/memory-operation-schema.ts`
- `M packages/shared/src/model-capability-schema.ts`
