# G1 Consumer Transition and Logical Field Map

Date: 2026-09-07. Source: current `H:/TakiAgent` working tree on `c3f8bc4`, including the reviewed B5 changes.
This is a design/implementation input, not fresh runtime acceptance. G1 and the prior-ruling index in `../grill.md`
take precedence over the earlier per-write derived-completion proposal.

## Consumer transition seams

| Source | Current behavior | G1 implementation obligation |
| --- | --- | --- |
| `packages/shared/src/pending-memory-schema.ts` | Immutable intent version 1; native receipt is separate from derived evidence. `awaiting_pull`/`completed` require derived evidence. Retain receipts embed at most 256 references. | Add an explicit, typed native-result confirmation contract. Preserve old intent bytes/hashes and readable old receipts; an older receipt does not gain producer proof merely by parsing it. |
| `packages/core/src/db/pending-memory-store.ts` | `state_json` is bounded to 2 MiB; row/intent/phase/version and receipt hashes are checked on read. Saves preserve immutable identity and version CAS. | New result evidence and its hash must be validated on load/save. An optional/versioned state extension can preserve intent identity; do not rewrite migration 035 or blindly relabel old rows. |
| `packages/core/src/db/pending-memory-transition.ts` | Native completion enters `awaiting_derived`; derived evidence moves to `awaiting_pull`; confirmation terminates the row. Known native success cannot become an unapplied failure. | Separate the new factual-proof transition from the old derived path. Retain receipt-first restart, unknown outcomes and the native-success prohibition. Never turn absence of derived proof into a reason to repeat a successful write. |
| `packages/core/src/db/pending-memory-repo.ts` | Progress checks Authority, Bank generation/scope, deadline and lease inside the transaction. `assertReflected` requires the exact persisted checkpoint and the derived cursor. | Reuse those guards with a verified native factual boundary. An arbitrary later cursor or caller-supplied checkpoint is insufficient. The pending repository still does not write confirmed replica records. |
| `packages/core/src/memory/hindsight/hindsight-pending-recovery-stages.ts` | Dispatches all independent retains/mutations before polling. Same-lease reset continues a held phase; generation replacement distinguishes dispatched uncertainty. | Preserve those properties. New routine confirmation must not invoke per-write derived work or hold a proven factual result pending for a model refresh. |
| `packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts` | First pull, native replay, derived check, second pull, transactional confirmation. A single deadline spans reset/rebuild. | Replace the routine required evidence with the selected native-result contract, preserve full catch-up and the independent-row behavior, and keep later derived changes on ordinary journal synchronization. |
| `packages/core/src/memory/hindsight/hindsight-pending-replay.ts` | Frozen mutation body/UUID is replayed before a newer target can be treated as superseded. Append is refused before dispatch. | Negotiate the new producer result protocol; remove append refusal only on the proven supported path. Old ambiguous operations remain unknown and keep their original identity. |
| `packages/core/src/memory/hindsight/hindsight-pending-retain.ts` | Current operation/debug result plus current document/fact enumeration is the existing narrow replace proof. | Do not reuse current enumeration as an immutable append result or a historical receipt after concurrent edits/deletion. |

Migration 035's SQL phase constraint and the Shared phase enum are coupled. If the selected state design adds a phase,
use a forward migration and verify old-file reopen; if it extends only typed JSON, prove that old stored rows remain
readable and identity-equivalent. Choose from the actual contract, not a desire to avoid a migration.

## Result representation and existing limits

- Canonical retain content is bounded to 100,000 characters; Pending admission/request and Hindsight responses are
  separately bounded to 512 KiB. Durable Pending state is bounded to 2 MiB.
- The current inline native retain receipt and tool result both allow 256 references. They are different contracts:
  recovery does not have to return a complete tool-result array when settling a background Pending row.
- A versioned compact recovery receipt may hold an immutable full-result manifest reference, total count/digest and
  committed factual cursor. Read and validate bounded pages without truncating the full provider result or storing
  an unbounded array in Pending state. Keep old inline receipts readable. Exact fields follow the producer protocol.
- Do not turn the old inline limit into a new hidden native append-size restriction. A new lower input limit would
  be a product scope change; compact evidence is an engineering representation choice that preserves full coverage.

