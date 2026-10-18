# C2a offline extraction and first-start prerequisite

Date: 2026-10-15. Owner: `/root/c2a_database_implement`. **Plan only; not executed.**

## Decision and evidence

Use **one new standalone container and named volume, one official `pg0 start`, then checked raw
PostgreSQL shutdown**. That single startup can establish offline extraction, usable binaries,
actual SQL/data/process paths and clean control state. No separate help container or extraction-only
framework is needed. Check the CLI interface inside this same container immediately before startup.
This resolves a prerequisite for the task-specific admitted child; it is not admitted-chain,
restart/persistence, C2b, Native API/provider or production acceptance. Keep all existing gates open.

The actual metadata probe is preserved in [the evidence archive](c2a-database-probe-evidence.zip):
archive SHA-256 `9a5e5be39037b1ddf4465b8698a99af0f2e95bdab5864bd34aaed6e47f0db893`;
`probe-runtime.json` SHA-256 `8488500be00fc0a1be6f75bcd1b5fc1acaabcdb1d0d51641018e59ba7cadefb1`.
It found Python 3.11.16, pg0-embedded 0.15.0, psycopg2-binary 2.9.11, an empty UID-1000 data seed,
and no package-listed raw postgres/initdb/pg_ctl/pg_controldata. The probe container was removed.

