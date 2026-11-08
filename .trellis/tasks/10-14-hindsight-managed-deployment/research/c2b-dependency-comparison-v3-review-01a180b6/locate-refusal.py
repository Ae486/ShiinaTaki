"""Locate exact archived extra-name refusal facts without changing or rerunning comparison."""

import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKET = HERE.parent / "dependency-comparison-v3"
spec = importlib.util.spec_from_file_location("review_parser", PACKET / "compare.py")
assert spec is not None and spec.loader is not None
comparator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparator)
release = json.loads((PACKET / "release.json").read_bytes())
comparator.load_parser(release)

canonicalize_name = importlib.import_module("packaging.utils").canonicalize_name

inventory = json.loads((Path(release["archive"]) / "result.json").read_bytes())["inventory"]
findings = []
for item in inventory["distributions"]:
    normalized = [canonicalize_name(extra, validate=True) for extra in item["providesExtra"]]
    if item["metadataVersion"] in {"2.3", "2.4", "2.5"} and normalized != item["providesExtra"]:
        findings.append({"file": item["file"], "name": item["name"], "version": item["version"],
                         "metadataVersion": item["metadataVersion"], "metadataSha256": item["sha256"],
                         "noncanonicalExtras": [{"observed": observed, "normalized": canonical}
                                                for observed, canonical in zip(item["providesExtra"], normalized)
                                                if observed != canonical]})
result = {"comparisonExecuted": False, "compatibilityOverrideApplied": False, "findings": findings}
(HERE / "metadata-obstructions.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
