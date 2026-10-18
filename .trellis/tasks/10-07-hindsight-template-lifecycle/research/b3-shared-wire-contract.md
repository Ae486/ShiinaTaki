# B3 Shared wire and hash checkpoint

The actual strict components are in `packages/shared/src/hindsight-backup-v1-schema.ts`,
`hindsight-backup-v2-schema.ts`, `hindsight-template-backup-schema.ts` and
`hindsight-template-backup-attestation-schema.ts`. The old public aggregates select explicit versions.
The historical unversioned proof body is valid only in the v1 branch. The older lifecycle backup evidence
component is unchanged. This checkpoint certifies schemas and vectors, not a copied database or restore producer.

## Wire

- Request v2 carries one exact target per requested Native Bank, a complete original selected Apply plus receipt
  hash or `selected: null`, and a hash of the complete normalized backup request. An explicit `none` overlay
  remains a selected application.
- Proof body v2 contains `version`, `requestHash`, all old ordinary Native proof fields and complete template Bank
  proofs. Each proof has the independently enumerated receipt inventory and a strict selected/unselected arm.
- Endpoint proof adds only `zipSha256` and `zipBytes` to that body. Route-c response has
  `{version:2,backupId,requestHash,schema,proof,artifact:{location,fileName,sha256,bytes}}`.
- ZIP `taki` envelope has `{version:2,backupId,requestHash,proof,entries}`. Both envelopes require the same
  `requestHash` as their proof body. The observation response is exactly
  `{version:2,nonce,requestHash,schema,proof}` and cannot contain ZIP fields.
- Configuration observation is `{version:1,source,observationId,observedAt,schema,contextHash,requestHash,
  inheritedConfigHash,observationHash}`. Route c uses `local-service`; the authenticated read route uses
  `authenticated-service`, and the CLI preserves that service observation unchanged.
- Outer backup fields use camelCase; existing lifecycle subtrees retain snake_case. V2 accepts no snake_case
  field aliases that Shared would reject. UUID normalization remains explicit; no v1 default or alias is changed.

## Canonical commitments

All new domains use the unchanged tagged JSON/binary64/UTF-8 ordering codec over
`{domain:"taki-template-backup-<name>.v1",value}`. SHA-256 of those UTF-8 canonical bytes is the digest.
The Shared encoding module owns the normalization helpers; ordered domain-content arrays are not sorted as sets.

| Domain | Exact value |
| --- | --- |
| `request` | Complete normalized v2 request without `requestHash`; sort Native Bank IDs and template entries by UTF-8 Bank ID, operation IDs by ASCII, and normalize each original Apply using lifecycle normalization. |
| `receipts` | `{target,receipts:[{request_id,request_hash,receipt_hash}]}` with lowercase UUIDs and ascending request UUID ASCII order. Reject duplicate tuple identities. Core may deduplicate verified identical recovery references before this helper. |
| `database` | Normalized existing B1 full definition projection, removing only each config entry's `inherited` field. No extra `record_kind` wrapper. |
| `inherited` | `{target,config:[{key,inherited}]}` from the normalized full B1 projection. Keep every selected inherited field, including fields shadowed by stored overrides. |
| `context` | `{schema,tenantId,apiKeyId,tenantExtension}` from the actual authenticated RequestContext and actual extension's module-qualified class name. Missing IDs are null. Only the digest leaves Native. |
| `observation` | `{target,observation}` where `observation` is the complete configuration observation without `observationHash`. |
| `attestation` | Complete bounded Core attestation without `attestationHash`. Its authority, defaults, hold, exact Bank scope, history, selections, publication and projection commitments are mandatory. |
| `history` | Core-verified exact identity, immutable enrollment/user/selection history and current applied pointer; source validation is required before commitment. |
| `defaults` | Core-verified lineage, current default revision, complete immutable default history and referenced catalogs. |
| `hold` | Core-verified authority-scoped original plans, holds, dispatches, publications and quarantine evidence. A hash cannot turn an unpublished effect into `clear`. |
| `transition` | Core attestation commitment with exact persisted per-Bank W2 evidence associations. This does not change Native transition hash domains. |

The `history`, `defaults`, `hold` and `transition` example values are codec vectors; only the actual Core reader can
establish the validity of their private source records. The fixture is explicitly `wireOnly: true`.

Native verifies original Apply/snapshot/receipt hashes, SQL identity and selectors before observation. Core consumers
must likewise verify the full backup request, original lifecycle evidence and observation hash, not only schema shape.
The context digest is stable across compatible process restarts; engine/resolver/context lifetime checks remain local
checks, not wire object IDs, fabricated revision/lease evidence or claims to detect an intervening ABA.

## Transport bounds

The compact complete v2 request limit is 671,088,640 bytes; each original Apply remains independently bounded to
524,288 bytes. A compact observation wrapper has an additional 128-byte allowance, giving 671,088,768 bytes.
The proof/observation response limit is 2,097,152 bytes and the archive/Core manifest limit is 4,194,304 bytes.
V2 creation/observation/verification timestamps have a 64-character bound. Preserve 256 Banks and one million
printable-ASCII operation IDs; never truncate complete template receipt inventory.

Untrusted HTTP/file input is length-bounded before parse; compact serialization is bounded again before write/send.
Only backup and observation calls receive the 2-MiB response override; the ordinary 512-KiB client default remains.

## Shared fixture

`packages/shared/src/fixtures/hindsight-template-backup-v2.json` contains complete original Apply/receipt/snapshots,
selected and unselected Banks, empty/nonempty receipt inventory vectors, all eleven backup domains, endpoint/archive/
observation/manifest variants, thirteen strict invalid cases and serialized v1 examples. Its deterministic source is
`research/build-b3-shared-fixture.mjs`. These synthetic values are never substituted for actual producer acceptance.
