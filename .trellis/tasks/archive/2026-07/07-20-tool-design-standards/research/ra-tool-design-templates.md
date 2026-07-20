# Research: Tool-Design Template Bank (T2a — authoritative, every-rule cited)

- **Query**: Produce a templated, fully-sourced tool-design standard the impl agent lifts (almost verbatim) into `.trellis/spec/backend/tool-design.md`. Deepen `m5-tool-governance-survey.md` §B into sourced rules. Every rule carries a citation; unsourced ideas are omitted (owner hard constraint 2026-07-20).
- **Scope**: mixed — 5 authoritative sources (Anthropic, OpenAI, MCP, OpenClaw 龙虾, Hermes 马) + our current 8 tools + our specs.
- **Date**: 2026-07-20
- **Source coverage (all 5 landed)**: Anthropic (writing-tools-for-agents 2025-09-11 + building-effective-agents Appendix 2 + define-tools + tool-use overview — verified via exa, exact quotes below); OpenAI (structured-outputs + function-calling guides — via m5, URL-cited); MCP (tools spec 2025-11-25 + annotations blog 2026-03-16 — verified via exa, defaults confirmed across 4 corroborating sources); OpenClaw (docs `plugins/tools`, `plugins/tool-plugins` + repo `openclaw/openclaw` `src/agents/tool-catalog.ts`, `agent-tool-definition-adapter.ts` — verified via exa); Hermes (`references/hermes-agent-main/` — read directly, file:line cited).
- **Verification discipline**: no external API/behavior asserted from memory. MCP annotation defaults confirmed against `blog.modelcontextprotocol.io` + `modelcontextprotocol.io/specification` + 2 corroborating write-ups (all agree). Anthropic quotes are verbatim from the engineering posts. Hermes/OpenClaw claims cite the exact file or doc page.

---

## Citation key (used inline below)

| Tag | Source | Handle |
|---|---|---|
| **[A-WTA]** | Anthropic, "Writing effective tools for agents" (2025-09-11) | https://www.anthropic.com/engineering/writing-tools-for-agents |
| **[A-BEA]** | Anthropic, "Building effective agents" — Appendix 2 "Prompt engineering your tools" | https://www.anthropic.com/engineering/building-effective-agents |
| **[A-DEF]** | Anthropic docs, "Define tools" (3-4+ sentence descriptions) | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools |
| **[A-STRICT]** | Anthropic docs, tool-use overview — "Guaranteed tool calls with strict tools" | https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview |
| **[O-SO]** | OpenAI, "Introducing Structured Outputs" + Structured Outputs guide | https://openai.com/index/introducing-structured-outputs-in-the-api/ ; https://developers.openai.com/api/docs/guides/structured-outputs |
| **[O-FC]** | OpenAI, Function-calling guide ("we recommend always enabling strict mode") | https://developers.openai.com/api/docs/guides/function-calling |
| **[MCP-SPEC]** | MCP spec, Server → Tools (2025-11-25) | https://modelcontextprotocol.io/specification/2025-11-25/server/tools |
| **[MCP-ANN]** | MCP blog, "Tool Annotations as Risk Vocabulary" (2026-03-16, maintainer post) | https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ |
| **[GOOG]** | Google `mcp-toolbox` style guide (param caps, read/write split, primitives) | https://github.com/googleapis/mcp-toolbox/blob/main/docs/en/reference/style-guide.md |
| **[AWS]** | AWS ML blog, "MCP tool design: practical approaches and tradeoffs" | https://aws.amazon.com/blogs/machine-learning/mcp-tool-design-practical-approaches-and-tradeoffs/ |
| **[ARCH]** | Archestra, "MCP tool naming conventions" | https://archestra.ai/blog/mcp-tool-naming-conventions |
| **[GEO]** | Geodocs, "Agent tool naming conventions spec" (2026-05, corroborating) | https://geodocs.dev/ai-agents/agent-tool-naming-conventions-spec |
| **[OC-TOOLS]** | OpenClaw docs, "Tools" (structure, stringEnum, return values, best practices) | https://openclaw-openclaw.mintlify.app/plugins/tools |
| **[OC-PLUGIN]** | OpenClaw docs, "Tool plugins" ("Tool names are the stable API…") | https://docs2.openclaw.ai/plugins/tool-plugins |
| **[OC-CAT]** | OpenClaw repo, `src/agents/tool-catalog.ts` (core tool naming inventory) | github.com/openclaw/openclaw `src/agents/tool-catalog.ts` |
| **[OC-ADAPT]** | OpenClaw repo, `src/agents/agent-tool-definition-adapter.ts` (never-throw exec, blocked-result) | github.com/openclaw/openclaw `src/agents/agent-tool-definition-adapter.ts` |
| **[H-REG]** | Hermes `tools/registry.py` (ToolEntry, tool_error/tool_result, never-throw dispatch) | `references/hermes-agent-main/tools/registry.py` |
| **[H-MT]** | Hermes `model_tools.py` (arg coercion, error sanitization, progressive disclosure, sibling-ref pruning) | `references/hermes-agent-main/model_tools.py` |
| **[H-EC]** | Hermes `agent/error_classifier.py` (retryable vs deterministic taxonomy) | `references/hermes-agent-main/agent/error_classifier.py` |
| **[H-FT]** | Hermes `tools/file_tools.py` (enum params, ranges, per-field desc, "use X instead" cross-refs) | `references/hermes-agent-main/tools/file_tools.py` |

