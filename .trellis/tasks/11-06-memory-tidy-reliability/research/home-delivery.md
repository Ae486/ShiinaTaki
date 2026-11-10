# Home tidy implementation

## Delivered behavior

- Reused the existing `useMemoryOperations` / `MemoryOperationsController`; the Operations page has one operation subscription owner. Tidy admission uses `memory.operations.submit`; a busy refusal looks up the returned operation ID and never resubmits.
- After the shared subscription acknowledgement, the controller reads authority status and the filtered latest tidy independently. `kind=tidy`, the active Character and limit one are sent to Core, so unrelated recent operations cannot hide the latest tidy. Changed pushes, remount, reconnect and explicit refresh recover Core truth without polling or mutation replay.
- Read authority started before a new mutation is retired. Hidden pages keep one dirty obligation, do not publish/read repeatedly, and recover on return. A late retired client cannot replace a current result.
- The tidy card shows Core progress, successful/partial/failed/interrupted outcomes, remaining work, bounded-retry/configuration guidance and explicit refresh. No submitted request is described as completed work.
- Initial zero counters are not displayed as an old provider's confirmed interrupted result. Final outcomes override initial progress counts; missing review coverage remains unreported rather than zero.
- Accepted feedback is correlated by operation ID and retired when that operation settles, so an interrupted card cannot retain a green accepted message beneath it.
- Closed issue stage/field becomes useful Chinese guidance; IDs/raw tool names are not rendered. New/stale/duplicate candidates are labelled as candidates, not confirmed wrong memories.
- A new observed terminal tidy invalidates the existing memory/storage counters. The global refresh action also refreshes durable operation state.
- Removed the obsolete ephemeral tidy hook/controller. Their request-lifetime tests were replaced with durable operation recovery scenarios; the old WsClient `memoryTidy` method remains intact for compatibility.

## Files

Production changes are confined to `apps/desktop/src/windows/home/pages/operations/`: shared operation controller/hook, operation page, tidy card/state projection, status labels, authority feedback/kind label, and counter hook. Added a test fixture and recovery tests, updated rendered-card tests and affected authority/page fixtures, and updated both touched directory indexes.

Removed orphan files: `memory-tidy-controller.ts`, `use-memory-tidy.ts`, and the old controller test. No Core/Shared code, live data, task lifecycle, commits or runtime deployment was changed by this implementer.

## Validation

From `H:/TakiAgent-worktrees/t4`:

```powershell
pnpm --filter @taki/desktop test src/windows/home/pages/operations src/windows/home/resource-state-pages.test.tsx
pnpm exec eslint apps/desktop/src/windows/home/pages/operations apps/desktop/src/windows/home/resource-state-pages.test.tsx
pnpm --filter @taki/desktop typecheck
git diff --check -- apps/desktop
```

Results: 9 test files / 71 tests passed; scoped ESLint, full Desktop typecheck and whitespace check passed. The tests exercise subscription ordering, filtered recovery, busy join, response loss, reconnect/remount, interruption, pre-submit read retirement, hidden page behavior, independent read errors, rendered outcome/next-action labels, candidate wording, and legacy missing-progress presentation.

The parent independently ran a real WS/operation-owner/controller/card browser smoke. Its two visual findings (stale accepted feedback and overly generic invalid-reference wording) were fixed with rendered regressions here. The parent owns final browser rerun and actual Canonical runtime integration; this implementer's static rendering/controller tests do not establish those paths or human acceptance.

## Follow-up: explicit not-needed outcomes

Shared now exposes separate `recoveredIssues` and `skippedIssues`. The card shows nonzero corrected calls and explicitly not-needed operations separately, without counting either as additional saved edits or unresolved failures. Focused rendered-card regression and scoped lint passed after this additive contract change. No new execution state is inferred in the UI.
