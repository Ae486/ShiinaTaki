# Research: current MCP integration and schema-compatibility seam

- Query: Map the live MCP integration, the schema-poisoning failure, the smallest normalization/isolation boundary, and extendable tests for `mcp-tool-schema-compatibility`.
- Scope: internal
- Date: 2026-08-07

## Findings

### 1. Live integration chain

1. `main.ts` loads operator-owned `mcp-servers.json` and constructs one manager at boot (`packages/core/src/main.ts:171-177`). `mcp-connect.ts` creates the SDK client with either `Experimental_StdioMCPTransport` or Streamable HTTP; this directory is the sanctioned `@ai-sdk/mcp` boundary (`packages/core/src/mcp/mcp-connect.ts:4-31`, `packages/core/src/mcp/index.md:1-7`).
2. `createMcpManager()` concurrently discovers each server with `Promise.allSettled`; a connect or discovery failure is warned and skipped while other servers remain live (`packages/core/src/mcp/mcp-manager.ts:35-55`). Discovery currently calls `client.tools()` directly (`:69-78`). In installed `@ai-sdk/mcp@2.0.10`, that means `listTools()` followed by `toolsFromDefinitions()` (`packages/core/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts:794-803`); automatic conversion makes a dynamic AI SDK tool from each raw `inputSchema` (`:872-899`).
3. Manager merge exposes model-facing names as `${sanitize(serverKey)}_${rawToolName}`; key sanitation replaces non `[a-zA-Z0-9_-]` with `_`, collisions are last-wins with a warning, and `describe()` retains the raw `{serverName, toolName}` (`packages/core/src/mcp/mcp-manager.ts:89-99,128-130`).
4. `wrapExecute()` preserves each SDK tool's schema, metadata, and `toModelOutput`, but catches runtime RPC/connection failures and returns `{ok:false, code, message}` (`packages/core/src/mcp/mcp-manager.ts:101-125`). Its underlying SDK closure still calls the raw server tool name (`packages/core/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts:850-859`), so renaming only the ToolSet key is safe.
5. `main.ts` constructs an MCP-only approval gate using that `describe()` mapping (`packages/core/src/main.ts:179-185`; `packages/core/src/approval/approval-gate.ts:36-53`). It then spreads `mcpManager.tools()` into `extraTools` (`packages/core/src/main.ts:284-293`). Per turn, `chat-agent.ts` merges memory, extra, and character tools into `ToolLoopAgent`; the same agent installs the approval decision callback (`packages/core/src/agents/chat-agent.ts:174-188`). Shutdown calls `mcpManager.close()` before closing SQLite (`packages/core/src/main.ts:381-386`).

### 2. Current full-request poisoning point

The immediate manager issue is all-or-nothing discovery: `discover()` awaits `client.tools()` once for a whole server (`packages/core/src/mcp/mcp-manager.ts:69-78`), so an SDK conversion throw rejects the complete server discovery and excludes every tool from that server (`:43-53`). More importantly, raw MCP schemas are not vetted before reaching the agent. `ToolLoopAgent` receives the full merged ToolSet (`packages/core/src/agents/chat-agent.ts:174-182`), and AI SDK's per-request `prepareTools()` iterates every active tool and awaits `asSchema(tool.inputSchema).jsonSchema` (`packages/core/node_modules/ai/src/prompt/prepare-tools.ts:15-79`). The stream path invokes it before the provider call (`packages/core/node_modules/ai/src/generate-text/stream-text.ts:1828-1846`). Thus one definition that a provider dialect rejects poisons the entire turn before generation.

The observed production symptom is specifically Tavily's `time_range` nullable union lacking the top-level `type` Gemini `FunctionDeclaration` expects; DeepSeek accepts the same definition (`docs/HANDOFF.md:158-168`, `docs/deferred-decisions.md:88`). It is a provider-schema mismatch, not image routing.

### 3. Smallest implementation boundary

Keep `mcp-connect.ts`, transport creation, `wrapExecute()`, merge/namespacing, approvals, and chat-agent assembly unchanged. Replace only `discover()`'s `client.tools()` call with this sequence:

```
client.listTools() -> normalize one MCP inputSchema -> validate compatibility one definition at a time
                   -> warn + omit an incompatible definition -> client.toolsFromDefinitions(validDefinitions)
                   -> existing mergeServerTools() / wrapExecute()
```

`McpClient` already exposes both `listTools()` and `toolsFromDefinitions()` (`packages/core/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts:248-275,614-625,794-813`). A focused new production module under `packages/core/src/mcp/` should own definition normalization plus provider-safe validation; `mcp-manager.ts` should only call it and log skipped `{server, tool, reason}` entries. This preserves the official SDK converter and its raw-name execute closure. The normalizer must leave an ordinary schema byte-for-byte/structurally unchanged, canonicalize supported nullable unions such as Tavily's `time_range`, and reject only the individual definition when no compatible shape exists.

