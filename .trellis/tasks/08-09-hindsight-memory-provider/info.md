# Technical Design: Hindsight Memory Provider and Local Replica

## Status

Product semantics are approved and the first supported Hindsight base release is fixed to `0.9.0`. Compatibility
contracts and source evidence are maintained in the compatibility child and the task research files.

Current continuation status (2026-09-06): the main-worktree B5 task remains `in_progress` on baseline `3c67fd5`.
Waves 0-2 have independent offline verification; Wave 2 passed with five fixes; Waves 0-2 are committed as `69ca779`. Its executable
contract is [Memory Replica Sync](../../spec/backend/memory-replica-sync.md), including scheduling/lease ownership,
transaction deadlines, admitted Bank binding, and verified page-cache reuse. Cold or unverified cache records still
require provider page reads. B4 owns current-Local coverage, import completeness, and the final activation fence.
Wave 3 Pending Memory/recovery is outstanding and B6 remains planning; offline verification opens no live gate.
See [B4 current-Local gate](../08-09-hindsight-initial-cutover/design.md),
[B5 sync/recovery plan](../08-09-memory-replica-sync-recovery/implement.md), and [B6 runtime plan](../08-09-memory-runtime-integration/implement.md).
No live acceptance criterion is marked passed by this continuation.

## Design Sources

- `CONTEXT.md` — canonical domain language.
- `docs/MEMORY-DESIGN.md` — current shipped memory behavior and target provider projection.
- `docs/adr/0009-single-memory-authority-with-local-replica.md` — authority, migration, synchronization, degraded operation, tools, setup, and cutover decisions.
- `research/*.md` — live Taki and Hindsight implementation evidence collected for this task.

## Current Integration Seams

The shipped memory subsystem already has useful replacement seams:

- `packages/core/src/memory/bootstrap.ts` is the boot-level composition root for the engine, auto-memory, tidy, compaction, retention, and background model slot.
- `packages/core/src/memory/memory-engine.ts` composes persistence, retrieval, prompt assembly, and model-facing tools behind one `MemoryEngine` surface.
- `packages/core/src/agents/chat-agent.ts` requests stable memory instructions and constructs character-bound tools once per attempt.
- The same chat path already appends dynamic, non-persisted `<turn-context>` data to the current outgoing user projection. Automatic recall belongs in this volatile suffix rather than the day-stable system instructions.
- `packages/core/src/memory/auto-memory.ts` serializes detached per-character post-turn memory work and already separates chat latency from background ingestion.
- `packages/core/src/config/knob-registry.ts`, `packages/core/src/config/config-writer.ts`, and the config protocol provide the non-secret configuration path. Secret values are intentionally refused there and require the OS credential-store path.
- `packages/shared/src/memory-schema.ts` and Core `memory.*` methods provide the existing operator maintenance/status boundary that the new setup and synchronization surfaces can extend.

These seams should be evolved rather than bypassed. The Core remains the sole local database writer and the Pet/Home clients remain non-authoritative projections.

## Target Component Model

```text
Chat / background ingestion / operator actions
                    |
                    v
          MemoryAuthorityCoordinator
          /        |          \
         /         |           \
Write Gate   Context Projector  Memory Tool Contract
         \         |           /
          \        |          /
             MemoryProvider
             /            \
      Local Provider   Hindsight Provider
             \            /
        Canonical Memory Records
                    |
        Local Authority Store / Replica
                    |
       BM25 + optional vector projection

Separate control-plane services:
Migration Service | Replica Sync Service | Setup/Upgrade Service
```

### MemoryAuthorityCoordinator

- Reads one persisted Authority Epoch and active provider selection.
- Routes confirmed reads and writes only to the current Memory Authority.
- Never promotes Local automatically when Hindsight is unavailable.
- Routes Hindsight-outage writes to the durable Pending Memory outbox.
- Exposes provider state and capabilities without changing the model-facing contract.

### MemoryProvider

The ordinary runtime interface should stay small and provider-neutral. Exact field names must follow the supported Hindsight public contract after research.

```ts
interface MemoryProvider {
  readonly kind: "local" | "hindsight";
  capabilities(): MemoryProviderCapabilities;
  health(signal?: AbortSignal): Promise<MemoryProviderHealth>;
  retain(input: RetainRequest, signal?: AbortSignal): Promise<RetainReceipt>;
  recall(input: RecallRequest, signal?: AbortSignal): Promise<RecallResult>;
  reflect(input: ReflectRequest, signal?: AbortSignal): Promise<ReflectResult>;
  mutate(input: MemoryMutationRequest, signal?: AbortSignal): Promise<MemoryMutationResult>;
}
```

