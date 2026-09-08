# Research: Minimum native-result and append protocol after G1

- Query: What is the smallest implementable producer protocol for reliable native-result recovery and factual checkpoint confirmation, retaining native append and large-input behavior after G1 removed routine derived-chain waiting?
- Scope: internal, H:/hindsight provider source; Taki decision records and leader-provided consumer constraints only. No consumer implementation investigation.
- Date: 2026-09-07
- Baseline: leader-verified local Hindsight `7eca2056dae5d70a682b755abfff8a107f6b08a0`, package `0.9.0`, including the accepted compatibility series. This is not a claim about latest upstream or a running instance.
- Decision precedence: current task `grill.md`, especially G1 and its prior-decision index, supersedes the per-write derived-wait recommendation in the three earlier research reports. Those reports remain unchanged source evidence.

## Findings

### Recommendation and readiness

Implement **durable native admission/result receipts plus retain-part receipts in the existing streaming pipeline**. Keep native extraction, chunking, delta and maintenance timing. No per-write source/MM graph, root finalizer, new scheduler or atomic-buffer limit is required.

One immutable request identity owns the committed factual parts and their journal boundaries. Replay cannot repeat a fragment or committed part. Completion requires a sealed full result manifest and Taki application of its factual prefix; later derived changes use the ordinary journal.

Whole-document atomicity is **not necessary**. Native streaming already exposes intermediate factual state. Preserve it, but report incomplete/superseded outcomes honestly after failure, cancellation or competing takeover (`retain/orchestrator.py:1950-1965`). Preserving applied parts does not authorize calling them complete or blindly replaying them.

The protocol is concrete enough for one implementer to begin deterministic RED cases; it is not tested. Complete coverage across outer slices, delta, zero-fact chunks and provider Batch API is the gate. If a seam cannot establish coverage, report that specific blocker instead of inventing an input cap.

### Verified source seams

