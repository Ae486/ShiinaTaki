# Research: Harness prompt-prefix cache audit

- Query: Audit every model-request component that can affect provider prefix-cache reuse across adjacent TakiAgent conversational Runs; validate the minimal fix against the checked-in DeepSeek Harness implementation and installed AI SDK v7.
- Scope: mixed (current TakiAgent worktree, checked-in DeepSeek Harness source, installed dependency source)
- Date: 2026-08-28
- Repository state verified: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `2fe07ce`.
- Trellis pointer caveat: `python ./.trellis/scripts/task.py current --source` returned `Current task: (none) / Source: none`; `.trellis/.current-task` pointed to `.trellis/tasks/08-27-observability-projection-ui`. This research used the explicitly assigned task directory and did not alter task status or pointers.

## Findings

### Executive conclusion

The fresh Run UUID in `<extension-context>` is the confirmed dominant cause of the observed fixed cache breakpoint. It is rendered at the end of the system instructions, before all replayed history (`packages/core/src/extensions/extension-registry.ts:251-258`; `packages/core/src/agents/chat-agent.ts:449-469`). Because a new UUID is created for each admitted Run but the earlier system sections remain stable, the observed approximately 6,912 cached tokens are consistent with DeepSeek reusing only the prefix before that UUID and invalidating the long history that follows. The measured approximately 68.5k total input / exactly 6,912 cache-read pattern is much stronger evidence for this location than for memory mutation or provider telemetry failure.

The minimal behavioral fix is to remove only the UUID value from `renderContext()` while retaining stable guidance such as the semantic extension count. Do not move the UUID elsewhere in the prompt. Run/Attempt authority remains sealed in Core-owned state, snapshots, closures, Governance, Approval, effects, and routing; the prompt string is not an authority boundary.

Two qualifications are essential:

1. TakiAgent cannot honestly claim strict whole-request append-extension across conversational Turns. The prior request's newest user message contains a non-persisted `<turn-context>` suffix, while the next Turn replays that same user message without the suffix. The next request therefore shares the token prefix only through the plain user text, not through the prior tail or prior assistant/tool response (`packages/core/src/agents/chat-agent.ts:246-260,386-416`; `packages/core/src/agents/chat-agent-tail.test.ts:48-68`).
2. Fresh tool closure objects do not change model-facing tool definitions. AI SDK v7 serializes only tool name, description, input schema, examples/provider options/strictness; `execute` is not serialized (`packages/core/node_modules/ai/dist/index.js:2020-2044`). However, with no explicit `toolOrder`, AI SDK uses `Object.entries(tools)` insertion order (`packages/core/node_modules/ai/dist/index.js:2064-2076`). TakiAgent should regression-test current assembly order and preferably provide a locale-independent sorted `toolOrder`, following DSH's explicit canonical-order pattern.

### Files found

