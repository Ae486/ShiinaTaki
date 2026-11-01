# Cache and token cost diagnosis and proposed design

Status: implementation authorized on 2026-11-01 after owner review of the concrete scope/cost assessment. Historical data repair and paid application-provider validation/catch-up remain outside this implementation authorization.

## Conclusion

The local data reproduces the owner's concern. Avoidable cost has several interacting owners: interrupted primary-source persistence blocks memory ingestion and compaction; long replay includes oversized recall results and repeated tool diagnostics; a bounded presentation correction sometimes repeats the same invalid call; and per-turn projection changes can invalidate a previously reusable history prefix. Current monitoring cannot explain every cache miss or account for every auxiliary model path.

The accepted near-term direction is to decouple context compaction from completed canonical memory extraction, then make source capture atomic and recovery bounded while reusing existing processing journals. This supersedes the initial recommendation to preserve the synchronous flush gate. The other tool/cost-observation findings remain valid follow-up topics. A higher cache percentage alone is not success: deleting an unnecessary 99%-cached continuation can lower the displayed percentage while saving money.

## Accepted Minimal Design and Effort Envelope

Source truth belongs to the Timeline writer; provider processing belongs to existing Local/Hindsight workers; context compaction belongs to Core's existing summary coordinator. These boundaries remove the second-write failure window and the unnecessary maintenance-before-summary dependency.

The preferred bounded design is one small local primary-source lifecycle representation plus exact Timeline membership, delivered through one additive migration. Capture available Run identity and the admission memory selection as immutable descriptive metadata. One source follows the same input across supported retries; Attempt identity and settlement remain in the existing Run ledger rather than adding a second attempt-state owner. Use the existing write transaction and after-commit publication. Do not call or validate an external memory provider inside the chat transaction: moving the current provider-bound witness callback there unchanged would turn a memory outage into chat persistence failure.

An open source becomes retained or retracted once. Commit actual response rows and retention state together; the existing no-output cancellation case retracts atomically. On startup, close only sources left open by the previous process using their actual retained rows, without inventing assistant output or settling an uncertain model/tool Effect. Source sealing is distinct from asserting a successful Run. Primary-compatible callers without a Run still need a stable local source identity.

Existing provider witness tables remain immutable binding/processing evidence. Bounded ordinary maintenance imports retained sources idempotently and retries unavailable binding without losing the producer record. Preserve captured authority selection and existing Local/Hindsight occurrence ownership; never create two provider bindings for the same occurrence or silently move old work to a new authority. Do not rewrite old `committedThroughSeq` values or replace the existing provider journals.

Compaction keeps actual-source validation, lease/cancellation, quality checks and summary CAS. For canonical Local/Hindsight, it stops requiring completed extraction first. Its trigger must also stop waiting behind the whole maintenance/tidy chain; both branches can reuse their existing serialization and shared Utility Slot. Keep Legacy Markdown's different extraction behavior on a narrow compatibility path. This change does not add a model worker platform or require concurrent paid calls.

The summary must preserve salient facts and currently relevant constraints even when extraction is delayed. Remove the current assumption that permanent facts already belong in long-term memory. A small amount of intentional fact duplication is preferable to an extra per-fact coverage service or a temporary recall gap.

| Batch | Concrete outcome | Planning estimate |
| --- | --- | --- |
| 1. Independent compaction | Remove canonical flush-before-summary blocking, separate maintenance/summary triggers, and correct summary assumptions | 5-7 production/wiring files and 4-6 test/fixture files; normally no source-data migration |
| 2. Reliable source capture and consumption | Atomic local source/membership, retain/retract and startup closure; reuse Local/Hindsight binding and processing; isolate older gaps | 13-19 production/schema files and 6-10 test/fixture files, overlapping composition files from batch 1; one additive source migration expected |
| 3. Historical preview | Review the three old gaps and proposed evidence-backed handling before any data change/catch-up | A bounded read-only preview; live apply and paid processing remain separate |

