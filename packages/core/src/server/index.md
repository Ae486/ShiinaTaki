# core/server/
- ws-server.ts — socket owner for validated frames, peer-address capture, pre-auth/dispatch/reply/notify and frame-level yielding; shutdown drains accepted connection cleanup before storage release
- method-registry.ts — WS method table/dispatcher, role gate and app-error mapping; unexpected failures log once with method and closed code/error class
- connection-registry.ts — per-socket authentication and operator-display support, exact per-Host generations and replacement-socket retirement
- app-error.ts — app-error envelope helpers (JSON_RPC_APP_ERROR + error.data.code)
- timeline-subscriptions.ts — Character-scoped append/remove/commit/activity fan-out with isolated observers, disconnect cleanup and explicit transport acceptance/refusal/uncertainty
- memory-operation-subscriptions.ts — generic connection-scoped fan-out and memory.operations.changed; onboarding reuses the owner and ctx.onClose cleans up membership
- ws-listener.ts — bind/publish/retire listener replacement, preserved old endpoint on preparation failure and owned connection cleanup
- methods/ — one handler file per WS method
