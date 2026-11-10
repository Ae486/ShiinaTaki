# Production-wiring integration test delivery

## Changes

Added only `packages/core/src/memory/operations/memory-tidy-runtime.integration.test.ts` and this report. No production source or existing test was changed by this test task.

The new file uses the actual `composeMemoryRuntime`, canonical Local authority marker and repositories, `MemoryOperationService`, installed automatic dispatch callback, compatibility `memory.tidy` method, `MethodRegistry`, strict Shared response parsers, and real operation subscription registry. Fixtures use synthetic records, an in-memory SQLite database, a disposable prompt directory and a controlled scripted AI SDK model. There are no live data or paid calls.

## Cases

1. **Automatic/manual admission and subscriber recovery:** a real automatic Local maintenance trigger starts one durable operation. While the model is held, the compatibility RPC joins it and a second modern submit returns the active busy identity. The old subscriber closes; a replacement subscribes, reads the active operation, receives completion, and queries the retained result. The actual Block write persists once. A later automatic trigger has no new work and creates no extra operation/model calls.
2. **Fresh queued view:** a real preceding Utility Slot task holds admission. A Block changes after submitting tidy but before releasing the slot. The actual provider-bound prompt contains the new content and excludes the old content, proving that this composition uses the fresh queued capture rather than an earlier report.
3. **Committed progress, retired mutation rollback, and RPC recovery:** the first actual Block edit commits with progress. While the second model step is held, a new operation owner boot reconciles the operation to `outcome_unknown`. Status RPC returns the retained applied count. The old second step attempts another Block write; the terminal progress refusal rolls that replacement back. The first Block revision/content remains, old settlement cannot overwrite the unknown outcome, and a filtered RPC read still finds the tidy after an unrelated setup operation. Querying/subscribing does not replay model work.

## Verification

Command from `H:/TakiAgent-worktrees/t4`:

```powershell
pnpm --filter @taki/core test src/memory/operations/memory-tidy-runtime.integration.test.ts
```

Final result: **1 test file passed; 3 tests passed**, Vitest 4.1.10. Reported run duration: 6.87 seconds; test body time 615 ms.

The initial three cases passed. Strengthening the restart case initially allowed the scripted SDK to request an unprovided third continuation after the intentionally refused retired edit. The fixture now uses the supported two-step budget to isolate exactly the successful first mutation and refused second mutation. The mutation rollback assertions passed before and after this fixture correction; no production expectation was changed to hide a failure.

## Limits

- The test exercises production RPC dispatch and subscriptions, not a socket transport or rendered browser. The parent owns the separate actual WebSocket/browser smoke.
- The model is scripted, so this verifies lifecycle wiring and request content, not real-model judgment or memory quality.
- Restart is modeled by constructing a new operation owner with another boot identity over committed SQLite rows while the old callback remains controlled. It proves reconciliation and retired-callback fencing, not physical process termination/relaunch.
- Only this focused test file was executed by this worker. Parent-level workspace typecheck, lint, full tests, and final review remain separate.
- No needed production fix was discovered by the final integration cases.
