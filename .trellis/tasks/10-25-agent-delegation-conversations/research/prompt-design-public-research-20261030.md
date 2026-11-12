# Public prompt-design research for worker completion — 2026-10-30

## Status and question

The original research was read-only; its supported protocol clarifications have since been applied and tested by the
implementation owner. The model, thinking setting and tool-choice mode remain unchanged. The narrow question is whether public Codex and Claude guidance supports a small
clarification to TakiAgent's worker completion/waiting/reporting protocol after real workers sometimes produced a useful
plain-text report without `complete_subagent`, and another worker submitted a waiting-for-clarification report as final.

Conclusion: the public evidence supports a **small lifecycle-action clarification**, not a broad prompt rewrite. The
current Runtime already has the right distinct actions and truthfully retains unstructured output. The prompt should map
parent-requested report formatting to `complete_subagent.text` and distinguish whole-job completion, a blocking question,
and non-blocking progress. This is a plausible ambiguity reduction, not a proven root-cause repair.

## Sources actually fetched

All URLs below were opened and read on 2026-10-30; claims are based on fetched page content, not search snippets.

### Official OpenAI documentation

- [Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide). The page does
  not state a publication date. The fetched version identifies the API Codex model as `gpt-5.3-codex` and recommends
  tactical prompt additions around autonomy, persistence, exploration, and tool use. It also warns that prompting for
  routine plans, preambles, or status updates can cause premature stopping. This supports a short terminal-action rule,
  not more process narration.
