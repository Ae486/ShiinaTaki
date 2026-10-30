# Current Local Cutover Coverage and Source Evidence

## 1. Scope / Trigger

Use this contract when preparing B4 Local-to-Hindsight import, checking current-version completeness, enriching a
verified native record with Taki source fields, or extending the B4/B6 adapter. It complements ADR 0009, the B5
[replica contract](./memory-replica-sync.md) and [G1 native-result contract](./memory-native-result-recovery.md).
Coverage, native factual completion and required-maintenance completion are three different proofs.
The [D78 current-state contract](./memory-current-state-cutover.md) adds complete structured import and native
maintenance proof; this document retains the manifest and source-evidence-v1 contract.

## 2. Signatures

- `createHindsightLocalCoverageRepo(db)`: `capture({runId, expectedEpochId, capturedAt})`, `read(manifestId)`,
  `selected(runId)`, `compareCurrent(manifestId)`, `assertCurrent(manifestId)` and
  `readForPreparation({runId, manifestId, expectedEpochId, bankId, documentId})`.
- `HindsightCutoverRunRepo.captureCoverage({lease, now})` selects a new immutable version under the current lease
  and clears prior ready/config/checkpoint acceptance. Ordinary `create` captures the initial Local version.
- `prepareCurrentLocalHindsightSource(db, input)` reserves the Local writer through coverage validation, actual
  source/record reading and evidence persistence. It returns `HindsightPreparedSource`, never dispatches remotely.
- `prepareHindsightSource({source, records})` and `createHindsightSourceEvidenceRepo(db)` provide reusable preparation,
  `savePrepared`, `getPrepared`, `confirm(HindsightSourceConfirmation)` and `binding(exactKey)`.
- `createHindsightSourceEvidenceProjection({repo, authorityEpochId, providerLineageId, bankGeneration, bank})`
  produces the concrete `HindsightReplicaProjection`; seed and journal calls pass their actual native namespace.
- `readHindsightLocalBankBinding` and `requireHindsightLocalCoverageBanks` share the verified Local-scope/B3 native
  mapping in `db/hindsight-local-bank-binding.ts`; promotion must compare native Bank sets after this conversion.
- Migration 037 owns `hindsight_local_coverage_manifests` and `hindsight_cutover_local_coverage`. Migration 038 owns
  `hindsight_source_evidence`, `hindsight_source_unit_evidence` and `hindsight_source_object_bindings`.

## 3. Contracts

### Complete current Local state

The manifest binds `schemaVersion`, `encoding`, `manifestId/manifestVersion`, B2 `runId`, Local epoch, capture time,
all Bank IDs, source count, source revision fence, content digest, sorted record witnesses, B2 evidence digest,
comparable B2 record count, catch-up entries and its own digest. The encoding uses deterministic canonical JSON,
not locale-dependent key ordering. Capture/comparison reject more than 100,000 records instead of truncating.

Include epoch/Bank configuration, complete sources, all units including invalidated ones, policy/provenance,
independent lineage, derived records and relevant structured Memory Blocks. Hash actual payloads. Unit edits,
lifecycle changes and policy changes do not necessarily increment source revision or policyVersion. A declared
legacy content hash can describe a different representation from sanitized retained text; keep its value and an
independent actual-text SHA-256 witness. Invalidated is not tombstoned. Missing identities are a set difference.

B2 `convertLegacyEntry` hashes the full CanonicalMemoryRecord for nonzero records and the source for a zero result.
Compare only the matching historical producer shape. Full old Bank/source/derived/Block payload witnesses are not
available just because a B2 row exists. Classify `b2-new`, `b2-changed`, `b2-missing` and `b2-unproven` explicitly.
Never rewrite B2 evidence, insert new sources into its historical ledger, or infer current import coverage from counts.

Frozen manifests cannot be updated, deleted or replaced through any unique key, including `INSERT OR REPLACE` when
SQLite recursive triggers are disabled. Lease-owned selection may change; historical manifests and import receipts
remain immutable. Read validates stored column/JSON identity and digests before returning an artifact.

`markReady`, `verify` and actual promotion require the selected version to match the current complete Local state.
The final promotion reserves the SQLite writer **before** reading acceptance state and revalidates in the same
synchronous transaction. B4 leases and the retired legacy fence do not independently exclude Canonical writers.
The reservation also covers `prepareCurrentLocalHindsightSource` through its evidence commit.

Source-evidence-v1 alone cannot discharge current-version catch-up into complete remote import. Without the separate
D78 capture/import/maintenance proof, unresolved/unproven entries still refuse promotion. Existing B2-only ready runs are not
grandfathered into acceptance. Historical activated runs remain inspectable; unavailable counts are `null`, not 0.
`HindsightCutoverStatus.localCoverage` is optional for old payload compatibility; current producers populate it.
Its `state: current` means the frozen Local state still matches, not that import or activation is complete.

### Typed source evidence and native ownership

Prepared schema v1 preserves the exact Canonical source and separate unit records, their hashes, nullable retained
text witness, an optional native item/hash, total gap count and at most 32 diagnostic samples. Gap sampling never
truncates source/unit evidence. Existing limits are native metadata maps of 128 keys, string values of 100,000
characters, the 512 KiB tracked request, and portable native Unicode hashing. Unsupported values stay preserved in
Local/evidence and produce explicit preparation gaps; valid Canonical JSON is not redefined as invalid.

