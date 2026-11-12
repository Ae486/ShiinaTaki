"""Perform fresh official Bilibili QR login, then use native credential storage.

Run inside the isolated backend container as an explicitly authorized operator
action. The installed SDK owns passport endpoints and QR state. Only the QR PNG
and a safe status projection leave the container. A rejected candidate remains
in a mode-0600 temporary file for revalidation without another phone login.
Native validation still owns final persistence. This never edits API auth.
"""

import argparse
import asyncio
import json
import logging
import os
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
from bilibili_api import request_settings
from bilibili_api.login_v2 import QrCodeLogin, QrCodeLoginEvents
from bilibili_api.utils.network import get_client

STATUS = Path("/tmp/operator-qr-status.json")
CANDIDATE = Path("/tmp/operator-bili-candidate.json")


def capture_poll_response(client, *, private_capture: Path | None = None):
    """Keep native HTTP cookies before SDK 17.4.2 discards that envelope.

    QrCodeLogin parses only the JSON redirect URL. Modern passport responses
    can instead authenticate through Set-Cookie. Capture the existing request,
    not a second poll: a completed QR may no longer be redeemable afterward.
    """
    original = client.request
    captured = {}

    async def request(*args, **kwargs):
        response = await original(*args, **kwargs)
        if kwargs.get("params", {}).get("qrcode_key"):
            body = json.loads(response.raw)
            if body.get("data", {}).get("code") == 0:
                captured.update(response.cookies)
                private = private_capture or Path("/tmp/operator-qr-poll-private.json")
                private.write_text(
                    json.dumps({"body": body, "cookies": response.cookies}), encoding="utf-8"
                )
                private.chmod(0o600)
        return response

    client.request = request
    return captured


def merged_login_cookies(sdk_cookies: dict, response_cookies: dict, jar_cookies: dict) -> dict:
    """Prefer actual response cookies; empty SDK URL fields must not erase them."""
    result = {key: value for key, value in sdk_cookies.items() if value}
    result.update({key: value for key, value in jar_cookies.items() if value})
    result.update({key: value for key, value in response_cookies.items() if value})
    return result


def report(state: str, **facts: object) -> None:
    payload = {"state": state, **facts}
    STATUS.write_text(json.dumps(payload), encoding="utf-8")
    print(json.dumps(payload), flush=True)


async def save_candidate(cookies: dict) -> None:
    allowed = {"SESSDATA", "bili_jct", "DedeUserID", "ac_time_value", "buvid3", "buvid4"}
    selected = {key: value for key, value in cookies.items() if key in allowed and value}
    # Retain a rejected candidate privately so one failed network request does
    # not force another phone login. This is not the native credential store.
    CANDIDATE.write_text(json.dumps(selected), encoding="utf-8")
    CANDIDATE.chmod(0o600)
    presence = {key: bool(selected.get(key)) for key in ("SESSDATA", "bili_jct", "DedeUserID")}
    header = "; ".join(f"{key}={value}" for key, value in selected.items())
    token = Path("/app/runtime/bridge-token").read_text().strip()
    async with httpx.AsyncClient(trust_env=False, timeout=90) as client:
        response = await client.post(
            "http://127.0.0.1:8420/api/bilibili/cookie",
            headers={"Authorization": "Bearer " + token},
            json={"cookie": header, "source": "operator_official_qr"},
        )
    if response.status_code != 200:
        report("NATIVE_REJECTED", http_status=response.status_code, required_fields=presence)
        return
    result = response.json()
    if not result.get("ok") or not result.get("authenticated"):
        code = result.get("error_code")
        known = {"empty_cookie", "cookie_invalid", "validation_network", "validation_failed"}
        report(
            "NATIVE_VALIDATION_FAILED",
            error_code=code if code in known else "other",
            required_fields=presence,
            candidate_retained=True,
        )
        return
    report("AUTHENTICATED", user_id=result.get("user_id"), native_saved=True)
    CANDIDATE.unlink()


async def main(*, recover: bool = False, retry_candidate: bool = False) -> None:
    os.umask(0o077)
    # Passport requests must not inherit a private model/provider proxy.
    for name in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        os.environ.pop(name, None)
    logging.disable(logging.CRITICAL)
    request_settings.set_proxy("")
    request_settings.set_timeout(15)
    if retry_candidate:
        await save_candidate(json.loads(CANDIDATE.read_text()))
        return
    login = QrCodeLogin()
    if recover:
        url = urlsplit(Path("/tmp/operator-qr-recovery-url").read_text().strip())
        key = parse_qs(url.query).get("qrcode_key", [""])[0]
        if not key:
            raise ValueError("Missing official QR key")
        # Never request the decoded URL. Only the original QR's key goes to
        # the SDK's fixed official polling endpoint; scan hosts may vary.
        # Use only the original operator QR and pinned SDK 17.4.2 web session
        # field. Recovery never generates a new login request.
        login._QrCodeLogin__qr_key = key
        report("RECOVERING_ORIGINAL_SESSION")
    else:
        await asyncio.wait_for(login.generate_qrcode(), timeout=25)
        Path("/tmp/qrcode.png").chmod(0o600)
        private_url = Path("/tmp/operator-qr-recovery-url")
        private_url.write_text(login._QrCodeLogin__qr_link, encoding="utf-8")
        private_url.chmod(0o600)
        report("QR_READY", expires_after_seconds=175)
    sdk_client = get_client()
    response_cookies = capture_poll_response(sdk_client)
    deadline = time.monotonic() + 175
    previous = None
    while time.monotonic() < deadline:
        state = await asyncio.wait_for(login.check_state(), timeout=20)
        if state != previous:
            report(state.name)
            previous = state
        if state == QrCodeLoginEvents.TIMEOUT:
            return
        if state == QrCodeLoginEvents.DONE:
            credential = login.get_credential()
            cookies = merged_login_cookies(
                credential.get_cookies(),
                response_cookies,
                sdk_client.get_wrapped_session().cookies.get_dict(),
            )
            await save_candidate(cookies)
            return
        await asyncio.sleep(2)
    report("TIMEOUT")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--recover", action="store_true")
    parser.add_argument("--retry-candidate", action="store_true")
    args = parser.parse_args()
    try:
        asyncio.run(main(recover=args.recover, retry_candidate=args.retry_candidate))
    except Exception as error:
        # Exception messages, URLs and SDK reprs may contain credentials/QR keys.
        report("FAILED", exception_type=type(error).__name__)
        raise SystemExit(1) from None
