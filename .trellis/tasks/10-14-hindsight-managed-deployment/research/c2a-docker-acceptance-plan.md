# Research: C2a real Docker fake-consumer acceptance proposal

- Query: What is the smallest reviewable next Docker experiment after C2a SOURCE PASS?
- Scope: internal source and offline Windows preflight; proposed runtime actions only.
- Date: 2026-10-14.
- Task authority: Root explicitly assigned this task directory. The empty legacy `.trellis/.current-task` was not changed.
- Status: C2a SOURCE PASS, startup/read-only preflight PASS, first-case static PASS and the owner-approved bounded actual Docker runtime PASS are recorded. The original first attempt and corrected R2 evidence are preserved. Read [the executed result](c2a-docker-first-case-acceptance.md) and [final independent runtime-evidence PASS](c2a-docker-runtime-review.md). The broader fault/restart/database sequence below remains deferred and is not covered by the first-case result.

The body below preserves the original proposal and dated preflight observations. Current execution,
cleanup and environment state are in the linked result and [current handoff](leader-now.md). Both attempt
tokens are consumed and their staging trees are removed; historical paths and prerequisite-pending wording
must not be treated as fresh execution inputs. The first case established the compatible cached runtime
and local build; it did not execute the broader fault/restart/database sequence.

## Findings

### Completed authorized step: startup and read-only preflight

Root executed this step after source cleanup and the owner's explicit approval. Read the
[preflight result](c2a-docker-preflight.md) and its retained raw evidence. The fixed Linux engine is
`93e8319e-24b7-4a7d-88f1-60923ad681e0`, version 29.0.1, Linux/x86_64 with live restore disabled.
Cached `taki-hindsight-api:local` is
`sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db`, Linux/amd64, user
`hindsight`, null/absent Entrypoint. Three unrelated containers are running; Desktop is left running.
Their daemon must not be interrupted by the next small fixture.

