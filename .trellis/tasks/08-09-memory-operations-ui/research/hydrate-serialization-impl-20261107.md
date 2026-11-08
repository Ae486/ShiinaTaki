## 1. Outcome — done

Completed P1-R2. The final assigned suite passed **63 tests**. Ruff, formatting, scoped type checks, and exact-patch verification passed. All test PostgreSQL processes started by this continuation are stopped.

The production fix remains the predecessor’s single lock-mode change. Neither audit found another reachable defect requiring production changes.

- [Full report](G:/taki-codex-work/tmp-r/p1r2-report.md)
- [Exact total patch](G:/taki-codex-work/tmp-r/p1r2-total.patch)
- [Checks and source hashes](G:/taki-codex-work/tmp-r/p1r2-checks.json)

## 2. Changes

| File | Purpose |
|---|---|
| [store.py](H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/store.py:167) | Preserved `FOR NO KEY UPDATE` and its rationale: exclude competing cursor writers while permitting transport FK `KEY SHARE`. |
| [test_application_concurrency.py](H:/hindsight/hindsight-api-slim/tests/native_results/test_application_concurrency.py:33) | Seven cases across three functions. Completed verification; revised cancellation coverage to cancel an acquired lock holder and prove rollback releases its blocked writer. Removed an untyped diagnostic field. |
| [TAKI_PATCHES.md](H:/hindsight/TAKI_PATCHES.md:10) | Added `TAKI-HS-021`; reconciled the existing retry entry at line 793, including ownership and retirement criteria. |

No Core, template/prompt, task-binding, build-identity, schema, deadline, sleep, or retry-count changes. No backend spec states this application writer’s lock mode, so no spec correction was needed. [source engine/application_state/service.py:42] [inference from scoped diff and backend-spec search]

Source references below beginning `engine/`, `admin/`, `alembic/`, or `extensions/` are relative to `H:/hindsight/hindsight-api-slim/hindsight_api/`.

## 3. Evidence and checks

### Executed runs

All paths in this table are under `G:/taki-codex-work/tmp-r/`.

| Artifact | Result |
|---|---|
| `red-c7148c9b/` | Predecessor’s red: hydrate, snapshot, and empty hydrate each exhausted three retries. PostgreSQL identified FK `FOR KEY SHARE` on `memory_application_banks`, SQLSTATE `40001`, `ExecLockRows`. |
| `green-initial-e2aec631/` | Predecessor’s initial green: first function’s three cases passed. |
| `assigned-7759ee6a/` | Interrupted; supplies no acceptance evidence. |
| `p1r2-full-8d3a99f4/` | **62 passed, 1 failed**. Failure: cancellation of an in-flight SQL lock waiter left asyncpg awaiting cancellation completion. |
| `p1r2-baseline-cancel-f56354b2/` | The identical failed test also failed against the recorded `FOR UPDATE` baseline in an isolated package copy. Production files were never reverted. |
| `p1r2-final-aaa96333/` | Revised cancellation test: **63 passed**. |
| `p1r2-final-current-b36b860f/` | Final delivery source: **63 passed**, 15 existing deprecation warnings, **188.58 seconds**, exit 0. Recorded source hashes match the delivered files. |

[source G:/taki-codex-work/tmp-r/red-c7148c9b/postgres.log:9] [run artifact G:/taki-codex-work/tmp-r/p1r2-final-current-b36b860f/result.json]

The final full-suite command, from `H:/hindsight/hindsight-api-slim`, was:

```powershell
$env:TEMP='G:/taki-codex-work/tmp-r'
$env:TMP=$env:TEMP
$suite=@(Get-ChildItem tests/native_results -Filter 'test_application*.py' |
    Sort-Object Name | ForEach-Object { 'tests/native_results/' + $_.Name })
& H:/hindsight/.venv/Scripts/python.exe G:/taki-codex-work/tmp-r/run_tests.py `
    p1r2-final-current @suite `
    tests/test_taki_application_state_retry.py tests/test_taki_extension_contract.py
```

Environment: Python 3.11.5, PostgreSQL 18.1, serial pytest, isolated G: data, non-default ports. Concurrency regressions exercised real PostgreSQL; model dependencies used existing mocks. No Core/Native servers or journeys were started.

Scoped checks passed:

- Ruff 0.14.9: `check --no-cache` and `format --check --no-cache`.
- ty 0.0.8: both touched Python files.
- `git diff --check`.
- Independent scoped review: no must-fix findings.

The repository-wide lint script would auto-format unrelated projects, so its relevant Python checks were run directly. [source H:/hindsight/scripts/hooks/lint.sh:38] [run artifact G:/taki-codex-work/tmp-r/p1r2-checks.json]

