# Research: D59 window recovery UX and D61 costume-switch contract

- Query: What does the current code actually do across home-to-pet costume commands, failures, cancellation, WebSocket loss, reconnection, page restoration, and visible connection state; what contract must D59/D61 preserve or add?
- Scope: internal code, specs, archived task evidence, and owner-accepted manual checks
- Date: 2026-08-07

## Executive findings

1. Batch 6 already replaced the former one-way costume command with a bidirectional, result-bearing Tauri protocol. Home owns a 45-second response deadline and releases itself before sending Cancel. Manual checks #74 and #75 are recorded as owner-passed. Any D61 work must preserve this protocol rather than redesign it.
2. The pet executor still has four asynchronous stages: `character.costumeResolution`, Tauri path/asset composition, renderer load, and `avatar.report`. Only the renderer load has a 30-second timeout. The two RPCs can wait forever on a half-open socket, and Tauri path IPC is also unbounded.
3. Both generic per-RPC deadlines and one whole costume-operation deadline are necessary for the combined D59/D61 scope. Per-RPC deadlines protect all desktop request/response calls and clean the JSON-RPC pending map; they do not bound Tauri IPC. A whole-operation deadline covers the cross-technology sequence and the single-flight guard; by itself it is not acceptable if implemented as a non-cancelling `Promise.race`, because the abandoned chain can continue.
4. The current switch ticket protects only a renderer load that has already obtained a ticket. Cancel or a whole-operation timeout while the operation is still waiting before `scene.switchCostume()` does **not** prevent that continuation from later obtaining a fresh ticket and attaching. After the renderer has already attached but `avatar.report` is pending, `abortSwitch()` also cannot roll the attachment back. D61 therefore needs stage-aware cancellation/commit semantics, not just a wider timeout wrapper.
5. Current UI connection state is inconsistent: chat has a persistent banner; pet and the non-chat home pages show no Core connection state. Toasts are explicitly transient and are not the correct surface for persistent liveness. The minimal established-pattern solution is one status mapping used at each connection owner's scope, with a home/chat banner and a compact pet-overlay status line.
6. Replacing the `WsClient` object on each successful generation will naturally re-run most current page loads/subscriptions because their effects depend on `client`/`ready`. A stable wrapper would instead require an explicit generation dependency. This must be tested; status change alone is insufficient for every hook.

## Sources read

### Task and decision records

- `.trellis/tasks/08-07-ws-reconnect-request-deadlines/prd.md` — active D59/D61 task goals, assumptions, requirements, acceptance, and exclusions.
- `docs/deferred-decisions.md:87` — D59: all desktop operator sockets are one-shot; correct boundary is window-level status, reconnect, and per-socket subscription restoration.
- `docs/deferred-decisions.md:89` — D61: pet single-flight guard can remain set forever in three unbounded awaits; home is already protected.
- `.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-costume-defect.md` — pre-Batch-6 diagnosis; useful for the original defect and stale facts corrected below.
- `.trellis/tasks/archive/2026-08/08-03-settings-panel/closeout.md:38-40` — owner acceptance record for #74/#75.
- `docs/devlog/manual-checks.md:155-156` — exact #74/#75 contracts and owner-passed status.

### Current code

