# B3 paired-backup integration map

Read-only investigation completed on 2026-10-08 by the reused `stage5b_b2_admission_research` explorer.
The cited paths were read live; no test, original data, service, credential or source mutation was used.
B3 remains gated by B2 implementation/review. B1 inventory repair is proceeding independently, so inventory
observations below describe the investigation snapshot rather than the final reviewed B1 source.

## Existing production seams

Paths in this table are relative to their repository root.

| Boundary | Source | Current behavior / required seam |
| --- | --- | --- |
| Core identity | Taki `packages/core/src/memory/hindsight-backup/hindsight-backup-identity.ts:24` | Synchronous authority/Bank/checkpoint/terminal receipt capture. Add exact-incarnation selection/enrollment, complete template receipt inventory and B2 hold observation here. |
| Core receipt reader | Taki `packages/core/src/memory/hindsight-backup/hindsight-backup-receipts.ts:42` | Reads Pending/application command receipts. Updating the inventory documentation alone does not extend this reader. |
| Native proof | Native `hindsight-api-slim/hindsight_api/admin/taki_backup.py:66,117` | Observes requested Banks and requested operation IDs only. It cannot detect undeclared template receipts. |
| Native snapshot | Native `hindsight-api-slim/hindsight_api/admin/cli.py:340` | Proof, table COPY and ZIP manifest share one REPEATABLE READ transaction. Keep the new evidence on that connection. |
| Common pair verifier | Taki `packages/core/src/memory/hindsight-backup/hindsight-backup-pair.ts:18` | Requires lineage/generation, Native cursor at least Core cursor, and requested receipt membership; no template equality. |
| Pair consumers | Taki `hindsight-backup-service.ts:190`, `hindsight-backup-admit.ts:53`, `hindsight-backup-verify.ts:68`, `hindsight-backup-restore.ts:48` in that same directory | Route-c capture, route-b admission, verification and restore helper share the pair verifier. |
| Restore helper | Taki `validateHindsightRestoreCore` in that directory | Rereads actual Core identity and verifies fresh Native proof. Exact source/scripts search found implementation and tests only, not an automatic boot invocation. Do not describe this helper as an already wired pre-writer gate. |

The existing W6 spec explicitly leaves D91 restore as an operator runbook. Preserve that product boundary;
B3 must state and test its actual admission path rather than silently claim automatic restore orchestration.

## Three separate sources of evidence

1. **Core publication and hold attestation:** verified enrollment/selection history, applied pointer, original
   operation publication and B2 durable hold. Normal capture refuses unpublished effects. Native cannot independently
   assert that Core published a selection; label this attestation with its actual Core source.
2. **Native receipt inventory:** independently enumerate every template receipt for each exact schema/lineage/
   Bank/generation, verify row identity and full receipt hash, normalize UUID order and hash the complete
   `(request_id, request_hash, receipt_hash)` tuples. Compare count/digest with the complete Core inventory.
   Querying only IDs supplied by Core cannot find post-Core template effects.
3. **Native observed managed state:** reread actual selected fields/resources in the backup transaction and
   combine them with actual Native inherited-configuration observation. Compute the definition-only projection
   using the same canonical rules as Core, separately from receipt membership and generic memory cursors.

Legacy/unenrolled Banks still require explicit versioned Native evidence when using the new template-aware
pair contract. Empty inventory is a valid observation; absent proof is not evidence of an empty inventory.

## Minimal request extension

Prefer a versioned request carrying each selected Bank's complete original `TemplateApplyRequest` and expected
receipt hash. Core already stores it in `AppliedTemplateSelectionSchema` and verifies the whole selection chain
in `template-overlay-store.ts:35`. In the same Native backup transaction:

- Recompute the complete original request hash using `engine/template_encoding.py:42`; verify exact target.
- Verify the existing receipt using the row/DTO/hash rules in `engine/template_snapshot.py:203`.
- Read current state for the now receipt-bound `expected_snapshot.selectors` and compute its managed projection.
- Independently enumerate all template receipts for that incarnation, including no-op and refresh-only requests.

