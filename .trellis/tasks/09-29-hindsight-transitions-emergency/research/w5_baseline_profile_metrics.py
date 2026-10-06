"""Bounded diagnostic aggregates and read-only Windows resource observations.

No import starts a process, opens data, or imports a model. Instrumented timings
include observer overhead; SQL awaits include transport and scheduler delay.
"""

from __future__ import annotations

import contextvars
import ctypes
import functools
import hashlib
import json
import re
import sys
import time
from collections import Counter
from contextlib import contextmanager
from ctypes import wintypes
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable

import w5_actual_embedding_control as control

MAX_BUCKETS = 256
SAMPLE_SECONDS = 0.5
MAX_SAMPLES = int(control.OVERALL_SECONDS / SAMPLE_SECONDS) + 2


@dataclass
class Metric:
    calls: int = 0
    failures: int = 0
    wall_ns: int = 0
    thread_cpu_ns: int = 0
    exclusive_wall_ns: int = 0
    exclusive_thread_cpu_ns: int = 0


@dataclass
class Frame:
    child_wall_ns: int = 0
    child_cpu_ns: int = 0


class Profile:
    """Only synchronous nested frames subtract children; async walls are inclusive."""

    def __init__(
        self,
        *,
        wall: Callable = time.perf_counter_ns,
        cpu: Callable = time.thread_time_ns,
    ):
        self.wall, self.cpu = wall, cpu
        self.stage: contextvars.ContextVar[tuple[str, ...]] = contextvars.ContextVar(
            "baseline_profile_stage", default=()
        )
        self.frames: list[Frame] = []
        self.codecs: dict[str, Metric] = {}
        self.boundaries: dict[str, Metric] = {}
        self.sql: dict[str, Metric] = {}
        self.body_calls: Counter[str] = Counter()
        self.peak_bytes = self.peak_entries = 0
        self.undo: list[tuple[Any, str, Any]] = []

    def bucket(self, collection: dict[str, Metric], label: str) -> Metric:
        key = "/".join((*self.stage.get(), label))
        if key not in collection:
            assert len(collection) < MAX_BUCKETS, "PROFILE_BUCKET_LIMIT"
            collection[key] = Metric()
        return collection[key]

    def sync(self, label: str, function: Callable) -> Callable:
        @functools.wraps(function)
        def invoke(*args: Any, **kwargs: Any) -> Any:
            metric, frame = self.bucket(self.codecs, label), Frame()
            self.frames.append(frame)
            wall, cpu = self.wall(), self.cpu()
            try:
                return function(*args, **kwargs)
            except BaseException:
                metric.failures += 1
                raise
            finally:
                elapsed_wall, elapsed_cpu = self.wall() - wall, self.cpu() - cpu
                assert self.frames.pop() is frame, "PROFILE_STACK_CORRUPT"
                metric.calls += 1
                metric.wall_ns += elapsed_wall
                metric.thread_cpu_ns += elapsed_cpu
                metric.exclusive_wall_ns += elapsed_wall - frame.child_wall_ns
                metric.exclusive_thread_cpu_ns += elapsed_cpu - frame.child_cpu_ns
                if self.frames:
                    self.frames[-1].child_wall_ns += elapsed_wall
                    self.frames[-1].child_cpu_ns += elapsed_cpu

        return invoke

    def asynchronous(self, label: str, function: Callable) -> Callable:
        @functools.wraps(function)
        async def invoke(*args: Any, **kwargs: Any) -> Any:
            metric = self.bucket(self.boundaries, label)
            token = self.stage.set((*self.stage.get(), label))
            started = self.wall()
            try:
                return await function(*args, **kwargs)
            except BaseException:
                metric.failures += 1
                raise
            finally:
                metric.calls += 1
                metric.wall_ns += self.wall() - started
                self.stage.reset(token)

        return invoke

    def body(self, label: str, function: Callable) -> Callable:
        @functools.wraps(function)
        async def invoke(store: Any, descriptor: Any, *args: Any, **kwargs: Any) -> Any:
            # Count schema categories, never descriptors/IDs/contents. A reader hit
            # is inferred from reader calls minus ordinary full byte validations;
            # calling _identity here would add another serialization per read.
            key = "/".join((*self.stage.get(), label, descriptor.body_schema))
            assert key in self.body_calls or len(self.body_calls) < MAX_BUCKETS, (
                "PROFILE_BODY_BUCKET_LIMIT"
            )
            self.body_calls[key] += 1
            try:
                return await function(store, descriptor, *args, **kwargs)
            finally:
                if type(store).__name__ == "_TransitionValidationReader":
                    self.peak_bytes = max(self.peak_bytes, store._verified_bytes)
                    self.peak_entries = max(self.peak_entries, len(store._verified))

        return invoke

    def replace(self, owner: Any, name: str, replacement: Any) -> None:
        self.undo.append((owner, name, getattr(owner, name)))
        setattr(owner, name, replacement)

    @contextmanager
    def installed(self):
        assert not self.undo, "PROFILE_ALREADY_INSTALLED"
        from hindsight_api.engine import logical_snapshot
        from hindsight_api.engine.application_state import (
            codec,
            commits,
            publication,
            snapshot,
            store,
        )
        from hindsight_api.engine.transfer import current_state_schema
        from hindsight_api.engine.transition_baseline_reads import (
            _TransitionValidationReader,
        )

        synchronous = [
            codec.decode_json,
            codec.json_bytes,
            codec.digest,
            codec.validate_body,
            codec.native_payload_hash,
            codec.tagged_bytes,
            store.parse_model,
            current_state_schema.current_state_hash,
            logical_snapshot._record_from_payload,
        ]
        asynchronous = [
            snapshot._bundle_records,
            snapshot._validate_head,
            commits.current_native,
            publication.load_native_source_evidence,
            logical_snapshot._load_snapshot_source,
        ]
        replacements = {
            id(function): self.sync(function.__name__, function)
            for function in synchronous
        }
        replacements.update(
            {
                id(function): self.asynchronous(function.__name__, function)
                for function in asynchronous
            }
        )
        try:
            # Only already-loaded exact aliases are decorated. No import hooks or
            # production source rewrites; all original arguments and failures pass.
            for module_name, module in list(sys.modules.items()):
                if module is not None and module_name.startswith(
                    "hindsight_api.engine."
                ):
                    for name, value in list(vars(module).items()):
                        replacement = replacements.get(id(value))
                        if replacement is not None:
                            self.replace(module, name, replacement)
            for owner, name, label in (
                (store.ApplicationStateStore, "body_bytes", "full-byte-validation"),
                (store.ApplicationStateStore, "read_body", "decode-schema-and-closure"),
                (_TransitionValidationReader, "body_bytes", "reader-byte-request"),
            ):
                self.replace(owner, name, self.body(label, getattr(owner, name)))
            yield self
        finally:
            for owner, name, value in reversed(self.undo):
                setattr(owner, name, value)
            self.undo.clear()

    def report(self) -> dict[str, Any]:
        assert not self.frames, "PROFILE_INCOMPLETE_FRAME"
        return {
            "meaning": "Diagnostic only. Async boundaries are inclusive. SQL includes server/transport/driver/scheduling. Sync exclusive CPU excludes only nested instrumented functions; instrumentation overhead remains.",
            "codecMetrics": {key: asdict(value) for key, value in self.codecs.items()},
            "asyncBoundaries": {
                key: asdict(value) for key, value in self.boundaries.items()
            },
            "sql": {key: asdict(value) for key, value in self.sql.items()},
            "bodyCalls": dict(self.body_calls),
            "readerPeakVerifiedBytes": self.peak_bytes,
            "readerPeakVerifiedEntries": self.peak_entries,
        }