- `apps/desktop/src/lib/costume-switch-event.ts:16-46` — three event names, payloads, and both-direction emit helpers.
- `apps/desktop/src/windows/home/pages/costume/use-costume-page.ts:28-110` — 45-second home deadline, result listener, select/cancel order, and cached costume list.
- `apps/desktop/src/windows/home/pages/costume/costume-select-state.ts:41-75` — authoritative home presentation reducer.
- `apps/desktop/src/windows/pet/use-costume-switch-event.ts:35-87` — pet command/refusal/cancel bridge and result publication.
- `apps/desktop/src/windows/pet/costume-report.ts:37-59` — state-transition-to-result classification and closed refusal vocabulary.
- `apps/desktop/src/features/character-import/use-costume-switch.ts:59-150` — 30-second renderer budget, single-flight generation guard, persistence, and Cancel.
- `apps/desktop/src/lib/resolve-switch-report.ts:24-45` — resolution -> asset composition -> renderer -> report sequence.
- `apps/desktop/src/lib/promise-timeout.ts:8-21` — timeout rejects only the wrapper; it does not cancel the source.
- `apps/desktop/src/lib/character-asset-url.ts:64-86` — Tauri `homeDir`/`join` awaits and synchronous URL projection.
- `apps/desktop/src/renderer/pet-scene.ts:128-145` and `renderer/live2d/costume-switch.ts:41-57` — ticket acquisition, stale check, attach, and abort.
- `apps/desktop/src/lib/last-costume.ts:8-16` — local persistence key and synchronous save/load.
- `apps/desktop/src/lib/ws-client.ts:99-135`, `ws-client-routes.ts:137-158`, `ws-client-methods.ts:56-108`, and `ws-transport.ts:17-28` — one transport/client generation, close settlement, and unbounded ordinary requests.
- `apps/desktop/src/windows/pet/use-core-connection.ts:42-68`, `windows/home/use-home-connection.ts:35-54`, and `windows/home/pages/chat/use-chat-connection.ts:36-56` — three one-shot connection owners.
- `apps/desktop/src/lib/use-cached-fetch.ts:33-66` and `cache-persist.ts:11-69` — reconnect-sensitive loader identity, generation suppression, and disk allow-list.
- `apps/desktop/src/windows/home/pages/{settings,operations,perception,chat,costume}/` — current load, subscription, action, and restoration behavior.

### Applicable specs

- `.trellis/spec/frontend/home-window.md:33-43` — independent pet/home/chat sockets and cross-window ownership.
- `.trellis/spec/frontend/home-window.md:45-127` — locked result-bearing cross-window command contract, including the 45-second deadline.
- `.trellis/spec/frontend/state-management.md:24-104` — guarded SWR behavior and D59 ownership of connection state/reconnect.
- `.trellis/spec/frontend/hook-guidelines.md:3-8` — hooks own WS/Tauri access; async actions may not fail silently.
- `.trellis/spec/frontend/component-guidelines.md` and `home-window.md:130-137` — existing page primitives and pet transparency constraints.
- `.trellis/spec/frontend/live2d-renderer.md` section “Costume switch & staleness” — load-before-teardown and mandatory `abortSwitch()` on timeout/cancel.

## Current end-to-end costume state machine

### Home command and result path

| Step | Current owner and await | Timeout/cancellation/result behavior |
|---|---|---|
| Pick | `use-costume-page.ts:80-90` dispatches `request` before awaiting `requestCostumeSwitch()` | The reducer marks only that costume pending and does not move selection (`costume-select-state.ts:56-64`). A second different pick leaves the original pending and shows the busy explanation. |
| Command delivery | `costume-switch-event.ts:34-37` awaits Tauri `emitTo("pet", ...)` | Resolution means delivery only, not execution. Emit rejection dispatches `undeliverable` and releases pending (`use-costume-page.ts:84-88`). The emit itself has no local timeout, but the page's independent pending deadline still releases the UI. |
| Home deadline | `use-costume-page.ts:49-55` owns a 45,000 ms timer keyed by `pending` | Timeout clears only the matching pending costume and shows a retryable “pet did not respond” error (`costume-select-state.ts:70-73`). It does not cancel pet work automatically. |
| Cancel | `use-costume-page.ts:93-98` dispatches `cancel` first, then fire-and-forgets `requestCostumeCancel()` | Home releases immediately even if the pet window is absent. The pet's later `cancelled` result is a no-op because there is no matching pending state. |
| Result reception | `use-costume-page.ts:71-76` has a window-lifetime `useTauriEvent` listener | `use-tauri-event.ts:11-30` keeps one actual listener and routes changing React handlers through a ref. Malformed result payloads are dropped with a warning (`costume-switch-event.ts:67-104`). |
| Presentation truth | `costume-select-state.ts:41-53` | Only `succeeded` moves the highlight. It remains authoritative even after home timed out or cancelled, because it describes what the pet now wears; it also clears a stale deadline error. Matching `failed`/`cancelled` release pending without moving selection. |

