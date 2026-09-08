# Research: React 19.2 Home visual continuity

- Query: Which existing React primitives correctly preserve a coherent Home view during asynchronous selection, warm refresh, and transient notifications?
- Scope: Mixed; current Monitor/notification seams and official React documentation. Extends the prior refresh research rather than reopening its producer/cache design.
- Date: 2026-09-08

## Findings

### Recommendation and alternatives

Use the existing controller plus React-owned `useState` snapshot. Keep the committed selection visible while a separately identified candidate request runs, then publish the complete replacement in one state update. Preserve component identity during ordinary refresh. Use the existing Toast store for consumed operation outcomes. No new data framework, second rendering tree, or scheduling layer is necessary.

| Pattern | Appropriate use | Constraint / decision |
| --- | --- | --- |
| **A. Stage the request; publish one coherent snapshot through existing `useState`** | Run/Inspector replacement and warm refresh | **Recommended minimum.** Explicit request ownership supplies readiness; React batching and reconciliation supply the render/commit behavior. |
| **B. A plus `startTransition` / `useTransition` for expensive React rendering** | A measured expensive, non-urgent React-owned update | Optional after profiling. It adds interruptible rendering, not request ordering or retention. Displayed actions must still target the displayed snapshot. Do not wrap every controller emission. |
| **C. A plus `useDeferredValue` for a slow derived subtree** | Keeping input responsive while an expensive filtered list/chart catches up | Feasible for render cost, not this network-readiness defect. Defer the complete coherent projection, not only its identity. Adding Suspense does not make these controller RPCs suspend. |

The installed packages were read directly: React **19.2.7**, React DOM **19.2.7**, Zustand **5.0.14**. Home already uses `createRoot` and `StrictMode` (`apps/desktop/src/windows/home/main.tsx:20`). The official React site is rolling documentation; these are stable APIs applicable to this baseline, not a patch-specific specification.

### Files found and concrete patterns

Paths below are repository-relative. References describe the source inspected for this research; concurrent implementation may move lines.

| File / code pattern | Relevance |
| --- | --- |
| `apps/desktop/src/windows/home/pages/monitor/use-monitor-controller.ts:14` | A single `view` state receives the framework-free controller's complete snapshots. Keep this existing owner. |
| `apps/desktop/src/windows/home/pages/monitor/monitor-controller.ts:89` | `publish()` synchronously replaces imperative controller state, then emits it to React. React rendering can lag behind that state if emissions are deferred. |
| `apps/desktop/src/windows/home/pages/monitor/monitor-selection.ts:52` | `select()` calls `clear()` before fetching. `restore()` at line 64 treats any existing trajectory as warm, requests only one tail row, and reuses previous rows/cursors. Simply removing `clear()` while immediately changing the selected key would mix records. |
| `apps/desktop/src/windows/home/pages/monitor/monitor-detail-requests.ts:28` | `inspect()` advances `inspectedRowKey` and clears the Inspector before its RPC. Keeping only the payload would still pair the old payload with the new row. |
| `apps/desktop/src/windows/home/pages/monitor/monitor-page.tsx:36`; `monitor/monitor-layout.tsx:55` | The workspace key follows the current selected key; Inspector title, field key, and payload come from separate fields. They must advance together at replacement readiness. The loading paragraph at layout line 58 also changes geometry. |
| `apps/desktop/src/windows/home/pages/monitor/monitor-request-state.ts:26` | Unavailability codes already distinguish forbidden/disabled/missing Runs. `OBSERVABILITY_EVENT_NOT_FOUND` has an error message but is absent from the Run-unavailability set; retained Inspector behavior needs an explicit record-deletion rule. |
| `apps/desktop/src/components/toast/toast-store.ts:31`; `toast-host.tsx:23` | Existing bounded Zustand queue and fixed overlay are the correct surface. There is no event dedupe identity. The six-second default, hover pause, and deliberate click-to-hold are existing A4 reading behavior; keyboard reading needs equivalent protection. |
| `apps/desktop/src/windows/home/pages/settings/permission-controller.ts:62`; `use-permissions.ts:49` | An operation callback and read state both carry feedback. `sink.loaded(snapshot, state.feedback)` at controller line 158 can carry the prior outcome on later reads. Notify from the operation outcome, not every loaded snapshot. This is not proof of two rendered notices. |
| `apps/desktop/src/windows/home/pages/chat/composer.tsx:83` | Existing push-then-dismiss Effect is a useful consumption seam, but clearing React state alone is not proof of exactly-once delivery under replay/remount. |
| `apps/desktop/node_modules/zustand/react.js:8` | Zustand subscribes through `useSyncExternalStore`; its snapshot and transition caveats apply directly. |

The current [audit](audit.md) and [prior refresh research](../../09-08-uiux-triggered-refresh/research/react-refresh-continuity.md) remain the broader inventory. In particular, Perception's controller already retains the populated card; its page inserts a stale line before the activity card (`apps/desktop/src/windows/home/pages/perception/perception-page.tsx:58`). Preserve that owner and verify geometry rather than introducing another cache.

