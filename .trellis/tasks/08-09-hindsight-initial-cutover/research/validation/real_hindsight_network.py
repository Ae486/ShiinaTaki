"""Egress and content-free usage observation for the real-model D78 harness."""

from __future__ import annotations

import asyncio
import json
import math
import socket
import sys
import threading
import time
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path
from typing import Any, Literal

_observation_errors = 0
_metadata_errors = 0
_serialization_errors = 0
MAX_USAGE_COUNT = (1 << 53) - 1
MAX_FINISH_REASONS = 16
TOKEN_KEYS = frozenset({
    "prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens",
    "prompt_cache_miss_tokens", "input_tokens", "output_tokens",
})
FINISH_REASONS = frozenset({"stop", "length", "content_filter", "tool_calls", "function_call", "error"})
MODEL_PATHS = frozenset({"/chat/completions", "/v1/chat/completions"})


def observation_status() -> dict[str, int | bool]:
    # Unknown provider metrics are normal. These counters describe failures of
    # the observer itself and must not misreport a parse failure as a disk error.
    return {"complete": _observation_errors == _metadata_errors == _serialization_errors == 0,
            "write_errors": _observation_errors, "metadata_errors": _metadata_errors,
            "serialization_errors": _serialization_errors}


def observation_failed(root: Path, stage: Literal["metadata", "serialization", "write"]) -> None:
    global _observation_errors, _metadata_errors, _serialization_errors
    if stage == "metadata":
        _metadata_errors += 1
    elif stage == "serialization":
        _serialization_errors += 1
    else:
        _observation_errors += 1
    try:
        (root / "model-usage-incomplete.json").write_text(json.dumps(observation_status()), encoding="utf-8")
    except BaseException:
        # This is a secondary best-effort marker, not another provider attempt or
        # another primary observer failure. In-memory status still stops the run.
        pass


def write_observation(root: Path, record: dict[str, Any]) -> None:
    try:
        encoded = json.dumps(record, allow_nan=False) + "\n"
    except BaseException:
        observation_failed(root, "serialization")
        return
    try:
        with (root / "model-usage.jsonl").open("a", encoding="utf-8") as out:
            if out.write(encoded) != len(encoded):
                raise OSError("D78_OBSERVATION_WRITE_INCOMPLETE")
    except BaseException:
        observation_failed(root, "write")


def install_guard(pg_port: int | None, listener: socket.socket | None, *, model_access: bool) -> set[str]:
    addresses = {"api.deepseek.com"} if model_access else set()
    if model_access:
        addresses.update(str(info[4][0]) for info in socket.getaddrinfo("api.deepseek.com", 443, type=socket.SOCK_STREAM))
    internal = threading.local()
    original_pair = socket.socketpair
    original_connection = asyncio.BaseEventLoop.create_connection

    def check(host: str | bytes | None, port: int | str | None) -> None:
        host = host.decode("ascii") if isinstance(host, bytes) else host
        port = int(port) if port is not None else None
        if host in addresses and port == 443:
            return
        if host in ("127.0.0.1", "localhost", "::1") and pg_port is not None and port == pg_port:
            return
        if listener is not None and host == "127.0.0.1" and listener.fileno() >= 0:
            if listener.getsockname() == (host, port) and listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN):
                return
        raise RuntimeError("D78_REAL_EXTERNAL_NETWORK_REFUSED")

    def audit(event: str, arguments: tuple[Any, ...]) -> None:
        if getattr(internal, "socketpair", False):
            return
        if event == "socket.getaddrinfo":
            check(arguments[0], arguments[1])
        elif event == "socket.connect":
            address = arguments[1]
            if not isinstance(address, tuple) or len(address) < 2:
                raise RuntimeError("D78_REAL_EXTERNAL_NETWORK_REFUSED")
            check(address[0], address[1])

    @wraps(original_pair)
    def pair(*args: Any, **kwargs: Any) -> Any:
        internal.socketpair = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            internal.socketpair = False

    @wraps(original_connection)
    async def connect(self: Any, factory: Any, host: Any = None, port: Any = None, **kwargs: Any) -> Any:
        if kwargs.get("sock") is not None:
            address = kwargs["sock"].getpeername()
            check(address[0], address[1])
        else:
            check(host, port)
        return await original_connection(self, factory, host, port, **kwargs)

    # These are process-local runtime hooks, not alternate library definitions.
    # Keep the original signatures through wraps while replacing the attributes.
    setattr(socket, "socketpair", pair)
    setattr(asyncio.BaseEventLoop, "create_connection", connect)
    sys.addaudithook(audit)
    return addresses