The combined scope is approximately **18-26 distinct production/schema wiring files, 10-16 test/fixture files and 3-6 existing spec/index documents**. These are estimates grounded in the current call graph, not quotas or promised line counts. Most work is local composition, persistence/consumer adaptation and targeted tests; it does not entail rewriting the Agent or database engine. The main uncertainty is old-data/provider compatibility and failure-path validation.

This envelope excludes the separate comprehensive billing-ledger work, a new management UI, replacement of provider journals, and paid historical catch-up. Batch 1 should deliver useful independent progress first; it must not be described as repairing memory ingestion by itself. See [the independent scope review](research/simplification-scope-review.md) for the exact affected modules and remaining bounded storage/Legacy compatibility choices.

## Evidence boundaries and baseline

Primary source: `C:/Users/55473/.takiagent/taki.db`, read-only with WAL visibility. Latest usage is October 28, 2026 at 22:27 Asia/Shanghai; no active Core was observed. Current worktree code and November 1 provider documentation are newer observations, not an exact historical deployment snapshot.

| Cohort | Requests with usable cache/input pair | Input tokens in denominator | Cache fraction |
| --- | ---: | ---: | ---: |
| Entire recorded usage cohort | 263 of 288 usage rows | 15,268,640 | 68.42% |
| Recent October 24–28 UTC cohort | 219 of 222 | 12,393,358 | 72.65% |
| October 28 UTC alone | 48 | 3,419,478 | 58.86% |
| Primary first request, entire cohort | 152 | 9,057,135 | 48.82% |
| Primary continuation, entire cohort | 104 | 6,157,736 | 97.24% |
| Primary first request, recent cohort | 123 | 6,982,654 | 53.48% |
| Primary continuation, recent cohort | 91 | 5,369,906 | 97.63% |

The headline is a token-weighted ratio, not the mean of request percentages. 262/263 requests have some recorded cache reuse. All known input across 282 rows is 16,657,760; known output is 82,441. The overall median request input is 57,977.5 tokens. Missing detail is excluded, not set to zero. The installed adapter can itself synthesize zero for absent detail fields; raw historical responses are missing for most DB records.

Primary work accounts for approximately 99.7% of known input in this DB; only one child Run and four Heartbeat Runs were recorded. Those observations do not justify disabling background behavior, or extrapolating to untracked auxiliary/test traffic or future delegation-heavy use.

See [runtime-data-map.md](research/runtime-data-map.md), [runtime-metrics.json](research/runtime-metrics.json), [failure-root-causes.md](research/failure-root-causes.md), and [usage-coverage.md](research/usage-coverage.md). The metrics helper checks unique Effects and complete input-detail sums; both checks pass.

### Concurrent current-code implementation

During this investigation, separate workspace work added `docs/PROMPT-AND-TOOL-IMPLEMENTATION-2026-11-01.md` and prompt/schema/family-owned model-output changes. Its checkpoint describes active-tool guidance, historical omitted-argument guidance, the improved dynamic name schema and compact family-specific projections. It reports scripted SDK checks and fixture byte measurements, explicitly without real-provider effectiveness acceptance. Those changes belong to the other work and were not implemented or tested by this diagnosis.

Reuse that implementation and measure its current wire behavior before adding another prompt or result-projection layer. The October 28 DB demonstrates historical costs, not the cost of the concurrent November 1 revision. The measured primary-proof gaps still exist in the inspected real DB; the concurrent prompt/tool checkpoint does not establish their repair. Future comparisons must identify the exact code/config revision used.

## Finding 1: Missing durable primary proof stops ingestion and summary retirement

**Evidence and owner.** The active canonical-local ingestion cursor is stuck at seq 3812. User rows 3816, 3838 and 3847 have no primary witness in the active epoch. 417 witnessed rows remain outside an ingestion span. All 22 failed compaction ranges include the gaps; their 26 failed attempts report `MEMORY_FLUSH_INCOMPLETE`. Summary revision 5 still ends at seq 3715, with 517 later Timeline rows.

