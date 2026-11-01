# New normal conversations and historical cost evidence

Date: 2026-11-01. Worktree: `H:/TakiAgent-worktrees/t4`, HEAD `9326955` with the concurrent tidy repair in progress.
This investigation is read-only except for this report, its sanitized metrics and its reproducible query helper.
No model call, live database mutation, production edit, commit, push or archive was performed by this investigation.

## Result

The new conversations show substantially better cache reuse and a stable, smaller history projection. They do not
justify another cache architecture rewrite. Remaining normal-use spending is concentrated in the initial low-cache
request, user-requested multi-step computer work, and output/reasoning. A few specific command/argument mistakes are
still measurable. Ordinary background ingestion is now visible and must be included in normal-use cost.

The sample is **20 foreground Runs / 39 model requests**, from **12:47:49 to 13:04:24 UTC** (20:47–21:04 Shanghai).
All 20 Runs are ledger-completed. The same session also generated **six ordinary gate/extraction calls**, ending
13:04:32 UTC. Foreground plus this background work used **2,128,576 input**, **89,536 uncached input**, and
**17,770 output tokens including 12,214 reasoning tokens**. At the previously verified Sunday Flash tariff, that is
conditionally **CNY 0.20139680**, or **CNY 0.01006984 per ledger-completed foreground interaction**. This denominator
is an operational proxy; it is not a claim that every answer or requested action passed semantic/manual acceptance.

## Sources, accounting and comparison limits

- New source: consistent snapshot `target/tidy-repair-20261101/before-repair.db`, captured 13:08:19 UTC.
  SHA-256: `a784b20064347b56bf3e897f785654e7ffc33d393094521804fa2ce8a779fd7a`.
- Historical source: `target/auxiliary-usage-20261101/before-065.db`.
  SHA-256: `093bf8a11a25899b3fa1f7bdce865eb2c12006cffe01f245bfaf876eb4da4a39`.
  All **288 historical `run_usage` rows are unchanged** in the new snapshot, including every stored column.
- Matching foreground cohort: `provider=taki-provider.chat`, `model_id=deepseek-flash`, `initiator=primary`.
  It contains 123 old Runs / 214 requests from October 24–28. Older `deepseek-v4-flash` rows and non-primary Runs
  remain separately reported in the JSON. Matching a stored alias does not prove the same served checkpoint or route.
- The nearest old comparison contains 20 Runs / 36 requests, October 28 14:01:54–14:27:45 UTC. This too is a short
  active session, making it a useful descriptive comparison. Its tasks, stored history, summary, memory state,
  deployment, cache residency and provider conditions differ. Neither comparison establishes a causal savings rate.
- All 39 new foreground rows have normalized input/cache/output/reasoning fields. Their input detail sums agree;
  no usage Effect is duplicated. Raw field presence is not retained for historical primary observations, and the
  installed adapter may synthesize zero for missing cache/reasoning details. Unknown coverage remains explicit.
- `run_usage` is summed once. Its duplicate `usage.settled` events are not added. Output already includes reasoning.
  Background `auxiliary_model_calls` are separate physical observations, not additional Runs.
- Pricing reuses the same-day official/account evidence in [real-catchup-report.md](real-catchup-report.md): CNY
  **0.02 / 1 / 4 per million cached input / uncached input / output**. New observations occurred on Sunday.
  Estimates assume the observed Flash alias uses that tariff; no invoice or before/after balance deduction was read.
  Old rows priced in the JSON use a **common-tariff counterfactual**, not their unknown historical bill.
- The four manual tidy calls at 12:44–12:45 are isolated below. The earlier five catch-up calls and six isolated
  reasoning-experiment calls are not normal new conversations. Later repair verification at approximately 13:36 UTC
  is outside this snapshot and this cohort.

## Foreground cohort comparison

Cache is `sum(cache_read) / sum(input)` over rows with both fields. All rows in this table have the pair.
“First” means the first model request in a Run; continuation means subsequent tool-loop requests in that Run.

