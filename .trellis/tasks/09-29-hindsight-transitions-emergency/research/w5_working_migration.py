"""Authenticated working-copy e30/e40 proof; import performs no runtime data access."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Any

from w5_actual_embedding_control import load, write_json

rehearsal = load("w5_working_migration_primitives", "w5-trigger-uuid-migration-rehearsal.py")
PREVIOUS, CURRENT = rehearsal.PREVIOUS, rehearsal.CURRENT
PROOF_NAME = "working-e40-migration-proof.json"


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def stable_catalog_queries() -> dict[str, str]:
    """Logical DDL, not mutable planner/MVCC counters or system-catalog row versions."""
    return {
        "namespaces": "SELECT to_jsonb(n)::text body FROM pg_namespace n "
        "WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema' ORDER BY oid",
        "extensions": "SELECT to_jsonb(e)::text body FROM pg_extension e ORDER BY oid",
        "functionAttributes": "SELECT (CASE WHEN p.proname='guard_transition_association_write' "
        "THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END)::text body FROM pg_proc p "
        "JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.oid",
        "relations": "SELECT (to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relallfrozen',"
        "'relfrozenxid','relminmxid'])::text body FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' ORDER BY c.oid",
        "columns": "SELECT to_jsonb(a)::text body FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid "
        "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY a.attrelid,a.attnum",
        "types": "SELECT to_jsonb(t)::text body FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace "
        "WHERE n.nspname='public' ORDER BY t.oid",
        "constraints": "SELECT to_jsonb(c)::text body FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace "
        "WHERE n.nspname='public' ORDER BY c.oid",
        "defaults": "SELECT to_jsonb(a)::text body FROM pg_attrdef a JOIN pg_class c ON c.oid=a.adrelid "
        "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY a.oid",
        "rules": "SELECT to_jsonb(r)::text body FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class "
        "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY r.oid",
        "policies": "SELECT to_jsonb(p)::text body FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid "
        "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY p.oid",
        "sequences": "SELECT to_jsonb(s)::text body FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid "
        "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY s.seqrelid",
    }


async def authenticate(conn: Any, owner: Any) -> dict:
    assert owner.owned_pg(), "WORKING_PG_CUSTODY_LOST"
    row = await conn.fetchrow("SELECT current_database() db,current_user AS role,current_schema() schema")
    assert row["db"] == row["role"] == "taki_real", "WORKING_PG_PRINCIPAL_REFUSED"
    assert not await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())"
    ), "WORKING_FOREIGN_CONNECTION"
    # The capture uses pg_catalog first to prevent public shadow functions.
    assert row["schema"] == "pg_catalog", "WORKING_SEARCH_PATH_REFUSED"
    assert Path(await conn.fetchval("SHOW data_directory")).resolve() == (owner.CLONE / "data").resolve()
    schemas = await conn.fetch(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' "
        "AND nspname<>'information_schema' ORDER BY nspname"
    )
    # pgvector may be installed in public or a dedicated extension schema. Refuse
    # user-owned relation state outside the schema that this migration proves.
    foreign = await conn.fetch(
        "SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('public','information_schema') "
        "AND c.relkind IN ('r','p','m','S','f')"
    )
    assert not foreign, "UNPROVED_NON_PUBLIC_DATA"
    assert not await conn.fetchval(
        "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
        "WHERE n.nspname='public' AND c.relkind='f')"
    ), "FOREIGN_TABLE_REFUSED"
    return {
        "root": str(owner.CLONE),
        "port": owner.PORT,
        "database": row["db"],
        "user": row["role"],
        "schemas": [row["nspname"] for row in schemas],
    }


async def capture(owner: Any, password: str) -> dict:
    """Reuse the sealed full-row capture with a narrowly scoped credential adapter.

    No engine, other tasks or pools exist at this pre-initialization seam. The
    adapter checks every original connect argument and is restored on all exits.
    Actual passwords never enter command lines, reports or assertion messages.
    """
    import asyncpg

    original = asyncpg.connect
    identity = None
    catalog = None
    calls = 0

    async def authenticated(*args: Any, **kwargs: Any) -> Any:
        nonlocal identity, catalog, calls
        expected = {
            "host": "127.0.0.1",
            "port": owner.PORT,
            "database": "taki_real",
            "user": "taki_real",
            "password": "",
            "timeout": 10,
            "command_timeout": rehearsal.SQL_SECONDS,
            "server_settings": {
                "statement_timeout": "10000",
                "lock_timeout": "2000",
                "search_path": "pg_catalog,public",
            },
        }
        assert not args and kwargs == expected and calls == 0, "CAPTURE_CONNECTION_REFUSED"
        calls += 1
        conn = await original(**{**kwargs, "password": password})
        try:
            async with conn.transaction(isolation="repeatable_read", readonly=True):
                identity = await authenticate(conn, owner)
                catalog = {
                    name: [row["body"] for row in await conn.fetch(sql)]
                    for name, sql in stable_catalog_queries().items()
                }
            return conn
        except BaseException:
            conn.terminate()
            raise

    setattr(asyncpg, "connect", authenticated)
    try:
        state = await rehearsal.capture(owner)
    finally:
        asyncpg.connect = original
    assert calls == 1 and identity and catalog, "CAPTURE_INCOMPLETE"
    return {"identity": identity, "catalog": catalog, "state": asdict(state)}


def validate_before(before: dict) -> None:
    assert before["state"]["revisions"] == [PREVIOUS], "UNREVIEWED_RUNTIME_REVISION"
    assert sha(before["state"]["function"]) == rehearsal.PRE_FUNCTION_HASH, "UNREVIEWED_RUNTIME_FUNCTION"


def compare(before: dict, after: dict) -> None:
    validate_before(before)
    assert after["identity"] == before["identity"], "MIGRATION_IDENTITY_DRIFT"
    assert after["catalog"] == before["catalog"], "MIGRATION_CATALOG_DRIFT"
    expected = {
        **before["state"],
        "revisions": [CURRENT],
        "function": rehearsal.expected_function(before["state"]["function"]),
    }
    assert after["state"] == expected, "MIGRATION_ROWS_OR_OBJECTS_DRIFT"


def upgrade_once(owner: Any, password: str) -> None:
    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import URL

    assert owner.owned_pg(), "WORKING_PG_CUSTODY_LOST"
    config = Config()
    config.set_main_option("script_location", str(rehearsal.NATIVE / "hindsight_api/alembic"))
    url = URL.create(
        "postgresql",
        username="taki_real",
        password=password,
        host="127.0.0.1",
        port=owner.PORT,
        database="taki_real",
        query={"connect_timeout": "10", "options": "-c statement_timeout=10000 -c lock_timeout=2000"},
    )
    config.set_main_option("sqlalchemy.url", url.render_as_string(hide_password=False).replace("%", "%%"))
    config.set_main_option("target_schema", "public")
    config.set_main_option("path_separator", "os")
    script = ScriptDirectory.from_config(config)
    assert script.get_heads() == [CURRENT], "UNREVIEWED_MIGRATION_HEAD"
    revision = script.get_revision(CURRENT)
    assert revision is not None and revision.down_revision == PREVIOUS
    # Avoid run_migrations(), which performs additional extension/bootstrap work.
    command.upgrade(config, CURRENT)


def load_proof(root: Path) -> dict:
    proof = json.loads((root / PROOF_NAME).read_text(encoding="utf-8"))
    assert proof["version"] == 1 and proof["kind"] == "working-e40-migration-proof"
    for name in ("before", "after"):
        path = root / f"working-e40-migration-{name}.json"
        assert hashlib.sha256(path.read_bytes()).hexdigest() == proof[f"{name}Sha256"], "MIGRATION_PROOF_BYTES_DRIFT"
    before = json.loads((root / "working-e40-migration-before.json").read_text(encoding="utf-8"))
    after = json.loads((root / "working-e40-migration-after.json").read_text(encoding="utf-8"))
    compare(before, after)
    assert proof["identity"] == after["identity"] and Path(proof["identity"]["root"]) == root
    return after


async def migrate_or_verify(owner: Any, password: str, *, allow_migration: bool) -> dict:
    current = await capture(owner, password)
    root = owner.CLONE
    if (root / PROOF_NAME).exists():
        after = load_proof(root)
        # Recovery legitimately changes data rows. Keep the migration's complete
        # immutable row proof, and recheck current DDL/function identity only.
        assert current["identity"] == after["identity"] and current["catalog"] == after["catalog"]
        assert {k: v for k, v in current["state"].items() if k != "tables"} == {
            k: v for k, v in after["state"].items() if k != "tables"
        }, "POST_MIGRATION_OBJECT_DRIFT"
        return {"migrated": False, "verifiedExistingProof": True, "proof": PROOF_NAME}
    assert allow_migration, "APPROVAL_REQUIRES_EXISTING_MIGRATION_PROOF"
    validate_before(current)  # e40 without proof is deliberately refused.
    before_path = root / "working-e40-migration-before.json"
    after_path = root / "working-e40-migration-after.json"
    assert not before_path.exists() and not after_path.exists(), "INCOMPLETE_MIGRATION_EVIDENCE_REQUIRES_REVIEW"
    write_json(before_path, current)
    # Synchronous invocation is intentional: no abandoned to_thread migration
    # may race pg_ctl cleanup on cancellation. libpq and SQL/lock waits are finite.
    upgrade_once(owner, password)
    after = await capture(owner, password)
    write_json(after_path, after)
    compare(current, after)
    write_json(
        root / PROOF_NAME,
        {
            "version": 1,
            "kind": "working-e40-migration-proof",
            "identity": after["identity"],
            "beforeSha256": hashlib.sha256(before_path.read_bytes()).hexdigest(),
            "afterSha256": hashlib.sha256(after_path.read_bytes()).hexdigest(),
            "onlyRevisionAndReviewedFunctionChanged": True,
            "allRowsHistorySequencesPreserved": True,
        },
    )
    return {"migrated": True, "verifiedExistingProof": False, "proof": PROOF_NAME}


async def bounded_migration(owner: Any, password: str, *, allow_migration: bool) -> dict:
    # Empty external credential/service files are never created or consulted.
    absent = owner.CLONE / "working-no-external-pg-credentials"
    assert not absent.exists()
    previous = {key: os.environ.get(key) for key in ("PGPASSFILE", "PGSERVICEFILE")}
    os.environ.update(PGPASSFILE=str(absent), PGSERVICEFILE=str(absent))
    try:
        return await asyncio.wait_for(migrate_or_verify(owner, password, allow_migration=allow_migration), timeout=180)
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
