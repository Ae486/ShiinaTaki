"""Focused regressions for real-data harness ownership, privacy and observer isolation.

Provider responses here test instrumentation only. They never enter migration
evidence, and no provider, native target or user database is contacted.
"""

from __future__ import annotations

import asyncio
import ctypes
import json
import logging
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from ctypes import wintypes
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest

import real_hindsight_environment as environment
import real_hindsight_network as network
import real_hindsight_job as jobs
import run_real_hindsight as harness


class LifecycleFixture:
    """Exercise the real supervisor and Node handles without constructing native resources."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, root: Path) -> None:
        self.root = root
        self.processes: list[asyncio.subprocess.Process] = []
        self.environments: list[dict[str, str]] = []
        self.events: list[str] = []
        self.timed_out = False
        self.on_tick: Callable[[], None] = lambda: None
        self.on_spawn: Callable[[asyncio.subprocess.Process], None] = lambda _process: None
        self.exit_api = False
        self.fail_api = False
        self.api_closed = False
        self.engine_closed = False
        self.pg_stopped = False
        fixture = self

        class Engine:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def close(self) -> None:
                fixture.events.append("engine_closed")
                fixture.engine_closed = True

        class Server:
            def __init__(self, config: SimpleNamespace) -> None:
                self.started = False
                self.should_exit = False
                self.force_exit = False
                self.engine = config.app

            async def serve(self, **_kwargs: object) -> None:
                self.started = True
                deadline = asyncio.get_running_loop().time() + 2
                try:
                    while not self.should_exit:
                        fixture.on_tick()
                        if fixture.exit_api:
                            if fixture.fail_api:
                                raise RuntimeError("private-api-failure")
                            return
                        if asyncio.get_running_loop().time() >= deadline:
                            fixture.timed_out = True
                            return
                        await asyncio.sleep(0.005)
                    fixture.events.append("api_shutdown_requested")
                    await self.engine.close()
                finally:
                    fixture.api_closed = True

        modules = {
            "uvicorn": SimpleNamespace(Server=Server, Config=lambda app, **_kwargs: SimpleNamespace(app=app)),
            "hindsight_api.api.http": SimpleNamespace(create_app=lambda memory: memory),
            "hindsight_api.engine.memory_engine": SimpleNamespace(MemoryEngine=Engine),
            "hindsight_api.extensions.builtin.tenant": SimpleNamespace(ApiKeyTenantExtension=lambda _config: None),
        }
        for name, module in modules.items():
            monkeypatch.setitem(sys.modules, name, module)
        monkeypatch.setattr(harness, "credentials", lambda _root: {"api_key": "test-only", "pg_password": "test-only"})
        monkeypatch.setattr(harness, "configure_logging", lambda _root: None)
        monkeypatch.setattr(harness, "start_postgres", lambda *_args: {"name": "test-owned", "port": 9})
        monkeypatch.setattr(harness, "stop_postgres", self.stop_postgres)
        monkeypatch.setattr(harness, "install_guard", lambda *_args, **_kwargs: None)
        monkeypatch.setattr(harness, "observe_model_calls", lambda _root: None)
        monkeypatch.setattr(harness, "observation_status", lambda: {"complete": True, "write_errors": 0})
        monkeypatch.setenv("HINDSIGHT_API_DATABASE_URL", "test-initial")
        monkeypatch.setenv("HINDSIGHT_API_WORKER_ID", "test-initial")
        harness.write_json(root / "control.json", {"id": "test-run", "action": "run"})

    def stop_postgres(self, *_args: object) -> None:
        self.events.append("pg_stopped")
        self.pg_stopped = True

    def node(self, monkeypatch: pytest.MonkeyPatch, program: str) -> None:
        original_spawn = asyncio.create_subprocess_exec

        async def spawn(*_args: object, **kwargs: Any) -> asyncio.subprocess.Process:
            self.environments.append(kwargs["env"])
            process = await original_spawn("node", "-e", program, str(self.root), **kwargs)
            self.processes.append(process)
            self.on_spawn(process)
            return process

        monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)

    def result(self) -> dict[str, Any]:
        return json.loads((self.root / "supervisor-result.json").read_text(encoding="utf-8"))

    def assert_stopped(self) -> None:
        assert not self.timed_out, "supervisor waited for the test watchdog instead of stopping automatically"
        assert self.api_closed and self.engine_closed and self.pg_stopped
        assert all(process.returncode is not None for process in self.processes)
        assert json.loads((self.root / "ready.json").read_text(encoding="utf-8"))["state"] == "stopped"


def completion_proof(root: Path, **changes: object) -> dict[str, object]:
    return {"schemaVersion": 1, "runDirectoryId": root.name, "consumerId": "test-run", "state": "complete", **changes}


def node_exit(code: int, proof: dict[str, object] | str | None = None) -> str:
    program = ""
    if proof is not None:
        value = proof if isinstance(proof, str) else json.dumps(proof)
        program = ("require('node:fs').writeFileSync(require('node:path').join(process.argv[1],"
                   f"'consumer-test-run-complete.json'),{json.dumps(value)});")
    return program + f"process.exit({code})"


def test_supervisor_reentry_is_refused_before_resources_are_touched(tmp_path: Path) -> None:
    child = "from pathlib import Path; from real_hindsight_environment import exclusive_supervisor; " \
            "ctx=exclusive_supervisor(Path(__import__('sys').argv[1])); ctx.__enter__()"
    process_environment = environment.clean_environment(tmp_path)
    with environment.exclusive_supervisor(tmp_path):
        result = subprocess.run([sys.executable, "-c", child, str(tmp_path)], env=process_environment,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, encoding="utf-8", timeout=10,
                                creationflags=subprocess.CREATE_NO_WINDOW, check=False)
        assert result.returncode != 0
        assert "D78_SUPERVISOR_ALREADY_RUNNING" in result.stderr
    with environment.exclusive_supervisor(tmp_path):
        pass


def test_logging_never_formats_private_messages_or_exception_values(tmp_path: Path) -> None:
    before = logging.getLogger().handlers[:]
    before_level = logging.getLogger().level
    try:
        harness.configure_logging(tmp_path)
        try:
            raise ValueError("private-provider-response")
        except ValueError:
            logging.exception("private-memory %s", "private-api-key")
        for handler in logging.getLogger().handlers:
            handler.flush()
        value = (tmp_path / "native.log").read_text(encoding="utf-8")
        assert "private-provider-response" not in value
        assert "private-memory" not in value
        assert "private-api-key" not in value
        assert json.loads(value)["error_type"] == "ValueError"
        assert json.loads(value)["frames"]
    finally:
        for handler in logging.getLogger().handlers:
            handler.close()
        logging.getLogger().handlers = before
        logging.getLogger().setLevel(before_level)


@pytest.mark.parametrize("provider_fails", [False, True])
def test_usage_disk_failure_preserves_exact_provider_result(monkeypatch: pytest.MonkeyPatch,
                                                          tmp_path: Path, provider_fails: bool) -> None:
    calls = 0
    original_error = RuntimeError("provider test failure")
    response = httpx.Response(200, json={"model": "deepseek-v4-flash", "usage": {"total_tokens": 3}})

    async def original_send(_client: object, _request: object, **_kwargs: object) -> httpx.Response:
        nonlocal calls
        calls += 1
        if provider_fails:
            raise original_error
        return response

    monkeypatch.setattr(httpx.AsyncClient, "send", original_send)
    monkeypatch.setattr(network, "_observation_errors", 0)
    network.observe_model_calls(tmp_path)
    monkeypatch.setattr(Path, "open", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("full disk")))

    async def run() -> None:
        async with httpx.AsyncClient() as client:
            request = client.build_request("POST", "https://api.deepseek.com/v1/chat/completions")
            if provider_fails:
                with pytest.raises(RuntimeError) as caught:
                    await client.send(request)
                assert caught.value is original_error
            else:
                assert await client.send(request) is response

    asyncio.run(run())
    assert calls == 1
    assert network.observation_status() == {"complete": False, "write_errors": 1,
                                             "metadata_errors": 0, "serialization_errors": 0}


def test_owned_node_is_drained_after_consumer_state_write_failure(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path) -> None:
    original_spawn = asyncio.create_subprocess_exec
    started: list[asyncio.subprocess.Process] = []
    child = "process.stdin.on('data',()=>process.exit(0)); setInterval(()=>{},1000)"

    async def spawn(*_args: object, **kwargs: Any) -> asyncio.subprocess.Process:
        process = await original_spawn("node", "-e", child, **kwargs)
        started.append(process)
        return process

    def refuse_write(*_args: object) -> None:
        raise OSError("controlled metadata failure")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(harness, "write_json", refuse_write)

    async def run() -> None:
        with pytest.raises(OSError, match="controlled metadata failure"):
            await harness.consume(tmp_path, "http://127.0.0.1:9", {"api_key": "test-only"}, "failure", asyncio.Event())
        assert len(started) == 1
        assert started[0].returncode == 0

    asyncio.run(run())


def test_malformed_provider_metadata_does_not_replace_a_response(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path) -> None:
    response = httpx.Response(200, json={"model": {"private": "private-response"},
                                        "usage": {"completion_tokens": True, "private-key": 123},
                                        "choices": [{"finish_reason": {"private": "private-response"}}]})

    async def original_send(_client: object, _request: object, **_kwargs: object) -> httpx.Response:
        return response

    monkeypatch.setattr(httpx.AsyncClient, "send", original_send)
    network.observe_model_calls(tmp_path)

    async def run() -> None:
        async with httpx.AsyncClient() as client:
            request = client.build_request("POST", "https://api.deepseek.com/v1/chat/completions")
            assert await client.send(request) is response

    asyncio.run(run())
    text = (tmp_path / "model-usage.jsonl").read_text(encoding="utf-8")
    assert "private-response" not in text and "private-key" not in text
    assert json.loads(text)["finish_reasons"] == ["unknown"]


@pytest.mark.parametrize("root_constant", ["EXPECTED_ROOT", "RETEST_ROOT", "SUPERVISED_RETEST_ROOT"])
def test_fixed_run_root_cannot_be_a_junction(monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
                                           root_constant: str) -> None:
    target = tmp_path / "target"
    target.mkdir()
    (target / "validation.sqlite").touch()
    link = tmp_path / "linked-run"
    # A directory junction needs no developer-mode symlink privilege on Windows.
    command = "$ErrorActionPreference='Stop'\nNew-Item -ItemType Junction -Path $env:TAKI_D78_TEST_LINK -Target $env:TAKI_D78_TEST_TARGET | Out-Null"
    child_environment = environment.clean_environment(tmp_path)
    child_environment.update(TAKI_D78_TEST_LINK=str(link), TAKI_D78_TEST_TARGET=str(target))
    result = subprocess.run(["pwsh", "-NoProfile", "-Command", command], env=child_environment,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
                            creationflags=subprocess.CREATE_NO_WINDOW, check=False)
    assert result.returncode == 0
    monkeypatch.setattr(environment, root_constant, link)
    try:
        with pytest.raises(RuntimeError, match="D78_REAL_ROOT_LINK_REFUSED"):
            environment.owned_root(str(link))
    finally:
        # Remove only the known junction itself, never recurse into its target.
        cleanup = "$ErrorActionPreference='Stop'\n$item=Get-Item -LiteralPath $env:TAKI_D78_TEST_LINK\nif (-not ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Expected owned test junction' }\nRemove-Item -LiteralPath $env:TAKI_D78_TEST_LINK"
        subprocess.run(["pwsh", "-NoProfile", "-Command", cleanup], env=child_environment,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10,
                       creationflags=subprocess.CREATE_NO_WINDOW, check=True)


@pytest.mark.parametrize("exit_code", [1, 7])
def test_nonzero_child_automatically_stops_every_owned_service(monkeypatch: pytest.MonkeyPatch,
                                                            tmp_path: Path, exit_code: int) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(exit_code))
    assert harness.owned_child(tmp_path, False) == exit_code
    fixture.assert_stopped()
    assert len(fixture.processes) == 1
    result = fixture.result()
    assert result["reason"] == "consumer_exit_nonzero"
    assert result["consumer_exit_code"] == exit_code
    assert result["remote_outcome_unknown"] is True
    assert json.loads((tmp_path / "consumer-result.json").read_text())["remote_outcome_unknown"] is True


def test_complete_child_stops_services_and_requires_its_durable_proof(monkeypatch: pytest.MonkeyPatch,
                                                                   tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(0, completion_proof(tmp_path)))
    assert harness.owned_child(tmp_path, False) == 0
    fixture.assert_stopped()
    assert fixture.environments[0]["TAKI_D78_CONSUMER_ID"] == "test-run"
    assert fixture.result()["reason"] == "consumer_complete"
    assert fixture.result()["remote_outcome_unknown"] is False


@pytest.mark.parametrize("invalid_proof", ["missing", "bad-json", "wrong-id", "wrong-run", "bool-version", "extra", "duplicate"])
def test_zero_exit_without_exact_completion_proof_fails_closed(monkeypatch: pytest.MonkeyPatch,
                                                             tmp_path: Path, invalid_proof: str) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    proof: dict[str, object] | str | None = completion_proof(tmp_path)
    if invalid_proof == "missing":
        proof = None
    elif invalid_proof == "bad-json":
        proof = "{"
    elif invalid_proof == "duplicate":
        proof = '{"schemaVersion":1,' + json.dumps(completion_proof(tmp_path))[1:]
    else:
        changes = {"wrong-id": {"consumerId": "prior-run"}, "wrong-run": {"runDirectoryId": "other-root"},
                   "bool-version": {"schemaVersion": True}, "extra": {"extra": "untrusted"}}
        proof = completion_proof(tmp_path, **changes[invalid_proof])
    fixture.node(monkeypatch, node_exit(0, proof))
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert fixture.result()["reason"] == "consumer_completion_unproven"
    assert fixture.result()["remote_outcome_unknown"] is True


def test_nonzero_exit_does_not_trust_a_completion_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(7, completion_proof(tmp_path)))
    assert harness.owned_child(tmp_path, False) == 7
    fixture.assert_stopped()
    assert fixture.result()["remote_outcome_unknown"] is True


def test_existing_completion_identity_is_never_overwritten_or_dispatched(monkeypatch: pytest.MonkeyPatch,
                                                                      tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(0))
    path = tmp_path / "consumer-test-run-complete.json"
    path.write_text(json.dumps(completion_proof(tmp_path)), encoding="utf-8")
    before = path.read_bytes()
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert not fixture.processes
    assert path.read_bytes() == before
    assert fixture.result()["reason"] == "consumer_identity_reused"


def test_late_run_control_cannot_dispatch_a_second_consumer(monkeypatch: pytest.MonkeyPatch,
                                                         tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(7))

    def next_command() -> None:
        if fixture.processes and fixture.processes[0].returncode is not None:
            harness.write_json(tmp_path / "control.json", {"id": "test-run-2", "action": "run"})

    fixture.on_tick = next_command
    assert harness.owned_child(tmp_path, False) == 7
    fixture.assert_stopped()
    assert len(fixture.processes) == 1


def test_operator_stop_during_active_child_is_interrupted_not_success(monkeypatch: pytest.MonkeyPatch,
                                                                    tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000)")

    def stop() -> None:
        if fixture.processes:
            harness.write_json(tmp_path / "control.json", {"id": "operator-stop", "action": "stop"})

    fixture.on_tick = stop
    assert harness.owned_child(tmp_path, False) == 130
    fixture.assert_stopped()
    assert len(fixture.processes) == 1
    assert fixture.processes[0].returncode == 0
    assert fixture.result()["reason"] == "operator_stop"
    assert fixture.result()["remote_outcome_unknown"] is True


@pytest.mark.parametrize("raise_api", [False, True])
def test_api_completion_while_consumer_active_is_a_supervisor_failure(monkeypatch: pytest.MonkeyPatch,
                                                                    tmp_path: Path, raise_api: bool) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000)")
    fixture.fail_api = raise_api

    def exit_api() -> None:
        if fixture.processes:
            fixture.exit_api = True

    fixture.on_tick = exit_api
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert fixture.result()["reason"] == "native_server_exited"
    assert fixture.result()["remote_outcome_unknown"] is True


def test_consumer_task_exception_cannot_bypass_service_cleanup(monkeypatch: pytest.MonkeyPatch,
                                                            tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)

    async def failure(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("private-task-exception")

    monkeypatch.setattr(harness, "consume", failure)
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert fixture.result()["reason"] == "consumer_exception"
    assert "private-task-exception" not in (tmp_path / "supervisor-result.json").read_text()


@pytest.mark.parametrize("target", ["ready", "consumer-running", "consumer-finished", "supervisor-finished", "summary"])
def test_metadata_failure_still_stops_owned_resources_and_fails(monkeypatch: pytest.MonkeyPatch,
                                                              tmp_path: Path, target: str) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(0, completion_proof(tmp_path)))
    original_write = harness.write_json

    def fail_write(path: Path, value: dict[str, object]) -> None:
        match = ((target == "ready" and path.name == "ready.json" and value.get("state") == "ready")
                 or (target == "consumer-running" and path.name == "consumer-result.json"
                     and value.get("state") == "running")
                 or (target == "consumer-finished" and path.name == "consumer-result.json"
                     and value.get("state") == "finished")
                 or (target == "supervisor-finished" and path.name == "supervisor-result.json"
                     and value.get("state") == "finished")
                 or (target == "summary" and path.name == "native-output-summary.json"))
        if match:
            raise OSError("controlled metadata failure")
        original_write(path, value)

    monkeypatch.setattr(harness, "write_json", fail_write)
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert len(fixture.processes) <= 1


def test_nonzero_exit_survives_a_terminal_result_write_failure(monkeypatch: pytest.MonkeyPatch,
                                                            tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(7))
    original_write = harness.write_json

    def fail_write(path: Path, value: dict[str, object]) -> None:
        if path.name == "consumer-result.json" and value.get("state") == "finished":
            raise OSError("controlled result failure")
        original_write(path, value)

    monkeypatch.setattr(harness, "write_json", fail_write)
    assert harness.owned_child(tmp_path, False) == 7
    fixture.assert_stopped()
    assert fixture.result()["remote_outcome_unknown"] is True


def test_stop_forces_and_reaps_an_unresponsive_owned_node(monkeypatch: pytest.MonkeyPatch,
                                                        tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.resume();setInterval(()=>{},1000)")
    monkeypatch.setattr(harness, "CONSUMER_DRAIN_SECONDS", 0.05)

    def stop() -> None:
        if fixture.processes:
            harness.write_json(tmp_path / "control.json", {"id": "operator-stop", "action": "stop"})

    fixture.on_tick = stop
    assert harness.owned_child(tmp_path, False) == 130
    fixture.assert_stopped()
    assert len(fixture.processes) == 1
    result = json.loads((tmp_path / "consumer-result.json").read_text())
    assert result["forced_stop"] is True
    assert result["remote_outcome_unknown"] is True


def test_consumer_state_failure_signals_shutdown_before_waiting_for_node_drain(monkeypatch: pytest.MonkeyPatch,
                                                                            tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.on('data',()=>setTimeout(()=>process.exit(0),600));setInterval(()=>{},1000)")
    original_write = harness.write_json

    def fail_running(path: Path, value: dict[str, object]) -> None:
        if path.name == "consumer-result.json" and value.get("state") == "running":
            raise OSError("controlled running state failure")
        if path.name == "supervisor-result.json" and value.get("state") == "stopping":
            assert value["exit_code"] != 0
            assert fixture.processes[0].returncode is None
            fixture.events.append("failure_marked_before_drain")
        original_write(path, value)

    monkeypatch.setattr(harness, "write_json", fail_running)
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert fixture.events.index("failure_marked_before_drain") < fixture.events.index("api_shutdown_requested")


def test_ready_write_failure_preserves_snapshot_without_advertising_readiness(monkeypatch: pytest.MonkeyPatch,
                                                                           tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(7))
    original_write = harness.write_json

    def fail_terminal_ready(path: Path, value: dict[str, object]) -> None:
        if path.name == "ready.json" and value.get("state") in ("stopping", "stopped"):
            raise OSError("controlled readiness failure")
        original_write(path, value)

    monkeypatch.setattr(harness, "write_json", fail_terminal_ready)
    assert harness.owned_child(tmp_path, False) == 7
    assert fixture.api_closed and fixture.engine_closed and fixture.pg_stopped and not fixture.timed_out
    assert not (tmp_path / "ready.json").exists()
    preserved = list(tmp_path.glob("ready-unavailable-*.json"))
    assert len(preserved) == 1
    assert json.loads(preserved[0].read_text())["state"] == "running"
    assert "metadata_write_failed" in fixture.result()["errors"]


@pytest.mark.parametrize("path_name", ["applied-control.json", "control.json"])
def test_malformed_control_metadata_cannot_bypass_native_cleanup(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path, path_name: str) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    (tmp_path / path_name).write_text("{", encoding="utf-8")
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert not fixture.processes


def test_http_owner_metadata_failure_still_stops_owned_postgres(monkeypatch: pytest.MonkeyPatch,
                                                             tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    harness.write_json(tmp_path / "ready.json", {"state": "ready", "pid": 999})
    (tmp_path / "http-owner.json").write_text("{", encoding="utf-8")
    assert harness.owned_child(tmp_path, False) == 1
    assert fixture.pg_stopped
    assert not fixture.processes
    assert json.loads((tmp_path / "ready.json").read_text())["state"] == "stopped"


def test_usage_observer_failure_stops_run_without_replaying_the_consumer(monkeypatch: pytest.MonkeyPatch,
                                                                       tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000)")
    monkeypatch.setattr(harness, "observation_status", lambda: {"complete": not bool(fixture.processes),
                                                               "write_errors": int(bool(fixture.processes))})
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()
    assert len(fixture.processes) == 1
    assert fixture.result()["reason"] == "usage_observation_incomplete"


def test_signal_stop_uses_the_same_cleanup_and_restores_handlers(monkeypatch: pytest.MonkeyPatch,
                                                               tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.on('data',()=>process.exit(0));setInterval(()=>{},1000)")
    prior = signal.getsignal(signal.SIGTERM)

    def stop() -> None:
        if fixture.processes:
            handler = signal.getsignal(signal.SIGTERM)
            assert callable(handler), "supervisor has no owned SIGTERM handler"
            handler(signal.SIGTERM, None)

    fixture.on_tick = stop
    assert harness.owned_child(tmp_path, False) == 128 + signal.SIGTERM
    fixture.assert_stopped()
    assert fixture.result()["reason"] == "operator_signal"
    assert signal.getsignal(signal.SIGTERM) is prior


def test_listener_close_error_cannot_skip_engine_and_pg_cleanup(monkeypatch: pytest.MonkeyPatch,
                                                              tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(0, completion_proof(tmp_path)))
    original_server = sys.modules["uvicorn"].Server

    class Transport:
        def close(self) -> None:
            raise OSError("controlled transport close failure")

    def server(config: SimpleNamespace) -> object:
        value = original_server(config)
        value.servers = [Transport()]
        return value

    monkeypatch.setattr(sys.modules["uvicorn"], "Server", server)
    assert harness.owned_child(tmp_path, False) == 1
    fixture.assert_stopped()


@pytest.mark.parametrize("exit_code", [0, 7])
def test_pg_stop_failure_retains_terminal_error_and_restores_output(monkeypatch: pytest.MonkeyPatch,
                                                                 tmp_path: Path, exit_code: int) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, node_exit(exit_code, completion_proof(tmp_path)))

    def fail_stop(*_args: object) -> None:
        raise OSError("controlled owned PG stop failure")

    monkeypatch.setattr(harness, "stop_postgres", fail_stop)
    stdout, stderr = sys.stdout, sys.stderr
    assert harness.owned_child(tmp_path, False) == (exit_code or 1)
    assert sys.stdout is stdout and sys.stderr is stderr
    assert fixture.result()["services_stopped"]["postgres"] is False
    assert json.loads((tmp_path / "ready.json").read_text())["state"] == "stop_incomplete"
    assert "postgres_stop_failed" in fixture.result()["errors"]
    assert (tmp_path / "cleanup-required.json").exists()


@pytest.mark.parametrize("api_exit", [False, True])
def test_complete_proof_after_stop_does_not_clear_unknown(monkeypatch: pytest.MonkeyPatch,
                                                        tmp_path: Path, api_exit: bool) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.on('data',()=>{" + node_exit(0, completion_proof(tmp_path))
                 + "});setInterval(()=>{},1000)")

    def stop() -> None:
        if fixture.processes:
            if api_exit:
                fixture.exit_api = True
            else:
                harness.write_json(tmp_path / "control.json", {"id": "operator-stop", "action": "stop"})

    fixture.on_tick = stop
    assert harness.owned_child(tmp_path, False) == (1 if api_exit else 130)
    fixture.assert_stopped()
    assert fixture.processes[0].returncode == 0
    assert fixture.result()["remote_outcome_unknown"] is True
    assert json.loads((tmp_path / "consumer-result.json").read_text())["remote_outcome_unknown"] is True


def test_broken_abort_pipe_still_terminates_and_reaps_owned_node(monkeypatch: pytest.MonkeyPatch,
                                                              tmp_path: Path) -> None:
    fixture = LifecycleFixture(monkeypatch, tmp_path)
    fixture.node(monkeypatch, "process.stdin.resume();setInterval(()=>{},1000)")

    def corrupt_pipe(process: asyncio.subprocess.Process) -> None:
        def refuse(_data: bytes) -> None:
            raise OSError("controlled pipe failure")

        assert process.stdin is not None
        monkeypatch.setattr(process.stdin, "write", refuse)

    def stop() -> None:
        if fixture.processes:
            harness.write_json(tmp_path / "control.json", {"id": "operator-stop", "action": "stop"})

    fixture.on_spawn, fixture.on_tick = corrupt_pipe, stop
    assert harness.owned_child(tmp_path, False) == 130
    fixture.assert_stopped()
    assert "consumer_abort_channel_failed" in fixture.result()["errors"]


@pytest.mark.parametrize("exception_type", [KeyboardInterrupt, asyncio.CancelledError])
@pytest.mark.parametrize("stop_fails", [False, True])
def test_postgres_startup_cancellation_cleans_up_and_preserves_first_error(monkeypatch: pytest.MonkeyPatch,
                                                                        tmp_path: Path,
                                                                        exception_type: type[BaseException],
                                                                        stop_fails: bool) -> None:
    calls: list[str] = []
    original = exception_type("controlled startup interruption")

    def pg(native: Path, _name: str, action: str, _args: list[str]) -> dict[str, Any] | None:
        calls.append(action)
        if action == "start":
            (native / "data").mkdir()
        if action == "info":
            return {"data_dir": str(native / "data"), "port": 9}
        if action == "stop" and stop_fails:
            raise OSError("controlled PG stop failure")
        return None

    async def configure(*_args: object) -> None:
        raise original

    real_write = harness.write_json

    def write(path: Path, value: dict[str, Any]) -> None:
        if path.name == "cleanup-required.json":
            raise OSError("controlled cleanup marker failure")
        real_write(path, value)

    monkeypatch.setattr(harness, "pg_command", pg)
    monkeypatch.setattr(harness, "configure_database", configure)
    monkeypatch.setattr(harness, "write_json", write)
    with pytest.raises(exception_type) as caught:
        harness.start_postgres(tmp_path, {"pg_password": "test-only"})
    assert caught.value is original
    assert calls == ["start", "info", "info", "stop"]


def wait_for_file(path: Path) -> dict[str, Any]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        time.sleep(0.01)
    raise AssertionError("owned test process did not publish its bounded handshake")


def gate_program(body: str) -> str:
    return ("import json, os, subprocess, sys, time\nfrom pathlib import Path\nroot=Path(sys.argv[1])\n"
            "print('D78-WORKER',os.getpid(),os.environ.get('TAKI_D78_SUPERVISOR_ID','test-supervisor'),flush=True)\n"
            "if sys.stdin.buffer.readline(32) != b'D78-START\\n': sys.exit(2)\n"
            "launcher_pid=int(sys.stdin.buffer.readline(16))\n" + body)


def child_terminal_program(exit_code: int = 0, *, descendant_program: str | None = None,
                           hang_at_exit: bool = False) -> str:
    body = ""
    if descendant_program is not None:
        body += (f"grand=subprocess.Popen([sys.executable,'-I','-B','-c',{descendant_program!r},str(root)],"
                 "creationflags=subprocess.CREATE_NO_WINDOW)\n"
                 "(root/'descendant.json').write_text(json.dumps({'pid':grand.pid}),encoding='utf-8')\n")
    if hang_at_exit:
        body += ("import concurrent.futures, threading\n"
                 "executor=concurrent.futures.ThreadPoolExecutor()\nexecutor.submit(threading.Event().wait)\n")
    body += ("proof={'schemaVersion':1,'runDirectoryId':root.name,'consumerId':'test-run','state':'complete'}\n"
             "(root/'consumer-test-run-complete.json').write_text(json.dumps(proof),encoding='utf-8')\n"
             f"code={exit_code}\n"
             "result={'state':'finished','pid':os.getpid(),'launcher_pid':launcher_pid,'run_id':root.name,"
             "'supervisor_id':os.environ['TAKI_D78_SUPERVISOR_ID'],"
             "'reason':'consumer_complete' if code == 0 else 'consumer_exit_nonzero',"
             "'exit_code':code,'consumer_exit_code':code,'consumer_id':'test-run',"
             "'remote_outcome_unknown':code != 0,'errors':[],"
             "'services_stopped':dict.fromkeys(['consumer','http','engine','background_tasks','postgres'],True)}\n"
             "temporary=root/'result.tmp'\ntemporary.write_text(json.dumps(result),encoding='utf-8')\n"
             "temporary.replace(root/'supervisor-result.json')\n"
             "print('D78-STATE',os.environ['TAKI_D78_SUPERVISOR_ID'],'finished',flush=True)\nsys.exit(code)\n")
    return gate_program(body)


def run_outer(root: Path, program: str) -> int:
    with (root / "outer-test.log").open("wb") as output:
        return harness.run_owned_process(root, [sys.executable, "-I", "-B", "-c", program, str(root)],
                                         environment.clean_environment(root), output)


def open_process_wait_handle(pid: int) -> tuple[Any, Any]:
    kernel: Any = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    # This handle is read-only and captured while the known test child is alive.
    # It is never used to terminate a process rediscovered from a PID.
    handle = kernel.OpenProcess(0x00100000, False, pid)
    assert handle
    return kernel, handle


def test_job_uses_exact_x64_layout_and_noninheritable_kill_only_policy() -> None:
    assert ctypes.sizeof(jobs.BasicLimitInformation) == 64
    assert ctypes.sizeof(jobs.IoCounters) == 48
    assert ctypes.sizeof(jobs.ExtendedLimitInformation) == 144
    assert ctypes.sizeof(jobs.BasicAccountingInformation) == 48
    job = jobs.OwnedProcessJob()
    try:
        limits = jobs.ExtendedLimitInformation()
        assert job.kernel.QueryInformationJobObject(job.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits), None)
        assert limits.BasicLimitInformation.LimitFlags == jobs.KILL_ON_JOB_CLOSE
        flags = wintypes.DWORD()
        job.kernel.GetHandleInformation.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        job.kernel.GetHandleInformation.restype = wintypes.BOOL
        assert job.kernel.GetHandleInformation(job.handle, ctypes.byref(flags))
        assert flags.value & 1 == 0
    finally:
        cleanup = job.finish()
    assert cleanup.all_exited and cleanup.handle_closed and not cleanup.forced and not cleanup.errors


def test_job_contains_and_reaps_real_child_and_grandchild(tmp_path: Path) -> None:
    program = gate_program("grand=subprocess.Popen([sys.executable,'-I','-B','-c','import time;time.sleep(60)'],"
                           "creationflags=subprocess.CREATE_NO_WINDOW)\n"
                           "(root/'ready-test.json').write_text(json.dumps({'pid':grand.pid}),encoding='utf-8')\n"
                           "time.sleep(60)\n")
    job = jobs.OwnedProcessJob()
    process = jobs.SuspendedProcess([sys.executable, "-I", "-B", "-c", program, str(tmp_path)], job=job,
                                    environment=environment.clean_environment(tmp_path), cwd=str(environment.TAKI_ROOT))
    kernel, handle = None, None
    try:
        jobs.verify_worker(process, job, "test-supervisor")
        jobs.admit_child(process)
        ready = wait_for_file(tmp_path / "ready-test.json")
        kernel, handle = open_process_wait_handle(ready["pid"])
        # A venv executable may contribute redirector processes in addition to
        # the worker and grandchild; all of them must remain inside this Job.
        assert job.active_processes() >= 2
    finally:
        cleanup = job.finish()
        try:
            process.wait(timeout=5)
            if handle is not None:
                assert kernel.WaitForSingleObject(handle, 5000) == 0
        finally:
            if handle is not None:
                kernel.CloseHandle(handle)
            process.close()
    assert cleanup.forced and cleanup.all_exited and cleanup.handle_closed and not cleanup.errors


@pytest.mark.parametrize("exit_code", [0, 7])
def test_outer_preserves_real_inner_exit_and_requires_complete_proof(tmp_path: Path, exit_code: int) -> None:
    assert run_outer(tmp_path, child_terminal_program(exit_code)) == exit_code
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["exit_code"] == exit_code
    assert result["remote_outcome_unknown"] is (exit_code != 0)
    assert result["outer_completed"] is True
    assert result["process_tree"] == {"forced": False, "all_exited": True, "remaining": 0,
                                       "handle_closed": True, "errors": []}
    assert json.loads((tmp_path / "ready.json").read_text())["state"] == "stopped"


@pytest.mark.parametrize("scenario", ["natural", "persistent", "query-error", "budget-exhausted"])
def test_job_natural_exit_grace_keeps_one_budget_and_requires_confirmed_exit(monkeypatch: pytest.MonkeyPatch,
                                                                           tmp_path: Path, scenario: str) -> None:
    # Keep an actual descendant alive until the production cleanup call begins,
    # independently of launcher/venv timing. Only the natural case then exits on
    # its own; the other cases require containment and must remain failures.
    descendant = ("import sys,time\nfrom pathlib import Path\nroot=Path(sys.argv[1])\n"
                  "deadline=time.monotonic()+10\n"
                  "while not (root/'drain-start.json').exists() and time.monotonic()<deadline: time.sleep(0.01)\n"
                  "time.sleep(0.15)\n(root/'natural-exit.json').write_text('{}',encoding='utf-8')\n"
                  if scenario == "natural" else "import time;time.sleep(60)")
    original_finish = jobs.OwnedProcessJob.finish
    held: list[tuple[Any, Any]] = []
    elapsed: list[float] = []
    queries = 0
    forced_at: list[float] = []

    def finish(job: jobs.OwnedProcessJob, *, timeout: float = 5, launcher_exited: bool = False) -> jobs.JobCleanup:
        nonlocal queries
        assert launcher_exited is True
        assert timeout == 5
        assert job.active_processes() >= 1
        held.append(open_process_wait_handle(wait_for_file(tmp_path / "descendant.json")["pid"]))
        assert held[-1][0].WaitForSingleObject(held[-1][1], 0) == 258
        (tmp_path / "drain-start.json").write_text("{}", encoding="utf-8")
        original_query = job.active_processes

        def query() -> int:
            nonlocal queries
            queries += 1
            if scenario == "query-error" and queries == 2:
                raise OSError("controlled Job query failure during natural drain")
            return original_query()

        monkeypatch.setattr(job, "active_processes", query)
        if scenario == "budget-exhausted":
            # A monotonic test clock makes one total deadline observable without
            # a scheduling-sensitive wall-clock assertion. The child and Job are
            # real; failed confirmation must still close the KILL-only handle.
            now = [0.0]
            monkeypatch.setattr(jobs, "time", SimpleNamespace(monotonic=lambda: now[0],
                                                             sleep=lambda delay: now.__setitem__(0, now[0] + delay)))

            def unconfirmed_termination(_handle: object, _code: int) -> bool:
                forced_at.append(now[0])
                return True

            monkeypatch.setattr(job.kernel, "TerminateJobObject", unconfirmed_termination)
        started = jobs.time.monotonic()
        cleanup = original_finish(job, timeout=1, launcher_exited=launcher_exited)
        elapsed.append(jobs.time.monotonic() - started)
        return cleanup

    monkeypatch.setattr(jobs.OwnedProcessJob, "finish", finish)
    inner_code = 7 if scenario == "persistent" else 0
    try:
        code = run_outer(tmp_path, child_terminal_program(inner_code, descendant_program=descendant))
        assert len(held) == 1
        assert held[0][0].WaitForSingleObject(held[0][1], 5000) == 0
    finally:
        for kernel, handle in held:
            kernel.CloseHandle(handle)
    result = json.loads((tmp_path / "supervisor-result.json").read_text(encoding="utf-8"))
    cleanup = result["process_tree"]
    assert cleanup["handle_closed"] is True
    assert cleanup["forced"] is (scenario != "natural")
    assert result["remote_outcome_unknown"] is (scenario != "natural")
    assert code == (0 if scenario == "natural" else inner_code or 1)
    if scenario == "natural":
        assert (tmp_path / "natural-exit.json").exists()
        assert cleanup["all_exited"] is True and cleanup["remaining"] == 0 and not cleanup["errors"]
        assert queries > 1 and elapsed[0] >= 0.1
        assert result["reason"] == "consumer_complete"
    elif scenario == "persistent":
        assert cleanup["all_exited"] is True and cleanup["remaining"] == 0 and not cleanup["errors"]
        assert result["reason"] == "consumer_exit_nonzero"
        assert elapsed[0] >= 0.5
    elif scenario == "query-error":
        assert cleanup["all_exited"] is False
        assert "job_query_failed" in cleanup["errors"]
        assert result["reason"] == "process_tree_forced"
    else:
        assert cleanup["all_exited"] is False and cleanup["remaining"] >= 1
        assert cleanup["errors"] == ["job_exit_unconfirmed"]
        assert forced_at == pytest.approx([0.5])
        assert elapsed == pytest.approx([1.0])
        assert result["reason"] == "process_tree_forced"


@pytest.mark.parametrize("failure", ["assignment", "admission-before", "admission-after"])
def test_assignment_or_admission_failure_never_leaves_a_child(monkeypatch: pytest.MonkeyPatch,
                                                            tmp_path: Path, failure: str) -> None:
    monkeypatch.setattr(harness, "SUPERVISOR_STOP_SECONDS", 0.1)
    program = gate_program("(root/'admitted.json').write_text('{}',encoding='utf-8')\ntime.sleep(60)\n")

    def refuse(*_args: object) -> None:
        raise OSError("controlled admission failure")

    original_admit = jobs.admit_child

    def fail_after(process: subprocess.Popen[bytes]) -> None:
        original_admit(process)
        raise OSError("controlled post-admission failure")

    if failure == "assignment":
        monkeypatch.setattr(jobs.OwnedProcessJob, "assign", refuse)
    else:
        monkeypatch.setattr(jobs, "admit_child", fail_after if failure == "admission-after" else refuse)
    assert run_outer(tmp_path, program) != 0
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["process_tree"]["all_exited"] is True
    assert result["process_tree"]["handle_closed"] is True
    assert result["remote_outcome_unknown"] is True
    if failure != "admission-after":
        assert not (tmp_path / "admitted.json").exists()


def test_abrupt_inner_death_reaps_the_job_descendant_and_retires_ready(monkeypatch: pytest.MonkeyPatch,
                                                                    tmp_path: Path) -> None:
    program = gate_program("grand=subprocess.Popen([sys.executable,'-I','-B','-c','import time;time.sleep(60)'],"
                           "creationflags=subprocess.CREATE_NO_WINDOW)\n"
                           "(root/'descendant.json').write_text(json.dumps({'pid':grand.pid}),encoding='utf-8')\n"
                           "(root/'ready.json').write_text(json.dumps({'state':'ready'}),encoding='utf-8')\n"
                           "os._exit(7)\n")
    original_write = harness.write_json
    held: list[tuple[Any, Any]] = []

    def capture(path: Path, value: dict[str, Any]) -> None:
        if path.name.endswith("-stopping.json"):
            held.append(open_process_wait_handle(wait_for_file(tmp_path / "descendant.json")["pid"]))
        original_write(path, value)

    monkeypatch.setattr(harness, "write_json", capture)
    try:
        assert run_outer(tmp_path, program) == 7
        assert len(held) == 1
        assert held[0][0].WaitForSingleObject(held[0][1], 5000) == 0
    finally:
        for kernel, handle in held:
            kernel.CloseHandle(handle)
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["process_tree"]["forced"] is True
    assert result["process_tree"]["all_exited"] is True
    assert result["remote_outcome_unknown"] is True
    assert json.loads((tmp_path / "ready.json").read_text())["state"] == "stopped"


def test_outer_deadline_contains_executor_thread_that_survives_finished_state(monkeypatch: pytest.MonkeyPatch,
                                                                           tmp_path: Path) -> None:
    monkeypatch.setattr(harness, "SUPERVISOR_EXIT_SECONDS", 0.1)
    assert run_outer(tmp_path, child_terminal_program(hang_at_exit=True)) != 0
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["reason"] == "supervisor_exit_timeout"
    assert result["process_tree"]["forced"] is True
    assert result["process_tree"]["all_exited"] is True
    assert result["remote_outcome_unknown"] is True


def test_outer_death_closes_noninherited_job_and_kills_descendants(tmp_path: Path) -> None:
    child = gate_program("grand=subprocess.Popen([sys.executable,'-I','-B','-c','import time;time.sleep(60)'],"
                         "creationflags=subprocess.CREATE_NO_WINDOW)\n"
                         "(root/'tree.json').write_text(json.dumps({'child':os.getpid(),'grandchild':grand.pid}),encoding='utf-8')\n"
                         "time.sleep(60)\n")
    outer = ("import subprocess,sys,time\nfrom pathlib import Path\n"
             f"sys.path.insert(0,{str(environment.SCRIPT_DIR)!r})\n"
             "from real_hindsight_job import OwnedProcessJob,SuspendedProcess,verify_worker,admit_child\n"
             "from real_hindsight_environment import clean_environment,TAKI_ROOT\n"
             "job=OwnedProcessJob()\n"
             f"child=SuspendedProcess([sys.executable,'-I','-B','-c',{child!r},sys.argv[1]],job=job,"
             "environment=clean_environment(Path(sys.argv[1])),cwd=str(TAKI_ROOT))\n"
             "verify_worker(child,job,'test-supervisor')\nadmit_child(child)\ntime.sleep(60)\n")
    process = subprocess.Popen([sys.executable, "-I", "-B", "-c", outer, str(tmp_path)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               env=environment.clean_environment(tmp_path), creationflags=subprocess.CREATE_NO_WINDOW)
    held: list[tuple[Any, Any]] = []
    try:
        tree = wait_for_file(tmp_path / "tree.json")
        held = [open_process_wait_handle(tree[key]) for key in ("child", "grandchild")]
        process.kill()
        process.wait(timeout=5)
        assert all(kernel.WaitForSingleObject(handle, 5000) == 0 for kernel, handle in held)
    finally:
        jobs.terminate_held_child(process)
        for kernel, handle in held:
            kernel.CloseHandle(handle)


def test_job_query_timeout_is_not_reported_as_clean_shutdown(monkeypatch: pytest.MonkeyPatch) -> None:
    job = jobs.OwnedProcessJob()
    monkeypatch.setattr(job, "active_processes", lambda: 1)
    cleanup = job.finish(timeout=0.01)
    assert cleanup.forced is True
    assert cleanup.all_exited is False
    assert cleanup.handle_closed is True
    assert cleanup.errors == ["job_exit_unconfirmed"]


def test_outer_does_not_stop_another_live_root_owner(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    ready = tmp_path / "ready.json"
    ready.write_text('{"state":"ready","owner":"other"}', encoding="utf-8")
    before = ready.read_bytes()
    pg_calls: list[object] = []
    monkeypatch.setattr(harness, "recover_postgres", lambda root: pg_calls.append(root))
    with environment.exclusive_supervisor(tmp_path):
        assert run_outer(tmp_path, gate_program("sys.exit(7)\n")) == 7
    assert ready.read_bytes() == before
    assert not pg_calls
    assert len(list(tmp_path.glob("supervisor-*-cleanup-required.json"))) == 1


def test_delayed_assignment_refuses_the_already_started_redirector_worker(tmp_path: Path) -> None:
    program = gate_program("(root/'admitted.json').write_text('{}',encoding='utf-8')\n")
    job = jobs.OwnedProcessJob()
    process = subprocess.Popen([sys.executable, "-I", "-B", "-c", program, str(tmp_path)], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0,
                               env=environment.clean_environment(tmp_path), creationflags=subprocess.CREATE_NO_WINDOW)
    # This adapter supplies only the nonblocking pipe-read operation; the process
    # and Job are real. The delayed assignment intentionally exercises the old
    # race without ever sending START to the uncontained worker.
    reader = cast(Any, SimpleNamespace(stdout=process.stdout, kernel=job.kernel, poll=process.poll))
    job.kernel.PeekNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                        ctypes.POINTER(wintypes.DWORD), ctypes.POINTER(wintypes.DWORD),
                                        ctypes.POINTER(wintypes.DWORD)]
    job.kernel.PeekNamedPipe.restype = wintypes.BOOL
    header = bytearray()
    try:
        deadline = time.monotonic() + 5
        while b"\n" not in header and time.monotonic() < deadline:
            header.extend(jobs.SuspendedProcess.read_available(reader))
            time.sleep(0.01)
        assert b"\n" in header
        worker_pid = int(header.split(b" ")[1])
        assert worker_pid != process.pid, "the configured Windows venv must exercise its actual redirector"
        job.assign(process)
        assert process.pid in job.process_ids()
        assert worker_pid not in job.process_ids()
        reader.read_available = lambda: bytes(header)
        with pytest.raises(RuntimeError, match="D78_WORKER_OUTSIDE_OWNED_JOB"):
            jobs.verify_worker(reader, job, "test-supervisor")
        assert process.stdin is not None
        process.stdin.close()
        assert process.wait(timeout=5) == 2
        assert not (tmp_path / "admitted.json").exists()
    finally:
        if process.stdin is not None and not process.stdin.closed:
            process.stdin.close()
        process.wait(timeout=5)
        cleanup = job.finish()
        if process.stdout is not None:
            process.stdout.close()
    assert cleanup.all_exited and cleanup.handle_closed and not cleanup.forced


def test_primary_thread_resume_failure_reaps_the_suspended_process(monkeypatch: pytest.MonkeyPatch,
                                                                 tmp_path: Path) -> None:
    original_job = jobs.OwnedProcessJob

    def refuse_resume() -> jobs.OwnedProcessJob:
        job = original_job()
        monkeypatch.setattr(job.kernel, "ResumeThread", lambda _handle: 0xFFFFFFFF)
        return job

    monkeypatch.setattr(jobs, "OwnedProcessJob", refuse_resume)
    assert run_outer(tmp_path, gate_program("(root/'admitted.json').write_text('{}')\n")) == 1
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["reason"] == "primary_thread_resume_failed"
    assert result["process_tree"]["all_exited"] is True
    assert result["process_tree"]["handle_closed"] is True
    assert not (tmp_path / "admitted.json").exists()


def test_create_process_failure_closes_empty_job_without_admission(tmp_path: Path) -> None:
    with (tmp_path / "outer-test.log").open("wb") as output:
        result = harness.run_owned_process(tmp_path, [str(tmp_path / "does-not-exist.exe")],
                                           environment.clean_environment(tmp_path), output)
    assert result == 1
    record = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert record["reason"] == "child_spawn_failed"
    assert record["process_tree"]["all_exited"] is True
    assert record["process_tree"]["handle_closed"] is True


@pytest.mark.parametrize("exception_type", [KeyboardInterrupt, asyncio.CancelledError, RuntimeError])
def test_database_connection_close_cannot_replace_the_first_failure(monkeypatch: pytest.MonkeyPatch,
                                                                  tmp_path: Path,
                                                                  exception_type: type[BaseException]) -> None:
    original = exception_type("controlled database interruption")

    class Connection:
        async def fetchval(self, _query: str) -> str:
            raise original

        async def close(self) -> None:
            raise OSError("controlled connection close failure")

    async def connect(**_kwargs: object) -> Connection:
        return Connection()

    import asyncpg

    monkeypatch.setattr(asyncpg, "connect", connect)
    with pytest.raises(exception_type) as caught:
        asyncio.run(harness.configure_database(tmp_path, {"port": 9}, {"pg_password": "test-only"}))
    assert caught.value is original


def test_fake_model_probe_has_explicit_complete_resource_state(monkeypatch: pytest.MonkeyPatch,
                                                             tmp_path: Path) -> None:
    LifecycleFixture(monkeypatch, tmp_path)

    async def probe(_root: Path) -> None:
        return None

    monkeypatch.setattr(harness, "probe_models", probe)
    assert harness.owned_child(tmp_path, True) == 0
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["reason"] == "model_preflight_complete"
    assert all(result["services_stopped"].get(key) is True
               for key in ("consumer", "http", "engine", "background_tasks", "postgres"))


def stopped_by_generation_program() -> str:
    return gate_program(
        "identity=os.environ['TAKI_D78_SUPERVISOR_ID']\n"
        "value={'supervisor_id':identity,'pid':os.getpid(),'launcher_pid':launcher_pid,"
        "'run_id':root.name,'state':'running'}\n"
        "temporary=root/'running.tmp'\ntemporary.write_text(json.dumps(value),encoding='utf-8')\n"
        "temporary.replace(root/'supervisor-result.json')\n"
        "while not (root/f'supervisor-{identity}-stop.json').exists(): time.sleep(0.01)\n"
        "(root/'stop-seen.json').write_text('{}',encoding='utf-8')\n"
        "print('D78-STATE',identity,'finished',flush=True)\nsys.exit(130)\n")


@pytest.mark.parametrize("interruption", ["signal", "metadata"])
def test_outer_failure_requests_generation_stop_before_forcing(monkeypatch: pytest.MonkeyPatch,
                                                             tmp_path: Path, interruption: str) -> None:
    original = harness.current_child_record
    injected = False
    prior = signal.getsignal(signal.SIGTERM)

    def observe(root: Path, identity: str, pid: int, worker_pid: int | None = None) -> dict[str, Any] | None:
        nonlocal injected
        value = original(root, identity, pid, worker_pid)
        if value is not None and not injected:
            injected = True
            if interruption == "metadata":
                raise OSError("controlled status read failure")
            handler = signal.getsignal(signal.SIGTERM)
            assert callable(handler)
            handler(signal.SIGTERM, None)
        return value

    monkeypatch.setattr(harness, "current_child_record", observe)
    result = run_outer(tmp_path, stopped_by_generation_program())
    assert result == (143 if interruption == "signal" else 130)
    assert (tmp_path / "stop-seen.json").exists()
    assert signal.getsignal(signal.SIGTERM) is prior
    final = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert final["process_tree"]["forced"] is False
    assert final["remote_outcome_unknown"] is True
    assert final["reason"] == ("operator_signal" if interruption == "signal" else "supervisor_metadata_failed")


def test_control_frame_bounds_exit_even_when_terminal_disk_evidence_is_missing(monkeypatch: pytest.MonkeyPatch,
                                                                            tmp_path: Path) -> None:
    program = gate_program("import concurrent.futures,threading\n"
                           "executor=concurrent.futures.ThreadPoolExecutor()\nexecutor.submit(threading.Event().wait)\n"
                           "print('D78-STATE',os.environ['TAKI_D78_SUPERVISOR_ID'],'finished',flush=True)\n"
                           "sys.exit(0)\n")
    monkeypatch.setattr(harness, "SUPERVISOR_EXIT_SECONDS", 0.1)
    assert run_outer(tmp_path, program) != 0
    result = json.loads((tmp_path / "supervisor-result.json").read_text())
    assert result["reason"] == "supervisor_exit_timeout"
    assert result["process_tree"]["forced"] is True
    assert result["process_tree"]["all_exited"] is True
    assert result["remote_outcome_unknown"] is True
