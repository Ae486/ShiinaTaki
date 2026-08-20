# Canonical Memory Provider Foundation

## Status

Planning complete for review. This is an L2 backend foundation task. It does not activate the canonical provider,
replace a production workspace, or connect to Hindsight.

## Goal

Introduce provider-neutral canonical memory contracts and a structured Canonical Local Provider that remains fully
usable with no Hindsight service and no embedding model. The foundation must align with Hindsight's public logical
model and accepted Taki compatibility extension while preserving Taki-specific layer, visibility, retention, and
always-visible Memory Block policy.

## Dependencies

- Parent decisions and research under `.trellis/tasks/08-09-hindsight-memory-provider/`.
- `docs/MEMORY-DESIGN.md` and ADR 0009.
- Accepted Slice 0 compatibility contract under
  `.trellis/tasks/archive/2026-08/08-09-hindsight-compatibility-extensions/`.
- No Hindsight runtime or network dependency. Batch 1 may be implemented independently of later connection/cutover
  work now that the logical compatibility contract is known.

## Requirements

### R1. Canonical provider-neutral domain

- Define strict TypeScript/Zod contracts for Canonical Bank, source document, memory unit, derived memory,
  provenance, lifecycle, revision, Taki policy projection, provider capabilities, typed errors, and operation/tool
  envelopes.
- Align Bank/document/memory-unit/mental-model/directive fields with Hindsight's public logical model and Slice 0
  extension names where they represent the same concept. Taki-only fields remain explicitly separate projections.
- Keep provider IDs and logical payloads opaque. Do not expose or copy Hindsight-private PostgreSQL tables,
  transaction queues, embedding tables, or worker state.

### R2. Persisted Local authority foundation

- Persist one active Local Authority Epoch, provider-instance lineage, and epoch lineage/history. Reopening the database
  returns the same epoch and provider lineage.
- Every canonical Local source, memory unit, derived record, and mutation is scoped to the active epoch and Bank.
- Batch 1 supports Local authority only. It must reject authority/epoch mismatches and must not silently fail over,
  promote Hindsight, or implement authority switching.

### R3. Structured Canonical Local Provider

- Store new canonical Banks, sources, memory units, derived records, revisions, provenance, lifecycle, policy
  projections, operation receipts, and Memory Blocks in Core-owned SQLite tables.
- Canonical provider writes never use Markdown. Markdown is import/export/migration material only.
- Local retain is deliberately simple: it persists the sanitized source and one canonical memory unit without trying
  to reproduce Hindsight extraction, graph, observation, mental-model, reranking, or consolidation behavior.
- Canonical document-to-unit mapping supports one-to-many records, and observation lineage is normalized and scoped to
  the same Authority Epoch and Bank even though Local retain creates only one unit.
- Individual edit, invalidate, restore, and layer reclassification use optimistic revision checks and reversible
  lifecycle semantics. Permanent deletion and bank-wide administration are not agent tools.

### R4. Search and optional vectors

- Provide an always-available FTS5/BM25 sparse projection over valid canonical memory units, including CJK
  application-segmented search terms.
- The sparse projection is transactionally current for ordinary writes and completely rebuildable from canonical
  structured records.
- Define an optional asynchronous vector projection/search seam. Missing configuration, projection lag, or vector
  failure leaves sparse recall complete and available. Batch 1 does not add an embedding dependency or vector engine.

### R5. Taki policy preservation

- Preserve the layer registry as the policy source. Persist each record's resolved layer, importance, visibility,
  disclosure, origin, and retention projection separately from provider-generic fact semantics.
- Preserve the registry's actual ownership and retention semantics; a classified layer must match its Bank scope, and
  rolling, expiring, and importance-decay parameters must not be reinterpreted by provider-generic code.
- Project exactly one controlled `taki-layer:<layer-id>` tag for a classified memory, with `unclassified` fallback.
  Reclassification updates the Taki projection and provider-facing tag atomically.
