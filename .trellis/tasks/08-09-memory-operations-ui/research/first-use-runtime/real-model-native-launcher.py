"""Task-only actual OpenAI Native launcher; content-free observations, existing stop ownership.

Secrets arrive only through env. This reuses the controlled launcher's socket/stop
hooks and permits only the configured HTTPS model host and its resolved addresses.
No response stream, native LLM implementation, extraction or recovery is replaced.
"""

from __future__ import annotations

import contextvars
import asyncio
import importlib.util
import json
import os
import socket
import time
import uuid
from functools import wraps
from pathlib import Path
from urllib.parse import urlsplit


def observe(record):
    try:
        with open(os.environ["TAKI_REAL_OBSERVATIONS"], "a", encoding="utf-8") as out:
            out.write(json.dumps({"at": time.time() * 1000, **record}) + "\n")
    except OSError:
        # Telemetry must not change a provider operation's result or exception.
        try:
            Path(os.environ["TAKI_REAL_OBSERVATIONS"] + ".incomplete").touch()
        except OSError:
            pass


def role_for_scope(scope):
    if str(scope).startswith("consolidation"):
        return "native_consolidation"
    if str(scope).startswith("retain"):
        return "native_extraction"
    return "native_other"


def failure_type(error):
    import httpx
    from openai import APIConnectionError, APITimeoutError
    for kind in (asyncio.CancelledError, httpx.ConnectTimeout, httpx.ReadTimeout,
                 httpx.WriteTimeout, httpx.PoolTimeout, httpx.ConnectError, httpx.ReadError,
                 httpx.WriteError, httpx.ProtocolError, APITimeoutError, APIConnectionError):
        if isinstance(error, kind):
            return kind.__name__
    return "Exception"


def install_observers():
    import httpx
    from hindsight_api.engine.embeddings import LocalSTEmbeddings
    from hindsight_api.engine.cross_encoder import LocalSTCrossEncoder
    from hindsight_api.engine.llm_wrapper import LLMProvider

    scope = contextvars.ContextVar("real_native_scope", default="verification_or_unknown")
    original_call = LLMProvider.call

    @wraps(original_call)
    async def call(self, *args, **kwargs):
        token = scope.set(kwargs.get("scope", args[4] if len(args) > 4 else "memory"))
        call_id = uuid.uuid4().hex
        role = role_for_scope(scope.get())
        observe({"event": "native_work_start", "id": call_id, "role": role, "scope": scope.get(),
                 "provider": self.provider, "model": self.model})
        try:
            value = await original_call(self, *args, **kwargs)
            observe({"event": "native_work_finish", "id": call_id, "role": role, "ok": True})
            return value
        except BaseException as error:
            observe({"event": "native_work_finish", "id": call_id, "role": role, "ok": False,
                     "errorType": failure_type(error)})
            raise
        finally:
            scope.reset(token)

    LLMProvider.call = call
    model_host = urlsplit(os.environ["HINDSIGHT_API_LLM_BASE_URL"]).hostname
    original_send = httpx.AsyncClient.send

    @wraps(original_send)
    async def send(self, request, *args, **kwargs):
        if request.url.host != model_host:
            return await original_send(self, request, *args, **kwargs)
        request_id = uuid.uuid4().hex
        role = role_for_scope(scope.get())
        observe({"event": "request_start", "id": request_id, "role": role, "scope": scope.get()})
        started = time.monotonic()
        try:
            response = await original_send(self, request, *args, **kwargs)
            usage = None
            model = None
            if response.is_stream_consumed:
                try:
                    body = response.json()
                    model = body.get("model")
                    reported = body.get("usage", {})
                    usage = {key: reported[key] for key in ("prompt_tokens", "completion_tokens", "total_tokens")
                             if type(reported.get(key)) is int and reported[key] >= 0} or None
                except (ValueError, httpx.ResponseNotRead, AttributeError):
                    pass
            observe({"event": "request_finish", "id": request_id, "role": role, "status": response.status_code,
                     "usage": usage, "model": model, "seconds": round(time.monotonic() - started, 3)})
            return response
        except BaseException as error:
            observe({"event": "request_finish", "id": request_id, "role": role, "status": None,
                     "usage": None, "errorType": failure_type(error),
                     "seconds": round(time.monotonic() - started, 3)})
            raise

    httpx.AsyncClient.send = send

    for cls, role in ((LocalSTEmbeddings, "embedding"), (LocalSTCrossEncoder, "reranker")):
        original_init = cls.initialize

        def init_hook(original, observed_role):
            @wraps(original)
            async def initialize(self, *args, **kwargs):
                result = await original(self, *args, **kwargs)
                observe({"event": "local_model_initialized", "role": observed_role,
                         "provider": self.provider_name, "class": type(self).__name__, "model": self.model_name,
                         "dimension": self.dimension if observed_role == "embedding" else None})
                return result
            return initialize

        cls.initialize = init_hook(original_init, role)

    original_encode = LocalSTEmbeddings._encode_local

    @wraps(original_encode)
    def encode(self, texts, *args, **kwargs):
        value = original_encode(self, texts, *args, **kwargs)
        observe({"event": "local_inference", "role": "embedding", "inputCount": len(texts),
                 "outputCount": len(value), "dimension": self.dimension})
        return value

    LocalSTEmbeddings._encode_local = encode
    original_predict = LocalSTCrossEncoder.predict

    @wraps(original_predict)
    async def predict(self, pairs, *args, **kwargs):
        value = await original_predict(self, pairs, *args, **kwargs)
        observe({"event": "local_inference", "role": "reranker", "inputCount": len(pairs), "outputCount": len(value)})
        return value

    LocalSTCrossEncoder.predict = predict


def main():
    archived = Path(__file__).parents[3] / "archive/2026-09/09-25-hindsight-native-smoke/research/native_launcher.py"
    spec = importlib.util.spec_from_file_location("controlled_native_launcher", archived)
    launcher = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(launcher)
    endpoint = urlsplit(os.environ["HINDSIGHT_API_LLM_BASE_URL"])
    if endpoint.scheme != "https" or not endpoint.hostname:
        raise RuntimeError("REAL_MODEL_HTTPS_REQUIRED")
    port = endpoint.port or 443
    hosts = {endpoint.hostname, *(entry[4][0] for entry in socket.getaddrinfo(endpoint.hostname, port, type=socket.SOCK_STREAM))}
    original_check = launcher._check_connect
    original_audit = launcher._audit

    def check(event, host, number):
        host, number = launcher._normalize(host, number)
        if host in hosts and number == port:
            return
        original_check(event, host, number)

    def audit(event, arguments):
        if event == "socket.getaddrinfo":
            host, number = launcher._normalize(arguments[0], arguments[1])
            if host in hosts and number == port:
                return
        original_audit(event, arguments)

    launcher._check_connect = check
    launcher._audit = audit
    install_observers()
    launcher.main()


if __name__ == "__main__":
    main()