Paths in provider citations are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/` unless stated otherwise.

| Source | Current behavior and implication |
| --- | --- |
| `engine/memories/conditional_mutation.py:14-65,165-249`; `memory_engine.py:9024-9057` | Mutation fingerprint, unique claim, original response and journal are already transactional. |
| `engine/replication.py:376-402,1020-1099` | Bank lock and returned `AppendedLogicalBatch.last_cursor` supply factual fences. |
| `engine/memory_engine.py:16435-16518,16537-16707` | UUID replay lacks payload comparison; parent/child payloads are admitted atomically; one document stays in one child. |
| `engine/memory_engine.py:590-658,4140-4307` | Sequential outer slices retain original-input mapping, full-body overrides and chunk offsets. |
| `engine/retain/orchestrator.py:955-1098,1407-1452,2074-2120` | Append assembly exists; generated-ID/hash/debug recovery and stale empty returns are insufficient proof. |
| `engine/retain/orchestrator.py:1711-1808,1861-2024,2237-2295` | Per-batch writer/journal seams exist; zero chunks need not be stored; fallback outbox/current-ID reload are unsafe history substitutes. |
| `engine/retain/orchestrator.py:2642-2865,2927-2990` | Delta/no-op transactions preserve survivors but return only new IDs or empty groups. |
| `engine/retain/fact_extraction.py:1871-1915,2513-2599` | Ordinary failures propagate; chunks mode and Batch API are separate native modes. |
| `engine/retain/fact_extraction.py:2012-2029,2157-2177,2456-2460` | Batch API uses one operation-level checkpoint and can return errored chunks as zero facts. |
| `engine/memory_engine.py:2588-2677,4341-4404`; `extensions/operation_validator.py:202-242` | Outbox has a writer connection; public post-retain hook is post-commit and non-fatal. Neither is a full receipt. |
| `engine/memory_engine.py:15767-15820`; `engine/maintenance.py:234-297` | Queue rows are prunable/deletable; deleting a failed child can alter native parent roll-up. |

### 1. Conditional mutation: small factual-proof addition

Reuse the existing mutation claim, fingerprint, expected-revision semantics and original result. Do not build a second mutation implementation.

For opted-in calls, take and verify the expected provider lineage/Bank generation under the existing Bank-state lock before the source mutation. After `append_logical_changes` at `memory_engine.py:9051-9057`, record its returned boundary and the original result in the common native receipt **on the same `conn` and transaction**. For an actual no-op, seal the unchanged result with the locked Bank boundary and an explicit no-op outcome; do not append an empty journal batch. Keep the old mutation response/receipt behavior intact.

Proof is `request identity + original result hash + lineage/generation + native_through_cursor`. Rollback removes all four; commit/lost ACK preserves all four. Read proof before the current target, surviving later edit/deletion. Maintenance submission at `:9076-9091` remains outside routine completion.

Old receipts lack the original cursor. Keep their known success/read compatibility, but do not attach today's cursor or re-run the mutation as retrospective proof. They need explicit unavailable-boundary handling or separately validated reconciliation.

The common table can hold new proof without changing historical mutation schema/models or source-store implementations.

### 2. Admission and public surface

Recommended wire placement: **tracked admission/mutation and result reads on `/ext/taki-memory`**, delegating to engine-owned `submit_tracked_retain` / `update_tracked_memory`. These reuse native async submission/mutation with an optional internal receipt context. Native/untracked HTTP requests and their SDK parameters stay unchanged. Official post-operation hooks still lack the transaction seam.

The extension request carries contract version, expected lineage/generation and the original native UUID. Reuse native item/update models and engine validators. Extract shared HTTP mapping/precheck helpers where needed: `http.py:7756-7787` normalizes strategy/items, `:4371-4379` distinguishes absent/null update times, and `:3958-4024` handles pre-body precheck. Do not call nested FastAPI handlers or copy a second semantic implementation. Legacy differing-payload UUID replay remains tested at `tests/test_async_retain_operation_id.py:121-146`.

Admission performs the following in the native parent/child transaction:

1. Authenticate/validate through the existing engine and HTTP precheck paths. Require an existing admitted Bank generation; a stale tracked worker must not recreate a Bank through `_ensure_bank_exists` (`memory_engine.py:4083,16606-16613`).
2. Claim the unique native UUID against a provider-computed versioned normalized request fingerprint. Persist the exact original-input/child association and generated document identities, not just `items_count`. Identical retries reuse this claim; different payloads conflict before dispatch.
3. Insert the ordinary full native child payloads with the receipt context identifier. Return acceptance after the transaction and notify the existing backend after commit, as native submission already does. Do not call a synchronous backend with the transaction open.
4. On receipt-backed retry, return completed results immediately; resume only the recorded incomplete native work under its original identity and native retry policy. A missing legacy/pruned untracked operation remains unknown. Fixed expected inputs/children survive queue deletion and cannot shrink to make a parent look successful.

Suggested extension surface, names to freeze in design:

- `POST /ext/taki-memory/banks/{bank}/retains`: tracked native async admission; corresponding tracked conditional-mutation route uses native update normalization/CAS.
- `GET /ext/taki-memory/banks/{bank}/native-results/{kind}/{id}`: authenticated receipt/status/manifest with lineage/generation checks.
- `GET .../{kind}/{id}/results/{result_hash}/pages/{page_number}`: immutable result references with stable ordinals, count and hash verification.

Reads never execute memory work. Pending/partial/failed/cancelled/superseded/unavailable are typed states; missing proof does not mean no write. Reuse shared typed error envelopes.

Public result fields: schema/contract version, operation kind/UUID, Bank identity, normalized request hash, prepared-input hash per original input, original document/update mode, native outcome, extraction-created count, full resulting source count, immutable result-manifest identity/hash, native receipt hash and `native_through_cursor`. Progress is mutable separately; it must not change a sealed result hash. No local Taki epoch or local intent hash is provider evidence.

Hash the original normalized public command as `request_hash`; hash the actual input after validator enrichment, sanitization, defense and native append assembly separately. Persist plan version and required non-secret settings, not credentials. A retry must not silently reinterpret an incompatible stored plan.

### 3. Preserve streaming with exact preparation and part records

#### Preparation before the first canonical write

Persist a typed per-original-input plan containing:

- Native child ID and original input index; stable document ID; update mode; admitted request hash.
- Actual sanitized/defense-processed effective content items and native append base, including conversation-array assembly. Keep private replay material private.
- Base existence/body availability, resulting full document hash, and a producer-read base witness.
- Native resolved chunk/strategy settings needed to reconstruct the same plan; outer sub-batch/input mapping, first-batch flags, body overrides and global chunk offsets.
- Exact planned part identities and coverage: original input, outer sub-batch, global chunk ordinal, chunk hash and relevant content-item context. A delta publication is one typed part describing its changed/new/removed and preserved set. A metadata/no-op publication is explicit.

Reuse native assembly/chunking/prompts. Persist effective append input before the first transaction replaces `documents.original_text`; retry cannot prepend again. Uncommitted extraction may repeat, committed memory may not.

Declare all outer sub-batches before any can certify the original input. Local `is_last`, document hash and counts do not prove whole-input coverage; include zero-fact and preserved-delta parts explicitly.

**Large append edge:** `memory_engine.py:647-658` stores the original fragment as body override; `orchestrator.py:1022-1070` prepends old text later, but `:1418-1430` prefers that override. Carry the full prepared combined body and correct offsets through every slice. Correct/verify this assembly seam rather than certifying an unstored combined hash or refusing larger input. This is source evidence, not a runtime reproduction.

#### Producer base comparison and concurrent writers

Take a coherent base witness under the Bank/document lock, release it before extraction, and recheck at the first canonical commit. It must cover existence, actual stored body/hash, document metadata/tags, ordered chunk identities/hashes and the source state used by the native plan. Content hash alone misses same-content replacement with different facts.

A no-column implementation stores a deterministic digest of those SQL rows and checks/updates it under the lock per part. Include source identity, chunk membership and plan-invalidating factual/lifecycle changes; exclude private graph state and consolidation-only marker/revision changes (`consolidator.py:1275-1280`). Normal background maintenance must not look like takeover. The final manifest still records actual revisions at seal.

Specify/test the projection against same-content replacement, source curation/deletion and consolidation. Text hash, `updated_at` and prunable journal lookup are insufficient. A native document-generation column is an alternative if digest cost warrants it; it is not required by this design.

Before any canonical part commits, a mismatch permits re-preparation under the same UUID. Afterward, freeze the plan: resume compatible parts or report takeover/incomplete; never append the fragment again. Distinguish absent document from unavailable historical body; preserve native `store_document_text=false` refusal.

Check a receipt-owned execution generation in every write transaction, fencing stale executors without changing the scheduler. Check task identity/cancellation there too; persist tracked cancellation/retirement independently of prunable queue rows.

#### Per-commit work and the final seal

Extend `_publish_retain_logical_changes` to return `AppendedLogicalBatch | None` instead of discarding it (`orchestrator.py:479-522`). Add a typed native commit context after publication at these existing transactions: streaming facts, first/all-zero paths, delta, and metadata-only. Keep webhook delivery separate.

For each streaming transaction:

1. Acquire Bank state, receipt/attempt and document locks in one documented order; validate lineage/generation, immutable preparation, cancellation and the compatible write-state witness.
2. For the queued chunk ordinals, check which parts already committed. Skip those exact parts, not all chunks sharing their text hash. Prefer one fenced active executor; a losing/repeated batch must not insert before discovering an existing part.
3. Execute native chunk/fact/link and lifecycle cleanup. Record successful zero extraction explicitly even where native code does not store a zero-fact chunk row. Extraction/defense failure is not zero. If every chunk in a buffer is zero, use a short proof transaction; perform native document tracking only when genuinely required, not again on resumed inputs.
4. Publish native logical changes, then write the immutable committed-part record with chunk ordinals/hashes, actual created IDs/results and that transaction's cursor. Rollback removes both. Do not record an extracted-but-uncommitted chunk as applied.
5. Update the compatible-state witness and exact completed-part set. If this completes the declared original-input plan, query the full resulting live/archive source set on this same locked connection and seal its immutable manifest. For a multi-input root, completion requires every declared input result, never just the remaining queue children.

Full results include delta survivors/lifecycle, with created IDs/count separate. References are `(memory_id, revision, state)` under the original input/document; include actual document hash. Persist before releasing the final lock. Later edits/deletion cannot rewrite the manifest.

For a final factual write, use the returned journal `last_cursor`; for a zero/no-op seal, persist its locked boundary covering earlier parts and the manifest's actual state. Never sample a later polling cursor or manufacture an empty journal batch. Root coverage includes all input seals and cleanup/tombstones.

**Document/fact consistency:** the first transaction publishes full text/hash and the first part; intermediate state stays native partial state. The transaction completing plan coverage seals the full mapping/boundary. A final-looking document hash alone cannot complete G1 recovery.

#### Extraction modes and retry details

| Path | Required handling |
| --- | --- |
| Ordinary LLM streaming | Reuse native producer/consumer and bounded buffers. Exceptions already propagate; persist only successful committed chunk outcomes. Uncommitted extraction can run again. |
| Duplicate chunk text | Distinct ordinals remain distinct planned parts. Preserve normal non-retry semantics; replace unsafe retry hash-set inference with exact committed-part coverage. |
| Chunks extraction mode | Reuse `fact_extraction.py:2548-2551`; record its real non-LLM results using the same part protocol. |
| Native provider Batch API | Add optional tracked extraction context with per-part batch checkpoint identity and request hash. Current operation-level `batch_id` is not sufficient when concurrent streaming chunk calls share one child UUID. Reuse submission/polling/parsing; surface `RetainExtractionErrors` directly as a typed failed part rather than zero success. Never read separate debug metadata to decide whether a transaction may seal. |
| Delta | Retain the existing one-transaction delta writer and native survivor behavior. Record the actual complete result in that transaction. On a stale base before any part committed, re-prepare safely; on resumed partial streaming, do not recompute a fresh delta that mistakes the prefix for a completed document. |
| Oversized outer slices | Keep native token splitting and chunk offsets; persist the complete original-input plan and full prepared-body override. A completed first slice is not a complete original input. |
| Crash after part commit / before progress or ACK | Receipt/part/journal survived together. Read them, reconstruct remaining work and skip exact committed parts. The final historical result is returned even when native queue/debug rows were pruned. |
| Competing write after final seal | Return the sealed historical result; later changes are ordinary journal state. Do not require old result references to remain live. |
| Competing write before full coverage | Re-prepare only if no canonical part exists; otherwise retain partial proof and report takeover/incomplete. Do not fake success, erase applied history, or automatically repeat the fragment. |

Resuming a sealed result must still follow the native post-write tail, without extraction/writes. Do not early-return past `_submit_post_insert_maintenance`. G1 neither waits for derived output nor changes native best-effort policy.

### 4. Small fixed-purpose storage and hash contract

Recommended forward migration: two focused PostgreSQL tables, no source/MM work graph.

- `memory_native_operation_receipts`: unique Bank generation/kind/native UUID, provider identity, normalized request hash, fixed original input/child identities, typed private prepared-input data, execution generation, native result/progress state, immutable final manifest/hash/receipt hash and factual cursor. For the current Taki one-input request, this is one small root record plus its private body/plan; typed per-input arrays support native multi-document parents without changing child packing.
- `memory_retain_part_receipts`: original root/input/preparation/part identity, kind and ordered chunk coverage, typed external extraction checkpoint when relevant, status/reason, committed source result references, cursor and post-part state witness. Unique part keys and transactional checks enforce exactly-once factual publication. No foreign key to prunable tasks or removable documents/facts.

Prepared input can be reconstructed from a stored effective body plus versioned deterministic chunk-plan settings/hash; it need not duplicate all text per chunk. Final references can be stored as immutable typed JSON with deterministic ordinals and served in bounded slices, or normalized rows if needed. A separate snapshot/export engine or dedicated table per API page is not required.

Keep admitted identity and completed results for the Bank-generation lifetime, independent of terminal-operation TTL. Preserve private replay material while an incomplete operation can still resume; discard it after complete/explicitly abandoned processing, retaining result/identity evidence. A document delete or data clear that keeps the Bank lifetime must not erase receipts. Full Bank retirement invalidates incomplete contexts under the same Bank-state lock and allows explicit lifetime cleanup; the durable Bank-generation tombstone prevents old replay on a replacement. Existing lifecycle seam: `memory_engine.py:7934-7957`.

Use core migration/backup ownership for these generic tables. Simply registering `BankScopedTable(delete_with_bank=True)` is not enough: the current extra-table sweep occurs before the `delete_bank_profile` branch (`memory_engine.py:7906-7944`) and could remove replay identity during a data clear. Add both tables to `admin/cli.py:39-77`, restore them coherently with lineage/queue state, and exclude them from portable logical transfer. Initial support stays PG + SQL-row authority; no Oracle/external-store proof is implied. Old archives cannot invent new receipts.

**Portable hashes must be specified, not guessed.** Preserve the existing Taki intent/local-envelope hashes and native mutation fingerprint for their current purposes. Define a new wire version using fixed typed field order and deterministic string-map key/value pairs. One dependency-free encoding is ordered JSON arrays: encode string maps as pairs sorted by UTF-8 bytes, explicit null/default values, normalized UUID/time fields, preserved array order, UTF-8 without ASCII forcing, compact separators, and no unpaired surrogates. Do not apply implicit Unicode normalization. Avoid untyped floats in the hashed request schema.

Test Python/TypeScript vectors for numeric-looking keys (`"2"`, `"10"`), non-BMP versus BMP keys, empty/missing values, timestamp forms and Unicode. JS key enumeration/UTF-16 sort and Python `sort_keys=True` are not equivalent. Provider `request_hash`, `prepared_input_hash`, `result_hash` and `native_receipt_hash` must remain distinct from local intent/receipt-envelope hashes. A mutation result hash covers the native result projection, not a self-referential envelope containing that hash.

Taki coordination: the leader confirmed a versioned compact receipt can store immutable manifest identity, full count/digest and factual cursor while preserving old inline <=256-reference variants. Verify every required immutable result page, ordinal/count and aggregate digest before accepting the result. Preserve existing <=512 KiB request/response and <=2 MiB durable-state bounds; page the historical manifest instead of imposing 256 as a native resulting-document cap. This does not truncate facts or require a larger unbounded pending row.

### 5. Independent cutover proof remains separate

Initial activation/healthy switch-back still require independent maintenance, manifest, reconciliation and final-fence evidence. Routine factual receipts do not supply it.

Reuse generation/cursor locking, immutable logical snapshots and receipt/writer-boundary helpers. A cutover input manifest fixes source versions/scopes and required model definitions/policy. Invoke native maintenance for that explicit operation; routine writes gain no dependencies or trigger changes.

Existing evidence is useful but incomplete:

- Logical source payloads already expose `consolidated_at` and `consolidation_failed_at` (`replication.py:72-97`). Check failures and every required source/scope; a normal executor return or queue emptiness is insufficient.
- Source-marker publication is transactional (`consolidator.py:1267-1352,1680-1694`), but candidate rows omit input revision (`:1228-1239`). Concurrent source edits require a consumed-version check or an effective cutover write fence; stamps read from a later version cannot substitute for it.
- Native consolidation continuations admit later traffic and MM submission is final-round-only/best-effort (`:1462-1470,1912-1929,1965-1986,2088-2104`). Preserve this routine behavior. Cutover must explicitly observe/repair its own required work and revalidate its candidate if input changes.
- Native MM execution has resolved scope, database-time cutoff and real processed watermark (`memory_engine.py:13062-13086`), with explicit preserved/failure outcomes and authoritative publication (`:13568-13649`). For cutover, persist definition/scope identity, required input boundary, real outcome and writer cursor. Submission count or `last_refreshed_at` alone does not prove the required model set.

Add consumed-source/version and model-input/outcome evidence only for cutover, then final manifest/reconciliation. This may require `consolidator.py`, `memories/base.py` and `memories/pg/reads.py`, which routine recovery does not require. Keep this acceptance separate; routine receipt tests cannot prove cutover readiness.

### 6. Handwritten footprint and implementation order

The recommended routine implementation names **7 existing backend files + 2 focused new modules + 1 forward migration**, before tests/docs and generated clients. This is a concrete responsibility inventory, not a fixed LOC/time estimate.

| File | Work |
| --- | --- |
| `engine/memory_engine.py` | Native opt-in admission/context, UUID/generation guard, original-input preparation handoff across child/outer slices, mutation receipt after journal, attempt/cancel/retry/lifetime hooks and native post-write-tail preservation. |
| `engine/retain/orchestrator.py` | Typed preparation/part context, exact resume, commit/cursor return, zero/delta/full-result seal at existing transactions; no replacement extractor. |
| `engine/retain/fact_extraction.py` | Tracked per-part provider Batch API checkpoint and direct strict error outcome. Keep native parser/prompts/modes. |
| `api/http.py` | Extract shared native request mapping/precheck helpers for extension reuse if needed; no native public request option or handler monkey-patch. |
| `extensions/builtin/taki_memory.py` | Tracked write admission, receipt and immutable-page endpoints; parse/delegate/map errors only. |
| `engine/taki_compatibility.py` | Independently versioned native-result capability and exact build/schema/storage admission. Do not advertise per-write derived completion. |
| `admin/cli.py` | New-table physical backup/restore parity. |
| New `engine/native_operation_receipts.py` | Typed receipt/hash/storage/lifecycle and manifest publication/read helpers. |
| New `engine/retain/receipt_context.py` | Typed prepared-plan/part/extraction context and native resume coordination; no generic workflow DSL or alternate semantic implementation. |
| New Alembic revision | Two tables/keys/indexes after the verified current head; `run_for_dialect` with explicit unsupported Oracle behavior. Recheck head before implementation. |

`fact_storage.py`, `chunk_storage.py` and `replication.py` are important reused helpers; alter them only if a proven connection-taking/typed-return seam is missing. `conditional_mutation.py` can remain unchanged if its original result is linked through the common table from the engine. No routine change is required in consolidation, MM scheduling, worker claiming, graph/ANN algorithms, transfer semantics or canonical source schema. An implementation finding may change this inventory, and must be recorded rather than hidden.

Add tracked-extension methods to maintained Python/TypeScript wrappers; regenerate canonical OpenAPI and all Python/TypeScript/Rust/Go clients. Existing native retain parameters and Control Plane proxies need no change. No new dependency is needed. Preserve `hindsight-control-plane/bin/cli.js`.

Implement in this order:

1. Freeze request/result encoding and typed public contracts; add focused failing transaction/replay tests. Add forward schema, backup/restore and generation/lifetime coverage.
2. Implement the common receipt repository and the conditional-mutation commit witness first. Prove rollback, lost ACK, later source deletion and exact original boundary.
3. Add tracked retain admission and immutable native preparation. Prove original-input IDs, append/JSON assembly, generated document IDs, outer offsets and no repeated prepend before modifying resume behavior.
4. Integrate streaming/delta/no-op part commits and attempt fencing. Seal full manifests inside the last required publication/proof transaction. Cover large outer slicing and all native extraction modes, including Batch API errors/checkpoints.
5. Expose tracked extension writes/receipt/pages; complete SDK/OpenAPI and exact-build admission. Taki applies factual proof with its existing Authority/Bank guards and compact receipt.
6. Review the whole routine scope, then evaluate cutover-only evidence separately. Update `TAKI_PATCHES.md` with the implemented footprint and unrun gates. Do not claim B4/B6 or full product acceptance from this routine slice.

### 7. Required deterministic acceptance matrix

Proposed gates; use real engine/SQL transactions with controlled extraction/embedding/Batch API fixtures.

| Failure/race | Required evidence |
| --- | --- |
| Mutation commit/rollback, lost ACK and target deletion | Exact original result/cursor or total rollback; no re-mutation. |
| UUID payload mismatch; legacy control | Tracked conflict; legacy replay unchanged. |
| Append ACK loss, pruning and later edit/delete | Immutable full manifest survives; no new append. |
| Crash at every preparation/outer/chunk commit | Same plan; only uncommitted parts run; receipt/journal/facts agree. |
| Zero, duplicate-text ordinals, LLM/Batch API errors | Exact coverage; failure never becomes zero; checkpoint IDs cannot cross parts. |
| Full/delta/survivor/metadata/removed-only and large JSON/text append | Native results and full mappings; correct body/offsets after restart; no new input cap. |
| Same-content replacement, source curation and partial takeover | Valid base comparison; no repeated fragment; explicit partial outcome. |
| Consolidation during retain; stale attempts/cancel/child deletion | Marker revisions are harmless; stale writers fenced; fixed input set preserved. |
| Missing/reordered/tampered pages; large manifests | Verify every page/count/digest within wire/state bounds. |
| Bank clear/replacement, restore/import and changed local Authority | Lifetime/fences hold; no stale Bank recreation or false local confirmation. |

Reuse native conditional-curation, async-UUID, same-document concurrency, append, replication-retain, batch-extraction, migration, backup and extension fixtures. Add Python/TS hash vectors and wrapper tests. No existing baseline count is new acceptance.

## Related Specs and External References

- Current task `grill.md`: G1, prior-decision filter and independent cutover obligations.
- Taki ADR 0009, provider/B4/B5/B6 PRDs, backend memory-replica/database/error/quality and source-grounding specifications, as amended by G1. The leader owns consumer transition/field-alignment work.
- Hindsight `CLAUDE.md`, `.claude/skills/code-review/SKILL.md`, native tests and `TAKI_PATCHES.md`: typed engine-owned persistence/auth, no advisory locks, dialect migration and generated-client/backup parity.
- Earlier task reports remain source references, not the selected design/size estimate. No external web source or live provider request was needed.

## Caveats / Not Found

- No existing supported API/hook supplies this complete receipt protocol. This is a proposed G1 implementation, not tested acceptance.
- Only this report was written; no production/service/dependency/Git/user-data operation occurred. Existing reports remain unchanged.
- No lower native input limit is proposed. Streaming partial publication and explicit takeover/failure remain; whole-document atomicity would be a stronger separate decision.
- Oversized append overrides and provider Batch API checkpoint/error semantics require the listed tests. Ordinary small append success cannot cover them.
- Cutover remains independently unproven until its source-version/model-input and final-manifest gates pass.
- Leader preflight found Python/Node but no running Docker Linux engine, Git Bash or Go. Later DB checks need a clean isolated harness with `PYTHON_DOTENV_DISABLED=1`; native conftest loads `.env` with `override=True`. No `.env` was read or test/generator run here.
