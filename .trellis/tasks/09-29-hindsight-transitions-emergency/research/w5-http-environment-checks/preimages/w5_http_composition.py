"""One real HTTP adapter over the frozen clone/migration lifecycle; no import-time work."""

from __future__ import annotations

import asyncio
import os
import re
import socket
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import w5_actual_embedding_composition as models
import w5_actual_embedding_control as control
import w5_http_inventory as inventory

API_KEY = "w5-owned-healthy-fixture"
SETTINGS = {
    "HINDSIGHT_API_WORKER_ENABLED": "false",
    "HINDSIGHT_API_SKIP_LLM_VERIFICATION": "true",
    "HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS": "0",
    "HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS": "0",
    "HINDSIGHT_API_AUDIT_LOG_RETENTION_DAYS": "-1",
    "HINDSIGHT_API_LLM_TRACE_RETENTION_DAYS": "-1",
    "HINDSIGHT_API_OPERATION_RETENTION_DAYS": "0",
    "HINDSIGHT_API_AUDIT_LOG_ENABLED": "false",
    "HINDSIGHT_API_LLM_TRACE_ENABLED": "false",
}


def network_guard(clone: Any) -> None:
    """PG-only outbound traffic plus thread-local asyncio socketpair creation."""
    original_connect, original_connect_ex, original_pair = (
        socket.socket.connect,
        socket.socket.connect_ex,
        socket.socketpair,
    )
    internal = threading.local()

    def check(address: Any) -> None:
        if getattr(internal, "socketpair", False):
            return
        if not isinstance(address, tuple) or address[:2] != ("127.0.0.1", clone.PORT):
            clone.REPORT["networkAttemptsRefused"] += 1
            raise RuntimeError("NON_CLONE_NETWORK_REFUSED")

    def connect(sock: Any, address: Any) -> Any:
        check(address)
        return original_connect(sock, address)

    def connect_ex(sock: Any, address: Any) -> Any:
        check(address)
        return original_connect_ex(sock, address)

    def pair(*args: Any, **kwargs: Any) -> Any:
        internal.socketpair = True
        try:
            return original_pair(*args, **kwargs)
        finally:
            internal.socketpair = False

    setattr(socket.socket, "connect", connect)
    setattr(socket.socket, "connect_ex", connect_ex)
    setattr(socket, "socketpair", pair)
    loop = asyncio.get_running_loop()
    original_create = loop.create_connection

    async def create(
        factory: Any, host: Any = None, port: Any = None, **kwargs: Any
    ) -> Any:
        check((host, port))
        return await original_create(factory, host, port, **kwargs)

    setattr(loop, "create_connection", create)


def configure() -> None:
    os.environ.update(SETTINGS)
    from hindsight_api.config import clear_config_cache

    clear_config_cache()


@contextmanager
def no_background(report: dict[str, Any]) -> Any:
    """Refuse any accidental paid call or background dispatch, before construction."""
    from hindsight_api.engine.llm_wrapper import ConfiguredLLMProvider, LLMProvider
    from hindsight_api.engine.maintenance import MaintenanceLoop
    from hindsight_api.engine.multi_llm import MultiLLMProvider
    from hindsight_api.engine.task_backend import SyncTaskBackend
    from hindsight_api.engine.transition_maintenance import TransitionMaintenanceService

    restored = []
    report["forbiddenDispatches"] = []

    def guard(kind: str) -> Any:
        async def refuse(*_args: Any, **_kwargs: Any) -> Any:
            report["forbiddenDispatches"].append(kind)
            raise RuntimeError("HTTP_DIAGNOSTIC_DISPATCH_REFUSED")

        return refuse

    targets = [
        (LLMProvider, name) for name in ("call", "call_with_tools", "verify_connection")
    ]
    targets += [(ConfiguredLLMProvider, name) for name in ("call", "call_with_tools")]
    targets += [
        (MultiLLMProvider, name)
        for name in ("call", "call_with_tools", "verify_connection")
    ]
    targets += [
        (SyncTaskBackend, "submit_task"),
        (MaintenanceLoop, "_run"),
        (TransitionMaintenanceService, "verify_transition"),
    ]
    try:
        for owner, name in targets:
            restored.append((owner, name, getattr(owner, name)))
            setattr(owner, name, guard(f"{owner.__name__}.{name}"))
        yield
    finally:
        for owner, name, original in reversed(restored):
            setattr(owner, name, original)


