"""Independent operator-owned OpenBili origin and credential reference.

This optional configuration never changes BiliNote's endpoint or generation
profile. Reading it cannot initialize OpenBili or discover native secrets.
"""

from dataclasses import dataclass
import ipaddress
from pathlib import Path
import re
from urllib.parse import urlsplit

from .contracts import BridgeError, json_object
from .openbili_contracts import OpenBiliError


@dataclass(frozen=True)
class OpenBiliConfig:
    backend_url: str
    auth_token_env: str
    total_timeout_seconds: float = 15
    response_bytes: int = 262144

    @classmethod
    def from_file(cls, path: Path):
        try:
            return cls.from_document(json_object(path.read_bytes()))
        except (BridgeError, OSError) as exc:
            raise OpenBiliError("openbili_not_configured") from exc

    @classmethod
    def from_document(cls, value):
        try:
            if not isinstance(value, dict) or set(value) - {
                "backend_url", "auth_token_env", "total_timeout_seconds", "response_bytes"
            }:
                raise ValueError
            endpoint = urlsplit(value["backend_url"])
            if (endpoint.scheme not in {"http", "https"} or not endpoint.hostname
                    or endpoint.username is not None or endpoint.password is not None
                    or endpoint.path not in {"", "/"} or endpoint.query or endpoint.fragment
                    or endpoint.port == 0 or any(c.isspace() for c in value["backend_url"])):
                raise ValueError
            if endpoint.scheme == "http" and endpoint.hostname != "localhost":
                if not ipaddress.ip_address(endpoint.hostname).is_loopback:
                    raise ValueError
            token = value["auth_token_env"]
            if not isinstance(token, str) or re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", token) is None:
                raise ValueError
            timeout, cap = value.get("total_timeout_seconds", 15), value.get("response_bytes", 262144)
            if type(timeout) not in {int, float} or not 0 < timeout <= 120:
                raise ValueError
            if type(cap) is not int or not 1 <= cap <= 1048576:
                raise ValueError
            return cls(value["backend_url"].rstrip("/") + "/", token, timeout, cap)
        except (ValueError, KeyError, TypeError, AttributeError) as exc:
            raise OpenBiliError("openbili_not_configured") from exc
