# Research: Bubble Conversation UI (Topic 5)

- **Query**: Small bubble input on pet click; messages join the same timeline as the chat window; replies stream into a bubble. What's the frontend pattern, and does a WS client exist?
- **Scope**: internal
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `.trellis/spec/frontend/directory-structure.md` | Mandates `lib/ws-client.ts` + `features/chat-bubble/` |
| `apps/cli/src/chat-client.ts` | **The reference WS-client** to mirror (JSON-RPC over WS, typed with `@taki/shared`) |
| `packages/shared/src/chat-schema.ts` | `chat.send`/`delta`/`complete`/`error` contract |
| `packages/shared/src/connect-schema.ts` | Operator handshake (role `operator`, no capabilities) |
| `apps/desktop/src/windows/pet/use-click-through.ts` | The pixel hit-test the click-to-open reuses |
| `apps/desktop/src/windows/pet/use-pet-drag.ts` | Drag gesture; click-vs-drag guard shares this seam |
| `apps/desktop/src/stores/interaction-store.ts` | Pattern for a small pet-window store (one domain per store) |

### There is NO WS client in the Pet UI yet (key finding)

Verified: **no `@taki/shared` import anywhere under `apps/desktop/src`**, no `WebSocket`/`ws-client`
usage. `@taki/shared` *is* already a dependency (`apps/desktop/package.json:14`), and the frontend
directory-structure spec reserves `apps/desktop/src/lib/ws-client.ts` (`directory-structure.md:27`)
and `apps/desktop/src/features/chat-bubble/` (`:16`) — but neither exists. Only the `pet` and
`spike` windows are built (`windows/chat/` and `windows/settings/` from the spec are not yet
present). So **#16 owns the Pet UI's first connection to the Core.**

### The WS-client pattern to mirror (`apps/cli/src/chat-client.ts`)

The CLI uses `json-rpc-2.0`'s `JSONRPCServerAndClient` over a WS, zod-validating inbound frames:
- **Routes for server pushes** (`chat-client.ts:69-92`): `chat.delta` → `onDelta`,
  `chat.complete`/`chat.error` → end the turn. The Pet UI adds `avatar.command` (Topic 2) and
  `timeline.appended` (if it wants live history) routes the same way.
- **Handshake** (`chat-client.ts:129-139`): `connect` request with `ConnectParams`; on success an
  optional pairing token comes back.
- **chat()** (`chat-client.ts:173-184`): sends `chat.send`, returns a promise that resolves when
  `chat.complete`/`chat.error` routes fire — exactly the "stream into a bubble, close on complete"
  shape.

The Pet UI's `lib/ws-client.ts` mirrors this but with the **browser-native `WebSocket`** (not the
`ws` npm package) since it runs in a webview. Connect as **operator**:
`{ deviceId, deviceName, role: "operator", capabilities: [] }` — `connect-schema.ts:23` refuses an
operator that declares capabilities.

### The bubble flow

1. **Click opaque taki → open the input.** `#15` already gives a pixel-accurate opaque test:
   `PetScene.isOpaqueAt(x,y)` (`pet-scene.ts:27`) drives the click-through toggle
   (`use-click-through.ts:37-42`). A click that lands on an opaque pixel reaches the webview. A new
   pointer handler (distinct from drag via the dead-zone / click-vs-drag guard in `use-pet-drag.ts`)
   opens the bubble input on a *click-without-drag*. This is the **same seam** Topic 6's
   click-region reactions use — coordinate them (a click both opens the bubble *and* could trigger a
   region reaction; decide precedence, e.g. bubble-on-body-click vs reaction-on-head-click, or
   modifier).
2. **Send.** Bubble submit → `wsClient.chat({ characterId, message }, handlers)` → `chat.send`
   (`chat-schema.ts:17-20`).
3. **Stream.** `chat.delta` deltas append into the bubble text; `chat.complete` finalizes/closes;
   `chat.error` shows a terse in-character failure.
4. **Same timeline as the chat window.** The Core persists the turn via its conversation store and
   fires `timeline.appended` to every timeline subscriber (`main.ts:88-91`,
   `timeline-subscriptions.ts`). So a bubble message and a future chat-window message share one
   append-only timeline automatically — the bubble does not need its own persistence.

### Suggested structure (per directory-structure spec)

- `apps/desktop/src/lib/ws-client.ts` — the typed client (mirrors `chat-client.ts`, browser WS).
- `apps/desktop/src/features/chat-bubble/` — colocated: a `use-chat-bubble.ts` hook (owns the
  send + delta accumulation), a `chat-bubble.tsx` component (the input + streaming text), maybe a
  small `chat-bubble-store.ts` (Zustand, one domain — mirrors `interaction-store.ts`).
- The pet window mounts the bubble alongside `PetStage`; the WS client is created once
  (window-scoped) and shared with the avatar-command handler (Topic 2/7) and gaze is independent.

## Caveats / Not Found

- **Pairing is a real integration cost.** The `connect` handshake supports `token` / `pairingCode`
  (`connect-schema.ts:18-20`); the Core issues a pairing code logged to the operator console
  (`main.ts:194-201`). The Pet UI needs a device identity (the CLI has `device-identity.ts`) and a
  first-run pairing path, OR a dev bypass, before `chat.send` works. Flag for planning — this is
  net-new for the desktop app and may deserve its own slice.
- I did not find a chat **window** (`windows/chat/`) in the tree; "the chat window (#5)" may refer
  to the CLI (`apps/cli`) as the current timeline surface. The bubble sharing the timeline holds
  regardless (it's server-side), but the leader should confirm what "#5" shipped.
- Whether the bubble reuses the pet window's existing WebView or a separate always-on-top child
  window is a UI call; simplest is an in-window React overlay (the pet window is already
  transparent/click-through-aware).
