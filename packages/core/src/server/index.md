# core/server/
- ws-server.ts — the only socket-owning module; frame parse/validate, pre-auth gate, dispatch, reply/notify, close
- method-registry.ts — WS method table + dispatcher; role gate + app-error mapping (invariant-7 wiring point)
- connection-registry.ts — per-socket auth state (awaiting|authenticated) + the tracked connection set (M3 seam)
- app-error.ts — app-error envelope helpers (JSON_RPC_APP_ERROR + error.data.code)
- methods/ — one handler file per WS method
