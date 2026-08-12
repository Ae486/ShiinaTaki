# Research: Long-idle remote avatar-command failure

- Query: After a long idle period, why can local Live2D reactions and chat still work while agent-invoked avatar motion/expression tools no longer change the model, and is this D59/D61 scope?
- Scope: internal, current live code and tests only
- Date: 2026-08-08
- Reproduction status: not reproduced in this research pass

## Owner clarification after research

On 2026-08-08 the owner confirmed that the chat surface which remained healthy was the home chat page; whether the pet
bubble could still complete a turn is unknown. This materially strengthens hypothesis 1 because home chat owns an
independent operator socket and provides no evidence that the pet socket remained healthy. It does not prove which
external event ended or stranded the pet connection after the long idle period. The permanent recovery defect itself
is source-proven and should be fixed by D59 before asking the owner to spend hours attempting a nondeterministic repro.

## Executive conclusion

The most likely broken boundary is the pet window's connection-scoped `avatar.subscribe` push channel, not the Live2D renderer. The agent tool returning `{ ok: true }` proves only that Core synchronously called `AvatarSubscriptions.publish`; publishing with zero subscribers is intentionally a harmless success (`packages/core/src/avatar/play-motion-tool.ts:33-41`, `packages/core/src/avatar/set-expression-tool.ts:26-34`, `packages/core/src/avatar/avatar-subscriptions.ts:38-45`). It does not prove that an `avatar.command` frame reached the pet.

This is directly within D59 when the pet operator socket closed or became unusable during Core restart, sleep/resume, or another transport interruption. The subscription is keyed by the old Core `Connection` and removed on socket close (`packages/core/src/server/methods/avatar-subscribe.ts:20-25`, `packages/core/src/avatar/avatar-subscriptions.ts:19-36`). The current pet hook never creates a replacement client or resubscribes after close (`apps/desktop/src/windows/pet/use-core-connection.ts:42-56`). A later home chat can work through its independent chat socket while the unreloaded pet remains permanently unsubscribed (`apps/desktop/src/windows/home/pages/chat/use-chat-connection.ts:36-53`).

The phrase "chat still works" is the decisive ambiguity:

- If it means the home chat page, it does not test the pet socket at all; D59 is the leading explanation.
- If it means the pet bubble after the failure, that bubble uses the same pet `WsClient` as avatar push (`apps/desktop/src/features/chat-bubble/use-chat-bubble.ts:40-66`). A successful post-failure pet-bubble turn would prove meaningful bidirectional traffic on that socket and make a full pet-socket loss less likely. The investigation must then distinguish a missing server subscription/local callback from a live-vocabulary rejection.

No current source supports a time-based avatar subscription expiry on an otherwise healthy socket. The Core has no avatar TTL, idle cleanup, ping timer, or periodic resubscription. Its only removal path is connection close, and the desktop callback slot is assigned once and never cleared (`packages/core/src/avatar/avatar-subscriptions.ts:24-36`, `packages/core/src/server/ws-server.ts:42-59`, `apps/desktop/src/lib/ws-client.ts:99-107,129-134`). Therefore an avatar-only "subscription silently expires after N hours" fix would be speculation.

## Exact remote command path

