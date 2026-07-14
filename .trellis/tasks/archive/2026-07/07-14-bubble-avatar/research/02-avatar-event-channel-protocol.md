# Research: Avatar Event → Pet UI Channel (Topic 2)

- **Query**: How does the Core push events to clients today, and what new protocol is needed so `avatar.play_motion` reaches the Pet UI webview?
- **Scope**: internal + protocol design
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `packages/core/src/server/ws-server.ts` | Socket owner; installs the per-socket `notify` push sink |
| `packages/core/src/server/timeline-subscriptions.ts` | The `timeline.appended` fan-out registry — **the pattern to clone** |
| `packages/core/src/server/methods/timeline-subscribe.ts` | The `timeline.subscribe` WS method — the method to clone |
| `packages/core/src/server/methods/chat-send.ts` | Shows server→operator streaming pushes via `ctx.notify` |
| `packages/core/src/server/connection-registry.ts` | Per-connection auth state; `role: operator \| node` |
| `packages/shared/src/timeline-schema.ts` | The schema shape to mirror for `avatar.*` |
| `apps/cli/src/chat-client.ts` | Proves operators open their own loopback WS directly to the Core |

### The existing push/subscribe mechanism (reuse verbatim)

1. **Per-socket push sink.** On each connection `ws-server.ts:45-47` builds
   `notify(method, params) => socket.send(JSON-RPC notification)` and stores it on the
   `Connection`. This is how *any* server-initiated frame reaches exactly one socket.

2. **Per-character fan-out registry.** `timeline-subscriptions.ts:19-47` keeps
   `Map<characterId, Map<Connection, sink>>` with `subscribe / unsubscribe / publish / count`.
   `publish(entry)` fans the entry to every sink registered for `entry.characterId`
   (`:38-42`).

3. **The subscribe method.** `timeline-subscribe.ts:15-27` (role `["operator"]`):
   ```ts
   subscriptions.subscribe(characterId, connection, (entry) => ctx.notify(TIMELINE_METHODS.appended, entry));
   ctx.onClose(() => subscriptions.unsubscribe(characterId, connection)); // auto-cleanup on socket close
   ```

4. **Wiring.** `main.ts:87` `createTimelineSubscriptions()`; `main.ts:88-91` the conversation
   store's `onAppend` calls `timelineSubscriptions.publish(entry)`; `main.ts:229` registers the
   method.

`chat-send.ts:84-88` shows the same `ctx.notify` used to stream `chat.delta`/`chat.complete` to
the operator mid-turn. So server→operator push is well-established; avatar commands slot straight
in.

### Does the Rust Shell relay, or does the webview subscribe directly?

**The webview subscribes directly to the Core.** Evidence:
- The WS server binds loopback only (`server-config.ts:18-20` forbids wildcard binds; default
  `127.0.0.1`), and `apps/cli` opens its **own** operator WS to it (`chat-client.ts:147-169`).
- The Pet UI is a browser webview inside Tauri; it can open a native `WebSocket` to
  `ws://127.0.0.1:<port>` exactly like the CLI. It connects as an **operator**
  (`role: "operator"`, `capabilities: []` — `connect-schema.ts:23` forbids operator capabilities).
- The Rust Shell connects **separately as a node** (it provides capabilities). It is not in the
  avatar path at all.

Therefore **no Rust serde mirror of `avatar.*` is needed** (invariant 3 mirrors only shapes the
Rust side handles — connect/capability/approval; not `chat.*`/`timeline.*`, and not `avatar.*`).

### Required protocol addition (invariant 3: zod in `@taki/shared`)

New `packages/shared/src/avatar-schema.ts` + named re-exports in `packages/shared/src/index.ts`
(no barrels, explicit exports like the other schemas):

```ts
export const AVATAR_METHODS = {
  subscribe: "avatar.subscribe",  // operator → core
  report:    "avatar.report",     // operator → core (Topic 3 vocab report)
  command:   "avatar.command",    // core → operator (the push)
} as const;

export const AvatarSubscribeParamsSchema = z.object({ characterId: z.string().min(1) });
export const AvatarSubscribeResultSchema = z.object({ status: z.literal("ok") });

export const AvatarCommandSchema = z.object({
  characterId: z.string().min(1),
  kind: z.enum(["expression", "motion"]),
  name: z.string().min(1),
  priority: z.enum(["idle", "normal", "force"]).optional(), // motion() priority
  loop: z.boolean().optional(),                              // motion() loop
});
export type AvatarCommand = z.infer<typeof AvatarCommandSchema>;
```
(`AvatarReportParamsSchema` for Topic 3 is defined in `03-manifest-enum-architecture.md`.)

### Required Core additions (all new modules; invariant 7 registry pattern)

- `packages/core/src/avatar/avatar-subscriptions.ts` — a **line-for-line clone** of
  `timeline-subscriptions.ts`, typed to `AvatarCommand` instead of `TimelineEntry`.
- `packages/core/src/server/methods/avatar-subscribe.ts` — clone of `timeline-subscribe.ts`
  (role `["operator"]`, subscribes the connection, `ctx.onClose` auto-unsubscribe).
- The avatar tools (Topic 1) get `{ subscriptions }` in deps; `execute` calls
  `subscriptions.publish({ characterId, kind, name, ... })` and returns `{ ok: true }`.
- `main.ts`: `const avatarSubscriptions = createAvatarSubscriptions()`, pass it to the avatar
  tools, register `avatarSubscribeMethod(avatarSubscriptions)`.

### Timing — commands land mid-turn

Because the avatar tools execute **inside** the `ToolLoopAgent` loop and `publish` is a
synchronous fan-out to subscribed sockets, an `avatar.play_motion` call reaches the Pet UI the
instant the LLM invokes it, while the turn is still streaming. No extra machinery needed.

### The characterId binding

The publish needs the turn's `characterId`. Because `extraTools` is boot-stable, the cleanest
binding is to construct the avatar tools **per-turn** next to `memory.createTools(characterId)`
(same site, same lifetime), OR keep them boot-stable and pass `characterId` through the tool call
arguments. Per-turn construction is the lower-risk match to the existing `memory.createTools`
precedent (`chat-agent.ts:64`). This is a small design call for the leader.

## Caveats / Not Found

- No existing `avatar`/`emotion` protocol code exists in `packages/shared` or `packages/core`
  (grep found only memory/base-prompt references) — this is genuinely net-new.
- The Rust-topology conclusion is inferred from the CLI precedent + loopback server + the
  operator/node split; I did not read `apps/desktop/src-tauri` Rust to confirm the webview
  doesn't currently tunnel WS through Rust (it has no WS client at all today — Topic 5). Low risk,
  but worth a 1-line confirmation when implementing.
