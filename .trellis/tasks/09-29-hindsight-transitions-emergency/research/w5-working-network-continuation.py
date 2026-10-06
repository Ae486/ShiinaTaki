"""Parent-only network-correct W5 continuation; existing approvals/counters still own access.

Default is inert. Only successful public DNS answers for api.deepseek.com:443 may
extend the existing guard's exact address set. No URL, TLS, proxy or gate override.
A first connection failure permanently latches further paid attempts before budget
reservation; clearing that NEW latch requires separate parent review.
"""

from __future__ import annotations

import argparse
import asyncio
import contextvars
import ipaddress
import json
import os
import socket
import ssl
import sys
import threading
from functools import wraps
from pathlib import Path
from typing import Any

import httpx
from w5_actual_embedding_control import digest, load
from w5_reentry_gate import ReentryGate
from w5_working_custody import no_link

HERE = Path(__file__).resolve().parent
PREDECESSOR = HERE / "w5-working-recovery-source-manifest.json"
PREDECESSOR_SHA = "d35d8a45aa2fc19289d4c1a0806f6e341f1ec2d063fd8698923501dda9d2598e"
MANIFEST = HERE / "w5-working-network-source-manifest.json"
HOST = "api.deepseek.com"
REFUSAL = "D78_REAL_EXTERNAL_NETWORK_REFUSED"
LATCH = "working-model-connection-failure.json"
entry = load("w5_network_sealed_entry", "w5-working-recovery.py")


def verify_sources() -> str:
    assert digest(PREDECESSOR) == PREDECESSOR_SHA, "NETWORK_PREDECESSOR_DRIFT"
    previous = json.loads(PREDECESSOR.read_text(encoding="utf-8"))["files"]
    current = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert current["predecessorSha256"] == PREDECESSOR_SHA
    rows = {row["path"]: row for row in current["files"]}
    assert len(rows) == len(current["files"]) and all(rows.get(row["path"]) == row for row in previous)
    for row in current["files"]:
        path = Path(row["path"])
        assert path.stat().st_size == row["bytes"] and digest(path) == row["sha256"], "NETWORK_SOURCE_DRIFT"
    return digest(MANIFEST)


def model_dns(host: Any, port: Any) -> bool:
    return host in (HOST, HOST.encode("ascii")) and type(port) in (int, str) and str(port) == "443"


def public_answers(answers: Any) -> set[str]:
    result = set()
    for family, kind, protocol, _, address in answers:
        if family not in (socket.AF_INET, socket.AF_INET6) or kind != socket.SOCK_STREAM or protocol not in (0, 6):
            continue
        if not isinstance(address, tuple) or len(address) < 2 or address[1] != 443:
            continue
        try:
            ip = ipaddress.ip_address(address[0])
        except ValueError:
            continue
        if ip.is_global and not ip.is_multicast and not ip.is_unspecified:
            if (family == socket.AF_INET) == (ip.version == 4):
                result.update((address[0], str(ip)))
    return result


def guard_refusal(error: BaseException) -> bool:
    return type(error) is RuntimeError and error.args == (REFUSAL,)


def errors(root: BaseException) -> list[tuple[str, BaseException]]:
    """Bounded traversal; provider messages/args/custom class names never serialize."""
    result: list[tuple[str, BaseException]] = []
    pending = [("root", root)]
    seen: set[int] = set()
    while pending and len(result) < 32:
        relation, error = pending.pop(0)
        if id(error) in seen:
            continue
        seen.add(id(error))
        index = len(result)
        result.append((relation, error))
        for name in ("__cause__", "__context__"):
            nested = getattr(error, name, None)
            if isinstance(nested, BaseException):
                pending.append((f"{index}:{name}", nested))
        if isinstance(error, BaseExceptionGroup):
            pending.extend((f"{index}:group", child) for child in error.exceptions[:32])
    return result


