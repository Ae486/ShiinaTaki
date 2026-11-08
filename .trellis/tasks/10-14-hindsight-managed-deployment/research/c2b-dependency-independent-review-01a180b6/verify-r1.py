"""Verify the narrow repaired metadata contract without running either entrypoint."""

import difflib
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PACKET = ROOT / "docker-dependency-inventory"
STATIC = ROOT / "c2b-dependency-source-01a180b6-static"
OLD = STATIC / "released-before-review"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_bytes())


def module(name):
    spec = importlib.util.spec_from_file_location("r1_" + name, PACKET / (name + ".py"))
    assert spec is not None and spec.loader is not None
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


original_proof = sha(HERE / "challenge-metadata.json")
old_integrity = read(STATIC / "integrity.json")
integrity = read(STATIC / "r1-integrity.json")
release = read(PACKET / "release.json")
assert sha(PACKET / "release.json") == "5fd19647e62dc6791066eb5a216d3ee9eb7fe911a5e0c49d10a97374c61a77a1"
assert all(sha(OLD / name) == expected for name, expected in old_integrity["packetFiles"].items())
assert sha(OLD / "release.json") == "b83d9284e23ded4dbd18157a7ba3e1791661c867d8f11a0084051096d8c43a59"
assert all(sha(PACKET / name) == expected for name, expected in integrity["packetFiles"].items())
assert all(sha(PACKET / name) == expected for name, expected in release["files"].items())
assert all(sha(STATIC / name) == expected for name, expected in integrity["r1Evidence"].items())
unchanged = ["launch.mjs", "docker-commands.mjs", "evidence-store.mjs", "source-pyproject.toml"]
assert all((PACKET / name).read_bytes() == (OLD / name).read_bytes() for name in unchanged)
diff = "".join("".join(difflib.unified_diff((OLD / name).read_text().splitlines(True),
                                          (PACKET / name).read_text().splitlines(True),
                                          fromfile="before/" + name, tofile="after/" + name))
               for name in ["collect.py", "compare.py", "README.md"])
(HERE / "r1-delta.diff").write_text(diff, encoding="utf-8")
collector = module("collect")
comparator = module("compare")
comparator.load_parser(release)
collector.PURELIB = HERE
environment = read(HERE / "challenge-metadata.json")["cases"][0]["comparison"]["targetEnvironment"]
project = {"name": "demo", "version": "1.0", "requires-python": ">=3.11", "dependencies": [],
           "optional-dependencies": {"embedded-db": []}}
base = {"name": "demo", "version": "1.0", "metadataVersion": "2.4", "requiresPython": None,
        "requiresDist": [], "providesExtra": []}


def compare(records):
    return comparator.compare({"schema": "c2b-installed-dependencies-v1", "complete": True,
                               "environment": environment, "distributions": records}, project)


cases = []
try:
    collector.metadata(HERE / "unknown-metadata-version.METADATA")
except collector.InventoryRefused as error:
    assert str(error) == "metadata_version_unsupported"
    cases.append({"case": "raw_unknown_metadata", "result": "REFUSED", "code": str(error)})
else:
    raise AssertionError("Unknown raw metadata version was accepted")
try:
    compare([{**base, "metadataVersion": "99.0"}])
except ValueError as error:
    assert str(error) == "metadata_version_unsupported"
    cases.append({"case": "comparison_unknown_metadata", "result": "REFUSED", "code": str(error)})
else:
    raise AssertionError("Unknown projected metadata version was accepted")
invalid_unused = collector.metadata(HERE / "invalid-unused-extra.METADATA")
try:
    compare([base, invalid_unused])
except ValueError as error:
    cases.append({"case": "invalid_extra_outside_closure", "result": "REFUSED", "errorType": type(error).__name__})
else:
    raise AssertionError("Invalid unused extra was accepted")
valid_path = HERE / "valid-2.4.METADATA"
valid_path.write_bytes(b"Metadata-Version: 2.4\nName: demo\nVersion: 1.0\n\n")
valid = compare([collector.metadata(valid_path)])
assert valid["comparisonComplete"] and valid["metadataCompatible"] and not valid["issues"]
cases.append({"case": "valid_2.4", "result": "COMPATIBLE", "comparisonComplete": True})
assert sha(HERE / "challenge-metadata.json") == original_proof
assert not Path("G:/TakiAgent-c2b-native-api/dependencies-" + release["token"]).exists()
assert not Path(release["archive"]).exists()
result = {"verdict": "PASS_R1_DELTA", "releaseSha256": sha(PACKET / "release.json"),
          "originalFalseSuccessEvidenceSha256": original_proof, "oldPacketPreserved": True,
          "unchangedRuntimeFiles": unchanged, "cases": cases, "runtimeExecuted": False,
          "stageAndArchiveAbsent": True, "deploymentReady": False}
(HERE / "r1-verification.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result))
