# Research: Stable native append input and result receipts

- Query: Can the supported native API prove one append's complete resulting document/fact mapping across concurrency, restart, lost responses and operation pruning; if not, what is the smallest producer extension?
- Scope: internal; native append/admission/storage and Taki Pending Memory mapping. No source or user data was modified.
- Date: 2026-09-07
- Source baseline: leader-verified Hindsight `7eca2056dae5d70a682b755abfff8a107f6b08a0`; current working-tree source read directly.

## Findings

### Conclusion

The current supported HTTP API does **not** supply the required witness. Native append exists and must remain append: it reads the existing document, prepends it to the new fragment, preserves native conversation-array merging, and reprocesses/delta-processes the resulting input. Prefer an **explicitly tracked-only atomic publication path**, using native preparation/extraction/delta/storage helpers, with a durable input identity and an immutable native result receipt. Current multi-transaction streaming does not have sufficient durable per-part resume to use unchanged for this guarantee.

This must be produced inside Hindsight. A client cannot recover the exact prior document or the exact completed fact set after a concurrent replacement, a worker retry, a lost response, or terminal-operation pruning. Reading the latest document and counting facts is not a historical result receipt.

This need not turn append into a client-assembled replace, add an expected source revision to the public retain contract, or alter extraction prompts. Atomic buffering changes publication granularity/resource use for the opt-in contract and must be recorded as such. Pre-existing native partial operations remain unproven; exposing their partial state alone is not a completed append-recovery solution.

### Files found and source-backed behavior

