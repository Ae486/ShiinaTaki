# Research: Stage 4 transition and emergency prerequisites

- Query: Which current producers can support repeated healthy Local -> Hindsight -> Local re-entry and emergency Local takeover, and what must be added before these operations are safe to release?
- Scope: mixed; current Taki source and known native Hindsight source, planning only.
- Date: 2026-09-29
- Baseline: `H:/TakiAgent`, `main`, `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; checked by reading Git metadata, without Git commands. The legacy `.trellis/.current-task` is empty; the parent explicitly supplied this task and subsequently confirmed session binding.

## Findings

### 1. Disposition and evidence boundary

Stage 4 has reusable persistence, proof, source custody, runtime and operator foundations, but no complete reverse-transition, repeated-entry or emergency authority workflow. Keep first-activation history intact and add transition-owned evidence; removing the existing first-activation guards is not a sufficient implementation.

Both `acceptance-stages-1-2.md` and `acceptance-stage-3.md` were read completely. Their new executions and historical evidence remain the acceptance record; this research ran no tests, services, native administration or real-data operations. The B7 drafts and September audit were reconciled with current source: Canonical Local now has a real write fence; first activation, lifecycle and backup are delivered. Earlier claims that those foundations are wholly absent are stale.

| Readiness item | Current disposition | Smallest owned follow-up |
| --- | --- | --- |
| Stage 1/2 F1: manual sync false success | Confirmed current defect. `memory-operation-kind-replica.ts:91` accepts a preceding run's later-than-admission success even after the requested run failed. | Scheduler/operations owner must bind manual request -> claim -> persisted outcome. Preserve the current failed code; timestamp tightening alone is insufficient. Required before a transition trusts manual completion. |
| D84 exact attribution/cancellation | The existing ref contains Bank and admission time, not a durable manual request/claim identity; global supervisor error and queued cancellation remain imprecise. | Extend existing B5 request/claim evidence and exact cancellation, not the scheduler count or a second queue engine. `memory-operation-contract.ts:30`, `memory-operation-kind-replica.ts:16`. |
| Stage 3 F1: backup interval namespace | Confirmed current defect at `hindsight-backup-status.ts:32`; incident construction reuses it at `hindsight-backup-emergency.ts:28`. | Backup/status owner retains lineage, generation, Bank and epoch continuity evidence before comparing cursors. Keep historical backup ID/age independently; incompatible/unknown coverage stays unknown. |
| Stage 1/2 F2: Local inventory under fence | A new Character can still create a Bank during capture. The later D87 journey safely refuses incomplete activation; this is not a newly proven unsafe promotion. | Preserve a final complete inventory/coverage check and narrow the old specification wording. Transition planning must distinguish memory-write fencing from Bank-inventory closure. |
| D86 reverse Bank identity | Backup trigger is closed; reverse-transition trigger remains open. Existing Local IDs have both migration-derived and UUID origins. | Resolve by logical scope, reuse the proven historical Local Bank ID, mint one durable ID only for a genuinely new scope. Never rewrite old IDs/receipts. |
| D93 rollback diagnostics/hold | Current explicit full application-checkpoint rollback is fixed. Seed without an application checkpoint and the native-only rollback/change-page branch retain narrower diagnostics. | Sync owner compares same-generation B5/native and application coordinates on transition-used paths and preserves explicit-run hold. Add distinct seed and page regressions; do not resurrect the fixed explicit-full finding. |
| D91 restore capability | Stage 3 provides a paired-artifact producer/verifier and historical isolated restore evidence; no new live restore was performed. | Transition owner delivers the reviewed stopped-Core/native paired restore runbook and isolated proof before real-data replacement. A new restore tool is not required. |

Paths in this table are under `packages/core/src/memory/operations/`, `packages/core/src/memory/hindsight-backup/`, or the exact paths below. D84/D86/D91/D93 are recorded at `docs/deferred-decisions.md:33`, `:35`, `:40`, `:42`.

### 2. Authority transactions and receipt validation

| Files found / code pattern | Reuse | Missing Stage 4 work |
| --- | --- | --- |
| `packages/core/src/db/canonical-memory-authority-repo.ts:30` — Local-only initialization; `:37` inserts `reason='initial-local'`. | Provider-neutral active-epoch read and scoped Bank lookup. | This is not a Hindsight -> Local transaction or candidate publication protocol. |
| `packages/core/src/db/hindsight-authority-repo.ts:41` — synchronous transaction reserves the Local SQLite writer before final checks; `:225` closes predecessor, publishes authority/selection and receipts. | Short atomic COMMIT, predecessor/CAS checks, immutable receipt and per-Bank proof pattern, `beforeCommit` custody hook. | `:82` requires an active Local `initial-local` predecessor; `:93` joins a completed B2 migration receipt. Add a separate transition source/receipt contract rather than forging B2 history. |
| `packages/core/src/memory/legacy-migration/legacy-activation-repo.ts:19` — marker parsing; `:32` Hindsight receipt validation; `:46` Local recovery receipt proof. | Marker-first validation and fail-closed boot behavior. | Hindsight validation joins `hindsight_cutover_runs`; Local recovery joins migration run/snapshot receipts. Both need an explicit alternative proof for transition-created epochs. Preserve their original proof branches. |
| `packages/core/src/db/hindsight-local-coverage-reader.ts:34`, `:57` — complete witnesses, but the epoch reader also requires `initial-local`. | Actual Bank/source/unit/policy/lineage/derived/Block payload enumeration and hashes. | Extract a neutral descriptor reader with explicit transition admission; retain old B4 guards. Simply calling this API on a new Local epoch will refuse. |

Proposed smallest extension: durable transition intent/attempt, immutable final proof and transition receipt, with explicit source/target epochs, full Bank mapping, provider namespace, config/inventory revision, custody assignment, queue cutoff and backup/incident references. Stage and verify a candidate before publishing it. One final SQLite transaction must recheck the predecessor and proof, select the target, write the receipt, transfer custody and queue ownership. No network or filesystem I/O belongs inside it. Allocate migrations from the then-current lineage; do not reserve a guessed migration number here.

### 3. Final provider fence and required maintenance

The current Hindsight write fence and scheduler stop are useful Core coordination, not a final provider-wide frozen-state proof.

- `packages/core/src/memory/hindsight/hindsight-writer-fence.ts:27` wraps foreground tools, maintenance, flush, tidy and observed writes; capture/reads remain open. `packages/core/src/memory/hindsight-backup/hindsight-backup-service.ts:119` composes Core-first capture, writer pause and scheduler stop for Stage 3's pair contract.
- `packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:34` owns scheduled and on-demand work; `synchronize`, `recover`, `runner`, `settle`, `stop` are reusable. Scheduler stop alone does not seal its foreground admission.
- `packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:138` runs binding commands between pulls. Thus foreground capture/recall synchronization can be a native application writer, not just a local read. Final transition proof must include this path and the outstanding sync/publication lifetime.
- `packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:52` performs pull -> replay -> pull and requires Hindsight authority. Its result proves routine factual recovery, not a transition or current required-maintenance certificate.

Known native seams were inspected directly after the narrowed native semantic query reported no repository index:

| Native file under `H:/hindsight/hindsight-api-slim/hindsight_api/` | Current contract and Stage 4 implication |
| --- | --- |
| `engine/bank_maintenance.py:98` | `lock_bank_maintenance` takes replication cursor -> owner locks; reuse this lock order and namespace/token discipline. |
| `engine/bank_maintenance.py:68`, `:113`, `:170` | Occupancy ends at lease expiry. Non-maintenance admission is serialized but explicitly **not denied** by a cutover lease; ordinary maintenance has its own guard. This does not freeze every native writer. |
| `engine/cutover_maintenance.py:38`, `:142`, `:234`, `:258` | Existing D78 lease is 300 seconds, tied to an exact committed transfer and attempt. Stale tokens refuse, but expiry/release restores scheduling. It is not durable retirement across an uncertain Core COMMIT. |
| `engine/cutover_verification_certificate.py:47`, `:50`, `:140` | Rechecks attempt, accepted work, real inputs/actions/outcomes and snapshot equality; persists an actual certificate in the snapshot boundary. Reuse evidence generation rather than inferring maintenance from queue length/timestamps. |
| `engine/cutover_verification_store.py:442`, `:482` | Certificate persistence releases cutover maintenance ownership. A historical certificate does not hold the source immutable until Core switches. |
| `engine/transfer/current_state_writer.py:189` | `_write` locks the Bank, recovers an exact prior result, admits the complete baseline, writes and seals mappings atomically. Reuse transaction/idempotency mechanics; this is not a verified current-Local delta protocol. |

The proposed native transition capability remains a **W2 readiness gate**: authenticated acquisition/lookup, complete supported-writer admission and drain, finite required-maintenance execution, final native **and application** snapshot/certificate, persistent retired/quarantined state, explicit abort/finalization, and stale-executor refusal. Losing an executor lease may replace the executor; it must not silently reopen the old provider while Core's COMMIT is unresolved. A deployment without this capability must refuse healthy switching. Privileged direct database edits remain outside the supported writer contract and invalidate continuity when detected.

Warm catch-up may reduce the pause; only proof obtained after the relevant final fence covers the promoted source. Work or maintenance completing immediately before the fence must appear in that proof. Final proof must cover every Bank, including empty Banks, and distinguish required maintenance from routine native-result confirmation and deferred D79-D83 work.

### 4. All writers and exact primary custody

| Writer / owner | Current source seam | Required transition handling |
| --- | --- | --- |
| Local retain/edit/invalidate/restore, observed writes, background tools, tidy, ingestion, flush | `canonical-local-writers.ts:31`; `canonical-local-subsystem.ts:27` | Reuse one Local admission fence and settle already accepted work; add typed intent admission for supported writes during the transition. Do not replay saved tool closures. |
| Local retention and lazy Bank initialization | `canonical-local-subsystem.ts:45`; `canonical-local-runtime.ts:34`, `:75`; `canonical-local-banks.ts:14` | Retention already checks writability. New-Character capture is the confirmed inventory exception: account for it before cutoff or retain unavailable/witnessed memory afterward, and recheck the complete inventory at COMMIT. |
| Hindsight foreground writes, parent/native/application work, curator, source flush | `hindsight/hindsight-runtime-state.ts:42`; `hindsight/hindsight-memory-subsystem.ts:90` | Drain all owning journals/services, not just Pending totals. Include application commands, parent writes, ingestion spans, curator work and factual unknowns. |
| Scheduler, foreground sync, recovery, binding publication | `hindsight/hindsight-runtime-bank-service.ts:34`; `hindsight/hindsight-application-sync-runner.ts:138` | Separate ordinary admission from transition-owned final pulls; seal and settle both scheduled and foreground work. Final reads must not unexpectedly create unowned binding writes. |
| Setup/provision/revalidate/backup and per-Bank manual sync | `operations/memory-operation-contract.ts:59`; `operations/memory-operation-kind-replica.ts:16` | Extend mutual exclusion for the transition family, and explicitly fence manual sync: it currently bypasses the exclusive-family guard. Internal transition calls use existing producers, without recursively submitting conflicting public operations. |
| Blocks | `packages/core/src/db/structured-memory-block-repo.ts:19`, `:28` | Blocks are whole-document, scope/revision checked and provider-epoch independent; expected epoch is optional at this low-level repo. Include actual callers in admission and the full Block revision set in final proof. |
| Primary Timeline persistence | `packages/core/src/db/primary-memory-custody-repo.ts:59`, `:145`, `:182` | Append and exact member registration are atomic; finalization witnesses the assigned epoch and recovery requires a dead/settled producer. Keep this custody separate from memory mutation queues. |

Unqualified memory paths in this table are under `packages/core/src/memory/`.

`packages/core/src/db/hindsight-activation-custody.ts:12` is the existing Local -> Hindsight carry: it refuses incomplete source spans, copies only unconsumed witnesses, seeds target cursors and reassigns open/finalized groups inside the promotion transaction. Reverse/emergency need their own validated carry; the existing Local candidate relocation is not an Hindsight carry. Preserve exact entry IDs, sequence, digests, group/Run identity, consumed span/receipt identity and per-Bank completion. Never re-extract an already proven effect because another Bank or the runtime bind failed.

`packages/core/src/memory/runtime-composition.ts:91` and `hindsight-runtime-binding.ts:113` route late primary commits under a committed-but-unbound Hindsight marker. Reverse publication needs equivalent Local marker routing and reconciliation. Keep chat custody open through drain, COMMIT and constructor failure; late witnesses below an old cursor remain eligible. Emergency cannot require completing remote spans: seal and carry their exact unresolved identity/disposition without claiming remote success.

### 5. Complete baseline, mappings and current Local state

Reusable data/proof sources:

- `packages/core/src/db/hindsight-local-coverage-reader.ts:25` enumerates Bank, source, unit, policy, lineage and derived tables, and `:45` includes Blocks. It hashes full payloads; source revision alone misses edits/policy changes.
- `packages/core/src/db/hindsight-current-capture-reader.ts:21` freezes typed current records and independent dispositions; `hindsight-current-capture-repo.ts:18` persists immutable captures under the writer reservation.
- `packages/core/src/db/hindsight-local-bank-binding.ts:12` maps Local Bank scope through the verified B3 native binding. Local/native ID equality is not proof.
- `packages/core/src/memory/hindsight/hindsight-current-baseline.ts:22` validates a complete target snapshot but accepts only the template Bank/controls plus explicitly proven superseded objects. `hindsight-current-preparation-repo.ts:22` freezes that first-transfer command. These are useful baseline and receipt checks, **not** arbitrary used-Bank delta reconciliation.
- `packages/core/src/memory/hindsight/hindsight-current-orchestrator.ts:24` reads a historical import result before a POST and retrieves complete mappings; `:45` validates actual maintenance/snapshot evidence. Reuse exact replay and complete evidence validation.
- `packages/core/src/memory/hindsight/hindsight-application-projection.ts:33` reconstructs verified current native values with exact application artifacts, original typed metadata/source evidence, policy, derived payloads and tombstones; unbound state is explicitly withheld. Keep the complete application evidence closure as well as consumable projections: recall-visible rows are not a preservation inventory.
- `packages/core/src/db/canonical-memory-maintenance-retention.ts:23` records rolling deletion through the maintenance journal; its source-retirement path preserves last identity/revision. `canonical-local-subsystem.ts:45` supplies the current retention worker. Local's real lifecycle/policy/Block changes must reach re-entry even when no source revision increments.

Proposed minimum: retain the healthy exit's full common descriptor/mapping baseline and immutable proof. On re-entry compare it with a complete current-Local inventory, explicitly identifying additions, edits, invalidation/restore, expiry, deletion, policy, Bank and Block changes. Use scope plus stable logical mappings across epochs; do not treat mechanical epoch relocation as an edit to every record. Prove deletion from complete inventory and lifecycle/tombstone/receipt evidence, not a missing row in a partial query. Detect contradictory/missing closure as a refusal.

Verify unchanged target lineage/generation and baseline before applying changes under the new native transition contract. Transfer only necessary changes and retain unchanged records/mappings. Preserve original native object identity separately from reconstructed Local identity, all supported source links/provenance, native-derived payloads, policies and Blocks. Native algorithms need not be reproduced in Local. A schema/representation gap requires a lossless representation or explicit blocking gap, never silently dropping an observation or rewriting original evidence. New scopes get one durable mapping (D86).

Foreign target changes, incompatible namespace, an emergency branch or missing baseline refuse healthy re-entry. Do not clear Banks, invent B2 receipts, auto-merge, or turn refusal into mandatory full copying. D88's whole-Bank remedy remains separate.


## Continuation

Read [runtime, emergency and verification prerequisites](stage-4-runtime-prerequisites.md) for sections 6-12 and the research caveats. Both parts are required context.
