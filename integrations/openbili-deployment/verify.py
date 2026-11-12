"""Read live deployment evidence; never print configuration, tokens or profiles."""

import hashlib
import importlib.metadata
import json
import os
import sqlite3
import urllib.error
import urllib.request
from pathlib import Path

import openbiliclaw
from openbiliclaw.auth_core import sign_token, verify_token
from openbiliclaw.config import load_config


def request(path: str, *, token: str | None = None, body: dict | None = None) -> dict:
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request("http://127.0.0.1:8420" + path, data=data, headers=headers)
    try:
        response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            req, timeout=10
        )
    except urllib.error.HTTPError as error:
        response = error
    with response:
        value = json.loads(response.read())
        # Return status/classification only; source/profile text is never logged.
        return {
            "http_status": response.status,
            "status": value.get("status"),
            "reason": value.get("reason") or value.get("error"),
            "degraded": value.get("degraded"),
            "initialized": value.get("initialized"),
            "source": value.get("source"),
            "total": value.get("total"),
        }


def main() -> None:
    manifest = json.loads(Path("/opt/taki-openbili/source-manifest.json").read_text())
    source = Path("/opt/taki-openbili/src")
    files = {
        str(path.relative_to(source)).replace("\\", "/"): hashlib.sha256(
            path.read_bytes()
        ).hexdigest()
        for path in sorted(source.rglob("*"))
        if path.is_file() and "__pycache__" not in path.parts
    }
    if files != manifest["files"]:
        raise RuntimeError("Source overlay differs from the reviewed manifest")
    digest = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    if digest != manifest["sha256"]:
        raise RuntimeError("Source manifest hash is inconsistent")
    config = load_config()
    db_path = config.data_path / "openbiliclaw.db"
    token_path = Path(os.environ["OPENBILICLAW_PROJECT_ROOT"]) / "bridge-token"
    # Match native get_auth_epoch's absent-row semantics using a strictly
    # read-only connection, without running Database.initialize()/migrations.
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as connection:
        row = connection.execute("SELECT value FROM auth_state WHERE key = 'auth_epoch'").fetchone()
        epoch = 0 if row is None else int(row[0])
    token = token_path.read_text() if token_path.exists() else ""
    if not verify_token(token, config.api.auth.session_secret, current_epoch=epoch):
        token = sign_token(config.api.auth.session_secret, epoch=epoch)
    token_path.write_text(token, encoding="utf-8")
    token_path.chmod(0o600)
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as connection:
        counts = {
            table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in ("recommendations", "events", "content_cache")
        }
    result = {
        "version": importlib.metadata.version("openbiliclaw"),
        "source_path": openbiliclaw.__file__,
        "source_sha256": manifest["sha256"],
        "source_files_verified": len(files),
        "auth_enabled": config.api.auth.enabled,
        "trust_loopback": config.api.auth.trust_loopback,
        "scheduler_enabled": config.scheduler.enabled,
        "model_instances": len(config.llm.instances),
        "table_counts": counts,
        "ping": request("/api/ping"),
        "anonymous_peek": request("/api/recommendations/peek"),
        "authenticated_peek": request("/api/recommendations/peek", token=token),
        "authenticated_profile": request("/api/profile-summary", token=token),
        # An invalid, absent recommendation cannot create a native feedback fact.
        "authenticated_feedback": request(
            "/api/feedback",
            token=token,
            body={
                "recommendation_id": -1,
                "feedback_type": "like",
                "request_id": "deployment-probe-invalid-id",
            },
        ),
    }
    if not result["auth_enabled"] or result["trust_loopback"] or result["scheduler_enabled"]:
        raise RuntimeError("Deployment authorization/bootstrap boundary differs")
    if result["model_instances"] != 0 or any(counts.values()):
        raise RuntimeError("Expected an uninitialized deployment without native data")
    if result["ping"]["http_status"] != 200 or result["anonymous_peek"]["http_status"] != 401:
        raise RuntimeError("Liveness/authentication verification failed")
    for key in ("authenticated_peek", "authenticated_profile", "authenticated_feedback"):
        if result[key]["http_status"] != 503:
            raise RuntimeError("Expected truthful native degraded capability status")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
