# Stage 5D candidate upgrade dependencies

- Date: 2026-10-07.
- Scope: source-only research for the Stage 5 leader. This report is not an implementation or acceptance result.
- Source roots: `T = H:/TakiAgent`, `N = H:/hindsight`; references below are relative to the named root.
- Source snapshot: T main at `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`; N at `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`, with concurrent working-tree implementation. Line references describe inspected source, not a frozen future build.
- Ownership: only this report. No implementation, tests, builds, service starts, original-data access, credential reads, real model/image selection, or Git lifecycle action was performed.

## 1. Decision and minimum order

Use **C1-C3 -> D1 candidate foundation -> C4 populated re-embedding -> D2 complete upgrade/promotion**. B's independently verified backup/restore and managed-template state are a prerequisite for accepting a populated candidate; B and C are dependencies, not current implementation evidence.

D1 can prove a complete same-version isolated restore and durable candidate identity without solving model conversion. C4 can then transform that isolated candidate without publishing it. D2 owns the final source boundary, promotion, and recovery for both software upgrades and populated model changes. This avoids requiring a finished D2 promotion flow before C4 can implement re-embedding, or declaring C3 complete active-data model management before C4 exists.

Existing Stage 3/4 components provide substantial reusable evidence and transaction boundaries. They do **not** expose an existing Hindsight-to-Hindsight upgrade operation. `T/packages/core/src/memory/operations/memory-operation-kinds.ts:24-39` has no candidate-upgrade kind; `T/packages/core/src/memory/transitions/transition-current-identity.ts:37-55` explicitly constructs only return-local/reenter-Hindsight identities and switches provider. Reuse their invariants and selected helpers; do not disguise an upgrade as connection revalidation or widen an identity enum without a new reviewed protocol.

The parent requirement is already explicit: preserve Native/application/control/Pending state, prepare an isolated candidate, run compatibility/migration/retain-recall/sync/template gates, and preserve old authority/user overrides before promotion (`T/.trellis/tasks/08-09-memory-operations-ui/design.md:109-122`). This report does not reopen completed Stage 3/4 acceptance.

## 2. Existing API inventory and limits