def validate_sql(query: str) -> str:
    normalized = " ".join(query.split())
    allowed = (
        normalized.upper().startswith("SELECT ")
        or normalized.upper() == "SET LOCAL TIME ZONE 'UTC'"
    )
    forbidden = re.search(
        r"\b(INSERT|UPDATE|DELETE|MERGE|COPY|CREATE|ALTER|DROP|TRUNCATE|LOCK|SET_CONFIG|NEXTVAL|SETVAL|PG_NOTIFY|LO_EXPORT)\b",
        normalized,
        re.I,
    )
    explicit_lock = re.search(
        r"\bFOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b", normalized, re.I
    )
    assert allowed and not forbidden and not explicit_lock and ";" not in normalized, (
        "READ_ONLY_SQL_REFUSED"
    )
    assert len(normalized) <= 8192, "READ_ONLY_SQL_TOO_LONG"
    return normalized


class ReadConnection:
    """The database read-only transaction is independent of this SQL allowlist."""

    backend_type = "postgresql"

    def __init__(self, delegate: Any, profile: Profile | None = None):
        self.delegate, self.profile = delegate, profile
        self.calls = 0

    def parse_json(self, value: Any) -> Any:
        return self.delegate.parse_json(value)

    async def call(self, method: str, query: str, *args: Any, **kwargs: Any) -> Any:
        normalized = validate_sql(query)
        self.calls += 1
        metric = (
            self.profile.bucket(self.profile.sql, method + ":" + normalized)
            if self.profile
            else None
        )
        started = time.perf_counter_ns()
        try:
            kwargs["timeout"] = min(30, kwargs.get("timeout") or 30)
            return await getattr(self.delegate, method)(query, *args, **kwargs)
        except BaseException:
            if metric is not None:
                metric.failures += 1
            raise
        finally:
            if metric is not None:
                metric.calls += 1
                metric.wall_ns += time.perf_counter_ns() - started

    async def fetch(self, query: str, *args: Any, **kwargs: Any) -> Any:
        return await self.call("fetch", query, *args, **kwargs)

    async def fetchrow(self, query: str, *args: Any, **kwargs: Any) -> Any:
        return await self.call("fetchrow", query, *args, **kwargs)

    async def fetchval(self, query: str, *args: Any, **kwargs: Any) -> Any:
        return await self.call("fetchval", query, *args, **kwargs)

    async def execute(self, query: str, *args: Any, **kwargs: Any) -> Any:
        return await self.call("execute", query, *args, **kwargs)


