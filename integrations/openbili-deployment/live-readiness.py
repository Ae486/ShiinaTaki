"""Project safe native readiness and optionally retire this login's temp secrets.

Run inside the deployment container. No profile/history text, credentials,
private provider endpoints or complete HTTP response bodies are emitted.
"""

import argparse
import json
import runpy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
from openbiliclaw.bilibili.auth import resolve_runtime_cookie
from openbiliclaw.config import load_config
from openbiliclaw.sources.douyin_direct import parse_cookie_header


def main(*, cleanup: bool) -> None:
    root = Path("/app/runtime")
    config = load_config()
    token = (root / "bridge-token").read_text().strip()
    initialized = runpy.run_path("/tmp/initialize.py")["projection"]()
    evidence = {"initialization": initialized}
    headers = {"Authorization": "Bearer " + token}
    with httpx.Client(base_url="http://127.0.0.1:8420", trust_env=False, timeout=30) as client:
        ping = client.get("/api/ping")
        anonymous = client.get("/api/recommendations/peek")
        peek = client.get("/api/recommendations/peek", headers=headers)
        profile = client.get("/api/profile-summary", headers=headers)
    peek_body = peek.json()
    profile_body = profile.json()
    evidence["http"] = {
        "ping_status": ping.status_code,
        "degraded": ping.json().get("degraded", False),
        "anonymous_peek_status": anonymous.status_code,
        "authenticated_peek_status": peek.status_code,
        "peek_item_count": len(peek_body.get("items", [])),
        "peek_total": peek_body.get("total"),
        "peek_has_more": peek_body.get("has_more"),
        "peek_source": peek_body.get("source"),
        "profile_status": profile.status_code,
        "profile_initialized": profile_body.get("initialized"),
    }
    evidence["config"] = {
        "auth_enabled": config.api.auth.enabled,
        "trust_loopback": config.api.auth.trust_loopback,
        "scheduler_enabled": config.scheduler.enabled,
        "source_incremental_enabled": config.scheduler.source_incremental_enabled,
        "profile_consolidation_enabled": config.scheduler.profile_consolidation_enabled,
        "auto_update_enabled": config.scheduler.auto_update_enabled,
        "embedding_provider_set": bool(config.llm.embedding.provider),
        "default_chain": config.llm.default_chain,
        "models": {key: item.model for key, item in config.llm.instances.items()},
    }
    required = ("SESSDATA", "bili_jct", "DedeUserID")
    cookie = resolve_runtime_cookie(
        data_dir=config.data_path, configured_cookie=config.bilibili.cookie
    )
    native = parse_cookie_header(cookie)
    evidence["native_cookie_required_fields"] = {name: bool(native.get(name)) for name in required}
    private = Path("/tmp/operator-qr-poll-private.json")
    if private.exists():
        raw = json.loads(private.read_text())
        body = raw.get("body", {}).get("data", {})
        query = parse_qs(urlsplit(body.get("url", "")).query)
        cookies = raw.get("cookies", {})
        evidence["official_qr"] = {
            "official_state_code": body.get("code"),
            "response_cookie_presence": {name: bool(cookies.get(name)) for name in required},
            "redirect_query_cookie_presence": {name: bool(query.get(name)) for name in required},
        }
    receipt = Path("/tmp/operator-qr-status.json")
    if receipt.exists():
        safe = json.loads(receipt.read_text())
        evidence["login"] = {key: safe.get(key) for key in ("state", "user_id", "native_saved")}
    if cleanup:
        if (
            initialized.get("state") != "EXITED"
            or initialized.get("exit_code") != 0
            or profile_body.get("initialized") is not True
            or not all(evidence["native_cookie_required_fields"].values())
        ):
            raise RuntimeError("Keep evidence until native initialization is verified")
        # Exact files created by this operator QR session. Native stores,
        # bridge-token, password, config and all unrelated runtime files stay.
        paths = (
            "/tmp/operator-bili-candidate.json",
            "/tmp/operator-qr-poll-private.json",
            "/tmp/operator-qr-recovery-url",
            "/tmp/qrcode.png",
        )
        removed = []
        for value in paths:
            path = Path(value)
            if path.exists():
                path.unlink()
                removed.append(value)
        evidence["removed_operator_temporary_files"] = removed
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cleanup-login-temp", action="store_true")
    args = parser.parse_args()
    try:
        main(cleanup=args.cleanup_login_temp)
    except Exception as error:
        print(json.dumps({"state": "VERIFY_FAILED", "exception_type": type(error).__name__}))
        raise SystemExit(1) from None
