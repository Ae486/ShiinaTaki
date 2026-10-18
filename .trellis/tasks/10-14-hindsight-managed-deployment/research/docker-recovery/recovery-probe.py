"""Fixed, bounded marker/process reads for the isolated C2a recovery fixture.

Only the seed step creates two non-secret files. This never inspects process
environments or reads/writes a credential, grant, registry, or database.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
import sysconfig
import uuid
from pathlib import Path

DATA = Path("/home/hindsight/.pg0")
RUNTIME = Path("/run/taki-hindsight")
VOLUME_MARKER = DATA / "c2a-recovery-volume.json"
TMPFS_MARKER = RUNTIME / "c2a-recovery-tmpfs.json"
SENTINEL = re.compile(rb"C2A_FAKE_[0-9a-f]{64}")


def read_bytes(path: Path, limit: int) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("regular file required")
        value = stream.read(limit + 1)
    if len(value) > limit or SENTINEL.search(value):
        raise ValueError("bounded non-secret file required")
    return value


def marker_digest(path: Path) -> str | None:
    try:
        return hashlib.sha256(read_bytes(path, 1024)).hexdigest()
    except FileNotFoundError:
        return None


def seed_markers() -> None:
    value = json.dumps({"version": 1, "nonce": str(uuid.uuid4())}).encode("utf-8")
    for path in (VOLUME_MARKER, TMPFS_MARKER):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())


def child_marker() -> dict[str, object]:
    value = json.loads(read_bytes(DATA / "c2a-child.json", 1024))
    if (
        not isinstance(value, dict)
        or set(value) != {"pid", "startupId", "state"}
        or type(value["pid"]) is not int
        or value["pid"] <= 0
        or value["state"] not in ("running", "stopped")
        or str(uuid.UUID(value["startupId"])) != value["startupId"]
    ):
        raise ValueError("invalid child marker")
    return value


def fake_children() -> list[dict[str, object]]:
    expected = [
        os.fsencode(sys.executable),
        b"-I",
        b"-B",
        os.fsencode(Path(sysconfig.get_path("purelib")) / "managed_bootstrap" / "fake_child.py"),
    ]
    entries = [entry for entry in Path("/proc").iterdir() if entry.name.isdecimal()]
    if len(entries) > 128:
        raise ValueError("process read limit")
    result = []
    for entry in entries:
        try:
            argv = read_bytes(entry / "cmdline", 32768).rstrip(b"\0").split(b"\0")
            if argv != expected:
                continue
            fields = read_bytes(entry / "stat", 4096).rsplit(b")", 1)[1].split()
            if len(fields) < 20 or not fields[19].isdigit() or int(fields[19]) <= 0:
                raise ValueError("process start identity unavailable")
            result.append({"pid": int(entry.name), "startTicks": fields[19].decode("ascii")})
        except (FileNotFoundError, ProcessLookupError):
            # A short-lived control/probe process may exit between these reads.
            continue
    return result


def runtime_facts() -> dict[str, object]:
    metadata = RUNTIME.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or (metadata.st_uid, metadata.st_gid, stat.S_IMODE(metadata.st_mode)) != (
        1000,
        1000,
        0o700,
    ):
        raise ValueError("unexpected runtime directory")
    mounts = read_bytes(Path("/proc/self/mountinfo"), 65536).decode("utf-8").splitlines()
    matches = [line.split() for line in mounts if line.split()[4] == str(RUNTIME)]
    if len(matches) != 1 or matches[0][matches[0].index("-") + 1] != "tmpfs":
        raise ValueError("runtime is not the expected tmpfs")
    sockets = {}
    for name in ("control.sock", "bootstrap.sock"):
        socket = (RUNTIME / name).lstat()
        if not stat.S_ISSOCK(socket.st_mode) or (socket.st_uid, socket.st_gid, stat.S_IMODE(socket.st_mode)) != (
            1000,
            1000,
            0o600,
        ):
            raise ValueError("unexpected socket")
        sockets[name] = {"uid": socket.st_uid, "gid": socket.st_gid, "mode": stat.S_IMODE(socket.st_mode)}
    return {"tmpfs": True, "sockets": sockets}


def main() -> int:
    if sys.platform != "linux" or len(sys.argv) != 2 or sys.argv[1] not in ("read", "seed"):
        return 2
    runtime = runtime_facts()
    if sys.argv[1] == "seed":
        seed_markers()
    result = {
        "version": 1,
        "runtime": runtime,
        "volumeMarkerSha256": marker_digest(VOLUME_MARKER),
        "tmpfsMarkerSha256": marker_digest(TMPFS_MARKER),
        "childMarker": child_marker(),
        "children": fake_children(),
    }
    encoded = json.dumps(result).encode("utf-8")
    if len(encoded) > 16384 or SENTINEL.search(encoded):
        return 2
    sys.stdout.buffer.write(encoded + b"\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit(2) from None
