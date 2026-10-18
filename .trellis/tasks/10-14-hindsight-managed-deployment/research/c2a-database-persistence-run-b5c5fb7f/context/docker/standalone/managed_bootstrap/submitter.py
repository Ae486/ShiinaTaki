"""One bounded stdin submission to the fixed protected Linux bootstrap socket.

No argv options, secret stdout, public listener, environment map, or reconnect
retry is provided. The deployment Host's real delivery path remains unwired.
"""

from __future__ import annotations

import queue
import socket
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import BinaryIO

from .protocol import (
    ADMISSION_SECONDS,
    PRIVATE_BYTES,
    STATUS_BYTES,
    PrivateFrame,
    Reason,
    Refusal,
    Status,
    encode_status,
    packet,
    parse_private,
    parse_status,
    read_packet,
    timestamp,
)
from .unix_socket import SocketDirectory, connect_private, require_linux, socket_deadline


@dataclass(frozen=True)
class Submission:
    frame: PrivateFrame
    payload: bytes = field(repr=False)


def read_submission(stream: BinaryIO, deadline: float) -> Submission:
    # Windows anonymous pipes cannot use select(). This one-shot stdin worker
    # is daemonized so an unterminated frame cannot keep the submitter alive
    # after its fixed deadline. The long-lived Unix server uses socket timeouts.
    result: queue.Queue[Submission | Refusal] = queue.Queue(maxsize=1)
    raw_stream = getattr(stream, "raw", stream)

    def read() -> None:
        try:
            # Do not hold BufferedReader's lock in a daemon thread at Python
            # finalization after timeout; a raw pipe read owns no such lock.
            payload = read_packet(raw_stream, PRIVATE_BYTES, eof=True)
            result.put(Submission(parse_private(payload), payload))
        except Refusal as error:
            result.put(error)
        except Exception:
            result.put(Refusal(Reason.DENIED))

    threading.Thread(target=read, name="bounded-custody-stdin", daemon=True).start()
    try:
        answer = result.get(timeout=max(0.0, deadline - time.monotonic()))
    except queue.Empty:
        raise Refusal(Reason.STALE) from None
    if isinstance(answer, Refusal):
        raise answer
    if time.monotonic() >= deadline:
        raise Refusal(Reason.STALE)
    return answer


def require_challenge(status: Status, frame: PrivateFrame) -> None:
    if status.state != "waiting-for-credentials":
        raise Refusal(status.reason or Reason.DENIED)
    if status.binding is None:
        raise Refusal(Reason.APPROVAL)
    if status.binding != frame.binding:
        raise Refusal(Reason.STALE)


def require_ack(status: Status, frame: PrivateFrame) -> None:
    if status.binding != frame.binding:
        raise Refusal(Reason.UNKNOWN)
    if status.state == "unavailable":
        raise Refusal(status.reason or Reason.UNKNOWN)
    if status.state not in ("running", "stopped"):
        raise Refusal(Reason.UNKNOWN)


def submit(submission: Submission, deadline: float) -> Status:
    directory = SocketDirectory()
    try:
        remaining = (timestamp(submission.frame.binding.deadline_at) - datetime.now(timezone.utc)).total_seconds()
        deadline = min(deadline, time.monotonic() + remaining)
        with connect_private(directory, deadline) as connection, socket_deadline(connection, deadline):
            with connection.makefile("rb", buffering=0) as stream:
                require_challenge(parse_status(read_packet(stream, STATUS_BYTES, eof=False)), submission.frame)
                connection.sendall(packet(submission.payload))
                connection.shutdown(socket.SHUT_WR)
                status = parse_status(read_packet(stream, STATUS_BYTES, eof=True))
            require_ack(status, submission.frame)
            return status
    finally:
        directory.close()


def main() -> int:
    # The only production entry is a fixed socket client. Windows exercises
    # shared functions in tests, never this entry with a different transport.
    deadline = time.monotonic() + ADMISSION_SECONDS
    try:
        if len(sys.argv) != 1:
            raise Refusal(Reason.DENIED)
        require_linux()
        submission = read_submission(sys.stdin.buffer, deadline)
        status = submit(submission, deadline)
        code = 0
    except Refusal as error:
        # A syntactically valid private frame is still not admitted identity.
        # On failure only the owning Host may attach its independently known
        # original IDs; this client never reflects rejected input fields.
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