`canonical-ingestion-source-repo.ts:187` rejects any unproven user row before ingestion. `memory-flush-port.ts:50` requires that coverage before retirement. `compaction-coordinator.ts:156` returns before its summary call when flush fails. These failures take milliseconds and are not evidence of 22 or 26 paid summary attempts. Their cost effect is downstream: the summary cannot advance, leaving more history to replay/reduce and weakening stable-prefix opportunities.

The three gaps are temporally associated with three still-recovering Runs; no immutable row-to-Run proof exists in the inspected data. The exact interruption cause is unknown. Current `chat-agent.ts` already witnesses ordinary failed/finalized turns in `finally`, but append-before-finalization still has an abrupt-exit window; startup/recovery does not demonstrate repair of existing holes.

**Accepted direction.** Use the local source/membership design above; distinguish an open input from retained actual content, rather than treating model success as a prerequisite for source truth. Preserve existing provider proof and receipt bytes. Process ready, contextually meaningful source groups even when an older unknown gap remains, while reporting that contiguous coverage has not advanced across the gap. Do not concatenate fragments across an unexplained hole as if they were continuous.

The old synchronous flush condition is not a persistence necessity: summary commit updates its checkpoint while original Timeline remains available. The live DB retains 3,706 rows within the current summary boundary. Existing emergency context cuts can already omit unretired text, so blocking summarization does not guarantee context preservation. Summary progress and memory-processing completion should be separate facts.

**Tradeoff.** Atomically storing origin does not make an open or retracted message eligible for extraction. Existing immutable `committedThroughSeq` and provider receipts remain intact; only retained sources are bound. Decoupled summarization must preserve relevant facts while memory is delayed. Exact repair of the three historical gaps still cannot be inferred solely from timestamp proximity. A schema migration must not erase them by relabeling all old role-tagged messages or advancing the ingestion cursor as if they were processed.

Restoring progress can initially increase model use: pending source may need gate/extraction processing and a new summary. Meter this one-time catch-up separately from steady-state input savings; do not promise an immediate lower bill or initiate paid backlog processing under planning authorization.

## Finding 2: Some correction requests repeat a known-invalid presentation call

**Evidence and owner.** Of 163 observed expression calls, 66 fail validation with an independently persisted `Value: {}` and missing `name`. Another 19 receive generic `avatar_rejected`; 18 retained results are normal `already_active` outcomes, and one result is absent in an unsettled Run. The generic failure chart therefore overstates functional failures if interpreted literally.

39 invalid calls have a following model request in the same Attempt. Seventeen immediately repeat the invalid expression; these 17 associated requests consumed 1,011,447 input tokens, including 1,002,880 cached and 8,567 non-cache, plus 807 output. These are recorded usage categories associated with repeated failure, not verified invoice charges or guaranteed fully removable cost: some requests may also contain required user-facing content. Successful corrections and express-first continuations must remain possible.

Current `presentation-stop.ts:25` already permits one correction, stops a second invalid presentation step, stops a spoken valid presentation-only step, and preserves mixed informational work. Current `vocab-name-schema.ts:13` already gives object-shaped guidance. The old measured diagnostics lack that current guidance. Do not add another generic stop/retry wrapper or claim an unbounded loop.

**Proposed direction.** First exercise the current actual wire/schema boundary with missing, invalid, corrected and repeated inputs. If the current guidance resolves the issue, retain it and verify in owner-approved real observations. Otherwise improve the single correction's actionable feedback at its owning schema boundary. Distinguish normal presentation outcomes in monitoring. Treat replayed historical `{}` examples as a hypothesis to test, not a proven cause.

**Tradeoff.** Broadly disabling avatar tools or stopping before needed text saves calls by changing product behavior and is excluded. Restoring arbitrary historical arguments violates privacy. Any revised replay representation must preserve paired-tool compatibility and truthful results without manufacturing valid-looking arguments.

