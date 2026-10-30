# C4 Backoff Monitor and Follow-up Display Implementation

## Scope

- Date: 2026-09-28; checkout: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
- Active task: `09-11-initiative-intentions-acceptance`; root-supplied native identity:
  `codex_01a0e700-4c6f-7831-a73a-8c9fe0d33167`.
- Root authorized this additional bounded Desktop/transport slice after the backoff consumer handoff.
  Core server registration, wake/main/config, hard-cap composition and Monitor event projection remain root-owned.
- Existing frontend interaction-pattern, reactive-read-model, component, hook and state contracts were followed.
  One focused `jbcontext search` located the existing Monitor adjunct, then direct reads followed exact files.
- No commit/push/archive, new dependency, native launch, paid provider call or other-worktree edit occurred.

## Delivered behavior

### Independent protocol and current Monitor surface

Shared `initiative-backoff-schema.ts` now provides:

| Constant | Wire method |
| --- | --- |
| `INITIATIVE_BACKOFF_METHODS.read` | `observability.initiative-backoff` |
| `INITIATIVE_BACKOFF_METHODS.reset` | `initiative.backoff.reset` |
| `INITIATIVE_BACKOFF_METHODS.changed` | `observability.initiative-backoff-changed` |

`InitiativeBackoffReadParamsSchema` and `InitiativeBackoffChangedSchema` are strict `{ characterId }` contracts,
with matching inferred types. Existing status/reset shapes retain their meaning. Root owns their central exports
and registered server handlers. No field was added to the existing strict `InitiativeWakePolicyStatus` response.

The existing WsClient initiative facade exposes `initiativeBackoffRead`, `initiativeBackoffReset`, and
`onInitiativeBackoffChanged`. Responses and hints validate at the existing transport boundary. Changed hints
contain no status/content, isolate failing observers and retire with the physical client. Read and reset are
explicitly classified as interactive read-only and interactive unknown-outcome deadlines respectively.

The existing Monitor policy disclosure now includes `InitiativeBackoffView`; it has no new page or inbox.
It shows the actual stage, seven-day qualified weak count, current daily allowance usage and nullable wait time.
Absent data says unknown; a known zero remains zero. A null wait means no current backoff wait, not permission
to bypass other gates. The explicit reset button explains that global limits and real-world matters are unchanged.
The existing policy reason vocabulary includes both backoff spacing and daily refusals.

### Read, reset and recovery ownership

`InitiativeBackoffController` reuses `createReadCoordinator` and the existing current-client/Monitor-visibility
hook pattern. It installs the notification handler before the initial demand, ignores foreign Character hints,
coalesces finite invalidations into one trailing read and preserves permitted last-good content on failure.
Hidden/disabled Monitor surfaces perform no reads or React publication. No timer or render causes data polling.

Reset requires a current non-stale snapshot, an active usable client and no pending read/reset. It executes once.
Hide/show retains the mutation lock. Physical client retirement drops late success/failure from the old reset,
preserves an explicit unknown-outcome message and never resends it on reconnect. A successful new read cannot
prove or erase the outcome of an interrupted command.

An accepted reset applies its real echo and separately reconciles the current status. If that read fails, the
accepted reset feedback and the refresh error are both retained; the UI does not say that refresh succeeded.
The stale state disables another reset until the operator obtains current state. Transport errors are replaced
by bounded Chinese messages rather than raw exception/identity text.

### Follow-up tool details

The latest root-owned `plan-follow-up-tool.ts` already returns semantic fields only. This slice therefore adds
only a small presentation adapter at the existing `toolOutputDetails` seam. It displays Chinese outcome/state
and the finite start/end window, explains that a plan does not promise speech or resolve the reported matter,
and distinguishes a duplicate/expired plan from a new plan. It does not change canonical tool parts or add a store.