1. Core creates one `avatarSubscriptions` registry and passes that same instance both to per-turn avatar tools and `avatarSubscribeMethod` (`packages/core/src/main.ts:108-111,294-297,331-332`).
2. The agent invokes `avatar_play_motion` or `avatar_set_expression`. The tool binds the active turn's `characterId`, publishes a command, logs "published", and returns success even when no sink exists (`packages/core/src/avatar/play-motion-tool.ts:12-43`, `packages/core/src/avatar/set-expression-tool.ts:12-36`).
3. `AvatarSubscriptions.publish` looks up the character bucket and calls every registered sink. No bucket is an intentional no-op (`packages/core/src/avatar/avatar-subscriptions.ts:38-45`).
4. `avatar.subscribe` previously installed a sink for the specific Core `Connection`; that sink calls this socket's `ctx.notify(avatar.command, command)` (`packages/core/src/server/methods/avatar-subscribe.ts:20-25`).
5. Core's socket-local `notify` serializes the notification and calls `socket.send` only while that server socket reports `OPEN`; there is no delivery acknowledgement (`packages/core/src/server/ws-server.ts:42-49,140-142`).
6. Browser transport forwards string message events to `bindTransport` (`apps/desktop/src/lib/ws-transport.ts:17-27`). `bindTransport` parses the JSON-RPC frame and gives it to the generation-local RPC router (`apps/desktop/src/lib/ws-client-routes.ts:137-154`).
7. The `avatar.command` route zod-parses the payload and invokes the generation-local avatar callback slot if one exists (`apps/desktop/src/lib/ws-client-routes.ts:47-60,88-91`).
8. After authentication and scene load, the pet hook assigns that callback. The callback passes through the shared presentation gate and calls `scene.applyAvatarCommand`; unknown names trigger a live vocabulary re-report (`apps/desktop/src/windows/pet/use-core-connection.ts:58-68`).
9. The current presentation gate is immediate. There is no production caller of `setSharedPresentationReady`, so it does not currently queue avatar commands (`apps/desktop/src/lib/presentation-gate.ts:14-33`; exact source search found only the definition).
10. `PetScene` delegates through the current scene slot to the current `AvatarController`, not a stale costume-model closure (`apps/desktop/src/renderer/pet-scene.ts:106-115,149-156`).
11. `applyAvatarCommand` validates the name against the current model's vocabulary and then calls `model.expression(name)` or `model.motion(name, ..., priority, { loop })`. An unknown name is logged, dropped, and re-reported (`apps/desktop/src/renderer/live2d/avatar-commands.ts:28-45`).

### How local click/proximity differs

Local reactions join the remote path only at the current `AvatarController` and model. They bypass Core tools, the server subscription registry, WebSocket delivery, the JSON-RPC route, and the presentation gate.

- Click: the pet pointer seam calls `scene.handleClick`, which delegates to `reactToClick`; it resolves a character preset tag against the current model's live vocabulary and calls the model directly (`apps/desktop/src/windows/pet/use-pet-click.ts:13-28`, `apps/desktop/src/renderer/pet-scene.ts:111-114`, `apps/desktop/src/renderer/live2d/click-reactions.ts:22-39`).
- Proximity: the 24 ms global-cursor poll calls `scene.handleProximity`; the current controller's reactor resolves a local tag against the same live vocabulary and calls the model directly (`apps/desktop/src/windows/pet/use-click-through.ts:39-70,79-112`, `apps/desktop/src/renderer/live2d/proximity-reaction.ts:38-70`).

Consequently, working click/proximity proves that the current scene/controller/model and at least NORMAL-priority local model calls still work. It does not prove any Core-to-pet delivery step. It also makes a general renderer freeze, destroyed model, or stopped ticker a weak explanation.

## Ranked falsifiable hypotheses

### 1. Pet connection generation died; Core/chat recovered elsewhere, but the pet never reconnected or resubscribed

**Rank: highest, source-proven failure mode.**

On close, the Core removes the old connection's subscription and the desktop only changes status to disconnected. No replacement exists (`packages/core/src/server/methods/avatar-subscribe.ts:20-25`, `apps/desktop/src/windows/pet/use-core-connection.ts:42-56`). Tools still return success with no subscriber (`packages/core/src/avatar/avatar-subscriptions.ts:36-45`). The home chat page owns a different socket, so it can work after being opened/recreated while the pet remains dead.

**Falsify or narrow:** after the symptom, send a turn specifically from the pet bubble without reloading. If its request and streamed reply complete on the existing pet client, full pet-socket loss is unlikely. Home chat success does not falsify this hypothesis.

### 2. The pet socket is alive, but `avatar.subscribe` is absent because its one fire-and-forget establishment failed or never completed

