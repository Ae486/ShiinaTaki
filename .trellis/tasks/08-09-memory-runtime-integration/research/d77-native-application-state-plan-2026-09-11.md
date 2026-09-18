# Research: D77 Native Application-State Implementation Plan

- Query: Complete the native application-state protocol and implementation seams needed by D77/B6, including policy-safe native reflect input.
- Scope: Mixed; TakiAgent and the explicitly named local Hindsight checkout, with no network documentation or live service use.
- Date: 2026-09-11
- Status: Concrete engineering proposal for the root to freeze. Public names below are recommendations until acknowledged; the root owns cross-repository schemas and generators.

## Findings

### 1. Authority and selected direction

The current `../grill.md` and the updated D77 handoff supersede the full report's old pending-question paragraphs. Verified native objects may use a real neutral Taki policy before detailed assessment. This proposal does not reopen that decision. It adds provider-hosted durability for Taki-owned state, exact version associations, and safe consumer reads. It does not add a semantic memory engine, a second consolidation loop, Compaction, or a new authority switch.

Use an independent `application_state` contract at version `1.0.0`. Preserve every existing G1/D78 request/result hash, receipt, mapping, certificate, native journal schema, and cutover snapshot behavior. The new compatibility build must have a distinct identity; changing that manifest identity is intentional and is not a change to historical proof bytes.

The two essential clock domains are separate:

- `native_cursor` and native `object_revision` keep their existing meaning.
- `state_cursor` orders joint native/application publications. App-only writes advance it without changing `native_cursor` or pretending that a native fact changed revision.

B5 must consume a new application-aware projection/checkpoint path. Feeding a changed policy-bearing Canonical record through the old native-only `applyPage` at the same native revision will correctly fail its hash invariant; do not weaken that invariant globally.

### 2. Existing code seams to reuse

Native paths in this report are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`.

| Source | Exact reuse or constraint |
| --- | --- |
| `engine/replication.py:376` | `lock_replication_bank_state`: existing Bank row lock must precede canonical/application locks. No advisory locks. |
| `engine/replication.py:1020` | `append_logical_changes`: final typed payloads, authoritative memory revisions, assigned non-memory revisions, batch IDs and tombstones on the caller transaction. Add the application publication call here after native journal assignment and before return. |
| `engine/replication.py:441`, `:512`, `:619`, `:818`, `:906` | Complete public logical serializers for documents, live/archive units, models and directives. Native document logical payload intentionally omits original text/context; Taki source bodies cannot be reconstructed from it alone. |
| `engine/replication.py:704`, `:748`, `:964`, `:1262` | Bank lifetime, durable deletion marker, non-memory revision lookup, and journal pruning. Application history needs independent generation keys and retained current heads. |
| `engine/logical_snapshot.py:317`, `:373`, `:435`, `:481` | One repeatable-read logical source; existing optional binding means finite cutover and pins retention. A general D77 snapshot must use an independent service or a neutral source loader, never impersonate that binding. |
| `engine/transfer/current_state_schema.py:36`, `:67`, `:78`, `:106` | Tagged binary64 hash semantics. The existing model validator additionally imposes depth 64: reuse the encoding semantics, not that validator as the D77 Canonical domain. |
| `engine/transfer/current_state_writer.py:144`, `:163` | D78 target payload hashes are `current_state_hash(payload.model_dump(mode="json"))`; retain this definition for an exact native payload witness. |
| `extensions/builtin/taki_memory.py:63`, `engine/memory_engine.py:1794`, `:1811` | Typed extension routes and engine-side tenant authentication/capability enforcement. Routers contain no SQL. |
| `engine/taki_compatibility.py:99`, `:264`, `:289` | Independently advertised contracts and real schema capability probes. SQL/PostgreSQL/authenticated deployment is required. |
| `admin/cli.py:39`, `:297` | Every persistent table is backed up in dependency order from one repeatable-read view. |
| Taki `packages/shared/src/memory-provider-domain-schema.ts:41`, `:59`, `:69`, `:101` | Complete source/unit/provenance/policy domains; distinct source and unit metadata. |
| Taki `packages/core/src/db/structured-memory-block-repo.ts:10`, `:16` | Block identity is `(blockId, scope)`, independent of authority epoch; trusted writer and whole-document revision CAS. |
| Taki `packages/core/src/memory/block-registry.ts:33` | User card is user-owned; user model and per-Character index have background writers. |

The shared journal hook covers the existing instrumented retain, curation, invalidate/restore/delete, consolidation, observation maintenance, transfer, Bank/config, mental-model and directive producers. Existing native tests name these writer families. A notification-only `on_retain_complete` or an aggregate consolidation callback is not a replacement for the transactional hook.

### 3. Exact identity, payload and artifact models

Every wire model is closed and typed. Use named Pydantic models/dataclasses internally, not raw dictionaries for known fields. Integers used as revisions/cursors/counts are strict safe JSON integers; UUID fields remain UUIDs. Do not add an implicit authority epoch to a Block's identity.

Recommended primitive models:

```text
ApplicationNamespace {
  provider_lineage: UUID,
  bank_generation: UUID,
  application_id: "taki"
}
// bank_id is a required route component and is echoed in every stored envelope/hash.
// tenant schema is resolved from authentication, never supplied by the request.

