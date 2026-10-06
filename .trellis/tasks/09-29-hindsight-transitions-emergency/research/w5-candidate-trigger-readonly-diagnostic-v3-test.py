"""Pure fake-catalog/temporary-report regressions; no clone helper or DB access."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent


def load_diagnostic(version: int) -> Any:
    path = HERE / f"w5-candidate-trigger-readonly-diagnostic-v{version}.py"
    spec = importlib.util.spec_from_file_location(f"w5_diagnostic_v{version}_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


V2 = load_diagnostic(2)
V3 = load_diagnostic(3)


class FakeCatalog:
    """Model asyncpg's internal char codec at the SELECT expression boundary."""

    async def fetch(self, sql: str, *_args: Any, timeout: int) -> list[dict[str, Any]]:
        assert timeout == 10
        if "FROM pg_proc p" in sql:
            return [
                {
                    "proname": name,
                    "oid": str(index),
                    "arguments": "",
                    "definition": "FOR target_bank IN " + V3.endpoint_query(native_uuid=False) + " LOOP PERFORM guard",
                    "proconfig": ["search_path=public"] if index == 0 else None,
                }
                for index, name in enumerate(V3.FUNCTIONS)
            ]
        if "FROM pg_trigger t" in sql:
            # V2 receives bytes, fails its enabled check, then cannot serialize
            # even its failure report. V3 must request PostgreSQL text itself.
            enabled = "O" if "t.tgenabled::text AS tgenabled" in sql else b"O"
            return [
                {
                    "relname": name,
                    "tgname": "test_guard",
                    "tgenabled": enabled,
                    "proname": "guard_transition_association_write",
                    "definition": "CREATE TRIGGER test_guard FOR EACH ROW",
                }
                for name in V3.ASSOCIATIONS
            ]
        if "FROM pg_attribute a" in sql:
            columns = [(name, "id") for name in V3.ENDPOINTS] + [
                ("memory_links", "from_unit_id"),
                ("memory_links", "to_unit_id"),
                ("memory_links", "entity_id"),
                ("unit_entities", "unit_id"),
                ("unit_entities", "entity_id"),
                ("entity_cooccurrences", "entity_id_1"),
                ("entity_cooccurrences", "entity_id_2"),
            ]
            return [
                {"relname": name, "attname": column, "type": "uuid", "attnotnull": True} for name, column in columns
            ]
        if "FROM pg_index x" in sql:
            return [
                {
                    "relname": "entities",
                    "index_name": "test_pk",
                    "indisvalid": True,
                    "indisready": True,
                    "definition": "CREATE UNIQUE INDEX test_pk",
                }
            ]
        if "pg_total_relation_size" in sql:
            return [{"relname": "entities", "estimated_rows": 2, "relpages": 1, "bytes": 8192}]
        raise AssertionError("UNEXPECTED_FAKE_QUERY")


class DiagnosticReportTests(unittest.TestCase):
    def test_v2_reproduces_catalog_failure_and_unserializable_report(self) -> None:
        report: dict[str, Any] = {}
        with self.assertRaisesRegex(AssertionError, "INACTIVE_ASSOCIATION_TRIGGER"):
            asyncio.run(V2.inspect_catalog(V2.QueryOnly(FakeCatalog(), report), report))
        with self.assertRaises(TypeError):
            json.dumps(report)

    def test_v3_catalog_metadata_and_final_report_are_json(self) -> None:
        report: dict[str, Any] = {}
        asyncio.run(V3.inspect_catalog(V3.QueryOnly(FakeCatalog(), report), report))
        report.update({"diagnosticCompleted": True, "stopped": True, "portReleased": True})
        with tempfile.TemporaryDirectory(prefix="w5-report-test-") as root:
            path = Path(root) / "result.json"
            V3.write_result(path, report)
            result = json.loads(path.read_text(encoding="utf-8"))
        self.assertTrue(result["storedEndpointLookupMatchesReviewedTextPredicate"])
        self.assertTrue(all(row["tgenabled"] == "O" for row in result["triggers"]))
        for field in ("functions", "columns", "indexes", "tableEstimates"):
            self.assertEqual(result[field], report[field])
        self.assertNotIn("errorClass", result)
        self.assertNotIn("reportEncodingFailed", result)

    def test_encoding_failure_keeps_original_error_and_latest_cleanup(self) -> None:
        report: dict[str, Any] = {
            "triggers": [{"tgenabled": b"O"}],
            "errorClass": "AssertionError",
            "started": True,
            "stopped": True,
            "sourcePreserved": False,
            "inputPreserved": True,
            "corePreserved": True,
            "originalPreserved": True,
            "readerSourcesPreserved": False,
            "portReleased": False,
            "diagnosticCompleted": 1,
        }
        with tempfile.TemporaryDirectory(prefix="w5-report-test-") as root:
            path = Path(root) / "result.json"
            V3.write_result(path, report)
            first = json.loads(path.read_text(encoding="utf-8"))
            report.update({"readerSourcesPreserved": True, "portReleased": True})
            V3.write_result(path, report)
            final = json.loads(path.read_text(encoding="utf-8"))
        self.assertTrue(report["reportEncodingFailed"])
        self.assertEqual(report["errorClass"], "AssertionError")
        self.assertEqual(final["errorClass"], "AssertionError")
        self.assertEqual(final["reportEncodingErrorClass"], "TypeError")
        self.assertTrue(final["stopped"])
        self.assertFalse(final["sourcePreserved"])
        self.assertIsNone(final["diagnosticCompleted"])
        self.assertFalse(first["readerSourcesPreserved"])
        self.assertFalse(first["portReleased"])
        self.assertTrue(final["readerSourcesPreserved"])
        self.assertTrue(final["portReleased"])
        self.assertNotIn("triggers", final)

    def test_encoding_only_failure_is_closed_and_never_success(self) -> None:
        circular: list[Any] = []
        circular.append(circular)
        for payload, error_class in ((b"payload", "TypeError"), (circular, "ValueError"), (float("nan"), "ValueError")):
            with self.subTest(error_class=error_class), tempfile.TemporaryDirectory(prefix="w5-report-test-") as root:
                report: dict[str, Any] = {"payload": payload}
                path = Path(root) / "result.json"
                V3.write_result(path, report)
                result = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(report["errorClass"], "ReportSerializationError")
                self.assertEqual(result["errorClass"], "ReportSerializationError")
                self.assertEqual(result["reportEncodingErrorClass"], error_class)
                self.assertIsNone(result["stopped"])
                self.assertIsNone(result["sourcePreserved"])
                report["errorClass"] = "PRIVATE_EXCEPTION_NAME"
                V3.write_result(path, report)
                self.assertEqual(json.loads(path.read_text(encoding="utf-8"))["errorClass"], "OtherError")
                self.assertNotIn("PRIVATE_EXCEPTION_NAME", path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
