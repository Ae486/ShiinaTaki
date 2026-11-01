# Real conversation catch-up result

Date: 2026-11-01, Asia/Shanghai. The owner explicitly authorized real data and paid application-model calls.
This report supersedes the earlier code-only delivery's statement that historical catch-up had not been run.

## Completed on the actual database

Source: `C:/Users/55473/.takiagent/taki.db`. The configured route was `api.deepseek.com`, model name
`deepseek-v4-flash`. Current official documentation maps this accepted alias to DeepSeek-V4.1-Flash-1017 / Flash pricing.
No route, key, model setting, context limit or production prompt was changed for the run.

| Item | Before | After |
| --- | ---: | ---: |
| Applied migration | 062 | 064, via ordinary 063 + 064 registry |
| Unprocessed existing witnesses | 417 | 0 |
| Historical user rows missing witnesses | 3 | 0, explicitly classified |
| Total sources handled this time | — | 420 Timeline records |
| Continuous ingestion coverage | 3812 | 4232, current tail |
| Pending ingestion spans | 0 | 0 |
| Complete ingestion spans | 5 | 7 |
| New facts | — | 5, across 3 Bank/source receipts |
| Summary revision | 5 | 6 |
| Summary through sequence | 3715 | 4182 |
| Original recent rows retained for replay | — | 50, seq 4183-4232 |
| History-only replay estimate | 61,941 | 22,103 |

The 420 records were processed in two production ingestion spans, 256 and 164 proofs. A processed source record is not
the same thing as a new fact: the existing gate/extraction/deduplication policy produced five independently useful facts.
All five were retrieved by the actual Local provider using exact-content queries. This checks index/eligibility wiring;
it is not a natural-language recall quality benchmark.

The committed summary operation is `compact:bb1fabc615e1482411ba8eeb1546bf35067124c86f17717673fb9b24b7d188c7`.
Its source range is 3716-4182, captured tail 4232, expected summary revision 5 and committed revision 6. Source digest,
quality validation, lease and atomic summary CAS all ran through production code. Recent raw rows remain by design;
summary coverage is not supposed to reach the very latest message after every pass.

With the same code/configuration/calibration, replay history dropped **64.316%** in project estimator units. The
previous summary was outside the admitted replay projection; the new summary is now included, alongside the recent tail.
This is not a 64.316% invoice reduction or a full assembled primary-request comparison. Normal conversation cache behavior
after the change has not yet been measured.

## Historical classification and preserved truth

The three retained user inputs at 3816, 3838 and 3847 were individually inspected and accepted as
`operator_accepted_historical_user_source`. An independent advisor challenged this decision before mutation.
Each was recorded through the existing exact source repository with its real ID/digest, a one-row commit boundary,
`run_id=NULL` and the actual classification time. No artificial historical `primary_conversation_sources` capture or
Run-to-Timeline binding was created. The original nearby Runs remain unresolved; their model requests were not replayed.

Classifying before ingestion avoided splitting known history into unnecessary tiny gate calls. The decision and exact
before/after witnesses are retained in `real/historical-classification.json` under the private artifact root below.

Post-run comparison against the pristine backup verified:

- All 4,223 original Timeline rows retain identical original columns/content.
- All 176 Runs, 176 Attempts, 449 Effects and 288 original `run_usage` rows are unchanged.
- All five earlier ingestion spans and all 525 earlier witnesses' immutable fields are unchanged.
- The SQLite integrity check is `ok`; there are zero foreign-key violations.
- The pristine backup's SHA-256 still matches its original manifest.

## Actual calls and estimated price

Five calls succeeded without application retries: two Write Gates, two Local extractions and one summary.
The one-off wrapper records every actual model dispatch/result and raw provider usage; prompts and reasoning text are
not exported into these reports. The SDK's implicit retry behavior was disabled at this boundary by returning a closed,
non-retryable error after any provider failure. No failure occurred and no paid request was reissued.

