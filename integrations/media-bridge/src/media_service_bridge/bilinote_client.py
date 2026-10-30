"""One fixed native HTTP client; no queue, result store or native engine import.

Caller-retained request identity is the recovery handle for ambiguous submission.
Every result read revalidates native binding and exact decompressed JSON bytes.
"""

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
import hashlib
import os
import re
from urllib.parse import urlencode

import httpx

from .config import BridgeConfig
from .contracts import (BridgeError, NativeBinding, NATIVE_CODES, digest_text, json_object, receipt_binding,
    canonical_video_url, safe_status, uuid_text, validate, validate_result, validate_status)
from .media_access import validate_media_access


PRE_ADMISSION_ERRORS = {"invalid_native_request", "unsupported_request_input", "request_conflict",
    "service_instance_mismatch", "native_schema_required", "native_storage_unsupported", "native_not_ready",
    "native_owner_unavailable", "native_artifact_conflict"}


@dataclass(frozen=True)
class CompleteResult:
    binding: NativeBinding
    sha256: str
    content: bytes
    value: dict

    @property
    def resource_uri(self):
        return f"bilinote://{self.binding.service_instance_id}/{self.binding.request_id}/{self.binding.job_id}/{self.sha256}"

    def preview(self, limit: int = 2000):
        markdown = self.value["analysis"]["markdown"]
        return {"ok": True, "identity": self.binding.identity(), "complete": False,
            "source": self.value["source"], "duration": self.value["duration"],
            "markdown_preview": markdown[:limit], "markdown_truncated": len(markdown) > limit,
            "transcript_segments": len(self.value["text_evidence"]["segments"]),
            "artifact": {"resource_uri": self.resource_uri, "sha256": self.sha256,
                "byte_length": len(self.content), "media_type": "application/json", "complete": True}}