- Replace canonical Memory Block runtime Markdown with structured Core-owned policy documents. Blocks retain registry
  ownership/writer/header/budget semantics, remain always-visible, and never enter FTS or provider-generic facts.

### R6. Async provider/coordinator contract

- All provider and coordinator operations are Promise-based from the first implementation, although Local SQLite
  transactions remain synchronous internally.
- Internal call context carries cancellation/deadline signals for later network substitution without exposing them to
  model tool schemas.
- The coordinator validates the persisted authority epoch, checks capabilities, calls exactly one authority provider,
  and normalizes unexpected failures into typed envelopes. It never chooses another provider on failure.
- Define provider-neutral retain, recall, reflect, edit, invalidate, and restore requests. Local may advertise a
  compatible subset; unsupported operations return a typed non-retryable capability result.

### R7. Canonical tool contract without production activation

- Define isolated model-tool adapters using Hindsight-aligned names and semantics: `retain`, `recall`, `reflect`,
  `update_memory`, `invalidate_memory`, and `restore_memory`.
- Tool inputs never ask the model to invent provider or authority identities. Runtime-generated request IDs and the
  active epoch travel in the internal call context.
- Tool results use one strict success/error envelope with provider, authority epoch, capability, retryability, and
  next-action metadata. Recall content remains bounded and untrusted observed content remains fenced.
- Capability filtering prevents unsupported tools from being advertised. Legacy and canonical tool suites are never
  advertised together.

### R8. Activation boundary

- Batch 1 creates and proves the structured provider, repositories, schemas, migration, coordinator, and isolated
  canonical tool adapters, but leaves the current `createMemorySubsystem`/`createMemoryEngine` production path on
  legacy Markdown authority.
- There is no dual-write between legacy and canonical stores.
- Existing workspaces switch only after Batch 2 normalizes and migrates supported Markdown, verifies completeness,
  and explicitly activates the canonical Local Provider.
- Applying the additive schema migration before Batch 2 may create empty canonical tables, but must not create
  canonical memories from legacy files or alter the current tool/runtime behavior.

## Acceptance Criteria

- [x] Strict shared schemas validate the complete canonical domain, capability/error envelopes, and all six operation
  request/result families; malformed, extra, and contradictory fields are rejected.
- [x] A fresh canonical Local Provider creates or reuses one persisted Local Authority Epoch and remains fully usable
  after database reopen with no Hindsight endpoint, API key, model, or embedding configuration.
- [x] Canonical retain creates a structured source, one memory unit, provenance, Taki policy projection, sparse index
  row, and idempotent receipt atomically; no canonical write creates or modifies a Markdown file.
- [x] Exact request replay returns the recorded success, request-ID reuse for different work returns a typed conflict,
  and a failed transaction leaves no partial source/unit/policy/index/receipt state.
- [x] Edit, invalidate, restore, and reclassify enforce `expectedRevision`; a stale request changes nothing and returns
  the current revision in a typed precondition result.
- [x] Document-to-many-unit mapping, same-Bank/epoch observation lineage, derived payload identity, classified
  layer/Bank ownership, and exact layer-registry retention projection are constraint- and roundtrip-tested.
- [x] Sparse recall is bounded, Bank/epoch scoped, active-lifecycle filtered, CJK-capable, and works with vector support
  absent or failing.
- [x] Deleting and rebuilding the canonical FTS projection produces equivalent sparse results from canonical records.
- [x] Structured Memory Blocks preserve global/per-character scope and registry writer policy, render in deterministic
  registry order, and are absent from canonical FTS and generic memory-unit queries.
- [x] Coordinator/provider methods are async-compatible, expose stable capability snapshots, reject authority mismatch,
  and never perform implicit provider fallback.
- [x] Isolated canonical tool tests prove Hindsight-aligned names, capability filtering, bounded/fenced results, and one
  structured envelope. No production turn advertises both the legacy and canonical suites.
