"""Bounded derived-edge removal preserves the exact owned transactional set."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

import pytest

from hindsight_api.engine.db_utils import acquire_with_retry
from hindsight_api.engine.memories import get_memories
from hindsight_api.engine.memory_engine import MemoryEngine
from hindsight_api.engine.schema import fq_table
from hindsight_api.engine.transfer.transition_delta_rows import preserve_transition_units
from hindsight_api.models import RequestContext

from .application_helpers import application_case
from .maintenance_helpers import maintenance_schema as maintenance_schema


@dataclass
class DeleteProbe:
    conn: Any
    batches: list[list[str]] = field(default_factory=list)
    fail_after_delete: bool = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.conn, name)

    async def execute(self, query: str, *args: Any, **kwargs: Any) -> Any:
        derived_delete = query.startswith(f"DELETE FROM {fq_table('memory_links')}") and "link_type IN" in query
        if derived_delete:
            targets = args[1] if isinstance(args[1], list) else [args[1]]
            self.batches.append([str(value) for value in targets])
        result = await self.conn.execute(query, *args, **kwargs)
        if derived_delete and self.fail_after_delete:
            raise RuntimeError("owned derived deletion failure")
        return result


@dataclass(frozen=True)
class Edge:
    bank: str
    source: uuid.UUID
    target: uuid.UUID
    kind: str
    weight: float


async def edges(conn: Any) -> set[Edge]:
    return {
        Edge(row["bank_id"], row["from_unit_id"], row["to_unit_id"], row["link_type"], row["weight"])
        for row in await conn.fetch(
            f"SELECT bank_id,from_unit_id,to_unit_id,link_type,weight FROM {fq_table('memory_links')}"
        )
    }


async def add_units(conn: Any, bank: str, ids: list[str], text: str) -> None:
    await conn.executemany(
        f"INSERT INTO {fq_table('memory_units')} (id,bank_id,text,fact_type) VALUES($1::uuid,$2,$3,'world')",
        [(identity, bank, text) for identity in ids],
    )


@pytest.mark.asyncio
async def test_existing_targets_delete_exact_edge_union_in_one_bounded_batch(
    memory: MemoryEngine, request_context: RequestContext, maintenance_schema: str
) -> None:
    app = await application_case(memory, request_context)
    targets = [str(uuid.uuid4()) for _ in range(3)]
    temporary = [str(uuid.uuid4()) for _ in targets]
    untouched = str(uuid.uuid4())
    async with acquire_with_retry(memory._backend) as conn, conn.transaction():
        await add_units(conn, app.bank_id, [*targets, untouched], "old")
        await add_units(conn, app.bank_id, temporary, "changed")
        await conn.executemany(
            f"INSERT INTO {fq_table('memory_links')} (bank_id,from_unit_id,to_unit_id,link_type,weight) "
            "VALUES($1,$2::uuid,$3::uuid,$4,0.5)",
            [
                (app.bank_id, left, right, kind)
                for left, right in ((targets[0], targets[1]), (targets[1], untouched), (untouched, targets[2]))
                for kind in ("temporal", "semantic", "causes")
            ],
        )
        before = await edges(conn)
        affected = {uuid.UUID(value) for value in targets}
        expected = {
            edge
            for edge in before
            if not (
                edge.bank == app.bank_id
                and edge.kind in {"temporal", "semantic"}
                and (edge.source in affected or edge.target in affected)
            )
        }
        probe = DeleteProbe(conn)
        await preserve_transition_units(
            conn=probe,
            fq_table=fq_table,
            bank_id=app.bank_id,
            temporary_ids=temporary,
            target_ids=targets,
            revisions=[2] * len(targets),
        )
        assert await edges(conn) == expected
        assert len(probe.batches) == 1, "replace repeated scans with one bounded exact-set deletion"
        assert set(probe.batches[0]) == set(targets)
        assert await conn.fetchval(
            f"SELECT count(*) FROM {fq_table('memory_units')} WHERE id=ANY($1::uuid[]) AND text='changed' AND revision=2",
            [uuid.UUID(value) for value in targets],
        ) == len(targets)


@pytest.mark.asyncio
async def test_mixed_live_new_and_restored_targets_preserve_causal_and_foreign_edges(
    memory: MemoryEngine, request_context: RequestContext, maintenance_schema: str
) -> None:
    app = await application_case(memory, request_context)
    foreign = await application_case(memory, request_context)
    live, archived, new, peer = [str(uuid.uuid4()) for _ in range(4)]
    temporary = [str(uuid.uuid4()) for _ in range(3)]
    async with acquire_with_retry(memory._backend) as conn, conn.transaction():
        await add_units(conn, app.bank_id, [live, archived, peer], "old")
        await add_units(conn, app.bank_id, temporary, "changed")
        await conn.executemany(
            f"INSERT INTO {fq_table('memory_links')} (bank_id,from_unit_id,to_unit_id,link_type,weight) "
            "VALUES($1,$2::uuid,$3::uuid,$4,0.5)",
            [
                (app.bank_id, live, peer, "semantic"),
                (app.bank_id, peer, archived, "temporal"),
                (app.bank_id, live, archived, "causes"),
                (app.bank_id, live, peer, "caused_by"),
                # Deliberately misattributed owned-fixture evidence makes the Bank
                # predicate independently observable, rather than relying on UUIDs.
                (foreign.bank_id, live, peer, "temporal"),
            ],
        )
        initial = await edges(conn)
        assert await get_memories().invalidate_memory(
            conn=conn, fq_table=fq_table, bank_id=app.bank_id, unit_id=archived, reason="owned archive"
        )
        probe = DeleteProbe(conn)
        await preserve_transition_units(
            conn=probe,
            fq_table=fq_table,
            bank_id=app.bank_id,
            temporary_ids=temporary,
            target_ids=[live, archived, new],
            revisions=[2, 2, 1],
        )
        assert probe.batches == [[live, archived]]
        remaining = await edges(conn)
        assert {edge for edge in initial if edge.kind not in {"temporal", "semantic"}} <= remaining
        assert {edge for edge in initial if edge.bank == foreign.bank_id} <= remaining
        assert not any(
            edge.bank == app.bank_id
            and edge.kind in {"temporal", "semantic"}
            and (str(edge.source) in {live, archived} or str(edge.target) in {live, archived})
            for edge in remaining
        )
        rows = await conn.fetch(
            f"SELECT id,revision,text FROM {fq_table('memory_units')} WHERE id=ANY($1::uuid[])",
            [uuid.UUID(value) for value in [live, archived, new]],
        )
        assert {(str(row["id"]), row["revision"], row["text"]) for row in rows} == {
            (live, 2, "changed"),
            (archived, 2, "changed"),
            (new, 1, "changed"),
        }
        assert (
            await conn.fetchval(
                f"SELECT count(*) FROM {fq_table('invalidated_memory_units')} WHERE id=$1::uuid", archived
            )
            == 0
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 129])
async def test_derived_link_batches_are_bounded_and_empty_targets_do_nothing(
    memory: MemoryEngine, request_context: RequestContext, maintenance_schema: str, count: int
) -> None:
    app = await application_case(memory, request_context)
    targets = [str(uuid.uuid4()) for _ in range(count)]
    temporary = [str(uuid.uuid4()) for _ in targets]
    async with acquire_with_retry(memory._backend) as conn, conn.transaction():
        await add_units(conn, app.bank_id, targets, "old")
        await add_units(conn, app.bank_id, temporary, "changed")
        if targets:
            await conn.execute(
                f"INSERT INTO {fq_table('memory_links')} (bank_id,from_unit_id,to_unit_id,link_type,weight) "
                "VALUES($1,$2::uuid,$3::uuid,'semantic',0.5)",
                app.bank_id,
                targets[-1],
                targets[0],
            )
        before = await edges(conn)
        probe = DeleteProbe(conn)
        await preserve_transition_units(
            conn=probe,
            fq_table=fq_table,
            bank_id=app.bank_id,
            temporary_ids=temporary,
            target_ids=targets,
            revisions=[2] * count,
        )
        assert [len(batch) for batch in probe.batches] == ([128, 1] if count else [])
        affected = {uuid.UUID(value) for value in targets}
        assert await edges(conn) == {
            edge
            for edge in before
            if not (
                edge.bank == app.bank_id
                and edge.kind in {"temporal", "semantic"}
                and (edge.source in affected or edge.target in affected)
            )
        }


@pytest.mark.asyncio
async def test_failed_set_deletion_rolls_back_prior_rows_and_exact_edges(
    memory: MemoryEngine, request_context: RequestContext, maintenance_schema: str
) -> None:
    app = await application_case(memory, request_context)
    targets = [str(uuid.uuid4()) for _ in range(2)]
    temporary = [str(uuid.uuid4()) for _ in targets]
    async with acquire_with_retry(memory._backend) as conn:
        await add_units(conn, app.bank_id, targets, "old")
        await add_units(conn, app.bank_id, temporary, "changed")
        await conn.execute(
            f"INSERT INTO {fq_table('memory_links')} (bank_id,from_unit_id,to_unit_id,link_type,weight) "
            "VALUES($1,$2::uuid,$3::uuid,'semantic',0.5)",
            app.bank_id,
            targets[0],
            targets[1],
        )
        before_edges = await edges(conn)
        query = f"SELECT to_jsonb(t)::text AS value FROM {fq_table('memory_units')} t WHERE bank_id=$1 ORDER BY id"
        before_rows = await conn.fetch(query, app.bank_id)
        with pytest.raises(RuntimeError, match="owned derived deletion failure"):
            async with conn.transaction():
                await preserve_transition_units(
                    conn=DeleteProbe(conn, fail_after_delete=True),
                    fq_table=fq_table,
                    bank_id=app.bank_id,
                    temporary_ids=temporary,
                    target_ids=targets,
                    revisions=[2, 2],
                )
        assert await edges(conn) == before_edges
        assert await conn.fetch(query, app.bank_id) == before_rows
