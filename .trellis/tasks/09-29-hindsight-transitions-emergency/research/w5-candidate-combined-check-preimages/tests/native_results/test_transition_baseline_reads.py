"""Delta baseline byte reuse remains local to each fully validated SQL view."""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections import Counter
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest

from hindsight_api.engine import transition_baseline_reads, transition_snapshot
from hindsight_api.engine.application_state.codec import digest, json_bytes
from hindsight_api.engine.application_state.models import (
    ApplicationStateError,
    TakiApplicationBodyRef,
    TakiApplicationExactBinding,
    TakiApplicationNamespace,
    TakiApplicationSourceBody,
    TakiApplicationSourceEvidenceBody,
)
from hindsight_api.engine.application_state.store import ApplicationStateStore, artifact_version
from hindsight_api.engine.db_utils import acquire_with_retry
from hindsight_api.engine.memory_engine import MemoryEngine
from hindsight_api.engine.schema import fq_table
from hindsight_api.engine.transition_baseline_reads import _TransitionValidationReader
from hindsight_api.models import RequestContext

from .maintenance_helpers import maintenance_schema as maintenance_schema
from .transition_delta_helpers import delta_case


@pytest.mark.asyncio
async def test_delta_reads_each_verified_body_once_in_each_independent_baseline(
    memory: MemoryEngine, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch, maintenance_schema: str
) -> None:
    case = await delta_case(memory, request_context, monkeypatch)
    baseline = transition_snapshot.capture_transition_baseline
    ordinary_bytes = ApplicationStateStore.body_bytes
    counts: list[Counter[str]] = []
    active: Counter[str] | None = None

    async def counted_bytes(store: ApplicationStateStore, descriptor: TakiApplicationBodyRef, **kwargs: Any) -> bytes:
        if active is not None:
            active[str(descriptor.body_id)] += 1
        return await ordinary_bytes(store, descriptor, **kwargs)

    async def measured_baseline(*args: Any, **kwargs: Any) -> transition_snapshot.TransitionBaseline:
        nonlocal active
        active = Counter()
        try:
            result = await baseline(*args, **kwargs)
            counts.append(active)
            return result
        finally:
            active = None

    monkeypatch.setattr(ApplicationStateStore, "body_bytes", counted_bytes)
    monkeypatch.setattr(transition_snapshot, "capture_transition_baseline", measured_baseline)
    result = await case.service.apply(case.app.bank_id, case.request)
    assert result.request_hash == case.request.request_hash
    assert len(counts) == 2, "both transaction baselines must independently read all bodies"
    assert counts[0].keys() == counts[1].keys()
    assert all(count and max(count.values()) == 1 for count in counts), "duplicate full body validation within baseline"


@dataclass(frozen=True)
class BodyCase:
    app: ApplicationCase
    source: TakiApplicationBodyRef
    other: TakiApplicationBodyRef
    original: bytes


@pytest.fixture
async def bodies(memory: MemoryEngine, request_context: RequestContext, maintenance_schema: str) -> BodyCase:
    app = await application_case(memory, request_context)
    body = source_body()
    async with acquire_with_retry(memory._backend) as conn, conn.transaction():
        store = ApplicationStateStore(conn, fq_table, app.bank_id, app.namespace)
        source = await store.save_body("application-source.v1", body)
        original = await store.body_bytes(source)
        body.original_source.retainedText = "A distinct retained source"
        other = await store.save_body("application-source.v1", body)
    return BodyCase(app, source, other, original)


@pytest.mark.asyncio
async def test_ordinary_and_optimized_baseline_have_identical_complete_hashes(
    memory: MemoryEngine, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch, maintenance_schema: str
) -> None:
    case = await delta_case(memory, request_context, monkeypatch, archived=True)
    async with acquire_with_retry(memory._backend) as conn, conn.transaction():
        ordinary = await transition_snapshot.capture_transition_baseline(conn, fq_table, case.app.bank_id)
        optimized = await transition_snapshot.capture_transition_baseline(
            conn, fq_table, case.app.bank_id, _reuse_body_bytes=True
        )
    assert optimized == ordinary
    assert case.baseline.proof is not None
    assert ordinary.baseline_hash == case.baseline.proof.baseline_hash


