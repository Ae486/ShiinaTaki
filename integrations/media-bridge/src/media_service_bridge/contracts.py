"""Frozen native wire contracts, exact identities and bounded public failures.

The bundled schema is a versioned transport artifact. This package never imports
native application modules, database models, provider code or Agent state.
"""

from dataclasses import dataclass
from datetime import datetime
import hashlib
from importlib.resources import files
import json
import math
import re
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

from jsonschema import Draft202012Validator


BUNDLE = json.loads(files(__package__).joinpath("schemas/bilinote-v1.json").read_text(encoding="utf-8"))
VALIDATORS = {name: Draft202012Validator(schema) for name, schema in BUNDLE["schemas"].items()}
NATIVE_CODES = frozenset(BUNDLE["safe_error_codes"])
LOCAL_CODES = frozenset({"invalid_bridge_input", "invalid_bridge_config", "native_unavailable", "native_unauthorized",
    "native_response_invalid", "native_binding_mismatch", "submission_outcome_unknown", "result_too_large",
    "result_not_available", "result_integrity_mismatch", "bridge_closed"})


class BridgeError(RuntimeError):
    def __init__(self, code: str, *, request_id: str | None = None):
        self.code = code if code in LOCAL_CODES | NATIVE_CODES else "native_unavailable"
        self.request_id = request_id
        super().__init__(self.code)

    def public(self) -> dict:
        value = {"ok": False, "error": {"code": self.code, "message": "Native media operation could not be confirmed"}}
        if self.request_id is not None:
            value["request_id"] = self.request_id
        return value


def uuid_text(value) -> str:
    try:
        if not isinstance(value, str):
            raise ValueError
        return str(UUID(value))
    except (ValueError, AttributeError) as exc:
        raise BridgeError("invalid_bridge_input") from exc


def digest_text(value) -> str:
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{64}", value) is None:
        raise BridgeError("native_response_invalid")
    return value


