# Research: settings-panel scoping (8 questions)

- **Query**: code facts the batching decisions depend on (click-through, click animation, right-click→costume, window topology, FE state/routing, ws-client, env knobs, WS method registry)
- **Scope**: internal (repo only; no web lookup needed — every question was answerable from installed source)
- **Date**: 2026-08-03

---

## Q1 — Click-through mechanism → wheel trigger region

**VERDICT: NO.** "Right-click anywhere in the pet-window rect" cannot work over transparent regions.
DEGRADE to "right-click on the Live2D model area" (the owner's pre-approved fallback).

Mechanism is **window-level `setIgnoreCursorEvents`, position-polled**, not per-event hit testing:

- `apps/desktop/src/windows/pet/use-click-through.ts:39-71` — a 24 ms interval (`POLL_INTERVAL_MS = 24`, line 19)
  reads the global cursor (`cursorPosition()`) + the window origin, converts to canvas-local px, samples the model's
  alpha (`ctx.scene.isOpaqueAt(x, y)`, line 51), and calls `ctx.win.setIgnoreCursorEvents(ignore)` when the value
  flips (line 59).
- The formula: `apps/desktop/src/windows/pet/click-through-toggle.ts:25-27`
  ```ts
  export function shouldIgnoreCursor(inputs: ClickThroughInputs): boolean {
    return !inputs.dragging && !inputs.buttonDown && !inputs.overUi && !inputs.opaque;
  }
  ```
  Over a transparent pixel with no drag / no held button / not over `[data-keep-interactive]` → `ignore === true`
  → the OS routes the click to the window *behind* the pet. The webview receives **no** mouse event at all there,
  so no `contextmenu` can fire. Nothing position-based can recover it: the transparency is exactly what makes it
  click-through.

Consequences for the wheel design (facts, not recommendations):

- The wheel must be summoned from a right-click that lands on **opaque model pixels** (where `ignore === false`).
- Once open, the wheel keeps itself clickable by carrying `data-keep-interactive` — the `isOverUi` element test at
  `use-click-through.ts:24-26` (`document.elementFromPoint(...).closest("[data-keep-interactive]")`) works even
  while the window is currently ignoring events, because it is a render-tree query, not an OS event. This is the
  same trick the bubble and the character panel already use.
- The poll is up to 24 ms stale; a wheel opened at the cursor is inside that same window of staleness (existing
  behaviour, not new).

---

## Q2 — Click/touch animation trigger, and the "left-button-only" fix site

**VERDICT: confirmed — right-click DOES fire the touch reaction today. There is no button filter on the click path.**

Chain:

1. `apps/desktop/src/windows/pet/pet-stage.tsx:31` — `const drag = usePetDrag(onPetClick)`; the handlers spread onto
   the canvas host div at line 50.
2. `apps/desktop/src/windows/pet/use-pet-drag.ts:51-54` `onPointerDown` records the origin for **any** button
   (`event.button` is never read).
3. `use-pet-drag.ts:71-81` `onPointerUp` — `const wasClick = start.current !== null && !dragging.current;` then
   `onClick(event.clientX - rect.left, event.clientY - rect.top)`. Again no button check, so a right-button
   pointerdown/up pair counts as a click.
4. `apps/desktop/src/windows/pet/use-pet-click.ts:19` — `const region = scene.handleClick(x, y);` fires the region
   reaction; lines 22-25 additionally open the chat bubble when the region is non-null and not `"head"`.

**Exact fix site**: `use-pet-drag.ts` — the only place that must learn about `event.button`. Either reject
non-primary in `onPointerDown` (`if (event.button !== 0) return;`) or gate the `wasClick` computation in
`onPointerUp`. Note `use-click-through.ts:93` already filters correctly (`if (event.button === 0)`), so the
`buttonDown` suspension is left-only today — the drag hook is the outlier.

Secondary note: right-click currently ALSO opens the bubble via the `use-pet-click.ts:22` branch whenever the click
lands off the head. Fixing the button filter in `use-pet-drag.ts` removes both the reaction and the stray bubble in
one change.

---

## Q3 — Current right-click → costume switching wiring

**VERDICT: one JSX handler + one boolean in a store. Unplugging is a 3-line surgery; the costume hooks themselves
are reusable as-is.**

- `apps/desktop/src/windows/pet/pet-stage.tsx:46-49`:
  ```tsx
  onContextMenu={(event) => {
    event.preventDefault();
    setPanelOpen(true);
  }}
  ```
- `pet-stage.tsx:62` renders `{panelOpen && <CharacterPanel scene={scene} onClose={() => setPanelOpen(false)} />}`.
- `panelOpen` lives in `apps/desktop/src/stores/interaction-store.ts:15,18,27` (pet-window-local zustand store; it is
  read by the click-through poll only indirectly, through the `[data-keep-interactive]` element test).
- `CharacterPanel` (`apps/desktop/src/features/character-import/character-panel.tsx`) is presentational and reaches
  the world through exactly two hooks: `use-character-import.ts` (model archive import) and `use-costume-switch.ts`
  (costume list + switch + cancel). `use-costume-switch.ts:92-152` depends on `useConnectionStore` for the WsClient
  and on a live `PetScene` for `switchCostume`.

**Migration constraint (load-bearing)**: `useCostumeSwitch` needs the `PetScene`, which exists **only in the pet
window** (`pet-stage.tsx:26` → `usePetScene`). A costume page hosted in the home window has no scene object in its
JS memory — the switch would have to be commanded across windows/WS rather than by calling `scene.switchCostume`
directly. This is the one place the "all pages live in the home window" rule collides with existing code.

---

## Q4 — Window topology today

**VERDICT: 4 Vite entries / 3 real windows. Adding the home window = 1 html + 1 Vite input + 1 capability file +
1 opener (runtime-created, following `open-chat-window.ts`), no `tauri.conf.json` window entry needed.**

Declared windows — `apps/desktop/src-tauri/tauri.conf.json` `app.windows`:

| label | url | notes |
|---|---|---|
| `main` | (default `index.html`) | the legacy pairing/status panel (`apps/desktop/src/app.tsx`) — pre-M4 scaffolding |
| `pet` | `pet.html` | transparent, undecorated, always-on-top, `skipTaskbar`, `visible:false` (shown after first paint) |

Runtime-created windows:

- chat — `apps/desktop/src/lib/open-chat-window.ts:22-34`: `new WebviewWindow("chat", { url: "chat.html", 720×800,
  resizable })`, awaiting the `tauri://created` / `tauri://error` race; `getByLabel` first for show+focus. **No
  `tauri.conf.json` entry.**
- Called from exactly one place: `apps/desktop/src/features/chat-bubble/chat-bubble.tsx:44` (the bubble's expand
  affordance).

Vite inputs — `apps/desktop/vite.config.ts` `build.rollupOptions.input`: `main` / `pet` / `chat` / `spike`, matching
`index.html`, `pet.html`, `chat.html`, `spike.html` at `apps/desktop/`.

Capability files — `apps/desktop/src-tauri/capabilities/`:

- `default.json` → windows `["main"]`, permissions `core:default`, `core:event:default`, `dialog:default`.
- `pet.json` → windows `["pet"]`, 14 permissions including `core:window:allow-set-ignore-cursor-events`,
  `core:window:allow-cursor-position`, `core:window:allow-start-dragging`,
  `core:webview:allow-create-webview-window`, `core:window:allow-set-focus`, the get-all pair, `window-state:default`.
- `chat.json` → windows `["chat"]`, permissions `["core:event:default"]` only — the chat window uses a **browser**
  WebSocket and a web `<input type=file>`, so it needs almost no Tauri IPC.

**Chat window is a separate Tauri window**, not a view inside the pet window.

**What the HOME window needs**: `home.html` + a `home` Vite input + `src/windows/home/main.tsx` +
`capabilities/home.json` (chat.json is the closest template; add whatever the pages need beyond `core:event:default`)
+ an opener alongside `open-chat-window.ts` (the pet capability already grants `create-webview-window` /
`set-focus` / get-all, so no pet capability change is needed to open it). CSP note: `tauri.conf.json`
`app.security.csp.connect-src` already whitelists `ws://127.0.0.1:8974` and `ws://localhost:8974` for any window.

**Chat migration surface** (`apps/desktop/src/windows/chat/`, 22 files): roots are `chat-window.tsx` (layout:
header + `StatusBanner` + `TimelineView` + `Composer` + `ToastHost`, provides `ChatClientContext`) and `main.tsx`
(the entry that mounts it). Pet-window couplings to cut are thin — the chat window imports only
`@/lib/active-character.js`, `@/stores/connection-store.js` (for the `ConnectionStatus` **type** only),
`@/components/toast/toast-host.js`, and its own hooks. It creates its **own** WS in
`windows/chat/use-chat-connection.ts` and does not read the pet's connection store instance. Turning
`ChatWindow` into a home page means: drop `main.tsx`, keep the rest, and move the layout chrome (header/full-height
flex) up into the home shell.

---

## Q5 — Frontend state + routing today

**VERDICT: zustand only, NO router, no dependency to add unless the leader wants one. View switching today is
boolean flags + separate HTML entries.**

- `apps/desktop/package.json` has no router dependency (checked via imports: no `react-router`, no `wouter`
  anywhere under `apps/desktop/src`).
- Stores (`apps/desktop/src/stores/`, all `create()` from zustand, one store per domain, no middleware/persist):
  - `avatar-store.ts` — avatar state
  - `connection-store.ts` — `{ status: ConnectionStatus (discriminated union), client: WsClient | null }`
  - `interaction-store.ts` — `{ dragging, bubbleOpen, panelOpen }`
  - plus `components/toast/toast-store.ts` and `features/chat-bubble/chat-bubble-store.ts` and
    `windows/chat/chat-timeline-store.ts`
- "View switching" today = (a) a different Tauri window per surface, (b) boolean flags rendering a component
  (`pet-stage.tsx:62`). There is no in-window navigation anywhere in the repo.
- The existing idiom closest to a registry: `packages/core/src/server/method-registry.ts` (register/dispatch map)
  and the renderer's `click-presets.ts`. On the frontend, a page registry would be new code, but the store shape to
  hold "current page" is exactly the existing zustand pattern (a small `home-nav-store` with a discriminated
  union, matching `ConnectionStatus`'s style).

---

## Q6 — WS client and D29

**VERDICT: each window creates its OWN WsClient and its OWN socket; a home window makes a third. D29 is real and
sits in the exact function that a `config.*` addition would touch (`createWsClient`), but adding request/response
methods does not itself require fixing it — the defect is in the streaming `chat()` path only.**

- `apps/desktop/src/lib/ws-client.ts` — framework-free, the zod boundary; `createWsClient({ transport })` at line 211.
- Per-window connections: `windows/pet/use-core-connection.ts` (device name `taki-pet`) and
  `windows/chat/use-chat-connection.ts` (device name `taki-chat`) each call `createWsClient(createBrowserTransport(...))`
  against `ws://${DEFAULT_WS_HOST}:${DEFAULT_WS_PORT}`. They share only the localStorage device identity
  (`lib/device-identity.ts`), which is same-origin across windows, so the second window auto-authenticates once the
  first has paired. Core accepts concurrent same-device sockets. `connection-store.ts` header states plainly:
  "Windows do not share this JS memory."
- **D29 site** — `ws-client.ts:239-250`:
  ```ts
  async chat(params, handlers) {
    const done = new Promise<void>((resolve) => { state.current = { handlers, finish: resolve }; });
    try { await rpc.request(CHAT_METHODS.send, params); }
    catch (error) { state.current = null; throw error; }
    await done;
  }
  ```
  `done` resolves only from `chat.complete` / `chat.error` (`installRoutes`, lines 126-139). The close path
  (`transport.onClose(() => rpc.rejectAllPendingRequests(...))`, line 230) rejects *pending JSON-RPC requests* — the
  `send` request has already resolved by then, so a mid-turn disconnect leaves `done` forever pending and
  `state.current` dangling.
- Adding `config.get/set/subscribe` to this file: the request/response ones drop into `requestMethods(rpc)`
  (lines 184-209) — one line each, plus a `@taki/shared` result schema. A `config.changed` push needs a slot in
  `PushSlots` (lines 104-108) + a route in `installRoutes` + an `onConfigChanged` setter, mirroring
  `onTimelineAppended` exactly (lines 144-149, 253).
- Size note: `ws-client.ts` is 258 lines against the 300-line cap — a subscribe + push + 2-3 methods will cross it.

---

## Q7 — Core env-knob inventory (R13 page material)

At the original 2026-08-03 scoping snapshot, knobs were parsed in `packages/core/src/config/*` and loaded
**once at module scope in `packages/core/src/main.ts:92-103`** (memory's at `packages/core/src/memory/bootstrap.ts:67`).
The original rows below describe that snapshot's prospective consumption shapes, not current apply metadata.
The 2026-11-09 policy-review additions are actually live: `hindsight-memory-subsystem.ts` supplies a fresh
`loadHindsightPolicyReviewConfig(input.source.env())` getter and config notifications rearm the existing scheduler.
Current operator apply metadata is authoritative in `packages/core/src/config/knob-registry.ts`.

| Env var | Default | Zod shape | Consumed at | Live-apply call |
|---|---|---|---|---|
| `TAKI_WS_HOST` | `DEFAULT_WS_HOST` (shared) | string, rejects `0.0.0.0`/`::` | `main.ts` → `startWsServer` | **restart** (socket bind) |
| `TAKI_WS_PORT` | `DEFAULT_WS_PORT` (8974) | coerce int 1-65535 | same | **restart** |
| `TAKI_LOG_LEVEL` | `info` | enum fatal/error/warn/info/debug/trace | `createLogger`, `main.ts:105` | **live** (pino level is settable) |
| `TAKI_DATA_DIR` | `join(homedir(), ".takiagent")` | string min 1 | db path, devices.json, workspace, skills — `main.ts:112-199` | **restart** (db handle + dir layout) |
| `TAKI_PROMPT_DIR` | repo `prompt/` via import.meta.url | string min 1 | prompt-card loading | **live-ish** (per-read of cards; verify the loader caches) |
| `TAKI_TRUST_LOOPBACK_OPERATOR` | `true` | strict true/1/false/0 preprocess → boolean | `connect.ts` handshake | **live** (read per handshake) — but it is a security switch |
| `TAKI_PROVIDER_BASE_URL` | — (required) | string min 1 | `createModels`, `main.ts:108` | **restart** (model object built once) |
| `TAKI_PROVIDER_API_KEY` | — (required) | string min 1 | same | **restart**; also a SECRET → Credential Manager, never the config table |
| `TAKI_PROVIDER_MODEL` | — (required) | string min 1 | same | **restart** |
| `TAKI_VLM_BASE_URL` / `_API_KEY` / `_MODEL` | absent = vision off; partial set = fatal | string min 1 each | `createModels` → `visionModel` | **restart** |
| `TAKI_UTILITY_BASE_URL` / `_API_KEY` / `_MODEL` | absent = background rides main; partial = fatal | string min 1 each | `memory/bootstrap.ts` | **restart** |
| `TAKI_PROVIDER_CONTEXT_TOKENS` | 131072 | coerce int positive | `createWindowCalibrator({declared})`, `main.ts:123` | **restart** (calibrator seeded once) |
| `TAKI_VLM_CONTEXT_TOKENS` | 131072 | coerce int positive | declared-only (uncalibrated in v1) | **restart** |
| `TAKI_UTILITY_CONTEXT_TOKENS` | 131072 | coerce int positive | declared-only | **restart** |
| `TAKI_CONTEXT_HISTORY_RATIO` | 0.7 | coerce number >0 ≤1 | `historyBudget()` closure, `main.ts:128` — evaluated per replay | **live** (closure re-reads each call) |
| `TAKI_PROVIDER_INCLUDE_USAGE` | `false` | strict bool preprocess | `createModels({includeUsage})` | **restart** (baked into the model object) |
| `TAKI_COMPACT_TRIGGER_RATIO` | 0.8 | coerce number >0 ≤1 | compaction config → checked per pass, `main.ts:157-161` | **live** |
| `TAKI_COMPACT_KEEP_MESSAGES` | 40 | coerce int positive | same | **live** |
| `TAKI_MAX_STEPS` | 10 | coerce int 1-50 | `chat-agent.ts:178` `stopWhen: isStepCount(deps.maxSteps)`; injected once at `main.ts:303` | **live if plumbed as a getter** (it is read when the loop is built per turn) |
| `TAKI_ATTACHMENT_TTL_DAYS` | 14 | coerce int positive | `startAttachmentGc({ttlMs})`, `main.ts:384` → `sweepExpired` on a timer | **live if plumbed as a getter** (each sweep re-reads) |
| `TAKI_AMBIENT_SCREENSHOT` | `false` | strict bool preprocess | ambient sampling gate | **live** (a gate check) |
| `TAKI_AMBIENT_SCREENSHOT_RETENTION` | `drop` | `drop` \| `keep` \| positive days → `{mode, days, ttlMs}` | `perception/ambient-shot-gc.ts:26` | **live** |
| `TAKI_MEMORY_PINNED_BUDGET` | 800 | coerce int positive | memory engine assembly | **live** (per-assembly budget) |
| `TAKI_MEMORY_BM25_WEIGHTS` | 2/1/2 | string → parsed → `Bm25WeightsSchema` | retrieval scoring | **live** |
| `TAKI_MEMORY_STOPLIST` | `on` | enum on/off → boolean | segmenter | **restart-ish** (segmenter built at boot; verify) |
| `TAKI_MEMORY_INTENTIONS_DEFAULT_DAYS` | 30 | coerce int positive | retention fallback expiry | **live** |
| `TAKI_MEMORY_TIDY_WRITE_THRESHOLD` | 40 | coerce int positive | tidy pass trigger | **live** |
| `TAKI_MEMORY_TIDY_MAX_STEPS` | 12 | coerce int positive | tidy pass loop cap | **live** |
| `TAKI_MEMORY_TIDY_STALE_DAYS` | 45 | coerce int positive | tidy staleness | **live** |
| `TAKI_MEMORY_TIDY_REPORT_CAP` | 10 | coerce int positive | tidy report cap | **live** |
| `TAKI_HINDSIGHT_POLICY_REVIEW_MODE` | `daily` | enum daily/interval | `hindsight-memory-subsystem.ts` → `hindsight-policy-schedule-state.ts` | **live** (calendar reconciles current settings) |
| `TAKI_HINDSIGHT_POLICY_REVIEW_TIME` | `03:00` | string HH:mm, 00:00-23:59 | same; interpreted in Core-owned User Timezone | **live** (daily calendar revision) |
| `TAKI_HINDSIGHT_POLICY_REVIEW_INTERVAL_MS` | 86400000 | coerce int 60000-2147483647 | same; elapsed interval from persisted anchor | **live** (interval calendar revision) |
| `TAKI_HINDSIGHT_POLICY_REVIEW_THRESHOLD` | 100 | coerce int 1-2147483647 | `hindsight-policy-schedule.ts` eligible-inventory check | **live** (threshold reread per Bank) |
| `TAKI_DEV_TRIGGER` | unset | `=== "1"` check, `main.ts:386-391` | registers the DEV `capability.trigger` method | **restart** (registration-time); dev-only, not a panel knob |

Non-knobs found by the same grep (do NOT put on the page): `TAKI_ZST_FIXTURE`
(`packages/core/src/characters/zst-archive.test.ts:26`) and `TAKI_FIXTURE_DIE`
(`packages/core/src/testing/mcp-fixture.mjs:43`) — test fixtures only.

Secrets among the above: the three `*_API_KEY` vars. Invariant 5 keeps them in Credential Manager; the panel can at
most show "set / not set".

---

## Q8 — Operator WS method registry: what adding `config.*` involves

**VERDICT: 3 files per method + 1 registration line. No registry change needed — `register` is already the
pluggable seam.**

- `packages/core/src/server/method-registry.ts:31-37` — a method is a `MethodDefinition<P>`:
  `{ method: string; roles: Role[]; paramsSchema: ZodType<P>; handler: (params, ctx) => ... }`.
  `dispatch` (lines 68-111) zod-validates params before the handler, enforces `roles` against the authenticated
  connection (`FORBIDDEN` otherwise), and turns a throwing handler into an `INTERNAL_ERROR` response — so a handler
  may just throw.
- Pattern to copy — `packages/core/src/server/methods/memory-tidy.ts` (33 lines): a factory taking its dependency,
  returning the definition; `roles: ["operator"]`; method name and param/result schemas imported from `@taki/shared`
  (`MEMORY_METHODS.tidy`, `MemoryTidyParamsSchema`, `MemoryTidyResult`).
- Registration: one line in `packages/core/src/main.ts` beside `registry.register(memoryTidyMethod(tidy));`
  (main.ts:381; the block runs 357-391).
- For a **subscription** method the template is `avatar-subscribe.ts` / `timeline-subscribe.ts`: they use
  `ctx.notify` to push and `ctx.onClose` to auto-unsubscribe when the socket dies (`MethodContext`,
  method-registry.ts:24-29).
- If a method family grows past 2-3 files, `perception-methods.ts` is the in-repo precedent for a single
  registration seam ("one call registers pauseGet/pauseSet/card so the composition root never grows per method").
- Shared side: method-name constants and schemas live in `@taki/shared` (e.g. `MEMORY_METHODS`, `CHARACTER_METHODS`)
  — protocol types defined once (invariant 3). A Rust serde mirror is only needed if the Shell participates;
  memory-tidy explicitly notes "NO Rust mirror", and a config surface is operator↔core only.

---

## Caveats / things that change the PRD's assumptions

1. **PRD §3 "trigger region: whole pet-window rect"** is refuted — the degrade path (model area only) is the only
   available one. See Q1.
2. **PRD §1 "costume page lives in the home window"** collides with `useCostumeSwitch`'s dependency on the live
   `PetScene`, which exists only in the pet window (Q3). Cross-window commanding is required; the leader must
   design that seam.
3. **`ws-client.ts` is at 258/300 lines** — a `config.*` family plus a push slot will breach the cap, so a split is
   forced by the anti-sprawl rule, not optional (Q6).
4. `main` window (`index.html` + `app.tsx`, the pre-M4 pairing panel) still exists and still has the broadest
   capability (`core:default`). Nothing in this task requires it, but "home" and "main" will be confusingly adjacent
   labels.
5. Nothing in `packages/core` reads config after boot today. "Live-apply" for any knob in Q7's table means
   converting a captured constant into a getter at the consumption site — the per-knob cost is not uniform.