| Calls | Input | Cache read | Non-cache input | Output, including reasoning | Reasoning subset |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2 gates + 2 extractions | 24,383 | 896 | 23,487 | 9,148 | 8,630 |
| 1 summary | 83,604 | 0 | 83,604 | 19,681 | 11,571 |
| Total | **107,987** | **896** | **107,091** | **28,829** | **20,201** |

The authenticated balance endpoint reported billing currency CNY; account balances were not exported. The official
[pricing document](https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md), read on 2026-11-01, lists Flash off-peak
rates of CNY 0.02 / 1 / 4 per million cache-hit input / cache-miss input / output tokens. The calls occurred on Sunday,
UTC 11:03-11:06, an off-peak interval. Thus:

`(896 * 0.02 + 107091 * 1 + 28829 * 4) / 1,000,000 = CNY 0.22242492`

This is **about CNY 0.22**, calculated from actual returned usage and the public tariff, not an invoice or a measured
balance deduction. Reasoning is included in output and is not added twice. Five usage records have complete raw counters.

This one-time cold background run's weighted cache fraction was 0.83%; the summary used a new, standalone prompt.
That is not a measurement of subsequent ordinary-chat cache hits. Reasoning comprised 70.07% of output, making actual
background reasoning cost and latency a concrete next optimization candidate. Disabling it has not been evaluated here.

## Execution and evidence

The single-writer Core was not running. First, a consistent SQLite backup was made; migrations were rehearsed on a
disposable copy with preservation/integrity checks. The actual database was then upgraded and processed using production
`createCanonicalLocalIngestion` and `createCompactionPass`. The summary used supported history-only pressure (61,941 over
the existing 0.8 * 64,856 threshold), unchanged tail policy and quality checks. No fake pressure or smaller budget forced it.

Private artifact root:
`H:/TakiAgent-worktrees/t4/target/cache-token-cost-real-20261101/20261101T110144Z/`

It contains `pristine.db`, `backup-manifest.json`, migration rehearsal data and `real/` records:
`events.jsonl`, `historical-classification.json`, `ingest-result.json`, `compact-result.json`, `verify-result.json`,
`preservation-check.json`, `recall-verification.json`, and `usage-summary.json`.
The pristine backup SHA-256 is `cd3bfa0033baf4917f6ecaee3de064ad874a2af9581b36260bdbb47f29314e46`.
Sanitized numbers are also in [real-catchup-metrics.json](real-catchup-metrics.json).
The reproducible driver is [run-real-catchup.mjs](run-real-catchup.mjs); phase boundaries permit verification without
reissuing paid requests. Production code was not modified during this catch-up. No Git commit/push was performed.

## Next actions

1. Start normal Core from this updated T4 worktree, for example `pnpm --filter @taki/core start`. This task did not leave
   a background Core or autonomous model loop running. New primary turns use atomic source capture and ordinary
   maintenance; no routine manual catch-up is needed.
2. Complete persistent accounting for actual auxiliary model calls. The old `run_usage` table correctly remains unchanged:
   this catch-up was not a fabricated foreground Run. Its five calls are evidenced in artifacts, while normal Utility Slot
   accounting still lacks a durable complete cache/reasoning series. Provider-facing cost charts must include that work.
3. Observe several normal conversations at unchanged routing/quality, then compare total cost per completed interaction,
   non-cache input, output/reasoning, tool repetition and first-versus-continuation cache rates. Measure after warm-up;
   do not use cache percentage alone as the success criterion.
4. Use the measured gate/extraction reasoning overhead for a small quality-controlled comparison, then revisit large tool
   results and replay-prefix changes. Any future change should preserve successful behavior and actual source retrieval.

Structural and source-attribution spot checks are not exhaustive summary/recall quality acceptance. In particular,
historical avatar guidance or enum counts extracted from a dated conversation are historical evidence, not current
tool capability or permission authority. Current schemas and runtime observations remain authoritative.
