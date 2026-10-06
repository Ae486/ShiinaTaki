"""PostgreSQL materialized logical snapshots for Taki replica bootstrap.

Creation owns one short ``repeatable_read`` transaction. The Bank cursor state
is read first to establish the MVCC view, every frozen canonical object is then
serialized from that same view, and immutable metadata/pages are inserted
before commit. Page reads never retain a database snapshot transaction and do
not touch the logical journal.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field, model_validator

from .replication import (
    LOGICAL_OBJECT_KIND_ORDER,
    LOGICAL_SNAPSHOT_BASELINE_REVISION,
    BankLogicalPayload,
    DirectiveLogicalPayload,
    DocumentLogicalPayload,
    LogicalObjectKind,
    LogicalPayload,
    MemoryUnitLogicalPayload,
    MentalModelLogicalPayload,
    PendingLogicalChange,
    ReplicationBankState,
    list_directive_logical_payloads,
    list_document_logical_payloads,
    list_memory_unit_logical_payloads,
    list_mental_model_logical_payloads,
    load_bank_logical_payload,
    load_latest_non_memory_object_revisions,
)

LOGICAL_SNAPSHOT_SCHEMA_VERSION = 1
DEFAULT_LOGICAL_SNAPSHOT_PAGE_SIZE = 500
MAX_LOGICAL_SNAPSHOT_PAGE_SIZE = 1000
DEFAULT_LOGICAL_SNAPSHOT_TTL_SECONDS = 3600
MAX_LOGICAL_SNAPSHOT_TTL_SECONDS = 86400


class LogicalSnapshotMemoryUnitCounts(BaseModel):
    """Live/archive counts for the one kind whose lifecycle has two tables."""

    valid: int = Field(ge=0)
    invalidated: int = Field(ge=0)


class LogicalSnapshotCounts(BaseModel):
    """Deterministic counts for every frozen object kind and memory state."""

    bank: int = Field(ge=0)
    document: int = Field(ge=0)
    memory_unit: LogicalSnapshotMemoryUnitCounts
    mental_model: int = Field(ge=0)
    directive: int = Field(ge=0)
    total: int = Field(ge=0)

    @model_validator(mode="after")
    def _validate_total(self) -> "LogicalSnapshotCounts":
        expected = (
            self.bank
            + self.document
            + self.memory_unit.valid
            + self.memory_unit.invalidated
            + self.mental_model
            + self.directive
        )
        if self.total != expected:
            raise ValueError(f"snapshot count total {self.total} does not match composed total {expected}")
        return self


class LogicalSnapshotRecord(BaseModel):
    """Stable revisioned envelope for one current canonical object."""

    object_kind: LogicalObjectKind
    object_id: str
    object_revision: int = Field(ge=1)
    payload: LogicalPayload

    @model_validator(mode="after")
    def _validate_payload_kind(self) -> "LogicalSnapshotRecord":
        expected_type: type[LogicalPayload]
        expected_id: str
        if self.object_kind == "bank":
            expected_type = BankLogicalPayload
            expected_id = self.payload.bank_id if isinstance(self.payload, BankLogicalPayload) else ""
        elif self.object_kind == "document":
            expected_type = DocumentLogicalPayload
            expected_id = self.payload.document_id if isinstance(self.payload, DocumentLogicalPayload) else ""
        elif self.object_kind == "memory_unit":
            expected_type = MemoryUnitLogicalPayload
            expected_id = self.payload.memory_id if isinstance(self.payload, MemoryUnitLogicalPayload) else ""
        elif self.object_kind == "mental_model":
            expected_type = MentalModelLogicalPayload
            expected_id = self.payload.mental_model_id if isinstance(self.payload, MentalModelLogicalPayload) else ""
        else:
            expected_type = DirectiveLogicalPayload
            expected_id = self.payload.directive_id if isinstance(self.payload, DirectiveLogicalPayload) else ""

        if not isinstance(self.payload, expected_type):
            raise ValueError(f"payload does not match object_kind {self.object_kind}")
        if self.object_id != expected_id:
            raise ValueError(f"payload identity does not match object_id {self.object_id}")
        if isinstance(self.payload, MemoryUnitLogicalPayload) and self.object_revision != self.payload.revision:
            raise ValueError("memory snapshot revision must match the canonical payload revision")
        return self


class LogicalSnapshotIntegrity(BaseModel):
    """Reproducible content fields; operational IDs and times are excluded."""

    schema_version: int = Field(ge=1)
    bank_id: str
    provider_lineage: uuid.UUID
    bank_generation: uuid.UUID
    end_cursor: int = Field(ge=0)
    page_size: int = Field(ge=1, le=MAX_LOGICAL_SNAPSHOT_PAGE_SIZE)
    total_pages: int = Field(ge=1)
    total_records: int = Field(ge=1)
    counts: LogicalSnapshotCounts
    page_hashes: list[str]

    @model_validator(mode="after")
    def _validate_composition(self) -> "LogicalSnapshotIntegrity":
        if self.total_records != self.counts.total:
            raise ValueError("snapshot total_records must match composed counts")
        if len(self.page_hashes) != self.total_pages:
            raise ValueError("snapshot page_hashes must contain exactly one hash per page")
        if any(
            len(page_hash) != 64 or any(char not in "0123456789abcdef" for char in page_hash)
            for page_hash in self.page_hashes
        ):
            raise ValueError("snapshot page hashes must be lowercase SHA-256 hex digests")
        return self


class LogicalSnapshotManifest(LogicalSnapshotIntegrity):
    """Integrity fields plus their deterministic aggregate SHA-256 digest."""

    sha256: str = Field(min_length=64, max_length=64)


class LogicalSnapshotMetadata(BaseModel):
    """Operational identity and lifetime surrounding a reproducible manifest."""

    snapshot_id: uuid.UUID
    manifest: LogicalSnapshotManifest
    created_at: datetime
    expires_at: datetime


class LogicalSnapshotPage(BaseModel):
    """One immutable, deterministic, zero-based snapshot page."""

    snapshot_id: uuid.UUID
    page_number: int = Field(ge=0)
    total_pages: int = Field(ge=1)
    record_count: int = Field(ge=1, le=MAX_LOGICAL_SNAPSHOT_PAGE_SIZE)
    content_sha256: str = Field(min_length=64, max_length=64)
    records: list[LogicalSnapshotRecord]

    @model_validator(mode="after")
    def _validate_record_count(self) -> "LogicalSnapshotPage":
        if self.record_count != len(self.records):
            raise ValueError("snapshot page record_count does not match records")
        return self


class LogicalSnapshotCleanupResult(BaseModel):
    """Result of one idempotent expired-snapshot cleanup pass."""

    deleted_snapshots: int = Field(ge=0)


class LogicalSnapshotUnsupportedError(RuntimeError):
    """Raised before database access when the storage contract is unsupported."""


class LogicalSnapshotBankUnavailableError(ValueError):
    """Raised when the captured view has no live canonical Bank."""

    def __init__(self, *, bank_id: str, reason: Literal["missing", "deleted"]) -> None:
        self.bank_id = bank_id
        self.reason = reason
        super().__init__(f"Logical snapshot Bank {bank_id} is {reason}.")


class LogicalSnapshotNotFoundError(ValueError):
    """Raised when a snapshot identity is unknown or has already been cleaned."""


class LogicalSnapshotExpiredError(ValueError):
    """Raised when metadata exists but its page lifetime has elapsed."""


class LogicalSnapshotPageNotFoundError(ValueError):
    """Raised when a page number is outside one materialized snapshot."""


class LogicalSnapshotIntegrityError(RuntimeError):
    """Raised when stored page content no longer matches its committed digest."""


@dataclass(frozen=True)
class _SnapshotSource:
    state: ReplicationBankState
    records: list[LogicalSnapshotRecord]


@dataclass(frozen=True)
class _MaterializedPage:
    page_number: int
    records: list[LogicalSnapshotRecord]
    records_json: str
    content_sha256: str


def _canonical_json_bytes(value: Any) -> bytes:
    """Canonical JSON used by both page and aggregate integrity hashes."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def _capability_is_supported(*, backend: Any, memory_store: Any) -> bool:
    """Read both capability descriptors defensively and fail closed on errors."""
    try:
        ops = getattr(backend, "ops", None)
        supports_replication = bool(getattr(ops, "supports_taki_replication", False))
        owns_sql_rows = bool(getattr(memory_store, "writes_memory_rows_in_sql", False))
    except Exception:
        # Third-party backend/store extensions may expose raising descriptors.
        # A compatibility service must treat that as unsupported rather than
        # letting an ambiguous capability probe reach tenant data.
        return False
    return supports_replication and owns_sql_rows


