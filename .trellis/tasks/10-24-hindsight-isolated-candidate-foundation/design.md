# D1 isolated same-version candidate design

Status: execution, D1-A deterministic source exit independently accepted on 2026-10-28.
The reviewed design remains the baseline; D1-B/C/D and complete candidate runtime remain open.
Read the [requirements](prd.md), [current-source study](research/source-readiness-2026-10-24.md) and [independent preparation review](../08-09-memory-operations-ui/research/preparation-advisor-2026-10-24.md). The study is larger than the 32 KiB injection cap; read it directly in chunks rather than implementing from a truncated injection.

## Decision and supported baseline

D1 prepares and verifies an isolated historical copy. It preserves logical lineage, Bank IDs/generations, original Core authority epoch, source identities, receipts, template history and vector bytes while allocating a distinct physical candidate identity. D1 does not publish authority or execute a model transformation. C4 consumes this baseline; D2 owns the final source boundary, transformation/upgrade verification and publication.

The first supported restore profile is the existing PostgreSQL paired-backup path with SQL-backed file bodies, exact supported source schema/build and reproducible authenticated template context. External/unknown body stores or dynamic contexts require complete independently owned archives/resolvers before they can be supported. Otherwise refuse explicitly; do not discard them or report an empty successful inventory. This preserves the current backup support boundary rather than substituting portable Bank export for a complete clone.

Implement independent inventory/domain/read-only work alongside C2b. Integrate actual Host/API actions against C2b's released ownership contract. A same-version validation-only API profile does not require the complete C3 six-slot apply feature; it does require its own installed, authentication, configuration and zero-effects proof. No D1 result establishes original-model equivalence merely from equal vector dimensions.

## Existing components to reuse

| Source | Contract retained |
| --- | --- |
| `packages/core/src/db/sqlite.ts` `openReadonlyDatabase` | Completed immutable backup only; no migrations, WAL/SHM sidecars or ordinary Core startup. Never use this reader on a live WAL database. |
| `memory/hindsight-backup/hindsight-backup-preflight.ts` | Hash stopped copy before/after, obtain fresh authenticated v2 template observation, then perform strict restored-Core read-back. D1 supplies the candidate-bound client. |
| `hindsight-backup-restore.ts`, copied identity, pair and template attestation modules | Exact original schema/build/upstream/Alembic; Core-derived selected scope; body/receipt/template closure. Preserve legal Native-ahead pair semantics. |
| Native `admin/cli.py` and `admin/transition_restore.py` | Atomic COPY and narrow historical-trigger handling. D1 adds strict pre-admission and transaction correlation; generic CLI drop/skip behavior is not the D1 completeness contract. |
| Core Memory Operations and Run/Attempt/Effect owners | Operator admission/checkpoint/recovery and Host action provenance. No second retry loop, scheduler or authority runtime. |
| Installed Host deployment registry/owner | One protected resource writer and lock. Extend it for separately keyed candidate resources; never replace the selected singleton deployment. |

The exact file/line evidence, current 61-table baseline and accepted 5B restore scope are in the source study. The table count is a current inventory fact, not a hard-coded universal completeness test.

## Ownership and persisted data

1. **Controlling Core Memory Operation:** owns the admitted operator request, canonical immutable input digest and outcome. Add a narrow candidate operation and a candidate-specific durable repository for facts absent from the existing small producer reference: source backup/manifest identity, complete inventory/proof references, physical candidate association and verification stage. Link it to the original operation. Store references and bounded metadata, not a second copy of Run/Effect/Host state, archive bodies or credentials.
2. **Core Run/Attempt/Effect and Permission Gate:** own every Host-bound create/restore/inspect/start action and its actual issued/accepted identity. Candidate, operator-operation, deployment and Run IDs are distinct domains with explicit links; do not force unrelated IDs equal or trust a serialized public handle.
3. **Installed Host:** owns separately keyed candidate resource records under the same protected registry owner/lock as the selected deployment. Reserve the exact candidate before side effects; persist dispatch fences and original resource identity. Keep the selected record and existing V1 canonical digests unchanged. Candidate-specific modules may share the owner, not create another unsynchronized registry writer.
4. **Native administrative transaction and observer:** own actual restore completion and fresh read evidence. Prefer a candidate-only administrative receipt committed in the same transaction as COPY. It binds original candidate/restore request/archive identity, lives outside the preserved source domain schema, is separately classified in inventory, and is inaccessible to ordinary candidate application mutation. This is a new narrow helper seam; it is not an existing API or a new global Native domain migration.

