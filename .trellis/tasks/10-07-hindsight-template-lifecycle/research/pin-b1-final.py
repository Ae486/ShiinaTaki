"""Freeze final source and baseline preservation without changing Git or task state."""

import hashlib
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
TAKI = HERE.parents[3]
BASELINE = json.loads((HERE / "pre-b1-baseline.json").read_text(encoding="utf-8"))


def identity(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


repositories = []
for old in BASELINE["repositories"]:
    root = Path(old["root"])
    names = subprocess.check_output(
        ["git", "ls-files", "--modified", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode("utf-8").split("\0")
    files = []
    for name in sorted(set(names) - {""}):
        if name.startswith(".trellis/") and not name.startswith(".trellis/spec/"):
            continue
        if name == "docs/HANDOFF.md":
            continue  # Leader-owned continuing task state, outside source release.
        path = root / name
        if not path.is_file():
            continue
        if path.name in {".env", ".env.local"}:
            raise ValueError("Refuse to read credential files")
        if path.suffix in {".ts", ".tsx", ".py", ".rs", ".go", ".js", ".json", ".yaml", ".toml", ".md", ".sh", ".example"}:
            data = path.read_bytes()
            data.decode("utf-8", errors="strict")
            assert not data.startswith(b"\xef\xbb\xbf"), f"Unexpected UTF-8 BOM: {name}"
        files.append({"path": name, **identity(path)})
    preservation = []
    for entry in old["files"]:
        path = root / entry["path"]
        current = identity(path) if path.is_file() else None
        preservation.append({
            "path": entry["path"], "baselineSha256": entry["sha256"],
            "finalSha256": current["sha256"] if current else None,
            "unchanged": current is not None and current["sha256"] == entry["sha256"],
        })
    repositories.append({
        "root": str(root), "head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root).decode().strip(),
        "files": files, "baselinePreservation": preservation,
    })

core = json.loads((HERE / "b1-composition-final-source.json").read_text(encoding="utf-8"))
core_mismatches = [row["path"] for row in core["files"] if identity(TAKI / row["path"])["sha256"] != row["sha256"]]
assert not core_mismatches, f"Released Core source drift: {core_mismatches}"
shared_mismatches = [row["path"] for row in core["sharedConsumers"] if identity(TAKI / row["path"])["sha256"] != row["sha256"]]
assert not shared_mismatches, f"Released Shared consumer drift: {shared_mismatches}"
legacy_path = TAKI / "packages/core/src/memory/hindsight/taki-bank-template-v1.ts"
assert identity(legacy_path)["sha256"] == "9d1f05100444af6c03f319df98cb04bfcf5bfe2504d0c059f2731ee531346952"
evidence = [{"path": path.name, **identity(path)} for path in sorted(HERE.glob("b1-*"))
            if path.is_file() and path.name != "b1-final-source.json"]
result = {"scope": "B1 self-checked source; independent review and B2/B3 remain pending", "repositories": repositories,
          "sourceTextUtf8NoBom": True,
          "coreReleasedFilesMatched": len(core["files"]), "sharedConsumersMatched": len(core["sharedConsumers"]),
          "legacyV1": identity(legacy_path), "evidence": evidence}
destination = HERE / "b1-final-source.json"
assert not destination.exists(), "Do not overwrite a released source manifest"
destination.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"sourceFiles": {repo["root"]: len(repo["files"]) for repo in repositories},
                  "coreReleasedFilesMatched": len(core["files"]), "evidenceFiles": len(evidence)}))
for repo in repositories:
    print(json.dumps({"root": repo["root"], "baselineChanges": [row["path"] for row in repo["baselinePreservation"] if not row["unchanged"]]}))
