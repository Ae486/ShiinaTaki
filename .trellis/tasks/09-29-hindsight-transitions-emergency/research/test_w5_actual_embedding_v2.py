"""Actual harmless Windows worker handshake and timeout, with no ML/PG/corpus."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import w5_actual_embedding_control as control

v2 = control.load("w5_actual_v2_tested", "w5-candidate-actual-embedding-v2.py")


class DirectWorkerTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows redirector regression")
    def test_actual_worker_identity_venv_resolution_and_hard_termination(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary).resolve()
            control.write_json(job / "job.json", {"parentPid": os.getpid()})
            worker = v2.start_worker(job, probe=True)
            try:
                identity = control.ProcessIdentity(worker.pid)
                try:
                    self.assertEqual(Path(identity.value["executable"]).resolve(), v2.BASE_PYTHON)
                    control.write_json(job / "child.json", identity.value)
                finally:
                    identity.close()
                started = time.monotonic()
                while not (job / "worker-self.json").exists():
                    self.assertIsNone(worker.poll(), "Harmless self-report worker exited before handshake")
                    self.assertLess(time.monotonic() - started, 10)
                    time.sleep(0.025)
                report = control.read_json(job / "worker-self.json")
                self.assertEqual(report["parentPid"], os.getpid())
                self.assertEqual(report["heldPid"], worker.pid)
                self.assertEqual(report["scriptPid"], worker.pid)
                self.assertEqual(report["identity"], control.read_json(job / "child.json"))
                self.assertEqual(Path(report["executable"]).resolve(), control.PYTHON.resolve())
                self.assertEqual(Path(report["prefix"]).resolve(), v2.VENV)
                self.assertEqual(Path(report["baseExecutable"]).resolve(), v2.BASE_PYTHON)
                self.assertEqual(report["packagesImported"], [])
                self.assertEqual(set(report["packageOrigins"]), set(v2.PACKAGES))
                for origin in report["packageOrigins"].values():
                    self.assertTrue(Path(origin).is_relative_to(v2.VENV / "Lib/site-packages"))
                result = control.supervise(
                    worker,
                    lambda: control.read_json(job / "phase.json") if (job / "phase.json").exists() else {},
                    init_seconds=0.2,
                    overall_seconds=3,
                )
                self.assertEqual(result["timeout"], "initialization")
                self.assertTrue(result["terminatedOwnedChild"])
                self.assertIsNotNone(worker.poll())
                # Independently query the self-reported PID after termination.
                # A held redirector terminating while its script survives fails.
                with self.assertRaises(RuntimeError):
                    control.ProcessIdentity(report["scriptPid"])
                self.assertFalse((job / "unexpected-completion.json").exists())
                print(
                    json.dumps(
                        {
                            "marker": "DIRECT_WORKER_PROBE",
                            "handshake": report,
                            "watchdog": result,
                            "actualWorkerTerminated": True,
                        }
                    ),
                    flush=True,
                )
            finally:
                if worker.poll() is None:
                    worker.terminate()
                worker.wait(timeout=5)

    def test_only_launch_variable_is_added_and_offline_environment_is_preserved(self):
        environment = {**control.OFFLINE, "HF_TOKEN_PATH": "absent/token", "PATH": "safe"}
        prepared = v2.direct_environment(environment)
        self.assertEqual({key: value for key, value in prepared.items() if key != "__PYVENV_LAUNCHER__"}, environment)
        self.assertEqual(prepared["__PYVENV_LAUNCHER__"], str(control.PYTHON.resolve()))
        self.assertNotIn("__PYVENV_LAUNCHER__", environment)

    def test_v1_parent_launch_is_adapted_without_global_subprocess_patch(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            original_popen = subprocess.Popen
            runner = SimpleNamespace(subprocess=subprocess)

            def run_reviewed():
                self.assertIs(subprocess.Popen, original_popen)
                runner.subprocess.Popen(
                    [str(control.PYTHON), "-B", "-s", str(v2.V1_ENTRY), "--owned-job", str(job)],
                    env=control.OFFLINE,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                )
                control.write_json(job / "result.json", {"diagnosticSucceeded": False})
                return job

            runner.run_reviewed = run_reviewed
            with patch.object(v2, "v1_runner", return_value=runner), patch.object(v2, "start_worker") as start:
                self.assertEqual(v2.run_reviewed(), job)
            start.assert_called_once_with(job, environment=control.OFFLINE)
            self.assertIs(subprocess.Popen, original_popen)
            self.assertFalse(control.read_json(job / "result.json")["directWorkerIdentityVerified"])

    @unittest.skipUnless(os.name == "nt", "Windows redirector regression")
    def test_parent_mismatch_refuses_before_model_or_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            job = Path(temporary)
            control.write_json(job / "job.json", {"parentPid": -1})
            control.write_json(job / "worker-launch.json", {"parentPid": os.getppid()})
            with self.assertRaisesRegex(AssertionError, "DIRECT_WORKER_PARENT_MISMATCH"):
                v2.worker_handshake(job)
            self.assertFalse((job / "worker-self.json").exists())

    def test_actual_launch_is_base_executable_not_venv_redirector(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(subprocess, "Popen") as popen:
            job = Path(temporary)
            v2.start_worker(job, probe=True, environment=control.OFFLINE)
            arguments = popen.call_args.args[0]
            self.assertEqual(Path(arguments[0]), v2.BASE_PYTHON)
            self.assertNotEqual(Path(arguments[0]), control.PYTHON)
            self.assertEqual(arguments[4], "--probe-job")
            self.assertEqual(popen.call_args.kwargs["creationflags"], subprocess.CREATE_NO_WINDOW)
            self.assertEqual(popen.call_args.kwargs["env"]["__PYVENV_LAUNCHER__"], str(control.PYTHON.resolve()))


if __name__ == "__main__":
    unittest.main(verbosity=2)
