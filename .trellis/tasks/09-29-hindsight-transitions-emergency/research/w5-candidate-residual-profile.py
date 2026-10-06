"""PARENT-RUN ONLY: aggregate stage SQL and codec CPU on one fresh pre-apply clone.

Default invocation describes the probe without importing the clone runner.
--run-reviewed-clone is only for the parent after review. This diagnostic keeps
the existing clone/apply semantics, bounds, guards and cleanup; it does not
change production code, skip checks, reuse a committed clone, or call a model.
Instrumentation adds overhead, so its latency is not an acceptance benchmark.
"""

from __future__ import annotations

import argparse
import contextvars
import functools
import hashlib
import importlib.util
import json
import sys
import time
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable


HERE = Path(__file__).resolve().parent
RUNNER = HERE / "w5-reentry-candidate-native-clone.py"
RUNNER_HASH = "a58da783153ab5e0052310584877b410e0303f473543ea3147eb6e203867b03e"
SOURCE_MANIFEST = HERE / "w5-candidate-baseline-source-manifest.json"
SOURCE_MANIFEST_HASH = "766ff65824c15aaf081be13c4becfc8ffe83d960e3dd7b5e0e15e2b326a12a5b"


@dataclass
class Metric:
    calls: int = 0
    wall_ns: int = 0
    cpu_ns: int = 0
    self_wall_ns: int = 0
    self_cpu_ns: int = 0


@dataclass
class Frame:
    child_wall_ns: int = 0
    child_cpu_ns: int = 0


