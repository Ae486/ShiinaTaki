"""Small delegation/preservation checks without data, PG, models or workers."""

from __future__ import annotations

import copy
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import w5_actual_embedding_control as control

entry = control.load(
    "w5_actual_telemetry_tested", "w5-candidate-actual-embedding-telemetry.py"
)


def original_result():
    return {
        "diagnosticSucceeded": True,
        "directWorkerIdentityVerified": True,
        "childReport": {
            "actualHelperManifestSha256": entry.V2_SHA,
            "nativeApplyBudgetPassed": False,
        },
        "watchdog": {"timeout": None, "childExitCode": 0},
        "preservation": {"sourcePreserved": True},
        "cleanup": {"stopped": True},
    }


class WrapperTests(unittest.TestCase):
    def test_original_v2_failure_keeps_result_and_writes_separate_failure_report(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            source = {"verified": True, "sha256": "wrapper", "entries": 1}
            failed = original_result()
            failed["diagnosticSucceeded"] = False
            control.write_json(job / "result.json", failed)
            before = (job / "result.json").read_bytes()
            v2 = SimpleNamespace(start_worker=Mock(), v1_runner=Mock())

            def run():
                v2.start_worker(job, environment={})
                raise RuntimeError("private V2 failure message")

            v2.run_reviewed = run
            with (
                patch.object(entry, "verify_manifest", return_value=source),
                patch.object(control, "load", return_value=v2),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(entry.run_reviewed(), job)
            self.assertEqual((job / "result.json").read_bytes(), before)
            result = control.read_json(job / "telemetry-result.json")
            self.assertFalse(result["diagnosticSucceeded"])
            self.assertFalse(result["v2DiagnosticSucceeded"])
            self.assertEqual(result["wrapperErrorClass"], "RuntimeError")
            self.assertNotIn(
                "private V2 failure", (job / "telemetry-result.json").read_text()
            )

    def test_summary_retains_original_failures_and_budget_separation(self):
        source = {"verified": True, "sha256": "s", "entries": 1}
        telemetry = {"samples": 2, "errors": {}, "backendSamples": {}}
        original = original_result()
        untouched = copy.deepcopy(original)
        result = entry.summarize(original, telemetry, source, source)
        self.assertTrue(result["diagnosticSucceeded"])
        self.assertFalse(result["nativeApplyBudgetPassed"])
        self.assertEqual(result["postgresBackendObservations"], "absent-by-design")
        self.assertEqual(original, untouched)
        original["diagnosticSucceeded"] = False
        self.assertFalse(
            entry.summarize(original, telemetry, source, source)["diagnosticSucceeded"]
        )
        original["diagnosticSucceeded"] = True
        for changed in (
            {**telemetry, "samples": 0},
            {**telemetry, "errors": {"OSError": 1}},
            {**telemetry, "backendSamples": {"guessed": 1}},
        ):
            self.assertFalse(
                entry.summarize(original, changed, source, source)[
                    "diagnosticSucceeded"
                ]
            )
        self.assertFalse(
            entry.summarize(original, telemetry, source, {"verified": False})[
                "diagnosticSucceeded"
            ]
        )

    def test_v2_delegation_preserves_result_bytes_source_inventory_and_watchdog(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            source = {"verified": True, "sha256": "wrapper", "entries": 1}
            telemetry = {"samples": 2, "errors": {}, "backendSamples": {}}
            v2 = SimpleNamespace()
            runner = SimpleNamespace()
            child, expected_watchdog = object(), {"unchanged": "watchdog-result"}
            start = Mock(return_value=child)
            v2.start_worker = start
            v2.v1_runner = Mock(return_value=runner)
            before_manifest = control.MANIFEST
            sampler = SimpleNamespace(sample=Mock(), report=lambda: telemetry)

            def supervise(received, reader, **kwargs):
                self.assertIs(received, child)
                self.assertEqual(kwargs, {"record": "original-recorder"})
                self.assertEqual(reader(), {"phase": "apply-and-lookup"})
                return expected_watchdog

            def run():
                selected = v2.v1_runner()
                actual = v2.start_worker(job, environment={"explicit": "same"})
                self.assertIs(
                    selected.control.supervise(
                        actual,
                        lambda: {"phase": "apply-and-lookup"},
                        record="original-recorder",
                    ),
                    expected_watchdog,
                )
                control.write_json(job / "result.json", original_result())
                return job

            v2.run_reviewed = run
            with (
                patch.object(entry, "verify_manifest", return_value=source) as verify,
                patch.object(control, "load", return_value=v2),
                patch.object(control, "supervise", side_effect=supervise),
                patch.object(entry, "Sampler", return_value=sampler),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(entry.run_reviewed(), job)
            self.assertEqual(verify.call_count, 2)
            self.assertEqual(control.MANIFEST, before_manifest)
            start.assert_called_once_with(job, environment={"explicit": "same"})
            self.assertIs(v2.start_worker, start)
            original = (job / "result.json").read_bytes()
            self.assertEqual(control.read_json(job / "result.json"), original_result())
            result = control.read_json(job / "telemetry-result.json")
            self.assertTrue(result["diagnosticSucceeded"])
            self.assertEqual(
                result["v2ResultSha256"], control.digest(job / "result.json")
            )
            self.assertEqual((job / "result.json").read_bytes(), original)
            self.assertFalse(result["nativeApplyBudgetPassed"])

    def test_default_does_not_verify_or_execute(self):
        with (
            patch.object(entry, "run_reviewed") as run,
            patch.object(entry, "verify_manifest") as verify,
            patch("sys.argv", ["wrapper"]),
            redirect_stdout(io.StringIO()) as output,
        ):
            entry.main()
        run.assert_not_called()
        verify.assert_not_called()
        self.assertIn("executed=false", output.getvalue())


if __name__ == "__main__":
    unittest.main()
