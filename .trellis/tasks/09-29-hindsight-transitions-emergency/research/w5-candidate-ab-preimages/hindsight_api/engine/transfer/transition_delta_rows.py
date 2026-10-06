"""Identity-preserving native delta using the existing row/index primitives."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

from ..logical_snapshot import _load_snapshot_source
from ..memories import get_memories
from ..replication import (
    LOGICAL_OBJECT_KIND_ORDER,
    PendingLogicalChange,
    append_logical_changes,
    build_authoritative_bank_upsert,
    build_authoritative_directive_upsert,
    build_authoritative_document_upsert,
    build_authoritative_memory_upsert,
    build_authoritative_mental_model_upsert,
)
from ..transition_models import TransitionError
from .current_state_rows import PreparedCurrentStateRows, _time, _write_documents, _write_resources, _write_units
from .current_state_schema import CurrentStateTargetWitness, current_state_hash
from .transition_delta_models import TakiTransitionDeltaRequest, TransitionDeltaMapping
from .transition_delta_preflight import TransitionDeltaPlan


async def preserve_transition_units(
    *,
    conn: Any,
    fq_table: Callable[[str], str],
    bank_id: str,
    temporary_ids: list[str],
    target_ids: list[str],
    revisions: list[int],
) -> None:
    """Copy changed logical/index fields while keeping native-only target fields.

    Existing live rows are updated in place. Archived rows use the native restore
    primitive before their final requested lifecycle is applied. In particular,
    causal edges and historical curation payloads are not lost to delete/reinsert.
    """
    columns = (
        "text",
        "embedding",
        "event_date",
        "occurred_start",
        "occurred_end",
        "mentioned_at",
        "context",
        "fact_type",
        "metadata",
        "chunk_id",
        "document_id",
        "tags",
        "observation_scopes",
        "text_signals",
        "search_vector",
    )
    assignments = ",".join(f"{column}=prepared.{column}" for column in columns)
    for temporary, target, revision in zip(temporary_ids, target_ids, revisions, strict=True):
        exists = await conn.fetchval(
            f"SELECT 1 FROM {fq_table('memory_units')} WHERE bank_id=$1 AND id=$2::uuid", bank_id, target
        )
        if not exists and revision > 1:
            restored = await get_memories().restore_memory(
                conn=conn, fq_table=fq_table, bank_id=bank_id, unit_id=target
            )
            if restored is None:
                raise TransitionError("baseline_mismatch")
            exists = True
        if exists:
            await conn.execute(
                f"UPDATE {fq_table('memory_units')} target SET {assignments},revision=$4 "
                f"FROM {fq_table('memory_units')} prepared WHERE target.bank_id=$1 AND target.id=$2::uuid "
                "AND prepared.bank_id=$1 AND prepared.id=$3::uuid",
                bank_id,
                target,
                temporary,
                revision,
            )
            await conn.execute(
                f"DELETE FROM {fq_table('memory_units')} WHERE bank_id=$1 AND id=$2::uuid", bank_id, temporary
            )
            await conn.execute(f"DELETE FROM {fq_table('unit_entities')} WHERE unit_id=$1::uuid", target)
            await conn.execute(
                f"DELETE FROM {fq_table('memory_links')} WHERE bank_id=$1 "
                "AND (from_unit_id=$2::uuid OR to_unit_id=$2::uuid) AND link_type IN ('temporal','semantic')",
                bank_id,
                target,
            )
        else:
            await conn.execute(
                f"UPDATE {fq_table('memory_units')} SET id=$3::uuid,revision=$4 WHERE bank_id=$1 AND id=$2::uuid",
                bank_id,
                temporary,
                target,
                revision,
            )


async def write_transition_native_delta(
    *,
    conn: Any,
    fq_table: Callable[[str], str],
    bank_id: str,
    request: TakiTransitionDeltaRequest,
    plan: TransitionDeltaPlan,
    prepared: PreparedCurrentStateRows,
    ops: Any,
    entity_resolver: Any,
    config: Any,
) -> list[TransitionDeltaMapping]:
    touched = [
        item.target.object_id
        for item in request.native
        if item.source.source_kind == "memory_unit" and item.target is not None and item.disposition != "reuse"
    ]
    if touched:
        await get_memories().enqueue_relink_victims(
            conn=conn, fq_table=fq_table, bank_id=bank_id, affected_unit_ids=touched, include_affected_units=True
        )
    deleted_memories = [
        uuid.UUID(item.target.object_id)
        for item in request.native
        if item.source.source_kind == "memory_unit" and item.disposition == "delete" and item.target is not None
    ]
    if deleted_memories:
        for table in ("memory_units", "invalidated_memory_units"):
            await conn.execute(
                f"DELETE FROM {fq_table(table)} WHERE bank_id=$1 AND id=ANY($2::uuid[])", bank_id, deleted_memories
            )
    # Changed chunks are handled independently: a document metadata edit does
    # not force its unchanged private chunk bodies to be re-sent or rewritten.
    document_rows = request.rows.model_copy(update={"chunks": []})
    await _write_documents(
        conn=conn,
        fq_table=fq_table,
        bank_id=bank_id,
        request=document_rows,
        ops=ops,
        identities=plan.identities,
        upsert=True,
    )
    chunks = {item.source_chunk_id: item for item in request.chunks}
    if request.rows.chunks:
        await ops.bulk_upsert_chunks(
            conn,
            fq_table("chunks"),
            [plan.chunk_ids[body.source_chunk_id] for body in request.rows.chunks],
            [plan.identities[("document", body.source_document_id)] for body in request.rows.chunks],
            [bank_id] * len(request.rows.chunks),
            [body.chunk_text for body in request.rows.chunks],
            [body.chunk_index for body in request.rows.chunks],
            [chunks[body.source_chunk_id].content_hash for body in request.rows.chunks],
        )
        for body in request.rows.chunks:
            await conn.execute(
                f"UPDATE {fq_table('chunks')} SET document_id=$3 WHERE bank_id=$1 AND chunk_id=$2 "
                "AND document_id IS DISTINCT FROM $3",
                bank_id,
                plan.chunk_ids[body.source_chunk_id],
                plan.identities[("document", body.source_document_id)],
            )
    await _write_units(
        conn=conn,
        fq_table=fq_table,
        bank_id=bank_id,
        request=request.rows,
        prepared=prepared,
        ops=ops,
        entity_resolver=entity_resolver,
        config=config,
        identities=plan.identities,
        chunks=plan.chunk_ids,
        target_revisions=plan.revisions,
    )
    await _write_resources(
        conn=conn,
        fq_table=fq_table,
        bank_id=bank_id,
        request=request.rows,
        prepared=prepared,
        identities=plan.identities,
        upsert=True,
    )
    for item in request.chunks:
        if item.disposition == "delete":
            await conn.execute(
                f"DELETE FROM {fq_table('chunks')} WHERE bank_id=$1 AND chunk_id=$2", bank_id, item.target_chunk_id
            )
    for kind, table in (("document", "documents"), ("mental_model", "mental_models"), ("directive", "directives")):
        for item in request.native:
            if item.source.source_kind == kind and item.disposition == "delete" and item.target is not None:
                cast = "uuid" if kind == "directive" else "text"
                value = uuid.UUID(item.target.object_id) if kind == "directive" else item.target.object_id
                await conn.execute(f"DELETE FROM {fq_table(table)} WHERE bank_id=$1 AND id=$2::{cast}", bank_id, value)
    if request.rows.bank is not None:
        bank = request.rows.bank.payload
        if bank.bank_id != bank_id:
            raise TransitionError("descriptor_mismatch")
        await conn.execute(
            f"UPDATE {fq_table('banks')} SET name=$2,mission=$3,disposition=$4::jsonb,config=$5::jsonb,"
            "created_at=$6,updated_at=$7 WHERE bank_id=$1",
            bank_id,
            bank.name,
            bank.mission,
            bank.disposition.model_dump_json(),
            json.dumps(bank.config),
            _time(bank.created_at),
            _time(bank.updated_at),
        )
    # Validate the entire resulting set before publication. Native inherited
    # payload changes (for example an observation's source-derived entities)
    # must be explicitly represented by the complete Local descriptor closure.
    interim = await _load_snapshot_source(conn=conn, fq_table=fq_table, bank_id=bank_id)
    after = {(row.object_kind, row.object_id): row for row in interim.records}
    expected_keys = {
        (key[0], plan.identities[key]) for key, item in plan.descriptors.items() if item.disposition != "delete"
    }
    if after.keys() != expected_keys:
        raise TransitionError("descriptor_mismatch")
    for key, item in plan.descriptors.items():
        if (
            item.disposition == "reuse"
            and after[(key[0], plan.identities[key])] != plan.before[(key[0], plan.identities[key])]
        ):
            raise TransitionError("descriptor_mismatch")
    builders = {
        "bank": build_authoritative_bank_upsert,
        "document": build_authoritative_document_upsert,
        "memory_unit": build_authoritative_memory_upsert,
        "mental_model": build_authoritative_mental_model_upsert,
        "directive": build_authoritative_directive_upsert,
    }
    names = {
        "document": "document_id",
        "memory_unit": "memory_id",
        "mental_model": "mental_model_id",
        "directive": "directive_id",
    }
    changes: list[PendingLogicalChange] = []
    ordered = sorted(
        plan.descriptors.items(), key=lambda item: (LOGICAL_OBJECT_KIND_ORDER.index(item[0][0]), item[0][1].encode())
    )
    for key, item in ordered:
        if item.disposition == "delete":
            if item.target is None:
                raise TransitionError("descriptor_mismatch")
            changes.append(
                PendingLogicalChange.tombstone(
                    object_kind=key[0],
                    object_id=plan.identities[key],
                    object_revision=item.target.object_revision if key[0] == "memory_unit" else None,
                )
            )
        elif item.disposition == "upsert":
            arguments = {names[key[0]]: plan.identities[key]} if key[0] != "bank" else {}
            changes.append(await builders[key[0]](conn=conn, fq_table=fq_table, bank_id=bank_id, **arguments))
    if changes:
        await append_logical_changes(conn=conn, fq_table=fq_table, bank_id=bank_id, changes=changes)
    final = await _load_snapshot_source(conn=conn, fq_table=fq_table, bank_id=bank_id)
    records = {(row.object_kind, row.object_id): row for row in final.records}
    mappings: list[TransitionDeltaMapping] = []
    for key, item in ordered:
        record = records.get((key[0], plan.identities[key]))
        target = (
            CurrentStateTargetWitness(
                object_kind=key[0],
                object_id=record.object_id,
                object_revision=record.object_revision,
                payload_hash=current_state_hash(record.payload.model_dump(mode="json")),
            )
            if record
            else item.target
        )
        mappings.append(
            TransitionDeltaMapping(
                source=item.source,
                target=target,
                disposition="deleted"
                if item.disposition == "delete"
                else "reused"
                if item.disposition == "reuse"
                else "upserted",
            )
        )
    return mappings