class IoCounters(ctypes.Structure):
    _fields_ = [
        (name, ctypes.c_ulonglong)
        for name in (
            "readOperations",
            "writeOperations",
            "otherOperations",
            "readBytes",
            "writeBytes",
            "otherBytes",
        )
    ]


class MemoryCounters(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("pageFaults", wintypes.DWORD)] + [
        (name, ctypes.c_size_t)
        for name in (
            "peakWorkingSet",
            "workingSet",
            "peakPagedPool",
            "pagedPool",
            "peakNonpagedPool",
            "nonpagedPool",
            "pagefile",
            "peakPagefile",
            "privateBytes",
        )
    ]


def ticks(value: Any) -> int:
    return (value.dwHighDateTime << 32) | value.dwLowDateTime


def resources(identity: Any) -> dict[str, Any]:
    """Read the already verified handle; I/O bytes are not physical disk traffic."""
    kernel, handle = identity.kernel, identity.handle
    stamps = [wintypes.FILETIME() for _ in range(4)]
    assert kernel.GetProcessTimes(handle, *(ctypes.byref(value) for value in stamps)), (
        "RESOURCE_CPU_UNAVAILABLE"
    )
    assert ticks(stamps[0]) == identity.value["creationTicks"], (
        "RESOURCE_IDENTITY_CHANGED"
    )
    result: dict[str, Any] = {
        "kernel100ns": ticks(stamps[2]),
        "user100ns": ticks(stamps[3]),
    }
    io = IoCounters()
    kernel.GetProcessIoCounters.argtypes = [wintypes.HANDLE, ctypes.POINTER(IoCounters)]
    if kernel.GetProcessIoCounters(handle, ctypes.byref(io)):
        result["io"] = {name: getattr(io, name) for name, _ in io._fields_}
    else:
        result["ioUnavailable"] = True
    memory = MemoryCounters()
    memory.cb = ctypes.sizeof(memory)
    kernel.K32GetProcessMemoryInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.POINTER(MemoryCounters),
        wintypes.DWORD,
    ]
    if kernel.K32GetProcessMemoryInfo(handle, ctypes.byref(memory), memory.cb):
        result["memory"] = {
            name: getattr(memory, name)
            for name in ("pageFaults", "workingSet", "privateBytes")
        }
    else:
        result["memoryUnavailable"] = True
    return result


