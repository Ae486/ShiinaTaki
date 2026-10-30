# Initial Hindsight Import and Authority Cutover - Technical Design

## D78 execution design (2026-09-09)

The completed first slice is followed by structured current-state import and independent first-activation maintenance
proof. The selected contract is [`research/d78-execution-contract.md`](research/d78-execution-contract.md), grounded by
[`research/d78-native-preflight.md`](research/d78-native-preflight.md). This route supersedes the older raw-source-only
raw-source Data Flow for current Canonical records; original raw legacy imports preserve their existing API/evidence.
Native import completion, required maintenance completion and current Local coverage remain separate gates.
The implementation now connects all three gates to actual B4 readiness, verification and promotion. Results and
remaining acceptance boundaries are in [the D78 validation record](research/d78-validation-2026-09-09.md).

> Completed prerequisite (2026-09-08): the owner approved the current Local coverage/source evidence work in
> [`research/first-slice-execution-contract.md`](research/first-slice-execution-contract.md). It supersedes the older
> B2-only input assumptions. The implemented B4 baseline is extended in place. Source-grounded choices, native ownership,
> evidence-loss limits and the 035 convergence are in [`research/current-local-first-slice.md`](research/current-local-first-slice.md).
> This first slice completed offline verification on 2026-09-08; see
> [`research/first-slice-validation-2026-09-08.md`](research/first-slice-validation-2026-09-08.md). D78 supplies current
> import/maintenance mechanics; D77/B6/B7 and live activation keep their own gates.

## Scope

Batch 4 consumes a complete frozen current Canonical Local capture and B3 connection/setup contracts. It imports
current structured records into accepted Hindsight Global and Character Banks, records immutable complete native
mappings, proves finite native source/scope/model maintenance, and publishes a certificate-bound raw logical replica.
It activates a new Hindsight Authority Epoch only after every final fence, integrity and runtime-readiness gate passes.

This task does not implement ongoing journal polling, Pending Memory recovery, automatic recall, runtime tool routing,
operations UI, or deployment/process management. It must not start a real Hindsight service or make real LLM calls in
offline tests.

## Invariants

- Canonical Local remains authoritative until the final activation transaction commits.
- No automatic fallback, active-active write path, or authority change on timeout/outage.
- Existing Markdown evidence, B2 snapshots, migration ledger rows, and B3 setup state are read-only inputs.
- Each frozen import command has stable operation/request identity and complete durable object mappings; retrying a
  lost acknowledgement returns the original native IDs and result.
- Every current manifest entry has an explicit disposition. Required native records need exact mappings; unsupported
  values are blocking preparation gaps, never silent exclusions.
- Replica publication is atomic: the previous verified replica/checkpoint remains visible until the staged manifest,
  counts, hashes, and one-to-many mappings verify.
- The cutover transaction contains no filesystem I/O, network calls, awaits, or remote mutation.

## Data Flow

1. Reserve the Local writer and freeze all current Bank/source/unit/derived/policy/provenance/lineage/Block records,
   linking immutable B2 history without treating it as current coverage.
2. Resolve actual B3 bindings/templates and an exact native Bank/control-resource baseline. Build the typed current
   request with full source witnesses and explicit preparation gaps/dispositions.
3. Submit the authenticated bounded atomic native transfer. Preserve its operation/request identity across lost
   responses; verify all immutable mapping pages, hashes, namespace and committed journal boundaries.
4. Prepare and run the separate native cutover verification. The provider owns the complete source/scope/model set,
   actual input versions/actions/no-ops, partial recovery, lifecycle evidence and final snapshot sealing.
5. Verify the complete certificate/evidence pages and native logical snapshot, including the full tagged record hash.
   Persist evidence and publish all actual raw `payload.value` rows/checkpoints in one SQLite writer transaction.
6. Require current proof for every bound Bank, including empty Banks. Persist confirmed native invalidation separately;
   reject known drift, incomplete proof, newer-checkpoint replacement and a changed Local epoch/fence/digest.
7. The existing fenced promotion transaction may close Local and publish the new Authority Epoch only after all B4
   and runtime-readiness gates pass. Offline D78 verification leaves Local authoritative. D77/B6 derived-policy
   projection and runtime wiring remain separate from raw logical staging.

## Contracts

### Import ledger

Migration 039 adds independent current capture/preparation/import/candidate/verification/invalidation evidence.
Bounded typed payloads intentionally retain original memory/provenance for verification and recovery; safe operator
status exposes identities/counts/codes. Do not put memory text in logs or persist API keys, Authorization headers,
raw provider errors or unbounded provider payloads. Old B2/G1/source-evidence-v1 identities and APIs remain readable.

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
- Lost acknowledgement: recover the same transfer or verification identity, original committed results and complete
  pages before retrying; never repeat committed native actions under a new identity.
- Transient operation failure: retry the bounded stage; terminal provider failure marks the source retryable/failed and
  blocks cutover.
- Interrupted import: reopen the ledger, resume only incomplete mappings, and preserve completed mappings.
- Ordinary snapshots retain their TTL. A fully validated D78 certificate can read its pinned historical pages after
  TTL expiry; this does not freeze later remote writes or permit an old certificate to overwrite a newer checkpoint.
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

## Current Local Coverage Gate

The B2 migration snapshot is immutable historical evidence, not the complete current source of truth. B4 starts by
freezing a `CurrentLocalEpochManifest` for every canonical Local Bank. Its sorted entries cover source/document identity,
content hash, source and record revisions, lifecycle state, derived objects, Taki policy projection, and tombstone
markers. The manifest also records the Local authority epoch, schema version, captured timestamp, and a source revision
fence. A source is required when it is present in the frozen current Local projection and is not explicitly excluded by
the approved migration policy.

The importer compares this manifest with B2 `memory_migration_sources` and ledger evidence. Local retain, edit,
invalidate, restore, and reclassification operations performed after B2 become a bounded catch-up set; they are imported
using their current canonical content/revision or the run restarts from a new frozen manifest after a writer quiescence.
No source is silently considered covered because it has a B2 row. Before preparing activation, acquire a short final
Local write fence and re-read the epoch, source revision fence, and digest. A mismatch discards only B4 staging and
restarts coverage verification while preserving B2 evidence and all resumable B4 ledger rows. The final fence is a
revalidation boundary, not permission to bypass unresolved mappings.