class Profile:
    def __init__(self, clone: Any) -> None:
        self.clone = clone
        self.sql: dict[str, Metric] = {}
        self.codecs: dict[str, Metric] = {}
        self.async_calls: dict[str, Metric] = {}
        self.body_calls: Counter[str] = Counter()
        self.stack: list[Frame] = []
        self.baseline_invocations = 0
        self.active_baseline: contextvars.ContextVar[int] = contextvars.ContextVar("profile_baseline", default=0)
        self.reader_calls: Counter[str] = Counter()
        self.reader_max_bytes: dict[int, int] = {}
        self.reader_max_entries: dict[int, int] = {}
        self.apply_cpu_ms = 0.0
        self.installed = False

    def stage(self) -> str:
        stage = "/".join(self.clone.STAGES.get()) or "outside-apply"
        return stage + (f"[baseline:{self.active_baseline.get()}]" if self.active_baseline.get() else "")

    def sync(self, name: str, function: Callable) -> Callable:
        @functools.wraps(function)
        def invoke(*args: Any, **kwargs: Any) -> Any:
            metric = self.codecs.setdefault(self.stage() + ":" + name, Metric())
            frame = Frame()
            self.stack.append(frame)
            wall, cpu = time.perf_counter_ns(), time.process_time_ns()
            try:
                return function(*args, **kwargs)
            finally:
                elapsed_wall = time.perf_counter_ns() - wall
                elapsed_cpu = time.process_time_ns() - cpu
                self.stack.pop()
                metric.calls += 1
                metric.wall_ns += elapsed_wall
                metric.cpu_ns += elapsed_cpu
                metric.self_wall_ns += elapsed_wall - frame.child_wall_ns
                metric.self_cpu_ns += elapsed_cpu - frame.child_cpu_ns
                if self.stack:
                    self.stack[-1].child_wall_ns += elapsed_wall
                    self.stack[-1].child_cpu_ns += elapsed_cpu
        return invoke

    def async_boundary(self, name: str, function: Callable) -> Callable:
        @functools.wraps(function)
        async def invoke(*args: Any, **kwargs: Any) -> Any:
            token = self.clone.STAGES.set((*self.clone.STAGES.get(), name))
            metric = self.async_calls.setdefault(self.stage(), Metric())
            started = time.perf_counter_ns()
            try:
                return await function(*args, **kwargs)
            finally:
                metric.calls += 1
                metric.wall_ns += time.perf_counter_ns() - started
                self.clone.STAGES.reset(token)
        return invoke

    def body_boundary(self, name: str, function: Callable) -> Callable:
        @functools.wraps(function)
        async def invoke(store: Any, descriptor: Any, *args: Any, **kwargs: Any) -> Any:
            # Schema is a closed producer enum. Do not capture identity, payload,
            # descriptor bytes, query arguments, results or exception messages.
            self.body_calls[f"{self.stage()}:{name}:{descriptor.body_schema}"] += 1
            is_reader = type(store).__name__ == "_TransitionBaselineReader"
            # A baseline ordinal avoids retaining the reader or confusing a
            # recycled Python object ID with the preceding invocation.
            slot = self.active_baseline.get() if is_reader else None
            if slot is not None:
                self.reader_calls[f"{slot}:{name}"] += 1
            try:
                return await function(store, descriptor, *args, **kwargs)
            finally:
                if slot is not None:
                    self.reader_max_bytes[slot] = max(self.reader_max_bytes.get(slot, 0), store._verified_bytes)
                    self.reader_max_entries[slot] = max(self.reader_max_entries.get(slot, 0), len(store._verified))
        return invoke

    def install(self) -> None:
        if self.installed:
            raise RuntimeError("PROFILE_ALREADY_INSTALLED")
        self.installed = True
        from hindsight_api.engine import logical_snapshot
        from hindsight_api.engine.application_state import codec, commits, publication, snapshot, store
        from hindsight_api.engine.transfer import current_state_schema, transition_delta_application
        from hindsight_api.engine.transition_baseline_reads import _TransitionBaselineReader

        sync_functions = [codec.decode_json, codec.json_bytes, codec.digest, codec.validate_body,
                          codec.native_payload_hash, codec.tagged_bytes, store.parse_model,
                          current_state_schema.current_state_hash, logical_snapshot._record_from_payload]
        async_functions = [snapshot._bundle_records, snapshot._validate_head, commits.current_native,
                           publication.load_native_source_evidence, logical_snapshot._load_snapshot_source,
                           transition_delta_application._body_and_command]
        replacements = {
            id(function): self.sync(function.__module__ + "." + function.__name__, function)
            for function in sync_functions
        }
        replacements.update({
            id(function): self.async_boundary(function.__name__, function) for function in async_functions
        })
        # Patch only already-loaded aliases by exact function identity, preserving
        # ordinary behavior and all arguments. No production file is rewritten.
        for module_name, module in list(sys.modules.items()):
            if module is not None and module_name.startswith("hindsight_api."):
                for key, value in list(vars(module).items()):
                    replacement = replacements.get(id(value))
                    if replacement is not None:
                        setattr(module, key, replacement)
        store.ApplicationStateStore.body_bytes = self.body_boundary("full-body-bytes", store.ApplicationStateStore.body_bytes)
        store.ApplicationStateStore.read_body = self.body_boundary("decode-and-schema", store.ApplicationStateStore.read_body)
        _TransitionBaselineReader.body_bytes = self.body_boundary("reader-body-bytes", _TransitionBaselineReader.body_bytes)

    def snapshot(self) -> dict[str, Any]:
        return {
            "meaning": "Diagnostic aggregates; wrapper overhead is included. Awaited SQL is not database CPU. Codec self CPU excludes nested instrumented codecs only.",
            "applyProcessCpuMs": self.apply_cpu_ms,
            "sqlByStage": {key: asdict(value) for key, value in self.sql.items()},
            "codecByStage": {key: asdict(value) for key, value in self.codecs.items()},
            "asyncBoundaries": {key: asdict(value) for key, value in self.async_calls.items()},
            "bodyCalls": dict(self.body_calls),
            "readerCalls": dict(self.reader_calls),
            "readerPeakVerifiedBytes": self.reader_max_bytes,
            "readerPeakVerifiedEntries": self.reader_max_entries,
        }