**Rank: plausible at establishment/recovery, not source-proven as long-idle expiry.**

The hook calls `subscribeAvatar` with `void` and no catch, retry, or observable state (`apps/desktop/src/windows/pet/use-core-connection.ts:64-67`). A failed/pending subscribe request can therefore leave chat usable but avatar push absent. However, if remote avatar commands demonstrably worked earlier in the same socket generation, current code has no later non-close path that removes only this subscription (`packages/core/src/avatar/avatar-subscriptions.ts:24-36`).

**Falsify or confirm:** record Core `subscriptions.count("taki")` and whether `avatar.command` is emitted for the pet connection at failure time. Count zero with pet-bubble traffic alive confirms a subscription-establishment/restoration defect; count one requires tracing actual socket send/inbound routing.

### 3. Core vocabulary and the currently attached model drifted; the remote command reaches the renderer but its name is rejected

**Rank: credible secondary boundary, especially after a costume-report failure or Core restart.**

Tool schemas are built from Core's stored vocabulary (`packages/core/src/main.ts:294-303`), while the renderer validates against the current model's separately read vocabulary (`apps/desktop/src/renderer/live2d/avatar-controller.ts:27-44`, `apps/desktop/src/renderer/live2d/avatar-commands.ts:28-45`). Local click/proximity always resolve against the current live vocabulary, so they can work while a stale Core-selected name is rejected. D61's report/committed-costume recovery explicitly touches this boundary.

**Falsify or confirm:** inspect the pet console for `avatar: dropped ... (not in the loaded model's vocabulary)`, capture the inbound command name, and compare it with `scene.reportVocabulary()`. The drift callback should issue `avatar.report`; whether that request succeeds must also be observed. A known name reaching `model.expression/motion` rules this hypothesis out.

### 4. The presentation gate holds remote commands

**Rank: low in the current revision.**

Both pet-bubble deltas and remote avatar commands use the same window-scoped gate, and its current default is synchronous immediate execution (`apps/desktop/src/lib/presentation-gate.ts:14-29`, `apps/desktop/src/features/chat-bubble/use-chat-bubble.ts:17-27`, `apps/desktop/src/windows/pet/use-core-connection.ts:64-65`). Exact search found no production installation of a deferred readiness source.

**Falsify:** a visibly streaming pet-bubble reply after the symptom exercises the same gate. Direct trace immediately before and inside `present` can prove whether the callback runs.

### 5. Long-idle renderer/governor/idle-motion state blocks remote commands

**Rank: lowest given the reported local behavior.**

The governor throttles on blur/idle and pauses only while hidden/asleep; it resumes on unhide (`apps/desktop/src/renderer/render-governor.ts:45-81`, `apps/desktop/src/renderer/render-governor.test.ts:45-81`). The idle scheduler uses a 700 ms timer and IDLE priority, and explicitly yields to foreground NORMAL/FORCE motions (`apps/desktop/src/renderer/live2d/idle-motion.ts:58-110`). Remote default motion and local click/proximity motion all use NORMAL priority, while expression calls bypass motion priority. Local motion and expression visibly working therefore argue strongly against a general priority/ticker failure.

**Falsify or confirm:** trace `applyAvatarCommand`'s boolean result and stub/capture the model calls. If it returns true and the model call occurs but only remote commands remain invisible, then an engine-specific runtime investigation is justified. Source reading alone does not establish that case.

## D59/D61 scope determination

### Within D59

- Replacing a dead pet generation and rerunning authentication.
- Reinstalling the local avatar callback, re-reporting live committed scene state, and resubscribing exactly once on every authenticated replacement generation.
- Observing restoration failures rather than fire-and-forgetting `avatar.report`/`avatar.subscribe` without a recovery path.
- Showing pet window connection/reconnecting state so this failure is not silent.
- Testing that a Core stop/start no longer requires pet webview reload before the next remote avatar command renders.

