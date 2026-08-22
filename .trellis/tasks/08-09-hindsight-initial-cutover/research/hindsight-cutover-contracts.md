# Hindsight Initial Cutover Contracts

Status: read-only research for `08-09-hindsight-initial-cutover`.
Date: 2026-08-21.
Scope: accepted Hindsight `0.9.0` plus Taki compatibility build
`taki-memory-hindsight-0.9.0-batch0-v2`.

## Decision Summary

Initial cutover must be a staged, resumable protocol:

1. Authenticate and admit the exact compatibility manifest before import or authority mutation.
2. Verify the Global and Character Banks and approved Taki template revision.
3. Import each normalized source with deterministic Bank, document, and async operation identities.
4. Treat operation completion as necessary but insufficient: resolve the document and every resulting fact ID/revision.
5. Build a staging replica from one cursor-bound logical snapshot, verify its pages and manifest, then commit its
   `end_cursor` checkpoint atomically with the replica.
6. Activate a new Hindsight Authority Epoch only after zero blocking ledger rows and a successful authority fence.
   Every failure leaves `canonical-local` authoritative and preserves resumable state.

## 1. Deterministic Identity And Retain Idempotency

Taki's existing migration identity source is `legacy-identities.ts`. It uses domain-separated SHA-256 hashes:

- source: `legacy-source/v1(relativePath, rawSha256)`;
- document: `legacy-document/v1(bankId, sourceId)`;
- operation: `legacy-operation/v1(bankId, documentId, rawSha256)`;
- memory result: `legacy-memory/v1(bankId, documentId, ordinal, payloadHash)`.

Evidence: `H:/TakiAgent/packages/core/src/memory/legacy-migration/legacy-identities.ts:10-33`. CRLF normalization is
part of the content identity at lines 23-26. B4 should reuse these functions, not generate runtime identities. The
accepted ADR requires a durable mapping from legacy entry to canonical source, document operation, and all fact IDs
(`H:/TakiAgent/docs/adr/0009-single-memory-authority-with-local-replica.md:29-37`).

Hindsight accepts a caller-selected `document_id`; items sharing it are grouped into the same source document
(`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:617-650`). Async retain accepts a client UUID
`operation_id`. Re-submitting the same ID returns the original operation without new work; reuse for a different
operation returns HTTP 409 (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:732-780`). The route forwards
document IDs and submits one operation per retain-strategy group (`.../api/http.py:7757-7801`), so one deterministic
operation ID requires one effective strategy group.

The retain response contains item count and operation ID(s), but not fact IDs
(`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:850-883`). Therefore an HTTP acknowledgement is not a
completed Migration Ledger mapping. Lost acknowledgements must be resumed by resubmitting the exact same Bank,
content, document ID, strategy, and operation ID. A 409 is a blocking identity conflict, not permission to mint a new
ID or overwrite evidence.

Existing `document_id` is an upsert surface. The default `replace` mode deletes old data and reprocesses it; `append`
is a distinct explicit mode (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:700-710`). B4 must retain the
normalized content hash in the ledger and refuse changed content under an old operation identity.

## 2. Exact Operation Terminal Predicate

The operation endpoint returns `pending`, `processing`, `completed`, `failed`, `cancelled`, or `not_found`, with
timestamps and optional error/progress fields (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:3305-3344`;
route at `.../api/http.py:6463-6493`). Hindsight defines `completed` as handler success, `failed` as handler exception,
and `cancelled` as cancellation before worker pickup. Terminal rows may be pruned after a configured retention period,
while pending/processing rows are not pruned
(`H:/hindsight/hindsight-docs/versioned_docs/version-0.9/developer/api/operations.mdx:27-43`).

The retain worker writes outcome metadata before marking the operation completed. That metadata includes the number
of resulting unit IDs and extraction-error count/sample
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:2962-2985`). Completion is guarded against
re-terminalizing an already terminal row (`.../engine/memory_engine.py:2938-2958`). When fail-on-extraction-errors is
enabled, a non-zero extraction error count produces terminal `failed` instead of `completed`
(`.../engine/memory_engine.py:2884-2936`).

The B4 predicate should be:

- `pending` or `processing`: persist waiting state and continue bounded polling;
- `failed`, `cancelled`, or `not_found`: terminal failure, retain the attempt, block cutover;
- `completed`: require readable retain outcome metadata with no blocking extraction error, then resolve the exact
  document and all facts before declaring the source mapped;
- a zero-fact result is valid only when the document exists, the completed outcome reports zero units, and Taki policy
  permits zero-fact conversion. It is not equivalent to a missing document.

This is stricter than `status == completed` because the receipt omits fact IDs and one source can extract many facts.
The accepted research states that fact IDs must be queried through deterministic document identity after completion
(`H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:58-63`).

## 3. Document-To-Many-Fact Resolution

Hindsight memory projections expose public fact ID, `document_id`, `chunk_id`, tags, source fact IDs, and logical
fields (`H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py:377-415`). The memory-list route accepts an exact
`document_id` filter and is paginated (`.../api/http.py:4165-4224`). Document listing is ordinary offset pagination,
while chunk listing is separately paginated (`.../api/http.py:6033-6069`, `.../api/http.py:6087-6121`).

For each completed source, B4 should:

1. Read the exact document by Bank/document identity and verify normalized content hash and source metadata.
2. Page `memories/list?document_id=<id>` to exhaustion.
3. Verify every fact belongs to that Bank/document and has an allowed lifecycle state and valid revision.
4. Derive/verify Taki's stable memory identity from Bank, document, ordinal, and payload hash.
5. Persist one ledger result per provider fact ID/revision. `result_count` must equal durable result rows; source count
   must never be compared directly to fact count.

The compatibility logical model confirms the one-to-many shape: Document and MemoryUnit are distinct logical objects;
MemoryUnit carries `memory_id`, optional `document_id`, revision, lifecycle state, tags, entities, and provenance
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/replication.py:47-100`).

## 4. Authentication And Compatibility Admission

`GET /ext/taki-memory/version` is independently Bearer-authenticated before the manifest is returned
(`H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/taki_memory.py:49-65`). The manifest contains base
API version, compatibility version/build, provider lineage, database/storage capability, journal contract, snapshot
contract, and individual extension contract versions
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:21-105`).

Accepted values are:

- base API `0.9.0`;
- compatibility `1.0.0`;
- build `taki-memory-hindsight-0.9.0-batch0-v2`;
- PostgreSQL with `sql_rows` storage;
- journal schema 1 and snapshot schema 1;
- each required contract version `1.0.0` with supported state.

The implementation fails closed when authentication is not required, the database is not PostgreSQL, replication
support is absent, SQL-row ownership/conditional mutation is absent, or provider lineage cannot be read
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:185-236`,
`.../engine/taki_compatibility.py:250-324`). Health alone never authorizes cutover.

## 5. Logical Snapshot Lifecycle And Manifest

The compatibility router provides authenticated snapshot creation, manifest read-back, and immutable page reads
(`H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/taki_memory.py:100-224`). Creation requires the
supported PostgreSQL/sql-row replication surface and validates page-size/TTL bounds
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py:387-409`).

Snapshot creation uses a `repeatable_read` transaction. Its first query reads Bank replication state, fixing provider
lineage, Bank generation, `end_cursor`, and the MVCC view for all canonical reads
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py:317-370`). It materializes deterministic,
zero-based pages, counts by object kind/state, page SHA-256 hashes, and an aggregate manifest SHA-256, then inserts
metadata and every page before commit (`.../engine/logical_snapshot.py:300-314`, `.../engine/logical_snapshot.py:400-490`).

The manifest includes schema version, Bank ID, provider lineage, Bank generation, `end_cursor`, page size, total pages,
total records, composed counts, page hashes, and aggregate digest
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py:118-150`). Metadata reads reject expired
snapshots (`.../engine/logical_snapshot.py:492-532`). Page reads recompute canonical content hashes and reject missing
or altered records (`.../engine/logical_snapshot.py:534-587`).

Replica bootstrap order:

1. Persist snapshot ID, manifest, lineage, generation, and `end_cursor` in the local migration run.
2. Read pages `0 .. total_pages - 1`; verify page number, total pages, record count, and page hash.
3. Validate object-kind/payload identity, revisions, counts, total records, and aggregate manifest hash.
4. Reconcile imported document/fact mappings against snapshot records.
5. Commit the staging replica and checkpoint `end_cursor` atomically.
6. Only after that commit, consume journal changes after `end_cursor`.

