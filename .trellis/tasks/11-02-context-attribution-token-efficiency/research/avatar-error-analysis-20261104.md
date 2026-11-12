# Research: Avatar argument failures, repair degradation, and historical replay

- Query: After the avatar expression/motion revision, did real calls become less reliable, and does increasing context explain the change?
- Scope: mixed — current Core/SDK source, one read-only real-data snapshot, and offline production projection/provider-serialization checks.
- Date: 2026-11-04

## Findings

### Decision-relevant result

The owner's observation of later failed repairs is supported. November 1's four invalid expression episodes all repair on the next request; November 2 repairs one of five, and November 3 repairs two of five. Seven later episodes end after a repeated invalid expression call without a valid expression result. Their Runs are ledger-completed; this does not establish user-task failure or acceptance.

First-call correctness does **not** deteriorate monotonically: November 1 has 4/21 invalid first expression calls, November 2 5/32, and November 3 5/15. The higher November 2 all-call failure rate mainly reflects repeated failures during correction. November 3 has both worse first-call observations and failed corrections. These are small, dependent observational samples.

All 21 November 1–3 expression validation failures explicitly validate an empty object with the required `name` missing. The original provider argument string is unavailable: AI SDK 7.0.148 also maps a blank argument string to `{}` before schema validation. The evidence proves empty **validation input**, not that the model literally emitted `{}` or that no argument deltas were lost upstream.

A concrete source issue precedes any causal conclusion: cross-turn replay represents successful historical avatar calls as executable tool-call parts with `input: {}`. The actual provider serializer writes `arguments: "{}"`, beside retained successful tool results. This is verified through current production projection, native dispatch middleware, and an offline fetch stub. The number of such historical examples grows with the conversation. It is an evidence-backed competing explanation for the context association, but its effect on model behavior has not been experimentally isolated.

### Sources, scope, and files found

| File / source | Purpose |
| --- | --- |
| `target/context-analysis-20261104/conversation-115757.db` | Consistent retained Timeline, Run/Event, usage, summary and request-measurement snapshot; opened with `mode=ro` and `query_only=ON` |
| `packages/core/src/avatar/set-expression-tool.ts` | Expression description, dynamic required-name schema and bounded presentation execution |
| `packages/core/src/avatar/play-motion-tool.ts` | Motion's separate vocabulary and optional priority/loop parameters |
| `packages/core/src/avatar/vocab-name-schema.ts` | Shared enum/nonempty-string validation and actionable missing-name error |
| `packages/core/src/avatar/avatar-vocabulary.ts` | Live reported names, prompt vocabulary and costume-change bookkeeping |
| `packages/core/src/avatar/avatar-tool-result.ts` | Applied, normal rejection, cancellation and unknown outcome mapping/guidance |
| `packages/core/src/avatar/presentation-stop.ts` | One correction for invalid presentation-only steps; preserve a substantive reply |
| `packages/core/src/agents/tool-invocation.ts` | Immutable tool invocation to originating model Effect linkage |
| `packages/core/src/agents/tool-observability.ts` | Payload-free received/settled observations, including schema failures |
| `packages/core/src/agents/tool-outcome.ts` | SDK invalid marker classification; ledger failure is broader than malformed input |
| `packages/core/src/agents/turn-mapping.ts` | Names-only durable call parts and empty-input replay reconstruction |
| `packages/core/src/agents/conversation-store.ts` | Canonical Timeline-to-Replay projection and summary/fold/window pipeline |
| `packages/core/src/agents/native-image-replay.ts` | Calls `toModelMessage`; native image handling does not restore arguments |
| `packages/core/src/agents/agent-attempt.ts` | Primary Replay admission, SDK messages and actual native dispatch construction |
| `packages/core/src/agents/request-preparation.ts` / `context-reduction.ts` | Request pressure reduction protects assistant call parts |
| `packages/core/src/agents/native-image-attempt.ts` | Last native provider dispatch boundary used by the offline probe |
| `packages/core/src/agents/base-prompt.ts` | Existing historical omitted-argument explanation |
| `packages/core/src/main.ts` | Same live vocabulary owner supplies prompt and tool factory |
| `docs/AVATAR-PRESENTATION.md` | Domain/vocabulary rationale; contains older implementation observations, not deployment evidence |
| `packages/core/src/agents/chat-agent-presentation.test.ts` / `turn-mapping.test.ts` | Existing deterministic missing-name/repair/stop and intentional argument-scrubbing coverage |
| `.trellis/tasks/archive/2026-11/11-01-cache-token-cost-diagnosis/research/new-conversation-cost-analysis.md` | November 1 initial 20-Run/39-request baseline and comparison limitations |
| `avatar-error-analyze-20261104.py` / `avatar-error-metrics-20261104.json` | Reproducible read-only aggregate, exact linked cases, repair episodes and offline replay/wire counts |