Use an additive migration in the controlling Core for the candidate repository only after C2b's final migration handoff. Do not migrate the archived Core copy. A candidate administrative namespace must be proven new/owned before use; collisions refuse. Extract only the necessary restore transaction helper while preserving the current ordinary CLI wrapper and narrow trigger contract.

The administrative receipt is selected over equality-only recovery because a lost restore reply needs original commit identity. Full equality remains mandatory: the receipt does not prove preserved contents by itself. If commit identity or physical ownership cannot be established, retain `outcome_unknown`; do not rerun truncate/COPY or create a replacement to obtain a cleaner result.

## Planned input, output and lifecycle

Shared will define a separately versioned candidate contract. Admission binds the original request/input digest, verified paired backup and entry hashes, Core-derived selected scope, complete Native/body inventory, original version/context facts, owning Host/installation and supported candidate profile. Caller-selected paths/endpoints, a caller readiness assertion or an unverified archive list are not ownership evidence.

Candidate output is a bounded projection of original operation/proof/resource records: historical source identity, candidate association, verification stage, closed refusal/failure reason and actual recoverable references. It never reports `deploymentReady`, selected authority, inference readiness or promotion eligibility from D1 alone. Preserve failed/unknown/not-inspected distinctions.

| Domain stage | Required evidence and next action |
| --- | --- |
| Admitted | Input/archive identity frozen; no resource effects. |
| Reserved | Distinct owned candidate/storage target recorded; selected source remains separate. |
| Restore dispatched | Original Host/Effect fence saved before administrative replacement. Missing reply permits observation only. |
| Restored, unverified | Original transaction outcome and physical target established; stopped inventory/read-back may proceed. This is not selected-template acceptance. |
| Baseline verified | Complete same-version inventory, immutable Core and fresh candidate-bound authenticated template proof all pass. Historical snapshot only. |
| Refused / failed / outcome unknown | Preserve original identifiers, evidence and owned resource disposition. Explicit inspection may refine facts; no implicit adoption/replacement/replay. |

Generic operation outcome remains owned by Memory Operations; the domain stage records candidate proof progress, not a competing operation status machine. Reopening Core classifies existing local records without starting Host/network work. An explicit later inspect/resume uses the original candidate and current authorization. Cancellation before effects stops preparation; after possible effects it preserves the resource and truthful outcome. D90 owns any later admitted cleanup, including protection of source backups and referenced evidence.

## Complete inventory before restore, then equality after restore

- Seal/hash the whole Core file and read its existing authority, configured scopes, source/body/custody, application, Pending, operation and template evidence through the immutable reader. The controlling Core may write operational progress; the copied Core never becomes a running writer.
- Compare actual archive entries, manifests, declared extension tables, complete required source/target tables and ordered column types before administrative effects. Reject omitted tables/columns/bodies or unexplained source/target drift even where generic Native restore would skip or strip them.
- Preserve the database-wide supported Native inventory, including nonselected Banks and primary/history/application/control/template/Pending/queued-job records. Keep the selected Core Bank proof separately scoped. Unknown external bodies are not zero bodies.
- Retain schema/Alembic/build/upstream/PG-extension/type/constraint/trigger identity. Classify migration metadata, derived state and candidate-only administrative objects explicitly. Do not weaken the original-version gate to accommodate a later upgrade.
- After COPY, compare complete stable row/body representations, counts and hashes to the actual archived inventory; avoid unspecified COPY ordering or recompressed ZIP equality. Reuse accepted 5B comparison helpers where their representation is appropriate.
- Require unchanged source authority and source resources through success, refusal and crash. Release the ordinary capture fence after capture as before; D1 does not freeze live writes for the candidate lifetime. Later source changes affect D2 eligibility, not the truth of this historical backup.

## Physical isolation and validation-only service

Host proof must bind candidate ID to installation, engine, exact image/profile, container, actual volume backing/attachments, PostgreSQL cluster/storage, startup, listener and endpoint. Exclude the selected source and foreign writable attachments. Names, labels, matching logical lineage or a different TCP port alone are insufficient. Obtain the verifier endpoint from this authenticated proof, never directly from operator JSON. Validate the same identities after asynchronous reads and before publishing verification evidence.

The full v2 selected-template gate requires an authenticated service; Native `template_backup.py` correctly refuses offline `service_required` cases. Start only the archive-compatible validation profile after stopped restore and inventory. It is distinct from C2b's fixed fresh-store 1536 profile and from the archived execution model:

| Profile part | Planned restriction grounded in existing source |
| --- | --- |
| Schema | Exact original schema is initialized/restored first. Existing `HINDSIGHT_API_RUN_MIGRATIONS_ON_STARTUP=false` prevents inspection startup migration/dimension rewriting. |
| Embedding initializer | Existing OpenAI provider with an explicit positive dimension proven equal in archived and restored `memory_units.embedding` and `mental_models.embedding`. Explicit dimensions skip the unknown-model probing branch. Missing/inconsistent types refuse. |
| Model access | Fixed nonsecret unusable placeholder, inspection-only model label and a verified closed loopback endpoint; no source model keys. Use LLM none/skip verification, RRF and the existing dateparser initializer. These are inspection settings, not source/target model readback. |
| Imports/assets | Reuse C2b installed-module and exact tokenizer-cache-before-import checks. No import-triggered download or alternate cache fallback. |
| Template/authentication context | Reproduce the archived inherited entity labels/instructions/missions and schema/tenant/API-key-ID/extension context through supported real resolvers. Use C1 custody only for an actually required connection credential. Context changes refuse; do not rewrite archived hashes or invent grants. |
| Work | Disable and prove the absence of copied worker, MCP, maintenance/retention/reconciliation/refresh/cleanup/external-store recovery and webhook execution. Preserve due/processing queue rows unchanged. Worker-disabled alone is insufficient. |
| Transport | Allow only the necessary actual compatibility/template-proof reads to the candidate verifier; deny inference/mutation routes and external/source egress. Reuse C2b's actual listener and checked API/PG shutdown ownership. |

The relevant provider/server branches were read in current source; installed imports, full startup side effects, route restriction, authentication, cache use and restart remain actual acceptance gates. A minimal finite validation-profile seam may be added to the existing producer if flags alone do not guarantee the required boundary. Do not bypass real authentication/template observation or create a mock substitute. Unknown model identity remains in the handoff and prevents model-dependent execution until C3/C4 supplies actual evidence.

## Parallel ownership and handoffs

C2b first owns its real Shared/Shell wire, deployment registry/adapter, Native API lifecycle, setup capsule/template purpose and relevant Core boot/migration integrations. D1 independently owns new candidate-specific schema, inventory/immutable verifier, domain repository interface and deterministic tests. Root serializes edits to shared exports/unions, capability and operation registries, boot files, applied migrations, Host resource format and Native artifact recipes.

Current source registry ends at Core 059 and Native e62a3d0b9c54; these are planning observations, not reserved future numbers or applied runtime heads. Allocate new versions only against the current shared graph. Preserve all existing uncommitted Native Stage 5 work in the artifact manifest. Keep one heavy build/test/runtime slot and use current G: staging/capacity checks.

The [execution plan](implement.md) separates D1-A/B source work from D1-C/D actual integration. D1-A is now dispatched under the owner's continuation; the later runtime gates remain unchanged.

## Alternatives and cost

- **Preserved logical identities + distinct physical ownership** is selected. Full remapping would require complete translation of receipts, signatures, source/application/template/history links and is a later transformation concern. The selected approach requires strong physical identity proof because copies intentionally share logical IDs.
- **Full paired restore + strict caller admission** is selected over portable export/import, which omits operational/history state and changes identities. Ordinary restore compatibility behavior remains available to its original callers.
- **Existing immutable reader + authenticated validation profile** is selected over copied Core boot or an offline fabricated template proof. Its cost is a narrow real service/runtime gate, without waiting for complete C3 model application.
- **One candidate domain record + same-transaction administrative restore receipt** is selected over another workflow engine or equality-only uncertain completion. It adds bounded domain metadata while reusing existing operation and Host owners.

## Required downstream handoff

D1 provides immutable backup/inventory/proof references, preserved source and template/Pending state, actual physical candidate identity, explicit known/unknown model context and its no-execution boundary. C4 must cover same-dimension semantic changes and changed dimensions, all vector surfaces and historical revert semantics, durable batches/restart and no mixed models. D2 must prove the forward software/schema path, final source/custody/configuration/template/lease boundary, one guarded publication and recovery of the committed candidate before runtime binding. Neither may replace live Core with this older copy or silently downgrade after publication failure.

Stage 6 starts after C2b and uses the parent's [complete journey plan](../08-09-memory-operations-ui/research/s6-acceptance-plan-2026-10-24.md). Complete model upgrades remain Stage 5 deliverables and required Stage 6 acceptance; D1 alone does not satisfy them.
