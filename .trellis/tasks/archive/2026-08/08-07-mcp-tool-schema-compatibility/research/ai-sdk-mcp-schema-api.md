# Research: Installed AI SDK MCP definition-to-tool API

- Query: What the installed `@ai-sdk/mcp` definition APIs return, where MCP JSON Schema can be normalized without replacing SDK transport/execution, and which hooks and test constraints apply.
- Scope: internal (installed package source/types plus current TakiAgent integration)
- Date: 2026-08-07

## Findings

### Installed versions and files found

- `packages/core/package.json:14` declares `@ai-sdk/mcp: ^2.0.10`.
- `pnpm-lock.yaml:127`, `pnpm-lock.yaml:186`, and `pnpm-lock.yaml:1958` resolve it to `@ai-sdk/mcp@2.0.10(zod@4.4.3)`.
- `packages/core/node_modules/@ai-sdk/mcp/package.json:2-3` confirms package/version; lines 33-36 pin its internal provider dependencies to `@ai-sdk/provider-utils@5.0.7` and `@ai-sdk/provider@4.0.3`; lines 47-51 require Zod `^3.25.76 || ^4.1.8` and Node `>=22`.
- `packages/core/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts` is the authoritative implementation of listing, conversion, execution, and output handling.
- `packages/core/node_modules/@ai-sdk/mcp/src/tool/types.ts` defines the runtime Zod schemas and conditional tool-set types.
- `packages/core/node_modules/@ai-sdk/mcp/dist/index.d.ts:765` is the public export list. It exports `MCPClient`, `ListToolsResult`, and `McpProviderMetadata`, but not `McpToolSet`, `ToolSchemas`, `MCPTool`, or a standalone `toolsFromDefinitions` function.
- `packages/core/src/mcp/mcp-manager.ts:69-78` is the current TakiAgent discovery seam; it currently calls `client.tools()`.
- `packages/core/src/mcp/mcp-manager.test.ts:24-64` already has a duck-typed in-memory transport suitable for exercising listing and raw `tools/call` requests.

### Public API behavior in 2.0.10

| API | Installed signature | Actual behavior |
| --- | --- | --- |
| `client.listTools()` | `listTools({ params?, options? }?): Promise<ListToolsResult>` (`mcp-client.ts:255-258`) | Sends one `tools/list` JSON-RPC request and parses the response with `ListToolsResultSchema` (`mcp-client.ts:614-625`). It returns definitions, not AI SDK `Tool` objects. `params.cursor`, abort/timeout options, and `nextCursor` exist, but there is no automatic pagination. |
| `client.tools()` | `tools({ schemas? }?): Promise<McpToolSet<...>>` (`mcp-client.ts:248-250`) | Calls `listTools()` exactly once, then calls the same client's `toolsFromDefinitions()` (`mcp-client.ts:794-803`). Default mode is `schemas: "automatic"`. |
| `client.toolsFromDefinitions()` | `toolsFromDefinitions(definitions: ListToolsResult, { schemas? }?): McpToolSet<...>` (`mcp-client.ts:272-275`) | Synchronously converts already-fetched definitions into AI SDK tools bound to this client (`mcp-client.ts:808-899`). It performs no transport request during conversion. It is a public **instance method**, not a package-level named export. |

The root README describes `tools()` as the normal conversion path (`README.md:26-60`), but the public `MCPClient` type intentionally exposes the lower-level two-stage path.

### Exact definition and return shapes

`ListToolsResult` is the inferred type of a loose Zod object (`types.ts:145-181`):

```ts
type ListToolsResult = {
  _meta?: Record<string, unknown>;
  nextCursor?: string;
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema: {
      type: "object";
      properties?: Record<string, unknown>;
      [key: string]: unknown;
    };
    outputSchema?: Record<string, unknown>;
    annotations?: { title?: string; [key: string]: unknown };
    _meta?: Record<string, unknown>;
    [key: string]: unknown;
  }>;
};
```