| File | Relevance |
| --- | --- |
| `packages/core/src/agents/chat-agent.ts` | Complete TakiAgent per-attempt request assembly, tool loop, replay, tail, image, retry, and persistence path. |
| `packages/core/src/agents/conversation-store.ts` | Deterministic replay view, summary substitution, folds, window cut, and history reconstruction. |
| `packages/core/src/agents/turn-mapping.ts` | Durable/replayed assistant tool-call and tool-result projection, including names-only tool-call input. |
| `packages/core/src/agents/tool-set-assembly.ts` | Tool group merge order and duplicate-key rejection. |
| `packages/core/src/extensions/extension-registry.ts` | Confirmed Run UUID leak into stable instructions; immutable registry and sealed call binding. |
| `packages/core/src/extensions/extension-run-context.ts` | Per-Run Host/MCP/Skill capture and composition into tools/instructions. |
| `packages/core/src/extensions/extension-sources.ts` | Skill/MCP/Host generation capture and stale-generation closures. |
| `packages/core/src/harness/run-snapshot-capture.ts` | Durable redacted snapshot plus exact process-local execution context. |
| `packages/core/src/hosts/host-context.ts` | Model-visible Host metadata, including order-sensitive arrays and `lastSeenAt`. |
| `packages/core/src/mcp/mcp-turn-tools.ts` | Per-Run generation leases, late-bound Run/Attempt effects, Governance, and Approval bindings. |
| `packages/core/src/config/provider-factory.ts` | Boot-stable OpenAI-compatible model/provider construction and usage option. |
| `packages/core/src/agents/run-observability-telemetry.ts` | Run/Attempt telemetry that records no prompt/tool payload and does not rewrite the provider request. |
| `references/deepseek-harness-master/packages/core/agent-loop/src/agent.ts` | DSH request-header freezing, log-derived history reconstruction, per-step append behavior. |
| `references/deepseek-harness-master/packages/core/agent-loop/tests/request-reconstruction.spec.ts` | Deterministic append-extension and explained-rewrite contracts. |
| `references/deepseek-harness-master/packages/core/agent-loop/tests/request-cache.e2e.ts` | Real DeepSeek cache E2E and per-request usage assertions. |
| `references/deepseek-harness-master/packages/core/agent-loop/tests/tool-order.spec.ts` | Canonical tool ordering independent of registration order. |
| `references/deepseek-harness-master/packages/llm/llm/src/call-config.ts` | Frozen provider/model/reasoning/sampling configuration. |
| `references/deepseek-harness-master/packages/llm/llm-deepseek/src/serialize.ts` | DeepSeek wire ordering for system, messages, tools, images, and config. |
| `references/deepseek-harness-master/packages/llm/llm-deepseek/src/translate.ts` | Cache usage normalization. |
| `packages/core/node_modules/ai/dist/index.js` | Installed AI SDK 7.0.17 request/tool/step serialization. |
| `packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js` | Installed OpenAI-compatible 3.0.5 wire JSON and cache-usage normalization. |

### Exact TakiAgent request assembly order

The initial model request for one attempt is assembled in this order:

1. `store.history(characterId)` derives the replay view before the clock read (`packages/core/src/agents/chat-agent.ts:220-227`).
2. One `Date.now()` value is captured for both the day line and turn tail (`packages/core/src/agents/chat-agent.ts:224-227`).
3. `composeInstructions()` constructs the single system string in this exact section order (`packages/core/src/agents/chat-agent.ts:455-469`):
   - selected base/canonical memory procedure prompt;
   - local day/date line;
   - assembled Memory/Character context;
   - Skill list plus avatar vocabulary;
   - captured Run instructions: Host context, then extension context.
4. Text or vision model is selected. The observability wrapper receives `runId`/`attemptId`, but middleware only hashes/records the already-assembled request and does not mutate it (`packages/core/src/agents/chat-agent.ts:228-235`; `packages/core/src/agents/model-effect-middleware.ts:70-85`; `packages/core/src/agents/run-observability-telemetry.ts:34-49`).
5. Tools are assembled in group order (`packages/core/src/agents/chat-agent.ts:296-312`):
   - Run-captured memory tools, otherwise current memory tools;
   - stable Core tools;
   - per-character avatar tools;
   - Core Governance wrappers;
   - interactive compatibility Skill/capability tools, otherwise static extras;
   - Run-captured direct MCP tools plus `extension_discover`, `extension_describe`, `extension_call`.
6. `ToolLoopAgent` receives model, instructions, tools, telemetry, stop conditions, approval callback, and step callback. TakiAgent supplies no temperature/top-p/seed/provider-options/prepare-step/tool-order override (`packages/core/src/agents/chat-agent.ts:231-245`).
7. `buildOutgoing()` replaces only the last current user row in the in-flight copy (`packages/core/src/agents/chat-agent.ts:386-405`):
   - optional one-shot costume notice;
   - current message/control input;
   - `<turn-context>` containing minute-granular local time then volatile perception;
   - image `FilePart`s after the text part, only for the current image Turn.
