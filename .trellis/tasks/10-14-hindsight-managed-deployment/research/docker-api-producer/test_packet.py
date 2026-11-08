"""Pure generated packet tests: no subprocess, Docker, API, PG or provider execution."""

import hashlib
import json
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fixture_support as support


class PacketContract(unittest.TestCase):
    def test_exact_commands_and_distinct_explicit_restart(self) -> None:
        first = {"token": support.TOKEN, "phase": "first", "firstSha256": None}
        restart = {"token": support.TOKEN, "phase": "restart", "firstSha256": "a" * 64}
        self.assertEqual(support.command(support.encode(first)), first)
        self.assertEqual(support.command(support.encode(restart)), restart)

    def test_unknown_phase_extra_keys_duplicate_keys_and_bound_refuse(self) -> None:
        invalid = [
            {"token": support.TOKEN, "phase": "auto-restart", "firstSha256": None},
            {"token": support.TOKEN, "phase": "first", "firstSha256": None, "command": "anything"},
            {"token": support.TOKEN, "phase": "restart", "firstSha256": None},
        ]
        for value in invalid:
            with self.assertRaises(support.FixtureFailure):
                support.command(support.encode(value))
        with self.assertRaises(support.FixtureFailure):
            support.command(b"x" * 257)
        with self.assertRaises(support.FixtureFailure):
            support.command(b'{"token":"x","token":"y"}')

    def test_restart_binds_original_successful_stop_bytes(self) -> None:
        previous = {"token": support.TOKEN, "phase": "first", "complete": True,
                    "stopped": {"shutdown_checked": True}, "privacyScan": {"complete": True}}
        raw = support.encode(previous)
        self.assertEqual(support.previous_result(raw, hashlib.sha256(raw).hexdigest()), previous)
        with self.assertRaises(support.FixtureFailure):
            support.previous_result(raw + b" ", hashlib.sha256(raw).hexdigest())
        previous["stopped"]["shutdown_checked"] = False
        raw = support.encode(previous)
        with self.assertRaises(support.FixtureFailure):
            support.previous_result(raw, hashlib.sha256(raw).hexdigest())

    def test_http_evidence_requires_authentication_and_same_lineage(self) -> None:
        names = ("change_journal", "logical_snapshot", "native_results", "application_state", "template_lifecycle", "template_backup")
        manifest = {"source_identity": {"compatibility_build": support.BUILD},
                    "provider": {"lineage": "generated-lineage", "database_dialect": "postgresql", "storage_mode": "sql_rows"},
                    "support": {"state": "supported"},
                    "contracts": {name: {"version": "1.0.0", "support": {"state": "supported"}} for name in names}}
        responses = [(401, b""), (200, b'{"status":"healthy"}'), (200, json.dumps(manifest).encode())]
        with patch.object(support, "get", side_effect=responses):
            self.assertEqual(support.http_evidence("generated-key", time.monotonic() + 1, "generated-lineage")["authenticatedStatus"], 200)
        with patch.object(support, "get", side_effect=[(200, b""), *responses[1:]]):
            with self.assertRaises(support.FixtureFailure):
                support.http_evidence("generated-key", time.monotonic() + 1, "generated-lineage")

    def test_volume_scan_detects_secret_split_between_chunks(self) -> None:
        location = Path(__file__).resolve().parent.parent / "c2b-api-producer-runtime-release-01a180b6-static"
        location.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=location, prefix="generated-") as directory:
            root = Path(directory)
            value = b"GENERATED_SPLIT_SECRET"
            (root / "data").write_bytes(b"x" * (1024 * 1024 - 4) + value)
            with patch.object(support, "ROOT", root):
                with self.assertRaisesRegex(support.FixtureFailure, "credential_on_volume"):
                    support.privacy_scan([value], time.monotonic() + 5)
                (root / "data").write_bytes(b"generated nonsecret data")
                self.assertTrue(support.privacy_scan([value], time.monotonic() + 5)["complete"])

    def test_volume_scan_deadline_is_incomplete_not_empty_success(self) -> None:
        location = Path(__file__).resolve().parent.parent / "c2b-api-producer-runtime-release-01a180b6-static"
        location.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=location, prefix="generated-") as directory:
            with patch.object(support, "ROOT", Path(directory)):
                with self.assertRaisesRegex(support.FixtureFailure, "scan_deadline"):
                    support.privacy_scan([b"generated"], time.monotonic() - 1)


if __name__ == "__main__":
    unittest.main()