Snapshot SHA256: `f8b8525f756cf28db62264307739f91358dd156ea60b9f48d1f2b0dd51bb9b93`.
Scope is primary Runs unless explicitly stated. The helper also retains separately classified non-primary avatar events. Reports contain IDs, counts, public vocabulary identifiers and closed diagnostics, not private message bodies, command bodies or raw model arguments.

The root agent confirmed the active session task is `11-02-context-attribution-token-efficiency`; the global `.trellis/.current-task` still names `09-03-avatar-presentation-lab`. No pointer or task state was changed. This researcher executed no Git operation and changed no production source, live DB, service, or other task. Revision evidence below was supplied by the root agent's read-only Git inspection.

### Daily rates, with the original baseline kept separate

Times and day grouping below are UTC. The JSON also retains Asia/Shanghai dates; November 1's 16:01 UTC activity is November 2 locally.

| Cohort | Primary Runs / model requests | Expression calls | Applied | Normal `already_active` | Validation failures / all calls | Invalid first expression / expression-bearing Runs |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Oct 24–28, matching `deepseek-flash` alias | Different older task/session mixture | 138 | 65 | 18 | 54/138 (39.1%) | 37/101 (36.6%) |
| Nov 1 initial baseline, user seq 4233–4323 | 20 / 39 | 23 | 16 | 3 | 4/23 (17.4%) | 4/17 (23.5%) |
| Nov 1 later activity | 4 / 4 | 4 | 3 | 1 | 0/4 | 0/4 |
| Nov 1 all | 24 / 43 | 27 | 19 | 4 | 4/27 (14.8%) | 4/21 (19.0%) |
| Nov 2 | 37 / 100 | 46 | 29 | 8 | 9/46 (19.6%) | 5/32 (15.6%) |
| Nov 3 | 17 / 59 | 21 | 10 | 3 | 8/21 (38.1%) | 5/15 (33.3%) |

The older cohort has one additional ledger execution failure without a uniquely matched Timeline result; its specific presentation reason is unknown. The table does not classify it as a malformed call. November 1–3 have no unknown result pairings or usage-Effect pairings for avatar calls.

There are no motion calls on November 1 or 2; November 3 has one motion call, applied at seq 4692. Oct 24–28's matching cohort has three applied motions and no validation failure. The sample cannot substantiate a separate recent motion reliability trend.

All 95 new avatar results have exact originating model Effect usage links. Only 59 of those have new request-composition measurements, because this instrumentation begins during November 2. November 2's 100 primary usage records include one request without numeric usage; do not turn it into zero tokens. The 21 avatar validation failures have numeric originating usage and uniquely paired retained errors.

### Same-run correction, repeated failure, and associated overhead

An episode starts with a validation failure for a given Run/tool. A valid correction includes an accepted presentation call whose result is a normal no-op. It need not change the current expression. All counted new first failures are in presentation-only steps; their immediate followup requests can be identified by the existing model Effect and request ordinal rather than nearest timestamps.

| UTC day | Invalid episodes | Next same-tool call invalid again | Eventual valid expression | Ended without valid expression | Immediate followup requests | Followup input / cached / uncached | Followup output |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Nov 1 | 4 | 0 | 4 | 0 | 4 | 220,157 / 218,752 / 1,405 | 208 |
| Nov 2 | 5 | 4 | 1 | 4 | 5 | 411,876 / 410,112 / 1,764 | 138 |
| Nov 3 | 5 | 3 | 2 | 3 | 5 | 489,938 / 488,064 / 1,874 | 156 |

