"""Serve an owned native Hindsight target with real models for D78 actual-data validation.

Control uses a private, content-free JSON file: {"id":"unique", "action":"run"}
launches the actual Core consumer; action "stop" stops only these owned services.
Data, operation evidence, and encrypted credentials are retained after shutdown.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import json
import logging
import math
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from real_hindsight_environment import (
    NATIVE_ROOT, PYTHON, SCRIPT_DIR, TAKI_ROOT, clean_environment, credentials, exclusive_supervisor,
    model_environment, owned_root,
)
from real_hindsight_network import install_guard, observation_status, observe_model_calls
from real_hindsight_job import ADMISSION_LINE, ContainedProcessResult, run_contained_process

PG0 = NATIVE_ROOT / ".venv/Lib/site-packages/pg0/bin/pg0.exe"
CONSUMER_DRAIN_SECONDS = 15
CONSUMER_TERMINATE_SECONDS = 5
SERVER_SHUTDOWN_SECONDS = 45
TASK_CANCEL_SECONDS = 5
SUPERVISOR_EXIT_SECONDS = 5
SUPERVISOR_STOP_SECONDS = 120
_control_stream: Any = None


@dataclass
class TerminalOutcome:
    reason: str
    exit_code: int
    remote_outcome_unknown: bool = True
    consumer_exit_code: int | None = None
    consumer_id: str | None = None
    errors: list[str] = field(default_factory=list)
    services_stopped: dict[str, bool] = field(default_factory=dict)
    process_tree: dict[str, Any] | None = None

    def fail(self, reason: str) -> None:
        if reason not in self.errors:
            self.errors.append(reason)
        self.remote_outcome_unknown = True
        # Preserve the consumer's actual nonzero exit (or an operator stop) even
        # when writing its result or cleaning up a later resource also fails.
        if self.exit_code == 0:
            self.reason, self.exit_code = reason, 1


@dataclass
class ConsumerProgress:
    outcome: TerminalOutcome = field(default_factory=lambda: TerminalOutcome("consumer_exception", 1))
    terminal: asyncio.Event = field(default_factory=asyncio.Event)
    process: asyncio.subprocess.Process | None = None
    exited: asyncio.Task[int] | None = None


@dataclass
class ShutdownRequest:
    event: asyncio.Event = field(default_factory=asyncio.Event)
    signal_number: int | None = None

    def receive_signal(self, number: int, _frame: Any) -> None:
        if self.signal_number is None:
            self.signal_number = number
        self.event.set()


def install_shutdown_signals(shutdown: ShutdownRequest) -> dict[int, Any]:
    if threading.current_thread() is not threading.main_thread():
        return {}
    numbers = [signal.SIGINT, signal.SIGTERM]
    if hasattr(signal, "SIGBREAK"):
        numbers.append(signal.SIGBREAK)
    prior: dict[int, Any] = {}
    try:
        for number in numbers:
            prior[number] = signal.signal(number, shutdown.receive_signal)
    except BaseException:
        for number, handler in prior.items():
            signal.signal(number, handler)
        raise
    return prior


def emit_supervisor_state(state: str) -> bool:
    identity = os.environ.get("TAKI_D78_SUPERVISOR_ID")
    if identity is None or _control_stream is None:
        return True
    if (len(identity) != 32 or any(character not in "0123456789abcdef" for character in identity)
            or state not in ("stopping", "finished")):
        return False
    try:
        _control_stream.write(f"D78-STATE {identity} {state}\n")
        _control_stream.flush()
        return True
    except Exception:
        return False


def generation_stop_requested(root: Path) -> bool:
    identity = os.environ.get("TAKI_D78_SUPERVISOR_ID")
    if identity is None:
        return False
    try:
        value = json.loads((root / f"supervisor-{identity}-stop.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return False
    expected = {"schemaVersion": 1, "supervisorId": identity, "runDirectoryId": root.name, "action": "stop"}
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value != expected:
        raise RuntimeError("D78_SUPERVISOR_STOP_REFUSED")
    return True


def has_completion_proof(root: Path, identity: str) -> bool:
    """Only the current consumer's durable end-of-validation receipt proves completion."""
    def unique_fields(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("D78_COMPLETION_DUPLICATE_FIELD")
            value[key] = item
        return value

    try:
        path = root / f"consumer-{identity}-complete.json"
        status = path.lstat()
        if status.st_file_attributes & 0x400 or status.st_nlink != 1:
            return False
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_fields)
    except (OSError, ValueError):
        return False
    expected = {"schemaVersion": 1, "runDirectoryId": root.name, "consumerId": identity, "state": "complete"}
    return isinstance(value, dict) and type(value.get("schemaVersion")) is int and value == expected


