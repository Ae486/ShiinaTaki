"""Offline-only boundary tests: no corpus, model, PostgreSQL, or child worker."""

from __future__ import annotations

import asyncio
import copy
import io
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from uuid import UUID

import w5_actual_embedding_control as control
import w5_baseline_profile_metrics as metrics

entry = control.load("w5_baseline_tested", "w5-baseline-readonly-profile.py")


class FakeClock:
    def __init__(self):
        self.value = 0

    def __call__(self):
        return self.value

    def advance(self, amount):
        self.value += amount


class ProfileTests(unittest.TestCase):
    def test_nested_exclusive_cpu_and_wall_do_not_double_count(self):
        wall, cpu = FakeClock(), FakeClock()
        profile = metrics.Profile(wall=wall, cpu=cpu)

        def leaf():
            wall.advance(7)
            cpu.advance(3)
            return "original"

        child = profile.sync("child", leaf)

        def parent():
            wall.advance(2)
            cpu.advance(1)
            value = child()
            wall.advance(5)
            cpu.advance(2)
            return value

        self.assertEqual(profile.sync("parent", parent)(), "original")
        parent_metric, child_metric = profile.codecs["parent"], profile.codecs["child"]
        self.assertEqual((parent_metric.wall_ns, parent_metric.thread_cpu_ns), (14, 6))
        self.assertEqual(
            (parent_metric.exclusive_wall_ns, parent_metric.exclusive_thread_cpu_ns),
            (7, 3),
        )
        self.assertEqual(
            (child_metric.exclusive_wall_ns, child_metric.exclusive_thread_cpu_ns),
            (7, 3),
        )
        self.assertEqual(profile.frames, [])

    def test_original_exception_identity_and_frame_cleanup(self):
        profile = metrics.Profile()
        error = ValueError("must never appear in reports")

        def fail():
            raise error

        with self.assertRaises(ValueError) as caught:
            profile.sync("failure", fail)()
        self.assertIs(caught.exception, error)
        self.assertEqual(profile.codecs["failure"].failures, 1)
        self.assertEqual(profile.frames, [])
        self.assertNotIn(str(error), json.dumps(profile.report()))

    def test_async_inclusive_boundaries_and_context_reset_on_cancellation(self):
        profile = metrics.Profile()

        async def stop():
            self.assertEqual(profile.stage.get(), ("boundary",))
            raise asyncio.CancelledError()

        with self.assertRaises(asyncio.CancelledError):
            asyncio.run(profile.asynchronous("boundary", stop)())
        self.assertEqual(profile.stage.get(), ())
        self.assertEqual(profile.boundaries["boundary"].failures, 1)

    def test_buckets_are_bounded(self):
        profile = metrics.Profile()
        for index in range(metrics.MAX_BUCKETS):
            profile.bucket(profile.sql, str(index))
        with self.assertRaisesRegex(AssertionError, "PROFILE_BUCKET_LIMIT"):
            profile.bucket(profile.sql, "overflow")


class ReadOnlyTests(unittest.TestCase):
    def test_refuses_dml_locks_side_effects_and_multiple_statements(self):
        for query in (
            "DELETE FROM x",
            "WITH a AS (DELETE FROM x) SELECT 1",
            "SELECT * FROM x FOR UPDATE",
            "SELECT * FROM x FOR NO KEY UPDATE",
            "SELECT set_config('x','y',true)",
            "SELECT nextval('x')",
            "SELECT 1; SELECT 2",
            "ALTER TABLE x ADD y int",
        ):
            with self.subTest(query=query), self.assertRaises(AssertionError):
                metrics.validate_sql(query)
        self.assertEqual(
            metrics.validate_sql("SET LOCAL TIME ZONE 'UTC'"),
            "SET LOCAL TIME ZONE 'UTC'",
        )

    def test_transparent_return_failure_and_no_bound_values_in_metrics(self):
        result, failure = object(), RuntimeError("private failure body")
        calls = []

        class Delegate:
            async def fetch(self, query, *args, **kwargs):
                calls.append((query, args, kwargs))
                if args == ("fail",):
                    raise failure
                return result

        profile = metrics.Profile()
        connection = metrics.ReadConnection(Delegate(), profile)
        self.assertIs(
            asyncio.run(
                connection.fetch(
                    "SELECT head FROM sample WHERE id=$1", "private-id", timeout=100
                )
            ),
            result,
        )
        self.assertEqual(calls[0][2]["timeout"], 30)
        with self.assertRaises(RuntimeError) as caught:
            asyncio.run(connection.fetch("SELECT head FROM sample WHERE id=$1", "fail"))
        self.assertIs(caught.exception, failure)
        serialized = json.dumps(profile.report())
        self.assertNotIn("private-id", serialized)
        self.assertNotIn(str(failure), serialized)
        with self.assertRaises(AssertionError):
            asyncio.run(connection.fetch("DELETE FROM sample"))
        self.assertEqual(len(calls), 2)