The adapter reuses field validators from the Shared Intention contract. Unknown/error shapes and missing output
do not fall back to raw `status.message`. Complete disclosure markup, accessible text and selectable result text
all use the same semantic projection. Additional historical/canonical IDs are ignored rather than stringified.
Root maintains the central Chinese tool label `安排后续跟进`.

## Changed files

- Shared: `initiative-backoff-schema.ts` and its test.
- Transport: `ws-client-initiative.ts`, `ws-client.ts`, `ws-client-routes.ts`, `rpc-deadline.ts`,
  `ws-client-initiative.test.ts`, and `lib/index.md`.
- Existing initiative feature: new `initiative-backoff-controller.ts`/test, `use-initiative-backoff.ts`,
  `initiative-backoff-view.tsx`, `follow-up-tool-display.ts`/test; modified `initiative-policy-diagnostics.tsx`,
  `initiative-wake-labels.ts`, and `index.md`.
- Existing Chat display: `tool-result-display.ts` and its folder index.
- Specs: frontend `interaction-patterns.md` and `index.md`; this implementation report.

## Verification

```text
pnpm --filter @taki/desktop exec vitest run src/features/initiative-patterns/initiative-backoff-controller.test.tsx src/features/initiative-patterns/follow-up-tool-display.test.tsx src/lib/ws-client-initiative.test.ts src/features/initiative-patterns/initiative-policy-controller.test.tsx src/features/initiative-patterns/pattern-tool-display.test.tsx src/windows/home/pages/chat/tool-result-display.test.tsx src/lib/rpc-deadline.test.ts
```

Passed: **7 files, 61 tests**. The new backoff controller suite has 10 cases, follow-up display has 4 cases,
and the expanded actual WsClient suite has 33 cases; existing adjacent tests supply the remaining regressions.

Covered cases include hidden/disabled reads, foreign hints, invalidation bursts, old read success/failure,
old reset success/failure after reconnect, retained unknown outcomes, hidden mutation locking, accepted reset
with failed refresh, real zero versus unknown, disabled controls, exact wire methods, strict response/push
validation, both socket and explicit close without replay, and deadline classification. Full disclosure/text
privacy tests use current producer-shaped results plus extra canonical bindings and prove the input is unchanged.

`pnpm --filter @taki/shared exec vitest run src/initiative-backoff-schema.test.ts`: **2 tests passed**.
Scoped ESLint over the changed Shared/Desktop source and tests: **passed**.
`pnpm --filter @taki/desktop typecheck`: **passed** after adding the two new backoff refusal labels.
`pnpm --filter @taki/shared typecheck`: **passed**.
Scoped `git diff --check` and direct byte/line checks across all 22 touched files: **passed**; the direct audit
includes new untracked files, verifies UTF-8 without BOM and rejects trailing whitespace. Existing Git CRLF/LF
normalization notice on `ws-client-routes.ts` is informational and did not fail the whitespace check.

Two implementation-test issues were fixed before the passing run: the enabled-button assertion now checks
the actual `disabled` attribute rather than a Tailwind class name, and Zod 4's refusal to `.pick()` a refined
schema is handled by reusing its individual field validators. The repository has no installed `jsdom`; no
dependency was added. Follow-up display testing uses the project's existing static-rendering strategy instead.

## Limits and follow-up

Later native follow-up: [backoff-native-implementation.md](backoff-native-implementation.md) records eight real
WebView2 assertions over this UI and a discovered/fixed pre-echo reset read race. Its scoped controller suite has
11 tests after that regression; the 61-test result above remains the earlier completed run, not a fabricated rerun.

- Static markup and selectable text validation do not establish actual native clipboard, focus, selection,
  geometry or owner acceptance. No native window was launched in this slice.
- Root must validate the registered server/authorization/invalidation producers, integrated Monitor lifecycle,
  hard-cap preservation and real user reset path in its formal/fullsource gate.
- No full suite, complete parent AC claim or new user approval is inferred from these focused checks.
