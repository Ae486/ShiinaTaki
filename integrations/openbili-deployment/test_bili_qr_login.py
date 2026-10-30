"""Offline regression for real SDK QR parsing with Set-Cookie-only login."""

import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from bilibili_api.login_v2 import QrCodeLogin, QrCodeLoginEvents
from bilibili_api.utils.network import Api, BiliAPIResponse
from openbiliclaw.api.source_auth.write import structural_verdict

HELPER = runpy.run_path(str(Path(__file__).with_name("bili-qr-login.py")))


class QrCookieRegression(unittest.IsolatedAsyncioTestCase):
    async def test_real_sdk_empty_url_fields_do_not_lose_response_cookies(self):
        expected = {
            "SESSDATA": "synthetic-session",
            "bili_jct": "synthetic-csrf",
            "DedeUserID": "123",
        }
        raw = json.dumps(
            {
                "code": 0,
                "data": {
                    "code": 0,
                    "url": "https://passport.bilibili.com/account/sso?ticket=synthetic",
                    "refresh_token": "synthetic-refresh",
                },
            }
        ).encode()

        class Client:
            async def request(self, **kwargs):
                return BiliAPIResponse(
                    code=200,
                    headers={},
                    cookies=expected,
                    raw=raw,
                    url="https://passport.bilibili.com/",
                )

        client = Client()
        with tempfile.TemporaryDirectory() as directory:
            private = Path(directory) / "private.json"
            captured = HELPER["capture_poll_response"](client, private_capture=private)
            prepare = AsyncMock(return_value={"params": {"qrcode_key": "synthetic"}})
            with (
                patch.object(Api, "_prepare_request", prepare),
                patch("bilibili_api.utils.network.get_client", return_value=client),
            ):
                login = QrCodeLogin()
                self.assertEqual(await login.check_state(), QrCodeLoginEvents.DONE)
            sdk = login.get_credential().get_cookies()
            self.assertFalse(any(sdk.get(key) for key in expected))
            merged = HELPER["merged_login_cookies"](sdk, captured, {})
            self.assertEqual({key: merged[key] for key in expected}, expected)
            header = "; ".join(f"{key}={merged[key]}" for key in expected)
            self.assertIsNone(structural_verdict("bilibili", header))
            self.assertEqual(private.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(private.read_text())["cookies"], expected)


if __name__ == "__main__":
    unittest.main()