@dataclass
class ModelObservation:
    record: dict[str, Any] = field(default_factory=lambda: {
        "at": None, "path": None, "status": None, "usage": None, "reasoning_tokens": None,
        "model": None, "finish_reasons": None, "error_type": None, "seconds": None,
    })
    started: float | None = None
    response: Any = None
    failure: BaseException | None = None


def usage_count(value: Any) -> int | None:
    # Token counts are integers, not booleans or arbitrary JSON numbers. Check
    # the bound without converting to float: huge JSON integers can overflow it.
    return value if type(value) is int and 0 <= value <= MAX_USAGE_COUNT else None


def clock_number(value: Any) -> float | None:
    if type(value) not in (int, float) or not 0 <= value <= MAX_USAGE_COUNT or not math.isfinite(value):
        return None
    return float(value)


def response_metadata(record: dict[str, Any], response: Any) -> None:
    import httpx

    status = response.status_code
    record["status"] = status if type(status) is int and 100 <= status <= 599 else None
    if response.is_stream_consumed is not True:
        return
    try:
        # json() only accesses already buffered content in the installed httpx.
        # A consumed raw stream need not have a buffer; never read it again.
        body = response.json()
    except httpx.ResponseNotRead:
        return
    if not isinstance(body, dict):
        return
    usage = body.get("usage")
    if isinstance(usage, dict):
        counts = {key: count for key in TOKEN_KEYS if (count := usage_count(usage.get(key))) is not None}
        record["usage"] = counts or None
        details = usage.get("completion_tokens_details")
        record["reasoning_tokens"] = usage_count(details.get("reasoning_tokens")) if isinstance(details, dict) else None
    record["model"] = "deepseek-v4-flash" if body.get("model") == "deepseek-v4-flash" else None
    choices = body.get("choices")
    if isinstance(choices, list) and len(choices) <= MAX_FINISH_REASONS:
        record["finish_reasons"] = [
            reason if isinstance(choice, dict) and type(reason := choice.get("finish_reason")) is str
            and reason in FINISH_REASONS else "unknown" for choice in choices
        ]


def failure_type(error: BaseException) -> str:
    # Exception messages, args and custom class names can contain provider data.
    for kind in (asyncio.CancelledError, KeyboardInterrupt, SystemExit):
        if isinstance(error, kind):
            return kind.__name__
    return "Exception"


def finish_observation(root: Path, observation: ModelObservation) -> None:
    try:
        if observation.failure is None:
            response_metadata(observation.record, observation.response)
        else:
            observation.record["error_type"] = failure_type(observation.failure)
        ended = clock_number(time.monotonic())
        if observation.started is not None and ended is not None:
            elapsed = clock_number(ended - observation.started)
            observation.record["seconds"] = round(elapsed, 3) if elapsed is not None else None
    except BaseException:
        observation_failed(root, "metadata")
    write_observation(root, observation.record)


def observe_model_calls(root: Path) -> None:
    """Observe without changing Response identity, streaming, exceptions or cancellation."""
    import httpx

    original = httpx.AsyncClient.send

    @wraps(original)
    async def send(self: Any, request: Any, *args: Any, **kwargs: Any) -> Any:
        try:
            observed = request.url.host == "api.deepseek.com"
        except BaseException:
            observation_failed(root, "metadata")
            observed = False
        if not observed:
            return await original(self, request, *args, **kwargs)
        observation = ModelObservation()
        try:
            observation.record["at"] = clock_number(time.time())
            path = request.url.path
            observation.record["path"] = path if type(path) is str and path in MODEL_PATHS else None
            observation.started = clock_number(time.monotonic())
        except BaseException:
            observation_failed(root, "metadata")
        try:
            observation.response = await original(self, request, *args, **kwargs)
            return observation.response
        except BaseException as error:
            observation.failure = error
            raise
        finally:
            finish_observation(root, observation)

    setattr(httpx.AsyncClient, "send", send)