def safe_chain(error: BaseException) -> list[dict]:
    known = (
        Exception,
        RuntimeError,
        ValueError,
        TypeError,
        OSError,
        TimeoutError,
        ExceptionGroup,
        BaseExceptionGroup,
        asyncio.CancelledError,
        socket.gaierror,
        ssl.SSLError,
        httpx.ConnectError,
        httpx.ConnectTimeout,
        httpx.ReadError,
        httpx.ReadTimeout,
        httpx.WriteError,
        httpx.WriteTimeout,
        httpx.PoolTimeout,
        httpx.LocalProtocolError,
        httpx.RemoteProtocolError,
        httpx.ProxyError,
        httpx.UnsupportedProtocol,
    )
    names = {kind: kind.__module__ + "." + kind.__name__ for kind in known}
    result = []
    for relation, item in errors(error):
        frames = []
        traceback = item.__traceback__
        while traceback is not None and len(frames) < 24:
            code = traceback.tb_frame.f_code
            path = Path(code.co_filename)
            # Only known source/library locations; never exception text or locals.
            if path.is_absolute() and (
                path.parent == HERE
                or any(component in {"httpx", "httpcore", "anyio", "openai", "asyncio"} for component in path.parts)
            ):
                frames.append({"file": path.name, "line": traceback.tb_lineno, "function": code.co_name})
            traceback = traceback.tb_next
        result.append(
            {
                "relation": relation,
                "type": names.get(type(item), "other"),
                "guardRefusal": guard_refusal(item),
                "frames": frames,
            }
        )
    return result


def connection_failure(error: BaseException) -> bool:
    return any(guard_refusal(item) or isinstance(item, (httpx.TransportError, OSError)) for _, item in errors(error))


