"""Independent parser/registration edge cases; complement the complete bundler regression."""

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from hindsight_api.engine.application_state.codec import json_bytes
from hindsight_api.engine.application_state.models import (
    ApplicationStateError,
    TakiApplicationBodyRef,
    TakiApplicationNamespace,
    TakiApplicationNativeHead,
    TakiApplicationNativeTombstone,
    TakiApplicationNativeVersion,
)
from hindsight_api.engine.application_state.snapshot import _locked_native_view
from hindsight_api.engine.application_state.store import ApplicationStateStore
from hindsight_api.engine.transition_baseline_reads import _TransitionValidationReader


def row(index: int, *, gone: bool = False) -> dict[str, Any]:
    version = TakiApplicationNativeVersion(
        object_kind="document",
        object_id=f"doc-{index}",
        object_revision=1,
        payload_hash="a" * 64,
        native_cursor=1,
    )
    descriptor = TakiApplicationBodyRef(
        body_id=uuid.UUID(int=100 + index),
        body_schema="application-native-record.v1",
        total_parts=1,
        total_bytes=1,
        bytes_sha256="b" * 64,
        payload_hash="c" * 64,
    )
    tombstone = (
        TakiApplicationNativeTombstone(
            object_kind=version.object_kind,
            object_id=version.object_id,
            object_revision=2,
            last_payload_hash=version.payload_hash,
            native_cursor=2,
        )
        if gone
        else None
    )
    head = TakiApplicationNativeHead(
        object_kind=version.object_kind,
        object_id=version.object_id,
        version=None if gone else version,
        body_ref=None if gone else descriptor,
        tombstone=tombstone,
        binding_state="tombstoned" if gone else "binding_missing",
        bound_artifact=None,
        previous_version=None,
        cause="native_delete" if gone else "baseline",
    )
    return dict(
        object_kind=head.object_kind, object_id=head.object_id, head=json_bytes(head)
    )


def reader(rows: list[Any]) -> _TransitionValidationReader:
    namespace = TakiApplicationNamespace(
        provider_lineage=uuid.UUID(int=1), bank_generation=uuid.UUID(int=2)
    )
    return _TransitionValidationReader(
        SimpleNamespace(fetch=AsyncMock(return_value=rows)),
        lambda name: name,
        "owned",
        namespace,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("locked", [False, True])
@pytest.mark.parametrize("malformed", [b"{", b"{}"])
async def test_malformed_later_row_preserves_prior_queue_without_partial_registration(
    locked: bool, malformed: bytes
) -> None:
    subject = reader(
        [
            row(1),
            dict(object_kind="document", object_id="broken", head=malformed),
            row(2),
        ]
    )
    try:
        subject._heads_from_rows([row(9)])
        previous = list(subject._pending)
        with pytest.raises(ApplicationStateError, match="application_state_corrupt"):
            if locked:
                await _locked_native_view(subject, SimpleNamespace(records=[]))
            else:
                await subject.heads()
        assert list(subject._pending) == previous == [uuid.UUID(int=109)]
        assert subject.conn.fetch.await_count == 1
        assert not subject._metadata and not subject._parts and not subject._verified
    finally:
        subject.close()
    assert not subject._pending


@pytest.mark.asyncio
@pytest.mark.parametrize("locked", [False, True])
async def test_tombstones_duplicate_refs_and_original_order_use_one_enumeration(
    locked: bool,
) -> None:
    rows = [row(3), row(4, gone=True), row(1), row(3)]
    subject = reader(rows)
    try:
        expected = ApplicationStateStore._heads_from_rows(subject, rows)
        if locked:
            actual = (
                await _locked_native_view(subject, SimpleNamespace(records=[]))
            ).heads
        else:
            actual = await subject.heads()
        assert actual == expected and len(actual) == 4
        assert list(subject._pending) == [uuid.UUID(int=103), uuid.UUID(int=101)]
        assert subject.conn.fetch.await_count == 1
    finally:
        subject.close()
