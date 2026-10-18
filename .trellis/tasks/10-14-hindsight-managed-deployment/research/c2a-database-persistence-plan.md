# C2a admitted database shutdown and persistence plan

Date: 2026-10-15. Status: released for independent design review; no implementation or execution in this step.

## Claim and accepted inputs

One task-only database fixture will follow the existing admitted Core/Shell/Host/private-bootstrap
path, commit generated data in an ordinary PostgreSQL table, shut down cleanly, and read that same
data after a new authorized startup of the original container and volume. Public status remains
`deploymentReady: false`. This is not a ready Native API, provider integration or C2b receipt producer.

The owner's existing approval covers isolated project-owned validation and cleanup. Root owns
preparation, the one heavy execution slot, evidence preservation and task metadata. Implement this
plan only after independent xhigh design review; review exact staged bytes before Root executes.
No new user permission or product decision is required for this slice.

Accepted inputs:

- [Database contract review](c2a-database-design-review.md): retain `c2a-fake-v1` as the fixed
  fake-input protocol; the differently hashed artifact must explicitly identify its database behavior.
- [Actual offline first-start review](c2a-database-extraction-runtime-review.md) and its
  [derived facts](c2a-database-extraction-runtime-review.json): PostgreSQL 18.1, working raw tools,
  one SQL start, enabled durability and checked stop. No logged workload was persisted by that case.
- [First-start preservation](c2a-database-first-start-preservation.json): all 24 entries were
  preserved in `c2a-database-first-start-evidence.zip`, 78,887 bytes, SHA-256
  `82ba7698993d50f1295c8a7aa322044b6501f7cda16d102ed6cc1ead5aa09f26`.
  The old G: stage, container and volume have been removed. Historical paths are evidence labels,
  never execution inputs. The current task source `docker-database/first-start.py` remains available;
  its accepted SHA-256 is `7d1ee67f7b3027da781795e365b58a9cb93f847cdba7cc31425f05030d2f7ff6`.
- [Recovery R2 review](c2a-recovery-runtime-review.md): reuse original-resource observation, fresh
  startup admission, fixture preparation and post-process-reap protected-file scanning. Do not
  repeat its completion-loss/reopen matrix or erase the retained R1 failure.

The first-start postmaster had PPID 1, PGID 27 and SID 27, while pg0 had PGID/SID 9.
Consequently the Native wrapper's process-group signal cannot supervise all PostgreSQL processes.
The prerequisite reaped the original postmaster and another adopted process; it did not separately
identify that second process's role. This case must capture the live logger and adopted descendants.
Measured prerequisite storage was 113,951,227 logical bytes / 2,515 entries; checked stop took
0.144 seconds. These support the finite bounds below, not guaranteed runtime performance.

## Narrow implementation boundary

Only the following task-local implementation is proposed after review:

| File under `research/` | Responsibility |
| --- | --- |
| `docker-database/fake_child.py` | Fixed Linux database wrapper; independently validate fake input/dotenv, supervise one generation, retain SQL/process/stop facts, scan its stopped volume. |
| `docker-database/run-persistence.ts` | One two-generation admitted case using existing Core/Shell/installation/registry/Docker/process helpers and E2E relay. |
| `docker-database/database-read.py` | Fixed read-only stdin payload for small reports, mount facts and bounded wrapper/PostgreSQL process identities in the exact owned container. No SQL writes or arbitrary path/mode input. |
| `docker-database/README.md` and task self-check record | Exact new token, input hashes, staged manifest, command/budget/cleanup instructions and scoped verification evidence. |

Copy the unchanged Native `docker/standalone/Dockerfile.c2a-fake` and eleven bootstrap modules
to the fresh build context. Replace only that context's `managed_bootstrap/fake_child.py` with
the reviewed task file. The other ten modules and recipe must match their recorded source hashes.
Do not edit `H:/hindsight` production sources, Host/Core/Shell, shared schemas, adapters, original
fixtures, `.trellis/scripts/`, dependencies or templates. Leave accepted `first-start.py` intact;
reuse its proven bounded SQL/process/tool operations in the task wrapper without importing its
PID-1 experiment entrypoint or adding a general supervisor/scanner framework.

