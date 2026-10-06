"""One-step association-function migration on newly owned PostgreSQL databases."""

from __future__ import annotations

import re
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
from alembic import command
from alembic.config import Config

from hindsight_api.engine.db.postgresql import PostgreSQLBackend
from hindsight_api.engine.replication import ensure_replication_bank_state
from hindsight_api.engine.transition_models import TakiTransitionAcquireRequest, transition_acquire_hash
from hindsight_api.engine.transition_service import TransitionService

PREVIOUS = "e30a9d7f6c21"
CURRENT = "e40b1e8a7d32"


@dataclass(frozen=True)
class CatalogState:
    revisions: list[str]
    guard_oid: str
    guard_definition: str
    guard_attributes: str
    other_functions: dict[str, str]
    triggers: list[str]
    indexes: list[str]
    rows: dict[str, list[str]]


def migration_config(url: str, schema: str | None) -> Config:
    # Public is allowed only inside the uniquely created database below. This
    # never changes the fixture's shared public revision or an external pair.
    assert urlsplit(url).path.removeprefix("/").startswith("assoc_migration_")
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "hindsight_api/alembic"))
    config.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    config.set_main_option("path_separator", "os")
    if schema is not None:
        assert schema == "assoc_tenant"
        config.set_main_option("target_schema", schema)
    return config


@asynccontextmanager
async def owned_database(base_url: str) -> AsyncIterator[str]:
    name = f"assoc_migration_{uuid.uuid4().hex}"
    parsed = urlsplit(base_url)
    url = urlunsplit(parsed._replace(path=f"/{name}"))
    admin = await asyncpg.connect(base_url)
    created = False
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
        created = True
        yield url
    finally:
        # No forced backend termination: all test connections/migration engines
        # must have closed before our own database can be dropped normally.
        if created:
            await admin.execute(f'DROP DATABASE "{name}"')
        await admin.close()


async def snapshot(url: str, schema: str) -> CatalogState:
    conn = await asyncpg.connect(url)
    try:
        guard = await conn.fetchrow(
            "SELECT p.oid::text AS oid,pg_get_functiondef(p.oid) AS definition,"
            "(to_jsonb(p)-'prosrc')::text AS attributes FROM pg_proc p "
            "JOIN pg_namespace n ON n.oid=p.pronamespace "
            "WHERE n.nspname=$1 AND p.proname='guard_transition_association_write'",
            schema,
        )
        assert guard is not None
        functions = {
            row["identity"]: row["definition"]
            for row in await conn.fetch(
                "SELECT p.oid::text AS identity,pg_get_functiondef(p.oid) AS definition FROM pg_proc p "
                "JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=$1 AND p.prokind IN ('f','p') "
                "AND p.proname<>'guard_transition_association_write' ORDER BY p.oid",
                schema,
            )
        }
        triggers = [
            row["body"]
            for row in await conn.fetch(
                "SELECT to_jsonb(t)::text AS body FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid "
                "JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 ORDER BY t.oid",
                schema,
            )
        ]
        indexes = [
            row["body"]
            for row in await conn.fetch(
                "SELECT to_jsonb(i)::text AS body FROM pg_indexes i WHERE schemaname=$1 ORDER BY indexname", schema
            )
        ]
        tables = await conn.fetch(
            "SELECT c.relname,c.relkind::text AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
            "WHERE n.nspname=$1 AND c.relkind IN ('r','p','m','S') AND c.relname<>'alembic_version' ORDER BY c.relname",
            schema,
        )
        rows = {}
        for table in tables:
            name = table["relname"].replace('"', '""')
            # Sequences expose fields but do not have a composite row type.
            # Preserve their complete state explicitly without advancing them.
            projection = (
                "jsonb_build_array(t.last_value,t.log_cnt,t.is_called)::text"
                if table["kind"] == "S"
                else "to_jsonb(t)::text"
            )
            rows[table["relname"]] = list(
                await conn.fetchval(
                    f"SELECT array_agg(body ORDER BY body) FROM (SELECT {projection} AS body "
                    f'FROM "{schema}"."{name}" t) stored'
                )
                or []
            )
        return CatalogState(
            [row["version_num"] for row in await conn.fetch(f'SELECT version_num FROM "{schema}".alembic_version')],
            guard["oid"],
            guard["definition"],
            guard["attributes"],
            functions,
            triggers,
            indexes,
            rows,
        )
    finally:
        await conn.close()


