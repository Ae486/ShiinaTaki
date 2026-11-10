# Old/new request costs and Avatar reliability: 2026-11-04

## Result and authorization

The owner requested a checkpoint commit followed by analysis of old/new conversations and increasingly unreliable Avatar calls. Commit `d1c7067` (`feat: unify native images and expose request context`) completed first. It includes the accumulated native-image, attribution/Monitor and model-catalog delivery, while preserving unrelated delegation edits in the working tree. No push or archive was requested or performed.

The investigation establishes growing request size, worsening recent expression-call correction, and a reproducible historical-replay fidelity problem. It does **not** establish that context length alone causes the model's missing arguments. No production optimization or historical rewrite was made during this analysis.

## Source and accounting

- Real database: `C:/Users/55473/.takiagent/taki.db`, read-only SQLite backup including WAL.
- Frozen snapshot: `target/context-analysis-20261104/conversation-115757.db`, captured `2026-11-04T11:57:58Z`; latest natural conversations are November 3.
- SHA-256: `f8b8525f756cf28db62264307739f91358dd156ea60b9f48d1f2b0dd51bb9b93`.
- Canonical `run_usage` counted once per Effect; first request versus continuation determined by dispatch order inside a Run. These are physical requests, not user messages.
- `auxiliary_model_calls` is separate. Null usage is unknown, not zero; auxiliary nullable counters do not have the Run ledger's separate cache-presence bit.
- Composition uses captured `context.request.measured` events correlated by Effect. Component proportions are **heuristic estimator units**, not exact provider token partitions. Provider input remains authoritative for occupancy.
- Dates below are UTC. Historical stored cache pairs predate complete field-presence metadata. They support a stored ratio, not a claim of modern explicit observation coverage.
- Reports contain aggregate counts and identifiers, not private conversation bodies, raw tool arguments or command output.

Reproduce the cohort aggregate from the workspace root:

```powershell
python .trellis/tasks/11-02-context-attribution-token-efficiency/research/analyze-context-cohorts.py --db target/context-analysis-20261104/conversation-115757.db --output .trellis/tasks/11-02-context-attribution-token-efficiency/research/context-cohort-metrics-20261104.json
```

Avatar and command-specific reproduction commands are in their companion reports. Their analyses use the same snapshot and hash. Offline serializer probes use synthetic responses and never contact a model provider. No paid calls or live service restarts were needed.

Validation: the cohort script completed against the frozen snapshot; its SHA-256, cached-plus-uncached totals, first/continuation sums, reasoning-within-output bounds, category/origin sums and auxiliary unknown representation passed explicit checks. The command helper verified 42/42 exact call associations. The Avatar helper verified all 95 recent Avatar calls have exact usage/result links and six sampled final-wire projections match the reconstructed calls. An independent advisor challenged the replay/privacy interpretation against current code and installed SDK source. `git diff --check` passed. Full production suites were not repeated for these research-only additions; the committed delivery's earlier gates remain in `model-identity-catalog-delivery.md`.

## Request size and cost

| Primary cohort | Requests / Runs | Known input coverage | Mean input | Stored weighted cache ratio |
| --- | ---: | ---: | ---: | ---: |
| October 24–28 | 216 / 124 | 214 / 216 | 57,722 | 72.67% |
| November 1, original reference | 39 / 20 | 39 / 39 | 54,368 | 96.06% |
| November 1, whole day | 43 / 24 | 43 / 43 | 54,776 | 91.59% |
| November 2 | 100 / 37 | 99 / 100 | 78,481 | 94.59% |
| November 3 | 59 / 17 | 59 / 59 | 105,289 | 93.81% |

High cache reuse and growing context coexist. The new primary cohort has 13,981,687 known input tokens across 158 of 159 requests; 13,176,832 are cached. This is observational evidence across different user workloads, not a controlled before/after savings experiment.

New primary requests split into:

| Phase | Requests | Known input | Cache ratio | Conditional cost at common off-peak tariff |
| --- | ---: | ---: | ---: | ---: |
| First | 54, 53 known | 4,537,742 | 83.50% | CNY 0.92207 |
| Continuation | 105 | 9,443,945 | 99.404% | CNY 0.38466 |

Continuations account for 67.55% of known input but only 29.44% of this conditional cost. Rewriting their repeated prefix merely to minimize the input counter can damage nearly perfect cache reuse. It needs a net-cost and quality test, not automatic adoption.