### Pet command, executor, persistence, and result path

| Step | Current owner and await | Timeout/cancellation/result behavior |
|---|---|---|
| Command gate | `use-costume-switch-event.ts:41-57` + `costume-report.ts:53-59` | `busy`, `no-scene`, `unknown-costume`, and `not-renderable` return a `failed` result instead of silently dropping the command. Cancel affects only the same active costume id. |
| Guard acquisition | `use-costume-switch.ts:69-79` | A monotonically increasing hook generation and `inFlight.current.id` establish single flight. Setting `switchingId` causes `costumeTransitions` to publish `started` (`costume-report.ts:45-50`). |
| External-ref resolution | `resolve-switch-report.ts:24-26` awaits `client.costumeResolution(...)` | No request deadline. A real socket close rejects all JSON-RPC pending requests (`ws-client-routes.ts:150-154`); a half-open socket can wait forever. |
| Asset/path composition | `resolve-switch-report.ts:27-32` awaits `costumeAssetResolver()` | `character-asset-url.ts:65-79` awaits Tauri `homeDir()` and two `join()` operations before constructing resolver URLs. No deadline or cancellation signal exists. This path is runtime ACL-sensitive in the pet window (`home-window.md:23-24`). |
| Renderer switch | `resolve-switch-report.ts:33-41` awaits `withTimeout(scene.switchCostume(...), 30s)` | This is the only currently bounded stage. Any rejection from this wrapper calls `scene.abortSwitch()` and rethrows. The wrapper does not cancel the source (`promise-timeout.ts:8-21`). |
| Renderer ticket | `pet-scene.ts:128-145` obtains `ticket = ++seq` when `switchCostume()` begins; `reloadModel` checks staleness after load (`costume-switch.ts:46-52`) | If `abortSwitch()` increments `seq` **after this ticket exists**, a late load destroys itself and throws before replacing the old model. Load-before-teardown preserves the previous model on load failure (`costume-switch.ts:53-57`). |
| Avatar report | `resolve-switch-report.ts:42-45` awaits `client.reportAvatar(...)` | No request deadline. This is downstream of renderer attachment. A half-open socket can wedge the hook after the new model is already visible. The renderer-only catch no longer covers this stage. |
| Local persistence | `use-costume-switch.ts:78-81` calls `saveLastCostume()` after all of `resolveSwitchReport()` resolves | The `localStorage` write is synchronous. `onSuccess` then updates the hook's `current`. Thus renderer success plus report failure currently leaves the screen on the new costume but last-costume and hook `current` on the old costume. |
| Guard release | `use-costume-switch.ts:82-89` | Normal success/failure clears the guard in `finally`, but only after the awaited chain settles. A matching generation records failure. |
| Pet Cancel | `use-costume-switch.ts:131-139` | Calls `abortSwitch()`, increments the hook generation, and clears `switchingId` immediately. The abandoned async chain is not cancelled; its later catch/finally becomes a generation no-op. The state transition publishes `cancelled`. |
| Pet result delivery | `use-costume-switch-event.ts:35-37,70-74` | State transitions publish `started` then exactly one classified terminal result. Tauri emit failure is logged and cannot wedge home because home has its own 45-second deadline. |

## Failure boundaries that must not be conflated

### 1. Real socket close

- `bindTransport()` sets `closed`, calls `rpc.rejectAllPendingRequests("connection closed")`, and settles the active chat turn through D29 (`ws-client-routes.ts:150-154`).
- A costume RPC awaiting resolution or report therefore rejects on an observed close and eventually reaches the hook `finally`.
- The window connection hooks only set `disconnected`; they never create a replacement client (`use-core-connection.ts:42-56`, `use-home-connection.ts:39-52`, `use-chat-connection.ts:40-53`). All later work remains on a dead generation until the webview is reopened.

### 2. Half-open ordinary RPC

