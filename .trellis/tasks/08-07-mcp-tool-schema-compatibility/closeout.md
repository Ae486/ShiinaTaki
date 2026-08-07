# MCP Tool Schema Compatibility Closeout

Status: implementation and formal check complete; ready to archive on 2026-08-07.

## Delivered Contract

- Commit `f7a406a` adds definition-stage MCP schema compatibility before official AI SDK tool construction.
- The same client now follows `listTools()` -> per-definition preparation -> `toolsFromDefinitions()`.
- Verified optional nullable forms are narrowed conservatively; unsafe recognized forms omit only that tool with a
  secret-safe structured warning.
- TakiAgent namespacing, approval mapping, raw MCP execution names, transport, execute error wrapping, shutdown, and
  one-page discovery remain unchanged.
- Durable implementation contract: `.trellis/spec/backend/mcp-tool-schema-compatibility.md`.

## Acceptance and Verification

- All PRD acceptance criteria are checked in `prd.md`.
- Focused MCP tests passed: 4 files, 29 tests, including real stdio and Streamable HTTP paths.
- `pnpm --filter @taki/core typecheck`, `pnpm lint`, and `git diff --check` passed.
- The provider-boundary fixture captures the actual OpenAI-compatible request body through a fake `fetch`.
- No paid/live Gemini or DeepSeek call was made; the task does not claim remote-provider availability.

## Review Findings Closed

- Leader pre-check review rejected nullable wrappers whose retained branch had no single explicit type.
- The single formal `trellis-check` fixed own-property validation for `required`, retained-branch `default: null`,
  transformed-schema idempotence coverage, and the missing provider request-boundary assertion.
- No formal-check findings remain open.

## Residual Boundaries

- No general union conversion, `$ref` resolution, provider-name branch, request retry with a looser schema, dependency,
  automatic tools-list pagination, or D60 search implementation.
- New compatibility rules require reproduced provider evidence, a semantics-preservation argument, and focused tests.
- D60 remains open. Its prior native-search proposal is explicitly reopened for owner review and is not binding.

## Process Record

- The implement sub-agent used YCE twice during initial read-only discovery before correction. It changed no config or
  repository file; no later agent work used YCE.
- All later sub-agent communication was in English. HANDOFF now requires high-quality dispatches, truthful completion
  reports, requirement-first review, and separate classification of extra work.
