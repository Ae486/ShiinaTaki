# PRD — Avatar command outcome and tool-contract repair (D80/D69)

## Status: planning (owner authorized this task on 2026-09-19 as the first step of the post-Lab avatar route)

## Problem

`avatar_set_expression` / `avatar_play_motion` return `{ok:true}` as soon as the command is published; the Pet UI
discards the engine's result. The Lab reproduced (`archive/2026-09/09-03-avatar-presentation-lab/research/
production-command-findings-2026-09-08.md`) that repeating the current expression, playing a NORMAL motion over a
NORMAL motion, and issuing two expressions without awaiting all return `false` in the engine while the agent, the
Chat feedback and the Monitor all report success (D80). Separately, an avatar call whose `name` fails schema
validation after the turn already produced text ends the loop before the model can read the error
(`research/ai-sdk-invalid-tool-calls.md`, confirmed by an executable probe against ai@7.0.17) (D69).

## Owner decisions (grill, 2026-09-19)

1. **Bounded wait for the Presentation Outcome.** The tool waits for the Pet UI's report up to a configurable deadline
   and returns the truthful outcome; no Pet UI → `not_rendered` immediately; deadline or turn abort → `unknown`.
2. **Reject truthfully; never escalate or queue.** A busy/speaking engine rejects the command; the outcome says so.
   Agent motions keep NORMAL by default; no automatic FORCE, no renderer queue.
3. **One correction chance for an invalid call.** `presentationTailStop` does not stop on a step whose avatar call
   failed validation; the model reads the error once. A second invalid avatar step in the same turn stops. Valid
   calls stop as today regardless of outcome (a rejection is never a reason to re-generate).
4. **Tool contract stays; outcome path is contract-neutral.** Inline `[tag]` markup is re-decided before #31 (D81).
   The command id is Core-generated; `toolCallId` is only correlation.

The owner also stated the principle that prompt and tool design should prevent invalid calls in the first place;
that is the vocabulary work in `docs/AVATAR-PRESENTATION.md` §4 (C-series), not this task.

## Glossary

`CONTEXT.md`: **Avatar Command**, **Presentation Outcome**. Outcomes: `applied`, `rejected` (reason
`motion_busy | speaking | already_active | unknown_name | unavailable`), `superseded`, `not_rendered`, `unknown`.

## Requirements

- R1 Every Avatar Command carries a Core-generated `commandId`; the Pet UI reports one Presentation Outcome per
  command it receives, through an operator method, after the presentation gate released it.
- R2 The tool result is the Presentation Outcome. `applied`/`not_rendered` are successes; `rejected` is a failure
  with a machine-readable reason; `superseded` maps to cancelled; `unknown` maps to outcome-unknown. The Chat tool
  card and the Monitor `tool.result.settled` event reflect that classification through the existing outcome seam.
- R3 The wait is bounded by a visible configuration value (default 1000 ms), resolves early on the first `applied`
  or when every subscriber has reported, resolves to `unknown` on turn abort, and never blocks when no Pet UI is
  subscribed. Late reports are ignored without error. Pending entries are bounded in memory.
- R4 The Pet UI classifies rejections best-effort from engine state observed before the call (priority reservation,
  speaking audio, current expression, a newer same-kind command) and never throws; an unknown name still triggers
  the vocabulary self-heal re-report. A retired model generation reports nothing.
- R5 `presentationTailStop` implements decision 3 with the SDK's `invalid` marker; existing express-first behaviour
  (no stop before text) is unchanged.
- R6 Tool descriptions explain the outcomes: a busy rejection is normal and must not be retried; `not_rendered` is
  fine; the model should not apologize for either.
- R7 No new run-event kind, no protocol method for Home, no Rust change, no engine default change, no dependency.
  The lab's reproduced engine cases become renderer unit fixtures with a fake model.

## Acceptance criteria

- [ ] AC1 (R1/R2) With a subscribed Pet UI, a repeated expression yields `rejected/already_active`, a NORMAL motion over
  a playing NORMAL motion yields `rejected/motion_busy`, two expressions in one step yield `superseded` then
  `applied`; the model-visible tool results, Chat card status and `tool.result.settled` agree.
- [ ] AC2 (R3) No subscriber → `not_rendered` without waiting; a silent subscriber → `unknown` at the deadline; turn
  cancellation → `unknown` immediately; a report after resolution is dropped; two subscribers where one applies → `applied`.
- [ ] AC3 (R4) Renderer classification unit tests cover busy, speaking, already-active, superseded, unknown name and
  unavailable using fakes; a stale generation never reports.
- [ ] AC4 (R5) Probe scenarios: text + invalid avatar call → second model request happens; two consecutive invalid avatar
  steps → stop; valid call with `rejected` → stop; no text + invalid call → no stop (unchanged).
- [ ] AC5 (R7) `git diff --stat` shows no Rust, engine config or dependency change; run-event schema unchanged.
- [ ] AC6 Workspace typecheck, lint, Shared/Core/Desktop tests, Desktop build and a real Core boot pass; a real-process
  E2E drives one avatar tool call through a fake operator client reporting an outcome.
- [ ] AC7 Owner observation with the packaged Pet: an expression change shows "已应用" in Chat; a second motion during
  a motion shows the rejection wording. Automated evidence is not relabelled as this observation.

## Out of scope

Inline tags (D81), vocabulary filtering/glosses (§4), motion queueing, FORCE escalation, TTS gating (#31), D77 error
message overhaul, Monitor UI changes beyond what the existing outcome seam already renders.
