# core/server/
- ws-listener.ts — bind/publish/retire listener replacement, preserved old endpoint on preparation failure and owned connection cleanup
- ws-server.ts — the only socket-owning module; frame parse/validate, peer-address capture, pre-auth gate, dispatch, reply/notify, and shutdown that drains accepted connection cleanup before storage release
- method-registry.ts — WS method table + dispatcher; role gate + app-error mapping (invariant-7 wiring point)
- connection-registry.ts — per-socket authentication and operator display support, per-Host generations and replacement retirement
- app-error.ts — app-error envelope helpers (JSON_RPC_APP_ERROR + error.data.code)
- timeline-subscriptions.ts — Character-scoped append/remove/commit/activity fan-out with isolated observers; observed delivery distinguishes transport acceptance, refusal and uncertainty
- memory-operation-subscriptions.ts — memory.operations.changed fan-out registry (one channel, connection→sink); disconnect cleanup driven by ctx.onClose
- methods/ — one handler file per WS method