The [read-only builder follow-up](c2a-docker-preflight.md#read-only-builder-follow-up) observed the existing
`default` builder with driver `docker`, one running node and BuildKit `v0.25.2`. Its `default` endpoint alias
resolves to the fixed Linux engine pipe. Buildx `v0.29.1-desktop.1` requires a separate build-only config
with `cliPluginsExtraDirs` pointing to the installed Docker plugins; Host runtime config stays empty.
The [builder record](c2a-docker-builder.json) retains discovery/format failures, successful metadata queries
and completed staging cleanup. No builder bootstrap, image build or download ran. Recheck the pinned
driver/engine/base immediately before an approved build and stop if the local prerequisites are missing.

The approved first-case scope was one actual fake-consumer startup, same-key repeat/original observation,
scans and exact owned cleanup. It completed successfully after the isolated debug Shell fixture correction.
The broader fault/restart sequence below remains deferred; it was not executed by this experiment and
does not authorize interruption of the shared daemon or unrelated workloads.
The delivered [first-case fixture](docker-acceptance/README.md) pins the exact probe/build/launch commands,
case roots, resource names, observed capacity limits and owned cleanup. Its
[independent static review](c2a-docker-first-case-review.md) passed, including scoped syntax/AST/lint/types.
The [review evidence](c2a-docker-first-case-review.json) pins all five final files. This completes the
preparation gate for the first case only. The owner's subsequent authorization and actual runtime result
are retained in the result report above; the historical proposal is not a replacement for those records.

Root's 2026-10-14 source readback confirms that the installed source-check fixture cannot be switched
to a real engine by an existing environment flag. `deployment-installed-fixture.ts:78-81` builds
`fake-docker.exe`, writes its private pipe location and always creates `DockerCommandFixture`.
`deployment-installed.test.ts` explicitly asserts that substitute's counters and child markers.
Its successful execution is not a ready real-Docker acceptance launcher. No executable real-engine
fault/scanning harness was delivered by C2a source work.

The approved step below was limited to startup/preflight after independent SOURCE PASS. It did not
authorize the later build/container/restart experiment before its launcher exists. It resolved the
engine/cache metadata needed to finish that small fixture, without creating a protected Core/Catalog
installation, fake image, container, volume or database.

All Docker queries use the fixed client, explicit `--host npipe:////./pipe/dockerDesktopLinuxEngine`
and `--config G:/TakiAgent-c2a-docker-acceptance/2026-10-14-r1/client-config`. Create this new empty
client-config only inside a newly marked owned staging root. Run the client with a cleared environment
retaining only required Windows system/temporary-directory values; do not load ambient Docker contexts,
credential helpers or provider configuration. The proposed staging root was still absent at Root's readback.

| Order | Exact action / bounded output |
| --- | --- |
| 1 | Recheck the file hashes below, initial Desktop processes and C:/G:/H: capacity. Preserve the before-state and mark the new G: staging root. |
| 2 | If Desktop is not already running, `Start-Process -FilePath 'C:/Program Files/Docker/Docker/Docker Desktop.exe' -WindowStyle Hidden`. This may automatically start existing restart-policy containers; that effect must be included in the startup approval. |
| 3 | With the explicit client arguments above, `info --format '{"id":{{json .ID}},"os":{{json .OSType}},"architecture":{{json .Architecture}},"version":{{json .ServerVersion}},"liveRestore":{{json .LiveRestoreEnabled}}}'`. Wait at most three minutes for the engine; each query has a ten-second process timeout. |
| 4 | `container ls --all --no-trunc --format '{{json .ID}}'`, then for only those returned IDs, `container inspect --format '{"id":{{json .Id}},"name":{{json .Name}},"status":{{json .State.Status}},"restartPolicy":{{json .HostConfig.RestartPolicy.Name}}}' <returned-id>`. No unrelated Env, mounts, logs or data are collected. |
| 5 | `image ls --no-trunc --filter 'reference=taki-hindsight-api:*' --format '{"id":{{json .ID}},"repository":{{json .Repository}},"tag":{{json .Tag}},"size":{{json .Size}}}'`. For a returned candidate ID only, inspect its ID, OS, architecture, configured user and entrypoint; do not export layers or run the image. An empty result is a missing prerequisite, not permission to pull. |
| 6 | Save sanitized engine/workload/cache facts to the owned G: `preflight.json`, copy that small evidence into this task, and remove only the new empty client-config after checking its resolved path/ownership. Leave Desktop running and report its state; this request contains no daemon stop/restart. |

Cap this preflight at five minutes, 64 MiB of its own staging, a 2 GiB observed increase in G: use and
at least 20 GiB free on G:. These are observed stop thresholds, not filesystem quotas on Desktop or
automatically started workloads. A limit/missing dependency/client failure stops new work and is
reported without download, upgrade, broad cleanup, Docker prune or any H: build. Existing workloads
remain untouched. No Ubuntu launch or global WSL action is part of this request.

Image metadata does not establish compatible Python/venv contents. The later read-only builder follow-up
establishes the available built-in driver, but the actual no-download build remains untested.
Do not describe the first case as executable until its admitted launcher, scan and owned-cleanup controls
have passed their independent static review. Broader fault controls belong to the deferred matrix.

Offline file pins re-read by Root (no daemon call):

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `C:/Program Files/Docker/Docker/resources/bin/docker.exe` | 41758128 | `0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d` |
| `C:/Program Files/Docker/Docker/Docker Desktop.exe` | 12855216 | `9724d12592d638a097bab25a48c016fcc7a887099fd9a3a709ede0a50544062d` |
| `C:/Program Files/nodejs/node.exe` | 92534088 | `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| `apps/desktop/src-tauri/target/debug/taki-node.exe` | 9058816 | `1ed31593324eaea703590e6dd12b348dfe99c38c7530207b12c89300e8a582c9` |
| `H:/hindsight/docker/standalone/Dockerfile.c2a-fake` | 555 | `2be1279ef4621f5d42397879fab2e436d780224eb3c02d591180faf9e9a9fcff` |

The 109-file [source manifest](c2a-implementation-source-manifest.json) pins the copied bootstrap inputs;
the independent checker has released SOURCE PASS with 182 passing tests and no source edits.
The [source acceptance](c2a-source-acceptance.md) and [preservation record](c2a-root-final-readback.json)
retain the final identities and test boundaries. Current C:/G:/H: free
space at that pre-execution snapshot was about 25.85/135.06/12.21 GiB; the result report has the later
readback. The startup/preflight ran and its small owned staging was preserved then removed.

### Decision and present evidence

Use the reviewed Windows Shell / resident Node Host / isolated same-machine Core and Catalog chain against the fixed local Linux/amd64 endpoint. Prove delivery to the actual fixed fake child, original-resource recovery and the Docker restart/tmpfs boundary. Keep database acceptance separate and open.

The following are offline observations made during this research, not daemon evidence:

| Item | Observed value |
| --- | --- |
| Node | `C:/Program Files/nodejs/node.exe`, `v24.18.0` |
| Docker client | `C:/Program Files/Docker/Docker/resources/bin/docker.exe`; `docker --version`: `29.0.1`, build `eedd969` |
| Docker Desktop | `C:/Program Files/Docker/Docker/Docker Desktop.exe`; file version `4.53.0.211793` |
| Desktop CLI plugin | `resources/cli-plugins/docker-desktop.exe` exists; command support was not tested |
| WSL | `Ubuntu-22.04` and `docker-desktop`: Stopped, WSL2 |
| G: / H: free | `150,005,952,512` / `14,078,898,176` bytes; refresh before execution |
| Docker VHDX files | `G:/DockerDesktopData/DockerDesktopWSL/main/ext4.vhdx` (`100,663,296` bytes); `disk/docker_data.vhdx` (`38,879,100,928` bytes) |
| Proposed staging root | `G:/TakiAgent-c2a-docker-acceptance/2026-10-14-r1`; absent when checked |

During the researcher's original offline pass, no `docker version`, `info`, `ps`, `inspect`, build, pull or daemon connection was performed and Docker/WSL/services were not started. Root's later approved startup and metadata queries are recorded above. Existing registrations, Catalogs, keyrings and credentials were not read. Installed client/Desktop versions and VHDX file existence alone do not establish usable consumer runtime behavior.

Later source-fixture inspection found Authenticated Users Modify on `G:/`, so the unchanged Windows
ancestor verifier refuses protected installation/custody/state beneath that drive. Keep ordinary build
staging and sanitized evidence on G:. The protected copied runtime/payload, fake Core/Catalog and Host
registrations/state instead need a fresh marked `C:/taki-c2a-docker-fixture-<uuid>` tree, following the C1
fixture pattern. Freeze its exact path, capacity and ownership before requesting execution; do not repair
drive/ancestor ACLs or weaken verification. This is an updated placement precondition, not a created tree.

### Files, patterns and governing contracts

Task-local paths below are relative to `.trellis/tasks/10-14-hindsight-managed-deployment/`.

| File | Relevant pattern / use |
| --- | --- |
| `design.md:57-85` | Stable Run admission and durable lookup before new custody; repeats observe the original deployment. |
| `design.md:89-118` | Real Run/Attempt/Effect authority, final live Core checkpoint and independently installed Native grant. |
| `design.md:131-146` | Host rejects values outside `C2A_FAKE_[0-9a-f]{64}` before checkpoint/grant/frame; Native independently enforces fake-only input and owns the real child. |
| `design.md:153-176` | Registered executable/endpoint/image, fixed resources, explicit vacant record and durable dispatch fences. |
| `research/c2a-design-review.md` | Design-only PASS, resolved R1/R2 and separate source/runtime gates. |
| `implement.md` | Source, packaging and independent-check prerequisites; separate Docker authorization. |
| `H:/hindsight/docker/standalone/Dockerfile.c2a-fake:3-9` | Source-reviewed recipe takes `NATIVE_IMAGE`, copies only `managed_bootstrap`, installs it with `/app/api/.venv/bin/python`, selects UID/GID `1000:1000` and the fixed `managed_bootstrap.owner` entrypoint. Its source hash is pinned above; no image has been built from it. |

Related specs read: `.trellis/spec/backend/index.md`, `hindsight-host-custody.md`, `host-operation-lifecycle.md`, and `logging-guidelines.md`. They require protected installation/custody, actual authenticated Host generations, no replay after unknown outcomes, bounded value-free evidence and separate process/Docker/database claims. `.trellis/workflow.md` requires persisted research and reviewed gate transitions. There is no `.trellis/spec/index.md`; the backend index is the applicable entry point.

External references: no external documentation or registry was consulted. Version evidence is limited to the local client and Desktop file metadata above. Historical Hindsight acceptance supplies only reminders to check consumed Linux entrypoint bytes and reconcile a timed-out build before retrying; it supplies no current image, engine or database proof.

### Final bindings required before execution

SOURCE PASS and the concrete startup/preflight commands above are available. The later container experiment still requires its executable command/ownership manifest. Runtime-only facts may be discovered within the separately approved startup/preflight stage; unknown values below are not preapproved facts.

| Binding | Required record / stop condition |
| --- | --- |
| Final source and launchers | Final Taki/Native source identities and independent source verdict; SHA-256 of the recipe, copied bootstrap modules, installed Host payload, Shell, Node and Docker binaries. Pin the existing isolated fixture launcher, observation/scanning commands and fault controls. If an executable entry or required fault control is missing, stop that case; do not invent a new fixture in this experiment. |
| Private fixture inputs | Dedicated Core data/config roots, fake-only encrypted Catalog/key material, Host pairing and C1/C2 registrations under the new protected C: fixture root described above. Keep build staging and sanitized evidence on G:. Use the actual protected Windows install path and existing Core sole-writer entry. No ambient credential/keyring fallback. Provision only the fixture registry with `{"version":1,"revision":0,"state":"vacant"}`; missing/corrupt is never vacant. |
| Endpoint and engine | Proposed `npipe:////./pipe/dockerDesktopLinuxEngine`, explicit protected empty Docker client-config directory and cleared environment. After authorized startup, record actual engine identity/version and Linux/amd64 compatibility. Refuse another context/endpoint/platform. |
| Cached base and builder | An already cached compatible immutable Native base, its exact image config ID/reference, Python venv and ownership compatibility. Pin a builder path that consumes the local base without fetching a base, builder image, frontend or other dependency. A missing base or unresolved no-download path stops the build. `--pull=false` alone is not a no-download guarantee on a cache miss. |
| Result image and resources | Record the newly built fixture image ID and unique tag. Resource names are `taki-c2a-<deployment-uuid>` and `taki-c2a-<deployment-uuid>-data`, where the UUID is the actual persisted initial Core Run. Copy literal label keys and values from the final adapter: Core, Host, installation, deployment, plan digest and role; do not invent labels. Record all actual IDs before subsequent mutations. |
| Authorization and limits | Explicit Desktop startup impact, conditional daemon interruption, exact owned-resource cleanup, resource/time ceilings and the executable commands. None are authorized by this document. |

Proposed topology: one fixture container, one new named data volume, no container ports or network, UID 1000 and an 8 MiB `/run/taki-hindsight` tmpfs with the final adapter's protected owner/modes. No real model, provider startup, original data, full Native rebuild, installer rollout or C2b work.

Proposed budget: ordinary build staging/evidence on G:, no new heavyweight H: artifacts; observe a maximum 2 GiB increase in G: use and retain at least 20 GiB free. The small protected C: tree has a proposed 256 MiB ceiling with at least 1 GiB free remaining; bind this to the final copied-file sizes before approval. Allow 30 minutes for the experiment plus 5 minutes for bounded cleanup; cap startup at 3 minutes and the cached build at 10 minutes. Recheck capacity and elapsed time between mutating stages. These are stop thresholds, not hard filesystem quotas; allocation can overshoot between observations. Crossing a threshold stops new work and starts owned cleanup, without VHDX compaction or unrelated deletion.

### Proposed authorized sequence

1. **Bind the accepted source and isolated fixture.** Finish the preceding manifest before starting Desktop. Stage only the pinned recipe and its required `docker/standalone/managed_bootstrap` tree, excluding caches and unrelated repository files. Keep generated sentinel values in fixture memory and the encrypted fake Catalog; do not put them in CLI arguments, environment options, plaintext fixture files or reports. Record initial process/storage state and a cleanup manifest outside the disposable staging tree.

2. **Start Desktop and verify the minimum runtime facts.** Use its fixed executable or a verified fixed Desktop CLI command, without a visible helper window. This starts the existing Desktop installation, not an isolated daemon: existing restart-policy containers may start immediately. The startup authorization must explicitly cover that possibility before launch. Inspect only engine/platform facts and a minimal workload inventory (IDs, names, state and restart policy); do not read unrelated container Env or logs. Record unexpected workloads and leave them untouched. Do not start Ubuntu or issue `wsl --shutdown`.

3. **Check cache, then build only the dedicated fake recipe.** Inspect the pinned local base and selected builder before invoking the build. Missing or mismatching cached inputs stop this stage: no pull, install, update or full Native build. Use the minimal staged context and network-disabled build steps. Resolve final image ID and entrypoint/user metadata before registration. A timeout is an unknown outcome: inspect the same build/result first and never launch a second build blindly. Any network-fetch attempt is a stop, not permission to complete the download.

4. **Run the actual admitted chain and inspect only its output surfaces.** Use the pinned operator fixture through Core Run/Attempt/Effect, authenticated Shell/Host, final live checkpoint, Native owner grant and private credential submission. A direct `docker exec` credential injection or manually fabricated LiveGrant cannot count. Verify exact resource IDs/labels, image, mounts, no network/ports and no TTY. Require real child PID/startup/liveness evidence from the fixed consumer. Scan owned container/image configuration, argv/exec metadata, public status, logs, Host registry, writable layer and data volume for sentinel plaintext with a matcher that reports only counts/booleans. Check the intended child only through its safe markers/status; its environment/memory is the intended destination, not public evidence. A `running` string alone is insufficient.

5. **Exercise bounded interruption and original-resource recovery.** Use the final source's explicit fault controls for helper death or lost grant/submission ACK, then reopen the same isolated Core data and Host registry. Retain original Run/deployment/container/volume/startup identities, and show that a repeated request observes without another create/start/grant/submit. Unknown outcomes must not be retried. An admitted/fenced same-startup refusal has no retry interface. If separate fault cases need fresh startups, use the same original container and the explicit new-startup admission path; record each case independently. If a fault control is unavailable, report that case unexecuted rather than approximating success.

6. **Restart the owned container, then conditionally test daemon interruption.** Before a container restart, record safe startup/tmpfs and persistent-volume markers. Use a stop timeout that accommodates the final Native graceful-stop budget. Verify the same container and volume IDs, a genuinely new Native startup, disappearance of the old transient marker and survival of the safe volume marker; only an explicit fresh Run/Attempt/custody/grant may resume injection. Separately, restart the daemon/Desktop only after a refreshed inventory proves no unrelated workload can be affected, or the owner has explicitly approved the named interruption scope. Otherwise skip daemon interruption and leave that gate open. Record actual daemon continuity/restart and container behavior, including live-restore if present; never assume a daemon restart creates a new startup. An unchanged startup allows observation only. Container restart is not daemon-restart evidence, and a surviving volume marker is not database evidence.

7. **Reconcile and clean exactly the manifest-owned resources.** Preserve sanitized evidence outside staging. Stop/reap only fixture Core/Shell/helper/child processes; gracefully stop and remove the verified owned container, then its verified unmounted volume and uniquely owned result-image tag/ID. Remove staging only after checking resolved paths remain under the exact experiment root and do not traverse an unexpected reparse point. Never use prune, force removal, base-image deletion, registry reset, global WSL shutdown or broad filesystem cleanup. If a timed-out create/build/remove leaves uncertain ownership, inspect first; unresolved resources remain listed for Root. Report attributable build-cache/VHDX residuals without claiming their space was reclaimed. Stop Desktop again only within the same approved interruption condition; otherwise report it left running. Refresh final process/resource/free-space evidence.

The normal stages and exact owned cleanup should be proposed together as one conditional authorization after the final source bindings exist. Desktop startup and daemon interruption have distinct effects and conditions. This researcher performs neither and requests no user authorization on Root's behalf.

### Evidence to return and gate boundaries

Return the exact command/identity manifest, sanitized expected/actual results for each executed case, first failure and recovery evidence, original resource/startup mappings, sentinel-scan counts, conditional daemon decision, and final cleanup/residual inventory. Keep test-driver assertions distinct from observed Docker/Native process facts. Incomplete cases remain explicitly open.

Every public result stays `deploymentReady: false`; managed setup remains refused. Real Docker fake-child proof would not accept C1 AC2/6, the complete installer, database behavior, trusted deployment receipts, C2b or real-model C3.

## Caveats / Not Found

- SOURCE PASS, source/binary hashes, actual engine identity, cached base metadata and the available built-in builder are recorded above. Compatible base Python/ownership and the actual no-download build are untested. The first real-engine launcher/scanning/cleanup controls passed independent static review; broader fault controls are deferred. The production label keys are `taki.c2a.deployment`, `.core`, `.host`, `.installation`, `.plan` and `.role`; their values must come from the actual admitted plan, not from invented IDs.
- The candidate recipe selects the fixed fake owner; no executable real disposable database consumer/fixture is established by the accepted C2a design. Database graceful shutdown and restart read-back therefore remain open. A sleeping fake child, persistent marker, container status or `/health` cannot substitute for that gate. This proposal adds no database fixture or source-design scope.
- Starting the current Desktop may activate existing workloads before they can be inventoried. A daemon cannot be assumed isolated merely because WSL was stopped. Discovery of unrelated workloads does not authorize stopping them or restarting their daemon.
- The original researcher wrote only the proposal and ran no tests/builds, daemon calls, service startup, install/download or original-data access. Root subsequently executed the separately authorized read-only preflight. Build/container experiments still require their concrete reviewed launcher and owner authorization.
