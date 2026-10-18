"""Protected Linux-only socket transport; never falls back to TCP or pipes.

The anonymous-pipe process driver is a separate test fixture. This module does
not grant custody or install a runtime, socket directory, service, or tmpfs.
"""

from __future__ import annotations

import os
import socket
import stat
import struct
import sys
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Literal, cast

from .bootstrap import Bootstrap
from .protocol import (
    ADMISSION_SECONDS,
    PRIVATE_BYTES,
    STATUS_BYTES,
    Reason,
    Refusal,
    encode_status,
    packet,
    read_packet,
)

RUNTIME_DIRECTORY = Path("/run/taki-hindsight")
SOCKET_NAME = "bootstrap.sock"


@dataclass(frozen=True)
class SocketIdentity:
    device: int
    inode: int


@contextmanager
def socket_deadline(connection: socket.socket, deadline: float) -> Iterator[None]:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise Refusal(Reason.STALE)

    def expire() -> None:
        try:
            connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass  # An already closed exact socket needs no further cleanup.

    # Per-read timeouts alone permit a trickle sender to renew the timeout.
    # This absolute watchdog shuts down only the private exchange, not Native.
    timer = threading.Timer(remaining, expire)
    timer.daemon = True
    timer.start()
    try:
        connection.settimeout(remaining)
        yield
    finally:
        timer.cancel()


def require_linux() -> int:
    if sys.platform != "linux" or not hasattr(socket, "AF_UNIX") or not hasattr(os, "geteuid"):
        raise Refusal(Reason.UNSUPPORTED)
    return getattr(os, "geteuid")()


