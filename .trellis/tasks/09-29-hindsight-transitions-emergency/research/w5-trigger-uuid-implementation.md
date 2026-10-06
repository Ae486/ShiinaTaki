# W5 Association UUID Lookup Repair

## Result and scope

The approved additive repair is implemented. Correctness checks passed; independent review, parent-owned actual
migration rehearsal, migrated full-apply measurement and the later working-pair migration remain separate gates.
No preserved corpus/working pair/previous clone was opened or started by the implementer. No model, Git or task
lifecycle action occurred. All database execution used new instances from the existing owned-PG runner.

The sole new production file is Native
`hindsight_api/alembic/versions/e40b1e8a7d32_optimize_transition_association_lookup.py`.
It follows `e30a9d7f6c21`, replaces only `guard_transition_association_write()` and changes only the three endpoint
predicates to UUID comparisons. Existing UUID indexes become usable; no table/index, trigger, lock, permit,
timer, Core, dependency, API/SDK/capability or supervisor change is included. PostgreSQL-only dispatch is explicit.
The new revision's downgrade restores only the historical function body; it never invokes e30's downgrade.

`TAKI-HS-017` in `H:/hindsight/TAKI_PATCHES.md` and the narrow paragraph in Taki
`.trellis/spec/backend/memory-transitions.md` record the contract. Exact preimages of both documents and the unchanged
e30 source are in `w5-trigger-uuid-preimages/manifest.json`. The reviewed proposal is
`w5-trigger-uuid-repair-proposal.md`; earlier reader/V1/V2/V3 evidence is unchanged.

## Executed verification

All PG commands used:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- <selection> -q --tb=short -n 0
```

| Owned PG root under `.trellis/.runtime/g1-validation` | Actual result |
| --- | --- |
| `taki-hindsight-g1-9810f7a7efda` | 40 association cases passed; 2 migration fixture setup failures; 155.00s. |
| `taki-hindsight-g1-707a484074b8` | 252 existing functional/migration-shape cases passed; 105 inapplicable CONCURRENTLY-shape cases skipped; 2 remaining migration fixture setup failures; 248.22s. |
| `taki-hindsight-g1-55db2b84d2f9` | 2 migration fixture snapshot failures before upgrade assertions; 13.60s. |
| `taki-hindsight-g1-cffd09321a91` | Corrected public/default and tenant migration cases: 2 passed in 17.23s. |

All four instances stopped and their owned data/registry were removed; logs and ownership files remain. Failed
results are not overwritten or counted as successful migration proof. The two corrected migration cases and 40
association cases are the new regressions; the 252-pass group is disjoint. Unaffected groups were not rerun.

New test files (relative to Native slim):

- `tests/native_results/test_transition_association_lookup.py`: all three actual association tables; every endpoint,
  direct Bank and optional legacy entity owner independently fenced across INSERT/DELETE/UPDATE OLD and NEW;
  successful unfenced updates/deletes with outer rollback; nullable/missing UUID behavior and actual FK refusal;
  real FK cascades refusing a fenced surviving peer and rolling back the parent delete; actual invalidation moving
  the unit to archive and deleting its unit-entity row, followed by stored-query archive/null/missing Bank-set checks.
- `tests/native_results/test_transition_association_migration.py`: uniquely created databases, actual initial e30
  migrations for public/default and tenant schemas, real replication initialization/acquire/fence/history, e40
  upgrade, new-revision-only rollback to e30, and re-upgrade. Fresh connections verify revision, original function
  OID/attributes, every other function and trigger/index, all table/materialized-view rows and sequence state.
  The other schema's complete snapshot stays unchanged. No shared public fixture downgrade occurs.

The existing selection was `test_transition_fence.py`, `test_transition_integrity.py`,
`test_transition_derived_link_batches.py`, `test_transition_delta.py`, `tests/test_migration_shape.py`, and only
`test_transition_backup.py::test_offline_restore_preserves_retired_quarantine_and_trigger_rollback`.
The other backup test intentionally invokes historical e30 downgrade and was excluded from this scope.

Fixture corrections were confined to the new tests: raw inserts needed the actual
`ensure_replication_bank_state` producer; the trusted schema qualifier had to preserve `function(type,...)`
signatures rather than quote them as a single identifier; sequence relations require explicit
`last_value/log_cnt/is_called` projection because they have no composite type. The last fix is also applied to the
parent helper. No production correction was needed after the initial migration was added. A later wrap of one
long test SQL literal has the same AST/string value as the 40-case tested source.

`w5-trigger-uuid-quality.json` records final scoped type/lint/format commands and exact source hashes. Native
configuration lint and formatting passed; Native tests use their existing lint exclusion and fixture-import
conventions. The helper/audit scripts passed E/F/I at 120 columns. No lint suppression, line-limit increase or
global type baseline exception was introduced. An optional isolated lint probe reported the existing fixture
parameter/import pattern and lacked Native first-party import configuration; it is not the project gate.

`w5-trigger-uuid-source-audit.py` captures migration SQL without any database access. For default/public/tenant it
proves exactly one statement per direction, only the three approved predicate changes, and a downgrade body equal
to the immutable historical e30 function. It also exercises the helper's actual Alembic configuration with a
mocked `command.upgrade`, verifying the sole clone port/DB/user, exact revision, target schema and finite timeouts.
All scoped Native and helper types passed. Native code-review conventions were checked against the explicit scope;
the global auto-fixing lint hook was not run because it would touch unrelated maintained files.

## Parent-only helper

`w5-trigger-uuid-migration-rehearsal.py` was not run with a data-access flag. Its no-argument descriptive entry point
and pure source/configuration checks passed. It accepts no existing target/DSN or working-pair path.

After checking the immutable source manifest and reviewing the helper, the parent may run:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-trigger-uuid-migration-rehearsal.py --run-reviewed-clone
```

