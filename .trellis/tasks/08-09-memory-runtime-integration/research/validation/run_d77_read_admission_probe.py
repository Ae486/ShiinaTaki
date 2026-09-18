"""Measure the real admission path on owned PG data without invoking any model."""

from __future__ import annotations

import asyncio
import json
import sys
import time
from collections import defaultdict
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any

from d77_siliconflow_api import HELPERS, ROOT, SOURCE, digest, event, private_json
from prepare_d77_owner_acceptance import require_plain
from real_hindsight_environment import clean_environment
from real_hindsight_network import install_guard

sys.path.insert(0, str(HELPERS))
sys.path.insert(0, "H:/hindsight/hindsight-api-slim")
import run_real_hindsight as supervisor  # noqa: E402
from hindsight_api.engine.application_state import read_admission  # noqa: E402
from hindsight_api.engine.application_state.models import TakiApplicationBodyRef  # noqa: E402
from hindsight_api.engine.application_state.store import (
    ApplicationStateStore,
    parse_model,
)  # noqa: E402
from hindsight_api.engine.db.postgresql import PostgreSQLBackend, PostgresConnection  # noqa: E402
from hindsight_api.engine.search.types import MergedCandidate, RetrievalResult  # noqa: E402

IDENTITY = "api-policy-probe-red-1"
TIMINGS: dict[str, dict[str, float]] = defaultdict(lambda: {"calls": 0, "seconds": 0.0})


def instrument(target: Any, name: str, label: str) -> None:
    original = getattr(target, name)

    @wraps(original)
    async def measured(*args: Any, **kwargs: Any) -> Any:
        started = time.perf_counter()
        try:
            return await original(*args, **kwargs)
        finally:
            TIMINGS[label]["calls"] += 1
            TIMINGS[label]["seconds"] += time.perf_counter() - started

    setattr(target, name, measured)


def candidate(record: dict[str, Any], rank: int) -> MergedCandidate:
    def date(key: str) -> datetime | None:
        return (
            datetime.fromisoformat(record[key].replace("Z", "+00:00"))
            if record[key]
            else None
        )

    return MergedCandidate(
        retrieval=RetrievalResult(
            id=record["memoryId"],
            text=record["text"],
            fact_type=record["factType"],
            context=record["context"],
            document_id=record["documentId"],
            chunk_id=record["chunkId"],
            tags=record["tags"],
            metadata=record["metadata"],
            occurred_start=date("occurredStart"),
            occurred_end=date("occurredEnd"),
            mentioned_at=date("mentionedAt"),
        ),
        rrf_score=1 / (60 + rank),
        rrf_rank=rank,
    )


async def phase(label: str, action: Any) -> Any:
    before = {key: dict(value) for key, value in TIMINGS.items()}
    started = time.perf_counter()
    result = await action()
    elapsed = time.perf_counter() - started
    delta = {
        key: {
            field: round(value[field] - before.get(key, {}).get(field, 0), 6)
            for field in value
        }
        for key, value in TIMINGS.items()
    }
    private_json(
        f"{IDENTITY}-{label}.json", {"seconds": elapsed, "inclusiveTimings": delta}
    )
    event(
        "READ_ADMISSION_PROBE_PHASE",
        phase=label,
        seconds=round(elapsed, 3),
        sqlCalls=sum(
            int(value["calls"])
            for key, value in delta.items()
            if key.startswith("sql.")
        ),
    )
    return result


