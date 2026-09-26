"""Launch the patched native Hindsight API for the isolated smoke with a loopback-only egress guard.

INPUT:  env TAKI_SMOKE_ALLOWED_PORTS (comma list), TAKI_SMOKE_EGRESS_LOG (JSONL path), TAKI_SMOKE_NATIVE_PORT,
        TAKI_SMOKE_STOP_FILE, TAKI_SMOKE_PARENT_PID and the ordinary HINDSIGHT_API_* settings supplied by the harness
OUTPUT: the unmodified native entry point (hindsight_api.main) listening on 127.0.0.1; every refused outbound attempt is
        appended to the egress log and raised; the stop file appearing (or the harness process exiting) raises SIGINT
        in-process for uvicorn's graceful shutdown
POS:    09-25-hindsight-native-smoke harness only; never imported by product code. winloop is withheld so every asyncio
        connection passes through the patchable BaseEventLoop.create_connection (libuv connects bypass audit hooks).
"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import socket
import sys
import threading
import time
import traceback
from functools import wraps
from typing import Any

LOOPBACK = {"127.0.0.1", "localhost", "::1"}
ALLOWED_PORTS = {int(port) for port in os.environ["TAKI_SMOKE_ALLOWED_PORTS"].split(",")}
EGRESS_LOG = os.environ["TAKI_SMOKE_EGRESS_LOG"]
_internal = threading.local()


def _refuse(event: str, host: Any, port: Any) -> None:
    # The caller's frames identify which library attempted egress (paths and function names only, never payloads).
    frames = [f"{frame.filename}:{frame.lineno}:{frame.name}" for frame in traceback.extract_stack()[-40:-2]]
    with open(EGRESS_LOG, "a", encoding="utf-8") as out:
        out.write(json.dumps({"at": time.time(), "event": event, "host": str(host), "port": str(port), "stack": frames}) + "\n")
    raise RuntimeError("TAKI_SMOKE_EGRESS_REFUSED")


def _normalize(host: Any, port: Any) -> tuple[Any, int | None]:
    host = host.decode("ascii", "replace") if isinstance(host, bytes) else host
    try:
        return host, int(port) if port is not None else None
    except (TypeError, ValueError):
        return host, None


def _check_connect(event: str, host: Any, port: Any) -> None:
    host, number = _normalize(host, port)
    if host not in LOOPBACK or number not in ALLOWED_PORTS:
        _refuse(event, host, port)


def _audit(event: str, arguments: tuple[Any, ...]) -> None:
    if getattr(_internal, "socketpair", False):
        return
    if event == "socket.getaddrinfo":
        # Name resolution of loopback literals (uvicorn bind, asyncpg) is local; any other name is egress.
        host, _ = _normalize(arguments[0], arguments[1])
        if host not in LOOPBACK and host is not None:
            _refuse(event, arguments[0], arguments[1])
    elif event == "socket.connect":
        address = arguments[1]
        if isinstance(address, tuple) and len(address) >= 2:
            _check_connect(event, address[0], address[1])
        else:
            _refuse(event, address, None)


def install_guard() -> None:
    original_pair = socket.socketpair
    original_connection = asyncio.BaseEventLoop.create_connection

    @wraps(original_pair)
    def pair(*args: Any, **kwargs: Any) -> Any:
        # Windows asyncio builds its self-pipe from a private loopback socketpair; that is not egress.
        _internal.socketpair = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            _internal.socketpair = False

    @wraps(original_connection)
    async def connect(self: Any, factory: Any, host: Any = None, port: Any = None, **kwargs: Any) -> Any:
        if kwargs.get("sock") is not None:
            peer = kwargs["sock"].getpeername()
            _check_connect("create_connection", peer[0], peer[1])
        else:
            _check_connect("create_connection", host, port)
        return await original_connection(self, factory, host, port, **kwargs)

    setattr(socket, "socketpair", pair)
    setattr(asyncio.BaseEventLoop, "create_connection", connect)
    sys.addaudithook(_audit)


def _alive(pid: int) -> bool:
    import ctypes

    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
    if not handle:
        return False
    try:
        return kernel32.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT: still running
    finally:
        kernel32.CloseHandle(handle)


def watch_stop() -> None:
    # Not a stdin reader: a pending synchronous pipe read on Windows blocks DLL loads (numpy) in other threads.
    stop_file = os.environ["TAKI_SMOKE_STOP_FILE"]
    parent = int(os.environ["TAKI_SMOKE_PARENT_PID"])
    while not os.path.exists(stop_file) and _alive(parent):
        time.sleep(0.5)
    signal.raise_signal(signal.SIGINT)


def main() -> None:
    sys.modules["winloop"] = None  # type: ignore[assignment]
    install_guard()
    threading.Thread(target=watch_stop, daemon=True).start()
    from hindsight_api.main import main as native_main

    sys.argv = ["hindsight-api", "--host", "127.0.0.1", "--port", os.environ["TAKI_SMOKE_NATIVE_PORT"], "--access-log"]
    native_main()


if __name__ == "__main__":
    main()