| Reusable source/API | What it actually proves or does | Limit for Stage 5D |
| --- | --- | --- |
| `T/packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts:33-64`, `:134-174`: `capture`, `admit`, `verify`, sealed/inventory/status, epoch retirement | Quiesces Core writes, stops the scheduler, captures Core, records custody and captures/adopts a matching Native archive. | `:151-153` releases the write fence and restarts scheduling in `finally`. Capture does not hold a final upgrade freeze throughout candidate preparation or stop every external Native worker. |
| `T/packages/core/src/memory/hindsight-backup/hindsight-backup-identity.ts:24-44`: `readHindsightBackupIdentity` | One SQLite transaction identifies authority, exact configured Bank scopes, checkpoints, terminal operation IDs and Core migration head. | Checkpoints are lower bounds; subsequent live changes need a new final boundary. An initial candidate copy is not permission to replace a later live Core database. |
| `T/packages/core/src/memory/hindsight-backup/hindsight-backup-pair.ts:18-44`: `verifyHindsightBackupPair` | Exact lineage/Bank set, recorded generation match, Native cursors not behind Core, requested terminal-receipt membership. | Ordinary Native-ahead state is accepted. This is not equality of every final object, source obligation or template selection. B's managed-state equality is still a planned dependency. |
| `T/packages/shared/src/hindsight-backup-schema.ts:51-72`, `:120-144` | Proof records Native Alembic revision, upstream commit, compatibility build, Bank generation/cursors and archive hash; manifest records Core hash/migration head/authority and secret presence/provenance. | These fields do not establish physical deployment/storage identity, installed image digest, actual model identity, an allowed migration path or a candidate publication receipt. |
| `N/hindsight-api-slim/hindsight_api/admin/cli.py:319-383`: `_backup_on_connection`; `admin/taki_backup.py:66-82`: `read_backup_proof` | Native proof and binary table COPY share REPEATABLE READ; table column types, contents and Taki entry digests are captured. | Plain Native manifest v2 is not itself the full Taki paired manifest or a trusted Host receipt. It does not attest an installed artifact merely by reporting a compatibility build string. |
| `N/hindsight-api-slim/hindsight_api/admin/cli.py:41-111`, `:260-278` | Existing table inventory includes replication/receipts, Native/application data, Pending jobs, invalidation/history, files and transition evidence; loaded tenant extensions can add Bank tables. | Recheck parity after B adds tables. A tenant/extension absent from candidate registration must not silently disappear from the accepted inventory. |
| `N/hindsight-api-slim/hindsight_api/admin/cli.py:388-455`: `_restore` | Schema preflight, then one transaction for reverse truncate, forward COPY and materialized-view refresh. Target service/workers must already be stopped. | This is privileged administrative replacement, not a live authority transition. It has no candidate ownership/Host guard. Missing archive tables are skipped after truncation (`:396-401`, `:427-431`); required data needs an explicit inventory gate. |
| `N/hindsight-api-slim/hindsight_api/admin/transition_restore.py:26-71`: `suspend_transition_restore_triggers` | Temporarily suspends only named transition publication guards inside the restore transaction; retains other constraints and forces deferred validation before restoring trigger modes. | Preserve this narrow historical-restore seam. Do not disable all integrity triggers to make a new schema import succeed. |
| `T/packages/core/src/memory/hindsight-backup/hindsight-backup-restore.ts:15-56`: `validateHindsightRestoreCore` | Read-only pre-writer gate checks verified artifact bytes, credentials, original Native schema/build/upstream/Alembic, exact Core authority/Bank/receipt identity and current body closure. | `:24-26` intentionally requires original metadata equality. Use it for the same-version restored baseline. Add a separate migration proof for a changed target; do not weaken Stage 3 recovery to accept arbitrary upgrades. |
| `T/packages/core/src/memory/hindsight-backup/hindsight-backup-custody.ts:16-33`; `T/packages/shared/src/hindsight-backup-schema.ts:31-48` | Credential refs, presence, catalog provenance and connection marker; absent required refs are detectable. | No secret values or recoverable catalog envelope are in this custody record. C1 must resolve credentials under their real owner; a copied manifest cannot provision a candidate's secrets. |
| `N/hindsight-api-slim/hindsight_api/engine/replication.py:328-369`, `:704`; `engine/transfer/importer.py:430-476` | Generation-aware Bank state; deleted/recreated Banks receive a new generation; authoritative insertion records actual target identity transactionally. | Bank ID alone cannot inherit Core checkpoints, receipts or managed ownership. Portable import omits old replication state, so target incarnation must be proven rather than inferred from a reused ID. |
| `T/packages/core/src/memory/transitions/transition-runtime.ts:118-132` and following custody reconciliation | Existing transition drain fences writes and work, pauses scheduler, settles work, then rechecks custody and lease. | Reusable drain discipline, but currently owned by Local/Hindsight transitions. D needs an operation-owned final boundary also covering helper and Native workers. |
| `T/packages/core/src/db/memory-transition-custody.ts:19-49`, `:99-115`; `T/packages/core/src/memory/transitions/transition-pending-sources.ts:18-37` | Exact current Timeline/group custody, completed ingestion-source proof, and latest `awaiting_native` source body/revision/hash/operation/document identity. | Pending sources are obligations, not confirmed facts. Healthy custody refuses incomplete ingestion spans. D must explicitly preserve, finish or refuse each obligation. |
| `T/packages/core/src/db/memory-transition-publication-repo.ts:25-76` | One synchronous SQLite publication transaction binds final proof/candidate/baseline, transfers custody, installs marker/receipt, verifies the result and checks the actual current lease time at the transaction end. Existing receipt returns the prior publication. | This is the model for exact publication and ACK-loss recovery, not an existing Hindsight-to-Hindsight entry point. D must bind deployment/configuration/model identities as well. |
| `T/packages/core/src/memory/hindsight-runtime-binding.ts:57-110`, `:130-151`; `T/packages/core/src/memory/transitions/transition-runtime.ts:74-85` | Retire old runtime references; install/start the selected runtime; withdraw to unavailable on binding failure; transition recovery verifies the committed receipt before rebinding. | Binding is downstream of authority publication. Its in-process revision is not a durable deployment generation or promotion receipt. Failed post-publication start cannot justify restoring the old pointer. |
| `T/packages/core/src/memory/hindsight-lifecycle/hindsight-lifecycle-revalidate.ts:32-64`, `:67-101` | Re-admits under selected lineage, verifies Banks, records connection fingerprint/admission and reconnects/replaces the binding. | It deliberately refuses Stage 4/5 drift and never writes Memory Authority. It is neither candidate migration nor proof of semantic model compatibility. |