Replication, bank administration, manifest export, setup, and upgrades must use narrower optional interfaces instead of inflating every provider implementation:

```ts
interface MemoryChangeSource {
  changesAfter(bank: BankRef, cursor: ChangeCursor): Promise<ChangeBatch>;
  openLogicalSnapshot(bank: BankRef): Promise<LogicalSnapshotDescriptor>;
  readLogicalSnapshotPage(input: LogicalSnapshotPageRequest): Promise<LogicalSnapshotPage>;
}

interface MemoryBankAdmin {
  ensureBank(input: EnsureBankRequest): Promise<BankDescriptor>;
  applyTemplate(input: ApplyTemplateRequest): Promise<TemplateRevision>;
}
```

Every mutable logical record returned by get/list/recall, journal, and snapshot contracts carries an authoritative revision. Provider mutations carry `expectedRevision` where a target already exists and return a typed `applied | already_applied | superseded | not_found` result. Snapshot descriptors bind the integrity manifest and `endCursor` to the same logical view; ordinary offset listing is never treated as replication.

### MemoryContextProjector

- Keeps stable persona, Memory Blocks, pinned rows, and intentions in the existing synchronous instructions path.
- Performs bounded Automatic Memory Recall asynchronously before the model request.
- Queries the Global and active Character banks concurrently.
- Merges, deduplicates against stable visible memory, applies Taki visibility policy, and enforces one shared configurable token/result budget.
- Appends the resulting fenced memory section to the existing transient `<turn-context>` suffix.
- Excludes that suffix from persistence, Write Gate input, Retain input, and conversation compaction.
- Uses an abort-aware deadline. Timeout or provider failure records health diagnostics and continues the turn without recalled memory.

This design preserves the current day-stable instructions/prompt-cache prefix and prevents recall feedback loops.

### MemoryIngestionGate

- Runs only on committed conversation spans.
- Returns `keep | skip`, exact source boundaries, and `global | character | both` in one decision.
- Does not summarize, extract facts, assign within-bank Memory Layers, deduplicate, or consolidate.
- An explicit user request to remember bypasses `keep | skip` but still uses ownership routing and provenance sanitation.
- Produces a provider-neutral `RetainRequest` containing the original safe span and deterministic source identity.

The Local Provider may retain its current local extraction implementation behind `retain`; the Hindsight Provider submits the source to Hindsight. This keeps provider switching outside the gate and avoids embedding Hindsight assumptions in the chat loop.

### MemoryPolicyCurator

- In Local mode, the existing full tidy path remains available until equivalent structured-local behavior is implemented.
- In Hindsight mode, generic extraction, consolidation, observation evolution, graph repair, and mental-model refresh are disabled on the Taki side.
- The reduced curator handles only Taki Memory Layer labels, visibility, retention, Memory Block projection, and exceptional misclassification.
- Every durable Hindsight-mode correction uses the authoritative provider mutation API; the replica is never edited directly.

## Canonical Logical Model

The schema must align with Hindsight's supported public logical model without copying its private PostgreSQL tables. Research must freeze exact public names and identifiers before DDL is authored.

At minimum, the Taki canonical projection needs:

- **AuthorityEpoch** — epoch identity, provider, provider instance lineage, activation time, predecessor, state.
- **MemoryBank** — stable Taki bank identity, provider bank identity, Global/Character scope, user/Character ownership, template revision.
- **MemorySource** — deterministic source/document identity, original safe content or retained source reference, timestamps, content hash, origin, provenance, target banks.
- **MemoryUnit** — provider-stable fact/observation identity, text, public kind/type, lifecycle state, revision, timestamps, source provenance, tags/entity labels, Taki layer, importance/visibility metadata where applicable.
- **DerivedMemory** — observations, mental models, directives, and their public provenance/revision fields.
- **ReplicaCheckpoint** — per-bank provider lineage and monotonic change cursor applied transactionally.
- **PendingMemoryOperation** — idempotency key, bank, operation kind, payload, target identity, expected revision, original time, retry state, terminal state, diagnostics.
- **MigrationLedgerEntry** — legacy source identity, canonical source identity, document operation identity, resulting fact identities, attempts, terminal status, exclusion decision, diagnostics.
- **SyncState** — mode, interval, last attempt/success, failure count, next due/retry, lag/pending counters, full-reconciliation state.

