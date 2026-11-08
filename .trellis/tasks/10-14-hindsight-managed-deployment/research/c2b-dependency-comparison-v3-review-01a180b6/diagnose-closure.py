"""Explicitly authorized in-memory alias diagnostic; original metadata is never accepted or changed."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path

import tomllib

HERE = Path(__file__).resolve().parent
PACKET = HERE.parent / "dependency-comparison-v3"
release_raw = (PACKET / "release.json").read_bytes()
assert hashlib.sha256(release_raw).hexdigest() == "af2026e941ee0515b7fed41a5dce8c66c4409b6d15e65ea1bf1902bf75b8ebc8"
release = json.loads(release_raw)
comparator_path = PACKET / "compare.py"
comparator_hash = hashlib.sha256(comparator_path.read_bytes()).hexdigest()
assert comparator_hash == release["files"]["compare.py"]
source = (PACKET / "source-pyproject.toml").read_bytes()
assert hashlib.sha256(source).hexdigest() == release["files"]["source-pyproject.toml"]
archive_path = Path(release["archive"]) / "result.json"
raw = archive_path.read_bytes()
assert hashlib.sha256(raw).hexdigest() == release["inventoryResultSha256"]
original = json.loads(raw)["inventory"]
diagnostic = copy.deepcopy(original)
spec = importlib.util.spec_from_file_location("diagnostic_comparator", comparator_path)
assert spec is not None and spec.loader is not None
comparator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparator)
comparator.load_parser(release)
canonicalize_name = importlib.import_module("packaging.utils").canonicalize_name
transformations = []
for item in diagnostic["distributions"]:
    normalized = [canonicalize_name(value, validate=True) for value in item["providesExtra"]]
    if len(normalized) != len(set(normalized)):
        raise ValueError("diagnostic_refuses_alias_collisions")
    if item["metadataVersion"] in {"2.3", "2.4", "2.5"} and normalized != item["providesExtra"]:
        transformations.append({"file": item["file"], "name": item["name"], "version": item["version"],
                                "metadataVersion": item["metadataVersion"], "originalMetadataSha256": item["sha256"],
                                "originalProvidesExtra": copy.deepcopy(item["providesExtra"]),
                                "diagnosticProvidesExtra": normalized})
        item["providesExtra"] = normalized
result = comparator.compare(diagnostic, tomllib.loads(source.decode("utf-8"))["project"])
assert json.loads(raw)["inventory"] == original
assert hashlib.sha256(archive_path.read_bytes()).hexdigest() == release["inventoryResultSha256"]
answer = {"diagnosticOnly": True, "originalMetadataAccepted": False, "deploymentReady": False,
          "warning": "Modified in-memory projection only. Original metadata remains refused; this is not artifact compatibility.",
          "token": release["token"], "comparatorSha256": comparator_hash,
          "originalInventoryResultSha256": release["inventoryResultSha256"],
          "sourceMetadataSha256": release["files"]["source-pyproject.toml"],
          "transformations": transformations, "comparison": result}
destination = HERE / "diagnostic-closure.json"
with destination.open("x", encoding="utf-8") as stream:
    stream.write(json.dumps(answer, indent=2) + "\n")
print(json.dumps({"diagnosticOnly": True, "originalMetadataAccepted": False,
                  "transformations": transformations, "comparisonComplete": result["comparisonComplete"],
                  "metadataCompatibleForModifiedProjection": result["metadataCompatible"],
                  "installedDistributionCount": result["installedDistributionCount"],
                  "reachableDistributionCount": result["reachableDistributionCount"],
                  "evaluatedRequirements": result["evaluatedRequirements"], "issues": result["issues"]}))
