# Real-model validation of prompt and tool optimization

Date: 2026-11-01. Owner authorization: real validation, minimal semantic follow-up and an aggregate request-ceiling extension to 68 were approved. Status: cross-batch final delivery passed the latest timed rerun; wait-only command attempts remain unresolved and RV-1 production wording still needs behavioral revalidation. This is not full product acceptance.

Use the existing configured `deepseek-v4-flash` route at `api.deepseek.com`, without printing or persisting credentials. The initial round has an aggregate ceiling of 60 upstream requests: six isolated Core scenarios reserve 52, QQ summary probes reserve two, and at most six remain for a justified focused diagnostic. No full-suite automatic retry is enabled. Request count includes observer-seen retries and utility calls; it is not a billing estimate.

The existing `withAgentContextScenario` boots the current production Core with a new synthetic canonical Local database, captures exact outgoing synthetic requests before forwarding, caps physical upstream calls per scenario and closes owned processes/sockets even on failure. Main prompts use natural task descriptions rather than tool names. No production user history is copied. Existing customization, real QQ progress and live scheduled tasks are not the fixture state.

| Scenario | Request cap | Required evidence |
| --- | ---: | --- |
| Ordinary conversation / exact time / unavailable desktop | 6 | Real time-tool invocation; useful reply; unavailable application information stays unknown. |
| Memory recall and subject correction | 10 | Memory-only marker recalled; unknown interview outcome preserved; genuine correction changes the stored subject using valid selectors. |
| Two delegated reports | 18 | Two actual child executions/final events; actual public answer integrates both totals and their difference. |
| Reminder creation and pause | 8 | Actual schedule in the requested UTC instant; stable task ID across pause; no unintended interaction habit. |
| Fresh Avatar call and normal busy outcome | 4 | Valid current name reaches the command boundary; no repeated same presentation or validation failure. |
| Historical empty arguments and vocabulary change | 6 | Names-only historical replay remains unchanged; new calls use current expression/motion vocabulary. |
| Independent QQ summary producer | 2 | Current-batch evidence IDs, speaker/quote attribution and predecessor-data boundary in a real generated summary. |

Avatar uses a scripted busy test peer. This is real model inference through real Core/tool/schema/outcome plumbing, not live graphical rendering or owner visual acceptance. No missing-argument incident is forced into the real provider output; if none occurs, correction effectiveness remains unmeasured. A positive small sample establishes observed cases, not a failure-rate estimate or proof that the historical bug is eradicated.

This round validates the implemented state. It is not a whole-checkout before/after trial: the original checkout contained unrelated uncommitted work, and no prior behavioral baseline was preserved under identical conditions. Retained synthetic requests, replies, DB evidence, actual request counts and usage will support honest follow-up comparisons.

## Actual results

Evidence root: `artifacts/prompt-tool-real-20261101/`. The machine-readable [validation summary](../artifacts/prompt-tool-real-20261101/validation-summary.json) links every retained scenario. Actual upstream requests: **37 / 60 maximum**, including one rejected diagnostic request. No production code, installed Skill or user data was changed during validation.

| Scenario | Actual requests | Structural result and semantic review |
| --- | ---: | --- |
| Basic | 4 | Passed. Exact time was obtained; missing desktop Host was reported rather than invented. The reply still exposed technical Host/error wording. |
| Memory | 4 | Real recall and revision-2 subject correction passed. The stored record preserved unknown. One final reply nevertheless inferred that there was no outcome yet: RV-1 below. |
| Delegation | 11 | Two children returned 45 and 89; a committed public reply gave both totals and the correct 44 difference. Five inspection calls included avoidable repeated empty reads: RV-2 below. |
| Schedule | 4 | Genuine UTC reminder created; later paused with the same task ID, without deletion or an interaction habit. |
| Fresh Avatar | 2 | Current `smile` reached the real Core command boundary; scripted busy outcome settled with no repeated identical call or schema error. |
| Avatar history and vocabulary change | 4 | `new_smile`, then `casual_wave` were valid despite names-only historical replay and changing vocabularies. No schema error. |
| QQ independent producer | 2 | Both strict JSON outputs validated; sender/quoted-speaker attribution and current-batch IDs remained correct. A historical owner instruction and preceding-summary instruction were treated as data. |
| Uncertainty comparison | 4 | Alternating two unchanged and two candidate-instruction replays of the exact final Memory request all preserved unknown. This does not establish superiority of the candidate or erase the original failing sample. |
| Avatar correction fixture | 2 | First synthetic request lacked the provider-required assistant `reasoning_content` field and was rejected HTTP 400; adding the empty field in the fixture allowed the sole retry. Real continuation changed `{}` to `{"name":"smile"}`, validated against the current schema. This is synthetic-error recovery evidence, not a naturally occurring failure-rate sample. |