Together these 14 associated followup requests consume 1,121,971 input, 1,116,928 cached input, 5,043 uncached input and 502 output tokens. Reasoning is a 42-token subset of output, not extra output. Using only the archived report's **fixed counterfactual** tariff (CNY 1 uncached / 0.02 cached / 4 output per million), their amounts are CNY 0.00661204, 0.01051824 and 0.01225928 respectively, total 0.02938956. This is not a current tariff quote or historical invoice reconstruction. These requests are associated correction overhead, not guaranteed removable savings; a followup may still provide required words or another useful outcome.

Seven later episodes contain two invalid expression steps and no later valid expression: seq 4352→4354, 4493→4495, 4520→4522, 4551→4553, 4577→4579, 4587→4589 and 4596→4598. This fits the existing bounded stop policy, not an unbounded SDK retry loop. No third invalid expression attempt appears in these Runs. All seven Runs are ledger-completed; only the presentation repair is unfulfilled.

`already_active`, `motion_busy`, and `speaking` are documented normal outcomes (`avatar-tool-result.ts:30`). The generic ledger maps `ok:false` to execution failure (`tool-outcome.ts:34`), so counting every ledger `failed` row as an argument error would overstate the issue. `presentationTailStop` stops a second invalid presentation-only step but otherwise preserves express-first-then-talk (`presentation-stop.ts:26`). A valid tool-only no-op can precede a needed spoken response; it is not automatically a wasted retry.

### Representative exact chains

The JSON includes full Run, invocation, model Effect and Timeline references. Timeline `created_at` is batch-commit time, often identical across steps; these observations use `run_events.occurred_at`, exact Effect identity and request ordinal.

| Run prefix / user seq | UTC observation | Timeline tool-result seq | Originating input / cached / output | Outcome |
| --- | --- | --- | --- | --- |
| `b82015c0` / 4233 | Nov 1 12:47:52.143 | 4235 | 49,738 / 1,024 / 163 | Early first-call applied success |
| `a2aa930e` / 4239 | Nov 1 12:49:04.772→05.858 | 4241→4243 | 50,148 / 48,768 / 449 → 50,894 / 50,560 / 42 | Empty validation input → applied correction |
| `7625b4e6` / 4348 | Nov 2 07:53:08.646→10.144 | 4352→4354 | 62,106 / 60,928 / 984 → 63,387 / 62,976 / 24 | Empty input repeated; no valid expression; originating request ordinals 2→3 |
| `010554d0` / 4475 | Nov 2 10:13:57.116→58.960 | 4477→4479 | 78,508 / 77,568 / 246 → 79,051 / 78,720 / 42 | Applied correction; measured SDK steps 0→1 |
| `011ae87c` / 4567 | Nov 3 13:50:53.976→56.182 | 4569→4571 | 96,773 / 1,024 / 77 → 97,147 / 96,768 / 42 | Applied correction even in the later large context |
| `b1c8e23c` / 4594 | Nov 3 13:57:40.787→42.872 | 4596→4598 | 99,134 / 97,792 / 85 → 99,516 / 99,200 / 24 | Empty input repeated; no valid expression |
| `fa870f8b` / 4686 | Nov 3 14:43:06.470→08.524→11.074 | 4688→4690→4692 | 96,872 / 95,616 / 77 → 97,246 / 96,896 / 42 → 97,325 / 97,152 / 65 | Empty input → valid expression with normal `already_active` → applied motion |
| `288e436b` / 4693 | Nov 3 14:43:59.988 | 4695 | 97,444 / 95,744 / 137 | Last observed expression first-call applied success |

The lower-input failed repair at 62–63K and the higher-input successful repair at 96–97K argue against a simple reliable length threshold. They do not rule out probabilistic pressure or instruction competition.

### Context association after removing retry-denominator inflation

Bins use **provider-reported input tokens of the exact originating Effect**, rather than Timeline character counts or estimated history subtracted from provider totals. Only the first expression call in each Run contributes; motion is excluded.

| Reported input bin | New first expression calls | Invalid | Rate |
| --- | ---: | ---: | ---: |
| Below 50K | 2 | 0 | 0% |
| 50K–60K | 20 | 4 | 20.0% |
| 60K–80K | 18 | 3 | 16.7% |
| 80K–95K | 7 | 1 | 14.3% |
| 95K–110K | 21 | 6 | 28.6% |

