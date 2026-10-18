"""INPUT: fixed private fake values, Native startup UUID and original fixture volume.
OUTPUT: one supervised PostgreSQL generation and bounded SQL/stop/scan evidence.
POS: task-only replacement child; no Docker API, provider or trusted receipt.

Bounded operations are adapted from the accepted first-start.py. That immutable
PID-1 experiment cannot be imported into this non-PID1, two-generation fixture.
"""

import hashlib
import json
import os
import re
import select
import signal
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

ROOT = Path("/home/hindsight/.pg0")
CASE = "b5c5fb7f-cd8a-402a-bd11-92839d191e98"
CASE_ROOT = ROOT / "c2a-db"
DATA = CASE_ROOT / "data"
MANIFEST = CASE_ROOT / "manifest.json"
CURRENT = CASE_ROOT / "current.json"
LAST_STOP = CASE_ROOT / "last-stop.json"
INTENT = CASE_ROOT / "init-intent.json"
MARKER = ROOT / "c2a-child.json"
SENTINEL = re.compile(rb"C2A_FAKE_[0-9a-f]{64}")
PAYLOAD = hashlib.sha256(CASE.encode("ascii")).hexdigest() * 64
ROW = {
    "case_id": CASE,
    "bytes": len(PAYLOAD),
    "sha256": hashlib.sha256(PAYLOAD.encode()).hexdigest(),
}
TOOL_HASHES = {
    "postgres": "c51a24681dd5002766ea2f2081340d894762144a75148f89b3d2b4f98995f46d",
    "initdb": "3ca6d4b1cecbd837ef33320e37ff2ecd1abec29aa052bf04b71991f226d34549",
    "pg_ctl": "cda21f47857542878b0c687ece522ef96cafeacd3cc3f1bd2ceebd25d71cc76a",
    "pg_controldata": "72d19abe534d1823a02cb2418d57b1b2f815bcc031cbe9c3946d01b2b8f6c499",
}
INSTALL = ROOT / ".pg0/installation/18.1.0"
INSTANCE = ROOT / ".pg0/instances/c2a-db/instance.json"
CLI = Path("/app/api/.venv/lib/python3.11/site-packages/pg0/bin/pg0")
CLI_SHA256 = "20c65441992d3f1d433c7d5d33a14aba0030c77913beed9c9571e3816ea7f8fb"
PASSWORD = "c2a-probe-public-password"  # Deliberately public, never a C2 fake sentinel.
ENV = {
    "HOME": str(ROOT),
    "TMPDIR": str(ROOT / "tmp"),
    "TMP": str(ROOT / "tmp"),
    "TEMP": str(ROOT / "tmp"),
    "LANG": "C",
    "LC_ALL": "C",
    "TZ": "UTC",
    "PATH": "",
    "PYTHON_DOTENV_DISABLED": "true",
}
RAW_ENV = {**ENV, "LD_LIBRARY_PATH": str(INSTALL / "lib")}
PG_NAMES = ("postgres", "initdb", "pg_ctl", "pg_controldata")
SETTINGS = {
    "listen_addresses": "127.0.0.1",
    "unix_socket_directories": str(ROOT / "socket"),
    "shared_buffers": "16MB",
    "maintenance_work_mem": "16MB",
    "work_mem": "1MB",
    "effective_cache_size": "64MB",
    "max_connections": "8",
    "max_worker_processes": "0",
    "max_parallel_workers": "0",
    "max_parallel_maintenance_workers": "0",
    "min_wal_size": "32MB",
    "max_wal_size": "64MB",
    "fsync": "on",
    "synchronous_commit": "on",
    "full_page_writes": "on",
    "logging_collector": "on",
    "log_directory": str(ROOT / "log"),
    "log_filename": "postgresql.log",
    "log_rotation_size": "1MB",
    "log_statement": "none",
}
SQL = """SELECT version(), pg_postmaster_start_time()::text, pg_backend_pid(),
 current_setting('data_directory'), current_setting('fsync'),
 current_setting('synchronous_commit'), current_setting('full_page_writes'),
 current_setting('port'), current_setting('listen_addresses'),
 current_setting('unix_socket_directories'), system_identifier::text
 FROM pg_control_system()"""


class Refusal(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refusal(code)


def read_bytes(path, limit=16384):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "regular_file_required")
        data = stream.read(limit + 1)
    require(len(data) <= limit, "file_output_bound:" + str(path))
    return data


def stream_hits(stream, guard, chunk_size=1024 * 1024):
    """Count fixed-width matches once across chunk boundaries, with 72-byte overlap."""
    tail, consumed, hits = b"", 0, 0
    while chunk := stream.read(chunk_size):
        guard()
        window = tail + chunk
        base = consumed - len(tail)
        hits += sum(base + match.end() > consumed for match in SENTINEL.finditer(window))
        consumed += len(chunk)
        require(consumed <= 1024**3, "scan_file_bound")
        tail = window[-72:]
    return {"bytes": consumed, "hits": hits}


