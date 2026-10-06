# Parent-Only Trigger Endpoint Diagnostic

## Delivery state

`w5-candidate-trigger-readonly-diagnostic.py` is prepared for parent review and execution. The implementer has not
run it, imported its entrypoint, started a diagnostic clone or issued these SQL queries. Only static syntax,
lint and formatting checks were performed. This is separate from the frozen reader repair:
`w5-candidate-reader-queue-source-manifest.json`, SHA256
`b38a102c5e6b9737afc62c6f4063f7dc9b7ecda6e39039e7026aab6555bda47f`.

Parent command, from `H:/TakiAgent`, after review:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-trigger-readonly-diagnostic.py --run-reviewed-clone
```

Without the flag, the script only describes its scope and does not import the clone runner. No real operation resume,
trigger repair, migration, full apply or second profiler is authorized by this script.

## Custody and boundaries

The script pins seven reviewed clone/custody helper files by SHA256, and verifies all
17 frozen reader-manifest entries before/after execution. It reuses the reviewed physical-copy lifecycle, replacing
only the `run_clone` callback with standalone asyncpg reads. The original engine/bootstrap/claim/apply function is
never called. No `hindsight_api` production module is imported by the diagnostic callback.

The inherited guards require the original/owned source to be stopped, verify Core/input/original source custody,
reject links/reparse points/external tablespaces, cap physical data at 2 GiB, require the reviewed 1660 files /
550592708 bytes, compare the fresh copy byte-for-byte, reserve a new loopback port and validate the clone PID's data
directory/port before stopping. The additional start guard excludes 3753/18495/18496 explicitly. Inherited PG commands
run hidden with finite start/stop timeouts and fast/immediate cleanup fallback. No source/old clone is started.

The clone's isolated configuration disables inherited includes/preloads and autovacuum. Its only allowed HBA route
is the cloned `taki_real` database/user on loopback. This diagnostic retains that clone-only trust route for its short
lifetime: it does not read source credentials or execute the earlier runner's `ALTER ROLE` password bootstrap.
Server and connection defaults are read-only; the complete diagnostic runs in one verified read-only repeatable-read
transaction. `QueryOnly` exposes bounded SELECT/SELECT-EXPLAIN reads, with no data execute method. A restored
publication function is collected as text, never called.

Limits: 10 seconds per query, 120 seconds for the complete async SQL diagnostic including connection work, at most
128 queries and 16 cases; connection close has its own five-second cleanup bound. PG lifecycle commands retain the
reviewed finite 30-second server wait / 45-second subprocess envelope. Source hashing/copying retain the reviewed
byte/inventory bounds. The 120-second SQL diagnostic bound is not a production request timeout or a wall-clock
promise for physical copying and final preservation hashing.

Success also verifies that the stopped clone's port can be reserved again. The physical diagnostic clone is retained
stopped with its logs/results, following the reviewed clone policy; this script does not delete evidence.

## Exact observations

The diagnostic records actual stored definitions for the association trigger, publication guard and permit helper;
the actual three table trigger definitions and enabled/row-level state; all relevant column types; valid/ready index
definitions; and table size/row estimates. It verifies all endpoint columns are UUIDs and refuses an unexpected
association endpoint-query definition rather than executing arbitrary stored SQL.

For each available association sample, it compares these two source-authored SELECTs over identical bound JSON rows:

- The stored lookup's `id::text IN (item->>...)` predicate.
- The same lookup with native UUID `id IN ((item->>...)::uuid, ...)` predicates.

Both retain the direct row Bank, live and archived memory lookups, entity lookups, UNION/DISTINCT, null filtering and
sorted Bank output. The diagnostic extracts the stored lookup only to compare its reviewed shape; it executes the
explicitly qualified `public` SELECTs. It changes no stored function or index.

Available samples cover `memory_links`, `unit_entities` and `entity_cooccurrences`; single OLD/NEW and paired OLD+NEW
inputs; checked missing UUIDs; archived endpoints when present; and a mislabeled Bank with real live endpoints. Rows
used to construct edge cases are JSON query inputs only and are never inserted. Missing sample categories are
reported, not invented. If no actual foreign Bank exists, the mislabeled direct Bank is an explicitly marked absent
synthetic identifier. The diagnostic targets the reviewed clone's actual `public` namespace and does not claim
acceptance of additional schemas.

Each predicate records its exact returned Bank list and `EXPLAIN (ANALYZE, BUFFERS, VERBOSE, TIMING OFF, FORMAT JSON)`
for the endpoint SELECT. Any returned-set mismatch fails immediately. The query log includes source-authored SQL
and elapsed time, without bound payloads; local plan evidence can contain endpoint UUIDs/Bank identifiers. No memory
text or credential is selected.

## Interpretation and follow-up

Result files are written by the reviewed runner under a new `.trellis/.runtime/w5-candidate-native-clone-<uuid>/`.
The result's `meaning` identifies this as the endpoint diagnostic, not a full apply. Confirm `diagnosticCompleted`,
`allBankSetsEquivalent`, `stopped`, `portReleased`, `readerSourcesPreserved`, and every original preservation flag.
Review missing categories before making a coverage claim.

The plans can establish whether text casts force endpoint table scans and whether the native UUID comparison uses
existing indexes. They do not measure the complete row trigger, its publication locks or the proportion of the prior
20.250-second DELETE spent there. They also do not prove statement-level or per-row fencing behavior. No final
latency, concurrency, cascade or multi-schema acceptance follows from this read-only comparison alone.

If evidence supports a later repair, its production/additive-migration scope and exact fencing/cascade regressions
must be approved separately. The original exact-set batch DELETE remains valid but has no proven latency benefit.