class Sampler:
    """Parent-only fixed-rate observer over exact worker/owned backend identities."""

    def __init__(
        self,
        job: Path,
        *,
        identity_factory: Any = control.ProcessIdentity,
        clock: Callable = time.monotonic,
    ):
        self.job, self.identity_factory, self.clock = job, identity_factory, clock
        self.next_at = 0.0
        self.samples = 0
        self.backend_samples: Counter[str] = Counter()
        self.errors: Counter[str] = Counter()

    def process(self, expected: dict[str, Any]) -> dict[str, Any]:
        identity = self.identity_factory(expected["pid"])
        try:
            assert identity.value == expected, "TELEMETRY_PROCESS_REPLACED"
            return resources(identity)
        finally:
            identity.close()

    def sample(self, phase: dict[str, Any]) -> None:
        now = self.clock()
        if now < self.next_at or self.samples >= MAX_SAMPLES:
            return
        self.next_at = now + SAMPLE_SECONDS
        item: dict[str, Any] = {
            "monotonic": now,
            "phase": phase.get("phase"),
            "pass": phase.get("pass"),
        }
        try:
            worker = control.read_json(self.job / "child.json")
            item["worker"] = self.process(worker)
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.GetSystemTimes.argtypes = [ctypes.POINTER(wintypes.FILETIME)] * 3
            stamps = [wintypes.FILETIME() for _ in range(3)]
            assert kernel.GetSystemTimes(*(ctypes.byref(value) for value in stamps)), (
                "SYSTEM_CPU_UNAVAILABLE"
            )
            item["system100ns"] = dict(
                zip(("idle", "kernelIncludesIdle", "user"), map(ticks, stamps))
            )
            backend_path = self.job / "backend.json"
            if backend_path.exists() and phase.get("phase") == "baseline":
                backend = control.read_json(backend_path)
                pointer = control.read_json(self.job / "clone.json")
                assert (
                    backend["clone"] == pointer["clone"]
                    and backend["pass"] == phase["pass"]
                ), "BACKEND_BINDING_MISMATCH"
                owner = control.owned_pg(pointer)
                assert owner is not None, "BACKEND_OWNER_NOT_LIVE"
                owner.close()
                assert (
                    Path(backend["identity"]["executable"]).resolve()
                    == control.POSTGRES.resolve()
                )
                item["backend"] = self.process(backend["identity"])
                item["backendIdentity"] = backend["identity"]
                self.backend_samples[backend["pass"]] += 1
        except Exception as error:
            # An exiting backend can race a sample. Missing observations remain
            # missing, never zero. A pass with no successful backend sample fails
            # the final observation gate; it is not fabricated as low CPU.
            label = type(error).__name__
            self.errors[label] += 1
            item["observationErrorClass"] = label
        self.samples += 1
        with (self.job / "telemetry.jsonl").open(
            "a", encoding="utf-8", newline="\n"
        ) as stream:
            stream.write(json.dumps(item) + "\n")

    def report(self) -> dict[str, Any]:
        path = self.job / "telemetry.jsonl"
        return {
            "sampleSeconds": SAMPLE_SECONDS,
            "sampleLimit": MAX_SAMPLES,
            "samples": self.samples,
            "backendSamples": dict(self.backend_samples),
            "errors": dict(self.errors),
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest()
            if path.exists()
            else None,
            "meaning": "Cumulative CPU/I/O/memory counters, not physical-disk bytes. System kernel includes idle. Unknown observations are absent; detailed timings include profiler overhead.",
        }
