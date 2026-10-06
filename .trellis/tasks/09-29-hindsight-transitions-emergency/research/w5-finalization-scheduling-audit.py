"""Audit supplemental scheduling source and all immutable predecessor/corpus evidence."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).resolve().parent


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def entry(path):
    return {"path": path.relative_to(ROOT).as_posix(), "sha256": digest(path), "bytes": path.stat().st_size}


anchors = {
    "w5-core-validation-source-manifest.json": "bcf06e76032d77fce66b3d26c34b60dd1be2deba821a35e6a10e60b51beaa6f4",
    "w5-postcommit-readiness-source-manifest.json": "5f056f60218dbba7a1b574f7f89c63f77b788e394321fb1ab421f2bba3ca2341",
    "w5-verified-observation-source-manifest.json": "9cb5ecbcf8c13c4e77504da52fd1c2b5fab60f72e60890defa30d40186883a66",
    "w5-finalization-scheduling-preimage-manifest.json": "dce8468bf0da30688b7a32dc4519c4182895316626be65afb711257fb02c5ba2",
}
for name, expected in anchors.items():
    assert digest(RESEARCH / name) == expected, name
observer = json.loads((RESEARCH / "w5-verified-observation-source-manifest.json").read_text(encoding="utf-8"))
saved = json.loads((RESEARCH / "w5-finalization-scheduling-preimage-manifest.json").read_text(encoding="utf-8"))
owned = {item["path"] for item in saved}
for item in saved:
    original = RESEARCH / "w5-finalization-scheduling-preimages" / item["path"]
    assert digest(original) == item["sha256"], item["path"]
    assert original.stat().st_size == item["bytes"], item["path"]
for item in observer["files"]:
    if item["path"] not in owned:
        assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
for item in observer["evidence"]:
    assert digest(ROOT / item["path"]) == item["sha256"], item["path"]

new_paths = ["packages/core/src/memory/transitions/transition-native-renewal.test.ts",
             "packages/core/src/memory/transitions/transition-healthy-scheduling.test.ts"]
files = sorted(owned | set(new_paths))
records = []
for name in files:
    path = ROOT / name
    raw = path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), name
    source = raw.decode("utf-8", errors="strict")
    assert all(line.rstrip(" \t") == line for line in source.splitlines()), name
    if name.endswith(".ts") and not name.endswith(".test.ts"):
        assert all(key in source[:500] for key in ["INPUT:", "OUTPUT:", "POS:"]), name
        assert path.name in (path.parent / "index.md").read_text(encoding="utf-8"), name
    records.append({**entry(path), "change": "added" if name in new_paths else "modified"})

replay = json.loads((RESEARCH / "w5-finalization-scheduling-driver-result.json").read_text(encoding="utf-8"))
assert replay["sourceUnchanged"] and replay["checkedSourceUnchanged"]
assert replay["operationState"] == "completed" and replay["finalPhase"] == "terminal"
assert replay["terminal"]["outcome"] == "completed" and replay["terminal"]["queue"] == "settled"
assert replay["diagnostics"] == [] and replay["modelCalls"] == 0 and replay["networkCalls"] == 0
for item in replay["sourceFiles"]:
    assert digest(ROOT / item["path"]) == item["sha256"], item["path"]
database = ROOT / ".trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90/w5-healthy-a7ffc67a1666400b8cc7e890d837cb97/application.sqlite"
assert digest(database) == observer["originalDatabaseSha256"]

evidence_names = ["w5-finalization-scheduling-implementation.md", "w5-finalization-scheduling-audit.py",
    "w5-finalization-scheduling-proposal.md", "w5-finalization-scheduling-driver.mjs",
    "w5-finalization-scheduling-driver-result.json", "w5-finalization-scheduling-driver.log",
    "w5-finalization-scheduling-regression-tests.log", "w5-finalization-scheduling-final-tests.log",
    "w5-finalization-scheduling-types-final-v2.log", "w5-finalization-scheduling-lint-final.log"]
manifest = RESEARCH / "w5-finalization-scheduling-source-manifest.json"
output = {"version": 1, "createdAtUtc": datetime.now(timezone.utc).isoformat(), "preservedManifests": anchors,
          "originalDatabaseSha256": observer["originalDatabaseSha256"], "preimagesVerified": len(saved),
          "files": records, "evidence": [entry(RESEARCH / name) for name in evidence_names],
          "checks": {"strictUtf8NoBom": True, "trailingWhitespace": False, "headersAndIndexes": True,
                     "observerEvidenceUnchanged": True, "replaySourceMatchesDelivery": True}}
with manifest.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(output, indent=2) + "\n")
print(json.dumps({"manifest": entry(manifest), "files": len(records), "preimages": len(saved),
                  "originalDatabaseUnchanged": True, "observerEvidenceUnchanged": True}, indent=2))
