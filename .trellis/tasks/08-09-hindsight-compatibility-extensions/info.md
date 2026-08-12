# Technical Execution Plan: Hindsight Compatibility Extensions

## Status

Batch 0 is active. Slice 0A passed Leader acceptance on 2026-08-10, and PostgreSQL Slice 0B passed Leader acceptance on 2026-08-11. Slice 0C is now the remaining implementation slice: capability and public contract routing, HTTP/OpenAPI, generated clients, and the final combined compatibility gate. Source exploration proved that the six compatibility contracts span prompt/config plumbing, authoritative curation transactions, database migrations, all logical writer families, snapshot materialization, extension routing, OpenAPI, and generated clients. The work is therefore executed as three sequential internal slices under this one Trellis child task. No slice may advertise partial compatibility.

## Frozen Base

- Hindsight API/package version: `0.9.0`.
- Current inspected source commit: `4b2041eb3de5c4235f4a3dd5619fc47cce782e29` on local `main`.
- The checkout is not yet proven to be the immutable `v0.9.0` Git tag; compatibility evidence must retain the exact commit/build identity.
- Initial Taki replication compatibility is PostgreSQL-only unless Oracle support is separately implemented and tested. Unsupported dialects must fail closed and must not advertise the extension.

## Slice 0A: Curation Contracts

Scope:

- Additive fenced observation instructions while preserving existing retain and `observations_mission` semantics.
- Authoritative record revisions exposed by get/list responses.
- `expected_revision` conditional mutation and mutation-identity idempotency.
- Typed stale-precondition behavior with zero partial mutation.
- One continuous revision across edit, invalidate, and restore.
- Atomic controlled `taki-layer:*` entity/tag re-derivation with unrelated-tag preservation.

Gate:

- Focused public-behavior RED-to-GREEN evidence for every contract.
- No compatibility capability or extension manifest is advertised.
- Focused tests plus Ruff, format check, and `ty` pass for touched code.

Leader acceptance evidence (2026-08-10):

- Additive observation policy, continuous revision/CAS/idempotency, and controlled entity/tag projection are implemented without journal, snapshot, manifest, or capability-advertising behavior.
- Follow-up audit fixed two boundary defects: complete bank-lifetime deletion now clears mutation receipts while individual memory/data deletion preserves them, and repeating an identical invalidation reason is a no-op that does not advance revision.
- Concurrent same-mutation replay/conflict tests prove that one committed canonical receipt wins; bank recreation starts a fresh mutation-ID namespace.
- Implementer no-real-LLM regression: 275 passed. Seven excluded real-LLM entity-label cases require an operator API key and are not deterministic Slice 0A gates.
- Leader independent focused rerun: 14 passed (`test_taki_conditional_curation.py` and `test_taki_observation_instructions.py`).
- Leader independent migration/DAG/backup rerun: 206 passed, 96 skipped. Native curation/HTTP/template rerun: 64 passed.
- Ruff check, Ruff format check, scoped `ty`, and `git diff --check` passed. Windows reported only non-failing LF-to-CRLF warnings for three existing example/doc files.
- Canonical OpenAPI, bank-template schema, and generated clients are intentionally stale until Slice 0C; therefore Slice 0A is internally accepted but the combined compatibility patch is not yet CI/merge ready and must not advertise capability.

## Slice 0B: Replication Journal and Logical Snapshot

Depends on Slice 0A revisions.

Scope:

- PostgreSQL migration for provider lineage, per-bank cursor state, append-only logical changes, mutation receipts, and materialized snapshot metadata/pages.
- Commit-visible cursor allocation through a locked per-bank lineage row; no advisory locks and no unconstrained sequence ordering claim.
- Same-transaction publication for every frozen logical writer family in the source-exploration research.
- Upserts and explicit tombstones for bank, document, memory unit, mental model, and directive objects.
- Bank-deletion tombstones that survive deletion of the bank row.
- Cursor retention/expiry and typed reset-required behavior.
- Repeatable-read logical snapshot materialization with stable IDs/revisions, invalidated state, immutable pages, hashes/counts, provider lineage, and `end_cursor`.
- Backup/restore and pre-extension migration coverage.

Gate:

- Complete writer-coverage tests, rollback exclusion, cursor ordering, tombstones, pagination, expiry, and concurrent snapshot boundary tests pass.
- Capability remains unadvertised if any writer family is incomplete.

Accepted internal checkpoints (2026-08-10 through 2026-08-11):

