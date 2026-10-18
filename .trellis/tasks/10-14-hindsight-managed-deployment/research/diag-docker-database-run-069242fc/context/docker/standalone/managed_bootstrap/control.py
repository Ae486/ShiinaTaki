"""INPUT: one bounded status/authorize frame on the fixed protected control socket.
OUTPUT: safe existing bootstrap status, independent of the private credential path.
POS: C2a Native owner-control server/client; no options, reset or arbitrary commands.
"""

from __future__ import annotations

import queue
import socket
import sys
import threading
import time
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO, cast

from .owner_protocol import CONTROL_BYTES, parse_owner_request
from .protocol import (
    ADMISSION_SECONDS,
    STATUS_BYTES,
    Reason,
    Refusal,
    Status,
    encode_status,
    packet,
    parse_status,
    read_packet,
)
from .unix_socket import (
    RUNTIME_DIRECTORY,
    SocketDirectory,
    connect_private,
    require_linux,
    require_peer,
    socket_deadline,
)

if TYPE_CHECKING:
    from .owner import C2BootstrapOwner


def read_control(stream: BinaryIO, deadline: float) -> bytes:
    answers: queue.Queue[bytes | Refusal] = queue.Queue(maxsize=1)
    raw = getattr(stream, "raw", stream)

    def read() -> None:
        try:
            payload = read_packet(raw, CONTROL_BYTES, eof=True)
            parse_owner_request(payload)
            answers.put(payload)
        except Refusal as error:
            answers.put(error)
        except Exception:
            answers.put(Refusal(Reason.DENIED))

    threading.Thread(target=read, daemon=True).start()
    try:
        answer = answers.get(timeout=max(0.0, deadline - time.monotonic()))
    except queue.Empty:
        raise Refusal(Reason.STALE) from None
    if isinstance(answer, Refusal):
        raise answer
    if time.monotonic() >= deadline:
        raise Refusal(Reason.STALE)
    return answer


def exchange(payload: bytes, deadline: float) -> Status:
    parse_owner_request(payload)
    directory = SocketDirectory(kind="control.sock")
    try:
        with connect_private(directory, deadline) as connection, socket_deadline(connection, deadline):
            connection.sendall(packet(payload, CONTROL_BYTES))
            connection.shutdown(socket.SHUT_WR)
            with connection.makefile("rb", buffering=0) as stream:
                return parse_status(read_packet(cast(BinaryIO, stream), STATUS_BYTES, eof=True))
    finally:
        directory.close()


def serve_control(owner: C2BootstrapOwner, stop: threading.Event, root: Path = RUNTIME_DIRECTORY) -> None:
    protected: SocketDirectory | None = None
    listener: socket.socket | None = None
    active: socket.socket | None = None

    def cancel() -> None:
        stop.wait()
        if active is not None:
            try:
                active.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass  # The exact control exchange may already have finished.

    try:
        protected = SocketDirectory(root, kind="control.sock")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        protected.bind(listener)
        threading.Thread(target=cancel, daemon=True).start()
        listener.settimeout(0.1)
        while not stop.is_set():
            try:
                connection, _address = listener.accept()
            except TimeoutError:
                continue
            with connection:
                active = connection
                _serve_connection(owner, connection, protected)
                active = None
    except Exception:
        stop.set()  # A failed protected control path must not leave bootstrap usable.
    finally:
        if listener is not None:
            listener.close()
        if protected is not None:
            try:
                protected.close()
            except Exception:
                stop.set()


def _serve_connection(owner: C2BootstrapOwner, connection: socket.socket, directory: SocketDirectory) -> None:
    deadline = time.monotonic() + ADMISSION_SECONDS
    try:
        directory.verify()
        require_peer(connection, directory.uid)
        with socket_deadline(connection, deadline):
            with connection.makefile("rb", buffering=0) as stream:
                # The socket timeout preserves blocking byte reads; SocketIO's
                # broader nonblocking type is not used at this boundary.
                payload = read_packet(cast(BinaryIO, stream), CONTROL_BYTES, eof=True)
            directory.verify()
            status = owner.control(payload)
    except Refusal as error:
        status = owner.bootstrap.refusal(error.reason)
    except Exception:
        status = owner.bootstrap.refusal(Reason.HOST)
    try:
        with socket_deadline(connection, deadline):
            connection.sendall(packet(encode_status(status), STATUS_BYTES))
    except (OSError, Refusal):
        pass  # Lost grant acknowledgement never revokes or reinstalls its grant.


def main() -> int:
    deadline = time.monotonic() + ADMISSION_SECONDS
    try:
        if len(sys.argv) != 1:
            raise Refusal(Reason.DENIED)
        require_linux()
        status = exchange(read_control(sys.stdin.buffer, deadline), deadline)
        code = 0
    except Refusal as error:
        status = Status("unavailable", "00000000-0000-0000-0000-000000000000", "0" * 64, reason=error.reason)
        code = 1
    except Exception:
        status = Status("unavailable", "00000000-0000-0000-0000-000000000000", "0" * 64, reason=Reason.UNKNOWN)
        code = 1
    try:
        sys.stdout.buffer.write(encode_status(status) + b"\n")
        sys.stdout.buffer.flush()
    except OSError:
        return 1
    return code


if __name__ == "__main__":
    raise SystemExit(main())
