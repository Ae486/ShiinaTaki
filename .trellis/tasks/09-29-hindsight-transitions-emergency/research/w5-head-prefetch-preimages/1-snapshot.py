"""Independent coherent application snapshots, hydration and complete-event replay."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from ..replication import MemoryUnitLogicalPayload
from .codec import digest, json_bytes, native_payload_hash, without_hash
from .commits import current_native
from .models import (
    APPLICATION_RESPONSE_BYTES,
    ApplicationStateError,
    TakiApplicationArtifactDescriptor,
    TakiApplicationArtifactVersion,
    TakiApplicationCheckpoint,
    TakiApplicationHydrateRequest,
    TakiApplicationMemoryBody,
    TakiApplicationNativeDescriptor,
    TakiApplicationNativeHead,
    TakiApplicationNativeRecord,
    TakiApplicationNativeSourceEvidence,
    TakiApplicationNativeVersion,
    TakiApplicationReadBundleManifest,
    TakiApplicationRecordDescriptor,
    TakiApplicationRecordPage,
    TakiApplicationSelectorResult,
    TakiApplicationSnapshotRequest,
    TakiApplicationStateChangeManifest,
    TakiApplicationStateChangePage,
)
from .publication import capture_payload, load_native_source_evidence, load_pages, materialize_pages
from .store import ApplicationStateStore, artifact_version, decode_refs, parse_model

if TYPE_CHECKING:
    from ..logical_snapshot import LogicalSnapshotRecord, _SnapshotSource


@dataclass
class _LockedNativeView:
    heads: list[TakiApplicationNativeHead]
    records: dict[tuple[str, str], LogicalSnapshotRecord]


async def _locked_native_view(store: ApplicationStateStore, source: _SnapshotSource) -> _LockedNativeView:
    # Only the locked, write-free baseline segment supplies this source. Read
    # the SQL keys with the same head serializer/order as store.heads(): a
    # malformed envelope must not impersonate another indexed row when its
    # ordinary point lookup is omitted. Ambiguous keys keep the original path.
    rows = await store.conn.fetch(
        f"SELECT object_kind,object_id,head FROM {store.fq_table('memory_application_native_heads')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 ORDER BY object_kind,object_id",
        *store.keys,
    )
    heads = [parse_model(TakiApplicationNativeHead, row["head"]) for row in rows]
    unsafe: set[tuple[str, str]] = set()
    seen: set[tuple[str, str]] = set()
    for row, head in zip(rows, heads, strict=True):
        key = (head.object_kind, head.object_id)
        if key in seen or key != (row["object_kind"], row["object_id"]):
            unsafe.add(key)
        seen.add(key)
    records: dict[tuple[str, str], LogicalSnapshotRecord] = {}
    for record in source.records:
        key = (record.object_kind, record.object_id)
        if key in records:
            unsafe.add(key)
        else:
            records[key] = record
        # Archive entities use SQL ANY (deduplication) and database collation
        # in point reads; bulk Python serialization is not equivalent there.
        if isinstance(record.payload, MemoryUnitLogicalPayload) and record.payload.state == "invalidated":
            unsafe.add(key)
    for key in unsafe:
        records.pop(key, None)
    return _LockedNativeView(heads, records)


async def initialize_capture(store: ApplicationStateStore) -> None:
    native = await store.require_live(lock=True)
    existing = await store.state(optional=True, lock=True)
    if existing is not None:
        if existing.checkpoint.native_cursor != native.current_cursor:
            raise ApplicationStateError("capture_gap", 503)
        await store.conn.execute(
            f"UPDATE {store.fq_table('replication_bank_state')} SET application_capture_required=true WHERE bank_id=$1",
            store.bank_id,
        )
        return
    # Reuse the neutral source loader only. A D77 baseline is not a cutover
    # candidate and must never manufacture D78's retained snapshot binding.
    from ..logical_snapshot import _load_snapshot_source

    source = await _load_snapshot_source(conn=store.conn, fq_table=store.fq_table, bank_id=store.bank_id)
    await store.initialize_row(source.state.current_cursor)
    for record in source.records:
        cursor = await store.conn.fetchval(
            f"SELECT cursor FROM {store.fq_table('replication_logical_changes')} "
            "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND object_kind=$4 AND object_id=$5 "
            "ORDER BY cursor DESC LIMIT 1",
            *store.keys,
            record.object_kind,
            record.object_id,
        )
        version = TakiApplicationNativeVersion(
            object_kind=record.object_kind,
            object_id=record.object_id,
            object_revision=record.object_revision,
            payload_hash=native_payload_hash(record.payload),
            native_cursor=cursor,
        )
        await capture_payload(store, payload=record.payload, version=version, baseline=True)
    await store.conn.execute(
        f"UPDATE {store.fq_table('replication_bank_state')} SET application_capture_required=true "
        "WHERE bank_id=$1 AND provider_lineage=$2 AND bank_generation=$3",
        store.bank_id,
        store.namespace.provider_lineage,
        store.namespace.bank_generation,
    )


async def coherent_checkpoint(store: ApplicationStateStore) -> TakiApplicationCheckpoint:
    native = await store.require_live()
    active = await store.conn.fetchval(
        f"SELECT application_capture_required FROM {store.fq_table('replication_bank_state')} WHERE bank_id=$1",
        store.bank_id,
    )
    if not active:
        raise ApplicationStateError("capture_required")
    state = await store.require_state()
    if state.checkpoint.native_cursor != native.current_cursor:
        raise ApplicationStateError("capture_gap", 503)
    return state.checkpoint


async def _bundle_records(
    store: ApplicationStateStore,
    request: TakiApplicationSnapshotRequest | TakiApplicationHydrateRequest,
    *,
    _locked_source: _SnapshotSource | None = None,
) -> list[TakiApplicationRecordDescriptor]:
    if not isinstance(request, TakiApplicationHydrateRequest):
        from ..logical_snapshot import _load_snapshot_source

        view = await _locked_native_view(store, _locked_source) if _locked_source is not None else None
        heads = view.heads if view is not None else await store.heads()
        artifacts = await store.artifacts()
        source = _locked_source
        if source is None:
            source = await _load_snapshot_source(conn=store.conn, fq_table=store.fq_table, bank_id=store.bank_id)
        native_keys = {(record.object_kind, record.object_id) for record in source.records}
        head_keys = {(head.object_kind, head.object_id) for head in heads if head.version is not None}
        if native_keys != head_keys:
            raise ApplicationStateError("capture_gap", 503)
        for head in heads:
            record = view.records.get((head.object_kind, head.object_id)) if view is not None else None
            await _validate_head(store, head, _locked_record=record)
        for artifact in artifacts:
            await store.read_body(artifact.body_ref)
        return [
            *[TakiApplicationNativeDescriptor(head=head) for head in heads],
            *[TakiApplicationArtifactDescriptor(artifact=artifact) for artifact in artifacts],
        ]
    records: list[TakiApplicationRecordDescriptor] = []
    needed: list[TakiApplicationArtifactVersion] = []
    for selector in request.selectors:
        head = await store.head(selector.object_kind, selector.object_id)
        if head is not None:
            await _validate_head(store, head)
        if head is None or head.version is None or head.binding_state == "tombstoned":
            status = "gone"
        elif selector.expected_version is not None and selector.expected_version != head.version:
            status = "stale"
        else:
            status = head.binding_state
        records.append(TakiApplicationSelectorResult(selector=selector, status=status))
        if head is not None:
            records.append(TakiApplicationNativeDescriptor(head=head))
            if head.bound_artifact is not None:
                needed.append(head.bound_artifact)
    seen: set[tuple[str, str, int]] = set()
    # Bank scope is required to validate any selected association, including
    # an authenticated absence used to produce the first neutral policy.
    needed.extend(artifact_version(artifact) for artifact in await store.artifacts(kind="bank"))
    for key in request.artifact_keys:
        needed.extend(artifact_version(artifact) for artifact in await store.artifacts(key=key))
    while needed:
        version = needed.pop()
        key = (version.key.artifact_kind, version.key.artifact_id, version.revision)
        if key in seen:
            continue
        artifact = await store.artifact(version.key, version.revision)
        if artifact is None or artifact_version(artifact) != version:
            raise ApplicationStateError("application_state_corrupt", 503)
        seen.add(key)
        records.append(TakiApplicationArtifactDescriptor(artifact=artifact))
        body = await store.read_body(artifact.body_ref)
        if isinstance(body, TakiApplicationMemoryBody):
            needed.extend(body.source_artifacts)
        # Association history carries the immutable original body even after
        # rebinding to a newer native version. Include every prior envelope.
        needed.extend(
            artifact_version(item)
            for item in await store.artifacts(key=artifact.key)
            if item.key == artifact.key and item.revision < artifact.revision
        )
    return records


async def _validate_head(
    store: ApplicationStateStore,
    head: TakiApplicationNativeHead,
    *,
    _locked_record: LogicalSnapshotRecord | None = None,
) -> None:
    if head.version is None:
        return
    if head.body_ref is None:
        raise ApplicationStateError("application_state_corrupt", 503)
    if _locked_record is None:
        await current_native(store, head.version)
    elif head.tombstone is not None or native_payload_hash(_locked_record.payload) != head.version.payload_hash:
        # Match current_native's canonical SQL-payload proof. Model equality
        # would incorrectly equate nested JSON booleans and numbers. The head
        # was freshly parsed from its exact indexed row in this locked view.
        raise ApplicationStateError("native_version_conflict", 412)
    record = await store.read_body(head.body_ref)
    if (
        not isinstance(record, TakiApplicationNativeRecord)
        or record.version != head.version
        or native_payload_hash(record.payload) != head.version.payload_hash
        or record.payload.bank_id != store.bank_id
    ):
        raise ApplicationStateError("application_state_corrupt", 503)
    if head.object_kind == "document":
        if record.source_evidence_ref is None:
            raise ApplicationStateError("application_state_corrupt", 503)
        evidence = await store.read_body(record.source_evidence_ref)
        current = await load_native_source_evidence(store, head.version)
        if not isinstance(evidence, TakiApplicationNativeSourceEvidence) or evidence != current:
            raise ApplicationStateError("capture_gap", 503)


async def _check_manifest(store: ApplicationStateStore, manifest: TakiApplicationReadBundleManifest) -> None:
    if manifest.namespace != store.namespace or manifest.bank_id != store.bank_id:
        raise ApplicationStateError("application_state_corrupt", 503)
    if manifest.manifest_hash != digest(
        "snapshot", store.namespace, store.bank_id, without_hash(manifest, "manifest_hash")
    ):
        raise ApplicationStateError("application_state_corrupt", 503)
    if datetime.fromisoformat(manifest.expires_at) <= datetime.now(timezone.utc):
        # A final transition proof pins its exact paired snapshot indefinitely.
        # Older D77 installations have no transition table and keep their
        # existing TTL behavior; ordinary snapshots receive no extension.
        table = store.fq_table("memory_transition_requests")
        exists = await store.conn.fetchval("SELECT to_regclass($1) IS NOT NULL", table)
        retained = exists and await store.conn.fetchval(
            f"SELECT EXISTS(SELECT 1 FROM {table} WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 "
            "AND proof->'application_snapshot'->>'snapshot_id'=$4 AND proof->'application_snapshot'->>'manifest_hash'=$5)",
            *store.keys,
            str(manifest.snapshot_id),
            manifest.manifest_hash,
        )
        if not retained:
            raise ApplicationStateError("snapshot_expired", 410)


async def create_bundle(
    store: ApplicationStateStore,
    request: TakiApplicationSnapshotRequest | TakiApplicationHydrateRequest,
) -> TakiApplicationReadBundleManifest:
    request_hash = digest("snapshot-request", store.namespace, store.bank_id, request)
    existing = await store.conn.fetchrow(
        f"SELECT request_hash,manifest FROM {store.fq_table('memory_application_snapshots')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND request_id=$4",
        *store.keys,
        request.request_id,
    )
    if existing is not None:
        if existing["request_hash"] != request_hash:
            raise ApplicationStateError("request_id_conflict")
        manifest = parse_model(TakiApplicationReadBundleManifest, existing["manifest"])
        await _check_manifest(store, manifest)
        return manifest
    checkpoint = await coherent_checkpoint(store)
    records = await _bundle_records(store, request)
    pages = await materialize_pages(store, records)
    created = datetime.now(timezone.utc)
    manifest = TakiApplicationReadBundleManifest(
        snapshot_id=uuid.uuid4(),
        request_id=request.request_id,
        namespace=store.namespace,
        bank_id=store.bank_id,
        kind="hydrate" if isinstance(request, TakiApplicationHydrateRequest) else "snapshot",
        checkpoint=checkpoint,
        total_records=len(records),
        total_pages=len(pages.pages),
        pages_hash=pages.pages_hash,
        manifest_hash="0" * 64,
        created_at=created.isoformat(),
        expires_at=(created + timedelta(seconds=request.ttl_seconds)).isoformat(),
    )
    manifest = manifest.model_copy(
        update={
            "manifest_hash": digest("snapshot", store.namespace, store.bank_id, without_hash(manifest, "manifest_hash"))
        }
    )
    await store.conn.execute(
        f"INSERT INTO {store.fq_table('memory_application_snapshots')} "
        "(provider_lineage,bank_id,bank_generation,snapshot_id,request_id,request_hash,manifest,page_refs,expires_at) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        *store.keys,
        manifest.snapshot_id,
        request.request_id,
        request_hash,
        json_bytes(manifest),
        json_bytes(pages.bodies),
        datetime.fromisoformat(manifest.expires_at),
    )
    return manifest


async def get_bundle(store: ApplicationStateStore, snapshot_id: uuid.UUID) -> TakiApplicationReadBundleManifest:
    data = await store.conn.fetchval(
        f"SELECT manifest FROM {store.fq_table('memory_application_snapshots')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND snapshot_id=$4",
        *store.keys,
        snapshot_id,
    )
    if data is None:
        raise ApplicationStateError("snapshot_not_found", 404)
    manifest = parse_model(TakiApplicationReadBundleManifest, data)
    await _check_manifest(store, manifest)
    return manifest


async def get_bundle_page(
    store: ApplicationStateStore, snapshot_id: uuid.UUID, page_number: int
) -> TakiApplicationRecordPage:
    manifest = await get_bundle(store, snapshot_id)
    data = await store.conn.fetchval(
        f"SELECT page_refs FROM {store.fq_table('memory_application_snapshots')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND snapshot_id=$4",
        *store.keys,
        snapshot_id,
    )
    if data is None or not 0 <= page_number < manifest.total_pages:
        raise ApplicationStateError("page_not_found", 404)
    refs = decode_refs(data)
    page = await store.read_body(refs[page_number])
    if not isinstance(page, TakiApplicationRecordPage) or page.page_number != page_number:
        raise ApplicationStateError("application_state_corrupt", 503)
    if page.page_hash != digest("page", store.namespace, store.bank_id, without_hash(page, "page_hash")):
        raise ApplicationStateError("application_state_corrupt", 503)
    return page


async def changes(store: ApplicationStateStore, after: int, limit: int) -> TakiApplicationStateChangePage:
    if after < 0 or not 1 <= limit <= 128:
        raise ApplicationStateError("invalid_request", 422)
    state = await store.require_state()
    if after < state.minimum_state_cursor or after > state.checkpoint.state_cursor:
        raise ApplicationStateError(
            "state_reset_required", 409, checkpoint=state.checkpoint, minimum_state_cursor=state.minimum_state_cursor
        )
    rows = await store.conn.fetch(
        f"SELECT manifest FROM {store.fq_table('memory_application_changes')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND state_cursor>$4 "
        "ORDER BY state_cursor LIMIT $5",
        *store.keys,
        after,
        limit,
    )
    manifests: list[TakiApplicationStateChangeManifest] = []
    size = 2048
    for row in rows:
        manifest = parse_model(TakiApplicationStateChangeManifest, row["manifest"])
        if manifest.event_hash != digest("event", store.namespace, store.bank_id, without_hash(manifest, "event_hash")):
            raise ApplicationStateError("application_state_corrupt", 503)
        if manifest.state_cursor != after + len(manifests) + 1:
            raise ApplicationStateError("capture_gap", 503)
        next_size = size + len(json_bytes(manifest)) + 1
        if manifests and next_size > APPLICATION_RESPONSE_BYTES:
            break
        if next_size > APPLICATION_RESPONSE_BYTES:
            raise ApplicationStateError("payload_too_large", 413)
        manifests.append(manifest)
        size = next_size
    if manifests:
        initial = manifests[0].from_checkpoint
        final = manifests[-1].to_checkpoint
    else:
        if after != state.checkpoint.state_cursor:
            raise ApplicationStateError("capture_gap", 503)
        initial = state.checkpoint
        final = state.checkpoint
    return TakiApplicationStateChangePage(
        namespace=store.namespace,
        bank_id=store.bank_id,
        from_checkpoint=initial,
        to_checkpoint=final,
        changes=manifests,
        has_more=final.state_cursor < state.checkpoint.state_cursor,
        minimum_state_cursor=state.minimum_state_cursor,
    )


async def change_page(
    store: ApplicationStateStore, cursor: int, number: int, event_hash: str
) -> TakiApplicationRecordPage:
    state = await store.require_state()
    if cursor <= state.minimum_state_cursor:
        raise ApplicationStateError(
            "state_reset_required", checkpoint=state.checkpoint, minimum_state_cursor=state.minimum_state_cursor
        )
    row = await store.conn.fetchrow(
        f"SELECT manifest,page_refs FROM {store.fq_table('memory_application_changes')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND state_cursor=$4",
        *store.keys,
        cursor,
    )
    if row is None:
        raise ApplicationStateError("page_not_found", 404)
    manifest = parse_model(TakiApplicationStateChangeManifest, row["manifest"])
    if manifest.event_hash != event_hash:
        raise ApplicationStateError("body_integrity_error", 409)
    pages = await load_pages(store, row["page_refs"])
    if (
        not 0 <= number < len(pages)
        or digest("pages", store.namespace, store.bank_id, [page.page_hash for page in pages]) != manifest.pages_hash
    ):
        raise ApplicationStateError("page_not_found", 404)
    return pages[number]


async def prune_changes(store: ApplicationStateStore, through: int) -> None:
    await store.require_live(lock=True)
    state = await store.require_state(lock=True)
    if not state.minimum_state_cursor <= through <= state.checkpoint.state_cursor:
        raise ApplicationStateError("invalid_request", 422)
    await store.conn.execute(
        f"DELETE FROM {store.fq_table('memory_application_changes')} "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3 AND state_cursor<=$4",
        *store.keys,
        through,
    )
    await store.conn.execute(
        f"UPDATE {store.fq_table('memory_application_banks')} SET minimum_state_cursor=$4 "
        "WHERE provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3",
        *store.keys,
        through,
    )