These are already consistent with current task R1/R3/R5/R6. This symptom supplies a concrete acceptance case; it does not justify a separate avatar reconnect subsystem.

### Within D61 only if vocabulary/committed-costume drift is observed

- Re-reporting the currently attached model's vocabulary and committed costume identity after a generation change.
- Keeping renderer attachment, local committed identity, `last-costume`, and Core report synchronization truthful.

### Not yet source-proven

- A periodic resubscribe on a healthy socket. No current avatar subscription expiry exists.
- An application heartbeat solely for avatar push. Current transport exposes no ping/pong and the task intentionally separates passive half-open detection from active request deadlines (`apps/desktop/src/lib/ws-transport.ts:9-28`). Runtime evidence must first show the browser remains `OPEN` without close while the Core has no usable pet sink.
- A Live2D renderer workaround. Working local reactions and the shared controller path point upstream until an inbound known command is shown reaching `model.expression/motion` without visible effect.

## Reproduction and regression seams

### Accelerated manual reproduction for the source-proven D59 case

Long wall-clock idle is not required to exercise the known defect:

1. Start Core and pet; verify one known remote expression and motion render.
2. Stop Core and wait for the pet WebSocket close event/status.
3. Restart Core without reloading the pet window.
4. Open or reload the home chat page so its independent socket connects, then cause the agent to invoke a known avatar tool.
5. Current expected defect: the tool logs/presents success, local pet click/proximity still work, but the pet receives no remote command because it never created a new connection/subscription.

This procedure is proposed, not executed in this research pass.

### Deterministic automated regression seam

Use the future framework-free lifecycle controller's injected transport/client factory, scheduler, RNG, and fake clock:

1. Generation 1 opens, authenticates, registers `onAvatarCommand`, reports, and subscribes once.
2. Deliver a known `avatar.command`; assert the fake scene receives it once.
3. Close generation 1; assert old pending work retires and no old callback can mutate the scene.
4. Advance fake timers through the injected reconnect delay; generation 2 opens/authenticates.
5. Assert callback registration precedes one report and one subscribe; deliver another command and assert exactly one scene application.
6. Dispose, advance timers arbitrarily, and assert no generation 3 is created.

The existing fake transport already delivers and closes frames deterministically, and its routing test proves one `avatar.command` reaches a registered callback (`apps/desktop/src/lib/ws-client.test.ts:13-38,160-172`). Core tests already prove fan-out, no-subscriber no-op, idempotent same-connection subscribe, and close cleanup (`packages/core/src/avatar/avatar-subscriptions.test.ts:11-67`, `packages/core/src/server/methods/avatar-subscribe.test.ts:37-59`). The missing seam is their connection-generation composition.

### Can fake timers model "long idle"?

Not as a causal transport event in the current code. There is no elapsed-idle timer in the remote avatar path. Advancing fake timers can exercise:

- reconnect backoff after an explicitly injected close;
- proximity cooldown (already uses an injected clock at `apps/desktop/src/renderer/live2d/proximity-reaction.ts:30-40`);
- idle-motion scheduling (already tested with `vi.useFakeTimers` at `apps/desktop/src/renderer/live2d/idle-motion.test.ts:61-122`).

It cannot simulate Windows sleep/resume, WebView2 suspension, TCP half-open behavior, or a browser WebSocket close that never arrives. Those require a controlled real-machine manual run or an explicit fake transport state transition. Advancing hours without injecting any event should produce no avatar subscription transition, which is itself a useful negative test.

## Runtime evidence needed if pet-bubble chat still works

Capture one failed command through these checkpoints, with generation/socket identity where possible:

