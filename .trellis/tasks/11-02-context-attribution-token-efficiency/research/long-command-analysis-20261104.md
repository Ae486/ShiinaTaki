# Research: Recent execution-heavy conversation cost

- Query: Does a recent long command or long execution task create significant repeated context, and which bounded improvement is justified?
- Scope: mixed; read-only SQLite snapshot and current execution/replay code, with previously verified framework principles and conditional provider prices.
- Date: 2026-11-04

## Findings

### Source and reproducibility

The authorized consistent snapshot is `target/context-analysis-20261104/conversation-115757.db`, SHA256 `f8b8525f756cf28db62264307739f91358dd156ea60b9f48d1f2b0dd51bb9b93`. The helper verifies this hash, opens SQLite with `mode=ro` and `PRAGMA query_only=ON`, and emits only sanitized identities, sizes, numeric usage and finite classifications. It does not emit command text, output bodies, private file names or conversation bodies.

```powershell
python .trellis/tasks/11-02-context-attribution-token-efficiency/research/long-command-inspect.py --out .trellis/tasks/11-02-context-attribution-token-efficiency/research/long-command-aggregate-20261104.json
```

Only `run_usage` supplies usage totals. `usage.settled` is not added again; reasoning is already included in output. Tool events join the originating model Effect, Run, Attempt, invocation ID and tool-call ID. Timeline parts join by the exact tool-call ID; missing parts remain missing. Timestamps below are UTC; the main November 3 case occurred at 22:02 Beijing time.

The latest summary is revision 6, through Timeline seq 4182, updated `2026-11-01T11:06:47.639Z`, with 13,688 characters. No new summary explains the November 3 continuations.

### Identify the task before calling it waste

The strongest recent long-task candidate is Run `5320348d-ca11-47d9-ba6c-91d168472eb1`, primary input seq 4617, `2026-11-03T14:02:20.874Z` to `14:04:06.557Z`. The originating goal, read locally together with seq 4613, was to consolidate duplicated recurring reminder scripts into a parameterized reusable script and organize related memory while the owner studied. The owner explicitly requested continuation at seq 4658 after the long Run ended in a tool call. The subsequent Run is `dcf2bb6a-c21e-4865-98c9-7a829f23dda2`.

This was an implementation/inspection/verification task, rather than one command returning an enormous log. Twenty requests are not automatically twenty unnecessary calls. Current code has a default of 10 steps with an injected override; the observed 20-request endpoint and owner's ceiling-related continuation are consistent with a 20-step effective limit, but the historical configured value is not separately captured here.

The owner later asked why there was no visible activity at seq 4674, producing Run `2ea39fae-1f79-4280-9621-a41d7a11e8bb`. That follow-up is observable evidence that request completion does not establish the intended reminder behavior or human acceptance. It is not assigned an exec defect without the missing original commands and actual scheduled behavior.

### Cohort and request accounting

There are 42 recent `exec` result events: 39 in 9 primary Runs with 85 requests, and 3 in non-primary Runs with 10 requests. All 39 primary execs have retained Timeline outputs; the 3 non-primary outputs are absent from public Timeline and are not assigned zero size. The 9 primary execution-containing Runs account for 7,710,162 reported input, 7,344,128 observed cache-read input, 366,034 uncached input and 41,137 output, including 24,421 reasoning. This is a selected execution cohort, not the full November 2-3 primary population or an equivalent-task experiment.

| Selected Run / source input | Requests | Reported input | Cache-read input | Uncached input | Output, including reasoning | Conditional Flash CNY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Nov 2 `afe95bf9…`, seq 4373 | 20 | 1,429,768 | 1,419,008 | 10,760 | 7,738 (4,535 reasoning) | 0.14018432 (peak) |
| Nov 3 main `5320348d…`, seq 4617 | 20 | 2,309,324 | 2,202,880 | 106,444 | 11,523 (6,607 reasoning) | 0.19659360 |
| Explicit continuation `dcf2bb6a…`, seq 4658 | 8 | 839,028 | 769,152 | 69,876 | 5,478 (3,659 reasoning) | 0.10717104 |
| Later activity question `2ea39fae…`, seq 4674 | 3 | 289,438 | 201,600 | 87,838 | 1,264 (676 reasoning) | 0.09692600 |

Cache coverage is 20/20, 8/8 and 3/3 paired requests for the November 3 cases. The main Run is 95.39% cache-read by input volume. Its conditional price consists of CNY 0.106444 uncached input, 0.0440576 cached input and 0.046092 output; high cache reuse does not eliminate input occupancy or make reasoning/output free. The main task plus explicit continuation is CNY 0.30376464 under the stated tariff assumptions. The later activity question is separate; it is not silently counted as a successful task-completion cost.

