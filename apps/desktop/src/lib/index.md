# lib/
Cross-cutting Pet UI clients + seams (talk to the Agent Core / hold window-shared services). Framework-free.
- ws-client.ts — operator WS JSON-RPC client to the Core (browser WebSocket); the zod boundary for inbound frames
- ws-transport.ts — browser-WebSocket wrapper behind a small transport interface (keeps ws-client node-testable)
- device-identity.ts — the operator device identity (deviceId + reconnect token) persisted in localStorage
- presentation-gate.ts — the ONE presentation gate (D21/TTS seam): reply text + avatar command surface together
- active-character.ts — the pet window's active character id (data; M5 #24 makes it selectable)
- last-costume.ts — the last-worn costume per character (localStorage) so restarts re-wear it, not the default (M5 #24 moves this into real config)
- promise-timeout.ts — withTimeout(promise, ms, label): labeled rejection for loads that can wedge (costume switches / boot promotion)
- character-asset-url.ts — costume settings + per-sub-resource asset: URLs (convertFileSrc per file) with external-ref resolution; unresolvable/`..` refs resolve to null and get stripped before the engine (#18)
- resolve-switch-report.ts — the shared costume switch+report dance (resolution → asset source → timeout-guarded switchCostume → avatar.report with the worn costume id); aborts the switch on timeout/failure so a late model self-discards (1f Fix 1); used by boot promotion and manual switch (1b)
- open-chat-window.ts — pet→chat window opener (#17): show/focus an existing chat window or runtime-create chat.html
