# W5 Read-Only Baseline CPU / SQL Diagnostic

Status: implemented and checked; **not executed on a corpus clone**. Parent owns execution.
Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
No production, existing helper, prior manifest/report, or runtime file was changed.

## Why this measurement

The independently read V2 result is internally consistent. Parent result SHA256 is
`1947371d96581b98cf45dea444df72b2fab8abd600d111a4840ace3865f8da38`; its child result SHA256 is
`099d9c4c55af4f34d2ec44859c25a3258c44e73c4e01b3dcc6a33241eb19db1c`.
The embedded child, worker-launch, worker-self and embedding objects exactly match their separate files.
Held/script PID 10592, executable and creation time agree. The saved results report complete preservation,
one exact delta/lookup, 1559 mappings, 1558 artifacts, stopped owned PostgreSQL and released port.
This review read only those authorized result files; it did not reopen or rehash the databases.

The real CPU model encoded 68 documents in 5.207 seconds, with a separately reported 76.635-second initialization.
Full apply took 117.236 seconds; the 60-second observation remained pending. Baselines took 34.561 / 33.457 seconds,
versus the prior c79 17.259 / 16.876. Native and application writes also roughly doubled.
The first baseline precedes encoding, so the 5.207-second encode cannot explain this broad slowdown.
The whole-run SQL aggregate also includes preservation outside apply and must not be subtracted as exclusive apply SQL.

Ranked hypotheses, rather than claimed causes:

1. Repeated Python decoding/schema/canonical-hash work is the largest remaining baseline CPU cost. The reader
   intentionally reuses only validated bytes; every `read_body` still decodes, validates schemas and Source closure.
   `capture_transition_baseline` additionally hashes all native/application/auxiliary records. A low measured worker
   CPU total or small codec exclusive CPU share would weaken this explanation.
2. Current-head/native-payload/Source validation retains many serial SQL round trips. Whole V2 counts include
   3522 head reads, 2280 live-unit reads and 2040 entity reads. A small stage-specific SQL-await share would weaken
   this hypothesis. SQL await includes PostgreSQL execution, transport, driver work and scheduler delay.
3. Resource/scheduler contention changes wall time across Python and PostgreSQL. The approximately doubled phases
   support measuring this possibility, but do not identify a competing process or prove model-thread contention.
   Worker/backend CPU, working set/page faults and I/O counters alongside system CPU distinguish active work from
   waiting during the new run. A new clean run cannot retroactively prove why the earlier machine was slow.

The old residual profiler pins an obsolete reader class/manifest and remains immutable. Its earlier report also
recorded large observer overhead, including slower SQL. No global timing scale factor is defensible.

## Exact implementation and boundaries

- `w5-baseline-readonly-profile.py` composes the existing V1 parent supervisor and V2 direct Windows worker handshake.
  The inherited unique job directory remains `w5-actual-embedding-*`; the new final report explicitly identifies it
  as baseline-only. This reuses custody instead of adding a process framework. The wrapper changes only module-local
  launch/supervision references; global subprocess is untouched.
- The child reuses clone creation, PG pointer/handle verification, e30-to-e40 migration proof and cleanup. It replaces
  `run_clone` before `main` can execute, making the old apply/model branch unreachable. The setup migration changes
  only the fresh private clone. No old clone is reused, and the working pair is never started or migrated.
- It reads the exact preserved preparation, validates its delta operation/hash, then makes two separate connections
  and read-only repeatable-read transactions: light reference followed by detailed profile. Each invokes unchanged
  `capture_transition_baseline(..., _reuse_body_bytes=True)` and must match the exact retired proof's full baseline hash.
  Both independent hashes/components/counts must agree. No admitted executor or production transaction guard is weakened.
- Every measured SQL call also passes a SELECT/exact-UTC-statement allowlist that rejects mutation, row locks and
  multiple statements. This is separate from PostgreSQL's read-only transaction enforcement. Complete user-table,
  sequence, function, trigger and index hashes are checked after the profile against the migration-after snapshot.
- `w5_baseline_profile_metrics.py` aggregates fixed function/stage/schema categories. Synchronous nested metrics
  explicitly subtract instrumented children using the current thread's CPU clock. Async durations remain inclusive.
  Reader hit evidence comes from reader-byte calls minus ordinary full-byte validations, avoiding an extra descriptor
  serialization merely to inspect the cache. No IDs, bodies, query arguments, vectors or error messages are collected.
- The parent samples every 0.5 seconds, with at most 1802 observations. Python uses its exact held identity. The PG
  backend is obtained from the actual verified clone connection, joined to executable/creation time and the clone's
  live postmaster before observation. Replaced identities refuse. CPU, process I/O and memory counters plus system CPU
  are stored in `telemetry.jsonl`. Process I/O bytes are not physical disk traffic; unavailable metrics remain absent.
  At least one successful backend sample per pass is required for diagnostic success.
- Existing 900-second outer watchdog and owned PG cleanup remain unchanged. Migration/preservation and each baseline
  use finite 180-second async bounds; SQL uses 30 seconds and lock acquisition 2 seconds. Async cancellation is not
  represented as a hard CPU interrupt; the direct-worker outer watchdog owns that boundary.

## Actual checks

Final evidence is in `w5-baseline-readonly-profile-checks/quality-and-unit.json`.

| Check | Result |
| --- | --- |
| Scoped Ruff | PASS, exit 0 |
| Ruff format check | PASS, all 3 new Python files |
| Scoped ty, actual venv / Python 3.11 / Native source path | PASS, exit 0 |
| Offline unit/adapter tests | 14 PASS, 6.760 seconds |
| Default real process | No work; no torch or sentence_transformers import |
| Actual saved request input | Read-only original prepared request validates; before/after SQLite hash equal |
| Actual Native return type and profiler aliases | TransitionBaseline fields match; decoration works and restores after error |

The first static attempt needed formatting and an explicit ty environment (otherwise ty selected Conda rather than
the Native venv). New local identity-field/optional-handle diagnostics were fixed with actual type checks, without
suppression. Final commands are saved verbatim. No existing Native diagnostic was edited or hidden.

Tests cover nested exclusive CPU math, exact exception identity, async cancellation context cleanup, metric bounds,
read-only SQL refusal, unchanged returns/parameters, absent private values, substituted PID rejection, report refusal
for unequal proofs/missing observations/cleanup failures, and module-local reuse of the actual V2 launch seam.
Only the specifically authorized offline SQLite input was read. No test starts PostgreSQL, a model, or a corpus clone.
The applied trellis-before-dev/trellis-check guidelines are satisfied within the task-only scope; no executable product
contract or generated template changed, so no production spec/index update is needed.

## Parent execution

After reviewing the new files and independently checking the final cumulative manifest:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-baseline-readonly-profile.py --run-reviewed-clone
```

Read the printed new job's `result.json`, `baseline-light.json`, `baseline-detail.json`, `backend-light.json`,
`backend-detail.json`, worker custody files and `telemetry.jsonl`. The child clone result also retains migration,
all-table preservation and owned-PG cleanup evidence. A missing/late/refused profile remains failed diagnostic evidence.

Both reference and detailed passes are SQL-prewarmed and run with telemetry/guards. Detailed instrumentation adds
cost; their difference is not a pure overhead estimate because cache and scheduling may vary. Neither pass certifies
the 60-second apply/HTTP budget. Use measured CPU and stage ownership to choose the next narrow repair or investigation;
do not start HTTP, real recovery, new maintenance, or later waves on the strength of this diagnostic alone.