def maintenance_disabled(engine: Any, *, initialized: bool) -> None:
    from hindsight_api.config import get_config
    from hindsight_api.engine.maintenance import MaintenanceLoop
    from hindsight_api.engine.memories import get_memories

    assert get_memories().writes_memory_rows_in_sql, "HTTP_REQUIRES_SQL_STORE"
    assert not MaintenanceLoop._cross_store_recovery_enabled(), (
        "HTTP_CROSS_STORE_RECOVERY_ENABLED"
    )
    assert not MaintenanceLoop._any_job_enabled(), "HTTP_MAINTENANCE_ENABLED"
    assert not get_config().worker_enabled and engine._skip_llm_verification, (
        "HTTP_WORKER_OR_VERIFICATION_ENABLED"
    )
    if initialized:
        assert (
            engine._maintenance_loop is not None
            and engine._maintenance_loop._task is None
        )


def timed(report: dict[str, Any], name: str, function: Any) -> Any:
    async def invoke(*args: Any, **kwargs: Any) -> Any:
        event = {"name": name, "started": time.perf_counter(), "completed": False}
        report.setdefault("serverMethods", []).append(event)
        try:
            value = await function(*args, **kwargs)
            event["completed"] = True
            return value
        finally:
            event["milliseconds"] = (time.perf_counter() - event["started"]) * 1000

    return invoke


class ObservedASGI:
    def __init__(self, app: Any, report: dict[str, Any]) -> None:
        self.app, self.report = app, report

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        event = {
            "method": scope["method"],
            "path": scope["path"],
            "started": time.perf_counter(),
            "bytes": 0,
        }
        self.report.setdefault("asgi", []).append(event)

        async def observed(message: Any) -> None:
            if message["type"] == "http.response.start":
                event["status"] = message["status"]
                event["responseStartMilliseconds"] = (
                    time.perf_counter() - event["started"]
                ) * 1000
            elif message["type"] == "http.response.body":
                event["bytes"] += len(message.get("body", b""))
                if not message.get("more_body", False):
                    event["finalBodyMilliseconds"] = (
                        time.perf_counter() - event["started"]
                    ) * 1000
            await send(message)

        try:
            await self.app(scope, receive, observed)
        finally:
            event["milliseconds"] = (time.perf_counter() - event["started"]) * 1000


async def serve_engine(
    engine: Any,
    job: Path,
    request_input: dict[str, Any],
    report: dict[str, Any],
    *,
    clone_path: Path,
    pg_port: int,
    initialization_started: float,
) -> None:
    """Real socket/server. Parent alone launches Node and publishes its exit record."""
    import uvicorn
    from hindsight_api.api.http import create_app
    from hindsight_api.engine.transfer.transition_delta import TransitionDeltaService

    listener = socket.socket()
    port = None
    engine_apply = engine.apply_taki_transition_delta
    native_apply = TransitionDeltaService.apply
    engine.apply_taki_transition_delta = timed(report, "engine-apply", engine_apply)
    TransitionDeltaService.apply = timed(report, "native-apply", native_apply)
    server = None
    serving = None
    try:
        if os.name == "nt":
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        assert port not in {pg_port, 18495, 18496}, "HTTP_PORT_REFUSED"
        listener.listen(128)
        report["httpPort"] = port
        server = uvicorn.Server(
            uvicorn.Config(
                ObservedASGI(create_app(engine, initialize_memory=False), report),
                lifespan="off",
                log_level="error",
                access_log=False,
                timeout_graceful_shutdown=20,
            )
        )
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        while not server.started:
            assert time.monotonic() - initialization_started < control.INIT_SECONDS, (
                "HTTP_INITIALIZATION_TIMEOUT"
            )
            if serving.done():
                await serving
                raise RuntimeError("HTTP_SERVER_START_FAILED")
            await asyncio.sleep(0.025)
        elapsed = time.monotonic() - initialization_started
        assert elapsed < control.INIT_SECONDS, "HTTP_INITIALIZATION_TIMEOUT"
        report["initializationMilliseconds"] = elapsed * 1000
        control.write_json(
            job / "http-initialization.json",
            {
                "monotonic": initialization_started,
                "ready": True,
                "milliseconds": elapsed * 1000,
            },
        )
        request_input = {**request_input, "endpoint": f"http://127.0.0.1:{port}"}
        control.write_json(job / "http-input.json", request_input)
        control.write_json(
            job / "http-ready.json",
            {
                "job": str(job.resolve()),
                "clone": str(clone_path.resolve()),
                "endpoint": request_input["endpoint"],
                "python": control.read_json(job / "child.json"),
                "inputSha256": control.digest(job / "http-input.json"),
                "actorVerified": True,
            },
        )
        started = time.monotonic()
        while not (job / "node-exit.json").exists():
            assert time.monotonic() - started < 180, "HTTP_NODE_RESULT_TIMEOUT"
            if serving.done():
                await serving
                raise RuntimeError("HTTP_SERVER_STOPPED_EARLY")
            await asyncio.sleep(0.05)
        node_exit = control.read_json(job / "node-exit.json")
        report["nodeExit"] = node_exit
        node_result = control.read_json(job / "http-node-result.json")
        assert isinstance(node_result, dict), "HTTP_NODE_REPORT_INVALID"
        report["http"] = node_result
        report["applyCompleted"] = node_result.get("applyCompleted") is True
        report["exactLookupMatches"] = node_result.get("exactLookupMatches") is True
    finally:
        if server is not None:
            server.should_exit = True
        try:
            if serving is not None:
                await asyncio.wait_for(asyncio.shield(serving), timeout=25)
            report["serverDrained"] = True
        except BaseException:
            if server is not None:
                server.force_exit = True
            if serving is not None:
                serving.cancel()
                await asyncio.gather(serving, return_exceptions=True)
            report["serverDrained"] = False
        finally:
            listener.close()
            report["httpPortReleased"] = port is None or control.port_released(port)
            engine.apply_taki_transition_delta = engine_apply
            TransitionDeltaService.apply = native_apply


