# Reviewed W5 Association Trigger UUID Repair

The parent approved implementation on 2026-10-05 after the V3 read-only diagnostic. The source head is
`e30a9d7f6c21`; the runtime revision was not selected by V3 and must be read before any later migration.
V3 result SHA256 is `90b97539903715b1a58950f22f6e289aead0a75f80bfc0593d11212928c0c952`.

## Evidence and limits

The result is `.trellis/.runtime/w5-candidate-native-clone-8377118a14bd4dbab4a696ed4749feba/result.json`.
All 49 queries / 8 cases completed with equal Bank sets and positive stop/source/input/Core/original/reader/port
preservation facts. Old text predicates scanned live and archived units; the UUID predicates used existing
`pk_memory_units`, `idx_invalidated_mu_id` and `pk_entities` indexes. Single-link shared hits fell from 259 to 8,
and OLD/NEW hits from 518 to 14. Their SELECT execution times were 0.860 -> 0.119 ms and 1.642 -> 0.160 ms.
All plans had zero shared reads. Text ran first; this is not a randomized benchmark or full-trigger measurement.
Live/archive samples existed, but there were no actual entity/unit-entity/cooccurrence samples in the target Bank.
Full trigger, DELETE, fencing/cascade and actual migrated full-apply performance remain unproven.

## Approved production footprint

- New Native migration `e40b1e8a7d32_optimize_transition_association_lookup.py`, following `e30a9d7f6c21`.
  `CREATE OR REPLACE` the existing association trigger function; only change the three endpoint predicates from
  `id::text IN (...)` to `id IN ((item->>...)::uuid,...)`. Preserve all seven fields, OLD/NEW collection, direct Bank,
  live/archive/entity union, DISTINCT/sort order, publication checks, return values and every other guard.
- New Native tests `test_transition_association_lookup.py` and `test_transition_association_migration.py`.
- New `TAKI-HS-017` record in `H:/hindsight/TAKI_PATCHES.md` and a narrow Taki `memory-transitions.md` contract.
- No edits to the recorded e30 migration, schema tables/indexes, normal supervisor, Core, timers, dependencies,
  other production files, frozen reader source or old diagnostics/manifests. No Git or task lifecycle operations.

UUID fields are typed PostgreSQL columns before the row trigger runs. JSON null / absent fields cast to SQL NULL;
optional legacy `memory_links.entity_id` remains included. The supported contract remains PostgreSQL-only, with
explicit dialect dispatch and fully scoped target-schema references. No API/SDK/capability version changes.

## Correctness gate

Use only the existing isolated owned-PG runner. Exercise actual e30 -> e40 and new-revision-only e40 -> e30 rollback;
never invoke e30's own downgrade. Public coverage must use a newly created test database, not downgrade the shared
fixture's public schema. Tenant coverage proves another schema's functions/data remain unchanged. Verify actual
revision, function OID/definition, trigger modes/definitions and other functions plus all retained data/history.

Exercise actual rows in all three association tables, INSERT/DELETE/UPDATE OLD+NEW, optional null/entity fields,
cross-Bank/mislabeled rows, missing endpoints, archived ownership, fencing, real FK cascades and transaction rollback.
Run the existing focused fence/integrity/derived-link/backup/apply checks and migration shape, scoped lint/format/type.
Do not weaken foreign keys or disable real publication guards to make acceptance pass.

## Parent-only runtime gate

Deliver a versioned helper without executing it. The parent first rehearses explicit migration on a fresh physical
clone, then verifies exact pre-revision/function hash, one-step e30 -> e40, fresh-connection post-revision/function
shape, all other function/trigger identities and every retained table/history value before any apply. Migration
and data-verification timing are separate from apply timing. Existing harnesses use `run_migrations=False` or a
direct delta service; source replacement alone cannot migrate their stored SQL. Do not alter supervisor policy.

Only after the independent correctness gate and parent review may a separate controlled working-pair migration
occur. It needs its own exact target/revision/function/data proof; no old clone or original sibling may be used as
the rehearsal target. The helper accepts no arbitrary existing target. Full apply uses the existing parent-owned
synthetic-vector diagnostic and unchanged 180-second apply / 60-second observation budgets; it is not real-model cost.

The new revision's downgrade restores only the old function predicates. Rehearsal tests may exercise that one
step on newly owned fixtures. No real history downgrade is authorized. Failed clone evidence is retained stopped.
