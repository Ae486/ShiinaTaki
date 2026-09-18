"""Private, owner-authorized SiliconFlow probes with content-free public results."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import socket
import sys
import time
from pathlib import Path
from typing import Any

import httpx

TAKI = Path("H:/TakiAgent")
ROOT = TAKI / ".trellis/.runtime/d77-api-acceptance/ca744d0f8a27"
SOURCE = TAKI / ".trellis/.runtime/d77-acceptance/9e41c8d27fa0"
HELPERS = TAKI / ".trellis/tasks/08-09-hindsight-initial-cutover/research/validation"
BASE_URL = "https://api.siliconflow.cn/v1"
MODELS = ("Qwen/Qwen3-Reranker-8B", "Qwen/Qwen3-Reranker-4B")
EMBEDDING = "Qwen/Qwen3-Embedding-8B"
sys.path.insert(0, str(HELPERS))
from real_hindsight_environment import crypt_bytes  # noqa: E402
from real_hindsight_network import install_guard  # noqa: E402


def credential() -> str:
    for path in (ROOT, *ROOT.parents):
        if path.lstat().st_file_attributes & 0x400:
            raise RuntimeError("D77_API_LINK_REFUSED")
    value = json.loads(
        crypt_bytes((ROOT / "siliconflow-credential.dpapi").read_bytes(), decrypt=True)
    )
    if value.get("run_id") != ROOT.name or value.get("endpoint") != BASE_URL:
        raise RuntimeError("D77_API_CREDENTIAL_OWNER_REFUSED")
    return value["api_key"]


def private_json(name: str, value: Any) -> None:
    if not name.endswith(".json") or any(
        c not in "abcdefghijklmnopqrstuvwxyz0123456789-." for c in name
    ):
        raise RuntimeError("D77_API_ARTIFACT_NAME_REFUSED")
    (ROOT / name).write_text(
        json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )


def event(code: str, **detail: Any) -> None:
    line = json.dumps({"at": time.time(), "code": code, **detail}, allow_nan=False)
    with (ROOT / "api-events.jsonl").open("a", encoding="utf-8") as stream:
        stream.write(line + "\n")
    print(line, flush=True)


def allow_siliconflow() -> None:
    # Resolve the one authorized host before installing the existing socket guard.
    addresses = {"api.siliconflow.cn"}
    addresses.update(
        str(info[4][0])
        for info in socket.getaddrinfo(
            "api.siliconflow.cn", 443, type=socket.SOCK_STREAM
        )
    )
    install_guard(None, None, model_access=False).update(addresses)


async def request(
    client: httpx.AsyncClient, name: str, body: dict[str, Any], path: str
) -> dict[str, Any]:
    if path not in ("embeddings", "rerank") or body.get("model") not in (
        *MODELS,
        EMBEDDING,
    ):
        raise RuntimeError("D77_API_REQUEST_REFUSED")
    started = time.monotonic()
    response = await client.post(f"{BASE_URL}/{path}", json=body)
    value = response.json()
    metadata = {
        "status": response.status_code,
        "seconds": round(time.monotonic() - started, 3),
        "requestedModel": body["model"],
        "responseModel": value.get("model") if isinstance(value, dict) else None,
        "usage": value.get("usage") if isinstance(value, dict) else None,
        "meta": value.get("meta") if isinstance(value, dict) else None,
    }
    private_json(
        name + ".json", {"request": body, "response": value, "metadata": metadata}
    )
    event("SILICONFLOW_RESPONSE", **metadata)
    if response.status_code != 200:
        raise RuntimeError("D77_API_RESPONSE_FAILED")
    return {"body": value, "metadata": metadata}


def scores(value: dict[str, Any], count: int) -> list[float]:
    results = value.get("results")
    if not isinstance(results, list) or len(results) != count:
        raise RuntimeError("D77_API_RERANK_COVERAGE_INVALID")
    indexed = {item["index"]: item["relevance_score"] for item in results}
    if set(indexed) != set(range(count)) or len(indexed) != count:
        raise RuntimeError("D77_API_RERANK_INDICES_INVALID")
    result = [indexed[index] for index in range(count)]
    if any(
        type(value) not in (int, float)
        or not math.isfinite(value)
        or not 0 <= value <= 1
        for value in result
    ):
        raise RuntimeError("D77_API_RERANK_SCORES_INVALID")
    return result


async def probe() -> None:
    key = credential()
    documents = [
        "用户偏好简洁、直接的中文工作汇报。",
        "周末适合去公园散步。",
        "数据库支持事务和索引。",
    ]
    summary = []
    async with httpx.AsyncClient(
        headers={"Authorization": "Bearer " + key}, timeout=180, trust_env=False
    ) as client:
        for model in MODELS:
            value = await request(
                client,
                "probe-reranker-" + model[-2:].lower(),
                {
                    "model": model,
                    "query": "用户喜欢怎样的工作汇报？",
                    "documents": documents,
                    "top_n": len(documents),
                    "return_documents": False,
                },
                "rerank",
            )
            ranking = scores(value["body"], len(documents))
            assert max(range(len(ranking)), key=ranking.__getitem__) == 0
            summary.append(
                {**value["metadata"], "expectedFirst": True, "scores": ranking}
            )
        value = await request(
            client,
            "probe-embedding",
            {"model": EMBEDDING, "input": documents, "encoding_format": "float"},
            "embeddings",
        )
        vectors = sorted(value["body"]["data"], key=lambda item: item["index"])
        assert [item["index"] for item in vectors] == list(range(len(documents)))
        dimensions = {len(item["embedding"]) for item in vectors}
        assert len(dimensions) == 1 and next(iter(dimensions)) > 0
        assert all(
            type(number) in (int, float) and math.isfinite(number)
            for item in vectors
            for number in item["embedding"]
        )
        summary.append(
            {
                **value["metadata"],
                "dimensions": next(iter(dimensions)),
                "vectors": len(vectors),
                "finite": True,
            }
        )
    private_json("api-probe-summary.json", summary)
    event(
        "SILICONFLOW_PROBE_COMPLETE",
        rerankers=2,
        embeddingDimensions=summary[-1]["dimensions"],
    )


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    allow_siliconflow()
    asyncio.run(probe())