async def bootstrap_clone(clone: Any, password: str) -> str:
    import asyncpg

    conn = await asyncpg.connect(
        host="127.0.0.1",
        port=clone.PORT,
        database="taki_real",
        user="taki_real",
        timeout=10,
    )
    try:
        assert (
            Path(await conn.fetchval("SHOW data_directory")).resolve()
            == clone.CLONE / "data"
        )
        assert re.fullmatch(r"[0-9a-f]{64}", password)
        await conn.execute(f"ALTER ROLE taki_real WITH PASSWORD '{password}'")
    finally:
        await conn.close()
    (clone.CLONE / "pg_hba.conf").write_text(
        "host taki_real taki_real 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject\n",
        encoding="utf-8",
    )
    assert clone.pg_command(["-D", str(clone.CLONE / "data"), "reload"], "reload") == 0
    return f"postgresql://taki_real:{password}@127.0.0.1:{clone.PORT}/taki_real"


async def run_clone(
    clone: Any, job: Path, password: str, model_report: dict[str, Any]
) -> None:
    configure()
    dsn = await bootstrap_clone(clone, password)
    started = time.monotonic()
    control.write_json(
        job / "http-initialization.json", {"monotonic": started, "ready": False}
    )
    report = clone.REPORT
    engine = None
    with no_background(report):
        try:
            model = await models.initialize_model(job, model_report)
            from hindsight_api.engine.memories import set_memories
            from hindsight_api.engine.memories.postgres import PostgresMemories
            from hindsight_api.engine.memory_engine import MemoryEngine
            from hindsight_api.engine.task_backend import SyncTaskBackend
            from hindsight_api.engine.transfer.transition_delta_models import (
                TakiTransitionDeltaRequest,
                transition_delta_hash,
            )
            from hindsight_api.extensions.builtin.tenant import ApiKeyTenantExtension
            from hindsight_api.models import RequestContext

            set_memories(PostgresMemories({}))
            engine = MemoryEngine(
                db_url=dsn,
                embeddings=model,
                memory_llm_api_key="inert-no-paid-provider-access",
                run_migrations=False,
                skip_llm_verification=True,
                task_backend=SyncTaskBackend(),
                pool_min_size=2,
                pool_max_size=5,
                db_command_timeout=180,
                db_acquire_timeout=10,
                tenant_extension=ApiKeyTenantExtension({"api_key": API_KEY}),
            )
            maintenance_disabled(engine, initialized=False)
            await engine.initialize()
            maintenance_disabled(engine, initialized=True)
            assert engine.embeddings is model
            assert engine._backend is not None
            report["normalReadiness"] = {
                "reranker": type(engine._cross_encoder_reranker.cross_encoder).__name__,
                "queryAnalyzer": type(engine.query_analyzer).__name__,
                "maintenanceDisabled": True,
            }
            cross_encoder = engine._cross_encoder_reranker.cross_encoder
            report["normalReadiness"]["rerankerModel"] = getattr(
                cross_encoder, "model_name", None
            )
            report["normalReadiness"]["rerankerInitialized"] = (
                engine._cross_encoder_reranker._initialized
            )
            # The revision is read from the actual loaded transformer config;
            # cache directory existence alone is not readiness evidence.
            loaded = getattr(cross_encoder, "_model", None)
            loaded_config = getattr(getattr(loaded, "model", None), "config", None)
            revision = getattr(loaded_config, "_commit_hash", None)
            assert (
                type(cross_encoder).__name__ == "LocalSTCrossEncoder"
                and loaded is not None
                and isinstance(revision, str)
                and re.fullmatch(r"[a-f0-9]{40}", revision)
            ), "HTTP_NORMAL_LOCAL_RERANKER_UNPROVEN"
            report["normalReadiness"]["rerankerCacheRevision"] = revision
            with sqlite3.connect(
                (clone.INPUT / "application.sqlite").resolve().as_uri()
                + "?mode=ro&immutable=1",
                uri=True,
            ) as db:
                prepared = __import__("json").loads(
                    db.execute(
                        "SELECT body FROM memory_transition_preparations WHERE transition_id=?",
                        (str(clone.TRANSITION),),
                    ).fetchone()[0]
                )
            request = TakiTransitionDeltaRequest.model_validate(prepared["request"])
            bank = prepared["scope"]["nativeBankId"]
            assert request.operation_id == clone.candidate_audit.DELTA_OPERATION
            assert request.executor.transition_id == clone.TRANSITION
            assert (
                request.request_hash
                == transition_delta_hash(bank, request)
                == clone.candidate_audit.DELTA_HASH
            )
            service = await engine._transition_service(
                bank, RequestContext(api_key=API_KEY), source_evidence=True
            )
            async with engine._backend.acquire() as conn:
                current = await conn.fetchrow(
                    "SELECT actor_hash,revision,generation,phase,lease_expires_at<clock_timestamp() expired FROM memory_transition_requests WHERE bank_id=$1 AND transition_id=$2",
                    bank,
                    clone.TRANSITION,
                )
                assert current is not None, "HTTP_TRANSITION_MISSING"
                assert current["actor_hash"] == service.owner.actor_hash, (
                    "HTTP_ACTOR_MISMATCH"
                )
                assert current["phase"] == "fenced" and current["expired"], (
                    "HTTP_NORMAL_CLAIM_UNAVAILABLE"
                )
                assert (
                    await conn.fetchval(
                        "SELECT count(*) FROM memory_transition_deltas WHERE transition_id=$1 OR operation_id=$2",
                        clone.TRANSITION,
                        request.operation_id,
                    )
                    == 0
                )
                before = await clone.owner.completed_maintenance(conn)
                dimension = await conn.fetchval(
                    "SELECT vector_dims(embedding) FROM memory_units WHERE bank_id=$1 AND embedding IS NOT NULL LIMIT 1",
                    bank,
                )
                assert dimension == model.dimension, "HTTP_VECTOR_DIMENSION_MISMATCH"
            report["actorVerified"] = True
            http_failure = None
            try:
                await serve_engine(
                    engine,
                    job,
                    {
                        "bank": bank,
                        "transition": str(clone.TRANSITION),
                        "request": request.model_dump(mode="json"),
                        "requestHash": request.request_hash,
                        "expectedRevision": current["revision"],
                        "originalGeneration": current["generation"],
                    },
                    report,
                    clone_path=clone.CLONE,
                    pg_port=clone.PORT,
                    initialization_started=started,
                )
            except Exception as error:
                # A missing/malformed Node report must not skip the post-drain
                # database audit. Its late receipt never changes HTTP failure.
                http_failure = error
                report["httpFailure"] = type(error).__name__
            assert report["serverDrained"], "HTTP_SERVER_DRAIN_FAILED"
            async with engine._backend.acquire() as conn:
                assert await clone.owner.completed_maintenance(conn) == before, (
                    "HTTP_MAINTENANCE_CHANGED"
                )
                report["historicalMaintenancePreserved"] = True
                row = await conn.fetchrow(
                    "SELECT result FROM memory_transition_deltas WHERE transition_id=$1 AND operation_id=$2 AND request_hash=$3",
                    clone.TRANSITION,
                    request.operation_id,
                    request.request_hash,
                )
                report["deltaRows"] = 1 if row is not None else 0
                if row is not None:
                    from hindsight_api.engine.transfer.transition_delta_models import (
                        TakiTransitionDeltaResult,
                    )

                    value = TakiTransitionDeltaResult.model_validate(
                        conn.parse_json(row["result"])
                    )
                    report["persistedDelta"] = {
                        "requestHash": value.request_hash,
                        "resultHash": value.result_hash,
                        "mappings": len(value.mappings),
                        "artifacts": len(value.artifacts),
                    }
                    if report.get("exactLookupMatches"):
                        assert report["persistedDelta"] == {
                            key: report["http"][key] for key in report["persistedDelta"]
                        }
            assert not report["forbiddenDispatches"]
            if http_failure is not None:
                raise http_failure
        finally:
            if engine is not None:
                pool = engine._pool
                try:
                    await asyncio.wait_for(engine.close(), timeout=20)
                    report["engineClosed"] = True
                except BaseException:
                    report["engineClosed"] = False
                    if pool is not None:
                        pool.terminate()
            control.write_json(job / "embedding.json", model_report)
            models.phase(job, "cleanup")


