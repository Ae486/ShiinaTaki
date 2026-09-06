# Runtime Baseline for Replica Sync and Recovery

Date: 2026-09-05. Read-only baseline for B5/B6 planning; no production changes are implied.

## Verified seams

- `packages/shared/src/memory-provider-envelope-schema.ts` defines `MemoryResult<T>` with a completed-only
  `RetainResult`, an error under `error.code`, and provider/authority/capability identity fields.
- `packages/shared/src/memory-provider-operation-schema.ts` defines `MutationResult` as `applied | unchanged`; retain
  requires at least one memory result. These are insufficient for pending, zero-result, superseded, unknown, cancel,
  and two-bank partial-progress outcomes.
- `packages/shared/src/memory-provider-domain-schema.ts` already names `MEMORY_OPERATION_CANCELLED` and
  `MEMORY_OUTCOME_UNKNOWN` and carries retry/next-action policy. The governed-tool projection must read the canonical
  nested `error.code`; current top-level-only readers can misclassify both codes as generic tool failure.
- `packages/core/src/memory/runtime-composition.ts` selects Local/legacy runtime from the persisted authority marker and
  explicitly throws when Hindsight authority is selected without an installed runtime. B6 must wire a real provider and
  coordinator rather than weaken this fail-closed behavior.
- `packages/core/src/harness/run-snapshot-capture.ts` snapshots extension, governance, approval, and memory identity/
  capabilities at admission and returns the exact executable context separately. B6 must make provider/coordinator and
  capability snapshots use the same immutable RunSnapshot; no live re-resolution during a run.
- `packages/core/src/memory/hindsight/hindsight-replica-builder.ts` and `packages/core/src/db/hindsight-replica-repo.ts`
  already stage and publish cursor-bound records/checkpoints atomically for B4 bootstrap, but the reader surface only
  returns identity/revision/hash projections. B5 needs a safe full-record projector and ongoing journal upsert/tombstone.
- `packages/core/src/db/migrations/index-list.ts` currently ends at migration 032. Recheck this before assigning any
  migration work; do not assume a later schema exists.

## Consequences for B5

The first production slice must use one Bank and a verified snapshot at cursor C, apply an ordered journal upsert or
tombstone, publish replica rows, FTS, and checkpoint in one transaction, then close/reopen and read the full canonical
record. Pending replay is a B5 concern and must not be hidden inside a generic effect replay loop. Remote snapshot expiry
does not invalidate a previously verified local checkpoint.

## Consequences for B6

Automatic foreground recall joins the ephemeral outgoing `<turn-context>` before request-preparation measurement and is
excluded from timeline, summaries, compaction gates, retain payloads, and Write Gate input. Primary-only conversational
auto-ingestion is distinct from delivered autonomous speech provenance and silent control outcomes. Hindsight durability
uses `MemoryFlushPort` before retirement; Local policy/maintenance completeness and the narrow Hindsight curator stay in
B6.
