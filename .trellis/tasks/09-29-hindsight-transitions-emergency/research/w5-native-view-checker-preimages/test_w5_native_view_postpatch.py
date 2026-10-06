"""Offline inventory and parent/actual-worker routing; no corpus, model or PG."""

from __future__ import annotations

import copy
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import asdict
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import w5_actual_embedding_control as control
import w5_native_view_inventory as inventory

entry = control.load("w5_native_view_test_entry", "w5-native-view-postpatch.py")


def pin(path):
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": control.digest(path),
    }


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.changed, self.unchanged, self.added = (
            self.root / name for name in ("changed.py", "stable.py", "new.py")
        )
        for path in (self.changed, self.unchanged, self.added):
            path.write_text("original", encoding="utf-8")
        self.old = self.root / "old.json"
        control.write_json(
            self.old, {"files": [pin(self.changed), pin(self.unchanged)]}
        )
        self.changed.write_text("authorized patch", encoding="utf-8")
        self.manifest = self.root / "postpatch.json"
        self.value = {
            "purpose": "fixture",
            "inherited": [pin(self.old)],
            "files": [
                pin(path)
                for path in (self.changed, self.unchanged, self.added, self.old)
            ],
        }
        self.save()
        for name, value in {
            "HERE": self.root,
            "MANIFEST": self.manifest,
            "INHERITED": {self.old.name: control.digest(self.old)},
            "AUTHORIZED_CHANGES": (self.changed,),
            "ADDITIONS": (self.added,),
        }.items():
            patcher = patch.object(inventory, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self):
        control.write_json(self.manifest, self.value)

    def test_only_explicit_changed_path_may_replace_inherited_pin(self):
        result = inventory.verify_inventory()
        self.assertEqual(result.entries, 4)
        self.assertEqual(result.inherited_manifests, 1)
        self.assertEqual(result.sha256, control.digest(self.manifest))
        self.unchanged.write_text("unauthorized", encoding="utf-8")
        self.value["files"][1] = pin(self.unchanged)
        self.save()
        with self.assertRaisesRegex(
            AssertionError, "UNAUTHORIZED_INHERITED_REPLACEMENT"
        ):
            inventory.verify_inventory()

    def test_missing_duplicate_extra_and_missing_addition_refuse(self):
        valid = copy.deepcopy(self.value)
        outsider = self.root / "outside.py"
        outsider.write_text("not owned", encoding="utf-8")
        for rows in (
            valid["files"][1:],
            [*valid["files"], valid["files"][0]],
            [*valid["files"], pin(outsider)],
            [row for row in valid["files"] if row["path"] != str(self.added)],
        ):
            with self.subTest(rows=len(rows)):
                self.value["files"] = rows
                self.save()
                with self.assertRaises(AssertionError):
                    inventory.verify_inventory()

    def test_inherited_manifest_rewrite_and_missing_reference_refuse(self):
        valid = copy.deepcopy(self.value)
        self.value["inherited"] = []
        self.save()
        with self.assertRaisesRegex(AssertionError, "INHERITED_MANIFEST_SET_CHANGED"):
            inventory.verify_inventory()
        self.value = valid
        control.write_json(self.old, {"files": []})
        self.value["inherited"] = [pin(self.old)]
        self.value["files"][-1] = pin(self.old)
        self.save()
        with self.assertRaisesRegex(AssertionError, "INHERITED_MANIFEST_CHANGED"):
            inventory.verify_inventory()

    def test_current_drift_and_parent_manifest_drift_refuse(self):
        with self.assertRaisesRegex(AssertionError, "POSTPATCH_MANIFEST_CHANGED"):
            inventory.verify_inventory("0" * 64)
        self.changed.write_text("unsealed later change", encoding="utf-8")
        with self.assertRaisesRegex(AssertionError, "POSTPATCH_SOURCE_DRIFT"):
            inventory.verify_inventory()

    def test_original_verifier_still_refuses_authorized_patch(self):
        # No postpatch adapter is installed here: old entry remains fail-closed.
        combined = self.root / "w5-candidate-combined-source-manifest.json"
        combined.write_text("pinned fixture", encoding="utf-8")
        with (
            patch.object(control, "HERE", self.root),
            patch.object(control, "MANIFEST", self.old),
            patch.object(control, "COMBINED_SHA", control.digest(combined)),
        ):
            with self.assertRaisesRegex(AssertionError, "SOURCE_DRIFT"):
                control.verify_sources()


