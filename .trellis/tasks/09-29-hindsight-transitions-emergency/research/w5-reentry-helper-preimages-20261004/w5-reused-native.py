"""Own the W5 copied corpus, inspect its finite plan, and serve the real healthy driver.

The preserved pair is never started. Provider credentials remain in existing custody;
private output contains payload-bearing diagnostics, public output contains only counts.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import importlib.util
import json
import logging
import math
import os
import shutil
import socket
import subprocess
import sys
import traceback
import uuid
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("w5_reuse_inspection", HERE / "inspect-native-reuse.py")
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)
shutdown_spec = importlib.util.spec_from_file_location("w5_supervisor_shutdown", HERE / "w5-supervisor-shutdown.py")
shutdown = importlib.util.module_from_spec(shutdown_spec)
shutdown_spec.loader.exec_module(shutdown)
BASE = inspection.BASELINE
SOURCE = BASE / "application-ad325c12054d4d92b91a81ad2b18fee1"
ROOT = BASE / "w5-healthy-a7ffc67a1666400b8cc7e890d837cb97"
MANIFEST = BASE / "w5-source-preflight-836b286e43414523a304cdbe8f25f84e.json"
PG_PORT, HTTP_PORT = 18495, 18496
VALIDATION = inspection.REPO / ".trellis/tasks/08-09-hindsight-initial-cutover/research/validation"


def source_verified() -> list[dict]:
    assert hashlib.sha256(MANIFEST.read_bytes()).hexdigest() == "d27ab04843cd82e1d574b06dda5512ad469bb85a541887414a8ce8707499ab1d"
    entries = json.loads(MANIFEST.read_text(encoding="utf-8"))["entries"]
    assert hashlib.sha256(json.dumps(entries, sort_keys=True, separators=(",", ":")).encode()).hexdigest() == "74cc2fe781e364fc551d2514410df8d5251c0a6afe8957a2d2caba22348d10a6"
    assert not (SOURCE / "data/postmaster.pid").exists()
    actual = []
    for item in sorted(SOURCE.rglob("*")):
        if not item.is_file() or not (item.is_relative_to(SOURCE / "data") or item.name.startswith("application.sqlite")):
            continue
        assert not item.lstat().st_file_attributes & 0x400
        before = item.stat()
        digest = hashlib.sha256(item.read_bytes()).hexdigest()
        after = item.stat()
        assert (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
        actual.append({"path": item.relative_to(SOURCE).as_posix(), "bytes": before.st_size, "sha256": digest})
    assert sorted(actual, key=lambda row: row["path"]) == sorted(entries, key=lambda row: row["path"])
    inspection.check_baseline()
    return entries


def prepare() -> None:
    entries = source_verified()
    if ROOT.exists():
        owner = json.loads((ROOT / "ownership.json").read_text(encoding="utf-8"))
        assert owner["root"] == str(ROOT) and owner["source"] == str(SOURCE) and owner["stopped"]
        assert not (ROOT / "data/postmaster.pid").exists()
        return
    ROOT.mkdir()
    shutil.copytree(SOURCE / "data", ROOT / "data")
    shutil.copy2(SOURCE / "application.sqlite", ROOT / "application.sqlite")
    for item in entries:
        path = ROOT / item["path"]
        assert path.stat().st_size == item["bytes"] and hashlib.sha256(path.read_bytes()).hexdigest() == item["sha256"]
    inspection.write_json(ROOT / "ownership.json", {"root": str(ROOT), "source": str(SOURCE), "stopped": True,
                                                   "pgPort": PG_PORT, "httpPort": HTTP_PORT})


async def completed_maintenance(conn) -> dict:
    """Hash durable completed work, without exposing real memory payloads in the report."""
    result = {}
    for name, predicate in (("steps", "WHERE state='complete'"), ("actions", "")):
        rows = await conn.fetch(f"SELECT to_jsonb(t)::text AS body FROM memory_transition_{name} t {predicate}")
        result[name] = sorted(hashlib.sha256(row["body"].encode()).hexdigest() for row in rows)
    return result


async def execute(password: str, mode: str, summary: dict, *, stage: str = "all", submission_cap: int = 240) -> None:
    import uvicorn
    from sqlalchemy import URL
    from hindsight_api.api import create_app
    from hindsight_api.engine.db_utils import acquire_with_retry
    from hindsight_api.engine.logical_snapshot import _load_snapshot_source
    from hindsight_api.engine.maintenance_candidate import enumerate_maintenance_requirements
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.replication import MentalModelLogicalPayload
    from hindsight_api.engine.schema import fq_table
    from hindsight_api.engine.task_backend import SyncTaskBackend
    from hindsight_api.extensions.builtin.tenant import ApiKeyTenantExtension
    from hindsight_api.models import RequestContext
    from real_hindsight_network import install_guard, observation_status, observe_model_calls

    url = URL.create("postgresql", username="taki_real", password=password, host="127.0.0.1",
                     port=PG_PORT, database="taki_real").render_as_string(hide_password=False)
    listener = socket.socket()
    listener.bind(("127.0.0.1", HTTP_PORT)); listener.listen(128)
    install_guard(PG_PORT, listener, model_access=mode == "run")
    observe_model_calls(ROOT)
    engine = MemoryEngine(db_url=url, run_migrations=False, task_backend=SyncTaskBackend(),
                          tenant_extension=ApiKeyTenantExtension({"api_key": "w5-owned-healthy-fixture"}))
    server = None; serving = None; process = None; completed_before = None
    try:
        await engine.initialize()
        async with acquire_with_retry(engine._backend) as conn:
            assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (ROOT / "data").resolve()
            before = await inspection.snapshot(conn)
            inspection.write_json(ROOT / f"{mode}-before-tables.json", before)
            completed_before = await completed_maintenance(conn)
            inspection.write_json(ROOT / f"{mode}-before-completed.json", completed_before)
            banks = await conn.fetch("SELECT bank_id FROM replication_bank_state WHERE deleted_at IS NULL ORDER BY bank_id")
            plans = []
            for row in banks:
                bank_id = row["bank_id"]
                source = await _load_snapshot_source(conn=conn, fq_table=fq_table, bank_id=bank_id)
                config = await engine._config_resolver.resolve_full_config(bank_id, RequestContext())
                assert config.enable_observations, "REQUIRED_REAL_OBSERVATIONS_MUST_REMAIN_ENABLED"
                refreshable = [record for record in source.records if not isinstance(record.payload, MentalModelLogicalPayload) or record.payload.source_query]
                requirements = enumerate_maintenance_requirements(refreshable, "0" * 64)
                records = {(record.object_kind, record.object_id): record for record in source.records}
                groups = Counter((tuple(sorted(records[(r.input.object_kind, r.input.object_id)].payload.tags)), tuple(r.scope_tags))
                                 for r in requirements if r.kind == "source_scope")
                plans.append({"bankOrdinal": len(plans) + 1, "sourceScopeRequirements": sum(groups.values()),
                              "sourceBatches": sum(math.ceil(count / max(1, config.consolidation_llm_batch_size)) for count in groups.values()),
                              "batchSize": config.consolidation_llm_batch_size,
                              "models": sum(r.kind == "mental_model" for r in requirements),
                              "nativeRecords": len(source.records), "observationsEnabled": config.enable_observations})
            summary["plan"] = plans
            inspection.write_json(ROOT / f"{mode}-plan.json", {"banks": plans, "tokens": None, "cost": None})
        if mode == "inspect":
            return
        # Preserve native retry semantics while blocking unproductive real HTTP after the first402.
        # The durable cap and latch remain in force across restarts; no automatic account-readiness probe.
        import httpx
        send = httpx.AsyncClient.send
        budget_spec = importlib.util.spec_from_file_location("w5_model_budget", HERE / "w5-model-budget.py")
        budget_module = importlib.util.module_from_spec(budget_spec)
        budget_spec.loader.exec_module(budget_module)
        budget = budget_module.ModelSubmissionBudget(ROOT, summary, cap=submission_cap)
        async def bounded_send(client, request, *args, **kwargs):
            return await budget.send(send, client, request, *args, **kwargs)
        httpx.AsyncClient.send = bounded_send
        server = uvicorn.Server(uvicorn.Config(create_app(engine, initialize_memory=False), lifespan="off", log_level="error",
            access_log=False, timeout_graceful_shutdown=shutdown.GRACEFUL_SECONDS))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        while not server.started:
            if serving.done(): await serving
            await asyncio.sleep(0.025)
        env = {key: value for key, value in os.environ.items() if key.upper() in {"PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERNAME", "USERPROFILE"}}
        with (ROOT / "driver-node.log").open("w", encoding="utf-8") as output:
            process = await asyncio.create_subprocess_exec(shutil.which("node"), str(HERE / "w5-reused-driver.mjs"), str(ROOT),
                f"http://127.0.0.1:{HTTP_PORT}", mode, stage, cwd=inspection.REPO, env=env, stdin=asyncio.subprocess.DEVNULL,
                stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW)
            summary["nodeExit"] = await asyncio.wait_for(process.wait(), timeout=14_400)
    finally:
        async def post_audit():
            async with acquire_with_retry(engine._backend) as conn:
                inspection.write_json(ROOT / f"{mode}-after-tables.json", await inspection.snapshot(conn))
                completed_after = await completed_maintenance(conn)
                inspection.write_json(ROOT / f"{mode}-after-completed.json", completed_after)
                if completed_before is not None:
                    # Completed steps and factual actions are append-only across executor takeover.
                    # A passing operation alone must not hide replacement of the original nine steps.
                    for name, values in completed_before.items():
                        assert not (Counter(values) - Counter(completed_after[name])), "COMPLETED_NATIVE_WORK_CHANGED"
                    summary["preservedCompletedSteps"] = len(completed_before["steps"])
                    summary["preservedActions"] = len(completed_before["actions"])
        await shutdown.finish_execution(process=process, server=server, serving=serving, listener=listener,
            engine=engine, post_audit=post_audit, observation_status=observation_status, summary=summary,
            primary_error=sys.exc_info()[1])


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("mode", choices=["prepare", "inspect", "connect", "run"])
    parser.add_argument("--stage", choices=["all", "return", "reentry"], default="all")
    parser.add_argument("--submission-cap", type=int, default=240)
    args = parser.parse_args(); mode = args.mode
    if args.submission_cap <= 0:
        parser.error("--submission-cap must be a positive finite cumulative ceiling")
    prepare()
    if mode == "prepare":
        print(json.dumps({"prepared": True, "root": str(ROOT), "pgPort": PG_PORT, "httpPort": HTTP_PORT})); return 0
    sys.path[:0] = [str(VALIDATION), str(inspection.NATIVE / "hindsight-api-slim")]
    attempt_id = uuid.uuid4().hex
    retained = ROOT / "attempt-history" / attempt_id
    retained.mkdir(parents=True)
    for filename in (f"{mode}-result.json", f"{mode}-native.log", f"{mode}-failure.log", f"{mode}-before-tables.json",
                     f"{mode}-after-tables.json", f"{mode}-before-completed.json", f"{mode}-after-completed.json",
                     f"{mode}-plan.json", "driver-result.json", "driver-failure.log", "driver-node.log"):
        if (ROOT / filename).exists(): shutil.copy2(ROOT / filename, retained / filename)
    from real_hindsight_environment import crypt_bytes, model_environment
    environment = model_environment(ROOT)
    os.environ.clear(); os.environ.update(environment)
    os.environ.update(HINDSIGHT_API_SKIP_LLM_VERIFICATION="true", HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS="0",
                      HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS="0", HINDSIGHT_API_LLM_TRACE_RETENTION_DAYS="-1",
                      HINDSIGHT_API_AUDIT_LOG_RETENTION_DAYS="-1", HINDSIGHT_API_AUDIT_LOG_ENABLED="false",
                      LITELLM_LOCAL_MODEL_COST_MAP="True", TIKTOKEN_CACHE_DIR=str(inspection.REPO / ".trellis/.runtime/b6-continuation-20260911/tokenizer-cache"))
    sys.modules["winloop"] = None
    private = json.loads(crypt_bytes((inspection.HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    summary = {"root": str(ROOT), "source": str(SOURCE), "mode": mode, "attemptId": attempt_id, "pgPort": PG_PORT, "httpPort": HTTP_PORT,
               "stage": args.stage, "submissionCap": args.submission_cap,
               "started": False, "stopped": False, "modelRequests": 0, "tokens": None, "cost": None, "conversionExecuted": False}
    try:
        assert inspection.command(ROOT, [str(inspection.PG_CTL), "-D", str(ROOT / "data"), "-l", str(ROOT / "postgres.log"),
            "-o", f"-p {PG_PORT} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off", "-w", "-t", "30", "start"], "start") == 0
        summary["started"] = True; inspection.write_json(ROOT / "ownership.json", summary)
        with (ROOT / f"{mode}-native.log").open("w", encoding="utf-8") as output:
            logging.basicConfig(stream=output, level=logging.INFO, force=True)
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                asyncio.run(execute(private["pg_password"], mode, summary, stage=args.stage, submission_cap=args.submission_cap))
    except BaseException as error:
        summary["errorType"] = type(error).__name__
        (ROOT / f"{mode}-failure.log").write_text(traceback.format_exc(), encoding="utf-8")
    finally:
        if summary["started"]:
            summary["stopped"] = inspection.command(ROOT, [str(inspection.PG_CTL), "-D", str(ROOT / "data"), "-m", "fast", "-w", "-t", "30", "stop"], "stop") == 0
        summary["sourceUnchanged"] = bool(source_verified())
        inspection.write_json(ROOT / f"{mode}-result.json", summary); inspection.write_json(ROOT / "ownership.json", summary)
        print(json.dumps(summary), flush=True)
    return 0 if summary["stopped"] and "errorType" not in summary and (mode == "inspect" or summary.get("nodeExit") == 0) else 1


if __name__ == "__main__":
    raise SystemExit(main())