The wrapper imports the existing installed
`managed_bootstrap.supervision.enable_linux_reaping()`; the package initializer is boot-free and
the recipe installs it in the isolated interpreter's site-packages. Do not add another ctypes/prctl
helper, change Python search paths or import `hindsight_api`, pg0's Python wrapper or providers.

## Frozen resources and bounds

Root freezes one new UUID `T` into the task fixture/staging before byte review. It is a build-time
case identity, not an arbitrary runtime environment setting or command selector. The fixture's
SQL identifiers and filesystem layout below remain fixed across that substitution.

| Binding | Value |
| --- | --- |
| Docker `D` | `C:/Program Files/Docker/Docker/resources/bin/docker.exe` |
| Docker SHA-256 | `0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d` |
| Endpoint `E` / engine ID | `npipe:////./pipe/dockerDesktopLinuxEngine` / `93e8319e-24b7-4a7d-88f1-60923ad681e0` |
| Cached base `I` | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| New stage `S` / client config `C` | `G:/TakiAgent-c2a-database/persistence-T` / `S/client-config` |
| Protected Windows root `W` | `C:/taki-c2a-db-persistence-T` |
| Root markers | Exact `.c2a-docker-owner` in S and W containing T, using the existing preparation convention |
| New image tag | `taki-c2a-db:T`, label `taki.c2a.fixture=T`; record immutable result ID `J` before admission |
| Container `CID` / volume `V` | Original IDs created by the admitted deployment and retained in its protected registry; one of each, never an existing resource |
| Volume root `R` / cluster `Q` | `/home/hindsight/.pg0` / `/home/hindsight/.pg0/c2a-db/data` |
| Installation `A` | `/home/hindsight/.pg0/.pg0/installation/18.1.0` |
| Bundled CLI `P` | `/app/api/.venv/lib/python3.11/site-packages/pg0/bin/pg0` |
| P SHA-256 | `20c65441992d3f1d433c7d5d33a14aba0030c77913beed9c9571e3816ea7f8fb` |
| Local SQL | Port 55432, user/database `postgres`, fixed public password `c2a-probe-public-password` |
| DB paths | `R/tmp`, `R/socket`, `R/log/postgresql.log`; pg0 name `c2a-db` |
| Fixed reports | `R/c2a-db/manifest.json`, `R/c2a-db/current.json`, `R/c2a-db/last-stop.json` |

Recheck the cached image/empty UID-1000 volume seed and reuse the accepted base probe if its
inputs still match. Require absent S/W/tag and exclusive run fence; reject collisions. Root uses
its existing locally cached build recipe, default builder, `--pull=false --network=none --load`,
the verified base, one new tag/label and a complete context hash manifest. No pull, download,
dependency install, daemon operation, additional inspector or new heavy binary build. Reuse the
existing pinned Node/Shell/install scaffolding and its tiny staged key adapter.

The actual admitted adapter fixes network none, no published ports, UID/GID 1000, one named volume
and the existing 8 MiB private tmpfs. Inspect its actual complete configuration. The standalone
prerequisite's 512 MiB / one CPU / 64-PID Docker limits do **not** apply to this adapter; do not
claim them or add adapter flags. Runtime process enumeration is capped at 64 entries; that is an
observation/failure threshold, not a Docker PID quota.

Before preparation and at phase boundaries require G: free >=20 GiB, C: free >=1 GiB,
new G: growth <=2 GiB and W <=256 MiB / 4,096 files. Monitor only R's metadata during runtime:
<=1 GiB logical bytes and <=4,096 entries, at most every 500 ms as in the accepted supervisor.
These are observed stop thresholds, not disk quotas. No model/cache/rootfs or original-data scan.

Budgets: local build <=10 minutes; admitted two-generation case <=15 minutes; separate final
cleanup <=5 minutes. Each wrapper has 60 seconds from start dispatch through SQL/data verification,
25 seconds for stop/reap/control-state/scan/report, and 300 seconds total including that shutdown.
Initiate lifetime-expiry shutdown by second 275 and retain expiry as failure. Every normal planned
Docker stop uses `--time 45` with an independent client deadline <=55 seconds. Existing 90-second
authority and 30-second Native group-supervision clocks remain unchanged.