The highest bin has more first-call failures than the middle bins, but there is no monotonic gradient below 95K and no comparable controlled population. Above 95K has 6/21 failures versus 7/40 below 80K; both denominators are small and contain serially dependent task/session conditions. The same older matching alias had 8/29 first-call failures below 50K, 15/38 at 50K–60K and 12/29 at 60K–80K. Length alone therefore does not explain the old/new difference.

Actual measured request examples show large tool-interaction content: seq 4477 has 29,320/76,062 units; seq 4596 has 45,761/96,297 units. These are estimator units, not exact provider token allocations. At seq 4688 tool-interaction units have fallen to 39,969 with total 93,340 units, while another empty first call occurs. All 59 measured new avatar-origin requests report 11,612 tool-definition units. Stable total schema units are not proof that every schema byte or runtime prompt was identical.

Analytic session groups use a >30-minute gap between primary Run starts, with no durable session ID assumed:

| Group / UTC start–last start | Primary Runs | Expression calls / invalid | Invalid first / expression-bearing Runs | Episodes repaired / invalid episodes |
| --- | ---: | ---: | ---: | ---: |
| 1 Nov 1 12:47–13:04 | 20 | 23 / 4 | 4 / 17 | 4 / 4 |
| 2 Nov 1 14:21 | 2 | 2 / 0 | 0 / 2 | 0 / 0 |
| 3 Nov 1 16:01 | 2 | 2 / 0 | 0 / 2 | 0 / 0 |
| 4 Nov 2 07:50–07:57 | 7 | 9 / 2 | 1 / 7 | 0 / 1 |
| 5 Nov 2 08:44–09:41 | 8 | 11 / 0 | 0 / 7 | 0 / 0 |
| 6 Nov 2 10:13–10:34 | 6 | 6 / 1 | 1 / 5 | 1 / 1 |
| 7 Nov 2 11:29–12:19 | 8 | 11 / 4 | 2 / 7 | 0 / 2 |
| 8 Nov 2 12:49–12:50 | 3 | 2 / 0 | 0 / 2 | 0 / 0 |
| 9 Nov 2 15:52–15:54 | 5 | 7 / 2 | 1 / 4 | 0 / 1 |
| 10 Nov 3 13:50–14:05 | 12 | 15 / 7 | 4 / 10 | 1 / 4 |
| 11 Nov 3 14:39–14:43 | 5 | 6 / 1 | 1 / 5 | 1 / 1 |

These groups help locate episodes, not establish independent experimental samples or application session authority.

### Revision, normalized error onset, and vocabulary evidence

Root-supplied Git evidence: commit `ee76fee` introduced the dynamic enum on 2026-07-19; checkpoint `9326955`, dated 2026-11-01 20:35:35 +0800 (12:35:35 UTC), changes the enum's error/description to the current object example and do-not-repeat-empty guidance. `d1c7067` contains no avatar tool/schema edit. Commit time alone does not establish deployment time.

Retained runtime evidence independently dates the wording change. Oct 24–28's 54 matching expression errors use default/older guidance. The first new custom-guidance error is seq 4241 at 2026-11-01 12:49:04.772 UTC; all 4 Nov 1, 9 Nov 2 and 8 Nov 3 failures use that wording. The normalized empty-name failure itself is much older: the Run-linked primary sample already contains it on Aug 28 at 11:36:29.813 UTC, and the Oct 24 sample at seq 3760 on 12:16:18.464 UTC. This revision improves feedback; it did not introduce the observed failure class.

All 87 matched enum-error instances among the Run-linked avatar cases, including all 21 new failures, contain the same 30 expression names. New errors are `invalid_value` at path `["name"]`, with an empty input object. The exact persisted set is:

`ando01, angry01, angry02, angry03, angry04, bye01, bye02, cry01, cry02, default, idle01, kandou01, kime01, pui01, sad01, sad02, sad03, serious01, serious02, shame01, shame02, sigh01, sigh02, smile01, smile02, smile03, smile04, surprised01, surprised02, thinking01`.

