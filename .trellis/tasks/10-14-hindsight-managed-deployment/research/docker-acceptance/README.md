# C2a first admitted Docker case

This is the targeted corrected second attempt. Root's first attempt passed the cached-base probe,
one local image build and tiny adapter compilation, then stopped at `core-shell-operator` before
deployment admission: the debug Shell required `TAKI_GATE_AUTOAPPROVE`. The launcher now supplies
`allow-once` only to that isolated Shell child, matching the accepted installed fixture; real Rust
Gate/Core admission remains in place. This revision received static checks only; Root owns runtime.

`run-first-case.ts` remains a task-local, single-use launcher. The fresh token below identifies this
fixture and operator request, never a chosen Core deployment Run ID. Do not reuse or reset old
markers, roots or resources. Reuse the valid unchanged first-attempt base-probe evidence, recheck
the same pinned base/engine, and perform one new local-only fixture build. Missing or changed
prerequisites stop this attempt without installation, pull, fallback or accepted-source changes.

## Fixed resources and limits

| Item | Binding |
| --- | --- |
| Case token | `8378a950-87c8-44e3-a909-d213a284f113` |
| Ordinary staging, `S` | `G:/TakiAgent-c2a-docker-acceptance/first-case-8378a950-87c8-44e3-a909-d213a284f113` |
| Protected installation | `C:/taki-c2a-docker-fixture-8378a950-87c8-44e3-a909-d213a284f113` |
| Docker executable | `C:/Program Files/Docker/Docker/resources/bin/docker.exe`, SHA-256 `0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d` |
| Endpoint / engine | `npipe:////./pipe/dockerDesktopLinuxEngine` / `93e8319e-24b7-4a7d-88f1-60923ad681e0` |
| Engine / builder | Docker 29.0.1, Linux x86_64, liveRestore false; existing Buildx `default`, driver `docker`, one running `default` node, BuildKit v0.25.2 |
| Cached base tag / config ID | `taki-hindsight-api:local` / `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Base probe | Reuse Root's retained successful first-attempt evidence; no new probe container in this attempt |
| Result tag | `taki-c2a-fake:8378a950-87c8-44e3-a909-d213a284f113`; resulting immutable config ID must be in `S/image-id.txt` |
| Deployment resources | One container `taki-c2a-<actual initial Core Run UUID>`, one volume with `-data` suffix; the launcher never chooses that Run UUID |
| Runtime topology | Existing fixed adapter: `--pull=never`, network none, UID/GID 1000, no published ports, one new named volume, 8 MiB private tmpfs |
| Evidence | `S/first-case.json`, retained outside the disposable C: tree; fake values remain in memory and the encrypted fixture Catalog |

Require both new exact roots to be absent before creating them. G: is ordinary staging;
the unchanged strict ancestor verifier rejects it for protected installs. Only the new C: tree gets
the existing fixture DACL pattern. No ancestor or existing-installation ACL changes are permitted.

Root must measure from **before** preparation/build: maximum 2 GiB increase in G: use, at least 20 GiB
free on G:, C: tree at most 256 MiB and at least 1 GiB free on C:. These are observed stop thresholds,
not filesystem quotas. The cached base's listed 6.4 GB size is shared existing storage, not permission
to export/copy/rebuild it. Stage only the small recipe/package; create no H: build artifacts or Cargo
target. Allow 30 minutes total plus 5 minutes cleanup, one build at most 10 minutes and the admitted
case at most 5 minutes. The fixed fake child itself exits after 300 seconds.

## Preparation after explicit experiment approval

For Docker and application processes, use a bounded argument-array runner with `shell: false`, hidden
Windows windows and a cleared child environment containing only `SystemRoot` and fixture TEMP/TMP
(plus the launcher's explicit fake configuration). Do not run the command lines below
through an ambient Docker context. Let `D` be the fixed Docker executable, and `E` the fixed endpoint.

1. Create new `S` with `.c2a-docker-owner` containing exactly the case token. Record
   `baseline.json` with numeric `gFree`/`cFree` bytes, before any build. Create empty `S/client-config`
   and a separate `S/build-config/config.json` containing only:

   ```json
   {"cliPluginsExtraDirs":["C:/Program Files/Docker/Docker/resources/cli-plugins"]}
   ```

   Runtime Host `state/docker-config` remains empty. Pin installed `docker-buildx.exe` to SHA-256
   `c8d20cd80c940cf866717dd938eca50dbe588e06e0c0ced5a9d97b06b27bf8a7`. Root's read-only discovery
   established plain `buildx inspect`; this installed version does not support `inspect --format`.

2. With `D --host E --config S/build-config`, recheck plain `buildx inspect` and
   `context inspect --format '{{json .Endpoints.docker.Host}}' default`. Require the table's exact
   running built-in driver and endpoint; no `--bootstrap`, new builder or fallback. With the empty
   client config, inspect the exact base tag and require its recorded config ID, Linux/amd64 and no
   `Config.Volumes` entries. Require the new result tag and protected root absent. A name
   collision is a refusal; never remove it. Pin the accepted source manifest and all launcher files.

3. Reuse Root's retained successful first-attempt `base-probe.json`: Python 3.11.16,
   `python-dotenv` 1.2.2, UID/GID 1000, empty owned data seed and `compatible: true`.
   Require the same immutable base ID and unchanged `base-probe.py` bytes; preserve the original
   evidence path/hash and record the reuse when copying only that result to new `S/base-probe.json`.
   Do not rerun the probe or reuse its old ownership markers. Changed inputs invalidate this reuse
   and stop the attempt for Root's review.

4. Stage the unchanged Native `docker/standalone/Dockerfile.c2a-fake` and only the eleven top-level
   `managed_bootstrap/*.py` files under the same relative context paths. Exclude caches, README and
   unrelated files. The recipe SHA-256 is `2be1279ef4621f5d42397879fab2e436d780224eb3c02d591180faf9e9a9fcff`.
   Recheck the cached tag's config ID immediately before the single build:

   ```text
   D --host E --config S/build-config buildx build --builder default --pull=false
     --network=none --load --progress=plain
     --build-arg NATIVE_IMAGE=taki-hindsight-api:local
     --label taki.c2a.fixture=8378a950-87c8-44e3-a909-d213a284f113
     --iidfile S/image-id.txt --tag taki-c2a-fake:8378a950-87c8-44e3-a909-d213a284f113
     --file S/context/docker/standalone/Dockerfile.c2a-fake S/context
   ```

   This uses the verified built-in driver/local image store, already present exact base, no custom
   frontend (`#syntax` is absent), cache importer or package installation. `--pull=false` alone is
   insufficient on a cache miss; a missing/changed local base or attempted network fetch stops the
   stage. A timeout leaves an unknown build result: inspect the same result tag/build first, never
   blindly start another build. Record the result ID/user/entrypoint/labels and source hashes.

5. Build only the existing tiny fixed fake-key adapter (not the Shell or a new Cargo target):

   This compiler-only step uses the already installed Rust/MSVC development environment, not the
   Docker/application environment above. Resolve the existing compiler to its absolute path and
   retain only the required Rust/MSVC/Windows SDK toolchain search variables, with TEMP/TMP set to S.
   Record the selected compiler path/version and toolchain environment names; do not forward unrelated
   credential variables. If the compiler or linker cannot resolve locally, stop without installation.

   ```text
   rustc H:/TakiAgent/apps/hindsight-host/test-fixtures/fake-key-adapter.rs
     --edition=2021 -C debuginfo=0 -o S/fake-key-adapter.exe
   ```

   Pin its source and output hash. `run-first-case.ts` uses the existing `buildHost` once to copy
   accepted Host sources/locked dependencies into the protected C: installation. It retains the
   existing Shell binary; no test suite, package installation or full build is requested.

## Single executable case

After those prerequisites and ownership/resource approval, run with the fixed Node binary and the
same cleared environment, from `H:/TakiAgent`:

```text
C:/Program Files/nodejs/node.exe
  .trellis/tasks/10-14-hindsight-managed-deployment/research/docker-acceptance/run-first-case.ts
  --execute-approved-first-case
```

The single-use `first-case.started` fence rejects launcher repeats. The flag is an execution guard,
not permission. The source fixture is reused only for generated data and registration scaffolding;
its synthetic invocation/custody helpers are never submitted. The actual chain is operator pairing
and isolated Core policy -> Core Run/Attempt/Effect -> Rust Gate -> copied Host -> real fixed Docker
adapter -> live Core checkpoint -> independent Native grant -> private submitter -> actual fake child.
There is no manual grant, secret-bearing Docker option, fake Docker executable or direct injection.

The case requires a completed initial Run and real running child; repeats the same operator key once;
observes the original deployment once; verifies unchanged original attempts/steps/resources; and
requires one container create/start and one credential submit in actual engine evidence. Registry
revision may advance during reads. Events identify only this container's exec IDs. Fixed read-only
Engine GETs over the same pinned pipe inspect their actual no-TTY/open-stdin/module/exit facts and
both container log streams. Missing events/exec metadata fails the evidence check; no result is inferred.
Engine logs are read without a tail truncation and decoded from their non-TTY multiplexed frames;
stdout and stderr are separately reassembled before scanning, within the same 64 KiB response cap.

Scans cover image/container/exec metadata, bounded engine events, both log streams, public statuses,
Host registry, captured Core/Shell stdout/stderr, all regular files in the protected fixture, the new
data volume and owner/child argv. Only counts/booleans and safe PID/startup/socket facts are returned.
No child environment/memory is read. Limits are 1 MiB per ordinary Docker reply, 64 KiB per Engine read,
64 MiB/1024 files in the new data volume, and 256 MiB/4096 files in the C: tree. A cap or unsafe file
fails the check; it is never reported as a complete scan. No whole-image export or full-rootfs scan.

## Cleanup and remaining gates

The driver closes only its operator/Core/Shell processes, verifies the original registry and adapter
ownership, stops the exact container with a 35-second grace, verifies stopped state, removes that ID,
then removes only the verified unmounted named volume. It removes the uniquely labelled result image
tag only if its ID matches, it has no other tag/container user, and it is not the base. It verifies
resource/tag absence, checks the C: root's exact marker/canonical path and refuses symlinks before
removing it. Unknown ownership, a failed scan or failed cleanup remains explicitly recorded; there
is no replay, adoption, force-removal, prune, broad delete, base deletion or daemon action.
Any cleanup or final-scan failure also marks the case failed. The report retains the registry path;
once that registry can be read after process exit, it also records original derived names even when
an external ID was not durably recorded. An unconfirmed ID is retained for Root inspection, never
adopted for deletion. Consecutive Docker/Engine/RPC waits share the five-minute case budget, and
cleanup has its own five-minute budget; synchronous bounded file work is checked at phase boundaries.

Root must preserve `S/first-case.json`, probe/build outcomes, launcher/input hashes and any first
failure in this task, then check S's exact resolved path, marker and absence of reparse points before
removing only S. The staged fake-key binary is disposable. If the driver cannot prove cleanup, retain
the listed original resources for inspection. Report build-cache/VHDX residuals; image-tag removal does
not establish reclaimed cache space. Leave Docker Desktop and Root's current unrelated-container
baseline untouched. `gpt-load` was already absent before the first attempt's first Docker mutation;
do not restore it. Daemon interruption is excluded from this experiment.

Still open: helper/ACK-loss injection, Core/Host reopen under actual faults, container/daemon restart,
fresh tmpfs/new-startup authority, comprehensive writable-layer/image-layer scans, credential-rotation
faults, actual database shutdown/data persistence, C1 service AC2/6, C2b receipts, real models and manual
acceptance. The fixed child is not a database. This first executable case accepts none of those gates,
and every result retains `deploymentReady: false`.