def assert_preserved(before: CatalogState, after: CatalogState) -> None:
    assert after.guard_oid == before.guard_oid
    assert after.guard_attributes == before.guard_attributes
    assert after.other_functions == before.other_functions
    assert after.triggers == before.triggers
    assert after.indexes == before.indexes
    assert after.rows == before.rows


def normalize_definition(definition: str) -> str:
    return re.sub(r"\s+", "", definition)


@pytest.mark.asyncio
@pytest.mark.parametrize("schema", [None, "assoc_tenant"], ids=["public-default", "tenant"])
async def test_e30_upgrade_and_only_e40_rollback_preserve_rows_and_catalog(pg0_db_url: str, schema: str | None) -> None:
    async with owned_database(pg0_db_url) as url:
        target = schema or "public"
        # Establish both schemas at e30 through real Alembic history. The only
        # downgrade below is OUR revision, ending at e30, never e30's downgrade.
        bootstrap = await asyncpg.connect(url)
        try:
            await bootstrap.execute("CREATE EXTENSION vector")
            await bootstrap.execute("CREATE EXTENSION pg_trgm")
        finally:
            await bootstrap.close()
        command.upgrade(migration_config(url, None), PREVIOUS)
        command.upgrade(migration_config(url, "assoc_tenant"), PREVIOUS)
        other = "public" if schema else "assoc_tenant"
        conn = await asyncpg.connect(url)
        try:
            # Real Bank insert leaves nonempty immutable origin history. This
            # would make e30's own downgrade refuse, and must survive our step.
            await conn.execute(f'INSERT INTO "{target}".banks(bank_id,name) VALUES($1,$2)', "preserved", "original")
            await conn.execute(
                f'INSERT INTO "{target}".memory_units(id,bank_id,text,fact_type) VALUES($1,$2,$3,$4)',
                uuid.uuid4(),
                "preserved",
                "retained content",
                "world",
            )
        finally:
            await conn.close()
        backend = PostgreSQLBackend()
        await backend.initialize(url, min_size=1, max_size=2)
        try:
            async with backend.acquire() as conn:
                state = await ensure_replication_bank_state(
                    conn=conn, fq_table=lambda name: f'"{target}".{name}', bank_id="preserved"
                )
            request = TakiTransitionAcquireRequest(
                transition_id=uuid.uuid4(),
                attempt_id=uuid.uuid4(),
                provider_lineage=state.provider_lineage,
                bank_generation=state.bank_generation,
                direction="return-local",
                request_hash="0" * 64,
            )
            request.request_hash = transition_acquire_hash("preserved", request)
            # Like the native fq_table, also accept trusted function signatures;
            # quoting the whole "function(text)" token names a different object.
            owner = TransitionService(backend, lambda name: f'"{target}".{name}', "a" * 64)
            acquired = await owner.acquire("preserved", request)
            await owner.fence("preserved", acquired.executor)
        finally:
            await backend.shutdown()
        before = await snapshot(url, target)
        other_before = await snapshot(url, other)
        assert before.revisions == [PREVIOUS]
        assert before.rows["memory_transition_bank_origins"]
        assert before.rows["memory_transition_requests"] and before.rows["memory_transition_history"]
        assert before.guard_definition.count("id::text IN") == 3

        command.upgrade(migration_config(url, schema), CURRENT)
        upgraded = await snapshot(url, target)  # Always a fresh connection.
        assert upgraded.revisions == [CURRENT]
        assert_preserved(before, upgraded)
        assert await snapshot(url, other) == other_before
        assert "id::text" not in upgraded.guard_definition
        assert upgraded.guard_definition.count("::uuid") == 9
        # Removing just the approved RHS casts restores the complete old body,
        # including sorted Bank ownership, guards and OLD/NEW return behavior.
        restored = re.sub(r"\(item->>'([^']+)'\)::uuid", r"item->>'\1'", upgraded.guard_definition)
        restored = restored.replace("WHERE id IN", "WHERE id::text IN")
        assert normalize_definition(restored) == normalize_definition(before.guard_definition)

        command.downgrade(migration_config(url, schema), PREVIOUS)
        reverted = await snapshot(url, target)
        assert reverted.revisions == [PREVIOUS]
        assert_preserved(before, reverted)
        assert normalize_definition(reverted.guard_definition) == normalize_definition(before.guard_definition)
        assert await snapshot(url, other) == other_before
        command.upgrade(migration_config(url, schema), CURRENT)
        assert_preserved(before, await snapshot(url, target))