Consequences:

- Runtime parsing rejects a definition whose `inputSchema` is absent, non-object, or whose top-level `type` is not exactly `"object"` (`types.ts:149-162`). Extra JSON Schema keywords survive because the objects are loose.
- There is no publicly exported `ToolDefinition`/`MCPTool` alias. Consumer code can use `ListToolsResult["tools"][number]` without importing internals.
- Automatic mode returns `Record<string, McpToolBase<unknown, CallToolResult>>`; explicit schemas produce a mapped type keyed by the schema record and infer input/output types (`types.ts:24-61`). TakiAgent currently widens this through `unknown` to AI SDK `ToolSet` because of variance (`mcp-manager.ts:72-74`).

### What conversion changes and preserves

In automatic mode, each server schema is wrapped as a dynamic AI SDK tool. Conversion makes only this shallow schema rewrite (`mcp-client.ts:872-885`):

```ts
jsonSchema({
  ...inputSchema,
  properties: inputSchema.properties ?? {},
  additionalProperties: false,
})
```

It does **not** recursively normalize nested objects, unions, tuple-style arrays, `$defs`/`definitions`, formats, or other provider-sensitive keywords. The `jsonSchema()` wrapper has no validator unless one is explicitly supplied (`@ai-sdk/provider-utils/src/schema.ts:98-121`), so automatic MCP input schemas are primarily model-facing descriptions rather than a new runtime validation boundary.

Explicit mode uses the caller's `schemas[name].inputSchema` unchanged and optional `outputSchema` (`mcp-client.ts:886-894`). A Zod/Standard Schema supplied here is converted through provider-utils and receives recursive `additionalProperties: false`; a raw `jsonSchema(...)` schema does not (`@ai-sdk/provider-utils/src/schema.ts:135-162`, `:195-232`). The recursive helper itself is internal, mutating, and not in the public provider-utils export list.

Other preserved behavior:

- Description/title, MCP metadata, `_meta`, MCP Apps metadata, and `mcpToModelOutput` remain attached (`mcp-client.ts:824-848`, `:872-896`).
- `execute` closes over the definition's `name` and calls `self.callTool({ name, arguments: args })`; the abort signal is forwarded (`mcp-client.ts:850-870`). `callTool` then uses the official `tools/call` transport path and result schema (`mcp-client.ts:651-672`).
- Therefore, changing only `definition.inputSchema` while retaining `definition.name` preserves the original MCP execution name. TakiAgent can continue exposing a namespaced outer ToolSet key; its spread wrapper retains the closed-over SDK execute function (`mcp-manager.ts:89-115`).
- Automatic conversion ignores the server definition's `outputSchema`: the conversion loop does not destructure it, and output validation is enabled only by caller-provided `schemas[name].outputSchema` (`mcp-client.ts:816-834`, `:865-869`).
- Duplicate definition names overwrite earlier entries because output is assigned as `tools[name]` (`mcp-client.ts:896`).

### Recommended normalization seam

Use the installed public two-stage API on the same client:

```ts
const definitions = await client.listTools();
const normalized: ListToolsResult = {
  ...definitions,
  tools: definitions.tools.map(definition => ({
    ...definition,
    inputSchema: normalizeModelFacingSchema(definition.inputSchema),
  })),
};
const tools = client.toolsFromDefinitions(normalized);
```

This is the narrowest seam that preserves the SDK's transport, retry/abort behavior, result parsing, `toModelOutput`, metadata, and raw MCP name closure. The normalizer should be pure/deep-cloning (server definitions may be retained or logged), recursive, and explicitly preserve top-level `type: "object"` plus the `name` field. If pagination is required, collect all pages with `listTools({ params: { cursor } })` before one conversion.

The alternative public seam is `toolsFromDefinitions(definitions, { schemas })`. Its record is both an allowlist and a schema replacement: only definitions whose names are own properties of the record are exposed (`mcp-client.ts:825-830`; security rationale in `CHANGELOG.md:111-119`). This is useful for deliberate per-tool typed overrides, but generating it for every dynamic MCP definition is more type-heavy and accidentally omitting a key silently removes that tool.