@pytest.mark.asyncio
async def test_fresh_models_and_nested_metadata_cannot_contaminate_verified_bytes(bodies: BodyCase) -> None:
    app = bodies.app
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        reader = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        first = await reader.read_body(bodies.source)
        assert isinstance(first, TakiApplicationSourceBody)
        first.original_source.retainedText = "caller mutation"
        first.original_source.metadata["source-map"]["deep"] = {"changed": True}
        first.original_source.tags.append("caller-tag")
        second = await reader.read_body(bodies.source)
        assert isinstance(second, TakiApplicationSourceBody)
        assert json_bytes(second) == bodies.original
        assert second is not first and second.original_source is not first.original_source
        with pytest.raises(ApplicationStateError, match="body_conflict"):
            await reader.read_body(bodies.source.model_copy(update={"payload_hash": "0" * 64}))
        assert await reader.body_bytes(bodies.source) == bodies.original
        reader.close()
        assert not reader._verified and reader._verified_bytes == 0


@pytest.mark.asyncio
async def test_cached_hit_discards_only_its_queued_and_staged_rows_and_preserves_refusals(bodies: BodyCase) -> None:
    app = bodies.app
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        reader = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        assert await reader.body_bytes(bodies.source) == bodies.original
        # Re-enumeration can queue an already verified body, even while another
        # listing has prefetched it. A hit must not strand this raw batch.
        reader._pending[bodies.source.body_id] = None
        await reader._prefetch(bodies.other.body_id)
        reader._pending[bodies.source.body_id] = None
        assert bodies.source.body_id in reader._metadata and bodies.source.body_id in reader._parts
        assert await reader.body_bytes(bodies.source) == bodies.original
        assert bodies.source.body_id not in reader._pending
        assert bodies.source.body_id not in reader._metadata
        assert bodies.source.body_id not in reader._parts
        assert bodies.other.body_id in reader._metadata and bodies.other.body_id in reader._parts
        # Dropping raw transport rows is not a body-ID cache key. The complete
        # descriptor still controls reuse, and a conflicting alias is reread.
        with pytest.raises(ApplicationStateError, match="body_conflict"):
            await reader.read_body(bodies.source.model_copy(update={"payload_hash": "0" * 64}))
        assert await reader.body_bytes(bodies.source) == bodies.original
        await reader.read_body(bodies.other)
        reader.close()
        await conn.execute(
            f"UPDATE {fq_table('memory_application_body_parts')} SET data=set_byte(data,0,0) WHERE body_id=$1",
            bodies.source.body_id,
        )
        fresh = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        try:
            with pytest.raises(ApplicationStateError, match="body_integrity_error"):
                await fresh.read_body(bodies.source)
        finally:
            fresh.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["missing", "extra", "order", "bytes", "whole", "semantic", "schema", "unsealed"])
