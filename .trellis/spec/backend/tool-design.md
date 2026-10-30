# Tool Design Standard

> The governance contract EVERY new agent tool (`packages/core/src/**/*-tool.ts`) follows as the tool count grows.
> This consolidates and extends the existing conventions rather than rewriting them — our current tools already conform broadly; the rules below make the conventions
> explicit and fill the gaps (schema fullness, actionable errors, description discipline, strict-readiness).
>
> **Owner hard constraint (2026-07-20): every rule is templated from an AUTHORITATIVE source and carries its citation
> tag — zero invented rules.** Tags resolve via the [Source keys](#source-keys) table. A rule grounded in one of our
> own specs is allowed only because that spec itself mirrors an external authority, and it names that mirror too.
> Rules deliberately NOT adopted (and why) are recorded in the research bank §4 — do not smuggle them back in.
>
> Source of truth: `.trellis/tasks/07-20-tool-design-standards/research/ra-tool-design-templates.md` (§1 rules, §3
> rulings, §4 omissions). Read [Error Handling](./error-handling.md) and [Agent Runtime](./agent-runtime.md) alongside
> this — result/never-throw discipline lives there; presentation-vs-informational taxonomy and the 1e runtime enum too.

## How to use this

- Building a new tool: walk the **[B — Birth checklist](#b--birth-checklist)** first, then satisfy N/D/S/R/I.
- Reviewing a tool: each rule is a checkable assertion; a violation without a logged exemption is a review finding.
- Sizing: tool files are thin (CLAUDE.md anti-sprawl — 300-line baseline with a relaxed 360-line review threshold;
  `execute` ≤50, params ≤3); business logic delegates to a capability client / subscription, never inline in the
  handler (B2). The file threshold is a responsibility signal, not a formatting target: do not compress readable code
  or split a cohesive tool solely to satisfy a number.

## Source keys

| Tag | Source | Handle |
|---|---|---|
| **[A-WTA]** | Anthropic, "Writing effective tools for agents" (2025-09-11) | anthropic.com/engineering/writing-tools-for-agents |
| **[A-BEA]** | Anthropic, "Building effective agents" — Appendix 2 "Prompt engineering your tools" | anthropic.com/engineering/building-effective-agents |
| **[A-DEF]** | Anthropic docs, "Define tools" (3-4+ sentence descriptions) | platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools |
| **[A-STRICT]** | Anthropic docs, tool-use overview — "Guaranteed tool calls with strict tools" | platform.claude.com/docs/en/agents-and-tools/tool-use/overview |
| **[O-SO]** | OpenAI, "Introducing Structured Outputs" + Structured Outputs guide | openai.com/index/introducing-structured-outputs-in-the-api/ |
| **[O-FC]** | OpenAI, Function-calling guide ("we recommend always enabling strict mode") | developers.openai.com/api/docs/guides/function-calling |
| **[MCP-SPEC]** | MCP spec, Server → Tools (2025-11-25) | modelcontextprotocol.io/specification/2025-11-25/server/tools |
| **[MCP-ANN]** | MCP blog, "Tool Annotations as Risk Vocabulary" (2026-03-16) | blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ |
| **[GOOG]** | Google `mcp-toolbox` style guide (param caps, read/write split, primitives) | github.com/googleapis/mcp-toolbox …/style-guide.md |
| **[AWS]** | AWS ML blog, "MCP tool design: practical approaches and tradeoffs" | aws.amazon.com/blogs/machine-learning/mcp-tool-design-… |
| **[ARCH]** | Archestra, "MCP tool naming conventions" | archestra.ai/blog/mcp-tool-naming-conventions |
| **[GEO]** | Geodocs, "Agent tool naming conventions spec" (2026-05) | geodocs.dev/ai-agents/agent-tool-naming-conventions-spec |
| **[OC-TOOLS]** | OpenClaw docs, "Tools" (structure, stringEnum, return values, best practices) | openclaw-openclaw.mintlify.app/plugins/tools |
| **[OC-PLUGIN]** | OpenClaw docs, "Tool plugins" ("Tool names are the stable API…") | docs2.openclaw.ai/plugins/tool-plugins |
| **[OC-CAT]** | OpenClaw repo, `src/agents/tool-catalog.ts` (core tool naming inventory) | github.com/openclaw/openclaw `src/agents/tool-catalog.ts` |
| **[OC-ADAPT]** | OpenClaw repo, `agent-tool-definition-adapter.ts` (never-throw exec, blocked-result) | github.com/openclaw/openclaw `…/agent-tool-definition-adapter.ts` |
| **[H-REG]** | Hermes `tools/registry.py` (ToolEntry, tool_error/tool_result, never-throw dispatch) | `references/hermes-agent-main/tools/registry.py` |
| **[H-MT]** | Hermes `model_tools.py` (error sanitization, progressive disclosure, sibling-ref pruning) | `references/hermes-agent-main/model_tools.py` |
| **[H-EC]** | Hermes `agent/error_classifier.py` (retryable vs deterministic taxonomy) | `references/hermes-agent-main/agent/error_classifier.py` |
| **[H-FT]** | Hermes `tools/file_tools.py` (enum params, ranges, per-field desc, "use X instead" cross-refs) | `references/hermes-agent-main/tools/file_tools.py` |

Our-code handles cited below: tools in `packages/core/src/avatar/*-tool.ts` and `packages/core/src/capabilities/*-tool.ts`;
the closed error-code union in `@taki/shared`; specs `./error-handling.md`, `./agent-runtime.md`; root `CLAUDE.md`.

## N — Naming

**N1. `verb_object`, snake_case: one verb + one primary noun, verb first; the noun names the resource, not the format.**
`[ARCH]` `[GOOG]` `[GEO]` `[A-WTA]`. Canonical verbs `get_/list_/search_/create_/update_/replace_/delete_/run|execute`
`[GEO]`; vendor examples are snake_case `[A-WTA]` (`asana_search`). A single-word primitive name is allowed only for a
universally-understood action (`exec`, `screenshot`) — note that it will need a verb once the toolset grows (see C-3).
— Our conforming precedent: `avatar_set_expression`, `avatar_play_motion`.

**N2. Namespace related tools into families by prefix (service, then resource).**
`[A-WTA]` (`asana_search`, `jira_search`; `asana_projects_search`) `[ARCH]`; MCP name charset/length rules `[MCP-SPEC]`;
OpenClaw families `sessions_*`, `memory_*` `[OC-CAT]`. — Our precedent: the `avatar_*` family; MCP tools arrive
server-prefixed.

**N3. The tool name is a stable API and part of the prompt budget: unique within the toolset, no IDs in the name,
short (target ≤32 chars, hard cap 64), one case style per surface; reject a duplicate registration.**
`[OC-PLUGIN]` ("Tool names are the stable API … unique, lowercase, specific") `[GEO]` (length caps, "IDs belong in
arguments, not names", "reject the second registration") `[A-WTA]` (names load into context); Hermes rejects a shadowing
registration unless `override=True` `[H-REG]`. — Our precedent: one-tool-per-file `createXTool(deps): ToolSet`, wired at
exactly one registry site (invariant 7; `CLAUDE.md`).

**N4. Prefix-vs-suffix namespacing is eval-decided, not dogma.**
`[A-WTA]` ("Effects vary by LLM") `[GEO]` (A/B name eval). We use prefix (`avatar_`); no eval yet — note-only.

## D — Description

**D1. Detailed description — 3-4+ sentences covering WHAT it does, WHEN to use it, and WHAT each param means; write it
as a docstring for a new hire.** `[A-DEF]` ("3-4+ sentences") `[A-WTA]` ("describe your tool to a new hire … make it
explicit") `[A-BEA]` ("example usage, edge cases, input format requirements, and clear boundaries from other tools").
No upper sentence cap is imposed — the floor is sourced, a ceiling is not (research §4). — Our precedent: the avatar
tools (4 sentences), `exec` (3), `screenshot` (adapts to the VLM bridge).

**D2. State WHEN-NOT-to-use and name the sibling tool to prefer instead (negative guidance + cross-reference).**
`[A-BEA]` ("clear boundaries from other tools"); the concrete template is Hermes: `write_file` = "Use this instead of
echo/cat heredoc … use 'patch' for targeted edits" `[H-FT]`, `search_files` = "Use this instead of grep/rg/find/ls"
`[H-FT]`; `[OC-TOOLS]` ("understand when to use"). — Our precedent (added T2a G2): the two avatar tools cross-reference
each other ("to change the facial expression instead, use `avatar_set_expression`" and the mirror). One clause, on-touch
retrofit — not a big-bang pass.

**D3. Put result semantics in the description: tell the model what a "normal but non-success" result means, so it reads
rather than retries.** `[A-WTA]` (truncation/error responses "steer agents"); mirrors `[MCP-ANN]` retry semantics.
— Our canonical precedent: `exec` — "A nonzero exitCode, a timeout, or truncated output are normal results you should
read — not tool errors"; `clipboard_read` — "An empty clipboard returns an empty string".

**D4. Descriptions are prompt budget — no boilerplate, no filler; every sentence must steer.** `[A-WTA]` ("collectively
steer agents") `[A-DEF]`. A named sibling (D2) MUST actually be present in the toolset: Hermes strips a sibling cross-ref
when that sibling is unavailable, because a dangling reference makes the model "hallucinate calls to them" `[H-MT]`.

## S — Input schema

**S1. Use an `enum` for every finite value set — the schema itself tells the model what is valid and constrains its
decision path.** `[AWS]` ("constrain the model's decision path") `[GOOG]` ("schema itself tells the LLM what is valid")
`[OC-TOOLS]`; Hermes `mode:["replace","patch"]`, `output_mode:["content","files_only","count"]` `[H-FT]`. — Our
precedent: `shell_open.kind = z.enum(["url","path"])`, `play_motion.priority = z.enum(["idle","normal","force"])`, and
the stronger **1e per-turn dynamic enum** (`avatar/vocab-name-schema.ts`) that clamps `name` to the live vocabulary each
turn (`./agent-runtime.md` 1e).

**S2. Emit a plain JSON-Schema `enum`, never an exotic union — it is provider-portable and, under token-level strict,
makes an out-of-enum value unsamplable.** `[OC-TOOLS]` ("Do NOT use `Type.Union` with enum-like values … compatible with
all LLM providers") `[O-SO]` (enum enforced at token level under strict). — Our precedent: author enums as `z.enum`
(never a hand-rolled union) — it already renders `{"type":"string","enum":[…]}` (see C-4).

**S3. Constrain bounded numeric params with ranges and a sensible default (`minimum`/`maximum`, `default`).**
`[A-WTA]` (pagination/range/limit with "sensible default parameter values"); Hermes `offset {minimum:1, default:1}`,
`limit {default:500, maximum:2000}` `[H-FT]`. No current tool has a numeric range param — state the rule now for the
multi-param tools that come next.

**S4. Every parameter carries a per-field `description`; parameter names are unambiguous (`user_id`, not `user`).**
`[A-WTA]` ("instead of `user`, try `user_id`") `[A-BEA]` ("a great docstring for a junior developer"); Hermes puts a
`description` on every property `[H-FT]`. A single-obvious-param tool (e.g. `avatar_set_expression` — just `name`,
scoped by the tool name) is exempt. — Our precedent (added T2a G4): `play_motion`'s `priority`/`loop` carry
`.describe()`.

**S5. Keep the argument count small (Google <5; AWS ≤8) and prefer primitives over nested objects.**
`[GOOG]` (<5, "stick to primitives") `[AWS]` (≤8); `CLAUDE.md` caps TS fn params at 3. — Our precedent: max is
`play_motion`'s 3; all params are primitives.

**S6. Poka-yoke: shape arguments so mistakes are structurally hard (e.g. require absolute paths, not relative).**
`[A-BEA]` ("Change the arguments so that it is harder to make mistakes"; the absolute-filepath fix — "the model used
this method flawlessly"). — Our precedent: the 1e runtime enum is exactly this — a stale/hallucinated name is not
expressible as a valid arg (`./agent-runtime.md` 1e).

**S7. STRICT-READY authoring (write now, enable later): author every object schema to render all-properties-`required` +
`additionalProperties:false`. Prefer a required field with a documented default MEMBER over `.optional()` for a would-be
optional; a genuine optional ships only with a logged exemption.** `[O-SO]` `[O-FC]` (strict requires
"`additionalProperties:false` on every object, all properties in `required`"; "we recommend always enabling strict mode")
`[A-STRICT]`; DeepSeek strict imposes the same requirement and documents no `null` type — all three providers converge on
this intersection (see C-2). Provider-strict *enablement* is deferred → **D40**; author to the shape now so it becomes a
config flip, not a refactor.

> **Stack caveat (T2a, empirically verified by rendering the installed `asSchema` — the m5 §A3 method): under AI SDK 7 +
> zod v4, `.default()` renders a field INPUT-OPTIONAL** — the property gains a `"default"` annotation but stays OUT of
> `required`. So `.default()` does NOT by itself achieve strict-ready. The only way to land a defaulted field in
> `required` is to drop the default and force the model to emit it every turn — a UX/semantic regression. A field that
> must stay genuinely omittable while the wire stays all-required therefore has no clean encoding on our stack today:
> ship it `.optional()` with a logged exemption. **Precedent + exemption:** `avatar_play_motion`'s `priority`/`loop` are
> two engine knobs that must stay omittable (omission = today's normal one-shot); they remain `.optional()` under a
> logged exemption (**D40**), while `additionalProperties:false` is already met and every other property is required.
> `avatar_set_expression` and `screenshot` are strict-ready as authored.

**S8. Provider function parameters must render a root `type: "object"`.** Inspect the installed SDK's
`asSchema(inputSchema).jsonSchema`; accepting inputs in Zod does not establish provider compatibility. Keep domain
unions where they belong and normalize a separate strict object-shaped tool input at the execution boundary.
`heartbeat_respond` uses all-required nullable fields with outcome-specific validation, then maps into its unchanged
persisted decision union. C3 real DeepSeek compatible-endpoint evidence accepts this non-strict wire shape and rejects
the former untyped root `oneOf`; nullable support in that endpoint is not proof of DeepSeek strict-mode support (D40).

## R — Result & error

**R1. Never-throw `execute`: every failure degrades into a structured `{ok:false, code, message}` the model can read;
codes are a closed union in `@taki/shared`.** Our `./error-handling.md` (the primary source); industry mirror — OpenClaw
normalizes all execute failures to a result and only re-throws on abort `[OC-ADAPT]`; Hermes `dispatch` catches
everything and returns `{"error": …}` via `tool_error()`/`tool_result()` `[H-REG]`. — Our precedent: every tool's
`execute` try/catch returns `{ok:false, code:"INTERNAL_ERROR", message}`; routed capability errors carry real codes
(`PERMISSION_DENIED`, …) from `routeCapability`. Add new codes to the `@taki/shared` union, never inline strings.

**R2. Error messages are prompt-engineering: state SPECIFICALLY and ACTIONABLY what to change — not an opaque code or
traceback. For a bad enum, list the valid values.** `[A-WTA]` ("communicate specific and actionable improvements, rather
than opaque error codes or tracebacks"; e.g. "The `user_id` parameter must be a valid UUID. Example: …") `[AWS]`
("search requires 2+ terms" beats "no results"). Scope: this bites where the model CAN act. A genuine INTERNAL failure
(the model has nothing to change) legitimately returns `INTERNAL_ERROR` + the raw cause — do not churn those branches.
— Our precedent: the model-actionable path (an out-of-vocabulary `name`) is already actionable *via the schema* — the 1e
enum list is in the tool spec and an out-of-enum arg becomes a readable `tool-error` the model self-corrects on
(`./agent-runtime.md` 1e).

**R3. Return only high-signal context; prefer semantic fields over low-level identifiers (`name`/`file_type`/`image_url`,
not `uuid`/`mime_type`/`256px_url`).** `[A-WTA]`. — Our precedent: `screenshot` returns `{path, width, height, bytes,
description?}`; `process_list` returns `{processes, count}`.

**R4. Result budget: cap/truncate large outputs with a machine-readable `truncated` flag and a sensible default; tell the
model how to narrow.** `[A-WTA]` ("we restrict tool responses to 25,000 tokens by default … make many small, targeted
searches") `[H-FT]` `[H-REG]` (`max_result_size_chars` per tool). — Our precedent: `exec` truncates Shell-side with a
`truncated` flag in `ExecOutput`. A general per-tool result budget (e.g. `process_list`/`clipboard_read` are currently
unbounded) is capability/Shell-side hardening → **T2b**; state the rule now.

**R5. Sanitize tool text before it re-enters the transcript when it can carry open-world content: strip role/framing
tokens, cap length (defense-in-depth against injected framing).** Hermes `_sanitize_tool_error` strips `</tool_call>`-style
tags, code fences, CDATA, caps at 2000 chars `[H-MT]`, applied on the dispatch error path `[H-REG]`. Injection surface is
low for first-party/Shell-mediated outputs; this is a **forward rule** for open-world tool outputs. — Landed since
(T3b): the one open-world output we ship, the screenshot VLM description, now leaves `screenshot-tool.ts` only
PII-scrubbed and A1-fenced (`safeDescription`; scrub-then-fence, see `agent-runtime.md`), which covers the framing-token
half by construction. The LENGTH cap and a generic sanitizer for FUTURE open-world tools (web fetch) stay unbuilt —
state the rule now, build it with the tool that needs it.

## I — Idempotency / risk labeling

**I1. Label each tool's risk/retry posture with the MCP annotation vocabulary — `readOnlyHint` (modifies?),
`destructiveHint` (destructive vs additive?), `idempotentHint` (safe to call again?), `openWorldHint` (reaches an
external/untrusted world?).** `[MCP-ANN]` `[MCP-SPEC]`. Defaults are deliberately cautious (worst-assumed):
`readOnlyHint=false`, `destructiveHint=true`, `idempotentHint=false`, `openWorldHint=true`. **In T2a this is a
POS-header convention, not runtime enforcement:** each tool states its posture in prose in the `POS:` tag of its
module-contract header (e.g. avatar tools — readOnly, non-destructive, closed-world; `screenshot` — readOnly,
open-world VLM output, gated). Machine-readable runtime annotations → **T2b**. Annotations are documentation/UX only;
canonical identity plus Core policy remains authoritative, and a Host-owned action additionally crosses the Host's
trusted classifier/final boundary (see C-5 and `permission-authorization.md`).

**I2. `idempotentHint:true` ⇒ safe to retry on failure; a non-idempotent side-effecting tool must NOT be blind-retried.**
`[MCP-ANN]`; our `./error-handling.md` states the same ("Retrying a side-effecting action without an idempotency check"
is under "What must never happen"). I1's header posture is where each tool declares this.

**I3. Hints are NOT guarantees — keep real safety in deterministic controls; separate read tools from write tools for a
clean consent model (never hide a destructive action behind an `action` param).** `[MCP-ANN]` ("keep your actual safety
guarantees in deterministic controls") `[GOOG]` (read/write separation). — Our precedent: deterministic safety is the
canonical Core evaluator plus the owning Execution Host's stricter final enforcement; `clipboard_read`/
`clipboard_write` and `screenshot`(read)/`exec`(write) are separate tools, and each resolves an explicit capability
descriptor rather than deriving authority from its hint.

**I4. Retry only classed-transient failures; a deterministic failure fails fast with actionable guidance and never burns
retries.** Hermes `error_classifier.py` — a `ClassifiedError` carries `retryable`; deterministic cases (content-policy
block, cert-verify, unknown-parameter 400, model-not-found) return `retryable=False` so the loop stops `[H-EC]`. — Our
precedent: the AI SDK invalid→tool-error path is our self-correction (`./agent-runtime.md` 1e). Scale note (from `[A-WTA]`
metrics + m5 §C1): the SDK has **no consecutive-failure brake** — a tool failing identically N steps burns N of
`maxSteps`; a loop-safety review asks "does the error change across repeats?".

## B — Birth checklist

**B1. Classify at birth: presentation (returns only a Presentation Outcome, name into `PRESENTATION_TOOL_NAMES`) vs
informational (the loop must continue).** Our `./agent-runtime.md` "Classify every tool" (T1 1c); industry mirror = MCP
read/write separation `[GOOG]`. — Our precedent: `avatar/presentation-stop.ts` + `PRESENTATION_TOOL_NAMES`; an
informational tool must NEVER enter that set (a step co-calling it last would stop the loop with its result unread).

**B1a. A presentation tool returns the Presentation Outcome, never a publication ack (D80, 2026-09-19).** Its
`execute` publishes with a Core-generated `commandId`, awaits `avatar-outcomes.ts` (bounded by
`TAKI_AVATAR_OUTCOME_DEADLINE_MS`; instant `not_rendered` with zero subscribers; `unknown` on deadline or turn abort)
and returns exactly one of: `{ok:true, outcome:"applied"|"not_rendered"}`, `{ok:false, outcome:"rejected",
code:"AVATAR_REJECTED", reason}`, `{ok:false, outcome:"superseded", code:"CANCELLED", state:"cancelled"}`,
`{ok:false, outcome:"unknown", code:"OUTCOME_UNKNOWN", state:"outcome_unknown"}` (`avatar-tool-result.ts`). The
description states that a busy rejection is normal and must not be retried or apologized for (D3). Never queue,
escalate priority, or re-publish on a rejection; `toolCallId` is correlation only, never the command identity.

**B1b. One correction per turn for an invalid presentation call (D69).** `presentationTailStop` does not stop on a
step whose presentation call carries the SDK `invalid` marker, so the model reads the validation error once; a second
invalid presentation step in the same turn stops. A VALID call stops as before regardless of its outcome — a
rejection is never a reason to re-generate.

**B2. One tool per `x-tool.ts` exporting `createXTool(deps): ToolSet`, wired at exactly one registry site; the handler is
thin — it delegates to a capability client / subscription, no business logic inline.** Our `CLAUDE.md` (naming +
anti-sprawl + "commands/tools are thin"; invariant 7); Hermes self-registers one schema+handler per tool file via
`registry.register()` `[H-REG]`; OpenClaw one `create*Tool` per file `[OC-CAT]`.

**B2a. Bind governance at birth: every executable tool must resolve a trusted canonical capability identity and one
registered cell before the model can call it.** Core tools use the explicit Core binding table; Host tools route through
the Host catalog plus Core projection; MCP tools retain the raw SDK closure beside a stable Host-qualified subject;
Skill instructions never transfer their own `skill.load` posture to later actions. An unknown Core binding, duplicate
registry identity, ambiguous MCP sanitized-key collision, or mismatched Host descriptor is fail-closed. See
`permission-authorization.md` for signatures, precedence, errors, and tests.

**B3. Progressive disclosure at scale: below a threshold keep all tool defs in context; above it, defer non-core tools
behind a search/describe/call bridge — use a context-fraction trigger, do NOT invent a fixed N.** `[A-WTA]`
(deferred loading); Hermes defers non-core (MCP/plugin) tools behind `tool_search`/`tool_describe`/`tool_call` once the
deferrable surface exceeds ~10% of the context window, never deferring core tools `[H-MT]`; OpenClaw scopes via tool
profiles `minimal|coding|messaging|full` `[OC-CAT]`. — Our status: skills are lazy via `load_skill`; MCP tools all enter
the per-turn ToolSet — fine at current N, revisit at scale. Note the trigger; no action now.

## Rulings on cross-source conflicts (our calls)

**C-1. Consolidate siblings into fewer tools (`[A-WTA]` `[A-DEF]`) vs our two avatar tools → KEEP THE SPLIT.** Anthropic
pushes "a few thoughtful tools", but equally requires "each tool a clear, distinct purpose", and `[GOOG]` wants read/write
(here expression vs motion) separation. `avatar_set_expression` and `avatar_play_motion` have distinct vocabularies
(expressions ≠ motions), and the presentation taxonomy (B1) + 1e enum (S1) hang off the tool *name* — one blurred
`avatar_express(kind,…)` tool would lose both. Justified divergence; keep it documented here.

**C-2. Optional params: OpenAI strict FORBIDS them; DeepSeek strict has no `null` type; MCP/Anthropic non-strict and
OpenClaw TypeBox ALLOW them → ADOPT THE STRICT-READY INTERSECTION (S7).** Prefer all-required with a documented default
member; permit a genuine optional only with a logged exemption. Costs nothing today, keeps token-level strict a
per-provider config flip (D40).

**C-3. Naming case (`[A-WTA]`/`[ARCH]`/`[GOOG]` snake_case; `[GEO]` allows either; OpenClaw lowercase single words)
→ MANDATE snake_case `verb_object` (N1).** Single-word names allowed only for a universally-understood primitive
(`exec`, `screenshot`), which will need a verb at scale.

**C-4. Enum encoding (OpenClaw warns against `Type.Union`, mandates a `stringEnum` helper; OpenAI/Anthropic strict enforce
plain JSON-Schema `enum`) → author enums as `z.enum`, never a hand-rolled union (S2).** Both camps want a plain
`{"type":"string","enum":[…]}` on the wire; `z.enum` emits exactly that, so we inherit provider portability for free.

**C-5. "Hints drive auto-approval" (`[MCP-ANN]`) vs our fail-closed governance → annotations are DOCUMENTATION/UX
ONLY; canonical Core policy is the global authority and a Host may only tighten at its final boundary
(`permission-authorization.md`; `./error-handling.md` fail-closed).** MCP is explicit that annotations are untrusted
hints, not enforcement. Neither an MCP annotation, a server description, Skill metadata, nor a model-facing tool key
selects a looser descriptor/posture. Standard MCP transport and raw-name execution remain unchanged.

## Sourced exemptions (do not "fix" these)

- **`exec`'s single opaque `command` param** vs the explicit-named-params guidance (S4/S6): defended by `[A-BEA]`'s own
  format guidance — "Keep the format close to what the model has seen naturally occurring in text … no formatting
  overhead"; a raw shell command string is the most model-natural encoding. Decomposing `command` would also move the
  trusted argument classifier out of the owning Host. `exec`'s output already satisfies R3 (semantic result) + R4
  (`truncated` flag) + D3 (result semantics in the description). Nothing in this standard argues to change `exec` input
  or output — leave it untouched.
- **`shell_open`'s http/https/mailto scheme constraint** stays a description constraint enforced Shell-side, not a schema
  `enum` (S1) — `target` is a full URL/path, not a clean finite set; enforcement is deliberately Shell-side governance,
  same rationale as `exec` (→ T2b).
- **`avatar_play_motion`'s `priority`/`loop` optionals** — the S7 strict-ready exemption above (→ D40).
