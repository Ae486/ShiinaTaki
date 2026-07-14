# Research: Adding a `chat` Tauri window (internal multi-window pattern)

- **Query**: exact steps to add an on-demand decorated `chat` window mirroring the `pet` wiring; how to open it at runtime from the pet UI
- **Scope**: internal (repo files) + installed `@tauri-apps/api@2.11.1` type declarations
- **Date**: 2026-07-15

## The existing pattern (what `pet` does today)

| Piece | File | Fact |
| --- | --- | --- |
| Window declaration | `apps/desktop/src-tauri/tauri.conf.json:21-35` | `pet` declared with `url: "pet.html"`, `visible: false`; shown after first paint via `getCurrentWindow().show()` (`src/windows/pet/pet-stage.tsx:42`) |
| Capability | `apps/desktop/src-tauri/capabilities/pet.json` | per-window file, `"windows": ["pet"]`, lists only the window permissions pet actually calls |
| Vite entry | `apps/desktop/vite.config.ts:44-48` | rollup `input` map `{main, pet, spike}`; each window = one root-level `.html` |
| HTML shell | `apps/desktop/pet.html` | loads `/src/windows/pet/main.tsx` as module entry |
| React entry | `apps/desktop/src/windows/pet/main.tsx` | `createRoot(#root)` render; folder has its own `index.md` |
| WS wiring | `apps/desktop/src/windows/pet/use-core-connection.ts:41-55` | each window opens its OWN operator socket: `createBrowserTransport(ws://DEFAULT_WS_HOST:DEFAULT_WS_PORT)` -> `createWsClient` -> `connect` with `loadOrCreateIdentity(localStorage)` |
| App commands | `capabilities/pet.json` has NO command permissions, yet pet invokes `get_status`/`submit_pairing_code` | app-defined commands (`lib.rs` `generate_handler!`) are not ACL-gated — only `core:*`/plugin permissions need capability entries |

Two facts that de-risk the chat window:

- **Shared identity is fine**: all windows share one origin, so `loadOrCreateIdentity(localStorage)`
  yields the SAME deviceId+token in pet and chat. The Core allows concurrent sockets for one device:
  `connection-registry` tracks a plain `Set` of connections (`packages/core/src/server/connection-registry.ts:53`),
  and `connect.ts:76-80` verifies token per deviceId with no single-connection constraint. Chat
  reuses the pet's pairing/auto-trust transparently.
- **window-state plugin**: `lib.rs:75-80` registers `tauri_plugin_window_state` with
  `StateFlags::POSITION` and `.with_denylist(&["main"])`. A `chat` window is NOT denylisted, so its
  position persists across restarts automatically (size does not — only POSITION flag is on).
  Add `"chat"` to the denylist if that is unwanted; otherwise zero work.

## Steps to add the `chat` window

### (a) tauri.conf.json — NOT needed for the recommended runtime-created approach

Recommended: do NOT declare `chat` in `tauri.conf.json` (see (e)). If the config-declared
alternative is chosen instead, the entry is:

```json
{
  "label": "chat",
  "url": "chat.html",
  "title": "TakiAgent Chat",
  "width": 720,
  "height": 800,
  "resizable": true,
  "visible": false
}
```

(decorations/opacity: defaults are decorated + opaque — just omit `transparent`/`decorations`.)
Gotcha with this alternative: the WebView loads (and its WS operator connection opens) at app
startup even while hidden, and a user clicking the native close button DESTROYS the window —
re-showing then requires intercepting `onCloseRequested` (preventDefault + hide). The runtime
approach avoids both.

### (b) `apps/desktop/src-tauri/capabilities/chat.json`

Capabilities match windows **by label**, so this file applies equally to a runtime-created window:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "chat",
  "description": "Chat window: timeline + composer; talks to the Core over its own operator WS",
  "windows": ["chat"],
  "permissions": ["core:event:default"]
}
```

- The chat window needs almost nothing: its Core link is a plain browser `WebSocket` (no Tauri
  permission), file input is web platform (r3), app commands are un-gated. `core:event:default`
  covers listen/emit should it use Tauri events; drop even that if it ends up unused.
- **The OPENER needs permissions too** — add to `capabilities/pet.json`:
  - `core:webview:allow-create-webview-window` (verified identifier:
    `src-tauri/gen/schemas/desktop-schema.json:1220`) — for `new WebviewWindow(...)`.
  - `core:window:allow-set-focus` (verified: `desktop-schema.json:1718`) — to focus an existing
    chat window. `core:window:allow-show` is already granted to pet.

### (c) vite.config.ts

Add one line to the rollup input map (`apps/desktop/vite.config.ts:44-48`):

```ts
input: {
  main:  fileURLToPath(new URL("./index.html", import.meta.url)),
  pet:   fileURLToPath(new URL("./pet.html", import.meta.url)),
  chat:  fileURLToPath(new URL("./chat.html", import.meta.url)),
  spike: fileURLToPath(new URL("./spike.html", import.meta.url)),
},
```

In dev, Vite serves `http://localhost:1420/chat.html` automatically (devUrl resolution — same as pet).

