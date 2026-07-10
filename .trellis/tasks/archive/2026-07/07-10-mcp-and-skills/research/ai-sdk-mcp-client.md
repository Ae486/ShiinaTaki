# Research: @ai-sdk/mcp@2.0.10 client API + test fixture recipe

- **Query**: MCP client creation, stdio/HTTP transports, spawn site (ADR 0006), tools() conversion, lifecycle, error surfaces, no-new-deps test fixtures
- **Scope**: installed package (primary) + empirical probes (all transcripts below are real output; probe scripts ran under `research/tmp/`, deleted after)
- **Date**: 2026-07-10
- **Prior base**: `.trellis/tasks/archive/2026-07/07-10-memory-engine/research/ai-sdk-v7-tools.md` (tool-loop mechanics — not repeated here)

Evidence roots (installed):

- `MCP_DTS` = `packages/core/node_modules/@ai-sdk/mcp/dist/index.d.ts`
- `MCP_STDIO_DTS` = `packages/core/node_modules/@ai-sdk/mcp/dist/mcp-stdio/index.d.ts`
- `MCP_SRC` = `packages/core/node_modules/@ai-sdk/mcp/src/` (shipped in the npm package; mirrors dist)

## Verdicts (short)

1. `createMCPClient(config)` is the **stable, non-experimental** name (`MCP_DTS:636`; `experimental_createMCPClient` kept as alias, `MCP_DTS:765`). Stdio transport is a **separate subpath import** `@ai-sdk/mcp/mcp-stdio` and its class is still `Experimental_StdioMCPTransport` (`MCP_STDIO_DTS:97`).
2. The single sanctioned spawn site (ADR 0006): `spawn()` at `MCP_SRC/tool/mcp-stdio/create-child-process.ts:9`, invoked from `StdioMCPTransport.start()` which runs inside `createMCPClient` -> `client.init()` (`MCP_SRC/tool/mcp-client.ts:419`). Spawn is at connect time, `shell: false`.
3. `tools()` with default `schemas: 'automatic'` returns **`dynamicTool`s** (`tool.type === 'dynamic'`, input typed `unknown`) whose `inputSchema` is the server's JSON schema wrapped via `jsonSchema()` with `additionalProperties: false` forced (`mcp-client.ts:874-885`). Both fixture paths (stdio AND Streamable HTTP) proven end-to-end below.
4. Errors: connect failure throws from `createMCPClient` (client auto-closes); a JSON-RPC error response mid-call **throws `MCPClientError` from the tool's `execute`**; server death mid-call rejects in-flight calls with `MCPClientError: Connection closed`. Nothing crashes the process, but to conform to our `{ok:false}` return-shape rule we wrap `execute` (see §5).
5. No tool-name namespacing in the lib — collisions must be handled by us; renaming the record key is safe (§6).

## 1. Client creation + transports

```ts
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";

// stdio (config-driven process, ADR 0006)
const client = await createMCPClient({
  transport: new Experimental_StdioMCPTransport({
    command: "C:/path/to/server.exe",   // StdioConfig: command, args?, env?, stderr?, cwd?  (MCP_STDIO_DTS:75-81)
    args: ["--flag"],
    env: { API_KEY: "..." },            // NOT full inherit — see below
  }),
  onUncaughtError: (e) => log.warn(...), // transport-level errors outside a request
  // maxRetries?: number (default 0), clientName?, version?, capabilities?
});

// Streamable HTTP
const client2 = await createMCPClient({
  transport: { type: "http", url: "http://host/mcp", headers: { Authorization: "Bearer ..." } },
});
```