## Finding 3: Large result bodies and repeated diagnostics inflate the replay tail

After the current summary boundary, five recall results contain 92,563 stored characters (largest 37,450), and 55 expression-validation results contain 63,305 characters. Together they dominate the measured tail's tool-result bodies. For comparison, the 129 user rows after the boundary contain 2,798 characters of plain content. These are character measurements of stored bodies, not provider tokens or proof every body was sent on every request.

`turn-mapping.ts` retains tagged tool outputs. `replay-folds.ts` only reduces them under pressure; completed results can therefore recur across later turns until fold/retirement/window admission changes. Large recall bodies can be useful evidence, so length alone does not justify removal.

**Proposed direction.** First evaluate the concurrently implemented family-owned projections against these historical large-result patterns. Where a measured gap remains, use the existing result owner to present compact, deduplicated task-relevant facts plus source/reference identity, explicit completeness, and a working path to exact detail. Keep errors short and actionable: required key, object shape, recovery action; do not repeat the whole vocabulary/validator diagnostic when the schema already carries it. Preserve durable original material when the contract requires it. Measure all subsequent retrievals before claiming savings.

**Tradeoff.** Smaller results may cause extra reads or lose important qualifications; verify answer correctness, citations, contradictions and full-detail recovery. Prefer typed projection over arbitrary substring truncation. Avoid rewriting old cached history for a trivial saving; explicit replay reduction should be deterministic and applied at a meaningful pressure boundary.

## Finding 4: Stable semantic prefixes have several real invalidation boundaries

Sorting tools and moving minute time late are already implemented. The actual unresolved question is where a particular request's prefix first diverges, not whether caching is enabled.

The current-code, read-only replay probe uses real rows and the latest persisted calibration, held fixed across 12 recent user boundaries. Eight of eleven adjacent projections change the first replay message/window start; another changes a folded result after 184 matching messages. Summary inclusion alternates even while `tokenBoundaryHit` remains false. `replay-source-loader.ts:52`, `conversation-store.ts:184`, and `replay-folds.ts:48` explain source admission, summary reachability and reductions. This reproduces a cache-breaking mechanism with the actual dataset; historical per-request calibration, system content and request reductions are unavailable, so it is not a measurement of eight actual cache misses.

Other concrete boundaries include changed pinned/structured memory or a message-selected intention in early system content; day/timezone/persona/catalog changes; disclosure of new schemas; inbox updates; the intentionally non-persisted old user tail; and the names-only replay projection of old tool calls. Semantic freshness and privacy take precedence over keeping stale bytes cached.

An existing separate October 30 provider comparison changed only `messages[0].content`. Observed cache fractions were baseline 99.47%, first changed request 22.73%, baseline 99.47%, repeated changed request 99.13%. This supports treating prompt changes and warm-up separately; it is not a universal estimate. Current official DeepSeek documentation also describes reusable prefix-unit boundaries, warm-up/detection and eviction, which are unobserved conditions in the historical DB.

**Proposed direction.** Record the actual prepared request's safe component identities, sizes, ordered schema digest, replay first/last boundary, summary revision/inclusion, fold fingerprint, and a factual change reason. Compare first requests separately from continuations. Keep stable policy/persona/tool metadata ahead of truly changing current-turn data where trust/freshness contracts permit; stabilize unnecessary representational changes while exposing required semantic changes.

**Tradeoff.** Component digests and estimates do not prove provider cache residency. Avoid retaining raw sensitive prompts or arguments in normal telemetry. A summary/reduction can deliberately invalidate a warm prefix while reducing total future cost. Do not pad prompts, suppress memory changes, persist stale perception, or introduce provider-private cache APIs to inflate hit rate.

## Finding 5: The usage dashboard is a partial cost ledger

