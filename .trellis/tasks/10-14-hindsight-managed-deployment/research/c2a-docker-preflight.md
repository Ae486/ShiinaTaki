# C2a Docker startup and read-only preflight

Date: 2026-10-14. **PASS for the authorized startup/metadata preflight only.**
The owner approved starting existing Docker Desktop after source staging cleanup, including possible
automatic startup of existing restart-policy containers. No build or active container mutation was approved.

Desktop and its backend were absent from the initial process inventory. Root started the pinned Desktop
executable with `WindowStyle Hidden` at 14:26:52 UTC. The fixed Linux engine became available; metadata
collection and the one corrected query completed at 14:29:09 UTC, within the five-minute preflight limit.

## Observed runtime facts

| Item | Actual value |
| --- | --- |
| Endpoint | `npipe:////./pipe/dockerDesktopLinuxEngine` |
| Engine identity | `93e8319e-24b7-4a7d-88f1-60923ad681e0` |
| Engine version/platform | `29.0.1`, Linux `x86_64` |
| Live restore | `false` |
| Cached Native candidate | `taki-hindsight-api:local`, listed size `6.4GB` |
| Immutable candidate image ID | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Candidate metadata | Linux/amd64, configured user `hindsight`, absent/null `Entrypoint` |

Eight existing containers were inventoried using only ID/name/state/restart-policy fields. Five were
exited, including `taki-hindsight-api` and `taki-hindsight-api-retest`. The running containers were:

| Name | Restart policy |
| --- | --- |
| `redis` | `always` |
| `arboris-app` | `unless-stopped` |
| `gpt-load` | `always` |

They were left untouched. Desktop remains running; no daemon stop/restart was issued. The same engine
is shared with these workloads, so the next small fixture must not include daemon interruption.

Queries used the fixed Docker client, explicit endpoint, a new empty client-config directory and a
cleared child environment. No unrelated container Env, logs, mounts, filesystem or data were collected.
No image was run/exported/built/pulled, and no container or volume was actively created/stopped/deleted.

## Retained first failure and correction

The first candidate metadata query failed because Docker omits an unset `Config.Entrypoint` key:
`map has no entry for key "Entrypoint"`. The corrected Go template uses `index .Config "User"` and
`index .Config "Entrypoint"`, preserving absent values as JSON null. Only that failed query was rerun;
the engine/container inventory and Desktop startup were not repeated. No production source changed.

The archive retains the original 17-command attempt, driver and error, followed by the successful
metadata query in the final 18-command record. Startup availability probes include their initial
connection failures; these are not omitted or reported as software regression tests.

## Evidence, cleanup and remaining work

- [Final runtime record](c2a-docker-preflight.json), SHA-256
  `82a85497b8b24aa4368ab05142d89b199f364daac4b985d2d402559d67c5c686`.
- [Six-file evidence archive](c2a-docker-preflight-evidence.zip), 9,325 bytes, SHA-256
  `62898f34c7efa2a849414f20635e1caa66baebfdf2fe636f4209cc853492c370`.
- [Final cleanup](c2a-docker-preflight-cleanup.json): after hash/CRC and exact-root checks, the owned
  G: preflight tree and empty client-config were removed (43,397 logical bytes). No reparse point was
  traversed. Desktop was deliberately left running; its background storage is not claimed reclaimed.

At query completion, observed G: use had increased 32,399,360 bytes, below the 2 GiB threshold; this
includes concurrent Desktop/workload activity and is not an allocation attribution. Cleanup capacity
was C: 27,460,304,896, G: 144,982,904,832 and H: 13,104,541,696 bytes free.

The cached image's Python/venv contents and numeric runtime ownership are still unproven. The built-in
builder was subsequently inspected below; no image build was run. Image metadata is not consumer,
socket, database or model readiness. The prepared
source fixture remains fixed to a substitute Docker executable; the task-local launcher is delivered
under `research/docker-acceptance/` for a first actual admitted fake startup/repeat/owned-cleanup case.
Its [independent static review](c2a-docker-first-case-review.md) passed. Execution still requires separate
build/container authorization and the conditional cached-base probe; no container result is claimed.
The larger Docker fault/restart matrix, database, C2b, C3 and real business-data tests remain open.

## Read-only builder follow-up

The installed Buildx plugin is `C:/Program Files/Docker/Docker/resources/cli-plugins/docker-buildx.exe`,
version `v0.29.1-desktop.1`, SHA-256
`c8d20cd80c940cf866717dd938eca50dbe588e06e0c0ced5a9d97b06b27bf8a7`.
An empty isolated config does not discover it. A separate build-only config containing only
`{"cliPluginsExtraDirs":["C:/Program Files/Docker/Docker/resources/cli-plugins"]}` discovers the plugin;
the production Host runtime client-config remains empty.

This pinned plugin does not support `buildx inspect --format`. Plain `buildx inspect` succeeded and
showed the existing `default` builder, driver `docker`, one running node and BuildKit `v0.25.2`.
The displayed endpoint alias was `default`; `context inspect --format '{{json .Endpoints.docker.Host}}'
default`, with the same explicit host/config, resolved it to `npipe:////./pipe/dockerDesktopLinuxEngine`.
Both initial failures and the successful queries are retained. No bootstrap, build or container mutation
was performed. Before any separately approved build, recheck this driver/engine and the cached tag's
immutable ID. Missing local prerequisites stop the case; no download or alternate builder is implied.

[Builder record](c2a-docker-builder.json) retains the commands and results.
The [ten-file builder archive](c2a-docker-builder-evidence.zip) is 5,864 bytes, SHA-256
`5fb1f4c5a55872cd3876f7b5252970b1d9f3ef93b4c989d83bb77589856f0f16`.
Its owned G: staging/config tree was removed after preservation, reclaiming 10,639 logical bytes;
`cleanup.state` is `complete`. Actual base contents and the no-download build remain untested.