## 3. Restore mechanisms: preserve source versus rebuild a portable Bank

### 3.1 Full paired restore is the baseline

For a candidate clone, start from a verified Core/Native pair and restore into independently owned stopped storage. First validate the unchanged source version and all expected tables/body closures. Only then apply a declared forward migration or transformation to the isolated copy. Keep the original archive immutable and link every later proof to its hashes.

Native binary COPY requires exact overlapping column types. `_validate_restore_schema` at `N/hindsight-api-slim/hindsight_api/admin/cli.py:199-257` rejects changed `format_type` values, including different vector dimensions. However, it **ignores source columns absent from the target** (`:233-250`). That general admin behavior is not a source-preservation guarantee. A D migration gate must reject unexplained dropped columns/tables and unsupported type/default changes, or require an explicit transformation preserving their meaning and evidence.

The existing proof includes schema/build identifiers, but does not validate an arbitrary old-to-new migration DAG. Do not label "COPY succeeded" or "/health passed" as migration compatibility. Preserve immutable Core/Native migration history and verify the exact supported source/target pair. Native's existing migration locking should be reused rather than replaced by a competing lock (`N/hindsight-api-slim/hindsight_api/migrations.py:330-390`).

### 3.2 Portable `export-bank`/`import-bank` is not a complete Taki clone

The current portable path can be a source of conversion components, but cannot be the unmodified D1 restore or C4 completion path:

- `N/hindsight-api-slim/hindsight_api/engine/transfer/export.py:41-115` separates replayed facts/documents, fixed Bank rows, operational tables and skipped tables. It excludes provider/cursor/receipt history, `async_operations`, graph queue, raw `file_storage`, invalidated archive and `knowledge_pages`. Its fixed Bank-row inventory does not carry D77 application bodies/bindings or W9 transition evidence. `include_history` adds audit/LLM tails, not those missing contracts.
- `export.py:276-282` removes `embedding` and `search_vector`. `engine/transfer/importer.py:143-251`, `:684-686` re-embeds imported facts and establishes new unit identities. Source-document/ordinal mapping is not the existing Taki source/evidence mapping.
- Whole-Bank import does include observations, but `_import_observations` at `importer.py:933-957` skips an observation when a required source cannot be resolved; `:964` onward embeds surviving observations. This needs explicit completeness validation before claiming preservation.
- Mental-model rows are restored through `_restore_rows` (`importer.py:325-378`, `:515-521`), which inserts supplied fields without computing an embedding. Since export removed embeddings, these calls do not establish complete mental-model re-embedding.
- `importer.py:430-476` commits the Bank insertion first; document import follows at `:488-498`. A later failure can leave a partial candidate. The public result counts are not a durable exact conversion/job receipt. Reissuing whole-Bank import against that existing Bank is rejected; deleting the Bank to retry is not an acceptable automatic recovery policy.
- The CLI's import path initializes `MemoryEngine(run_migrations=True)` (`N/hindsight-api-slim/hindsight_api/admin/cli.py:871-893`), so it is not a read-only archival validation step and may initialize models.

C4 must choose either an identity-preserving vector transformation of the full clone or an explicitly mapped reconstruction with complete source/evidence/history handling. Do not quietly substitute re-extraction for re-embedding: re-extraction can change fact identity/content and requires a distinct reviewed semantic transformation. If required text/source/evidence is absent, refuse that supported transformation rather than manufacture missing records or claim a portable subset is complete.

### 3.3 Dimension equality does not establish model equality

`N/hindsight-api-slim/hindsight_api/migrations.py:423-441` returns immediately for the same dimension and refuses a changed dimension if stored non-null vectors exist. `:444-472` only changes an empty vector column/index. Therefore:

1. Different-dimensional populated startup is not a working migration; neither restore into the already re-dimensioned schema nor model-switch startup supplies re-embedding.
2. Equal-dimensional model changes can pass the dimension check while old/new vectors are semantically incompatible. Require the actual embedding implementation/model/configuration identity and explicit conversion unless equivalence is proven by the supported adapter contract.
3. Cover both `memory_units` and `mental_models`, as `ensure_embedding_dimension` does (`:510-557`). The invalidated archive deliberately has **no embedding column**; revert recomputes a vector (`:558-561`). Preserve its original text/history and verify target-model revert semantics instead of inventing archive vectors.
4. Never automate the deletion suggestion in the Native dimension error. Candidate-only controlled transformation, retained source and durable completion evidence are required. Backend dimension/index limits still apply (`:475` onward).