`run_usage` covers observed Run model Effects, while context snapshots contain no measured component sizes. Utility/Memory and some vision paths have weaker or unconnected accounting; process-local task counters are not durable provider-request records. Current SDK 7 `generateText().usage` aliases total usage, so it is incorrect to assert all Utility calls count only the last step. Real gaps include dropped result usage, no cache/reasoning breakdown, restart loss and unconnected execution observation; see the coverage matrix.

Some test/diagnostic activity uses separate retained artifacts and is absent from the normal-use DB. The inspected October 30 four-call comparison alone adds 106,337 already-recorded tokens outside it; no whole-account total or exhaustive test attribution was attempted. The normal-use DB cannot reconcile a provider invoice by itself.

**Proposed direction.** Extend existing non-interfering provider observation to the actual auxiliary call sites and existing operation identities. Capture durable per-request known/unknown counters and endpoint/model/price applicability metadata without credentials. Retain failed/cancelled/unknown operation coverage and distinguish physical requests from logical tasks. Sum output once, and preserve raw-field presence when normalized adapters manufacture zero.

**Tradeoff.** Extra optional diagnostics must stay bounded and non-interfering: do not consume a second stream, replace a provider exception, or reissue a paid call when diagnostic storage fails. Existing authoritative Effect/usage settlement is different: its failure must still prevent a successful turn via the existing `assertHealthy` contract; do not hide it behind a best-effort observer. Preserve the provider outcome and explicit recovery without automatic reissue. A separate runtime/ledger authority is unnecessary; use current Run/Event/operation ownership and explicit links.

## Cost model and acceptance targets

For a route whose input already includes cache reads and whose output already includes reasoning:

`cost = (nonCacheInput * inputMissPrice + cacheRead * inputHitPrice + output * outputPrice) / 1_000_000`

Apply the actual provider/account, tariff date, time band, currency and any separate cache-write charge where applicable. Do not subtract cache twice, add reasoning twice, sum both step and Run aggregates, or price historical aliases with an unverified current tariff. No currency amount or savings percentage is established by this diagnosis.

Primary success measures are total billed cost per successfully completed task, non-cache input per first request, total requests, repeated-identical invalid calls, useful result size, and ingestion/summary progress. Track first/continuation cache fractions and p50/p95 input/output/latency as explanatory measures. Compare the same task classes, routing/parameters and correctness requirements. Known/unknown coverage must accompany every total; missing telemetry cannot improve a displayed score.

Acceptance must cover normal conversation, memory-grounded questions with full-detail recovery, avatar express-first and spoken presentation, mixed informational tools, long history, cancellation/crash/restart, and auxiliary calls. Automated checks establish protocol/measurement behavior; real-provider quality/cost comparisons and owner acceptance remain separate and are not performed in this planning session.

## Alternatives considered

| Approach | Benefit | Cost / failure mode | Decision |
| --- | --- | --- | --- |
| Independent compaction plus atomic local source capture, reusing provider journals | Removes the current blocking and second-write failure mechanisms while preserving source truth | One additive source migration and compatibility/crash tests; delayed extraction requires useful facts in the summary | Accepted direction |
| Rewrite/compress all prompts first | May shrink a stable baseline | Does not repair source-proof gaps, may invalidate warm prefixes or weaken instructions; no current component attribution | Only targeted changes after evidence |
| Lower history/step limits, disable tools/background work, or switch models | Immediate upper bound on some spending | Changes required capability/quality; high cache can coexist with failure | Not approved; outside this plan |
| Reuse the entire primary prompt for compaction as DSH does | Potentially warmer summary input | Inherited instructions/tools, output quality, privacy and provider residency are uncertain; pi deliberately chooses a standalone summary instead | A later isolated comparison after compaction works and metering exists |

## Proposed sequence and authorization boundary

[implement.md](implement.md) defines the approved implementation and verification stages. Batches 1 and 2 are now implemented in the T4 worktree, and batch 3 has a [read-only historical preview](research/historical-source-preview.md). Final review and integrated checks are recorded in the implementation report. Real-data repair, paid application-provider validation/catch-up, Git commit/push and task archive remain outside the current action.
