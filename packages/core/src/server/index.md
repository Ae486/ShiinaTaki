# core/server/
- ws-server.ts — the only socket-owning module; frame parse/validate, peer-address capture, pre-auth gate, dispatch, reply/notify, close
- method-registry.ts — WS method table + dispatcher; role gate + app-error mapping (invariant-7 wiring point); logs each unexpected failure once (method + closed code or error class)
- connection-registry.ts — per-socket auth state + Core-assigned per-Host generation and replacement-socket retirement
- app-error.ts — app-error envelope helpers (JSON_RPC_APP_ERROR + error.data.code)
- timeline-subscriptions.ts — timeline.appended/removed fan-out registry (characterId→connection→sink); disconnect cleanup
- memory-operation-subscriptions.ts — generic connection-scoped fan-out registry (connection→sink) plus the memory.operations.changed instance; memory.onboarding.changed reuses it; disconnect cleanup driven by ctx.onClose
- methods/ — one handler file per WS method