def _record_from_payload(
    *,
    payload: LogicalPayload,
    latest_non_memory_revisions: dict[tuple[LogicalObjectKind, str], int | None],
) -> LogicalSnapshotRecord:
    pending = PendingLogicalChange.upsert(payload)
    object_key = (pending.object_kind, pending.object_id)
    if isinstance(payload, MemoryUnitLogicalPayload):
        revision = payload.revision
    else:
        latest_revision = latest_non_memory_revisions.get(object_key, LOGICAL_SNAPSHOT_BASELINE_REVISION)
        if latest_revision is None:
            raise RuntimeError(
                f"Canonical object {pending.object_kind}/{pending.object_id} has a latest journal tombstone."
            )
        revision = latest_revision
    return LogicalSnapshotRecord(
        object_kind=pending.object_kind,
        object_id=pending.object_id,
        object_revision=revision,
        payload=payload,
    )


def _snapshot_counts(records: list[LogicalSnapshotRecord]) -> LogicalSnapshotCounts:
    valid_memories = sum(
        1
        for record in records
        if isinstance(record.payload, MemoryUnitLogicalPayload) and record.payload.state == "valid"
    )
    invalidated_memories = sum(
        1
        for record in records
        if isinstance(record.payload, MemoryUnitLogicalPayload) and record.payload.state == "invalidated"
    )
    return LogicalSnapshotCounts(
        bank=sum(record.object_kind == "bank" for record in records),
        document=sum(record.object_kind == "document" for record in records),
        memory_unit=LogicalSnapshotMemoryUnitCounts(
            valid=valid_memories,
            invalidated=invalidated_memories,
        ),
        mental_model=sum(record.object_kind == "mental_model" for record in records),
        directive=sum(record.object_kind == "directive" for record in records),
        total=len(records),
    )


