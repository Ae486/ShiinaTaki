"""Record current independent-check source hashes without rewriting historical delivery manifests."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).resolve().parent


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


preserved = {
    "w4-source-ownership.json": "c11e7015dd8992c0689941f98b0f75a06754d5adbf5dd1547924673c7d7a6f28",
    "w3-source-ownership.json": "998edcd67c06757f9f400ce4d17a02dcc63f7456f3607e2f992be3f674ee5851",
    "w4-prior-source-baseline.json": "1cd5cf124305fb12e3323b3039a1dfe8440abd9f58516a634ef0f4c8c7d1ac75",
}
for name, expected in preserved.items():
    assert digest((RESEARCH / name).read_bytes()) == expected, name
delivery = json.loads((RESEARCH / "w4-source-ownership.json").read_text(encoding="utf-8"))
baseline = json.loads((RESEARCH / "w4-prior-source-baseline.json").read_text(encoding="utf-8"))
prior = baseline["roots"]["H:/TakiAgent"]
delivered = {item["path"]: item["afterW4"] for item in delivery["files"]}
extra = {
    "CLAUDE.md", "eslint.config.js", ".trellis/spec/backend/quality-guidelines.md",
    ".trellis/spec/backend/canonical-local-memory-runtime.md",
    "packages/core/src/memory/hindsight/hindsight-capture-sync.ts",
}
issues = []
files = []
for name in sorted(set(delivered) | extra):
    path = ROOT / name
    contents = path.read_bytes()
    text = contents.decode("utf-8")
    if text.startswith("\ufeff"):
        issues.append(f"BOM: {name}")
    if path.suffix in {".ts", ".tsx"} and not name.endswith(".test.ts"):
        header = "\n".join(text.splitlines()[:8])
        if not all(tag in header for tag in ("INPUT:", "OUTPUT:", "POS:")):
            issues.append(f"module header: {name}")
        if path.name not in (path.parent / "index.md").read_text(encoding="utf-8"):
            issues.append(f"directory index: {name}")
    files.append({"path": name, "deliveredW4Sha256": delivered.get(name),
                  "checkedSha256": digest(contents), "changedSinceDelivery":
                  digest(contents) != delivered[name] if name in delivered else None,
                  "source": "immutable W4 manifest" if name in delivered else "additional checker scope; no historical author inferred"})

assert digest((ROOT / "eslint.config.js").read_bytes()) == "9821c5c024c5ed20ce6bded27de5ba13accf36a1f151b331e9386cd1b0696e86"
migrations = []
for path in sorted((ROOT / "packages/core/src/db/migrations").glob("*.ts")):
    match = re.match(r"^(\d{3})-", path.name)
    if not match or int(match.group(1)) > 53 or path.name.endswith(".test.ts"):
        continue
    name = path.relative_to(ROOT).as_posix()
    expected = prior.get(name)
    origin = "pre-W4 map"
    if expected is None:
        expected = digest(git("show", f"HEAD:{name}"))
        origin = "HEAD"
    actual = digest(path.read_bytes())
    if actual != expected:
        issues.append(f"applied migration drift: {name}")
    migrations.append({"path": name, "sha256": actual, "baseline": origin})

assert not issues, issues
report = {
    "task": ".trellis/tasks/09-29-hindsight-transitions-emergency", "root": str(ROOT),
    "head": git("rev-parse", "HEAD").decode().strip(), "branch": git("branch", "--show-current").decode().strip(),
    "preservedManifests": preserved, "files": files, "appliedMigrationSources001Through053": migrations,
    "utf8ModuleIndexIssues": issues,
    "native": {"root": "H:/hindsight", "checkedBy": "parent; see w4-parent-check-handoff.md",
               "recordedPaths": 349, "changedPaths": 0, "missingPaths": 0, "rerunByChecker": False},
    "meaning": "Final independent-check source inventory. Original W3/W4 manifests and pre-W4 provenance remain immutable.",
}
destination = RESEARCH / "w4-checker-source-hashes.json"
destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"checkedFiles": len(files), "originalDeliveryFiles": len(delivered),
                  "changedDeliveryFiles": sum(item["changedSinceDelivery"] is True for item in files),
                  "historicalMigrationSources": len(migrations), "issues": issues,
                  "manifestSha256": digest(destination.read_bytes())}))