- `MCPClientConfig` at `MCP_DTS:599-635`. `transport` accepts a config object (`type: 'sse' | 'http'`, `MCP_DTS:256-314`) **or any custom `MCPTransport` object** (duck-typed on start/send/close, `mcp-transport.ts:139-150`) — this is the unit-test seam (§4b).
- `'http'` = Streamable HTTP (POST per message, optional inbound SSE via GET — a GET 405 is tolerated, `mcp-http-transport.ts:467`). `'sse'` is the separate legacy transport, still shipped, not type-deprecated; MCP spec itself deprecated SSE in 2025-03-26, and the HTTP transport's 404 error text says "Try using `sse` transport instead" for old servers. Use `'http'` as our default.
- HTTP extras: `initialSessionId`/`onSessionIdChange`/`onSessionExpired`/`terminateSessionOnClose`, `authProvider` (OAuth), custom `fetch` (`MCP_DTS:276-313`).
- **stdio env is NOT inherited wholesale**: child env = `config.env` merged with a fixed safe allowlist (Windows: APPDATA/HOMEDRIVE/…/PATH/USERPROFILE etc.; `get-environment.ts:10-25`). Secret env vars must be passed explicitly (from keyring, per ADR 0006).
- **Windows gotcha**: `shell: false` (`create-child-process.ts:11`) means `.cmd`/`.bat` shims (`npx`, `pnpm`) will NOT spawn on Node >= 20. Windows configs must use a real exe (`node.exe server.js`) or `cmd /c npx ...` as the command.
- Protocol: client sends `initialize` (latest version `2025-11-25`; accepts `2025-06-18`, `2025-03-26`, `2024-11-05` — `MCP_SRC/tool/types.ts:5-11`), then `notifications/initialized`. `client.serverInfo`, `client.instructions` (server-suggested system-prompt text) exposed (`MCP_DTS:642-656`).

## 2. tools() discovery and conversion

- `client.tools()` -> `listTools()` (`tools/list`) then `toolsFromDefinitions()` (`mcp-client.ts:794-803`). With `schemas: 'automatic'` (default) each MCP tool becomes a **`dynamicTool`** keyed by its raw MCP name: MCP JSON schema surfaced via `jsonSchema({...inputSchema, properties: inputSchema.properties ?? {}, additionalProperties: false})` (`mcp-client.ts:874-885`). Typed alternative: pass `schemas: { toolName: { inputSchema: zodSchema } }` to get statically-typed `tool()`s (unlisted names are skipped).
- The generated `execute` delegates to `client.callTool({name, arguments, options:{signal}})`; a server result with `isError: true` is **returned, not thrown** (`mcp-client.ts:861-863`). `toModelOutput` (`mcpToModelOutput`, `mcp-client.ts:147-177`) converts `CallToolResult.content` -> model-visible `{type:'content', value:[{type:'text',...}|file]}`; non-content results pass through as `{type:'json'}`.
- Tools also carry `metadata: { clientName, toolName, title? }` and `_meta` (MCP Apps).

## 3. Lifecycle + error surfaces (all probed)

| Situation | Surface (probed) |
|---|---|
| Connect: binary missing | `createMCPClient` rejects: `Error code: ENOENT, spawn ... ENOENT` |
| Connect: bad handshake / unsupported protocol | `MCPClientError` thrown; `init()` catch calls `close()` first (`mcp-client.ts:456-459`) — no zombie child |
| Mid-call: JSON-RPC error response (e.g. unknown tool) | `execute` **throws** `MCPClientError` with `.code` = JSON-RPC code (probe: `code: -32601, msg: Tool nope not found`) |
| Mid-call: server process dies | all in-flight requests reject `MCPClientError: Connection closed` (transport `onclose` -> `onClose()` flushes `responseHandlers`, `mcp-client.ts:1106-1119`) |
| Tool-declared failure (`isError: true`) | returned as a normal result (probe: `{"content":[{"type":"text","text":"boom"}],"isError":true}`) |
| After `close()` | `MCPClientError: Attempted to send a request from a closed client` |
| `close()` with in-flight calls | stdio: `AbortController.abort()` kills the child (`mcp-stdio-transport.ts:100-104`) -> pending calls reject `Connection closed`. HTTP: aborts fetches; sends session DELETE unless `terminateSessionOnClose: false` |

An `execute` that throws does NOT crash the ToolLoopAgent turn (prior research probe B1: `tool-error` part, model sees `error-text`, loop continues). But per `.trellis/spec/backend/error-handling.md` we still wrap each MCP tool's `execute` in a try/catch returning `{ok:false, code, message}` (§5) so the model gets machine-readable codes.

## 4. Fixture recipe (no new deps) — BOTH paths proven

Minimal server = **3 request methods + ignore notifications**: `initialize`, `tools/list`, `tools/call` (ignore `notifications/initialized`). Probe transcript (stdio, real client):

