# Agent Runtime — turn persistence & anti-hallucination

Hard-won from D1 (the tool-call hallucination that shipped). These are invariants for the chat loop, not style.

## A turn's tool records MUST be persisted, not just its text

The agent acts only through tools; if a turn's **tool-call and tool-result** messages are dropped from the timeline,
the next turn replays a transcript where the action never happened — and the model, primed by episodic memory that
references the outcome, **fabricates that it already acted**. This surfaces only across multiple turns.

- Persist the full turn tail (`await result.responseMessages` in AI SDK v7 — assistant-with-tool-calls + tool-result
  messages + text), never text-only. The store's `content` string may stay a readable projection, but structured
  `parts` (tool-call `input`, tool-result `output`) must survive the DB round-trip for faithful model replay.
- `history()` reconstructs the full multi-part `ModelMessage[]`. A window cut that strands a leading `tool` row
  (its assistant tool-call fell outside the window) is invalid replay input — drop leading orphan tool rows.
- Any storage model that can't hold tool messages is a latent hallucination bug. If you defer tool fidelity, it goes
  in `docs/deferred-decisions.md` with a trigger — a bare code comment is exactly how D1 became a permanent defect.

## The base system prompt carries a truthfulness floor

The stable base prompt (before per-turn memory context) must state, explicitly, that the model may **never claim a
tool ran / a result was obtained unless a matching tool-result is present in the transcript** — earlier text is not
proof. This is the direct behavioural guard; persistence is the structural one. Ship both.

## Test the deterministic root cause, not the probabilistic symptom

Behavioural hallucination (the model skipping a tool call) is **probabilistic** — you cannot pin it in a green/red
test. The *root cause* is deterministic: a pre-fix store drops the `tool` record every time. So a hallucination
reproduction test (a real-agent L2 seeded with a transcript polluted by verbal "success" but no tool records) must
hinge its red→green on the **persisted tool record**, not on the model's behaviour that run. A single-turn empty-DB
test cannot catch this — see [E2E Harness](./e2e-harness.md). The test must be RED against pre-fix code (prove it by
reverting the fix) or it proves nothing.
