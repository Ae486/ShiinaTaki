"""Private byte reuse inside one locked delta-baseline invocation.

Raw prefetch only reduces round trips. The ordinary store still validates the
descriptor, sealed state, parts, whole digest and semantic digest. Only those
verified immutable bytes enter the LRU; models and Source closure are rebuilt
on every read. Never retain this reader across a transaction or expose it to a
writer, preflight, embedding preparation or the caller of baseline capture.
"""

from __future__ import annotations

import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from .application_state.codec import json_bytes
from .application_state.models import (
    ApplicationArtifactKind,
    ApplicationStateError,
    TakiApplicationArtifact,
    TakiApplicationArtifactKey,
    TakiApplicationBodyRef,
    TakiApplicationNamespace,
    TakiApplicationNativeHead,
)
from .application_state.store import _KEY_COLUMNS, _KEY_PREDICATE, ApplicationStateStore

_BATCH_BODIES = 128
_BATCH_BYTES = 8 * 1024 * 1024
_BATCH_PARTS = 1024
_CACHE_BYTES = 64 * 1024 * 1024
_CACHE_BODIES = 8192


@dataclass(frozen=True)
class _BodyIdentity:
    provider_lineage: uuid.UUID
    bank_id: str
    bank_generation: uuid.UUID
    descriptor: bytes


