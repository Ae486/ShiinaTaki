# Initial Hindsight Import and Authority Cutover - Technical Design

## Scope

Batch 4 consumes the completed Canonical Local migration evidence and B3 connection/setup contracts. It imports the
canonical source documents into accepted Hindsight Global and Character Banks, records deterministic asynchronous
operation and fact mappings, builds a cursor-bound local replica in a staging epoch, and activates a new Hindsight
Authority Epoch only after every gate passes.

This task does not implement ongoing journal polling, Pending Memory recovery, automatic recall, runtime tool routing,
operations UI, or deployment/process management. It must not start a real Hindsight service or make real LLM calls in
offline tests.

## Invariants

- Canonical Local remains authoritative until the final activation transaction commits.
- No automatic fallback, active-active write path, or authority change on timeout/outage.
- Existing Markdown evidence, B2 snapshots, migration ledger rows, and B3 setup state are read-only inputs.
- Every remote document identity is deterministic and bank-specific; retrying a lost acknowledgement is idempotent.
- A source is cutover-ready only with a terminal mapping or explicit durable exclusion; unresolved non-excluded sources
  block activation.
- Replica publication is atomic: the previous verified replica/checkpoint remains visible until the staged manifest,
  counts, hashes, and one-to-many mappings verify.
- The cutover transaction contains no filesystem I/O, network calls, awaits, or remote mutation.

## Data Flow

1. Read the completed B2 run, immutable snapshot manifest, canonical source/unit/derived rows, and B3 verified Bank
   bindings/template digest.
2. For each eligible canonical source and target Bank, derive a versioned Hindsight document ID and operation ID from
   the source identity, Bank binding, normalized content hash, and contract revision.
3. Submit the safe original source payload through the authenticated Hindsight retain endpoint. Persist the operation
   receipt before polling; a missing acknowledgement is recovered by deterministic operation lookup/retry.
4. Poll only the returned operation under a bounded import deadline. After derived completion, query the deterministic
   document and persist every resulting fact ID/revision in the B4 import ledger mapping.
5. Capture a cursor-bound logical snapshot from the accepted Taki replication extension and stream it into a new local
   staging epoch. Compute the canonical integrity manifest over banks, sources, facts, derived objects, lifecycle,
   revisions, and tombstone-relevant records.
6. Reconcile ledger mappings against the snapshot, verify counts/hashes/checkpoint and required bank/template identity,
   then prepare an activation receipt.
7. Acquire the bounded runtime write fence and perform one SQLite transaction that closes the Local epoch, inserts the
   Hindsight epoch with `predecessor_epoch_id`, publishes the staged replica/checkpoint, and updates the singleton
   authority pointer. Any precondition failure aborts without changing active authority.

## Contracts

### Import ledger

Use additive B4 tables or a forward migration linked to the existing migration ledger. Persist only bounded safe
projections: run/source/bank identity, deterministic document and operation IDs, attempt state, terminal status,
operation result hash, fact IDs/revisions, derived-completion evidence, and safe error codes. Never persist API keys,
Authorization headers, raw provider errors, prompt bodies, or unbounded provider payloads.

### Replica checkpoint and manifest

The checkpoint binds `{providerLineage, bankId, endCursor, manifestDigest, capturedAt}`. The manifest includes canonical
record kind counts, state counts, revisions, bank/template identities, and deterministic hashes over sorted canonical
projections. Hindsight transfer archives are not accepted as replica snapshots because they do not preserve stable fact
identities.

### Authority epoch

The existing authority repository must gain an explicit, tested promotion operation with expected predecessor epoch,
verified activation receipt, and transaction-local checks. It must reject promotion when the active epoch is not the
expected Local epoch, when the staged manifest is stale, or when unresolved imports/pending mapping rows remain.

## Failure and Resume

- Before remote mutation: failed validation or dry-run leaves all durable B4 state unchanged.
- Lost acknowledgement: inspect the deterministic operation/document identity before retrying; never generate a new
  identity for the same source attempt.
- Transient operation failure: retry the bounded stage; terminal provider failure marks the source retryable/failed and
  blocks cutover.
- Interrupted import: reopen the ledger, resume only incomplete mappings, and preserve completed mappings.
- Snapshot cursor expiry or race: discard only the staging replica, capture a new cursor-bound snapshot, and retain the
  import ledger.
- Any verification or activation failure leaves Local active and the staged replica inspectable/rebuildable.

## Security and Privacy

The B4 Core path uses the injected B3 secret resolver only at the HTTP seam. Operator responses expose opaque IDs,
counts, phases, and safe error codes. Logs exclude source text, query text, provider/model details, credentials,
headers, and raw responses. Core performs no Docker, process, filesystem, or OS credential actions.

## Verification

Automated tests must cover deterministic IDs, lost acknowledgement, one-to-many fact mapping, derived completion,
resume, cursor-bound snapshot consistency, manifest mismatch, cursor expiry, transactional checkpoint publication,
stale promotion, restart persistence, and Local-authority preservation on every failure path. A controlled live gate is
separate: it may validate a real accepted Hindsight deployment and setup/import twice, but real LLM health requires
explicit owner approval because it makes provider calls.