| Cohort / phase | Requests | Input | Uncached input | Output | Reasoning subset | Cache |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Old matching alias, first | 123 | 6,982,654 | 3,248,382 | 38,768 | 26,586 | 53.48% |
| Old matching alias, continuation | 91 | 5,369,906 | 127,026 | 14,362 | 5,375 | 97.63% |
| Nearest old 20 Runs, first | 20 | 1,383,409 | 908,017 | 9,020 | 6,443 | 34.36% |
| Nearest old 20 Runs, continuation | 16 | 1,108,292 | 60,100 | 2,790 | 1,132 | 94.58% |
| New, first | 20 | 1,067,828 | 76,980 | 5,889 | 3,828 | 92.79% |
| New, first excluding initial low-cache Run | 19 | 1,018,090 | 28,266 | 5,726 | 3,751 | 97.22% |
| New, continuation | 19 | 1,052,511 | 6,495 | 8,481 | 5,377 | 99.38% |
| New, all foreground | 39 | 2,120,339 | 83,475 | 14,370 | 9,205 | **96.06%** |

Mean new input is **54,368 tokens/request**; median is **53,827**. The new first-request median is 52,328,
versus 68,016.5 in the nearest old 20 Runs and 55,007 across the full matching old cohort. Total input is lower than
the nearest old cohort's 2,491,701 despite three additional requests; output is higher than its 11,810. Task mix
matters: the new session includes interactive computer control and an open-ended capability demonstration.

The first new request alone has 49,738 input but only 1,024 cached tokens. Its conditional cost is CNY 0.04938648,
**27.18% of foreground cost**. This is consistent with a cold or changed prefix after new code, summary and memory;
the retained data does not isolate which. Excluding it is a sensitivity view, not permission to hide startup cost.

New foreground cost decomposes into CNY **0.083475 uncached input + 0.04073728 cached input + 0.057480 output**.
After the initial request, output costs more than uncached input. A nearly perfect continuation cache does not make
unnecessary continuations free, but removing one must preserve required tool feedback and substantive final content.

## Every new foreground Run

IDs are shortened only in this table; full IDs, request rows, outcomes, times and tool events are in
[new-conversation-cost-metrics.json](new-conversation-cost-metrics.json). All rows below have `run_state=completed`.
“A” counts avatar calls; “E” counts exec calls. Times are UTC.

| Run / time | User seq | Requests | Input | Cached | Uncached | Output | Reasoning | CNY estimate | Tools / significant outcome |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| b82015c0 / 12:47:49 | 4233 | 1 | 49,738 | 1,024 | 48,714 | 163 | 77 | 0.04938648 | A1, applied; initial low cache |
| 0a2f82a3 / 12:48:19 | 4236 | 1 | 49,511 | 48,768 | 743 | 422 | 332 | 0.00340636 | A1, applied |
| a2aa930e / 12:49:00 | 4239 | 2 | 101,042 | 99,328 | 1,714 | 491 | 332 | 0.00566456 | A2, empty input then corrected |
| a65714f2 / 12:50:25 | 4244 | 1 | 50,590 | 48,896 | 1,694 | 1,032 | 747 | 0.00679992 | A1, already active |
| 78d61449 / 12:51:11 | 4247 | 1 | 50,882 | 49,408 | 1,474 | 338 | 161 | 0.00381416 | A1, applied |
| cfab03fb / 12:51:46 | 4250 | 1 | 51,249 | 49,792 | 1,457 | 494 | 363 | 0.00442884 | A1, already active |
| 0269e58f / 12:52:02 | 4253 | 1 | 50,398 | 49,920 | 478 | 219 | 149 | 0.00235240 | A1, already active |
| 288d7bd8 / 12:55:31 | 4256 | 3 | 156,309 | 154,624 | 1,685 | 2,318 | 1,751 | 0.01404948 | E2/A2, inspect browser before selecting a close target |
| f7d65ac0 / 12:56:56 | 4263 | 6 | 323,185 | 320,256 | 2,929 | 2,732 | 1,677 | 0.02026212 | E4/A2, close specified target and verify |
| 9aab646a / 12:57:52 | 4276 | 1 | 52,272 | 50,944 | 1,328 | 67 | 36 | 0.00261488 | No tool |
| 6a43096f / 12:58:46 | 4278 | 1 | 52,922 | 51,712 | 1,210 | 87 | 0 | 0.00259224 | A1, applied |
| 36cffe62 / 12:59:01 | 4281 | 2 | 105,216 | 104,192 | 1,024 | 192 | 57 | 0.00387584 | A2, empty input then corrected |
| 0154a61e / 12:59:23 | 4286 | 1 | 53,337 | 51,840 | 1,497 | 140 | 71 | 0.00309380 | No tool |
| b1283a7e / 13:00:07 | 4288 | 9 | 509,671 | 504,832 | 4,839 | 4,418 | 2,819 | 0.03260764 | E16/A1, requested computer capability demonstration |
| 71eb796a / 13:02:06 | 4307 | 1 | 57,522 | 52,352 | 5,170 | 464 | 305 | 0.00807304 | A1, applied; first request after large tool episode |
| 5f60c71e / 13:02:37 | 4310 | 2 | 115,650 | 113,920 | 1,730 | 231 | 93 | 0.00493240 | A2, empty input then corrected |
| d7f8a207 / 13:03:11 | 4315 | 1 | 58,156 | 56,320 | 1,836 | 186 | 119 | 0.00370640 | No tool |
| 5a43cc5a / 13:03:49 | 4317 | 1 | 58,303 | 56,832 | 1,471 | 177 | 74 | 0.00331564 | A1, applied |
| 62112336 / 13:04:13 | 4320 | 1 | 57,950 | 56,960 | 990 | 123 | 42 | 0.00262120 | A1, applied |
| 5f6b3cbc / 13:04:22 | 4323 | 2 | 116,436 | 114,944 | 1,492 | 76 | 0 | 0.00409488 | A2, empty input then corrected |