8. `agent.stream({ messages: outgoing, abortSignal })` starts the SDK loop (`packages/core/src/agents/chat-agent.ts:254-260`).
9. AI SDK v7 standardizes instructions/messages once, then each tool continuation reuses the same instructions/tools/call settings and appends accumulated assistant/tool response messages (`packages/core/node_modules/ai/dist/index.js:8994-9032,9206-9257,9269-9327`). TakiAgent has no `prepareStep`, so there is no per-step config mutation.
10. Completed SDK response messages are persisted. The next Turn re-derives a windowed replay projection rather than retaining the previous request object (`packages/core/src/agents/chat-agent.ts:262-293,435-446`; `packages/core/src/agents/conversation-store.ts:98-125`).

The OpenAI-compatible adapter then emits a fixed top-level body: model/config, converted messages, tools, and tool choice; JSON serialization preserves array and object insertion order (`packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js:490-607,693-703`). The system message is first and message order is preserved (`packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js:126-152`).

### Component classification

| Component | Classification | Evidence and cache effect |
| --- | --- | --- |
| Provider base URL, provider name, model id | Stable until restart/config change | Constructed at boot (`packages/core/src/config/provider-factory.ts:20-38`); route/model change intentionally selects another cache domain. |
| Sampling/call settings | Stable/default-omitted | TakiAgent passes none; AI SDK freezes the prepared defaults for each call. Generated SDK `callId` is telemetry-only and absent from the wire body. |
| Base/canonical memory procedure prompt | Stable until memory authority activation/restart | Selected through a stable function (`packages/core/src/main.ts:335-345`). |
| Day/date | Stable for one local calendar day | Explicit day-stable renderer (`packages/core/src/time/time-context.ts:31-42`). Day rollover is intentional semantic invalidation. |
| Canonical Local memory assembly | Stable until persona/block/pinned memory changes | Ignores `currentMessage`; SQL has explicit ordering (`packages/core/src/memory/canonical-local-runtime.ts:31-53`). This is the observed environment. |
| Legacy memory assembly | Volatile before history, partly semantic | Calls `Date.now()`, renders relative ages, and may select an intention from current message (`packages/core/src/memory/assembler.ts:55-75,108-133`). Not the measured canonical baseline, but it can churn a prefix without a durable memory write when an age label crosses a boundary. |
| Skill list | Stable until catalog generation/content changes | Durable repo is ordered by skill name and catalog Map preserves it (`packages/core/src/skills/skill-package-repo.ts:49-63`; `packages/core/src/skills/skill-catalog-manager.ts:60-71,108-115`). |
| Avatar vocabulary | Stable until reported costume/vocabulary changes | Render preserves reported array order (`packages/core/src/avatar/avatar-vocabulary.ts:70-79`). A costume notice is intentionally volatile at the outgoing tail, not before replay history. |
| Host context | Stable for one captured Host catalog generation, but contains dynamic metadata and source-order risk | Includes `lastSeenAt`, generations, and unsorted source arrays (`packages/core/src/hosts/host-context.ts:31-53,56-85`). A real catalog generation change is semantic; `lastSeenAt` itself is not routing authority and is a latent avoidable timestamp. |
| Extension context Run UUID | **Incorrectly volatile before history** | `Run ${snapshot.runId}` changes every Run (`packages/core/src/extensions/extension-registry.ts:251-258`). Confirmed primary defect. |
| Extension entry count/rules | Stable for unchanged captured set; semantic on capability change | Count and fixed governance/routing guidance can remain model-visible. |
| Tool names/descriptions/schemas | Stable for unchanged tool definitions; ordering is insertion-sensitive | AI SDK serializes definition fields only and defaults to `Object.entries` order (`packages/core/node_modules/ai/dist/index.js:2020-2076`). |
| Fresh `execute` closures, Run/Attempt getters, leases | Internally volatile, not model-visible | Closure identity is never serialized. It remains the sealed execution authority. |
| Replayed history | Append-only until deliberate projection rewrite | Stable DB order; summary substitution, fold, token cut, and orphan-tool repair are pure and deterministic for unchanged rows/budget (`packages/core/src/agents/conversation-store.ts:135-170`). Compaction/window movement intentionally rewrites the prefix. |
| Names-only replay of tool calls | Deliberate privacy/fidelity rewrite | Raw tool input is omitted and replayed as `{}` (`packages/core/src/agents/turn-mapping.ts:38-55,88-105`). This prevents DSH-style exact full-request reconstruction, but the current turn tail already creates an earlier cross-Turn divergence. |
| Current user message | Append-only conversational suffix | Persisted plain, then rebuilt in-flight with volatile additions. |
| `<turn-context>` time/perception | Intentionally volatile at tail | Never persisted (`packages/core/src/agents/chat-agent.ts:407-416`; `packages/core/src/agents/chat-agent-tail.test.ts:48-68`). Correct placement for volatile context, but it changes the prior newest user message on replay. |
| Image bytes | Intentionally current-Turn-only suffix | Raw bytes are FileParts for that Turn; replay is text-only (`packages/core/src/agents/chat-agent.ts:419-423`; `packages/core/src/agents/turn-mapping.ts:26-35,88-90`). |
| Tool-loop continuation messages | Append-only inside one Run | AI SDK appends completed step response messages; this is the strongest strict-prefix case. |
| Run/Attempt/event/effect/call ids and timestamps in observability | Internal only | Telemetry explicitly retains no prompts/tool payloads (`packages/core/src/agents/run-observability-telemetry.ts:1-5`) and does not add IDs to provider content. |