Paths below are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`.

| File / location | Behavior relevant to the result contract |
| --- | --- |
| `api/http.py:634-710` | Native item fields include content, occurrence timestamp, string-valued metadata, document ID, entities/tags/scopes/strategy and `update_mode`. Append is documented as concatenation and reprocessing. |
| `api/http.py:762-780,850-883,7756-7800` | Caller UUID is async-only; a UUID request must resolve to one strategy group. HTTP response has acceptance/usage, not fact IDs or a full document result. |
| `engine/memory_engine.py:16435-16518` | Native UUID replay validates only Bank and operation type, not payload equality. |
| `tests/test_async_retain_operation_id.py:121-146` (under `hindsight-api-slim/`) | Existing test intentionally requires differing payloads under the same UUID to return the original operation. Tightening all native replays would change a tested contract; strict fingerprinting must be explicit/versioned. |
| `engine/memory_engine.py:16537-16544,16578-16676` | Child operation packing keeps a single document together; parent and complete child payloads are admitted atomically. Preserve that mechanism. |
| `engine/memory_engine.py:4091-4138` | Sanitizes ingress; rejects duplicate document IDs and append without a document ID. Append explicitly refuses when effective `store_document_text` is false. Do not enable text retention automatically. |
| `engine/retain/orchestrator.py:955-1010` | Generated document IDs are currently recovered/persisted through best-effort operation debug metadata. A stable public per-input receipt needs stronger persisted identity. |
| `engine/retain/orchestrator.py:1012-1073` | Reads prior text separately; prepends it as a native content item, copies native metadata/tags/context/scopes, and merges arrays of conversation objects into valid JSON. |
| `engine/retain/orchestrator.py:1075-1098` | A stale request can return empty result groups when the document was updated after request start. Empty results therefore do not necessarily mean a successful zero-fact extraction. |
| `engine/retain/orchestrator.py:1423-1452` | Combined content is sanitized and hashed; matching document hash plus chunks drives recovery. The raw per-item strings are cleared after preparation. |
| `engine/retain/orchestrator.py:1840-1965` | Streaming takes document row locks per mini-batch, not across the whole operation. Later batches abort after a content-hash takeover. The first write can replace the document after another writer changed the earlier read. |
| `engine/retain/orchestrator.py:2074-2120,2252-2295` | Best-effort `facts_committed_document_ids` is written separately; recovery can reload current fact IDs by document ID. Neither is a source-version/result witness. |
| `engine/retain/orchestrator.py:2423-2447,2531-2580,2642-2667` | Delta loads document hash/chunks before extraction, rechecks the hash and can fall back to streaming. Its read hash is not necessarily the hash used for the earlier append prepend. |
| `engine/retain/orchestrator.py:2836-2904,2907-2990` | Delta returns only newly inserted fact groups; unchanged chunk facts survive. Metadata-only returns empty groups while an existing document can still have many facts. `unit_ids_count` cannot be treated as the full resulting document count. |
| `engine/memory_engine.py:564-581,590-658,4197-4307` | Oversized input retains original-index mapping and full-body overrides across sequential sub-batches; append consumes prepended chunk offsets. Prepared input must cover these existing paths rather than assuming one final write. |
| `engine/retain/fact_storage.py:39-73,235-402,439-517` | Document reads/counts describe current SQL state. Full replace cleans live/archive sources and observations; hash is SHA-256 of sanitized combined text. Original text can be NULL; alternate document stores also keep SQL text NULL. |
| `engine/replication.py:59-69,964-993,1063-1067` | Public document projection contains content hash but not private source text. Non-memory revisions are derived from journal cursors, with retained-journal lookup; do not treat them as an everlasting native document CAS column. |
| `engine/memory_engine.py:2962-3001`; `api/http.py:3346-3355` | Retain outcome/debug metadata is separate/best-effort and explicitly not a stable production contract. `include_payload` exposes submission parameters, not the actual prepared append base/result. |
| `api/http.py:6463-6469`; `engine/maintenance.py:234-297` | Terminal operation records and payloads can be pruned using configured retention. Default retention is not an indefinite public guarantee; no guessed TTL is safe. |

### What an existing client-only path can and cannot establish

| Path | Assessment |
| --- | --- |
| Exact conditional mutation replay with the same normalized request/UUID | Already proves that mutation's original native result, because its receipt is persisted transactionally. It does not prove derived completion. |
| Single writer, unchanged document, operation still retained, supported replace input | Current Taki can validate current document hash and a complete bounded fact list. This has a narrower observational scope than a durable historic append receipt. |
| Read document before append, compute expected concat, then read document/facts after operation | Loses the race to other native writers; the producer can use a different base. JSON-array merge/sanitization/redaction and delta survivor facts add further mismatch. |
| Add operation UUID in metadata and search for it afterward | Document-level metadata is propagated to unchanged facts (`test_retain_append_mode.py:89-137`); metadata is mutable and not a one-to-one immutable operation/result identity. |
| `GET operation?include_payload=true` then current document/fact enumeration | Submission payload is not the producer's combined input; old terminal rows disappear and current facts can belong to another execution. |
| Force synchronous retain | HTTP still does not return the complete mapping, ignores idempotent UUID and loses the result if the response is lost. |
| Submit the fragment as replace or precompute a combined replace on the client | Changes native semantics and can overwrite concurrent content. Rejected. |

### Preferred producer extension

#### 1. Common versioned admission identity

For the explicitly negotiated recovery contract, add an optional typed native request member such as `recovery: TakiRecoveryOptions`. It requires the normal async `operation_id` (or conditional `mutation_id`), the contract version, expected provider lineage and expected Bank generation. The old request form retains native behavior. A tracked B5 write requires an existing admitted Bank; it must not lazily recreate a deleted generation.

The producer computes and persists a **schema-defined normalized request fingerprint**. Include every write-affecting native input: ordered item identity, content, effective timestamp representation, context, metadata, tags, entities, document ID, scopes, strategy and update mode; include the expected lineage/generation and operation kind. Missing/default/empty fields and Unicode handling need a versioned canonicalization rule with Python/TypeScript vectors. Do not hash arbitrary JSON serialization differently on each side.

Keep three identities distinct:

- `request_hash`: provider-computed fingerprint of the admitted normalized public request, before any retry can change it.
- `prepared_input_hash`: fingerprint of the actual effective engine input after native preparation, including the append base and native sanitization/defense result. An extension-transformed input is not silently represented as the caller's original bytes.
- `result_hash`: fingerprint of the immutable committed native result manifest (including full result reference set/digest), computed by the producer.

A repeated exact tracked request returns the same producer identity/result. A different normalized payload under that tracked UUID returns a typed conflict without new work, even if `async_operations` was pruned. An untracked old operation with no durable fingerprint must remain explicitly unproven; do not retroactively manufacture a strict receipt from its current document.

#### 2. Persist the append preparation before its first mutation

Record one durable per-original-input preparation, not only a root `document_ids` list:

```python
class AppendBaseWitness(BaseModel):
    existed: bool
    document_id: str
    state_hash: str
    content_hash: str | None
    stored_text_available: bool

