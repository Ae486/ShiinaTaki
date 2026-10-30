"""Regressions for native strict numeric inputs and late synchronous validation."""

from copy import deepcopy
import time
import unittest
from unittest.mock import patch

import httpx

from media_service_bridge import bilinote_client
from media_service_bridge.bilinote_client import BiliNoteClient
from media_service_bridge.contracts import BridgeError, generation_digest
from async_fixture import run_async
from fixtures import GOLDEN, REQUEST, JOB, URL, NativeStub, config


class TestHttpReviewEdges(unittest.TestCase):
    def test_integral_float_profile_values_refuse_before_a_native_request(self):
        for profile in ({"video_interval": 1.0}, {"grid_size": [3.0, 3]}, {"grid_size": [3, 3.0]}):
            with self.subTest(profile=profile):
                with self.assertRaisesRegex(BridgeError, "invalid_bridge_config"):
                    config(generation_defaults=profile)
                values = {**deepcopy(GOLDEN["canonical_input"]), **profile}
                with self.assertRaisesRegex(BridgeError, "invalid_bridge_input"):
                    generation_digest(values)
        self.assertIsInstance(config(generation_defaults={"video_interval": 1, "grid_size": [3, 3]}),
                              type(config()))

    def test_each_operation_refuses_success_after_synchronous_validation_passes_deadline(self):
        cases = (
            ("instance", "validate", lambda client: client.get_instance(), "native_unavailable"),
            ("probe", "validate_media_access", lambda client: client.probe_media(URL), "native_unavailable"),
            ("submit", "receipt_binding", lambda client: client.submit(REQUEST, URL), "submission_outcome_unknown"),
            ("lookup", "receipt_binding", lambda client: client.lookup_request(REQUEST), "native_unavailable"),
            ("status", "validate_status", lambda client: client.get_status(REQUEST, JOB), "native_unavailable"),
            ("result", "validate_result", lambda client: client.read_result(REQUEST, JOB), "native_unavailable"),
        )
        for name, validator, operation, expected in cases:
            with self.subTest(operation=name):
                async def exercise():
                    native = NativeStub()
                    client = BiliNoteClient(config(total_timeout_seconds=0.05), transport=httpx.MockTransport(native))
                    original = getattr(bilinote_client, validator)
                    def slow_valid_response(*args, **kwargs):
                        value = original(*args, **kwargs)
                        # A real blocking validation window prevents asyncio's
                        # deadline callback from running before context exit.
                        time.sleep(0.08)
                        return value
                    try:
                        with patch.object(bilinote_client, validator, slow_valid_response):
                            with self.assertRaises(BridgeError) as caught:
                                await operation(client)
                        self.assertEqual(caught.exception.code, expected)
                        self.assertEqual(sum(call.method == "POST" for call in native.calls),
                                         1 if name == "submit" else 0)
                        if name == "submit":
                            self.assertEqual(caught.exception.request_id, REQUEST)
                    finally:
                        await client.close()
                run_async(exercise())


if __name__ == "__main__":
    unittest.main()