1. Tool execute: character, kind/name, and current subscriber count. Current "published" log lacks delivery count (`packages/core/src/avatar/play-motion-tool.ts:33-37`, `packages/core/src/avatar/set-expression-tool.ts:26-30`).
2. Core socket sink: whether `ctx.notify(avatar.command)` ran and whether the socket was `OPEN` (`packages/core/src/server/methods/avatar-subscribe.ts:20-24`, `packages/core/src/server/ws-server.ts:140-142`).
3. Browser Network/transport: whether the pet webview received the `avatar.command` frame (`apps/desktop/src/lib/ws-transport.ts:22-25`).
4. Client route: whether zod parsing succeeded and a non-null callback slot was invoked (`apps/desktop/src/lib/ws-client-routes.ts:88-91`).
5. Presentation/renderer: whether the gate callback ran, whether `applyAvatarCommand` returned known/unknown, and whether `model.expression/motion` was called (`apps/desktop/src/lib/presentation-gate.ts:29`, `apps/desktop/src/renderer/live2d/avatar-commands.ts:28-45`).
6. Pet-bubble control: send and receive a full pet-bubble turn on that exact webview/socket. Record home-chat results separately.

The first missing checkpoint identifies the fix boundary. Without this trace, adding periodic resubscribe, renderer resets, or heartbeat traffic would be speculative.

## Tests and manual acceptance

### Required deterministic tests for D59 implementation

- Pet restoration order per generation: authenticate -> local callback -> committed-scene report -> one avatar subscribe.
- Close/reconnect delivers a later avatar command exactly once without pet remount.
- Old-generation late frame cannot apply to the scene after replacement.
- Subscribe/report failure is observable and drives the approved recovery state; it is not an unhandled fire-and-forget rejection.
- Repeated reconnects do not duplicate Core sinks or local callback application.
- Pet bubble active turn still follows D29 settlement; no chat resend occurs.
- Disposal cancels reconnect and no remote command can reach a disposed scene.
- Vocabulary mismatch logs, drops, and triggers one bounded re-report; a later valid command applies.

### Manual acceptance

- Known expression and motion work before and after Core stop/start without pet reload.
- Keep pet idle for the reported real-world duration, then verify both command kinds.
- Repeat across Windows sleep/resume and pet window hidden/unhidden if those were part of the original observation.
- Verify local click/proximity throughout as renderer controls.
- Verify both chat surfaces separately: pet bubble diagnoses the pet socket; home chat only diagnoses its own socket.
- During reconnect, pet shows truthful connection status and no command is replayed.
- After restoration, one agent tool call produces one visible action, not duplicates.

## Minimal fix boundary

For the source-proven close/restart case, the minimal fix is the already planned D59 pet lifecycle restoration: fresh transport/client generation, authentication, callback registration, current-scene report, and one `avatar.subscribe`. No avatar-specific polling or renderer changes are required.

If runtime evidence instead proves pet-bubble chat remains healthy and a valid `avatar.command` reaches the client, the minimal fix cannot yet be named from source alone. Apply instrumentation first and fix the first missing boundary:

- subscriber count/sink missing -> make subscription establishment/restoration observed and retry through generation replacement;
- frame reaches route but callback absent -> fix generation-local callback ownership;
- callback runs but unknown vocabulary -> D61 committed-scene report recovery;
- known command reaches model call but remains invisible -> renderer/engine investigation outside a blind D59 patch.

## Caveats / Not found

- The reported long-idle behavior was not reproduced here. All ranked hypotheses remain falsifiable rather than asserted root causes.
- The exact chat surface used after failure is unknown and materially changes the diagnosis.
- No external research was used or needed; current local source fully defines the relevant channel.
- Core logs a tool as "published" even with zero subscribers and provides no end-to-end delivery acknowledgement. This is intentional fire-and-forget behavior, so current logs cannot establish pet delivery.
- A server-side subscriber count of one still does not prove delivery: the socket send path has no acknowledgement, and `reply` silently does nothing when the server socket is not `OPEN` (`packages/core/src/server/ws-server.ts:140-142`).
- A truly silent half-open connection with no close event and no pet-originated request is not detected by current D59 request deadlines. Whether this observed case requires an application-level liveness probe remains unverified and must not be inferred solely from "long idle".