class BiliNoteClient:
    def __init__(self, config: BridgeConfig, *, transport=None, environment=None):
        self.config = config
        self.closed = False
        self._close_task = None
        self._retry_transport_close = False
        headers = {"Accept": "application/json"}
        if config.auth_token_env is not None:
            token = (os.environ if environment is None else environment).get(config.auth_token_env)
            if not isinstance(token, str) or not token or "\r" in token or "\n" in token:
                raise BridgeError("invalid_bridge_config")
            headers["Authorization"] = "Bearer " + token
        self._transport = transport if transport is not None else httpx.AsyncHTTPTransport(retries=0, trust_env=False)
        self._http = httpx.AsyncClient(base_url=config.backend_url, transport=self._transport, headers=headers,
            follow_redirects=False, trust_env=False, timeout=httpx.Timeout(config.total_timeout_seconds))

    async def close(self):
        # Sealing business requests and finishing cleanup are different facts.
        # All callers share one shielded cleanup task. A failed attempt may be
        # retried; a cancelled waiter cannot cancel the underlying cleanup.
        self.closed = True
        task = self._close_task
        if task is None or (task.done() and (task.cancelled() or task.exception() is not None)):
            task = asyncio.create_task(self._close_owned_transport())
            self._close_task = task
            task.add_done_callback(lambda completed: None if completed.cancelled() else completed.exception())
        await asyncio.shield(task)

    async def _close_owned_transport(self):
        try:
            if self._retry_transport_close:
                # httpx 0.28.1 sets ClientState.CLOSED *before* awaiting the
                # owned transport. Calling its aclose again after failure is a
                # no-op, so retry our explicit transport reference instead.
                await self._transport.aclose()
            else:
                await self._http.aclose()
        except BaseException:
            self._retry_transport_close = True
            raise

    @asynccontextmanager
    async def _within_deadline(self):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + self.config.total_timeout_seconds
        async with asyncio.timeout_at(deadline):
            yield
            # Parsing/schema/hash work is synchronous: it can finish after the
            # timer deadline without yielding to its cancellation callback.
            # Refuse late success explicitly. This does not preempt CPU work.
            if loop.time() >= deadline:
                raise TimeoutError("Native operation deadline expired")

    async def _wire(self, method, route, *, body=None, result=False, snapshot=False):
        if self.closed:
            raise BridgeError("bridge_closed")
        cap = self.config.result_response_bytes if result else self.config.control_response_bytes
        try:
            async with self._http.stream(method, route, json=body) as response:
                chunks, length = [], 0
                # Count decompressed bytes: GZip Content-Length is not the B3
                # complete-artifact descriptor and cannot replace this check.
                async for chunk in response.aiter_bytes():
                    length += len(chunk)
                    if length > cap:
                        raise BridgeError("result_too_large" if result else "native_response_invalid")
                    chunks.append(chunk)
                content = b"".join(chunks)
                if response.status_code in {401, 403}:
                    raise BridgeError("native_unauthorized")
                if response.status_code not in {200, 202}:
                    try:
                        error = json_object(content)
                        if snapshot and response.status_code in {404, 503} and error.get("schema_version") == "bilinote.job-status.v1":
                            if response.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
                                raise BridgeError("native_response_invalid")
                            return response.status_code, response.headers, content
                        detail = error.get("detail")
                        if isinstance(detail, dict):
                            detail = detail.get("code")
                        code = detail if isinstance(detail, str) and detail in NATIVE_CODES else None
                    except BridgeError:
                        code = None
                    if code is not None:
                        raise BridgeError(code)
                    if method == "POST":
                        raise BridgeError("submission_outcome_unknown")
                    raise BridgeError("native_unavailable")
                if response.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
                    raise BridgeError("native_response_invalid")
                return response.status_code, response.headers, content
        except httpx.HTTPError as exc:
            raise BridgeError("native_unavailable") from exc

    async def get_instance(self):
        try:
            async with self._within_deadline():
                _code, _headers, body = await self._wire("GET", "api/media/v1/instance")
                value = json_object(body)
                validate("instance", value)
                if value["service_instance_id"] != self.config.expected_service_instance_id:
                    raise BridgeError("native_binding_mismatch")
                return value
        except TimeoutError as exc:
            raise BridgeError("native_unavailable") from exc

    async def submit(self, request_id: str, video_url: str, *, output_format=None, video_understanding=None):
        request = uuid_text(request_id)
        values, digest = self.config.generation_input(video_url, output_format=output_format, video_understanding=video_understanding)
        if self.closed:
            raise BridgeError("bridge_closed", request_id=request)
        try:
            async with self._within_deadline():
                code, _headers, body = await self._wire("POST", "api/generate_note", body={**values,
                    "client_request_id": request, "expected_service_instance_id": self.config.expected_service_instance_id})
                envelope = json_object(body)
                if (set(envelope) != {"code", "msg", "data"} or type(envelope["code"]) is not int
                        or envelope["code"] != 0 or not isinstance(envelope["msg"], str)):
                    raise BridgeError("native_response_invalid")
                receipt = envelope["data"]
                receipt_binding(receipt, self.config.expected_service_instance_id, request, digest=digest)
                if receipt["reused"] is not (code == 200):
                    raise BridgeError("native_response_invalid")
                return receipt
        except (TimeoutError, asyncio.CancelledError) as exc:
            raise BridgeError("submission_outcome_unknown", request_id=request) from exc
        except BridgeError as exc:
            # Once POST is dispatched, malformed/lost success or store failure
            # is ambiguous. Preserve the original key and never send another.
            code = exc.code if exc.code in PRE_ADMISSION_ERRORS | {"native_unauthorized"} else "submission_outcome_unknown"
            raise BridgeError(code, request_id=request) from exc

    async def probe_media(self, video_url: str):
        canonical = canonical_video_url(video_url)
        query = urlencode({"video_url": canonical,
            "expected_service_instance_id": self.config.expected_service_instance_id})
        try:
            async with self._within_deadline():
                code, _headers, body = await self._wire("GET", "api/media/v1/probe?" + query)
                if code != 200:
                    raise BridgeError("native_response_invalid")
                value = json_object(body)
                validate_media_access(value, self.config.expected_service_instance_id, canonical)
                return value
        except TimeoutError as exc:
            raise BridgeError("native_unavailable") from exc

    async def _lookup(self, request: str):
        route = f"api/media/v1/requests/{request}?expected_service_instance_id={self.config.expected_service_instance_id}"
        code, _headers, body = await self._wire("GET", route)
        if code != 200:
            raise BridgeError("native_response_invalid")
        receipt = json_object(body)
        binding = receipt_binding(receipt, self.config.expected_service_instance_id, request)
        if receipt["reused"] is not True:
            raise BridgeError("native_response_invalid")
        return receipt, binding

    async def lookup_request(self, request_id: str):
        request = uuid_text(request_id)
        try:
            async with self._within_deadline():
                value, _binding = await self._lookup(request)
                return value
        except TimeoutError as exc:
            raise BridgeError("native_unavailable", request_id=request) from exc

    async def _status(self, request: str, job: str):
        _receipt, binding = await self._lookup(request)
        if binding.job_id != job:
            raise BridgeError("native_binding_mismatch", request_id=request)
        code, _headers, body = await self._wire("GET", f"api/media/v1/jobs/{job}", snapshot=True)
        if code not in {200, 404, 503}:
            raise BridgeError("native_response_invalid")
        value = json_object(body)
        validate_status(value, binding)
        if (value["state"] == "unknown") != (code == 503) or (value["state"] == "not_found") != (code == 404):
            raise BridgeError("native_response_invalid")
        return value, binding

    async def get_status(self, request_id: str, job_id: str):
        request, job = uuid_text(request_id), uuid_text(job_id)
        try:
            async with self._within_deadline():
                value, _binding = await self._status(request, job)
                return safe_status(value)
        except TimeoutError as exc:
            raise BridgeError("native_unavailable", request_id=request) from exc

    async def read_result(self, request_id: str, job_id: str, *, expected_sha256=None):
        request, job = uuid_text(request_id), uuid_text(job_id)
        if expected_sha256 is not None:
            digest_text(expected_sha256)
        try:
            async with self._within_deadline():
                status, binding = await self._status(request, job)
                if status["state"] != "succeeded" or status["result"]["availability"] != "available":
                    raise BridgeError("result_not_available", request_id=request)
                descriptor = status["result"]["artifact"]
                if descriptor["byte_length"] > self.config.result_response_bytes:
                    raise BridgeError("result_too_large", request_id=request)
                if expected_sha256 is not None and descriptor["sha256"] != expected_sha256:
                    raise BridgeError("result_integrity_mismatch", request_id=request)
                code, headers, content = await self._wire("GET", f"api/media/v1/jobs/{job}/result", result=True)
                actual_sha = hashlib.sha256(content).hexdigest()
                if (code != 200 or len(content) != descriptor["byte_length"] or actual_sha != descriptor["sha256"]
                        or (headers.get("etag") is not None and headers["etag"] != f'"{actual_sha}"')):
                    raise BridgeError("result_integrity_mismatch", request_id=request)
                value = json_object(content)
                validate_result(value, binding)
                return CompleteResult(binding, actual_sha, content, value)
        except TimeoutError as exc:
            raise BridgeError("native_unavailable", request_id=request) from exc

    async def read_resource(self, uri: str):
        match = re.fullmatch(r"bilinote://([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f-]{36})/([0-9a-f]{64})", uri)
        if match is None or match[1] != self.config.expected_service_instance_id:
            raise BridgeError("invalid_bridge_input")
        return await self.read_result(match[2], match[3], expected_sha256=match[4])
