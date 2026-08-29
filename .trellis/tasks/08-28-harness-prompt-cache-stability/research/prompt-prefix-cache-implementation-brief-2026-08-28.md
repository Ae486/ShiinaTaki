# Prompt-prefix cache implementation brief

This brief is the dispatch-sized routing document. The full evidence remains in
`research/prompt-prefix-cache-audit-2026-08-28.md` and must be read from disk when a detail is needed.

## Confirmed cause and baseline

- Recent real `deepseek-v4-flash` requests carried about 68.5k input tokens but exactly 6,912 cache-read tokens,
  approximately 10.1%.
- `packages/core/src/extensions/extension-registry.ts::renderContext()` puts the fresh `snapshot.runId` in the system
  instructions before replayed history.
- DeepSeek invalidates cache reuse from the first changed token. This UUID is the dominant fixed breakpoint.
- Canonical Local memory was active and stable during the measured requests; provider usage telemetry is authoritative.

## Required production behavior

1. Remove the UUID value from model-visible extension context. Retain stable extension count, immutable-snapshot
   lifetime guidance, permission guidance and Host-selection guidance.
2. Do not change `ExtensionRunSnapshot`, discover/describe/call result schemas, private registry lookup, captured
   Skill/MCP/Host closures, generation leases, Governance, Approval, Run/Attempt/Effect identity or telemetry.
3. Assemble ChatAgent tools once per attempt and pass a complete `toolOrder` sorted with a locale-independent UTF-16
   comparator. AI SDK 7.0.17 serializes only tool definitions, not `execute` closures; without `toolOrder` it follows
   insertion order.
4. Do not modify memory semantics, Host catalog semantics, compaction, UI, provider-specific production code or
   observability payloads.

## Honest prefix contract

- Same semantic state: provider/model/config, system instructions and tool definitions/order are identical across
  different Run/Attempt ids.
- Within one ToolLoopAgent Run, a tool continuation strictly append-extends the prior model request.
- Across conversational Turns, TakiAgent intentionally does not persist the prior `<turn-context>` time/perception
  suffix. The common prefix reaches the prior plain user text; do not assert whole-message-array append-extension.
- Compaction/window movement, real memory/capability changes, provider/model changes, day rollover and image changes are
  legitimate explained boundaries.

## Test ownership

- `packages/core/src/extensions/extension-registry.test.ts`: different Run ids render identical UUID-free context;
  snapshots/results retain their own ids; calls reach only the registry's own captured spy.
- New focused `packages/core/src/agents/chat-agent-prefix-cache.test.ts` if cleanest: identical model-facing system/tools
  across different execution ids; canonical tool order; within-Run continuation; cross-Turn volatile-tail boundary;
  internal ids remain bound to the correct execution path.
- Read installed AI SDK types/dist before coding: `packages/core/node_modules/ai/dist/index.d.ts` and `index.js` around
  `toolOrder`, `prepareToolsAndToolChoice`, `orderToolEntries`, and ToolLoopAgent step assembly.

## Source routing

- Taki request assembly: `packages/core/src/agents/chat-agent.ts`.
- Extension authority: `packages/core/src/extensions/extension-registry.ts`, `extension-run-context.ts`,
  `extension-sources.ts`, `packages/core/src/harness/run-snapshot-capture.ts`.
- DSH cache proof: `references/deepseek-harness-master/packages/core/agent-loop/tests/request-cache.e2e.ts`.
- DSH canonical order: `references/deepseek-harness-master/packages/core/agent-loop/tests/tool-order.spec.ts` and
  `packages/core/system-prompt/src/index.ts`.
- DSH cache semantics: `references/deepseek-harness-master/packages/llm/llm-deepseek/README.md`.
- Taki E2E seams: `.trellis/spec/backend/e2e-harness.md`, `e2e/src/fixture/paths.ts`, `with-stack.ts`.

## Real-provider acceptance

- Use isolated temporary Core data, stable capabilities and deterministic 55k-80k history below compaction/window cut.
- Run a harmless tool Turn followed immediately by a normal new Turn; read normalized per-request `run_usage` only.
- Follow-up first request must reach `cache_read / input >= 0.50` and improve by at least 30 percentage points over
  10.1%. Every request after the cold first request must have positive cache reads unless an explicit semantic boundary
  is recorded.
- Repeat with a fresh temporary data directory. Record only provider/model/token counts/ratio/quality and request class;
  never prompts, raw payloads, credentials, provider bodies or raw ids.

## Caveats

- Explicit canonical tool order may cause one intentional one-time cache reset and can slightly alter model tool-choice
  priors; it makes later equivalent requests deterministic.
- Host `lastSeenAt`/array order and legacy-memory relative ages are latent concerns, not the measured fixed breakpoint.
- Do not lower the live threshold if it fails. Compare safe header/system/tool digests and locate the next proven
  volatility before changing scope.
