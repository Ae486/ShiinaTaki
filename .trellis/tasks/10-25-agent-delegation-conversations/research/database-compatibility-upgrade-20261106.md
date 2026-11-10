# Delegation database compatibility repair — 2026-11-06

## Failure and repair boundary

The actual T4 database had already recorded migrations 058 and 060, but lacked six current
delegation tables and five immutable triggers. Its 59 existing delegation schema objects
matched the current definitions. Both a resumed worker and a newly delegated worker failed
before their first model Effect: summary reads failed, and terminal settlement failed again
while writing the absent event-frontier table, rolling back active-pointer release.

The owner authorized implementation, verification, and upgrading the actual database after
the gates pass. Migration 069 appends a compatibility bridge; it does not rewrite or replay
058/060, alter the migration runner, merge another database, or change agent actions.
The real Core watcher was stopped before registering 069 to prevent an unverified live upgrade.

## Compatibility contract

- Match four combinations of the independently evolved 058 context and 060 frontier groups.
  Each group must be completely absent or exactly current. Partial/unknown structures fail
  atomically, including SQL, receipt and COMMIT failures.
- Use frozen complete SQL definitions and existing schema-branch validation. Create only missing
  objects; retain every old row, schema object, applied receipt and already-current frontier.
- Backfill new frontiers only from exact terminal-result identity or canonical interaction
  keys with matching input evidence. Check-in, malformed and otherwise unknown keys remain NULL.
- Migration does not dispatch models, invent summaries/reports, clear user Stop, or claim unknown
  primary outcomes. Normal boot recovery owns lifecycle settlement after the schema is usable.

## Completed validation

- 87 focused tests in 10 files passed with one worker, including 17 new migration/recovery cases.
  Thirteen changed TypeScript paths passed scoped lint. Implementer evidence is in the ignored
  `target/delegation-upgrade-20261106/implementer/` directory.
- The consistent actual-data backup was version 68, SQLite integrity `ok`, no foreign-key violations.
  Its SHA-256 is `357be5f76ba1205977a722b4d1469d020d6eeca9c9d7e1736bbc00a3e545e123`.
- The production migration runner upgraded an isolated copy to 69 and reopened without applying
  anything. Row-multiset and schema fingerprints prove every old table/receipt/object unchanged;
  exactly the six missing tables were added. Integrity and foreign-key checks passed.
- Production recovery on another actual-data copy settled both orphan children as cancelled,
  released active pointers and preserved user Stop. Both events stayed ineligible: existing
  `record_only` policy takes precedence for one; the other records `user_stop`.
- Every original Effect row remained unchanged. The three unresolved primary Runs remain
  `recovering / reconciliation_required`. A second boot generation added no duplicate child event.
  The harness had no model or application bootstrap and could not dispatch a provider request.

The one-off recovery harness first exposed two incorrect harness assumptions, both corrected
against production contracts: suppression reasons follow completion-policy precedence, and a
second boot creates a new recovery coordinator rather than rescanning one process generation.
Failed copies remain in the ignored evidence directory; they are not claimed as passing runs.

## Integrated verification and actual upgrade

- The isolated production-Core E2E passed on its first execution (9.78 seconds, nine local scripted
  provider requests). It proves new delegation, user Stop, same-work Continue with a new Run,
  validated child output, parent inbox handling and a `sent` public delivery. Source parity and
  complete cleanup passed. Evidence: `target/delegation-upgrade-20261106/e2e/legacy-delegation-upgrade-dAE7Jz/`.
- The same-workspace full Core run passed 4,675 tests, with six skipped; 568 files passed and one
  skipped. This independently running session's result is reused from
  `target/maintenance-monitor-core-final.log` (14:15:20 local start, 369.97 seconds), including the
  frozen 069 implementation and 17 new cases. This session did not start a competing full suite.
- Current-source workspace typecheck passed for Shared, CLI, Desktop, E2E and Core, serially with
  a 1536 MiB heap. Root lint passed with the established historical `artifacts/**` exclusion;
  current source/tests were included. No native inputs changed, so no new native acceptance is claimed.
- Final independent review found no evidenced blocker. The three frozen production hashes
  still matched the implementer manifest before the actual migration.
- The actual database was checked quiescent and matched the validated version-68 snapshot.
  A fresh SQLite-consistent backup was saved to
  `C:/Users/55473/.takiagent/backups/taki-before-delegation-069-20261106T062602Z.sqlite`.
  It is 28,479,488 bytes and has the same SHA-256 as the original rehearsal backup above.
- At `2026-11-06T06:27:01.715Z`, the production migration runner applied only 069 to
  `C:/Users/55473/.takiagent/taki.db`. Before runtime restart, fingerprints again proved all old
  table rows, schema objects and receipts unchanged; exactly six missing tables were added.
  SQLite integrity was `ok`, with zero foreign-key violations.
- Restored the original hidden Core watcher command from `packages/core`. Watcher PID 40180 and
  Core PID 42924 were observed at rollout; the Core listened on `127.0.0.1:8974`.
- At `2026-11-06T06:28:05.478Z`, real read-only storage and authenticated operator RPC verification
  passed. Both previously blocked child Runs are cancelled with no fabricated output, no model
  Effect and one suppressed event each. Active pointers are released, user Stop remains, and
  every pre-upgrade Effect row is byte-equivalent at the row level. Three historical primary Runs
  remain `recovering / reconciliation_required`; no unknown result was claimed or replayed.

Reproducible scoped commands and machine-readable results are retained under
`target/delegation-upgrade-20261106/`: `migrate-copy.mjs`, `fingerprint-db.py`, `recover-copy.mjs`,
`backup-actual.py`, `upgrade-actual.mjs`, `verify-actual.mjs`, and their JSON/log outputs.
The actual upgrade script is intentionally one-shot: it refuses a database already at 69.

No paid model request was made by this repair campaign; its provider responses are explicitly
scripted. The real application verification performed no chat/control operation and did not
resume user-stopped work. The owner can explicitly Continue those tasks or delegate new work.

Actual-data copies and content-bearing evidence stay under ignored `target/`; they must not be
committed. Broader long-context acceptance and owner UI acceptance remain separate open requirements.