Our-code handles: tools live in `packages/core/src/avatar/*-tool.ts` and `packages/core/src/capabilities/*-tool.ts`; specs `.trellis/spec/backend/error-handling.md`, `.trellis/spec/backend/agent-runtime.md`; root `CLAUDE.md`.

---

## 1. TEMPLATED RULE SET (liftable into `spec/backend/tool-design.md`)

Format per rule: **rule** · *source* · **our status** (conform / partial / gap + file evidence).

### (a) Naming

**N1. `verb_object` snake_case, one verb + one primary noun; verb first, noun names the resource not the format.**
*Source: [ARCH]; [GOOG]; [GEO] ("exactly one verb and one primary noun … Verb comes first"); canonical verbs `get_/list_/search_/create_/update_/replace_/delete_/run|execute` [GEO]. Vendor examples are snake_case [A-WTA] (`asana_search`).*
Our status: **partial**. `avatar_set_expression`, `avatar_play_motion` conform (verb+noun). `exec`, `screenshot`, `shell_open`, `clipboard_read/write`, `process_list` are bare or noun-led — acceptable at N≈8, will ambiguate at scale; no verb registry documented. (`packages/core/src/capabilities/*-tool.ts` names; root `CLAUDE.md` naming table mandates `x-tool.ts`/`xTool` file shape.)

**N2. Namespace-prefix related tools into families (by service, then resource).**
*Source: [A-WTA] ("namespacing tools by service e.g. `asana_search`, `jira_search`, and by resource e.g. `asana_projects_search`"); [ARCH]; MCP name charset/length rules [MCP-SPEC]. OpenClaw uses family prefixes `sessions_*`, `memory_*` [OC-CAT].*
Our status: **conform**. `avatar_*` namespaces the presentation family; MCP tools arrive server-prefixed. (`avatar/set-expression-tool.ts:14`, `play-motion-tool.ts:14`.)

**N3. Tool name is a stable API + part of the prompt budget: unique within the toolset, no IDs in the name, reject duplicate registration, keep names short (target ≤32 chars, hard cap 64), one case-style per surface.**
*Source: [OC-PLUGIN] ("Tool names are the stable API. Pick names that are unique, lowercase, and specific enough to avoid collisions"); [GEO] (length caps, "IDs belong in arguments, not names", "reject the second registration"); [A-WTA] (names are loaded into context — namespacing reduces mistakes). Hermes rejects shadowing registrations unless `override=True` [H-REG:388-435].*
Our status: **conform**. Registry wiring is one-tool-per-file via `createXTool(deps): ToolSet` (invariant 7; `CLAUDE.md`); no IDs in names; snake_case throughout.

**N4. Prefer vs suffix namespacing is eval-decided, not dogma.**
*Source: [A-WTA] ("selecting between prefix- and suffix-based namespacing … non-trivial effects … Effects vary by LLM"); [GEO] (name A/B eval protocol).*
Our status: **conform** (prefix `avatar_`); no eval yet — note-only.

