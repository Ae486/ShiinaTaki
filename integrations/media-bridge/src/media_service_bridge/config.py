"""Operator-only immutable native endpoint/profile selection for one process."""

from dataclasses import dataclass
import ipaddress
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from .contracts import BridgeError, canonical_video_url, generation_digest, json_object, uuid_text


DEFAULTS = {"quality": "medium", "screenshot": False, "link": False, "format": [], "style": None,
    "extras": None, "video_understanding": False, "video_interval": 0, "grid_size": [], "output_format": "media_v1"}


@dataclass(frozen=True)
class BridgeConfig:
    backend_url: str
    expected_service_instance_id: str
    provider_id: str
    model_name: str
    profile_json: str
    auth_token_env: str | None = None
    total_timeout_seconds: float = 30
    control_response_bytes: int = 131072
    result_response_bytes: int = 16777216

    @classmethod
    def from_file(cls, path: Path):
        return cls.from_document(json_object(path.read_bytes()))

    @classmethod
    def from_document(cls, value: dict):
        allowed = {"backend_url", "expected_service_instance_id", "provider_id", "model_name", "generation_defaults",
            "auth_token_env", "total_timeout_seconds", "control_response_bytes", "result_response_bytes"}
        try:
            if not isinstance(value, dict) or set(value) - allowed:
                raise ValueError
            endpoint = urlsplit(value["backend_url"])
            if (endpoint.scheme not in {"http", "https"} or not endpoint.hostname or endpoint.username is not None
                    or endpoint.password is not None or endpoint.query or endpoint.fragment or endpoint.port == 0):
                raise ValueError
            if endpoint.scheme == "http" and endpoint.hostname != "localhost":
                if not ipaddress.ip_address(endpoint.hostname).is_loopback:
                    raise ValueError
            selected = value.get("generation_defaults", {})
            if not isinstance(selected, dict) or set(selected) - DEFAULTS.keys():
                raise ValueError
            profile = {**DEFAULTS, **selected, "platform": "bilibili", "model_name": value.get("model_name", "deepseek-flash"),
                "provider_id": value["provider_id"]}
            generation_digest({**profile, "video_url": "https://www.bilibili.com/video/BVfixture?p=1"})
            timeout = value.get("total_timeout_seconds", 30)
            if type(timeout) not in {int, float} or not 0 < timeout <= 3600:
                raise ValueError
            caps = [value.get("control_response_bytes", 131072), value.get("result_response_bytes", 16777216)]
            if any(type(cap) is not int or not 1 <= cap <= 67108864 for cap in caps):
                raise ValueError
            token = value.get("auth_token_env")
            if token is not None and (not isinstance(token, str) or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", token) is None):
                raise ValueError
            return cls(value["backend_url"].rstrip("/") + "/", uuid_text(value["expected_service_instance_id"]),
                profile["provider_id"], profile["model_name"], json.dumps(profile, allow_nan=False), token, timeout, *caps)
        except (ValueError, KeyError, TypeError, AttributeError, BridgeError) as exc:
            raise BridgeError("invalid_bridge_config") from exc

    def generation_input(self, video_url, *, output_format=None, video_understanding=None):
        value = {**json.loads(self.profile_json), "video_url": canonical_video_url(video_url)}
        if output_format is not None:
            value["output_format"] = output_format
        if video_understanding is not None:
            value["video_understanding"] = video_understanding
        digest = generation_digest(value)
        return value, digest
