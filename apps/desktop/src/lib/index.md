# lib/
Cross-cutting Pet UI clients + seams (talk to the Agent Core / hold window-shared services). Framework-free apart from
icons/ (the shared glyph set) and the two window-shared React hooks below.
- ws-client.ts — operator WS JSON-RPC client to the Core (browser WebSocket): public turn/handshake/monitor subscribe-unsubscribe wiring plus the memory-operation family
- ws-client-routes.ts — inbound half: the zod boundary (frame parse + chat/avatar/timeline/config/Approval/monitor/memory-operation push routing) and the D29 mid-turn-close abort
- ws-client-methods.ts — outbound half: handshake plus schema-validated operator methods including extension convergence
- ws-client-memory-operations.ts — outbound sibling: memory.authority.status + memory.operations.submit/status/list/cancel wrappers and the exact-once memory.operations.subscribe
- rpc-deadline.ts — method-class timing table + typed deadline error + json-rpc-2.0 native timeout requester seam
- timing-policy.ts — window-owned bootstrap/last-good timing policy store; validates full Core config refreshes without persistence
- timing-policy-sync.ts — exact-once config subscription and serialized full-policy refresh for an authenticated client
- connection-status.ts — discriminated operator connection states plus the one semantic notice-copy mapping shared by every surface
- connection-generation-controller.ts — framework-free fresh-client generation lifecycle: auth/restore promotion, full-jitter retry, stability reset, stale guards, disposal
- operator-auth.ts — shared Pet/Home/Chat authentication using the newest same-origin operator credential per generation
- ws-transport.ts — browser-WebSocket wrapper behind a small transport interface (keeps ws-client node-testable)
- device-identity.ts — the operator device identity (deviceId + reconnect token) persisted in localStorage
- presentation-gate.ts — the ONE presentation gate (D21/TTS seam): reply text + avatar command surface together
- active-character.ts — the pet window's active character id (data; M5 #24 makes it selectable)
- last-costume.ts — the last-worn costume per character (localStorage) so restarts re-wear it, not the default (M5 #24 moves this into real config)
- costume-report-sync.ts — window-local synchronization health for committed costume reports; newer tickets prevent stale report outcomes from overwriting the current costume
- costume-switch-attempt.ts — D61's cancellable whole-attempt controller: resolution/Tauri stage admission, renderer attachment commit, and bounded recoverable avatar.report
- promise-timeout.ts — withTimeout(promise, ms, label): labeled rejection for loads that can wedge (costume switches / boot promotion)
- character-asset-url.ts — costume identity + settings/per-resource asset URLs (convertFileSrc per file); unresolvable/`..` refs are stripped before the engine (#18)
- open-home-window.ts — pet→home window opener: creates home.html at the requested page or restores, navigates and focuses the open one (single instance by label); also owns the home:navigate event name
- costume-switch-event.ts — the BIDIRECTIONAL home↔pet costume seam: the three pet-scoped event names (switch / cancel / result), their emit helpers and the payload gates each side reads through (the live PetScene exists only in the pet window, so the page commands and the pet reports back)
- use-tauri-event.ts — the shared window-event plumbing: one stable listener per event name, handler read through a ref, unlisten on unmount
- use-cached-fetch.ts — the stale-while-revalidate seam every settings-family page loads through: last-good value first, background refresh, manual refresh, local mutate
- cached-fetch-state.ts — pure core of that seam: the load lifecycle, and the rule that a REJECTED load keeps the last good value on screen behind an error line
- cache-persist.ts — what the page cache may keep on disk: the persist allow-list (perception/chat payloads excluded by construction), the secret-knob scrub, and the schema-checked read that drops a drifted entry
- icons/ — self-drawn inline-SVG glyphs (no icon package, no imported asset): the shared Glyph frame + one file per glyph