The native item retains the existing string-or-canonical-JSON metadata encoding. Numeric `1` and string `"1"` can have
the same native value; only matching typed evidence can restore their distinction. Never change old G1 frozen
commands or their request/intent hashes. Adapter v1 freezes `source.documentId` directly as its native document ID;
it does not claim compatibility with old B2/import document or operation identities.

Local Bank IDs and B3 native Bank IDs differ. Confirmation reads the real Local Bank scope and the corresponding
verified B3 setup binding, then binds `sourceBankId` separately from native `bankId` and preserves the checked scope.
Promotion uses the same binding reader to compare its native Bank set against the frozen Local Bank scopes. No
caller-provided scope, direct Local/native ID equality or ID coincidence substitutes for that check.

Confirmation requires the frozen tracked request, complete validated G1 result/pages and a complete validated
logical snapshot or journal observation. Persist the exact native lineage, generation, Bank, object kind/ID/revision,
payload hash, source evidence/association and operation/request/result/receipt identity. A receipt alone has neither
the document revision nor the complete logical payload. Per-unit associations are explicit and one-to-one in v1;
one source yielding several facts is not proof of per-fact Taki field ownership.

Projection restores typed metadata only when encoding the stored original value reproduces the exact native map.
It preserves native current text, unit context, lifecycle, identity/revisions, entities, tags, dates and source links.
The Taki policy's layer must match the unique native `taki-layer:*` tag. Retained source context/provenance comes from
its verified source evidence. Source metadata and original Local unit metadata remain distinct. If extraction returns
a different unit map or layer, confirmation fails; preparation alone is not a promise that every future fact maps.

An equivalent newly verified snapshot/journal observation of the same semantic binding is an idempotent replay:
return the original immutable binding and first observation receipt. A different evidence record, source association,
native operation, revision or payload remains a conflict, even if two typed values encode to the same native string.

Evidence is durable Taki migration/operation provenance, independent of replica deletion/reseeding. Missing evidence,
new native versions or payload mismatch fail closed. Arbitrary native-edit rebinding and provider-only restoration
of all Taki fields remain D77; current-version import/required-maintenance evidence uses the separate D78 contract. Do not present
these first-slice tests as full B4 fidelity, B6 readiness or live activation acceptance.

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Selected manifest absent / replaced | `HINDSIGHT_LOCAL_COVERAGE_MISSING` / `HINDSIGHT_LOCAL_COVERAGE_SELECTION_STALE`; no prepared evidence or promotion |
| Local payload/set or B2 witness digest changed | `HINDSIGHT_LOCAL_COVERAGE_STALE`; preserve frozen evidence and Local authority |
| New/changed/missing B2 comparison | `HINDSIGHT_LOCAL_CATCH_UP_REQUIRED`; old mapped imports cannot clear it |
| Only non-comparable historical fields remain | `HINDSIGHT_LOCAL_COVERAGE_UNPROVEN`; do not fabricate a historical baseline |
| Stale lease/epoch or SQLite competing writer | Refuse before commit; keep authority, evidence and prior checkpoints unchanged |
| Missing text, native size/key/Unicode limit | Persist original typed evidence with explicit gaps and `nativeItem: null` |
| Wrong Bank binding, result/observation identity or source association | Bounded binding refusal; no partial confirmation rows |
| Missing/stale evidence/object version or changed native payload | Bounded projection refusal; no guessed type or previous-binding fallback |
| Native layer/map differs from original unit | Refuse that association; never copy document fields onto every fact |
| Same semantic binding with new observation ID/cursor | Return the stored first binding unchanged |

## 5. Good / Base / Bad Cases

- Good: a real Local edit leaves source revision unchanged; the record digest changes, a previous capture is refused,
  and a fresh explicit capture preserves the edited unit and original retained source separately.
- Base: reopen/retry the same frozen source, then reobserve its same native version; evidence and first binding stay
  byte-identical while replica reseeding remains possible.
- Bad: use B2 source count as a completeness gate, infer JSON types from strings, trust a receipt as a snapshot,
  reencode an old G1 dispatch, treat unproven as imported, or overwrite native lifecycle using an old Local record.

## 6. Tests Required

- Actual Local retain/edit/invalidate/restore/reclassification plus Bank, lineage, derived/Block and missing-record
  changes; complete-set and payload drift, unchanged source revisions, immutable B2/manifest bytes and file reopen.
- Two real SQLite connections: a prior writer is observed; a later writer cannot interleave between final read and
  promotion/evidence persistence. Test source/unit storage rollback and connection usability after errors.
- Typed `1` versus `"1"`, nested/Unicode JSON, source/unit separation, null/empty context, explicit size gaps and old
  dispatch compatibility. Confirm through parsed provider wire, real native hashes and actual replica seed/reseed.
- Exact lineage/generation/Bank/revision/payload and layer checks, missing evidence, native tombstones, changed
  observation replay and changed semantic binding rejection. Preserve first receipts and no partial writes.
- Fresh and both 035 histories through 038, no-op reopen, old Pending/Timeline/receipt bytes, affected TS/lint/tests
  and isolated native Core startup. Actual user data and live/LLM/manual gates are separate.

## 7. Wrong vs Correct

```ts
// Wrong: source revision does not witness unit/policy edits, and B2 counts do not prove current import.
if (oldSource.revision === currentSource.revision && b2Count === mappedCount) promote();

// Correct: the Core entry checks the selected complete frozen state under the writer reservation.
const prepared = prepareCurrentLocalHindsightSource(db, {
  runId, manifestId, expectedEpochId, bankId, documentId,
});
// A native item is a preparation result. Current import and maintenance proofs still gate promotion.
if (prepared.nativeItem === null) return prepared.gaps;
```
