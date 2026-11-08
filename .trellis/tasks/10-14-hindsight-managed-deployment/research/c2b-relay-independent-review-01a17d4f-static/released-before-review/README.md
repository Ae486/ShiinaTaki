# C2b fixed loopback relay diagnostic

Source packet only. Root must obtain independent exact-byte review before executing `launch.mjs`.
The launcher **runs effects** after validation; importing it is not a static check.
No diagnostic execution or transport PASS is claimed by this source release.

This continues the accepted [topology delta](../c2b-topology-delta-review-2026-10-27.md) and the
[full C2b plan](../c2b-plan.md). It proves only a possible Windows loopback transport into one
network-none fixture. It does not run Hindsight, PostgreSQL, authentication, setup, receipts,
credentials, model inference or a production installed Host. `deploymentReady` always remains false.
The prior slice-1 failure is retained at `../c2b-slice1-run-cb3b3ca9-5a01-4bc4-a734-8b48d7868489/`.

## Frozen release and resources

`release.json` records all eight executable source hashes and the exact tool/resource pins.
Root verifies the release hash from [the source report](../c2b-relay-source-release-01a17d20.md)
before launch. The launcher validates the same source bytes and imports those buffered bytes
through `data:` modules; it does not reread unverified module code after that check.

| Binding | Value |
| --- | --- |
| Token T | `9a276b18-7fa2-4421-869c-88f0d89aec01` |
| Node | `C:/Program Files/nodejs/node.exe`, `v24.18.0`, SHA-256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de` |
| Docker D | `C:/Program Files/Docker/Docker/resources/bin/docker.exe`, SHA-256 `0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d` |
| Engine E | `npipe:////./pipe/dockerDesktopLinuxEngine`, ID `93e8319e-24b7-4a7d-88f1-60923ad681e0`, Linux `29.0.1` |
| Image I | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Container N | `taki-c2b-relay-9a276b18-7fa2-4421-869c-88f0d89aec01` |
| Host listener | Exclusive `127.0.0.1:58118`, held through both cases; second bind must refuse `EADDRINUSE` |
| Native fixture | `/app/api/.venv/bin/python -I -B -`, exact script bytes on stdin, PID 1 |
| Native relay | Same interpreter, `-I -B -c`, frozen `stream-relay.py`, exact nonsecret marker `taki-c2b-relay:T` |
| Relay destination | Only `127.0.0.1:8000` inside the original container |
| Stage S | `G:/TakiAgent-c2b-native-api/relay-9a276b18-7fa2-4421-869c-88f0d89aec01` |
| Stage marker | `S/.c2b-relay-owner` contains exactly T |
| Docker client config C | Fresh empty `S/client-config`, checked before each command |
| Evidence archive A | `H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/c2b-relay-run-9a276b18-7fa2-4421-869c-88f0d89aec01` |

One fresh container, UID/GID 1000, read-only root, `--network none`, no mounts/volumes/tmpfs,
no Docker-published port, no custom network, all capabilities dropped, no-new-privileges,
256 MiB RAM, one CPU, 16 PIDs, log driver none and restart policy no. No build/pull, sidecar,
daemon/firewall change, new privilege, dependency or alternate port/target is permitted.
The base image's own declared volumes must be absent. Existing image metadata is not modified.

## Lifecycle and expected observations

1. Refuse an existing stage or archive, mark only the fresh S, and copy the reviewed sources and
   release into it. Hold the fixed Host listener; refuse unexpected clients or a successful second bind.
2. Check D before each fixed command. Check the original Engine, immutable Linux/amd64 image and
   absent N before the sole create. Persist each dispatch before calling Docker. Inspect every
   fixed setting and the exact 64-hex create reply before the sole start.
3. The fixture reports actual UID/GID, capabilities, PID/start identity, socket-inode ownership,
   `127.0.0.1:8000`, interfaces and IPv4/IPv6 routes. Four fixed probes cover public and link-local
   IPv4/IPv6 destinations. Only `EAFNOSUPPORT`/`EPROTONOSUPPORT` during socket creation, or
   `ENETUNREACH`/`EHOSTUNREACH`/`EADDRNOTAVAIL` during connect, count as expected refusal.
   A connect, timeout, `ECONNREFUSED`, malformed result or arbitrary error fails isolation.
4. Admit exactly two generated binary clients in sequence. The first fragments a 32 KiB request,
   half-closes it, and receives a fragmented 48 KiB response plus EOF. Both sides and the relay
   record matching hashes/counts and half-close observations. The second sends 1 KiB, receives
   its 512-byte acknowledgement, and issues a TCP reset. The Host observes client abort, closes
   the original relay stdin and permits at most one second before terminating that exact CLI.
   Neither path retries data or starts a replacement relay.
5. At most two relay exec children are ever created. Streams are capped at 64 KiB per direction;
   the Python relay uses bounded pending buffers and readiness interests, and the Host honors
   pipe/socket backpressure. The diagnostic checks real segmentation and complete transfer; it
   does not claim throughput benchmarking or forced saturation of every backpressure branch.
6. Stop accepting and close both original streams. One additional **read-only observer exec**
   checks that the exact relay PID/start identities and marker are absent, with no matching zombie,
   while the original fixture server remains unchanged. The observer does not signal or reap.
