# C2a isolated Docker recovery fixture

This task-only fixture implements the [accepted recovery plan](../c2a-recovery-plan.md) and
[design clarifications](../c2a-recovery-design-review.md). Static checks are separate from actual
execution. Root owns preparation, runtime, evidence preservation and exact cleanup. The owner has
already authorized this isolated scope; the execution flag is a single-use guard, not approval.

R2 corrects only protected-tree scan ordering and uses the fresh token below. The failed first
recovery attempt, its consumed token and its frozen inputs remain unchanged.

The fault drops exactly one successful Host inject completion **before Core acceptance**, using
the existing in-memory E2E relay. It does not drop the inner Native socket ACK. The original Run
must settle `outcome_unknown` while the actual child stays alive. The fixture then kills/reaps its
Shell/helper and Core, reopens the same state, restarts only its original container, and requires
explicit fresh-startup admission. Marker persistence is filesystem evidence, never database proof.

## Fixed inputs and preparation

| Input/resource | Exact binding |
| --- | --- |
| Token | `775da07b-2b69-44a3-868c-2604423dac11` |
| Staging `S` | `G:/TakiAgent-c2a-docker-acceptance/recovery-775da07b-2b69-44a3-868c-2604423dac11` |
| Protected root `R` | `C:/taki-c2a-docker-recovery-775da07b-2b69-44a3-868c-2604423dac11` |
| Image tag | `taki-c2a-fake:775da07b-2b69-44a3-868c-2604423dac11` |
| Docker executable | `C:/Program Files/Docker/Docker/resources/bin/docker.exe` |
| Docker/engine | `29.0.1` / `93e8319e-24b7-4a7d-88f1-60923ad681e0` |
| Endpoint | `npipe:////./pipe/dockerDesktopLinuxEngine` |
| Cached base ID | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Entry | Existing Node 24.18.0; existing pinned debug `taki-node.exe`; unchanged copied installed Host |
| Image recipe | Unchanged Native `docker/standalone/Dockerfile.c2a-fake` and its eleven top-level bootstrap Python modules |

Root reuses its archived `command-runner.mjs` and the bounded first-case preparation procedure,
substituting only this token, roots and unique tag. Both roots and tag must initially be absent.
Keep the frozen `docker-acceptance/` directory and both consumed first-case tokens unchanged.

Before preparation/build, record numeric `gFree` and `cFree` in `S/baseline.json`; write the exact
token to `S/.c2a-docker-owner`; provision the empty client configuration and the separately scoped
Buildx configuration. Recheck the pinned engine, existing built-in `default` builder and cached
base. Reuse the hash-bound successful base probe only with unchanged inputs and preserve its
provenance in `S/base-probe.json`. Never start another probe or pull an image as fallback.

Compile only the existing tiny `fake-key-adapter.rs` to `S/fake-key-adapter.exe` with the already
installed compiler; no new Cargo target or Shell build. Build one uniquely labelled image from
the unchanged small context, using the existing fixed Docker executable/endpoint/Buildx config:

```text
docker --host <fixed-endpoint> --config S/build-config buildx build --builder default
  --pull=false --network=none --load --progress=plain
  --build-arg NATIVE_IMAGE=taki-hindsight-api:local
  --label taki.c2a.fixture=775da07b-2b69-44a3-868c-2604423dac11
  --iidfile S/image-id.txt --tag taki-c2a-fake:775da07b-2b69-44a3-868c-2604423dac11
  --file S/context/docker/standalone/Dockerfile.c2a-fake S/context
```

Use the argument-array runner, cleared environment and exact binary/input hashes from the prior
reviewed preparation; the display above is not an ambient-context shell command. No new dependency,
custom frontend, download, original Catalog/key/model or daemon operation is permitted. A timeout
leaves an unknown original build result to inspect, never a reason for a second build.

## Execution and decisive assertions

From `H:/TakiAgent`, with the fixed Node and the cleared child environment (`SystemRoot`, fixture
TEMP/TMP and the established safe WS flags), Root runs once:

```text
C:/Program Files/nodejs/node.exe
  .trellis/tasks/10-14-hindsight-managed-deployment/research/docker-recovery/run-recovery.ts
  --execute-approved-recovery
```

`S/recovery.started` is created with `wx`; it may never be removed/reset to repeat this case.
The launcher itself provisions `R` once using the existing protected fixture/buildHost scaffolding.
The second Core/Shell uses that same database, Catalog, payload, registration and `node-data/secrets.json`.
Its Shell connects directly to the new Core URL using the persisted device ID/token. The first relay
stays closed; no second Node pairing or permission reset occurs. A fresh operator pairs normally.