Official tag `v0.15.0` resolves through annotated tag `f27f47ab0d7df150101299fadea5b2ee876a7164`
to commit `b8b8451956f13dbb4b00a553c8a6cc8afb320af9`. Its
[Python wrapper](https://github.com/vectorize-io/pg0/blob/b8b8451956f13dbb4b00a553c8a6cc8afb320af9/sdk/python/pg0/__init__.py)
has SHA-256 `ac3f14beaff4b1cdfc0fdf674df2d2c322131bc4852de09b58f0ed7bc4288dc1`, matching the
13,837-byte file actually read from the image. This supports source-guided planning; it does not
attest that the bundled executable was reproducibly built from that commit.

| Pinned official source | Relevant contract |
| --- | --- |
| [main.rs](https://github.com/vectorize-io/pg0/blob/b8b8451956f13dbb4b00a553c8a6cc8afb320af9/src/main.rs), lines 65-112, 216-248 | `start --version/--data-dir/-c`; base is HOME/.pg0; instance metadata includes the supplied password. |
| Same file, lines 464-543, 664-697, 856-874 | Bundled archive extraction to installation/version, bundled library setup and `trust_installation_dir=true`; optional internal ldd check; setup timeout is **600 seconds**, requiring an independent outer limit. |
| Same file, lines 934-972, 1043-1093 | Records the actual postmaster PID, prints nonsecret fixture connection parameters and detaches; `stop` can fall back to SIGKILL. Neither CLI exit nor `Pg0.stop()` proves graceful shutdown. |
| [versions.env](https://github.com/vectorize-io/pg0/blob/b8b8451956f13dbb4b00a553c8a6cc8afb320af9/versions.env), line 1; [build.rs](https://github.com/vectorize-io/pg0/blob/b8b8451956f13dbb4b00a553c8a6cc8afb320af9/build.rs), lines 12-38 | Release source embeds PostgreSQL **18.1.0**. Actual CLI help and extracted utility versions must confirm this before proceeding. No different-version fallback. |

Only official source text and the preserved probe were read for this plan. No runtime asset download,
installation, binary reversing, whole-filesystem scan or Docker call occurred. The existing approval
covers this project-owned validation; independent engineering review is the next gate.

## Frozen resources, environment and limits

Reuse the exact Docker executable/engine/image from [the metadata-probe instructions](docker-database/README.md).

| Binding | Value |
| --- | --- |
| `D` / SHA-256 | `C:/Program Files/Docker/Docker/resources/bin/docker.exe` / `0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d` |
| `E` / engine ID | `npipe:////./pipe/dockerDesktopLinuxEngine` / `93e8319e-24b7-4a7d-88f1-60923ad681e0` |
| Cached image `I` | `sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db` |
| Bundled CLI `P` | `/app/api/.venv/lib/python3.11/site-packages/pg0/bin/pg0` |
| `P` SHA-256 / bytes | `20c65441992d3f1d433c7d5d33a14aba0030c77913beed9c9571e3816ea7f8fb` / 34,205,672 |
| `T`, `N`, `V` | One fresh Root-generated UUID; `taki-c2a-db-first-T`; `taki-c2a-db-first-T-data` |
| `S`, client config `C` | New `G:/TakiAgent-c2a-database/first-T`; new empty `S/client-config`; exact `.c2a-db-first-owner` marker contains T |
| Volume mount `R` | `/home/hindsight/.pg0` |
| Explicit cluster `Q` | `/home/hindsight/.pg0/c2a-first/data` |
| Expected installation `A` | `/home/hindsight/.pg0/.pg0/installation/18.1.0` |
| Expected metadata | `/home/hindsight/.pg0/.pg0/instances/c2a-offline/instance.json` |
| Nonsecret parameters | name `c2a-offline`, user/database `postgres`, password `c2a-probe-public-password`, explicit port `55432` |

`HOME=R` deliberately matches the accepted consumer's HOME. The nested `.pg0` installation is
therefore intentional; `--data-dir Q` keeps the cluster explicit. All new storage stays in V.
The future fixed Python PID-1 supervisor clears inherited environment **before importing psycopg2**;
sets only HOME=R, TMPDIR/TMP/TEMP=R/tmp, LANG=C, LC_ALL=C, TZ=UTC, PATH="" and
PYTHON_DOTENV_DISABLED=true; and never imports pg0/hindsight_api/providers. Raw PG commands add only
`LD_LIBRARY_PATH=A/lib`. No fake sentinels or real credentials enter this standalone case. The
public password is intentionally nonsecret and may appear in pg0 output and its new instance.json.

PATH stays empty: there is no executable discovery or retry with another PATH. The official CLI's
optional `ldd` subprocess may be unavailable; its source explicitly tolerates that condition.
Actual raw-tool execution and SQL startup establish loader usability. If the CLI needs another
utility/environment entry, retain the failure and revise the reviewed plan instead of adding it.

Container limits: network none, read-only rootfs, UID/GID 1000, 512 MiB memory, one CPU, 64 PIDs,
no ports or host bind mounts. Only new V is writable; no tmpfs volume/inspector/build is needed.
Require at least 20 GiB free on G:; at most 2 GiB new G: evidence/staging and 1 GiB total new volume
storage. The volume limit is an observed threshold, not a Docker quota: the supervisor measures
only this new tree's metadata every 500 ms, at most 4,096 entries, and aborts on a bound. No content
scanner is introduced. No C: protected installation or H: build tree is required for this prerequisite.

Budgets: three seconds/8 KiB per CLI help/version; **60 seconds total from start dispatch through
first successful SQL**, including extraction/init; at most 25 seconds for checked shutdown;
180 seconds for the complete container run and 60 seconds for owned cleanup. Capture at most
64 KiB combined pg0 startup output, 64 KiB PG log, 8 KiB per raw utility, and 128 KiB final JSON.
Use bounded owned log files with size monitoring, not a wait-for-pipe-EOF that detached descendants
can keep open. Preserve first failure; do not retry startup. Source's 600-second timeout never governs.

## One bounded sequence

1. Root freezes a fresh resource manifest and the later supervisor's reviewed bytes/hash. Recheck D,
   the exact engine, image Linux/amd64/no Config.Volumes, absent N/V/S and original unrelated-container
   baseline. Name collisions refuse; no adoption. Create only S/C and the marked, labelled V/N below.
   Default volume population copies the image's confirmed empty UID-1000 seed; before startup the
   supervisor must require empty writable R with UID/GID 1000. No chown/setup helper or existing volume.

   ```text
   D --host E --config C volume create --driver local --label taki.c2a.db-first=T V
   D --host E --config C create --name N --label taki.c2a.db-first=T
     --label taki.c2a.role=database-first-start --pull never --network none
     --read-only --user 1000:1000 --interactive --log-driver none
     --memory 512m --cpus 1 --pids-limit 64 --cap-drop ALL
     --security-opt no-new-privileges=true --mount type=volume,source=V,target=R
     --entrypoint /app/api/.venv/bin/python I -I -B -
   D --host E --config C container inspect CID
   D --host E --config C start --attach --interactive CID
   ```

   These are argument-array templates, not shell snippets. CID is the recorded create reply, never
   a selected existing resource. Require exact image/name/labels/config and only V in Mounts before
   starting. Root feeds the exact supervisor bytes via stdin and closes it, using the existing bounded
   hidden-window, shell-false runner and cleared host environment. Install TERM/INT handling before
   creating R/tmp, R/socket, R/log or starting any child. The Python supervisor remains PID 1 and reaps
   its children, including detached postmaster descendants that become orphans in this private namespace.

2. Verify P's hash, execute `P --version` and `P start --help` (once each), and require pg0 0.15.0,
   all used flags and default PostgreSQL version 18.1.0. Record the actual outputs. Mismatch exits
   without `start`; no separate follow-up help container is authorized by this plan. Baseline the
   container's at-most-64 process identities, requiring no existing postmaster/instance metadata.

3. Invoke exactly one direct Popen command below, in a new Linux session with the sanitized
   environment. Record CLI PID/start ticks/PGID/session. No Python Pg0 wrapper or pg0 info/stop/drop:

   ```text
   P start --name c2a-offline --version 18.1.0 --port 55432
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

   The published source explicitly extracts bundled PG/pgvector/runtime libraries. Network none and
   trust of the exact extracted installation constrain this to offline inputs. Any missing bundle,
   library/utility, attempted fetch, bound, OOM or nonzero start exit fails; no installation or fallback.
   Startup logs may carry only the fixed public parameters. CLI exit/printed PID is not SQL readiness.

4. Within the same 60-second startup deadline, use existing psycopg2 with explicit host=127.0.0.1,
   port=55432, dbname/user=postgres, the public password, connect_timeout=3 and statement_timeout=2000.
   Require CLI exit 0 and one actual SQL connection. Read `version()`, `pg_postmaster_start_time()`,
   `pg_backend_pid()`, `current_setting('data_directory')`, `fsync`, `synchronous_commit`,
   `full_page_writes`, `port`, `listen_addresses`, `unix_socket_directories` and
   `system_identifier` from `pg_control_system()`. Require exact Q/port and enabled durability.
   No workload table, reseed/restart or persistence claim belongs in this prerequisite.

   Read only the fixed new instance.json and Q/postmaster.pid (each <=16 KiB). Require their PID/Q
   to match SQL, metadata installation_dir=R/.pg0/installation and version=18.1.0. Link the SQL backend
   PID's actual parent to the postmaster; record `/proc/<pid>/{stat,status,cmdline}` and executable
   symlink for CLI/postmaster/backend, including start ticks, PPID, PGID and session. Read only this
   container's process namespace, at most 64 PIDs. Require the postmaster executable to resolve to
   A/bin/postgres, and verify its real post-CLI-exit parent; never assume detachment/group semantics.

   At the four **exact** A/bin/{postgres,initdb,pg_ctl,pg_controldata} paths, confirm regular ELF files,
   UID-1000 read/execute/traversal, stream hashes (<=128 MiB each / 256 MiB total), and run
   `--version` (three seconds/8 KiB each) with LD_LIBRARY_PATH=A/lib. Retain versions and exact hashes.
   Require PostgreSQL 18.1 tooling; 18.1.0 is the bundle directory/version selector. No directory-wide binary
   search, PATH fallback, arbitrary lib inventory or additional postmaster launch. A missing required
   tool is unresolved even if SQL works; reconcile/clean the owned process as a failed prerequisite.

5. Close SQL clients. Revalidate the original postmaster PID/start identity/executable and Q's PID
   file, then use the now-confirmed raw executable:

   ```text
   A/bin/pg_ctl stop -D Q -m fast -w -t 15
   A/bin/pg_controldata Q
   ```

   pg_ctl has at most 17 seconds including utility reap; require exit 0. Within five more seconds
   require the original process exited, reap if adopted, no matching postmaster remains and
   postmaster.pid is gone. pg_controldata then has three seconds: require exit 0, exact cluster
   identifier matching SQL and **Database cluster state: shut down**. Keep raw bounded output and
   timing. All these actions share one 25-second shutdown deadline. Preserve the bounded PG log and
   actual descendant exit/state facts. A returned pg0 stop, absent PID file, wrapper exit or later
   crash recovery alone cannot pass. Any forced/unknown shutdown fails the prerequisite.

## Failure, cleanup and release

On startup timeout, interrupt/reap only the tracked CLI session and inspect only this new cluster
and container process namespace. If the postmaster and raw pg_ctl can be identified exactly, make
the same one bounded checked-stop attempt. Failure before metadata publication never authorizes a
new `start`. Termination handling must cover initialization and detached children; an incomplete
ownership/shutdown result stays failed. Do not delete PID files, call pg0 drop, or mask stale state.

The supervisor emits bounded nonsecret results, then exits only after its normal checked stop or
explicit failed cleanup report. Root retains final container State/ExitCode/OOMKilled and the full
recorded resource identities. Revalidate CID/name/image/labels/Mounts and V's driver/label before
cleanup. If still running, `D --host E --config C stop --time 45 CID` is the outer cleanup bound;
any Docker timeout/SIGKILL or unknown postmaster exit is **forced/unknown cleanup, never graceful
success**. A daemon timeout retains resources for inspection; no retry against another engine.
Once stopped, `D --host E --config C rm CID`, then require V unmounted and remove only
`D --host E --config C volume rm V`. Verify both absent. No force removal, prune, image/daemon action,
existing-container stop or unrelated workload change. Compare the original container IDs/start times.

Preserve source/interface/output/SQL/process/control-state hashes and failure/cleanup facts in task
evidence before removing only S, after canonical-path/token/no-reparse checks using native PowerShell
LiteralPath operations. Do not copy extracted runtime assets into production or retain this volume
as an admitted resource. A PASS establishes the offline/raw-tool prerequisite only. The replacement
database child, its actual supervision and original-volume restart test remain separately reviewed.

This plan is released to Root for xhigh review. Only this Markdown file was changed; no fixture or
runtime implementation, test/build, Docker/WSL, production edit or Git lifecycle action was performed.
