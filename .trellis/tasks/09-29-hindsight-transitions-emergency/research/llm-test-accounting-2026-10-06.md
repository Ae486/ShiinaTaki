# Stage 4 real-data and LLM accounting

Read-only accounting after the final W8 acceptance, prepared for the owner's local-commit delivery report.
No database, model, test or service was started for this accounting. Source reports and raw observations remain
unchanged. The existing reviewer independently aggregated the allowlisted status/usage fields from the retained
551-row observation log and matched the durable submission counters.

## Scope

- Historical D78 conversion produced the reused 722 Sources/documents and 1216 Native units. Its successful third
  run reported 110 HTTP 200 responses and 1,346,264 tokens; those are historical and not included in the 551 below.
- W3 reused real data for structural roundtrip/readback/preservation with no new external LLM request.
- W5 used real external model requests for finite maintenance on RETURN and same-Bank reentry. No full-corpus
  conversion/extraction was repeated. Finalization reused the original completed proof and added zero requests.
- W6 emergency/restart and actual D91 paired restore added zero Native/model requests; W7/W8 used isolated
  deterministic Native fixtures and retained the separately dated real-data evidence.

## Exact W5 submission counts

| Phase | Log rows | Attempts | HTTP 200 | HTTP 402 | No-response exception | Reported total tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| First RETURN | 1-209 | 209 | 9 | 200 | 0 | 120030 |
| RETURN recovery | 210-276 | 67 | 67 | 0 | 0 | 923805 |
| RETURN Global continuation | 277-301 | 25 | 25 | 0 | 0 | 327172 |
| Reentry Character A first attempt | 302-484 | 183 | 24 | 0 | 159 | 384735 |
| A recovery after network repair | 485-526 | 42 | 42 | 0 | 0 | 562486 |
| Reentry Global B | 527-551 | 25 | 25 | 0 | 0 | 313719 |
| Total | 1-551 | 551 | 192 | 200 | 159 | 2631947 |

The 200 billing refusals exposed missing HTTP 402 fast-fail plus recursive consolidation batch splitting. The
delivered Native repair propagates `ProviderBillingError` and stops that retry/split path. The 159 no-response
exceptions have no retained underlying cause chain. A stale startup-IP allowlist was independently shown to refuse
later valid DNS addresses and was repaired; do not attribute every one of those 159 failures to it without evidence.

The verified configuration was OpenAI-compatible `deepseek-v4-flash` at HTTPS `api.deepseek.com`, with no separate
retain/reflect/consolidation overrides. All 551 observation `model` fields are null, so this is a configuration
claim, not a claim that each successful response echoed the model identity.

All 192 HTTP 200 observations contain usage: prompt 2115692, completion 516255, total 2631947. Prompt cache hit
558592 and miss 1557100 partition prompt tokens. Reasoning 325839 is included in completion, not additional usage.
Finish reasons: 176 `stop`, 16 `tool_calls`. Failed attempts contain no usage. Actual monetary cost is not recorded;
these successful-response totals are not a complete billing total, and failed-request usage must not be called zero.

## Evidence and limits

Raw root: `.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97/`.

| Original file | SHA256 |
| --- | --- |
| `model-usage.jsonl` | `21b478df140897483a87eceda6f6590d7f740171b1feed7f8823785014fcf3dd` |
| `model-submissions.json` | `d4ce3e68c7ade368af6bef8c68fe07a1c207e27d2bd84dfbffe9c37dded2e3a2` |
| `reentry-bank-submissions.json` | `dcf9b6aed610f651d120a2571d2977b3992a6af69ac483941d4be98922eb1654` |

See [actual phase execution](w5-working-recovery-execution-2026-10-06.md),
[billing repair](w5-native-billing-scope.md), [configured model](w5-implementation-brief.md),
[final healthy result](w5-healthy-final-result-2026-10-06.md), [HTTP diagnostic](w5-http-functional-result-2026-10-06.md)
and [emergency/paired restore](w6-final-result-2026-10-06.md).

Final real data: 2 Banks, 722 preserved Source/document/application/body mappings, 1275 units and 89 invalidated
(21 existing plus 68 receipt-backed Local expiry changes). This proves the specified preservation/transition gates,
not human answer quality, recall accuracy or semantic-graph benchmark quality. The real queue was empty; nonempty
queue cases are deterministic regressions. Local real embedding used `BAAI/bge-small-en-v1.5`, CPU/384 dimensions,
68 documents in 2.833 seconds; normal reranker initialization is not a retrieval-quality evaluation. Timely
large-corpus ACK, original WebView2/DPAPI recovery and owner/manual acceptance remain separate boundaries.