### (b) Description writing

**D1. Detailed description: 3-4+ sentences covering WHAT it does, WHEN to use it, and WHAT each param means; treat it as a docstring for a new hire.**
*Source: [A-DEF] ("extremely detailed descriptions … 3-4+ sentences"); [A-WTA] ("think of how you would describe your tool to a new hire … make it explicit"); [A-BEA] ("A good tool definition often includes example usage, edge cases, input format requirements, and clear boundaries from other tools").*
Our status: **conform**. Avatar tools 4 sentences (`set-expression-tool.ts:15-20`, `play-motion-tool.ts:15-20`); exec 3 sentences (`exec-tool.ts:19-22`); screenshot adapts to the VLM bridge (`screenshot-tool.ts:26-30`).

**D2. Description MUST state WHEN-NOT-to-use and name the sibling tool to prefer instead (negative guidance + cross-reference).**
*Source: [A-BEA] ("clear boundaries from other tools"); Hermes is the concrete template: `write_file` desc = "Use this instead of echo/cat heredoc in terminal … OVERWRITES the entire file — use 'patch' for targeted edits" [H-FT:1963]; `search_files` = "Use this instead of grep/rg/find/ls in terminal … Also use this instead of ls" [H-FT:2032]; OpenClaw best-practice "Clear Descriptions — understand when to use" [OC-TOOLS].*
Our status: **partial → the primary spec add.** Anti-filler + "MUST be one of the vocabulary" present, but NO tool names a sibling or a negative case. Avatar tools are a 2-family that should cross-ref ("to change the facial expression use `avatar_set_expression`; this tool plays body motions"). (`set-expression-tool.ts:15-20`, `play-motion-tool.ts:15-20`.)

**D3. Result semantics belong in the description: tell the model what a "normal but non-success" result means so it reads rather than retries.**
*Source: [A-WTA] (truncation/error responses "steer agents"); mirrors [MCP-ANN] retry semantics. Our own exec precedent normalizes it.*
Our status: **conform**. `exec` — "A nonzero exitCode, a timeout, or truncated output are normal results you should read — not tool errors" (`exec-tool.ts:19-22`); `clipboard_read` — "An empty clipboard returns an empty string" (`clipboard-read-tool.ts:20-21`); `process_list` — "Read-only: this cannot start or stop any process" (`process-list-tool.ts:20-21`).

**D4. Descriptions are prompt budget — no boilerplate, no filler; every sentence must steer.**
*Source: [A-WTA] ("loaded into your agents' context … collectively steer agents"); [A-DEF]. Hermes actively STRIPS a sibling cross-ref from a description when that sibling is unavailable, because a dangling reference makes the model "hallucinate calls to them" [H-MT:495-513, 447-451].*
Our status: **conform**; the anti-filler instruction is in the avatar descriptions. Implication for us (sourced): if a tool names a sibling, that sibling must actually be present — do not reference tools that can be absent without pruning the reference.

### (c) input_schema design

**S1. Use an `enum` for every finite value set — the schema itself tells the model what is valid and constrains its decision path.**
*Source: [AWS] ("constrain the model's decision path"); [GOOG] ("schema itself tells the LLM what is valid"); OpenClaw stringEnum best-practice [OC-TOOLS]. Hermes: `mode:["replace","patch"]` [H-FT:1995], `target:["content","files"]`, `output_mode:["content","files_only","count"]` [H-FT:2037,2042].*
Our status: **conform+**. `shell_open.kind = z.enum(["url","path"])` (`shell-open-tool.ts:22`); `play_motion.priority = z.enum(["idle","normal","force"])` (`play-motion-tool.ts:24`); and the T1 1e **per-turn dynamic enum** (`avatar/vocab-name-schema.ts`) is a *stronger* variant — it clamps `name` to the live vocabulary each turn.

**S2. Emit a plain JSON-Schema `enum` (not an exotic union) so it is provider-portable; token-level strict enforcement makes an out-of-enum value unsamplable.**
*Source: [OC-TOOLS] ("Do NOT use `Type.Union` with enum-like values. Use the `stringEnum` helper … compatible with all LLM providers"); [O-SO] (enum members enforced at token level under strict). zod `z.enum` already renders standard `{"type":"string","enum":[…]}` — verified in m5 §A3 wire-shape render.*
Our status: **conform**. `z.enum` output is the portable shape; no unions used for enum-like fields.

