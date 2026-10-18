# B2 Native structured-label provenance map

Read-only follow-up by `stage5b_b2_admission_research`, 2026-10-08, against H:/hindsight main.
jbcontext reported no Native index; known references and exact-symbol live reads supplied the findings.
No index rebuild, tests, files, original data, credentials, providers or services were used. B1 review still
gates implementation. Paths below are relative to hindsight-api-slim/hindsight_api/ unless specified.

## Capture before caller data is merged

- `engine/retain/fact_extraction.py:1555` and :2350 are the ordinary and Batch API `llm_fact['labels']` parsing
  points. Their configured-group/value lookup follows at :1558/:1584 and :2353-2383.
- `engine/retain/entity_labels.py:172` builds Literal/optional-null value models, used at fact_extraction :1156.
  Ordinary extraction nevertheless uses skip_validation=True at :1417; schema construction alone is not
  strict runtime evidence. Existing parsing tolerates lists, case normalization and deduplication.
- Derive a private, strictly validated single selection from the original structured field and exact configured
  group before `engine/retain/entity_processing.py:34-45` merges caller entities into every fact.
  `entity_labels.py:300` derives tags from final entity strings and cannot prove extraction provenance.

## Carry internal identity through real storage

The existing chain is Fact -> ExtractedFact -> ProcessedFact.from_extracted_fact -> filtered processed facts
-> insert_facts_and_links -> fact_storage.insert_facts_batch -> Memories PG -> ops_postgresql.insert_facts_batch.

`fact_extraction.py:151` Fact and `engine/retain/types.py:112,140,257` currently have no private provenance field.
Both paths create ExtractedFact at :2473/:2683. Keep provenance outside caller-writable metadata and carry it
through those internal objects. `engine/retain/orchestrator.py:710` filters degenerates with aligned survivors;
at :556 actual unit IDs are paired with processed facts before entity links. The real insert returns IDs from
`engine/db/ops_postgresql.py:150,164`. Preserve alignment rather than guessing IDs or using content-wide labels.

## Atomic final version, hash and invalidation

`orchestrator.py:480` _publish_retain_logical_changes rereads canonical payload after facts/entities/tags/links,
then calls append_logical_changes on the same connection. Streaming retains own transaction at :1903, publishes
at :2058 and writes the retain receipt at :2067. Delta retains use the same publisher at :2926.

`engine/replication.py:512` loads final live/archive payload and revision; :1030 append_logical_changes holds
Bank/generation/lineage and allocates the real cursor in the caller transaction. The frozen payload hash is
`engine/application_state/codec.py:318`; `publication.py:323` already forms a TakiApplicationNativeVersion.
Do not change the frozen logical payload domain to add provenance.

Important: publication.py:282-289 returns early when application capture is disabled. Sidecar processing only
inside record_native_application_changes would miss unenrolled Banks. The outer append boundary is the common
place for invalidation; minting new proof additionally requires the private extraction record. Baseline capture
(`application_state/snapshot.py:114`) must never fabricate extraction proof from an ordinary payload.

## Mutations and restore coverage

| Path | Current source and consequence |
| --- | --- |
| Per-unit curation | memory_engine.py:9250,9574,9900,9935 edits text/entities/type/state, recomputes tags, increases revision and appends. Invalidate; curation is not structured extraction. |
| Invalidate/revert | memories/pg/writes.py:464,509 moves live/archive and may reuse UUID with different surviving entities. Never restore trust by UUID alone. |
| Metadata/tags and delta survivors | retain/fact_storage.py:520,568,585 and memory_engine.py:7692,7705 increase live/archive revision on real changes. Account for them in exact-version invalidation. |
| Replacement | orchestrator.py:2776 reads old live/archive versions before cascade and emits tombstones before new facts. |
| Unit/document/batch/Bank deletion | memory_engine.py:7493,7514,8034,8062,8359,8397 appends tombstones; :8747 retires Bank receipts. replication.py:352 gives a recreated Bank a new generation. |
| Consolidation bookkeeping | consolidation/consolidator.py:1352,1387,1407,1432 changes consolidated/failed markers, increases revision and appends even without text changes. Handle this deliberately, not as an invisible no-op. |
| Portable import | transfer/importer.py:1120 builds facts/entities/tags/metadata from transferable user data without structured extraction; no fresh proof is permitted. |
| Current-state/delta import | transfer/current_state_writer.py:84 and transfer/transition_delta_rows.py:29,271 rewrite/archive/reuse IDs and append. Retained UUID/revision alone cannot authorize transferred provenance. |
| Full admin restore | admin/cli.py:419 restores via one TRUNCATE/COPY transaction and bypasses Python append. Sidecar must be restored atomically from the paired table set, never reconstructed from tags. |

Use append's upsert/tombstone and Bank generation boundaries for common invalidation; require an explicit
trusted path for exact-version republishing. Ordinary edits/imports/revert must not silently preserve provenance.

## Required implementation decisions and inventories

- A source fact can reach Core after Native consolidation updates only bookkeeping. Preserve useful structured
  provenance across a specifically verified bookkeeping-only change by explicitly linking a valid prior proof
  to the new exact version/hash in the same transaction. Otherwise invalidate safely. Never copy an old proof
  merely because tags or UUID still match, and test this normal extraction/consolidation/sync ordering.
- `_collapse_to_verbatim()` at fact_extraction.py:2722 combines facts/entities; it cannot retain the first label
  as single-fact evidence. Prefer neutral/no proof unless a separately specified and tested derivation proves
  the whole merged unit. Chunks mode at :2512 has no structured extraction and stays without this proof.
- `admin/cli.py:53` BACKUP_TABLES and `tests/test_admin_backup_restore.py:67` define backup/FK parity.
  `engine/transition_snapshot.py:31,115,138` _AUXILIARY_TABLES contributes Native transition auxiliary hashes.
  Include new tables in these inventories when their producer is delivered; B3 still owns paired managed-state equality.
- New additive migration must install the existing guard_transition_bank_write mechanism; use
  `alembic/versions/e30a9d7f6c21_add_transition_publication_fences.py:26,385` as a pattern without changing it.
  `engine/transfer/export.py:41` separately classifies portable-export tables; portable data cannot mint provenance.

This map establishes PostgreSQL replication seams only; it does not claim Oracle/non-SQL store support.
B2 must advertise support only when the actual producer/storage path is available, exercise both real extraction
paths with fake providers, and prove loss/mutation/restart/restore handling with maintained tests.