def _materialize_pages(records: list[LogicalSnapshotRecord], page_size: int) -> list[_MaterializedPage]:
    pages: list[_MaterializedPage] = []
    for page_number, offset in enumerate(range(0, len(records), page_size)):
        page_records = records[offset : offset + page_size]
        serialized_records = [record.model_dump(mode="json") for record in page_records]
        records_json = _canonical_json_bytes(serialized_records).decode("utf-8")
        pages.append(
            _MaterializedPage(
                page_number=page_number,
                records=page_records,
                records_json=records_json,
                content_sha256=hashlib.sha256(records_json.encode("utf-8")).hexdigest(),
            )
        )
    return pages


async def _load_snapshot_source(
    *,
    conn: Any,
    fq_table: Callable[[str], str],
    bank_id: str,
) -> _SnapshotSource:
    # This is deliberately the first statement in the repeatable-read
    # transaction. It fixes both end_cursor and all later canonical reads to one
    # MVCC view without blocking authoritative writers on the Bank-state row.
    state_row = await conn.fetchrow(
        f"""
        SELECT bank_id, provider_lineage, bank_generation, current_cursor,
               minimum_available_cursor, deleted_at
        FROM {fq_table("replication_bank_state")}
        WHERE bank_id = $1
        """,
        bank_id,
    )
    if state_row is None:
        raise LogicalSnapshotBankUnavailableError(bank_id=bank_id, reason="missing")
    state = ReplicationBankState(
        bank_id=state_row["bank_id"],
        provider_lineage=state_row["provider_lineage"],
        bank_generation=state_row["bank_generation"],
        current_cursor=state_row["current_cursor"],
        minimum_available_cursor=state_row["minimum_available_cursor"],
        deleted_at=state_row["deleted_at"],
    )
    if state.deleted_at is not None:
        raise LogicalSnapshotBankUnavailableError(bank_id=bank_id, reason="deleted")

    try:
        bank = await load_bank_logical_payload(conn=conn, fq_table=fq_table, bank_id=bank_id)
    except RuntimeError as exc:
        raise LogicalSnapshotBankUnavailableError(bank_id=bank_id, reason="missing") from exc

    documents = await list_document_logical_payloads(conn=conn, fq_table=fq_table, bank_id=bank_id)
    memories = await list_memory_unit_logical_payloads(conn=conn, fq_table=fq_table, bank_id=bank_id)
    mental_models = await list_mental_model_logical_payloads(conn=conn, fq_table=fq_table, bank_id=bank_id)
    directives = await list_directive_logical_payloads(conn=conn, fq_table=fq_table, bank_id=bank_id)
    latest_revisions = await load_latest_non_memory_object_revisions(
        conn=conn,
        fq_table=fq_table,
        bank_id=bank_id,
        bank_generation=state.bank_generation,
    )

    payloads: list[LogicalPayload] = [bank, *documents, *memories, *mental_models, *directives]
    records = [
        _record_from_payload(payload=payload, latest_non_memory_revisions=latest_revisions) for payload in payloads
    ]
    kind_order = {kind: index for index, kind in enumerate(LOGICAL_OBJECT_KIND_ORDER)}
    records.sort(key=lambda record: (kind_order[record.object_kind], record.object_id))
    return _SnapshotSource(state=state, records=records)


