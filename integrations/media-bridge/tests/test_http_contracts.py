"""Independent native HTTP behavior, identity and bounded-result regressions."""

import asyncio
from copy import deepcopy
import gzip
import hashlib
import json
import unittest
from uuid import uuid4

import httpx

from media_service_bridge.bilinote_client import BiliNoteClient
from media_service_bridge.config import BridgeConfig
from media_service_bridge.contracts import BridgeError
from async_fixture import run_async
from fixtures import GOLDEN, INSTANCE, REQUEST, JOB, URL, NativeStub, config


class TestHttpContracts(unittest.TestCase):
    def test_config_rejects_remote_plaintext_url_credentials_and_unknown_fields(self):
        for change in ({"backend_url": "http://example.com"}, {"backend_url": "https://user:secret@example.com"},
            {"backend_url": "file:///tmp/native"}, {"backend_url": "https://example.com?q=secret"},
            {"backend_url": "https://example.com/#fragment"}, {"expected_service_instance_id": "bad"},
            {"generation_defaults": {"provider_id": "model-chosen"}}, {"total_timeout_seconds": True},
            {"result_response_bytes": 0}, {"unknown": "field"}, {"auth_token_env": "bad\nname"}):
            with self.subTest(change=change), self.assertRaisesRegex(BridgeError, "invalid_bridge_config"):
                config(**change)
        self.assertTrue(config(backend_url="http://[::1]:8483/prefix").backend_url.endswith("/prefix/"))

    def test_native_golden_normalization_digest_and_single_submit(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                receipt = await client.submit(REQUEST, URL + "?p=1&tracking=ignored")
                self.assertFalse(receipt["reused"])
                self.assertEqual(receipt["request_digest"], GOLDEN["generation_digest"])
                payload = json.loads(native.calls[0].content)
                keys = {"client_request_id", "expected_service_instance_id"}
                self.assertEqual({key: value for key, value in payload.items() if key not in keys}, GOLDEN["canonical_input"])
                self.assertEqual(payload["client_request_id"], REQUEST)
                self.assertEqual(payload["expected_service_instance_id"], INSTANCE)
                self.assertEqual(len(native.calls), 1)
            finally:
                await client.close()
        run_async(exercise())

    def test_invalid_tool_inputs_do_not_dispatch(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                for key, url, options in (("bad", URL, {}), (REQUEST, "https://b23.tv/x", {}),
                    (REQUEST, URL + "?p=1&p=2", {}), (REQUEST, URL, {"output_format": "anything"}),
                    (REQUEST, URL, {"video_understanding": "yes"})):
                    with self.assertRaises(BridgeError):
                        await client.submit(key, url, **options)
                self.assertFalse(native.calls)
            finally:
                await client.close()
        run_async(exercise())

    def test_lost_submit_response_reconciles_without_another_post(self):
        async def exercise():
            native = NativeStub()
            native.lost_submit = True
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                with self.assertRaises(BridgeError) as caught:
                    await client.submit(REQUEST, URL)
                self.assertEqual(caught.exception.code, "submission_outcome_unknown")
                self.assertEqual(caught.exception.public()["request_id"], REQUEST)
                receipt = await client.lookup_request(REQUEST)
                self.assertEqual(receipt["task_id"], JOB)
                self.assertEqual([call.method for call in native.calls], ["POST", "GET"])
                self.assertEqual(native.calls[1].url.params["expected_service_instance_id"], INSTANCE)
            finally:
                await client.close()
        run_async(exercise())

    def test_http_200_reuse_and_changed_digest_are_not_new_work(self):
        async def exercise():
            native = NativeStub()
            async def hook(request):
                if request.method == "POST":
                    return httpx.Response(200, json={"code": 0, "msg": "success", "data": native.receipt()})
            native.response_hook = hook
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                self.assertTrue((await client.submit(REQUEST, URL))["reused"])
                with self.assertRaisesRegex(BridgeError, "submission_outcome_unknown"):
                    await client.submit(REQUEST, URL, video_understanding=True)
                self.assertEqual(len(native.calls), 2)
            finally:
                await client.close()
        run_async(exercise())

    def test_native_refusal_error_and_metadata_projection_do_not_leak(self):
        async def exercise():
            for status, body, expected in ((409, {"detail": "request_conflict"}, "request_conflict"),
                (503, {"detail": "native_not_ready"}, "native_not_ready"),
                (503, {"detail": "native_store_unavailable"}, "submission_outcome_unknown"),
                (500, {"detail": "private token and endpoint"}, "submission_outcome_unknown"),
                (401, {"detail": "private credential"}, "native_unauthorized")):
                calls = []
                async def handle(request):
                    calls.append(request)
                    return httpx.Response(status, json=body)
                client = BiliNoteClient(config(), transport=httpx.MockTransport(handle))
                try:
                    with self.assertRaises(BridgeError) as caught:
                        await client.submit(REQUEST, URL)
                    self.assertEqual(caught.exception.code, expected)
                    self.assertNotIn("private", json.dumps(caught.exception.public()))
                    self.assertEqual(len(calls), 1)
                finally:
                    await client.close()
        run_async(exercise())

    def test_instance_and_job_binding_mismatches_refuse_reads(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(expected_service_instance_id=str(uuid4())), transport=httpx.MockTransport(native))
            try:
                for operation in (client.get_instance(), client.lookup_request(REQUEST)):
                    with self.assertRaisesRegex(BridgeError, "native_binding_mismatch"):
                        await operation
            finally:
                await client.close()
            native = NativeStub()
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                with self.assertRaisesRegex(BridgeError, "native_binding_mismatch"):
                    await client.get_status(REQUEST, str(uuid4()))
                self.assertEqual(len(native.calls), 1)
            finally:
                await client.close()
        run_async(exercise())

    def test_native_unknown_failed_and_missing_are_not_queued(self):
        async def exercise():
            for state, availability in (("unknown", "unknown"), ("failed", "none"), ("succeeded", "missing"), ("running", "not_ready")):
                native = NativeStub()
                native.state, native.availability = state, availability
                client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
                try:
                    status = await client.get_status(REQUEST, JOB)
                    self.assertEqual((status["state"], status["result"]["availability"]), (state, availability))
                    with self.assertRaisesRegex(BridgeError, "result_not_available"):
                        await client.read_result(REQUEST, JOB)
                    self.assertFalse(any(call.url.path.endswith("/result") for call in native.calls))
                finally:
                    await client.close()
        run_async(exercise())

    def test_full_result_preview_and_resource_preserve_original_utf8_bytes(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                result = await client.read_result(REQUEST, JOB)
                self.assertEqual(result.content, native.content())
                preview = result.preview()
                self.assertFalse(preview["complete"])
                self.assertTrue(preview["markdown_truncated"])
                self.assertEqual(preview["artifact"]["byte_length"], len(native.content()))
                complete = await client.read_resource(result.resource_uri)
                self.assertEqual(complete.value["text_evidence"]["full_text"], "完整字幕 🚀")
                self.assertEqual(complete.content, native.content())
                self.assertEqual(len(native.calls), 6)
                self.assertTrue(all(call.method == "GET" for call in native.calls))
            finally:
                await client.close()
        run_async(exercise())

    def test_gzip_checks_decompressed_artifact_not_transfer_length(self):
        async def exercise():
            native = NativeStub()
            async def hook(request):
                if request.url.path.endswith("/result"):
                    return httpx.Response(200, content=gzip.compress(native.content()), headers={
                        "Content-Type": "application/json", "Content-Encoding": "gzip",
                        "ETag": '"' + hashlib.sha256(native.content()).hexdigest() + '"'})
            native.response_hook = hook
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                self.assertEqual((await client.read_result(REQUEST, JOB)).content, native.content())
            finally:
                await client.close()
        run_async(exercise())

    def test_tampered_bytes_or_stale_resource_never_trigger_reanalysis(self):
        async def exercise():
            native = NativeStub()
            native.body_override = native.content() + b" "
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                with self.assertRaisesRegex(BridgeError, "result_integrity_mismatch"):
                    await client.read_result(REQUEST, JOB)
                with self.assertRaisesRegex(BridgeError, "result_integrity_mismatch"):
                    await client.read_resource(f"bilinote://{INSTANCE}/{REQUEST}/{JOB}/" + "0" * 64)
                before = len(native.calls)
                with self.assertRaisesRegex(BridgeError, "invalid_bridge_input"):
                    await client.read_resource("https://other.invalid/secret")
                self.assertEqual(len(native.calls), before)
                self.assertTrue(all(call.method == "GET" for call in native.calls))
            finally:
                await client.close()
        run_async(exercise())

    def test_nested_schema_and_time_checks_even_with_matching_artifact_hash(self):
        async def exercise():
            mutations = [lambda v: v["text_evidence"]["segments"][0].update(end_seconds=-1),
                lambda v: v["text_evidence"]["segments"][0].update(start_seconds=None, end_seconds=2),
                lambda v: v["text_evidence"]["segments"][0].update(end_seconds=99),
                lambda v: v["analysis"].update(untrusted_new_field="no"),
                lambda v: v["identity"].update(request_id=str(uuid4())),
                lambda v: v["duration"].update(seconds="10")]
            for mutate in mutations:
                native = NativeStub()
                mutate(native.result)
                client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
                try:
                    with self.assertRaises(BridgeError):
                        await client.read_result(REQUEST, JOB)
                finally:
                    await client.close()
        run_async(exercise())

    def test_oversize_result_refuses_before_body_fetch(self):
        async def exercise():
            native = NativeStub()
            client = BiliNoteClient(config(result_response_bytes=10), transport=httpx.MockTransport(native))
            try:
                with self.assertRaisesRegex(BridgeError, "result_too_large"):
                    await client.read_result(REQUEST, JOB)
                self.assertEqual(len(native.calls), 2)
            finally:
                await client.close()
        run_async(exercise())

    def test_chunked_response_cannot_exceed_cap_even_when_descriptor_is_false(self):
        async def exercise():
            native = NativeStub()
            consumed = []
            class Chunks(httpx.AsyncByteStream):
                closed = False
                async def __aiter__(self):
                    for index in range(3):
                        consumed.append(index)
                        yield b"x" * 80
                async def aclose(self):
                    self.closed = True
            stream = Chunks()
            async def hook(request):
                if request.url.path.endswith("/result"):
                    return httpx.Response(200, stream=stream, headers={"Content-Type": "application/json"})
                if "/jobs/" in request.url.path:
                    status = native.status()
                    status["result"]["artifact"]["byte_length"] = 1
                    return httpx.Response(200, json=status)
            native.response_hook = hook
            client = BiliNoteClient(config(result_response_bytes=128), transport=httpx.MockTransport(native))
            try:
                with self.assertRaisesRegex(BridgeError, "result_too_large"):
                    await client.read_result(REQUEST, JOB)
                self.assertEqual(consumed, [0, 1])
                self.assertTrue(stream.closed)
            finally:
                await client.close()
        run_async(exercise())

    def test_nonfinite_duplicate_key_and_unsafe_artifact_path_refuse(self):
        async def exercise():
            for body in (b'{"schema_version":"bilinote.service.v1","extra":1e999}',
                         b'{"schema_version":"one","schema_version":"two"}'):
                client = BiliNoteClient(config(), transport=httpx.MockTransport(lambda request: httpx.Response(200,
                    content=body, headers={"Content-Type": "application/json"})))
                try:
                    with self.assertRaisesRegex(BridgeError, "native_response_invalid"):
                        await client.get_instance()
                finally:
                    await client.close()
            native = NativeStub()
            async def hook(request):
                if "/jobs/" in request.url.path:
                    status = native.status()
                    status["result"]["artifact"]["read_path"] = "https://other.invalid/private"
                    return httpx.Response(200, json=status)
            native.response_hook = hook
            client = BiliNoteClient(config(), transport=httpx.MockTransport(native))
            try:
                with self.assertRaisesRegex(BridgeError, "native_response_invalid"):
                    await client.read_result(REQUEST, JOB)
                self.assertEqual(len(native.calls), 2)
                self.assertTrue(all(call.url.host == "127.0.0.1" for call in native.calls))
            finally:
                await client.close()
        run_async(exercise())

    def test_fixed_base_path_no_redirect_and_separate_auth_injection(self):
        async def exercise():
            calls = []
            async def handle(request):
                calls.append(request)
                return httpx.Response(302, headers={"Location": "https://other.invalid/steal"}, content=b"private HTML")
            client = BiliNoteClient(config(backend_url="https://gateway.invalid/native", auth_token_env="BILINOTE_TOKEN"),
                transport=httpx.MockTransport(handle), environment={"BILINOTE_TOKEN": "fixture-only-token", "OPENBILI_TOKEN": "other-fixture"})
            try:
                with self.assertRaisesRegex(BridgeError, "native_unavailable"):
                    await client.lookup_request(REQUEST)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0].url.path, f"/native/api/media/v1/requests/{REQUEST}")
                self.assertEqual(calls[0].headers["authorization"], "Bearer fixture-only-token")
            finally:
                await client.close()
        run_async(exercise())

    def test_deadline_and_cancelled_post_keep_original_request_identity(self):
        async def exercise():
            started = asyncio.Event()
            calls = []
            async def slow(request):
                calls.append(request)
                started.set()
                await asyncio.sleep(10)
            client = BiliNoteClient(config(total_timeout_seconds=0.02), transport=httpx.MockTransport(slow))
            try:
                with self.assertRaisesRegex(BridgeError, "submission_outcome_unknown"):
                    await client.submit(REQUEST, URL)
                task = asyncio.create_task(client.submit(REQUEST, URL))
                started.clear()
                await started.wait()
                task.cancel()
                with self.assertRaises(BridgeError) as caught:
                    await task
                self.assertEqual(caught.exception.code, "submission_outcome_unknown")
                self.assertEqual(caught.exception.request_id, REQUEST)
                self.assertEqual(len(calls), 2)
            finally:
                await client.close()
                await client.close()
                with self.assertRaisesRegex(BridgeError, "bridge_closed"):
                    await client.submit(REQUEST, URL)
                self.assertEqual(len(calls), 2)
        run_async(exercise())