Prices are conditional calculations using the current official Flash off-peak CNY/million-token rates: cached input 0.02, uncached input 1, output 4; peak rates are exactly twice these. The November 3 cases are outside the documented weekday Beijing peak windows. The November 2 example occurs at 16:45 Beijing time, inside the peak window assuming an ordinary non-holiday weekday, and its table figure uses peak rates. The aggregate exposes both tariff scenarios instead of claiming a historical billing/holiday record. This is not an invoice or proof of the historical endpoint's exact model weight/tariff. Current official legacy alias routing does not retroactively verify those facts.

### Main-case execution and feedback trace

The main Run has 24 tool invocations: 10 execs, 9 file reads, 3 file writes, one recall and one memory invalidation. All steps and identities are in the aggregate JSON. Tool steps are zero-based; request ordinal is step plus one.

| Step(s) | Observed invocation/result | Result source | Interpretation supported by the record |
| --- | --- | --- | --- |
| 0 | recall plus exec failure: compound command without an implicit shell | seq 4619; Run event seq 18 and 21 | Recall is legitimate memory work. The fixed exec error establishes a structural mismatch. |
| 1 | memory invalidation plus exec failure: program absent from trusted PATH | seq 4621; event seq 34 and 37 | Legitimate memory work coexists with an execution correction. The missing program name is not reconstructed. |
| 2 | exec succeeds, stdout 1,950 ASCII characters, child duration 603 ms | seq 4623; event seq 48 | The largest stdout in the entire retained recent primary exec cohort is still small. |
| 3-9 | two file writes, three execs, two reads of the same file | seq 4625-4637 | Implementation/check sequence. The repeated file's returned content grows from 397 to 615 characters. |
| 10-12 | four reads of other files, then one write | seq 4639-4643 | Inspection and another generated artifact. Paired reads were issued together; they are not adaptive retries after each other. |
| 13-18 | three execs and three reads, including another file read twice | seq 4645-4655 | The repeated file's content grows from 424 to 1,144 characters; these observations show progress. |
| 19 | final exec, stdout 1,060 ASCII characters, child duration 755 ms | seq 4657; event seq 255 | The Run ends after tool output, followed by the owner's explicit continuation. |

The main task's 10 exec events last 91-3,559 ms each, totaling 13.049 seconds including routing overhead. Physical model-request durations sum to 90.192 seconds across a 105.683-second Run. The elapsed task is primarily model round trips/work, not one unusually slow subprocess. The recent primary maximum exec event duration is 7.291 seconds; a non-primary exec event lasts 12.684 seconds but lacks a public retained result body.

All recent tools were inspected by their actual event name: no separate wait or poll tool appears. Internal Shell child polling is local, every 50 ms, and produces no model calls. Empty stdout/stderr does not prove an exec was a no-progress poll because the original command is deliberately absent. Growing file results are evidence against labeling those particular reads as no-progress polls. No schema-validation defect is established for these execs; the fixed failures arise after tool invocation.

### Output size and what recurs

Across the 39 retained primary exec results, compact tagged-output serialization totals 11,427 Unicode characters / 11,638 UTF-8 bytes. The largest tagged output is 2,128 characters; largest stdout is 1,950 characters. Six results are structural execution failures. Thirty-three are completed executions, including two nonzero exits; 16 completed results have empty stdout and stderr. None report timeout or truncation. A completed capability with `ok:true, exitCode:1` is not successful command work and must retain that distinction.

In the main case, 10 tagged exec results total 4,953 characters / 5,024 UTF-8 bytes, or 1,242 local heuristic units once. By contrast, the newly recalled result is 10,001 tagged-output characters / 3,278 heuristic units, and the nine newly read file results total 9,542 tagged-output characters / 2,775 units. No raw command length can be measured from retained call parts: every primary exec call has names/identity but no input.

Current primary `prepareStep` returns the SDK's accumulated messages after existing material/native rendering; it does not introduce a new same-loop prune pass. Each result from step `s` can therefore recur in the remaining `19-s` requests. The helper computes a **gross retained-output proxy**, not billed savings: the main case's exec envelopes recur across 56,338 character-instances / 57,403 UTF-8-byte-instances, or 14,134 heuristic units. That is small beside 2,216,733 total local request-estimator units across the loop; the roughly 0.64% comparison remains a serialized-output proxy, excluding actual live arguments, source wrappers, provider representation and heuristic media uncertainty. It cannot be subtracted from 2,309,324 provider input tokens as if those units were identical. Nor can all output be deleted without changing work quality.

### Inherited context dominates the initial request

