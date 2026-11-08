"""One read-only same-container observation; never signal, reap, repair, or adopt a process."""

import hashlib
import json
import os
from pathlib import Path
import select
import sys
import time

MARKER = b"taki-c2b-relay:9a276b18-7fa2-4421-869c-88f0d89aec01"


def identity(pid):
    try:
        fields = Path("/proc/%d/stat" % pid).read_text().rsplit(")", 1)[1].split()
        return dict(pid=pid, startTicks=fields[19], state=fields[0])
    except FileNotFoundError:
        return None


def scan(expected):
    matches = []
    paths = [path for path in Path("/proc").iterdir() if path.name.isdigit()]
    if len(paths) > 32:
        raise ValueError("PROCESS_BOUND")
    for path in paths:
        pid = int(path.name)
        if pid == os.getpid():
            continue
        try:
            with open(path / "cmdline", "rb") as stream:
                raw = stream.read(32769)
        except FileNotFoundError:
            continue
        if len(raw) > 32768:
            raise ValueError("ARGV_BOUND")
        argv = raw.rstrip(b"\0").split(b"\0")
        found = identity(pid)
        if argv[-1:] == [MARKER]:
            matches.append(dict(identity=found, argvSha256=hashlib.sha256(raw).hexdigest()))
    original = [dict(expected=item, current=identity(item["pid"])) for item in expected]
    absent = all(item["current"] is None or item["current"]["startTicks"] != item["expected"]["startTicks"]
                 for item in original)
    return dict(original=original, markerMatches=matches, absent=absent and not matches,
                observedProcessCount=len(paths), excludedObserverPid=os.getpid())


def main():
    raw = sys.stdin.buffer.read(2049)
    if len(raw) > 2048:
        raise ValueError("INPUT_BOUND")
    request = json.loads(raw)
    if set(request) != {"server", "relays"} or len(request["relays"]) != 2:
        raise ValueError("INPUT_SHAPE")
    for item in [request["server"], *request["relays"]]:
        if set(item) != {"pid", "startTicks"} or type(item["pid"]) is not int or not 0 < item["pid"] < 4194305:
            raise ValueError("IDENTITY")
        if type(item["startTicks"]) is not str or not item["startTicks"].isdigit():
            raise ValueError("START_IDENTITY")
    server = identity(request["server"]["pid"])
    if server is None or server["startTicks"] != request["server"]["startTicks"] or server["state"] == "Z":
        raise ValueError("ORIGINAL_SERVER_LOST")
    before = scan(request["relays"])
    handles = []
    poller = select.poll()
    try:
        for item in before["original"]:
            current = item["current"]
            if current is None or current["startTicks"] != item["expected"]["startTicks"]:
                continue
            try:
                fd = os.pidfd_open(current["pid"])
            except ProcessLookupError:
                continue
            handles.append(fd)
            poller.register(fd, select.POLLIN)
        deadline = time.monotonic() + 4
        pending = set(handles)
        while pending and time.monotonic() < deadline:
            for fd, _ in poller.poll(max(1, int((deadline - time.monotonic()) * 1000))):
                poller.unregister(fd)
                pending.discard(fd)
        after = scan(request["relays"])
    finally:
        for fd in handles:
            os.close(fd)
    server_after = identity(request["server"]["pid"])
    print(json.dumps(dict(schema="c2b-relay-reaping-v1", event="collected", before=before, after=after,
                          originalServer=server, serverAfter=server_after,
                          originalServerUnchanged=(server_after is not None and server_after["pid"] == server["pid"]
                                                   and server_after["startTicks"] == server["startTicks"]
                                                   and server_after["state"] != "Z"), deploymentReady=False),
                     separators=(",", ":")), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps(dict(schema="c2b-relay-reaping-v1", event="failed", error=type(error).__name__)), flush=True)
        raise SystemExit(2) from None