## Wrapper contract and database generations

### Before any database effect

Preserve the current fixed fake-slot validation, rejection of inherited forbidden variables,
`PYTHON_DOTENV_DISABLED=true` assertion, actual `load_dotenv` no-change check and validated
Native startup UUID. Install TERM/INT handlers and enable the existing Linux subreaper before
initializing the database. Publish the existing <=1 KiB `R/c2a-child.json` running marker within
the consumer's five-second wait, with exactly wrapper PID/startupId/state. It represents wrapper
liveness only. SQL readiness lives in the separate private task report.

Drop the wrapper's fake environment/value references after validation. Before importing psycopg2,
clear the process environment and construct only the accepted first-start DB environment:
HOME=R, TMPDIR/TMP/TEMP=R/tmp, LANG=C, LC_ALL=C, TZ=UTC, PATH empty and
PYTHON_DOTENV_DISABLED=true. Raw PG utilities add only `LD_LIBRARY_PATH=A/lib`.
No fake value becomes a password, URI, row, argument or descendant environment variable.
Clearing references is not a claim of secure memory erasure; no environment/memory dump is taken.

Native still launches the wrapper with DEVNULL stdio and a new session. The wrapper uses direct
Popen handles and `start_new_session=True` for the pg0 CLI or raw postmaster, recording actual
PID/start ticks/PPID/PGID/SID/executable. The wrapper itself becomes the nearest subreaper so the
detached first-generation postmaster must be adopted by it. Never infer ownership from group ID.

### First generation: one offline pg0 initialization

Require no manifest, init intent, Q or instance metadata. Create `R/c2a-db/init-intent.json`
exclusively with case/startup identity before dispatch. Any partial prior state fails closed;
never delete it, rerun initdb or retry pg0 start. Verify the fixed CLI hash and accepted raw-tool
versions/hashes. Extracted tools are checked after the one first start and before trusting them.

Run the accepted pg0 command once, changing only its fixed name and data directory:

```text
P start --name c2a-db --version 18.1.0 --port 55432
  --username postgres --password c2a-probe-public-password --database postgres --data-dir Q
  -c listen_addresses=127.0.0.1 -c unix_socket_directories=R/socket
  -c shared_buffers=16MB -c maintenance_work_mem=16MB -c work_mem=1MB
  -c effective_cache_size=64MB -c max_connections=8 -c max_worker_processes=0
  -c max_parallel_workers=0 -c max_parallel_maintenance_workers=0
  -c min_wal_size=32MB -c max_wal_size=64MB
  -c fsync=on -c synchronous_commit=on -c full_page_writes=on
  -c logging_collector=on -c log_directory=R/log -c log_filename=postgresql.log
  -c log_rotation_size=1MB -c log_statement=none
```

Use the already proven interruptible psycopg2 async/poll path, fixed connection parameters,
three-second per-connection cap and statement_timeout=2000, all sharing the startup deadline.
Require CLI exit 0 and real SQL; record version, cluster system_identifier, postmaster start time,
backend PID, actual data_directory, port/listeners/socket and all three effective durability settings.
The observed pg0 argv can include `-F`; only actual enabled settings pass.

Create one ordinary logged table `public.c2a_persistence` with fixed columns `case_id uuid PRIMARY
KEY, payload text NOT NULL`. Parameterize a single insert: T plus a deterministic 4 KiB ASCII
payload derived from T. Use explicit SQL BEGIN/COMMIT with the asynchronous connection, retaining
each polled result rather than calling unsupported async connection transaction methods.
Close that connection; from a new connection read the
one row, exact payload, count, SHA-256 and `pg_class.relpersistence='p'`. Generate the expected
payload independently in the Windows fixture as well. Store the safe ID/length/digest/result facts,
not fake values. Publish manifest and first ready report atomically only after this verification.

The manifest binds T, first startup, cluster ID, Q, row ID/length/digest, source/tool hashes and
version. It is test evidence, never a Host authority, accepted receipt or startup permit. The intent
remains as original evidence. A valid manifest alone is insufficient for the restart branch:
require a successful first stop report for that manifest/first startup and an actual clean
`pg_controldata` state before any second launch. Missing, mismatched or incomplete state fails.

