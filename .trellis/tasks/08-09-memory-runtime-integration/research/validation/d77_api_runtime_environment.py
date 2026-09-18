"""Narrow process-only model configuration and observation for the copied API target."""

from __future__ import annotations

import json
import socket
import time
from functools import wraps
from pathlib import Path
from typing import Any

from d77_siliconflow_api import BASE_URL, MODELS, ROOT, credential, digest
from real_hindsight_environment import model_environment as baseline_environment
from real_hindsight_network import (
    failure_type,
    install_guard,
    observation_failed,
    usage_count,
    write_observation,
)


def model_environment(root: Path) -> dict[str, str]:
    assert root == ROOT
    result = baseline_environment(root)
    cache = ROOT.parents[1] / "b6-continuation-20260911/tokenizer-cache"
    assert (
        digest(cache / "9b5ad71b2ce5302211f9c61530b329a4922fc6a4")
        == "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
    )
    result.update(
        {
            "NO_PROXY": "api.deepseek.com,api.siliconflow.cn,127.0.0.1,localhost,::1",
            "TIKTOKEN_CACHE_DIR": str(cache),
            "HINDSIGHT_API_RERANKER_PROVIDER": "siliconflow",
            "HINDSIGHT_API_RERANKER_SILICONFLOW_API_KEY": credential(),
            "HINDSIGHT_API_RERANKER_SILICONFLOW_MODEL": MODELS[1],
            "HINDSIGHT_API_RERANKER_SILICONFLOW_BASE_URL": BASE_URL,
            "HINDSIGHT_API_REFLECT_MAX_ITERATIONS": "4",
            "HINDSIGHT_API_REFLECT_WALL_TIMEOUT": "300",
        }
    )
    return result


def extended_guard(
    pg_port: int | None, listener: socket.socket | None, *, model_access: bool
) -> set[str]:
    addresses = {"api.siliconflow.cn"} if model_access else set()
    if model_access:
        addresses.update(
            str(info[4][0])
            for info in socket.getaddrinfo(
                "api.siliconflow.cn", 443, type=socket.SOCK_STREAM
            )
        )
    admitted = install_guard(pg_port, listener, model_access=model_access)
    admitted.update(addresses)
    return admitted


def observe_siliconflow(root: Path) -> None:
    import httpx

    original = httpx.AsyncClient.send

    @wraps(original)
    async def send(self: Any, request: Any, *args: Any, **kwargs: Any) -> Any:
        if request.url.host != "api.siliconflow.cn":
            return await original(self, request, *args, **kwargs)
        started = time.monotonic()
        record: dict[str, Any] = {
            "at": time.time(),
            "provider": "siliconflow",
            "path": "/v1/rerank",
            "status": None,
            "requested_model": None,
            "model": None,
            "usage": None,
            "seconds": None,
            "error_type": None,
        }
        try:
            body = json.loads(request.content)
            if body.get("model") in MODELS:
                record["requested_model"] = body["model"]
        except BaseException:
            observation_failed(root, "metadata")
        try:
            response = await original(self, request, *args, **kwargs)
        except BaseException as error:
            record["error_type"] = failure_type(error)
            raise
        else:
            try:
                record["status"] = response.status_code
                if response.is_stream_consumed:
                    value = response.json()
                    if isinstance(value, dict):
                        record["model"] = (
                            value.get("model") if value.get("model") in MODELS else None
                        )
                        counts = value.get("meta", {}).get("tokens", {})
                        record["usage"] = {
                            key: count
                            for key in ("input_tokens", "output_tokens", "image_tokens")
                            if (count := usage_count(counts.get(key))) is not None
                        } or None
            except BaseException:
                observation_failed(root, "metadata")
            return response
        finally:
            record["seconds"] = round(time.monotonic() - started, 3)
            write_observation(root, record)

    setattr(httpx.AsyncClient, "send", send)
