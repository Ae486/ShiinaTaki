"""Start only a private converted-data copy and publish original D77 evidence through Core HTTP.

The historical source and saved baseline never start. Native extraction, embeddings,
and LLM calls are refused; original canonical/native content is checked after the run.
"""
from __future__ import annotations

import asyncio
import contextlib
import importlib.util
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import traceback
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("reuse_inspection", HERE / "inspect-native-reuse.py")
inspection = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inspection)
BASELINE = inspection.BASELINE
SOURCE = BASELINE / "working-45c36bd87f7f4baba6867a2e934f7d48"
ROOT = BASELINE / ("application-" + uuid.uuid4().hex)


def tree_hashes(path: Path) -> dict[str, str]:
    import hashlib
    return {str(item.relative_to(path)): hashlib.sha256(item.read_bytes()).hexdigest()
            for item in path.rglob("*") if item.is_file()}


async def execute(port: int, password: str, summary: dict) -> None:
    import asyncpg
    import uvicorn
    from sqlalchemy import URL
    from hindsight_api.api import create_app
    from hindsight_api.engine.cross_encoder import RRFPassthroughCrossEncoder
    from hindsight_api.engine.embeddings import Embeddings
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.query_analyzer import DateparserQueryAnalyzer
    from hindsight_api.engine.task_backend import SyncTaskBackend
    from hindsight_api.extensions.builtin.tenant import ApiKeyTenantExtension

    class NoEmbeddings(Embeddings):
        provider_name = "owned-existing-conversion"
        dimension = 384

        async def initialize(self):
            return None

        def encode(self, texts):
            summary["embeddingAttempts"] += 1
            raise AssertionError("NO_CORPUS_REEXTRACTION_OR_EMBEDDING")

    async def no_model(*args, **kwargs):
        summary["llmAttempts"] += 1
        raise AssertionError("NO_MODEL_WORK_IN_D77_PUBLICATION")

    conn = await asyncpg.connect(host="127.0.0.1", port=port, user="taki_real", password=password,
                                 database="taki_real", timeout=10)
    assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (ROOT / "data").resolve()
    assert await conn.fetchval("SELECT version_num FROM alembic_version") == "e30a9d7f6c21"
    before = await inspection.snapshot(conn)
    inspection.write_json(ROOT / "before-tables.json", before)
    # D77 legitimately turns on the new application_capture_required column. Compare the original D78 columns
    # separately against the preserved upgraded baseline, including unchanged native cursors and lineage.
    historical = json.loads((BASELINE / "working-45c36bd87f7f4baba6867a2e934f7d48/after-original-columns.json")
                            .read_text(encoding="utf-8"))
    historical = [row for row in historical if row["table"] not in
                  {"replication_logical_snapshots", "replication_logical_snapshot_pages"}]
    inherited = await inspection.snapshot(conn, historical)
    inspection.write_json(ROOT / "inherited-original-columns.json", inherited)
    assert inherited == historical, "INHERITED_ORIGINAL_NATIVE_STATE_CHANGED"
    url = URL.create("postgresql", username="taki_real", password=password, host="127.0.0.1",
                     port=port, database="taki_real").render_as_string(hide_password=False)
    engine = MemoryEngine(db_url=url, memory_llm_provider="mock", memory_llm_api_key="", memory_llm_model="mock",
                          embeddings=NoEmbeddings(), cross_encoder=RRFPassthroughCrossEncoder(),
                          query_analyzer=DateparserQueryAnalyzer(), pool_min_size=1, pool_max_size=15,
                          run_migrations=False, task_backend=SyncTaskBackend())
    engine._tenant_extension = ApiKeyTenantExtension({"api_key": "stage4-private-application-reuse"})
    for name in ("_llm_config", "_retain_llm_config", "_reflect_llm_config", "_consolidation_llm_config"):
        getattr(engine, name).call = no_model
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(128)
    summary["httpPort"] = listener.getsockname()[1]
    server = None
    serving = None
    process = None
    try:
        await engine.initialize()
        server = uvicorn.Server(uvicorn.Config(create_app(engine, initialize_memory=False),
                                               lifespan="off", log_level="error", access_log=False))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        for _ in range(200):
            if server.started:
                break
            if serving.done():
                await serving
            await asyncio.sleep(0.025)
        assert server.started
        env = {key: value for key, value in os.environ.items() if key.upper() in
               {"PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"}}
        with (ROOT / "application-node.log").open("w", encoding="utf-8") as output:
            resumed = [str(SOURCE / "application.sqlite")] if (SOURCE / "application.sqlite").exists() else []
            process = await asyncio.create_subprocess_exec(shutil.which("node"), str(HERE / "publish-reused-application.mjs"),
                f"http://127.0.0.1:{summary['httpPort']}", str(ROOT), *resumed, cwd=inspection.REPO, env=env,
                stdin=asyncio.subprocess.DEVNULL, stdout=output, stderr=output, creationflags=subprocess.CREATE_NO_WINDOW)
            summary["nodeExit"] = await asyncio.wait_for(process.wait(), timeout=7_300)
        summary["application"] = json.loads((ROOT / "application-result.json").read_text(encoding="utf-8"))
    finally:
        if process is not None and process.returncode is None:
            process.kill()
            await process.wait()
        if server is not None:
            server.should_exit = True
        if serving is not None:
            await asyncio.wait_for(serving, timeout=20)
        listener.close()
        await engine.close()
        after = await inspection.snapshot(conn, before)
        inspection.write_json(ROOT / "after-tables.json", after)
        summary["changedTables"] = [old["table"] for old, new in zip(before, after, strict=True) if old != new]
        protected = {"banks", "documents", "memory_units", "invalidated_memory_units", "memory_links", "directives",
                     "mental_models", "mental_model_history", "observation_history", "llm_requests", "async_operations",
                     "memory_current_state_transfers", "memory_current_state_transfer_mappings", "memory_cutover_actions",
                     "memory_cutover_evidence_pages", "memory_cutover_steps", "memory_cutover_verifications",
                     "replication_logical_changes", "replication_provider_lineage"}
        assert protected.issubset({row["table"] for row in before})
        summary["protectedTablesUnchanged"] = not protected.intersection(summary["changedTables"])
        original_after = await inspection.snapshot(conn, historical)
        inspection.write_json(ROOT / "after-original-columns.json", original_after)
        summary["originalColumnsAndRowsUnchanged"] = original_after == historical
        summary["originalTablesChecked"] = len(historical)
        await conn.close()


