# W5 Actual-Model V2 Worker and System Telemetry

Status: implemented and checked; the new actual-model run has **not been executed**.
Parent owns execution, all real services, model calls, databases and custody.
Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
This delivery adds only the new wrapper, its tests, this report, check evidence and a cumulative manifest.
All existing helpers, source inventories, reports and results remain unchanged.

## Baseline evidence and decision

The parent executed the previously delivered read-only baseline diagnostic at:

`H:/TakiAgent/.trellis/.runtime/w5-actual-embedding-23075927a75543e4bfdb326a46bbbaaf`

Read-only review of its authorized reports verified result SHA256
`7ba2408a924a644e8afe6fd0453986c6029251cd03c62618db18e6e7c8835e9d`
and telemetry SHA256 `af869c1944f81de268406e9cefe8bfb957a235e00e25ca31be96149a8f439b11`.
The separate light/detail objects exactly match the embedded child report. The saved results report successful
direct-worker custody, complete read-only table/source/input/Core/original preservation, owned PostgreSQL stopped
and port released, with zero apply or model calls. This review did not independently reopen the databases.

| Baseline metric | Light | Detail |
| --- | ---: | ---: |
| Full baseline wall seconds | 14.4281977 | 14.7697609 |
| Process CPU seconds | 12.828125 | 13.3125 |
| Thread CPU seconds | 12.828125 | 13.3125 |
| SQL calls | 5927 | 5927 |
| Auxiliary rows | 36070 | 36070 |

Both full, native, application and auxiliary hashes match. Their full baseline hash is
`13d141ee800ce1004ed8d782ce700160da11cff73492c02aa0ae7753a26eafff`.
Detailed SQL awaited wall time sums to 2.7374565 seconds; it includes server execution, transport, driver and
scheduling, so it is neither PostgreSQL CPU nor an additive counterpart to process CPU.
Summed exclusive instrumented synchronous CPU is 8.296875 seconds and wall is 10.3464973 seconds.
Nested asynchronous durations remain inclusive and must not be summed.

The main exclusive synchronous CPU measurements were `tagged_bytes` 2.250 seconds (10005 calls), `decode_json`
2.1875 (25230), `current_state_hash` 1.21875 (4), `validate_body` 1.03125 (8446), `json_bytes` 1.015625 (16892),
and `parse_model` 0.46875 (12561). Windows CPU clocks are coarse; a small or quantized zero observation, including
`native_payload_hash`, does not establish negligible or zero cost.

The reader made 8446 byte requests, with 4223 full validations and 4223 verified-byte hits. Peak cache size was
8,543,936 bytes (about 8.15 MiB), 4223 entries, below the 64 MiB / 8192 limits. There is no demonstrated capacity
problem. Fresh decoding, schema checking and Source validation intentionally remain required on byte hits.

The largest SQL awaited groups were 1559 head reads (0.523470 seconds), the full ordered auxiliary memory-links
JSON read (0.4437431), 994 live memory-unit reads (0.3161563), 976 entity reads (0.2593192), 558 ordinary body
metadata reads (0.1887639), 562 native document source reads (0.1752299), 562 document payload reads (0.1731211)
and 558 ordinary body-parts reads (0.1579654).

| Sample-window observation | Whole run | Light baseline | Detail baseline |
| --- | ---: | ---: | ---: |
| Samples | 171 | 28 | 29 |
| Window wall seconds | 86.735 | 13.968 | 14.469 |
| Aggregate system CPU capacity seconds | 1735.5625 | 279.984375 | 289.03125 |
| System busy CPU seconds | 213.75 | 32.890625 | 32.140625 |
| Whole-system busy percent | 12.3159 | 11.7473 | 11.1201 |
| Worker CPU seconds | 66.09375 | 12.4375 | 13.0625 |
| Worker one-core occupancy percent | 76.20 | 89.04 | 90.28 |
| Exact observed PostgreSQL backend CPU seconds | unavailable | 1.703125 | 1.625 |
| Backend one-core occupancy percent | unavailable | 12.19 | 11.23 |

`GetSystemTimes.kernelIncludesIdle` includes idle. Aggregate capacity is the delta of kernel-including-idle plus
user; busy subtracts the idle delta. CPU ticks divided by 10,000,000 give CPU seconds. Process CPU divided by wall
is one-core occupancy, not whole-system utilization. Approximately 20 logical CPUs are inferred from capacity;
this is not an independently sampled hardware declaration. Sampling windows are narrower than exact pass durations.
The baseline connections had distinct verified backend PIDs: light 20588 and detail 28232.

Whole-worker CPU includes clone, migration, proof, setup and cleanup, not just baselines. Its sampled working-set
peak was 523.68 MiB and private peak 986.69 MiB. The baseline windows had no worker read/write bytes, with other-I/O
deltas approximately 15.35 / 16.01 MB and page-fault deltas 51659 / 54236. PostgreSQL read-byte deltas were
58,335,232 / 32,759,808, write-byte deltas 32,817,152 each, and page-fault deltas 21487 / 21206.
Page faults include soft faults and do not prove disk paging. Process I/O counters are not physical disk throughput;
read-only SELECT can involve internal temporary sort/storage activity. These counters are not application data
mutation evidence, and full table hashes were preserved. No observation errors were reported.

