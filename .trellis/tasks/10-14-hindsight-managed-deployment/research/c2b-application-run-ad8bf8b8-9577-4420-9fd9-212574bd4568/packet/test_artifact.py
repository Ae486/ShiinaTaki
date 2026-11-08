"""Small generated fixtures for file/tree/refusal contracts; no installed package or Docker use."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import artifact_io as io

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("artifact_check", HERE / "artifact-check.py")
assert spec is not None and spec.loader is not None
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class ArtifactContract(unittest.TestCase):
    def setUp(self) -> None:
        scratch = HERE.parent / "c2b-application-artifact-source-release-01a180b6-static"
        scratch.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix="generated-", dir=scratch)
        self.root = Path(self.temporary.name)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_complete_tree_detects_stale_deleted_file_and_empty_directory(self) -> None:
        (self.root / "current.py").write_text("x = 1\n")
        (self.root / "empty").mkdir()
        original = io.tree(self.root)
        self.assertEqual(set(original["entries"]), {"current.py", "empty"})
        (self.root / "deleted-upstream.py").write_text("old = True\n")
        self.assertNotEqual(io.tree(self.root)["sha256"], original["sha256"])

    def test_only_interpreter_caches_are_excluded(self) -> None:
        (self.root / "__pycache__").mkdir()
        (self.root / "__pycache__/module.pyc").write_bytes(b"cache")
        (self.root / "module.pyc").write_bytes(b"cache")
        (self.root / "migration.sql").write_text("select 1;\n")
        self.assertEqual(set(io.tree(self.root, caches=True)["entries"]), {"migration.sql"})
        self.assertEqual(len(io.tree(self.root)["entries"]), 4)

    def test_build_constant_is_static_and_exact(self) -> None:
        path = self.root / "build.py"
        path.write_text(
            f'TAKI_MEMORY_COMPATIBILITY_BUILD = {json.dumps(io.BUILD)}\nraise RuntimeError("never execute")\n'
        )
        self.assertEqual(io.build_gate(path), io.BUILD)
        path.write_text('TAKI_MEMORY_COMPATIBILITY_BUILD = "old"\n')
        with self.assertRaisesRegex(io.Refused, "wrong_build"):
            io.build_gate(path)

    def test_missing_and_corrupt_cache_refuse(self) -> None:
        with self.assertRaisesRegex(io.Refused, "cache_missing"):
            io.cache_gate(self.root / "missing")
        path = self.root / "corrupt"
        path.write_bytes(b"generated, not tokenizer cache")
        with self.assertRaisesRegex(io.Refused, "cache_corrupt"):
            io.cache_gate(path)

    def test_modified_bytes_and_file_bound_refuse(self) -> None:
        path = self.root / "file"
        path.write_bytes(b"before")
        before = io.file_fact(path)
        path.write_bytes(b"after!")
        self.assertNotEqual(before, io.file_fact(path))
        with self.assertRaisesRegex(io.Refused, "file_byte_bound"):
            io.file_fact(path, 1)

    def test_file_refusal_precedes_tokenizer_or_negative_execution(self) -> None:
        with (
            patch.object(checker, "check_files", side_effect=io.Refused("wrong_build")),
            patch.object(checker, "tokenizer_load") as loader,
            patch.object(checker, "refusal_cases") as negatives,
            patch.object(checker.os, "getuid", return_value=1000, create=True),
            patch.object(checker.os, "getgid", return_value=1000, create=True),
        ):
            result = checker.main()
        self.assertFalse(result["complete"])
        self.assertFalse(result["fileGatePassed"])
        self.assertFalse(result["deploymentReady"])
        self.assertEqual(result["failure"], "wrong_build")
        loader.assert_not_called()
        negatives.assert_not_called()


if __name__ == "__main__":
    unittest.main()
