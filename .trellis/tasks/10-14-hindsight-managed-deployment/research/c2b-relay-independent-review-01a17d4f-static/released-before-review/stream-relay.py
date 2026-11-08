"""Fixed no-TTY stdio/loopback relay. Only the frozen diagnostic marker is accepted."""

import hashlib
import json
import os
from pathlib import Path
import selectors
import socket
import sys
import time

MARKER = "taki-c2b-relay:9a276b18-7fa2-4421-869c-88f0d89aec01"
LIMIT = 65536


def emit(event, **facts):
    print(json.dumps(dict(schema="c2b-stream-relay-v1", event=event, **facts), separators=(",", ":")),
          file=sys.stderr, flush=True)


def identity():
    fields = Path("/proc/self/stat").read_text().rsplit(")", 1)[1].split()
    return dict(pid=os.getpid(), startTicks=fields[19])


def main():
    if sys.argv != ["-c", MARKER]:
        raise ValueError("ARGV")
    begun = time.monotonic()
    received = {"stdin": 0, "target": 0}
    sent = {"stdout": 0, "target": 0}
    hashes = {name: hashlib.sha256() for name in received}
    chunks = {name: [] for name in received}
    pending_in = bytearray()
    pending_out = bytearray()
    input_eof = target_eof = write_closed = False
    with socket.create_connection(("127.0.0.1", 8000), timeout=3) as target:
        target.setblocking(False)
        os.set_blocking(0, False)
        os.set_blocking(1, False)
        emit("ready", identity=identity(), marker=MARKER, target=list(target.getpeername()))
        while not (input_eof and target_eof and not pending_in and not pending_out):
            remaining = begun + 15 - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("RELAY_DEADLINE")
            if input_eof and not pending_in and not write_closed:
                target.shutdown(socket.SHUT_WR)
                write_closed = True
                emit("stdin-eof", bytes=received["stdin"], sha256=hashes["stdin"].hexdigest())
            # One selector per state makes interest removal explicit; no writable-FD busy loop.
            with selectors.DefaultSelector() as selector:
                if not input_eof and len(pending_in) < 8192:
                    selector.register(0, selectors.EVENT_READ, "stdin")
                interests = (selectors.EVENT_READ if not target_eof and len(pending_out) < 8192 else 0)
                interests |= selectors.EVENT_WRITE if pending_in else 0
                if interests:
                    selector.register(target, interests, "target")
                if pending_out:
                    selector.register(1, selectors.EVENT_WRITE, "stdout")
                if not selector.get_map():
                    raise ValueError("UNSETTLED_RELAY")
                events = selector.select(remaining)
            for key, mask in events:
                try:
                    if key.data == "stdin":
                        chunk = os.read(0, 4096)
                        input_eof = not chunk
                        pending_in.extend(chunk)
                        received["stdin"] += len(chunk)
                        hashes["stdin"].update(chunk)
                        if chunk:
                            chunks["stdin"].append(len(chunk))
                    elif key.data == "stdout":
                        count = os.write(1, pending_out)
                        del pending_out[:count]
                        sent["stdout"] += count
                    else:
                        if mask & selectors.EVENT_READ:
                            chunk = target.recv(4096)
                            target_eof = not chunk
                            pending_out.extend(chunk)
                            received["target"] += len(chunk)
                            hashes["target"].update(chunk)
                            if chunk:
                                chunks["target"].append(len(chunk))
                        if mask & selectors.EVENT_WRITE and pending_in:
                            count = target.send(pending_in)
                            del pending_in[:count]
                            sent["target"] += count
                except BlockingIOError:
                    continue
                if max(received.values()) > LIMIT:
                    raise ValueError("DIRECTION_BOUND")
        emit("complete", identity=identity(), received=received, sent=sent, stdinEof=input_eof,
             targetEof=target_eof, targetHalfClosed=write_closed,
             readChunks=chunks, digests={name: value.hexdigest() for name, value in hashes.items()})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("failed", identity=identity(), error=type(error).__name__)
        raise SystemExit(2) from None