def require_peer(connection: socket.socket, uid: int) -> None:
    require_linux()
    # Both endpoints check the kernel producer. Socket filenames or a JSON UID
    # assertion are not peer identity; the same-UID/container admin is trusted.
    peer = struct.unpack("3i", connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    if peer[0] <= 0 or peer[1] != uid:
        raise Refusal(Reason.UNSAFE)


class SocketDirectory:
    def __init__(
        self, directory: Path = RUNTIME_DIRECTORY, *, kind: Literal["bootstrap.sock", "control.sock"] = SOCKET_NAME
    ) -> None:
        if kind not in ("bootstrap.sock", "control.sock"):
            raise Refusal(Reason.UNSAFE)
        self.kind = kind
        self.uid = require_linux()
        if not directory.is_absolute():
            raise Refusal(Reason.UNSAFE)
        for ancestor in reversed((directory, *directory.parents)):
            metadata = ancestor.lstat()
            mode = stat.S_IMODE(metadata.st_mode)
            # A root-owned sticky /tmp ancestor is safe for a new private owned
            # fixture directory; ordinary world-writable ancestors are not.
            sticky_root = ancestor != directory and metadata.st_uid == 0 and bool(metadata.st_mode & stat.S_ISVTX)
            if (
                not stat.S_ISDIR(metadata.st_mode)
                or metadata.st_uid not in (0, self.uid)
                or mode & 0o022
                and not sticky_root
            ):
                raise Refusal(Reason.UNSAFE)
        self.directory = directory
        self.fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        metadata = os.fstat(self.fd)
        if metadata.st_uid != self.uid or stat.S_IMODE(metadata.st_mode) != 0o700:
            os.close(self.fd)
            raise Refusal(Reason.UNSAFE)
        self._identity = SocketIdentity(metadata.st_dev, metadata.st_ino)
        self._socket_identity: SocketIdentity | None = None

    @property
    def anchored_path(self) -> str:
        # Binding/connecting through the retained fd avoids a parent-path swap
        # between checking the directory and consuming its socket entry.
        return f"/proc/self/fd/{self.fd}/{self.kind}"

    def verify(self) -> None:
        metadata = self.directory.lstat()
        opened = os.fstat(self.fd)
        if not stat.S_ISDIR(metadata.st_mode) or SocketIdentity(metadata.st_dev, metadata.st_ino) != self._identity:
            raise Refusal(Reason.UNSAFE)
        if opened.st_uid != self.uid or stat.S_IMODE(opened.st_mode) != 0o700:
            raise Refusal(Reason.UNSAFE)

    def socket_identity(self) -> SocketIdentity:
        self.verify()
        metadata = os.stat(self.kind, dir_fd=self.fd, follow_symlinks=False)
        if (
            not stat.S_ISSOCK(metadata.st_mode)
            or metadata.st_uid != self.uid
            or stat.S_IMODE(metadata.st_mode) != 0o600
        ):
            raise Refusal(Reason.UNSAFE)
        return SocketIdentity(metadata.st_dev, metadata.st_ino)

    def bind(self, listener: socket.socket) -> None:
        self.verify()
        # bind refuses a pre-existing leaf. Never remove an unknown old socket,
        # file or symlink as an implicit restart or permission repair.
        listener.bind(self.anchored_path)
        os.chmod(self.kind, 0o600, dir_fd=self.fd, follow_symlinks=False)
        self._socket_identity = self.socket_identity()
        listener.listen(1)

    def close(self) -> None:
        try:
            if self._socket_identity is not None:
                try:
                    current = self.socket_identity()
                except FileNotFoundError:
                    current = None
                if current is not None:
                    if current != self._socket_identity:
                        raise Refusal(Reason.UNSAFE)
                    os.unlink(self.kind, dir_fd=self.fd)
        finally:
            os.close(self.fd)


def connect_private(directory: SocketDirectory, deadline: float) -> socket.socket:
    before = directory.socket_identity()
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise Refusal(Reason.STALE)
        connection.settimeout(remaining)
        connection.connect(directory.anchored_path)
        require_peer(connection, directory.uid)
        if directory.socket_identity() != before:
            raise Refusal(Reason.UNSAFE)
        return connection
    except BaseException:
        connection.close()
        raise


def _serve_connection(bootstrap: Bootstrap, connection: socket.socket, directory: SocketDirectory) -> None:
    initial = bootstrap.status()
    # A consumed grant no longer limits observation of its still-running child.
    # Keep each exchange bounded while accept() continues to reject reinjection;
    # pre-start input remains limited by the original admission deadline.
    remaining = ADMISSION_SECONDS if initial.state == "running" else bootstrap.remaining()
    deadline = time.monotonic() + min(ADMISSION_SECONDS, remaining)
    try:
        directory.verify()
        require_peer(connection, directory.uid)
        with socket_deadline(connection, deadline):
            connection.sendall(packet(encode_status(initial), STATUS_BYTES))
            with connection.makefile("rb", buffering=0) as stream:
                payload = read_packet(cast(BinaryIO, stream), PRIVATE_BYTES, eof=True)
            directory.verify()
            status = bootstrap.accept(payload)
    except Refusal as error:
        status = bootstrap.refusal(error.reason)
    except (OSError, ValueError):
        status = bootstrap.refusal(Reason.HOST)
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return
        connection.settimeout(remaining)
        connection.sendall(packet(encode_status(status), STATUS_BYTES))
    except OSError:
        # A lost ACK does not roll back a consumed grant or relaunch a child.
        pass


def serve(bootstrap: Bootstrap, stop: threading.Event, directory: Path = RUNTIME_DIRECTORY) -> None:
    """Serve an independently owned Bootstrap, including the fixed C2a owner."""
    protected = SocketDirectory(directory)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    active: socket.socket | None = None

    def cancel_private_read() -> None:
        stop.wait()
        if active is not None:
            try:
                active.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass  # The exact active connection may already have closed.

    cancellation = threading.Thread(target=cancel_private_read, name="bootstrap-private-cancel", daemon=True)
    try:
        protected.bind(listener)
        cancellation.start()
        listener.settimeout(0.1)
        while not stop.is_set():
            state = bootstrap.status().state
            if state in ("stopped", "unavailable"):
                break
            try:
                connection, _address = listener.accept()
            except TimeoutError:
                continue
            with connection:
                active = connection
                if stop.is_set():
                    break
                _serve_connection(bootstrap, connection, protected)
                active = None
    finally:
        stop.set()
        listener.close()
        if cancellation.is_alive():
            cancellation.join(timeout=1)
        try:
            bootstrap.close()
        finally:
            protected.close()
