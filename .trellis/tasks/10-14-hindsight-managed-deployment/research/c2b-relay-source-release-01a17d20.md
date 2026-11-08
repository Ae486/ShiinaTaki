# C2b loopback relay source recovery and release

## Ownership and checkpoint

Resumed for root session `01a17d20-f141-7f31-b9f8-c161431c935d` on 2026-10-27.
This continues the eight existing scripts written by interrupted child
`01a17cc6-d852-73f3-b273-00299e9985a3`; it is not a new task or an executed diagnostic.
Workspace readback is `H:/TakiAgent`, branch `main`, HEAD `e260ff4`.
The global `.trellis/.current-task` file was present but empty; root supplied the explicit
D1 continuation and existing C2b task paths. No task pointer is changed here.

Exclusive write scope is `research/docker-loopback-relay/`, this report and its static evidence.
Inherited and concurrent changes elsewhere remain untouched. Root owns independent review,
actual preflight/execution, final resource preservation and task metadata.

The full accepted `c2b-plan.md` was read directly. Its SHA-256 remains
`0e4bdf03c903d6bbdca4d0bbfc187de14bb6c9fd8119b816bbfa7e69db0cd803`.
The accepted topology delta is `c2b-topology-delta-review-2026-10-27.md`.
The previous slice-1 failure remains retained and `deploymentReady=false`.

## Current status

- Context recovery and the eight-script inventory are complete.
- The existing packet is complete and released to Root for independent exact-byte source review.
  `release.json`, `README.md` and static evidence are now present. No runtime acceptance is asserted.
- The inherited token is `9a276b18-7fa2-4421-869c-88f0d89aec01`. Read-only filesystem checks found
  its exact G: stage and task archive absent. No executed result was found for this token.
  This is an observed snapshot, not permission to reuse a path after a later attempt.
- No Docker command, listener, container, image build/pull, network probe or diagnostic runner
  has been executed by this resumed child. Only read-only repository/context checks have run.
- Static syntax/compile checks and byte/path checks pass within the bounds below.

## Source review checkpoint

The existing eight-script design is retained. Concrete corrections identified from static control flow:

1. `run-relay.mjs` previously granted 60 seconds of work plus a fresh 60 seconds for cleanup.
   The accepted delta requires 60 seconds overall. One monotonic deadline now covers work,
   cleanup and preservation; work receives at most 40 seconds, reserving at least 20 seconds
   for cleanup. Individual existing limits are capped by that deadline. Root accepted this
   correction during the resumed assignment. Deadline expiry never becomes PASS.
2. `evidence-store.mjs` previously truncated `commands.json` in place despite claiming durable
   dispatch evidence. It now flushes a bounded create-only pending file and atomically renames it.
   An interrupted pending file is retained and blocks another dispatch. This is process-interruption
   evidence, not a power-loss durability claim. Archive files receive flush and hash readback.
3. Staging was removed even when CLI/container/port cleanup was unproven. The archive now preserves
   that failed attempt while leaving its marked stage for Root. Only proven cleanup permits exact
   checked-path removal; source, archive and parent paths are never deletion targets.
4. Stream validation previously assumed the host socket close event had already run when the Docker
   CLI closed. Both observations are now explicitly awaited within the same existing phase budget.
5. The launcher now validates the actual Node executable/version/hash and bounded regular source
   files. A second fixed-address bind must actually refuse with `EADDRINUSE` while the Host listener
   is held; an unexpected bind outcome fails before container creation.

Root independently reported Docker Desktop already running since 18:47, the original engine and
Docker CLI hash unchanged, eight pre-existing containers, and the proposed port/stage/archive absent.
The earlier task note that the Engine pipe was absent is historical. This child has issued no Docker
command and does not promote Root's read-only preflight into transport evidence.

The final read-through also tightened absence checks to reject evidence-persistence/stream errors,
and fixture-stop acceptance to require one complete event matching the original server PID/start
identity with no trailing/invalid protocol bytes. These preserve explicit failure semantics rather
than treating a Docker exit code or partial JSON stream as complete proof.

## Frozen packet

| Artifact | SHA-256 |
| --- | --- |
| `docker-loopback-relay/release.json` | `8b47311d6518ce9941cfce148d806826ea375466da24cf568acb51f5447703c4` |
| `docker-loopback-relay/README.md` | `11cb309f7fec09a0d2c1bdd3aef9cd01cb4ff92132de4f80cf7307104a3e9c06` |
| Retained failed slice-1 `result.json` | `14f0fdfcb1e486694163b6b8f42662726cc23697bfe6295593d2e941ebe8ed93` |