### Selection commit contract

1. Separate **requested identity** from **committed display identity**. Capture client, Character/authority scope, generation, and selection epoch for the candidate. Beginning B must not delete A or relabel A's trajectory/Inspector as B. A pending browser highlight is acceptable only when it is distinguishable from the displayed selection.
2. A different Run needs its own bounded initial trajectory and cursors. Do not pass retained A through B's same-Run warm `restore()` path. Keep existing same-Run summary/cursor recovery and subscription ordering intact.
3. After the candidate resolves, validate its scope and latest request epoch, then publish its committed key, trajectory/summary/cursors, and Inspector association/reset **together**. Inspector replacement similarly commits row identity, title source, payload, and loading/error metadata together. Do not synchronize these fields later with Effects.
4. While A remains displayed, row actions either explicitly carry A's displayed identity and are revalidated or remain unavailable during replacement. A deferred React view must never dispatch `inspect(A-row)` through a controller that silently targets B. Ordinary `setView(nextSnapshot)` is the smallest fit for the current imperative controller contract; blanket transition scheduling creates an additional mismatch window.
5. Guard success **and failure**, including close, hide, client retirement, scope change, and rapid A/B/C selection. A stale completion cannot reopen an Inspector, revive removed data, or clear a newer error. Preserve permitted content on a recoverable failed replacement; indicate which request failed. A confirmed deletion/revocation must remove the affected projection promptly. Distinguish a missing pending B from deletion of displayed A.

React's automatic batching groups related updates from events and promise callbacks; it does not turn an arbitrary sequence across `await` boundaries into a transaction. The complete snapshot is the domain consistency boundary. One controller publication also avoids exposing intermediate inconsistent snapshots to imperative readers. [R1]

### What the scheduling APIs do and do not guarantee

- **`startTransition` runs its callback immediately.** Wrapping today's `controller.select()` does not undo its synchronous `clear()` or preserve the deleted controller data. An empty projection remains a legitimate render while the RPC is pending; marking updates as non-urgent is not a data-readiness contract. Async callbacks after `await` require another `startTransition` for their React setters to be marked as transitions. [R2][R3]
- **Request ordering remains application-owned.** Custom async Actions can complete out of order. Keep the existing generation/epoch guards; neither `startTransition` nor `useTransition` supplies latest-selection-wins, cancellation, privacy eviction, or rollback. [R3]
- **`useTransition` adds `isPending`; standalone `startTransition` does not.** An awaited async Action can keep its transition pending through that work, but wrapping only the final setter tracks rendering, not the preceding RPC. Existing request state remains the source for network busy, failure, and retirement. Controlled input edits, closure, and authority-loss clearing stay urgent. [R2][R3]
- **`useDeferredValue` has no fixed waiting period and does not prevent requests.** Without a genuinely suspending read, React can finish the deferred empty/new-identity render before the RPC completes. It cannot keep arbitrary previous data until a controller becomes ready. Prefer a stable complete projection; allocating a fresh wrapper every render unnecessarily defeats its identity comparison. [R4]
- **Suspense only reacts to supported suspending sources.** These effect/action/controller RPCs followed by `setState` do not activate Suspense. Current official docs explicitly permit `use` with a cached Promise even without a framework; the same Promise instance must be reused across renders. This is a technically possible alternative, but converting these controllers would add promise-cache identity, authority, retirement, and error ownership. It is not the minimum fix for this task. Do not repeat the older blanket claim that all framework-free Suspense data loading is unsupported. [R5]
- **Zustand mutations are external-store updates.** Wrapping `store.setState()` in `startTransition` cannot make those mutations non-blocking. React rechecks `getSnapshot` before a transition's DOM commit and restarts as blocking if it changed. Suspending from a value read with `useSyncExternalStore` can replace revealed content with the nearest fallback. Keep immutable cached snapshots and narrow selectors; never allocate a new snapshot on every unchanged read. [R6]

### Reconciliation, progress, and notification ownership