async def test_corrupt_storage_refuses_equally_with_prefetch_and_ordinary_reader(bodies: BodyCase, fault: str) -> None:
    app = bodies.app
    descriptor = bodies.source
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        table = fq_table("memory_application_body_parts")
        if fault == "missing":
            await conn.execute(f"DELETE FROM {table} WHERE body_id=$1 AND part_number=0", descriptor.body_id)
        elif fault == "extra":
            await conn.execute(
                f"INSERT INTO {table} (provider_lineage,bank_id,bank_generation,body_id,part_number,part_sha256,data) "
                "VALUES ($1,$2,$3,$4,$5,$6,$7)",
                app.namespace.provider_lineage,
                app.bank_id,
                app.namespace.bank_generation,
                descriptor.body_id,
                descriptor.total_parts,
                hashlib.sha256(b"x").hexdigest(),
                b"x",
            )
        elif fault == "order":
            await conn.execute(f"UPDATE {table} SET part_number=part_number+10 WHERE body_id=$1", descriptor.body_id)
        elif fault == "bytes":
            await conn.execute(f"UPDATE {table} SET data=set_byte(data,0,0) WHERE body_id=$1", descriptor.body_id)
        elif fault == "unsealed":
            await conn.execute(
                f"UPDATE {fq_table('memory_application_bodies')} SET state='uploading' WHERE body_id=$1",
                descriptor.body_id,
            )
        else:
            field = {"whole": "bytes_sha256", "semantic": "payload_hash", "schema": "body_schema"}[fault]
            value = "application-block.v1" if fault == "schema" else "0" * 64
            descriptor = descriptor.model_copy(update={field: value})
            await conn.execute(
                f"UPDATE {fq_table('memory_application_bodies')} SET descriptor=$2 WHERE body_id=$1",
                descriptor.body_id,
                json_bytes(descriptor),
            )
        errors = []
        for reader_type in (ApplicationStateStore, _TransitionValidationReader):
            reader = reader_type(conn, fq_table, app.bank_id, app.namespace)
            with pytest.raises(ApplicationStateError) as refused:
                await reader.read_body(descriptor)
            errors.append((refused.value.response.code, refused.value.status_code))
            if isinstance(reader, _TransitionValidationReader):
                assert not reader._verified
                reader.close()
        assert errors[0] == errors[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("budget", ["none", "eviction", "tiny_batch"])
async def test_resource_budgets_fall_back_without_skipping_integrity(
    bodies: BodyCase, monkeypatch: pytest.MonkeyPatch, budget: str
) -> None:
    app = bodies.app
    monkeypatch.setattr(transition_baseline_reads, "_CACHE_BYTES", 0 if budget == "none" else bodies.source.total_bytes)
    if budget == "tiny_batch":
        monkeypatch.setattr(transition_baseline_reads, "_BATCH_BYTES", 1)
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        reader = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        assert await reader.body_bytes(bodies.source) == bodies.original
        await reader.read_body(bodies.other)
        assert await reader.body_bytes(bodies.source) == bodies.original
        assert reader._verified_bytes <= transition_baseline_reads._CACHE_BYTES
        if budget == "none":
            assert not reader._verified
        elif budget == "eviction":
            assert len(reader._verified) == 1
        reader.close()
        # A fresh reader must observe corruption even after successful fallback.
        await conn.execute(
            f"UPDATE {fq_table('memory_application_body_parts')} SET data=set_byte(data,0,0) WHERE body_id=$1",
            bodies.source.body_id,
        )
        with pytest.raises(ApplicationStateError, match="body_integrity_error"):
            await _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace).read_body(bodies.source)


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["bank", "generation", "lineage", "connection"])
async def test_reader_scope_never_aliases_verified_bytes(bodies: BodyCase, scope: str) -> None:
    app = bodies.app
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        reader = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        await reader.read_body(bodies.source)
        if scope == "bank":
            reader.bank_id = "another-bank"
        elif scope == "connection":
            reader.conn = object()
        else:
            reader.namespace = TakiApplicationNamespace(
                provider_lineage=uuid.uuid4() if scope == "lineage" else app.namespace.provider_lineage,
                bank_generation=uuid.uuid4() if scope == "generation" else app.namespace.bank_generation,
            )
        with pytest.raises(ApplicationStateError, match="namespace_mismatch"):
            await reader.read_body(bodies.source)
        reader.close()
        foreign = _TransitionValidationReader(conn, fq_table, "another-bank", app.namespace)
        with pytest.raises(ApplicationStateError, match="body_not_found"):
            await foreign.read_body(bodies.source)
        foreign.close()


@pytest.mark.asyncio
async def test_second_admit_rereads_corruption_and_leaves_no_delta_commit(
    memory: MemoryEngine, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch, maintenance_schema: str
) -> None:
    from hindsight_api.engine.transfer import transition_delta

    case = await delta_case(memory, request_context, monkeypatch)
    prepare = transition_delta.prepare_current_state_rows
    calls = 0

    async def corrupt_between_transactions(**kwargs: Any) -> Any:
        nonlocal calls
        calls += 1
        async with acquire_with_retry(memory._backend) as conn, conn.transaction():
            await conn.execute(
                f"UPDATE {fq_table('memory_application_body_parts')} SET data=set_byte(data,0,0) WHERE body_id=$1",
                case.original.source_ref.body_id,
            )
        return await prepare(**kwargs)

    monkeypatch.setattr(transition_delta, "prepare_current_state_rows", corrupt_between_transactions)
    monkeypatch.setattr(
        transition_delta, "write_transition_native_delta", AsyncMock(side_effect=AssertionError("write"))
    )
    with pytest.raises(ApplicationStateError, match="body_integrity_error"):
        await case.service.apply(case.app.bank_id, case.request)
    assert calls == 1
    assert await logical_records(memory, case.app.bank_id) == case.records
    assert await case.service.lookup(case.app.bank_id, case.request.executor.transition_id) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["cancel", "integrity", "success"])
