"""Apply only the approved campaign provider through the native config API.

Reads two named operator fields in memory; never emits secrets or endpoint URLs.
This is an operator action, not a model-facing tool or automatic startup action.
"""

import ipaddress
import json
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import suppress
from pathlib import Path


def campaign_fields() -> dict[str, str]:
    wanted = {"TAKI_PROVIDER_BASE_URL", "TAKI_PROVIDER_API_KEY"}
    values = {}
    with Path("H:/TakiAgent/.env.local").open(encoding="utf-8-sig") as stream:
        for raw in stream:
            name, separator, value = raw.strip().removeprefix("export ").partition("=")
            name = name.strip()
            if separator and name in wanted:
                if name in values:
                    raise RuntimeError("Duplicate approved provider field")
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]
                values[name] = value
    if set(values) != wanted or not all(values.values()):
        raise RuntimeError("The two approved provider fields are required")
    return values


def container_url(value: str) -> tuple[str, bool]:
    parts = urllib.parse.urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username:
        raise RuntimeError("Unsupported provider endpoint shape")
    local = parts.hostname.lower() == "localhost"
    with suppress(ValueError):
        local = local or ipaddress.ip_address(parts.hostname).is_loopback
    if not local:
        return value, False
    host = "host.docker.internal" + (f":{parts.port}" if parts.port else "")
    return urllib.parse.urlunsplit(
        (parts.scheme, host, parts.path, parts.query, parts.fragment)
    ), True


def native(path: str, token: str, body: dict | None = None) -> dict:
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    data = None if body is None else json.dumps(body).encode()
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(
        "http://127.0.0.1:18420" + path,
        data=data,
        headers=headers,
        method="GET" if body is None else "PUT",
    )
    try:
        response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(
            request, timeout=30
        )
    except urllib.error.HTTPError as error:
        # Native errors may contain masked config. Keep all response content private.
        failure = json.loads(error.read())
        fields = [
            item.get("field")
            for item in failure.get("config", {}).get("issues", [])
            if item.get("severity") == "blocking"
        ]
        raise RuntimeError(
            f"Native configuration HTTP {error.code}; blocking fields: {fields}"
        ) from None
    with response:
        return json.loads(response.read())


def main() -> None:
    values = campaign_fields()
    endpoint, remapped = container_url(values["TAKI_PROVIDER_BASE_URL"])
    key = values["TAKI_PROVIDER_API_KEY"]
    token = subprocess.check_output(
        ["docker", "exec", "taki-openbili-backend", "cat", "/app/runtime/bridge-token"],
        encoding="utf-8",
    ).strip()
    route = {"inherit": True, "chain": []}
    result = native(
        "/api/config",
        token,
        {
            "suppress_background_llm_work": True,
            "llm": {
                "routing_version": 2,
                "instances": {
                    "campaign-flash": {
                        "name": "Taki campaign",
                        "provider_type": "openai_compatible",
                        "enabled": True,
                        "model": "deepseek-flash",
                        "base_url": endpoint,
                        "api_key": key,
                        "api_flavor": "chat_completions",
                        "reasoning_effort": "",
                    }
                },
                "default_chain": ["campaign-flash"],
                "routes": {
                    name: route for name in ("soul", "discovery", "recommendation", "evaluation")
                },
                "embedding": {"provider": "", "model": "", "fallback_enabled": False},
            },
            "scheduler": {
                "enabled": False,
                "source_incremental_enabled": False,
                "profile_consolidation_enabled": False,
                "auto_update_enabled": False,
            },
        },
    )
    if not result.get("ok"):
        raise RuntimeError("Native configuration was not accepted")
    revision = result["apply_revision"]
    deadline = time.monotonic() + 30
    while True:
        status = native("/api/config/apply-status", token)
        if status["state"] == "applied" and status["applied_revision"] == revision:
            break
        if status["state"] == "failed" or time.monotonic() >= deadline:
            raise RuntimeError("Native provider configuration did not apply")
        time.sleep(0.25)
    comparison_code = """
import hmac,json,sys
from openbiliclaw.config import load_config
expected=json.load(sys.stdin)
cfg=load_config()
instance=cfg.llm.instances['campaign-flash']
print(json.dumps({'key_matches':hmac.compare_digest(instance.api_key,expected['key']),
 'endpoint_matches':instance.base_url==expected['endpoint'], 'model':instance.model,
 'scheduler_enabled':cfg.scheduler.enabled,
 'embedding_provider_set':bool(cfg.llm.embedding.provider)}))
"""
    checked = subprocess.run(
        ["docker", "exec", "-i", "taki-openbili-backend", "python", "-c", comparison_code],
        input=json.dumps({"key": key, "endpoint": endpoint}),
        encoding="utf-8",
        capture_output=True,
        check=True,
    )
    comparison = json.loads(checked.stdout)
    if not comparison["key_matches"] or not comparison["endpoint_matches"]:
        raise RuntimeError("Persisted provider identity differs from the authorized source")
    evidence = {
        "apply_state": status["state"],
        "apply_revision": revision,
        "host_loopback_remapped": remapped,
        **comparison,
        "generation_invoked": False,
        "account_initialization_invoked": False,
    }
    Path(__file__).with_name("provider-configuration.json").write_text(
        json.dumps(evidence, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
