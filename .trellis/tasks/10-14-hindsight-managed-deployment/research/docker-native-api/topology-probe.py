"""INPUT: fixed stdin packet in the pinned cached image on the owned masquerade-off bridge, UID/GID 1000.
OUTPUT: one readiness line, a fixed token for <=2 inbound connections, outbound TCP classes, one result.
POS: task-only C2b slice 1 topology probe; stdlib sockets only, no DNS, HTTP client or file writes.
"""

import errno
import json
import socket
import sys
import threading
import time

SCHEMA = "c2b-topology-probe-v1"
TOKEN = b"taki-c2b-topology-ok:cb3b3ca9-5a01-4bc4-a734-8b48d7868489\n"
LISTEN = ("0.0.0.0", 8000)
TARGETS = (("1.1.1.1", 443), ("8.8.8.8", 53))
ACCEPT_SECONDS = 20
CONNECT_SECONDS = 3
STARTED = time.monotonic()
outbound = []


def emit(value):
    sys.stdout.write(json.dumps(value, ensure_ascii=True, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def attempt(target):
    began = time.monotonic()
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.settimeout(CONNECT_SECONDS)
    try:
        probe.connect(target)
        state = "connected"
    except ConnectionRefusedError:
        state = "refused"
    except TimeoutError:
        state = "timeout"
    except OSError as error:
        state = "error:" + errno.errorcode.get(error.errno, "unknown")
    finally:
        probe.close()
    outbound.append(
        {
            "target": "%s:%d" % target,
            "result": state,
            "elapsed_seconds": round(time.monotonic() - began, 3),
        }
    )


def serve(listener):
    served = 0
    send_errors = 0
    deadline = STARTED + ACCEPT_SECONDS
    while served + send_errors < 2:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        listener.settimeout(remaining)
        try:
            connection, _ = listener.accept()
        except TimeoutError:
            break
        with connection:
            connection.settimeout(2)
            try:
                connection.sendall(TOKEN)
                served += 1
            except OSError:
                send_errors += 1
    return served, send_errors


def main():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(LISTEN)
    listener.listen(2)
    emit({"schema": SCHEMA, "event": "ready", "listen": "%s:%d" % LISTEN})
    worker = threading.Thread(target=lambda: [attempt(t) for t in TARGETS], daemon=True)
    worker.start()
    with listener:
        served, send_errors = serve(listener)
    worker.join(len(TARGETS) * CONNECT_SECONDS + 1)
    return {"token_connections": served, "token_send_errors": send_errors, "outbound": list(outbound)}


if __name__ == "__main__":
    try:
        facts, code = main(), 0
    except Exception as error:
        facts, code = {"error": type(error).__name__}, 2
    emit(
        {
            "schema": SCHEMA,
            "event": "result",
            **facts,
            "elapsed_seconds": round(time.monotonic() - STARTED, 3),
        }
    )
    raise SystemExit(code)