### Per-holder audit

| Holder/path | Interleaving considered and conclusion |
|---|---|
| `commits.py:314-315` | Bundle captures old state; command publishes before transport INSERT. Replication-first writer ordering remains exclusive; RR preserves the bundle’s coherent old checkpoint. No dependency on excluding transport INSERTs. [source engine/application_state/commits.py:314] [source engine/application_state/snapshot.py:287] |
| `publication.py:194` | Bundle holds FK `KEY SHARE` while publication requests the application writer lock. Compatible locks remove unnecessary waiting; competing cursor writers still exclude each other. [source engine/application_state/publication.py:194] [source engine/application_state/publication.py:263] |
| `publication.py:310` | Native mutation/capture overlaps an older bundle. Native data, heads, and paired cursors commit together under replication serialization; RR observes coherent versions. [source engine/replication.py:1059] [source engine/replication.py:1135] |
| `snapshot.py:82-83` | Initialization overlaps bundle creation. Existing initialization keeps writer ordering; first initialization remains atomic. An invisible application row yields `capture_required`, not partial success. [source engine/application_state/snapshot.py:81] [source engine/application_state/store.py:178] |
| `snapshot.py:439-450`, retention | Bundle captures `c`; publication and pruning advance the floor to `d>c`; bundle commits at `c`. **Reachable, contract-compatible:** bytes remain coherent; later incremental replay returns `state_reset_required`. Snapshot TTL does not pin journal history. [source engine/application_state/snapshot.py:364] [source engine/application_state/snapshot.py:439] |
| Reset/deletion/generation | An older bundle can complete after deletion/recreation as historical evidence. Deletion retains application history; recreation uses a new generation rather than changing the application PK. Live operations still check namespace/deletion. [source engine/application_state/store.py:136] [source engine/application_state/store.py:198] [source engine/replication.py:352] |
| Expired-body/snapshot cleanup | No production application-body or application-snapshot deletion path was found. Pruning deletes changes; expiry checks availability. These tables do not cascade from physical Bank deletion. [source engine/application_state/snapshot.py:246] [source engine/application_state/snapshot.py:443] [source extensions/tenant.py:169] |
| `stored_body(lock=True)` versus `save_body` | The content-addressed reuse premise is false: `body_ref` assigns a fresh UUID. Identical payload does not reuse an uploaded body’s row. Parts reference their own newly inserted body. Existing upload locks need no change. [source engine/application_state/codec.py:323] [source engine/application_state/store.py:292] [source engine/application_state/store.py:398] [source engine/application_state/store.py:413] |
| `admin/taki_backup.py:118` | Bundle commits between proof and COPY. One RR transaction encloses backup, so the entire bundle is visible or absent; application writer exclusion is unnecessary. [source admin/cli.py:398] [source admin/taki_backup.py:118] |
| `transfer/export.py:95` | This is an operational-table classification, not a row read/lock. Portable Bank export excludes application state. [source engine/transfer/export.py:74] |
| `transition_storage.py:49`, quiescence | This is trigger inventory. Canonical writers use replication/maintenance/fence locks; transition-read handling explicitly permits transport body/part/snapshot INSERTs. Proof covers descriptors and referenced bytes, not every private transport row. [source engine/transition_storage.py:155] [source engine/transition_snapshot.py:100] [source alembic/versions/e30a9d7f6c21_add_transition_publication_fences.py:325] |

### Same-shape audit