- Every method in `ws-client-methods.ts:68-108` calls `rpc.request(...)` without a deadline.
- If the browser does not emit `close`, the library's close cleanup never runs. The pending entry and caller promise can remain indefinitely.
- A per-RPC deadline must reject **and remove/reject the library's pending entry**. A caller-only `Promise.race` that abandons the library request does not meet D59 acceptance.

### 3. Renderer timeout after a ticket exists

- `scene.switchCostume()` creates the ticket before awaiting `reloadModel` (`pet-scene.ts:128-134`).
- The 30-second wrapper rejects; its catch calls `abortSwitch()` (`resolve-switch-report.ts:36-40`).
- When the load eventually resolves, `isStale()` is true; the late model is removed and destroyed before the previous model is torn down (`costume-switch.ts:46-55`).
- This is the path manual #74 validates and it currently works.

### 4. Cancel/timeout before the renderer starts

- Current Cancel only bumps the renderer ticket that exists **at that instant** and invalidates the React guard generation.
- If the abandoned chain is still waiting in `costumeResolution()` or `costumeAssetResolver()`, no renderer ticket exists yet. If that wait later resolves, the chain proceeds to `scene.switchCostume()`, which obtains a new current ticket after the abort and can attach normally.
- The generation prevents `saveLastCostume`, `onSuccess`, and stale error updates, but it does not stop renderer/report side effects inside `resolveSwitchReport()`.
- The same bug would exist if a whole-operation timeout were implemented only as `withTimeout(resolveSwitchReport(...))`: wrapper rejection plus an early `abortSwitch()` does not cancel a future stage.

### 5. Timeout/failure after renderer attachment

- `reloadModel()` destroys the previous model and returns vocabulary before `reportAvatar()` begins (`costume-switch.ts:53-57`, `resolve-switch-report.ts:36-45`).
- If `reportAvatar()` hangs or rejects, the visible model is already committed. `abortSwitch()` can only increment `seq`; it cannot restore the destroyed previous model.
- Current local persistence and `current` update do not happen because they are after the entire `resolveSwitchReport()` await (`use-costume-switch.ts:78-81`). Home receives `failed`, although the pet can be visibly wearing the requested costume.
- A reconnect's boot/drift report omits `costume` (`use-core-connection.ts:64`). Core keeps its previous formal costume when an avatar report omits it (`packages/core/src/avatar/avatar-vocabulary.ts:55-62`). Therefore reconnect alone would repair the vocabulary names but can retain the wrong costume-change baseline.
- This is not covered by the current #74 renderer-timeout manual path and needs an explicit D61 design decision and regression test.

## D61 required deadline and cancellation contract

### Facts

- Per-RPC deadlines cover the resolution and report RPCs, but not Tauri path IPC or renderer work.
- A whole-operation deadline covers elapsed guard time across all stages, but a non-cancelling wrapper does not stop future side effects.
- `abortSwitch()` is necessary and sufficient to discard an already-started late renderer load; it is insufficient before renderer ticket acquisition and after renderer attachment.
- Home's 45-second deadline is independent presentation protection and must remain longer than the pet's effective operation budget.

### Recommendation: both deadline layers, plus stage-aware cancellation

1. Give every ordinary `WsClient` request a library-backed initiator deadline (D59). This is the generic half-open defense and must clean the JSON-RPC pending entry.
2. Give the pet switch attempt one whole-operation budget (D61), measured from guard acquisition through its terminal pet result. Each stage receives the remaining budget; no stage starts after cancellation/deadline.
3. Carry an explicit attempt cancellation/generation token through the operation. Check it after resolution, after Tauri path composition, before renderer start, and before report. Cancel and timeout mark the attempt cancelled as well as calling `abortSwitch()`.
4. Keep the renderer's own ticket and `abortSwitch()` on every renderer failure, timeout, and operator Cancel. This remains the protection for a load already in progress.
5. Do not treat post-attach report failure as if the old costume were still on screen. Before implementation, choose and document one truthful commit contract:
   - **Preferred minimal contract:** renderer attachment commits the worn costume. Persist/update `current` at that point, report `succeeded` to home, and separately make the bounded `avatar.report` recoverable/retryable on the next connection generation with the committed costume id. Surface/report the sync failure without relabelling the visible switch as failed.
   - **Alternative, much larger contract:** make renderer switching prepare/commit/rollback so the previous model remains recoverable until `avatar.report` succeeds. Current renderer APIs do not provide this transaction; it is not a timeout-only change.
   - **Rejected contract:** time out `avatar.report`, call `abortSwitch()`, report `failed`, and leave last-costume/current old. This contradicts the already-attached screen and cannot be repaired by the current costume-less reconnect report.
