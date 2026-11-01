# Idle inbox yield: real final-review failure and bounded recovery assessment

## Real evidence

The completed failing campaign is retained at
`target/agent-delegation-20261030-validation/real-independent-final/goals-natural-delegation-3W0LLd/`.
Read-only SQLite inspection and `result.json` establish 13 actual provider requests, all HTTP 200. Both children used
`request_parent`, completed with validated final output, and produced eligible final events. No completion was missing.

| UTC 2026-10-30 | Durable observation |
| --- | --- |
| 13:38:15.123 | Compatibility child Run `84c575f7-83b0-4afb-bb37-e3573f2e1a97` completed; final event `641b9f0d-de52-49ad-b06d-b1286450f077`, 1011 characters |
| 13:38:23.370 | Its idle consumer accepted a `speech_proposed` action |
| 13:38:23.544 | The first report was actually sent and inserted at Timeline seq 9 |
| 13:38:35.709 | Migration child Run `8302ece0-059a-415a-ad0f-c60e3aeed59c` completed; final event `40596a23-fd31-4d34-9fb0-b5fb63cb5047`, 1924 characters |
| 13:38:35.784 | Idle consumer `bde65f0d-4472-44ca-ace7-4886ac5b7bb1`, Run `d721e488-eaef-41de-aa6b-046fd7dff123`, delivered the second event at model intent |
| 13:38:35.847 | The foreground request to combine returned reviews was admitted/queued while that model request was in flight |
| 13:38:37.616 | Idle model completed with `finishReason=tool-calls` |
| 13:38:37.627 | Its only tool, `read_agent_inbox`, completed successfully; exact second body returned in full, `nextOffset=null` |
| 13:38:37.637 | Idle Run completed, but its consumer became `reconciliation_needed`; no handling action exists for event 2 |
| 13:38:37.647 | Foreground Run `967117b9-c50b-480d-9f82-0076be6e12c9` started |
| 13:38:47.984 | Foreground inspection was followed by an actual public combined answer at Timeline seq 13 |
| 13:41:48.643 | Fixture teardown cancelled the still-open second original-request report root, not the already-completed child Run |

The second handler has exactly one model Effect and one `core.subagent.read` tool Effect. Both are terminal and
completed, without error codes. It has no state-changing tool, unknown Effect or event action. Its main step cap was
10, so a one-step handler did not hit the cap. No successor appears in `subagent_inbox_resumes`.

The assertion correctly reports one handled final out of two because `waitHandled` counts actual action/consumer/
delivery/Effect joins, not public prose. The final answer nevertheless exists: Timeline 13 combines compatibility
and migration findings, explicitly distinguishes synthetic external reviewers from the user's personal experience,
and labels unavailable case facts as unknown. It does not claim these synthetic cases happened to the user.

## Exact cause

The following inspected files match their hashes in the retained `sourceAfter` manifest:

- `packages/core/src/main.ts:433` registers the primary reservation callback; line 436 calls `yieldInbox`.
- `packages/core/src/agents/turn-queue.ts:52` reserves primary before admission/awaited lane acquisition.
- `packages/core/src/harness/subagent-inbox-execution.ts:57` marks a live handler `yieldRequested`; line 189 stops at
  the next completed SDK step when that flag is set, regardless of whether the event has a disposition.
- `packages/core/src/agents/agent-attempt.ts:124` includes this work stop condition in the ordinary main step loop.
- `packages/core/src/db/subagent-inbox-terminal.ts:23` classifies delivered members with missing actions as
  `reconciliation_needed`, even when the outer Run completed normally.
- `packages/core/src/db/subagent-inbox-repo.ts:92` excludes members of non-released consumers from fresh claims.

This is a known cooperative yield at a successful read-only step boundary. It is not policy suppression, transport
failure, missing child output, unknown execution outcome, or the model naturally stopping after a final text answer.
The yield flag itself is process-local; its value is established here by the production reservation wiring plus
the recorded timing/step facts, rather than a separate durable yield-reason event.

## Contract assessment

The existing fail-closed fence is correct: delivered events must not be reset/requeued as fresh work. But normal
foreground interaction turning a known safe yield into indefinite manual reconciliation is a product gap against
PRD requirements 1/2 and the bounded-eventual-handling acceptance criterion. A public combined answer does not repair
the missing durable disposition, and removing the race from the fixture would conceal that gap.

`assertSubagentInboxResumable` already checks Character scope, quiescence, absence of unfinished/unknown non-model
Effects and absence of an existing non-released successor. Existing explicit resume captures fresh authority and
creates a linked same-batch successor with prior action evidence, preserving original intent/action identities.
Its unknown-effect refusal and transactional duplicate protections must remain intact.

A minimal candidate for independent design review is narrowly scheduling this existing lineage after a **known live
cooperative yield**, not broad automatic retry of every `missing_disposition` consumer. Require a successfully recorded
safe frontier, no cancellation/error/unknown non-model Effect, and factual yield ownership. Preserve foreground lane
priority, one stable successor operation per predecessor, and finite retry behavior. Natural no-action termination,
errors, unknown effects, user Stop, lost authority and unclassified restart outcomes retain explicit reconciliation.
If restart must resume a yielded handler automatically, its yield classification needs a durable trusted witness;
it cannot be inferred later merely from `completed` plus missing actions.

The resumed handler must not duplicate an answer already published during the foreground turn. Existing accepted
actions must never repeat, source/publication grants must not be reconstructed, and foreground fulfillment versus
pending publication needs an explicit regression. The current positive probe tests `retained`, not this publication
edge; the advisor/coordinator must resolve it before choosing implementation scope.

## Deterministic probe and limits

`target/agent-delegation-20261030-validation/idle-inbox-yield/probe.mjs` reproduces the state with a local scripted SDK
model and real fixture SQLite/Run/Effect owners. It holds the idle request, reserves the foreground lane, calls the
same `yieldInbox` service port used by production, completes `read_agent_inbox`, and observes delivered +
`missing_disposition` with no automatically-ready event. Existing explicit resume then creates exactly one action and
one successor; a duplicate operation reuses it and original intent rows remain unchanged. Total scripted requests: 3
(child, interrupted idle read, explicit same-batch recovery). Output is retained in `idle-inbox-yield/observed.json`.

The initial inline harness omitted the fixture's absent `onAvailable` callback and exited with an unsettled wait;
the corrected probe explicitly mirrors both production notification ports. The fixture does not execute a real
foreground model turn; the paid campaign's retained trace separately proves that composition. No new paid request,
source/configuration/task mutation, user-data write or Git delivery occurred during diagnosis. Only research/probe
artifacts were added. No proposed automatic-yield resumption has been implemented or accepted yet.
