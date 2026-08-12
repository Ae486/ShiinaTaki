# Research: Current WebSocket lifecycle and reconnect restoration surface

- Query: What does the current revision actually do for the pet, home, and chat operator sockets, and what must a D59/D61 implementation restore or settle?
- Scope: internal, current live code plus applicable specs and one archived defect report
- Date: 2026-08-07

## Executive conclusion

The current desktop has three independently owned operator-socket lifecycles: one pet socket, one home-settings socket, and a second home chat-page socket. Each lifecycle constructs exactly one browser `WebSocket` and one `WsClient` generation. An unexpected close marks the window's status disconnected and settles requests that the browser reports as closed, but it never creates another generation. The only recovery is to remount/reload the owning webview or page (`apps/desktop/src/lib/ws-transport.ts:17-28`, `apps/desktop/src/windows/pet/use-core-connection.ts:42-56`, `apps/desktop/src/windows/home/use-home-connection.ts:39-52`, `apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts:40-53`).

A reconnect implementation cannot merely replace the raw `WebSocket`. `createWsClient` allocates the JSON-RPC pair, the active streamed-turn slot, and all local push callback slots for exactly one transport generation (`apps/desktop/src/lib/ws-client.ts:99-107`, `apps/desktop/src/lib/ws-client-routes.ts:47-60`). A new socket therefore requires a new `WsClient`, a new handshake, new local callback registrations, and new server subscriptions. The old generation must be terminal and all of its callers must settle before the new generation becomes authoritative.

The three server subscriptions are provably connection-scoped. Avatar, timeline, and config registries key their sinks by the live Core `Connection`, and their method handlers register `ctx.onClose` cleanup (`packages/core/src/avatar/avatar-subscriptions.ts:19-46`, `packages/core/src/server/timeline-subscriptions.ts:25-56`, `packages/core/src/config/config-subscriptions.ts:19-35`, `packages/core/src/server/methods/avatar-subscribe.ts:20-25`, `packages/core/src/server/methods/timeline-subscribe.ts:20-28`, `packages/core/src/server/methods/config-subscribe.ts:20-25`). Nothing on a replacement socket inherits those registrations.

Actual close handling is substantially better than the stale pre-D29 state: pending JSON-RPC requests reject and an active streamed chat turn is explicitly terminated (`apps/desktop/src/lib/ws-client-routes.ts:150-154`). It is still incomplete in two important ways. First, `whenOpen()` waiters are never rejected if a socket closes before opening (`apps/desktop/src/lib/ws-client-routes.ts:139-157`). Second, every request can remain pending forever while the browser socket remains apparently open, because all outbound methods call `rpc.request(...)` without a deadline (`apps/desktop/src/lib/ws-client-methods.ts:56-65`, `apps/desktop/src/lib/ws-client-methods.ts:68-108`). D61's costume path additionally has unbounded Core requests and Tauri path composition around the only bounded renderer await (`apps/desktop/src/lib/resolve-switch-report.ts:24-45`).

Only the chat page currently renders connection status. The pet root and shared home shell retain status internally but show no window-level connecting/disconnected/error presentation (`apps/desktop/src/windows/home/pages/chat/chat-page.tsx:18-46`, `apps/desktop/src/windows/pet/pet-stage.tsx:47-67`, `apps/desktop/src/windows/home/home-shell.tsx:51-72`). D59's window-level status requirement is therefore current work, not a refactor of an existing common banner.

One additional design-critical fact is not explicit in the current PRD: a total costume-operation deadline is not automatically atomic. `PetScene.switchCostume()` attaches the new model before returning its vocabulary (`apps/desktop/src/renderer/pet-scene.ts:126-136`), while `avatar.report` happens afterward (`apps/desktop/src/lib/resolve-switch-report.ts:42-45`). `abortSwitch()` only invalidates a still-pending load ticket; it cannot undo an already attached model (`apps/desktop/src/renderer/pet-scene.ts:139-155`). A report timeout after attach can therefore leave the new costume visible while the operation reports failure and `saveLastCostume` is not advanced (`apps/desktop/src/features/character-import/use-costume-switch.ts:78-88`). The implementation plan must explicitly choose how to make that post-attach state truthful; merely wrapping the existing function in `Promise.race` is insufficient.

## Sources and authority

