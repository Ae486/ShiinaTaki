# core/server/
- ws-server.ts — the only socket-owning module; frame parse/validate, dispatch, reply/notify, close
- method-registry.ts — WS method table + dispatcher (invariant-7 wiring point)
- methods/ — one handler file per WS method
