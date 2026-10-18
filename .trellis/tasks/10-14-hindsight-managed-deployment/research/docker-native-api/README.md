# C2b cached-image prerequisite

Preparation only; Root executes after exact-byte review and the separate DB acceptance.
The [C2b plan](../c2b-plan.md) and [R2 design PASS](../c2b-design-r2-review.md) require actual
cached-image inventory before the minimal producer, then broader setup work.

inspect-image.py is a fixed stdlib-only stdin packet. It reads nine installed distributions,
23 named module paths/hashes, four literal compatibility fields, bounded Native tokenizer
call sites, the installed tiktoken reader/encoding AST, four exact URL-derived cache files,
and the already known 34,205,672-byte bundled pg0 CLI. It never imports those packages,
loads an encoder, runs a binary, starts SQL/API/providers, calls a network or writes image files.
PathFinder resolves dotted modules without importing their parents; unusual import hooks or
missing modules remain unresolved. Package metadata is not an executed import test.

The cache candidates are only /tmp/data-gym-cache, /var/tmp/data-gym-cache,
/usr/tmp/data-gym-cache and /home/hindsight/.pg0/data-gym-cache. Each read uses the filename
derived from the installed cl100k_base URL and checks its installed expected SHA-256 as UID 1000.
No cache-directory walk or tempfile.gettempdir call occurs: the latter can create probe files.
Only cache-variable presence is reported, never environment values or keys. A verified directory
is a possible explicit TIKTOKEN_CACHE_DIR pin, not proof that the future child already uses it.
No encoding load is needed for this inventory.

## Frozen resource and command manifest

Root freezes fresh T/N/S and script hash before execution; none is allocated by this preparation.

| Binding | Exact value or derivation |
| --- | --- |
| D | C:/Program Files/Docker/Docker/resources/bin/docker.exe |
| D SHA-256 | 0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d |
| E / engine ID | npipe:////./pipe/dockerDesktopLinuxEngine / 93e8319e-24b7-4a7d-88f1-60923ad681e0 |
| I | sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db |
| T / N | Fresh Root UUID / taki-c2b-image-T |
| S / C | New G:/TakiAgent-c2b-native-api/image-T / S/client-config |
| Ownership marker | S/.c2b-image-owner containing exactly T |
| Process | /app/api/.venv/bin/python -I -B - ; UID/GID 1000 |
| Resources | One fresh container; no volume, bind mount, tmpfs, port, image build or pull |

Use Root's existing bounded argv runner, shell false, hidden windows and its cleared host
environment. Commands below are argv templates, not PowerShell pipelines. Feed the exact
hashed script bytes to start's stdin and close it. Never select an ambient Docker context.
Before create, require S/N absent, create only the marked staging/empty client config, and
check D, engine ID and I's Linux/amd64 identity with no image-declared volumes.

~~~text
D --host E --config C info --format {{.ID}}
D --host E --config C image inspect I --format IMAGE
D --host E --config C container inspect N --format CONTAINER
D --host E --config C create --name N
  --label taki.c2b.image-prerequisite=T --label taki.c2b.role=native-image-inventory
  --pull never --network none --read-only --user 1000:1000 --interactive
  --log-driver none --memory 256m --cpus 1 --pids-limit 16
  --cap-drop ALL --security-opt no-new-privileges=true
  --entrypoint /app/api/.venv/bin/python I -I -B -
D --host E --config C container inspect CID --format CONTAINER
D --host E --config C start --attach --interactive CID
D --host E --config C container inspect CID --format CONTAINER
~~~

IMAGE and CONTAINER are these literal single argv entries. They omit Config.Env and unrelated
containers. The initial N query must report absence; collision stops without touching that resource.
CID is the exact create reply; require every requested setting and empty Mounts before start.

~~~text
IMAGE = {"Id":{{json .Id}},"Os":{{json .Os}},"Architecture":{{json .Architecture}},"Volumes":{{json (index .Config "Volumes")}}}
CONTAINER = {"Id":{{json .Id}},"Name":{{json .Name}},"Image":{{json .Image}},"Path":{{json .Path}},"Args":{{json .Args}},"User":{{json .Config.User}},"Token":{{json (index .Config.Labels "taki.c2b.image-prerequisite")}},"Role":{{json (index .Config.Labels "taki.c2b.role")}},"NetworkMode":{{json .HostConfig.NetworkMode}},"ReadonlyRootfs":{{json .HostConfig.ReadonlyRootfs}},"Mounts":{{json .Mounts}},"Memory":{{json .HostConfig.Memory}},"NanoCpus":{{json .HostConfig.NanoCpus}},"PidsLimit":{{json .HostConfig.PidsLimit}},"Privileged":{{json .HostConfig.Privileged}},"CapDrop":{{json .HostConfig.CapDrop}},"SecurityOpt":{{json .HostConfig.SecurityOpt}},"LogDriver":{{json .HostConfig.LogConfig.Type}},"Running":{{json .State.Running}},"ExitCode":{{json .State.ExitCode}},"OOMKilled":{{json .State.OOMKilled}}}
~~~

## Bounds, results and cleanup

Packet: 30 seconds; <=64 files; <=512 KiB per metadata file; <=2 MiB per source;
<=16 MiB for the tiktoken native extension; <=64 MiB for the pg0 CLI; <=4 MiB per cache;
<=96 MiB total streamed reads; nine package inventories each <=8,192 entries/512 KiB path text;
<=32 Native call sites; <=64 KiB JSON including newline. Paths are <=1,024 characters.
Root bounds preflight/create/start/attach to 60 seconds total, individual inspect/info/create
commands to 5 seconds and attach to 40 seconds within that total. Capture <=64 KiB stdout,
<=8 KiB Docker stderr and <=16 KiB per projected inspect result; marked stage growth <=1 MiB.
No automatic rerun, alternate path search or limit expansion follows failure.

Exit 0 plus inventory_complete means only the bounded static inventory completed with no listed
prerequisite gap. Exit 2, any unresolved entry, incomplete output, timeout or OOM blocks progression;
preserve the original result even if some files were found. The reported build is extracted from
the image's actual source and compared with the plan's source target; old/missing modules are not
made current by a version label. deploymentReady is always false.

After preserving result/command/state/hash evidence, use a separate 60-second cleanup budget.
Reinspect only CID against original name/token/role/image/settings/empty mounts. If create reply
was lost, inspect only N and require those same frozen identities. Stop a still-running verified
probe with the first command below, then require stopped state before removal; no force removal.

~~~text
D --host E --config C stop --time 2 CID
D --host E --config C container inspect CID --format CONTAINER
D --host E --config C rm CID
D --host E --config C container inspect CID --format CONTAINER
~~~

Each cleanup command is <=5 seconds and shares that budget; the last query must prove absence.
Archive/readback evidence, then remove only the exact resolved S under the stated staging root
with its matching marker. Preserve ambiguous resources for Root; no daemon/workload operation,
prune, base-image removal or original-data inspection. Metadata-process cleanup proves no API/PG stop.

The final producer image still needs its own installed build/module and consumed PG asset checks,
an explicit verified cache pin and fail-before-import cache check, then ordinary API migrations,
authentication/listener binding and checked API+PG stop/same-volume restart. This packet neither
implements that producer nor substitutes its results with earlier DB-only evidence.