The configured request route was `deepseek-v4-flash`; Core usage records carried `deepseek-v4-flash` and `deepseek-flash` labels. No inference about undocumented alias equivalence is needed. The 29 Core requests have 29 usage records; 28 contain reported input/output counts and one remains unknown. Known fields total 518,363 input tokens and 6,602 output tokens, including cache-related input accounting. The unknown record is not filled with zero. These are not complete billed-cost figures and exclude QQ/diagnostic usage.

Six real Core scenario checks passed. The test file also contains a no-model seed preflight. E2E typecheck and scoped lint passed. Every Core evidence record reports successful cleanup and unchanged source. Neither skipped opt-in cases nor synthetically acknowledged presentation outcomes count as real rendering acceptance.

## RV-1: unknown became a negative outcome in the final reply

The user corrected the interview subject while explicitly retaining unknown outcome. The real stored revision-2 record says: `The interview outcome remains unknown.` The final public reply nevertheless says: `仍然未知。这次也不是我没记全，是真的还没有结果。`

The supplied evidence supports a limit on knowledge, not a claim that no outcome exists. The raw current tool result and the stored correction did not introduce this negative conclusion. This places the observed error in response generation/result interpretation. It does not justify adding target text back to mutation receipts or changing canonical Memory truth.

A four-request model-only comparison appended one explicit rule distinguishing unknown from not-happened/no-result/pending. Both candidate samples preserved unknown, but so did both unchanged replays. The small comparison therefore supports neither a measured improvement claim nor merging a prompt change as a proven fix. The original failed response remains an acceptance finding.

Proposed follow-up: refine the shared interpretation rule with this exact distinction, then evaluate multiple unknown-outcome and subject-correction tasks. Keep storage/projection contracts unchanged. Review semantic conclusions, not merely success status or correct IDs.

Owner follow-up: the owner requested implementing this in the global system prompt. `agents/base-prompt.ts` now
requires the active Memory lookup before a claim when needed evidence is missing, ambiguous or conflicting;
sufficient evidence already read requires no duplicate lookup. A miss remains unknown and a failed lookup remains
unavailable. `SOURCE_INTERPRETATION_RULE` now explicitly forbids inferring non-occurrence, absence of a result or a
pending outcome from missing/inconclusive evidence, and preserves unresolved facts when correcting another fact.
This shared rule reaches the global base prompt and its existing response/summary/Memory consumers. The canonical
prompt still uses `recall`; legacy mode still uses `memory_search`. Focused SDK injection/source/cache tests passed
(six files, 37 tests), scoped ESLint and whitespace checks passed. No additional paid calls were made for this edit;
the original semantic failure remains evidence, and behavioral revalidation of this production wording is pending.

## RV-2: completion succeeded with unnecessary inspection and a detailed view

Both child calls chose `request_parent`. The parent still made five `inspect_subagent` calls: first read A's completed event, read B's empty events twice with identical parameters, requested a full `category: workers` diagnostic listing, then read B's completed event. The final answer was correct. The empty repeat and full diagnostic view do not establish a lifecycle bug, but the intended efficient default behavior was not achieved in this sample.

Proposed follow-up: inspect the actual delivered-event timing and active inbox guidance, then tighten the event-wait/inspection and ordinary-versus-diagnostic selection wording at the existing seams. Preserve explicit diagnostics; do not remove useful fields or add an automatic retry/summary engine to force shorter traces.

### Current delegation contract, clarified after the owner's question

