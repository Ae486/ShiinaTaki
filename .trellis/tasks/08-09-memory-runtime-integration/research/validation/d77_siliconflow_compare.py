"""Compare approved rerankers on unchanged historical candidates and native pair formatting."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import sqlite3
import sys
from datetime import datetime
from typing import Any

import httpx

from d77_siliconflow_api import (
    MODELS,
    SOURCE,
    allow_siliconflow,
    credential,
    digest,
    event,
    private_json,
    request,
    scores,
)

sys.path.insert(0, "H:/hindsight/hindsight-api-slim")
from hindsight_api.engine.search.reranking import CrossEncoderReranker  # noqa: E402
from hindsight_api.engine.search.types import MergedCandidate, RetrievalResult  # noqa: E402


def candidates(scope: str) -> tuple[dict[str, Any], list[MergedCandidate]]:
    trace = json.loads(
        (SOURCE / f"recall-{scope}-low-probe.json").read_text(encoding="utf-8")
    )
    path = SOURCE / "validation.sqlite"
    # The retained database is stopped and has an empty WAL. Immutable mode
    # avoids even shared-memory bookkeeping writes against historical evidence.
    assert (SOURCE / "validation.sqlite-wal").stat().st_size == 0
    with sqlite3.connect(path.as_uri() + "?mode=ro&immutable=1", uri=True) as db:
        records = {
            row[0]: json.loads(row[1])
            for row in db.execute(
                "SELECT object_id,payload_json FROM hindsight_replica_records WHERE object_kind='memory_unit'"
            )
        }
    seen = {}
    for batch in trace["response"]["trace"]["retrieval_results"]:
        for value in batch["results"]:
            seen[value["node_id"]] = value
    result = []
    for item in trace["response"]["trace"]["rrf_merged"]:
        stored = records[item["node_id"]]
        assert stored["text"] == item["text"] == seen[item["node_id"]]["text"]
        # Native trace serialization normalizes absent context to an empty string.
        assert (stored["context"] or "") == seen[item["node_id"]]["context"]
        date = stored["occurredStart"]
        result.append(
            MergedCandidate(
                retrieval=RetrievalResult(
                    id=item["node_id"],
                    text=stored["text"],
                    fact_type=stored["factType"],
                    context=stored["context"],
                    occurred_start=datetime.fromisoformat(date.replace("Z", "+00:00"))
                    if date
                    else None,
                ),
                rrf_score=item["rrf_score"],
                rrf_rank=item["final_rrf_rank"],
            )
        )
    assert len(result) == len({item.id for item in result})
    return trace, result


class ApiScores:
    def __init__(self, client: httpx.AsyncClient, model: str, scope: str):
        self.client, self.model, self.scope = client, model, scope
        self.metadata: dict[str, Any] = {}
        self.input_hash = ""

    async def predict(self, pairs: list[tuple[str, str]]) -> list[float]:
        assert len({query for query, _ in pairs}) == 1
        self.input_hash = hashlib.sha256(
            json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode()
        ).hexdigest()
        value = await request(
            self.client,
            f"compare-{self.scope}-{self.model[-2:].lower()}",
            {
                "model": self.model,
                "query": pairs[0][0],
                "documents": [text for _, text in pairs],
                "top_n": len(pairs),
                "return_documents": False,
            },
            "rerank",
        )
        self.metadata = value["metadata"]
        return scores(value["body"], len(pairs))


async def compare(client: httpx.AsyncClient, model: str, scope: str) -> dict[str, Any]:
    original, items = candidates(scope)
    trace = original["response"]["trace"]
    adapter = ApiScores(client, model, scope)
    ranked = await CrossEncoderReranker(adapter).rerank(
        trace["query"]["query_text"], items
    )
    before = {item["node_id"]: item["score_components"] for item in trace["reranked"]}
    target = original["targetId"]
    raw_rank = next(
        i + 1 for i, item in enumerate(ranked) if item.candidate.id == target
    )
    for item in ranked:
        component = before[item.candidate.id]
        # Preserve the original non-relevance signals and exact source-time
        # instant: changing the reranker must not also age the reference data.
        factor = (
            (1 + 0.2 * (component["recency"] - 0.5))
            * (1 + 0.2 * (component["temporal"] - 0.5))
            * (1 + 0.1 * (component["proof_norm"] - 0.5))
        )
        assert math.isclose(
            component["combined_score"],
            component["cross_encoder_score_normalized"] * factor,
            rel_tol=1e-12,
        )
        item.combined_score = item.cross_encoder_score_normalized * factor
    combined = sorted(ranked, key=lambda item: item.combined_score, reverse=True)
    final_rank = next(
        i + 1 for i, item in enumerate(combined) if item.candidate.id == target
    )
    target_score = next(
        item.cross_encoder_score for item in ranked if item.candidate.id == target
    )
    result = {
        "scope": scope,
        "model": model,
        "candidates": len(items),
        "inputSha256": adapter.input_hash,
        "targetId": target,
        "rawRank": raw_rank,
        "combinedRank": final_rank,
        "targetScore": target_score,
        "minimumScore": min(item.cross_encoder_score for item in ranked),
        "maximumScore": max(item.cross_encoder_score for item in ranked),
        "abovePoint99": sum(item.cross_encoder_score > 0.99 for item in ranked),
        "metadata": adapter.metadata,
        "nativePairFormatter": True,
        "historicalSecondarySignals": True,
        "topIds": [item.candidate.id for item in combined[:10]],
    }
    private_json(f"compare-{scope}-{model[-2:].lower()}-summary.json", result)
    event(
        "SILICONFLOW_CANDIDATE_COMPARISON",
        scope=scope,
        model=model,
        candidates=len(items),
        rawRank=raw_rank,
        combinedRank=final_rank,
        seconds=adapter.metadata["seconds"],
    )
    return result


async def main() -> None:
    key = credential()
    before = digest(SOURCE / "validation.sqlite")
    cases = []
    async with httpx.AsyncClient(
        headers={"Authorization": "Bearer " + key}, timeout=180, trust_env=False
    ) as client:
        for scope in ("character", "global"):
            for model in MODELS:
                cases.append(await compare(client, model, scope))
    for scope in ("character", "global"):
        assert (
            len({value["inputSha256"] for value in cases if value["scope"] == scope})
            == 1
        )
    assert digest(SOURCE / "validation.sqlite") == before
    private_json(
        "api-comparison-summary.json",
        {
            "cases": cases,
            "sourceDatabaseUnchanged": True,
            "sourceDatabaseSha256": before,
        },
    )
    event(
        "SILICONFLOW_COMPARISON_COMPLETE",
        cases=len(cases),
        sourceDatabaseUnchanged=True,
    )


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    allow_siliconflow()
    asyncio.run(main())
