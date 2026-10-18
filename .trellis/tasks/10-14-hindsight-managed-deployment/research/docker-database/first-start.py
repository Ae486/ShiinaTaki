"""One owned offline pg0 first start; stdin payload for the fixed image's PID 1.

This task fixture owns no Docker API. Root creates and removes its fresh volume
and container. A failed experiment remains failed even after successful cleanup.
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
from pathlib import Path

ROOT = Path("/home/hindsight/.pg0")
DATA = ROOT / "c2a-first/data"
INSTALL = ROOT / ".pg0/installation/18.1.0"
INSTANCE = ROOT / ".pg0/instances/c2a-offline/instance.json"
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
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "file_output_bound:" + str(path))
    return data


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


class FirstStart:
    def __init__(self):
        self.started = time.monotonic()
        self.whole_deadline = self.started + 180
        self.phase_deadline = self.whole_deadline
        self.operation_deadline = self.whole_deadline
        self.stage = "preflight"
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
            "scope": "offline-first-start-prerequisite",
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
        failure = {"stage": self.stage, "type": type(error).__name__, "detail": str(error)[:512]}
        if self.result["first_failure"] is None:
            self.result["first_failure"] = failure
        return failure

    def alarm(self, _number, _frame):
        if time.monotonic() >= min(
            self.whole_deadline, self.phase_deadline, self.operation_deadline
        ):
            raise Refusal("shared_deadline:" + self.stage)

    def terminate(self, number, _frame):
        if len(self.result["signals"]) < 8:
            self.result["signals"].append(number)
        self.fail(Refusal("termination_signal:" + str(number)))
        if not self.stopping:
            raise Refusal("termination_signal:" + str(number))

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
        path = ROOT / "tmp" / (label + ".log")
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
        os.environ.clear()
        os.environ.update(ENV)
        require(sys.platform == "linux" and os.getpid() == 1, "linux_pid1_required")
        require(os.geteuid() == os.getegid() == 1000, "uid_gid_required")
        require(sys.executable == "/app/api/.venv/bin/python", "fixed_python_required")
        info = ROOT.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 1000, "seed_identity")
        require(ROOT.resolve() == ROOT and os.access(ROOT, os.W_OK | os.X_OK), "seed_access")
        with os.scandir(ROOT) as entries:
            require(next(entries, None) is None, "seed_not_empty")
        self.seed_owned = True
        self.result["seed"] = {
            "path": str(ROOT),
            "uid": info.st_uid,
            "gid": info.st_gid,
            "empty": True,
            "mode": oct(stat.S_IMODE(info.st_mode)),
        }
        for name in ("tmp", "socket", "log"):
            (ROOT / name).mkdir(mode=0o700)
        self.result["cli_binary"] = self.binary(CLI)
        require(self.result["cli_binary"]["sha256"] == CLI_SHA256, "cli_hash_mismatch")
        version = self.command([str(CLI), "--version"], "cli-version")
        require(version.strip() == "pg0 0.15.0", "cli_version_mismatch")
        help_text = self.command([str(CLI), "start", "--help"], "cli-help")
        for flag in (
            "--name",
            "--version",
            "--port",
            "--username",
            "--password",
            "--database",
            "--data-dir",
            "--config",
        ):
            require(flag in help_text, "cli_help_missing:" + flag)
        version_help = help_text.split("--version", 1)[1].split("--data-dir", 1)[0]
        require("[default: 18.1.0]" in version_help, "bundle_version")
        self.result["baseline_processes"] = [
            {
                key: item[key]
                for key in ("pid", "ppid", "pgid", "session", "state", "start_ticks", "executable")
            }
            for item in self.processes()
        ]
        require(all(p["pid"] == 1 for p in self.result["baseline_processes"]), "nonempty_namespace")

    def start(self):
        self.stage = "start_and_sql"
        self.start_time = time.monotonic()
        self.phase_deadline = min(self.start_time + 60, self.whole_deadline)
        argv = [
            str(CLI),
            "start",
            "--name",
            "c2a-offline",
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
        for key, value in SETTINGS.items():
            argv.extend(["-c", key + "=" + value])
        path = ROOT / "startup.log"
        with path.open("xb") as output:
            self.logs[path] = 65536
            self.result["start_dispatches"] += 1
            self.cli = subprocess.Popen(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=output,
                stderr=subprocess.STDOUT,
                cwd=str(ROOT),
                env=ENV,
                close_fds=True,
                start_new_session=True,
            )
            self.cli_identity = process_identity(self.cli.pid)
            self.result["cli_live"] = self.cli_identity
            require(self.cli_identity and self.cli_identity["state"] != "Z", "cli_live_identity")
            require(
                self.cli_identity["executable"] == str(CLI)
                and self.cli_identity["argv"] == argv
                and self.cli_identity["pgid"] == self.cli_identity["session"] == self.cli.pid,
                "cli_identity_mismatch",
            )
            while self.cli.poll() is None:
                self.guard()
                time.sleep(0.02)
        self.result["cli_exit_code"] = self.cli.returncode
        require(self.cli.returncode == 0, "pg0_start_failed")
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
            and process["executable"] == str(INSTALL / "bin/postgres"),
            "postmaster_identity",
        )
        require(
            self.cli_identity and process["start_ticks"] >= self.cli_identity["start_ticks"],
            "postmaster_start_lineage",
        )
        return process

    def observe_sql(self):
        import psycopg2  # First third-party import; the environment has already been cleared.

        self.guard()
        self.result["sql_client_version"] = psycopg2.__version__
        require(psycopg2.__version__.split()[0] == "2.9.11", "sql_client_version_mismatch")
        self.result["connection_attempts"] = 1
        connect_deadline = min(self.phase_deadline, time.monotonic() + 3)
        self.operation_deadline = connect_deadline
        try:
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
                self.poll_sql(connect_deadline)
            finally:
                self.operation_deadline = self.whole_deadline
            with self.connection.cursor() as cursor:
                cursor.execute(SQL)
                self.poll_sql(self.phase_deadline)
                row = cursor.fetchone()
                require(row is not None, "missing_sql_row")
                self.guard()
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
                self.result["sql_ready_elapsed_seconds"] = round(
                    time.monotonic() - self.start_time, 3
                )
                require(row[0].startswith("PostgreSQL 18.1 "), "sql_server_version_mismatch")
                require(
                    row[3:10]
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
                require(self.postmaster["ppid"] == 1, "postmaster_not_adopted_by_pid1")
                self.result["postmaster_live"] = self.postmaster
                self.result["backend_live"] = backend
                metadata = json.loads(read_bytes(INSTANCE))
                self.result["instance"] = metadata
                require(
                    metadata["pid"] == self.postmaster["pid"]
                    and metadata["data_dir"] == str(DATA)
                    and metadata["installation_dir"] == str(INSTALL.parent)
                    and metadata["version"] == "18.1.0"
                    and metadata["port"] == 55432,
                    "instance_binding",
                )
        finally:
            if self.connection is not None:
                self.connection.close()
                self.connection = None
        self.phase_deadline = self.whole_deadline
        self.stage = "raw_tool_evidence"
        for name in PG_NAMES:
            path = INSTALL / "bin" / name
            self.result["raw_tools"][name] = self.binary(path)
            output = self.command([str(path), "--version"], name + "-version", raw=True)
            require(re.search(r"\b18\.1(?:\s|$)", output), "raw_tool_version:" + name)

    def reap(self):
        # Popen must reap its own CLI/utilities first, or their return codes are lost.
        while True:
            try:
                pid, status_code = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if pid == 0:
                return
            require(len(self.result["reaped"]) < 64, "reap_count_bound")
            self.result["reaped"].append(
                {
                    "pid": pid,
                    "wait_status": status_code,
                    "exit_code": os.waitstatus_to_exitcode(status_code),
                }
            )

    def checked_stop(self):
        self.stopping = True
        self.stage = "checked_shutdown"
        before = time.monotonic()
        self.phase_deadline = min(before + 25, self.whole_deadline)
        if self.connection is not None:
            self.connection.close()
            self.connection = None
        if self.cli is None:
            self.result["shutdown"] = {
                "state": "no_cli_child_handle",
                "container_cleanup_required": self.result["start_dispatches"] > 0,
            }
            return
        if self.cli.poll() is None:
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
                self.result["raw_tools"][name] = self.binary(INSTALL / "bin" / name)
        self.command(
            [str(INSTALL / "bin/pg_ctl"), "stop", "-D", str(DATA), "-m", "fast", "-w", "-t", "15"],
            "pg_ctl-stop",
            seconds=17,
            raw=True,
        )
        exit_deadline = min(time.monotonic() + 5, self.phase_deadline)
        while True:
            self.guard(exit_deadline)
            self.reap()
            live = process_identity(actual["pid"])
            require(
                live is None or live["start_ticks"] == actual["start_ticks"],
                "postmaster_pid_reused",
            )
            remaining = self.processes()
            self.result["shutdown_processes"] = [
                {
                    key: item[key]
                    for key in (
                        "pid",
                        "ppid",
                        "pgid",
                        "session",
                        "state",
                        "start_ticks",
                        "executable",
                    )
                }
                for item in remaining
            ]
            if (
                live is None
                and not (DATA / "postmaster.pid").exists()
                and all(p["pid"] == 1 for p in remaining)
            ):
                break
            time.sleep(0.02)
        require(
            any(
                item["pid"] == actual["pid"] and item["exit_code"] == 0
                for item in self.result["reaped"]
            ),
            "postmaster_reap_not_clean",
        )
        control = self.command(
            [str(INSTALL / "bin/pg_controldata"), str(DATA)], "pg_controldata", raw=True
        )
        fields = dict(line.split(":", 1) for line in control.splitlines() if ":" in line)
        require(
            fields.get("Database cluster state", "").strip() == "shut down", "cluster_not_shut_down"
        )
        identifier = fields.get("Database system identifier", "").strip()
        require(identifier.isdecimal(), "control_identifier_missing")
        if "sql" in self.result:
            require(
                identifier == self.result["sql"]["system_identifier"], "cluster_identifier_changed"
            )
        self.reap()
        remaining = self.processes()
        require(all(item["pid"] == 1 for item in remaining), "remaining_descendants")
        self.guard()
        self.result["shutdown"] = {
            "state": "checked",
            "system_identifier": identifier,
            "remaining_pids": [item["pid"] for item in remaining],
            "elapsed_seconds": round(time.monotonic() - before, 3),
        }

    def finish(self):
        self.stage = "final_evidence"
        self.phase_deadline = self.whole_deadline
        try:
            for path, limit in (
                (ROOT / "startup.log", 65536),
                (ROOT / "log/postgresql.log", 65536),
            ):
                self.guard()
                if self.seed_owned and path.exists():
                    with path.open("rb") as stream:
                        raw = stream.read(limit + 1)
                    truncated = len(raw) > limit
                    captured = raw[:limit]
                    self.result.setdefault("logs", []).append(
                        {
                            "path": str(path),
                            "bytes": path.stat().st_size,
                            "captured_bytes": len(captured),
                            "truncated": truncated,
                            "captured_sha256": hashlib.sha256(captured).hexdigest(),
                            "output": captured.decode("utf-8", errors="replace"),
                        }
                    )
                    if truncated:
                        self.fail(Refusal("final_log_bound:" + path.name))
        except Exception as error:
            self.fail(error)
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        self.result["elapsed_seconds"] = round(time.monotonic() - self.started, 3)
        self.result["hashed_bytes"] = self.hashed_bytes
        self.result["status"] = "failed" if self.result["first_failure"] else "prerequisite_pass"
        encoded = json.dumps(self.result, ensure_ascii=True, separators=(",", ":")).encode()
        if len(encoded) + 1 > 128 * 1024:
            self.fail(Refusal("final_json_bound"))
            self.result["status"] = "failed"
            for item in self.result.get("logs", []) + self.result["commands"]:
                item.pop("output", None)
            self.result["log_output_omitted"] = True
            encoded = json.dumps(self.result, ensure_ascii=True, separators=(",", ":")).encode()
        require(len(encoded) + 1 <= 128 * 1024, "minimal_json_bound")
        sys.stdout.buffer.write(encoded + b"\n")
        return 1 if self.result["first_failure"] else 0


def main():
    owner = FirstStart()
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