- [x] Existing legacy memory, tool, block, assembler, auto-memory, and compaction regression suites remain green; the
  production composition root continues using legacy Markdown until Batch 2.
- [x] The additive SQLite migration, reopen behavior, constraints, indexes, and rollback-on-error paths are covered by
  focused tests, and full Shared/Core typecheck, lint, tests, and diff checks pass.

## Definition of Done

- `@taki/shared` and Core contain the reviewed schemas, repositories, provider/coordinator interfaces, Local
  implementation, sparse projection, optional-vector seam, structured block store, and isolated canonical tools.
- Focused red-green tests and full package gates pass.
- A final xhigh Trellis check confirms schema/data-flow/tool/privacy/activation boundaries.
- Durable implementation conventions discovered during coding are recorded in `.trellis/spec/` during closeout.
- Batch 2 receives an explicit activation handoff: canonical tables/factory are ready, production remains legacy,
  and no workspace has been partially migrated or dual-written.

## Technical Approach

Use new, distinctly named SQLite tables and modules beside the legacy engine. The Local Provider owns canonical
transactions and a rebuildable FTS projection; a provider-neutral coordinator owns authority validation and envelopes.
Hindsight-aligned logical fields live in the canonical record, while Taki layer/visibility/retention/Block policy lives
in a separate Core-owned projection. Public operations are async-compatible from the start. `design.md` freezes the
schemas, DDL, interfaces, flows, and transaction rules; `implement.md` sequences small tracer-bullet waves.

## Decision (ADR-lite)

**Context**: Batch 1 must replace the long-term Markdown design without prematurely switching existing workspaces or
reimplementing Hindsight.

**Decision**: Build a dormant structured Canonical Local Provider alongside the legacy production subsystem. Use one
authority epoch, one transactional canonical store, one rebuildable sparse projection, and one async provider contract.
Memory Blocks become structured Taki policy documents rather than facts. Batch 2 alone owns migration and activation.

**Consequences**: Batch 1 adds an empty additive schema to ordinary startup but changes no memory behavior. There is
temporary code coexistence, intentionally without dual-write. Later Hindsight and runtime batches can adopt the same
contracts without breaking tool/runtime APIs, while legacy rollback remains simply "do not activate canonical."

## Out of Scope

- Legacy Markdown conversion, migration ledger, dry-run, cutover, or canonical activation.
- Hindsight HTTP/client/setup/authentication, Bank templates, extension handshake, or network tests.
- Replica checkpoints, change cursors, logical snapshots, pending outbox, degraded recovery, authority switching, or
  emergency takeover.
- Provider secret configuration or adoption of the existing Secret Catalog.
- Automatic foreground recall, volatile turn-context injection, Write Gate rewiring, generic maintenance replacement,
  or production prompt/tool-suite replacement.
- Embedding configuration, model calls, vector database dependency, hybrid-weight calibration, or Hindsight-like
  extraction/consolidation.
- Operator UI, import/export UI, bank administration, bulk clearing, or permanent agent deletion.

## Research References

- [`research/current-local-memory-seams.md`](research/current-local-memory-seams.md) - current Markdown authority,
  SQLite projection, tool, block, maintenance, runtime, and secret-adjacent seams.
- [`../08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md`](../08-09-hindsight-memory-provider/research/hindsight-integration-gaps-and-sync.md)
  - canonical/provider/authority responsibilities and Hindsight mapping rationale.
- [`../08-09-hindsight-memory-provider/research/hindsight-api-deployment-contracts.md`](../08-09-hindsight-memory-provider/research/hindsight-api-deployment-contracts.md)
  - public retain/recall/reflect/tool contracts and supported logical fields.
- [`../08-09-hindsight-memory-provider/research/batch0-hindsight-source-exploration.md`](../08-09-hindsight-memory-provider/research/batch0-hindsight-source-exploration.md)
  - accepted extension logical objects, revisions, and compatibility boundary.
