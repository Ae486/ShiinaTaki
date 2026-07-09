# Research: json-rpc-2.0@1.7.1 — envelope library over `ws`

- **Query**: Exact APIs of JSONRPCServer/Client/ServerAndClient, wiring over `ws`, error responses, zod-first validation, use-vs-handroll verdict
- **Scope**: internal (installed .d.ts + dist JS + README)
- **Date**: 2026-07-09

Evidence root: `LIB` = `node_modules/.pnpm/json-rpc-2.0@1.7.1/node_modules/json-rpc-2.0/dist/`. Extends (not repeats) the 07-07 ecosystem scan verdict "ADOPT (envelope only)" — `.trellis/tasks/archive/2026-07/07-07-reference-research/research/ecosystem-gap-scan.md` §3.

## Exports (`LIB/index.d.ts` re-exports client, server, server-and-client, models, interfaces)

### Models & helpers (`LIB/models.d.ts`)

- Types: `JSONRPCRequest { jsonrpc:"2.0", method, params?, id? }`, `JSONRPCSuccessResponse { id, result }`, `JSONRPCErrorResponse { id, error: {code, message, data?} }`, `JSONRPCID = string | number | null` (lines 3-33).
- Factories (lines 47-50): `createJSONRPCErrorResponse(id, code, message, data?)`, `createJSONRPCSuccessResponse(id, result?)`, `createJSONRPCRequest(id, method, params?)`, **`createJSONRPCNotification(method, params?)`** — this last one is how the server pushes notifications without needing a `JSONRPCClient`.
- `JSONRPCErrorCode` enum (lines 40-46): `ParseError=-32700, InvalidRequest=-32600, MethodNotFound=-32601, InvalidParams=-32602, InternalError=-32603` — matches the PRD's `JSON_RPC_ERROR_CODES` exactly.
- `JSONRPCErrorException(message, code, data?)` (lines 34-39): throw from a handler to produce a custom-coded error response with `data` attached.
- Type guards `isJSONRPCRequest/Response(...)` (lines 25-28) — we use zod instead.

### Server (`LIB/server.d.ts`)

- `new JSONRPCServer(options?)`; `addMethod(name, (params, serverParams) => any)` (simple form, return value → `result`, thrown/rejected → error response); `addMethodAdvanced` (full request in/response out); `hasMethod`; `applyMiddleware` (lines 10-27).
- `receive(request, serverParams?)` accepts an **already-parsed object** and resolves the response object (or `null` for notifications) — lines 23-24. `receiveJSON(json: string)` exists but does the lib's own parse/shape check — we do NOT use it (zod gate first, §"Ordering" below).
- Runtime behavior verified in `LIB/server.js`:
  - Unknown method with `id` → auto `-32601 "Method not found"` response (`server.js:199-200`); unknown-method **notification** → silently `null` (spec-correct).
  - Handler throws plain `Error` → error response with **code `0`** (`DefaultErrorCode`, `internal.d.ts:1`, mapping at `server.js:238-247`) — NOT `-32603`. To control codes: throw `JSONRPCErrorException` (its `code`/`data` pass through) or override `server.mapErrorToJSONRPCErrorResponse` (public field, `server.d.ts:14`).

### Client (`LIB/client.d.ts`)

- `new JSONRPCClient(send: (payload) => PromiseLike<void> | void, createID?)` — you supply the transport write (`ws.send`).
- `request(method, params)` → Promise resolved/rejected when a correlated response arrives; correlation via internal `idToResolveMap` (auto-incrementing ids). `notify(method, params)` fire-and-forget. `receive(response)` — feed inbound responses. `rejectAllPendingRequests(message)` — call on socket close. `timeout(ms).request(...)` for per-call deadlines (lines 9-25).

### Bidirectional (`LIB/server-and-client.d.ts`) — for the CLI

- `new JSONRPCServerAndClient(server, client, options?)` composes both; `receiveAndSend(payload)` routes an inbound parsed frame to the server half (requests/notifications) or client half (responses) automatically (line 23). README lines 227-262 document exactly the WebSocket pattern:

```ts
// CLI side (apps/cli/src/chat-client.ts shape)
import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import WebSocket from "ws";

const ws = new WebSocket(url);
const rpc = new JSONRPCServerAndClient(
  new JSONRPCServer(),
  new JSONRPCClient((payload) => { ws.send(JSON.stringify(payload)); }),
);
ws.on("message", (data) => {
  const frame = /* zod-validate JSON.parse(data) against @taki/shared */;
  void rpc.receiveAndSend(frame);
});
ws.on("close", () => rpc.rejectAllPendingRequests("connection closed"));

// server-pushed notifications land as methods:
rpc.addMethod(CHAT_METHODS.delta, (params /* zod-parsed ChatDelta */) => { onDelta(params); });
rpc.addMethod(CHAT_METHODS.complete, (params) => { /* resolve turn */ });
// requests out:
const { messageId } = await rpc.request(CHAT_METHODS.send, { characterId, message });
```

### Core side (server pushes, never requests)

No `JSONRPCClient` needed in core: per-connection notify is
`socket.send(JSON.stringify(createJSONRPCNotification(CHAT_METHODS.delta, params)))` — that is the whole `ctx.notify` implementation. Dispatch: one shared `JSONRPCServer` (stateless method table) or the PRD's `method-registry` wrapping it; `const response = await server.receive(frame); if (response) socket.send(JSON.stringify(response));`.

## Ordering: zod BEFORE the lib (required, and it composes cleanly)

`server.receive()` / `receiveAndSend()` take parsed objects, so the mandated pipeline works with no lib cooperation:

1. `JSON.parse` raw ws text → on throw, reply `createJSONRPCErrorResponse(null, -32700, "Parse error")` ourselves.
2. `JsonRpcInboundFrameSchema.safeParse` → on fail, reply `-32600` ourselves (id if recoverable, else null).
3. Hand validated frame to `server.receive(frame)` (or registry). Method-level `params` zod check inside the handler wrapper → on fail `throw new JSONRPCErrorException("Invalid params", JSONRPCErrorCode.InvalidParams, { issues })` → lib emits `-32602` with our `data`.

The lib never sees an invalid frame; `-32700`/`-32600` are synthesized by us, `-32601` by the lib, `-32602`/domain errors via `JSONRPCErrorException`.

## TypeScript typing quality

Ships its own `.d.ts` (no `@types` needed). Envelope types are precise; `params`/`result` are `any` (`models.d.ts:4`) — acceptable because zod schemas in `@taki/shared` are our single source of typed truth on both ends. Optional `TypedJSONRPCClient/Server/ServerAndClient` interfaces (`interfaces.d.ts:5-14`) give compile-time method-name/param mapping from a method-signature record type; nice-to-have, works alongside zod. Zero runtime deps (package.json `dependencies: {}`).

## Verdict: USE the lib (keep the TECH-STACK default) — no blocking reasons found

- Fit is exact: transport-agnostic (we own the `ws` socket), parsed-object ingestion (zod gate stays first), spec-correct id correlation + notification semantics + batch handling for free, `JSONRPCErrorCode` matches the PRD table, README documents our exact ws pattern.
- The CLI's request/response correlation (`idToResolveMap`, timeout, reject-on-close) is the part genuinely worth not hand-writing.
- Frictions found are minor and handled by convention, not forks: (a) plain thrown `Error` maps to code `0`, so handlers must throw `JSONRPCErrorException` for coded errors (or we override `mapErrorToJSONRPCErrorResponse` once); (b) `params: any` — already solved by zod-at-the-boundary; (c) CJS-built package (`"use strict"` dist) — imports fine from ESM via default interop; named imports work because it has proper `exports`.

Hand-rolling ~60 lines would re-implement correlation, timeouts, and error mapping with no offsetting gain. Explicitly: **do not overturn the default**.

## Caveats / Not Found

- The lib logs handler errors through `errorListener` (default `console.warn`) — pass `{ errorListener }` wired to pino at construction (`server.d.ts:7-9`, `server-and-client.d.ts:4-6`).
- `client.request()` rejects with a plain `Error` carrying the response's `error.message` (README "Error handling") — the CLI should surface `code` by reading the error response via zod on the frame layer if it needs codes (chat.error notifications carry our structured code anyway; JSON-RPC-level errors are envelope bugs).
- Batch requests (arrays) are supported by `receive`/`receiveJSON` overloads; the PRD does not use batches — our zod inbound schema (single-frame union) will reject arrays with `-32600`, which is an accepted narrowing, not a lib limitation.