### Existing hooks and compatibility limits

- `@ai-sdk/mcp` has no schema-transform callback, provider selector, compatibility mode, or per-definition predicate. Its only per-name control is the `schemas` record described above.
- `splitMCPAppTools(definitions)` is exported, but filters MCP Apps visibility; it is not a JSON Schema compatibility hook.
- AI SDK `ai@7.0.17` resolves each tool's schema and passes it to the model unchanged (`node_modules/.pnpm/ai@7.0.17_zod@4.4.3/node_modules/ai/src/prompt/prepare-tools.ts:35-60`). The model-facing name is the outer ToolSet record key, which is why TakiAgent namespacing does not change the raw MCP call name.
- Installed `@ai-sdk/openai-compatible@3.0.5` directly maps that schema to OpenAI `function.parameters` (`src/chat/openai-compatible-prepare-tools.ts:51-66`). Its `strictJsonSchema` option controls only structured-response `response_format.json_schema.strict`, not tool parameters, and is not a normalizer (`openai-compatible-chat-language-model-options.ts:22-29`; `openai-compatible-chat-language-model.ts:279-290`).
- That provider does expose `transformRequestBody(args)` at provider construction (`openai-compatible-provider.ts:94-99`, `:170-177`) and applies it immediately before both generate and stream requests (`openai-compatible-chat-language-model.ts:327-333`, `:430-445`). It could rewrite `body.tools[*].function.parameters`, but it is a broad, untyped, provider-wide last-mile hook. It is less suitable than definition normalization for preserving reusable behavior across providers and tests.

### Type/runtime constraints and test seams

1. Unit-test normalization as a pure recursive function with nested object/array/union/reference fixtures; assert immutability, idempotence, retained required/description fields, and only the intended keyword changes.
2. Extend `mcp-manager.test.ts`'s `InMemoryTransport` (`:24-64`) with an incompatible advertised schema and call capture. Assert the converted tool's resolved `inputSchema.jsonSchema`, the unchanged namespaced public key, and the outbound `tools/call.params.name ===` original raw name.
3. Keep the existing real stdio test (`mcp-manager.test.ts:140-150`) as the transport/execute regression seam. It proves normalization did not replace official MCP execution.
4. For a final model-boundary assertion, `MockLanguageModelV4` records `doStreamCalls`/`doGenerateCalls`; AI SDK's `prepareTools` output can be inspected at `call.tools`. This catches a schema that looks normalized on definitions but is changed or lost before provider invocation.
5. Test `nextCursor` explicitly if multi-page servers are in scope; replacing `client.tools()` with one raw `listTools()` call otherwise preserves the installed single-page behavior, not full discovery.
6. Test prototype-named definitions and duplicate names. The explicit-schema allowlist is prototype-safe, while definition-to-record conversion still has last-write-wins semantics.

### External references

No external documentation was needed. All conclusions above come from the exact installed package sources, emitted public declarations, lockfile, and current repository tests.

### Related specs

- `.trellis/workflow.md` requires research to be persisted under the active task.
- `packages/core/src/mcp/index.md` states that `core/mcp` is the sanctioned `@ai-sdk/mcp` import boundary.
- No files were present under `.trellis/spec/` in this checkout, so there is no additional Trellis package spec to cite.

## Caveats / Not Found

- The published package excludes its upstream test files (`@ai-sdk/mcp/package.json:9-15`), so package behavior was verified from installed source and declarations rather than upstream tests.
- No standalone exported `toolsFromDefinitions()` function, public `ToolSchemas` type, schema transformation callback, or provider-specific MCP compatibility API exists in `@ai-sdk/mcp@2.0.10`.
- The recommended normalizer's exact compatibility policy (which JSON Schema keywords to remove/rewrite for which providers) is outside this API-surface research and must be specified separately.