async def probe(owner: dict[str, Any], private: dict[str, str]) -> None:
    import sqlite3

    def fq_table(name: str) -> str:
        return f'"public"."{name}"'

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
        path = ROOT / "validation.sqlite"
        with sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
            records = {
                row[0]: json.loads(row[1])
                for row in db.execute(
                    "SELECT object_id,payload_json FROM hindsight_replica_records WHERE object_kind='memory_unit'"
                )
            }
        old = json.loads(
            (SOURCE / "recall-character-low-probe.json").read_text(encoding="utf-8")
        )["response"]["trace"]
        ordered = [records[item["node_id"]] for item in old["rrf_merged"]]
        bank_id = ordered[0]["bankId"]
        async with backend.acquire() as conn:
            descriptor = await conn.fetchval(
                f"SELECT descriptor FROM {fq_table('memory_application_bodies')} "
                "WHERE bank_id=$1 AND body_schema='application-read-context.v1' AND state='sealed' ORDER BY body_id LIMIT 1",
                bank_id,
            )
            assert descriptor is not None
            reference = parse_model(TakiApplicationBodyRef, descriptor)
            # The namespace is read from the same real body row, never invented
            # from a model response or reconstructed as a permissive policy.
            namespace = await conn.fetchrow(
                f"SELECT provider_lineage,bank_generation FROM {fq_table('memory_application_bodies')} "
                "WHERE bank_id=$1 AND body_id=$2",
                bank_id,
                reference.body_id,
            )
        from hindsight_api.engine.application_state.models import (
            TakiApplicationNamespace,
        )

        ns = TakiApplicationNamespace(
            provider_lineage=namespace["provider_lineage"],
            bank_generation=namespace["bank_generation"],
            application_id="taki",
        )
        for name in ("fetch", "fetchrow", "fetchval"):
            instrument(PostgresConnection, name, "sql." + name)
        for name in ("head", "artifact", "read_body"):
            instrument(ApplicationStateStore, name, "store." + name)
        for name in ("_binding", "before_model_input", "filter_candidates"):
            instrument(
                read_admission.ApplicationReadAdmission, name, "admission." + name
            )
        instrument(read_admission, "current_native", "current_native")
        for size in (25, 100):
            admission = await read_admission.ApplicationReadAdmission.create(
                backend=backend,
                fq_table=fq_table,
                bank_id=bank_id,
                namespace=ns,
                context_ref=reference,
                query=old["query"]["query_text"],
            )
            admitted = await phase(
                f"filter-{size}",
                lambda: admission.filter_candidates(
                    [
                        candidate(record, rank + 1)
                        for rank, record in enumerate(ordered[:size])
                    ]
                ),
            )
            assert len(admitted) > 0
            await phase(f"recheck-{size}", admission.before_model_input)
            event(
                "READ_ADMISSION_PROBE_CASE",
                candidates=size,
                admitted=len(admitted),
                modelCalls=0,
            )
        private_json(
            f"{IDENTITY}-summary.json",
            {
                "complete": True,
                "modelCalls": 0,
                "timings": dict(TIMINGS),
                "readAdmissionSourceSha256": digest(Path(read_admission.__file__)),
            },
        )
    finally:
        await backend.shutdown()


def run_probe(
    root: Path,
    owner: dict[str, Any],
    private: dict[str, str],
    listener: Any,
    shutdown: Any,
) -> Any:
    assert root == ROOT
    asyncio.run(asyncio.wait_for(probe(owner, private), timeout=180))
    receipt = root / f"consumer-{IDENTITY}-complete.json"
    with receipt.open("x", encoding="utf-8") as stream:
        stream.write(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "runDirectoryId": root.name,
                    "consumerId": IDENTITY,
                    "state": "complete",
                }
            )
            + "\n"
        )
    return supervisor.TerminalOutcome(
        "consumer_complete",
        0,
        False,
        0,
        IDENTITY,
        services_stopped={
            "consumer": True,
            "http": True,
            "engine": True,
            "background_tasks": True,
            "postgres": False,
        },
    )


def owned_root(value: str) -> Path:
    root = Path(value).absolute()
    if root != ROOT or not (root / "preparation-result.json").is_file():
        raise RuntimeError("D77_PROBE_ROOT_REFUSED")
    require_plain(root)
    return root


def main() -> int:
    if (ROOT / f"{IDENTITY}-summary.json").exists():
        raise RuntimeError("D77_PROBE_IDENTITY_REUSED")
    supervisor.owned_root = owned_root
    supervisor.__file__ = str(Path(__file__).resolve())
    supervisor.model_environment = lambda root: {
        **clean_environment(root),
        "TAKI_D78_REAL_CHILD": "1",
    }
    supervisor.run_server = run_probe
    supervisor.install_guard = lambda port, listener, **kwargs: install_guard(
        port, listener, model_access=False
    )
    return supervisor.main()


if __name__ == "__main__":
    raise SystemExit(main())