Current live code is authoritative. The active PRD and D59/D61 name the problem but intentionally mark implementation assumptions as temporary. Applicable executable guidance is:

- `.trellis/spec/frontend/index.md`: desktop package topology and quality gate.
- `.trellis/spec/frontend/hook-guidelines.md`: hooks own WS/client access; push handlers feed stores.
- `.trellis/spec/frontend/state-management.md`: windows do not share JS memory; guarded cached fetch treats `load === null` as no transport and explicitly assigns reconnection to D59.
- `.trellis/spec/frontend/home-window.md`: pet and home are separate windows; home owns two sockets, one shared request/response client and one chat-stream client.
- `.trellis/spec/backend/server-push-and-connection-auth.md`: server push is connection-scoped and `connect` precedes authenticated methods.
- `.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-costume-defect.md`: useful historical defect inventory only. Its old line references and pre-batch conclusions are corrected below where live code has moved on.

## Generation model

| Object | Allocated per | Survives a replacement socket? | Live evidence |
|---|---|---:|---|
| Browser `WebSocket` | `createBrowserTransport(url)` call | No | `apps/desktop/src/lib/ws-transport.ts:17-28` closes over one socket. |
| JSON-RPC server/client pair | `createWsClient` call | No | `apps/desktop/src/lib/ws-client.ts:99-104`. |
| Active chat turn slot | `createWsClient` call | No | `createRoutes()` creates `current: null`; `chat()` stores one generation-local turn at `apps/desktop/src/lib/ws-client.ts:114-126`. |
| Avatar/timeline/config callback slots | `createWsClient` call | No | Fresh `PushSlots` at `apps/desktop/src/lib/ws-client-routes.ts:47-60`; setters mutate only that `state` at `apps/desktop/src/lib/ws-client.ts:129-132`. |
| Server avatar/timeline/config subscription | Core `Connection`/socket | No | Registries key sinks by `Connection`; close removes them at the method anchors listed above. |
| Operator identity/token | browser `localStorage` for the origin | Yes, if each attempt reloads or updates it | Each hook calls `loadOrCreateIdentity(localStorage)` and stores a newly issued token (`apps/desktop/src/windows/pet/use-core-connection.ts:25-30,48`; home/chat equivalents at `use-home-connection.ts:19-24,44` and `use-chat-connection.ts:20-25,45`). |
| Pet renderer scene and React/Zustand view state | owning webview/component lifetime | Yes across socket replacement; no across webview close | Pet stage owns the scene while connection hook only changes store client/status (`apps/desktop/src/windows/pet/pet-stage.tsx:27-45`). |
| Home page cached snapshots | hook/webview, with a narrow persisted allow-list | Usually yes across replacement; some survive window close | `apps/desktop/src/lib/use-cached-fetch.ts:33-66`; `.trellis/spec/frontend/state-management.md` guarded cache contract. |

Callback setters therefore survive only inside one `WsClient` generation. Replacing only `WsTransport` under an existing client is not supported by the public or internal shape. Replacing `WsClient` is workable because the existing consumer effects depend on the client identity and will register callbacks on the new instance, provided the lifecycle owner publishes the new client only for the correct generation.

## End-to-end lifecycle map

### Pet socket

