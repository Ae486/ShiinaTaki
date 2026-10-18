"""Fixed read-only report/process snapshot for the admitted database fixture.

No SQL, environment reads, command selector, recursive data scan or write path.
The exact UTF-8 first stop report is returned so Root can freeze its original bytes.
"""

import hashlib
import json
import os
import re
import signal
import stat
import sys
import sysconfig
import uuid
from pathlib import Path

CASE = "b5c5fb7f-cd8a-402a-bd11-92839d191e98"
ROOT = Path("/home/hindsight/.pg0")
DATABASE = ROOT / "c2a-db"
RUNTIME = Path("/run/taki-hindsight")
SENTINEL = re.compile(rb"C2A_FAKE_[0-9a-f]{64}")


def require(value):
    if not value:
        raise ValueError("fixed_probe_contract")


def read_bytes(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode))
        data = stream.read(limit + 1)
    require(len(data) <= limit and not SENTINEL.search(data))
    return data


def optional(path, limit=128 * 1024):
    try:
        return read_bytes(path, limit)
    except FileNotFoundError:
        return None


def processes():
    entries = [entry for entry in Path("/proc").iterdir() if entry.name.isdecimal()]
    require(len(entries) <= 64)
    facts, wrappers, postgres = [], [], []
    expected = [
        sys.executable,
        "-I",
        "-B",
        str(Path(sysconfig.get_path("purelib")) / "managed_bootstrap/fake_child.py"),
    ]
    for entry in entries:
        try:
            argv = read_bytes(entry / "cmdline", 32768).decode().rstrip("\0").split("\0")
            fields = read_bytes(entry / "stat", 8192).decode().rsplit(")", 1)[1].split()
            executable = None if fields[0] == "Z" else os.readlink(entry / "exe")
            fact = {
                "pid": int(entry.name),
                "ppid": int(fields[1]),
                "pgid": int(fields[2]),
                "session": int(fields[3]),
                "start_ticks": int(fields[19]),
                "state": fields[0],
                "executable": executable,
                "argv": argv,
            }
            facts.append(fact)
            if argv == expected:
                wrappers.append(fact)
            if executable == str(ROOT / ".pg0/installation/18.1.0/bin/postgres"):
                postgres.append(fact)
        except (FileNotFoundError, ProcessLookupError):
            continue  # Short-lived control processes can exit between fixed proc reads.
    return {"all": facts, "wrappers": wrappers, "postgres": postgres, "argv_hits": 0}


def runtime():
    info = RUNTIME.lstat()
    require(
        stat.S_ISDIR(info.st_mode)
        and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (1000, 1000, 0o700)
    )
    lines = read_bytes(Path("/proc/self/mountinfo"), 65536).decode().splitlines()
    matches = [line.split() for line in lines if line.split()[4] == str(RUNTIME)]
    require(len(matches) == 1 and matches[0][matches[0].index("-") + 1] == "tmpfs")
    sockets = {}
    for name in ("control.sock", "bootstrap.sock"):
        info = (RUNTIME / name).lstat()
        require(
            stat.S_ISSOCK(info.st_mode)
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (1000, 1000, 0o600)
        )
        sockets[name] = {"uid": info.st_uid, "gid": info.st_gid, "mode": stat.S_IMODE(info.st_mode)}
    return {"tmpfs": True, "sockets": sockets}


def timeout(_number, _frame):
    raise ValueError("probe_deadline")


def main():
    require(sys.platform == "linux" and len(sys.argv) == 1 and os.geteuid() == 1000)
    signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, 5)
    marker_raw = optional(ROOT / "c2a-child.json", 1024)
    marker = json.loads(marker_raw) if marker_raw else None
    if marker:
        require(
            set(marker) == {"pid", "startupId", "state"}
            and type(marker["pid"]) is int
            and marker["pid"] > 0
            and marker["state"] in ("running", "stopped")
            and str(uuid.UUID(marker["startupId"])) == marker["startupId"]
        )
    current_raw = optional(DATABASE / "current.json")
    current = json.loads(current_raw) if current_raw else None
    if current:
        require(current["case_id"] == CASE)
        # The final stop contains the full generation record. Live polling needs only these facts,
        # leaving enough output budget to carry the original first-stop bytes once after restart.
        current = {
            key: current[key]
            for key in (
                "version",
                "case_id",
                "startup_id",
                "status",
                "generation",
                "first_failure",
                "sql",
                "row",
                "manifest",
                "wrapper_live",
                "postmaster_live",
                "logger_live",
                "start_dispatches",
                "seed_committed",
                "sql_ready_elapsed_seconds",
                "connection_attempts",
            )
        }
    stop = optional(DATABASE / "last-stop.json")
    manifest = optional(DATABASE / "manifest.json", 16384)
    result = {
        "version": 1,
        "case_id": CASE,
        "runtime": runtime(),
        "processes": processes(),
        "marker": marker,
        "current": current,
        "manifest": json.loads(manifest) if manifest else None,
        "data_exists": (DATABASE / "data").exists(),
        "intent_exists": (DATABASE / "init-intent.json").exists(),
        "last_stop_raw": stop.decode("utf-8") if stop else None,
        "last_stop_sha256": hashlib.sha256(stop).hexdigest() if stop else None,
    }
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode() + b"\n"
    require(len(encoded) <= 128 * 1024 and not SENTINEL.search(encoded))
    sys.stdout.buffer.write(encoded)
    signal.setitimer(signal.ITIMER_REAL, 0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit(2) from None
