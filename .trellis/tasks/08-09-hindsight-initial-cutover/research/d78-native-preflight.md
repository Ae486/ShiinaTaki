# D78 Native Producer Preflight (2026-09-08)

## Decision and authority

The owner asked to continue execution if the next route is clear without another grill. Two independent read-only
native studies found engineering gaps, not a new product choice. The accepted decisions in
`09-07-hindsight-recovery-evidence/grill.md` (lines 74 and 105-115) and ADR 0009 continue to apply. Existing cross-repo
authorization covers the Hindsight extension. Work uses isolated deterministic fixtures, not existing user databases,
real provider calls or an actual authority switch.

Baseline: Taki `dd2e15b98b6661a01b1f951cfb85f718f2aea75d` plus the completed uncommitted first slice; Hindsight
`8ab65b4c2ea238223eeef84cbdcc012ca7601e86`. Preserve its unrelated `hindsight-control-plane/bin/cli.js` change.
Semantic discovery returned HTTP 404; studies then used direct source/test reads. Reading tests is not test execution.

## Import fidelity

Every record already belonging to current Canonical Local uses structured-current transfer, including B2 conversions.
`provenance.origin = legacy-import` records history, not permission to extract a record again. Original raw historical
Markdown/snapshots retain their old retain/import APIs and frozen receipts. Current unit/policy/lifecycle edits need not
change retained source text (Taki `legacy-canonical-converter.ts:45`, `canonical-memory-repo.ts:143,169`).

