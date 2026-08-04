# lib/
Cross-cutting Pet UI clients + seams (talk to the Agent Core / hold window-shared services). Framework-free apart from
icons/, which is the shared glyph set every window renders.
- ws-client.ts — operator WS JSON-RPC client to the Core (browser WebSocket): the public WsClient surface + turn/handshake wiring
- ws-client-routes.ts — inbound half: the zod boundary (frame parse + chat-stream/avatar/timeline/config push routing) and the D29 mid-turn-close abort
- ws-client-methods.ts — outbound half: the handshake + every plain request/response method (timeline, media, character, config, memory, perception)
- ws-transport.ts — browser-WebSocket wrapper behind a small transport interface (keeps ws-client node-testable)
- device-identity.ts — the operator device identity (deviceId + reconnect token) persisted in localStorage
- presentation-gate.ts — the ONE presentation gate (D21/TTS seam): reply text + avatar command surface together
- active-character.ts — the pet window's active character id (data; M5 #24 makes it selectable)
- last-costume.ts — the last-worn costume per character (localStorage) so restarts re-wear it, not the default (M5 #24 moves this into real config)
- promise-timeout.ts — withTimeout(promise, ms, label): labeled rejection for loads that can wedge (costume switches / boot promotion)
- character-asset-url.ts — costume settings + per-sub-resource asset: URLs (convertFileSrc per file) with external-ref resolution; unresolvable/`..` refs resolve to null and get stripped before the engine (#18)
- resolve-switch-report.ts — the shared costume switch+report dance (resolution → asset source → timeout-guarded switchCostume → avatar.report with the worn costume id); aborts the switch on timeout/failure so a late model self-discards (1f Fix 1); used by boot promotion and manual switch (1b)
- open-home-window.ts — pet→home window opener: creates home.html at the requested page or navigates the open one (single instance by label); also owns the home:navigate event name
- costume-switch-event.ts — the home→pet costume seam: the pet-scoped event name, the emit helper and the pet-side payload gate (the live PetScene exists only in the pet window)
- icons/ — self-drawn inline-SVG glyphs (no icon package, no imported asset): the shared Glyph frame + one file per glyph