| Phase | Current behavior | Restoration consequence |
|---|---|---|
| Construct/publish | Mount-only effect creates transport/client, immediately stores the client, then sets `connecting` (`apps/desktop/src/windows/pet/use-core-connection.ts:42-47`). | A new generation must be published atomically enough that consumers do not send authenticated methods before its handshake succeeds. Current consumers also gate subscription/fetch work on `status.kind === "connected"`. |
| Open/handshake | `client.connect()` first waits for browser open, then sends `connect`; token is reused or saved (`apps/desktop/src/lib/ws-client.ts:110-113`, `apps/desktop/src/windows/pet/use-core-connection.ts:25-33,48-50`). | Every generation must authenticate before report/subscribe/request replay. A late old handshake result must not overwrite a newer generation's status. |
| Local callback | When scene + client + connected are all true, installs one avatar callback into that client's local slot (`apps/desktop/src/windows/pet/use-core-connection.ts:58-68`). | Register on every client generation. Within one generation, setter replacement prevents duplicate local delivery. |
| Initial report | Same effect fire-and-forgets a live vocabulary report without a costume id (`apps/desktop/src/windows/pet/use-core-connection.ts:62-67`). Core replaces its in-memory vocabulary and preserves an existing costume id only when one exists (`packages/core/src/server/methods/avatar-report.ts:20-24`, `packages/core/src/avatar/avatar-vocabulary.ts:55-65`). | Re-report after reconnect is required, especially after Core restart. Current report does not restore the formal worn costume id into a fresh Core process. This is a factual recovery gap to decide, not permission to broaden the protocol silently. |
| Server subscription | Same effect fire-and-forgets `avatar.subscribe` after local callback and report invocation (`apps/desktop/src/windows/pet/use-core-connection.ts:64-67`). Core stores it by this connection and removes it on close (`packages/core/src/server/methods/avatar-subscribe.ts:20-25`). | Resubscribe once per authenticated generation. No server replay exists for avatar commands missed while disconnected. |
| Initial imported costume | One-shot ref is set before `character.costumes` and switch/report work (`apps/desktop/src/windows/pet/use-initial-costume.ts:39-67`). | If a disconnect occurs after `promoted.current = true` but before promotion completes, later generations do not retry. Do not blindly repeat a successful promotion, but the failed-before-commit case needs an explicit policy if seamless recovery includes launch-time Core interruption. |
| Costume list/switch bridge | `useCostumeSwitch` selects the latest store client, reloads costumes whenever `connected` and client identity change, and holds single-flight state in the webview (`apps/desktop/src/features/character-import/use-costume-switch.ts:92-128`). Tauri command listeners route through a ref updated each render (`apps/desktop/src/windows/pet/use-costume-switch-event.ts:59-87`). | Publishing a new client causes a list refresh and future commands use it. An in-flight old request settles on real close; half-open work needs D61. Tauri listeners must not be re-registered per socket generation. |
| Bubble chat | Bubble reads the current store client; D29 error/finally releases pending (`apps/desktop/src/features/chat-bubble/use-chat-bubble.ts:40-66`). | Future sends naturally use the replacement client. A partially streamed old reply becomes an error and must not be resumed. |
| Close | Transport close marks status disconnected; `bindTransport` rejects pending RPC and aborts active chat (`apps/desktop/src/windows/pet/use-core-connection.ts:47`, `apps/desktop/src/lib/ws-client-routes.ts:150-154`). | Start backoff only for unexpected close; retain the terminal old generation for no further use. |
| Dispose | Cleanup sets a cancellation flag, closes the current client, and clears the store client (`apps/desktop/src/windows/pet/use-core-connection.ts:51-55`). | Disposal must cancel timers/attempts and prevent any late open/handshake callback from publishing a client/status. |

### Shared home-settings socket

| Phase | Current behavior | Restoration consequence |
|---|---|---|
| Construct/publish | Home shell mounts one lifecycle; mount-only effect creates and publishes one client (`apps/desktop/src/windows/home/home-shell.tsx:51-59`, `apps/desktop/src/windows/home/use-home-connection.ts:35-43`). | One lifecycle remains at window root while pages mount/unmount. Replacement client identity is the existing page-hook restoration trigger. |
| Open/handshake | Same token handshake shape as pet (`apps/desktop/src/windows/home/use-home-connection.ts:19-27,44-46`). | Authenticate before making the new client `ready`; generation guards are required around late results. |
| Config callback/subscription | Only the settings page registers `onConfigChanged`, then fire-and-forgets `config.subscribe` when `ready` changes (`apps/desktop/src/windows/home/pages/settings/use-config.ts:26-39`). | If settings is mounted, client replacement re-registers and resubscribes. If it is not mounted, no config subscription is needed until it mounts. Server config subscription is connection-scoped (`packages/core/src/server/methods/config-subscribe.ts:20-25`). |
| Page reads | Costume list, config list, memory status, media usage, perception card, and pause state all build loaders from the authenticated `ready` client (`apps/desktop/src/windows/home/pages/costume/use-costume-page.ts:58-68`, `apps/desktop/src/windows/home/pages/settings/use-config.ts:26-31`, `apps/desktop/src/windows/home/pages/operations/use-operations.ts:27-37`, `apps/desktop/src/windows/home/pages/perception/use-perception.ts:25-52`). | Client/status transition to a new connected generation re-runs the mounted page's current read(s). Do not centrally replay every page RPC; page hooks already own this behavior and only one registered page component is mounted at a time (`apps/desktop/src/windows/home/home-shell.tsx:54-69`). |
| Mutations/actions | Config save and most operations gate on `ready`; character import and media clear keep the raw client and surface close rejection (`apps/desktop/src/windows/home/pages/settings/use-config.ts:41-55`, `apps/desktop/src/windows/home/pages/operations/use-operations.ts:45-61`, `apps/desktop/src/features/character-import/use-character-import.ts:41-64`, `apps/desktop/src/windows/home/pages/operations/use-media-clear.ts:19-42`). | Do not replay mutations after reconnect. Settle the initiating call with a named failure; only read refreshes are safe to repeat. |
| Close | Close marks `disconnected`; old pending requests reject on a real close (`apps/desktop/src/windows/home/use-home-connection.ts:43`, `apps/desktop/src/lib/ws-client-routes.ts:150-154`). | Window-level status must explain why all pages are unavailable. A one-button refresh message remains misleading. |
| Dispose | Window cleanup closes client and clears local client state (`apps/desktop/src/windows/home/use-home-connection.ts:47-51`). | Stop reconnect immediately; do not keep the Core connection alive after the disposable window dies. |

