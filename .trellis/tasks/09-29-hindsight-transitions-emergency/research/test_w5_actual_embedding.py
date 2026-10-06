"""Fake-only checks: no actual model, source corpus, clone, or PostgreSQL starts."""

from __future__ import annotations

import ast
import asyncio
import importlib.util
import os
import subprocess
import sys
import tempfile
import time
import unittest
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import w5_actual_embedding_composition as composition
import w5_actual_embedding_control as control

spec = importlib.util.spec_from_file_location("actual_runner_test", control.HERE / "w5-candidate-actual-embedding.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class FakeModel:
    dimension = 3
    _device_type = "fake-auto-device"
    _model = None

    def __init__(self, **options):
        self.options = options
        self.model_name = options["model_name"]
        self.inputs = []

    async def initialize(self):
        pass

    def encode_documents(self, texts):
        self.inputs.extend(texts)
        return [[1.0, 2.0, 3.0] for _ in texts]


class EmbeddingTests(unittest.TestCase):
    def test_rehearsal_direct_result_sink_is_also_sanitized(self):
        saved = []
        diagnostic = SimpleNamespace(write_result=lambda path, value: saved.append(value))
        clone = object()
        rehearsal = SimpleNamespace(load=lambda name, filename: diagnostic if "diagnostic-v3" in filename else clone)

        def run_reviewed(*, with_apply):
            self.assertTrue(with_apply)
            writer = rehearsal.load("writer", "w5-candidate-trigger-readonly-diagnostic-v3.py")
            self.assertIs(rehearsal.load("clone", "w5-reentry-candidate-native-clone.py"), clone)
            writer.write_result(Path("not-written.json"), {"realModelCalls": 0, "syntheticVectorDimension": 384})

        rehearsal.run_reviewed = run_reviewed
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(os.environ, {}, clear=True),
            patch.object(control, "verify_sources"),
            patch.object(control, "load", return_value=rehearsal),
            patch.object(control, "digest", return_value="fake-sha"),
            patch.object(composition, "install") as install,
        ):
            composition.run_child(Path(temporary))
        install.assert_called_once()
        self.assertEqual(saved[0]["actualHelperManifestSha256"], "fake-sha")
        self.assertNotIn("realModelCalls", saved[0])
        self.assertNotIn("syntheticVectorDimension", saved[0])

    def test_frozen_date_formatter_remains_equivalent_without_engine_initialization(self):
        path = Path("H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py")
        tree = ast.parse(path.read_text(encoding="utf-8"))
        method = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef) and node.name == "_format_readable_date"
        )
        namespace = {"datetime": datetime}
        exec(compile(ast.Module(body=[method], type_ignores=[]), str(path), "exec"), namespace)
        for month in range(1, 13):
            stamp = datetime(2026, month, 17)
            self.assertEqual(namespace["_format_readable_date"](None, stamp), stamp.strftime("%B %Y"))

    def test_original_preparation_augmentation_and_encoder_delegate(self):
        # Import production preparation only under the clean offline environment.
        # A fake backend handles documents through the real worker-thread path.
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(os.environ, control.clean_environment(), clear=True),
        ):
            sys.path.insert(0, "H:/hindsight/hindsight-api-slim")
            from hindsight_api.engine.retain import embedding_utils
            from hindsight_api.engine.transfer.current_state_rows import prepare_current_state_rows

            job, report = Path(temporary), {}
            model = asyncio.run(composition.initialize_model(job, report, FakeModel))
            unit = dict(
                entities=["Ada"],
                occurred_start="2026-10-01T00:00:00Z",
                occurred_end=None,
                mentioned_at=None,
                context=None,
                metadata=None,
                tags=[],
                observation_scopes=None,
            )
            request = SimpleNamespace(
                memory_units=[
                    SimpleNamespace(text="A fact", fact_type="world", **unit),
                    SimpleNamespace(text="An observation", fact_type="observation", **unit),
                ],
                mental_models=[SimpleNamespace(name="Name", content="Content")],
            )
            synthetic = SimpleNamespace(dimension=3, encode_documents=Mock(side_effect=AssertionError("synthetic")))
            prepare = composition.prepare_interceptor(prepare_current_state_rows, model, report)
            with patch.object(
                embedding_utils, "get_config", return_value=SimpleNamespace(embeddings_max_input_tokens=None)
            ):
                result = asyncio.run(
                    prepare(
                        request=request,
                        embeddings_model=synthetic,
                        format_date_fn=lambda stamp: stamp.strftime("%B %Y"),
                    )
                )
            self.assertEqual(
                model.inputs, ["A fact (happened in October 2026) [Ada]", "An observation", "Name Content"]
            )
            self.assertEqual(len(result.facts), 2)
            self.assertEqual(result.model_embeddings, [[1.0, 2.0, 3.0]])
            self.assertEqual([row["inputs"] for row in report["documentBatches"]], [2, 1])
            self.assertTrue(all(row["completed"] for row in report["documentBatches"]))
            self.assertEqual(report["syntheticEncoderCalls"], 0)
            self.assertEqual(model.options, composition.MODEL_OPTIONS)
            self.assertFalse(model.options["force_cpu"])
            self.assertEqual(report["device"], "fake-auto-device")
            with self.assertRaisesRegex(RuntimeError, "QUERY_ENCODING_REFUSED"):
                model.encode_query(["private query"])
            with self.assertRaisesRegex(RuntimeError, "SYNTHETIC_ENCODING_REFUSED"):
                synthetic.encode_documents(["private document"])
            self.assertNotIn("private", (job / "embedding.json").read_text())

    def test_dimension_refuses_before_prepare(self):
        original = Mock()
        model = FakeModel(**composition.MODEL_OPTIONS)
        prepare = composition.prepare_interceptor(original, model, {"syntheticEncoderCalls": 0})
        with self.assertRaisesRegex(AssertionError, "STORED_VECTOR_DIMENSION_MISMATCH"):
            asyncio.run(prepare(request=object(), embeddings_model=SimpleNamespace(dimension=4), format_date_fn=None))
        original.assert_not_called()

    def test_offline_initialization_failure_has_no_fallback(self):
        factory = Mock(side_effect=OSError("private cache details"))
        with tempfile.TemporaryDirectory() as temporary:
            job, report = Path(temporary), {}
            with self.assertRaises(OSError):
                asyncio.run(composition.initialize_model(job, report, factory))
            factory.assert_called_once_with(**composition.MODEL_OPTIONS)
            self.assertFalse(report["initializationCompleted"])
            self.assertEqual(control.read_json(job / "phase.json")["phase"], "initialization-failed")
            self.assertNotIn("private", (job / "embedding.json").read_text())

    def test_environment_excludes_secrets_overrides_and_model_download(self):
        value = control.clean_environment(
            {
                "Path": "safe",
                "HINDSIGHT_API_API_KEY": "secret",
                "PGPASSWORD": "secret",
                "OPENAI_API_KEY": "secret",
                "HF_TOKEN": "secret",
                "PYTHONPATH": "bad",
            }
        )
        self.assertEqual(value, {"Path": "safe", **control.OFFLINE})

    def test_hf_credential_redirect_does_not_change_model_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            environment = control.child_environment(job)
            self.assertEqual(environment["HF_TOKEN_PATH"], str(job / "no-external-hf-credentials/token"))
            self.assertNotIn("HF_HOME", environment)
            self.assertNotIn("HF_HUB_CACHE", environment)
            (job / "no-external-hf-credentials").mkdir()
            with self.assertRaisesRegex(AssertionError, "HF_CREDENTIAL_PATH_PRESENT"):
                control.child_environment(job)

    def test_result_removes_synthetic_claims_and_separates_budget(self):
        original = {
            "meaning": "synthetic",
            "realModelCalls": 0,
            "syntheticVectorDimension": 3,
            "stages": [{"name": "full-apply", "completed": True, "milliseconds": 60100}],
            "applyElapsedMs": 60800,
            "applyCompleted": True,
        }
        result = composition.actual_report(original, {"syntheticEncoderCalls": 0})
        self.assertNotIn("syntheticVectorDimension", result)
        self.assertNotIn("realModelCalls", result)
        self.assertFalse(result["nativeApplyBudgetPassed"])
        self.assertTrue(result["applyCompleted"])
        self.assertEqual(result["subsequentLookupAndBookkeepingMilliseconds"], 700)
        self.assertEqual(original["meaning"], "synthetic")


