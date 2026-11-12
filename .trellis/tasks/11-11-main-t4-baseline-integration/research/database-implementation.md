# Database Integration Implementation

## Reviewed concrete convergence groups

The immutable fresh prefix remains main 001-063. T4's original versioned exports remain unchanged and are collected in `t4-lineage.test-fixture.ts` for tests only. No canonical receipts 064-072 are manufactured.

- **073 main feature convergence and input recognition**: recognize exact known common/main/T4 input schema signatures. Existing current main Hindsight groups no-op. On recognized T4 shapes, compose immutable main049-063 definitions within this single migration, including the exact pre054 marker transformation and newly-created051/057 parent/quarantine rebuild at063. Marker values are copied unchanged and transition receipt stays NULL; existing clocks/receipts are never reseeded. Full group creation occurs only when its feature tables are absent.
- **074 initiative/source context**: missing groups apply T4's immutable049-055 and057 SQL, including exact Timezone alteration; current complete groups no-op.
- **075 private delegation**: missing private groups apply immutable056/058/060-063 definitions in dependency order. Current known groups no-op. Recognized early058 context/060 frontier combinations use original069's factual CREATE-only repair, never058 rebuild or060 replay against current nonempty tables.
- **076 primary sources/usage/Tidy observation**: missing groups compose immutable064-068. Current groups no-op; checked Timeline FK/usage column and cache/maintenance population are part of the exact schema guard. Existing raw usage, baselines and private evidence are retained; original conservative data-seed SQL runs only for newly created observation groups.
- **077 model profiles/search projection**: missing070-072 groups create the exact immutable definitions; current groups no-op. Existing profiles, secret references and search-policy rows remain unchanged.

Known group variants and complete schema object definitions are generated from isolated execution of immutable migrations, then stored as static migration constants. Production migrations do not inspect filesystem snapshots, import a live database, change lower version exports or run an alternate migration framework. Tests regenerate schema truth and compare exact definitions. Unknown attached objects and unsupported partial groups refuse before group DDL. Per-migration atomicity means earlier successful073+ groups retain receipts if a later group fails; each such retry/reopen boundary is tested.

## Source integration boundaries

The SQLite wrapper combines T4 post-commit callbacks with main rowid-preserving backups, immutable readers and actual transaction state. T4 trigger-aware exact schema recognition retains main unknown incoming-reference/transaction isolation. Memory repositories are integrated separately with both branches' journal/custody/waiting contracts; no directory-level side selection is used.

## Verification status

Initial direct Node execution of the combined SQLite wrapper with unchanged migration-only imports succeeds: common048 has197 schema objects, main063 has505, T4 historical072 has340. No service/model/credential access occurred; all executions used `:memory:`. Functional convergence tests and source/repository conflict checks remain pending.
