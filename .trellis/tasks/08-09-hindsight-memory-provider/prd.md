# Hindsight Memory Provider Integration and Local Fallback

## Status

Product requirements were approved during the Hindsight memory design grill. The child tasks record implementation
and acceptance separately against the frozen compatibility target and extension boundary.

Current continuation status (2026-09-08): B5 Waves 0-2 are independently verified and committed as `69ca779`.
Wave 3's implemented offline mechanics passed independent review on base `c3f8bc4` after three fixes and 14 added
regressions; its 38 source/test/index files remain uncommitted. Shared 392, Core 2016, CLI 47, Desktop 548, all TS
typechecks, root lint and isolated Core startup through migration 035 passed. Full Wave 3/B5 recovery is incomplete:
the reviewed baseline uses the older derived-wait rule. The G1 child now implements native-result/local-application
confirmation and native append recovery as an independently reviewed candidate. Final native 69/Shared 396/Core 2036
tests pass, together with the approved actual-source Rust build and four generated-model contracts. Its validation report records precise
offline evidence and the independent live/manual boundaries.
B4 still owns complete frozen current-Local coverage and final-fence revalidation; B6 runtime wiring and owner-approved
live activation remain open. See the [independent review](../08-09-memory-replica-sync-recovery/research/wave-3-review-2026-09-07.md).
The owner approved the nested [recovery-contract follow-up](../09-07-hindsight-recovery-evidence/prd.md), now in progress,
with source-justified minimal provider changes and an in-repository Hindsight patch ledger for future upstream updates.
The later 2026-09-07 [confirmed interoperability direction](../09-07-hindsight-recovery-evidence/grill.md) prioritizes
public logical field alignment, adapters and official extensions, with generic native hooks only for proven gaps.
Canonical Local full maintenance remains required in B6. The owner then accepted routine write confirmation after
reliable native-result proof and local application, with derived maintenance continuing asynchronously. Initial
activation and provider switching keep their independent completion/integrity gates. The earlier approximately
20-file strict proposal is not the selected routine design. G1 acceptance does not complete the parent or B4/B6 gates.
Cross-links: [B4](../08-09-hindsight-initial-cutover/prd.md),
[B5](../08-09-memory-replica-sync-recovery/prd.md), [B6](../08-09-memory-runtime-integration/prd.md).

## Goal

Make Hindsight an optional self-hosted Memory Provider for TakiAgent while preserving Taki-specific companion-memory policy and a fully usable Local Provider. When Hindsight is enabled and the initial migration succeeds, Hindsight becomes the single Memory Authority; the structured local store becomes a synchronized replica and degraded fallback rather than a competing authority.

## Why

Hindsight already provides the professional semantic memory mechanics that Taki's original design planned to approximate: one-to-many fact extraction, semantic retrieval, embeddings, observations, mental models, graph-backed relationships, deduplication, lifecycle mutation, and provider-managed consolidation. Taki should retain only the behavior-shaping policies that are specific to the Companion product instead of maintaining a second general-purpose memory engine.

## Confirmed Product Decisions

