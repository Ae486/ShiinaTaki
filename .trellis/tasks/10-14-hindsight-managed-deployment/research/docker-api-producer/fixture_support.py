"""Fixed generated-fixture observations: no arbitrary path, URL, credentials or command API."""

import hashlib
import http.client
import json
import os
import stat
import time
from pathlib import Path

TOKEN = "5c7480e7-4501-447a-a3bf-2e02f28a9fda"
ROOT = Path("/home/hindsight/.pg0")
RUNTIME = Path("/run/taki-hindsight")
PRODUCER = Path("/opt/taki-c2b-producer")
BUILD = "taki-memory-hindsight-0.9.0-template-backup-v1"
CONFIGURATION = hashlib.sha256(("generated-producer:" + TOKEN).encode()).hexdigest()


class FixtureFailure(Exception):
    """Only fixed codes are serialized."""


def require(condition: object, code: str) -> None:
    if not condition:
        raise FixtureFailure(code)


def encode(value: object) -> bytes:
    return (json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n").encode()


def command(raw: bytes) -> dict:
    require(len(raw) <= 256, "command_bound")
    def unique(pairs):
        require(len({name for name, _value in pairs}) == len(pairs), "duplicate_command_key")
        return dict(pairs)

    value = json.loads(raw, object_pairs_hook=unique)
    require(isinstance(value, dict), "command_object")
    require(set(value) == {"token", "phase", "firstSha256"} and value["token"] == TOKEN, "command_identity")
    require(value["phase"] in {"first", "restart"}, "command_phase")
    require((value["phase"] == "first" and value["firstSha256"] is None)
            or (value["phase"] == "restart" and isinstance(value["firstSha256"], str)
                and len(value["firstSha256"]) == 64 and all(c in "0123456789abcdef" for c in value["firstSha256"])), "first_digest")
    return value


def previous_result(raw: bytes, expected: str) -> dict:
    require(hashlib.sha256(raw).hexdigest() == expected, "first_report_changed")
    previous = json.loads(raw)
    require(previous["complete"] is True and previous["phase"] == "first" and previous["token"] == TOKEN
            and previous["stopped"]["shutdown_checked"] is True and previous["privacyScan"]["complete"] is True,
            "prior_stop_unproven")
    return previous


def read(path: Path, maximum: int = 65536) -> bytes:
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "not_regular")
        raw = stream.read(maximum + 1)
    require(len(raw) <= maximum, "file_bound")
    return raw


def exclusive(path: Path, raw: bytes) -> None:
    require(path.parent.resolve() == path.parent and len(raw) <= 65536, "evidence_path")
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())


def get(path: str, key: str | None, deadline: float) -> tuple[int, bytes]:
    require(path in {"/health", "/ext/taki-memory/version"}, "http_path")
    require(time.monotonic() < deadline, "http_deadline")
    connection = http.client.HTTPConnection("127.0.0.1", 8000, timeout=min(1, deadline - time.monotonic()))
    try:
        connection.request("GET", path, headers={} if key is None else {"Authorization": "Bearer " + key})
        response = connection.getresponse()
        raw = response.read(65537)
        require(len(raw) <= 65536, "http_body_bound")
        return response.status, raw
    finally:
        connection.close()


def http_evidence(key: str, deadline: float, lineage: str) -> dict:
    denied, _ = get("/ext/taki-memory/version", None, deadline)
    healthy, health_raw = get("/health", None, deadline)
    authenticated, raw = get("/ext/taki-memory/version", key, deadline)
    require(denied == 401 and healthy == 200 and authenticated == 200, "http_status")
    require(json.loads(health_raw)["status"] == "healthy", "sql_health")
    value = json.loads(raw)
    require(value["source_identity"]["compatibility_build"] == BUILD and value["provider"]["lineage"] == lineage
            and value["provider"]["database_dialect"] == "postgresql" and value["provider"]["storage_mode"] == "sql_rows"
            and value["support"]["state"] == "supported", "manifest_identity")
    for name in ("change_journal", "logical_snapshot", "native_results", "application_state", "template_lifecycle", "template_backup"):
        require(value["contracts"][name]["version"] == "1.0.0"
                and value["contracts"][name]["support"]["state"] == "supported", "manifest_contract")
    return {"unauthenticatedStatus": denied, "healthStatus": healthy, "authenticatedStatus": authenticated,
            "build": BUILD, "providerLineage": lineage, "manifestSha256": hashlib.sha256(raw).hexdigest()}


def privacy_scan(values: list[bytes], deadline: float) -> dict:
    """Read only the fresh owned volume after writers stopped; never follow symbolic links."""
    count = 0
    total = 0
    links = 0
    overlap = max(map(len, values)) - 1
    for directory, dirs, files in os.walk(ROOT, followlinks=False):
        require(time.monotonic() < deadline, "scan_deadline")
        for name in dirs[:]:
            path = Path(directory) / name
            if path.is_symlink():
                require(not any(value in os.readlink(path).encode() for value in values), "credential_in_link")
                dirs.remove(name)
                links += 1
        for name in files:
            require(time.monotonic() < deadline and count < 50000, "scan_bound")
            path = Path(directory) / name
            if path.is_symlink():
                require(not any(value in os.readlink(path).encode() for value in values), "credential_in_link")
                links += 1
                continue
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode), "unexpected_volume_entry")
            count += 1
            carry = b""
            with path.open("rb") as stream:
                while chunk := stream.read(1024 * 1024):
                    total += len(chunk)
                    require(total <= 2 * 1024**3 and time.monotonic() < deadline, "scan_bound")
                    block = carry + chunk
                    require(not any(value in block for value in values), "credential_on_volume")
                    carry = block[-overlap:]
    return {"complete": True, "files": count, "bytes": total, "symlinksNotFollowed": links, "hits": 0}