6. Preserve home result semantics: result-bearing flow, 45-second recovery, selection only on actual success, Cancel releasing home first, and late success following presentation truth.
7. Preserve last-costume's purpose: it records the costume actually committed to the scene and must never advance for a renderer load that timed out, failed, or self-discarded. Moving its exact write point to the renderer-commit boundary is compatible with #74; writing on click or before renderer commit is not.
8. Preserve last-good pet costume metadata on a transient `character.costumes` refresh failure. The current catch replaces it with `EMPTY` (`use-costume-switch.ts:102-109`), which can turn all later switch commands into `unknown-costume` until a successful refresh. This is a narrow executor-recovery fix, not a new cache or state-of-record design.

## Current connection-state presentation inventory

| Surface | Current state source | Visible presentation now | Action behavior while down |
|---|---|---|---|
| Pet | Zustand `ConnectionStatus` in `connection-store.ts:14-31` | None. `pet-stage.tsx:55-63` only shows renderer and click-through errors. | Chat bubble retains the dead client and catches a send failure; avatar pushes stop; costume metadata refresh does not recover without a new client. |
| Home non-chat pages | `HomeClientContext` from `use-home-connection()` | None in `home-shell.tsx:58-70`. Cached values can remain visible, making the dead connection especially easy to miss. | Many hooks gate on `ready` and silently return (`use-config.ts:41-55`, `use-operations.ts:45-57`, `use-perception.ts:54-66`). `useCachedFetch.refresh()` is a no-op when `load` is null (`use-cached-fetch.ts:41-56`). This is D59's named “Refresh does nothing” symptom. |
| Chat page | Its own `useChatConnection()` | Persistent amber banner: connecting, pairing-required, disconnected, or error (`chat-page.tsx:18-37`). Connected hides it. | Composer does not receive readiness and remains enabled. `send` sees a non-null dead client, then rejects/toasts. D29 releases an old in-flight turn. |
| Legacy `main` | Rust node-to-Core status channel | Out of scope and not the operator-socket status. | D62; must not be reused as proof that pet/home/chat operator sockets recover. |

`ToastHost` is not the right connection surface: its own contract says toasts are transient while persistent state banners belong to views (`components/toast/toast-store.ts:1-6`), and cards auto-dismiss after six seconds (`toast-host.tsx:13-37`).

## Minimal consistent D59 recovery UX contract

This is a semantic/presentation extension of the existing system, not a visual redesign.

1. One shared status-to-copy mapping must cover at least initial connecting, connected, reconnecting after an established connection, pairing-required, and terminal/error. Connected renders nothing.
2. Home non-chat pages render the shared home socket's persistent status at the window/page frame boundary, not inside one page button. Existing page data and guarded cache stay visible underneath during reconnect.
3. Chat continues to render the status of its **own** socket at the same existing banner location. It must not display the home settings socket's status as if it governed chat.
4. Pet renders its own operator-socket status in the existing top-left overlay notice stack used for renderer/click-through failures. It must stay compact, keep the root transparent, and not become a decorative card or modal.
5. Unexpected close transitions immediately to a reconnecting message. The UI must not claim “connected” until the new socket's `connect` handshake succeeds.
6. Pairing/auth refusal must remain distinguishable from transport retry. A socket opening is not authentication success.
7. Connection-dependent actions should fail fast and release their local pending guards. The status banner is the common explanation; do not add a special connection warning only to costume Refresh or any other single button.
8. No offline mutation queue or replay. Commands attempted against a dead generation fail; the operator retries after the visible connected state returns.
9. A new generation must not clear last-good cached page data merely because the old transport closed. Successful revalidation clears transport-derived cache errors (`cached-fetch-state.ts:26-35`).

