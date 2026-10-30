# Runtime foundation implementation checkpoint

This is an in-progress recovery aid, not a passed child acceptance report.

## Authorization and entry

The owner-approved continuation recovered session `01a0bcaa-c7b9-7d91-bc6e-06820bce7a90` in native session `01a0be82-6979-79c3-8aa1-1dc8ed8712f9`. The parent pinned-main integration gate passed; see its `research/baseline-review-2026-09-20.md` and final `baseline-verified-source-2026-09-20.json`. This existing child is now `in_progress`, and the root native task pointer targets it. The global Avatar Lab breadcrumb is unrelated.

## Current implementation ownership

- `runtime_foundation`: Shared/Core/Desktop runtime, strict context and structural decisions, Character coordination, delivery/continuation/recovery, event projections, Scheduled integration, serialized `main.ts`, Shared exports and migration registry.
- `timezone_foundation`: User Timezone schema/repository/service/operator methods, authenticated report lifecycle and future schedule recomputation. It coordinates additive 049 columns and final wiring with the runtime owner; it does not edit `main.ts`, Shared exports or the migration.
- Root: `e2e/src/initiative-runtime.e2e.test.ts`, `fixture/scripted-provider.ts`, `fixture/initiative-process.ts`, `fixture/initiative-test-entry.ts`, E2E indexes, task metadata and final verification orchestration.

Preserve existing Avatar outcome, Operations recovery repairs and all other pre-existing work. No commit, push, archive, main-worktree edit, real-user database migration or external model call is authorized by this checkpoint.

## E2E arrangement and evidence boundary

The test-only Node loader appends exports for `initiativeRuntime` and `turnControls` to the exact `main.ts` module during isolated process startup. Production source exposes no new test RPC or loader hook. IPC invokes the actual composed service with a trusted test opportunity and controllable original-source/delivery fences. The existing canonical Local pre-boot seed, normal operator WS methods, actual local SSE model transport and read-only SQLite provide independent assertions.

Written scenarios cover thin request/history exclusion, silent/express/speak decisions, duplicate identity, completed-process Monitor replay, same-Attempt held presentation, source retirement, primary reservation, pre-admission refusal and malformed/conflicting/missing decisions. A fake operator reports `avatar.outcome=applied`; this proves the protocol/effect path, not native rendering or human presentation.

At this checkpoint all new fixtures and the ten-case E2E suite passed E2E typecheck and focused ESLint. Runtime wiring is still being implemented, so no process scenario or child acceptance is yet claimed passed. The suite also proves default-disabled admission with zero Run/model growth once executed.

## Next steps

1. Complete the runtime/timezone implementations and coordinate exact exports/settings/wiring.
2. Typecheck and run `pnpm --filter @taki/e2e exec vitest run src/initiative-runtime.e2e.test.ts` with bounded teardown and local-only provider.
3. Resolve actual failures without weakening authority, lifecycle or acceptance assertions; complete C1-01 through C1-08 evidence.
4. Run the proportional full child gate and formal `trellis-check`, synchronize executable specifications, and record limitations separately from native/owner acceptance before child 2.

Source checkpoints describe the completed parent baseline, not the evolving child source. Do not restore them over the current implementation or rerun the incoming snapshot integration.