- Local is authoritative when Hindsight is disabled.
- Hindsight becomes authoritative only after authenticated health checks, deterministic import, derived-memory completion, local replica construction, and integrity verification succeed.
- Hindsight outages never cause automatic authority failover. Reads degrade to the last verified local replica and writes enter a durable Pending Memory outbox.
- Recovery first pulls remote changes, safely replays pending writes, and confirms each write after native-result proof and local application of its factual effects. Derived maintenance may finish later; its changes arrive through ordinary synchronization. Initial activation and provider switching retain their separate completeness gates.
- Hindsight's latest authoritative revision wins. Stale pending mutations become `superseded`; they are audited but never merged, forced, or presented as an interactive conflict.
- Every Taki user has one Global Memory Bank and one Character Memory Bank per Character-user relationship. Memory Layers are per-memory Taki policy labels, not separate banks.
- Taki's Write Gate performs only `keep | skip` and `global | character | both` routing. It submits the original safe conversation span; Hindsight owns extraction, one-to-many facts, classification, embeddings, deduplication, observations, and semantic maintenance.
- Explicit user requests to remember bypass the eligibility filter but still use ownership routing and provenance rules.
- Hindsight mode disables duplicate general Taki tidy/consolidation. A reduced Memory Policy Curator retains only Taki-specific layer, visibility, retention, and Memory Block projection policy.
- The Agent may edit, invalidate, restore, or reclassify any individual memory without an importance confirmation gate. Bank deletion, bulk clearing, and permanent deletion remain Control Plane operations.
- Both providers use Canonical Memory Records aligned with Hindsight's public logical model. Markdown is retired as runtime storage and remains only a migration snapshot and explicit import/export format.
- Interoperability preserves supported logical identity mappings, source relationships, lifecycle and provenance across provider changes. Align public field names/types where equivalent; do not mirror private PostgreSQL/SQLite schemas or silently drop supported state on a round trip.
- Local authority retains complete Taki maintenance on Canonical Local records. B6 must restore working tidy, retention, background jobs and Memory Block projection; Hindsight mode keeps only Taki-specific policy alongside native semantic maintenance.
- Prefer Taki adapters and supported Hindsight APIs, then official extensions, then minimal generic producer hooks for demonstrated missing guarantees. Source-backed improvements during development are allowed; record the revised design and evidence without silently weakening accepted guarantees or changing supported scope.
- The local replica mirrors logical, recall-relevant state, not Hindsight's private PostgreSQL schema or operational queues.
- Local FTS5/BM25 retrieval is always available. Local embeddings and vector indexing are optional, asynchronous enhancements.
- Agent-facing tools use one Hindsight-aligned Memory Tool Contract. Local implements a compatible subset; Hindsight delegates to its authoritative APIs. Legacy Taki tool names remain non-advertised migration aliases only while executable legacy callers exist.
- Automatic Memory Recall runs before every foreground response against the Global and active Character banks. Results share an initial 1024-token cap, are deduplicated against already-visible memory, are never retained again, and never block chat on failure. Explicit `recall` and `reflect` tools remain available for deeper investigation.
- Automatic replica synchronization uses incremental cursor polling every six hours by default, with persisted catch-up and retry scheduling. Manual incremental synchronization and configurable periodic full logical reconciliation remain available.
- A guided setup flow supports managed local deployment or an existing self-hosted instance. All connections require API-key authentication, including loopback.
- Hindsight model configuration uses progressive disclosure: one default model first, with advanced overrides for retain, reflect, consolidation, embeddings, and reranking.
- Taki Bank Templates are versioned additive overlays on Hindsight native behavior. User overrides remain a separate highest-precedence layer.
- The first supported Hindsight target is exactly `0.9.0`; broader version support is added only after the same compatibility suite passes.
- Taki maintains a minimal Hindsight extension/patch series, not a separately evolved full fork. Batch 0 must provide a versioned change journal/cursor, record revisions with conditional mutation, a cursor-bound logical snapshot/manifest, additive observation instructions, extension capability/version reporting, and atomic layer entity/tag synchronization.
- An upgrade is staged, backed up, contract-tested, and never promoted speculatively.
- A healthy switch back to Local requires final synchronization, full reconciliation, zero Pending Memory, a short write fence, and a new Authority Epoch. Permanent Hindsight loss requires a separately confirmed Emergency Local Takeover.

## Requirements

### R1. Provider-neutral domain and authority state

- Define provider-neutral bank, source, fact, observation, lifecycle, provenance, revision, checkpoint, pending-operation, and authority-epoch contracts.
- Keep Memory Authority selection explicit and persisted.
- Do not leak provider-private database schemas into Taki's canonical model.

### R2. Structured Local Provider

- Replace Markdown runtime writes with a structured local persistence model.
- Preserve Taki Memory Layers, Memory Blocks, Write Gate, retention, and visibility behavior.
- Keep FTS5/BM25 always usable; build optional vectors asynchronously when configured.
- Provide the Memory Tool Contract locally, including structured capability and error metadata.

### R3. Hindsight Provider and compatibility boundary

- Use authenticated public Hindsight retain, recall, reflect, mutation, bank/template, and health contracts where available.
- Pin the first supported base release to exactly Hindsight `0.9.0` and validate the independent Taki extension contract version before setup or cutover.
- Require a complete monotonic logical change journal with tombstones, record revisions and `expected_revision` mutation, a cursor-bound consistent logical snapshot/manifest, additive observation instructions, and atomic `taki-layer:*` entity/tag synchronization.
- Keep Taki policy in adapters and templates; patch Hindsight only for these small missing contracts or other evidence-backed compatibility defects.

### R4. Deterministic migration and cutover

- Normalize every supported historical Markdown/frontmatter variant without partial authority mutation.
- Use deterministic source/document identities and an idempotent Memory Migration Ledger.
- Treat a supported well-formed source failing conversion as an implementation defect.
- Block authority cutover until every non-excluded source, derived mapping, replica checkpoint, and integrity check succeeds.

### R5. Incremental replica synchronization

- Consume an unambiguous monotonic change cursor or journal.
- Apply batches transactionally and advance checkpoints only after success.
- Rebuild or recover a replica from a consistent logical snapshot whose integrity manifest and `end_cursor` describe the same authoritative view.
- Support automatic and manual incremental synchronization plus configurable full logical reconciliation.
- Keep synchronization asynchronous and single-flight; chat and ordinary memory operations must remain usable.
- Expose last attempt, last success, checkpoint, lag, pending count, failure count, error, and next retry or poll.