## 4. Missing candidate and publication contracts

### 4.1 Durable candidate identity

Add an operation-owned candidate record and helper result that bind at least:

- Original request/operation/attempt and immutable reviewed-plan hash; predecessor authority epoch, connection/configuration revision and independently enumerated Bank/scope set.
- Source backup ID and exact Core/Native archive hashes; original schema/build identifiers, lineage, Bank generations, cursor/receipt/body closure and B template-state evidence.
- Actual Host/helper installed identity, deployment/container/storage identity, owned endpoint, immutable target artifact digest, supported public compatibility contracts and configuration generation.
- Actual six-slot model readback plus embedding implementation/model/dimension and reranker topology; secret references/custody generation only, never values.
- Restore/migration/conversion receipt identities, exact verification results, source-to-target identity mapping when required, unresolved source/job obligations and final publication/recovery state.

These are separate identities. A byte-for-byte clone can legitimately reproduce provider lineage and Bank generations; that does not prove the clone is the only physical writer. Candidate ownership and fencing must bind physical deployment/storage identity as well. Conversely, if conversion creates a new lineage or Bank incarnation, old managed ownership/cursors cannot simply be copied under reused Bank IDs.

### 4.2 Isolation before any initialization

The helper must verify fresh owned storage and prohibit sharing the live volume/database. Candidate endpoints and credentials must not route production writers to the candidate, or candidate validators back to the old Native deployment. Keep the old selected authority intact while preparing and verifying the candidate.

A copied Core database must be opened through an explicit validation harness, not unrestricted production boot: the copy contains authority markers, configuration, pending work and operation state. Ordinary boot/reconciliation/scheduling could contact the live endpoint or resume copied work. A different HTTP port alone is insufficient isolation. Bind permitted candidate connections and model adapters explicitly; deny unrelated external work, webhooks and background worker claims until the reviewed phase permits them.

Full Native backup preserves pending jobs. Restoring those rows does not authorize their execution. `N/hindsight-api-slim/hindsight_api/admin/cli.py:936-956`, `:996-1015` only reset processing worker tasks to pending; decommissioning is **not** cancellation, proof of settlement or candidate isolation. It may make work executable again. Inventory API/poller/external workers, claims, derived jobs and refresh work before admitting candidate execution.

### 4.3 Final authority boundary

The candidate's initial backup becomes stale if Core Timeline/source writes or Native writes continue. D2 must choose and prove a final protocol: bounded freeze and recapture/rebuild, or exact incremental catch-up followed by a final freeze/compare. Backup capture's automatic fence release is not that protocol.

At publication, revalidate predecessor epoch, operation ownership and actual lease time, reviewed configuration, full Bank/scope coverage, candidate physical identity, model/configuration generation, final source/custody disposition, receipt/body closure, B state and migration proof. Ordinary Native-ahead backup cursors do not prove no unaccounted final changes. A stale candidate or unknown external writer must refuse publication.

Do not replace the live `core.sqlite` with an older candidate copy: that can erase new Timeline messages, Pending obligations and operation outcomes. The existing publication/custody transaction is the architectural pattern for installing a selected representation into current Core state. A whole-Core maintenance replacement would require its own explicit complete freeze and source-preservation protocol.

Persist selection and receipt before runtime binding. Lost ACK/restart reads the exact prior result; changed identity/hash refuses. After publication, binding failure leaves the committed candidate selected but unavailable and recovers that candidate. Before publication, a failed candidate leaves old authority selected. No schema downgrade or old-pointer rollback is inferred from either failure mode.

## 5. Dependency handoffs