7. Reinspect only the original proven container/Engine/start. Stop it, require successful fixture
   exit and `stopped` evidence, remove without force, and prove absence by original ID and N.
   Reap every owned Docker CLI and prove Host port release. No unrelated resource is targeted.

Every Docker exec is no-TTY and uses `--interactive --user 1000:1000 CID` with the fixed
interpreter/code. The observer is separate from the two forwarding children. Shell execution,
caller-selected code/arguments/environment/destination and automatic replay are unavailable.

One **monotonic 60-second overall budget** covers work, cleanup and archive verification. Work
is capped at 40 seconds, leaving at least 20 seconds for cleanup; readiness is at most 10 seconds
after attach and shares the work deadline. Individual info/inspect/create/rm calls are at most
5 seconds, stop at most 6 seconds, observer at most 6.5 seconds, and child termination observation
at most 0.9 seconds. All are capped by the current total deadline. Slow or hung OS/Engine/filesystem
operations can leave an explicit failed/unknown result; elapsed time after the bound cannot pass.

## Static verification only

From `H:/TakiAgent`, these commands parse sources without importing or running the packet:

```powershell
$packet = 'H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/docker-loopback-relay'
Get-ChildItem -LiteralPath $packet -Filter '*.mjs' | ForEach-Object {
  & 'C:/Program Files/nodejs/node.exe' --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw 'NODE_SYNTAX_FAILED' }
}
$compileOnly = @'
from pathlib import Path
root = Path('H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/docker-loopback-relay')
for path in sorted(root.glob('*.py')):
    compile(path.read_bytes(), str(path), 'exec', dont_inherit=True)
    print(path.name + ': syntax PASS')
'@
& 'G:/anaconda3/python.exe' -I -B -c $compileOnly
if ($LASTEXITCODE -ne 0) { throw 'PYTHON_SYNTAX_FAILED' }
```

Python compilation stays in memory and creates no `__pycache__`. Static verification cannot
establish Docker stream semantics, Windows exclusive binding, route refusal, cancellation/reaping,
cleanup or the installed interpreter's Linux capabilities. No package suite/build is necessary here.

## Later Root-only run

After independent source review, Root rechecks release/tool hashes, original Engine/image,
N/S/A absence, port availability and pre-existing workloads. Root's fresh readback of Engine state
is authoritative; old task snapshots saying the pipe was absent are historical. Do not start or
change the shared daemon as an incidental action of this packet.

The exact effectful entrypoint is the pinned Node executable with only the absolute `launch.mjs`
path as its argument. The following uses a cleared environment and no visible helper window:

```powershell
$launch = 'H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/docker-loopback-relay/launch.mjs'
$relayStart = [System.Diagnostics.ProcessStartInfo]::new()
$relayStart.FileName = 'C:/Program Files/nodejs/node.exe'
$relayStart.ArgumentList.Add($launch)
$relayStart.WorkingDirectory = 'H:/TakiAgent'
$relayStart.UseShellExecute = $false
$relayStart.CreateNoWindow = $true
$relayStart.Environment.Clear()
$relayStart.Environment.Add('SystemRoot', $env:SystemRoot)
$relayProcess = [System.Diagnostics.Process]::Start($relayStart)
if (-not $relayProcess.WaitForExit(65000)) {
  $relayProcess.Kill($true)
  throw 'OUTER_LAUNCH_TIMEOUT: retain original resource uncertainty; do not rerun the token'
}
if ($relayProcess.ExitCode -ne 0) { throw 'RELAY_DIAGNOSTIC_FAILED: inspect retained original evidence' }
```

The 65-second outer watchdog is a last-resort launcher containment bound, not an extra acceptance
budget. Killing the exact launched process tree does not prove that a Docker effect was absent.
Root must retain the failure and inspect the original named/recorded resource without replay.

## Evidence, interruption and cleanup

Commands are bounded to 48 records and 2 MiB per evidence JSON. Stage inventory is bounded to
4 MiB with a closed file-name set and an empty client-config directory. Dispatch records are
flushed to a create-only pending file and atomically renamed; a leftover pending file refuses
further dispatch and is retained. Power-loss durability is not claimed.

`result.json` contains inputs, command correlations, observed identities, both transport cases,
refusal classes, cleanup facts and timing. `commands.json` retains bounded stdout/stderr, exit,
stream-error, timeout and termination evidence. These contain only fixed source and generated
binary challenges; the packet receives no original credentials/data. The archive includes exact
source/release/marker/result/command bytes and a hash-verified `disposition.json`.

Before recursive removal, every ancestor and final absolute S path is rechecked against the exact
owned staging root, with no redirection, a matching token, only recognized regular single-link files,
bounded size and complete archive hash readback. Only proven cleanup permits S removal. An unknown
create reply, mismatch, missing evidence, live child, unreleased port or cleanup failure produces FAIL,
preserves the archive when possible and retains S. No name-only adoption or automatic unknown-resource
deletion follows interruption. Root compares its original unrelated-workload snapshot after the run.

Any stage or archive creation consumes this token even if no container was created. Never execute
this release again after an attempt. An interruption requires original-resource inspection and a
separately frozen new release if another diagnostic is needed. Preserve the old failure and hashes.
Transport PASS still leaves actual API/PG, authentication, installed Host lifecycle, trusted lookup,
managed setup and all remaining C2b acceptance gates open.