Pricing reference checked November 4: [DeepSeek Chinese pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing). Flash off-peak CNY per million: cached input 0.02, uncached input 1, output 4; peak is twice that. The documented weekday Beijing peak periods are 09:00–12:00 and 14:00–18:00 excluding Chinese holidays. These estimates assume the documented direct tariff applies to the observed model/endpoint; they are not invoices or proof of historical routing. Current alias documentation does not establish identical model weights across older observations.

Applying the common off-peak tariff to new primary usage gives CNY 1.30673: cached input 0.26354, uncached input 0.80486, output 0.23834. Applying documented time bands gives CNY 1.76443 (60 November 2 requests are peak; November 3 is off-peak). Price timing must not be mistaken for a code regression.

Other new populations are small but distinct:

- Scheduled Runs: 3 Runs / 10 requests, 797,225 input, 3,270 output; conditional time-band cost CNY 0.21074. These are scheduled work, not evidence of new heartbeat samples.
- Ordinary memory auxiliary work: 21 calls, 20 with usage and one failed/unknown; 24,394 input and 10,713 output, including 9,370 reasoning tokens already included in output. Conditional time-band cost CNY 0.08762. Labels are `canonical-write-gate` and `canonical-local-extraction`.

## What occupies the context

147 captured primary measurements (88 November 2, 59 November 3):

| Category | Weighted estimator share |
| --- | ---: |
| Tool interactions | 43.11% |
| Conversation | 15.98% |
| Tool definitions | 13.20% |
| Summary | 10.79% |
| Injected memory | 8.07% |
| Persona | 3.41% |
| Instructions | 2.75% |
| Other | 1.62% |
| Runtime context | 1.07% |

Tool interactions grow from 39.55% to 47.20% between the two days. This includes inherited tool history and current-loop calls/results; it does not mean command stdout itself is 47% of context. Persona plus instructions are 6.16%, so aggressively shortening them is not the first evidence-selected target.

November 3 mean input occupancy is 80.37% of the captured 131,000 real-token effective window; maximum input is 122,073, or 93.19%. Cache does not remove this occupancy. Summary remains revision 6, through sequence 4182, 13,688 characters, last committed November 1. There is no new completed summary cycle in this snapshot from which to claim summary-policy savings or a new summary failure.

## Avatar: worsening corrections, but no proven length-only cause

The relevant recent sample is expression setting; November 1–3 contains only one motion call, which succeeded. Do not generalize an expression trend to motion reliability.

| Day | Expression calls | Parameter validation failures | All-call failure rate | First expression call failures per Run | Failed episodes later corrected in the same Run |
| --- | ---: | ---: | ---: | ---: | ---: |
| November 1 | 27 | 4 | 14.8% | 4 / 21 = 19.0% | 4 / 4 |
| November 2 | 46 | 9 | 19.6% | 5 / 32 = 15.6% | 1 / 5 |
| November 3 | 21 | 8 | 38.1% | 5 / 15 = 33.3% | 2 / 5 |

The user's observation is supported most strongly by **failed correction**: seven later episodes repeated invalid arguments and ended without a valid same-tool result. First-call failure does not rise monotonically. A failed correction exists at roughly 62–63K input; another succeeds near 97K. October 24–28 already has 54 / 138 expression validation failures (39.1%), so the phenomenon is not new to the latest image/attribution changes.

All 21 recent parameter-validation failures retain an empty validation value with missing required `name`, rather than a wrong expression name. The dynamic enum was already present; current captured allowed-name sets are consistent. SDK parsing maps blank/whitespace argument strings to `{}` too. Raw response arguments are not retained, so the evidence cannot distinguish literal `{}`, omitted/blank arguments, or a transport/streaming problem. Normal no-ops such as `already_active` are excluded from these failure rates even where the generic tool ledger labels an execution failed.

One concrete replay behavior is proven independently of the model's response:

1. `turn-mapping.ts` deliberately persists tool identity/name without raw input.
2. Historical replay reconstructs those calls as `input: {}`, paired with their original results, including applied successes.
3. The real replay/native preparation/provider serializer, with fetch replaced by a local response stub, sends those historical calls as `arguments: "{}"`.
4. Six sampled boundaries agree between replay and serialized output. Early November 1 contains 13 Avatar placeholders, five paired with success; late November 3 contains 107, 63 paired with success.

This is more specific than a generic long-context hypothesis: as history accumulates, the model sees more apparently successful empty-argument examples. **Its causal contribution remains unmeasured.** The mapping predates this delivery (`git show 9326955:packages/core/src/agents/turn-mapping.ts` confirms it). It follows an explicit privacy rule in `agent-runtime.md`, not an accidental omission unique to Avatar. The constraint is understandable; representing unavailable arguments as an actual empty argument object loses fidelity.