## Expensive episodes: avoidable work and useful work

**Computer tasks.** The three exec-bearing Runs account for 18 requests, 989,165 input, 9,468 output and
CNY 0.06691924, **36.83% of foreground cost**. They are not three ordinary greetings that accidentally looped.
The owner first invited browser inspection/closing, then selected a particular target, then explicitly requested an
open-ended demonstration of exec capabilities. The first inspection ended without closing an ambiguous target;
the next Run performed the specified close and verified the result. Counting both as fully successful closed-page
tasks would be wrong, but deleting the inspection/verification would change the behavior the user requested.

The six-request close Run contains the same non-null Host input digest twice. These calls bracket the actual change;
the corresponding result lists contain six items before and five afterwards (seq 4267 and 4271). This is useful
verification, not proof of blind repetition. An avatar-only step at seq 4272 is followed by the substantive final
answer at 4274; the continuation cannot simply be removed as presentation filler.

The nine-request demonstration has concrete avoidable mistakes: **two `wmic` calls fail in the same initial batch
because the executable is absent**, and a later PowerShell/CIM query has invalid filter quoting and exits 1
(seq 4290 and 4294). The two initial failures are parallel proposals, not a retry after seeing the first error.
The valid later calls gather distinct system facts. There is no evidence that all 16 exec calls can be removed.
The nonzero-exit call is ledger-`completed` because the exec capability completed and returned a command result;
`exec-tool.ts:22` explicitly requires the model to inspect exit status. Tool transport success is not task success.

**Avatar.** New activity contains 23 expression calls: **16 applied, four schema failures with empty objects,
and three `already_active` rejections**. Each of the four invalid calls is corrected successfully on the next request;
none repeats the invalid call. Matching old activity has 54 validation failures across 138 expression calls and
17 repeated-invalid followups. Of the old presentation-only invalid calls with a next request, 17/37 repeat failure;
newly observed correction is 4/4. Different samples and small new cardinality preclude a reliable rate claim.

The four new correction requests together cost CNY **0.00661204** (220,157 input, 1,405 uncached, 208 output),
only **3.64% of foreground cost**. This is an associated upper bound, not guaranteed removable savings. Existing
dynamic enum/error guidance already says to provide `name` and not repeat `{}` (`vocab-name-schema.ts:12`), and
`base-prompt.ts:37` explains historical omitted arguments. Re-adding these mechanisms is not a new optimization.
All three `already_active` outcomes stop without another request. `avatar-tool-result.ts:31` explicitly treats them
as normal and forbids retries/apologies. They are not three presentation bugs or paid retry loops.

