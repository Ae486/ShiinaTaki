"""Read-only source/check integrity and current Native table-profile parity review."""
import ast
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("H:/TakiAgent")
RELEASE = ROOT / ".trellis/tasks/10-24-hindsight-isolated-candidate-foundation/research/d1a-validation-01a180b6"
OUT = Path(__file__).parent / "integrity.json"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


manifest_path = RELEASE / "final-integrity.json"
manifest_hash = sha(manifest_path)
assert manifest_hash == "3777f2f7b8a985d34da42dfa6a7d616a772602b21b3e09e5c4143b3a716da75a"
release = json.loads(manifest_path.read_text(encoding="utf-8"))
checked = []
for entry in release["source"] + release["related"]:
    path = ROOT / entry["path"]
    actual = sha(path)
    assert actual == entry["sha256"], str(path)
    checked.append({"path": path.as_posix(), "bytes": path.stat().st_size, "sha256": actual})
evidence = {}
for name, expected in release["evidence"].items():
    actual = sha(RELEASE / name)
    assert actual == expected, name
    evidence[name] = actual
for check in release["checks"]:
    assert check["exitCode"] == 0, check

native_path = Path("H:/hindsight/hindsight-api-slim/hindsight_api/admin/cli.py")
tree = ast.parse(native_path.read_text(encoding="utf-8"))
native = next(ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
              and any(isinstance(target, ast.Name) and target.id == "BACKUP_TABLES" for target in node.targets))
profile_path = ROOT / "packages/core/src/memory/hindsight-candidates/hindsight-candidate-profile.ts"
profile = profile_path.read_text(encoding="utf-8").split("const FAMILIES:", 1)[1].split("\n};", 1)[0]
candidate = re.findall(r'"([a-z][a-z0-9_]+)"', profile)
assert len(candidate) == len(set(candidate)) == len(native) == len(set(native)) == 61
assert set(candidate) == set(native)

result = {"recordedAt": datetime.now(timezone.utc).isoformat(), "releaseManifestSha256": manifest_hash,
          "sourceAndRelated": checked, "evidence": evidence, "checks": release["checks"],
          "nativeProfileParity": {"tables": sorted(candidate), "count": 61,
                                  "nativeCliSha256": sha(native_path), "candidateProfileSha256": sha(profile_path)},
          "sourceChangedDuringIndependentReview": False, "repeatedTests": False, "runtimeAccepted": False}
OUT.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps({"sourceFiles": len(release["source"]), "relatedFiles": len(release["related"]),
                  "evidenceFiles": len(evidence), "passingChecks": len(release["checks"]),
                  "nativeTables": len(native), "integritySha256": sha(OUT)}))