class FakeProcess:
    def __init__(self):
        self.pid = 777
        self.code = None
        self.terminations = 0

    def poll(self):
        return self.code

    def terminate(self):
        self.terminations += 1
        self.code = 1

    def wait(self, timeout):
        return self.code


class WatchdogTests(unittest.TestCase):
    def test_timeout_fact_is_recorded_before_termination_failure(self):
        child = FakeProcess()
        records = []
        with patch.object(child, "terminate", side_effect=OSError("cannot terminate")):
            with self.assertRaises(OSError):
                control.supervise(
                    child,
                    lambda: {"phase": "initializing", "monotonic": -200},
                    clock=lambda: 0,
                    record=lambda value: records.append(value.copy()),
                )
        self.assertEqual(records[0]["timeout"], "initialization")
        self.assertFalse(records[0]["terminatedOwnedChild"])

    @unittest.skipUnless(os.name == "nt", "Parent harness uses Windows process flags")
    def test_parent_watchdog_error_terminates_held_child_and_writes_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            child = FakeProcess()
            child.pid = 777
            clone = SimpleNamespace(data_manifest=lambda _: {"files": {}}, owner=SimpleNamespace(ROOT=root))
            identity = SimpleNamespace(value={"pid": 777}, close=Mock())
            preserved = {
                key: True
                for key in (
                    "sourcePreserved",
                    "inputPreserved",
                    "corePreserved",
                    "originalPreserved",
                    "sourcesPreserved",
                )
            }
            with (
                patch.object(control, "RUNTIME", root),
                patch.object(control, "verify_sources"),
                patch.object(control, "digest", return_value="fake-hash"),
                patch.object(control, "load", return_value=clone),
                patch.object(control, "ProcessIdentity", return_value=identity),
                patch.object(control, "supervise", side_effect=ValueError("private error")),
                patch.object(runner, "preservation", return_value=preserved),
                patch.object(subprocess, "Popen", return_value=child),
            ):
                job = runner.run_reviewed()
            self.assertEqual(child.terminations, 1)
            saved = control.read_json(job / "result.json")
            self.assertFalse(saved["diagnosticSucceeded"])
            self.assertTrue(saved["terminatedOwnedChildAfterError"])
            self.assertFalse(saved["childReportPresent"])
            self.assertEqual(saved["preservation"], preserved)
            self.assertNotIn("private error", (job / "result.json").read_text())

    def test_both_monotonic_deadlines_and_only_exact_child_terminated(self):
        for phase, expected in (
            ({"phase": "initializing", "monotonic": 0}, "initialization"),
            ({"phase": "apply-and-lookup"}, "overall"),
        ):
            with self.subTest(expected=expected):
                now = [0.0]
                child, unrelated = FakeProcess(), FakeProcess()

                def advance(seconds):
                    now[0] += seconds

                result = control.supervise(
                    child, lambda: phase, clock=lambda: now[0], sleep=advance, init_seconds=1, overall_seconds=2
                )
                self.assertEqual(result["timeout"], expected)
                self.assertEqual(child.terminations, 1)
                self.assertEqual(unrelated.terminations, 0)

    def test_completed_child_never_terminated(self):
        child = FakeProcess()
        child.code = 0
        result = control.supervise(child, lambda: {})
        self.assertEqual(result["childExitCode"], 0)
        self.assertIsNone(result["timeout"])
        self.assertEqual(child.terminations, 0)

    @unittest.skipUnless(os.name == "nt", "Windows exact handle check")
    def test_real_owned_fake_worker_blocked_in_sync_sleep_is_terminated(self):
        # A plain Python sleeper stands in for blocking model initialization.
        # No helper, model, database, HTTP service, or corpus runs here.
        child = subprocess.Popen(
            [sys.executable, "-B", "-c", "import time; time.sleep(30)"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
            env=control.clean_environment(),
        )
        try:
            identity = control.ProcessIdentity(child.pid)
            self.assertEqual(identity.value["pid"], child.pid)
            identity.close()
            result = control.supervise(
                child,
                lambda: {"phase": "initializing", "monotonic": time.monotonic() - 1},
                init_seconds=0.1,
                overall_seconds=2,
            )
            self.assertTrue(result["terminatedOwnedChild"])
            self.assertIsNotNone(child.poll())
        finally:
            if child.poll() is None:
                child.terminate()
            child.wait(timeout=5)


class CustodyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.clone = self.root / "w5-candidate-native-clone-fake"
        (self.clone / "data").mkdir(parents=True)
        self.pointer = {
            "clone": str(self.clone),
            "data": str(self.clone / "data"),
            "port": 6543,
            "postgres": str(control.POSTGRES.resolve()),
        }
        control.write_json(
            self.clone / "ownership.json",
            {"kind": "candidate-diagnostic-clone", "data": self.pointer["data"], "port": 6543, "stopped": False},
        )
        self.patch = patch.object(control, "RUNTIME", self.root)
        self.patch.start()
        self.pid_file = self.clone / "data/postmaster.pid"
        self.pid_file.write_text(f"1234\n{self.clone / 'data'}\n1700000000\n6543\n")
        self.identity = SimpleNamespace(
            value={
                "pid": 1234,
                "executable": str(control.POSTGRES.resolve()),
                "creationTicks": (1700000000 + 11644473600) * 10000000,
            },
            close=Mock(),
        )

    def tearDown(self):
        self.patch.stop()
        self.temporary.cleanup()

    def test_pid_path_port_executable_and_creation_identity(self):
        self.assertIs(control.owned_pg(self.pointer, lambda _: self.identity), self.identity)
        for key, bad in (("executable", str(self.root / "foreign.exe")), ("creationTicks", 1)):
            with self.subTest(key=key):
                good = self.identity.value[key]
                self.identity.value[key] = bad
                with self.assertRaises(AssertionError):
                    control.owned_pg(self.pointer, lambda _: self.identity)
                self.identity.value[key] = good
        self.pointer["process"] = {**self.identity.value, "pid": 9999}
        with self.assertRaisesRegex(AssertionError, "PG_PROCESS_REPLACED"):
            control.owned_pg(self.pointer, lambda _: self.identity)
        self.pointer.pop("process")
        self.pid_file.write_text(f"1234\n{self.root}\n1700000000\n6543\n")
        with self.assertRaisesRegex(AssertionError, "PG_PID_DATA_REFUSED"):
            control.owned_pg(self.pointer, lambda _: self.identity)
        self.pid_file.write_text(f"1234\n{self.clone / 'data'}\n1700000000\n6544\n")
        with self.assertRaisesRegex(AssertionError, "PG_PID_PORT_REFUSED"):
            control.owned_pg(self.pointer, lambda _: self.identity)

    def test_guard_refusal_never_runs_pg_ctl(self):
        run = Mock()
        result = control.cleanup_pg(self.pointer, inspect=Mock(side_effect=AssertionError("foreign")), run=run)
        run.assert_not_called()
        self.assertFalse(result["stopped"])

    def test_cleanup_failure_truth_and_retained_evidence(self):
        run = Mock(return_value=SimpleNamespace(returncode=1))
        result = control.cleanup_pg(self.pointer, inspect=lambda _: self.identity, run=run, port_check=lambda _: False)
        self.assertEqual(run.call_count, 2)
        self.assertFalse(result["stopped"])
        self.assertFalse(result["portReleased"])
        self.assertTrue(self.pid_file.exists())

    def test_cleanup_success_uses_exact_path(self):
        def stop(arguments, **_kwargs):
            self.assertEqual(arguments[2], str(self.clone / "data"))
            self.pid_file.unlink()
            return SimpleNamespace(returncode=0)

        result = control.cleanup_pg(self.pointer, inspect=lambda _: self.identity, run=stop, port_check=lambda _: True)
        self.assertTrue(result["stopped"] and result["portReleased"])
        self.assertTrue((self.clone / "ownership.json").exists())

    def test_parent_report_when_child_wrote_no_report(self):
        job = self.root / "job"
        job.mkdir()
        control.write_json(job / "clone.json", self.pointer)
        result = {"watchdog": {"timeout": "initialization"}}
        with (
            patch.object(control, "cleanup_pg", return_value={"stopped": False, "portReleased": False}),
            patch.object(runner, "preservation", return_value={"sourcePreserved": True, "originalPreserved": True}),
        ):
            runner.collect(job, result, None, None)
        control.write_json(job / "result.json", result)
        saved = control.read_json(job / "result.json")
        self.assertFalse(saved["childReportPresent"])
        self.assertFalse(saved["cleanup"]["stopped"])
        self.assertEqual(saved["watchdog"]["timeout"], "initialization")
        self.assertTrue(saved["preservation"]["sourcePreserved"])

    def test_malformed_pointer_does_not_claim_stopped(self):
        job = self.root / "job"
        job.mkdir()
        (job / "clone.json").write_text("{")
        result = {}
        with self.assertRaises(ValueError):
            runner.collect(job, result, None, None)
        self.assertFalse(result["cleanup"]["stopped"])
        self.assertFalse(result["cleanup"]["portReleased"])

    def test_clone_hook_persists_pointer_before_start_and_wraps_lookup(self):
        job = self.root / "job"
        job.mkdir()
        events = []

        def original_command(arguments, label, timeout):
            pointer = control.read_json(job / "clone.json")
            self.assertEqual(pointer["port"], 6543)
            self.assertEqual(control.read_json(job / "phase.json")["phase"], "pg-starting")
            events.append("pg-start")
            return 0

        async def original_run(_password):
            events.append("apply")

        def timer(name, function):
            events.append(name)
            return function

        clone = SimpleNamespace(
            write_json=control.write_json,
            run_clone=original_run,
            pg_command=original_command,
            timed=timer,
            CLONE=self.clone,
            PORT=6543,
            REPORT={},
            owner=SimpleNamespace(inspection=SimpleNamespace(PG_CTL=control.PG_CTL)),
        )
        composition.install(clone, job)
        with self.assertRaises(FileNotFoundError):
            clone.pg_command(["start"], "start")
        self.assertEqual(events, [])
        clone.write_json(self.clone / "ownership.json", control.read_json(self.clone / "ownership.json"))
        with patch.object(control, "owned_pg", return_value=self.identity):
            clone.pg_command(["start"], "start")
        self.assertEqual(events, ["pg-start"])
        self.assertEqual(control.read_json(job / "clone.json")["process"], self.identity.value)

        class Service:
            async def apply(self):
                pass

            async def lookup(self):
                pass

        service = Service()
        clone.timed("full-apply", service.apply)
        self.assertEqual(events[-2:], ["exact-lookup", "full-apply"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