This no-model baseline is Python-CPU dominated and does not show whole-system CPU saturation during its run.
It does not establish why the earlier actual-model V2 baselines took 34.561 / 33.457 seconds. That actual-model
apply took 117.236 seconds, with 68 documents encoded in 5.207 seconds and initialization separately reported as
76.635 seconds. Its first baseline precedes encoding. Model initialization effects and historical system load remain
unisolated; neither model-thread contention nor a historical load explanation is proven.

One unchanged actual-model V2 execution with lightweight worker/system counters is more discriminating than a
speculative production cache change. Mandatory proof costs remain, but the measurements do not demonstrate a
small safe patch with sufficient complete-request headroom. Do not drop validation, share caches across views,
increase cache/timers, or infer complete apply performance from an isolated baseline pass.

## Wrapper contract and source inventories

`w5-candidate-actual-embedding-telemetry.py` composes the existing frozen V2 wrapper and the existing `Sampler`.
It records exactly one V2 job through a module-local `start_worker` delegate. A module-local facade replaces only
the imported runner's `control.supervise`, wrapping its phase reader to sample worker/system counters at the
existing 0.5-second watchdog cadence. The original launch, child executable, request, real model/device, clone,
watchdog, timing limits, preservation and owned cleanup remain unchanged.

The wrapper does not observe PostgreSQL backends. V2 connection-pool ownership does not expose the baseline-only
verified backend contract, so guessed backend PIDs and postmaster attribution are excluded. Unexpected `baseline`
phase semantics are refused, backend samples must remain empty, and the result explicitly reports
`postgresBackendObservations="absent-by-design"`. No thread, affinity, power, model, timeout, TTL, lease or
production policy changes are made.

The new cumulative inventory inherits all 316 entries of `w5-baseline-readonly-profile-source-manifest.json`
unchanged, after independent size/hash verification. It adds that inherited manifest and this delivery's files,
deduplicates normalized absolute Windows paths, and excludes itself. Its inherited manifest hash remains
`2109f69f40d49085cb0087444c66cc836622fca94c4ef6da267b09bf9e5dda8f`.

Before and after execution, `verify_manifest()` independently verifies the new wrapper inventory. It also pins
the baseline and V2 manifests. It never assigns `control.MANIFEST`. The unchanged V2 parent/actual-model child
continue using their **300-entry V2 inventory**, SHA256
`9d327ad5a2b2dd9f551f6c7398d0192aa7f3375a6d3badc508c898e05d618e6f`.
The V2 child's reported hash and the new wrapper inventory intentionally differ; confusing them would misstate
what each process verified.

The original V2 `result.json` is read and its hash preserved; the new wrapper writes a separate
`telemetry-result.json`. It retains `v2DiagnosticSucceeded`, `directWorkerIdentityVerified` and
`nativeApplyBudgetPassed` as distinct observations, alongside unchanged watchdog, preservation and cleanup results.
The combined `diagnosticSucceeded` additionally requires matching verified wrapper inventories, positive telemetry
samples, no telemetry errors or backend samples, and the exact original V2 child manifest hash. Failure reports
contain exception classes only. A diagnostic can succeed while `nativeApplyBudgetPassed` remains false.
`httpOrAuthorityRecoveryProven` remains false: this run cannot authorize working-pair recovery by itself.
Default invocation neither verifies inventories nor executes a clone/model.

## Completed checks

Final commands, outputs and exit codes are stored in
`w5-candidate-actual-embedding-telemetry-checks/quality-final.json`.

| Check | Result |
| --- | --- |
| Scoped Ruff | PASS, exit 0 |
| Scoped Ruff format | PASS, both new Python files |
| Scoped ty using the Native Python 3.11 venv and source path | PASS, exit 0 |
| Offline wrapper unit tests | 4 PASS, 0.032 seconds |

Tests verify default no-op; separate failed-result reporting without modifying original V2 result bytes; preservation
of failed apply-budget status and refusal of source/telemetry errors; and unchanged launch/watchdog delegation with
distinct inventories. No real worker, model, PostgreSQL or corpus access occurred during these tests.
The previously applied trellis-before-dev/trellis-check rules remain satisfied for this task-only delivery.
No product contract or generated template changed, so no production spec update is required.

## Parent-only execution and remaining gate

After independent review of this delivery and its new cumulative source inventory, the parent can run:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-actual-embedding-telemetry.py --run-reviewed-clone
```

Read the printed job's separate `telemetry-result.json`, unchanged V2 `result.json`, `telemetry.jsonl` and original
worker/child evidence. Inspect complete apply/HTTP budget evidence independently of diagnostic success and account
for telemetry observer overhead. No PostgreSQL-specific attribution can be obtained from this wrapper.

W5 remains incomplete: sufficient actual complete-request margin must precede working-pair migration and ordinary
recovery of the existing admitted reentry. Actual per-Bank maintenance plans and budget review, full reentry and
activation/data audit, and independent W5 closure remain required before W6. This delivery neither starts later
waves nor repeats Local edits, consumes renewal, or claims manual acceptance.
