# MCP Tool Schema Compatibility

## Goal

Prevent one provider-incompatible MCP tool schema from rejecting an entire chat turn. Fix the observed Tavily
`time_range` nullable-union failure through the installed AI SDK definition-to-tool seam, while preserving the official
MCP transport and execution path. This task is provider-neutral groundwork for the later full MCP integration and must
land before D60 native web search.

## Requirements

1. Replace the current direct `MCPClient.tools()` discovery call with the public two-stage API on the same client:
   `listTools()` -> per-definition compatibility preparation -> `toolsFromDefinitions()`.
2. Prepare each tool definition independently on a deep clone. Never mutate the definition returned by the MCP server.
3. Conservatively narrow only recognized optional-nullable property schemas:
   - The property is absent from its containing object's `required` array.
   - The schema is exactly one non-null branch plus one null branch, expressed as `anyOf`, `oneOf`, or a two-member
     `type` array.
   - The wrapper default is absent or `null`; explicit null is treated as the portable equivalent of omission.
   - Keep the property optional, retain the non-null branch constraints, prefer the wrapper's `title` and `description`,
     and remove `default: null` after narrowing.
4. Reject a definition rather than guess when a recognized nullable construct cannot be narrowed without changing its
   contract. This includes required-nullable properties, null at the root or in array items, null-only schemas, multiple
   non-null branches, and malformed `required` declarations encountered on the traversal path.
5. Leave schemas outside this narrowly verified nullable-compatibility class structurally unchanged. This batch does
   not claim to implement a universal JSON Schema dialect converter.
6. Omit only the incompatible tool. Other tools from the same server and all other servers must remain available.
7. Emit one structured warning per omitted tool with `server`, original `toolName`, stable issue `code`, and schema
   `path`. Do not log the schema body, descriptions, server configuration, headers, or secrets.
8. Preserve the original MCP definition name through `toolsFromDefinitions()` so execution still sends that raw name
   in `tools/call`. Keep existing TakiAgent namespacing, approval mapping, execute error wrapping, and shutdown behavior.
9. Use no new dependency and add no provider-name branch. Both configured model slots use the OpenAI-compatible
   provider seam, which exposes no reliable Gemini/DeepSeek capability discriminator.
10. Update `packages/core/src/mcp/index.md` for the new production module.

## Acceptance Criteria

- [x] A fixture matching the observed Tavily `time_range` shape (`anyOf` string enum plus null, optional, default null)
      becomes an optional scalar string enum with an explicit `type`, no nullable union, and no null default.
- [x] Equivalent optional-nullable `oneOf` and `type: [T, "null"]` forms follow the same conservative rule.
- [x] An ordinary non-nullable schema is deeply equal after preparation, and the original input remains unchanged.
- [x] Preparation is deterministic and idempotent.
- [x] Required-nullable, nullable array-item, null-only, and genuine multi-type fixtures are rejected with stable code
      and path instead of being narrowed.
- [x] With good/bad/good definitions from one in-memory MCP server, both good tools remain present and callable, only
      the bad tool is omitted, and exactly one warning names the server and raw tool without logging its schema.
- [x] Calling the namespaced surviving Tavily tool sends the original raw MCP tool name in `tools/call`.
- [x] The model-facing AI SDK schema for the Tavily fixture has the explicit scalar property type required by the
      observed Gemini FunctionDeclaration failure, while the ordinary fixture retains the shape accepted by DeepSeek.
- [x] Existing stdio and HTTP MCP transport tests remain green.
- [x] Focused MCP tests, Core typecheck, root lint, and `git diff --check` pass.

## Definition of Done

- Production code and focused unit/integration regressions are complete.
- The formal batch receives one Trellis check after implementation convergence; no redundant check is run during
  research or documentation-only follow-up.
- The reusable compatibility contract is reviewed for a backend spec update.
- Any provider-live smoke is reported separately; offline fixtures do not claim to prove current remote-provider
  behavior.

## Technical Approach

Add a focused module under `packages/core/src/mcp/` (expected name: `mcp-schema-compat.ts`) that accepts
`ListToolsResult`, prepares definitions independently, and returns the retained definitions plus structured skipped-tool
issues. Use the public `ListToolsResult["tools"][number]` shape rather than importing package internals.

`mcp-manager.ts` remains the orchestration boundary: it calls `listTools()`, passes the result through the compatibility
module, logs each omitted tool, and calls the same client's `toolsFromDefinitions()` with the retained definitions. The
existing merge step then namespaces keys and wraps execute errors exactly as today.

The first compatibility policy is deliberately narrow. It fixes the verified optional-nullable mismatch and isolates
unsafe variants, but it does not strip arbitrary validation keywords, dereference `$ref`, rewrite genuine unions,
branch on provider names, or retry a failed provider request with a looser contract.

## Decision (ADR-lite)

**Context:** DeepSeek accepts and can call the current Tavily MCP tool, while the Gemini-backed slot rejects the whole
request before generation because the nullable union wrapper has no scalar FunctionDeclaration type. An attached image
only selects the vision slot; it does not route the turn to web search.

**Decision:** Normalize and validate MCP definitions before official AI SDK tool construction. Narrow only optional null
that is portably representable as omission; isolate unsafe definitions per tool with structured diagnostics.

**Consequences:** The known failure is fixed without replacing MCP transport or execution. The compatibility module is
an explicit extension point for later evidence-backed dialect rules. Schemas outside the verified nullable class remain
unchanged, so this batch does not overstate universal provider compatibility.

## Out of Scope

- D60 native `web_search`, result shaping, provider selection, or URL safety policy.
- MCP management UI, dynamic reconnect/list-changed support, OAuth, secret storage, or approval-policy redesign.
- Provider-specific `wrapLanguageModel`, request-body rewriting, or reactive retry after a provider 400.
- A general JSON Schema/OpenAPI converter, `$ref` resolver, combinator simplifier, or arbitrary keyword allow-list.
- Automatic `tools/list` pagination; this preserves the installed SDK's current one-page `tools()` behavior.
- New dependencies or changes to MCP stdio/HTTP transport and `callTool()`.

## Research References

- `research/ai-sdk-mcp-schema-api.md` - installed public API, type shapes, conversion behavior, and raw-name closure.
- `research/provider-schema-compatibility.md` - verified provider mismatch and conservative normalization boundary.
- `research/repo-mcp-integration-map.md` - current repository data flow, isolation seam, logging, and test anchors.

## Technical Notes

- Installed versions: `@ai-sdk/mcp@2.0.10`, `ai@7.0.17`, `@ai-sdk/openai-compatible@3.0.5`.
- The repository does not retain the full hosted Tavily `tools/list` payload. The regression fixture must pin the exact
  observed failure shape recorded in HANDOFF/D60 and contain no credentials or server metadata.
- A live Gemini/DeepSeek smoke is useful release evidence but requires explicit authorization when it consumes external
  credentials or paid provider capacity.