## Canonical-to-public logical field map

Sources: `memory-provider-domain-schema.ts`, `memory-provider-operation-schema.ts`, `hindsight-cutover-schema.ts`,
`hindsight-pending-client.ts`, `hindsight-snapshot-contracts.ts`, and `hindsight-replica-projection.ts`.

| Logical state | Existing alignment | Remaining obligation / owner |
| --- | --- | --- |
| Bank identity and scope | Public Bank ID/config/mission/disposition map to Canonical Bank; local Authority Epoch and Global/Character scope are Taki-owned. | Keep trusted scope binding; B4/B6 provide the actual mapping. A health check cannot invent it. |
| Source/document | `document_id`, content hash, tags, metadata, scopes and timestamps align with their camelCase canonical counterparts. | Native logical snapshots omit original document text. `HindsightReplicaProjection.source()` supplies trusted retained text/context/provenance; B4/B6 still own that full fidelity binding. |
| Facts/observations | World/experience/observation type, valid/invalidated state, revision, document/chunk IDs, source IDs, entities, dates and consolidation fields are canonical logical fields. | Preserve complete IDs/revisions/source relationships and tombstones through normal journal/snapshot projection. This does not require mirroring PostgreSQL tables. |
| Models/directives | Structured payload, source query/trigger, tags, refresh times, priority/activity and revisions already have canonical representations. | Preserve supported payloads even where Local does not execute Hindsight's own maintenance algorithms. B4 covers full current-Local import. |
| Nested metadata/config | Snapshot normalization changes only top-level field names; nested keys are opaque. | Preserve that behavior. Nested user keys must not be camel-cased or interpreted as schema names. |
| Retain metadata values | Canonical requests admit JSON values, but `retainItem()` sends strings and JSON-stringifies non-strings for native Hindsight. | This is not a reversible type mapping by itself: canonical `1` and `"1"` collide on the native wire. Resolve with an explicit adapter encoding/identity mapping before claiming round-trip fidelity; do not silently narrow existing Local metadata or alter Hindsight's semantic engine. |
| Taki policy/provenance | Canonical retain has explicit provenance and policy; native retain mapping does not encode those objects directly. Replica projection intentionally requires trusted caller data. | Keep these separate from provider semantics. B4/B6 must supply real mappings; this recovery task cannot claim complete runtime projection by substituting fixture policy/provenance. |

The field table separates existing alignment from still-open B4/B6 product delivery. This task must preserve those
dependencies and any original Pending intent data, not claim that finishing G1 completes Local maintenance or cutover.

## Portable proof hashes

`legacy-identities.ts` implements Taki's existing local canonical JSON by sorting keys and calling `JSON.stringify`.
That is not automatically Python `json.dumps(sort_keys=True)`: integer-like object keys are re-enumerated by JavaScript,
and non-BMP key ordering differs between UTF-16 and Unicode code points. Do not change this frozen local hash contract.

The producer protocol needs explicit versioned request/result serialization and shared vectors covering field defaults,
Unicode, numeric-looking metadata keys, order, null/omission and native string metadata. Keep producer request,
prepared-input and result hashes distinct from local intent/receipt-envelope hashes. An echoed client digest is not
evidence that the provider used that input or committed that result.

## Focused verification for the selected implementation

1. Native proof plus an actually applied matching checkpoint completes a write while derived work remains pending;
   no derived-task scheduling is invoked by the routine recovery path.
2. Wrong Bank/lineage/operation/request/result/hash/cursor refuses completion. A failed second pull preserves native
   success and original identity; subsequent recovery pulls again rather than reapplying the write.
3. Reopen old stored queued/submitted/awaiting-derived/completed rows and verify explicit compatibility behavior,
   immutable intent hashes and safe outcomes; old current-document receipts do not become stronger evidence by default.
4. Preserve the prior Authority/Bank races, same-lease reset, captured deadline, independent rows/Banks and unknown
   generation-loss regressions. Add exact append/lost-response and full-result-page tampering/concurrency cases.
5. Native receipt and local projection use the same cross-language vectors. Metadata and nested key preservation have
   meaningful round-trip examples; incomplete B4/B6 fields remain explicit acceptance dependencies.

No tests, services, user-data migration or authority changes were performed to produce this report.