### Second generation: direct existing-cluster start, read only

After the new Native startup's fresh admission, validate original manifest/first-stop identities,
the exact extracted tools, absent postmaster PID file/no live matching PG process and clean cluster
state. Do not use stale pg0 instance PID metadata as current truth. Do not call pg0, initdb, CREATE,
INSERT or another seed/repair path.

Directly Popen `A/bin/postgres -D Q -p 55432` with the same explicit `-c` settings listed above
and sanitized raw-tool environment. This foreground Popen is the owned postmaster handle.
Require actual PPID=wrapper and record all process identities. After SQL readiness, use SELECT only
to read the original table and compare exact row/count/payload/hash/logged status, cluster ID and
settings. Require a new postmaster start identity/time. Numeric PIDs may repeat across container
starts; bind them to the different Native startup and observed process start facts.

Both generations record exact tools beneath A/bin:

| Tool | Required SHA-256 |
| --- | --- |
| postgres | `c51a24681dd5002766ea2f2081340d894762144a75148f89b3d2b4f98995f46d` |
| initdb | `3ca6d4b1cecbd837ef33320e37ff2ecd1abec29aa052bf04b71991f226d34549` |
| pg_ctl | `cda21f47857542878b0c687ece522ef96cafeacd3cc3f1bd2ceebd25d71cc76a` |
| pg_controldata | `72d19abe534d1823a02cb2418d57b1b2f815bcc031cbe9c3946d01b2b8f6c499` |

Require regular readable/executable ELF files and versions PostgreSQL 18.1; bound hashes/utility
output as in first-start. Record the SQL backend-to-postmaster parent link while connected, live
logger/process identities and the actual postmaster argv. No PATH fallback or additional installation.

## Checked stop, supervision and evidence scan

TERM received after ready is the expected planned stop. TERM during initialization, lifetime expiry,
unexpected child exit, timeout, bounds or identity failure retains the first failure. The first
termination timestamp starts one monotonic 25-second shutdown deadline; cleanup never resets it.
Use the accepted repeating alarm/remaining-time checks during SQL, file/hash work and subprocesses.

1. Close all SQL clients. Revalidate the exact postmaster PID/start ticks/executable and Q PID file.
2. Invoke once `A/bin/pg_ctl stop -D Q -m fast -w -t 15`; at most 17 seconds including utility reap.
   Require exit 0. No pg0 stop/drop, PID-file removal or guessed signals to other processes.
3. Wait/reap the original postmaster and all wrapper-adopted descendants; capture status/exit codes
   and require no remaining matching PG processes, logger or owned CLI/utilities. Direct Popen
   objects must reap their own children before generic adopted-child waitpid. For first generation
   the postmaster is adopted; for second generation its Popen owns wait/reap. Record these distinctly.
4. Require Q/postmaster.pid gone and `A/bin/pg_controldata Q` exit 0, original SQL cluster identifier
   and `Database cluster state: shut down`. Utility cap three seconds shares the same deadline.
5. Only after PG and its writers are gone, write the stopped wrapper marker and stream-scan the
   entire new R within the remaining deadline. Then atomically publish the bounded last-stop report
   and exit. Root still checks actual wrapper/container termination separately from that marker.

The original first-start scanner is metadata-only; the existing fake-case `container-scan.py`
reads whole files, has smaller bounds and requires a live wrapper. Neither is the DB scan.
Keep the required streaming logic in this task wrapper: <=1 GiB / 4,096 entries, 1 MiB chunks,
fixed 73-byte `C2A_FAKE_[0-9a-f]{64}` matches and 72-byte overlap. Count a cross-boundary match
once, retaining match end offsets beyond the previous chunk boundary. Record actual entries,
regular-file bytes, link-text bytes, hit count, elapsed time and explicit completion. Never turn a
limit or unreadable entry into truncated success. No PG write runs concurrently with this scan.

Permit only file symlinks within A whose fully resolved regular target is also in the scanned
installation tree; count/scan link text, do not follow directory links or scan the same target twice.
Reject links outside A/R and other special files. PG's socket must be gone after successful stop.
The stopped marker is included in that scan. The final last-stop report is written after it:
read this report back through the fixed helper/copy path and scan its returned bytes in Root
before accepting. No additional report file is written after scanning.