All provider paths below are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`:

| Source | Verified behavior and implication |
| --- | --- |
| `api/http.py:6778`, `engine/transfer/schema.py` | Multipart ZIP with skip/replace/new-id; no caller request-idempotency contract. |
| `engine/transfer/importer.py:678,715,820` | Reuse the no-extraction embedding/storage/indexing pipeline, Bank lock and final-state journal publication. |
| `engine/transfer/schema.py:46,101,121` | Missing current lifecycle/revisions/null fidelity, arbitrary observation fields, general source links and Taki evidence. |
| `engine/transfer/export.py:94,154,457` | Invalidated units and observations with missing parents are skipped; not complete current-set coverage. |
| `engine/retain/fact_storage.py:271,467` | Sanitization recomputes hashes and settings can drop original text; preserve declared hash separately from actual nullable text. |
| `engine/transfer/importer.py:1125` | Missing dates become now and null context becomes empty; the DB does not require that loss (`aa2b3c4d5e6f_nullable_event_date.py:31`). |
| `engine/transfer/importer.py:184`, `engine/memory_engine.py:2081` | Unit mappings are process-local, absent from durable result. Document commit then observation failure cannot safely resume with skip/replace/new-id. |
| `engine/retain/types.py:242` | Extraction-oriented filtering drops some legal Canonical text such as `...`; structured known facts must bypass it. |
| `engine/transfer/importer.py:400,420` | Whole-bank restore requires an absent Bank and only remaps top-level Bank IDs; it cannot be used unchanged for verified B3 Banks. |

Reuse target-generated IDs, native indexing and entity resolution when the source supplies the needed information.
Never invent missing chunk content/entity names from an old opaque ID. Preserve original identity/revision/reference
information in durable transfer/source evidence and report genuine representation gaps before publishing that input.
Source metadata and unit metadata are independent. Keep G1 string-map encoding versioned; a native string `1` is not
proof of an original number. Taki policy/provenance remain explicit source evidence, not native inferred semantics.

Admission is empty target or proven replay of the exact frozen request. A known old legacy projection may be superseded
only with an explicit frozen complete ownership/object/version set, rechecked under the Bank writer lock. Unknown
content, extra objects or drift cause conflict. GET followed by unconditional DELETE (`api/http.py:6066`) is insufficient.
Never silently skip, replace unknown objects or change identities to bypass conflicts. Preserve historical receipts.
Final valid/invalidated state and full source links must exist before native journal publication.

G1 receipts provide a transaction pattern (`engine/native_operation_receipts.py:512,615`), but their kind is only
retain/mutation. Add a separate versioned structured transfer result, never a fake tracked retain or rewritten evidence
v1. Import success is independent of maintenance: `engine/memory_engine.py:4597` logs maintenance submission failure
without failing import.

## First-activation maintenance proof

The provider enumerates the complete required source/scope/model set from a bounded candidate and persists actual
native input and committed outcome witnesses. Caller subsets, task completion, queue emptiness, timestamps and
consolidation counters cannot establish completion.

| Producer seam | Required evidence |
| --- | --- |
| `engine/consolidation/consolidator.py:707-768,1204` | Reuse scope expansion; capture source revisions/material, including required already-marked sources. |
| `consolidator.py:1530-1555,1599` | Group verification by resolved scope as well as tags; current tags-only grouping uses the first source's scope. |
| `consolidator.py:2109-2434,2512,2806,3171` | Reuse native recall/prompts/dedup/caps/security; capture actual inputs/action/no-op/failure with action-transaction receipts. |
| `consolidator.py:2323-2327,2609-2632` | Counts/zero-row update are ambiguous; distinguish real no-change from disappeared/stale targets. |
| `consolidator.py:281,429,1658` | Include dedup/fold/delete and partial-scope commits; recover committed actions from receipts rather than replaying an unacknowledged LLM plan. |
| `consolidator.py:1267-1352` | A journaled marker is not consumption evidence for every scope. |
| `engine/memory_engine.py:8515` | Do not clear observations to create new proof; that can destroy surviving co-source observations. |

Reuse `engine/mental_model_refresh.py` modes/windows/outcomes and the native updater. Capture definition, authored
baseline, actual mode/filter/window, effective policy, eligible/retrieved/actually consumed inputs, typed lifecycle
inputs and persisted result. Trace and counts remain diagnostic.

- Cutoff/watermark/reflect read separately (`memory_engine.py:13236,13256`). Retrieval has strict bounds but watermark
  includes cutoff. Revalidate revision/payload witnesses and the full journal interval, including equality, straddling
  commit, deletion/recreation and ABA. Pruned evidence invalidates the candidate.
- `last_refreshed_source_query` affects delta/full choice (`13349`) but is not in the logical model payload; witness it
  separately. Non-journaled effective policy must also be pinned explicitly.
- If historical coverage is unproven, use a cutover-only current-input window, preserving authored content and native
  delta editing. Do not falsify persistent watermarks or change routine automatic scheduling.
- Current-input verification still needs authored-baseline failure protection (`13778` currently depends on a non-null
  lower bound), accurate prompt wording (`reflect/prompts.py:593,795`) and actual post-truncation inputs (`773-786`).
- Eligible-but-unused facts can be a real native irrelevance no-op. Do not force full refresh for empty supporting
  facts; equally, empty facts/watermark advance (`13642,13890`) alone are not proof.
- Deletion/invalidation/scope-exit are typed lifecycle inputs, not fake facts/semantic contradictions. Unavailable
  history/lifecycle coverage stays incomplete, never an excuse to silently narrow input support and declare done.
- Model publication already has a Bank lock, before/after payload and journal (`14132,14283`). Put input/baseline CAS
  and actual outcome receipts there, including failures and no-ops.

Allow native model recall. A finite ordered verification pass does not promise a model fixed point. Do not add provider
source retirement, permanent write admission fences, abort/unfence or healthy-return protocols: Hindsight is the target.

## Final snapshot and recovery

Reuse `engine/replication.py:376,1020` Bank serialization/journal batches. A true no-op has a verified no-write boundary;
do not manufacture an empty journal batch. `engine/logical_snapshot.py:317,400` captures cursor and logical rows in a
repeatable-read view and persists immutable pages. Bind the certificate to those exact pages/hash/cursor. Proof receipts
are independent of deletable task/trace/history; TTL (`590`) must retain needed pages or report a rebuild requirement.

The certificate proves a historical prefix, not remote immutability across a network round trip. Detected relevant drift
invalidates staging; subsequent lawful writes use normal replication. Keep complete reconciliation hashes separate
from versioned maintenance-material hashes; do not ignore all revisions/timestamps.

Taki binds exact manifest/mapping/certificate/snapshot, then retains final writer-reserved Local epoch/fence/digest
checks. An empty Bank needs an explicit empty transfer result, not a fake B2 row. Blocks remain Taki runtime artifacts,
not facts. Preserve B3 template precedence and original Local Bank configuration as evidence. Arbitrary native-edit
rebinding/provider-only Taki-field recovery (D77), B6/B7 and actual activation remain separate.

## Integration refinements verified during implementation

- Native `replication.py:640-685` emits entity canonical names, not raw entity UUIDs. Local retain preserves
  `request.entities` (`local-memory-provider.ts:83`). Nonempty entity names are supported and UUID-shaped names remain
  literal names. Normal Local and B2 producers set `chunkId: null`; an actual non-null chunk reference still needs real
  chunk evidence rather than guessed text.
- `taki-bank-template-v1.ts:52-64` and `hindsight-bank-setup.ts:38-48` establish a continuity model and policy directive
  before B4. Transfer admission preserves exact frozen B3 control-resource witnesses and Bank revision/hash while
  rejecting unrecognized logical content. Required maintenance includes these preserved models even for an empty Local
  source set. No native/Taki template fields or existing model content are silently replaced.
- D78 adds a separate tagged-JSON/binary64 hash encoding to avoid Python/JavaScript number-printing differences. Old
  G1, current-Local manifests and logical snapshot hashes remain unchanged. The new certificate additionally binds
  `snapshot_records_hash` over the complete native LogicalSnapshotRecord sequence, in page/record order, from the same
  snapshot seal transaction. Taki verifies it in addition to the existing native snapshot/page checks.
- The actual B4 `hindsight-replica-repo.ts` stages full native logical payloads and checkpoints; it does not invoke B5's
  Canonical policy projection. D78 connects to that real path and preserves Local evidence plus native derived-input/
  outcome evidence. It does not invent Taki importance/visibility/retention for newly generated observations. The
  trusted derived-policy producer and subsequent Canonical runtime/rebinding remain D77/B6 dependencies. Passing D78
  raw snapshot verification is not acceptance of a production runtime switch or the entire B4 task.

## Test anchors read by the studies

- `test_document_transfer.py:543,736`; `test_taki_replication_transfer.py:398,608,804,881,1503`.
- `test_taki_replication_consolidation.py:195,575,662,752`; `test_taki_replication_observation_maintenance.py:223,320,392`.
- `test_mental_model_delta.py:278,401,705,758,837,908`; `test_mental_model_dry_run_refresh.py:293,376,414`.
- `test_taki_replication_journal.py:196,262,461,500`; `test_taki_logical_snapshot.py:455,609,636`.
