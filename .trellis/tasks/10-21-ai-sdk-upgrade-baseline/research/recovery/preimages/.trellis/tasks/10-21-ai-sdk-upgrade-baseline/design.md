# SDK upgrade design

Status: ready for authorized execution after independent readiness review and global-rule validation.

## Proposed scope

Update only the existing Core dependencies `ai`, `@ai-sdk/mcp` and `@ai-sdk/openai-compatible`, plus their required lockfile resolutions. The verified target snapshot is 7.0.148 / 2.0.81 / 3.0.75. Adopt the research recommendation of exact direct pins for these three compatibility-sensitive packages plus the reviewed lockfile; do not refresh unrelated dependencies or apply a repository-wide pinning policy. This is a proposed implementation change, not an already modified manifest.

[Upgrade research](../10-21-agent-delegation-source-context/research/sdk-upgrade.md) owns exact peer/transitive constraints, source changes and recommended checks. New Workflow/Harness packages remain comparison inputs, not dependencies of this child.

## Compatibility boundaries

The upgrade must retain the provider input/output contract, tool strictness/nullable MCP schema adaptation, middleware and Effect accounting, streaming finalization, cancellation and step recording. New upstream concurrency or retry defaults cannot bypass existing owner ordering/idempotency. Changes are justified by compiler errors, tests or versioned API evidence.

Prioritize changed streamed-tool argument completion, abort settlement of aggregate promises, unsafe finish reasons, concurrency, actual compatible-provider serialization and MCP discovery/structured results. Retain Taki's `listTools()` pagination and Node/Tauri hidden-process relay: upstream automatic pagination covers `client.tools()`, and upstream `windowsHide` is Electron-conditional. New SDK initialization cancellation is not automatically wired through the current Taki connect factory. No adapter is deleted just because upstream advertises a similarly named capability.

Read the [independent entry review](../10-21-agent-delegation-source-context/research/readiness-review.md). Add actual Node Core boot verification because production imports can differ from Vitest transformation. Keep tests focused on configured behavior; unused SDK timeout/capped-concurrency settings do not become unconditional acceptance requirements.

## Baseline and rollback

Root/Core manifests were unchanged relative to HEAD during planning; `pnpm-lock.yaml` was already modified. Preserve the current files and hashes before any authorized upgrade. Record Node/pnpm and installed package resolutions. Capture narrowly selected relevant tests before and after the change using the same environment; expand to required suite checks once the focused cases pass.

Back up only touched manifest/lock/source files under an explicit task-owned evidence location. Restore a saved file only if no newer unrelated edits would be overwritten; otherwise reconcile its diff. Reinstall the saved lock deterministically when rolling back an installed dependency graph. Never reset to HEAD or discard the dirty worktree.