The relay matches the admitted inject request ID, complete control and resource/startup tuple.
Calling its existing `close()` within that exact response callback terminates the upstream before
the relay's forwarding branch. All preceding messages pass unchanged. The response callback catches
its own check failures so they cannot escape the event loop and skip fixture cleanup.

Require the actual Host `observed` fence, canonical unknown Run/Attempt outcome, captured/reaped
resident with the exact copied executable/argv, and identical live Native child PID/start identity
across Host/Core interruption and reopen. Read-only recovery preserves original attempts/steps;
registry revision may advance. No original permission or submission is replayed.

After seeding two non-secret fixed-path markers, one `restart --time 35 <original-container-id>`
must retain container/image/volume, remove the tmpfs marker, preserve the volume marker, and yield a
new unbound waiting startup with no fake child. Only bounded status reads may be polled. Repeating
the old start key still observes; one explicit `resumeStartup` must create fresh Run/Attempt/Effect,
C1 snapshot/control mapping, checkpoint and startup authorization for the new startup. The old
entry stays unchanged. Catalog digest/key version/selection/config stay stable; generation counters
need current validity, not numerical increase across Core boots. Repeating resume only observes.

The bounded stdlib `recovery-probe.py` reads only fixed marker/socket/mount paths and this container's
process argv/start identities. `seed` alone creates two small non-secret files; `read` never writes.
The unchanged first-case container scanner is reused only while a child is running.

Require resource-scoped events for one volume creation, one container creation, the initial start
plus one maintenance restart, and two submitter execs total. Capture pre-restart exec metadata before
the daemon may retire those exec IDs; preserve that evidence for the final combined count. Probe/control
execs are separate and do not establish grant counts. Public `deploymentReady` remains false.

## Limits, evidence and cleanup

Use the accepted fixed topology: network none, no ports, UID/GID 1000, one new volume and 8 MiB tmpfs.
Require G free >=20 GiB with growth <=2 GiB, C free >=1 GiB, R <=256 MiB/4096 files and data volume
<=64 MiB/1024 files. Each ordinary Docker reply is <=1 MiB; each Engine read <=64 KiB; each probe
reply <=16 KiB. The process probe examines at most 128 PIDs and never reads environment/memory.

Budget preparation/execution at 30 minutes plus five-minute cleanup, one build at ten minutes,
and this sequence at eight minutes. Preserve 90-second admission and 30-second Native shutdown;
the fake child still exits after 300 seconds. No mutation retry or deadline extension is added.

`S/recovery.json` retains per-phase safe identities, fault/Run evidence, original/new registry facts,
bounded container/volume events and exec metadata, marker hashes, scans and cleanup results. No
private frames, plaintext Catalog, key bytes, pairing credentials or raw relay traffic is exported.
Capture first failures and the exact launcher/probe/input hashes. Failed checks or cleanup fail the case.

Cleanup closes only the fixture operator/relay and reaps recorded Core/Shell/helper processes. It
rechecks registry/engine/container/image/volume ownership, stops the exact container with a 35-second
grace, verifies stopped state, removes its ID without force, then removes only its verified unmounted
volume. Remove the unique result tag only after ID/label/no-other-user checks; never remove the base.
Verify resource/tag absence, scan R and check its exact canonical path/token and absence of reparse
points before removing only R. Root preserves/verifies the evidence before the same checks/removal
of S. Unknown identities are retained for Root inspection, never adopted for deletion.

The full protected-tree scan runs after the owned stack exits and releases the Shell's exclusive
deployment.lock. Its after-stop completion is required for final PASS; no persistent file is skipped.

Root compares the original seven-container baseline and leaves Desktop/redis/arboris-app unaffected.
No shared daemon interruption, prune, broad cleanup, cache/VHDX reclamation or Git lifecycle action.
Inner Native ACK loss, inner create/start/submit faults, custody rotation, actual database, C1 service,
C2b and real-model/business-data/manual acceptance remain separate.

Static checks are Node syntax, scoped ESLint `--no-ignore`, R2's single-entry no-emit TypeScript,
Python AST, and scoped Ruff check/format. The launcher has a documented task-only file-size exemption
and one cohesive fault-closure size exemption; all other lint rules and production limits remain.
No behavior test, Core/Shell/Docker run, Host/image/Rust build or unchanged 182-case suite is part of
this implementation's static check phase. See [original self-check evidence](../c2a-recovery-self-check.md)
and the [R2 repair self-check](../c2a-recovery-r2-self-check.md).