## History size and prefix behavior

The real persisted summary is **revision 6, through seq 4182, 13,688 characters**, committed at 11:06:47 UTC.
The 20 new primary sources are all retained with exact membership, through 4327. No new summary is produced during
this short sample; that alone is not a failure or evidence that another compaction is needed.

The reproducible current-code replay projection covers every new user boundary. Using the snapshot's latest
calibration (`effective_window=131000`, factor `1.063771519480805`, history budget 86,202 estimator units):

- Every point starts at **4183**, includes the summary, preserves its existing leading messages, and admits all
  available post-summary rows. There is **no boundary movement, result folding or emergency cutoff**.
- History grows from **22,112 to 29,852 estimator units**, including a 9,493-unit summary. These are project estimates,
  not provider tokens. They exclude instructions, schemas, the current transient tail and later request preparation.
- The older [replay probe](replay-projection.json) had eight window-start changes across eleven transitions and
  intermittent summary omission. Its fixed calibration was different. The new result supports the repaired
  compaction/history explanation, but does not numerically attribute the provider cache improvement to one patch.
- Old large recall seq 3908 (37,450 characters) and 4092 (19,691) are now behind the summary. **Seq 4218's 15,470-character
  recall and seq 4184's 7,402-character search result remain in the active tail**. New tool results peak at just
  5,238 characters (one exec result); there is no new giant recall episode in these 20 Runs.

`turn-mapping.ts:62` retains tool results and `replay-folds.ts:37` folds only under pressure. Current Memory output
already has a family-owned projection (`memory-tool-model-output.ts:17`); new projections do not rewrite previously
stored result bodies. Retained large bodies are a measurable candidate, not permission to drop their evidence.
With a warm prefix, 10,000 cached tokens repeated across 20 requests cost only CNY 0.004 at this tariff. A lossy
rewrite or extra retrieval roundtrip can cost more than it saves.

The roughly 54K provider input/request still merits component measurement. It cannot be safely partitioned by
subtracting estimator history units from provider tokens. All 20 new `context.snapshot` rows still report unknown
accounting. Current `request-measurement.ts:37` computes components, but `main.ts:221,563` keeps only the latest
process-local value and `run-snapshot-capture.ts:97` still records replay as `not_captured`. Reuse that existing
measurement seam if durable attribution is needed; there is no evidence requiring a second billing framework.

## Background and manual maintenance

| Cohort | Calls | Input | Cached | Uncached | Output | Reasoning subset | Conditional CNY |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Ordinary new background: four gates, two extractions | 6 | 8,237 | 2,176 | 6,061 | 3,400 | 3,009 | **0.01970452** |
| Manual tidy before new conversations | 4 | 86,513 | 71,936 | 14,577 | 13,512 | 8,652 | 0.07006372 |
| Earlier historical catch-up | 5 | 107,987 | 896 | 107,091 | 28,829 | 20,201 | 0.22242492 |

Ordinary background is **9.78% of foreground-plus-background estimated cost**, despite using less than 0.4% of its
input tokens. Four gates alone emit 2,082 output tokens, including 2,026 reasoning; the two extractions emit 1,318
including 983 reasoning. The low background cache percentage is not the principal problem in this small payload.

The four tidy model invocations completed, while the logical tidy pass only partially completed because of the
separately repaired recovery/diagnostic issue. Model-call completion and useful maintenance completion must remain
distinct. This report does not use the subsequent repair verification as normal traffic or claim its outcome.

[reasoning-quality-review.md](reasoning-quality-review.md) remains decisive against globally disabling thinking:
the bounded experiment had a truncated summary, a completed control with material omissions/attribution errors,
and an extraction quality regression. Two gate keep cases alone did not cover skip cases or downstream behavior.

## Prioritized next directions