def complete_result(job):
    identity = {"pid": 17, "executable": "safe-python", "creationTicks": 123}
    control.write_json(job / "child.json", identity)
    control.write_json(
        job / "worker-self.json",
        {"identity": identity, "heldPid": 17, "scriptPid": 17, "verified": True},
    )
    passes = [
        {
            "pass": name,
            "completed": True,
            "readOnly": True,
            "isolation": "repeatable read",
            **{
                key: "a" * 64
                for key in (
                    "baselineHash",
                    "nativeHash",
                    "applicationHash",
                    "auxiliaryHash",
                )
            },
        }
        for name in entry.PASSES
    ]
    result = {
        "watchdog": {"childExitCode": 0, "timeout": None},
        "cleanup": {"stopped": True, "portReleased": True},
        "childReport": {
            "baselineProfile": {"completed": True, "passes": passes},
            "readOnlyTablesPreserved": True,
            "applyCalls": 0,
            "modelCalls": 0,
        },
        "preservation": {
            key: True
            for key in (
                "sourcePreserved",
                "inputPreserved",
                "corePreserved",
                "originalPreserved",
                "sourcesPreserved",
            )
        },
    }
    return result, {"backendSamples": {"light": 1, "detail": 1}}


class CustodyAndReportTests(unittest.TestCase):
    def test_report_requires_both_proofs_custody_cleanup_and_real_observations(self):
        with tempfile.TemporaryDirectory() as folder:
            job = Path(folder)
            result, telemetry = complete_result(job)
            self.assertTrue(
                entry.final_report(job, copy.deepcopy(result), telemetry)[
                    "diagnosticSucceeded"
                ]
            )
            variants = []
            for section, key, value in (
                ("cleanup", "stopped", False),
                ("watchdog", "timeout", "overall"),
                ("preservation", "sourcePreserved", False),
                ("childReport", "applyCalls", 1),
            ):
                changed = copy.deepcopy(result)
                changed[section][key] = value
                variants.append(changed)
            changed = copy.deepcopy(result)
            changed["childReport"]["baselineProfile"]["passes"][1]["baselineHash"] = (
                "b" * 64
            )
            variants.append(changed)
            for value in variants:
                self.assertFalse(
                    entry.final_report(job, value, telemetry)["diagnosticSucceeded"]
                )
            self.assertFalse(
                entry.final_report(
                    job, copy.deepcopy(result), {"backendSamples": {"light": 1}}
                )["diagnosticSucceeded"]
            )
            control.write_json(
                job / "worker-self.json",
                {
                    "identity": {"pid": 99},
                    "heldPid": 99,
                    "scriptPid": 99,
                    "verified": True,
                },
            )
            self.assertFalse(
                entry.final_report(job, result, telemetry)["diagnosticSucceeded"]
            )

    def test_sampler_refuses_replaced_process_before_resource_read(self):
        identity = SimpleNamespace(value={"pid": 3, "creationTicks": 2}, close=Mock())
        sampler = metrics.Sampler(Path("unused"), identity_factory=lambda _: identity)
        with (
            patch.object(metrics, "resources") as read,
            self.assertRaises(AssertionError),
        ):
            sampler.process({"pid": 3, "creationTicks": 1})
        read.assert_not_called()
        identity.close.assert_called_once()

    def test_sampler_limit_prevents_extra_io_and_missing_is_not_zero(self):
        sampler = metrics.Sampler(Path("unused"), clock=lambda: 100)
        sampler.samples = metrics.MAX_SAMPLES
        with patch.object(control, "read_json") as read:
            sampler.sample({"phase": "baseline", "pass": "light"})
        read.assert_not_called()
        self.assertEqual(sampler.backend_samples, {})

    def test_parent_reuses_v2_launch_and_supervisor_without_global_patch(self):
        with tempfile.TemporaryDirectory() as folder:
            job = Path(folder)
            result, telemetry = complete_result(job)
            original_popen = subprocess.Popen
            runner = SimpleNamespace(subprocess=subprocess)
            v2 = SimpleNamespace(V2_ENTRY=None)

            def launch(received, **kwargs):
                self.assertEqual(received, job)
                self.assertEqual(v2.V2_ENTRY, entry.ENTRY)
                self.assertIs(subprocess.Popen, original_popen)
                return object()

            v2.start_worker = Mock(side_effect=launch)

            def run():
                child = runner.subprocess.Popen(
                    [
                        str(control.PYTHON),
                        "-B",
                        "-s",
                        str(control.HERE / "w5-candidate-actual-embedding.py"),
                        "--owned-job",
                        str(job),
                    ],
                    env=control.OFFLINE,
                )
                runner.control.supervise(
                    child, lambda: {"phase": "baseline", "pass": "light"}
                )
                control.write_json(job / "result.json", result)
                return job

            runner.run_reviewed = run
            sampler = SimpleNamespace(sample=Mock(), report=lambda: telemetry)

            def supervise(_child, reader, **_kwargs):
                reader()
                return result["watchdog"]

            with (
                patch.object(entry, "configure_manifest"),
                patch.object(control, "load", side_effect=[runner, v2]),
                patch.object(entry, "Sampler", return_value=sampler),
                patch.object(control, "supervise", side_effect=supervise),
                redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(entry.parent_run(), job)
            self.assertTrue(
                control.read_json(job / "result.json")["diagnosticSucceeded"]
            )
            sampler.sample.assert_called_once()
            self.assertIs(subprocess.Popen, original_popen)


class EntryTests(unittest.TestCase):
    def test_actual_default_process_imports_no_model(self):
        code = "import runpy,sys; sys.argv=[sys.argv[1]]; runpy.run_path(sys.argv[0],run_name='__main__'); assert not any(n in sys.modules for n in ('torch','sentence_transformers'))"
        result = subprocess.run(
            [sys.executable, "-B", "-s", "-c", code, str(entry.ENTRY)],
            cwd=control.HERE,
            env=control.clean_environment(),
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("executed=false", result.stdout)

    def test_default_is_noop_even_without_manifest(self):
        with (
            patch.object(entry, "configure_manifest") as configure,
            patch.object(entry, "parent_run") as run,
            patch.object(entry.sys, "argv", [str(entry.ENTRY)]),
            redirect_stdout(io.StringIO()) as output,
        ):
            entry.main()
        configure.assert_not_called()
        run.assert_not_called()
        self.assertIn("executed=false", output.getvalue())

    def test_wrong_sealed_v2_manifest_refuses_before_current_verification(self):
        with (
            patch.object(control, "digest", return_value="changed"),
            patch.object(control, "verify_sources") as verify,
        ):
            with self.assertRaisesRegex(AssertionError, "V2_MANIFEST_CHANGED"):
                entry.configure_manifest()
        verify.assert_not_called()


class PreservedInputTests(unittest.TestCase):
    """Parent-authorized read of the exact stopped offline SQLite derivative only."""

    def test_actual_request_and_baseline_return_shape_without_pg(self):
        native = Path("H:/hindsight/hindsight-api-slim")
        inputs = (
            control.RUNTIME
            / "w5-reentry-candidate-timeout-500a3683cc5d45e8ab52f92beb7f2205"
        )
        path = inputs / "application.sqlite"
        manifest = control.read_json(inputs / "copy-manifest.json")
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        self.assertEqual(before, manifest["files"]["application.sqlite"]["sha256"])
        sys.path.insert(0, str(native))
        try:
            from hindsight_api.engine.transition_snapshot import TransitionBaseline
            from hindsight_api.engine.application_state import codec

            baseline = TransitionBaseline("n", "a", "x", "b", [])
            self.assertEqual(
                (
                    baseline.native_records_hash,
                    baseline.application_records_hash,
                    baseline.auxiliary_records_hash,
                    baseline.baseline_hash,
                    len(baseline.auxiliary),
                ),
                ("n", "a", "x", "b", 0),
            )

            def verify_input():
                self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)

            clone = SimpleNamespace(
                INPUT=inputs,
                TRANSITION=UUID("6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53"),
                verify_input=verify_input,
                candidate_audit=SimpleNamespace(
                    DELTA_OPERATION=UUID("6497dfc9-e287-4cb1-96b5-1020ea1eabc4"),
                    DELTA_HASH="946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7",
                ),
            )
            bank, request = entry.request_input(clone)
            self.assertIsInstance(bank, str)
            self.assertTrue(bank)
            self.assertEqual(
                request.operation_id, clone.candidate_audit.DELTA_OPERATION
            )
            self.assertEqual(request.request_hash, clone.candidate_audit.DELTA_HASH)
            self.assertIsNotNone(request.baseline_transition_id)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
            self.assertFalse(
                any(name in sys.modules for name in ("torch", "sentence_transformers"))
            )
            original_decode = codec.decode_json
            profiler = metrics.Profile()
            with self.assertRaisesRegex(RuntimeError, "forced-wrapper-cleanup"):
                with profiler.installed():
                    self.assertIsNot(codec.decode_json, original_decode)
                    self.assertEqual(codec.decode_json(b'{"count":1}'), {"count": 1})
                    raise RuntimeError("forced-wrapper-cleanup")
            self.assertIs(codec.decode_json, original_decode)
            self.assertEqual(profiler.undo, [])
            self.assertEqual(profiler.codecs["decode_json"].calls, 1)
        finally:
            sys.path.remove(str(native))


if __name__ == "__main__":
    unittest.main()
