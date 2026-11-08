# Research: Local retain time and factual attribution contracts

- Query: Does this live historical-transcript test require backdated Local unit timestamps, and where are date/speaker distinctions owned?
- Scope: internal; exact implementation/spec reads, no private dialogue/database/model/service access
- Date: 2026-11-06

## Findings

**A new foreground retain does not automatically backdate unit fields from dates inside its content. Nov6 unit timestamps are not themselves a defect in a Nov6 live turn quoting Nov5 history.** This narrows the temporal caution in `real-content-semantic-review-20261106.md`; do not turn that caution into a schema bug.

| Entry path / field | Actual current contract |
| --- | --- |
| Model-facing foreground `retain` | Only content/layer/context inputs (`packages/core/src/memory/canonical-tools/retain-tool.ts:8`). No date or original-message identity input. |
| Foreground provider request | Creates current `capturedAt`, sends `timestamp:null`, empty metadata and null Timeline/source references (`canonical-tools/canonical-memory-tools.ts:70-78`). Provenance is `explicit-agent`. |
| Local `eventDate` | Explicit provider timestamp if supplied; `unset` means null; null defaults to provider `now()` (`local-memory-provider.ts:155`). This path uses retain time as its default date, not NLP-derived occurrence time. |
| Local `mentionedAt` and lifecycle creation | Taken from request provenance `capturedAt`; occurrence bounds remain null (`local-memory-provider.ts:151-157`). Foreground tool capture is current time. |
| Foreground retained source | Exact supplied retain content plus context/provenance, not automatically the whole originating Chat transcript (`local-memory-provider.ts:153`). |
| Automatic Local source/facts | Last selected actual committed source-message `createdAt` becomes source capture time; original entry roles/times/offsets remain reversible source metadata (`canonical-local-ingestion-batch.ts:54-66`; `canonical-ingestion-source.ts:81-98`). Unit event/mention time uses that capture time, while unit creation uses ingestion time (`canonical-local-ingestion-batch.ts:106-112`). |

The shared unit schema permits these nullable time fields without defining an extraction/backdating invariant (`packages/shared/src/memory-provider-domain-schema.ts:68-77`). The lower provider request accepts explicit date, null and `unset` (`memory-provider-operation-schema.ts:16-20`). Do not infer another promise from column names.

For this harness, the original Nov5 historical date should survive as an **absolute date in retained memory content or interpretation context**, with speaker attribution where needed. The original eight entries' role/date/sequence remain quoted evidence inside a new live user message; they are not actual old Timeline/custody entries. Automatic metadata correctly describes the new outer committed message. A future structured-date feature would be a separate contract change, not a prerequisite invented for this test.

Actual bug evidence would be: an explicitly supplied lower-level timestamp is ignored; retain changes/drops content/context bytes that its caller actually supplied; automatic source metadata disagrees with the actual selected committed rows; or a retained/answered historical date or user attribution contradicts available source evidence. A model omitting a provided historical date from its retain content is a semantic/prompt result, distinguishable from loss during persistence. Current-time defaults and null occurrence bounds alone do not prove any of these failures.

### Existing prompt owners

- `packages/core/src/memory/write-convention.ts:29-34` is the shared write wording owner: user's actual words, transcript-only/no inference, absolute dates.
- `canonical-ingestion-model.ts:74-80` imports this rule for automatic Local extraction. It operates on actual role/time-framed source (`canonical-ingestion-source.ts:81-83`).
- `canonical-tools/retain-tool.ts:8` currently describes safe durable content without importing that rule or explicitly distinguishing assistant assertions from user assertions. This is the narrow foreground prompt seam to inspect if its explicit source-attribution instruction still fails.
- `packages/core/src/agents/base-prompt.ts:37-54` owns memory search/answer truthfulness; `chat-agent.ts:65-68` changes tool vocabulary. These do not supply a detailed foreground write attribution rule.
- `.trellis/spec/backend/canonical-local-memory-runtime.md:56-70` requires exact automatic source preservation, including speaker/time; it does not require parsing nested historical transcripts into backdated custody.

Keep user assertion, assistant report and inference categories in the semantic test. Assistant-only historical claims may be true in omitted history; the issue is promotion to user-expressed facts without the supplied slice's support. The existing no-inference rule is relevant; no general runtime filter or production patch follows automatically.

## Caveats / Not Found

No owner/isolated DB, dialogue, service, test or model was read/run during this contract check. Only this abstract research record was written. The root's active real harness remains independent. No production changes or new test framework are proposed.