## Restoration matrix after a new authenticated client generation

The table assumes the reconnect owner exposes either a new `WsClient` identity or an explicit generation value. With the current hook dependencies, replacing the client is the simpler compatible shape.

| Surface | Current dependency/recovery trigger | What must run once after handshake | Cache/local-state behavior | Current gap or caveat |
|---|---|---|---|---|
| Pet avatar | `use-core-connection.ts:60-68` depends on `scene`, `client`, `status.kind` | Register avatar command sink, report live vocabulary, then `subscribeAvatar(characterId)` | Live scene stays mounted; no renderer reset | New client identity naturally reruns this effect. A stable wrapper needs generation in deps. Report/subscribe failures are currently fire-and-forget/logless and need bounded handling. |
| Pet costume metadata | `use-costume-switch.ts:102-114` depends on `client` through `refresh` and on `connected` | Re-read `character.costumes` | Hook-local current/list should stay last-good until success | Current refresh failure wipes `files`/availability to `EMPTY`; preserve last-good and surface/log failure. |
| Pet initial costume | `use-initial-costume.ts:39-67` has `promoted.current` one-shot set **before** its first RPC | Retry only if initial promotion was interrupted before a definitive outcome; do not reload a successfully promoted scene on every reconnect | Remembered last-costume is localStorage; scene remains live | An initial disconnect during `characterCostumes` or promotion leaves `promoted=true`, so reconnect cannot retry. A simple “run every reconnect” would also reload unnecessarily. This needs an explicit idle/running/completed outcome rather than a boolean set before I/O. |
| Pet chat bubble | Reads pet `client` from the store (`use-chat-bubble.ts:40-66`) | No subscription; future sends use new client | Open/draft/reply state remains mounted | Old in-flight chat is settled by D29. Do not resume it across generations. |
| Home costume list | `use-costume-page.ts:59-68`; `load` identity changes with `client/connected`; `useCachedFetch` effect depends on `refresh` | Re-read `character.costumes` | Persisted `costume-list` stays visible and is replaced only on successful load | Tauri result listener is independent and remains one listener. Pending cross-window switch keeps its own 45-second semantics. |
| Home settings | `use-config.ts:26-39` depends on `ready` | Re-read `config.list`, install new `onConfigChanged`, call `subscribeConfig()` once | Persisted, secret-scrubbed config stays visible | New per-client route slot replaces rather than accumulates handlers. Subscription failure should be observable/bounded. |
| Home operations | `use-operations.ts:27-43` creates two loaders from `ready` | Re-read `memory.status` and `media.usage` | Both allow-listed snapshots remain visible during reconnect | In-flight commands reject with old generation. No replay. New client identity causes both SWR effects to rerun. |
| Home perception | `use-perception.ts:25-52` creates card loader and `refreshPause` from `ready` | Re-read memory-only card and uncached pause state | Card remains in current webview memory only; pause must be freshly read | A prior local `error` from `refreshPause` is not cleared by a successful refresh. Clearing that specific stale read error on success is a useful recovery fix, not a cache redesign. |
| Chat timeline | `use-chat-timeline.ts:76-88` depends on chat `client` and `ready` | Reset store, register append/remove handlers, subscribe first, then load history | No disk cache; server history plus pushes rebuild the store | New client identity reruns correctly. D29 clears an old in-flight turn; do not fabricate continuation. Handler slots are per new client, preventing duplicates. |
| Chat composer | Component remains mounted across status/client replacement | No reload | Unsent draft/attachments stay local. A submitted old turn is not restored except existing cancel-retraction semantics | Composer currently stays enabled while disconnected; the shared status explains state, but readiness-aware disabling/fail-fast behavior should be consistent and tested. |

## Deterministic verification required

### Connection lifecycle and restoration

