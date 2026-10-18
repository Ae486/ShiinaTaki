# Database persistence experiment: failed, no retry

Case: `1b05d2f6-494c-4a6d-a601-1e807eca1486`. One build and one launcher invocation completed. The frozen source files were not modified or re-reviewed. No Git writes, daemon restart or prune were performed. Eight pre-existing containers retain identical IDs, start times and states.

This turn resumed the exact same marked preparation created at 2026-10-18T12:29:53.942Z. Its preflight records both roots and tag absent before preparation. Before continuing, all frozen inputs, all 109 accepted source entries, the 12 staged context files and all eight container baselines were verified again. No build or launch fence existed.

## Result

| Item | Result |
| --- | --- |
| Build | One invocation; exit 0; 1883 ms |
| Image ID | `sha256:cc83b52be0970d6dc4929786d59ca99fe52a86540c55934797af2f3afba3b8bf` |
| Launcher | One invocation; exit 1; 54293 ms; 1,200,000 ms deadline |
| casePassed / deploymentReady | `false` / `false` |
| failureStage | `first-database-readiness` |
| failureCode | `UNEXPECTED_FAILURE` |
| Child first failure | `{"stage":"start_and_sql","type":"PermissionError","detail":"operation_failed"}` |
| Exact launcher assertion | Not retained: no exception message, stack, expression or operands in the frozen output |
| Pass 1 create/start/stop/die event counts | Unavailable; event collection was not reached |
| Pass 2 create/start/stop/die event counts | Unavailable; second generation was not reached |
| Event-backed submit count | Unavailable; registry separately records 1 observed inject attempt |
| Exec metadata count | Unavailable; 0 metadata records retained, not a claim of zero executions |
| finalStop | Not reached; no final-stop.json |

Latest readiness values: `{"expectedGeneration":1,"expectedStartupId":"8f2b3d9b-0f7f-4ce9-8d0a-0855875d837b","recordedAt":"2026-10-18T12:35:49.233Z","current":null,"manifest":null,"dataExists":true,"intentExists":true,"wrapperCount":1,"postgresCount":0,"marker":{"pid":65,"startupId":"8f2b3d9b-0f7f-4ce9-8d0a-0855875d837b","state":"running"}}`.

The child reached PostgreSQL 18.1 and returned a metadata SQL result, then retained PermissionError in start_and_sql. The exact failing operation and OS error text were not preserved; no more specific cause is claimed. Failure-stop status is failed. Shutdown records `{"state":"checked","system_identifier":"7697985627284971602","elapsed_seconds":0.144,"postmaster_wait_kind":"adopted","logger_gone":false,"owned_descendants_remaining":0}`. This is failure evidence, not finalStop acceptance.

## Launcher JSON, verbatim

```json
{"caseId":"1b05d2f6-494c-4a6d-a601-1e807eca1486","passed":false,"ownedRuntimeCleanup":true,"evidence":"G:\\TakiAgent-c2a-database\\persistence-1b05d2f6-494c-4a6d-a601-1e807eca1486\\persistence.json","deploymentReady":false}
```

## Verified SHA-256 values

