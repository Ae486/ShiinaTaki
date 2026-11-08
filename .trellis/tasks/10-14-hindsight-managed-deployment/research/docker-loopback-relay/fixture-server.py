"""Fixed stdlib transport fixture. No API, database, credential, or model import."""

import errno
import fcntl
import hashlib
import ipaddress
import json
import os
import signal
import socket
import struct
import time
from pathlib import Path

TOKEN = "9a276b18-7fa2-4421-869c-88f0d89aec01"
SCHEMA = "c2b-relay-fixture-v1"
LIMIT = 65536
STARTED = time.monotonic()
STOP = False


def emit(event, **facts):
    print(
        json.dumps(dict(schema=SCHEMA, event=event, **facts), separators=(",", ":")),
        flush=True,
    )


def data(label, size):
    return b"".join(
        hashlib.sha256((TOKEN + ":" + label + ":" + str(i)).encode()).digest()
        for i in range((size + 31) // 32)
    )[:size]


def identity(pid):
    fields = Path("/proc/%d/stat" % pid).read_text().rsplit(")", 1)[1].split()
    return dict(
        pid=pid,
        startTicks=fields[19],
        ppid=int(fields[1]),
        pgid=int(fields[2]),
        sid=int(fields[3]),
    )


def bounded_text(path, limit=8192):
    with open(path, "rb") as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("PROC_BOUND")
    return raw.decode("ascii")


def network_facts():
    interfaces = socket.if_nameindex()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as control:
        ipv4 = socket.inet_ntoa(
            fcntl.ioctl(control, 0x8915, struct.pack("256s", b"lo"))[20:24]
        )
    route4 = bounded_text("/proc/net/route")
    rows4 = [line.split() for line in route4.splitlines()[1:] if line.strip()]
    valid4 = all(
        row[0] == "lo"
        and ipaddress.IPv4Address(bytes.fromhex(row[1])[::-1]).is_loopback
        for row in rows4
    )
    route6 = bounded_text("/proc/net/ipv6_route")
    rows6 = [line.split() for line in route6.splitlines() if line.strip()]
    # Linux installs unreachable ::/0 entries on lo even with no usable IPv6 route.
    valid6 = all(
        row[-1] == "lo"
        and (
            (int(row[0], 16) == 1 and int(row[1], 16) == 128)
            or (int(row[0], 16) == 0 and int(row[8], 16) & 0x200 != 0)
        )
        for row in rows6
    )
    addresses6 = bounded_text("/proc/net/if_inet6")
    valid_addresses6 = all(
        row.split()[-1] == "lo" and int(row.split()[0], 16) == 1
        for row in addresses6.splitlines()
        if row.strip()
    )
    return dict(
        interfaces=interfaces,
        ipv4=ipv4,
        ipv6Addresses=addresses6,
        ipv4Routes=route4,
        ipv6Routes=route6,
        onlyLoopback=(
            [name for _, name in interfaces] == ["lo"]
            and ipv4 == "127.0.0.1"
            and valid4
            and valid6
            and valid_addresses6
        ),
    )


def negative_probe(family, target):
    phase = "socket"
    began = time.monotonic()
    code = None
    try:
        with socket.socket(family, socket.SOCK_STREAM) as probe:
            phase = "connect"
            probe.settimeout(0.7)
            probe.connect(target)
        outcome = "connected"
    except OSError as error:
        code = (
            errno.errorcode.get(error.errno, "UNKNOWN")
            if error.errno is not None
            else "UNKNOWN"
        )
        outcome = "timeout" if isinstance(error, TimeoutError) else "error"
    expected = (phase == "socket" and code in ("EAFNOSUPPORT", "EPROTONOSUPPORT")) or (
        phase == "connect" and code in ("ENETUNREACH", "EHOSTUNREACH", "EADDRNOTAVAIL")
    )
    return dict(
        family=int(family),
        target=list(target),
        phase=phase,
        outcome=outcome,
        code=code,
        expectedRefusal=outcome == "error" and expected,
        elapsedMs=round((time.monotonic() - began) * 1000),
    )


def process_facts(listener):
    status = dict(
        line.split(":", 1)
        for line in bounded_text("/proc/self/status").splitlines()
        if ":" in line
    )
    uid = [int(value) for value in status["Uid"].split()]
    gid = [int(value) for value in status["Gid"].split()]
    caps = {
        key: status[key].strip()
        for key in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb")
    }
    inode = os.readlink("/proc/self/fd/%d" % listener.fileno())
    matches = [
        line.split()
        for line in bounded_text("/proc/net/tcp").splitlines()[1:]
        if "socket:[%s]" % line.split()[9] == inode
    ]
    return dict(
        identity=identity(os.getpid()),
        executable=os.readlink("/proc/self/exe"),
        uid=uid,
        gid=gid,
        capabilities=caps,
        noNewPrivileges=status["NoNewPrivs"].strip(),
        socketInode=inode,
        listenerRows=matches,
        bound=list(listener.getsockname()),
        valid=(
            uid == [1000] * 4
            and gid == [1000] * 4
            and all(int(x, 16) == 0 for x in caps.values())
            and status["NoNewPrivs"].strip() == "1"
            and len(matches) == 1
            and matches[0][1] == "0100007F:1F40"
            and matches[0][3] == "0A"
        ),
    )


def receive(connection, size=None):
    chunks = []
    total = 0
    while size is None or total < size:
        chunk = connection.recv(
            min(4096, LIMIT + 1 - total, size - total if size is not None else LIMIT)
        )
        if not chunk:
            return b"".join(chunks), True
        total += len(chunk)
        if total > LIMIT:
            raise ValueError("REQUEST_BOUND")
        chunks.append(chunk)
    return b"".join(chunks), False


def serve_first(connection):
    request, eof = receive(connection)
    valid = eof and request == data("request", 32768)
    emit(
        "request-eof",
        length=len(request),
        sha256=hashlib.sha256(request).hexdigest(),
        valid=valid,
    )
    if not valid:
        raise ValueError("FIRST_REQUEST")
    response = data("response", 49152)
    offset = 0
    writes = []
    for length in (1, 17, 255, 4097, 8191, 16385, len(response)):
        piece = response[offset : offset + length]
        if not piece:
            break
        connection.sendall(piece)
        writes.append(len(piece))
        offset += len(piece)
    connection.shutdown(socket.SHUT_WR)
    return dict(
        requestBytes=len(request),
        requestSha256=hashlib.sha256(request).hexdigest(),
        requestEof=eof,
        responseBytes=len(response),
        responseSha256=hashlib.sha256(response).hexdigest(),
        responseWrites=writes,
        responseHalfClosed=True,
    )


def serve_abort(connection):
    request, early_eof = receive(connection, 1024)
    if early_eof or request != data("abort-request", 1024):
        raise ValueError("ABORT_REQUEST")
    ack = data("abort-ack", 512)
    connection.sendall(ack)
    emit("abort-armed", requestBytes=len(request), ackBytes=len(ack))
    try:
        rest, eof = receive(connection)
        cancelled = eof and not rest
        reason = "eof" if eof else "unexpected-data"
    except ConnectionResetError:
        cancelled, reason = True, "ECONNRESET"
    return dict(
        requestBytes=len(request),
        requestSha256=hashlib.sha256(request).hexdigest(),
        ackBytes=len(ack),
        ackSha256=hashlib.sha256(ack).hexdigest(),
        cancelled=cancelled,
        reason=reason,
    )


def stop(_signal, _frame):
    global STOP
    STOP = True


def main():
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGCHLD, signal.SIG_IGN)
    signal.alarm(55)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 8000))
        listener.listen(2)
        listener.settimeout(35)
        network = network_facts()
        lo = socket.if_nametoindex("lo")
        probes = [
            negative_probe(socket.AF_INET, ("1.1.1.1", 443)),
            negative_probe(socket.AF_INET, ("169.254.1.1", 80)),
            negative_probe(socket.AF_INET6, ("2606:4700:4700::1111", 443, 0, 0)),
            negative_probe(socket.AF_INET6, ("fe80::1", 80, 0, lo)),
        ]
        process = process_facts(listener)
        emit("ready", token=TOKEN, process=process, network=network, probes=probes)
        results = []
        for case in ("half-close", "client-abort"):
            connection, peer = listener.accept()
            with connection:
                connection.settimeout(12)
                emit("accepted", case=case, peer=list(peer))
                facts = (
                    serve_first(connection)
                    if case == "half-close"
                    else serve_abort(connection)
                )
                results.append(dict(case=case, **facts))
                emit("case-complete", case=case, **facts)
    emit("complete", cases=results, listenerClosed=True)
    # Keep this original namespace available for the one independent /proc observation.
    # SIGCHLD is ignored so orphaned exec children cannot remain PID-1-owned zombies.
    signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM})
    if not STOP:
        signal.sigwait({signal.SIGTERM})
    emit(
        "stopped",
        identity=identity(os.getpid()),
        elapsedMs=round((time.monotonic() - STARTED) * 1000),
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        emit("failed", error=type(error).__name__)
        raise SystemExit(2) from None