Provider-specific public fields that Taki does not interpret may be retained in a versioned extension payload only when required for lossless round-trip. Private provider rows, credentials, worker queues, and internal indexes are never copied.

## Authority State Machine

```text
LOCAL_AUTHORITY
  -> HINDSIGHT_IMPORTING
  -> HINDSIGHT_VERIFYING
  -> HINDSIGHT_AUTHORITY_HEALTHY
  -> HINDSIGHT_AUTHORITY_DEGRADED
  -> HINDSIGHT_AUTHORITY_RECOVERING
  -> HINDSIGHT_AUTHORITY_HEALTHY

HINDSIGHT_AUTHORITY_HEALTHY
  -> LOCAL_CUTOVER_FENCED
  -> LOCAL_AUTHORITY (new epoch)

HINDSIGHT_AUTHORITY_DEGRADED
  -> EMERGENCY_LOCAL_TAKEOVER (explicit owner action)
  -> LOCAL_AUTHORITY (new epoch)
```

Failed import or verification returns to `LOCAL_AUTHORITY` without repairing a partial authority switch because no switch has occurred. A temporary outage changes health state, not authority.

## Runtime Flows

### Local-only turn

1. Stable memory projection is assembled from Local structured records and Memory Blocks.
2. Automatic recall queries Local BM25 and optional vectors.
3. The model sees the canonical Memory Tool Contract backed by Local.
4. A committed turn enters the Write Gate and Local `retain` path asynchronously.

### Healthy Hindsight turn

1. Stable Taki-owned blocks and policy projection remain local.
2. Automatic recall queries Hindsight Global and active Character banks concurrently.
3. The model sees the same Memory Tool Contract backed by Hindsight.
4. A committed eligible span is retained to the routed Hindsight bank or banks.
5. Replica synchronization remains detached from the chat turn.

### Degraded Hindsight turn

1. Authority remains Hindsight but health is degraded.
2. Confirmed recall uses the last verified local replica.
3. Pending retains/mutations may be added as a clearly unconfirmed recall overlay.
4. New writes are durably queued with idempotency and expected-revision metadata.
5. Chat continues; diagnostics and UI state expose degradation and replica age.

### Recovery

1. Verify authenticated Hindsight health, provider instance lineage, and bank identities.
2. Pull authoritative changes after each Replica Checkpoint and apply each batch transactionally.
3. Replay pending retains normally and replay mutations only when `expected_revision` still matches.
4. Mark stale/missing-target mutations `superseded` without blocking other operations.
5. Wait for or poll the provider's derived-memory completion contract.
6. Pull resulting derived changes and advance checkpoints only after local application succeeds.

### Routine synchronization

- One single-flight worker handles all automatic/manual synchronization.
- Default incremental poll: six hours, persisted across restarts.
- Missed due time: one immediate catch-up on startup/reconnection.
- Automatic retry: one minute, five minutes, fifteen minutes, one hour, then six-hour intervals.
- Manual mode does not create background retries after a failed manual attempt.
- Default full logical reconciliation: every seven days, comparing complete manifests but transferring only differences.

## Initial Migration and Authority Cutover

1. Snapshot the existing Markdown tree as read-only migration input.
2. Dry-run every supported historical format through a deterministic compatibility normalizer.
3. Validate identity, scope, layer, timestamps, lifecycle, content size, hashes, and source provenance.
4. Create deterministic canonical sources and bank-specific document identities.
5. Import idempotently and record every operation/result in the Migration Ledger.
6. Wait for one-to-many extraction and record resulting public fact identities rather than comparing source/fact counts.
7. Build the complete local logical replica and BM25 index.
8. Run logical reconciliation and contract checks.
9. Block cutover for every non-excluded unresolved source or mismatch.
10. Atomically create and activate the Hindsight Authority Epoch.

Original Markdown remains exportable and auditable but never mutates authority after cutover.

## Planned Return to Local

1. Require healthy Hindsight lineage and drain accepted operations.
2. Run final incremental synchronization and full logical reconciliation.
3. Require zero pending operations and zero known replica difference.
4. Fence new writes briefly and queue them.
5. Snapshot the reconciled replica, create a new Local Authority Epoch, and atomically promote it.
6. Replay fenced writes against Local.
7. Keep the former Hindsight epoch as a read-only historical branch.

