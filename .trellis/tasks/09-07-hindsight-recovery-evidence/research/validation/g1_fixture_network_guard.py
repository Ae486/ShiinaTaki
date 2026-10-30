"""Pytest guard: deterministic fixture checks may connect only to their owned PostgreSQL port."""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from contextlib import contextmanager
import os
import socket
import sys
import threading


_active = False
_allow_http_fixture = False
_http_listeners: set[socket.socket] = set()


@contextmanager
def owned_http_listener() -> Iterator[socket.socket]:
    """Reserve an actual listener for an opt-in in-process API fixture, without a free-port race."""
    if not _active or not _allow_http_fixture:
        raise RuntimeError("G1_HTTP_FIXTURE_NOT_ENABLED")
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        _http_listeners.add(listener)
        yield listener
    finally:
        _http_listeners.discard(listener)
        listener.close()


def _owns_http_address(host: str | None, port: int) -> bool:
    # Use the bound IPv4 address, not 'localhost' or ::1, which could reach a
    # different listener. Closed/rebound ports never inherit this permission.
    if host != "127.0.0.1":
        return False
    for listener in tuple(_http_listeners):
        try:
            if (
                listener.fileno() >= 0
                and listener.getsockname() == ("127.0.0.1", port)
                and listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN)
            ):
                return True
        except OSError:
            continue
    return False


def pytest_sessionstart(session) -> None:
    global _active, _allow_http_fixture
    del session
    port = int(os.environ["TAKI_G1_FIXTURE_PORT"])
    _allow_http_fixture = os.environ.get("TAKI_G1_ALLOW_HTTP_FIXTURE") == "1"
    _active = True
    allowed_hosts = {"127.0.0.1", "localhost", "::1"}
    internal = threading.local()

    def check_address(host: str | bytes | None, target_port: int | str | None) -> None:
        value = host.decode("ascii") if isinstance(host, bytes) else host
        if target_port is not None:
            target = int(target_port)
            if value in allowed_hosts and target == port:
                return
            if _owns_http_address(value, target):
                return
        raise RuntimeError("G1_FIXTURE_EXTERNAL_NETWORK_FORBIDDEN")

    # Audit hooks cover regular sockets; the loop wrapper also covers Windows ConnectEx paths.
    def audit(event: str, arguments: tuple) -> None:
        if getattr(internal, "socketpair", False):
            return
        if event == "socket.getaddrinfo":
            check_address(arguments[0], arguments[1])
        elif event == "socket.connect":
            address = arguments[1]
            if not isinstance(address, tuple) or len(address) < 2:
                raise RuntimeError("G1_FIXTURE_EXTERNAL_NETWORK_FORBIDDEN")
            check_address(address[0], address[1])

    original = asyncio.BaseEventLoop.create_connection
    original_socketpair = socket.socketpair

    def guarded_socketpair(*args, **kwargs):
        # Windows may emulate the event loop's private wakeup pair with a loopback connection.
        # Exempt only the duration of this standard-library primitive in the calling thread.
        internal.socketpair = True
        try:
            return original_socketpair(*args, **kwargs)
        finally:
            internal.socketpair = False

    async def guarded_connection(self, protocol_factory, host=None, port=None, **kwargs):
        if kwargs.get("sock") is not None:
            address = kwargs["sock"].getpeername()
            check_address(address[0], address[1])
        else:
            check_address(host, port)
        return await original(self, protocol_factory, host, port, **kwargs)

    asyncio.BaseEventLoop.create_connection = guarded_connection
    socket.socketpair = guarded_socketpair
    sys.addaudithook(audit)
