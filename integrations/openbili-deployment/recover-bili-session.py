"""Recover only the current operator QR with the installed official SDK.

Raw passport data stays mode-0600 inside the container. Only response field
names and required-cookie presence are emitted for diagnosing SDK parse drift.
"""

import asyncio
import json
import logging
import os
import runpy
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from bilibili_api import Credential, request_settings
from bilibili_api.login_v2 import API
from bilibili_api.utils.network import Api, get_client


async def main() -> None:
    os.umask(0o077)
    logging.disable(logging.CRITICAL)
    request_settings.set_proxy("")
    request_settings.set_timeout(15)
    key = parse_qs(urlsplit(Path("/tmp/operator-qr-recovery-url").read_text().strip()).query)[
        "qrcode_key"
    ][0]
    result = await asyncio.wait_for(
        Api(credential=Credential(), **API["qrcode"]["web"]["get_events"])
        .update_params(qrcode_key=key)
        .result,
        timeout=25,
    )
    raw = Path("/tmp/operator-qr-poll-private.json")
    raw.write_text(json.dumps(result), encoding="utf-8")
    raw.chmod(0o600)
    query = parse_qs(urlsplit(result.get("url", "")).query)
    session = get_client().get_wrapped_session()
    jar = session.cookies.get_dict()
    cookies = {name: values[0] for name, values in query.items() if values}
    cookies.update(jar)
    required = ("SESSDATA", "bili_jct", "DedeUserID")
    print(
        json.dumps(
            {
                "official_state_code": result.get("code"),
                "result_fields": sorted(result),
                "query_fields": sorted(query),
                "jar_fields": sorted(jar),
                "required_fields": {name: bool(cookies.get(name)) for name in required},
            }
        ),
        flush=True,
    )
    if all(cookies.get(name) for name in required):
        cookies["ac_time_value"] = result.get("refresh_token", "")
        helper = runpy.run_path("/tmp/bili-qr-login.py")
        await helper["save_candidate"](cookies)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"state": "RECOVERY_FAILED", "exception_type": type(error).__name__}))
        raise SystemExit(1) from None