async def test_baseline_disposes_reader_on_every_exit(
    bodies: BodyCase, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    app = bodies.app
    readers: list[_TransitionValidationReader] = []
    close = _TransitionValidationReader.close

    def observed_close(reader: _TransitionValidationReader) -> None:
        readers.append(reader)
        close(reader)

    monkeypatch.setattr(_TransitionValidationReader, "close", observed_close)
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        if failure != "success":
            ordinary = ApplicationStateStore.read_body

            async def fail_after_read(reader: ApplicationStateStore, descriptor: TakiApplicationBodyRef) -> Any:
                await ordinary(reader, descriptor)
                if failure == "cancel":
                    raise asyncio.CancelledError()
                raise ApplicationStateError("body_integrity_error", 503)

            monkeypatch.setattr(ApplicationStateStore, "read_body", fail_after_read)
            with pytest.raises(asyncio.CancelledError if failure == "cancel" else ApplicationStateError):
                await transition_snapshot.capture_transition_baseline(
                    conn, fq_table, app.bank_id, _reuse_body_bytes=True
                )
        else:
            await transition_snapshot.capture_transition_baseline(conn, fq_table, app.bank_id, _reuse_body_bytes=True)
    assert len(readers) == 1
    reader = readers[0]
    assert reader._closed and reader._verified_bytes == 0
    assert (
        not reader._verified
        and not reader._active
        and not reader._parts
        and not reader._metadata
        and not reader._pending
    )


@pytest.mark.asyncio
async def test_source_closure_is_rechecked_on_cached_bytes_and_cycle_is_refused(
    bodies: BodyCase, monkeypatch: pytest.MonkeyPatch
) -> None:
    from hindsight_api.engine.application_state import source_evidence

    app = bodies.app
    await install_original_artifacts(app)
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        store = ApplicationStateStore(conn, fq_table, app.bank_id, app.namespace)
        previous = next(row for row in await store.artifacts() if row.key.artifact_kind == "source")
        assert isinstance(previous.binding, TakiApplicationExactBinding)
        source = source_body()
        source.operation_id = source.original_witness = source.encoded_metadata = None
        ref = await store.save_body("application-source.v1", source)
        evidence = TakiApplicationSourceEvidenceBody(
            source_ref=ref,
            source_record_hash=digest("transition-source-evidence", app.namespace, app.bank_id, source.original_source),
            previous=artifact_version(previous),
            previous_body_hash=previous.body_ref.bytes_sha256,
            associated_native=previous.binding.native,
        )
        evidence_ref = await store.save_body("application-source-evidence.v1", evidence)
        reader = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        await reader.read_body(evidence_ref)
        # Closure must still consult its exact historical artifact on a bytes hit.
        monkeypatch.setattr(reader, "artifact", AsyncMock(return_value=None))
        with pytest.raises(ApplicationStateError, match="source_reference_invalid"):
            await reader.read_body(evidence_ref)
        assert reader._identity(evidence_ref) not in reader._verified
        reader.close()

        ordinary_closure = source_evidence.read_source_evidence

        async def cyclic_closure(store: ApplicationStateStore, body: TakiApplicationSourceEvidenceBody) -> Any:
            return await store.read_body(evidence_ref)

        monkeypatch.setattr(source_evidence, "read_source_evidence", cyclic_closure)
        cyclic = _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace)
        with pytest.raises(ApplicationStateError, match="source_reference_invalid"):
            await cyclic.read_body(evidence_ref)
        assert not cyclic._active and not cyclic._verified
        cyclic.close()
        monkeypatch.setattr(source_evidence, "read_source_evidence", ordinary_closure)
        await conn.execute(
            f"UPDATE {fq_table('memory_application_body_parts')} SET data=set_byte(data,0,0) WHERE body_id=$1",
            ref.body_id,
        )
        with pytest.raises(ApplicationStateError, match="body_integrity_error"):
            await _TransitionValidationReader(conn, fq_table, app.bank_id, app.namespace).read_body(evidence_ref)


