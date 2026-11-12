# Desktop S8/S10 follow-up — 2026-10-30

## Scope and authority

Implemented in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, after the coordinator's
S7a source release and Runtime owner's frozen Shared contract. The coordinator's explicit active task is authoritative;
the unrelated legacy `.trellis/.current-task` was not changed. Original PRD/design/implementation guidance, frontend
specifications and `checkin-advisor-20261030.md` were loaded before source writes.

Desktop owns only its source/controllers/client adapters/tests/indexes and the delivered frontend specification updates.
Runtime owns Core/Shared/config registration; acceptance owns `apps/desktop/test`, native and production integration.
Existing candidate preimages were copied under `target/desktop-followup-20261030/` before editing. No dependency,
Git delivery, credential read, database mutation, Timeline/Memory write or new task was performed.

## Delivered behavior

- Home mounts a lightweight attention owner in the sidebar even while Chat is selected and Subagents was never opened.
  `subagent.changed` observation is installed before acknowledged subscription. Each explicit page reads at most 20
  Shared attention entries; real hints coalesce through the existing read coordinator and return paging to the first
  page. Document hide retires reads/publication while retaining the gap; reconnect restores reads only.
- Persistent entries distinguish user-input escalation, reconciliation-needed batches, user-required check-ins and
  exhausted pre-intent retries. They provide exact child/work navigation. Core-allowed reconciliation has an explicit
  exact-consumer recovery action with retained operation identity after response loss. Retry exhaustion has an explicit
  `subagent.inbox.retry` action without fabricating a consumer or replaying a delivered batch. Both serialize locally,
  preserve unknown-outcome feedback and never resubmit automatically after reconnect.
- Generic attention Toasts contain no private body/name/receipt and use existing event identity consumption plus one
  replacement group. A bounded recent ledger retains the latest 200 attention identities across refresh/reconnect;
  the persistent paged Core projection remains discoverable beyond that notification ledger. Sidebar overflow is
  scrollable so controls remain reachable without displacing the Chat viewport. The existing recovery disclosure opens
  when outstanding records are loaded.
- Child headers and list show cumulative Core token evidence. No calls, reported zero, unknown total, known incomplete
  subtotal, in-flight calls and missing usage remain distinct. Current work progress uses captured N/K and actual
  approvals; `post_upgrade` is labelled inline as upgrade-era recorded steps, with older step count explicitly unknown.
- Open check-in waits offer empty-draft Continue or draft redirect-and-continue through one existing exact-target RPC,
  with the exact `replyToEventId`. User Stop remains independent and user-only. Existing draft, paging, transcript,
  selection, activity, reading anchor and reconnect controllers remain in place.
- Existing Settings metadata editors expose both registered N/K knobs with Chinese labels and next-interval guidance.
  K=0 remains a valid integer input. The UI adds no configurable state store; Core captures changes for new work or
  the next interval and does not downgrade an already user-required wait.
- Co-Watching's existing `paused_child` card now uses neutral pause wording. It no longer implies that every pause is
  a user Stop or requires the user; exact actor/question/check-in details are read in the shared private conversation.
  Existing Co-Watching navigation and session Stop controls remain unchanged.

## Files changed

- New `features/subagents/`: `subagent-attention-controller.ts` and tests, `use-subagent-attention.ts`,
  `subagent-attention.tsx` and tests, `subagent-progress.tsx` and tests.
- Existing `features/subagents/`: `subagent-conversation-header.tsx`, `subagent-composer.tsx`, `subagent-list.tsx`,
  `subagent-inbox-recovery.tsx`, `subagent-controller.test.ts`, `index.md`.
- `features/co-watching/`: `chat-co-watching-invitation.tsx`, its test and `index.md`.
- `lib/`: `ws-client-subagent-inbox.ts`, `rpc-deadline.ts`, its test and `index.md`.
- `windows/home/`: `home-shell.tsx`, `index.md`; `pages/settings/config-groups.ts`, its test, `knob-field.tsx`,
  its test and settings `index.md`.
- Delivered specs: `.trellis/spec/frontend/home-window.md` and `reactive-read-models.md`.
- This checkpoint. All Desktop source paths above are under `apps/desktop/src/`.

## Checks and evidence

Node-side deterministic/static presentation evidence only; these are not native or human acceptance claims.

```powershell
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-attention-controller.test.ts src/features/subagents/subagent-attention.test.tsx src/features/subagents/subagent-progress.test.tsx src/features/subagents/subagent-controller.test.ts src/features/subagents/subagent-presentation.test.tsx src/features/subagents/subagent-inbox-controller.test.ts src/features/co-watching/chat-co-watching-invitation.test.tsx src/windows/home/pages/settings/config-groups.test.ts src/windows/home/pages/settings/knob-field.test.tsx src/windows/home/home-shell.test.tsx src/lib/rpc-deadline.test.ts
```

11 files / 54 tests passed at 16:47:58 local time, before the final exhausted-retry delta. Coverage includes exact
check-in Continue, draft retention, no automatic mutations, unknown usage, sidebar rendering, Settings numeric parser,
acknowledged observation, coalesced hints, old-generation rejection, hidden-command settlement and Co-Watching copy.

```powershell
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-attention-controller.test.ts src/features/subagents/subagent-attention.test.tsx src/features/subagents/subagent-progress.test.tsx
```

Final additive delta: 3 files / 14 tests passed at 16:59:21 local time. This covers explicit pre-intent retry, unknown
outcome and reconnect without mutation replay, its distinct persistent UI and the inline post-upgrade count label.
Scoped ESLint passed for the full owned source change and again for the final delta. `git diff --check` passed
(Git emitted only existing CRLF-to-LF notices). No check severity was lowered and no test was removed.

An intermediate Desktop typecheck correctly identified old test fixture output lacking Shared `progress/tokenUsage`.
The acceptance owner added nulls to `apps/desktop/test/s7-subagent-data.ts`; null is truthful because that scripted
fixture has no cumulative usage evidence. The earlier source question fixture also gained `reason: question/checkIn: null`.
Final `pnpm --filter @taki/desktop typecheck` passed after the fixture update and final exhausted-retry delta.

## Remaining acceptance boundaries

- The coordinator/acceptance owner must verify real Core → authenticated WS → Home attention for all four kinds,
  including attention resolved by accepted exact user guidance and exhausted retry that does not release/replay a
  delivered consumer. Browser fixtures alone do not prove those producers.
- Actual WebView2 must exercise continued foreground Chat, one coherent child transcript, N=50/K=3 and operator
  changes, exact Continue/redirect, independent user Stop, pending drafts, selection/scroll/paging, hidden-page attention
  and reconnect. Native rendering/geometry and personal owner acceptance remain unpassed by this checkpoint.
- Cumulative usage is Core evidence; provider completeness and Utility/child scope require Runtime/real-model gates.
  No token amount or progress is manufactured by the client. Legacy historical steps remain explicitly untracked.
- Whole-workspace/build/native/real-model verification belongs to the coordinator's later integrated gate. No new
  provider calls or native campaign were started by this Desktop agent.