The release contains the exact eight source hashes, Node/Docker/Engine/image pins, container name,
marker, stage/archive paths and finite resource/command/evidence limits. Node's actual executable is
`C:/Program Files/nodejs/node.exe`, `v24.18.0`, SHA-256
`9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`.
Docker's executable hash was read directly without invoking Docker and matches the accepted pin.

## Changed files

All paths below are relative to this `research/` directory:

- Corrected existing `docker-loopback-relay/launch.mjs`, `run-relay.mjs`, `docker-commands.mjs`,
  `host-transport.mjs` and `evidence-store.mjs` for the concrete findings above.
- Added `docker-loopback-relay/README.md` and `release.json`.
- Added this release/checkpoint report and `c2b-relay-source-release-01a17d20-static.json`.
- Retained `fixture-server.py`, `stream-relay.py` and `observe-reaping.py` unchanged.

No production, Native, Shared export, task metadata, dependency, model/key/original-data or unrelated
dirty file was modified. No Git lifecycle action or recursive deletion was performed.

## Actual verification

[Static evidence](c2b-relay-source-release-01a17d20-static.json) records the checked bytes and results.

| Check | Actual result and limit |
| --- | --- |
| Node syntax | Five `.mjs` files pass pinned Node `--check`; the final runner edit was rechecked. No module was imported or evaluated. |
| Python syntax | Three `.py` files pass `compile(..., 'exec', dont_inherit=True)` in memory under `G:/anaconda3/python.exe` 3.12.7 with `-I -B`. No Python packet function ran and no `__pycache__` was created. |
| Release integrity | All eight hashes match the final release; exact total/phase/child limits and the closed file count were checked. |
| Text and source bounds | Every packet file decodes as strict UTF-8 without BOM and is below 64 KiB; no unexpected directory or symlink was present. |
| Token/recovery snapshot | Exact G: stage and task archive absent; prior slice-1 result hash unchanged. This snapshot must be refreshed by Root before runtime. |

No package lint/type/test/build, Docker command, listener, actual transport, Linux process or cleanup
experiment was run by this child. The `trellis-check` scope is this task-only source review and static
syntax gate; broad production checks remain with D1/Root and are not relevant evidence for this packet.

## Independent review and later execution

Review the released eight scripts, `release.json`, README and this report against the accepted topology
delta. The README contains exact static commands, the fixed cleared-environment Root-only invocation,
all expected errors and original-resource cleanup/preservation rules. The effectful entrypoint is:

```text
C:/Program Files/nodejs/node.exe H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research/docker-loopback-relay/launch.mjs
```

Do not invoke the entrypoint as a syntax check. Root must independently review the frozen release,
refresh the concrete preflight and own the sole actual run. Any stage/archive creation consumes the
token. A lost create reply remains unknown; no rerun, replacement container or name-only deletion is
available. An outer watchdog failure retains original-resource uncertainty and never establishes
absence of a Docker effect.

## Remaining assumptions and risks

- Actual Windows/Docker stdin/EOF/reset behavior, exclusive binding, namespace routes/refusal classes,
  exact process reaping and runtime/cleanup timing remain unexecuted. The packet must fail with retained
  evidence if any assumption is false; it cannot expand deadlines, grant privileges or enable networking.
- The observer relies on the pinned Linux interpreter/kernel's `/proc`, PID identity and pidfd behavior.
  Windows Python compilation is only a syntax check of that Linux program.
- The source implements backpressure and proves bounded segmented complete transfer when executed.
  It does not force every saturation branch or prove production throughput/installed Host behavior.
- Flushed atomic local snapshots improve interruption recovery; power-loss durability is not claimed.
  Synchronous OS/filesystem hangs can exceed the finite application budget; any overdue completion fails,
  and Root's separate outer watchdog preserves unknown effects instead of claiming automatic cleanup.
- Transport acceptance does not release actual API/PG, authentication, trusted deployment lookup,
  definition-only managed setup, C3/C4/D2, remaining fault/platform checks or Stage 6 acceptance.

Ownership of the complete frozen packet is released to Root. This child stops editing after final
report/readback checks so the independent reviewer has a stable input.