- Fake transport/client generation: initial open -> authenticated connected -> unexpected close -> reconnecting -> delayed new transport -> authenticated connected.
- Old generation close rejects each pending ordinary RPC exactly once and leaves no library pending entry; an active chat turn reaches D29's error path exactly once.
- A non-answering, still-open request rejects at its deadline without waiting for socket close and without leaving a hidden pending entry.
- Backoff uses injected clock/randomness; delay is capped, jitter stays within the chosen verified range, and disposal cancels the timer and prevents future socket creation.
- Late open/close/handshake callbacks from generation N cannot overwrite generation N+1 status or client.
- Authentication precedes every restoration action. Avatar/timeline/config subscription calls occur exactly once per authenticated generation, never on a merely open socket.
- Pet, home, and chat remain independent: one connection generation changing does not mutate another window/socket's state.
- Client replacement (or explicit generation) causes costume/config/status/usage/perception reads to rerun; last-good cached values remain while the new load is pending.
- Config and timeline pushes after two reconnects invoke the visible store mutation once, proving there are no duplicated local handlers/subscriptions.
- Initial-costume tests cover interruption before list result, interruption during promotion, definitive no-import, successful promotion, and later reconnect without duplicate reload.
- Status presentation tests pin the mapping and prove connected hides the banner, reconnecting remains persistent, and pet presentation does not add an opaque root.

### Costume lifecycle

- Existing event names, malformed-payload drops, refusal vocabulary, result ordering, reducer behavior, 45-second home deadline, and #74/#75 row rendering stay green.
- Unresolved `costumeResolution`: its RPC deadline rejects/cleans pending state; whole switch guard releases; pet emits one terminal result; the next command is accepted.
- Unresolved Tauri asset composition: whole-operation budget expires; no renderer or report stage starts later; guard releases.
- Unresolved renderer load after ticket acquisition: timeout calls `abortSwitch`; late model destroys itself; old visible model, last-costume, Core report, and home highlight do not advance.
- Cancel while waiting in each pre-render stage: home releases immediately; pet emits cancelled; later stage resolution cannot call the renderer or report.
- Cancel during renderer load: ticket invalidates late load; no attach/persistence/report.
- Deadline and Cancel racing each other produce one terminal pet result and one guard release.
- Report-stage timeout/failure test pins the chosen truthful commit policy. It must never produce the current impossible combination “new model visible + home failed/old highlight + old last-costume”.
- Result publication failure does not wedge home; the home 45-second deadline remains the independent last line of defense.
- A late succeeded result after the home deadline still follows the actually worn costume and clears the stale timeout message (existing reducer test at `costume-select-state.test.ts:106-115`).

## Strictly manual checks after implementation

1. Start pet and home with chat open, then stop the real Agent Core. Verify each connection owner shows its persistent state without a webview reload: pet overlay, current non-chat home page, and chat page.
2. Restart Core. Verify all three recover automatically and hide the status only after authentication succeeds.
3. After recovery, verify one avatar command reaches pet, one chat message streams and persists, one new timeline append appears once, one config change push appears once, and each settings page refreshes without manual navigation/reload.
4. Keep a cached non-chat page visible through stop/start. Confirm last-good values remain behind the reconnect status, then update when Core returns.
5. Exercise one real renderer-timeout costume and one Cancel. Re-run manual #74/#75 in full because D61 touches their protection: no late attach or identity drift; one row pending; Cancel/retry works; last-costume survives restart correctly.
6. Smoke the pet window's Tauri path calls in a packaged/dev runtime. `homeDir`/`join` ACL omissions compile successfully and only fail in the calling window (`home-window.md:23-24`).
7. Leave the windows open through a Windows sleep/resume or equivalent network interruption if practical. This is useful real-world evidence, but deterministic half-open request tests remain mandatory because an actual half-open state is not reliably reproducible manually.
8. Visually verify the pet status does not make the transparent root opaque, overlap the chat bubble/wheel incoherently, or create an interactive dead region.

## Scope classification

### Required for D59/D61