- Preserve component type, parent position, and entity key through a same-resource refresh. A new array does not itself remount keyed children; a skeleton branch or changed parent/key can. Key a Run-scoped workspace by the **committed displayed Run** so any deliberate reset happens when the complete replacement is ready. Retain the Inspector field key until its committed row changes. Do not remove all keys and accidentally transfer record-specific state to a different entity. [R7]
- Stable DOM identity does not reserve layout space. Put a delayed refresh indication in existing reserved chrome or a non-displacing slot. Its one-shot timer controls only visibility of an actual in-flight state; it never delays the request/result or fabricates minimum loading time. Cancel it on settlement/retirement. Keep initial loading, successful empty, retained failure, disconnect and privacy uncertainty semantically distinct.
- Emit a transient notification from the already-guarded mutation result callback/event owner. Rendering a previously saved snapshot must not enqueue another event. Keep validation/conflict/connection/permission/privacy state discoverable through its existing actionable view; do not globally turn `FeedbackLine` into Toast. [R8]
- Give each outcome a stable **event/attempt identity**, scoped to its operation/resource/client lifetime. Coalesce repeated delivery of that event, including repeated read echoes; a later attempt with identical copy is a new event. Separately define replacement of older outcomes for the same operation/target so an old success cannot remain beside a newer failure. Text-only or permanent message dedupe is insufficient.
- If an Effect must bridge an event to Toast, synchronously consume/claim its identity at the existing owner before pushing. A replay must find it consumed, even if its closure still contains the old event. Dedupe only against currently visible Toasts is insufficient after dismissal/remount; producer consumption prevents replay. Do not emit Toasts in render, `useMemo`, React initializers, or functional state updaters. `StrictMode` can replay render/updaters and adds setup → cleanup → setup for Effects; keep it enabled. [R9][R10]
- Toast lifetime belongs to its exact event/card identity. Preserve the existing **six-second unpinned default and deliberate click-to-hold** until explicit dismissal, as confirmed in the current design. This reading affordance is separate from an unconsumed permanent inline success banner. Give keyboard focus equivalent reading protection, resume an unpinned timer only after pointer/focus pause reasons end, and clean it up on unmount/replacement. Duplicate delivery must not re-arm the deadline; a distinct attempt gets its own lifetime. Preserve selectable text, labelled close controls, Escape, and polite announcements. Effect cleanup must remove matching listeners/timers without consuming a newer event. [R9]

### Verification constraints for implementation

| Scenario | Required evidence |
| --- | --- |
| A displayed, deferred B, then C; out-of-order successes/failures | Every observed controller/render snapshot is coherent; A persists until the current replacement is ready; no A cursor/rows under C identity. |
| Inspector switch, close, missing record, forbidden response, client retirement | Old results never reopen/restore content; title/key/actions match visible detail; permission/deletion handling is scoped correctly. |
| Same-resource refresh with drafts/disclosure/reading | Compare actual node references, focused input/selection, and viewport anchors before, during, and after settlement. A final screenshot alone is insufficient. |
| Duplicate outcome and later same-text attempt, under StrictMode/remount | One event is consumed once; its later duplicate does not reappear after dismissal; the distinct attempt remains visible and supersedes prior status as intended. |
| Fast/slow refresh, pointer plus keyboard timer pause/resume | No fast text flash or vertical displacement; unpinned expiry and deliberate reading hold follow their documented behavior; no timer survives its owner. |

### Official references and related specs

Context7 was available: resolved React, then queried the official-site library `/websites/react_dev` for async transitions, external-store/Suspense interaction, and StrictMode. Direct reads of official React URLs supplemented exact batching, reconciliation, and event-ownership wording. Only generic framework questions and public URLs were sent externally.

- **[R1]** [React automatic batching](https://react.dev/blog/2022/03/29/react-v18#new-feature-automatic-batching) — introduced in React 18; applies to the existing React 19 `createRoot` baseline.
- **[R2]** [startTransition](https://react.dev/reference/react/startTransition) — immediate callback, post-await boundaries, no pending return.
- **[R3]** [useTransition](https://react.dev/reference/react/useTransition) — async Actions, pending state, and custom request-ordering limitations.
- **[R4]** [useDeferredValue](https://react.dev/reference/react/useDeferredValue) — background rendering, identity, no network suppression or fixed delay.
- **[R5]** [Suspense](https://react.dev/reference/react/Suspense) — supported sources and effect-fetching limitations.
- **[R6]** [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore) — cached snapshots, blocking fallback and store-driven suspension caveats.
- **[R7]** [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) — component position, type and keys.
- **[R8]** [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect#sharing-logic-between-event-handlers) — operation notifications belong to the corresponding event path.
- **[R9]** [useEffect](https://react.dev/reference/react/useEffect#my-effect-runs-twice-when-the-component-mounts) — cleanup and development replay.
- **[R10]** [useState](https://react.dev/reference/react/useState#my-initializer-or-updater-function-runs-twice) — pure initializers/updaters.

Related local contracts: `.trellis/workflow.md` research persistence; `.trellis/spec/frontend/state-management.md:24` atomic publication/authority and line 76 privacy allow-list; `reactive-read-models.md:15` generation guards, line 81 Monitor restoration, and line 195 editing/identity; `hook-guidelines.md:5` subscription ownership; `component-guidelines.md:5` render/dispatch boundary; `quality-guidelines.md:15` measured optimization. Update existing immediate/visible-refresh wording during the parent's spec synchronization to reflect the approved delayed, non-displacing indication.

## Caveats / Not Found

- This researcher ran no application, rendered test, profiler, or owner acceptance. The inherited controller reproductions do not establish native frame behavior or a duplicated permission notice.
- The child environment's `task.py current --source` returned `(none)` / `none`; `.trellis/.current-task` names an older task. Output uses the parent's explicit `09-08-uiux-visual-continuity` assignment. No task binding, production/spec file, process, dependency, or Git operation was changed.
- Cwd and branch were verified by reading worktree metadata: `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`. Version assertions come from this worktree's installed packages, not historical notes.