Expiry, missing pages, hash/count/manifest mismatch, lineage/generation mismatch, or local transaction failure blocks
activation and leaves the prior checkpoint unchanged.

## 6. Journal Checkpoint Contract

The journal covers Bank, Document, MemoryUnit, MentalModel, and Directive objects with `upsert` or `tombstone`.
MemoryUnit revisions come from persisted rows; non-memory object revisions derive from committed cursor order
(`H:/hindsight/hindsight-api-slim/hindsight_api/engine/replication.py:21-34`, `.../engine/replication.py:144-163`).
Each committed change carries cursor, provider lineage, Bank generation, batch identity/order, object kind/id,
operation, revision, payload, and timestamp (`.../engine/replication.py:224-239`).

Journal pages expose `from_cursor`, `next_cursor`, `current_cursor`, `minimum_available_cursor`, generation, `has_more`,
and changes (`.../engine/replication.py:252-263`). Reading an expired or ahead cursor returns typed HTTP 409
`replication_cursor_reset_required` with requested/current/minimum cursor, provider lineage, and Bank generation
(`H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/taki_memory.py:67-99`;
`.../engine/replication.py:274-292`).

Core must apply each page transactionally and advance its checkpoint last. Cursor reset cannot be repaired by skipping;
it requires a fresh snapshot and full reconciliation. This matches the accepted Taki synchronization design
(`H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:84-130`).

## 7. Failure And Authority Boundaries

The Taki adapter owns Migration Ledger, staging replica, checkpoint, reconciliation, and Authority Epoch. Hindsight
owns semantic extraction and generic derived maintenance
(`H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:24-50`).
The existing local migration runner demonstrates leases, resumable attempts, result-count/FK/readiness verification,
and fenced activation (`H:/TakiAgent/packages/core/src/memory/legacy-migration/legacy-migration-runner.ts:29-50`,
`.../legacy-migration-runner.ts:130-166`).

All of the following leave Local authoritative and preserve resumable evidence:

- auth/version/build/capability/lineage refusal;
- retain operation conflict, failed/cancelled/not-found terminal state, or changed source hash;
- missing document, incomplete fact pagination, duplicate/mismatched mapping, or invalid revision;
- snapshot expiry, page/hash/count/manifest/generation mismatch, cursor reset, or replica transaction failure;
- reconciliation mismatch, lost lease/fence, or authority marker transaction failure.

No UI action, `/health`, `completed` status alone, or nominal count can bypass these gates. Final activation must be a
single fenced Core transaction after zero blocking sources, complete one-to-many mappings, verified replica/checkpoint,
and unchanged source snapshot. This is the B4 PRD boundary
(`H:/TakiAgent/.trellis/tasks/08-09-hindsight-initial-cutover/prd.md:15-29`).

## 8. Explicit Limits

- Retain responses do not provide fact IDs; post-completion document/fact resolution is mandatory.
- Ordinary document/memory offset pagination is not a replica feed; use logical snapshot/journal for completeness.
- Transfer archives are not stable-ID replication because provider database IDs are not preserved
  (`H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:117-130`).
- Ongoing journal polling, Pending Memory replay, switch-back, automatic recall, and canonical tool exposure remain out
  of B4 scope (`H:/TakiAgent/.trellis/tasks/08-09-hindsight-initial-cutover/prd.md:31-35`).
- No live Hindsight service or real LLM call was made during this research turn.

## Primary Sources

- `H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md`
- `H:/TakiAgent/.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-api-deployment-contracts.md`
- `H:/TakiAgent/docs/adr/0009-single-memory-authority-with-local-replica.md`
- `H:/TakiAgent/packages/core/src/memory/legacy-migration/legacy-identities.ts`
- `H:/TakiAgent/packages/core/src/memory/legacy-migration/legacy-migration-runner.ts`
- `H:/hindsight/hindsight-api-slim/hindsight_api/api/http.py`
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/replication.py`
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/logical_snapshot.py`
- `H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py`
- `H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/taki_memory.py`
- `H:/hindsight/hindsight-docs/versioned_docs/version-0.9/developer/api/operations.mdx`