### 4. Tests, fixtures, and logging to extend

- `packages/core/src/mcp/mcp-manager.test.ts` already owns the cheapest faithful seam: `InMemoryTransport` implements `initialize`, `tools/list`, and `tools/call` (`:24-64`), `memConnect()` builds a real SDK client from it (`:77-83`), `makeManager()` exposes captured logs and closes managers after each test (`:13-22`). Existing coverage pins namespacing/raw mapping (`:86-92`), runtime RPC error wrapping (`:95-111`), failed-server isolation (`:113-129`), idempotent close, and a real stdio child (`:131-151`).
- Use that one transport to return two definitions from the **same** `tavily` server: one ordinary valid tool plus an unfixably incompatible tool. Assert the valid resulting key remains (`tavily_<rawName>`), the invalid one is absent, the server is not discarded, and a captured `warn` names the server/tool but not secret/config content. `createCaptureLogger()` records `{level,obj,msg}` and is the established assertion aid (`packages/core/src/testing/capture-logger.ts:1-37`). This follows the pino child/warn convention (`.trellis/spec/backend/logging-guidelines.md:1-10`).
- Add a realistic accepted Tavily-search fixture with the observed nullable optional field, rather than a made-up enum-only version:

```ts
const TAVILY_SEARCH = {
  name: "search",
  description: "Search the web for current information on any topic.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query." },
      time_range: { anyOf: [{ type: "string" }, { type: "null" }], description: "Optional recency range." },
    },
    required: ["query"],
  },
};
```

  Pin that normalization produces a property with a top-level non-null type plus nullable representation accepted by the selected compatibility rule, while preserving the raw MCP name: execute the namespaced output and assert `tools/call.params.name === "search"`. Also pin a nullable optional union and a plain object schema as distinct fixtures. There are no existing Gemini/DeepSeek dialect fixtures in `packages/core/src`; add focused unit fixtures beside the normalizer and keep the manager test as the integration proof.
- Keep `packages/core/src/testing/mcp-fixture.mjs` for the existing real stdio path; it is deliberately a minimal `initialize`/`tools/list`/`tools/call` process fixture (`:1-52`) and does not need provider-dialect cases unless an end-to-end transport regression is required. HTTP coverage already exists separately in `packages/core/src/mcp/mcp-http.test.ts:8-92`.

### 5. Likely affected and frozen files

| Category | Files | Reason |
| --- | --- | --- |
| Production | `packages/core/src/mcp/mcp-manager.ts`; new focused `packages/core/src/mcp/*schema*.ts`; `packages/core/src/mcp/index.md` | Insert definition preparation before official conversion; register the new module in the folder index. The quality guide requires a module header and directory index update (`.trellis/spec/backend/quality-guidelines.md:34-60`). |
| Tests | `packages/core/src/mcp/mcp-manager.test.ts`; new colocated schema-normalizer test | Reuse in-memory transport for same-server isolation and capture logs; unit-test normalization/validation. |
| Specs/documents | `.trellis/spec/backend/tool-design.md`, `.trellis/spec/backend/error-handling.md`, `.trellis/spec/backend/quality-guidelines.md`, `docs/HANDOFF.md:158-169`, `docs/deferred-decisions.md:88` | Read as constraints. A spec update is only warranted after implementation proves a reusable compatibility contract. |
| Frozen | `packages/core/src/mcp/mcp-connect.ts`, `packages/core/src/approval/approval-gate.ts`, `packages/core/src/agents/chat-agent.ts`, `packages/core/src/main.ts`, transport/execute behavior, approval persistence, `packages/core/package.json`, `pnpm-lock.yaml` | The approved seam is definitions before `toolsFromDefinitions()`, not a transport, approval, loop, provider, or dependency rewrite. Preserve original MCP execute names and no new dependency. |

## Caveats / Not Found

- No task `prd.md` exists yet under `.trellis/tasks/08-07-mcp-tool-schema-compatibility/`; this map uses the explicit research request plus the approved D60/HANDOFF constraints.
- The repository records the real Tavily failure shape semantically (nullable `time_range` union with no top-level type) but does not retain a raw captured `tools/list` payload. The fixture above is deliberately the minimal observed shape; before accepting an implementation, compare it against a freshly captured redacted live definition if available without placing keys or server payloads containing secrets in the repo.
- The installed versions are `@ai-sdk/mcp@2.0.10`, `ai@7.0.17`, and `@ai-sdk/openai-compatible@3.0.5` (`packages/core/package.json:14-15`; installed source cited above). Re-check the converter seam on any SDK upgrade.