class PreparedRetainInput(BaseModel):
    operation_id: UUID
    child_operation_id: UUID
    input_index: int
    input_hash: str
    document_id: str
    update_mode: Literal["replace", "append"]
    base: AppendBaseWitness | None
    prepared_input_hash: str
    resulting_content_hash: str
    # Private replay material: the native effective content-item list/body,
    # original-index/chunk plan and execution generation, never returned in diagnostics.
```

The existing append preparation at `orchestrator.py:1012-1073` is the algorithm to reuse. Preserve text concatenation and conversation-array merging, rather than duplicating them in Taki. Retry must load the same prepared effective input and **must not prepend the current document again**. Internal prepared-input plumbing can bypass only the repeated preparation step; the public request remains `update_mode="append"`, and downstream native retain/delta behavior remains in use.

Bind preparation to the actual document state read by the producer. Recheck it at the authoritative write. Use a versioned **producer base-state hash**, covering existence, retained body/hash, document metadata and the ordered chunk/source-ID/revision state used by the native delta plan. Read and recompute it under the existing Bank-state/document locks. Content hash alone misses same-content replacements with different chunks/fact identities. This comparison is an internal CAS, not a caller-chosen revision. A new durable document generation column is an alternative if profiling justifies it; it is not mandatory for the hash-based atomic design and must not be confused with cursor-derived document revision.

The write gate compares the prepared base state, including existence. If it changed before publication, an internal preparation retry under the same immutable request identity is safe; record a new preparation attempt and discard the unused one. This preserves append against the later base without creating a new write identity. Once the atomic native receipt committed, return it before attempting any preparation or extraction; never recompute `current_text + fragment` on replay.

`store_document_text=false` is already an explicit native refusal. A different case is a current true setting with an existing historical document whose text is NULL (previous policy/store ownership). `get_document_content` currently cannot distinguish absence from NULL by itself. The tracked path must read existence and storage capability separately and refuse an unavailable base; inventing an empty base would be append-as-replace. No automatic policy change or secret/source recovery from an unrelated store is justified.

#### 3. Preferred atomic publication, not presumed streaming resume

The concrete small implementation is an opt-in path for the actual B5 request shape: **one document/input per native retain UUID** (`hindsight-pending-client.ts:42-44`). Preserve the legacy multi-item/streaming path. The tracked worker prepares the native complete input and finishes all required extraction/embedding preparation **before** opening the one authoritative write transaction. Reuse `_extract_and_embed` (`orchestrator.py:628-672`), native chunk construction, `_pre_resolve_phase1` (`:377-439`), and the existing native delta decision. Do not stream canonical chunks/facts while extraction is still unfinished.

The existing delta writer already demonstrates one-transaction document/chunk/fact/journal publication (`:2642-2865`), including an unchanged-chunk path. Reuse it with the stronger base-state CAS and a typed receipt context. If delta cannot be used, the tracked fallback must buffer native extraction outputs then use `fact_storage.handle_document_tracking`, `chunk_storage.store_chunks_batch`, `_insert_facts_and_links` and `_publish_retain_logical_changes` on **one caller-owned connection/transaction**. It must not fall back to `_streaming_retain_batch` for a tracked request. Preserve native delta survivors and native chunk extraction semantics; forcing full re-extraction where native delta applies would be a separate, unnecessary semantic change.

Inside that authoritative transaction:

1. Lock replication Bank state, the tracked request/receipt claim and document state in a fixed order. If the receipt already exists, return it without writes. Validate generation and the prepared base-state hash; a mismatch aborts before canonical writes and retries preparation under the original UUID.
2. Apply the native document/delta/chunk/fact operations and existing provenance/lifecycle cleanup. Record every expected chunk's completion, including valid zero-fact chunks, in the in-memory prepared plan; any producer/extraction failure means no canonical publication. Preparation may leave the same native idempotent entity-registry work that Phase 1 already performs, but no partial authoritative document/fact result is exposed.
3. Enumerate the **full resulting source fact set**, including unchanged delta survivors, with authoritative IDs/revisions/lifecycle. Persist its deterministic digest, actual complete document hash, input index, and separate extraction-created/resulting-document counts. Retained invalidated source records need explicit lifecycle handling; do not call a live-only page a full lifecycle mapping.
4. Publish the native journal batch, then seal the immutable result and required logical maintenance intents/full finalizer task payload on that same transaction. A no-op uses the current committed Bank boundary and an explicit unchanged result, not a fake empty journal batch. The receipt does not wait for private ANN work.
5. Notify the task backend only after commit. A crash before commit leaves no canonical result; a crash after commit finds the immutable receipt even if the native debug status is missing or later pruned. The loser of a concurrent exact replay observes the winner's receipt rather than inserting duplicate facts.

This specifically closes the reviewed hole: the new tracked path never exposes a new document hash with only a prefix of its facts. Re-extraction after a pre-commit crash is safe because no authoritative partial result exists; repeating LLM work is different from applying native memory twice. Persisting concatenated text or one final callback alone would not achieve that.

**Resource boundary:** a buffered path cannot be advertised for unlimited accumulated documents. A pre-admission native preparation check can reject when the **combined** input exceeds the resolved `retain_batch_tokens` budget or `retain_chunk_batch_size` under the actual chunking strategy. Recheck after CAS re-preparation: that operation is already admitted, so persist a typed native refusal with no canonical publication, not a retrospective HTTP 422. Check the combined document, not only the fragment. These existing batching thresholds are a proposed envelope, not measured memory-safety limits. Larger atomic buffering needs explicit memory/transaction-size measurements. Publish the bounds and excluded cases; bounded v1 does not cover every larger native append.

The result-reference size is separately important. Taki currently accepts at most 256 references. If the tracked request negotiates that maximum, validate the complete final mapping **before publication** (or roll the whole transaction back), return a typed result-bound refusal, and preserve the request identity. Do not successfully publish an intentionally unrepresentable result then claim a truncated Taki receipt. Immutable receipt paging can support broader clients without enlarging Taki's current durable-state bounds silently.

Suggested public result (proposal):

```python
class RetainDocumentResult(BaseModel):
    input_index: int
    document_id: str
    update_mode: Literal["replace", "append"]
    input_hash: str
    prepared_input_hash: str
    base: AppendBaseWitness | None
    resulting_state_hash: str
    resulting_content_hash: str
    outcome: Literal["applied", "unchanged", "zero_facts", "failed", "cancelled"]
    extraction_created_count: int
    resulting_fact_count: int
    result_set_hash: str
    native_through_cursor: int
    # Complete immutable result references, inline or via receipt-bound pages.

