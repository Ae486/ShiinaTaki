"""Verify configured native reads and UI authentication without generation."""

import argparse
import http.cookiejar
import json
import subprocess
import urllib.error
import urllib.request
from pathlib import Path


def docker(*args: str) -> str:
    return subprocess.check_output(["docker", *args], encoding="utf-8").strip()


def request(path: str, token: str = "", body: dict | None = None, opener=None):
    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if body is None else json.dumps(body).encode()
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request("http://127.0.0.1:18420" + path, data=data, headers=headers)
    transport = opener or urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = transport.open(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        content = response.read()
        value = (
            json.loads(content)
            if "application/json" in response.headers.get("Content-Type", "")
            else {}
        )
        return response.status, value, content


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", action="store_true")
    parser.add_argument("--output", default="configured-readiness.json")
    args = parser.parse_args()
    token = docker("exec", "taki-openbili-backend", "cat", "/app/runtime/bridge-token")
    password = docker("exec", "taki-openbili-backend", "cat", "/app/runtime/operator-password")
    ping_status, ping, _ = request("/api/ping")
    anonymous_status, _, _ = request("/api/recommendations/peek")
    peek_status, peek, _ = request("/api/recommendations/peek", token)
    profile_status, profile, _ = request("/api/profile-summary", token)
    feedback_status, _, _ = request(
        "/api/feedback",
        token,
        {
            "recommendation_id": -1,
            "feedback_type": "like",
            "request_id": "deployment-probe-invalid-id",
        },
    )
    models = None
    if args.models:
        status, result, _ = request(
            "/api/config/discover-models", token, {"instance_id": "campaign-flash"}
        )
        models = {
            "http_status": status,
            "native_ok": result.get("ok"),
            "exact_model_listed": "deepseek-flash" in result.get("models", []),
        }
    cookies = http.cookiejar.CookieJar()
    browser = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies)
    )
    setup_status, _, setup = request("/setup/", opener=browser)
    login_status, login, _ = request("/api/auth/login", body={"password": password}, opener=browser)
    cookie_status, config_view, _ = request("/api/config", opener=browser)
    setup_after_status, _, _ = request("/setup/", opener=browser)
    if ping_status != 200 or ping.get("degraded", False) or anonymous_status != 401:
        raise RuntimeError("Configured service or authentication is unavailable")
    if peek_status != 200 or peek != {
        "items": [],
        "source": "existing_recommendations",
        "total": 0,
        "has_more": False,
    }:
        raise RuntimeError("Expected a truthful empty existing-recommendation view")
    if profile_status != 200 or profile.get("initialized") is not False or feedback_status != 404:
        raise RuntimeError("Unexpected native uninitialized/profile/feedback behavior")
    if (
        login_status != 200
        or not login.get("ok")
        or cookie_status != 200
        or setup_after_status != 200
    ):
        raise RuntimeError("Native UI login/config contract is unavailable")
    diagnostics = r"""
import json,sqlite3
from dataclasses import fields
from openbiliclaw.config import load_config
from openbiliclaw.llm.registry import build_llm_registry,build_embedding_service
from openbiliclaw.llm.service import LLMService,module_overrides_from_config
cfg=load_config()
registry=build_llm_registry(cfg)
# supports_image_input consults registry/module routes only; no model or memory call.
service=LLMService(registry=registry,memory=None,module_overrides=module_overrides_from_config(cfg))
with sqlite3.connect('file:'+str(cfg.data_path/'openbiliclaw.db')+'?mode=ro',uri=True) as db:
 counts={name:db.execute('SELECT COUNT(*) FROM '+name).fetchone()[0]
         for name in ('recommendations','events','content_cache','llm_usage')}
print(json.dumps({'table_counts':counts,'scheduler_enabled':cfg.scheduler.enabled,
 'source_incremental_enabled':cfg.scheduler.source_incremental_enabled,
 'enabled_sources':[f.name for f in fields(cfg.sources)
                    if getattr(getattr(cfg.sources,f.name),'enabled',False)],
 'instances':{name:{'model':item.model,'provider_type':item.provider_type,'enabled':item.enabled}
              for name,item in cfg.llm.instances.items()},
 'default_chain':cfg.llm.default_chain,'evaluation_inherits':cfg.llm.evaluation.inherit,
 'embedding_provider_set':bool(cfg.llm.embedding.provider),
 'embedding_service_available':build_embedding_service(cfg,registry) is not None,
 'native_supports_image_input':service.supports_image_input()}))
"""
    native = json.loads(docker("exec", "taki-openbili-backend", "python", "-c", diagnostics))
    if (
        any(native["table_counts"].values())
        or native["scheduler_enabled"]
        or native["enabled_sources"]
    ):
        raise RuntimeError("Unexpected native generation/data/source activity")
    evidence = {
        "image_id": docker("inspect", "taki-openbili-backend", "--format", "{{.Image}}"),
        "ping_status": ping_status,
        "degraded": ping.get("degraded", False),
        "anonymous_peek_status": anonymous_status,
        "authenticated_peek": peek,
        "profile_initialized": profile["initialized"],
        "invalid_feedback_status": feedback_status,
        "models_metadata_read": models,
        "setup_html_status": setup_status,
        "setup_html_present": bool(setup),
        "native_login_status": login_status,
        "cookie_authenticated_config_status": cookie_status,
        "setup_after_login_status": setup_after_status,
        **native,
    }
    # Config response stays in memory; never serialize endpoint or masked credential fields.
    del config_view, password, token
    Path(__file__).with_name(args.output).write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