class NetworkContinuation:
    def __init__(self, root: Path):
        self.root = root
        self.attempt: str | None = None
        self.output: Path | None = None
        self.addresses: set[str] | None = None
        self.initial: set[str] = set()
        self.failed = False
        self.model_access = False
        self.diagnostic_errors = 0
        self.lock = threading.RLock()
        self.budget: contextvars.ContextVar[Any] = contextvars.ContextVar("working_network_budget", default=None)
        self.original_resolver = socket.getaddrinfo

    def bind(self, attempt: str) -> None:
        assert self.attempt is None and len(attempt) == 32 and all(c in "0123456789abcdef" for c in attempt)
        self.attempt = attempt
        parent = self.root / "working-network-evidence"
        if parent.exists():
            no_link(parent)
        parent.mkdir(exist_ok=True)
        directory = parent / attempt
        directory.mkdir()
        self.output = directory / "events.jsonl"
        self.record({"kind": "network-continuation", "attemptId": attempt, "dnsHost": HOST, "dnsPort": 443})

    def record(self, value: dict) -> None:
        assert self.output is not None
        with self.lock, self.output.open("a", encoding="utf-8", newline="\n") as stream:
            stream.write(json.dumps(value, ensure_ascii=True, allow_nan=False) + "\n")
            stream.flush()

    def resolve(self, host: Any, port: Any, *args: Any, **kwargs: Any) -> Any:
        answers = self.original_resolver(host, port, *args, **kwargs)
        # Original resolver/audit must succeed first. The initial call is used by
        # old install_guard itself; later exact-domain calls update its SAME set.
        if self.model_access and self.addresses is not None and model_dns(host, port):
            accepted = public_answers(answers)
            with self.lock:
                added = accepted - self.addresses
                self.addresses.update(accepted)
                self.record(
                    {
                        "kind": "model-dns-success",
                        "host": HOST,
                        "port": 443,
                        "acceptedAddresses": sorted(accepted),
                        "addedAddresses": sorted(added),
                        "initialGuardWouldReject": sorted(accepted - self.initial),
                    }
                )
        return answers

    def refused(self, event: str, host: Any, port: Any) -> None:
        if isinstance(host, bytes):
            host = host.decode("ascii", errors="replace")
        # getaddrinfo/connect host arguments are addresses, never URLs/headers.
        safe_host = host if isinstance(host, str) and len(host) <= 253 and "/" not in host and "@" not in host else None
        safe_port = port if type(port) in (str, int) and str(port).isdigit() else None
        try:
            self.record(
                {"kind": "actual-guard-refusal", "event": event, "host": safe_host, "port": safe_port, "code": REFUSAL}
            )
        except BaseException:
            self.diagnostic_errors += 1
            self.failed = True

    def install_guard(self, original: Any, pg_port: Any, listener: Any, *, model_access: bool) -> set[str]:
        assert self.addresses is None, "NETWORK_GUARD_ALREADY_INSTALLED"
        self.model_access = model_access
        original_add = sys.addaudithook

        def add(callback: Any) -> None:
            def audited(event: str, args: tuple) -> None:
                try:
                    callback(event, args)
                except BaseException as error:
                    if guard_refusal(error):
                        if event == "socket.getaddrinfo":
                            self.refused(event, args[0], args[1])
                        elif event == "socket.connect":
                            address = args[1]
                            self.refused(
                                event,
                                address[0] if isinstance(address, tuple) else None,
                                address[1] if isinstance(address, tuple) and len(address) > 1 else None,
                            )
                    raise

            original_add(audited)

        setattr(socket, "getaddrinfo", self.resolve)
        setattr(sys, "addaudithook", add)
        try:
            self.addresses = original(pg_port, listener, model_access=model_access)
        finally:
            sys.addaudithook = original_add
        self.initial = set(self.addresses)
        guarded = asyncio.BaseEventLoop.create_connection

        @wraps(guarded)
        async def connect(loop: Any, factory: Any, host: Any = None, port: Any = None, **kwargs: Any) -> Any:
            if (
                self.addresses is not None
                and port in (443, "443")
                and host in self.addresses
                and host not in self.initial
            ):
                self.record(
                    {
                        "kind": "rotated-model-address-connect",
                        "host": host,
                        "port": 443,
                        "initialGuardWouldReject": True,
                    }
                )
            try:
                return await guarded(loop, factory, host, port, **kwargs)
            except BaseException as error:
                if guard_refusal(error):
                    peer = kwargs.get("sock")
                    if peer is not None:
                        try:
                            host, port, *_ = peer.getpeername()
                        except OSError:
                            host = port = None
                    self.refused("asyncio.create_connection", host, port)
                raise

        setattr(asyncio.BaseEventLoop, "create_connection", connect)
        self.record({"kind": "guard-installed", "modelAccess": model_access, "initialAddresses": sorted(self.initial)})
        return self.addresses

    def latch(self, submission: int | None) -> None:
        with self.lock:
            self.failed = True
            path = self.root / LATCH
            if path.exists():
                return
            # An incomplete file also fails closed on the next invocation. Never
            # replace/clear a previous latch or roll back already reserved counts.
            with path.open("x", encoding="utf-8", newline="\n") as stream:
                json.dump(
                    {
                        "version": 1,
                        "kind": "model-connection-failure",
                        "attemptId": self.attempt,
                        "submissionAtSend": submission,
                        "reviewRequired": True,
                    },
                    stream,
                )
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())

    def observe(self, original_observer: Any, root: Path) -> None:
        assert root == self.root
        original_observer(root)
        original_send = httpx.AsyncClient.send

        @wraps(original_send)
        async def send(client: Any, request: Any, *args: Any, **kwargs: Any) -> Any:
            budget = self.budget.get()
            submission = budget.state["submitted"] if budget is not None else None
            try:
                return await original_send(client, request, *args, **kwargs)
            except BaseException as error:
                if request.url.host == HOST:
                    failed = connection_failure(error)
                    # Latch before any diagnostic I/O can fail. It preserves the
                    # original request's exception and never authorizes retries.
                    try:
                        if failed:
                            self.latch(submission)
                        self.record(
                            {
                                "kind": "model-send-failure",
                                "submissionAtSend": submission,
                                "connectionFailure": failed,
                                "chain": safe_chain(error),
                            }
                        )
                    except BaseException:
                        self.diagnostic_errors += 1
                        self.failed = True
                raise

        setattr(httpx.AsyncClient, "send", send)

    async def gate_send(
        self, original: Any, gate: Any, delegate: Any, budget: Any, client: Any, request: Any, *args: Any, **kwargs: Any
    ) -> Any:
        assert gate.root == self.root and gate.supervisor_attempt == self.attempt, "NETWORK_FOREIGN_GATE_REFUSED"
        if request.url.host == HOST and (self.failed or (self.root / LATCH).exists()):
            raise RuntimeError("W5_MODEL_CONNECTION_FAILURE_REVIEW_REQUIRED")
        token = self.budget.set(budget)
        try:
            return await original(gate, delegate, budget, client, request, *args, **kwargs)
        finally:
            self.budget.reset(token)


