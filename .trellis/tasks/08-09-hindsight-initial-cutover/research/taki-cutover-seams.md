# Research: TakiAgent Initial Hindsight Cutover Seams

- Query: Identify the live TakiAgent seams, invariants, reusable components, missing pieces, and risks for B4 initial Local-to-Hindsight migration, replica construction, authority selection, epoch creation, and atomic activation.
- Scope: mixed (internal TakiAgent code/specs plus previously recorded Hindsight 0.9.0 source research)
- Date: 2026-08-21

## Files Found

- `.trellis/tasks/08-09-hindsight-initial-cutover/prd.md` — B4 goal, gates, dependencies, and out-of-scope boundaries.
- `docs/adr/0009-single-memory-authority-with-local-replica.md` — one-authority/local-replica policy and atomic Hindsight cutover rule.
- `packages/core/src/memory/memory-provider.ts` — provider-neutral async interface and call context.
- `packages/core/src/memory/memory-coordinator.ts` — provider/lineage selection, capability validation, and no-fallback dispatch.
- `packages/core/src/memory/local-memory-provider.ts` — Local provider behavior reference (sparse recall, CAS mutation, envelopes).
- `packages/core/src/db/canonical-memory-authority-repo.ts` — Local epoch initialization and Local-only active-epoch invariant.
- `packages/core/src/memory/runtime-selector.ts` and `runtime-composition.ts` — marker-first startup, canonical runtime construction, and legacy retirement.
- `packages/core/src/memory/legacy-migration/legacy-snapshot.ts` — immutable Markdown snapshot/manifest publisher.
- `packages/core/src/memory/legacy-migration/legacy-migration-ledger-repo.ts` — lease-fenced resumable migration ledger.
- `packages/core/src/memory/legacy-migration/legacy-migration-runner.ts` — staging, normalization, local import, verification, and activation orchestration.
- `packages/core/src/memory/legacy-migration/legacy-canonical-converter.ts` and `legacy-canonical-import-repo.ts` — deterministic canonical IDs, sanitizer, idempotent local staging, and conflict refusal.
- `packages/core/src/memory/legacy-migration/legacy-activation-repo.ts` and `memory-authority-fence.ts` — fenced short transaction and process quiescence.
- `packages/core/src/db/migrations/017-canonical-memory.ts` and `021-memory-legacy-migration.ts` — canonical records/FTS and migration/authority marker schemas.
- `packages/core/src/memory/hindsight/hindsight-client.ts` — B3 authenticated setup/control-plane client; notably no data-plane memory API.
- `packages/core/src/memory/hindsight/hindsight-contracts.ts` — B3 compatibility, template, and operation wire schemas.
- `packages/core/src/memory/hindsight/hindsight-setup-service.ts` and B3 setup repositories — configured/compatible bank-template prerequisite state without authority switching.
- `.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md` — evaluated Hindsight 0.9.0 capabilities and replication contract gaps.
- `.trellis/spec/backend/database-guidelines.md` — executable migration/activation and privacy invariants.

## Findings

### Cutover contract and authority decision

B4 is explicitly a one-way initial import gate: every source must have a terminal ledger result (or explicit exclusion), asynchronous Hindsight derivation must be resolved to all fact IDs/revisions, a complete local logical replica and cursor-bound integrity manifest must verify, and only then may a new Hindsight Authority Epoch be activated. The task PRD requires that interruption leaves Local authoritative and resumable, and that neither UI actions nor health results bypass the gates (`.trellis/tasks/08-09-hindsight-initial-cutover/prd.md:1-35`). ADR 0009 states the same invariant: unresolved non-excluded sources, unresolved document/fact mappings, or failed replica/checkpoint integrity block Hindsight authority; activation is atomic and failed work leaves Local authoritative (`docs/adr/0009-single-memory-authority-with-local-replica.md:31-32`).

The current persisted authority model is deliberately Local-only. Migration 021 creates `memory_authority_selection` with `legacy-markdown` and `canonical-local` modes and a strict all-null/all-present check (`packages/core/src/db/migrations/021-memory-legacy-migration.ts:43-58`). Canonical migration activation requires a ready run, matching manifest/readiness digests, zero unresolved dispositions, a canonical active epoch equal to the run epoch, and an old marker still in `legacy-markdown`; it updates the marker, receipt, and run status in one SQLite transaction (`packages/core/src/memory/legacy-migration/legacy-activation-repo.ts:17-34`). This is a strong reusable atomic-local activation primitive, but it cannot select Hindsight: the marker schema has no Hindsight mode/provider lineage/remote epoch fields, and `canonical-memory-authority-repo.ts` rejects every active epoch except Local with `reason='initial-local'` (`packages/core/src/db/canonical-memory-authority-repo.ts:28-54`).

