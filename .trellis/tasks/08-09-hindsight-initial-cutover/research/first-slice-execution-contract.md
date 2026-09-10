# B4 first slice - implementation contract (2026-09-08)

## Authorized deliverable

The owner approved the recommendation to checkpoint Taki's G1/B5 work and implement current Local completeness and
reversible field preparation. The checkpoint is `dd2e15b`. Continue the existing B4 task; do not request execution
approval again. This document supersedes the older wave ordering for this bounded slice only.

The completed slice must be a usable Core producer/store/consumer path, not isolated hashing utilities. It freezes
current Local coverage, prepares immutable typed source evidence from that frozen state, reconstructs supported
verified native objects through a repository-backed projection, and prevents the existing B4 path from accepting
missing/stale coverage. Full import of every current version and independent maintenance completion remain later
B4 waves; B6/B7, live service calls, user-data migration and authority activation remain outside this slice.

## C1 - Current Local manifest

- A versioned immutable manifest binds B2 run reference, expected active Local epoch, capture time, all Bank IDs,
  a complete sorted set of logical record keys/revisions/hashes, and an overall digest. Derive deterministic hashes
  from actual complete payloads with explicitly versioned canonical encoding. Retain exact hash witnesses when an
  old declared content hash describes a different representation.
- Capture all source, unit/policy/provenance, lineage, derived and relevant Memory Block state; distinguish source
  changes from current-unit changes. Retain removed/missing-key information in comparison results. Invalidated
  records remain present. Read one consistent SQLite state, persist atomically, and reopen without recomputation
  mutating evidence. Stored manifests contain bounded identities/hashes; no source text in status/log output.
- Compare B2 evidence only using its actual producer contract. New/changed/missing/unprovable objects produce an
  explicit bounded catch-up set. Preserve all B2 evidence. Do not invent a full old canonical snapshot or consider
  source presence/old count equality sufficient proof.
- Wire capture/check into `HindsightCutoverRunRepo` and `promoteHindsightAuthority`. Coverage selection belongs to
  the B4 run and its lease; never silently overwrite a frozen version or revive old import results for a new version.
  Every real readiness/promotion path revalidates coverage and refuses missing, stale or unresolved current-version
  proof. An already activated historical run remains inspectable without reading its closed predecessor as active.
- At final promotion reserve the SQLite writer before reads and revalidate in the same synchronous transaction.
  A logical import lease and a prior check are insufficient. Preserve all existing setup/checkpoint/import gates.

## C2 - Source preparation, durable evidence and projection

- New adapter version 1 has an explicit input of one CanonicalMemorySource plus separately identified Canonical
  records; validate epoch/Bank/document relationships. The preparation output contains the existing native retain
  item and immutable source/unit evidence, with deterministic identity and hashes. Never change old G1 command
  serialization, requestHash/intentHash or replay behavior.
- Store source evidence and confirmed native-object bindings separately. Preserve typed source and per-unit JSON,
  null/empty context, safe retained source, original provenance/policy and identity/revision. The store is independent
  of mutable replica rows and survives replica reseeding. Incomplete/unsupported preparation produces a clear gap;
  no truncation, policy fabrication or metadata type guessing is allowed.
- Confirm bindings against validated native result and logical snapshot/journal data, including provider lineage,
  Bank generation, Bank, kind/ID, exact revision and native payload hash. A receipt alone cannot confirm a document
  payload. Each per-unit association is explicit; one-to-many extraction is not proof of one-to-one field identity.
- Build a concrete repository-backed HindsightReplicaProjection. It may enrich only the verified object version,
  restores typed metadata only after native representation equality, and preserves current native authoritative
  content/lifecycle/identity/tags/dates/links. Per-unit policy must agree with the native layer label. Missing or stale
  bindings fail closed; never fall back to an earlier binding merely because a document ID matches.
- Connect a Core preparation entry to actual persisted Local coverage: check the selected frozen source/record
  witnesses, load the real Local data, then persist evidence in one local transaction before returning the prepared
  native item. This entry is an import prerequisite, not a remote dispatch or authority switch.
- Remote-only restoration and arbitrary future native-edit rebinding are explicit unfinished contracts (D77), not
  a claim of complete B4 fidelity. The product remains Local authoritative throughout this work.
- Local and external B3 Bank identities are verified separately at confirmation. Native document identity v1 is the
  frozen source.documentId, not an old B2/import document ID. D78 must bind the selected prepared version to its own
  resumable native operation. Metadata/layer mismatches remain explicit confirmation refusals. Equivalent new
  observations of an already confirmed semantic binding return its original immutable first receipt.

### D78 integration details retained by final review

The old `requireImportBanks` predicate requires every target Bank to appear in historical
`hindsight_import_operations`. A legitimate empty Bank has no source operation. D78 must replace that old B2-based
bank-set rule with the complete current manifest and verified Bank bindings; it must not manufacture an operation
for an empty Bank. The first slice already captures and resolves empty Local Banks, but leaves this old import
producer/consumer prerequisite closed until the actual current-version import proof is implemented.

## C3 - Additive storage

- 036 converges the two applied 035 histories. 037 stores versioned current Local coverage; 038 stores typed source
  evidence and exact native bindings. Keep old migrations/receipts unchanged and avoid B2 foreign keys for new source
  identity. No new dependency, process launch, service, user-data access or Hindsight repository write is required.
- Each worker owns its new migration file; the leader owns the ordered registry and final lineage matrix integration.
  Foreign keys, immutable-identity enforcement and atomic writes must reflect the owned aggregate, not test-only
  conventions. Bounds errors are explicit and never produce partial artifacts.

## Ownership and validation

| Workstream | Owned files/responsibility |
| --- | --- |
| Migration implementer | migration runner and tests; new 036 bridge and its real-file compatibility tests |
| Coverage implementer | new Shared coverage schema; new 037; coverage capture/store/comparison; real B4 run/promotion integration and focused tests |
| Evidence implementer | new Shared source-evidence schema; new 038; preparation/store/confirmation/projection and focused tests |
| Leader | PRD/design/plan/research/spec/HANDOFF; Shared public exports and folder indexes; migration registry/final lineage matrix; integration entry linking coverage to preparation; overall validation |

Workers are not alone in the codebase: do not revert others' changes, recursively delegate, or perform Git writes.
Use direct imports while the leader integrates Shared exports. Notify the leader of the final public signatures
before integration. Tests use temporary databases/injected responses only. No user DB, .env, protected backup,
other-worktree filesystem, provider calls, new dependencies, commits, push, reset, rebase or task closeout.

Focused tests must demonstrate actual persistence and failure boundaries. Then run Shared/Core suites, all five TS
typechecks, root lint, recursive package tests, isolated Core startup for the migration change, diff/no-BOM checks and
Trellis task validation. Independent `trellis-check` review must assess the full vertical path and self-fix findings.
Do not rerun Hindsight/Rust generation gates when their inputs are unchanged. Live/manual acceptance stays pending.