Current Native receipts (`engine/template_models.py:175`, `engine/template_apply.py:92`) do not persist Core
selection revision, complete selectors or Core publication/hold. A bare selector list plus receipt ID/hash is
therefore not bound to the original request. Making that alternative safe would require additional Native
durable request/selector commitments. Complete original requests reuse the B1 commitment without rewriting it.

The administrative producer uses an asyncpg connection, while some lifecycle helpers expect `parse_json`.
Extract or adapt the narrow same-connection reader; never invoke a public endpoint that opens a new transaction.

## Inherited configuration is not a PostgreSQL snapshot

Core's `template-projection.ts:19` includes `config.inherited`. Native `engine/template_access.py:123` resolves
those values from global config and the tenant extension, not just database rows. Never substitute Core's
historical expected values or assumed defaults for a current Native observation.

- Route-c has an actual RequestContext/MemoryEngine at `api/taki_backup.py:113`; pass an internally authorized
  resolver to the proof producer and record the versioned configuration observation/hash.
- Route-b's current CLI has only connection, schema and request. Managed proof requires a genuine compatible
  Native configuration resolver and tenant context. If unavailable, refuse that proof explicitly; do not forge it.
- A database transaction freezes database state only. Distinguish the Native configuration observation from
  transactionally captured rows; validate the observation through the actual resolver lifetime.
- Restore admission must recompute against the target's actual resolver before enabling writers through the
  supported operator/runtime path. Environment mismatch refuses admission without declaring the historical
  archive corrupt. Historical backup validity and current-target readiness are different facts.
- Preserve B1's full inherited-field comparison in this slice. Narrowing it to active inheritance would require
  a separately versioned canonical contract, not an unnoticed digest change.

## Counterexample and allowed ordinary progress

The present pair verifier can accept a pre-enrollment Core snapshot together with post-apply Native state:
lineage/generation stay equal, Native cursor is ahead and Core's old requested receipts are still present.
The new exact inventory check must reject the empty-Core/nonempty-Native combination even if later definitions
return to their old values. It also detects additional Native no-op receipts that do not advance the cursor.

Retain `Native cursor >= Core cursor` for ordinary memory writes. The managed digest uses definition-only
projection. Do not substitute `after_snapshot_hash` or complete object/snapshot hashes: generated content,
history and object revisions can advance during a valid ordinary refresh without changing template definitions.

## Healthy return/reentry and inventories

- Core 058 preserves immutable overlay history by lineage, canonical identity, Bank ID and generation;
  `template-store-documents.ts:11` hashes that full identity. Returning to Local must retain it.
- `packages/core/src/memory/transitions/transition-current-identity.ts:37,98,113` captures preview identity,
  baseline generation and replica/application generation. Include selected-template/hold identity there.
- `transition-final-mapping.ts:80` verifies final Native generation; the final synchronous publication verifier
  `packages/core/src/db/memory-transition-publication-proof.ts:85` currently checks connection/setup inventory.
  It also needs current template/hold identity, not just a preview-time check.
- A different final generation retains the old history as foreign; Bank ID alone cannot grant old ownership.
- B1 receipts, children and refresh-results belong in Native BACKUP_TABLES/FK order and transition auxiliary
  evidence. B2 adds its per-fact sidecar. Root sent the B1 auxiliary coverage question to the current Native checker;
  final source/report supersedes this read-only inventory snapshot.

## Wire and review obligations

Both `packages/shared/src/hindsight-backup-schema.ts` (proof :51, request :79, Core Bank :108, mismatch reasons
:165) and Native `admin/taki_backup.py:31` currently use strict v1 shapes. Version the extension while preserving
historical receipts/proofs. Synchronize staged request, HTTP client, archive parser, Native route/CLI and
canonical OpenAPI/SDKs. Bound aggregate request bytes explicitly: each original apply can already be 512 KiB.

Required counterexamples: pre-enrollment/post-apply pairing, undeclared receipt, forged selectors, absent proof,
unpublished hold, wrong generation, restore configuration drift and corrupted receipt hashes. Required positive
cases: customized and removed overlays restore, exact normal pair, and ordinary memory/refresh progress with
Native-ahead cursors. Exercise the actual shared pair consumers and real isolated database/archive restoration.