def atomic_json(path, value, guard):
    guard()
    encoded = json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode() + b"\n"
    require(len(encoded) <= 128 * 1024 and not SENTINEL.search(encoded), "json_containment_bound")
    staging = path.with_name(path.name + ".staging")
    descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    guard()
    staging.replace(path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    guard()


def process_identity(pid):
    """Read only this container's proc namespace; zombies have no executable link."""
    directory = Path("/proc") / str(pid)
    try:
        raw_stat = read_bytes(directory / "stat").decode()
        fields = raw_stat[raw_stat.rfind(")") + 2 :].split()
        status = read_bytes(directory / "status").decode()
        identity = {
            "pid": pid,
            "state": fields[0],
            "ppid": int(fields[1]),
            "pgid": int(fields[2]),
            "session": int(fields[3]),
            "start_ticks": int(fields[19]),
            "stat": raw_stat.strip(),
            "status": status,
        }
        identity["uid"] = int(re.search(r"^Uid:\s+(\d+)", status, re.MULTILINE)[1])
        identity["argv"] = read_bytes(directory / "cmdline").decode().rstrip("\0").split("\0")
        identity["executable"] = None if fields[0] == "Z" else os.readlink(directory / "exe")
        return identity
    except FileNotFoundError:
        return None


class DatabaseChild:
    def __init__(self):
        self.started = time.monotonic()
        self.whole_deadline = self.started + 300
        self.phase_deadline = self.whole_deadline
        self.operation_deadline = self.whole_deadline
        self.stage = "preflight"
        self.startup_id = None
        self.log_directory = None
        self.generation = None
        self.manifest = None
        self.raw_process = None
        self.ready = False
        self.stop_started = None
        self.logger = None
        self.marker_published = False
        self.stopping = False
        self.seed_owned = False
        self.next_monitor = 0
        self.monitor_enabled = True
        self.hashed_bytes = 0
        self.cli = None
        self.cli_identity = None
        self.postmaster = None
        self.stop_attempted = False
        self.connection = None
        self.logs = {}
        self.result = {
            "version": 1,
            "case_id": CASE,
            "scope": "admitted-database-fixture",
            "deploymentReady": False,
            "first_failure": None,
            "commands": [],
            "raw_tools": {},
            "reaped": [],
            "signals": [],
            "storage_peak_bytes": 0,
            "start_dispatches": 0,
        }

    def fail(self, error):
        failure = {
            "stage": self.stage,
            "type": type(error).__name__,
            "detail": str(error)[:512] if isinstance(error, Refusal) else "operation_failed",
        }
        if self.result["first_failure"] is None:
            self.result["first_failure"] = failure
        return failure

    def alarm(self, _number, _frame):
        if time.monotonic() >= min(
            self.whole_deadline,
            self.phase_deadline,
            self.operation_deadline,
            self.stop_started + 25 if self.stop_started is not None else self.whole_deadline,
        ):
            raise Refusal("shared_deadline:" + self.stage)

    def terminate(self, number, _frame):
        if len(self.result["signals"]) < 8:
            self.result["signals"].append(number)
        if self.stop_started is None:
            self.stop_started = time.monotonic()
        if not self.ready and not self.stopping:
            self.fail(Refusal("termination_during_initialization"))
            raise Refusal("termination_during_initialization")

    def guard(self, deadline=None):
        require(
            time.monotonic()
            < min(
                deadline or self.whole_deadline,
                self.operation_deadline,
                self.phase_deadline,
                self.whole_deadline,
            ),
            "deadline:" + self.stage,
        )
        if self.seed_owned and self.monitor_enabled and time.monotonic() >= self.next_monitor:
            self.next_monitor = time.monotonic() + 0.5
            try:
                self.monitor()
            except (OSError, Refusal) as error:
                self.monitor_enabled = False
                self.fail(error)
                if not self.stopping:
                    raise

    def monitor(self):
        """Finite metadata walk of this new volume, including aggregate PG log bytes."""
        pending, count, total, pg_logs = [ROOT], 0, 0, 0
        while pending:
            with os.scandir(pending.pop()) as entries:
                for entry in entries:
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except FileNotFoundError:  # PostgreSQL may remove its temporary files.
                        continue
                    count += 1
                    total += info.st_size
                    if count > 4096 or total > 1024**3:
                        self.result["storage_bound"] = {
                            "bytes": total,
                            "entries": count,
                            "complete": False,
                        }
                        raise Refusal("volume_storage_bound")
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(Path(entry.path))
                    if Path(entry.path).parent == ROOT / "log":
                        pg_logs += info.st_size
        self.result["storage_peak_bytes"] = max(self.result["storage_peak_bytes"], total)
        self.result["storage_entries"] = count
        self.result["pg_log_bytes"] = pg_logs
        require(pg_logs <= 65536, "postgres_log_bound")
        for path, limit in self.logs.items():
            require(path.stat().st_size <= limit, "command_log_bound:" + path.name)

    def binary(self, path):
        self.guard()
        info = path.lstat()
        require(stat.S_ISREG(info.st_mode) and path.resolve() == path, "exact_regular_binary")
        require(os.access(path, os.R_OK | os.X_OK, effective_ids=True), "binary_access")
        require(info.st_size <= 128 * 1024**2, "binary_size_bound")
        value = hashlib.sha256()
        with path.open("rb") as stream:
            require(stream.read(4) == b"\x7fELF", "binary_not_elf")
            stream.seek(0)
            while chunk := stream.read(1024 * 1024):
                self.guard()
                self.hashed_bytes += len(chunk)
                require(self.hashed_bytes <= 256 * 1024**2, "hash_total_bound")
                value.update(chunk)
        traversable = all(os.access(p, os.X_OK, effective_ids=True) for p in path.parents)
        require(traversable, "binary_parent_traversal")
        return {
            "path": str(path),
            "sha256": value.hexdigest(),
            "bytes": info.st_size,
            "uid": info.st_uid,
            "gid": info.st_gid,
            "mode": oct(stat.S_IMODE(info.st_mode)),
            "readable_executable": True,
            "parents_traversable": traversable,
        }

    def command(self, argv, label, seconds=3, raw=False):
        self.guard()
        end = min(time.monotonic() + seconds, self.phase_deadline, self.whole_deadline)
        self.operation_deadline = end
        path = self.log_directory / (label + ".log")
        record = {"argv": argv, "log": str(path), "elapsed_seconds": None}
        self.result["commands"].append(record)
        before = time.monotonic()
        process = None
        try:
            with path.open("xb") as output:
                self.logs[path] = 8192
                process = subprocess.Popen(
                    argv,
                    stdin=subprocess.DEVNULL,
                    stdout=output,
                    stderr=subprocess.STDOUT,
                    cwd=str(ROOT),
                    env=RAW_ENV if raw else ENV,
                    close_fds=True,
                )
                while process.poll() is None:
                    self.guard(end - 0.2)  # Reserve bounded time to kill/reap a timed-out utility.
                    time.sleep(min(0.02, max(0, end - time.monotonic())))
                self.guard(end)
                record["exit_code"] = process.returncode
            record["output"] = read_bytes(path, 8192).decode("utf-8", errors="replace")
            require(record["exit_code"] == 0, "command_failed:" + label)
            return record["output"]
        except Exception as error:
            # Utility cleanup may also fail; retain the original cause before it runs.
            self.fail(error)
            raise
        finally:
            try:
                if process is not None and process.poll() is None:
                    record["utility_killed"] = True
                    process.kill()  # Only this utility; never a postmaster/CLI fallback.
                    process.wait(timeout=max(0.001, end - time.monotonic()))
                if process is not None:
                    record["exit_code"] = process.returncode
                if path.exists() and "output" not in record:
                    with path.open("rb") as stream:
                        raw_output = stream.read(8193)
                    record["output"] = raw_output[:8192].decode("utf-8", errors="replace")
                    record["output_truncated"] = len(raw_output) > 8192
                record["elapsed_seconds"] = round(time.monotonic() - before, 3)
            finally:
                self.operation_deadline = self.whole_deadline

    def processes(self):
        pids = [int(entry.name) for entry in Path("/proc").iterdir() if entry.name.isdecimal()]
        require(len(pids) <= 64, "process_count_bound")
        return [item for pid in sorted(pids) if (item := process_identity(pid)) is not None]

    def prepare(self):
        require(sys.platform == "linux" and os.getpid() != 1, "linux_child_required")
        require(os.geteuid() == os.getegid() == 1000, "uid_gid_required")
        require(sys.executable == "/app/api/.venv/bin/python", "fixed_python_required")
        names = {
            "TAKI_C2A_FAKE_" + suffix
            for suffix in (
                "CONNECTION",
                "DEFAULT",
                "RETAIN",
                "REFLECT",
                "CONSOLIDATION",
                "EMBEDDING",
                "RERANKER",
            )
        }
        values = [value for name, value in os.environ.items() if name in names]
        require(
            len(sys.argv) == 1
            and values
            and all(re.fullmatch(r"C2A_FAKE_[0-9a-f]{64}", value) for value in values)
            and os.environ.get("PYTHON_DOTENV_DISABLED") == "true"
            and not any(
                name in os.environ
                for name in ("PYTHONPATH", "NODE_OPTIONS", "HINDSIGHT_API_LLM_API_KEY")
            ),
            "fake_environment",
        )
        from dotenv import load_dotenv

        before = dict(os.environ)
        load_dotenv(Path.cwd() / ".env", override=True)
        require(dict(os.environ) == before, "dotenv_changed_environment")
        startup = os.environ["TAKI_C2A_STARTUP_ID"]
        require(str(uuid.UUID(startup)) == startup, "startup_uuid")
        self.startup_id = startup
        self.result["startup_id"] = startup
        from managed_bootstrap.supervision import enable_linux_reaping

        enable_linux_reaping()
        info = ROOT.lstat()
        require(
            stat.S_ISDIR(info.st_mode)
            and info.st_uid == info.st_gid == 1000
            and ROOT.resolve() == ROOT
            and Path.cwd() == ROOT,
            "root_identity",
        )
        self.result["wrapper_live"] = process_identity(os.getpid())
        require(
            self.result["wrapper_live"]["pgid"] == os.getpid()
            and self.result["wrapper_live"]["session"] == os.getpid(),
            "wrapper_session",
        )
        atomic_json(
            MARKER, {"pid": os.getpid(), "startupId": startup, "state": "running"}, self.guard
        )
        self.marker_published = True
        values.clear()
        before.clear()
        os.environ.clear()
        os.environ.update(ENV)
        self.seed_owned = True
        self.generation = 2 if MANIFEST.exists() else 1
        self.result["generation"] = self.generation
        if self.generation == 1:
            require(
                not CASE_ROOT.exists() and not INSTANCE.exists() and not INSTALL.exists(),
                "partial_initialization_refused",
            )
            CASE_ROOT.mkdir(mode=0o700)
            descriptor = os.open(
                INTENT, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600
            )
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(json.dumps({"case_id": CASE, "startup_id": startup}).encode())
                stream.flush()
                os.fsync(stream.fileno())
        else:
            self.manifest = json.loads(read_bytes(MANIFEST))
            previous = json.loads(read_bytes(LAST_STOP, 128 * 1024))
            require(
                self.manifest["case_id"] == CASE
                and self.manifest["data_directory"] == str(DATA)
                and self.manifest["row"] == ROW
                and self.manifest["tool_hashes"] == TOOL_HASHES
                and self.manifest["cli_sha256"] == CLI_SHA256
                and self.manifest["postgres_version"] == "18.1"
                and self.manifest["wrapper_sha256"]
                == hashlib.sha256(read_bytes(Path(__file__), 128 * 1024)).hexdigest()
                and self.manifest["first_startup_id"] != startup
                and previous["case_id"] == CASE
                and previous["generation"] == 1
                and previous["startup_id"] == self.manifest["first_startup_id"]
                and previous["status"] == "stopped"
                and previous["first_failure"] is None
                and previous["shutdown"]["state"] == "checked"
                and previous["shutdown"]["system_identifier"] == self.manifest["system_identifier"]
                and previous["volume_scan"]["complete"] is True
                and previous["volume_scan"]["hits"] == 0,
                "restart_manifest_binding",
            )
            require(
                json.loads(read_bytes(INTENT))
                == {"case_id": CASE, "startup_id": self.manifest["first_startup_id"]},
                "intent_binding",
            )
        for name in ("tmp", "socket", "log"):
            path = ROOT / name
            if self.generation == 1:
                path.mkdir(mode=0o700)
            require(path.is_dir() and not path.is_symlink(), "fixed_directory_required")
        self.log_directory = ROOT / "tmp" / startup
        self.log_directory.mkdir(mode=0o700)
        require(not (DATA / "postmaster.pid").exists(), "preexisting_postmaster_pid")
        baseline = self.processes()
        require(
            not any(
                item["executable"] in (str(CLI), str(INSTALL / "bin/postgres")) for item in baseline
            ),
            "preexisting_database_process",
        )
        self.result["baseline_processes"] = baseline
        self.result["cli_binary"] = self.binary(CLI)
        require(self.result["cli_binary"]["sha256"] == CLI_SHA256, "cli_hash_mismatch")
        if self.generation == 1:
            require(
                self.command([str(CLI), "--version"], "cli-version").strip() == "pg0 0.15.0",
                "cli_version_mismatch",
            )
            help_text = self.command([str(CLI), "start", "--help"], "cli-help")
            require(
                all(
                    flag in help_text
                    for flag in (
                        "--name",
                        "--version",
                        "--port",
                        "--username",
                        "--password",
                        "--database",
                        "--data-dir",
                        "--config",
                    )
                ),
                "cli_help_mismatch",
            )
            require("[default: 18.1.0]" in help_text, "bundle_version")
        else:
            self.tools()
            require(
                self.control_state("restart-control") == self.manifest["system_identifier"],
                "restart_cluster_changed",
            )

    def tools(self):
        for name in PG_NAMES:
            path = INSTALL / "bin" / name
            fact = self.binary(path)
            require(fact["sha256"] == TOOL_HASHES[name], "raw_tool_hash:" + name)
            self.result["raw_tools"][name] = fact
            output = self.command([str(path), "--version"], name + "-version", raw=True)
            require(re.search(r"\b18\.1(?:\s|$)", output), "raw_tool_version:" + name)

    def start(self):
        self.stage = "start_and_sql"
        self.start_time = time.monotonic()
        self.phase_deadline = min(self.start_time + 60, self.whole_deadline - 25)
        if self.generation == 1:
            argv = [
                str(CLI),
                "start",
                "--name",
                "c2a-db",
                "--version",
                "18.1.0",
                "--port",
                "55432",
                "--username",
                "postgres",
                "--password",
                PASSWORD,
                "--database",
                "postgres",
                "--data-dir",
                str(DATA),
            ]
        else:
            argv = [str(INSTALL / "bin/postgres"), "-D", str(DATA), "-p", "55432"]
        for key, value in SETTINGS.items():
            argv.extend(["-c", key + "=" + value])
        path = self.log_directory / "startup.log"
        with path.open("xb") as output:
            self.logs[path] = 65536
            self.result["start_dispatches"] += 1
            child = subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                cwd=str(ROOT),
                env=ENV if self.generation == 1 else RAW_ENV,
                close_fds=True,
                start_new_session=True,
            )
            if self.generation == 1:
                self.cli = child
            else:
                self.raw_process = child
            identity = process_identity(child.pid)
            require(
                identity
                and identity["state"] != "Z"
                and identity["executable"] == argv[0]
                and identity["argv"] == argv
                and identity["pgid"] == identity["session"] == child.pid,
                "start_process_identity",
            )
            self.result["start_process_live"] = identity
            if self.generation == 1:
                self.cli_identity = identity
                self.result["cli_live"] = identity
                while child.poll() is None:
                    self.guard()
                    time.sleep(0.02)
                self.result["cli_exit_code"] = child.returncode
                require(child.returncode == 0, "pg0_start_failed")
                self.tools()
            else:
                self.postmaster = identity
        self.guard()

    def poll_sql(self, deadline):
        from psycopg2.extensions import POLL_OK, POLL_READ, POLL_WRITE

        while True:
            self.guard(deadline)
            state = self.connection.poll()
            if state == POLL_OK:
                return
            require(state in (POLL_READ, POLL_WRITE), "sql_poll_error")
            fd = self.connection.fileno()
            select.select(
                [fd] if state == POLL_READ else [],
                [fd] if state == POLL_WRITE else [],
                [],
                min(0.1, max(0, deadline - time.monotonic())),
            )

    def identify_postmaster(self):
        lines = read_bytes(DATA / "postmaster.pid").decode().splitlines()
        require(
            len(lines) >= 4 and lines[1] == str(DATA) and lines[3] == "55432", "pid_file_binding"
        )
        process = process_identity(int(lines[0]))
        require(
            process
            and process["state"] != "Z"
            and process["uid"] == 1000
            and process["executable"] == str(INSTALL / "bin/postgres")
            and process["ppid"] == os.getpid(),
            "postmaster_not_owned",
        )
        lineage = self.cli_identity if self.generation == 1 else self.postmaster
        require(
            lineage and process["start_ticks"] >= lineage["start_ticks"], "postmaster_start_lineage"
        )
        if self.generation == 2:
            require(
                self.raw_process and process["pid"] == self.raw_process.pid, "raw_handle_mismatch"
            )
        return process

    def connect(self):
        import psycopg2  # Fake values have been dropped before the only SQL-client import.

        require(psycopg2.__version__.split()[0] == "2.9.11", "sql_client_version_mismatch")
        self.result["sql_client_version"] = psycopg2.__version__
        self.result["connection_attempts"] = self.result.get("connection_attempts", 0) + 1
        deadline = min(self.phase_deadline, time.monotonic() + 3)
        self.operation_deadline = deadline
        try:
            self.connection = psycopg2.connect(
                host="127.0.0.1",
                port=55432,
                dbname="postgres",
                user="postgres",
                password=PASSWORD,
                connect_timeout=3,
                options="-c statement_timeout=2000",
                async_=True,
            )
            self.poll_sql(deadline)
        finally:
            self.operation_deadline = self.whole_deadline

    def query(self, sql, parameters=None):
        with self.connection.cursor() as cursor:
            cursor.execute(sql, parameters)
            self.poll_sql(self.phase_deadline)
            return cursor.fetchall() if cursor.description else []

    def observe_sql(self):
        # Raw foreground start has no pg0 readiness wait. Read only the fixed PID file;
        # make one SQL connection after PostgreSQL has declared the server ready.
        if self.generation == 2:
            while True:
                self.guard()
                require(self.raw_process.poll() is None, "raw_postgres_exited")
                try:
                    lines = read_bytes(DATA / "postmaster.pid").decode().splitlines()
                    if len(lines) >= 8 and lines[7].strip() == "ready":
                        break
                except FileNotFoundError:
                    pass  # No startup effect is retried; the original process is still starting.
                time.sleep(0.02)
        self.connect()
        row = self.query(SQL)[0]
        keys = (
            "version",
            "postmaster_start_time",
            "backend_pid",
            "data_directory",
            "fsync",
            "synchronous_commit",
            "full_page_writes",
            "port",
            "listen_addresses",
            "unix_socket_directories",
            "system_identifier",
        )
        self.result["sql"] = dict(zip(keys, row, strict=True))
        require(
            row[0].startswith("PostgreSQL 18.1 ")
            and row[3:10]
            == (str(DATA), "on", "on", "on", "55432", "127.0.0.1", str(ROOT / "socket")),
            "sql_settings_mismatch",
        )
        self.postmaster = self.identify_postmaster()
        backend = process_identity(row[2])
        require(
            backend
            and backend["ppid"] == self.postmaster["pid"]
            and backend["executable"] == self.postmaster["executable"],
            "sql_parent_link",
        )
        self.result["postmaster_live"] = self.postmaster
        self.result["backend_live"] = backend
        pg_processes = [
            item for item in self.processes() if item["executable"] == str(INSTALL / "bin/postgres")
        ]
        loggers = [item for item in pg_processes if any("logger" in arg for arg in item["argv"])]
        require(
            len(loggers) == 1 and loggers[0]["ppid"] == self.postmaster["pid"], "logger_identity"
        )
        self.logger = loggers[0]
        self.result["logger_live"] = self.logger
        self.result["database_processes"] = pg_processes
        if self.generation == 1:
            metadata = json.loads(read_bytes(INSTANCE))
            require(
                metadata["pid"] == self.postmaster["pid"]
                and metadata["data_dir"] == str(DATA)
                and metadata["installation_dir"] == str(INSTALL.parent)
                and metadata["version"] == "18.1.0"
                and metadata["port"] == 55432,
                "instance_binding",
            )
            self.result["instance"] = metadata
            self.query("BEGIN")
            self.query(
                "CREATE TABLE public.c2a_persistence "
                "(case_id uuid PRIMARY KEY, payload text NOT NULL)"
            )
            self.query(
                "INSERT INTO public.c2a_persistence (case_id, payload) VALUES (%s::uuid, %s)",
                (CASE, PAYLOAD),
            )
            self.query("COMMIT")
            self.result["seed_committed"] = True
            self.connection.close()
            self.connection = None
            self.connect()
        else:
            require(
                row[10] == self.manifest["system_identifier"]
                and row[1] != self.manifest["postmaster_start_time"],
                "restart_sql_identity",
            )
            self.result["seed_committed"] = False
        rows = self.query("SELECT case_id::text, payload FROM public.c2a_persistence")
        persistence = self.query(
            "SELECT relpersistence FROM pg_class WHERE oid = 'public.c2a_persistence'::regclass"
        )
        require(rows == [(CASE, PAYLOAD)] and persistence == [("p",)], "logged_row_mismatch")
        self.result["row"] = {
            **ROW,
            "count": len(rows),
            "relpersistence": persistence[0][0],
            "fresh_connection": self.generation == 1,
        }
        self.connection.close()
        self.connection = None
        if self.generation == 1:
            self.manifest = {
                "version": 1,
                "case_id": CASE,
                "first_startup_id": self.startup_id,
                "system_identifier": row[10],
                "data_directory": str(DATA),
                "row": ROW,
                "tool_hashes": TOOL_HASHES,
                "cli_sha256": CLI_SHA256,
                "wrapper_sha256": hashlib.sha256(
                    read_bytes(Path(__file__), 128 * 1024)
                ).hexdigest(),
                "postmaster_start_time": row[1],
                "postgres_version": "18.1",
            }
            atomic_json(MANIFEST, self.manifest, self.guard)
        else:
            require(
                self.manifest["wrapper_sha256"]
                == hashlib.sha256(read_bytes(Path(__file__), 128 * 1024)).hexdigest(),
                "wrapper_changed",
            )
        self.result["manifest"] = self.manifest
        self.result["sql_ready_elapsed_seconds"] = round(time.monotonic() - self.start_time, 3)
        self.result["status"] = "ready"
        self.ready = True
        atomic_json(CURRENT, self.result, self.guard)
        self.phase_deadline = self.whole_deadline - 25
        self.stage = "running"
        while self.stop_started is None:
            self.guard()
            current = process_identity(self.postmaster["pid"])
            require(
                current
                and current["state"] != "Z"
                and current["start_ticks"] == self.postmaster["start_ticks"],
                "unexpected_postmaster_exit",
            )
            time.sleep(0.05)

    def reap(self):
        # Never race Popen for a direct child's exit code. Only wait for children
        # actually adopted by this wrapper, excluding every known direct handle.
        direct = {p.pid for p in (self.cli, self.raw_process) if p is not None}
        adopted = [
            p for p in self.processes() if p["ppid"] == os.getpid() and p["pid"] not in direct
        ]
        for child in adopted:
            try:
                pid, status_code = os.waitpid(child["pid"], os.WNOHANG)
            except ChildProcessError:
                continue  # A process captured before adoption may already have been reaped by PG.
            if pid:
                require(len(self.result["reaped"]) < 64, "reap_count_bound")
                self.result["reaped"].append(
                    {
                        "pid": pid,
                        "start_ticks": child["start_ticks"],
                        "wait_status": status_code,
                        "exit_code": os.waitstatus_to_exitcode(status_code),
                    }
                )

    def control_state(self, label):
        output = self.command([str(INSTALL / "bin/pg_controldata"), str(DATA)], label, raw=True)
        fields = dict(line.split(":", 1) for line in output.splitlines() if ":" in line)
        require(
            fields.get("Database cluster state", "").strip() == "shut down", "cluster_not_shut_down"
        )
        identifier = fields.get("Database system identifier", "").strip()
        require(identifier.isdecimal(), "control_identifier_missing")
        return identifier

    def checked_stop(self):
        self.stopping = True
        self.stage = "checked_shutdown"
        if self.stop_started is None:
            self.stop_started = time.monotonic()
        # Reserve the final half second within the same 25-second bound for a small
        # failure/stop report. A timed-out scan must not consume its own evidence budget.
        self.phase_deadline = min(self.stop_started + 24.5, self.whole_deadline - 0.5)
        self.operation_deadline = self.whole_deadline
        if self.connection is not None:
            self.connection.close()
            self.connection = None
        if self.cli is None and self.raw_process is None:
            self.result["shutdown"] = {"state": "not_started", "container_cleanup_required": False}
            return
        if self.cli is not None and self.cli.poll() is None:
            current = process_identity(self.cli.pid)
            require(
                current
                and self.cli_identity
                and current["start_ticks"] == self.cli_identity["start_ticks"]
                and current["pgid"] == self.cli.pid,
                "cli_cleanup_identity_unknown",
            )
            os.killpg(self.cli.pid, signal.SIGTERM)
            self.result["initialization_interrupted"] = True
            self.cli.wait(timeout=max(0.01, min(1, self.phase_deadline - time.monotonic())))
        require(not self.stop_attempted, "stop_already_attempted")
        self.stop_attempted = True
        actual = self.identify_postmaster()
        if self.postmaster is not None:
            require(
                (actual["pid"], actual["start_ticks"])
                == (self.postmaster["pid"], self.postmaster["start_ticks"]),
                "postmaster_changed",
            )
        self.postmaster = actual
        for name in ("pg_ctl", "pg_controldata"):
            if name not in self.result["raw_tools"]:
                fact = self.binary(INSTALL / "bin" / name)
                require(fact["sha256"] == TOOL_HASHES[name], "cleanup_tool_hash")
                self.result["raw_tools"][name] = fact
        self.command(
            [str(INSTALL / "bin/pg_ctl"), "stop", "-D", str(DATA), "-m", "fast", "-w", "-t", "15"],
            "pg_ctl-stop",
            seconds=17,
            raw=True,
        )
        exit_deadline = min(time.monotonic() + 5, self.phase_deadline)
        while True:
            self.guard(exit_deadline)
            if self.raw_process is not None:
                code = self.raw_process.poll()
                if code is not None and "postmaster_direct_wait" not in self.result:
                    self.result["postmaster_direct_wait"] = {
                        "pid": self.raw_process.pid,
                        "exit_code": code,
                    }
            self.reap()
            remaining = self.processes()
            owned = [
                p
                for p in remaining
                if p["ppid"] == os.getpid()
                or p["executable"] in (str(CLI), str(INSTALL / "bin/postgres"))
            ]
            self.result["shutdown_processes"] = remaining
            if not owned and not (DATA / "postmaster.pid").exists():
                break
            time.sleep(0.02)
        postmaster_waits = self.result["reaped"] + (
            [self.result["postmaster_direct_wait"]]
            if "postmaster_direct_wait" in self.result
            else []
        )
        require(
            any(p["pid"] == actual["pid"] and p["exit_code"] == 0 for p in postmaster_waits),
            "postmaster_reap_not_clean",
        )
        require(all(p["exit_code"] == 0 for p in self.result["reaped"]), "adopted_exit_failure")
        if self.logger:
            require(process_identity(self.logger["pid"]) is None, "logger_remains")
        identifier = self.control_state("pg_controldata")
        require(
            "sql" not in self.result or identifier == self.result["sql"]["system_identifier"],
            "cluster_identifier_changed",
        )
        self.result["shutdown"] = {
            "state": "checked",
            "system_identifier": identifier,
            "elapsed_seconds": round(time.monotonic() - self.stop_started, 3),
            "postmaster_wait_kind": "adopted" if self.generation == 1 else "direct",
            "logger_gone": self.logger is not None,
            "owned_descendants_remaining": 0,
        }

    def scan_volume(self):
        before = time.monotonic()
        self.stage = "stopped_volume_scan"
        pending, regular, links = [ROOT], set(), []
        result = {"entries": 0, "bytes": 0, "link_bytes": 0, "hits": 0, "complete": False}
        self.result["volume_scan"] = result
        while pending:
            self.guard()
            with os.scandir(pending.pop()) as entries:
                for entry in entries:
                    self.guard()
                    info = entry.stat(follow_symlinks=False)
                    result["entries"] += 1
                    require(result["entries"] <= 4096, "scan_entry_bound")
                    path = Path(entry.path)
                    if stat.S_ISDIR(info.st_mode):
                        pending.append(path)
                    elif stat.S_ISREG(info.st_mode):
                        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
                        with os.fdopen(descriptor, "rb") as stream:
                            require(
                                os.fstat(stream.fileno()).st_size == info.st_size,
                                "scan_file_changed",
                            )
                            scanned = stream_hits(stream, self.guard)
                        require(scanned["bytes"] == info.st_size, "scan_size_changed")
                        result["bytes"] += scanned["bytes"]
                        result["hits"] += scanned["hits"]
                        regular.add(path)
                    elif stat.S_ISLNK(info.st_mode):
                        target = path.resolve(strict=True)
                        require(
                            path.is_relative_to(INSTALL)
                            and target.is_relative_to(INSTALL)
                            and stat.S_ISREG(target.lstat().st_mode),
                            "scan_link_target",
                        )
                        text = os.fsencode(os.readlink(path))
                        require(len(text) <= 4096, "scan_link_bound")
                        result["link_bytes"] += len(text)
                        result["hits"] += len(SENTINEL.findall(text))
                        links.append(target)
                    else:
                        raise Refusal("scan_special_file")
                    require(result["bytes"] + result["link_bytes"] <= 1024**3, "scan_storage_bound")
        require(all(target in regular for target in links), "link_target_not_scanned")
        require(result["hits"] == 0, "volume_sentinel_found")
        result.update(complete=True, elapsed_seconds=round(time.monotonic() - before, 3))

    def finish(self):
        # The same shutdown alarm remains active through logs, scan, fsync and publication.
        self.stage = "final_evidence"
        try:
            for path in ([self.log_directory / "startup.log"] if self.log_directory else []) + [
                ROOT / "log/postgresql.log"
            ]:
                self.guard()
                if self.seed_owned and path.exists():
                    raw = read_bytes(path, 65536)
                    self.result.setdefault("logs", []).append(
                        {
                            "path": str(path),
                            "bytes": len(raw),
                            "sha256": hashlib.sha256(raw).hexdigest(),
                            "output": raw.decode("utf-8", errors="replace"),
                        }
                    )
            if self.marker_published:
                atomic_json(
                    MARKER,
                    {"pid": os.getpid(), "startupId": self.startup_id, "state": "stopped"},
                    self.guard,
                )
            if self.result.get("shutdown", {}).get("state") == "checked":
                self.scan_volume()
        except Exception as error:
            self.fail(error)
        self.phase_deadline = min(self.stop_started + 25, self.whole_deadline)
        self.operation_deadline = self.whole_deadline
        self.result["elapsed_seconds"] = round(time.monotonic() - self.started, 3)
        self.result["shutdown_evidence_seconds"] = round(time.monotonic() - self.stop_started, 3)
        self.result["hashed_bytes"] = self.hashed_bytes
        self.result["status"] = "failed" if self.result["first_failure"] else "stopped"
        try:
            require(
                self.result.get("shutdown", {}).get("state") == "checked"
                or self.result["first_failure"],
                "missing_shutdown",
            )
            if CASE_ROOT.is_dir() and self.startup_id:
                atomic_json(LAST_STOP, self.result, self.guard)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        return 1 if self.result["first_failure"] else 0


def main():
    owner = DatabaseChild()
    signal.signal(signal.SIGTERM, owner.terminate)
    signal.signal(signal.SIGINT, owner.terminate)
    signal.signal(signal.SIGALRM, owner.alarm)
    signal.setitimer(signal.ITIMER_REAL, 0.1, 0.1)
    try:
        owner.prepare()
        owner.start()
        owner.observe_sql()
    except Exception as error:
        owner.fail(error)
    try:
        owner.checked_stop()
    except Exception as error:
        owner.result["shutdown"] = {
            "state": "failed_or_unknown",
            "failure": owner.fail(error),
            "container_cleanup_required": True,
        }
    return owner.finish()


if __name__ == "__main__":
    raise SystemExit(main())
