# Home Window, Pages & Streaming Timeline Contract

> The home window (`src/windows/home/`) is the ONE settings-family surface: a left menu plus one page per registry row, with **chat as a page** (#26 retired the standalone chat window #17 built). These are the executable contracts — follow them, don't re-derive.

## Window topology

| label | entry | declared | capability | role |
|-------|-------|----------|-----------|------|
| `pet` | `pet.html` | `tauri.conf.json` (transparent, undecorated, always-on-top, hidden until first paint) | `pet.json` | the overlay: Live2D scene, chat bubble, operation wheel |
| `home` | `home.html?page=<id>` | **runtime** (`lib/open-home-window.ts`) | `home.json` | every page: chat / settings / operations / perception / costume |
| `main` | `index.html` | `tauri.conf.json` | `default.json` (broadest) | LEGACY pairing panel, unrelated to the home surface — do not extend it; whether it is consolidated into home or retired is still an open decision (#26 close) |
| `spike` | `spike.html` | Vite input only | — | the #13 renderer spike, dev-only |

Window-state persistence is configured POSITION-only with `main` on the denylist (`src-tauri/src/lib.rs`): which labels persist is a plugin-side decision, not something a window's capability file grants (the `window-state:*` permissions only gate the JS save/restore calls).

## Runtime-created windows (NOT a tauri.conf.json entry)

A secondary window is created at runtime, not declared in `tauri.conf.json`:

- **Open-on-demand** via a `lib/open-<name>-window.ts` helper: `await WebviewWindow.getByLabel("<label>")` (async in `@tauri-apps/api` v2) → if it exists `show()` + push it to the right page + `setFocus()`; else `new WebviewWindow("<label>", { url: "<name>.html", ... })`. Fixed label, fixed url — never interpolate runtime data into either (the home page id rides a `?page=` query param, which is not the url). Single instance is BY CONSTRUCTION: the label is a constant and an existing window is reused, never re-created.
- **Await the create race**: `tauri://created` resolves, `tauri://error` rejects, so a failed open reaches the caller. Packaged builds have no devtools and `window.alert` is a no-op — a rejected open MUST surface as a toast (`pushToast`), never console-only (D34; the dead opener defect).
- **Entry**: a root `<name>.html` (opaque; no Cubism/renderer scripts unless it renders Live2D) + `src/windows/<name>/main.tsx`, added to `vite.config.ts` `build.rollupOptions.input.<name>`.
- **Capability**: a dedicated `src-tauri/capabilities/<name>.json` with `"windows": ["<label>"]` granting only what that window needs (home needs just `core:event:default`: its Core traffic is a plain browser WebSocket, its file `<input>` is a web-platform API, and events cover `home:navigate` inbound + `pet:costume-switch` outbound). The window that OPENS another needs `core:webview:allow-create-webview-window` + `core:window:allow-set-focus` + `core:window:allow-get-all-windows` + `core:webview:allow-get-all-webviews` (the `getByLabel` lookup enumerates windows/webviews; without the get-all pair opening throws `plugin:window|get_all_windows not allowed by ACL`, #18 round 4) in ITS capability file — that is why `pet.json`, not `home.json`, carries them. A wrong/oversized permission set is a review-blocker; capability ids are validated by `cargo check` (tauri build script), so run it after editing capabilities.
- **Every `@tauri-apps/api/*` call is ACL-gated PER WINDOW, and `cargo check` does NOT catch a missing grant — only running that window does.** Front-end JS calls like `path.homeDir`/`join`/`resolve` (→ `core:path:default`), `window.*`, `fs.*`, `dialog.*` each need their permission in the CALLING window's capability file. `cargo check` validates that a listed id is spelled right; it does NOT verify a window has every permission it will USE at runtime — a missing grant compiles clean and throws `<command> not allowed on window "<label>" ... allowed on: [windows: "main"]` the moment that window invokes it (real example: `path.homeDir` in `character-asset-url.ts` worked from `main` but threw in `pet` until `core:path:default` was added to `pet.json`, #18). Web-platform APIs (WebSocket, `<input type=file>`, `fetch`) are NOT gated. `convertFileSrc` needs no capability (pure URL rewrite). When adding a Tauri API call to a window, grant it in that window's capability AND smoke that window — a passing build proves nothing here.

## The page registry is the only page list

- `windows/home/pages.ts` holds `HOME_PAGES`: `{ id, label, icon, component }` rows, `as const satisfies readonly HomePage[]`. `PageId` is DERIVED from it, `DEFAULT_PAGE_ID` names the boot page, and `isPageId()` gates ids arriving from outside the type system (the `?page=` param, a Tauri event payload). **Adding a page = one row here + one directory under `pages/<id>/`** (invariant 7); no other page list may exist, and no page imports another page.
- Navigation state is a small zustand store (`home-store.ts`: `currentPage` + `navigate`) — one store per domain, UI state only (invariant 4). A fresh window boots from `?page=`; an ALREADY-open window is pushed with the `home:navigate` Tauri event (`use-home-navigate-event.ts`).
- The pet overlay's operation wheel (`features/operation-wheel/wheel-items.ts`) is the same shape: one registry row per shortcut, each row calling `openHome(page)`. Its rows and the home menu rows are independent registries on purpose — the wheel is a shortcut set, not a mirror of the menu.
- **Static-render caveat for tests**: zustand serves `renderToStaticMarkup` its INITIAL state, so a static shell render always shows `DEFAULT_PAGE_ID` no matter what `navigate()` was called with. Assert nav/highlight behaviour against the default row.

## Own WS connection per window

Each window opens its OWN operator socket via `lib/ws-client.ts` (concurrent same-device sockets are allowed by the Core's connection registry — verified). A window does NOT share JS memory or a socket with another window; cross-window liveness is the Core's `timeline.appended` / event fan-out, never shared memory (matches state-management.md). Loopback operators auto-trust (P3) — no pairing UI. Inside home there are exactly TWO sockets: `use-home-connection.ts` (shared with every settings-family page through `HomeClientContext`) and the chat page's own (`use-chat-connection.ts`) — the streaming turn state must not share a client with request/response pages.

Every owner replaces whole authenticated client generations after an observed close/failure; it never reuses a closed
client, buffers offline commands, or replays mutations. Connected status is published only after that owner's required
restoration. The complete lifecycle, deadline, timing-policy, timeline-reconciliation, and readiness contract lives in
[`operator-connection-recovery.md`](./operator-connection-recovery.md).

### Settings permission governance

- The Settings page renders Core permission governance before generic config knobs: one `strict | standard | relaxed`
  selector plus a collapsed advanced cell list grouped by Core-returned `capabilityId`.
- `use-permissions.ts` is the only permission WS seam. It parses Shared schemas, reads fresh state for each authenticated
  Home client generation, and delegates async race handling to the framework-free permission controller.
- Permission state is window memory only. It has no cache key, persisted allow-list entry, Zustand persistence, or
  `localStorage` write. Home is a disposable operator view, not a policy replica.
- Only one permission mutation may be active. Late reads/mutations from a retired client are ignored; a conflict
  refetches; timeout/reconnect never replays a write.
- The UI renders Core facts only: factory/override/effective posture, override mode, generation, reset, second-confirm,
  immutable, loading/reconnecting/read/validation/saved/conflict states. It may disclose that Hosts can tighten, but it
  must not invent a per-row Host constraint not present in the Core response.

## Cross-window commands (the pet owns the scene, the pages own the surface)

A page that needs something only the pet window can do COMMANDS it and does not reach into it:

- Costume switching: `lib/costume-switch-event.ts` — the costume page emits `pet:costume-switch` to the `pet` label; the pet window parses the payload (malformed → dropped with a breadcrumb, never thrown in a callback) and runs its existing switch path. Presentation only: the state of record still rides the pet's WS persist, so this is not a second writer (invariant 2).
- The reverse direction is `openHome(page)` + `home:navigate`.
- Anything the Core can mediate SHOULD go through the Core instead (a WS method + its push), not through a window-to-window event.

## Scenario: Result-bearing cross-window commands

### 1. Scope / Trigger

Use this contract when one window commands work that only another window can execute and the initiating UI must remain
truthful about the outcome. A resolved Tauri `emitTo` proves delivery only; it does not prove execution, so a command
that can fail, be refused, be cancelled, or stall requires a typed return event and a local deadline.

### 2. Signatures

```typescript
type CostumePhase = "started" | "succeeded" | "failed" | "cancelled";
interface CostumeSwitchPayload { costumeId: string }
interface CostumeResultPayload {
  costumeId: string;
  phase: CostumePhase;
  reason?: string;
}

requestCostumeSwitch(costumeId: string): Promise<void>; // delivery only
requestCostumeCancel(costumeId: string): Promise<void>; // delivery only
publishCostumeResult(result: CostumeResultPayload): Promise<void>;
```

The event names are `pet:costume-switch` (home -> pet), `pet:costume-cancel` (home -> pet), and
`pet:costume-result` (pet -> home). The home reducer accepts `request`, `undeliverable`, `result`, `cancel`, and
`timeout` actions. Each pending row captures `currentTimingPolicy().homeResultMs` once; a Home client replacement must
not restart that timer. The validated relationship is `rendererLoadMs < petCostumeTotalMs < homeResultMs` (development
profile: 30s < 40s < 45s). See [`costume-operation-lifecycle.md`](./costume-operation-lifecycle.md).

### 3. Contracts

- The command owner validates every inbound payload before acting. Empty/non-string `costumeId` and unknown result
  phases are dropped with a warning breadcrumb; event callbacks do not throw.
- The executor reports every accepted lifecycle: `started` followed by exactly one of `succeeded`, `failed(reason)`,
  or `cancelled`. A guard rejection reports `failed` with a closed reason (`busy`, `no-scene`, `unknown-costume`, or
  `not-renderable`) instead of returning silently.
- The initiating page marks only the commanded row pending. Selection follows `succeeded`, never the click. Failure,
  cancellation, undeliverable emit, and deadline all release pending so another command can be attempted.
- Renderer attachment is the executor's success boundary. A later `avatar.report` failure is synchronization debt,
  not permission to report the visibly committed costume as failed.
- Cancel releases the initiating UI before emitting the cancel command. A missing/dead executor therefore cannot wedge
  the page. The executor cancels only when `costumeId` matches its active switch.
- A late `succeeded` result is still authoritative presentation truth: follow the costume the pet now wears and clear a
  stale deadline error. Durable costume identity remains Core/pet-owned, not home-page-owned.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Invalid command/result payload | Drop it, warn with event name + payload, preserve current state |
| Executor guard refuses command | Emit `failed` with a named refusal reason |
| Command emit rejects | Clear pending and render an undeliverable error |
| Executor switch throws or hits its renderer/total timeout before attachment | Emit `failed(reason)`; keep the previous selection |
| Renderer attaches, then `avatar.report` fails or times out | Keep/publish `succeeded`; mark report recovery-needed and re-report the live snapshot on reconnect |
| Operator cancels | Clear home pending immediately; executor reports `cancelled` when its hook settles |
| Executor never answers | Home's captured `homeResultMs` deadline clears pending and shows a retryable error |
| Result belongs to another costume | Ignore non-success endings; an observed `succeeded` follows the pet's actual state |
| Cancel id does not match active switch | Warn and do not cancel another command |

### 5. Good/Base/Bad Cases

- Good: click -> pending row -> `started` -> `succeeded`; only then does the highlight move.
- Base: a refusal, renderer failure, Cancel, or deadline clears pending, leaves the old highlight, and permits retry.
- Bad: fire-and-forget command + optimistic highlight + unbounded spinner. Delivery is not completion and the UI will
  lie or wedge when the other window is absent or half-alive.

### 6. Tests Required

- `lib/costume-switch-event.test.ts`: all three event names, valid phase round-trips, malformed payload drop + warning.
- `lib/costume-switch-attempt.test.ts` + `lib/costume-report-sync.test.ts`: total budget, stage cancellation, attachment
  commit, report recovery, exact-boundary races, and stale report tickets.
- `windows/pet/costume-report.test.ts`: started/succeeded ordering, failed reason, cancelled settle, every guard refusal.
- `windows/home/pages/costume/costume-select-state.test.ts`: selection moves only on success; failure, Cancel, deadline,
  and undeliverable emit release pending; stale/foreign results cannot corrupt the active row.
- Component/manual: one row alone renders pending + Cancel, other rows remain clickable, and manual checks #74/#75 pass
  against the real pet renderer and Tauri event bridge.

### 7. Wrong vs Correct

```typescript
// Wrong: delivery is treated as success and the UI can wait forever.
setSelected(costumeId);
await emitTo("pet", "pet:costume-switch", { costumeId });

// Correct: the request creates pending state; only the executor's result moves selection.
dispatch({ kind: "request", costumeId });
await requestCostumeSwitch(costumeId);
// Later: dispatch({ kind: "result", result }); with a local deadline running.
```

## Page presentation contract

- The shell (`home-shell.tsx`) owns the nav column and a `<main>` flex column; a page renders `<PageHeader>` + `<PageBody>` from `page-chrome.tsx` — except a page that owns its own scroll (chat: header, banner, timeline, composer).
- Shared primitives, declared once, restyled once: `page-chrome.tsx` (`PageHeader` / `PageBody` / `PageAlert`), `page-card.tsx` (`PageCard` / `LabeledRows`), `badge.tsx` (tones: `warn` = needs the operator's attention, `ok` = in effect, `neutral`/`muted` = a plain fact), `action-button.tsx` (`primary` / `secondary` / `danger-soft` / `danger`). A page that hand-rolls card, badge or button markup is a review finding.
- Palette: slate neutral, **rose is the one accent** (selection + identity + primary chat action), amber = attention, emerald = confirmed/in effect, rose = error. The solid `danger` fill is reserved for an irreversible confirm (today only the D46 attachment purge, which is two-step by construction).
- Icons live in `lib/icons/` as self-drawn inline SVG components (`Glyph` base + one glyph per file, `className` passthrough). **No icon package, no imported third-party asset file.**
- **`references/BANDORI-PET-REV` is GPLv3: a LAYOUT and organization reference only.** Read it to learn shape (sidebar with brand row + icon nav, card-grouped right pane, label-left/control-right rows); never transcribe code, class schemes, or asset files into this repo.
- Overlay animation is CSS-only (the wheel's appear keyframe is registered in `styles.css` under Tailwind v4 `@theme`) — no JS timers on the pet window, whose idle CPU is a feature.

## Streaming timeline: the in-flight assistant row lifecycle

The persisted timeline and the live stream are two sources merged in one store (`pages/chat/chat-timeline-store.ts`), keyed by `seq`:

- Persisted entries: initial `timeline.history` page (newest-first → reverse for display) + live `timeline.appended`, both **Map-keyed by `seq`** (dedup + ascending sort; loadOlder prepends without duplicating; a subscribe-before-history race dedups by seq).
- The streaming assistant reply is a SEPARATE **in-flight row keyed by `chat.send`'s `messageId`** (which is NOT the persisted entry's uuid — do not try to id-match them). `chat.delta` grows it; the assistant's `timeline.appended` (the persisted version) **drops the in-flight row and inserts the entry in ONE atomic `set()`** — this ordering (Core sends `persistTurn` fan-out just before `chat.complete`) is what prevents a duplicate flash. `chat.complete` → `clearInflight` is the safety net, not the primary path.
- Only an **assistant**-role `appended` drops the in-flight row; user/tool appended rows must not. `chat.error` mid-stream clears the in-flight row and pushes an inline notice atomically. A new `messageId` replaces a stale in-flight row.
- The in-flight bubble uses identical assistant-row styling for a seamless swap.

## Rendering server-owned binary refs (images)

A timeline `image` part carries `{ mediaType, ref }` — **never bytes**. ONE render path for both live-attached and scroll-back images: a `use-attachment-image.ts` hook calls `media.get(ref)` lazily, cached in a module-level `Map<ref, Promise<dataURL>>` (one fetch per ref across all rows and re-mounts; evict on failure so it can retry). A `FORBIDDEN`/missing ref (TTL-expired image) degrades to a placeholder — **text stays authoritative** (the image's meaning already lives in memory as the vision description). The `<img src>` is a `data:` URL whose mediaType comes ONLY from the zod-parsed `MediaGetResult` closed enum.

## Markdown is default-safe (XSS surface)

Assistant AND user text render through ONE `markdown-view.tsx` = `react-markdown` + `remark-gfm`, used **default-safe**: NO `rehype-raw`, NO `rehype-sanitize`, NO `dangerouslySetInnerHTML`, NO `urlTransform` override, NO `components` prop that reintroduces raw HTML. react-markdown escapes raw HTML and defangs `javascript:`/`data:` hrefs by default; adding any of the above re-opens the hole. Keep a markdown XSS regression test (`markdown-view.test.tsx`) whenever this file changes. Wrap settled rows in `React.memo` so only the in-flight row re-parses each delta.