Keep startup output <=64 KiB, accumulated PostgreSQL log <=64 KiB, raw utility output <=8 KiB
each and every JSON report <=128 KiB. `last-stop.json` names the exact startup; Root retains its
first-generation bytes before the second generation can replace it. Logs/report size bounds are
monitored and fail on overflow. Use safe error codes and retained
bounded nonsecret SQL/control/log facts; no raw environment, private frames, grants or exceptions.

If initialization fails, use the accepted exact-identity raw-stop attempt when possible and reconcile
only owned children. Never obscure the first failure with cleanup errors. If supervision/scan cannot
finish in 25 seconds, the case fails; Native's later group kill or Docker's namespace termination
cannot establish graceful database shutdown. Root retains timeout/forced/unknown facts and exact
resource identities for bounded cleanup. Do not add an inspector or extend deadlines to obtain PASS.

## One admitted two-generation sequence

1. **Prepare once.** Root pins binaries/engine/base, unrelated-container baseline, new roots/tag,
   exact task bytes and complete image context. Build once and admit immutable J. Provision the
   existing real fixture Core/Shell/Catalog/installation once with generated fake values. Route this
   Shell through the existing E2E `startCapabilityRelay`; use the real canonical Permission Gate.

2. **Observe before first injection.** Re-arm `mutateNext` through earlier requests until
   `control.capabilityId === 'hindsight-deployment'` and parsed `DeploymentEffectV1Schema` action is
   `inject`. In that callback arm existing `pauseNextExecute()`, returning the request unchanged.
   Match the held execute to the original requestId, complete control and exact Effect input;
   fail on mismatch. Hold it at most ten seconds after capture, without extending authority. Read
   the exact CID's Native waiting state and bounded process list: no wrapper/postmaster/PG cluster
   initialization. Then release the original execute once. Do not record its authorization, mutate
   it or replay it. This existing relay seam pauses before Host execution; no Native hook is added.

3. **First running generation.** Require the real admitted running status and separate wrapper
   report proving first SQL/committed logged row/fresh-connection verification. Correlate original
   deployment, container/image/volume/config, startup and actual Host/Core Run/Attempt/Effect facts.
   Record no-TTY submitter, safe Docker metadata/log/argv surfaces and first actual process ancestry.
   Require all public deployment results to retain `deploymentReady:false`.

4. **Stop original CID, then start it waiting.** Revalidate engine/CID/image/labels/Mounts and call
   `D --host E --config C stop --time 45 CID` once, client <=55 seconds. Inspect stopped state and
   ExitCode/OOMKilled before `D --host E --config C start CID` once. Retain both actual command
   results; do not use restart to hide the stopped checkpoint. No volume/image/container recreation.
   Read first `last-stop.json` after start and require all checked-stop/reap/scan facts. Require
   the original cluster/manifest and old stopped marker, new Native startup, fresh private tmpfs
   protocol state, no wrapper/PG process and Native waiting without the old grant/binding.

5. **Read-only recovery cannot start DB.** Call explicit `observe` and the original initial start
   key once. Require unchanged original resource and consumed-attempt facts, the new waiting startup
   and still no DB. No new checkpoint, grant, submit or startup effect may be caused by those reads.
   Then call `resumeStartup({deploymentId})` once through the actual Core/Gate/Host path. Require a
   new startup Run/Attempt/Effect/custody/checkpoint/authorization and one new private submission.
   Bind all new identities to the same original deployment/config/CID/J/V.

6. **Second SQL read and final stop.** Require raw-postgres generation, unchanged cluster and exact
   original row, enabled durability, different process/startup facts and no reseeding. Repeat
   `resumeStartup` once; require observation only and the same live postmaster. Stop the exact CID
   as above and inspect its final state. Copy only its fixed last-stop report for final checks:

   ```text
   D --host E --config C cp CID:/home/hindsight/.pg0/c2a-db/last-stop.json S/final-stop.json
   ```

   Bound this client to ten seconds and output bytes to the fixed report contract; no recursive
   copy or Linux shell. Accept only a regular local file <=128 KiB, parse and bind T/new startup/
   cluster to the prior second ready report, and sentinel-scan it before preservation. Missing or
   oversized evidence fails. The first stop report is already retained from Step 4. No final
   start or additional container is needed to read the stopped container's fixed small report.

