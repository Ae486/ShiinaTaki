"""Cleanup and in-flight ambiguity under the independent OpenBili lifetime."""

import asyncio
import unittest

import httpx

from media_service_bridge.openbili_client import OpenBiliClient
from media_service_bridge.openbili_contracts import OpenBiliError
from async_fixture import run_async
from openbili_fixtures import TOKEN, OpenBiliStub, openbili_config


class TestOpenBiliLifecycle(unittest.TestCase):
    def test_close_failure_retries_transport_and_blocks_new_calls(self):
        class FailingTransport(httpx.AsyncBaseTransport):
            closes = 0
            async def aclose(self):
                self.closes += 1
                if self.closes == 1:
                    raise OSError("synthetic cleanup failure")
        async def exercise():
            transport = FailingTransport()
            client = OpenBiliClient(openbili_config(), transport=transport,
                environment={"OPENBILI_TEST_TOKEN": TOKEN})
            with self.assertRaises(OSError):
                await client.close()
            with self.assertRaisesRegex(OpenBiliError, "openbili_closed"):
                await client.read_profile()
            await client.close()
            await client.close()
            self.assertEqual(transport.closes, 2)
        run_async(exercise())

    def test_cancelled_close_waiter_keeps_one_shared_cleanup(self):
        async def exercise():
            entered, release = asyncio.Event(), asyncio.Event()
            class HeldTransport(httpx.AsyncBaseTransport):
                closes = 0
                async def aclose(self):
                    self.closes += 1
                    entered.set()
                    await release.wait()
            transport = HeldTransport()
            client = OpenBiliClient(openbili_config(), transport=transport,
                environment={"OPENBILI_TEST_TOKEN": TOKEN})
            first = asyncio.create_task(client.close())
            await entered.wait()
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            second = asyncio.create_task(client.close())
            try:
                await asyncio.sleep(0)
                self.assertFalse(second.done())
            finally:
                release.set()
                await second
            self.assertEqual(transport.closes, 1)
        run_async(exercise())

    def test_cancelled_feedback_preserves_request_and_never_retries(self):
        async def exercise():
            native = OpenBiliStub()
            entered = asyncio.Event()
            async def pending(_request):
                entered.set()
                await asyncio.Event().wait()
            native.hook = pending
            client = OpenBiliClient(openbili_config(), transport=httpx.MockTransport(native),
                environment={"OPENBILI_TEST_TOKEN": TOKEN})
            try:
                operation = asyncio.create_task(client.submit_feedback("retained", 17, "like", ""))
                await entered.wait()
                operation.cancel()
                with self.assertRaises(OpenBiliError) as caught:
                    await operation
                self.assertEqual(caught.exception.code, "openbili_outcome_unknown")
                self.assertEqual(caught.exception.request_id, "retained")
                self.assertEqual(len(native.calls), 1)
            finally:
                await client.close()
        run_async(exercise())
