"""Real httpx client close: retry failure and shield transport from waiter cancellation."""

import asyncio
import unittest

import httpx

from media_service_bridge.bilinote_client import BiliNoteClient
from media_service_bridge.contracts import BridgeError
from async_fixture import run_async
from fixtures import config


class TestHttpLifecycle(unittest.TestCase):
    def test_failed_transport_close_can_retry_after_client_has_marked_itself_closed(self):
        class FailingTransport(httpx.AsyncBaseTransport):
            def __init__(self):
                self.closes = 0
                self.finished = False
            async def aclose(self):
                self.closes += 1
                if self.closes == 1:
                    raise OSError("fixture cleanup failure")
                self.finished = True
        async def exercise():
            transport = FailingTransport()
            client = BiliNoteClient(config(), transport=transport)
            with self.assertRaises(Exception):
                await client.close()
            self.assertTrue(client.closed)
            with self.assertRaisesRegex(BridgeError, "bridge_closed"):
                await client.get_instance()
            await client.close()
            self.assertEqual(transport.closes, 2)
            self.assertTrue(transport.finished)
            await client.close()
            self.assertEqual(transport.closes, 2)
        run_async(exercise())

    def test_cancelled_close_waiter_does_not_abandon_shared_transport_cleanup(self):
        async def exercise():
            started, release = asyncio.Event(), asyncio.Event()
            class HeldTransport(httpx.AsyncBaseTransport):
                closes = 0
                finished = False
                async def aclose(self):
                    self.closes += 1
                    started.set()
                    await release.wait()
                    self.finished = True
            transport = HeldTransport()
            client = BiliNoteClient(config(), transport=transport)
            first = asyncio.create_task(client.close())
            await started.wait()
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await first
            second = asyncio.create_task(client.close())
            await asyncio.sleep(0)
            try:
                self.assertFalse(second.done())
                self.assertFalse(transport.finished)
            finally:
                release.set()
                await second
            self.assertTrue(transport.finished)
            self.assertEqual(transport.closes, 1)
        run_async(exercise())