- [Codex best practices](https://developers.openai.com/codex/learn/best-practices). The page does not state a publication
  date. It recommends stating goal, context, constraints, and "done when", and keeping durable guidance practical and
  concise. The locally relevant part is an explicit definition of completion.

These pages document recommended Codex harness/prompt patterns. They do not expose this session's hidden prompt or prove
how another provider/model will respond to the same wording.

### Official Anthropic documentation

- [Create custom subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents). The page does not state a
  publication date; the fetched content includes version-specific notes through Claude Code `v2.1.205` and later. It
  says subagents run with a focused custom system prompt and return their result, while descriptions should stay brief
  and task-specific.
- [Define tools](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use). The page does not
  state a publication date. It says a tool description should explain what the tool does, when it should and should not
  be used, parameter meaning, behavior, and important caveats; it calls descriptions the most important tool-performance
  factor. This directly supports putting the completion/wait distinction in the collector descriptions as well as the
  worker protocol.
- [Claude Code hooks reference](https://docs.anthropic.com/en/docs/claude-code/hooks). The page does not state a
  publication date. Its public lifecycle surface distinguishes `agent_needs_input` and `agent_completed` notifications
  and separate `Stop`/`SubagentStop` events. This is architectural evidence for typed lifecycle states, not evidence of
  Claude Code's private internal completion prompt.
- [Prompting best practices](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices).
  The page does not state a publication date. It supports clear, direct instructions and focused subagent orchestration.

### Third-party Claude Code catalog supplied by the owner

- [Claude Code prompts catalog, Chinese translation](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/),
  published 2026-04-01 and shown as updated 2026-10-29.
- Its linked [Claude Code deep dive](https://xdlkc.github.io/2026/04/01/claude-code-deep-dive/), published 2026-04-01
  and shown as updated 2026-10-29, says the material came from an alleged 2026-03-31 npm source-map snapshot.

The catalog is useful comparative evidence: its translated tool, subagent, and compaction sections repeatedly separate
user-visible text, inter-agent messages, input waits, task completion, and direct resume after compaction. However, the
page provides file names but no primary repository URL, commit, package hash, or independently verifiable snapshot. It
is therefore a dated third-party transcription, not official current Claude Code source and not hidden-prompt truth.
No TakiAgent recommendation below depends on the catalog alone.

## Verified patterns and local comparison

### 1. Completion needs a behavioral definition

OpenAI's public guidance asks for an explicit "done when" condition. Locally, the worker protocol names the collector
but does not define whole-job completion or connect the parent's requested output form to the tool argument:

- `packages/core/src/harness/subagent-execution.ts:159-166` builds the private worker instructions. The generic path
  says to use `complete_subagent` for a final report and that natural text is not completion.
- `.trellis/tasks/10-25-agent-delegation-conversations/research/acceptance-20261030.md:124-132` records the concrete
  ambiguity: parents asked for plain text, tables, or `Case / Verdict / Reason`, but the protocol did not say those
  requirements belong inside `complete_subagent.text`.

The missing sentence is not "always call a tool". It is "choose the lifecycle action that matches the whole job's state,
and place the requested report in the final tool's text field."

### 2. TakiAgent already has the correct separate actions

- `packages/core/src/agents/subagent-interact-tool.ts:30-35` provides `message` for asynchronous parent updates and
  `needs_input` when dependent work must wait.
- `packages/core/src/agents/subagent-interact-tool.ts:47-59` stops the worker loop only after an accepted
  `needs_input`; ordinary messages do not create a wait.
- `packages/core/src/agents/subagent-result-tool.ts:27-30` provides `complete_subagent` as the final-result collector.
- `packages/core/src/agents/subagent-result-tool.ts:42-59` shares a terminal-choice slot with `needs_input` and records
  completion only after the actual tool result is witnessed and committed.
- `packages/core/src/agents/agent-attempt.ts:193-218` permits ordinary assistant text to settle, but text alone does not
  create either collector proposal. That is why preserving it as interrupted/unstructured output is truthful.

The Runtime boundary should remain unchanged. Auto-promoting prose would erase the distinction between a report, a
blocking question, and an actual accepted final.

### 3. Tool descriptions should carry selection semantics

Anthropic's official tool-use guidance makes detailed "when / when not" descriptions a primary lever. TakiAgent's
descriptions are accurate but leave one selection edge implicit:

- `packages/core/src/agents/subagent-result-tool.ts:27-30` says what completion records, but not "whole job finished"
  or "not for missing input".
- `packages/core/src/agents/subagent-interact-tool.ts:32-35` distinguishes message and wait, but does not explicitly
  reject submitting a clarification-stage report through `complete_subagent`.

The system instruction and both tool descriptions should express the same small state machine. Duplicating only this
critical distinction is preferable to a long general protocol because tool descriptions participate directly in tool
selection and remain visible beside the schemas.

### 4. The observed failures identify ambiguity, not a proven model defect

- `.trellis/tasks/10-25-agent-delegation-conversations/research/followup-review-live-completion-protocol-20261030.md:23-38`
  records two workers on the same route with the same completion instruction and collector availability: one produced a
  complete useful plain-text table and stopped; the other called `complete_subagent` successfully. No wait, checkpoint,
  or compaction caused that failure.
- `.trellis/tasks/10-25-agent-delegation-conversations/research/acceptance-20261030.md:128-130` records the converse
  error: a child used completion for a `STATUS: awaiting clarification / QUESTION TO OWNER / NEXT` report instead of
  opening a wait. Correct tool choice, not merely any tool call, is the requirement.
- `.trellis/tasks/10-25-agent-delegation-conversations/research/acceptance-20261030.md:134-137` records a bounded
  first-response pilot: baseline 4/4 and clarified wording 4/4 selected `complete_subagent`. It did not reproduce the
  failure, execute the tools, or demonstrate improvement. It must remain non-causal evidence.

This mixed behavior is compatible with an output-channel ambiguity. It does not prove that wording is the sole cause,
nor justify changing model, thinking mode, or `tool_choice`.

### Complete-worker baseline replay reproduced the omission

After the public-source review, the parent ran the prepared baseline arm with the exact original eight `direction_text`
values, fixed scripted parent delegation, the configured real child model/default thinking, inherited tool choices, and
the actual Core SDK, SQLite, tools, and settlement path. Production source remained unchanged.

- Result: 7/8 workers reached validated completion.
- Case 4's retained upstream SSE ended with `finish_reason=stop` and no `tool_calls`.
- Its canonical child result was `outcome=completed`, `outputKind=unstructured`, terminal event `kind=interrupted`, after
  one completed task step. Reported usage was 4,156 input and 167 output tokens.
- Source-unchanged and cleanup guards passed.
- Evidence: `target/agent-delegation-20261030-validation/protocol-runtime-baseline/protocol-runtime-baseline-kCx3gx/`.

For this observed run, the omission originated in the upstream model response rather than being lost by SDK projection
or collector settlement. This still does not establish a model-only cause: the baseline prompt is part of the upstream
request.

The matched clarified arm then completed 8/8 with the same exact eight task directions, model route, default thinking,
tool choices, scripted parent, and actual Core/SDK/SQLite/tool path. The only intended child-request difference was the
clarified system suffix. Source-unchanged and cleanup guards also passed. Evidence:
`target/agent-delegation-20261030-validation/protocol-runtime-clarified/protocol-runtime-clarified-whQz3t/`.

The paired 7/8 baseline versus 8/8 clarified observation supports continuing with the minimal protocol candidate. It is
one eight-pair sample, not a statistical reliability estimate or proof that wording was the sole cause. It also covers
completion routing only; it does not yet replay the observed error where a waiting-for-clarification report was submitted
as final.

### 5. Compaction/recovery is already strong; do not expand it without a failing witness

The third-party catalog emphasizes preserving current work and resuming directly after compaction. TakiAgent already
implements the important truth-preserving pieces:

- `packages/core/src/agents/private-task-summarizer.ts:32-40` preserves the task, constraints, decisions and reasons,
  findings, completed actions, exact evidence references, unresolved work, next actions, sender/source distinctions,
  negation, unknowns, and failed outcomes. It forbids treating transcript content as new instructions.
- `packages/core/src/agents/subagent-self-history-tool.ts:28-32` exposes exact retained messages, inputs with sender,
  results, and raw materials, with explicit pagination and a warning that reads neither resume nor complete work.
- `packages/core/src/agents/subagent-delegate-tool.ts:17-21` states that delegation returns an acknowledgement rather
  than a result and separates final-result policy from periodic progress check-ins.
- `packages/core/src/agents/subagent-message-tool.ts:13-15` distinguishes an ordinary message from exact continuation
  of a question/check-in.

No retained evidence currently shows that summary content caused the completion-routing failures. The long-pressure
case failed during a read batch before its first checkpoint, not because a compacted summary dropped completion state.
Do not import the catalog's much larger summary template or add lifecycle prose to the summarizer until an actual
compaction/recovery witness demonstrates a missing field.

## Minimal proposed protocol text

Replace only the generic sentence at `packages/core/src/harness/subagent-execution.ts:165` with:

> For non-blocking progress, use `interact_parent` with `kind: "message"` and continue. If missing information blocks
> this job, use `interact_parent` with `kind: "needs_input"` and put the question in `text`; the job remains unfinished.
> Only when the whole assigned job is complete, use `complete_subagent` and put the parent-requested report format and
> content in `text`. Plain assistant text performs none of these lifecycle actions.

Align the two tool descriptions with the same rule, without changing schemas or execution:

- At `packages/core/src/agents/subagent-result-tool.ts:28-29`, append: `Use only after the whole assigned job is
  complete; put the parent-requested report format and content in text. Do not use it to ask for missing input.`
- At `packages/core/src/agents/subagent-interact-tool.ts:33-35`, make explicit: `message reports non-blocking progress
  and does not pause; needs_input asks the blocking question and keeps the same job unfinished. Do not submit a
  waiting-for-clarification report through complete_subagent.`

These are one semantic change expressed at the system and tool-selection surfaces. Do not add examples yet: the state
machine is small, the existing schemas are clear, and broad examples would increase prompt weight and risk anchoring
reports to one task shape.

## Expected benefit and trade-offs

- **Benefit:** removes the locally observed ambiguity between formatting a report and choosing the channel that carries
  it; makes waiting explicitly non-final; makes plain text explicitly non-actioning.
- **Benefit:** follows official Codex guidance to define completion and official Anthropic guidance to explain when and
  when not to use each tool.
- **Benefit:** preserves the existing truthful Runtime behavior and privacy/material contracts.
- **Trade-off:** adds a small repeated prompt cost on every generic child request. Keeping the text to this state machine
  limits that cost and avoids the public Codex warning about excessive process/status prompting.
- **Trade-off:** clearer waiting criteria may reveal more genuine questions instead of guessed answers. That is desired
  when work is actually blocked, but the test campaign should watch for unnecessary waits.
- **Limitation:** prompt wording can reduce ambiguity but cannot guarantee a tool call. The failure is stochastic on the
  available evidence, and no public documentation establishes behavior for the configured non-OpenAI route.

## Controlled runtime evidence and remaining validation

The complete-worker replay has now performed the first controlled comparison that the earlier first-response pilot did
not: exact original tasks, actual tool execution, upstream SSE retention, and canonical Core settlement. Baseline
reproduced one upstream prose-only stop (7/8); the clarified suffix completed 8/8. The evidence paths and limits are
recorded above.

Before treating the wording as production-ready, retain the same lifecycle-oriented scoring and add these checks:

1. Add a deterministic prompt-composition assertion that generic workers receive the coordinated protocol and that the
   `complete_subagent` and `interact_parent` descriptions express the same state boundaries. This guards wording drift;
   it does not prove model behavior.
2. Replay the observed wrong-lifecycle shape: a task whose requested interim deliverable says
   `STATUS: awaiting clarification / QUESTION TO OWNER / NEXT`. The correct result is an accepted
   `interact_parent(kind=needs_input)`, the same unfinished work pending, an addressed parent answer, a new Run for that
   same work, and only then a validated `complete_subagent` final. A polished clarification report submitted as final
   must fail acceptance.
3. Retain a completion case that verifies parent formatting is carried inside `complete_subagent.text`, including the
   original concise/table/length constraints, and that plain assistant text is never auto-promoted.
4. Run progress-only coverage: `interact_parent(kind=message)` must produce an asynchronous event without pausing or
   consuming the final/needs-input terminal slot.
5. Repeat the failure-prone completion directions in paired alternating order if a reliability claim is required. One
   7/8 versus 8/8 comparison is directional evidence only. The owner has already authorized the real-model campaign;
   additional calls should answer a specific unresolved question rather than chase a passing sample.
6. Run the existing deterministic completion/wait regressions and one real missing-input round trip after the production
   text change. Add a compaction case only as a regression check; do not claim this protocol repaired compaction because
   no compaction cause is currently evidenced.

## Rejected changes for this finding

- Do not change model, thinking mode, or `tool_choice`; those are different experiments with provider-compatibility and
  quality trade-offs.
- Do not force a tool on every step; that does not choose the correct lifecycle action.
- Do not auto-promote plain assistant text, silently retry every stop, or weaken final-state acceptance.
- Do not broaden the worker persona, add routine status narration, or copy a third-party proprietary-prompt catalog.
- Do not expand the compaction summary until an exact failing recovery witness identifies a missing field.

## Post-application review and real parent-routing evidence

The applied worker text is longer than the minimal draft above but preserves the same state machine at
`packages/core/src/harness/subagent-execution.ts:165-168`. The coordinated descriptions at
`packages/core/src/agents/subagent-result-tool.ts:28-30` and
`packages/core/src/agents/subagent-interact-tool.ts:33-35` are consistent with it. The source-owned branch remains
separate at `packages/core/src/harness/subagent-execution.ts:164`: Co-Watching continues to follow its trusted owner
instructions and does not receive the generic collectors or completion protocol. No worker-side correctness issue was
found in this bounded review.

Real interim-clarification evidence then exposed a distinct **parent-facing** ambiguity. Evidence:
`target/agent-delegation-20261030-validation/real-interim-clarification-protocol/goals-interim-clarification-t4ntlr/`.

- The child correctly called `interact_parent(kind=needs_input)` with the exact `STATUS / QUESTION TO OWNER / NEXT`
  text, remained unfinished, accepted the addressed 300 ms answer, and later produced a validated Amber final.
- The main Agent had delegated the job with `completionPolicy=record_only`. The event body was durably retained, so this
  was not child output or collector projection loss.
- `packages/core/src/harness/subagent-work-boundary.ts:55-56` schedules a main inbox opportunity for an accepted
  interaction only when the work policy is `request_parent`. With `record_only`, the main Agent inspected state/history
  repeatedly but did not receive the question body through the normal inbox path. It later incorrectly concluded that
  the pending-question text had never been delivered and sent an unnecessary post-final formatting correction; teardown
  cancelled that third Run. Both recorded foreground turn texts were empty.
- The interim E2E at `e2e/src/agent-delegation-goals-real.e2e.test.ts:83-125` therefore certifies the child-side
  wait/answer/final sequence, but not complete parent delivery, user-facing question presentation, or absence of
  post-final duplicate work.

The same parent policy ambiguity reproduced more directly in the real eight-reviewer case under
`target/agent-delegation-20261030-validation/real-eight-inbox-protocol/goals-full-eight-inbox-1CWkRY/`: all eight
children produced validated finals, but the main Agent selected `record_only`, leaving all eight final events ineligible
with `suppression_reason=record_only`. The test's eligible-final gate correctly could not pass.

The parent-facing description at `packages/core/src/agents/subagent-delegate-tool.ts:17-21` uses the phrases
"final-result parent inference" and "request later synthesis". Real behavior shows those terms are not sufficiently
concrete. A targeted follow-up should describe observable behavior in plain terms without changing the default or
forcing one policy globally:

- `request_parent`: send the completed result to the main inbox for follow-up; choose this when the job should report
  back to the delegating Companion.
- `record_only`: store the completed result for later explicit inspection and send no final notification; choose this
  only for intentionally silent retained work.

Resolved after independent review against original requirements: preserve the existing `record_only` routing for ordinary
messages and questions as well as finals. PRD requirement10 explicitly preserves silent feature behavior; only the
authorized Core check-in is an exception. Parent descriptions now explain `request_parent` automatic reports/questions
versus deliberate silent inspection. Bounded `inspect_subagent(category="events")` exposes retained silent question bodies
without changing eligibility, claiming or waking. The earlier proposal to globally unsuppress questions is superseded.

The new long fixture at `e2e/src/agent-delegation-goals-real.e2e.test.ts:165-213` is coherent for its stated purpose:
24 opaque names form a dependency chain, 48,000 tokens with ratio 0.2 leaves room for the protected latest round and
summary, N=8/K=0 forces a user check-in, and the test retains same-work/multi-Run, actual compaction, and all-24 successful
`read_file` assertions. No actual issue was found in that design. The earlier independent-file fixture could legitimately
batch reads or finish before N, so changing the stress task's dependency is justified rather than weakening the product
contract.

Bounded static verification after the applied changes:

- ESLint on the three Core files and the real E2E file: PASS.
- `pnpm --filter @taki/core typecheck`: PASS.
- `pnpm --filter @taki/e2e typecheck`: PASS.

## Source limitations

Official public documentation describes product behavior and recommended patterns, not the full current hidden prompts
of Codex or Claude Code. The OpenAI pages are model-family guidance rather than evidence about the configured production
provider. The Anthropic pages document public tool/subagent APIs but not TakiAgent's collector contract. The owner-linked
catalog is a translated, dated, unverified snapshot analysis with no primary artifact identifier. Local recommendations
therefore rest primarily on TakiAgent's actual contracts and retained failures; public sources supply design support,
not causal proof.
