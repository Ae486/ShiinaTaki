"""Real association row guards retain every typed OLD/NEW ownership boundary."""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Any

import asyncpg
import pytest

from hindsight_api.engine.db_utils import acquire_with_retry
from hindsight_api.engine.memories import get_memories
from hindsight_api.engine.memory_engine import MemoryEngine
from hindsight_api.engine.schema import fq_table
from hindsight_api.engine.transition_models import TakiTransitionAcquireRequest
from hindsight_api.extensions import OperationValidationError
from hindsight_api.models import RequestContext

from .maintenance_helpers import maintenance_schema as maintenance_schema
from .test_transition_fence import bank_request, service


@dataclass(frozen=True)
class BankRows:
    bank: str
    request: TakiTransitionAcquireRequest
    unit: uuid.UUID
    other_unit: uuid.UUID
    entity: uuid.UUID
    other_entity: uuid.UUID


@dataclass(frozen=True)
class Association:
    table: str
    columns: tuple[str, ...]
    values: tuple[Any, ...]

    async def insert(self, conn: Any) -> None:
        placeholders = ",".join(f"${index + 1}" for index in range(len(self.values)))
        await conn.execute(
            f"INSERT INTO {fq_table(self.table)}({','.join(self.columns)}) VALUES({placeholders})", *self.values
        )

    async def update(self, conn: Any) -> None:
        assignments = ",".join(f"{column}=${index + 1}" for index, column in enumerate(self.columns))
        await conn.execute(f"UPDATE {fq_table(self.table)} SET {assignments}", *self.values)


async def seed(memory: MemoryEngine, context: RequestContext, *, count: int = 5) -> list[BankRows]:
    result = []
    for index in range(count):
        bank, request = await bank_request(memory, context)
        rows = BankRows(bank, request, *[uuid.UUID(int=index * 100 + n) for n in (1, 2, 3, 4)])
        async with acquire_with_retry(memory._backend) as conn:
            await conn.executemany(
                f"INSERT INTO {fq_table('memory_units')}(id,bank_id,text,fact_type) VALUES($1,$2,$3,'world')",
                [(rows.unit, bank, "first"), (rows.other_unit, bank, "second")],
            )
            await conn.executemany(
                f"INSERT INTO {fq_table('entities')}(id,bank_id,canonical_name) VALUES($1,$2,$3)",
                [(rows.entity, bank, "first"), (rows.other_entity, bank, "second")],
            )
        result.append(rows)
    return result


def association(table: str, left: BankRows, right: BankRows, legacy: BankRows, direct: BankRows) -> Association:
    if table == "memory_links":
        return Association(
            table,
            ("bank_id", "from_unit_id", "to_unit_id", "entity_id", "link_type", "weight"),
            (direct.bank, left.unit, right.other_unit, legacy.entity, "entity", 0.5),
        )
    if table == "unit_entities":
        return Association(table, ("unit_id", "entity_id"), (left.unit, right.other_entity))
    assert table == "entity_cooccurrences"
    endpoints = sorted([left.entity, right.other_entity])
    return Association(table, ("entity_id_1", "entity_id_2", "cooccurrence_count"), (*endpoints, 1))


async def fence(memory: MemoryEngine, bank: BankRows) -> None:
    owner = service(memory)
    acquired = await owner.acquire(bank.bank, bank.request)
    await owner.fence(bank.bank, acquired.executor)


async def table_rows(conn: Any, table: str) -> list[str]:
    return list(
        await conn.fetchval(
            f"SELECT array_agg(body ORDER BY body) FROM "
            f"(SELECT to_jsonb(t)::text AS body FROM {fq_table(table)} t) rows"
        )
        or []
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("event", ["insert", "delete", "update-old", "update-new"])
@pytest.mark.parametrize(
    ("table", "fenced_index"),
    [("memory_links", index) for index in range(4)]
    + [(table, index) for table in ("unit_entities", "entity_cooccurrences") for index in range(2)],
)
async def test_every_real_association_owner_remains_fenced_across_old_and_new(
    memory: MemoryEngine,
    request_context: RequestContext,
    maintenance_schema: str,
    table: str,
    fenced_index: int,
    event: str,
) -> None:
    banks = await seed(memory, request_context)
    owned = association(table, *banks[:4])
    neutral = association(table, *([banks[-1]] * 4))
    async with acquire_with_retry(memory._backend) as conn:
        if event != "insert":
            await (neutral if event == "update-new" else owned).insert(conn)
        before = await table_rows(conn, table)
    await fence(memory, banks[fenced_index])
    async with acquire_with_retry(memory._backend) as conn:
        with pytest.raises(OperationValidationError, match="taki_transition_fenced"):
            async with conn.transaction():
                if event == "insert":
                    await owned.insert(conn)
                elif event == "delete":
                    await conn.execute(f"DELETE FROM {fq_table(table)}")
                elif event == "update-old":
                    await neutral.update(conn)
                else:
                    await owned.update(conn)
        assert await table_rows(conn, table) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["memory_links", "unit_entities", "entity_cooccurrences"])
async def test_unfenced_updates_and_deletes_work_and_outer_rollback_restores_exact_rows(
    memory: MemoryEngine,
    request_context: RequestContext,
    maintenance_schema: str,
    table: str,
) -> None:
    banks = await seed(memory, request_context, count=2)
    original = association(table, banks[0], banks[0], banks[0], banks[0])
    replacement = association(table, banks[1], banks[1], banks[1], banks[1])
    async with acquire_with_retry(memory._backend) as conn:
        await original.insert(conn)
        before = await table_rows(conn, table)
        with pytest.raises(RuntimeError, match="owned rollback"):
            async with conn.transaction():
                await replacement.update(conn)
                assert await table_rows(conn, table) != before
                await conn.execute(f"DELETE FROM {fq_table(table)}")
                assert await table_rows(conn, table) == []
                raise RuntimeError("owned rollback")
        assert await table_rows(conn, table) == before


