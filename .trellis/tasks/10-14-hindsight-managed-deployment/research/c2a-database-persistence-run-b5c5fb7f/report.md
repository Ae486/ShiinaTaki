# C2a bounded persistence experiment

RUN A **PASS**. Token: `b5c5fb7f-cd8a-402a-bd11-92839d191e98`. RUN B was not run because A passed.

One build (1488 ms), one launcher invocation (79204 ms), 1,200,000 ms launcher deadline, cleared host environment. `tsc --noEmit` passed. `deploymentReady=false`.

## Launcher JSON

```json
{
  "caseId": "b5c5fb7f-cd8a-402a-bd11-92839d191e98",
  "passed": true,
  "ownedRuntimeCleanup": true,
  "evidence": "G:\\TakiAgent-c2a-database\\persistence-b5c5fb7f-cd8a-402a-bd11-92839d191e98\\persistence.json",
  "deploymentReady": false
}
```

## Database and shutdown facts

| Fact | Generation 1 | Generation 2 |
| --- | --- | --- |
| Ready | ready | ready |
| Startup ID | 22d19eb0-85c2-46a3-aa25-4ab3f6feb8e1 | 0b5ed4d3-d4cc-45ae-ab1f-2d6fac85411a |
| Seed committed | true | false |
| Row count / bytes / persistence | 1 / 4096 / p | 1 / 4096 / p |
| Fresh-connection verification flag | true | false |
| First failure | None | None |
| Stop / shutdown | stopped / checked | stopped / checked |
| Container ExitCode / OOMKilled | 0 / false | 0 / false |
| Owned descendants remaining | 0 | 0 |
| Volume scan | complete; 0 hits | complete; 0 hits |

Both row hashes: `c60fc4e1c054d14adb9d4564334dea60ce77ffd0febccccbe46463c78f37b491`. Same cluster system identifier: `7697995033832337490`. Generation 2 retained the original manifest and read the original committed row.

Engine clock: `2026-10-18T13:11:53.189773094Z` through `2026-10-18T13:12:46.200864242Z`.

Effects: `{"containerCreate": 1, "volumeCreate": 1, "containerStart": 2, "containerStop": 2, "privateSubmit": 2, "pg0Initialization": 1, "rawPostgresRestart": 1, "source": "actual resource events, exec metadata, protected registry and both generation reports"}`.

## Evidence SHA-256

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| [persistence.json](persistence.json) | 646337 | `ee55accdf40015de0834b9b977b44e9f83c752a2a3e0c8a0a9ad7761c9bb2120` |
| [launcher-result.json](launcher-result.json) | 778 | `38b3ff49836c36ad91d640b55e6ac832f528b87da20d3e99f9b65778be17fe45` |
| [launcher.stdout.log](launcher.stdout.log) | 223 | `b4878e065c55cb57e0c81059e326e53487b1210c6a9e3b2c0beac94820797303` |
| [first-stop.json](first-stop.json) | 59210 | `4da40402f542c49403e1d20d1423b42743684b5aa739e52656d98b00256465a5` |
| [final-stop.json](final-stop.json) | 58267 | `7846c7479d8d3ef95d3b1fec22f44e967286455d05037f19da1029935b7cc8e5` |
| [context-manifest.json](context-manifest.json) | 5674 | `1a2861cd9148611264d5553524b0ea61abec0678c3a1e4c62afd851e9aca8da9` |
| [stage-archive-manifest.json](stage-archive-manifest.json) | 9606 | `f22cf2da4509ab8d170b785c40b48245580d151a11c6dd5b04513763fdf41bab` |
| [final-audit.json](final-audit.json) | 21070 | `44b49dd4c3cdc94b4eda098d8f5e4bec37b9f7bf78279403ef2368064369b693` |
| [leftover-13-archive-check.json](leftover-13-archive-check.json) | 27781 | `fefd605619e10a9e2e23765b750366dcdd5d28192c9f2a0c0e7f4e375a24490d` |
| [diagnostic-manifest.json](diagnostic-manifest.json) | 1456 | `1c754040700b1ca80f60f5ecd382beb1d2c49dbaa1ce25653c4687f8aad57a69` |

Full original/copy hashes and byte-only token substitution facts are in `diagnostic-manifest.json`; all retained evidence hashes are in `evidence-hashes.json`. The manifest filename is inherited from the owner runner and does not indicate diagnostic instrumentation in RUN A.

## Cleanup

- RUN A: all 53 staging files (2719266 bytes) archived and rehashed before removing S. W, fixture container/volume and tag are absent.
- Prior 1b05d2f6: all 52 files (2,082,458 bytes) already archived and rehashed before staging removal. Prior W, fixture container/volume and tag are absent.
- Prior 13f04d85: all 60 original staging files remain byte-identical. 33 files lack matching archived bytes; no deletion or supplemental archival was performed. Its W, fixture container/volume and tag are absent.

Files missing identical archived bytes:

- `.c2a-docker-owner`
- `adapter-build.json`
- `baseline.json`
- `build-command.json`
- `build-config/buildx/.buildNodeID`
- `build-config/buildx/activity/default`
- `build-config/buildx/refs/default/default/enj5zv97c6elqdfc8i4h3ztkz`
- `build.started`
- `built-image.json`
- `command-runner.mjs`
- `commands.jsonl`
- `context/docker/standalone/managed_bootstrap/fake_child.py`
- `failure-stop.json`
- `fake-key-adapter.exe`
- `fake-key-adapter.pdb`
- `final-stop.json`
- `image-id.txt`
- `launch-persistence.mjs`
- `launcher-command.json`
- `persistence.json`
- `persistence.started`
- `prepared-inputs.json`
- `recover-event-evidence.mjs`
- `reused-base-probe.json`
- `reviewed-fixture/c2a-database-persistence-r2-self-check.json`
- `reviewed-fixture/c2a-database-persistence-r2-self-check.md`
- `reviewed-fixture/docker-database/database-read.py`
- `reviewed-fixture/docker-database/fake_child.py`
- `reviewed-fixture/docker-database/run-persistence.ts`
- `root-event-recovery.json`
- `root-post-run-readback.json`
- `root-preparation-check.json`
- `runtime-prerequisites.json`

## Eight-container deltas

ID, status, StartedAt, FinishedAt, RestartCount, image ID and running state are unchanged for every container. The complete before/after values are in `final-audit.json`.

| Container | Before/after status | Changed fields |
| --- | --- | --- |
| taki-openbili-backend | running | none |
| taki-hindsight-api-retest | exited | none |
| taki-hindsight-api | exited | none |
| redis | running | none |
| my_pgvector | exited | none |
| rustfs_loacl | exited | none |
| rpa-redis | exited | none |
| arboris-app | running | none |

## Interpretation

The reviewed fixture passed this fresh bounded run. This does not prove why the earlier /proc PermissionError occurred or rule out intermittency. B was deliberately not entered. No deployment-readiness claim is made.