Add `--with-apply` only for the reviewed full-apply benchmark. Every invocation creates a fresh physical copy using
the pinned inherited clone custody/size/path/port/start/stop guards. A migration-only invocation makes no apply or
password mutation. Optional apply reuses the original clone-only synthetic-vector harness and its private password
rotation. No real model or normal maintenance is introduced.

Before any DDL, read the actual e30 version and require the V3-observed stored function hash
`729b937af085b27ba8ea24ed5ef8eabca4f99082deaf46a7271925c1d5f1e9e6`. Capture all public table/materialized-view/sequence
values as counts and sorted row hashes, and complete function/trigger/index identities. Run exactly Alembic e40,
then open a fresh connection and require exact new version/body, same OID/attributes, unchanged other objects and
every stored value. No payload text is persisted by the corpus row hashing. `migration-before.json` and
`migration-after.json` retain the comparison evidence.

The migration-plus-proof envelope is 180 seconds; SQL/connect/lock limits are 10/10/2 seconds. The inherited
180-second apply limit and 60-second observation are unchanged. Migration duration and full proof duration are
reported separately, outside apply timing. Source/reader manifests are checked before and after. PG credentials
and service environment are cleared; the migration uses private clone HBA trust and an explicitly absent password
file instead of consulting user/source credentials. Result encoding uses the frozen V3 closed-failure writer.

Only after independent review and the clone gate may the parent separately review a working-pair migration with
its own stopped-runtime/custody, exact target/pre-revision/function and post-data proof. The original source sibling
remains untouched. Normal supervisor policy and historical migration records are unchanged.

## Remaining limitations

The V3 SELECT plans support the endpoint-index diagnosis but do not establish total trigger/DELETE savings.
Actual corpus migration and full apply have not been executed by this implementation. Small owned-PG correctness
does not satisfy the real-corpus latency gate, original-environment/manual acceptance or W5 completion.
