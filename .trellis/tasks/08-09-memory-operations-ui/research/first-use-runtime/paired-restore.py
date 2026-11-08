"""Owned first-use D91 Native restore/observation; no Core writer or background work."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import io
import json
import os
import re
import socket
import sys
import traceback
import uuid
import zipfile
from pathlib import Path


REPO = Path(__file__).resolve().parents[5]
NATIVE = Path("H:/hindsight/hindsight-api-slim")


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def owned(root: Path, path: str | Path) -> Path:
    resolved = Path(path).resolve(strict=True)
    if resolved == root or not resolved.is_relative_to(root):
        raise ValueError("PAIRED_RESTORE_PATH_NOT_OWNED")
    return resolved


def publish(path: Path, body: dict) -> None:
    partial = path.with_suffix(".partial")
    partial.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
    partial.replace(path)


async def archive_readback(conn, schema: str, archive: dict, path: Path, tables: list[str]) -> dict:
    """Compare fresh COPY read-back with the sealed streams, not a later source snapshot."""
    expected = {entry["name"]: entry for entry in archive["taki"]["entries"]}
    if set(archive["tables"]) != set(tables) or set(expected) != {f"{table}.bin" for table in tables}:
        raise ValueError("PAIRED_RESTORE_INCOMPLETE_ARCHIVE")
    result = {}
    async with conn.transaction(isolation="repeatable_read", readonly=True):
        with zipfile.ZipFile(path) as zipped:
            for table in tables:
                item = expected[f"{table}.bin"]
                frozen = zipped.read(item["name"])
                if len(frozen) != item["bytes"] or hashlib.sha256(frozen).hexdigest() != item["sha256"]:
                    raise ValueError("PAIRED_RESTORE_ARCHIVE_ENTRY_INVALID")
                buffer = io.BytesIO()
                await conn.copy_from_table(
                    table, schema_name=schema,
                    columns=[column["name"] for column in archive["tables"][table]["columns"]],
                    output=buffer, format="binary",
                )
                restored = buffer.getvalue()
                count = await conn.fetchval(f'SELECT count(*) FROM "{schema}"."{table}"')
                if restored != frozen or count != archive["tables"][table]["rows"]:
                    raise ValueError("PAIRED_RESTORE_ARCHIVE_READBACK_MISMATCH:" + table)
                result[table] = {"rows": count, "bytes": len(restored), "sha256": item["sha256"]}
    return result


async def observe(engine, plan: dict, directory: Path, guard) -> None:
    import uvicorn
    from hindsight_api.api import create_app

    # B3's HTTP observer has no application lifespan or worker startup. Engine maintenance
    # is independently disabled by its supported settings before initialize().
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", plan["observationPort"]))
        listener.listen()
        listener.setblocking(False)
        server = uvicorn.Server(uvicorn.Config(create_app(engine, initialize_memory=False), lifespan="off", log_level="error"))
        serving = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            for _ in range(100):
                if server.started:
                    break
                if serving.done():
                    await serving
                    raise ValueError("PAIRED_RESTORE_HTTP_NOT_STARTED")
                await asyncio.sleep(0.05)
            if not server.started:
                raise ValueError("PAIRED_RESTORE_HTTP_NOT_STARTED")
            publish(directory / "native-ready.json", {"endpoint": f"http://127.0.0.1:{plan['observationPort']}"})
            deadline = asyncio.get_running_loop().time() + 180
            while not (directory / "native.stop").exists():
                if not guard._alive(int(os.environ["TAKI_SMOKE_PARENT_PID"])):
                    raise ValueError("PAIRED_RESTORE_PARENT_EXITED")
                if serving.done():
                    await serving
                    raise ValueError("PAIRED_RESTORE_HTTP_STOPPED")
                if asyncio.get_running_loop().time() >= deadline:
                    raise ValueError("PAIRED_RESTORE_PREFLIGHT_DEADLINE")
                await asyncio.sleep(0.1)
        finally:
            server.should_exit = True
            await asyncio.wait_for(serving, timeout=15)


async def run(plan: dict, root: Path, directory: Path, result: dict, guard) -> None:
    import asyncpg
    from hindsight_api.admin.cli import BACKUP_TABLES, _restore
    from hindsight_api.engine.cross_encoder import RRFPassthroughCrossEncoder
    from hindsight_api.engine.maintenance import MaintenanceLoop
    from hindsight_api.engine.memory_engine import MemoryEngine
    from hindsight_api.engine.query_analyzer import DateparserQueryAnalyzer
    from hindsight_api.engine.task_backend import SyncTaskBackend
    from hindsight_api.extensions.builtin.tenant import ApiKeyTenantExtension
    from hindsight_api.migrations import run_migrations

    w6 = load("first_use_w6_inventory", REPO / ".trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-paired-native-restore.py")
    fixture = load("first_use_native_embeddings", NATIVE / "tests/native_results/conftest.py")
    archive_path = owned(root, plan["nativeArchivePath"])
    manifest = json.loads(owned(root, Path(plan["pairDir"]) / "manifest.json").read_text(encoding="utf-8"))
    schema = manifest["native"]["schema"]
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,62}", schema):
        raise ValueError("PAIRED_RESTORE_INVALID_SCHEMA")
    with zipfile.ZipFile(archive_path) as zipped:
        archive = json.loads(zipped.read("manifest.json"))
    proof = manifest["native"]["proof"]
    if (archive["schema"] != schema or archive["taki"]["version"] != 2
            or archive["taki"]["backupId"] != manifest["backupId"]
            or archive["taki"]["requestHash"] != manifest["requestHash"]
            or archive["taki"]["proof"] != {key: value for key, value in proof.items() if key not in {"zipSha256", "zipBytes"}}):
        raise ValueError("PAIRED_RESTORE_ARCHIVE_PAIR_MISMATCH")
    source_url = f"postgresql://taki_smoke:taki_smoke@127.0.0.1:{plan['pgPort']}/taki_smoke"
    source = await asyncpg.connect(source_url)
    target = None
    engine = None
    created = False
    before = guards = None
    target_name = plan["targetDatabase"]
    result.update(backupId=manifest["backupId"], targetDatabase=target_name, schema=schema)
    try:
        if owned(root, await source.fetchval("SHOW data_directory")) != (root / "pg-data").resolve(strict=True):
            raise ValueError("PAIRED_RESTORE_PG_NOT_OWNED")
        active = await source.fetchval(
            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
            "AND pid<>pg_backend_pid() AND backend_type='client backend'"
        )
        if active:
            raise ValueError("PAIRED_RESTORE_SOURCE_NOT_STOPPED")
        before = await w6.inventory(source, schema, BACKUP_TABLES)
        guards = await w6.triggers(source, schema)
        await source.execute(f'CREATE DATABASE "{target_name}"')
        created = True
        target_url = os.environ["HINDSIGHT_API_DATABASE_URL"]
        # The existing Native migration and CLI restore own schema, FK/COPY and trigger semantics.
        target = await asyncpg.connect(target_url)
        await target.execute("CREATE EXTENSION IF NOT EXISTS vector")
        await target.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        await asyncio.to_thread(run_migrations, target_url, schema=schema)
        migrated_guards = await w6.triggers(target, schema)
        if migrated_guards != guards:
            raise ValueError("PAIRED_RESTORE_SOURCE_TRIGGER_MISMATCH")
        await _restore(target_url, archive_path, schema)
        tables = await archive_readback(target, schema, archive, archive_path, BACKUP_TABLES)
        restored = await w6.inventory(target, schema, BACKUP_TABLES)
        if await w6.triggers(target, schema) != migrated_guards:
            raise ValueError("PAIRED_RESTORE_TRIGGER_MISMATCH")
        result.update(tableCount=len(tables), tables=tables, fullHistoryHash=w6.digest(restored),
                      triggerModesHash=w6.digest(migrated_guards), archiveMatched=True,
                      sourceMatchesArchive=before == restored,
                      sourceAdvancedTables=[table for table in BACKUP_TABLES if before[table] != restored[table]])
        if MaintenanceLoop._any_job_enabled():
            raise ValueError("PAIRED_RESTORE_MAINTENANCE_ENABLED")
        engine = MemoryEngine(
            db_url=target_url, embeddings=fixture.FixtureEmbeddings(), cross_encoder=RRFPassthroughCrossEncoder(),
            query_analyzer=DateparserQueryAnalyzer(), pool_min_size=1, pool_max_size=5,
            run_migrations=False, task_backend=SyncTaskBackend(), skip_llm_verification=True,
            tenant_extension=ApiKeyTenantExtension({"api_key": os.environ["HINDSIGHT_API_TENANT_API_KEY"]}),
        )
        await engine.initialize()
        if engine._maintenance_loop._task is not None:
            raise ValueError("PAIRED_RESTORE_MAINTENANCE_STARTED")
        await observe(engine, plan, directory, guard)
        await engine.close()
        engine = None
        if await w6.inventory(target, schema, BACKUP_TABLES) != restored or await w6.triggers(target, schema) != migrated_guards:
            raise ValueError("PAIRED_RESTORE_OBSERVATION_MUTATED_TARGET")
        result.update(completed=True, observationReadOnly=True, backgroundWorkersStarted=False, modelStarted=False)
    finally:
        try:
            if engine is not None:
                await engine.close()
        finally:
            try:
                if target is not None:
                    await target.close()
                if before is not None:
                    result["sourceUnchanged"] = (await w6.inventory(source, schema, BACKUP_TABLES) == before
                                                 and await w6.triggers(source, schema) == guards)
                if created:
                    # No FORCE or backend termination: drop only this newly created target after its users close.
                    await source.execute(f'DROP DATABASE "{target_name}"')
                    result["restoredDatabaseDropped"] = not await source.fetchval(
                        "SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1)", target_name
                    )
                if before is not None and not result.get("sourceUnchanged"):
                    raise ValueError("PAIRED_RESTORE_SOURCE_CHANGED")
            finally:
                await source.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-owned-restore", action="store_true")
    parser.add_argument("--plan", type=Path)
    args = parser.parse_args()
    if not args.run_owned_restore:
        print(json.dumps({"executed": False, "completed": False}))
        return 0
    if args.plan is None:
        parser.error("--plan is required")
    plan = json.loads(args.plan.read_text(encoding="utf-8"))
    root = Path(plan["ownedRoot"]).resolve(strict=True)
    if root.parent != Path("G:/") or not re.fullmatch(r"taki-first-use-[A-Za-z0-9]+", root.name):
        raise ValueError("PAIRED_RESTORE_OWNED_ROOT_REQUIRED")
    directory = owned(root, args.plan.parent)
    if plan["sourceDatabase"] != "taki_smoke":
        raise ValueError("PAIRED_RESTORE_FIXTURE_DATABASE_REQUIRED")
    schema = json.loads(owned(root, Path(plan["pairDir"]) / "manifest.json").read_text(encoding="utf-8"))["native"]["schema"]
    plan["targetDatabase"] = "taki_first_use_restore_" + uuid.uuid4().hex
    os.environ["HINDSIGHT_API_DATABASE_URL"] = f"postgresql://taki_smoke:taki_smoke@127.0.0.1:{plan['pgPort']}/{plan['targetDatabase']}"
    os.environ["HINDSIGHT_API_DATABASE_SCHEMA"] = schema
    # Preserve source configuration defaults; injected observation-only providers never load these optional models.
    for package in ("winloop", "sentence_transformers", "transformers", "spacy"):
        sys.modules[package] = None
    guard = load("first_use_native_guard", REPO / ".trellis/tasks/archive/2026-09/09-25-hindsight-native-smoke/research/native_launcher.py")
    guard.install_guard()
    result = {"completed": False, "restoredDatabaseDropped": False, "sourceUnchanged": None}
    try:
        asyncio.run(run(plan, root, directory, result, guard))
    except Exception as error:
        result["completed"] = False
        message = str(error)
        result["error"] = message if re.fullmatch(r"(?:PAIRED_RESTORE_|W6_)[A-Z_]+(?::[a-z_]+)?", message) else type(error).__name__
        traceback.print_exc()
    finally:
        publish(directory / "native-result.json", result)
    return 0 if result["completed"] else 1


if __name__ == "__main__":
    sys.exit(main())