### Precise reusable-prefix boundary with `<turn-context>`

Let `H` be replay history before the current user message, `U1` the first Turn's plain user text, and `T1` its volatile tail.

```text
Run 1 initial request:  System + Tools + H + User(U1 + T1)
Run 1 tool step 2:      System + Tools + H + User(U1 + T1) + Assistant(tool call) + Tool(result)
Run 2 initial request:  System + Tools + H + User(U1) + Assistant/Tool/Assistant from Run 1 + User(U2 + T2)
```

Within Run 1, step 2 strictly append-extends step 1. Across Run 1 -> Run 2, the byte/token prefix is reusable through `U1` only. At the next token, Run 1 has the separator plus `<turn-context>`, while Run 2 closes/re-encodes the user message and proceeds to the prior assistant response. If a costume notice was present, divergence starts at that notice, still after `H`.

Therefore the correct deterministic contract is:

- system/config/tools are byte/value-identical when semantic state is unchanged;
- history before the previous newest user message is identical;
- the prior newest user text is identical as a token prefix, but its prior non-persisted tail is intentionally absent;
- do **not** assert that the entire earlier request message array is a strict prefix of the next conversational request.

This contract still permits material cache reuse of a 68.5k-token long history. It simply does not cache the previous Turn's tail or generated response as part of the common prefix.

### Ranked causes

1. **Confirmed P0: Run UUID in system instructions.** It changes on every conversational Run before history and exactly explains a fixed early cache breakpoint (`extension-registry.ts:251-258`). Confidence: very high.
2. **Contract-critical, intentional: non-persisted `<turn-context>` rewrites the previous newest user message.** It limits the next Turn's reusable prefix to the plain prior user text. It does not explain the current 6,912-token breakpoint because it occurs after the long replay prefix once the UUID is removed. Confidence: high.
3. **Latent P1: provider-facing tool order follows object insertion order.** Current group construction is normally repeatable, but equivalent tool sets assembled from different Host/MCP publication orders can serialize differently. DSH explicitly prevents this class. Confidence: high from installed SDK source; no evidence it caused the measured baseline.
4. **Latent P1: model-visible Host arrays and `lastSeenAt`.** Host catalog Map order and nested catalog order are preserved; `lastSeenAt` is rendered before history. Adjacent Runs over the same unchanged live catalog normally remain stable, and a republish also changes authoritative generations, so this is not the fixed per-Run breakpoint. Confidence: high.
5. **Legacy-only P2: relative-age and current-message intention assembly.** It can change system text without canonical memory mutation. Canonical Local, which was active in the measured environment, does not use this path. Confidence: high.
6. **Expected semantic invalidators:** provider/model/config change, day rollover, persona/memory/Skill/avatar change, Host/MCP/Skill generation replacement, compaction, replay-window movement, current image set/budget, or upstream cache eviction. These should not be hidden to inflate a percentage.