### Chat-page socket

| Phase | Current behavior | Restoration consequence |
|---|---|---|
| Construct/publish | `ChatPage` owns a second socket distinct from the home-settings socket; its hook creates one client in a mount-only effect (`apps/desktop/src/windows/home/pages/chat/chat-page.tsx:39-46`, `apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts:36-44`). | Reconnect remains independent from the shared home client. Navigating away disposes this lifecycle because the page component unmounts. |
| Open/handshake | Same identity/token flow, device name `taki-chat` (`apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts:15-28,45-47`). | Authenticate each generation and protect status from old-generation completion. |
| Local callbacks | On authenticated client, timeline effect resets the store and installs appended + removed callbacks (`apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:66-88`). | Register callbacks before subscribe/history on each generation. Callback slots are new with each `WsClient`. |
| Subscribe/fetch | `subscribeAndLoad` subscribes first, then fetches newest history and merges it, so a concurrent append is deduped (`apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:17-23`). Server subscription is per connection and auto-cleans (`packages/core/src/server/methods/timeline-subscribe.ts:20-28`). | Preserve this ordering exactly: local handlers -> authenticated server subscribe -> history fetch/merge. It closes the subscribe/history race and reconstructs state from persisted timeline rather than stream replay. |
| Streamed send | One client-generation-local `current` slot receives deltas and completion/error (`apps/desktop/src/lib/ws-client.ts:114-126`, `apps/desktop/src/lib/ws-client-routes.ts:65-87`). UI `finally` releases `isSending` (`apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:90-99`). | Old turn settles as interrupted; no command replay and no partial-stream resume. A later persisted timeline entry, if any, is learned through normal history/push. |
| Close | D29 calls `onError(INTERNAL_ERROR, connection-lost)` and finishes the active turn, while RPC pending requests reject (`apps/desktop/src/lib/ws-client-routes.ts:103-115,150-154`). Core also aborts the turn owned by the closing request socket (`packages/core/src/server/methods/chat-send.ts:76-94`). | The old UI partial row is cleared by its error handler; replacement generation starts with timeline reset + authoritative history. |
| Dispose | Cleanup closes the page client and clears state (`apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts:48-52`). | Leaving chat must cancel attempts and prevent background reconnection for an unmounted page. |

## Work settlement inventory