- Journal core: durable provider lineage and Bank generation, commit-visible cursor allocation, rollback exclusion, soft-limit pagination that never splits a transaction batch, retention/reset-required behavior, repeatable-read change-feed reads, and Bank delete/recreate lifecycle behavior are implemented. The journal migration has no `banks` foreign key on durable Bank state, so a lifetime tombstone survives hard deletion.
- Canonical document payloads exclude `original_text` and private retain parameters. Only stable identity, hash, tags, explicitly public metadata/observation scopes, and timestamps are serialized. Memory-unit upserts use the authoritative persisted revision; permanent tombstones carry the revision of the row actually deleted.
- Explicit curation/document writers use one outermost caller-owned accumulator and one journal append per authoritative transaction. The frozen lock order is `replication_bank_state FOR UPDATE` (multi-Bank order sorted by Bank ID) -> canonical rows -> mutation or `DELETE ... RETURNING` -> canonical change accumulator -> journal append -> commit. No advisory lock was introduced.
- Deterministic two-connection regressions proved and fixed four races: stale single-delete revision, tombstoning an observation deleted by another transaction, late/inverse locking between document delete and update, and bulk deletion using a lifecycle snapshot taken before concurrent invalidation.
- Document update emits one document upsert plus revisioned live/invalidated memory upserts and derived-observation tombstones in one batch; true no-op tag replay is quiet. Document delete, data-only clear, and hard Bank delete emit complete ordered tombstone batches. The durable Bank lifetime tombstone is last, and forced journal-publication failure rolls back canonical state, revisions, cursor allocation, and journal rows together.
- Cross-dialect audit preserved the native non-replication junction-table path: only PostgreSQL replication uses the atomic array-overlap `DELETE ... RETURNING` path. Unsupported backends use portable scalar deletion/reset operations and never receive Taki revisions or journal serialization.
- Observation maintenance is journal-complete for `clear_observations`, `clear_observations_for_memory`, and `retry_failed_consolidation`. PostgreSQL replication acquires the Bank-state lock before canonical mutation, emits observation tombstones and only revisioned source upserts for rows that actually changed, appends one authoritative batch per transaction, and keeps exact replay cursor-quiet. Forced append failure rolls canonical state, revisions, cursor allocation, and journal rows back together; a two-writer regression proves clear/retry serialize on the same Bank lock. Native SQL and alternative-store paths retain their pre-replication semantics.
- Retain replacement, streaming, recovery, delta, and metadata-only writers are journal-complete at transaction granularity. Fresh Bank creation publishes a standalone Bank-only batch; connection-bound creation contributes one pending Bank upsert to the caller accumulator. Every PostgreSQL SQL-row-owned retain transaction takes the Bank-state lock before document/canonical rows, publishes outgoing live/invalidated tombstones, derived-observation changes, survivor revisions, the final document projection, and inserted facts in canonical order, and appends exactly once. Pure removed-only delta, post-extraction hash-race fallback, exact metadata replay, rollback of canonical/outbox/journal state, and alternative-store journal exclusion are covered. Native non-replication behavior remains unchanged.
- Leader independent retain acceptance: 13 retain replication contracts, 189 journal/curation/observation/conditional/alternative-store regressions, 27 native delta-retain regressions, and 26 observation-invalidation regressions passed. Scoped Ruff, Ruff format check, `ty`, and `git diff --check` passed. The first Leader rerun exposed an order-dependent test assumption: multi-transaction streaming fallback was incorrectly asserted as one document-bearing batch. The test now scopes mutable configuration with `monkeypatch` and verifies the complete cursor range, per-transaction batch envelopes, unique logical object keys, canonical ordering, and final serialized state. No product publication defect was found.
- Retain follow-up before capability advertisement: add dedicated journal regressions for the zero-fact first-consumer recovery seam and the post-loop no-batch recovery seam; add a direct Oracle end-to-end retain assertion if an Oracle test environment is available. Before instrumenting the next writer families, prefer a duplicate object-key fail-fast guard at the shared journal append boundary rather than silent last-write-wins normalization.
- Leader independent final focused rerun: 27 passed (portable non-replication fallback plus 16 curation and 10 journal tests). Leader independent native non-real-LLM rerun: 77 passed, 3 deselected. The three excluded `hs_llm_core` document tests require `HINDSIGHT_API_LLM_API_KEY`; the implementer confirmed their unexcluded setup errors were missing-key failures rather than product assertions.
- Leader independent observation-maintenance acceptance: 64 passed across the new 5-test contract suite, 26 curation/journal regressions, 26 native observation-invalidation regressions, and 7 history/cache/portable-store/recovery regressions. Scoped Ruff, Ruff format check, `ty`, and `git diff --check` all passed. The only runtime notice was the existing missing `H:\hindsight\.env` warning; these deterministic database tests did not require real LLM credentials.
- Earlier Slice 0B migration/DAG/backup gate remains green: 206 passed, 96 skipped. Scoped Ruff, Ruff format check, `ty`, and `git diff --check` passed; Windows emitted only non-failing LF-to-CRLF warnings on existing dirty files.
- Consolidation create/update/fold/dedup is journal-complete for direct observation create/update/delete, create-time fold, update-time fold/delete, and source success/failure markers. PostgreSQL replication is gated by both backend capability and SQL-row ownership; every authoritative transaction takes the Bank-state lock before canonical rows and appends once. Update-fold revalidates connection-free adjudication, publishes the victim tombstone before the survivor upsert, and exact no-ops remain revision/cursor quiet. Source markers are conditional and mutually exclusive, preserve `updated_at`, and roll back canonical and journal state together. The shared append boundary rejects duplicate logical object keys before Bank locking or cursor allocation.
- Leader independent consolidation acceptance: an `xhigh` read-only audit returned ACCEPT with no must-fix findings. Leader focused rerun passed 15 tests; the impacted journal/curation/conditional/observation-maintenance suite passed 56 tests; the native consolidation combination passed 140 tests with 13 real-LLM cases deselected. Scoped Ruff, Ruff format check, and `git diff --check` passed. Two newly introduced `ty` diagnostics were fixed without runtime behavior changes; replication passes scoped `ty`, and a strict consolidator comparison reports zero new diagnostics while retaining seven pre-existing Optional/embedding baseline diagnostics. The existing missing `H:\hindsight\.env` notice is non-failing; Oracle end-to-end coverage remains unavailable.
- Transfer document/observation import and Bank restore are journal-complete for PostgreSQL SQL-row-owned replication. Slow embedding and entity resolution remain outside the short write transaction; the write path locks Bank state before final `skip`/`new-id` conflict revalidation, canonical mutation, lifecycle restoration, final authoritative serialization, and one journal append. Concurrent losers are cursor-quiet, `new-id` selects an actually absent identity under the lock, and the final identity consistently drives outbox, canonical rows, result/remap state, and observation ref mapping. Bank restore revives durable generation and publishes the actual target Bank identity in the same transaction as the Bank row and index creation. Forced append failures roll back canonical, outbox, Bank-state, cursor, and journal state. Portable transfer archives continue to exclude provider lineage, cursor/journal state, Bank replication state, and mutation receipts; non-PostgreSQL and alternative-store paths retain native behavior and do not publish replication changes.
- Leader independent transfer acceptance: a repaired-TOCTOU `xhigh` read-only audit returned ACCEPT with no must-fix findings. Leader focused rerun passed all 15 transfer replication tests, including deterministic concurrent `skip`/`new-id`, rollback, Bank generation revival, and non-replication/alternative-store exclusion contracts. Scoped Ruff, Ruff format check, `ty` for `importer.py`, and full `git diff --check` passed. The existing missing `H:\hindsight\.env` notice is non-failing for this deterministic database suite. Mental-model and directive restore publication are intentionally not claimed by this checkpoint.
- Mental-model, directive, and remaining Bank/config writers are journal-complete for PostgreSQL SQL-row-owned replication. Mission merge keeps LLM work connection-free and reuses the locked mission persistence path; mental-model create/update/refresh/clear/delete, directive create/update/delete, knowledge-subtree deletion, Bank disposition/profile/mission/config mutation, and hard Bank deletion all fail closed on missing or unsupported replication capability, acquire the Bank-state lock before canonical mutation, publish at most one authoritative batch, and keep exact replay cursor-quiet. Hard Bank deletion publishes deterministic `document -> memory_unit -> mental_model -> directive -> bank` tombstones, with the durable Bank lifetime tombstone last. Transfer resource restore publishes only rows actually inserted by its transaction. Replication append failure rolls back the affected canonical transaction after a real append, while earlier committed transfer phases remain durable; native non-replication and alternative-store paths retain their prior acquire-only behavior.
- Leader independent admin-writer acceptance: the repaired checkpoint received ACCEPT from both an `xhigh` read-only audit and the required `xhigh` Trellis check. Both agents used `jbcontext` for semantic cross-checking and did not use YCE. Leader focused rerun passed 40 admin/transfer replication tests; the native mental-model/directive/config/Bank/transfer bounded gate passed 108 tests with eight real-LLM `hs_llm_core` cases deselected; the impacted journal/curation/conditional/observation-maintenance gate passed 42 tests. Scoped Ruff, Ruff format check, scoped `ty`, and full `git diff --check` passed. The existing missing `H:\hindsight\.env` notice and Windows LF-to-CRLF warnings are non-failing. Oracle end-to-end coverage remains unavailable, so replication remains PostgreSQL-only.
- Repeatable-read logical snapshots are materialized from one PostgreSQL MVCC view into immutable metadata and page rows. The view fixes provider lineage, Bank generation, `end_cursor`, and canonical Bank/document/live-and-invalidated-memory/mental-model/directive records together. Stable ordering and compact sorted-key UTF-8 JSON drive per-page SHA-256 hashes, per-kind/state counts, total/page counts, and a manifest hash; page reads are immutable and cursor-quiet. Creation is atomic, bounded by page-size and TTL limits, rejects missing/deleted Banks, fails closed for missing/raising/unsupported replication capability and alternative stores, and supports idempotent expiry cleanup. Snapshot operational tables participate in full backup/restore and remain excluded from portable Bank transfer.
- The snapshot migration is one unpublished forward revision, `f7d0a5c3e9b2`, which directly creates the final schema without a foreign key to mutable `replication_bank_state`; the immutable provider-lineage foreign key remains. An `xhigh` audit rejected an interim immediate add/remove FK chain and Ruff drift; both were repaired before acceptance. A fresh isolated schema upgrades from base to the single `f7` head, and no `f8` source or reference remains.
- The two retained follow-up contracts are complete: zero-fact first-consumer recovery and post-loop no-batch recovery publish the preserved canonical projection exactly once, and exact replay remains cursor-quiet. They required tests only and no new production behavior.
- Leader independent Slice 0B final acceptance: the repaired snapshot checkpoint received `ACCEPT` from the `xhigh` read-only re-audit and the required `xhigh` Trellis check. The first check turn violated the user tool rule by invoking YCE; the command failed remotely and used a read-only local fallback with no source/config/index/database write or upload. Its conclusion was not used as final process evidence. The same `xhigh` check then completed a clean confirmation turn using `jbcontext`, direct reads, and `rg`, with zero YCE use, and returned `ACCEPT` without edits.
- Leader final rerun passed 30 snapshot/retain/journal/backup contracts, eight checks plus four expected skips across the four new migration shapes, and four DAG/backup-schema/portable-transfer classification tests. Scoped Ruff and Ruff format passed for nine files, scoped `ty` passed, both repositories passed `git diff --check`, both Trellis context files parsed as valid JSONL, and `f8` file/reference counts were zero. The shared local `public` test schema still records the removed unpublished `f8` revision, so it reports an expected newer-revision warning; fresh-schema migration evidence is authoritative, and the shared schema must be rebuilt before later broad gates. Existing dirty-worktree lint/format findings outside this checkpoint remain untouched. Oracle end-to-end coverage is unavailable, so Slice 0B acceptance and replication support remain PostgreSQL-only. Capability remains unadvertised until Slice 0C passes.