No other per-Run `runId`, `attemptId`, event id, effect id, call id, generation id, or timestamp was found in the model-visible prefix ahead of history. IDs remain in closures/events/telemetry; generation values in Host context are semantic authority facts, not fresh execution ids.

### Authority preservation after removing the UUID from `<extension-context>`

Removing the model-visible UUID does not weaken authority:

- `ExtensionRunSnapshot` still contains `runId`, Host generations, descriptors, collisions, and budget and is frozen (`packages/core/src/extensions/extension-registry.ts:108-128,261-272`).
- Registry `discover` and `describe` still return the snapshot's Run id; `call` resolves only the captured `extensionId` in the private `byId` Map (`packages/core/src/extensions/extension-registry.ts:60-105`). These outputs occur after the current user/history prefix as tool results, so their Run id is append-only rather than a fresh prefix breaker.
- `extension_call` remains a thin closure over that exact registry; unknown ids fail and found ids preserve owner identity (`packages/core/src/extensions/extension-tools.ts:14-31`).
- Skill calls capture catalog generation/content revision; MCP calls capture generation leases; Host capability calls capture Host/catalog generations and target Host (`packages/core/src/extensions/extension-sources.ts:28-75,78-118,121-160`).
- MCP Governance/Approval uses late-bound getters for current internal `runId`, `attemptId`, effects, and tool observer, while the leased generation never redirects (`packages/core/src/mcp/mcp-turn-tools.ts:25-47,50-64,67-119`).
- Run admission returns the exact process-local tools/memory tools/instructions while persisting only reduced, redaction-safe authority references (`packages/core/src/harness/run-snapshot-capture.ts:34-77`; `packages/core/src/harness/run-snapshot-capture.test.ts:12-49`).
- The governing specification explicitly defines the Run snapshot and captured binding, not prompt prose, as authority (`.trellis/spec/backend/extension-discovery.md:30-48,94-106`).

The phrase "this immutable Run snapshot" can remain in the stable instructions. It describes lifetime semantics without exposing the identifier.

### DeepSeek Harness comparison

Checked-in DSH is `0.1.1-rc.2` (`references/deepseek-harness-master/package.json:2-4`; `packages/llm/llm-deepseek/package.json:2-4`). TakiAgent should copy these structural ideas:

1. **Separate stable header from replayed messages.** DSH treats provider/model/reasoning/sampling/system/tools as a canonical request header and logs a new header only when it changes (`references/deepseek-harness-master/packages/core/agent-loop/src/agent.ts:423-513`; `packages/core/session/src/request-header.ts:21-53`).
2. **Freeze the actual dispatch request.** DSH deep-freezes config/header/messages and checks reconstruction from the durable log (`packages/llm/llm/src/call-config.ts:61-116`; `packages/core/agent-loop/src/invariant.ts:19-53`). TakiAgent need not copy the event architecture to add a deterministic request-shape seam, but should test the same invariants at its assembly boundary.
3. **Canonicalize tool order independently of registration order.** DSH uses locale-independent code-unit ordering or an explicit order plus lexicographic rest (`packages/core/system-prompt/src/index.ts:139-182,491-530`; `packages/core/agent-loop/tests/tool-order.spec.ts:67-94`).
4. **Explain rewrites rather than pretending they are append-only.** DSH's compaction test expects a history replacement and a stable header, with the log explaining the rewrite (`packages/core/agent-loop/tests/request-reconstruction.spec.ts:406-455`). TakiAgent should do the same for compaction/window cuts and its intentional turn-tail rewrite.
5. **Measure every real provider request.** DSH's key-gated cache E2E forces a multi-step tool Turn, sends a follow-up Turn, asserts at least three usage samples, and requires cache reads after the first (`packages/core/agent-loop/tests/request-cache.e2e.ts:71-103`).
6. **Keep DeepSeek serialization deterministic.** DSH emits system first, preserves message/tool array order, always requests usage, and maps provider cache fields (`packages/llm/llm-deepseek/src/serialize.ts:338-387`; `packages/llm/llm-deepseek/src/translate.ts:45-61`).

Project-specific differences that TakiAgent should **not** copy blindly:

- DSH can assert strict cross-Turn message-array append-extension (`request-reconstruction.spec.ts:54-60,73-112`). TakiAgent intentionally rewrites the prior newest user tail, drops image bytes from replay, and stores tool-call arguments names-only. Its regression must express the narrower token-prefix boundary.
- DSH's normalized `inputTokens` excludes cache reads (`llm-deepseek/src/translate.ts:45-61`). AI SDK/OpenAI-compatible reports inclusive prompt total plus `noCache` and `cacheRead` details (`packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js:63-98`). TakiAgent's ratio denominator is `cache_read_tokens / input_tokens`, not DSH's disjoint `inputTokens` field.
- DSH owns a direct DeepSeek adapter. TakiAgent production must remain provider-neutral; only the key-gated acceptance threshold may be DeepSeek-specific.
- DSH persists exact model message content for reconstruction. TakiAgent's names-only tool-call input and in-flight-only images are privacy/product contracts and are outside this cache task.

### Installed AI SDK v7 serialization conclusions

Verified installed versions:

- `ai` 7.0.17 (`packages/core/node_modules/ai/package.json`)
- `@ai-sdk/openai-compatible` 3.0.5 (`packages/core/node_modules/@ai-sdk/openai-compatible/package.json`)
- `@ai-sdk/provider-utils` 5.0.5 (pnpm lock/install path)
- `zod` 4.4.3 (`packages/core/node_modules/zod/package.json`)

The SDK prepares each tool from the ToolSet entry's name, description, JSON schema, examples, provider options, and strict flag; the `execute` function/closure is absent (`packages/core/node_modules/ai/dist/index.js:2020-2044`). Consequently:

- constructing a new governed/MCP/avatar closure per Run does not by itself alter provider-visible schema;
- captured Run/Attempt ids inside closures do not reach the model;
- Zod schema conversion is re-run, but for the same schema definition it produces the same property order;
- upstream MCP JSON schema key order remains whatever the active captured tool published. The same active generation reuses the same tool/schema object, so adjacent unchanged Runs are stable; a replacement generation is an expected semantic boundary.

Without `toolOrder`, the SDK uses `Object.entries(tools)` insertion order. Supplying a sorted `toolOrder` changes only serialization order, not the ToolSet lookup or execution closure. AI SDK reuses that order for each continuation step (`packages/core/node_modules/ai/dist/index.js:2064-2076,9240-9247`).

### Recommended minimal fix and ownership

#### Required production change

`packages/core/src/extensions/extension-registry.ts`

- Change the UUID-bearing sentence to stable wording, for example: `This Run captured N eligible host-qualified extensions.`
- Keep the count and all routing/governance rules.
- Do not alter snapshot fields, discover/describe/call result schemas, closures, or generation checks.

#### Required deterministic tests

`packages/core/src/extensions/extension-registry.test.ts`

- Build two registries with identical candidates/hosts but different Run UUIDs.
- Assert `renderContext()` is byte-identical and contains neither UUID.
- Assert snapshots and discover/describe outputs still retain their own Run id.
- Call each registry through its own distinct spy and prove no cross-Run closure redirection.

New focused file: `packages/core/src/agents/chat-agent-prefix-cache.test.ts`

- Freeze the clock to one day/minute.
- Seed identical long replay history.
- Run two otherwise identical captures with different Run/Attempt ids and separately captured extension registries.
- Compare the MockLanguageModelV4 `doStreamCalls` model-facing `prompt` system message and `tools` array; require identical values/order.
- Assert an internal `runId`/`attemptId` remains observable only through the correct tool execution spy/effect binding.
- Add one scripted tool continuation and assert within-Run strict append-extension.
- Add two conversational Turns and assert the documented partial-prefix boundary: stable system/tools/older history, plain prior user text, intentionally missing prior `<turn-context>` suffix.

#### Recommended low-risk hardening if the new order test exposes drift

`packages/core/src/agents/chat-agent.ts`

- Assemble the ToolSet once before `new ToolLoopAgent`.
- Pass `toolOrder: Object.keys(tools).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)`.
- This copies DSH's locale-independent canonical order without changing execution authority.

