"""PARENT-RUN ONLY: one retained physical clone, one exact delta apply, synthetic vectors.

The child must not run this entry point. No original PG startup, Core, HTTP,
maintenance or real model. Source files are hashed before/after; only the clone
receives normal executor claim, SQL delta writes and a fresh local password.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import contextvars
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sqlite3
import stat
import subprocess
import sys
import time
from types import SimpleNamespace
import uuid

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
INPUT = REPO / ".trellis/.runtime/w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205"
spec = importlib.util.spec_from_file_location("candidate_audit", HERE / "w5-reentry-candidate-native-audit.py")
candidate_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate_audit)
owner = candidate_audit.audit.owner
NATIVE = Path("H:/hindsight/hindsight-api-slim")
TRANSITION = candidate_audit.TRANSITION
STAGES = contextvars.ContextVar("diagnostic_stage", default=())
REPORT = {"meaning": "Parent-owned physical clone only. Synthetic 384-dimensional vectors; no actual embedding/LLM cost.",
          "networkAttemptsRefused": 0, "realModelCalls": 0, "stages": [], "transactions": [], "sql": {},
          "applyLimitSeconds": 180, "observationSeconds": 60, "applyCalls": 0, "stopped": False}
ACTIVE_SQL = {}
CLONE = None
PORT = None


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def data_manifest(root):
    assert root.is_dir() and not (root / "postmaster.pid").exists(), "SOURCE_NOT_STOPPED"
    assert not getattr(root.lstat(), "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT, "ROOT_REPARSE_POINT_REFUSED"
    assert not any((root / "pg_tblspc").iterdir()), "EXTERNAL_TABLESPACE_REFUSED"
    files = {}; total = 0
    for current, directories, names in os.walk(root, followlinks=False):
        for name in [*directories, *names]:
            path = Path(current) / name
            info = path.lstat()
            assert not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT, "REPARSE_POINT_REFUSED"
            if path.is_file():
                total += info.st_size
                assert total <= 2 * 1024**3, "CLONE_SIZE_LIMIT"
                files[path.relative_to(root).as_posix()] = {"bytes": info.st_size, "sha256": digest(path)}
    return {"files": files, "bytes": total, "count": len(files)}


def verify_input():
    manifest = json.loads((INPUT / "copy-manifest.json").read_bytes())
    for name, expected in manifest["files"].items():
        path = INPUT / name
        assert path.stat().st_size == expected["bytes"] and digest(path) == expected["sha256"], "OFFLINE_INPUT_CHANGED"
    return True


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def emit(value):
    print(json.dumps({"marker": "W5_CANDIDATE_CLONE", **value}), flush=True)


def pg_command(arguments, label, timeout=45):
    assert CLONE is not None and CLONE.is_relative_to(REPO / ".trellis/.runtime")
    with (CLONE / f"{label}.log").open("wb") as output:
        result = subprocess.run([str(owner.inspection.PG_CTL), *arguments], cwd=CLONE,
                                stdout=output, stderr=subprocess.STDOUT, timeout=timeout,
                                creationflags=subprocess.CREATE_NO_WINDOW)
    return result.returncode


def owned_pg():
    path = CLONE / "data/postmaster.pid"
    if not path.exists():
        return False
    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) >= 4 and Path(lines[1]).resolve() == (CLONE / "data").resolve(), "CLONE_PID_PATH_MISMATCH"
    assert int(lines[3]) == PORT, "CLONE_PID_PORT_MISMATCH"
    return True


def connection_refusal_guard():
    original = socket.socket.connect
    original_ex = socket.socket.connect_ex

    def check(address):
        if not isinstance(address, tuple) or len(address) < 2 or address[0] != "127.0.0.1" or address[1] != PORT:
            REPORT["networkAttemptsRefused"] += 1
            raise RuntimeError("NON_CLONE_NETWORK_REFUSED")

    def connect(sock, address):
        check(address); return original(sock, address)

    def connect_ex(sock, address):
        check(address); return original_ex(sock, address)

    # asyncio's Windows socketpair is already constructed when this is called.
    socket.socket.connect = connect; socket.socket.connect_ex = connect_ex
    loop = asyncio.get_running_loop()
    create_connection = loop.create_connection

    async def create_guarded_connection(factory, host=None, port=None, **kwargs):
        # Windows Proactor ConnectEx need not call socket.connect. Guard the
        # asyncio transport seam as well, before its native connection starts.
        check((host, port))
        return await create_connection(factory, host, port, **kwargs)

    loop.create_connection = create_guarded_connection


def stop_clone():
    for mode in ("fast", "immediate"):
        try:
            if not owned_pg():
                return True
            code = pg_command(["-D", str(CLONE / "data"), "-m", mode, "-w", "-t", "30", "stop"], f"stop-{mode}")
            if code == 0 and not (CLONE / "data/postmaster.pid").exists():
                return True
        except Exception as error:
            REPORT.setdefault("cleanupErrors", []).append({"mode": mode, "errorClass": type(error).__name__})
    return False


def timed(name, function):
    async def invoke(*args, **kwargs):
        path = (*STAGES.get(), name)
        token = STAGES.set(path)
        event = {"name": name, "path": list(path), "completed": False}
        REPORT["stages"].append(event)
        started = time.perf_counter()
        try:
            value = await function(*args, **kwargs)
            event["completed"] = True
            return value
        except BaseException as error:
            event["errorClass"] = type(error).__name__
            raise
        finally:
            event["milliseconds"] = (time.perf_counter()-started)*1000
            STAGES.reset(token)
            emit({"stage": name, "completed": event["completed"], "milliseconds": event["milliseconds"],
                  "errorClass": event.get("errorClass")})
    return invoke


def instrument_connection(base):
    class TimedConnection:
        def __getattr__(self, name):
            return getattr(base, name)

        async def call(self, method, query, *args, **kwargs):
            # Source-authored SQL only; never capture bound arguments or returned rows.
            key = method + ":" + " ".join(query.split())
            entry = REPORT["sql"].setdefault(key, {"calls": 0, "milliseconds": 0, "maxMs": 0})
            entry["calls"] += 1
            started = time.perf_counter(); identity = uuid.uuid4().hex
            ACTIVE_SQL[identity] = {"query": key, "stage": list(STAGES.get())}
            try:
                return await getattr(base, method)(query, *args, **kwargs)
            finally:
                elapsed = (time.perf_counter()-started)*1000
                entry["milliseconds"] += elapsed; entry["maxMs"] = max(entry["maxMs"], elapsed)
                ACTIVE_SQL.pop(identity, None)

        async def execute(self, query, *args, **kwargs):
            return await self.call("execute", query, *args, **kwargs)

        async def executemany(self, query, *args, **kwargs):
            return await self.call("executemany", query, *args, **kwargs)

        async def fetch(self, query, *args, **kwargs):
            return await self.call("fetch", query, *args, **kwargs)

        async def fetchrow(self, query, *args, **kwargs):
            return await self.call("fetchrow", query, *args, **kwargs)

        async def fetchval(self, query, *args, **kwargs):
            return await self.call("fetchval", query, *args, **kwargs)

        @asynccontextmanager
        async def transaction(self, **kwargs):
            context = base.transaction(**kwargs)
            await context.__aenter__()
            entry = {"stage": list(STAGES.get()), "committed": False}
            REPORT["transactions"].append(entry)
            started = time.perf_counter(); error_info = (None, None, None)
            try:
                yield self
            except BaseException:
                error_info = sys.exc_info()
                raise
            finally:
                finishing = time.perf_counter()
                try:
                    await context.__aexit__(*error_info)
                    entry["committed"] = error_info[0] is None
                finally:
                    entry["exitMs"] = (time.perf_counter()-finishing)*1000
                    entry["totalMs"] = (time.perf_counter()-started)*1000
    return TimedConnection()


async def run_clone(password):
    connection_refusal_guard()
    sys.path.insert(0, str(NATIVE))
    # No dotenv call and no inherited provider credentials or model configuration.
    for key in list(os.environ):
        if key.startswith("HINDSIGHT_API_") or key.endswith("_API_KEY"):
            os.environ.pop(key, None)
    import asyncpg
    from hindsight_api.config import _get_raw_config
    from hindsight_api.config_resolver import ConfigResolver
    from hindsight_api.engine.db.postgresql import PostgreSQLBackend
    from hindsight_api.engine.entity_resolver import EntityResolver
    from hindsight_api.engine.memories import set_memories
    from hindsight_api.engine.memories.postgres import PostgresMemories
    from hindsight_api.engine.transfer import transition_delta as delta
    from hindsight_api.engine.transfer import transition_delta_application as application
    from hindsight_api.engine import transition_snapshot
    from hindsight_api.engine.transfer.transition_delta_models import TakiTransitionDeltaRequest, transition_delta_hash
    from hindsight_api.engine.transition_models import TakiTransitionClaimRequest
    from hindsight_api.models import RequestContext

    bootstrap = await asyncpg.connect(host="127.0.0.1", port=PORT, database="taki_real", user="taki_real", timeout=10)
    try:
        assert Path(await bootstrap.fetchval("SHOW data_directory")).resolve() == (CLONE / "data").resolve()
        # The value is freshly generated hex, never copied from source custody or
        # passed on a command line. Bootstrap uses only the clone's private HBA.
        assert re.fullmatch(r"[0-9a-f]{64}", password)
        await bootstrap.execute(f"ALTER ROLE taki_real WITH PASSWORD '{password}'")
    finally:
        await bootstrap.close()
    (CLONE / "pg_hba.conf").write_text("host taki_real taki_real 127.0.0.1/32 scram-sha-256\nhost all all 127.0.0.1/32 reject\n", encoding="utf-8")
    assert pg_command(["-D", str(CLONE / "data"), "reload"], "reload") == 0

    class TimedBackend(PostgreSQLBackend):
        @asynccontextmanager
        async def acquire(self):
            async with super().acquire() as conn:
                yield instrument_connection(conn)

        @asynccontextmanager
        async def transaction(self):
            async with self.acquire() as conn, conn.transaction():
                yield conn

    backend = TimedBackend()
    dsn = f"postgresql://taki_real:{password}@127.0.0.1:{PORT}/taki_real"
    await backend.initialize(dsn, min_size=2, max_size=5, command_timeout=180, acquire_timeout=10)
    pool = backend.get_pool()
    REPORT["pool"] = {"minimum": 2, "maximum": 5, "commandTimeoutSeconds": 180, "acquireTimeoutSeconds": 10}
    try:
        set_memories(PostgresMemories({}))
        config = _get_raw_config()
        resolver = EntityResolver(backend, entity_lookup=config.retain_entity_lookup,
            entity_resolution_batch_size=config.retain_entity_resolution_batch_size,
            intrabatch_merge_similarity=config.entity_intrabatch_merge_similarity,
            entity_resolution_max_candidates=config.retain_entity_resolution_max_candidates)
        sqlite = sqlite3.connect((INPUT / "application.sqlite").resolve().as_uri()+"?mode=ro&immutable=1", uri=True)
        try:
            prepared = json.loads(sqlite.execute("SELECT body FROM memory_transition_preparations WHERE transition_id=?", (str(TRANSITION),)).fetchone()[0])
        finally:
            sqlite.close()
        request = TakiTransitionDeltaRequest.model_validate(prepared["request"])
        bank = prepared["scope"]["nativeBankId"]
        assert request.operation_id == candidate_audit.DELTA_OPERATION and request.request_hash == candidate_audit.DELTA_HASH
        assert transition_delta_hash(bank, request) == request.request_hash

        async with backend.acquire() as conn:
            current = await conn.fetchrow("SELECT actor_hash,revision,generation,phase,lease_expires_at<clock_timestamp() expired FROM memory_transition_requests WHERE bank_id=$1 AND transition_id=$2", bank, TRANSITION)
            assert current["phase"] == "fenced" and current["expired"], "NORMAL_CLAIM_NOT_AVAILABLE"
            assert await conn.fetchval("SELECT count(*) FROM memory_transition_deltas WHERE transition_id=$1 OR operation_id=$2", TRANSITION, request.operation_id) == 0
            before = await owner.completed_maintenance(conn)
            # Stored vector width is read from the copied SQL rows, not a model backend.
            dimension = await conn.fetchval("SELECT vector_dims(embedding) FROM memory_units WHERE bank_id=$1 AND embedding IS NOT NULL LIMIT 1", bank)
            assert isinstance(dimension, int) and 1 <= dimension <= 8192
        REPORT["syntheticVectorDimension"] = dimension

        class SyntheticEmbeddings:
            def __init__(self):
                self.dimension = dimension

            def encode_documents(self, texts):
                REPORT.setdefault("syntheticEmbeddingBatches", []).append(len(texts))
                return [[1.0] + [0.0] * (dimension-1) for _text in texts]

            def encode_query(self, _texts):
                raise RuntimeError("QUERY_MODEL_REFUSED")

        async def refuse_config_update(*_args, **_kwargs):
            raise RuntimeError("UNEXPECTED_BANK_CONFIG_MUTATION")

        engine = SimpleNamespace(_config_resolver=ConfigResolver(backend=backend), entity_resolver=resolver,
            embeddings=SyntheticEmbeddings(), _format_readable_date=lambda stamp: stamp.strftime("%B %Y"),
            _validate_bank_config_updates=refuse_config_update)
        table = lambda name: '"' + name + '"'
        service = delta.TransitionDeltaService(engine=engine, backend=backend, fq_table=table,
                                               request_context=RequestContext(), actor_hash=current["actor_hash"])
        claimed = await timed("normal-clone-claim", service.owner.claim)(bank, TRANSITION,
            TakiTransitionClaimRequest(attempt_id=uuid.uuid4(), expected_revision=current["revision"]))
        assert claimed.executor.generation == current["generation"]+1
        request = request.model_copy(update={"executor": claimed.executor})
        assert transition_delta_hash(bank, request) == candidate_audit.DELTA_HASH
        REPORT["identity"] = {"transition": str(TRANSITION), "operation": str(request.operation_id),
                              "requestHash": request.request_hash, "cloneGeneration": claimed.executor.generation}
        service._admit = timed("admit", service._admit)
        service.owner.renew = timed("native-renewal", service.owner.renew)
        transition_snapshot.capture_transition_baseline = timed("baseline", transition_snapshot.capture_transition_baseline)
        for name in ("preflight_transition_delta", "prepare_current_state_rows", "write_transition_native_delta", "write_transition_application_delta"):
            setattr(delta, name, timed(name, getattr(delta, name)))
        predecessor = timed("application-predecessors", application._predecessors)
        application._predecessors = predecessor; delta._predecessors = predecessor
        REPORT["applyCalls"] += 1
        apply_started = time.perf_counter()
        task = asyncio.create_task(timed("full-apply", service.apply)(bank, request))

        async def observe():
            await asyncio.sleep(60)
            REPORT["observation"] = {"elapsedMs": (time.perf_counter()-apply_started)*1000,
                "pending": not task.done(), "activeSql": list(ACTIVE_SQL.values()),
                "activeStages": [entry["path"] for entry in REPORT["stages"] if "milliseconds" not in entry]}
            emit({"observation": REPORT["observation"]})

        observer = asyncio.create_task(observe())
        try:
            result = await asyncio.wait_for(task, timeout=180)
            REPORT["applyCompleted"] = True
            REPORT["result"] = {"requestHash": result.request_hash, "resultHash": result.result_hash,
                                "mappings": len(result.mappings), "artifacts": len(result.artifacts)}
            lookup = await service.lookup(bank, TRANSITION)
            assert lookup == result
            REPORT["exactLookupMatches"] = True
        finally:
            if not observer.done():
                observer.cancel()
            await asyncio.gather(observer, return_exceptions=True)
            REPORT["applyElapsedMs"] = (time.perf_counter()-apply_started)*1000
            if "observation" not in REPORT:
                REPORT["observation"] = {"pending": False, "completedBefore60Seconds": REPORT.get("applyCompleted", False)}
        async with backend.acquire() as conn:
            assert await owner.completed_maintenance(conn) == before, "HISTORICAL_MAINTENANCE_CHANGED"
            REPORT["historicalMaintenancePreserved"] = True
            REPORT["deltaRows"] = await conn.fetchval("SELECT count(*) FROM memory_transition_deltas WHERE transition_id=$1 AND operation_id=$2 AND request_hash=$3", TRANSITION, request.operation_id, request.request_hash)
    finally:
        try:
            await asyncio.wait_for(backend.shutdown(), timeout=10)
        except TimeoutError:
            # The outer finally still stops the owned server; the pool reference
            # may already be cleared by shutdown, so never infer successful drain.
            REPORT["poolShutdownTimedOut"] = True
            pool.terminate()


def main():
    global CLONE, PORT
    assert owner.source_verified()
    assert candidate_audit.pinned_core()["sha256"] == candidate_audit.SOURCE_DB
    assert json.loads((owner.ROOT / "ownership.json").read_bytes())["stopped"]
    verify_input()
    source = (owner.ROOT / "data").resolve()
    before = data_manifest(source)
    assert before["count"] == 1660 and before["bytes"] == 550592708, "REVIEWED_SOURCE_INVENTORY_CHANGED"
    CLONE = (REPO / ".trellis/.runtime" / f"w5-candidate-native-clone-{uuid.uuid4().hex}").resolve()
    assert CLONE.is_relative_to((REPO / ".trellis/.runtime").resolve()) and not CLONE.exists()
    CLONE.mkdir()
    REPORT["root"] = str(CLONE); REPORT["sourceCount"] = before["count"]; REPORT["sourceBytes"] = before["bytes"]
    write_json(CLONE / "source-before.json", before)
    reservation = socket.socket(); reservation.bind(("127.0.0.1", 0)); PORT = reservation.getsockname()[1]
    assert PORT not in {owner.PG_PORT, owner.HTTP_PORT, 18495, 18496}, "PORT_SCOPE_CONFLICT"
    REPORT["port"] = PORT
    password = secrets.token_hex(32)
    try:
        shutil.copytree(source, CLONE / "data", symlinks=False)
        assert data_manifest(CLONE / "data") == before, "CLONE_COPY_MISMATCH"
        # Neutralize inherited PG includes, auto-settings, HBA and ident paths.
        # No source config, password file, DPAPI blob or model config is read.
        (CLONE / "data/postgresql.auto.conf").write_text("# Isolated diagnostic defaults.\n", encoding="utf-8")
        (CLONE / "pg_hba.conf").write_text("host taki_real taki_real 127.0.0.1/32 trust\nhost all all 127.0.0.1/32 reject\n", encoding="utf-8")
        (CLONE / "pg_ident.conf").write_text("", encoding="utf-8")
        (CLONE / "postgresql.conf").write_text("password_encryption='scram-sha-256'\nautovacuum=off\nlogging_collector=off\n", encoding="utf-8")
        write_json(CLONE / "ownership.json", {"kind": "candidate-diagnostic-clone", "data": str(CLONE / "data"), "port": PORT, "stopped": False})
        options = f'-p {PORT} -h 127.0.0.1 -c config_file="{CLONE.as_posix()}/postgresql.conf" -c data_directory="{CLONE.as_posix()}/data" -c hba_file="{CLONE.as_posix()}/pg_hba.conf" -c ident_file="{CLONE.as_posix()}/pg_ident.conf" -c shared_preload_libraries= -c lc_messages=C'
        reservation.close()
        assert pg_command(["-D", str(CLONE / "data"), "-l", str(CLONE / "postgres.log"), "-o", options, "-w", "-t", "30", "start"], "start") == 0
        assert owned_pg()
        REPORT["started"] = True
        asyncio.run(run_clone(password))
    except BaseException as error:
        REPORT["errorClass"] = type(error).__name__
        # Closed native reason only; never print provider/SQL error text.
        reason = getattr(error, "reason", None)
        if isinstance(reason, str) and re.fullmatch(r"[a-z_]{1,80}", reason):
            REPORT["nativeReason"] = reason
    finally:
        reservation.close()
        REPORT["stopped"] = stop_clone()
        checks = {"sourcePreserved": lambda: data_manifest(source) == before,
                  "inputPreserved": verify_input,
                  "corePreserved": lambda: candidate_audit.pinned_core()["sha256"] == candidate_audit.SOURCE_DB,
                  "originalPreserved": lambda: bool(owner.source_verified())}
        for key, check in checks.items():
            try:
                REPORT[key] = check()
            except Exception as error:
                REPORT[key] = False
                REPORT.setdefault("preservationErrors", []).append({"check": key, "errorClass": type(error).__name__})
        write_json(CLONE / "ownership.json", {"kind": "candidate-diagnostic-clone", "data": str(CLONE / "data"), "port": PORT, "stopped": REPORT["stopped"]})
        write_json(CLONE / "result.json", REPORT)
        emit({"result": str(CLONE / "result.json"), "stopped": REPORT["stopped"], "sourcePreserved": REPORT["sourcePreserved"],
              "applyCompleted": REPORT.get("applyCompleted", False), "errorClass": REPORT.get("errorClass")})
    assert REPORT["stopped"] and REPORT["sourcePreserved"] and REPORT["inputPreserved"] and REPORT["corePreserved"]
    assert "errorClass" not in REPORT, "CLONE_DIAGNOSTIC_FAILED"


if __name__ == "__main__":
    main()
