# Chat Window & Streaming Timeline Contract

> The full chat window (`src/windows/chat/`) landed in #17. It is the **template the M5 settings window clones** for a second runtime-created window. These are the executable contracts — follow them, don't re-derive.

## Runtime-created windows (NOT a tauri.conf.json entry)

A secondary window is created at runtime, not declared in `tauri.conf.json`:

- **Open-on-demand** via a `lib/open-<name>-window.ts` helper: `await WebviewWindow.getByLabel("<label>")` (async in `@tauri-apps/api` v2) → if it exists `show()` + `setFocus()` and return; else `new WebviewWindow("<label>", { url: "<name>.html", ... })`. Fixed label, fixed url — never interpolate runtime data into either.
- **Entry**: a root `<name>.html` (opaque; no Cubism/renderer scripts unless it renders Live2D) + `src/windows/<name>/main.tsx`, added to `vite.config.ts` `build.rollupOptions.input.<name>`.
- **Capability**: a dedicated `src-tauri/capabilities/<name>.json` with `"windows": ["<label>"]` granting only what that window needs (the chat window needs just `core:event:default` — its Core traffic is a plain browser WebSocket, and file `<input>` is a web-platform API, neither ACL-gated). The window that OPENS another needs `core:webview:allow-create-webview-window` + `core:window:allow-set-focus` added to ITS capability file. A wrong/oversized permission set is a review-blocker; capability ids are validated by `cargo check` (tauri build script), so run it after editing capabilities.
- Position persistence: the window-state plugin persists a runtime window's position automatically unless its label is on the denylist. Decide per window; default (persist) is fine.

## Own WS connection per window

Each window opens its OWN operator socket via `lib/ws-client.ts` (concurrent same-device sockets are allowed by the Core's connection registry — verified). A window does NOT share JS memory or a socket with another window; cross-window liveness is the Core's `timeline.appended` / event fan-out, never shared memory (matches state-management.md). Loopback operators auto-trust (P3) — no pairing UI.

## Streaming timeline: the in-flight assistant row lifecycle

The persisted timeline and the live stream are two sources merged in one store (`chat-timeline-store.ts`), keyed by `seq`:

- Persisted entries: initial `timeline.history` page (newest-first → reverse for display) + live `timeline.appended`, both **Map-keyed by `seq`** (dedup + ascending sort; loadOlder prepends without duplicating; a subscribe-before-history race dedups by seq).
- The streaming assistant reply is a SEPARATE **in-flight row keyed by `chat.send`'s `messageId`** (which is NOT the persisted entry's uuid — do not try to id-match them). `chat.delta` grows it; the assistant's `timeline.appended` (the persisted version) **drops the in-flight row and inserts the entry in ONE atomic `set()`** — this ordering (Core sends `persistTurn` fan-out just before `chat.complete`) is what prevents a duplicate flash. `chat.complete` → `clearInflight` is the safety net, not the primary path.
- Only an **assistant**-role `appended` drops the in-flight row; user/tool appended rows must not. `chat.error` mid-stream clears the in-flight row and pushes an inline notice atomically. A new `messageId` replaces a stale in-flight row.
- The in-flight bubble uses identical assistant-row styling for a seamless swap.

## Rendering server-owned binary refs (images)

A timeline `image` part carries `{ mediaType, ref }` — **never bytes**. ONE render path for both live-attached and scroll-back images: a `use-attachment-image.ts` hook calls `media.get(ref)` lazily, cached in a module-level `Map<ref, Promise<dataURL>>` (one fetch per ref across all rows and re-mounts; evict on failure so it can retry). A `FORBIDDEN`/missing ref (TTL-expired image) degrades to a placeholder — **text stays authoritative** (the image's meaning already lives in memory as the vision description). The `<img src>` is a `data:` URL whose mediaType comes ONLY from the zod-parsed `MediaGetResult` closed enum.

## Markdown is default-safe (XSS surface)

Assistant AND user text render through ONE `markdown-view.tsx` = `react-markdown` + `remark-gfm`, used **default-safe**: NO `rehype-raw`, NO `rehype-sanitize`, NO `dangerouslySetInnerHTML`, NO `urlTransform` override, NO `components` prop that reintroduces raw HTML. react-markdown escapes raw HTML and defangs `javascript:`/`data:` hrefs by default; adding any of the above re-opens the hole. Keep a markdown XSS regression test (`markdown-view.test.tsx`) whenever this file changes. Wrap settled rows in `React.memo` so only the in-flight row re-parses each delta.
