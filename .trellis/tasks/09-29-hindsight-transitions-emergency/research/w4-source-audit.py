"""Attribute W4 delivery against immutable checked predecessors without changing their evidence."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[4]
RESEARCH = Path(__file__).resolve().parent
BASELINE = RESEARCH / "w4-prior-source-baseline.json"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


baseline = json.loads(BASELINE.read_text(encoding="utf-8"))
assert digest(BASELINE.read_bytes()) == "1cd5cf124305fb12e3323b3039a1dfe8440abd9f58516a634ef0f4c8c7d1ac75"
w3 = RESEARCH / "w3-source-ownership.json"
assert digest(w3.read_bytes()) == "998edcd67c06757f9f400ce4d17a02dcc63f7456f3607e2f992be3f674ee5851"
changed = set(git("diff", "--name-only", "HEAD").decode().splitlines())
changed.update(git("ls-files", "--others", "--exclude-standard").decode().splitlines())
prior = baseline["roots"]["H:/TakiAgent"]
files = []
issues = []
for name in sorted(changed):
    if not name.startswith(("packages/core/src/", "packages/shared/src/", ".trellis/spec/")):
        continue
    path = ROOT / name
    contents = path.read_bytes()
    after = digest(contents)
    before = prior.get(name)
    origin = "checked-pre-W4"
    if before is None:
        historical = subprocess.run(["git", "-C", str(ROOT), "show", f"HEAD:{name}"], capture_output=True)
        before = digest(historical.stdout) if historical.returncode == 0 else None
        origin = "HEAD" if before else "new-W4"
    if before == after:
        continue
    files.append({"path": name, "beforeW4": before, "afterW4": after, "baseline": origin})
    text = contents.decode("utf-8")
    if text.startswith("\ufeff"):
        issues.append(f"BOM: {name}")
    if path.suffix in {".ts", ".tsx"} and not name.endswith(".test.ts"):
        header = "\n".join(text.splitlines()[:8])
        if not all(tag in header for tag in ("INPUT:", "OUTPUT:", "POS:")):
            issues.append(f"module header: {name}")
        index = path.parent / "index.md"
        if path.name not in index.read_text(encoding="utf-8"):
            issues.append(f"directory index: {name}")

native = baseline["roots"]["H:/hindsight"]
native_drift = [name for name, expected in native.items()
                if digest((Path("H:/hindsight") / name).read_bytes()) != expected]
assert not native_drift, native_drift
assert not issues, issues
report = {"task": str(RESEARCH.parent), "takiRoot": str(ROOT), "nativeRoot": "H:/hindsight",
          "head": git("rev-parse", "HEAD").decode().strip(), "baselineSha256": digest(BASELINE.read_bytes()),
          "preservedW3OwnershipSha256": digest(w3.read_bytes()), "files": files,
          "nativeCheckedPaths": len(native), "nativeChangedPaths": native_drift,
          "utf8ModuleIndexIssues": issues,
          "meaning": "Final W4 source hashes versus immutable checked pre-W4 or HEAD. No prior-wave evidence rewritten."}
(RESEARCH / "w4-source-ownership.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"w4Files": len(files), "nativeUnchanged": len(native), "issues": issues}))