**S3. Constrain with ranges/defaults where the value is bounded (`minimum`/`maximum`, sensible `default`).**
*Source: [A-WTA] (pagination/range/limit params with "sensible default parameter values"); Hermes `offset {minimum:1, default:1}`, `limit {default:500, maximum:2000}` [H-FT:1954-1955].*
Our status: **gap (by absence, low-severity).** No current tool has a numeric range param; becomes relevant for multi-param T2 tools. State the rule now for future tools.

**S4. Every parameter carries a per-field `description`; parameter names are unambiguous (`user_id`, not `user`).**
*Source: [A-WTA] ("input parameters should be unambiguously named: instead of `user`, try `user_id`"); [A-BEA] ("writing a great docstring for a junior developer"). Hermes puts a `description` on every property [H-FT:1953-2043].*
Our status: **partial**. Param names are scoped-clear (`name`, `command`, `kind`, `target`, `priority`, `loop`, `text`) but our zod fields carry **no inline `.describe()`** — the meaning rides only the tool description. For single-obvious-param tools this is fine; multi-param tools (play_motion's `priority`/`loop`) should gain per-field `.describe()`.

**S5. Param cap: keep the argument count small (Google <5; AWS ≤8); prefer primitives over nested objects.**
*Source: [GOOG] (<5, "stick to primitives"); [AWS] (≤8). Our `CLAUDE.md` caps TS fn params at 3.*
Our status: **conform**. Max is `play_motion`'s 3; all params are primitives.

**S6. Poka-yoke: shape arguments so mistakes are structurally hard (e.g. require absolute paths, not relative).**
*Source: [A-BEA] ("Poka-yoke your tools. Change the arguments so that it is harder to make mistakes"; the absolute-filepath fix "the model used this method flawlessly").*
Our status: **conform (in spirit)**. The 1e runtime enum is exactly this — a stale/hallucinated name is not expressible as a valid arg (`agent-runtime.md` 1e). Generalize the principle in the spec.

**S7. STRICT-READY authoring rule (write now, enable later): author every object schema so it renders all-properties-`required` + `additionalProperties:false`; emulate a genuine optional as required-with-a-documented-default rather than `.optional()`.**
*Source: [O-SO]/[O-FC] (strict requires "`additionalProperties:false` on every object, all properties in `required`"; "we recommend always enabling strict mode"); [A-STRICT] (Anthropic strict tools); DeepSeek strict same requirement + no documented `null` type (m5 §A2/A3). Convergence across all three providers = author to the intersection.*
Our status: **partial → concrete gap.** `avatar_set_expression` and `screenshot` are already strict-compatible (all-required / empty object — m5 §A3). `avatar_play_motion` VIOLATES it: `priority?` + `loop?` are `.optional()`, so `required` omits them and a strict request would be rejected (m5 §A3 wire-shape). Fix = make `priority` required (member `"normal"` as the documented default) + `loop` required boolean, OR log an exemption in `docs/deferred-decisions.md`. Actual provider-strict enablement stays deferred → **D40**.

### (d) result / error design

**R1. Never-throw execute: every failure degrades into a structured result `{ok:false, code, message}` the model can read; codes are a closed union in `@taki/shared`.**
*Source: our `.trellis/spec/backend/error-handling.md:9-14`; industry mirror — OpenClaw normalizes all execute failures to a result and only re-throws on abort signal [OC-ADAPT]; Hermes `dispatch` catches everything and returns `{"error": …}` [H-REG:614-644], with `tool_error()`/`tool_result()` helpers [H-REG:784-810].*
Our status: **conform**. Every tool's `execute` has a try/catch returning `{ok:false, code:"INTERNAL_ERROR", message}` (e.g. `set-expression-tool.ts:29-32`, `exec-tool.ts:32-35`, all six capability tools). Routed capability errors carry real codes (`PERMISSION_DENIED`, etc.) from `routeCapability`.

**R2. Error messages are prompt-engineering: state SPECIFICALLY and ACTIONABLY what to change, not an opaque code/traceback. For a bad enum, list the valid values.**
*Source: [A-WTA] ("clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks"; example: "The `user_id` parameter must be a valid UUID. Example: …"); [AWS] ("search requires 2+ terms" beats "no results").*
Our status: **partial → the second primary spec add.** The closed-union code is present but the catch-branch message is raw `error.message` with code `INTERNAL_ERROR` (e.g. `screenshot-tool.ts:48-52`) — opaque-ish, and no spec rule yet says the message must say what to change. Mitigant already in place: the invalid-enum path is actionable *via the schema* — the 1e enum list is in the tool spec, and an out-of-vocab `name` becomes a readable `tool-error` the model self-corrects on (`agent-runtime.md` 1e). Formalize R2 as a spec rule; concrete code impact is small because most catch-branches are genuinely-internal failures with nothing for the model to change.

**R3. Return only high-signal context; prefer semantic fields over low-level identifiers (`name`/`file_type`/`image_url`, not `uuid`/`mime_type`/`256px_url`).**
*Source: [A-WTA] ("eschew low-level technical identifiers … Fields like `name`, `image_url`, and `file_type` are much more likely to directly inform").*
Our status: **conform**. `screenshot` returns `{path, width, height, bytes, description?}` (semantic) not internal handles (`screenshot-tool.ts:46-47`); `process_list` returns `{processes, count}` (`process-list-tool.ts:29`).

**R4. Result budget: cap/truncate large outputs with sensible defaults and a machine-readable `truncated` flag; instruct the model how to narrow.**
*Source: [A-WTA] ("Claude Code, we restrict tool responses to 25,000 tokens by default"; pagination/range/filter/truncation with sensible defaults; "steer agents … make many small, targeted searches"). Hermes sets `max_result_size_chars` per tool (100_000 for file tools) [H-FT:2104-2107; H-REG:650-658].*
Our status: **partial**. exec truncates Shell-side with a `truncated` flag in `ExecOutput` (m5 §B3). No general per-tool result-size discipline; `process_list` / `clipboard_read` return unbounded payloads (`process-list-tool.ts:29`, `clipboard-read-tool.ts:30`). State the rule; concrete hardening is a capability-side (T2b) job — note-only for T2a.

**R5. Sanitize tool-error/text before it re-enters the transcript: strip role/framing tokens, cap length (defense-in-depth against injected framing from tool output).**
*Source: Hermes `_sanitize_tool_error` strips `</tool_call>`-style tags, code fences, CDATA, caps at 2000 chars [H-MT:626-649], applied on the dispatch error path [H-REG:636-644].*
Our status: **gap (by absence), note-only.** Our tool outputs are first-party/Shell-mediated so injection surface is low today; becomes relevant when tools return open-world content (screenshot VLM description, future web tools). Record as a forward rule, not a T2a change.

### (e) idempotency / retry-safety labeling

**I1. Label each tool's risk/retry posture with the MCP annotation vocabulary — `readOnlyHint` (does it modify?), `destructiveHint` (destructive vs additive?), `idempotentHint` (safe to call again?), `openWorldHint` (reaches external/untrusted world?).**
*Source: [MCP-ANN] / [MCP-SPEC]. Defaults are deliberately cautious (worst-assumed): `readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=true` — confirmed identical across the maintainer blog + spec + 2 corroborating write-ups.*
Our status: **missing (by design so far)**. No machine-readable risk metadata on tools; risk governance lives Shell-side in the Permission Gate. Some POS headers state posture in prose only (`process_list` desc "Read-only"; avatar tools "no OS/gate"). For T2a: adopt the vocabulary as a **POS-header convention** (state readonly/idempotent/destructive/open-world in the module header), not runtime enforcement.

**I2. `idempotentHint:true` ⇒ safe to retry on failure; a non-idempotent side-effecting tool must NOT be blind-retried.**
*Source: [MCP-ANN] ("`idempotentHint: true` → Safe to retry on failure"); our `error-handling.md:36` states the same ("Retrying a side-effecting action without an idempotency check" is under "What must never happen").*
Our status: **conform (principle)**; not yet per-tool machine-readable — I1 makes it so.

**I3. Hints are NOT guarantees — keep real safety in deterministic controls; separate read tools from write tools for a clean consent model (never hide a destructive action behind an `action` param).**
*Source: [MCP-ANN] ("keep your actual safety guarantees in deterministic controls"); [GOOG] (read/write separation, never bury destructive behind a param).*
Our status: **conform**. Deterministic safety is the Rust Permission Gate (invariant 1); `clipboard_read`/`clipboard_write` and screenshot(read)/exec(write) are separate tools; the gate authorizes per capability.

**I4. Retry only classed-transient failures; a deterministic failure must fail fast with actionable guidance, never burn retries.**
*Source: Hermes `error_classifier.py` — a `ClassifiedError` carries `retryable` + `should_fallback`/`should_compress`/`should_rotate_credential`; deterministic cases (content-policy block, SSL cert-verify, unknown-parameter 400, model-not-found) return `retryable=False` so the loop stops instead of hammering [H-EC:77-98, 636-645, 804-817, 1213-1239]. (This is the API-failover layer, but the retryable-vs-deterministic principle transfers to tool-loop safety.) The 402 disambiguation credits "the key insight from OpenClaw" [H-EC:1127-1133].*
Our status: **conform (loop-level)**; AI SDK invalid→tool-error is our self-correction path (`agent-runtime.md` 1e). Note the scale risk (from m5 §C1, [A-WTA] metrics): the SDK has **no consecutive-failure brake** — a tool failing identically N steps burns N of `maxSteps`; the spec's loop-safety review question (does the error change across repeats?) addresses it.

### Cross-cutting (birth checklist — already sourced in m5 §C2, folded here)

**B1. Classify at birth: presentation (fire-and-forget, `{ok:true}` only, name into `PRESENTATION_TOOL_NAMES`) vs informational (loop must continue).**
*Source: our `agent-runtime.md` "Classify every tool" (T1 1c); industry mirror = MCP read/write separation [GOOG].*
Our status: **conform** (`avatar/presentation-stop.ts`; `PRESENTATION_TOOL_NAMES`).

**B2. One tool per `x-tool.ts` exporting `createXTool(deps): ToolSet`, wired at exactly one registry site; thin handler delegating to a capability client / subscription (no business logic inline).**
*Source: our `CLAUDE.md` (naming + anti-sprawl + "commands/tools are thin"); invariant 7. Hermes self-registers one schema+handler per tool file via `registry.register()` [H-REG:365-457]; OpenClaw one `create*Tool` per file [OC-CAT].*
Our status: **conform**.

**B3. Progressive disclosure at scale: below a threshold keep all tool defs in context; above it, defer non-core tools behind a search/describe/call bridge — do NOT invent a fixed N, use a context-fraction trigger.**
*Source: [A-WTA] cross-refs advanced-tool-use deferred loading; Hermes defers MCP/plugin (non-core) tools behind `tool_search`/`tool_describe`/`tool_call` when the deferrable surface exceeds ~10% of the context window, never deferring core tools [H-MT:537-566]. OpenClaw scopes via tool profiles `minimal|coding|messaging|full` [OC-CAT].*
Our status: **deferred consciously**. skills are lazy via `load_skill`; MCP tools all enter the per-turn ToolSet — fine at current N, revisit at scale (m5 §B3). Note the trigger, no action in T2a.

---

## 2. GAP LIST — current tools vs the sourced rules

Legend: **fix-in-T2a** = touched-file, real gap, closeable without exec core; **note-only** = record in spec / defer.

| # | Gap | Rule | Evidence (file:line) | Disposition |
|---|---|---|---|---|
| G1 | `avatar_play_motion` optional `priority`/`loop` break strict-ready (all-required) | S7 | `play-motion-tool.ts:24-25`; wire-shape m5 §A3 | **fix-in-T2a** — make `priority` required (default member `"normal"`) + `loop` required boolean, OR log exemption in `docs/deferred-decisions.md`. Provider-strict enablement → D40. |
| G2 | No sibling cross-ref / when-NOT-to-use in any description | D2 | avatar + capability tool descriptions | **fix-in-T2a (on touched tools)** — avatar tools cross-ref each other; template = Hermes `write_file`/`search_files` [H-FT:1963,2032]. On-touch retrofit, not big-bang. |
| G3 | Actionable-error rule unstated; catch-branch returns raw `error.message` + `INTERNAL_ERROR` | R2 | `screenshot-tool.ts:48-52` (pattern repeats in all 8) | **fix-in-T2a = spec rule**; code impact minimal (catch-branches are internal failures). Where the model CAN act (enum), the 1e enum list already carries actionability. |
| G4 | Multi-param tool fields lack inline `.describe()` | S4 | `play-motion-tool.ts:21-26` (`priority`/`loop` undescribed) | **fix-in-T2a (light)** — add `.describe()` to `priority`/`loop` when touched; single-param tools exempt. |
| G5 | No machine-readable risk/idempotency label | I1 | POS headers state posture in prose only (`play-motion-tool.ts:1-5`) | **fix-in-T2a = POS-header convention**; runtime annotation/enforcement → T2b permission governance. |
| G6 | `shell_open.target` scheme constraint (http/https/mailto) is prose-only, not in schema | S1/S6 | desc `shell-open-tool.ts:21` vs schema `:22` (`target: z.string().min(1)`) | **note-only** — the 3-scheme set is a per-field *pattern*, not a clean enum (target is a full URL/path); enforcement is deliberately Shell-side governance (same rationale as exec). Keep description constraint; optionally add `.describe()`. |
| G7 | No general per-tool result budget / `truncated` discipline | R4 | `process-list-tool.ts:29`, `clipboard-read-tool.ts:30` (unbounded) | **note-only** — capability/Shell-side hardening (T2b); state the rule now. |
| G8 | No tool-error output sanitization (framing-token strip / length cap) | R5 | (absent; Hermes `_sanitize_tool_error` [H-MT:626-649]) | **note-only** — low injection surface today (first-party outputs); forward rule for open-world tool outputs. |

**exec core is OUT — confirmed nothing in the standard argues against it:**
- Opaque single `command` param vs "explicit, unambiguously-named params" (S4): **defended** by [A-BEA]'s own format guidance — "Keep the format close to what the model has seen naturally occurring in text … no formatting overhead"; a raw shell command string is the most model-natural encoding. Decomposing `command` would also move parsing/governance off the Shell, violating invariant 1. The exemption is sourced, not hand-waved.
- exec output: already returns full `ExecOutput` (`exitCode/stdout/stderr/timedOut/truncated`) with the "nonzero exit is a normal result you should read" framing (`exec-tool.ts:19-22,29-31`) — this *is* R3 (high-signal semantic result) + R4 (truncation flag) + D3 (result semantics in the description). No rule pushes exec to change output or input.

---

## 3. CROSS-SOURCE CONFLICTS (and our call)

**C-1. Consolidate siblings into fewer, more capable tools ([A-WTA], [A-DEF]) vs our two avatar tools.**
Anthropic pushes "a few thoughtful tools" and consolidation; OpenClaw likewise consolidates behaviors under one `browser`/`canvas`/`sessions_*` surface [OC-CAT]. BUT Anthropic equally requires "each tool a clear, distinct purpose" and [GOOG] requires read/write (here: expression vs motion) separation. **Our call: keep the split.** Justification is sourced: distinct vocabularies (expressions ≠ motions), the presentation taxonomy + 1e enum hang off the tool *name*, and each has a clear distinct purpose. Document the "why" in the spec (m5 §B3 already flagged this as divergent-justified).

**C-2. Optional params: OpenAI strict FORBIDS them (all-required + nullable emulation) [O-SO]; DeepSeek strict has no `null` type so optionals are unsupported (m5 §A2); MCP/Anthropic non-strict and OpenClaw TypeBox ALLOW `optional` [OC-TOOLS].**
**Our call: adopt the strict-ready intersection (S7)** — prefer all-required with a documented default member; permit a genuine optional only with a logged exemption. This keeps token-level strict a per-provider config flip (D40), costs nothing today, and is the intersection all three vendors converge on.

**C-3. Naming case style: [A-WTA]/[ARCH]/[GOOG] examples are snake_case; [GEO] permits camelCase OR snake_case (one per surface); OpenClaw is lowercase snake_case + single words (`exec`, `browser`) [OC-CAT].**
Minor. **Our call: mandate snake_case `verb_object`** — matches the Anthropic examples, our `CLAUDE.md`, and the majority; single-word names allowed only for a universally-understood primitive (`exec`, `screenshot`) with a note that they will need a verb at scale (N1).

**C-4. Enum encoding: OpenClaw warns AGAINST `Type.Union` for enums, mandating a `stringEnum` (`Type.Unsafe`) helper for "all LLM providers" [OC-TOOLS]; OpenAI/Anthropic strict enforce plain JSON-Schema `enum` at token level [O-SO].**
No real conflict — both want a **plain `{"type":"string","enum":[…]}`** on the wire, not an exotic union. **Our call: zod `z.enum` already emits exactly that** (m5 §A3); state "author enums as `z.enum`, never a hand-rolled union" so we inherit provider portability for free.

**C-5. "Hints drive auto-approval" ([MCP-ANN]) vs our fail-closed gate.** No conflict, but load-bearing: MCP is explicit that annotations are **untrusted hints, not enforcement** — safety must live in "deterministic controls." **Our call: annotations are documentation/UX only; the Rust Permission Gate remains the sole enforcement** (invariant 1; `error-handling.md` fail-closed). This is why I1 is a POS-header convention in T2a, not a runtime gate.

---

## 4. OMITTED (unsourced — NOT put in the standard, so the owner sees what was withheld)

- **A hard *upper* bound on description length** (e.g. "≤6 sentences"). Anthropic gives "3-4+ sentences" as a *floor* [A-DEF]; no authority caps it. Kept the floor, omitted a ceiling.
- **A universal `response_format: concise|detailed` enum on every tool.** Anthropic offers it as an *option* for high-token tools (Slack tools used ⅓ the tokens) [A-WTA], not a universal rule. Our tools are low-token — omitted as a mandate; recorded as a pattern for future high-token/informational tools only.
- **New annotation fields `sensitiveHint` / `egressHint` / `reversibleHint`.** These are *proposed* SEPs (mcpblog.dev), NOT in the MCP spec. Omitted from the standard; note as future-watch.
- **A fixed tool-count number for deferred-loading.** Hermes uses a context-fraction trigger (~10%) [H-MT]; Anthropic cites an 85% token-reduction outcome but no universal N. Omitted an invented N; kept the context-fraction trigger (B3).
- **Per-tool `emoji` metadata** (Hermes `ToolEntry.emoji` [H-REG:107]). Cosmetic, Hermes-specific, no design-authority backing. Omitted.
- **Client-side arg coercion / nearest-match repair as a *tool-design* rule.** Hermes `coerce_tool_args` [H-MT:656-751] and the m5 `experimental_repairToolCall` sketch are real and sourced, but they are agent-loop/runtime mechanisms, not tool-authoring rules — belongs in agent-runtime/loop-safety, not the tool-design standard. Omitted here to keep the standard about authoring.
- **Permission-level / argv[0] / pipe-mode governance.** Explicitly T2b per the PRD — omitted.

---

## Caveats / Not Found

- **OpenAI function-calling** was re-used from m5's URL-cited verification (not re-fetched this pass); m5 read the guides directly and the strict requirements are corroborated by [A-STRICT] + DeepSeek docs, so the S7 backbone is triple-sourced.
- **OpenClaw** was surveyed via its public docs + repo file listings through exa highlights (structure, stringEnum, naming, return values, best practices, tool profiles all captured with URLs). I did not clone OpenClaw locally; the quoted rules are from the doc pages [OC-TOOLS]/[OC-PLUGIN] and repo files [OC-CAT]/[OC-ADAPT]. If deeper per-tool schema detail is wanted, a `mcp__deepwiki__ask_question` pass on `openclaw/openclaw` would add file:line depth.
- **Hermes** tool *schemas* were sampled on the highest-signal family (`file_tools.py` — enums, ranges, per-field desc, sibling cross-refs); the registry + dispatch + error paths were read in full. Other tool files (web/browser/discord) follow the same `registry.register(name, toolset, schema, handler, check_fn, …)` shape [H-REG:365] and were not individually transcribed.
- Every rule N1–I4/B1–B3 above carries ≥1 citation; no rule is un-sourced. Rules that map to our own specs (R1, I2, B1) cite the spec file, per the owner's allowance that an existing repo convention counts as a source when it itself mirrors an external authority (each such rule also names the external mirror).