This does not prove there were no costume reports or swaps between successful calls. Successful calls do not retain their names or vocabulary in these canonical rows. It does refute stale **out-of-enum name** as the direct explanation for these 21 errors: they have no name to reject. The all-history Timeline includes older, differently sized vocabulary errors outside this Run-linked comparison; they are not silently treated as the new failure cause.

Current source supplies both schema and prompt through `avatarVocabulary` (`main.ts:548`, `main.ts:557`), and both avatar tools call the same `vocabNameSchema` (`set-expression-tool.ts:24`, `play-motion-tool.ts:25`). The offline factory/SDK/provider check, using the persisted expression set as an explicit fixture, emits `required: ["name"]`, all 30 enum values unchanged, `additionalProperties: false`, and no provider `strict` flag. This verifies current source serialization, not historical full-wire schema capture or this endpoint's strict-mode support. No schema omission or mismatch is demonstrated here.

### Proven argument scrubbing and actual model replay

The actual path is:

1. `turn-mapping.ts:50` persists the tool name and call ID, omitting its original input. All 1,191 historical avatar assistant call parts in the snapshot lack an `input` property. `primary_conversation_sources.memory_json` contains captured Memory provider metadata, not missing call arguments; the snapshot's three `run_messages` rows belong to a subagent, not primary chat.
2. `toModelMessage` reconstructs every stored assistant tool call with `input: {}` (`turn-mapping.ts:118`). This is executable SDK message structure, not merely a UI label.
3. `nativeReplayMessages` uses that mapper (`native-image-replay.ts:37`). `ConversationStore.project` returns those messages to callers (`conversation-store.ts:152`), and the primary attempt consumes them as its history (`agent-attempt.ts:75`, `agent-attempt.ts:235`). The request's late tail and native image handling do not recover names.
4. Request preparation can reduce old result bodies. Its current reducer explicitly protects assistant messages (`context-reduction.ts:88`) and only rewrites tool output or summary content (`context-reduction.ts:183`). An exhaustive `targetTokens:0` probe preserves all assistant avatar call parts and their `{}` inputs. Replay pressure folding has no usable original arguments to recover either.
5. Native middleware observes the actual prepared provider prompt immediately before delegation (`native-image-attempt.ts:48`, `native-image-attempt.ts:69`). The installed OpenAI-compatible serializer writes `JSON.stringify(part.input)` into historical `function.arguments` (`convert-to-openai-compatible-chat-messages.ts:266`).

Same-loop successful inputs are different: the SDK's response-message construction retains `part.input` for valid live calls (`ai/src/generate-text/to-response-messages.ts:85`), and its provider-prompt converter forwards the input. The next request in a fresh turn instead reads the scrubbed durable history. Merely observing `{}` in persisted Timeline proves neither malformed original input nor same-loop scrubbing.

The existing base prompt already says historical arguments may be omitted as `{}` (`base-prompt.ts:37`); vocabulary and custom errors already instruct the model to choose from current names (`avatar-vocabulary.ts:42`, `vocab-name-schema.ts:16`). These rules coexist with numerous success-shaped empty-input examples. Appending the same warnings again would not be a new mechanism.

With the snapshot's fixed latest calibration (131,000 real tokens; factor 1.0373403367542646; history budget 88,398 estimator units), the current pure Replay projection starts at 4183 throughout all Nov 1–3 user boundaries, with revision-6 summary through 4182. It admits all loaded live rows, applies zero **Replay-stage** folds and hits no window/source boundary. This is not a claim that historical request-preparation reductions never occurred: measured requests can have reduced result bodies, and the probe cannot reconstruct transient runtime material or past calibration.

| User boundary | Replay avatar calls, all `{}` | Paired `ok:true` results beside `{}` | Paired normal no-ops beside `{}` | Paired validation results | Offline serialized `arguments:"{}"` |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4233, early baseline | 13 | 5 | 1 | 7 | 13 / 13 |
| 4323, end baseline | 34 | 20 | 4 | 10 | 34 / 34 |
| 4549, Nov 2 failed repair | 79 | 49 | 12 | 18 | 79 / 79 |
| 4594, Nov 3 failed repair | 96 | 58 | 13 | 25 | 96 / 96 |
| 4686, Nov 3 successful correction | 104 | 62 | 15 | 27 | 104 / 104 |
| 4693, last observed user boundary | 107 | 63 | 16 | 28 | 107 / 107 |