| Transaction | Writes / FK target | Writer lock and conclusion |
|---|---|---|
| `read_admission.py:149` | SELECT checkpoint/context/artifact/bodies; no FK write. | Application writers use `NO KEY UPDATE`; upload writers use body `FOR UPDATE`. Reader takes neither. |
| `read_admission.py:278` | SELECT candidate bindings/bodies; `_remember` changes Python state only. | No SQL write or matching conflict. |
| `read_admission.py:330` | SELECT through `_facts`/`_binding`. | No SQL write or matching conflict. |
| `read_admission.py:377` | SELECT current Bank/bindings/native payloads. | `current_native` reads, not mutates. No matching conflict. |
| `service.py:90`: snapshot/hydrate | Inserts bodies, parts, snapshot; bodies/snapshot reference application Bank, parts reference own new body. | **Proven defect fixed centrally** by application Bank `NO KEY UPDATE`. [source engine/application_state/snapshot.py:289] [source alembic/versions/d77a4f8c2e10_add_application_state.py:55] |
| `service.py:90`: snapshot/page/changes | Transaction-local `set_config`, then SELECT stored manifests/refs/bytes. | No persistent write; application cursor/retention writers use `NO KEY UPDATE`. [source engine/application_state/service.py:173] |
| `service.py:90`: body/part/commit status | SELECT status, bytes, receipt. | No persistent write or upload-row lock. [source engine/application_state/service.py:125] [source engine/application_state/service.py:137] [source engine/application_state/service.py:160] |
| `transition_api_service.py:61` | SELECT status/history/maintenance/evidence. | Request writers use `NO KEY UPDATE`; no reader FK write. |
| `transition_api_service.py:78` | SELECT status/history/auxiliary page. | No reader FK write. |
| `transition_maintenance.py:55` | Ensures Bank/fence, optionally initializes application state, inserts/updates mapped transition maintenance. Maintenance/fence reference transition request. | Canonical writers are excluded by replication → maintenance → fence locks. Concurrent request renewal already uses `NO KEY UPDATE`, compatible with FK checks. Direct stale-view write/lock conflicts remain distinct. [source engine/transition_maintenance.py:129] [source engine/transition_storage.py:155] [source engine/transition_storage.py:201] |
| `transition_service.py:161` | Schema/status/history/count SELECTs. | No persistent write. [source engine/transition_storage.py:228] |
| `logical_snapshot.py` | Inserts metadata/pages. Metadata references immutable provider lineage; pages reference own new snapshot. | Deliberately no FK to mutable replication Bank. Ordinary/D78 RR and transition’s existing locked read-committed path do not share this defect. Cleanup cannot see a newly uncommitted snapshot. [source engine/logical_snapshot.py:455] [source engine/logical_snapshot.py:493] [source alembic/versions/f7d0a5c3e9b2_add_replication_logical_snapshots.py:3] |
| `lock_replication_bank_state`, `replication.py:380` | Ensures state referencing immutable lineage; journal INSERTs reference replication state. | Journal writer already owns that row’s `FOR UPDATE` before updating/inserting. Independent snapshots do not FK-reference it; changes reader is read-only. Retain this stronger writer gate. [source engine/replication.py:1059] [source engine/replication.py:1089] [source engine/replication.py:1288] |

No additional matching defect was demonstrated; no speculative guard or extra interleaving test was added.

### Patch and resource disposition

The total patch reproduces exactly three delivered files when applied to the recorded baseline. Byte comparisons and `git apply --check --whitespace=error-all` passed. Git configuration was overridden only for that temporary verification to preserve LF.

Patch SHA-256:

```text
bf13b63bf9ad87c733c9d3cea6d9fa412a0f7f64641cd9640ed2c23576e5f85e
```

All four PostgreSQL instances started here are stopped: PIDs **2808, 30300, 11952, 10816**; ports **8737, 9241, 9338, 9747** independently checked closed. Zero processes remain at the owned PostgreSQL binary path.

`pg_ctl` returned `Operation not permitted`; each runner used its isolated-binary process-stop fallback successfully. Data directories and stale PID files remain as evidence. [run artifact G:/taki-codex-work/tmp-r/p1r2-resource-disposition.json]

## 4. Trade-offs

- Publication avoids waiting solely on a bundle’s application-Bank FK lock. Existing writer/transition waits remain; no latency SLA is claimed.
- Retention may overtake an older coherent bundle, requiring a new snapshot for subsequent incremental replay.
- Cancellation tests now prove acquired-lock release and cancelled-bundle rollback. They do **not** claim successful cancellation of an in-flight SQL waiter.
- Bounded retry remains unchanged for other transient write/lock conflicts.
- Bodies remain integrity-hashed, UUID-addressed, and conservatively retained. Storage/cleanup policy is unchanged.

## 5. Open items / UNKNOWN

- **Queued-SQL cancellation cause: UNKNOWN.** It failed with both lock modes. Asyncpg awaited cancellation completion; Windows/sandbox signaling is a hypothesis, not proven causation. [source H:/hindsight/.venv/Lib/site-packages/asyncpg/protocol/protocol.pyx:144] [run artifact G:/taki-codex-work/tmp-r/p1r2-baseline-cancel-f56354b2/pytest.log]
- Actual first-use journey, curator/Pending recovery, real-model behavior, and manual acceptance remain leader-owned and unexecuted here.
- Build-identity bump remains under D97. [source H:/TakiAgent/docs/deferred-decisions.md:16]
- Caller’s `-o` pathname was not supplied. This final message is ready for capture; the full report is also saved at the linked G: path.

## 6. Outside scope noticed — not fixed

- The baseline queued-SQL cancellation and PostgreSQL signaling limitations require separate runtime/environment investigation.
- The suite emits 15 existing `reflect_service.py:79` deprecation warnings.
- The historical Q4 diagnosis called this upstream work; the assignment and reconciled ledger identify D77 as a Taki extension. Historical diagnosis records were not edited.