class _TransitionBaselineReader(ApplicationStateStore):
    def __init__(
        self, conn: Any, fq_table: Callable[[str], str], bank_id: str, namespace: TakiApplicationNamespace
    ) -> None:
        super().__init__(conn, fq_table, bank_id, namespace)
        self._connection = conn
        self._tables = fq_table
        self._scope = tuple(self.keys)
        self._pending: OrderedDict[uuid.UUID, None] = OrderedDict()
        # Raw driver rows contain immutable BYTEA, never decoded models. At most
        # one bounded batch is staged; reading dependencies may replace it.
        self._metadata: dict[uuid.UUID, Any] = {}
        self._parts: dict[uuid.UUID, list[Any]] = {}
        self._verified: OrderedDict[_BodyIdentity, bytes] = OrderedDict()
        self._verified_bytes = 0
        self._active: set[_BodyIdentity] = set()
        self._closed = False

    def close(self) -> None:
        self._pending.clear()
        self._metadata.clear()
        self._parts.clear()
        self._verified.clear()
        self._active.clear()
        self._verified_bytes = 0
        self._closed = True

    def _check_scope(self) -> None:
        if (
            self._closed
            or self.conn is not self._connection
            or self.fq_table is not self._tables
            or tuple(self.keys) != self._scope
        ):
            raise ApplicationStateError("namespace_mismatch")

    def _identity(self, descriptor: TakiApplicationBodyRef) -> _BodyIdentity:
        self._check_scope()
        return _BodyIdentity(
            self.namespace.provider_lineage, self.bank_id, self.namespace.bank_generation, json_bytes(descriptor)
        )

    async def heads(self) -> list[TakiApplicationNativeHead]:
        heads = await super().heads()
        for head in heads:
            if head.body_ref is not None:
                self._pending[head.body_ref.body_id] = None
        return heads

    async def artifacts(
        self,
        *,
        history: bool = True,
        kind: ApplicationArtifactKind | None = None,
        key: TakiApplicationArtifactKey | None = None,
    ) -> list[TakiApplicationArtifact]:
        artifacts = await super().artifacts(history=history, kind=kind, key=key)
        for artifact in artifacts:
            self._pending[artifact.body_ref.body_id] = None
        return artifacts

    def _check_raw_scope(self, row: Any, ids: list[uuid.UUID]) -> None:
        if (row["provider_lineage"], row["bank_id"], row["bank_generation"]) != self._scope:
            raise ApplicationStateError("namespace_mismatch")
        if row["body_id"] not in ids:
            raise ApplicationStateError("body_integrity_error", 503)

    async def _prefetch(self, body_id: uuid.UUID) -> None:
        self._check_scope()
        self._metadata.clear()
        self._parts.clear()
        self._pending.pop(body_id, None)
        ids = [body_id]
        while self._pending and len(ids) < _BATCH_BODIES:
            ids.append(self._pending.popitem(last=False)[0])
        # The byte predicates run inside the same statement as materialization.
        # A corrupt declared size (or a direct storage change after a size probe)
        # therefore cannot make a supposedly bounded batch load arbitrary bytes.
        rows = await self.conn.fetch(
            f"SELECT * FROM (SELECT {_KEY_COLUMNS},body_id,descriptor,state,expires_at, "
            "SUM(octet_length(descriptor)) OVER () AS batch_bytes, COUNT(*) OVER () AS batch_count "
            f"FROM {self.fq_table('memory_application_bodies')} WHERE {_KEY_PREDICATE} "
            "AND body_id=ANY($4::uuid[])) batch WHERE batch_bytes<=$5 AND batch_count<=$6",
            *self.keys,
            ids,
            _BATCH_BYTES,
            _BATCH_BODIES,
        )
        metadata_bytes = 0
        for row in rows:
            self._check_raw_scope(row, ids)
            if row["body_id"] in self._metadata:
                raise ApplicationStateError("body_integrity_error", 503)
            metadata_bytes += len(row["descriptor"])
            self._metadata[row["body_id"]] = row
        if not rows:
            return  # Oversized metadata or missing bodies use the original read.
        sizes = await self.conn.fetch(
            "SELECT body_id,SUM(octet_length(data)) AS actual_bytes,COUNT(*) AS part_count "
            f"FROM {self.fq_table('memory_application_body_parts')} WHERE {_KEY_PREDICATE} "
            "AND body_id=ANY($4::uuid[]) GROUP BY body_id ORDER BY body_id",
            *self.keys,
            ids,
        )
        selected: list[uuid.UUID] = []
        remaining = _BATCH_BYTES - metadata_bytes
        remaining_parts = _BATCH_PARTS
        for size in sizes:
            if size["actual_bytes"] <= remaining and size["part_count"] <= remaining_parts:
                selected.append(size["body_id"])
                remaining -= size["actual_bytes"]
                remaining_parts -= size["part_count"]
        if not selected:
            return
        rows = await self.conn.fetch(
            f"SELECT * FROM (SELECT {_KEY_COLUMNS},body_id,part_number,part_sha256,data, "
            "SUM(octet_length(data)) OVER () AS batch_bytes,COUNT(*) OVER () AS batch_count "
            f"FROM {self.fq_table('memory_application_body_parts')} WHERE {_KEY_PREDICATE} "
            "AND body_id=ANY($4::uuid[])) batch WHERE batch_bytes<=$5 AND batch_count<=$6 "
            "ORDER BY body_id,part_number",
            *self.keys,
            selected,
            _BATCH_BYTES - metadata_bytes,
            _BATCH_PARTS,
        )
        seen: set[tuple[uuid.UUID, int]] = set()
        for row in rows:
            self._check_raw_scope(row, selected)
            part_key = (row["body_id"], row["part_number"])
            if part_key in seen:
                raise ApplicationStateError("body_integrity_error", 503)
            seen.add(part_key)
            self._parts.setdefault(row["body_id"], []).append(row)

    async def _load_body_metadata(self, body_id: uuid.UUID, *, lock: bool = False) -> Any:
        self._check_scope()
        if lock:
            return await super()._load_body_metadata(body_id, lock=True)
        # A newly discovered Source dependency must not evict the staged heads
        # and artifacts. Read that one body normally until this batch is spent.
        if body_id not in self._metadata and not self._metadata:
            await self._prefetch(body_id)
        row = self._metadata.pop(body_id, None)
        return row if row is not None else await super()._load_body_metadata(body_id)

    async def _load_body_parts(self, body_id: uuid.UUID) -> list[Any]:
        self._check_scope()
        rows = self._parts.pop(body_id, None)
        return rows if rows is not None else await super()._load_body_parts(body_id)

    def _forget(self, identity: _BodyIdentity) -> None:
        previous = self._verified.pop(identity, None)
        if previous is not None:
            self._verified_bytes -= len(previous)

    async def body_bytes(self, descriptor: TakiApplicationBodyRef, *, require_sealed: bool = True) -> bytes:
        identity = self._identity(descriptor)
        if require_sealed and identity in self._verified:
            self._verified.move_to_end(identity)
            return self._verified[identity]
        value = await super().body_bytes(descriptor, require_sealed=require_sealed)
        if require_sealed and len(value) <= _CACHE_BYTES and _CACHE_BODIES > 0:
            while self._verified and (
                self._verified_bytes + len(value) > _CACHE_BYTES or len(self._verified) >= _CACHE_BODIES
            ):
                self._verified_bytes -= len(self._verified.popitem(last=False)[1])
            self._verified[identity] = value
            self._verified_bytes += len(value)
        return value

    async def read_body(self, descriptor: TakiApplicationBodyRef) -> BaseModel:
        identity = self._identity(descriptor)
        if identity in self._active:
            raise ApplicationStateError("source_reference_invalid", 422)
        self._active.add(identity)
        try:
            return await super().read_body(descriptor)
        except BaseException:
            # Failure/cancellation never creates a reusable accepted result.
            self._forget(identity)
            raise
        finally:
            self._active.discard(identity)