def install_connection_profile(clone: Any, profile: Profile) -> None:
    original = clone.instrument_connection

    def instrument(base: Any) -> Any:
        timed = original(base)

        class Connection:
            def __getattr__(self, name: str) -> Any:
                return getattr(timed, name)

            async def call(self, method: str, query: str, *args: Any, **kwargs: Any) -> Any:
                key = profile.stage() + ":" + method + ":" + " ".join(query.split())
                metric = profile.sql.setdefault(key, Metric())
                started = time.perf_counter_ns()
                try:
                    return await getattr(timed, method)(query, *args, **kwargs)
                finally:
                    metric.calls += 1
                    metric.wall_ns += time.perf_counter_ns() - started

            async def execute(self, query: str, *args: Any, **kwargs: Any) -> Any:
                return await self.call("execute", query, *args, **kwargs)

            async def executemany(self, query: str, *args: Any, **kwargs: Any) -> Any:
                return await self.call("executemany", query, *args, **kwargs)

            async def fetch(self, query: str, *args: Any, **kwargs: Any) -> Any:
                return await self.call("fetch", query, *args, **kwargs)

            async def fetchrow(self, query: str, *args: Any, **kwargs: Any) -> Any:
                return await self.call("fetchrow", query, *args, **kwargs)

            async def fetchval(self, query: str, *args: Any, **kwargs: Any) -> Any:
                return await self.call("fetchval", query, *args, **kwargs)

        return Connection()

    clone.instrument_connection = instrument


def verify_source() -> None:
    assert hashlib.sha256(RUNNER.read_bytes()).hexdigest() == RUNNER_HASH
    assert hashlib.sha256(SOURCE_MANIFEST.read_bytes()).hexdigest() == SOURCE_MANIFEST_HASH
    for row in json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))["files"]:
        assert hashlib.sha256(Path(row["path"]).read_bytes()).hexdigest() == row["sha256"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    args = parser.parse_args()
    if not args.run_reviewed_clone:
        print("Description only. Parent review required before --run-reviewed-clone. One fresh clone; one unchanged apply; 60s observation/180s bound; stage SQL, process CPU, codec CPU and reader counts; no acceptance latency claim.")
        return
    verify_source()
    spec = importlib.util.spec_from_file_location("w5_reviewed_residual_clone", RUNNER)
    assert spec is not None and spec.loader is not None
    clone = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(clone)
    profile = Profile(clone)
    install_connection_profile(clone, profile)
    original_timed = clone.timed

    def timed(name: str, function: Callable) -> Callable:
        wrapped = original_timed(name, function)
        if name == "baseline":
            async def baseline(*args: Any, **kwargs: Any) -> Any:
                profile.baseline_invocations += 1
                token = profile.active_baseline.set(profile.baseline_invocations)
                try:
                    return await wrapped(*args, **kwargs)
                finally:
                    profile.active_baseline.reset(token)
            return baseline
        if name != "full-apply":
            return wrapped
        profile.install()

        async def apply(*args: Any, **kwargs: Any) -> Any:
            cpu = time.process_time_ns()
            try:
                return await wrapped(*args, **kwargs)
            finally:
                profile.apply_cpu_ms = (time.process_time_ns() - cpu) / 1_000_000
                clone.REPORT["residualProfile"] = profile.snapshot()
        return apply

    clone.timed = timed
    original_write = clone.write_json

    def write_json(path: Path, value: Any) -> None:
        if path.name == "result.json":
            clone.REPORT["residualProfile"] = profile.snapshot()
            clone.REPORT["residualProfileSourceSha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
            clone.REPORT["frozenRepairManifestSha256"] = SOURCE_MANIFEST_HASH
        original_write(path, value)

    clone.write_json = write_json
    try:
        clone.main()
    finally:
        verify_source()


if __name__ == "__main__":
    main()
