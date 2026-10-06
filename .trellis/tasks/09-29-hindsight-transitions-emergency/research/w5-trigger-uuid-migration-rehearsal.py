"""PARENT ONLY: fresh clone, explicit e30->e40 proof, optional existing apply benchmark.

No argument performs any data access. Review the sealed source manifest first,
then pass --run-reviewed-clone; add --with-apply only for the reviewed benchmark.
No existing target/DSN is accepted. This never migrates the working pair.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import importlib.util
import json
import os
import re
import socket
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
NATIVE = Path("H:/hindsight/hindsight-api-slim")
MANIFEST = HERE / "w5-trigger-uuid-source-manifest.json"
PREVIOUS = "e30a9d7f6c21"
CURRENT = "e40b1e8a7d32"
PRE_FUNCTION_HASH = "729b937af085b27ba8ea24ed5ef8eabca4f99082deaf46a7271925c1d5f1e9e6"
V3_HASH = "09a9ca9b3fc6044be9052a1bb98765e7eab3d80a77cef0687f9de6f1cdc83b73"
PROOF_SECONDS = 180
SQL_SECONDS = 10


@dataclass(frozen=True)
class Rows:
    count: int
    sha256: str


@dataclass(frozen=True)
class State:
    revisions: list[str]
    function_oid: str
    function: str
    function_attributes: str
    other_functions: dict[str, str]
    triggers: list[str]
    indexes: list[str]
    tables: dict[str, Rows]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_sources() -> None:
    # The parent independently checks the sealed manifest's SHA256 before
    # invocation. Checking its complete entries here prevents intervening drift.
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for row in manifest["files"]:
        path = Path(row["path"])
        assert path.stat().st_size == row["bytes"] and digest(path) == row["sha256"], "REPAIR_SOURCE_CHANGED"
    assert digest(HERE / "w5-candidate-trigger-readonly-diagnostic-v3.py") == V3_HASH


def load(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def expected_function(previous: str) -> str:
    assert previous.count("WHERE id::text IN") == 3, "UNREVIEWED_FUNCTION_PREDICATE"
    value = previous.replace("WHERE id::text IN", "WHERE id IN")
    fields = "unit_id|from_unit_id|to_unit_id|entity_id|entity_id_1|entity_id_2"
    value, count = re.subn(r"item->>'(" + fields + r")'", r"(item->>'\1')::uuid", value)
    assert count == 9, "UNREVIEWED_FUNCTION_ENDPOINTS"
    return value


async def capture(clone: Any) -> State:
    import asyncpg

    assert clone.owned_pg(), "CLONE_OWNERSHIP_LOST"
    conn = await asyncpg.connect(
        host="127.0.0.1",
        port=clone.PORT,
        database="taki_real",
        user="taki_real",
        password="",
        timeout=10,
        command_timeout=SQL_SECONDS,
        server_settings={"statement_timeout": "10000", "lock_timeout": "2000", "search_path": "pg_catalog,public"},
    )
    try:
        assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (clone.CLONE / "data").resolve()
        async with conn.transaction(isolation="repeatable_read", readonly=True):
            revisions = [
                row["version_num"] for row in await conn.fetch("SELECT version_num FROM public.alembic_version")
            ]
            guard = await conn.fetchrow(
                "SELECT p.oid::text AS oid,pg_get_functiondef(p.oid) AS definition,"
                "(to_jsonb(p)-'prosrc')::text AS attributes FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace "
                "WHERE n.nspname='public' AND p.proname='guard_transition_association_write'"
            )
            assert guard is not None, "MISSING_ASSOCIATION_FUNCTION"
            functions = {
                row["oid"]: row["definition"]
                for row in await conn.fetch(
                    "SELECT p.oid::text AS oid,pg_get_functiondef(p.oid) AS definition FROM pg_proc p "
                    "JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') "
                    "AND p.proname<>'guard_transition_association_write' ORDER BY p.oid"
                )
            }
            triggers = [
                row["body"]
                for row in await conn.fetch(
                    "SELECT to_jsonb(t)::text AS body FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "
                    "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY t.oid"
                )
            ]
            indexes = [
                row["body"]
                for row in await conn.fetch(
                    "SELECT to_jsonb(i)::text AS body FROM pg_indexes i WHERE schemaname='public' ORDER BY indexname"
                )
            ]
            tables = await conn.fetch(
                "SELECT c.relname,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE n.nspname='public' AND c.relkind IN ('r','p','m','S') "
                "AND c.relname<>'alembic_version' ORDER BY c.relname"
            )
            contents = {}
            for table in tables:
                name = table["relname"].replace('"', '""')
                # Sequence relations have no composite type for to_jsonb(t).
                # Read their state explicitly, never call nextval/setval.
                projection = (
                    "jsonb_build_array(t.last_value,t.log_cnt,t.is_called)::text"
                    if table["kind"] == "S"
                    else "to_jsonb(t)::text"
                )
                # Hash every complete row, including bodies/bytea/history. Sort
                # fixed-width digests rather than materializing private row text
                # or forcing an unbounded PostgreSQL sort of large body values.
                hashes = []
                async for row in conn.cursor(f'SELECT {projection} AS body FROM "public"."{name}" t', prefetch=16):
                    hashes.append(hashlib.sha256(row["body"].encode("utf-8")).digest())
                contents[table["relname"]] = Rows(len(hashes), hashlib.sha256(b"".join(sorted(hashes))).hexdigest())
            return State(
                revisions,
                guard["oid"],
                guard["definition"],
                guard["attributes"],
                functions,
                triggers,
                indexes,
                contents,
            )
    finally:
        try:
            await asyncio.wait_for(conn.close(), timeout=5)
        except TimeoutError:
            conn.terminate()
            raise


def upgrade_once(clone: Any) -> None:
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    assert clone.owned_pg(), "CLONE_OWNERSHIP_LOST"
    config = Config()
    config.set_main_option("script_location", str(NATIVE / "hindsight_api/alembic"))
    # This URL is constructed solely from the newly allocated owned clone port.
    # No saved credentials, .env, migration_database_url or existing DSN is read.
    config.set_main_option(
        "sqlalchemy.url",
        f"postgresql://taki_real@127.0.0.1:{clone.PORT}/taki_real?connect_timeout=10"
        "&options=-c%20statement_timeout%3D10000%20-c%20lock_timeout%3D2000".replace("%", "%%"),
    )
    config.set_main_option("target_schema", "public")
    config.set_main_option("path_separator", "os")
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [CURRENT], "UNREVIEWED_MIGRATION_HEAD"
    revision = script.get_revision(CURRENT)
    assert revision is not None and revision.down_revision == PREVIOUS
    # Do not call run_migrations(): this controlled step must not bootstrap or
    # relocate extensions, synchronize dimensions, or change supervisor policy.
    command.upgrade(config, CURRENT)


async def migrate_and_prove(clone: Any) -> None:
    started = time.perf_counter()
    before = await capture(clone)
    assert before.revisions == [PREVIOUS], "UNREVIEWED_RUNTIME_REVISION"
    before_hash = hashlib.sha256(before.function.encode()).hexdigest()
    assert before_hash == PRE_FUNCTION_HASH, "UNREVIEWED_RUNTIME_FUNCTION"
    clone.write_json(clone.CLONE / "migration-before.json", asdict(before))
    migration_started = time.perf_counter()
    # The private server's finite connect/statement/lock timeouts also bound the
    # synchronous Alembic connection. The encompassing proof has its own limit.
    await asyncio.to_thread(upgrade_once, clone)
    clone.REPORT["migrationMilliseconds"] = (time.perf_counter() - migration_started) * 1000
    after = await capture(clone)  # Fresh connection after committed DDL.
    clone.write_json(clone.CLONE / "migration-after.json", asdict(after))
    assert after.revisions == [CURRENT], "MIGRATION_REVISION_NOT_COMMITTED"
    assert after.function == expected_function(before.function), "MIGRATION_FUNCTION_NOT_EXACT"
    assert after.function_oid == before.function_oid and after.function_attributes == before.function_attributes
    assert after.other_functions == before.other_functions and after.triggers == before.triggers
    assert after.indexes == before.indexes and after.tables == before.tables, "MIGRATION_DATA_OR_INDEX_DRIFT"
    clone.REPORT["migrationProof"] = {
        "previousRevision": PREVIOUS,
        "currentRevision": CURRENT,
        "previousFunctionSha256": before_hash,
        "currentFunctionSha256": hashlib.sha256(after.function.encode()).hexdigest(),
        "sameFunctionOidAndAttributes": True,
        "otherFunctionsAndTriggersPreserved": True,
        "allTableRowsAndIndexesPreserved": True,
        "tableCount": len(after.tables),
        "freshConnectionAfterMigration": True,
    }
    clone.REPORT["migrationAndProofMilliseconds"] = (time.perf_counter() - started) * 1000
    clone.REPORT["migrationRehearsalCompleted"] = True


def run_reviewed(*, with_apply: bool) -> None:
    verify_sources()
    diagnostic = load("w5_trigger_v3_result_writer", "w5-candidate-trigger-readonly-diagnostic-v3.py")
    diagnostic.verify_sources()
    clone = load("w5_trigger_uuid_clone", "w5-reentry-candidate-native-clone.py")
    sys.path.insert(0, str(NATIVE))
    for key in list(os.environ):
        if key.startswith(("HINDSIGHT_API_", "PG")) or key.endswith("_API_KEY"):
            os.environ.pop(key, None)
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"
    original_run = clone.run_clone
    original_writer = clone.write_json
    clone.REPORT.update(
        {
            "meaning": "Parent-only fresh-clone e30-to-e40 migration proof; optional existing synthetic-vector apply.",
            "migrationRehearsalCompleted": False,
            "withApply": with_apply,
            "migrationProofLimitSeconds": PROOF_SECONDS,
            "sourceManifestSha256": digest(MANIFEST),
        }
    )

    def write_json(path: Path, value: Any) -> None:
        if path.name == "result.json":
            diagnostic.write_result(path, value)
        else:
            original_writer(path, value)

    async def run(password: str) -> None:
        # libpq otherwise may consult the user's default password/service files
        # even though this clone uses private loopback trust until optional apply.
        absent_credentials = clone.CLONE / "no-external-pg-credentials"
        assert not absent_credentials.exists()
        os.environ["PGPASSFILE"] = str(absent_credentials)
        os.environ["PGSERVICEFILE"] = str(absent_credentials)
        clone.connection_refusal_guard()
        await asyncio.wait_for(migrate_and_prove(clone), timeout=PROOF_SECONDS)
        verify_sources()
        if with_apply:
            await original_run(password)

    clone.write_json = write_json
    clone.run_clone = run
    try:
        clone.main()
    finally:
        clone.REPORT["repairSourcesPreserved"] = False
        clone.REPORT["portReleased"] = False
        try:
            verify_sources()
            diagnostic.verify_sources()
            clone.REPORT["repairSourcesPreserved"] = True
            if clone.PORT is not None and clone.REPORT["stopped"]:
                with socket.socket() as reservation:
                    reservation.bind(("127.0.0.1", clone.PORT))
                clone.REPORT["portReleased"] = True
        finally:
            if clone.CLONE is not None:
                clone.write_json(clone.CLONE / "result.json", clone.REPORT)
    assert clone.REPORT["migrationRehearsalCompleted"] and not clone.REPORT.get("reportEncodingFailed")
    assert clone.REPORT["stopped"] and clone.REPORT["portReleased"] and clone.REPORT["originalPreserved"]
    if with_apply:
        assert clone.REPORT["applyCompleted"] and clone.REPORT["exactLookupMatches"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-reviewed-clone", action="store_true")
    parser.add_argument("--with-apply", action="store_true")
    args = parser.parse_args()
    if not args.run_reviewed_clone:
        print(
            json.dumps(
                {
                    "parentRunOnly": True,
                    "executed": False,
                    "migration": f"{PREVIOUS}->{CURRENT}",
                    "proofLimitSeconds": PROOF_SECONDS,
                    "workingPairAccepted": False,
                }
            )
        )
        return
    run_reviewed(with_apply=args.with_apply)


if __name__ == "__main__":
    main()