The epoch schema itself is intentionally broad enough for future provider epochs (`providerId`, `providerLineageId`, predecessor, status, reason), but the repository only creates/accepts Local initial epochs today (`packages/core/src/db/canonical-memory-authority-repo.ts:28-54`). B4 needs an additive authority/epoch transition contract that preserves the original Local epoch as predecessor/history, binds the accepted Hindsight provider lineage and bank identity, and atomically writes Hindsight selection plus an activation receipt. Reusing `activateCanonicalLocal` and changing a string would violate its Local-only invariant and the ADR's single-authority model.

### Existing provider/coordinator seam

The provider-neutral runtime interface is already the right ordinary-operation boundary. `MemoryProvider` carries provider ID and lineage, asynchronous `capabilities`, retain/recall/reflect/mutate methods, and a call context containing request ID, authority epoch, actor, and cancellation (`packages/core/src/memory/memory-provider.ts:1-11`). `MemoryCoordinator` reads the persisted active epoch, resolves exactly the matching provider/lineage, validates request and result envelopes, rejects unsupported capabilities, checks authority/capability drift before and after invocation, and never performs implicit fallback (`packages/core/src/memory/memory-coordinator.ts:1-4`, `:43-107`, `:142-178`). B4 should implement a Hindsight provider behind this seam, not add Hindsight branching to tools or chat.

The Local provider is a useful behavioral reference for envelope construction, CAS mutation, sparse recall, one operation receipt, and optional vector state (`packages/core/src/memory/local-memory-provider.ts:1-50`, `:53-228`). It is not a migration implementation: its retain creates one local experience unit, while B4 must submit one source document to Hindsight and later resolve one-to-many derived facts. Existing canonical schemas support document IDs, memory IDs, revisions, provenance, policy projection, source lineage, and result arrays; they are suitable for the local replica projection but do not yet model remote journal/checkpoint/pending import state (`packages/shared/src/memory-provider-domain-schema.ts:1-160`; `packages/core/src/db/migrations/017-canonical-memory.ts:1-60`).

`canonical-local-runtime.ts` composes the Local provider and coordinator with only `new Map([["local", provider]])`, so there is no Hindsight provider registration path yet (`packages/core/src/memory/canonical-local-runtime.ts:1-31`). Runtime selection is marker-first: it reads the authority marker before constructing legacy memory, creates canonical Local only for `canonical-local`, and can swap an already-created delegating engine after activation (`packages/core/src/memory/runtime-selector.ts:1-32`). `runtime-composition.ts` wires the selector, authority fence, authority-aware legacy wrappers, and on-demand migration runner (`packages/core/src/memory/runtime-composition.ts:1-40`). These are reusable startup/retirement seams, but B4 must extend them to construct Hindsight-authority runtime only after the new marker is committed; it must not use `bindCanonical` as a substitute for persisted Hindsight activation.

### Legacy migration assets that B4 can reuse

The migration runner already provides the durable source/attempt/result/exclusion ledger, lease owner plus monotonically increasing fence, resumable staging, and bounded status/exception projections (`packages/core/src/memory/legacy-migration/legacy-migration-ledger-repo.ts:1-42`, `:45-127`; `packages/core/src/memory/legacy-migration/legacy-migration-runner.ts:21-62`, `:76-128`, `:169-180`). The source table distinguishes `converted-zero`, `converted-one`, and `converted-many`, records `result_count`, and stores ordered result rows with memory ID, revision, and payload hash (`packages/core/src/db/migrations/021-memory-legacy-migration.ts:20-42`). This exactly matches B4's one-to-many ledger requirement at the local schema level.

Snapshot publication is immutable and hash-addressed. It discovers only allow-listed `memory` and `blocks` Markdown files, records relative path, byte length, SHA-256, and closed discovery diagnostics, copies source bytes into a content-addressed directory, verifies copied bytes, writes a manifest, and renames the temporary directory atomically (`packages/core/src/memory/legacy-migration/legacy-snapshot.ts:1-47`, `:49-86`). B4 should retain this snapshot as the read-only source of import truth and compare a dry-run manifest at activation. It must not read mutable Markdown directly during remote import or after authority activation.