def _finite(value, depth=0):
    if depth > 80:
        raise ValueError("JSON nesting exceeds the wire limit")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Nonfinite JSON number")
    if isinstance(value, dict):
        for child in value.values():
            _finite(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            _finite(child, depth + 1)


def json_object(content: bytes) -> dict:
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("Duplicate JSON key")
            value[key] = item
        return value
    try:
        value = json.loads(content.decode("utf-8"), object_pairs_hook=pairs)
        if not isinstance(value, dict):
            raise ValueError("Expected JSON object")
        _finite(value)
        return value
    except (ValueError, RecursionError, UnicodeError) as exc:
        raise BridgeError("native_response_invalid") from exc


def validate(kind: str, value: dict) -> None:
    try:
        _finite(value)
        if next(VALIDATORS[kind].iter_errors(value), None) is not None:
            raise ValueError("Native wire schema mismatch")
    except (ValueError, TypeError, RecursionError) as exc:
        raise BridgeError("native_response_invalid") from exc


@dataclass(frozen=True)
class NativeBinding:
    service_instance_id: str
    request_id: str
    job_id: str

    def __post_init__(self):
        try:
            for value in (self.service_instance_id, self.request_id, self.job_id):
                if uuid_text(value) != value:
                    raise BridgeError("native_binding_mismatch")
        except BridgeError as exc:
            raise BridgeError("native_binding_mismatch") from exc

    def identity(self):
        return {"service_instance_id": self.service_instance_id, "request_id": self.request_id, "job_id": self.job_id}

    def verify(self, identity):
        if identity != self.identity():
            raise BridgeError("native_binding_mismatch", request_id=self.request_id)


def receipt_binding(value: dict, instance: str, request: str, *, digest=None) -> NativeBinding:
    validate("receipt", value)
    identity = value["identity"]
    if (set(identity) != {"service_instance_id", "request_id", "job_id"}
            or identity["service_instance_id"] != instance or identity["request_id"] != request
            or value["task_id"] != identity["job_id"]):
        raise BridgeError("native_binding_mismatch", request_id=request)
    digest_text(value["request_digest"])
    if digest is not None and value["request_digest"] != digest:
        raise BridgeError("native_binding_mismatch", request_id=request)
    return NativeBinding(instance, request, identity["job_id"])


def validate_status(value: dict, binding: NativeBinding) -> None:
    validate("status", value)
    binding.verify(value["identity"])
    if value.get("completed_at_utc") is not None:
        try:
            at = datetime.fromisoformat(value["completed_at_utc"].replace("Z", "+00:00"))
            if at.tzinfo is None:
                raise ValueError
        except ValueError as exc:
            raise BridgeError("native_response_invalid") from exc
    artifact = value["result"].get("artifact")
    if artifact is not None:
        digest_text(artifact["sha256"])
        if (type(artifact["byte_length"]) is not int or artifact["byte_length"] <= 0
                or artifact["read_path"] != f"/api/media/v1/jobs/{binding.job_id}/result"):
            raise BridgeError("native_response_invalid")
    if value["result"]["availability"] == "available" and (value["state"] != "succeeded" or artifact is None):
        raise BridgeError("native_response_invalid")


def safe_status(value: dict) -> dict:
    # Status diagnostics are protocol facts, not a channel for raw upstream
    # exception strings, headers or configuration. Content is read separately.
    result = dict(value)
    if result.get("error") is not None:
        code = result["error"]["code"]
        result["error"] = {"code": code if code in NATIVE_CODES else "native_unavailable",
            "message": "Native job did not produce a confirmed available result"}
    return result


def validate_result(value: dict, binding: NativeBinding) -> None:
    validate("result", value)
    binding.verify(value["identity"])
    duration = value["duration"]["seconds"]
    for segment in value["text_evidence"]["segments"]:
        start, end = segment["start_seconds"], segment["end_seconds"]
        if end is not None and (start is None or end < start):
            raise BridgeError("native_response_invalid")
        if duration is not None and any(at is not None and at > duration for at in (start, end)):
            raise BridgeError("native_response_invalid")
    source = value["source"]
    resolved = source.get("resolved")
    if source["binding"] == "exact" and resolved is None:
        raise BridgeError("native_response_invalid")
    if resolved is not None:
        expected = f"https://www.bilibili.com/video/{resolved['bvid']}?p={resolved['page']}"
        if source.get("requested_url") not in {None, expected}:
            raise BridgeError("native_response_invalid")
    moments = value["analysis"].get("moments")
    if value["analysis"]["format"] == "media_v1" and (moments is None or source["binding"] != "exact"):
        raise BridgeError("native_response_invalid")
    for moment in moments or []:
        start, end = moment["at_seconds"], moment.get("end_seconds")
        if end is not None and end < start:
            raise BridgeError("native_response_invalid")
        if duration is not None and any(at is not None and at > duration for at in (start, end)):
            raise BridgeError("native_response_invalid")


def canonical_video_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        match = re.fullmatch(r"/video/(BV[0-9A-Za-z]+)(?:/p([1-9][0-9]*))?/?", parsed.path)
        if parsed.scheme not in {"http", "https"} or parsed.netloc not in {"bilibili.com", "www.bilibili.com"} or match is None:
            raise ValueError
        pages = parse_qs(parsed.query, keep_blank_values=True).get("p")
        if pages is not None and (len(pages) != 1 or re.fullmatch(r"[1-9][0-9]*", pages[0]) is None):
            raise ValueError
        query, suffix = int(pages[0]) if pages else None, int(match[2]) if match[2] else None
        if query is not None and suffix is not None and query != suffix:
            raise ValueError
        return f"https://www.bilibili.com/video/{match[1]}?p={query or suffix or 1}"
    except (ValueError, TypeError, AttributeError) as exc:
        raise BridgeError("invalid_bridge_input") from exc


def generation_digest(value: dict) -> str:
    try:
        validate("input", value)
    except BridgeError as exc:
        raise BridgeError("invalid_bridge_input") from exc
    # JSON Schema treats integral floats as integers. Native strict Python
    # validation does not, and its canonical request digest preserves the
    # numeric representation. Refuse before dispatch instead of coercing it.
    if type(value["video_interval"]) is not int or any(type(size) is not int for size in value["grid_size"]):
        raise BridgeError("invalid_bridge_input")
    for key in ("model_name", "provider_id"):
        if not value[key].strip():
            raise BridgeError("invalid_bridge_input")
    content = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(("bilinote.request.v1\n" + content).encode("utf-8")).hexdigest()
