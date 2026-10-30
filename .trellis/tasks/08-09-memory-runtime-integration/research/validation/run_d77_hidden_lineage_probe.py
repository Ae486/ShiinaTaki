"""Reproduce derived hidden-content admission on the owned copy without models."""

from __future__ import annotations

import json
import traceback
from pathlib import Path
from typing import Any

import run_d77_read_admission_probe as baseline
from d77_siliconflow_api import ROOT, event
from hindsight_api.engine.application_state.models import (
    TakiApplicationBodyRef,
    TakiApplicationNamespace,
    TakiApplicationNativeRecord,
)
from hindsight_api.engine.application_state.read_admission import (
    ApplicationReadAdmission,
)
from hindsight_api.engine.application_state.store import (
    ApplicationStateStore,
    parse_model,
)
from hindsight_api.engine.db.postgresql import PostgreSQLBackend
from hindsight_api.engine.replication import MemoryUnitLogicalPayload

IDENTITY = "api-hidden-lineage-red-3"


async def probe(owner: dict[str, Any], private: dict[str, str]) -> None:
    lineage = json.loads(
        (ROOT / "api-defaults-2-hidden-lineage-sqlite.json").read_text(encoding="utf-8")
    )
    original = next(row for row in lineage["records"] if row["wasOriginalTarget"])
    derived = next(row for row in lineage["records"] if not row["wasOriginalTarget"])
    assert original["bankId"] == derived["bankId"]
    bank_id = original["bankId"]
    query = json.loads(
        (ROOT / "api-defaults-2-api-reflect-hidden.json").read_text(encoding="utf-8")
    )["query"]
    backend = PostgreSQLBackend()
    await backend.initialize(
        f"postgresql://taki_real:{private['pg_password']}@127.0.0.1:{owner['port']}/taki_real",
        min_size=1,
        max_size=1,
        statement_cache_size=0,
    )
    try:
        async with backend.acquire() as conn:
            assert (
                Path(await conn.fetchval("SHOW data_directory")).resolve()
                == (ROOT / "native/data").resolve()
            )
            sources = await conn.fetchval(
                "SELECT source_memory_ids FROM memory_units "
                "WHERE bank_id=$1 AND id=$2::uuid",
                bank_id,
                derived["memoryId"],
            )
            source_ids = [str(value) for value in sources or []]
            context = await conn.fetchrow(
                "SELECT descriptor,provider_lineage,bank_generation "
                "FROM memory_application_bodies WHERE bank_id=$1 "
                "AND body_schema='application-read-context.v1' AND state='sealed' "
                "ORDER BY body_id LIMIT 1",
                bank_id,
            )
            assert context is not None
            namespace = TakiApplicationNamespace(
                provider_lineage=context["provider_lineage"],
                bank_generation=context["bank_generation"],
                application_id="taki",
            )
            store = ApplicationStateStore(
                conn, lambda name: f'"public"."{name}"', bank_id, namespace
            )
            payloads = []
            for item in (original, derived):
                head = await store.head("memory_unit", item["memoryId"])
                assert head is not None and head.body_ref is not None
                record = await store.read_body(head.body_ref)
                assert isinstance(record, TakiApplicationNativeRecord)
                assert isinstance(record.payload, MemoryUnitLogicalPayload)
                payloads.append(record.payload)
        admission = await ApplicationReadAdmission.create(
            backend=backend,
            fq_table=lambda name: f'"public"."{name}"',
            bank_id=bank_id,
            namespace=namespace,
            context_ref=parse_model(TakiApplicationBodyRef, context["descriptor"]),
            query=query,
        )
        admitted = await admission.filter_candidates(
            [
                baseline.candidate(
                    {
                        "memoryId": payload.memory_id,
                        "text": payload.text,
                        "factType": payload.fact_type,
                        "context": payload.context,
                        "documentId": payload.document_id,
                        "chunkId": payload.chunk_id,
                        "tags": payload.tags,
                        "metadata": payload.metadata,
                        "occurredStart": payload.occurred_start,
                        "occurredEnd": payload.occurred_end,
                        "mentionedAt": payload.mentioned_at,
                    },
                    rank + 1,
                )
                for rank, payload in enumerate(payloads)
            ]
        )
        admitted_ids = {item.id for item in admitted}
        summary = {
            "modelCalls": 0,
            "derivedSourceCount": len(source_ids),
            "derivedDeclaresHiddenSource": original["memoryId"] in source_ids,
            "hiddenOriginalAdmitted": original["memoryId"] in admitted_ids,
            "derivedObservationAdmitted": derived["memoryId"] in admitted_ids,
        }
        with (ROOT / f"{IDENTITY}-summary.json").open("x", encoding="utf-8") as stream:
            json.dump(summary, stream, indent=2)
            stream.write("\n")
        event("HIDDEN_LINEAGE_PROBE_COMPLETE", identity=IDENTITY, **summary)
        assert summary["derivedDeclaresHiddenSource"]
        assert not summary["hiddenOriginalAdmitted"]
        # Keep the protected-input expectation identical before and after repair.
        # The baseline must fail here, without ever submitting content to a model.
        assert not summary["derivedObservationAdmitted"], (
            "D77_HIDDEN_DERIVED_INPUT_ADMITTED"
        )
    finally:
        await backend.shutdown()


async def observed_probe(owner: dict[str, Any], private: dict[str, str]) -> None:
    try:
        await probe(owner, private)
    except Exception as error:
        metadata = {
            "errorType": type(error).__name__,
            "frames": [
                {
                    "file": Path(frame.filename).name,
                    "line": frame.lineno,
                    "function": frame.name,
                }
                for frame in traceback.extract_tb(error.__traceback__)
            ],
        }
        with (ROOT / f"{IDENTITY}-error.json").open("x", encoding="utf-8") as stream:
            json.dump(metadata, stream, indent=2)
            stream.write("\n")
        event("HIDDEN_LINEAGE_PROBE_ERROR", identity=IDENTITY, **metadata)
        raise


def main() -> int:
    baseline.IDENTITY = IDENTITY
    baseline.probe = observed_probe
    # Reuse the existing Job/PG-only supervisor, including its network guard and
    # cleanup. Its child must re-enter this probe instead of the older timer probe.
    baseline.__file__ = str(Path(__file__).resolve())
    return baseline.main()


if __name__ == "__main__":
    raise SystemExit(main())