The normalizer/converter/importer already provide the intended deterministic identity and safety behavior. Legacy entries are sanitized, assigned a deterministic bank-specific document ID and operation ID, converted to canonical source/unit/policy records, and represented as zero or one local result today (`packages/core/src/memory/legacy-migration/legacy-canonical-converter.ts:19-59`). The importer bypasses public Local retain, uses idempotent operation receipts, rejects payload/content conflicts, and writes source/unit/policy/FTS rows transactionally (`packages/core/src/memory/legacy-migration/legacy-canonical-import-repo.ts:11-18`, `:21-72`). For B4, the converter's stable `documentIdentity`/`operationIdentity` strategy and source metadata should be reused for Hindsight request IDs; the local importer must instead become a replica apply path fed by Hindsight's public logical results.

Lease fencing is already explicit: acquire/renew/release require owner, fence, and unexpired lease; attempts and result updates recheck the fence (`packages/core/src/memory/legacy-migration/legacy-migration-ledger-repo.ts:52-75`, `:84-118`). The process-wide authority fence rejects new work once quiescing begins, drains active operations with a timeout, and remains retired after successful activation (`packages/core/src/memory/legacy-migration/memory-authority-fence.ts:6-35`). B4 can reuse this fence for the final local-write drain, but remote import and derived polling must occur before the fence; no network/async operation belongs inside the short activation transaction.

### B3 setup/provider seam and its boundary

B3 provides an authenticated, secret-safe, OS-neutral Hindsight REST seam with endpoint policy, health/version/compatibility calls, deterministic Global/Character bank IDs, additive template dry-run/apply, operation status polling, and optimistic setup-state persistence. The focused client exposes only `health`, `version`, compatibility, bank create/update, template import/export, bank LLM health, and template-operation status (`packages/core/src/memory/hindsight/hindsight-client.ts:1-48`, `:51-111`). It has no retain, recall, document/memory listing, logical snapshot, journal, tombstone, or conditional mutation method. B4 therefore cannot implement migration or replica sync by calling the current client; it needs a new narrow Hindsight data-plane client/adapter rather than broadening setup methods indiscriminately.

Compatibility validation already advertises the required extension families (`change_journal`, `conditional_mutation`, `logical_snapshot`, `additive_observation_instructions`, `controlled_layer_projection`) and provider lineage/database/storage constraints in its wire schema (`packages/core/src/memory/hindsight/hindsight-contracts.ts:20-47`). Setup deliberately refuses to alter authority and requires `canonical-local` before validate/setup/LLM-health (`packages/core/src/memory/hindsight/hindsight-setup-service.ts:1-5`, `:76-120`, `:163-199`, `:254-256`). This is the correct prerequisite boundary: B4 should require a configured/verified B3 snapshot and exact compatibility fingerprint, then perform data-plane import and replica verification in a separate migration service. B3's setup repo is not an authority or replica store; it persists only sanitized connection/template evidence (`packages/core/src/db/hindsight-connection-repo.ts:1-50`; `packages/core/src/db/hindsight-bank-setup-repo.ts:1-28`).

### Required B4 data-plane seams missing from live code

