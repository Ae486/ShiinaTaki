"""Connection-bound, namespace-checked application body and artifact storage.

The caller owns transaction boundaries and takes the native Bank lock before
the application Bank row. No operation here performs model or network I/O.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, TypeAdapter

from ..replication import ReplicationBankState, lock_replication_bank_state
from .codec import body_ref, decode_json, digest, json_bytes, validate_body, without_hash
from .models import (
    APPLICATION_BODY_PART_BYTES,
    APPLICATION_UPLOAD_BYTES,
    ApplicationArtifactKind,
    ApplicationBodySchema,
    ApplicationStateError,
    TakiApplicationArtifact,
    TakiApplicationArtifactKey,
    TakiApplicationArtifactVersion,
    TakiApplicationBodyPart,
    TakiApplicationBodyPartReceipt,
    TakiApplicationBodyPartRequest,
    TakiApplicationBodyRef,
    TakiApplicationBodyUploadStatus,
    TakiApplicationCheckpoint,
    TakiApplicationInitializeResponse,
    TakiApplicationNamespace,
    TakiApplicationNativeHead,
)

_Model = TypeVar("_Model", bound=BaseModel)
_KEY_PREDICATE = "provider_lineage=$1 AND bank_id=$2 AND bank_generation=$3"
_KEY_COLUMNS = "provider_lineage,bank_id,bank_generation"


def _indexed_id(value: str) -> str:
    """Check SQL header keys without restricting byte-preserved original bodies."""
    try:
        if not value or "\0" in value or len(value.encode("utf-16-le")) // 2 > 256:
            raise ValueError("Unsupported indexed identifier")
        value.encode("utf-8", errors="strict")
    except ValueError as exc:
        # Driver encoding failures would otherwise escape as HTTP 500s. The
        # original Canonical strings remain valid inside immutable byte bodies;
        # only identifiers sent to PostgreSQL TEXT require this representation.
        raise ApplicationStateError("invalid_request", 422) from exc
    return value


@dataclass(frozen=True)
class ApplicationBankState:
    checkpoint: TakiApplicationCheckpoint
    minimum_state_cursor: int
    baseline_native_cursor: int
    initialized_at: str
    deleted_at: str | None


@dataclass(frozen=True)
class StoredBody:
    descriptor: TakiApplicationBodyRef
    state: Literal["uploading", "sealed"]
    expires_at: str | None


class BodyPages(BaseModel):
    refs: list[TakiApplicationBodyRef]


def parse_model(model: type[_Model], data: bytes) -> _Model:
    try:
        return model.model_validate(decode_json(bytes(data)))
    except (ValueError, TypeError) as exc:
        raise ApplicationStateError("application_state_corrupt", 503) from exc


async def application_capture_column(conn: Any, fq_table: Callable[[str], str]) -> bool:
    """Old schemas have no marker; installed capture must not fail open on error."""
    return bool(
        await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass($1) "
            "AND attname='application_capture_required' AND attnum>0 AND NOT attisdropped)",
            fq_table("replication_bank_state"),
        )
    )


async def require_application_schema(conn: Any, fq_table: Callable[[str], str]) -> None:
    if not await application_capture_column(conn, fq_table):
        raise ApplicationStateError("capability_unsupported", 503)
    # Probe actual columns and constraints, not a version string or table name.
    columns = {
        "memory_application_banks": "provider_lineage,bank_id,bank_generation,native_cursor,state_cursor,minimum_state_cursor,baseline_native_cursor,initialized_at,deleted_at",
        "memory_application_bodies": "provider_lineage,bank_id,bank_generation,body_id,body_schema,descriptor,state,expires_at",
        "memory_application_body_parts": "provider_lineage,bank_id,bank_generation,body_id,part_number,part_sha256,data",
        "memory_application_native_heads": "provider_lineage,bank_id,bank_generation,object_kind,object_id,head",
        "memory_application_artifacts": "provider_lineage,bank_id,bank_generation,artifact_kind,artifact_id,revision,record_hash,body_id,record",
        "memory_application_changes": "provider_lineage,bank_id,bank_generation,state_cursor,manifest,page_refs",
        "memory_application_operations": "provider_lineage,bank_id,bank_generation,operation_id,request_hash,receipt",
        "memory_application_snapshots": "provider_lineage,bank_id,bank_generation,snapshot_id,request_id,request_hash,manifest,page_refs,expires_at",
    }
    for table, selection in columns.items():
        await conn.fetch(f"SELECT {selection} FROM {fq_table(table)} WHERE FALSE")
        primary = await conn.fetchval(
            "SELECT COUNT(*) FROM pg_constraint WHERE conrelid=to_regclass($1) AND contype='p'",
            fq_table(table),
        )
        if primary != 1:
            raise ApplicationStateError("capability_unsupported", 503)


class ApplicationStateStore:
    def __init__(
        self, conn: Any, fq_table: Callable[[str], str], bank_id: str, namespace: TakiApplicationNamespace
    ) -> None:
        self.conn = conn
        self.fq_table = fq_table
        self.bank_id = _indexed_id(bank_id)
        self.namespace = namespace

    @property
    def keys(self) -> list[Any]:
        return [self.namespace.provider_lineage, self.bank_id, self.namespace.bank_generation]

    async def require_live(self, *, lock: bool = False) -> ReplicationBankState:
        row = await self.conn.fetchrow(
            f"SELECT bank_id,provider_lineage,bank_generation,current_cursor,minimum_available_cursor,deleted_at "
            f"FROM {self.fq_table('replication_bank_state')} WHERE bank_id=$1",
            self.bank_id,
        )
        if row is None:
            raise ApplicationStateError("bank_not_found", 404)
        state = ReplicationBankState(**dict(row))
        if (
            state.provider_lineage != self.namespace.provider_lineage
            or state.bank_generation != self.namespace.bank_generation
        ):
            raise ApplicationStateError("namespace_mismatch")
        if state.deleted_at is not None:
            raise ApplicationStateError("bank_deleted", 410)
        if lock:
            state = await lock_replication_bank_state(conn=self.conn, fq_table=self.fq_table, bank_id=self.bank_id)
            if (
                state.provider_lineage != self.namespace.provider_lineage
                or state.bank_generation != self.namespace.bank_generation
            ):
                raise ApplicationStateError("namespace_mismatch")
            if state.deleted_at is not None:
                raise ApplicationStateError("bank_deleted", 410)
        if not await self.conn.fetchval(
            f"SELECT EXISTS(SELECT 1 FROM {self.fq_table('banks')} WHERE bank_id=$1)", self.bank_id
        ):
            raise ApplicationStateError("bank_not_found", 404)
        return state

    async def state(self, *, lock: bool = False, optional: bool = False) -> ApplicationBankState | None:
        row = await self.conn.fetchrow(
            f"SELECT native_cursor,state_cursor,minimum_state_cursor,baseline_native_cursor,initialized_at,deleted_at "
            f"FROM {self.fq_table('memory_application_banks')} WHERE {_KEY_PREDICATE}"
            + (" FOR UPDATE" if lock else ""),
            *self.keys,
        )
        if row is None:
            if optional:
                return None
            raise ApplicationStateError("capture_required", 409)
        return ApplicationBankState(
            checkpoint=TakiApplicationCheckpoint(native_cursor=row["native_cursor"], state_cursor=row["state_cursor"]),
            minimum_state_cursor=row["minimum_state_cursor"],
            baseline_native_cursor=row["baseline_native_cursor"],
            initialized_at=row["initialized_at"].isoformat(),
            deleted_at=row["deleted_at"].isoformat() if row["deleted_at"] is not None else None,
        )

    async def require_state(self, *, lock: bool = False) -> ApplicationBankState:
        state = await self.state(lock=lock)
        if state is None:  # Narrow the optional API for checked callers.
            raise ApplicationStateError("capture_required")
        return state

    async def initialize_row(self, native_cursor: int) -> None:
        await self.conn.execute(
            f"INSERT INTO {self.fq_table('memory_application_banks')} "
            f"({_KEY_COLUMNS},baseline_native_cursor,native_cursor) VALUES ($1,$2,$3,$4,$4) "
            f"ON CONFLICT ({_KEY_COLUMNS}) DO NOTHING",
            *self.keys,
            native_cursor,
        )

    async def initialize_response(self) -> TakiApplicationInitializeResponse:
        state = await self.require_state()
        return TakiApplicationInitializeResponse(
            namespace=self.namespace,
            bank_id=self.bank_id,
            checkpoint=state.checkpoint,
            minimum_state_cursor=state.minimum_state_cursor,
            initialized_at=state.initialized_at,
        )

    async def _load_body_metadata(self, body_id: uuid.UUID, *, lock: bool = False) -> Any:
        """Raw storage seam; ordinary readers and all writers retain the same SQL."""
        return await self.conn.fetchrow(
            f"SELECT descriptor,state,expires_at FROM {self.fq_table('memory_application_bodies')} "
            f"WHERE {_KEY_PREDICATE} AND body_id=$4" + (" FOR UPDATE" if lock else ""),
            *self.keys,
            body_id,
        )

    async def stored_body(self, body_id: uuid.UUID, *, lock: bool = False) -> StoredBody:
        row = await self._load_body_metadata(body_id, lock=lock)
        if row is None:
            raise ApplicationStateError("body_not_found", 404)
        return StoredBody(
            descriptor=parse_model(TakiApplicationBodyRef, row["descriptor"]),
            state=row["state"],
            expires_at=row["expires_at"].isoformat() if row["expires_at"] is not None else None,
        )

    async def body_status(self, body_id: uuid.UUID) -> TakiApplicationBodyUploadStatus:
        body = await self.stored_body(body_id)
        count = await self.conn.fetchval(
            f"SELECT COUNT(*) FROM {self.fq_table('memory_application_body_parts')} WHERE {_KEY_PREDICATE} AND body_id=$4",
            *self.keys,
            body_id,
        )
        return TakiApplicationBodyUploadStatus(
            namespace=self.namespace,
            bank_id=self.bank_id,
            descriptor=body.descriptor,
            state=body.state,
            received_parts=count,
            expires_at=body.expires_at,
        )

    async def prepare_body(self, descriptor: TakiApplicationBodyRef) -> TakiApplicationBodyUploadStatus:
        if descriptor.total_bytes > APPLICATION_UPLOAD_BYTES:
            raise ApplicationStateError("payload_too_large", 413)
        if descriptor.body_schema in {
            "application-native-record.v1",
            "application-native-source.v1",
            "application-record-page.v1",
            "application-affected-versions.v1",
        }:
            raise ApplicationStateError("unsupported_body_schema", 422)
        await self.conn.execute(
            f"INSERT INTO {self.fq_table('memory_application_bodies')} "
            f"({_KEY_COLUMNS},body_id,body_schema,descriptor,state,expires_at) "
            "VALUES ($1,$2,$3,$4,$5,$6,'uploading',clock_timestamp()+interval '1 day') "
            f"ON CONFLICT ({_KEY_COLUMNS},body_id) DO NOTHING",
            *self.keys,
            descriptor.body_id,
            descriptor.body_schema,
            json_bytes(descriptor),
        )
        stored = await self.stored_body(descriptor.body_id)
        if stored.descriptor != descriptor:
            raise ApplicationStateError("body_conflict")
        return await self.body_status(descriptor.body_id)

    def part_receipt(self, body_id: uuid.UUID, number: int, checksum: str, size: int) -> TakiApplicationBodyPartReceipt:
        receipt = TakiApplicationBodyPartReceipt(
            namespace=self.namespace,
            bank_id=self.bank_id,
            body_id=body_id,
            part_number=number,
            part_sha256=checksum,
            total_bytes=size,
            part_hash="0" * 64,
        )
        return receipt.model_copy(
            update={"part_hash": digest("part", self.namespace, self.bank_id, without_hash(receipt, "part_hash"))}
        )

    async def put_part(
        self, body_id: uuid.UUID, number: int, request: TakiApplicationBodyPartRequest
    ) -> TakiApplicationBodyPartReceipt:
        body = await self.stored_body(body_id, lock=True)
        if not 0 <= number < body.descriptor.total_parts:
            raise ApplicationStateError("invalid_request", 422)
        try:
            data = base64.b64decode(request.data_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ApplicationStateError("body_integrity_error", 422) from exc
        size = min(APPLICATION_BODY_PART_BYTES, body.descriptor.total_bytes - number * APPLICATION_BODY_PART_BYTES)
        if len(data) != size or hashlib.sha256(data).hexdigest() != request.part_sha256:
            raise ApplicationStateError("body_integrity_error", 422)
        old = await self.conn.fetchrow(
            f"SELECT data FROM {self.fq_table('memory_application_body_parts')} WHERE {_KEY_PREDICATE} AND body_id=$4 AND part_number=$5",
            *self.keys,
            body_id,
            number,
        )
        if old is not None:
            if bytes(old["data"]) != data:
                raise ApplicationStateError("body_conflict")
        else:
            if body.state == "sealed":
                raise ApplicationStateError("body_integrity_error", 503)
            await self.conn.execute(
                f"INSERT INTO {self.fq_table('memory_application_body_parts')} "
                f"({_KEY_COLUMNS},body_id,part_number,part_sha256,data) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                *self.keys,
                body_id,
                number,
                request.part_sha256,
                data,
            )
        return self.part_receipt(body_id, number, request.part_sha256, len(data))

    async def read_part(self, body_id: uuid.UUID, number: int) -> TakiApplicationBodyPart:
        await self.stored_body(body_id)
        row = await self.conn.fetchrow(
            f"SELECT part_sha256,data FROM {self.fq_table('memory_application_body_parts')} "
            f"WHERE {_KEY_PREDICATE} AND body_id=$4 AND part_number=$5",
            *self.keys,
            body_id,
            number,
        )
        if row is None:
            raise ApplicationStateError("page_not_found", 404)
        data = bytes(row["data"])
        if hashlib.sha256(data).hexdigest() != row["part_sha256"]:
            raise ApplicationStateError("body_integrity_error", 503)
        receipt = self.part_receipt(body_id, number, row["part_sha256"], len(data))
        return TakiApplicationBodyPart(**receipt.model_dump(), data_base64=base64.b64encode(data).decode("ascii"))

    async def _load_body_parts(self, body_id: uuid.UUID) -> list[Any]:
        """Return raw ordered rows; integrity remains owned by body_bytes."""
        return await self.conn.fetch(
            f"SELECT part_number,part_sha256,data FROM {self.fq_table('memory_application_body_parts')} "
            f"WHERE {_KEY_PREDICATE} AND body_id=$4 ORDER BY part_number",
            *self.keys,
            body_id,
        )

    async def body_bytes(self, descriptor: TakiApplicationBodyRef, *, require_sealed: bool = True) -> bytes:
        stored = await self.stored_body(descriptor.body_id)
        if stored.descriptor != descriptor:
            raise ApplicationStateError("body_conflict")
        if require_sealed and stored.state != "sealed":
            raise ApplicationStateError("body_not_sealed")
        rows = await self._load_body_parts(descriptor.body_id)
        if len(rows) != descriptor.total_parts:
            raise ApplicationStateError("body_incomplete")
        parts: list[bytes] = []
        for index, row in enumerate(rows):
            data = bytes(row["data"])
            expected_size = min(
                APPLICATION_BODY_PART_BYTES, descriptor.total_bytes - index * APPLICATION_BODY_PART_BYTES
            )
            if (
                row["part_number"] != index
                or len(data) != expected_size
                or hashlib.sha256(data).hexdigest() != row["part_sha256"]
            ):
                raise ApplicationStateError("body_integrity_error", 503)
            parts.append(data)
        joined = b"".join(parts)
        if len(joined) != descriptor.total_bytes or hashlib.sha256(joined).hexdigest() != descriptor.bytes_sha256:
            raise ApplicationStateError("body_integrity_error", 503)
        try:
            value = decode_json(joined)
            if digest("body", self.namespace, self.bank_id, value) != descriptor.payload_hash:
                raise ApplicationStateError("body_integrity_error", 422)
        except (ValueError, UnicodeError) as exc:
            raise ApplicationStateError("body_integrity_error", 422) from exc
        return joined

    async def read_body(self, descriptor: TakiApplicationBodyRef) -> BaseModel:
        body = validate_body(descriptor.body_schema, decode_json(await self.body_bytes(descriptor)))
        if descriptor.body_schema == "application-source-evidence.v1":
            from .models import TakiApplicationSourceEvidenceBody
            from .source_evidence import read_source_evidence

            if not isinstance(body, TakiApplicationSourceEvidenceBody):
                raise ApplicationStateError("body_integrity_error", 422)
            await read_source_evidence(self, body)
        return body

    async def seal_body(self, body_id: uuid.UUID, descriptor: TakiApplicationBodyRef) -> TakiApplicationBodyRef:
        if body_id != descriptor.body_id:
            raise ApplicationStateError("body_conflict")
        await self.stored_body(body_id, lock=True)
        data = await self.body_bytes(descriptor, require_sealed=False)
        validate_body(descriptor.body_schema, decode_json(data))
        await self.conn.execute(
            f"UPDATE {self.fq_table('memory_application_bodies')} SET state='sealed',expires_at=NULL "
            f"WHERE {_KEY_PREDICATE} AND body_id=$4",
            *self.keys,
            body_id,
        )
        return descriptor

    async def save_body(self, schema: ApplicationBodySchema, value: Any) -> TakiApplicationBodyRef:
        # Provider-generated recovery bodies are not subject to the upload cap.
        # Every complete body is still transported in independently checked parts.
        data = json_bytes(value)
        descriptor = body_ref(self.namespace, self.bank_id, schema, data)
        await self.conn.execute(
            f"INSERT INTO {self.fq_table('memory_application_bodies')} "
            f"({_KEY_COLUMNS},body_id,body_schema,descriptor,state,expires_at) VALUES ($1,$2,$3,$4,$5,$6,'sealed',NULL)",
            *self.keys,
            descriptor.body_id,
            schema,
            json_bytes(descriptor),
        )
        for number, offset in enumerate(range(0, len(data), APPLICATION_BODY_PART_BYTES)):
            part = data[offset : offset + APPLICATION_BODY_PART_BYTES]
            await self.conn.execute(
                f"INSERT INTO {self.fq_table('memory_application_body_parts')} "
                f"({_KEY_COLUMNS},body_id,part_number,part_sha256,data) VALUES ($1,$2,$3,$4,$5,$6,$7)",
                *self.keys,
                descriptor.body_id,
                number,
                hashlib.sha256(part).hexdigest(),
                part,
            )
        return descriptor

    async def head(self, kind: str, object_id: str) -> TakiApplicationNativeHead | None:
        data = await self.conn.fetchval(
            f"SELECT head FROM {self.fq_table('memory_application_native_heads')} "
            f"WHERE {_KEY_PREDICATE} AND object_kind=$4 AND object_id=$5",
            *self.keys,
            kind,
            _indexed_id(object_id),
        )
        return parse_model(TakiApplicationNativeHead, data) if data is not None else None

    async def heads(self) -> list[TakiApplicationNativeHead]:
        rows = await self.conn.fetch(
            f"SELECT head FROM {self.fq_table('memory_application_native_heads')} "
            f"WHERE {_KEY_PREDICATE} ORDER BY object_kind,object_id",
            *self.keys,
        )
        return [parse_model(TakiApplicationNativeHead, row["head"]) for row in rows]

    async def save_head(self, head: TakiApplicationNativeHead) -> None:
        await self.conn.execute(
            f"INSERT INTO {self.fq_table('memory_application_native_heads')} ({_KEY_COLUMNS},object_kind,object_id,head) "
            f"VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ({_KEY_COLUMNS},object_kind,object_id) DO UPDATE SET head=EXCLUDED.head",
            *self.keys,
            head.object_kind,
            head.object_id,
            json_bytes(head),
        )

    async def artifact(
        self, key: TakiApplicationArtifactKey, revision: int | None = None
    ) -> TakiApplicationArtifact | None:
        parameters = [*self.keys, key.artifact_kind, _indexed_id(key.artifact_id)]
        query = (
            f"SELECT record FROM {self.fq_table('memory_application_artifacts')} WHERE {_KEY_PREDICATE} "
            "AND artifact_kind=$4 AND artifact_id=$5"
        )
        if revision is not None:
            query += " AND revision=$6"
            parameters.append(revision)
        data = await self.conn.fetchval(query + " ORDER BY revision DESC LIMIT 1", *parameters)
        artifact = parse_model(TakiApplicationArtifact, data) if data is not None else None
        if artifact is not None and artifact.record_hash != digest(
            "record", self.namespace, self.bank_id, without_hash(artifact, "record_hash")
        ):
            raise ApplicationStateError("application_state_corrupt", 503)
        return artifact

    async def artifacts(
        self,
        *,
        history: bool = True,
        kind: ApplicationArtifactKind | None = None,
        key: TakiApplicationArtifactKey | None = None,
    ) -> list[TakiApplicationArtifact]:
        distinct = "" if history else "DISTINCT ON (artifact_kind,artifact_id) "
        parameters = self.keys
        condition = ""
        if key is not None:
            kind = key.artifact_kind
        if kind is not None:
            condition += " AND artifact_kind=$4"
            parameters.append(kind)
        if key is not None:
            condition += " AND artifact_id=$5"
            parameters.append(_indexed_id(key.artifact_id))
        rows = await self.conn.fetch(
            f"SELECT {distinct}record FROM {self.fq_table('memory_application_artifacts')} WHERE {_KEY_PREDICATE}{condition} "
            "ORDER BY artifact_kind,artifact_id,revision DESC",
            *parameters,
        )
        artifacts = [parse_model(TakiApplicationArtifact, row["record"]) for row in rows]
        for artifact in artifacts:
            if (
                artifact.namespace != self.namespace
                or artifact.bank_id != self.bank_id
                or artifact.record_hash
                != digest("record", self.namespace, self.bank_id, without_hash(artifact, "record_hash"))
            ):
                raise ApplicationStateError("application_state_corrupt", 503)
        return artifacts

    async def save_artifact(self, artifact: TakiApplicationArtifact) -> None:
        if "\0" in artifact.key.artifact_id:
            raise ApplicationStateError("invalid_request", 422)
        await self.conn.execute(
            f"INSERT INTO {self.fq_table('memory_application_artifacts')} "
            f"({_KEY_COLUMNS},artifact_kind,artifact_id,revision,record_hash,body_id,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            *self.keys,
            artifact.key.artifact_kind,
            artifact.key.artifact_id,
            artifact.revision,
            artifact.record_hash,
            artifact.body_ref.body_id,
            json_bytes(artifact),
        )


def artifact_version(artifact: TakiApplicationArtifact) -> TakiApplicationArtifactVersion:
    return TakiApplicationArtifactVersion(
        key=artifact.key, revision=artifact.revision, record_hash=artifact.record_hash
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def decode_refs(data: bytes) -> list[TakiApplicationBodyRef]:
    return TypeAdapter(BodyPages).validate_python(decode_json(bytes(data))).refs