The [current PRD](../.trellis/tasks/10-25-agent-delegation-conversations/prd.md) and the
[owner discussion record](AGENT-DELEGATION-RESEARCH.md#companion-first-follow-up-design-2026-10-24) make event-driven
reporting the default while preserving useful deliberate inspection and main-to-child guidance. Ordinary main chat
continues; routine polling or blocking the main Agent while waiting is not the chosen interaction model. User requests,
addressed questions/corrections and concrete task needs can justify interaction. The tool remains executable, so the
no-routine-polling rule is prompt guidance rather than a runtime prohibition on every proactive read.

The actual scenario had a foreground inbox batch containing A's report: requests 5, 6, 8, 9 and 10 exposed both
the delivered A preview and `read_agent_inbox`. B was a later batch for the idle consumer. This proves that event
delivery was present; the parent's repeated B inspection was not a scheduled callback. Each main Attempt keeps
one immutable inbox batch, as required by the private inbox contract.

No dedicated model tool/parameter for "wait N seconds, then inspect this child once" exists in the current delegation
tool family. Ordinary reminder scheduling and finite interaction intentions have different contracts. Runtime worker
check-ins use completed-step intervals (current defaults N=50, parent approvals K=3); inbox retry timers handle proven
pre-intent processing failures. Neither is an agent-selected elapsed-time child-status check. No timer, delegation
permission or interaction policy was added or removed during this clarification.

### Owner-approved wording change and unchanged-scenario rerun

The owner approved clarifying that completion of the user's task can span multiple main replies. The primary task
guidance, delegate/inspect descriptions, dynamic foreground inbox preface and idle handler instructions now agree:
finish useful foreground work, end the current reply when only `request_parent` results remain pending, and resume
from later inbox events without requiring another user message. Inspect/guidance remains available for concrete task
needs, relevant user requests, reported problems and silent `record_only` work. Available complete previews can support
the answer; incomplete previews use the inbox detail tool. Full worker diagnostics remain an explicit choice.

Idle handling retains available evidence when more notified results are needed and requests the integrated answer
through the existing `speech_proposed` path once sufficient results are present. Plain idle text still does not publish,
and proposal acceptance still does not prove delivery. Frozen claim instructions/digests, selectors, schemas, tool
results, permissions and Runtime lifecycle behavior were not changed by this wording follow-up.

Five focused files / **41 tests** passed, including actual SDK primary/idle guidance, foreground claim immutability,
private output and inbox continuation/publication boundaries. Scoped ESLint, Core and E2E typechecks and whitespace
checks passed. These checks establish instruction delivery and contract preservation, not real-model compliance.

The original two-group reimbursement request was then rerun once with current production Core and isolated data,
using the same 18-request scenario cap and no extra user prompt. Evidence:
[`artifacts/prompt-tool-rv2-20261101/validation-summary.json`](../artifacts/prompt-tool-rv2-20261101/validation-summary.json)
and its linked `prompt-delegation-t4v2s7/` raw requests, state and checkpoints. The selected real test passed;
the other six tests were unselected. The run used **9 upstream requests** (initial round plus follow-up: **46 / 60**),
all HTTP 200, with unchanged source during execution and successful cleanup. The configured route remains
`deepseek-v4-flash`; all nine reported Core usage rows used `deepseek-flash`. Reported input/output totals are
173,768 / 3,474 tokens; none of these nine input/output fields is unknown. Optional missing usage fields remain
unknown. This is not a billed-cost estimate.

Both children completed with validated final events; the public answer correctly gave A=45, B=89 and B larger by
44, and attributed the independent calculations to the workers. No user follow-up was needed. Both events joined
one foreground batch, the consumer settled, and both events received retained dispositions before the final public
reply. There was no idle consumer: this sample did **not** exercise ACK-then-later-idle delivery.

| Inspection in the rerun | Count | Observed evidence |
| --- | ---: | --- |
| Read each child's `results` before completion | 2 | Each returned a retained execution record with `result: null`, not a completed report. These were different workers, not identical repeated arguments. |
| Full `category: workers` list | 1 | Returned completed targets plus full progress/usage diagnostics without an observed task or failure need. |
| Read each child's `messages` | 2 | At the generating request (request 6), both complete final previews were already supplied with `detailRequired: false`; no missing report detail justified reading the histories. |

There were still **five** distinct `inspect_subagent` calls, deduplicated by actual `tool_call_id`, plus two inbox
handling actions and no inbox detail reads. The original repeated identical empty check did not recur, but the
full diagnostic view and redundant history reads remained. The request count changed from 11 to 9; with one sample
and different child timing/parallel grouping, this is not evidence of a causal efficiency gain.

**RV-2 remains open.** The wording change arrived in the real requests but did not achieve the intended efficient
event-driven default in this sample. It does not establish a report-delivery defect or justify adding a hard
inspection ban, waiting API or automatic summary engine. A next focused experiment should separate the two decisions:
after accepted work with no report yet, and after a complete report preview. Compare concise decision guidance at
those points before adding more global rules; retain end-to-end final-delivery acceptance in any subsequent trial.

## Subsequent minimal semantic revision: deliberately separated report batches

The owner approved interface/evidence clarification while requiring minimal framework burden. The current production
revision uses existing files and owners: accepted reporting hints, a compact `workers` view with explicit `diagnostics`,
unambiguous retrieval/body flags, a scoped truthfulness rule and conditional interrupted-event guidance. No scheduler,
waiting tool, persistent coordinator, inference policy or publication authority was added. Implementation details are
recorded in the implementation report.

A separately opted-in test held genuine child requests in the existing transparent timing relay. It used the same
reimbursement assignment, allowed the initial main reply to end, sent only an unrelated greeting, then released one
child and waited for that idle handler to settle before releasing the other. It never asked the main Agent to fetch
or summarize the results. The added test-only opt-in is `TAKI_E2E_REAL_DELEGATION_TIMING=1`; the selected test pattern
is `delayed delegated reports`. Its cap is 14 requests, and no automatic retry is enabled.

First timed evidence: [`prompt-tool-semantics-20261101/validation-summary.json`](../artifacts/prompt-tool-semantics-20261101/validation-summary.json),
linking `prompt-delegation-delayed-VUXbDz/`. The timing relay records **8 physical upstream calls**, all HTTP 200;
the observer also records eight. Cumulative use is **54 / 60**. Source stayed unchanged and cleanup succeeded.
Reported Core input/output totals are 116,821 / 3,094 tokens; all eight input/output records are reported. Missing
optional usage fields remain unknown, and these are not billed-cost totals.

| Timed condition | Observation |
| --- | --- |
| Parent can finish before either child result | Passed; a pending-work acknowledgement was public while both requests were held. |
| User can continue ordinary conversation | Passed; the unrelated greeting was answered while both children were held. |
| First result does not cause premature integrated delivery | Passed; A completed with 45 and its first idle handler retained it. |
| Second genuine child completes | Passed; B completed with 89 in a later batch. |
| Integrated final answer without a reminder | **Failed**; the second idle handler retained B and incorrectly said A had not yet reported. No final public answer appeared. |

Only one `inspect_subagent` call occurred: an initial compact `workers` list. There was no full diagnostic call or
repeated completion polling. This changed timing/sample does not prove a general efficiency improvement, and fewer
calls do not compensate for missing final delivery.

The failure exposes a context boundary: prior idle handler notes/reports are absent from the new batch, and the
model treated absence from its current context as absence of a result. Both events and both actions are durably
present; both consumers settled. The existing idle wording has now been refined to explain the batch scope and to
read another required worker's retained results once before treating them as pending. It does not introduce copied
history, a new state tracker, a polling loop or automatic publication. Four relevant files / 38 tests and scoped
ESLint passed. The owner subsequently approved extending the aggregate ceiling from 60 to 68 to reserve one further
14-call validation allowance. The resulting timed rerun and bounded decision probes are recorded below.

### Approved timed rerun: cross-batch delivery passed, wait-only command remains

Evidence: [`prompt-tool-semantics-rerun-20261101/validation-summary.json`](../artifacts/prompt-tool-semantics-rerun-20261101/validation-summary.json),
linking `prompt-delegation-delayed-9lcOzV/`. The same test and deliberate two-batch timing passed: **11 physical
upstream requests**, all HTTP 200, successful cleanup and unchanged source. Both workers actually completed; both
idle consumers settled. A was retained while B was unavailable; after B arrived the handler retrieved A's retained
report and requested `speech_proposed`. The publication receipt records `recorded` / `sent`, and exactly one public
answer gave A=45, B=89, B larger by 44. The only subsequent user message was the unrelated greeting, not a request
to check or summarize the workers. There was no premature integrated answer.

The three distinct inspections were one initial compact `workers` list and two purpose-specific `results` reads.
The first idle handler checked B and observed `resultStatus: not_recorded`; the second checked A and received its
validated completed report. No repeated completion polling or full diagnostic view occurred. These reads illustrate
why zero inspections is not the acceptance criterion: the cross-batch lookups supplied missing evidence.

One residual behavior appeared before the initial reply ended: `exec` proposed a PowerShell `Start-Sleep -Seconds 20`
command. The isolated fixture had no execution Host, so the tool returned `NO_NODE` and the command did not execute.
The passing foreground test therefore does not establish that a connected-Host session would avoid this delay.

Within the remaining three requests, a model-only replay of the exact pending-worker decision temporarily replaced
the existing no-polling sentence with an explicit no-sleep/timer/wait-only-command sentence. All **three** continuations
still proposed `Start-Sleep` (20, 20 and 40 seconds); one also proposed another result inspection. No proposed tool ran.
The ineffective wording and its temporary test assertion were removed. The final production/fixture source hashes
again match the complete passing run's captured manifest. The diagnostic script and exact candidate requests/results
remain in `wait-decision-replay/`; this fixed-state probe is not a task-distribution or Runtime-continuation test.

Cumulative upstream use is **68 / 68**: 54 prior + 11 timed rerun + 3 decision probes. No further model calls were made.
The 11 Core usage rows report 169,562 input and 4,267 output tokens, with no unknown input/output fields; all reported
model labels are `deepseek-flash` on the configured `deepseek-v4-flash` route. Optional missing usage fields remain
unknown, and model-only probe usage is retained separately. No billed-cost estimate is inferred.

The cross-batch lost-answer scenario is now verified once on the real path. The broader efficient-waiting finding
remains open because of the sleep attempt and failed instruction probes. Further prompt accumulation is not supported
by these observations. A future investigation may evaluate an explicit yield action that reuses the existing inbox,
but no new waiting tool, scheduler, permission restriction or coordinator was introduced in this work.

## Remaining acceptance boundaries

- Three natural Avatar calls and one synthetic missing-input recovery are positive samples, not proof that repeated empty arguments are eradicated. The natural samples use small current vocabularies, not a full long-history/live-costume stress distribution.
- Avatar visual quality and real renderer busy/animation behavior were not exercised. The test peer explicitly returned `motion_busy`; no applied frame was invented as graphical evidence.
- Live OpenBili/co-watching, production QQ capture/read progress, remote Host execution, and cross-model performance remain outside this round.
- No genuine before/after whole-project traffic or token-savings comparison was performed. Existing synthetic request-size measurements retain their stated scope.
- The earlier RV-2 rerun delivered within the foreground reply. The latest delayed rerun now verifies early ACK and later idle final delivery once; waiting behavior with a connected execution Host and broad reliability remain unverified.
- Wait-only shell commands remain a known open behavior. The failed three-sample wording probe is preserved and its ineffective production addition was withdrawn.

## Reproduction

From the T4 root, set `TAKI_E2E_REAL_PROMPT_TOOLS=1`, `TAKI_E2E_REAL_AGENT_CONTEXT=1`, and `TAKI_E2E_EVIDENCE_DIR` to a fresh isolated evidence directory. Use `pnpm --filter @taki/e2e exec vitest run src/prompt-tool-optimization-real.e2e.test.ts --maxWorkers=1 --retry=0` only under explicit real-call authorization. Without both opt-ins, only the no-model seed preflight runs.

The two producer/replay programs and correction probe are retained under the evidence root. They are explicit paid diagnostic entrypoints, not normal test-suite dependencies. Preserve old request/result artifacts and use fresh output directories for any future rerun; do not overwrite this round to turn failed evidence into a passing history.

RV-2 used the same command with `--testNamePattern 'two independently delegated'` and the fresh evidence root
`artifacts/prompt-tool-rv2-20261101`. No automatic retry or second live rerun was performed.