def run_child(job: Path) -> None:
    os.environ.clear()
    os.environ.update(control.child_environment(job))
    os.environ.update(SETTINGS)
    source = inventory.verify_inventory(
        control.read_json(job / "job.json")["sourceManifestSha256"]
    )
    control.write_json(job / "inventory-python-before.json", source)
    # Reuse only frozen source adaptation and PG lifecycle. The old direct-model
    # run closure is replaced before the rehearsal captures/calls run_clone.
    old_entry = control.load("w5_http_sealed_entry", "w5-native-view-postpatch.py")
    old_entry.inventory = type(
        "InventoryAdapter",
        (),
        {
            "MANIFEST": inventory.MANIFEST,
            "verify_inventory": staticmethod(
                lambda expected=None: __import__(
                    "w5_native_view_inventory"
                ).VerifiedInventory(
                    sha256=str(inventory.verify_inventory(expected)["sha256"]),
                    entries=int(inventory.verify_inventory(expected)["entries"]),
                    inherited_manifests=9,
                )
            ),
        },
    )
    model_report: dict[str, Any] = {}
    from w5_native_view_inventory import VerifiedInventory

    view_source = VerifiedInventory(source["sha256"], source["entries"], 9)
    try:
        with old_entry.composition(view_source, []):
            rehearsal = control.load(
                "w5_http_rehearsal", "w5-trigger-uuid-migration-rehearsal.py"
            )
            original_load = rehearsal.load

            def load(name: str, filename: str) -> Any:
                module = original_load(name, filename)
                if filename == "w5-reentry-candidate-native-clone.py":
                    models.install(module, job, model_report)
                    module.connection_refusal_guard = lambda: network_guard(module)
                    module.run_clone = lambda password: run_clone(
                        module, job, password, model_report
                    )
                elif filename == "w5-candidate-trigger-readonly-diagnostic-v3.py":
                    original_result = module.write_result

                    def writer(path: Path, value: Any) -> None:
                        result = dict(value)
                        result.update(
                            meaning="Isolated genuine HTTP request diagnostic; no authority replacement",
                            embeddings=model_report,
                            actualDocumentEncodingCalls=len(
                                model_report.get("documentBatches", [])
                            ),
                            syntheticEncoderNeverCalled=model_report.get(
                                "syntheticEncoderCalls", 0
                            )
                            == 0,
                            httpOrAuthorityRecoveryProven=False,
                        )
                        for key in (
                            "syntheticVectorDimension",
                            "syntheticEmbeddingBatches",
                            "applyLimitSeconds",
                        ):
                            result.pop(key, None)
                        original_result(path, result)

                    module.write_result = writer
                return module

            rehearsal.load = load
            rehearsal.run_reviewed(with_apply=True)
    finally:
        try:
            after = inventory.verify_inventory(source["sha256"])
        except BaseException as error:
            after = {"verified": False, "errorClass": type(error).__name__}
        control.write_json(job / "inventory-python-after.json", after)
