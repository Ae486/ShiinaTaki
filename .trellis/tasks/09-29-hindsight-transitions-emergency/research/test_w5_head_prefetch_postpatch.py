"""Offline successor-inventory boundaries and unchanged four-report V2 routing."""

from __future__ import annotations

import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import w5_actual_embedding_control as control
import w5_head_prefetch_inventory as inventory

composed = control.load("w5_head_prefetch_test_entry", "w5-head-prefetch-postpatch.py")
# Reuse all checked routing, failure-record and persisted-report regressions
# against this NEW module instance. No legacy test/helper file is repinned.
legacy_tests = control.load(
    "w5_head_prefetch_checked_tests", "test_w5_native_view_postpatch.py"
)
legacy_tests.entry = composed.entry
legacy_tests.inventory = inventory


def pin(path: Path) -> dict[str, object]:
    return {
        "path": str(path),
        "bytes": path.stat().st_size,
        "sha256": control.digest(path),
    }


class CompositionTests(legacy_tests.CompositionTests):
    def test_new_cli_default_is_inert_and_actual_v2_entry_is_new_file(self) -> None:
        path = Path(composed.__file__).resolve()
        self.assertEqual(composed.entry.ENTRY, path)
        result = subprocess.run(
            [sys.executable, str(path)], capture_output=True, text=True, check=False
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("executed=false", result.stdout)


class InventoryTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.changed, self.stable, self.added = (
            self.root / name for name in ("changed.py", "stable.py", "added.py")
        )
        for path in (self.changed, self.stable, self.added):
            path.write_text("original", encoding="utf-8")
        self.history = self.root / "historical-manifest.json"
        control.write_json(self.history, {"files": [pin(self.stable)]})
        self.previous = self.root / "previous.json"
        control.write_json(
            self.previous,
            {
                "purpose": "checked predecessor",
                "inherited": [pin(self.history)],
                "files": [pin(self.changed), pin(self.stable), pin(self.history)],
            },
        )
        self.changed.write_text("approved repair", encoding="utf-8")
        self.manifest = self.root / "new.json"
        self.value = {
            "purpose": "successor fixture",
            "inherited": [pin(self.history), pin(self.previous)],
            "files": [
                pin(path)
                for path in (
                    self.changed,
                    self.stable,
                    self.history,
                    self.previous,
                    self.added,
                )
            ],
        }
        self.save()
        for name, value in {
            "MANIFEST": self.manifest,
            "PREVIOUS": self.previous,
            "PREVIOUS_SHA": control.digest(self.previous),
            "PREVIOUS_COUNT": 3,
            "AUTHORIZED_CHANGES": (self.changed,),
            "ADDITIONS": (self.previous, self.added),
        }.items():
            patcher = patch.object(inventory, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def save(self) -> None:
        control.write_json(self.manifest, self.value)

    def test_exact_union_and_only_declared_replacement_pass(self) -> None:
        result = inventory.verify_inventory()
        self.assertEqual(result.entries, 5)
        self.assertEqual(result.inherited_manifests, 2)
        self.assertEqual(result.sha256, control.digest(self.manifest))
        self.stable.write_text("undeclared change", encoding="utf-8")
        self.value["files"][1] = pin(self.stable)
        self.save()
        with self.assertRaisesRegex(
            AssertionError, "UNAUTHORIZED_PREVIOUS_REPLACEMENT"
        ):
            inventory.verify_inventory()

    def test_missing_extra_duplicate_and_undeclared_replacements_refuse(self) -> None:
        valid = copy.deepcopy(self.value)
        outsider = self.root / "unapproved.py"
        outsider.write_text("unknown", encoding="utf-8")
        for rows in (
            valid["files"][1:],
            [*valid["files"], valid["files"][0]],
            [*valid["files"], pin(outsider)],
            valid["files"][:-1],
        ):
            with self.subTest(entries=len(rows)):
                self.value["files"] = rows
                self.save()
                with self.assertRaises(AssertionError):
                    inventory.verify_inventory()

    def test_predecessor_and_all_inherited_manifest_bytes_stay_sealed(self) -> None:
        self.value["inherited"] = self.value["inherited"][1:]
        self.save()
        with self.assertRaisesRegex(AssertionError, "INHERITED_MANIFEST_SET_CHANGED"):
            inventory.verify_inventory()
        control.write_json(
            self.previous, {"purpose": "rewritten", "files": [], "inherited": []}
        )
        self.value["inherited"] = [pin(self.history), pin(self.previous)]
        self.value["files"][3] = pin(self.previous)
        self.save()
        with self.assertRaisesRegex(AssertionError, "PREVIOUS_MANIFEST_CHANGED"):
            inventory.verify_inventory()

    def test_inherited_repin_and_unsealed_current_source_refuse(self) -> None:
        self.history.write_text("rewritten historical manifest", encoding="utf-8")
        self.value["inherited"][0] = pin(self.history)
        self.value["files"][2] = pin(self.history)
        self.save()
        with self.assertRaisesRegex(
            AssertionError, "UNAUTHORIZED_PREVIOUS_REPLACEMENT"
        ):
            inventory.verify_inventory()

    def test_current_drift_parent_digest_and_unknown_declared_path_refuse(self) -> None:
        with self.assertRaisesRegex(AssertionError, "POSTPATCH_MANIFEST_CHANGED"):
            inventory.verify_inventory("0" * 64)
        with patch.object(inventory, "AUTHORIZED_CHANGES", (self.added,)):
            with self.assertRaisesRegex(AssertionError, "UNKNOWN_REPLACEMENT_PATH"):
                inventory.verify_inventory()
        with patch.object(
            inventory, "ADDITIONS", (self.previous, self.added, self.stable)
        ):
            with self.assertRaisesRegex(
                AssertionError, "ADDITION_REPLACES_PREVIOUS_ENTRY"
            ):
                inventory.verify_inventory()
        self.changed.write_text("later unsealed drift", encoding="utf-8")
        with self.assertRaisesRegex(AssertionError, "POSTPATCH_SOURCE_DRIFT"):
            inventory.verify_inventory()


if __name__ == "__main__":
    unittest.main()