| Work owned by one generation | On a real close today | On a half-open/non-answering socket today | Reconnect implication |
|---|---|---|---|
| `connect()` waiting for browser open | **Can hang:** close sets `closed` but does not reject `openWaiters` (`apps/desktop/src/lib/ws-client-routes.ts:139-157`). | Hangs. | Generation termination must reject open waiters as well as JSON-RPC requests. |
| Handshake request after open | Rejected by `rejectAllPendingRequests` and reaches hook catch (`apps/desktop/src/lib/ws-client-routes.ts:150-154`; hook catches at pet `use-core-connection.ts:48-50`). | Hangs because handshake has no deadline (`apps/desktop/src/lib/ws-client-methods.ts:56-65`). | Bound handshake/attempt and prevent old catch/outcome from overwriting new state. |
| Ordinary JSON-RPC request | Rejected by `rejectAllPendingRequests` (`apps/desktop/src/lib/ws-client-routes.ts:150-153`); covered by D29 test (`apps/desktop/src/lib/ws-client.test.ts:277-285`). | Hangs; every method is a bare `rpc.request` (`apps/desktop/src/lib/ws-client-methods.ts:68-108`). | Add an initiator-owned deadline that removes/rejects the library's pending entry, not a detached UI-only race. Never replay mutations. |
| Chat before send ack | RPC rejection causes `chat()` to clear its stale turn and reject; close also calls `abortTurn` (`apps/desktop/src/lib/ws-client.ts:114-125`, `apps/desktop/src/lib/ws-client-routes.ts:150-154`). | Hangs. | Settle exactly once despite the ack/abort race; no automatic resend. |
| Chat after ack, while streaming | `abortTurn` calls the error handler and resolves the turn (`apps/desktop/src/lib/ws-client-routes.ts:103-115`). | Hangs until browser reports close. | D29 must remain intact; lifecycle health detection/deadline policy must decide how a silent stream is detected without fabricating completion. |
| Cached page read | Close rejection reaches `useCachedFetch`, stops loading/refreshing, preserves old data (`apps/desktop/src/lib/use-cached-fetch.ts:41-51`). | Remains loading/refreshing. | Replacement client's loader triggers a new generation; stale-load generation guard prevents old result overwrite (`apps/desktop/src/lib/use-cached-fetch.ts:39-50`). |
| Tidy/import/media clear/config set/perception set | Their catch/finally paths settle on close rejection (for example `use-operations.ts:45-57`, `use-character-import.ts:46-64`, `use-media-clear.ts:24-39`, `use-config.ts:41-55`, `use-perception.ts:54-66`). | UI busy state can remain indefinitely. | Deadlines release local guards. Report failure; do not replay side-effecting requests. |
| Manual costume switch | A close during either Core RPC rejects and `runGuardedSwitch.finally` releases its guard (`apps/desktop/src/features/character-import/use-costume-switch.ts:69-89`). | `costumeResolution`, asset resolver, or `reportAvatar` can hold the guard forever; only renderer load is bounded (`apps/desktop/src/lib/resolve-switch-report.ts:24-45`). | D61 must bound the whole caller-owned operation while preserving late-load invalidation and truthful post-attach state. |
| Home costume result wait | Independent 45-second Tauri result deadline already releases the home row (`apps/desktop/src/windows/home/pages/costume/use-costume-page.ts:28-55,78`). | Settles at its local deadline. | Do not conflate this cross-window deadline with the pet's internal D61 guard. |

## D29 and why a partially streamed turn must not resume

D29 is implemented, not open. On close, `bindTransport` rejects request acknowledgements and calls `abortTurn`; `abortTurn` clears the one active turn slot, invokes its `onError` with `INTERNAL_ERROR`, and finishes the promise (`apps/desktop/src/lib/ws-client-routes.ts:103-115,150-154`). Tests prove a mid-turn close settles and a post-close send rejects (`apps/desktop/src/lib/ws-client.test.ts:250-285`). The chat timeline handler clears its in-flight row on that error, and the bubble turns its reply into an error (`apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:39-47`, `apps/desktop/src/features/chat-bubble/use-chat-bubble.ts:17-27`).

Resume is neither safe nor supported:

1. Stream notifications are sent through the request socket's `ctx.notify`, not a resumable subscription. The Core binds close to that turn's `AbortController` because nobody is listening on the old socket (`packages/core/src/server/methods/chat-send.ts:76-94`).
2. A new `WsClient` has a fresh `Routes.current` and no mapping from an old `messageId` to new handlers (`apps/desktop/src/lib/ws-client-routes.ts:42-60`).
3. Timeline recovery already has the correct durable seam: subscribe before fetching history, then merge by sequence (`apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:17-23`). The UI may later learn a committed result through timeline state, but it must not append an unverifiable continuation to the old partial row.

Therefore reconnect must terminate the old turn, clear partial presentation through the existing error path, and reconstruct the new page generation from timeline subscription/history. Automatic `chat.send` replay would risk duplicate user turns and is a scope violation.

## Reconnect restoration matrix

