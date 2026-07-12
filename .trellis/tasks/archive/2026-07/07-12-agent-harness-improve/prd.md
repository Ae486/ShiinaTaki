# PRD — agent-harness-improve: turn-lifecycle fidelity (fix the hallucination root cause)

> Register anchor: **D1**. Upgraded from `agent-tool-timeline`. Blocks M4 #16/#17 (the chat window must render tool records).

## The core defect — tool-call hallucination

The agent fabricates "I already ran the screenshot / called the tool" while the logs show it did nothing. Root cause
is **not** the prompt — it's the timeline losing tool records across turns:

- `chat-agent.ts:69-77` iterates `result.stream` and accumulates **only** `part.type === "text-delta"`. The header
  comment states outright: *"Tool + approval parts are ignored on purpose — the streamed text is the persisted truth."*
- `conversation-store.ts:40-45` (`toModelMessage`) rebuilds history as **text-only** `ModelMessage`s (the design-1
  note: *"multi-part fidelity returns when tools land"* — tools landed in M3; this was never done → register D1).

So a turn's assistant tool-call parts and the tool-result messages are **never persisted**. On the next turn
`history()` hands the model a transcript where the tool call never happened → the model, seeing episodic memory that
references tool outcomes but no tool-call in the live transcript, hallucinates that it already acted. This only
surfaces in **multi-turn** use; single-turn empty-DB tests stay green (see e2e-harness spec).

## The five turn-lifecycle gaps (D1 set)

| # | Gap | Location | Consequence |
|---|-----|----------|-------------|
| 1 | **Tool-call/result dropped from timeline** | `chat-agent.ts:69-77`, `conversation-store.ts:40-45` | hallucination (above) — the blocker |
| 2 | **No base system prompt** | `chat-agent.ts:86` `composeInstructions` = memory context + skills only | no stable identity / tool-use / "report tool calls truthfully" floor; behavior drifts with memory content |
| 3 | **No turn serialization** | `chat-send.ts:33` `setImmediate(pump)` per send | concurrent sends for one characterId interleave appends & read each other's half-written history → corrupt transcript |
| 4 | **No cancellation/interrupt** | `agent.stream` gets no `abortSignal`; no `chat.cancel` WS method | a running turn can't be stopped (new message, UI close); wasted tokens, stuck turns |
| 5 | **Interrupted text not persisted** | `chat-agent.ts:77` `appendAssistant` runs only after clean completion | throw/abort mid-stream drops the already-streamed text → next turn the agent can't see what it just said |

## Design direction (per gap) — API confirmed by research/ai-sdk7-message-persistence.md (ai@7.0.17)

- **#1 — persist the full turn.** After the `for await` loop, `await result.responseMessages` yields the assembled
  `Array<AssistantModelMessage | ToolModelMessage>` (tool-call parts + tool-result messages + final text), oldest-first,
  **excluding** the user message (already appended). Persist it via a new `appendTurn(characterId, ModelMessage[])`;
  `history()` rebuilds the full multi-part `ModelMessage[]`. This forces the **data-model change** below.
- **#2 — base system prompt.** A stable constant prepended in `composeInstructions` (before memory context): identity,
  tool-use protocol, and an explicit *"never claim a tool ran unless a tool-result is in the transcript"* floor. Own
  file (anti-sprawl), small.
- **#3 — serialize turns per characterId.** A per-character async queue so a turn fully commits (append user →
  stream → append turn) before the next starts; different characters stay concurrent.
- **#4 — cancellation.** An `AbortController` per turn; pass `abortSignal` **per-call** to `agent.stream({messages,
  abortSignal})` (SDK omits it from the constructor). Abort does NOT throw — the stream emits a `{type:'abort'}` part
  then ends; add an `abort` branch to the loop. A `chat.cancel` WS method (+ existing `onClose`) triggers the abort.
- **#5 — persist partial text.** `try/finally`: on abort, `result.responseMessages` holds only fully-completed steps'
  tool messages; the interrupted step's partial text lives only in the local accumulator → persist it via
  `appendAssistant(..., partial)`. The transcript must never lie about what the user already saw.

## Data-model change (the core of #1 — goes through `@taki/shared` first, invariant 3)

Persisting tool messages requires extending the timeline storage model. Backward-compatible (old text-only rows read
as plain messages):
- **`@taki/shared` timeline-schema**: `TimelineRole` gains `"tool"`; `TimelineEntry` gains an optional structured
  `parts` field (zod discriminated union for `text` / `tool-call` / `tool-result`, mirroring AI SDK v7 shapes —
  `input`, `output: {type,value}`). `content: string` stays as the text projection (user text, assistant final text,
  a readable tool summary) for UI fast-render + episodic recall; `parts` carries the full fidelity for model replay +
  the M4 chat-window tool cards.
- **db timeline-repo**: `parts` persisted as a nullable JSON column; null = legacy text-only row.
- **conversation-store**: `appendTurn(characterId, ModelMessage[])` fans a turn's response messages into entries;
  `history()` reconstructs full `ModelMessage[]` from `parts` (falling back to text-only when `parts` is null).
  Consumers to check: `timeline-history`, `timeline-subscriptions`, `render-transcript` (episodic), `retriever`
  (recall query) — all must keep working off `content` while `parts` is additive.

## Acceptance (D1 requirement — this is the proof, non-negotiable)

Per the register's D1 acceptance note: build a **multi-turn hallucination-reproduction L2** as a *before-baseline*.
The existing 4 L2s (single-turn, empty-DB, strong-instruction) stay green even unfixed — they can't catch this.

- **Reproduction L2**: accumulate real tool calls across several turns (or seed a timeline polluted with verbal
  "success" but no tool records), then assert the agent's next turn does NOT hallucinate a prior tool call — it either
  re-invokes or correctly reports it hasn't run. **This test MUST be RED before the fix and GREEN after** — that red→green
  is the only proof the hallucination is actually cured.
- All gates green: `pnpm -r typecheck && lint && test`, `cargo test` + clippy (if Rust touched — likely not), e2e suite.
- No architecture invariant violated (timeline still Core-owned single-writer; protocol shape changes go through
  `@taki/shared` zod first if TimelineEntry gains structured content).

## Scope / sequencing (owner-ruled 2026-07-12)

All five gaps are **one task, one implementation pass** (a single implement agent — do NOT split into two impl runs;
that wastes resources). Delivered in **two commits**:
- **Commit 1 (core, unblocks M4)**: #1 persist full turn + #2 base system prompt + #5 partial-text persist, plus the
  red→green multi-turn hallucination L2. This is the blocker kill.
- **Commit 2 (hardening)**: #3 per-character turn serialization + #4 cancellation/interrupt.

Compaction/token-budget stays **out of scope** (register D4, ADR 0005 — `REPLAY_WINDOW=200` hard cut).

## Out of scope (defer → docs/deferred-decisions.md)
- Context compaction / token budgeting (D4).
- Emotion/companion-state provider wiring (D9) — separate "角色真实感" task.