### (d) HTML + React entry

`apps/desktop/chat.html` (root level, next to pet.html) — plain opaque page, NO Cubism vendor
scripts, NO transparent styles:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TakiAgent Chat</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/windows/chat/main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/windows/chat/main.tsx` mirrors `pet/main.tsx` (createRoot + `@/styles.css`).
Repo rules: new files carry INPUT/OUTPUT/POS headers; add `src/windows/chat/index.md` and update
`src/windows/index.md` in the same change.

### (e) Open on demand from the pet UI — recommended approach

**Recommendation: runtime creation via the JS `WebviewWindow` API** (no Rust command, no conf.json
entry). A Rust `open_chat_window` command (WebviewWindowBuilder) works too but adds a command +
capability surface for zero benefit; the JS API is the documented first-class path.

Verified against installed `@tauri-apps/api@2.11.1`
(`node_modules/.pnpm/@tauri-apps+api@2.11.1/node_modules/@tauri-apps/api/webviewWindow.d.ts`):

- `constructor(label: WebviewLabel, options?: Omit<WebviewOptions, 'x'|'y'|'width'|'height'> & WindowOptions)` (line 43)
- `static getByLabel(label: string): Promise<WebviewWindow | null>` (line 55 — **async in v2**)
- lifecycle events `tauri://created` / `tauri://error` (constructor docstring)

```ts
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

const CHAT_LABEL = "chat";

/** Opens (or re-focuses) the chat window; safe to call repeatedly. */
export async function openChatWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(CHAT_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }
  const chat = new WebviewWindow(CHAT_LABEL, {
    url: "chat.html",   // resolves against devUrl in dev, frontendDist in prod (same as pet)
    title: "TakiAgent Chat",
    width: 720,
    height: 800,
    resizable: true,
  });
  chat.once("tauri://error", (event) => {
    console.error("chat window creation failed", event);
  });
}
```

Closing the window destroys it; the next `openChatWindow()` recreates it — which is exactly the
"disposable client" invariant (its WS connection dies with it; the Core is unaffected). The chat
window's own React tree runs the `use-core-connection.ts` pattern (own `createWsClient`, own
`connect`) — copy the connect flow, subscribe to `timeline.appended` via the already-existing
`onTimelineAppended` hook point (`apps/desktop/src/lib/ws-client.ts:52,100-102`) and fetch backlog
with `timeline.history` (method already registered core-side, `packages/core/src/main.ts:255`).

## Sources

- `H:\TakiAgent\apps\desktop\src-tauri\tauri.conf.json`, `capabilities/pet.json`, `capabilities/default.json`
- `H:\TakiAgent\apps\desktop\vite.config.ts:44-48`, `pet.html`, `src/windows/pet/*`
- `H:\TakiAgent\apps\desktop\src-tauri\src\lib.rs:70-97` (plugins, commands)
- `H:\TakiAgent\node_modules\.pnpm\@tauri-apps+api@2.11.1\node_modules\@tauri-apps\api\webviewWindow.d.ts:43,55`
- `H:\TakiAgent\apps\desktop\src-tauri\gen\schemas\desktop-schema.json:1220,1718` (permission identifiers)
- `H:\TakiAgent\packages\core\src\server\connection-registry.ts:53`, `methods/connect.ts:67-102` (concurrent same-device sockets OK)

## Caveats / Not found

- `core:window:allow-set-focus` on pet.json is asserted from the schema constant + Tauri's
  caller-scoped ACL model; if `setFocus()` on the chat handle still errors at runtime, the runtime
  error names the missing permission verbatim (Tauri 2 behavior) — trivially fixable at implement time.
- If HTML5 drag-drop attach is ever wanted in chat, the runtime-created window must pass
  `dragDropEnabled: false` in the constructor options (see r3).