| Obligation | Pet | Shared home | Chat page |
|---|---|---|---|
| Independent transport/client generation | Required | Required | Required |
| Status transition | connecting on first attempt; reconnecting/disconnected/error policy needed | Same; must render at shell/window level | Existing banner must gain reconnect semantics rather than remain terminal disconnected |
| Reload identity/use newest saved token | Required | Required | Required |
| `connect` handshake | First authenticated operation | First authenticated operation | First authenticated operation |
| Register local push callback(s) | Avatar command before subscription | Config changed only while settings page mounted | Timeline appended + removed before subscription |
| Restore server subscription | `avatar.subscribe(taki)` once/generation | `config.subscribe()` once/generation while settings mounted | `timeline.subscribe(taki)` once/generation |
| Restore report | Live scene vocabulary; decide how to include current costume on fresh Core | None | None |
| Restore authoritative read | Costume list refresh; launch-time promotion needs failed-before-commit policy | Mounted page reads: costume/config/operations/perception | Timeline history after subscribe |
| Settle old active stream | Bubble turn through D29 | N/A | Chat turn through D29 |
| Settle old ordinary requests | Reject, no mutation replay | Reject, no mutation replay | Reject, no send/cancel replay |
| Preserve non-socket listeners/state | Tauri costume listeners remain one per component, scene remains live | Navigation/result listeners and SWR data remain page/window-owned | Draft remains component-owned; timeline store resets/rebuilds on new client |
| Stop on disposal | Pet window cleanup | Home shell cleanup | Chat page unmount/navigation |

### Ordering constraints

1. Mark the old generation terminal and settle/cancel its open waiters, JSON-RPC requests, and active chat turn before publishing a replacement as authoritative (`apps/desktop/src/lib/ws-client-routes.ts:137-158`).
2. Create a fresh transport and fresh `WsClient`; callback slots cannot be transferred (`apps/desktop/src/lib/ws-client.ts:99-107`, `apps/desktop/src/lib/ws-client-routes.ts:59-60`).
3. Handshake with the current stored credential. Only an authenticated generation may transition to `connected`; the Core rejects all non-connect pre-auth requests and closes the socket (`packages/core/src/server/ws-server.ts:114-122`).
4. Guard every asynchronous open/handshake completion by generation/disposal identity. Current hooks have only a component-lifetime `cancelled` boolean, so an old attempt could otherwise overwrite a newer status (`apps/desktop/src/windows/home/use-home-connection.ts:39-51`; same shape in pet/chat).
5. Install local callback slots before asking the Core to publish. For chat, preserve local handlers -> `timeline.subscribe` -> `timeline.history` (`apps/desktop/src/windows/home/pages/chat/use-chat-timeline.ts:17-23,76-88`).
6. Restore each server subscription at most once per successful generation. Core registry insertion is idempotent for one connection, but every subscribe call also adds another close cleanup callback (`packages/core/src/server/methods/timeline-subscribe.ts:20-28`), so client-side duplicate calls are still unnecessary.
7. Trigger only idempotent reports/reads automatically. Never replay chat sends, imports, config writes, tidy, media clear, pause writes, or costume commands.
8. Stop backoff timers and close any in-construction/current transport on component disposal. Late callbacks must become no-ops (`apps/desktop/src/windows/pet/use-core-connection.ts:51-55`, home/chat equivalents).

## Current window-level status rendering

| Surface | State available | Visible behavior today | Evidence |
|---|---|---|---|
| Pet | Zustand union has connecting, connected, pairing-required, disconnected, error | No connection presentation. Pet stage renders only renderer/click-through errors and toast host. Bubble remains interactive and reports a failed send only after click. | `apps/desktop/src/stores/connection-store.ts:14-32`; `apps/desktop/src/windows/pet/pet-stage.tsx:47-67`; `apps/desktop/src/features/chat-bubble/use-chat-bubble.ts:53-63`. |
| Home settings-family pages | `HomeClientContext` provides client + status | Shell renders no status. Pages gate many calls on `connected`, so actions can silently no-op; cached refresh is explicitly a no-op when no loader. Raw-client actions fail only after invocation. | `apps/desktop/src/windows/home/home-client-context.ts:12-20`; `apps/desktop/src/windows/home/home-shell.tsx:58-72`; `apps/desktop/src/lib/use-cached-fetch.ts:41-42`; `apps/desktop/src/windows/home/pages/settings/use-config.ts:41-44`. |
| Chat page | Local status union | Banner renders initial connecting, pairing, disconnected, or error. Composer does not receive connection readiness, so it remains editable/sendable while the banner says disconnected; `client.chat()` then rejects through D29's closed check. | `apps/desktop/src/windows/home/pages/chat/chat-page.tsx:18-54`; `apps/desktop/src/windows/home/pages/chat/composer.tsx:102-150`; `apps/desktop/src/lib/ws-client.ts:114-116`. |