| Actual measured dispatch | Reported input | Local total units | Tool-interaction units | Conversation units | Summary units |
| --- | ---: | ---: | ---: | ---: | ---: |
| Main request 1, step 0 | 102,472 | 99,453 | 47,414 | 15,458 | 9,489 |
| Main request 4, step 3 | 110,546 | 106,902 | 51,631 | 18,666 | 9,489 |
| Main request 20, step 19 | 122,073 | 116,152 | 57,735 | 21,684 | 9,489 |
| Continuation request 1 | 100,989 | 99,171 | 47,028 | 15,493 | 9,489 |
| Later activity question, request 1 | 95,944 | 92,599 | 39,549 | 16,029 | 9,489 |

The first main request precedes all 24 current tool results and already carries 47,414 tool-interaction units, around 47.68% of its local estimate. It also carries 11,612 tool-definition units, 7,370 injected-memory units, 2,996 persona units, 2,420 instruction units, 921 runtime units and 1,773 other units. The main loop adds 10,321 tool-interaction and 6,226 conversation units; the other listed substantive categories remain constant. Tool-interaction growth includes live arguments and multiple tool families, not only exec output.

Every main dispatch captures a 131,000 effective real-token window. Reported input occupies 78.22% initially and 93.19% at the last request. All main composition events are partial: heuristic media are present, 17,725 units have unknown origin, and unestimated-part count grows from 0 to 11. These source limits prevent exact attribution of the inherited tool history to exec or other suppliers.

The continuation's lower input cannot be called observed exec-output folding or causal savings. Raw tool inputs and reasoning/file/approval parts are excluded from durable replay; earlier full outputs remain stored. Current replay can also fold under pressure or reduce the outgoing request before dispatch. The root's separate offline reconstruction reports all post-4182 rows admitted with no folds/cuts under current fixed calibration, which is current reconstruction rather than a captured historical provider message dump. The historical measurements above prove aggregate category changes; they do not identify which exact retained outputs were included or transformed on each later request.

### Error-associated cost, not guaranteed avoidable cost

The fixed errors establish four compound/no-shell failures and two trusted-PATH program-resolution failures in the recent primary cohort. The November 1 baseline had separately recorded missing-program and PowerShell-quoting mistakes, but the tasks, pricing dates and implementation are not equivalent; there is no causal before/after savings experiment here.

In the main Run, requests 2 and 3 respond to those two failed execs and account for 217,806 input, 1,399 output and 10.791 seconds of model duration, conditionally CNY 0.01379176. The explicit continuation repeats both error families at steps 0 and 1; its requests 2 and 3 account for 206,369 input, 1,796 output and 12.885 seconds, conditionally CNY 0.01172004. Together these four correction-associated requests cost CNY 0.02551180 under the conditional tariff. The main pair also carries legitimate memory invalidation; successful exec evidence still has to be obtained. This associated figure is not the cost of four safely deletable requests, nor a guaranteed saving. Absent original arguments prevents a more specific claim about quoting, executable spelling or the exact proposed correction.

### Decision: one narrow guidance pilot; defer exec-output truncation

The worthwhile next candidate is a reversible change at the existing `exec` tool description, currently beginning with “Run a shell command,” to accurately state that it launches one executable with parsed arguments, has no implicit shell for operators/redirection, and resolves a bare program on the trusted PATH excluding cwd. Retain existing approval and refusal behavior and the documented explicit-interpreter route. Do not add a generic retry framework, a new tool, or a duplicate global prompt section. Current Companion task guidance has no equivalent execution-contract explanation; returned structural errors already supply recovery feedback after the mistake.

This pilot preserves the same full results and call identities; it does not require new summary or original-result recovery calls. Review and model-quality/cost validation remain future implementation work. Compare equivalent script tasks for first-attempt correctness, actual completion, request count, total input/cache/output and elapsed time. Any extra description tokens and changed-prefix cache losses belong in that cost comparison. For scale only, converting 100,000 previously cached input tokens to uncached input once would add about CNY 0.098 at the conditional tariff, exceeding this case's CNY 0.0255 correction-associated accounting. This is a hypothetical cache-loss scenario, not observed attribution or a forecast. Correct first attempts may also free loop capacity, but cannot be promised to finish this task automatically.

Exec-specific output pruning is **deferred**: this cohort has no large exec-output case supporting the benefit, and existing truncation/folding does not by itself establish model-accessible exact-original recovery. If a future large-output case warrants that work, use a bounded status-preserving projection plus an immutable original reference and a non-executing range lookup, then deterministic prune, remeasure and summarize only if still needed. Count lookup requests/output, changed-prefix cache costs, summary costs and any failed recovery. Do not shrink the Shell's safety capture cap or rerun a side-effecting command to recover output. No new production mechanism was implemented in this investigation.