- One reconnect lifecycle shared by the three connection owners while preserving independent sockets and chat state.
- Authenticated generation replacement, stale-generation suppression, bounded backoff, disposal, and exact-once restoration.
- Library-backed ordinary RPC deadlines and cleanup.
- Window-scoped persistent connection status at pet/home/chat ownership boundaries.
- Stage-aware costume whole-operation deadline/cancellation, guard release, pre-render late-continuation prevention, and an explicit truthful post-attach report policy.
- Preservation of `abortSwitch`, load-before-teardown, result-bearing home flow, home 45-second deadline, last-costume truth, and #74/#75.
- Narrow last-good handling for pet costume metadata and retryable initial promotion after reconnect interruption.
- Deterministic tests and real Core stop/start/visual manual checks.

### Useful optional improvements if they fall naturally out of the lifecycle seam

- Centralize duplicated `connectOperator`/device identity handling while keeping window-specific device names and post-connect restoration callbacks explicit.
- Add concise generation/attempt/deadline logs for future sleep/resume diagnosis; do not log tokens or payload content.
- Clear a stale perception pause-read error after a successful reconnect refresh.
- Add a user-triggered “retry now” action only if the lifecycle already exposes it cleanly; automatic reconnect plus status is sufficient for v1.

### Unrelated or scope-violating

- D58 skip-list/privacy feature work.
- D62 legacy `main` pairing/status consolidation or Rust node-to-Core transport changes.
- New SWR cache keys, cache authority changes, perception/chat persistence, or a generic cached-data redesign.
- T4 heartbeat/proactivity.
- Offline command queues, replaying mutations, or resuming a partial streamed turn across sockets.
- A home/pet visual redesign, new design system, dependency, or decorative status cards.
- Replacing the Tauri result-bearing costume protocol with shared JS state or making home a second costume state-of-record writer.

## Corrections to stale archived research

The archived `rs-costume-defect.md` is historically useful but predates the final Batch 6 code. The following statements are no longer current:

- “There is no feedback channel from pet back to home” is stale. Current code has `pet:costume-switch`, `pet:costume-cancel`, and `pet:costume-result` (`costume-switch-event.ts:16-18`).
- “Home highlights optimistically” is stale. Current reducer moves selection only on `succeeded` (`costume-select-state.ts:41-53`).
- “Pet error/switching state and Cancel are discarded” is stale. `use-costume-switch-event.ts:59-87` observes all switch state, publishes lifecycle results, and routes matching Cancel.
- “Home has no busy state/deadline” is stale. It has a per-row pending state, Cancel, and 45-second recovery (`use-costume-page.ts:28-55`, `costume-row.tsx:22-47`).
- “#74/#75 are regressed” is stale. Both are recorded owner-passed in `docs/devlog/manual-checks.md:155-156`.
- “The SWR hook is only a recommendation” is stale. `use-cached-fetch.ts` and guarded persistence are implemented, wired to four persisted page snapshots plus a memory-only perception card.
- “Pet listener re-registers when `switchTo` changes” is stale. Current cross-window listeners use `useTauriEvent`, which registers once and reads the changing handler through a ref (`use-tauri-event.ts:11-30`).

The following archived findings remain current:

- The pet single-flight guard releases only when the async chain settles or Cancel manually clears it.
- Resolution, Tauri path composition, and avatar reporting remain unbounded.
- Pet costume metadata still clears to `EMPTY` after a refresh failure.
- Pet/home/chat operator sockets still do not reconnect.
- Only chat currently presents operator-socket status.

## Caveats / not found

- No implementation was run and no tests were executed for this research artifact; findings are a static trace of the 2026-08-07 working tree and recorded owner manual evidence.
- The exact JSON-RPC library cancellation API and backoff library choice are intentionally left to the sibling transport/deadline research. This report states the cleanup behavior the UX/costume contract requires.
- The post-render `avatar.report` failure inconsistency is proven from code ordering but is not yet adjudicated in the active PRD. Implementation must not begin that portion until the leader/owner chooses a truthful commit policy.
- Tauri `emitTo` delivery behavior is treated according to the locked frontend spec: delivery is not execution. No new external research was needed.
- An actual Windows half-open socket and a hung Tauri path call were not reproduced. Deterministic unresolved-promise/transport tests are required precisely because those conditions are unreliable to stage manually.