class RetainFactResultRef(BaseModel):
    memory_id: UUID
    revision: int
    state: Literal["valid", "invalidated"]
```

Result-reference pagination, if needed, must page the **immutable stored receipt result**, keyed by receipt/result hash and stable ordinal. It must not page the current `memory_units` table. Store references as normalized per-input rows (or an immutable result JSON with stable ordinals); use existing typed immutable-page/hash patterns from `engine/logical_snapshot.py` rather than a new export engine. No truncated page/count can count as full mapping.

The stable receipt remains readable after another operation edits or deletes the document/facts. It says what this write committed, not what remains current forever. Later authoritative changes are consumed by the second pull; Taki must not demand that every old receipt fact still be live before acknowledging an already-proven native result.

**Rejected smaller shortcut / larger alternative:** native streaming recovery today uses content/chunk hashes and best-effort debug checkpoints, not durable per-operation part identities/results. Adding robust resumable canonical parts would require stable part IDs, exact extracted outputs/fact IDs or committed part receipts, per-part CAS and ownership, full-plan coverage, atomic part/journal/result publication, and no-op detection that distinguishes incomplete prior parts. That is feasible engineering but a larger surface than the bounded atomic path; it is not "already available". Old/native partial operations remain explicit unknown/partial cases, not inputs automatically upgraded into the atomic proof contract.

#### 4. Retention and generation rules

Separate result/admission records from `async_operations` pruning. Required minimum retention is an explicit **Bank-generation lifetime** contract, independent of the configured terminal-operation TTL. Within that lifetime, keep the request identity/fingerprint and immutable result references; retain unfinished prepared replay material until it is terminal or explicitly abandoned. Clear private prepared bodies when no longer needed rather than keeping duplicate raw source indefinitely.

Document deletion does not erase the native receipt or make the same UUID reusable. Bank deletion/generation replacement must atomically invalidate unfinished work and prevent the old request from being admitted against the replacement. Retaining an old non-secret identity tombstone or returning a lineage/generation-gone result is sufficient to refuse replay; do not fabricate "never applied" when an old result was intentionally retired with its Bank lifetime. Full physical backup/restore must carry the receipt state coherently; portable import starts fresh operation identity (companion footprint report).

No TTL number is proposed. Native default `operation_retention_days=0` (`config.py:1272`) merely disables that cleanup in the default configuration; operators can change it or explicitly delete an operation. It cannot be used as the recovery guarantee.

### Concurrent/partial outcome matrix

| Case | Producer and consumer contract |
| --- | --- |
| Duplicate request before execution, concurrent same-UUID submits | One admitted fingerprint and child set; repeat returns the same identity. Payload mismatch is a tracked-contract conflict. |
| Crash after preparation, before any native write | Resume prepared input; if base changed, safe internal re-preparation only after proving no input part committed. |
| Tracked worker crashes during extraction or the atomic transaction | No partial canonical publication; resume the same request/prepared input or safely re-prepare after CAS, then publish once. |
| Completed append, lost HTTP response, later concurrent append/replace | Return the original immutable full result mapping from the receipt. Never enumerate the latest document as if it were that result. |
| Pre-contract/native streaming writer already has partial commits | Explicit unproven/partial outcome; do not infer complete/no-op from its hash or silently replay it using the atomic contract. |
| Delta append retains many old facts and inserts few/none | Full resulting fact count and set include survivors. Extraction-created count remains separate. |
| Native zero facts / unchanged document / stale skip / defense block / extraction failure | Distinct typed outcomes. `zeroResultAllowed` can accept a proven complete zero-fact extraction only, not a skipped/blocked/partial input. |
| Multi-input tracked request / required multi-publication input | Reject known unsupported shape/envelope before admission. If later CAS re-preparation exceeds the envelope, preserve the admitted identity with an explicit no-publication refusal. Ordinary native behavior remains available outside this contract. |
| Fact is invalidated/deleted after a successful result | Original native receipt remains true. Derived completion must separately handle applicable source/survivor obligations and later logical tombstones. |
| Bank generation or provider lineage changes | Refuse old write/replay on the new authority; keep Taki native receipt or `outcome_unknown` according to actual existing evidence. |
| Native operation pruned, result receipt present | Recover from the stable receipt, without creating another native operation. |
| Pre-contract operation pruned, no stable receipt | Explicit unavailable/unknown; no retrospective proof or automatic append replay. |
| Result exceeds negotiated Taki reference bound | Refuse/roll back before canonical publication, retaining the admission identity. No truncation or silent increase of the existing 256-reference / 512 KiB HTTP / 2 MiB state bounds. |

### Public preconditions and material decisions

No **new caller-supplied expected document revision** is needed merely to return a truthful receipt. A producer-chosen base/write witness is an implementation invariant; the caller still requests native append against the document. Adding a public 412/CAS requirement or converting an append into a user-resolved stale mutation would change ADR `0009:45` (new retain has no target revision) and requires a product decision.

Two tracked atomic appends can share the same initial base: one commits; the other's CAS fails before any canonical write, re-prepares against the winner, and later appends once under its original UUID. An unrelated writer after a completed append may legitimately replace/delete its contents; the receipt remains a historical truth, not a promise against future administration. There is no fixed completion-time guarantee under perpetual conflicting writes to the same document. Crucially, this is not a terminal partial-refusal substitute for recovery: accepted tracked atomic writes either publish a complete receipt/result or publish no canonical result.

The leader must freeze **tracked-only atomic buffering and its advertised prepared-input/result bounds** before implementation. If every currently accepted large native append must also receive this guarantee, a single-publication bound cannot be presented as final closure: choose measured larger atomic buffering or implement the larger durable-part protocol explicitly. Neither choice needs a replacement prompt/semantic engine, but both have a real execution/resource footprint.

One concrete source edge must be tested before coding from assumptions: oversized append uses `document_body_overrides` from the original input fragment (`memory_engine.py:647-658`) while the orchestrator separately prepends stored text (`orchestrator.py:1022-1070`) and prefers the override when choosing the stored body (`:1418-1430`). Existing `test_retain_append_mode.py` covers ordinary text, metadata, new-document, missing-ID, repeated append and JSON arrays; it does not establish all oversized/restart combinations. This is a source-grounded test target, not a claimed reproduced bug. The prepared-input record must state the full document actually processed and make any mismatch explicit; do not certify an intended combined body that the native writer did not store.

### Meaningful RED/GREEN tests

| Test at the actual seam | GREEN condition |
| --- | --- |
| New tracked UUID with changed normalized payload; untracked control | Tracked request returns typed conflict and no new work; existing native replay behavior remains unchanged for the old form. |
| Text append and conversation-array append with native metadata/scopes/strategy | Prepared hash is stable; full stored result uses native assembly; surviving and new source refs are all returned. |
| Lost native response followed by competing successful document rewrite and operation pruning | Same immutable provider result/receipt hash and references return; no new retain dispatch. |
| Inject stop after preparation/extraction, inside canonical writes, after journal insert, receipt seal and finalizer enqueue | Rollback before commit or one full result after commit; no partial facts/current-hash false completion and no repeated fragment. |
| Race producer base read with another append before first write | No receipt certified from a stale base; internal no-write retry uses the same request identity and records the actual winning base. |
| Race native document replacement/deletion before the atomic publication | Producer base-state CAS aborts before writes; re-preparation is allowed only with no committed result. |
| Same-content replacement / delete-recreate (hash ABA) | Base-state witness detects changed chunk/fact identities/revisions even when the content hash matches. |
| Extraction zero vs stale skip vs defense block vs partial extraction errors | Only the valid complete zero-result case can satisfy the Taki zero-result policy. |
| Multi-input request / oversized combined append | Initial shape/preparation preflight refuses before admission; a post-admission CAS re-preparation crossing the bound records a stable no-publication refusal. Legacy controls retain their native semantics. |
| Result page missing/duplicated/reordered or count/hash tampered | Consumer rejects the incomplete immutable mapping and preserves original intent/native evidence. |
| Disabled text storage and true-now-but-missing historical text | Native policy remains disabled where configured; an unavailable prior body is refused explicitly, never replaced by the fragment. |
| Combined append at/over resolved single-publication bounds; repeated/zero-fact chunks | Boundary is based on the complete native input; admitted cases have complete result coverage, rejected cases do not fall back to partial streaming. |
| Physical restore, portable import and Bank generation replacement | Old receipts continue only with restored matching physical lineage; transferred/recreated Banks cannot admit old-operation proof. |

Nearby fixtures to reuse: `test_async_retain_operation_id.py:25-42` (real DB admission + ASGI); `test_retain_same_document_concurrency.py:49-113,193-276` (stub embeddings and controlled concurrency); `test_taki_replication_retain.py:37-105` (whole logical transaction validation and partial streaming seed); `test_taki_conditional_curation.py:56-71` (two-request barrier before the authoritative transaction). Their existing success is not new recovery-contract acceptance.

## Related Specs and External References

- Taki `docs/adr/0009-single-memory-authority-with-local-replica.md:21,25,29,31,45`.
- Taki `.trellis/spec/backend/memory-replica-sync.md:244-281` and its source-grounding/database/error/quality guidelines.
- Taki `packages/shared/src/pending-memory-schema.ts:30-60` and `packages/core/src/memory/hindsight/hindsight-pending-retain.ts:16-69`, `hindsight-pending-replay.ts:38-45`.
- Hindsight native append examples/tests listed above; Hindsight coding/review rules require typed results and engine-owned persistence/authentication.
- No external documentation or live experiment was used to infer append semantics; this report is grounded in local supported source.

## Caveats / Not Found

- No supported immutable per-operation full-document/fact result API was found. Operation debug metadata and current document endpoints are not equivalents.
- No production edit, Git operation, installation, service startup, live LLM/API call or user-data read was performed; all test rows above are proposed.
- The preferred new tracked path changes publication granularity and memory/transaction use. Its chosen bounds must be explicit; larger/native pre-contract partial operations are not automatically covered by the atomic proof.
- Public strict fingerprinting is an opt-in compatibility contract change, because legacy differing-payload UUID replay is intentionally tested. Old untracked/pruned writes cannot be backfilled with invented proof.