### R6. Degraded operation and recovery

- Recall confirmed memory from the last verified replica while Hindsight is unavailable.
- Persist new retains and mutations in an idempotent Pending Memory outbox.
- Mark pending content as unconfirmed when included in degraded recall.
- On recovery, pull authoritative changes, safely replay compatible pending operations, verify their actual native results, and pull/apply the factual effects before confirming each write.
- Let Hindsight continue observation/mental-model maintenance natively and synchronize later committed changes. Missing derived-completion evidence does not block a proven factual write; native ambiguity or an unverified local checkpoint still does.
- Expose write confirmation separately from derived freshness, using real provider evidence or an explicit unknown status. Zero pending writes does not imply authority-cutover readiness.
- Replay mutations with `expected_revision`; supersede stale target-revision mutations without applying them or blocking unrelated replay.

### R7. Ingestion, maintenance, and scope policy

- Run one Write Gate decision for eligibility, exact provenance boundaries, and Global/Character/both routing.
- Remove system instructions, injected recall, hidden prompts, secrets, and unsafe oversized tool payloads before Retain.
- Use controlled per-fact `taki-layer:*` labels with `unclassified` fallback.
- Delegate generic consolidation to the authority provider while retaining the narrow Taki Memory Policy Curator.

### R8. Recall and agent tools

- Run bounded Automatic Memory Recall through the active provider before foreground responses.
- Query only the Global and active Character banks by default, merge and deduplicate results, and enforce a shared configurable budget.
- Never persist or re-retain injected recall.
- Keep explicit retain, recall, reflect, edit, invalidate, and restore semantics consistent across providers.
- Never advertise legacy and canonical tool suites simultaneously.

### R9. Guided setup and operations

- Guide the user through deployment type, API endpoint, API key, storage prerequisites, model configuration, health checks, bank creation, templates, and migration preview.
- Store secrets only through Taki's secret-safe configuration path.
- Provide actionable diagnostics without silently changing authority.
- Support backup, compatibility tests, staged upgrade, planned switch-back, and emergency takeover workflows.

### R10. Secret and deployment boundary

- Treat the current provider-key path as an explicit prerequisite gap: Core reads model secrets from environment variables today, while the existing Rust keyring stores only node credentials and device identity.
- Add a provider-neutral secret backend and operator-only set/clear/presence contracts without returning secret values to Core protocol clients, logs, config rows, memory, or UI caches.
- Preserve Core OS neutrality with supported Windows-local and Ubuntu/headless secret backends; environment variables may remain the highest-precedence deployment override.
- Keep Hindsight process, Docker, filesystem, and service-management actions out of `packages/core`. A managed local deployment must be an operator-driven Shell/deployment-helper workflow; Core owns authenticated connection, health, migration, and memory semantics only.
- Connecting an already running self-hosted Hindsight instance must remain independently usable when managed provisioning is unavailable.

## Acceptance Criteria (Evolving)

- [ ] The PRD maps every confirmed design decision to an implementation requirement or explicit out-of-scope item.
- [ ] Research artifacts record current Taki memory integration seams and the exact supported Hindsight API/version contracts.
- [ ] A technical design defines canonical records, provider interfaces, authority state, migration ledger, replica checkpoint, pending outbox, and synchronization state machines.
- [ ] The implementation plan is split into independently verifiable batches with migration and rollback gates.
- [ ] Automated test requirements cover Local-only operation, Hindsight cutover, incremental sync, cursor loss, outage writes, stale mutation supersession, recovery, recall injection, feedback-loop prevention, and switch-back.
- [ ] Manual acceptance covers guided setup, migration preview, sync observability, degraded-state UX, recovery, and emergency takeover warnings.
- [ ] Secret-management acceptance proves set/clear/presence behavior without value echo or persistence outside the supported backend, on both Windows-local and documented headless deployment paths.
- [ ] Managed deployment acceptance proves that Core performs no OS process management and that an existing Hindsight instance remains a first-class setup path.
- [ ] `implement.jsonl` and `check.jsonl` contain all relevant project specs and task research artifacts.
- [ ] Batch 0 Hindsight compatibility extensions are contract-tested before any task may promote Hindsight to Memory Authority.
- [ ] `task.py validate` succeeds before implementation begins.

## Implementation Plan and Child Tasks