## Slice 0C: Compatibility Surface and Generated Contracts

Depends on Slices 0A and 0B.

Scope:

- Independently versioned Taki compatibility manifest through the Hindsight extension boundary.
- Base version, exact build identity, provider lineage, database capability, journal retention, snapshot schema, and individual contract versions.
- Fail-closed behavior for missing, incomplete, or unsupported capabilities.
- Final REST/OpenAPI schemas, generated clients, maintained wrapper parity where applicable, and upgrade compatibility checks.
- Contract documentation limited to the implemented extension surface; no changelog entry or independent fork behavior.

Gate:

- All six Batch 0 contracts pass together before the manifest advertises compatibility.
- OpenAPI/client generated-file checks, migration/backup checks, focused suites, full lint/type check, and the broad feasible test gate pass.

## Formal Flow

Each slice uses `trellis-implement` with vertical tracer-bullet TDD. The Leader independently reviews each handoff before dispatching the next slice. One final converged `trellis-check` reviews the complete Batch 0 diff, followed by Leader verification and `trellis-update-spec`. The task remains open until the full child acceptance criteria are satisfied.

Model routing for subsequent dispatches is owner-frozen: implementation agents use `high` reasoning effort and check agents use `xhigh`. Slice 0A was already running at `xhigh` before this ruling and is not interrupted solely to change effort.