The shared `ConnectionStatus` currently has no `reconnecting` case (`apps/desktop/src/stores/connection-store.ts:14-19`). Whether reconnecting is additive state or connecting-with-attempt metadata is a design choice, but all exhaustive switches (currently chat status text) must remain exhaustive if the union changes (`apps/desktop/src/windows/home/pages/chat/chat-page.tsx:18-30`).

## Existing deterministic tests

- The fake transport harness can open, deliver frames, and close synchronously (`apps/desktop/src/lib/ws-client.test.ts:13-38`). It already proves route parsing, handshake outcomes, callback routing, D29 mid-turn settlement, post-close rejection, and ordinary pending-request rejection (`apps/desktop/src/lib/ws-client.test.ts:47-248,250-337`).
- `resolve-switch-report.test.ts` proves current successful order/data and proves renderer failure calls `abortSwitch` and skips report (`apps/desktop/src/lib/resolve-switch-report.test.ts:33-78`).
- `pet-scene.test.ts` proves `abortSwitch` makes a still-pending model load self-discard and remains idempotent (`apps/desktop/src/renderer/pet-scene.test.ts:82-128`).
- Cached-fetch reducer tests cover retaining data on connection failure, but they do not exercise socket replacement (`apps/desktop/src/lib/cached-fetch-state.test.ts:38-41`).

Missing regression seams found by the repository test sweep:

1. No deterministic lifecycle/controller test creates generation N, closes it, advances fake timers through backoff, creates N+1, and proves disposal stops future attempts.
2. No hook test covers pet/home/chat generation publication, late old-handshake suppression, or status rendering across reconnect.
3. No test proves avatar/config/timeline callbacks and server subscription calls occur exactly once per generation.
4. No test covers close-before-open; the current fake harness invokes open/close independently but existing cases always open first (`apps/desktop/src/lib/ws-client.test.ts:21-38,250-285`).
5. No test holds an RPC open until its deadline and verifies the JSON-RPC pending entry is actually removed/rejected.
6. No test holds each of `costumeResolution`, asset composition, renderer load, and `reportAvatar` independently to prove one total budget, guard release, and late-result safety.
7. No test covers the post-attach/report-timeout divergence described in the executive conclusion.
8. No component test covers the pet/home window-level connection presentation. The existing home shell test is static presentation coverage, not connection lifecycle coverage.

## Stale and superseded assumptions corrected

1. The archived settings research correctly identified no reconnect and unbounded costume awaits, but its statement that home costume switching had no feedback channel is superseded. The live code now has typed switch/cancel/result Tauri events and a 45-second initiating-page deadline (`apps/desktop/src/windows/home/pages/costume/use-costume-page.ts:1-7,28-55,71-98`, `apps/desktop/src/windows/pet/use-costume-switch-event.ts:1-7,35-87`). D61 now concerns the pet executor's internal operation, not the already bounded home result row.
2. The archived report's "failed character.costumes wipes the list forever" observation remains true inside the pet's executor hook for one failed refresh (`apps/desktop/src/features/character-import/use-costume-switch.ts:102-109`), but a correctly published replacement client will change `refresh` identity and retry through the existing effect (`apps/desktop/src/features/character-import/use-costume-switch.ts:110-114`). No extra cached-fetch fix is needed for that reconnect path.
3. Comments in pet/chat hooks claiming loopback still requires one-time pairing are stale. Live Core code already auto-trusts a credential-less loopback operator when configured and returns a token for reconnect (`packages/core/src/server/methods/connect.ts:90-103`). The UI must still preserve pairing-required/error states for kill-switch or non-loopback configurations.
4. D29 is closed in live code and tests. Any design based on active chat hanging forever after an actual close is stale (`apps/desktop/src/lib/ws-client-routes.ts:103-115,150-154`, `apps/desktop/src/lib/ws-client.test.ts:250-285`). The remaining problem is close-before-open and half-open/no-response work.
5. The legacy `main` window's Rust-node/Core status is not evidence that operator sockets reconnect. Current home/pet operator hooks are browser WebSockets and never consume that channel (`apps/desktop/src/lib/ws-transport.ts:17-28`, `apps/desktop/src/windows/home/use-home-connection.ts:39-52`, `apps/desktop/src/windows/pet/use-core-connection.ts:42-56`).