class CompositionTests(unittest.TestCase):
    def test_real_modules_route_new_entry_and_nested_verifiers_and_restore_on_error(
        self,
    ):
        source = inventory.VerifiedInventory("1" * 64, 400, 7)
        original = (control.load, control.verify_sources, control.MANIFEST)
        with self.assertRaisesRegex(RuntimeError, "stop"):
            with entry.composition(source, []):
                v2 = control.load("view_test_v2", "w5-candidate-actual-embedding-v2.py")
                self.assertEqual(v2.V2_ENTRY, entry.ENTRY)
                v2.v1_runner()
                self.assertEqual(control.MANIFEST, inventory.MANIFEST)
                rehearsal = control.load(
                    "view_test_rehearsal", "w5-trigger-uuid-migration-rehearsal.py"
                )
                self.assertEqual(rehearsal.MANIFEST, inventory.MANIFEST)
                diagnostic = rehearsal.load(
                    "view_test_v3", "w5-candidate-trigger-readonly-diagnostic-v3.py"
                )
                self.assertEqual(diagnostic.READER_MANIFEST, inventory.MANIFEST)
                self.assertEqual(diagnostic.READER_HASH, source.sha256)
                self.assertTrue(diagnostic.DEPENDENCIES)
                telemetry = control.load(
                    "view_test_telemetry", "w5-candidate-actual-embedding-telemetry.py"
                )
                self.assertEqual(telemetry.V2_SHA, source.sha256)
                with patch.object(
                    inventory, "verify_inventory", return_value=source
                ) as verify:
                    self.assertEqual(telemetry.verify_manifest(), asdict(source))
                    verify.assert_called_once_with(source.sha256)
                raise RuntimeError("stop")
        self.assertEqual(
            (control.load, control.verify_sources, control.MANIFEST), original
        )

    def test_worker_checks_parent_sha_and_reports_complete_inventory_before_and_after(
        self,
    ):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            job = root / "w5-actual-embedding-fixture"
            job.mkdir()
            source = inventory.VerifiedInventory("2" * 64, 401, 7)
            control.write_json(
                job / "job.json", {"sourceManifestSha256": source.sha256}
            )
            handshake, child = Mock(), Mock()

            def runner():
                control.MANIFEST = Path("old-v2")
                return SimpleNamespace(child_entry=child)

            v2 = SimpleNamespace(
                v1_runner=runner, start_worker=Mock(), worker_handshake=handshake
            )
            with (
                patch.object(control, "RUNTIME", root),
                patch.object(control, "load", return_value=v2),
                patch.object(
                    inventory, "verify_inventory", return_value=source
                ) as verify,
            ):
                entry.worker(job)
            self.assertEqual(verify.call_args_list[0].args, (source.sha256,))
            self.assertEqual(verify.call_args_list[-1].args, (source.sha256,))
            handshake.assert_called_once_with(job)
            child.assert_called_once_with(job)
            for name in ("inventory-worker-before", "inventory-worker-after"):
                self.assertEqual(
                    control.read_json(job / f"{name}.json"), asdict(source)
                )

    def test_parent_requires_actual_worker_inventory_and_keeps_timing_failure_separate(
        self,
    ):
        for worker_reports in (True, False):
            with (
                self.subTest(worker_reports=worker_reports),
                tempfile.TemporaryDirectory() as temporary,
            ):
                job = Path(temporary)
                source = inventory.VerifiedInventory("3" * 64, 402, 7)
                v2 = SimpleNamespace(v1_runner=Mock(), start_worker=Mock())

                def run():
                    selected = control.load(
                        "fake-v2", "w5-candidate-actual-embedding-v2.py"
                    )
                    selected.start_worker(job, environment={"same": "environment"})
                    if worker_reports:
                        for name in (
                            "inventory-worker-before",
                            "inventory-worker-after",
                        ):
                            control.write_json(job / f"{name}.json", asdict(source))
                    control.write_json(
                        job / "telemetry-result.json",
                        {
                            "diagnosticSucceeded": True,
                            "nativeApplyBudgetPassed": False,
                        },
                    )
                    return job

                telemetry = SimpleNamespace(run_reviewed=run)

                def load(_name, filename):
                    return v2 if filename.endswith("v2.py") else telemetry

                with (
                    patch.object(control, "load", side_effect=load),
                    patch.object(inventory, "verify_inventory", return_value=source),
                    redirect_stdout(io.StringIO()),
                ):
                    self.assertEqual(entry.run_reviewed(), job)
                result = control.read_json(job / "postpatch-result.json")
                self.assertEqual(result["diagnosticSucceeded"], worker_reports)
                self.assertFalse(result["nativeApplyBudgetPassed"])
                self.assertFalse(result["httpOrAuthorityRecoveryProven"])
                self.assertEqual(
                    control.read_json(job / "inventory-parent-before.json"),
                    asdict(source),
                )
                self.assertEqual(
                    control.read_json(job / "inventory-parent-after.json"),
                    asdict(source),
                )

    def test_default_has_no_verification_or_execution(self):
        with (
            patch("sys.argv", ["postpatch"]),
            patch.object(entry, "run_reviewed") as run,
            patch.object(inventory, "verify_inventory") as verify,
            redirect_stdout(io.StringIO()) as output,
        ):
            entry.main()
        run.assert_not_called()
        verify.assert_not_called()
        self.assertIn("executed=false", output.getvalue())


if __name__ == "__main__":
    unittest.main()