@dataclass(frozen=True)
class ForeignRow:
    row: Any

    def __getitem__(self, key: str) -> Any:
        return uuid.UUID(int=0) if key == "provider_lineage" else self.row[key]


@dataclass
class PrefetchConnection:
    conn: Any
    fault: str
    raw_part_bytes: int = 0
    raw_metadata_bytes: int = 0

    def __getattr__(self, name: str) -> Any:
        return getattr(self.conn, name)

    async def fetch(self, query: str, *args: Any) -> list[Any]:
        rows = await self.conn.fetch(query, *args)
        metadata = "SUM(octet_length(descriptor)) OVER" in query
        parts = "SUM(octet_length(data)) OVER" in query
        if metadata:
            self.raw_metadata_bytes += sum(len(row["descriptor"]) for row in rows)
        if parts:
            self.raw_part_bytes += sum(len(row["data"]) for row in rows)
        if rows and ((metadata and self.fault == "duplicate_metadata") or (parts and self.fault == "duplicate_parts")):
            return [*rows, rows[0]]
        if rows and metadata and self.fault == "foreign":
            return [ForeignRow(rows[0]), *rows[1:]]
        if rows and parts and self.fault == "out_of_order":
            return list(reversed(rows))
        return rows


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["duplicate_metadata", "duplicate_parts", "foreign", "out_of_order"])
async def test_prefetch_never_collapses_duplicate_foreign_or_out_of_order_rows(bodies: BodyCase, fault: str) -> None:
    app = bodies.app
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        reader = _TransitionValidationReader(PrefetchConnection(conn, fault), fq_table, app.bank_id, app.namespace)
        with pytest.raises(
            ApplicationStateError, match="namespace_mismatch" if fault == "foreign" else "body_integrity_error"
        ):
            await reader.read_body(bodies.source)
        assert not reader._verified
        reader.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("storage", ["parts", "metadata"])
async def test_actual_storage_bytes_bound_prefetch_before_materialization(
    bodies: BodyCase, monkeypatch: pytest.MonkeyPatch, storage: str
) -> None:
    app = bodies.app
    monkeypatch.setattr(transition_baseline_reads, "_BATCH_BYTES", 1024)
    async with acquire_with_retry(app.memory._backend) as conn, conn.transaction():
        if storage == "metadata":
            await conn.execute(
                f"UPDATE {fq_table('memory_application_bodies')} SET descriptor=$2 WHERE body_id=$1",
                bodies.source.body_id,
                b" " * 2048 + json_bytes(bodies.source),
            )
        else:
            await conn.execute(
                f"UPDATE {fq_table('memory_application_body_parts')} SET data=$2 WHERE body_id=$1 AND part_number=0",
                bodies.source.body_id,
                b"x" * 4096,
            )
        probe = PrefetchConnection(conn, "none")
        reader = _TransitionValidationReader(probe, fq_table, app.bank_id, app.namespace)
        if storage == "metadata":
            # Whitespace is legal but exceeds the optimization budget; do not
            # promote that budget to a new provider data-acceptance limit.
            assert await reader.body_bytes(bodies.source) == bodies.original
            assert probe.raw_metadata_bytes == 0
        else:
            with pytest.raises(ApplicationStateError, match="body_integrity_error"):
                await reader.read_body(bodies.source)
        assert probe.raw_metadata_bytes + probe.raw_part_bytes <= 1024
        assert probe.raw_part_bytes == 0
        reader.close()


from .application_helpers import ApplicationCase, application_case
from .application_originals import install_original_artifacts, source_body
from .current_state_helpers import logical_records