@pytest.mark.asyncio
async def test_null_legacy_endpoint_and_missing_foreign_key_preserve_normal_writes(
    memory: MemoryEngine,
    request_context: RequestContext,
    maintenance_schema: str,
) -> None:
    bank = (await seed(memory, request_context, count=1))[0]
    async with acquire_with_retry(memory._backend) as conn:
        await conn.execute(
            f"INSERT INTO {fq_table('memory_links')}(bank_id,from_unit_id,to_unit_id,link_type,entity_id) "
            "VALUES($1,$2,$3,'semantic',NULL)",
            bank.bank,
            bank.unit,
            bank.other_unit,
        )
        await conn.execute(f"UPDATE {fq_table('memory_links')} SET weight=0.75")
        before = await table_rows(conn, "memory_links")
        # A missing UUID endpoint remains absent in the ownership lookup; the
        # actual FK, not a UUID cast error, still refuses the impossible row.
        with pytest.raises(asyncpg.ForeignKeyViolationError):
            async with conn.transaction():
                await conn.execute(
                    f"INSERT INTO {fq_table('unit_entities')}(unit_id,entity_id) VALUES($1,$2)",
                    uuid.uuid4(),
                    bank.entity,
                )
        assert await table_rows(conn, "memory_links") == before
        assert await table_rows(conn, "unit_entities") == []
        await conn.execute(f"DELETE FROM {fq_table('memory_links')}")
        assert await table_rows(conn, "memory_links") == []


@pytest.mark.asyncio
@pytest.mark.parametrize("table", ["memory_links", "unit_entities", "entity_cooccurrences"])
async def test_real_foreign_key_cascade_refuses_fenced_peer_and_rolls_back_parent_delete(
    memory: MemoryEngine,
    request_context: RequestContext,
    maintenance_schema: str,
    table: str,
) -> None:
    banks = await seed(memory, request_context, count=2)
    relation = association(table, banks[0], banks[1], banks[1], banks[0])
    async with acquire_with_retry(memory._backend) as conn:
        await relation.insert(conn)
        before = await table_rows(conn, table)
    # The deleted endpoint's Bank is free. The association must still discover
    # and refuse its surviving fenced peer after the parent's row disappears.
    await fence(memory, banks[1])
    parent_table = "entities" if table == "entity_cooccurrences" else "memory_units"
    parent_id = banks[0].entity if table == "entity_cooccurrences" else banks[0].unit
    async with acquire_with_retry(memory._backend) as conn:
        with pytest.raises(OperationValidationError, match="taki_transition_fenced"):
            async with conn.transaction():
                await conn.execute(f"DELETE FROM {fq_table(parent_table)} WHERE id=$1", parent_id)
        assert await conn.fetchval(f"SELECT count(*) FROM {fq_table(parent_table)} WHERE id=$1", parent_id) == 1
        assert await table_rows(conn, table) == before


@pytest.mark.asyncio
async def test_archive_lookup_uses_real_invalidated_row_and_same_bank_set(
    memory: MemoryEngine,
    request_context: RequestContext,
    maintenance_schema: str,
) -> None:
    banks = await seed(memory, request_context, count=2)
    async with acquire_with_retry(memory._backend) as conn, conn.transaction():
        await association("unit_entities", banks[0], banks[1], banks[1], banks[0]).insert(conn)
        # The real invalidation producer moves the unit and executes FK cascades.
        assert await get_memories().invalidate_memory(
            conn=conn,
            fq_table=fq_table,
            bank_id=banks[0].bank,
            unit_id=str(banks[0].unit),
            reason="owned archive",
        )
        assert await conn.fetchval(f"SELECT count(*) FROM {fq_table('unit_entities')}") == 0
        assert (
            await conn.fetchval(
                f"SELECT count(*) FROM {fq_table('invalidated_memory_units')} WHERE id=$1", banks[0].unit
            )
            == 1
        )
        definition = await conn.fetchval(
            "SELECT pg_get_functiondef(to_regprocedure($1))", fq_table("guard_transition_association_write") + "()"
        )
        match = re.search(r"FOR\s+target_bank\s+IN\s+(SELECT.*?)\s+LOOP\s+PERFORM", definition, re.I | re.S)
        assert match is not None
        current_sql = match[1].replace("unnest(items)", "unnest($1::jsonb[])")
        assert "id::text" not in current_sql and current_sql.count("::uuid") == 9
        previous_sql = re.sub(r"\(item->>'([^']+)'\)::uuid", r"item->>'\1'", current_sql)
        previous_sql = previous_sql.replace("WHERE id IN", "WHERE id::text IN")
        # These SELECT-only inputs cover the archived endpoint branch after the
        # FK legitimately removed the association; no orphan rows are invented.
        inputs = [json.dumps({"unit_id": str(banks[0].unit), "entity_id": str(banks[1].entity)})]
        current = [row["bank_id"] for row in await conn.fetch(current_sql, inputs)]
        previous = [row["bank_id"] for row in await conn.fetch(previous_sql, inputs)]
        assert current == previous == sorted([banks[0].bank, banks[1].bank])
        for item in ({}, {"entity_id": None}, {"unit_id": str(uuid.uuid4())}):
            assert await conn.fetch(current_sql, [json.dumps(item)]) == await conn.fetch(
                previous_sql, [json.dumps(item)]
            )
