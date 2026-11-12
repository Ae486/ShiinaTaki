"""Frozen native wire examples and deterministic HTTP protocol behavior."""

from copy import deepcopy
import hashlib
import json
from pathlib import Path

import httpx

from media_service_bridge.config import BridgeConfig


GOLDEN = json.loads(Path(__file__).with_name("bilinote-golden.json").read_text(encoding="utf-8"))
INSTANCE = GOLDEN["identity"]["service_instance_id"]
REQUEST = GOLDEN["identity"]["request_id"]
JOB = GOLDEN["identity"]["job_id"]
URL = "https://www.bilibili.com/video/BVfixture"


def config(**changes):
    return BridgeConfig.from_document({"backend_url": "http://127.0.0.1:8483", "expected_service_instance_id": INSTANCE,
        "provider_id": "fixture", "model_name": "deepseek-flash", **changes})


class NativeStub:
    def __init__(self):
        self.calls = []
        self.result = deepcopy(GOLDEN["result"])
        self.body_override = None
        self.response_hook = None
        self.state = "succeeded"
        self.availability = "available"
        self.lost_submit = False

    def content(self):
        return json.dumps(self.result, ensure_ascii=False, sort_keys=True, allow_nan=False).encode("utf-8")

    def receipt(self, reused=True):
        return {"schema_version": "bilinote.request-receipt.v1", "task_id": JOB, "identity": GOLDEN["identity"],
            "request_digest": GOLDEN["generation_digest"], "request_digest_version": 1,
            "disposition": "succeeded" if reused else "reserved", "reused": reused}

    def probe(self):
        return {"schema_version": "bilinote.media-access.v1", "service_instance_id": INSTANCE,
            "source": {"platform": "bilibili", "bvid": "BVfixture", "cid": "222", "page": 1,
                "canonical_url": URL + "?p=1"}, "title": "Fixture video", "duration_seconds": 240,
            "access": {"kind": "video_range", "byte_length": 1024, "checked_at": 1792200000000}}

    def status(self):
        return {"schema_version": "bilinote.job-status.v1", "identity": GOLDEN["identity"], "state": self.state,
            "result": {"availability": self.availability, "artifact": {
                "read_path": f"/api/media/v1/jobs/{JOB}/result", "sha256": hashlib.sha256(self.content()).hexdigest(),
                "byte_length": len(self.content()), "artifact_id": "complete_result", "schema_version": "bilinote.media-result.v1",
                "media_type": "application/json"} if self.availability == "available" else None},
            "stage": None, "completed_at_utc": "2026-10-13T01:02:03Z" if self.state == "succeeded" else None,
            "error": {"code": "native_execution_unknown", "message": "Native request did not produce a confirmed result"} if self.state == "unknown" else None}

    async def __call__(self, request):
        self.calls.append(request)
        if self.response_hook:
            special = await self.response_hook(request)
            if special is not None:
                return special
        if request.url.path.endswith("/instance"):
            return httpx.Response(200, json={"schema_version": "bilinote.service.v1", "service_instance_id": INSTANCE,
                "request_contract": "bilinote.request.v1"})
        if request.url.path.endswith("/probe"):
            return httpx.Response(200, json=self.probe())
        if request.url.path.endswith("/generate_note"):
            if self.lost_submit:
                raise httpx.ReadError("fixture response lost after native reservation")
            return httpx.Response(202, json={"code": 0, "msg": "success", "data": self.receipt(reused=False)})
        if "/requests/" in request.url.path:
            return httpx.Response(200, json=self.receipt())
        if request.url.path.endswith("/result"):
            body = self.body_override if self.body_override is not None else self.content()
            return httpx.Response(200, content=body, headers={"Content-Type": "application/json",
                "ETag": '"' + hashlib.sha256(self.content()).hexdigest() + '"'})
        return httpx.Response(503 if self.state == "unknown" else 200, json=self.status())
