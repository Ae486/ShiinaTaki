# shared/src/
- index.ts — package public entry; named re-exports of the protocol surface
- ping-schema.ts — scaffold ping/pong smoke schema (desktop IPC smoke; untouched this slice)
- json-rpc-schema.ts — JSON-RPC 2.0 envelope schemas + JSON_RPC_ERROR_CODES + JSON_RPC_APP_ERROR + client-frame union
- error-code-schema.ts — closed cross-process ErrorCode union
- connect-schema.ts — CONNECT_METHOD + RoleSchema + connect handshake param/result schemas (ADR 0004)
- chat-schema.ts — CHAT_METHODS + chat.send/delta/complete/error param & event schemas
- ws-defaults.ts — default loopback WS host/port constants