### Files found and code patterns

| File | Relevant pattern and evidence |
| --- | --- |
| `packages/core/src/capabilities/exec-tool.ts:19` | Shell-command wording, single string input, unchanged routed output returned at line 31. Nonzero/timeout/truncation are readable results. |
| `apps/desktop/src-tauri/src/capabilities_impl/exec/sandbox.rs:61` | Only structurally simple argv can spawn; fixed compound/no-shell error. Trusted-PATH failure is constructed at line 110. |
| `apps/desktop/src-tauri/src/capabilities_impl/exec/sandbox.rs:115` | Complete child collection with two capped readers and local 50 ms polling; capped stream collector at line 164. |
| `apps/desktop/src-tauri/src/capabilities_impl/exec/policy.rs:16` | Current capture cap is 1 MiB per stream; timeout is 30 seconds. This is a safety/execution cap, not model-output truncation. |
| `packages/shared/src/capability-outputs.ts:58` | Preserve exitCode, stdout, stderr, truncated, timedOut and duration; killed child has null exitCode. |
| `packages/core/src/agents/agent-attempt.ts:142` | Same-loop message construction/rendering; line 159 returns accumulated native messages. Default cap is 10 at line 34, with injected override at line 177. |
| `packages/core/src/agents/turn-mapping.ts:47` | Raw arguments excluded from persistence; full tagged results persist at line 76 and replay at line 129; call input replays as `{}` at line 118. |
| `packages/core/src/agents/replay-folds.ts:41` | Existing pressure-only projection folding; no fold below budget, originals unchanged. Fact results and snapshot keep-window behavior are distinct. |
| `packages/core/src/agents/conversation-store.ts:196` | Summary substitution, fold, then token selection; exposes fold/cut measurements but the selected historical requests have no full message dump. |
| `packages/core/src/main.ts:572` and `packages/core/src/agents/request-preparation.ts:67` | Existing threshold-driven deterministic reduction and remeasurement before initial dispatch. A new implementation must not claim pruning is wholly absent. |
| `packages/core/src/memory/token-estimator.ts:17` | CJK/non-CJK text heuristic and tagged-output serialization estimator; these are local units, not provider tokens. |
| `packages/core/src/agents/companion-task-guidance.ts:7` | General adaptive-work/whole-outcome rules; no duplicate no-shell/trusted-PATH explanation. |

### External references and related specs

- Current official DeepSeek pricing: <https://api-docs.deepseek.com/zh-cn/quick_start/pricing>, verified by the root on 2026-11-04. Conditional tariff only; no network transmission of conversation content occurred in this research.
- `research/planning-baseline.md` records checked-in pi 0.84.2 and DeepSeek Harness 0.1.1-rc.2 mechanisms. Reused only the bounded projection plus original reference and prune/remeasure/summary principles; no repeated framework survey or new version claim.
- Task `prd.md`, `design.md`, `implement.md`: preserve equivalent task quality, original evidence, cache/output/summary/recovery accounting and explicit decisions before reduction.
- `.trellis/spec/backend/agent-runtime.md`: full call/result fidelity, privacy-excluded durable arguments, same-loop reduction deferred.
- `.trellis/spec/backend/request-attribution.md`: Effect-based physical request correlation, partial estimates and unknown source coverage.
- `.trellis/spec/backend/tool-design.md`: descriptions must explain valid use and actionable failures at the owning tool.
- `.trellis/spec/backend/command-approval-disclosure.md`: exact original-command binding; model projection/recovery must not reconstruct or reauthorize a command.
- `.trellis/spec/backend/compaction-harness.md`: summary replacement authority and original/source truth preserved.

## Caveats / Not Found

- The owner's exact intended “long command” is not independently confirmed. This report identifies the strongest recent long-task candidate and separately distinguishes command text length, process duration and output size.
- Durable commands are intentionally scrubbed. No command text, private filename or unsupported exact quoting root cause is reconstructed. The known fixed error families are sufficient for the narrow contract proposal.
- Model/API usage and local composition are captured; complete historical native dispatch bodies and exact component billing are not. Later-output recurrence has an exact retained source and current code support, but specific historical replay selection remains partially reconstructed.
- No separate model-level wait/poll tool occurs. An unknown exec input could itself perform a local wait or status check; empty output alone cannot classify it as waste.
- No paid model call, production edit, live-data mutation, restart, Git operation or external conversation transmission occurred. Only this task's `research/long-command*` files were written. The legacy global task pointer differs from the explicitly assigned session task; it was preserved.
- Findings support a future narrow exec-description pilot and deferral of exec-result truncation. They do not establish implemented savings, finished reminder behavior, or owner manual acceptance.