For live reads use exactly `D --host E --config C exec -i CID /app/api/.venv/bin/python -I -B -`,
feeding the reviewed `database-read.py` bytes and closing stdin. It reads only the fixed small
reports/marker and this container's bounded proc/mount facts, returns <=128 KiB, runs <=5 seconds,
and accepts no argv, SQL, path or command selector. Root bounds the client and output independently.
The helper does not scan PG data, dump environment or copy raw files. Use complete fixed Docker
argv with cleared host environment and hidden windows through Root's existing runner.

Expected effects: one volume create, one container create, two starts of that same CID, two
planned stops, two private submitters, one pg0 initialization and one raw-postgres restart.
Correlate bounded resource-specific Docker events/exec metadata with the real protected registry
and report generation facts. Read-only control/probe execs are distinct from submitter execs;
do not reuse the first fake case's fixed exec count. No Core/Shell reopen or fault loss is needed.

## Verification, preservation and owned cleanup

The implementer will run only scoped Python Ruff/format/AST/in-memory compile checks and the
existing recovery-style scoped ESLint/single-entry no-emit TypeScript check for changed fixture
files. Review fixed SQL, signal/deadline/reap paths and overlap/symlink bounds. Do not rerun the
accepted 182 source tests, full builds, Rust/Core/SDK gates or earlier Docker cases. Independent
static review must bind all executable bytes and the substituted image context before Root runs.

Root records `S/persistence.json`: input/resource identities, per-generation SQL/tool/process/
shutdown facts, actual commands/events/submit counts, public/protected/volume scans, elapsed and
storage bounds, first failure and cleanup. Source facts, reported runtime facts and independently
compared results stay distinct. The report is fixture evidence; no setup receipt is issued.

Preserve bounded public messages, registry/config, actual Docker environment options and argv,
container/fixture logs and returned reports, scanning them for the fixed fake sentinel. Credentials
and private delivery stay in their intended channel; do not log raw relay frames or authorization.
Only scan the entire protected W tree **after** Core/Shell/helper descendants are stopped and
reaped, using the accepted R2 ordering; the resident's exclusive deployment.lock must be released.

Cleanup has five minutes total, uses only the original manifest-owned identities, and retains
failures. Each remaining operation uses its cap or the remaining deadline, whichever is smaller:

1. Close operator/relay, stop recorded fixture Core/Shell process trees and wait (<=15 seconds each).
   Confirm captured resident/helper exit. Never kill by executable name or unrelated process search.
2. Revalidate engine, original CID/name/image/labels/mounts and registry ownership. If still running,
   stop only CID with `stop --time 45 CID`, client <=55 seconds. A fallback stop is cleanup evidence,
   not an extra successful database test. Require stopped before `rm CID`, with no force option.
3. Verify no container references V, revalidate V's original labels/driver, then `volume rm V`.
   Inspect original exact identities/names to prove absence. Ambiguous ownership stops deletion.
4. Check tag maps to J with case label, J differs from base I, and no other tag/container relies on
   the new artifact; `image rm taki-c2a-db:T`. Verify the tag absent. No base-image/cache deletion.
5. Scan/preserve W after process reap. Resolve absolute W, check exact token marker and reject
   reparse points, then native PowerShell `Remove-Item -LiteralPath W -Recurse` for only that tree.
   Root archives/hashes/verifies S evidence before equivalent canonical-path/token/no-reparse
   checks and removal of only S. No shell-composed deletion or staging reuse.
6. Compare the original seven container IDs/states/start times/restart policies with the baseline.
   Leave Docker Desktop and unrelated workloads untouched. No prune, daemon restart or VHDX claim.

An independent runtime PASS can accept this admitted task database's generated-data persistence
and graceful supervision only. Inner Native ACK loss, shared-daemon restart, actual Native API/
provider startup, C1 service criteria, C2b production readiness and owner manual acceptance remain
separate. This plan adds only this Markdown file; no Docker, runtime, test, build, production or
Git lifecycle operation was performed in preparing it.
