"""Offline transport reproduction; no PG, model, real corpus or source edits.

Use actual head/artifact enumeration, immutable-byte validation and reader batch
scheduling. Small synthetic JSON bodies deliberately test only the byte-transport
layer, not full artifact schemas, SQL semantics, baseline proofs or elapsed time.
The corpus-shaped traversal counts come from the sealed prepatch detail profile.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import sys
import uuid
from collections import Counter
from typing import Any

sys.path.insert(0, "H:/hindsight/hindsight-api-slim")

from hindsight_api.engine.application_state.codec import (  # noqa: E402
    digest,
    json_bytes,
    without_hash,
)
from hindsight_api.engine.application_state.models import (  # noqa: E402
    TakiApplicationArtifact,
    TakiApplicationArtifactKey,
    TakiApplicationBlockBinding,
    TakiApplicationBodyRef,
    TakiApplicationNamespace,
    TakiApplicationNativeHead,
    TakiApplicationNativeVersion,
)
from hindsight_api.engine.application_state.snapshot import _locked_native_view  # noqa: E402
from hindsight_api.engine.logical_snapshot import _SnapshotSource  # noqa: E402
from hindsight_api.engine.replication import ReplicationBankState  # noqa: E402
from hindsight_api.engine.transition_baseline_reads import _TransitionValidationReader  # noqa: E402


class Rows:
    def __init__(self) -> None:
        self.namespace = TakiApplicationNamespace(
            provider_lineage=uuid.UUID(int=1), bank_generation=uuid.UUID(int=2)
        )
        self.bank = "owned-offline-scheduling-probe"
        self.counts: Counter[str] = Counter()
        self.metadata: dict[uuid.UUID, dict[str, Any]] = {}
        self.parts: dict[uuid.UUID, dict[str, Any]] = {}
        self.heads: list[dict[str, Any]] = []
        self.artifacts: list[dict[str, Any]] = []
        self.traversal: list[TakiApplicationBodyRef] = []
        self.artifact_refs: list[TakiApplicationBodyRef] = []
        for index in range(1559):
            ref = self.body("application-native-record.v1")
            version = TakiApplicationNativeVersion(
                object_kind="memory_unit",
                object_id=str(uuid.UUID(int=10000 + index)),
                object_revision=1,
                payload_hash="a" * 64,
                native_cursor=1,
            )
            head = TakiApplicationNativeHead(
                object_kind=version.object_kind,
                object_id=version.object_id,
                version=version,
                body_ref=ref,
                tombstone=None,
                binding_state="binding_missing",
                bound_artifact=None,
                previous_version=None,
                cause="baseline",
            )
            self.heads.append(
                {
                    "object_kind": head.object_kind,
                    "object_id": head.object_id,
                    "head": json_bytes(head),
                }
            )
            self.traversal.append(ref)
            # The saved profile has Bank/directive before 562 document heads;
            # each document then reads one previously unlisted native Source.
            if 2 <= index < 564:
                self.traversal.append(self.body("application-native-source.v1"))
        for index in range(2102):
            ref = self.body("application-block.v1")
            artifact = TakiApplicationArtifact(
                namespace=self.namespace,
                bank_id=self.bank,
                key=TakiApplicationArtifactKey(
                    artifact_kind="block", artifact_id=f"block-{index}"
                ),
                revision=1,
                body_ref=ref,
                binding=TakiApplicationBlockBinding(),
                tombstoned=False,
                created_at="2026-10-05T00:00:00+00:00",
                updated_at="2026-10-05T00:00:00+00:00",
                record_hash="0" * 64,
            )
            artifact.record_hash = digest(
                "record",
                self.namespace,
                self.bank,
                without_hash(artifact, "record_hash"),
            )
            self.artifacts.append({"record": json_bytes(artifact)})
            self.artifact_refs.append(ref)

    def body(self, schema: Any) -> TakiApplicationBodyRef:
        identity = uuid.UUID(int=100000 + len(self.metadata))
        value = {"synthetic": str(identity)}
        data = json_bytes(value)
        checksum = hashlib.sha256(data).hexdigest()
        ref = TakiApplicationBodyRef(
            body_id=identity,
            body_schema=schema,
            total_parts=1,
            total_bytes=len(data),
            bytes_sha256=checksum,
            payload_hash=digest("body", self.namespace, self.bank, value),
        )
        keys = dict(
            provider_lineage=self.namespace.provider_lineage,
            bank_id=self.bank,
            bank_generation=self.namespace.bank_generation,
            body_id=identity,
        )
        self.metadata[identity] = dict(
            **keys, descriptor=json_bytes(ref), state="sealed", expires_at=None
        )
        self.parts[identity] = dict(
            **keys, part_number=0, part_sha256=checksum, data=data
        )
        return ref

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        if "memory_application_native_heads" in query:
            self.counts["head_select"] += 1
            return self.heads
        if "memory_application_artifacts" in query:
            self.counts["artifact_select"] += 1
            return self.artifacts
        if "memory_application_bodies" in query:
            self.counts["batch_metadata"] += 1
            return [self.metadata[key] for key in args[3]]
        if "GROUP BY body_id" in query:
            self.counts["batch_sizes"] += 1
            return [
                dict(
                    body_id=key, actual_bytes=len(self.parts[key]["data"]), part_count=1
                )
                for key in args[3]
            ]
        if "body_id=ANY" in query:
            self.counts["batch_parts"] += 1
            return [self.parts[key] for key in args[3]]
        if "body_id=$4" in query:
            self.counts["ordinary_parts"] += 1
            return [self.parts[args[3]]]
        raise AssertionError("Unexpected fake SQL family")

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any]:
        assert "memory_application_bodies" in query and "body_id=$4" in query
        self.counts["ordinary_metadata"] += 1
        return self.metadata[args[3]]


async def run(rows: Rows, locked: bool) -> dict[str, Any]:
    rows.counts.clear()
    reader = _TransitionValidationReader(
        rows, lambda name: name, rows.bank, rows.namespace
    )
    source = _SnapshotSource(
        state=ReplicationBankState(
            bank_id=rows.bank,
            provider_lineage=rows.namespace.provider_lineage,
            bank_generation=rows.namespace.bank_generation,
            current_cursor=1,
            minimum_available_cursor=0,
            deleted_at=None,
        ),
        records=[],
    )
    try:
        if locked:
            await _locked_native_view(reader, source)
        else:
            await reader.heads()
        pending_after_heads = len(reader._pending)
        await reader.artifacts()
        for ref in [*rows.traversal, *rows.artifact_refs]:
            await reader.body_bytes(ref)
        first_counts = dict(rows.counts)
        for ref in [*rows.traversal, *rows.artifact_refs]:
            await reader.body_bytes(ref)
        assert rows.counts == first_counts, (
            "Second traversal must reuse verified immutable bytes"
        )
        return dict(
            path="locked" if locked else "ordinary",
            pendingAfterHeads=pending_after_heads,
            sql=first_counts,
            verifiedBodies=len(reader._verified),
            secondPassExtraSql=0,
        )
    finally:
        reader.close()
        assert not reader._pending and not reader._verified


async def main() -> None:
    rows = Rows()
    ordinary, locked = await run(rows, False), await run(rows, True)
    assert ordinary["pendingAfterHeads"] == 1559 and locked["pendingAfterHeads"] == 0
    assert (
        ordinary["sql"]["ordinary_metadata"] == ordinary["sql"]["ordinary_parts"] == 558
    )
    assert locked["sql"]["ordinary_metadata"] == locked["sql"]["ordinary_parts"] == 2120
    assert ordinary["verifiedBodies"] == locked["verifiedBodies"] == 4223
    assert (
        ordinary["sql"]["batch_metadata"] == 29
        and locked["sql"]["batch_metadata"] == 17
    )
    assert "torch" not in sys.modules and "sentence_transformers" not in sys.modules
    result = dict(
        meaning=__doc__,
        reproduced=True,
        ordinary=ordinary,
        locked=locked,
        extraOrdinaryPairsAcrossTwoBaselines=3124,
        fewerBatchesAcrossTwoBaselines=24,
        filesWrittenByProbe=0,
        modelCalls=0,
        databaseConnections=0,
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
