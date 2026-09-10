# Current Local coverage and source evidence - source review (2026-09-08)

## Verified baseline and scope

The owner approved planning and implementing the first B4 slice after the G1 checkpoint. Taki is on
`dd2e15b98b6661a01b1f951cfb85f718f2aea75d`; the corresponding Hindsight checkpoint is
`8ab65b4c2ea238223eeef84cbdcc012ca7601e86`. This slice uses isolated SQLite and injected transports. It does not
import user memory, open the protected B2 backup, call a real provider, switch authority, or implement B6/B7.

Two read-only surveys used one focused `jbcontext search` each and then direct reads. The predefined
`context_explorer` model was unavailable, so ordinary read-only agents performed the surveys. Findings below are
code evidence, not a claim that the old B4 design or G1 research is already implemented.

## Current Local coverage

| Seam | Verified behavior and consequence |
| --- | --- |
| `packages/core/src/db/canonical-memory-repo.ts:69` | Retain upserts the source and increments its revision; replacement can invalidate older units. Include all units, not only valid ones. |
| `canonical-memory-repo.ts:143,159,199` | Edit/invalidate/restore change units and policy without changing the retained source revision/text. Policy version alone is not a mutation counter. Hash the actual record and policy. |
| `canonical-memory-repo.ts:271,277` | Lineage and derived payloads are independently stored. Include their actual rows and identities. |
| `packages/core/src/db/canonical-memory-authority-repo.ts:42,71` | Read the active Local epoch and all its Banks, including empty/new Banks and their configuration. |
| `packages/shared/src/memory-provider-domain-schema.ts:60` | Source retainedText/contentHash can be null. A missing retained source must produce an explicit import preparation gap. |
| `packages/core/src/memory/legacy-migration/legacy-canonical-converter.ts:28` | The declared old content hash and sanitized retained text have different origins. Preserve the declared value and compute an independent actual-text witness. |

The frozen coverage set must include Banks, sources, units, policy, provenance, lineage, derived records and the
relevant Memory Block state. It must observe additions, changes and missing identities. Local has reversible
`valid`/`invalidated` states; do not invent tombstones or treat invalidation as deletion. FTS is a derived index and
is not a second authority. Operation receipts are preserved separately; they do not replace current-state coverage.

B2 evidence is in `memory_migration_sources` and `memory_migration_results` (migration 021). B2 wrote Canonical
staging directly to `canonical_*` tables; there is no independently verified full immutable canonical staging table.
Implementation follow-up verified `legacy-canonical-converter.ts:63`: nonzero `result_payload_hash` is the canonical
hash of the complete CanonicalMemoryRecord. Its zero-result branch hashes the source instead. Compare exactly the
applicable historical producer shape; absent full source/Bank/derived/Block evidence still requires conservative catch-up.
No current record becomes covered solely because its source ID is in B2. B2 rows and receipts remain immutable.

Migration 023 binds `hindsight_import_operations(run_id,source_id)` to B2 `memory_migration_sources`. It cannot
represent new current-Local sources or another version of an already mapped source. This slice adds independent
coverage/evidence identities. The later import wave must consume them; it may not fabricate B2 rows to fit the old FK.

`hindsight-cutover-run-repo.ts:120` currently marks ready without a Local digest. `hindsight-authority-repo.ts:100`
checks B2 imports, not current Local. Wire the new check into the real run/readiness/promotion path. Missing or
outdated coverage, or a required catch-up with no current-version import proof, must refuse readiness/promotion.
Old completed import rows remain readable and cannot silently satisfy a new coverage version.

The legacy MemoryAuthorityFence is wired only to the retired Markdown runtime. Canonical writers check the active
epoch, not the B4 lease. A B4 lease alone is not a writer fence. Use a real SQLite writer reservation before reading
the final Local state (for example a guarded no-op authority-state UPDATE inside the synchronous promotion
transaction), then revalidate epoch, complete identity/revision set and digest before committing. No await, network
or filesystem work belongs inside it. A competing connection must either finish before this reservation or fail
to write until the transaction finishes; any busy/stale failure must leave authority unchanged.

## Reversible fields and native ownership

`hindsight-pending-client.ts:76` keeps string metadata unchanged and canonical-JSON encodes other values. Therefore
the native value for numeric `1` and string `"1"` is the same. G1 freezes this command and hash in Pending Memory;
changing that function globally would break already persisted dispatch identities. Keep existing wire semantics.

The old B4 import source accepts only content/context; its client omits source metadata/tags/scopes. B5 projection
requires trusted source context/provenance and per-memory policy/provenance but has no durable producer for them.
Its document spread currently overwrites any restored metadata, and memory metadata always comes from the native
payload. Source and unit metadata differ in real Local/B2 records and cannot be copied indiscriminately.

The selected first slice is a versioned, immutable **Taki source evidence** store plus exact native-object bindings:

1. Prepare from real Canonical source and separate records, preserving their typed JSON, exact null/empty context,
   retained source, provenance, policy and declared hashes. Freeze the unchanged native item with its own version.
2. Confirm an object binding only against the matching native operation/result AND a validated logical snapshot or
   journal record. Bind provider lineage, Bank generation, Bank, object kind/ID, exact revision and payload hash.
   A G1 receipt lacks document revision and full logical payload; never synthesize those fields from the receipt.
3. A repository-backed projection restores types only if native metadata exactly equals the stored version's
   projection of the typed value. Preserve current native text, identity/revision, lifecycle, entities, tags, dates
   and source links. Explicitly map a Local unit to a native object; never assign one source's metadata/policy to
   every extracted fact. Layer policy must agree with the unique native `taki-layer:*` label.
4. Missing, mismatched, stale or unsupported bindings fail closed. Prepared evidence is never confirmed replica
   content. Unknown legacy native strings stay strings; do not guess their former JSON types.

Implementation follow-up verified `hindsight-bank-identity.ts`: Local Bank IDs differ from B3's `taki-hs-v1-*` external
IDs. Confirmation reads the actual Local scope and verified B3 binding, stores source/native Bank identities
separately and checks that exact native namespace at projection. Promotion also resolves the Local Bank set through
that same binding reader before comparing native IDs. Adapter v1 freezes `source.documentId` directly in
its native item; it neither reads nor reuses old B2/import document or operation identities. D78 must dispatch this
selected current-version item explicitly and cannot equate it with an old ledger mapping.

Original source and unit metadata can differ. The first slice stores both; unit confirmation requires the actual
native unit map and layer to match the explicitly associated Local evidence. A native extraction that inherits a
different source map is refused rather than silently copying that map onto the old Local unit. This is a remaining
mapping constraint, not an early blanket rule that every native engine must return one particular map.

Equivalent reobservation through a new verified snapshot/journal returns the first saved immutable binding.
Observation ID/cursor changes alone are not a semantic conflict; source evidence, association, operation, native
payload and object version must still agree exactly.

This evidence is durable migration/operation provenance, not a disposable replica cache or an alternate writable
memory authority. Ordinary replica reseeding must preserve it. If all Taki evidence is lost, the current Hindsight
snapshot alone cannot reconstruct every original Taki field. Full B4 fidelity and remote-only recovery remain
unaccepted until a source-backed provider representation and lifecycle policy close that gap (D77).

### Actual representation limits

- Canonical JSON allows 256 keys/items, finite numbers, 16,384-character strings and recursive objects without a
  fixed schema depth; source text allows 100,000 characters.
- Native retain metadata is a string map. Existing snapshot adapters bound maps to 128 keys and nested JSON depth.
- G1 commands and HTTP responses are bounded to 512 KiB; Pending state is bounded to 2 MiB.
- Do not truncate or redefine valid Canonical data as invalid. Report an explicit bounded representation gap before
  a remote write if it cannot fit the selected native representation; preserve Local/evidence bytes. Evidence must
  not be embedded wholesale into Pending state or into an undocumented reserved native metadata key.

## Migration convergence

Git-object review confirmed main 035 is Pending Memory while T4 commit `82e0a4a` uses 035 for nullable Timeline
`presentation TEXT`; versions 1..34 match. Both histories may already be applied. The max-version runner will not
replay either 035. Keep main's 035 for new installs, add 036 to converge the union, then allocate 037 to coverage
and 038 to source evidence. Recheck branch tips before editing the registry.

036 needs a small declarative conditional-DDL capability inside the existing migration transaction: inspect the
Timeline column, add it when absent, and refuse an incompatible existing definition. Add Pending table/index/trigger
with IF NOT EXISTS while preserving the exact 035 constraints. Do not rewrite 035, drop tables, rewrite receipts,
or alter Timeline/Pending contents. The conditional step and receipt commit atomically; a failure rolls back both.

Use real temporary-file reopen cases for fresh, 034, main-035 with Pending data, T4-035 with presentation, and both
schemas at max=35. Preserve prior migration timestamps, Timeline canonical fields/presentation bytes and Pending
state JSON/sequence/hashes. A second open applies nothing. Required migrations stay unique and ascending.

## Verification anchors

Reuse `canonical-memory-repo.test.ts`, `local-memory-provider.test.ts`, `hindsight-import-ledger-repo.test.ts`,
`hindsight-authority-repo.test.ts`, G1 frozen-dispatch tests, and replica snapshot/journal tests. The old promotion
fixture has B2/replica rows without corresponding current Local source/unit rows; fix the fixture honestly when the
gate is connected. Cover real retain/edit/invalidate/restore and per-policy/lineage/derived/Bank changes; immutable
coverage after reopen; B2 unchanged; stale/missing coverage; two-connection writer reservation and rollback; typed
source/unit metadata; null/empty context; lost evidence; stale object revision/payload; and native-field ownership.