The base prompt already explains that historical arguments can be omitted as `{}`, and the tool schema/error already requires `name` from the current vocabulary. Merely adding the same warning again would duplicate existing guidance. Historical native calls are prompt records; replaying their structure does not itself execute the old action.

The replay probe uses current code and the snapshot's latest calibration; it is not an exact historical wire reconstruction. Current source/window and aggressive result-body reduction probes preserve these call placeholders. Rolling-summary input follows a different, textual projection and must not be described as the same native-call problem.

See [Avatar evidence](avatar-error-analysis-20261104.md) and [independent replay challenge](context-replay-advisor-20261104.md).

## Long command: legitimate work plus a narrow tool-contract mismatch

The November 3 sample implements and inspects a reusable parameterized script replacing duplicated scheduled reminder scripts, with related memory organization. The main Run (`5320348d…`, user sequence 4617) has 20 model requests over 105.7 seconds, including 10 `exec`, nine `read_file`, three `write_file`, and memory operations. The owner then explicitly continues the work; that Run adds eight requests. It is consistent with the observed configured step ceiling, not proof of a built-in default of 20.

The main Run's 10 exec events are short (91–3,559 ms including routing overhead). The largest stdout is 1,950 ASCII characters. Across all 39 new primary `exec` calls, retained tagged results total 11,427 characters / 11,638 UTF-8 bytes, with no truncation or timeout. The dominant input is repeated context (roughly 102–122K per request in the main loop), not a huge command output.

There are six structural launch failures: four compound-command/no-shell errors and two program-not-on-trusted-PATH errors. Two other completed launches have nonzero child exit codes; they are not successful command work, and missing original commands prevent classifying their cause or avoidability. The current description says “Run a shell command,” while the runtime directly spawns simple executable invocations unless a shell is explicitly invoked. This is a concrete guidance mismatch. It supports a small platform-aware tool-description/example correction without expanding shell authority or building a command-repair framework.

Four immediate correction-associated requests across the main/continuation Runs total 424,175 input and conditional CNY 0.02551. Some contain useful parallel memory work; this is an associated-cost observation, **not guaranteed avoidable cost**. See [long-command evidence](long-command-analysis-20261104.md).

## Prioritized decision and next bounded work

| Candidate | Decision from current evidence | Quality/cost boundary |
| --- | --- | --- |
| Avatar historical replay fidelity | Prioritize one reviewed pilot; no production change yet | Compare current replay with a truthful compact observation of old Avatar calls/results. Preserve actual outcome, chronology, IDs and recoverable evidence; never fabricate lost `name`, suppress failure, or re-execute the action. Future safe `name` retention is a separate narrowly reviewed alternative to blanket raw-input storage. |
| Exec description and platform examples | Select a small contract-guidance improvement for the next scope | Verify valid executable and explicit-shell cases plus reported failures; do not relax host execution permissions or assume unavailable programs exist. |
| Blanket stdout truncation | Defer for this sample | Outputs are already small; no measured benefit justifies detail loss or recovery complexity. |
| Rewrite every same-loop message / remove tool history | Defer | Continuation cache is 99.404%; preserve call/result pairing, exactly-once effects and truthful action history. Measure prefix invalidation and recovery calls before adoption. |
| Aggressive prompt/persona shortening | Defer | Combined share is only 6.16%; preserve behavior and stable cached prefixes. |
| Summary/background tuning | Continue observation, keep defaults | No new complete summary-cycle comparison. Auxiliary output/reasoning may merit a bounded later experiment, but current conditional cost is much smaller than foreground input. |

For the Avatar pilot, vary representation and length independently at selected early/late boundaries, keeping model, vocabulary and task fixed. Count first-call validity, correction validity, intended-name correctness, action fidelity, request count, usage/cache and total cost. Start with deterministic final-wire tests; use bounded real-provider replay only after the specific comparison is reviewed. All tool execution must be stubbed during response experiments. A model-specific change is justified only by observed results.

The initial observation/image/catalog delivery is committed. This investigation completes the old/new prioritization deliverable. The parent task remains active: the selected reduction pilot, equivalent-quality/net-cost acceptance, any adopted recovery mechanism, complete summary-cycle evaluation and final closeout remain unfinished. Research written after the checkpoint remains uncommitted; unrelated delegation work is preserved.