1. **Hindsight provider adapter.** Implement `MemoryProvider` for Hindsight, mapping provider-neutral retain/recall/mutate envelopes to authenticated remote operations and preserving request ID, provider lineage, authority epoch, capability snapshot, and typed errors. The current client has no such methods.
2. **Migration-only remote import orchestration.** For every normalized source, submit deterministic bank-specific `document_id` plus deterministic asynchronous `operation_id`; persist operation identity before/with the request; resume lost acknowledgements by resubmission; treat operation-ID reuse with a different payload as a conflict. After completion, query the deterministic document until the derived-completion predicate is true, then persist every resulting fact ID and revision in `memory_migration_results`. The existing ledger supports result rows but current `stageSource` writes a local record directly and assumes one result (`packages/core/src/memory/legacy-migration/legacy-migration-runner.ts:91-116`).
3. **Derived-completion predicate.** Add a contract-aware wait/read path that distinguishes retain operation completion from semantic extraction/consolidation completion. A completed asynchronous operation response alone does not provide fact IDs; B4 must query the document/fact projection and verify the required terminal state before ledger resolution.
4. **Logical snapshot and replica builder.** Add Hindsight snapshot descriptor/page contracts bound to an end cursor and integrity manifest, then transactionally materialize canonical banks/sources/units/derived/policy/tombstone projections plus a local FTS index. The local schema currently has no replica checkpoint or remote cursor tables; migration 021's source ledger is not a replica checkpoint.
5. **Checkpoint/change-journal consumer.** Add monotonic cursor, tombstone, object revision, and provider-lineage fields. Apply each batch in one Core transaction and advance the checkpoint last; a failed batch must leave the previous checkpoint intact. Cursor expiry must force a full snapshot/reconciliation, not offset continuation.
6. **Hindsight authority epoch/selection migration.** Extend the marker/receipt schema and authority repository to represent `hindsight` (remote provider lineage, active epoch, verified replica snapshot, cursor/checkpoint, compatibility/template evidence). The transition must be one short synchronous SQLite transaction after all remote gates pass. Existing `activateCanonicalLocal` is intentionally Local-only.
7. **Runtime composition.** Register the Hindsight provider only when the persisted marker selects the Hindsight epoch and construct Hindsight-authority runtime before legacy construction. On failure or restart before commit, select legacy/Local according to the previous marker and preserve resumable ledger state. Never use setup `configured` or health `healthy` as authority proof.
8. **Replica integrity/reconciliation gate.** Verify source count/hash, bank lineage and template revision, one-to-many document/result mappings, all expected object revisions/lifecycle/tags/provenance, checkpoint cursor, FTS/readiness, and no unresolved ledger rows. Persist manifest/readiness digests and require them again inside activation transaction.

### External Hindsight contract evidence and exact risks

The recorded Hindsight 0.9.0 source research establishes that caller-selected `document_id` is accepted and asynchronous retain is idempotent by caller `operation_id`; reusing an operation ID for a different operation conflicts (`.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:57-67`). Retain responses expose counts/operation IDs, not extracted fact IDs, so B4 must resolve the deterministic document after completion. Public recall projections expose logical fact fields, but ordinary list APIs are offset/recency based and cannot prove replication completeness (`.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:69-74`, `:95-130`).

The same research records the minimum accepted compatibility extension: monotonic logical change journal with tombstones, per-memory revision plus `expected_revision`, cursor-bound consistent logical snapshot/manifest, extension/version advertisement, additive observation instructions, and layer tag re-derivation (`.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:1-22`, `:45-52`). It explicitly found no proven native public cursor/tombstone feed, cursor-bound snapshot, conditional mutation, or fact-ID-complete retain receipt in the evaluated 0.9.0 API (`.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md:315-327`). Therefore the exact risks are:

- **Split-brain risk:** changing the current Local-only authority marker without a persisted Hindsight lineage/epoch can make the coordinator route to a provider that is not the selected authority.
- **Silent loss/duplicate risk:** using operation completion or source/fact count equality as success misses one-to-many extraction and can duplicate or omit facts after lost acknowledgements.
- **Replica drift risk:** offset pagination or timestamp ordering cannot cover concurrent writes/deletions; a checkpoint advanced before local transaction commit creates an unrecoverable gap.
- **Stale mutation risk:** without remote revisions and `expected_revision`, degraded edits can overwrite newer Hindsight state or force an unsafe merge.
- **Startup fallback risk:** selecting Hindsight from a UI/config health flag rather than the persisted marker can construct dual runtimes or leave legacy writers active.
- **Atomicity risk:** performing filesystem hashing, network calls, or async derived polling inside the activation transaction violates the existing no-async/no-filesystem activation contract and can leave marker/receipt state inconsistent.
- **Layer projection risk:** Hindsight retain-time `tag=true` injection does not automatically update tags when entities are edited in the evaluated API; layer filters can become stale unless the accepted extension repairs tags atomically.
- **Evidence/privacy risk:** remote payloads, API keys, raw Markdown, or source paths must not enter status/log/result envelopes; existing migration privacy boundaries should be retained.

## Reusable Components

