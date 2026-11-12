# SDK upgrade design

Status: exact upgrade and owner-approved cancellation policy applied; final automated checks and independent review passed. See [implementation evidence](research/implementation-report.md).

## Implemented scope

The existing Core dependencies `ai`, `@ai-sdk/mcp` and `@ai-sdk/openai-compatible` are exactly pinned and installed at 7.0.148 / 2.0.81 / 3.0.75. The working-lock delta contains only this SDK family and its required dependency edges: provider 4.0.31, provider-utils 5.0.65, gateway 4.0.121 and new undici 7.30.1. Existing zod 4.4.3 and cross-spawn 7.0.6 remain unchanged. Exact pins trade automatic direct updates for a reproducible compatibility baseline; this is limited to these three dependencies.

[Upgrade research](../10-21-agent-delegation-source-context/research/sdk-upgrade.md) owns exact peer/transitive constraints, source changes and recommended checks. New Workflow/Harness packages remain comparison inputs, not dependencies of this child.

## Compatibility boundaries

The upgrade must retain the provider input/output contract, tool strictness/nullable MCP schema adaptation, middleware and Effect accounting, streaming finalization, cancellation and step recording. New upstream concurrency or retry defaults cannot bypass existing owner ordering/idempotency. Changes are justified by compiler errors, tests or versioned API evidence.

Prioritize changed streamed-tool argument completion, abort settlement of aggregate promises, unsafe finish reasons, concurrency, actual compatible-provider serialization and MCP discovery/structured results. Retain Taki's `listTools()` pagination and Node/Tauri hidden-process relay: upstream automatic pagination covers `client.tools()`, and upstream `windowsHide` is Electron-conditional. New SDK initialization cancellation is not automatically wired through the current Taki connect factory. No adapter is deleted just because upstream advertises a similarly named capability.

Read the [independent entry review](../10-21-agent-delegation-source-context/research/readiness-review.md). Add actual Node Core boot verification because production imports can differ from Vitest transformation. Keep tests focused on configured behavior; unused SDK timeout/capped-concurrency settings do not become unconditional acceptance requirements.

## Baseline and rollback

Root/Core manifests were unchanged relative to HEAD during planning; `pnpm-lock.yaml` was already modified. Preserve the current files and hashes before any authorized upgrade. Record Node/pnpm and installed package resolutions. Capture narrowly selected relevant tests before and after the change using the same environment; expand to required suite checks once the focused cases pass.

Back up only touched manifest/lock/source files under an explicit task-owned evidence location. Restore a saved file only if no newer unrelated edits would be overwritten; otherwise reconcile its diff. Reinstall the saved lock deterministically when rolling back an installed dependency graph. Never reset to HEAD or discard the dirty worktree.

## Observed compatibility adaptations

- SDK error-only `onStepEnd` callbacks no longer count as completed work for the existing clean overflow retry. Response capture remains at that same per-step boundary; real completed tool effects still prohibit replay.
- A per-call `onError` callback suppresses the SDK's raw console fallback while the unchanged public error part reaches Core's existing failure path.
- The earlier physical stream observer failed independent real-fetch verification and was removed. On 2026-10-22 the owner approved an explicit Core policy: after original persistence/retract/failure handling, cancelled turns skip the existing post-turn callback bundle. Exact retained primary witnesses remain unchanged. The SDK's graceful cancellation ending is accepted; real HTTP/WS regression proves cancelled Run/activity despite `chat.complete`, while empty cancellation still retracts and genuine errors still fail.
- Real compatible-provider SSE and local HTTP fixtures cover completed streamed arguments, repeated IDs/sparse indexes, unsafe finish reasons, aggregate abort settlement, structured-only MCP results and delayed modern discovery. The modern fixture must emit protocol 2026-07-28 `resultType: success`; its earlier omission was a fixture defect, not a production workaround.
- Removing the ineffective observer also removes the temporary 363-line exception. The final ChatAgent passes the existing natural line bound. Tests change only historical cancellation expectations explicitly superseded by the owner's decision; source/retraction/Effect invariants remain asserted.