NativeVersion {
  object_kind: bank | document | memory_unit | mental_model | directive,
  object_id: string,
  object_revision: positive-safe-integer,
  payload_hash: lowercase-sha256,
  native_cursor: safe-integer-or-null
}
// null cursor is an explicitly established snapshot baseline, not an invented journal event.
// Identity always includes namespace.provider_lineage, bank_generation and route bank_id.

ArtifactKey { artifact_kind: bank | source | memory | block | read_admission, artifact_id: string }
ArtifactVersion { key: ArtifactKey, revision: positive-safe-integer, record_hash: sha256 }
ApplicationCheckpoint { native_cursor: nonnegative-safe-integer, state_cursor: nonnegative-safe-integer }

BodyRef {
  body_id: UUID, body_schema: versioned-enum,
  payload_hash: sha256, bytes_sha256: sha256,
  total_bytes: positive-safe-integer, part_bytes: positive-safe-integer,
  total_parts: positive-safe-integer
}
```

`NativeVersion.payload_hash` hashes the actual snake_case native logical payload with the existing tagged binary64 encoding. It is not a Canonical-record hash or a hash of a recalled excerpt. For a tombstone carry a typed `NativeTombstone {object_kind, object_id, object_revision, last_payload_hash: sha256|null, native_cursor}`; do not invent a body hash for a body that is absent.

Recommended artifact bodies:

| Kind | Complete typed body | Binding and ownership |
| --- | --- | --- |
| `bank` | Original Canonical Bank identity/scope and original provider/epoch references; current Taki scope mapping and application identity. Preserve the complete original Bank body when importing one. | Exact native Bank/generation association. Immutable origin fields are not rewritten into a claim that the provider owns Taki's authority epoch. |
| `source` | Complete `CanonicalMemorySource`, including retained text, context, source metadata, tags, content hash, dates, revision and provenance; optional original import witness/operation association. | The original submitted source is durable evidence. It may be stored as `awaiting_native` before G1 dispatch, then bound to an exact native document result. Native document metadata never replaces original source metadata implicitly. |
| `memory` | Current versioned Taki policy and explicit assessment state; complete actual record provenance; source-artifact references; original Canonical record when one exists (full unit/policy/provenance, not its witness alone). For a new provider-derived object, `original_record` is explicitly null. | One native unit identity, exact native revision/hash. Original unit metadata remains separately recoverable from source metadata. The native unit's current text/lifecycle/relationships are read from native state, not updated in a competing application copy. |
| `block` | `{block_id, scope, content, block_revision, updated_at, writer, block_contract_version}`. Full content, including empty content, is preserved. | Core-owned document with no native fact/model identity. Store it with the matching Global or Character Bank generation as a recovery copy. Source Block identity/version and provider artifact revision are distinct. |
| `read_admission` | `{target: NativeVersion, policy_contract_version, decision: admitted|denied|unresolved, evidence_kind: complete-input-manifest|explicit-taki-assessment, dependency_manifest_ref|null, assessed_at, assessor_ref}`. This is needed only for non-unit inputs exposed to guarded reflect. | Exact model/directive/document-source body, with root-defined read rules. It is not a fabricated `TakiMemoryPolicyProjection.memoryId` for a mental model. An unresolved decision never grants access. |

The root should reuse/finalize its policy/assessment schema in the `memory` body; this protocol does not choose importance, retention or mood defaults. A policy is present only if actually produced. `neutral` is a real policy/assessment state; `awaiting_native`, `needs_rebind`, and `tombstoned` are association/lifecycle states and never aliases for neutral or for Pending Memory.

Each artifact envelope contains `namespace`, `bank_id`, its key, artifact revision, full `body_ref`, `binding` (exact `NativeVersion`, absent for Blocks, or an explicit pending operation reference for an unbound source), creation/update times, and `record_hash`. A rebind creates a new artifact envelope revision even when it references the same immutable body. A semantic policy revision need not advance for a pure rebind.

Preserve historical bodies and their association versions. A source/native document edited after import does not make the original accepted source become the newly edited text. If its content association cannot be proved, retain the original body and mark the current association unresolved. Do not bind by nearest revision, text similarity, same ID alone, or an inherited source-wide policy.

For native-created documents, add an independent typed `NativeDocumentSourceEvidence {document_version: NativeVersion, original_text: string|null, context: string|null, source_metadata: JsonObject, source_evidence_hash}` to the new snapshot/hydration body domain. Load `documents.original_text` and the actual selected context/metadata from `retain_params` on the same connection/view; `engine/transfer/current_state_rows.py:104` and `engine/reflect/tools.py:418` show those persisted fields. Bind its own full-body hash in addition to the frozen logical document hash, because the old v1 document projection intentionally omits source text. Do not expose private replay parameters wholesale. Preserve unavailable source text as null with its actual availability state; it is not an empty string. Such native evidence does not itself manufacture Taki's `sanitized:true`, timeline provenance or an original Local source; the root's read-boundary admission produces those only when justified. Taki-submitted original source bodies remain independently available even when native document-text retention is disabled.

### 4. Wire endpoints and capacity

Recommended prefix: `/ext/taki-memory/banks/{bank_id}/application-state`.

All requests carry `ApplicationNamespace` in the body or typed query dependency. All methods authenticate inside the engine and verify Bank ownership; reads do not create a Bank or revive its generation. Unknown fields, mismatched route/body Bank IDs, wrong generation, and unsupported body schema fail closed.

| Method / suffix | Request | Response |
| --- | --- | --- |
| `POST /bodies` | `BodyUploadRequest {namespace, body_id, body_schema, payload_hash, bytes_sha256, total_bytes, part_bytes, total_parts}` | `BodyUploadStatus {namespace, bank_id, descriptor, state: uploading|sealed, received_parts, expires_at|null}`. Large received-part inventories use bounded index pages. |
| `PUT /bodies/{body_id}/parts/{part_number}` | `BodyPartRequest {namespace, part_sha256, data_base64}` | Small immutable `BodyPartReceipt`. Repeating identical bytes is idempotent; different bytes at the same index are a conflict. |
| `POST /bodies/{body_id}/seal` | Namespace and exact expected descriptor | Sealed `BodyRef`, only after total size, every part, strict JSON parsing, typed body validation and both hashes pass. |
| `GET /bodies/{body_id}` and `/parts/{part_number}` | Namespace | Descriptor/status or `BodyPart {part_number, part_sha256, data_base64}`. Scope checks apply even if the body UUID is known. |
| `POST /commits` | `ApplicationCommitRequest {namespace, operation_id, request_hash, commands_ref}` | `ApplicationCommitReceipt`, described below. `commands_ref` is a sealed typed `application-commands.v1` body. |
| `GET /commits/{operation_id}` | Exact historical namespace | Immutable receipt or typed `absent`; reading never executes the command. |
| `POST /hydrate` | `HydrateRequest {namespace, selectors:[{object_kind, object_id, expected_version|null}], artifact_keys:[], request_id}` | Immutable `ReadBundleManifest` of full native records, exact associations, application bodies and binding-needs from one view. Returned records reference bounded body parts. |
| `POST /snapshots` | Namespace, requested TTL, `request_id` | `StateSnapshotManifest`, covering the complete native/application recovery set and a paired checkpoint from one view. |
| `GET /snapshots/{snapshot_id}` and `/pages/{page_number}` | Namespace | The immutable manifest or bounded typed record descriptors. |
| `GET /changes` | Namespace, `after_state_cursor`, `limit` | `StateChangePage {from_checkpoint, to_checkpoint, changes:[StateChangeManifest], has_more, minimum_state_cursor}`. Only complete state events may be acknowledged. |
| `GET /changes/{state_cursor}/pages/{page_number}` | Namespace and expected event hash | Immutable bounded descriptor page; large native/application bodies are fetched by `BodyRef`. |

The `hydrate` result uses the same immutable bundle/page mechanism as snapshots, avoiding a second unbounded response shape. A missing or stale selector gets a typed per-selector status, not fabricated Canonical fields. All selectors in one request share a view; fetching their referenced immutable bodies later cannot mix native and policy revisions.

Recommended transport settings are 256 KiB decoded part bytes and at most 512 KiB encoded JSON per HTTP response. These values are proposed new-protocol constants and must be exposed in the manifest and agreed by both clients. Base64 expansion plus the complete envelope must be accounted for. Page by encoded bytes as well as item count. Do not return an unbounded list of all page/part hashes in a manifest; use bounded descriptor pages and a root digest over their ordered hashes.

An incoming upload/commit size limit can reuse the existing 16 MiB operational ceiling as a separately advertised D77 setting, but it is not a Canonical domain limit. Preflight the complete encoded input before any source-retain/native mutation dispatch. Values beyond the negotiated limit receive an explicit `payload_too_large` refusal or a later supported multipart version; never trim content, drop metadata keys, shorten arrays, or acknowledge a partial artifact. Provider-generated snapshot/change bodies also use parts and must not be cut to the upload limit.

The binary JSON domain needs independent iterative validation/encoding. Preserve finite binary64 numbers, null/empty/omitted distinctions, literal JSON-looking strings, and own keys such as `__proto__` and `constructor`. Do not inherit D78's depth-64 validation or recursive stack limit. Preserve bodies as escaped JSON bytes in `BYTEA` parts (with typed indexed headers), rather than requiring every arbitrary application value to fit PostgreSQL JSONB string restrictions. Refuse an unsupported Unicode representation before dispatch; never silently normalize an original source string. Old G1/D78 validators and encoders remain unchanged.

Hash definitions:

- Native payload witness: the existing D78 `current_state_hash(native_payload)`.
- New request/record/event/snapshot digests: the same tagged-binary64 encoding over a new explicit domain such as `{domain:"application-state-record.v1", namespace, bank_id, value}`. Each digest's omitted self-hash fields must be declared in its schema/tests.
- Part and joined-wire checksums: SHA-256 over the exact decoded bytes. They protect transport; the semantic payload hash protects typed JSON identity. Two different serializations are not permission to reuse one part index with different bytes.

### 5. Persistence and atomic commit

Use one additive PostgreSQL migration after the actual current head (the inspected latest D78 migration is `d78c3e6f8b12`, following `d78b2d5e7a01`; recheck the DAG before assigning an ID). Recommended tables:

| Table | Required key/state |
| --- | --- |
| `memory_application_banks` | `(provider_lineage, bank_id, bank_generation)`; capture start, current `native_cursor`/`state_cursor`, minimum replayable state cursor, initialization/deletion status. |
| `memory_application_native_heads` | Namespace plus native kind/ID; exact current native version or tombstone, immutable native body ref, current binding state, previous bound artifact ref, change cause. Head revision does not depend on retaining all old v1 journal rows. |
| `memory_application_artifacts` | Application namespace plus artifact key and artifact revision; immutable envelope/body ref, native binding, tombstone flag. Index latest revision; never overwrite an old envelope. |
| `memory_application_bodies` | Namespace/body UUID, descriptor, state and staging expiry. Sealed referenced bodies do not expire as uploads. |
| `memory_application_body_parts` | Namespace/body UUID/part number, byte checksum, exact byte content. |
| `memory_application_changes` | Namespace/state cursor; native before/after watermarks, native batch IDs, immutable event-manifest/body reference. Includes full replayable native and application changes, not just a wake-up signal. |
| `memory_application_operations` | Application namespace/operation UUID, request hash, immutable terminal result/refusal and result hash. No FK to the live Bank or native object. |
| `memory_application_snapshots` | Namespace/snapshot UUID, paired checkpoint, immutable manifest/body refs, retention/expiry. No D78 certificate or cutover pin is manufactured. |

Bodies/pages can share the typed body store; do not introduce another parallel blob store for snapshots. Headers use typed columns and exact foreign keys to historical rows; no `ON DELETE CASCADE` from the live `banks` table may erase the only original evidence or receipts.

`ApplicationCommands` is a discriminated union list:

```text
put_artifact {
  key, expected_artifact: absent | ArtifactVersion,
  body_ref, binding: exact-native | awaiting-native | core-block,
  expected_native: NativeVersion | null,
  actor: typed trusted Core actor reference
}
rebind_artifact {
  key, expected_artifact: ArtifactVersion,
  expected_native: NativeVersion,
  body_ref // same body is allowed; an explicitly revised policy body is also allowed
}
retire_artifact {
  key, expected_artifact: ArtifactVersion,
  expected_native: NativeVersion | null,
  reason: closed-code
}
```

`absent` means no prior artifact version, not a currently tombstoned artifact. A tombstone keeps its monotonic revision, preventing delete/recreate ABA. A receipt for a rebind reports the exact new artifact/native association, not that an LLM assessment occurred.

Engine commit algorithm:

1. Authenticate/authorize the tenant and Bank, require the application contract, verify the complete sealed command body/hash. Parse all bodies into typed models before entering the write transaction.
2. Start a short transaction; acquire the existing replication Bank row, then the application Bank row, then artifact/object keys in a stable order. Verify live Bank, provider lineage and generation while locked. No external I/O or model call occurs here.
3. Look up the exact operation UUID. A matching request hash returns the historical receipt without reevaluating current CAS. A different hash is `request_id_conflict`. This is what makes a lost ACK recoverable after newer native changes.
4. Verify every expected artifact revision/record hash and native revision/payload hash against the authoritative current head and serializer. Validate source references and same-Bank membership. Reject the entire command if any comparison fails. No partial success.
5. Insert immutable artifact versions and update association/binding-needs. Native unit content/revisions are not touched by a policy-only commit. A native layer-tag correction remains a native conditional mutation followed by exact rebinding; a future combined mutation must explicitly share its native transaction, not spoof a journal row.
6. Append one application state event, then seal its durable result in the same transaction. Successful native/app state, their state cursor, and the receipt commit or roll back together. A recorded deterministic refusal has no successful state cursor and no applied artifact versions.
7. Return `ApplicationCommitReceipt {namespace, bank_id, operation_id, request_hash, state: completed|refused, result_hash, checkpoint|null, affected_versions_ref|null, refusal|null, completed_at}`. It must remain readable after object supersession or Bank deletion. Transport disconnect/cancellation after dispatch is unknown until this original receipt is read.

Body uploads before the transaction are preparation, not a successful policy write. Their staged orphan cleanup must not delete any body referenced by a committed artifact, event, snapshot or receipt.

### 6. Arbitrary native mutation publication and rebinding

Add a focused module such as `engine/application_state/publication.py` with `record_native_application_changes(conn, fq_table, bank_id, batch, changes)`. Call it from the common native append path after assigned native cursors/revisions are known. It uses the same transaction/Bank lock, stores complete native payload bodies and exact current heads, and adds durable binding work:

- New unit ID: `binding_missing`, with actual native creation evidence and no fabricated source or policy.
- Same ID, new revision/hash: `rebind_required`, preserving the previous artifact/body reference and recording both old and new native versions.
- Invalidated/restored native unit: native lifecycle remains authoritative, independently of a preserved policy.
- Tombstone: current binding becomes unusable; prior evidence/body remains historical. Bank tombstone closes the generation.
- Changed document or changed model dependencies: mark affected association/read-admission checks unresolved. Do not silently propagate a source policy to every fact.

Taki can perform a deterministic rebind outside the producer transaction when unchanged Taki fields are demonstrably still applicable, or ask its narrow curator when semantic classification changed. Both commit with dual CAS. A new classified/neutral policy must use actual evidence and cannot bypass the previous hidden/invalidated restriction by treating an old ID as a brand-new unclassified object.

No change to ordinary extraction/consolidation schedules, no native model call for D77 rebinding, no automatic Taki semantic pass over correctly classified ordinary facts. The hook records facts about native changes; it does not decide their semantics.

Application-only changes call the same state publisher but have no native batch: `native_before == native_after`. A native batch advances its native watermark by the exact existing range. Its complete payload is retained in the new replay event, so independently pruning old v1 journal rows cannot turn a claimed replayable D77 event into a hash-only witness.

Preserve the existing transaction-batch rule. If a native outer transaction publishes more than one batch or also changes artifacts, group them into one state event before commit; never make a consumer checkpoint an intermediate version. A small transaction-local publication token (PostgreSQL `set_config(..., true)`, keyed by the fully qualified Bank namespace) can group repeated calls without advisory locks or edits to DB wrapper files. It is only an aggregation hint; durable Bank rows and full CAS remain authoritative. Savepoint rollback must restore both hint and rows. Test multiple append calls in one outer transaction explicitly. All page/body rows for the final group become immutable at commit.

A missing application schema disables only the new capability on an older supported installation. Once a generation has application capture installed, publication failure must fail that native transaction; it is not a non-fatal post-hook. A discrepancy between its stored native watermark and the next native batch indicates missed/old writers and requires catch-up from complete existing journal data or a new verified snapshot. Do not silently skip the discrepancy. Deployment must update all writers coherently before advertising D77.

### 7. Bootstrap, snapshot, hydration and replay

Initialization establishes a documented capture baseline under the Bank lock: serialize current native objects, record their real row/journal or explicit snapshot-baseline versions, create exact native heads, and set the paired watermark. It does not claim to reconstruct unavailable past events. Existing imported Taki bodies and D78/G1 mappings are then uploaded and verified against current heads. If a historic mapping no longer matches, preserve it as evidence and use the recorded current-version rebind path; never silently reuse the old match.

A general snapshot service opens one `repeatable_read` transaction and reads native replication state plus application state in that view, validates generation/capture continuity, then serializes native logical objects and complete application envelopes/body references. Reuse the current bulk logical serializers; expose a neutral source-loading helper if needed. Do not call `create_snapshot(binding=application_callback)`, because its current binding semantics imply `retained_for_cutover` and D78 publication.

Materialize a distinct immutable manifest:

```text
StateSnapshotManifest {
  contract_version: "1.0.0", snapshot_id, namespace, bank_id,
  checkpoint: {native_cursor, state_cursor},
  native_schema_version: 1, application_schema_version: 1,
  counts_by_kind, total_records, total_pages,
  manifest_hash, created_at, expires_at
}
```

Descriptor pages have stable order (native kinds/ID, application kind/key/revision, required binding/evidence dependencies), page index/count/hash, and immutable body refs. The root digest binds namespace, both clocks, counts and the complete ordered page hashes. Current artifact bodies, original source/record bodies, Block bodies, current native heads, and any historical associations they reference are in the recovery closure. Merely retaining a hash outside that closure is insufficient.

Hydration uses the same snapshot mechanism for a requested subset and its dependency closure. It returns a current verified object plus its exact application association or an explicit `binding_missing/rebind_required/gone` status. If a raw recall result has no revision, do not claim that its old score/text identifies the newly hydrated version: compare available content evidence, then rerun/skip stale results according to the root's consumer contract.

Each replay event binds `state_cursor`, previous/next native cursor, complete existing native batch identity/range(s), ordered native record descriptors, application artifact versions, and binding-state updates. A client stages all descriptor pages and body parts, checks hashes/namespace/contiguity, then applies the complete event in one SQLite transaction with both checkpoint fields. Partial downloaded pages may survive a restart but may not advance either committed checkpoint. An app-only policy change alters the app/CAS revision and projection hash while preserving the native object revision.

Snapshot-at-S plus replay-after-S must equal a later complete snapshot for native bodies, policies, original evidence, Blocks, binding states and both clocks. This is the acceptance property; two independently fetched snapshots do not establish it.

### 8. Policy-safe native recall/reflect reuse

The root requested this additional bounded check because native reflect consumes memory internally. Post-filtering returned `based_on` cannot undo a hidden fact already sent to its model.

Verified seams:

| Source | Finding / minimal extension |
| --- | --- |
| `engine/memory_engine.py:11746`, `:11897` | `reflect_async` creates the mental-model callback, then observation, recall and expand callbacks. Add one internal typed `ReflectReadAdmission` parameter and pass it through those callbacks; normal native callers and D78 keep the absent-parameter behavior. |
| `engine/memory_engine.py:11997`, `:12023` | Directives/profile enter before the first prompt. Admission must validate/filter their exact versions before `run_reflect_agent`, rather than after reflection. `apply_all_directives` cannot bypass Taki admission. |
| `engine/reflect/tools.py:59`, `:126` | Mental-model search reads SQL directly and returns model name/content. It does not traverse the ordinary recall filter, so it needs its own admission check. |
| `engine/reflect/tools.py:174`, `:256` | Observation and fact callbacks call native `recall_async`, including nested source facts/chunks. Preserve native retrieval and scoring, but apply the same policy to all supplementary content. |
| `engine/reflect/tools.py:322`, `:418` | `expand` can return a whole original document plus retain parameters from an allowed memory ID. An eligible fact does not authorize every sibling/source statement or private retain parameter. Require explicit whole-source admission or withhold that expansion. |
| `engine/memory_engine.py:5861`, `:5883` | Fused candidates become cross-encoder input. An optional admission filter here, before tracing/reranking, prevents an internal reflect recall from sending hidden content to a reranking model. No second retrieval engine is needed. |
| `engine/memory_engine.py:6111`, `:6375`, `:6561` | Chunk, observation-source-fact and entity enrichments are independent reads. Validate them before any model-visible tool output; do not assume filtering the top hit filters its supplements. |
| `engine/reflect/agent.py:479`, `:503`, `:561`, `:845` | Initial prompts, each LLM call, and incremental cache creation are separate emission points. Admission must already have removed forbidden content before prompt/tool assembly and recheck the admitted version set before a model/cache submission. |
| `engine/reflect/agent.py:1168`, `:1181`, `:1223` | Tool output is observed before available-ID bookkeeping, model-shortcut decisions, message append and trace storage. An independent typed guard belongs before all of these, not only before rendering `based_on`. |

Recommended new route: `POST .../reflect` with `ApplicationReflectRequest {namespace, request_id, policy_context_ref, native_request}`. `native_request` reuses the native reflect DTO. The request context is a typed, hashed, Bank/generation-bound Taki read context (purpose, policy-contract version, captured time and applicable mood/actor scope); the server resolves and checks actual application policies, never trusts a client-supplied `eligible:true` flag. Large admission manifests use the existing body mechanism.

The engine builds one request-scoped `ReflectReadAdmission` from a verified native/application checkpoint. It may internally contain exact admitted native versions and their policy/artifact references. It supports these named operations:

```text
admit_initial(profile, directives) -> AdmittedInitialInput
filter_candidates(candidates) -> AdmittedCandidates
admit_tool_output(tool_name, typed_output) -> AdmittedToolOutput
before_model_input(admitted_dependency_manifest) -> None or typed policy-drift refusal
```

No database transaction spans an LLM, embedding, cross-encoder or cache request. Read and freeze exact policy/native associations in short transactions, filter before exposing content, and verify the selected associations before each later model submission. A changed restrictive policy, invalid lifecycle, Bank generation change, or missing exact binding must not be silently treated as neutral. On a policy-relevant mid-call conflict, stop the guarded call with a typed refusal rather than reusing a prompt that already included the now-unadmitted input. The root should declare the admission checkpoint as the linearization point; an impossible lock-free guarantee against a mutation after network dispatch must not be claimed.

New or changed observations follow the root's explicit neutral policy rule once valid ownership/version is established. Mental models and raw document expansions need their own verifiable admission because they can contain multiple memories. A model's `reflect_response.based_on`/declared citations are not proof of every input it consumed: `memory_engine.py:12120` deliberately filters them to the agent's declared used IDs. Do not authorize an opaque model body solely because its cited subset is eligible. Existing complete input evidence may prove safe dependencies; otherwise require an explicit, version-bound Taki admission artifact for the derived body, or withhold that derived/expanded input. Retain the body for recovery. This does not require Local to implement model maintenance.

The existing D78 `_input_evidence` hook is an excellent test observation point, but is not the new public admission mechanism: its presence also changes evidence semantics (`memory_engine.py:12126`). Add a separate optional hook and keep D78 paths unchanged. Filtered facts must also be absent from native tool traces, evidence responses and structured-output follow-up calls. Disabled tools remain disabled even if the model fabricates a tool call.

Raw Taki recall may continue using native recall plus exact hydration/filtering before Taki consumption. Advertise guarded reflect separately (`application_reflect` capability or an explicit supported field under `application_state`) only when all the input paths above are covered. Until then, return a truthful capability refusal; never wire bare native reflect as a completed Taki provider feature.

### 9. Lifetime, retention, portability and capability rules

- A Bank deletion closes its generation and emits a state event; application artifacts/receipts do not cascade away. A new Bank with the same string ID has a new generation and cannot inherit old active bindings. Explicit restoration/reimport must verify new target identities and produce new bindings, while keeping original origin references.
- Use one fixed Taki application namespace per authenticated Bank generation; this protocol does not introduce a second installation/authority registry. A restarted or reconstructed Core can discover the original Taki scope from the Bank artifact. A caller cannot pair an artifact from another Bank, generation or tenant with its own native object. If multiple unrelated applications later share a Bank, that requires a separately versioned event-partition contract rather than silently filtering foreign events out of this cursor stream.
- Journal retention has an independent complete-event floor. Below it, return `state_reset_required` with the actual floor/current checkpoint; never pretend an app-only change was covered by the native cursor. Retaining current heads prevents non-memory revisions from regressing after old native rows are pruned.
- Snapshot TTL controls downloaded bundle availability, not original-source/body lifetime. Expiring a snapshot may delete only its private unreferenced bundle references. Retain bodies referenced by current artifacts, archived original evidence, operation receipts or retained snapshots/events. First implementation should keep terminal receipts and original evidence conservatively rather than invent a lossy GC policy.
- Physical backup includes all new tables, with their namespace, clocks, body parts, receipts and snapshots in the existing coherent backup view. Restore ordering must precede children. A partial old backup lacking D77 data cannot claim provider-only application restoration.
- Existing native portable exports remain unchanged and do not silently claim to include application state. The D77 portable artifact is the verified joint snapshot plus complete reachable bodies. It exports supported logical content and origin mappings, but not reusable live process leases, credentials or a claim that the old provider generation is the new one. Import stages bodies, imports native current state through existing contracts, then establishes new bindings with exact mapping proof.
- Add `contracts.application_state` and guarded-reflect support/limits to the canonical compatibility model, with specific unsupported reasons. Probe actual table/column/constraint availability, SQL-row storage, authenticated tenant mode, native-journal support and active capture. Do not infer support from a version string alone.
- PostgreSQL only. Use `run_for_dialect(pg=...)` intentionally for the additive migration; Oracle does not receive empty pretend implementations. Native writers on unsupported alternative stores must not execute PostgreSQL application SQL. Missing new support does not rewrite the meaning of old G1/D78 support.
- Rollout updates all native writers coherently and performs migration plus handshake/generation bootstrap before enabling D77 consumption. Rollback first disables new admission and drains owned work. Do not downgrade away nonempty application history or return to a writer that can silently miss required publication. No deployment is authorized by this research.

### 10. Minimal implementation ownership and validation

Recommended native footprint (names may be adjusted by the root):

1. `engine/application_state/{models,codec,store,publication,snapshot,read_admission}.py`: typed wire, byte-preserving bodies, atomic CAS/results, joint state journal, snapshot/hydration, policy-read guard. Split only along these responsibilities.
2. `engine/replication.py`: one common transactional publication hook and generation lifecycle integration; old logical event construction remains unchanged.
3. `engine/memory_engine.py`: authenticated application methods and optional read-admission plumbing through existing recall/reflect callbacks. `engine/reflect/agent.py` and `engine/reflect/tools.py` receive only the needed pre-consumption guard hooks.
4. `extensions/builtin/taki_memory.py`, `engine/taki_compatibility.py`: thin typed routes, closed errors, separate capabilities. Optional neutral snapshot source loader in `engine/logical_snapshot.py` must preserve existing behavior byte-for-byte.
5. One additive migration plus `admin/cli.py` table inventory. Record the necessity and final footprint in `TAKI_PATCHES.md` before production edits.
6. Root-owned canonical OpenAPI/generator/client changes and Taki schemas/consumer implementation. Generated artifacts are regenerated; no hand-written client drift.

Do not edit the parent's listed unrelated pre-existing engine/db, Supabase, conftest or control-plane CLI files. There is no need to modify those files to express this protocol.

| Focused test | Required evidence |
| --- | --- |
| Real PG transaction failure after native/app publication but before receipt seal | Native rows, both clocks, artifacts, binding-needs, parts and receipt all roll back; another Bank continues. Include failure at COMMIT where feasible. |
| Parallel real PG CAS | Two updates with the same expected artifact/native version produce one success and one typed conflict; no last-writer overwrite. App-only update leaves native cursor/revision unchanged. |
| Lost commit ACK then later native edit | Status read and identical command replay return the original sealed receipt; no second semantic/native write, no fresh CAS reinterpretation. |
| External writers | Ordinary native retain, direct HTTP edit/invalidate/restore/delete, consolidation-created observation and model/directive changes all emit exact application head/binding work. Do not test only Taki-issued writes. |
| Source-evidence-loss reconstruction | Delete all Taki source/provenance/projection fixtures, retain only native+application provider state, rebuild fresh SQLite. Verify full source/record/Block bodies, identities, typed metadata and policy, including different source/unit metadata. |
| Two Banks and generation reuse | Forged cross-Bank body/part/binding/receipt access fails. Same string Bank ID after deletion cannot reuse old bindings; historical receipt reads remain scoped and non-executing. |
| Snapshot/journal MVCC | Concurrent native and app-only writers; snapshot plus replay equals final snapshot. No data/cursor advance from rolled-back writes. Multiple native appends in one outer transaction remain one complete consumer group. |
| Capacity and hashes | 100,000-character sources, large multi-part metadata, depth beyond 64, own special keys, multibyte boundaries, finite numeric extremes, null/empty, duplicate/missing/out-of-order/corrupt parts. Over-limit input is refused before native dispatch. |
| Prune/expiry/backup | Old v1 pruning does not destroy replayable D77 bodies or current head revisions; new floor returns reset. Nonempty backup/restore keeps source evidence and receipts; snapshot expiry does not erase original artifacts. |
| Guarded reflect actual input capture | A deterministic native LLM spy and reranker spy must never receive hidden/ineligible text through facts, observations, source facts, chunks, expand, MM SQL lookup, directives, initial/profile context, trace, cache or structured-output continuation. Include allowed sibling + hidden sibling in one document and opaque model with an eligible cited subset. |
| Guarded reflect race/unknown states | Valid neutral policy is usable; missing binding/unknown ownership is not. Restrictive policy change between tool completion and next LLM call refuses; no evidence-only post-filter false green. |
| Frozen contracts | Existing G1/D78 golden request/result hashes, receipt/append/replacement, finite certificates and cutover snapshot tests stay unchanged and pass. Existing native reflect without the new hook retains its behavior. |

Run the native migration shape/DAG, backup inventory, focused PG protocol tests and existing affected writer/snapshot/G1/D78 regressions; then canonical OpenAPI and maintained SDK generation/tests, `scripts/hooks/lint.sh`, and independent code review. Use the already owned deterministic fixture mechanisms. Do not issue real model calls, use the original user DB, touch retained D78 targets, start services, or report live/manual acceptance under this research authorization.

### 11. References and related specs

- Current task `grill.md`, `design.md`, `implement.md`; `research/d77-hindsight-runtime-handoff-2026-09-11.md`; full D77 report sections 8-11, with its old pending-answer language explicitly superseded.
- `.trellis/spec/backend/{database-guidelines,error-handling,hindsight-runtime-reads}.md`; `.trellis/spec/guides/{source-grounding-guide,cross-layer-thinking-guide}.md`.
- `docs/adr/0009-single-memory-authority-with-local-replica.md`; existing B1 policy/provenance/Block contracts cited by the handoff.
- Local external checkout `H:/hindsight/CLAUDE.md`, `.claude/skills/code-review/SKILL.md`, `TAKI_PATCHES.md`; native API/package 0.9.0 and current compatibility build `taki-memory-hindsight-0.9.0-d78-v1`. No upstream branch operation was performed.

## Caveats / Not Found

- This is a protocol plan, not implemented or tested behavior. The root must freeze public schema names, policy/read-context body details and advertised limits before parallel implementation. These are engineering contracts, not a renewed product grill.
- The focused native `jbcontext search` returned HTTP 404/no results. The additional reflect check used direct reads of the named engine/reflect files and exact symbols. No second broad search was attempted.
- A complete safe dependency manifest is not implied by a model's declared citations. Until the derived-body admission path is implemented, guarded reflect must withhold opaque models/expansions or return an explicit capability/refusal; bare native reflect is not B6 completion.
- The global `.trellis/.current-task` file was empty. The root supplied and verified the session-scoped active task and explicitly assigned this output path, so no new task or guessed output directory was created.
- Only this research file was written. No code, other task/spec file, memory file, Git state, service, dependency, original data or model endpoint was changed/accessed by this researcher.
