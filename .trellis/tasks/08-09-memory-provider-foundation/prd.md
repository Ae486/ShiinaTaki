# Canonical Memory Provider Foundation

## Goal

Replace the Local-only Markdown facade with provider-neutral canonical contracts and a structured Local Provider that remains fully usable without Hindsight or embeddings.

## Dependencies

- Parent PRD, technical design, and Taki integration-seam research.
- No Hindsight extension dependency; this task may proceed in parallel with Batch 0.

## Scope

- Canonical bank, source, memory-unit, derived-memory, provenance, lifecycle, revision, and capability schemas.
- Persisted Authority Epoch and provider-neutral coordinator boundaries.
- Structured Local authority store owned only by Core.
- Rebuildable FTS5/BM25 projection and an optional asynchronous vector seam.
- Provider-neutral retain/recall/reflect/mutation and canonical Memory Tool Contract envelopes.
- Taki Memory Layer, Memory Block, visibility, retention, and error-policy preservation.

## Acceptance Criteria

- [ ] Local-only memory works with no Hindsight and no embedding model configured.
- [ ] Markdown is no longer used for new runtime writes.
- [ ] Sparse indexes are rebuildable from canonical structured records.
- [ ] Authority, capability, revision, and error states cross shared/Core boundaries through validated schemas.
- [ ] Existing Taki policy invariants have deterministic unit and integration coverage.

## Out of Scope

- Legacy data conversion and migration ledger execution.
- Hindsight network connection, setup, cutover, or replica synchronization.
- Automatic foreground recall and final operator UI.
