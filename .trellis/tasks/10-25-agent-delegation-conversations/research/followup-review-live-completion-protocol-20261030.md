# Live independent-review completion assessment — 2026-10-30

## Scope and decision

Read-only follow-up for the frozen-source real-model campaign. No production/E2E source changes, no new model calls,
and no assertion changes. This report is the only file written by this assessment.

The observed failure is **model completion-protocol adherence**, not an established integration defect or a mistaken
final-state objective. Keep this campaign case failed. Useful prose and responsive foreground conversation are observed
partial successes, not proof that both delegated works reached validated completion.

PRD requirement 3 explicitly distinguishes a natural model stop without a final report from successful completion.
The check-in contract likewise forbids promoting unstructured text. Neither natural-language quality nor the parent's
choice to use that text grants Runtime completion authority.

## Evidence

Source evidence directory:
`target/agent-delegation-20261030-validation/real-independent-reviews/goals-natural-delegation-MzDqH1/`.

- `result.json`: `status=failed`, `sourceUnchanged=true`, `cleanupFailed=false`, `deadlineExpired=false`,
  `requestEvidenceFailed=false`; configured production route `deepseek-v4-flash`.
- `request-4.json`: compatibility child work `b6e827c5-a28c-4bf2-9c93-8645f620cd6d`, Run
  `c77d8f4e-0481-4bd0-b0b5-490393d53e40`. The outgoing system message explicitly says:
  `Use complete_subagent for your final report. A natural text stop is not task completion.`
  The outgoing tool list includes `complete_subagent`, with required `text` and `materials`; its description explicitly
  permits an empty materials array. `tool_choice=auto`. No disclosure/load step is needed to call this collector.
- `request-5.json`: migration-risk child receives the same completion instruction and collector schema on the same
  model route. Both parent-written task prompts end with the equivalent of "Only return your review conclusion."
  That wording specifies report content and does not explicitly prohibit using the collector. It could influence the
  model's response style, but this single contrast cannot establish it as the cause; the other worker complies.
- Compatibility child: one completed model step of captured N=50, no proposal, one ordinary assistant output with
  749 characters and no tool-call parts; retained result `outcome=completed`, `outputKind=unstructured`,
  `currentness=current`; terminal event `kind=interrupted`, eligible and unsuppressed.
- Migration-risk child: one completed model step, actual `complete_subagent` call and successful proposal collection;
  retained result `outcome=completed`, `outputKind=validated`; terminal event `kind=final`.
- Both child model Effects are terminal/completed without recorded error codes. No child Stop, input wait, check-in,
  or context compaction caused this failure. The compatibility report contains its complete table and conclusion.
  This assessment reads retained requests and canonical output/effect evidence, not raw provider SSE finish reasons.
- Main Run `89fcf958-bfe2-418b-b9d9-87bf09827e2c` receives the compatibility event through `read_agent_inbox` with
  truthful `kind=interrupted`, reads its full text, and calls `handle_agent_event` with disposition `retained`
  (`operation_key=compat-review-1-retain`). It does not ask that worker to finish formally. The later foreground turn
  remains responsive and combines both reports. The interruption and text were not lost or disguised by Runtime.

## Actual code contracts

- `packages/core/src/harness/subagent-execution.ts:158-166`: generic worker instructions select explicit final
  collection; source-owned domain validation is a separate path.
- `packages/core/src/db/subagent-terminal.ts:32-63`: accepted final output requires a completed current Run plus a
  current proposal; otherwise visible text is retained with truthful output kind and an interrupted event.
  A completed Run alone is not accepted delegated task completion.
- `e2e/src/agent-delegation-goals-real.e2e.test.ts:32-45`: the natural prompt requests two independent reviewers and
  continued foreground help, then waits for both completed works before the final synthesis/handled-event checks.
- `e2e/src/agent-delegation-goals-real.e2e.test.ts:220-224`: `waitCompleted` requires both
  `outcome === "completed"` and `outputKind === "validated"`. Keeping this assertion preserves the intended
  lifecycle contract. The subsequent final-event handling gate was not reached, so this case cannot certify it.

## Narrow next action and limitation

Retain the failure and explicitly defer **reliable natural delegation completion on the configured model route**.
The present evidence supports no source repair. Do not change settlement to auto-promote prose, force a collector
on every model step, add invisible retries, or weaken this case to count unstructured output as completed.

If the coordinator chooses a bounded recovery experiment within the authorized serial campaign, use a separate
case/evidence directory and a natural follow-up asking the same existing reviewer to finalize its report. Reuse the
existing same-work continuation path, leave Runtime/collector checks unchanged, and require a later actual validated
final. Record success as recovery evidence, never overwrite or relabel this first-attempt failure. No such experiment
was run here. A single success or failure does not establish a reliability rate or justify a broad prompt rewrite.

## Verification

- Requests, canonical results/events/actions, original PRD, and actual production/E2E paths were inspected.
- Lint and TypeCheck: not rerun for this read-only assessment; no new code-check pass is claimed.
- Tests: existing real-model case remains **failed**; no test or provider invocation was rerun.
- Production and E2E source remain untouched by this assessment. Only this report was added.