| Dependency | Minimum contract consumed by D | Acceptance limit |
| --- | --- | --- |
| C1 installed helper/Host/custody | Exact installed helper and Host permission identity; generation-bound request/result provenance; same-owner read-only secret resolution; safe public receipts; supported installation path. | A caller-supplied helper ID or secret-presence flag is insufficient. No cross-host plaintext transfer is implied. |
| C2 isolated provisioning/reconciliation | Owned independent storage/deployment, immutable artifact identity, durable helper journal, trusted original-operation receipt, resource inspection after unknown outcome. | D extends this to restore and candidate phases; it must not reconstruct a timeout as permission to create another deployment. |
| C3 fresh/compatible six-slot application/readback | Finite supported model adapters, exact apply generation and actual runtime readback across API/poller topology; explicit unsupported states. | C3 need not solve populated model conversion. Health alone or desired settings alone cannot satisfy D verification. |
| B templates/overlays | Exact restorable versions/user intent/before-images/ownership, generation binding, receipts, managed effective-state digest and unpublished-work hold; full backup/FK inventory. | **Planned, not proven by this research.** D must wait for independent B evidence before claiming overlay-preserving candidate acceptance. |
| Existing Stage 3/4 | Paired artifact admission, stopped-copy restore proof, body closure, operation exclusion, source custody, final lease/CAS discipline and receipt-first runtime recovery. | Retain their current contracts and accepted scope. No repeat of their entire implementation or historical acceptance is needed. |

C1-C4 decomposition is grounded in `T/.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md:124-143`; it is a source-derived plan, not evidence those producers already exist. B's future contract is explicit in `T/.trellis/tasks/10-07-hindsight-template-lifecycle/design.md:214-247`: ordinary cursor superset remains legal, while per-Bank managed-template state must match exactly and normal capture during unpublished rollout must refuse. Core-before-enrollment/Native-after-enrollment must not pass by receipt membership alone. Changed generation requires evidence-qualified re-enrollment; pristine-target proof remains independent of managed ownership.

## 6. D1 -> C4 -> D2 implementation and check boundaries

| Slice | Deliverable | Independent check before next consumer |
| --- | --- | --- |
| D1 candidate foundation | Typed durable candidate identity/state, helper-owned isolated restore, exact original-version preflight, source/body/job/template inventory, immutable baseline and read-only verification harness. Support resume/inspect and preserve rejected candidate evidence. No production selection. | Fake/helper-adapter isolation tests; same-version paired restore; wrong target/volume/Host/hash/schema refusal; no copied scheduler/job/webhook execution; original-request recovery. B proof may first use fixtures but real populated acceptance waits for B. |
| C4 populated transformation | Candidate-only actual-model configuration; complete identity-preserving re-embedding or explicitly mapped rebuild; all required vector surfaces, archive/revert semantics, source/evidence and Pending/job accounting; durable conversion progress/receipt. | Same/different dimension; semantic same-dimension change; partial batches/restart; missing source and unresolved references; mental-model embeddings; no old-vector mix; complete closure and B preservation. No promotion needed to test transformation. |
| D2 complete upgrade | Declared forward schema/build path, candidate compatibility and retain/recall/sync/template checks, final drain/catch-up boundary, one guarded publication, exact post-commit runtime recovery and old-resource retention policy. | Pre-publication failure preservation; final write/lease/config/Bank races; ACK loss; restart at every boundary; published binding failure; no old pointer/schema fallback. Software-only upgrades may skip C4 only with proven unchanged compatible embedding semantics. |

Retain/recall smoke work can mutate candidate state. Use an isolated validation scope or record and exclude its exact effects from the promoted source snapshot; do not let "verification" silently contaminate user Banks, custody or managed ownership. Hermetic providers validate source behavior first. Actual provider/download and installed-platform acceptance remains separately authorized; this report selects no real image or model.

## 7. Refusal and test matrix

All rows below are future required tests, **not tests executed by this research**.