If Hindsight is unhealthy, this ordinary path is unavailable. Emergency takeover is a separate explicit workflow with missing-interval disclosure and backup capture.

## Hindsight Extension Boundary

Prefer this order:

1. Use Hindsight public APIs and additive native configuration.
2. Implement Taki-only policy in adapters and versioned Bank Templates.
3. Add a small generally useful upstream-compatible extension when a required additive seam is missing.
4. Never copy and freeze Hindsight's complete internal prompts or evolve a full independent fork.

The first compatibility target is exactly Hindsight `0.9.0`. Batch 0 must add and contract-test the following upstream-compatible extensions before any authority cutover:

1. **Additive observation instructions** that preserve Hindsight's native consolidation mission and append a fenced Taki overlay.
2. **Monotonic logical change journal** with ordered upserts and tombstones for every recall-relevant source, including derived memory and administrative mutations included in the replica.
3. **Record revisions and conditional mutation** through `expected_revision`, typed precondition failure, and idempotent mutation identity.
4. **Cursor-bound consistent logical snapshot** whose pages, integrity manifest, provider lineage, and `end_cursor` describe one authoritative view.
5. **Independent extension capability/version handshake** exposed through `/version` or an adjacent compatibility endpoint so a healthy but incompatible server is rejected.
6. **Atomic layer entity/tag synchronization** so editing a controlled `taki-layer:*` entity re-derives or updates its recall-filter tag in the same mutation.

Existing Hindsight operations, deterministic `document_id`, asynchronous `operation_id`, and post-completion document lookup remain the migration substrate. The initial-cutover contract tests must freeze the exact terminal predicate proving that one-to-many extraction and required derived work are safe to snapshot.

The compatibility manifest declares the exact Hindsight `0.9.0` base, immutable deployment identity, extension contract versions, required public endpoints/features, template revisions, and contract-test suite. Broader base-version support is added only after the same suite passes.

## Configuration and Secret Handling

### Non-secret configuration

- Provider mode and endpoint.
- Managed-local versus existing-instance deployment.
- Automatic/manual synchronization mode.
- Incremental and full-reconciliation intervals.
- Recall token/result budget and deadline.
- Default and advanced model identifiers/base URLs where non-secret.
- Optional local embedding/vector settings.
- Supported Hindsight version and Taki template revisions.

### Secrets

- Hindsight API key.
- Model-provider credentials for retain, reflect, consolidation, embedding, and reranking.

Secrets must use the existing or newly completed OS credential-store boundary. They never enter the sparse config table, ordinary logs, memory records, replica, migration exports, or UI caches.

The current repository does not yet provide this complete path: provider credentials are loaded from Core environment variables, while the Rust `SecretStore` currently protects only the desktop node token and device identity. This task therefore includes a provider-neutral secret backend plus operator-only set/clear/presence contracts. Environment variables remain a deployment override; Windows-local storage uses Credential Manager through an OS-specific adapter, while Ubuntu/headless deployment requires a documented restricted backend. Secret values never cross ordinary `config.*` payloads.

Managed Hindsight deployment is also outside Core's OS-neutral boundary. `packages/core` may validate deployment metadata and connect to the resulting service, but Docker/process/filesystem actions must be initiated by the operator through a Shell or dedicated deployment helper. Connecting an already running instance remains fully supported and must not depend on the managed path.

## Operator Surfaces

The setup and operations UI must expose:

- guided deployment/connection validation;
- authenticated health and supported-version checks;
- bank/template creation and migration dry-run preview;
- authority/provider/epoch state;
- sync mode, interval, last attempt/success/checkpoint, lag, pending, failure count, next retry/poll, full reconciliation, and latest safe error;
- immediate incremental sync and full reconciliation actions;
- planned switch-back and separately guarded emergency takeover.

All protocol payloads originate as strict `@taki/shared` zod schemas. Operator clients display state but never become authoritative or hold secrets.

## Implementation Batches

### Batch 0: Hindsight compatibility extensions

- Implement the journal/cursor, revision/CAS mutation, cursor-bound snapshot/manifest, additive observation instructions, extension handshake, and layer entity/tag synchronization in `H:/hindsight`.
- Pin behavior with REST/OpenAPI and upgrade compatibility tests against Hindsight `0.9.0`.
- This batch is a hard prerequisite for connection validation, import verification, synchronization, recovery, and authority cutover.

### Batch 1: Canonical contracts and structured Local Provider

