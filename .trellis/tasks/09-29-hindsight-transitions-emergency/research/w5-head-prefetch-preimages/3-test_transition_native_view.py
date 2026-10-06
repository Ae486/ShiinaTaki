"""Locked source borrowing keeps the ordinary native and immutable-body proofs."""

from __future__ import annotations

import copy
import uuid
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock

import pytest

from hindsight_api.engine import logical_snapshot
from hindsight_api.engine.application_state import commits, snapshot
from hindsight_api.engine.application_state.codec import json_bytes, native_payload_hash
from hindsight_api.engine.application_state.models import (
    ApplicationStateError,
    TakiApplicationBodyRef,
    TakiApplicationNamespace,
    TakiApplicationNativeHead,
    TakiApplicationNativeRecord,
    TakiApplicationNativeVersion,
    TakiApplicationSnapshotRequest,
)
from hindsight_api.engine.application_state.store import parse_model
from hindsight_api.engine.logical_snapshot import LogicalSnapshotRecord, _SnapshotSource
from hindsight_api.engine.replication import (
    BankLogicalPayload,
    MemoryUnitLogicalPayload,
    ReplicationBankState,
    TakiDispositionTraits,
)

from .current_state_helpers import unit


@dataclass
class ViewCase:
    store: Any
    source: _SnapshotSource
    request: TakiApplicationSnapshotRequest
    head: TakiApplicationNativeHead
    body: TakiApplicationNativeRecord


@pytest.fixture
def view_case(monkeypatch: pytest.MonkeyPatch) -> ViewCase:
    from types import SimpleNamespace

    namespace = TakiApplicationNamespace(provider_lineage=uuid.uuid4(), bank_generation=uuid.uuid4())
    payload = BankLogicalPayload(
        bank_id="owned",
        name="Bank",
        disposition=TakiDispositionTraits(skepticism=3, literalism=3, empathy=3),
        mission="",
        config={"nested": {"nullable": None, "enabled": True, "count": 1}},
        created_at="2026-10-05T00:00:00+00:00",
        updated_at="2026-10-05T00:00:00+00:00",
    )
    version = TakiApplicationNativeVersion(
        object_kind="bank",
        object_id="owned",
        object_revision=1,
        payload_hash=native_payload_hash(payload),
        native_cursor=1,
    )
    ref = TakiApplicationBodyRef(
        body_id=uuid.uuid4(),
        body_schema="application-native-record.v1",
        total_parts=1,
        total_bytes=1,
        bytes_sha256="a" * 64,
        payload_hash="b" * 64,
    )
    head = TakiApplicationNativeHead(
        object_kind="bank",
        object_id="owned",
        version=version,
        body_ref=ref,
        binding_state="binding_missing",
        cause="baseline",
        tombstone=None,
        bound_artifact=None,
        previous_version=None,
    )
    body = TakiApplicationNativeRecord(version=version, payload=payload.model_copy(deep=True), source_evidence_ref=None)
    source = _SnapshotSource(
        state=ReplicationBankState(
            bank_id="owned",
            provider_lineage=namespace.provider_lineage,
            bank_generation=namespace.bank_generation,
            current_cursor=1,
            minimum_available_cursor=0,
            deleted_at=None,
        ),
        records=[LogicalSnapshotRecord(object_kind="bank", object_id="owned", object_revision=1, payload=payload)],
    )
    store = SimpleNamespace(
        conn=SimpleNamespace(
            fetch=AsyncMock(
                side_effect=lambda *_: [
                    {"object_kind": head.object_kind, "object_id": head.object_id, "head": json_bytes(head)}
                ]
            )
        ),
        fq_table=lambda name: name,
        bank_id="owned",
        namespace=namespace,
        keys=(namespace.provider_lineage, "owned", namespace.bank_generation),
        heads=AsyncMock(side_effect=lambda: [parse_model(TakiApplicationNativeHead, json_bytes(head))]),
        artifacts=AsyncMock(return_value=[]),
        head=AsyncMock(return_value=head),
        read_body=AsyncMock(side_effect=lambda _: copy.deepcopy(body)),
    )
    monkeypatch.setattr(logical_snapshot, "_load_snapshot_source", AsyncMock(return_value=source))
    monkeypatch.setattr(commits, "load_bank_logical_payload", AsyncMock(return_value=payload))
    return ViewCase(
        store, source, TakiApplicationSnapshotRequest(namespace=namespace, request_id=uuid.uuid4()), head, body
    )


