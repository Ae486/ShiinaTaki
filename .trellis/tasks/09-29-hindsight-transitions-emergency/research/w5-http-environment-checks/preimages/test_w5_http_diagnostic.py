"""Focused offline/single owned-PG HTTP wiring tests; never model/corpus access."""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest

import w5_actual_embedding_control as control
import w5_http_composition as composition

entry = control.load("w5_http_test_entry", "w5-http-diagnostic.py")


def test_defaults_are_inert() -> None:
    for executable, filename in [
        (control.PYTHON, "w5-http-diagnostic.py"),
        (entry.NODE, "w5-http-client.mjs"),
    ]:
        result = subprocess.run(
            [str(executable), str(control.HERE / filename)],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0 and "executed=false" in result.stdout
    assert "torch" not in sys.modules and "sentence_transformers" not in sys.modules


def test_continuous_initialization_ignores_intermediate_model_phase(
    tmp_path: Path,
) -> None:
    control.write_json(
        tmp_path / "http-initialization.json", {"monotonic": 10.0, "ready": False}
    )
    assert entry.continuous_phase(
        tmp_path, {"phase": "initialized", "monotonic": 189}
    ) == {"phase": "initializing", "monotonic": 10.0}
    child = Mock()
    child.poll.side_effect = [None, 1]
    child.wait.return_value = 1
    outcome = control.supervise(
        child,
        lambda: entry.continuous_phase(tmp_path, {}),
        clock=iter([189.0, 190.0, 190.0]).__next__,
        sleep=lambda _: None,
    )
    assert outcome["timeout"] == "initialization" and child.terminate.call_count == 1
    control.write_json(
        tmp_path / "http-initialization.json",
        {"monotonic": 10.0, "ready": True, "milliseconds": 180000},
    )
    with pytest.raises(AssertionError, match="COMPLETED_LATE"):
        entry.continuous_phase(tmp_path, {})


@pytest.mark.parametrize(
    "fault", ["job", "pid", "parent", "executable", "inventory", "nonce"]
)
def test_node_refuses_identity_before_admission(tmp_path: Path, fault: str) -> None:
    source = {"sha256": "a" * 64, "entries": 1, "verified": True}
    owned = entry.NodeSupervisor(tmp_path, source, Mock())
    owned.child = SimpleNamespace(pid=123)
    control.write_json(tmp_path / "node-launch.json", {"nonce": "owned"})
    value = {
        "job": str(tmp_path.resolve()),
        "pid": 123,
        "parentPid": os.getpid(),
        "executable": str(entry.NODE),
        "version": "v24.18.0",
        "source": source,
        "nonce": "owned",
    }
    value[{"parent": "parentPid", "inventory": "source"}.get(fault, fault)] = (
        "wrong" if fault != "source" else {}
    )
    with pytest.raises((AssertionError, TypeError)):
        owned.admit(value)
    assert not (tmp_path / "node-admission.json").exists()


def test_node_cleanup_uses_original_handle_even_without_result(tmp_path: Path) -> None:
    owned = entry.NodeSupervisor(tmp_path, {}, Mock())
    owned.child = Mock()
    owned.child.poll.return_value = None
    owned.child.returncode = -1
    owned.identity = Mock()
    owned.close()
    owned.child.terminate.assert_called_once()
    owned.child.wait.assert_called_once_with(timeout=10)
    assert control.read_json(tmp_path / "node-cleanup.json")["stopped"]
    owned.identity.close.assert_called_once()


def complete_reports(job: Path) -> dict:
    source = {"sha256": "a" * 64, "entries": 1, "verified": True}
    for owner in ("parent", "python", "node"):
        for stage in ("before", "after"):
            control.write_json(job / f"inventory-{owner}-{stage}.json", source)
    http = {
        "diagnosticSucceeded": True,
        "completeHttpBudgetPassed": True,
        "publicMilliseconds": 1.0,
        "applyReturned": True,
        "applyCompleted": True,
        "exactLookupMatches": True,
        "claims": 1,
        "applyPosts": 1,
        "requestHash": "b" * 64,
        "resultHash": "c" * 64,
        "mappings": 1,
        "artifacts": 1,
        "transports": [
            {
                "method": "POST",
                "path": "/owned/claim",
                "completed": True,
                "status": 200,
            },
            {
                "method": "POST",
                "path": "/owned/executor/delta",
                "completed": True,
                "status": 200,
            },
            {"method": "GET", "path": "/owned/delta", "completed": True, "status": 200},
        ],
    }
    control.write_json(job / "http-input.json", {"requestHash": http["requestHash"]})
    control.write_json(
        job / "http-ready.json",
        {"inputSha256": control.digest(job / "http-input.json")},
    )
    worker_launch = {"parentPid": 11}
    worker_self = {"verified": True}
    embeddings = {"initializationCompleted": True}
    watchdog = {"childExitCode": 0, "timeout": None}
    held = {"pid": 22, "creationTicks": 333, "executable": str(entry.NODE)}
    artifacts = {
        "worker-launch": worker_launch,
        "worker-self": worker_self,
        "embedding": embeddings,
        "watchdog": watchdog,
        "node-held": held,
        "node-launch": {
            "sourceManifestSha256": source["sha256"],
            "dependencySha256": entry.inventory.DEPENDENCIES_SHA,
            "nonce": "fixture",
            "parentPid": 11,
            "job": str(job.resolve()),
        },
        "node-self": {
            "source": source,
            "nonce": "fixture",
            "pid": 22,
            "parentPid": 11,
            "job": str(job.resolve()),
        },
        "node-admission": {
            "sourceManifestSha256": source["sha256"],
            "nonce": "fixture",
            "pid": 22,
            "identity": held,
        },
        "node-exit": {"exitCode": 0, "admitted": True},
    }
    for name, value in artifacts.items():
        control.write_json(job / f"{name}.json", value)
    control.write_json(job / "http-node-result.json", http)
    control.write_json(
        job / "node-cleanup.json", {"stopped": True, "admitted": True, "exitCode": 0}
    )
    control.write_json(
        job / "result.json",
        {
            "diagnosticSucceeded": True,
            "directWorkerIdentityVerified": True,
            "workerLaunch": worker_launch,
            "workerSelf": worker_self,
            "childReport": {
                "http": http,
                "applyCompleted": True,
                "exactLookupMatches": True,
                "persistedDelta": {
                    key: http[key]
                    for key in ("requestHash", "resultHash", "mappings", "artifacts")
                },
                "embeddings": embeddings,
                "serverDrained": True,
                "httpPortReleased": True,
                "engineClosed": True,
                "historicalMaintenancePreserved": True,
                "actorVerified": True,
                "deltaRows": 1,
                "forbiddenDispatches": [],
            },
            "cleanup": {"stopped": True, "portReleased": True},
            "watchdog": watchdog,
            "preservation": {
                key: True
                for key in (
                    "sourcePreserved",
                    "inputPreserved",
                    "corePreserved",
                    "originalPreserved",
                    "sourcesPreserved",
                )
            },
        },
    )
    assert entry.finish_reports(job, source)["completeHttpBudgetPassed"]
    return source


@pytest.mark.parametrize(
    "name",
    [
        "result",
        "node-cleanup",
        "http-node-result",
        "inventory-node-after",
        "worker-self",
        "embedding",
        "node-self",
        "node-launch",
        "node-held",
        "node-admission",
        "node-exit",
        "watchdog",
    ],
)
@pytest.mark.parametrize("value", [None, [], "invalid", "missing"])
def test_malformed_or_missing_reports_always_write_failed_final(
    tmp_path: Path, name: str, value
) -> None:
    source = complete_reports(tmp_path)
    if value != "missing":
        control.write_json(tmp_path / f"{name}.json", value)
    else:
        (tmp_path / f"{name}.json").unlink()
    result = entry.finish_reports(tmp_path, source)
    assert not result["diagnosticSucceeded"] and not result["completeHttpBudgetPassed"]
    assert control.read_json(tmp_path / "http-result.json") == result


@pytest.mark.parametrize(
    "field", ["childReport", "cleanup", "watchdog", "preservation"]
)
def test_nonobject_nested_reports_refuse_success(tmp_path: Path, field: str) -> None:
    source = complete_reports(tmp_path)
    value = control.read_json(tmp_path / "result.json")
    value[field] = None
    control.write_json(tmp_path / "result.json", value)
    assert not entry.finish_reports(tmp_path, source)["diagnosticSucceeded"]


def test_report_digest_failure_does_not_lose_final(tmp_path: Path) -> None:
    source = complete_reports(tmp_path)
    with patch.object(control, "digest", side_effect=OSError("unreadable")):
        result = entry.finish_reports(tmp_path, source)
    assert not result["diagnosticSucceeded"] and result["nativeResultSha256"] is None
    assert control.read_json(tmp_path / "http-result.json") == result


@pytest.mark.asyncio
async def test_server_construction_failure_closes_socket_and_restores_methods(
    tmp_path: Path,
) -> None:
    from hindsight_api.engine.transfer.transition_delta import TransitionDeltaService

    engine = SimpleNamespace(apply_taki_transition_delta=Mock())
    original_engine, original_native = (
        engine.apply_taki_transition_delta,
        TransitionDeltaService.apply,
    )
    report = {}
    with patch(
        "hindsight_api.api.http.create_app", side_effect=RuntimeError("startup")
    ):
        with pytest.raises(RuntimeError, match="startup"):
            await composition.serve_engine(
                engine,
                tmp_path,
                {},
                report,
                clone_path=tmp_path,
                pg_port=18495,
                initialization_started=time.monotonic(),
            )
    assert report["serverDrained"] and report["httpPortReleased"]
    assert engine.apply_taki_transition_delta is original_engine
    assert TransitionDeltaService.apply is original_native
    assert not (tmp_path / "http-ready.json").exists()


def test_prelaunch_inventory_failure_still_persists_final(tmp_path: Path) -> None:
    with (
        patch.object(control, "RUNTIME", tmp_path),
        patch.object(
            entry.inventory, "verify_inventory", side_effect=AssertionError("drift")
        ),
    ):
        job = entry.run_reviewed()
    result = control.read_json(job / "http-result.json")
    assert (
        not result["diagnosticSucceeded"] and result["errorClass"] == "AssertionError"
    )
    assert not (job / "node-launch.json").exists()


def test_fixed_inventory_union_refuses_corruption(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import copy
    import w5_http_inventory as inventory

    previous = control.read_json(inventory.PREVIOUS)
    previous_path, dependency_path, manifest_path = (
        tmp_path / name
        for name in ("previous.json", "dependency.json", "manifest.json")
    )
    artifact = tmp_path / "artifact.txt"
    artifact.write_text("fixture", encoding="utf-8")
    additions = [str(artifact.resolve())]
    control.write_json(previous_path, previous)
    control.write_json(dependency_path, {"files": [], "additions": additions})
    raw = {
        "files": [*previous["files"], inventory.pin(artifact).model_dump()],
        "additions": additions,
    }
    for key, value in {
        "PREVIOUS": previous_path,
        "PREVIOUS_SHA": control.digest(previous_path),
        "DEPENDENCIES": dependency_path,
        "DEPENDENCIES_SHA": control.digest(dependency_path),
        "MANIFEST": manifest_path,
        "ADDITIONS": (artifact,),
    }.items():
        monkeypatch.setattr(inventory, key, value)
    control.write_json(manifest_path, raw)
    assert inventory.verify_inventory()["entries"] == 405
    for fault in ("omitted", "replaced", "duplicate", "addition", "expanded"):
        damaged = copy.deepcopy(raw)
        if fault == "omitted":
            damaged["files"].pop(0)
        elif fault == "replaced":
            damaged["files"][0]["sha256"] = "0" * 64
        elif fault == "duplicate":
            damaged["files"].append(damaged["files"][0])
        elif fault == "addition":
            damaged["additions"].append(additions[0])
        else:
            extra = tmp_path / "extra.txt"
            extra.write_text("extra", encoding="utf-8")
            damaged["files"].append(inventory.pin(extra).model_dump())
            damaged["additions"].append(str(extra))
        control.write_json(manifest_path, damaged)
        with pytest.raises(AssertionError):
            inventory.verify_inventory()
    control.write_json(manifest_path, raw)
    with pytest.raises(AssertionError, match="MANIFEST_CHANGED"):
        inventory.verify_inventory("0" * 64)
    control.write_json(dependency_path, {"files": [], "additions": []})
    with pytest.raises(AssertionError, match="DEPENDENCIES_CHANGED"):
        inventory.verify_inventory()


@pytest.mark.asyncio
async def test_no_background_checks_and_attempts_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from hindsight_api.config import clear_config_cache
    from hindsight_api.engine.llm_wrapper import LLMProvider
    from hindsight_api.engine.maintenance import MaintenanceLoop
    from hindsight_api.engine.memories import set_memories
    from hindsight_api.engine.memories.postgres import PostgresMemories
    from hindsight_api.engine.task_backend import SyncTaskBackend

    for key, value in composition.SETTINGS.items():
        monkeypatch.setenv(key, value)
    clear_config_cache()
    set_memories(PostgresMemories({}))
    engine = SimpleNamespace(_skip_llm_verification=True)
    composition.maintenance_disabled(engine, initialized=False)
    report = {}
    with composition.no_background(report):
        for owner, method in [
            (LLMProvider, "call"),
            (SyncTaskBackend, "submit_task"),
            (MaintenanceLoop, "_run"),
        ]:
            with pytest.raises(RuntimeError, match="DISPATCH_REFUSED"):
                await getattr(owner, method)(None)
    assert len(report["forbiddenDispatches"]) == 3
    monkeypatch.setenv("HINDSIGHT_API_OPERATION_RETENTION_DAYS", "1")
    clear_config_cache()
    with pytest.raises(AssertionError, match="MAINTENANCE_ENABLED"):
        composition.maintenance_disabled(engine, initialized=False)
    clear_config_cache()


@pytest.mark.asyncio
async def test_internal_socketpair_is_thread_local_and_clears_on_failure() -> None:
    clone = SimpleNamespace(PORT=9, REPORT={"networkAttemptsRefused": 0})
    originals = (
        socket.socket.connect,
        socket.socket.connect_ex,
        socket.socketpair,
        asyncio.get_running_loop().create_connection,
    )
    try:
        composition.network_guard(clone)
        left, right = await asyncio.to_thread(socket.socketpair)
        left.close()
        right.close()

        async def no_work() -> None:
            await asyncio.sleep(0)

        await asyncio.to_thread(lambda: asyncio.run(no_work()))
        with (
            socket.socket() as outsider,
            pytest.raises(RuntimeError, match="NON_CLONE"),
        ):
            outsider.connect(("127.0.0.1", 18496))
        # An exception inside the primitive must clear the thread-local bypass.
        with pytest.raises((OSError, ValueError)):
            socket.socketpair(family=-999)
        with (
            socket.socket() as outsider,
            pytest.raises(RuntimeError, match="NON_CLONE"),
        ):
            outsider.connect(("example.invalid", 443))
    finally:
        socket.socket.connect, socket.socket.connect_ex, socket.socketpair = originals[
            :3
        ]
        asyncio.get_running_loop().create_connection = originals[3]


@pytest.mark.asyncio
async def test_socketpair_scope_does_not_allow_concurrent_ordinary_thread() -> None:
    entered, release = threading.Event(), threading.Event()
    original = socket.socketpair

    def blocked_pair(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original(*args, **kwargs)

    originals = (
        socket.socket.connect,
        socket.socket.connect_ex,
        socket.socketpair,
        asyncio.get_running_loop().create_connection,
    )
    try:
        with patch.object(socket, "socketpair", blocked_pair):
            composition.network_guard(
                SimpleNamespace(PORT=9, REPORT={"networkAttemptsRefused": 0})
            )
            task = asyncio.create_task(asyncio.to_thread(socket.socketpair))
            assert await asyncio.to_thread(entered.wait, 3)
            with (
                socket.socket() as outsider,
                pytest.raises(RuntimeError, match="NON_CLONE"),
            ):
                outsider.connect(("127.0.0.1", 18496))
            release.set()
            left, right = await task
            left.close()
            right.close()
    finally:
        release.set()
        socket.socket.connect, socket.socket.connect_ex, socket.socketpair = originals[
            :3
        ]
        asyncio.get_running_loop().create_connection = originals[3]


@pytest.mark.asyncio
@pytest.mark.skipif(
    "TAKI_G1_FIXTURE_PORT" not in os.environ,
    reason="requires the explicitly owned PG runner",
)
async def test_owned_pg_actual_uvicorn_and_core_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Reuse Native's deterministic model implementations and complete delta
    # fixture. Its setup maintenance is outside the guarded HTTP measurement.
    for package in ("sentence_transformers", "transformers", "spacy"):
        monkeypatch.setitem(sys.modules, package, None)
    from hindsight_api.engine.cross_encoder import RRFPassthroughCrossEncoder
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.query_analyzer import DateparserQueryAnalyzer
    from hindsight_api.engine.task_backend import SyncTaskBackend
    from hindsight_api.extensions.builtin.tenant import ApiKeyTenantExtension
    from hindsight_api.models import RequestContext
    from tests.native_results.conftest import FixtureEmbeddings
    from tests.native_results.transition_delta_helpers import delta_case

    composition.configure()
    engine = MemoryEngine(
        db_url=os.environ["HINDSIGHT_API_DATABASE_URL"],
        memory_llm_provider="mock",
        memory_llm_api_key="",
        memory_llm_model="mock",
        embeddings=FixtureEmbeddings(),
        cross_encoder=RRFPassthroughCrossEncoder(),
        query_analyzer=DateparserQueryAnalyzer(),
        run_migrations=True,
        skip_llm_verification=True,
        task_backend=SyncTaskBackend(),
        tenant_extension=ApiKeyTenantExtension({"api_key": composition.API_KEY}),
    )
    composition.maintenance_disabled(engine, initialized=False)
    await engine.initialize()
    composition.maintenance_disabled(engine, initialized=True)
    monkeypatch.setattr(
        engine._config_resolver._global_config, "enable_auto_consolidation", False
    )
    child = None
    serving = None
    report = {"fixtureOnly": True, "deterministicEmbeddings": True}
    try:
        context = RequestContext(api_key=composition.API_KEY)
        case = await delta_case(engine, context, monkeypatch, authenticated=True)
        async with engine._backend.acquire() as conn:
            await conn.execute(
                "UPDATE memory_transition_requests SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE transition_id=$1",
                case.request.executor.transition_id,
            )
            current = await conn.fetchrow(
                "SELECT actor_hash,revision,generation FROM memory_transition_requests WHERE transition_id=$1",
                case.request.executor.transition_id,
            )
        assert (
            current["actor_hash"]
            == (
                await engine._transition_service(case.app.bank_id, context)
            ).owner.actor_hash
        )
        identity = control.ProcessIdentity(os.getpid())
        try:
            control.write_json(tmp_path / "child.json", identity.value)
        finally:
            identity.close()
        with composition.no_background(report):
            # Real fixture uses the normal settings/maintenance checks; provider
            # call guards remain installed throughout serving and client calls.
            serving = asyncio.create_task(
                composition.serve_engine(
                    engine,
                    tmp_path,
                    {
                        "bank": case.app.bank_id,
                        "transition": str(case.request.executor.transition_id),
                        "request": case.request.model_dump(mode="json"),
                        "requestHash": case.request.request_hash,
                        "expectedRevision": current["revision"],
                        "originalGeneration": current["generation"],
                    },
                    report,
                    clone_path=tmp_path,
                    pg_port=int(os.environ["TAKI_G1_FIXTURE_PORT"]),
                    initialization_started=time.monotonic(),
                )
            )
            started = time.monotonic()
            while not (tmp_path / "http-ready.json").exists():
                if serving.done():
                    await serving
                assert time.monotonic() - started < 10
                await asyncio.sleep(0.02)
            child = subprocess.Popen(
                [
                    str(entry.NODE),
                    str(control.HERE / "test_w5_http_client.mjs"),
                    "--owned-fixture",
                    str(tmp_path / "http-input.json"),
                    str(tmp_path / "http-node-result.json"),
                ],
                cwd=control.HERE,
                env=control.clean_environment(),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            code = await asyncio.to_thread(child.wait, timeout=90)
            control.write_json(
                tmp_path / "node-exit.json", {"exitCode": code, "admitted": True}
            )
            await serving
            assert code == 0, control.read_json(tmp_path / "http-node-result.json")
            assert report["http"]["applyPosts"] == report["http"]["claims"] == 1
            assert (
                report["http"]["exactLookupMatches"]
                and report["serverDrained"]
                and report["httpPortReleased"]
            )
            assert not report["forbiddenDispatches"]
            assert {event["name"] for event in report["serverMethods"]} == {
                "engine-apply",
                "native-apply",
            }
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
            await asyncio.to_thread(child.wait, timeout=10)
        if serving is not None and not serving.done():
            serving.cancel()
            await asyncio.gather(serving, return_exceptions=True)
        await engine.close()
        # Capture only imported local source identities for the later fixed
        # dependency inventory; no dynamic import-set expansion at execution.
        native_files = sorted(
            {
                str(Path(module.__file__).resolve())
                for module in sys.modules.values()
                if getattr(module, "__file__", None)
                and str(Path(module.__file__).resolve())
                .lower()
                .startswith("h:\\hindsight\\hindsight-api-slim\\hindsight_api\\")
            }
        )
        report["nativeImportedSources"] = native_files
        control.write_json(control.HERE / "w5-http-checks/fixture-wiring.json", report)
