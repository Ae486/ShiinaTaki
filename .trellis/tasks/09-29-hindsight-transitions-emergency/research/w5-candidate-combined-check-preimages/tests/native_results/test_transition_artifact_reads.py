"""Independent pre-write and post-write artifact views in actual delta apply."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest

from hindsight_api.engine import transition_baseline_reads
from hindsight_api.engine.application_state.models import (
    ApplicationStateError,
    TakiApplicationArtifact,
    TakiApplicationBlockBody,
    TakiApplicationBodyRef,
)
from hindsight_api.engine.application_state.store import ApplicationStateStore
from hindsight_api.engine.db_utils import acquire_with_retry
from hindsight_api.engine.memory_engine import MemoryEngine
from hindsight_api.engine.schema import fq_table
from hindsight_api.engine.transfer import transition_delta_application
from hindsight_api.engine.transfer.current_state_schema import current_state_hash
from hindsight_api.engine.transfer.transition_delta_models import TakiTransitionDeltaRequest, TransitionBlockInput
from hindsight_api.engine.transition_baseline_reads import _TransitionValidationReader as ValidationReader
from hindsight_api.models import RequestContext

from .application_helpers import read_body_bytes
from .current_state_helpers import logical_records
from .maintenance_helpers import maintenance_schema as maintenance_schema
from .test_transition_delta import memory_update
from .transition_delta_helpers import DeltaCase, delta_case, signed_delta


@dataclass(frozen=True)
class BlockUpdate:
    request: TakiTransitionDeltaRequest
    content: str


async def block_update(case: DeltaCase) -> BlockUpdate:
    request = case.request.model_copy(deep=True)
    descriptor = next(row for row in request.application if row.key.artifact_kind == "block")
    async with acquire_with_retry(case.app.memory._backend) as conn:
        store = ApplicationStateStore(conn, fq_table, case.app.bank_id, case.app.namespace)
        old = await store.artifact(descriptor.key)
        assert old is not None
        body = await store.read_body(old.body_ref)
        assert isinstance(body, TakiApplicationBlockBody)
    changed = body.model_copy(
        update={
            "content": "New written state requires a new validation view",
            "block_revision": body.block_revision + 1,
        }
    )
    descriptor.disposition = "upsert"
    descriptor.body = TransitionBlockInput(body=changed)
    descriptor.source_record_hash = current_state_hash(changed.model_dump(mode="json"))
    return BlockUpdate(signed_delta(case, request), changed.content)


def collect_readers(monkeypatch: pytest.MonkeyPatch) -> list[ValidationReader]:
    readers: list[ValidationReader] = []
    initialize = ValidationReader.__init__

    def remember(reader: ValidationReader, *args: Any, **kwargs: Any) -> None:
        assert all(previous._closed for previous in readers), "validation views must never overlap"
        initialize(reader, *args, **kwargs)
        readers.append(reader)

    monkeypatch.setattr(ValidationReader, "__init__", remember)
    return readers


def assert_disposed(readers: list[ValidationReader]) -> None:
    assert all(
        reader._closed
        and not reader._verified
        and not reader._metadata
        and not reader._parts
        and not reader._active
        and not reader._pending
        and reader._verified_bytes == 0
        for reader in readers
    )


@pytest.mark.asyncio
async def test_actual_apply_uses_five_separately_disposed_validation_readers(
    memory: MemoryEngine, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch, maintenance_schema: str
) -> None:
    case = await delta_case(memory, request_context, monkeypatch)
    readers = collect_readers(monkeypatch)
    result = await case.service.apply(case.app.bank_id, case.request)
    assert result.request_hash == case.request.request_hash
    assert len(readers) == 5, "two baselines, two predecessors and one final written-state view"
    assert_disposed(readers)
    assert await case.service.lookup(case.app.bank_id, case.request.executor.transition_id) == result


@pytest.mark.asyncio
async def test_final_bank_first_view_continues_prefetch_after_reenumerating_cached_bank(
    memory: MemoryEngine, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch, maintenance_schema: str
) -> None:
    case = await delta_case(memory, request_context, monkeypatch)
    update = await block_update(case)
    readers = collect_readers(monkeypatch)
    # Exercise several real batches with the ordinary fixture's complete
    # artifact set. Byte/part/cache budgets and every validator stay enabled.
    monkeypatch.setattr(transition_baseline_reads, "_BATCH_BODIES", 2)
    prefetch = ValidationReader._prefetch
    metadata = ApplicationStateStore._load_body_metadata
    read = ValidationReader.read_body
    final_batches: list[Any] = []
    final_fallbacks: list[Any] = []
    final_schemas: list[str] = []

    def final(store: ApplicationStateStore) -> bool:
        return len(readers) == 5 and store is readers[-1]

    async def counted_prefetch(reader: ValidationReader, body_id: Any) -> None:
        if final(reader):
            final_batches.append(body_id)
        await prefetch(reader, body_id)

    async def counted_metadata(store: ApplicationStateStore, body_id: Any, **kwargs: Any) -> Any:
        if final(store):
            final_fallbacks.append(body_id)
        return await metadata(store, body_id, **kwargs)

    async def counted_read(reader: ValidationReader, descriptor: TakiApplicationBodyRef) -> Any:
        if final(reader):
            final_schemas.append(descriptor.body_schema)
        return await read(reader, descriptor)

    monkeypatch.setattr(ValidationReader, "_prefetch", counted_prefetch)
    monkeypatch.setattr(ApplicationStateStore, "_load_body_metadata", counted_metadata)
    monkeypatch.setattr(ValidationReader, "read_body", counted_read)
    result = await case.service.apply(case.app.bank_id, update.request)
    assert result.request_hash == update.request.request_hash
    assert final_schemas[:2] == ["application-bank.v1", "application-bank.v1"]
    assert len(final_schemas) > 3, "the Bank-first pass must exceed one non-Bank batch"
    assert not final_fallbacks, "a cached Bank must not strand raw rows and force later ordinary reads"
    assert len(final_batches) >= 3
    assert len(readers) == 5
    assert_disposed(readers)


@pytest.mark.asyncio
@pytest.mark.parametrize("tiny_budget", [False, True])
async def test_final_view_reads_written_body_while_commands_and_publication_use_ordinary_store(
    memory: MemoryEngine,
    request_context: RequestContext,
    monkeypatch: pytest.MonkeyPatch,
    maintenance_schema: str,
    tiny_budget: bool,
) -> None:
    case = await delta_case(memory, request_context, monkeypatch)
    update = await block_update(case)
    readers = collect_readers(monkeypatch)
    if tiny_budget:
        monkeypatch.setattr(transition_baseline_reads, "_BATCH_BYTES", 1)
        monkeypatch.setattr(transition_baseline_reads, "_CACHE_BYTES", 0)
    read = ValidationReader.read_body
    body_and_command = transition_delta_application._body_and_command
    publish = transition_delta_application.publish_event
    final_contents: list[str] = []
    ordinary_calls: list[str] = []

    async def observed_read(reader: ValidationReader, descriptor: TakiApplicationBodyRef) -> Any:
        body = await read(reader, descriptor)
        if len(readers) == 5 and reader is readers[-1] and isinstance(body, TakiApplicationBlockBody):
            final_contents.append(body.content)
        return body

    async def ordinary_command(store: ApplicationStateStore, *args: Any, **kwargs: Any) -> Any:
        assert type(store) is ApplicationStateStore
        assert_disposed(readers)
        ordinary_calls.append("command")
        return await body_and_command(store, *args, **kwargs)

    async def ordinary_publish(store: ApplicationStateStore, *args: Any, **kwargs: Any) -> Any:
        assert type(store) is ApplicationStateStore
        assert len(readers) == 5
        assert_disposed(readers)
        ordinary_calls.append("publication")
        return await publish(store, *args, **kwargs)

    monkeypatch.setattr(ValidationReader, "read_body", observed_read)
    monkeypatch.setattr(transition_delta_application, "_body_and_command", ordinary_command)
    monkeypatch.setattr(transition_delta_application, "publish_event", ordinary_publish)
    result = await case.service.apply(case.app.bank_id, update.request)
    assert final_contents == [update.content]
    assert ordinary_calls == ["command", "publication"]
    assert_disposed(readers)
    assert await read_body_bytes(case.app, case.original.block_ref) == case.original.block_bytes
    monkeypatch.setattr(memory.embeddings, "encode", AsyncMock(side_effect=AssertionError("repeated embedding")))
    assert await case.service.apply(case.app.bank_id, update.request) == result
    assert len(readers) == 5 and ordinary_calls == ["command", "publication"]


@pytest.mark.asyncio
async def test_final_reader_detects_body_corrupted_after_predecessors_and_rolls_back_all_writes(
    memory: MemoryEngine, request_context: RequestContext, monkeypatch: pytest.MonkeyPatch, maintenance_schema: str
) -> None:
    case = await delta_case(memory, request_context, monkeypatch)
    update = await block_update(case)
    readers = collect_readers(monkeypatch)
    save = ApplicationStateStore.save_artifact
    corrupted = False

    async def corrupt_after_write(store: ApplicationStateStore, artifact: TakiApplicationArtifact) -> None:
        nonlocal corrupted
        assert type(store) is ApplicationStateStore
        assert_disposed(readers)
        await save(store, artifact)
        if artifact.key.artifact_kind == "block":
            assert len(readers) == 4
            await store.conn.execute(
                f"UPDATE {store.fq_table('memory_application_body_parts')} SET data=set_byte(data,0,0) WHERE body_id=$1",
                case.original.source_ref.body_id,
            )
            corrupted = True

    monkeypatch.setattr(ApplicationStateStore, "save_artifact", corrupt_after_write)
    with pytest.raises(ApplicationStateError, match="body_integrity_error"):
        await case.service.apply(case.app.bank_id, update.request)
    assert corrupted and len(readers) == 5
    assert_disposed(readers)
    assert await logical_records(memory, case.app.bank_id) == case.records
    assert await read_body_bytes(case.app, case.original.source_ref) == case.original.source_bytes
    async with acquire_with_retry(memory._backend) as conn:
        store = ApplicationStateStore(conn, fq_table, case.app.bank_id, case.app.namespace)
        assert await store.artifacts(history=False) == case.artifacts
    assert await case.service.lookup(case.app.bank_id, case.request.executor.transition_id) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("ordinal", [2, 4, 5])
@pytest.mark.parametrize("cancel", [False, True])
async def test_each_artifact_reader_disposes_on_failure_and_cancellation_without_committing_effects(
    memory: MemoryEngine,
    request_context: RequestContext,
    monkeypatch: pytest.MonkeyPatch,
    maintenance_schema: str,
    ordinal: int,
    cancel: bool,
) -> None:
    case = await delta_case(memory, request_context, monkeypatch)
    request = case.request.model_copy(deep=True)
    await memory_update(case, request)
    request = signed_delta(case, request)
    readers = collect_readers(monkeypatch)
    read = ValidationReader.read_body

    async def fail_after_read(reader: ValidationReader, descriptor: TakiApplicationBodyRef) -> Any:
        body = await read(reader, descriptor)
        if len(readers) == ordinal:
            if cancel:
                raise asyncio.CancelledError()
            raise ApplicationStateError("body_integrity_error", 503)
        return body

    monkeypatch.setattr(ValidationReader, "read_body", fail_after_read)
    with pytest.raises(asyncio.CancelledError if cancel else ApplicationStateError):
        await case.service.apply(case.app.bank_id, request)
    assert len(readers) == ordinal
    assert_disposed(readers)
    assert await logical_records(memory, case.app.bank_id) == case.records
    assert await case.service.lookup(case.app.bank_id, request.executor.transition_id) is None