Do not expand the first patch to global request canonicalization. If reversed Host-catalog construction produces a failing same-semantic-input instruction test, a separate narrow `host-context.ts` canonical-order change is justified. `lastSeenAt` may be removed from the model projection later because generations/readiness carry the authority, but it is not required to correct the reproduced per-Run UUID defect.

### Real DeepSeek before/after verification protocol

Use a new key-gated E2E file under `e2e/src/`, following `.trellis/spec/backend/e2e-harness.md:1-20` and the existing `realProviderEnv()`/`withStack()` seams (`e2e/src/fixture/paths.ts:25-42`; `e2e/src/fixture/with-stack.ts:32-63,74-118`). The E2E may read the temporary `stack.coreDataDir/taki.db` read-only, as existing E2Es already do.

Protocol:

1. Start a fresh temporary stack with the configured real provider, canonical Local memory, stable Host/catalog state, `TAKI_PROVIDER_INCLUDE_USAGE=true`, and a deterministic long seeded timeline sized to produce a comparable 55k-80k prompt without crossing the replay/compaction wall.
2. Record preconditions only as counts: timeline row count, estimated/actual input band, no `conversation_summary` row or unchanged `through_seq`, provider, model, and fixed capability count. Never record prompt text, tool arguments/results, raw provider bodies, headers, or credentials.
3. Turn A explicitly requests one existing harmless/tool path. Prefer an already audited real path with names-only evidence (for example the established screenshot L2 with `autoApprove`, or `get_current_time` if its tool invocation is asserted from structured timeline data). Require at least one persisted tool row / names-only invocation.
4. Turn A should produce at least two model requests: tool request plus continuation. Turn B is an immediate ordinary follow-up over the same conversation and should produce at least one new Run/model request.
5. Read `run_usage` rows ordered by `recorded_at`, grouped by `run_id`, selecting only: request ordinal/type, provider, model_id, quality, input_tokens, input_no_cache_tokens, cache_read_tokens, cache_write_tokens, output_tokens, and total_tokens (`packages/core/src/db/migrations/026-run-effects.ts:42-56`; `packages/core/src/db/migrations/031-run-usage-details.ts:8-16`; `packages/core/src/db/effect-repo.ts:175-200`). Redact/omit raw Run/Attempt/effect ids in the persisted evidence.
6. Validate arithmetic when reported: `input_no_cache_tokens + cache_read_tokens == input_tokens` (allow provider omission, not fabricated zero). The installed adapter maps DeepSeek/OpenAI-compatible `prompt_tokens_details.cached_tokens` into these fields (`packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js:81-98`).
7. Classify each row as `tool continuation` or `new conversational Turn` by Run grouping and request ordinal. Do not aggregate multiple requests before computing ratios.
8. Acceptance thresholds:
   - provider/model match the reproduced baseline;
   - the focused new-Turn follow-up has comparable `input_tokens` (recommended 55k-80k, or within 20% of the chosen baseline fixture);
   - `cache_read_tokens / input_tokens >= 0.50` on the comparable first request of Turn B;
   - improvement is at least +30 percentage points over the 10.1% reproduced baseline (the 50% gate already yields +39.9 points);
   - every request after the cold first request reports `cache_read_tokens > 0`, unless the report explicitly identifies an expected semantic boundary;
   - normal reply completes and at least one tool path is proven by structured/names-only evidence.
9. Run the probe at least twice with fresh temporary data dirs. The first run proves the post-fix threshold; the second checks it is not a one-off upstream cache artifact. Send adjacent requests promptly to reduce eviction noise.

The live report should contain a compact table only:

```text
request_kind | provider | model | input | no_cache | cache_read | ratio | output | quality
```

No prompt, secret, raw payload, raw error body, or tool content should be captured.

### Rejected alternatives