- `packages/core/src/memory/memory-provider.ts` and `memory-coordinator.ts`: provider-neutral async contract, authority/lineage checks, capability and envelope validation.
- `packages/core/src/memory/legacy-migration/legacy-snapshot.ts`: immutable source snapshot and manifest.
- `legacy-migration-ledger-repo.ts`: lease-fenced resumable attempts, result mappings, exclusions.
- `legacy-canonical-converter.ts` and `legacy-identities.ts`: sanitizer, deterministic bank/document/operation/memory identity and payload hashing.
- `legacy-canonical-import-repo.ts`: transactional idempotent canonical/FTS import pattern and conflict refusal.
- `memory-authority-fence.ts`: bounded quiescence and successful retirement of old writes.
- `legacy-activation-repo.ts`: digest/readiness/lease guarded short SQLite activation transaction pattern (must be generalized for Hindsight, not copied as-is).
- `runtime-selector.ts`, `runtime-composition.ts`, and authority-aware legacy wrappers: marker-first startup and post-activation legacy retirement.
- B3 `hindsight-client.ts`, compatibility service, bank identity/template/setup repos: authenticated transport, compatibility fingerprint, bank/template prerequisites; keep separate from data-plane migration.

## Missing Pieces / Implementation Boundary

No live TakiAgent implementation currently provides a Hindsight `MemoryProvider`, remote retain/recall/mutation adapter, migration-specific remote operation ledger integration, derived completion polling, cursor-bound logical snapshot, replica checkpoint/journal consumer, Hindsight authority marker/epoch transition, or Hindsight-authority runtime composition. These are the B4 implementation surface. Ongoing journal polling, Pending Memory replay, planned switch-back, automatic foreground recall, and canonical tool exposure remain explicitly out of scope per the B4 PRD (`.trellis/tasks/08-09-hindsight-initial-cutover/prd.md:31-35`).

## Related Specs

- `.trellis/spec/backend/database-guidelines.md:101-189` — migration 021 contracts, lease fencing, deterministic import, marker-first startup, short activation transaction, and no post-activation Markdown fallback.
- `.trellis/spec/backend/quality-guidelines.md` and `.trellis/spec/backend/error-handling.md` — cross-layer validation, bounded/sanitized errors, and test gates.
- `.trellis/spec/guides/source-grounding-guide.md:1-65` — resolve design gaps through named sources, live repo, installed contracts, then report unresolved gaps.
- `.trellis/tasks/archive/2026-08/08-09-memory-provider-foundation/design.md` — provider-neutral Local foundation and explicit exclusion of Hindsight/replica/cutover in B1.
- `.trellis/tasks/archive/2026-08/08-09-memory-legacy-migration/design.md` and `implement.md` — migration runner/ledger/activation responsibilities (archived artifacts; live equivalent is under `packages/core/src/memory/legacy-migration/`).
- `.trellis/tasks/archive/2026-08/08-09-hindsight-connection-setup/design.md` and `implement.md` — B3 authenticated setup, compatibility, template, and authority-preservation boundary.
- `docs/adr/0009-single-memory-authority-with-local-replica.md` — one authority, local replica, no automatic promotion, and atomic cutover policy.

## External References

- Evaluated Hindsight source/API: pinned `0.9.0` snapshot, as cited by `.trellis/tasks/08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md` (retain/document/operation behavior, public logical fields, offset-list limitations, and missing replication contracts).
- B3 compatibility wire contract in `packages/core/src/memory/hindsight/hindsight-contracts.ts:20-47` — required Taki extension versions and provider/storage checks; this is a validation schema, not proof that the data-plane methods exist in TakiAgent.

## Caveats / Not Found

- The active B4 directory contains only `prd.md`, `task.json`, and seed manifests; no B4 design/implementation contract exists yet.
- The expected non-archived `.trellis/tasks/08-09-memory-legacy-migration/design.md` and `implement.md` are absent; archived B2 artifacts and live code were used instead.
- `jbcontext` semantic search was available and used for localization. A delegated semantic explorer failed with a service `503`, so all conclusions were verified by direct reads and line-numbered searches in this thread.
- No TakiAgent code in the live tree exposes a replica checkpoint table, Hindsight data-plane client, or provider implementation. Do not infer these from B3 compatibility schema names; they are advertised contracts, not implemented operations.
- Prior mixed-scope research evaluated Hindsight 0.9.0 source and recorded the missing replication contracts; those claims should be rechecked against the exact accepted compatibility build during implementation.
- The preserved untracked `.backup-memory-legacy-migration-live-20260821-01/` directory was not modified.
