# Time awareness: hybrid date/time injection + get-current-time tool + memory age

## Goal

The agent currently has ZERO time signal (verified 2026-07-21: no datetime anywhere in the system
prompt; the assembler uses `now` only for expiry filtering and never renders it; replayed timeline
turns carry no time labels). Consequence: "good morning" at 2am, stale memories treated as fresh,
and T4 (heartbeat/cron) — which HARD-depends on time sense — is unbuildable. This task lands the
owner-ratified HYBRID shape (2026-07-21, evidence-grilled against research/time-awareness-survey.md).

## Owner-ratified decisions (all 2026-07-21)

* **Hybrid shape, five pieces in this task** (the owner's pull-only hypothesis was honestly evaluated
  and set aside: Hermes shipped a wall-clock-injection fix for "good morning at 3 PM"; 4 Claude Code
  issues document that models never proactively run `date`):
  1. Day-granularity date line in the STABLE system-prompt prefix (changes once a day — cache-safe).
  2. Minute-granularity current-time line at the prompt TAIL (after the already-per-turn-varying
     sections — marginal cache cost ~zero).
  3. `get-current-time` native Core tool (pure `new Date()`; NOT a capability — no OS crossing, no
     Gate, no approval) for precision/timezone pulls.
  4. Memory entries render RELATIVE age ("3 days ago") computed by code at assembly — models
     miscompute date arithmetic; never make the model do it.
  5. T4 heartbeat wall-clock: INTERFACE SHAPE ONLY (a render export); implementation lands in T4.
* **System-prompt awareness norms are OUT** (moved to T4): all prompt-discipline wording waits for
  T4's dedicated Hermes/OpenClaw prompt-design research pass and lands as ONE optimization there.
  This task does not touch base-prompt.ts wording beyond inserting the date/time lines.
* **PROVIDER-NEUTRALITY (hard principle, memory `takiagent-provider-agnostic-principle`):** the
  feature is provider/environment-agnostic — plain strings + a standard AI SDK tool; switching
  upstream never breaks it. "Stable-early / volatile-late" is adopted as a UNIVERSAL rule, not
  DeepSeek tuning. ZERO provider-conditional code; no provider-private cache-control APIs. The
  DeepSeek-doc check is demoted to "confirm the cost optimization applies" — a cost note, never a
  design input. Framework-first: verify what AI SDK 7 already offers before building anything;
  `composeInstructions` is the framework-native assembly point — no new infra.

## Requirements

* NEW `packages/core/src/time/` module (single home for ALL time rendering — no more scattered
  `new Date()` for prompt purposes): `time-context.ts` with day-date line renderer, current-time
  line renderer, relative-age formatter, and a wall-clock render export reserved for T4. Injected
  clock, pure, OS-neutral, fully unit-tested.
* `composeInstructions` (chat-agent.ts): day-date line directly after BASE_SYSTEM_PROMPT (stable
  within a day); current-time line at the tail of the composed instructions.
* NEW `packages/core/src/time/current-time-tool.ts` (one tool per file, `x-tool.ts` convention,
  tool-design spec compliant: 3-4 sentence description incl. when-NOT-to-use, strict-ready schema,
  structured never-throw result) + one registration line in main.ts tools bag.
* `memory/assembler.ts` renderBlock: entries render `(3 days ago)`-style relative age from
  `createdAt`. SMALL surgical change — D28 constraint (memory-touching code stays low-coupling;
  do not restructure the assembler).
* Timezone: the user's local OS timezone via standard Intl/Date — OS-neutral, works on Windows and
  Ubuntu (invariant 8).
* Zero changes to: Rust shell, @taki/shared, DB, ws protocol.

## Pre-coding verification duties (owner hard rule: never code from memory)

* AI SDK 7: confirm against installed node_modules types/docs how tools are declared in v7 and
  whether any built-in prompt-assembly/caching mechanism is relevant (framework-first check).
* DeepSeek prefix-cache doc check — as a COST note only (confirm stable-early/volatile-late pays
  off there too); regardless of the answer the design does not change.

## Acceptance Criteria

* [ ] Composed instructions contain a day-date line right after the base prompt and a current-time
      line at the tail (unit test with injected clock; assert ordering).
* [ ] Same-day recomposition changes ONLY the tail time line, never the date line (cache-shape test).
* [ ] `get_current_time` tool returns a structured `{ ok, iso, local, timezone, ... }`-style result;
      never throws; registered in the tools bag.
* [ ] Memory blocks render relative ages; boundary cases (minutes/hours/days/months) unit-tested;
      the age is computed by code, not left to the model.
* [ ] Zero provider-conditional code (grep-clean for provider names in the new module).
* [ ] `packages/core` stays OS-neutral; all new tests synthetic-clock driven.
* [ ] pnpm --filter @taki/core test + pnpm -r typecheck + pnpm lint green (no cargo — Rust untouched).

## Out of Scope

* System-prompt time-discipline wording (awareness norms) → T4 prompt-design pass.
* Heartbeat wall-clock IMPLEMENTATION → T4 (only the render export ships here).
* Timestamps on replayed history turns → evaluate at T4/compaction work (survey notes boundary
  re-stamping as a cheap complement; not ratified for this task).
* Timezone configurability → #26 if ever needed (local OS tz is the v1 truth).

## Technical Notes

* Research bank: `research/time-awareness-survey.md` (folded from workspace; Hermes date-only-in-
  cached-prefix + anti-churn comment; OpenClaw tz-only + envelope timestamps; cache economics;
  §OMITTED caveats: local Hermes checkout predates its wall-clock fix PR; DeepSeek semantics
  unverified — hence the cost-note check above).
* Anchors: `agents/chat-agent.ts::composeInstructions` (the single join point, ruling 10),
  `agents/base-prompt.ts` (BASE_SYSTEM_PROMPT const — do not reword), `memory/assembler.ts::renderBlock`,
  `main.ts` tools bag (~:241-248).
* Conventions: module-contract headers, index.md rows (time/ NEW, core/src, agents/ if touched,
  memory/), kebab-case, file<=300/fn<=50/params<=3, colocated tests.