- **Move Run UUID to `<turn-context>`.** Rejected: the model has no semantic need for it; it still leaks internal execution metadata and wastes tokens.
- **Replace Run UUID with conversation/session id.** Rejected: unnecessary model-visible identity and possible authority confusion.
- **Delete the whole extension context.** Rejected: the fixed progressive-discovery, Host-selection, and permission guidance remains useful and safety-relevant.
- **Persist `<turn-context>` to obtain strict append-extension.** Rejected: it would make stale time/perception durable, pollute Replay View, and violate the in-flight privacy contract.
- **Remove `<turn-context>` solely for cache ratio.** Rejected: it is intentionally placed at the tail and does not explain the early 6,912-token breakpoint.
- **Cache/reuse Tool closure objects.** Rejected: closure identity is not serialized; Run-specific closures are required for sealed authority.
- **Provider-specific DeepSeek production branch or local KV cache.** Rejected: out of scope and unnecessary once the prefix is stable.
- **Canonicalize arbitrary JSON recursively in the production request.** Rejected for the first patch: broad semantic/compatibility risk. Canonicalize known order-bearing surfaces (tool order, Host arrays) only when a deterministic test demonstrates need.
- **Copy DSH's strict log-derived request architecture wholesale.** Rejected: valuable as a test model, but incompatible with TakiAgent's deliberate names-only tool-call replay, in-flight-only images, and volatile tail without a larger product/privacy redesign.

### Related specs

- `.trellis/spec/backend/agent-runtime.md` — faithful replay, image bytes in-flight only, stable-early/volatile-late prompt contract.
- `.trellis/spec/backend/extension-discovery.md` — immutable Run snapshot, sealed extension id routing, Host/generation provenance.
- `.trellis/spec/backend/mcp-lifecycle.md` — captured generation leases and no redirect to replacements.
- `.trellis/spec/backend/permission-authorization.md` — Core Governance, Approval, and Host final enforcement are authority; metadata/prompt text is not.
- `.trellis/spec/backend/e2e-harness.md` — key-gated real-agent track and no-content logging.
- `.trellis/spec/backend/mcp-tool-schema-compatibility.md` — definition-stage schema normalization boundary.
- `.trellis/spec/backend/quality-guidelines.md` — focused colocated tests and no secret logging.

### External references and versions

- DeepSeek Harness checked-in developer preview `0.1.1-rc.2`.
- DSH DeepSeek adapter identifies the official API docs (`guides/thinking_mode`, `guides/tool_calls`, `api/create-chat-completion`) as its wire-format source of truth (`references/deepseek-harness-master/packages/llm/llm-deepseek/README.md:5`).
- DSH documents that an unchanged assembled prefix is cache-eligible and any prompt/schema/history/image-budget change can stop reuse from the first changed token (`README.md:116-120,130-134`).
- Installed TakiAgent dependency source was used instead of memory: AI SDK 7.0.17, OpenAI-compatible 3.0.5, provider-utils 5.0.5, Zod 4.4.3.

## Caveats / Not Found

- The worktree is dirty with substantial user changes, including the current observability rewrite in `chat-agent.ts`. This audit read the live worktree. The observability changes wrap and measure the request but do not add Run/Attempt ids to model content.
- No raw provider request from the reproduced baseline was captured or inspected; conclusions use the authoritative numeric baseline plus current assembly source. This avoids prompt/secret exposure.
- No existing TakiAgent cache-specific deterministic regression or real DeepSeek cache E2E was found.
- No evidence was found that fresh closure identity changes tool schema. The installed SDK source shows the opposite.
- Host-context `lastSeenAt` and source ordering are latent prefix-stability concerns, but no evidence ties them to the exact 6,912-token repeated breakpoint. Catalog generation changes are also legitimate semantic authority changes.
- Upstream DeepSeek cache eviction, account/gateway behavior, tokenizer granularity, and model-route cache domains remain external variables. That is why the acceptance gate requires comparable long input, per-request classification, repeated runs, and material improvement rather than merely non-zero hits.
- Confidence: **very high** that removing the model-visible Run UUID fixes the reproduced dominant breakpoint; **high** that authority is preserved; **high** on the `<turn-context>` boundary; **medium-high** that a >=50% real follow-up ratio will be achieved because upstream eviction and gateway-specific behavior cannot be proved from static source.