## Scope classification

### Required to close D59/D61

- One shared, testable generation lifecycle used by pet, home, and chat while preserving three independent socket owners.
- Fresh transport + fresh `WsClient` per attempt; explicit generation/disposal guards.
- Bounded backoff/jitter policy (values to be justified by the separate library/API research), stopped on disposal.
- Handshake before connected/restoration, using the newest saved credential.
- Per-generation callback registration and exact avatar/timeline/config subscription restoration.
- Pet vocabulary re-report and mounted-consumer idempotent refetches; timeline subscribe-before-history ordering.
- Old-generation settlement including close-before-open waiters, pending requests, and D29 active turns.
- Initiator-owned request deadlines that clean the JSON-RPC pending registry; no detached `Promise.race` leak.
- Window-level status in pet and shared home, plus chat reconnect wording/action gating.
- Full costume-operation budget, guard release, late-load invalidation, and an explicit truthful policy for failure after model attach but before report/persistence.
- Deterministic regression tests for the above and manual Core stop/start coverage.

### Useful extras only if they directly support the required contract

- Minimal attempt number or last-error metadata for a window-level reconnect message.
- A manual retry command after terminal auth/pairing failure, if automatic retry intentionally stops for those classes.
- Targeted logs for generation id, attempt, close reason, and restoration failure. These materially improve diagnosis without creating telemetry infrastructure.
- A failed-before-commit retry state for initial costume promotion. This is useful and may become required if acceptance explicitly includes Core interruption during first pet boot; it must not blindly reload a successfully promoted scene.
- Restoring the formal current costume id when a reconnect reaches a freshly restarted Core. The vocabulary is definitely restored today, but the costume id is not; decide this alongside the post-attach D61 policy rather than smuggling it into a generic reconnect helper.

### Scope violations

- Replaying a partially streamed chat turn or automatically resending any operator mutation.
- Offline queues, durable reconnect state, or `localStorage` connection authority.
- Sharing one socket/client across pet and home windows, or sharing chat streaming state with the home request/response client.
- Changing the Rust node-to-Core transport or legacy `main` status channel.
- Adding new Core push protocols when existing per-socket avatar/timeline/config channels suffice.
- Fixing unrelated page/cache/perception behavior that already re-runs correctly when given a new authenticated client.
- T4 heartbeat/proactivity implementation.

## Caveats / Not found

- This was a static current-revision audit. No real Core stop/start, sleep/resume, firewall half-open, or packaged WebView2 test was run.
- The separate research topic should determine the installed `json-rpc-2.0` cancellation API and a justified backoff/deadline implementation. This report only proves the current call sites and leaks; it does not invent library behavior or timing constants.
- Browser WebSocket `close` events are the current only failure signal exposed by `WsTransport`; it exposes neither `error`, close code/reason, ping/pong health, nor an explicit abort for a pre-open attempt (`apps/desktop/src/lib/ws-transport.ts:9-28`). Whether half-open detection requires application heartbeat is not proven here and should not be assumed merely from request deadlines.
- Core-side server subscriptions are idempotent per connection because map insertion replaces the sink, but duplicate subscribe requests still append duplicate `ctx.onClose` callbacks. Exact-once client restoration remains the cleaner contract (`packages/core/src/server/methods/avatar-subscribe.ts:20-25`, `packages/core/src/avatar/avatar-subscriptions.ts:24-36`).
- The current pet re-report after connect omits costume id, while Core restart loses the in-memory vocabulary record. The impact on one-shot costume-change baseline is source-proven, but the product-expected behavior after Core restart needs owner/Leader adjudication (`packages/core/src/avatar/avatar-vocabulary.ts:51-65,81-92`).
- The current PRD statement that a late renderer must not attach without identity/report commit is fully protected only while `switchCostume` is still pending. The post-attach `avatar.report` failure case needs a deliberate design change or a revised truthful acceptance statement; current APIs do not provide rollback.