All six native-dispatch counts and serialized-wire counts match their Replay counts. The synthetic provider always returns a fixed text response; its fetch callback never contacts a network or executes an avatar command. The source fact is confirmed: a successfully applied historical call is represented to the next model as `{}`. Whether this increases malformed generations is untested. Original names cannot be recovered from the inspected canonical primary-source/Timeline/Event rows; guessing or backfilling them would falsify history. Some process logs may independently record names, but they were not captured in this snapshot or used as canonical recovery evidence.

### Competing hypotheses and prioritized bounded next steps

| Hypothesis | Evidence / counterevidence | Test or decision |
| --- | --- | --- |
| Success-shaped `{}` replay examples bias new empty arguments | Source and final serialization proven; examples grow from 13 to 107. Early errors already occur with 13, and later success occurs with 107. No behavioral isolation. | Highest-priority input-fidelity review. Compare a family-owned faithful historical representation with the current placeholder form; preserve original results, failures and IDs. Do not restore generic raw arguments or invent old avatar names. |
| Total context dilutes current schema/repair instructions | Later ~95–108K requests have more first-call errors; large historical tool content. Nov 2 first-call rate improves, old shorter contexts fail frequently, and 62K repair fails while 97K repair succeeds. | A controlled length × historical-representation comparison is required. Existing observational samples cannot identify a causal length effect. |
| Model/provider emits blank arguments, or streaming transport loses argument deltas | SDK converts blank strings to `{}` (`parse-tool-call.ts:253`). Adapter accumulates argument deltas (`openai-compatible-chat-language-model.ts:528`) but historical raw deltas are absent. | Add only privacy-safe boundary shape facts if approved: raw argument byte count, blank flag, JSON shape/required-name presence and exact Effect/invocation association. Compare streaming and non-streaming on fixed tasks; distinguish emitter, adapter and validation. No evidence currently proves a transport defect. |
| Schema or costume drift rejects a stale name | Same 30 allowed names in every new error; empty objects rather than wrong names. Current factory/serializer agree. Successful vocabulary/costume states remain uncaptured. | Not supported as the direct cause of the new failures. Keep dynamic enums; test an actual costume transition only if observed argument/name evidence changes. |
| Generic unbounded retry bug | Seven failed repairs stop after their second invalid step, as documented. | Rejected for these episodes. Extra retries would change the bounded policy and add calls without addressing first-call correctness. |
| Different task mix / model route / memory / deployment changes | Real episodes vary; one unknown-usage route record exists; aliases and commit times do not establish a checkpoint. Summary remains rev 6, but injected memory and transient context vary. | Hold route/model parameters, clock, schema, memory and task inputs fixed for comparisons. Preserve these variables in natural-use metadata rather than assigning causation from a date. |

Priority 1 is a small, independently challenged historical-avatar representation proposal. Two concrete paths deserve comparison: persist only a reviewed safe avatar argument projection for **future** calls, or render old presentation interactions as explicit argument-omitted historical facts with preserved outcomes/references rather than executable empty-input examples. The latter can address old data without fabricating names. Both need source/protocol pairing and privacy review; broad raw-input persistence or removal of failed results is inappropriate. Historical names must never be reconstructed from the current costume or error example.

Priority 2 is a local deterministic boundary probe for empty string, whitespace, literal `{}`, missing name, wrong name, valid expression and motion. Confirm no execution on invalid input, unchanged normal no-op behavior, error delivery to the next request, one-correction stop and valid same-loop input retention. Existing tests already cover much of this (`chat-agent-presentation.test.ts:69`, `turn-mapping.test.ts:119`); extend only the missing provider/serialization boundary rather than duplicating their assertions. An opt-in shape diagnostic is more useful than logging private raw arguments.

Priority 3 is a **future, separately scoped behavioral experiment**: compare current `{}` success examples against an explicit omission representation at equivalent input length, and compare short/long inputs with representation held constant. The owner's prior authorization for matching bounded paid model calls remains valid; no paid calls were needed or performed in this investigation. Use several fixed equivalent user tasks, identical schema/route/settings, and both initial and correction responses. Synthetic constructed examples must be labelled synthetic; do not claim a fabricated valid name was the historical name. Record first-call valid rate, repeated-invalid rate, chosen-name fit, substantive answer correctness, request/cache/output counts and complete outcomes. The result should decide adopt/reject/defer; no new prompt paragraphs, default expression or retry expansion is justified by the present data alone.

