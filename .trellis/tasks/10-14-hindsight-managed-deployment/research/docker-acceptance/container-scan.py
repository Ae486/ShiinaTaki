"""Read only this fixture's data directory and safe process/socket evidence.

Sentinels are matched by format, never supplied as arguments or printed. This
bounded scan intentionally excludes image layers, the whole rootfs and environ.
"""

import json
import os
import re
import stat
from pathlib import Path

pattern = re.compile(rb"C2A_FAKE_[0-9a-f]{64}")
root = Path("/home/hindsight/.pg0")
marker_path = root / "c2a-child.json"
if not stat.S_ISREG(marker_path.lstat().st_mode):
    raise SystemExit(2)
with marker_path.open("rb") as stream:
    marker_bytes = stream.read(1025)
if len(marker_bytes) > 1024:
    raise SystemExit(2)
marker = json.loads(marker_bytes)
if set(marker) != {"pid", "startupId", "state"} or type(marker["pid"]) is not int or marker["pid"] <= 0:
    raise SystemExit(2)
os.kill(marker["pid"], 0)
files = byte_count = hits = 0
pending = [root]
while pending:
    path = pending.pop()
    metadata = path.lstat()
    if stat.S_ISDIR(metadata.st_mode):
        pending.extend(path.iterdir())
        if len(pending) > 1024:
            raise SystemExit(2)
        continue
    if not stat.S_ISREG(metadata.st_mode):
        raise SystemExit(2)
    files += 1
    byte_count += metadata.st_size
    if files > 1024 or byte_count > 64 * 1024 * 1024:
        raise SystemExit(2)
    hits += len(pattern.findall(path.read_bytes()))

argv_hits = 0
for pid in (1, marker["pid"]):
    with Path(f"/proc/{pid}/cmdline").open("rb") as stream:
        argv = stream.read(32769)
    if len(argv) > 32768:
        raise SystemExit(2)
    argv_hits += len(pattern.findall(argv))

sockets = {}
for name in ("control.sock", "bootstrap.sock"):
    metadata = (Path("/run/taki-hindsight") / name).lstat()
    sockets[name] = {"uid": metadata.st_uid, "gid": metadata.st_gid,
                     "mode": stat.S_IMODE(metadata.st_mode), "socket": stat.S_ISSOCK(metadata.st_mode)}
safe_marker = {"pid": marker["pid"], "startupId": marker["startupId"], "state": marker["state"]}
if pattern.search(json.dumps(safe_marker).encode()):
    raise SystemExit(2)
print(json.dumps({"marker": safe_marker, "childAlive": True, "files": files,
                  "bytes": byte_count, "hits": hits, "argvHits": argv_hits, "sockets": sockets}))
raise SystemExit(0 if hits == argv_hits == 0 else 1)
