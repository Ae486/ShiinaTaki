# T2a — Tool design standards + schema/error hardening

M5 task (blueprint T2 split, part A). Owner-aligned 2026-07-20. Establishes an authoritative **tool design standard** (governance contract) every future tool follows as the tool count grows, plus light hardening of current tools. Grounded in the BANGCLAW north star (`PRODUCT.md`): design for broad capability growth, reference 龙虾/马 + Anthropic/OpenAI, never invent.

## Hard constraint (owner-directed 2026-07-20)

The tool design standard MUST be **templated from AUTHORITATIVE sources** — Anthropic tool-use best practices, OpenAI function-calling guide, OpenClaw(龙虾) / Hermes(马) actual tool design, MCP conventions — **NOT self-invented**. Every rule in the standard cites its source. This is why implementation is GATED on a research pass first: no rule ships without a citation.

## Context (verified盘点 2026-07-20 — this is固化+轻补, not a rewrite)

Current tools already conform broadly (leader盘点 + `m5-tool-governance-survey.md`): zod `inputSchema` (事前规范 + 事后校验), never-throw structured errors with a closed code union in `@taki/shared`, tool descriptions, exec returns the full shell result (`exitCode/stdout/stderr/timedOut/truncated` — the model reads stderr to self-correct), dynamic enum (avatar 1e), presentation/informational taxonomy (1c). Gaps: schema-constraint fullness uneven, error messages not uniformly actionable, description discipline (when-not-to-use / sibling refs) missing.

## Scope

### 1. Research — front-loaded, gates everything below
A `trellis-research` pass produces `research/ra-tool-design-templates.md`: authoritative tool-design templates from Anthropic / OpenAI / OpenClaw / Hermes / MCP, **each rule with a citation**, rendered as a directly-liftable spec draft. Deepens `m5-tool-governance-survey.md` §B (gap table) into sourced, templated rules.

### 2. The tool design standard — spec, written FROM the research
New `.trellis/spec/backend/tool-design.md` (the governance contract every NEW tool follows; each rule sourced):
- **schema 事前规范**: enum for finite sets, ranges, per-field descriptions (LLM fills right the first try), param caps.
- **事后校验** (zod — existing, formalize).
- **error 可行动化**: the error tells the LLM WHAT TO CHANGE (e.g. "expression X not found; available: a, b, c"), not just that it failed.
- **never-throw + closed error code union** (existing,固化).
- **presentation / informational taxonomy** (link `agent-runtime.md`).
- **description discipline**: when-NOT-to-use, sibling cross-refs.
- **strict-ready authoring rule**: write schemas that render all-required + `additionalProperties:false` so provider structured-output is a config flip later (actual enablement deferred → D40).
Add a row to the backend spec index.

### 3. Light hardening of current tools — touched-file only (Q1 contract)
Apply the standard to current tools where a real gap exists:
- audit avatar + capability tools for finite-set params lacking `enum` and error messages lacking actionability; fix in place.
- **exec core untouched** — output is complete (stderr回传达标), opaque `command` input is deliberate (governance is Shell-side).

## Exclusions
- exec core (output/input) — untouched.
- Capability expansion (龙虾/马-style breadth) → T2b + later milestones.
- provider strict actual enablement → **D40** (write strict-ready schemas now, flip when DeepSeek strict leaves Beta).
- Permission治理 (Permission Level, dir authorization, pipe/shell-mode approval class, argv[0]/D3, NL-authorization governance) → **T2b**.

## Acceptance
1. Research bank exists; EVERY standard rule cites an authoritative source (zero invented rules — owner hard constraint).
2. `tool-design.md` spec written + indexed.
3. Current-tool gaps (enum / actionable errors) closed WITHOUT touching exec core; gates green (`pnpm -r test/typecheck/lint`).
4. strict-ready authoring rule stated; provider-strict enablement correctly deferred to D40.
