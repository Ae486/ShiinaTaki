"""A probe is one bounded existing-client read, never an admission or a job."""

import asyncio
import json
import unittest
from uuid import uuid4

import httpx

from media_service_bridge.bilinote_client import BiliNoteClient
from media_service_bridge.contracts import BridgeError
from media_service_bridge.server import create_server
from async_fixture import run_async
from fixtures import INSTANCE, URL, NativeStub, config


class TestMediaProbe(unittest.TestCase):
    def test_single_existing_transport_get_with_exact_instance_and_canonical_source(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                value = await client.probe_media(URL + "?tracking=discarded")
                self.assertEqual(value, native.probe())
                self.assertEqual(len(native.calls), 1)
                request = native.calls[0]
                self.assertEqual(request.method, "GET")
                self.assertEqual(request.url.path, "/api/media/v1/probe")
                self.assertEqual(dict(request.url.params), {"video_url": URL + "?p=1",
                    "expected_service_instance_id": INSTANCE})
                self.assertFalse(request.content)
            finally:
                await client.close()
        run_async(exercise())

    def test_malformed_or_wrong_binding_never_becomes_proven_access(self):
        async def exercise():
            native = NativeStub()
            changes = [
                lambda value: value.update(service_instance_id=str(uuid4())),
                lambda value: value["source"].update(cid="0"),
                lambda value: value["source"].update(page=2),
                lambda value: value["source"].update(canonical_url=URL + "?p=2"),
                lambda value: value["source"].update(page=1.0),
                lambda value: value["access"].update(kind="metadata"),
                lambda value: value["access"].update(byte_length=0),
                lambda value: value["access"].update(byte_length=1025),
                lambda value: value["access"].update(checked_at="2026-10-17T00:00:00Z"),
                lambda value: value["access"].update(checked_at=1.0),
                lambda value: value.update(title="   "),
                lambda value: value.update(title="x" * 513),
                lambda value: value.update(duration_seconds=-1),
                lambda value: value.update(signed_url="private"),
            ]
            for change in changes:
                value = native.probe()
                change(value)
                calls = []
                async def handle(request):
                    calls.append(request)
                    return httpx.Response(200, json=value)
                client = BiliNoteClient(config(), transport=httpx.MockTransport(handle))
                try:
                    with self.assertRaises(BridgeError):
                        await client.probe_media(URL)
                    self.assertEqual([request.method for request in calls], ["GET"])
                finally:
                    await client.close()
        run_async(exercise())

    def test_unknown_duration_preserved_and_invalid_input_does_not_dispatch(self):
        async def exercise():
            native = NativeStub()
            value = native.probe()
            value["duration_seconds"] = None
            async def handle(request):
                native.calls.append(request)
                return httpx.Response(200, json=value)
            client = BiliNoteClient(config(), transport=httpx.MockTransport(handle))
            try:
                for url in ("https://b23.tv/fixture", "https://evil.invalid/BVfixture", URL + "?p=1&p=2"):
                    with self.assertRaisesRegex(BridgeError, "invalid_bridge_input"):
                        await client.probe_media(url)
                self.assertFalse(native.calls)
                self.assertIsNone((await client.probe_media(URL))["duration_seconds"])
            finally:
                await client.close()
        run_async(exercise())

    def test_closed_errors_are_preserved_without_private_upstream_text_or_retry(self):
        async def exercise():
            for status, code in ((424, "media_access_unavailable"), (424, "media_access_unauthorized"),
                    (504, "media_access_timeout"), (422, "invalid_media_target"),
                    (409, "media_identity_mismatch")):
                calls = []
                async def handle(request):
                    calls.append(request)
                    return httpx.Response(status, json={"detail": {"code": code, "private": "cookie-secret"}})
                client = BiliNoteClient(config(), transport=httpx.MockTransport(handle))
                try:
                    with self.assertRaisesRegex(BridgeError, code) as caught:
                        await client.probe_media(URL)
                    self.assertNotIn("cookie-secret", json.dumps(caught.exception.public()))
                    self.assertEqual(len(calls), 1)
                finally:
                    await client.close()
        run_async(exercise())

    def test_deadline_byte_limit_and_cancellation_close_stream_without_followup(self):
        async def exercise():
            for mode in ("deadline", "cancel", "oversize"):
                entered = asyncio.Event()
                class Stream(httpx.AsyncByteStream):
                    closed = False
                    async def __aiter__(self):
                        entered.set()
                        if mode == "oversize":
                            yield b"x" * 131073
                        else:
                            await asyncio.Event().wait()
                            yield b"unreachable"
                    async def aclose(self):
                        self.closed = True
                stream = Stream()
                calls = []
                async def handle(request):
                    calls.append(request)
                    return httpx.Response(200, headers={"Content-Type": "application/json"}, stream=stream)
                client = BiliNoteClient(config(total_timeout_seconds=0.05), transport=httpx.MockTransport(handle))
                try:
                    task = asyncio.create_task(client.probe_media(URL))
                    await entered.wait()
                    if mode == "cancel":
                        task.cancel()
                        with self.assertRaises(asyncio.CancelledError):
                            await task
                    else:
                        with self.assertRaises(BridgeError):
                            await task
                    self.assertTrue(stream.closed)
                    self.assertEqual(len(calls), 1)
                finally:
                    await client.close()
        run_async(exercise())

    def test_standard_mcp_exposes_probe_as_read_only_and_returns_structured_failure(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            server = create_server(config(), client=client)
            try:
                listed = await server.list_tools()
                tool = next(value for value in listed if value.name == "bilinote_probe_media")
                self.assertTrue(tool.annotations.readOnlyHint)
                self.assertTrue(tool.annotations.idempotentHint)
                self.assertFalse(tool.annotations.destructiveHint)
                result = await server.call_tool("bilinote_probe_media", {"video_url": URL})
                # FastMCP preserves explicit CallToolResult as an ordinary value.
                self.assertEqual(result.structuredContent, native.probe())
                failed = await server.call_tool("bilinote_probe_media", {"video_url": "https://bad.invalid"})
                self.assertTrue(failed.isError)
                self.assertEqual(failed.structuredContent["error"]["code"], "invalid_bridge_input")
                self.assertEqual(len(native.calls), 1)
            finally:
                await client.close()
        run_async(exercise())


if __name__ == "__main__":
    unittest.main()