| Batch | Child task | Depends on | Deliverable |
| --- | --- | --- | --- |
| 0 | `08-09-hindsight-compatibility-extensions` | Research complete | Minimal Hindsight 0.9.0 extension contract and compatibility tests. |
| 1 | `08-09-memory-provider-foundation` | Research complete | Canonical records, authority state, structured Local Provider, and provider-neutral tool/runtime contracts. |
| 2 | `08-09-memory-legacy-migration` | Batch 1 | Legacy normalizer, deterministic identities, migration ledger, dry-run, and Local structured conversion. |
| 3 | `08-09-hindsight-connection-setup` | Batches 0 and 1 | Authenticated provider client, version/extension handshake, secret backend, templates, and deployment/setup contracts. |
| 4 | `08-09-hindsight-initial-cutover` | Batches 0-3 | Idempotent import, one-to-many mapping, cursor-bound replica build, reconciliation, and atomic authority activation. |
| 5 | `08-09-memory-replica-sync-recovery` | Batch 4 | Incremental replica sync, full reconciliation, Pending Memory, degraded reads, and deterministic recovery. |
| 6 | `08-09-memory-runtime-integration` | Batches 1, 3, and 5 | Automatic recall, canonical tools, Write Gate routing, feedback prevention, and provider-specific maintenance policy. |
| 7 | `08-09-memory-operations-ui` | Batches 3-6 | Guided setup, status/sync controls, upgrade flow, planned switch-back, and emergency takeover UX. |

Batch 0 and Batch 1 may proceed independently. After Batch 1, legacy migration can proceed in parallel with the later portion of connection/setup once Batch 0's compatibility contract is stable. No Hindsight authority cutover is allowed before Batches 0-3 pass their gates.

## Definition of Done

- The approved requirements are implemented through the Trellis implement/check flow.
- Relevant unit, integration, migration, contract, and failure-path tests pass.
- Type checking, linting, and package-level quality checks pass.
- Supported Hindsight deployment and version constraints are documented and verified.
- Migration and rollback procedures are executable and tested against representative legacy memory fixtures.
- New durable conventions and provider contracts are captured in `.trellis/spec/` during closeout.
- Owner-required manual acceptance remains explicitly pending until performed and confirmed.

## Out of Scope

- Reimplementing Hindsight's generic extraction, graph, observation, mental-model, embedding, reranking, or consolidation engine inside Taki.
- Maintaining a long-lived feature-divergent Hindsight fork.
- Active-active Local/Hindsight authority or bidirectional last-write-wins merging.
- Automatic authority promotion during an outage.
- Making local embeddings mandatory.
- Rewriting historical timeline rows only to replace legacy tool-call names.
- Shipping implementation code during this preparation phase.

## Research Conclusions

- The shipped Taki memory system is a synchronous Local-only facade with Markdown authority, rebuildable SQLite/FTS projection, foreground tool-only recall, and detached post-turn maintenance. It has no provider, authority epoch, migration ledger, replica checkpoint, pending outbox, or provider-neutral secret backend.
- Hindsight `0.9.0` directly provides retain, recall, reflect, one-to-many fact extraction, embeddings, observations, mental models, directives, lifecycle curation, templates, operations, health checks, and self-hosted deployment.
- Hindsight `0.9.0` does not expose the complete replication and stale-write contracts required by this PRD. Batch 0 is therefore a hard cutover prerequisite rather than an optional optimization.
- REST/OpenAPI is the provider contract. Native Hindsight MCP tools are not advertised beside Taki's canonical Memory Tool Contract.
- Retain replay uses asynchronous client `operation_id` plus deterministic `document_id`; resulting fact IDs are resolved after terminal completion by deterministic document lookup.
- Hindsight is unauthenticated by default. Taki requires and behaviorally verifies Bearer API-key authentication even on loopback.

## Research References

- [`research/taki-memory-integration-seams.md`](research/taki-memory-integration-seams.md) — live Taki memory, prompt, maintenance, secret, deployment, and operator integration seams.
- [`research/hindsight-api-deployment-contracts.md`](research/hindsight-api-deployment-contracts.md) — exact Hindsight 0.9.0 REST, authentication, model, deployment, lifecycle, and compatibility contracts.
- [`research/hindsight-integration-gaps-and-sync.md`](research/hindsight-integration-gaps-and-sync.md) — native/provider/patch ownership, required synchronization extensions, migration mapping, degraded recovery, and upgrade gates.

## Technical Notes

- Domain glossary: `CONTEXT.md`.
- Current and target memory design: `docs/MEMORY-DESIGN.md`.
- Authority, migration, synchronization, failure, setup, and tool decision: `docs/adr/0009-single-memory-authority-with-local-replica.md`.
- Local Hindsight checkout: `H:/hindsight`.
- Existing shipped memory task: `.trellis/tasks/archive/2026-08/07-28-memory-context/`.
- Existing WebSocket task remains `in_progress` and unarchived for later owner manual acceptance; this task must not alter its files or claim its acceptance.

## Open Questions

No owner-blocking product question is currently known. Technical unknowns must be resolved from the live Taki and Hindsight repositories and persisted as research rather than returned to the owner unless multiple equally valid product choices remain.
