# Implementation ownership and integration seams

## Ownership

- Parent agent: Shared protocol, existing memory operation service/kind, outer runtime/main wiring and compatibility RPC; integration evidence and final checks.
- Local producer implementer: tidy-pass/report/canonical-local-tidy and any focused colocated helper; MemoryEngine tidy view interface; Local checkpoint/retry repo and new migration 067 plus migration registry; canonical-local-subsystem injection; memory config; relevant focused tests and own folder index lines.
- Home implementer: Desktop operation card/controller/hooks, operator labels, necessary existing MemoryOperation kind consumers, frontend tests and own folder index lines. No Shared/Core edits.

## Producer seam

`TidyPass.runNow(characterId, options?)` accepts optional `{ onProgress?: (progress: MemoryTidyProgress) => void }`; `maybeRun` retains its current signature. Add `requestRun?: (characterId: string) => Promise<void>` to TidyPassDeps and optional same injection to createCanonicalLocalSubsystem input. `maybeRun` checks producer eligibility/backoff before dispatching requestRun; absent injection retains isolated/Legacy compatibility. raw runNow never calls requestRun. Outer runtime provides a late-bound callback and the operation kind invokes raw runNow.

`MemoryTidyProgress` is Shared and contains `edits`, `steps`, `reviewed`, and nullable `remaining` (unknown before capture). Persist changes through onProgress; Local committed edits and their progress callback share the mutation transaction. Step/batch progress can be published separately. Preserve actual count semantics; no-op/replayed receipts count zero. Callback failure must roll back the affected mutation instead of reporting an untracked success.

`TidyRunOutcome` keeps existing clean|ran|partial|failed and existing counts/diagnostics. Optional additive fields: `reviewed`, `remaining`, `recoveredIssues`, `skippedIssues`, `nextAction` (none|continue|retry|manual-retry|check-settings), and `retryAt` (ISO or null). Existing compatibility RPC keeps its existing result/error shape; the new operation result stores the full outcome. `manual-retry` is emitted only from a successfully persisted exhausted automatic retry budget.

Shared MemoryTidyIssue gains optional `issueId`, `stage` (input|reference|write|completion), and closed `field` (id|layer|content|disclosure|replacement|unknown). Public code/tool fields remain closed; no raw arguments/reasons/provider text. Internal correction acknowledgements may contain a bounded non-content enum reason, not arbitrary copied memory prose.

## Operation seam

New request: `{ kind: 'tidy', characterId: string }`.
New producer: `{ kind: 'tidy', characterId: string, progress: MemoryTidyProgress }`.
New result: `{ kind: 'tidy', outcome: MemoryTidyOutcome }`.
Shared outer operation states remain unchanged; a partial outcome maps to outer failed with the full result, and restart maps to outcome_unknown with preserved progress. Family is one global `tidy` family because Characters share Global memory/blocks.

The existing service receives optional live tidy accessor; kind handler captures/checks authority through the service's admitted operation identity before raw execution. It supports producer progress updates through the existing mutable producer field and exposes wait/join for compatibility callers. Fresh canonical snapshots are built within UtilitySlot execution.

## UI seam

Use existing `memoryOperationSubmit`, `memoryOperationStatus`/`memoryOperationList`, `memoryOperationSubscribe`, and `onMemoryOperationChanged`; verify exact client names. Busy refusal's activeOperationId means observe existing work, never replay. Subscribe before baseline read, refresh on changed/reconnect/remount, preserve visibility conventions. Display tidy producer.progress while pending and tidy result.outcome after settlement; outer outcome_unknown uses preserved progress with explicit interrupted/unknown wording. The old memoryTidy client method remains available for older provider/client compatibility and isolated existing tests, but the new production card uses the durable operation channel.