```
serverInfo: {"name":"fixture-server","version":"0.0.1"}
tool names: [ 'echo' ]   tool.type: dynamic
execute result: {"content":[{"type":"text","text":"echo: hello"}],"isError":false}
toModelOutput: {"type":"content","value":[{"type":"text","text":"echo: hello"}]}
```

### 4a. stdio fixture (integration test for the sanctioned spawn path)

Plain Node script, newline-delimited JSON-RPC on stdin/stdout; spawn it with `command: process.execPath, args: [fixturePath]`:

```js
// skills of the fixture: initialize / tools/list / tools/call; notifications ignored
import { createInterface } from "node:readline";
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined) return; // notification
  if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: {
    protocolVersion: "2025-06-18", capabilities: { tools: {} },
    serverInfo: { name: "fixture-server", version: "0.0.1" } } });
  else if (msg.method === "tools/list") send({ jsonrpc: "2.0", id: msg.id, result: { tools: [
    { name: "echo", description: "Echoes text", inputSchema: { type: "object",
      properties: { text: { type: "string" } }, required: ["text"] } }] } });
  else if (msg.method === "tools/call") send({ jsonrpc: "2.0", id: msg.id, result: {
    content: [{ type: "text", text: `echo: ${msg.params.arguments.text}` }] } });
  else send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
});
```

Vitest note: the fixture must be a plain `.mjs` (spawned by node directly, not through the TS pipeline). Death-mid-call variant: `process.exit(1)` inside `tools/call`.

### 4b. HTTP fixture (node:http)

Contract verified against `mcp-http-transport.ts`: each JSON-RPC request arrives as POST; reply `200` + `content-type: application/json` + the JSON-RPC response body; notifications -> `202` empty; GET -> `405` (transport treats 405 as "no inbound SSE", fine). Probe ran the real client against exactly this and passed (`PROBE-HTTP OK`).

### 4c. Cheapest unit-test seam: custom in-memory transport

`transport:` accepts any object with `start/send/close` + `onmessage` callbacks. The package ships a reference implementation at `MCP_SRC/tool/mock-mcp-transport.ts` (NOT exported from dist — copy the pattern, do not import). Use for pure unit tests; keep 4a as the one real-spawn integration test.

## 5. Our wrapper shape (error conformance)

Spread-and-replace keeps everything else (schema, toModelOutput, metadata) intact:

```ts
const wrapped = { ...mcpTool, execute: async (input, opts) => {
  try { return await mcpTool.execute(input, opts); }
  catch (e) { return { ok: false, code: mcpErrorCode(e), message: readableMessage(e) }; }
}};
```

`mcpToModelOutput` passes a non-content object through as `{type:'json', value}` (`mcp-client.ts:156-157`) — the `{ok:false}` shape reaches the model verbatim.

## 6. Tool-name collisions across servers

- The lib does **no prefixing**: `tools[name] = ...` keyed by raw MCP name (`mcp-client.ts:896`); doc comment says one client per server (`mcp-client.ts:327`). Merging two servers' ToolSets with `{...a, ...b}` silently last-wins.
- **Renaming the record key is safe**: `execute` closes over the original `name` and always calls the server with it (`mcp-client.ts:850-859`). Verified by reading the closure; the key only affects what the model sees.
- Recommendation: namespace at merge time as `${serverName}_${toolName}` (serverName = our config key, sanitized to `[a-zA-Z0-9_-]`), matching common host convention (Claude/Cursor use `mcp__server__tool`-style prefixes; providers restrict tool-name charsets, so stick to `_`).

## Caveats / Not Found

- `client.tools()` is a one-shot list; `notifications/tools/list_changed` is NOT handled (client rejects server requests other than ping/elicitation, `mcp-client.ts:1036`). Refresh = call `tools()` again or reconnect.
- OAuth (`authProvider`), resources, prompts, elicitation are out of scope for this slice; all exist on the client if needed later.
- `RequestOptions.timeout`/`maxTotalTimeout` exist on the type (`MCP_DTS:361-365`) but `request()` in 2.0.10 only wires `signal` — pass an `AbortSignal.timeout(...)` if we want per-call timeouts.