### Related specs and external references

Read `.trellis/workflow.md` and the backend index before conclusions. Relevant current contracts are `.trellis/spec/backend/tool-design.md` (dynamic enums, actionable errors, model projection and one correction), `agent-runtime.md` (actual messages/tool fidelity), `tool-disclosure.md` (actual active schemas; same-loop reduction boundary), `logging-guidelines.md` (private payload exclusion and non-interfering measurement), and `observability-projection.md` (producer-backed, honest unknown metadata). None was modified.

External dependencies were inspected locally at the versions locked in `packages/core/package.json` / `pnpm-lock.yaml`: AI SDK `7.0.148`, `@ai-sdk/openai-compatible` `3.0.75`, provider-utils `5.0.65`, and Zod `4.4.3`. Relevant installed source is `ai/src/generate-text/parse-tool-call.ts:253` (blank-input normalization), `execute-tools-from-stream.ts:115` (invalid calls do not execute), `to-response-messages.ts:85` (valid input retention), and OpenAI-compatible `src/chat/convert-to-openai-compatible-chat-messages.ts:266` (wire arguments). No web query, raw-data upload, provider invocation or inference endpoint call was made. Current fixture serialization does not prove endpoint support for strict tool enforcement.

### Reproduction and checks

Run from `H:/TakiAgent-worktrees/t4` with Python 3.12.7 and Node 24.18.0:

```powershell
python .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-error-analyze-20261104.py --db target/context-analysis-20261104/conversation-115757.db --output .trellis/tasks/11-02-context-attribution-token-efficiency/research/avatar-error-metrics-20261104.json
```

The helper opens SQLite read-only and query-only in a read transaction, checks the file hash, correlates Run/tool invocation/model Effect IDs, and emits sanitized aggregates. Its Node subprocess imports pure production projection and serialization code and provides an offline fetch callback. It does not start services, load credentials or invoke remote APIs. The `--skip-replay` option produces just the DB aggregates; the default includes six offline wire checks and exhaustive current reducer call-preservation checks.

Verified results: 269 avatar result events, 263 primary avatar events; 95 new primary avatar calls, zero new unknown usage links, zero new missing/ambiguous result pairings, zero validation failures lacking explicit empty-object evidence, zero duplicate usage Effect IDs; 59 measured new avatar-origin requests. All six offline wire probes serialize the expected empty avatar arguments, and their fixture expression schema requires the same 30-name enum. JSON/schema-independent count read-back and source hash preservation are checked after generation. This is source/offline evidence, not a behavioral LLM evaluation or manual Pet/UI acceptance.

## Caveats / Not Found

- Raw provider argument strings/deltas are absent. Literal `{}`, omitted/blank strings, and upstream argument loss cannot be separated from retained `Value: {}` errors.
- Successful original expression/motion names and per-success costume/vocabulary snapshots are not stored in the inspected canonical primary rows. Do not infer their names from the current vocabulary, alphabetical example, prose or success result.
- Exact historical full wire requests, transient prompts and runtime calibration are unavailable. The replay/wire experiment uses current code, latest fixed calibration and an offline provider; preserved assistant-call structure follows current source even under request reduction, but result-body counts can differ from historical final dispatch.
- A stable enum in validation errors excludes stale-name rejection for those errors, not every possible costume/report event. The one recent motion call cannot support a trend.
- Failed presentation repair is distinct from user-task abandonment, Run failure, Pet correctness or owner acceptance. Seven Runs ended without a valid expression result; their substantive replies were not graded by this study.
- Context length, history examples, task mix, injected memory, model route and deployment state are confounded. The long-context hypothesis is **compatible with part of the data but not identifiable as the cause**. A simple monotonic/threshold explanation is contradicted by individual chains and rates.
- The prior baseline and memory notes guided source selection only. Current conclusions use the supplied snapshot and inspected code; no production change or paid experiment was performed.