| Input | SHA-256 |
| --- | --- |
| `H:\TakiAgent\.trellis\tasks\10-14-hindsight-managed-deployment\research/docker-database/run-persistence.ts` | `c39fd6e465f922cefd198abe1e6d531d731359f8969b183ae9b5b4d2cf06ee27` |
| `C:/Program Files/Docker/Docker/resources/bin/docker.exe` | `0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d` |
| `C:/Program Files/nodejs/node.exe` | `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| `H:/TakiAgent/apps/desktop/src-tauri/target/debug/taki-node.exe` | `1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9` |
| `H:\TakiAgent\.trellis\tasks\10-14-hindsight-managed-deployment\research/c2a-implementation-source-manifest.json` | `f27379be3b4b5e61e1b2821c2eda2d87bf54e5c2983b034bdb637ee789961ae2` |
| `H:\TakiAgent\.trellis\tasks\10-14-hindsight-managed-deployment\research/docker-database/database-read.py` | `4bd830c60a4ddecc4e8e7018d2b19eb08093c81fc5d7f3ee0a8ff380178e4271` |
| `H:\TakiAgent\.trellis\tasks\10-14-hindsight-managed-deployment\research/docker-database/fake_child.py` | `9d65b8875e5d798a024dff9b4a182d6cff7bf4b62646954e38cd0c2e12ce3819` |
| Whole 12-file context | `a20096ec28ce8181ba0b1e52375a99701abae7fafa5c40234607d773ca015a54` |

Whole-context hash encoding: sorted `{path,bytes,sha256}` entries serialized with JSON.stringify, followed by one LF. It equals the R2 self-check afterExpectationSha256. CASE appears once in each frozen file, at launcher line 32, reader line 18 and child line 23.

## Engine and Windows clocks

Persistence engineClock: `{"first":"2026-10-18T12:35:23.857459982Z","last":"2026-10-18T12:35:23.857459982Z"}`. first equals last because per-pass inspection was never reached.

| Snapshot | Engine | Windows request interval | Engine ahead, millisecond bounds |
| --- | --- | --- | --- |
| before | `2026-10-18T12:29:54.613326017Z` | `2026-10-18T12:29:53.943Z` to `2026-10-18T12:29:54.113Z` | 500 to 670 ms |
| after | `2026-10-18T12:36:16.814151137Z` | `2026-10-18T12:36:15.999Z` to `2026-10-18T12:36:16.157Z` | 657 to 815 ms |

## Preservation and cleanup

All 52 staging files and 15 directories (2082458 file bytes) were copied to this evidence directory; all source and destination SHA-256 values match stage-archive-manifest.json. S remains at `G:/TakiAgent-c2a-database/persistence-1b05d2f6-494c-4a6d-a601-1e807eca1486` under the failed-run preserve-all instruction. The launcher performed its approved cleanup: exact fixture container and volume, image tag and W are absent. Their absence was independently checked. No manual deletion followed the failure.

| Existing container | ID before = after | StartedAt before = after | State before = after |
| --- | --- | --- | --- |
| taki-openbili-backend | `1e389e0a2f95121ca804c186c20916196e9e46f67a7691c3d184404a7292deb8` | `2026-10-18T05:55:39.597065125Z` | running |
| taki-hindsight-api-retest | `c07d86d32382757d292dd4ebf318e6c44260c817d95f35187663d4d33a26b865` | `2026-08-18T16:47:39.697781196Z` | exited |
| taki-hindsight-api | `a38b49e64f74ee4fa4f5cf5531e467d74dda2b64dc7e28e78a9bdadd37272519` | `2026-08-18T14:11:54.085514229Z` | exited |
| redis | `8f5e4468c3a7c0100330e012fdca3da843abfcc732361b71308f06d6eeada5c2` | `2026-10-18T04:36:51.09898313Z` | running |
| my_pgvector | `7992fb2bba71e13dc290e305941ded32b9046c1ec4b67a3697863ff79079cf8b` | `2026-04-11T08:18:53.87731237Z` | exited |
| rustfs_loacl | `ba11af042db0879902996426522611b267f38eab7d21f05e21036929c415cc24` | `2026-04-11T08:18:55.176936785Z` | exited |
| rpa-redis | `9d4fc8fb7a4869ac422d9e78a924b49e698e61a562de3af7576dfd18ef81cd98` | `2026-02-20T17:46:12.832921192Z` | exited |
| arboris-app | `697330c3cd8966e02d97fa228c5233a0805531bff00275107630e34fadda0b1a` | `2026-10-18T04:36:51.09648348Z` | running |

## Free-space snapshots

Before: 2026-10-18T12:29:53.942Z. After: 2026-10-18T12:37:38.895Z. These are whole-drive snapshot deltas and include concurrent system activity; they are not exclusive experiment storage measurements.

| Drive | Before bytes | After bytes | Delta bytes | Delta MiB |
| --- | --- | --- | --- | --- |
| G: | 138496249856 | 138393313280 | -102936576 | -98.167969 |
| C: | 25590050816 | 25587347456 | -2703360 | -2.578125 |
| H: | 2377773056 | 2374828032 | -2945024 | -2.808594 |

## Evidence hashes

| Relative path | SHA-256 |
| --- | --- |
| [persistence.json](persistence.json) | `e7fce21aeb548f873bab59e4bbab701eb2a5ff840ec81f94a6a621247159eb3a` |
| [launcher.stdout.log](launcher.stdout.log) | `52c80384afb127bd199a960cdef3aa32043e23a4480929242475889bc35a1f3c` |
| [launcher.stderr.log](launcher.stderr.log) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| [launcher-result.json](launcher-result.json) | `6356c7553369920de274abf8cae87f6b5ed9010c75b56b070b97e8c3e2c2fd48` |
| [build-result.json](build-result.json) | `a3781df6b50c579cc1221246bfea4b38ee01d6da120bd3fdd3978a4e05ea70df` |
| [image-id.txt](image-id.txt) | `636128809287f19d4960080b709f3eff79be27e8ad38f7386458d63529aaf203` |
| [result-image.json](result-image.json) | `17b478f8a7c038531debaf6d78535130a6af7167771bc6b258362851cf51cca4` |
| [failure-stop.json](failure-stop.json) | `c8bd0e59d6c269d10566fd2fcf4add54e7dda331d10bd6bde5581099b0438871` |
| [context-manifest.json](context-manifest.json) | `42782de496a0eb90f7d22f9968804affb3182257570f37c6c0a43ccd5c5dfaa8` |
| [stage-archive-manifest.json](stage-archive-manifest.json) | `47e32b153dabdfc99c51717888a172d31f903419ccc5accacce50cc46eedf86e` |
| [verified-inputs-before-launch.json](verified-inputs-before-launch.json) | `4048422d35dd7001de1b74c77f37318b78035dff3051f104566fffc1d1a17e72` |
| [preflight.json](preflight.json) | `7bc5ae9de43999aba998d6309c4127d282c59aeba986cef42ba4a20c9741e765` |
| [resume-preflight.json](resume-preflight.json) | `7045ead5f622e918df9d5ff89f1faec269d523b7812cb3e0d092bd68de1cbc09` |
| [post-run-verification.json](post-run-verification.json) | `6ed11dd9fadea9ed7d56917fff100a28450ee1f60743dfb42307491c60a5618c` |
| [final-audit.json](final-audit.json) | `8d7f527dfd594f4d1236c9e899f0584596a4ef6d9a4dadbb5e7e2e7ec23653c3` |
| [commands.jsonl](commands.jsonl) | `e2be5bbf25d0c835ed157a81a3a7e45323222d1c6e0cfffbfc602101ee303d02` |
| [owner-commands.jsonl](owner-commands.jsonl) | `fafada63caa4f3173e4bd72f21e1853e18ba9e399cf59b174cadef5dfa9553c2` |

Full structured report: [report.json](report.json). Full archive listing and hashes: [evidence-hashes.json](evidence-hashes.json).
