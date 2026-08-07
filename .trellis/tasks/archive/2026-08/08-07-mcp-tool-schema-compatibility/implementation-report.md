# MCP Tool Schema Compatibility - Implementation Report

## Landed Scope

- Added a pure definition-stage compatibility module under `packages/core/src/mcp/`.
- Replaced direct `MCPClient.tools()` discovery with the same client's public `listTools()` -> prepare ->
  `toolsFromDefinitions()` sequence.
- Added conservative optional-nullable narrowing, per-tool isolation, structured secret-safe warnings, and raw MCP
  execution-name regressions.
- Preserved transport, approval, ToolSet namespacing, execute error wrapping, shutdown, and one-page discovery behavior.
- Added the reusable backend contract at `.trellis/spec/backend/mcp-tool-schema-compatibility.md`.

## Formal Check Findings

The single formal `trellis-check` found and fixed four issues:

1. `required` membership used the prototype chain; it now requires an own schema property.
2. A retained non-null branch could keep `default: null`; narrowing now removes that invalid default.
3. The integration test stopped at the AI SDK Tool object; it now captures the actual OpenAI-compatible request body
   through a fake `fetch` and asserts serialized tool parameters.
4. Idempotence covered only unchanged definitions; transformed Tavily definitions now have a second-pass assertion.

The Leader's pre-check review separately caught nullable wrappers whose retained branch had no single explicit type
(`$ref + null` or a retained multi-type branch). Those tools are now isolated with regression tests.

## Verification

- `pnpm --filter @taki/core test -- src/mcp`: 4 files, 29 tests passed, including real stdio and Streamable HTTP.
- `pnpm --filter @taki/core typecheck`: passed.
- `pnpm lint`: passed.
- `git diff --check`: passed.

No live Gemini or DeepSeek request was run. Offline coverage proves deterministic preparation, installed AI SDK
conversion, actual OpenAI-compatible request serialization, same-server isolation, and raw MCP execution identity; it
does not claim current remote-provider availability.

## Residual Boundaries

- No general union conversion, `$ref` resolution, arbitrary JSON Schema dialect rewriting, or provider-name branch.
- No automatic MCP tools-list pagination, reconnect/list-changed handling, credential work, MCP UI, or D60 web search.
- A new compatibility rule requires provider failure evidence, a semantics-preservation argument, and focused fixtures.

## Process Note

The implement sub-agent used YCE twice during initial read-only discovery before the Leader corrected it: the first
attempt failed for a missing key and the second used a local fallback. It changed no configuration or repository files.
No later agent communication or search used YCE. The project rule remains: unknown code discovery uses English
`jbcontext`; known files and symbols use direct reads or `rg`.
