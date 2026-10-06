"""Complete paired logical/application and auxiliary native source witnesses.

Auxiliary rows retain exact PostgreSQL JSON text, including original content,
metadata, derived payloads and retrieval state. They are evidence, not a second
memory runtime. A used-Bank baseline is re-read from these real producers.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import Field

from .application_state.models import (
    TakiApplicationArtifactDescriptor,
    TakiApplicationNamespace,
    TakiApplicationNativeDescriptor,
    TakiApplicationNativeRecord,
    TakiApplicationSnapshotRequest,
)
from .application_state.snapshot import _bundle_records, coherent_checkpoint
from .application_state.store import ApplicationStateStore
from .logical_snapshot import LogicalSnapshotRecord, _load_snapshot_source
from .transfer.current_state_schema import CurrentStateHash, current_state_bytes, current_state_hash
from .transition_baseline_reads import _TransitionValidationReader
from .transition_models import TakiTransitionFinalProof, TransitionError, TransitionModel

_AUXILIARY_TABLES = (
    "banks",
    "documents",
    "chunks",
    "memory_units",
    "invalidated_memory_units",
    "entities",
    "observation_history",
    "mental_models",
    "mental_model_history",
    "knowledge_pages",
    "directives",
    "graph_maintenance_queue",
    "memory_mutation_receipts",
    "memory_native_operation_receipts",
    "memory_retain_part_receipts",
    "memory_transition_initializations",
)


class TransitionAuxiliaryRecord(TransitionModel):
    table: str
    row_json: str


class TakiTransitionAuxiliaryPage(TransitionModel):
    transition_id: uuid.UUID
    bank_id: str
    proof_hash: CurrentStateHash
    page_number: int = Field(ge=0)
    total_pages: int = Field(ge=1)
    records: list[TransitionAuxiliaryRecord]
    page_hash: CurrentStateHash


@dataclass(frozen=True)
class TransitionBaseline:
    native_records_hash: str
    application_records_hash: str
    auxiliary_records_hash: str
    baseline_hash: str
    auxiliary: list[TransitionAuxiliaryRecord]


async def capture_transition_baseline(
    conn: Any,
    fq_table: Callable[[str], str],
    bank_id: str,
    native_records: list[LogicalSnapshotRecord] | None = None,
    *,
    _reuse_body_bytes: bool = False,
) -> TransitionBaseline:
    await conn.execute("SET LOCAL TIME ZONE 'UTC'")
    source = await _load_snapshot_source(conn=conn, fq_table=fq_table, bank_id=bank_id)
    if native_records is not None and source.records != native_records:
        raise TransitionError("baseline_mismatch")
    namespace = TakiApplicationNamespace(
        provider_lineage=source.state.provider_lineage, bank_generation=source.state.bank_generation
    )
    reader = _TransitionValidationReader(conn, fq_table, bank_id, namespace) if _reuse_body_bytes else None
    store = reader if reader is not None else ApplicationStateStore(conn, fq_table, bank_id, namespace)
    try:
        checkpoint = await coherent_checkpoint(store)
        descriptors = await _bundle_records(
            store, TakiApplicationSnapshotRequest(namespace=namespace, request_id=uuid.uuid4())
        )
        # Verify every retained original body, not just its stored descriptor. This
        # catches private-data corruption that does not advance either cursor.
        for descriptor in descriptors:
            if isinstance(descriptor, TakiApplicationArtifactDescriptor):
                await store.read_body(descriptor.artifact.body_ref)
            elif isinstance(descriptor, TakiApplicationNativeDescriptor) and descriptor.head.body_ref is not None:
                body = await store.read_body(descriptor.head.body_ref)
                if isinstance(body, TakiApplicationNativeRecord) and body.source_evidence_ref is not None:
                    await store.read_body(body.source_evidence_ref)
    finally:
        # No reader capability survives even a failed/cancelled body validation.
        if reader is not None:
            reader.close()
    auxiliary: list[TransitionAuxiliaryRecord] = []
    for table in _AUXILIARY_TABLES:
        rows = await conn.fetch(
            f"SELECT to_jsonb(t)::text AS value FROM {fq_table(table)} t WHERE bank_id=$1 "
            'ORDER BY to_jsonb(t)::text COLLATE "C"',
            bank_id,
        )
        auxiliary.extend(TransitionAuxiliaryRecord(table=table, row_json=row["value"]) for row in rows)
    for table, predicate in (
        ("unit_entities", f"EXISTS(SELECT 1 FROM {fq_table('entities')} e WHERE e.id=t.entity_id AND e.bank_id=$1)"),
        (
            "entity_cooccurrences",
            f"EXISTS(SELECT 1 FROM {fq_table('entities')} e WHERE e.id=t.entity_id_1 AND e.bank_id=$1)",
        ),
        ("memory_links", "t.bank_id=$1"),
    ):
        rows = await conn.fetch(
            f"SELECT to_jsonb(t)::text AS value FROM {fq_table(table)} t WHERE {predicate} "
            'ORDER BY to_jsonb(t)::text COLLATE "C"',
            bank_id,
        )
        auxiliary.extend(TransitionAuxiliaryRecord(table=table, row_json=row["value"]) for row in rows)
    native_hash = current_state_hash([record.model_dump(mode="json") for record in source.records])
    application_hash = current_state_hash([record.model_dump(mode="json") for record in descriptors])
    auxiliary_hash = current_state_hash([record.model_dump(mode="json") for record in auxiliary])
    baseline_hash = current_state_hash(
        {
            "domain": "transition-baseline.v1",
            "bank_id": bank_id,
            "provider_lineage": str(source.state.provider_lineage),
            "bank_generation": str(source.state.bank_generation),
            "native_cursor": source.state.current_cursor,
            "application_checkpoint": checkpoint.model_dump(mode="json"),
            "native_records_hash": native_hash,
            "application_records_hash": application_hash,
            "auxiliary_records_hash": auxiliary_hash,
        }
    )
    return TransitionBaseline(native_hash, application_hash, auxiliary_hash, baseline_hash, auxiliary)


async def assert_transition_baseline(
    conn: Any,
    fq_table: Callable[[str], str],
    bank_id: str,
    proof: TakiTransitionFinalProof,
    *,
    _reuse_body_bytes: bool = False,
) -> None:
    baseline = await capture_transition_baseline(conn, fq_table, bank_id, _reuse_body_bytes=_reuse_body_bytes)
    if baseline.baseline_hash != proof.baseline_hash:
        raise TransitionError("baseline_mismatch")


def auxiliary_pages(records: list[TransitionAuxiliaryRecord]) -> list[list[TransitionAuxiliaryRecord]]:
    pages: list[list[TransitionAuxiliaryRecord]] = [[]]
    size = 0
    for record in records:
        length = len(current_state_bytes(record.model_dump(mode="json")))
        if length > 16 * 1024 * 1024:
            raise TransitionError("unsupported_storage", 503)
        if pages[-1] and (len(pages[-1]) >= 128 or size + length > 16 * 1024 * 1024):
            pages.append([])
            size = 0
        pages[-1].append(record)
        size += length
    return pages