@pytest.mark.asyncio
async def test_borrowed_source_removes_reload_and_point_reads_but_keeps_body_validation(view_case: ViewCase) -> None:
    case = view_case
    ordinary = await snapshot._bundle_records(case.store, case.request)
    assert logical_snapshot._load_snapshot_source.await_count == 1
    assert case.store.head.await_count == 1
    assert commits.load_bank_logical_payload.await_count == 1
    optimized = await snapshot._bundle_records(case.store, case.request, _locked_source=case.source)
    assert optimized == ordinary
    assert logical_snapshot._load_snapshot_source.await_count == 1
    assert case.store.head.await_count == 1
    assert commits.load_bank_logical_payload.await_count == 1
    assert case.store.read_body.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fault", ["canonical_boolean", "payload_hash", "body_version", "body_hash", "body_bank", "body_missing"]
)
async def test_borrowed_source_preserves_refusals(view_case: ViewCase, fault: str) -> None:
    case = view_case
    if fault == "canonical_boolean":
        # Python equality considers True == 1. Native canonical hashing must not.
        case.source.records[0].payload.config["nested"]["enabled"] = 1
        assert case.source.records[0].payload == case.body.payload
    elif fault == "payload_hash":
        case.source.records[0].payload.name = "changed without capture"
    elif fault == "body_version":
        case.body.version = case.body.version.model_copy(update={"object_revision": 2})
    elif fault == "body_hash":
        case.body.payload.name = "corrupt immutable body"
    elif fault == "body_bank":
        case.store.bank_id = "another-bank"
    else:
        case.head.body_ref = None
    errors = []
    for source in (None, case.source):
        with pytest.raises(ApplicationStateError) as caught:
            await snapshot._bundle_records(case.store, case.request, **({"_locked_source": source} if source else {}))
        errors.append((caught.value.response.code, caught.value.status_code))
    assert errors[0] == errors[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("fault", ["missing", "extra", "wrong_version", "malformed", "tombstone", "wrong_sql_key"])
async def test_borrowed_source_preserves_inventory_and_head_refusals(view_case: ViewCase, fault: str) -> None:
    case = view_case
    if fault == "missing":
        case.source.records.clear()
    elif fault == "extra":
        other = case.source.records[0].model_copy(deep=True)
        other.object_id = other.payload.bank_id = "extra"
        case.source.records.append(other)
    elif fault == "wrong_version":
        case.head.version = case.head.version.model_copy(update={"native_cursor": 2})
    elif fault == "malformed":
        case.head.object_id = "wrong-envelope-identity"
    elif fault == "tombstone":
        case.head.binding_state = "tombstoned"
    else:
        case.store.conn.fetch = AsyncMock(
            return_value=[{"object_kind": "bank", "object_id": "wrong-sql-key", "head": json_bytes(case.head)}]
        )
        case.store.head.return_value = None
    errors = []
    for optimized in (False, True):
        with pytest.raises(ApplicationStateError) as caught:
            await snapshot._bundle_records(case.store, case.request, _locked_source=case.source if optimized else None)
        errors.append((caught.value.response.code, caught.value.status_code))
    assert errors[0] == errors[1]


@pytest.mark.asyncio
@pytest.mark.parametrize("duplicate", ["native", "head"])
async def test_duplicate_keys_fall_back_instead_of_overriding(view_case: ViewCase, duplicate: str) -> None:
    case = view_case
    if duplicate == "native":
        changed = case.source.records[0].model_copy(deep=True)
        changed.payload.name = "ambiguous duplicate, not a new current payload"
        case.source.records.insert(0, changed)
    else:
        case.store.heads.side_effect = None
        case.store.heads.return_value = [case.head, case.head]
        row = {"object_kind": "bank", "object_id": "owned", "head": json_bytes(case.head)}
        case.store.conn.fetch = AsyncMock(return_value=[row, row])
    ordinary = await snapshot._bundle_records(case.store, case.request)
    count = case.store.head.await_count
    optimized = await snapshot._bundle_records(case.store, case.request, _locked_source=case.source)
    assert optimized == ordinary
    assert case.store.head.await_count == count * 2
    assert commits.load_bank_logical_payload.await_count == count * 2


@pytest.mark.asyncio
async def test_ordinary_snapshot_rereads_after_borrowed_view_returns(view_case: ViewCase) -> None:
    case = view_case
    await snapshot._bundle_records(case.store, case.request, _locked_source=case.source)
    assert case.store.head.await_count == 0
    case.source.records[0].payload.config["nested"]["nullable"] = "changed"
    for optimized in (False, True):
        with pytest.raises(ApplicationStateError, match="native_version_conflict"):
            await snapshot._bundle_records(case.store, case.request, _locked_source=case.source if optimized else None)
    assert case.store.head.await_count == 1
    assert commits.load_bank_logical_payload.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["valid", "invalidated", "invalidated_duplicate_ids"])
async def test_unicode_same_name_entity_order_and_archive_fallback(
    view_case: ViewCase,
    monkeypatch: pytest.MonkeyPatch,
    state: str,
) -> None:
    case = view_case
    fields = unit("memory").model_dump(exclude={"source"})
    fields.update(state="valid" if state == "valid" else "invalidated", entities=["éclair", "张三", "张三"])
    payload = MemoryUnitLogicalPayload(memory_id="memory", bank_id="owned", revision=19, **fields)
    version = case.head.version.model_copy(
        update={
            "object_kind": "memory_unit",
            "object_id": "memory",
            "object_revision": 19,
            "payload_hash": native_payload_hash(payload),
        }
    )
    case.head.object_kind, case.head.object_id, case.head.version = "memory_unit", "memory", version
    case.body.version, case.body.payload = version, payload.model_copy(deep=True)
    if state == "invalidated_duplicate_ids":
        # The real PG test creates duplicate archive IDs. This isolates the
        # point/bulk serializer difference and same-name entity ordering.
        payload.entities = ["张三", "éclair", "张三", "张三"]
    case.source.records[:] = [
        LogicalSnapshotRecord(
            object_kind="memory_unit",
            object_id="memory",
            object_revision=19,
            payload=payload,
        )
    ]
    loader = AsyncMock(return_value=case.body.payload)
    monkeypatch.setattr(commits, "load_memory_unit_logical_payload", loader)
    ordinary = await snapshot._bundle_records(case.store, case.request)
    optimized = await snapshot._bundle_records(case.store, case.request, _locked_source=case.source)
    assert optimized == ordinary
    assert loader.await_count == (1 if state == "valid" else 2)
