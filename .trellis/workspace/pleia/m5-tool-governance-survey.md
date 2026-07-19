# M5 Research Bank — Tool Governance, Structured Outputs, Agent-Loop Reliability

- **Query**: Can provider-side structured outputs give zero wrong-enum tool calls on our stack? + industry tool-design standards survey + loop-reliability-at-scale patterns (T2 seed).
- **Scope**: mixed — installed-dist verification (`ai@7.0.17`, `@ai-sdk/openai-compatible@3.0.5`, `@ai-sdk/provider@4.0.3`, `@ai-sdk/provider-utils@5.0.7`) + repo conventions + exa web survey.
- **Date**: 2026-07-19
- **Verification discipline**: every SDK claim below was read from the installed dist (file:line cited); every provider claim cites a URL, with official-docs vs community-testing confidence marked. The zod→JSON Schema wire shapes were rendered by executing the installed `asSchema` against our exact tool schemas (output inlined in A3).

---

## A. Provider-side structured outputs (the zero-failure question)

### A-VERDICT (read this first)

**Token-level first-try enforcement is REACHABLE with our exact stack today, but only as a Beta bet with real hazards — recommended posture: do NOT flip it on now; ship the deterministic `experimental_repairToolCall` auto-repair instead (zero user-visible wrong-enum, no provider dependency), and keep provider strict mode as a revisit trigger once DeepSeek graduates it from Beta.**

Decomposed:

1. **Client plumbing: COMPLETE, verified.** `tool({ strict: true })` is a public field (`provider-utils` dist `index.d.ts:1759`), `ai` core forwards it (`ai` dist `index.js:2035-2043` in `prepareTools`), the provider type carries it (`@ai-sdk/provider@4.0.3` dist `index.d.ts:1701`), and `@ai-sdk/openai-compatible` emits it on the wire as `tools[].function.strict` (`openai-compatible` dist `index.js:409-414`). No SDK gap.
2. **DeepSeek server side: EXISTS, Beta.** Official docs: strict mode validates the schema server-side and makes tool-call output "strictly adhere" to it; `enum` is in the supported type subset. Requires `base_url="https://api.deepseek.com/beta"` and `strict: true` on every function ([Tool Calls guide](https://api-docs.deepseek.com/guides/tool_calls/); [Create Chat Completion reference](https://api-docs.deepseek.com/api/create-chat-completion): "If set to true, the API will use strict-mode ... to ensure the output always complies with the function's JSON schema. This is a Beta feature", default `false`).
3. **Why not now — the hazards (each cited in A2):** (a) a V3-era strict-mode bug emitted *corrupted* JSON arguments (the opposite of the guarantee); community testing says fixed in V4 but there was never an official fix announcement; (b) the `/beta` endpoint has been observed silently remapping model IDs to legacy aliases with reduced feature support; (c) strict requires ALL object properties `required` + `additionalProperties:false` — our `avatar_play_motion` schema has two optional params and would be **rejected at request time** (verified wire shape in A3); no `null` type is documented, so OpenAI's required-but-nullable idiom for optionals is not confirmed available; (d) our `TAKI_PROVIDER_BASE_URL` is one env slot for ALL turns — pointing production at a beta surface to harden two avatar tools is a bad trade while (a)+(b) stand.
4. **What we CAN get today, deterministically:** `experimental_repairToolCall` (public on `generateText`, `streamText`, and `ToolLoopAgentSettings` — our exact construction point, `chat-agent.ts:91`) intercepts the invalid call BEFORE it becomes a step/tool-error, and our failure mode (stale enum member) is repairable **without any extra LLM call**: nearest-match the bad `name` against the live vocabulary and return the fixed call. First-try wrong-enum becomes invisible — no wasted round-trip, no provider dependency, works on any model. This is the ranked-first alternative (wiring sketch in A4).

**Residual risk, honestly:** neither constrained decoding nor auto-repair fixes *semantic* choice. Token-level enforcement forces *a* valid name, not the *right* one — a model that wanted `smile_old` may be forced onto an arbitrary valid member (community reports also note constrained decoding can *increase* hallucination pressure on small models: [OpenAI community deep-dive](https://community.openai.com/t/structured-outputs-deep-dive/930169)). Our repair has the same property (nearest-match may land elsewhere than the model "meant"). The current 1e feedback loop (invalid → readable tool-error → model re-picks) is the only variant where the MODEL re-decides; it costs one round-trip. Pick per failure-cost: for avatar presentation (cosmetic, fire-and-forget) auto-repair's forced pick is acceptable; for future high-stakes tools, prefer the feedback loop.

### A1. Constrained decoding / strict tool schemas — the landscape

- **OpenAI `strict: true` function calling** is the reference implementation: schema compiled to a context-free grammar, token sampling masked so out-of-schema tokens get probability 0 — "100% reliability" on schema conformance in their benchmark, versus 93% best-effort prompting ([announcement](https://openai.com/index/introducing-structured-outputs-in-the-api/); [structured outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs); [function calling guide](https://developers.openai.com/api/docs/guides/function-calling): "We recommend always enabling strict mode").
- **What strict actually guarantees / costs (OpenAI's own list):** requirements — `additionalProperties: false` on every object, all properties in `required` (optionals emulated as required-but-nullable unions); costs — first-request-per-new-schema preprocessing latency (grammar compile, cached after), a JSON Schema subset, incompatible with parallel function calls (set `parallel_tool_calls: false`), and refusals ride a separate `refusal` field outside the schema. **Enum members are enforced at the token level** — an out-of-enum value is unsamplable ([guide](https://developers.openai.com/api/docs/guides/structured-outputs); mechanics: [zeroentropy constrained-decoding explainer](https://zeroentropy.dev/concepts/constrained-decoding/)).
- **Per-turn dynamic schemas (our 1e pattern) interact with grammar caching:** a changed enum = a new schema = a fresh grammar compile on providers that cache per-schema. Cost is provider-specific and undocumented for DeepSeek — a latency probe belongs in any adoption spike.
- **Anthropic** now has the same lever (`strict: true` tool definitions, "Guaranteed tool calls with strict tools" — [tool-use overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)) — strict tool schemas are now cross-provider table stakes, which strengthens the case for keeping our tool schemas strict-*compatible* (A4 recommendation 3) even while not enabling provider strict.

### A2. DeepSeek specifically (provider = DeepSeek, model = `deepseek-v4-flash`)

Official ([Tool Calls guide](https://api-docs.deepseek.com/guides/tool_calls/), [API reference](https://api-docs.deepseek.com/api/create-chat-completion)):

- strict mode (Beta): `base_url="https://api.deepseek.com/beta"` + `strict: true` on **all** functions; server validates the schema up front (unsupported schema → request error, surfaced pre-generation); "the model strictly adheres to the format requirements of the Function's JSON schema"; supported in both thinking and non-thinking mode.
- Supported JSON Schema subset: `object`, `string`, `number`, `integer`, `boolean`, `array`, `enum`, `anyOf`, `$ref`/`$def`. Objects: every property must be in `required`, `additionalProperties: false` mandatory. Strings: `minLength`/`maxLength` NOT supported (pattern/format/const are). Arrays: `minItems`/`maxItems` NOT supported. **`null` is not in the documented type list** → the OpenAI "optional = required + nullable" idiom is unconfirmed; treat optionals as unsupported until probed.
- `response_format` supports only `text` | `json_object` — **no `json_schema` response format** ([API reference](https://api-docs.deepseek.com/api/create-chat-completion); corroborated [analysis](https://deepseek-usa.ai/docs/deepseek-json-output/)). So `supportsStructuredOutputs: true` on our provider factory would be wrong; irrelevant for tools anyway (see A3).
- Non-strict function calling ships with the explicit warning: "the model does not always generate valid JSON, and may hallucinate parameters ... Validate the arguments in your code" — i.e., our current client-side zod validation is exactly what the vendor prescribes for the non-strict path.

Community evidence (lower confidence, dated, but load-bearing for the verdict):

- **Corruption bug (V3 era)**: `strict: true` + `additionalProperties: false` on `/beta` returned arguments JSON with the first property key's closing quote missing → unparseable — the guarantee inverted ([deepseek-ai/DeepSeek-V3#1069](https://github.com/deepseek-ai/DeepSeek-V3/issues/1069), 2025-12; closed not-planned).
- **V4 retest**: 0% corruption across 32 trials on `deepseek-v4-pro`/`-flash`, standard AND beta endpoints (2026-05-09) — "silently fixed", never announced; same source documents that **`/beta` silently remapped `deepseek-v4-pro` → legacy `deepseek-reasoner`** (reduced feature support), and recommends: enable `function.strict` against the STANDARD endpoint if at all, avoid `/beta` when tools are passed, and keep client-side validation regardless ([deepseek-harness spec/03_strict_mode.md](https://github.com/HenryZ838978/deepseek-harness/blob/main/spec/03_strict_mode.md)). Note the tension: official docs say strict requires `/beta`; this suggests V4 standard endpoint accepts it. Only a probe settles it.
- **tool_choice restrictions on V4**: `tool_choice="required"`/specific-function 400s on `/v1` in thinking mode ("Thinking mode does not support this tool_choice") — [deepseek-ai/DeepSeek-V3#1376](https://github.com/deepseek-ai/DeepSeek-V3/issues/1376). We use the SDK default (`auto`), so not directly hit — but it shows the V4 tool surface still has sharp edges; any strict adoption spike must retest tool_choice interplay.
- Ecosystem confirms the beta-URL + strict pattern as the integration recipe: [langchain PR #32727](https://github.com/langchain-ai/langchain/pull/32727) (auto-routes to `/beta` when `strict=True`), [langchain_deepseek reference](https://reference.langchain.com/python/langchain-deepseek/chat_models/ChatDeepSeek/with_structured_output) ("strict mode requires all object properties to be marked as required"), [deepseek-go strict example](https://github.com/cohesion-org/deepseek-go/blob/v1.4.0/examples/16_strict_tools/strict_tools.go).

### A3. AI SDK 7 wiring — verified in the installed dist

The `strict` chain (all four links verified):

| Link | Evidence |
| --- | --- |
| Public tool field: `strict?: boolean` — "Providers that support strict mode will use this setting ... Strict mode will always produce valid inputs, but it might limit what input schemas are supported" | `@ai-sdk/provider-utils@5.0.7` dist `index.d.ts:1752-1759` (on `BaseFunctionTool`, so both static and dynamic tools; `strict?: never` for provider-defined tools, `:1801`) |
| Core forwards it into the LanguageModel tool | `ai@7.0.17` dist `index.js:2035` (`const strict = tool2.strict`) + `:2043` (`...strict != null ? { strict } : {}`) in `prepareTools` |
| Provider spec carries it | `@ai-sdk/provider@4.0.3` dist `index.d.ts:1693-1701` (`LanguageModelV4FunctionTool.strict`) |
| openai-compatible emits wire `function.strict` | `@ai-sdk/openai-compatible@3.0.5` dist `index.js:409-414` (`...tool.strict != null ? { strict: tool.strict } : {}`) — unconditional passthrough, NOT gated on any provider option |

Related knobs, precisely scoped:

- `supportsStructuredOutputs` (provider factory / chat config option, `openai-compatible` dist `index.d.ts:87,321`) **defaults `false`** (`index.js:457`) and ONLY gates `response_format: json_schema` for response-level structured output (`index.js:579-587`); it does not touch tools. We do not set it (`packages/core/src/main.ts:94-98`) — correct for DeepSeek, which has no json_schema response format.
- `strictJsonSchema` providerOption (default `true`, `openai-compatible` dist `index.js:377-383,543`) also feeds ONLY `response_format.json_schema.strict` (`:583`) — not tools. Do not conflate with tool strict.
- Base URL is operator env (`TAKI_PROVIDER_BASE_URL`, `packages/core/src/config/provider-config.ts:11`) — pointing at `/beta` is a config change, not code; but it retargets EVERY turn, which is why A-VERDICT rejects it while the remap hazard stands.

**Actual wire schemas of our tools** (rendered by executing installed `asSchema` on the real zod shapes, 2026-07-19):

```jsonc
// avatar_set_expression — z.object({ name: z.enum([...]) })
{ "$schema": "http://json-schema.org/draft-07/schema#", "type": "object",
  "properties": { "name": { "type": "string", "enum": ["smile","cry","angry"] } },
  "required": ["name"], "additionalProperties": false }
// => STRICT-COMPATIBLE as-is (all props required, additionalProperties:false, enum in subset).

// avatar_play_motion — name + priority?: z.enum(...).optional() + loop?: z.boolean().optional()
{ "type": "object",
  "properties": { "name": {...enum...}, "priority": {...enum...}, "loop": { "type": "boolean" } },
  "required": ["name"], "additionalProperties": false }
// => VIOLATES DeepSeek strict ("all properties must be required") — request would be REJECTED.
//    zod .optional() simply omits the key from `required`; openai-compatible passes the schema
//    verbatim (index.js:412) — NO automatic strict-mode transform exists in this provider pkg.

// screenshot — z.object({})
{ "type": "object", "properties": {}, "additionalProperties": false }
// => vacuously all-required; matches the MCP no-param recommendation too.
```

(Two open probe points if strict is ever adopted: whether DeepSeek's validator tolerates the emitted `$schema` key, and whether `required` may be absent on empty objects.)

**`experimental_repairToolCall` — exact 7.0.17 surface** (the client-side auto-repair lever):

- Name: `experimental_repairToolCall` on `generateText` (dist `index.d.ts` ~4817/4900), `streamText` (`:3503,3588`), and **`ToolLoopAgentSettings`** (`:5102`) — so it drops straight into our `new ToolLoopAgent({...})` at `packages/core/src/agents/chat-agent.ts:91`. (Current ai-sdk.dev docs show it renamed plain `repairToolCall`; 7.0.17's public option is still the `experimental_` name — the internal destructure aliases it, `:3503`.)
- Signature (`index.d.ts:3190-3203`):

```ts
type ToolCallRepairFunction<TOOLS extends ToolSet> = (options: {
  instructions: Instructions | undefined;
  system: Instructions | undefined;          // deprecated alias
  messages: ModelMessage[];
  toolCall: LanguageModelV4ToolCall;         // .input is the raw JSON STRING
  tools: TOOLS;
  inputSchema: (options: { toolName: string }) => PromiseLike<JSONSchema7>;
  error: NoSuchToolError | InvalidToolInputError;
}) => Promise<LanguageModelV4ToolCall | null>;  // null = don't repair (falls back to today's invalid→tool-error path)
```

- A throwing repair fn surfaces as `ToolCallRepairError` (`index.d.ts:6802`) — a repair must be written never-throw, same discipline as `execute`.
- Documented strategies: structured-output regen, re-ask, per-tool custom logic ([AI SDK tool-calling docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling#tool-call-repair)); known doc-example pitfall: `toolCall.input` is a string — parse before reuse ([vercel/ai#6136](https://github.com/vercel/ai/pull/6136)).

### A4. Wiring sketches + ranked alternatives

**Ranked 1 — deterministic repair (recommended now).** At `chat-agent.ts:91` add to the `ToolLoopAgent` settings:

```ts
experimental_repairToolCall: async ({ toolCall, error }) => {
  // Only repair OUR presentation tools' out-of-enum name; never guess for other tools.
  if (!(error instanceof InvalidToolInputError)) return null;
  if (!PRESENTATION_TOOL_NAMES.has(toolCall.toolName)) return null;
  const input = JSON.parse(toolCall.input);           // input is a raw JSON string
  const names = vocabFor(toolCall.toolName);           // live vocabulary, same source as 1e
  const repaired = nearestName(input.name, names);     // deterministic: exact-casefold → prefix → levenshtein; null if hopeless
  if (repaired === null) return null;                  // fall back to today's tool-error feedback
  return { ...toolCall, input: JSON.stringify({ ...input, name: repaired }) };
};
```

Properties: no extra LLM call, no provider dependency, wrong-enum first tries vanish from the transcript, `null` preserves today's verified feedback path as the backstop. Needs the current vocab in scope — the chat agent already builds `characterTools` per turn from the same vocabulary (`chat-agent.ts:94`, `main.ts:304-305`), so plumb the same `vocab` in. Test as L1: MockLanguageModel emits a stale name → assert the published avatar.command carries the repaired name and NO tool-error part entered the step. Note the repair fires during step assembly (before `execute`), so `presentationTailStop` semantics are untouched.

**Ranked 2 — DeepSeek strict (revisit trigger, not now).** If/when: (a) strict leaves Beta or the corruption fix is announced, and (b) the /beta remap hazard is resolved or strict is confirmed on the standard endpoint. Then: `strict: true` on both avatar tools (`tool({ strict: true, ... })` — zero further plumbing, verified chain above), reshape `avatar_play_motion` to all-required (make `priority` required with existing `"normal"` member as the documented default choice, `loop` required boolean) or split the engine-knob params off, and run a probe matrix first: standard-vs-beta endpoint × strict acceptance × tool_choice × per-turn-changing-enum latency. Keep client zod validation ON regardless (vendor's own advice + the corruption history).

**Ranked 3 — provider switch note.** OpenAI (and now Anthropic) offer non-Beta token-level strict tools. Our provider is env-swappable by design (one slot, `provider-config.ts`), so an operator ALREADY can point at OpenAI and get real constrained decoding by us merely setting `strict: true` on the tools (harmless elsewhere: openai-compatible omits the key when unset, DeepSeek non-beta ignores unknown fields — probe before assuming). Not a project decision to make here; recorded as capability.

**Ranked 4 — accept current.** The 1e enum + invalid→tool-error self-correction is already a working double net (verified; `agent-runtime.md` "runtime enum" section). Cost: one wasted round-trip on the stale-tag turn, occasional visible hesitation. Acceptable if T2 prioritizes elsewhere.

---

## B. LLM tool design standards vs our conventions

### B1. What the authorities say (surveyed)

**Descriptions** — the #1 performance factor (Anthropic): "extremely detailed descriptions ... 3-4+ sentences" covering what it does, when to use it AND when not, what each param means, caveats/limitations ([define-tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)); descriptions are prompts — include negative cases and name sibling tools ([Archestra naming guide](https://archestra.ai/blog/mcp-tool-naming-conventions)); prescriptive trigger conditions measurably lift should-call rates ([anthropics/skills tool-use-concepts](https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/tool-use-concepts.md)).

**Naming** — `verb_object` snake_case, one verb per concept (`get_/list_/search_/create_/update_/delete_`), no abbreviations, prefix-namespacing when tools span services (`asana_search`), never suffix; names are part of the prompt budget ([Archestra](https://archestra.ai/blog/mcp-tool-naming-conventions); [Google mcp-toolbox style guide](https://github.com/googleapis/mcp-toolbox/blob/main/docs/en/reference/style-guide.md); [Anthropic writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents); MCP spec name charset/length rules + [SEP-986](https://modelcontextprotocol.io/community/seps/986-specify-format-for-tool-names.md)).

**Schema design** — enums wherever the value set is finite ("constrain the model's decision path", "schema itself tells the LLM what is valid"): [AWS MCP tool design](https://aws.amazon.com/blogs/machine-learning/mcp-tool-design-practical-approaches-and-tradeoffs/), [Google style guide](https://github.com/googleapis/mcp-toolbox/blob/main/docs/en/reference/style-guide.md); param caps — Google <5, AWS guidance ≤8; unambiguous param names (`user_id` not `user`); primitives over nested dicts; poka-yoke — reshape args so mistakes are structurally harder (Anthropic's absolute-paths example, [building-effective-agents appendix 2](https://www.anthropic.com/engineering/building-effective-agents)); `input_examples` for complex/optional-heavy tools, 1-5 realistic examples ([advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use); AI SDK v7 has the same lever: `inputExamples`, `provider-utils` dist `index.d.ts:1764`).

**Result design** — high-signal only, semantic fields over low-level identifiers, pagination/truncation defaults, ~token budgets per response; **error messages are prompt-engineering**: "clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks" ([writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)); "search requires 2+ terms" beats "no results" ([AWS](https://aws.amazon.com/blogs/machine-learning/mcp-tool-design-practical-approaches-and-tradeoffs/)).

**Side-effect / risk labeling** — MCP annotations vocabulary: `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`; hints drive client UX (auto-approve read-only, confirm destructive, retry-safe iff idempotent) but are NOT enforcement — guarantees live in deterministic controls ([MCP spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools); [annotations-as-risk-vocabulary post](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)); separate read tools from write tools for a clean consent model, never hide a destructive action behind an `action` param ([Google style guide](https://github.com/googleapis/mcp-toolbox/blob/main/docs/en/reference/style-guide.md)); never retry a side-effecting action without an idempotency check (our own `error-handling.md` states the same).

**Tool-count scaling** — fewer, more capable tools; consolidate siblings; Goldilocks granularity ("a tool call must produce a self-contained result an agent can reason about": [Salesforce hosted-MCP best practices](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/best-practices.html)); at large N: deferred loading / tool-search rather than always-in-context definitions ([advanced-tool-use](https://www.anthropic.com/engineering/advanced-tool-use), 85% token reduction claim).

### B2. Our conventions (inventory, evidence)

- Naming: `x-tool.ts` one tool per file exporting a ToolSet (root `CLAUDE.md` naming table); registry wiring = invariant 7 (`main.ts:241-248,295-301`); tool names snake_case verb-ish (`exec`, `screenshot`, `avatar_set_expression`, `avatar_play_motion`), `avatar_` prefix namespaces the family (`presentation-stop.ts:9-12`).
- Errors: never-throw execute returning `{ok:false, code, message}` with a closed code union in `@taki/shared` (`.trellis/spec/backend/error-handling.md:9-14`; live: `exec-tool.ts:32-36`, `screenshot-tool.ts:48-52`, both avatar tools).
- Taxonomy at birth: presentation vs informational, structural stop via `presentationTailStop` not result shape, PRESENTATION_TOOL_NAMES registry (`agent-runtime.md` "Classify every tool" section; `presentation-stop.ts`).
- Runtime enum: per-turn `z.enum(live names)` with string fallback (`vocab-name-schema.ts:12-14`), prompt-side vocabulary + usage rules as bias (`avatar-vocabulary.ts:42-49`), enum as the structural clamp (`agent-runtime.md` 1e section).
- Descriptions: 3-4 sentences, state when/how + fire-and-forget nature + anti-filler instruction (`play-motion-tool.ts:15-20`, `set-expression-tool.ts:15-20`); exec normalizes "nonzero exit is a normal result, not a tool error" (`exec-tool.ts:19-22`); screenshot's description adapts to configured capability (`screenshot-tool.ts:26-30`).
- Loop budget: `stopWhen: [isStepCount(maxSteps), ...]`, env-injected cap (`chat-agent.ts:95`, `DEFAULT_MAX_STEPS=10` `:67`).

### B3. GAP TABLE

| Standard-practice item (source) | Our status | Evidence |
| --- | --- | --- |
| Detailed 3-4+ sentence descriptions w/ when-to-use (Anthropic define-tools) | **Conform** | avatar tools, exec, screenshot descriptions cited in B2 |
| When-NOT-to-use / sibling cross-reference in descriptions (Archestra, define-tools) | **Partial** | anti-filler + "MUST be one of vocabulary" present; no tool names a sibling or a negative case ("don't use exec to read workspace files — use files_read") |
| verb_object naming, one verb per concept (Archestra, Google) | **Partial** | `avatar_set_expression`/`avatar_play_motion` conform; `exec`/`screenshot` are bare nouns/verbs — acceptable at N≈12, will ambiguate at scale; no documented verb registry |
| Namespace prefixing for families (Anthropic, Archestra) | **Conform** | `avatar_*` family; MCP tools arrive server-prefixed via manager |
| Enums where value set is finite (AWS, Google, skills repo) | **Conform+** | 1e per-turn dynamic enum is a *stronger* variant of the static-enum guidance; `priority` enum on play_motion |
| Param caps <5-8 (Google <5, AWS ≤8) | **Conform** | max is play_motion's 3; CLAUDE.md caps TS fn params at 3 |
| Unambiguous param names (writing-tools-for-agents) | **Conform** | `name`, `command`, `priority`, `loop` — `name` is arguably generic but is scoped by the tool name + description |
| Structured, actionable error results — errors are prompts (writing-tools-for-agents, AWS) | **Conform / Partial** | closed union + message (error-handling.md); codes like `INTERNAL_ERROR` are opaque-ish — the *message* carries actionability; no spec rule yet that the message must state what to change |
| Never-throw execute, degrade readable (error-handling.md ≙ OpenAI Agents SDK failure conversion) | **Conform** | every execute cited in B2 |
| Side-effect/idempotency labeling (MCP annotations) | **Missing (by design so far)** | no readOnly/destructive/idempotent metadata on tools; the Shell Permission Gate carries risk governance instead — but agent-side retry-safety (may the LOOP re-call this?) is nowhere machine-readable |
| Read/write separation for consent (Google) | **Conform** | files read/write are separate tools; clipboard read/write separate; gate authorizes per capability |
| input_examples for complex tools (advanced-tool-use; SDK `inputExamples`) | **Missing** | no tool uses `inputExamples`; none currently complex enough to demand it — becomes relevant for multi-param T2 tools |
| Result token budgets / truncation defaults (writing-tools-for-agents) | **Partial** | exec output truncation exists Shell-side (`truncated` flag in ExecOutput); no general per-tool result-size discipline in spec |
| Tool-count scaling: deferred loading (advanced-tool-use) | **Deferred consciously** | skills are lazy via `load_skill`; MCP tools all enter the per-turn ToolSet — fine at current N, revisit at ~30+ tools |
| Consolidate sibling operations (define-tools) | **Divergent, justified** | two avatar tools instead of one `avatar_express(kind,...)` — deliberate: distinct vocabularies + presentation taxonomy hang off tool names; document the why in T2 spec |

**Things we do that industry recommends AGAINST: none found.** Closest calls: (a) `exec`'s single opaque `command` param vs "explicit parameters" guidance — justified: the Shell parses/governs it, and per Anthropic's format guidance a raw command string is the most model-natural encoding; (b) per-turn changing schemas defeat provider prompt/schema caching (Anthropic notes tool_choice/schema changes invalidate cache) — accepted cost of 1e, worth a one-line note in the T2 spec.

---

## C. Agent-loop reliability under tool errors at scale (T2 seed)

### C1. How serious runtimes keep the loop safe (surveyed)

- **AI SDK 7 (what we already have, verified/spec'd):** invalid call → `invalid:true` → tool-error part read next step (self-correction; `agent-runtime.md` 1e, installed-dist verified); failed tool calls "sent back to the LLM in the next step to give it an opportunity to fix it" is the SDK's own framing, with `repairToolCall` as the no-extra-step alternative ([tool-calling docs](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)); step cap via `stopWhen: isStepCount` (`chat-agent.ts:95`); granular error types `NoSuchToolError`/`InvalidToolInputError`/`ToolCallRepairError` (dist + [SDK 4.1 announcement](https://vercel.com/blog/ai-sdk-4-1)). **Note: nothing in the SDK caps CONSECUTIVE failures** — maxSteps is the only brake; N tools failing structurally identically burn N steps.
- **OpenAI Agents SDK:** tool exception → caught → stringified → returned to the model as the tool result (self-healing default), customizable via `failure_error_function` (None = propagate instead of model-visible); `MaxTurnsExceeded` as the loop budget with a graceful-degrade recipe; tool timeouts convert to model-visible errors; provider-level retry config (backoff, 429/5xx only) kept SEPARATE from tool-error handling ([tool-execution-lifecycle reference](https://github.com/openai/openai-agents-python/blob/main/.agents/references/tool-execution-lifecycle.md); [error-handling writeup](https://callsphere.ai/blog/openai-agents-sdk-error-handling-exceptions-retries-recovery.md)). Also: sibling isolation (one failing parallel tool must not discard successful siblings' outputs) and dedupe-by-call-id (a repeated call ID must not execute twice).
- **LangGraph:** three composable per-node primitives — `RetryPolicy` (transient-only predicate: ConnectionError/5xx, backoff+jitter, max_attempts), `TimeoutPolicy` (wall-clock + idle/progress-based), `error_handler` after retry exhaustion (compensation/Saga routing, fallback models, dead-letter) ([fault-tolerance docs](https://docs.langchain.com/oss/python/langgraph/fault-tolerance); [blog](https://www.langchain.com/blog/fault-tolerance-in-langgraph)). The transferable ideas: (1) retry only classed-transient failures, never semantic ones; (2) timeout is just "hung = transient failure"; (3) a distinct after-retries-exhausted path.
- **MCP annotations → loop policy:** `idempotentHint: true` ⇒ "safe to retry on failure" is the canonical mapping ([annotations post](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)) — i.e., retry-safety should be per-tool metadata, not a global loop guess.
- **Our own spec already contributes two loop-safety inventions** the surveyed sources don't have: the presentation tail-stop (a *success*-path loop guard — forced-generation padding is also a loop failure) and fail-closed approval on every non-affirmative path (`error-handling.md:23`).

### C2. Tool-governance contract sketch (what `.trellis/spec` should mandate for EVERY new tool)

Grounding: each mandate cites a surveyed source or an existing repo convention — no invented rules. Proposed as a new `spec/backend/tool-governance.md` (or an agent-runtime.md section) with a birth-checklist shape:

1. **Registry + file shape**: one tool per `x-tool.ts` exporting `createXTool(deps): ToolSet`, wired in exactly one registry site (`main.ts` capability bag / characterTools / extraTools) — invariant 7 + CLAUDE.md naming (existing).
2. **Taxonomy at birth**: declare presentation vs informational; presentation ⇒ name into `PRESENTATION_TOOL_NAMES` + fire-and-forget description + `{ok:true}`-only result; informational ⇒ never in that set (existing: `agent-runtime.md`; industry mirror: MCP read/write separation).
3. **Schema quality bar**: z.enum for every finite value set (AWS/Google; 1e for runtime-finite); params ≤3 (CLAUDE.md cap; Google <5); no nested objects without justification (Google "stick to primitives"); optional params only with a reason logged — they block provider strict modes (A3 evidence); every param name unambiguous (writing-tools-for-agents).
4. **Strict-compatibility rule (new, from A):** author schemas so `asSchema(...)` emits all-required + `additionalProperties:false` where feasible — costs nothing today, keeps token-level enforcement adoptable per-provider tomorrow (OpenAI/Anthropic/DeepSeek all converge on the same requirements).
5. **Description discipline**: 3-4+ sentences: what / when / when-NOT (name the sibling) / result semantics ("nonzero exit is a normal result you should read" pattern, `exec-tool.ts:22`); descriptions are prompt budget — no boilerplate (define-tools; Archestra).
6. **Structured error union, never-throw execute**: `{ok:false, code∈ErrorCode, message}` with an ACTIONABLE message (what to change, not just what failed — writing-tools-for-agents); codes added to `@taki/shared` closed union only (existing `error-handling.md`).
7. **Loop-safety review (the new gate)**: before merge, answer in the tool header or PR: (a) what does the model READ on failure — is it self-correcting-quality? (b) can this tool loop the agent (same failure repeated N steps burns N of maxSteps — SDK has no consecutive-failure brake, C1)? If plausibly loopable, the error message must change across repeats or instruct give-up; (c) is a RETRY of this tool side-effect-safe — label idempotency in the header (MCP idempotentHint mapping; error-handling.md "never retry a side-effecting action without an idempotency check").
8. **Result budget**: cap/truncate large outputs with an explicit `truncated` flag the model can read (exec precedent; writing-tools-for-agents token-efficiency).
9. **Tests**: L1 deterministic per tool (mock deps; error path pinned — the deny/failure default must have a test that fails if flipped, `error-handling.md:23`); L2 real-agent only when the failure is transcript-shaped (e2e-harness.md dual-track, agent-runtime.md "test the deterministic root cause").
10. **Approval/permission posture**: any OS-touching tool rides route→broker→Shell-gate (invariant 1); MCP tools ride the approval gate; a new tool states which lane it is in its POS header (existing architecture, made a checklist line).

---

## T2 recommendations (ranked)

1. **Ship `experimental_repairToolCall` deterministic nearest-match repair for the avatar `name` enum** — kills the residual first-try stale-tag round-trip with zero provider risk (A4 sketch; L1-testable).
2. **Write `spec/backend/tool-governance.md` from the C2 checklist** — ten mandates, each already grounded; make it the implement-agent's injected pre-read for any `*-tool.ts` change.
3. **Adopt the strict-compatibility authoring rule now** (all-required + additionalProperties-false-compatible schemas; reshape `avatar_play_motion`'s optionals or document the exemption) — keeps provider-side enforcement a config flip, not a refactor.
4. **Do NOT enable DeepSeek strict/beta now**; log a deferred-decision entry with the revisit trigger (strict out of Beta OR corruption-fix announced AND /beta remap resolved) per the defer-explicitly rule.
5. **Add the loop-safety review questions (C2.7) to the check-agent prompt** — consecutive-failure looping is the one scale risk neither the SDK nor our spec currently brakes.
6. **Description upgrades on existing tools when next touched** (when-NOT-to-use + sibling naming), not as a big-bang pass — on-touch retrofit convention.
7. **At ~30+ tools, revisit deferred loading** (skills-style lazy load for MCP/capability tools; advanced-tool-use evidence) — note the trigger in the governance spec, no action now.