def write_json(path: Path, value: dict[str, Any]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def supervisor_record(root: Path, outcome: TerminalOutcome, state: str) -> dict[str, Any]:
    launcher = os.environ.get("TAKI_D78_LAUNCHER_PID")
    return {**asdict(outcome), "state": state, "pid": os.getpid(), "run_id": root.name,
            "launcher_pid": int(launcher) if launcher is not None else None,
            "supervisor_id": os.environ.get("TAKI_D78_SUPERVISOR_ID"), "at": time.time()}


def configure_logging(root: Path) -> None:
    class PrivateFormatter(logging.Formatter):
        def format(self, record: logging.LogRecord) -> str:
            # Never format record.msg/args or exception values: provider and
            # validation failures may embed full memory text or model responses.
            event: dict[str, Any] = {"at": record.created, "level": record.levelname,
                                     "logger": record.name[:120], "line": record.lineno}
            if record.exc_info and record.exc_info[0] is not None:
                event["error_type"] = record.exc_info[0].__name__
                event["frames"] = [{"file": Path(frame.filename).name, "line": frame.lineno, "function": frame.name}
                                   for frame in traceback.extract_tb(record.exc_info[2])[-12:]]
            return json.dumps(event)

    handler = logging.FileHandler(root / "native.log", encoding="utf-8")
    handler.setFormatter(PrivateFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    # Request bodies and provider debug logging are deliberately absent. Native
    # domain diagnostics stay in the already-private run directory.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)


class ContentFreeStream(io.TextIOBase):
    """Third-party direct prints are counted, not persisted as unknown sensitive payloads."""
    def __init__(self) -> None:
        self.characters = 0

    @property
    def encoding(self) -> str:
        return "utf-8"

    def write(self, text: str) -> int:
        self.characters += len(text)
        return len(text)

    def flush(self) -> None:
        pass


def pg_command(root: Path, name: str, action: str, extra: list[str]) -> dict[str, Any] | None:
    environment = clean_environment(root.parent)
    with (root / f"{action}.stdout.log").open("w", encoding="utf-8") as out:
        with (root / f"{action}.stderr.log").open("w", encoding="utf-8") as err:
            result = subprocess.run(
                [str(PG0), action, "--name", name, *extra], env=environment,
                stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                creationflags=subprocess.CREATE_NO_WINDOW, timeout=90, check=False,
            )
    if result.returncode:
        raise RuntimeError(f"D78_OWNED_PG_{action.upper()}_FAILED")
    if action == "info":
        return json.loads((root / "info.stdout.log").read_text(encoding="utf-8"))
    return None


def require_native_paths(root: Path) -> Path:
    native = root / "native"
    for path in (native, native / "data"):
        try:
            attributes = path.lstat().st_file_attributes
        except FileNotFoundError:
            continue
        if attributes & 0x400:
            raise RuntimeError("D78_PG_RESOURCE_LINK_REFUSED")
    return native


def require_postgres_owner(root: Path, owner: dict[str, Any]) -> Path:
    native = require_native_paths(root)
    if owner.get("name") != "taki-d78-real-" + root.name or Path(owner["root"]).resolve() != native.resolve():
        raise RuntimeError("D78_PG_OWNERSHIP_REFUSED")
    return native


async def configure_database(native: Path, owner: dict[str, Any], private: dict[str, str]) -> None:
    import asyncpg

    # The password is durable before ALTER ROLE. Trying it first also recovers a
    # process interruption between ALTER ROLE and the ownership-marker update.
    async def connect(password: str) -> Any:
        return await asyncpg.connect(host="127.0.0.1", port=owner["port"], user="taki_real",
                                     password=password, database="taki_real", timeout=15)

    rotation_needed = False
    failure: BaseException | None = None
    try:
        connection = await connect(private["pg_password"])
    except asyncpg.InvalidPasswordError:
        if owner.get("credential_rotated"):
            raise
        connection = await connect("empty-d78-bootstrap")
        rotation_needed = True
    try:
        actual = Path(await connection.fetchval("SHOW data_directory")).resolve()
        if actual != (native / "data").resolve():
            raise RuntimeError("D78_OWNED_PG_DATA_MISMATCH")
        if rotation_needed:
            # Quote server-side rather than formatting a secret into a SQL log.
            await connection.execute("SELECT set_config('taki.bootstrap_password', $1, false)", private["pg_password"])
            await connection.execute("DO $body$ BEGIN EXECUTE format('ALTER ROLE taki_real PASSWORD %L', "
                                     "current_setting('taki.bootstrap_password')); END $body$;")
            await connection.execute("RESET taki.bootstrap_password")
        owner["credential_rotated"] = True
        write_json(native / "ownership.json", owner)
        await connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await connection.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    except BaseException as error:
        failure = error
        raise
    finally:
        try:
            await connection.close()
        except BaseException:
            if failure is None:
                raise
            logging.error("D78_DATABASE_CLOSE_FAILED")


def start_postgres(root: Path, private: dict[str, str]) -> dict[str, Any]:
    native = require_native_paths(root)
    path = native / "ownership.json"
    name = "taki-d78-real-" + root.name
    registry = Path(os.environ["USERPROFILE"]) / ".pg0/instances" / name
    if path.exists():
        owner = json.loads(path.read_text(encoding="utf-8"))
        require_postgres_owner(root, owner)
    else:
        if native.exists() or registry.exists():
            raise RuntimeError("D78_PG_EXISTING_RESOURCE_REFUSED")
        native.mkdir()
        owner = {"name": name, "root": str(native.resolve()), "registry": str(registry.resolve()),
                 "started": False, "stopped": False, "credential_rotated": False}
        write_json(path, owner)
    # Keep early authentication diagnostics ASCII. On this Windows cluster a
    # localized wrong-password response became ConnectionDoesNotExistError;
    # lc_messages=C preserves InvalidPasswordError and the existing exact
    # durable/bootstrap credential recovery without broadening its exception gate.
    arguments = ["--data-dir", str(native / "data"), "--username", "taki_real",
                 "--password", "empty-d78-bootstrap", "--database", "taki_real",
                 "-c", "listen_addresses=127.0.0.1", "-c", "lc_messages=C"]
    try:
        pg_command(native, name, "start", arguments)
        info = pg_command(native, name, "info", ["--output", "json"])
        if info is None or Path(info["data_dir"]).resolve() != (native / "data").resolve():
            raise RuntimeError("D78_PG_IDENTITY_REFUSED")
        owner.update(port=int(info["port"]), started=True, stopped=False)
        write_json(path, owner)
        asyncio.run(configure_database(native, owner, private))
    except BaseException:
        try:
            stop_postgres(root, owner)
        except BaseException:
            # Never guess a PID when the authoritative pg0 identity is unreadable.
            try:
                write_json(root / "cleanup-required.json", {"native_name": name, "owned_root": str(native),
                                                             "reason": "D78_PG_IDENTITY_OR_STOP_UNAVAILABLE"})
            except BaseException:
                logging.error("D78_PG_CLEANUP_MARKER_FAILED")
            logging.error("D78_PG_IDENTITY_OR_STOP_UNAVAILABLE")
        raise
    return owner


def stop_postgres(root: Path, owner: dict[str, Any]) -> None:
    native = require_postgres_owner(root, owner)
    info = pg_command(native, owner["name"], "info", ["--output", "json"])
    if info is None or Path(info["data_dir"]).resolve() != (native / "data").resolve():
        raise RuntimeError("D78_PG_STOP_IDENTITY_REFUSED")
    pg_command(native, owner["name"], "stop", [])
    owner["stopped"] = True
    write_json(native / "ownership.json", owner)


async def probe_models(root: Path) -> None:
    from hindsight_api.engine.cross_encoder import LocalSTCrossEncoder
    from hindsight_api.engine.embeddings import LocalSTEmbeddings

    embeddings = LocalSTEmbeddings()
    await embeddings.initialize()
    vectors = embeddings.encode(["Local model readiness check."])
    assert len(vectors) == 1 and len(vectors[0]) == embeddings.dimension
    assert all(math.isfinite(value) for value in vectors[0])
    reranker = LocalSTCrossEncoder()
    await reranker.initialize()
    scores = await reranker.predict([("model readiness", "Local model readiness check.")])
    assert len(scores) == 1 and math.isfinite(scores[0])
    write_json(root / "model-preflight.json", {"embeddings": embeddings.model_name, "dimensions": embeddings.dimension,
                                              "reranker": reranker.model_name, "finite_outputs": True})


async def consume(root: Path, endpoint: str, private: dict[str, str], identity: str, stop: asyncio.Event,
                  *, progress: ConsumerProgress | None = None) -> TerminalOutcome:
    progress = progress if progress is not None else ConsumerProgress()
    stopping: asyncio.Task[bool] | None = None
    try:
        # A previous complete receipt is evidence, never a launch token. In
        # particular, a new process cannot inherit an old process's completion.
        try:
            (root / f"consumer-{identity}-complete.json").lstat()
            completed_before_launch = True
        except FileNotFoundError:
            completed_before_launch = False
        if completed_before_launch:
            progress.outcome = TerminalOutcome("consumer_identity_reused", 1)
            return progress.outcome
        environment = clean_environment(root)
        environment.update({"TAKI_D78_REAL_DATA": "1", "TAKI_D78_OWNED_ENDPOINT": endpoint,
                            "TAKI_D78_API_KEY": private["api_key"], "TAKI_D78_RUN_ID": root.name,
                            "TAKI_D78_CONSUMER_ID": identity})
        log = root / ("consumer-" + identity + ".log")
        # Never truncate a previous failed attempt's content-free log either.
        with log.open("x", encoding="utf-8") as out:
            process = await asyncio.create_subprocess_exec(
                "node", str(SCRIPT_DIR / "current-cutover-real-data.ts"), "run", str(root / "validation.sqlite"), endpoint,
                cwd=TAKI_ROOT, env=environment, stdin=asyncio.subprocess.PIPE, stdout=out, stderr=subprocess.STDOUT,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            progress.process = process
            exited = progress.exited = asyncio.create_task(process.wait())
            stopping = asyncio.create_task(stop.wait())
            write_json(root / "consumer-result.json", {"id": identity, "pid": process.pid, "state": "running",
                                                       "supervisor_id": os.environ.get("TAKI_D78_SUPERVISOR_ID"),
                                                       "supervisor_pid": os.getpid(), "run_id": root.name,
                                                       "remote_outcome_unknown": True})
            await asyncio.wait({exited, stopping}, return_when=asyncio.FIRST_COMPLETED)
            stop_requested = stop.is_set()
            if not exited.done():
                progress.outcome = TerminalOutcome("operator_stop", 130)
                progress.terminal.set()
            forced = await stop_consumer(process, exited, outcome=progress.outcome) if not exited.done() else False
            result = await exited
            complete = (result == 0 and not stop_requested and not forced and not progress.outcome.errors
                        and has_completion_proof(root, identity))
            if stop_requested:
                reason, exit_code = "operator_stop", 130
            elif result != 0:
                reason, exit_code = "consumer_exit_nonzero", result
            else:
                reason, exit_code = ("consumer_complete", 0) if complete else ("consumer_completion_unproven", 1)
            errors = progress.outcome.errors
            progress.outcome = TerminalOutcome(reason, exit_code, not complete, result, errors=errors)
            progress.terminal.set()
            write_json(root / "consumer-result.json", {"id": identity, "pid": process.pid, "state": "finished",
                                                       "exit_code": result, "reason": reason,
                                                       "supervisor_id": os.environ.get("TAKI_D78_SUPERVISOR_ID"),
                                                       "supervisor_pid": os.getpid(), "run_id": root.name,
                                                       "stop_requested": stop_requested, "forced_stop": forced,
                                                       "remote_outcome_unknown": not complete,
                                                       "usage_observation": observation_status()})
        return progress.outcome
    except BaseException as error:
        progress.outcome.fail("consumer_metadata_failed" if isinstance(error, OSError) else "consumer_exception")
        # Notify the supervisor before draining a still-active Node handle. A
        # broken metadata disk must not leave native maintenance running for the
        # duration of that drain, and this signal does not require a disk write.
        progress.terminal.set()
        raise
    finally:
        progress.terminal.set()
        try:
            if progress.process is not None and progress.exited is not None and not progress.exited.done():
                await stop_consumer(progress.process, progress.exited, outcome=progress.outcome)
        finally:
            if progress.process is not None:
                progress.outcome.consumer_exit_code = progress.process.returncode
                if progress.process.stdin is not None:
                    progress.process.stdin.close()
            if stopping is not None:
                stopping.cancel()
                await asyncio.gather(stopping, return_exceptions=True)


async def stop_consumer(process: asyncio.subprocess.Process, exited: asyncio.Task[int],
                        *, outcome: TerminalOutcome | None = None) -> bool:
    async def request_and_drain() -> None:
        if process.stdin is not None:
            try:
                process.stdin.write(b"abort\n")
                await process.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                pass
        await asyncio.shield(exited)

    interrupted: BaseException | None = None
    try:
        await asyncio.wait_for(request_and_drain(), timeout=CONSUMER_DRAIN_SECONDS)
        return False
    except BaseException as error:
        if not isinstance(error, TimeoutError) and outcome is not None:
            outcome.fail("consumer_abort_channel_failed")
        if not isinstance(error, Exception):
            interrupted = error
    # Only the subprocess handle created above may be terminated. A broken stdin
    # transport (not just a timeout) must still reach this fallback. Preserve
    # cancellation only after the owned handle has had its bounded reap attempt.
    for terminate in (process.terminate, process.kill):
        try:
            terminate()
        except ProcessLookupError:
            pass
        except Exception:
            if outcome is not None:
                outcome.fail("consumer_termination_failed")
        try:
            await asyncio.wait_for(asyncio.shield(exited), timeout=CONSUMER_TERMINATE_SECONDS)
            if interrupted is not None:
                raise interrupted
            return True
        except TimeoutError:
            continue
    if interrupted is not None:
        raise interrupted
    raise RuntimeError("D78_CONSUMER_TERMINATION_INCOMPLETE")


def record_lifecycle(path: Path, value: dict[str, Any], outcome: TerminalOutcome) -> bool:
    """Diagnostic storage can fail, but it cannot veto owned-resource shutdown."""
    try:
        write_json(path, value)
        return True
    except Exception:
        outcome.fail("metadata_write_failed")
        if path.name == "ready.json":
            # Keep the failed readiness snapshot as evidence while removing its
            # canonical advertisement. This fallback needs no new file contents
            # and can therefore work even when the volume cannot accept a write.
            try:
                if path.exists():
                    path.rename(path.with_name(f"ready-unavailable-{time.time_ns()}.json"))
            except OSError:
                outcome.fail("readiness_invalidation_failed")
        return False


async def drain_consumer(active: asyncio.Task[TerminalOutcome] | None, progress: ConsumerProgress | None,
                         outcome: TerminalOutcome) -> None:
    if active is None or progress is None:
        outcome.services_stopped["consumer"] = True
        return
    budget = CONSUMER_DRAIN_SECONDS + 2 * CONSUMER_TERMINATE_SECONDS + TASK_CANCEL_SECONDS
    done, _ = await asyncio.wait({active}, timeout=budget)
    if not done:
        outcome.fail("consumer_drain_timeout")
        # This is still the exact handle launched by this invocation. Never
        # enumerate or terminate a process based only on a persisted PID.
        if progress.process is not None and progress.process.returncode is None:
            try:
                progress.process.kill()
            except ProcessLookupError:
                pass
        active.cancel()
        done, _ = await asyncio.wait({active}, timeout=TASK_CANCEL_SECONDS)
    if done:
        try:
            active.result()
        except BaseException:
            outcome.fail("consumer_exception")
    # Task completion is not process completion: the coroutine may have failed
    # during its first cleanup attempt. Retain and use the actual child handle.
    if progress.process is not None and progress.process.returncode is None:
        try:
            if progress.exited is None:
                progress.exited = asyncio.create_task(progress.process.wait())
            await stop_consumer(progress.process, progress.exited, outcome=outcome)
        except BaseException:
            outcome.fail("consumer_termination_failed")
    outcome.consumer_exit_code = (progress.process.returncode if progress.process is not None
                                  else progress.outcome.consumer_exit_code)
    for error in progress.outcome.errors:
        outcome.fail(error)
    outcome.services_stopped["consumer"] = bool(done) and (
        progress.process is None or progress.process.returncode is not None)
    if not outcome.services_stopped["consumer"]:
        outcome.fail("consumer_not_stopped")


async def shutdown_server(server: Any, task: asyncio.Task[None] | None, listener: socket.socket,
                          outcome: TerminalOutcome) -> None:
    try:
        if task is not None:
            done, _ = await asyncio.wait({task}, timeout=SERVER_SHUTDOWN_SECONDS)
            if not done:
                outcome.fail("native_shutdown_timeout")
                server.force_exit = True
                task.cancel()
                done, _ = await asyncio.wait({task}, timeout=TASK_CANCEL_SECONDS)
            if done:
                try:
                    task.result()
                except BaseException:
                    outcome.fail("native_server_exception")
            lifespan = getattr(server, "lifespan", None)
            if getattr(lifespan, "shutdown_failed", False):
                outcome.fail("native_lifespan_shutdown_failed")
        outcome.services_stopped["http"] = task is None or task.done()
    finally:
        listener.close()


async def serve(root: Path, owner: dict[str, Any], private: dict[str, str],
                listener: socket.socket, *, shutdown: ShutdownRequest | None = None) -> TerminalOutcome:
    import uvicorn
    from hindsight_api.api.http import create_app
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.extensions.builtin.tenant import ApiKeyTenantExtension

    endpoint = f"http://127.0.0.1:{listener.getsockname()[1]}"
    baseline_tasks = asyncio.all_tasks()
    memory: Any = None
    server: Any = None
    close_task: asyncio.Task[None] | None = None
    server_task: asyncio.Task[None] | None = None
    active: asyncio.Task[TerminalOutcome] | None = None
    terminal: asyncio.Task[bool] | None = None
    progress: ConsumerProgress | None = None
    consumer_stop = asyncio.Event()
    requested = asyncio.create_task(shutdown.event.wait()) if shutdown is not None else None
    outcome = TerminalOutcome("supervisor_exception", 1)
    try:
        # Use the normal broker/poller and native lifespan. Track its close call
        # so partial startup or failed lifespan shutdown still closes the engine
        # exactly once; ordinary successful shutdown retains the native order.
        memory = MemoryEngine(tenant_extension=ApiKeyTenantExtension({"api_key": private["api_key"]}))
        native_close = memory.close

        async def close_memory() -> None:
            nonlocal close_task
            if close_task is None:
                close_task = asyncio.create_task(native_close())
            await asyncio.shield(close_task)

        setattr(memory, "close", close_memory)
        server = uvicorn.Server(uvicorn.Config(create_app(memory), log_config=None, access_log=False,
                                               lifespan="on", timeout_graceful_shutdown=30))
        # Uvicorn re-raises received signals after its own lifespan exits. The
        # outer supervisor still owes PostgreSQL cleanup at that point, so its
        # own handlers govern the whole resource lifetime instead.
        setattr(server, "capture_signals", nullcontext)
        server_task = asyncio.create_task(server.serve(sockets=[listener]))
        applied = root / "applied-control.json"
        prior_control = json.loads(applied.read_text(encoding="utf-8")) if applied.exists() else {}
        last_id: str | None = prior_control.get("id")
        ready = False
        while True:
            if generation_stop_requested(root):
                outcome = TerminalOutcome("supervisor_stop", 130)
                break
            if shutdown is not None and shutdown.event.is_set():
                outcome = TerminalOutcome("operator_signal", 128 + (shutdown.signal_number or signal.SIGINT),
                                          active is not None)
                break
            if server_task.done():
                outcome = TerminalOutcome("native_server_exited", 1)
                break
            if active is not None and progress is not None and (active.done() or progress.terminal.is_set()):
                outcome = progress.outcome
                # A consumer task can fail before reaching its own progress
                # marker (including an unexpected task exception).
                if active.done():
                    try:
                        outcome = active.result()
                    except BaseException:
                        outcome.fail("consumer_exception")
                break
            if not observation_status()["complete"]:
                outcome = TerminalOutcome("usage_observation_incomplete", 1)
                break
            if server.started and not ready:
                write_json(root / "ready.json", {"pid": os.getpid(), "endpoint": endpoint, "pg_port": owner["port"],
                                                  "native_name": owner["name"], "state": "ready", "at": time.time()})
                ready = True
            control = root / "control.json"
            if control.exists():
                command = json.loads(control.read_text(encoding="utf-8"))
                identity = command.get("id", "")
                if not identity or not identity.replace("-", "").isalnum():
                    raise RuntimeError("D78_CONTROL_ID_REFUSED")
                if identity != last_id:
                    if command.get("action") == "stop":
                        consumer_stop.set()
                        outcome = TerminalOutcome("operator_stop", 130, active is not None)
                        write_json(applied, {"id": identity, "action": "stop", "at": time.time()})
                        break
                    if command.get("action") != "run" or active is not None:
                        raise RuntimeError("D78_CONTROL_ACTION_REFUSED")
                    if ready:
                        # A stale ready marker cannot survive any consumer exit,
                        # including one whose terminal metadata cannot be written.
                        write_json(root / "ready.json", {"pid": os.getpid(), "endpoint": endpoint,
                                                          "state": "running", "consumer_id": identity,
                                                          "at": time.time()})
                        last_id = identity
                        write_json(applied, {"id": identity, "action": "run", "at": time.time()})
                        progress = ConsumerProgress()
                        active = asyncio.create_task(consume(root, endpoint, private, identity, consumer_stop,
                                                             progress=progress))
                        terminal = asyncio.create_task(progress.terminal.wait())
            waiters = {server_task}
            if requested is not None:
                waiters.add(requested)
            if active is not None and terminal is not None:
                waiters.update((active, terminal))
            await asyncio.wait(waiters, timeout=0.5, return_when=asyncio.FIRST_COMPLETED)
    except asyncio.CancelledError:
        outcome = TerminalOutcome("supervisor_cancelled", 130)
    except Exception:
        outcome.fail("supervisor_exception")
        logging.error("D78_SUPERVISOR_EXCEPTION")
    finally:
        if progress is not None:
            outcome.consumer_id = last_id
        # Start HTTP shutdown before awaiting the consumer or any storage. A
        # disconnected consumer is not allowed to leave native verification and
        # the ordinary scheduler alive until the finite Bank lease expires.
        consumer_stop.set()
        if not emit_supervisor_state("stopping"):
            outcome.fail("supervisor_signal_failed")
        if server is not None:
            server.should_exit = True
            for transport in getattr(server, "servers", ()):
                try:
                    transport.close()
                except Exception:
                    outcome.fail("http_listener_close_failed")
        record_lifecycle(root / "ready.json", {"pid": os.getpid(), "endpoint": endpoint,
                                               "state": "stopping", "reason": outcome.reason,
                                               "at": time.time()}, outcome)
        record_lifecycle(root / "supervisor-result.json", supervisor_record(root, outcome, "stopping"), outcome)
        cleanups = await asyncio.gather(drain_consumer(active, progress, outcome),
                                         shutdown_server(server, server_task, listener, outcome),
                                         return_exceptions=True)
        for cleanup in cleanups:
            if isinstance(cleanup, BaseException):
                outcome.fail("owned_cleanup_failed")
        if terminal is not None:
            terminal.cancel()
            await asyncio.gather(terminal, return_exceptions=True)
        # This coroutine runs on the supervisor's own event loop. Tasks created
        # after the baseline belong to its API/engine; a failed native lifespan
        # must not strand its worker, maintenance heartbeat or model request.
        remaining = asyncio.all_tasks() - baseline_tasks - {asyncio.current_task(), close_task}
        for task in remaining:
            task.cancel()
        pending: set[asyncio.Task[Any]] = set()
        if remaining:
            _, pending = await asyncio.wait(remaining, timeout=TASK_CANCEL_SECONDS)
            if pending:
                outcome.fail("native_tasks_not_stopped")
        outcome.services_stopped["background_tasks"] = not pending
        try:
            if memory is not None:
                if close_task is None:
                    close_task = asyncio.create_task(native_close())
                done, _ = await asyncio.wait({close_task}, timeout=CONSUMER_DRAIN_SECONDS)
                if not done:
                    close_task.cancel()
                    await asyncio.wait({close_task}, timeout=TASK_CANCEL_SECONDS)
                    raise RuntimeError("D78_ENGINE_CLOSE_TIMEOUT")
                close_task.result()
            outcome.services_stopped["engine"] = True
        except BaseException:
            outcome.services_stopped["engine"] = False
            outcome.fail("engine_close_failed")
        finally:
            stopped = all(outcome.services_stopped.get(key, False)
                          for key in ("consumer", "http", "engine", "background_tasks"))
            record_lifecycle(root / "ready.json", {"pid": os.getpid(), "endpoint": endpoint,
                                                   "state": "stopping" if stopped else "stop_incomplete",
                                                   "reason": outcome.reason, "at": time.time()}, outcome)
    return outcome


def child(root: Path, probe: bool) -> int:
    with exclusive_supervisor(root):
        return owned_child(root, probe)


def run_server(root: Path, owner: dict[str, Any], private: dict[str, str],
               listener: socket.socket, shutdown: ShutdownRequest) -> TerminalOutcome:
    # asyncio.run waits without a bound for every pending task at loop teardown.
    # This process owns the loop: retain a finite final cancellation window so a
    # broken native task can never prevent the outer PostgreSQL finally block.
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    outcome = TerminalOutcome("supervisor_exception", 1)
    try:
        outcome = loop.run_until_complete(serve(root, owner, private, listener, shutdown=shutdown))
    finally:
        pending = asyncio.all_tasks(loop)
        for task in pending:
            task.cancel()
        if pending:
            _, remaining = loop.run_until_complete(asyncio.wait(pending, timeout=TASK_CANCEL_SECONDS))
            if remaining:
                outcome.fail("event_loop_tasks_not_stopped")
                outcome.services_stopped["background_tasks"] = False
                record_lifecycle(root / "ready.json", {"pid": os.getpid(), "state": "stop_incomplete",
                                                       "reason": outcome.reason, "at": time.time()}, outcome)
        loop.close()
        asyncio.set_event_loop(None)
    return outcome


def owned_child(root: Path, probe: bool) -> int:
    global _control_stream
    standard_out, standard_error = sys.stdout, sys.stderr
    previous_control, _control_stream = _control_stream, standard_out
    stdout, stderr = ContentFreeStream(), ContentFreeStream()
    sys.stdout, sys.stderr = stdout, stderr
    owner: dict[str, Any] | None = None
    outcome = TerminalOutcome("supervisor_exception", 1)
    outcome.services_stopped = {key: True for key in ("consumer", "http", "engine", "background_tasks", "postgres")}
    shutdown = ShutdownRequest()
    prior_signals: dict[int, Any] = {}
    try:
        prior_signals = install_shutdown_signals(shutdown)
        private = credentials(root)
        configure_logging(root)
        if not probe:
            # Retire stale readiness before allocating any new owned service.
            write_json(root / "ready.json", {"pid": os.getpid(), "state": "starting", "at": time.time()})
        if shutdown.event.is_set() or generation_stop_requested(root):
            outcome.reason = "operator_signal" if shutdown.event.is_set() else "supervisor_stop"
            outcome.exit_code = 128 + (shutdown.signal_number or signal.SIGINT)
        elif probe:
            install_guard(None, None, model_access=False)
            asyncio.run(probe_models(root))
            outcome.reason, outcome.exit_code, outcome.remote_outcome_unknown = "model_preflight_complete", 0, False
        else:
            outcome.services_stopped["postgres"] = False
            owner = start_postgres(root, private)
            os.environ["HINDSIGHT_API_DATABASE_URL"] = (
                f"postgresql://taki_real:{private['pg_password']}@127.0.0.1:{owner['port']}/taki_real")
            os.environ["HINDSIGHT_API_WORKER_ID"] = owner["name"]
            metadata = root / "http-owner.json"
            prior = json.loads(metadata.read_text(encoding="utf-8")) if metadata.exists() else {}
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                listener.bind(("127.0.0.1", int(prior.get("port", 0))))
                listener.listen(128)
                listener.setblocking(False)
                write_json(metadata, {"run_id": root.name, "port": listener.getsockname()[1]})
                install_guard(owner["port"], listener, model_access=True)
                observe_model_calls(root)
                outcome.services_stopped.update(http=False, engine=False, background_tasks=False)
                outcome = run_server(root, owner, private, listener, shutdown)
    except (KeyboardInterrupt, asyncio.CancelledError):
        outcome.reason, outcome.exit_code, outcome.remote_outcome_unknown = "supervisor_cancelled", 130, True
    except Exception:
        outcome.fail("supervisor_exception")
        logging.error("D78_SUPERVISOR_EXCEPTION")
    finally:
        try:
            if not emit_supervisor_state("stopping"):
                outcome.fail("supervisor_signal_failed")
            if owner is not None:
                try:
                    stop_postgres(root, owner)
                    outcome.services_stopped["postgres"] = True
                except Exception:
                    outcome.services_stopped["postgres"] = False
                    outcome.fail("postgres_stop_failed")
                    record_lifecycle(root / "cleanup-required.json", {"native_name": owner["name"],
                                                                       "reason": "D78_PG_STOP_FAILED"}, outcome)
            if not observation_status()["complete"]:
                outcome.fail("usage_observation_incomplete")
            if not probe:
                stopped = all(outcome.services_stopped.get(key, False)
                              for key in ("consumer", "http", "engine", "background_tasks", "postgres"))
                record_lifecycle(root / "ready.json", {"pid": os.getpid(),
                                                       "state": "stopped" if stopped else "stop_incomplete",
                                                       "reason": outcome.reason, "at": time.time()}, outcome)
                if not stopped:
                    record_lifecycle(root / "cleanup-required.json", {"reason": "D78_OWNED_CLEANUP_INCOMPLETE",
                                                                       "services_stopped": outcome.services_stopped}, outcome)
            record_lifecycle(root / "native-output-summary.json", {"stdout_characters_suppressed": stdout.characters,
                                                                    "stderr_characters_suppressed": stderr.characters,
                                                                    "usage_observation": observation_status()}, outcome)
            # A final write is attempted only after all owned cleanup. If it
            # fails, its nonzero process exit is still the caller's signal.
            record_lifecycle(root / "supervisor-result.json", supervisor_record(root, outcome, "finished"), outcome)
            if not emit_supervisor_state("finished"):
                outcome.fail("supervisor_signal_failed")
        finally:
            try:
                for number, handler in prior_signals.items():
                    signal.signal(number, handler)
            finally:
                sys.stdout, sys.stderr = standard_out, standard_error
                _control_stream = previous_control
    return outcome.exit_code


def current_child_record(root: Path, identity: str, pid: int, worker_pid: int | None = None) -> dict[str, Any] | None:
    path = root / "supervisor-result.json"
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if not isinstance(value, dict):
        raise RuntimeError("D78_SUPERVISOR_RECORD_INVALID")
    if (value.get("supervisor_id") != identity or value.get("launcher_pid") != pid
            or type(value.get("launcher_pid")) is not int or value.get("run_id") != root.name):
        return None
    if worker_pid is not None and (type(value.get("pid")) is not int or value.get("pid") != worker_pid):
        return None
    return value


def recover_postgres(root: Path) -> bool:
    """Recheck pg0 truth under the root lock, never trust a stopped flag or a PID."""
    native = require_native_paths(root)
    path = native / "ownership.json"
    try:
        status = path.lstat()
    except FileNotFoundError:
        registry = Path(os.environ["USERPROFILE"]) / ".pg0/instances" / ("taki-d78-real-" + root.name)
        if native.exists() or registry.exists():
            raise RuntimeError("D78_PG_RECOVERY_OWNERSHIP_MISSING")
        return True
    if status.st_file_attributes & 0x400 or status.st_nlink != 1:
        raise RuntimeError("D78_PG_OWNERSHIP_LINK_REFUSED")
    owner = json.loads(path.read_text(encoding="utf-8"))
    require_postgres_owner(root, owner)
    info = pg_command(native, owner["name"], "info", ["--output", "json"])
    if info is None or Path(info["data_dir"]).resolve() != (native / "data").resolve():
        raise RuntimeError("D78_PG_RECOVERY_IDENTITY_REFUSED")
    if info.get("running") is True:
        stop_postgres(root, owner)
    elif info.get("running") is not False:
        raise RuntimeError("D78_PG_RECOVERY_STATE_UNPROVEN")
    return True


def process_outcome(root: Path, result: ContainedProcessResult, identity: str, *, probe: bool) -> TerminalOutcome:
    code = result.returncode if result.returncode is not None else 1
    outcome = TerminalOutcome("supervisor_process_exited", code or 1)
    record = current_child_record(root, identity, result.pid, result.worker_pid) if result.pid is not None else None
    if record is not None:
        # Copy only closed, known primary reasons, never arbitrary persisted text.
        known = {"consumer_exit_nonzero", "consumer_completion_unproven", "consumer_identity_reused",
                 "consumer_exception", "operator_stop", "operator_signal", "supervisor_stop", "supervisor_cancelled",
                 "native_server_exited", "usage_observation_incomplete", "supervisor_exception",
                 "metadata_write_failed", "postgres_stop_failed", "engine_close_failed"}
        if record.get("reason") in known:
            outcome.reason = record["reason"]
        consumer_id = record.get("consumer_id")
        if isinstance(consumer_id, str) and consumer_id.replace("-", "").isalnum():
            outcome.consumer_id = consumer_id
        consumer_code = record.get("consumer_exit_code")
        if type(consumer_code) is int:
            outcome.consumer_exit_code = consumer_code
        services = record.get("services_stopped")
        complete = (record.get("state") == "finished" and type(record.get("exit_code")) is int
                    and record.get("exit_code") == 0
                    and record.get("remote_outcome_unknown") is False and record.get("errors") == []
                    and isinstance(services, dict)
                    and all(services.get(key) is True for key in ("consumer", "http", "engine", "background_tasks", "postgres")))
        if code == 0 and complete and ((probe and record.get("reason") == "model_preflight_complete")
                                      or (not probe and record.get("reason") == "consumer_complete"
                                          and outcome.consumer_exit_code == 0 and outcome.consumer_id is not None
                                          and has_completion_proof(root, outcome.consumer_id))):
            outcome.reason = "model_preflight_complete" if probe else "consumer_complete"
            outcome.exit_code, outcome.remote_outcome_unknown = 0, False
    if result.reason != "child_exited":
        outcome.reason = result.reason
        outcome.exit_code, outcome.remote_outcome_unknown = code or 1, True
    outcome.process_tree = asdict(result.cleanup)
    if result.cleanup.forced:
        outcome.fail("process_tree_forced")
    if not result.cleanup.all_exited or not result.cleanup.handle_closed or result.cleanup.errors:
        outcome.fail("process_tree_cleanup_incomplete")
    for error in result.errors:
        outcome.fail(error)
    return outcome


def run_owned_process(root: Path, command: list[str], environment: dict[str, str],
                      output: Any, *, probe: bool = False) -> int:
    identity = uuid.uuid4().hex
    environment = {**environment, "TAKI_D78_SUPERVISOR_ID": identity, "TAKI_D78_JOB_GATE": "1"}
    marker_outcome = TerminalOutcome("supervisor_process_exited", 1)
    shutdown = ShutdownRequest()
    prior_signals = install_shutdown_signals(shutdown)
    stop_sent = False

    def request_stop() -> None:
        nonlocal stop_sent
        if not stop_sent:
            write_json(root / f"supervisor-{identity}-stop.json",
                       {"schemaVersion": 1, "supervisorId": identity, "runDirectoryId": root.name, "action": "stop"})
            stop_sent = True

    def observe(pid: int, worker_pid: int) -> str:
        record = current_child_record(root, identity, pid, worker_pid)
        if shutdown.event.is_set():
            request_stop()
            return "finished" if record is not None and record.get("state") == "finished" else "stopping"
        if record is not None:
            return record.get("state", "running")
        return "running"

    def stopping(result: ContainedProcessResult) -> None:
        record_lifecycle(root / f"supervisor-{identity}-stopping.json",
                         {"state": "stopping", "supervisor_id": identity, "pid": result.pid,
                          "reason": result.reason, "exit_code": result.returncode,
                          "remote_outcome_unknown": True, "at": time.time()}, marker_outcome)
        # Prefer the existing graceful pg0 stop even after an abrupt worker exit.
        # A still-live owner (ours or another launcher's) prevents this recovery;
        # the Job can only force its own descendants after that refusal.
        try:
            with exclusive_supervisor(root):
                recover_postgres(root)
        except Exception:
            marker_outcome.fail("postgres_graceful_stop_unavailable")

    try:
        result = run_contained_process(command, environment=environment, cwd=str(TAKI_ROOT), output=output,
                                       observe=observe, stopping=stopping, request_stop=request_stop,
                                       exit_timeout=SUPERVISOR_EXIT_SECONDS, stop_timeout=SUPERVISOR_STOP_SECONDS)
    finally:
        for number, handler in prior_signals.items():
            signal.signal(number, handler)
    outcome = TerminalOutcome("supervisor_process_exited", result.returncode or 1)
    try:
        # A second launcher may now own the directory. It has no relationship to
        # this Job, so failure to acquire the lock forbids touching its PG/ready.
        with exclusive_supervisor(root):
            try:
                outcome = process_outcome(root, result, identity, probe=probe)
            except Exception:
                outcome.fail("supervisor_result_invalid")
            outcome.process_tree = asdict(result.cleanup)
            if shutdown.event.is_set() and outcome.reason not in ("consumer_exit_nonzero",):
                outcome.reason = "operator_signal"
                outcome.exit_code, outcome.remote_outcome_unknown = 128 + (shutdown.signal_number or signal.SIGINT), True
            contained = result.cleanup.all_exited and result.cleanup.handle_closed
            outcome.services_stopped = {key: contained for key in ("consumer", "http", "engine", "background_tasks")}
            try:
                outcome.services_stopped["postgres"] = recover_postgres(root)
            except Exception:
                outcome.services_stopped["postgres"] = False
                outcome.fail("postgres_recovery_unproven")
            for error in marker_outcome.errors:
                outcome.fail(error)
            stopped = all(outcome.services_stopped.values())
            if not probe:
                record_lifecycle(root / "ready.json", {"pid": result.pid, "supervisor_id": identity,
                                                       "state": "stopped" if stopped else "stop_incomplete",
                                                       "reason": outcome.reason, "at": time.time()}, outcome)
            final = {**asdict(outcome), "state": "finished", "pid": result.pid, "supervisor_id": identity,
                     "launcher_pid": result.pid, "worker_pid": result.worker_pid,
                     "launcher_exit_code": result.returncode,
                     "run_id": root.name, "outer_completed": True, "at": time.time()}
            if not stopped:
                record_lifecycle(root / "cleanup-required.json", final, outcome)
            # Per-invocation evidence above is retained; this is only the latest
            # summary and must never authorize replay of the consumer.
            record_lifecycle(root / "supervisor-result.json", {**final, **asdict(outcome)}, outcome)
            if not record_lifecycle(root / f"supervisor-{identity}-result.json", {**final, **asdict(outcome)}, outcome):
                record_lifecycle(root / "supervisor-result.json", {**final, **asdict(outcome)}, outcome)
    except Exception:
        outcome.reason = "root_ownership_unavailable"
        outcome.exit_code, outcome.remote_outcome_unknown = result.returncode or 1, True
        record_lifecycle(root / f"supervisor-{identity}-cleanup-required.json",
                         {"reason": outcome.reason, "remote_outcome_unknown": True,
                          "process_tree": asdict(result.cleanup)}, outcome)
    return outcome.exit_code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--probe-models", action="store_true")
    arguments = parser.parse_args()
    if os.environ.get("TAKI_D78_REAL_CHILD") == "1":
        # The outer process assigns our actual handle before sending this line.
        # EOF, a partial write, or direct child-mode invocation admits nothing.
        identity = os.environ.get("TAKI_D78_SUPERVISOR_ID", "")
        if (os.environ.get("TAKI_D78_JOB_GATE") != "1" or len(identity) != 32
                or any(character not in "0123456789abcdef" for character in identity)):
            return 1
        print(f"D78-WORKER {os.getpid()} {identity}", flush=True)
        if sys.stdin.readline(32) != ADMISSION_LINE.decode("ascii"):
            return 1
        launcher = sys.stdin.readline(16)
        if not launcher.endswith("\n") or not launcher[:-1].isascii() or not launcher[:-1].isdecimal():
            return 1
        if not 0 < int(launcher[:-1]) <= 0xFFFFFFFF or str(int(launcher[:-1])) != launcher[:-1]:
            return 1
        os.environ["TAKI_D78_LAUNCHER_PID"] = launcher[:-1]
        return child(owned_root(arguments.root), arguments.probe_models)
    root = owned_root(arguments.root)
    environment = model_environment(root)
    log = root / ("model-probe-process.log" if arguments.probe_models else "native-process.log")
    print(json.dumps({"root": str(root), "process_log": str(log)}), flush=True)
    with log.open("a", encoding="utf-8") as out:
        result = run_owned_process(root, [str(PYTHON), str(Path(__file__).resolve()), *sys.argv[1:]],
                                   environment, out, probe=arguments.probe_models)
    print(json.dumps({"native_exit": result}), flush=True)
    return result


if __name__ == "__main__":
    if isinstance(sys.stdout, io.TextIOWrapper):
        sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