def main() -> int:
    global SOURCE
    if sys.argv[1:]:
        assert len(sys.argv) == 3 and sys.argv[1] == "--reuse"
        assert re.fullmatch(r"application-[a-f0-9]{32}", sys.argv[2])
        SOURCE = BASELINE / sys.argv[2]
        assert SOURCE.resolve().parent == BASELINE.resolve()
    inspection.clean_environment()
    inspection.check_baseline()
    assert not (SOURCE / "data/postmaster.pid").exists()
    old_result = json.loads((SOURCE / "result.json").read_text(encoding="utf-8"))
    assert old_result["stopped"]
    if "database" in old_result:
        assert old_result["database"]["headsAfter"]["public"] == ["e30a9d7f6c21"]
    else:
        assert old_result["sourceUnchanged"] and (SOURCE / "application.sqlite").exists()
    source_hashes = tree_hashes(SOURCE / "data")
    ROOT.mkdir()
    shutil.copytree(SOURCE / "data", ROOT / "data")
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        port = candidate.getsockname()[1]
    os.environ.update(TAKI_SMOKE_ALLOWED_PORTS=str(port), TAKI_SMOKE_EGRESS_LOG=str(ROOT / "egress.jsonl"),
                      HINDSIGHT_API_EMBEDDINGS_PROVIDER="tei", HINDSIGHT_API_EMBEDDINGS_TEI_URL="http://127.0.0.1:9",
                      HINDSIGHT_API_RERANKER_PROVIDER="rrf", HINDSIGHT_API_SKIP_LLM_VERIFICATION="true",
                      HINDSIGHT_API_CONSOLIDATION_RECONCILE_INTERVAL_SECONDS="0",
                      HINDSIGHT_API_MENTAL_MODEL_REFRESH_TICK_SECONDS="0", HINDSIGHT_API_LLM_TRACE_RETENTION_DAYS="-1",
                      HINDSIGHT_API_AUDIT_LOG_RETENTION_DAYS="-1", HINDSIGHT_API_AUDIT_LOG_ENABLED="false",
                      LITELLM_LOCAL_MODEL_COST_MAP="True",
                      TIKTOKEN_CACHE_DIR=str(inspection.REPO / ".trellis/.runtime/b6-continuation-20260911/tokenizer-cache"))
    sys.path[:0] = [str(HERE / "native-test-support"), str(inspection.NATIVE / "hindsight-api-slim"),
                   str(inspection.REPO / ".trellis/tasks/08-09-hindsight-initial-cutover/research/validation")]
    for package in ("winloop", "sentence_transformers", "transformers", "spacy"):
        sys.modules[package] = None
    from egress_guard import install_guard
    from real_hindsight_environment import crypt_bytes
    install_guard()
    private = json.loads(crypt_bytes((inspection.HISTORY / "native-credentials.dpapi").read_bytes(), decrypt=True))
    assert private["run_id"] == inspection.HISTORY.name
    summary = {"root": str(ROOT), "source": str(SOURCE), "port": port, "started": False, "stopped": False,
               "conversionExecuted": False, "llmAttempts": 0, "embeddingAttempts": 0}
    inspection.write_json(ROOT / "ownership.json", summary)
    print(json.dumps({"phase": "private-native-start", "root": str(ROOT)}), flush=True)
    try:
        options = f"-p {port} -h 127.0.0.1 -c shared_preload_libraries= -c lc_messages=C -c autovacuum=off"
        assert inspection.command(ROOT, [str(inspection.PG_CTL), "-D", str(ROOT / "data"), "-l", str(ROOT / "postgres.log"),
            "-o", options, "-w", "-t", "30", "start"], "start") == 0
        summary["started"] = True
        inspection.write_json(ROOT / "ownership.json", summary)
        # Keep repetitive middleware diagnostics in this private fixture, away from the terminal transcript.
        with (ROOT / "native-runtime.log").open("w", encoding="utf-8") as native_log:
            logging.basicConfig(stream=native_log, level=logging.INFO, force=True)
            with contextlib.redirect_stdout(native_log), contextlib.redirect_stderr(native_log):
                asyncio.run(execute(port, private["pg_password"], summary))
    except BaseException as error:
        summary["errorType"] = type(error).__name__
        (ROOT / "failure.log").write_text(traceback.format_exc(), encoding="utf-8")
    finally:
        summary["stopped"] = inspection.command(ROOT, [str(inspection.PG_CTL), "-D", str(ROOT / "data"),
            "-m", "fast", "-w", "-t", "30", "stop"], "stop") == 0
        inspection.check_baseline()
        summary["sourceUnchanged"] = source_hashes == tree_hashes(SOURCE / "data")
        summary["baselineUnchangedAndOriginalStopped"] = True
        inspection.write_json(ROOT / "result.json", summary)
        inspection.write_json(ROOT / "ownership.json", summary)
        print(json.dumps({key: value for key, value in summary.items() if key != "application"}), flush=True)
    return 0 if (summary.get("nodeExit") == 0 and summary["stopped"] and summary["sourceUnchanged"]
                 and summary.get("protectedTablesUnchanged") and not summary["llmAttempts"]
                 and summary.get("originalColumnsAndRowsUnchanged")
                 and not summary["embeddingAttempts"] and "errorType" not in summary) else 1


if __name__ == "__main__":
    raise SystemExit(main())