- Provider-neutral schemas, authority state, bank/source/unit records, Local storage, BM25 projection, and compatible tools.
- Deterministic Local behavior tests before any Hindsight dependency is introduced.

### Batch 2: Legacy normalization and Local migration

- Markdown compatibility normalizer, dry-run report, deterministic identities, Migration Ledger, fixtures, and Local authority conversion.

### Batch 3: Hindsight connection, secrets, and guided setup

- Supported-version/extension manifest, authenticated client, health/contracts, bank templates, progressive model setup, provider-neutral secret storage, and operator deployment-helper boundary.

### Batch 4: Initial Hindsight import and atomic authority cutover

- Bank creation, idempotent import, one-to-many mapping, replica build, reconciliation, verification, and atomic epoch activation.

### Batch 5: Incremental synchronization and degraded recovery

- Change cursor, checkpoints, full reconciliation, scheduler/backoff, Pending Memory outbox, replay/supersession, and degraded recall.

### Batch 6: Runtime recall, tool contract, and policy maintenance

- Volatile automatic recall projection, canonical tools and legacy aliases, Write Gate routing, feedback-loop prevention, and reduced Hindsight-mode curator.

### Batch 7: Operations UI, planned switch-back, and emergency takeover

- Setup wizard completion, status panel, manual sync/reconcile, upgrade validation, healthy Local cutover, and guarded disaster takeover.

Each batch maps to the corresponding child Trellis task recorded in the parent PRD. Batch 0 and Batch 1 may proceed independently; later batches follow the dependency graph in `prd.md`. Every batch ends with its provider, migration, contract, or failure-path gates before a dependent task begins.

## Verification Strategy

### Contract tests

- Run against the exact supported Hindsight checkout/version.
- Pin request/response parsing, authentication, lifecycle mutations, bank/template behavior, change ordering, and derived completion.
- Fail closed on unsupported or unexpectedly changed contracts.

### Migration tests

- Representative fixtures for every historical Markdown/frontmatter format.
- One source producing zero, one, or many facts.
- Retry and resume after interruption at every ledger phase.
- Duplicate import prevention and exact exceptional-source diagnostics.

### Synchronization tests

- Incremental changes, deletion/invalidation/restoration, cursor expiry, duplicate batches, partial transaction failure, full-reconciliation repair, startup catch-up, and persisted backoff.
- Outage retains, non-conflicting mutations, stale-revision supersession, restart during replay, and one conflict not blocking others.

### Runtime tests

- Local BM25-only operation without embeddings.
- Optional vector build and sparse fallback.
- Global plus active Character recall, other-Character exclusion, shared budget, deduplication, timeout, partial-bank failure, and no feedback-loop retention.
- Provider-neutral tools, structured errors, capability metadata, legacy-alias invisibility, and historical timeline readability.

### Operator/manual tests

- First-time managed local deployment and existing-instance connection.
- Invalid key, unavailable model, unsupported Hindsight version, failed import, visible stale replica, manual synchronization, recovery, switch-back, and emergency takeover warnings.

## Rollback and Safety Gates

- No Hindsight authority switch before successful migration and reconciliation.
- Back up Hindsight banks/configuration before supported-version upgrades.
- Keep the original Markdown snapshot until migration verification and owner-approved cleanup policy.
- Database migrations require forward tests and an explicit recovery plan; provider cutovers use new Authority Epochs rather than destructive rewrites.
- No implementation batch may silently change authority, discard Pending Memory, expose a secret, or treat an incomplete replica as current.

## Implementation-time Evidence Gates

- Freeze the Batch 0 OpenAPI/schema shapes and prove journal coverage, transaction ordering, tombstones, cursor expiry, revision conflicts, snapshot races, and layer tag reclassification against a live Hindsight `0.9.0` service.
- Verify an immutable Hindsight `0.9.0` deployment artifact and the PostgreSQL/vector dependency identity used by the supported setup path.
- Prove the authenticated `/version`, `/health`, per-bank LLM health, retain/operation, deterministic document lookup, and derived-completion predicate at runtime rather than relying only on source inspection.
- Select and test the supported Windows Credential Manager and Ubuntu/headless secret backends while preserving environment override precedence and zero secret echo.
- Run representative migration, full replica, degraded replay, cursor-reset, staged-upgrade, and rollback tests before enabling an authority switch.

No owner-blocking product decision remains. If implementation uncovers multiple equally valid product behaviors, pause that child task and return only the unresolved choice; ordinary contract details should be resolved from code and tests.