| Input/failure | Required result and proof |
| --- | --- |
| Verified complete same-build/same-model pair | Isolated original-version restore passes existing exact gate; source IDs/body hashes/receipts and B state remain coherent; production authority is unchanged. |
| Archive hash, backup ID, source epoch, omitted Bank/scope, lineage or generation mismatch | Refuse before candidate becomes eligible. Read source scope from Core, not only caller inventory; preserve exact mismatch evidence. |
| Native behind a Core cursor or missing terminal receipt | Existing pair refusal remains. Native-ahead ordinary data needs final catch-up/accounting; it is not automatic promotion readiness. |
| Core legacy template snapshot paired with Native managed state; differing selection/digest; unpublished rollout | B equality/capture hold refuses. No fabricated ownership or inheritance by Bank ID. |
| Wrong Native schema/build/upstream/Alembic at baseline | Existing restore gate refuses. A reviewed forward migration runs only after original baseline verification and produces a separate exact target proof. |
| Missing required table/extension, dropped source column or incompatible type | Reject unexplained loss even where generic admin restore would skip/drop it. Only a supported explicit migration with preservation evidence can proceed. |
| Populated same dimension, different model/implementation | Dimension check alone cannot pass lifecycle acceptance. Require complete target-semantic re-embedding or a supported equivalence proof; no mixed old/new vectors. |
| Populated different dimension | No direct config restart or raw COPY into changed vector schema. Candidate transformation covers units and mental models, source text, indexes and supported backend limits without deleting source data. |
| Invalidated content or a mental model later reverted/refreshed | Preserve history/source; archive has no vector to copy. Verify target-model recomputation and new evidence. Portable import's missing mental embeddings cannot be counted as complete. |
| `awaiting_native` source, incomplete ingestion span, compacted source witnesses | Inventory exact latest revision/body/hash and custody. Preserve or explicitly settle under the original operation; refuse if the supported path cannot represent the obligation. Never count Pending source as a confirmed fact. |
| Pending/processing Native tasks, graph/consolidation/refresh jobs | Restored queue remains fenced. Prove claim ownership and allowed resume/reconcile semantics; no copied job automatically executes, no blind decommission/requeue, no duplicate external model admission. |
| Shared live storage, foreign deployment resource, helper/Host/config generation mismatch, missing credential custody | Refuse before restore/start effects; no implicit adoption or fallback credential source. Endpoint/lineage equality alone cannot prove isolation. |
| Failure after Bank/partial document/vector batch creation | Preserve a failed/unverified candidate and exact progress. Resume only an explicit idempotent transformation plan; do not delete/reimport on an unknown outcome. |
| New foreground source or external Native write after candidate capture | Candidate cannot publish until exact final custody and data boundary catches up or a new frozen capture succeeds. Live Core state must not be replaced by the old copy. |
| Lease expires inside synchronous publication; competing config/Bank/template change | Final live check/CAS fails the whole publication transaction; no half-transferred custody or marker. |
| Any failure before publication | Old authority and user overlays remain selected; retain restorable evidence and owned candidate status. Explicit cleanup remains separate. |
| Helper/Core ACK lost or process restart | Observe original attempt/candidate/receipt by exact identity. Same request/hash recovers; changed identity refuses; no implicit recreation, migration rerun or model-job replay. |
| Binding/start failure after committed publication | Report selected-but-unavailable; verify receipt and bind that committed candidate. Do not republish or restore the old pointer. |
| Request to return to old image/config after schema transformation or publication | Refuse blind downgrade. Only a separately proven compatible recovery/transition can change the committed selection; the old artifact is not proof of reverse migration. |

## 8. Engineering choices to settle in the implementation task

1. **Identity strategy:** preserve lineage/Bank generations with independently fenced physical deployment identity, or allocate new identities with full explicit mappings. The choice controls B ownership, replica/application evidence and receipt continuity; it is not settled by portable import.
2. **Final boundary:** bounded freeze/recapture versus proved delta catch-up plus final freeze. Specify external Native writer handling and treatment of new Core foreground sources; no unbounded implicit write stop.
3. **Schema transformation:** same-version restore then forward migration is the safe baseline. Enumerate exact supported source/target builds, migration ancestry and semantic losses; decide whether any format conversion is needed. Do not choose an unverified external version here.
4. **Re-embedding implementation:** full-clone vector update versus complete mapped reconstruction; exact unit/observation/mental-model surfaces, batch receipts, cancellation and retry semantics. Keep re-extraction outside an implicit re-embedding operation.
5. **Validation isolation:** explicit offline Core reader/harness, candidate Native worker topology, fake-provider adapters and clean validation scope; determine which checks may execute model work only in an authorized later phase.

These are engineering handoffs within the approved Stage 5 source scope. Actual host/storage selection, real image/model choice, paid/provider/download activity, destructive source repair and installed/manual acceptance remain outside this report.

## 9. Verification and evidence limits

- Source-only inspection completed for the named API, restore, generation, conversion, runtime and publication seams. Existing reports were used for C1-C3 contract planning; no claim is made that those planned producers are implemented.
- One broad semantic lookup returned no results; named paths and exact symbol searches supplied the evidence. No additional broad lookup or delegated agent was used.
- No lint, type-check, tests, builds, services, model calls, credentials or original data were accessed. The only write is this report; the matrix is a future implementation/check plan.
- B1 and C1 work may change source/contracts concurrently. Recheck exact wire/schema/table inventories at their handoffs. Their passing gates, rather than this research snapshot, must become D's implementation prerequisites.