def run(args: argparse.Namespace) -> int:
    source_sha = verify_sources()
    # Stop an already latched continuation before the old entry starts services.
    if (entry.ROOT / LATCH).exists():
        raise RuntimeError("W5_MODEL_CONNECTION_FAILURE_REVIEW_REQUIRED")
    if args.maintenance_approval is not None:
        count = json.loads((entry.ROOT / "model-submissions.json").read_text(encoding="utf-8"))["submitted"]
        assert type(count) is int and count >= 301
        approval = json.loads(args.maintenance_approval.read_text(encoding="utf-8"))
        # Explicit empty-bank approval is the existing no-model plan observation
        # path; the sealed entry still validates its complete shape and cap.
        if count >= args.submission_cap and approval.get("banks") != []:
            raise RuntimeError("W5_MODEL_APPROVED_ALLOWANCE_EXHAUSTED")
    validation = HERE.parents[1] / "08-09-hindsight-initial-cutover/research/validation"
    sys.path.insert(0, str(validation))
    import real_hindsight_network as network

    controller = NetworkContinuation(entry.ROOT)
    original_load, original_gate = entry.load, ReentryGate.send
    original_install, original_observe = network.install_guard, network.observe_model_calls

    def load_supervisor(name: str, filename: str) -> Any:
        old = original_load(name, filename)
        if name == "w5_working_old_supervisor":
            original_execute = old.execute

            async def execute(password: str, mode: str, summary: dict, **kwargs: Any) -> None:
                assert mode == "run" and kwargs["stage"] == "reentry" and kwargs["reentry_renewal"] is None
                controller.bind(summary["attemptId"])
                summary["networkContinuation"] = {"manifestSha256": source_sha, "events": str(controller.output)}
                try:
                    await original_execute(password, mode, summary, **kwargs)
                finally:
                    summary["networkContinuation"]["diagnosticErrors"] = controller.diagnostic_errors
                    summary["networkContinuation"]["connectionFailureLatched"] = controller.failed
                assert controller.diagnostic_errors == 0, "NETWORK_DIAGNOSTIC_INCOMPLETE"

            old.execute = execute
        return old

    async def gate_send(
        gate: Any, delegate: Any, budget: Any, client: Any, request: Any, *extra: Any, **kwargs: Any
    ) -> Any:
        return await controller.gate_send(original_gate, gate, delegate, budget, client, request, *extra, **kwargs)

    entry.load = load_supervisor
    setattr(network, "install_guard", lambda *a, **k: controller.install_guard(original_install, *a, **k))
    setattr(network, "observe_model_calls", lambda root: controller.observe(original_observe, root))
    setattr(ReentryGate, "send", gate_send)
    try:
        result = entry.run_reviewed(args)
        assert verify_sources() == source_sha
        return result
    finally:
        entry.load, ReentryGate.send = original_load, original_gate
        network.install_guard, network.observe_model_calls = original_install, original_observe
        socket.getaddrinfo = controller.original_resolver
        # Existing audit hooks are intentionally permanent: each invocation is a
        # fresh CLI process, never a second run inside a reused interpreter.


def main(argv: list[str] | None = None) -> int:
    args = entry.arguments(argv)
    if not args.run_reviewed_working_copy:
        print(
            json.dumps(
                {
                    "parentRunOnly": True,
                    "executed": False,
                    "dnsRefreshHost": HOST,
                    "dnsRefreshPort": 443,
                    "newModelAllowance": False,
                }
            )
        )
        return 0
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
