"""Independent OpenBili projection, recovery and SDK schema contract checks."""

import asyncio
from copy import deepcopy
import gzip
import json
import time
import unittest
from unittest.mock import patch

import httpx

from media_service_bridge.bilinote_client import BiliNoteClient
from media_service_bridge.openbili_client import OpenBiliClient
from media_service_bridge.openbili_config import OpenBiliConfig
from media_service_bridge.openbili_contracts import OpenBiliError
from media_service_bridge.server import create_server
from async_fixture import run_async
from fixtures import NativeStub, config
from openbili_fixtures import ITEM, PROFILE, TOKEN, OpenBiliStub, openbili_config


def client_for(native, **changes):
    return OpenBiliClient(openbili_config(**changes), transport=httpx.MockTransport(native),
        environment={"OPENBILI_TEST_TOKEN": TOKEN})


class TestOpenBiliContracts(unittest.TestCase):
    def test_independent_config_origin_and_bounds(self):
        for value in ({"backend_url": "http://example.com"}, {"backend_url": "https://u:p@host"},
            {"backend_url": "https://host/path"}, {"backend_url": "https://host?q=1"},
            {"backend_url": "https://host#fragment"}, {"backend_url": "file:///secret"},
            {"backend_url": "http://127.0.0.1:0"}, {"backend_url": "https://host\n"},
            {"auth_token_env": "a\nb"}, {"auth_token_env": None}, {"auth_token": TOKEN},
            {"total_timeout_seconds": True}, {"total_timeout_seconds": float("nan")},
            {"response_bytes": 1048577}):
            with self.subTest(value=value), self.assertRaisesRegex(OpenBiliError, "openbili_not_configured"):
                openbili_config(**value)
        self.assertEqual(openbili_config(backend_url="https://service.example").backend_url, "https://service.example/")
        self.assertEqual(openbili_config(backend_url="http://[::1]:8123").backend_url, "http://[::1]:8123/")
        with self.assertRaises(OpenBiliError):
            OpenBiliConfig.from_document({})

    def test_unconfigured_openbili_does_not_break_six_bilinote_tools(self):
        async def exercise():
            native = BiliNoteClient(config(), transport=httpx.MockTransport(NativeStub()))
            absent = OpenBiliClient(None)
            try:
                plain = create_server(config(), client=native)
                self.assertEqual(len(await plain.list_tools()), 6)
                server = create_server(config(), client=native, openbili_client=absent)
                self.assertEqual(len(await server.list_tools()), 10)
                self.assertTrue((await native.get_instance())["service_instance_id"])
                with self.assertRaisesRegex(OpenBiliError, "openbili_not_configured"):
                    await absent.peek_recommendations(5)
                for token in (None, "", "line\nbreak", "nonascii\u2603"):
                    unavailable = OpenBiliClient(openbili_config(), environment={"OPENBILI_TEST_TOKEN": token})
                    with self.assertRaisesRegex(OpenBiliError, "openbili_not_configured"):
                        await unavailable.read_profile()
                    await unavailable.close()
            finally:
                await native.close()
                await absent.close()
        run_async(exercise())

    def test_peek_empty_never_falls_back_and_browse_projects_without_fabricated_exposure(self):
        async def exercise():
            native = OpenBiliStub()
            client = client_for(native)
            try:
                native.items = []
                value = await client.peek_recommendations(3)
                self.assertEqual(value["items"], [])
                self.assertEqual(value["native_side_effects"], "none")
                self.assertEqual([call.url.path for call in native.calls], ["/api/recommendations/peek"])
                native.items = [deepcopy(ITEM), {**ITEM, "id": 18}]
                peek = await client.peek_recommendations(1)
                self.assertEqual((len(peek["items"]), peek["total"], peek["has_more"]), (1, 2, True))
                browse = await client.read_recommendations(1)
                self.assertEqual(browse["native_side_effects"], "may_top_up_and_serve_recommendations")
                self.assertEqual(browse["exposure_evidence"], "not_established_by_this_read")
                self.assertEqual(browse["items"][0]["id"], ITEM["id"])
                self.assertEqual(native.calls[-1].url.query, b"")
            finally:
                await client.close()
        run_async(exercise())

    def test_profile_has_source_read_time_native_evidence_and_explicit_limits(self):
        async def exercise():
            native = OpenBiliStub()
            native.profile["likes"] *= 8
            native.profile["recent_cognition_updates"][0]["summary"] = "x" * 900
            native.profile["has_more_cognition_updates"] = True
            client = client_for(native)
            try:
                value = await client.read_profile()
                self.assertEqual(value["source"], "openbili")
                self.assertEqual(value["evidence_kind"], "native_inferred_profile")
                self.assertTrue(value["read_at_utc"].endswith("+00:00"))
                self.assertIn("user overrides", value["provenance_note"])
                self.assertFalse(value["complete"])
                self.assertTrue(value["truncated"])
                self.assertEqual(len(value["profile"]["likes"]), 6)
                cognition = value["profile"]["recent_cognition_updates"][0]
                self.assertEqual(cognition["evidence"], "Native evidence")
                self.assertEqual(cognition["source"], "content_feedback")
                self.assertEqual(len(cognition["summary"]), 500)
                self.assertNotIn("must-not-leak", json.dumps(value))
                native.profile = {"initialized": False}
                missing = await client.read_profile()
                self.assertEqual(missing["availability"], "not_initialized_or_native_read_failed")
                self.assertEqual(missing["profile"], {})
            finally:
                await client.close()
        run_async(exercise())

    def test_feedback_lost_response_exact_retry_and_native_conflict(self):
        async def exercise():
            native = OpenBiliStub()
            native.lose_next_feedback = True
            client = client_for(native)
            try:
                with self.assertRaises(OpenBiliError) as caught:
                    await client.submit_feedback(" retained-key ", 17, "like", "")
                self.assertEqual(caught.exception.code, "openbili_outcome_unknown")
                self.assertEqual(caught.exception.public()["request_id"], "retained-key")
                self.assertNotIn(TOKEN, json.dumps(caught.exception.public()))
                self.assertEqual(len(native.calls), 1)
                value = await client.submit_feedback("retained-key", 17, "like", "")
                self.assertTrue(value["duplicate"])
                self.assertEqual(value["event_id"], 23)
                self.assertEqual(value["processing"], "queued")
                self.assertEqual(value["profile_application"], "not_confirmed")
                with self.assertRaisesRegex(OpenBiliError, "openbili_feedback_conflict"):
                    await client.submit_feedback("retained-key", 17, "dislike", "")
                self.assertEqual(len(native.feedback), 1)
            finally:
                await client.close()
        run_async(exercise())

    def test_invalid_inputs_do_not_dispatch_and_only_native_feedback_types_are_allowed(self):
        async def exercise():
            native = OpenBiliStub()
            client = client_for(native)
            try:
                for limit in (0, 21, True, 1.5, "5"):
                    with self.assertRaisesRegex(OpenBiliError, "openbili_input_invalid"):
                        await client.peek_recommendations(limit)
                    with self.assertRaisesRegex(OpenBiliError, "openbili_input_invalid"):
                        await client.read_recommendations(limit)
                for key, rec, kind, note in (("", 17, "like", ""), ("x", True, "like", ""),
                    ("x", 17, "direct_viewing", ""), ("x", 17, "co_watching", ""),
                    ("x", 17, "defer", ""), ("x", 17, "favorite", ""), ("x", 17, "comment", " "),
                    ("x" * 401, 17, "like", ""), ("x", 17, "comment", "x" * 2001)):
                    with self.assertRaisesRegex(OpenBiliError, "openbili_input_invalid"):
                        await client.submit_feedback(key, rec, kind, note)
                self.assertEqual(native.calls, [])
                for kind in ("like", "dislike", "comment", "dismiss"):
                    self.assertEqual((await client.submit_feedback(kind, 17, kind, "actual user note"))["feedback_type"], kind)
            finally:
                await client.close()
        run_async(exercise())

    def test_redirect_auth_failure_and_private_error_text_are_never_followed_or_exposed(self):
        async def exercise():
            for status in (301, 302, 401, 403, 404, 500):
                native = OpenBiliStub()
                async def response(_request):
                    return httpx.Response(status, headers={"Location": "https://other.example/steal"},
                        json={"detail": "secret " + TOKEN})
                native.hook = response
                client = client_for(native)
                try:
                    with self.assertRaises(OpenBiliError) as caught:
                        await client.peek_recommendations(1)
                    self.assertNotIn(TOKEN, json.dumps(caught.exception.public()))
                    self.assertEqual(caught.exception.code,
                        "openbili_unauthorized" if status in (401, 403) else "openbili_unavailable")
                    self.assertEqual(len(native.calls), 1)
                finally:
                    await client.close()
        run_async(exercise())

    def test_wire_validation_and_decompressed_byte_cap(self):
        async def exercise():
            bodies = [b'{"items":[],"items":[]}', b'{"items":[],"bad":NaN}', b'[]', b'not json']
            for body in bodies + [gzip.compress(b'{"initialized":true,"junk":"' + b'x' * 1000 + b'"}')]:
                native = OpenBiliStub()
                async def response(_request):
                    headers = {"Content-Type": "application/json"}
                    if body.startswith(b'\x1f\x8b'):
                        headers["Content-Encoding"] = "gzip"
                    return httpx.Response(200, headers=headers, content=body)
                native.hook = response
                client = client_for(native, response_bytes=500)
                try:
                    with self.assertRaisesRegex(OpenBiliError, "openbili_response_invalid"):
                        await client.read_profile()
                finally:
                    await client.close()
        run_async(exercise())

    def test_inconsistent_list_and_feedback_success_are_refused(self):
        async def exercise():
            native = OpenBiliStub()
            client = client_for(native)
            try:
                for value in ({"items": [], "source": "pool", "total": 0, "has_more": False},
                    {"items": [ITEM], "source": "existing_recommendations", "total": 1, "has_more": True},
                    {"items": [{**ITEM, "content_url": "x" * 3000}], "source": "existing_recommendations", "total": 1, "has_more": False},
                    {"items": [{**ITEM, "id": True}], "source": "existing_recommendations", "total": 1, "has_more": False}):
                    async def response(_request):
                        return httpx.Response(200, json=value)
                    native.hook = response
                    with self.assertRaisesRegex(OpenBiliError, "openbili_response_invalid"):
                        await client.peek_recommendations(5)
                async def bad_receipt(_request):
                    return httpx.Response(200, json={"ok": True, "recommendation_id": 99,
                        "feedback_type": "like", "event_id": 23, "duplicate": False, "processing": "applied"})
                native.hook = bad_receipt
                with self.assertRaisesRegex(OpenBiliError, "openbili_outcome_unknown"):
                    await client.submit_feedback("key", 17, "like", "")
            finally:
                await client.close()
        run_async(exercise())

    def test_total_deadline_and_late_projection_success(self):
        async def exercise():
            native = OpenBiliStub()
            async def slow(_request):
                await asyncio.sleep(0.05)
            native.hook = slow
            client = client_for(native, total_timeout_seconds=0.01)
            try:
                with self.assertRaisesRegex(OpenBiliError, "openbili_unavailable"):
                    await client.read_profile()
                with self.assertRaisesRegex(OpenBiliError, "openbili_outcome_unknown"):
                    await client.read_recommendations(1)
                native.hook = None
                def late(_value):
                    time.sleep(0.025)
                    return {"ok": True}
                with patch("media_service_bridge.openbili_client.profile_summary", late):
                    with self.assertRaisesRegex(OpenBiliError, "openbili_unavailable"):
                        await client.read_profile()
                self.assertEqual(len(native.calls), 3)
            finally:
                await client.close()
        run_async(exercise())

    def test_sdk_schemas_annotations_and_validation_match_actual_registration(self):
        async def exercise():
            native = OpenBiliStub()
            client = client_for(native)
            bilinote = BiliNoteClient(config(), transport=httpx.MockTransport(NativeStub()))
            try:
                server = create_server(config(), client=bilinote, openbili_client=client)
                listed = {tool.name: tool for tool in await server.list_tools()}
                self.assertEqual(len(listed), 10)
                for name, tool in listed.items():
                    if not name.startswith("openbili_"):
                        continue
                    schema = tool.inputSchema
                    self.assertEqual(schema["type"], "object")
                    self.assertFalse(schema["additionalProperties"])
                    self.assertEqual(set(schema.get("required", [])), set(schema["properties"]))
                    self.assertTrue(all("description" in field for field in schema["properties"].values()))
                self.assertFalse(listed["openbili_read_recommendations"].annotations.readOnlyHint)
                self.assertFalse(listed["openbili_read_recommendations"].annotations.idempotentHint)
                self.assertTrue(listed["openbili_peek_recommendations"].annotations.readOnlyHint)
                self.assertTrue(listed["openbili_submit_feedback"].annotations.idempotentHint)
                self.assertTrue(listed["openbili_submit_feedback"].annotations.destructiveHint)
                for arguments in ({"limit": 0}, {"limit": True}, {"limit": 2, "backend_url": "https://other"}):
                    with self.assertRaises(Exception):
                        await server.call_tool("openbili_peek_recommendations", arguments)
                self.assertEqual(native.calls, [])
            finally:
                await client.close()
                await bilinote.close()
        run_async(exercise())