1. **Measure and retain the working compaction/prefix behavior before changing it again.** This is an implemented
   fix needing normal-use measurement, not another implementation proposal. Observe the next naturally occurring
   long session, restart/cold start, memory edit and eligible summary; record first/continuation input and cost,
   summary revision/source-window movement, and relevant fact/constraint recall. Reuse the existing measurement
   producer for component estimates if the remaining ~54K cannot otherwise be explained. Keep original Timeline and
   normal memory updates; freezing memory or forcing repeated summaries solely for cache would change semantics and
   introduce more paid work. Success is sustained lower cost for the same completed interactions with intact recall.

2. **Remove the observed Windows exec mistakes and unnecessary sequential discovery at their existing owner.** This
   is a new bounded optimization candidate: test the actual supported parser/quoting path and provide one concise
   Host-specific execution pattern through existing guidance/Skills. Prefer available PowerShell/CIM facilities over
   absent legacy utilities; batch only independent read-only queries whose purpose is already known. Validate the
   observed missing-executable and filter-quoting cases plus one inspect/change/verify scenario, first without a model,
   then with a small approved real task sample. Measure command failures, model rounds and task correctness. Preserve
   the permission gate, before/after verification and adaptive queries; do not add a general OS-control framework or
   equate 16 tool calls with 16 redundant operations. Exact currency savings remain unmeasured.

3. **Consider gate-only reasoning reduction; preserve extraction/summary thinking until quality supports a change.**
   This is a separate experiment, not an approved default switch. Gates account for nearly all of their own output
   in reasoning. Extend the existing fixed-input comparison with keep, skip, correction/contradiction and private-fact
   cases; compare the exact selected source membership and downstream retained facts, not just valid JSON. Use
   cache-neutral pricing alongside returned-cache pricing. Passing cases can support a narrow gate decision; failures
   keep the default. Do not save a fraction of a cent by losing durable facts or making a broad new routing system.

4. **Continue observing first-call avatar correctness, with no additional retry mechanism.** Current correction
   guidance appears useful in this sample: all four mistakes recover once, compared with repeated-invalid old cases.
   Remaining empty first calls are real but low-cost. Validate actual supplied schema and missing-name behavior if
   recurrence remains material across costumes; retain the dynamic enum and existing bounded stop policy. Do not
   invent a default expression, classify `already_active` as failure, or expand prompts without behavioral evidence.
   The current sample's correction-cost ceiling is CNY 0.00661204, which constrains the engineering return.

5. **Evaluate only the large retained result bodies before broad prompt trimming.** This is a lower-priority candidate
   because most input is warm and existing family projections already reduce new output. Start with the active old
   recall/search bodies and their subsequent uses. Compare a deterministic evidence-preserving projection against
   the original on actual follow-up questions, including exact source/details recovery and failure/empty distinctions.
   Count extra retrievals and the one-time cache invalidation. Preserve original records and a working recovery path;
   avoid generic truncation, wholesale history deletion or a new retrieval platform. Do not pursue the change if
   measured total cost or quality is worse.

No hard token/request/step threshold is proposed. The evidence supports these concrete seams and bounded validation,
not a universal cap or a promised percentage saving. The one-time catch-up cost should be amortized separately from
ordinary use; successful code repair alone does not prove long-term monetary return.

## Reproduction and checks

Verified with Python 3.12.7 and Node 24.18.0 from the T4 worktree. The helper opens both SQLite snapshots with
`mode=ro` and `query_only=ON`; its Node subprocess
uses only the existing pure replay projection and a read-only database handle. The output contains no message text,
tool arguments, command bodies, stdout/stderr bodies, prompts, reasoning text, account balance or secrets.

```powershell
python .trellis/tasks/11-01-cache-token-cost-diagnosis/research/analyze_new_conversations.py --db target/tidy-repair-20261101/before-repair.db --old-db target/auxiliary-usage-20261101/before-065.db --output .trellis/tasks/11-01-cache-token-cost-diagnosis/research/new-conversation-cost-metrics.json
```

The query completed successfully: 288 original usage rows preserved, 39 new rows, zero duplicate usage Effects,
zero complete-detail sum mismatches, 20 retained new source records, and 20 replay boundaries. JSON/read-back and
owned-file whitespace checks passed. This is observational/offline evidence, not a new real-provider or manual UI test.
