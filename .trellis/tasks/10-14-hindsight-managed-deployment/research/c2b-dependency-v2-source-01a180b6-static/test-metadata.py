"""Generated metadata fixtures only; never execute the collector's container entrypoint."""

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

PACKET = Path(__file__).resolve().parent.parent / "docker-dependency-inventory-v2"


def module(name: str):
    spec = importlib.util.spec_from_file_location(name, PACKET / f"{name}.py")
    assert spec and spec.loader
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


comparator = module("compare")
comparator.load_parser(json.loads((PACKET / "release.json").read_text()))
collector = module("collect")


def distribution(name, version="1.0", requires=None, extras=None, python=">=3.11"):
    return {"name": name, "version": version, "metadataVersion": "2.4", "requiresPython": python,
            "requiresDist": requires or [], "providesExtra": extras or []}


def fixture():
    environment = {key: "test" for key in comparator.ENVIRONMENT_KEYS}
    environment.update(implementation_name="cpython", implementation_version="3.11.16", os_name="posix",
                       platform_machine="x86_64", platform_system="Linux", python_full_version="3.11.16",
                       platform_python_implementation="CPython", python_version="3.11", sys_platform="linux")
    inventory = {"schema": "c2b-installed-dependencies-v1", "complete": True, "environment": environment,
                 "distributions": [distribution("demo", requires=["old-source-only-missing"]),
                                   distribution("parent", requires=['leaf>=2; extra == "fast"'], extras=["fast"]),
                                   distribution("leaf", "2.0"), distribution("pg0", "0.15.0"),
                                   distribution("unused", requires=["not-installed; extra == 'optional'"], extras=["optional"])]}
    project = {"name": "demo", "version": "1.0", "requires-python": ">=3.11",
               "dependencies": ['parent[fast]>=1; sys_platform == "linux"', 'windows-missing; sys_platform == "win32"'],
               "optional-dependencies": {"embedded-db": ["pg0>=0.15.0"]}}
    return inventory, project


class RequirementsTests(unittest.TestCase):
    def test_target_markers_recursive_extras_and_source_replacement(self):
        inventory, project = fixture()
        original = copy.deepcopy(inventory)
        result = comparator.compare(inventory, project)
        self.assertTrue(result["metadataCompatible"])
        self.assertEqual(result["reachableDistributionCount"], 4)
        self.assertEqual(inventory, original)
        self.assertEqual(result["baseApplicationMetadata"]["requiresDist"], ["old-source-only-missing"])

    def test_missing_transitive_dependency(self):
        inventory, project = fixture()
        inventory["distributions"] = [item for item in inventory["distributions"] if item["name"] != "leaf"]
        result = comparator.compare(inventory, project)
        self.assertFalse(result["metadataCompatible"])
        self.assertIn("missing_distribution", {item["kind"] for item in result["issues"]})

    def test_version_and_python_constraints(self):
        inventory, project = fixture()
        inventory["distributions"][2]["version"] = "1.0"
        project["requires-python"] = ">=3.12"
        result = comparator.compare(inventory, project)
        self.assertEqual({item["kind"] for item in result["issues"]}, {"requires_python", "version_mismatch"})

    def test_requested_extra_must_exist(self):
        inventory, project = fixture()
        inventory["distributions"][1]["providesExtra"] = []
        self.assertIn("missing_extra", {item["kind"] for item in comparator.compare(inventory, project)["issues"]})

    def test_direct_url_is_unresolved_without_leaking_url(self):
        inventory, project = fixture()
        project["dependencies"] = ["parent @ https://example.invalid/package.whl"]
        result = comparator.compare(inventory, project)
        self.assertFalse(result["metadataCompatible"])
        self.assertNotIn("example.invalid", json.dumps(result))

    def test_invalid_and_duplicate_metadata_refuse(self):
        inventory, project = fixture()
        inventory["distributions"].append(distribution("PARENT"))
        with self.assertRaises(ValueError):
            comparator.compare(inventory, project)
        inventory, project = fixture()
        inventory["distributions"][1]["requiresDist"] = ["invalid???"]
        with self.assertRaises(ValueError):
            comparator.compare(inventory, project)

    def test_incomplete_collection_or_environment_refuse(self):
        inventory, project = fixture()
        inventory["complete"] = False
        with self.assertRaises(ValueError):
            comparator.compare(inventory, project)
        inventory, project = fixture()
        del inventory["environment"]["platform_release"]
        with self.assertRaises(ValueError):
            comparator.compare(inventory, project)

    def test_unknown_metadata_and_unreachable_invalid_extra_refuse(self):
        inventory, project = fixture()
        inventory["distributions"][-1]["metadataVersion"] = "99.0"
        with self.assertRaises(ValueError):
            comparator.compare(inventory, project)
        inventory, project = fixture()
        inventory["distributions"][-1]["providesExtra"] = ["bad???"]
        with self.assertRaises(ValueError):
            comparator.compare(inventory, project)

    def test_metadata_headers_and_duplicates(self):
        root = Path("G:/TakiAgent-staging").resolve()
        with tempfile.TemporaryDirectory(prefix="c2b-metadata-test-", dir=root) as temporary:
            path = Path(temporary).resolve()
            self.assertEqual(path.parent, root)
            collector.PURELIB = path
            target = path / "METADATA"
            target.write_bytes(b"Metadata-Version: 2.4\nName: demo\nVersion: 1.0\nRequires-Dist: parent>=1\n\nIgnored description\n")
            result = collector.metadata(target)
            self.assertEqual(result["requiresDist"], ["parent>=1"])
            self.assertEqual(result["bytes"], target.stat().st_size)
            target.write_bytes(b"Metadata-Version: 2.4\nName: demo\nName: duplicate\nVersion: 1.0\n\n")
            with self.assertRaises(collector.InventoryRefused):
                collector.metadata(target)
            target.write_bytes(b"Metadata-Version: 99.0\nName: demo\nVersion: 1.0\n\n")
            unknown = collector.metadata(target)
            self.assertFalse(unknown["metadataVersionSupported"])
            self.assertEqual(unknown["metadataVersion"], "99.0")


if __name__ == "__main__":
    unittest.main()