class LogicalSnapshotBinding(Protocol):
    """Optional native evidence publication on this exact immutable SQL view."""

    async def lock_source(self, conn: Any) -> None: ...

    async def validate_source(
        self,
        conn: Any,
        state: ReplicationBankState,
        records: list[LogicalSnapshotRecord],
    ) -> None: ...

    async def publish(
        self,
        conn: Any,
        metadata: LogicalSnapshotMetadata,
        records: list[LogicalSnapshotRecord],
    ) -> None: ...


class LogicalSnapshotService:
    """Create, read, and expire PostgreSQL materialized logical snapshots."""

    def __init__(
        self,
        *,
        backend: Any,
        memory_store: Any,
        fq_table: Callable[[str], str],
    ) -> None:
        self._backend = backend
        self._memory_store = memory_store
        self._fq_table = fq_table

    def _require_supported_storage(self) -> None:
        if not _capability_is_supported(backend=self._backend, memory_store=self._memory_store):
            raise LogicalSnapshotUnsupportedError(
                "Taki logical snapshots require PostgreSQL replication with SQL-row-owned memories."
            )

    async def _retention_expression(self, conn: Any, alias: str = "") -> str:
        """Old G1 schemas retain their ordinary TTL behavior without D78's column.

        The migration probe is deliberately local to the read/cleanup view, so
        an unavailable cutover schema cannot break an otherwise supported G1
        snapshot. Never cache schema availability across migrations/restore.
        """
        available = await conn.fetchval(
            "SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) "
            "AND attname='retained_for_cutover' AND attnum>0 AND NOT attisdropped)",
            self._fq_table("replication_logical_snapshots"),
        )
        return f"{alias}retained_for_cutover" if available else "FALSE"

    @staticmethod
    def _validate_bounds(*, page_size: int, ttl_seconds: int) -> None:
        if not 1 <= page_size <= MAX_LOGICAL_SNAPSHOT_PAGE_SIZE:
            raise ValueError(f"page_size must be between 1 and {MAX_LOGICAL_SNAPSHOT_PAGE_SIZE}.")
        if not 1 <= ttl_seconds <= MAX_LOGICAL_SNAPSHOT_TTL_SECONDS:
            raise ValueError(f"ttl_seconds must be between 1 and {MAX_LOGICAL_SNAPSHOT_TTL_SECONDS}.")

    async def create_snapshot(
        self,
        *,
        bank_id: str,
        page_size: int = DEFAULT_LOGICAL_SNAPSHOT_PAGE_SIZE,
        ttl_seconds: int = DEFAULT_LOGICAL_SNAPSHOT_TTL_SECONDS,
        binding: LogicalSnapshotBinding | None = None,
    ) -> LogicalSnapshotMetadata:
        """Materialize one complete immutable snapshot before committing."""
        self._validate_bounds(page_size=page_size, ttl_seconds=ttl_seconds)
        self._require_supported_storage()

        snapshot_id = uuid.uuid4()
        async with self._backend.acquire() as conn:
            async with conn.transaction(isolation="repeatable_read"):
                if binding is not None:
                    # A finite native producer owns the Bank through sealing.
                    # Acquire its writer/fence before fixing the snapshot view,
                    # with the same lock order as every action transaction.
                    await binding.lock_source(conn)
                source = await _load_snapshot_source(
                    conn=conn,
                    fq_table=self._fq_table,
                    bank_id=bank_id,
                )
                if binding is not None:
                    await binding.validate_source(conn, source.state, source.records)
                pages = _materialize_pages(source.records, page_size)
                counts = _snapshot_counts(source.records)
                integrity = LogicalSnapshotIntegrity(
                    schema_version=LOGICAL_SNAPSHOT_SCHEMA_VERSION,
                    bank_id=bank_id,
                    provider_lineage=source.state.provider_lineage,
                    bank_generation=source.state.bank_generation,
                    end_cursor=source.state.current_cursor,
                    page_size=page_size,
                    total_pages=len(pages),
                    total_records=len(source.records),
                    counts=counts,
                    page_hashes=[page.content_sha256 for page in pages],
                )
                manifest_hash = hashlib.sha256(_canonical_json_bytes(integrity.model_dump(mode="json"))).hexdigest()
                manifest = LogicalSnapshotManifest(
                    **integrity.model_dump(),
                    sha256=manifest_hash,
                )

                retention_column = ", retained_for_cutover" if binding is not None else ""
                retention_value = ", true" if binding is not None else ""
                metadata_row = await conn.fetchrow(
                    f"""
                    INSERT INTO {self._fq_table("replication_logical_snapshots")} (
                        snapshot_id, bank_id, provider_lineage, bank_generation,
                        end_cursor, snapshot_schema_version, page_size, total_pages,
                        total_records, counts, page_hashes, manifest_sha256, expires_at{retention_column}
                    )
                    VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9,
                        $10::jsonb, $11::jsonb, $12,
                        clock_timestamp() + ($13 * INTERVAL '1 second'){retention_value}
                    )
                    RETURNING created_at, expires_at
                    """,
                    snapshot_id,
                    bank_id,
                    source.state.provider_lineage,
                    source.state.bank_generation,
                    source.state.current_cursor,
                    LOGICAL_SNAPSHOT_SCHEMA_VERSION,
                    page_size,
                    len(pages),
                    len(source.records),
                    json.dumps(counts.model_dump(mode="json")),
                    json.dumps(manifest.page_hashes),
                    manifest.sha256,
                    ttl_seconds,
                )
                if metadata_row is None:
                    raise RuntimeError(f"Logical snapshot metadata insert returned no row for {snapshot_id}.")

                for page in pages:
                    await conn.execute(
                        f"""
                        INSERT INTO {self._fq_table("replication_logical_snapshot_pages")} (
                            snapshot_id, page_number, record_count, content_sha256, records
                        )
                        VALUES ($1, $2, $3, $4, $5::jsonb)
                        """,
                        snapshot_id,
                        page.page_number,
                        len(page.records),
                        page.content_sha256,
                        page.records_json,
                    )

                metadata = LogicalSnapshotMetadata(
                    snapshot_id=snapshot_id,
                    manifest=manifest,
                    created_at=metadata_row["created_at"],
                    expires_at=metadata_row["expires_at"],
                )
                if binding is not None:
                    # The certificate and retained pages commit together. A
                    # failure cannot leave a ready certificate or an orphaned
                    # retention pin for a snapshot that was never certified.
                    await binding.publish(conn, metadata, source.records)
                return metadata

    async def get_snapshot(self, *, bank_id: str, snapshot_id: uuid.UUID) -> LogicalSnapshotMetadata:
        """Read immutable snapshot metadata without extending its lifetime."""
        self._require_supported_storage()
        async with self._backend.acquire() as conn:
            retention = await self._retention_expression(conn)
            row = await conn.fetchrow(
                f"""
                SELECT snapshot_id, bank_id, provider_lineage, bank_generation,
                       end_cursor, snapshot_schema_version, page_size, total_pages,
                       total_records, counts, page_hashes, manifest_sha256,
                       created_at, expires_at, {retention} AS retained_for_cutover, clock_timestamp() AS database_now
                FROM {self._fq_table("replication_logical_snapshots")}
                WHERE snapshot_id = $1 AND bank_id = $2
                """,
                snapshot_id,
                bank_id,
            )
            counts = conn.parse_json(row["counts"]) if row is not None else None
            page_hashes = conn.parse_json(row["page_hashes"]) if row is not None else None
        if row is None:
            raise LogicalSnapshotNotFoundError(f"Unknown logical snapshot: {snapshot_id}")
        if row["expires_at"] <= row["database_now"] and not row["retained_for_cutover"]:
            raise LogicalSnapshotExpiredError(f"Logical snapshot has expired: {snapshot_id}")
        manifest = LogicalSnapshotManifest(
            schema_version=row["snapshot_schema_version"],
            bank_id=row["bank_id"],
            provider_lineage=row["provider_lineage"],
            bank_generation=row["bank_generation"],
            end_cursor=row["end_cursor"],
            page_size=row["page_size"],
            total_pages=row["total_pages"],
            total_records=row["total_records"],
            counts=LogicalSnapshotCounts.model_validate(counts),
            page_hashes=list(page_hashes),
            sha256=str(row["manifest_sha256"]).strip(),
        )
        return LogicalSnapshotMetadata(
            snapshot_id=row["snapshot_id"],
            manifest=manifest,
            created_at=row["created_at"],
            expires_at=row["expires_at"],
        )

    async def get_page(
        self,
        *,
        snapshot_id: uuid.UUID,
        page_number: int,
        bank_id: str | None = None,
    ) -> LogicalSnapshotPage:
        """Read one materialized page without extending its lifetime or writing state."""
        if page_number < 0:
            raise ValueError("page_number must be non-negative.")
        self._require_supported_storage()

        async with self._backend.acquire() as conn:
            retention = await self._retention_expression(conn, "s.")
            row = await conn.fetchrow(
                f"""
                SELECT s.expires_at, s.total_pages, {retention} AS retained_for_cutover, clock_timestamp() AS database_now,
                       p.page_number, p.record_count, p.content_sha256, p.records
                FROM {self._fq_table("replication_logical_snapshots")} s
                LEFT JOIN {self._fq_table("replication_logical_snapshot_pages")} p
                  ON p.snapshot_id = s.snapshot_id AND p.page_number = $2
                WHERE s.snapshot_id = $1 AND ($3::text IS NULL OR s.bank_id = $3)
                """,
                snapshot_id,
                page_number,
                bank_id,
            )
            raw_records = conn.parse_json(row["records"]) if row is not None and row["records"] is not None else None
        if row is None:
            raise LogicalSnapshotNotFoundError(f"Unknown logical snapshot: {snapshot_id}")
        if row["expires_at"] <= row["database_now"] and not row["retained_for_cutover"]:
            raise LogicalSnapshotExpiredError(f"Logical snapshot has expired: {snapshot_id}")
        if row["page_number"] is None:
            raise LogicalSnapshotPageNotFoundError(f"Logical snapshot {snapshot_id} has no page {page_number}.")

        if raw_records is None:
            raise LogicalSnapshotIntegrityError(
                f"Logical snapshot page has no materialized records: {snapshot_id}/{page_number}"
            )
        records = [LogicalSnapshotRecord.model_validate(record) for record in raw_records]
        canonical_records = [record.model_dump(mode="json") for record in records]
        actual_hash = hashlib.sha256(_canonical_json_bytes(canonical_records)).hexdigest()
        content_sha256 = str(row["content_sha256"]).strip()
        if actual_hash != content_sha256 or len(records) != row["record_count"]:
            raise LogicalSnapshotIntegrityError(
                f"Logical snapshot page integrity mismatch: {snapshot_id}/{page_number}"
            )
        return LogicalSnapshotPage(
            snapshot_id=snapshot_id,
            page_number=row["page_number"],
            total_pages=row["total_pages"],
            record_count=row["record_count"],
            content_sha256=content_sha256,
            records=records,
        )

    async def cleanup_expired(self) -> LogicalSnapshotCleanupResult:
        """Delete expired metadata and let the page FK cascade clean children."""
        self._require_supported_storage()
        async with self._backend.acquire() as conn:
            retention = await self._retention_expression(conn)
            rows = await conn.fetch(
                f"""
                DELETE FROM {self._fq_table("replication_logical_snapshots")}
                WHERE expires_at <= clock_timestamp() AND NOT {retention}
                RETURNING snapshot_id
                """
            )
        return LogicalSnapshotCleanupResult(deleted_snapshots=len(rows))
